"""Idéation à plusieurs : qui est sur une planche (son curseur, sa
sélection, ce qu'il regarde, son état d'appel), le fil de discussion de
la planche (messages ancrés à un objet ou à un point, gardés hors du
dépôt), et la signalisation de la visio (WebRTC pair à pair : les offres
et les réponses passent par ici, d'un onglet à l'autre ; l'image et le son
vont directement d'un navigateur à l'autre). La page : `ideation/collab.js`.
L'étude : `docs/etudes/ideation_collab.md`.

Transport, mesuré le 29/09 (l'étude, § 2) : le serveur du socle est
threadé (`ThreadingHTTPServer`) et sait envoyer une réponse au fil de l'eau
(`StreamResponse`, en morceaux). Chaque onglet ouvre donc UN flux
Server-Sent Events (`GET …/stream`, un fil d'exécution du serveur qui dort
sur une condition) et envoie ses gestes par de petits POST, jamais plus
d'un à la fois. Les présences sont fusionnées (la dernière de chaque
onglet, au plus toutes les 40 ms par flux) ; les messages, les signaux et
les arrivées passent dans l'ordre.

Identité : le flux donne à l'onglet un identifiant de connexion (`cid`) ;
le nom, la couleur, la personne viennent de la session (la porte,
core/auth.py), jamais du corps d'une requête. Une requête qui agit au nom
d'un `cid` doit venir de la même personne et de la même session.

    GET  /api/ideation/collab/<planche>                   qui est là, peut-on entrer
    GET  /api/ideation/collab/<planche>/stream[?resume=cid]   le flux (SSE)
    POST /api/ideation/collab/<planche>/presence          {cid, cursor, sel, view, call, away, rev}
    POST /api/ideation/collab/<planche>/leave             {cid}
    GET  /api/ideation/collab/<planche>/messages          le fil (les derniers)
    POST /api/ideation/collab/<planche>/messages          {text, anchor, reply_to, cid}
    POST /api/ideation/collab/<planche>/messages/<id>/delete
    POST /api/ideation/collab/<planche>/signal            {cid, to, kind: offer|answer|bye, data}

Le flux porte les événements `hello` (l'état entier : moi, les autres, le
fil), `p` (des présences), `join`, `leave`, `msg`, `del`, `sig` et `bye`
(la session n'est plus valable). Réglage : `ideation_ice_servers` (liste
RTCIceServer, vide par défaut : réseau local, aucun STUN ni TURN).
"""

from __future__ import annotations

import json
import math
import re
import secrets
import select
import socket
import threading
import time
from collections import deque
from pathlib import Path

from core import auth, config
from core.http import HttpError, StreamResponse

# les délais (des variables du module : le contrôle les raccourcit)
HEARTBEAT_S = 15.0     # un commentaire SSE : garde la connexion, relit la session
GRACE_S = 30.0         # un flux coupé garde sa place : la reprise rend le même cid
PRESENCE_GAP_S = 0.04  # au plus ~25 envois de présence par seconde et par flux
WAKE_S = 1.0           # chaque flux regarde si son navigateur est parti
# les couleurs des participants : des jetons de commun/tokens.css, lus par la page
COLORS = ("cy", "grn2", "amb", "coral-3", "coral-2", "ink")
LIMITS = {
    "streams_user": 8, "streams_board": 32, "streams_total": 256,   # flux ouverts (un par onglet)
    "call": 6,                 # un maillage pair à pair : chacun envoie à tous
    "presence_per_s": 40,      # la page en envoie ~16 au plus
    "sig_per_min": 240, "sig_bytes": 65536,
    "msg_per_min": 20, "msg_len": 2000,
    "sel": 200, "history": 500, "keep": 5000, "queue": 500,
}
NID = re.compile(r"[A-Za-z0-9_-]{1,40}")
CID = re.compile(r"c-[0-9a-f]{12}")
MID = re.compile(r"m-[0-9a-f]{6,14}-[0-9a-f]{6}")
SIG_KINDS = ("offer", "answer", "bye")

_lock = threading.RLock()
_boards: dict[str, dict[str, "Conn"]] = {}
_mlock = threading.RLock()
_msgs: dict[str, list[dict]] = {}
_posted: dict[str, deque] = {}


def _bid_ok(bid: str) -> None:
    from tools import ideation
    if not ideation.BID.fullmatch(bid or ""):
        raise HttpError(400, "identifiant de planche invalide")
    if not (config.data_dir() / "ideation" / f"{bid}.json").exists():
        raise HttpError(404, f"planche introuvable : {bid}")


def _user(req) -> dict:
    u = getattr(req, "user", None)
    if not u:
        raise HttpError(401, "connexion requise")
    return u


