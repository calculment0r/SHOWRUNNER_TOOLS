"""Teams et Workspaces : les routes (docs/etudes/equipes_espaces.md, étapes 0 et 7 ;
le modèle et la matrice : core/espaces.py). Hors de /api/admin/ : l'admin d'une
Team (pas seulement Cal) y règle la sienne ; chaque route juge qui gère quoi.

    GET  /api/equipes[?toutes=1]                         mes Teams, leurs Workspaces, mes droits ; pour qui gère,
                                                         les membres et les liens ; Cal : toutes (?toutes=1) ;
                                                         `can_create` / `create_why` : créer une Team, ou pourquoi pas
    GET  /api/equipes/personnes                          qui l'on peut mettre dans une Team neuve (« Commencer un
                                                         projet ») : Cal, tous les comptes actifs ; un autre, les
                                                         membres de ses Teams (espaces.people_for)
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
    POST /api/espaces/<e>/rapatrier {items, folder?}     rapatrier des objets d'autres Workspaces dans <e> (étape 5,
                                                         § 3.2) : une copie neuve chacun (core/library.py, rapatrier) ;
                                                         rend {items: les copies, dans l'ordre, earlier: combien
                                                         de copies de chacun <e> avait déjà} ; une LUT du Montage
                                                         (`lut-…`) aussi : son .cube copié, une LUT neuve (`luts`)
    GET  /api/auth/equipe/<jeton>                        ce que dit un lien (sans session)
    POST /api/auth/equipe/<jeton>                        l'ouvrir : une session qui attend (pseudo neuf) passe

  Détruire (D4, décisions de Cal du 09/10 ; core/espaces.py, destroy_space / destroy_team) — ce qu'ils
  tenaient va à la corbeille, Cal le rend :
    POST /api/espaces/<e>/detruire {nom}                 un Workspace : qui gère sa Team, ou Cal ; jamais Général ni
                                                         le dernier ouvert d'une Team ; `nom` : son nom, tapé
    POST /api/equipes/<t>/detruire {nom}                 une Team : son propriétaire, ou Cal ; jamais une My Team ni
                                                         Nirvalab ; ses Workspaces détruits, ses membres sortis, ses
                                                         liens retirés, son budget effacé
    GET  /api/admin/detruits                             (Cal) la corbeille des Workspaces détruits
    POST /api/admin/detruits/<e>/rendre {vers?}          (Cal) le rendre, le même, dans la My Team de `vers` (par
                                                         défaut son auteur s'il existe encore, sinon Cal)
  Le grand ménage (D7, « fresh start », Cal) :
    GET  /api/admin/menage                               l'aperçu, sur les données réelles : les comptes créés par une
                                                         Team, les Teams partagées, les appartenances à retirer, les
                                                         Teams personnelles à renommer « My Team »
    POST /api/admin/menage {comptes, teams, retirer_membres, renommer, confirme: "MENAGE"}
                                                         l'appliquer ; rend le rapport (journalisé)

  Le budget (étape 8 ; la réservation et conso.jsonl : core/jobs.py) :
    GET  /api/budget                                     la consommation du mois de la Team du Workspace
                                                         courant (l'accueil) ; un guest : rien (il ne calcule pas)
    GET  /api/equipes/<t>/budget                         la même, d'une Team ; qui gère : par personne, par Workspace
    POST /api/equipes/<t>/budget {gpu_s, api_credits, users: {uid: {gpu_s, api_credits} | null},
                                  spaces: {sid: …}}      le régler : le propriétaire, un admin de la Team, ou Cal
                                                         (My Team : Cal) ; gpu_s vide = illimité
"""

from __future__ import annotations

from core import auth, espaces, jobs
from core.http import HttpError


def _who(req) -> dict:
    u = getattr(req, "user", None)
    if not u:
        raise HttpError(401, "connexion requise")
    return u


def r_list(req):
    u = _who(req)
    every = req.q("toutes") in ("1", "true") and auth.is_admin(u)
    teams = espaces.teams_of(u, detail=True, everyone=every)
    for t in teams:   # le budget du mois (étape 8) : ses membres le voient, qui gère le règle ; un guest, rien
        if t.get("manage") or t.get("role") in ("owner", "admin", "member"):
            t["conso"] = _budget_out(u, t["id"])
    why = espaces.create_team_why(u)   # la phrase du refus, dite avant qu'on ne remplisse (ideation/projet.js)
    return {"teams": teams, "workspace": req.workspace,
            "roles": {"team": espaces.TEAM_FR, "space": espaces.SPACE_FR, "guest": espaces.GUEST_FR},
            "hours": list(espaces.HOURS), "can_create": why is None, "create_why": why}


def r_people(req):
    """Qui l'on peut mettre dans une Team neuve : des comptes qui existent (core/espaces.py, people_for)."""
    return espaces.people_for(_who(req))


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


def r_rapatrier(req, sid):
    """Rapatrier : lire l'objet où il est (le voir : library.see), créer dans <sid> (la
    matrice, `import`). Tout ou rien ; jamais un lien vivant (core/library.py). Un élément
    versionné : un élément neuf dont la v1 est sa version figée — `versions: {élément: n}`,
    sinon la dernière prête (équipes_espaces.md § 3.3, a) ; `avec_source` (le Studio) : sa
    source copiée aussi, l'élément neuf vit dessus (b). Une séquence, une playlist : avec ce
    qu'elles posent (§ 3.5, server/tools/elements.py)."""
    from core import library
    u = _who(req)
    d = req.json()
    ids = d.get("items")
    if not isinstance(ids, list) or not ids or len(ids) > library.IMPORT_MAX or not all(isinstance(i, str) for i in ids):
        raise HttpError(400, f"items : la liste des objets à rapatrier ({library.IMPORT_MAX} au plus)")
    versions = d.get("versions") or {}
    if not isinstance(versions, dict) or len(versions) > library.IMPORT_MAX \
            or not all(isinstance(k, str) and isinstance(n, int) and not isinstance(n, bool) and n > 0 for k, n in versions.items()):
        raise HttpError(400, "versions : {élément: n}, la version figée de chaque élément versionné (sinon sa dernière)")
    avec_source = d.get("avec_source", False)
    if not isinstance(avec_source, bool):
        raise HttpError(400, "avec_source : vrai ou faux (un élément versionné : sa source copiée aussi — le Studio)")
    folder = d.get("folder") or ""
    if not isinstance(folder, str) or len(folder) > 60 or "/" in folder:
        raise HttpError(400, "folder : un nom de dossier (60 signes, sans « / »)")
    folder = " ".join(folder.split())
    if not espaces.can_view(u, sid):
        raise HttpError(404, f"Workspace {sid} : inconnu, ou pas pour toi")
    lut_ids = [i for i in dict.fromkeys(ids) if i.startswith("lut-")]
    ids = [i for i in dict.fromkeys(ids) if not i.startswith("lut-")]
    library.check_import(sid)
    luts = _luts_to_import(lut_ids, sid)   # jugées avant toute copie : tout ou rien
    earlier = {}
    for i in ids:
        src = library.see(i)
        if src is not None:
            earlier[i] = len(library.copies_of(src, sid))
    try:
        made = library.rapatrier(ids, sid, folder=folder, versions=versions, avec_source=avec_source) if ids else []
    except KeyError as e:
        raise HttpError(404, f"introuvable : {str(e).strip(chr(39))}") from e
    except ValueError as e:
        raise HttpError(409, str(e)) from e
    made_luts = [_import_lut(m, sid) for m in luts]
    auth.journal("asset : rapatrier", space=sid, items=[{"from": ((x.get("origin") or {}).get("from") or {}).get("item"),
                                                          "to": x["id"]} for x in made]
                 + [{"from": m["from"]["item"], "to": m["id"]} for m in made_luts])
    from tools import montage
    return {"items": [library.public(x) for x in made], "luts": [montage._lut_public(m) for m in made_luts],
            "space": sid, "space_name": library.space_name(sid), "earlier": sum(1 for v in earlier.values() if v)}


# Une LUT du Montage (server/tools/montage.py : `<data>/luts/<id>.cube` et `<id>.json`, avec
# `owner` et `space`) se rapatrie comme un objet : une LUT neuve dans B (un autre id), son
# .cube copié (quelques centaines de Ko, jamais réécrit ; une copie pleine suffit), `from`
# dit d'où elle vient ; l'original ne bouge pas. Les vignettes (`mini/`) se refont à la demande.
def _luts_to_import(lids: list[str], sid: str) -> list[dict]:
    from core import library
    from tools import montage
    out = []
    for lid in lids:
        m = montage.lut_meta(lid)
        if not m or not (montage._luts_dir() / f"{lid}.cube").exists() or not library.visible(m):
            raise HttpError(404, f"introuvable : {lid}")
        if library.space_of(m) == sid:
            raise HttpError(409, f"la LUT « {m.get('title') or lid} » est déjà dans « {library.space_name(sid)} » : rien à rapatrier")
        out.append(m)
    return out


def _import_lut(m: dict, sid: str) -> dict:
    import json
    import secrets
    import shutil
    import time

    from core import library
    from tools import montage
    d = montage._luts_dir()
    while True:
        lid = f"lut-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"
        if not (d / f"{lid}.json").exists():
            break
    shutil.copyfile(d / f"{m['id']}.cube", d / f"{lid}.cube")
    at = library.now()
    meta = {**{k: v for k, v in m.items() if k not in ("id", "space", "owner", "created", "fav", "from")},
            "id": lid, "created": at, "fav": 0, "owner": auth.current_id(), "space": sid,
            "from": {"space": library.space_of(m), "item": m["id"], "at": at}}
    tmp = d / f"{lid}.json.tmp"
    tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(d / f"{lid}.json")
    return meta


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


# ── détruire (D4) ───────────────────────────────────────────
def r_space_destroy(req, sid):
    return espaces.destroy_space(_who(req), sid, req.json().get("nom"))


def r_team_destroy(req, tid):
    return espaces.destroy_team(_who(req), tid, req.json().get("nom"))


def _cal(req) -> dict:
    """Les routes de Cal (sous /api/admin/ : la porte les refuse déjà à qui n'est pas admin) ; revérifié ici."""
    u = _who(req)
    if not auth.is_admin(u):
        raise HttpError(403, "réservé à Cal")
    return u


def r_destroyed(req):
    _cal(req)
    return {"spaces": espaces.destroyed_list()}


def r_restore(req, sid):
    u = _cal(req)
    vers = req.json().get("vers")
    if vers is not None and not isinstance(vers, str):
        raise HttpError(400, "vers : l'identifiant de la personne dont la My Team le reçoit")
    return espaces.restore_space(u, sid, vers or None)


# ── le grand ménage (D7, décision de Cal du 09/10 : « fresh start ») ──
# « tous les gens qui se loguent n'ont que leur espace vierge ; tu laisses quand même ce que les gens
# ont fait dans leur espace ». L'aperçu est calculé sur les données réelles ; l'application refait
# chaque jugement (un compte qui n'est pas d'atelier, une Team qui ne se détruit pas : 400, rien n'est
# fait), puis, dans cet ordre : détruit les Teams cochées (D4 : leur contenu à la corbeille), supprime
# les comptes cochés (le chemin d'Admin → Personnes : admin.supprimer_compte), retire de chaque Team
# restante ceux qui ne la possèdent pas, renomme les « Chez moi » d'avant. Jamais Cal ni un admin du
# portail : ni supprimés, ni retirés. Les My Team et ce qu'elles tiennent restent.
MENAGE_MOT = "MENAGE"


def _spared(uid: str) -> bool:
    """Le ménage ne touche jamais Cal ni un admin du portail."""
    return uid == auth.admin_id() or auth.is_admin(auth.user(uid))


