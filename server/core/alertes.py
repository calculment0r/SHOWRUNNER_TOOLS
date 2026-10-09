"""Les alertes de Cal sur son téléphone : un bot Telegram (docs/etudes/equipes_espaces.md,
« Fait le 09/10 — Cal valide les invités, et il en est alerté »).

Cal, 09/10 : « si le user invite quelqu'un je voudrais recevoir une alerte pour pouvoir
valider l'invité… on peut faire un truc par l'app Signal ? ou Telegram ? » — Telegram : une
API de bot officielle en HTTPS, appelable avec la seule bibliothèque standard ; Signal n'en a
pas (l'étude dit pourquoi, sources à l'appui).

Le réglage : `~/.config/showrunner/telegram.json` (réglage `alertes.fichier`), hors du dépôt :
    {"token": "<le jeton que donne @BotFather>", "chat_id": "<le chat de Cal>", "actif": true}
lisible par son seul propriétaire (600), sinon refusé — comme la clé de la porte
(auth.door_key). Admin → Demandes → Alertes l'écrit (le jeton collé, `poser_jeton`), ou
`python3 server/showrunner.py --telegram` sur DGX2 (le jeton tapé sans écho). Le jeton ne sort
jamais d'ici : ni dans une réponse, ni dans le journal, ni dans une page (« posé » ou « pas
posé ») ; une erreur qui le citerait est nettoyée (`_propre`).

L'API : POST <url>/bot<jeton>/<méthode>, un corps JSON ; la réponse {ok, result} ou {ok: false,
error_code, description} (la doc de l'API de bot — https://core.telegram.org/bots/api, fermée
au conteneur du 09/10 : relue dans @grammyjs/types 5.0.0, qui en recopie chaque description).
L'adresse : https://api.telegram.org, ou `alertes.url`, sinon la variable SR_TELEGRAM_URL (le
faux serveur des essais, tools/faux_telegram.py ; tools/portail_essai.py la reprend).

Deux fils, un seul de chaque même si ce module est rechargé : ils sont retrouvés par leur nom
(`_fil`), et chacun porte sa file et son arrêt ; ce qui doit survivre est sur le disque
(`<data_dir>/alertes.json` : les décisions en attente, l'offset, le dernier envoi).
  - « alertes-envoi » : rien ne part dans le fil d'une requête. Un événement se range dans la
    file (bornée) et la requête continue ; chaque appel a ENVOI_S secondes ; un échec est
    journalisé « alerte non envoyée : … » et rien ne tombe. Des invités d'un même admin dans
    une même Team, arrivés ensemble (une liste collée), partent en un seul message (GROUPE_S
    sans rien de neuf, au plus GROUPE_MAX).
  - « alertes-ecoute » : getUpdates en long polling (POLL_S, l'offset tenu), tant qu'un jeton
    est posé et actif. Il reçoit les clics des boutons (callback_query) — du seul chat réglé :
    un autre chat est ignoré — et le « /start <code> » qui relie le chat de Cal (« Trouver mon
    chat » : un code tiré pour l'occasion, jamais le premier venu qui écrit au bot).

Les événements (appelés hors de tout verrou, par core/auth.py et core/espaces.py) :
  invite_en_attente  un pseudo neuf mis dans une Team par un non-Cal (D5)  Valider / Refuser
  demande_porte      un pseudo neuf tapé à la porte                         Valider / Refuser
  demande_studio     un compte Apps demande le Studio                       Ouvrir le Studio / Écarter
  ajoute_par_team    un compte déjà accepté mis dans une Team par un non-Cal   pour info, sans bouton
Un bouton porte `v:<id>` ou `r:<id>` : `<id>` est une décision tenue ici (aléatoire, jamais le
pseudo seul) qui nomme des demandes précises — un compte et sa date de création, une demande
de Studio et sa date — et s'éteint avec elles. Le bouton appelle la même fonction qu'Admin
(auth.accept_request, auth.refuse, auth.set_user) ; tranchée ailleurs (Admin, un autre
message, la personne qui annule), la demande est retirée de ses messages (`clore`), qui disent
le verdict et perdent leurs boutons ; un second clic dit « déjà traité ».
"""

from __future__ import annotations

import functools
import json
import os
import queue
import re
import secrets
import stat
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import auth, config
from .http import HttpError

