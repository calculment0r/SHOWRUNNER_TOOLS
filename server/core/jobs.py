"""La file des calculs, commune à tous les outils : un ordonnanceur.

Un outil déclare ses travaux : `register("image.generate", run,
lane="image", family=…)`. Chaque voie (`image`, `h3`, `audio`, `cpu`…) a
un ouvrier par instance de calcul déclarée dans la configuration
(`lanes`). Qui part, et où, ne se décide qu'à un endroit — `_choose`,
sous le verrou de la file — dans cet ordre :

  1. l'ordre de la file : les travaux épinglés en tête par Cal, puis la
     priorité (haute, normale, basse), puis le tourniquet : un nouveau
     travail se range après le dernier travail du même « tour » (le 2ᵉ
     travail de Léa passe après le 1ᵉʳ de chacun). Cal glisse un travail
     où il veut (`move`) ;
  2. qui peut partir : ni la file ni la machine en pause ou en vidange,
     l'instance épinglée s'il y en a une, pas plus de travaux simultanés
     par personne que son quota ;
  3. le modèle (`family`) : une instance qui a déjà la famille chargée
     prend d'abord un travail de cette famille parmi les `group_window`
     premiers ; un travail ne se fait pas doubler plus de `max_overtake`
     fois ; un travail qu'une autre instance libre, qui a son modèle
     chargé, prendrait tout de suite lui est laissé ;
  4. le calcul (GPU) : un seul travail GPU du portail par machine ; rien
     tant qu'un rendu qui n'est pas du portail tourne sur une instance de
     la machine (le studio Character Factory, une autre session de Cal) —
     on attend, en le disant ; la mémoire : core/machines.py, les règles
     du studio (factory/memory.py).

Les quotas par personne (travaux simultanés, en file, par jour) et le
total en file sont réglés par Cal (core/auth.py, page admin/). Les durées
mesurées par sorte de travail, famille et taille sont gardées
(`durations.json`) : elles font les temps estimés et la place de chacun
(« 3 devant toi · ≈ 4 min »).

`run(ctx)` reçoit un contexte : les réglages (`ctx.params`), l'instance
(`ctx.endpoint`, `ctx.comfy`), un dossier de travail, `ctx.progress`,
`ctx.check()` qui lève `Cancelled` si le travail est arrêté, et
`ctx.add(chemin, …)` qui range un fichier dans la bibliothèque (au nom
de la personne qui a lancé le travail) et l'ajoute au résultat.

La garde du calcul (docs/etudes/equipes_espaces.md § 2.5, étape 1) : chaque
sorte déclare son coût (`register(…, cost="gpu" | "api" | "cpu" | "none"`,
ou une fonction(params)) ; une sorte qui l'oublie vaut `gpu` hors de la voie
cpu (l'oubli est refusé, jamais permis). `submit` — par où passent toutes les
routes d'outils, la route commune, `retry` et les travaux lancés par un
travail — juge (`_guard`) la personne de la requête et celle du travail, dans
le Workspace du travail, pour ce coût : `auth.compute_refusal` (un guest,
viewer ou acteur, ne calcule jamais, `cpu` compris), puis le Studio
(`auth.need_studio_kind`). Refus : 403 qui dit pourquoi et qui débloque. Le
travail garde son Workspace (`space`) ; la file le pose (`current_space()`)
le temps du `run`, avec la personne : ce qu'un travail lance reste à eux.
"""

from __future__ import annotations

import json
import secrets
import shutil
import statistics
import threading
import time
import traceback
from datetime import date
from pathlib import Path

from . import auth, config, espaces, library, machines
from .comfy import Cancelled, Comfy, ComfyError
from .http import HttpError

# submit juge le calcul (`_guard`) : la garde de l'étape 1 est en place dès que la file l'est
# (sans elle et celle de la bibliothèque, core/espaces.py refuse de faire un guest)
espaces.garde_prete("calcul")

HANDLERS: dict[str, tuple] = {}
_META: dict[str, dict] = {}
_jobs: dict[str, dict] = {}
_order: list[str] = []
_cv = threading.Condition()
_cancel: set[str] = set()
_workers: dict[tuple, threading.Thread] = {}
_stop: set[tuple] = set()
_state: dict = {"paused": False, "machines": {}, "daily": {}, "seq": 0.0, "last_served": {}}
_dur: dict[str, list[float]] = {}
_ann = {"t": 0.0}
KEEP = 400
UNSET = object()
PRIORITIES = {1: "haute", 0: "normale", -1: "basse"}
MODES = ("active", "paused", "draining")
# la famille des travaux des outils qui ne la déclarent pas eux-mêmes (les
# noms de FAMILY_GB, Character_Factory/factory/memory.py, quand elle y est) ;
# sur une voie sans ComfyUI (un moteur factice), elle ne compte pas
DEFAULT_FAMILY = {"movie.t2v": "h3", "movie.i2v": "h3", "movie.r2v": "h3", "objet.mesh": "trellis",
                  "music.generate": "ace-step", "music.stems": "demucs", "music.yue": "yue",
                  "upscale.image": lambda p: p.get("model") or "?", "upscale.video": lambda p: p.get("model") or "?"}


