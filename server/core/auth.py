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
    refusé.

La porte publique (29/09, docs/etudes/cloudflare.md, « Prêt à déployer ») :
derrière un tunnel Cloudflare, tout arrive de 127.0.0.1, et « le réseau de
Cal » ne protégerait plus rien. Les tunnels visent donc un second point
d'écoute, `127.0.0.1:<port de la maison + 1000>` (9790), ouvert par
server/showrunner.py ; c'est l'App qui a reçu la requête (`app.door`) qui
dit d'où elle vient — ni une adresse, ni un en-tête. Là, aucune requête
n'est du réseau de Cal, `"auth": false` n'y vaut rien, et tout est gardé :
  - « demo » (tunnel rapide trycloudflare) : un code d'invitation d'abord
    (`/invitation/`, cookie `sr_invitation`), puis le pseudo ; un pseudo neuf
    attend que Cal l'accepte ; un compte admin n'entre qu'avec le code admin,
    distinct. Les codes : `<data_dir>/porte-demo.json` (tools/demo.sh). Une
    session ouverte là est liée au code qui l'a ouverte : de nouveaux codes
    ferment toutes les sessions de la porte.
  - « access » (la vraie porte, porte/worker.js) : chaque requête porte la
    signature HMAC du Worker (x-porte-*, clé `~/.config/showrunner/porte.key`)
    ET le jeton Cloudflare Access (`Cf-Access-Jwt-Assertion`, RS256 vérifié
    ici contre les clés de l'équipe, `aud`, `iss`, `exp`), au même e-mail.
    Admin seulement si le Worker le signe ET si l'e-mail mène à un compte
    admin (`porte.emails` de showrunner.local.json).
  - « code » (la vraie porte, à l'adresse fixe, sans e-mail ni Cloudflare
    Access : décisions de Cal du 29/09, « un login simple genre su007 », puis
    « virer » Access) : chaque requête porte la signature HMAC du Worker,
    comme en « access » — seul le Worker entre —, rôle `code`, l'adresse du
    visiteur ; le portail applique la mécanique de la démo (code d'invitation,
    puis le pseudo ; un pseudo neuf attend Cal, un pseudo créé d'avance par Cal
    entre aussitôt ; un compte admin n'entre qu'avec le code admin).
    docs/etudes/cloudflare.md, « La porte par code ».
Sur l'écoute de la maison, une requête qui porte les en-têtes du bord de
Cloudflare (Cf-Ray, Cf-Connecting-IP…) est refusée : un tunnel pointé par
erreur sur 8790 n'ouvre rien.
  - Le socle refuse `/api/…`, les relais (`/character/…`) et les fichiers
    de la bibliothèque sans session (401) ; les pages se servent et
    montrent la porte (`commun/porte.js`). Toute écriture venue d'une
    autre page est refusée (`Origin`, `Sec-Fetch-Site` : audit du 28/09,
    H3).
  - `"auth": false` dans `showrunner.local.json` coupe la porte (essais,
    `tools/check.py`) : tout se passe alors comme si Cal était connecté.

Qui voit quoi, qui modifie : le rôle de la personne dans le Workspace de
l'objet (étape 2 des Teams et Workspaces, plus bas : can_read_item,
can_write_item, can_trash_item) ; le réglage d'admin `visibility: own`
resserre encore la lecture à ce qui est à soi ou partagé.

L'invité (rôle `invite`, 29/09) : quelqu'un qui entre par un lien qu'un
outil lui a donné (une planche d'Idéation) n'est pas un ami du portail. Son
pseudo neuf, accepté par le lien, prend le rôle `invite` ; il n'atteint que
ce que les outils déclarent pour lui (`guest_realm`) : leurs routes, chacune
avec son juge (la planche est-elle la sienne ?), leurs pages, et les objets
de la bibliothèque qu'ils lui montrent (`items`) — le juge de lecture de la
bibliothèque (`can_read_item`) ne connaît alors que ceux-là. Tout le reste
lui est fermé par défaut (403) : Asset, les rendus, les autres outils,
l'Admin ; une autre page le ramène chez lui (303). Cela vaut sur les trois
entrées (la maison, la porte « demo » avec son code, la porte « access ») :
le rôle est porté par le compte, la porte ne fait que dire qui c'est. Cal
en fait un ami dans l'Admin s'il le veut (rôle « ami »).

Apps et Studio (30/09, docs/etudes/apps_studio_elements.md § 3.6) : un droit
`access` (« apps » | « studio ») à côté du rôle, jugé ici seulement. Un compte
Apps ouvre les Apps et Asset ; une page d'un outil Studio lui montre « réservé
au Studio » (qui mène à la demande), une écriture Studio et un travail Studio
lui répondent 403 (`STUDIO_TOOLS`, `_studio_only`, `need_studio_kind`). Il
demande le Studio (`request_studio`, `POST /api/auth/studio`) ; Cal l'ouvre dans
Admin. Un compte neuf reçoit le réglage `new_access` (« studio » pendant
l'essai).

Teams et Workspaces (30/09, docs/etudes/equipes_espaces.md, étape 0 ; le modèle
et sa matrice : core/espaces.py). La porte pose sur chaque requête le Workspace
courant (`req.workspace`, et `current_space()` pour le fil) : l'en-tête
`X-SR-Espace` que posera `api()` (commun/shell.js), sinon `?e=`, vérifié —
demander un Workspace qu'on ne voit pas répond 403 sur une route protégée (sauf
`/api/auth/…`, pour que la page se reprenne) ; sans rien, le dernier Workspace
de la personne, sinon Général. Rien ne se ferme encore : les outils le liront
aux étapes suivantes (1 : `can_compute` dans jobs.submit ; 2 : la bibliothèque).
Le droit `access` passe à la Team (`access_of(u, espace)` = l'offre de la Team du
Workspace ; la Team personnelle a celle du compte) ; d'ici l'étape 2, la porte
prend le meilleur des deux : rien de ce qui est ouvert ne se ferme.

La garde du calcul (étape 1) : jobs.submit juge chaque travail
(`compute_refusal` : la personne, le Workspace du travail, le coût déclaré de
sa sorte) ; les calculs hors file sont déclarés dans `COMPUTE_ROUTES` et jugés
ici, dans `gate`. Un guest, viewer ou acteur, et l'invité d'une planche ne
calculent jamais, `cpu` compris.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import html
import ipaddress
import json
import os
import re
import secrets
import stat
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from . import config
from .http import HttpError, Response

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
    # le droit `access` d'un compte neuf (Cal l'ajoute, accepte sa demande, ou Access le crée) : « studio » pendant la
    # phase d'essai (Cal, 30/09 : ses amis voient tout) ; « apps » ensuite (étude apps_studio_elements.md § 5,
    # question 5) — Admin → Personnes → Réglages, sans toucher au code
    "new_access": "studio",
}
GUEST = "invite"             # le rôle de l'invité par un lien (voir plus haut)
ROLES = ("admin", "ami", GUEST)
ACCESS = ("apps", "studio")  # le droit Studio, à côté du rôle (plus bas, « le Studio »)
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
        if "new_access" in patch:
            if patch["new_access"] not in ACCESS:
                raise HttpError(400, "un compte neuf : apps ou studio")
            s["new_access"] = patch["new_access"]
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


# le Workspace de la requête (posé par gate), ou du travail en cours (la file le posera
# le temps du `run`, étape 1 : `set_current_space(job["space"])`) — core/espaces.py
def current_space() -> str | None:
    return getattr(_local, "space", None)


def set_current_space(space: str | None) -> None:
    _local.space = space


# l'API des étapes suivantes (le juge : core/espaces.py, sa matrice MATRIX)
def can_view(u: dict | None, space: str | None) -> bool:
    from . import espaces
    return espaces.can_view(u, space)


def can_edit(u: dict | None, space: str | None) -> bool:
    from . import espaces
    return espaces.can_edit(u, space)


def can_compute(u: dict | None, space: str | None, cost: str = "gpu") -> bool:
    """Étape 1 : jobs.submit l'appelle avec l'espace du travail et le coût de sa sorte
    (gpu, api, cpu, none). Un guest de Team, viewer ou acteur : jamais (décision 2)."""
    from . import espaces
    return espaces.can_compute(u, space, cost)


def compute_why(u: dict | None, space: str | None, cost: str = "gpu") -> str | None:
    """Pourquoi pas (la phrase du 403, qui mène à qui débloque), ou None."""
    from . import espaces
    if cost == "none":
        return espaces.judge(u, space, "create")[1]
    return espaces.judge(u, space, f"compute_{cost if cost in espaces.COSTS else 'gpu'}")[1]


# ── la garde du calcul (étape 1) : jobs.submit (_guard) et COMPUTE_ROUTES (gate) ──
GUEST_COMPUTE_WHY = ("invité : les calculs sont réservés aux membres d'une Team — tu vois ce qu'on t'a partagé ; "
                     "demande à Cal ou à celui qui t'a invité")
NO_SPACE_WHY = "aucun Workspace pour ce calcul (teams.json illisible, ou tu n'es dans aucune Team) — vois avec Cal"


