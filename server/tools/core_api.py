"""Les routes communes : la bibliothèque, les éléments, la file, les
machines. Chaque outil ajoute les siennes dans son propre module."""

from __future__ import annotations

import json
import re
import secrets
import shutil
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from core import auth, config, jobs, library
from core.comfy import Comfy, ComfyError
from core.http import FileResponse, HttpError, Response

SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]+")


def _item_or_404(item_id: str, show: bool = False) -> dict:
    """L'objet, ou 404 — on ne dit pas qu'un objet invisible existe. Par défaut, borné au
    Workspace courant (library.get : ce dont un outil se sert) ; `show` : où qu'il soit,
    s'il se voit (library.see : pour MONTRER seulement — la fiche d'Asset, une copie
    d'affichage ; docs/etudes/equipes_espaces.md § 3.1). Rien ne s'écrit par `show`."""
    it = library.see(item_id) if show else library.get(item_id)
    if not it:
        raise HttpError(404, f"introuvable : {item_id}")
    return it


def elsewhere_or_404(item_id: str) -> dict:
    """Pour s'en SERVIR (modifier, jeter, en faire une référence) : l'objet du Workspace
    courant. Un objet qu'on voit mais qui est dans un autre Workspace : 409 qui dit où, et
    ce qui débloque (y passer, ou le rapatrier) ; invisible ou absent : 404."""
    it = library.get(item_id)
    if it:
        return it
    other = library.see(item_id)
    if other:
        raise HttpError(409, f"« {other.get('title') or item_id} » est dans le Workspace « {library.space_name(library.space_of(other))} » : "
                             f"on ne s'en sert que là — passe dans ce Workspace, ou rapatrie-le ici (Asset, « Rapatrier »)")
    raise HttpError(404, f"introuvable : {item_id}")


def _wants_all(v) -> bool:
    """`spaces=*` : montrer où qu'il soit (library.query(spaces="*"), see)."""
    return str(v or "") == "*"


# ── bibliothèque ────────────────────────────────────────────
def lib_list(req):
    kinds = [k for k in req.q("kind").split(",") if k] or None
    folder = req.query.get("folder", [None])[0]
    return library.query(kinds, req.q("q"), folder, req.q("sort", "new"), int(req.q("limit", "200")),
                         int(req.q("offset", "0")), req.q("fav") == "1", req.q("tool"))


def lib_get(req, item_id):
    """GET /api/library/<id>[?spaces=*] — `spaces=*` : la fiche d'un objet d'un autre
    Workspace qu'on voit (montrer : Asset, le dépôt d'une vignette qui va la rapatrier)."""
    return library.public(_item_or_404(item_id, show=_wants_all(req.q("spaces"))))


BATCH_MAX = 2000


def lib_batch(req):
    """POST /api/library/batch {ids: […]} — les fiches de plusieurs objets en
    une requête (une planche de 1000 images en lisait 1000 : 1004 requêtes
    → 6, docs/etudes/ideation_fluidite.md). Dans l'ordre demandé, sans
    doublon ; un objet absent ou invisible est dans `missing`, sans dire
    lequel des deux. `spaces: "*"` : où qu'ils soient, s'ils se voient (montrer)."""
    d = req.json()
    ids = d.get("ids")
    if not isinstance(ids, list) or len(ids) > BATCH_MAX or not all(isinstance(i, str) for i in ids):
        raise HttpError(400, f"ids : une liste de {BATCH_MAX} identifiants au plus")
    read = library.see if _wants_all(d.get("spaces")) else library.get
    items, missing = [], []
    for i in dict.fromkeys(ids):
        it = read(i)
        if it:
            items.append(library.public(it))
        else:
            missing.append(i)
    return {"items": items, "missing": missing}


