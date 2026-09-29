"""La porte du portail : qui entre, et qui est admin.

Décisions de Cal (29/09/2026) : ses amis viennent faire leurs
personnages, images et vidéos quand les DGX sont allumés ; « on se log
juste avec le pseudo », sans code ni mot de passe.

  - On tape son pseudo, depuis n'importe quel navigateur. Un pseudo déjà
    accepté entre aussitôt ; un pseudo inconnu devient une demande que
    Cal accepte ou refuse dans sa page d'administration (admin/) ; la
    page de celui qui attend s'ouvre seule. Se déconnecter ne bloque
    rien : on retape son pseudo.
  - Une session = un jeton aléatoire posé en cookie (`sr_session`,
    HttpOnly, SameSite=Lax). Le serveur ne garde que l'empreinte SHA-256
    du jeton : un `auth.json` lu par quelqu'un ne donne aucune session.
  - Le compte de Cal : pseudo `nico007`, admin, créé au démarrage s'il
    n'existe pas, sous l'id `cal` (ses objets et ses travaux restent à
    lui). Secours en ligne de commande : `python3 server/showrunner.py
    --admin <pseudo>` crée ou remet un pseudo admin. Plus d'amorçage par
    code : `admin-code.txt` est effacé au démarrage.
  - Une seule précaution : un pseudo admin n'entre que depuis le réseau de
    Cal (loopback, 192.168.10.0/24, le câble 169.254.0.0/16, Tailscale
    100.64.0.0/10) — réglage `admin_lan_only`, vrai par défaut. Un pseudo
    qui imite un admin (casse, accents, 0/O, 1/l/I) ou un mot réservé est
    refusé. Derrière un tunnel Cloudflare, tout viendrait de 127.0.0.1 :
    il faudra alors lire l'identité signée par la porte (étude Cloudflare).
  - Le socle refuse `/api/…`, les relais (`/character/…`) et les fichiers
    de la bibliothèque sans session (401) ; les pages se servent et
    montrent la porte (`commun/porte.js`). Toute écriture venue d'une
    autre page est refusée (`Origin`, `Sec-Fetch-Site` : audit du 28/09,
    H3).
  - `"auth": false` dans `showrunner.local.json` coupe la porte (essais,
    `tools/check.py`) : tout se passe alors comme si Cal était connecté.

Qui voit quoi : réglage d'admin, « tout le monde voit tout » par défaut
(décision de Cal en attente, docs/REPRISE.md) ; dans les deux cas, seul
le propriétaire d'un objet (ou un admin) le modifie ou le met à la corbeille.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
import secrets
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from . import config
from .http import HttpError

COOKIE = "sr_session"
_lock = threading.RLock()
_db: dict | None = None
_mtime = 0.0
_local = threading.local()
_hits: dict[str, list[float]] = {}
_jlock = threading.Lock()

DEFAULT_SETTINGS = {
    "visibility": "all",       # all | own : décision de Cal en attente
    "admin_first": True,       # audit H4 : « Cal, administrateur, passe devant (priorité) »
    # audit H4 : « refuser au-delà de N travaux en file par utilisateur (par exemple 3) »
    "quotas": {"running": 1, "queued": 3, "per_day": None},
    "total_queued": 50,        # audit H4 : « et au-delà d'un total (par exemple 50) »
    "admin_lan_only": True,    # un pseudo admin n'entre que depuis le réseau de Cal (Cal, 29/09)
}
RESERVED = ("admin", "administrateur", "administratrice", "root", "showrunner", "systeme", "system", "portail",
            "anonyme", "personne")
# le réseau de Cal : la machine, la maison, le câble direct entre les DGX, Tailscale
ADMIN_NETS = tuple(ipaddress.ip_network(n) for n in
                   ("127.0.0.0/8", "::1/128", "192.168.10.0/24", "169.254.0.0/16", "100.64.0.0/10"))
# lettres qui se confondent à l'œil (I majuscule et l minuscule, 0 et O…) :
# deux pseudos qui ne diffèrent que par elles sont le même pseudo
_CONFUSABLE = str.maketrans({"i": "l", "1": "l", "0": "o", "5": "s", "3": "e", "4": "a", "7": "t", "8": "b"})
SESSION_DAYS = 120    # une session inutilisée aussi longtemps s'éteint
PENDING_DAYS = 14


# ── réglages ────────────────────────────────────────────────
def enabled() -> bool:
    return config.get("auth", True) is not False


def admin_name() -> str:
    return str(config.get("admin_name", "Cal"))


def admin_id() -> str:
    return slug(admin_name())


def admin_pseudo() -> str:
    return str(config.get("admin_pseudo", "nico007"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:32]


def skeleton(key: str) -> str:
    return key.replace("-", "").translate(_CONFUSABLE)


def clean_name(name) -> str:
    return " ".join(str(name or "").split())


def valid_name(name: str) -> bool:
    if not (2 <= len(name) <= 24) or len(slug(name)) < 2:
        return False
    return all(ch.isalnum() or ch in " -'._" for ch in name)


def key_of(u: dict) -> str:
    """Ce qu'on tape pour entrer : le pseudo (nico007 pour Cal), sinon le nom."""
    return slug(u.get("pseudo") or u.get("name") or u["id"])


