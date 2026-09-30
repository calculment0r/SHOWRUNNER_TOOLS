"""Teams et Workspaces : les routes (docs/etudes/equipes_espaces.md, étapes 0 et 7 ;
le modèle et la matrice : core/espaces.py). Hors de /api/admin/ : l'admin d'une
Team (pas seulement Cal) y règle la sienne ; chaque route juge qui gère quoi.

    GET  /api/equipes[?toutes=1]                         mes Teams, leurs Workspaces, mes droits ; pour qui gère,
                                                         les membres et les liens ; Cal : toutes (?toutes=1)
    POST /api/equipes {name}                             créer une Team (le Studio ; Cal : aussi `plan`)
    GET  /api/equipes/<t>                                une Team
    POST /api/equipes/<t> {name, api, archived, plan}    renommer, l'API payante, archiver / rouvrir, l'offre (Cal)
    POST /api/equipes/<t>/espaces {name, default_role}   créer un Workspace
    POST /api/equipes/<t>/membres {pseudo, role, guest, spaces}
                                                         mettre quelqu'un dans la Team (un pseudo neuf est créé,
                                                         déjà accepté) ; guest : viewer | acteur, ses Workspaces
    POST /api/equipes/<t>/membres/<id> {role, guest, spaces}   changer un rôle, le mode d'un guest (décision 2)
    POST /api/equipes/<t>/membres/<id>/retirer           retirer (ou partir soi-même)
    POST /api/equipes/<t>/invitations {role, guest, spaces, hours}   un lien (le jeton ne se montre qu'une fois)
    POST /api/equipes/<t>/invitations/<id>/retirer
    POST /api/espaces/courant {workspace}                le dernier Workspace de la personne (le sélecteur, étape 4)
    POST /api/espaces/<e> {name, default_role, archived}
    POST /api/espaces/<e>/membres/<id> {role}            le rôle d'un membre dans ce Workspace ; un guest : « guest »
                                                         (dedans) ou null (dehors)
    GET  /api/auth/equipe/<jeton>                        ce que dit un lien (sans session)
    POST /api/auth/equipe/<jeton>                        l'ouvrir : une session qui attend (pseudo neuf) passe
"""

from __future__ import annotations

from core import auth, espaces
from core.http import HttpError


def _who(req) -> dict:
    u = getattr(req, "user", None)
    if not u:
        raise HttpError(401, "connexion requise")
    return u


def r_list(req):
    u = _who(req)
    every = req.q("toutes") in ("1", "true") and auth.is_admin(u)
    return {"teams": espaces.teams_of(u, detail=True, everyone=every), "workspace": req.workspace,
            "roles": {"team": espaces.TEAM_FR, "space": espaces.SPACE_FR, "guest": espaces.GUEST_FR},
            "hours": list(espaces.HOURS), "can_create": auth.is_admin(u) or (auth.has_studio(u) and espaces._eligible(u))}


def r_create(req):
    u = _who(req)
    d = req.json()
    return espaces.create_team(u, d.get("name"), d.get("plan"))


def r_team(req, tid):
    return espaces.team_view(_who(req), tid)


def r_team_set(req, tid):
    d = req.json()
    return espaces.update_team(_who(req), tid, {k: d[k] for k in ("name", "plan", "api", "archived") if k in d})


def r_space_new(req, tid):
    d = req.json()
    return espaces.create_space(_who(req), tid, d.get("name"), d.get("default_role") or "editor")


def r_space_set(req, sid):
    d = req.json()
    return espaces.update_space(_who(req), sid, {k: d[k] for k in ("name", "default_role", "archived") if k in d})


def r_current(req):
    u = _who(req)
    sid = str(req.json().get("workspace") or "")
    return {"workspace": espaces.set_last(u, sid)}


def r_member_add(req, tid):
    d = req.json()
    return espaces.add_member(_who(req), tid, d.get("pseudo"), str(d.get("role") or "member"), d.get("guest"),
                              d.get("spaces"))


def r_member_set(req, tid, uid):
    d = req.json()
    return espaces.set_member(_who(req), tid, uid, {k: d[k] for k in ("role", "guest", "spaces") if k in d})


def r_member_remove(req, tid, uid):
    return espaces.remove_member(_who(req), tid, uid)


def r_space_member(req, sid, uid):
    d = req.json()
    if "role" not in d:
        raise HttpError(400, "le rôle : admin, editor, commenter, viewer, none, guest, ou null")
    return espaces.set_space_member(_who(req), sid, uid, d["role"])


