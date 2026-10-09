"""Les droits des amis : le contrôle, porte allumée (tools/check.py).

Ce module n'a pas de route : il prouve, par l'API comme une page le ferait,
les règles d'écriture et de lecture du portail quand des amis entrent
(docs/etudes/apps_studio_elements.md § 2.12, audit du 29/09 ; Teams et
Workspaces, docs/etudes/equipes_espaces.md, étape 2, le 30/09) :

  - un objet, un projet ODIO, une séquence, une planche, une transcription, un
    projet d'analyse, une LUT sont à leur Workspace (`space`, posé à la
    création, jamais par la page, gardé à chaque réécriture) ; leur auteur
    reste l'auteur ;
  - voir : le rôle dans ce Workspace (lecteur et au-dessus, guest viewer
    compris) ; `visibility: own` resserre à ce qui est à soi ou partagé ;
  - modifier : un éditeur du Workspace (décision 9 : tout éditeur modifie ; un
    guest acteur aussi ; un guest viewer, jamais) ; créer, de même ; la
    corbeille : l'auteur, ou un admin du Workspace ; sans auteur : les admins ;
  - un outil n'atteint que son Workspace : dans une requête ou un travail,
    `library.get` et les listes ne rendent que le Workspace courant ; montrer
    (un fichier sous /library/, l'aperçu d'un son) se juge par l'objet ;
  - `POST /api/jobs` : une sorte inconnue → 400 ; une sorte qui a sa route
    (non `direct`) → 403 pour un ami ; une sorte `direct` juge ses réglages
    à l'entrée (jobs.register(…, direct=)) ;
  - la corbeille : par Workspace, chacun la sienne ; le retour en lot prend
    toutes les sortes (mid-, seq-) ; un geste en lot se fait en entier ou pas
    du tout ;
  - un dépôt : le contenu doit être ce que dit son nom ; la taille d'un ami
    est bornée (config `upload_max_mb`) ; un corps JSON, à 32 Mo.

Les personnes : Cal ; A (Albane) et B (Bastien), amis que Cal accepte (ils n'ont que
leur My Team : décision de Cal du 09/10), puis met dans Nirvalab, éditeurs de Général ; B'
(Gil) guest viewer et B'' (Gaël) guest acteur de Général ; C (Cyril),
membre d'une autre Team.
"""

from __future__ import annotations

GENERAL = "esp-general"