def compute_refusal(u: dict | None, space: str | None, cost: str = "gpu") -> str | None:
    """Pourquoi cette personne ne peut pas lancer ce calcul dans ce Workspace, ou None.
    Personne (le socle : un travail système, la maison sans porte) : oui. L'invité d'une
    planche (rôle `invite`) : jamais. Sans Workspace : Cal seul (il n'y a rien à juger).
    Sinon la matrice (core/espaces.py) : un guest de Team, viewer ou acteur, jamais,
    `cpu` compris (décision de Cal du 30/09) ; l'API payante si la Team l'a ouverte."""
    if u is None:
        return None
    if is_guest(u):
        return GUEST_COMPUTE_WHY
    if space is None:
        return None if is_admin(u) and u.get("state", "active") == "active" else NO_SPACE_WHY
    if can_compute(u, space, cost):
        return None
    return compute_why(u, space, cost) or "calcul refusé dans ce Workspace — demande à un admin de la Team"


# les calculs hors file, déclarés une fois : (méthodes, chemin (expression entière), coût), jugés
# dans `gate` comme ADMIN_ROUTES, avec le Workspace de la requête (docs/etudes/equipes_espaces.md § 2.5)
COMPUTE_ROUTES = (
    ("POST PUT PATCH DELETE", r"/character/.*", "gpu"),        # le relais du studio CF en écriture (DGX1)
    ("POST", r"/api/movie/h3/start", "gpu"),                   # réveiller H3 : charge le modèle sur un GPU
    ("POST", r"/api/analyse/diar/analyse", "gpu"),             # la diarisation directe (le service de DGX1)
)
_COMPUTE_RULES = [(frozenset(m.split()), re.compile(rx), c) for m, rx, c in COMPUTE_ROUTES]


def compute_route(method: str, path: str) -> str | None:
    """Le coût d'une route de calcul hors file, ou None."""
    for methods, rx, cost in _COMPUTE_RULES:
        if method in methods and rx.fullmatch(path):
            return cost
    return None


def _compute_gate(req) -> None:
    cost = compute_route(req.method, req.path)
    if cost is None:
        return
    u = getattr(req, "user", None)
    if u is None and enabled():
        raise HttpError(401, "connexion requise : tape ton pseudo à l'accueil du portail")
    why = compute_refusal(u, getattr(req, "workspace", None), cost)
    if why:
        raise HttpError(403, f"{why} ({req.path}, calcul {cost})")


def can_publish(u: dict | None, space: str | None) -> bool:
    from . import espaces
    return espaces.can_publish(u, space)


def can_invite(u: dict | None, space: str | None) -> bool:
    from . import espaces
    return espaces.can_invite(u, space)


def space_of(doc: dict | None) -> str | None:
    from . import espaces
    return espaces.space_of(doc)


def is_admin(u: dict | None) -> bool:
    return bool(u) and u.get("role") == "admin"


def is_guest(u: dict | None) -> bool:
    return bool(u) and u.get("role") == GUEST


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


# Teams et Workspaces, étape 2 (docs/etudes/equipes_espaces.md § 2.3, § 2.4) : un objet
# ou un document est à son Workspace (`space`, space_of) ; son auteur (owner_of) reste
# l'auteur. Qui le voit, qui le modifie, qui le jette : le rôle de la personne dans ce
# Workspace (core/espaces.py, la matrice) ; `visibility: own` (réglage d'admin) resserre
# encore la lecture à ce qui est à soi ou partagé. Cal voit et fait tout ; le socle (aucune
# personne) aussi ; l'invité d'une planche ne voit que ce que ses outils lui montrent.
# Ces juges disent « où qu'il soit » : la borne du Workspace courant (un outil n'atteint
# que son Workspace) est à part, dans core/library.py (readable, get, query).
def can_read_item(it: dict, u: dict | None, _view=None) -> bool:
    if is_guest(u):   # un invité : les objets que ses outils lui montrent, rien d'autre
        return it.get("id") in guest_items(u)
    if u is None or is_admin(u):
        return True
    if not (_view(space_of(it)) if _view else can_view(u, space_of(it))):
        return False
    return settings()["visibility"] == "all" or owner_of(it) == u["id"] or bool(it.get("shared"))


def item_reader(u: dict | None):
    """can_read_item pour une liste : l'avis de chaque Workspace pris une fois (une liste
    de 10 000 objets ne rejuge pas 10 000 fois le même Workspace)."""
    memo: dict = {}

    def view(space):
        if space not in memo:
            memo[space] = can_view(u, space)
        return memo[space]
    return lambda it: can_read_item(it, u, view)


def can_write_item(it: dict, u: dict | None) -> bool:
    """Modifier : un éditeur du Workspace du document (décision 9 : dans un Workspace
    partagé, tout éditeur modifie ; un guest acteur aussi ; un lecteur, un commentateur,
    un guest viewer, jamais ; un Workspace archivé : personne) ; Cal, tout. L'invité
    d'une planche : ce qui est à lui."""
    if u is None or is_admin(u):
        return True
    if is_guest(u):
        return owner_of(it) == u["id"] and can_read_item(it, u)
    from . import espaces
    return can_read_item(it, u) and espaces.can_write_doc(u, it)


def can_trash_item(it: dict, u: dict | None) -> bool:
    """Mettre à la corbeille, en sortir : l'auteur s'il peut modifier dans ce Workspace,
    un admin du Workspace (ou de sa Team), Cal. Un objet sans auteur (d'avant la porte) :
    les admins."""
    if u is None or is_admin(u):
        return True
    if is_guest(u):
        return owner_of(it) == u["id"] and can_read_item(it, u)
    from . import espaces
    return can_read_item(it, u) and espaces.can_trash_doc(u, it)


# ── le Studio : le droit `access`, à côté du rôle ───────────
# docs/etudes/apps_studio_elements.md § 3.6 : le rôle dit qui administre,
# `access` (« apps » | « studio ») quels outils on ouvre. Un admin a toujours
# le Studio ; la maison sans porte (`"auth": false`) et le socle (aucune
# personne : un travail système) valent Cal. Un compte sans le champ : « apps »
# (le défaut d'un compte NEUF est le réglage `new_access`, posé à sa création).
# La table : les outils `tier: 'studio'` de commun/shell.js (TOOLS), sauf ceux
# `open` (Asset, la bibliothèque commune) — leurs pages, leurs routes
# d'écriture (les lectures restent : Asset lit les notes d'un MIDI, la forme
# d'onde d'un son), les sortes de leurs travaux. tools/check.py (compte.py)
# vérifie que cette table et TOOLS disent la même chose.
STUDIO_TOOLS = {
    "music":     {"name": "ODIO", "page": "/musique/", "write": ("/api/music/",), "kinds": ("music.",)},
    "montage":   {"name": "Montage", "page": "/montage/", "write": ("/api/montage/",), "kinds": ("montage.",)},
    "ideation":  {"name": "Idéation", "page": "/ideation/", "write": ("/api/ideation/",), "kinds": ("ideation.",)},
    "character": {"name": "Character Factory", "page": "/character/", "write": ("/character/",), "kinds": ()},
    "object":    {"name": "Object Creator", "page": "/objet/", "write": ("/api/objet/",), "kinds": ("objet.",)},
    "analyse":   {"name": "Movie Analysis", "page": "/analyse/", "write": ("/api/analyse/",), "kinds": ("analyse.",)},
}
# les gestes Studio d'une app : l'app Musique sépare les pistes et ouvre dans ODIO (musique_app.md § 4)
STUDIO_ROUTES = {"/api/chanson/stems": "ODIO", "/api/chanson/odio": "ODIO"}
STUDIO_PAGE = "/api/auth/studio-ferme"   # une page Studio demandée par un compte Apps (compte.py, r_studio_page)
STUDIO_WHY = ("{name} fait partie du Studio ; ton compte ouvre les Apps et Asset. "
              "Demande le Studio à Cal (bouton « Demander le Studio »)")


def access_of(u: dict | None, space: str | None = None) -> str:
    """Sans espace : le droit du compte (l'offre de sa Team personnelle « Chez moi »).
    Avec un Workspace : l'offre de sa Team (Teams et Workspaces : le droit passe à la
    Team), s'il y entre ; sinon celle du compte."""
    if u is None or is_admin(u):
        return "studio"
    if space:
        from . import espaces
        if espaces.can_view(u, space):
            return espaces.plan_of_space(space) or "apps"
    return "studio" if u.get("access") == "studio" else "apps"


def has_studio(u: dict | None, space: str | None = None) -> bool:
    return access_of(u, space) == "studio"


def _studio_here(u: dict | None, space: str | None) -> bool:
    """Le Studio pour cette requête. D'ici l'étape 2, le meilleur du compte et de la Team
    du Workspace : rien de ce qui est ouvert aujourd'hui ne se ferme."""
    return has_studio(u) or bool(space and has_studio(u, space))


def studio_asked(u: dict | None) -> str | None:
    """La date de sa demande de Studio, tant qu'elle attend."""
    if u is None or has_studio(u):
        return None
    with _lock:
        x = _data()["users"].get(u.get("id") or "")
    return (x or {}).get("studio_request") or None


def studio_page(path: str) -> str | None:
    """L'outil Studio dont `path` est une page (« /montage/ », « /montage/montage.js »), ou None."""
    for tid, t in STUDIO_TOOLS.items():
        if path.startswith(t["page"]) or path == t["page"].rstrip("/"):
            return tid
    return None


