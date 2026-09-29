"""La porte : entrer par son pseudo, attendre Cal, se déconnecter.

Les seules routes ouvertes sans session (`/api/auth/…`) ; tout le reste
passe par la porte du socle (core/auth.py). La page : commun/porte.js.

    GET  /api/auth/me                   qui je suis : anonymous | pending | active | refused | suspended | offnet
    POST /api/auth/enter {name}         entrer par son pseudo ; un pseudo inconnu devient une demande
    POST /api/auth/cancel               annuler sa demande
    POST /api/auth/logout               se déconnecter (ce navigateur) ; on revient en retapant son pseudo
    GET  /api/auth/devices              mes connexions (navigateurs)
    POST /api/auth/devices/<id>/revoke  en fermer une

Pour Cal (sous /api/admin/ : la porte du socle les refuse à qui n'est pas admin) :

    POST /api/admin/users {name}        un pseudo d'ami créé d'avance, déjà accepté (su007 entre sans attendre)
    GET  /api/admin/porte               la porte publique : mode, adresse, lien d'invitation à envoyer
"""

from __future__ import annotations

import json

from core import auth
from core.http import HttpError, Response


def _json(obj: dict, cookie: str | None = None, clear: bool = False) -> Response:
    headers = {}
    if cookie or clear:
        headers["Set-Cookie"] = auth.cookie_header(None if clear else cookie)
    return Response(json.dumps(obj, ensure_ascii=False), 200, "application/json; charset=utf-8", headers)


def _active(req) -> dict:
    u = getattr(req, "user", None)
    if not u:
        raise HttpError(401, "connexion requise")
    return u


def me(req):
    return auth.me(req)


def enter(req):
    if not auth.enabled():
        raise HttpError(409, "la porte est coupée sur ce portail (auth: false)")
    state, u, tok = auth.enter(req.json().get("name"), req)
    return _json({"state": state, "user": auth.public_user(u), "since": u.get("created")}, cookie=tok)


def cancel(req):
    auth.cancel_request(req)
    return _json({"state": "anonymous"}, clear=True)


def logout(req):
    auth.logout(req)
    return _json({"state": "anonymous"}, clear=True)


def devices(req):
    u = _active(req)
    return {"devices": auth.devices(u["id"], getattr(req, "session", None))}


def revoke(req, sid):
    u = _active(req)
    return {"removed": auth.revoke(u["id"], sid)}


def _admin(req) -> dict:
    u = getattr(req, "user", None)
    if not auth.is_admin(u):
        raise HttpError(403, "réservé aux admins")
    return u


def create_friend(req):
    u = _admin(req)
    return auth.public_user(auth.create_friend(req.json().get("name"), by=u["id"]))


def door_links(req):
    """Le lien d'invitation (le code dedans), pas le code admin : Cal l'a déjà, et
    la page n'a pas à le répéter (tools/porte.sh lien le donne sur DGX2)."""
    _admin(req)
    d = auth.invite_links()
    return {k: d.get(k) for k in ("mode", "url", "lien", "invitation")}


def register(app) -> None:
    app.route("POST", "/api/admin/users", create_friend)
    app.route("GET", "/api/admin/porte", door_links)
    app.route("GET", "/api/auth/me", me)
    app.route("POST", "/api/auth/enter", enter)
    app.route("POST", "/api/auth/cancel", cancel)
    app.route("POST", "/api/auth/logout", logout)
    app.route("GET", "/api/auth/devices", devices)
    app.route("POST", "/api/auth/devices/{sid}/revoke", revoke)