def lib_view(req, item_id):
    """GET /api/library/<id>/view?w=256|512|1024|2048 — la copie d'affichage
    de cette taille (grand côté, px), ou la plus proche au-dessus, ou
    l'original (library.view_path). Revalidée à chaque fois (ETag, 304) :
    les adresses versionnées de `view_urls` se gardent, elles, un an. Montrer : jugé
    par l'objet, où qu'il soit (comme les fichiers servis sous /library/)."""
    it = _item_or_404(item_id, show=True)
    try:
        w = int(req.q("w"))
    except ValueError:
        w = 0
    if w <= 0:
        raise HttpError(400, "w : la taille voulue, en px de grand côté (256, 512, 1024, 2048)")
    p = library.view_path(it, w)
    if not p or not p.is_file():
        raise HttpError(404, f"rien à montrer pour {item_id}")
    return FileResponse(p)


VIEWS_THREADS = 4


def views_job(ctx):
    """Le rattrapage des copies d'affichage (voie cpu) : les objets `ids`, ou
    tous ceux rangés avant elles. `force` (un admin seulement) les refait."""
    p = ctx.params
    force = bool(p.get("force")) and auth.is_admin(auth.current())
    ids = [i for i in p.get("ids") or [] if isinstance(i, str)] or library.missing_views(everything=force)
    done = 0
    pool = ThreadPoolExecutor(max_workers=VIEWS_THREADS)   # PIL lâche le GIL en décodant et en encodant
    try:
        for k, got in enumerate(pool.map(lambda i: library.ensure_views(i, force=force), ids)):
            ctx.check()
            done += got is not None
            ctx.progress((k + 1) / max(1, len(ids)), f"{k + 1} / {len(ids)}")
    finally:
        pool.shutdown(wait=True, cancel_futures=True)   # arrêté : ce qui n'a pas commencé ne part pas
    return {"note": f"copies d'affichage : {done} objet{'s' if done > 1 else ''}", "views_done": done}


def lib_views(req):
    """POST /api/library/views {ids?, force?} — relancer le rattrapage (admin)."""
    if not auth.is_admin(auth.current()):
        raise HttpError(403, "réservé aux admins")
    d = req.json()
    return jobs.public(jobs.submit("library.views", {"ids": d.get("ids") or [], "force": bool(d.get("force"))},
                                   title="Copies d'affichage", tool="asset", priority=-1))


def _views_on_start() -> None:
    """Au démarrage : les images et vidéos rangées avant leurs copies
    d'affichage partent au rattrapage, en priorité basse (juste par
    construction : rien à lancer à la main après un déploiement)."""
    todo = library.missing_views()
    if todo:
        jobs.submit("library.views", {}, title=f"Copies d'affichage · {len(todo)} objets", tool="asset",
                    owner=None, priority=-1)


def lib_upload(req):
    """PUT /api/library/upload?name=photo.jpg&title=…&folder=… — le corps est le fichier."""
    name = SAFE_NAME.sub("_", req.q("name", "fichier"))[:120] or "fichier"
    ext = Path(name).suffix.lower()
    if ext not in library.EXT_KIND:
        raise HttpError(415, f"type non pris : {ext or 'sans extension'} (images PNG/JPEG/WEBP, vidéos MP4/WEBM/MOV, sons WAV/MP3/FLAC/M4A/OGG)")
    kind = library.EXT_KIND[ext]
    u = auth.current()
    if not auth.is_admin(u):   # un ami : la taille de sa sorte (config `upload_max_mb`) ; Cal : 2 Go (core/http.py)
        mb = (config.get("upload_max_mb") or {}).get(kind)
        if mb and req._length() > mb * 1_000_000:
            raise HttpError(413, f"fichier trop gros : {mb} Mo au plus pour {'une image' if kind == 'image' else 'un fichier ' + ext}")
    tmp = config.data_dir() / "uploads"
    tmp.mkdir(exist_ok=True)
    dest = tmp / f"{int(time.time() * 1000)}_{secrets.token_hex(4)}_{name}"
    req.stream_to(dest)
    try:
        with open(dest, "rb") as f:
            head = f.read(16)
        if not library.sniff(head, ext):   # le contenu doit être ce que dit le nom (PIL, ffmpeg ne devinent rien d'autre)
            raise HttpError(415, f"ce fichier n'est pas un {ext[1:].upper()} : son contenu ne correspond pas à son nom")
        it = library.add_file(dest, title=req.q("title") or Path(name).stem, folder=req.q("folder"),
                              origin={"tool": req.q("tool") or "upload",
                                      # par où un fichier déposé est entré (sélecteur, montage, odio…)
                                      **({"via": req.q("via")[:40]} if req.q("via") else {})}, move=True)
    finally:
        dest.unlink(missing_ok=True)
    return library.public(it)