def selftest(call, ok) -> None:
    import base64
    import io
    import json

    from PIL import Image

    from core import auth, config, http, jobs, library
    from tools import analyse, image, montage, music
    from tools.admin import essai_http as H

    def err(d) -> str:
        return d.get("error", "") if isinstance(d, dict) else ""

    def png(color=(40, 90, 60), size=(32, 24)) -> bytes:
        buf = io.BytesIO()
        Image.new("RGB", size, color).save(buf, "PNG")
        return buf.getvalue()

    before = config.CFG.get("auth")
    max_mb = config.CFG.get("upload_max_mb")
    essai = config.CFG.get("equipes_guests_essai")
    max_json = getattr(http, "MAX_JSON", None)   # getattr : le contrôle tourne aussi sur le code d'avant (trous rouverts)
    config.CFG["auth"] = True
    config.CFG["equipes_guests_essai"] = True    # une copie d'essai : la garde du calcul peut y manquer
    auth.startup()
    with auth._lock:
        auth._hits.clear()   # les limites de débit des contrôles d'avant (compte.py) : un autre essai
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    jobs.register("droits.route", lambda ctx: {"note": "ok"}, lane="cpu", title="Essai : une sorte qui a sa route", cost="cpu")

    def direct_check(p):
        if not isinstance(p.get("n"), int):
            raise ValueError("n : un entier")

    try:
        jobs.register("droits.direct", lambda ctx: {"note": "ok"}, lane="cpu", title="Essai : une sorte directe",
                      direct=direct_check, cost="cpu")
    except TypeError:
        jobs.register("droits.direct", lambda ctx: {"note": "ok"}, lane="cpu", title="Essai : une sorte directe")
        ok(False, "file : jobs.register ne connaît pas `direct`")
    queued: list[str] = []
    try:
        jobs.set_mode(None, "paused")   # rien ne part : on juge l'entrée seulement
        s, _, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        toks = {}
        for name, uid in (("Albane", "albane"), ("Bastien", "bastien")):
            s1, d1, t = H("POST", "/api/auth/enter", {"name": name})
            s2, _, _ = H("POST", f"/api/admin/requests/{uid}/accept", cookie=cal, headers=same)
            toks[uid] = t
            ok(s1 == 200 and s2 == 200 and t, f"droits : {name} entre, Cal l'accepte ({s1} {s2} {d1})")
        A, B = toks["albane"], toks["bastien"]
        for name, uid in (("Albane", "albane"), ("Bastien", "bastien")):
            m = (auth.user(uid) or {})
            alone = _space_role(uid, GENERAL)
            s, _, _ = H("POST", "/api/equipes/tea-nirvalab/membres", {"pseudo": name, "role": "member"}, cookie=cal, headers=same)
            ok(m.get("access") == "studio" and alone is None and s == 200 and _space_role(uid, GENERAL) == "editor",
               f"droits : {uid}, ami accepté avec le Studio, n'a que sa My Team (Cal, 09/10) ; Cal le met dans Nirvalab : "
               f"éditeur de Général ({m.get('access')} {alone} {s} {_space_role(uid, GENERAL)})")
        # B' guest viewer, B'' guest acteur de Général ; C membre d'une autre Team
        s1, _, _ = H("POST", "/api/equipes/tea-nirvalab/membres", {"pseudo": "Gil Viewer", "role": "guest", "guest": "viewer",
                                                                   "spaces": [GENERAL]}, cookie=cal, headers=same)
        s2, _, _ = H("POST", "/api/equipes/tea-nirvalab/membres", {"pseudo": "Gael Acteur", "role": "guest", "guest": "acteur",
                                                                   "spaces": [GENERAL]}, cookie=cal, headers=same)
        s3, tc, _ = H("POST", "/api/equipes", {"name": "Droits Ailleurs"}, cookie=cal, headers=same)
        wsc = ((tc or {}).get("spaces") or [{}])[0].get("id") if isinstance(tc, dict) else None
        s4, _, _ = H("POST", f"/api/equipes/{(tc or {}).get('id')}/membres", {"pseudo": "Cyril Ailleurs", "role": "member"},
                     cookie=cal, headers=same)
        GV = H("POST", "/api/auth/enter", {"name": "Gil Viewer"}, headers=same)[2]
        GA = H("POST", "/api/auth/enter", {"name": "Gael Acteur"}, headers=same)[2]
        C = H("POST", "/api/auth/enter", {"name": "Cyril Ailleurs"}, headers=same)[2]
        ok((s1, s2, s3, s4) == (200, 200, 200, 200) and GV and GA and C and wsc,
           f"droits : Gil (guest viewer), Gaël (guest acteur) de Général, Cyril d'une autre Team entrent ({s1} {s2} {s3} {s4})")

        def who(tok):
            def req(method, path, body=None, **kw):
                return H(method, path, body, cookie=tok, headers={**same, **kw.pop("headers", {})}, **kw)[:2]
            return req

        a, b, c, gv, ga, cy = who(A), who(B), who(cal), who(GV), who(GA), who(C)

        # ── ODIO : le projet de A ────────────────────────────
        s, p = a("POST", "/api/music/projects", {"name": "Projet d'Albane"})
        ok(s == 200 and p.get("owner") == "albane" and p.get("space") == GENERAL,
           f"ODIO : le projet est à qui le crée, dans son Workspace ({s} {p.get('owner') if isinstance(p, dict) else p} "
           f"{p.get('space') if isinstance(p, dict) else ''})")
        pid = p.get("id", "")
        s, got = b("GET", f"/api/music/projects/{pid}")
        ok(s == 200, f"ODIO : B le lit (Général, visibility = all) ({s})")
        s, d = b("POST", f"/api/music/projects/{pid}", {**got, "owner": "bastien", "space": "esp-ailleurs", "shared": True})
        s2, again = a("GET", f"/api/music/projects/{pid}")
        ok(s == 200 and again.get("owner") == "albane" and again.get("space") == GENERAL and not again.get("shared"),
           f"ODIO : B, éditeur de Général, l'enregistre (décision 9) ; l'auteur, le Workspace, le partage restent ceux "
           f"du serveur, quoi que la page envoie ({s} {again.get('owner')} {again.get('space')})")
        s, d = b("POST", f"/api/music/projects/{pid}/delete")
        ok(s == 403 and music._path(pid).exists() and "Albane" in err(d),
           f"ODIO : B ne le met pas à la corbeille : son auteur, ou un admin du Workspace ({s} {err(d)})")
        s, d = c("POST", f"/api/music/projects/{pid}", again)
        ok(s == 200, f"ODIO : Cal enregistre tout ({s})")
        old = music.empty("D'avant la porte")
        old.update(id="mus-20260101-000000-0a0a", rev=1, created=library.now(), updated=library.now())
        music._write(old)
        s, _ = a("POST", f"/api/music/projects/{old['id']}", old)
        s2, _ = a("POST", f"/api/music/projects/{old['id']}/delete")
        kept = json.loads(music._path(old["id"]).read_text(encoding="utf-8"))
        ok(s == 200 and s2 == 403 and kept.get("space") == GENERAL,
           f"ODIO : un projet sans propriétaire (dans Général) s'enregistre par un éditeur, ne se jette que par un admin ; "
           f"son Workspace est écrit à la réécriture ({s} {s2} {kept.get('space')})")
        auth.set_settings({"visibility": "own"}, by="cal")
        s, _ = b("GET", f"/api/music/projects/{pid}")
        s2, lst = b("GET", "/api/music/projects")
        ok(s == 404 and all(x["id"] != pid for x in lst.get("projects", [])),
           f"ODIO, visibility = own : le projet de A est caché à B ({s})")
        auth.set_settings({"visibility": "all"}, by="cal")

        # ── la file : la route commune ────────────────────────
        s, d = b("POST", "/api/jobs", {"kind": "n.existe.pas", "params": {}})
        ok(s == 400, f"file : une sorte inconnue est refusée ({s} {d})")
        for kind in ("droits.route", "library.views", "image.generate", "music.stems", "analyse.run"):
            if kind in jobs.HANDLERS:
                s, d = b("POST", "/api/jobs", {"kind": kind, "params": {}})
                ok(s == 403 and "route commune" in err(d), f"file : un ami ne lance pas « {kind} » par la route commune ({s})")
        s, j = c("POST", "/api/jobs", {"kind": "droits.route", "params": {}})
        ok(s == 200 and j.get("state") == "queued", f"file : Cal, oui (les essais) ({s})")
        queued.append(j.get("id"))
        s, d = a("POST", "/api/jobs", {"kind": "droits.direct", "params": {"n": "x"}})
        ok(s == 400 and "entier" in err(d), f"file : une sorte directe juge ses réglages ({s} {d})")
        s, d = a("POST", "/api/jobs", {"kind": "droits.direct", "params": ["pas", "un", "objet"]})
        ok(s == 400, f"file : des réglages qui ne sont pas un objet ({s})")
        s, j = a("POST", "/api/jobs", {"kind": "droits.direct", "params": {"n": 1}})
        ok(s == 200 and j.get("owner") == "albane", f"file : une sorte directe part, au nom de A ({s})")
        queued.append(j.get("id"))
        if "movie.t2v" in jobs.HANDLERS:
            s, d = a("POST", "/api/jobs", {"kind": "movie.t2v", "params": {"desc": ""}})
            ok(s == 400 and "description" in err(d), f"file : Vidéo refuse un plan en erreur à l'entrée ({s} {d})")
        s, _ = b("POST", f"/api/jobs/{j.get('id')}/cancel")
        ok(s == 403, f"file : B n'arrête pas le travail de A ({s})")

        # ── Object Creator : un mesh ne s'ajoute qu'à un objet qu'on peut modifier ──
        s, img = a("PUT", "/api/library/upload?name=botte.png&title=Botte", raw=png(), headers={"Content-Type": "image/png"})
        s2, obj = a("POST", "/api/objet/objects", {"title": "Botte", "item": img.get("id")})
        ok(s == 200 and s2 == 200 and obj.get("owner") == "albane", f"objet : A fait un objet ({s} {s2})")
        s, d = gv("POST", "/api/jobs", {"kind": "objet.mesh_factice", "params": {"element": obj.get("id")}})
        ok(s == 403, f"objet : Gil, guest viewer, ne lance pas de mesh sur l'objet de A ({s} {err(d)[:80]})")
        s, j = b("POST", "/api/jobs", {"kind": "objet.mesh_factice", "params": {"element": obj.get("id")}})
        ok(s == 200, f"objet : B, éditeur de Général, oui (décision 9) ({s} {err(j)})")
        queued.append(j.get("id"))

        # ── Asset : la planche, CF, les lots ──────────────────
        s, bimg = b("PUT", "/api/library/upload?name=b.png&title=De+Bastien", raw=png((9, 9, 200)), headers={"Content-Type": "image/png"})
        s, el = a("POST", "/api/elements", {"title": "Perso A", "type": "character", "refs": [{"item": img["id"], "role": "face"}]})
        ref0 = (el.get("element") or {}).get("refs", [{}])[0].get("file", "")
        s, d = gv("POST", f"/api/asset/refs/{el.get('id')}", {"refs": []})
        ok(s == 403 and library.get(el["id"])["element"]["refs"], f"asset : Gil (viewer) ne vide pas la planche de A ({s})")
        s, d = gv("POST", "/api/asset/cf/refresh", {"id": el.get("id")})
        ok(s == 403 and (library.folder_of(el["id"]) / ref0).is_file(), f"asset : Gil ne remet pas à jour l'élément de A, rien n'est effacé ({s})")
        s, d = gv("POST", "/api/asset/bulk", {"ids": [bimg["id"], img["id"]], "fav": True})
        ok(s == 403 and not library.get(bimg["id"]).get("fav"), f"asset : un lot de Gil : rien n'est fait ({s})")
        s, d = gv("POST", "/api/asset/move", {"ids": [bimg["id"], img["id"]], "folder": "Volé"})
        ok(s == 403 and not library.get(bimg["id"]).get("folder"), f"asset : ranger en lot, de même ({s})")
        s, d = b("POST", "/api/asset/bulk", {"ids": [bimg["id"], img["id"]], "fav": True})
        s2, seen = a("GET", f"/api/library/{img['id']}")
        s3, seen2 = gv("GET", f"/api/library/{img['id']}")
        ok(s == 200 and seen.get("fav") and seen2.get("fav"),
           f"asset : B met en favori, A et Gil le voient — les favoris sont partagés par le Workspace ({s} {s2} {s3})")
        b("POST", "/api/asset/bulk", {"ids": [bimg["id"], img["id"]], "fav": False})
        a("POST", "/api/asset/move", {"ids": [img["id"]], "folder": "Commun"})
        b("POST", "/api/asset/move", {"ids": [bimg["id"]], "folder": "Commun"})
        s, d = gv("POST", "/api/asset/folders/rename", {"from": "Commun", "to": "Chez Gil"})
        ok(s == 403 and library.get(img["id"])["folder"] == "Commun", f"asset : Gil ne renomme pas un dossier ({s})")
        s, d = b("POST", "/api/asset/folders/rename", {"from": "Commun", "to": "Chez Bastien"})
        ok(s == 200 and d.get("renamed") == 2 and d.get("kept") == 0 and library.get(img["id"])["folder"] == "Chez Bastien",
           f"asset : B, éditeur, renomme le dossier entier du Workspace (décision 9) ({s} {d})")
        a("POST", "/api/asset/move", {"ids": [img["id"]], "folder": ""})
        s, d = a("POST", f"/api/library/{img['id']}", {"tags": "pas une liste"})
        ok(s == 400, f"bibliothèque : une modification mal formée est refusée ({s})")

        # ── la corbeille : chacun la sienne ; toutes les sortes reviennent ──
        s, _ = a("POST", "/api/asset/trash", {"ids": [img["id"]]})
        s, d = b("POST", f"/api/library/{img['id']}/restore")
        s2, d2 = b("POST", "/api/asset/restore", {"ids": [img["id"]]})
        ok(s == 403 and s2 == 403 and library.get(img["id"]) is None and (library.trash_root() / img["id"]).is_dir(),
           f"corbeille : B ne rend pas l'objet jeté de A ({s}, {s2})")
        s, t = b("GET", "/api/asset/trash")
        s2, _ = b("GET", f"/api/asset/trash/{img['id']}/thumb")
        ok(s == 200 and all(x["id"] != img["id"] for x in t["items"]) and s2 == 404, f"corbeille : B ne voit pas celle de A ({s2})")
        s, t = c("GET", "/api/asset/trash")
        ok(any(x["id"] == img["id"] for x in t["items"]), "corbeille : Cal voit tout")
        smf = b"MThd\x00\x00\x00\x06\x00\x00\x00\x01\x01\xe0MTrk\x00\x00\x00\x04\x00\xff\x2f\x00"
        s, mid = a("PUT", "/api/library/upload?name=clip.mid&title=Clip", raw=smf, headers={"Content-Type": "audio/midi"})
        s2, seq = a("POST", "/api/montage/projects", {"name": "Séquence d'Albane"})
        ok(s == 200 and mid.get("id", "").startswith("mid-") and s2 == 200 and seq.get("id", "").startswith("seq-"),
           f"corbeille : un clip MIDI et une séquence à A ({s} {s2})")
        ids = [img["id"], mid.get("id"), seq.get("id")]
        a("POST", "/api/asset/trash", {"ids": ids[1:]})
        s, r = a("POST", "/api/asset/restore", {"ids": ids})
        ok(s == 200 and sorted(r.get("restored", [])) == sorted(ids) and all(library.get(i) for i in ids),
           f"corbeille : le retour en lot rend aussi mid- et seq- ({s} {r})")

        # ── lire : visibility = own, jugée par library.get pour tous ──
        auth.set_settings({"visibility": "own"}, by="cal")
        s1, _ = b("POST", "/api/asset/zip", {"ids": [img["id"]]})
        s2, _ = b("GET", f"/api/asset/lineage/{img['id']}")
        s3, _ = b("POST", "/api/elements", {"title": "Copie", "refs": [{"item": img["id"], "role": "face"}]})
        s4, bat = b("POST", "/api/library/batch", {"ids": [img["id"], bimg["id"]]})
        s5, _ = b("POST", f"/api/montage/projects/{seq['id']}/duplicate")
        s6, _ = b("POST", "/api/jobs", {"kind": "montage.export", "params": {"project": seq["id"]}})
        ok((s1, s2, s3, s5, s6) == (404, 404, 404, 404, 404) and bat.get("missing") == [img["id"]],
           f"lire : l'objet caché de A n'existe pas pour B — zip, lignée, élément, lot, séquence, export ({s1} {s2} {s3} {s5} {s6})")
        auth.set_current(auth.user("bastien"))
        ok(library.get(img["id"]) is None, "lire : library.get juge au nom de qui agit (un travail : son propriétaire)")
        auth.set_current(None)
        ok(library.get(img["id"]) is not None, "lire : sans personne (le socle), tout se voit")
        auth.set_settings({"visibility": "all"}, by="cal")

        # ── déposer : le contenu, la taille ───────────────────
        eps = b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\nshowpage\n"
        for name, body in (("faux.png", eps), ("faux.jpg", eps), ("faux.mp4", b"#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\nfile:///etc/passwd\n"),
                           ("faux.wav", png()), ("faux.mid", b"not midi")):
            s, d = b("PUT", f"/api/library/upload?name={name}", raw=body, headers={"Content-Type": "application/octet-stream"})
            ok(s == 415, f"dépôt : un {name} qui n'en est pas un est refusé ({s} {d})")
        config.CFG["upload_max_mb"] = {**(max_mb or {}), "image": 1}
        big = png() + b"\x00" * 1_200_000
        s, d = b("PUT", "/api/library/upload?name=grosse.png", raw=big, headers={"Content-Type": "image/png"})
        s2, d2 = b("GET", "/api/auth/me")   # la connexion reste bonne après un refus avant lecture
        ok(s == 413 and "1 Mo" in err(d) and s2 == 200, f"dépôt : un ami, borné par upload_max_mb ({s} {d})")
        s, d = c("PUT", "/api/library/upload?name=grosse.png", raw=big, headers={"Content-Type": "image/png"})
        ok(s == 200, f"dépôt : Cal, non ({s})")
        config.CFG["upload_max_mb"] = max_mb
        http.MAX_JSON = 2000
        s, d = a("POST", "/api/music/projects", {"name": "x" * 3000})
        ok(s == 413, f"un corps JSON au-delà de MAX_JSON : 413 ({s})")
        if max_json is not None:
            http.MAX_JSON = max_json

        # ── Movie Analysis ────────────────────────────────────
        s, pr = a("POST", "/api/analyse/projets", {"nom": "Film d'Albane"})
        apid = ((pr or {}).get("projet") or {}).get("id", "")
        s1, _ = gv("POST", f"/api/analyse/projets/{apid}", {"nom": "Renommé par Gil"})
        s2, _ = b("POST", f"/api/analyse/projets/{apid}", {"nom": "Renommé par B"})
        s3, _ = a("POST", f"/api/analyse/projets/{apid}", {"nom": "Renommé par A"})
        s4, lst = cy("GET", "/api/analyse/projets")
        mine = next((x for x in analyse._store_lit() if x["id"] == apid), {})
        ok(s == 200 and s1 == 403 and s2 == 200 and s3 == 200 and mine.get("space") == GENERAL
           and all(x["id"] != apid for x in (lst or {}).get("projets", [])),
           f"analyse : un projet est à son Workspace — Gil ne le renomme pas, B (éditeur) et A oui, Cyril ne le voit pas "
           f"({s} {s1} {s2} {s3} {mine.get('space')})")
        s, _ = b("POST", "/api/analyse/diar/analyse", raw=b"x", headers={"Content-Type": "audio/wav"})
        ok(s == 403, f"analyse : la diarisation directe (hors file) est à Cal ({s})")
        ok(analyse.NOM.match("abc\n") is None and analyse.NOM_PROJET.match("abc\n") is None,
           "analyse : un nom ne finit pas par un retour à la ligne")

        # ── Montage : une LUT sans auteur (d'avant la porte) : les éditeurs la changent, un admin la jette ──
        for uid, trash, want in (("bastien", False, None), ("bastien", True, 403), ("gil-viewer", False, 403)):
            auth.set_current(auth.user(uid))
            try:
                montage._can_edit_lut({"id": "lut-x"}, trash=trash)
                ok(want is None, f"montage : une LUT sans auteur, {uid} {'la jette' if trash else 'la change'} : refusé attendu")
            except http.HttpError as e:
                ok(e.status == want, f"montage : une LUT sans auteur, {uid} {'la jette' if trash else 'la change'} ({e.status})")
            finally:
                auth.set_current(None)

        # ── PIL ne devine rien : un masque EPS déguisé ─────────
        try:
            image.save_mask("data:image/png;base64," + base64.b64encode(eps).decode())
            ok(False, "image : un masque EPS est refusé")
        except ValueError:
            ok(True, "image : un masque qui n'est pas un PNG est refusé (PIL n'appelle pas Ghostscript)")
        sniff = getattr(library, "sniff", None)
        ok(sniff and sniff(png()[:16], ".png") and not sniff(eps[:16], ".png"), "library.sniff : la signature PNG")
        ok(json.loads(json.dumps(getattr(library, "PIL_FORMATS", []))) == ["PNG", "JPEG", "WEBP"], "PIL ne lit que PNG, JPEG, WEBP")

        # ── Teams et Workspaces : qui voit, qui écrit, par Asset et par chaque outil ──
        _workspaces(ok, err, png, a, b, c, gv, ga, cy, wsc)
    finally:
        for jid in queued:
            try:
                jobs.cancel(jid)
            except (KeyError, TypeError):
                pass
        auth.set_current(None)
        auth.set_current_space(None)
        jobs.set_mode(None, "active")
        auth.set_settings({"visibility": "all"}, by="cal")
        config.CFG["auth"] = before
        config.CFG["upload_max_mb"] = max_mb
        if essai is None:
            config.CFG.pop("equipes_guests_essai", None)
        else:
            config.CFG["equipes_guests_essai"] = essai
        if max_json is not None:
            http.MAX_JSON = max_json