# ── le contrôle (tools/check.py) : la porte, allumée ────────
def selftest(call, ok) -> None:
    import io

    from PIL import Image

    from core import config, jobs, library
    from tools.admin import essai_http as H

    def png() -> bytes:
        buf = io.BytesIO()
        Image.new("RGB", (32, 24), (40, 90, 60)).save(buf, "PNG")
        return buf.getvalue()

    before = config.CFG.get("auth")
    config.CFG["auth"] = True
    auth.startup()
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    jobs.register("compte.essai", lambda ctx: {"note": "ok"}, lane="cpu", title="Essai de la porte")
    real_ip = auth._ip
    try:
        # sans session : les pages se servent, rien d'autre
        for path in ("/", "/commun/shell.js", "/commun/porte.js", "/admin/"):
            s, _, _ = H("GET", path)
            ok(s == 200, f"sans session, la page se sert : {path} ({s})")
        auth.set_current(auth.pseudo_admin())   # un objet fait au nom de Cal
        tmp = config.data_dir() / "porte-essai.png"
        tmp.write_bytes(png())
        cal_item = library.add_file(tmp, title="à Cal")
        auth.set_current(None)
        for path in ("/api/library", "/api/jobs", "/api/queue", "/character/api/characters", f"/library/{cal_item['id']}/main.png"):
            s, _, _ = H("GET", path)
            ok(s == 401, f"sans session, refusé : {path} ({s})")
        s, me_, _ = H("GET", "/api/auth/me")
        ok(s == 200 and me_.get("state") == "anonymous", f"la porte : anonyme ({me_})")
        ok(not (config.data_dir() / "admin-code.txt").exists(), "plus de code d'amorçage sur le disque")
        cal = auth.user(auth.admin_id())
        ok(cal and cal.get("pseudo") == "nico007" and cal["role"] == "admin" and cal["id"] == "cal",
           f"le compte de Cal existe au démarrage : pseudo nico007, admin, id cal ({cal})")

        # Cal tape son pseudo : il entre, sans rien d'autre (casse indifférente)
        s, d, adm = H("POST", "/api/auth/enter", {"name": "NICO007"}, headers=same)
        ok(s == 200 and adm and d.get("state") == "active" and d["user"]["role"] == "admin" and d["user"]["id"] == "cal",
           f"« nico007 » : Cal entre aussitôt, admin ({s} {d})")

        # un pseudo inconnu : une demande, en attente
        s, d, tok = H("POST", "/api/auth/enter", {"name": "Noé"})
        ok(s == 200 and tok and d.get("state") == "pending", f"un pseudo inconnu : demande en attente ({s} {d})")
        s, me_, _ = H("GET", "/api/auth/me", cookie=tok)
        ok(me_.get("state") == "pending" and me_.get("user", {}).get("name") == "Noé", f"en attente ({me_})")
        s, _, _ = H("GET", "/api/library", cookie=tok)
        ok(s == 401, f"en attente : pas encore d'accès ({s})")
        s, me_, _ = H("GET", "/api/auth/me", cookie=adm)
        ok(me_.get("pending_requests", 0) >= 1, f"Cal voit qu'une demande attend ({me_})")

        # les imitations et les mots réservés
        for name, why in (("Cal", "réservé"), ("CAL", "réservé"), ("Çal", "réservé"), ("CaI", "réservé"),
                          ("nic0007", "réservé"), ("NlCO007", "réservé"), ("admin", "réservé"),
                          ("N0é", "ressemble"), ("x", "2 à 24")):
            s, d, t2 = H("POST", "/api/auth/enter", {"name": name})
            ok(s in (400, 409) and not t2 and why in (d or {}).get("error", ""), f"« {name} » refusé : {why} ({s} {d})")

        # un admin hors du réseau de Cal : refusé, et dit
        for ip, want in (("127.0.0.1", True), ("192.168.10.12", True), ("169.254.110.6", True), ("100.101.5.9", True),
                         ("::1", True), ("::ffff:192.168.10.3", True), ("203.0.113.9", False), ("192.168.1.20", False),
                         ("10.0.0.4", False)):
            ok(auth.on_admin_network(ip) == want, f"le réseau de Cal : {ip} → {want}")
        auth._ip = lambda req: "203.0.113.9"
        s, d, t3 = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        ok(s == 403 and not t3 and "réseau de Cal" in (d or {}).get("error", ""), f"nico007 hors du réseau : refusé ({s} {d})")
        s, d, _ = H("GET", "/api/admin/state", cookie=adm)
        ok(s == 403 and "réseau de Cal" in (d or {}).get("error", ""), f"une session admin hors du réseau : refusée ({s})")
        s, me_, _ = H("GET", "/api/auth/me", cookie=adm)
        ok(me_.get("state") == "offnet", f"la porte le dit ({me_.get('state')})")
        auth.set_settings({"admin_lan_only": False}, by="cal")
        s, _, _ = H("GET", "/api/admin/state", cookie=adm)
        ok(s == 200, f"réglage admin_lan_only coupé : l'admin passe de partout ({s})")
        auth.set_settings({"admin_lan_only": True}, by="cal")
        auth._ip = real_ip

        # Cal accepte ; le même navigateur entre, et le pseudo entre depuis n'importe quel autre
        s, _, _ = H("GET", "/api/admin/state", cookie=tok)
        ok(s == 401, f"en attente : pas d'admin ({s})")
        s, d, _ = H("POST", "/api/admin/requests/noe/accept", cookie=adm, headers=same)
        ok(s == 200, f"Cal accepte Noé ({s} {d})")
        s, me_, _ = H("GET", "/api/auth/me", cookie=tok)
        ok(me_.get("state") == "active" and me_["user"]["role"] == "ami", f"accepté : le navigateur qui attendait entre ({me_})")
        s, d, tok2 = H("POST", "/api/auth/enter", {"name": "noé"})
        ok(s == 200 and tok2 and d.get("state") == "active", f"un pseudo accepté entre sans attente, d'un autre navigateur ({s} {d})")
        s, _, _ = H("GET", "/api/library", cookie=tok2)
        ok(s == 200, f"… et la bibliothèque s'ouvre ({s})")
        s, _, _ = H("POST", "/api/auth/logout", cookie=tok2, headers=same)
        s, me_, _ = H("GET", "/api/auth/me", cookie=tok2)
        ok(me_.get("state") == "anonymous", f"déconnecté ({me_})")
        s, d, tok2 = H("POST", "/api/auth/enter", {"name": "Noé"})
        ok(s == 200 and d.get("state") == "active", f"déconnexion puis reconnexion : on retape son pseudo ({s})")
        for method, path in (("GET", "/api/admin/state"), ("POST", "/api/movie/h3/stop"), ("POST", "/api/admin/pause")):
            s, _, _ = H(method, path, {} if method == "POST" else None, cookie=tok, headers=same)
            ok(s == 403, f"un ami n'a pas : {method} {path} ({s})")

        # le rôle admin : donner, retirer, jamais le dernier
        s, d, _ = H("POST", "/api/admin/users/cal", {"role": "ami"}, cookie=adm, headers=same)
        ok(s == 409 and "dernier admin" in (d or {}).get("error", ""), f"le dernier admin ne perd pas son rôle ({s} {d})")
        s, d, _ = H("POST", "/api/admin/users/noe", {"role": "admin"}, cookie=adm, headers=same)
        ok(s == 200 and d.get("role") == "admin", f"Cal donne le rôle admin à Noé ({s} {d})")
        s, _, _ = H("GET", "/api/admin/state", cookie=tok)
        ok(s == 200, f"Noé, admin, ouvre la page d'admin ({s})")
        s, d, _ = H("POST", "/api/admin/users/noe", {"state": "suspended"}, cookie=adm, headers=same)
        ok(s == 409, f"un admin ne se suspend pas ({s})")
        s, _, _ = H("POST", "/api/admin/users/cal", {"role": "ami"}, cookie=tok, headers=same)
        s2, d2, _ = H("POST", "/api/admin/users/noe", {"role": "ami"}, cookie=tok, headers=same)
        ok(s == 200 and s2 == 409, f"Noé retire le rôle de Cal, puis ne peut pas se retirer le sien : dernier admin ({s}, {s2} {d2})")
        s, _, _ = H("POST", "/api/admin/users/cal", {"role": "admin"}, cookie=tok, headers=same)
        s2, _, _ = H("POST", "/api/admin/users/noe", {"role": "ami"}, cookie=adm, headers=same)
        ok(s == 200 and s2 == 200 and auth.user("noe")["role"] == "ami" and auth.user("cal")["role"] == "admin",
           f"le rôle revient à Cal, Noé redevient ami ({s}, {s2})")
        s, _, _ = H("GET", "/api/admin/state", cookie=tok)
        ok(s == 403, f"rôle retiré : la page d'admin se ferme aussitôt ({s})")

        # CSRF (audit H3) : une écriture venue d'une autre page
        s, up, _ = H("PUT", "/api/library/upload?name=noe.png&title=De+No%C3%A9", raw=png(), cookie=tok,
                     headers={**same, "Content-Type": "image/png"})
        ok(s == 200 and up.get("owner") == "noe", f"le dépôt de Noé est à Noé ({s})")
        nid = up.get("id")
        for hdrs, want in (({"Origin": "http://evil.example"}, 403), ({"Sec-Fetch-Site": "cross-site"}, 403),
                           ({"Origin": "null"}, 403), ({**same, "Sec-Fetch-Site": "same-origin"}, 200)):
            s, _, _ = H("POST", f"/api/library/{nid}", {"title": "Renommée"}, cookie=tok, headers=hdrs)
            ok(s == want, f"écriture avec {hdrs} : {want} ({s})")
        s, _, _ = H("POST", "/api/auth/enter", {"name": "Zoé"}, headers={"Origin": "http://evil.example"})
        ok(s == 403, f"la porte elle-même refuse une autre origine ({s})")
        s, _, _ = H("POST", f"/api/library/{nid}", raw=b'{"title":"x"}', cookie=tok,
                    headers={**same, "Content-Type": "text/plain"})
        ok(s == 415, f"du JSON déguisé en text/plain (formulaire d'une autre page) : refusé ({s})")

        # à qui : seul le propriétaire (ou un admin) modifie
        s, d, _ = H("POST", f"/api/library/{cal_item['id']}", {"title": "Volé"}, cookie=tok, headers=same)
        ok(s == 403 and "Cal" in (d or {}).get("error", ""), f"Noé ne modifie pas l'objet de Cal ({s} {d})")
        s, _, _ = H("POST", f"/api/library/{cal_item['id']}/delete", cookie=tok, headers=same)
        ok(s == 403 and library.get(cal_item["id"]), f"ni ne le met à la corbeille ({s})")
        s, _, _ = H("POST", f"/api/library/{nid}", {"title": "Vu par Cal"}, cookie=adm, headers=same)
        ok(s == 200, f"Cal modifie tout ({s})")

        # qui voit quoi : « chacun voit le sien et ce qui est partagé »
        auth.set_settings({"visibility": "own"}, by="cal")
        s, d, _ = H("GET", "/api/library?limit=500", cookie=tok)
        ids = {i["id"] for i in d.get("items", [])}
        ok(nid in ids and cal_item["id"] not in ids, "chacun voit le sien : l'objet de Cal est caché à Noé")
        s1, _, _ = H("GET", f"/api/library/{cal_item['id']}", cookie=tok)
        s2, _, _ = H("GET", f"/library/{cal_item['id']}/main.png", cookie=tok)
        ok(s1 == 404 and s2 == 404, f"ni par son adresse, ni par son fichier ({s1}, {s2})")
        H("POST", f"/api/library/{cal_item['id']}", {"shared": True}, cookie=adm, headers=same)
        s2, _, _ = H("GET", f"/library/{cal_item['id']}/main.png", cookie=tok)
        ok(s2 == 200, f"partagé par Cal : Noé le voit ({s2})")
        auth.set_settings({"visibility": "all"}, by="cal")

        # la file : arrêter le travail d'un autre, non
        jobs.set_mode(None, "paused")
        s, j, _ = H("POST", "/api/jobs", {"kind": "compte.essai", "params": {}, "title": "à Cal"}, cookie=adm, headers=same)
        s1, _, _ = H("POST", f"/api/jobs/{j['id']}/cancel", cookie=tok, headers=same)
        s2, _, _ = H("POST", f"/api/jobs/{j['id']}/cancel", cookie=adm, headers=same)
        ok(s1 == 403 and s2 == 200, f"Noé n'arrête pas le travail de Cal ; Cal, oui ({s1}, {s2})")
        jobs.set_mode(None, "active")

        # refusé, puis le pseudo redevient libre
        s, _, t3 = H("POST", "/api/auth/enter", {"name": "Inès"})
        H("POST", "/api/admin/requests/ines/refuse", cookie=adm, headers=same)
        s, me_, _ = H("GET", "/api/auth/me", cookie=t3)
        ok(me_.get("state") == "refused", f"refusé : la page le dit ({me_})")
        s, _, _ = H("POST", "/api/auth/enter", {"name": "Inès"})
        ok(s == 200, f"un pseudo refusé redevient libre ({s})")

        # suspendu : ni la session, ni le pseudo n'entrent
        H("POST", "/api/admin/users/noe", {"state": "suspended"}, cookie=adm, headers=same)
        s, d, _ = H("GET", "/api/library", cookie=tok)
        s2, d2, t4 = H("POST", "/api/auth/enter", {"name": "Noé"})
        ok(s == 403 and "suspendu" in (d or {}).get("error", "") and s2 == 403 and not t4,
           f"suspendu : refusé, et dit ({s}, {s2} {d2})")
        H("POST", "/api/admin/users/noe", {"state": "active"}, cookie=adm, headers=same)

        # le journal
        ev = {e["event"] for e in auth.journal_tail(400)}
        ok({"demande", "accepté", "refusé", "entrée", "personne"} <= ev, f"le journal garde la trace ({sorted(ev)[:12]})")
        ok(any(e["event"] == "http" and e.get("user") == "noe" and e.get("status") == 403 for e in auth.journal_tail(400)),
           "chaque écriture est journalisée : qui, quoi, le code rendu (audit B5)")

        # le secours en ligne de commande, relu par le portail en marche
        u = auth.cli_admin("Secours")
        s, d, t5 = H("POST", "/api/auth/enter", {"name": "secours"})
        ok(u["role"] == "admin" and s == 200 and d["user"]["role"] == "admin", f"--admin <pseudo> : un admin de secours ({s})")
        auth.set_user(u["id"], {"role": "ami"}, "cal")
    finally:
        auth._ip = real_ip
        auth.set_current(None)
        jobs.set_mode(None, "active")
        auth.set_settings({"visibility": "all", "admin_lan_only": True}, by="cal")
        config.CFG["auth"] = before
