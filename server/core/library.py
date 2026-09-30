"""La bibliothèque « Asset » : tout ce que les outils fabriquent ou
reçoivent, rangé au même endroit et réutilisable partout.

Quatre sortes d'objets :

  image    un fichier image (PNG, JPEG, WEBP)
  video    un fichier vidéo (MP4, WEBM, MOV)
  audio    un fichier son (WAV, MP3, FLAC, M4A, OGG)
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
n'ont rien à changer. Seul son propriétaire (ou Cal) le modifie ou le met
à la corbeille ; qui voit quoi suit le réglage d'admin (`visibility`).

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

from . import auth, config

# "sequence" : une séquence du Montage (sa timeline dans `sequence.json`, écrite par server/tools/montage.py), 29/09
KINDS =("image", "video", "audio", "element", "midi", "sequence")
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


# ── à qui ───────────────────────────────────────────────────
def _owned(origin: dict) -> dict:
    """`origin.user` : la personne de la requête, ou du travail qui range."""
    out = dict(origin)
    uid = auth.current_id()
    if uid and not out.get("user"):
        out["user"] = uid
    return out


def check_write(it: dict) -> None:
    """Le juge de toute écriture : un objet de la bibliothèque, ou un document
    d'outil qui porte son propriétaire de la même façon (`origin.user` ou
    `owner` : un projet ODIO…). Son propriétaire ou un admin ; un objet sans
    propriétaire est d'avant la porte : à Cal. PermissionError → 403."""
    u = auth.current()
    if not auth.can_write_item(it, u):
        owner = auth.display_name(auth.owner_of(it)) or auth.admin_name()
        who = owner if owner == auth.admin_name() else f"{owner} (ou {auth.admin_name()})"
        raise PermissionError(f"« {it.get('title') or it.get('name') or it.get('id') or '?'} » est à {owner} : "
                              f"seul·e {who} peut le modifier ou le mettre à la corbeille")


_check_write = check_write   # le nom d'avant (montage.py)


def readable(it: dict) -> bool:
    return auth.can_read_item(it, auth.current())


def readable_path(rel: str) -> bool:
    """Le juge des fichiers servis sous /library/ : `<id>/<fichier>`."""
    it = get(rel.split("/", 1)[0])
    return bool(it) and readable(it)


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


# ── écrire ──────────────────────────────────────────────────
def add_file(src: Path, *, kind: str | None = None, title: str = "", origin: dict | None = None,
             prompt: str = "", params: dict | None = None, parents: list | None = None,
             tags: list | None = None, folder: str = "", move: bool = False, extra: dict | None = None) -> dict:
    """Range un fichier : une image, une vidéo ou un son."""
    _load()
    src = Path(src)
    kind = kind or EXT_KIND.get(src.suffix.lower())
    if kind not in ("image", "video", "audio", "midi"):
        raise ValueError(f"type de fichier non pris : {src.suffix}")
    iid = new_id(kind)
    d = folder_of(iid)
    d.mkdir(parents=True, exist_ok=True)
    name = "main" + src.suffix.lower()
    (shutil.move if move else shutil.copyfile)(str(src), str(d / name))
    it = {
        "id": iid, "kind": kind, "title": title or src.stem, "created": now(), "updated": now(),
        "file": name, "origin": _owned(origin or {"tool": "upload"}), "prompt": prompt, "params": params or {},
        "parents": list(parents or []), "tags": list(tags or []), "folder": folder, "fav": False,
        **probe(d / name), **(extra or {}),
    }
    if make_thumb(d / name, d / "thumb.jpg", kind):
        it["thumb"] = "thumb.jpg"
    if kind in VIEW_KINDS:   # les copies d'affichage, avant que la page ne la voie
        it["views"], it["views_v"] = build_views(kind, d / name, d), _views_v()
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
        "origin": _owned({"tool": (source or {}).get("tool", "asset")}), "tags": list(tags or []), "folder": folder,
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
    iid = new_id("element")
    folder_of(iid).mkdir(parents=True, exist_ok=True)
    it = {
        "id": iid, "kind": "element", "title": (title or "élément")[:200], "created": now(), "updated": now(),
        "origin": _owned({"tool": source.get("tool", "asset")}), "tags": list(tags or []), "folder": folder, "fav": False,
        "parents": [], "element": {"type": etype, "description": description, "refs": [], "source": source,
                                   "media": media, "versions": []},
    }
    with _lock:
        _items[iid] = it
        _save(it)
    return it


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
        if not it:
            raise KeyError(item_id)
        _check_write(it)
        _check_patch(patch)
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
        if not it or it["kind"] != "element":
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


