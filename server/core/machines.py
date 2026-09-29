"""Les instances de calcul vues par la file : qui répond, qui calcule pour
quelqu'un d'autre, la mémoire de chaque machine, la famille de modèles
que chaque ComfyUI garde chargée.

Les règles de mémoire sont celles du studio Character Factory
(`factory/memory.py`, après l'incident du 24/09 : un DGX Spark saturé ne
rend pas une erreur, il gèle) : on vide une instance (`/free`) quand on
passe d'une famille de modèles à une autre ; une instance jamais vue est
supposée pleine ; on ne décharge jamais sous le travail d'un autre (file
vide seulement) ; on ne lance rien si la mémoire manque — ici on attend
en le disant, la file est partagée. Ce que prend chaque famille
(`FAMILY_GB`) est lu dans ce même fichier de Character Factory (réglage
`cf_repo`), pas recopié.

Un rendu qui n'est pas du portail se reconnaît à son client : chaque envoi
à ComfyUI porte un `client_id`, que ComfyUI range dans `extra_data` et que
`/queue` rend (server.py de ComfyUI : `extra_data["client_id"]`, élément
3 de chaque entrée de la file). Le portail écrit « showrunner-… »
(core/comfy.py), le studio « usine-… » (factory/comfy.py).
"""

from __future__ import annotations

import importlib
import json
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from . import config

PROBE_S = 4.0
_probe: dict[str, dict] = {}
_loaded: dict[str, str] = {}      # url → famille chargée par nos soins ; "" : vidée ; absente : inconnue
_lock = threading.Lock()
_started = False
_fam: dict = {"t": 0.0, "gb": None, "src": ""}
_cf_jobs: dict = {"t": 0.0, "v": None}
OURS = "showrunner-"


# ── les noms ────────────────────────────────────────────────
def machine_of(url: str) -> str:
    for prefix, name in (config.get("machine_names") or {}).items():
        if url.startswith(prefix):
            return name
    if url == "local" or "127.0.0.1" in url or "localhost" in url:
        return socket.gethostname()
    if "169.254.110.6" in url or "192.168.10.205" in url:
        return "DGX1"
    if "169.254.42.193" in url or "192.168.10.247" in url:
        return "DGX2"
    return url


def port_of(url: str) -> str:
    try:
        return str(urlsplit(url).port or "")
    except ValueError:
        return ""


def who(client: str) -> str:
    if client.startswith("usine-"):
        return "le studio Character Factory"
    if client.startswith(OURS):
        return "un autre portail (une copie d'essai)"
    return "une autre session"


def instances() -> list[str]:
    """Les instances ComfyUI connues : celles des voies, plus `extra_instances`."""
    out = []
    for eps in (config.get("lanes") or {}).values():
        for ep in eps:
            if ep.startswith("http") and ep not in out:
                out.append(ep)
    for ep in config.get("extra_instances") or []:
        if ep.startswith("http") and ep not in out:
            out.append(ep)
    return out


def instances_of(machine: str) -> list[str]:
    return [u for u in instances() if machine_of(u) == machine]


def machines() -> list[str]:
    out = []
    for u in instances():
        m = machine_of(u)
        if m not in out:
            out.append(m)
    return out


# ── les relevés ─────────────────────────────────────────────
def _get(url: str, timeout: float):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def _items(q: dict, key: str) -> list[dict]:
    out = []
    for e in q.get(key) or []:
        try:
            extra = e[3] if isinstance(e[3], dict) else {}
            out.append({"prompt_id": str(e[1]), "client": str(extra.get("client_id") or ""), "state": key[6:]})
        except (IndexError, TypeError, KeyError):
            continue
    return out


def refresh(url: str, timeout: float = 2.5) -> dict:
    """Lit /system_stats et /queue d'une instance, maintenant."""
    st = {"t": time.time(), "url": url, "machine": machine_of(url), "up": False, "why": "", "items": [],
          "free_gb": None, "total_gb": None}
    try:
        s = _get(url.rstrip("/") + "/system_stats", timeout)
        sysd = s.get("system") or {}
        st["free_gb"] = round(sysd.get("ram_free", 0) / 1e9, 1) if sysd.get("ram_free") is not None else None
        st["total_gb"] = round(sysd.get("ram_total", 0) / 1e9, 1) if sysd.get("ram_total") else None
        st["comfyui"] = sysd.get("comfyui_version")
        q = _get(url.rstrip("/") + "/queue", timeout)
        st["items"] = _items(q, "queue_running") + _items(q, "queue_pending")
        st["up"] = True
    except (OSError, ValueError, urllib.error.URLError) as e:
        st["why"] = f"{url} ne répond pas ({e})"[:240]
    with _lock:
        prev = _probe.get(url)
        _probe[url] = st
        # un rendu d'un autre sur cette instance : on ne sait plus ce qu'elle garde
        if st["up"] and any(not it["client"].startswith(OURS) for it in st["items"]):
            _loaded.pop(url, None)
        if prev and prev.get("up") and not st["up"]:
            _loaded.pop(url, None)   # redémarrée ou arrêtée : ce qu'elle gardait est perdu
    return st


def state(url: str, max_age: float = PROBE_S * 2.5) -> dict:
    with _lock:
        st = _probe.get(url)
    if st and time.time() - st["t"] < max_age:
        return st
    return refresh(url)


