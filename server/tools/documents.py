"""Les documents de la bibliothèque (05/10/2026, le « mode Showrunner »).

Cal, 05/10 : à l'entrée d'un projet, on dépose TOUT ce qu'on a — « pdf, image,
vidéo, texte… il faut un maximum de possibilités pour le user et de flexibilité
sur ce point d'entrée ; il faut qu'il puisse absolument donner tout ce dont il
dispose sans avoir à faire des exports ou adapter des formats : c'est à nous
d'organiser tout cela » ; « l'agent doit comprendre les docs ; tous ces assets
apparaissent bien sûr dans le panneau Asset ».

Une septième sorte d'objet, `document` (id `doc-…`, core/library.py) : ce qui
n'est ni une image, ni une vidéo, ni un son, ni un clip MIDI. Le fichier est
rangé tel quel (`main.<ext>`) ; à côté, ce qu'on a su en tirer :

  text.json        le texte, page par page : {format, pages: [{n, text}], truncated, via}
  cover.png        sa couverture : la première page (poppler), la vignette que le
                   fichier porte (Office, OpenDocument, iWork, la couverture d'un
                   EPUB), sinon une carte dessinée ici (le format en capitales mono,
                   le titre, les premières lignes, les jetons de commun/tokens.css)
  thumb.jpg        sa vignette ; view-256/512/1024.webp : ses copies d'affichage
  page-001.jpg…    les pages en vignettes, quand poppler sait les rendre

L'objet porte `doc: {format, pages, unit, words, has_text, title, via, needs_page,
rendered, why}` ; l'objet public y ajoute `text_url` (`api/library/<id>/texte`) et
`doc.page_urls`.

Ce qui se lit, et comment (bibliothèque standard seulement : rien à installer) :

  txt md csv tsv json yaml log srt…   le texte (UTF-8, UTF-16 avec sa marque, sinon Windows-1252)
  html htm xhtml xml svg fdx          les balises retirées (html.parser : aucune entité externe)
  docx                                word/document.xml (paragraphes, tableaux ; les sauts de page
                                      que Word a rendus font les pages), docProps (titre, pages)
  pptx                                une page par diapositive, dans l'ordre de presentation.xml,
                                      avec ses notes
  xlsx                                une page par feuille : les cellules, chaînes partagées comprises
  odt odp ods odg                     content.xml (paragraphes, diapositives, feuilles), meta.xml
  epub                                container.xml → le paquet OPF → le fil de lecture (spine), une
                                      page par chapitre ; sa couverture
  rtf                                 une lecture simple : le texte, sans la mise en forme
  pdf                                 poppler (`pdftotext -layout`, `pdfinfo`, `pdftoppm`) s'il est
                                      sur la machine ; sinon LA PAGE : commun/documents.js lit le PDF
                                      avec pdf.js dans le navigateur et dépose ce qu'elle a lu
                                      (POST /api/library/<id>/texte) — `doc.needs_page` le lui demande
  doc ppt xls key pages numbers…      rangés tels quels (la vignette d'un fichier iWork s'il en a une) ;
                                      leur texte ne se lit pas sans LibreOffice, qu'on ne suppose pas
                                      sur les DGX : la fiche le dit
  tout autre fichier                  rangé tel quel ; s'il est fait de texte, son texte

Une image d'un format que les outils ne lisent pas (TIFF, GIF, BMP, AVIF, PSD,
TGA, JPEG 2000… : EXOTIC) : si PIL la lit — un format nommé, jamais deviné —
elle devient une `image` dont le fichier principal est un PNG (les outils, les
modèles, les copies d'affichage n'y voient qu'un PNG), l'original gardé à côté
(`source.<ext>`, téléchargeable) ; sinon (HEIC sans greffon, RAW…) un document.

La sécurité de service (core/library.py, `serve_policy`) : un fichier déposé
n'est jamais affiché dans l'origine du portail s'il pourrait y exécuter quelque
chose — HTML, SVG, XML, un fichier inconnu partent en téléchargement
(`Content-Disposition: attachment`, `application/octet-stream`, une CSP
`sandbox`) ; un PDF s'ouvre dans la visionneuse du navigateur, un texte en
`text/plain`. Le texte d'un document se lit par l'API, jamais en interprétant le
fichier. Une archive (docx, epub…) se lit membre par membre, chacun borné
(une bombe zip ne passe pas), sans rien écrire sur le disque.

Routes :
  GET  /api/library/<id>/texte   {format, text, pages: [{n, text}], truncated, has_text, via, why}
  POST /api/library/<id>/texte   {pages: [{n, text}], thumb?: "data:image/png;base64,…", count?}
                                 ce que la page a lu d'un document sans texte (un PDF que le serveur
                                 n'a pas su lire) ; par qui peut écrire l'objet (403 sinon)
"""

from __future__ import annotations

import base64
import codecs
import html
import json
import posixpath
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import zipfile
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote

from core import auth, config, library
from core.http import HttpError

TEXT_MAX = 2_000_000        # signes de texte gardés par document (au-delà : `truncated`)
PAGES_MAX = 5000            # pages de texte gardées
READ_MAX = 24 << 20         # octets lus au plus d'un fichier de texte
MEMBER_MAX = 48 << 20       # octets lus au plus d'un membre d'archive (une bombe zip ne passe pas)
MEMBERS_MAX = 4000          # membres lus au plus (diapositives, feuilles, chapitres)
CELLS_MAX = 200_000         # cellules d'un classeur
TIMEOUT = 120               # s, un appel à poppler
RENDER_PAGES = 24           # pages rendues en vignettes (poppler)
PAGE_PX = 320               # leur grand côté
COVER_PX = 1024             # le grand côté de la couverture (copies d'affichage 256, 512, 1024)
CARD = (768, 1024)          # une carte dessinée : une page en 3 × 4
POST_MAX = 12 << 20         # le corps de POST …/texte (le texte d'un gros PDF, la vignette)

# l'extension → (le nom du format à l'écran, l'unité de ses pages)
FORMATS = {
    "pdf": ("PDF", "pages"), "txt": ("TXT", "pages"), "md": ("MD", "pages"), "markdown": ("MD", "pages"),
    "rtf": ("RTF", "pages"), "html": ("HTML", "pages"), "htm": ("HTML", "pages"), "xhtml": ("XHTML", "pages"),
    "csv": ("CSV", "feuilles"), "tsv": ("TSV", "feuilles"), "json": ("JSON", "pages"), "xml": ("XML", "pages"),
    "yaml": ("YAML", "pages"), "yml": ("YAML", "pages"),
    "docx": ("DOCX", "pages"), "doc": ("DOC", "pages"), "odt": ("ODT", "pages"),
    "pptx": ("PPTX", "diapositives"), "ppt": ("PPT", "diapositives"), "odp": ("ODP", "diapositives"),
    "key": ("KEY", "diapositives"),
    "xlsx": ("XLSX", "feuilles"), "xls": ("XLS", "feuilles"), "ods": ("ODS", "feuilles"), "numbers": ("NUMBERS", "feuilles"),
    "pages": ("PAGES", "pages"), "epub": ("EPUB", "chapitres"), "odg": ("ODG", "pages"),
}
# les formats de texte brut (et ceux qu'on lit comme du texte)
PLAIN = {"txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "log", "ini", "toml", "cfg", "conf", "srt", "vtt",
         "tex", "rst", "org", "fountain", "nfo", "text", "py", "js", "css", "sql", "sh"}
MARKUP = {"html", "htm", "xhtml", "xml", "svg", "fdx", "opml", "rss", "atom", "plist", "xliff", "ttml", "dfxp"}
LEGACY = {"doc": "Word 97-2003", "ppt": "PowerPoint 97-2003", "xls": "Excel 97-2003", "key": "Keynote",
          "pages": "Pages", "numbers": "Numbers"}
# une image d'un format que les outils ne lisent pas : le nom du format PIL qui la lit (jamais deviné)
EXOTIC = {".gif": "GIF", ".bmp": "BMP", ".dib": "DIB", ".tif": "TIFF", ".tiff": "TIFF", ".avif": "AVIF",
          ".heic": "HEIF", ".heif": "HEIF", ".psd": "PSD", ".tga": "TGA", ".ico": "ICO", ".icns": "ICNS",
          ".jp2": "JPEG2000", ".j2k": "JPEG2000", ".jpf": "JPEG2000", ".jpx": "JPEG2000", ".qoi": "QOI",
          ".ppm": "PPM", ".pgm": "PPM", ".pbm": "PPM", ".pnm": "PPM", ".sgi": "SGI", ".rgb": "SGI",
          ".dds": "DDS", ".pcx": "PCX", ".jfif": "JPEG", ".jpe": "JPEG"}
EXOTIC_PX = 1 << 28         # pixels au plus d'une image convertie (PIL.Image.MAX_IMAGE_PIXELS le dit aussi)

_tok_lock = threading.Lock()


# ── les outils de la machine ──────────────────────────────────
def _tool(name: str) -> str | None:
    """Un programme de poppler, s'il est là et si le réglage ne le coupe pas (`documents_poppler`)."""
    if name.startswith("pdf") and config.get("documents_poppler") is False:
        return None
    return shutil.which(name)


def tools_state() -> dict:
    """Ce que la machine sait lire (Admin, le contrôle)."""
    return {"pdftotext": bool(_tool("pdftotext")), "pdftoppm": bool(_tool("pdftoppm")), "pdfinfo": bool(_tool("pdfinfo"))}


# ── le texte ──────────────────────────────────────────────────
def decode(b: bytes) -> str:
    """Des octets en texte : la marque UTF-8 ou UTF-16, sinon UTF-8, sinon Windows-1252
    (le texte d'un PC d'avant ; chaque octet y a un signe, rien ne se perd en route)."""
    if b.startswith(codecs.BOM_UTF8):
        return b[3:].decode("utf-8", "replace")
    if b[:2] in (codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE):
        return b.decode("utf-16", "replace")
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("cp1252", "replace")


def looks_text(head: bytes) -> bool:
    """Un fichier fait de texte ? Pas d'octet nul (ni UTF-16 avec sa marque), et presque tout imprimable."""
    if not head:
        return False
    if head[:2] in (codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE) or head.startswith(codecs.BOM_UTF8):
        return True
    if b"\x00" in head:
        return False
    try:
        t = head.decode("utf-8")
    except UnicodeDecodeError as e:
        if e.start < len(head) - 4:   # un caractère coupé au bout de la tête n'est pas une faute
            t = head.decode("cp1252", "replace")
        else:
            t = head[:e.start].decode("utf-8", "replace")
    bad = sum(1 for c in t if ord(c) < 32 and c not in "\t\n\r\f")
    return bad <= len(t) // 100