def studio_write(path: str) -> str | None:
    """Le nom de l'outil Studio d'une route d'écriture, ou None."""
    p = path.rstrip("/")
    if p in STUDIO_ROUTES:
        return STUDIO_ROUTES[p]
    for t in STUDIO_TOOLS.values():
        if any(path.startswith(w) for w in t["write"]):
            return t["name"]
    return None


def studio_kind(kind: str) -> str | None:
    """Le nom de l'outil Studio d'une sorte de travail (« montage.export »), ou None."""
    for t in STUDIO_TOOLS.values():
        if any(str(kind or "").startswith(k) for k in t["kinds"]):
            return t["name"]
    return None


def need_studio_kind(kind: str, u: dict | None = None, space=False) -> None:
    """jobs.submit (la garde du calcul, toutes routes) : un compte Apps ne lance pas un
    travail d'un outil Studio (403). `space` : le Workspace du travail (défaut : le courant)."""
    u = current() if u is None else u
    name = studio_kind(kind)
    if name and not _studio_here(u, current_space() if space is False else space):
        raise HttpError(403, STUDIO_WHY.format(name=f"« {kind} » ({name})"))


def request_studio(u: dict | None) -> dict:
    """`POST /api/auth/studio` : demander le Studio. Gardée sur le compte (auth.json,
    `studio_request`) jusqu'à ce que Cal l'accepte ou l'écarte (Admin → Demandes) ;
    redemander ne fait rien de plus."""
    if u is None or has_studio(u):
        return {"ok": True, "access": "studio", "asked": None}
    if is_guest(u):
        raise HttpError(403, GUEST_WHY)
    new = False
    with _lock:
        x = _data()["users"].get(u.get("id") or "")
        if not x or x.get("state") != "active":
            raise HttpError(403, "compte inactif : vois avec Cal")
        if has_studio(x):
            return {"ok": True, "access": "studio", "asked": None}
        asked = x.get("studio_request")
        if not asked:
            asked = x["studio_request"] = now_iso()
            _save()
            new = True
    if new:
        journal("demande de Studio", user=u["id"], name=u.get("name", ""))
    return {"ok": False, "access": "apps", "asked": asked}


def _studio_only(req) -> None:
    """Après la porte, pour une personne connue sans le Studio : une page d'un outil
    Studio devient la page « réservé au Studio » (STUDIO_PAGE, qui mène à la demande) ;
    une écriture sur une route Studio, 403. Sur la porte « code », les pages viennent
    des assets du Worker, sans passer ici : l'en-tête (commun/shell.js, mountHeader)
    les ferme aussi ; les écritures, elles, arrivent toujours ici."""
    u = getattr(req, "user", None)
    if not u or is_guest(u) or _studio_here(u, _space(req)):
        return
    p = req.path
    if req.protected:
        if req.method not in ("GET", "HEAD", "OPTIONS"):
            name = studio_write(p)
            if name:
                raise HttpError(403, STUDIO_WHY.format(name=name))
        return
    if req.method in ("GET", "HEAD"):
        tid = studio_page(p)
        if tid:
            req.studio_tool = tid
            req.path, req.rewritten = STUDIO_PAGE, True