def menage_preview(u) -> dict:
    """(a) les comptes créés par une Team (`via: "equipe"`, auth.create_invited : l'atelier du 07/10),
    leur date, qui les a faits, leurs Teams ; (b) les Teams partagées : propriétaire, membres,
    Workspaces, contenu ; (c) les appartenances à retirer (toute personne autre que le propriétaire,
    sauf un admin du portail) ; (d) les Teams personnelles à renommer « My Team ». `suggest` : ce que
    la page coche d'avance — les comptes ; une Team que ses membres (hors propriétaire) quittent tous
    avec ces comptes (au moins un, ou son propriétaire en est)."""
    teams = espaces.teams_of(u, detail=True, everyone=True)
    where: dict[str, list] = {}
    for t in teams:
        for m in t.get("members") or []:
            if m["id"] != t["owner"] or not t["personal"]:   # sa propre My Team n'est pas une Team « où on l'a mis »
                where.setdefault(m["id"], []).append({"id": t["id"], "name": espaces.label_of(t, None), "role": m["role"]})
    comptes = []
    for x in auth.users_public():
        if x.get("via") != "equipe" or x.get("state") == "pending" or _spared(x["id"]):
            continue
        by = (auth.user(x["id"]) or {}).get("by")
        comptes.append({"id": x["id"], "name": x["name"], "pseudo": x["pseudo"], "state": x["state"], "guest": not x.get("perso"),
                        "created": x.get("accepted") or x.get("created"), "by": by, "by_name": auth.display_name(by),
                        "items": 0, "teams": where.get(x["id"], [])})
    cand = {c["id"] for c in comptes}
    shared = [t for t in teams if not t["personal"]]
    content = espaces.content_of({s["id"] for t in shared for s in t["spaces"]})
    mine = espaces.content_of({espaces.personal_space_id(c["id"]) for c in comptes})
    for c in comptes:   # ce qu'ils ont fait chez eux (leur My Team) : ça reste
        k = mine.get(espaces.personal_space_id(c["id"])) or {}
        c["items"] = k.get("objets", 0) + sum((k.get("documents") or {}).values())
    rows = []
    for t in shared:
        others = [m for m in t.get("members") or [] if m["id"] != t["owner"]]
        cs = [content.get(s["id"]) or {} for s in t["spaces"]]
        rows.append({"id": t["id"], "name": t["name"], "owner": t["owner"], "owner_name": t["owner_name"],
                     "archived": t["archived"], "plan": t["plan"],
                     "members": [{"id": m["id"], "name": m["name"], "role": m["role"], "candidate": m["id"] in cand} for m in others],
                     "spaces": [{"id": s["id"], "name": s["name"], "archived": s["archived"]} for s in t["spaces"]],
                     "objets": sum(c.get("objets", 0) for c in cs), "octets": sum(c.get("octets", 0) for c in cs),
                     "documents": sum(sum((c.get("documents") or {}).values()) for c in cs),
                     "destroy": t["destroy"], "destroy_why": t["destroy_why"],
                     "suggest": bool(t["destroy"] and all(m["id"] in cand for m in others) and (others or t["owner"] in cand))})
    membres = [{"team": t["id"], "team_name": espaces.label_of(t, None), "id": m["id"], "name": m["name"], "role": m["role"]}
               for t in teams for m in t.get("members") or [] if m["id"] != t["owner"] and m["role"] != "owner" and not _spared(m["id"])]
    spared = sorted({m["name"] for t in teams for m in t.get("members") or [] if m["id"] != t["owner"] and _spared(m["id"])})
    # les invités qui attendent Cal (D5) ne sont pas des comptes du ménage : Admin → Demandes les valide ou les refuse
    attente = [{"id": x["id"], "name": x["name"], "by_name": auth.display_name((x.get("invited") or {}).get("by"))}
               for x in auth.users_public() if x.get("state") == "pending" and x.get("invited")]
    return {"comptes": sorted(comptes, key=lambda c: (c["created"] or "", c["name"].lower())), "teams": rows,
            "membres": membres, "epargnes": spared, "renommer": espaces.rename_personal(dry=True), "attente": attente,
            "mot": MENAGE_MOT}


def r_menage(req):
    return menage_preview(_cal(req))


def r_menage_apply(req):
    """Le ménage : tout est jugé avant le premier geste (tout ou rien pour les refus) ; le rapport dit
    ce qui a été fait, et ce qui a échoué en route (rien ne s'annule : la corbeille rend les Workspaces)."""
    from tools import admin
    u = _cal(req)
    d = req.json()
    if d.get("confirme") != MENAGE_MOT:
        raise HttpError(400, f"le ménage ne part que confirmé : tape {MENAGE_MOT}")
    comptes, teams = d.get("comptes", []), d.get("teams", [])
    for k, v in (("comptes", comptes), ("teams", teams)):
        if not isinstance(v, list) or len(v) > 2000 or not all(isinstance(x, str) for x in v):
            raise HttpError(400, f"{k} : une liste d'identifiants")
    for k in ("retirer_membres", "renommer"):
        if not isinstance(d.get(k, False), bool):
            raise HttpError(400, f"{k} : vrai ou faux")
    comptes, teams = list(dict.fromkeys(comptes)), list(dict.fromkeys(teams))
    plan = menage_preview(u)
    spared = [x for x in comptes if _spared(x)]
    if spared:
        raise HttpError(400, "le ménage ne supprime jamais Cal ni un admin du portail : " + ", ".join(auth.display_name(x) for x in spared))
    cand = {c["id"] for c in plan["comptes"]}
    bad = [x for x in comptes if x not in cand]
    if bad:
        raise HttpError(400, "pas des comptes créés par une Team (ceux-là se suppriment dans Admin → Personnes) : "
                        + ", ".join(auth.display_name(x) or x for x in bad[:8]))
    rows = {t["id"]: t for t in plan["teams"]}
    badt = [x for x in teams if not (rows.get(x) or {}).get("destroy")]
    if badt:
        raise HttpError(400, "ces Teams ne se détruisent pas : " + " ; ".join(
            f"{rows[x]['name']} ({rows[x]['destroy_why']})" if x in rows else f"{x} (pas une Team partagée)" for x in badt[:8]))
    rep: dict = {"teams": [], "comptes": [], "membres": [], "renommees": [], "erreurs": []}
    for tid in teams:
        try:
            r = espaces.destroy_team(u, tid, typed=False)["destroyed"]
            rep["teams"].append({"id": tid, "name": r["name"], "spaces": len(r["spaces"]), "objets": r["objets"]})
        except HttpError as e:
            rep["erreurs"].append(f"Team {rows[tid]['name']} : {e.message}")
    for uid in comptes:
        try:
            r = admin.supprimer_compte(uid, u["id"])
            rep["comptes"].append({"id": uid, "name": r["name"]})
        except HttpError as e:
            rep["erreurs"].append(f"compte {auth.display_name(uid) or uid} : {e.message}")
    if d.get("retirer_membres"):
        rep["membres"] = espaces.strip_members(spare=_spared)
    if d.get("renommer"):
        rep["renommees"] = espaces.rename_personal()
    auth.journal("ménage", user=u["id"], comptes=[x["id"] for x in rep["comptes"]], teams=[x["id"] for x in rep["teams"]],
                 membres=len(rep["membres"]), renommees=len(rep["renommees"]), erreurs=rep["erreurs"])
    return rep


# ── le budget ───────────────────────────────────────────────
GUEST_BUDGET_WHY = "guest : tu ne lances pas de calcul — la consommation de la Team est à ses membres"


def _budget_out(u, tid: str, space: str | None = None) -> dict:
    manage = espaces.can_manage(u, tid)
    out = jobs.budget_view(tid, u, space, detail=manage)
    t = espaces.team(tid) or {}
    if t:   # le nom pour la personne : la My Team d'un autre dit à qui elle est (l'accueil, sa pastille GPU)
        out["label"] = espaces.label_of(t, (u or {}).get("id"))
    out["manage"] = manage and (not t.get("personal") or auth.is_admin(u))
    if manage and not out["manage"]:
        out["manage_why"] = "le budget de My Team : Cal le règle"
    return out


def _member_or_404(u, tid: str) -> None:
    """Le budget d'une Team : ses membres (pas ses guests) et qui la gère ; les autres : 404."""
    role = espaces.team_role(u, tid)
    if espaces.team(tid) is None or not (espaces.can_manage(u, tid) or role in ("owner", "admin", "member")):
        if role == "guest":
            raise HttpError(403, GUEST_BUDGET_WHY)
        raise HttpError(404, f"Team inconnue : {tid}")


def r_budget_here(req):
    u = _who(req)
    sp = getattr(req, "workspace", None) or auth.current_space()
    tid = espaces.team_of_space(sp)
    if not tid:
        return {"team": None, "why": "aucun Workspace : rien à compter"}
    if espaces.team_role(u, tid) == "guest" and not auth.is_admin(u):
        return {"team": tid, "hidden": True, "why": GUEST_BUDGET_WHY}
    _member_or_404(u, tid)
    return _budget_out(u, tid, sp)


def r_budget(req, tid):
    u = _who(req)
    _member_or_404(u, tid)
    return _budget_out(u, tid)


def r_budget_set(req, tid):
    u = _who(req)
    d = req.json()
    espaces.set_budget(u, tid, {k: d[k] for k in ("gpu_s", "api_credits", "users", "spaces") if k in d})
    return _budget_out(u, tid)


def register(app) -> None:
    app.route("GET", "/api/budget", r_budget_here)
    app.route("GET", "/api/equipes/{tid}/budget", r_budget)
    app.route("POST", "/api/equipes/{tid}/budget", r_budget_set)
    app.route("GET", "/api/equipes", r_list)
    app.route("GET", "/api/equipes/personnes", r_people)   # avant /api/equipes/{tid} : le premier motif gagne
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
    app.route("POST", "/api/espaces/{sid}/rapatrier", r_rapatrier)
    app.route("GET", "/api/auth/equipe/{tok}", r_invite_info)
    app.route("POST", "/api/auth/equipe/{tok}", r_redeem)
    app.route("POST", "/api/espaces/{sid}/detruire", r_space_destroy)
    app.route("POST", "/api/equipes/{tid}/detruire", r_team_destroy)
    app.route("GET", "/api/admin/detruits", r_destroyed)
    app.route("POST", "/api/admin/detruits/{sid}/rendre", r_restore)
    app.route("GET", "/api/admin/menage", r_menage)
    app.route("POST", "/api/admin/menage", r_menage_apply)


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
        _validation(ok, H, same)
        _depart(ok, H, same)
        _budget(ok, H, same)
        _my_team(ok, H, same)
        _detruire(ok, H, same)
        _menage(ok, H, same)
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
    ok(s == 200 and names == ["My Team", "Studio Essai"] and (me.get("workspace") or {}).get("team") == tid,
       f"équipes : /api/auth/me rend ses Teams et le Workspace courant ({names}, {(me.get('workspace') or {}).get('id')})")

    # un guest : refusé tant que les gardes du calcul et de la bibliothèque ne sont pas là
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Gus Essai", "role": "guest", "guest": "viewer", "spaces": [s1]})
    ok(s == 409 and "garde" in err(d), f"équipes : pas de guest sans les gardes des étapes 1 et 2 ({s} {err(d)[:70]})")
    espaces.garde_prete("calcul")
    espaces.garde_prete("bibliotheque")
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Gus Essai", "role": "guest", "guest": "viewer", "spaces": [s1]})
    ok(s == 200, f"équipes : les gardes prêtes, un guest viewer ({s} {err(d)})")
    gus = auth.user("gus-essai")
    ok(gus and gus.get("perso") is False and gus["access"] == "apps", f"équipes : un guest n'a pas de My Team ({gus})")
    _, _, gus_tok = H("POST", "/api/auth/enter", {"name": "Gus Essai"}, headers=same)
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
    ok(s == 200 and (d.get("added") or {}).get("pending") is True,
       f"équipes : l'admin du Workspace y fait un guest — un pseudo neuf, qui attend Cal (D5) ({s} {err(d)})")
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Ivo Essai", "role": "member"}, tok=A)
    ok(s == 403, f"équipes : … mais pas un membre de la Team ({s} {err(d)[:60]})")
    # D3 (Cal, 09/10) : un membre voit tous les Workspaces de sa Team — « none » (sur invitation) ne se pose plus,
    # et un « none » d'avant vaut lecteur
    s, d, _ = P(f"/api/espaces/{s2}/membres/ana-essai", {"role": "none"})
    s2_, d2, _ = P(f"/api/espaces/{s2}", {"default_role": "none"})
    s3_, d3, _ = P(f"/api/equipes/{tid}/espaces", {"name": "Caché", "default_role": "none"})
    ok(s == 400 and s2_ == 400 and s3_ == 400 and "voit tous ses Workspaces" in err(d2) and espaces.can_edit(ana, s2),
       f"équipes : « none » refusé partout, la phrase dit pourquoi (D3) ({s} {s2_} {s3_} {err(d2)[:60]})")
    with espaces._lock:   # un rôle « none » d'avant le 09/10, dans le fichier
        espaces._data()["spaces"][s2]["members"]["ana-essai"] = {"role": "none"}
        espaces._save()
    ok(espaces.can_view(ana, s2) and not espaces.can_comment(ana, s2) and espaces.space_role(ana, s2) == "viewer",
       "équipes : un « none » d'avant vaut lecteur : le membre voit le Workspace (D3)")
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

    # « Commencer un projet » (ideation/projet.js) : qui crée une Team le sait avant de remplir, et
    # la phrase est celle du refus ; qui l'on peut y mettre (des comptes qui existent déjà)
    s, d, _ = G("/api/equipes")
    ok(s == 200 and d.get("can_create") is True and d.get("create_why") is None, f"équipes : Cal crée des Teams ({s} {d.get('create_why')})")
    s, d, _ = G("/api/equipes", A)
    why = d.get("create_why") or ""
    s_, d_, _ = P("/api/equipes", {"name": "Projet d'Ana"}, tok=A)
    ok(s == 200 and d.get("can_create") is False and "Studio" in why and s_ == 403 and err(d_) == why,
       f"équipes : un compte Apps (le Studio par sa Team) l'apprend avant, la même phrase que le refus ({why})")
    s, d, _ = G("/api/equipes", gus_tok)
    ok(s == 200 and d.get("can_create") is False and "guest" in (d.get("create_why") or ""),
       f"équipes : un guest ne crée pas de Team, et le dit ({d.get('create_why')})")
    s, d, _ = G("/api/equipes/personnes")
    ids = [x["id"] for x in d.get("people", [])]
    ok(s == 200 and d.get("scope") == "tous" and {"ana-essai", "xav-essai", "gus-essai"} <= set(ids) and "cal" not in ids
       and next(x for x in d["people"] if x["id"] == "ana-essai")["teams"] == ["Studio Essai"],
       f"équipes : Cal voit tous les comptes actifs, pas lui-même ({s} {len(ids)})")
    s, d, _ = G("/api/equipes/personnes", A)
    ids = [x["id"] for x in d.get("people", [])]
    ok(s == 200 and d.get("scope") == "mes-teams" and "cal" in ids and "gus-essai" in ids and "xav-essai" not in ids
       and "ana-essai" not in ids and d.get("why"),
       f"équipes : un membre voit les gens de ses Teams, pas les autres comptes ({ids})")
    s, d, _ = G("/api/equipes/personnes", gus_tok)
    ok(s == 200 and d.get("people") == [] and d.get("why"), f"équipes : un guest ne voit personne à ajouter ({s} {d.get('people')})")
    s, d, _ = H("GET", "/api/equipes/personnes")
    ok(s == 401, f"équipes : sans session, pas d'annuaire ({s})")

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
       and leo.get("access") == "apps", f"équipes : le lien accepte le pseudo, guest acteur, sans My Team ({s} {err(r)})")
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
    s, d, _ = P("/api/equipes/tea-perso-ana-essai/invitations", {"role": "member", "hours": 24})
    ok(s == 409 and "My Team" in err(d) and "Apps" in err(d) and "Studio" in err(d),
       f"équipes : la My Team d'un compte Apps n'invite personne, Cal compris (D2) ({s} {err(d)[:80]})")

    # retirer ; partir
    s, d, _ = P(f"/api/equipes/{tid}/membres/gus-essai/retirer")
    ok(s == 200 and not espaces.can_view(auth.user("gus-essai"), s1), f"équipes : retiré, il ne voit plus rien ({s})")
    s, d, _ = P(f"/api/equipes/{tid}/membres/ana-essai/retirer", tok=A)
    ok(s == 200 and not espaces.team_role(auth.user("ana-essai"), tid), f"équipes : on part soi-même ({s})")
    s, d, _ = P(f"/api/equipes/{tid}/membres/cal/retirer")
    ok(s == 409, f"équipes : le propriétaire ne part pas ({s})")
    ok(any(e["event"] == "team : rôle" for e in auth.journal_tail(300)), "équipes : les gestes vont au journal")