def on_admin_network(ip: str) -> bool:
    try:
        a = ipaddress.ip_address((ip or "").split("%", 1)[0])
    except ValueError:
        return False
    if getattr(a, "ipv4_mapped", None):
        a = a.ipv4_mapped
    return any(a in n for n in ADMIN_NETS if n.version == a.version)


# ── le fichier ──────────────────────────────────────────────
def _file() -> Path:
    return config.data_dir() / "auth.json"


def _data() -> dict:
    """La base en mémoire, relue si le fichier a changé ailleurs (la ligne
    de commande `--admin` l'écrit pendant que le portail tourne)."""
    global _db, _mtime
    try:
        m = _file().stat().st_mtime
    except OSError:
        m = 0.0
    if _db is None or (m and m != _mtime):
        db = {}
        if m:
            try:
                db = json.loads(_file().read_text(encoding="utf-8"))
            except ValueError:
                db = _db or {}
        for k in ("users", "sessions", "settings"):
            db.setdefault(k, {})
        _db, _mtime = db, m
    return _db


def _save() -> None:
    global _mtime
    tmp = _file().with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(_db, f, ensure_ascii=False, indent=1)
    tmp.replace(_file())
    _mtime = _file().stat().st_mtime


def reset_for_tests() -> None:
    """Oublie l'état en mémoire (tools/check.py change de dossier de données)."""
    global _db
    with _lock:
        _db = None
        _hits.clear()


def settings() -> dict:
    with _lock:
        s = _data()["settings"]
        out = {**DEFAULT_SETTINGS, **{k: v for k, v in s.items() if k != "quotas"}}
        out["quotas"] = {**DEFAULT_SETTINGS["quotas"], **(s.get("quotas") or {})}
        return out


def _quota_value(v, what: str):
    if v in (None, ""):
        return None
    try:
        n = int(v)
    except (TypeError, ValueError) as e:
        raise HttpError(400, f"{what} : un nombre entier, ou vide pour « sans limite »") from e
    if not 0 <= n <= 10000:
        raise HttpError(400, f"{what} : entre 0 et 10000")
    return n


QUOTA_FR = {"running": "travaux simultanés", "queued": "travaux en file", "per_day": "travaux par jour"}


def set_settings(patch: dict, by: str = "") -> dict:
    with _lock:
        s = _data()["settings"]
        if "visibility" in patch:
            if patch["visibility"] not in ("all", "own"):
                raise HttpError(400, "visibilité : all ou own")
            s["visibility"] = patch["visibility"]
        for k in ("admin_first", "admin_lan_only"):
            if k in patch:
                s[k] = bool(patch[k])
        if "total_queued" in patch:
            s["total_queued"] = _quota_value(patch["total_queued"], "total en file")
        if isinstance(patch.get("quotas"), dict):
            q = dict(s.get("quotas") or {})
            for k in QUOTA_FR:
                if k in patch["quotas"]:
                    q[k] = _quota_value(patch["quotas"][k], QUOTA_FR[k])
            s["quotas"] = q
        _save()
    journal("réglages", by=by, patch=patch)
    return settings()


