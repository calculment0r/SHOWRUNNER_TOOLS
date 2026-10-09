"""Les alertes de Cal : la carte « Alertes » d'Admin → Demandes (le socle : core/alertes.py).

Cal seul (sous /api/admin/ : la porte du socle les refuse à qui n'est pas admin, et chaque
route le revérifie). Le jeton n'est jamais rendu : « posé » ou « pas posé ».

    GET  /api/admin/alertes                 l'état : posé, actif, le chat (trouvé ou non), le bot, l'écoute,
                                            le dernier envoi et son résultat, la commande à taper sur DGX2
    POST /api/admin/alertes/jeton {token}   le jeton de @BotFather, écrit en 600 dans ~/.config/showrunner/telegram.json
    POST /api/admin/alertes/chercher        « Trouver mon chat » : un code à envoyer au bot (/start <code>)
    POST /api/admin/alertes/essai           « Envoyer un essai »
    POST /api/admin/alertes/actif {actif}   « Couper » (false) ou « Rallumer » (true) ; le jeton reste posé

La même chose sans page : `python3 server/showrunner.py --telegram` sur DGX2 (le jeton tapé sans écho).
"""

from __future__ import annotations

from core import alertes, auth
from core.http import HttpError


def _admin(req) -> dict:
    u = getattr(req, "user", None)
    if not auth.is_admin(u):
        raise HttpError(403, "réservé à Cal")
    return u


def r_etat(req):
    _admin(req)
    return alertes.etat()


def r_jeton(req):
    me = _admin(req)
    alertes.poser_jeton(req.json().get("token"), by=me["id"])
    alertes.assurer()
    return alertes.etat()


def r_chercher(req):
    return alertes.chercher(_admin(req)["id"])


def r_essai(req):
    return alertes.essai(_admin(req)["id"])


def r_actif(req):
    me = _admin(req)
    d = req.json()
    if not isinstance(d.get("actif"), bool):
        raise HttpError(400, "actif : true (rallumer) ou false (couper)")
    alertes.regler_actif(d["actif"], by=me["id"])
    return alertes.etat()


def register(app) -> None:
    app.route("GET", "/api/admin/alertes", r_etat)
    app.route("POST", "/api/admin/alertes/jeton", r_jeton)
    app.route("POST", "/api/admin/alertes/chercher", r_chercher)
    app.route("POST", "/api/admin/alertes/essai", r_essai)
    app.route("POST", "/api/admin/alertes/actif", r_actif)
    app.on_start(alertes.assurer)   # l'écoute des boutons, si un jeton est posé (sinon rien)


