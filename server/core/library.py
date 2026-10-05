"""La bibliothèque « Asset » : tout ce que les outils fabriquent ou
reçoivent, rangé au même endroit et réutilisable partout.

Les sortes d'objets (KINDS) :

  image    un fichier image (PNG, JPEG, WEBP ; une image d'un autre format que PIL
           lit — TIFF, GIF, AVIF, PSD… — y entre en PNG, l'original gardé à côté)
  video    un fichier vidéo (MP4, WEBM, MOV)
  audio    un fichier son (WAV, MP3, FLAC, M4A, OGG)
  midi     un clip de notes ; sequence : une séquence du Montage (29/09)
  document tout le reste (05/10, server/tools/documents.py) : un PDF, un texte, un
           DOCX, un PPTX, un classeur, un EPUB, un fichier inconnu — rangé tel quel,
           avec son texte, sa couverture, ses pages ; servi en téléchargement quand
           l'afficher ne serait pas sûr (`serve_policy`)
  element  une entité réutilisable — un personnage, un objet, un lieu,
           un style — faite de références nommées (visage, plein pied,
           tenue…) et d'une description en prose. Un personnage de
           Character Factory devient un élément ; un élément s'appelle
           ensuite comme référence dans l'image, la vidéo H3, etc.

Sur disque, sous `<data_dir>/library/<id>/` : `item.json`, le fichier
principal, sa vignette, ses copies d'affichage (`view-256.webp`…, plus
bas) ; les références d'un élément y sont copiées, pour
qu'il ne dépende de rien d'autre. Une suppression met l'objet à la
corbeille (`<data_dir>/trash/`), d'où il peut revenir.

Chaque objet porte qui l'a fait (`origin.user`), posé ici d'après la
personne de la requête ou du travail en cours (core/auth.py) : les outils
n'ont rien à changer.

Teams et Workspaces (30/09, docs/etudes/equipes_espaces.md, étape 2) : chaque
objet porte aussi son Workspace (`space`), posé ici à sa naissance
(`new_space` : celui du travail qui le range, sinon celui de la requête),
jamais par la page ; les documents des outils (projet ODIO, transcription,
planche, LUT, analyse) le reçoivent par `stamp` et le gardent à chaque
réécriture (`keep`, OWNED). Qui voit, qui modifie, qui jette : le rôle de
la personne dans ce Workspace (auth.can_read_item / can_write_item /
can_trash_item, la matrice de core/espaces.py ; décision 9 : tout éditeur
modifie, la corbeille reste à l'auteur et aux admins du Workspace). Et un
outil n'atteint que son Workspace : dans une requête ou un travail, `get`,
`readable` et `query` ne rendent que les objets du Workspace courant — une
séquence de B ne pose pas une image de A, un rendu de B ne lit pas une
référence de A, par construction. Montrer tous les Workspaces (Asset, étape
5) passe par `see` et `query(spaces="*")`, qui ne servent qu'à montrer ;
s'en servir dans un autre Workspace, c'est le rapatrier (`rapatrier` : un objet
neuf, jamais un lien vivant, plus bas).

Les éléments versionnés (30/09, docs/etudes/apps_studio_elements.md) : un
élément « vivant » relie une source (un projet ODIO, une séquence, la
recette d'un objet) à ses versions, `element.versions` ; une version est un
objet ordinaire et immuable marqué `version: {of, n}`. Ici, ce que tout
lecteur doit savoir (la dernière version, le gel d'une version, le garde de
la corbeille) ; publier, les usages et le journal : server/tools/elements.py.
L'identité mondiale `uid` = `sr:<uuid de l'instance>/<id>` (package_export.md
§ 2.1) se déduit ; un objet reçu d'ailleurs garde la sienne dans `item.json`.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from . import auth, config, espaces

# "sequence" : une séquence du Montage (sa timeline dans `sequence.json`, écrite par server/tools/montage.py), 29/09
# "document" : tout ce qui n'est pas un média (server/tools/documents.py), 05/10
KINDS = ("image", "video", "audio", "element", "midi", "sequence", "document")
EXT_KIND = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image",
    ".mp4": "video", ".webm": "video", ".mov": "video", ".m4v": "video",
    ".wav": "audio", ".mp3": "audio", ".flac": "audio", ".m4a": "audio", ".ogg": "audio",
    # les clips MIDI d'ODIO (extraits d'un son, rangés depuis un motif, importés) : 29/09
    ".mid": "midi", ".midi": "midi",
}
# PIL ne lit que ces formats-là : sans cette liste, Image.open devine le format par
# le contenu, et un « .png » qui serait un EPS partirait vers Ghostscript (audit du 28/09, H2)
PIL_FORMATS = ("PNG", "JPEG", "WEBP")
# le nom d'un document rangé : `main.<ext>`, l'extension en minuscules, lettres et chiffres
DOC_EXT = re.compile(r"\.[a-z0-9]{1,10}")


def kind_of_name(name: str) -> str:
    """La sorte d'un fichier d'après son nom : un média (EXT_KIND), une image d'un autre format
    (« image », provisoire : PIL la lira-t-il ? add_file tranche), sinon un document."""
    from tools.documents import EXOTIC
    ext = Path(name).suffix.lower()
    return EXT_KIND.get(ext) or ("image" if ext in EXOTIC else "document")


def sniff(head: bytes, ext: str) -> bool:
    """Le contenu est-il bien ce que dit l'extension ? Les premiers octets
    (la « signature » de chaque format, lue dans sa spécification) : un fichier
    déposé qui n'est pas ce qu'il prétend n'entre pas — ni PIL ni ffmpeg ne
    devinent alors un autre format (un EPS, une liste de lecture HLS qui
    lirait des fichiers du disque) sous un nom sage."""
    ext = ext.lower()
    riff = head[:4] == b"RIFF"
    if ext == ".png":
        return head[:8] == b"\x89PNG\r\n\x1a\n"
    if ext in (".jpg", ".jpeg"):
        return head[:3] == b"\xff\xd8\xff"
    if ext == ".webp":
        return riff and head[8:12] == b"WEBP"
    if ext == ".wav":
        return riff and head[8:12] == b"WAVE"
    if ext in (".mp4", ".mov", ".m4v", ".m4a"):
        # ISO BMFF / QuickTime : une première boîte « ftyp » ; un vieux .mov commence par moov, mdat, wide, free
        return head[4:8] in (b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip", b"pnot")
    if ext == ".webm":
        return head[:4] == b"\x1a\x45\xdf\xa3"   # EBML
    if ext == ".flac":
        return head[:4] == b"fLaC" or head[:3] == b"ID3"
    if ext == ".ogg":
        return head[:4] == b"OggS"
    if ext == ".mp3":
        # une étiquette ID3v2, ou directement une trame MPEG (11 bits de synchronisation)
        return head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0)
    if ext in (".mid", ".midi"):
        return head[:4] == b"MThd"
    return False


ELEMENT_TYPES = ("character", "object", "place", "style", "other")
# les sortes d'un élément versionné, en plus des planches (une chanson, un son,
# une séquence, une image) ; à part pour que les pages qui font des planches
# (Idéation lit ELEMENT_TYPES) ne changent pas
VERSIONED_TYPES = ("music", "sound", "sequence", "picture")
ELEMENT_TYPES_ALL = ELEMENT_TYPES + VERSIONED_TYPES
AUDIO_EXT = tuple(e for e, k in EXT_KIND.items() if k == "audio")   # la voix d'un élément
THUMB = 384

_lock = threading.RLock()
_items: dict[str, dict] = {}
_loaded = False


def root() -> Path:
    p = config.data_dir() / "library"
    p.mkdir(parents=True, exist_ok=True)
    return p


def trash_root() -> Path:
    p = config.data_dir() / "trash"
    p.mkdir(parents=True, exist_ok=True)
    return p


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(kind: str) -> str:
    return f"{kind[:3]}-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"


def _load() -> None:
    global _loaded
    with _lock:
        if _loaded:
            return
        for f in root().glob("*/item.json"):
            try:
                it = json.loads(f.read_text(encoding="utf-8"))
                _items[it["id"]] = it
            except (ValueError, KeyError):
                continue
        _loaded = True


def _save(it: dict) -> None:
    d = root() / it["id"]
    d.mkdir(parents=True, exist_ok=True)
    if not it.get("space"):
        # le seul écrivain d'item.json : un objet n'y est jamais « sans Workspace ». Un
        # objet d'avant (sans le champ) garde celui qu'il avait déjà (space_of : Général) ;
        # un neuf qu'un outil aurait rangé sans passer par add_file : celui de sa naissance
        it["space"] = space_of(it) if (d / "item.json").exists() else new_space(it.get("origin"), check=False)
    tmp = d / "item.json.tmp"
    tmp.write_text(json.dumps(it, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(d / "item.json")


def folder_of(item_id: str) -> Path:
    return root() / item_id


# ── l'instance : l'identité mondiale d'un objet ─────────────
_instance: dict | None = None


def instance() -> dict:
    """`<data_dir>/instance.json` : un UUID tiré une fois (uuid4), un nom lisible
    (docs/etudes/package_export.md § 2.1). Écrit au premier besoin, jamais réécrit."""
    global _instance
    f = config.data_dir() / "instance.json"
    if _instance is not None and _instance.get("_file") == str(f):
        return _instance
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
        uuid.UUID(str(d.get("uuid")))
    except (OSError, ValueError, AttributeError, TypeError):
        d = {"uuid": str(uuid.uuid4()), "name": "Showrunner", "created": now()}
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        if not f.exists():          # deux fils au premier démarrage : le premier écrit gagne
            tmp.replace(f)
        else:
            tmp.unlink(missing_ok=True)
            d = json.loads(f.read_text(encoding="utf-8"))
    _instance = {**d, "_file": str(f)}
    return _instance


def uid_of(it: dict) -> str:
    """`sr:<uuid de l'instance>/<id local>` ; un objet reçu d'ailleurs garde le sien."""
    return it.get("uid") or f"sr:{instance()['uuid']}/{it['id']}"