class _Strip(HTMLParser):
    """Le texte d'une page HTML ou d'un XML : les balises retirées, les blocs à la ligne,
    ni script ni style. html.parser ne lit aucune entité externe, n'ouvre rien."""
    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "header", "footer",
             "blockquote", "pre", "table", "ul", "ol", "dl", "dt", "dd", "hr", "figure", "figcaption", "nav", "aside",
             "main", "para", "paragraph", "scene", "text", "content"}
    SKIP = {"script", "style", "noscript", "template", "svg:style", "head-script"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0
        self.title = ""
        self._in_title = False
        self.n = 0

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t in self.SKIP:
            self.skip += 1
        elif t == "title":
            self._in_title = True
        if t in self.BLOCK:
            self.out.append("\n")
        if t == "li":
            self.out.append("• ")
        if t in ("td", "th"):
            self.out.append("\t")

    def handle_startendtag(self, tag, attrs):
        if tag.lower() in ("br", "hr"):
            self.out.append("\n")

    def handle_endtag(self, tag):
        t = tag.lower()
        if t in self.SKIP:
            self.skip = max(0, self.skip - 1)
        elif t == "title":
            self._in_title = False
        if t in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if self.skip:
            return
        if self._in_title:   # le titre (de l'onglet) : à part, pas dans le texte (un h1 le redit souvent)
            self.title = self.title or " ".join(data.split())[:200]
            return
        self.n += len(data)
        if self.n <= TEXT_MAX * 2:
            self.out.append(data)

    def text(self) -> str:
        return tidy("".join(self.out))


def tidy(t: str) -> str:
    """Les espaces d'une ligne resserrés, trois lignes vides au plus de suite."""
    lines = [re.sub(r"[ \t\u00a0]+", lambda m: "\t" if "\t" in m.group(0) else " ", ln).strip() for ln in t.splitlines()]
    out, blank = [], 0
    for ln in lines:
        blank = blank + 1 if not ln else 0
        if blank <= 1:
            out.append(ln)
    return "\n".join(out).strip()


def strip_markup(t: str) -> tuple[str, str]:
    p = _Strip()
    try:
        p.feed(t)
        p.close()
    except Exception:   # noqa: BLE001 — un balisage cassé : ce qu'on a lu jusque-là
        pass
    return p.text(), p.title


def rtf_text(s: str) -> str:
    """Le texte d'un RTF, lu simplement : les mots de commande retirés, `\\par` à la ligne,
    `\\'hh` (la page de code du fichier, `\\ansicpg`) et `\\uN` décodés, les destinations
    (polices, couleurs, styles, infos, images, `\\*…`) sautées. Pas la mise en forme."""
    cp = "cp1252"
    m = re.search(r"\\ansicpg(\d+)", s[:2000])
    if m:
        try:
            codecs.lookup("cp" + m.group(1))
            cp = "cp" + m.group(1)
        except LookupError:
            pass
    dests = {"fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl",
             "footerr", "listtable", "listoverridetable", "revtbl", "rsidtbl", "generator", "xmlnstbl", "themedata",
             "colorschememapping", "latentstyles", "datastore", "object", "fldinst", "filetbl", "pgdsctbl", "bkmkstart",
             "bkmkend"}
    tok = re.compile(r"\\([a-zA-Z]{1,32})(-?\d{1,10})? ?|\\'([0-9a-fA-F]{2})|\\([^a-zA-Z])|([{}])|[\r\n]+|([^\\{}\r\n]+)")
    out: list[str] = []
    stack: list[tuple[bool, int]] = []
    skip, uc, pend = False, 1, 0
    raw = bytearray()

    def flush() -> None:
        if raw:
            out.append(raw.decode(cp, "replace"))
            raw.clear()

    for m in tok.finditer(s):
        word, arg, hexa, sym, brace, text = m.groups()
        if brace == "{":
            stack.append((skip, uc))
        elif brace == "}":
            flush()
            skip, uc = stack.pop() if stack else (False, 1)
        elif sym:
            if sym == "*":
                skip = True
            elif not skip and sym in "\\{}":
                flush()
                out.append(sym)
            elif not skip and sym == "~":
                flush()
                out.append("\u00a0")
            elif not skip and sym in "-_":
                pass
        elif word:
            if word in dests:
                skip = True
            elif word == "uc" and arg:
                uc = int(arg)
            elif skip:
                continue
            elif word in ("par", "line", "sect", "page", "row"):
                flush()
                out.append("\n")
            elif word in ("tab", "cell"):
                flush()
                out.append("\t")
            elif word == "u" and arg:
                flush()
                v = int(arg)
                out.append(chr(v + 65536 if v < 0 else v) if 0 < (v + 65536 if v < 0 else v) < 0x110000 else "")
                pend = uc
            elif word in ("emdash", "endash"):
                flush()
                out.append("—" if word == "emdash" else "–")
            elif word in ("lquote", "rquote"):
                flush()
                out.append("’")
            elif word in ("ldblquote", "rdblquote"):
                flush()
                out.append("“" if word == "ldblquote" else "”")
        elif hexa:
            if skip:
                continue
            if pend:
                pend -= 1
                continue
            raw.append(int(hexa, 16))
        elif text:
            if skip:
                continue
            if pend:
                k = min(pend, len(text))
                text, pend = text[k:], pend - k
            flush()
            out.append(text)
    flush()
    return tidy("".join(out))


# ── les archives (OOXML, OpenDocument, EPUB) ──────────────────
def _member(z: zipfile.ZipFile, name: str, limit: int = MEMBER_MAX) -> bytes | None:
    """Un membre d'archive, borné (lu au plus `limit` octets), ou None s'il n'y est pas."""
    try:
        with z.open(name) as f:
            return f.read(limit)
    except (KeyError, OSError, zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError):
        return None


_TAG = re.compile(r"<(/?)(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)((?:[^>\"']|\"[^\"]*\"|'[^']*')*?)(/?)>|([^<]+)|<!\[CDATA\[(.*?)\]\]>|<[!?][^>]*>",
                  re.S)
_ATTR = re.compile(r"(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)\s*=\s*(?:\"([^\"]*)\"|'([^']*)')")


def _tags(xml: bytes | str):
    """Les jetons d'un XML : ('<', préfixe, nom, attributs, vide) pour une ouverture,
    ('>', préfixe, nom) pour une fermeture, ('t', texte) pour du texte. Une lecture
    lexicale : aucun DTD, aucune entité définie par le fichier (ni « milliard de rires »,
    ni fichier externe) ; les entités standard et numériques seulement."""
    s = decode(xml) if isinstance(xml, (bytes, bytearray)) else xml
    for m in _TAG.finditer(s):
        close, pre, name, attrs, empty, text, cdata = m.groups()
        if text is not None:
            yield ("t", html.unescape(text))
        elif cdata is not None:
            yield ("t", cdata)
        elif name is None:
            continue
        elif close:
            yield (">", pre or "", name)
        else:
            a: dict[str, str] = {}
            for ap, k, v1, v2 in _ATTR.findall(attrs or ""):
                v = html.unescape(v1 if v1 is not None else v2 or "")
                if ap:
                    a[f"{ap}:{k}"] = v       # r:id, xlink:href… : sous leur nom entier
                    a.setdefault(k, v)       # et sous leur nom local, si rien ne le porte déjà sans préfixe
                else:
                    a[k] = v
            yield ("<", pre or "", name, a, bool(empty))
            if empty:
                yield (">", pre or "", name)


def _xml_text(xml: bytes, *, keep: set[str], para: set[str], tab=(), brk=(), page=(), skip=(), cell=(), row=()) -> list[str]:
    """Le texte d'un XML de bureautique : seul le texte des éléments `keep` compte (`w:t`, `a:t`…) —
    sauf `keep` vide : tout le texte ; un élément de `para` finit sa ligne, de `tab` pose une tabulation,
    de `brk` un retour, de `page` une nouvelle page ; `skip` : rien de ce qu'il contient. Un tableau :
    les paragraphes d'une case (`cell`) se suivent sur la ligne, la case finit par une tabulation, la
    rangée (`row`) par un retour."""
    pages: list[list[str]] = [[]]
    inside = 0
    hidden = 0
    incell = 0
    for t in _tags(xml):
        if t[0] == "t":
            if not hidden and (inside or not keep):
                pages[-1].append(t[1])
            continue
        name = t[2]
        if t[0] == "<":
            hidden += name in skip
            incell += name in cell
            inside += name in keep
            if hidden or name in keep:
                continue
            if name in tab:
                pages[-1].append("\t")
            elif name in brk:
                if (t[3].get("type") or "") == "page" and page:
                    pages.append([])
                else:
                    pages[-1].append("\n")
            elif name in page:
                pages.append([])
            elif name == "s":   # OpenDocument : `text:s text:c="n"`, n espaces
                try:
                    pages[-1].append(" " * max(1, min(200, int(t[3].get("c") or 1))))
                except ValueError:
                    pages[-1].append(" ")
        else:
            was_hidden = hidden
            inside = max(0, inside - (name in keep))
            hidden = max(0, hidden - (name in skip))
            if name in cell:
                incell = max(0, incell - 1)
            if was_hidden:
                continue
            if name in cell:
                pages[-1].append("\t")
            elif name in row:
                pages[-1].append("\n")
            elif name in para:
                pages[-1].append(" " if incell else "\n")
    return [tidy("".join(p)) for p in pages]


def _rid(a: dict) -> str:
    """L'identifiant de relation d'un élément OOXML (`r:id`, quel que soit le préfixe du fichier)."""
    return next((v for k, v in a.items() if ":" in k and k.split(":", 1)[1] == "id"), "")


def _first(xml: bytes | None, local: str) -> str:
    """Le texte du premier élément `local` (dc:title…) d'un XML de métadonnées."""
    if not xml:
        return ""
    on, got = False, []
    for t in _tags(xml):
        if t[0] == "<" and t[2] == local:
            on = True
        elif t[0] == ">" and t[2] == local and on:
            break
        elif t[0] == "t" and on:
            got.append(t[1])
    return " ".join("".join(got).split())[:200]


def _num(xml: bytes | None, local: str) -> int | None:
    v = _first(xml, local)
    return int(v) if v.isdigit() else None


def _rels(z: zipfile.ZipFile, path: str) -> dict[str, str]:
    """Les relations d'une partie OOXML (`…/_rels/<partie>.rels`) : Id → la cible, en chemin d'archive."""
    d, f = posixpath.split(path)
    out = {}
    for t in _tags(_member(z, posixpath.join(d, "_rels", f + ".rels")) or b""):
        if t[0] == "<" and t[2] == "Relationship" and (t[3].get("TargetMode") or "") != "External":
            tgt = t[3].get("Target") or ""
            out[t[3].get("Id") or ""] = posixpath.normpath(tgt.lstrip("/") if tgt.startswith("/") else posixpath.join(d, tgt))
    return out


def _picture(b: bytes | None):
    """Une vignette rangée dans le fichier (PNG ou JPEG, un format nommé), ou None."""
    if not b:
        return None
    try:
        from PIL import Image
        im = Image.open(BytesIO(b), formats=library.PIL_FORMATS)
        im.load()
        return im if im.width >= 16 and im.height >= 16 else None
    except Exception:   # noqa: BLE001 — une vignette illisible : la carte dessinée
        return None


class Got:
    """Ce qu'on a tiré d'un document."""

    def __init__(self) -> None:
        self.pages: list[str] = []
        self.title = ""
        self.count: int | None = None   # le nombre de pages que le document dit avoir
        self.cover = None               # une image PIL : sa couverture
        self.via = ""
        self.why = ""                   # pourquoi pas de texte (la fiche le dit)
        self.needs_page = False


def _docx(z: zipfile.ZipFile, g: Got) -> None:
    W = {"keep": {"t"}, "para": {"p"}, "tab": {"tab"}, "brk": {"br", "cr"}, "page": {"lastRenderedPageBreak"},
         "skip": {"instrText", "delText", "rPh", "tabs"}, "cell": {"tc"}, "row": {"tr"}}
    pages = _xml_text(_member(z, "word/document.xml") or b"", **W)
    # un saut rendu en tête d'un paragraphe vide laisse une page vide : on la fond
    g.pages = [p for p in pages if p] or [""]
    g.title = _first(_member(z, "docProps/core.xml"), "title")
    app = _member(z, "docProps/app.xml")
    g.count = _num(app, "Pages")
    g.cover = _picture(_member(z, "docProps/thumbnail.jpeg") or _member(z, "docProps/thumbnail.png"))
    g.via = "docx"


def _pptx(z: zipfile.ZipFile, g: Got) -> None:
    pres = "ppt/presentation.xml"
    rels = _rels(z, pres)
    order = [rels.get(_rid(t[3])) for t in _tags(_member(z, pres) or b"") if t[0] == "<" and t[2] == "sldId"]
    slides = [s for s in order if s] or sorted((n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                                                key=lambda n: int(re.findall(r"\d+", n)[-1]))
    A = {"keep": {"t"}, "para": {"p"}, "brk": {"br"}, "cell": {"tc"}, "row": {"tr"}}
    for s in slides[:MEMBERS_MAX]:
        text = _xml_text(_member(z, s) or b"", **A)[0]
        note = next((v for v in _rels(z, s).values() if "notesSlide" in v), None)
        if note:
            # les notes : le texte du corps (le numéro de diapositive, un champ, n'est pas de la prose)
            ntext = _xml_text(_member(z, note) or b"", **A, skip={"fld"})[0]
            if ntext.strip():
                text = (text + "\n\nNotes : " + ntext).strip()
        g.pages.append(text)
    g.title = _first(_member(z, "docProps/core.xml"), "title")
    g.count = len(slides)
    g.cover = _picture(_member(z, "docProps/thumbnail.jpeg") or _member(z, "docProps/thumbnail.png"))
    g.via = "pptx"


def _col(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]*", ref or "").group(0):
        n = n * 26 + ord(ch) - 64
    return max(0, n - 1)


def _xlsx(z: zipfile.ZipFile, g: Got) -> None:
    shared: list[str] = []
    cur: list[str] | None = None
    on = ph = 0
    for t in _tags(_member(z, "xl/sharedStrings.xml") or b""):
        if t[0] == "t":
            if on and not ph and cur is not None:
                cur.append(t[1])
            continue
        opening = t[0] == "<"
        if t[2] == "si":
            if opening:
                cur = []
            elif cur is not None:
                shared.append("".join(cur))
                cur = None
        elif t[2] == "t":
            on = on + 1 if opening else max(0, on - 1)
        elif t[2] == "rPh":   # la prononciation (japonais) n'est pas le texte de la cellule
            ph = ph + 1 if opening else max(0, ph - 1)
    book = "xl/workbook.xml"
    rels = _rels(z, book)
    sheets = [(t[3].get("name") or "feuille", rels.get(_rid(t[3])))
              for t in _tags(_member(z, book) or b"") if t[0] == "<" and t[2] == "sheet"]
    cells = 0
    for name, path in sheets[:MEMBERS_MAX]:
        rows: list[str] = []
        row: dict[int, str] = {}
        cell: dict | None = None
        val: list[str] = []
        what = ""
        for t in _tags(_member(z, path) or b"") if path else ():
            if t[0] == "<" and t[2] == "row":
                row = {}
            elif t[0] == ">" and t[2] == "row":
                if row and cells < CELLS_MAX:
                    hi = min(max(row), 255)
                    rows.append("\t".join(row.get(k, "") for k in range(hi + 1)).rstrip("\t"))
            elif t[0] == "<" and t[2] == "c":
                cell, val = t[3], []
            elif t[0] == ">" and t[2] == "c" and cell is not None:
                v = "".join(val).strip()
                ty = cell.get("t") or ""
                if ty == "s" and v.isdigit():
                    v = shared[int(v)] if int(v) < len(shared) else ""
                elif ty == "b":
                    v = "VRAI" if v == "1" else "FAUX"
                if v:
                    row[_col(cell.get("r") or "")] = v.replace("\t", " ").replace("\n", " ")
                    cells += 1
                cell = None
            elif t[0] == "<" and t[2] in ("v", "t"):
                what = t[2]
            elif t[0] == ">" and t[2] in ("v", "t"):
                what = ""
            elif t[0] == "t" and cell is not None and what:
                val.append(t[1])
        g.pages.append(tidy(f"{name}\n" + "\n".join(rows)))
    g.title = _first(_member(z, "docProps/core.xml"), "title")
    g.count = len(sheets)
    g.via = "xlsx"


def _odf(z: zipfile.ZipFile, g: Got, ext: str) -> None:
    content = _member(z, "content.xml") or b""
    meta = _member(z, "meta.xml")
    if ext in ("odp", "odg"):
        page = {"page"}            # draw:page : une diapositive
    elif ext == "ods":
        page = {"table"}           # table:table : une feuille
    else:
        page = {"soft-page-break"}  # les sauts que LibreOffice a rendus
    pages = _xml_text(content, keep=set(), para={"p", "h", "list-item"}, tab={"tab"}, cell={"table-cell"}, row={"table-row"},
                      brk={"line-break"}, page=page, skip={"annotation", "tracked-changes", "font-face-decls",
                                                          "automatic-styles", "scripts", "forms"})
    # la première « page » est ce qui précède le premier draw:page / table:table : les déclarations
    g.pages = pages[1:] if ext in ("odp", "odg", "ods") and len(pages) > 1 else pages
    g.title = _first(meta, "title")
    if ext in ("odp", "odg", "ods"):
        g.count = len(g.pages)
    else:
        m = re.search(rb'meta:page-count="(\d+)"', meta or b"")
        g.count = int(m.group(1)) if m else None
    g.cover = _picture(_member(z, "Thumbnails/thumbnail.png"))
    g.via = "opendocument"


def _epub(z: zipfile.ZipFile, g: Got) -> None:
    root = next((t[3].get("full-path") for t in _tags(_member(z, "META-INF/container.xml") or b"")
                 if t[0] == "<" and t[2] == "rootfile"), None)
    if not root:
        g.why = "un EPUB sans paquet (META-INF/container.xml ne nomme pas de rootfile)"
        return
    base = posixpath.dirname(root)
    opf = _member(z, root) or b""
    items: dict[str, dict] = {}
    spine: list[str] = []
    cover_id = None
    for t in _tags(opf):
        if t[0] != "<":
            continue
        if t[2] == "item":
            items[t[3].get("id") or ""] = t[3]
        elif t[2] == "itemref":
            spine.append(t[3].get("idref") or "")
        elif t[2] == "meta" and (t[3].get("name") or "") == "cover":
            cover_id = t[3].get("content")
    g.title = _first(opf, "title")
    path = lambda it: posixpath.normpath(posixpath.join(base, unquote((it.get("href") or "").split("#")[0])))   # noqa: E731
    for idref in spine[:MEMBERS_MAX]:
        it = items.get(idref)
        if not it:
            continue
        text, _ = strip_markup(decode(_member(z, path(it)) or b""))
        if text:
            g.pages.append(text)
    cov = next((it for it in items.values() if "cover-image" in (it.get("properties") or "")), None) or items.get(cover_id or "")
    if cov:
        g.cover = _picture(_member(z, path(cov)))
    g.count = len(g.pages)
    g.via = "epub"


def _iwork(z: zipfile.ZipFile, g: Got, ext: str) -> None:
    """Keynote, Pages, Numbers (2013 et après : une archive de protobuf, IWA) : leur aperçu, rangé dans
    le fichier par l'app ; leur texte ne se lit pas sans le format IWA, non documenté par Apple."""
    for n in ("preview.jpg", "QuickLook/Thumbnail.jpg", "preview-web.jpg", "QuickLook/Preview.jpg", "preview-micro.jpg"):
        g.cover = _picture(_member(z, n))
        if g.cover:
            break
    g.why = (f"un fichier {LEGACY[ext]} : son texte est dans le format interne d'Apple (IWA), que le portail ne lit pas ; "
             "il est rangé tel quel et se télécharge" + (" — son aperçu vient du fichier" if g.cover else ""))


# ── le PDF : poppler, sinon la page ───────────────────────────
def _run(args: list[str], timeout: int = TIMEOUT) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(args, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None


def _pdf(path: Path, g: Got, d: Path) -> None:
    info = _run([_tool("pdfinfo"), "-enc", "UTF-8", str(path)], 60) if _tool("pdfinfo") else None
    if info and info.returncode == 0:
        txt = info.stdout.decode("utf-8", "replace")
        m = re.search(r"^Pages:\s+(\d+)", txt, re.M)
        g.count = int(m.group(1)) if m else None
        m = re.search(r"^Title:\s+(.+)$", txt, re.M)
        g.title = m.group(1).strip()[:200] if m else ""
    if not _tool("pdftotext"):
        g.needs_page = True
        g.via = "page"
        g.why = "le texte de ce PDF se lit dans le navigateur (poppler n'est pas sur la machine du portail)"
        return
    r = _run([_tool("pdftotext"), "-layout", "-enc", "UTF-8", "-l", str(PAGES_MAX), str(path), "-"])
    if not r or r.returncode != 0:
        err = (r.stderr.decode("utf-8", "replace").strip().splitlines() or ["?"])[-1][:200] if r else "trop long"
        g.why = f"poppler ne lit pas ce PDF ({err})"
    else:
        raw = r.stdout.decode("utf-8", "replace")
        parts = raw.split("\f")
        if parts and not parts[-1].strip() and raw.endswith("\f"):
            parts = parts[:-1]
        g.pages = [p.rstrip() for p in parts]
        g.count = g.count or len(g.pages)
    g.via = "pdftotext"
    ppm = _tool("pdftoppm")
    if not ppm:
        return
    with tempfile.TemporaryDirectory(prefix="sr_pdf_") as tmp:
        r = _run([ppm, "-png", "-f", "1", "-l", "1", "-scale-to", str(COVER_PX), "-singlefile", str(path), f"{tmp}/cover"])
        if r and r.returncode == 0 and Path(f"{tmp}/cover.png").is_file():
            g.cover = _picture(Path(f"{tmp}/cover.png").read_bytes())
        r = _run([ppm, "-jpeg", "-jpegopt", "quality=80", "-f", "1", "-l", str(RENDER_PAGES), "-scale-to", str(PAGE_PX),
                  str(path), f"{tmp}/pg"])
        got = sorted(Path(tmp).glob("pg-*.jpg"), key=lambda p: int(re.findall(r"\d+", p.stem)[-1]))
        for k, p in enumerate(got[:RENDER_PAGES]):
            shutil.move(str(p), str(d / page_name(k + 1)))


def page_name(n: int) -> str:
    return f"page-{n:03d}.jpg"


# ── extraire ──────────────────────────────────────────────────
def extract(path: Path, ext: str, d: Path) -> Got:
    """Ce qu'on tire d'un document rangé dans le dossier `d` (les pages rendues s'y écrivent)."""
    g = Got()
    ext = ext.lower().lstrip(".")
    try:
        if ext == "pdf":
            _pdf(path, g, d)
        elif ext in ("docx", "docm", "dotx", "pptx", "pptm", "potx", "xlsx", "xlsm", "xltx", "odt", "odp", "ods", "odg",
                     "ott", "otp", "ots", "epub", "key", "pages", "numbers"):
            try:
                z = zipfile.ZipFile(path)
            except (zipfile.BadZipFile, OSError):
                g.why = f"ce fichier {ext.upper()} n'est pas une archive lisible (abîmé, ou d'une version d'avant)"
                return g
            with z:
                if ext.startswith("doc") or ext == "dotx":
                    _docx(z, g)
                elif ext.startswith("pp") or ext == "potx":
                    _pptx(z, g)
                elif ext.startswith("xl"):
                    _xlsx(z, g)
                elif ext == "epub":
                    _epub(z, g)
                elif ext in LEGACY:
                    _iwork(z, g, ext)
                else:   # OpenDocument (un modèle, .ott…, se lit comme son document)
                    _odf(z, g, {"ott": "odt", "otp": "odp", "ots": "ods"}.get(ext, ext))
        elif ext == "rtf":
            g.pages = [rtf_text(decode(path.open("rb").read(READ_MAX)))]
            g.via = "rtf"
        elif ext in MARKUP:
            text, g.title = strip_markup(decode(path.open("rb").read(READ_MAX)))
            g.pages = [text]
            g.via = "html" if ext in ("html", "htm", "xhtml") else "xml"
        elif ext in LEGACY:
            g.why = (f"un fichier {LEGACY[ext]} (format binaire d'avant 2007) : son texte ne se lit pas sans LibreOffice, "
                     "qu'on ne suppose pas sur la machine du portail ; il est rangé tel quel et se télécharge")
        else:
            head = path.open("rb").read(8192)
            if ext in PLAIN or looks_text(head):
                t = decode(path.open("rb").read(READ_MAX))
                g.pages = [p.rstrip() for p in t.replace("\r\n", "\n").split("\f")]
                g.via = "texte"
                if ext in ("md", "markdown"):
                    m = re.search(r"^#\s+(.+)$", t, re.M)
                    g.title = m.group(1).strip()[:200] if m else ""
            else:
                g.why = f"un fichier {ext.upper() or 'sans extension'} que le portail ne sait pas lire : il est rangé tel quel et se télécharge"
    except Exception as e:   # noqa: BLE001 — un document mal fait ne fait pas tomber le dépôt : il est rangé, sans texte
        g.pages, g.why = [], f"lecture interrompue ({type(e).__name__}: {str(e)[:120]})"
    return g


def _bound(pages: list[str]) -> tuple[list[dict], bool]:
    """Les pages bornées (TEXT_MAX signes, PAGES_MAX pages) : [{n, text}], tronqué ?"""
    out, left, cut = [], TEXT_MAX, False
    for k, p in enumerate(pages):
        if k >= PAGES_MAX or left <= 0:
            cut = True
            break
        t = p if isinstance(p, str) else ""
        if len(t) > left:
            t, cut = t[:left], True
        left -= len(t)
        out.append({"n": k + 1, "text": t})
    return out, cut


def words(text: str) -> int:
    return len(re.findall(r"\w+", text))


# ── la carte dessinée ─────────────────────────────────────────
def card(fmt: str, title: str, lines: str = "", foot: str = ""):
    """Une page dessinée (PIL) : le format en capitales mono, le titre, les premières lignes,
    le pied (pages, mots) ; les couleurs sont les jetons du thème sombre (commun/tokens.css,
    lus par ideation.tokens), les polices celles du portail."""
    from PIL import Image, ImageDraw
    from tools.ideation import _font, _wrap, tokens
    T = tokens()
    W, H = CARD
    im = Image.new("RGB", (W, H), T["panel"])
    d = ImageDraw.Draw(im)
    m = 44
    fold = 96
    # la page, son coin plié
    d.polygon([(m, m), (W - m - fold, m), (W - m, m + fold), (W - m, H - m), (m, H - m)], fill=T["panel2"], outline=T["line"], width=2)
    d.polygon([(W - m - fold, m), (W - m - fold, m + fold), (W - m, m + fold)], fill=T["panel3"], outline=T["line"], width=2)
    x = m + 44
    y = m + 52
    mono = _font("mono", 46)
    d.text((x, y), (fmt or "FICHIER").upper()[:12], font=mono, fill=T["cy"])
    y += 92
    d.line([(x, y), (W - m - 44, y)], fill=T["line-cy"], width=2)
    y += 34
    tf = _font("ui", 50)
    for ln in _wrap(d, title or "", tf, W - 2 * m - 88, 4):
        d.text((x, y), ln, font=tf, fill=T["ink"])
        y += 64
    y += 22
    bf = _font("ui", 27)
    room = int((H - m - 120 - y) // 38)
    if lines and room > 0:
        # une tabulation (les cellules d'un tableau, d'un classeur) n'a pas de dessin dans la police : des espaces
        body = "\n".join(ln for ln in lines.replace("\t", "   ").splitlines() if ln.strip())[:4000]
        for ln in _wrap(d, body, bf, W - 2 * m - 88, room):
            d.text((x, y), ln, font=bf, fill=T["ink2"])
            y += 38
    if foot:
        d.text((x, H - m - 80), foot.upper(), font=_font("mono", 26), fill=T["ink3"])
    return im


def unit_fr(n: int | None, unit: str) -> str:
    if not n:
        return ""
    one = {"pages": "page", "diapositives": "diapositive", "feuilles": "feuille", "chapitres": "chapitre"}.get(unit, unit)
    return f"{n} {one if n == 1 else unit}"


def _foot(doc: dict) -> str:
    bits = [unit_fr(doc.get("pages"), doc.get("unit") or "pages")]
    if doc.get("words"):
        bits.append(f"{doc['words']:,} mots".replace(",", " "))
    return " · ".join(b for b in bits if b)


def _save_cover(d: Path, cover) -> dict:
    """La couverture, la vignette, les copies d'affichage : {thumb, views, views_v}."""
    from PIL import Image
    im = cover.convert("RGBA" if cover.mode in ("RGBA", "LA", "PA") else "RGB")
    im.thumbnail((COVER_PX, COVER_PX), Image.LANCZOS)
    buf = BytesIO()
    im.save(buf, "PNG", optimize=True)
    tmp = d / ".cover.png.tmp"
    tmp.write_bytes(buf.getvalue())
    tmp.replace(d / "cover.png")
    th = im.convert("RGB")
    th.thumbnail((library.THUMB, library.THUMB), Image.LANCZOS)
    th.save(d / "thumb.jpg", "JPEG", quality=86)
    views = library.make_views(buf.getvalue(), d)
    return {"thumb": "thumb.jpg", "views": views, "views_v": library._views_v()}


def label_of(ext: str) -> str:
    return FORMATS.get(ext, (ext.upper() or "FICHIER", "pages"))[0]


def ingest(d: Path, name: str, ext: str, title: str) -> dict:
    """Range ce qu'on tire d'un document déposé dans son dossier `d` (le fichier `name`) :
    text.json, la couverture, la vignette, les copies, les pages rendues. Rend les champs
    de l'objet : {doc, thumb, views, views_v}."""
    ext = ext.lower().lstrip(".")
    g = extract(d / name, ext, d)
    pages, cut = _bound(g.pages)
    text = "\n\n".join(p["text"] for p in pages)
    has = bool(text.strip())
    unit = FORMATS.get(ext, ("", "pages"))[1]
    rendered = len(list(d.glob("page-*.jpg")))
    doc = {"format": ext, "label": label_of(ext), "pages": g.count or (len(pages) if has else None), "unit": unit,
           "words": words(text), "has_text": has, "title": g.title, "via": g.via, "needs_page": g.needs_page,
           "rendered": rendered, "truncated": cut}
    if not has:
        doc["why"] = g.why or ("aucun texte dans ce document : une image, un scan ? (l'OCR n'est pas là)" if ext == "pdf"
                               else "aucun texte dans ce document")
    write_text(d, ext, pages, cut, g.via)
    cover = g.cover or card(label_of(ext), g.title or title, text, _foot(doc))
    return {"doc": doc, **_save_cover(d, cover)}


def write_text(d: Path, ext: str, pages: list[dict], cut: bool, via: str) -> None:
    tmp = d / ".text.json.tmp"
    tmp.write_text(json.dumps({"format": ext, "pages": pages, "truncated": cut, "via": via}, ensure_ascii=False), encoding="utf-8")
    tmp.replace(d / "text.json")


def as_png(src: Path, ext: str) -> bytes | None:
    """Une image d'un format que les outils ne lisent pas (EXOTIC), en PNG — lue par PIL sous son
    format nommé, jamais deviné (un « .tif » qui serait un EPS ne part pas vers Ghostscript) —,
    tournée comme l'EXIF le dit ; None si PIL ne la lit pas (elle sera un document)."""
    fmt = EXOTIC.get(ext.lower())
    if not fmt:
        return None
    try:
        from PIL import Image, ImageOps
        Image.init()
        if fmt not in Image.OPEN:   # HEIF sans son greffon (pillow-heif), un format que ce PIL ne connaît pas
            return None
        with Image.open(src, formats=[fmt]) as im:
            if im.width * im.height > EXOTIC_PX:
                return None
            im.seek(0)
            if im.mode in ("I;16", "I;16B", "I;16L", "I", "F"):   # 16 bits ou flottante : ramenée à 8 bits
                im = im.convert("I").point(lambda v: v / 256).convert("L")
            alpha = im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info
            im = ImageOps.exif_transpose(im).convert("RGBA" if alpha else "RGB")
            buf = BytesIO()
            im.save(buf, "PNG")
            return buf.getvalue()
    except Exception:   # noqa: BLE001 — illisible pour PIL : un document
        return None


# ── les routes ────────────────────────────────────────────────
def _doc_or_404(item_id: str, show: bool) -> dict:
    it = library.see(item_id) if show else library.get(item_id)
    if not it or it.get("kind") != "document":
        raise HttpError(404, f"pas un document de la bibliothèque : {item_id}")
    return it


def read_text(it: dict) -> dict:
    try:
        t = json.loads((library.folder_of(it["id"]) / "text.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        t = {"pages": [], "truncated": False, "via": ""}
    return t


def text_of(it: dict) -> str | None:
    """Le texte entier d'un document, pour le serveur lui-même (l'agent Showrunner :
    ideation_agent.TEXTE_DOCUMENT le cherche ici, sous ce nom) ; None si ce n'est pas un document."""
    if not it or it.get("kind") != "document":
        return None
    return "\n\n".join(p.get("text") or "" for p in read_text(it).get("pages") or [] if isinstance(p, dict))


def r_texte(req, item_id):
    """GET /api/library/<id>/texte — le texte d'un document, page par page (montrer : qui voit l'objet,
    où qu'il soit, lit son texte ; l'invité d'une planche aussi, par library.see)."""
    it = _doc_or_404(item_id, show=True)
    t = read_text(it)
    pages = [p for p in t.get("pages") or [] if isinstance(p, dict)]
    doc = it.get("doc") or {}
    return {"id": it["id"], "format": doc.get("format") or t.get("format"), "title": it.get("title"),
            "text": "\n\n".join(p.get("text") or "" for p in pages), "pages": pages, "truncated": bool(t.get("truncated")),
            "has_text": bool(doc.get("has_text")), "via": t.get("via") or doc.get("via"), "why": doc.get("why", "")}


def _data_png(v) -> bytes:
    if not isinstance(v, str) or not v.startswith("data:image/png;base64,"):
        raise HttpError(400, "thumb : une image PNG en data:image/png;base64,…")
    try:
        b = base64.b64decode(v.split(",", 1)[1], validate=True)
    except ValueError as e:
        raise HttpError(400, "thumb : base64 illisible") from e
    if not library.sniff(b[:16], ".png"):
        raise HttpError(400, "thumb : ce n'est pas un PNG")
    return b


def r_texte_post(req, item_id):
    """POST /api/library/<id>/texte {pages: [{n, text}], thumb?: dataURL PNG, count?} — ce que la page a lu
    d'un document que le serveur n'a pas su lire (un PDF sans poppler) : accepté pour un document SANS
    texte seulement, par qui peut écrire l'objet (le juge de la bibliothèque : 403 sinon)."""
    from tools.core_api import elsewhere_or_404
    if req._length() > POST_MAX:
        raise HttpError(413, f"trop gros : {POST_MAX >> 20} Mo au plus")
    it = elsewhere_or_404(item_id)
    if it.get("kind") != "document":
        raise HttpError(400, "ce n'est pas un document")
    library.check_write(it)
    d = req.json()
    doc = dict(it.get("doc") or {})
    if doc.get("has_text"):
        raise HttpError(409, "ce document a déjà son texte, lu par le serveur : rien à déposer")
    raw = d.get("pages")
    if not isinstance(raw, list) or len(raw) > PAGES_MAX * 4:
        raise HttpError(400, f"pages : une liste de {PAGES_MAX} pages au plus")
    by_n: dict[int, str] = {}
    for p in raw:
        if not isinstance(p, dict) or not isinstance(p.get("text", ""), str):
            raise HttpError(400, "pages : [{n, text}]")
        try:
            n = int(p.get("n"))
        except (TypeError, ValueError) as e:
            raise HttpError(400, "pages : n est un numéro de page") from e
        if not 1 <= n <= PAGES_MAX:
            raise HttpError(400, f"pages : n entre 1 et {PAGES_MAX}")
        by_n[n] = p.get("text") or ""
    hi = max(by_n) if by_n else 0
    png = _data_png(d["thumb"]) if d.get("thumb") is not None else None
    cover = None
    if png:
        from PIL import Image
        try:
            cover = Image.open(BytesIO(png), formats=["PNG"])
            cover.load()
        except Exception as e:   # noqa: BLE001
            raise HttpError(400, f"thumb : PNG illisible ({type(e).__name__})") from e
        if cover.width * cover.height > 40_000_000:
            raise HttpError(400, "thumb : trop grande")
    try:
        count = int(d.get("count") or hi) or None
    except (TypeError, ValueError):
        count = hi or None
    return library.public(deposer(it, [by_n.get(k, "") for k in range(1, hi + 1)], cover=cover, count=count, via="page"))


def deposer(it: dict, texts: list[str], *, cover=None, count: int | None = None, via: str = "page") -> dict:
    """Pose sur un document ce qu'on a lu ailleurs que dans le serveur : le texte de chaque page (`texts`,
    dans l'ordre), sa couverture (une image PIL ou le chemin d'un PNG ; sans elle, la carte dessinée qui montre
    le texte), le nombre de pages. La page (POST …/texte, pdf.js : via « page ») et l'export d'une présentation
    (server/tools/presentation_pdf.py, la page d'impression : via « chromium ») passent par ici. Rend l'objet."""
    pages, cut = _bound(list(texts))
    text = "\n\n".join(p["text"] for p in pages)
    if isinstance(cover, (str, Path)):
        from PIL import Image
        with Image.open(cover) as im:
            im.load()
            cover = im.copy()
    doc = dict(it.get("doc") or {})
    has = bool(text.strip())
    fd = library.folder_of(it["id"])
    doc.update(pages=count or doc.get("pages"), words=words(text), has_text=has, via=via, needs_page=False,
               truncated=cut)
    if has:
        doc.pop("why", None)
    else:
        doc["why"] = "aucun texte dans ce PDF : une image, un scan ? (l'OCR n'est pas là)"
    if cover is None and has:
        # la carte dessinée d'avant ne montrait pas le texte : elle le montre maintenant
        cover = card(doc.get("label") or label_of(doc.get("format") or ""), doc.get("title") or it.get("title") or "", text, _foot(doc))
    # hors du verrou de la bibliothèque : la couverture et ses copies s'écrivent sous des noms à part, puis se posent
    shown = _save_cover(fd, cover) if cover is not None else {}
    with library._lock:
        cur = library._items.get(it["id"])
        if cur is None or not fd.is_dir():
            raise HttpError(404, "parti à la corbeille entre-temps")
        write_text(fd, doc.get("format") or "pdf", pages, cut, via)
        cur.update(shown)
        cur["doc"] = doc
        cur["updated"] = library.now()
        library._save(cur)
        return cur


def register(app) -> None:
    app.route("GET", "/api/library/{item_id}/texte", r_texte)
    app.route("POST", "/api/library/{item_id}/texte", r_texte_post)
    # l'invité d'une planche lit le texte des documents qu'elle lui montre (library.see le juge)
    auth.guest_realm("documents", routes=[("GET", r"/api/library/(?P<iid>[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4})/texte", None)])


# ── des documents fabriqués ici, pour le contrôle et les essais ──
def pdf_bytes(pages: list[str], title: str = "") -> bytes:
    """Un PDF écrit à la main (PDF 1.4, ISO 32000 § 7) : un catalogue, l'arbre des pages, une
    police de base (Helvetica, WinAnsi), une page et son flux de texte par page ; une page vide
    de texte y devient un aplat (un « scan »)."""
    objs: list[bytes] = []
    n = len(pages)
    kids = [5 + 2 * i for i in range(n)]
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {n} >>".encode())
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    esc = lambda t: t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")   # noqa: E731
    objs.append(f"<< /Title ({esc(title)}) /Producer (Showrunner, essai) >>".encode("cp1252"))
    for i, text in enumerate(pages):
        if text:
            ops = ["BT", "/F1 22 Tf", "72 740 Td", "30 TL"] + [f"({esc(ln)}) Tj T*" for ln in text.split("\n")] + ["ET"]
        else:
            ops = ["0.25 0.3 0.28 rg", "60 60 492 672 re f", "0.6 0.62 0.6 rg", "120 300 200 160 re f"]
        stream = "\n".join(ops).encode("cp1252")
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> "
                    f"/Contents {kids[i] + 1} 0 R >>".encode())
        objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    out = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offs = []
    for k, o in enumerate(objs):
        offs.append(len(out))
        out += f"{k + 1} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offs)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def _zip(files: dict[str, str | bytes]) -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data.encode("utf-8") if isinstance(data, str) else data)
    return buf.getvalue()


_CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PKG = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'


def _core(title: str) -> str:
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties '
            'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            f'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{html.escape(title)}</dc:title></cp:coreProperties>')


def docx_bytes(paras: list[str], title: str = "", pages: int | None = None) -> bytes:
    """Un DOCX (ECMA-376 : [Content_Types].xml, _rels, word/document.xml, docProps) ; « ¶ » dans un
    paragraphe y pose un saut de page rendu (w:lastRenderedPageBreak), comme Word en écrit."""
    W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = []
    for p in paras:
        runs = []
        for k, part in enumerate(p.split("¶")):
            if k:
                runs.append("<w:r><w:lastRenderedPageBreak/></w:r>")
            cells = part.split("|")
            if len(cells) > 1:   # « a|b|c » : une ligne de tableau
                body.append("<w:tbl><w:tr>" + "".join(f"<w:tc><w:p><w:r><w:t>{html.escape(c)}</w:t></w:r></w:p></w:tc>" for c in cells)
                            + "</w:tr></w:tbl>")
                continue
            runs.append(f'<w:r><w:t xml:space="preserve">{html.escape(part)}</w:t></w:r>')
        if runs:
            body.append("<w:p><w:pPr><w:tabs><w:tab w:val=\"left\" w:pos=\"720\"/></w:tabs></w:pPr>" + "".join(runs) + "</w:p>")
    doc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
    return _zip({
        "[Content_Types].xml": _CT + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        "_rels/.rels": _PKG + f'<Relationship Id="rId1" Type="{_REL}/officeDocument" Target="word/document.xml"/></Relationships>',
        "word/document.xml": doc,
        "docProps/core.xml": _core(title),
        "docProps/app.xml": f'<?xml version="1.0" encoding="UTF-8"?><Properties><Pages>{pages or 1}</Pages></Properties>',
    })


def pptx_bytes(slides: list[tuple[str, str]], title: str = "") -> bytes:
    """Un PPTX : presentation.xml (sldIdLst, dans un ordre qui n'est PAS celui des noms de fichiers),
    ses relations, une diapositive par (texte, notes)."""
    P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' \
        f'xmlns:r="{_REL}"'
    files: dict[str, str | bytes] = {}
    ids, rels = [], []
    for k, (text, notes) in enumerate(slides):
        num = len(slides) - k   # slide3.xml est la première : l'ordre vient de sldIdLst, pas des noms
        rid = f"rId{k + 10}"
        ids.append(f'<p:sldId id="{256 + k}" r:id="{rid}"/>')
        rels.append(f'<Relationship Id="{rid}" Type="{_REL}/slide" Target="slides/slide{num}.xml"/>')
        paras = "".join(f"<a:p><a:r><a:t>{html.escape(ln)}</a:t></a:r></a:p>" for ln in text.split("\n"))
        files[f"ppt/slides/slide{num}.xml"] = f'<p:sld {P}><p:cSld><p:spTree><p:sp><p:txBody>{paras}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
        if notes:
            files[f"ppt/slides/_rels/slide{num}.xml.rels"] = (_PKG + f'<Relationship Id="rId2" Type="{_REL}/notesSlide" '
                                                              f'Target="../notesSlides/notesSlide{num}.xml"/></Relationships>')
            files[f"ppt/notesSlides/notesSlide{num}.xml"] = (
                f'<p:notes {P}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:fld type="slidenum"><a:t>{num}</a:t></a:fld></a:p></p:txBody></p:sp>'
                f'<p:sp><p:txBody><a:p><a:r><a:t>{html.escape(notes)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>')
    files["ppt/presentation.xml"] = f'<p:presentation {P}><p:sldIdLst>{"".join(ids)}</p:sldIdLst></p:presentation>'
    files["ppt/_rels/presentation.xml.rels"] = _PKG + "".join(rels) + "</Relationships>"
    files["docProps/core.xml"] = _core(title)
    files["[Content_Types].xml"] = _CT + "</Types>"
    return _zip(files)


def xlsx_bytes(sheets: dict[str, list[list]], title: str = "") -> bytes:
    """Un XLSX : workbook.xml et ses relations, des chaînes partagées (avec une prononciation, rPh,
    qui n'est pas le texte), une cellule en chaîne en ligne, des nombres, un booléen."""
    shared: list[str] = []
    files: dict[str, str | bytes] = {}
    entries, rels = [], []
    for k, (name, rows) in enumerate(sheets.items()):
        xr = []
        for r, row in enumerate(rows):
            cells = []
            for c, v in enumerate(row):
                ref = f"{chr(65 + c)}{r + 1}"
                if v is None:
                    continue
                if isinstance(v, bool):
                    cells.append(f'<c r="{ref}" t="b"><v>{int(v)}</v></c>')
                elif isinstance(v, (int, float)):
                    cells.append(f'<c r="{ref}"><v>{v}</v></c>')
                elif v.startswith("="):
                    cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{html.escape(v[1:])}</t></is></c>')
                else:
                    if v not in shared:
                        shared.append(v)
                    cells.append(f'<c r="{ref}" t="s"><v>{shared.index(v)}</v></c>')
            xr.append(f'<row r="{r + 1}">{"".join(cells)}</row>')
        files[f"xl/worksheets/sheet{k + 1}.xml"] = f'<worksheet><sheetData>{"".join(xr)}</sheetData></worksheet>'
        entries.append(f'<sheet name="{html.escape(name)}" sheetId="{k + 1}" r:id="rId{k + 1}"/>')
        rels.append(f'<Relationship Id="rId{k + 1}" Type="{_REL}/worksheet" Target="worksheets/sheet{k + 1}.xml"/>')
    si = "".join(f"<si><r><t>{html.escape(s)}</t></r><rPh sb=\"0\" eb=\"1\"><t>ヨミ</t></rPh></si>" for s in shared)
    files["xl/sharedStrings.xml"] = f'<sst count="{len(shared)}">{si}</sst>'
    files["xl/workbook.xml"] = f'<workbook xmlns:r="{_REL}"><sheets>{"".join(entries)}</sheets></workbook>'
    files["xl/_rels/workbook.xml.rels"] = _PKG + "".join(rels) + "</Relationships>"
    files["docProps/core.xml"] = _core(title)
    files["[Content_Types].xml"] = _CT + "</Types>"
    return _zip(files)


def odt_bytes(paras: list[str], title: str = "") -> bytes:
    T = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"'
    two = '<text:s text:c="2"/>'   # deux espaces : un élément text:s (OpenDocument § 6.1.3)
    body = "".join("<text:p>" + html.escape(p).replace("  ", two) + "</text:p>" for p in paras)
    return _zip({"mimetype": "application/vnd.oasis.opendocument.text",
                 "content.xml": f'<office:document-content {T}><office:body><office:text>{body}</office:text></office:body></office:document-content>',
                 "meta.xml": f'<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
                             f'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0">'
                             f'<office:meta><dc:title>{html.escape(title)}</dc:title><meta:document-statistic meta:page-count="1"/>'
                             f'</office:meta></office:document-meta>'})


def epub_bytes(chapters: list[tuple[str, str]], title: str = "", cover: bytes | None = None) -> bytes:
    files: dict[str, str | bytes] = {"mimetype": "application/epub+zip",
                                     "META-INF/container.xml": '<container><rootfiles><rootfile full-path="OEBPS/content.opf" '
                                                               'media-type="application/oebps-package+xml"/></rootfiles></container>'}
    man, spine = [], []
    for k, (h, body) in enumerate(chapters):
        files[f"OEBPS/ch{k + 1}.xhtml"] = (f'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{html.escape(h)}</title>'
                                           f'<style>p{{color:red}}</style></head><body><h1>{html.escape(h)}</h1><p>{html.escape(body)}</p></body></html>')
        man.append(f'<item id="c{k}" href="ch{k + 1}.xhtml" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="c{k}"/>')
    if cover:
        files["OEBPS/images/couverture.png"] = cover
        man.append('<item id="cov" href="images/couverture.png" media-type="image/png" properties="cover-image"/>')
    files["OEBPS/content.opf"] = (f'<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata '
                                  f'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{html.escape(title)}</dc:title></metadata>'
                                  f'<manifest>{"".join(man)}</manifest><spine>{"".join(spine)}</spine></package>')
    return _zip(files)


def fixtures() -> dict[str, bytes]:
    """Un document de chaque sorte, fabriqué ici : le contrôle et les essais de la page (tools/check.py, Playwright)."""
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (300, 420), (40, 90, 130)).save(buf, "PNG")
    cover = buf.getvalue()
    tif = BytesIO()
    Image.new("RGB", (640, 360), (200, 120, 40)).save(tif, "TIFF")
    gif = BytesIO()
    Image.new("P", (120, 80), 3).save(gif, "GIF", transparency=0)
    return {
        "dossier.pdf": pdf_bytes(["Synopsis : été 1925, Montparnasse.\nUn peintre et une danseuse.", "Page deux : le décor, la Rotonde."],
                                 title="Dossier de production"),
        "scan.pdf": pdf_bytes(["", ""], title="Scan"),
        "note.docx": docx_bytes(["Note d'intention", "Le film suit Kiki de Montparnasse.¶Deuxième page, après le saut.",
                                 "Rôle|Comédien|Jours"], title="Note d'intention", pages=2),
        "pitch.pptx": pptx_bytes([("Titre : Les Années folles", "Dire le contexte d'abord"), ("Casting\nKiki · Man Ray", ""),
                                  ("Budget", "Chiffres à vérifier")], title="Pitch"),
        "budget.xlsx": xlsx_bytes({"Budget": [["Poste", "Montant", "Validé"], ["Décors", 12500, True], ["Costumes", 8300.5, False],
                                              ["=Total en ligne", None, None]], "Planning": [["Jour", "Lieu"], [1, "La Rotonde"]]},
                                  title="Budget"),
        "traitement.odt": odt_bytes(["Traitement", "Scène 1  — le café."], title="Traitement"),
        "roman.epub": epub_bytes([("Chapitre un", "Il pleuvait sur Paris."), ("Chapitre deux", "Le soleil revint.")],
                                 title="Roman source", cover=cover),
        "lisez-moi.md": "# Bible de la série\n\nLes personnages, les lieux, *le ton*.\n".encode("utf-8"),
        "casting.csv": "nom;rôle\nKiki;danseuse\nMan Ray;photographe\n".encode("cp1252"),
        "page.html": ("<html><head><title>Article</title><script>alert(document.cookie)</script></head>"
                      "<body><h1>Un article</h1><p>Le Dôme &amp; la Coupole.</p></body></html>").encode("utf-8"),
        "lettre.rtf": (b"{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;}"
                       b"{\\*\\generator Essai;}\\f0 Ch\\'e8re Kiki,\\par Le tournage commence le 3 \\u8212? enfin.\\par}"),
        "donnees.xyz": bytes(range(256)) * 8,
        "photo.heic": b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + bytes(64),
        "affiche.tiff": tif.getvalue(),
        "anim.gif": gif.getvalue(),
    }


# ── le contrôle (tools/check.py) ─────────────────────────────
def selftest(call, ok) -> None:
    import os
    import urllib.error
    import urllib.request
    from urllib.parse import quote
    from PIL import Image

    base = f"http://127.0.0.1:{os.environ.get('SHOWRUNNER_PORT') or config.get('port')}"

    def head(path: str) -> tuple[int, dict, bytes]:
        try:
            with urllib.request.urlopen(base + path, timeout=30) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()

    fx = fixtures()
    up = {}
    for name, body in fx.items():
        st, it = call("PUT", f"/api/library/upload?name={quote(name)}&title={quote(Path(name).stem)}&tool=upload", raw=body)
        up[name] = it if st == 200 and isinstance(it, dict) else {}
        ok(st == 200, f"documents : {name} entre dans la bibliothèque ({st} {it if st != 200 else ''})")

    def texte(name: str) -> dict:
        st, t = call("GET", f"/api/library/{up[name].get('id', 'x')}/texte")
        return t if st == 200 and isinstance(t, dict) else {}

    poppler = bool(_tool("pdftotext"))
    # chaque format : sa sorte, son texte, sa vignette, ses pages
    for name, want, pages, unit in (
            ("note.docx", ["Kiki de Montparnasse", "Deuxième page", "Rôle\tComédien\tJours"], 2, "pages"),
            ("pitch.pptx", ["Les Années folles", "Notes : Dire le contexte d'abord", "Kiki · Man Ray"], 3, "diapositives"),
            ("budget.xlsx", ["Décors\t12500\tVRAI", "Costumes\t8300.5\tFAUX", "Total en ligne", "Planning", "La Rotonde"], 2, "feuilles"),
            ("traitement.odt", ["Scène 1 — le café"], 1, "pages"),
            ("roman.epub", ["Il pleuvait sur Paris.", "Le soleil revint."], 2, "chapitres"),
            ("lisez-moi.md", ["Bible de la série", "*le ton*"], 1, "pages"),
            ("casting.csv", ["Kiki;danseuse", "nom;rôle"], 1, "feuilles"),
            ("page.html", ["Le Dôme & la Coupole."], 1, "pages"),
            ("lettre.rtf", ["Chère Kiki,", "commence le 3 — enfin."], 1, "pages"),
            *([("dossier.pdf", ["Synopsis : été 1925, Montparnasse.", "la Rotonde"], 2, "pages")] if poppler else [])):
        it = up[name]
        t = texte(name)
        doc = it.get("doc") or {}
        ok(it.get("kind") == "document" and it.get("id", "").startswith("doc-") and doc.get("format") == Path(name).suffix[1:],
           f"documents : {name} est un document ({it.get('kind')} {doc.get('format')})")
        ok(all(w in t.get("text", "") for w in want) and doc.get("has_text") is True,
           f"documents : le texte de {name} ({[w for w in want if w not in t.get('text', '')]} manquent ; {t.get('text', '')[:120]!r})")
        ok(doc.get("pages") == pages and doc.get("unit") == unit and len(t.get("pages") or []) == pages,
           f"documents : {name}, {pages} {unit} ({doc.get('pages')} {doc.get('unit')}, {len(t.get('pages') or [])} pages de texte)")
        ok(bool(it.get("thumb_url")) and it.get("text_url") == f"api/library/{it.get('id')}/texte" and doc.get("words", 0) > 0,
           f"documents : {name} a sa vignette, son text_url, ses mots ({it.get('thumb_url')} {doc.get('words')})")
    ok(texte("page.html").get("text", "").find("alert") < 0 and (up["page.html"].get("doc") or {}).get("title") == "Article",
       "documents : une page HTML — ni son script dans le texte, son titre lu")
    ok(texte("note.docx").get("pages", [{}])[1].get("text", "").startswith("Deuxième page"),
       "documents : un DOCX — le saut de page rendu par Word fait la page 2")
    ok([p["text"].splitlines()[0] for p in texte("pitch.pptx").get("pages", [])] == ["Titre : Les Années folles", "Casting", "Budget"],
       "documents : un PPTX — les diapositives dans l'ordre de presentation.xml, pas des noms de fichiers")
    ok("ヨミ" not in texte("budget.xlsx").get("text", ""), "documents : un XLSX — la prononciation (rPh) n'est pas le texte")
    ok((up["roman.epub"].get("doc") or {}).get("title") == "Roman source" and up["roman.epub"].get("views") == [256],
       f"documents : un EPUB — son titre, sa couverture (300 × 420 : la copie 256) ({up['roman.epub'].get('views')})")
    # la vignette : la première page (poppler), sinon une carte dessinée aux jetons du thème
    d = library.folder_of(up["note.docx"].get("id", "x"))
    try:
        with Image.open(d / "cover.png") as im:
            from tools.ideation import tokens
            ok(im.size == CARD and im.getpixel((4, 4))[:3] == tokens()["panel"],
               f"documents : la carte dessinée d'un DOCX ({im.size}, le fond --panel)")
    except OSError as e:
        ok(False, f"documents : la carte d'un DOCX ({e})")
    if poppler:
        pd = up["dossier.pdf"]
        ok((pd.get("doc") or {}).get("rendered") == 2 and len((pd.get("doc") or {}).get("page_urls") or []) == 2
           and (pd.get("doc") or {}).get("title") == "Dossier de production" and pd.get("views") == [256, 512, 1024],
           f"documents : un PDF — ses pages rendues, son titre, sa couverture (poppler) ({pd.get('doc')} {pd.get('views')})")
        st, hd, b = head("/" + ((pd.get("doc") or {}).get("page_urls") or ["x"])[0])
        ok(st == 200 and b[:3] == b"\xff\xd8\xff", f"documents : une page rendue se sert ({st})")
        sc = up["scan.pdf"].get("doc") or {}
        ok(sc.get("has_text") is False and "OCR" in (sc.get("why") or "") and sc.get("pages") == 2 and not sc.get("needs_page"),
           f"documents : un PDF scanné — pas de texte, la fiche dit pourquoi ({sc})")
    else:
        ok(True, "documents : poppler absent ici — le PDF passe par la page (essayé plus bas)")

    # l'inconnu entre, tel quel ; une image exotique : PIL la lit → une image PNG, l'original gardé ; sinon un document
    xyz = up["donnees.xyz"]
    ok(xyz.get("kind") == "document" and (xyz.get("doc") or {}).get("has_text") is False and "XYZ" in (xyz.get("doc") or {}).get("why", "")
       and xyz.get("thumb_url"), f"documents : un fichier inconnu (.xyz) est rangé, avec sa carte ({xyz.get('kind')} {xyz.get('doc')})")
    st, hd, b = head("/" + xyz.get("url", "x"))
    ok(st == 200 and b == fx["donnees.xyz"], "documents : le fichier inconnu se télécharge tel quel")
    heic = up["photo.heic"]
    ok(heic.get("kind") == "document" and (heic.get("doc") or {}).get("format") == "heic",
       f"documents : un HEIC que PIL ne lit pas (sans greffon) est un document ({heic.get('kind')})")
    for name, size in (("affiche.tiff", [640, 360]), ("anim.gif", [120, 80])):
        im_ = up[name]
        orig = im_.get("original") or {}
        st, hd, b = head("/" + im_.get("url", "x"))
        st2, hd2, b2 = head("/" + orig.get("url", "x"))
        ok(im_.get("kind") == "image" and im_.get("file") == "main.png" and [im_.get("width"), im_.get("height")] == size
           and b[:4] == b"\x89PNG" and st2 == 200 and b2 == fx[name] and "attachment" in (hd2.get("Content-Disposition") or ""),
           f"documents : {name} → une image PNG, l'original gardé et téléchargeable ({im_.get('kind')} {im_.get('file')} {orig})")

    # la sécurité de service : rien de déposé ne s'affiche dans l'origine du portail s'il pourrait y exécuter quelque chose
    st, hd, b = head("/" + up["page.html"].get("url", "x"))
    ok(st == 200 and hd.get("Content-Type") == "application/octet-stream" and hd.get("Content-Disposition", "").startswith("attachment")
       and "sandbox" in (hd.get("Content-Security-Policy") or "") and hd.get("X-Content-Type-Options") == "nosniff",
       f"documents : une page HTML déposée part en téléchargement, sous un type neutre, en bac à sable ({hd.get('Content-Type')} "
       f"{hd.get('Content-Disposition')} {hd.get('Content-Security-Policy')})")
    ok("page.html" in unquote(hd.get("Content-Disposition", "")), "documents : le nom proposé est le titre de l'objet")
    st, hd, b = head("/" + up["lisez-moi.md"].get("url", "x"))
    ok(st == 200 and hd.get("Content-Type") == "text/plain; charset=utf-8" and "Content-Disposition" not in hd,
       f"documents : un texte se montre en text/plain ({hd.get('Content-Type')})")
    st, hd, b = head("/" + up["dossier.pdf"].get("url", "x"))
    ok(st == 200 and hd.get("Content-Type") == "application/pdf", f"documents : un PDF s'ouvre dans la visionneuse ({hd.get('Content-Type')})")
    st, hd, b = head("/" + up["note.docx"].get("url", "x"))
    ok(hd.get("Content-Type") == "application/octet-stream" and "attachment" in hd.get("Content-Disposition", ""),
       "documents : un DOCX se télécharge")
    st, hd, b = head("/" + up["note.docx"].get("thumb_url", "x"))
    ok(st == 200 and hd.get("Content-Type") == "image/jpeg" and "Content-Disposition" not in hd, "documents : sa vignette se montre")

    # la recherche, le filtre par sorte, la corbeille, le retour
    st, lst = call("GET", "/api/library?kind=document&q=production")
    ok(st == 200 and lst["counts"].get("document", 0) >= 10 and (not poppler or [i["id"] for i in lst["items"]] == [up["dossier.pdf"]["id"]]),
       f"documents : la sorte se filtre, le titre lu dans le document se cherche ({lst.get('counts', {}).get('document')} {lst.get('total')})")
    iid = up["casting.csv"].get("id", "x")
    st1, _ = call("POST", f"/api/library/{iid}/delete")
    st2, _ = call("GET", f"/api/library/{iid}/texte")
    st3, back = call("POST", f"/api/library/{iid}/restore")
    ok(st1 == 200 and st2 == 404 and st3 == 200 and texte("casting.csv").get("text", "").startswith("nom;rôle"),
       f"documents : la corbeille emporte le texte, le retour le rend ({st1} {st2} {st3})")
    st, _ = call("GET", f"/api/library/{up['affiche.tiff'].get('id')}/texte")
    ok(st == 404, f"documents : GET …/texte d'une image : 404 ({st})")

    # la voie de la page : poppler coupé, le PDF attend ce que le navigateur en lira (commun/documents.js)
    before = config.CFG.get("documents_poppler")
    config.CFG["documents_poppler"] = False
    try:
        st, pd = call("PUT", "/api/library/upload?name=sans-poppler.pdf&title=Sans%20poppler", raw=fx["dossier.pdf"])
    finally:
        if before is None:
            config.CFG.pop("documents_poppler", None)
        else:
            config.CFG["documents_poppler"] = before
    doc = (pd or {}).get("doc") or {}
    ok(st == 200 and doc.get("needs_page") is True and doc.get("has_text") is False and pd.get("thumb_url") and "navigateur" in doc.get("why", ""),
       f"documents : sans poppler, un PDF demande la page ({doc})")
    pid = pd.get("id", "x")
    buf = BytesIO()
    Image.new("RGB", (612, 792), (240, 240, 236)).save(buf, "PNG")
    thumb = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    st, bad = call("POST", f"/api/library/{pid}/texte", {"pages": [{"n": 1, "text": "x"}], "thumb": "data:image/png;base64,UEsDBA=="})
    ok(st == 400, f"documents : une vignette qui n'est pas un PNG est refusée ({st})")
    st, bad = call("POST", f"/api/library/{pid}/texte", {"pages": "texte"})
    ok(st == 400, f"documents : pages : une liste ({st})")
    st, got = call("POST", f"/api/library/{pid}/texte", {"pages": [{"n": 1, "text": "Synopsis : été 1925."}, {"n": 2, "text": "La Rotonde."}],
                                                         "thumb": thumb, "count": 2})
    gd = (got or {}).get("doc") or {}
    ok(st == 200 and gd.get("has_text") is True and gd.get("needs_page") is False and gd.get("via") == "page" and gd.get("pages") == 2
       and got.get("views") == [256, 512] and "été 1925" in texte_of(pid),
       f"documents : la page dépose le texte et la vignette qu'elle a lus ({st} {gd} {got.get('views') if isinstance(got, dict) else got})")
    st, again = call("POST", f"/api/library/{pid}/texte", {"pages": [{"n": 1, "text": "autre"}]})
    ok(st == 409 and "été 1925" in texte_of(pid), f"documents : un document qui a son texte ne se réécrit pas ({st})")
    st, nd = call("POST", f"/api/library/{up['affiche.tiff'].get('id')}/texte", {"pages": []})
    ok(st == 400, f"documents : POST …/texte d'une image : refusé ({st})")

    # le texte pour le serveur lui-même (l'agent) ; Idéation : un document se pose, sa couverture s'exporte
    ok("Kiki de Montparnasse" in (text_of(library.get(up["note.docx"].get("id", "x")) or {}) or "")
       and text_of(library.get(up["affiche.tiff"].get("id", "x")) or {}) is None,
       "documents : text_of(objet) rend le texte d'un document, None pour une image")
    try:
        from tools import ideation_agent
        hook = getattr(ideation_agent, "TEXTE_DOCUMENT", None)
    except ImportError:
        hook = None
    if callable(hook):
        got = hook(library.get(up["pitch.pptx"].get("id", "x")) or {})
        ok(isinstance(got, str) and "Les Années folles" in got, f"documents : l'agent lit le texte d'un PPTX ({str(got)[:80]!r})")
    _selftest_planche(call, ok, up)

    # qui peut écrire : l'auteur, un éditeur du Workspace ; un lecteur (guest viewer) lit sans écrire ; une autre Team ne voit rien
    _selftest_droits(ok, fx)


def texte_of(iid: str) -> str:
    it = library.get(iid)
    return "\n".join(p.get("text", "") for p in read_text(it).get("pages", [])) if it else ""


def _selftest_planche(call, ok, up) -> None:
    """Idéation (05/10) : un objet `media` de sorte `document` se pose, s'enregistre, et l'export PNG
    de la planche montre sa couverture (celle de l'EPUB : un aplat de couleur, qu'on retrouve)."""
    from PIL import Image
    st, meta = call("GET", "/api/ideation/meta")
    ok(st == 200 and "document" in (meta.get("media_kinds") or []), f"documents : Idéation pose des documents ({meta.get('media_kinds')})")
    ep, dx = up["roman.epub"], up["note.docx"]
    st, b = call("POST", "/api/ideation/boards", {"name": "Planche des documents"})
    bid = b.get("id", "x") if isinstance(b, dict) else "x"
    nodes = [{"id": "d1", "type": "media", "kind": "document", "item": ep.get("id"), "title": ep.get("title"), "x": 0, "y": 0, "w": 190, "h": 250},
             {"id": "d2", "type": "media", "kind": "document", "item": dx.get("id"), "title": dx.get("title"), "x": 230, "y": 0, "w": 190, "h": 250}]
    st, sv = call("POST", f"/api/ideation/boards/{bid}", {"nodes": nodes, "links": [], "base_rev": 1})
    st2, got = call("GET", f"/api/ideation/boards/{bid}")
    kinds = [(n.get("kind"), n.get("item")) for n in (got.get("nodes") if isinstance(got, dict) else []) if n.get("type") == "media"]
    ok(st == 200 and st2 == 200 and kinds == [("document", ep.get("id")), ("document", dx.get("id"))],
       f"documents : deux documents posés sur une planche, gardés ({st} {sv if st != 200 else ''} {kinds})")
    st, png = call("POST", f"/api/ideation/boards/{bid}/png", {})
    try:
        im = Image.open(BytesIO(png)).convert("RGB") if st == 200 and isinstance(png, bytes) else None
    except OSError:
        im = None
    near = lambda c, w=(40, 90, 130): all(abs(a - b_) <= 6 for a, b_ in zip(c, w))   # noqa: E731 — la couverture de roman.epub
    cols = (im.getcolors(1 << 22) or []) if im else []
    ok(im is not None and sum(k for k, c in cols if near(c)) > 400,
       f"documents : l'export PNG d'une planche montre la couverture d'un document ({st} {im.size if im else png[:80] if isinstance(png, bytes) else png})")
    call("POST", f"/api/ideation/boards/{bid}/delete")


def _selftest_droits(ok, fx) -> None:
    from tools.admin import essai_http as H
    before = {k: config.CFG.get(k) for k in ("auth", "equipes_guests_essai", "documents_poppler")}
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    err = lambda d: d.get("error", "") if isinstance(d, dict) else str(d)[:120]   # noqa: E731
    try:
        config.CFG["auth"] = True
        config.CFG["equipes_guests_essai"] = True
        config.CFG["documents_poppler"] = False
        auth.startup()
        with auth._lock:
            auth._hits.clear()
        _, _, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        H("POST", "/api/auth/enter", {"name": "Dora Docs"})
        H("POST", "/api/admin/requests/dora-docs/accept", cookie=cal, headers=same)
        H("POST", "/api/equipes/tea-nirvalab/membres", {"pseudo": "Dora Docs", "role": "member"}, cookie=cal, headers=same)   # un ami accepté n'a que sa My Team (Cal, 09/10) : Cal le met dans Nirvalab
        _, _, dora = H("POST", "/api/auth/enter", {"name": "Dora Docs"}, headers=same)
        H("POST", "/api/equipes/tea-nirvalab/membres", {"pseudo": "Vic Docs", "role": "guest", "guest": "viewer",
                                                         "spaces": ["esp-general"]}, cookie=cal, headers=same)
        _, _, vic = H("POST", "/api/auth/enter", {"name": "Vic Docs"}, headers=same)
        _, t2, _ = H("POST", "/api/equipes", {"name": "Documents Ailleurs"}, cookie=cal, headers=same)
        H("POST", f"/api/equipes/{(t2 or {}).get('id')}/membres", {"pseudo": "Yann Docs", "role": "member"}, cookie=cal, headers=same)
        _, _, yann = H("POST", "/api/auth/enter", {"name": "Yann Docs"}, headers=same)
        ok(bool(cal and dora and vic and yann), "documents, droits : Cal, Dora (amie), Vic (guest viewer), Yann (une autre Team) entrent")
        g = {**same, "X-SR-Espace": "esp-general"}
        s, pd, _ = H("PUT", "/api/library/upload?name=droits.pdf&title=Droits", raw=fx["dossier.pdf"], cookie=dora,
                     headers={**g, "Content-Type": "application/pdf"})
        pid = (pd or {}).get("id", "x") if isinstance(pd, dict) else "x"
        ok(s == 200 and (pd.get("doc") or {}).get("needs_page") is True and pd.get("owner") == "dora-docs",
           f"documents, droits : Dora dépose un PDF (sans poppler) ({s} {err(pd)})")
        body = {"pages": [{"n": 1, "text": "Lu par la page."}]}
        s1, d1, _ = H("GET", f"/api/library/{pid}/texte", cookie=vic, headers=g)
        s2, d2, _ = H("POST", f"/api/library/{pid}/texte", body, cookie=vic, headers=g)
        s3, d3, _ = H("GET", f"/api/library/{pid}/texte", cookie=yann, headers=same)
        s4, d4, _ = H("POST", f"/api/library/{pid}/texte", body, cookie=yann, headers=same)
        ok(s1 == 200 and s2 == 403 and s3 == 404 and s4 in (403, 404, 409),
           f"documents, droits : Vic (viewer) lit le texte mais n'écrit pas ; Yann ne le voit pas ({s1} {s2} {err(d2)[:80]} {s3} {s4})")
        s5, d5, _ = H("POST", f"/api/library/{pid}/texte", body, headers={**g, "Content-Type": "application/json"})
        ok(s5 == 401, f"documents, droits : sans session, 401 ({s5})")
        s6, d6, _ = H("POST", f"/api/library/{pid}/texte", body, cookie=dora, headers=g)
        ok(s6 == 200 and (d6.get("doc") or {}).get("has_text") is True, f"documents, droits : Dora dépose ce que sa page a lu ({s6} {err(d6)})")
    finally:
        for k, v in before.items():
            if v is None:
                config.CFG.pop(k, None)
            else:
                config.CFG[k] = v
