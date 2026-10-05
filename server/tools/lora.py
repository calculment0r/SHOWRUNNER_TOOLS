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
  GET  /api/lora[?model=zimage]               les LoRA entraînés que la personne voit ; `render` : ceux qu'un rendu
                                              peut poser (render_choices), pour les cartes Générer et la page Vidéo

L'entraînement lui-même (`lora.train`) passe par un ENTRAÎNEUR par modèle (TRAINERS). Tant
qu'un entraîneur n'est pas installé sur les DGX, son modèle dit pourquoi et ne part pas
(règle 7 du thème) ; `lora.train_factice` fait tout le parcours sans GPU (un fichier témoin),
pour essayer la page.

Au rendu (la carte Générer d'Idéation, la page Image, la page Vidéo pour H3) : un LoRA entraîné se
pose pour le modèle qui l'a produit, par `LoraLoaderModelOnly` (with_lora), avec une force de 0 à
1,5 et son mot déclencheur en tête du prompt (check_render) — la forme validée à l'installation du
05/10 (« graphe du portail + LoraLoaderModelOnly », docs/INSTALL_LORA.md § 6).
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from core import auth, config, jobs, library
from core.comfy import Comfy, ComfyError
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
# les entraîneurs branchés : modèle → { ready() → (bool, pourquoi), run(ctx, dataset, sortie, params) → {trigger, comfy, note…} }
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
    hours = m["hours"]
    if t and t.get("hours"):   # la vitesse mesurée à l'installation (lora_trainers : `s_per_step` du manifeste)
        try:
            hours = t["hours"]() or hours
        except Exception:
            pass
    return {"id": mid, "name": m["name"], "family": m["family"], "kind": m["kind"], "hours": hours, "ready": ready, "why": "" if ready else why}


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
    _board(req, bid, "see")
    d = req.json()
    mid = d.get("model")
    # la garde du calcul (celle de jobs.submit, que _submit appellera) avant tout jugement des
    # réglages, pour la sorte et le Workspace du travail : un guest lit pourquoi (et non un
    # « modèle inconnu » ou un « spectateur »), et un plan pour la nuit n'est pas gardé pour
    # rien — jobs.submit le refuserait à son heure
    from tools import ideation
    space = ideation.board_space(bid)
    me = auth.current()
    jobs._guard("lora.train_factice" if mid == "factice" else "lora.train", {}, me, me, space)
    _board(req, bid, "edit")
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
    """Les LoRA entraînés que la personne voit (une planche qu'elle peut voir) : `loras`, un par moodboard
    (sa dernière version) ; `render`, ceux qu'un rendu peut poser (`?model=` : pour ce modèle seulement)."""
    from tools import ideation_collab
    model = (req.query.get("model") or [None])[0]
    if model is not None and model not in MODELS:
        raise HttpError(400, f"modèle inconnu : {model!r}")
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
                    "v": last["v"], "file": last.get("file"), "factice": bool(last.get("factice")), "at": last.get("at"),
                    "comfy": last.get("comfy") or "", "trigger": last.get("trigger") or ""})
    rc = render_choices(model)
    return {"loras": out, "render": rc["loras"], "comfy": rc["read"], "why": rc["why"], "strength_max": STRENGTH_MAX,
            "names": {k: m["name"] for k, m in MODELS.items() if k != "factice"}}


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


# ── les LoRA entraînés, au rendu ────────────────────────────
# Un LoRA du portail vit dans ComfyUI sous `loras/showrunner/` (lora_trainers.publish), nommé
# `<modèle>-<moodboard>-v001.safetensors` (H3 : `h3-<moodboard>-v001-fl2v.safetensors`, pour la page
# Vidéo) : le préfixe dit le modèle qui l'a produit, et seul ce modèle le reçoit.
COMFY_DIR = "showrunner/"
COMFY_RX = re.compile(r"showrunner/(zimage|qwen21|krea2|h3|ace)-[a-z0-9-]+\.safetensors")
STRENGTH_MAX = 1.5
_comfy_seen: dict[str, tuple[float, list | None]] = {}


def comfy_model(name: str) -> str | None:
    """Le modèle qui a produit un LoRA du portail, d'après son nom dans ComfyUI ; None : pas un des nôtres."""
    m = COMFY_RX.fullmatch(str(name or ""))
    return m.group(1) if m else None


