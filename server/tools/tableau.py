"""Les tableaux de bord : celui de chacun, et la vue d'ensemble de Cal (Admin, section
« Vue d'ensemble » ; pour un compte qui n'est pas admin du portail, « Tableau de bord »).

Cal, 09/10/2026 : « il faut que les users aient un dashboard avec la possibilité de gérer les
accès etc. […] par exemple, [un ami] a lancé des transcripts et je ne vois pas où il a créé cet
asset : je dois moi avoir un dashboard qui me permette de voir toutes les teams, workspaces
et assets créés par les gens. »

Ce module ne lit rien lui-même : il compte et range les fiches de l'inventaire
(core/inventaire.py — chaque outil y énumère ses créations, avec leur auteur et leur
Workspace) et les Teams du socle (core/espaces.py). Les droits sont ceux de l'inventaire :
jamais une fiche d'un Workspace où l'on n'entre pas ; Cal entre partout, en lecture.

    GET /api/tableau[?toutes=1]           les Teams que la personne voit (Cal, avec ?toutes=1 :
                                          toutes, les Teams personnelles comprises, et ce qui
                                          est resté d'un Workspace qui n'existe plus) → par Team,
                                          par Workspace : le nombre d'objets par sorte, par auteur,
                                          la dernière activité ; les personnes (qui a créé combien,
                                          où, quand pour la dernière fois) ; les sortes
    GET /api/tableau/espace/<sid>?kind=a,b&q=&author=&limit=&offset=
                                          les objets d'un Workspace : sorte, titre, auteur (et d'où
                                          on le sait), date, l'adresse qui l'ouvre dans son outil
                                          (avec ?e=<sid>) ; 404 d'un Workspace qu'on ne voit pas
    GET /api/tableau/personne/<uid>?kind=&limit=&offset=
                                          tout ce que cette personne a créé, partout, avec son
                                          Workspace et sa Team — Cal, ou soi-même (403 sinon) ;
                                          `inconnu` (Cal) : ce dont on ne sait pas l'auteur
    GET /api/tableau/cherche?q=&toutes=1  les personnes et les objets qui répondent à `q` (un nom,
                                          un pseudo, un titre ; sans casse ni accents)
"""

from __future__ import annotations

from core import auth, espaces, inventaire
from core.http import HttpError

UNKNOWN = "inconnu"        # l'auteur qu'on ne sait pas : une « personne » de la vue de Cal
LIMIT, LIMIT_MAX = 60, 500
SEARCH_MAX = 60


def _who(req) -> dict:
    u = getattr(req, "user", None)
    if not u:
        raise HttpError(401, "connexion requise")
    return u


def _every(req, u) -> bool:
    return req.q("toutes") in ("1", "true") and auth.is_admin(u)