def lib_update(req, item_id):
    elsewhere_or_404(item_id)
    try:
        return library.public(library.update(item_id, req.json()))
    except ValueError as e:
        raise HttpError(400, str(e)) from e


def lib_delete(req, item_id):
    elsewhere_or_404(item_id)
    library.trash(item_id)
    return {"ok": True, "trashed": item_id}


def lib_restore(req, item_id):
    try:
        return library.public(library.restore(item_id))
    except KeyError as e:
        raise HttpError(404, f"pas dans la corbeille : {item_id}") from e
    except ValueError as e:
        raise HttpError(409, str(e)) from e


# ── éléments ────────────────────────────────────────────────
def el_create(req):
    d = req.json()
    refs = d.get("refs", [])
    if not isinstance(refs, list):
        raise HttpError(400, "refs : une liste")
    for r in refs:   # une référence est un objet qu'on a le droit de voir, de ce Workspace
        if isinstance(r, dict) and r.get("item"):
            elsewhere_or_404(str(r["item"]))
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
    src = elsewhere_or_404(str(d.get("item", "")))
    if src["kind"] not in ("image", "audio"):
        raise HttpError(400, "une référence est une image, ou un son pour la voix")
    try:
        it = library.add_ref(item_id, library.path_of(src), d.get("role", ""), d.get("label", ""), src["id"])
    except KeyError as e:
        raise HttpError(404, "élément introuvable") from e
    return library.public(it)


def el_part(req, item_id):
    """Une partie d'un élément (une de ses images : visage, plein pied, expression, planche)
    en image de la bibliothèque, pour la poser seule (Idéation, le panneau de l'élément :
    Cal, 05/10, « on peut glisser ces assets de notre élément dans le canvas »). L'image d'où
    venait la référence (`item`) sert telle quelle ; sinon une image naît une fois, fille de
    l'élément, et la référence la retient (le geste suivant la reprend)."""
    d = req.json()
    el = elsewhere_or_404(item_id)
    if el["kind"] != "element":
        raise HttpError(400, "ce n'est pas un élément")
    name = str(d.get("file", ""))
    refs = (el.get("element") or {}).get("refs") or []
    ref = next((r for r in refs if r.get("file") == name), None)
    if not ref:
        raise HttpError(404, f"cette partie n'est plus dans l'élément : {name}")
    if ref.get("item"):
        src = library.get(ref["item"])
        if src and src["kind"] == "image":
            return library.public(src)
    path = library.path_of(el, name)
    if not path.exists():
        raise HttpError(404, "le fichier de cette partie manque")
    label = ref.get("label") or ref.get("role") or "partie"
    try:
        it = library.add_file(path, kind="image", title=f"{el.get('title') or 'élément'} · {label}",
                              origin={"tool": "element", "from": item_id}, parents=[item_id], folder=el.get("folder", ""))
    except (ValueError, PermissionError) as e:
        raise HttpError(400, str(e)) from e
    # la référence retient son image (un élément figé ou d'un autre ne se touche pas : on n'y écrit rien)
    try:
        library.remember_ref_item(item_id, name, it["id"])
    except Exception:
        pass
    return library.public(it)


# ── Character Factory : ses personnages deviennent des éléments ──
def _cf_get(path: str, timeout: float = 15.0):
    url = config.get("cf_api").rstrip("/") + path
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.read()
    except OSError as e:
        raise HttpError(502, f"le studio Character Factory ne répond pas ({config.get('cf_api')}) : {e}") from e


def _cf_open(slug: str = "") -> str:
    """La fiche d'un personnage dans le portail (le front du studio vit
    dans character/ depuis le 29/09). Un chemin depuis la racine, pas une
    adresse relative : la bibliothèque (asset.js) le pose tel quel dans
    son lien, depuis asset/."""
    return "/character/" + (f"#/p/{urllib.parse.quote(slug)}" if slug else "")