def _see(bid: str) -> bool:
    from tools import ideation_collab
    try:
        return bool(ideation_collab.can(auth.current(), bid, "see"))
    except Exception:   # une planche partie : son LoRA ne se montre plus
        return False


def trained() -> dict[str, dict]:
    """Les versions entraînées par le portail, par leur nom dans ComfyUI : {board, node, name (le moodboard),
    v, model, trigger, at, latest}. Une version factice n'a pas de fichier dans ComfyUI : elle n'y est pas."""
    out = {}
    for p in sorted(_dir().glob("*.json")):
        try:
            s = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        vs = s.get("versions") or []
        last = vs[-1]["v"] if vs else None
        for v in vs:
            if v.get("comfy") and not v.get("factice"):
                out[v["comfy"]] = {"board": s["board"], "node": s["node"], "name": s.get("name") or "moodboard", "v": v["v"],
                                   "model": comfy_model(v["comfy"]), "trigger": v.get("trigger") or "", "at": v.get("at"),
                                   "latest": v["v"] == last}
    return out


def info(name: str) -> dict | None:
    """Ce que le portail sait d'un LoRA de `loras/showrunner/` ; None : pas un des nôtres, ou d'un moodboard que
    la personne ne voit pas (`hidden`)."""
    mid = comfy_model(name)
    if not mid:
        return None
    k = trained().get(name)
    if k and not _see(k["board"]):
        return {"hidden": True, "model": mid}
    return {"model": mid, "title": k["name"] if k else name.split("/")[-1].removesuffix(".safetensors"),
            "v": k["v"] if k else None, "trigger": k["trigger"] if k else "", "known": bool(k)}


def comfy_endpoints() -> list[str]:
    """Les ComfyUI où l'on rend des images et H3 (voies image et h3) : là où un LoRA doit se trouver."""
    lanes = config.get("lanes") or {}
    out: list[str] = []
    for ep in list(lanes.get("image") or []) + list(lanes.get("h3") or []):
        if str(ep).startswith("http") and ep not in out:
            out.append(ep)
    return out


def comfy_names(ep: str, max_age: float = 30.0) -> list[str] | None:
    """Les LoRA de `loras/showrunner/` qu'une ComfyUI liste (/object_info de LoraLoaderModelOnly : rien
    n'est chargé) ; None : elle ne répond pas (relue au bout de 10 s)."""
    t, got = _comfy_seen.get(ep, (0.0, None))
    if time.time() - t < (max_age if got is not None else min(max_age, 10.0)):
        return got
    got = None
    if jobs.endpoint_alive(ep, max_age=30)[0]:
        try:
            spec = Comfy(ep, timeout=15).object_info("LoraLoaderModelOnly")["LoraLoaderModelOnly"]
            opt = spec["input"]["required"]["lora_name"]
            opts = opt[0] if isinstance(opt[0], list) else (opt[1].get("options") or [] if len(opt) > 1 and isinstance(opt[1], dict) else [])
            got = [str(x) for x in opts if str(x).startswith(COMFY_DIR)]
        except (ComfyError, KeyError, TypeError, IndexError, OSError):
            got = None
    _comfy_seen[ep] = (time.time(), got)
    return got


def machines_with(name: str, eps: list[str]) -> list[str]:
    """Parmi `eps`, les ComfyUI qui ont ce LoRA. Une qui ne répond pas reste : on ne sait pas, et la file ne
    lui donne rien tant qu'elle ne répond pas (la règle de image._pin_for)."""
    out = []
    for ep in eps:
        names = comfy_names(ep)
        if names is None or name in names:
            out.append(ep)
    return out