def _validation(ok, H, same) -> None:
    """D5 (Cal, 09/10) : un pseudo neuf qu'un autre que Cal met dans sa Team — par son pseudo, ou par le
    lien d'une Team — attend la validation de Cal : sans droit ni entrée ; Cal l'accepte (le compte et sa
    place) ou le refuse (tout disparaît). Un compte actif entre directement. Ce que Cal crée : accepté."""
    err = lambda d: d.get("error", "") if isinstance(d, dict) else str(d)[:80]   # noqa: E731
    _, _, adm = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
    P = lambda path, body=None, tok=adm: H("POST", path, body if body is not None else {}, cookie=tok, headers=same)   # noqa: E731
    G = lambda path, tok=adm: H("GET", path, cookie=tok)   # noqa: E731
    real_ip = auth._ip
    n = iter(range(40, 90))

    def entrer(name):   # d'une adresse à lui : les limites de la porte des autres essais ne comptent pas
        a = f"203.0.113.{next(n)}"
        auth._ip = lambda req: a
        try:
            return H("POST", "/api/auth/enter", {"name": name}, headers=same)
        finally:
            auth._ip = real_ip

    s, t, _ = P("/api/equipes", {"name": "Valid Essai"})
    tid, sid = t["id"], t["spaces"][0]["id"]
    P("/api/admin/users", {"name": "Rui Valid", "access": "studio"})
    P(f"/api/equipes/{tid}/membres", {"pseudo": "Rui Valid", "role": "admin"})
    _, _, R = entrer("Rui Valid")

    # un pseudo neuf mis par un admin de Team (pas Cal) : en attente, sans droit ni entrée
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Max Valid", "role": "member"}, R)
    mx = auth.user("max-valid")
    ok(s == 200 and (d.get("added") or {}).get("pending") is True and (d.get("added") or {}).get("created")
       and mx["state"] == "pending" and (mx.get("invited") or {}).get("by") == "rui-valid" and mx["invited"].get("team") == tid
       and mx["invited"].get("role") == "member", f"validation : un admin de Team met un pseudo neuf : il attend Cal ({s} {err(d)} {mx.get('invited')})")
    row = next((m for m in d.get("members", []) if m["id"] == "max-valid"), {})
    ok(row.get("state") == "pending" and row.get("role") == "member",
       f"validation : sa place est écrite, la ligne dit qu'il attend (pastille « attend Cal ») ({row.get('state')})")
    ok(espaces.profile(mx, sid) is None and not espaces.can_view(mx, sid) and espaces.team_role(mx, tid) is None
       and espaces.teams_of(mx) == [] and not auth.can_compute(mx, sid) and not espaces.can_manage(mx, tid),
       "validation : en attente, sa place ne compte pas (profil, voir, rôle, Teams, calcul, gérer : rien)")
    s, me, M = entrer("Max Valid")
    ok(s == 200 and me.get("state") == "pending" and M and (me.get("invited") or {}).get("by_name") == "Rui Valid",
       f"validation : il tape son pseudo : la porte le fait attendre, et dit qui l'a invité ({s} {me.get('state')} {me.get('invited')})")
    s, me, _ = G("/api/auth/me", M)
    ok(me.get("state") == "pending" and (me.get("invited") or {}).get("by_name") == "Rui Valid" and "teams" not in me,
       f"validation : /api/auth/me dit qu'il attend la validation de Cal, invité par Rui ({me.get('invited')})")
    for path in ("/api/library", "/api/equipes", f"/api/equipes/{tid}"):
        s, _, _ = G(path, M)
        ok(s == 401, f"validation : en attente, {path} lui est fermé ({s})")
    s, st, _ = G("/api/admin/state")
    rq = next((u for u in st.get("requests", []) if u["id"] == "max-valid"), {})
    inv = rq.get("invited") or {}
    ok(inv.get("by_name") == "Rui Valid" and [x["team_name"] for x in inv.get("teams", [])] == ["Valid Essai"]
       and inv["teams"][0]["role_fr"] == "membre",
       f"validation : Admin → Demandes : « invité par Rui dans la Team Valid Essai (membre) » ({inv})")
    s, _, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Max Valid", "role": "member"}, R)
    ok(s == 409, f"validation : le remettre ne fait rien de plus tant qu'il attend ({s})")
    s, _, _ = P("/api/auth/cancel", {}, M)
    ok(auth.user("max-valid") and auth.user("max-valid")["state"] == "pending",
       "validation : « Annuler » à la porte ne défait pas l'invitation (ce navigateur seulement)")

    # Cal l'accepte : le compte ET sa place
    s, d, _ = P("/api/admin/requests/max-valid/accept")
    mx = auth.user("max-valid")
    ok(s == 200 and mx["state"] == "active" and mx.get("access") == "apps" and mx.get("perso", True) is not False
       and espaces.team_role(mx, tid) == "member" and espaces.can_edit(mx, sid),
       f"validation : Cal l'accepte : actif, membre de la Team, il y modifie ({s} {err(d)})")
    _, _, M = entrer("Max Valid")
    s, me, _ = G("/api/auth/me", M)
    ok(me.get("state") == "active" and "Valid Essai" in [x["name"] for x in me.get("teams", [])],
       f"validation : il entre, et voit la Team ({me.get('state')})")

    # un guest neuf : Cal le refuse — le compte et sa place disparaissent ; le pseudo recréé n'en hérite pas
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Gwen Valid", "role": "guest", "guest": "acteur", "spaces": [sid]}, R)
    gw = auth.user("gwen-valid")
    ok(s == 200 and gw["state"] == "pending" and gw.get("perso") is False and (gw.get("invited") or {}).get("guest") == "acteur",
       f"validation : un guest neuf attend aussi ({s} {err(d)})")
    _, _, Gw = entrer("Gwen Valid")
    s, _, _ = P("/api/admin/requests/gwen-valid/refuse")
    t_ = espaces.team(tid)
    ok(s == 200 and auth.user("gwen-valid") is None and "gwen-valid" not in t_["members"]
       and "gwen-valid" not in (espaces.space(sid) or {}).get("members", {}) and not espaces.invitations_of("gwen-valid"),
       f"validation : Cal le refuse : le compte, sa place dans la Team et le Workspace disparaissent ({s})")
    s, me, _ = G("/api/auth/me", Gw)
    ok(me.get("state") == "refused", f"validation : sa porte dit « refusé » ({me.get('state')})")
    P("/api/admin/users", {"name": "Gwen Valid", "access": "apps"})
    ok(espaces.team_role(auth.user("gwen-valid"), tid) is None and not espaces.can_view(auth.user("gwen-valid"), sid),
       "validation : le même pseudo recréé n'hérite de rien")

    # un compte existant, actif : il entre directement ; ce que Cal crée : accepté d'emblée
    P("/api/admin/users", {"name": "Ola Valid", "access": "studio"})
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Ola Valid", "role": "member"}, R)
    ok(s == 200 and not (d.get("added") or {}).get("pending") and espaces.team_role(auth.user("ola-valid"), tid) == "member",
       f"validation : un compte déjà accepté entre directement ({s} {err(d)})")
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Pia Valid", "role": "guest", "guest": "viewer", "spaces": [sid]})
    pia = auth.user("pia-valid")
    ok(s == 200 and not (d.get("added") or {}).get("pending") and pia["state"] == "active" and espaces.can_view(pia, sid),
       f"validation : un pseudo neuf que Cal met dans une Team : accepté d'emblée ({s} {err(d)})")
    s, d, _ = P("/api/admin/users", {"name": "Ugo Valid"})
    ok(s == 200 and auth.user("ugo-valid")["state"] == "active", "validation : Admin → Ajouter quelqu'un : accepté d'emblée")

    # le lien d'une Team fait par un non-Cal : le pseudo neuf attend Cal ; sur un lien de Cal, il entre
    s, inv, _ = P(f"/api/equipes/{tid}/invitations", {"role": "member", "hours": 24}, R)
    ok(s == 200 and inv.get("token"), f"validation : Rui fait un lien ({s} {err(inv)})")
    s, d, Q = entrer("Quy Valid")
    s, r, _ = H("POST", f"/api/auth/equipe/{inv['token']}", {}, cookie=Q, headers=same)
    qy = auth.user("quy-valid")
    ok(s == 200 and r.get("pending") is True and r.get("accepted") is False and r.get("by_name") == "Rui Valid"
       and qy["state"] == "pending" and (qy.get("invited") or {}).get("lien") == inv["id"]
       and espaces.team_role(qy, tid) is None and "quy-valid" in espaces.team(tid)["members"],
       f"validation : le lien de Rui : le pseudo neuf attend Cal, sa place est écrite ({s} {err(r)})")
    s, me, _ = G("/api/auth/me", Q)
    ok(me.get("state") == "pending" and (me.get("invited") or {}).get("by_name") == "Rui Valid",
       f"validation : … sa porte le dit ({me.get('invited')})")
    s, _, _ = P("/api/admin/requests/quy-valid/accept")
    ok(s == 200 and espaces.team_role(auth.user("quy-valid"), tid) == "member", f"validation : Cal l'accepte : membre ({s})")
    s, r, _ = H("POST", f"/api/auth/equipe/{inv['token']}", {}, cookie=entrer("Ugo Valid")[2], headers=same)
    ok(s == 200 and r.get("pending") is False and espaces.team_role(auth.user("ugo-valid"), tid) == "member",
       f"validation : un compte actif ouvre le lien de Rui : il entre directement ({s} {err(r)})")
    s, inv2, _ = P(f"/api/equipes/{tid}/invitations", {"role": "member", "hours": 24})
    s, d, V = entrer("Vic Valid")
    s, r, _ = H("POST", f"/api/auth/equipe/{inv2['token']}", {}, cookie=V, headers=same)
    ok(s == 200 and r.get("accepted") is True and auth.user("vic-valid")["state"] == "active",
       f"validation : le lien de Cal : le pseudo neuf entre ({s} {err(r)})")