URL = "https://api.telegram.org"
FICHIER = "~/.config/showrunner/telegram.json"
ENVOI, ECOUTE = "alertes-envoi", "alertes-ecoute"
FILE_MAX = 200            # la file des envois : au-delà, une alerte est perdue (et journalisée)
DECISION_JOURS = 30       # une décision oubliée (le message perdu) s'efface au bout d'un mois
CHERCHE_S = 900           # « Trouver mon chat » : le code vaut un quart d'heure
LIGNES_MAX = 40           # un message : au plus 40 personnes (4096 caractères, sendMessage)
# le jeton de @BotFather : « <id du bot>:<secret> » (l'exemple de la doc : 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11)
TOKEN_RX = re.compile(r"(\d{3,20}):([A-Za-z0-9_-]{20,100})")
_SALE = re.compile(r"\d{3,20}:[A-Za-z0-9_-]{20,100}")
CHAT_RX = re.compile(r"-?\d{1,20}")
DID_RX = re.compile(r"([vr]):([A-Za-z0-9_-]{8,32})")
START_RX = re.compile(r"/start(?:@\w+)?(?:\s+(\S+))?\s*")
VERDICT_RX = re.compile(r" — (validé|refusé|Studio ouvert|demande écartée|demande annulée|déjà traité)|\n— déjà traité")
CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"   # un code qu'on recopie : ni 0/O, ni 1/I/L
COMMANDE = "ssh -t dgx2 'cd ~/SHOWRUNNER_TOOLS && python3 server/showrunner.py --telegram'"

_lock = threading.RLock()
_mem: dict = {"etat": None, "stamp": None, "dit": set()}


# ── les réglages ────────────────────────────────────────────
def _cfg() -> dict:
    raw = config.get("alertes")
    d = dict(raw) if isinstance(raw, dict) else {}
    return {"fichier": Path(os.path.expanduser(str(d.get("fichier") or FICHIER))),
            "url": str(d.get("url") or os.environ.get("SR_TELEGRAM_URL") or URL).rstrip("/"),
            "envoi_s": float(d.get("envoi_s") or 10),          # un appel d'envoi : 10 s au plus
            "poll_s": int(d.get("poll_s") or 50),              # le long polling : 50 s (la doc : « should be positive »)
            "groupe_s": float(d.get("groupe_s", 2.0)),         # des invités arrivés ensemble : un message
            "groupe_max": float(d.get("groupe_max", 30.0))}


def _court(p: Path) -> str:
    home = str(Path.home())
    s = str(p)
    return "~" + s[len(home):] if s.startswith(home + os.sep) else s


def _dire_une_fois(msg: str) -> None:
    if msg not in _mem["dit"]:
        _mem["dit"].add(msg)
        print(f"alertes : {msg}", flush=True)


def reglage() -> tuple[dict | None, str | None]:
    """(le réglage, pourquoi pas) : {token, chat_id, chat_nom, actif}, ou None et la raison
    (« pas posé », un fichier lisible par d'autres, illisible, un jeton mal formé)."""
    p = _cfg()["fichier"]
    try:
        st = p.stat()
    except FileNotFoundError:
        return None, "pas posé"
    except OSError as e:
        return None, f"{_court(p)} illisible ({e.strerror})"
    if stat.S_IMODE(st.st_mode) & 0o077:
        why = f"{_court(p)} est lisible par d'autres : chmod 600 {_court(p)} (réglage refusé)"
        _dire_une_fois(why)
        return None, why
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, f"{_court(p)} illisible (pas du JSON)"
    if not isinstance(d, dict):
        return None, f"{_court(p)} illisible (un objet JSON attendu)"
    tok = str(d.get("token") or "").strip()
    if not tok:
        return None, "pas posé"
    if not TOKEN_RX.fullmatch(tok):
        return None, "le jeton est mal formé (« 123456:ABC… », tel que @BotFather le donne)"
    chat = str(d.get("chat_id") or "").strip()
    return {"token": tok, "chat_id": chat if CHAT_RX.fullmatch(chat) else None,
            "chat_nom": str(d.get("chat_nom") or "")[:80] or None, "actif": d.get("actif", True) is not False}, None


def _jeton() -> str | None:
    try:
        r, _ = reglage()
    except Exception:   # noqa: BLE001 — nettoyer un message ne doit jamais tomber
        return None
    return r["token"] if r else None


def _propre(msg, token: str | None = None) -> str:
    """Un message sans le jeton : ni celui du réglage, ni rien qui en ait la forme."""
    s = str(msg or "")
    for t in (token, _jeton()):
        if t:
            s = s.replace(t, "<jeton>")
    return _SALE.sub("<jeton>", s)[:300]