class QuotaError(HttpError):
    def __init__(self, message: str) -> None:
        super().__init__(429, message)


COSTS = ("none", "cpu", "gpu", "api")   # core/espaces.py, COSTS : ce que la matrice sait juger


def register(kind: str, fn, lane: str = "image", title: str = "", *, family=UNSET, gpu=UNSET,
             mem_gb=None, direct=False, cost=UNSET) -> None:
    """`family` : la famille de modèles du travail (« krea2 », « h3 »…), ou
    une fonction(params) qui la rend ; None : il n'en charge aucun. `gpu` :
    s'il passe par ComfyUI (booléen ou fonction(params)) ; par défaut oui
    dès qu'il a une famille et que sa voie a des instances ComfyUI.
    `mem_gb` : sa mémoire, sinon celle de sa famille (FAMILY_GB).

    `direct` : la page peut le lancer par la route commune `POST /api/jobs`
    (`submit_direct`). Par défaut non : un travail part par la route de son
    outil, qui juge ses réglages et les droits ; la route commune ne lance
    alors que ce qu'un admin demande (les essais). `True` : son `run` revalide
    lui-même tout ce qu'il lit ; une fonction(params) juge de plus à l'entrée,
    au nom de la personne de la requête (ValueError → 400, PermissionError → 403).

    `cost` : ce que le travail consomme — « gpu » (un modèle local), « api » (un
    fournisseur payant), « cpu » (ffmpeg, PIL), « none » (rien) — ou une
    fonction(params) qui le rend. jobs.submit le juge (la garde du calcul) ;
    tools/check.py échoue pour toute sorte qui ne le déclare pas."""
    if not (cost is UNSET or callable(cost) or cost in COSTS):
        raise ValueError(f"{kind} : cost = gpu, api, cpu, none ou une fonction(params), pas {cost!r}")
    HANDLERS[kind] = (fn, lane, title)
    _META[kind] = {"family": family, "gpu": gpu, "mem_gb": mem_gb, "direct": direct, "cost": cost}


def cost_declared(kind: str) -> bool:
    """La sorte a-t-elle déclaré son coût ? (le contrôle, tools/check.py)"""
    return _META.get(kind, {}).get("cost", UNSET) is not UNSET


def cost_of(kind: str, params: dict | None = None) -> str:
    """Le coût d'un travail : celui que sa sorte déclare ; sans déclaration, `gpu`
    hors de la voie cpu (ou si la file le fait passer par ComfyUI), `cpu` sinon ;
    une fonction qui échoue ou rend autre chose : `gpu`. Jamais moins que le vrai."""
    c = _META.get(kind, {}).get("cost", UNSET)
    p = params if isinstance(params, dict) else {}
    if callable(c):
        try:
            c = c(p)
        except Exception:  # noqa: BLE001 — des réglages illisibles ne rendent pas le calcul gratuit
            c = "gpu"
    if c is UNSET:
        lane = HANDLERS[kind][1] if kind in HANDLERS else ""
        try:
            via_comfy = bool(_resolve(kind, lane, p, UNSET, UNSET, None)[1])
        except Exception:  # noqa: BLE001
            via_comfy = True
        c = "cpu" if lane == "cpu" and not via_comfy else "gpu"
    return c if c in COSTS else "gpu"


def _space_for(u, space=UNSET) -> str | None:
    """Le Workspace d'un travail : celui qu'on donne (retry : celui du travail
    d'origine), sinon celui de la requête ou du travail qui le lance
    (`current_space()`), sinon — hors requête — celui de sa personne."""
    if space is not UNSET:
        return space
    sp = auth.current_space()
    if sp is None and u:
        try:
            sp = espaces.default_for(u)
        except HttpError:   # teams.json illisible : pas de Workspace, la garde en juge
            sp = None
    return sp


def _guard(kind: str, params: dict, by, u, space: str | None) -> str:
    """La garde du calcul : la personne de la requête (`by`) et celle du travail
    (`u`), dans le Workspace du travail, pour le coût de la sorte ; puis le
    Studio. HttpError 403 qui dit pourquoi, ou le coût."""
    cost = cost_of(kind, params)
    people = [x for x in (by, u) if x]
    if by and u and by.get("id") == u.get("id"):
        people = [u]
    for p in people:
        why = auth.compute_refusal(p, space, cost)
        if why:
            raise HttpError(403, f"{why} (« {kind} », calcul {cost})")
    for p in people:
        auth.need_studio_kind(kind, p, space)
    return cost


def submit_direct(kind: str, params, title="", tool="") -> dict:
    """`POST /api/jobs` : la route commune, pour les seules sortes déclarées
    `direct` (ou pour un admin). Une sorte inconnue : KeyError (400) ; la garde
    du calcul d'abord (403) ; une sorte qui a sa route : PermissionError (403),
    qui dit où passer."""
    if kind not in HANDLERS:
        raise KeyError(f"travail inconnu : {kind}")
    if not isinstance(params, dict):
        raise ValueError("params : un objet")
    if not isinstance(title, str) or not isinstance(tool, str) or len(title) > 200 or len(tool) > 40:
        raise ValueError("title (200 signes) et tool (40) : des textes")
    me = auth.current()
    _guard(kind, params, me, me, _space_for(me))   # avant tout jugement des réglages : rien n'en fuit
    d = _META.get(kind, {}).get("direct")
    if not d and not auth.is_admin(auth.current()):
        raise PermissionError(f"« {kind} » ne se lance pas par la route commune : passe par la page de son outil")
    if callable(d):
        d(params)
    return submit(kind, params, title=title, tool=tool)