# ── les éléments versionnés : ce que tout lecteur doit savoir ─
def is_living(it: dict | None) -> bool:
    """Un élément qui a des versions (`element.versions`), par opposition à une planche."""
    return bool(it) and it.get("kind") == "element" and isinstance((it.get("element") or {}).get("versions"), list)


def head_entry(it: dict | None) -> dict | None:
    """La dernière version d'un élément : prête (pas retirée) et présente (pas à
    la corbeille). Calculée à chaque lecture, jamais rangée : elle ne peut pas
    mentir quand une version part à la corbeille ou en revient."""
    if not is_living(it):
        return None
    _load()
    for v in reversed(it["element"]["versions"]):
        if v.get("state", "ready") == "ready" and v.get("item") in _items:
            return v
    return None


def resolve(it: dict | None) -> dict | None:
    """Ce qu'un outil doit lire d'un objet : lui-même, ou la dernière version d'un
    élément vivant (None s'il n'en a pas encore)."""
    if not is_living(it):
        return it
    h = head_entry(it)
    return _items.get(h["item"]) if h else None


def _frozen(it: dict, what: str) -> None:
    """Une version publiée ne change pas (juste par construction : un usage pointe
    un fichier que rien ne réécrit). Titre, dossier, tags, favori restent libres."""
    v = it.get("version")
    if isinstance(v, dict) and v.get("of"):
        raise PermissionError(f"« {it.get('title') or it['id']} » est la v{v.get('n')} d'un élément : une version publiée "
                              f"ne change pas ({what}) — publie une nouvelle version")


# la corbeille demande d'abord à chacun (server/tools/elements.py : une version
# utilisée ne part pas) ; un garde lève une erreur qui dit pourquoi
TRASH_GUARDS: list = []


# ── à qui, dans quel Workspace ──────────────────────────────
# ce qu'un document d'outil tient du serveur et garde à chaque réécriture, quoi que
# la page envoie (music.save_project…) : son auteur, son partage, son origine, son Workspace
OWNED = ("owner", "shared", "origin", "space")


def _owned(origin: dict) -> dict:
    """`origin.user` : la personne de la requête, ou du travail qui range."""
    out = dict(origin)
    uid = auth.current_id()
    if uid and not out.get("user"):
        out["user"] = uid
    return out


def space_of(doc: dict | None) -> str | None:
    """Le Workspace d'un objet ou d'un document ; sans le champ : l'espace par défaut
    de l'instance (Général), jamais « sans Workspace » (core/espaces.py)."""
    return auth.space_of(doc)


def here() -> str | None:
    """Le Workspace de la requête (posé par la porte), ou du travail en cours (posé par
    la file le temps du `run`) ; None : le socle, ou un invité de planche."""
    return auth.current_space()


def in_here(doc: dict | None) -> bool:
    """Le document est-il du Workspace courant ? Sans Workspace courant : oui."""
    h = here()
    return not h or space_of(doc) == h


def check_create(space: str | None) -> None:
    """Créer dans ce Workspace (planche, séquence, projet, dépôt de fichier) : la
    matrice, `create` (un lecteur, un commentateur, un guest viewer : non).
    PermissionError (403) qui dit pourquoi et à qui demander. Le socle : oui."""
    u = auth.current()
    if u is None or (auth.is_admin(u) and espaces.space(space) is None):
        return   # le socle ; Cal hors de tout Workspace connu (teams.json absent ou illisible)
    ok, why = espaces.judge(u, space, "create")
    if not ok:
        raise PermissionError(f"créer dans ce Workspace : {why}")


def new_space(origin: dict | None = None, *, source: dict | None = None, check: bool = True) -> str | None:
    """Le Workspace d'un objet ou d'un document neuf (equipes_espaces.md § 2.3) : celui
    du document source s'il y en a un ; celui du travail qui le range (`origin.job`,
    ctx.add), jamais celui de la page ; sinon celui de la requête ; sinon (le socle)
    l'espace par défaut de son auteur. `check` : la personne peut-elle y créer."""
    s = space_of(source) if source is not None else None
    jid = (origin or {}).get("job")
    if not s and jid:
        from . import jobs
        s = (jobs.get(str(jid)) or {}).get("space")
    s = s or here() or space_of({"origin": {"user": (origin or {}).get("user") or auth.current_id()}})
    if check:
        check_create(s)
    return s


def stamp(doc: dict, *, source: dict | None = None) -> dict:
    """Un document d'outil neuf (projet ODIO, transcription, LUT, analyse…) : son
    auteur (`owner`, la personne de la requête ou du travail) et son Workspace
    (`space`, new_space), posés ici, jamais par la page. PermissionError (403) si la
    personne ne peut pas créer dans ce Workspace. Rend le document."""
    doc["space"] = new_space(source=source)
    uid = auth.current_id()
    if uid and not doc.get("owner"):
        doc["owner"] = uid
    return doc


def keep(new: dict, cur: dict) -> dict:
    """Une réécriture d'un document d'outil : ce qu'il tient du serveur (OWNED) reste
    celui du document enregistré, quoi que la page envoie ; son Workspace aussi (un
    document d'avant, sans le champ : celui qu'il avait déjà, space_of)."""
    for k in OWNED:
        new.pop(k, None)
        if k in cur:
            new[k] = cur[k]
    new["space"] = space_of(cur)
    return new


