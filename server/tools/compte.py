"""La porte : entrer par son pseudo, attendre Cal, se déconnecter.

Les seules routes ouvertes sans session (`/api/auth/…`) ; tout le reste
passe par la porte du socle (core/auth.py). La page : commun/porte.js.

    GET  /api/auth/me                   qui je suis : anonymous | pending | active | refused | suspended | offnet
    POST /api/auth/enter {name}         entrer par son pseudo ; un pseudo inconnu devient une demande
    POST /api/auth/cancel               annuler sa demande
    POST /api/auth/logout               se déconnecter (ce navigateur) ; on revient en retapant son pseudo
    GET  /api/auth/devices              mes connexions (navigateurs)
    POST /api/auth/devices/<id>/revoke  en fermer une
    POST /api/auth/studio               demander le Studio (un compte Apps) : {ok, access, asked}
    GET  /api/auth/studio-ferme         la page « réservé au Studio » : ce que devient une page d'un outil
                                        Studio demandée par un compte Apps (core/auth.py, _studio_only)

Pour Cal (sous /api/admin/ : la porte du socle les refuse à qui n'est pas admin) :

    POST /api/admin/users {name, role, access}  un pseudo créé d'avance (ami ou admin ; apps ou studio, sinon le
                                        réglage new_access), déjà accepté (su007 entre sans attendre)
    GET  /api/admin/porte               la porte publique : mode, adresse ou lien à envoyer, lien du code admin
    (le droit Studio d'une personne, une demande acceptée ou écartée : POST /api/admin/users/<id>
     {access} | {studio_request: null}, server/tools/admin.py → auth.set_user)
"""

from __future__ import annotations

import html
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
    d = req.json()
    return auth.public_user(auth.create_friend(d.get("name"), by=u["id"], role=str(d.get("role") or "ami"),
                                               access=d.get("access") or None))


def ask_studio(req):
    """Demander le Studio : la demande reste sur le compte jusqu'à Cal (Admin → Demandes)."""
    return auth.request_studio(_active(req))


def studio_page(req):
    """La page d'un outil Studio, pour un compte Apps (core/auth.py la met à la place) :
    l'en-tête du portail, puis la porte « réservé au Studio » (commun/porte.js,
    studioDoor) — la même que l'en-tête pose sur les pages servies par le Worker."""
    tid = getattr(req, "studio_tool", None) or req.q("outil") or ""
    if tid not in auth.STUDIO_TOOLS:
        tid = "montage"
    if not getattr(req, "rewritten", False) and auth.has_studio(getattr(req, "user", None)):
        # appelée par son adresse, avec le Studio : la page de l'outil
        return Response(b"", 303, "text/plain; charset=utf-8",
                        {"Location": auth.STUDIO_TOOLS[tid]["page"], "Cache-Control": "no-store"})
    name = auth.STUDIO_TOOLS[tid]["name"]
    page = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>SHOWRUNNER TOOLS · {html.escape(name.upper())} · STUDIO</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Azeret+Mono:wght@300;400;500&display=swap">