# ── les sessions ────────────────────────────────────────────
def _hash(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


def _ip(req) -> str:
    """L'adresse de l'appelant, pour compter (limites de débit) et pour la page
    d'admin. Sur la porte « demo », tout arrive de 127.0.0.1 (le tunnel) :
    l'adresse vue par Cloudflare (`Cf-Connecting-IP`) sert alors à compter —
    jamais à donner un droit (la porte ne consulte pas le réseau de Cal)."""
    try:
        ip = req._h.client_address[0]
    except (AttributeError, IndexError):
        ip = ""
    if door_of(req) == "code":   # l'adresse que le Worker a signée (Cf-Connecting-IP vu par lui)
        return getattr(req, "porte_ip", "") or ip
    if door_of(req) == "demo":
        real = (req.headers.get("Cf-Connecting-IP") or "").strip()
        try:
            return str(ipaddress.ip_address(real))
        except ValueError:
            pass
    return ip


def _cookie(req, name: str = COOKIE) -> str | None:
    for part in (req.headers.get("Cookie") or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == name and v:
            return v.strip()
    return None


def cookie_header(tok: str | None) -> str:
    # la porte publique est en HTTPS au bord de Cloudflare : ses cookies sont Secure
    secure = "; Secure" if config.get("auth_cookie_secure") or getattr(_local, "door", None) else ""
    if not tok:
        return f"{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure}"
    return f"{COOKIE}={tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_DAYS * 86400}{secure}"


def _new_session(uid: str, req, **door) -> str:
    """`door` : pour une session ouverte sur la porte publique, `porte` et
    l'empreinte du code qui l'a ouverte (`code`) — elle ne vaut que là, et que
    tant que ce code est le bon."""
    tok = secrets.token_urlsafe(32)
    with _lock:
        _data()["sessions"][_hash(tok)] = {"user": uid, "created": now_iso(), "seen": now_iso(), "t": time.time(),
                                          "ua": (req.headers.get("User-Agent") or "")[:160], "ip": _ip(req),
                                          **door}
        _save()
    return tok


def _expired(s: dict, u: dict | None) -> bool:
    days = PENDING_DAYS if (u and u.get("state") == "pending") or s.get("refused") else SESSION_DAYS
    return time.time() - float(s.get("t") or 0) > days * 86400


def session_of(req) -> tuple[str | None, dict | None, dict | None]:
    """(empreinte, session, personne) du navigateur, ou des None. Sur la porte
    « access », pas de session : la personne de la requête, relue (un flux
    ouvert longtemps voit une suspension)."""
    if door_of(req) == "access":
        u0 = getattr(req, "user", None)
        u = user(u0["id"]) if u0 else None
        if not u:
            return None, None, None
        if u0.get("role") != "admin" and u.get("role") == "admin":
            u["role"] = "ami"   # le rôle retenu à l'entrée de la requête (le Worker ne l'a pas signé admin)
        return None, {"porte": "access"}, u
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
        if not _door_session_ok(req, s, u):
            return None, None, None
        if _expired(s, u):
            db["sessions"].pop(h, None)
            _save()
            return None, None, None
        if time.time() - float(s.get("t") or 0) > 300:   # « vu » à cinq minutes près : pas une écriture par requête
            s["t"], s["seen"] = time.time(), now_iso()
            _save()
        return h, s, (dict(u) if u else None)


def _offnet(u: dict | None, req) -> bool:
    """Un admin hors du réseau de Cal, quand `admin_lan_only` le demande. Sur
    la porte publique, la question ne se pose pas : aucune requête n'y est du
    réseau de Cal, l'admin y entre par le code admin ou par Access."""
    if door_of(req):
        return False
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
        o = origin.strip()
        # derrière le tunnel rapide, l'hôte reçu est celui du tunnel (constaté, non documenté :
        # httpHostHeader de cloudflared est vide par défaut) ; l'adresse relevée par tools/demo.sh vaut aussi
        same = urlsplit(o).netloc.lower() == host or (door_of(req) == "demo" and o.rstrip("/").lower() == demo_url())
        if o == "null" or not same:
            raise HttpError(403, "requête refusée : elle vient d'une autre origine (Origin)")


def _protected(req, app) -> bool:
    p = req.path
    if p.startswith("/api/"):
        return True
    if any(p.startswith(pre) for pre, _ in getattr(app, "prefixes", [])):
        return True
    rel = p.lstrip("/")
    return any(rel.startswith(m) for m in getattr(app, "mounts", {}))


def _admin_only(req) -> None:
    if (req.path.startswith("/api/admin/") or (req.method, req.path.rstrip("/")) in ADMIN_ROUTES) \
            and not is_admin(req.user):
        raise HttpError(403, "réservé aux admins")


# ── l'invité : ce que les outils lui ouvrent ────────────────
# Fermé par défaut : une route n'est ouverte à l'invité que si un outil l'a
# déclarée (guest_realm), et seulement si son juge dit oui pour cette personne.
GUEST_HOME = "/api/auth/invite-home"      # une autre page : 303 vers chez lui (r_guest_home)
GUEST_WHY = "invité : tu n'as accès qu'à ce qu'on t'a partagé par un lien"
_realms: list[dict] = []


def _rules(rules) -> list:
    out = []
    for methods, rx, judge in rules:
        ms = set(methods.upper().split())
        if "GET" in ms:
            ms.add("HEAD")
        out.append((frozenset(ms), re.compile(rx), judge))
    return out


# les siennes, quel que soit l'outil : ses préférences (le thème, la taille)
_GUEST_BASE = _rules([("GET POST", r"/api/prefs", None), ("GET", r"/api/prefs/schemas", None)])


def guest_realm(name: str, *, routes=(), pages=(), items=None, home=None) -> None:
    """Un outil ouvre à l'invité une part de lui-même :
      routes : [(« GET POST », motif (expression régulière entière, groupes nommés),
               juge(personne, **groupes) → bool, ou None : la route juge elle-même)] ;
      pages  : les préfixes de ses pages (« /ideation/ ») ;
      items(personne) : les objets de la bibliothèque qu'il lui montre ;
      home(personne)  : l'adresse où le mener (une autre page du portail y renvoie)."""
    global _realms
    _realms = [r for r in _realms if r["name"] != name] + [
        {"name": name, "routes": _rules(routes), "pages": tuple(pages), "items": items, "home": home}]


def guest_items(u: dict) -> frozenset:
    """Les objets de la bibliothèque qu'un invité peut lire : ceux que ses outils lui
    montrent. Calculés une fois par requête (une planche de 500 images en demande 500)."""
    c = getattr(_local, "gitems", None)
    if c and c[0] == u.get("id"):
        return c[1]
    got: set = set()
    for r in _realms:
        if r["items"]:
            got |= set(r["items"](u))
    v = frozenset(got)
    _local.gitems = (u.get("id"), v)
    return v


def _guest_gate(req) -> None:
    u, p, m = req.user, req.path, req.method
    if p.startswith("/api/auth/"):
        return   # qui je suis, me déconnecter, ouvrir un lien
    if not req.protected:
        if p.startswith("/commun/") or any(p.startswith(x) for r in _realms for x in r["pages"]):
            return
        if m in ("GET", "HEAD"):
            req.path, req.rewritten = GUEST_HOME, True   # une autre page du portail : chez lui
            return
        raise HttpError(403, GUEST_WHY)
    for rules in [_GUEST_BASE] + [r["routes"] for r in _realms]:
        for methods, rx, judge in rules:
            mm = rx.fullmatch(p) if m in methods else None
            if mm:
                if judge is None or judge(u, **mm.groupdict()):
                    return
                raise HttpError(403, GUEST_WHY)
    raise HttpError(403, GUEST_WHY)


def r_guest_home(req):
    """`GUEST_HOME` : où va un invité qui demande une autre page (la route est posée
    par l'outil qui déclare le premier royaume, server/tools/ideation_collab.py)."""
    u = getattr(req, "user", None)
    to = "/"
    if is_guest(u):
        for r in _realms:
            h = r["home"](u) if r["home"] else None
            if h and _safe_next(h):
                to = h
                break
    return Response(b"", 303, "text/plain; charset=utf-8", {"Location": to, "Cache-Control": "no-store"})


def _safe_next(v) -> bool:
    """Une adresse de retour : un chemin de ce site, jamais un autre hôte."""
    return (isinstance(v, str) and 0 < len(v) <= 2048 and v.startswith("/") and not v.startswith("//")
            and "\\" not in v and not any(c in v for c in "\r\n\t\x00") and not v.startswith("/invitation"))


def _next_of(req) -> str:
    try:
        raw = req._h.path   # le chemin et la requête tels que reçus
    except AttributeError:
        raw = req.path
    return raw if _safe_next(raw) and raw != "/" else ""


# les en-têtes que pose le bord de Cloudflare (https://developers.cloudflare.com/fundamentals/reference/http-headers/)
EDGE_HEADERS = ("Cf-Ray", "Cf-Connecting-IP", "Cf-Access-Jwt-Assertion", "Cf-Worker", "Cf-Visitor")


def _from_edge(req) -> bool:
    if any(req.headers.get(h) for h in EDGE_HEADERS):
        return True
    return "cloudflare" in (req.headers.get("CDN-Loop") or "").lower()


def gate(req, app) -> None:
    """Posée devant chaque requête par core/http.py (`app.gate`) : qui entre
    (`_gate`), puis dans quel Workspace (`_bind_space`), puis un calcul hors
    file (`COMPUTE_ROUTES`, `_compute_gate`) : la même garde que jobs.submit."""
    set_current_space(None)
    _gate(req, app)
    _bind_space(req)
    _compute_gate(req)


def _space(req) -> str | None:
    """Le Workspace courant de la requête, calculé une fois : l'en-tête X-SR-Espace,
    sinon ?e=, vérifié (core/espaces.py, resolve) ; sans rien, le dernier de la
    personne, sinon Général. Un Workspace demandé qu'on ne voit pas n'est jamais pris."""
    if getattr(req, "_space_done", False):
        return req.workspace
    req._space_done = True
    req.workspace, req.workspace_refused, req.workspace_why = None, None, None
    u = getattr(req, "user", None)
    if not u:
        return None
    from . import espaces
    want = espaces.wanted(req)
    try:
        ws, why = espaces.resolve(u, want)
    except HttpError as e:   # teams.json illisible : on ne tombe pas, on ne prend rien
        ws, why = None, e.message
    req.workspace = ws
    if want and why:
        req.workspace_refused, req.workspace_why = want, why
    return ws


def _bind_space(req) -> None:
    ws = _space(req)
    set_current_space(ws)
    if req.workspace_refused and req.protected and not req.path.startswith("/api/auth/"):
        raise HttpError(403, req.workspace_why)


def _gate(req, app) -> None:
    """Qui entre. `app.door` (« demo », « access », « code ») : l'App de la porte
    publique, qui a reçu la requête."""
    set_current(None)
    req.user = None
    req.session = None
    req.door = getattr(app, "door", None)
    _local.door = req.door
    _local.gitems = None
    req.protected = _protected(req, app)
    if req.door:
        return _door_gate(req)
    if _from_edge(req):
        # un tunnel pointé sur la maison : tout y arriverait de 127.0.0.1, « le réseau de Cal »
        raise HttpError(403, f"cette écoute est la maison : un tunnel Cloudflare vise la porte publique "
                             f"({':'.join(map(str, door_address()))}), jamais {req.headers.get('Host') or 'ce port'}")
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
    if is_guest(req.user):
        return _guest_gate(req)
    _studio_only(req)
    if not enabled() or not req.protected or req.path.startswith("/api/auth/"):
        return
    if not req.user:
        if offnet:
            raise HttpError(403, OFFNET.format(p=u.get("pseudo") or u["name"]))
        if u and u.get("state") == "suspended":
            raise HttpError(403, "ton accès est suspendu : vois avec Cal")
        raise HttpError(401, "connexion requise : tape ton pseudo à l'accueil du portail")
    _admin_only(req)


def _door_gate(req) -> None:
    """La porte publique. « access » : rien sans l'identité du Worker (pages
    comprises : le Worker sert les pages lui-même). « demo » : sans invitation
    ni session, seule la page d'invitation (et les feuilles de style
    qu'elle charge) ; ensuite, comme à la maison, sans le réseau de Cal."""
    if req.door == "code":
        # seul le Worker entre (sa signature, rôle « code », l'adresse du visiteur) ; ensuite, comme la démo.
        # Pseudo seul (Cal, 29/09 au soir) : aucune identité Access n'est reçue ici, Cal compris.
        ident = _worker_identity(req, ("code",))
        try:
            req.porte_ip = str(ipaddress.ip_address(ident[0]))
        except ValueError:
            req.porte_ip = ""
    if req.door == "access":
        u = _access_user(req)
        set_current(u)
        req.user = u
        if req.method not in ("GET", "HEAD", "OPTIONS"):
            _csrf(req)
        if is_guest(u):
            return _guest_gate(req)
        _admin_only(req)
        _studio_only(req)
        return
    if req.door not in PSEUDO_DOORS:
        raise HttpError(503, f"porte publique : mode inconnu « {req.door} »")
    req.invitation = demo_level(_door_mark(req))
    h, s, u = session_of(req)
    if u and u.get("state") == "active":
        set_current(u)
        req.user, req.session = u, h
    if req.method not in ("GET", "HEAD", "OPTIONS"):
        _csrf(req)
    p = req.path
    if p.startswith("/invitation/") or p.startswith("/api/auth/"):
        return   # la page d'invitation, et la porte elle-même (enter exige l'invitation)
    if not req.invitation and not s:
        if req.method in ("GET", "HEAD") and not p.startswith("/api/") and not req.protected:
            if p.startswith("/commun/"):
                return   # les styles et les fontes de la page d'invitation : le dépôt public
            # toute page montre l'invitation ; le code donné, on revient à la page demandée
            # (le lien d'une planche d'Idéation garde ainsi son jeton)
            req.next = _next_of(req)
            req.path, req.rewritten = "/invitation/", True
            return
        raise HttpError(401, NO_INVITE)
    if is_guest(req.user):
        return _guest_gate(req)
    _studio_only(req)
    if not req.protected:
        return
    if not req.user:
        if u and u.get("state") == "suspended":
            raise HttpError(403, "ton accès est suspendu : vois avec Cal")
        raise HttpError(401, "connexion requise : tape ton pseudo à l'accueil du portail")
    _admin_only(req)


def after(req, status: int) -> None:
    """Après chaque requête : le journal des écritures (audit B5), puis le
    contexte est effacé."""
    try:
        if req.method not in ("GET", "HEAD", "OPTIONS") and getattr(req, "protected", False):
            u = getattr(req, "user", None)
            extra = {"porte": req.door} if getattr(req, "door", None) else {}
            if getattr(req, "workspace", None):
                extra["space"] = req.workspace
            journal("http", user=u["id"] if u else None, method=req.method, path=req.path, status=status, **extra)
    except Exception:
        pass
    finally:
        set_current(None)
        set_current_space(None)
        _local.door = None
        _local.gitems = None


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
    """`access` : « apps » ou « studio » (un admin : toujours studio) ; `studio_asked` :
    la date de sa demande de Studio, tant qu'elle attend."""
    out = {"id": u["id"], "name": u["name"], "pseudo": u.get("pseudo") or u["name"], "role": u.get("role", "ami"),
           "access": access_of(u)}
    if out["access"] == "apps" and u.get("studio_request"):
        out["studio_asked"] = u["studio_request"]
    return out


def _waiting() -> int:
    """Ce qui attend Cal : les pseudos neufs, les demandes de Studio."""
    with _lock:
        us = _data()["users"].values()
        return sum(1 for x in us if x.get("state") == "pending"
                   or (x.get("state") == "active" and x.get("studio_request") and not has_studio(x)))


def me(req) -> dict:
    d = door_of(req)
    if d == "access":   # la porte a déjà vérifié l'identité (sinon 401 avant d'arriver ici)
        u = getattr(req, "user", None)
        if not u:
            return {"auth": True, "state": "anonymous", "porte": d}
        out = {"auth": True, "state": "active", "user": public_user(u), "since": u.get("created"), "porte": d,
               "visibility": settings()["visibility"], **_spaces_of(req, u)}
        if is_admin(u):
            out["pending_requests"] = _waiting()
        return out
    if d in PSEUDO_DOORS:
        return {**_me(req), "porte": d, "invitation": getattr(req, "invitation", None) or False,
                "sur_liste": open_door(d)}
    return _me(req)


def _spaces_of(req, u: dict) -> dict:
    """Ses Teams, ses Workspaces (et ses droits dans chacun), le Workspace courant
    de la requête ; `workspace_refused` : celui demandé qu'on ne lui donne pas."""
    from . import espaces
    try:
        cur = _space(req) if getattr(req, "user", None) and req.user.get("id") == u.get("id") else espaces.default_for(u)
        return espaces.me_payload(u, cur, getattr(req, "workspace_refused", None))
    except HttpError as e:   # teams.json illisible : la page le dit, rien ne tombe
        return {"teams": [], "workspace": None, "teams_error": e.message}


def _me(req) -> dict:
    if not enabled() and not door_of(req):
        u = pseudo_admin()
        return {"auth": False, "state": "active", "user": public_user(u), "visibility": settings()["visibility"],
                **_spaces_of(req, u)}
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
        out.update(_spaces_of(req, u))
        if is_admin(u):
            out["pending_requests"] = _waiting()
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
    d = door_of(req)
    if d == "access":
        raise HttpError(409, "sur cette porte, ton identité vient de Cloudflare Access : rien à taper")
    level, door = None, {}
    if d in PSEUDO_DOORS:
        mark = _door_mark(req)
        level = demo_level(mark)
        if not level:
            raise HttpError(401, NO_INVITE)
        door = {"porte": d, "code": mark}
    elif not enabled():
        raise HttpError(409, "la porte est coupée sur ce portail (auth: false)")
    name = clean_name(name)
    if not valid_name(name):
        raise HttpError(400, "ton pseudo : de 2 à 24 lettres ou chiffres (espace, trait d'union, point permis)")
    key, ip = slug(name), _ip(req)
    _rate(f"entree:{ip}", 30, 600)
    with _lock:
        db = _data()
        u = _find(key)
        if u is None:
            if open_door(d):   # sans invitation : seuls entrent les pseudos que Cal a ajoutés (Admin)
                raise HttpError(403, f"« {name} » n'est pas encore inscrit : demande à Cal de t'ajouter")
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
            if d:
                u["via"] = d
            db["users"][key] = u
            _save()
            tok = _new_session(key, req, **door)
            journal("demande", user=key, name=name, ip=ip, **({"porte": d} if d else {}))
            return "pending", dict(u), tok
        if u.get("state") == "suspended":
            raise HttpError(403, "ce compte est suspendu : vois avec Cal")
        if d and is_admin(u) and level != "admin" and not admin_by_pseudo(d):
            raise HttpError(403, DOOR_ADMIN.format(p=f"« {name} »"))
        if _offnet(u, req):
            raise HttpError(403, OFFNET.format(p=f"« {name} »"))
        tok = _new_session(u["id"], req, **door)
    journal("entrée" if u["state"] == "active" else "demande rejointe", user=u["id"], ip=ip,
            **({"porte": d, "niveau": level} if d else {}))
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


def accept(uid: str, by: str, role: str | None = None, *, access: str | None = None, perso: bool | None = None,
           via: str | None = None) -> dict:
    """Une demande acceptée : par Cal (un ami), ou par le lien d'un outil (`role`
    = GUEST : un invité, qui n'a que ce que le lien lui donne). Le lien d'une Team
    (core/espaces.py, redeem) passe `access` (« apps » : c'est la Team qui a le
    Studio) et `perso` (False pour un guest : ni Team personnelle, ni calcul)."""
    with _lock:
        u = _data()["users"].get(uid)
        if not u or u.get("state") != "pending":
            raise HttpError(404, "pas de demande en attente à ce pseudo")
        u.update(state="active", accepted=now_iso(), by=by)
        if role == GUEST:
            u["role"] = GUEST
        elif access in ACCESS:
            u["access"] = access
        else:   # un compte neuf : le droit Studio du réglage (phase d'essai : studio)
            u.setdefault("access", settings()["new_access"])
        if perso is False:
            u["perso"] = False
        if via:
            u["via"] = via
        _save()
    journal("accepté", user=uid, by=by, **({"role": role} if role else {}), **({"via": via} if via else {}))
    if role != GUEST and access is None and perso is not False:   # Cal accepte un ami à la porte
        _join_instance_team(u)
    return dict(u)


def _join_instance_team(u: dict) -> None:
    """Un ami que Cal accepte à la porte, crée d'avance, fait ami (un invité de planche)
    ou à qui il ouvre le Studio dans l'Admin — avec le Studio — devient membre de la
    Team de l'instance — celle de l'espace par défaut, « Nirvalab » —, donc éditeur
    de « Général » (un admin du portail aussi : membre ; ses pouvoirs viennent du
    portail, et s'en vont avec lui). C'est la règle 2
    de la migration (equipes_espaces.md § 5.1), tenue pour chaque nouvel ami : « tout
    le monde est dans Général » reste vrai après le 30/09, un ami d'aujourd'hui voit
    et fait ce qu'il faisait. Un compte Apps n'a que sa Team personnelle ; qui entre
    par le lien d'une Team (un membre, un guest), un invité de planche : ce que leur
    lien leur donne (core/espaces.py, redeem)."""
    from . import espaces
    tid = espaces.team_of_space(espaces.default_space())
    if not tid or u.get("id") == admin_id() or u.get("state") != "active" or u.get("perso") is False \
            or u.get("via") == "equipe" or (u.get("role") != "admin" and u.get("access") != "studio"):
        return
    try:   # membre, jamais admin de Team : un admin du portail a déjà tout (il redevient ami : un membre)
        espaces.add_member(None, tid, u["name"], "member")
    except HttpError as e:   # une Team archivée, teams.json illisible : l'ami reste accepté, Cal le met à la main
        journal("team de l'instance : pas ajouté", user=u.get("id"), why=e.message)


def find_pseudo(name) -> dict | None:
    """Le compte qui porte ce pseudo (tapé comme à la porte : casse, accents, espaces), ou None."""
    key = slug(clean_name(name))
    if len(key) < 2:
        return None
    with _lock:
        u = _find(key)
        return dict(u) if u else None


def create_invited(pseudo, by: str, guest: bool) -> dict:
    """Un pseudo neuf mis dans une Team par son admin (core/espaces.py, add_member) :
    déjà accepté, comme un pseudo que Cal ajoute (il entre en le tapant), mais sans le
    Studio du compte (c'est la Team qui l'a) ; un guest n'a pas de Team personnelle
    (`perso: false`) : il ne calcule nulle part."""
    name = clean_name(pseudo)
    if not valid_name(name):
        raise HttpError(400, "le pseudo : de 2 à 24 lettres ou chiffres (espace, trait d'union, point permis)")
    key = slug(name)
    with _lock:
        db = _data()
        if _find(key) or key in db["users"]:
            raise HttpError(409, f"« {name} » existe déjà")
        why = _imitation(key)
        if why == "réservé":
            raise HttpError(409, f"« {name} » est réservé : choisis un autre pseudo")
        if why:
            raise HttpError(409, f"« {name} » ressemble trop à un pseudo qui existe déjà : choisis-en un autre")
        u = {"id": key, "name": name, "pseudo": name, "role": "ami", "access": "apps", "state": "active",
             "created": now_iso(), "accepted": now_iso(), "by": by, "via": "equipe", "quotas": {}}
        if guest:
            u["perso"] = False
        db["users"][key] = u
        _save()
    journal("ajouté par une Team", user=key, by=by, guest=guest)
    return dict(u)


def delete_user(uid: str, by: str) -> dict:
    """Détruire un compte (Admin → Personnes → Supprimer ; Cal, 01/10 : « je peux que les suspendre »).
    Le compte et ses connexions disparaissent ; il peut se recréer (le même pseudo redevient libre).
    Un admin ne se détruit pas (lui retirer d'abord le rôle), ni soi-même. Ce qu'il a rangé reste :
    les objets sont à leurs Workspaces (core/espaces.py, forget_user)."""
    with _lock:
        db = _data()
        u = db["users"].get(uid)
        if not u:
            raise HttpError(404, "pas de compte à ce pseudo")
        if u.get("state") == "pending":
            raise HttpError(409, "c'est une demande : refuse-la plutôt")
        if u.get("role") == "admin":
            raise HttpError(409, "un admin ne se détruit pas : retire-lui d'abord le rôle admin")
        if uid == by:
            raise HttpError(409, "tu ne peux pas détruire ton propre compte")
        db["users"].pop(uid)
        gone = [h for h, x in db["sessions"].items() if x.get("user") == uid]
        for h in gone:
            db["sessions"].pop(h, None)
        _save()
    journal("détruit", user=uid, name=u.get("name", ""), by=by, connexions=len(gone))
    return u


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


def create_friend(pseudo, by: str, role: str = "ami", access: str | None = None) -> dict:
    """Un pseudo créé d'avance par Cal (Admin, ou `showrunner.py --ami`), déjà
    accepté : celui qui le tape entre aussitôt, sans attendre (Cal, 29/09 : « un
    login simple genre su007 »). Mêmes règles qu'un pseudo tapé à la porte : ni
    imitation d'un admin, ni mot réservé, ni pseudo trop proche d'un autre.
    `role` : ami ou admin (un admin, sur la porte publique, entre avec le code admin).
    `access` : apps ou studio ; rien : le réglage `new_access`."""
    if role not in ("ami", "admin"):
        raise HttpError(400, "rôle : ami ou admin")
    if access in (None, ""):
        access = settings()["new_access"]
    if access not in ACCESS:
        raise HttpError(400, "accès : apps ou studio")
    name = clean_name(pseudo)
    if not valid_name(name):
        raise HttpError(400, "le pseudo : de 2 à 24 lettres ou chiffres (espace, trait d'union, point permis)")
    key = slug(name)
    with _lock:
        db = _data()
        if _find(key) or key in db["users"]:
            raise HttpError(409, f"« {name} » existe déjà")
        why = _imitation(key)
        if why == "réservé":
            raise HttpError(409, f"« {name} » est réservé : choisis un autre pseudo")
        if why:
            raise HttpError(409, f"« {name} » ressemble trop à un pseudo qui existe déjà : choisis-en un autre")
        u = {"id": key, "name": name, "pseudo": name, "role": role, "access": access, "state": "active",
             "created": now_iso(), "accepted": now_iso(), "by": by, "via": "admin", "quotas": {}}
        db["users"][key] = u
        _save()
    journal("ajouté d'avance", user=key, by=by, role=role, access=access)
    _join_instance_team(u)
    return dict(u)


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
                        "seen": max((s.get("seen") or "" for s in ss), default=""),
                        # le droit Studio : l'effectif (un admin l'a toujours), et la demande qui attend
                        "access": access_of(u),
                        "studio_asked": (u.get("studio_request") or None) if not has_studio(u) else None,
                        # Teams et Workspaces : un compte entré comme guest n'a pas de « Chez moi »
                        "perso": u.get("perso", True) is not False and u.get("role") != GUEST, "via": u.get("via")})
    return sorted(out, key=lambda x: (x["role"] != "admin", x["state"] != "pending", x["name"].lower()))


