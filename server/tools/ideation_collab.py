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
fil, la version de la planche), `p` (des présences), `join`, `leave`, `msg`,
`del`, `sig`, `bye` (la session n'est plus valable), et pour la co-édition
`op` (un lot d'opérations appliqué, numéroté) et `reset` (la planche a été
écrite entière ailleurs : la page se recale). Réglage : `ideation_ice_servers`
(liste RTCIceServer, vide par défaut : réseau local, aucun STUN ni TURN).

La co-édition (l'étude, § 5, sur le modèle du multijoueur de Figma) : le
serveur est l'arbitre. Il tient la planche en mémoire, ordonne les lots
d'opérations que les pages envoient (un numéro chacun : `rev`, la version de
la planche), les applique, les renvoie à tous par le flux, et écrit la
planche sur le disque (tout de suite ; un geste en cours, au plus toutes les
0,8 s). Le dernier écrit gagne, propriété par propriété ; un objet retiré
l'emporte sur une modification.

    POST /api/ideation/collab/<planche>/ops               {sid, n, ops, live}  → {rev, dup}
    GET  /api/ideation/collab/<planche>/ops?since=R       les lots d'après R (ou reset)
    GET  /api/ideation/collab/<planche>/stream?since=R    le flux rejoue d'abord les lots d'après R
    GET  /api/ideation/collab/<planche>/poll?resume=&since=&wait=   sans flux : l'interrogation longue

Les rôles par planche (propriétaire, éditeur, spectateur) et les invitations :

    GET · POST /api/ideation/collab/<planche>/access      mon rôle ; pour le propriétaire, les
                                                          personnes, les liens, les réglages
    POST /api/ideation/collab/<planche>/invites           {role, hours} → le lien (une fois)
    POST /api/ideation/collab/<planche>/invites/<id>/revoke
    POST /api/auth/ideation-invite/<jeton>                ouvrir un lien (une session qui attend passe)
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

from core import auth, config, library
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
        self.lead = False      # « suivez-moi » : les autres suivent sa vue
        self.role = "editor"
        self.poll = False      # sans flux : l'onglet interroge (r_poll)
        self.polled = 0.0
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
                "away": self.away, "rev": self.rev, "lost": not self.attached, "lead": self.lead, "role": self.role}


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
        # un onglet qui interroge et ne demande plus : coupé, comme un flux fermé
        quiet = [x for x in _boards.get(bid, {}).values() if x.poll and x.attached and now - x.polled > POLL_LOST_S]
        for x in quiet:
            x.attached, x.lost = False, now
    for x in gone:
        _remove(x, "délai")
    for x in quiet:
        _changed(x)


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


# ── les rôles par planche, les invitations ──────────────────
# Trois rôles (Figma, « Guide to sharing and permissions » : « People with can
# view access can only perform certain 'read only' actions, like inspecting
# properties, following, and commenting ») : le propriétaire (qui a créé la
# planche ; les admins le sont de toutes), l'éditeur, le spectateur (il voit
# tout en direct, ne modifie rien — le serveur refuse ses opérations — et
# commente si le propriétaire le permet). Les membres du portail sans rôle
# sur une planche y ont le rôle `open` de la planche (éditeur par défaut :
# comme avant) ; un invité entré par un lien n'a que les planches de ses liens.
# Hors du dépôt : <data_dir>/ideation_collab/<planche>.access.json, et
# _invites.json (les personnes entrées par un lien).
ROLES = ("editor", "viewer")
OPEN = ("editor", "viewer", "none")
ROLE_FR = {"owner": "propriétaire", "editor": "éditeur", "viewer": "spectateur", "none": "aucun accès"}
RANK = {"none": 0, "viewer": 1, "editor": 2, "owner": 3}
INVITE_HOURS = (1, 24, 24 * 7, 24 * 30)
TOKEN = re.compile(r"(ide-\d{8}-\d{6}-[0-9a-f]{4})\.([A-Za-z0-9_-]{16,64})")
_alock = threading.RLock()
_acc: dict[str, dict] = {}
_gst: dict | None = None


def _afile(bid: str) -> Path:
    p = config.data_dir() / "ideation_collab"
    p.mkdir(parents=True, exist_ok=True)
    return p / f"{bid}.access.json"


def _access(bid: str) -> dict:
    with _alock:
        a = _acc.get(bid)
        if a is None:
            a = {"owner": None, "members": {}, "invites": [], "comments": False, "open": "editor"}
            f = _afile(bid)
            if f.exists():
                try:
                    a.update(json.loads(f.read_text(encoding="utf-8")))
                except ValueError:
                    pass
            _acc[bid] = a
        return a