def r_invite(req, tid):
    d = req.json()
    return espaces.create_invite(_who(req), tid, str(d.get("role") or "member"), d.get("guest"), d.get("spaces"),
                                 d.get("hours") or 72)


def r_invite_revoke(req, tid, iid):
    return espaces.revoke_invite(_who(req), tid, iid)


def r_invite_info(req, tok):
    auth._rate(f"invitation-equipe:{auth._ip(req)}", 60, 600)
    return espaces.invite_info(tok)


def r_redeem(req, tok):
    """Sous /api/auth/ : la porte laisse passer une session qui attend (un pseudo neuf
    tapé à la porte) ; le lien vaut l'accord de qui l'a fait."""
    auth._rate(f"invitation-equipe:{auth._ip(req)}", 30, 600)   # deviner un lien : 30 essais par 10 min
    if not auth.enabled():
        raise HttpError(409, "la porte est coupée sur ce portail (auth: false) : rien à rejoindre")
    _, _, u = auth.session_of(req)
    return espaces.redeem(u, tok)


def register(app) -> None:
    app.route("GET", "/api/equipes", r_list)
    app.route("POST", "/api/equipes", r_create)
    app.route("GET", "/api/equipes/{tid}", r_team)
    app.route("POST", "/api/equipes/{tid}", r_team_set)
    app.route("POST", "/api/equipes/{tid}/espaces", r_space_new)
    app.route("POST", "/api/equipes/{tid}/membres", r_member_add)
    app.route("POST", "/api/equipes/{tid}/membres/{uid}", r_member_set)
    app.route("POST", "/api/equipes/{tid}/membres/{uid}/retirer", r_member_remove)
    app.route("POST", "/api/equipes/{tid}/invitations", r_invite)
    app.route("POST", "/api/equipes/{tid}/invitations/{iid}/retirer", r_invite_revoke)
    app.route("POST", "/api/espaces/courant", r_current)   # avant /api/espaces/{sid} : le premier motif gagne
    app.route("POST", "/api/espaces/{sid}", r_space_set)
    app.route("POST", "/api/espaces/{sid}/membres/{uid}", r_space_member)
    app.route("GET", "/api/auth/equipe/{tok}", r_invite_info)
    app.route("POST", "/api/auth/equipe/{tok}", r_redeem)


# ── le contrôle (tools/check.py) ────────────────────────────
# La matrice du § 2.4 de l'étude, recopiée ici à la main (une seconde écriture, pas
# une relecture de MATRIX) : 1 = oui. Colonnes : les profils, dans l'ordre de PROFILES.
_COLS = ("viewer", "commenter", "guest_viewer", "guest_acteur", "editor", "space_admin", "team_admin", "portal_admin")
_ETUDE = {
    "view":           "11111111",
    "export_file":    "11111111",
    "comment":        "01011111",   # décision 2 : le guest viewer « voit seulement »
    "edit":           "00011111",
    "create":         "00011111",
    "import":         "00011111",
    "trash_own":      "00011111",
    "trash_any":      "00000111",
    "compute_cpu":    "00001111",   # décision 2 : un guest ne consomme JAMAIS de calcul (l'étude proposait le cpu)
    "compute_gpu":    "00001111",
    "compute_api":    "00001111",
    "publish":        "00001111",
    "export_package": "00001111",
    "invite_space":   "00000111",
    "manage_team":    "00000011",
    "admin_portal":   "00000001",
}


def selftest(call, ok) -> None:
    import hashlib
    import json
    import shutil
    import tempfile
    from pathlib import Path

    from core import config
    from tools.admin import essai_http as H

    # 1. la matrice écrite dans le code = celle de l'étude (et décision 2)
    ok(tuple(espaces.PROFILES) == _COLS, f"espaces : les profils ({espaces.PROFILES})")
    ok(set(espaces.MATRIX) == set(_ETUDE), f"espaces : les actions de la matrice ({sorted(espaces.MATRIX)})")
    for action, row in _ETUDE.items():
        got = "".join("1" if p in espaces.MATRIX.get(action, ()) else "0" for p in _COLS)
        ok(got == row, f"espaces : la matrice, « {action} » : {got} (étude : {row})")
    ok(not any(p.startswith("guest") for a in ("compute_cpu", "compute_gpu", "compute_api", "publish")
               for p in espaces.MATRIX[a]), "espaces : aucun guest ne calcule ni ne publie, par la table")

    before = {k: config.CFG.get(k) for k in ("auth", "equipes_guests_essai")}
    gardes = dict(espaces.GARDES)
    config.CFG["auth"] = True
    config.CFG.pop("equipes_guests_essai", None)
    espaces.GARDES.update(calcul=False, bibliotheque=False)
    auth.startup()
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    with auth._lock:
        auth._hits.clear()
    try:
        _http(ok, H, same)
        _migration(ok, tempfile, shutil, json, hashlib, Path)
    finally:
        config.CFG["auth"] = before["auth"]
        if before["equipes_guests_essai"] is None:
            config.CFG.pop("equipes_guests_essai", None)
        else:
            config.CFG["equipes_guests_essai"] = before["equipes_guests_essai"]
        espaces.GARDES.update(gardes)
        auth.set_current(None)
        auth.set_current_space(None)