def _depart(ok, H, same) -> None:
    """« Commencer un projet » (ideation/projet.js ; docs/etudes/mode_showrunner.md § 2) : le départ
    joué par l'API dans l'ordre de la page, par un ami qui a le Studio sur son compte — la Team et son
    Workspace, renommé ; une personne qui existe ; l'onglet dans ce Workspace ; la planche ; les
    fichiers (un nom accentué, un dossier, des documents) ; un objet d'ailleurs rapatrié ; le texte du
    brief ; la mise en page enregistrée. Puis ce qu'en voient la personne ajoutée et un inconnu."""
    import io
    import shutil
    from urllib.parse import quote

    from PIL import Image

    from core import library
    from tools import documents
    err = lambda d: d.get("error", "") if isinstance(d, dict) else str(d)[:80]   # noqa: E731
    _, _, adm = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
    toks = {}
    # trois comptes créés par Cal : deux Studio, qu'il met dans Nirvalab (un compte neuf n'a que sa My Team : Cal,
    # 09/10), un Apps (seul chez lui)
    for name, acc in (("Sam Depart", "studio"), ("Noa Depart", "studio"), ("Ugo Depart", "apps")):
        s, d, _ = H("POST", "/api/admin/users", {"name": name, "access": acc}, cookie=adm, headers=same)
        if acc == "studio":
            H("POST", "/api/equipes/tea-nirvalab/membres", {"pseudo": name, "role": "member"}, cookie=adm, headers=same)
        _, _, toks[name.split()[0]] = H("POST", "/api/auth/enter", {"name": name}, headers=same)
        ok(s == 200 and toks[name.split()[0]], f"départ : {name}, un compte {acc}, entre ({s} {err(d)})")
    sam, noa, ugo = toks["Sam"], toks["Noa"], toks["Ugo"]
    P = lambda path, body=None, tok=sam, hd=None: H("POST", path, body if body is not None else {}, cookie=tok,   # noqa: E731
                                                     headers={**same, **(hd or {})})
    G = lambda path, tok=sam, hd=None: H("GET", path, cookie=tok, headers=hd or {})   # noqa: E731

    # 0. la fenêtre s'ouvre : les droits, les personnes
    s, d, _ = G("/api/equipes")
    ok(s == 200 and d.get("can_create") is True and d.get("create_why") is None, f"départ : Sam crée une Team ({s} {d.get('create_why')})")
    s, d, _ = G("/api/equipes/personnes")
    ids = [x["id"] for x in d.get("people", [])]
    ok(s == 200 and "noa-depart" in ids and "ugo-depart" not in ids and "sam-depart" not in ids,
       f"départ : Sam peut mettre Noa (de sa Team Nirvalab), pas Ugo, qui n'est dans aucune de ses Teams ({ids})")
    # 1. la Team, née avec son Workspace « Général » ; 2. le Workspace renommé
    s, t, _ = P("/api/equipes", {"name": "Les Rues"})
    ok(s == 200 and t.get("owner") == "sam-depart" and [x["name"] for x in t.get("spaces", [])] == ["Général"],
       f"départ : la Team « Les Rues », son Workspace « Général », Sam propriétaire ({s} {err(t)})")
    tid, sid = t["id"], t["spaces"][0]["id"]
    s, sp, _ = P(f"/api/espaces/{sid}", {"name": "Repérages"})
    ok(s == 200 and sp.get("name") == "Repérages", f"départ : le propriétaire renomme le Workspace ({s} {err(sp)})")
    # 3. une personne qui existe : membre (pas un compte neuf)
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Noa Depart", "role": "member"})
    ok(s == 200 and not (d.get("added") or {}).get("created") and espaces.team_role(auth.user("noa-depart"), tid) == "member",
       f"départ : Noa, membre de la Team ({s} {err(d)})")
    # 4. l'onglet dans ce Workspace (entrerEspace : le portail le retient)
    s, _, _ = P("/api/espaces/courant", {"workspace": sid})
    _, me, _ = G("/api/auth/me")
    ok(s == 200 and (me.get("workspace") or {}).get("id") == sid, f"départ : le Workspace neuf devient le courant ({s})")
    # 5. la planche, dans ce Workspace
    here = {"X-SR-Espace": sid}
    s, b, _ = P("/api/ideation/boards", {"name": "Les Rues"}, hd=here)
    ok(s == 200 and b.get("space") == sid, f"départ : la planche, dans le Workspace neuf ({s} {b.get('space')} {err(b)})")
    bid = b.get("id", "")
    # 6. les fichiers (uploadFile : le titre, le dossier, `via`), dans ce Workspace
    buf = io.BytesIO()
    Image.new("RGB", (64, 40), (200, 60, 40)).save(buf, "PNG")
    fx = documents.fixtures()
    up = {}
    for name, body, folder in (("repérage_rue.mp4", b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64, "Repérages Paris"),
                               ("décor_nuit.png", buf.getvalue(), "Repérages Paris"), ("dossier.pdf", fx["dossier.pdf"], ""),
                               ("donnees.bin", bytes(range(256)), "")):
        title = name.rsplit(".", 1)[0]
        s, it, _ = H("PUT", f"/api/library/upload?name={quote(name)}&tool=upload&via=projet&folder={quote(folder)}&title={quote(title)}",
                     raw=body, cookie=sam, headers={**same, **here})
        up[name] = it if s == 200 else {}
        ok(s == 200 and it.get("space") == sid and it.get("title") == title and it.get("folder") == folder
           and (it.get("origin") or {}).get("via") == "projet", f"départ : « {name} » rangé dans le Workspace neuf ({s} {err(it)})")
    ok(up["repérage_rue.mp4"].get("kind") == "video" and up["décor_nuit.png"].get("kind") == "image"
       and up["dossier.pdf"].get("kind") == up["donnees.bin"].get("kind") == "document",
       f"départ : les sortes tranchées au rangement ({[(k, v.get('kind')) for k, v in up.items()]})")
    s, d, _ = H("PUT", "/api/library/upload?name=faux.mp4&tool=upload&via=projet&title=faux", raw=b"pas une video",
                cookie=sam, headers={**same, **here})
    ok(s == 415 and "MP4" in err(d), f"départ : un contenu qui n'est pas ce que dit son nom, refusé avec sa raison ({s} {err(d)})")
    md = "# Les Rues\n\nUne nuit en ville, trois personnages.\n".encode()
    s, brief, _ = H("PUT", "/api/library/upload?name=brief.md&tool=upload&via=projet&title=Brief", raw=md, cookie=sam,
                    headers={**same, **here, "Content-Type": "text/markdown"})
    ok(s == 200 and brief.get("kind") == "document" and brief.get("space") == sid, f"départ : le brief tapé, rangé en brief.md ({s} {err(brief)})")
    # ce qui vient d'Asset, d'un autre Workspace : une copie dans le Workspace neuf, l'original reste
    perso = "esp-perso-sam-depart"
    s, src, _ = H("PUT", "/api/library/upload?name=affiche.png&title=Affiche", raw=buf.getvalue(), cookie=sam,
                  headers={**same, "X-SR-Espace": perso})
    s, r, _ = P(f"/api/espaces/{sid}/rapatrier", {"items": [src.get("id")]})
    cp = (r.get("items") or [{}])[0] if s == 200 else {}
    ok(s == 200 and cp.get("space") == sid and ((cp.get("origin") or {}).get("from") or {}).get("item") == src.get("id")
       and library.get(src["id"])["space"] == perso, f"départ : un objet de My Team rapatrié, l'original reste ({s} {err(r)})")
    # 7. le texte du brief (un PDF : lu par le portail, server/tools/documents.py ; le brief.md aussi)
    s, tx, _ = G(f"/api/library/{brief.get('id')}/texte", hd=here)
    ok(s == 200 and "trois personnages" in tx.get("text", ""), f"départ : le texte de brief.md ({s} {err(tx)})")
    if shutil.which("pdftotext"):
        s, tx, _ = G(f"/api/library/{up['dossier.pdf'].get('id')}/texte", hd=here)
        ok(s == 200 and "Montparnasse" in tx.get("text", ""), f"départ : le texte du PDF, pour la note du brief et l'agent ({s} {err(tx)})")
    # 8. la mise en page de départ, un seul enregistrement
    vid, img = up["repérage_rue.mp4"], up["décor_nuit.png"]
    nodes = [{"id": "t0", "type": "title", "x": 0, "y": -150, "w": 420, "h": 72, "text": "Les Rues", "size": "l"},
             {"id": "f1", "type": "frame", "x": 0, "y": 0, "w": 560, "h": 300, "name": "Brief"},
             {"id": "n1", "type": "note", "x": 36, "y": 36, "w": 460, "h": 96, "text": "Une nuit en ville, trois personnages."},
             {"id": "f2", "type": "frame", "x": 710, "y": 0, "w": 400, "h": 300, "name": "Images"},
             {"id": "m1", "type": "media", "item": img.get("id"), "kind": "image", "x": 746, "y": 36, "w": 240, "h": 150, "title": "décor_nuit"},
             {"id": "f3", "type": "frame", "x": 1260, "y": 0, "w": 400, "h": 300, "name": "Vidéos"},
             {"id": "m2", "type": "media", "item": vid.get("id"), "kind": "video", "x": 1296, "y": 36, "w": 300, "h": 169, "title": "repérage_rue"},
             {"id": "m3", "type": "media", "item": cp.get("id"), "kind": "image", "x": 746, "y": 200, "w": 160, "h": 100, "title": "Affiche"}]
    s, sv, _ = P(f"/api/ideation/boards/{bid}", {"name": "Les Rues", "nodes": nodes, "links": [], "base_rev": b.get("rev", 1)}, hd=here)
    ok(s == 200 and sv.get("rev") == b.get("rev", 1) + 1, f"départ : la planche rangée, enregistrée ({s} {err(sv)})")
    # ce que voit chacun
    s, mine, _ = G("/api/library?limit=100", hd=here)
    got = {i["id"] for i in mine.get("items", [])}
    ok(s == 200 and {up[k].get("id") for k in up} | {brief.get("id"), cp.get("id")} <= got and src.get("id") not in got,
       f"départ : Asset du Workspace neuf : tout ce qui a été rangé ({len(got)} objets)")
    _, pm, _ = G("/api/library?limit=100", hd={"X-SR-Espace": perso})
    ok({i["id"] for i in pm.get("items", [])} == {src.get("id")}, "départ : rien n'est entré dans My Team que l'objet d'avant")
    s, eq, _ = G("/api/equipes", noa)
    mt = next((x for x in eq.get("teams", []) if x["id"] == tid), {})
    ok(s == 200 and mt.get("role") == "member" and [x["name"] for x in mt.get("spaces", [])] == ["Repérages"],
       f"départ : Noa voit la Team et son Workspace ({mt.get('role')})")
    s, bd, _ = G(f"/api/ideation/boards/{bid}", noa, here)
    s2, li, _ = G("/api/library?limit=100", noa, here)
    ok(s == 200 and len(bd.get("nodes", [])) == len(nodes) and s2 == 200 and got <= {i["id"] for i in li.get("items", [])},
       f"départ : Noa ouvre la planche et voit les fichiers ({s}, {s2})")
    s, _, _ = G(f"/api/ideation/boards/{bid}", ugo, here)
    s2, _, _ = G(f"/api/library/{vid.get('id')}", ugo)
    ok(s in (403, 404) and s2 in (403, 404), f"départ : Ugo, hors de la Team, ne voit ni la planche ni les fichiers ({s}, {s2})")