def _asave(bid: str) -> None:
    with _alock:
        f = _afile(bid)
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(_acc[bid], ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(f)


def _guests() -> dict:
    global _gst
    with _alock:
        if _gst is None:
            f = config.data_dir() / "ideation_collab" / "_invites.json"
            try:
                _gst = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
            except ValueError:
                _gst = {}
        return _gst


def _gsave() -> None:
    with _alock:
        f = config.data_dir() / "ideation_collab" / "_invites.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(_guests(), ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(f)


def role_of(u: dict | None, bid: str) -> str:
    """owner | editor | viewer | none.

    Teams et Workspaces (étape 2, equipes_espaces.md § 2.3) : une planche est à son
    Workspace (ideation.board_space). Dans une requête d'un autre Workspace, elle
    n'existe pas (comme library.get). Le Workspace borne la planche : `open` y
    devient le rôle d'espace — on peut resserrer une planche, pas l'ouvrir au-delà
    du Workspace (un lecteur, un guest viewer : spectateur au plus ; qui n'est pas
    dans le Workspace : aucun accès), sauf un rôle donné explicitement (un lien de
    partage, `members`)."""
    if not auth.enabled():
        return "owner"
    if not u:
        return "none"
    here = auth.current_space()
    sp = _ide().board_space(bid) if here or not auth.is_guest(u) else None
    if here and sp != here:
        return "none"
    if auth.is_admin(u):
        return "owner"
    a = _access(bid)
    m = a["members"].get(u["id"])
    if m and m.get("role") in ROLES and a.get("owner") != u["id"]:
        return m["role"]
    if auth.is_guest(u):   # l'invité : les planches de ses liens, rien d'autre
        return "none"
    cap = "editor" if auth.can_edit(u, sp) else "viewer" if auth.can_view(u, sp) else "none"
    if a.get("owner") == u["id"]:
        return "owner" if cap == "editor" else cap
    r = a.get("open") if a.get("open") in OPEN else "editor"
    return r if RANK[r] <= RANK[cap] else cap


# ── l'invité (core/auth.py, `guest_realm`) : ses planches, leurs objets ──
# Un pseudo neuf qui ouvre un lien devient un invité du portail (rôle `invite`) :
# il n'atteint que les routes d'Idéation déclarées ici, pour les planches où un
# lien lui donne un rôle, et ne lit dans la bibliothèque que les objets posés
# sur elles. Un lien retiré : la planche et ses objets lui sont fermés aussitôt.
_bitems: dict[str, tuple] = {}


def node_items(n: dict) -> set:
    """Les objets de la bibliothèque qu'un objet de la planche montre : une image,
    une vidéo, un son, un élément ; l'image d'un nuancier ; le visage d'une carte."""
    out = set()
    it = n.get("item")
    if n.get("type") in ("media", "palette") and isinstance(it, str) and it:
        out.add(it)
    d = n.get("data")
    if n.get("type") == "card" and isinstance(d, dict) and isinstance(d.get("item"), str) and d["item"]:
        out.add(d["item"])
    return out


def board_items(bid: str) -> frozenset:
    """Les objets posés sur une planche (celle de la co-édition si elle est en mémoire,
    sinon le fichier), gardés tant que la planche ne change pas."""
    ide = _ide()
    with ide._lock:
        h = _hot.get(bid)
        if h is not None:
            key, nodes = ("mem", id(h), h["b"].get("rev")), h["b"]["nodes"]
        else:
            f = ide._path(bid)
            try:
                st = f.stat()
            except OSError:
                return frozenset()
            key, nodes = ("disque", st.st_mtime_ns, st.st_size), None
        c = _bitems.get(bid)
        if c and c[0] == key:
            return c[1]
        if nodes is None:
            try:
                nodes = json.loads(f.read_text(encoding="utf-8")).get("nodes") or []
            except (OSError, ValueError):
                nodes = []
        got = frozenset(i for n in nodes if isinstance(n, dict) for i in node_items(n))
        _bitems[bid] = (key, got)
        return got


def guest_boards(u: dict) -> list[str]:
    """Les planches d'un invité : celles de ses liens où il a encore un rôle."""
    ide = _ide()
    out = []
    for bid in (_guests().get(u.get("id")) or {}).get("boards", []):
        if isinstance(bid, str) and ide.BID.fullmatch(bid) and ide._path(bid).exists() \
                and role_of(u, bid) in ("viewer", "editor"):
            out.append(bid)
    return out


def guest_items(u: dict) -> set:
    return {i for bid in guest_boards(u) for i in board_items(bid)}


def _guest_home(u: dict) -> str:
    b = guest_boards(u)
    return f"/ideation/#{b[0]}" if b else "/ideation/"


def guest_nodes_ok(u: dict | None, before: list, after: list) -> bool:
    """Un invité ne pose sur une planche que des objets de la bibliothèque qu'il voit
    déjà (copier, coller, dupliquer) : sinon, poser un identifiant deviné lui
    ouvrirait un objet qu'on ne lui a pas montré."""
    if not auth.is_guest(u):
        return True
    had = {i for n in before for i in node_items(n)}
    new = {i for n in after for i in node_items(n)} - had
    return not new or new <= auth.guest_items(u)


_BID_RX = r"(?P<bid>ide-\d{8}-\d{6}-[0-9a-f]{4})"
_ITEM_RX = r"(?P<item>[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4})"


def _is_mine(u: dict, bid: str) -> bool:
    return bid in guest_boards(u)


def _sees(u: dict, item: str) -> bool:
    return item in auth.guest_items(u)


GUEST_ROUTES = [
    ("GET", r"/api/ideation/meta/?", None),
    ("GET", r"/api/ideation/boards/?", None),                     # la liste ne rend que ses planches
    ("GET POST", rf"/api/ideation/boards/{_BID_RX}/?", _is_mine),   # lire ; l'enregistrement de repli (éditeur)
    ("POST", rf"/api/ideation/boards/{_BID_RX}/rename/?", _is_mine),
    ("GET", rf"/api/ideation/palette/{_ITEM_RX}/?", _sees),
    ("GET POST", rf"/api/ideation/collab/{_BID_RX}(?:/[A-Za-z0-9_-]+)*/?", _is_mine),   # flux, présence, fil, opérations
    ("POST", r"/api/library/batch/?", None),                     # filtré par auth.can_read_item
    ("GET", rf"/api/library/{_ITEM_RX}(?:/view)?/?", _sees),
    ("GET", rf"/library/{_ITEM_RX}/.+", _sees),
]


def can_of(role: str, bid: str) -> dict:
    a = _access(bid)
    return {"see": RANK[role] >= 1, "edit": RANK[role] >= 2, "invite": role == "owner",
            "comment": RANK[role] >= 2 or (role == "viewer" and bool(a.get("comments")))}


WHY = {"see": "tu n'as pas accès à cette planche : demande un lien à son propriétaire",
       "edit": "spectateur : cette planche se regarde, elle ne se modifie pas ici",
       "comment": "spectateur : le propriétaire n'a pas ouvert le fil aux spectateurs",
       "invite": "seul le propriétaire de la planche invite et règle les accès"}


def can(u: dict | None, bid: str, what: str) -> bool:
    return can_of(role_of(u, bid), bid)[what]


def need(req, bid: str, what: str) -> str:
    """Le rôle de la personne ; 403 (en disant pourquoi) s'il ne permet pas `what`."""
    r = role_of(getattr(req, "user", None), bid)
    if not can_of(r, bid)[what]:
        raise HttpError(403, WHY[what])
    return r


def created(b: dict, u: dict | None) -> None:
    """Une planche neuve : celui qui la crée en est le propriétaire."""
    if not u or not auth.enabled():
        return
    with _alock:
        a = _access(b["id"])
        a["owner"] = u["id"]
        _asave(b["id"])


def _reroles(bid: str) -> None:
    """Les rôles ont changé : chaque onglet relié reçoit le sien (`role`) ; un
    onglet qui n'a plus accès s'en va."""
    for c in _others(bid):
        u = auth.user(c.uid)
        r = role_of(u, bid) if u and u.get("state") == "active" else "none"
        if r == "none":
            _remove(c, "accès retiré par le propriétaire")
            continue
        c.role = r
        _push(c, _sse("role", {"role": r, "can": can_of(r, bid)}))
        _changed(c)


def _invite_public(i: dict) -> dict:
    return {"id": i["id"], "role": i["role"], "created": i["created"], "exp": i["exp"], "by": i["by"],
            "by_name": auth.display_name(i["by"]), "revoked": bool(i.get("revoked")),
            "expired": time.time() > i["exp"], "uses": [{"id": x, "name": auth.display_name(x)} for x in i.get("uses", [])]}


def r_access(req, bid):
    u = _user(req)
    _bid_ok(bid)
    r = need(req, bid, "see")
    a = _access(bid)
    out = {"board": bid, "role": r, "role_fr": ROLE_FR[r], "can": can_of(r, bid), "comments": bool(a.get("comments")),
           "open": a.get("open", "editor"), "owner": {"id": a.get("owner"), "name": auth.display_name(a.get("owner")) if a.get("owner") else auth.admin_name()},
           "hours": list(INVITE_HOURS), "me": u["id"]}
    if r == "owner":
        out["members"] = [{"id": k, "name": auth.display_name(k), "role": m.get("role"), "via": m.get("via")}
                          for k, m in a["members"].items()]
        out["invites"] = [_invite_public(i) for i in a["invites"]][::-1]
    return out


def r_access_set(req, bid):
    u = _user(req)
    _bid_ok(bid)
    need(req, bid, "invite")
    d = _small(req, 4096)
    with _alock:
        a = _access(bid)
        if "comments" in d:
            a["comments"] = bool(d["comments"])
        if "open" in d:
            if d["open"] not in OPEN:
                raise HttpError(400, "les autres membres du portail : éditeur, spectateur ou aucun accès")
            a["open"] = d["open"]
        m = d.get("member")
        if isinstance(m, dict):
            uid = str(m.get("id") or "")
            if uid not in a["members"]:
                raise HttpError(404, "cette personne n'a pas de rôle sur la planche")
            if m.get("role") in ROLES:
                a["members"][uid]["role"] = m["role"]
            elif m.get("role") is None:
                a["members"].pop(uid)
            else:
                raise HttpError(400, "un rôle : éditeur ou spectateur (ou null : le retirer)")
        _asave(bid)
    auth.journal("idéation · accès", user=u["id"], board=bid, **{k: d[k] for k in ("comments", "open") if k in d},
                 **({"membre": m.get("id"), "role": m.get("role")} if isinstance(m, dict) else {}))
    _reroles(bid)
    return r_access(req, bid)


def r_invite(req, bid):
    u = _user(req)
    _bid_ok(bid)
    need(req, bid, "invite")
    d = _small(req, 4096)
    role = d.get("role")
    if role not in ROLES:
        raise HttpError(400, "le rôle de l'invitation : éditeur ou spectateur")
    try:
        hours = int(d.get("hours") or 24)
    except (TypeError, ValueError) as e:
        raise HttpError(400, "la durée : un nombre d'heures") from e
    if hours not in INVITE_HOURS:
        raise HttpError(400, f"la durée : {', '.join(map(str, INVITE_HOURS))} heures")
    secret = secrets.token_urlsafe(24)
    now = time.time()
    rec = {"id": "i-" + secrets.token_hex(4), "h": auth._hash(secret), "role": role, "created": now, "exp": now + hours * 3600,
           "by": u["id"], "revoked": False, "uses": []}
    with _alock:
        a = _access(bid)
        a["invites"] = [i for i in a["invites"] if i.get("exp", 0) > now - 30 * 86400 or i.get("uses")][-49:] + [rec]
        _asave(bid)
    auth.journal("idéation · invitation", user=u["id"], board=bid, role=role, hours=hours, invite=rec["id"])
    # le lien ne se montre qu'une fois : le serveur n'en garde que l'empreinte
    return {**_invite_public(rec), "token": f"{bid}.{secret}"}


def r_invite_revoke(req, bid, iid):
    u = _user(req)
    _bid_ok(bid)
    need(req, bid, "invite")
    with _alock:
        a = _access(bid)
        rec = next((i for i in a["invites"] if i["id"] == iid), None)
        if not rec:
            raise HttpError(404, "cette invitation n'existe pas")
        rec["revoked"] = True
        # ce que ce lien a donné s'en va avec lui
        for k in [k for k, m in a["members"].items() if m.get("via") == iid]:
            a["members"].pop(k)
        _asave(bid)
    auth.journal("idéation · invitation retirée", user=u["id"], board=bid, invite=iid)
    _reroles(bid)
    return r_access(req, bid)


def r_redeem(req, tok):
    """Ouvrir un lien d'invitation. Sous /api/auth/ : la porte laisse passer une
    session qui attend (un pseudo neuf) ; le lien, que le propriétaire a créé,
    vaut son accord — la demande est acceptée, et la personne n'a que cette
    planche dans Idéation (invitée)."""
    auth._rate(f"invitation-planche:{auth._ip(req)}", 30, 600)   # deviner un lien : 30 essais par 10 min
    m = TOKEN.fullmatch(tok or "")
    if not m:
        raise HttpError(404, "ce lien d'invitation n'est pas valable")
    bid, secret = m.group(1), m.group(2)
    _bid_ok(bid)
    if not auth.enabled():
        return {"board": bid, "role": "owner"}
    _, _, u = auth.session_of(req)
    if not u:
        raise HttpError(401, "tape d'abord ton pseudo à la porte du portail, puis rouvre le lien")
    if u.get("state") == "suspended":
        raise HttpError(403, "ton accès est suspendu : vois avec Cal")
    h = auth._hash(secret)
    now = time.time()
    with _alock:
        a = _access(bid)
        rec = next((i for i in a["invites"] if i.get("h") == h), None)
        if not rec or rec.get("revoked"):
            raise HttpError(410, "ce lien d'invitation a été retiré par le propriétaire")
        if now > rec["exp"]:
            raise HttpError(410, "ce lien d'invitation a expiré : demande-en un autre")
        fresh = u.get("state") == "pending"
        if fresh:
            # le lien vaut l'accord du propriétaire pour CETTE planche : un invité, pas un ami
            # du portail (core/auth.py, GUEST) ; Cal en fait un ami dans l'Admin s'il le veut
            auth.accept(u["id"], by=rec["by"], role=auth.GUEST)
            g = _guests()
            g[u["id"]] = {"boards": [bid], "invite": rec["id"], "by": rec["by"], "t": now}
            _gsave()
        elif auth.is_guest(u) or u["id"] in _guests():   # un invité qui ouvre un second lien : une planche de plus
            g = _guests().setdefault(u["id"], {"boards": [], "invite": rec["id"], "by": rec["by"], "t": now})
            if bid not in g["boards"]:
                g["boards"].append(bid)
                _gsave()
        u = auth.user(u["id"]) or u
        # le rôle du lien, sauf si la personne a déjà mieux sur cette planche (jamais de recul)
        if RANK[role_of(u, bid)] < RANK[rec["role"]]:
            a["members"][u["id"]] = {"role": rec["role"], "via": rec["id"], "t": now}
        if u["id"] not in rec["uses"]:
            rec["uses"] = (rec.get("uses") or [])[-99:] + [u["id"]]
        _asave(bid)
        role = role_of(u, bid)
    auth.journal("idéation · invitation ouverte", user=u["id"], board=bid, invite=rec["id"], role=role, accepte=fresh)
    _reroles(bid)
    return {"board": bid, "role": role, "role_fr": ROLE_FR[role], "accepted": fresh,
            "guest": auth.is_guest(auth.user(u["id"]))}


# ── les routes ───────────────────────────────────────────────
def r_state(req, bid):
    u = _user(req)
    _bid_ok(bid)
    r = need(req, bid, "see")
    _sweep(bid)
    with _lock:
        peers = [x.public() for x in _boards.get(bid, {}).values()]
        why = _can_join(bid, u)
    return {"board": bid, "peers": peers, "join": {"ok": not why, "why": why}, "role": r, "can": can_of(r, bid),
            "limits": {k: LIMITS[k] for k in ("call", "msg_len", "history")}}


def _attach(req, bid: str, poll: bool = False):
    """Un onglet arrive (ou revient, `resume`) : son identifiant, `hello`, et les lots
    à rejouer depuis `since`. Le flux SSE et l'interrogation (r_poll) passent par ici."""
    u = _user(req)
    _bid_ok(bid)
    role = need(req, bid, "see")
    _sweep(bid)
    resume = req.q("resume")
    since = req.q("since")
    joined = False
    # sous le verrou des opérations : aucun lot ne passe entre ce que le flux rejoue
    # (les lots d'après `since`) et le moment où l'onglet reçoit les suivants
    with _ide()._lock:
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
            c.attached, c.lost, c.kicked, c.role = True, 0.0, "", role
            c.poll, c.polled = poll, time.time()
            if poll:
                c.events = []   # la reprise rejoue ce qui manque : la file d'avant ne ferait que doubler
            others = [x.public() for x in conns.values() if x is not c]
        ops, replay = _ops_hello(bid, since)
    with c.cond:   # l'ancien flux d'une reprise se retire aussitôt
        c.cond.notify_all()
    with _mlock:   # des copies : un retrait concurrent ne change pas un message pendant qu'on l'écrit
        hist = _history(bid)
        msgs, total = [dict(m) for m in hist[-LIMITS["history"]:]], len(hist)
    hello = {"cid": c.cid, "resumed": not joined, "board": bid, "poll": poll,
             "me": {"id": c.uid, "name": c.name, "color": c.color, "admin": c.admin, "role": role}, "can": can_of(role, bid),
             "peers": others, "messages": msgs, "total": total,
             "limits": {k: LIMITS[k] for k in ("call", "msg_len", "history", "sel")},
             "ice": config.get("ideation_ice_servers") or [], "t": time.time(), "ops": ops}
    if joined:
        _broadcast(bid, _sse("join", c.public()), exclude=c.cid)
        auth.journal("idéation · entre", user=c.uid, board=bid, cid=c.cid, **({"mode": "interrogation"} if poll else {}))
    else:
        _changed(c)
    return c, gen, hello, replay


# ── sans flux : l'interrogation longue ──────────────────────
# Le tunnel rapide de la démo ne passe pas les flux (« Quick Tunnels do not
# support Server-Sent Events (SSE) », docs/etudes/cloudflare.md § 3.1) : la page
# demande alors « ce qui s'est passé depuis », et le serveur tient la question
# jusqu'à 20 s ou jusqu'au premier événement (une réponse ordinaire, entière). Les
# mêmes événements, dans le même ordre ; un onglet qui ne demande plus depuis
# POLL_LOST_S est « coupé » pour les autres, puis part après GRACE_S.
POLL_WAIT_S = 20.0
POLL_LOST_S = 8.0


def _unsse(raw: bytes):
    ev, data = "message", []
    for line in raw.decode("utf-8").split("\n"):
        if line.startswith("event:"):
            ev = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].strip())
    return [ev, json.loads("\n".join(data))] if data else None