def trash(item_id: str) -> None:
    _load()
    with _lock:
        it = _items.get(item_id)
        if not it:
            raise KeyError(item_id)
        _check_write(it)
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
        check_write(trashed_meta(item_id))
        if folder_of(item_id).exists():
            raise ValueError(f"{item_id} est déjà dans la bibliothèque")
        shutil.move(str(src), str(folder_of(item_id)))
        it = json.loads((folder_of(item_id) / "item.json").read_text(encoding="utf-8"))
        _items[item_id] = it
        return it


# ── lire ────────────────────────────────────────────────────
def get(item_id: str) -> dict | None:
    """L'objet — s'il existe et si la personne qui agit a le droit de le voir :
    celle de la requête, ou le propriétaire du travail en cours (core/jobs.py
    pose `auth.current` le temps du `run`). Sinon None, comme un objet absent :
    on ne dit pas qu'un objet invisible existe. Tous les outils lisent par ici,
    la règle de lecture (`visibility`, auth.can_read_item) n'est jugée qu'à cet
    endroit : une route ou un travail qui prendrait l'objet d'un autre par son
    identifiant ne le trouve pas. Sans personne (le socle, le rattrapage) : tout."""
    _load()
    it = _items.get(item_id)
    return it if it is not None and readable(it) else None


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
    if it.get("file"):
        out["url"] = base + it["file"]
    out["thumb_url"] = base + it["thumb"] if it.get("thumb") else (out.get("url") if it["kind"] == "image" else None)
    # les copies d'affichage qui existent (grand côté, px) et leurs adresses versionnées
    # (commun/proxies.js choisit) ; [] : la page prend la vignette ou l'original
    out["views"] = sorted(it.get("views") or [])
    ver = out.pop("views_v", "")
    out["view_urls"] = {str(w): f"{base}{view_name(w)}?v={ver}" for w in out["views"]}
    out["uid"] = uid_of(it)
    if it["kind"] == "element":
        el = dict(it["element"])
        el["refs"] = [{**r, "url": base + r["file"], "thumb_url": base + r["thumb"] if r.get("thumb") else base + r["file"]}
                      for r in it["element"]["refs"]]
        if it["element"].get("voices"):
            el["voices"] = [{**v, "url": base + v["file"]} for v in it["element"]["voices"]]
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
        e = e if e is not None and readable(e) else None
        h = head_entry(e) if e else None
        mine = next((x for x in (e or {}).get("element", {}).get("versions", []) if x.get("item") == it["id"]), {})
        out["version"] = {"of": v["of"], "n": v.get("n"), "of_title": e.get("title") if e else None, "of_present": bool(e),
                          "head": h["n"] if h else None, "head_item": h["item"] if h else None,
                          "state": mine.get("state", "ready") if mine else None}
    return out


def query(kinds: list[str] | None = None, q: str = "", folder: str | None = None, sort: str = "new",
          limit: int = 200, offset: int = 0, fav: bool = False, tool: str = "", versions: bool = True) -> dict:
    """`versions=False` : les versions d'un élément présent restent sous lui (Asset
    les empile) ; celles d'un élément à la corbeille redeviennent des objets à part."""
    _load()
    with _lock:
        items = list(_items.values())
    u = auth.current()
    if u and not auth.is_admin(u) and auth.settings()["visibility"] != "all":
        items = [i for i in items if auth.can_read_item(i, u)]
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
                                                      (i.get("element") or {}).get("description", "")]).lower()]
    key = {"new": lambda i: i["created"], "old": lambda i: i["created"], "title": lambda i: i.get("title", "").lower(),
           "updated": lambda i: i.get("updated", i["created"])}.get(sort, lambda i: i["created"])
    items.sort(key=key, reverse=sort in ("new", "updated"))
    counts = {k: 0 for k in KINDS}
    for i in visible:
        counts[i["kind"]] = counts.get(i["kind"], 0) + 1
    folders = sorted({i.get("folder") for i in visible if i.get("folder")})
    return {"total": len(items), "items": [public(i) for i in items[offset:offset + limit]],
            "counts": counts, "folders": folders}