def _refusal(it: dict, what: str) -> str:
    u = auth.current()
    name = f"« {it.get('title') or it.get('name') or it.get('nom') or it.get('id') or '?'} »"
    if not auth.is_guest(u) and auth.can_read_item(it, u):
        ok, why = espaces.judge(u, space_of(it), "edit")
        if not ok:   # le rôle dans ce Workspace (lecteur, commentateur, guest viewer, archivé)
            return f"{name} : {why}"
    owner = auth.display_name(auth.owner_of(it)) or auth.admin_name()
    if what == "trash":
        return (f"{name} est à {owner} : seul·e {owner} (ou un admin du Workspace) peut le mettre à la corbeille "
                "ou l'en sortir")
    who = owner if owner == auth.admin_name() else f"{owner} (ou {auth.admin_name()})"
    return f"{name} est à {owner} : seul·e {who} peut le modifier"


def check_write(it: dict) -> None:
    """Le juge de toute écriture : un objet de la bibliothèque, ou un document
    d'outil qui porte son propriétaire et son Workspace de la même façon
    (`origin.user` ou `owner`, `space` : un projet ODIO…). Un éditeur de son
    Workspace (décision 9 : dans un Workspace partagé, tout éditeur modifie ; un
    guest acteur aussi ; un lecteur, un guest viewer, jamais) ; Cal, tout.
    PermissionError → 403, qui dit pourquoi."""
    if not auth.can_write_item(it, auth.current()):
        raise PermissionError(_refusal(it, "edit"))


def check_trash(it: dict) -> None:
    """Le juge de la corbeille (y mettre, en sortir) : l'auteur s'il peut modifier dans
    ce Workspace, un admin du Workspace, Cal (espaces.can_trash_doc). Un objet sans
    auteur (d'avant la porte) : les admins seulement."""
    if not auth.can_trash_item(it, auth.current()):
        raise PermissionError(_refusal(it, "trash"))


_check_write = check_write   # le nom d'avant (montage.py)


def visible(it: dict) -> bool:
    """Voir l'objet, tous Workspaces confondus : pour MONTRER seulement (Asset, une
    vignette). Un outil qui s'en sert lit par `readable` / `get`."""
    return auth.can_read_item(it, auth.current())


def readable(it: dict) -> bool:
    """Lire pour s'en servir : visible, et du Workspace courant — les listes de
    documents des outils (ODIO, transcriptions…) passent par ici : elles sont par
    Workspace, par construction."""
    return in_here(it) and visible(it)


def readable_path(rel: str) -> bool:
    """Le juge des fichiers servis sous /library/ : `<id>/<fichier>` — montrer (une
    vignette d'un autre Workspace qu'on voit se montre ; un outil n'y lit rien)."""
    return see(rel.split("/", 1)[0]) is not None


# ── les médias ──────────────────────────────────────────────
def probe(path: Path) -> dict:
    """Taille, durée d'un média (PIL pour les images, ffprobe sinon)."""
    kind = EXT_KIND.get(path.suffix.lower())
    if kind == "image":
        try:
            from PIL import Image
            with Image.open(path, formats=PIL_FORMATS) as im:
                return {"width": im.width, "height": im.height}
        except Exception:
            return {}
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
                              str(path)], capture_output=True, text=True, timeout=30)
        info = json.loads(out.stdout or "{}")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {}
    meta: dict = {}
    dur = (info.get("format") or {}).get("duration")
    if dur:
        meta["duration"] = round(float(dur), 3)
    for s in info.get("streams", []):
        if s.get("codec_type") == "video" and "width" not in meta:
            meta.update(width=s.get("width"), height=s.get("height"))
            rate = s.get("avg_frame_rate") or s.get("r_frame_rate") or ""
            if "/" in rate:
                a, b = rate.split("/")
                if float(b or 0):
                    meta["fps"] = round(float(a) / float(b), 3)
        if s.get("codec_type") == "audio":
            meta["audio"] = True
    return meta


def make_thumb(src: Path, dest: Path, kind: str) -> bool:
    try:
        if kind == "image":
            from PIL import Image
            with Image.open(src, formats=PIL_FORMATS) as im:
                im = im.convert("RGB")
                im.thumbnail((THUMB, THUMB))
                im.save(dest, "JPEG", quality=84)
            return True
        if kind == "video":
            r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "0.5", "-i", str(src), "-frames:v", "1",
                                "-vf", f"scale={THUMB}:-2", str(dest)], capture_output=True, timeout=60)
            if r.returncode != 0 or not dest.exists():
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-frames:v", "1",
                                "-vf", f"scale={THUMB}:-2", str(dest)], capture_output=True, timeout=60)
            return dest.exists()
    except Exception:
        return False
    return False


# ── les copies d'affichage ──────────────────────────────────
# docs/etudes/ideation_fluidite.md (§ 3.3, § 4.1) : une image, et l'affiche
# d'une vidéo, ont des copies WebP de 256, 512, 1024 et 2048 px de grand
# côté — jamais plus grandes que l'original. La page prend la plus petite
# qui couvre la taille où elle est vue × la densité de l'écran
# (commun/proxies.js), l'original seulement au-delà. WebP q82 : 26 à 38 %
# plus léger que le JPEG à qualité voisine (mesuré, § 3.3), et il garde
# l'alpha d'une image détourée. Faites à l'entrée (`add_file`) ; celles des
# objets rangés avant, par le travail `library.views` (voie cpu).
VIEW_SIZES = (256, 512, 1024, 2048)
VIEW_QUALITY = 82
VIEW_KINDS = ("image", "video")
# une copie ne change jamais sous son adresse (`?v=` change avec elle) : gardée
# un an. « private » : un cache partagé (la porte Cloudflare, un jour) ne la
# servirait pas à quelqu'un que `visibility` n'autorise pas à la voir
VIEW_CACHE = "private, max-age=31536000, immutable"
VIEW_RE = re.compile(r"^view-(\d+)\.webp$")


def view_name(w: int) -> str:
    return f"view-{w}.webp"