# ── le contexte : qui fait la requête, ou le travail ────────
def pseudo_admin() -> dict:
    return {"id": admin_id(), "name": admin_name(), "pseudo": admin_pseudo(), "role": "admin", "state": "active"}


def current() -> dict | None:
    return getattr(_local, "user", None)


def set_current(u: dict | None) -> None:
    _local.user = u


def current_id() -> str | None:
    u = current()
    return u["id"] if u else None


def is_admin(u: dict | None) -> bool:
    return bool(u) and u.get("role") == "admin"


def user(uid: str | None) -> dict | None:
    if not uid:
        return None
    with _lock:
        u = _data()["users"].get(uid)
    if u:
        return dict(u)
    if uid == admin_id():   # la porte coupée, ou les objets d'avant la porte
        return pseudo_admin()
    return None


def display_name(uid: str | None) -> str:
    u = user(uid)
    return u["name"] if u else (uid or "")


def admins() -> list[dict]:
    with _lock:
        return [dict(u) for u in _data()["users"].values() if u.get("role") == "admin" and u.get("state") == "active"]


def has_admin() -> bool:
    return bool(admins())


# ── les objets : qui voit, qui modifie ──────────────────────
def owner_of(it: dict) -> str | None:
    return (it.get("origin") or {}).get("user") or it.get("owner")


def can_read_item(it: dict, u: dict | None) -> bool:
    if u is None or is_admin(u) or settings()["visibility"] == "all":
        return True
    return owner_of(it) == u["id"] or bool(it.get("shared"))


def can_write_item(it: dict, u: dict | None) -> bool:
    """Seul le propriétaire (ou un admin) modifie ; un objet d'avant la porte est à Cal."""
    if u is None or is_admin(u):
        return True
    return owner_of(it) == u["id"]