def _http(ok, H, same) -> None:
    err = lambda d: d.get("error", "") if isinstance(d, dict) else str(d)[:80]   # noqa: E731
    _, d, adm = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
    ok(bool(adm), f"équipes : Cal entre ({d})")
    P = lambda path, body=None, tok=adm, hd=None: H("POST", path, body if body is not None else {}, cookie=tok,   # noqa: E731
                                                     headers={**same, **(hd or {})})
    G = lambda path, tok=adm, hd=None: H("GET", path, cookie=tok, headers=hd or {})   # noqa: E731

    # une Team : un Workspace « Général » à la naissance, Cal propriétaire
    s, t, _ = P("/api/equipes", {"name": "Studio Essai"})
    ok(s == 200 and t.get("owner") == "cal" and len(t.get("spaces", [])) == 1 and t["plan"] == "studio",
       f"équipes : Cal crée une Team, un Workspace à la naissance ({s} {err(t)})")
    tid = t["id"]
    s1 = t["spaces"][0]["id"]
    s, sp2, _ = P(f"/api/equipes/{tid}/espaces", {"name": "Client A"})
    ok(s == 200 and sp2.get("team") == tid, f"équipes : un second Workspace ({s} {err(sp2)})")
    s2 = sp2["id"]

    # un membre par son pseudo : créé, déjà accepté, sans le Studio du compte (la Team l'a)
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Ana Essai", "role": "member"})
    ok(s == 200 and d["added"]["created"], f"équipes : un pseudo neuf mis dans la Team ({s} {err(d)})")
    ana = auth.user("ana-essai")
    ok(ana and ana["state"] == "active" and ana["access"] == "apps" and ana.get("perso", True) is not False,
       f"équipes : il entre en tapant son pseudo, compte Apps, sa Team perso ({ana})")
    _, _, A = H("POST", "/api/auth/enter", {"name": "Ana Essai"}, headers=same)
    s, me, _ = G("/api/auth/me", A)
    names = sorted(x["name"] for x in me.get("teams", []))
    ok(s == 200 and names == ["Chez moi", "Studio Essai"] and (me.get("workspace") or {}).get("team") == tid,
       f"équipes : /api/auth/me rend ses Teams et le Workspace courant ({names}, {(me.get('workspace') or {}).get('id')})")

    # un guest : refusé tant que les gardes du calcul et de la bibliothèque ne sont pas là
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Gus Essai", "role": "guest", "guest": "viewer", "spaces": [s1]})
    ok(s == 409 and "garde" in err(d), f"équipes : pas de guest sans les gardes des étapes 1 et 2 ({s} {err(d)[:70]})")
    espaces.garde_prete("calcul")
    espaces.garde_prete("bibliotheque")
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Gus Essai", "role": "guest", "guest": "viewer", "spaces": [s1]})
    ok(s == 200, f"équipes : les gardes prêtes, un guest viewer ({s} {err(d)})")
    gus = auth.user("gus-essai")
    ok(gus and gus.get("perso") is False and gus["access"] == "apps", f"équipes : un guest n'a pas de « Chez moi » ({gus})")
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Gia Essai", "role": "guest", "guest": "acteur", "spaces": [s1]})
    ok(s == 200, f"équipes : un guest acteur ({s} {err(d)})")
    gia = auth.user("gia-essai")

    # la matrice, jouée sur de vraies personnes
    ana = auth.user("ana-essai")
    ok(espaces.can_view(gus, s1) and not espaces.can_comment(gus, s1) and not espaces.can_edit(gus, s1),
       "équipes : guest viewer — voit, ne commente ni ne modifie")
    ok(espaces.can_edit(gia, s1) and espaces.can_create(gia, s1) and espaces.can_comment(gia, s1),
       "équipes : guest acteur — modifie, crée, commente")
    for g, nm in ((gus, "viewer"), (gia, "acteur")):
        ok(not any(espaces.can_compute(g, s1, c) for c in ("cpu", "gpu", "api", "inconnu")) and not auth.can_compute(g, s1)
           and not espaces.can_publish(g, s1) and not espaces.can_invite(g, s1),
           f"équipes : guest {nm} — aucun calcul (cpu, gpu, api, inconnu), ne publie, n'invite")
        why = auth.compute_why(g, s1)
        ok(bool(why) and "guest" in why and "admin de la Team" in why, f"équipes : le refus dit pourquoi et à qui ({why})")
    ok(not espaces.can_view(gus, s2), "équipes : un guest ne voit que ses Workspaces")
    ok(espaces.can_edit(ana, s1) and espaces.can_compute(ana, s1, "gpu") and espaces.can_publish(ana, s1),
       "équipes : un membre éditeur modifie, calcule, publie")
    ok(not espaces.can_compute(ana, s1, "api") and "API" in (auth.compute_why(ana, s1, "api") or ""),
       "équipes : l'API payante coupée par défaut")
    s, d, _ = P(f"/api/equipes/{tid}", {"api": True})
    ok(s == 200 and espaces.can_compute(ana, s1, "api"), f"équipes : l'admin de la Team l'ouvre ({s})")
    ok(not espaces.can_invite(ana, s1), "équipes : un membre n'invite pas")

    # décision 2 : le guest passe acteur dans l'administration de la personne
    s, d, _ = P(f"/api/equipes/{tid}/membres/gus-essai", {"guest": "acteur"})
    gus = auth.user("gus-essai")
    ok(s == 200 and espaces.can_edit(gus, s1) and not espaces.can_compute(gus, s1, "cpu"),
       f"équipes : guest viewer → acteur : il modifie, ne calcule toujours pas ({s} {err(d)})")
    s, d, _ = P(f"/api/equipes/{tid}/membres/gus-essai", {"guest": "viewer"})
    ok(s == 200 and not espaces.can_edit(gus, s1), f"équipes : … et revient viewer ({s})")
    s, d, _ = P(f"/api/espaces/{s2}/membres/gus-essai", {"role": "guest"})
    ok(s == 200 and espaces.can_view(gus, s2), f"équipes : un guest mis dans un second Workspace ({s} {err(d)})")
    s, d, _ = P(f"/api/espaces/{s2}/membres/gus-essai", {"role": "editor"})
    ok(s == 400, f"équipes : un guest n'a pas de rôle de Workspace (viewer ou acteur se règle sur la personne) ({s})")
    s, d, _ = P(f"/api/espaces/{s2}/membres/gus-essai", {"role": None})
    ok(s == 200 and not espaces.can_view(gus, s2), f"équipes : … et sorti ({s})")

    # les rôles de Workspace d'un membre
    for role, want in (("viewer", (True, False, False, False)), ("commenter", (True, True, False, False)),
                       ("editor", (True, True, True, True)), ("admin", (True, True, True, True))):
        s, d, _ = P(f"/api/espaces/{s2}/membres/ana-essai", {"role": role})
        got = (espaces.can_view(ana, s2), espaces.can_comment(ana, s2), espaces.can_edit(ana, s2), espaces.can_compute(ana, s2))
        ok(s == 200 and got == want, f"équipes : membre {role} dans un Workspace → {got} ({s})")
    ok(espaces.can_invite(ana, s2) and not espaces.can_invite(ana, s1), "équipes : admin d'un Workspace : invite là, pas ailleurs")
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Hal Essai", "role": "guest", "spaces": [s2]}, tok=A)
    ok(s == 200, f"équipes : l'admin du Workspace y fait un guest ({s} {err(d)})")
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Ivo Essai", "role": "member"}, tok=A)
    ok(s == 403, f"équipes : … mais pas un membre de la Team ({s} {err(d)[:60]})")
    s, d, _ = P(f"/api/espaces/{s2}/membres/ana-essai", {"role": "none"})
    ok(s == 200 and not espaces.can_view(ana, s2), f"équipes : « none » : dehors ({s})")
    P(f"/api/espaces/{s2}/membres/ana-essai", {"role": None})
    ok(espaces.can_edit(ana, s2), "équipes : null : le rôle par défaut du Workspace revient")

    # une autre Team : invisible
    s, xav, _ = P("/api/admin/users", {"name": "Xav Essai", "access": "studio"})
    _, _, X = H("POST", "/api/auth/enter", {"name": "Xav Essai"}, headers=same)
    s, tx, _ = P("/api/equipes", {"name": "Autre Team"}, tok=X)
    ok(s == 200 and tx.get("owner") == "xav-essai", f"équipes : un compte Studio crée sa Team ({s} {err(tx)})")
    sx = tx["spaces"][0]["id"]
    s, d, _ = P("/api/equipes", {"name": "Pas de Studio"}, tok=A)
    ok(s == 403 and "Studio" in err(d), f"équipes : un compte Apps ne crée pas de Team (inviter est du Studio) ({s})")
    ok(not espaces.can_view(ana, sx) and not espaces.can_view(auth.user("xav-essai"), s1),
       "équipes : le Workspace d'une autre Team est invisible")
    s, d, _ = G(f"/api/equipes/{tx['id']}", A)
    ok(s == 404, f"équipes : une autre Team n'existe pas pour Ana ({s})")
    s, d, _ = G("/api/library", A, {"X-SR-Espace": sx})
    ok(s == 403 and "pas pour toi" in err(d), f"équipes : l'en-tête d'un Workspace d'une autre Team → 403 ({s} {err(d)[:60]})")
    s, d, _ = G(f"/api/library?e={sx}", A)
    ok(s == 403, f"équipes : … et ?e= aussi ({s})")
    s, me, _ = G("/api/auth/me", A, {"X-SR-Espace": sx})
    ok(s == 200 and me.get("workspace_refused") == sx and (me.get("workspace") or {}).get("id") != sx,
       f"équipes : /api/auth/me le dit sans tomber ({s} {me.get('workspace_refused')})")
    s, d, _ = G("/api/library", A, {"X-SR-Espace": "esp-../x"})
    ok(s == 403, f"équipes : un en-tête mal formé → 403 ({s})")
    s, me, _ = G("/api/auth/me", A, {"X-SR-Espace": s2})
    ok((me.get("workspace") or {}).get("id") == s2 and me["workspace"]["can"]["edit"] is True,
       f"équipes : l'en-tête choisit le Workspace courant ({(me.get('workspace') or {}).get('id')})")
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Zed", "role": "member"}, tok=X)
    ok(s == 404, f"équipes : on ne gère pas une Team où l'on n'est pas ({s})")
    s, d, _ = G("/api/equipes?toutes=1")
    ids = {x["id"] for x in d.get("teams", [])}
    ok(s == 200 and {tid, tx["id"], "tea-perso-xav-essai"} <= ids, f"équipes : Cal voit toutes les Teams ({len(ids)})")
    s, d, _ = G("/api/equipes?toutes=1", A)
    ok({x["id"] for x in d.get("teams", [])} == {tid, "tea-perso-ana-essai"}, "équipes : ?toutes=1 ne vaut que pour Cal")

    # le Studio passe à la Team : Ana (compte Apps) ouvre le Studio dans la Team Studio, pas chez elle
    perso = "esp-perso-ana-essai"
    s, _, _ = G("/montage/", A, {"X-SR-Espace": s1})
    s_, _, _ = G(f"/montage/?e={perso}", A)
    ok(s == 200 and s_ == 403, f"équipes : le droit Studio est celui de la Team du Workspace ({s} dans la Team, {s_} chez elle)")
    s, _, _ = P("/api/montage/projects", {"name": "Séquence d'Ana"}, tok=A, hd={"X-SR-Espace": s1})
    s_, d_, _ = P("/api/montage/projects", {"name": "x"}, tok=A, hd={"X-SR-Espace": perso})
    ok(s == 200 and s_ == 403 and "Studio" in err(d_), f"équipes : une écriture Studio suit le Workspace ({s}, {s_})")

    # le dernier Workspace (le sélecteur de l'étape 4)
    s, d, _ = P("/api/espaces/courant", {"workspace": s2}, tok=A)
    s_, me, _ = G("/api/auth/me", A)
    ok(s == 200 and (me.get("workspace") or {}).get("id") == s2, f"équipes : le dernier Workspace sert sans en-tête ({s})")
    s, d, _ = P("/api/espaces/courant", {"workspace": sx}, tok=A)
    ok(s == 404, f"équipes : on ne se pose pas dans un Workspace qu'on ne voit pas ({s})")

    # archiver : lecture seule ; jamais le dernier Workspace ouvert
    s, d, _ = P(f"/api/espaces/{s2}", {"archived": True})
    ok(s == 200 and espaces.can_view(ana, s2) and not espaces.can_edit(ana, s2) and not espaces.can_compute(ana, s2),
       f"équipes : un Workspace archivé se lit, ne se modifie plus ({s})")
    s, d, _ = P(f"/api/espaces/{s1}", {"archived": True})
    ok(s == 409 and "dernier" in err(d), f"équipes : le dernier Workspace ouvert ne s'archive pas ({s})")
    P(f"/api/espaces/{s2}", {"archived": False})
    s, d, _ = P(f"/api/espaces/{s2}", {"name": "Client A (renommé)"}, tok=A)
    ok(s == 403, f"équipes : un membre ne renomme pas un Workspace ({s})")

    # les rôles de Team : admin par le propriétaire seulement ; le propriétaire reste
    s, d, _ = P(f"/api/equipes/{tid}/membres/ana-essai", {"role": "admin"})
    ok(s == 200 and espaces.can_manage(auth.user("ana-essai"), tid), f"équipes : Cal fait Ana admin de la Team ({s})")
    s, d, _ = P(f"/api/equipes/{tid}/membres/cal", {"role": "member"}, tok=A)
    ok(s == 409, f"équipes : le propriétaire garde son rôle ({s})")
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Xav Essai", "role": "admin"}, tok=A)
    ok(s == 403, f"équipes : un admin ne fait pas d'admin (le propriétaire, Cal) ({s})")
    s, d, _ = P(f"/api/equipes/{tid}/membres/ana-essai", {"role": "member"})

    # les liens d'invitation
    s, inv, _ = P(f"/api/equipes/{tid}/invitations", {"role": "guest", "guest": "acteur", "spaces": [s1], "hours": 24})
    ok(s == 200 and "." in inv.get("token", ""), f"équipes : un lien d'invitation (guest acteur, 24 h) ({s} {err(inv)})")
    tok = inv["token"]
    s, info, _ = H("GET", f"/api/auth/equipe/{tok}")
    ok(s == 200 and info.get("team") == "Studio Essai" and info.get("guest") == "acteur",
       f"équipes : le lien se lit sans session ({s} {info})")
    real_ip = auth._ip
    auth._ip = lambda req: "203.0.113.77"   # une adresse à elle : les demandes d'avant (autres contrôles) ne comptent pas
    try:
        s, d, L = H("POST", "/api/auth/enter", {"name": "Léo Essai"}, headers=same)
        ok(d.get("state") == "pending", f"équipes : un pseudo neuf tapé à la porte : en attente ({s} {err(d)})")
        s, r, _ = H("POST", f"/api/auth/equipe/{tok}", {}, cookie=L, headers=same)
    finally:
        auth._ip = real_ip
    leo = auth.user("leo-essai")
    ok(s == 200 and r.get("accepted") and r.get("role") == "guest" and leo["state"] == "active" and leo.get("perso") is False
       and leo.get("access") == "apps", f"équipes : le lien accepte le pseudo, guest acteur, sans « Chez moi » ({s} {err(r)})")
    ok(espaces.can_edit(leo, s1) and not espaces.can_compute(leo, s1, "cpu"), "équipes : le guest du lien modifie, ne calcule pas")
    s, me, _ = G("/api/auth/me", L)
    ok(s == 200 and [x["name"] for x in me.get("teams", [])] == ["Studio Essai"], f"équipes : il ne voit que sa Team ({s})")
    s, d, _ = H("POST", f"/api/auth/equipe/{tok.split('.')[0]}.faux-faux-faux-faux-faux", {}, cookie=L, headers=same)
    ok(s == 404, f"équipes : un faux jeton ({s})")
    s, d, _ = P(f"/api/equipes/{tid}/invitations/{inv['id']}/retirer")
    s2_, d2, _ = H("POST", f"/api/auth/equipe/{tok}", {}, cookie=A, headers=same)
    ok(s == 200 and s2_ == 410, f"équipes : un lien retiré ne s'ouvre plus ({s}, {s2_})")
    s, d, _ = P(f"/api/equipes/{tid}/invitations", {"role": "member", "hours": 5})
    ok(s == 400, f"équipes : une durée hors liste est refusée ({s})")
    s, d, _ = P(f"/api/equipes/tea-perso-cal/invitations", {"role": "member", "hours": 24})
    ok(s == 409 and "personnelle" in err(d), f"équipes : « Chez moi » n'invite personne ({s})")

    # retirer ; partir
    s, d, _ = P(f"/api/equipes/{tid}/membres/gus-essai/retirer")
    ok(s == 200 and not espaces.can_view(auth.user("gus-essai"), s1), f"équipes : retiré, il ne voit plus rien ({s})")
    s, d, _ = P(f"/api/equipes/{tid}/membres/ana-essai/retirer", tok=A)
    ok(s == 200 and not espaces.team_role(auth.user("ana-essai"), tid), f"équipes : on part soi-même ({s})")
    s, d, _ = P(f"/api/equipes/{tid}/membres/cal/retirer")
    ok(s == 409, f"équipes : le propriétaire ne part pas ({s})")
    ok(any(e["event"] == "team : rôle" for e in auth.journal_tail(300)), "équipes : les gestes vont au journal")