<link rel="stylesheet" href="/commun/tokens.css">
<link rel="stylesheet" href="/commun/base.css">
<link rel="stylesheet" href="/commun/shell.css">
<link rel="stylesheet" href="/commun/porte.css" data-porte>
<script type="module">import {{ mountHeader }} from '/commun/shell.js'; mountHeader({json.dumps(tid)});</script>
</head>
<body>
<noscript><main class="porte"><div class="porte-in"><section class="hero porte-card">
<span class="ref">00_STUDIO</span>
<p>{html.escape(auth.STUDIO_WHY.format(name=name))}.</p>
<p><a class="tb ghost" href="/">Retour à l’accueil</a></p>
</section></div></main></noscript>
</body>
</html>
"""
    return Response(page, 403, "text/html; charset=utf-8", {"Cache-Control": "no-store", "X-Studio": "ferme"})


def door_links(req):
    """Ce que Cal envoie : l'adresse (ou le lien d'invitation, le code dedans) pour un
    ami ; le lien du code admin pour un admin qu'il vient d'ajouter (la page ne le
    montre qu'à la demande : seuls les admins la voient)."""
    _admin(req)
    d = auth.invite_links()
    return {k: d.get(k) for k in ("mode", "url", "lien", "lien_admin", "invitation_requise")}


def register(app) -> None:
    app.route("POST", "/api/admin/users", create_friend)
    app.route("GET", "/api/admin/porte", door_links)
    app.route("GET", "/api/auth/me", me)
    app.route("POST", "/api/auth/enter", enter)
    app.route("POST", "/api/auth/cancel", cancel)
    app.route("POST", "/api/auth/logout", logout)
    app.route("GET", "/api/auth/devices", devices)
    app.route("POST", "/api/auth/devices/{sid}/revoke", revoke)
    app.route("POST", "/api/auth/studio", ask_studio)
    app.route("GET", auth.STUDIO_PAGE, studio_page)
    app.route("HEAD", auth.STUDIO_PAGE, studio_page)


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
    jobs.register("compte.essai", lambda ctx: {"note": "ok"}, lane="cpu", title="Essai de la porte", cost="cpu")
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

        # à qui (equipes_espaces.md, décision 9) : Noé, ami avec le Studio, est éditeur de Général (la
        # Team de l'instance) ; dans un Workspace partagé, tout éditeur modifie ; la corbeille reste à l'auteur
        s, d, _ = H("POST", f"/api/library/{cal_item['id']}", {"title": "Volé"}, cookie=tok, headers=same)
        ok(s == 200 and d.get("space") == "esp-general", f"Noé, éditeur de Général, modifie l'objet de Cal ({s} {d})")
        H("POST", f"/api/library/{cal_item['id']}", {"title": cal_item.get("title") or ""}, cookie=adm, headers=same)
        s, d, _ = H("POST", f"/api/library/{cal_item['id']}/delete", cookie=tok, headers=same)
        ok(s == 403 and library.get(cal_item["id"]) and "Cal" in (d or {}).get("error", ""),
           f"mais ne le met pas à la corbeille : l'auteur, ou un admin du Workspace ({s} {d})")
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

        _selftest_studio(ok, H, same, adm, png)
    finally:
        auth._ip = real_ip
        auth.set_current(None)
        jobs.set_mode(None, "active")
        auth.set_settings({"visibility": "all", "admin_lan_only": True, "new_access": "studio"}, by="cal")
        config.CFG["auth"] = before


def _selftest_studio(ok, H, same, adm, png) -> None:
    """Le droit Studio (apps_studio_elements.md § 3.6), porte allumée : un compte Apps,
    un compte Studio, Cal ; la demande, vue dans Admin, acceptée ; la table du serveur
    et TOOLS (commun/shell.js) disent la même chose."""
    import re

    from core import config, jobs, library

    with auth._lock:
        auth._hits.clear()   # les limites de débit des essais d'avant : un autre essai
    err = lambda d: d.get("error", "") if isinstance(d, dict) else ""   # noqa: E731

    # une seule vérité : TOOLS (tier: 'studio', sans open) = la table du serveur
    src = (config.REPO / "commun" / "shell.js").read_text(encoding="utf-8")
    tools = {m.group(1): (m.group(2), m.group(3), "open: true" in m.group(0))
             for m in re.finditer(r"\{ id: '(\w+)'[^\n]*?path: '([^']*)'[^\n]*?tier: '(\w+)'[^\n]*", src)}
    closed = {k: "/" + v[0] for k, v in tools.items() if v[1] == "studio" and not v[2]}
    ok(closed == {k: t["page"] for k, t in auth.STUDIO_TOOLS.items()},
       f"Studio : la table du serveur est celle de TOOLS (tier studio, sans open) ({closed})")
    ok(tools.get("asset", ("", "", False))[2] and not auth.studio_page("/asset/"), "Studio : Asset reste ouvert (open)")

    # le réglage : un compte neuf a « studio » pendant l'essai ; se change
    ok(auth.settings()["new_access"] == "studio", "Studio : un compte neuf l'a pendant la phase d'essai (réglage new_access)")
    s, d, _ = H("POST", "/api/admin/settings", {"new_access": "tout"}, cookie=adm, headers=same)
    ok(s == 400, f"Studio : new_access vaut apps ou studio ({s})")
    s, st_, _ = H("POST", "/api/admin/users", {"name": "Stéphane"}, cookie=adm, headers=same)
    ok(s == 200 and st_.get("access") == "studio", f"Studio : ajouté sans rien dire → studio ({s} {st_})")
    H("POST", "/api/admin/settings", {"new_access": "apps"}, cookie=adm, headers=same)
    s, pe, _ = H("POST", "/api/admin/users", {"name": "Pénélope"}, cookie=adm, headers=same)
    ok(s == 200 and pe.get("access") == "apps", f"Studio : new_access = apps → un compte neuf Apps ({s} {pe})")
    s, d, t0 = H("POST", "/api/auth/enter", {"name": "Hugo"})
    s2, _, _ = H("POST", "/api/admin/requests/hugo/accept", cookie=adm, headers=same)
    ok(s2 == 200 and auth.user("hugo").get("access") == "apps", "Studio : une demande acceptée prend le réglage aussi")
    H("POST", "/api/admin/settings", {"new_access": "studio"}, cookie=adm, headers=same)
    s, ap, _ = H("POST", "/api/admin/users", {"name": "Apolline", "access": "apps"}, cookie=adm, headers=same)
    ok(s == 200 and ap.get("access") == "apps", f"Studio : Ajouter quelqu'un, en Apps ({s} {ap})")
    s, d, _ = H("POST", "/api/admin/users", {"name": "Zébulon", "access": "tout"}, cookie=adm, headers=same)
    ok(s == 400, f"Studio : un accès inconnu est refusé ({s})")

    _, _, A = H("POST", "/api/auth/enter", {"name": "Apolline"})
    _, _, S = H("POST", "/api/auth/enter", {"name": "Stéphane"})
    for tok, want, who in ((A, "apps", "Apolline"), (S, "studio", "Stéphane"), (adm, "studio", "Cal")):
        s, me_, _ = H("GET", "/api/auth/me", cookie=tok)
        ok(s == 200 and (me_.get("user") or {}).get("access") == want, f"Studio : /api/auth/me rend access = {want} ({who})")
    auth.set_current(auth.user("cal"))
    tmp = config.data_dir() / "studio-essai.png"
    tmp.write_bytes(png())
    auth.set_current(auth.user("stephane"))
    s_img = library.add_file(tmp, title="à Stéphane")
    auth.set_current(None)

    # un compte Apps : les pages Studio → la page « réservé au Studio », qui mène à la demande
    for tid, t in auth.STUDIO_TOOLS.items():
        s, body, _ = H("GET", t["page"], cookie=A)
        text = body.decode("utf-8", "replace") if isinstance(body, bytes) else str(body)
        ok(s == 403 and f"mountHeader({json.dumps(tid)})" in text and "porte.css" in text,
           f"Studio, compte Apps : {t['page']} → la page « réservé au Studio » ({s})")
    s, body, _ = H("GET", "/montage/montage.js", cookie=A)
    ok(s == 403, f"Studio, compte Apps : un fichier d'une page Studio aussi ({s})")
    for path in ("/", "/asset/", "/image/", "/chanson/", "/movie/"):
        s, _, _ = H("GET", path, cookie=A)
        ok(s == 200, f"Studio, compte Apps : {path} s'ouvre ({s})")
    # ses routes d'écriture, ses travaux : 403, et dit
    for method, path, body in (("POST", "/api/montage/projects", {"name": "x"}), ("POST", "/api/music/projects", {"name": "x"}),
                               ("POST", "/api/ideation/boards", {"name": "x"}), ("POST", "/api/analyse/projets", {"nom": "x"}),
                               ("POST", "/api/objet/objects", {"title": "x"}), ("POST", "/api/music/stems/separate", {}),
                               ("PUT", "/character/api/characters/essai/identity", {"name": "x"}),
                               ("POST", "/api/chanson/stems", {}), ("POST", "/api/chanson/odio", {})):
        s, d, _ = H(method, path, body, cookie=A, headers=same)
        ok(s == 403 and "Studio" in err(d), f"Studio, compte Apps : {method} {path} → 403 ({s} {err(d)[:60]})")
    for path in ("/api/montage/projects", "/api/music/projects", "/api/ideation/boards"):
        s, _, _ = H("GET", path, cookie=A)
        ok(s == 200, f"Studio, compte Apps : lire reste permis, {path} ({s})")
    jobs.set_mode(None, "paused")
    queued = []
    try:
        for kind in ("montage.export", "objet.mesh_factice", "music.stems", "ideation.export", "analyse.run"):
            if kind in jobs.HANDLERS:
                s, d, _ = H("POST", "/api/jobs", {"kind": kind, "params": {}}, cookie=A, headers=same)
                ok(s == 403 and "Studio" in err(d), f"Studio, compte Apps : le travail « {kind} » → 403 ({s} {err(d)[:50]})")
        if "movie.t2v" in jobs.HANDLERS:
            s, d, _ = H("POST", "/api/jobs", {"kind": "movie.t2v", "params": {"desc": ""}}, cookie=A, headers=same)
            ok(s == 400 and "Studio" not in err(d), f"Studio, compte Apps : un travail d'app passe la porte ({s} {err(d)[:50]})")
        # Asset, la bibliothèque commune : ouverte
        s, up, _ = H("PUT", "/api/library/upload?name=a.png&title=D%27Apolline", raw=png(), cookie=A,
                     headers={**same, "Content-Type": "image/png"})
        s2, d2, _ = H("POST", "/api/asset/move", {"ids": [up.get("id")], "folder": "Apolline"}, cookie=A, headers=same)
        s3, _, _ = H("GET", "/api/asset/trash", cookie=A)
        ok(s == 200 and s2 == 200 and s3 == 200, f"Studio, compte Apps : Asset s'ouvre (déposer, ranger, la corbeille) ({s} {s2} {s3})")

        # un compte Studio : tout s'ouvre
        s, _, _ = H("GET", "/montage/", cookie=S)
        s2, pj, _ = H("POST", "/api/montage/projects", {"name": "Séquence de Stéphane"}, cookie=S, headers=same)
        s3, ob, _ = H("POST", "/api/objet/objects", {"title": "Botte", "item": s_img["id"]}, cookie=S, headers=same)
        s4, j, _ = H("POST", "/api/jobs", {"kind": "objet.mesh_factice", "params": {"element": ob.get("id")}}, cookie=S, headers=same)
        queued.append(j.get("id") if isinstance(j, dict) else None)
        ok((s, s2, s3, s4) == (200, 200, 200, 200), f"Studio, compte Studio : page, écriture, travail ({s} {s2} {s3} {s4})")
        # Cal : tout
        s, _, _ = H("GET", "/ideation/", cookie=adm)
        s2, _, _ = H("POST", "/api/montage/projects", {"name": "Séquence de Cal"}, cookie=adm, headers=same)
        ok(s == 200 and s2 == 200, f"Studio, Cal : tout ({s} {s2})")
        s, body, _ = H("GET", auth.STUDIO_PAGE + "?outil=montage", cookie=S)   # urllib suit le 303
        ok(s == 200 and b"00_STUDIO" not in (body if isinstance(body, bytes) else b""),
           f"Studio : la page « réservé » appelée avec le Studio ramène à l'outil ({s})")

        # la demande : visible dans Admin, acceptée d'un clic → ouvert
        s, r1, _ = H("POST", "/api/auth/studio", {}, cookie=A, headers=same)
        s2, r2, _ = H("POST", "/api/chanson/studio/demande", {}, cookie=A, headers=same)
        ok(s == 200 and r1.get("ok") is False and r1.get("asked") and s2 == 200 and r2.get("asked") == r1["asked"],
           f"Studio : demander (la route du portail ; l'ancienne de l'app Musique est la même) ({s} {r1} {s2} {r2})")
        asked = r1.get("asked")
        s, me_, _ = H("GET", "/api/auth/me", cookie=A)
        ok(me_["user"].get("studio_asked") == asked, "Studio : /api/auth/me dit la demande qui attend")
        s, o, _ = H("GET", "/api/chanson/options", cookie=A)
        ok(s == 200 and o["studio"]["ok"] is False and o["studio"]["asked"] == asked, "Studio : l'app Musique lit la même vérité")
        s, r3, _ = H("POST", "/api/auth/studio", {}, cookie=S, headers=same)
        ok(r3.get("ok") is True and not auth.user("stephane").get("studio_request"), "Studio : qui l'a déjà ne demande rien")
        s, st, _ = H("GET", "/api/admin/state", cookie=adm)
        row = next((x for x in st.get("users", []) if x["id"] == "apolline"), {})
        ok(row.get("access") == "apps" and row.get("studio_asked") == asked, f"Studio : la demande est dans Admin ({row.get('studio_asked')})")
        s, me_, _ = H("GET", "/api/auth/me", cookie=adm)
        ok(me_.get("pending_requests", 0) >= 1, f"Studio : l'en-tête de Cal compte la demande ({me_.get('pending_requests')})")
        ok(any(e["event"] == "demande de Studio" and e.get("user") == "apolline" for e in auth.journal_tail(200)),
           "Studio : la demande est au journal")
        s, d, _ = H("POST", "/api/admin/users/apolline", {"access": "studio"}, cookie=adm, headers=same)
        ok(s == 200 and d.get("access") == "studio" and not auth.user("apolline").get("studio_request"),
           f"Studio : Cal accepte d'un clic ({s} {d})")
        s, _, _ = H("GET", "/montage/", cookie=A)
        s2, _, _ = H("POST", "/api/montage/projects", {"name": "Séquence d'Apolline"}, cookie=A, headers=same)
        s3, me_, _ = H("GET", "/api/auth/me", cookie=A)
        ok(s == 200 and s2 == 200 and me_["user"]["access"] == "studio" and "studio_asked" not in me_["user"],
           f"Studio : accepté → ouvert, sans recharger la session ({s} {s2})")
        # Ctrl+Z dans Admin : le contraire, sa demande comprise ; puis l'écarter
        s, d, _ = H("POST", "/api/admin/users/apolline", {"access": "apps", "studio_request": asked}, cookie=adm, headers=same)
        ok(s == 200 and d.get("access") == "apps" and d.get("studio_asked") == asked, f"Studio : annuler rend l'état d'avant ({s} {d})")
        s, d, _ = H("POST", "/api/admin/users/apolline", {"studio_request": None}, cookie=adm, headers=same)
        ok(s == 200 and "studio_asked" not in d, f"Studio : écarter la demande ({s} {d})")
        s, d, _ = H("POST", "/api/admin/users/apolline", {"access": "tout"}, cookie=adm, headers=same)
        s2, d2, _ = H("POST", "/api/admin/users/apolline", {"studio_request": "<script>"}, cookie=adm, headers=same)
        ok(s == 400 and s2 == 400, f"Studio : un accès ou une date mal formés sont refusés ({s} {s2})")
        s, d, _ = H("POST", "/api/admin/users/apolline", {"access": "studio"}, cookie=A, headers=same)
        ok(s == 403 and auth.user("apolline")["access"] == "apps", f"Studio : on ne s'ouvre pas le Studio soi-même ({s})")
        # la porte coupée : Cal, tout ouvert
        config.CFG["auth"] = False
        s, _, _ = H("GET", "/montage/")
        s2, me_, _ = H("GET", "/api/auth/me")
        ok(s == 200 and me_["user"]["access"] == "studio", f"Studio : la maison sans porte vaut Cal ({s})")
        config.CFG["auth"] = True
    finally:
        config.CFG["auth"] = True
        for jid in queued:
            try:
                jobs.cancel(jid)
            except (KeyError, TypeError):
                pass
        jobs.set_mode(None, "active")