def _file() -> Path:
    return config.data_dir() / "jobs.json"


def _write(path: Path, obj) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _persist() -> None:
    if len(_order) > KEEP * 2:   # la mémoire ne grossit pas sans fin : les vieux travaux finis s'en vont
        old = {i for i in _order[:-KEEP] if _jobs.get(i, {}).get("state") not in ("queued", "running")}
        for i in old:
            _jobs.pop(i, None)
        _order[:] = [i for i in _order if i not in old]
    ids = _order[-KEEP:]
    _write(_file(), [public(_jobs[i]) for i in ids if i in _jobs])
    _write(config.data_dir() / "queue.json", {k: _state[k] for k in ("paused", "machines", "daily", "seq")})
    _ann["t"] = 0.0   # la file a changé : les places se recalculent au prochain relevé


def _load() -> None:
    d = config.data_dir()
    for name, target in (("queue.json", _state), ("durations.json", _dur)):
        try:
            if (d / name).exists():
                target.update(json.loads((d / name).read_text(encoding="utf-8")))
        except ValueError:
            pass
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
    return {k: v for k, v in j.items() if not k.startswith("_")}


def _n(n: int, one: str, many: str) -> str:
    return f"{n} {one if n <= 1 else many}"


# ── la famille, le GPU, la durée ────────────────────────────
def _http_lane(lane: str) -> bool:
    return any(str(ep).startswith("http") for ep in (config.get("lanes") or {}).get(lane, []))


def _resolve(kind: str, lane: str, params: dict, family, gpu, mem_gb) -> tuple:
    """(famille, passe par ComfyUI, mémoire déclarée). « ? » : un travail
    sur ComfyUI qui ne dit pas son modèle ; None : aucun modèle."""
    if not _http_lane(lane):
        return None, False, None
    meta = _META.get(kind, {})
    fam = family if family is not UNSET else meta.get("family", UNSET)
    if fam is UNSET:
        fam = DEFAULT_FAMILY.get(kind, UNSET)
    if callable(fam):
        fam = fam(params)
    if fam is UNSET:
        fam = "?"
    g = gpu if gpu is not UNSET else meta.get("gpu", UNSET)
    if callable(g):
        g = g(params)
    g = bool(fam) if g is UNSET else bool(g)
    if fam and config.get("file_simulation"):
        g = True   # essais : les travaux factices suivent les règles du GPU, contre de faux ComfyUI
    mem = mem_gb or meta.get("mem_gb")
    if callable(mem):
        mem = mem(params)
    return fam, g, (float(mem) if mem else None)


def _size_key(p: dict) -> str:
    parts = []
    w, h = p.get("width"), p.get("height")
    if isinstance(w, (int, float)) and isinstance(h, (int, float)) and w > 0 and h > 0:
        parts.append(f"{round(w * h / 1e6 * 2) / 2:g}mpx")
    for k in ("frames", "steps"):
        if isinstance(p.get(k), int):
            parts.append(f"{p[k]}{k[0]}")
    return ".".join(parts) or "-"


def _dkeys(j: dict) -> list[str]:
    fam = j.get("family") or "-"
    return [f"{j['kind']}|{fam}|{_size_key(j.get('params') or {})}", f"{j['kind']}|{fam}", j["kind"]]


def estimate(j: dict) -> float | None:
    """La durée attendue : la médiane des derniers rendus mesurés de même
    sorte, famille et taille (sinon sorte et famille, sinon sorte), ou
    l'estimation posée par l'outil ; None tant qu'on ne sait pas."""
    for k in _dkeys(j):
        s = _dur.get(k)
        if s:
            return float(statistics.median(s[-12:]))
    e = j.get("estimate")
    if isinstance(e, dict) and e.get("low") and e.get("high"):
        return (float(e["low"]) + float(e["high"])) / 2
    return None


def _record(j: dict) -> None:
    if not j.get("_t0") or j["state"] != "done":
        return
    secs = round(time.time() - j["_t0"], 1)
    for k in _dkeys(j):
        _dur.setdefault(k, []).append(secs)
        del _dur[k][:-30]
    try:
        _write(config.data_dir() / "durations.json", _dur)
    except OSError:
        pass


# ── l'ordre : épinglés, priorité, tourniquet ────────────────
def _bucket(j: dict) -> tuple:
    return (bool(j.get("top")), int(j.get("priority") or 0))


def _key(j: dict) -> tuple:
    return (0 if j.get("top") else 1, -float(j.get("top_t") or 0.0), -int(j.get("priority") or 0), j.get("seq", 0.0))


def _queued(lane: str | None = None) -> list[dict]:
    return sorted((x for x in _jobs.values() if x["state"] == "queued" and (lane is None or x["lane"] == lane)), key=_key)


def ordered(lane: str | None = None) -> list[dict]:
    with _cv:
        return [public(x) for x in _queued(lane)]