def render_choices(model: str | None = None) -> dict:
    """Les LoRA qu'un rendu peut poser : ceux que le portail a entraînés (d'un moodboard que la personne
    voit) et ceux de `loras/showrunner/` que ComfyUI liste sans que le portail les connaisse (copiés à la
    main) ; chacun avec le modèle qui l'a produit et les machines qui l'ont (None : aucune ComfyUI lue)."""
    read = {ep: n for ep in comfy_endpoints() if (n := comfy_names(ep)) is not None}
    known = trained()
    out = []
    for name, k in known.items():
        if _see(k["board"]):
            out.append({"name": name, "model": k["model"], "title": k["name"], "v": k["v"], "trigger": k["trigger"],
                        "at": k["at"], "latest": k["latest"], "source": "portail"})
    for names in read.values():
        for n in names:
            if n in known or not comfy_model(n) or any(x["name"] == n for x in out):
                continue
            out.append({"name": n, "model": comfy_model(n), "title": n.split("/")[-1].removesuffix(".safetensors"), "v": None,
                        "trigger": "", "at": None, "latest": True, "source": "comfy"})
    for x in out:
        x["machines"] = [jobs.machine_of(ep) for ep, names in read.items() if x["name"] in names] if read else None
    if model:
        out = [x for x in out if x["model"] == model]
    out.sort(key=lambda x: (x["model"] or "", x["title"].lower(), -(x["v"] or 0)))
    eps = comfy_endpoints()
    return {"loras": out, "read": [jobs.machine_of(ep) for ep in read],
            "why": "" if read else ("aucune ComfyUI ne répond : la présence des fichiers n'est pas vérifiée" if eps
                                    else "moteur d'essai : aucune ComfyUI, la présence des fichiers n'est pas vérifiée")}


def check_render(model: str, raw, variant: str | None = None) -> dict | None:
    """Un LoRA demandé pour un rendu de `model` → {name, strength, trigger, title, v} ; ValueError s'il ne va
    pas (la raison, dite à la page). Le mot déclencheur vient du portail, jamais de la demande."""
    if raw in (None, "", {}):
        return None
    if isinstance(raw, str):
        raw = {"name": raw}
    if not isinstance(raw, dict) or not raw.get("name"):
        raise ValueError("LoRA mal formé : {name, strength}")
    name = str(raw["name"])
    mid = comfy_model(name)
    if not mid:
        raise ValueError(f"« {name[:120]} » n'est pas un LoRA du portail (ComfyUI : loras/showrunner/<modèle>-….safetensors)")
    if mid != model:
        raise ValueError(f"ce LoRA a été entraîné pour {MODELS[mid]['name']} : il ne va qu'à ce modèle, "
                         f"pas à {MODELS[model]['name'] if model in MODELS else model}")
    if model == "zimage" and variant not in (None, "turbo"):
        raise ValueError("ce LoRA a été entraîné sur Z-Image Turbo (l'adaptateur d'ai-toolkit, essai du 05/10) : "
                         "sur Base, il n'a pas été essayé")
    try:
        f = float(raw.get("strength", 1.0))
    except (TypeError, ValueError) as e:
        raise ValueError("force du LoRA : un nombre") from e
    if not 0 <= f <= STRENGTH_MAX:
        raise ValueError(f"force du LoRA : de 0 à {STRENGTH_MAX:g}".replace(".", ","))
    k = info(name)
    if k.get("hidden"):
        raise ValueError("ce LoRA vient d'un moodboard que tu ne vois pas")
    return {"name": name, "strength": round(f, 2), "trigger": k["trigger"], "title": k["title"], "v": k["v"]}


def with_lora(g: dict, name: str, strength: float, title: str = "LoRA de moodboard") -> dict:
    """Pose `LoraLoaderModelOnly` juste après le chargeur du modèle (le seul UNETLoader du graphe) : tout
    ce qui lisait le modèle lit le modèle patché, et les LoRA de la recette (Viggle turbo de Qwen 2.1,
    UltraReal de Krea 2) s'y empilent — la forme de l'essai du 05/10 (« graphe du portail +
    LoraLoaderModelOnly » ; Qwen 2.1 « empilé sur Viggle turbo »)."""
    loaders = [k for k, n in g.items() if isinstance(n, dict) and n.get("class_type") == "UNETLoader"]
    if len(loaders) != 1:
        raise ValueError(f"le graphe a {len(loaders)} chargeurs de modèle (UNETLoader) : la place du LoRA n'est pas sûre")
    src = loaders[0]
    nid = str(max([int(k) for k in g if str(k).isdigit()] + [0]) + 1)
    for n in g.values():
        ins = n.get("inputs") if isinstance(n, dict) else None
        for key, val in (ins or {}).items():
            if isinstance(val, (list, tuple)) and len(val) == 2 and str(val[0]) == str(src) and val[1] == 0:
                ins[key] = [nid, 0]
    g[nid] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": [src, 0], "lora_name": name, "strength_model": strength},
              "_meta": {"title": title}}
    return g