def set_user(uid: str, patch: dict, by: str) -> dict:
    with _lock:
        u = _data()["users"].get(uid)
        if not u:
            raise HttpError(404, "personne inconnue")
        if "role" in patch:
            if patch["role"] not in ROLES:
                raise HttpError(400, "rôle : admin, ami ou invite (un invité n'a que ce qu'on lui a partagé)")
            if u.get("state") != "active":
                raise HttpError(409, "accepte ou réactive d'abord ce compte")
            if patch["role"] != "admin" and u.get("role") == "admin" and len(admins()) <= 1:
                raise HttpError(409, "c'est le dernier admin : donne d'abord le rôle à quelqu'un d'autre")
            u["role"] = patch["role"]
            if patch["role"] != GUEST:   # un admin qui redevient ami, sans droit posé : celui d'un compte neuf
                u.setdefault("access", settings()["new_access"])
        if "access" in patch:
            if patch["access"] not in ACCESS:
                raise HttpError(400, "accès : apps ou studio")
            if u.get("state") == "pending":
                raise HttpError(409, "accepte d'abord ce compte")
            u["access"] = patch["access"]
            if patch["access"] == "studio":
                u.pop("studio_request", None)   # le Studio ouvert : la demande est servie
        if "studio_request" in patch:
            # écarter une demande (null), ou la rendre (Ctrl+Z dans Admin : sa date d'origine)
            v = patch["studio_request"]
            if v in (None, ""):
                u.pop("studio_request", None)
            elif isinstance(v, str) and len(v) <= 40 and re.fullmatch(r"[0-9T:+.Z-]+", v):
                if not has_studio(u):
                    u["studio_request"] = v
            else:
                raise HttpError(400, "demande de Studio : une date, ou null pour l'écarter")
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
    if ("role" in patch or patch.get("access") == "studio") and out.get("role") != GUEST:
        _join_instance_team(out)   # Cal en fait un ami (ou lui ouvre le Studio) : dans Général, comme les autres
    return out