def _space_role(uid: str, space: str) -> str | None:
    from core import auth, espaces
    return espaces.space_role(auth.user(uid), space)


def _wav(freq: int = 330, secs: float = 0.4) -> bytes:
    import io
    import math
    import struct
    import wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * freq * k / 16000)))
                               for k in range(int(16000 * secs))))
    return buf.getvalue()


def _workspaces(ok, err, png, a, b, c, gv, ga, cy, wsc) -> None:
    """A dans Général ; B' guest viewer (Gil), B'' guest acteur (Gaël) ; C d'une autre Team (Cyril) —
    pour Asset et chaque outil qui a des documents : le Workspace posé à la création, qui voit, qui
    écrit, qui crée, qui jette ; la borne du Workspace courant ; montrer, jugé par l'objet."""
    import json

    from core import auth, library
    from tools import ideation, montage, music, transcrire

    hc = {"X-SR-Espace": wsc}

    # ── ce que A crée, dans Général ──
    s1, im = a("PUT", "/api/library/upload?name=w.png&title=Image+de+G%C3%A9n%C3%A9ral", raw=png((200, 30, 30)),
               headers={"Content-Type": "image/png"})
    s2, pj = a("POST", "/api/music/projects", {"name": "ODIO de Général"})
    s3, sq = a("POST", "/api/montage/projects", {"name": "Séquence de Général"})
    s4, bd = a("POST", "/api/ideation/boards", {"name": "Planche de Général"})
    cube = montage._test_cube(2, lambda r, g, bl: (r, g, bl)).encode()
    s5, lut = a("PUT", "/api/montage/luts?name=essai.cube&title=LUT+de+G%C3%A9n%C3%A9ral", raw=cube,
                headers={"Content-Type": "application/octet-stream"})
    tid = "trn-20260930-120000-7e57"
    with transcrire._lock:
        transcrire._write({"id": tid, "rev": 1, "created": library.now(), "updated": library.now(), "title": "Transcription de Général",
                           "item": im.get("id"), "kind": "audio", "duration": 1.0, "thumb_url": None, "lang": "fr", "detected": "fr",
                           "mode": "rapide", "speakers_on": False, "state": "done", "settings": {"cpl": 42, "max_s": 7.0},
                           "segments": [{"id": "s0001", "a": 0.0, "b": 1.0, "text": "bonjour", "spk": None, "words": []}],
                           "speakers": [], "translations": {}, "owner": "albane", "space": GENERAL})
    seq_it = library._items.get(sq.get("id", ""), {})
    board_file = json.loads(ideation._path(bd.get("id", "ide-00000000-000000-0000")).read_text(encoding="utf-8")) if s4 == 200 else {}
    ok((s1, s2, s3, s4, s5) == (200,) * 5 and im.get("space") == GENERAL and pj.get("space") == GENERAL
       and seq_it.get("space") == GENERAL and board_file.get("space") == GENERAL and lut.get("space") == GENERAL,
       f"espaces : ce que A crée porte son Workspace — image, projet ODIO, séquence, planche, LUT "
       f"({s1} {s2} {s3} {s4} {s5} · {im.get('space')} {pj.get('space')} {seq_it.get('space')} {board_file.get('space')} "
       f"{lut.get('space') if isinstance(lut, dict) else lut})")
    iid, pid, sid, bid, lid = im.get("id"), pj.get("id"), sq.get("id"), bd.get("id"), lut.get("id")

    # ── qui voit ──
    for nom, r in (("Gil (guest viewer)", gv), ("Gaël (guest acteur)", ga)):
        got = (r("GET", f"/api/library/{iid}")[0], r("GET", f"/api/music/projects/{pid}")[0],
               r("GET", f"/api/montage/projects/{sid}")[0], r("GET", f"/api/ideation/boards/{bid}")[0],
               r("GET", f"/api/transcrire/docs/{tid}")[0])
        luts = [x["id"] for x in r("GET", "/api/montage/luts")[1].get("luts", [])]
        ok(got == (200,) * 5 and lid in luts, f"espaces : {nom} voit l'image, le projet, la séquence, la planche, "
                                              f"la transcription, la LUT de Général ({got} {lid in luts})")
    got = (cy("GET", f"/api/library/{iid}")[0], cy("GET", f"/api/music/projects/{pid}")[0],
           cy("GET", f"/api/montage/projects/{sid}")[0], cy("GET", f"/api/ideation/boards/{bid}")[0],
           cy("GET", f"/api/transcrire/docs/{tid}")[0])
    lists = {"asset": [x["id"] for x in cy("GET", "/api/library")[1].get("items", [])],
             "odio": [x["id"] for x in cy("GET", "/api/music/projects")[1].get("projects", [])],
             "montage": [x["id"] for x in cy("GET", "/api/montage/projects")[1].get("projects", [])],
             "ideation": [x["id"] for x in cy("GET", "/api/ideation/boards")[1].get("boards", [])],
             "transcrire": [x["id"] for x in cy("GET", "/api/transcrire/docs")[1].get("docs", [])],
             "luts": [x["id"] for x in cy("GET", "/api/montage/luts")[1].get("luts", [])]}
    ok(got[:3] == (404, 404, 404) and got[3] in (403, 404) and got[4] == 404
       and not any(x in v for v in lists.values() for x in (iid, pid, sid, bid, tid, lid)),
       f"espaces : Cyril (une autre Team) ne voit rien de Général, ni par son adresse, ni dans aucune liste ({got})")
    s, d = cy("GET", "/api/library", headers={"X-SR-Espace": GENERAL})
    ok(s == 403, f"espaces : … et demander Général par l'en-tête : 403 ({s})")
    s, d = cy("GET", f"/library/{iid}/main.png")
    ok(s == 404, f"espaces : … ni son fichier sous /library/ ({s})")

    # ── qui écrit, qui crée ──
    cur = lambda r, path: r("GET", path)[1]   # noqa: E731
    pj1, sq1, bd1 = cur(a, f"/api/music/projects/{pid}"), cur(a, f"/api/montage/projects/{sid}"), cur(a, f"/api/ideation/boards/{bid}")
    viewer = (gv("POST", f"/api/library/{iid}", {"title": "par Gil"})[0],
              gv("POST", f"/api/music/projects/{pid}", pj1)[0],
              gv("POST", f"/api/montage/projects/{sid}", {**sq1, "base_rev": sq1.get("rev")})[0],
              gv("POST", f"/api/ideation/boards/{bid}", {**bd1, "base_rev": bd1.get("rev")})[0],
              gv("POST", f"/api/transcrire/docs/{tid}", {"rev": 1, "title": "par Gil"})[0],
              gv("POST", f"/api/montage/luts/{lid}", {"title": "par Gil"})[0])
    s, d = gv("POST", f"/api/library/{iid}", {"title": "par Gil"})
    ok(viewer == (403,) * 6 and "viewer" in err(d),
       f"espaces : Gil, guest viewer, ne modifie rien — image, projet, séquence, planche, transcription, LUT ({viewer} {err(d)[:80]})")
    made = (gv("PUT", "/api/library/upload?name=g.png&title=De+Gil", raw=png((1, 2, 3)), headers={"Content-Type": "image/png"})[0],
            gv("POST", "/api/music/projects", {"name": "de Gil"})[0], gv("POST", "/api/montage/projects", {"name": "de Gil"})[0],
            gv("POST", "/api/ideation/boards", {"name": "de Gil"})[0], gv("POST", "/api/analyse/projets", {"nom": "de Gil"})[0])
    ok(made == (403,) * 5, f"espaces : … ni ne crée — dépôt, projet, séquence, planche, analyse ({made})")
    acteur = (ga("POST", f"/api/library/{iid}", {"title": "Image de Général"})[0],
              ga("POST", f"/api/music/projects/{pid}", pj1)[0],
              ga("POST", f"/api/montage/projects/{sid}", {**sq1, "base_rev": sq1.get("rev")})[0],
              ga("POST", f"/api/ideation/boards/{bid}", {**bd1, "base_rev": bd1.get("rev")})[0],
              ga("POST", f"/api/transcrire/docs/{tid}", {"rev": 1, "title": "par Gaël"})[0],
              ga("POST", f"/api/montage/luts/{lid}", {"title": "LUT de Général"})[0])
    ok(acteur == (200,) * 6, f"espaces : Gaël, guest acteur, modifie — image, projet, séquence, planche, transcription, LUT ({acteur})")
    s, up = ga("PUT", "/api/library/upload?name=ga.png&title=De+Ga%C3%ABl", raw=png((4, 5, 6)), headers={"Content-Type": "image/png"})
    s2, pg = ga("POST", "/api/music/projects", {"name": "de Gaël"})
    ok(s == 200 and up.get("space") == GENERAL and up.get("owner") == "gael-acteur" and s2 == 200 and pg.get("space") == GENERAL,
       f"espaces : … crée dans Général, à son nom ({s} {s2} {up.get('space') if isinstance(up, dict) else ''})")
    jet = (ga("POST", f"/api/library/{iid}/delete")[0], ga("POST", f"/api/music/projects/{pid}/delete")[0],
           ga("POST", f"/api/transcrire/docs/{tid}/delete")[0], ga("POST", f"/api/montage/luts/{lid}/delete")[0])
    s, _ = ga("POST", f"/api/library/{up.get('id')}/delete")
    ok(jet == (403,) * 4 and s == 200 and library.get(iid) is not None,
       f"espaces : … ne jette pas ce qui est à A (l'auteur, ou un admin du Workspace), jette le sien ({jet} {s})")
    wr = (cy("POST", f"/api/library/{iid}", {"title": "par Cyril"})[0], cy("POST", f"/api/music/projects/{pid}", pj1)[0],
          cy("POST", f"/api/transcrire/docs/{tid}", {"rev": 2, "title": "x"})[0])
    ok(wr == (404, 404, 404), f"espaces : Cyril n'écrit rien dans Général : pour lui, rien n'existe ({wr})")
    raw_board = json.loads(ideation._path(bid).read_text(encoding="utf-8"))
    kept = json.loads(music._path(pid).read_text(encoding="utf-8"))
    ok(raw_board.get("space") == GENERAL and kept.get("space") == GENERAL and kept.get("owner") == "albane",
       f"espaces : réécrits par d'autres, planche et projet gardent leur Workspace et leur auteur "
       f"({raw_board.get('space')} {kept.get('space')} {kept.get('owner')})")

    # ── la borne du Workspace courant ; montrer, jugé par l'objet ──
    s, ic = cy("PUT", "/api/library/upload?name=c.png&title=De+Cyril", raw=png((7, 7, 7)), headers={"Content-Type": "image/png"})
    s2, sc = cy("PUT", "/api/library/upload?name=c.wav&title=Son+de+Cyril", raw=_wav(), headers={"Content-Type": "audio/wav"})
    ok(s == 200 and s2 == 200 and ic.get("space") == wsc and sc.get("space") == wsc,
       f"espaces : ce que Cyril crée est dans son Workspace ({s} {s2} {ic.get('space') if isinstance(ic, dict) else ic})")
    cid, sid2 = ic.get("id"), sc.get("id")
    got = (c("GET", f"/api/library/{cid}")[0], c("GET", f"/api/library/{cid}", headers=hc)[0])
    ok(got == (404, 200), f"espaces : Cal lui-même n'atteint un objet que dans son Workspace (sans en-tête : Général ; "
                          f"avec celui de Cyril : oui) ({got})")
    shown = (c("GET", f"/library/{cid}/main.png")[0], c("GET", f"/api/son/apercu/{sid2}?v=1")[0],
             a("GET", f"/library/{cid}/main.png")[0], a("GET", f"/api/son/apercu/{sid2}?v=1")[0])
    ok(shown[0] == 200 and shown[1] in (200, 422) and shown[2:] == (404, 404),
       f"espaces : montrer (un fichier sous /library/, l'aperçu d'un son) se juge par l'objet, sans en-tête : Cal qui "
       f"voit tout, oui ; A, qui n'est pas dans ce Workspace, non ({shown})")
    auth.set_current(auth.user("cal"))
    auth.set_current_space(GENERAL)
    try:
        here = {x["id"] for x in library.query(limit=100000)["items"]}
        everywhere = {x["id"] for x in library.query(limit=100000, spaces="*")["items"]}
        ok(iid in here and cid not in here and {iid, cid} <= everywhere,
           "espaces : library.query liste le Workspace courant ; spaces=\"*\" (pour montrer) : tous ceux qu'on voit")
    finally:
        auth.set_current(None)
        auth.set_current_space(None)
    auth.set_current(auth.user("albane"))
    auth.set_current_space(GENERAL)
    try:
        ok(cid not in {x["id"] for x in library.query(limit=100000, spaces="*")["items"]},
           "espaces : … jamais un Workspace qu'on ne voit pas")
    finally:
        auth.set_current(None)
        auth.set_current_space(None)
    # un travail de Cyril (la file pose sa personne et son Workspace le temps du run) : il ne lit pas Général
    auth.set_current(auth.user("cyril-ailleurs"))
    auth.set_current_space(wsc)
    try:
        ok(library.get(iid) is None and library.get(cid) is not None and library.new_space({"tool": "essai"}) == wsc,
           "espaces : un travail n'atteint que son Workspace, et ce qu'il range y va")
    finally:
        auth.set_current(None)
        auth.set_current_space(None)

    # ── la corbeille, par Workspace ──
    s, _ = cy("POST", "/api/asset/trash", {"ids": [cid]})
    t1 = [x["id"] for x in c("GET", "/api/asset/trash")[1].get("items", [])]
    t2 = [x["id"] for x in c("GET", "/api/asset/trash", headers=hc)[1].get("items", [])]
    s2, _ = c("POST", f"/api/library/{cid}/restore")
    ok(s == 200 and cid not in t1 and cid in t2 and s2 == 404,
       f"espaces : une corbeille par Workspace — celle de Cyril n'est pas dans celle de Général ({s} {s2})")
    s, r = cy("POST", "/api/asset/restore", {"ids": [cid]})
    ok(s == 200 and r.get("restored") == [cid], f"espaces : Cyril rend le sien, dans son Workspace ({s} {r})")