def r_poll(req, bid):
    u = _user(req)
    try:
        wait = max(0.0, min(POLL_WAIT_S, float(req.q("wait", str(POLL_WAIT_S)))))
    except ValueError as e:
        raise HttpError(400, "wait : des secondes") from e
    resume = req.q("resume")
    with _lock:
        c = _boards.get(bid, {}).get(resume) if resume else None
    if c is None or not c.poll or c.uid != u["id"] or c.sess != getattr(req, "session", None) or c.kicked:
        c, gen, hello, replay = _attach(req, bid, poll=True)
        return {"cid": c.cid, "events": [["hello", hello]] + [["op", json.loads(raw)] for raw in replay]}
    _bid_ok(bid)
    need(req, bid, "see")
    _sweep(bid)
    c.polled = time.time()
    if not c.attached:
        with _lock:
            c.attached, c.lost = True, 0.0
        _changed(c)
    end = time.time() + wait
    with c.cond:
        while not c.events and not c.dirty and not c.kicked and time.time() < end:
            c.cond.wait(min(1.0, max(0.01, end - time.time())))
            c.polled = time.time()   # la question tenue compte : l'onglet est là
    # ce qui arrive dans les 40 ms part avec (comme le flux : au plus ~25 réponses par seconde)
    if wait and not c.kicked:
        time.sleep(PRESENCE_GAP_S)
    with c.cond:
        evs, c.events = c.events, []
        dirty, c.dirty = c.dirty, set()
        kicked = c.kicked
    c.polled = time.time()
    out = [x for x in (_unsse(raw) for raw in evs) if x]
    if dirty:
        with _lock:
            cur = _boards.get(bid, {})
            states = [cur[x].public() for x in dirty if x in cur]
        if states:
            out.append(["p", states])
    if kicked:
        out.append(["bye", {"why": kicked}])
    # une présence acceptée par interrogation ne va pas au journal non plus (r_presence)
    req.protected = False
    return {"cid": c.cid, "events": out}


def r_stream(req, bid):
    c, gen, hello, replay = _attach(req, bid)
    sock = getattr(getattr(req, "_h", None), "connection", None)

    def chunks():
        # bonjour, puis les lots manqués, dans l'ordre (ceux qui arrivent ensuite suivent dans la file)
        yield b"retry: 3000\n\n" + _sse("hello", hello) + b"".join(_op_bytes(raw) for raw in replay)
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
    if "lead" in d:
        upd["lead"] = bool(d["lead"])   # « suivez-moi » : les autres suivent sa vue
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
    need(req, bid, "see")
    with _mlock:
        h = _history(bid)
        return {"messages": [dict(m) for m in h[-LIMITS["history"]:]], "total": len(h)}


def r_post(req, bid):
    u = _user(req)
    _bid_ok(bid)
    need(req, bid, "comment")
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
    need(req, bid, "see")
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


# ── la co-édition : des opérations par objet et par propriété ─────────────
# L'étude, § 5. Figma, « How Figma's multiplayer technology works » (2019) :
# « Figma's multiplayer servers keep track of the latest value that any client
# has sent for a given property on a given object » ; « similar to a
# last-writer-wins register in CRDT literature except we don't need a
# timestamp because the server can define the order of events ».
#
# Les opérations (t : n un objet, l un lien, b la planche) :
#   {o: add, t, v}         poser un objet entier (déjà là : remplacé, un renvoi ne double rien)
#   {o: del, t, id}        retirer ; un objet retire ses liens
#   {o: set, t, id, k, v}  une propriété (`v` absent : la retirer) ; k = geo : {x, y, w, h}
#                          d'un objet, k = ends : {a, b, pa, pb} d'un lien (un geste ne se
#                          mélange pas) ; un objet absent : ignoré (le retrait gagne)
#   {o: set, t: b, k: name, v}
#   {o: set, t: b, k: pres, v}   le design de la présentation (ideation._pres ; `v` absent : les défauts)
#   {o: ord, t, ids}       l'ordre (l'empilement, l'ordre des fils) tel que la page le voit :
#                          ce qu'elle ne connaissait pas reste après son voisin d'avant
# Chaque lot devient un événement `op` : {rev, sid, n, user, name, ops (acceptées,
# normalisées), fx (ce que le serveur en déduit et que tous appliquent : un groupe
# dissous, un ajout refusé retiré, un objet remis tel qu'il est), drop, order,
# lorder (l'ordre complet, quand il a pu changer)}.
OPS_LOG = 4000          # les derniers lots gardés en mémoire par planche (reprise, trous)
OPS_LOG_BYTES = 16 << 20   # … et 16 Mo au plus (un collage de 200 cartes pèse)
OPS_MAX = 5000          # opérations par lot
OPS_BYTES = 8 << 20     # un lot (un collage de 200 cartes tient)
OPS_WRITE_S = 0.8       # un geste en cours (déplacer) s'écrit au plus toutes les 0,8 s
OPS_IDLE_S = 600.0      # une planche sans opération ni onglet depuis 10 min quitte la mémoire
OPS_RATE = 40           # lots par seconde et par onglet (la page en envoie 20 au plus)
SID = re.compile(r"[A-Za-z0-9_-]{8,40}")
GEO = ("x", "y", "w", "h")
ENDS = ("a", "b", "pa", "pb")

_hot: dict[str, dict] = {}
_tl = threading.local()


class _Drop(Exception):
    """Une opération écartée (`why`) ; `fix` : les objets (t, id) à remettre chez
    tous tels que le serveur les a (présents : remplacés, absents : retirés)."""

    def __init__(self, why: str, *fix) -> None:
        super().__init__(why)
        self.why = why
        self.fix = fix


def _ide():
    from tools import ideation
    return ideation


def _op_bytes(raw: str) -> bytes:
    return f"event: op\ndata: {raw}\n\n".encode()


def _hot_get(bid: str) -> dict:
    """La planche tenue en mémoire, chargée au premier besoin (sous ideation._lock)."""
    h = _hot.get(bid)
    if h is None:
        ide = _ide()
        b = ide.normalize(ide.load(bid))
        b["rev"] = int(b.get("rev") or 1)
        h = {"b": b, "n": {x["id"]: x for x in b["nodes"]}, "l": {x["id"]: x for x in b["links"]},
             "log": deque(maxlen=OPS_LOG), "logb": 0, "seen": {}, "rate": {}, "dirty": False, "timer": None, "used": 0.0}
        _hot[bid] = h
        _hot_sweep(bid)
    h["used"] = time.time()
    return h


def _hot_sweep(keep: str) -> None:
    now = time.time()
    with _lock:
        busy = {b for b, c in _boards.items() if c}
    for bid in [b for b, h in _hot.items() if b != keep and not h["dirty"] and b not in busy and now - h["used"] > OPS_IDLE_S]:
        _hot.pop(bid, None)


def _hot_write(bid: str, h: dict) -> None:
    ide = _ide()
    if h.get("timer"):
        h["timer"].cancel()
        h["timer"] = None
    if not h["dirty"]:
        return
    if not ide._path(bid).exists():   # la planche est partie à la corbeille : rien ne la recrée
        _hot.pop(bid, None)
        return
    h["b"]["updated"] = library.now()
    _tl.ops = True
    try:
        ide._write(h["b"])
    finally:
        _tl.ops = False
    h["dirty"] = False


def _hot_later(bid: str, h: dict) -> None:
    if h.get("timer"):
        return

    def run():
        with _ide()._lock:
            if _hot.get(bid) is h:
                h["timer"] = None
                _hot_write(bid, h)
    t = threading.Timer(OPS_WRITE_S, run)
    t.daemon = True
    h["timer"] = t
    t.start()


def hot_flush(bid: str) -> None:
    """Appelé par ideation.load : ce que les opérations ont changé part d'abord
    sur le disque (l'export, l'enregistrement entier, la copie lisent le vrai)."""
    h = _hot.get(bid)
    if h is None or not h["dirty"]:
        return
    with _ide()._lock:
        if _hot.get(bid) is h:
            _hot_write(bid, h)


def hot_forget(b: dict) -> None:
    """Appelé par ideation._write : une planche écrite entière ailleurs
    (l'enregistrement de repli, renommer) devient la vérité ; la copie en
    mémoire s'efface et les onglets reliés se recalent (`reset`)."""
    if getattr(_tl, "ops", False):
        return
    bid = str(b.get("id") or "")
    h = _hot.pop(bid, None)
    if h and h.get("timer"):
        h["timer"].cancel()
    with _lock:
        here = bool(_boards.get(bid))
    if here:
        _broadcast(bid, _sse("reset", {"board": bid, "rev": b.get("rev")}))


def _since(h: dict, since: int):
    """Les lots d'après `since` (JSON), ou None si la mémoire ne remonte pas jusque-là."""
    rev = h["b"]["rev"]
    if since >= rev:
        return []
    log = h["log"]
    if not log or log[0][0] > since + 1:
        return None
    return [raw for r, raw in log if r > since]


def _ops_hello(bid: str, since: str):
    """Ce que `hello` dit de la planche, et les lots à rejouer (sous ideation._lock)."""
    h = _hot_get(bid)
    rev = h["b"]["rev"]
    if not since:
        return {"rev": rev}, []
    try:
        s = int(since)
    except ValueError:
        return {"rev": rev, "reset": True}, []
    evs = _since(h, s)
    return {"rev": rev, "reset": evs is None}, evs or []


def _merge(want: list, have: list) -> list:
    """L'ordre voulu par une page (`want`) sur ce que le serveur a (`have`) : ce
    qui n'existe plus tombe ; ce qu'elle ne connaissait pas (posé entre-temps
    par un autre) reste juste après son voisin d'avant."""
    hs = set(have)
    out, seen = [], set()
    for x in want:
        if x in hs and x not in seen:
            out.append(x)
            seen.add(x)
    if len(out) == len(have):
        return out
    after: dict = {}
    prev = None
    for x in have:
        if x in seen:
            prev = x
        else:
            after.setdefault(prev, []).append(x)
    res = list(after.get(None, []))
    for x in out:
        res.append(x)
        res.extend(after.get(x, []))
    return res


def _link(ide, h: dict, lk, lid_self: str | None = None) -> dict:
    """Un lien validé comme ideation.normalize le ferait, contre la planche en mémoire."""
    if not isinstance(lk, dict):
        raise HttpError(400, "un lien est un objet JSON")
    lid = str(lk.get("id", ""))
    if not ide.NID.fullmatch(lid):
        raise HttpError(400, "lien sans identifiant valide")
    a, z = str(lk.get("a", "")), str(lk.get("b", ""))
    N = h["n"]
    if a not in N or z not in N:
        raise _Drop("absent", ("l", lid))   # un bout retiré entre-temps : le retrait gagne
    if a == z:
        raise HttpError(400, "un lien relie deux objets")
    kind = lk.get("kind") if lk.get("kind") in ide.LINK_KINDS else "arrow"
    out = {"id": lid, "a": a, "b": z, "kind": kind, "label": ide._s(lk.get("label"), 120)}
    if kind == "wire":
        pa, pb = str(lk.get("pa", "")), str(lk.get("pb", ""))
        if not ide.PORT.fullmatch(pa) or not ide.PORT.fullmatch(pb):
            raise HttpError(400, "fil sans sortie ou entrée valide")
        out.update(pa=pa, pb=pb)
        for o in h["b"]["links"]:
            if o["id"] != lid and o["kind"] == "wire" and (o["a"], o.get("pa"), o["b"], o.get("pb")) == (a, pa, z, pb):
                raise _Drop("double", ("l", lid))
    elif kind == "out" and str(lk.get("lot", "")) in N and N[str(lk["lot"])]["type"] == "frame":
        out["lot"] = lk["lot"]
    if kind in ("arrow", "line") and lk.get("dash") is True:
        out["dash"] = True        # une annotation en pointillé : comme ideation.normalize
    return out


def _result_twice(h: dict, lk: dict, added: set) -> bool:
    """Un résultat de travail posé deux fois : deux onglets ont suivi le même
    travail (gen.js, resume) et posent chacun l'image, reliée `out` à sa carte.
    Le premier arrivé reste."""
    N = h["n"]
    m = N.get(lk["b"])
    if lk["kind"] != "out" or lk["b"] not in added or not m or m["type"] != "media":
        return False
    for o in h["b"]["links"]:
        if o["kind"] == "out" and o["a"] == lk["a"] and o["b"] != lk["b"]:
            m2 = N.get(o["b"])
            if m2 and m2["type"] == "media" and m2.get("item") == m.get("item"):
                return True
    return False


