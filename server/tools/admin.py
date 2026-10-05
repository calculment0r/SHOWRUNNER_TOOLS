"""La page d'administration (admin/) : Cal seul.

Les demandes d'accès, les personnes (quotas, suspendre, appareils, ce
qu'elles ont lancé), la file entière (glisser, priorité, épingler, pause
par machine, vidange, annuler), les machines (instances ComfyUI, mémoire,
modèles chargés, H3, le studio Character Factory, le relais), les
interrupteurs de câblage (showrunner.local.json), le stockage et le
journal. Toutes les routes sont sous /api/admin/ : la porte du socle
(core/auth.py) les refuse à qui n'est pas Cal, et chaque route le
revérifie.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from core import auth, config, espaces, jobs, library, machines
from core.http import HttpError

# les interrupteurs que la page lit et change : les valeurs que le code de
# chaque outil comprend (la ligne est dite dans `doc`)
config.declare_switch("image_backend", ["stub", "comfyui"], label="Image · moteur", default="stub",
                      doc="server/tools/image.py, backend() : stub (factice) ou comfyui")
config.declare_switch("movie_engine", ["factice", "h3"], label="Vidéo · moteur", default="factice",
                      doc="server/tools/movie.py, engine() : factice (ffmpeg) ou h3 (ComfyUI-H3TEST :8189, démarré à la demande)")
config.declare_switch("music_engine", ["factice", "ace-step"], label="Musique · moteur", default="factice",
                      doc="server/tools/music.py, engine() : factice ou ace-step (ACE-Step 1.5 et Demucs sur ComfyUI)")
config.declare_switch("objet_trellis", [False, True], label="Object Creator · TRELLIS.2", default=False,
                      doc="server/tools/objet.py, wired() : TRELLIS.2 ne part que câblé")
# nommés par Cal (29/09), à déclarer par leur outil quand il existera
EXPECTED = ("music_yue", "upscale_backend")
RESTART = "ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && tools/portail.sh restart'"

_store = {"t": 0.0, "v": None}
_store_lock = threading.Lock()


def _admin(req) -> dict:
    u = getattr(req, "user", None)
    if not auth.is_admin(u):
        raise HttpError(403, "réservé à Cal")
    return u


# ── l'état : demandes, personnes, file ──────────────────────
def state(req):
    me = _admin(req)
    users = auth.users_public()
    view = jobs.queue_view(recent=60)
    everyone = jobs.listing(limit=400)
    items = library.query(None, limit=10 ** 6)["items"]
    for u in users:
        mine = [j for j in everyone if j.get("owner") == u["id"]]
        u["running"] = sum(1 for j in mine if j["state"] == "running")
        u["queued"] = sum(1 for j in mine if j["state"] == "queued")
        u["today"] = jobs.day_count(u["id"])
        u["items"] = sum(1 for it in items if it.get("owner") == u["id"] or (not it.get("owner") and u["role"] == "admin"))
        u["recent"] = [{k: j.get(k) for k in ("id", "title", "state", "created", "tool", "message")} for j in mine[:8]]
    return {"me": auth.public_user(me), "auth": auth.enabled(), "requests": [u for u in users if u["state"] == "pending"],
            "users": [u for u in users if u["state"] != "pending"], "settings": auth.settings(), "queue": view,
            "priorities": jobs.PRIORITIES}


def accept(req, uid):
    me = _admin(req)
    return auth.public_user(auth.accept(uid, me["id"]))


def refuse(req, uid):
    me = _admin(req)
    auth.refuse(uid, me["id"])
    return {"ok": True}


def set_user(req, uid):
    me = _admin(req)
    d = req.json()
    u = auth.set_user(uid, d, me["id"])
    if d.get("state") == "suspended":   # suspendu : ses travaux en file s'en vont, ce qui tourne finit
        for j in jobs.listing(limit=400):
            if j.get("owner") == uid and j["state"] == "queued":
                jobs.cancel(j["id"])
    return auth.public_user(u)


def delete_user(req, uid):
    """Détruire un compte (Admin → Personnes → Supprimer) : ses travaux en file s'en vont, ses connexions
    se ferment, il sort des Teams ; ce qu'il a rangé reste dans les Workspaces (espaces.forget_user)."""
    me = _admin(req)
    gone = auth.delete_user(uid, me["id"])   # les refus d'abord : un refus ne retire aucun travail
    for j in jobs.listing(limit=400):
        if j.get("owner") == uid and j["state"] == "queued":
            jobs.cancel(j["id"])
    return {"ok": True, "name": gone.get("name", uid), "teams": espaces.forget_user(uid)}


def user_devices(req, uid):
    _admin(req)
    return {"devices": auth.devices(uid)}


def user_revoke(req, uid, sid):
    me = _admin(req)
    return {"removed": auth.revoke(uid, sid, by=me["id"])}


def settings(req):
    me = _admin(req)
    return auth.set_settings(req.json(), by=me["id"])


