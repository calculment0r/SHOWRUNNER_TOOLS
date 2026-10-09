"""L'aperçu des machines, au survol du nom en haut à droite (commun/apercu.js). Cal, 09/10/2026 : « je veux,
au survol de mon nom en haut à droite, un aperçu rapide de l'état des DGX en termes de mémoire et GPU, et aussi
un aperçu des travaux en cours de calcul avec leur avancement. Un truc super minimal. »

    GET /api/machines/apercu   → {machines: [{name, up, used_gb, total_gb, mem_src, gpu, gpu_why}], age_s}

Les travaux n'y sont pas : la page les a déjà (le relevé de la file, GET /api/jobs, commun/shell.js). Cette route
n'est lue qu'à l'ouverture de la bulle, jamais en boucle (docs/etudes/cloudflare.md : sur l'adresse publique,
chaque requête compte). Ce qu'elle dit, un membre le voit déjà (GET /api/system : la mémoire de chaque machine,
dans le menu du nom) ; l'invité n'y entre pas (core/auth.py, _guest_gate : aucun outil ne lui ouvre cette route).
La raison d'une mesure qui manque (`gpu_why` : une erreur de ssh, une adresse) n'est rendue qu'à un admin
(l'audit du 28/09, B2 : les erreurs internes cachées aux amis).

Ce qui est mesuré, par machine — UNE commande, sur la machine même : `sh` pour celle du portail, `ssh -o
BatchMode=yes` par le câble pour l'autre, comme movie._on_host (docs/INSTALL_LORA.md : « ssh -o BatchMode=yes
169.254.110.6 true marche depuis DGX2 ») ; l'hôte est celui d'une instance ComfyUI de la machine (les voies) :
- la mémoire : MemTotal et MemAvailable de /proc/meminfo ; utilisée = MemTotal − MemAvailable. Sur un GB10 la
  mémoire est unifiée : la mémoire du GPU EST la mémoire de la machine — nvidia-smi y écrit « Not Supported »
  pour la mémoire (relevé du 29/09, docs/etudes/orchestration.md § 3.2 ; NVIDIA, DGX Spark Known Issues : pas
  de mémoire dédiée sur un iGPU), et MemAvailable voit ce que CUDA alloue (§ 3.3). La commande ne répond pas :
  le relevé de la file (core/machines.py : /system_stats de ComfyUI toutes les 4 s, ce que lit Admin →
  Machines), borné par la cgroup du service quand il y en a une (DGX1 : 100 Gio) ; `mem_src` dit lequel.
- le GPU : `nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits`, la lecture de
  analyse/chaine/gpu-libre.sh — d'après `nvidia-smi --help-query-gpu`, la part du temps de la dernière période
  d'échantillonnage (1 s à 1/6 s selon la carte) pendant laquelle un noyau tournait. Sur un GB10 : un nombre,
  d'après des relevés publiés sur le forum de NVIDIA (0 % au repos, 96 % en charge), pas d'après sa
  documentation ; non relevé ici. Tout ce qui n'est pas un nombre de 0 à 100 (« [N/A] », « [Not Supported] »,
  pas de nvidia-smi, ssh refusé, 3 s dépassées) : `gpu: null` — la page écrit « non mesuré ».

Gardé APERCU_S secondes : deux survols proches, ou deux personnes, ne relancent rien ; une seule lecture à la
fois (le verrou), les machines en parallèle, ATTENTE_S au plus chacune.
"""

from __future__ import annotations

import os
import re
import signal
import subprocess
import threading
import time
from urllib.parse import urlsplit

from core import auth, machines

APERCU_S = 5.0        # une lecture sert tous les survols de ces secondes-là
ATTENTE_S = 4.0       # une machine qui ne répond pas en 4 s : on rend ce qu'on a
LOCAUX = ("127.0.0.1", "localhost", "::1")
# `timeout 3` : un nvidia-smi qui pend s'arrête sur la machine même (ssh coupé, la commande distante continuerait)
COMMANDE = ("printf 'gpu '; timeout 3 nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>&1 "
            "| head -n 1; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo")
_KB = re.compile(r"^(MemTotal|MemAvailable):\s+(\d+)\s*kB\s*$")

_garde: dict = {"t": 0.0, "v": None}
_lock = threading.Lock()


def _argv(url: str) -> list[str]:
    host = urlsplit(url).hostname or ""
    if host in LOCAUX:
        return ["sh", "-c", COMMANDE]
    return ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=3", host, COMMANDE]