# ── des registres fins (29/09) ──────────────────────────────
# Un registre entier par propriété était trop gros pour deux cas : les cases d'un
# composeur (une seule liste : deux personnes dans deux cases s'écrasaient) et le
# texte d'une note (deux personnes dans la même note : la dernière frappe
# emportait tout). Le composeur a donc un registre par case (`s:<case>` : la case
# sans son texte ; `t:<case>` : son texte) et un pour leur ordre (`slots#`, fusionné
# comme l'ordre des objets). Un texte libre (TEXT_KEYS, et `t:<case>`) porte en plus
# `b`, la valeur que la page avait sous les yeux : le serveur fusionne alors sa
# modification avec celles arrivées entre-temps (merge_text) ; seules deux
# modifications du même passage se départagent encore au dernier écrit.
TEXT_KEYS = {"n": ("text", "prompt", "name", "title", "sound", "music"), "l": ("label",)}
SLOT_KEY = re.compile(r"([st]):([A-Za-z0-9_-]{1,40})")


def _region(a: str, b: str) -> tuple[int, int, str]:
    """Le passage de `a` que `b` remplace : a[i:j] → le texte rendu (préfixe et suffixe communs ôtés)."""
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    j = 0
    while j < n - i and a[len(a) - 1 - j] == b[len(b) - 1 - j]:
        j += 1
    return i, len(a) - j, b[i:len(b) - j]


def merge_text(base, theirs: str, mine: str) -> str:
    """Une fusion à trois (base : ce que la page avait ; theirs : le serveur à présent ;
    mine : la page) de deux modifications d'un seul passage chacune (une frappe, un
    collage, un effacement : la page envoie son texte 5 fois par seconde). Deux passages
    disjoints : les deux restent ; le même passage : le dernier écrit gagne."""
    if not isinstance(base, str) or not isinstance(theirs, str) or base == theirs or mine == theirs:
        return mine
    if mine == base:
        return theirs
    s1, e1, r1 = _region(base, theirs)
    s2, e2, r2 = _region(base, mine)
    if e1 <= s2:      # le leur avant le mien (à la même place : le premier arrivé d'abord)
        return base[:s1] + r1 + base[e1:s2] + r2 + base[e2:]
    if e2 <= s1:
        return base[:s2] + r2 + base[e2:s1] + r1 + base[e1:]
    return mine


def _set_slots(ide, cur: dict, k: str, op: dict) -> list:
    """Les cases d'un composeur après une opération sur `slots#`, `s:<case>` ou `t:<case>`."""
    if cur.get("type") != "compose":
        raise _Drop("invalide", ("n", cur["id"]))
    slots = [dict(s) for s in cur.get("slots") or []]
    if k == "slots#":
        ids = op.get("v")
        if not isinstance(ids, list) or len(ids) > ide.MAX_SLOTS * 4:
            raise _Drop("invalide", ("n", cur["id"]))
        byid = {s["id"]: s for s in slots}
        return [byid[i] for i in _merge([str(x) for x in ids], [s["id"] for s in slots])]
    kind, sid = SLOT_KEY.fullmatch(k).groups()
    at = next((i for i, s in enumerate(slots) if s["id"] == sid), None)
    if kind == "t":
        if at is None:
            raise _Drop("absent")          # la case retirée avant : le retrait gagne
        v = op.get("v", "")
        if not isinstance(v, str):
            raise _Drop("invalide", ("n", cur["id"]))
        slots[at]["text"] = merge_text(op.get("b"), slots[at].get("text", ""), v)
        return slots
    if "v" not in op:
        if at is not None:
            slots.pop(at)
        return slots
    v = op["v"]
    if not isinstance(v, dict):
        raise _Drop("invalide", ("n", cur["id"]))
    new = {**{x: y for x, y in v.items() if x not in ("id", "text")}, "id": sid,
           "text": slots[at].get("text", "") if at is not None else ""}
    if at is None:
        slots.append(new)
    else:
        slots[at] = new
    return slots


def _posable(B: dict, obj: dict, cur: dict | None, fix) -> None:
    """Les identifiants qu'une opération pose de neuf sur la planche (ID_FIELDS, ceux
    que l'objet n'avait pas) : chacun est du Workspace de la planche, et aucun élément
    n'y entre dans sa propre descendance — le garde des enregistrements
    (elements.check_doc), opération par opération : l'opération est écartée, avec la
    phrase qui dit lequel et mène au rapatriement, rien d'autre du lot ne bouge."""
    from tools import elements
    new = {x for x, _ in elements.ids_in("ide", {"nodes": [obj]})}
    if cur:
        new -= {x for x, _ in elements.ids_in("ide", {"nodes": [cur]})}
    if not new:
        return
    bid = str(B.get("id") or "")
    try:
        elements.check_space(bid, {"nodes": [obj]}, _ide().board_space(bid) or B.get("space"), only=new)
        elements.check_loops(bid, [i for i in node_items(obj) if i in new])
    except HttpError as e:
        raise _Drop(e.message, fix) from e


def _one(ide, h: dict, op, added: set, allowed=None):
    """Applique une opération ; rend sa forme normalisée (None : sans effet).
    `allowed` : pour un invité, les objets de la bibliothèque qu'il peut poser."""
    if not isinstance(op, dict):
        raise _Drop("invalide")
    o, t = op.get("o"), op.get("t")
    B = h["b"]
    if t == "b":
        if o == "set" and op.get("k") == "name":
            B["name"] = ide._s(op.get("v"), 120).strip() or "Sans titre"
            return {"o": "set", "t": "b", "k": "name", "v": B["name"]}
        if o == "set" and op.get("k") == "pres":
            # le design de la présentation (les styles de texte) : un registre de la planche
            pres = ide._pres(op.get("v"))
            if pres:
                B["pres"] = pres
                return {"o": "set", "t": "b", "k": "pres", "v": pres}
            B.pop("pres", None)
            return {"o": "set", "t": "b", "k": "pres"}
        raise _Drop("invalide")
    if t not in ("n", "l"):
        raise _Drop("invalide")
    coll, idx = (B["nodes"], h["n"]) if t == "n" else (B["links"], h["l"])
    if o == "ord":
        ids = op.get("ids")
        if not isinstance(ids, list) or len(ids) > len(coll) + OPS_MAX:
            raise _Drop("invalide")
        coll[:] = [idx[i] for i in _merge([str(x) for x in ids], [x["id"] for x in coll])]
        return {"o": "ord", "t": t}
    if o == "add":
        v = op.get("v")
        oid = str(v.get("id", "")) if isinstance(v, dict) else ""
        fix = (t, oid) if NID.fullmatch(oid) else None
        try:
            obj = ide._node(v) if t == "n" else _link(ide, h, v)
        except HttpError as e:
            raise _Drop("invalide", *([fix] if fix else [])) from e
        if allowed is not None and t == "n" and node_items(obj) - node_items(idx.get(obj["id"]) or {}) - allowed:
            raise _Drop("invité", fix)       # un objet de la bibliothèque qu'on ne lui a pas montré
        if t == "n":
            _posable(B, obj, idx.get(obj["id"]), fix)
        cur = idx.get(obj["id"])
        if cur is not None:              # un renvoi, ou l'annulation d'un retrait déjà rejoué
            cur.clear()
            cur.update(obj)
            return {"o": "add", "t": t, "v": cur}
        if len(coll) >= (ide.MAX_NODES if t == "n" else ide.MAX_LINKS):
            raise _Drop("plafond", fix)
        if t == "l" and _result_twice(h, obj, added):
            gone = obj["b"]
            B["nodes"][:] = [x for x in B["nodes"] if x["id"] != gone]
            h["n"].pop(gone, None)
            B["links"][:] = [x for x in B["links"] if x["a"] != gone and x["b"] != gone]
            h["l"] = {x["id"]: x for x in B["links"]}
            raise _Drop("déjà posé", ("n", gone), fix)
        coll.append(obj)
        idx[obj["id"]] = obj
        if t == "n":
            added.add(obj["id"])
        return {"o": "add", "t": t, "v": obj}
    oid = str(op.get("id") or "")
    cur = idx.get(oid)
    if o == "del":
        if cur is None:
            return None
        coll[:] = [x for x in coll if x is not cur]
        del idx[oid]
        if t == "n":   # ses liens partent avec lui (les pages font de même en l'appliquant)
            B["links"][:] = [x for x in B["links"] if x["a"] != oid and x["b"] != oid]
            h["l"] = {x["id"]: x for x in B["links"]}
        return {"o": "del", "t": t, "id": oid}
    if o == "set":
        if cur is None:
            raise _Drop("absent")        # retiré avant : le retrait gagne
        k = str(op.get("k") or "")
        if k in ("", "id", "type"):
            raise _Drop("invalide", (t, oid))
        trial = dict(cur)
        group = GEO if (t, k) == ("n", "geo") else ENDS if (t, k) == ("l", "ends") else None
        slot = t == "n" and (k == "slots#" or SLOT_KEY.fullmatch(k))
        if group:
            v = op.get("v")
            if not isinstance(v, dict):
                raise _Drop("invalide", (t, oid))
            keys = [g for g in group if g in v]
            trial.update({g: v[g] for g in keys})
        elif slot:
            trial["slots"] = _set_slots(ide, cur, k, op)
        elif "v" in op:
            v = op["v"]
            if k in TEXT_KEYS.get(t, ()) and isinstance(v, str):
                v = merge_text(op.get("b"), cur.get(k), v)
            trial[k] = v
        else:
            trial.pop(k, None)
        try:
            obj = ide._node(trial) if t == "n" else _link(ide, h, trial)
        except HttpError as e:
            raise _Drop("invalide", (t, oid)) from e
        if allowed is not None and t == "n" and node_items(obj) - node_items(cur) - allowed:
            raise _Drop("invité", (t, oid))
        if t == "n":
            _posable(B, obj, cur, (t, oid))
        cur.clear()
        cur.update(obj)
        out = {"o": "set", "t": t, "id": oid, "k": k}
        if group:
            out["v"] = {g: cur[g] for g in keys if g in cur}
        elif k == "slots#":
            out["v"] = [s["id"] for s in cur.get("slots", [])]
        elif slot:
            kind, sid = SLOT_KEY.fullmatch(k).groups()
            s = next((x for x in cur.get("slots", []) if x["id"] == sid), None)
            if s is not None:    # absente (retirée, ou au-delà du plafond) : la retirer partout
                out["v"] = s["text"] if kind == "t" else {x: y for x, y in s.items() if x != "text"}
        elif k in cur:
            out["v"] = cur[k]
        return out
    raise _Drop("invalide")


def _structure(ide, h: dict, fx: list) -> None:
    """Les règles des groupes (ideation._groups, les mêmes que la page) après un
    lot : un groupe de moins de deux enfants se dissout, une appartenance vers
    un groupe absent tombe. Ce qui en change part dans `fx`."""
    B = h["b"]
    before = {x["id"]: (x.get("group"), x.get("parent")) for x in B["nodes"]}
    kept, gone = ide._groups(B["nodes"])
    for x in kept:
        g, p = before[x["id"]]
        for k, old in (("group", g), ("parent", p)):
            if x.get(k) != old:
                fx.append({"o": "set", "t": "n", "id": x["id"], "k": k, **({"v": x[k]} if k in x else {})})
    if gone:
        B["nodes"][:] = kept
        for gid in gone:
            h["n"].pop(gid, None)
            fx.append({"o": "del", "t": "n", "id": gid})
        B["links"][:] = [x for x in B["links"] if x["a"] not in gone and x["b"] not in gone]
        h["l"] = {x["id"]: x for x in B["links"]}