def _next_seq() -> float:
    _state["seq"] = float(_state.get("seq") or 0.0) + 1.0
    return _state["seq"]


def _fair_seq(j: dict) -> float:
    """Le tourniquet : le n-ième travail en file d'une personne se range
    après le dernier n-ième travail des autres (dans sa voie, à sa priorité)."""
    q = [x for x in _queued(j["lane"]) if _bucket(x) == _bucket(j) and x is not j]
    if not q:
        return _next_seq()
    mine = sum(1 for x in q if x.get("owner") == j.get("owner"))
    rounds: dict = {}
    last = None
    for x in q:
        r = rounds.get(x.get("owner"), 0)
        rounds[x.get("owner")] = r + 1
        if r <= mine:
            last = x
    if last is None:
        return q[0]["seq"] - 1.0
    k = q.index(last)
    return (last["seq"] + q[k + 1]["seq"]) / 2 if k + 1 < len(q) else max(last["seq"] + 1.0, _next_seq())


def _tidy() -> None:
    """Des rangs à mi-chemin, à la longue, se touchent : on les renumérote."""
    q = _queued()
    if any(abs(b.get("seq", 0) - a.get("seq", 0)) < 1e-6 for a, b in zip(q, q[1:]) if _bucket(a) == _bucket(b)):
        for i, x in enumerate(q):
            x["seq"] = float(i)
        _state["seq"] = max(float(_state.get("seq") or 0.0), float(len(q)))


# ── les quotas ──────────────────────────────────────────────
def _today() -> str:
    return date.today().isoformat()


def day_count(uid: str) -> int:
    d = _state["daily"].get(uid) or {}
    return int(d.get("n", 0)) if d.get("date") == _today() else 0


def _check_quota(u: dict | None) -> None:
    if not u or auth.is_admin(u):
        return
    q = auth.quotas_for(u["id"])
    mine = sum(1 for x in _jobs.values() if x["state"] == "queued" and x.get("owner") == u["id"])
    if q["queued"] is not None and mine >= q["queued"]:
        raise QuotaError(f"tu as déjà {_n(mine, 'travail', 'travaux')} en file, ton quota est de {q['queued']} : "
                         "attends qu'un travail parte")
    n = day_count(u["id"])
    if q["per_day"] is not None and n >= q["per_day"]:
        raise QuotaError(f"tu as lancé {_n(n, 'travail', 'travaux')} aujourd'hui, ton quota est de {q['per_day']} "
                         "par jour : à demain")
    cap = auth.settings().get("total_queued")
    total = sum(1 for x in _jobs.values() if x["state"] == "queued")
    if cap is not None and total >= cap:
        raise QuotaError(f"la file est pleine ({_n(total, 'travail', 'travaux')} en attente) : réessaie quand elle aura avancé")


def submit(kind: str, params: dict, *, title: str = "", tool: str = "", pin: str | None = None,
           thumb: str | None = None, owner=UNSET, family=UNSET, gpu=UNSET, mem_gb=None,
           priority: int | None = None, space=UNSET) -> dict:
    """Met un travail en file, au nom de la personne de la requête (ou du
    travail qui le lance), dans son Workspace. La garde du calcul (`_guard`) :
    403 qui dit pourquoi ; QuotaError (429) au-delà de ses quotas."""
    if kind not in HANDLERS:
        raise KeyError(f"travail inconnu : {kind}")
    _, lane, default_title = HANDLERS[kind]
    by = auth.current()
    u = by if owner is UNSET else (auth.user(owner) if isinstance(owner, str) else owner)
    sp = _space_for(u, space)
    cost = _guard(kind, params, by, u, sp)
    fam, uses_gpu, mem = _resolve(kind, lane, params, family, gpu, mem_gb)
    if priority not in PRIORITIES:
        priority = 1 if (auth.is_admin(u) and auth.settings().get("admin_first")) else 0
    jid = "job-" + time.strftime("%m%d-%H%M%S") + "-" + secrets.token_hex(2)
    j = {"id": jid, "kind": kind, "lane": lane, "tool": tool or kind.split(".")[0], "title": title or default_title or kind,
         "params": params, "state": "queued", "created": library.now(), "progress": None,
         "message": "en file", "result": {"items": []}, "pin": pin, "thumb": thumb,
         "owner": u["id"] if u else None, "owner_name": u["name"] if u else "", "priority": priority, "top": False,
         "family": fam, "gpu": uses_gpu, "mem_gb": mem, "overtaken": 0, "space": sp, "cost": cost}
    with _cv:
        if not auth.is_admin(by):
            _check_quota(u)
        j["seq"] = _fair_seq(j)
        _jobs[jid] = j
        _order.append(jid)
        if u:
            _state["daily"][u["id"]] = {"date": _today(), "n": day_count(u["id"]) + 1}
        j["est_s"] = estimate(j)
        _tidy()
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
    """Relance : au nom de la même personne quand c'est Cal qui relance, dans le
    Workspace du travail d'origine ; la même garde que tout travail (submit)."""
    j = _jobs.get(jid)
    if not j:
        raise KeyError(jid)
    owner = j["owner"] if (auth.is_admin(auth.current()) and j.get("owner")) else UNSET
    return submit(j["kind"], j["params"], title=j["title"], tool=j["tool"], pin=j.get("pin"), thumb=j.get("thumb"),
                  owner=owner, priority=j.get("priority") if owner is not UNSET else None,
                  space=j["space"] if j.get("space") else UNSET)