def _budget(ok, H, same) -> None:
    """Étape 8 : la réservation dans jobs.submit, la mesure, ce qui rend, le plafond (429),
    les parts, Nirvalab illimité, l'API coupée ; conso.jsonl, la seule vérité."""
    import json
    import threading
    import time

    from core import config
    from core.http import HttpError

    err = lambda d: d.get("error", "") if isinstance(d, dict) else str(d)[:80]   # noqa: E731
    _, _, adm = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
    P = lambda path, body=None, tok=adm, hd=None: H("POST", path, body if body is not None else {}, cookie=tok,   # noqa: E731
                                                     headers={**same, **(hd or {})})
    G = lambda path, tok=adm, hd=None: H("GET", path, cookie=tok, headers=hd or {})   # noqa: E731
    cal = auth.user("cal")

    s, t, _ = P("/api/equipes", {"name": "Budget Essai"})
    tid, s1 = t["id"], t["spaces"][0]["id"]
    s2 = P(f"/api/equipes/{tid}/espaces", {"name": "Client B"})[1]["id"]
    P(f"/api/equipes/{tid}/membres", {"pseudo": "Bea Essai", "role": "member"})
    bea = auth.user("bea-essai")
    _, _, B = H("POST", "/api/auth/enter", {"name": "Bea Essai"}, headers=same)

    gates: dict[str, threading.Event] = {}

    def slow(ctx):   # attend sa barrière (annulable), puis dure `s` secondes
        g = gates.setdefault(ctx.params.get("g", ""), threading.Event())
        while not g.is_set():
            ctx.check()
            time.sleep(0.02)
        time.sleep(float(ctx.params.get("s", 0)))

    def boom(ctx):
        raise RuntimeError("panne voulue")

    jobs.register("budget.essai", slow, lane="cpu", cost="gpu", direct=True)
    jobs.register("budget.panne", boom, lane="cpu", cost="gpu")
    jobs.register("budget.api", slow, lane="cpu", cost="api")
    jobs.register("budget.api_prix", slow, lane="cpu", cost="api", price=12)

    def est(kind: str, secs: float) -> None:   # l'estimation : la médiane des mesures de la sorte
        for k in [k for k in jobs._dur if k == kind or k.startswith(kind + "|")]:
            del jobs._dur[k]
        jobs._dur[kind] = [float(secs)]

    def sub(kind, who, space, secs=60.0, **params):
        est(kind, secs)
        auth.set_current(who)
        auth.set_current_space(space)
        try:
            return jobs.submit(kind, params, title="budget", tool="check")
        except HttpError as e:
            return e
        finally:
            auth.set_current(None)
            auth.set_current_space(None)

    def wait(j, states=("done", "cancelled", "error"), n=250):
        for _ in range(n):
            if j["state"] in states:
                return True
            time.sleep(0.02)
        return False

    def view(space=None, who=None):
        return jobs.budget_view(tid, who, space, detail=True)

    def lines(jid):
        f = config.data_dir() / "conso.jsonl"
        return [r for r in (json.loads(x) for x in f.read_text(encoding="utf-8").splitlines()) if r.get("job") == jid]

    started = []
    try:
        # Nirvalab : illimité, rien ne change — une estimation de 115 jours passe
        nv = jobs.budget_view("tea-nirvalab")
        ok(nv["total"]["gpu_cap_s"] is None and espaces.budget_of("tea-nirvalab")["gpu_s"] is None,
           f"budget : Nirvalab sans plafond GPU ({nv['total']})")
        j = sub("budget.essai", cal, "esp-general", 1e7, g="nv")
        started.append(j)
        ok(isinstance(j, dict) and j["budget"]["team"] == "tea-nirvalab" and j["budget"]["gpu_s"] == 1e7,
           f"budget : Nirvalab illimité, 115 jours de GPU se réservent ({getattr(j, 'message', '')})")
        jobs.cancel(j["id"])
        ok(wait(j) and jobs.budget_view("tea-nirvalab")["total"]["gpu_held_s"] == 0, "budget : … annulé, plus rien de réservé")

        # le réglage : l'admin de la Team (ici Cal) ; un membre non ; des valeurs jugées
        s, d, _ = P(f"/api/equipes/{tid}/budget", {"gpu_s": 300})
        ok(s == 200 and d["total"]["gpu_cap_s"] == 300, f"budget : Cal pose un plafond de 300 s ({s} {err(d)})")
        s, d, _ = P(f"/api/equipes/{tid}/budget", {"gpu_s": 1e9}, tok=B)
        ok(s == 403 and "admin" in err(d), f"budget : un membre ne le règle pas ({s} {err(d)[:60]})")
        s, d, _ = P(f"/api/equipes/{tid}/budget", {"gpu_s": -5})
        ok(s == 400, f"budget : un plafond négatif est refusé ({s})")
        s, d, _ = P(f"/api/equipes/{tid}/budget", {"api_credits": None})
        ok(s == 400, f"budget : des crédits API vides sont refusés (0 : coupée) ({s})")
        s, d, _ = P("/api/equipes/tea-perso-bea-essai/budget", {"gpu_s": 99999}, tok=B)
        ok(s == 403 and "Cal" in err(d), f"budget : My Team : Cal seul ({s} {err(d)[:60]})")

        # la réservation, puis la mesure
        j = sub("budget.essai", bea, s1, 60, g="m", s=0.3)
        started.append(j)
        v = view()
        ok(isinstance(j, dict) and v["total"]["gpu_held_s"] == 60 and v["total"]["gpu_used_s"] == 0,
           f"budget : submit réserve l'estimation (60 s) ({v['total']})")
        gates.setdefault("m", threading.Event()).set()
        ok(wait(j) and j["state"] == "done", f"budget : le travail finit ({j['state']})")
        v = view()
        used = v["total"]["gpu_used_s"]
        ok(0.25 <= used < 20 and v["total"]["gpu_held_s"] == 0,
           f"budget : la fin remplace la réservation par la mesure ({used} s mesurées, 60 réservées)")
        me = next(x for x in v["users"] if x["id"] == "bea-essai")
        sp = next(x for x in v["spaces"] if x["id"] == s1)
        ok(me["gpu_used_s"] == used and sp["gpu_used_s"] == used, "budget : compté à la personne et au Workspace")
        ln = lines(j["id"])
        ok([r["etat"] for r in ln] == ["réservé", "done"] and ln[1]["est_s"] == 60 and ln[1]["mesure_s"] == used
           and ln[1]["team"] == tid and ln[1]["qui"] == "bea-essai" and ln[1]["workspace"] == s1 and ln[1]["cout"] == "gpu",
           f"budget : conso.jsonl — qui, Workspace, Team, sorte, coût, estimé / mesuré, état ({ln})")

        # annulé (en cours, puis en file) : la réservation est rendue, rien n'est compté
        a = sub("budget.essai", bea, s1, 60, g="a")
        started.append(a)
        wait(a, ("running",))
        q = sub("budget.essai", bea, s1, 60, g="q")
        started.append(q)
        ok(view()["total"]["gpu_held_s"] == 120, f"budget : deux réservations ({view()['total']['gpu_held_s']})")
        jobs.cancel(q["id"])
        ok(q["state"] == "cancelled" and view()["total"]["gpu_held_s"] == 60, "budget : annulé en file, rendu")
        jobs.cancel(a["id"])
        ok(wait(a) and a["state"] == "cancelled" and view()["total"]["gpu_held_s"] == 0 and view()["total"]["gpu_used_s"] == used,
           f"budget : annulé en cours, rendu, rien de compté ({a['state']})")
        ok(lines(a["id"])[-1]["etat"] == "cancelled" and lines(a["id"])[-1]["gpu_s_compte"] == 0, "budget : … et le journal le dit")

        # en échec : rendu
        e = sub("budget.panne", bea, s1, 60)
        started.append(e)
        ok(wait(e) and e["state"] == "error" and view()["total"]["gpu_held_s"] == 0 and view()["total"]["gpu_used_s"] == used,
           f"budget : un travail en échec rend sa réservation ({e['state']})")

        # interrompu (le portail redémarre : jobs._load) : rendu
        a = sub("budget.essai", bea, s1, 60, g="i")
        started.append(a)
        wait(a, ("running",))
        i2 = sub("budget.essai", bea, s1, 60, g="i2")
        with jobs._cv:
            i2["state"] = "interrupted"
            jobs._settle(i2)
        ok(view()["total"]["gpu_held_s"] == 60 and lines(i2["id"])[-1]["etat"] == "interrupted",
           "budget : un travail interrompu rend sa réservation")
        gates.setdefault("i", threading.Event()).set()
        wait(a)
        used = view()["total"]["gpu_used_s"]

        # le plafond : 300 s ; quelques secondes comptées ; 200 de plus passent, 200 encore non
        b1 = sub("budget.essai", bea, s1, 200, g="b1")
        started.append(b1)
        b2 = sub("budget.essai", bea, s1, 200, g="b2")
        msg = getattr(b2, "message", "")
        ok(isinstance(b2, HttpError) and b2.status == 429 and "plafond GPU" in msg and "Budget Essai" in msg
           and "admin de la Team (Cal)" in msg and "Admin → Teams" in msg,
           f"budget : plafond atteint → 429 qui le dit et nomme qui débloque ({getattr(b2, 'status', '')} {msg})")
        est("budget.essai", 200)
        s, d, _ = P("/api/jobs", {"kind": "budget.essai", "params": {"g": "http"}}, tok=B, hd={"X-SR-Espace": s1})
        ok(s == 429 and "plafond GPU" in err(d), f"budget : … par la route aussi ({s} {err(d)[:70]})")
        n_before = sum(1 for x in jobs._jobs.values() if x["state"] in jobs.ACTIVE)
        jobs.cancel(b1["id"])
        wait(b1)
        r = None
        auth.set_current(bea)
        try:
            est("budget.essai", 200)
            r = jobs.retry(b1["id"])
            started.append(r)
            r2 = None
            try:
                jobs.retry(b1["id"])
            except HttpError as x:
                r2 = x
        finally:
            auth.set_current(None)
        ok(r["budget"]["gpu_s"] == 200 and r["space"] == s1 and view()["total"]["gpu_held_s"] == 200,
           f"budget : retry réserve à nouveau ({view()['total']['gpu_held_s']})")
        ok(r2 is not None and r2.status == 429, f"budget : … et un second retry bute sur le plafond ({getattr(r2, 'status', '')})")
        ok(sum(1 for x in jobs._jobs.values() if x["state"] in jobs.ACTIVE) == n_before,
           "budget : un 429 ne laisse rien en file")
        jobs.cancel(r["id"])
        wait(r)

        # les parts : par personne, par Workspace
        s, d, _ = P(f"/api/equipes/{tid}/budget", {"users": {"bea-essai": {"gpu_s": 100}}, "spaces": {s2: {"gpu_s": 50}}})
        ok(s == 200 and d["settings"]["users"]["bea-essai"]["gpu_s"] == 100, f"budget : des parts posées ({s} {err(d)})")
        x = sub("budget.essai", bea, s1, 150, g="p")
        ok(isinstance(x, HttpError) and x.status == 429 and "ta part de GPU" in x.message,
           f"budget : la part de la personne → 429 ({getattr(x, 'message', x)})")
        y = sub("budget.essai", cal, s1, 150, g="p")
        started.append(y)
        ok(isinstance(y, dict), f"budget : … Cal, sans part, passe dans le plafond de la Team ({getattr(y, 'message', '')})")
        if isinstance(y, dict):
            jobs.cancel(y["id"])
            wait(y)
        z = sub("budget.essai", cal, s2, 60, g="p")
        ok(isinstance(z, HttpError) and z.status == 429 and "Workspace « Client B »" in z.message,
           f"budget : la part du Workspace → 429 ({getattr(z, 'message', z)})")
        s, d, _ = P(f"/api/equipes/{tid}/budget", {"users": {"gpu-x": None}})
        ok(s == 400, f"budget : une part pour quelqu'un hors de la Team est refusée ({s})")
        s, d, _ = P(f"/api/equipes/{tid}/budget", {"users": {"bea-essai": None}, "spaces": {s2: None}, "gpu_s": None})
        ok(s == 200 and not d["settings"]["users"] and d["total"]["gpu_cap_s"] is None, f"budget : parts retirées, illimité ({s})")

        # ce que voit la page : /api/budget, la Team du Workspace courant
        s, d, _ = G("/api/budget", B, {"X-SR-Espace": s1})
        ok(s == 200 and d.get("team") == tid and "me" in d and d["me"]["gpu_used_s"] == used and not d.get("manage"),
           f"budget : l'accueil lit la consommation du mois ({s} {err(d) or d.get('total')})")
        s, d, _ = G(f"/api/equipes/{tid}/budget", B)
        ok(s == 200 and "users" not in d, f"budget : un membre voit le total, pas le détail ({s})")
        s, d, _ = G("/api/budget", adm, {"X-SR-Espace": "esp-general"})
        ok(s == 200 and d.get("team") == "tea-nirvalab" and d["total"]["gpu_cap_s"] is None and d.get("manage"),
           f"budget : Cal, dans Général : Nirvalab, illimité ({s})")

        # l'API : coupée par défaut — refusée, et le refus dit pourquoi
        x = sub("budget.api", bea, s1, 0, g="api")
        ok(isinstance(x, HttpError) and x.status == 403 and "API" in x.message, f"budget : API coupée, un membre → 403 ({getattr(x, 'message', x)})")
        x = sub("budget.api", cal, s1, 0, g="api")
        ok(isinstance(x, HttpError) and x.status == 429 and "aucun crédit" in x.message and "admin de la Team" in x.message,
           f"budget : API sans crédit, même Cal → 429 ({getattr(x, 'message', x)})")
        x = sub("budget.api_prix", cal, "esp-general", 0, g="api")
        ok(isinstance(x, HttpError) and x.status == 429 and "Nirvalab" in x.message,
           f"budget : Nirvalab n'a aucun crédit API non plus ({getattr(x, 'message', x)})")
        P(f"/api/equipes/{tid}", {"api": True})
        x = sub("budget.api", bea, s1, 0, g="api")
        ok(isinstance(x, HttpError) and x.status == 429 and "aucun crédit" in x.message, "budget : API ouverte, 0 crédit → 429")
        s, d, _ = P(f"/api/equipes/{tid}/budget", {"api_credits": 100})
        x = sub("budget.api", bea, s1, 0, g="api")
        ok(isinstance(x, HttpError) and x.status == 409 and "prix" in x.message, f"budget : un travail payant sans prix ne part pas ({getattr(x, 'message', x)})")
        x = sub("budget.api_prix", bea, s1, 0, g="apip")
        started.append(x)
        ok(isinstance(x, dict) and x["budget"]["credits"] == 12 and view()["total"]["credits_held"] == 12,
           f"budget : crédits réservés au prix déclaré ({getattr(x, 'message', '')})")
        gates.setdefault("apip", threading.Event()).set()
        ok(wait(x) and view()["total"]["credits_used"] == 12 and view()["total"]["credits_held"] == 0, "budget : … et comptés à la fin")
        P(f"/api/equipes/{tid}/budget", {"users": {"bea-essai": {"api_credits": 10}}})
        x = sub("budget.api_prix", bea, s1, 0, g="apip")
        ok(isinstance(x, HttpError) and x.status == 429 and "ta part de crédits API" in x.message,
           f"budget : la part de crédits de la personne ({getattr(x, 'message', x)})")

        # conso.jsonl est la seule vérité : relu, il redonne la même consommation
        before = view()["total"]
        with jobs._cv:
            jobs._conso["file"] = None
        after = view()["total"]
        ok(before == after, f"budget : relu de conso.jsonl, le même compte ({before} / {after})")
        raw = (config.data_dir() / "conso.jsonl").read_bytes().splitlines()
        ok(all(isinstance(json.loads(x), dict) for x in raw), f"budget : conso.jsonl, une ligne JSON entière par écriture ({len(raw)})")
    finally:
        for g in list(gates.values()) + [gates.setdefault(k, threading.Event()) for k in ("nv", "a", "q", "i", "i2", "b1", "p")]:
            g.set()
        for j in started:
            if isinstance(j, dict) and j["state"] in ("queued", "running"):
                jobs.cancel(j["id"])
        for j in started:
            if isinstance(j, dict):
                wait(j, ("done", "cancelled", "error", "interrupted"))
        auth.set_current(None)
        auth.set_current_space(None)
        for k in ("budget.essai", "budget.panne", "budget.api", "budget.api_prix"):   # des sortes d'essai : elles s'en vont
            jobs.HANDLERS.pop(k, None)
            jobs._META.pop(k, None)
            for d in [d for d in jobs._dur if d == k or d.startswith(k + "|")]:
                jobs._dur.pop(d, None)


