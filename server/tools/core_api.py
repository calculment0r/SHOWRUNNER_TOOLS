"""Les routes communes : la bibliothèque, les éléments, la file, les
machines. Chaque outil ajoute les siennes dans son propre module."""

from __future__ import annotations

import json
import re
import shutil
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

from core import config, jobs, library
from core.comfy import Comfy, ComfyError
from core.http import HttpError, Response

SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]+")


def _item_or_404(item_id: str) -> dict:
    it = library.get(item_id)
    if not it:
        raise HttpError(404, f"introuvable : {item_id}")
    return it


# ── bibliothèque ────────────────────────────────────────────
def lib_list(req):
    kinds = [k for k in req.q("kind").split(",") if k] or None
    folder = req.query.get("folder", [None])[0]
    return library.query(kinds, req.q("q"), folder, req.q("sort", "new"), int(req.q("limit", "200")),
                         int(req.q("offset", "0")), req.q("fav") == "1", req.q("tool"))


def lib_get(req, item_id):
    return library.public(_item_or_404(item_id))


def lib_upload(req):
    """PUT /api/library/upload?name=photo.jpg&title=…&folder=… — le corps est le fichier."""
    name = SAFE_NAME.sub("_", req.q("name", "fichier"))[:120] or "fichier"
    ext = Path(name).suffix.lower()
    if ext not in library.EXT_KIND:
        raise HttpError(415, f"type non pris : {ext or 'sans extension'} (images PNG/JPEG/WEBP, vidéos MP4/WEBM/MOV, sons WAV/MP3/FLAC/M4A/OGG)")
    tmp = config.data_dir() / "uploads"
    tmp.mkdir(exist_ok=True)
    dest = tmp / f"{int(time.time() * 1000)}_{name}"
    req.stream_to(dest)
    try:
        it = library.add_file(dest, title=req.q("title") or Path(name).stem, folder=req.q("folder"),
                              origin={"tool": req.q("tool") or "upload"}, move=True)
    finally:
        dest.unlink(missing_ok=True)
    return library.public(it)


def lib_update(req, item_id):
    _item_or_404(item_id)
    return library.public(library.update(item_id, req.json()))


def lib_delete(req, item_id):
    _item_or_404(item_id)
    library.trash(item_id)
    return {"ok": True, "trashed": item_id}


def lib_restore(req, item_id):
    try:
        return library.public(library.restore(item_id))
    except KeyError as e:
        raise HttpError(404, f"pas dans la corbeille : {item_id}") from e


# ── éléments ────────────────────────────────────────────────
def el_create(req):
    d = req.json()
    try:
        it = library.create_element(d.get("title", ""), d.get("type", "character"), d.get("description", ""),
                                    [{"item": r["item"], "role": r.get("role", ""), "label": r.get("label", "")}
                                     for r in d.get("refs", []) if r.get("item")],
                                    tags=d.get("tags"), folder=d.get("folder", ""))
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    return library.public(it)


def el_add_ref(req, item_id):
    d = req.json()
    src = _item_or_404(d.get("item", ""))
    if src["kind"] != "image":
        raise HttpError(400, "une référence est une image")
    try:
        it = library.add_ref(item_id, library.path_of(src), d.get("role", ""), d.get("label", ""), src["id"])
    except KeyError as e:
        raise HttpError(404, "élément introuvable") from e
    return library.public(it)


# ── Character Factory : ses personnages deviennent des éléments ──
def _cf_get(path: str, timeout: float = 15.0):
    url = config.get("cf_api").rstrip("/") + path
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.read()
    except OSError as e:
        raise HttpError(502, f"le studio Character Factory ne répond pas ({config.get('cf_api')}) : {e}") from e


def cf_characters(req):
    data = json.loads(_cf_get("/api/characters"))
    base = config.get("cf_public").rstrip("/")
    out = []
    for c in data.get("characters", []):
        out.append({"slug": c["slug"], "name": c.get("name") or c["slug"], "style": c.get("style"),
                    "locked": c.get("locked"), "costumes": c.get("costumes", 0),
                    "expressions": c.get("expressions", 0), "looks": c.get("looks", 0),
                    "thumb": "api/cf/file?path=" + urllib.parse.quote(c['thumb']) if c.get("thumb") else None,
                    "poster": "api/cf/file?path=" + urllib.parse.quote(c['poster']) if c.get("poster") else None,
                    "open": f"{base}/studio.html#/p/{c['slug']}",
                    "imported": [i["id"] for i in _cf_imports(c["slug"])]})
    return {"characters": out, "studio": base + "/"}