def _ecrire(patch: dict) -> None:
    """Le fichier de réglage, écrit d'un bloc en 600 (son dossier en 700) ; `None` efface une clé."""
    p = _cfg()["fichier"]
    cur: dict = {}
    try:
        if not stat.S_IMODE(p.stat().st_mode) & 0o077:   # un fichier lisible par d'autres n'est pas relu : remplacé
            cur = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cur = {}
    if not isinstance(cur, dict):
        cur = {}
    new = {k: v for k, v in {**cur, **patch}.items() if v is not None}
    p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.fchmod(fd, 0o600)
        os.write(fd, (json.dumps(new, ensure_ascii=False, indent=1) + "\n").encode())
    finally:
        os.close(fd)
    os.replace(tmp, p)
    _mem["dit"].clear()


def poser_jeton(token, by: str) -> str:
    """Le jeton de @BotFather (Admin → Alertes, ou `showrunner.py --telegram`) : écrit en 600. Un
    autre bot que celui d'avant : son chat est à retrouver (« Trouver mon chat »). Rend le chemin
    du fichier (jamais le jeton)."""
    tok = str(token or "").strip()
    if not TOKEN_RX.fullmatch(tok):
        raise HttpError(400, "ce n'est pas un jeton de bot : il a la forme « 123456:ABC-DEF… », tel que @BotFather le donne")
    old = _jeton()
    patch: dict = {"token": tok, "actif": True}
    if old != tok:
        patch.update(chat_id=None, chat_nom=None)
        _maj(lambda d: d.update(offset=0, bot=None, bot_erreur=None, cherche=None))
    _ecrire(patch)
    auth.journal("alertes : jeton posé", by=by, neuf=old != tok)
    return _court(_cfg()["fichier"])


def regler_actif(actif: bool, by: str) -> None:
    r, why = reglage()
    if not r:
        raise HttpError(409, f"rien à {'rallumer' if actif else 'couper'} : le jeton n'est {why or 'pas posé'}")
    _ecrire({"actif": bool(actif)})
    auth.journal("alertes : rallumées" if actif else "alertes : coupées", by=by)
    if actif:
        assurer()
    else:
        t = _fil(ECOUTE)
        if t:
            t.stop.set()


def _pret() -> dict | None:
    """Le réglage s'il peut envoyer : un jeton, actif, un chat."""
    r, _ = reglage()
    return r if r and r["actif"] and r["chat_id"] else None


# ── l'état sur le disque (<data_dir>/alertes.json) ──────────
def _etat_fichier() -> Path:
    return config.data_dir() / "alertes.json"


def _lire() -> dict:
    f = _etat_fichier()
    try:
        st = f.stat()
        stamp = (str(f), st.st_mtime_ns, st.st_size)
    except OSError:
        stamp = (str(f), 0, 0)
    if _mem["etat"] is None or _mem["stamp"] != stamp:
        d: dict = {}
        if stamp[1]:
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                d = {}
        if not isinstance(d, dict):
            d = {}
        if not isinstance(d.get("decisions"), dict):
            d["decisions"] = {}
        _mem.update(etat=d, stamp=stamp)
    return _mem["etat"]