# ── la porte publique : le second point d'écoute ────────────
# Réglage `porte` de showrunner.local.json (défauts ci-dessous) :
#   {"mode": "demo" | "access" | "code" | "off", "port": <port + 1000>,
#    "team_domain": "https://nirvalab.cloudflareaccess.com", "aud": "<tag AUD>",
#    "cle": "~/.config/showrunner/porte.key", "emails": {"<e-mail de Cal>": "cal"},
#    "url": "https://showrunner.luxigone.workers.dev"}   (l'adresse des liens d'invitation, mode « code »)
DOOR_MODES = ("demo", "access", "code", "off")
PSEUDO_DOORS = ("demo", "code")   # les portes où l'on entre par un code d'invitation, puis son pseudo
PUBLIC_URL = "https://showrunner.luxigone.workers.dev"
NO_INVITE = "sur invitation : ouvre d'abord le lien d'invitation de Cal"
INVITE_COOKIE = "sr_invitation"
INVITE_DAYS = 14
DOOR_ADMIN = ("{p} est un compte admin : sur la porte publique, il n'entre qu'avec le code admin "
              "(le lien d'invitation admin de Cal)")
# des codes qu'on dicte : ni 0/O, ni 1/I/L
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_dlock = threading.Lock()
_demo: dict = {"m": None, "v": {}}
_keyc: dict = {"m": None, "v": None}


def door_settings() -> dict:
    raw = config.get("porte")
    d = {"mode": raw} if isinstance(raw, str) else dict(raw or {})
    mode = str(d.get("mode") or "demo")
    return {
        "mode": mode if mode in DOOR_MODES else "off",
        "host": str(d.get("host") or "127.0.0.1"),
        "port": int(d.get("port") or int(config.get("port")) + 1000),
        "team_domain": str(d.get("team_domain") or "").rstrip("/"),
        "aud": str(d.get("aud") or ""),
        "cle": str(d.get("cle") or "~/.config/showrunner/porte.key"),
        "emails": {str(k).strip().lower(): str(v) for k, v in (d.get("emails") or {}).items()},
        "url": str(d.get("url") or PUBLIC_URL).rstrip("/"),
        # porte « code » : le code d'invitation est-il demandé ? false (phase d'essai, Cal, 29/09 à 19 h) : on tape son
        # pseudo et l'on entre si Cal l'a ajouté dans Admin ; un compte admin exige toujours le code admin
        "invitation": d.get("invitation", True) is not False,
        # porte ouverte (sans invitation) : un admin entre aussi par son seul pseudo, sans le code admin (Cal, 04/09 :
        # « 6 ordinateurs »). Faux par défaut : un pseudo admin n'est pas un secret (il est écrit dans docs/, dépôt public) ;
        # bash tools/porte.sh admin-pseudo on|off
        "admin_pseudo": d.get("admin_pseudo") is True,
    }


def open_door(d: str | None) -> bool:
    """La porte « code » sans code d'invitation (`porte.invitation = false`)."""
    return d == "code" and not door_settings()["invitation"]


def admin_by_pseudo(d: str | None) -> bool:
    """Un admin entre par son seul pseudo : seulement sur la porte ouverte, et si Cal l'a voulu (`porte.admin_pseudo`)."""
    return open_door(d) and door_settings()["admin_pseudo"]


def _door_mark(req) -> str | None:
    """L'empreinte du code qui ouvre la porte pour cette requête : celle du cookie
    d'invitation ; sur la porte ouverte (sans invitation), à défaut, celle du code
    d'invitation en cours — comme si chacun l'avait. Une session ouverte ainsi y
    reste liée : `nouveaux-codes` la ferme aussi, et rétablir l'invitation n'y
    change rien (elle garde le code en cours). Le code admin, lui, reste exigé
    pour un compte admin (le cookie qu'il pose)."""
    mark = _cookie(req, INVITE_COOKIE)
    if demo_level(mark):
        return mark
    if open_door(door_of(req)):
        return code_mark(demo_codes()["invitation"])
    return mark