# ── le contrôle (tools/check.py) : contre le faux Telegram (tools/faux_telegram.py) ──
def _faux():
    import importlib.util

    from core import config
    spec = importlib.util.spec_from_file_location("faux_telegram", config.REPO / "tools" / "faux_telegram.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def selftest(call, ok) -> None:
    import shutil
    import tempfile
    import threading
    from pathlib import Path

    from core import config
    from tools.admin import essai_http as H

    F = _faux()
    f = F.Faux(max_attente=0.4)
    f.start()
    tmp = Path(tempfile.mkdtemp(prefix="sr_alertes_"))
    fichier = tmp / "config" / "showrunner" / "telegram.json"
    before = {k: config.CFG.get(k) for k in ("auth", "alertes")}
    config.CFG["auth"] = True
    config.CFG["alertes"] = {"fichier": str(fichier), "url": f.url, "poll_s": 1, "envoi_s": 2, "groupe_s": 0.4}
    auth.startup()
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    real_ip = auth._ip
    seen: list = []   # chaque réponse : le jeton n'y est jamais
    try:
        _essais(ok, H, same, f, fichier, seen)
    finally:
        auth._ip = real_ip
        alertes.arreter(attendre=3)
        f.close()
        for k, v in before.items():
            if v is None:
                config.CFG.pop(k, None)
            else:
                config.CFG[k] = v
        shutil.rmtree(tmp, ignore_errors=True)
        auth.set_current(None)
        auth.set_current_space(None)
    tok = F.JETON
    ok(not any(tok in str(x) for x in seen), f"alertes : le jeton n'apparaît dans aucune réponse ({len(seen)} lues)")
    leaks = []
    for p in config.data_dir().iterdir():
        if p.is_file() and p.suffix in (".json", ".jsonl") and tok in p.read_text(encoding="utf-8", errors="replace"):
            leaks.append(p.name)
    ok(not leaks, f"alertes : le jeton n'est dans aucun fichier des données (journal, alertes.json, auth.json…) ({leaks})")
    ok(not [t for t in threading.enumerate() if t.name in (alertes.ECOUTE, alertes.ENVOI) and t.is_alive()],
       "alertes : arrêtées, les deux fils finissent proprement")


def _essais(ok, H, same, f, fichier, seen) -> None:
    import importlib.util
    import itertools
    import os
    import stat
    import threading
    import time

    from core import config, espaces

    err = lambda d: d.get("error", "") if isinstance(d, dict) else str(d)[:80]   # noqa: E731
    ips = itertools.count(10)

    def entrer(name: str):
        """Taper un pseudo à la porte, d'une adresse à lui : les limites des autres essais ne comptent pas."""
        a, real = f"198.51.100.{next(ips)}", auth._ip
        auth._ip = lambda req: a
        try:
            return H2("POST", "/api/auth/enter", {"name": name}, headers=same)
        finally:
            auth._ip = real

    def H2(*a, **kw):
        r = H(*a, **kw)
        seen.append(r[1])
        return r
    _, _, cal = H2("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
    P = lambda path, body=None, tok=cal: H2("POST", path, body if body is not None else {}, cookie=tok, headers=same)   # noqa: E731
    G = lambda path, tok=cal: H2("GET", path, cookie=tok)   # noqa: E731

    def etat():
        return G("/api/admin/alertes")[1]

    def attendre(cond, t=6.0) -> bool:
        return f.attendre(cond, t)

    def msg_de(*mots):
        return next((m for m in reversed(f.messages) if all(w in m["text"] for w in mots)), None)

    # 0. rien de posé : la carte le dit ; un ami n'y a pas accès
    s, e, _ = G("/api/admin/alertes")
    ok(s == 200 and e.get("pose") is False and e.get("why") == "pas posé" and e.get("ecoute") is False,
       f"alertes : rien de posé, la carte le dit ({s} {e.get('why')})")
    H2("POST", "/api/admin/users", {"name": "Ami Alerte", "access": "studio"}, cookie=cal, headers=same)
    _, _, ami = entrer("Ami Alerte")
    s, _, _ = G("/api/admin/alertes", ami)
    s2, _, _ = P("/api/admin/alertes/jeton", {"token": f.token}, ami)
    ok(s == 403 and s2 == 403, f"alertes : la carte est à Cal seul ({s}, {s2})")
    s, d, _ = P("/api/admin/alertes/essai")
    ok(s == 409 and "jeton" in err(d), f"alertes : un essai sans jeton dit quoi faire ({s} {err(d)})")

    # 1. le jeton : écrit en 600 (son dossier en 700) ; un jeton mal formé est refusé ; jamais rendu
    s, d, _ = P("/api/admin/alertes/jeton", {"token": "pas-un-jeton"})
    ok(s == 400 and "BotFather" in err(d), f"alertes : un jeton mal formé est refusé ({s} {err(d)[:60]})")
    s, e, _ = P("/api/admin/alertes/jeton", {"token": f.token})
    mode = stat.S_IMODE(fichier.stat().st_mode) if fichier.exists() else None
    dmode = stat.S_IMODE(fichier.parent.stat().st_mode) if fichier.exists() else None
    ok(s == 200 and e.get("pose") is True and e.get("chat") is False and mode == 0o600 and dmode == 0o700,
       f"alertes : le jeton posé, le fichier en 600, son dossier en 700 ({s} {oct(mode or 0)} {oct(dmode or 0)})")
    ok(attendre(lambda: (etat() or {}).get("bot") == f"@{f.bot}"), f"alertes : l'écoute démarre et connaît le bot ({etat().get('bot')})")

    # 2. un fichier lisible par d'autres : refusé, comme la clé de la porte
    os.chmod(fichier, 0o644)
    e = etat()
    ok(e.get("pose") is False and "lisible par d'autres" in (e.get("why") or "") and "chmod 600" in (e.get("why") or ""),
       f"alertes : un fichier lisible par d'autres est refusé ({e.get('why')})")
    s, d, _ = P("/api/admin/alertes/chercher")
    ok(s == 409, f"alertes : … et rien ne part ({s})")
    os.chmod(fichier, 0o600)
    ok(etat().get("pose") is True, "alertes : remis en 600, il revaut")

    # 3. « Trouver mon chat » : un code ; un inconnu qui écrit au bot n'obtient rien ; le bon code relie le chat
    s, e, _ = P("/api/admin/alertes/chercher")
    code = ((e.get("cherche") or {}).get("code")) or ""
    ok(s == 200 and len(code) == 6 and (e["cherche"].get("lien") or "").endswith(f"t.me/{f.bot}?start={code}"),
       f"alertes : « Trouver mon chat » donne un code et le lien du bot ({s} {e.get('cherche')})")
    f.ecrit("/start", chat_id=999, prenom="Inconnu", username="inconnu")
    f.ecrit("/start AAAAAA", chat_id=999, prenom="Inconnu", username="inconnu")
    ok(attendre(lambda: sum(1 for m in f.messages if m["chat_id"] == 999) >= 2) and not etat().get("chat"),
       "alertes : un inconnu (sans le code, ou un faux) reçoit la marche à suivre, pas le portail")
    f.ecrit(f"/start {code.lower()}")
    ok(attendre(lambda: etat().get("chat") is True), "alertes : le bon code relie le chat de Cal")
    e = etat()
    ok(e.get("chat_nom") == "Cal (@cal_essai)" and e.get("cherche") is None and msg_de("C'est noté"),
       f"alertes : le chat nommé, la recherche close, un mot de bienvenue ({e.get('chat_nom')})")

    # 4. « Envoyer un essai »
    s, e, _ = P("/api/admin/alertes/essai")
    ok(s == 200 and attendre(lambda: msg_de("SHOWRUNNER · essai")) and attendre(lambda: (etat().get("dernier") or {}).get("ok") is True),
       f"alertes : l'essai part, le dernier envoi le dit ({s} {etat().get('dernier')})")

    # 5. un admin de Team (pas Cal) invite : l'alerte a ses boutons ; un clic d'un autre chat est ignoré ;
    #    Valider : le compte et sa place ; un second clic : « déjà traité »
    s, t, _ = P("/api/equipes", {"name": "Alerte Essai"})
    tid, sid = t["id"], t["spaces"][0]["id"]
    P("/api/admin/users", {"name": "Ada Alerte", "access": "studio"})
    P(f"/api/equipes/{tid}/membres", {"pseudo": "Ada Alerte", "role": "admin"})
    _, _, ada = entrer("Ada Alerte")
    n0 = len(f.messages)
    t0 = time.time()
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Leo Alerte", "role": "member"}, ada)
    ok(s == 200 and (d.get("added") or {}).get("pending") is True and time.time() - t0 < 1.5,
       f"alertes : Ada (admin de la Team) met un pseudo neuf : il attend Cal ({s} {err(d)} {time.time() - t0:.2f} s)")
    ok(attendre(lambda: msg_de("invité à valider", "« Leo Alerte »")), "alertes : Cal reçoit « invité à valider »")
    m = msg_de("invité à valider", "« Leo Alerte »") or {}
    kb = [b for row in (m.get("reply_markup") or {}).get("inline_keyboard") or [] for b in row]
    ok([b["text"] for b in kb] == ["Valider", "Refuser"] and all(len(b["callback_data"].encode()) <= 64 for b in kb)
       and "Leo" not in "".join(b["callback_data"] for b in kb) and "« Ada Alerte » invite dans la Team « Alerte Essai »" in m.get("text", ""),
       f"alertes : deux boutons, une donnée courte qui ne nomme pas le pseudo ({[b.get('callback_data') for b in kb]})")
    ok(len(f.messages) == n0 + 1, f"alertes : un seul message ({len(f.messages) - n0})")
    a0 = len(f.answers)
    f.clic(kb[0]["callback_data"], chat_id=777)
    time.sleep(1.2)
    ok(auth.user("leo-alerte")["state"] == "pending" and len(f.answers) == a0,
       "alertes : un clic d'un autre chat est ignoré (rien de fait, pas de réponse)")
    f.clic(bouton="Valider", message_id=m.get("message_id"))
    ok(attendre(lambda: (auth.user("leo-alerte") or {}).get("state") == "active"), "alertes : Valider (le chat de Cal) : le compte est actif")
    leo = auth.user("leo-alerte")
    ok(espaces.can_view(leo, sid) and espaces.team_role(leo, tid) == "member" and leo.get("access") == "apps",
       "alertes : … et sa place dans la Team compte (membre, compte Apps : la Team a le Studio)")
    ok(attendre(lambda: any(a["text"] == "validé par Cal" for a in f.answers[a0:])), f"alertes : la réponse au clic ({f.answers[a0:]})")
    ok(attendre(lambda: "validé par Cal" in next((x["text"] for x in f.messages if x["message_id"] == m.get("message_id")), "")
                and not next((x for x in f.messages if x["message_id"] == m.get("message_id")), {}).get("reply_markup")),
       "alertes : le message dit « validé par Cal » et perd ses boutons")
    a1 = len(f.answers)
    f.clic(kb[0]["callback_data"], message_id=m.get("message_id"))
    ok(attendre(lambda: any(a["text"] == "déjà traité" for a in f.answers[a1:])), "alertes : un second clic dit « déjà traité »")

    # Refuser : le compte et sa place disparaissent
    P(f"/api/equipes/{tid}/membres", {"pseudo": "Zoe Alerte", "role": "guest", "guest": "acteur", "spaces": [sid]}, ada)
    ok(attendre(lambda: msg_de("« Zoe Alerte »")), "alertes : un guest invité, annoncé")
    mz = msg_de("« Zoe Alerte »") or {}
    ok("guest acteur" in mz.get("text", ""), f"alertes : le rôle est dit (« {mz.get('text', '')[-60:]} »)")
    f.clic(bouton="Refuser", message_id=mz.get("message_id"))
    ok(attendre(lambda: auth.user("zoe-alerte") is None), "alertes : Refuser : le compte disparaît")
    ok(not espaces.invitations_of("zoe-alerte") and "zoe-alerte" not in (espaces.space(sid) or {}).get("members", {}),
       "alertes : … et sa place dans la Team et le Workspace aussi")

    # un compte existant, actif : il entre ; Cal est seulement informé (sans bouton)
    P("/api/admin/users", {"name": "Noa Alerte", "access": "studio"})
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Noa Alerte", "role": "member"}, ada)
    ok(s == 200 and not (d.get("added") or {}).get("pending") and espaces.can_view(auth.user("noa-alerte"), sid),
       f"alertes : un compte existant entre directement ({s} {err(d)})")
    ok(attendre(lambda: msg_de("pour info", "« Noa Alerte »")), "alertes : l'alerte d'info part")
    ok(not (msg_de("pour info", "« Noa Alerte »") or {}).get("reply_markup"), "alertes : … sans bouton")

    # le lien d'Ada : un pseudo neuf tapé à la porte, puis le lien — l'alerte « invité à valider » ; le lien
    # rouvert (la page rechargée) n'en envoie pas d'autre ; Valider : il entre dans la Team
    s, inv, _ = P(f"/api/equipes/{tid}/invitations", {"role": "member", "hours": 24}, ada)
    _, _, kim = entrer("Kim Alerte")
    ok(attendre(lambda: msg_de("demande à la porte", "« Kim Alerte »")), "alertes : Kim tape son pseudo : « demande à la porte »")
    s, r, _ = H2("POST", f"/api/auth/equipe/{inv.get('token')}", {}, cookie=kim, headers=same)
    ok(s == 200 and r.get("pending") is True and attendre(lambda: msg_de("invité à valider", "« Kim Alerte »")),
       f"alertes : … puis ouvre le lien d'Ada : « invité à valider » ({s} {err(r)})")
    n1 = len(f.messages)
    s, r, _ = H2("POST", f"/api/auth/equipe/{inv.get('token')}", {}, cookie=kim, headers=same)
    time.sleep(0.8)
    ok(s == 200 and r.get("pending") is True and len(f.messages) == n1,
       f"alertes : le lien rouvert n'envoie rien de plus ({len(f.messages) - n1})")
    mk = msg_de("invité à valider", "« Kim Alerte »") or {}
    f.clic(bouton="Valider", message_id=mk.get("message_id"))
    ok(attendre(lambda: espaces.team_role(auth.user("kim-alerte"), tid) == "member"),
       "alertes : Valider : Kim est membre de la Team d'Ada")
    md = msg_de("demande à la porte", "« Kim Alerte »") or {}
    ok(attendre(lambda: "validé par Cal" in next((x["text"] for x in f.messages if x["message_id"] == md.get("message_id")), "")
                and not next((x for x in f.messages if x["message_id"] == md.get("message_id")), {}).get("reply_markup")),
       "alertes : … et l'autre message (sa demande à la porte) le dit aussi, sans boutons")

    # ce que Cal crée : accepté d'emblée, sans alerte
    n1 = len(f.messages)
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Cyd Alerte", "role": "member"})
    time.sleep(0.8)
    ok(s == 200 and auth.user("cyd-alerte")["state"] == "active" and len(f.messages) == n1,
       f"alertes : un pseudo que Cal met dans une Team : accepté, aucune alerte ({s} {len(f.messages) - n1})")

    # une liste collée : un message pour tous, « Valider (3) »
    n1 = len(f.messages)
    for nm in ("Una Alerte", "Uli Alerte", "Uma Alerte"):
        P(f"/api/equipes/{tid}/membres", {"pseudo": nm, "role": "member"}, ada)
    ok(attendre(lambda: msg_de("invités à valider", "« Uma Alerte »")), "alertes : trois invités d'un coup : « invités à valider »")
    mg = msg_de("invités à valider") or {}
    ok(len(f.messages) == n1 + 1 and all(f"« {x} »" in mg.get("text", "") for x in ("Una Alerte", "Uli Alerte", "Uma Alerte"))
       and [b["text"] for row in mg.get("reply_markup", {}).get("inline_keyboard", []) for b in row] == ["Valider (3)", "Refuser (3)"],
       f"alertes : un seul message, les trois nommés, « Valider (3) » ({len(f.messages) - n1})")
    # Cal en valide un dans Admin : le message le dit sur sa ligne, garde « Valider (2) »
    s, _, _ = P("/api/admin/requests/uli-alerte/accept")
    ok(s == 200 and attendre(lambda: "« Uli Alerte » — membre — validé par Cal" in next(
        (x["text"] for x in f.messages if x["message_id"] == mg.get("message_id")), "")),
       f"alertes : accepté dans Admin : le message le dit sur sa ligne ({s})")
    mg2 = next((x for x in f.messages if x["message_id"] == mg.get("message_id")), {})
    ok([b["text"] for row in mg2.get("reply_markup", {}).get("inline_keyboard", []) for b in row] == ["Valider (2)", "Refuser (2)"],
       "alertes : … et ses boutons comptent ce qui reste (2)")
    f.clic(bouton="Valider", message_id=mg.get("message_id"))
    ok(attendre(lambda: all((auth.user(x) or {}).get("state") == "active" for x in ("una-alerte", "uma-alerte"))),
       "alertes : Valider (2) : les deux autres entrent")

    # une demande à la porte, une demande de Studio : leurs boutons sont ceux d'Admin
    s, d, _ = entrer("Pol Alerte")
    ok(s == 200 and d.get("state") == "pending" and attendre(lambda: msg_de("demande à la porte", "« Pol Alerte »")),
       f"alertes : un pseudo neuf à la porte : « demande à la porte » ({s})")
    f.clic(bouton="Valider", message_id=(msg_de("demande à la porte", "« Pol Alerte »") or {}).get("message_id"))
    ok(attendre(lambda: (auth.user("pol-alerte") or {}).get("state") == "active"), "alertes : Valider : il entre")
    P("/api/admin/users", {"name": "Sia Alerte", "access": "apps"})
    _, _, sia = entrer("Sia Alerte")
    s, d, _ = P("/api/auth/studio", {}, sia)
    ok(s == 200 and attendre(lambda: msg_de("demande de Studio", "« Sia Alerte »")), f"alertes : une demande de Studio annoncée ({s})")
    ms = msg_de("demande de Studio", "« Sia Alerte »") or {}
    ok([b["text"] for row in ms.get("reply_markup", {}).get("inline_keyboard", []) for b in row] == ["Ouvrir le Studio", "Écarter"],
       "alertes : ses boutons : Ouvrir le Studio, Écarter")
    f.clic(bouton="Ouvrir", message_id=ms.get("message_id"))
    ok(attendre(lambda: auth.has_studio(auth.user("sia-alerte"))), "alertes : Ouvrir le Studio : il l'a")

    # 6. Telegram ne répond pas : la requête n'attend pas ; l'échec est journalisé, rien ne tombe
    f.lent["sendMessage"] = 4.0
    t0 = time.time()
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Len Alerte", "role": "member"}, ada)
    dt = time.time() - t0
    ok(s == 200 and dt < 1.0, f"alertes : Telegram lent, la requête n'attend pas ({s} {dt:.2f} s)")
    ok(attendre(lambda: (etat().get("dernier") or {}).get("ok") is False, 8)
       and "injoignable" in ((etat().get("dernier") or {}).get("erreur") or ""),
       f"alertes : l'envoi a échoué, le dernier envoi le dit ({etat().get('dernier')})")
    ok(any(x.get("event") == "alerte non envoyée" for x in auth.journal_tail(200)), "alertes : « alerte non envoyée » au journal")
    f.lent.clear()
    config.CFG["alertes"]["url"] = "http://127.0.0.1:9"   # rien n'écoute là
    t0 = time.time()
    s, d, _ = entrer("Rex Alerte")
    ok(s == 200 and time.time() - t0 < 1.0, f"alertes : Telegram éteint, la porte répond tout de suite ({s} {time.time() - t0:.2f} s)")
    ok(attendre(lambda: "injoignable" in ((etat().get("dernier") or {}).get("erreur") or "")
                and (etat().get("dernier") or {}).get("quoi") == "demande à la porte", 6),
       f"alertes : … l'échec est noté ({etat().get('dernier')})")
    config.CFG["alertes"]["url"] = f.url
    ok(alertes._propre(f"un message avec {f.token} dedans") == "un message avec <jeton> dedans"
       and f.token not in alertes._propre(f"bot{f.token}/sendMessage"), "alertes : une erreur qui citerait le jeton est nettoyée")

    # 7. un seul fil d'écoute, même rechargé
    for _ in range(3):
        alertes.assurer()
    spec = importlib.util.spec_from_file_location("core.alertes_copie", config.REPO / "server" / "core" / "alertes.py")
    copie = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(copie)
    copie.assurer()
    copie._envoi()
    alertes._envoi()
    noms = [t.name for t in threading.enumerate() if t.is_alive()]
    ok(noms.count(alertes.ECOUTE) == 1 and noms.count(alertes.ENVOI) == 1 and copie.etat().get("ecoute") is True,
       f"alertes : un seul fil d'écoute et un seul d'envoi, même avec le module chargé deux fois ({noms.count(alertes.ECOUTE)}, {noms.count(alertes.ENVOI)})")

    # 8. Couper : plus rien ne part, l'écoute s'arrête ; Rallumer
    s, e, _ = P("/api/admin/alertes/actif", {"actif": False})
    ok(s == 200 and e.get("actif") is False and e.get("pose") is True, f"alertes : coupées, le jeton reste posé ({s})")
    ok(attendre(lambda: not [t for t in threading.enumerate() if t.name == alertes.ECOUTE and t.is_alive()], 6),
       "alertes : coupées, l'écoute s'arrête")
    n1 = len(f.messages)
    P(f"/api/equipes/{tid}/membres", {"pseudo": "Mia Alerte", "role": "member"}, ada)
    time.sleep(0.8)
    ok(len(f.messages) == n1 and auth.user("mia-alerte")["state"] == "pending",
       "alertes : coupées, rien ne part (l'invité attend Cal dans Admin)")
    s, e, _ = P("/api/admin/alertes/actif", {"actif": True})
    ok(s == 200 and e.get("actif") is True and attendre(lambda: etat().get("ecoute") is True), f"alertes : rallumées ({s})")
    s, d, _ = P("/api/admin/alertes/actif", {"actif": "oui"})
    ok(s == 400, f"alertes : actif : un booléen ({s})")