def _png() -> bytes:
    import io

    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (48, 32), (90, 140, 200)).save(buf, "PNG")
    return buf.getvalue()


def _my_team(ok, H, same) -> None:
    """D1, D2, D3 (décisions de Cal du 09/10) : la Team personnelle s'appelle « My Team » ; le
    renommage des « Chez moi » d'avant, idempotent, qui épargne un nom choisi ; My Team invite si
    son propriétaire a le Studio (un compte Apps la garde seul, et la phrase le dit) ; elle ne se
    détruit pas et ne se quitte pas ; les membres d'une Team voient tous ses Workspaces."""
    err = lambda d: d.get("error", "") if isinstance(d, dict) else str(d)[:80]   # noqa: E731
    _, _, adm = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
    P = lambda path, body=None, tok=adm, hd=None: H("POST", path, body if body is not None else {}, cookie=tok,   # noqa: E731
                                                     headers={**same, **(hd or {})})
    G = lambda path, tok=adm, hd=None: H("GET", path, cookie=tok, headers=hd or {})   # noqa: E731
    toks = {}
    for name, acc in (("Mia Myteam", "studio"), ("Noe Myteam", "studio"), ("Abi Myteam", "apps")):
        P("/api/admin/users", {"name": name, "access": acc})
        _, _, toks[name.split()[0]] = H("POST", "/api/auth/enter", {"name": name}, headers=same)
        H("GET", "/api/auth/me", cookie=toks[name.split()[0]])   # sa première requête : sa My Team naît
    mia, noe, abi = toks["Mia"], toks["Noe"], toks["Abi"]

    # D1 : un compte neuf reçoit « My Team », son Workspace « Général » — et rien d'autre : ni Nirvalab, ni Général
    # (« tous les gens qui se loguent n'ont que leur espace vierge »), qu'il soit ajouté d'avance, accepté à la porte,
    # ou que Cal lui ouvre le Studio
    P("/api/admin/users/abi-myteam", {"access": "studio"})
    H("POST", "/api/auth/enter", {"name": "Pat Myteam"}, headers=same)
    P("/api/admin/requests/pat-myteam/accept")
    _, _, pat = H("POST", "/api/auth/enter", {"name": "Pat Myteam"}, headers=same)
    H("GET", "/api/auth/me", cookie=pat)   # sa première requête acceptée : sa My Team naît
    alone = {k: sorted(t["id"] for t in espaces.teams_of(auth.user(k))) for k in ("mia-myteam", "abi-myteam", "pat-myteam")}
    ok(alone == {k: [espaces.personal_team_id(k)] for k in alone} and not any(espaces.can_view(auth.user(k), "esp-general") for k in alone),
       f"my team : un compte neuf n'a que sa My Team — ajouté d'avance, Studio ouvert, accepté à la porte ({alone})")
    P("/api/admin/users/abi-myteam", {"access": "apps"})
    s, me, _ = G("/api/auth/me", mia)
    mt = next((t for t in me.get("teams", []) if t["id"] == "tea-perso-mia-myteam"), {})
    ok(s == 200 and mt.get("name") == "My Team" and mt.get("personal") and [x["name"] for x in mt.get("spaces", [])] == ["Général"],
       f"my team : un compte neuf a « My Team », Workspace « Général » ({mt.get('name')} {[x['name'] for x in mt.get('spaces', [])]})")
    ok(espaces.team("tea-perso-mia-myteam")["name"] == espaces.PERSONAL_NAME and not espaces.team("tea-perso-mia-myteam").get("renamed"),
       "my team : le nom de naissance n'est pas un nom choisi")

    # D1 : le renommage des « Chez moi » d'avant — idempotent, il épargne un nom choisi
    with espaces._lock:   # deux Teams comme avant le 09/10 : nommées « Chez moi », jamais renommées
        db = espaces._data()
        for tid in ("tea-perso-mia-myteam", "tea-perso-noe-myteam"):
            db["teams"][tid]["name"] = espaces.PERSONAL_OLD
            db["teams"][tid].pop("renamed", None)
        espaces._save()
    s, d, _ = P("/api/equipes/tea-perso-noe-myteam", {"name": "Atelier Noé"}, tok=noe)
    s2, d2, _ = P("/api/equipes/tea-perso-noe-myteam", {"name": espaces.PERSONAL_OLD}, tok=noe)
    ok(s == 200 and s2 == 200 and d2.get("name") == espaces.PERSONAL_OLD and espaces.team("tea-perso-noe-myteam").get("renamed"),
       f"my team : son propriétaire la renomme (ici, de nouveau « Chez moi », par choix) ({s} {s2} {err(d) or err(d2)})")
    dry = {x["id"] for x in espaces.rename_personal(dry=True)}
    ok("tea-perso-mia-myteam" in dry and "tea-perso-noe-myteam" not in dry and espaces.team("tea-perso-mia-myteam")["name"] == espaces.PERSONAL_OLD,
       f"my team : à blanc, la Team jamais renommée est à renommer, le nom choisi non, rien ne change ({sorted(dry)[:4]})")
    done = {x["id"] for x in espaces.rename_personal()}
    again = espaces.rename_personal()
    ok("tea-perso-mia-myteam" in done and espaces.team("tea-perso-mia-myteam")["name"] == "My Team"
       and espaces.team("tea-perso-noe-myteam")["name"] == espaces.PERSONAL_OLD and again == [],
       f"my team : renommée « My Team », le nom choisi épargné, une seconde passe ne trouve rien ({again})")

    # D2 : My Team invite si le propriétaire a le Studio ; un compte Apps la garde seul, et la phrase mène à la demande
    s, eq, _ = G("/api/equipes", noe)
    nt = next((t for t in eq.get("teams", []) if t["id"] == "tea-perso-noe-myteam"), {})
    ok(s == 200 and nt.get("invite") is True and nt.get("rename") is True and nt.get("destroy") is False
       and "maison" in (nt.get("destroy_why") or ""), f"my team : Studio — elle invite, se renomme, ne se détruit pas ({nt.get('invite_why')})")
    s, d, _ = P("/api/equipes/tea-perso-noe-myteam/membres", {"pseudo": "Mia Myteam", "role": "admin"}, tok=noe)
    ok(s == 200 and espaces.team_role(auth.user("mia-myteam"), "tea-perso-noe-myteam") == "admin",
       f"my team : son propriétaire Studio y met quelqu'un (admin) ({s} {err(d)})")
    s, inv, _ = P("/api/equipes/tea-perso-noe-myteam/invitations", {"role": "member", "hours": 24}, tok=noe)
    ok(s == 200 and inv.get("token"), f"my team : … et fait un lien d'invitation ({s} {err(inv)})")
    s, eq, _ = G("/api/equipes", abi)
    at = next((t for t in eq.get("teams", []) if t["id"] == "tea-perso-abi-myteam"), {})
    why = at.get("invite_why") or ""
    s1, d1, _ = P("/api/equipes/tea-perso-abi-myteam/membres", {"pseudo": "Mia Myteam", "role": "member"}, tok=abi)
    s2, d2, _ = P("/api/equipes/tea-perso-abi-myteam/invitations", {"role": "member", "hours": 24}, tok=abi)
    ok(at.get("invite") is False and "Apps" in why and "Demander le Studio" in why and s1 == 409 and err(d1) == why and s2 == 409,
       f"my team : un compte Apps la garde seul ; la phrase dit pourquoi et mène à la demande de Studio ({s1} {s2} {why})")
    s, d, _ = P("/api/equipes/tea-perso-abi-myteam/membres", {"pseudo": "Mia Myteam", "role": "member"})
    ok(s == 409 and "Apps" in err(d), f"my team : Cal non plus n'y met personne (le Studio est au compte) ({s} {err(d)[:60]})")
    s, d, _ = P("/api/equipes/tea-perso-noe-myteam", {"name": "Pris par Mia"}, tok=mia)
    ok(s == 403 and "propriétaire" in err(d), f"my team : un admin de la Team ne la renomme pas (son propriétaire) ({s} {err(d)})")
    s, d, _ = P("/api/equipes/tea-perso-noe-myteam/detruire", {"nom": espaces.PERSONAL_OLD}, tok=noe)
    ok(s == 409 and "maison" in err(d), f"my team : elle ne se détruit pas ({s} {err(d)})")
    s, d, _ = P("/api/equipes/tea-perso-noe-myteam/membres/noe-myteam/retirer", tok=noe)
    ok(s == 409, f"my team : son propriétaire ne la quitte pas ({s})")
    s, d, _ = P("/api/equipes/tea-perso-noe-myteam/membres", {"pseudo": "Abi Myteam", "role": "member"}, tok=noe)
    s2, pp, _ = G("/api/equipes/personnes", noe)
    ok(s == 200 and s2 == 200 and "abi-myteam" in [x["id"] for x in pp.get("people", [])],
       f"my team : qui y est compte parmi les gens de mes Teams — Abi n'est que là ({s} {err(d)} {[x['id'] for x in pp.get('people', [])][:6]})")

    # D3 : les membres d'une Team voient tous ses Workspaces — ceux d'après leur arrivée compris
    s, t, _ = P("/api/equipes", {"name": "Bords Myteam"}, tok=noe)
    s2, d2, _ = P("/api/equipes", {"name": "Pas Myteam"}, tok=abi)
    ok(s == 200 and t.get("owner") == "noe-myteam" and s2 == 403 and "Studio" in err(d2),
       f"my team : un compte Studio crée d'autres Teams ; un compte Apps non, et la phrase dit pourquoi ({s} {s2} {err(d2)[:60]})")
    tid = t["id"]
    P(f"/api/equipes/{tid}/membres", {"pseudo": "Abi Myteam", "role": "member"}, tok=noe)
    s, w2, _ = P(f"/api/equipes/{tid}/espaces", {"name": "Tournage"}, tok=noe)
    s, w3, _ = P("/api/equipes/tea-perso-noe-myteam/espaces", {"name": "Montage"}, tok=noe)
    ok(w2.get("default_role") == "editor" and w3.get("default_role") == "editor",
       f"my team : un Workspace neuf s'ouvre à tout membre (éditeur par défaut) ({w2.get('default_role')})")
    s, me, _ = G("/api/auth/me", abi)
    bt = next((x for x in me.get("teams", []) if x["id"] == tid), {})
    ok(sorted(x["name"] for x in bt.get("spaces", [])) == ["Général", "Tournage"] and all(x["can"]["edit"] for x in bt["spaces"]),
       f"my team : un membre voit tous les Workspaces de la Team, celui d'après son arrivée aussi ({[x['name'] for x in bt.get('spaces', [])]})")
    s, me, _ = G("/api/auth/me", mia)
    nt = next((x for x in me.get("teams", []) if x["id"] == "tea-perso-noe-myteam"), {})
    ok(len(nt.get("spaces", [])) == 2 and nt.get("role") == "admin",
       f"my team : dans la My Team d'un autre aussi, tous ses Workspaces ({[x['name'] for x in nt.get('spaces', [])]})")
    own = next((x for x in me.get("teams", []) if x["id"] == "tea-perso-mia-myteam"), {})
    ok(nt.get("label") == f"{nt.get('name')} · Noe Myteam" and own.get("label") == "My Team",
       f"my team : le menu de l'en-tête dit à qui est la My Team d'un autre, pas la sienne ({nt.get('label')} / {own.get('label')})")
    s, b, _ = G("/api/budget", mia, {"X-SR-Espace": nt["spaces"][0]["id"]})
    ok(s == 200 and b.get("label") == nt.get("label"), f"my team : la pastille GPU de l'accueil aussi ({s} {b.get('label')})")
    s, d, _ = P(f"/api/equipes/{tid}/membres", {"pseudo": "Gil Myteam", "role": "guest", "guest": "viewer", "spaces": [w2["id"]]}, tok=noe)
    P("/api/admin/requests/gil-myteam/accept")   # un pseudo neuf mis par un autre que Cal attend sa validation (D5)
    gil = auth.user("gil-myteam")
    ok(s == 200 and espaces.can_view(gil, w2["id"]) and not espaces.can_view(gil, t["spaces"][0]["id"]),
       f"my team : un guest reste aux Workspaces où on le met ({s} {err(d)})")


