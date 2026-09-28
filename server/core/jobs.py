"""La file des rendus, commune à tous les outils.

Un outil déclare ses travaux : `register("image.generate", run, lane="image")`.
Chaque voie (`image`, `h3`, `audio`, `cpu`) a un ouvrier par instance de
calcul déclarée dans la configuration (`lanes`) : deux rendus d'image
tournent donc en même temps, un par DGX. Un ouvrier dont l'instance ne
répond pas ne prend rien ; le travail attend l'autre, ou le retour de la
sienne, et le dit.

`run(ctx)` reçoit un contexte : les réglages (`ctx.params`), l'instance
(`ctx.endpoint`, `ctx.comfy`), un dossier de travail, `ctx.progress`,
`ctx.check()` qui lève `Cancelled` si Cal a arrêté le travail, et
`ctx.add(chemin, …)` qui range un fichier dans la bibliothèque et
l'ajoute au résultat du travail.
"""

from __future__ import annotations

import json
import secrets
import shutil
import threading
import time
import traceback
from pathlib import Path

from . import config, library
from .comfy import Cancelled, Comfy, ComfyError

HANDLERS: dict[str, tuple] = {}
_jobs: dict[str, dict] = {}
_order: list[str] = []
_cv = threading.Condition()
_cancel: set[str] = set()
_alive: dict[str, tuple[float, bool, str]] = {}
KEEP = 400


def register(kind: str, fn, lane: str = "image", title: str = "") -> None:
    HANDLERS[kind] = (fn, lane, title)


def _file() -> Path:
    return config.data_dir() / "jobs.json"


def _persist() -> None:
    ids = _order[-KEEP:]
    tmp = _file().with_suffix(".tmp")
    tmp.write_text(json.dumps([_jobs[i] for i in ids if i in _jobs], ensure_ascii=False), encoding="utf-8")
    tmp.replace(_file())


def _load() -> None:
    if not _file().exists():
        return
    try:
        for j in json.loads(_file().read_text(encoding="utf-8")):
            if j["state"] in ("running", "queued"):
                # le serveur s'est arrêté pendant le travail : on le dit, on ne le relance pas seul
                j.update(state="interrupted", message="interrompu par un redémarrage du portail")
            _jobs[j["id"]] = j
            _order.append(j["id"])
    except (ValueError, KeyError):
        pass


def public(j: dict) -> dict:
    out = {k: v for k, v in j.items() if not k.startswith("_")}
    return out


def submit(kind: str, params: dict, *, title: str = "", tool: str = "", pin: str | None = None,
           thumb: str | None = None) -> dict:
    if kind not in HANDLERS:
        raise KeyError(f"travail inconnu : {kind}")
    _, lane, default_title = HANDLERS[kind]
    jid = "job-" + time.strftime("%m%d-%H%M%S") + "-" + secrets.token_hex(2)
    j = {"id": jid, "kind": kind, "lane": lane, "tool": tool or kind.split(".")[0], "title": title or default_title or kind,
         "params": params, "state": "queued", "created": library.now(), "progress": None,
         "message": "en file", "result": {"items": []}, "pin": pin, "thumb": thumb}
    with _cv:
        _jobs[jid] = j
        _order.append(jid)
        _persist()
        _cv.notify_all()
    return j


def get(jid: str) -> dict | None:
    return _jobs.get(jid)


def listing(active: bool = False, tool: str = "", limit: int = 80) -> list[dict]:
    ids = list(reversed(_order))
    out = []
    for i in ids:
        j = _jobs.get(i)
        if not j:
            continue
        if active and j["state"] not in ("queued", "running"):
            continue
        if tool and j["tool"] != tool:
            continue
        out.append(public(j))
        if len(out) >= limit:
            break
    return out


def cancel(jid: str) -> dict:
    with _cv:
        j = _jobs.get(jid)
        if not j:
            raise KeyError(jid)
        if j["state"] == "queued":
            j.update(state="cancelled", message="retiré de la file", finished=library.now())
        elif j["state"] == "running":
            _cancel.add(jid)
            j["message"] = "arrêt demandé"
        _persist()
        return j


def retry(jid: str) -> dict:
    j = _jobs.get(jid)
    if not j:
        raise KeyError(jid)
    return submit(j["kind"], j["params"], title=j["title"], tool=j["tool"], pin=j.get("pin"), thumb=j.get("thumb"))


def forget(jid: str) -> None:
    with _cv:
        j = _jobs.get(jid)
        if j and j["state"] not in ("queued", "running"):
            _jobs.pop(jid, None)
            _order.remove(jid)
            _persist()