def make_views(src, d: Path) -> list[int]:
    """Les copies d'une image (un chemin, ou des octets lus) dans le dossier
    `d`, chacune tirée de la précédente : un seul décodage de l'original (un
    JPEG se décode déjà réduit). Tournées comme le navigateur montre
    l'original (EXIF). Rend les tailles faites, de la plus petite à la plus
    grande ; une copie d'avant qui n'a plus lieu d'être s'en va."""
    from PIL import Image, ImageOps
    with Image.open(BytesIO(src) if isinstance(src, bytes) else src, formats=PIL_FORMATS) as im:
        big = max(im.size)
        sizes = [s for s in VIEW_SIZES if s <= big]
        if not sizes or im.mode.startswith(("I", "F")):   # trop petite, ou 16 bits / flottante : l'original sert
            return []
        im.draft("RGB", (max(1, im.width * sizes[-1] // big), max(1, im.height * sizes[-1] // big)))
        alpha = im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info
        cur = ImageOps.exif_transpose(im).convert("RGBA" if alpha else "RGB")
    made = []
    for s in reversed(sizes):
        cur.thumbnail((s, s), Image.LANCZOS)
        tmp = d / f".{view_name(s)}.tmp"
        cur.save(tmp, "WEBP", quality=VIEW_QUALITY, method=4)
        tmp.replace(d / view_name(s))   # jamais une copie à moitié écrite sous son nom
        made.append(s)
    for p in d.glob("view-*.webp"):
        m = VIEW_RE.match(p.name)
        if m and int(m.group(1)) not in made:
            p.unlink(missing_ok=True)
    return sorted(made)


def _poster_frame(src: Path) -> bytes | None:
    """Une image de la vidéo à sa taille (celle de la vignette : 0,5 s, sinon la première), en PNG."""
    for pre in (["-ss", "0.5"], []):
        r = subprocess.run(["ffmpeg", "-v", "error", *pre, "-i", str(src), "-frames:v", "1", "-f", "image2pipe",
                            "-vcodec", "png", "-"], capture_output=True, timeout=120)
        if r.returncode == 0 and r.stdout:
            return r.stdout
    return None


def build_views(kind: str, src: Path, d: Path) -> list[int]:
    """Les copies d'une image, ou de l'affiche d'une vidéo ; [] si rien ne s'y
    prête (le fichier illisible le dit dans le journal, la page prend l'original)."""
    try:
        if kind == "image":
            return make_views(src, d)
        if kind == "video":
            frame = _poster_frame(src)
            return make_views(frame, d) if frame else []
    except Exception as e:
        print(f"copies d'affichage : {src} : {type(e).__name__}: {e}", file=sys.stderr, flush=True)
    return []


def _views_v() -> str:
    """La version des copies d'un objet : elle change à chaque fois qu'on les refait."""
    return secrets.token_hex(4)


def ensure_views(item_id: str, force: bool = False) -> list[int] | None:
    """Les copies d'un objet déjà rangé (le rattrapage). Rend ses tailles, ou
    None : il n'en prend pas, il les a déjà, il a disparu entre-temps."""
    it = get(item_id)
    if not it or it["kind"] not in VIEW_KINDS or not it.get("file") or ("views" in it and not force):
        return None
    d = folder_of(item_id)
    views = build_views(it["kind"], d / it["file"], d)
    with _lock:
        cur = _items.get(item_id)
        if cur is None or not d.is_dir():   # mis à la corbeille pendant qu'on les faisait
            return None
        cur["views"], cur["views_v"] = views, _views_v()
        _save(cur)
    return views


def missing_views(everything: bool = False) -> list[str]:
    """Les images et les vidéos rangées avant leurs copies d'affichage (ou
    toutes, pour les refaire)."""
    _load()
    with _lock:
        return [i for i, it in _items.items()
                if it["kind"] in VIEW_KINDS and it.get("file") and (everything or "views" not in it)]


def view_path(it: dict, w: int) -> Path | None:
    """Ce que sert `GET /api/library/<id>/view?w=` : la copie de cette taille,
    ou la plus proche au-dessus ; sinon l'original d'une image, la plus
    grande copie de l'affiche d'une vidéo, ou la vignette."""
    d = folder_of(it["id"])
    have = [s for s in sorted(it.get("views") or []) if (d / view_name(s)).is_file()]
    up = [s for s in have if s >= w]
    if up:
        return d / view_name(up[0])
    if it["kind"] == "image" and it.get("file"):
        return d / it["file"]
    if have:
        return d / view_name(have[-1])
    return d / it["thumb"] if it.get("thumb") else None


def cache_policy(rel: str, req) -> str | None:
    """La politique de cache de /library/ (core/http.py, `mount(…, cache=)`) :
    une copie d'affichage demandée à son adresse versionnée se garde un an ;
    le reste se revalide (ETag, 304)."""
    return VIEW_CACHE if VIEW_RE.match(rel.rsplit("/", 1)[-1]) and req.q("v") else None


# ── servir sans danger ce qu'on a déposé ────────────────────
# Les fichiers de la bibliothèque se servent depuis l'origine du portail : une page HTML,
# un SVG, un XML déposés y exécuteraient leurs scripts (ils liraient la session, écriraient
# au nom de qui les ouvre). Juste par construction : seuls les types d'une liste fermée
# s'affichent ; tout le reste part en téléchargement (`attachment`), sous un type neutre
# (`application/octet-stream` ; X-Content-Type-Options: nosniff est posé partout, core/http.py),
# avec une CSP `sandbox` — même ouvert à la main, rien ne s'y exécute. Un PDF s'ouvre dans la
# visionneuse du navigateur (elle ne donne pas l'origine à ses scripts) ; un texte en text/plain.
SAFE_INLINE = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".mov", ".m4v", ".wav", ".mp3", ".flac", ".m4a", ".ogg",
               ".mid", ".midi", ".json", ".glb"}
SAFE_TYPES = {".pdf": "application/pdf", **{e: "text/plain; charset=utf-8" for e in (
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".yaml", ".yml", ".log", ".srt", ".vtt")}}
SAFE_NAME = re.compile(r'[\x00-\x1f\x7f"\\/:*?<>|]+')


def serve_policy(rel: str):
    """Comment servir `<id>/<fichier>` (core/http.py, `mount(…, serve=)`) : None (tel quel, un type
    de la liste fermée), (type, {}) pour un PDF ou un texte, sinon (octet-stream, téléchargement,
    CSP sandbox) — le nom proposé : le titre de l'objet et l'extension du fichier."""
    from urllib.parse import quote
    iid, _, name = rel.partition("/")
    ext = Path(name).suffix.lower()
    if ext in SAFE_INLINE:
        return None
    if ext in SAFE_TYPES:
        return SAFE_TYPES[ext], {}
    it = _items.get(iid) or {}
    fn = (SAFE_NAME.sub("-", str(it.get("title") or iid)).strip(" .-") or "fichier")[:120] + ext
    return "application/octet-stream", {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fn)}",
                                        "Content-Security-Policy": "sandbox"}


# ── écrire ──────────────────────────────────────────────────
def add_file(src: Path, *, kind: str | None = None, title: str = "", origin: dict | None = None,
             prompt: str = "", params: dict | None = None, parents: list | None = None,
             tags: list | None = None, folder: str = "", move: bool = False, extra: dict | None = None) -> dict:
    """Range un fichier : une image, une vidéo, un son, un clip MIDI — ou, tout le reste, un
    document (05/10 : « tout ce dont il dispose », server/tools/documents.py). Une image d'un
    format que les outils ne lisent pas (TIFF, GIF, AVIF…) entre en PNG si PIL la lit, son
    original gardé à côté (`source.<ext>`, `original`) ; sinon elle est un document."""
    _load()
    src = Path(src)
    ext = src.suffix.lower()
    kind = kind or kind_of_name(src.name)
    if kind not in ("image", "video", "audio", "midi", "document"):
        raise ValueError(f"type de fichier non pris : {src.suffix}")
    png = None
    if kind == "image" and ext not in EXT_KIND:
        from tools import documents
        png = documents.as_png(src, ext)
        if png is None:   # PIL ne la lit pas (HEIC sans son greffon, un fichier abîmé) : un document, rangé tel quel
            kind = "document"
    org = _owned(origin or {"tool": "upload"})
    space = new_space(org)   # avant de rien copier : qui ne peut pas créer ici ne laisse rien derrière lui
    iid = new_id(kind)
    d = folder_of(iid)
    d.mkdir(parents=True, exist_ok=True)
    fmt = ext[1:] if DOC_EXT.fullmatch(ext) else ""
    more: dict = {}
    try:
        if png is not None:
            name = "main.png"
            (d / name).write_bytes(png)
            (shutil.move if move else shutil.copyfile)(str(src), str(d / f"source.{fmt}"))
            from tools import documents
            more["original"] = {"file": f"source.{fmt}", "format": documents.EXOTIC[ext]}
        else:
            name = "main" + (f".{fmt}" if kind == "document" and fmt else ".bin" if kind == "document" else ext)
            (shutil.move if move else shutil.copyfile)(str(src), str(d / name))
        it = {
            "id": iid, "kind": kind, "title": title or src.stem, "created": now(), "updated": now(),
            "file": name, "origin": org, "prompt": prompt, "params": params or {},
            "parents": list(parents or []), "tags": list(tags or []), "folder": folder, "fav": False,
            **(probe(d / name) if kind != "document" else {}), **more,
            **{k: v for k, v in (extra or {}).items() if k != "space"}, "space": space,
        }
        if kind == "document":   # son texte, sa couverture, ses pages (server/tools/documents.py)
            from tools import documents
            it.update(documents.ingest(d, name, fmt, it["title"]))
    except BaseException:
        shutil.rmtree(d, ignore_errors=True)
        raise
    if kind != "document" and make_thumb(d / name, d / "thumb.jpg", kind):
        it["thumb"] = "thumb.jpg"
    if kind == "audio":   # le visuel du son (server/tools/apercu_son.py)
        from tools import apercu_son; apercu_son.soon(d / name, it.get("duration"))
    if kind in VIEW_KINDS:   # les copies d'affichage, avant que la page ne la voie
        it["views"], it["views_v"] = build_views(kind, d / name, d), _views_v()
    if kind == "video":   # la copie de défilement, à la suite (server/tools/defilement.py, commun/lecteur.js)
        from tools import defilement; defilement.soon(d / name, it.get("duration"))
    with _lock:
        _items[iid] = it
        _save(it)
    return it