def forget(jid: str) -> None:
    with _cv:
        j = _jobs.get(jid)
        if j and j["state"] not in ("queued", "running"):
            _jobs.pop(jid, None)
            _order.remove(jid)
            _persist()


# ── ce que Cal fait de la file ──────────────────────────────
def _q(jid: str) -> dict:
    j = _jobs.get(jid)
    if not j:
        raise KeyError(jid)
    if j["state"] != "queued":
        raise HttpError(409, "ce travail n'est plus en file")
    return j


def move(jid: str, before: str | None = None) -> dict:
    """Glisser : le travail passe juste avant `before` (il prend sa priorité
    et son épinglage), ou à la fin de sa voie."""
    with _cv:
        j = _q(jid)
        rest = [x for x in _queued(j["lane"]) if x is not j]
        if before:
            b = _q(before)
            if b["lane"] != j["lane"]:
                raise HttpError(400, "ces deux travaux ne sont pas dans la même voie")
            k = rest.index(b)
            prev = rest[k - 1] if k else None
            j["priority"], j["top"] = int(b.get("priority") or 0), bool(b.get("top"))
            if b.get("top"):
                bt = float(b.get("top_t") or 0.0)
                j["top_t"] = (float(prev["top_t"]) + bt) / 2 if prev and prev.get("top") else bt + 1.0
            else:
                j.pop("top_t", None)
            j["seq"] = (prev["seq"] + b["seq"]) / 2 if prev and _bucket(prev) == _bucket(b) else b["seq"] - 1.0
        elif rest:
            last = rest[-1]
            j["priority"], j["top"] = int(last.get("priority") or 0), bool(last.get("top"))
            if last.get("top"):
                j["top_t"] = float(last.get("top_t") or 0.0) - 1.0
            else:
                j.pop("top_t", None)
            j["seq"] = max(last["seq"] + 1.0, _next_seq())
        j["overtaken"] = 0
        _tidy()
        _persist()
        _cv.notify_all()
        return public(j)


def set_priority(jid: str, priority: int) -> dict:
    if priority not in PRIORITIES:
        raise HttpError(400, "priorité : 1 (haute), 0 (normale) ou -1 (basse)")
    with _cv:
        j = _q(jid)
        j["priority"] = priority
        _persist()
        _cv.notify_all()
        return public(j)


def set_top(jid: str, on: bool) -> dict:
    """Épingler en tête : le dernier épinglé passe devant tous les autres."""
    with _cv:
        j = _q(jid)
        j["top"] = bool(on)
        if on:
            j["top_t"] = time.time()
        else:
            j.pop("top_t", None)
        _persist()
        _cv.notify_all()
        return public(j)


def set_mode(machine: str | None, mode: str) -> dict:
    """Pause, reprise, vidange (finir puis ne plus rien prendre) : d'une
    machine (ses instances ComfyUI), ou pause et reprise de toute la file."""
    if mode not in MODES:
        raise HttpError(400, "mode : active, paused ou draining")
    with _cv:
        if machine in (None, "", "*", "all"):
            if mode == "draining":
                raise HttpError(400, "la vidange se fait machine par machine")
            _state["paused"] = mode == "paused"
        elif mode == "active":
            _state["machines"].pop(machine, None)
        else:
            _state["machines"][machine] = mode
        _persist()
        _cv.notify_all()
    auth.journal("file", by=auth.current_id(), machine=machine or "toute la file", mode=mode)
    return scheduler_state()


def scheduler_state() -> dict:
    with _cv:
        run: dict[str, list] = {}
        for j in _jobs.values():
            if j["state"] == "running" and str(j.get("endpoint") or "").startswith("http"):
                run.setdefault(machines.machine_of(j["endpoint"]), []).append(j["id"])
        ms = {}
        for m in list(dict.fromkeys(machines.machines() + list(_state["machines"]))):
            mode = _state["machines"].get(m, "active")
            ms[m] = {"mode": mode, "running": run.get(m, []), "drained": mode == "draining" and not run.get(m)}
        return {"paused": bool(_state["paused"]), "machines": ms}


# ── les instances ───────────────────────────────────────────
def endpoint_alive(url: str, max_age: float = 8.0) -> tuple[bool, str]:
    if url == "local":
        return True, ""
    st = machines.state(url, max_age=max_age)
    return bool(st["up"]), st.get("why", "")


def machine_of(url: str) -> str:
    return machines.machine_of(url)


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
        if self.job.get("owner"):
            origin.setdefault("user", self.job["owner"])
        it = library.add_file(path, origin=origin, **meta)
        self.job["result"].setdefault("items", []).append(it["id"])
        if not self.job.get("thumb"):
            self.job["thumb"] = library.public(it).get("thumb_url")
        return it


# ── le choix : qui part, et où ──────────────────────────────
def _mode(machine: str) -> str:
    return _state["machines"].get(machine, "active")