# ── la file : lancer, et ce que l'entraînement laisse ──────
def _local_endpoint() -> str | None:
    """La ComfyUI de la machine du portail : l'entraînement tourne ici (lora_trainers.py), la file
    y réserve donc sa place GPU (rien d'autre de GPU n'y part pendant ce temps)."""
    for ep in (config.get("lanes") or {}).get("image", []):
        if "127.0.0.1" in str(ep) or "localhost" in str(ep):
            return ep
    return None


def _submit(s: dict, mid: str, items: list, owner, space) -> dict:
    kind = "lora.train_factice" if mid == "factice" else "lora.train"
    kw = {"owner": owner} if owner is not None else {}   # un plan qui part la nuit : au nom de qui l'a prévu
    if kind == "lora.train" and _local_endpoint():
        kw["pin"] = _local_endpoint()
    return jobs.submit(kind, {"board": s["board"], "node": s["node"], "model": mid, "items": items, "name": s.get("name") or ""},
                       title=f"LoRA · {s.get('name') or 'moodboard'} · {MODELS[mid]['name']}", tool="ideation", space=space, **kw)


def _settle(s: dict) -> None:
    """Le travail du LoRA est fini (fait, en échec, annulé) : il ne bloque plus."""
    j = jobs.get(s["job"]) if s.get("job") else None
    if s.get("job") and (not j or j["state"] not in ("queued", "running")):
        s["last_job"] = {"id": s["job"], "state": j["state"] if j else "perdu", "message": (j or {}).get("message", "")}
        s["job"] = None


def _add_version(bid: str, nid: str, items: list, src: Path | None, job_id: str, factice: bool, extra: dict | None = None) -> dict:
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
        # ce que l'entraîneur en dit : le mot déclencheur, le nom dans ComfyUI, la durée (lora_trainers.py)
        entry.update({k: v for k, v in (extra or {}).items() if k in ("trigger", "comfy", "note", "minutes", "steps")})
        s.setdefault("versions", []).append(entry)
        s["job"] = None
        save(s)
        return entry


def sample_name(k: int, it: dict) -> str:
    """Le nom d'un objet dans le jeu de données : sa place, l'extension de son fichier (`000.png`, `001.flac`)."""
    return f"{k:03d}{library.path_of(it).suffix.lower()}"


def audio_meta(it: dict) -> dict:
    """Ce qu'on sait d'un son pour sa légende d'entraînement (un échantillon du `ds.json` d'ACE-Step 1.5,
    lu par acestep/training_v2/preprocess_discovery.py) : la légende (le prompt de l'objet, sinon son
    titre), les paroles, et le tempo, la tonalité, la mesure quand sa recette les donne — une prise de
    Musique (music.gen_params), une chanson (chanson.py : `params.chanson`), une région d'ODIO
    (music_gen : `params.values`), une partition YuE2 (Q: et K:). Rien d'inventé : un champ inconnu
    n'est pas écrit (ACE les tient pour facultatifs)."""
    pr = it.get("params") or {}
    ch = pr.get("chanson") if isinstance(pr.get("chanson"), dict) else {}
    va = pr.get("values") if isinstance(pr.get("values"), dict) else {}
    caption = (it.get("prompt") or ch.get("prompt") or va.get("caption") or pr.get("tags") or it.get("title") or "").strip()
    if ch:
        inst, lyrics = not ch.get("vocal", True), ch.get("lyrics") or ""
    else:
        src = va if ("lyrics" in va or "instrumental" in va) else pr
        lyrics = src.get("lyrics") or ""
        inst = bool(src.get("instrumental")) or not lyrics.strip() or lyrics.strip() == "[Instrumental]"
    out = {"caption": caption, "lyrics": "[Instrumental]" if inst else lyrics.strip(), "is_instrumental": inst}
    score = pr.get("score") or ""
    q = re.search(r"^Q:\s*1/4\s*=\s*(\d+)", score, re.M)
    bpm = pr.get("bpm") or ch.get("bpm") or va.get("bpm") or (int(q.group(1)) if q else None)
    key = pr.get("keyscale") or ch.get("key") or va.get("keyscale")
    k = re.search(r"^K:\s*(\S+)", score, re.M)
    if not key and k:
        try:   # la tonalité d'une partition ABC, au format d'ACE-Step (« A minor »)
            from tools import chanson, music_gen
            t = chanson._tonic(k.group(1))
            key = music_gen.ace_key(t["tonic"], t["mode"]) if t else None
        except Exception:   # une partition illisible : la tonalité reste inconnue
            key = None
    ts = pr.get("timesignature") or va.get("timesignature") or ("4" if ch else None)   # chanson.ace_of : toujours 4
    try:
        if bpm:
            out["bpm"] = int(round(float(bpm)))
    except (TypeError, ValueError):
        pass
    if key:
        out["keyscale"] = str(key)
    if ts:
        out["timesignature"] = str(ts)
    return out