def _add_voice(d: Path, voices: list, src: Path, label: str = "", item: str | None = None) -> dict:
    """Une voix d'élément (rôle « voice ») : un son copié dans son dossier,
    avec sa durée, sans vignette. Elle vit dans `element.voices`, à côté des
    images de `element.refs` : les outils lisent `refs` comme des images."""
    n = 1 + max([int(v["file"][6:8]) for v in voices if v["file"][6:8].isdigit()] or [0])
    name = f"voice-{n:02d}{src.suffix.lower()}"
    shutil.copyfile(src, d / name)
    v = {"file": name, "role": "voice", "label": label or "voix", **probe(d / name)}
    from tools import apercu_son; apercu_son.soon(d / name, v.get("duration"), voice=True)   # le visuel du son
    if item:
        v["item"] = item
    voices.append(v)
    return v


def create_element(title: str, etype: str = "character", description: str = "", refs: list | None = None,
                   source: dict | None = None, tags: list | None = None, folder: str = "") -> dict:
    """Un élément : `refs` = [{item: id | path: Path, role: "face"…, label?}]. Chaque
    référence est copiée dans le dossier de l'élément."""
    _load()
    if etype not in ELEMENT_TYPES:
        raise ValueError(f"sorte d'élément inconnue : {etype} ({', '.join(ELEMENT_TYPES)})")
    org = _owned({"tool": (source or {}).get("tool", "asset")})
    space = new_space(org)
    iid = new_id("element")
    d = folder_of(iid)
    d.mkdir(parents=True, exist_ok=True)
    out_refs = []
    voices: list = []
    for k, r in enumerate(refs or []):
        if r.get("item"):
            src_it = get(r["item"])
            if not src_it or src_it["kind"] not in ("image", "audio"):
                raise ValueError(f"référence introuvable, ni image ni son : {r['item']}")
            src = folder_of(src_it["id"]) / src_it["file"]
        else:
            src = Path(r["path"])
        if not src.exists():
            raise ValueError(f"référence absente : {src}")
        if EXT_KIND.get(src.suffix.lower()) == "audio":
            _add_voice(d, voices, src, r.get("label", ""), r.get("item"))
            continue
        name = f"ref-{k + 1:02d}{src.suffix.lower()}"
        shutil.copyfile(src, d / name)
        ref = {"file": name, "role": r.get("role", ""), "label": r.get("label", "")}
        if r.get("item"):
            ref["item"] = r["item"]
        if make_thumb(d / name, d / f"ref-{k + 1:02d}.thumb.jpg", "image"):
            ref["thumb"] = f"ref-{k + 1:02d}.thumb.jpg"
        ref.update(probe(d / name))
        out_refs.append(ref)
    it = {
        "id": iid, "kind": "element", "title": title or "élément", "created": now(), "updated": now(),
        "origin": org, "space": space, "tags": list(tags or []), "folder": folder,
        "fav": False, "parents": [r["item"] for r in out_refs + voices if r.get("item")],
        "element": {"type": etype, "description": description, "refs": out_refs, "source": source or {},
                    **({"voices": voices} if voices else {})},
    }
    if out_refs and out_refs[0].get("thumb"):
        it["thumb"] = out_refs[0]["thumb"]
    with _lock:
        _items[iid] = it
        _save(it)
    return it


def create_living(title: str, etype: str, source: dict, *, media: str | None = None, folder: str = "",
                  tags: list | None = None, description: str = "") -> dict:
    """Un élément versionné, encore sans version : sa source, sa pile vide. Les
    versions s'y rangent par server/tools/elements.py (`publish`)."""
    _load()
    if etype not in ELEMENT_TYPES_ALL:
        raise ValueError(f"sorte d'élément inconnue : {etype} ({', '.join(ELEMENT_TYPES_ALL)})")
    org = _owned({"tool": source.get("tool", "asset")})
    space = new_space(org)
    iid = new_id("element")
    folder_of(iid).mkdir(parents=True, exist_ok=True)
    it = {
        "id": iid, "kind": "element", "title": (title or "élément")[:200], "created": now(), "updated": now(),
        "origin": org, "space": space, "tags": list(tags or []), "folder": folder, "fav": False,
        "parents": [], "element": {"type": etype, "description": description, "refs": [], "source": source,
                                   "media": media, "versions": []},
    }
    with _lock:
        _items[iid] = it
        _save(it)
    return it


LRC_MAX = 100000   # les paroles calées d'un son (champ `lrc`) : 157 lignes d'AGOSTA font 8 Ko


def _check_patch(patch: dict) -> None:
    """La forme de ce qu'une page peut changer (ValueError → 400) : rien
    d'autre qu'un texte, une liste de textes, un booléen, là où on les attend."""
    if not isinstance(patch, dict):
        raise ValueError("un objet JSON est attendu")
    for k, hi in (("title", 200), ("folder", 60), ("prompt", 20000)):
        if k in patch and not (isinstance(patch[k], str) and len(patch[k]) <= hi):
            raise ValueError(f"{k} : un texte de {hi} signes au plus")
    if "folder" in patch and "/" in patch["folder"]:
        raise ValueError("un dossier ne se range pas dans un autre : pas de « / » dans son nom")
    if "tags" in patch and not (isinstance(patch["tags"], list) and len(patch["tags"]) <= 64
                                and all(isinstance(t, str) and len(t) <= 40 for t in patch["tags"])):
        raise ValueError("tags : une liste de 64 textes de 40 signes au plus")
    for k in ("fav", "shared"):
        if k in patch and not isinstance(patch[k], bool):
            raise ValueError(f"{k} : vrai ou faux")
    # les paroles calées d'un son, en LRC (server/tools/paroles.py les relit et les remet au format)
    if "lrc" in patch and not (isinstance(patch["lrc"], str) and len(patch["lrc"]) <= LRC_MAX):
        raise ValueError(f"lrc : un texte de {LRC_MAX} signes au plus")
    el = patch.get("element")
    if isinstance(el, dict):
        if "type" in el and el["type"] not in ELEMENT_TYPES_ALL:
            raise ValueError(f"sorte d'élément inconnue : {el['type']} ({', '.join(ELEMENT_TYPES_ALL)})")
        if "description" in el and not (isinstance(el["description"], str) and len(el["description"]) <= 20000):
            raise ValueError("description : un texte de 20000 signes au plus")