# ── les connexions (une par onglet) ─────────────────────────
class Conn:
    def __init__(self, bid: str, u: dict, sess: str | None, color: str) -> None:
        self.cid = "c-" + secrets.token_hex(6)
        self.bid = bid
        self.uid, self.name, self.sess = u["id"], u.get("name") or u["id"], sess
        self.admin = auth.is_admin(u)
        self.color = color
        self.cursor = None
        self.sel: list[str] = []
        self.view = None
        self.call = None
        self.away = False
        self.rev = None
        self.since = time.time()
        self.attached = False
        self.lost = 0.0
        self.gen = 0
        self.kicked = ""
        self.cond = threading.Condition()
        self.events: list[bytes] = []
        self.dirty: set[str] = set()
        self.bucket = [time.time(), float(LIMITS["presence_per_s"])]
        self.sigs: deque = deque()

    def public(self) -> dict:
        return {"cid": self.cid, "user": self.uid, "name": self.name, "color": self.color,
                "cursor": self.cursor, "sel": self.sel, "view": self.view, "call": self.call,
                "away": self.away, "rev": self.rev, "lost": not self.attached}


def _sse(event: str, data) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n".encode()


def _push(c: Conn, payload: bytes) -> None:
    with c.cond:
        c.events.append(payload)
        if len(c.events) > LIMITS["queue"]:   # un flux coupé qui ne revient pas : l'état se relit au retour
            del c.events[: len(c.events) - LIMITS["queue"]]
        c.cond.notify()


def _mark(c: Conn, cid: str) -> None:
    with c.cond:
        c.dirty.add(cid)
        c.cond.notify()


def _others(bid: str, cid: str | None = None) -> list[Conn]:
    with _lock:
        return [x for x in _boards.get(bid, {}).values() if x.cid != cid]


def _broadcast(bid: str, payload: bytes, exclude: str | None = None) -> None:
    for x in _others(bid, exclude):
        _push(x, payload)


def _changed(c: Conn) -> None:
    for x in _others(c.bid, c.cid):
        _mark(x, c.cid)


def _color(conns: dict, uid: str) -> str:
    for x in conns.values():
        if x.uid == uid:
            return x.color
    used = {x.color for x in conns.values()}
    return next((k for k in COLORS if k not in used), COLORS[len(conns) % len(COLORS)])


def _remove(c: Conn, why: str = "") -> None:
    with _lock:
        conns = _boards.get(c.bid, {})
        if conns.get(c.cid) is not c:
            return
        del conns[c.cid]
        if not conns:
            _boards.pop(c.bid, None)
    with c.cond:
        c.kicked = c.kicked or why or "parti"
        c.cond.notify()
    _broadcast(c.bid, _sse("leave", {"cid": c.cid, "user": c.uid, "name": c.name}))
    auth.journal("idéation · quitte", user=c.uid, board=c.bid, cid=c.cid)


def _sweep(bid: str) -> None:
    """Les flux coupés depuis plus de GRACE_S s'en vont (et le disent)."""
    now = time.time()
    with _lock:
        gone = [x for x in _boards.get(bid, {}).values() if not x.attached and x.lost and now - x.lost > GRACE_S]
    for x in gone:
        _remove(x, "délai")


def _count(pred) -> int:
    with _lock:
        return sum(1 for conns in _boards.values() for x in conns.values() if pred(x))


def _can_join(bid: str, u: dict) -> str:
    """Pourquoi un onglet de plus ne peut pas entrer ("" : il peut)."""
    if _count(lambda x: x.uid == u["id"]) >= LIMITS["streams_user"]:
        return f"tu as déjà {LIMITS['streams_user']} onglets ouverts à plusieurs : ferme-en un"
    if len(_boards.get(bid, {})) >= LIMITS["streams_board"]:
        return f"cette planche a déjà {LIMITS['streams_board']} onglets ouverts"
    if _count(lambda x: True) >= LIMITS["streams_total"]:
        return "le portail tient déjà assez de monde à plusieurs : réessaie plus tard"
    return ""


def _conn(req, bid: str, cid) -> Conn:
    """La connexion au nom de laquelle la requête agit : la même personne,
    la même session ; 410 si elle est partie (la page se reconnecte)."""
    u = _user(req)
    cid = str(cid or "")
    if not CID.fullmatch(cid):
        raise HttpError(400, "cid invalide")
    with _lock:
        c = _boards.get(bid, {}).get(cid)
    if c is None:
        raise HttpError(410, "cette connexion a quitté la planche : reconnecte-toi")
    if c.uid != u["id"] or c.sess != getattr(req, "session", None):
        raise HttpError(403, "cette connexion n'est pas la tienne")
    return c


def _closed(sock) -> bool:
    """Le navigateur a-t-il fermé la connexion ? (lisible sans rien à lire)"""
    try:
        r, _, _ = select.select([sock], [], [], 0)
        if not r:
            return False
        return sock.recv(1, socket.MSG_PEEK) == b""
    except (OSError, ValueError):
        return True


def _still_allowed(req, c: Conn) -> bool:
    if not auth.enabled():
        return True
    _, _, u = auth.session_of(req)
    return bool(u) and u.get("state") == "active" and u["id"] == c.uid


# ── le fil (hors du dépôt : <data_dir>/ideation_collab/<planche>.jsonl) ──
def _mfile(bid: str) -> Path:
    p = config.data_dir() / "ideation_collab"
    p.mkdir(parents=True, exist_ok=True)
    return p / f"{bid}.jsonl"