def _where(j: dict) -> str | None:
    """L'instance d'un travail qui tourne, ou qu'un ouvrier vient de prendre."""
    return j.get("_claim") or (j.get("endpoint") if j["state"] == "running" else None)


def _is_gpu(j: dict, ep: str) -> bool:
    return bool(j.get("gpu")) and ep.startswith("http")


def _owner_running(owner: str) -> int:
    return sum(1 for x in _jobs.values() if x.get("owner") == owner and (x["state"] == "running" or x.get("_claim")))


def _owner_free(j: dict) -> bool:
    if not j.get("owner"):
        return True
    lim = auth.quotas_for(j["owner"])["running"]
    return lim is None or _owner_running(j["owner"]) < lim


def _ours_on(url: str) -> bool:
    return any(x["state"] == "running" and x.get("endpoint") == url for x in _jobs.values())


def _idle(url: str) -> bool:
    return not any(_where(x) == url for x in _jobs.values() if x["state"] in ("running", "queued"))


def _foreign(url: str, st: dict) -> dict | None:
    """Un rendu qui n'est pas de cette file : si aucun de nos travaux ne
    tourne sur l'instance, tout ce qui y est en file est à quelqu'un d'autre."""
    ours = _ours_on(url)
    for it in st.get("items") or []:
        if not ours or not it["client"].startswith(machines.OURS):
            return it
    return None


def _foreign_block(machine: str, fresh: bool = False, first: dict | None = None) -> str:
    for url in machines.instances_of(machine):
        st = (first if first and first.get("url") == url else None) or \
            (machines.refresh(url) if fresh else machines.cached(url))
        if st.get("up"):
            it = _foreign(url, st)
            if it:
                return f"attend : {machines.who(it['client'])} calcule sur {machine} (ComfyUI :{machines.port_of(url)})"
    return ""


def _gpu_block(ep: str, machine: str, me: dict | None = None) -> str:
    """Un seul travail GPU du portail par machine (factory/memory.py : « un
    seul gros travail GPU à la fois »), et rien sous le rendu d'un autre.
    `me` : le travail dont on parle ne se bloque pas lui-même — pris par un
    ouvrier (`_claim`), il se prépare (mémoire, instance) et `annotate`
    disait « DGX2 calcule déjà pour la file (« lui-même ») » (REPRISE.md)."""
    per = int(config.get("gpu_jobs_per_machine", 1))
    busy = [x for x in _jobs.values() if x is not me and x.get("gpu") and str(_where(x) or "").startswith("http")
            and machines.machine_of(_where(x)) == machine]
    if len(busy) >= per:
        b = busy[0]
        if b["state"] == "running":
            return f"attend : {machine} calcule déjà pour la file (« {b['title']} »)"
        # pris, pas encore parti : il vérifie l'instance et libère la mémoire — départ inconnu
        return f"attend : {machine} prépare « {b['title']} » pour la file"
    return _foreign_block(machine)


def _better_elsewhere(j: dict, ep: str) -> bool:
    """Une autre instance libre de la voie a déjà son modèle chargé : elle le prend."""
    fam = j.get("family")
    if not (_is_gpu(j, ep) and fam and fam != "?") or machines.loaded(ep) == fam:
        return False
    for other in (config.get("lanes") or {}).get(j["lane"], []):
        if other == ep or not other.startswith("http") or machines.loaded(other) != fam:
            continue
        if (j.get("pin") and j["pin"] != other) or not _idle(other):
            continue
        m = machines.machine_of(other)
        if _mode(m) != "active" or not machines.cached(other).get("up") or _gpu_block(other, m, j):
            continue
        return True
    return False


def _group_pick(usable: list[dict], ep: str) -> dict | None:
    """La famille déjà chargée ici d'abord, parmi les premiers travaux de
    même rang ; un travail doublé `max_overtake` fois ne l'est plus."""
    fam = machines.loaded(ep)
    if not fam or fam == "?":
        return None
    head = usable[0]
    window = [x for x in usable if _bucket(x) == _bucket(head)][:max(1, int(config.get("group_window", 4)))]
    limit = int(config.get("max_overtake", 3))
    for i, x in enumerate(window):
        if x.get("family") == fam and _is_gpu(x, ep):
            for y in window[:i]:
                y["overtaken"] = int(y.get("overtaken") or 0) + 1
            return x
        if int(x.get("overtaken") or 0) >= limit:
            return None
    return None


def _choose(lane: str, ep: str) -> tuple[dict | None, str]:
    """Sous le verrou : le travail que cette instance prend maintenant, ou
    pourquoi aucun. Aucune entrée-sortie ici : les relevés sont ceux de
    core/machines.py, gardés à jour en continu."""
    if _state["paused"]:
        return None, "file en pause"
    http = ep.startswith("http")
    m = machines.machine_of(ep)
    if http and _mode(m) != "active":
        return None, f"{m} en {'vidange' if _mode(m) == 'draining' else 'pause'}"
    if http and not machines.cached(ep).get("up"):
        return None, f"en attente : {m} ne répond pas"
    now = time.time()
    cands = [j for j in _queued(lane)
             if not j.get("_claim") and not (j.get("pin") and j["pin"] != ep)
             and (j.get("_wait_until") or {}).get(ep, 0) <= now and _owner_free(j)]
    if not cands:
        return None, ""
    block = _gpu_block(ep, m) if http else ""
    usable = [j for j in cands if not (block and _is_gpu(j, ep))]
    if not usable:
        return None, block
    pick = _group_pick(usable, ep) if http else None
    if not pick:
        pick = next((j for j in usable if not _better_elsewhere(j, ep)), None)
    if not pick:
        return None, "laissé à une instance qui a déjà son modèle chargé"
    return pick, ""