def _dataset(ctx, items: list, kind: str) -> Path:
    """Le jeu de données : les fichiers des objets, copiés dans le dossier du travail."""
    import shutil
    d = ctx.workdir / "dataset"
    d.mkdir(parents=True, exist_ok=True)
    for k, iid in enumerate(items):
        it = library.get(iid)
        if not it or it["kind"] != kind:
            continue
        shutil.copyfile(library.path_of(it), d / sample_name(k, it))
        # la légende : le prompt de l'objet s'il en a un (ai-toolkit lit `<image>.txt` et y ajoute le mot
        # déclencheur) ; un son : `.caption.txt` et `.lyrics.txt` (le tutoriel d'ACE-Step 1.5), que la ligne
        # de commande ignore pourtant (05/10) : c'est le `ds.json` qu'elle lit (lora_trainers.ace_dataset)
        cap = (it.get("prompt") or "").strip()
        if kind == "image":
            (d / f"{k:03d}.txt").write_text(cap, encoding="utf-8")
        else:
            (d / f"{k:03d}.caption.txt").write_text(cap or (it.get("title") or ""), encoding="utf-8")
            (d / f"{k:03d}.lyrics.txt").write_text("[Instrumental]", encoding="utf-8")
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
    extra = t["run"](ctx, data, out, p) or {}
    if not out.is_file():
        raise RuntimeError("l'entraînement n'a pas laissé de fichier")
    e = _add_version(p["board"], p["node"], list(p.get("items") or []), out, ctx.job["id"], False, extra)
    return {"lora": e["file"], "v": e["v"], "note": extra.get("note", "")}


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

    # ── au rendu : un LoRA entraîné, pour le modèle qui l'a produit ──
    _selftest_render(call, ok)


def essai_version(name: str, model: str, v: int = 1, trigger: str = "", node: str = "") -> str:
    """Pour les essais : un LoRA « entraîné » (une version réelle, son nom dans ComfyUI) ; rend ce nom."""
    from tools import lora_trainers
    bid, nid = "brd-essai-rendu", node or f"n_{model}{v}"
    s = load(bid, nid)
    comfy = "showrunner/" + lora_trainers.comfy_name(model, name, v)
    s.update(name=name, model=model)
    s.setdefault("versions", []).append({"v": v, "at": library.now(), "items": [], "file": f"{bid}-{nid}-v{v:03d}.safetensors",
                                         "job": "essai", "model": model, "comfy": comfy, "trigger": trigger})
    save(s)
    return comfy