def update(item_id: str, patch: dict) -> dict:
    _load()
    with _lock:
        it = _items.get(item_id)
        if not it or not readable(it):   # un objet d'un autre Workspace n'existe pas ici
            raise KeyError(item_id)
        _check_write(it)
        _check_patch(patch)
        if "lrc" in patch and it["kind"] != "audio":
            raise ValueError("des paroles calées (lrc) ne vont qu'à un son")
        if "prompt" in patch or isinstance(patch.get("element"), dict):
            _frozen(it, "sa recette, sa planche")
        el_patch = patch.get("element") if isinstance(patch.get("element"), dict) else {}
        if "type" in el_patch and el_patch["type"] not in (ELEMENT_TYPES_ALL if is_living(it) else ELEMENT_TYPES):
            raise ValueError(f"sorte d'élément inconnue pour une planche : {el_patch['type']} ({', '.join(ELEMENT_TYPES)})")
        for k in ("title", "tags", "folder", "fav", "prompt"):
            if k in patch:
                it[k] = patch[k]
        if "shared" in patch:
            it["shared"] = bool(patch["shared"])
        if "lrc" in patch:
            if patch["lrc"].strip():
                it["lrc"] = patch["lrc"]
            else:
                it.pop("lrc", None)
        if it["kind"] == "element" and isinstance(patch.get("element"), dict):
            el = it["element"]
            for k in ("type", "description"):
                if k in patch["element"]:
                    el[k] = patch["element"][k]
            # rôles et libellés des références ; l'ordre donné est gardé
            if isinstance(patch["element"].get("refs"), list):
                by_file = {r["file"]: r for r in el["refs"]}
                new = []
                for r in patch["element"]["refs"]:
                    old = by_file.get(r.get("file"))
                    if old:
                        new.append({**old, "role": r.get("role", old.get("role", "")),
                                    "label": r.get("label", old.get("label", ""))})
                el["refs"] = new
                if new and new[0].get("thumb"):
                    it["thumb"] = new[0]["thumb"]
        it["updated"] = now()
        _save(it)
        return it


def add_ref(item_id: str, src: Path, role: str = "", label: str = "", from_item: str | None = None) -> dict:
    """Ajoute une référence à un élément."""
    _load()
    with _lock:
        it = _items.get(item_id)
        if not it or it["kind"] != "element" or not readable(it):
            raise KeyError(item_id)
        _check_write(it)
        _frozen(it, "ses références")
        d = folder_of(item_id)
        if EXT_KIND.get(src.suffix.lower()) == "audio":
            # un son : la voix de l'élément, rangée à côté de ses images (`voices`)
            _add_voice(d, it["element"].setdefault("voices", []), src, label, from_item)
            it["updated"] = now()
            _save(it)
            return it
        n = 1 + max([int(r["file"][4:6]) for r in it["element"]["refs"] if r["file"][4:6].isdigit()] or [0])
        name = f"ref-{n:02d}{src.suffix.lower()}"
        shutil.copyfile(src, d / name)
        ref = {"file": name, "role": role, "label": label, **probe(d / name)}
        if from_item:
            ref["item"] = from_item
        if make_thumb(d / name, d / f"ref-{n:02d}.thumb.jpg", "image"):
            ref["thumb"] = f"ref-{n:02d}.thumb.jpg"
        it["element"]["refs"].append(ref)
        if not it.get("thumb") and ref.get("thumb"):
            it["thumb"] = ref["thumb"]
        it["updated"] = now()
        _save(it)
        return it


def remember_ref_item(item_id: str, name: str, image_id: str) -> None:
    """La référence `name` d'un élément retient l'image qui la porte dans la bibliothèque
    (server/tools/core_api.py, el_part). Rien si l'élément ne s'écrit pas ici."""
    _load()
    with _lock:
        it = _items.get(item_id)
        if not it or it["kind"] != "element":
            return
        _check_write(it)
        for r in it["element"].get("refs") or []:
            if r.get("file") == name and not r.get("item"):
                r["item"] = image_id
                _save(it)
                return


def trash(item_id: str) -> None:
    _load()
    with _lock:
        it = _items.get(item_id)
        if not it or not readable(it):   # un objet d'un autre Workspace n'existe pas ici
            raise KeyError(item_id)
        check_trash(it)
        for guard in TRASH_GUARDS:       # une version utilisée ne part pas (server/tools/elements.py)
            guard(it)
        _items.pop(item_id, None)
        dest = trash_root() / item_id
        if dest.exists():
            shutil.rmtree(dest)
        shutil.move(str(folder_of(item_id)), str(dest))


ID_RE = re.compile(r"[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}")