def _history(bid: str) -> list[dict]:
    with _mlock:
        if bid in _msgs:
            return _msgs[bid]
        out: dict[str, dict] = {}
        f = _mfile(bid)
        if f.exists():
            for line in f.read_text(encoding="utf-8").splitlines():
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if d.get("op") == "del":
                    if d.get("id") in out:
                        out[d["id"]].update(deleted=True, text="")
                elif MID.fullmatch(str(d.get("id", ""))):
                    out[d["id"]] = d
        _msgs[bid] = list(out.values())[-LIMITS["keep"]:]
        return _msgs[bid]


def _append(bid: str, rec: dict) -> None:
    with _mlock:
        f = _mfile(bid)
        with open(f, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        # trop long : on réécrit ce qui reste (les suppressions appliquées)
        if f.stat().st_size > 4 << 20:
            keep = _history(bid)[-LIMITS["keep"]:]
            tmp = f.with_suffix(".tmp")
            tmp.write_text("".join(json.dumps(m, ensure_ascii=False) + "\n" for m in keep), encoding="utf-8")
            tmp.replace(f)
            _msgs[bid] = keep


def _anchor(v):
    if v in (None, "", {}):
        return None
    if not isinstance(v, dict):
        raise HttpError(400, "ancre : un objet {node} ou {x, y}")
    if "node" in v:
        nid = str(v.get("node") or "")
        if not NID.fullmatch(nid):
            raise HttpError(400, "ancre : identifiant d'objet invalide")
        return {"node": nid, "label": str(v.get("label") or "")[:120]}
    try:
        x, y = float(v.get("x")), float(v.get("y"))
    except (TypeError, ValueError) as e:
        raise HttpError(400, "ancre : x et y, des nombres") from e
    if not (math.isfinite(x) and math.isfinite(y) and abs(x) <= 1e6 and abs(y) <= 1e6):
        raise HttpError(400, "ancre : hors de la planche")
    return {"x": round(x, 1), "y": round(y, 1)}


# ── les routes ───────────────────────────────────────────────
def r_state(req, bid):
    u = _user(req)
    _bid_ok(bid)
    _sweep(bid)
    with _lock:
        peers = [x.public() for x in _boards.get(bid, {}).values()]
        why = _can_join(bid, u)
    return {"board": bid, "peers": peers, "join": {"ok": not why, "why": why},
            "limits": {k: LIMITS[k] for k in ("call", "msg_len", "history")}}


def r_stream(req, bid):
    u = _user(req)
    _bid_ok(bid)
    _sweep(bid)
    resume = req.q("resume")
    joined = False
    with _lock:
        conns = _boards.setdefault(bid, {})
        c = conns.get(resume) if resume else None
        if c is not None and (c.uid != u["id"] or c.sess != getattr(req, "session", None)):
            c = None   # le cid d'un autre : on ne le reprend pas
        if c is None:
            why = _can_join(bid, u)
            if why:
                if not conns:
                    _boards.pop(bid, None)
                raise HttpError(429, why)
            c = Conn(bid, u, getattr(req, "session", None), _color(conns, u["id"]))
            conns[c.cid] = c
            joined = True
        c.gen += 1
        gen = c.gen
        c.attached, c.lost, c.kicked = True, 0.0, ""
        others = [x.public() for x in conns.values() if x is not c]
    with c.cond:   # l'ancien flux d'une reprise se retire aussitôt
        c.cond.notify_all()
    with _mlock:   # des copies : un retrait concurrent ne change pas un message pendant qu'on l'écrit
        hist = _history(bid)
        msgs, total = [dict(m) for m in hist[-LIMITS["history"]:]], len(hist)
    hello = {"cid": c.cid, "resumed": not joined, "board": bid,
             "me": {"id": c.uid, "name": c.name, "color": c.color, "admin": c.admin},
             "peers": others, "messages": msgs, "total": total,
             "limits": {k: LIMITS[k] for k in ("call", "msg_len", "history", "sel")},
             "ice": config.get("ideation_ice_servers") or [], "t": time.time()}
    if joined:
        _broadcast(bid, _sse("join", c.public()), exclude=c.cid)
        auth.journal("idéation · entre", user=c.uid, board=bid, cid=c.cid)
    else:
        _changed(c)
    sock = getattr(getattr(req, "_h", None), "connection", None)

    def chunks():
        yield b"retry: 3000\n\n" + _sse("hello", hello)
        beat = time.time()
        while True:
            with c.cond:
                if not c.events and not c.dirty and c.gen == gen and not c.kicked:
                    c.cond.wait(WAKE_S)
                if c.gen != gen:   # repris par un autre flux : les événements sont à lui
                    return
                evs, c.events = c.events, []
                dirty, c.dirty = c.dirty, set()
                kicked = c.kicked
            out = list(evs)
            if kicked:
                out.append(_sse("bye", {"why": kicked}))
                yield b"".join(out)
                return
            if dirty:
                with _lock:
                    cur = _boards.get(bid, {})
                    states = [cur[x].public() for x in dirty if x in cur]
                if states:
                    out.append(_sse("p", states))
            now = time.time()
            if not out and now - beat >= HEARTBEAT_S:
                _sweep(bid)
                if not _still_allowed(req, c):
                    yield _sse("bye", {"why": "ta session n'est plus valable : retape ton pseudo"})
                    _remove(c, "session")
                    return
                out.append(b": ping\n\n")
            if out:
                yield b"".join(out)
                beat = now
                if dirty:
                    time.sleep(PRESENCE_GAP_S)
            elif sock is not None and _closed(sock):
                return

    g = chunks()

    def close():
        g.close()
        _detach(c, gen)

    return StreamResponse(200, [("Content-Type", "text/event-stream; charset=utf-8"), ("Cache-Control", "no-store"),
                                ("X-Accel-Buffering", "no")], g, close=close)


def _detach(c: Conn, gen: int) -> None:
    with _lock:
        if c.gen != gen or not c.attached:
            return
        c.attached, c.lost = False, time.time()
        present = _boards.get(c.bid, {}).get(c.cid) is c
    if present:
        _changed(c)


def _pt(v):
    if v is None:
        return None
    try:
        x, y = float(v[0]), float(v[1])
    except (TypeError, ValueError, IndexError, KeyError) as e:
        raise HttpError(400, "curseur : [x, y]") from e
    if not (math.isfinite(x) and math.isfinite(y)):
        raise HttpError(400, "curseur : des nombres")
    return [round(max(-1e6, min(1e6, x)), 1), round(max(-1e6, min(1e6, y)), 1)]


def _rect(v):
    if v is None:
        return None
    try:
        r = [float(v[k]) for k in range(4)]
    except (TypeError, ValueError, IndexError, KeyError) as e:
        raise HttpError(400, "vue : [x, y, largeur, hauteur]") from e
    if not all(math.isfinite(k) for k in r) or r[2] <= 0 or r[3] <= 0:
        raise HttpError(400, "vue : des nombres, une taille positive")
    return [round(max(-1e7, min(1e7, k)), 1) for k in r]


def _ids(v) -> list[str]:
    if not isinstance(v, list):
        raise HttpError(400, "sélection : une liste d'identifiants")
    if len(v) > LIMITS["sel"]:
        v = v[: LIMITS["sel"]]
    out = []
    for x in v:
        if not NID.fullmatch(str(x)):
            raise HttpError(400, "sélection : identifiant invalide")
        out.append(str(x))
    return out


def _small(req, n: int) -> dict:
    """Le corps JSON d'une petite requête : refusé avant d'être lu s'il annonce plus de n octets."""
    try:
        size = int(req.headers.get("Content-Length") or 0)
    except ValueError as e:
        raise HttpError(400, "Content-Length illisible") from e
    if size > n:
        raise HttpError(413, f"corps trop gros ({n} octets au plus ici)")
    return req.json()


def r_presence(req, bid):
    d = _small(req, 16384)
    c = _conn(req, bid, d.get("cid"))
    # Une présence acceptée sort du journal des écritures : un curseur envoie
    # jusqu'à ~16 POST par seconde, qui noieraient le journal (audit B5). Les
    # refus (autre session, onglet parti) y restent, et les arrivées et départs
    # aussi (« idéation · entre / quitte »). Le socle n'a pas de crochet pour le
    # dire : `protected` n'est plus lu, après la réponse, que par auth.after
    # pour journaliser — la porte est déjà passée.
    req.protected = False
    now = time.time()
    with _lock:
        t0, tokens = c.bucket
        tokens = min(float(LIMITS["presence_per_s"]), tokens + (now - t0) * LIMITS["presence_per_s"])
        if tokens < 1:
            c.bucket = [now, tokens]
            raise HttpError(429, "trop de mouvements à la fois")
        c.bucket = [now, tokens - 1]
    call = c.call
    if "call" in d:
        v = d["call"]
        if not v or not isinstance(v, dict) or not v.get("on"):
            call = None
        else:
            call = {k: bool(v.get(k)) for k in ("on", "mic", "cam", "screen", "recv")}
            if not (c.call or {}).get("on"):
                with _lock:
                    n = sum(1 for x in _boards.get(bid, {}).values() if x is not c and (x.call or {}).get("on"))
                if n >= LIMITS["call"]:
                    raise HttpError(409, f"l'appel est plein ({LIMITS['call']} au plus : chacun envoie son image à tous)")
    upd = {}
    if "cursor" in d:
        upd["cursor"] = _pt(d["cursor"])
    if "sel" in d:
        upd["sel"] = _ids(d["sel"])
    if "view" in d:
        upd["view"] = _rect(d["view"])
    if "away" in d:
        upd["away"] = bool(d["away"])
    if "rev" in d:
        try:
            upd["rev"] = int(d["rev"]) if d["rev"] is not None else None
        except (TypeError, ValueError) as e:
            raise HttpError(400, "rev : un entier") from e
    with _lock:
        for k, v in upd.items():
            setattr(c, k, v)
        c.call = call
    _changed(c)
    return {"ok": True}


def r_leave(req, bid):
    d = _small(req, 4096)
    try:
        c = _conn(req, bid, d.get("cid"))
    except HttpError as e:
        if e.status == 410:
            return {"ok": True}
        raise
    _remove(c, "parti")
    return {"ok": True}


def r_messages(req, bid):
    _user(req)
    _bid_ok(bid)
    with _mlock:
        h = _history(bid)
        return {"messages": [dict(m) for m in h[-LIMITS["history"]:]], "total": len(h)}


def r_post(req, bid):
    u = _user(req)
    _bid_ok(bid)
    d = _small(req, 32768)
    text = str(d.get("text") or "").strip()
    if not text:
        raise HttpError(400, "un message vide ne part pas")
    if len(text) > LIMITS["msg_len"]:
        raise HttpError(400, f"message trop long ({LIMITS['msg_len']} signes au plus)")
    anchor = _anchor(d.get("anchor"))
    now = time.time()
    with _mlock:
        hits = _posted.setdefault(u["id"], deque())
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= LIMITS["msg_per_min"]:
            raise HttpError(429, f"doucement : {LIMITS['msg_per_min']} messages par minute au plus")
        hits.append(now)
        reply = None
        if d.get("reply_to"):
            rid = str(d["reply_to"])
            by = {m["id"]: m for m in _history(bid)}
            if rid not in by:
                raise HttpError(404, "le message auquel tu réponds n'est plus au fil")
            reply = by[rid].get("reply_to") or rid   # un seul niveau : la réponse va au fil du premier
            anchor = None
    # la couleur : celle de l'auteur sur la planche (la même dans tous ses onglets), gardée avec le message
    with _lock:
        color = next((x.color for x in _boards.get(bid, {}).values() if x.uid == u["id"]), None)
    if color is None:
        color = COLORS[sum(map(ord, u["id"])) % len(COLORS)]
    m = {"id": f"m-{int(now * 1000):x}-{secrets.token_hex(3)}", "t": auth.now_iso(), "user": u["id"],
         "name": u.get("name") or u["id"], "color": color, "text": text, "anchor": anchor, "reply_to": reply}
    with _mlock:
        hist = _history(bid)
        hist.append(m)
        if len(hist) > LIMITS["keep"]:
            del hist[: len(hist) - LIMITS["keep"]]
        _append(bid, m)
    _broadcast(bid, _sse("msg", m))
    return m


def r_delete(req, bid, mid):
    u = _user(req)
    _bid_ok(bid)
    with _mlock:
        m = next((x for x in _history(bid) if x["id"] == mid), None)
        if not m or m.get("deleted"):
            raise HttpError(404, "ce message n'est plus au fil")
        if m["user"] != u["id"] and not auth.is_admin(u):
            raise HttpError(403, f"seul {m['name']} (ou un admin) retire ce message")
        m.update(deleted=True, text="")
        _append(bid, {"op": "del", "id": mid, "by": u["id"], "t": auth.now_iso()})
    _broadcast(bid, _sse("del", {"id": mid}))
    return {"ok": True}


def r_signal(req, bid):
    d = _small(req, LIMITS["sig_bytes"])
    c = _conn(req, bid, d.get("cid"))
    kind = d.get("kind")
    if kind not in SIG_KINDS:
        raise HttpError(400, "signal : offer, answer ou bye")
    now = time.time()
    with _lock:
        while c.sigs and now - c.sigs[0] > 60:
            c.sigs.popleft()
        if len(c.sigs) >= LIMITS["sig_per_min"]:
            raise HttpError(429, "trop de signaux")
        c.sigs.append(now)
        to = _boards.get(bid, {}).get(str(d.get("to") or ""))
    if to is None:
        raise HttpError(404, "cet onglet a quitté la planche")
    if kind != "bye" and not ((c.call or {}).get("on") and (to.call or {}).get("on")):
        raise HttpError(409, "l'un de vous deux n'est pas dans l'appel")
    data = d.get("data")
    if kind != "bye" and not (isinstance(data, dict) and data.get("type") in ("offer", "answer")
                              and isinstance(data.get("sdp"), str)):
        raise HttpError(400, "signal : une description de session {type, sdp}")
    _push(to, _sse("sig", {"from": c.cid, "user": c.uid, "kind": kind,
                           "data": {"type": data["type"], "sdp": data["sdp"]} if kind != "bye" else None}))
    return {"ok": True}


def register(app) -> None:
    app.route("GET", "/api/ideation/collab/{bid}", r_state)
    app.route("GET", "/api/ideation/collab/{bid}/stream", r_stream)
    app.route("POST", "/api/ideation/collab/{bid}/presence", r_presence)
    app.route("POST", "/api/ideation/collab/{bid}/leave", r_leave)
    app.route("GET", "/api/ideation/collab/{bid}/messages", r_messages)
    app.route("POST", "/api/ideation/collab/{bid}/messages", r_post)
    app.route("POST", "/api/ideation/collab/{bid}/messages/{mid}/delete", r_delete)
    app.route("POST", "/api/ideation/collab/{bid}/signal", r_signal)


# ── le contrôle (tools/check.py) ─────────────────────────────
class _Flux:
    """Un flux SSE lu dans un fil à part : les événements dans une file."""

    def __init__(self, path: str, cookie: str | None = None) -> None:
        import http.client
        import queue
        self.q: "queue.Queue" = queue.Queue()
        self.conn = http.client.HTTPConnection("127.0.0.1", int(config.get("port")), timeout=30)
        hd = {"Accept": "text/event-stream"}
        if cookie:
            hd["Cookie"] = f"{auth.COOKIE}={cookie}"
        self.conn.request("GET", path, headers=hd)
        self.resp = self.conn.getresponse()
        self.status = self.resp.status
        if self.status == 200:
            threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        ev, data = "message", []
        try:
            while True:
                line = self.resp.readline()
                if not line:
                    break
                line = line.decode("utf-8").rstrip("\r\n")
                if line == "":
                    if data:
                        self.q.put((ev, json.loads("\n".join(data))))
                    ev, data = "message", []
                elif line.startswith("event:"):
                    ev = line[6:].strip()
                elif line.startswith("data:"):
                    data.append(line[5:].strip())
                elif line.startswith(":"):
                    self.q.put(("ping", None))
        except Exception:   # la socket coupée en plein morceau (IncompleteRead…) : c'est la fin du flux
            pass
        self.q.put(("eof", None))

    def wait(self, pred, timeout: float = 3.0):
        import queue
        end = time.time() + timeout
        while time.time() < end:
            try:
                ev, d = self.q.get(timeout=max(0.01, end - time.time()))
            except queue.Empty:
                break
            if pred(ev, d):
                return ev, d
        return None, None

    def close(self) -> None:
        # d'abord couper la socket : le fil de lecture sort de son recv, puis on ferme
        try:
            if self.conn.sock:
                self.conn.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            self.resp.close()
        except OSError:
            pass
        self.conn.close()


def selftest(call, ok) -> None:
    from tools.admin import essai_http as H

    st, b = call("POST", "/api/ideation/boards", {"name": "Essai à plusieurs"})
    bid = b.get("id", "")
    base = f"/api/ideation/collab/{bid}"
    ok(st == 200 and bid, "collab : une planche d'essai")

    # la porte coupée (auth: false) : tout le monde est Cal, le flux marche quand même
    f0 = _Flux(base + "/stream")
    ev, hello = f0.wait(lambda e, d: e == "hello")
    ok(f0.status == 200 and hello and CID.fullmatch(hello["cid"]) and hello["me"]["id"] == auth.admin_id()
       and hello["me"]["color"] in COLORS, f"collab : le flux dit bonjour, porte coupée ({f0.status} {hello and hello.get('me')})")
    f0.close()
    st, _ = call("GET", "/api/ideation/collab/ide-20260101-000000-0000/stream")
    ok(st == 404, f"collab : une planche absente est refusée ({st})")
    st, _ = call("GET", "/api/ideation/collab/..%2Fjobs/stream")
    ok(st in (400, 404), f"collab : un identifiant hors motif est refusé ({st})")

    saved = {k: globals()[k] for k in ("HEARTBEAT_S", "GRACE_S", "WAKE_S")}
    saved_lim = dict(LIMITS)
    before = config.CFG.get("auth")
    config.CFG["auth"] = True
    auth.startup()
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    flux: list[_Flux] = []
    try:
        globals().update(HEARTBEAT_S=1.0, GRACE_S=2.0, WAKE_S=0.2)
        auth._hits.pop("entree:127.0.0.1", None)   # les essais de la porte (compte.py) ont pris la limite d'entrées
        s, d, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        s, d, lina = H("POST", "/api/auth/enter", {"name": "Lina"}, headers=same)
        H("POST", "/api/admin/requests/lina/accept", cookie=cal, headers=same)
        s, me_, _ = H("GET", "/api/auth/me", cookie=lina)
        ok(cal and lina and me_.get("state") == "active", f"collab : deux personnes, Cal et Lina ({me_.get('state')})")

        s, _, _ = H("GET", base + "/stream")
        ok(s == 401, f"collab : sans session, pas de flux ({s})")
        fc = _Flux(base + "/stream", cal)
        flux.append(fc)
        _, hc = fc.wait(lambda e, d: e == "hello")
        fl = _Flux(base + "/stream", lina)
        flux.append(fl)
        _, hl = fl.wait(lambda e, d: e == "hello")
        ok(hc and hl and hc["me"]["name"] == "Cal" and hl["me"]["name"] == "Lina" and hc["me"]["color"] != hl["me"]["color"],
           f"collab : chacun a son nom (de la session) et sa couleur ({hc and hc['me']}, {hl and hl['me']})")
        ok(hl and any(p["cid"] == hc["cid"] for p in hl["peers"]), "collab : Lina voit Cal déjà là")
        _, j = fc.wait(lambda e, d: e == "join")
        ok(j and j["name"] == "Lina" and j["cid"] == hl["cid"], f"collab : Cal voit Lina arriver ({j})")
        ccid, lcid = hc["cid"], hl["cid"]

        # la présence : ce que Lina envoie, Cal le reçoit ; le nom vient de la session, pas du corps
        t0 = time.time()
        s, _, _ = H("POST", base + "/presence", {"cid": lcid, "cursor": [120.4, -30], "sel": ["n1", "f2"],
                                                 "view": [0, 0, 800, 600], "name": "Cal", "color": "or"},
                    cookie=lina, headers=same)
        _, p = fc.wait(lambda e, d: e == "p" and any(x["cid"] == lcid and x["cursor"] for x in d))
        lp = next((x for x in (p or []) if x["cid"] == lcid), {})
        ok(s == 200 and lp.get("cursor") == [120.4, -30.0] and lp.get("sel") == ["n1", "f2"] and lp.get("name") == "Lina"
           and lp.get("color") == hl["me"]["color"], f"collab : le curseur et la sélection de Lina arrivent chez Cal ({s} {lp})")
        ok(time.time() - t0 < 1.0, f"collab : en moins d'une seconde ({time.time() - t0:.3f} s)")
        s, _, _ = H("POST", base + "/presence", {"cid": ccid, "cursor": [0, 0]}, cookie=lina, headers=same)
        ok(s == 403, f"collab : Lina n'agit pas au nom de l'onglet de Cal ({s})")
        s, _, _ = H("POST", base + "/presence", {"cid": "c-000000000000", "cursor": [0, 0]}, cookie=lina, headers=same)
        ok(s == 410, f"collab : un onglet parti répond 410 ({s})")
        for bad in ({"cursor": ["a", 1]}, {"sel": ["../x"]}, {"view": [0, 0, -1, 5]}, {"cursor": [float("nan"), 1]}):
            s, _, _ = H("POST", base + "/presence", {"cid": lcid, **bad}, cookie=lina, headers=same)
            ok(s == 400, f"collab : présence refusée {bad} ({s})")
        jr = [e for e in auth.journal_tail(400) if e.get("event") == "http" and e.get("path", "").endswith("/presence")]
        ok(not any(e.get("status") == 200 for e in jr) and any(e.get("status") == 403 for e in jr),
           f"collab : les curseurs ne noient pas le journal ; un refus y reste ({[e.get('status') for e in jr]})")
        ok(any(e.get("event") == "idéation · entre" and e.get("user") == "lina" for e in auth.journal_tail(400)),
           "collab : l'arrivée de Lina est au journal")

        # le fil : un message ancré, gardé hors du dépôt, reçu par l'autre
        s, m, _ = H("POST", base + "/messages", {"text": "  ce cadre-là  ", "anchor": {"node": "f2", "label": "Ambiance"},
                                                "name": "Cal"}, cookie=lina, headers=same)
        _, got = fc.wait(lambda e, d: e == "msg")
        ok(s == 200 and got and got["id"] == m["id"] and got["name"] == "Lina" and got["text"] == "ce cadre-là"
           and got["anchor"] == {"node": "f2", "label": "Ambiance"} and got["color"] == hl["me"]["color"],
           f"collab : le message ancré de Lina arrive chez Cal ({s} {got})")
        ok(_mfile(bid).exists() and m["id"] in _mfile(bid).read_text(encoding="utf-8"),
           "collab : le fil est gardé dans les données du portail")
        s, r, _ = H("POST", base + "/messages", {"text": "oui", "reply_to": m["id"], "anchor": {"x": 1, "y": 2}},
                    cookie=cal, headers=same)
        ok(s == 200 and r["reply_to"] == m["id"] and r["anchor"] is None, f"collab : une réponse va au fil du message ({s})")
        s, r2, _ = H("POST", base + "/messages", {"text": "et encore", "reply_to": r["id"]}, cookie=lina, headers=same)
        ok(s == 200 and r2["reply_to"] == m["id"], "collab : un seul niveau de réponses")
        for bad, want in (({"text": ""}, 400), ({"text": "x" * 2001}, 400), ({"text": "a", "anchor": {"node": "../x"}}, 400),
                          ({"text": "a", "anchor": {"x": "a", "y": 0}}, 400), ({"text": "a", "reply_to": "m-00000000-000000"}, 404)):
            s, _, _ = H("POST", base + "/messages", bad, cookie=lina, headers=same)
            ok(s == want, f"collab : message refusé {str(bad)[:40]} ({s})")
        s, lst, _ = H("GET", base + "/messages", cookie=cal)
        ok(s == 200 and [x["id"] for x in lst["messages"]] == [m["id"], r["id"], r2["id"]], f"collab : le fil se relit ({s})")
        s, _, _ = H("POST", f"{base}/messages/{r['id']}/delete", cookie=lina, headers=same)
        ok(s == 403, f"collab : Lina ne retire pas le message de Cal ({s})")
        s, _, _ = H("POST", f"{base}/messages/{m['id']}/delete", cookie=cal, headers=same)
        _, dl = fl.wait(lambda e, d: e == "del")
        ok(s == 200 and dl and dl["id"] == m["id"], f"collab : Cal (admin) retire celui de Lina, et Lina le voit ({s})")
        with _mlock:
            _msgs.pop(bid, None)   # relu du disque : la suppression tient
        ok(next(x for x in _history(bid) if x["id"] == m["id"]).get("deleted"), "collab : la suppression est gardée")
        LIMITS["msg_per_min"] = 5
        codes = [H("POST", base + "/messages", {"text": f"n°{k}"}, cookie=lina, headers=same)[0] for k in range(6)]
        ok(429 in codes, f"collab : un quota de messages par minute ({codes})")

        # la signalisation : seulement entre deux onglets dans l'appel
        offer = {"type": "offer", "sdp": "v=0\r\n"}
        s, _, _ = H("POST", base + "/signal", {"cid": lcid, "to": ccid, "kind": "offer", "data": offer}, cookie=lina, headers=same)
        ok(s == 409, f"collab : pas de signal hors de l'appel ({s})")
        for cid, tok in ((lcid, lina), (ccid, cal)):
            H("POST", base + "/presence", {"cid": cid, "call": {"on": True, "mic": True, "cam": True}}, cookie=tok, headers=same)
        s, _, _ = H("POST", base + "/signal", {"cid": lcid, "to": ccid, "kind": "offer", "data": offer}, cookie=lina, headers=same)
        _, sg = fc.wait(lambda e, d: e == "sig")
        ok(s == 200 and sg and sg["from"] == lcid and sg["user"] == "lina" and sg["data"] == offer,
           f"collab : l'offre de Lina arrive à l'onglet de Cal, et à lui seul ({s} {sg})")
        s, _, _ = H("POST", base + "/signal", {"cid": lcid, "to": "c-000000000000", "kind": "offer", "data": offer}, cookie=lina, headers=same)
        ok(s == 404, f"collab : un signal vers un onglet parti ({s})")
        s, _, _ = H("POST", base + "/signal", {"cid": lcid, "to": ccid, "kind": "offer", "data": {"type": "offer", "sdp": "x" * 70000}},
                    cookie=lina, headers=same)
        ok(s == 413, f"collab : un signal trop gros ({s})")
        s, _, _ = H("POST", base + "/signal", {"cid": ccid, "to": lcid, "kind": "offer", "data": offer}, cookie=lina, headers=same)
        ok(s == 403, f"collab : pas de signal au nom d'un autre ({s})")
        LIMITS["call"] = 2
        fc2 = _Flux(base + "/stream", cal)   # un second onglet de Cal
        flux.append(fc2)
        _, h2 = fc2.wait(lambda e, d: e == "hello")
        s, d, _ = H("POST", base + "/presence", {"cid": h2["cid"], "call": {"on": True}}, cookie=cal, headers=same)
        ok(s == 409 and "plein" in (d or {}).get("error", ""), f"collab : l'appel a une taille maximale ({s} {d})")

        # reprise : même session → même cid ; une autre personne ne reprend pas un cid
        fc2.close()
        time.sleep(0.6)
        _, lost = fc.wait(lambda e, d: e == "p" and any(x["cid"] == h2["cid"] and x["lost"] for x in d), 3)
        ok(lost is not None, "collab : un onglet coupé se voit tout de suite (moins d'une seconde)")
        fc3 = _Flux(f"{base}/stream?resume={h2['cid']}", cal)
        flux.append(fc3)
        _, h3 = fc3.wait(lambda e, d: e == "hello")
        ok(h3 and h3["cid"] == h2["cid"] and h3["resumed"], f"collab : la reprise rend le même cid ({h3 and h3['cid']})")
        fx = _Flux(f"{base}/stream?resume={ccid}", lina)
        flux.append(fx)
        _, hx = fx.wait(lambda e, d: e == "hello")
        ok(hx and hx["cid"] != ccid and hx["me"]["name"] == "Lina", "collab : Lina ne reprend pas le cid de Cal")
        fx.close()
        fc3.close()
        _, lv = fc.wait(lambda e, d: e == "leave" and d["cid"] == h2["cid"], 5)
        ok(lv is not None, "collab : passé le délai de grâce, l'onglet coupé s'en va (et le dit)")

        # quitter ; plus d'onglets que permis ; une session retirée ferme le flux
        s, _, _ = H("POST", base + "/leave", {"cid": lcid}, cookie=lina, headers=same)
        _, lv = fc.wait(lambda e, d: e == "leave" and d["cid"] == lcid)
        ev, _ = fl.wait(lambda e, d: e in ("bye", "eof"))
        ok(s == 200 and lv and ev == "bye", f"collab : Lina quitte, Cal le voit, son flux se ferme ({s} {ev})")
        LIMITS["streams_user"] = 1
        fy = _Flux(base + "/stream", cal)
        ok(fy.status == 429, f"collab : un quota d'onglets par personne ({fy.status})")
        fy.close()
        LIMITS["streams_user"] = saved_lim["streams_user"]
        fz = _Flux(base + "/stream", lina)
        flux.append(fz)
        fz.wait(lambda e, d: e == "hello")
        H("POST", "/api/auth/logout", cookie=lina, headers=same)
        ev, bye = fz.wait(lambda e, d: e in ("bye", "eof"), 4)
        ok(ev == "bye" and "session" in (bye or {}).get("why", ""), f"collab : déconnectée, Lina perd le flux ({ev} {bye})")
    finally:
        for f in flux:
            f.close()
        globals().update(saved)
        LIMITS.clear()
        LIMITS.update(saved_lim)
        with _lock:
            _boards.clear()
        auth.set_current(None)
        config.CFG["auth"] = before