def _apply(bid: str, h: dict, ops: list, sid: str, n: int, u: dict) -> list:
    """Un lot : chaque opération dans l'ordre, les règles de structure, un numéro,
    le journal des lots, et l'événement à tous (sous ideation._lock). Rend les
    opérations écartées ([{i, why}]), que la réponse redit à qui les a envoyées."""
    ide = _ide()
    B = h["b"]
    acc, fx, drop, fixes = [], [], [], []
    added: set = set()
    order_n = order_l = struct = False
    allowed = auth.guest_items(u) if auth.is_guest(u) else None
    for i, op in enumerate(ops):
        try:
            r = _one(ide, h, op, added, allowed)
        except _Drop as e:
            drop.append({"i": i, "why": e.why})
            fixes.extend(f for f in e.fix if f)
            continue
        if r is None:
            continue
        acc.append(r)
        if r["o"] != "set" or r.get("k") not in ("geo",):
            struct = True
        if r["t"] == "n" and r["o"] in ("add", "ord"):
            order_n = True
        if r["t"] == "l" and r["o"] in ("add", "ord"):
            order_l = True
    if struct or fixes:
        _structure(ide, h, fx)
    for t, oid in dict.fromkeys(fixes):
        cur = (h["n"] if t == "n" else h["l"]).get(oid)
        fx.append({"o": "put", "t": t, "v": cur} if cur is not None else {"o": "del", "t": t, "id": oid})
    B["rev"] = int(B.get("rev") or 1) + 1
    ev = {"rev": B["rev"], "sid": sid, "n": n, "user": u["id"], "name": u.get("name") or u["id"], "ops": acc, "fx": fx}
    if drop:
        ev["drop"] = drop
    if order_n:
        ev["order"] = [x["id"] for x in B["nodes"]]
    if order_l:
        ev["lorder"] = [x["id"] for x in B["links"]]
    raw = json.dumps(ev, ensure_ascii=False, separators=(",", ":"))
    log = h["log"]
    if len(log) == log.maxlen:
        h["logb"] -= len(log[0][1])
    log.append((B["rev"], raw))
    h["logb"] = h.get("logb", 0) + len(raw)
    while h["logb"] > OPS_LOG_BYTES and len(log) > 1:
        h["logb"] -= len(log.popleft()[1])
    h["dirty"] = True
    _broadcast(bid, _op_bytes(raw))
    return drop


def r_ops(req, bid):
    u = _user(req)
    _bid_ok(bid)
    need(req, bid, "edit")        # un spectateur ne modifie rien, même en passant par ici
    d = _small(req, OPS_BYTES)
    sid = str(d.get("sid") or "")
    if not SID.fullmatch(sid):
        raise HttpError(400, "sid invalide")
    try:
        n = int(d.get("n"))
    except (TypeError, ValueError) as e:
        raise HttpError(400, "n : un entier") from e
    ops = d.get("ops")
    if n < 1 or not isinstance(ops, list) or len(ops) > OPS_MAX:
        raise HttpError(400, f"un lot : une liste de {OPS_MAX} opérations au plus")
    live = bool(d.get("live"))
    now = time.time()
    with _ide()._lock:
        h = _hot_get(bid)
        t0, tokens = h["rate"].get(sid, (now, float(OPS_RATE)))
        tokens = min(float(OPS_RATE), tokens + (now - t0) * OPS_RATE)
        if tokens < 1:
            h["rate"][sid] = (now, tokens)
            raise HttpError(429, "trop de gestes à la fois")
        h["rate"][sid] = (now, tokens - 1)
        dup = n <= h["seen"].get(sid, 0)     # un renvoi (réponse perdue) : déjà appliqué
        drop = []
        if not dup:
            drop = _apply(bid, h, ops, sid, n, u)
            h["seen"].pop(sid, None)
            h["seen"][sid] = n
            while len(h["seen"]) > 512:
                h["seen"].pop(next(iter(h["seen"])))
            while len(h["rate"]) > 512:
                h["rate"].pop(next(iter(h["rate"])))
        rev = h["b"]["rev"]
        if live:
            _hot_later(bid, h)
        else:
            _hot_write(bid, h)
    # un geste en cours (jusqu'à 20 lots par seconde) ne noie pas le journal des
    # écritures ; le lot qui le termine, et tout le reste, y sont (voir r_presence)
    if live:
        req.protected = False
    out = {"ok": True, "rev": rev, "dup": dup}
    if drop:   # les opérations écartées, et pourquoi (un objet d'un autre Workspace : la phrase qui mène au rapatriement)
        out["drop"] = drop
    return out


def r_ops_since(req, bid):
    _user(req)
    _bid_ok(bid)
    need(req, bid, "see")
    try:
        since = int(req.q("since", "0"))
    except ValueError as e:
        raise HttpError(400, "since : un entier") from e
    with _ide()._lock:
        h = _hot_get(bid)
        evs = _since(h, since)
        rev = h["b"]["rev"]
    return {"rev": rev, "reset": evs is None, "events": [json.loads(x) for x in evs or []]}


def register(app) -> None:
    # l'invité : ce qu'Idéation lui ouvre (core/auth.py, guest_realm), et où le mener
    auth.guest_realm("ideation", routes=GUEST_ROUTES, pages=("/ideation/",), items=guest_items, home=_guest_home)
    app.route("GET", auth.GUEST_HOME, auth.r_guest_home)
    app.route("HEAD", auth.GUEST_HOME, auth.r_guest_home)
    app.route("GET", "/api/ideation/collab/{bid}", r_state)
    app.route("POST", "/api/ideation/collab/{bid}/ops", r_ops)
    app.route("GET", "/api/ideation/collab/{bid}/ops", r_ops_since)
    app.route("GET", "/api/ideation/collab/{bid}/access", r_access)
    app.route("POST", "/api/ideation/collab/{bid}/access", r_access_set)
    app.route("POST", "/api/ideation/collab/{bid}/invites", r_invite)
    app.route("POST", "/api/ideation/collab/{bid}/invites/{iid}/revoke", r_invite_revoke)
    # sous /api/auth/ : la porte y laisse passer une session qui attend (core/auth.py, gate)
    app.route("POST", "/api/auth/ideation-invite/{tok}", r_redeem)
    app.route("GET", "/api/ideation/collab/{bid}/stream", r_stream)
    app.route("GET", "/api/ideation/collab/{bid}/poll", r_poll)
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
    _selftest_ops(call, ok)
    _selftest_roles(call, ok)
    _selftest_registres(call, ok)
    _selftest_invite(call, ok)


