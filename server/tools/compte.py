"""La porte : demander l'accès, entrer par un code, ses appareils.

Les seules routes ouvertes sans session (`/api/auth/…`) ; tout le reste
passe par la porte du socle (core/auth.py). La page : commun/porte.js.

    GET  /api/auth/me                   qui je suis : anonymous | pending | active | refused | suspended
    POST /api/auth/request {name}       demander l'accès : le cookie lie ce navigateur à la demande
    POST /api/auth/cancel               annuler sa demande
    POST /api/auth/code {name, code}    entrer par un code (celui de Cal, ou un code de liaison)
    POST /api/auth/logout               se déconnecter (ce navigateur)
    GET  /api/auth/devices              mes appareils
    POST /api/auth/devices/<id>/revoke  en retirer un
    POST /api/auth/link                 un code de liaison pour un autre appareil (10 min)
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


def request(req):
    if not auth.enabled():
        raise HttpError(409, "la porte est coupée sur ce portail (auth: false)")
    u, tok = auth.request_access(req.json().get("name"), req)
    return _json({"state": "pending", "user": auth.public_user(u), "since": u["created"]}, cookie=tok)


def cancel(req):
    auth.cancel_request(req)
    return _json({"state": "anonymous"}, clear=True)


def code(req):
    if not auth.enabled():
        raise HttpError(409, "la porte est coupée sur ce portail (auth: false)")
    d = req.json()
    u, tok = auth.code_login(d.get("name"), d.get("code"), req)
    return _json({"state": "active", "user": auth.public_user(u)}, cookie=tok)


def logout(req):
    auth.logout(req)
    return _json({"state": "anonymous"}, clear=True)


def devices(req):
    u = _active(req)
    return {"devices": auth.devices(u["id"], getattr(req, "session", None))}


def revoke(req, sid):
    u = _active(req)
    return {"removed": auth.revoke(u["id"], sid)}


def link(req):
    u = _active(req)
    if not auth.enabled():
        raise HttpError(409, "la porte est coupée sur ce portail (auth: false)")
    return auth.link_code(u["id"])


def register(app) -> None:
    app.route("GET", "/api/auth/me", me)
    app.route("POST", "/api/auth/request", request)
    app.route("POST", "/api/auth/cancel", cancel)
    app.route("POST", "/api/auth/code", code)
    app.route("POST", "/api/auth/logout", logout)
    app.route("GET", "/api/auth/devices", devices)
    app.route("POST", "/api/auth/devices/{sid}/revoke", revoke)
    app.route("POST", "/api/auth/link", link)


# ── le contrôle (tools/check.py) : la porte, allumée ────────
def selftest(call, ok) -> None:
    import hashlib
    import io
    import time

    from PIL import Image

    from core import config, jobs, library
    from tools.admin import essai_http as H

    def png() -> bytes:
        buf = io.BytesIO()
        Image.new("RGB", (32, 24), (40, 90, 60)).save(buf, "PNG")
        return buf.getvalue()

    before = config.CFG.get("auth")
    config.CFG["auth"] = True
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    jobs.register("compte.essai", lambda ctx: {"note": "ok"}, lane="cpu", title="Essai de la porte")
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
        s, me, _ = H("GET", "/api/auth/me")
        ok(s == 200 and me.get("state") == "anonymous", f"la porte : anonyme ({me})")

        # la demande, en attente
        s, d, tok = H("POST", "/api/auth/request", {"name": "Noé"})
        ok(s == 200 and tok and d.get("state") == "pending", f"demande envoyée, un cookie la lie à ce navigateur ({s} {d})")
        s, me, _ = H("GET", "/api/auth/me", cookie=tok)
        ok(me.get("state") == "pending" and me.get("user", {}).get("name") == "Noé", f"en attente ({me})")
        s, _, _ = H("GET", "/api/library", cookie=tok)
        ok(s == 401, f"en attente : pas encore d'accès ({s})")
        for name, why in (("noe", "déjà pris"), ("NOÉ", "déjà pris"), ("Cal", "réservé"), ("CAL", "réservé"),
                          ("Çal", "réservé"), ("CaI", "réservé"), ("admin", "réservé"), ("x", "2 à 24")):
            s, d, t2 = H("POST", "/api/auth/request", {"name": name})
            ok(s in (400, 409) and not t2 and why in (d or {}).get("error", ""), f"« {name} » refusé : {why} ({s} {d})")

        # Cal : son code, à usage unique ; taper « Cal » ne donne rien
        code = auth.new_admin_code()
        f = auth.admin_code_file()
        ok(f.exists() and (f.stat().st_mode & 0o777) == 0o600, "le code admin est écrit, lisible par son seul propriétaire")
        s, _, t0 = H("POST", "/api/auth/code", {"name": "Cal", "code": "AAAA-BBBB-CCCC"})
        ok(s == 403 and not t0, f"un faux code : refusé ({s})")
        s, d, adm = H("POST", "/api/auth/code", {"code": code.lower().replace("-", " ")})
        ok(s == 200 and adm and d["user"]["role"] == "admin", f"le code de Cal : admin (casse et tirets indifférents) ({s} {d})")
        ok(not f.exists(), "le code s'efface dès qu'il a servi")
        s, _, _ = H("POST", "/api/auth/code", {"code": code})
        ok(s == 403, f"le même code une seconde fois : refusé ({s})")
        s, me, _ = H("GET", "/api/auth/me", cookie=adm)
        ok(me.get("state") == "active" and me["user"]["role"] == "admin" and me.get("pending_requests", 0) >= 1,
           f"Cal voit qu'une demande attend ({me})")

        # Cal accepte
        s, _, _ = H("GET", "/api/admin/state", cookie=tok)
        ok(s == 401, f"en attente : pas d'admin ({s})")
        s, d, _ = H("POST", "/api/admin/requests/noe/accept", cookie=adm, headers=same)
        ok(s == 200, f"Cal accepte Noé ({s} {d})")
        s, me, _ = H("GET", "/api/auth/me", cookie=tok)
        ok(me.get("state") == "active" and me["user"]["role"] == "ami", f"accepté : le même navigateur entre ({me})")
        s, _, _ = H("GET", "/api/library", cookie=tok)
        ok(s == 200, f"accepté : la bibliothèque s'ouvre ({s})")
        for method, path in (("GET", "/api/admin/state"), ("POST", "/api/movie/h3/stop"), ("POST", "/api/admin/pause")):
            s, _, _ = H(method, path, {} if method == "POST" else None, cookie=tok, headers=same)
            ok(s == 403, f"un ami n'a pas : {method} {path} ({s})")

        # CSRF (audit H3) : une écriture venue d'une autre page
        s, up, _ = H("PUT", "/api/library/upload?name=noe.png&title=De+No%C3%A9", raw=png(), cookie=tok,
                     headers={**same, "Content-Type": "image/png"})
        ok(s == 200 and up.get("owner") == "noe", f"le dépôt de Noé est à Noé ({s} {up.get('owner') if isinstance(up, dict) else up})")
        nid = up.get("id")
        for hdrs, want in (({"Origin": "http://evil.example"}, 403), ({"Sec-Fetch-Site": "cross-site"}, 403),
                           ({"Origin": "null"}, 403), ({**same, "Sec-Fetch-Site": "same-origin"}, 200)):
            s, _, _ = H("POST", f"/api/library/{nid}", {"title": "Renommée"}, cookie=tok, headers=hdrs)
            ok(s == want, f"écriture avec {hdrs} : {want} ({s})")
        s, _, _ = H("POST", f"/api/library/{nid}", raw=b'{"title":"x"}', cookie=tok,
                    headers={**same, "Content-Type": "text/plain"})
        ok(s == 415, f"du JSON déguisé en text/plain (formulaire d'une autre page) : refusé ({s})")

        # à qui : seul le propriétaire (ou Cal) modifie
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

        # un autre appareil : le code de liaison
        s, lk, _ = H("POST", "/api/auth/link", cookie=tok, headers=same)
        ok(s == 200 and len(lk.get("code", "")) == 9, f"un code de liaison ({s} {lk})")
        s, _, _ = H("POST", "/api/auth/code", {"name": "Noé", "code": "ZZZZ-ZZZZ"})
        ok(s == 403, f"un mauvais code : refusé ({s})")
        s, d, tok2 = H("POST", "/api/auth/code", {"name": "noe", "code": lk["code"]})
        ok(s == 200 and tok2 and d["user"]["id"] == "noe", f"le bon code relie le second appareil ({s})")
        s, dv, _ = H("GET", "/api/auth/devices", cookie=tok)
        ok(s == 200 and len(dv.get("devices", [])) == 2 and sum(1 for x in dv["devices"] if x["current"]) == 1,
           f"ses deux appareils ({dv})")
        sid = hashlib.sha256(tok2.encode()).hexdigest()[:12]
        s, _, _ = H("POST", f"/api/auth/devices/{sid}/revoke", cookie=tok, headers=same)
        s, me, _ = H("GET", "/api/auth/me", cookie=tok2)
        ok(me.get("state") == "anonymous", f"un appareil retiré n'entre plus ({me})")

        # refusé, annulé
        s, _, t3 = H("POST", "/api/auth/request", {"name": "Inès"})
        H("POST", "/api/admin/requests/ines/refuse", cookie=adm, headers=same)
        s, me, _ = H("GET", "/api/auth/me", cookie=t3)
        ok(me.get("state") == "refused", f"refusé : la page le dit ({me})")
        s, _, _ = H("POST", "/api/auth/request", {"name": "Inès"})
        ok(s == 200, f"un nom refusé redevient libre ({s})")

        # suspendu, puis déconnecté
        H("POST", "/api/admin/users/noe", {"state": "suspended"}, cookie=adm, headers=same)
        s, d, _ = H("GET", "/api/library", cookie=tok)
        ok(s == 403 and "suspendu" in (d or {}).get("error", ""), f"suspendu : refusé, et dit ({s} {d})")
        H("POST", "/api/admin/users/noe", {"state": "active"}, cookie=adm, headers=same)
        s, _, _ = H("POST", "/api/auth/logout", cookie=tok, headers=same)
        s, me, _ = H("GET", "/api/auth/me", cookie=tok)
        ok(me.get("state") == "anonymous", f"déconnecté ({me})")

        # le journal
        ev = {e["event"] for e in auth.journal_tail(400)}
        ok({"demande", "accepté", "refusé", "code admin utilisé", "code refusé", "appareil relié"} <= ev,
           f"le journal garde la trace ({sorted(ev)[:12]})")
        ok(any(e["event"] == "http" and e.get("user") == "noe" and e.get("status") == 403 for e in auth.journal_tail(400)),
           "chaque écriture est journalisée : qui, quoi, le code rendu (audit B5)")
    finally:
        auth.set_current(None)
        jobs.set_mode(None, "active")
        auth.set_settings({"visibility": "all"}, by="cal")
        config.CFG["auth"] = before