# ── les instances ───────────────────────────────────────────
def endpoint_alive(url: str, max_age: float = 8.0) -> tuple[bool, str]:
    if url == "local":
        return True, ""
    t, ok, why = _alive.get(url, (0.0, False, ""))
    if time.time() - t < max_age:
        return ok, why
    try:
        Comfy(url).ping(timeout=2.5)
        ok, why = True, ""
    except ComfyError as e:
        ok, why = False, str(e)
    _alive[url] = (time.time(), ok, why)
    return ok, why


def machine_of(url: str) -> str:
    if url == "local" or "127.0.0.1" in url or "localhost" in url:
        import socket
        return socket.gethostname()
    if "169.254.110.6" in url or "192.168.10.205" in url:
        return "DGX1"
    if "169.254.42.193" in url or "192.168.10.247" in url:
        return "DGX2"
    return url


class Ctx:
    def __init__(self, job: dict, endpoint: str) -> None:
        self.job = job
        self.params = job["params"]
        self.endpoint = endpoint
        self.comfy = Comfy(endpoint) if endpoint != "local" else None
        self.workdir = config.data_dir() / "work" / job["id"]
        self.workdir.mkdir(parents=True, exist_ok=True)

    def cancelled(self) -> bool:
        return self.job["id"] in _cancel

    def check(self) -> None:
        if self.cancelled():
            raise Cancelled("arrêté")

    def progress(self, frac: float | None = None, message: str | None = None) -> None:
        if frac is not None:
            self.job["progress"] = max(0.0, min(1.0, float(frac)))
        if message is not None:
            self.job["message"] = message

    def comfy_report(self, label: str = "rendu"):
        def rep(state: str, ahead: int) -> None:
            self.progress(message=f"{label} en cours" if state == "run" else f"attend ComfyUI ({ahead} devant)")
        return rep

    def run_graph(self, graph: dict, prefix: str = "out", label: str = "rendu", timeout: float = 7200) -> list[Path]:
        if not self.comfy:
            raise RuntimeError("ce travail n'a pas d'instance ComfyUI")
        return self.comfy.run(graph, self.workdir, cancelled=self.cancelled, report=self.comfy_report(label),
                              prefix=prefix, timeout=timeout)

    def add(self, path: Path, **meta) -> dict:
        origin = {"tool": self.job["tool"], "job": self.job["id"], "machine": machine_of(self.endpoint),
                  **meta.pop("origin", {})}
        it = library.add_file(path, origin=origin, **meta)
        self.job["result"].setdefault("items", []).append(it["id"])
        if not self.job.get("thumb"):
            self.job["thumb"] = library.public(it).get("thumb_url")
        return it


def _take(lane: str, endpoint: str) -> dict | None:
    for jid in _order:
        j = _jobs.get(jid)
        if not j or j["state"] != "queued" or j["lane"] != lane:
            continue
        if j.get("pin") and j["pin"] != endpoint:
            continue
        return j
    return None


def _worker(lane: str, endpoint: str) -> None:
    while True:
        with _cv:
            j = _take(lane, endpoint)
            if not j:
                _cv.wait(timeout=5)
                continue
        ok, why = endpoint_alive(endpoint)
        if not ok:
            # une autre instance de la voie peut le prendre ; sinon il attend, et le dit
            if j["message"] in ("en file",) or j["message"].startswith("en attente"):
                j["message"] = f"en attente : {machine_of(endpoint)} ne répond pas"
            time.sleep(6)
            continue
        with _cv:
            if j["state"] != "queued":
                continue
            j.update(state="running", started=library.now(), endpoint=endpoint, machine=machine_of(endpoint),
                     message="démarre", progress=None)
            _persist()
        fn = HANDLERS[j["kind"]][0]
        ctx = Ctx(j, endpoint)
        try:
            extra = fn(ctx)
            if isinstance(extra, dict):
                j["result"].update(extra)
            j.update(state="done", message="fini", progress=1.0)
        except Cancelled:
            j.update(state="cancelled", message="arrêté")
        except Exception as e:  # le message remonte tel quel à la page
            traceback.print_exc()
            j.update(state="error", message=str(e)[:1200] or type(e).__name__)
        finally:
            _cancel.discard(j["id"])
            j["finished"] = library.now()
            with _cv:
                _persist()
            if j["state"] == "done":
                shutil.rmtree(ctx.workdir, ignore_errors=True)


def start() -> None:
    _load()
    lanes = config.get("lanes", {})
    for lane, endpoints in lanes.items():
        for k, ep in enumerate(endpoints):
            t = threading.Thread(target=_worker, args=(lane, ep), name=f"{lane}-{k}", daemon=True)
            t.start()