def _selftest_ops(call, ok) -> None:
    """La co-édition (l'étude, § 5) : deux onglets, des lots d'opérations ; le dernier
    écrit gagne propriété par propriété, le retrait gagne, l'ordre se fusionne, un renvoi
    ne double rien, un trou se relit, une écriture entière recale tout le monde."""
    ide = _ide()
    st, b = call("POST", "/api/ideation/boards", {"name": "Essai co-édition"})
    bid = b.get("id", "")
    base = f"/api/ideation/collab/{bid}"
    nodes = [{"id": "n1", "type": "note", "x": 0, "y": 0, "w": 200, "h": 80, "text": "un"},
             {"id": "s1", "type": "sticky", "x": 300, "y": 0, "w": 190, "h": 150, "text": "deux", "color": "coral-3"},
             {"id": "m1", "type": "media", "item": "ima-20260101-000000-abcd", "kind": "image", "x": 0, "y": 300, "w": 200, "h": 150}]
    st, sv = call("POST", f"/api/ideation/boards/{bid}", {"name": "Essai co-édition", "nodes": nodes,
                                                         "links": [{"id": "l1", "a": "n1", "b": "s1", "kind": "arrow"}], "base_rev": 1})
    rev0 = sv.get("rev", 0)
    fa, fb = _Flux(f"{base}/stream?since={rev0}"), _Flux(f"{base}/stream?since={rev0}")
    try:
        _, ha = fa.wait(lambda e, d: e == "hello")
        _, hb = fb.wait(lambda e, d: e == "hello")
        ok(ha and hb and ha["ops"] == {"rev": rev0, "reset": False} and ha["me"]["role"] == "owner" and ha["can"]["edit"],
           f"co-édition : le flux dit la version de la planche et le rôle ({ha and ha.get('ops')})")
        A = lambda n, ops, **kw: call("POST", f"{base}/ops", {"sid": "sid-aaaaaaaa", "n": n, "ops": ops, **kw})   # noqa: E731
        B = lambda n, ops, **kw: call("POST", f"{base}/ops", {"sid": "sid-bbbbbbbb", "n": n, "ops": ops, **kw})   # noqa: E731
        node = lambda i: next((x for x in call("GET", f"/api/ideation/boards/{bid}")[1]["nodes"] if x["id"] == i), None)   # noqa: E731

        # deux propriétés du même objet en même temps : les deux gagnent
        s1_, r1 = A(1, [{"o": "set", "t": "n", "id": "n1", "k": "geo", "v": {"x": 120, "y": 40}}])
        s2_, r2 = B(1, [{"o": "set", "t": "n", "id": "n1", "k": "text", "v": "écrit par B"}])
        ok(s1_ == 200 and s2_ == 200 and r1["rev"] == rev0 + 1 and r2["rev"] == rev0 + 2, f"co-édition : deux lots, deux numéros ({r1} {r2})")
        _, e1 = fb.wait(lambda e, d: e == "op" and d["sid"] == "sid-aaaaaaaa")
        ok(e1 and e1["rev"] == rev0 + 1 and e1["ops"] == [{"o": "set", "t": "n", "id": "n1", "k": "geo", "v": {"x": 120.0, "y": 40.0}}],
           f"co-édition : B reçoit le déplacement de A par le flux ({e1})")
        _, e2 = fa.wait(lambda e, d: e == "op" and d["sid"] == "sid-bbbbbbbb")
        ok(e2 and e2["rev"] == rev0 + 2, "co-édition : A reçoit le texte de B, dans l'ordre")
        n1 = node("n1")
        ok(n1 and n1["x"] == 120 and n1["y"] == 40 and n1["text"] == "écrit par B", f"co-édition : deux propriétés d'un objet, les deux gagnent ({n1})")
        # la même propriété : le dernier arrivé gagne
        A(2, [{"o": "set", "t": "n", "id": "s1", "k": "color", "v": "amb"}])
        B(2, [{"o": "set", "t": "n", "id": "s1", "k": "color", "v": "cy"}])
        ok((node("s1") or {}).get("color") == "cy", "co-édition : la même propriété, le dernier écrit gagne")
        # les diapositives : le design de la présentation est un registre de la planche (borné comme l'enregistrement)
        s_p, _ = call("POST", f"{base}/ops", {"sid": "sid-cccccccc", "n": 1, "ops": [{"o": "set", "t": "b", "k": "pres", "v": {"styles": {"h1": {"size": 88, "font": "inconnue"}}}}]})
        _, ep = fb.wait(lambda e, d: e == "op" and d["sid"] == "sid-cccccccc")
        st, got = call("GET", f"/api/ideation/boards/{bid}")
        ok(s_p == 200 and got.get("pres") == {"styles": {"h1": {"size": 88.0}}} and ep and ep["ops"] == [{"o": "set", "t": "b", "k": "pres", "v": {"styles": {"h1": {"size": 88.0}}}}],
           f"co-édition : les styles de la présentation passent par le flux, bornés ({got.get('pres')})")
        call("POST", f"{base}/ops", {"sid": "sid-cccccccc", "n": 2, "ops": [{"o": "set", "t": "b", "k": "pres"}]})
        ok("pres" not in call("GET", f"/api/ideation/boards/{bid}")[1], "co-édition : des styles retirés, la planche revient aux défauts")
        # le retrait gagne : A retire s1 (son lien part avec lui), B le modifie ensuite
        A(3, [{"o": "del", "t": "n", "id": "s1"}])
        B(3, [{"o": "set", "t": "n", "id": "s1", "k": "text", "v": "trop tard"}])
        _, eb = fa.wait(lambda e, d: e == "op" and d["sid"] == "sid-bbbbbbbb" and d["n"] == 3)
        st, got = call("GET", f"/api/ideation/boards/{bid}")
        ok(eb and eb["ops"] == [] and eb.get("drop") == [{"i": 0, "why": "absent"}] and not any(x["id"] == "s1" for x in got["nodes"])
           and not got["links"], f"co-édition : un objet retiré l'emporte sur une modification ({eb and eb.get('drop')})")
        # l'ordre : A pose x1 dessous (en tête), B pose x2 sans connaître x1
        A(4, [{"o": "add", "t": "n", "v": {"id": "x1", "type": "note", "x": 0, "y": 0, "w": 100, "h": 40, "text": "a"}},
              {"o": "ord", "t": "n", "ids": ["x1", "n1", "m1"]}])
        B(4, [{"o": "add", "t": "n", "v": {"id": "x2", "type": "note", "x": 0, "y": 0, "w": 100, "h": 40, "text": "b"}},
              {"o": "ord", "t": "n", "ids": ["m1", "n1", "x2"]}])
        _, eo = fa.wait(lambda e, d: e == "op" and d["sid"] == "sid-bbbbbbbb" and d["n"] == 4)
        st, got = call("GET", f"/api/ideation/boards/{bid}")
        order = [x["id"] for x in got["nodes"]]
        ok(order == ["x1", "m1", "n1", "x2"] and eo and eo.get("order") == order,
           f"co-édition : deux ordres se fusionnent, ce que l'autre ne connaissait pas reste à sa place ({order})")
        # un renvoi (réponse perdue) ne double rien
        st, dup = B(4, [{"o": "add", "t": "n", "v": {"id": "x3", "type": "note", "x": 0, "y": 0, "w": 100, "h": 40}}])
        ok(st == 200 and dup["dup"] and node("x3") is None, f"co-édition : un lot renvoyé n'est appliqué qu'une fois ({dup})")
        # des opérations invalides : écartées, et l'objet est remis chez tous tel que le serveur l'a
        A(5, [{"o": "add", "t": "n", "v": {"id": "z1", "type": "bombe"}}, {"o": "set", "t": "n", "id": "n1", "k": "type", "v": "media"},
              {"o": "set", "t": "n", "id": "n1", "k": "w", "v": 260}])
        _, ez = fb.wait(lambda e, d: e == "op" and d["sid"] == "sid-aaaaaaaa" and d["n"] == 5)
        fx = (ez or {}).get("fx", [])
        ok(ez and {"o": "del", "t": "n", "id": "z1"} in fx and any(f["o"] == "put" and f["v"]["id"] == "n1" and f["v"]["type"] == "note" for f in fx)
           and (node("n1") or {}).get("w") == 260, f"co-édition : une opération invalide est écartée, l'objet remis ({[f['o'] for f in fx]})")
        # deux onglets posent le même résultat d'un travail : le premier reste
        media = lambda i: {"id": i, "type": "media", "item": "ima-20260101-000000-beef", "kind": "image", "x": 500, "y": 0, "w": 100, "h": 100}   # noqa: E731
        A(6, [{"o": "add", "t": "n", "v": media("r1")}, {"o": "add", "t": "l", "v": {"id": "o1", "a": "n1", "b": "r1", "kind": "out"}}])
        B(6, [{"o": "add", "t": "n", "v": media("r2")}, {"o": "add", "t": "l", "v": {"id": "o2", "a": "n1", "b": "r2", "kind": "out"}}])
        _, er = fa.wait(lambda e, d: e == "op" and d["sid"] == "sid-bbbbbbbb" and d["n"] == 6)
        ok(node("r1") and node("r2") is None and er and {"o": "del", "t": "n", "id": "r2"} in er["fx"],
           "co-édition : un résultat posé deux fois (deux onglets suivaient le travail) ne reste qu'une fois")
        # les groupes : un groupe à qui on retire un enfant se dissout, chez tous
        A(7, [{"o": "add", "t": "n", "v": {"id": "g1", "type": "group", "x": 0, "y": 0, "w": 10, "h": 10, "name": "G"}},
              {"o": "set", "t": "n", "id": "x1", "k": "group", "v": "g1"}, {"o": "set", "t": "n", "id": "x2", "k": "group", "v": "g1"}])
        B(7, [{"o": "del", "t": "n", "id": "x2"}])
        _, eg = fa.wait(lambda e, d: e == "op" and d["sid"] == "sid-bbbbbbbb" and d["n"] == 7)
        ok(eg and {"o": "del", "t": "n", "id": "g1"} in eg["fx"] and {"o": "set", "t": "n", "id": "x1", "k": "group"} in eg["fx"]
           and node("g1") is None and "group" not in (node("x1") or {"group": 1}), f"co-édition : les règles des groupes suivent un retrait ({eg and eg['fx']})")
        # un geste en cours ne noie pas le journal ; le lot qui le termine y est
        jn = lambda: sum(1 for e in auth.journal_tail(1000) if e.get("event") == "http" and e.get("path", "").endswith(f"{bid}/ops"))   # noqa: E731
        time.sleep(0.3)   # le journal s'écrit après la réponse (auth.after)
        j0 = jn()
        A(8, [{"o": "set", "t": "n", "id": "n1", "k": "geo", "v": {"x": 130}}], live=True)
        time.sleep(0.3)
        j1 = jn()
        A(9, [{"o": "set", "t": "n", "id": "n1", "k": "geo", "v": {"x": 140}}])
        time.sleep(0.3)
        ok(j1 == j0 and jn() == j0 + 1, f"co-édition : un geste en cours hors du journal, sa fin dedans ({j0} {j1} {jn()})")
        disk = json.loads(ide._path(bid).read_text(encoding="utf-8"))
        ok(next(x for x in disk["nodes"] if x["id"] == "n1")["x"] == 140 and disk["rev"] == _hot[bid]["b"]["rev"],
           "co-édition : la planche est sur le disque dès la fin d'un geste")
        # un trou se relit ; trop ancien : se recaler
        st, gap = call("GET", f"{base}/ops?since={rev0 + 1}")
        ok(st == 200 and not gap["reset"] and gap["events"][0]["rev"] == rev0 + 2 and gap["events"][-1]["rev"] == gap["rev"],
           f"co-édition : les lots d'après une version se relisent ({st} {len(gap.get('events', []))})")
        f3 = _Flux(f"{base}/stream?since={rev0 + 3}")
        _, h3 = f3.wait(lambda e, d: e == "hello")
        _, first = f3.wait(lambda e, d: e == "op")
        f3.close()
        ok(h3 and not h3["ops"]["reset"] and first and first["rev"] == rev0 + 4, "co-édition : le flux rejoue d'abord ce qui manque")
        # sans flux (le tunnel rapide) : l'interrogation longue rend les mêmes événements
        rv = _hot[bid]["b"]["rev"]
        st, p1 = call("GET", f"{base}/poll?wait=0&since={rv}")
        pc = (p1 or {}).get("cid", "")
        ok(st == 200 and p1["events"][0][0] == "hello" and p1["events"][0][1]["poll"] and CID.fullmatch(pc),
           f"interrogation : bonjour, un identifiant ({st})")
        _, jn_ = fa.wait(lambda e, d: e == "join" and d["cid"] == pc)
        A(10, [{"o": "set", "t": "n", "id": "n1", "k": "text", "v": "par interrogation"}])
        t0 = time.time()
        st, p2 = call("GET", f"{base}/poll?wait=5&resume={pc}&since={rv}")
        evs = [e for e, _ in (p2 or {}).get("events", [])]
        ok(jn_ and st == 200 and p2["cid"] == pc and "op" in evs and time.time() - t0 < 2,
           f"interrogation : les autres le voient arriver ; un lot lui arrive aussitôt ({evs}, {time.time() - t0:.2f} s)")
        t0 = time.time()
        st, p3 = call("GET", f"{base}/poll?wait=0.6&resume={pc}")
        ok(st == 200 and p3["events"] == [] and 0.5 < time.time() - t0 < 2, "interrogation : rien de neuf, la question est tenue puis rendue vide")
        keep = globals()["POLL_LOST_S"]
        globals()["POLL_LOST_S"] = 0.2
        time.sleep(0.4)
        _sweep(bid)
        globals()["POLL_LOST_S"] = keep
        _, pl = fa.wait(lambda e, d: e == "p" and any(x["cid"] == pc and x["lost"] for x in d))
        ok(pl is not None, "interrogation : un onglet qui ne demande plus est vu « coupé »")
        # une écriture entière ailleurs (l'enregistrement de repli) : tout le monde se recale
        cur = call("GET", f"/api/ideation/boards/{bid}")[1]
        st, _ = call("POST", f"/api/ideation/boards/{bid}", {**cur, "base_rev": cur["rev"]})
        _, rs = fa.wait(lambda e, d: e == "reset")
        st2, old = call("GET", f"{base}/ops?since={rev0}")
        ok(st == 200 and rs and rs["rev"] == cur["rev"] + 1 and old["reset"], f"co-édition : une écriture entière recale les onglets ({rs})")
        st, stale = call("POST", f"/api/ideation/boards/{bid}", {**cur, "base_rev": cur["rev"]})
        ok(st == 409, "co-édition : l'enregistrement de repli garde sa version (409)")
        st, bad = call("POST", f"{base}/ops", {"sid": "x", "n": 1, "ops": []})
        ok(st == 400, f"co-édition : un lot mal formé est refusé ({st})")
    finally:
        fa.close()
        fb.close()
        with _lock:
            _boards.clear()