def _migration(ok, tempfile, shutil, json, hashlib, Path) -> None:
    """La migration sur une copie jetable : ce qu'elle fait, deux passes = même résultat,
    rien de perdu, chaque objet et document dans Général."""
    root = Path(tempfile.mkdtemp(prefix="sr_migr_"))
    try:
        users = {"cal": {"id": "cal", "name": "Cal", "role": "admin", "state": "active"},
                 "nico": {"id": "nico", "name": "nico", "role": "ami", "state": "active", "access": "studio"},
                 "su": {"id": "su", "name": "su", "role": "ami", "state": "suspended", "access": "studio"},
                 "apo": {"id": "apo", "name": "apo", "role": "ami", "state": "active", "access": "apps"},
                 "gst": {"id": "gst", "name": "gst", "role": "invite", "state": "active"},
                 "pen": {"id": "pen", "name": "pen", "role": "ami", "state": "pending"}}
        (root / "auth.json").write_text(json.dumps({"users": users, "sessions": {}, "settings": {}}), encoding="utf-8")
        items = {"ima-20260930-100000-aaaa": {"kind": "image", "origin": {"user": "cal"}},
                 "vid-20260930-100000-bbbb": {"kind": "video", "origin": {}},   # d'avant la porte : à Cal
                 "seq-20260930-100000-cccc": {"kind": "sequence", "origin": {"user": "nico"}},
                 "ima-20260930-100000-dddd": {"kind": "image", "origin": {"user": "nico"}, "space": "esp-ailleurs"}}
        for iid, it in items.items():
            (root / "library" / iid).mkdir(parents=True)
            (root / "library" / iid / "item.json").write_text(json.dumps({"id": iid, "title": iid, **it}, indent=1), encoding="utf-8")
            (root / "library" / iid / "main.png").write_bytes(b"\x89PNG" + iid.encode())
        (root / "trash" / "aud-20260930-100000-eeee").mkdir(parents=True)
        (root / "trash" / "aud-20260930-100000-eeee" / "item.json").write_text(
            json.dumps({"id": "aud-20260930-100000-eeee", "kind": "audio", "origin": {"user": "cal"}}), encoding="utf-8")
        for sub, name, doc in (("musique", "mus-20260930-100000-ffff", {"owner": "nico", "tracks": [1, 2]}),
                               ("ideation", "ide-20260930-100000-9999", {"nodes": []}),
                               ("luts", "lut-20260930-100000-8888", {"owner": "cal", "size": 33})):
            (root / sub).mkdir(exist_ok=True)
            (root / sub / f"{name}.json").write_text(json.dumps({"id": name, **doc}, indent=1) + "\n", encoding="utf-8")
        (root / "musique" / "index.json").write_text('{"pas": "un document"}', encoding="utf-8")
        (root / "luts" / "lut-20260930-100000-8888.cube").write_text("LUT_3D_SIZE 33\n", encoding="utf-8")
        (root / "jobs.json").write_text(json.dumps([{"id": "job-1", "owner": "nico"}, {"id": "job-2", "owner": "cal"}]),
                                        encoding="utf-8")

        def snapshot() -> dict:
            out = {}
            for p in sorted(root.rglob("*")):
                if p.is_file() and "sauvegarde-espaces-" not in str(p):
                    out[str(p.relative_to(root))] = hashlib.sha256(p.read_bytes()).hexdigest()
            return out

        def loads(rel: str):
            return json.loads((root / rel).read_text(encoding="utf-8"))

        first = snapshot()
        before = {rel: loads(rel) for rel in first if rel.endswith(".json") and rel != "auth.json"}
        dry = espaces.migrate(root, dry=True)
        ok(snapshot() == first and not (root / "teams.json").exists() and len(dry["changed_files"]) == 9,
           f"migration : à blanc, rien n'est écrit ({len(dry['changed_files'])} fichiers à changer)")
        rep = espaces.migrate(root)
        db = loads("teams.json")
        nv = db["teams"].get("tea-nirvalab") or {}
        ok(nv.get("name") == "Nirvalab" and nv.get("plan") == "studio" and nv.get("owner") == "cal" and nv.get("api") is False,
           "migration : la Team Nirvalab, studio, propriétaire Cal, API coupée")
        ok((db["spaces"].get("esp-general") or {}).get("name") == "Général" and db["default"] == "esp-general",
           "migration : le Workspace Général, l'espace par défaut de l'instance")
        ok({k: v["role"] for k, v in nv["members"].items()} == {"cal": "owner", "nico": "member", "su": "member"},
           f"migration : les amis Studio membres (éditeurs de Général), pas le compte Apps ni l'invité ({nv['members']})")
        ok(sorted(rep["personal_created"]) == ["apo", "cal", "nico", "su"] and "tea-perso-gst" not in db["teams"],
           f"migration : une Team « Chez moi » par compte, pas pour l'invité de planche ({rep['personal_created']})")
        ok(loads("auth.json")["users"] == users, "migration : auth.json intact (l'access: studio reste)")
        after = snapshot()
        lost = [rel for rel in first if rel not in after]
        ok(not lost, f"migration : aucun fichier perdu ({lost})")
        changed = 0
        for rel, old in before.items():
            new = loads(rel)
            if rel == "jobs.json":
                ok(all(j["space"] == "esp-general" for j in new) and [{k: v for k, v in j.items() if k != "space"} for j in new] == old,
                   "migration : chaque travail de la file dans Général, rien d'autre ne change")
                changed += 1
                continue
            if isinstance(old, dict) and old.get("id") == Path(rel).stem or rel.endswith("item.json"):
                want = old.get("space") or "esp-general"
                rest = {k: v for k, v in new.items() if k != "space"}
                ok(new.get("space") == want and rest == {k: v for k, v in old.items() if k != "space"},
                   f"migration : {rel} → {new.get('space')}, rien d'autre ne change")
                changed += "space" not in old
            else:
                ok(new == old, f"migration : {rel} n'est pas un document : intact")
        ok(changed == 8 and rep["items"]["library"]["set"] == 3 and rep["items"]["library"]["elsewhere"] == 1
           and rep["items"]["library"]["unowned"] == 1 and rep["items"]["trash"]["set"] == 1,
           f"migration : le rapport compte juste ({changed} changés, {rep['items']})")
        ok(all(first[rel] == after[rel] for rel in first if rel.endswith((".png", ".cube"))), "migration : les médias intacts")
        bk = root / rep["backup"]
        ok(bk.is_dir() and (bk / "rapport.json").exists() and (bk / "fichiers.txt").read_text().count("\n") == 9,
           f"migration : sauvegarde et rapport ({rep['backup']})")
        rep2 = espaces.migrate(root)
        ok(rep2["nothing_to_do"] and snapshot() == after and len(list(root.glob("sauvegarde-espaces-*"))) == 1,
           f"migration : une seconde passe ne change rien ({rep2['changed_files']})")
        # un compte ajouté entre deux passes : il entre, rien d'autre ne bouge
        u2 = loads("auth.json")
        u2["users"]["mehdi"] = {"id": "mehdi", "name": "mehdi", "role": "ami", "state": "active", "access": "studio"}
        (root / "auth.json").write_text(json.dumps(u2), encoding="utf-8")
        rep3 = espaces.migrate(root)
        db3 = loads("teams.json")
        ok(rep3["members_added"] == [{"id": "mehdi", "role": "member", "space_role": "editor"}]
           and rep3["changed_files"] == ["teams.json"] and db3["teams"]["tea-nirvalab"]["created"] == nv["created"],
           f"migration : un ami de plus, rien d'autre ({rep3['changed_files']})")
    finally:
        shutil.rmtree(root, ignore_errors=True)