def cached(url: str) -> dict:
    """Le dernier relevé, sans aller le chercher (sous le verrou de la file)."""
    with _lock:
        return dict(_probe.get(url) or {"t": 0.0, "url": url, "machine": machine_of(url), "up": False,
                                         "why": "pas encore relevée", "items": [], "free_gb": None, "total_gb": None})


def machine_memory(machine: str, fresh: bool = False) -> tuple[float | None, float | None]:
    """(libre, total) en Go : la mémoire unifiée de la machine, lue sur une
    de ses instances (`ram_free` de /system_stats vaut pour toute la machine)."""
    for u in instances_of(machine):
        st = refresh(u) if fresh else state(u)
        if st.get("up") and st.get("free_gb") is not None:
            return st["free_gb"], st.get("total_gb")
    return None, None


def settle(machine: str, need: float, timeout: float | None = None) -> float | None:
    """ComfyUI rend sa mémoire en quelques secondes après /free (factory/memory.py, settle : 15 s)."""
    deadline = time.monotonic() + (timeout if timeout is not None else float(config.get("settle_s", 15)))
    free = None
    while time.monotonic() < deadline:
        free, _ = machine_memory(machine, fresh=True)
        if free is None or free >= need:
            return free
        time.sleep(1.0)
    return free


# ── ce que chaque instance garde ────────────────────────────
def loaded(url: str) -> str | None:
    """La famille chargée par nos soins, "" si vidée, None si inconnue."""
    with _lock:
        return _loaded.get(url)


def set_loaded(url: str, family: str | None) -> None:
    with _lock:
        if family is None:
            _loaded.pop(url, None)
        else:
            _loaded[url] = family


def free_instance(url: str) -> tuple[bool, str]:
    """`/free` sur une instance, seulement si sa file est vide : on ne
    décharge jamais sous le travail d'un autre."""
    st = refresh(url)
    if not st["up"]:
        return False, "elle ne répond pas"
    if st["items"]:
        return False, f"elle calcule ({len(st['items'])} en file) : on ne décharge pas sous un travail"
    req = urllib.request.Request(url.rstrip("/") + "/free", data=json.dumps({"unload_models": True, "free_memory": True}).encode(),
                                 method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            r.read()
    except (OSError, urllib.error.URLError) as e:
        return False, str(e)[:200]
    set_loaded(url, "")
    return True, "vidée"


# ── ce que prend chaque famille ─────────────────────────────
def family_gb() -> tuple[dict, str]:
    """FAMILY_GB de Character_Factory/factory/memory.py (relevé sur DGX2
    pour H3, estimé d'après les poids pour les autres), et d'où il vient."""
    if _fam["gb"] is not None and time.time() - _fam["t"] < 600:
        return _fam["gb"], _fam["src"]
    repo = Path(str(config.get("cf_repo") or "")).expanduser()
    gb, src = {}, f"introuvable ({repo}/factory/memory.py) : mémoire des familles inconnue"
    if (repo / "factory" / "memory.py").is_file():
        try:
            if str(repo) not in sys.path:
                sys.path.append(str(repo))
            mod = importlib.import_module("factory.memory")
            gb = {str(k): float(v) for k, v in getattr(mod, "FAMILY_GB", {}).items()}
            src = f"{repo}/factory/memory.py (FAMILY_GB)"
        except Exception as e:  # un Character Factory cassé ne casse pas la file
            src = f"{repo}/factory/memory.py illisible : {type(e).__name__}: {e}"
    _fam.update(t=time.time(), gb=gb, src=src)
    return gb, src


def need_gb(family: str | None, declared: float | None = None) -> float:
    if declared:
        return float(declared)
    if not family:
        return 0.0
    gb, _ = family_gb()
    if family in gb:
        return gb[family]
    # famille inconnue : le seuil par défaut du studio (factory/memory.py, Manager(min_free_gb=30))
    return float(config.get("min_free_gb", 30))


# ── le studio Character Factory (lecture seule) ─────────────
def cf_jobs(max_age: float = 5.0) -> dict:
    if _cf_jobs["v"] is not None and time.time() - _cf_jobs["t"] < max_age:
        return _cf_jobs["v"]
    url = str(config.get("cf_api") or "").rstrip("/") + "/api/jobs?limit=30"
    try:
        d = _get(url, 3.0)
        jobs = d.get("jobs") or []
        running = next((j for j in jobs if j.get("status") == "running"), None)
        v = {"up": True, "url": config.get("cf_api"), "running": running,
             "queued": sum(1 for j in jobs if j.get("status") == "queued"),
             "jobs": [{k: j.get(k) for k in ("id", "slug", "action", "label", "status", "auto", "progress", "message",
                                              "created", "started", "ended")} for j in jobs[:12]]}
    except (OSError, ValueError, urllib.error.URLError) as e:
        v = {"up": False, "url": config.get("cf_api"), "why": str(e)[:200], "running": None, "queued": 0, "jobs": []}
    _cf_jobs.update(t=time.time(), v=v)
    return v


# ── le relevé en continu ────────────────────────────────────
def _loop() -> None:
    while True:
        for u in instances():
            try:
                refresh(u)
            except Exception:  # un relevé qui plante ne tue pas le relevé
                pass
        time.sleep(PROBE_S)


def start() -> None:
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, name="releve", daemon=True).start()