def _selftest_roles(call, ok) -> None:
    """Les rôles par planche et les invitations, porte allumée : Cal propriétaire,
    Lina éditrice par défaut, Mirabelle (« Zoé » dans les messages) entre par un
    lien de spectatrice."""
    from tools.admin import essai_http as H
    saved = {k: globals()[k] for k in ("HEARTBEAT_S", "GRACE_S", "WAKE_S")}
    before = config.CFG.get("auth")
    config.CFG["auth"] = True
    auth.startup()
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    flux: list[_Flux] = []
    try:
        globals().update(HEARTBEAT_S=1.0, GRACE_S=2.0, WAKE_S=0.2)
        for k in ("entree:127.0.0.1", "demande:127.0.0.1"):
            auth._hits.pop(k, None)
        s, d, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        s, d, lina = H("POST", "/api/auth/enter", {"name": "Lina"}, headers=same)
        s, bd, _ = H("POST", "/api/ideation/boards", {"name": "Planche de Cal"}, cookie=cal, headers=same)
        bid = bd.get("id", "")
        s, other, _ = H("POST", "/api/ideation/boards", {"name": "Une autre"}, cookie=cal, headers=same)
        base = f"/api/ideation/collab/{bid}"
        s, acc, _ = H("GET", f"{base}/access", cookie=cal)
        ok(s == 200 and acc["role"] == "owner" and acc["can"]["invite"], f"rôles : Cal est propriétaire ({s} {acc.get('role')})")
        s, acl, _ = H("GET", f"{base}/access", cookie=lina)
        ok(s == 200 and acl["role"] == "editor" and "invites" not in acl, "rôles : Lina, membre du portail, y est éditrice (comme avant)")
        s, _, _ = H("POST", f"{base}/invites", {"role": "viewer", "hours": 24}, cookie=lina, headers=same)
        ok(s == 403, f"rôles : seul le propriétaire invite ({s})")
        s, inv, _ = H("POST", f"{base}/invites", {"role": "viewer", "hours": 24}, cookie=cal, headers=same)
        tok = inv.get("token", "")
        ok(s == 200 and tok.startswith(bid + ".") and inv["role"] == "viewer", "rôles : un lien de spectateur, 24 h")
        # Zoé : un pseudo neuf (en attente), puis le lien
        s, dz, zoe = H("POST", "/api/auth/enter", {"name": "Mirabelle"}, headers=same)
        ok(dz.get("state") == "pending" if isinstance(dz, dict) else False, f"rôles : Zoé tape son pseudo, elle attend ({s} {dz})")
        s, _, _ = H("GET", f"/api/ideation/boards/{bid}", cookie=zoe)
        ok(s == 401, f"rôles : en attente, pas de planche ({s})")
        s, rd, _ = H("POST", f"/api/auth/ideation-invite/{tok}", {}, cookie=zoe, headers=same)
        ok(s == 200 and rd["role"] == "viewer" and rd["accepted"], f"rôles : le lien l'accepte, spectatrice de cette planche ({s} {rd})")
        s, lst, _ = H("GET", "/api/ideation/boards", cookie=zoe)
        ok(s == 200 and [x["id"] for x in lst["boards"]] == [bid] and lst["boards"][0]["role"] == "viewer",
           "rôles : dans Idéation, Zoé n'a que la planche de son lien")
        s, _, _ = H("GET", f"/api/ideation/boards/{other['id']}", cookie=zoe)
        ok(s == 403, f"rôles : pas les autres planches ({s})")
        fz = _Flux(f"{base}/stream?since=0", zoe)
        flux.append(fz)
        _, hz = fz.wait(lambda e, d: e == "hello")
        ok(hz and hz["me"]["role"] == "viewer" and not hz["can"]["edit"] and hz["can"]["see"], "rôles : son flux dit « spectateur »")
        s, _, _ = H("POST", f"{base}/ops", {"sid": "sid-zzzzzzzz", "n": 1, "ops": [{"o": "set", "t": "b", "k": "name", "v": "x"}]},
                    cookie=zoe, headers=same)
        ok(s == 403, f"rôles : une opération de spectateur est refusée ({s})")
        cur = H("GET", f"/api/ideation/boards/{bid}", cookie=zoe)[1]
        s, _, _ = H("POST", f"/api/ideation/boards/{bid}", {**cur, "base_rev": cur["rev"]}, cookie=zoe, headers=same)
        ok(s == 403, f"rôles : l'enregistrement entier aussi ({s})")
        s, _, _ = H("POST", f"{base}/messages", {"text": "bravo"}, cookie=zoe, headers=same)
        ok(s == 403, f"rôles : le fil fermé aux spectateurs par défaut ({s})")
        s, _, _ = H("POST", f"{base}/access", {"comments": True}, cookie=cal, headers=same)
        _, rz = fz.wait(lambda e, d: e == "role")
        s2, _, _ = H("POST", f"{base}/messages", {"text": "bravo"}, cookie=zoe, headers=same)
        ok(s == 200 and rz and rz["can"]["comment"] and s2 == 200, "rôles : le propriétaire ouvre le fil, Zoé commente")
        # « suivez-moi » : la présence le porte
        fc = _Flux(f"{base}/stream", cal)
        flux.append(fc)
        _, hc = fc.wait(lambda e, d: e == "hello")
        H("POST", f"{base}/presence", {"cid": hc["cid"], "lead": True, "view": [0, 0, 800, 600]}, cookie=cal, headers=same)
        _, pl = fz.wait(lambda e, d: e == "p" and any(x["cid"] == hc["cid"] and x["lead"] for x in d))
        ok(pl is not None, "suivre : « suivez-moi » arrive chez les autres avec la vue")
        # retirer le lien : ce qu'il a donné s'en va, l'onglet de Zoé est fermé
        s, a2, _ = H("GET", f"{base}/access", cookie=cal)
        iid = a2["invites"][0]["id"]
        ok(a2["invites"][0]["uses"][0]["id"] == "mirabelle" and a2["members"][0]["via"] == iid, "rôles : le propriétaire voit qui a ouvert le lien")
        s, _, _ = H("POST", f"{base}/invites/{iid}/revoke", {}, cookie=cal, headers=same)
        ev, bye = fz.wait(lambda e, d: e in ("bye", "eof"), 4)
        ok(s == 200 and ev == "bye", f"rôles : le lien retiré, Zoé perd la planche ({ev} {bye})")
        s, _, _ = H("POST", f"/api/auth/ideation-invite/{tok}", {}, cookie=zoe, headers=same)
        ok(s == 410, f"rôles : un lien retiré ne s'ouvre plus ({s})")
        s, _, _ = H("POST", f"/api/auth/ideation-invite/{bid}.faux-faux-faux-faux-faux", {}, cookie=zoe, headers=same)
        ok(s == 410, f"rôles : un faux lien non plus ({s})")
        s, _, _ = H("POST", f"/api/ideation/boards/{bid}/delete", {}, cookie=lina, headers=same)
        ok(s == 403, f"rôles : seul le propriétaire met la planche à la corbeille ({s})")
    finally:
        for f in flux:
            f.close()
        globals().update(saved)
        with _lock:
            _boards.clear()
        auth.set_current(None)
        config.CFG["auth"] = before


def _selftest_registres(call, ok) -> None:
    """Les registres fins : deux cases d'un composeur écrites en même temps restent toutes
    deux ; deux passages d'un même texte aussi ; le même passage, le dernier écrit gagne."""
    # la fusion elle-même
    ok(merge_text("bonjour le monde", "bonjour tout le monde", "bonjour le monde entier") == "bonjour tout le monde entier",
       "registres : deux passages d'un texte, les deux restent")
    ok(merge_text("x", "xa", "xb") == "xab", "registres : deux frappes au même endroit, les deux (la première arrivée d'abord)")
    ok(merge_text("abc", "aXc", "aYc") == "aYc", "registres : le même passage, le dernier écrit gagne")
    ok(merge_text("abc", "ac", "abcd") == "acd", "registres : un effacement ici, une frappe là")
    ok(merge_text("a😀b", "a😀Xb", "Ya😀b") == "Ya😀Xb", "registres : un texte à emoji")
    ok(merge_text(None, "serveur", "page") == "page", "registres : sans base (une vieille page), le dernier écrit gagne")

    st, b = call("POST", "/api/ideation/boards", {"name": "Essai des registres"})
    bid = b.get("id", "")
    base = f"/api/ideation/collab/{bid}"
    nodes = [{"id": "c1", "type": "compose", "x": 0, "y": 0, "w": 300, "h": 200,
              "slots": [{"id": "a", "role": "style", "name": "Style", "text": "un"}, {"id": "b", "role": "decor", "name": "Décor", "text": "deux"}]},
             {"id": "n1", "type": "note", "x": 400, "y": 0, "w": 200, "h": 80, "text": "bonjour le monde"}]
    call("POST", f"/api/ideation/boards/{bid}", {"name": "Essai des registres", "nodes": nodes, "links": [], "base_rev": 1})
    A = lambda n, ops: call("POST", f"{base}/ops", {"sid": "sid-regaaaaa", "n": n, "ops": ops})   # noqa: E731
    B = lambda n, ops: call("POST", f"{base}/ops", {"sid": "sid-regbbbbb", "n": n, "ops": ops})   # noqa: E731
    node = lambda i: next((x for x in call("GET", f"/api/ideation/boards/{bid}")[1]["nodes"] if x["id"] == i), None)   # noqa: E731
    slots = lambda: {s["id"]: s for s in (node("c1") or {}).get("slots", [])}   # noqa: E731
    try:
        s1, _ = A(1, [{"o": "set", "t": "n", "id": "c1", "k": "t:a", "v": "un chat", "b": "un"}])
        s2, r2 = B(1, [{"o": "set", "t": "n", "id": "c1", "k": "t:b", "v": "deux chiens", "b": "deux"}])
        sl = slots()
        ok(s1 == 200 and s2 == 200 and sl["a"]["text"] == "un chat" and sl["b"]["text"] == "deux chiens",
           f"registres : deux cases d'un composeur écrites en même temps, les deux restent ({[(k, v['text']) for k, v in sl.items()]})")
        A(2, [{"o": "set", "t": "n", "id": "c1", "k": "s:a", "v": {"id": "a", "role": "style", "name": "Style", "lock": True, "off": False}}])
        sl = slots()
        ok(sl["a"]["lock"] and sl["a"]["text"] == "un chat", "registres : verrouiller une case ne touche pas son texte")
        A(3, [{"o": "set", "t": "n", "id": "c1", "k": "s:z", "v": {"id": "z", "role": "libre", "name": "Libre"}},
              {"o": "set", "t": "n", "id": "c1", "k": "t:z", "v": "neuf", "b": ""},
              {"o": "set", "t": "n", "id": "c1", "k": "slots#", "v": ["z", "a", "b"]}])
        B(2, [{"o": "set", "t": "n", "id": "c1", "k": "slots#", "v": ["b", "a"]}])
        order = [s["id"] for s in (node("c1") or {}).get("slots", [])]
        ok(order == ["z", "b", "a"] and slots()["z"]["text"] == "neuf",
           f"registres : une case ajoutée, deux ordres fusionnés comme l'ordre des objets ({order})")
        A(4, [{"o": "set", "t": "n", "id": "c1", "k": "s:b"}])
        s, r = B(3, [{"o": "set", "t": "n", "id": "c1", "k": "t:b", "v": "deux chiens au bord", "b": "deux chiens"}])
        ok("b" not in slots() and s == 200, "registres : une case retirée l'emporte sur son texte écrit ensuite")
        A(5, [{"o": "set", "t": "n", "id": "n1", "k": "text", "v": "bonjour tout le monde", "b": "bonjour le monde"}])
        B(4, [{"o": "set", "t": "n", "id": "n1", "k": "text", "v": "bonjour le monde entier", "b": "bonjour le monde"}])
        ok((node("n1") or {}).get("text") == "bonjour tout le monde entier", f"registres : deux personnes dans la même note ({(node('n1') or {}).get('text')})")
        B(5, [{"o": "set", "t": "n", "id": "n1", "k": "text", "v": "salut"}])
        ok((node("n1") or {}).get("text") == "salut", "registres : un texte sans base (une vieille page) : le dernier écrit gagne, comme avant")
        A(6, [{"o": "set", "t": "n", "id": "c1", "k": "slots", "v": [{"id": "q", "role": "libre", "name": "Libre", "text": "entier"}]}])
        ok(list(slots()) == ["q"], "registres : la liste entière des cases (une vieille page) s'écrit encore")
        s, r = A(7, [{"o": "set", "t": "n", "id": "n1", "k": "t:q", "v": "x"}])
        ok(s == 200 and (node("n1") or {}).get("text") == "salut", "registres : une case d'autre chose qu'un composeur est écartée")
    finally:
        with _lock:
            _boards.clear()