def _selftest_render(call, ok) -> None:
    import importlib.util
    from core.comfy import fill
    ok(comfy_model("showrunner/zimage-paris-v001.safetensors") == "zimage" and comfy_model("showrunner/h3-x-v002-fl2v.safetensors") == "h3"
       and comfy_model("zimage-paris.safetensors") is None and comfy_model("showrunner/sdxl-x.safetensors") is None,
       "lora : le modèle d'un LoRA se lit à son nom dans ComfyUI")
    zi = essai_version("Paris 1900", "zimage", 1, "mbpar001")
    k2 = essai_version("Encre", "krea2", 2, "mbenc002")
    ok(zi == "showrunner/zimage-paris-1900-v001.safetensors", f"lora : le nom d'essai ({zi})")

    # le graphe : LoraLoaderModelOnly après le chargeur, ce que lisait le modèle lit le LoRA
    wf = json.loads((config.REPO / "server" / "workflows" / "image_zimage_turbo.json").read_text(encoding="utf-8"))
    g = fill({k: v for k, v in wf.items() if not k.startswith("_")},
             {"prompt": "mbpar001 a street", "seed": 7, "width": 1024, "height": 1024, "unet": "z_image_turbo_bf16.safetensors",
              "steps": 8, "cfg": 1.0})
    g = with_lora(g, zi, 0.8)
    lo = [(k, n) for k, n in g.items() if n["class_type"] == "LoraLoaderModelOnly"]
    ok(len(lo) == 1 and lo[0][1]["inputs"] == {"model": ["1", 0], "lora_name": zi, "strength_model": 0.8}
       and g["2"]["inputs"]["model"] == [lo[0][0], 0] and g["8"]["inputs"]["model"] == ["2", 0],
       f"lora : Z-Image — le LoRA entre après UNETLoader, ModelSamplingAuraFlow le lit ({lo})")
    try:
        with_lora({"1": {"class_type": "CheckpointLoaderSimple", "inputs": {}}}, zi, 1.0)
        ok(False, "lora : un graphe sans UNETLoader est refusé")
    except ValueError as e:
        ok("UNETLoader" in str(e), "lora : un graphe sans UNETLoader est refusé")

    # … et c'est ce graphe-là qui part à ComfyUI (tools/faux_comfy.py garde ce qu'il reçoit)
    spec = importlib.util.spec_from_file_location("faux_comfy", config.REPO / "tools" / "faux_comfy.py")
    faux = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(faux)
    sa, A, ua = faux.start()
    sb, B, ub = faux.start()
    A.loras = [zi, "showrunner/qwen21-rue-v001.safetensors", "training_adapters/minimax_h3_training_adapter_v3.safetensors", "autre.safetensors"]
    B.loras = []
    old_eps = globals()["comfy_endpoints"]
    try:
        pid = Comfy(ua).queue(g)
        got = Comfy(ua)._json("GET", "/_faux/last")
        nid = lo[0][0]
        ok(pid in A.prompts and got.get(nid, {}).get("class_type") == "LoraLoaderModelOnly"
           and got[nid]["inputs"]["lora_name"] == zi and got[nid]["inputs"]["strength_model"] == 0.8
           and got[nid]["inputs"]["model"] == ["1", 0] and got["2"]["inputs"]["model"] == [nid, 0],
           f"lora : la ComfyUI reçoit le LoRA branché sur le modèle, son fichier, sa force ({got.get(nid)})")
        globals()["comfy_endpoints"] = lambda: [ua, ub]
        _comfy_seen.clear()
        ok(machines_with(zi, [ua, ub]) == [ua] and machines_with("showrunner/zimage-absent-v001.safetensors", [ua, ub]) == [],
           "lora : la machine qui a le fichier (la copie vers l'autre DGX peut avoir échoué)")
        st, r = call("GET", "/api/lora?model=zimage")
        names = [x["name"] for x in r.get("render", [])]
        x = next((x for x in r.get("render", []) if x["name"] == zi), {})
        ok(st == 200 and names == [zi] and x.get("trigger") == "mbpar001" and x.get("title") == "Paris 1900" and x.get("v") == 1
           and x.get("machines") == [jobs.machine_of(ua)] and r.get("strength_max") == 1.5,
           f"lora : la liste d'une carte Z-Image — le LoRA du moodboard, son mot déclencheur, la machine qui l'a ({st} {str(r)[:300]})")
        st, r = call("GET", "/api/lora?model=qwen21")
        q = r.get("render") or [{}]
        ok(st == 200 and len(q) == 1 and q[0].get("source") == "comfy" and q[0].get("trigger") == "" and q[0].get("title") == "qwen21-rue-v001",
           f"lora : un LoRA de loras/showrunner/ que le portail n'a pas entraîné se propose aussi, sans mot déclencheur ({str(r)[:200]})")
        st, r = call("GET", "/api/lora?model=krea2")
        ok(st == 200 and [x["name"] for x in r["render"]] == [k2] and r["render"][0]["machines"] == [],
           "lora : un LoRA qu'aucune ComfyUI ne liste se propose, sans machine")
        st, _ = call("GET", "/api/lora?model=sdxl")
        ok(st == 400, "lora : un modèle inconnu est refusé")
    finally:
        globals()["comfy_endpoints"] = old_eps
        _comfy_seen.clear()
        sa.shutdown()
        sb.shutdown()

    # le contrôle d'un rendu : le bon modèle, une force de 0 à 1,5, le mot déclencheur du portail
    c = check_render("zimage", {"name": zi, "strength": 0.8, "trigger": "autre"})
    ok(c == {"name": zi, "strength": 0.8, "trigger": "mbpar001", "title": "Paris 1900", "v": 1},
       f"lora : un LoRA Z-Image pour Z-Image, son mot déclencheur vient du portail ({c})")
    for model, raw, variant, want in (("krea2", {"name": zi}, None, "Z-Image"), ("zimage", {"name": zi}, "base", "Turbo"),
                                      ("zimage", {"name": zi, "strength": 1.6}, None, "de 0 à 1,5"),
                                      ("zimage", {"name": "Minimax_H3/x.safetensors"}, None, "pas un LoRA du portail")):
        try:
            check_render(model, raw, variant)
            ok(False, f"lora : refusé — {want}")
        except ValueError as e:
            ok(want in str(e), f"lora : refusé — {want} ({e})")

    # la carte Générer passe par l'outil Image : le prompt part avec le mot déclencheur, le LoRA dans la recette
    st, r = call("POST", "/api/image/generate", {"model": "zimage", "prompt": "a street at night", "dry": True,
                                                 "lora": {"name": zi, "strength": 0.8}})
    ok(st == 200 and r["params"]["lora"]["name"] == zi and r["prompt"].startswith("mbpar001 a street at night")
       and any("Paris 1900" in n and "mbpar001" in n for n in r["notes"]),
       f"lora : Image — le LoRA dans la recette, son mot en tête du prompt ({st} {str(r)[:300]})")
    if r.get("graph"):   # Character Factory présent (les DGX) : le vrai graphe du portail
        gl = [n for n in r["graph"].values() if n["class_type"] == "LoraLoaderModelOnly" and n["inputs"]["lora_name"] == zi]
        ok(len(gl) == 1 and gl[0]["inputs"]["strength_model"] == 0.8, "lora : le graphe Z-Image du portail porte le LoRA")
    st, r = call("POST", "/api/image/generate", {"model": "krea2", "prompt": "x", "dry": True, "lora": {"name": zi}})
    ok(st == 400 and "Z-Image" in r.get("error", ""), f"lora : un LoRA Z-Image refusé pour Krea 2 ({st} {r})")
    st, r = call("POST", "/api/image/compose", {"model": "krea2", "prompt": "an ink drawing", "lora": {"name": k2, "strength": 1.2}})
    ok(st == 200 and r["prompt"].startswith("mbenc002 an ink drawing"), f"lora : « le prompt envoyé » de la carte le montre ({r})")

    # la carte garde son LoRA (la planche le normalise : un nom de loras/showrunner/, une force bornée)
    st, b = call("POST", "/api/ideation/boards", {"name": "Essai LoRA au rendu"})
    nodes = [{"id": "g1", "type": "gen", "x": 0, "y": 0, "w": 320, "h": 300, "model": "krea2", "lora": {"name": zi, "strength": 2}},
             {"id": "v1", "type": "vgen", "x": 400, "y": 0, "w": 330, "h": 320, "mode": "t2v", "lora": {"name": "Minimax_H3/x.safetensors"}}]
    st, _ = call("POST", f"/api/ideation/boards/{b['id']}", {"nodes": nodes, "links": []})
    st, got = call("GET", f"/api/ideation/boards/{b['id']}")
    byid = {n["id"]: n for n in got.get("nodes", [])}
    ok(st == 200 and byid["g1"].get("lora") == {"name": zi, "strength": 1.5} and "lora" not in byid["v1"],
       f"lora : la carte garde son LoRA même s'il ne va plus au modèle ; un nom étranger tombe ({byid.get('g1', {}).get('lora')})")
    # un lot (la carte Générer et sa case qui varie) : chaque rendu porte le LoRA
    st, r = call("POST", "/api/ideation/lot", {"kind": "image", "name": "Décor", "values": [{"value": "a", "prompt": "a street"},
                                                                                          {"value": "b", "prompt": "a field"}],
                                               "image": {"model": "zimage", "count": 1, "lora": {"name": zi, "strength": 0.7}}})
    js = (r or {}).get("jobs") or []
    ok(st == 200 and len(js) == 2 and all(j["params"]["lora"] == {"name": zi, "strength": 0.7, "trigger": "mbpar001", "title": "Paris 1900", "v": 1}
                                          for j in js), f"lora : un lot d'Idéation porte le LoRA dans chaque rendu ({st} {str(r)[:200]})")
    for j in js:
        call("POST", f"/api/jobs/{j['id']}/cancel")