# ── la file ─────────────────────────────────────────────────
def queue_op(req, job_id):
    me = _admin(req)
    d = req.json()
    try:
        out = None
        if d.get("to_end") or d.get("before"):
            out = jobs.move(job_id, d.get("before") or None)
        if "priority" in d:
            out = jobs.set_priority(job_id, int(d["priority"]))
        if "top" in d:
            out = jobs.set_top(job_id, bool(d["top"]))
    except KeyError as e:
        raise HttpError(404, "travail introuvable") from e
    except (TypeError, ValueError) as e:
        raise HttpError(400, str(e)) from e
    if out is None:
        raise HttpError(400, "rien à faire : before, to_end, priority ou top")
    auth.journal("file", by=me["id"], job=job_id, op=d)
    return out


def pause(req):
    _admin(req)
    d = req.json()
    return jobs.set_mode(d.get("machine") or None, d.get("mode", "paused"))


# ── les machines ────────────────────────────────────────────
def _get(url: str, timeout: float = 2.5):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def _ollama(machine: str) -> dict:
    url = (config.get("machine_ollama") or {}).get(machine)
    if not url:
        return {"url": None}
    try:
        models = [{"name": m.get("name"), "size_gb": round((m.get("size") or 0) / 1e9, 1), "until": m.get("expires_at")}
                  for m in _get(url.rstrip("/") + "/api/ps").get("models", [])]
        return {"url": url, "up": True, "models": models}
    except (OSError, ValueError, urllib.error.URLError) as e:
        return {"url": url, "up": False, "why": str(e)[:160], "models": []}


def _relay() -> dict:
    url = str(config.get("cf_public") or "")
    if not url:
        return {"url": None}
    try:
        with urllib.request.urlopen(url.rstrip("/") + "/api/system", timeout=2.5) as r:
            r.read()
        return {"url": url, "up": True}
    except (OSError, urllib.error.URLError) as e:
        return {"url": url, "up": False, "why": str(e)[:160]}


def machines_view(req):
    _admin(req)
    sched = jobs.scheduler_state()
    gb, src = machines.family_gb()
    lanes = config.get("lanes") or {}
    active = [j for j in jobs.listing(limit=400) if j["state"] == "running"]
    out = []
    for m in machines.machines():
        insts = []
        for url in machines.instances_of(m):
            st = machines.cached(url)
            if time.time() - st.get("t", 0) > 15:
                st = machines.refresh(url)
            mine_here = [j for j in active if j.get("endpoint") == url]
            items = [{"client": it["client"][:40], "who": ("la file du portail" if (mine_here and it["client"].startswith(machines.OURS))
                                                            else machines.who(it["client"])), "state": it["state"]}
                     for it in st.get("items") or []]
            takes = {}
            for lane, eps in lanes.items():
                if url in eps:
                    j, why = jobs.dry_choose(lane, url)
                    takes[lane] = {"job": j["title"] if j else None, "why": why}
            insts.append({"url": url, "port": machines.port_of(url), "lanes": [lane for lane, eps in lanes.items() if url in eps],
                          "up": st.get("up"), "why": st.get("why"), "free_gb": st.get("free_gb"), "total_gb": st.get("total_gb"),
                          "loaded": machines.loaded(url), "items": items, "running": [j["title"] for j in mine_here],
                          "takes": takes, "comfyui": st.get("comfyui")})
        free = next((i["free_gb"] for i in insts if i["up"] and i["free_gb"] is not None), None)
        total = next((i["total_gb"] for i in insts if i["up"] and i["total_gb"]), None)
        info = sched["machines"].get(m, {"mode": "active", "running": [], "drained": False})
        out.append({"name": m, **info, "free_gb": free, "total_gb": total, "instances": insts, "ollama": _ollama(m)})
    mv = sys.modules.get("tools.movie")
    h3 = None
    if mv and hasattr(mv, "h3_status"):
        try:
            h3 = mv.h3_status()
        except Exception as e:  # la page admin reste debout
            h3 = {"error": f"{type(e).__name__}: {e}"}
    return {"machines": out, "paused": sched["paused"], "h3": h3, "cf": machines.cf_jobs(), "relay": _relay(),
            "families": {"gb": gb, "source": src},
            "rules": {"gpu_jobs_per_machine": config.get("gpu_jobs_per_machine", 1),
                      "group_window": config.get("group_window", 4), "max_overtake": config.get("max_overtake", 3)}}


def free_instance(req):
    me = _admin(req)
    url = req.json().get("url") or ""
    if url not in machines.instances():
        raise HttpError(400, "instance inconnue")
    done, why = machines.free_instance(url)
    auth.journal("décharger", by=me["id"], url=url, ok=done, why=why)
    if not done:
        raise HttpError(409, f"{machines.machine_of(url)} :{machines.port_of(url)} n'est pas vidée : {why}")
    return {"ok": True, "why": why}