def _selftest_invite(call, ok) -> None:
    """L'invité (core/auth.py, GUEST) : un pseudo neuf qui ouvre le lien de la planche P n'a
    que P — ni la planche Q, ni la bibliothèque (hors des objets posés sur P), ni l'Admin,
    ni les rendus, ni les autres outils ; une autre page le ramène à P ; ce qu'il pose est
    ce qu'il voit ; un lien retiré lui ferme tout ; Cal en fait un ami dans l'Admin. Puis
    la même chose par la porte publique « demo » (code d'invitation, puis le lien)."""
    import urllib.parse

    from PIL import Image

    import showrunner
    from tools import porte_publique as PP
    from tools.admin import essai_http as H
    saved = {k: config.CFG.get(k) for k in ("auth", "porte")}
    config.CFG["auth"] = True
    auth.startup()
    home = int(config.get("port"))
    same = {"Origin": f"http://127.0.0.1:{home}"}
    flux: list[_Flux] = []
    try:
        for k in ("entree:127.0.0.1", "demande:127.0.0.1", "invitation-planche:127.0.0.1"):
            auth._hits.pop(k, None)
        s, d, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        auth.set_current(auth.user(auth.admin_id()))
        pics = []
        for i, c in enumerate(((200, 60, 40), (40, 60, 200))):
            f = config.data_dir() / f"invite-essai-{i}.png"
            Image.new("RGB", (32, 24), c).save(f, "PNG")
            pics.append(library.add_file(f, title=f"invité {i}"))
        auth.set_current(None)
        X, Y = pics[0]["id"], pics[1]["id"]
        xurl, yurl = "/" + library.public(pics[0])["url"], "/" + library.public(pics[1])["url"]
        s, P, _ = H("POST", "/api/ideation/boards", {"name": "Planche P"}, cookie=cal, headers=same)
        s, Q, _ = H("POST", "/api/ideation/boards", {"name": "Planche Q"}, cookie=cal, headers=same)
        p, q = P["id"], Q["id"]
        H("POST", f"/api/ideation/boards/{p}", {"name": "Planche P", "base_rev": 1, "links": [],
                                                "nodes": [{"id": "m1", "type": "media", "item": X, "kind": "image", "x": 0, "y": 0, "w": 200, "h": 150},
                                                          {"id": "t1", "type": "note", "x": 300, "y": 0, "w": 200, "h": 80, "text": "à P"}]},
          cookie=cal, headers=same)
        s, inv, _ = H("POST", f"/api/ideation/collab/{p}/invites", {"role": "editor", "hours": 24}, cookie=cal, headers=same)
        tok = inv.get("token", "")
        s, dg, gas = H("POST", "/api/auth/enter", {"name": "Gaspard"}, headers=same)
        s, rd, _ = H("POST", f"/api/auth/ideation-invite/{tok}", {}, cookie=gas, headers=same)
        s2, me_, _ = H("GET", "/api/auth/me", cookie=gas)
        ok(s == 200 and rd.get("guest") and rd["role"] == "editor" and me_.get("state") == "active" and me_["user"]["role"] == auth.GUEST,
           f"invité : le lien accepte Gaspard en invité (rôle « {auth.GUEST} »), éditeur de P ({s} {rd} {me_.get('user')})")
        G = lambda m, path, body=None: H(m, path, body, cookie=gas, headers=same if m != "GET" else None)[:2]   # noqa: E731
        s, _ = G("GET", f"/api/ideation/boards/{p}")
        ok(s == 200, f"invité : il lit P ({s})")
        s, _ = G("GET", f"/api/ideation/boards/{q}")
        ok(s == 403, f"invité : pas la planche Q ({s})")
        s, lst = G("GET", "/api/ideation/boards")
        ok(s == 200 and [x["id"] for x in lst["boards"]] == [p], "invité : dans la liste, P seule")
        s, _ = G("GET", f"/api/ideation/collab/{q}")
        ok(s == 403, f"invité : ni le direct de Q ({s})")
        s, _ = G("GET", "/api/library")
        ok(s == 403, f"invité : pas /api/library ({s})")
        s, got = G("GET", f"/api/library/{X}")
        ok(s == 200 and got.get("id") == X, f"invité : l'image posée sur P se lit ({s})")
        s, _ = G("GET", f"/api/library/{Y}")
        ok(s == 403, f"invité : une image qui n'est pas sur P, non ({s})")
        s, bt = G("POST", "/api/library/batch", {"ids": [X, Y]})
        ok(s == 200 and [i["id"] for i in bt["items"]] == [X] and bt["missing"] == [Y], f"invité : le lot rend l'image de P, tait l'autre ({s})")
        s1, raw, _, _ = PP._req(home, "GET", xurl, cookies={auth.COOKIE: gas})
        s2, _, _, _ = PP._req(home, "GET", yurl, cookies={auth.COOKIE: gas})
        ok(s1 == 200 and raw[:4] == b"\x89PNG" and s2 == 403, f"invité : le fichier de l'image de P se sert, pas l'autre ({s1} {s2})")
        s, _ = G("GET", f"/api/ideation/palette/{X}")
        s2, _ = G("GET", f"/api/ideation/palette/{Y}")
        ok(s == 200 and s2 == 403, f"invité : le nuancier, de ses images seulement ({s} {s2})")
        for m, path, body in (("GET", "/api/admin/state", None), ("GET", "/api/admin/journal", None), ("GET", "/api/jobs", None),
                              ("GET", "/api/queue", None), ("GET", "/api/system", None), ("POST", "/api/jobs", {"kind": "ideation.export", "params": {}}),
                              ("POST", "/api/image/generate", {"prompt": "x"}), ("POST", "/api/ideation/lot", {}),
                              ("POST", "/api/ideation/boards", {"name": "à moi"}), ("POST", f"/api/ideation/boards/{p}/duplicate", {}),
                              ("POST", f"/api/ideation/boards/{p}/export", {}), ("POST", f"/api/ideation/boards/{p}/delete", {}),
                              ("GET", "/api/asset/view", None), ("GET", "/api/movie/options", None), ("GET", "/api/image/models", None),
                              ("GET", "/api/cf/characters", None), ("PUT", "/api/library/upload?name=a.png", None),
                              ("POST", f"/api/library/{X}", {"title": "à moi"}), ("GET", "/character/api/characters", None)):
            s, _ = G(m, path, body)
            ok(s == 403, f"invité : fermé {m} {path} ({s})")
        s, _ = G("GET", "/api/prefs")
        ok(s == 200, f"invité : ses préférences (le thème) ({s})")
        for path in ("/", "/asset/", "/admin/", "/image/"):
            s, _, _, hd = PP._req(home, "GET", path, cookies={auth.COOKIE: gas})
            ok(s == 303 and hd.get("Location") == f"/ideation/#{p}", f"invité : {path} le ramène à sa planche ({s} {hd.get('Location')})")
        for path in ("/ideation/", "/commun/shell.js", "/ideation/barre.js"):
            s, _, _, _ = PP._req(home, "GET", path, cookies={auth.COOKIE: gas})
            ok(s == 200, f"invité : {path} se sert ({s})")
        # co-éditer : ce qu'il voit, oui ; un objet de la bibliothèque qu'on ne lui a pas montré, non
        fg = _Flux(f"/api/ideation/collab/{p}/stream", gas)
        flux.append(fg)
        _, hg = fg.wait(lambda e, dd: e == "hello")
        ok(hg and hg["me"]["role"] == "editor", "invité : son direct sur P, éditeur")
        s, _ = G("POST", f"/api/ideation/collab/{p}/ops", {"sid": "sid-gaspard1", "n": 1, "ops": [
            {"o": "add", "t": "n", "v": {"id": "m2", "type": "media", "item": Y, "kind": "image", "x": 0, "y": 300, "w": 100, "h": 80}},
            {"o": "add", "t": "n", "v": {"id": "m3", "type": "media", "item": X, "kind": "image", "x": 200, "y": 300, "w": 100, "h": 80}},
            {"o": "set", "t": "n", "id": "t1", "k": "text", "v": "à P, et à Gaspard", "b": "à P"}]})
        _, eg = fg.wait(lambda e, dd: e == "op" and dd["sid"] == "sid-gaspard1")
        ids = [n["id"] for n in H("GET", f"/api/ideation/boards/{p}", cookie=cal)[1]["nodes"]]
        ok(s == 200 and "m2" not in ids and "m3" in ids and eg and {"i": 0, "why": "invité"} in eg.get("drop", []),
           f"invité : il colle l'image de P, pas un objet deviné ({ids})")
        s, _ = G("GET", f"/api/library/{Y}")
        ok(s == 403, f"invité : l'objet deviné reste fermé ({s})")
        cur = H("GET", f"/api/ideation/boards/{p}", cookie=gas)[1]
        bad = {**cur, "base_rev": cur["rev"], "nodes": cur["nodes"] + [{"id": "m4", "type": "media", "item": Y, "kind": "image", "x": 0, "y": 0, "w": 50, "h": 50}]}
        s, _ = G("POST", f"/api/ideation/boards/{p}", bad)
        ok(s == 403, f"invité : l'enregistrement entier non plus ({s})")
        # le lien retiré : P et son image se ferment
        s, acc, _ = H("GET", f"/api/ideation/collab/{p}/access", cookie=cal)
        H("POST", f"/api/ideation/collab/{p}/invites/{acc['invites'][0]['id']}/revoke", {}, cookie=cal, headers=same)
        ev, _ = fg.wait(lambda e, dd: e in ("bye", "eof"), 4)
        s1, _ = G("GET", f"/api/ideation/boards/{p}")
        s2, _ = G("GET", f"/api/library/{X}")
        s3, _, _, _ = PP._req(home, "GET", xurl, cookies={auth.COOKIE: gas})
        ok(ev == "bye" and s1 == 403 and s2 == 403 and s3 == 403, f"invité : le lien retiré, P et son image se ferment ({ev} {s1} {s2} {s3})")
        s, _, _, hd = PP._req(home, "GET", "/", cookies={auth.COOKIE: gas})
        ok(s == 303 and hd.get("Location") == "/ideation/", f"invité sans planche : ramené à Idéation, vide ({hd.get('Location')})")
        # Cal en fait un ami
        s, _, _ = H("POST", "/api/admin/users/gaspard", {"role": "ami"}, cookie=cal, headers=same)
        s2, _ = G("GET", "/api/library")
        s3, _ = G("GET", f"/api/ideation/boards/{q}")
        ok(s == 200 and s2 == 200 and s3 == 200, f"invité : Cal en fait un ami (Admin), le portail s'ouvre ({s} {s2} {s3})")

        # ── par la porte publique « demo » ──
        if PP._APP is None:
            ok(False, "invité, porte : l'App n'a pas été gardée")
            return
        dport = PP._free_port()
        config.CFG["porte"] = {"mode": "demo", "port": dport}
        showrunner.serve_door(PP._APP, "demo", "127.0.0.1", dport)
        ok(PP._wait_port(dport), "invité, porte : la porte « demo » d'essai écoute")
        codes = auth.demo_codes(renew=True)
        TUN = {"Host": "essai-invite.trycloudflare.com", "Cf-Connecting-IP": "203.0.113.9", "Cf-Ray": "8c0ffee00001-CDG"}
        TUNW = {**TUN, "Origin": "https://essai-invite.trycloudflare.com"}
        s, inv2, _ = H("POST", f"/api/ideation/collab/{p}/invites", {"role": "viewer", "hours": 1}, cookie=cal, headers=same)
        link = f"/ideation/?invite={inv2['token']}"
        s, page, _, _ = PP._req(dport, "GET", link, headers=TUN)
        ok(s == 401 and isinstance(page, bytes) and b'name="next"' in page and inv2["token"].encode() in page,
           f"invité, porte : sans le code, le lien de la planche montre l'invitation, et la garde pour après ({s})")
        s, _, jar, hd = PP._req(dport, "POST", "/invitation/", raw=f"code={codes['invitation']}&next={urllib.parse.quote(link, safe='')}".encode(),
                                headers={**TUNW, "Content-Type": "application/x-www-form-urlencoded"})
        ick = jar.get(auth.INVITE_COOKIE)
        ok(s == 303 and hd.get("Location") == link and ick, f"invité, porte : le code donné, retour au lien de la planche ({s} {hd.get('Location')})")
        s, _, _, hd = PP._req(dport, "POST", "/invitation/", raw=b"code=" + codes["invitation"].encode() + b"&next=%2F%2Fexemple.org",
                              headers={**TUNW, "Content-Type": "application/x-www-form-urlencoded"})
        ok(s == 303 and hd.get("Location") == "/", f"invité, porte : jamais un retour vers un autre site ({hd.get('Location')})")
        s, d, jar, _ = PP._req(dport, "POST", "/api/auth/enter", {"name": "Hortense"}, cookies={auth.INVITE_COOKIE: ick}, headers=TUNW)
        hck = jar.get(auth.COOKIE)
        ok(s == 200 and d.get("state") == "pending" and hck, f"invité, porte : un pseudo neuf attend ({s} {d.get('state')})")
        ck = {auth.INVITE_COOKIE: ick, auth.COOKIE: hck}
        s, rd, _, _ = PP._req(dport, "POST", f"/api/auth/ideation-invite/{inv2['token']}", {}, cookies=ck, headers=TUNW)
        ok(s == 200 and rd.get("guest") and rd["role"] == "viewer", f"invité, porte : le lien l'accepte en invitée, spectatrice ({s} {rd})")
        s1, _, _, _ = PP._req(dport, "GET", f"/api/ideation/boards/{p}", cookies=ck, headers=TUN)
        s2, _, _, _ = PP._req(dport, "GET", f"/api/ideation/boards/{q}", cookies=ck, headers=TUN)
        s3, _, _, _ = PP._req(dport, "GET", "/api/library", cookies=ck, headers=TUN)
        s4, _, _, _ = PP._req(dport, "GET", "/api/admin/state", cookies=ck, headers=TUN)
        s5, _, _, _ = PP._req(dport, "GET", xurl, cookies=ck, headers=TUN)
        s6, _, _, hd = PP._req(dport, "GET", "/asset/", cookies=ck, headers=TUN)
        ok((s1, s2, s3, s4, s5, s6) == (200, 403, 403, 403, 200, 303) and hd.get("Location") == f"/ideation/#{p}",
           f"invité, porte : P oui ; Q, la bibliothèque, l'Admin non ; l'image de P oui ; Asset ramène à P ({s1} {s2} {s3} {s4} {s5} {s6})")
        auth.demo_codes(renew=True)
        s, _, _, _ = PP._req(dport, "GET", f"/api/ideation/boards/{p}", cookies=ck, headers=TUN)
        ok(s == 401, f"invité, porte : de nouveaux codes ferment sa session, comme toutes ({s})")
    finally:
        for f in flux:
            f.close()
        with _lock:
            _boards.clear()
        auth.set_current(None)
        config.CFG.update(saved)
