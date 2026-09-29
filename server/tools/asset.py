"""La page « Asset » : ce que la bibliothèque commune (`core/library.py`,
`tools/core_api.py`) ne sait pas encore faire pour elle.

  GET  /api/asset/view?kind=&q=&folder=&sort=&fav=1&tool=&origin=&limit=&offset=
       une vue de la page : les objets d'un niveau (la racine ou un
       dossier), les dossiers de la racine avec leurs vignettes en petit,
       les comptes par sorte et par origine, les outils d'origine. Une
       recherche (`q`) parcourt tous les dossiers. `origin=upload` : ce
       qu'on a déposé de son disque (`origin.tool == "upload"`, la
       catégorie « Uploads ») ; `origin=made` : ce que les outils ont fait.
  POST /api/asset/move {ids, folder}             ranger (ou sortir : folder "")
  POST /api/asset/folders/rename {from, to}      renommer un dossier = ses objets
  POST /api/asset/bulk {ids, fav?, tags_add?, tags_remove?}   plusieurs à la fois ;
       rend l'état d'avant (`before`), que {restore: before} remet
  POST /api/asset/trash {ids} · /api/asset/restore {ids}      corbeille, retour, en lot
  POST /api/asset/zip {ids}                      un zip de la sélection (voir `zip_make`)
  GET  /api/asset/zip/<jeton>/<nom>.zip          le zip, servi en flux depuis le disque
  GET  /api/asset/lineage/<id>                   parents et enfants
  GET  /api/asset/trash                          la corbeille
  GET  /api/asset/trash/<id>/thumb               la vignette d'un objet jeté
  POST /api/asset/cf/refresh {id}                un personnage déjà importé,
                                                 remis à jour sur place
  POST /api/asset/refs/<id> {refs}               la planche d'un élément, dans l'ordre

Un dossier n'existe que par ses objets (le champ `folder` de chacun,
ARCHITECTURE.md §2) : un dossier vide disparaît de lui-même. Un seul
niveau, comme dans la maquette du 28/09 (« un dossier tient des
personnages et des objets, pas d'autre dossier »).
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import time
import unicodedata
import urllib.parse
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from core import config, library
from core.http import FileResponse, HttpError
from tools import core_api

FOLDER_MAX = 60


def _all(q: str = "", sort: str = "new", fav: bool = False, tool: str = "") -> list[dict]:
    return library.query(None, q, None, sort, 1_000_000, 0, fav, tool)["items"]


def _tool(it: dict) -> str:
    """L'outil d'origine ; un objet sans origine a été déposé (`lib_upload`)."""
    return (it.get("origin") or {}).get("tool") or "upload"


def _ids(d: dict) -> list[dict]:
    """Les objets nommés par `ids`, tous présents, sinon 404."""
    ids = d.get("ids")
    if not isinstance(ids, list) or not ids:
        raise HttpError(400, "ids : la liste des objets")
    out = []
    for iid in ids:
        it = library.get(str(iid))
        if not it:
            raise HttpError(404, f"introuvable : {iid}")
        if it not in out:
            out.append(it)
    return out


def _clean_folder(name) -> str:
    if not isinstance(name, str):
        raise HttpError(400, "un nom de dossier est un texte")
    name = " ".join(name.split())[:FOLDER_MAX]
    if "/" in name:
        raise HttpError(400, "un dossier ne se range pas dans un autre : pas de « / » dans son nom")
    return name


def _mini(it: dict) -> dict:
    return {"id": it["id"], "kind": it["kind"], "title": it.get("title", ""), "thumb_url": it.get("thumb_url"),
            "url": it.get("url") if it["kind"] == "video" else None,
            "etype": (it.get("element") or {}).get("type")}


# ── la vue de la page ───────────────────────────────────────
def view(req):
    kinds = [k for k in req.q("kind").split(",") if k in library.KINDS]
    q = req.q("q").strip()
    folder = req.q("folder")
    sort = req.q("sort", "new")
    fav = req.q("fav") == "1"
    tool = req.q("tool")
    origin = req.q("origin")
    try:
        limit = max(1, min(2000, int(req.q("limit", "400") or 400)))
        offset = max(0, int(req.q("offset", "0") or 0))
    except ValueError as e:
        raise HttpError(400, "limit et offset sont des nombres") from e

    everything = _all("", sort)
    tools: dict[str, int] = {}
    for it in everything:
        t = _tool(it)
        tools[t] = tools.get(t, 0) + 1
    all_folders = sorted({it.get("folder") for it in everything if it.get("folder")}, key=str.lower)

    before_origin = _all(q, sort, fav, tool)
    # les comptes des onglets d'origine : dans le même périmètre que la vue
    if folder:
        o_scope = [it for it in before_origin if (it.get("folder") or "") == folder]
    else:
        o_scope = before_origin
    origins = {"upload": sum(1 for it in o_scope if _tool(it) == "upload")}
    origins["made"] = len(o_scope) - origins["upload"]
    matching = [it for it in before_origin if not origin or (_tool(it) == "upload") == (origin == "upload")]
    if folder:
        scope = [it for it in matching if (it.get("folder") or "") == folder]
    elif q:
        scope = matching                       # une recherche traverse les dossiers
    else:
        scope = [it for it in matching if not it.get("folder")]
    # les comptes : dans un dossier, les siens ; à la racine, toute la bibliothèque
    counted = scope if (folder or q) else matching
    counts = {k: 0 for k in library.KINDS}
    for it in counted:
        counts[it["kind"]] += 1

    items = [it for it in scope if not kinds or it["kind"] in kinds]

    folders = []
    if not folder and not q:
        groups: dict[str, list[dict]] = {}
        for it in matching:
            if it.get("folder"):
                groups.setdefault(it["folder"], []).append(it)
        for name, group in groups.items():
            shown = [it for it in group if not kinds or it["kind"] in kinds]
            if not shown:
                continue
            by_kind = {k: 0 for k in library.KINDS}
            for it in group:
                by_kind[it["kind"]] += 1
            folders.append({"name": name, "count": len(shown), "total": len(group), "kinds": by_kind,
                            "updated": max(it.get("updated") or it["created"] for it in group),
                            "preview": [_mini(it) for it in shown[:4]]})
        if sort == "title":
            folders.sort(key=lambda f: f["name"].lower())
        elif sort == "old":
            folders.sort(key=lambda f: f["updated"])
        else:
            folders.sort(key=lambda f: f["updated"], reverse=True)

    return {"items": items[offset:offset + limit], "total": len(items), "offset": offset,
            "counts": counts, "folders": folders, "all_folders": all_folders, "tools": tools, "origins": origins,
            "library_total": len(everything), "folder": folder, "q": q}


# ── ranger ──────────────────────────────────────────────────
def move(req):
    d = req.json()
    ids = d.get("ids")
    if not isinstance(ids, list) or not ids:
        raise HttpError(400, "ids : la liste des objets à ranger")
    folder = _clean_folder(d.get("folder", ""))
    moved = []
    for iid in ids:
        it = library.get(str(iid))
        if not it:
            raise HttpError(404, f"introuvable : {iid}")
        moved.append({"id": it["id"], "from": it.get("folder") or ""})
    for m in moved:
        library.update(m["id"], {"folder": folder})
    return {"moved": moved, "folder": folder}


def rename_folder(req):
    d = req.json()
    old = _clean_folder(d.get("from", ""))
    new = _clean_folder(d.get("to", ""))
    if not old:
        raise HttpError(400, "quel dossier ?")
    if not new:
        raise HttpError(400, "il lui faut un nom")
    members = [it for it in _all() if (it.get("folder") or "") == old]
    if not members:
        raise HttpError(404, f"aucun dossier « {old} »")
    merged = new != old and any((it.get("folder") or "") == new for it in _all())
    for it in members:
        library.update(it["id"], {"folder": new})
    return {"renamed": len(members), "folder": new, "merged": merged}


# ── plusieurs à la fois : favori, tags, corbeille ───────────
ID_RX = re.compile(r"(ima|vid|aud|ele)-\d{8}-\d{6}-[0-9a-f]{4}")


def bulk(req):
    """Favori et tags sur une sélection. Rend l'état d'avant de chacun, que
    `{restore: before}` remet (l'« annuler » de la page)."""
    d = req.json()
    if isinstance(d.get("restore"), list):
        n = 0
        for b in d["restore"]:
            it = library.get(str((b or {}).get("id", "")))
            if it:
                library.update(it["id"], {"fav": bool(b.get("fav")), "tags": [str(t)[:40] for t in b.get("tags") or []]})
                n += 1
        return {"restored": n}
    items = _ids(d)
    add = [str(t).strip()[:40] for t in d.get("tags_add") or [] if str(t).strip()]
    rem = {str(t) for t in d.get("tags_remove") or []}
    before = []
    for it in items:
        before.append({"id": it["id"], "fav": bool(it.get("fav")), "tags": list(it.get("tags") or [])})
        patch = {}
        if "fav" in d:
            patch["fav"] = bool(d["fav"])
        if add or rem:
            tags = [t for t in it.get("tags") or [] if t not in rem]
            patch["tags"] = tags + [t for t in add if t not in tags]
        if patch:
            library.update(it["id"], patch)
    return {"before": before, "count": len(items)}


def trash_many(req):
    items = _ids(req.json())
    for it in items:
        library.trash(it["id"])
    return {"trashed": [it["id"] for it in items]}


def restore_many(req):
    ids = req.json().get("ids")
    if not isinstance(ids, list):
        raise HttpError(400, "ids : la liste des objets")
    back = []
    for iid in ids:
        if not ID_RX.fullmatch(str(iid)):
            continue                      # un id se tient à sa forme : rien ne sort de la corbeille par « .. »
        try:
            back.append(library.restore(str(iid))["id"])
        except KeyError:
            pass
    return {"restored": back}


# ── télécharger : un zip de la sélection ────────────────────
ZIP_KEEP_S = 2 * 3600
_UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')
ROLE_FR = {"face": "visage", "full body": "plein pied", "expression": "expression", "outfit": "tenue",
           "view": "vue", "detail": "détail", "style": "style"}


def _safe(name, fallback: str) -> str:
    n = _UNSAFE.sub("_", str(name or "")).strip(" ._")[:80]
    return n or fallback


def _zip_dir() -> Path:
    d = config.data_dir() / "zips"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _zip_clean() -> None:
    now = time.time()
    for p in _zip_dir().iterdir():
        try:
            if now - p.stat().st_mtime > ZIP_KEEP_S:
                shutil.rmtree(p) if p.is_dir() else p.unlink()
        except OSError:
            pass


def zip_make(req):
    """Un zip de la sélection, fait ici, sur la machine qui a les fichiers.

    Une image, une vidéo, un son : son fichier, au nom de son titre. Un
    élément : un dossier à son nom avec ses références dans l'ordre
    (« 01 visage · neutre.png »), ses GLB s'il en a, et sa description.
    Les fichiers ne sont pas recompressés (`ZIP_STORED`) : PNG, JPEG, MP4
    le sont déjà. Le zip est écrit dans `<data>/zips/<jeton>/`, servi en flux
    par `zip_get` (les requêtes partielles marchent), effacé après deux
    heures.

    Plus tard, bibliothèque publiée sur R2 (docs/etudes/asset.md) : R2 n'a
    pas d'opération d'archive (API S3 : GetObject, pas de zip). Le zip reste
    fait par la DGX qui a les fichiers, le Worker ne fait que le relayer ;
    ou, DGX éteintes, par le navigateur en flux depuis R2.
    """
    items = _ids(req.json())
    _zip_clean()
    token = secrets.token_hex(8)
    d = _zip_dir() / token
    d.mkdir()
    base = _safe(items[0].get("title"), items[0]["id"]) if len(items) == 1 else f"asset · {len(items)} objets"
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", unicodedata.normalize("NFKD", base).encode("ascii", "ignore").decode()).strip("-")[:60]
    path = d / f"{slug or 'asset'}.zip"
    used: set[str] = set()

    def arc(name: str) -> str:
        stem, ext = os.path.splitext(name)
        n, k = name, 2
        while n.lower() in used:
            n, k = f"{stem} ({k}){ext}", k + 1
        used.add(n.lower())
        return n

    files = 0
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED, allowZip64=True) as z:
        for it in items:
            src = library.folder_of(it["id"])
            title = _safe(it.get("title"), it["id"])
            if it["kind"] == "element":
                top = arc(title)
                el = it["element"]
                for k, r in enumerate(el.get("refs") or []):
                    p = src / r["file"]
                    if p.is_file():
                        label = _safe(" · ".join(x for x in (ROLE_FR.get(r.get("role"), r.get("role") or ""), r.get("label") or "") if x), "")
                        z.write(p, f"{top}/{k + 1:02d}{' ' + label if label else ''}{p.suffix.lower()}")
                        files += 1
                for v in el.get("voices") or []:
                    p = src / v["file"]
                    if p.is_file():
                        z.write(p, f"{top}/voix{' · ' + _safe(v.get('label'), '') if v.get('label') and v.get('label') != 'voix' else ''}{p.suffix.lower()}")
                        files += 1
                for m in el.get("meshes") or []:
                    p = src / m["file"]
                    if p.is_file():
                        z.write(p, f"{top}/{'factice ' if m.get('factice') else ''}{m['file']}")
                        files += 1
                if (el.get("description") or "").strip():
                    z.writestr(f"{top}/description.txt", el["description"].strip() + "\n")
            elif it.get("file"):
                p = src / it["file"]
                if p.is_file():
                    z.write(p, arc(title + p.suffix.lower()))
                    files += 1
    return {"url": f"api/asset/zip/{token}/{path.name}", "name": f"{base}.zip", "size": path.stat().st_size,
            "files": files, "count": len(items)}