def invite_links() -> dict:
    """Ce que Cal envoie : l'adresse, le lien d'invitation (le code dedans), le code
    admin. Porte « code » : l'adresse fixe ; « demo » : celle du tunnel rapide."""
    ds = door_settings()
    if ds["mode"] not in PSEUDO_DOORS:
        return {"mode": ds["mode"]}
    st = demo_codes()
    url = ds["url"] if ds["mode"] == "code" else str(st.get("url") or "")
    ouverte = open_door(ds["mode"])
    return {"mode": ds["mode"], "url": url, "invitation": st["invitation"], "admin": st["admin"],
            "invitation_requise": not ouverte,
            "lien": (url if ouverte else f"{url}/invitation/{st['invitation']}") if url else "",
            "lien_admin": f"{url}/invitation/{st['admin']}" if url else ""}


def door_address() -> tuple[str, int]:
    s = door_settings()
    return s["host"], s["port"]


def door_of(req) -> str | None:
    """« demo », « access », ou None (la maison) : fixé par `gate`, d'après l'App qui a reçu la requête."""
    return getattr(req, "door", None)


def loopback(host: str) -> bool:
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


# ── la démo : les codes ─────────────────────────────────────
def _demo_file() -> Path:
    return config.data_dir() / "porte-demo.json"


def _new_code(groups: int) -> str:
    return "-".join("".join(secrets.choice(_CODE_ALPHABET) for _ in range(4)) for _ in range(groups))


def _norm_code(code) -> str:
    return re.sub(r"[^A-Z0-9]", "", unicodedata.normalize("NFKC", str(code or "")).upper())[:64]


def code_mark(code: str) -> str:
    """Ce que garde le cookie d'invitation et la session : l'empreinte du code, jamais le code."""
    return hashlib.sha256(b"showrunner-porte\n" + _norm_code(code).encode()).hexdigest()[:40]


def demo_state() -> dict:
    """Les codes de la démo (relus si le fichier change : tools/demo.sh les renouvelle portail en marche)."""
    f = _demo_file()
    try:
        st = f.stat()
    except OSError:
        return {}
    m = (st.st_ino, st.st_mtime_ns, st.st_size)   # chaque écriture remplace le fichier : un autre inode
    with _dlock:
        if _demo["m"] != m:
            try:
                _demo["v"] = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                _demo["v"] = {}
            _demo["m"] = m
        return dict(_demo["v"])


def _write_demo(st: dict) -> None:
    f = _demo_file()
    tmp = f.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(st, fh, ensure_ascii=False, indent=1)
    tmp.replace(f)
    with _dlock:
        _demo["m"] = None   # relu à la prochaine demande


def demo_codes(renew: bool = False) -> dict:
    """Les codes de la démo, créés s'il n'y en a pas (ou renouvelés : toutes les
    sessions ouvertes sur la porte se ferment, les cookies d'invitation ne valent plus)."""
    st = demo_state()
    if renew or not (st.get("invitation") and st.get("admin")):
        st = {"invitation": _new_code(3), "admin": _new_code(4), "cree": now_iso(), "url": st.get("url", "")}
        _write_demo(st)
        journal("porte : nouveaux codes")
    return st


def demo_set_url(url: str) -> dict:
    url = (url or "").strip().rstrip("/")
    if url and not re.fullmatch(r"https://[a-z0-9-]+\.trycloudflare\.com", url):
        raise ValueError("une adresse https://….trycloudflare.com, ou vide")
    st = demo_codes()
    st["url"] = url
    _write_demo(st)
    return st


def demo_url() -> str:
    return str(demo_state().get("url") or "").lower()


def demo_level(mark: str | None) -> str | None:
    """« admin », « invitation » ou None, d'après l'empreinte d'un code (le cookie, la session)."""
    st = demo_state()
    if not mark or not st.get("invitation") or not st.get("admin"):
        return None
    if hmac.compare_digest(mark, code_mark(st["admin"])):
        return "admin"
    if hmac.compare_digest(mark, code_mark(st["invitation"])):
        return "invitation"
    return None


def _door_session_ok(req, s: dict, u: dict | None) -> bool:
    """Une session ne vaut sur la porte que si elle y a été ouverte, avec un code
    encore bon ; celle d'un admin, avec le code admin. Une session de la maison
    n'y vaut rien."""
    d = door_of(req)
    if not d:
        return True
    if d not in PSEUDO_DOORS or s.get("porte") != d:
        return False
    level = demo_level(s.get("code"))
    return bool(level) and (level == "admin" or not is_admin(u) or admin_by_pseudo(d))


def invite_cookie(level_mark: str | None) -> str:
    if not level_mark:
        return f"{INVITE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure"
    return f"{INVITE_COOKIE}={level_mark}; Path=/; HttpOnly; SameSite=Lax; Max-Age={INVITE_DAYS * 86400}; Secure"


def _invitation_page(message: str = "", status: int = 200, next_: str = "", door: str = "demo") -> Response:
    warn = f'<p class="warn" role="alert">{html.escape(message)}</p>' if message else ""
    back = f'<input type="hidden" name="next" value="{html.escape(next_)}">' if _safe_next(next_) else ""
    lbl, intro = (("démonstration · sur invitation", "Une démonstration privée du portail de Cal.") if door == "demo"
                  else ("sur invitation", "Le portail de Cal, sur invitation."))
    page = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<script src="/commun/theme-tot.js"></script>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/media/icone-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Showrunner">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="theme-color" content="#0a0d0b">
<meta name="robots" content="noindex">
<title>SHOWRUNNER TOOLS · invitation</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Azeret+Mono:wght@300;400;500&display=swap">
<link rel="stylesheet" href="/commun/tokens.css">
<link rel="stylesheet" href="/commun/base.css">
<link rel="stylesheet" href="/commun/shell.css">
<link rel="stylesheet" href="/commun/porte.css">
</head>
<body class="porte-on">
<div class="porte">
  <div class="porte-in">
    <div class="porte-top">
      <span class="logo"><span class="sq"><i></i></span><span><b>Showrunner</b><small>tools</small></span></span>
      <span class="sp"></span><span class="lbl">{lbl}</span>
    </div>
    <section class="hero porte-card">
      <span class="ref">00_INVITATION</span>
      <h1>Tous nos outils une seule porte</h1>
      <p>{intro} Tape le code d’invitation qu’il t’a donné ; ensuite, ton pseudo.</p>
      <form class="porte-form" method="post" action="/invitation/">
        <div class="row"><input class="fld" name="code" placeholder="le code d’invitation" maxlength="40" autocomplete="off"
          aria-label="le code d’invitation" spellcheck="false" autocapitalize="characters" required autofocus>
          <button class="tb go" type="submit">Continuer</button></div>{back}
      </form>
      {warn}
    </section>
  </div>