def trashed_meta(item_id: str) -> dict:
    """La fiche d'un objet jeté, pour juger qui peut le rendre ou le voir ; une
    fiche illisible est sans propriétaire, donc à Cal."""
    if not ID_RE.fullmatch(item_id or ""):
        raise KeyError(item_id)
    try:
        meta = json.loads((trash_root() / item_id / "item.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        meta = None
    return meta if isinstance(meta, dict) else {"id": item_id}


def restore(item_id: str) -> dict:
    _load()
    with _lock:
        # un identifiant de la corbeille a la forme de new_id, rien d'autre (pas de ../)
        if not ID_RE.fullmatch(item_id or ""):
            raise KeyError(item_id)
        src = trash_root() / item_id
        if not src.exists():
            raise KeyError(item_id)
        # (avant le 29/09, ce contrôle était dans un `except OSError` qui avalait
        # le refus — PermissionError en est une sous-classe : chacun rendait tout)
        meta = trashed_meta(item_id)
        if not readable(meta):   # la corbeille est par Workspace (§ 3.4) : celle d'un autre n'existe pas ici
            raise KeyError(item_id)
        check_trash(meta)
        if folder_of(item_id).exists():
            raise ValueError(f"{item_id} est déjà dans la bibliothèque")
        shutil.move(str(src), str(folder_of(item_id)))
        it = json.loads((folder_of(item_id) / "item.json").read_text(encoding="utf-8"))
        _items[item_id] = it
        return it


# ── rapatrier : copier un objet d'un Workspace dans un autre ─
# docs/etudes/equipes_espaces.md § 3.2 (étape 5). Un outil n'atteint que son Workspace
# (`get`) : pour se servir dans B d'un objet de A, on le rapatrie — un objet NEUF dans B,
# jamais un lien vivant : un autre id, un autre `uid` (package_export.md § 2.6 : même uid =
# le même objet ; la copie peut diverger), `space: B`, `origin.user` = qui rapatrie,
# `origin.from = {space: A, item, uid, at}`. Le titre, la recette (prompt, params), les
# tags, les dimensions suivent ; la lignée (`parents`, l'image d'origine des références)
# garde ses ids, et `parents_space` dit où chacun est (on ne rapatrie pas la lignée).
#
# Les fichiers (décision 8) : `main.*` par un lien dur — le fichier principal n'est jamais
# réécrit en place (le contrôle d'asset.py le prouve : il passe chaque écriture de la
# bibliothèque et regarde l'inode) ; un lien dur vit tant qu'un nom le porte, la corbeille
# ou le vidage d'un côté laisse donc l'autre intact. Tout le reste (vignette, copies
# d'affichage, références et voix d'un élément, copie de défilement, onde) : une copie
# pleine — petit, et réécrit en place par certains (make_thumb, montage._sync_item).
IMPORT_KINDS = ("image", "video", "audio", "midi", "element", "document")
IMPORT_MAX = 200
MAIN_RX = re.compile(r"^main\.[a-z0-9]{1,10}$")
# ce qui ne suit pas : la fiche (réécrite), l'instantané de la source d'une version
# (server/tools/elements.py : la copie n'est la version de rien dans B)
IMPORT_SKIP = ("item.json", "source.json")
# ce que la copie ne garde pas de l'original : son identité mondiale, sa marque de version
# (elle n'est la version d'aucun élément de B), son partage, son favori (les favoris sont
# ceux du Workspace), ce que la copie reçoit à neuf
IMPORT_DROP = ("uid", "version", "shared", "fav", "id", "space", "origin", "created", "updated", "folder", "parents_space")


def space_name(sid: str | None) -> str:
    """« Team / Workspace », pour les phrases qui disent où est un objet."""
    sp = espaces.space(sid)
    if not sp:
        return sid or "?"
    t = espaces.team(sp.get("team")) or {}
    return f"{t['name']} / {sp['name']}" if t.get("name") else sp["name"]


def check_import(space: str | None) -> None:
    """Rapatrier DANS ce Workspace : la matrice, `import` (un éditeur, un guest acteur ;
    un lecteur, un commentateur, un guest viewer : non). PermissionError (403) qui dit
    pourquoi. Le socle (aucune personne) : oui."""
    u = auth.current()
    if u is None:
        return
    ok, why = espaces.judge(u, space, "import")
    if not ok:
        raise PermissionError(f"rapatrier dans « {space_name(space)} » : {why}")


def import_refusal(it: dict, dest: str | None) -> str | None:
    """Pourquoi cet objet ne se rapatrie pas dans `dest` (une phrase qui mène à ce qui
    débloque), ou None. Juge la sorte, pas la personne (check_import)."""
    name = f"« {it.get('title') or it.get('id')} »"
    if space_of(it) == dest:
        return f"{name} est déjà dans « {space_name(dest)} » : rien à rapatrier"
    if is_living(it):
        return (f"{name} est un élément versionné : le rapatrier (sa version figée, § 3.3 de l'étude) vient avec "
                f"l'étape 9 — en attendant, rapatrie sa dernière version (sa fiche, « les versions »)")
    if it.get("kind") not in IMPORT_KINDS:
        return (f"{name} est une séquence : elle pose d'autres objets de son Workspace — la dupliquer ailleurs viendra "
                f"avec les documents (§ 3.5) ; en attendant, rapatrie ses plans")
    return None


def _link_or_copy(src: Path, dst: Path) -> None:
    """Le fichier principal : un lien dur (même disque, ext4) ; sinon une copie pleine
    (un autre disque, un système qui n'en fait pas) — le résultat est le même pour qui lit."""
    try:
        os.link(src, dst)
    except OSError:
        shutil.copyfile(src, dst)


def _import_one(src: dict, dest: str, folder: str, at: str) -> dict:
    """Une copie de `src` dans `dest`, fichiers compris, pas encore dans `_items`."""
    a = space_of(src)
    kind = src["kind"]
    iid = new_id(kind)
    while iid in _items or folder_of(iid).exists():
        iid = new_id(kind)
    d = folder_of(iid)
    d.mkdir(parents=True)
    sd = folder_of(src["id"])
    main = src.get("file") if MAIN_RX.fullmatch(src.get("file") or "") else None
    try:
        for p in sorted(sd.iterdir()):
            if p.name in IMPORT_SKIP or p.name.startswith(".") or p.name.endswith(".tmp"):
                continue
            if p.is_dir():
                shutil.copytree(p, d / p.name)
            elif p.name == main:
                _link_or_copy(p, d / p.name)
            elif p.is_file():
                shutil.copyfile(p, d / p.name)
        it = json.loads(json.dumps(src))   # une copie profonde : rien de partagé, en mémoire non plus
        for k in IMPORT_DROP:
            it.pop(k, None)
        el = it.get("element") or {}
        lineage = list(dict.fromkeys([str(x) for x in src.get("parents") or []]
                                     + [str(r["item"]) for r in (el.get("refs") or []) + (el.get("voices") or [])
                                        if isinstance(r, dict) and r.get("item")]))
        before = src.get("parents_space") if isinstance(src.get("parents_space"), dict) else {}
        where = {}
        for pid in lineage:
            p = _items.get(pid)
            where[pid] = space_of(p) if p is not None else before.get(pid) or a
        org = {k: v for k, v in (src.get("origin") or {}).items() if k not in ("user", "job", "from")}
        org.pop("user", None)
        org = _owned(org)
        org["from"] = {"space": a, "item": src["id"], "uid": uid_of(src), "at": at}
        v = src.get("version")
        if isinstance(v, dict) and v.get("of"):
            org["from"]["version"] = {"of": v["of"], "n": v.get("n")}
        it.update(id=iid, space=dest, origin=org, created=at, updated=at, folder=folder, fav=False,
                  parents=list(src.get("parents") or []))
        if where:
            it["parents_space"] = where
        return it
    except BaseException:
        shutil.rmtree(d, ignore_errors=True)
        raise


def rapatrier(ids: list, dest: str, *, folder: str = "") -> list[dict]:
    """Rapatrie les objets `ids` (vus par la personne, où qu'ils soient : `see`) dans le
    Workspace `dest`. Tout ou rien : chaque objet est jugé avant d'en copier un seul, et
    une copie qui échoue défait les précédentes. KeyError : un objet ou le Workspace
    inconnu (ou invisible) ; PermissionError : on ne peut pas rapatrier dans `dest` ;
    ValueError : un objet qui ne se rapatrie pas (import_refusal). Rend les copies."""
    _load()
    if espaces.space(dest) is None:
        raise KeyError(dest)
    check_import(dest)
    srcs = []
    who = auth.current()
    for iid in dict.fromkeys(str(i) for i in ids):
        src = see(iid)
        if src is None:
            raise KeyError(iid)
        if not auth.can_read_item(src, who, links=False):   # le lien d'une planche montre l'objet, il ne le donne pas
            owner = auth.display_name(auth.owner_of(src)) or auth.admin_name()
            raise ValueError(f"« {src.get('title') or iid} » ne t'est montré que par le lien d'une planche : il se "
                             f"regarde là, il ne se copie pas chez toi — demande-le à {owner}")
        why = import_refusal(src, dest)
        if why:
            raise ValueError(why)
        srcs.append(src)
    at = now()
    made: list[dict] = []
    try:
        for src in srcs:   # hors du verrou : les copies de fichiers ne bloquent pas la bibliothèque
            made.append(_import_one(src, dest, folder, at))
        with _lock:
            for it in made:
                _items[it["id"]] = it
                _save(it)
    except BaseException:
        with _lock:
            for it in made:
                _items.pop(it["id"], None)
                shutil.rmtree(folder_of(it["id"]), ignore_errors=True)
        raise
    return made


def copies_of(src: dict, dest: str) -> list[dict]:
    """Les copies de `src` déjà rapatriées dans `dest` (présentes) : `origin.from.uid`."""
    _load()
    u = uid_of(src)
    with _lock:
        return [i for i in _items.values() if space_of(i) == dest and ((i.get("origin") or {}).get("from") or {}).get("uid") == u]


# ── lire ────────────────────────────────────────────────────
def get(item_id: str) -> dict | None:
    """L'objet — s'il existe, s'il est du Workspace courant et si la personne qui
    agit a le droit de le voir : celle de la requête, ou le propriétaire du travail
    en cours (core/jobs.py pose `auth.current`, et le Workspace du travail, le
    temps du `run`). Sinon None, comme un objet absent : on ne dit pas qu'un objet
    invisible existe. Tous les outils lisent par ici, la règle de lecture (le rôle
    dans le Workspace, `visibility` : auth.can_read_item) et la borne du Workspace
    ne sont jugées qu'à cet endroit : une route ou un travail qui prendrait l'objet
    d'un autre Workspace par son identifiant ne le trouve pas — il faut le
    rapatrier (étape 5). Sans personne ni Workspace (le socle, le rattrapage) : tout."""
    _load()
    it = _items.get(item_id)
    return it if it is not None and readable(it) else None


def see(item_id: str) -> dict | None:
    """L'objet s'il existe et si la personne le voit, TOUS Workspaces confondus —
    pour montrer seulement (une vignette, la carte d'Asset) : un outil qui s'en
    sert passe par `get`, borné au Workspace courant."""
    _load()
    it = _items.get(item_id)
    return it if it is not None and visible(it) else None


def path_of(it: dict, name: str | None = None) -> Path:
    return folder_of(it["id"]) / (name or it["file"])


def ref_paths(it: dict, roles: list[str] | None = None) -> list[tuple[Path, dict]]:
    """Les fichiers d'un élément (ou l'image elle-même), dans l'ordre. Un élément
    versionné : ceux de sa dernière version."""
    if is_living(it):
        head = resolve(it)
        return ref_paths(head, roles) if head else []
    if it["kind"] == "image":
        return [(path_of(it), {"role": "", "label": it.get("title", "")})]
    if it["kind"] != "element":
        return []
    out = []
    # la voix (`voices`) ne vient que si on la demande : les outils lisent `refs` comme des images
    extra = (it["element"].get("voices") or []) if (roles and "voice" in roles) else []
    for r in it["element"]["refs"] + extra:
        if roles and r.get("role") not in roles:
            continue
        out.append((path_of(it, r["file"]), r))
    return out


def public(it: dict) -> dict:
    """L'objet tel que la page le voit : avec ses adresses."""
    base = f"library/{it['id']}/"
    out = dict(it)
    out["owner"] = auth.owner_of(it)
    out["space"] = space_of(it)   # chaque carte dit son Workspace (Asset tous Workspaces, étape 5)
    if it.get("file"):
        out["url"] = base + it["file"]
    out["thumb_url"] = base + it["thumb"] if it.get("thumb") else (out.get("url") if it["kind"] == "image" else None)
    # les copies d'affichage qui existent (grand côté, px) et leurs adresses versionnées
    # (commun/proxies.js choisit) ; [] : la page prend la vignette ou l'original
    out["views"] = sorted(it.get("views") or [])
    ver = out.pop("views_v", "")
    out["view_urls"] = {str(w): f"{base}{view_name(w)}?v={ver}" for w in out["views"]}
    out["uid"] = uid_of(it)
    if it["kind"] == "document":
        # son texte (server/tools/documents.py : GET /api/library/<id>/texte) et ses pages rendues
        out["text_url"] = f"api/library/{it['id']}/texte"
        doc = dict(it.get("doc") or {})
        doc["page_urls"] = [f"{base}page-{n:03d}.jpg" for n in range(1, int(doc.get("rendered") or 0) + 1)]
        out["doc"] = doc
    if isinstance(it.get("original"), dict) and it["original"].get("file"):
        out["original"] = {**it["original"], "url": base + it["original"]["file"]}   # l'image telle qu'elle a été déposée
    if it["kind"] == "element":
        el = dict(it["element"])
        el["refs"] = [{**r, "url": base + r["file"], "thumb_url": base + r["thumb"] if r.get("thumb") else base + r["file"]}
                      for r in it["element"]["refs"]]
        if it["element"].get("voices"):
            el["voices"] = [{**v, "url": base + v["file"]} for v in it["element"]["voices"]]
        if it["element"].get("meshes"):   # les modèles 3D (Object Creator) : leur adresse, pour la visionneuse
            el["meshes"] = [{**m, "url": base + m["file"]} for m in it["element"]["meshes"] if m.get("file")]
        out["element"] = el
        if is_living(it):
            # un élément versionné : sa dernière version, et son image (celle de la dernière)
            h = head_entry(it)
            hi = _items.get(h["item"]) if h else None
            el["head"], el["head_item"] = (h["n"], h["item"]) if h else (None, None)
            el["count"] = len(it["element"]["versions"])
            if hi and not it.get("thumb"):
                hp = public(hi)
                for k in ("thumb_url", "views", "view_urls"):
                    out[k] = hp.get(k)
                if hi["kind"] == "element":
                    el["refs"], el["voices"] = hp["element"]["refs"], hp["element"].get("voices")
            if hi:
                el["head_kind"], el["head_duration"] = hi["kind"], hi.get("duration")
    v = it.get("version")
    if isinstance(v, dict) and v.get("of"):
        # une version sait de quel élément elle est la n-ième, et quelle est la dernière :
        # la pastille « vN+1 » de toute page qui la pose, sans requête de plus
        e = _items.get(v["of"])
        e = e if e is not None and visible(e) else None   # montrer : la version d'un autre Workspace dit le sien
        h = head_entry(e) if e else None
        mine = next((x for x in (e or {}).get("element", {}).get("versions", []) if x.get("item") == it["id"]), {})
        out["version"] = {"of": v["of"], "n": v.get("n"), "of_title": e.get("title") if e else None, "of_present": bool(e),
                          "head": h["n"] if h else None, "head_item": h["item"] if h else None,
                          "state": mine.get("state", "ready") if mine else None}
    return out


def query(kinds: list[str] | None = None, q: str = "", folder: str | None = None, sort: str = "new",
          limit: int = 200, offset: int = 0, fav: bool = False, tool: str = "", versions: bool = True,
          spaces=None) -> dict:
    """`versions=False` : les versions d'un élément présent restent sous lui (Asset
    les empile) ; celles d'un élément à la corbeille redeviennent des objets à part.
    `spaces` : None, le Workspace courant (ce que les outils listent : un outil
    n'atteint que son Workspace) ; une liste de Workspaces, ou « * » (tous ceux que
    la personne voit) : pour MONTRER seulement (Asset tous Workspaces, étape 5) —
    chaque objet rendu dit le sien (`space`)."""
    _load()
    with _lock:
        items = list(_items.values())
    if spaces is None:
        want = {here()} if here() else None
    elif spaces == "*":
        want = None
    else:
        want = {str(s) for s in spaces}
    sees = auth.item_reader(auth.current())
    items = [i for i in items if (want is None or space_of(i) in want) and sees(i)]
    if not versions:
        items = [i for i in items if not (isinstance(i.get("version"), dict) and i["version"].get("of") in _items)]
    visible = items
    if kinds:
        items = [i for i in items if i["kind"] in kinds]
    if folder is not None:
        items = [i for i in items if (i.get("folder") or "") == folder]
    if fav:
        items = [i for i in items if i.get("fav")]
    if tool:
        items = [i for i in items if (i.get("origin") or {}).get("tool") == tool]
    if q:
        ql = q.lower()
        items = [i for i in items if ql in " ".join([i.get("title", ""), i.get("prompt", ""), " ".join(i.get("tags", [])),
                                                      (i.get("element") or {}).get("description", ""),
                                                      (i.get("doc") or {}).get("title") or ""]).lower()]
    key = {"new": lambda i: i["created"], "old": lambda i: i["created"], "title": lambda i: i.get("title", "").lower(),
           "updated": lambda i: i.get("updated", i["created"])}.get(sort, lambda i: i["created"])
    items.sort(key=key, reverse=sort in ("new", "updated"))
    counts = {k: 0 for k in KINDS}
    for i in visible:
        counts[i["kind"]] = counts.get(i["kind"], 0) + 1
    folders = sorted({i.get("folder") for i in visible if i.get("folder")})
    return {"total": len(items), "items": [public(i) for i in items[offset:offset + limit]],
            "counts": counts, "folders": folders}


# l'étape 2 des Teams et Workspaces est en place (ci-dessus : `space` à la naissance,
# les juges par rôle de Workspace, la borne du Workspace courant) : core/espaces.py
# peut faire des guests dès que la garde du calcul (étape 1) l'est aussi
espaces.garde_prete("bibliotheque")