def cf_file(req):
    """Relais d'une image du studio (les vignettes du sélecteur) : lecture seule, /files/ seulement."""
    path = req.q("path")
    if not path.startswith("/files/") or ".." in path:
        raise HttpError(400, "chemin refusé")
    ext = Path(path).suffix.lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        raise HttpError(415, "image seulement")
    return Response(_cf_get(urllib.request.quote(path)), 200, "image/jpeg" if ext in (".jpg", ".jpeg") else f"image/{ext[1:]}")


def _cf_imports(slug: str) -> list[dict]:
    got = library.query(["element"], limit=10000)["items"]
    return [i for i in got if (i["element"].get("source") or {}).get("slug") == slug]


def cf_import(req):
    """Fait d'un personnage de Character Factory un élément : son visage
    verrouillé, ses looks, chaque tenue en plein pied, ses expressions.
    Le relire plus tard en refait un élément à jour (l'ancien reste)."""
    slug = req.json().get("slug", "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", slug):
        raise HttpError(400, "slug invalide")
    c = json.loads(_cf_get(f"/api/characters/{slug}")).get("character") or {}
    tmp = config.data_dir() / "cf_import" / slug
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True, exist_ok=True)
    refs = []

    def fetch(rel: str | None, role: str, label: str = "") -> None:
        """`rel` : un chemin relatif au dossier du personnage (face/locked.png…)."""
        if not rel or not isinstance(rel, str) or ".." in rel:
            return
        ext = Path(rel).suffix.lower() or ".png"
        if ext not in (".png", ".jpg", ".jpeg", ".webp"):
            return
        dest = tmp / f"{len(refs):02d}{ext}"
        try:
            dest.write_bytes(_cf_get(urllib.request.quote(f"/files/{slug}/{rel}"), timeout=60))
        except HttpError:
            return
        refs.append({"path": dest, "role": role, "label": label})

    _walk_cf(c, fetch)
    if not refs:
        raise HttpError(409, "ce personnage n'a encore aucune image validée (visage verrouillé, plein pied…)")
    desc = _cf_description(c)
    it = library.create_element(c.get("name") or slug, "character", desc, refs,
                                source={"tool": "character-factory", "slug": slug,
                                        "open": config.get("cf_public").rstrip("/") + f"/studio.html#/p/{slug}"})
    shutil.rmtree(tmp, ignore_errors=True)
    return library.public(it)


def _walk_cf(c: dict, fetch) -> None:
    """Les images d'un personnage, dans l'ordre où un modèle les veut :
    visage d'abord, puis le plein pied de chaque tenue, puis le reste."""
    # manifeste de Character Factory (factory/project.py, looks.py, presentation.py) :
    # face.locked, face.looks[{name, file, status}], costumes{clé: {name,
    # fullbody.validated, presentation.panels.expressions[{id, label, file}]}}
    face = c.get("face") or {}
    fetch(face.get("locked"), "face", "visage")
    for lk in face.get("looks") or []:
        if isinstance(lk, dict) and lk.get("status") == "ready":
            fetch(lk.get("file"), "face", lk.get("name") or "look")
    costumes = c.get("costumes") or {}
    for key, cos in costumes.items():
        if isinstance(cos, dict):
            fetch((cos.get("fullbody") or {}).get("validated"), "full body", cos.get("name") or key)
    for key, cos in costumes.items():
        if not isinstance(cos, dict):
            continue
        for ex in ((cos.get("presentation") or {}).get("panels") or {}).get("expressions") or []:
            if isinstance(ex, dict):
                fetch(ex.get("file"), "expression", ex.get("label") or ex.get("id") or "expression")


def _cf_description(c: dict) -> str:
    """La prose qu'un modèle lira : ce que la fiche d'identité dit du
    physique (factory/schema : face_description, body_type, age…)."""
    ident = c.get("identity") or {}
    bits = []
    if isinstance(ident, dict):
        head = ", ".join(str(ident[k]) for k in ("gender", "age", "ethnicity", "body_type", "height") if ident.get(k))
        if head:
            bits.append(head + ".")
        for k in ("face_description", "default_outfit_description", "personality_traits"):
            v = ident.get(k)
            if isinstance(v, str) and v.strip():
                bits.append(v.strip().rstrip(".") + ".")
    if c.get("style_desc"):
        bits.append("Style : " + str(c["style_desc"]).strip())
    return " ".join(bits)[:2000]