def ollama_unload(req):
    me = _admin(req)
    d = req.json()
    url = (config.get("machine_ollama") or {}).get(d.get("machine") or "")
    if not url:
        raise HttpError(400, "pas d'Ollama connu pour cette machine (machine_ollama)")
    body = json.dumps({"model": str(d.get("model") or ""), "keep_alive": 0}).encode()
    try:   # l'API documentée d'Ollama : keep_alive 0 décharge (factory/memory.py, unload_llm)
        with urllib.request.urlopen(urllib.request.Request(url.rstrip("/") + "/api/generate", data=body, method="POST",
                                                           headers={"Content-Type": "application/json"}), timeout=30) as r:
            r.read()
    except (OSError, urllib.error.URLError) as e:
        raise HttpError(502, f"Ollama ne répond pas : {e}") from e
    auth.journal("ollama déchargé", by=me["id"], machine=d.get("machine"), model=d.get("model"))
    return {"ok": True}


# ── les interrupteurs de câblage ────────────────────────────
def switches(req):
    _admin(req)
    local = config.read_local()
    items = []
    for key, sw in config.SWITCHES.items():
        running = config.get(key, sw["default"])
        in_file = local.get(key, sw["default"])
        items.append({**sw, "running": running, "file": in_file, "pending": in_file != running})
    others = {k: v for k, v in local.items() if k not in config.SWITCHES}
    missing = [k for k in EXPECTED if k not in config.SWITCHES]
    return {"items": items, "others": others, "expected": missing, "file": str(config.LOCAL), "restart": RESTART}


def set_switch(req):
    me = _admin(req)
    d = req.json()
    key = d.get("key")
    sw = config.SWITCHES.get(key)
    if not sw:
        raise HttpError(400, f"interrupteur inconnu : {key} (son outil doit le déclarer : config.declare_switch)")
    if d.get("value") not in sw["values"]:
        raise HttpError(400, f"{key} : une de ces valeurs : {', '.join(json.dumps(v) for v in sw['values'])}")
    config.write_local(key, d["value"])
    auth.journal("interrupteur", by=me["id"], key=key, value=d["value"])
    return switches(req)


# ── le stockage ─────────────────────────────────────────────
def _du(p: Path) -> tuple[int, int]:
    size = n = 0
    for root, _dirs, files in os.walk(p):
        for f in files:
            try:
                size += os.path.getsize(os.path.join(root, f))
                n += 1
            except OSError:
                continue
    return size, n


def storage(req):
    _admin(req)
    with _store_lock:
        if _store["v"] and time.time() - _store["t"] < 20 and req.q("fresh") != "1":
            return _store["v"]
    d = config.data_dir()
    parts = []
    for sub in sorted(x for x in d.iterdir() if x.is_dir()):
        size, n = _du(sub)
        parts.append({"name": sub.name, "bytes": size, "files": n})
    trash = [x for x in library.trash_root().iterdir() if x.is_dir()]
    q = library.query(None, limit=10 ** 6)
    try:
        st = shutil.disk_usage(d)
        disk = {"free": st.free, "total": st.total}
    except OSError:
        disk = None
    v = {"data_dir": str(d), "parts": parts, "counts": q["counts"], "items": q["total"], "trash_items": len(trash),
         "disk": disk}
    with _store_lock:
        _store.update(t=time.time(), v=v)
    return v


def empty_trash(req):
    me = _admin(req)
    gone = 0
    for x in library.trash_root().iterdir():
        if x.is_dir():
            shutil.rmtree(x, ignore_errors=True)
            gone += 1
    auth.journal("corbeille vidée", by=me["id"], items=gone)
    _store["t"] = 0.0
    return {"removed": gone}


# ── le journal ──────────────────────────────────────────────
def journal(req):
    _admin(req)
    n = max(10, min(1000, int(req.q("n", "200") or 200)))
    log = []
    f = Path(str(config.get("log_file") or "")).expanduser()
    if f.is_file():
        with open(f, "rb") as fh:
            fh.seek(0, 2)
            fh.seek(max(0, fh.tell() - 24000))
            log = fh.read().decode("utf-8", "replace").splitlines()[-80:]
    return {"events": auth.journal_tail(n), "log": log, "log_file": str(f)}