def dry_choose(lane: str, ep: str) -> tuple[dict | None, str]:
    """Ce que l'instance prendrait, sans le prendre (contrôle, page admin)."""
    with _cv:
        saved = {j["id"]: j.get("overtaken", 0) for j in _jobs.values()}
        j, why = _choose(lane, ep)
        for x in _jobs.values():
            x["overtaken"] = saved.get(x["id"], x.get("overtaken", 0))
        return (public(j) if j else None), why


class _Refuse(Exception):
    """Le travail ne pourra jamais partir tel quel : il échoue, en le disant."""


def _preflight(j: dict, ep: str) -> str:
    """Hors du verrou, juste avant de partir : l'instance répond-elle, un
    autre y calcule-t-il, la mémoire suffit-elle ? Rend ce qu'on attend, ou ""."""
    if not ep.startswith("http"):
        return ""
    m = machines.machine_of(ep)
    st = machines.refresh(ep)
    if not st["up"]:
        return f"en attente : {m} ne répond pas"
    if not _is_gpu(j, ep):
        return ""
    why = _foreign_block(m, fresh=True, first=st)
    if why:
        return why
    fam = j.get("family") or "?"
    need = machines.need_gb(fam, j.get("mem_gb"))
    _, total = machines.machine_memory(m)
    if total and need > total:
        raise _Refuse(f"ce travail demande {need:.0f} Go de mémoire, {m} n'en a que {total:.0f}")
    if fam != "?" and machines.loaded(ep) == fam:
        return ""   # la famille est déjà chargée ici
    # on change de famille, ou on ne sait pas ce que l'instance garde : on la vide (factory/memory.py)
    if machines.loaded(ep) != "":
        machines.free_instance(ep)
    free, total = machines.machine_memory(m, fresh=True)
    if free is None or free >= need:
        return ""
    for url in machines.instances_of(m):   # les autres instances de la machine, si leur file est vide
        if url != ep and machines.loaded(url) != "" and not _ours_on(url):
            machines.free_instance(url)
    free = machines.settle(m, need)
    if free is None or free >= need:
        return ""
    return f"mémoire : {free:.0f} Go libres sur {m}, il en faut {need:.0f} pour {fam} — attend qu'elle se libère"


def _auto_message(j: dict, msg: str) -> None:
    """Le message d'un travail en file, sans écraser celui qu'un outil a posé."""
    if j["state"] == "queued" and (not j.get("message") or j["message"] in ("en file", j.get("_amsg"))):
        j["message"] = msg
        j["_amsg"] = msg


def _worker(lane: str, ep: str, key: tuple) -> None:
    while key not in _stop:
        with _cv:
            j, _why = _choose(lane, ep)
            if not j:
                _cv.wait(timeout=2.0)
                continue
            j["_claim"] = ep
        fail = ""
        try:
            wait = _preflight(j, ep)
        except _Refuse as e:
            wait, fail = "", str(e)
        except Exception as e:  # une instance qui répond mal ne tombe pas l'ouvrier
            wait = f"en attente : {machines.machine_of(ep)} répond mal ({type(e).__name__}: {e})"[:300]
        with _cv:
            j.pop("_claim", None)
            if j["state"] != "queued":
                _cv.notify_all()
                continue
            if fail:
                j.update(state="error", message=fail, finished=library.now())
                _persist()
                _cv.notify_all()
                continue
            if wait:   # une autre instance peut le prendre ; celle-ci réessaie un peu plus tard
                j.setdefault("_wait_until", {})[ep] = time.time() + float(config.get("wait_retry_s", 8))
                j["waiting"] = wait
                _auto_message(j, wait)
                _cv.notify_all()
                continue
            j.update(state="running", started=library.now(), endpoint=ep, machine=machines.machine_of(ep),
                     message="démarre", progress=None, waiting="")
            j["_t0"] = time.time()
            j.pop("_wait_until", None)
            if _is_gpu(j, ep):   # un modèle inconnu (« ? ») laisse l'instance « inconnue » : vidée au prochain
                machines.set_loaded(ep, None if (j.get("family") or "?") == "?" else j["family"])
            if j.get("owner"):
                _state["last_served"][j["owner"]] = time.time()
            _persist()
        _run(j, ep)


def _run(j: dict, ep: str) -> None:
    fn = HANDLERS[j["kind"]][0]
    # ce que le travail range, et ce qu'il lance, est à la personne et au Workspace qui l'ont lancé
    auth.set_current(auth.user(j.get("owner")))
    auth.set_current_space(j.get("space"))
    ctx = None
    try:
        ctx = Ctx(j, ep)
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
        auth.set_current(None)
        auth.set_current_space(None)
        _cancel.discard(j["id"])
        j["finished"] = library.now()
        with _cv:
            _record(j)
            _persist()
            _cv.notify_all()
        if j["state"] == "done" and ctx:
            shutil.rmtree(ctx.workdir, ignore_errors=True)