def cf_characters(req):
    data = json.loads(_cf_get("/api/characters"))
    out = []
    for c in data.get("characters", []):
        out.append({"slug": c["slug"], "name": c.get("name") or c["slug"], "style": c.get("style"),
                    "locked": c.get("locked"), "costumes": c.get("costumes", 0),
                    "expressions": c.get("expressions", 0), "looks": c.get("looks", 0),
                    "thumb": "api/cf/file?path=" + urllib.parse.quote(c['thumb']) if c.get("thumb") else None,
                    "poster": "api/cf/file?path=" + urllib.parse.quote(c['poster']) if c.get("poster") else None,
                    "open": _cf_open(c["slug"]),
                    "imported": [i["id"] for i in _cf_imports(c["slug"])]})
    return {"characters": out, "studio": _cf_open()}


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
        # des images ; pour la voix, un son
        if ext not in (".png", ".jpg", ".jpeg", ".webp") and not (role == "voice" and ext in library.AUDIO_EXT):
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
                                source={"tool": "character-factory", "slug": slug, "open": _cf_open(slug)})
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
    # sa voix, quand il en a une : elle va dans `element.voices` (library._add_voice)
    fetch(_cf_voice(c.get("voice")), "voice", "voix")


def _cf_voice(voice) -> str | None:
    """Le fichier de la voix choisie, lu comme le studio le lit
    (Character_Factory/factory/studio.py, `_voice_file`) : `locked` est un
    chemin, ou le numéro d'une proposition de `candidates`."""
    if not isinstance(voice, dict) or not voice.get("locked"):
        return None
    locked = voice["locked"]
    if str(locked).isdigit():
        cands = voice.get("candidates") or []
        i = int(locked)
        return (cands[i - 1] or {}).get("file") if 1 <= i <= len(cands) and isinstance(cands[i - 1], dict) else None
    return str(locked)


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
# ce qu'on montre d'un travail qui n'est pas le sien quand chacun ne voit
# que le sien : sa place, pas sa recette (audit du 28/09, M4)
MASKED = ("id", "kind", "lane", "tool", "state", "created", "started", "finished", "progress", "machine", "owner",
          "owner_name", "position", "ahead", "eta_s", "est_s", "priority", "top", "family", "gpu")


def _mine(j: dict, u: dict | None) -> bool:
    return u is None or auth.is_admin(u) or j.get("owner") == u["id"]


def job_out(j: dict, u: dict | None) -> dict:
    mine = bool(u) and j.get("owner") == u["id"]
    if _mine(j, u) or auth.settings()["visibility"] == "all":
        return {**j, "mine": mine, "can": _mine(j, u)}
    out = {k: j.get(k) for k in MASKED}
    out.update(title=f"travail de {j.get('owner_name') or 'quelqu’un'}", mine=False, masked=True, can=False,
               message={"queued": "en file", "running": "en cours"}.get(j["state"], j["state"]))
    return out


def _job_or_404(job_id: str, write: bool = False) -> dict:
    j = jobs.get(job_id)
    u = auth.current()
    if not j:
        raise HttpError(404, "travail introuvable")
    if write and not _mine(j, u):   # audit H4 : arrêter, relancer, retirer — le sien, ou Cal
        raise HttpError(403, f"ce travail est à {j.get('owner_name') or 'quelqu’un d’autre'} : seul·e cette personne "
                             f"(ou {auth.admin_name()}) peut l'arrêter ou le relancer")
    return j


def jobs_list(req):
    jobs.annotate()
    u = auth.current()
    from tools import elements   # ev_seq : le journal des éléments a-t-il avancé dans ce Workspace ? (commun/shell.js)
    return {"jobs": [job_out(j, u) for j in jobs.listing(req.q("active") == "1", req.q("tool"), int(req.q("limit", "80")))],
            "ev_seq": elements.seq_here()}