# ── I · les diagnostics, sans terminal (Cal, 05/10 : « chiant de le faire à chaque modif ») ──
# Une liste FIXE de scripts du dépôt, sans argument venu de la page : Cal (un admin) les lance d'un clic,
# la sortie s'affiche dans la page. Lecture seule, sauf « planche » (qui crée la planche de la réunion :
# elle tourne DANS le portail, pour que la bibliothèque voie ses photos aussitôt, sans redémarrage).
REPO = Path(__file__).resolve().parents[2]
DIAGS = {   # id : (nom court, ce qu'il dit, commande, délai en s, action ?)
    "maj": ("Mise à jour", "la mise à jour automatique : installée ou non, la version en route, ce qu'elle a fait (son journal)",
            ["bash", "tools/auto_maj.sh", "etat"], 90, False),
    "voies": ("Voies de calcul", "quelles machines calculent l'image, la vidéo, l'audio", ["python3", "tools/voie.py"], 30, False),
    "yue": ("YuE2 · paroles", "ce que les dernières chansons YuE2 ont vraiment reçu : style, paroles, partition",
            ["python3", "tools/diag_yue.py", "5"], 60, False),
    "yue_wf": ("YuE2 · workflows", "tes workflows YuE2 de ComfyUI contre le graphe que le portail envoie",
               ["python3", "tools/diag_yue_workflow.py"], 120, False),
    "yue_miroir": ("YuE2 · modèles", "les fichiers de YuE2 présents sur les deux DGX (rien n'est copié)",
                   ["bash", "tools/mirror_yue.sh", "--check"], 300, False),
    "director": ("Director", "le nœud Director de ComfyUI et ses entrées", ["python3", "tools/diag_director.py"], 120, False),
    "planche_plan": ("Planche · plan", "la planche de la réunion (establishing shots) : ce qu'elle contiendra",
                     ["python3", "tools/board_reunion.py", "--plan"], 60, False),
    "planche": ("Planche · créer", "crée la planche de la réunion dans LES ANEES FOLLES, photos d'époque comprises", None, 1800, True),
}
_runs: dict = {}
_runs_lock = threading.Lock()
OUT_MAX = 200_000


def _diag_run(name: str) -> None:
    _, _, argv, timeout, _ = DIAGS[name]
    r = _runs[name]
    try:
        if argv is None:   # en mémoire : la planche (tools/board_reunion.py, main(…, say=…))
            import importlib.util
            spec = importlib.util.spec_from_file_location("board_reunion", REPO / "tools" / "board_reunion.py")
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            def say(*a):
                r["out"] = (r["out"] + " ".join(str(x) for x in a) + "\n")[-OUT_MAX:]
            try:
                rc = mod.main([], say=say, en_portail=True)
            except SystemExit as e:   # resolve_space : « aucune Team … »
                say(str(e.code) if e.code not in (None, 0) else "")
                rc = 1 if e.code not in (None, 0) else 0
        else:
            p = subprocess.run(argv, cwd=str(REPO), capture_output=True, text=True, timeout=timeout)
            r["out"] = ((p.stdout or "") + (("\n" + p.stderr) if p.stderr else ""))[-OUT_MAX:]
            rc = p.returncode
        r.update(state="done" if rc == 0 else "failed", rc=rc)
    except subprocess.TimeoutExpired as e:
        r.update(state="failed", rc=-1, out=((e.stdout or "") if isinstance(e.stdout, str) else "") + f"\n(arrêté après {timeout} s)")
    except Exception as e:   # un diagnostic qui casse ne casse pas le portail
        r.update(state="failed", rc=-1, out=(r.get("out") or "") + f"\n{type(e).__name__} : {e}")
    finally:
        r["ended"] = time.time()
    auth.journal("diagnostic", diag=name, etat=r["state"])


def diag_list(req):
    _admin(req)
    with _runs_lock:
        return {"diags": [{"id": k, "label": v[0], "doc": v[1], "action": v[4], **{x: _runs.get(k, {}).get(x) for x in ("state", "started", "ended", "rc", "out")}}
                          for k, v in DIAGS.items()]}


def diag_start(req, name):
    me = _admin(req)
    if name not in DIAGS:
        raise HttpError(404, "diagnostic inconnu")
    with _runs_lock:
        if (_runs.get(name) or {}).get("state") == "running":
            raise HttpError(409, "il tourne déjà : sa sortie arrive")
        _runs[name] = {"state": "running", "started": time.time(), "ended": None, "rc": None, "out": "", "by": me["id"]}
    threading.Thread(target=_diag_run, args=(name,), daemon=True, name=f"diag-{name}").start()
    return {"ok": True}


def register(app) -> None:
    app.route("GET", "/api/admin/state", state)
    app.route("POST", "/api/admin/requests/{uid}/accept", accept)
    app.route("POST", "/api/admin/requests/{uid}/refuse", refuse)
    app.route("POST", "/api/admin/users/{uid}", set_user)
    app.route("POST", "/api/admin/users/{uid}/supprimer", delete_user)
    app.route("GET", "/api/admin/users/{uid}/devices", user_devices)
    app.route("POST", "/api/admin/users/{uid}/devices/{sid}/revoke", user_revoke)
    app.route("POST", "/api/admin/settings", settings)
    app.route("POST", "/api/admin/queue/{job_id}", queue_op)
    app.route("POST", "/api/admin/pause", pause)
    app.route("GET", "/api/admin/machines", machines_view)
    app.route("POST", "/api/admin/instances/free", free_instance)
    app.route("POST", "/api/admin/ollama/unload", ollama_unload)
    app.route("GET", "/api/admin/switches", switches)
    app.route("POST", "/api/admin/switches", set_switch)
    app.route("GET", "/api/admin/storage", storage)
    app.route("POST", "/api/admin/trash/empty", empty_trash)
    app.route("GET", "/api/admin/journal", journal)
    app.route("GET", "/api/admin/diag", diag_list)
    app.route("POST", "/api/admin/diag/{name}", diag_start)