# ── la place de chacun ──────────────────────────────────────
def _available(ep: str) -> bool:
    if not ep.startswith("http"):
        return True
    return _mode(machines.machine_of(ep)) == "active" and bool(machines.cached(ep).get("up"))


def _remaining(j: dict, now: float) -> float | None:
    if not j.get("_t0"):
        return None
    el = now - j["_t0"]
    est = j.get("est_s") or estimate(j)
    if est:
        return max(3.0, est - el)
    p = j.get("progress")
    if isinstance(p, (int, float)) and 0.05 < p < 1:
        return el * (1 - p) / p
    return None


def annotate(force: bool = False) -> None:
    """La place de chaque travail en file, son départ estimé, ce qu'il
    attend. Au plus une fois par seconde : les pages relisent souvent."""
    now = time.time()
    if not force and now - _ann["t"] < 1.0:
        return
    _ann["t"] = now
    with _cv:
        lanes = config.get("lanes") or {}
        by_lane: dict[str, list] = {}
        for j in _queued():
            by_lane.setdefault(j["lane"], []).append(j)
        running: dict[str, list] = {}
        for x in _jobs.values():
            if x["state"] == "running":
                running.setdefault(x.get("endpoint"), []).append(x)
        for lane, order in by_lane.items():
            eps = list(lanes.get(lane, []))
            avail = [e for e in eps if _available(e)]
            taken = {e: list(running.get(e, [])) for e in set(avail)}
            slots: list = []
            for e in avail:
                r = taken[e].pop(0) if taken[e] else None
                rem = _remaining(r, now) if r else 0.0
                slots.append(now + rem if rem is not None else None)
            blocked = ""
            if _state["paused"]:
                blocked = "file en pause"
            elif not avail:
                why = [f"{machines.machine_of(e)} en {'vidange' if _mode(machines.machine_of(e)) == 'draining' else 'pause'}"
                       if _mode(machines.machine_of(e)) != "active" else f"{machines.machine_of(e)} ne répond pas" for e in eps]
                blocked = ("en attente : " + ", ".join(dict.fromkeys(why))) if why else "aucune instance pour cette voie"
            stuck = False   # la voie attend quelqu'un d'autre (le studio, la mémoire) : départ inconnu
            for i, j in enumerate(order):
                j["position"], j["ahead"] = i + 1, i
                j["est_s"] = estimate(j)
                msg = blocked
                if not msg and j.get("owner") and not _owner_free(j):
                    lim = auth.quotas_for(j["owner"])["running"]
                    msg = f"attend : {_n(lim, 'travail', 'travaux')} à la fois pour {j.get('owner_name') or j['owner']}"
                if not msg and j.get("waiting") and max((j.get("_wait_until") or {0: 0}).values()) > now - 10:
                    msg = j["waiting"]
                    stuck = True
                if not msg and j.get("gpu"):
                    blocks = [_gpu_block(e, machines.machine_of(e), j) for e in avail if e.startswith("http")]
                    if blocks and all(blocks):
                        msg = blocks[0]
                        stuck = stuck or not any(b.startswith(f"attend : {machines.machine_of(e)} calcule déjà")
                                                 for b, e in zip(blocks, [e for e in avail if e.startswith("http")]))
                if not msg:
                    msg = "part dès qu'une instance se libère" if i == 0 else f"en file · {i} devant"
                _auto_message(j, msg)
                if blocked or not slots or stuck:
                    j["eta_s"] = None
                    continue
                k = min(range(len(slots)), key=lambda s: slots[s] if slots[s] is not None else float("inf"))
                if slots[k] is None:
                    j["eta_s"] = None
                    continue
                j["eta_s"] = round(max(0.0, slots[k] - now))
                slots[k] = slots[k] + j["est_s"] if j["est_s"] else None


def queue_view(recent: int = 30) -> dict:
    """La file telle que la voient les pages : ce qui tourne, ce qui attend
    (dans l'ordre), ce qui vient de finir."""
    annotate()
    with _cv:
        run = [public(x) for x in _jobs.values() if x["state"] == "running"]
        queued = [public(x) for x in _queued()]
        done = [public(_jobs[i]) for i in reversed(_order) if i in _jobs and _jobs[i]["state"] not in ("queued", "running")]
    return {"running": run, "queued": queued, "done": done[:recent], **scheduler_state()}


# ── les ouvriers ────────────────────────────────────────────
def add_worker(lane: str, ep: str, k: int = 0) -> tuple:
    key = (lane, ep, k)
    _stop.discard(key)
    t = _workers.get(key)
    if t and t.is_alive():
        return key
    t = threading.Thread(target=_worker, args=(lane, ep, key), name=f"{lane}-{k}", daemon=True)
    _workers[key] = t
    t.start()
    return key


def stop_worker(key: tuple) -> None:
    _stop.add(key)
    with _cv:
        _cv.notify_all()


def start() -> None:
    _load()
    machines.start()
    for lane, endpoints in (config.get("lanes") or {}).items():
        for k, ep in enumerate(endpoints):
            add_worker(lane, ep, k)