def queue(req):
    """La file de tous, dans l'ordre : ce qui tourne, ce qui attend (avec sa
    place et son départ estimé), et ce que j'ai fini récemment."""
    u = auth.current()
    v = jobs.queue_view(recent=60)
    mine_done = [j for j in v["done"] if auth.is_admin(u) or (u and j.get("owner") == u["id"])]
    return {"running": [job_out(j, u) for j in v["running"]], "queued": [job_out(j, u) for j in v["queued"]],
            "done": [job_out(j, u) for j in mine_done[:20]], "paused": v["paused"], "machines": v["machines"],
            "me": u["id"] if u else None, "admin": auth.is_admin(u)}


def jobs_submit(req):
    """POST /api/jobs {kind, params, title, tool} — la route commune : seules
    les sortes que leur outil déclare `direct` (jobs.register) y passent pour
    un ami ; les autres partent par la route de leur outil, qui les juge. La
    garde du calcul (la personne, le Workspace, le coût ; puis le Studio d'un
    compte Apps) est dans jobs.submit_direct et jobs.submit, par où passe tout
    travail : rien à juger ici qui pourrait manquer ailleurs."""
    d = req.json()
    try:
        j = jobs.submit_direct(str(d.get("kind") or ""), d.get("params") or {}, title=d.get("title") or "",
                               tool=d.get("tool") or "")
    except KeyError as e:
        raise HttpError(400, str(e).strip("'\"")) from e
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    return jobs.public(j)


def jobs_get(req, job_id):
    j = _job_or_404(job_id)
    out = job_out(jobs.public(j), auth.current())
    if not out.get("masked"):
        out["items"] = [library.public(i) for i in (library.get(x) for x in j["result"].get("items", [])) if i]
    return out


def jobs_cancel(req, job_id):
    _job_or_404(job_id, write=True)
    try:
        return jobs.public(jobs.cancel(job_id))
    except KeyError as e:
        raise HttpError(404, "travail introuvable") from e


def jobs_retry(req, job_id):
    _job_or_404(job_id, write=True)
    try:
        return jobs.public(jobs.retry(job_id))
    except KeyError as e:
        raise HttpError(404, "travail introuvable") from e


def jobs_forget(req, job_id):
    if jobs.get(job_id):
        _job_or_404(job_id, write=True)
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
    # avant POST /api/library/{item_id} (modifier), qui les prendrait pour des identifiants
    app.route("POST", "/api/library/batch", lib_batch)
    app.route("POST", "/api/library/views", lib_views)
    app.route("GET", "/api/library/{item_id}/view", lib_view)
    app.route("GET", "/api/library/{item_id}", lib_get)
    app.route("POST", "/api/library/{item_id}", lib_update)
    app.route("POST", "/api/library/{item_id}/delete", lib_delete)
    app.route("POST", "/api/library/{item_id}/restore", lib_restore)
    app.route("POST", "/api/elements", el_create)
    app.route("POST", "/api/elements/{item_id}/refs", el_add_ref)
    app.route("POST", "/api/elements/{item_id}/part", el_part)
    app.route("GET", "/api/cf/characters", cf_characters)
    app.route("GET", "/api/cf/file", cf_file)
    app.route("POST", "/api/cf/import", cf_import)
    app.route("GET", "/api/queue", queue)
    app.route("GET", "/api/jobs", jobs_list)
    app.route("POST", "/api/jobs", jobs_submit)
    app.route("GET", "/api/jobs/{job_id}", jobs_get)
    app.route("POST", "/api/jobs/{job_id}/cancel", jobs_cancel)
    app.route("POST", "/api/jobs/{job_id}/retry", jobs_retry)
    app.route("POST", "/api/jobs/{job_id}/forget", jobs_forget)
    app.route("GET", "/api/system", system)
    jobs.register("library.views", views_job, lane="cpu", title="Copies d'affichage", cost="cpu")
    app.on_start(_views_on_start)


