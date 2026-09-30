"""Teams et Workspaces : le socle (docs/etudes/equipes_espaces.md, étape 0,
décisions de Cal du 30/09/2026).

Le modèle
  - Un compte (auth.json) est une personne. Cal (rôle portail `admin`) est
    le super-admin de l'instance : il voit et règle toutes les Teams.
  - Une **Team** (`tea-…`) décide et paie : un nom, une offre (`plan` : apps
    | studio), l'interrupteur des API payantes (`api`, coupé par défaut), des
    membres avec un rôle de Team : `owner` (un seul), `admin`, `member`,
    `guest`. Le droit `access` d'aujourd'hui passe à la Team ; la Team
    personnelle d'un compte (« Chez moi ») a l'offre de son compte : un compte
    à `access: studio` → sa Team l'a (une seule vérité : auth.access_of).
  - Un **Workspace** (`esp-…`) est un lieu de travail d'une Team : ce qu'on y
    crée lui appartient (le champ `space` d'un objet ou d'un document ; sans
    lui, l'espace par défaut de l'instance, « Général » — le code n'a jamais
    de « sans Workspace »). Rôles de Workspace : `admin`, `editor`,
    `commenter`, `viewer` ; un membre de la Team y a le rôle par défaut du
    Workspace (`default_role`, « none » : sur invitation seulement) ou celui
    qu'on lui a posé ; un owner ou admin de Team est admin de chacun.
  - Un **guest** n'entre que dans les Workspaces où on l'a mis. Décision 2 de
    Cal : son rôle se règle dans l'administration d'un utilisateur —
    « viewer » (voit seulement) ou « acteur » (peut modifier). Viewer ou
    acteur, un guest ne consomme **jamais** de calcul (`can_compute` faux,
    quel que soit le coût) ni ne publie, ni n'invite.
  - Chaque compte (sauf un invité de planche, rôle portail `invite`, et un
    compte entré comme guest) a sa Team personnelle « Chez moi », seul, avec
    un Workspace « Perso » : l'offre Apps y crée ses Workspaces ; elle
    n'invite personne (inviter est du Studio).

L'API interne (pour les étapes suivantes ; auth.py en reprend l'essentiel)
  profile(u, espace)                 le profil de la matrice, ou None (n'y entre pas)
  can(u, espace, action) / judge(…)  la matrice MATRIX × les règles (archivé, API, offre) ;
                                     judge rend (oui, pourquoi pas)
  can_view, can_comment, can_edit, can_create, can_compute(u, e, coût), can_publish,
  can_invite(u, e), can_manage(u, team)
  can_trash_doc(u, doc), can_write_doc(u, doc), can_read_doc(u, doc)   (étape 2)
  space_of(doc)                      l'espace d'un objet ou d'un document (défaut : Général)
  resolve(u, voulu) → (espace, refus)   l'espace courant d'une requête (auth.gate)
  wanted(req)                        l'en-tête X-SR-Espace, sinon ?e=
  plan_of_space(e) / team_of_space(e)
  garde_prete(nom)                   l'étape 1 (« calcul ») et l'étape 2 (« bibliotheque »)
                                     déclarent leur garde ; sans les deux, on ne fait pas de guest
  migrate(root, dry) → rapport       la migration (étape 3), idempotente

Stockage : `<data_dir>/teams.json` (relu s'il change, écrit d'un bloc) :
  {"v": 1, "default": "esp-general",
   "teams":  {id: {id, name, plan, personal, owner, api, created, by, archived,
                   members: {uid: {role, guest?, since, by, via?}}}},
   "spaces": {id: {id, team, name, default_role, created, by, archived,
                   members: {uid: {role} | {guest: true}}}},
   "invites": {id: {id, h, team, role, guest, spaces, hours, created, exp, by, revoked, uses}},
   "users":  {uid: {last}}}
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from . import auth, config
from .http import HttpError

# ── les rôles, les mots ─────────────────────────────────────
TEAM_ROLES = ("owner", "admin", "member", "guest")
SPACE_ROLES = ("admin", "editor", "commenter", "viewer")
GUEST_MODES = ("viewer", "acteur")
PLANS = ("apps", "studio")
COSTS = ("none", "cpu", "gpu", "api")
HOURS = (24, 72, 168, 720)
NIRVALAB, GENERAL = "tea-nirvalab", "esp-general"
HEADER, PARAM = "X-SR-Espace", "e"
TEAM_RX = re.compile(r"tea-[a-z0-9][a-z0-9-]{1,47}")
SPACE_RX = re.compile(r"esp-[a-z0-9][a-z0-9-]{1,47}")
TOKEN_RX = re.compile(r"(inv-[0-9a-f]{8})\.([A-Za-z0-9_-]{20,64})")

TEAM_FR = {"owner": "propriétaire", "admin": "admin", "member": "membre", "guest": "guest"}
SPACE_FR = {"admin": "admin", "editor": "éditeur", "commenter": "commentateur", "viewer": "lecteur", "none": "sur invitation"}
GUEST_FR = {"viewer": "viewer · voit seulement", "acteur": "acteur · peut modifier"}

# ── la matrice (équipes_espaces.md § 2.4, décision 2 de Cal pour les guests) ──
# Les profils : ce que la personne est DANS ce Workspace.
PROFILES = ("viewer", "commenter", "guest_viewer", "guest_acteur", "editor", "space_admin", "team_admin", "portal_admin")
_ALL = frozenset(PROFILES)
_MAKERS = frozenset({"guest_acteur", "editor", "space_admin", "team_admin", "portal_admin"})
_COMPUTERS = frozenset({"editor", "space_admin", "team_admin", "portal_admin"})   # jamais un guest
_ADMINS = frozenset({"space_admin", "team_admin", "portal_admin"})
MATRIX: dict[str, frozenset] = {
    "view": _ALL,                                   # objets, documents, file du Workspace
    "export_file": _ALL,                            # un fichier déjà fait (zip) : ne calcule rien
    "comment": _ALL - {"viewer", "guest_viewer"},   # le viewer de Cal « voit seulement »
    "edit": _MAKERS,                                # planche, séquence, projet, titre, dossier, tags
    "create": _MAKERS,                              # planche, séquence, projet, dépôt de fichier
    "import": _MAKERS,                              # rapatrier un asset DANS ce Workspace
    "trash_own": _MAKERS,
    "trash_any": _ADMINS,
    "compute_cpu": _COMPUTERS,                      # Cal : un guest ne consomme JAMAIS de calcul
    "compute_gpu": _COMPUTERS,                      # + le budget de la Team (étape 8)
    "compute_api": _COMPUTERS,                      # + l'API ouverte à la Team (sauf Cal)
    "publish": _COMPUTERS,                          # publier une version calcule sa source
    "export_package": _COMPUTERS,                   # une remise de travail (package_export.md)
    "invite_space": _ADMINS,
    "manage_team": frozenset({"team_admin", "portal_admin"}),
    "admin_portal": frozenset({"portal_admin"}),
}
ACTIONS = tuple(MATRIX)
# ce qu'un Workspace (ou une Team) archivé garde : la lecture, et de quoi le rouvrir
ARCHIVED_OK = frozenset({"view", "export_file", "manage_team", "admin_portal"})

_lock = threading.RLock()
_db: dict | None = None
_stamp: tuple | None = None
_broken = ""
_local = threading.local()
GARDES = {"calcul": False, "bibliotheque": False}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def clean_name(name, what: str = "le nom") -> str:
    s = " ".join(str(name or "").split())
    s = "".join(ch for ch in s if ch.isprintable())
    if not 1 <= len(s) <= 40:
        raise HttpError(400, f"{what} : de 1 à 40 caractères")
    return s


# ── le fichier ──────────────────────────────────────────────
def _empty() -> dict:
    return {"v": 1, "default": None, "teams": {}, "spaces": {}, "invites": {}, "users": {}}


def _file(root: Path | None = None) -> Path:
    return (Path(root) if root else config.data_dir()) / "teams.json"


def _read(f: Path) -> dict:
    db = json.loads(f.read_text(encoding="utf-8"))
    if not isinstance(db, dict):
        raise ValueError("teams.json : un objet attendu")
    for k, v in _empty().items():
        db.setdefault(k, v if not isinstance(v, dict) else {})
    return db


def _data() -> dict:
    """La base en mémoire, relue si le fichier a changé (la migration l'écrit
    portail arrêté ; un autre processus peut l'écrire). Un fichier illisible
    n'est jamais écrasé : lecture seule jusqu'à ce qu'on le répare."""
    global _db, _stamp, _broken
    f = _file()
    try:
        st = f.stat()
        stamp = (str(f), st.st_mtime_ns, st.st_size)
    except OSError:
        stamp = (str(f), 0, 0)
    if _db is None or stamp != _stamp:
        if stamp[1]:
            try:
                db, _broken = _read(f), ""
            except (OSError, ValueError) as e:
                _broken = f"teams.json illisible ({e}) : rien ne s'y écrit tant qu'il n'est pas réparé"
                db = _db if (_db is not None and _stamp and _stamp[0] == str(f)) else _empty()
        else:
            db, _broken = _empty(), ""
        _db, _stamp = db, stamp
    return _db


def _save() -> None:
    global _stamp
    if _broken:
        raise HttpError(503, _broken)
    f = _file()
    tmp = f.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(_db, fh, ensure_ascii=False, indent=1)
    tmp.replace(f)
    st = f.stat()
    _stamp = (str(f), st.st_mtime_ns, st.st_size)


def reset_for_tests() -> None:
    global _db, _stamp, _broken
    with _lock:
        _db, _stamp, _broken = None, None, ""


def garde_prete(nom: str) -> None:
    """L'étape 1 appelle `garde_prete("calcul")` quand jobs.submit juge can_compute ;
    l'étape 2 `garde_prete("bibliotheque")` quand la bibliothèque juge par Workspace.
    Tant que les deux ne sont pas là, faire un guest est refusé (409, qui le dit) :
    un guest ne doit ni calculer ni voir hors de ses Workspaces, par construction."""
    if nom in GARDES:
        GARDES[nom] = True


def _guests_ok() -> None:
    if all(GARDES.values()) or config.get("equipes_guests_essai") is True:
        return
    manque = [k for k, v in GARDES.items() if not v]
    raise HttpError(409, "pas encore de guest : les gardes du " + " et de la ".join(
        {"calcul": "calcul (étape 1 : jobs.submit)", "bibliotheque": "bibliothèque (étape 2 : par Workspace)"}[k]
        for k in manque) + " ne sont pas en place — un guest pourrait calculer ou tout voir")


# ── lire ────────────────────────────────────────────────────
def _uid(u) -> str | None:
    return (u or {}).get("id")


def _active(u) -> bool:
    return bool(u) and u.get("state", "active") == "active"


def default_space() -> str | None:
    with _lock:
        db = _data()
        d = db.get("default")
        return d if d in db["spaces"] else None


def space(sid: str | None) -> dict | None:
    with _lock:
        sp = _data()["spaces"].get(sid or "")
        return dict(sp) if sp else None


def team(tid: str | None) -> dict | None:
    with _lock:
        t = _data()["teams"].get(tid or "")
        return dict(t) if t else None


def team_of_space(sid: str | None) -> str | None:
    sp = space(sid)
    return sp["team"] if sp else None


def space_of(doc: dict | None, owner: str | None = None) -> str | None:
    """L'espace d'un objet ou d'un document : son champ `space`, sinon l'espace par
    défaut de l'instance (Général, après la migration), sinon le Workspace perso de
    son propriétaire (sans migration). Pour l'étape 2 : jamais « sans espace »."""
    s = (doc or {}).get("space")
    if isinstance(s, str) and s:
        return s
    d = default_space()
    if d:
        return d
    who = owner or auth.owner_of(doc or {}) or auth.admin_id()
    return personal_space_id(who)


def plan_of(t: dict | None) -> str:
    """L'offre d'une Team. La Team personnelle a celle de son compte (auth.access_of,
    sans espace : le droit `access` d'avant) ; les autres, la leur."""
    if not t:
        return "apps"
    if t.get("personal"):
        return auth.access_of(auth.user(t.get("owner")))
    return t.get("plan") if t.get("plan") in PLANS else "apps"


def plan_of_space(sid: str | None) -> str | None:
    with _lock:
        db = _data()
        sp = db["spaces"].get(sid or "")
        t = db["teams"].get(sp["team"]) if sp else None
    return plan_of(t) if t else None


def team_role(u, tid: str | None) -> str | None:
    with _lock:
        t = _data()["teams"].get(tid or "")
        m = (t or {}).get("members", {}).get(_uid(u) or "")
        return m.get("role") if m else None


def _profile(db: dict, u, sid: str, superpower: bool = True) -> str | None:
    sp = db["spaces"].get(sid or "")
    if not sp:
        return None
    if u is None:   # le socle, un travail système : comme auth (personne = tout)
        return "portal_admin"
    if not _active(u):
        return None
    if superpower and auth.is_admin(u):
        return "portal_admin"
    t = db["teams"].get(sp["team"])
    if not t:
        return None
    uid = _uid(u)
    m = t.get("members", {}).get(uid)
    if not m:
        return None
    if m.get("role") in ("owner", "admin"):
        return "team_admin"
    mine = sp.get("members", {}).get(uid) or {}
    if m.get("role") == "guest":
        if not mine.get("guest"):
            return None
        return "guest_acteur" if m.get("guest") == "acteur" else "guest_viewer"
    r = mine.get("role") or sp.get("default_role") or "editor"
    return {"admin": "space_admin", "editor": "editor", "commenter": "commenter", "viewer": "viewer"}.get(r)


def profile(u, sid: str | None) -> str | None:
    with _lock:
        return _profile(_data(), u, sid or "")


def space_role(u, sid: str | None) -> str | None:
    """Le rôle effectif, en mots de Workspace (admin, editor, commenter, viewer)."""
    p = profile(u, sid)
    return {"portal_admin": "admin", "team_admin": "admin", "space_admin": "admin", "editor": "editor",
            "guest_acteur": "editor", "commenter": "commenter", "viewer": "viewer", "guest_viewer": "viewer"}.get(p or "")


WHY = {
    "none": "tu n'es pas dans ce Workspace",
    "archived": "ce Workspace est archivé : lecture seule (un admin de la Team le rouvre)",
    "guest_compute": "guest : calculer et publier sont réservés aux membres de la Team — demande à un admin de la Team",
    "role": "ton rôle dans ce Workspace ({role}) ne le permet pas — demande à un admin du Workspace",
    "api": "l'API payante est coupée pour cette Team — un admin de la Team l'ouvre",
    "personal": "« Chez moi » est une Team personnelle : elle n'invite personne — crée une Team pour inviter",
    "apps": "offre Apps : inviter est du Studio — demande le Studio à Cal",
}


def judge(u, sid: str | None, action: str) -> tuple[bool, str | None]:
    """(oui, pourquoi pas) pour une action de MATRIX dans un Workspace."""
    if action not in MATRIX:
        raise ValueError(f"action inconnue : {action}")
    with _lock:
        db = _data()
        sp = db["spaces"].get(sid or "")
        p = _profile(db, u, sid or "")
        if not sp or not p:
            return False, WHY["none"]
        t = db["teams"].get(sp["team"]) or {}
        if p not in MATRIX[action]:
            if p.startswith("guest") and (action.startswith("compute") or action in ("publish", "export_package")):
                return False, WHY["guest_compute"]
            label = p.replace("_", " ") if p.startswith("guest") else SPACE_FR.get(space_role(u, sid) or "", p)
            return False, WHY["role"].format(role=label)
        if (sp.get("archived") or t.get("archived")) and action not in ARCHIVED_OK:
            return False, WHY["archived"]
        if p == "portal_admin":
            if action in ("invite_space",) and t.get("personal"):
                return False, WHY["personal"]
            return True, None
        if action == "compute_api" and not t.get("api"):
            return False, WHY["api"]
        if action == "invite_space":
            if t.get("personal"):
                return False, WHY["personal"]
            if plan_of(t) != "studio":
                return False, WHY["apps"]
    return True, None


def can(u, sid: str | None, action: str) -> bool:
    return judge(u, sid, action)[0]


def can_view(u, sid) -> bool:
    return can(u, sid, "view")


def can_comment(u, sid) -> bool:
    return can(u, sid, "comment")


def can_edit(u, sid) -> bool:
    return can(u, sid, "edit")


def can_create(u, sid) -> bool:
    return can(u, sid, "create")


def can_compute(u, sid, cost: str = "gpu") -> bool:
    """Le juge du calcul (étape 1 : jobs.submit l'appelle avec le coût déclaré de la
    sorte ; `none` ne calcule rien). Un guest : jamais, quel que soit le coût."""
    if cost == "none":
        return can(u, sid, "create")   # rien de calculé, mais un travail crée : qui peut créer
    if cost not in COSTS:
        cost = "gpu"   # un coût inconnu vaut le plus cher des locaux : l'oubli est refusé, jamais permis
    return can(u, sid, f"compute_{cost}")


def can_publish(u, sid) -> bool:
    return can(u, sid, "publish")


def can_invite(u, sid) -> bool:
    return can(u, sid, "invite_space")


def can_manage(u, tid: str | None) -> bool:
    """Gérer une Team : son propriétaire, ses admins, Cal."""
    if u is None or auth.is_admin(u):
        return team(tid) is not None
    if not _active(u):
        return False
    return team_role(u, tid) in ("owner", "admin")


# les documents (étape 2 : library.check_write, can_read_item y passeront)
def can_read_doc(u, doc: dict) -> bool:
    return can_view(u, space_of(doc))


def can_write_doc(u, doc: dict) -> bool:
    """Décision 9 (recommandée) : dans un Workspace partagé, tout éditeur modifie."""
    return can_edit(u, space_of(doc))


def can_trash_doc(u, doc: dict) -> bool:
    """La corbeille : l'auteur (s'il peut encore modifier), ou un admin du Workspace."""
    s = space_of(doc)
    if can(u, s, "trash_any"):
        return True
    return can(u, s, "trash_own") and auth.owner_of(doc) == _uid(u)


# ── l'espace courant d'une requête ──────────────────────────
def wanted(req) -> str | None:
    """L'espace que demande la page : l'en-tête X-SR-Espace (posé par api() de
    commun/shell.js, étape 4), sinon ?e= (les flux SSE, les liens)."""
    v = (req.headers.get(HEADER) or "").strip() or (req.q(PARAM) or "").strip()
    return v[:64] or None


def _eligible(u) -> bool:
    """Un compte a sa Team personnelle, sauf l'invité d'une planche (rôle portail
    `invite`) et un compte entré comme guest (`perso: false`)."""
    return bool(u) and u.get("role") != auth.GUEST and u.get("perso", True) is not False


def personal_team_id(uid: str) -> str:
    return f"tea-perso-{uid}"


def personal_space_id(uid: str) -> str:
    return f"esp-perso-{uid}"


def _ensure_personal(db: dict, uid: str, by: str = "", now: str | None = None) -> tuple[str, bool]:
    """La Team « Chez moi » et son Workspace « Perso » (idempotent) ; (espace, créé ?)."""
    tid, sid = personal_team_id(uid), personal_space_id(uid)
    now = now or now_iso()
    made = False
    if tid not in db["teams"]:
        db["teams"][tid] = {"id": tid, "name": "Chez moi", "plan": None, "personal": True, "owner": uid, "api": False,
                            "created": now, "by": by or uid, "archived": None,
                            "members": {uid: {"role": "owner", "since": now, "by": by or uid}}}
        made = True
    if sid not in db["spaces"]:
        db["spaces"][sid] = {"id": sid, "team": tid, "name": "Perso", "default_role": "editor", "created": now,
                             "by": by or uid, "archived": None, "members": {}}
        made = True
    return sid, made


def ensure_personal(u) -> str | None:
    if not _eligible(u) or not _active(u):
        return None
    uid = _uid(u)
    with _lock:
        db = _data()
        if personal_team_id(uid) in db["teams"] and personal_space_id(uid) in db["spaces"]:
            return personal_space_id(uid)
        if _broken:
            return None
        sid, made = _ensure_personal(db, uid)
        if made:
            _save()
    if made:
        auth.journal("team personnelle", user=uid)
    return sid


def _visible_spaces(db: dict, u, superpower: bool) -> list[str]:
    return [sid for sid in db["spaces"] if _profile(db, u, sid, superpower)]


def default_for(u) -> str | None:
    """Sans en-tête : le dernier Workspace de la personne s'il lui est encore ouvert,
    sinon Général (l'espace par défaut de l'instance), sinon le premier Workspace d'une
    Team où elle est, sinon son Workspace perso."""
    if not u:
        return None
    uid = _uid(u)
    ensure_personal(u)   # chaque compte a sa Team « Chez moi » dès sa première requête (idempotent)
    with _lock:
        db = _data()
        live = lambda s: (s in db["spaces"] and not db["spaces"][s].get("archived")   # noqa: E731
                          and not (db["teams"].get(db["spaces"][s]["team"]) or {}).get("archived"))
        last = (db["users"].get(uid) or {}).get("last")
        if last and live(last) and _profile(db, u, last):
            return last
        d = db.get("default")
        if d and live(d) and _profile(db, u, d, superpower=False):
            return d
        mine = [s for s in _visible_spaces(db, u, superpower=False) if live(s)]
        shared = [s for s in mine if not db["teams"][db["spaces"][s]["team"]].get("personal")]
        if shared:
            return sorted(shared, key=lambda s: (db["teams"][db["spaces"][s]["team"]]["name"].lower(),
                                                 db["spaces"][s].get("created") or ""))[0]
        if personal_space_id(uid) in db["spaces"] and live(personal_space_id(uid)):
            return personal_space_id(uid)
    return ensure_personal(u) or (d if d and auth.is_admin(u) else None)


def resolve(u, want: str | None = None) -> tuple[str | None, str | None]:
    """(l'espace courant, la raison du refus de `want`). Un espace demandé qu'on ne
    peut pas voir (inconnu, d'une autre Team) n'est jamais pris : la porte répond 403
    sur une route protégée (auth.gate), l'espace par défaut sinon."""
    if not u:
        return None, None
    ensure_personal(u)
    if want:
        if not SPACE_RX.fullmatch(want):
            return default_for(u), f"Workspace refusé : « {want[:40]} » n'est pas un identifiant de Workspace"
        if can_view(u, want):
            return want, None
        return default_for(u), f"Workspace {want} : inconnu, ou pas pour toi"
    return default_for(u), None


def set_last(u, sid: str) -> str:
    if not can_view(u, sid):
        raise HttpError(404, f"Workspace {sid} : inconnu, ou pas pour toi")
    with _lock:
        db = _data()
        rec = db["users"].setdefault(_uid(u), {})
        if rec.get("last") != sid:
            rec["last"] = sid
            _save()
    return sid


# ── ce que voit la page ─────────────────────────────────────
def _can_map(u, sid: str) -> dict:
    out, why = {}, {}
    for key, action in (("view", "view"), ("comment", "comment"), ("edit", "edit"), ("create", "create"),
                        ("import", "import"), ("compute", "compute_gpu"), ("compute_api", "compute_api"),
                        ("publish", "publish"), ("invite", "invite_space"), ("trash", "trash_any")):
        ok, w = judge(u, sid, action)
        out[key] = ok
        if not ok and w:
            why[key] = w
    return {"can": out, "why": why}


def _space_public(db: dict, u, sid: str, detail: bool) -> dict:
    sp = db["spaces"][sid]
    out = {"id": sid, "name": sp["name"], "team": sp["team"], "archived": sp.get("archived"),
           "default_role": sp.get("default_role") or "editor", "role": space_role(u, sid), "profile": profile(u, sid),
           **_can_map(u, sid)}
    if detail:
        out["members"] = {k: dict(v) for k, v in (sp.get("members") or {}).items()}
    return out


def _team_public(db: dict, u, tid: str, detail: bool) -> dict:
    t = db["teams"][tid]
    uid = _uid(u)
    me = t.get("members", {}).get(uid) or {}
    manage = can_manage(u, tid)
    sids = [s for s, sp in db["spaces"].items() if sp["team"] == tid]
    seen = [s for s in sids if _profile(db, u, s)]
    sids = sorted(seen, key=lambda s: (bool(db["spaces"][s].get("archived")), db["spaces"][s].get("created") or ""))
    inv_ok, inv_why = True, None
    if t.get("personal"):
        inv_ok, inv_why = False, WHY["personal"]
    elif plan_of(t) != "studio" and not auth.is_admin(u):
        inv_ok, inv_why = False, WHY["apps"]
    elif not manage:
        inv_ok, inv_why = False, "inviter dans la Team : son propriétaire ou un de ses admins"
    out = {"id": tid, "name": t["name"], "plan": plan_of(t), "personal": bool(t.get("personal")), "owner": t.get("owner"),
           "owner_name": auth.display_name(t.get("owner")), "api": bool(t.get("api")), "archived": t.get("archived"),
           "role": me.get("role") or ("admin" if auth.is_admin(u) else None), "guest": me.get("guest"),
           "manage": manage, "invite": inv_ok, "invite_why": inv_why,
           "spaces": [_space_public(db, u, s, detail and manage) for s in sids]}
    if detail and (manage or me.get("role") in ("owner", "admin", "member")):
        rows = []
        for mid, m in t.get("members", {}).items():
            x = auth.user(mid) or {}
            rows.append({"id": mid, "name": x.get("name") or mid, "pseudo": x.get("pseudo") or x.get("name") or mid,
                         "state": x.get("state"), "role": m.get("role"), "guest": m.get("guest"), "since": m.get("since"),
                         "spaces": [s for s, sp in db["spaces"].items() if sp["team"] == tid
                                    and (sp.get("members") or {}).get(mid)]})
        order = {r: i for i, r in enumerate(TEAM_ROLES)}
        out["members"] = sorted(rows, key=lambda r: (order.get(r["role"], 9), r["name"].lower()))
    if detail and manage:
        now = time.time()
        out["invites"] = [_invite_public(i) for i in db["invites"].values()
                          if i.get("team") == tid and not i.get("revoked") and i.get("exp", 0) > now]
    return out


def teams_of(u, *, detail: bool = False, everyone: bool = False) -> list[dict]:
    """Les Teams de la personne (Cal avec `everyone` : toutes), les Workspaces qu'elle y
    voit, ses droits dans chacun (et, `detail`, les membres et les liens pour qui gère)."""
    if not u:
        return []
    with _lock:
        db = _data()
        uid = _uid(u)
        ids = [tid for tid, t in db["teams"].items()
               if uid in t.get("members", {}) or (everyone and auth.is_admin(u))]
        out = [_team_public(db, u, tid, detail) for tid in ids]
    return sorted(out, key=lambda t: (bool(t["archived"]), t["personal"], t["name"].lower()))


def space_public(u, sid: str | None) -> dict | None:
    if not sid:
        return None
    with _lock:
        db = _data()
        if sid not in db["spaces"]:
            return None
        out = _space_public(db, u, sid, False)
        t = db["teams"].get(out["team"]) or {}
        out.update(team_name=t.get("name"), plan=plan_of(t), personal=bool(t.get("personal")))
    return out


def me_payload(u, current: str | None, refused: str | None = None) -> dict:
    """Ce que /api/auth/me ajoute : les Teams et Workspaces de la personne, le courant."""
    out = {"teams": teams_of(u), "workspace": space_public(u, current)}
    if refused:
        out["workspace_refused"] = refused
    return out


# ── écrire : Teams, Workspaces, membres ─────────────────────
def _need(ok: bool, why: str) -> None:
    if not ok:
        raise HttpError(403, why)


def _team_or_404(db: dict, tid: str) -> dict:
    t = db["teams"].get(tid or "") if TEAM_RX.fullmatch(tid or "") else None
    if not t:
        raise HttpError(404, f"Team inconnue : {tid}")
    return t


def _space_or_404(db: dict, sid: str) -> dict:
    sp = db["spaces"].get(sid or "") if SPACE_RX.fullmatch(sid or "") else None
    if not sp:
        raise HttpError(404, f"Workspace inconnu : {sid}")
    return sp


def _see_team(u, tid: str) -> None:
    """Une Team où l'on n'est pas (et qu'on ne gère pas) : 404, on ne dit pas qu'elle existe."""
    if not (can_manage(u, tid) or team_role(u, tid)):
        raise HttpError(404, f"Team inconnue : {tid}")


def create_team(u, name, plan: str | None = None) -> dict:
    """Créer une Team : Cal, ou un compte qui a le Studio (inviter est du Studio). Elle
    naît avec un Workspace « Général » ; son offre : celle de son créateur (Cal choisit)."""
    name = clean_name(name, "le nom de la Team")
    _need(u is not None and (auth.is_admin(u) or (auth.has_studio(u) and _eligible(u))),
          "créer une Team : le Studio (ton compte ouvre les Apps) — demande-le à Cal")
    if plan is not None and not auth.is_admin(u):
        raise HttpError(403, "l'offre d'une Team : Cal la règle")
    plan = plan or ("studio" if auth.has_studio(u) else "apps")
    if plan not in PLANS:
        raise HttpError(400, "l'offre : apps ou studio")
    uid, now = _uid(u) or auth.admin_id(), now_iso()
    with _lock:
        db = _data()
        tid = f"tea-{secrets.token_hex(4)}"
        sid = f"esp-{secrets.token_hex(4)}"
        db["teams"][tid] = {"id": tid, "name": name, "plan": plan, "personal": False, "owner": uid, "api": False,
                            "created": now, "by": uid, "archived": None,
                            "members": {uid: {"role": "owner", "since": now, "by": uid}}}
        db["spaces"][sid] = {"id": sid, "team": tid, "name": "Général", "default_role": "editor", "created": now,
                             "by": uid, "archived": None, "members": {}}
        _save()
    auth.journal("team créée", user=uid, team=tid, name=name, plan=plan)
    return team_view(u, tid)


def team_view(u, tid: str) -> dict:
    with _lock:
        db = _data()
        _team_or_404(db, tid)
        _see_team(u, tid)
        return _team_public(db, u, tid, True)


def update_team(u, tid: str, patch: dict) -> dict:
    """Renommer (qui gère), archiver ou rouvrir (le propriétaire, Cal), l'offre (Cal),
    l'API payante (qui gère : ouverte ou coupée)."""
    with _lock:
        db = _data()
        t = _team_or_404(db, tid)
        _see_team(u, tid)
        _need(can_manage(u, tid), "réglages de la Team : son propriétaire ou un de ses admins")
        done = {}
        if "name" in patch:
            if t.get("personal"):
                raise HttpError(409, "« Chez moi » garde son nom : c'est ta Team personnelle")
            t["name"] = done["name"] = clean_name(patch["name"], "le nom de la Team")
        if "plan" in patch:
            _need(auth.is_admin(u), "l'offre d'une Team : Cal la règle")
            if t.get("personal"):
                raise HttpError(409, "l'offre de « Chez moi » est celle du compte : Admin → Personnes, Apps ou Studio")
            if patch["plan"] not in PLANS:
                raise HttpError(400, "l'offre : apps ou studio")
            t["plan"] = done["plan"] = patch["plan"]
        if "api" in patch:
            t["api"] = done["api"] = bool(patch["api"])
        if "archived" in patch:
            _need(u is None or auth.is_admin(u) or t.get("owner") == _uid(u), "archiver une Team : son propriétaire, ou Cal")
            if t.get("personal"):
                raise HttpError(409, "« Chez moi » ne s'archive pas : archive ses Workspaces")
            if t["id"] == team_of_space(db.get("default")) and patch["archived"]:
                raise HttpError(409, "cette Team porte le Workspace par défaut de l'instance : elle ne s'archive pas")
            t["archived"] = done["archived"] = now_iso() if patch["archived"] else None
        if done:
            _save()
    if done:
        auth.journal("team", user=_uid(u), team=tid, patch=done)
    return team_view(u, tid)


def create_space(u, tid: str, name, default_role: str = "editor") -> dict:
    name = clean_name(name, "le nom du Workspace")
    if default_role not in SPACE_ROLES + ("none",):
        raise HttpError(400, "le rôle par défaut : admin, editor, commenter, viewer ou none")
    with _lock:
        db = _data()
        t = _team_or_404(db, tid)
        _see_team(u, tid)
        _need(can_manage(u, tid), "créer un Workspace : le propriétaire ou un admin de la Team")
        if t.get("archived"):
            raise HttpError(409, "cette Team est archivée : rouvre-la d'abord")
        sid = f"esp-{secrets.token_hex(4)}"
        uid = _uid(u) or auth.admin_id()
        db["spaces"][sid] = {"id": sid, "team": tid, "name": name, "default_role": default_role, "created": now_iso(),
                             "by": uid, "archived": None, "members": {}}
        _save()
        out = _space_public(db, u, sid, True)
    auth.journal("workspace créé", user=_uid(u), team=tid, space=sid, name=name)
    return out


def update_space(u, sid: str, patch: dict) -> dict:
    """Renommer (qui gère la Team, l'admin du Workspace), le rôle par défaut, archiver ou
    rouvrir (qui gère la Team). Une Team garde toujours un Workspace ouvert ; le
    Workspace par défaut de l'instance ne s'archive pas."""
    with _lock:
        db = _data()
        sp = _space_or_404(db, sid)
        tid = sp["team"]
        _need(can_view(u, sid) or can_manage(u, tid), f"Workspace inconnu : {sid}")
        manage = can_manage(u, tid)
        _need(manage or can(u, sid, "invite_space") or profile(u, sid) == "space_admin",
              "réglages du Workspace : un admin du Workspace ou de la Team")
        done = {}
        if "name" in patch:
            sp["name"] = done["name"] = clean_name(patch["name"], "le nom du Workspace")
        if "default_role" in patch:
            if patch["default_role"] not in SPACE_ROLES + ("none",):
                raise HttpError(400, "le rôle par défaut : admin, editor, commenter, viewer ou none")
            sp["default_role"] = done["default_role"] = patch["default_role"]
        if "archived" in patch:
            _need(manage, "archiver un Workspace : un admin de la Team")
            if patch["archived"]:
                if sid == db.get("default"):
                    raise HttpError(409, "c'est le Workspace par défaut de l'instance (Général) : il ne s'archive pas")
                others = [s for s, x in db["spaces"].items() if x["team"] == tid and s != sid and not x.get("archived")]
                if not others:
                    raise HttpError(409, "c'est le dernier Workspace ouvert de la Team : crée-en un autre d'abord")
            sp["archived"] = done["archived"] = now_iso() if patch["archived"] else None
        if done:
            _save()
        out = _space_public(db, u, sid, manage)
    if done:
        auth.journal("workspace", user=_uid(u), space=sid, patch=done)
    return out


def _rank(m: dict | None) -> int:
    return {"owner": 4, "admin": 3, "member": 2, "guest": 1}.get((m or {}).get("role"), 0)


def _set_guest_spaces(db: dict, tid: str, uid: str, spaces: list[str], by: str, now: str, replace: bool) -> None:
    for s, sp in db["spaces"].items():
        if sp["team"] != tid:
            continue
        mem = sp.setdefault("members", {})
        if s in spaces:
            mem[uid] = {"guest": True, "since": (mem.get(uid) or {}).get("since") or now, "by": by}
        elif replace:
            mem.pop(uid, None)


def _check_spaces(db: dict, tid: str, spaces) -> list[str]:
    if spaces is None:
        return []
    if not isinstance(spaces, list) or len(spaces) > 200:
        raise HttpError(400, "les Workspaces : une liste d'identifiants")
    out = []
    for s in spaces:
        sp = db["spaces"].get(s) if isinstance(s, str) else None
        if not sp or sp["team"] != tid:
            raise HttpError(400, f"Workspace inconnu dans cette Team : {s}")
        if s not in out:
            out.append(s)
    return out


def _may_invite(u, db: dict, t: dict, role: str, spaces: list[str]) -> None:
    """Inviter : l'admin de Team (tout rôle sauf owner ; admin : le propriétaire ou Cal) ;
    l'admin d'un Workspace fait des guests dans ses Workspaces, rien d'autre."""
    tid = t["id"]
    if t.get("personal"):
        raise HttpError(409, WHY["personal"])
    if t.get("archived"):
        raise HttpError(409, "cette Team est archivée : rouvre-la d'abord")
    if plan_of(t) != "studio" and not auth.is_admin(u):
        raise HttpError(403, WHY["apps"])
    if role not in ("admin", "member", "guest"):
        raise HttpError(400, "le rôle : admin, member ou guest (le propriétaire est unique)")
    if role == "admin":
        _need(u is None or auth.is_admin(u) or t.get("owner") == _uid(u), "faire un admin de Team : son propriétaire, ou Cal")
    if can_manage(u, tid):
        return
    _need(role == "guest" and spaces and all(can(u, s, "invite_space") for s in spaces),
          "inviter : un admin de la Team ; un admin de Workspace fait des guests dans ses Workspaces")


def add_member(u, tid: str, who, role: str = "member", guest: str | None = None, spaces=None) -> dict:
    """Mettre quelqu'un dans la Team par son pseudo. Un pseudo qui n'existe pas encore
    est créé ici, déjà accepté (il entre en le tapant, comme un pseudo que Cal ajoute) —
    un guest sans Team personnelle ni Studio : il ne calcule nulle part."""
    guest = guest or ("viewer" if role == "guest" else None)
    if role == "guest" and guest not in GUEST_MODES:
        raise HttpError(400, "un guest : viewer ou acteur")
    if role == "guest":
        _guests_ok()
    created = None
    with _lock:
        db = _data()
        t = _team_or_404(db, tid)
        _see_team(u, tid)
        spaces = _check_spaces(db, tid, spaces)
        _may_invite(u, db, t, role, spaces)
        target = auth.find_pseudo(who)
    if target is None:
        created = auth.create_invited(who, by=_uid(u) or auth.admin_id(), guest=(role == "guest"))
        target = created
    if target.get("role") == auth.GUEST:
        raise HttpError(409, f"« {target.get('name')} » est un invité de planche (Idéation) : fais-en d'abord un ami dans Admin")
    if target.get("state") != "active":
        raise HttpError(409, f"« {target.get('name')} » n'est pas actif (en attente ou suspendu) : vois avec Cal")
    uid, by, now = target["id"], _uid(u) or auth.admin_id(), now_iso()
    with _lock:
        db = _data()
        t = db["teams"][tid]
        cur = t["members"].get(uid)
        if cur and _rank(cur) >= _rank({"role": role}) and role != "guest":
            pass   # déjà là, au moins à ce rang : jamais de recul
        elif cur and cur.get("role") in ("owner", "admin", "member") and role == "guest":
            raise HttpError(409, f"« {target['name']} » est déjà {TEAM_FR[cur['role']]} de la Team : change son rôle plutôt")
        else:
            t["members"][uid] = {"role": role, "since": (cur or {}).get("since") or now, "by": by,
                                 **({"guest": guest} if role == "guest" else {})}
            if cur and cur.get("role") == "guest" and role != "guest":   # un guest devenu membre : plus de places de guest
                for sp in db["spaces"].values():
                    if sp["team"] == tid and ((sp.get("members") or {}).get(uid) or {}).get("guest"):
                        sp["members"].pop(uid, None)
        if role == "guest":
            if cur and cur.get("role") == "guest" and GUEST_MODES.index(cur.get("guest") or "viewer") > GUEST_MODES.index(guest):
                t["members"][uid]["guest"] = cur["guest"]
            _set_guest_spaces(db, tid, uid, spaces, by, now, replace=False)
        _save()
    auth.journal("team : membre", user=by, team=tid, membre=uid, role=role, guest=guest, spaces=spaces,
                 **({"cree": True} if created else {}))
    out = team_view(u, tid)
    out["added"] = {"id": uid, "name": target["name"], "pseudo": target.get("pseudo") or target["name"], "created": bool(created)}
    return out


def set_member(u, tid: str, uid: str, patch: dict) -> dict:
    """Changer le rôle de Team (member ↔ guest ; admin : le propriétaire ou Cal), le mode
    d'un guest (viewer ↔ acteur : décision 2 de Cal), les Workspaces d'un guest."""
    with _lock:
        db = _data()
        t = _team_or_404(db, tid)
        _see_team(u, tid)
        m = t["members"].get(uid)
        if not m:
            raise HttpError(404, "pas dans cette Team")
        manage = can_manage(u, tid)
        owner_or_cal = u is None or auth.is_admin(u) or t.get("owner") == _uid(u)
        if m.get("role") == "owner":
            raise HttpError(409, "le propriétaire garde son rôle (céder la propriété : plus tard)")
        new = patch.get("role", m.get("role"))
        if new not in ("admin", "member", "guest"):
            raise HttpError(400, "le rôle : admin, member ou guest")
        mode = patch.get("guest", m.get("guest") or "viewer")
        if new == "guest" and mode not in GUEST_MODES:
            raise HttpError(400, "un guest : viewer ou acteur")
        spaces = _check_spaces(db, tid, patch.get("spaces")) if "spaces" in patch else None
        if "admin" in (new, m.get("role")) and new != m.get("role"):
            _need(owner_or_cal, "le rôle admin de la Team : son propriétaire, ou Cal")
        if new != m.get("role") or "guest" in patch:
            _need(manage, "changer un rôle : le propriétaire ou un admin de la Team")
        if spaces is not None and not manage:
            _need(new == "guest" and all(can(u, s, "invite_space") for s in set(spaces) | {
                s for s, sp in db["spaces"].items() if sp["team"] == tid and (sp.get("members") or {}).get(uid)}),
                "les Workspaces d'un guest : un admin de la Team, ou des Workspaces concernés")
        if new == "guest":
            _guests_ok()
        by, now = _uid(u) or auth.admin_id(), now_iso()
        was = dict(m)
        if new == "guest" and was.get("role") != "guest":
            # il garde ce qu'il voyait : ses Workspaces d'avant deviennent ses Workspaces de guest
            seen = [s for s, sp in db["spaces"].items() if sp["team"] == tid and _profile(db, auth.user(uid), s, False)]
            for s, sp in db["spaces"].items():
                if sp["team"] == tid:
                    (sp.get("members") or {}).pop(uid, None)
            _set_guest_spaces(db, tid, uid, seen if spaces is None else spaces, by, now, replace=True)
        elif new != "guest" and was.get("role") == "guest":
            for s, sp in db["spaces"].items():
                if sp["team"] == tid and ((sp.get("members") or {}).get(uid) or {}).get("guest"):
                    sp["members"].pop(uid, None)
        elif new == "guest" and spaces is not None:
            _set_guest_spaces(db, tid, uid, spaces, by, now, replace=True)
        m["role"] = new
        if new == "guest":
            m["guest"] = mode
        else:
            m.pop("guest", None)
        _save()
    auth.journal("team : rôle", user=_uid(u), team=tid, membre=uid, avant={k: was.get(k) for k in ("role", "guest")},
                 apres={"role": new, **({"guest": mode} if new == "guest" else {})},
                 **({"spaces": spaces} if spaces is not None else {}))
    return team_view(u, tid)


def remove_member(u, tid: str, uid: str) -> dict:
    """Retirer quelqu'un (qui gère la Team ; un admin : le propriétaire ou Cal), ou partir
    soi-même. Le propriétaire reste. Ses objets restent dans leurs Workspaces : ils sont
    à la Team."""
    with _lock:
        db = _data()
        t = _team_or_404(db, tid)
        _see_team(u, tid)
        m = t["members"].get(uid)
        if not m:
            raise HttpError(404, "pas dans cette Team")
        if m.get("role") == "owner":
            raise HttpError(409, "le propriétaire ne part pas de sa Team")
        if uid != _uid(u):
            _need(can_manage(u, tid), "retirer quelqu'un : le propriétaire ou un admin de la Team")
            if m.get("role") == "admin":
                _need(u is None or auth.is_admin(u) or t.get("owner") == _uid(u),
                      "retirer un admin de la Team : son propriétaire, ou Cal")
        t["members"].pop(uid)
        for sp in db["spaces"].values():
            if sp["team"] == tid:
                (sp.get("members") or {}).pop(uid, None)
        last = (db["users"].get(uid) or {}).get("last")
        if last and (db["spaces"].get(last) or {}).get("team") == tid:
            db["users"][uid].pop("last", None)
        _save()
    auth.journal("team : retiré", user=_uid(u), team=tid, membre=uid, role=m.get("role"))
    return team_view(u, tid) if (can_manage(u, tid) or team_role(u, tid)) else {"id": tid, "left": True}


def set_space_member(u, sid: str, uid: str, role: str | None) -> dict:
    """Dans un Workspace : le rôle d'un membre de la Team (admin, editor, commenter,
    viewer, none ; null : le rôle par défaut), ou un guest qu'on y met (`guest`) ou
    qu'on en sort (null). Un admin du Workspace ou de la Team."""
    with _lock:
        db = _data()
        sp = _space_or_404(db, sid)
        tid = sp["team"]
        t = db["teams"][tid]
        _need(can_manage(u, tid) or can(u, sid, "invite_space"), "les rôles du Workspace : un admin du Workspace ou de la Team")
        m = t["members"].get(uid)
        if not m:
            raise HttpError(404, "pas dans cette Team : invite-le d'abord")
        mem = sp.setdefault("members", {})
        if m.get("role") in ("owner", "admin"):
            raise HttpError(409, "un admin de la Team est admin de chacun de ses Workspaces")
        if m.get("role") == "guest":
            if role not in (None, "guest"):
                raise HttpError(400, "un guest : dedans (guest) ou dehors (null) — viewer ou acteur se règle sur la personne")
            if role:
                _guests_ok()
                mem[uid] = {"guest": True, "since": now_iso(), "by": _uid(u) or auth.admin_id()}
            else:
                mem.pop(uid, None)
        else:
            if role not in SPACE_ROLES + ("none", None):
                raise HttpError(400, "le rôle : admin, editor, commenter, viewer, none, ou null (le défaut)")
            if role is None:
                mem.pop(uid, None)
            else:
                mem[uid] = {"role": role, "since": now_iso(), "by": _uid(u) or auth.admin_id()}
        _save()
        out = _space_public(db, u, sid, True)
    auth.journal("workspace : rôle", user=_uid(u), space=sid, membre=uid, role=role)
    return out


# ── les liens d'invitation ──────────────────────────────────
def _hash(secret: str) -> str:
    return hashlib.sha256(("showrunner-equipe\n" + secret).encode()).hexdigest()


def _invite_public(i: dict) -> dict:
    return {"id": i["id"], "team": i["team"], "role": i["role"], "guest": i.get("guest"), "spaces": i.get("spaces") or [],
            "created": i.get("created"), "exp": i.get("exp"), "hours": i.get("hours"), "by": i.get("by"),
            "by_name": auth.display_name(i.get("by")), "uses": len(i.get("uses") or [])}


def create_invite(u, tid: str, role: str = "member", guest: str | None = None, spaces=None, hours: int = 72) -> dict:
    """Un lien par Team (ou par Workspace : `spaces`) : rôle, mode du guest, durée. Le
    jeton ne se montre qu'une fois ; le serveur n'en garde que l'empreinte."""
    guest = guest or ("viewer" if role == "guest" else None)
    if role == "guest" and guest not in GUEST_MODES:
        raise HttpError(400, "un guest : viewer ou acteur")
    try:
        hours = int(hours)
    except (TypeError, ValueError) as e:
        raise HttpError(400, "la durée : un nombre d'heures") from e
    if hours not in HOURS:
        raise HttpError(400, f"la durée : {', '.join(map(str, HOURS))} heures")
    if role == "guest":
        _guests_ok()
    with _lock:
        db = _data()
        t = _team_or_404(db, tid)
        _see_team(u, tid)
        spaces = _check_spaces(db, tid, spaces)
        _may_invite(u, db, t, role, spaces)
        if role == "guest" and not spaces:
            raise HttpError(400, "un guest n'entre que dans les Workspaces où on le met : choisis-en au moins un")
        secret = secrets.token_urlsafe(24)
        now = time.time()
        iid = f"inv-{secrets.token_hex(4)}"
        rec = {"id": iid, "h": _hash(secret), "team": tid, "role": role, "guest": guest if role == "guest" else None,
               "spaces": spaces, "hours": hours, "created": now, "exp": now + hours * 3600,
               "by": _uid(u) or auth.admin_id(), "revoked": False, "uses": []}
        # le ménage : les liens morts depuis 30 jours s'en vont
        for k in [k for k, i in db["invites"].items() if i.get("exp", 0) < now - 30 * 86400]:
            db["invites"].pop(k)
        db["invites"][iid] = rec
        _save()
    auth.journal("team : invitation", user=rec["by"], team=tid, role=role, guest=rec["guest"], spaces=spaces,
                 hours=hours, invite=iid)
    return {**_invite_public(rec), "token": f"{iid}.{secret}"}


def revoke_invite(u, tid: str, iid: str) -> dict:
    with _lock:
        db = _data()
        _team_or_404(db, tid)
        _see_team(u, tid)
        rec = db["invites"].get(iid)
        if not rec or rec.get("team") != tid:
            raise HttpError(404, "ce lien n'existe pas")
        _need(can_manage(u, tid) or rec.get("by") == _uid(u), "retirer un lien : qui l'a fait, ou un admin de la Team")
        rec["revoked"] = True
        _save()
    auth.journal("team : invitation retirée", user=_uid(u), team=tid, invite=iid)
    return team_view(u, tid)


def _find_invite(db: dict, token: str) -> dict:
    mm = TOKEN_RX.fullmatch(token or "")
    rec = db["invites"].get(mm.group(1)) if mm else None
    if not rec or not secrets.compare_digest(rec.get("h", ""), _hash(mm.group(2))):
        raise HttpError(404, "ce lien d'invitation n'est pas valable")
    if rec.get("revoked"):
        raise HttpError(410, "ce lien d'invitation a été retiré")
    if time.time() > rec.get("exp", 0):
        raise HttpError(410, "ce lien d'invitation a expiré : demandes-en un autre")
    t = db["teams"].get(rec["team"])
    if not t or t.get("archived"):
        raise HttpError(410, "cette Team n'accueille plus personne (archivée)")
    return rec


def invite_info(token: str) -> dict:
    """Ce que dit un lien avant qu'on l'ouvre : la Team, le rôle (sans session)."""
    with _lock:
        db = _data()
        rec = _find_invite(db, token)
        t = db["teams"][rec["team"]]
        return {"team": t["name"], "role": rec["role"], "role_fr": TEAM_FR[rec["role"]], "guest": rec.get("guest"),
                "spaces": [db["spaces"][s]["name"] for s in rec.get("spaces") or [] if s in db["spaces"]],
                "by": auth.display_name(rec.get("by"))}


def redeem(u, token: str) -> dict:
    """Ouvrir un lien : la personne de la session (un pseudo neuf qui attend, ou un
    compte actif) entre dans la Team avec le rôle du lien — jamais de recul. Un pseudo
    neuf est accepté par le lien (qui l'a fait a vouché pour lui) : sans Studio, et sans
    Team personnelle s'il entre comme guest."""
    if not u:
        raise HttpError(401, "tape d'abord ton pseudo à la porte du portail, puis rouvre le lien")
    if u.get("state") == "suspended":
        raise HttpError(403, "ton accès est suspendu : vois avec Cal")
    if u.get("role") == auth.GUEST:
        raise HttpError(409, "tu es invité sur une planche d'Idéation : demande à Cal d'en faire un compte du portail")
    with _lock:
        rec = dict(_find_invite(_data(), token))
    if rec["role"] == "guest":
        _guests_ok()
    fresh = u.get("state") == "pending"
    if fresh:
        u = auth.accept(u["id"], by=rec["by"], access="apps", perso=rec["role"] != "guest", via="equipe")
    uid, now = u["id"], now_iso()
    with _lock:
        db = _data()
        rec = _find_invite(db, token)
        t = db["teams"][rec["team"]]
        cur = t["members"].get(uid)
        if not cur or _rank(cur) < _rank(rec):
            t["members"][uid] = {"role": rec["role"], "since": (cur or {}).get("since") or now, "by": rec["by"], "via": rec["id"],
                                 **({"guest": rec["guest"]} if rec["role"] == "guest" else {})}
            if cur and cur.get("role") == "guest":   # un guest devenu membre : plus de places de guest
                for sp in db["spaces"].values():
                    if sp["team"] == t["id"] and ((sp.get("members") or {}).get(uid) or {}).get("guest"):
                        sp["members"].pop(uid, None)
        cur = t["members"][uid]
        if cur["role"] == "guest":
            if GUEST_MODES.index(rec.get("guest") or "viewer") > GUEST_MODES.index(cur.get("guest") or "viewer"):
                cur["guest"] = rec["guest"]
            _set_guest_spaces(db, t["id"], uid, rec.get("spaces") or [], rec["by"], now, replace=False)
        if uid not in rec["uses"]:
            rec["uses"] = (rec.get("uses") or [])[-99:] + [uid]
        first = (rec.get("spaces") or [None])[0] or next(
            (s for s, sp in db["spaces"].items() if sp["team"] == t["id"] and _profile(db, u, s, False)), None)
        if first:
            db["users"].setdefault(uid, {})["last"] = first
        _save()
        role, mode = cur["role"], cur.get("guest")
    auth.journal("team : invitation ouverte", user=uid, team=rec["team"], invite=rec["id"], role=role, accepte=fresh)
    return {"team": rec["team"], "team_name": t["name"], "role": role, "role_fr": TEAM_FR[role], "guest": mode,
            "workspace": first, "accepted": fresh}


# ── la migration (étape 3) ──────────────────────────────────
# Les documents d'outil : un fichier `<id>.json` dont le champ `id` est son nom.
DOC_DIRS = ("musique", "ideation", "luts", "transcrire", "chanson", "analyses", "analyse")


def _write_json(p: Path, d: dict, indent: int = 1) -> None:
    tmp = p.with_name(p.name + ".esp.tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=indent) + ("\n" if p.read_bytes().endswith(b"\n") else ""),
                   encoding="utf-8")
    try:
        os.chmod(tmp, p.stat().st_mode & 0o777)
    except OSError:
        pass
    tmp.replace(p)


def migrate(root: Path | str | None = None, dry: bool = False) -> dict:
    """La migration (équipes_espaces.md § 5.1 ; décisions de Cal du 30/09). Idempotente :
    une seconde passe ne change rien. À lancer portail ARRÊTÉ (la bibliothèque et la
    file gardent leurs fiches en mémoire et les réécriraient sans `space`).
      1. teams.json : la Team « Nirvalab » (studio, propriétaire Cal, API coupée) et son
         Workspace « Général », l'espace par défaut de l'instance ;
      2. chaque ami actif (ou suspendu) qui a le Studio → membre de Nirvalab, éditeur de
         Général (son `access: studio` reste) ; un autre admin du portail → admin de
         Nirvalab ; un compte Apps → sa seule Team personnelle ; un invité de planche
         reste dans le royaume d'Idéation ;
      3. chaque compte (sauf l'invité de planche) → « Chez moi » + « Perso » ;
      4. chaque objet (bibliothèque, corbeille), document d'outil (`<id>.json`) et
         travail de la file sans `space` → Général. Rien d'autre ne change : auth.json
         n'est pas touché.
    Avant d'écrire : une sauvegarde (`sauvegarde-espaces-<date>/` : teams.json d'avant,
    la liste des fichiers changés, le rapport) — seulement s'il y a quelque chose à faire."""
    root = Path(root) if root else config.data_dir()
    now = now_iso()
    rep: dict = {"root": str(root), "dry": dry, "at": now, "teams_created": [], "spaces_created": [],
                 "members_added": [], "personal_created": [], "users_skipped": [], "items": {}, "docs": {},
                 "jobs": {}, "changed_files": [], "backup": None}
    authf = root / "auth.json"
    users = json.loads(authf.read_text(encoding="utf-8")).get("users", {}) if authf.exists() else {}
    tf = _file(root)
    before_txt = tf.read_text(encoding="utf-8") if tf.exists() else None
    db = _read(tf) if tf.exists() else _empty()
    cal = auth.admin_id()

    # 1. Nirvalab et Général
    if NIRVALAB not in db["teams"]:
        db["teams"][NIRVALAB] = {"id": NIRVALAB, "name": "Nirvalab", "plan": "studio", "personal": False, "owner": cal,
                                 "api": False, "created": now, "by": "migration", "archived": None,
                                 "members": {cal: {"role": "owner", "since": now, "by": "migration"}}}
        rep["teams_created"].append(NIRVALAB)
    nv = db["teams"][NIRVALAB]
    nv.setdefault("members", {}).setdefault(cal, {"role": "owner", "since": now, "by": "migration"})
    if GENERAL not in db["spaces"]:
        db["spaces"][GENERAL] = {"id": GENERAL, "team": NIRVALAB, "name": "Général", "default_role": "editor",
                                 "created": now, "by": "migration", "archived": None, "members": {}}
        rep["spaces_created"].append(GENERAL)
    if not db.get("default"):
        db["default"] = GENERAL

    # 2 et 3. les comptes
    for uid, x in sorted(users.items()):
        st, role = x.get("state"), x.get("role", "ami")
        if st not in ("active", "suspended"):
            rep["users_skipped"].append({"id": uid, "why": f"état {st}"})
            continue
        if role == auth.GUEST:
            rep["users_skipped"].append({"id": uid, "why": "invité de planche : reste dans le royaume d'Idéation"})
            continue
        if uid != cal and uid not in nv["members"]:
            if role == "admin":
                nv["members"][uid] = {"role": "admin", "since": now, "by": "migration"}
                rep["members_added"].append({"id": uid, "role": "admin"})
            elif x.get("access") == "studio":
                nv["members"][uid] = {"role": "member", "since": now, "by": "migration"}
                rep["members_added"].append({"id": uid, "role": "member", "space_role": "editor"})
            else:
                rep["users_skipped"].append({"id": uid, "why": "compte Apps : sa Team personnelle seulement"})
        if x.get("perso", True) is not False:
            _, made = _ensure_personal(db, uid, by="migration", now=now)
            if made:
                rep["personal_created"].append(uid)

    # 4. les objets, les documents, les travaux
    writes: list[tuple[Path, dict, int]] = []

    def tally(key: str, where: dict, it: dict, path: Path, indent: int = 1) -> None:
        c = where.setdefault(key, {"total": 0, "set": 0, "already": 0, "elsewhere": 0, "unowned": 0, "by_kind": {}})
        c["total"] += 1
        if not (it.get("origin") or {}).get("user") and not it.get("owner"):
            c["unowned"] += 1
        k = it.get("kind") or "?"
        c["by_kind"][k] = c["by_kind"].get(k, 0) + 1
        if "space" in it:
            c["already" if it["space"] == GENERAL else "elsewhere"] += 1
            return
        c["set"] += 1
        writes.append((path, {**it, "space": GENERAL}, indent))

    for sub in ("library", "trash"):
        for f in sorted((root / sub).glob("*/item.json")):
            try:
                it = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                rep["items"].setdefault("unreadable", []).append(str(f.relative_to(root)))
                continue
            if isinstance(it, dict) and it.get("id"):
                tally(sub, rep["items"], it, f)
    for sub in DOC_DIRS:
        for f in sorted((root / sub).glob("*.json")):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(d, dict) and d.get("id") == f.stem:
                tally(sub, rep["docs"], d, f)
    jf = root / "jobs.json"
    if jf.exists():
        try:
            jl = json.loads(jf.read_text(encoding="utf-8"))
        except ValueError:
            jl = None
        if isinstance(jl, list):
            n = sum(1 for j in jl if isinstance(j, dict) and "space" not in j)
            rep["jobs"] = {"total": len(jl), "set": n, "already": len(jl) - n}
            if n:
                writes.append((jf, [({**j, "space": GENERAL} if isinstance(j, dict) and "space" not in j else j) for j in jl], 1))

    after_txt = json.dumps(db, ensure_ascii=False, indent=1)
    teams_changed = before_txt is None or json.loads(before_txt) != db
    rep["changed_files"] = [str(p.relative_to(root)) for p, _, _ in writes] + (["teams.json"] if teams_changed else [])
    rep["nothing_to_do"] = not rep["changed_files"]
    if dry or rep["nothing_to_do"]:
        return rep
    bk = root / f"sauvegarde-espaces-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"
    bk.mkdir(parents=True, exist_ok=False)
    if before_txt is not None:
        (bk / "teams.json").write_text(before_txt, encoding="utf-8")
    (bk / "fichiers.txt").write_text("\n".join(rep["changed_files"]) + "\n", encoding="utf-8")
    rep["backup"] = str(bk.relative_to(root))
    for p, d, indent in writes:
        _write_json(p, d, indent)
    if teams_changed:
        tmp = tf.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(after_txt)
        tmp.replace(tf)
    (bk / "rapport.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    if tf == _file():
        reset_for_tests()   # le portail de ce processus relit teams.json
    return rep