def _maj(fn):
    """Lire, changer, écrire l'état d'un bloc ; rend ce que rend `fn`."""
    with _lock:
        d = _lire()
        out = fn(d)
        f = _etat_fichier()
        tmp = f.with_name(f.name + ".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(f)
        st = f.stat()
        _mem["stamp"] = (str(f), st.st_mtime_ns, st.st_size)
        return out


def _etat() -> dict:
    with _lock:
        return json.loads(json.dumps(_lire()))


# ── l'API de Telegram ───────────────────────────────────────
class Refus(Exception):
    def __init__(self, msg: str, code: int = 0):
        super().__init__(msg)
        self.code = code


def _api(token: str, method: str, payload: dict, timeout: float):
    """Un appel à l'API de bot ; rend `result`, ou lève Refus (le message sans le jeton)."""
    url = f"{_cfg()['url']}/bot{token}/{method}"
    data = json.dumps(payload, ensure_ascii=False).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            doc = json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            doc = json.loads(e.read() or b"{}")
        except ValueError:
            doc = {}
        raise Refus(_propre(f"Telegram {e.code} : {doc.get('description') or e.reason}", token), e.code) from None
    except (OSError, ValueError) as e:   # injoignable, trop long, une réponse qui n'est pas du JSON
        raise Refus(_propre(f"Telegram injoignable ({getattr(e, 'reason', None) or e})", token)) from None
    if not isinstance(doc, dict) or not doc.get("ok"):
        d = doc if isinstance(doc, dict) else {}
        raise Refus(_propre(f"Telegram {d.get('error_code') or '?'} : {d.get('description') or 'réponse refusée'}", token),
                    int(d.get("error_code") or 0))
    return doc.get("result")


# ── les fils ────────────────────────────────────────────────
def _fil(nom: str):
    """Le fil vivant de ce nom (un seul : même un module rechargé le retrouve), ou None."""
    return next((t for t in threading.enumerate() if t.name == nom and t.is_alive()), None)


_flock = threading.Lock()


def _envoi():
    """Le fil des envois, démarré à la première alerte ; rend sa file."""
    with _flock:
        t = _fil(ENVOI)
        if t is not None:
            t.stop.clear()   # un fil qui s'arrêtait reprend : jamais un second
            return t.q
        t = threading.Thread(target=_boucle_envoi, name=ENVOI, daemon=True)
        t.q, t.stop = queue.Queue(maxsize=FILE_MAX), threading.Event()
        t.start()
        return t.q


def assurer() -> None:
    """L'écoute tourne si un jeton est posé et actif (idempotent : au démarrage, à chaque lecture de la
    carte Alertes, après un réglage). Un fil qui s'arrêtait reprend ; jamais un second."""
    r, _ = reglage()
    if not r or not r["actif"]:
        return
    with _flock:
        t = _fil(ECOUTE)
        if t is not None:
            t.stop.clear()
            return
        t = threading.Thread(target=_boucle_ecoute, name=ECOUTE, daemon=True)
        t.stop = threading.Event()
        t.start()


def arreter(attendre: float = 0.0) -> None:
    """Arrête les deux fils (proprement : l'écoute finit son appel en cours, au plus POLL_S)."""
    for nom in (ECOUTE, ENVOI):
        t = _fil(nom)
        if t is None:
            continue
        t.stop.set()
        if nom == ENVOI:
            try:
                t.q.put_nowait(None)
            except queue.Full:
                pass
        if attendre:
            t.join(attendre)


def _ranger(item: dict) -> None:
    try:
        _envoi().put_nowait(item)
    except queue.Full:
        _non_envoyee(item.get("quoi", "alerte"), f"la file des alertes est pleine ({FILE_MAX})")


def _non_envoyee(quoi: str, why) -> None:
    why = _propre(why)
    print(f"alertes : alerte non envoyée : {quoi} — {why}", flush=True)
    auth.journal("alerte non envoyée", quoi=quoi, why=why)
    _maj(lambda d: d.update(dernier={"t": auth.now_iso(), "ok": False, "quoi": quoi, "erreur": why}))


def _boucle_envoi() -> None:
    me = threading.current_thread()
    report: list = []
    while not me.stop.is_set():
        if report:
            item = report.pop(0)
        else:
            try:
                item = me.q.get(timeout=1)
            except queue.Empty:
                continue
        if item is None:
            continue
        try:
            if item.get("groupe"):
                c = _cfg()
                lot, debut, fin = [item], time.time(), time.time() + c["groupe_s"]
                while not me.stop.is_set():
                    reste = min(fin, debut + c["groupe_max"]) - time.time()
                    if reste <= 0:
                        break
                    try:
                        x = me.q.get(timeout=reste)
                    except queue.Empty:
                        break
                    if x and x.get("groupe") == item["groupe"]:
                        lot.append(x)
                        fin = time.time() + c["groupe_s"]   # tant qu'il en arrive, on attend encore
                    elif x:
                        report.append(x)
                for i in range(0, len(lot), LIGNES_MAX):
                    _envoyer(lot[i:i + LIGNES_MAX])
            elif item.get("api"):
                _appel(item)
            else:
                _envoyer([item])
        except Exception as e:   # noqa: BLE001 — une alerte qui casse ne casse ni le fil ni le portail
            _non_envoyee(item.get("quoi", "alerte"), f"{type(e).__name__} : {e}")


def _appel(item: dict) -> None:
    """Un appel simple (modifier un message, répondre) : un échec se dit dans le journal du serveur."""
    r, why = reglage()
    if not r:
        print(f"alertes : {item.get('quoi', item['api'])} : pas fait ({why})", flush=True)
        return
    try:
        _api(r["token"], item["api"], item["p"], _cfg()["envoi_s"])
    except Refus as e:
        print(f"alertes : {item.get('quoi', item['api'])} : pas fait ({e})", flush=True)


# ── les messages et les décisions ───────────────────────────
def _vivant(kind: str, uid: str, stamp) -> bool:
    """La demande que nomme une décision attend-elle encore ? (un compte : toujours en attente, et le
    même — sa date de création ; une demande de Studio : la même date, le Studio toujours fermé)."""
    u = auth.user(uid)
    if not u:
        return False
    if kind == "compte":
        return u.get("state") == "pending" and u.get("created") == stamp
    if kind == "studio":
        return u.get("state") == "active" and u.get("studio_request") == stamp and not auth.has_studio(u)
    return False


def _texte(dec: dict) -> str:
    n = len(dec["lignes"])
    titre = dec.get("titre_pl") if n > 1 and dec.get("titre_pl") else dec["titre"]
    out = [f"SHOWRUNNER · {titre}"]
    if dec.get("entete"):
        out.append(dec["entete"])
    for _uid, ligne, verdict in dec["lignes"]:
        out.append(f"· {ligne}" + (f" — {verdict}" if verdict else ""))
    pied = dec.get("pied_pl") if n > 1 and dec.get("pied_pl") else dec.get("pied")
    if pied and dec.get("items"):
        out.append(pied)
    return "\n".join(out)[:4000]


BOUTONS = {"compte": ("Valider", "Refuser"), "studio": ("Ouvrir le Studio", "Écarter")}


def _clavier(dec: dict) -> dict:
    oui, non = BOUTONS[dec["kind"]]
    n = len(dec["items"])
    suffixe = f" ({n})" if n > 1 else ""
    return {"inline_keyboard": [[{"text": oui + suffixe, "callback_data": f"v:{dec['id']}"},
                                 {"text": non + suffixe, "callback_data": f"r:{dec['id']}"}]]}


def _envoyer(lot: list[dict]) -> None:
    """Un message pour un lot d'alertes de même sorte ; avec ses boutons, une décision neuve."""
    first = lot[0]
    quoi = first.get("quoi", "alerte")
    r = _pret()
    if not r:
        _, why = reglage()
        return _non_envoyee(quoi, f"Telegram n'est plus réglé ({why or 'pas de chat, ou coupé'})")
    kind = first.get("kind")
    lignes, items = [], []
    for x in lot:
        if kind and not _vivant(kind, *x["item"]):
            continue   # tranchée entre-temps (Admin) : plus rien à demander
        lignes.append([x["item"][0] if kind else None, x["ligne"], None])
        if kind:
            items.append(list(x["item"]))
    if not lignes:
        return
    dec = {k: first.get(k) for k in ("titre", "titre_pl", "entete", "pied", "pied_pl")}
    dec.update(kind=kind, items=items, lignes=lignes, chat=r["chat_id"], msgs=[], at=time.time(), quoi=quoi)
    if kind:
        dec["id"] = secrets.token_urlsafe(9)

        def ajoute(d):
            now = time.time()
            for k in [k for k, x in d["decisions"].items() if now - float(x.get("at") or 0) > DECISION_JOURS * 86400]:
                d["decisions"].pop(k)
            d["decisions"][dec["id"]] = dec
        _maj(ajoute)
    payload = {"chat_id": r["chat_id"], "text": _texte(dec)}
    if kind:
        payload["reply_markup"] = _clavier(dec)
    try:
        res = _api(r["token"], "sendMessage", payload, _cfg()["envoi_s"])
    except Refus as e:
        if kind:
            _maj(lambda d: d["decisions"].pop(dec["id"], None))
        return _non_envoyee(quoi, e)
    mid = (res or {}).get("message_id")

    def fini(d):
        if kind and mid and dec["id"] in d["decisions"]:
            d["decisions"][dec["id"]]["msgs"].append(mid)
        d["dernier"] = {"t": auth.now_iso(), "ok": True, "quoi": quoi + (f" ({len(lignes)})" if len(lignes) > 1 else "")}
    _maj(fini)


def _sur(fn):
    """Une alerte ne fait jamais tomber ce qui la déclenche."""
    @functools.wraps(fn)
    def w(*a, **kw):
        try:
            return fn(*a, **kw)
        except Exception as e:   # noqa: BLE001
            print(f"alertes : {fn.__name__} : {type(e).__name__} : {_propre(e)}", flush=True)
            return None
    return w


def _nom(uid) -> str:
    return auth.display_name(uid) or str(uid or "?")


def _role_fr(role: str, guest=None, spaces=None) -> str:
    from . import espaces
    s = espaces.TEAM_FR.get(role, role or "?")
    if role == "guest":
        s += f" {guest or 'viewer'}"
        noms = [(espaces.space(x) or {}).get("name") for x in spaces or []]
        if any(noms):
            s += " · " + ", ".join(n for n in noms if n)
    return s


def _team_nom(tid) -> str:
    from . import espaces
    return (espaces.team(tid) or {}).get("name") or str(tid)


@_sur
def invite_en_attente(uid: str, by: str, team: str, role: str, guest=None, spaces=None) -> None:
    """D5 : un pseudo neuf mis dans une Team par un non-Cal attend sa validation."""
    if not _pret():
        return
    u = auth.user(uid)
    if not u or u.get("state") != "pending":
        return
    _ranger({"quoi": "invité à valider", "kind": "compte", "item": [uid, u.get("created")], "groupe": f"invite:{by}:{team}",
             "titre": "invité à valider", "titre_pl": "invités à valider",
             "entete": f"« {_nom(by)} » invite dans la Team « {_team_nom(team)} » :",
             "ligne": f"« {u.get('name')} » — {_role_fr(role, guest, spaces)}",
             "pied": "Il n'entre qu'après ta validation (ici, ou Admin → Demandes).",
             "pied_pl": "Ils n'entrent qu'après ta validation (ici, ou Admin → Demandes)."})


@_sur
def ajoute_par_team(uid: str, by: str, team: str, role: str, guest=None, spaces=None) -> None:
    """Un compte déjà accepté, mis dans une Team par un non-Cal : il y entre ; Cal le sait."""
    if not _pret():
        return
    _ranger({"quoi": "mis dans une Team (pour info)", "groupe": f"info:{by}:{team}",
             "titre": "pour info", "entete": f"« {_nom(by)} » a mis dans la Team « {_team_nom(team)} » :",
             "ligne": f"« {_nom(uid)} » — {_role_fr(role, guest, spaces)}",
             "pied": "Compte déjà accepté une fois : il y entre directement.",
             "pied_pl": "Comptes déjà acceptés une fois : ils y entrent directement."})


@_sur
def demande_porte(u: dict) -> None:
    """Un pseudo neuf tapé à la porte."""
    if not _pret() or not u or u.get("state") != "pending":
        return
    where = {"code": "l'adresse publique", "demo": "le tunnel de démo"}.get(u.get("via"), "la maison")
    _ranger({"quoi": "demande à la porte", "kind": "compte", "item": [u["id"], u.get("created")],
             "titre": "demande à la porte", "ligne": f"« {u.get('name')} » — a tapé son pseudo ({where})",
             "pied": "Accepté, il entre ; refusé, son pseudo redevient libre."})


@_sur
def demande_studio(u: dict) -> None:
    """Un compte Apps demande le Studio."""
    if not _pret() or not u:
        return
    x = auth.user(u.get("id"))
    if not x or not x.get("studio_request"):
        return
    _ranger({"quoi": "demande de Studio", "kind": "studio", "item": [x["id"], x["studio_request"]],
             "titre": "demande de Studio", "ligne": f"« {x.get('name')} » — compte Apps, demande le Studio",
             "pied": "Ouvert, il a le Studio ; écartée, la demande disparaît (il peut redemander)."})


@_sur
def clore(kind: str, uid: str, verdict: str) -> None:
    """Une demande tranchée (Admin, un bouton, la personne qui annule, le lien d'une Team) : les décisions
    qui la nomment l'oublient ; leurs messages disent le verdict sur sa ligne, et perdent leurs boutons
    quand il n'y reste rien à trancher."""
    if not _etat_fichier().exists():
        return
    edits: list = []

    def fn(d):
        for did, dec in list(d["decisions"].items()):
            if dec.get("kind") != kind or not any(i[0] == uid for i in dec.get("items") or []):
                continue
            dec["items"] = [i for i in dec["items"] if i[0] != uid]
            for ligne in dec["lignes"]:
                if ligne[0] == uid and not ligne[2]:
                    ligne[2] = verdict
            if not dec["items"]:
                d["decisions"].pop(did)
            edits.append(json.loads(json.dumps(dec)))
    _maj(fn)
    for dec in edits:
        for mid in dec.get("msgs") or []:
            p = {"chat_id": dec["chat"], "message_id": mid, "text": _texte(dec)}
            if dec["items"]:
                p["reply_markup"] = _clavier(dec)
            _ranger({"api": "editMessageText", "p": p, "quoi": "le message d'une demande tranchée"})


# ── l'écoute : les boutons, le chat de Cal ──────────────────
def _boucle_ecoute() -> None:
    me = threading.current_thread()
    pause = 0.0
    while not me.stop.is_set():
        r, _ = reglage()
        if not r or not r["actif"]:
            break   # coupé, ou le jeton retiré : assurer() le relancera
        c = _cfg()
        try:
            _bot(r)
            ups = _api(r["token"], "getUpdates", {"offset": int(_lire().get("offset") or 0), "timeout": c["poll_s"],
                                                   "allowed_updates": ["message", "callback_query"]}, c["poll_s"] + 15)
        except Refus as e:
            why = str(e)
            if e.code == 401:
                why = "jeton refusé par Telegram (401) : recolle-le depuis @BotFather"
            elif e.code == 409:
                why = "un autre programme lit déjà ce bot (409) : un seul portail par bot"
            _maj(lambda d: d.update(ecoute={"t": auth.now_iso(), "ok": False, "erreur": why}))
            _dire_une_fois(f"écoute : {why}")
            pause = min(60.0, max(5.0, pause * 2))
            me.stop.wait(pause)
            continue
        pause = 0.0
        _mem["dit"] = {x for x in _mem["dit"] if not x.startswith("écoute :")}
        last = None
        for up in ups or []:
            last = max(last or 0, int(up.get("update_id") or 0))
            try:
                if up.get("callback_query"):
                    _clic(r, up["callback_query"])
                elif up.get("message"):
                    _message(r, up["message"])
            except Exception as e:   # noqa: BLE001 — un clic qui casse ne coupe pas l'écoute
                print(f"alertes : écoute : {type(e).__name__} : {_propre(e)}", flush=True)

        def note(d):
            d["ecoute"] = {"t": auth.now_iso(), "ok": True}
            if last is not None:
                d["offset"] = last + 1   # la doc : un appel avec un offset plus grand confirme les précédents
        _maj(note)


def _bot(r: dict) -> None:
    """getMe une fois par jeton : le nom du bot (le lien t.me de « Trouver mon chat »)."""
    bot_id = r["token"].split(":", 1)[0]
    b = _lire().get("bot") or {}
    if str(b.get("id")) == bot_id:
        return
    me = _api(r["token"], "getMe", {}, _cfg()["envoi_s"])
    _maj(lambda d: d.update(bot={"id": (me or {}).get("id"), "username": (me or {}).get("username"),
                                 "nom": (me or {}).get("first_name")}))


def _repondre(r: dict, cq_id: str, texte: str) -> None:
    try:
        _api(r["token"], "answerCallbackQuery", {"callback_query_id": cq_id, "text": texte[:200]}, _cfg()["envoi_s"])
    except Refus as e:
        print(f"alertes : réponse au clic : {e}", flush=True)


def _clic(r: dict, cq: dict) -> None:
    """Un bouton pressé. Du seul chat réglé ; la décision qu'il nomme, prise une fois (retirée d'abord :
    un second clic, ou un autre message, n'y trouve plus rien) ; la même fonction qu'Admin."""
    msg = cq.get("message") or {}
    chat = str((msg.get("chat") or {}).get("id") or "")
    if not r.get("chat_id") or chat != r["chat_id"]:
        auth.journal("alertes : clic d'un autre chat, ignoré")
        return
    mm = DID_RX.fullmatch(str(cq.get("data") or ""))
    dec = _maj(lambda d: d["decisions"].pop(mm.group(2), None)) if mm else None
    if not dec:
        _repondre(r, cq.get("id", ""), "déjà traité")
        texte = str(msg.get("text") or "SHOWRUNNER")
        if msg.get("message_id") and not VERDICT_RX.search(texte):   # un message qui dit déjà son verdict reste tel quel
            _ranger({"api": "editMessageText", "quoi": "un message déjà traité",
                     "p": {"chat_id": chat, "message_id": msg["message_id"], "text": (texte + "\n— déjà traité")[:4000]}})
        return
    oui, by = mm.group(1) == "v", auth.admin_id()
    kind = dec["kind"]
    if kind == "studio":
        dit = ("Studio ouvert par Cal", "demande écartée par Cal")[0 if oui else 1]
    else:
        dit = ("validé par Cal", "refusé par Cal")[0 if oui else 1]
    faits = deja = 0
    for uid, stamp in dec["items"]:
        verdict = "déjà traité"
        if _vivant(kind, uid, stamp):
            try:
                if kind == "compte":
                    auth.accept_request(uid, by) if oui else auth.refuse(uid, by)
                else:
                    auth.set_user(uid, {"access": "studio"} if oui else {"studio_request": None}, by)
                verdict, faits = dit, faits + 1
            except HttpError as e:
                verdict = f"pas fait : {e.message}"[:120]
        if verdict == "déjà traité":
            deja += 1
        for ligne in dec["lignes"]:
            if ligne[0] == uid and not ligne[2]:
                ligne[2] = verdict
    dec["items"] = []
    auth.journal("alertes : décision", by=by, via="telegram", oui=oui, kind=kind, faits=faits, deja=deja)
    _repondre(r, cq.get("id", ""), dit if faits and not deja else "déjà traité" if not faits else f"{faits} · {deja} déjà traité")
    for mid in dec.get("msgs") or [msg.get("message_id")]:
        if mid:
            _ranger({"api": "editMessageText", "quoi": "le message d'une décision",
                     "p": {"chat_id": dec["chat"], "message_id": mid, "text": _texte(dec)}})


def _message(r: dict, m: dict) -> None:
    """« /start <code> » depuis un chat privé, pendant « Trouver mon chat » : ce chat devient celui
    de Cal. Rien d'autre n'est lu ; un inconnu qui écrit au bot n'obtient rien."""
    st = _lire()
    ch = st.get("cherche") or {}
    chat = m.get("chat") or {}
    if not ch or float(ch.get("exp") or 0) < time.time() or chat.get("type") != "private":
        return
    mm = START_RX.fullmatch(str(m.get("text") or "").strip())
    if not mm:
        return
    code = (mm.group(1) or "").upper()
    if not secrets.compare_digest(code.encode(), str(ch.get("code") or "").encode()):
        _ranger({"api": "sendMessage", "quoi": "la marche à suivre",
                 "p": {"chat_id": chat.get("id"), "text": "Pour relier ce chat au portail Showrunner, envoie le code "
                                                          "affiché dans Admin → Demandes → Alertes : /start <code>"}})
        return
    nom = " ".join(x for x in (chat.get("first_name"), chat.get("last_name")) if x) or "ce chat"
    if chat.get("username"):
        nom += f" (@{chat['username']})"
    _ecrire({"chat_id": str(chat.get("id")), "chat_nom": nom[:80]})
    _maj(lambda d: d.update(cherche=None))
    auth.journal("alertes : chat trouvé")
    _ranger({"api": "sendMessage", "quoi": "le chat trouvé",
             "p": {"chat_id": chat.get("id"), "text": "C'est noté : les alertes du portail Showrunner arriveront ici "
                                                     "(invités à valider, demandes à la porte, demandes de Studio)."}})


# ── la carte Alertes (Admin → Demandes ; server/tools/alertes.py) ──
def etat() -> dict:
    """Ce que montre la carte : posé ou non (jamais le jeton), le chat, le bot, l'écoute, le dernier envoi."""
    assurer()
    r, why = reglage()
    st = _etat()
    bot = st.get("bot") or {}
    if r and str(bot.get("id")) != r["token"].split(":", 1)[0]:
        bot = {}
    ch = st.get("cherche") or {}
    cherche = None
    if r and ch and float(ch.get("exp") or 0) > time.time():
        cherche = {"code": ch["code"], "exp": ch["exp"],
                   "lien": f"https://t.me/{bot['username']}?start={ch['code']}" if bot.get("username") else None}
    c = _cfg()
    return {"pose": bool(r), "why": None if r else why, "actif": bool(r and r["actif"]),
            "chat": bool(r and r["chat_id"]), "chat_nom": r["chat_nom"] if r and r["chat_id"] else None,
            "bot": f"@{bot['username']}" if bot.get("username") else None, "ecoute": bool(_fil(ECOUTE)),
            "ecoute_etat": st.get("ecoute") if r else None, "dernier": st.get("dernier"), "cherche": cherche,
            "attente": len(st.get("decisions") or {}), "fichier": _court(c["fichier"]), "commande": COMMANDE,
            "essai": c["url"] != URL}


def chercher(by: str) -> dict:
    """« Trouver mon chat » : un code à envoyer au bot (/start <code>) ; l'écoute relie le chat qui l'envoie."""
    r, why = reglage()
    if not r:
        raise HttpError(409, f"pose d'abord le jeton du bot (il n'est {why or 'pas posé'})")
    if not r["actif"]:
        raise HttpError(409, "les alertes sont coupées : rallume-les d'abord")
    code = "".join(secrets.choice(CODE_ABC) for _ in range(6))
    _maj(lambda d: d.update(cherche={"code": code, "exp": time.time() + CHERCHE_S}))
    auth.journal("alertes : chercher le chat", by=by)
    assurer()
    return etat()


def essai(by: str) -> dict:
    """« Envoyer un essai » : un message, par la même file que les alertes."""
    r, why = reglage()
    if not r:
        raise HttpError(409, f"pose d'abord le jeton du bot (il n'est {why or 'pas posé'})")
    if not r["chat_id"]:
        raise HttpError(409, "trouve d'abord ton chat : « Trouver mon chat », puis envoie le code à ton bot")
    if not r["actif"]:
        raise HttpError(409, "les alertes sont coupées : rallume-les d'abord")
    _ranger({"quoi": "essai", "titre": "essai", "ligne": "les alertes du portail arrivent ici",
             "pied": f"Envoyé depuis Admin par {_nom(by)}."})
    auth.journal("alertes : essai", by=by)
    return etat()