def _lancer(machine: str, url: str) -> str:
    """La sortie de COMMANDE sur la machine de `url` (OSError, TimeoutExpired si elle ne répond pas). Un
    groupe de processus à lui : passé le délai, tout part (le ssh, le sh et ce qu'ils ont lancé)."""
    p = subprocess.Popen(_argv(url), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        out, err = p.communicate(timeout=ATTENTE_S)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        p.communicate()
        raise
    if p.returncode != 0 and not out.strip():
        raise OSError((err or f"code {p.returncode}").strip()[:200])
    return out


# l'essai remplace la lecture (selftest, tools/portail_essai.py SR_FAUX_MACHINES) : lire(machine, url) → sortie
LIRE = _lancer


def lire_sortie(out: str) -> dict:
    """La sortie de COMMANDE : {gpu, gpu_why, used_gb, total_gb} (None : pas lu)."""
    v: dict = {"gpu": None, "gpu_why": "", "used_gb": None, "total_gb": None}
    kb: dict[str, int] = {}
    for line in (out or "").splitlines():
        if line.startswith("gpu "):
            s = line[4:].strip()
            if s.isdigit() and 0 <= int(s) <= 100:
                v["gpu"] = int(s)
            else:
                v["gpu_why"] = f"nvidia-smi : {s[:120]}" if s else "nvidia-smi : rien en 3 s"
        else:
            m = _KB.match(line.strip())
            if m:
                kb[m.group(1)] = int(m.group(2))
    if "gpu " not in (out or "") and not v["gpu_why"]:
        v["gpu_why"] = "nvidia-smi : rien lu"
    tot, dispo = kb.get("MemTotal"), kb.get("MemAvailable")
    if tot and dispo is not None and dispo <= tot:   # /proc/meminfo compte en Kio
        v["total_gb"] = round(tot * 1024 / 1e9, 1)
        v["used_gb"] = round((tot - dispo) * 1024 / 1e9, 1)
    return v


def _machine(m: str) -> dict:
    urls = machines.instances_of(m)
    out = {"name": m, "up": False, "used_gb": None, "total_gb": None, "mem_src": None, "gpu": None, "gpu_why": ""}
    # le relevé de la file (sans requête : la boucle de core/machines.py le tient à 4 s ; relu s'il a vieilli)
    st = next((s for s in (machines.state(u, max_age=15) for u in urls) if s.get("up")), None)
    try:
        lu = lire_sortie(LIRE(m, urls[0]))
    except (OSError, subprocess.SubprocessError, ValueError) as e:
        lu = {"gpu": None, "gpu_why": f"{type(e).__name__} : {str(e)[:160]}" if str(e) else type(e).__name__,
              "used_gb": None, "total_gb": None}
    out.update(gpu=lu["gpu"], gpu_why=lu["gpu_why"])
    if lu["total_gb"]:
        out.update(used_gb=lu["used_gb"], total_gb=lu["total_gb"], mem_src="meminfo", up=True)
    elif st and st.get("total_gb") and st.get("free_gb") is not None:
        out.update(used_gb=round(max(0.0, st["total_gb"] - st["free_gb"]), 1), total_gb=st["total_gb"], mem_src="comfyui")
    out["up"] = out["up"] or bool(st) or lu["gpu"] is not None
    return out


def lire() -> dict:
    """L'état des machines, lu au plus une fois par APERCU_S (une lecture à la fois : la suivante attend la
    première et la reprend)."""
    with _lock:
        if _garde["v"] is not None and time.time() - _garde["t"] < APERCU_S:
            return _garde["v"]
        noms = machines.machines()
        res: dict[str, dict] = {}

        def une(m: str) -> None:
            res[m] = _machine(m)

        fils = [threading.Thread(target=une, args=(m,), daemon=True, name=f"apercu-{m}") for m in noms]
        for f in fils:
            f.start()
        fin = time.monotonic() + ATTENTE_S + 1.0
        for f in fils:
            f.join(max(0.0, fin - time.monotonic()))
        v = {"machines": [res.get(m) or {"name": m, "up": False, "used_gb": None, "total_gb": None, "mem_src": None,
                                         "gpu": None, "gpu_why": "pas de réponse à temps"} for m in noms]}
        _garde.update(t=time.time(), v=v)
        return v


def apercu(req):
    v = lire()
    admin = auth.is_admin(getattr(req, "user", None))
    ms = [m if admin else {**m, "gpu_why": ""} for m in v["machines"]]
    return {"machines": ms, "age_s": round(max(0.0, time.time() - _garde["t"]), 1)}


def register(app) -> None:
    app.route("GET", "/api/machines/apercu", apercu)


# ── contrôle (tools/check.py) ───────────────────────────────
def selftest(call, ok) -> None:
    import types

    from core import config
    from tools.admin import _faux, essai_http

    faux = _faux()
    sa, A, ua = faux.start(total_gb=120.0, free_gb=100.0)
    sb, B, ub = faux.start(total_gb=120.0, free_gb=30.0)
    uc = "http://127.0.0.1:9"   # rien n'écoute : une machine éteinte
    keys = ("extra_instances", "machine_names", "auth")
    saved = {k: config.CFG.get(k) for k in keys}
    lire0 = globals()["LIRE"]
    appels: list[str] = []
    sorties = {
        "ESSAI-A": "gpu 37\nMemTotal:       127000000 kB\nMemAvailable:    87000000 kB\n",
        "ESSAI-B": "gpu [N/A]\n",   # ssh passe, nvidia-smi ne mesure pas, pas de /proc/meminfo : le relevé de la file
    }

    def faux_lire(m, url):
        appels.append(m)
        if m == "ESSAI-C":
            raise OSError("ssh: connect to host 10.0.0.9 port 22: Connection refused")
        return sorties[m]

    made = []
    try:
        config.CFG["extra_instances"] = [ua, ub, uc]
        config.CFG["machine_names"] = {ua: "ESSAI-A", ub: "ESSAI-B", uc: "ESSAI-C"}
        globals()["LIRE"] = faux_lire
        for u in (ua, ub, uc):
            machines.refresh(u, timeout=1.0)
        _garde.update(t=0.0, v=None)

        # 1. la lecture de la commande
        v = lire_sortie(sorties["ESSAI-A"])
        ok(v["gpu"] == 37 and v["total_gb"] == 130.0 and v["used_gb"] == 41.0,
           f"aperçu : la sortie se lit (GPU 37 %, 41 Go utilisés sur 130 : MemTotal − MemAvailable, en Kio) ({v})")
        for s in ("gpu [Not Supported]\n", "gpu [N/A]\n", "gpu sh: 1: nvidia-smi: not found\n", "gpu \n", "gpu 140\n", ""):
            w = lire_sortie(s)
            ok(w["gpu"] is None and w["gpu_why"], f"aperçu : « {s.strip() or 'rien'} » n'est pas une mesure (non mesuré : {w['gpu_why']})")
        w = lire_sortie("gpu 0\nMemTotal: 1000 kB\nMemAvailable: 2000 kB\n")
        ok(w["gpu"] == 0 and w["used_gb"] is None, f"aperçu : 0 % est une mesure ; une mémoire incohérente n'en est pas une ({w})")
        ok(_argv("http://127.0.0.1:8188")[:2] == ["sh", "-c"] and _argv("http://169.254.110.6:8188")[:3] == ["ssh", "-o", "BatchMode=yes"]
           and _argv("http://169.254.110.6:8188")[-2] == "169.254.110.6",
           "aperçu : la machine du portail se lit sur place, l'autre par ssh (BatchMode : jamais de question)")

        # 2. la route
        s, d = call("GET", "/api/machines/apercu")
        by = {m["name"]: m for m in (d.get("machines") or [])} if s == 200 else {}
        a, b, c = by.get("ESSAI-A", {}), by.get("ESSAI-B", {}), by.get("ESSAI-C", {})
        ok(s == 200 and {"ESSAI-A", "ESSAI-B", "ESSAI-C"} <= set(by), f"aperçu : une entrée par machine ({s} {list(by)})")
        ok(a.get("up") and a.get("gpu") == 37 and a.get("used_gb") == 41.0 and a.get("total_gb") == 130.0 and a.get("mem_src") == "meminfo",
           f"aperçu : ESSAI-A, la mémoire de /proc/meminfo et le GPU de nvidia-smi ({a})")
        ok(b.get("up") and b.get("gpu") is None and "N/A" in b.get("gpu_why", "") and b.get("mem_src") == "comfyui"
           and b.get("used_gb") == 90.0 and b.get("total_gb") == 120.0,
           f"aperçu : ESSAI-B, GPU non mesuré, la mémoire du relevé de la file (120 − 30) ({b})")
        ok(c.get("up") is False and c.get("used_gb") is None and c.get("gpu") is None and "refused" in c.get("gpu_why", ""),
           f"aperçu : ESSAI-C éteinte, rien d'inventé ({c})")
        n = len(appels)
        s, d2 = call("GET", "/api/machines/apercu")
        ok(s == 200 and len(appels) == n and d2.get("age_s", 99) < APERCU_S,
           f"aperçu : un second survol dans les {APERCU_S:g} s ne relance rien ({len(appels) - n} lecture(s) de plus)")
        _garde.update(t=0.0)
        call("GET", "/api/machines/apercu")
        ok(len(appels) == n + 3, f"aperçu : passé le délai, une lecture par machine ({len(appels) - n})")

        # 3. une machine qui pend : rendu à temps, les autres mesurées quand même
        def lent(m, url):
            if m == "ESSAI-B":
                raise subprocess.TimeoutExpired("ssh", ATTENTE_S)
            return faux_lire(m, url)
        globals()["LIRE"] = lent
        _garde.update(t=0.0, v=None)
        s, d = call("GET", "/api/machines/apercu")
        by = {m["name"]: m for m in d.get("machines") or []}
        ok(s == 200 and by.get("ESSAI-A", {}).get("gpu") == 37 and by.get("ESSAI-B", {}).get("gpu") is None
           and "TimeoutExpired" in by.get("ESSAI-B", {}).get("gpu_why", "") and by["ESSAI-B"].get("mem_src") == "comfyui",
           f"aperçu : une machine qui ne répond pas à temps n'arrête pas les autres ({by.get('ESSAI-B')})")
        # la vraie lecture, sur place (sans DGX : sans nvidia-smi, « non mesuré », la mémoire de cette machine)
        r = lire_sortie(_lancer("ESSAI-A", "http://127.0.0.1:8188"))
        ok(r["total_gb"] and r["used_gb"] is not None and (r["gpu"] is not None or r["gpu_why"]),
           f"aperçu : la commande tourne pour de vrai sur la machine du contrôle ({r})")
        globals()["LIRE"] = faux_lire

        # 4. qui la lit : un ami oui (sans les raisons), un invité non (la porte du socle)
        config.CFG["auth"] = True
        auth.startup()
        fake = types.SimpleNamespace(headers={}, door=None)
        u = auth.create_friend("Ami Apercu", by="aperçu (contrôle)")
        made.append(u["id"])
        with auth._lock:
            db = auth._data()
            db["users"]["invapercu"] = {"id": "invapercu", "name": "Invité", "pseudo": "Invité", "role": auth.GUEST,
                                        "state": "active", "created": auth.now_iso(), "quotas": {}}
            auth._save()
        made.append("invapercu")
        tok = {uid: auth._new_session(uid, fake) for uid in (auth.admin_id(), *made)}
        s, d, _ = essai_http("GET", "/api/machines/apercu", cookie=tok[u["id"]])
        by = {m["name"]: m for m in (d.get("machines") or [])} if s == 200 else {}
        ok(s == 200 and by.get("ESSAI-A", {}).get("gpu") == 37 and all(not m["gpu_why"] for m in by.values()),
           f"aperçu : un ami lit les machines, sans les raisons internes ({s} {by.get('ESSAI-C')})")
        s, d, _ = essai_http("GET", "/api/machines/apercu", cookie=tok[auth.admin_id()])
        ok(s == 200 and any(m["gpu_why"] for m in d.get("machines") or []), f"aperçu : Cal lit aussi les raisons ({s})")
        s, d, _ = essai_http("GET", "/api/machines/apercu", cookie=tok["invapercu"])
        ok(s == 403, f"aperçu : l'invité d'une planche n'y entre pas ({s})")
        s, d, _ = essai_http("GET", "/api/machines/apercu")
        ok(s == 401, f"aperçu : sans session, la porte ({s})")
    finally:
        globals()["LIRE"] = lire0
        with auth._lock:
            db = auth._data()
            for uid in made:
                db["users"].pop(uid, None)
            for k in [k for k, x in db["sessions"].items() if x.get("user") in (*made, auth.admin_id())]:
                db["sessions"].pop(k, None)
            auth._save()
        for k, v in saved.items():
            if v is None:
                config.CFG.pop(k, None)
            else:
                config.CFG[k] = v
        _garde.update(t=0.0, v=None)
        for srv in (sa, sb):
            srv.shutdown()