# ── les sessions ────────────────────────────────────────────
def _hash(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


def _ip(req) -> str:
    try:
        return req._h.client_address[0]
    except (AttributeError, IndexError):
        return ""


def _cookie(req) -> str | None:
    for part in (req.headers.get("Cookie") or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE and v:
            return v.strip()
    return None


def cookie_header(tok: str | None) -> str:
    secure = "; Secure" if config.get("auth_cookie_secure") else ""
    if not tok:
        return f"{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure}"
    return f"{COOKIE}={tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_DAYS * 86400}{secure}"


def _new_session(uid: str, req) -> str:
    tok = secrets.token_urlsafe(32)
    with _lock:
        _data()["sessions"][_hash(tok)] = {"user": uid, "created": now_iso(), "seen": now_iso(), "t": time.time(),
                                          "ua": (req.headers.get("User-Agent") or "")[:160], "ip": _ip(req)}
        _save()
    return tok


def _expired(s: dict, u: dict | None) -> bool:
    days = PENDING_DAYS if (u and u.get("state") == "pending") or s.get("refused") else SESSION_DAYS
    return time.time() - float(s.get("t") or 0) > days * 86400


def session_of(req) -> tuple[str | None, dict | None, dict | None]:
    """(empreinte, session, personne) du navigateur, ou des None."""
    tok = _cookie(req)
    if not tok:
        return None, None, None
    h = _hash(tok)
    with _lock:
        db = _data()
        s = db["sessions"].get(h)
        if not s:
            return None, None, None
        u = db["users"].get(s.get("user") or "")
        if _expired(s, u):
            db["sessions"].pop(h, None)
            _save()
            return None, None, None
        if time.time() - float(s.get("t") or 0) > 300:   # « vu » à cinq minutes près : pas une écriture par requête
            s["t"], s["seen"] = time.time(), now_iso()
            _save()
        return h, s, (dict(u) if u else None)


def _offnet(u: dict | None, req) -> bool:
    """Un admin hors du réseau de Cal, quand `admin_lan_only` le demande."""
    return is_admin(u) and settings()["admin_lan_only"] and not on_admin_network(_ip(req))


OFFNET = ("{p} est un compte admin : il n'entre que depuis le réseau de Cal (la maison, le câble des DGX, "
          "Tailscale)")


# ── la porte du socle ───────────────────────────────────────
ADMIN_ROUTES = {("POST", "/api/movie/h3/stop")}   # « libérer » (arrêter H3) reste à Cal : étude Cloudflare §5.2


def _csrf(req) -> None:
    """Audit du 28/09, H3 : refuser une écriture dont `Sec-Fetch-Site`
    n'est ni same-origin ni none, ou dont l'hôte d'`Origin` n'est pas
    celui de la requête. Un script (curl) n'envoie ni l'un ni l'autre."""
    sfs = (req.headers.get("Sec-Fetch-Site") or "").strip().lower()
    if sfs and sfs not in ("same-origin", "none"):
        raise HttpError(403, "requête refusée : elle vient d'une autre page (Sec-Fetch-Site)")
    origin = req.headers.get("Origin")
    if origin is not None:
        host = (req.headers.get("Host") or "").strip().lower()
        if origin.strip() == "null" or urlsplit(origin.strip()).netloc.lower() != host:
            raise HttpError(403, "requête refusée : elle vient d'une autre origine (Origin)")


def _protected(req, app) -> bool:
    p = req.path
    if p.startswith("/api/"):
        return True
    if any(p.startswith(pre) for pre, _ in getattr(app, "prefixes", [])):
        return True
    rel = p.lstrip("/")
    return any(rel.startswith(m) for m in getattr(app, "mounts", {}))


def gate(req, app) -> None:
    """Posée devant chaque requête par core/http.py (`app.gate`)."""
    set_current(None)
    req.user = None
    req.session = None
    req.protected = _protected(req, app)
    offnet = False
    if not enabled():
        u = pseudo_admin()
        set_current(u)
        req.user = u
    else:
        h, _, u = session_of(req)
        if u and u.get("state") == "active":
            if _offnet(u, req):
                offnet = True
            else:
                set_current(u)
                req.user, req.session = u, h
    if req.method not in ("GET", "HEAD", "OPTIONS"):
        _csrf(req)
    if not enabled() or not req.protected or req.path.startswith("/api/auth/"):
        return
    if not req.user:
        if offnet:
            raise HttpError(403, OFFNET.format(p=u.get("pseudo") or u["name"]))
        if u and u.get("state") == "suspended":
            raise HttpError(403, "ton accès est suspendu : vois avec Cal")
        raise HttpError(401, "connexion requise : tape ton pseudo à l'accueil du portail")
    if (req.path.startswith("/api/admin/") or (req.method, req.path.rstrip("/")) in ADMIN_ROUTES) \
            and not is_admin(req.user):
        raise HttpError(403, "réservé aux admins")


def after(req, status: int) -> None:
    """Après chaque requête : le journal des écritures (audit B5), puis le
    contexte est effacé."""
    try:
        if req.method not in ("GET", "HEAD", "OPTIONS") and getattr(req, "protected", False):
            u = getattr(req, "user", None)
            journal("http", user=u["id"] if u else None, method=req.method, path=req.path, status=status)
    except Exception:
        pass
    finally:
        set_current(None)


# ── les limites de débit (en mémoire) ───────────────────────
def _rate(key: str, n: int, window: float) -> None:
    now = time.time()
    with _lock:
        hits = [t for t in _hits.get(key, []) if now - t < window]
        if len(hits) >= n:
            raise HttpError(429, "trop d'essais : attends quelques minutes")
        hits.append(now)
        _hits[key] = hits


# ── ce que voit la page ─────────────────────────────────────
def public_user(u: dict) -> dict:
    return {"id": u["id"], "name": u["name"], "pseudo": u.get("pseudo") or u["name"], "role": u.get("role", "ami")}


def me(req) -> dict:
    if not enabled():
        return {"auth": False, "state": "active", "user": public_user(pseudo_admin()), "visibility": settings()["visibility"]}
    h, s, u = session_of(req)
    if not s:
        return {"auth": True, "state": "anonymous"}
    if s.get("refused"):
        return {"auth": True, "state": "refused", "name": s.get("name", "")}
    if not u:
        return {"auth": True, "state": "anonymous"}
    out = {"auth": True, "state": u["state"], "user": public_user(u), "since": u.get("created")}
    if u["state"] == "active" and _offnet(u, req):
        return {"auth": True, "state": "offnet", "user": public_user(u),
                "message": OFFNET.format(p=u.get("pseudo") or u["name"])}
    if u["state"] == "active":
        out["visibility"] = settings()["visibility"]
        if is_admin(u):
            with _lock:
                out["pending_requests"] = sum(1 for x in _data()["users"].values() if x.get("state") == "pending")
    return out


# ── entrer par son pseudo ───────────────────────────────────
def _find(key: str) -> dict | None:
    return next((u for u in _data()["users"].values() if key_of(u) == key), None)


def _imitation(key: str) -> str:
    """Pourquoi ce pseudo neuf est refusé : il imite un admin, un mot
    réservé, ou un pseudo existant ; "" s'il est libre."""
    sk = skeleton(key)
    users = list(_data()["users"].values())
    guarded = {skeleton(slug(admin_name())), skeleton(slug(admin_pseudo()))} | {skeleton(r) for r in RESERVED} \
        | {skeleton(key_of(u)) for u in users if u.get("role") == "admin"} \
        | {skeleton(u["id"]) for u in users if u.get("role") == "admin"}
    if sk in guarded:
        return "réservé"
    if any(skeleton(key_of(u)) == sk or u["id"] == key for u in users):
        return "trop proche"
    return ""


def enter(name, req) -> tuple[str, dict, str]:
    """Le pseudo tapé à la porte : (état, personne, jeton de session). Un
    pseudo accepté entre ; un pseudo inconnu devient une demande."""
    name = clean_name(name)
    if not valid_name(name):
        raise HttpError(400, "ton pseudo : de 2 à 24 lettres ou chiffres (espace, trait d'union, point permis)")
    key, ip = slug(name), _ip(req)
    _rate(f"entree:{ip}", 30, 600)
    with _lock:
        db = _data()
        u = _find(key)
        if u is None:
            why = _imitation(key)
            if why == "réservé":
                raise HttpError(409, f"« {name} » est réservé : choisis un autre pseudo")
            if why:
                raise HttpError(409, f"« {name} » ressemble trop à un pseudo qui existe déjà : choisis-en un autre")
            _rate(f"demande:{ip}", 5, 3600)
            pending = [x for x in db["users"].values() if x.get("state") == "pending"]
            if len(pending) >= 30:
                raise HttpError(429, "trop de demandes attendent déjà Cal : réessaie plus tard")
            if sum(1 for x in pending if x.get("ip") == ip) >= 3:
                raise HttpError(429, "trois demandes attendent déjà depuis cette adresse")
            u = {"id": key, "name": name, "pseudo": name, "role": "ami", "state": "pending", "created": now_iso(),
                 "ip": ip, "ua": (req.headers.get("User-Agent") or "")[:160], "quotas": {}}
            db["users"][key] = u
            _save()
            tok = _new_session(key, req)
            journal("demande", user=key, name=name, ip=ip)
            return "pending", dict(u), tok
        if u.get("state") == "suspended":
            raise HttpError(403, "ce compte est suspendu : vois avec Cal")
        if _offnet(u, req):
            raise HttpError(403, OFFNET.format(p=f"« {name} »"))
        tok = _new_session(u["id"], req)
    journal("entrée" if u["state"] == "active" else "demande rejointe", user=u["id"], ip=ip)
    return u["state"], dict(u), tok


def cancel_request(req) -> None:
    h, s, u = session_of(req)
    with _lock:
        db = _data()
        if h:
            db["sessions"].pop(h, None)
        if u and u.get("state") == "pending":
            db["users"].pop(u["id"], None)
            for k in [k for k, x in db["sessions"].items() if x.get("user") == u["id"]]:
                db["sessions"].pop(k, None)
        _save()
    if u:
        journal("demande annulée", user=u["id"])


def accept(uid: str, by: str) -> dict:
    with _lock:
        u = _data()["users"].get(uid)
        if not u or u.get("state") != "pending":
            raise HttpError(404, "pas de demande en attente à ce pseudo")
        u.update(state="active", accepted=now_iso(), by=by)
        _save()
    journal("accepté", user=uid, by=by)
    return dict(u)


def refuse(uid: str, by: str) -> None:
    with _lock:
        db = _data()
        u = db["users"].get(uid)
        if not u or u.get("state") != "pending":
            raise HttpError(404, "pas de demande en attente à ce pseudo")
        db["users"].pop(uid)
        for s in db["sessions"].values():
            if s.get("user") == uid:
                s.update(user=None, refused=True, name=u["name"])
        _save()
    journal("refusé", user=uid, by=by)


def logout(req) -> None:
    h, _, u = session_of(req)
    if h:
        with _lock:
            _data()["sessions"].pop(h, None)
            _save()
        journal("déconnexion", user=u["id"] if u else None)


# ── le compte de Cal ────────────────────────────────────────
def startup() -> None:
    """Au démarrage : plus d'amorçage par code (Cal, 29/09) ; le compte de
    Cal existe, pseudo `nico007`, admin, sous l'id `cal`."""
    (config.data_dir() / "admin-code.txt").unlink(missing_ok=True)
    if not enabled():
        return
    uid, pseudo = admin_id(), admin_pseudo()
    with _lock:
        db = _data()
        u = db["users"].get(uid)
        if not u:
            u = {"id": uid, "name": admin_name(), "pseudo": pseudo, "role": "admin", "state": "active",
                 "created": now_iso(), "quotas": {}}
            db["users"][uid] = u
            _save()
            journal("compte admin créé", user=uid, pseudo=pseudo)
        elif not u.get("pseudo") or not admins():
            if not u.get("pseudo"):   # le compte d'avant la décision du 29/09 prend son pseudo
                u["pseudo"] = pseudo
            if not admins():          # jamais sans admin
                u.update(role="admin", state="active")
            _save()
            journal("compte admin remis", user=uid, pseudo=u["pseudo"])


def cli_admin(pseudo: str) -> dict:
    """`showrunner.py --admin <pseudo>` : crée ou remet un pseudo admin. Le
    portail en marche relit auth.json quand il change."""
    name = clean_name(pseudo)
    if not valid_name(name):
        raise ValueError("un pseudo de 2 à 24 lettres ou chiffres")
    key = slug(name)
    with _lock:
        db = _data()
        u = _find(key)
        if not u:
            uid = key if key not in db["users"] else f"{key}-{secrets.token_hex(2)}"
            u = {"id": uid, "name": name, "pseudo": name, "created": now_iso(), "quotas": {}}
            db["users"][uid] = u
        u.update(role="admin", state="active")
        u.setdefault("accepted", now_iso())
        _save()
        out = dict(u)
    journal("admin (ligne de commande)", user=out["id"], pseudo=out.get("pseudo"))
    return out


# ── les personnes, pour la page d'admin ─────────────────────
def devices(uid: str, current_hash: str | None = None) -> list[dict]:
    with _lock:
        out = [{"id": h[:12], "created": s.get("created"), "seen": s.get("seen"), "ua": s.get("ua", ""),
                "ip": s.get("ip", ""), "current": h == current_hash}
               for h, s in _data()["sessions"].items() if s.get("user") == uid]
    return sorted(out, key=lambda d: d.get("seen") or "", reverse=True)


def revoke(uid: str, sid: str, by: str = "") -> int:
    if len(sid) < 12:
        raise HttpError(400, "connexion inconnue")
    with _lock:
        db = _data()
        gone = [h for h, s in db["sessions"].items() if s.get("user") == uid and h.startswith(sid)]
        for h in gone:
            db["sessions"].pop(h)
        _save()
    journal("connexion retirée", user=uid, by=by or uid)
    return len(gone)


def quotas_for(uid: str | None) -> dict:
    """Les quotas en vigueur (None : sans limite). Un admin n'en a pas."""
    u = user(uid)
    if not u or is_admin(u):
        return {"running": None, "queued": None, "per_day": None}
    q = dict(settings()["quotas"])
    for k, v in (u.get("quotas") or {}).items():
        if k in q and v is not None:
            q[k] = v
    return q


def users_public() -> list[dict]:
    with _lock:
        db = _data()
        sess: dict[str, list] = {}
        for s in db["sessions"].values():
            if s.get("user"):
                sess.setdefault(s["user"], []).append(s)
        out = []
        for u in db["users"].values():
            ss = sess.get(u["id"], [])
            out.append({"id": u["id"], "name": u["name"], "pseudo": u.get("pseudo") or u["name"],
                        "role": u.get("role", "ami"), "state": u.get("state"),
                        "created": u.get("created"), "accepted": u.get("accepted"), "ip": u.get("ip", ""),
                        "ua": u.get("ua", ""), "quotas": {k: (u.get("quotas") or {}).get(k) for k in QUOTA_FR},
                        "effective": quotas_for(u["id"]), "devices": len(ss),
                        "seen": max((s.get("seen") or "" for s in ss), default="")})
    return sorted(out, key=lambda x: (x["role"] != "admin", x["state"] != "pending", x["name"].lower()))


def set_user(uid: str, patch: dict, by: str) -> dict:
    with _lock:
        u = _data()["users"].get(uid)
        if not u:
            raise HttpError(404, "personne inconnue")
        if "role" in patch:
            if patch["role"] not in ("admin", "ami"):
                raise HttpError(400, "rôle : admin ou ami")
            if u.get("state") != "active":
                raise HttpError(409, "accepte ou réactive d'abord ce compte")
            if patch["role"] == "ami" and u.get("role") == "admin" and len(admins()) <= 1:
                raise HttpError(409, "c'est le dernier admin : donne d'abord le rôle à quelqu'un d'autre")
            u["role"] = patch["role"]
        if "state" in patch:
            if patch["state"] not in ("active", "suspended") or u.get("state") == "pending":
                raise HttpError(400, "état : active ou suspended (une demande s'accepte ou se refuse)")
            if patch["state"] == "suspended" and u.get("role") == "admin":
                raise HttpError(409, "un admin ne se suspend pas : retire-lui d'abord le rôle admin")
            u["state"] = patch["state"]
        if isinstance(patch.get("quotas"), dict):
            q = dict(u.get("quotas") or {})
            for k in QUOTA_FR:
                if k in patch["quotas"]:
                    q[k] = _quota_value(patch["quotas"][k], QUOTA_FR[k])
            u["quotas"] = q
        _save()
        out = dict(u)
    journal("personne", user=uid, by=by, patch=patch)
    return out


# ── le journal du portail ───────────────────────────────────
def _journal_file() -> Path:
    return config.data_dir() / "journal.jsonl"


def journal(event: str, **kw) -> None:
    line = json.dumps({"t": now_iso(), "event": event, **kw}, ensure_ascii=False, default=str)
    try:
        with _jlock:
            f = _journal_file()
            if f.exists() and f.stat().st_size > 5 << 20:
                f.replace(f.with_suffix(".1.jsonl"))
            with open(f, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
    except OSError:
        pass


def journal_tail(n: int = 200) -> list[dict]:
    f = _journal_file()
    if not f.exists():
        return []
    with open(f, "rb") as fh:
        fh.seek(0, 2)
        size = fh.tell()
        fh.seek(max(0, size - 400 * max(1, n)))
        lines = fh.read().decode("utf-8", "replace").splitlines()[-n:]
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return list(reversed(out))