</div>
</body>
</html>
"""
    return Response(page, status, "text/html; charset=utf-8", {"Cache-Control": "no-store", "X-Porte": door})


def invitation(req, rest: str):
    """`/invitation/` (le formulaire), `POST /invitation/` (code=…), `/invitation/<code>`
    (le lien que Cal envoie) : sur les portes « demo » et « code » seulement.
    `?next=/chemin` : où revenir le code donné (commun/porte.js l'y envoie)."""
    d = door_of(req)
    if d not in PSEUDO_DOORS:
        raise HttpError(404, "introuvable")
    if req.method not in ("GET", "HEAD", "POST"):
        raise HttpError(405, "méthode refusée ici : GET, POST")
    code, back = "", ""
    if req.method != "POST" and _safe_next(req.q("next")):
        back = req.q("next")
    if req.method == "POST":
        raw = req.body()[:6144].decode("utf-8", "replace")
        ctype = (req.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype == "application/json":
            try:
                d = json.loads(raw) or {}
                code, back = str(d.get("code") or ""), str(d.get("next") or "")
            except (ValueError, AttributeError):
                code = ""
        else:
            form = parse_qs(raw)
            code, back = (form.get("code") or [""])[0], (form.get("next") or [""])[0]
        back = back if _safe_next(back) else ""
    elif rest.strip("/") and not getattr(req, "rewritten", False):
        code = unquote(rest.strip("/"))
    if req.method == "POST" or code:
        ip = _ip(req)
        try:
            _rate(f"code:{ip}", 10, 600)
            _rate("code:tous", 300, 600)
        except HttpError as e:
            return _invitation_page(e.message, 429, back, d)
        st = demo_state()
        n = _norm_code(code)
        level = None
        if n and st.get("admin") and hmac.compare_digest(n, _norm_code(st["admin"])):
            level = "admin"
        elif n and st.get("invitation") and hmac.compare_digest(n, _norm_code(st["invitation"])):
            level = "invitation"
        if not level:
            journal("porte : code refusé", ip=ip)
            return _invitation_page("ce code n’ouvre pas la porte : vérifie-le auprès de Cal", 403, back, d)
        journal("porte : invitation", niveau=level, ip=ip, porte=d)
        return Response(b"", 303, "text/plain; charset=utf-8",
                        {"Location": back or "/", "Set-Cookie": invite_cookie(code_mark(n)), "Cache-Control": "no-store",
                         "X-Porte": d})
    if getattr(req, "invitation", None) and not getattr(req, "rewritten", False):
        return Response(b"", 303, "text/plain; charset=utf-8", {"Location": back or "/", "Cache-Control": "no-store"})
    return _invitation_page("", 401 if getattr(req, "rewritten", False) else 200, getattr(req, "next", "") or back, d)


# ── la vraie porte : le Worker et Cloudflare Access ─────────
def door_key() -> bytes | None:
    """La clé HMAC partagée avec le Worker (secret PORTE_CLE) : un fichier hors du
    dépôt, lisible par son seul propriétaire (sinon refusée, comme ssh)."""
    p = Path(os.path.expanduser(door_settings()["cle"]))
    try:
        st = p.stat()
    except OSError:
        return None
    if stat.S_IMODE(st.st_mode) & 0o077:
        print(f"porte : {p} est lisible par d'autres (chmod 600) : clé refusée", flush=True)
        return None
    with _dlock:
        if _keyc["m"] != (st.st_mtime_ns, st.st_size):
            k = p.read_bytes().strip()
            _keyc["v"], _keyc["m"] = (k if len(k) >= 32 else None), (st.st_mtime_ns, st.st_size)
        return _keyc["v"]


def signed_identity(req, key: bytes, roles=("admin", "ami")) -> tuple[str, str] | None:
    """(qui, rôle) signés par le Worker, ou None. La signature couvre
    qui \\n rôle \\n quand \\n méthode \\n chemin?requête (tel que reçu), à ±60 s.
    `qui` : l'e-mail (rôles admin, ami : Cloudflare Access) ou, pour le rôle
    `code` (porte « code » seulement), l'adresse du visiteur."""
    g = req.headers.get
    qui, role, quand, sig = (g(h) or "" for h in ("X-Porte-Qui", "X-Porte-Role", "X-Porte-Quand", "X-Porte-Sig"))
    if not (qui and role in roles and quand.isdigit() and re.fullmatch(r"[0-9a-f]{64}", sig)):
        return None
    if abs(time.time() - int(quand)) > 60:
        return None
    msg = "\n".join((qui, role, quand, req.method, req._h.path)).encode()
    want = hmac.new(key, msg, hashlib.sha256).hexdigest()
    return (qui.lower(), role) if hmac.compare_digest(want, sig) else None


def _b64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# DigestInfo de SHA-256 (RFC 8017, § 9.2, note 1) : ce que RS256 signe, devant l'empreinte
_SHA256_INFO = bytes.fromhex("3031300d060960864801650304020105000420")
_jwks: dict = {"team": "", "t": 0.0, "try": 0.0, "keys": {}}
_jwks_lock = threading.Lock()


def rs256_ok(n: int, e: int, signed: bytes, sig: bytes) -> bool:
    """RSASSA-PKCS1-v1_5 avec SHA-256, en bibliothèque standard : s^e mod n doit
    être exactement le bloc 00 01 FF…FF 00 DigestInfo empreinte. Clés de 2048
    bits au moins."""
    k = (n.bit_length() + 7) // 8
    if k < 256 or len(sig) != k:
        return False
    s = int.from_bytes(sig, "big")
    if s >= n:
        return False
    t = _SHA256_INFO + hashlib.sha256(signed).digest()
    return hmac.compare_digest(pow(s, e, n).to_bytes(k, "big"), b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t)


def _jwks_fetch(team: str) -> dict:
    url = team + "/cdn-cgi/access/certs"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "showrunner-porte"}), timeout=5) as r:
        doc = json.loads(r.read(1 << 20))
    keys = {}
    for k in doc.get("keys") or []:
        if k.get("kty") == "RSA" and k.get("kid") and k.get("n") and k.get("e"):
            keys[k["kid"]] = (int.from_bytes(_b64u(k["n"]), "big"), int.from_bytes(_b64u(k["e"]), "big"))
    return keys


def _jwk(team: str, kid: str):
    """La clé publique `kid` de l'équipe. Access change de clé toutes les 6
    semaines : relue au plus une heure, ou dès qu'un kid inconnu arrive (au
    plus une fois par minute)."""
    with _jwks_lock:
        now = time.time()
        stale = _jwks["team"] != team or now - _jwks["t"] > 3600
        if stale or (kid not in _jwks["keys"] and now - _jwks["try"] > 60):
            _jwks["try"] = now
            try:
                _jwks.update(keys=_jwks_fetch(team), t=now, team=team)
            except (OSError, ValueError, urllib.error.URLError):
                if _jwks["team"] != team or not _jwks["keys"]:
                    raise OSError("clés Access injoignables")
        return _jwks["keys"].get(kid)


def verify_access_jwt(token: str, team: str, aud: str) -> dict | None:
    """Les champs du jeton Access s'il est bon, sinon None
    (https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) :
    signature RS256 par une clé de l'équipe, iss = l'équipe, aud = l'application, exp non passé."""
    parts = (token or "").split(".")
    if len(parts) != 3:
        return None
    try:
        head, body, sig = json.loads(_b64u(parts[0])), json.loads(_b64u(parts[1])), _b64u(parts[2])
    except (ValueError, binascii.Error, UnicodeDecodeError):
        return None
    if not isinstance(head, dict) or not isinstance(body, dict):
        return None
    if head.get("alg") != "RS256" or not isinstance(head.get("kid"), str):
        return None
    key = _jwk(team, head["kid"])
    if not key or not rs256_ok(key[0], key[1], f"{parts[0]}.{parts[1]}".encode(), sig):
        return None
    now = time.time()
    auds = body.get("aud") if isinstance(body.get("aud"), list) else [body.get("aud")]
    if body.get("iss") != team or aud not in auds:
        return None
    if not isinstance(body.get("exp"), (int, float)) or body["exp"] <= now - 30:
        return None
    if isinstance(body.get("nbf"), (int, float)) and body["nbf"] > now + 30:
        return None
    if not isinstance(body.get("email"), str) or "@" not in body["email"]:
        return None   # un jeton de service n'a pas d'e-mail : il n'entre pas
    return body


def _user_for_email(email: str, mapping: dict) -> dict:
    """Le compte d'un e-mail Access : celui que `porte.emails` désigne (Cal → `cal`,
    ses objets restent à lui), sinon celui qui porte cet e-mail, sinon un compte
    « ami » créé actif — la liste d'Access est déjà celle de Cal."""
    with _lock:
        db = _data()
        uid = mapping.get(email)
        if uid:
            u = db["users"].get(uid)
            if not u:
                raise HttpError(403, "porte.emails désigne un compte absent : vois avec Cal")
            if u.get("email") != email:
                u["email"] = email
                _save()
            return dict(u)
        u = next((x for x in db["users"].values() if (x.get("email") or "").lower() == email), None)
        if u:
            return dict(u)
        name = clean_name(re.sub(r"[^\w .'-]+", " ", email.split("@", 1)[0]))[:20] or "ami"
        if len(slug(name)) < 2 or _imitation(slug(name)):
            name = f"{name}-{secrets.token_hex(2)}"
        uid = slug(name)
        while uid in db["users"]:
            uid = f"{slug(name)[:26]}-{secrets.token_hex(2)}"
        u = {"id": uid, "name": name, "pseudo": name, "email": email, "role": "ami", "state": "active",
             "access": settings()["new_access"],
             "created": now_iso(), "accepted": now_iso(), "by": "access", "via": "access", "quotas": {}}
        db["users"][uid] = u
        _save()
    journal("porte : compte Access créé", user=uid)
    return dict(u)


def _worker_identity(req, roles) -> tuple[str, str]:
    """(qui, rôle) signés par le Worker ; sinon 401 (503 sans clé) : seul le Worker entre."""
    key = door_key()
    if not key:
        raise HttpError(503, "la porte n'a pas sa clé sur ce portail (~/.config/showrunner/porte.key, 600)")
    ident = signed_identity(req, key, roles)
    if not ident:
        raise HttpError(401, "requête refusée : elle ne vient pas de la porte Cloudflare (signature absente ou fausse)")
    return ident


def _access_user(req) -> dict:
    ds = door_settings()
    if not door_key() or not ds["team_domain"] or not ds["aud"]:
        raise HttpError(503, "la porte Access n'est pas réglée sur ce portail (clé, team_domain, aud : "
                             "docs/etudes/cloudflare.md, « Prêt à déployer »)")
    ident = _worker_identity(req, ("admin", "ami"))
    tok = req.headers.get("Cf-Access-Jwt-Assertion") or ""
    try:
        claims = verify_access_jwt(tok, ds["team_domain"], ds["aud"]) if tok else None
    except OSError as e:
        raise HttpError(503, "la porte ne peut pas lire les clés de Cloudflare Access pour le moment") from e
    if not claims:
        raise HttpError(401, "jeton Cloudflare Access absent ou refusé")
    email = claims["email"].strip().lower()
    if email != ident[0]:
        raise HttpError(401, "l'identité signée par le Worker n'est pas celle du jeton Access")
    u = _user_for_email(email, ds["emails"])
    if u.get("state") == "suspended":
        raise HttpError(403, "ton accès est suspendu : vois avec Cal")
    if u.get("state") != "active":
        raise HttpError(403, "ce compte attend Cal")
    if is_admin(u) and ident[1] != "admin":
        u["role"] = "ami"   # admin : le Worker (ADMINS) ET le compte (porte.emails) doivent le dire
    return u


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