# ── contrôle (tools/check.py) : les copies d'affichage, le cache, les fiches par lot ──
def selftest(call, ok) -> None:
    import os
    import subprocess
    import tempfile
    import urllib.error
    from io import BytesIO
    from PIL import Image

    base = f"http://127.0.0.1:{os.environ.get('SHOWRUNNER_PORT') or config.get('port')}"

    def raw(path: str, headers: dict | None = None):
        """(statut, en-têtes, corps) : `call` ne rend pas les en-têtes."""
        r = urllib.request.Request(base + path, headers=headers or {})
        try:
            with urllib.request.urlopen(r, timeout=60) as resp:
                return resp.status, resp.headers, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def png(w, h, mode="RGB", fmt="PNG", **save):
        buf = BytesIO()
        im = Image.new(mode, (w, h), (180, 60, 40, 120) if mode == "RGBA" else (180, 60, 40))
        im.save(buf, fmt, **save)
        return buf.getvalue()

    def up(name, body):
        return call("PUT", f"/api/library/upload?name={name}&title={name}", raw=body)

    # une grande image détourée : les quatre copies, en WebP, l'alpha gardé
    st, big = up("grande.png", png(3000, 1500, "RGBA"))
    ok(st == 200 and big.get("views") == [256, 512, 1024, 2048], f"copies d'une image 3000 px : {big.get('views')}")
    vu = big.get("view_urls") or {}
    ok(sorted(vu, key=int) == ["256", "512", "1024", "2048"] and all("?v=" in u for u in vu.values()),
       "chaque copie a son adresse versionnée")
    d = library.folder_of(big.get("id", "x"))
    try:
        with Image.open(d / "view-512.webp") as im:
            ok(im.format == "WEBP" and im.size == (512, 256) and im.mode == "RGBA", f"la copie 512 : {im.format} {im.size} {im.mode}")
    except OSError as e:
        ok(False, f"la copie 512 se lit ({e})")
    # rien de plus grand que l'original ; une image plus petite que 256 n'en a pas
    st, mid = up("moyenne.png", png(300, 200))
    ok(st == 200 and mid.get("views") == [256], f"une image de 300 px : seulement la copie 256 ({mid.get('views')})")
    st, tiny = up("minuscule.png", png(64, 48))
    ok(st == 200 and tiny.get("views") == [] and tiny.get("view_urls") == {}, "une image de 64 px : aucune copie")
    # une photo tournée par son EXIF : la copie est tournée comme le navigateur montre l'original
    exif = Image.Exif()
    exif[0x0112] = 6   # Orientation : 90° dans le sens horaire
    st, rot = up("tournee.jpg", png(800, 400, fmt="JPEG", exif=exif.tobytes()))
    try:
        with Image.open(library.folder_of(rot["id"]) / "view-512.webp") as im:
            ok(im.size == (256, 512), f"copie d'une photo tournée (EXIF) : {im.size}")
    except (OSError, KeyError, TypeError) as e:
        ok(False, f"copie d'une photo tournée ({e})")

    # la route de la copie : celle de la taille, la plus proche au-dessus, l'original
    st, hd, body = raw(f"/api/library/{big['id']}/view?w=300")
    ok(st == 200 and body[:4] == b"RIFF" and Image.open(BytesIO(body)).size == (512, 256), f"view?w=300 → la copie 512 ({st})")
    st, hd, body = raw(f"/api/library/{big['id']}/view?w=4000")
    ok(st == 200 and body[:4] == b"\x89PNG", "view?w=4000 → l'original")
    st, hd, body = raw(f"/api/library/{tiny['id']}/view?w=256")
    ok(st == 200 and body[:4] == b"\x89PNG", "view d'une image sans copie → l'original")
    st, _ = call("GET", f"/api/library/{big['id']}/view?w=abc")
    ok(st == 400, f"view?w=abc refusé ({st})")
    st, _ = call("GET", "/api/library/ima-20000101-000000-dead/view?w=256")
    ok(st == 404, f"view d'un objet absent : 404 ({st})")

    # le cache : un validateur partout, 304 ; un an pour une copie à son adresse versionnée
    u512 = "/" + vu.get("512", "")
    st, hd, body = raw(u512)
    etag = hd.get("ETag") if hd else None
    ok(st == 200 and etag and "immutable" in (hd.get("Cache-Control") or "") and "max-age=31536000" in hd.get("Cache-Control"),
       f"copie versionnée : ETag et cache d'un an ({st} {hd.get('Cache-Control') if hd else None})")
    st, hd, body = raw(u512, {"If-None-Match": etag or ""})
    ok(st == 304 and body == b"" and hd.get("ETag") == etag, f"If-None-Match → 304 sans corps ({st})")
    st, hd, _ = raw(u512.split("?")[0])
    ok(st == 200 and hd.get("Cache-Control") == "no-cache" and hd.get("ETag"), "la même copie sans ?v= : revalidée (no-cache)")
    st, hd, _ = raw("/" + big["url"])
    ok(st == 200 and hd.get("Cache-Control") == "no-cache" and hd.get("ETag"), "l'original : ETag, no-cache")
    st, hd2, _ = raw("/" + big["url"], {"If-None-Match": f'"autre", {hd.get("ETag")}'})
    ok(st == 304, f"If-None-Match avec plusieurs validateurs → 304 ({st})")
    st, hd2, _ = raw("/" + big["url"], {"If-None-Match": 'W/"autre"'})
    ok(st == 200, "un autre validateur → 200")
    st, hd, _ = raw("/commun/shell.js")
    ok(st == 200 and hd.get("ETag") and raw("/commun/shell.js", {"If-None-Match": hd.get("ETag")})[0] == 304,
       "un fichier du dépôt : ETag, 304")

    # les fiches par lot : dans l'ordre, sans doublon ; absent ou invisible → missing
    st, b = call("POST", "/api/library/batch", {"ids": [mid["id"], big["id"], "ima-20000101-000000-dead", mid["id"]]})
    ok(st == 200 and [i["id"] for i in b.get("items", [])] == [mid["id"], big["id"]]
       and b.get("missing") == ["ima-20000101-000000-dead"] and b["items"][1].get("views") == [256, 512, 1024, 2048],
       f"fiches par lot ({st} {b.get('missing') if isinstance(b, dict) else b})")
    st, _ = call("POST", "/api/library/batch", {"ids": ["x"] * (BATCH_MAX + 1)})
    ok(st == 400, "plus de 2000 fiches : refusé")
    st, _ = call("POST", "/api/library/batch", {"ids": "pas une liste"})
    ok(st == 400, "ids qui n'est pas une liste : refusé")

    # le rattrapage : une image rangée avant les copies les retrouve par le travail cpu
    it = library.get(mid["id"])
    old_v = it.get("views_v")
    it.pop("views", None)
    for p in library.folder_of(mid["id"]).glob("view-*.webp"):
        p.unlink()
    ok(mid["id"] in library.missing_views(), "une image sans copies est à rattraper")
    st, j = call("POST", "/api/library/views", {"ids": [mid["id"]]})
    for _ in range(100):
        st, j = call("GET", f"/api/jobs/{j.get('id')}")
        if j.get("state") in ("done", "error", "cancelled"):
            break
        time.sleep(0.1)
    it = library.get(mid["id"])
    ok(j.get("state") == "done" and it.get("views") == [256] and it.get("views_v") != old_v
       and (library.folder_of(mid["id"]) / "view-256.webp").is_file(), f"le rattrapage refait les copies ({j.get('state')} {j.get('message')})")
    ok(mid["id"] not in library.missing_views(), "rattrapée, elle n'est plus à faire")

    # une vidéo : les copies de son affiche (ffmpeg, présent sur les DGX)
    with tempfile.TemporaryDirectory() as tmp:
        mp4 = Path(tmp) / "v.mp4"
        try:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=10", "-t", "1",
                            "-pix_fmt", "yuv420p", str(mp4)], capture_output=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired):
            pass
        if mp4.is_file():
            st, vid = up("essai.mp4", mp4.read_bytes())
            ok(st == 200 and vid.get("views") == [256, 512], f"copies de l'affiche d'une vidéo 640 px : {vid.get('views')}")
            st, hd, body = raw(f"/api/library/{vid['id']}/view?w=1024")
            ok(st == 200 and body[:4] == b"RIFF", "view d'une vidéo au-delà de ses copies → la plus grande copie de l'affiche")
        else:
            ok(True, "ffmpeg absent : copies d'une vidéo non essayées")