def _int(v, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def _order() -> list[str]:
    return [k["id"] for k in inventaire.kinds()]


def _counts(rs: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in rs:
        out[r["kind"]] = out.get(r["kind"], 0) + 1
    order = _order()
    return dict(sorted(out.items(), key=lambda kv: order.index(kv[0]) if kv[0] in order else 99))


def _at(r: dict) -> str:
    return max(r.get("updated") or "", r.get("created") or "")


class _View:
    """Ce que voit la personne, le temps d'une requête : les noms des auteurs (chacun lu une
    fois), les Workspaces et leurs Teams (lus une fois). Un Workspace qui n'existe plus
    (`orphan`) garde son identifiant ; un compte supprimé, le sien (`gone`). Le pseudo d'un
    compte — ce qu'on tape à la porte, sans mot de passe (décision du 29/09) — n'est montré
    qu'à Cal ; un autre cherche par le nom."""

    def __init__(self, u: dict) -> None:
        self.u, self.uid, self.admin = u, u.get("id"), auth.is_admin(u)
        self._names: dict[str, dict] = {}
        with espaces._lock:
            db = espaces._data()
            self.spaces = {k: dict(v) for k, v in db["spaces"].items()}
            self.teams = {k: dict(v) for k, v in db["teams"].items()}

    def person(self, uid: str | None) -> dict:
        key = uid or UNKNOWN
        if key not in self._names:
            x = auth.user(uid) if key != UNKNOWN else None
            if key == UNKNOWN:
                p = {"id": UNKNOWN, "name": "auteur inconnu", "pseudo": "", "gone": False, "unknown": True}
            elif not x:
                p = {"id": key, "name": key, "pseudo": "", "gone": True, "unknown": False}
            else:
                p = {"id": key, "name": x.get("name") or key, "gone": False, "unknown": False,
                     "pseudo": (x.get("pseudo") or x.get("name") or key) if self.admin else ""}
            self._names[key] = p
        return self._names[key]

    def team_name(self, t: dict) -> str:
        """Le nom d'une Team pour cette personne : la Team personnelle d'un autre dit à qui elle
        est (« <son nom> · <le nom de la personne> » : Cal les voit toutes, toutes nées « My
        Team ») — la règle de l'en-tête, une seule écriture : espaces.label_of."""
        return espaces.label_of({**t, "name": t.get("name") or t.get("id") or ""}, self.uid) if t else ""

    def of(self, sid: str) -> dict:
        sp = self.spaces.get(sid)
        if not sp:
            return {"space": sid, "space_name": sid, "team": None, "team_name": "hors des Teams", "personal": False,
                    "orphan": True}
        t = self.teams.get(sp.get("team")) or {}
        return {"space": sid, "space_name": sp.get("name") or sid, "team": sp.get("team"), "team_name": self.team_name(t),
                "personal": bool(t.get("personal")), "orphan": False}


def _last(rs: list[dict], V: _View, where: bool = False) -> dict | None:
    if not rs:
        return None
    r = max(rs, key=_at)
    out = {"at": _at(r), "kind": r["kind"], "id": r["id"], "title": r["title"], "owner": r["owner"] or UNKNOWN,
           "owner_name": V.person(r["owner"])["name"], "open": inventaire.with_e(r["open"], r["space"])}
    if where:
        out.update(V.of(r["space"]))
    return out


def _authors(rs: list[dict], V: _View) -> list[dict]:
    by: dict[str, list] = {}
    for r in rs:
        by.setdefault(r["owner"] or UNKNOWN, []).append(r)
    out = [{**V.person(uid), "n": len(xs), "last": max(_at(x) for x in xs)} for uid, xs in by.items()]
    return sorted(out, key=lambda a: (-a["n"], a["name"].lower()))


def item_out(r: dict, V: _View, where: bool = False) -> dict:
    """Une fiche telle que la page la montre : son auteur nommé, son adresse dans le Workspace
    de l'objet, sa vignette (calculée ici seulement : la page montrée)."""
    p = V.person(r["owner"])
    out = {"kind": r["kind"], "id": r["id"], "title": r["title"], "sub": r["sub"], "tool": r["tool"],
           "owner": p["id"], "owner_name": p["name"], "owner_gone": p["gone"], "via": r["via"],
           "created": r["created"], "updated": r["updated"], "space": r["space"],
           "open": inventaire.with_e(r["open"], r["space"]), "thumb": inventaire.thumb_of(r)}
    if where:
        out.update(V.of(r["space"]))
    return out


def _space_out(sp: dict, rs: list[dict], V: _View) -> dict:
    return {"id": sp["id"], "name": sp.get("name") or sp["id"], "archived": sp.get("archived"), "role": sp.get("role"),
            "total": len(rs), "counts": _counts(rs), "authors": _authors(rs, V), "last": _last(rs, V),
            # le Workspace dans Asset (l'onglet y passe : ?e=), ses objets en grand
            "open": inventaire.with_e(f"asset/#/w/{sp['id']}", sp["id"])}


# ── GET /api/tableau ────────────────────────────────────────
def overview(u, every: bool = False) -> dict:
    """Par Team, par Workspace : les comptes par sorte, par auteur, la dernière activité ;
    les personnes ; ce qui est resté d'un Workspace qui n'existe plus (Cal, `every`)."""
    V = _View(u)
    recs = inventaire.visible_records(u)
    by_space: dict[str, list] = {}
    for r in recs:
        by_space.setdefault(r["space"], []).append(r)
    teams_out, listed = [], set()
    for t in espaces.teams_of(u, everyone=every):
        spaces = []
        for sp in t.get("spaces") or []:
            if not (sp.get("can") or {}).get("view"):
                continue
            listed.add(sp["id"])
            spaces.append(_space_out(sp, by_space.get(sp["id"], []), V))
        rs = [r for s in spaces for r in by_space.get(s["id"], [])]
        spaces.sort(key=lambda s: (bool(s["archived"]), not s["total"]))   # sinon l'ordre du socle : de leur création
        personal = bool(t.get("personal"))
        teams_out.append({"id": t["id"], "name": V.team_name(t), "personal": personal, "mine": personal and t.get("owner") == V.uid,
                          "owner": t.get("owner"), "owner_name": t.get("owner_name"), "plan": t.get("plan"),
                          "archived": t.get("archived"), "role": t.get("role"), "total": len(rs), "counts": _counts(rs),
                          "last": _last(rs, V), "spaces": spaces})
    # l'ordre : les Teams partagées, puis ma Team personnelle, puis celles des autres ; dans chaque groupe, la
    # dernière activité d'abord (trois tris stables)
    teams_out.sort(key=lambda t: t["name"].lower())
    teams_out.sort(key=lambda t: (t["last"] or {}).get("at") or "", reverse=True)
    teams_out.sort(key=lambda t: (bool(t["archived"]), t["personal"], t["personal"] and not t["mine"]))
    orphans = None
    if every:
        lost = {s: rs for s, rs in by_space.items() if s not in V.spaces}
        if lost:
            listed |= set(lost)
            rs = [r for x in lost.values() for r in x]
            orphans = {"total": len(rs), "counts": _counts(rs), "last": _last(rs, V),
                       "spaces": [{**_space_out({"id": s, "name": s}, x, V), "orphan": True} for s, x in sorted(lost.items())]}
    mine = [r for r in recs if r["space"] in listed]
    people: dict[str, list] = {}
    for r in mine:
        people.setdefault(r["owner"] or UNKNOWN, []).append(r)
    people_out = [{**V.person(uid), "total": len(rs), "counts": _counts(rs), "spaces": len({r["space"] for r in rs}),
                   "last": _last(rs, V, where=True)} for uid, rs in people.items()]
    people_out.sort(key=lambda p: (p["unknown"], -p["total"], p["name"].lower()))
    return {"everyone": every, "me": V.person(V.uid), "admin": V.admin, "kinds": inventaire.kinds(),
            "total": len(mine), "counts": _counts(mine), "teams": teams_out, "orphans": orphans, "people": people_out}


def r_overview(req):
    u = _who(req)
    return overview(u, _every(req, u))


# ── GET /api/tableau/espace/<sid> ───────────────────────────
def _filter(rs: list[dict], req, V: _View) -> tuple[list[dict], list[dict]]:
    """(avant le filtre de sorte, après tous les filtres) — `q` (titre, auteur), `author`, `kind`."""
    q = inventaire.fold(req.q("q").strip())
    author = req.q("author").strip()
    if author:
        rs = [r for r in rs if (r["owner"] or UNKNOWN) == author]
    if q:
        rs = [r for r in rs if q in inventaire.fold(r["title"]) or q in inventaire.fold(V.person(r["owner"])["name"])]
    wanted = {k for k in req.q("kind").split(",") if k}
    return rs, [r for r in rs if r["kind"] in wanted] if wanted else rs


def _page(rs: list[dict], req, V: _View, where: bool = False) -> dict:
    limit = _int(req.q("limit"), LIMIT, 1, LIMIT_MAX)
    offset = _int(req.q("offset"), 0, 0, 10 ** 9)
    rs = sorted(rs, key=_at, reverse=True)
    return {"total": len(rs), "offset": offset, "limit": limit,
            "items": [item_out(r, V, where) for r in rs[offset:offset + limit]]}


def space_items(u, sid: str, req) -> dict:
    V = _View(u)
    known = sid in V.spaces
    # un Workspace qu'on ne voit pas répond comme un Workspace qui n'existe pas ; ce qui reste d'un
    # Workspace détruit ne se lit que par Cal (la vue d'ensemble le lui montre)
    if not ((known and espaces.can_view(u, sid)) or (not known and V.admin and espaces.SPACE_RX.fullmatch(sid))):
        raise HttpError(404, f"Workspace inconnu, ou pas pour toi : {sid[:48]}")
    rs = [r for r in inventaire.visible_records(u) if r["space"] == sid]
    if not known and not rs:
        raise HttpError(404, f"Workspace inconnu, ou pas pour toi : {sid[:48]}")
    base, rs2 = _filter(rs, req, V)
    return {**V.of(sid), "role": espaces.space_role(u, sid) if known else None, "counts": _counts(base),
            "authors": _authors(rs, V), "kinds": inventaire.kinds(), **_page(rs2, req, V)}


def r_space(req, sid):
    return space_items(_who(req), sid, req)


# ── GET /api/tableau/personne/<uid> ─────────────────────────
WHY_PERSON = "le tableau d'une autre personne : Cal seul — le tien est sous « Ce que j'ai créé »"


def person_items(u, uid: str, req) -> dict:
    V = _View(u)
    if not V.admin and uid != V.uid:
        raise HttpError(403, WHY_PERSON)
    who = None if uid == UNKNOWN else uid
    rs = [r for r in inventaire.visible_records(u) if r["owner"] == who]
    if who and not rs and not auth.user(who):
        raise HttpError(404, f"personne inconnue : {uid[:48]}")
    by: dict[str, list] = {}
    for r in rs:
        by.setdefault(r["space"], []).append(r)
    spaces = sorted(({**V.of(s), "n": len(x), "counts": _counts(x), "last": max(_at(r) for r in x)} for s, x in by.items()),
                    key=lambda s: s["last"], reverse=True)
    base, rs2 = _filter(rs, req, V)
    return {"person": V.person(who), "counts": _counts(base), "spaces": spaces, "last": _last(rs, V, where=True),
            "kinds": inventaire.kinds(), **_page(rs2, req, V, where=True)}


def r_person(req, uid):
    return person_items(_who(req), uid, req)


# ── GET /api/tableau/cherche ────────────────────────────────
def search(u, q: str, every: bool) -> dict:
    """Les personnes (un nom ; Cal : aussi un pseudo, un identifiant) et les objets (un titre,
    le nom de leur auteur) qui répondent à `q`. Cal : tous les comptes, même ceux qui n'ont
    rien créé (« il n'a rien fait » est une réponse) ; un autre : les auteurs de ce qu'il voit."""
    qf = inventaire.fold(q.strip())
    if not qf:
        return {"q": q, "people": [], "items": [], "total": 0}
    V = _View(u)
    recs = inventaire.visible_records(u)
    if not every and V.admin:   # Cal sans ?toutes=1 : ses Teams, comme la vue d'ensemble
        mine = {s["id"] for t in espaces.teams_of(u) for s in t.get("spaces") or []}
        recs = [r for r in recs if r["space"] in mine]
    per: dict[str, list] = {}
    for r in recs:
        per.setdefault(r["owner"] or UNKNOWN, []).append(r)
    ids = set(per)
    if every:
        ids |= {x["id"] for x in auth.users_public()}
    people = []
    for uid in ids:
        p = V.person(None if uid == UNKNOWN else uid)
        if qf in inventaire.fold(p["name"]) or (V.admin and not p["unknown"] and (qf in inventaire.fold(p["pseudo"]) or qf == inventaire.fold(uid))):
            rs = per.get(uid, [])
            people.append({**p, "total": len(rs), "counts": _counts(rs), "spaces": len({r["space"] for r in rs}),
                           "last": _last(rs, V, where=True)})
    people.sort(key=lambda p: (-p["total"], p["name"].lower()))
    hits = [r for r in recs if qf in inventaire.fold(r["title"]) or qf in inventaire.fold(V.person(r["owner"])["name"])]
    hits.sort(key=_at, reverse=True)
    return {"q": q, "people": people, "total": len(hits), "items": [item_out(r, V, where=True) for r in hits[:SEARCH_MAX]]}


def r_search(req):
    u = _who(req)
    return search(u, req.q("q")[:80], _every(req, u))


def register(app) -> None:
    app.route("GET", "/api/tableau", r_overview)
    app.route("GET", "/api/tableau/cherche", r_search)
    app.route("GET", "/api/tableau/espace/{sid}", r_space)
    app.route("GET", "/api/tableau/personne/{uid}", r_person)


# ── le contrôle (tools/check.py) ────────────────────────────
def selftest(call, ok) -> None:
    """L'inventaire voit chaque sorte (un objet de chaque magasin, créé par un membre d'essai),
    avec son auteur et son Workspace ; l'auteur d'un document qui ne le porte pas (le travail,
    le journal) ; les droits (un membre ne voit pas un Workspace d'une autre Team ; Cal voit
    tout, ce qui reste d'un Workspace disparu compris) ; la recherche par personne ; la
    transcription porte son auteur et son Workspace ; la version d'un LoRA, son auteur."""
    st, d = call("GET", "/api/tableau")
    kinds = [k["id"] for k in (d.get("kinds") or [])] if isinstance(d, dict) else []
    want = ["image", "video", "audio", "element", "midi", "sequence", "document", "playlist", "planche", "odio",
            "transcription", "lut", "atelier", "analyse", "space", "lora"]
    ok(st == 200 and all(k in kinds for k in want), f"tableau : les sortes de l'inventaire ({st} {kinds})")
    ok({"library", "trash", "musique", "ideation", "transcrire", "luts", "image_atelier", "paroles", "analyse", "elements",
        "chanson", "lora"} <= inventaire.covered(), f"tableau : les magasins connus de l'inventaire ({sorted(inventaire.covered())})")
    ok(inventaire.with_e("musique/?p=mus-1", "esp-a") == "musique/?p=mus-1&e=esp-a"
       and inventaire.with_e("transcrire/#trn-1", "esp-a") == "transcrire/?e=esp-a#trn-1"
       and inventaire.fold("Évènement") == "evenement", "tableau : l'adresse dans son Workspace (?e= avant le #), la recherche sans accents")
    # une présentation : une planche qui a des diapositives (la règle de l'export, presentation_pdf._slides)
    from pathlib import Path
    from tools import ideation
    fx = ideation._inventaire_fiche(Path("ide-20000101-000000-0000.json"), {"name": "Deck", "nodes": [
        {"type": "frame", "deck": {"ratio": "16:9"}}, {"type": "frame", "deck": {"ratio": "16:9"}, "skip": True}, {"type": "frame"}, "abîmé"]})
    ok(fx["sub"] == "présentation · 1 diapositive" and fx["open"] == "ideation/#ide-20000101-000000-0000",
       f"tableau : une planche à diapositives se dit présentation ({fx})")
    _selftest_equipes(ok)


def _selftest_equipes(ok) -> None:
    import shutil
    import subprocess
    import tempfile
    import time
    import urllib.parse
    from io import BytesIO
    from pathlib import Path

    from core import config, jobs, library
    from tools.admin import essai_http as H
    from tools import music_midi
    before = {k: config.CFG.get(k) for k in ("auth", "equipes_guests_essai")}
    config.CFG["auth"] = True
    auth.startup()
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    err = lambda d: d.get("error", "") if isinstance(d, dict) else str(d)[:120]   # noqa: E731
    tmp = Path(tempfile.mkdtemp(prefix="sr_tableau_"))
    lost = None
    try:
        for k in ("entree:127.0.0.1", "demande:127.0.0.1"):
            auth._hits.pop(k, None)
        _, _, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)

        def P(path, body=None, tok=cal, esp=None):
            return H("POST", path, body if body is not None else {}, cookie=tok, headers={**same, **({"X-SR-Espace": esp} if esp else {})})[:2]

        def G(path, tok=cal, esp=None):
            return H("GET", path, cookie=tok, headers={"X-SR-Espace": esp} if esp else {})[:2]

        def U(name, raw, ctype, tok, esp, title=""):
            q = urllib.parse.urlencode({"name": name, "title": title or name})
            return H("PUT", f"/api/library/upload?{q}", raw=raw, cookie=tok,
                     headers={**same, "X-SR-Espace": esp, "Content-Type": ctype})[:2]

        s, t1 = P("/api/equipes", {"name": "Tableau Essai"})
        s2, t2 = P("/api/equipes", {"name": "Tableau Autre"})
        ok(s == 200 and s2 == 200, f"tableau · Teams : deux Teams d'essai ({s} {s2} {err(t1)})")
        if s != 200 or s2 != 200:
            return
        W1, W3 = t1["spaces"][0]["id"], t2["spaces"][0]["id"]
        s, w2 = P(f"/api/equipes/{t1['id']}/espaces", {"name": "Clip"})
        W2 = w2.get("id")
        toks = {}
        for team, name in ((t1, "Tao Tableau"), (t2, "Lou Tableau")):
            s, d = P(f"/api/equipes/{team['id']}/membres", {"pseudo": name, "role": "member"})
            _, _, toks[name] = H("POST", "/api/auth/enter", {"name": name}, headers=same)
            ok(s == 200 and toks[name], f"tableau · Teams : {name} entre, membre de {team['name']} ({s} {err(d)})")
        tao, lou = toks["Tao Tableau"], toks["Lou Tableau"]
        tao_id, lou_id = (auth.find_pseudo("Tao Tableau") or {}).get("id"), (auth.find_pseudo("Lou Tableau") or {}).get("id")

        # ── Tao crée un objet de chaque magasin, dans Tableau Essai / Général ──
        from PIL import Image
        b = BytesIO()
        Image.new("RGB", (64, 48), (40, 120, 200)).save(b, "PNG")
        wav, mp4 = tmp / "t.wav", tmp / "t.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", str(wav)],
                       capture_output=True, timeout=60)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10", "-t", "1",
                        "-pix_fmt", "yuv420p", str(mp4)], capture_output=True, timeout=60)
        made: dict[str, tuple] = {}
        made["image"] = U("t.png", b.getvalue(), "image/png", tao, W1, "Image de Tao")
        made["video"] = U("t.mp4", mp4.read_bytes(), "video/mp4", tao, W1)
        made["audio"] = U("t.wav", wav.read_bytes(), "audio/wav", tao, W1, "Réunion de Tao")
        made["midi"] = U("t.mid", music_midi.write_smf([(0, 1, 60, 100), (1, 1, 64, 100)], 120), "audio/midi", tao, W1)
        made["document"] = U("t.txt", "Le compte rendu de Tao.".encode(), "text/plain", tao, W1)
        img, snd = (made["image"][1] or {}).get("id"), (made["audio"][1] or {}).get("id")
        made["element"] = P("/api/elements", {"title": "Perso de Tao", "type": "character", "refs": [{"item": img, "role": "face"}]}, tao, W1)
        made["sequence"] = P("/api/montage/projects", {"name": "Séquence de Tao"}, tao, W1)
        made["playlist"] = P("/api/playlist", {"title": "Playlist de Tao"}, tao, W1)
        made["planche"] = P("/api/ideation/boards", {"name": "Planche de Tao"}, tao, W1)
        made["odio"] = P("/api/music/projects", {"name": "Projet de Tao"}, tao, W1)
        made["transcription"] = P("/api/transcrire/run", {"item": snd, "mode": "rapide"}, tao, W1)
        cube = "TITLE \"essai\"\nLUT_3D_SIZE 2\n" + "".join(f"{r} {g} {bb}\n" for bb in (0, 1) for g in (0, 1) for r in (0, 1))
        made["lut"] = H("PUT", "/api/montage/luts?name=tao.cube", raw=cube.encode(), cookie=tao,
                        headers={**same, "X-SR-Espace": W1, "Content-Type": "application/octet-stream"})[:2]
        made["atelier"] = P("/api/image/atelier/open", {"item": img}, tao, W1)
        made["analyse"] = P("/api/analyse/projets", {"nom": "Analyse de Tao"}, tao, W1)
        made["space"] = P("/api/chanson/spaces", {"action": "create", "name": "Space de Tao"}, tao, W1)
        bid = (made["planche"][1] or {}).get("id")
        from tools import lora
        auth.set_current(auth.user(tao_id))
        auth.set_current_space(W1)
        jobs.set_mode(None, "paused")   # le travail attend : sa version est écrite ici, à son nom, puis il est retiré
        try:
            jl = jobs.submit("lora.train_factice", {"board": bid, "node": "n1", "model": "factice", "items": [], "name": ""},
                             title="LoRA · essai du tableau", tool="ideation")
            auth.set_current(None)   # l'auteur vient du travail, pas de qui écrit
            entry = lora._add_version(bid, "n1", [], None, jl["id"], True)
            jobs.cancel(jl["id"])
        except Exception as e:   # noqa: BLE001
            entry = {"error": str(e)}
        finally:
            jobs.set_mode(None, "active")
            auth.set_current(None)
            auth.set_current_space(None)
        ok(entry.get("by") == tao_id, f"tableau : la version d'un LoRA porte son auteur, celui du travail ({entry})")
        bad = {k: (s, err(x)) for k, (s, x) in made.items() if s != 200}
        ok(not bad, f"tableau : Tao crée un objet de chaque magasin ({bad})")
        tid = ((made["transcription"][1] or {}).get("doc") or {}).get("id", "trn-00000000-000000-0000")
        trn = {}
        for _ in range(200):
            _, trn = G(f"/api/transcrire/docs/{tid}", tao, W1)
            if isinstance(trn, dict) and trn.get("state") in ("done", "error"):
                break
            time.sleep(0.05)
        ok(trn.get("owner") == tao_id and trn.get("space") == W1,
           f"tableau : la transcription porte son auteur et son Workspace ({trn.get('owner')} {trn.get('space')})")

        sc, _ = U("cal.png", b.getvalue(), "image/png", cal, W1, "Repérage de Cal")   # Cal, auteur dans la Team de Tao
        ok(sc == 200, f"tableau : Cal dépose une image dans Tableau Essai ({sc})")

        # ── Cal : le Workspace, chaque sorte, son auteur ──
        s, sp = G(f"/api/tableau/espace/{W1}?limit=500")
        by_kind: dict = {}
        for it in (sp.get("items") or []) if isinstance(sp, dict) else []:
            if it["owner"] == tao_id:
                by_kind.setdefault(it["kind"], it)
        miss = [k for k in want_kinds() if k not in by_kind]
        ok(s == 200 and not miss and all(x["space"] == W1 and x["via"] == "doc" and f"e={W1}" in x["open"] for x in by_kind.values()),
           f"tableau : Cal voit chaque sorte créée par Tao, son auteur, son Workspace, son lien ({s} manquent {miss})")
        t = by_kind.get("transcription") or {}
        ok(t.get("open") == f"transcrire/?e={W1}#{tid}" and t.get("owner_name") == "Tao Tableau" and sp.get("team_name") == "Tableau Essai",
           f"tableau : la transcription de Tao, nommée, s'ouvre dans Transcrire dans son Workspace ({t.get('open')} {sp.get('team_name')})")
        s, sk = G(f"/api/tableau/espace/{W1}?kind=transcription,lut&author={tao_id}")
        ok(s == 200 and {x["kind"] for x in sk["items"]} == {"transcription", "lut"} and sk["counts"].get("image") == 1,
           f"tableau : le filtre par sorte et par auteur ; les comptes de la liste ({s} {sk.get('counts') if isinstance(sk, dict) else sk})")
        s, ov = G("/api/tableau?toutes=1")
        team = next((x for x in (ov.get("teams") or []) if x["id"] == t1["id"]), {}) if isinstance(ov, dict) else {}
        w = next((x for x in team.get("spaces") or [] if x["id"] == W1), {})
        who = next((a for a in w.get("authors") or [] if a["id"] == tao_id), {})
        ok(s == 200 and all(w.get("counts", {}).get(k, 0) >= 1 for k in want_kinds()) and who.get("n", 0) >= len(want_kinds())
           and (w.get("last") or {}).get("at") and any(x["id"] == t2["id"] for x in ov["teams"]),
           f"tableau : la vue d'ensemble de Cal — chaque Team, par Workspace les comptes par sorte, par auteur, la dernière activité ({s})")
        pp = next((x for x in ov.get("people") or [] if x["id"] == tao_id), {})
        ok(pp.get("total", 0) >= len(want_kinds()) and pp.get("spaces") == 1 and (pp.get("last") or {}).get("space") == W1,
           f"tableau : les personnes — Tao, combien, où, quand ({pp.get('total')} {pp.get('spaces')})")

        # ── la recherche par personne, tout ce qu'elle a créé ──
        s, f = G("/api/tableau/cherche?q=tao%20tab&toutes=1")
        ok(s == 200 and [x["id"] for x in f.get("people") or []] == [tao_id] and f.get("total", 0) >= len(want_kinds()),
           f"tableau : chercher « tao tab » — la personne, et ce qu'elle a créé ({s} {[x['id'] for x in f.get('people') or []]} {f.get('total')})")
        s, pe = G(f"/api/tableau/personne/{tao_id}?limit=500")
        ok(s == 200 and pe.get("total", 0) >= len(want_kinds()) and [x["space"] for x in pe.get("spaces") or []] == [W1]
           and all(x.get("team_name") == "Tableau Essai" and x.get("space_name") == "Général" for x in pe.get("items") or []),
           f"tableau : tout ce que Tao a créé, avec son Workspace et sa Team ({s} {pe.get('total') if isinstance(pe, dict) else pe})")
        s, mine = G(f"/api/tableau/personne/{tao_id}", tao)
        s2, _ = G("/api/tableau/personne/cal", tao)
        ok(s == 200 and mine.get("total") == pe.get("total") and s2 == 403,
           f"tableau : Tao lit son propre tableau ; pas celui de Cal ({s} {s2})")
        # le pseudo d'un compte (ce qu'on tape à la porte) : à Cal seulement ; sa Team personnelle sous son nom
        s, tv = G("/api/tableau", tao)
        s2, tf = G("/api/tableau/cherche?q=nico007", tao)
        calp = next((x for x in tv.get("people") or [] if x["id"] == "cal"), {}) if isinstance(tv, dict) else {}
        own = next((x for x in tv.get("teams") or [] if x.get("mine")), {}) if isinstance(tv, dict) else {}
        pname = (espaces._data()["teams"].get(espaces.personal_team_id(tao_id)) or {}).get("name")
        ok(s == 200 and calp.get("name") and calp.get("pseudo") == "" and s2 == 200 and not tf.get("people")
           and pname and own.get("name") == pname and own.get("personal"),
           f"tableau : Tao ne lit ni ne cherche le pseudo de Cal ; sa Team personnelle sous son nom ({calp} {own.get('name')})")
        _, cf = G("/api/tableau/cherche?q=nico007&toutes=1")
        _, cv = G("/api/tableau?toutes=1")
        ok([x["id"] for x in cf.get("people") or []] == ["cal"]
           and any(x.get("name") == f"{pname} · Tao Tableau" and not x.get("mine") for x in cv.get("teams") or []),
           "tableau : Cal cherche par pseudo ; la Team personnelle d'un autre dit à qui elle est")

        # ── les droits : un membre d'une autre Team ne voit rien de Tableau Essai ──
        s, lv = G("/api/tableau", lou)
        ok(s == 200 and t1["id"] not in [x["id"] for x in lv.get("teams") or []] and t2["id"] in [x["id"] for x in lv["teams"]]
           and tao_id not in [x["id"] for x in lv.get("people") or []],
           f"tableau : Lou ne voit que ses Teams (ni Tableau Essai, ni Tao) ({s})")
        seen = [G(f"/api/tableau/espace/{W1}", lou)[0], G(f"/api/tableau/espace/{W2}", lou)[0],
                G(f"/api/tableau/espace/{W1}?toutes=1", lou)[0], G(f"/api/tableau/personne/{tao_id}", lou)[0]]
        _, lf = G("/api/tableau/cherche?q=tao&toutes=1", lou)
        _, absent = G("/api/tableau/espace/esp-0000-absent", lou)
        _, foreign = G(f"/api/tableau/espace/{W1}", lou)
        ok(seen == [404, 404, 404, 403] and not lf.get("people") and not lf.get("items")
           and err(absent).replace("esp-0000-absent", "·") == err(foreign).replace(W1, "·"),
           f"tableau : Lou — le Workspace d'une autre Team répond comme un Workspace qui n'existe pas ; ni Tao ni ses objets ({seen})")
        s, tv = G("/api/tableau?toutes=1", tao)
        ok(s == 200 and t2["id"] not in [x["id"] for x in tv.get("teams") or []] and tv.get("everyone") is False and tv.get("orphans") is None,
           f"tableau : Tao (pas Cal) — ?toutes=1 ne lui ouvre rien de plus ({s})")

        # ── l'auteur d'un document qui ne le porte pas : son travail, sinon le journal ──
        import json as _json
        src = config.data_dir() / "transcrire" / f"{tid}.json"
        doc = _json.loads(src.read_text(encoding="utf-8"))
        old1 = {k: v for k, v in doc.items() if k != "owner"}
        old1["id"] = "trn-20000101-000000-0aa1"
        old2 = {k: v for k, v in old1.items() if k != "job"}
        old2["id"] = "trn-20000101-000000-0aa2"
        for x in (old1, old2):
            (src.parent / f"{x['id']}.json").write_text(_json.dumps(x), encoding="utf-8")
        auth.journal("http", user=lou_id, method="POST", path=f"/api/transcrire/docs/{old2['id']}", status=200, space=W1)
        recs = {r["id"]: r for r in inventaire.records() if r["kind"] == "transcription"}
        r1, r2 = recs.get(old1["id"], {}), recs.get(old2["id"], {})
        ok((r1.get("owner"), r1.get("via")) == (tao_id, "travail") and (r2.get("owner"), r2.get("via")) == (lou_id, "journal"),
           f"tableau : sans auteur, celui de son travail, sinon le premier geste du journal ({r1.get('owner')} {r1.get('via')} · "
           f"{r2.get('owner')} {r2.get('via')})")
        # la fiche gardée en mémoire suit le fichier : un titre changé se lit au relevé suivant
        old1["title"] = "Titre changé sur le disque"
        (src.parent / f"{old1['id']}.json").write_text(_json.dumps(old1, ensure_ascii=False), encoding="utf-8")
        r1 = next((r for r in inventaire.records() if r["id"] == old1["id"]), {})
        ok(r1.get("title") == "Titre changé sur le disque", f"tableau : un document réécrit est relu ({r1.get('title')})")
        for x in (old1, old2):
            (src.parent / f"{x['id']}.json").unlink(missing_ok=True)
        ok(not any(r["id"] in (old1["id"], old2["id"]) for r in inventaire.records()), "tableau : un document effacé quitte l'inventaire")

        # ── ce qui reste d'un Workspace disparu : Cal seul le voit ──
        _, x = U("perdu.png", b.getvalue(), "image/png", cal, W1, "Perdue")
        lost = library._items.get((x or {}).get("id") or "")
        if lost:
            lost["space"] = "esp-disparu-essai"
            library._save(lost)
            s, ov = G("/api/tableau?toutes=1")
            orph = (ov.get("orphans") or {}) if isinstance(ov, dict) else {}
            s2, ol = G("/api/tableau/espace/esp-disparu-essai")
            s3, _ = G("/api/tableau/espace/esp-disparu-essai", tao)
            ok(s == 200 and [x["id"] for x in orph.get("spaces") or []] == ["esp-disparu-essai"] and s2 == 200
               and [x["id"] for x in ol.get("items") or []] == [lost["id"]] and ol.get("orphan") and s3 == 404,
               f"tableau : un objet d'un Workspace disparu — dans la vue de Cal (hors des Teams), à personne d'autre ({s} {s2} {s3})")
    finally:
        if lost:   # jamais laissé : le contrôle de l'isolement veut chaque objet dans un Workspace connu
            with library._lock:
                library._items.pop(lost["id"], None)
            shutil.rmtree(library.folder_of(lost["id"]), ignore_errors=True)
        shutil.rmtree(tmp, ignore_errors=True)
        auth.set_current(None)
        auth.set_current_space(None)
        for k, v in before.items():
            if v is None:
                config.CFG.pop(k, None)
            else:
                config.CFG[k] = v


def want_kinds() -> list[str]:
    """Les sortes que le contrôle crée une à une : toutes celles de l'inventaire."""
    return [k["id"] for k in inventaire.kinds()]
