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
principal, sa vignette ; les références d'un élément y sont copiées, pour
qu'il ne dépende de rien d'autre. Une suppression met l'objet à la
corbeille (`<data_dir>/trash/`), d'où il peut revenir.

Chaque objet porte qui l'a fait (`origin.user`), posé ici d'après la
personne de la requête ou du travail en cours (core/auth.py) : les outils
n'ont rien à changer. Seul son propriétaire (ou Cal) le modifie ou le met
à la corbeille ; qui voit quoi suit le réglage d'admin (`visibility`).
"""

from __future__ import annotations

import json
import re
import secrets
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from . import auth, config

KINDS =("image", "video", "audio", "element")
EXT_KIND = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image",
    ".mp4": "video", ".webm": "video", ".mov": "video", ".m4v": "video",
    ".wav": "audio", ".mp3": "audio", ".flac": "audio", ".m4a": "audio", ".ogg": "audio",
}
ELEMENT_TYPES = ("character", "object", "place", "style", "other")
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


# ── à qui ───────────────────────────────────────────────────
def _owned(origin: dict) -> dict:
    """`origin.user` : la personne de la requête, ou du travail qui range."""
    out = dict(origin)
    uid = auth.current_id()
    if uid and not out.get("user"):
        out["user"] = uid
    return out


def _check_write(it: dict) -> None:
    u = auth.current()
    if not auth.can_write_item(it, u):
        owner = auth.display_name(auth.owner_of(it)) or auth.admin_name()
        who = owner if owner == auth.admin_name() else f"{owner} (ou {auth.admin_name()})"
        raise PermissionError(f"« {it.get('title') or it['id']} » est à {owner} : seul·e {who} peut le modifier "
                              "ou le mettre à la corbeille")


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
            with Image.open(path) as im:
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
            with Image.open(src) as im:
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


# ── écrire ──────────────────────────────────────────────────
def add_file(src: Path, *, kind: str | None = None, title: str = "", origin: dict | None = None,
             prompt: str = "", params: dict | None = None, parents: list | None = None,
             tags: list | None = None, folder: str = "", move: bool = False, extra: dict | None = None) -> dict:
    """Range un fichier : une image, une vidéo ou un son."""
    _load()
    src = Path(src)
    kind = kind or EXT_KIND.get(src.suffix.lower())
    if kind not in ("image", "video", "audio"):
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


def update(item_id: str, patch: dict) -> dict:
    _load()
    with _lock:
        it = _items.get(item_id)
        if not it:
            raise KeyError(item_id)
        _check_write(it)
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
        _items.pop(item_id, None)
        dest = trash_root() / item_id
        if dest.exists():
            shutil.rmtree(dest)
        shutil.move(str(folder_of(item_id)), str(dest))


ID_RE = re.compile(r"[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}")


def restore(item_id: str) -> dict:
    _load()
    with _lock:
        # un identifiant de la corbeille a la forme de new_id, rien d'autre (pas de ../)
        if not ID_RE.fullmatch(item_id or ""):
            raise KeyError(item_id)
        src = trash_root() / item_id
        if not src.exists():
            raise KeyError(item_id)
        try:
            _check_write(json.loads((src / "item.json").read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
        shutil.move(str(src), str(folder_of(item_id)))
        it = json.loads((folder_of(item_id) / "item.json").read_text(encoding="utf-8"))
        _items[item_id] = it
        return it


# ── lire ────────────────────────────────────────────────────
def get(item_id: str) -> dict | None:
    _load()
    return _items.get(item_id)


def path_of(it: dict, name: str | None = None) -> Path:
    return folder_of(it["id"]) / (name or it["file"])


def ref_paths(it: dict, roles: list[str] | None = None) -> list[tuple[Path, dict]]:
    """Les fichiers d'un élément (ou l'image elle-même), dans l'ordre."""
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
    if it["kind"] == "element":
        el = dict(it["element"])
        el["refs"] = [{**r, "url": base + r["file"], "thumb_url": base + r["thumb"] if r.get("thumb") else base + r["file"]}
                      for r in it["element"]["refs"]]
        if it["element"].get("voices"):
            el["voices"] = [{**v, "url": base + v["file"]} for v in it["element"]["voices"]]
        out["element"] = el
    return out


def query(kinds: list[str] | None = None, q: str = "", folder: str | None = None, sort: str = "new",
          limit: int = 200, offset: int = 0, fav: bool = False, tool: str = "") -> dict:
    _load()
    with _lock:
        items = list(_items.values())
    u = auth.current()
    if u and not auth.is_admin(u) and auth.settings()["visibility"] != "all":
        items = [i for i in items if auth.can_read_item(i, u)]
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