# ── le contrôle (tools/check.py) : la file contre deux faux ComfyUI ──
def essai_http(method: str, path: str, body=None, *, cookie: str | None = None, headers: dict | None = None,
               raw: bytes | None = None):
    """Une requête au portail du contrôle : (statut, réponse, jeton posé en cookie ou None)."""
    base = f"http://127.0.0.1:{config.get('port')}"
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(base + path, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if cookie:
        req.add_header("Cookie", f"{auth.COOKIE}={cookie}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            st, txt, hd = r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        st, txt, hd = e.code, e.read(), e.headers
    try:
        doc = json.loads(txt)
    except ValueError:
        doc = txt
    sc = hd.get("Set-Cookie") or ""
    tok = sc.split(";", 1)[0].split("=", 1)[1] if sc.startswith(auth.COOKIE + "=") else None
    return st, doc, tok


def _faux():
    import importlib.util
    spec = importlib.util.spec_from_file_location("faux_comfy", config.REPO / "tools" / "faux_comfy.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def selftest(call, ok) -> None:
    faux = _faux()
    sa, A, ua = faux.start(total_gb=120.0, free_gb=100.0)
    sb, B, ub = faux.start(total_gb=120.0, free_gb=100.0)
    keys = ("lanes", "machine_names", "settle_s", "wait_retry_s", "max_overtake", "auth")
    saved = {k: config.CFG.get(k) for k in keys}
    fam_saved = dict(machines._fam)
    local_saved = config.LOCAL
    config.CFG["lanes"] = {**(config.CFG.get("lanes") or {}), "essai": [ua, ub]}
    config.CFG["machine_names"] = {ua: "ESSAI-A", ub: "ESSAI-B"}
    config.CFG["settle_s"], config.CFG["wait_retry_s"] = 0.3, 0.3
    machines._fam.update(t=time.time() + 1e6, gb={"krea2": 36.0, "qwen21": 34.0, "zimage": 24.0, "h3": 100.0},
                         src="essai")
    ev: dict[str, threading.Event] = {}
    workers = []

    def run(ctx):
        e = ev.setdefault(ctx.params["k"], threading.Event())
        ctx.progress(0.2, "essai")
        while not e.wait(0.05):
            ctx.check()
        return {"note": ctx.params["k"]}

    for fam in ("krea2", "qwen21", "zimage", "h3"):
        jobs.register(f"essai.{fam}", run, lane="essai", title=f"Essai {fam}", family=fam, cost="gpu")
    with auth._lock:
        db = auth._data()
        for uid, name in (("lea", "Léa"), ("zoe", "Zoé")):
            db["users"][uid] = {"id": uid, "name": name, "role": "ami", "state": "active", "created": auth.now_iso(),
                                "quotas": {}}
        auth._save()

    def sub(fam, k, owner, **kw):
        return jobs.submit(f"essai.{fam}", {"k": k}, title=k, owner=owner, **kw)

    def order():
        return [j["title"] for j in jobs.ordered("essai")]

    def wait_for(cond, t: float = 10.0) -> bool:
        end = time.time() + t
        while time.time() < end:
            if cond():
                return True
            time.sleep(0.05)
        return False

    def st(j):
        return jobs.get(j["id"])

    def release(*ks):
        for k in ks:
            ev.setdefault(k, threading.Event()).set()

    def quota_error(fn) -> str:
        try:
            fn()
        except jobs.QuotaError as e:
            return e.message
        return ""

    try:
        # 1. l'ordre : le tourniquet (la file en pause : rien ne part)
        jobs.set_mode(None, "paused")
        for k in ("L1", "L2", "L3"):
            sub("krea2", k, "lea")
        sub("krea2", "C1", "cal", priority=0)
        sub("krea2", "Z1", "zoe")
        ok(order() == ["L1", "C1", "Z1", "L2", "L3"], f"le tourniquet : le 2ᵉ travail de Léa passe après le 1ᵉʳ de chacun ({order()})")
        c2 = sub("krea2", "C2", "cal")
        ok(c2["priority"] == 1 and order()[0] == "C2", f"Cal passe devant par défaut (audit H4 : admin_first) ({order()})")
        # 2. glisser, épingler, priorité
        ids = {j["title"]: j["id"] for j in jobs.ordered("essai")}
        jobs.move(ids["Z1"], ids["L1"])
        ok(order() == ["C2", "Z1", "L1", "C1", "L2", "L3"], f"glisser Z1 avant L1 ({order()})")
        jobs.set_top(ids["L3"], True)
        jobs.set_priority(ids["L1"], -1)
        jobs.move(ids["C2"], None)
        ok(order() == ["L3", "Z1", "C1", "L2", "L1", "C2"],
           f"épinglé en tête, priorité basse, glissé en fin de file ({order()})")
        # 3. les quotas : en file, par jour, le total
        msg = quota_error(lambda: sub("krea2", "L4", "lea"))
        ok("3 travaux en file" in msg and "quota est de 3" in msg, f"quota en file (3 par défaut, audit H4) : « {msg} »")
        auth.set_user("lea", {"quotas": {"queued": 10, "per_day": 4}}, "cal")
        ok(not quota_error(lambda: sub("krea2", "L4", "lea")), "quota relevé par Cal : Léa lance un 4ᵉ travail")
        msg = quota_error(lambda: sub("krea2", "L5", "lea"))
        ok("aujourd'hui" in msg and "4" in msg, f"quota par jour : « {msg} »")
        auth.set_settings({"total_queued": 8}, by="cal")
        ok(not quota_error(lambda: sub("krea2", "Z2", "zoe")), "le 8ᵉ travail en file passe")
        msg = quota_error(lambda: sub("krea2", "Z3", "zoe"))
        ok("la file est pleine" in msg, f"le total en file : « {msg} »")
        auth.set_settings({"total_queued": 50}, by="cal")
        auth.set_user("lea", {"quotas": {"queued": None, "per_day": None}}, "cal")
        for j in jobs.ordered("essai"):
            jobs.cancel(j["id"])
        ok(not order(), "la file d'essai se vide (annuler)")

        # 4. le modèle déjà chargé : chaque instance prend sa famille
        machines.refresh(ua)
        machines.refresh(ub)
        machines.set_loaded(ua, "krea2")
        machines.set_loaded(ub, "qwen21")
        workers.extend([jobs.add_worker("essai", ua), jobs.add_worker("essai", ub)])
        q1, k1 = sub("qwen21", "Q1", "cal"), sub("krea2", "K1", "cal")
        jobs.set_mode(None, "active")
        ok(wait_for(lambda: st(q1)["state"] == st(k1)["state"] == "running"), "les deux travaux partent")
        ok(st(k1).get("endpoint") == ua and st(q1).get("endpoint") == ub,
           f"préférence de modèle : Krea 2 sur l'instance qui l'a, Qwen sur l'autre ({st(k1).get('machine')}, {st(q1).get('machine')})")
        ok(A.frees == 0 and B.frees == 0, "une instance qui a déjà la famille n'est pas vidée")
        # 5. le regroupement, borné : ESSAI-B en pause
        jobs.set_mode("ESSAI-B", "paused")
        release("Q1")
        z9, k2 = sub("zimage", "Z9", "cal"), sub("krea2", "K2", "cal")
        release("K1")
        ok(wait_for(lambda: st(k2)["state"] == "running") and st(z9)["state"] == "queued",
           "la famille chargée d'abord : K2 double Z9 sur ESSAI-A (Krea 2 déjà là)")
        config.CFG["max_overtake"] = 1
        k3 = sub("krea2", "K3", "cal")
        release("K2")
        ok(wait_for(lambda: st(z9)["state"] == "running") and st(k3)["state"] == "queued",
           "un travail doublé max_overtake fois ne l'est plus : Z9 part avant K3")
        ok(A.frees >= 1, f"changer de famille vide l'instance (/free : {A.frees})")
        release("Z9")
        ok(wait_for(lambda: st(k3)["state"] == "running"), "K3 part ensuite")
        release("K3")
        config.CFG["max_overtake"] = 3
        ok(wait_for(lambda: st(k3)["state"] == "done"), "K3 fini")

        # 6. un rendu qui n'est pas du portail : on attend, en le disant
        A.busy, A.client = True, "usine-essai"
        machines.refresh(ua)
        k5 = sub("krea2", "K5", "cal")
        time.sleep(0.6)
        jobs.annotate(force=True)
        j5 = st(k5)
        ok(j5["state"] == "queued" and "le studio Character Factory calcule sur ESSAI-A" in (j5.get("message") or ""),
           f"le studio calcule sur la machine : le travail attend et le dit (« {j5.get('message')} »)")
        A.busy = False
        machines.refresh(ua)
        ok(wait_for(lambda: st(k5)["state"] == "running"), "le studio a fini : le travail part")
        release("K5")
        ok(wait_for(lambda: st(k5)["state"] == "done"), "K5 fini")

        # 7. la mémoire : on attend qu'elle se libère, en le disant ; trop gros : refusé
        A.free = 20.0
        machines.set_loaded(ua, "")
        machines.refresh(ua)
        h1 = sub("h3", "H1", "cal")
        ok(wait_for(lambda: "mémoire : 20 Go libres sur ESSAI-A, il en faut 100" in (st(h1).get("message") or "")),
           f"mémoire insuffisante : on attend en le disant (« {st(h1).get('message')} »)")
        A.free = 110.0
        ok(wait_for(lambda: st(h1)["state"] == "running"), "la mémoire revient : H3 part")
        release("H1")
        big = jobs.submit("essai.h3", {"k": "BIG"}, title="BIG", owner="cal", mem_gb=500)
        ok(wait_for(lambda: st(big)["state"] == "error") and "500 Go" in st(big)["message"],
           f"un travail plus gros que la machine échoue en le disant ({st(big)['state']} « {st(big).get('message')} »)")

        # 8. un travail à la fois par personne (quota « simultanés » : 1)
        jobs.set_mode("ESSAI-B", "active")
        machines.set_loaded(ua, "krea2")
        machines.set_loaded(ub, "krea2")
        la, lb = sub("krea2", "LA", "lea"), sub("krea2", "LB", "lea")
        ok(wait_for(lambda: "running" in (st(la)["state"], st(lb)["state"])), "Léa : un travail part")
        time.sleep(0.6)
        jobs.annotate(force=True)
        other = st(lb) if st(la)["state"] == "running" else st(la)
        ok(other["state"] == "queued" and "1 travail à la fois pour Léa" in (other.get("message") or ""),
           f"le second attend son tour, et le dit (« {other.get('message')} »)")
        release("LA", "LB")
        ok(wait_for(lambda: st(la)["state"] == st(lb)["state"] == "done"), "les deux finissent")

        # 9. la vidange : finir, puis ne plus rien prendre
        k6 = sub("krea2", "K6", "cal")
        ok(wait_for(lambda: st(k6)["state"] == "running"), "K6 part")
        m6 = st(k6)["machine"]
        m_other = "ESSAI-B" if m6 == "ESSAI-A" else "ESSAI-A"
        s = jobs.set_mode(m6, "draining")
        ok(s["machines"][m6]["mode"] == "draining" and not s["machines"][m6]["drained"], "vidange : K6 finit d'abord")
        jobs.set_mode(m_other, "paused")
        k7 = sub("krea2", "K7", "cal")
        release("K6")
        ok(wait_for(lambda: jobs.scheduler_state()["machines"][m6]["drained"]), "vidange : la machine est vidée")
        time.sleep(0.5)
        jobs.annotate(force=True)
        ok(st(k7)["state"] == "queued" and "vidange" in (st(k7).get("message") or ""),
           f"une machine vidée ne prend plus rien (« {st(k7).get('message')} »)")
        jobs.set_mode(m6, "active")
        jobs.set_mode(m_other, "active")
        ok(wait_for(lambda: st(k7)["state"] == "running"), "reprise : K7 part")
        release("K7")
        ok(jobs.estimate({"kind": "essai.krea2", "family": "krea2", "params": {"k": "x"}}) is not None,
           "les durées mesurées font l'estimation")

        # 10. l'API d'admin, porte allumée
        config.CFG["auth"] = True
        auth.startup()
        tmp = config.data_dir() / "essai-local.json"
        config.LOCAL = tmp
        same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
        s_, d, tok = essai_http("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        ok(s_ == 200 and tok and d.get("user", {}).get("role") == "admin", f"Cal entre par son pseudo ({s_} {d})")
        s_, d, _ = essai_http("GET", "/api/admin/state", cookie=tok)
        ok(s_ == 200 and {"lea", "zoe"} <= {u["id"] for u in d.get("users", [])}, f"l'état pour Cal ({s_})")
        jobs.set_mode(None, "paused")
        a1, a2 = sub("krea2", "A1", "cal", priority=0), sub("krea2", "A2", "cal", priority=0)
        s_, d, _ = essai_http("POST", f"/api/admin/queue/{a2['id']}", {"before": a1["id"]}, cookie=tok, headers=same)
        ok(s_ == 200 and order()[:2] == ["A2", "A1"], f"glisser par l'API ({s_} {order()})")
        s_, d, _ = essai_http("POST", f"/api/admin/queue/{a1['id']}", {"top": True}, cookie=tok, headers=same)
        ok(s_ == 200 and order()[0] == "A1", f"épingler par l'API ({s_})")
        s_, d, _ = essai_http("POST", "/api/admin/pause", {"machine": "ESSAI-A", "mode": "paused"}, cookie=tok, headers=same)
        ok(s_ == 200 and d["machines"]["ESSAI-A"]["mode"] == "paused", f"pause d'une machine par l'API ({s_})")
        essai_http("POST", "/api/admin/pause", {"machine": "ESSAI-A", "mode": "active"}, cookie=tok, headers=same)
        s_, d, _ = essai_http("POST", "/api/admin/users/lea", {"quotas": {"queued": 1}}, cookie=tok, headers=same)
        ok(s_ == 200 and auth.quotas_for("lea")["queued"] == 1, f"un quota changé par l'API ({s_})")
        auth.set_user("lea", {"quotas": {"queued": None}}, "cal")
        s_, d, _ = essai_http("GET", "/api/admin/diag", cookie=tok)
        ok(s_ == 200 and {"voies", "yue", "planche"} <= {x["id"] for x in d.get("diags", [])}, f"les diagnostics se listent ({s_})")
        s_, _, _ = essai_http("POST", "/api/admin/diag/rm_rf", {}, cookie=tok, headers=same)
        ok(s_ == 404, f"un diagnostic hors de la liste : 404 ({s_})")
        s_, _, _ = essai_http("POST", "/api/admin/diag/voies", {}, cookie=tok, headers=same)
        t_end = time.time() + 30
        while time.time() < t_end and (_runs.get("voies") or {}).get("state") == "running":
            time.sleep(0.2)
        ok(s_ == 200 and (_runs.get("voies") or {}).get("state") == "done" and "audio" in (_runs["voies"].get("out") or ""),
           f"un diagnostic se lance d'un clic et rend sa sortie ({s_} {(_runs.get('voies') or {}).get('state')})")
        auth.create_friend("Efface Moi", by="cal")
        s_, d, _ = essai_http("POST", "/api/admin/users/efface-moi/supprimer", {}, cookie=tok, headers=same)
        ok(s_ == 200 and auth.user("efface-moi") is None, f"un compte se détruit par l'API ({s_})")
        s_, d, _ = essai_http("POST", "/api/admin/users/efface-moi/supprimer", {}, cookie=tok, headers=same)
        ok(s_ == 404, f"détruire un compte absent : 404 ({s_})")
        s_, d, _ = essai_http("POST", "/api/admin/users/cal/supprimer", {}, cookie=tok, headers=same)
        ok(s_ in (404, 409), f"détruire Cal : refusé ({s_})")
        s_, d, _ = essai_http("GET", "/api/admin/switches", cookie=tok)
        ok(s_ == 200 and {i["key"] for i in d["items"]} >= {"image_backend", "movie_engine", "music_engine", "objet_trellis"},
           f"les interrupteurs se lisent ({s_})")
        s_, d, _ = essai_http("POST", "/api/admin/switches", {"key": "image_backend", "value": "comfyui"}, cookie=tok, headers=same)
        wrote = json.loads(tmp.read_text(encoding="utf-8")) if tmp.exists() else {}
        item = next((i for i in d.get("items", []) if i["key"] == "image_backend"), {}) if s_ == 200 else {}
        ok(s_ == 200 and wrote.get("image_backend") == "comfyui" and item.get("pending"),
           f"un interrupteur s'écrit dans showrunner.local.json, en attente de redémarrage ({s_})")
        s_, _, _ = essai_http("POST", "/api/admin/switches", {"key": "image_backend", "value": "gpu"}, cookie=tok, headers=same)
        s2, _, _ = essai_http("POST", "/api/admin/switches", {"key": "rm_rf", "value": True}, cookie=tok, headers=same)
        ok(s_ == 400 and s2 == 400, f"valeur ou interrupteur inconnus : refusés ({s_}, {s2})")
        for path in ("/api/admin/storage", "/api/admin/journal", "/api/admin/machines"):
            s_, d, _ = essai_http("GET", path, cookie=tok)
            ok(s_ == 200 and isinstance(d, dict), f"{path} ({s_})")
        s_, d, _ = essai_http("GET", "/api/admin/machines", cookie=tok)
        ok(any(m["name"] == "ESSAI-A" and m["instances"] for m in d.get("machines", [])), "les machines et leurs instances")
        s_, d, tl = essai_http("POST", "/api/auth/enter", {"name": "Léa"}, headers=same)
        ok(s_ == 200 and tl and d.get("state") == "active", f"Léa, acceptée, entre par son pseudo ({s_})")
        s_, _, _ = essai_http("GET", "/api/admin/state", cookie=tl)
        ok(s_ == 403, f"la page d'admin est aux admins seuls ({s_})")
        la2 = jobs.submit("essai.krea2", {"k": "LQ"}, title="LQ", owner="lea")
        s_, d, _ = essai_http("GET", "/api/queue", cookie=tl)
        mine = next((j for j in d.get("queued", []) if j["id"] == la2["id"]), {})
        ok(s_ == 200 and mine.get("mine") and mine.get("ahead") == 2, f"la file de Léa : sa place, « 2 devant » ({s_} {mine.get('ahead')})")
    finally:
        for k in list(ev) + ["A1", "A2", "LQ"]:
            release(k)
        for j in jobs.ordered("essai"):
            jobs.cancel(j["id"])
        for w in workers:
            jobs.stop_worker(w)
        for m in ("ESSAI-A", "ESSAI-B"):
            jobs.set_mode(m, "active")
        jobs.set_mode(None, "active")
        for k, v in saved.items():
            if v is None:
                config.CFG.pop(k, None)
            else:
                config.CFG[k] = v
        config.LOCAL = local_saved
        machines._fam.clear()
        machines._fam.update(fam_saved)
        auth.set_settings({"total_queued": 50, "visibility": "all"}, by="cal")
        sa.shutdown()
        sb.shutdown()