# ── la file ─────────────────────────────────────────────────
def jobs_list(req):
    return {"jobs": jobs.listing(req.q("active") == "1", req.q("tool"), int(req.q("limit", "80")))}


def jobs_submit(req):
    d = req.json()
    try:
        j = jobs.submit(d["kind"], d.get("params") or {}, title=d.get("title", ""), tool=d.get("tool", ""))
    except KeyError as e:
        raise HttpError(400, str(e)) from e
    return jobs.public(j)


def jobs_get(req, job_id):
    j = jobs.get(job_id)
    if not j:
        raise HttpError(404, "travail introuvable")
    out = jobs.public(j)
    out["items"] = [library.public(i) for i in (library.get(x) for x in j["result"].get("items", [])) if i]
    return out


def jobs_cancel(req, job_id):
    try:
        return jobs.public(jobs.cancel(job_id))
    except KeyError as e:
        raise HttpError(404, "travail introuvable") from e


def jobs_retry(req, job_id):
    try:
        return jobs.public(jobs.retry(job_id))
    except KeyError as e:
        raise HttpError(404, "travail introuvable") from e


def jobs_forget(req, job_id):
    jobs.forget(job_id)
    return {"ok": True}


# ── les machines ────────────────────────────────────────────
_sys_cache: dict = {"t": 0.0, "v": None}
_sys_lock = threading.Lock()


def system(req):
    with _sys_lock:
        if time.time() - _sys_cache["t"] < 4 and _sys_cache["v"]:
            return _sys_cache["v"]
    lanes = {}
    for lane, eps in config.get("lanes", {}).items():
        lanes[lane] = []
        for ep in eps:
            if ep == "local":
                continue
            ok, why = jobs.endpoint_alive(ep)
            entry = {"url": ep, "machine": jobs.machine_of(ep), "up": ok}
            if ok:
                try:
                    st = Comfy(ep).ping()
                    sysinfo = st.get("system", {})
                    entry["ram_free_gb"] = round(sysinfo.get("ram_free", 0) / 1e9, 1)
                    entry["ram_total_gb"] = round(sysinfo.get("ram_total", 0) / 1e9, 1)
                    entry["comfyui"] = sysinfo.get("comfyui_version")
                except ComfyError:
                    pass
            else:
                entry["why"] = why[:200]
            lanes[lane].append(entry)
    try:
        _cf_get("/api/system", timeout=3)
        cf = True
    except HttpError:
        cf = False
    v = {"lanes": lanes, "cf_studio": {"up": cf, "url": config.get("cf_public")},
         "queued": len(jobs.listing(active=True)), "host": _hostname()}
    with _sys_lock:
        _sys_cache.update(t=time.time(), v=v)
    return v


def _hostname() -> str:
    import socket
    return socket.gethostname()


def register(app) -> None:
    app.route("GET", "/api/library", lib_list)
    app.route("PUT", "/api/library/upload", lib_upload)
    app.route("GET", "/api/library/{item_id}", lib_get)
    app.route("POST", "/api/library/{item_id}", lib_update)
    app.route("POST", "/api/library/{item_id}/delete", lib_delete)
    app.route("POST", "/api/library/{item_id}/restore", lib_restore)
    app.route("POST", "/api/elements", el_create)
    app.route("POST", "/api/elements/{item_id}/refs", el_add_ref)
    app.route("GET", "/api/cf/characters", cf_characters)
    app.route("GET", "/api/cf/file", cf_file)
    app.route("POST", "/api/cf/import", cf_import)
    app.route("GET", "/api/jobs", jobs_list)
    app.route("POST", "/api/jobs", jobs_submit)
    app.route("GET", "/api/jobs/{job_id}", jobs_get)
    app.route("POST", "/api/jobs/{job_id}/cancel", jobs_cancel)
    app.route("POST", "/api/jobs/{job_id}/retry", jobs_retry)
    app.route("POST", "/api/jobs/{job_id}/forget", jobs_forget)
    app.route("GET", "/api/system", system)