def zip_get(req, token, name):
    if not re.fullmatch(r"[0-9a-f]{16}", token) or not re.fullmatch(r"[A-Za-z0-9._-]{1,80}\.zip", name):
        raise HttpError(404, "introuvable")
    p = _zip_dir() / token / name
    if not p.is_file():
        raise HttpError(404, "ce zip n'existe plus (gardé deux heures) : refais-le")
    return FileResponse(p, "application/zip")


# ── la lignée ───────────────────────────────────────────────
def _parent_ids(it: dict) -> list[str]:
    """Les parents déclarés, plus l'image d'origine de chaque référence d'un
    élément : `library.add_ref` ne les ajoute pas à `parents`."""
    ids = list(it.get("parents") or [])
    el = it.get("element") or {}
    for r in (el.get("refs") or []) + (el.get("voices") or []):
        if r.get("item") and r["item"] not in ids:
            ids.append(r["item"])
    return ids


def lineage(req, item_id):
    it = library.get(item_id)
    if not it:
        raise HttpError(404, f"introuvable : {item_id}")
    parents = [library.public(p) for p in (library.get(x) for x in _parent_ids(it)) if p]
    children = [c for c in _all() if item_id in _parent_ids(c)]
    return {"parents": parents, "children": children}


# ── la corbeille ────────────────────────────────────────────
def _trashed(folder: Path) -> dict | None:
    try:
        it = json.loads((folder / "item.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    # le renommage vers la corbeille met à jour le ctime du dossier (Linux) : l'heure du geste
    when = datetime.fromtimestamp(folder.stat().st_ctime, timezone.utc).isoformat(timespec="seconds")
    return {"id": it.get("id", folder.name), "kind": it.get("kind"), "title": it.get("title", ""),
            "created": it.get("created"), "trashed": when, "folder": it.get("folder", ""),
            "etype": (it.get("element") or {}).get("type"), "duration": it.get("duration"),
            "thumb_url": f"api/asset/trash/{folder.name}/thumb" if it.get("thumb") else None}


def trash_list(req):
    out = [t for t in (_trashed(d) for d in library.trash_root().iterdir() if d.is_dir()) if t]
    out.sort(key=lambda t: t["trashed"], reverse=True)
    return {"items": out}


def trash_thumb(req, item_id):
    root = library.trash_root().resolve()
    d = (root / item_id).resolve()
    if not d.is_relative_to(root) or not (d / "item.json").is_file():
        raise HttpError(404, "pas dans la corbeille")
    try:
        name = json.loads((d / "item.json").read_text(encoding="utf-8")).get("thumb") or ""
    except ValueError as e:
        raise HttpError(404, "illisible") from e
    f = (d / name).resolve()
    if not name or not f.is_relative_to(d) or not f.is_file():
        raise HttpError(404, "pas de vignette")
    return FileResponse(f)


# ── la planche d'un élément ─────────────────────────────────
REF_FILE = re.compile(r"ref-\d{2,3}\.(png|jpe?g|webp)")
VOICE_FILE = re.compile(r"voice-\d{2,3}\.(wav|mp3|flac|m4a|ogg)")


def _set_voices(it: dict, d: Path, voices: list) -> list:
    """La voix d'un élément (`element.voices`, library._add_voice), dans
    l'ordre donné ; un fichier retiré reste dans le dossier, pour « annuler »."""
    old = {v["file"]: v for v in it["element"].get("voices") or []}
    out, seen = [], set()
    for v in voices:
        f = str((v or {}).get("file", ""))
        if not VOICE_FILE.fullmatch(f) or not (d / f).is_file() or f in seen:
            raise HttpError(400, f"voix inconnue dans cet élément : {f or '?'}")
        seen.add(f)
        prev = old.get(f) or {}
        entry = {**prev, "file": f, "role": "voice", "label": str(v.get("label", prev.get("label", "voix")))[:80]}
        if not prev:
            if isinstance(v.get("item"), str) and library.get(v["item"]):
                entry["item"] = v["item"]
            entry.update(library.probe(d / f))
        out.append(entry)
    return out


def set_refs(req, item_id):
    """Pose la liste des références d'un élément, dans l'ordre donné :
    réordonner, changer un rôle, retirer, et remettre une référence qu'on
    vient de retirer (son fichier reste dans le dossier de l'élément ;
    `POST /api/library/<id>` ne sait pas la faire revenir). `voices`, s'il
    est donné, pose de même la voix de l'élément."""
    it = library.get(item_id)
    if not it or it["kind"] != "element":
        raise HttpError(404, f"élément introuvable : {item_id}")
    body = req.json()
    refs, voices = body.get("refs"), body.get("voices")
    if refs is None and voices is None:
        raise HttpError(400, "refs ou voices : la liste des références")
    if (refs is not None and not isinstance(refs, list)) or (voices is not None and not isinstance(voices, list)):
        raise HttpError(400, "refs et voices sont des listes")
    d = library.folder_of(item_id)
    vout = _set_voices(it, d, voices) if voices is not None else None
    old = {r["file"]: r for r in it["element"]["refs"]}
    out, seen = [], set()
    for r in refs if refs is not None else it["element"]["refs"]:
        f = str((r or {}).get("file", ""))
        if not REF_FILE.fullmatch(f) or not (d / f).is_file():
            raise HttpError(400, f"référence inconnue dans cet élément : {f or '?'}")
        if f in seen:
            raise HttpError(400, f"référence en double : {f}")
        seen.add(f)
        prev = old.get(f) or {}
        entry = {**prev, "file": f, "role": str(r.get("role", prev.get("role", "")))[:40],
                 "label": str(r.get("label", prev.get("label", "")))[:80]}
        thumb = Path(f).stem + ".thumb.jpg"
        if (d / thumb).is_file():
            entry["thumb"] = thumb
        if not prev:
            if isinstance(r.get("item"), str) and library.get(r["item"]):
                entry["item"] = r["item"]
            entry.update(library.probe(d / f))
        out.append(entry)
    with library._lock:
        it["element"]["refs"] = out
        if out and out[0].get("thumb"):
            it["thumb"] = out[0]["thumb"]
        elif not out:
            it.pop("thumb", None)
        if vout is not None:
            if vout:
                it["element"]["voices"] = vout
            else:
                it["element"].pop("voices", None)
        it["updated"] = library.now()
        library._save(it)
    return library.public(it)


# ── Character Factory : remettre à jour un personnage importé ─
def cf_refresh(req):
    """Relit le personnage dans le studio et remplace les références de
    l'élément sur place : son id ne change pas, donc tout ce qui l'appelle
    déjà (un plan de Movie Creator, une image) suit. Titre, dossier,
    favori et tags restent ceux de Cal. Rien n'est touché si le studio ne
    rend aucune image."""
    iid = req.json().get("id", "")
    it = library.get(iid)
    if not it or it["kind"] != "element":
        raise HttpError(404, f"élément introuvable : {iid}")
    src = it["element"].get("source") or {}
    slug = src.get("slug", "")
    if src.get("tool") != "character-factory" or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", slug):
        raise HttpError(400, "cet élément ne vient pas de Character Factory")
    c = json.loads(core_api._cf_get(f"/api/characters/{slug}")).get("character") or {}
    tmp = config.data_dir() / "cf_import" / f"refresh-{slug}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True, exist_ok=True)
    got: list[dict] = []

    def fetch(rel, role: str, label: str = "") -> None:
        # même lecture que core_api.cf_import : un chemin relatif au dossier du personnage
        if not rel or not isinstance(rel, str) or ".." in rel:
            return
        ext = Path(rel).suffix.lower() or ".png"
        if ext not in (".png", ".jpg", ".jpeg", ".webp") and not (role == "voice" and ext in library.AUDIO_EXT):
            return
        dest = tmp / f"{len(got):02d}{ext}"
        try:
            dest.write_bytes(core_api._cf_get(urllib.parse.quote(f"/files/{slug}/{rel}"), timeout=60))
        except HttpError:
            return
        got.append({"path": dest, "role": role, "label": label})

    core_api._walk_cf(c, fetch)            # les images, puis la voix s'il en a une
    if not any(r["role"] != "voice" for r in got):
        shutil.rmtree(tmp, ignore_errors=True)
        raise HttpError(409, "le studio ne rend aucune image validée pour ce personnage : l'élément reste tel quel")
    d = library.folder_of(iid)
    with library._lock:
        for r in it["element"]["refs"] + (it["element"].get("voices") or []):
            for name in (r.get("file"), r.get("thumb")):
                if name:
                    (d / name).unlink(missing_ok=True)
        it["element"]["refs"] = []
        it["element"].pop("voices", None)
        it.pop("thumb", None)
        for r in got:
            library.add_ref(iid, r["path"], r["role"], r["label"])
        desc = core_api._cf_description(c)
        if desc:
            it["element"]["description"] = desc
        it["element"]["source"] = {**src, "refreshed": library.now()}
        it["updated"] = library.now()
        library._save(it)
    shutil.rmtree(tmp, ignore_errors=True)
    return library.public(it)


def register(app) -> None:
    app.route("GET", "/api/asset/view", view)
    app.route("POST", "/api/asset/move", move)
    app.route("POST", "/api/asset/folders/rename", rename_folder)
    app.route("GET", "/api/asset/lineage/{item_id}", lineage)
    app.route("GET", "/api/asset/trash", trash_list)
    app.route("GET", "/api/asset/trash/{item_id}/thumb", trash_thumb)
    app.route("POST", "/api/asset/cf/refresh", cf_refresh)
    app.route("POST", "/api/asset/refs/{item_id}", set_refs)
    app.route("POST", "/api/asset/bulk", bulk)
    app.route("POST", "/api/asset/trash", trash_many)
    app.route("POST", "/api/asset/restore", restore_many)
    app.route("POST", "/api/asset/zip", zip_make)
    app.route("GET", "/api/asset/zip/{token}/{name}", zip_get)


# ── le contrôle, sans GPU ───────────────────────────────────
def selftest(call, ok) -> None:
    import io
    from PIL import Image

    def png(color) -> bytes:
        buf = io.BytesIO()
        Image.new("RGB", (40, 30), color).save(buf, "PNG")
        return buf.getvalue()

    st, a = call("PUT", "/api/library/upload?name=a.png&title=Asset%20A", raw=png((200, 10, 10)))
    st2, b = call("PUT", "/api/library/upload?name=b.png&title=Asset%20B", raw=png((10, 200, 10)))
    ok(st == 200 and st2 == 200, "asset : deux images déposées")
    st, m = call("POST", "/api/asset/move", {"ids": [a["id"], b["id"]], "folder": "  Essai   asset "})
    ok(st == 200 and m["folder"] == "Essai asset" and len(m["moved"]) == 2, f"asset : ranger deux objets ({st} {m})")
    st, v = call("GET", "/api/asset/view?sort=new")
    f = [x for x in v.get("folders", []) if x["name"] == "Essai asset"]
    ok(st == 200 and f and f[0]["count"] == 2 and len(f[0]["preview"]) == 2, "asset : le dossier à la racine, ses vignettes en petit")
    ok(all(it["id"] not in (a["id"], b["id"]) for it in v["items"]), "asset : un objet rangé quitte la racine")
    st, v = call("GET", "/api/asset/view?folder=Essai%20asset&kind=image")
    ok(st == 200 and v["total"] == 2 and v["counts"]["image"] == 2, "asset : ouvrir un dossier")
    st, v = call("GET", "/api/asset/view?q=Asset%20A")
    ok(st == 200 and any(it["id"] == a["id"] for it in v["items"]), "asset : la recherche traverse les dossiers")
    st, bad = call("POST", "/api/asset/move", {"ids": [a["id"]], "folder": "a/b"})
    ok(st == 400, "asset : pas de dossier dans un dossier")
    st, r = call("POST", "/api/asset/folders/rename", {"from": "Essai asset", "to": "Renommé"})
    ok(st == 200 and r["renamed"] == 2, f"asset : renommer un dossier ({st} {r})")
    st, got = call("GET", f"/api/library/{a['id']}")
    ok(got.get("folder") == "Renommé", "asset : ses objets suivent")
    st, c = call("POST", "/api/elements", {"title": "Él", "type": "object", "refs": [{"item": a["id"], "role": "view"}]})
    st, lin = call("GET", f"/api/asset/lineage/{a['id']}")
    ok(st == 200 and any(x["id"] == c["id"] for x in lin["children"]), "asset : la lignée, un enfant")
    st, lin = call("GET", f"/api/asset/lineage/{c['id']}")
    ok(st == 200 and any(x["id"] == a["id"] for x in lin["parents"]), "asset : la lignée, un parent")
    call("POST", f"/api/library/{b['id']}/delete")
    st, t = call("GET", "/api/asset/trash")
    ok(st == 200 and any(x["id"] == b["id"] and x["thumb_url"] for x in t["items"]), "asset : la corbeille se liste")
    st, raw = call("GET", f"/api/asset/trash/{b['id']}/thumb")
    ok(st == 200 and isinstance(raw, bytes) and raw[:2] == b"\xff\xd8", "asset : la vignette d'un objet jeté")
    st, _ = call("GET", "/api/asset/trash/..%2F..%2Fjobs.json/thumb")
    ok(st in (400, 404), "asset : la corbeille ne sort pas de son dossier")   # 400 : la garde du routeur
    st, back = call("POST", f"/api/library/{b['id']}/restore")
    ok(st == 200 and back["id"] == b["id"], "asset : retour de la corbeille")
    st, _ = call("POST", "/api/asset/cf/refresh", {"id": c["id"]})
    ok(st == 400, "asset : remettre à jour refuse un élément qui ne vient pas de Character Factory")
    st, c2 = call("POST", f"/api/elements/{c['id']}/refs", {"item": b["id"], "role": "detail"})
    refs = c2["element"]["refs"]
    ok(st == 200 and len(refs) == 2, "asset : une deuxième référence")
    st, c3 = call("POST", f"/api/asset/refs/{c['id']}", {"refs": [{"file": refs[1]["file"], "role": "style"}]})
    ok(st == 200 and [r["file"] for r in c3["element"]["refs"]] == [refs[1]["file"]]
       and c3["element"]["refs"][0]["role"] == "style", f"asset : retirer une référence, changer un rôle ({st})")
    st, c4 = call("POST", f"/api/asset/refs/{c['id']}", {"refs": [{"file": r["file"], "role": r["role"], "label": r["label"],
                                                                    "item": r.get("item")} for r in reversed(refs)]})
    ok(st == 200 and [r["file"] for r in c4["element"]["refs"]] == [refs[1]["file"], refs[0]["file"]]
       and c4["element"]["refs"][1].get("item") == a["id"], "asset : la référence retirée revient, l'ordre est gardé")
    st, _ = call("POST", f"/api/asset/refs/{c['id']}", {"refs": [{"file": "../item.json"}]})
    ok(st == 400, "asset : une référence hors de l'élément est refusée")

    # la catégorie Upload : ce qu'on dépose, à part de ce que les outils font
    st, u = call("PUT", "/api/library/upload?name=u.png&title=Depot&tool=upload&via=asset", raw=png((9, 9, 200)))
    ok(st == 200 and u["origin"].get("via") == "asset", "asset : un dépôt dit par où il est entré (via)")
    st, v = call("GET", "/api/asset/view?origin=upload&q=Depot")
    ok(st == 200 and [i["id"] for i in v["items"]] == [u["id"]] and v["origins"]["upload"] >= 1, "asset : l'onglet Uploads")
    st, v = call("GET", "/api/asset/view?origin=made&q=%C3%89l")
    ok(st == 200 and any(i["id"] == c["id"] for i in v["items"]) and all(i["origin"]["tool"] != "upload" for i in v["items"]),
       "asset : l'onglet des créations")

    # plusieurs à la fois
    st, bk = call("POST", "/api/asset/bulk", {"ids": [a["id"], u["id"]], "fav": True, "tags_add": ["lot"]})
    st, g = call("GET", f"/api/library/{u['id']}")
    ok(st == 200 and g["fav"] and g["tags"] == ["lot"] and len(bk["before"]) == 2, "asset : favori et tag en lot")
    st, _ = call("POST", "/api/asset/bulk", {"restore": bk["before"]})
    st, g = call("GET", f"/api/library/{u['id']}")
    ok(not g["fav"] and g["tags"] == [], "asset : annuler un lot")
    st, t = call("POST", "/api/asset/trash", {"ids": [u["id"], b["id"]]})
    st2, gone = call("GET", f"/api/library/{u['id']}")
    ok(st == 200 and len(t["trashed"]) == 2 and st2 == 404, "asset : corbeille en lot")
    st, r = call("POST", "/api/asset/restore", {"ids": [u["id"], b["id"], "../library"]})
    ok(st == 200 and sorted(r["restored"]) == sorted([u["id"], b["id"]]), "asset : retour en lot, un id mal formé ignoré")

    # le zip : une image à son titre, un élément en dossier avec ses références
    import zipfile as _z
    st, zp = call("POST", "/api/asset/zip", {"ids": [a["id"], c["id"]]})
    ok(st == 200 and zp["files"] == 3 and zp["url"].startswith("api/asset/zip/"), f"asset : un zip de la sélection ({st} {zp})")
    st, raw = call("GET", "/" + zp["url"])
    names = sorted(_z.ZipFile(io.BytesIO(raw)).namelist()) if st == 200 else []
    ok(names == ["Asset A.png", "Él/01 détail.png", "Él/02 vue.png"], f"asset : ce que le zip contient ({names})")
    st, _ = call("GET", "/api/asset/zip/0123456789abcdef/../jobs.json")
    ok(st == 404, "asset : le zip ne sert que ses fichiers")

    # la voix d'un élément : un son, à côté des images, jamais parmi elles
    import subprocess
    wav = config.data_dir() / "voix_selftest.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=1.5", str(wav)],
                   capture_output=True, timeout=60)
    st, snd = call("PUT", "/api/library/upload?name=voix.wav&title=Voix&tool=upload&via=asset", raw=wav.read_bytes())
    ok(st == 200 and snd["kind"] == "audio", "asset : un son déposé")
    st, e2 = call("POST", f"/api/elements/{c['id']}/refs", {"item": snd["id"], "role": "voice"})
    vs = (e2.get("element") or {}).get("voices") or []
    ok(st == 200 and len(vs) == 1 and vs[0]["role"] == "voice" and vs[0]["url"].endswith(vs[0]["file"])
       and abs(vs[0].get("duration", 0) - 1.5) < 0.2 and "thumb" not in vs[0], f"asset : une voix ajoutée, avec sa durée ({st} {vs})")
    ok(all(r["file"].startswith("ref-") for r in e2["element"]["refs"]), "asset : la voix n'entre pas dans les références d'images")
    from core import library as _lib
    ok(len(_lib.ref_paths(_lib.get(c["id"]))) == len(e2["element"]["refs"])
       and len(_lib.ref_paths(_lib.get(c["id"]), ["voice"])) == 1, "asset : ref_paths ne rend la voix que si on la demande")
    st, e3 = call("POST", "/api/elements", {"title": "Avec voix", "type": "character",
                                            "refs": [{"item": a["id"], "role": "face"}, {"item": snd["id"], "role": "voice"}]})
    ok(st == 200 and len(e3["element"]["refs"]) == 1 and len(e3["element"].get("voices") or []) == 1,
       "asset : un élément créé avec une image et une voix")
    st, e4 = call("POST", f"/api/asset/refs/{c['id']}", {"voices": []})
    ok(st == 200 and not e4["element"].get("voices") and len(e4["element"]["refs"]) == 2, "asset : retirer la voix, les images restent")
    st, e5 = call("POST", f"/api/asset/refs/{c['id']}", {"voices": [{"file": vs[0]["file"], "label": "voix grave", "item": snd["id"]}]})
    ok(st == 200 and e5["element"]["voices"][0]["label"] == "voix grave", "asset : la voix revient (annuler)")
    st, zp = call("POST", "/api/asset/zip", {"ids": [c["id"]]})
    st, raw = call("GET", "/" + zp["url"])
    names = sorted(_z.ZipFile(io.BytesIO(raw)).namelist()) if st == 200 else []
    ok("Él/voix · voix grave.wav" in names, f"asset : le zip d'un élément apporte sa voix ({names})")
    st, lin = call("GET", f"/api/asset/lineage/{snd['id']}")
    ok(any(x["id"] == c["id"] for x in lin["children"]), "asset : la lignée d'un son mène à l'élément qui le porte")