def _detruire(ok, H, same) -> None:
    """D4 : détruire un Workspace et une Team — les droits, les refus (Général, le dernier Workspace,
    une My Team, Nirvalab), le nom tapé ; ce qu'ils tenaient à la corbeille, à personne (Cal compris),
    les travaux arrêtés, qui l'avait pour dernier chez soi ; Cal le rend, le même, dans la My Team de
    son auteur (sinon la sienne) ; une Team : ses membres sortis, ses liens retirés, son budget effacé."""
    import threading
    import time

    from core import library
    err = lambda d: d.get("error", "") if isinstance(d, dict) else str(d)[:80]   # noqa: E731
    _, _, adm = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
    P = lambda path, body=None, tok=adm, hd=None: H("POST", path, body if body is not None else {}, cookie=tok,   # noqa: E731
                                                     headers={**same, **(hd or {})})
    G = lambda path, tok=adm, hd=None: H("GET", path, cookie=tok, headers=hd or {})   # noqa: E731
    up = lambda tok, sid, name: H("PUT", f"/api/library/upload?name={name}.png&title={name}", raw=_png(), cookie=tok,   # noqa: E731
                                  headers={**same, "X-SR-Espace": sid})[1]
    toks = {}
    for name in ("Pia Detruit", "Rex Detruit", "Zoe Detruit", "Sid Detruit"):
        P("/api/admin/users", {"name": name, "access": "studio"})
        _, _, toks[name.split()[0]] = H("POST", "/api/auth/enter", {"name": name}, headers=same)
        H("GET", "/api/auth/me", cookie=toks[name.split()[0]])
    pia, rex, zoe, sidt = toks["Pia"], toks["Rex"], toks["Zoe"], toks["Sid"]
    s, t, _ = P("/api/equipes", {"name": "Plateau Detruit"}, tok=pia)
    tid, w1 = t["id"], t["spaces"][0]["id"]
    w2 = P(f"/api/equipes/{tid}/espaces", {"name": "Plateau"}, tok=pia)[1]["id"]
    P(f"/api/equipes/{tid}/membres", {"pseudo": "Rex Detruit", "role": "member"}, tok=pia)
    here = {"X-SR-Espace": w2}
    img = up(pia, w2, "decor")
    img_rex = up(rex, w2, "repere")
    s1, proj, _ = P("/api/music/projects", {"name": "Bande Detruit"}, tok=pia, hd=here)
    s2, board, _ = P("/api/ideation/boards", {"name": "Planche Detruit"}, tok=rex, hd=here)
    s3, _, _ = P("/api/asset/folders", {"name": "Repérages"}, tok=pia, hd=here)
    ok(img.get("space") == w2 and img_rex.get("space") == w2 and s1 == 200 and s2 == 200 and s3 == 200,
       f"détruire : un Workspace garni — deux objets, un projet ODIO, une planche, un dossier ({s1} {s2} {s3} {err(proj) or err(board)})")
    P("/api/espaces/courant", {"workspace": w2}, tok=rex)
    # un travail en cours dans ce Workspace : il s'arrêtera
    gate = threading.Event()

    def slow(ctx):
        while not gate.is_set():
            ctx.check()
            time.sleep(0.02)
    jobs.register("detruire.essai", slow, lane="cpu", cost="cpu")
    auth.set_current(auth.user("pia-detruit"))
    auth.set_current_space(w2)
    try:
        job = jobs.submit("detruire.essai", {}, title="détruire", tool="check")
    finally:
        auth.set_current(None)
        auth.set_current_space(None)
    s, sole, _ = P("/api/equipes", {"name": "Seule Detruit"}, tok=zoe)

    try:
        # les refus : les droits, Général, le dernier Workspace, le nom tapé
        s, d, _ = P(f"/api/espaces/{w2}/detruire", {"nom": "Plateau"}, tok=rex)
        ok(s == 403 and "admin de sa Team" in err(d), f"détruire : un membre ne détruit pas un Workspace ({s} {err(d)})")
        s, d, _ = P(f"/api/espaces/{w2}/detruire", {"nom": "Plateau"}, tok=zoe)
        ok(s == 404, f"détruire : hors de la Team, le Workspace n'existe pas ({s})")
        s, d, _ = P("/api/espaces/esp-general/detruire", {"nom": "Général"})
        ok(s == 409 and "par défaut" in err(d), f"détruire : Général (l'espace par défaut de l'instance), jamais ({s} {err(d)})")
        s, d, _ = P(f"/api/espaces/{sole['spaces'][0]['id']}/detruire", {"nom": "Général"}, tok=zoe)
        ok(s == 409 and "dernier Workspace" in err(d) and "détruis la Team" in err(d),
           f"détruire : jamais le dernier Workspace ouvert d'une Team, et la phrase dit quoi faire ({s} {err(d)})")
        s, d, _ = P(f"/api/espaces/{w2}/detruire", {"nom": "plateau"}, tok=pia)
        ok(s == 400 and "« Plateau »" in err(d) and espaces.space(w2), f"détruire : le nom tapé exact, sinon rien ({s} {err(d)})")
        s, eq, _ = G("/api/equipes", rex)
        rt = next((x for x in eq.get("teams", []) if x["id"] == tid), {})
        wsr = next((x for x in rt.get("spaces", []) if x["id"] == w2), {})
        ok(wsr.get("can", {}).get("destroy") is False and "admin de sa Team" in (wsr.get("why") or {}).get("destroy", "")
           and rt.get("destroy") is False, f"détruire : la page sait pourquoi le bouton est grisé ({(wsr.get('why') or {}).get('destroy')})")

        # le propriétaire détruit : tout est à la corbeille, à personne
        s, d, _ = P(f"/api/espaces/{w2}/detruire", {"nom": " Plateau "}, tok=pia)
        ok(s == 200 and d["destroyed"]["objets"] >= 2 and espaces.space(w2) is None and espaces.gone(w2),
           f"détruire : le propriétaire détruit le Workspace ({s} {err(d) or d.get('destroyed')})")
        ok(library.see(img["id"]) is None and (library.trash_root() / img["id"] / "item.json").is_file()
           and (library.trash_root() / img_rex["id"]).is_dir(), "détruire : ses objets sont à la corbeille")
        meta = library.trashed_meta(img["id"])
        ok(not auth.can_read_item(meta, auth.user("cal")) and not auth.can_read_item(meta, None)
           and not auth.can_write_item(meta, auth.user("cal")) and not auth.can_trash_item(meta, auth.user("cal")),
           "détruire : ce qu'il tenait n'est à personne, Cal et le socle compris")
        s, d, _ = G("/api/library?limit=50", pia, here)
        s_, me, _ = G("/api/auth/me", pia, here)
        ok(s == 403 and me.get("workspace_refused") == w2, f"détruire : un onglet resté dessus est refusé, et se recale ({s})")
        s, _, _ = G(f"/api/music/projects/{proj.get('id')}", pia, {"X-SR-Espace": w1})
        s2, _, _ = G(f"/api/music/projects/{proj.get('id')}", adm, {"X-SR-Espace": w1})
        s3, _, _ = G(f"/api/ideation/boards/{board.get('id')}", rex, {"X-SR-Espace": w1})
        s4, _, _ = G(f"/api/ideation/boards/{board.get('id')}", adm, {"X-SR-Espace": w1})
        ok(s == 404 and s2 == 404 and s3 in (403, 404) and s4 in (403, 404),
           f"détruire : ses documents d'outil ne s'ouvrent plus, Cal compris ({s} {s2} {s3} {s4})")
        s, tr, _ = G("/api/asset/trash?spaces=*")
        ok(s == 200 and img["id"] not in {x["id"] for x in tr.get("items", [])},
           "détruire : la corbeille d'Asset ne les montre pas (on ne les rend qu'en bloc, Admin → Stockage)")
        try:
            auth.set_current(None)
            library.check_create(w2)
            ok(False, "détruire : rien ne naît plus dans un Workspace détruit, pas même par le socle")
        except PermissionError as e:
            ok("détruit" in str(e), f"détruire : rien ne naît plus dans un Workspace détruit, pas même par le socle ({e})")
        s, me, _ = G("/api/auth/me", rex)
        ok((me.get("workspace") or {}).get("id") == "esp-perso-rex-detruit",
           f"détruire : qui l'avait pour dernier retombe sur sa My Team ({(me.get('workspace') or {}).get('id')})")
        for _ in range(250):
            if job["state"] in ("cancelled", "error", "done"):
                break
            time.sleep(0.02)
        ok(job["state"] == "cancelled", f"détruire : ses travaux en cours s'arrêtent ({job['state']})")
        ok(any(e["event"] == "workspace détruit" and e.get("space") == w2 for e in auth.journal_tail(80)),
           "détruire : le geste va au journal")

        # la corbeille des Workspaces détruits (Cal) ; le rendre
        s, d, _ = G("/api/admin/detruits", rex)
        ok(s == 403, f"détruire : la corbeille des Workspaces détruits est à Cal ({s})")
        s, d, _ = G("/api/admin/detruits")
        row = next((x for x in d.get("spaces", []) if x["id"] == w2), {})
        ok(s == 200 and row.get("name") == "Plateau" and row.get("objets") == 2 and row.get("objets_la") == 2
           and row.get("documents", {}).get("musique") == 1 and row.get("documents", {}).get("ideation") == 1
           and row.get("vers") in ("pia-detruit", "rex-detruit") and {a["id"] for a in row.get("auteurs", [])} == {"pia-detruit", "rex-detruit"},
           f"détruire : Admin la liste — ce qu'il tenait, ses auteurs, où il reviendrait ({row})")
        s, d, _ = P(f"/api/admin/detruits/{w2}/rendre", {"vers": "personne-inconnue"})
        ok(s == 409 and espaces.gone(w2), f"détruire : on ne rend pas dans une My Team qui n'existe pas ({s} {err(d)})")
        s, d, _ = P(f"/api/admin/detruits/{w2}/rendre", {"vers": "pia-detruit"})
        ok(s == 200 and d.get("team") == "tea-perso-pia-detruit" and d.get("objets") == 2 and espaces.space(w2)
           and espaces.space(w2)["team"] == "tea-perso-pia-detruit" and not espaces.gone(w2),
           f"détruire : Cal le rend, le même, dans la My Team de son auteur ({s} {err(d) or d})")
        here2 = {"X-SR-Espace": w2}
        s, li, _ = G("/api/library?limit=50", pia, here2)
        s2, pj, _ = G(f"/api/music/projects/{proj.get('id')}", pia, here2)
        s3, bd, _ = G(f"/api/ideation/boards/{board.get('id')}", adm, here2)
        s4, fo, _ = G("/api/asset/view", pia, here2)
        ok(s == 200 and {img["id"], img_rex["id"]} <= {x["id"] for x in li.get("items", [])} and s2 == 200 and s3 == 200,
           f"détruire : tout le retrouve tel quel — objets, projet ODIO, planche ({s} {s2} {s3})")
        ok(s4 == 200 and "Repérages" in str(fo.get("folders_by_space") or fo.get("folders") or ""),
           f"détruire : … et son dossier déclaré (sa table par Workspace n'a pas bougé) ({s4})")
        ok(not espaces.can_view(auth.user("rex-detruit"), w2), "détruire : ses rôles d'avant ne reviennent pas (une autre Team)")

        # une Team : son propriétaire ou Cal ; jamais Nirvalab ; ses Workspaces, membres, liens, budget
        img1 = up(pia, w1, "general")
        P(f"/api/equipes/{tid}/budget", {"gpu_s": 3600})
        s, inv, _ = P(f"/api/equipes/{tid}/invitations", {"role": "member", "hours": 24}, tok=pia)
        s, d, _ = P(f"/api/equipes/{tid}/detruire", {"nom": "Plateau Detruit"}, tok=rex)
        ok(s == 403 and "propriétaire" in err(d), f"détruire : un membre ne détruit pas la Team ({s} {err(d)})")
        s, d, _ = P(f"/api/equipes/{espaces.NIRVALAB}/detruire", {"nom": "Nirvalab"})
        ok(s == 409 and "instance" in err(d), f"détruire : Nirvalab, jamais ({s} {err(d)})")
        s, d, _ = P(f"/api/equipes/{tid}/detruire", {"nom": "Plateau"}, tok=pia)
        ok(s == 400 and espaces.team(tid), f"détruire : la Team, son nom tapé ({s} {err(d)})")
        s, d, _ = P(f"/api/equipes/{tid}/detruire", {"nom": "Plateau Detruit"}, tok=pia)
        ok(s == 200 and espaces.team(tid) is None and espaces.gone(w1) and d["destroyed"]["members"] == ["rex-detruit"]
           and d["destroyed"]["invites"] >= 1, f"détruire : le propriétaire détruit la Team ({s} {err(d) or d.get('destroyed')})")
        ok(espaces.team_role(auth.user("rex-detruit"), tid) is None and library.see(img1["id"]) is None
           and (library.trash_root() / img1["id"]).is_dir(), "détruire : ses membres sortis, ses objets à la corbeille")
        s, d, _ = H("GET", f"/api/auth/equipe/{inv.get('token')}")
        ok(s in (404, 410), f"détruire : ses liens d'invitation ne s'ouvrent plus ({s})")
        with espaces._lock:
            rec = dict(espaces._data()["destroyed_teams"].get(tid) or {})
        ok(rec.get("name") == "Plateau Detruit" and "budget" not in rec and espaces.budget_of(tid)["gpu_s"] is None,
           "détruire : son budget effacé, sa fiche gardée")
        s, d, _ = G("/api/equipes?toutes=1")
        ok(tid not in {x["id"] for x in d.get("teams", [])}, "détruire : Cal ne la voit plus parmi les Teams")
        # un auteur qui n'existe plus : le Workspace revient chez Cal
        s, ts, _ = P("/api/equipes", {"name": "Sid Detruit"}, tok=sidt)
        ws2 = P(f"/api/equipes/{ts['id']}/espaces", {"name": "Rushes"}, tok=sidt)[1]["id"]
        up(sidt, ws2, "rush")
        P(f"/api/espaces/{ws2}/detruire", {"nom": "Rushes"})
        P("/api/admin/users/sid-detruit/supprimer")
        s, d, _ = G("/api/admin/detruits")
        row = next((x for x in d.get("spaces", []) if x["id"] == ws2), {})
        s2, r, _ = P(f"/api/admin/detruits/{ws2}/rendre")
        ok(row.get("vers") == "cal" and s2 == 200 and r.get("team") == "tea-perso-cal" and r.get("objets") == 1,
           f"détruire : son auteur n'existe plus — rendu dans la My Team de Cal ({row.get('vers')} {s2} {err(r) or r.get('team')})")
    finally:
        gate.set()
        if job["state"] in ("queued", "running"):
            jobs.cancel(job["id"])
        jobs.HANDLERS.pop("detruire.essai", None)
        jobs._META.pop("detruire.essai", None)


