"""Les LoRA du portail : un moodboard d'Idéation (ideation/objets/moodboard.js) devient un
LoRA de style pour les modèles d'image et de vidéo ; un lot de sons, un LoRA de son.

Cal, 05/10/2026 : « une fonction de moodboard avancée dans Idéation : on en fait un élément
qu'on remplit d'images et qui fera un LoRA pour nos modèles image et vidéo, un truc de
cohérence de style comme les moodboards de Midjourney… on peut gérer le lancement des LoRA,
voir si le LoRA est à jour (si on a ajouté des images il faut le recalculer, mais on peut
l'utiliser quand même s'il ne l'est pas)… ça va prendre du temps, ça peut être une tâche
planifiée pour être faite pendant la nuit, car ça va monopoliser les DGX pendant des heures. »

Un LoRA est attaché à sa source : un moodboard (planche + objet). Son état, sur le disque
(`<data>/lora/<planche>-<objet>.json`) :

  { id, board, node, name, model,
    versions: [{ v, at, items: [ids], file, job, factice? }],   le dernier est l'actuel
    plan: { at, model, items, owner, space } | null,             un entraînement prévu (la nuit)
    job: <id> | null }                                           l'entraînement en cours ou en file

« À jour » se juge à la page : les images du moodboard contre celles de la dernière version
(une image ajoutée ou retirée : périmé — la version d'avant reste utilisable).

Routes :
  GET  /api/lora/models                       les modèles cibles, et s'ils sont prêts (l'entraîneur installé)
  GET  /api/lora/{bid}/{nid}                  l'état du LoRA d'un moodboard
  POST /api/lora/{bid}/{nid}/train            {items, model, when: "now" | "HH:MM", name} → lancer ou planifier
  POST /api/lora/{bid}/{nid}/cancel           retirer le plan, arrêter l'entraînement
  GET  /api/lora                              les LoRA entraînés que la personne voit (pour les cartes Générer)

L'entraînement lui-même (`lora.train`) passe par un ENTRAÎNEUR par modèle (TRAINERS). Tant
qu'un entraîneur n'est pas installé sur les DGX, son modèle dit pourquoi et ne part pas
(règle 7 du thème) ; `lora.train_factice` fait tout le parcours sans GPU (un fichier témoin),
pour essayer la page.
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from core import auth, config, jobs, library
from core.http import HttpError

NID = re.compile(r"[A-Za-z0-9_-]{1,64}")
ITEM = re.compile(r"[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}")
HHMM = re.compile(r"([01]\d|2[0-3]):([0-5]\d)")
MAX_ITEMS = 200
MIN_ITEMS = {"image": 4, "video": 4, "audio": 2}
_lock = threading.RLock()

# Les modèles cibles. `family` : ce que le jeu de données contient (image, vidéo : des images ;
# son : des sons). `trainer` : l'entraîneur (installé par tools/lora_install.sh) ; `hours` :
# l'ordre de grandeur annoncé avant de lancer (à remplacer par les mesures sur les DGX).
MODELS = {
    "krea2": {"name": "Krea 2", "family": "image", "kind": "image", "trainer": None, "hours": "2 à 4 h"},
    "qwen21": {"name": "Qwen-Image 2.1", "family": "image", "kind": "image", "trainer": None, "hours": "2 à 4 h"},
    "zimage": {"name": "Z-Image", "family": "image", "kind": "image", "trainer": None, "hours": "1 à 3 h"},
    "h3": {"name": "H3 (vidéo)", "family": "video", "kind": "image", "trainer": None, "hours": "4 à 8 h"},
    "ace": {"name": "ACE-Step 1.5 (son)", "family": "audio", "kind": "audio", "trainer": None, "hours": "1 à 3 h"},
    "yue2": {"name": "YuE2 (timbre)", "family": "audio", "kind": "audio", "trainer": None, "hours": "1 à 2 h"},
    "factice": {"name": "Essai sans GPU", "family": "image", "kind": "image", "trainer": "factice", "hours": "quelques secondes"},
}
# les entraîneurs branchés : modèle → { ready() → (bool, pourquoi), run(ctx, dataset, sortie, params) }
# (server/tools/lora_trainers.py les déclare, une fois installés par tools/lora_install.sh)
TRAINERS: dict[str, dict] = {"factice": {"ready": lambda: (True, ""), "run": None}}


def _dir() -> Path:
    d = config.data_dir() / "lora"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path(bid: str, nid: str) -> Path:
    return _dir() / f"{bid}-{nid}.json"


def _ok_ids(bid: str, nid: str) -> None:
    if not NID.fullmatch(bid or "") or not NID.fullmatch(nid or ""):
        raise HttpError(400, "planche ou objet invalide")


def load(bid: str, nid: str) -> dict:
    p = _path(bid, nid)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            pass
    return {"id": f"{bid}-{nid}", "board": bid, "node": nid, "name": "", "model": "", "versions": [], "plan": None, "job": None}


def save(s: dict) -> None:
    p = _path(s["board"], s["node"])
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)


def model_state(mid: str) -> dict:
    m = MODELS[mid]
    t = TRAINERS.get(mid)
    if t:
        try:
            ready, why = t["ready"]()
        except Exception as e:   # un entraîneur qui ne répond pas ne fait pas tomber la page
            ready, why = False, f"l'entraîneur ne répond pas : {e}"
    else:
        ready, why = False, ("l'entraîneur de ce modèle n'est pas encore installé sur les DGX "
                             "(Admin → Diagnostics → « LoRA · installer »)")
    return {"id": mid, "name": m["name"], "family": m["family"], "kind": m["kind"], "hours": m["hours"], "ready": ready, "why": "" if ready else why}


def _models_for(u) -> list[dict]:
    out = [model_state(k) for k in MODELS if k != "factice"]
    if auth.is_admin(u):   # l'essai sans GPU : pour Cal, qui essaie la page
        out.append(model_state("factice"))
    return out


def public(s: dict) -> dict:
    out = {k: v for k, v in s.items()}
    j = jobs.get(s["job"]) if s.get("job") else None
    out["job_state"] = jobs.public(j) if j else None
    if j and j["state"] not in ("queued", "running"):
        out["job_state"]["finished"] = True
    for v in out.get("versions") or []:
        v["url"] = f"api/lora/file/{s['board']}/{s['node']}/{v['v']}"
    return out


# ── les routes ───────────────────────────────────────────────
def _board(req, bid: str, what: str) -> None:
    from tools import ideation
    ideation._need(req, bid, what)


def r_models(req):
    return {"models": _models_for(auth.current())}


def r_get(req, bid, nid):
    _ok_ids(bid, nid)
    _board(req, bid, "see")
    with _lock:
        s = load(bid, nid)
        _settle(s)
        return {**public(s), "models": _models_for(auth.current())}


def _items(raw, kind: str) -> list[str]:
    if not isinstance(raw, list) or not raw:
        raise HttpError(400, "le moodboard est vide : déposez-y des images")
    ids = []
    for x in raw[:MAX_ITEMS]:
        x = str(x)
        if not ITEM.fullmatch(x) or x in ids:
            continue
        it = library.get(x)
        if not it or not library.readable(it):
            continue        # une image partie, ou d'un autre Workspace : elle ne compte pas
        if it["kind"] != kind:
            continue
        ids.append(x)
    return ids


def next_time(hhmm: str) -> str:
    """La prochaine heure `HH:MM` (heure de la machine), en ISO."""
    m = HHMM.fullmatch(hhmm or "")
    if not m:
        raise HttpError(400, "une heure HH:MM (ex. 01:00)")
    now = datetime.now()
    t = now.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0, microsecond=0)
    if t <= now:
        t += timedelta(days=1)
    return t.isoformat(timespec="minutes")


def r_train(req, bid, nid):
    _ok_ids(bid, nid)
    _board(req, bid, "edit")
    d = req.json()
    mid = d.get("model")
    if mid not in MODELS or (mid == "factice" and not auth.is_admin(auth.current())):
        raise HttpError(400, f"modèle cible inconnu : {mid!r}")
    st = model_state(mid)
    if not st["ready"]:
        raise HttpError(409, f"{st['name']} : {st['why']}")
    m = MODELS[mid]
    items = _items(d.get("items"), m["kind"])
    need = MIN_ITEMS[m["family"]]
    if len(items) < need:
        raise HttpError(400, f"il faut au moins {need} {'images' if m['kind'] == 'image' else 'sons'} lisibles ici (il y en a {len(items)})")
    from tools import ideation
    space = ideation.board_space(bid)
    when = str(d.get("when") or "now")
    with _lock:
        s = load(bid, nid)
        _settle(s)
        if s.get("job"):
            raise HttpError(409, "un entraînement de ce LoRA est déjà en file ou en cours : annulez-le d'abord")
        s["name"] = str(d.get("name") or s.get("name") or "moodboard")[:80]
        s["model"] = mid
        if when == "now":
            s["plan"] = None
            j = _submit(s, mid, items, auth.current(), space)
            s["job"] = j["id"]
        else:
            u = auth.current()
            s["plan"] = {"at": next_time(when), "model": mid, "items": items, "owner": u["id"] if u else None, "space": space}
        save(s)
        return {**public(s), "models": _models_for(auth.current())}


def r_cancel(req, bid, nid):
    _ok_ids(bid, nid)
    _board(req, bid, "edit")
    with _lock:
        s = load(bid, nid)
        s["plan"] = None
        if s.get("job"):
            try:
                jobs.cancel(s["job"])
            except KeyError:
                pass
        _settle(s)
        save(s)
        return {**public(s), "models": _models_for(auth.current())}


def r_list(req):
    """Les LoRA entraînés que la personne voit (une planche qu'elle peut voir)."""
    from tools import ideation_collab
    out = []
    for p in sorted(_dir().glob("*.json")):
        try:
            s = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if not s.get("versions"):
            continue
        try:
            ideation_collab.need(req, s["board"], "see")
        except HttpError:
            continue
        last = s["versions"][-1]
        out.append({"id": s["id"], "board": s["board"], "node": s["node"], "name": s.get("name") or "", "model": s.get("model"),
                    "v": last["v"], "file": last.get("file"), "factice": bool(last.get("factice")), "at": last.get("at")})
    return {"loras": out}


def r_file(req, bid, nid, v):
    from core.http import FileResponse
    _ok_ids(bid, nid)
    _board(req, bid, "see")
    s = load(bid, nid)
    ver = next((x for x in s.get("versions") or [] if str(x["v"]) == str(v)), None)
    if not ver or not ver.get("file"):
        raise HttpError(404, "cette version n'a pas de fichier")
    f = _dir() / "files" / ver["file"]
    if not f.is_file():
        raise HttpError(404, "le fichier de cette version manque")
    return FileResponse(f)


# ── la file : lancer, et ce que l'entraînement laisse ──────
def _submit(s: dict, mid: str, items: list, owner, space) -> dict:
    kind = "lora.train_factice" if mid == "factice" else "lora.train"
    kw = {"owner": owner} if owner is not None else {}   # un plan qui part la nuit : au nom de qui l'a prévu
    return jobs.submit(kind, {"board": s["board"], "node": s["node"], "model": mid, "items": items, "name": s.get("name") or ""},
                       title=f"LoRA · {s.get('name') or 'moodboard'} · {MODELS[mid]['name']}", tool="ideation", space=space, **kw)


def _settle(s: dict) -> None:
    """Le travail du LoRA est fini (fait, en échec, annulé) : il ne bloque plus."""
    j = jobs.get(s["job"]) if s.get("job") else None
    if s.get("job") and (not j or j["state"] not in ("queued", "running")):
        s["last_job"] = {"id": s["job"], "state": j["state"] if j else "perdu", "message": (j or {}).get("message", "")}
        s["job"] = None


def _add_version(bid: str, nid: str, items: list, src: Path | None, job_id: str, factice: bool) -> dict:
    with _lock:
        s = load(bid, nid)
        v = 1 + max([x["v"] for x in s.get("versions") or []] or [0])
        files = _dir() / "files"
        files.mkdir(exist_ok=True)
        name = f"{bid}-{nid}-v{v:03d}" + (".factice" if factice else ".safetensors")
        if src is not None:
            src.replace(files / name)
        entry = {"v": v, "at": library.now(), "items": items, "file": name, "job": job_id, "model": s.get("model")}
        if factice:
            entry["factice"] = True
        s.setdefault("versions", []).append(entry)
        s["job"] = None
        save(s)
        return entry


def _dataset(ctx, items: list, kind: str) -> Path:
    """Le jeu de données : les fichiers des objets, copiés dans le dossier du travail."""
    import shutil
    d = ctx.workdir / "dataset"
    d.mkdir(parents=True, exist_ok=True)
    for k, iid in enumerate(items):
        it = library.get(iid)
        if not it or it["kind"] != kind:
            continue
        src = library.path_of(it)
        shutil.copyfile(src, d / f"{k:03d}{src.suffix.lower()}")
        # la légende : le prompt de l'objet s'il en a un (un entraîneur la lira à côté de l'image)
        if it.get("prompt"):
            (d / f"{k:03d}.txt").write_text(it["prompt"], encoding="utf-8")
    return d


def run_factice(ctx) -> dict:
    p = ctx.params
    items = list(p.get("items") or [])
    for k, msg in enumerate(("lit les images", "prépare le jeu · factice", "entraîne · factice", "range le LoRA · factice")):
        ctx.check()
        ctx.progress(0.1 + 0.2 * k, msg)
        time.sleep(0.5)
    out = ctx.workdir / "lora.factice"
    out.write_text(json.dumps({"factice": True, "items": items}), encoding="utf-8")
    e = _add_version(p["board"], p["node"], items, out, ctx.job["id"], True)
    return {"lora": e["file"], "v": e["v"], "note": "factice : aucun calcul, un fichier témoin"}


def run_train(ctx) -> dict:
    p = ctx.params
    mid = p.get("model")
    t = TRAINERS.get(mid)
    if not t:
        raise RuntimeError(f"{MODELS.get(mid, {}).get('name', mid)} : l'entraîneur n'est pas installé")
    ready, why = t["ready"]()
    if not ready:
        raise RuntimeError(why)
    data = _dataset(ctx, list(p.get("items") or []), MODELS[mid]["kind"])
    out = ctx.workdir / "lora.safetensors"
    t["run"](ctx, data, out, p)
    if not out.is_file():
        raise RuntimeError("l'entraînement n'a pas laissé de fichier")
    e = _add_version(p["board"], p["node"], list(p.get("items") or []), out, ctx.job["id"], False)
    return {"lora": e["file"], "v": e["v"]}


# ── les plans : un entraînement prévu part à son heure ──────
def _tick() -> None:
    now = datetime.now().isoformat(timespec="minutes")
    for p in sorted(_dir().glob("*.json")):
        try:
            s = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        plan = s.get("plan")
        if not plan or plan.get("at", "9999") > now:
            continue
        with _lock:
            s = load(s["board"], s["node"])
            plan = s.get("plan")
            if not plan or plan["at"] > now:
                continue
            s["plan"] = None
            u = auth.user(plan["owner"]) if plan.get("owner") else None
            try:
                auth.set_current(u)
                j = _submit(s, plan["model"], plan["items"], u, plan.get("space"))
                s["job"] = j["id"]
            except Exception as e:   # un refus (quota, garde du calcul) : dit sur le moodboard
                s["last_job"] = {"id": None, "state": "error", "message": f"le plan de {plan['at']} n'a pas pu partir : {e}"}
            finally:
                auth.set_current(None)
            save(s)


def _loop() -> None:
    while True:
        try:
            _tick()
        except Exception as e:   # la boucle ne meurt pas d'un fichier abîmé
            print(f"lora · plans : {e}", flush=True)
        time.sleep(30)


def register(app) -> None:
    app.route("GET", "/api/lora/models", r_models)
    app.route("GET", "/api/lora", r_list)
    app.route("GET", "/api/lora/file/{bid}/{nid}/{v}", r_file)
    app.route("GET", "/api/lora/{bid}/{nid}", r_get)
    app.route("POST", "/api/lora/{bid}/{nid}/train", r_train)
    app.route("POST", "/api/lora/{bid}/{nid}/cancel", r_cancel)
    jobs.register("lora.train", run_train, lane="image", title="LoRA · entraînement", family=None, gpu=True, cost="gpu")
    jobs.register("lora.train_factice", run_factice, lane="cpu", title="LoRA · essai sans GPU", family=None, gpu=False, cost="cpu")
    app.on_start(lambda: threading.Thread(target=_loop, name="lora-plans", daemon=True).start())


def selftest(call, ok) -> None:
    st, b = call("POST", "/api/ideation/boards", {"name": "Essai LoRA"})
    ok(st == 200, f"lora : une planche d'essai ({st})")
    bid = b["id"]
    st, m = call("GET", "/api/lora/models")
    ok(st == 200 and any(x["id"] == "krea2" and not x["ready"] and x["why"] for x in m["models"]),
       f"lora : un modèle sans entraîneur dit pourquoi ({m})")
    st, s = call("GET", f"/api/lora/{bid}/mb1")
    ok(st == 200 and s["versions"] == [] and s["plan"] is None, "lora : l'état vide d'un moodboard")
    st, r = call("POST", f"/api/lora/{bid}/mb1/train", {"items": [], "model": "krea2", "when": "now"})
    ok(st == 409, f"lora : un modèle sans entraîneur ne part pas ({st})")
    import io
    from PIL import Image
    ids = []
    for k in range(4):
        buf = io.BytesIO()
        Image.new("RGB", (32, 32), (40 * k, 80, 120)).save(buf, "PNG")
        st, it = call("PUT", f"/api/library/upload?name=mb{k}.png&title=mb{k}", raw=buf.getvalue())
        ids.append(it["id"])
    st, r = call("POST", f"/api/lora/{bid}/mb1/train", {"items": ids, "model": "factice", "when": "03:00", "name": "essai"})
    ok(st == 200 and r["plan"] and r["plan"]["at"].endswith("03:00"), f"lora : un plan pour la nuit ({st} {r.get('plan')})")
    st, r = call("POST", f"/api/lora/{bid}/mb1/cancel", {})
    ok(st == 200 and r["plan"] is None, "lora : le plan s'annule")
    st, r = call("POST", f"/api/lora/{bid}/mb1/train", {"items": ids, "model": "factice", "when": "now", "name": "essai"})
    ok(st == 200 and r.get("job"), f"lora : l'essai sans GPU part ({st} {r})")
    for _ in range(60):
        st, r = call("GET", f"/api/lora/{bid}/mb1")
        if r.get("versions"):
            break
        time.sleep(0.25)
    ok(r.get("versions") and r["versions"][-1]["v"] == 1 and r["versions"][-1]["items"] == ids and r["versions"][-1].get("factice"),
       f"lora : la version 1 retient ses images ({r.get('versions')} {r.get('last_job')})")