def _menage(ok, H, same) -> None:
    """D7, le grand ménage : l'aperçu exact (calculé à part ici, sur les mêmes données), ce que la page
    coche d'avance, les refus (la confirmation, Cal, un admin, un compte qui n'est pas d'atelier, une
    Team qui ne se détruit pas : rien n'est fait), l'application (comptes, Teams, appartenances, noms),
    Cal et les admins épargnés, ce que chacun a fait dans sa My Team intact. Les données du contrôle
    sont communes à tous les selftests : auth.json et teams.json sont remis comme avant à la fin (les
    objets enterrés, eux, restent à la corbeille, dans un Workspace que teams.json connaît de nouveau)."""
    from core import config, library
    err = lambda d: d.get("error", "") if isinstance(d, dict) else str(d)[:80]   # noqa: E731
    _, _, adm = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
    P = lambda path, body=None, tok=adm, hd=None: H("POST", path, body if body is not None else {}, cookie=tok,   # noqa: E731
                                                     headers={**same, **(hd or {})})
    G = lambda path, tok=adm, hd=None: H("GET", path, cookie=tok, headers=hd or {})   # noqa: E731
    up = lambda tok, sid, name: H("PUT", f"/api/library/upload?name={name}.png&title={name}", raw=_png(), cookie=tok,   # noqa: E731
                                  headers={**same, "X-SR-Espace": sid})[1]
    # l'atelier : deux Teams de Cal ; trois comptes créés par elles (via « equipe »), une amie, un admin
    s, ta, _ = P("/api/equipes", {"name": "Atelier Menage"})
    s, tm, _ = P("/api/equipes", {"name": "Mixte Menage"})
    for tid, who in ((ta["id"], "Etu Un"), (ta["id"], "Etu Deux"), (tm["id"], "Etu Trois")):
        P(f"/api/equipes/{tid}/membres", {"pseudo": who, "role": "member"})
    P("/api/admin/users", {"name": "Kim Menage", "access": "studio"})
    P("/api/admin/users", {"name": "Adm Menage", "access": "studio"})
    P("/api/admin/users/adm-menage", {"role": "admin"})
    for who in ("Kim Menage", "Adm Menage"):
        P(f"/api/equipes/{tm['id']}/membres", {"pseudo": who, "role": "member"})
    toks = {}
    for who in ("Etu Un", "Etu Deux", "Kim Menage"):
        _, _, toks[who] = H("POST", "/api/auth/enter", {"name": who}, headers=same)
        H("GET", "/api/auth/me", cookie=toks[who])
    perso_etu = up(toks["Etu Un"], "esp-perso-etu-un", "chez-etu")         # ce qu'il a fait chez lui : reste
    perso_kim = up(toks["Kim Menage"], "esp-perso-kim-menage", "chez-kim")
    # un invité qui attend Cal (D5) : Kim (Studio) met un pseudo neuf dans sa My Team (D2) — il attend la validation
    P("/api/equipes/tea-perso-kim-menage/membres", {"pseudo": "Inv Menage", "role": "member"}, tok=toks["Kim Menage"])
    atelier = up(toks["Etu Deux"], ta["spaces"][0]["id"], "atelier")       # dans la Team de l'atelier : à la corbeille
    with espaces._lock:   # la My Team de Kim, comme avant le 09/10
        espaces._data()["teams"]["tea-perso-kim-menage"]["name"] = espaces.PERSONAL_OLD
        espaces._save()

    # l'aperçu — calculé ici à part, sur les mêmes données
    s, d, _ = G("/api/admin/menage", toks["Kim Menage"])
    ok(s == 403, f"ménage : à Cal seulement ({s})")
    s, pv, _ = G("/api/admin/menage")
    with auth._lock:
        users = {k: dict(v) for k, v in auth._data()["users"].items()}
    want = {k for k, x in users.items() if x.get("via") == "equipe" and x.get("state") != "pending"
            and x.get("role") != "admin" and k != auth.admin_id()}
    got = {c["id"] for c in pv.get("comptes", [])}
    ok(s == 200 and got == want and {"etu-un", "etu-deux", "etu-trois"} <= got and "kim-menage" not in got,
       f"ménage : (a) les comptes créés par une Team, exactement ({len(got)} / {len(want)})")
    eu = next((c for c in pv.get("comptes", []) if c["id"] == "etu-un"), {})
    ok(eu.get("by") == "cal" and [x["name"] for x in eu.get("teams", [])] == ["Atelier Menage"] and eu.get("items") == 1 and eu.get("created"),
       f"ménage : … avec leur date, qui les a créés, leurs Teams, ce qu'ils ont chez eux ({eu})")
    rows = {t["id"]: t for t in pv.get("teams", [])}
    with espaces._lock:
        shared = {k for k, t in espaces._data()["teams"].items() if not t.get("personal")}
    ok(set(rows) == shared, f"ménage : (b) toutes les Teams partagées, aucune personnelle ({len(rows)} / {len(shared)})")
    ra, rm = rows.get(ta["id"], {}), rows.get(tm["id"], {})
    ok(ra.get("suggest") is True and rm.get("suggest") is False and ra.get("objets") == 1 and ra.get("owner") == "cal"
       and sorted(m["id"] for m in ra.get("members", [])) == ["etu-deux", "etu-un"] and [s_["name"] for s_ in ra.get("spaces", [])] == ["Général"],
       f"ménage : … propriétaire, membres, Workspaces, contenu ; l'atelier coché d'avance, la Team mixte non ({ra.get('suggest')} {rm.get('suggest')})")
    nv = rows.get(espaces.NIRVALAB, {})
    ok(nv.get("destroy") is False and nv.get("suggest") is False and "instance" in (nv.get("destroy_why") or ""),
       f"ménage : Nirvalab ne se détruit pas, et le dit ({nv.get('destroy_why')})")
    with espaces._lock:
        db = espaces._data()
        strip = {(t["id"], m) for t in db["teams"].values() for m, x in t["members"].items()
                 if m != t.get("owner") and x.get("role") != "owner" and m != auth.admin_id() and (users.get(m) or {}).get("role") != "admin"}
    ok({(x["team"], x["id"]) for x in pv.get("membres", [])} == strip and (tm["id"], "adm-menage") not in strip
       and "Adm Menage" in pv.get("epargnes", []), f"ménage : (c) les appartenances à retirer, exactement, les admins épargnés ({len(strip)})")
    ok("tea-perso-kim-menage" in {x["id"] for x in pv.get("renommer", [])}, "ménage : (d) les Teams personnelles à renommer")
    ok((auth.user("inv-menage") or {}).get("state") == "pending" and "inv-menage" in {x["id"] for x in pv.get("attente", [])}
       and "inv-menage" not in got, f"ménage : un invité qui attend Cal n'est pas un compte du ménage, l'aperçu le dit ({pv.get('attente')})")

    # les refus : rien n'est fait
    base = {"comptes": ["etu-un", "etu-deux", "etu-trois"], "teams": [ta["id"]], "retirer_membres": True, "renommer": True}
    for body, what in (({**base}, "sans confirmation"), ({**base, "confirme": "menage"}, "mal confirmé"),
                       ({**base, "comptes": ["cal"], "confirme": "MENAGE"}, "Cal"),
                       ({**base, "comptes": ["adm-menage"], "confirme": "MENAGE"}, "un admin"),
                       ({**base, "comptes": ["kim-menage"], "confirme": "MENAGE"}, "un compte qui n'est pas d'atelier"),
                       ({**base, "teams": [espaces.NIRVALAB], "confirme": "MENAGE"}, "Nirvalab"),
                       ({**base, "teams": ["tea-perso-kim-menage"], "confirme": "MENAGE"}, "une My Team")):
        s, d, _ = P("/api/admin/menage", body)
        ok(s == 400 and auth.user("etu-un") and espaces.team(ta["id"]), f"ménage : refusé — {what} ; rien n'est fait ({s} {err(d)[:70]})")

    # l'application (les données communes sont remises comme avant ensuite)
    root = config.data_dir()
    snap = {n: (root / n).read_bytes() for n in ("auth.json", "teams.json")}
    try:
        s, rep, _ = P("/api/admin/menage", {**base, "confirme": "MENAGE"})
        ok(s == 200 and sorted(x["id"] for x in rep.get("comptes", [])) == ["etu-deux", "etu-trois", "etu-un"]
           and [x["id"] for x in rep.get("teams", [])] == [ta["id"]] and not rep.get("erreurs"),
           f"ménage : appliqué — trois comptes supprimés, une Team détruite ({s} {err(rep) or rep.get('erreurs')})")
        ok(all(auth.user(x) is None for x in ("etu-un", "etu-deux", "etu-trois")) and espaces.team(ta["id"]) is None
           and espaces.gone(ta["spaces"][0]["id"]) and (library.trash_root() / atelier["id"]).is_dir(),
           "ménage : les comptes ne sont plus ; la Team de l'atelier détruite, son contenu à la corbeille")
        with espaces._lock:
            left = [(t["id"], m) for t in espaces._data()["teams"].values() for m, x in t["members"].items()
                    if m != t.get("owner") and m != auth.admin_id() and not auth.is_admin(auth.user(m))]
        removed = {(x["team"], x["id"]) for x in rep.get("membres", [])}
        expect = {(t, m) for t, m in strip if t != ta["id"] and m not in ("etu-un", "etu-deux", "etu-trois")}
        ok(not left and removed == expect, f"ménage : chaque Team ne garde que son propriétaire (et les admins) ({len(left)} restés, "
                                           f"{len(removed)} retirés / {len(expect)} attendus)")
        ok(espaces.team_role(auth.user("adm-menage"), tm["id"]) == "member" and auth.user("cal") and auth.user("adm-menage"),
           "ménage : Cal et les admins épargnés")
        ok(espaces.team("tea-perso-kim-menage")["name"] == "My Team" and "tea-perso-kim-menage" in {x["id"] for x in rep.get("renommees", [])},
           "ménage : les « Chez moi » renommées « My Team »")
        library._load()
        a, b = library._items.get(perso_etu["id"]), library._items.get(perso_kim["id"])
        ok(a and a.get("space") == "esp-perso-etu-un" and b and b.get("space") == "esp-perso-kim-menage"
           and espaces.space("esp-perso-etu-un") and espaces.space("esp-perso-kim-menage"),
           "ménage : ce que chacun a fait dans sa My Team reste, où il était")
        ok(any(e["event"] == "ménage" for e in auth.journal_tail(60)), "ménage : le rapport va au journal")
    finally:
        for n, b in snap.items():
            (root / n).write_bytes(b)
        with auth._lock:
            auth._db = None
        espaces.reset_for_tests()
        espaces.rename_personal()   # la My Team de Kim, « Chez moi » pour l'essai : comme toutes


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
           f"migration : une Team personnelle par compte, pas pour l'invité de planche ({rep['personal_created']})")
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
