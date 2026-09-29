"""Les droits des amis : le contrôle, porte allumée (tools/check.py).

Ce module n'a pas de route : il prouve, par l'API comme une page le ferait,
les règles d'écriture et de lecture du portail quand des amis entrent
(docs/etudes/apps_studio_elements.md § 2.12, audit du 29/09) :

  - un objet, un projet ODIO, un projet d'analyse, une LUT : seul son
    propriétaire (ou Cal) l'écrit ; sans propriétaire, il est à Cal
    (library.check_write, auth.can_write_item) ;
  - lire : `library.get` juge la visibilité (`visibility` = own : chacun le
    sien et ce qui est partagé) pour toutes les routes et tous les travaux ;
  - `POST /api/jobs` : une sorte inconnue → 400 ; une sorte qui a sa route
    (non `direct`) → 403 pour un ami ; une sorte `direct` juge ses réglages
    à l'entrée (jobs.register(…, direct=)) ;
  - la corbeille : chacun la sienne ; le retour en lot prend toutes les
    sortes (mid-, seq-) ; un geste en lot se fait en entier ou pas du tout ;
  - un dépôt : le contenu doit être ce que dit son nom ; la taille d'un ami
    est bornée (config `upload_max_mb`) ; un corps JSON, à 32 Mo.
"""

from __future__ import annotations


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
    max_json = getattr(http, "MAX_JSON", None)   # getattr : le contrôle tourne aussi sur le code d'avant (trous rouverts)
    config.CFG["auth"] = True
    auth.startup()
    with auth._lock:
        auth._hits.clear()   # les limites de débit des contrôles d'avant (compte.py) : un autre essai
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    jobs.register("droits.route", lambda ctx: {"note": "ok"}, lane="cpu", title="Essai : une sorte qui a sa route")

    def direct_check(p):
        if not isinstance(p.get("n"), int):
            raise ValueError("n : un entier")

    try:
        jobs.register("droits.direct", lambda ctx: {"note": "ok"}, lane="cpu", title="Essai : une sorte directe",
                      direct=direct_check)
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

        def a(method, path, body=None, **kw):
            return H(method, path, body, cookie=A, headers={**same, **kw.pop("headers", {})}, **kw)[:2]

        def b(method, path, body=None, **kw):
            return H(method, path, body, cookie=B, headers={**same, **kw.pop("headers", {})}, **kw)[:2]

        def c(method, path, body=None, **kw):
            return H(method, path, body, cookie=cal, headers={**same, **kw.pop("headers", {})}, **kw)[:2]

        # ── ODIO : le projet de A ────────────────────────────
        s, p = a("POST", "/api/music/projects", {"name": "Projet d'Albane"})
        ok(s == 200 and p.get("owner") == "albane", f"ODIO : le projet est à qui le crée ({s} {p.get('owner') if isinstance(p, dict) else p})")
        pid = p.get("id", "")
        s, got = b("GET", f"/api/music/projects/{pid}")
        ok(s == 200, f"ODIO : B le lit (visibility = all) ({s})")
        s, d = b("POST", f"/api/music/projects/{pid}", got)
        ok(s == 403 and "Albane" in err(d), f"ODIO : B ne l'enregistre pas ({s} {d})")
        s, _ = b("POST", f"/api/music/projects/{pid}/delete")
        ok(s == 403 and music._path(pid).exists(), f"ODIO : B ne le met pas à la corbeille ({s})")
        got["owner"] = "bastien"
        s, d = a("POST", f"/api/music/projects/{pid}", got)
        s2, again = a("GET", f"/api/music/projects/{pid}")
        ok(s == 200 and again.get("owner") == "albane", f"ODIO : A l'enregistre ; le propriétaire ne vient pas de la page ({s} {again.get('owner')})")
        s, d = c("POST", f"/api/music/projects/{pid}", again)
        ok(s == 200, f"ODIO : Cal enregistre tout ({s})")
        old = music.empty("D'avant la porte")
        old.update(id="mus-20260101-000000-0a0a", rev=1, created=library.now(), updated=library.now())
        music._write(old)
        s, _ = a("POST", f"/api/music/projects/{old['id']}", old)
        ok(s == 403, f"ODIO : un projet sans propriétaire est à Cal ({s})")
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

        # ── Object Creator : un mesh ne s'ajoute qu'à son objet ──
        s, img = a("PUT", "/api/library/upload?name=botte.png&title=Botte", raw=png(), headers={"Content-Type": "image/png"})
        s2, obj = a("POST", "/api/objet/objects", {"title": "Botte", "item": img.get("id")})
        ok(s == 200 and s2 == 200 and obj.get("owner") == "albane", f"objet : A fait un objet ({s} {s2})")
        s, d = b("POST", "/api/jobs", {"kind": "objet.mesh_factice", "params": {"element": obj.get("id")}})
        ok(s == 403, f"objet : B ne lance pas de mesh sur l'objet de A ({s} {d})")
        s, j = a("POST", "/api/jobs", {"kind": "objet.mesh_factice", "params": {"element": obj.get("id")}})
        ok(s == 200, f"objet : A, oui ({s} {j})")
        queued.append(j.get("id"))

        # ── Asset : la planche, CF, les lots ──────────────────
        s, bimg = b("PUT", "/api/library/upload?name=b.png&title=De+Bastien", raw=png((9, 9, 200)), headers={"Content-Type": "image/png"})
        s, el = a("POST", "/api/elements", {"title": "Perso A", "type": "character", "refs": [{"item": img["id"], "role": "face"}]})
        ref0 = (el.get("element") or {}).get("refs", [{}])[0].get("file", "")
        s, d = b("POST", f"/api/asset/refs/{el.get('id')}", {"refs": []})
        ok(s == 403 and library.get(el["id"])["element"]["refs"], f"asset : B ne vide pas la planche de A ({s})")
        s, d = b("POST", "/api/asset/cf/refresh", {"id": el.get("id")})
        ok(s == 403 and (library.folder_of(el["id"]) / ref0).is_file(), f"asset : B ne remet pas à jour l'élément de A, rien n'est effacé ({s})")
        s, d = b("POST", "/api/asset/bulk", {"ids": [bimg["id"], img["id"]], "fav": True})
        ok(s == 403 and not library.get(bimg["id"]).get("fav"), f"asset : un lot qui touche l'objet de A : rien n'est fait ({s})")
        s, d = b("POST", "/api/asset/move", {"ids": [bimg["id"], img["id"]], "folder": "Volé"})
        ok(s == 403 and not library.get(bimg["id"]).get("folder"), f"asset : ranger en lot, de même ({s})")
        a("POST", "/api/asset/move", {"ids": [img["id"]], "folder": "Commun"})
        b("POST", "/api/asset/move", {"ids": [bimg["id"]], "folder": "Commun"})
        s, d = b("POST", "/api/asset/folders/rename", {"from": "Commun", "to": "Chez Bastien"})
        ok(s == 200 and d.get("renamed") == 1 and d.get("kept") == 1 and library.get(img["id"])["folder"] == "Commun",
           f"asset : renommer un dossier renomme les siens, pas ceux de A ({s} {d})")
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
        http.MAX_JSON = 2000
        s, d = a("POST", "/api/music/projects", {"name": "x" * 3000})
        ok(s == 413, f"un corps JSON au-delà de MAX_JSON : 413 ({s})")
        if max_json is not None:
            http.MAX_JSON = max_json

        # ── Movie Analysis ────────────────────────────────────
        s, pr = a("POST", "/api/analyse/projets", {"nom": "Film d'Albane"})
        apid = ((pr or {}).get("projet") or {}).get("id", "")
        s1, _ = b("POST", f"/api/analyse/projets/{apid}", {"nom": "Renommé par B"})
        s2, _ = a("POST", f"/api/analyse/projets/{apid}", {"nom": "Renommé par A"})
        ok(s == 200 and s1 == 403 and s2 == 200, f"analyse : un projet est à son auteur ({s} {s1} {s2})")
        s, _ = b("POST", "/api/analyse/diar/analyse", raw=b"x", headers={"Content-Type": "audio/wav"})
        ok(s == 403, f"analyse : la diarisation directe (hors file) est à Cal ({s})")
        ok(analyse.NOM.match("abc\n") is None and analyse.NOM_PROJET.match("abc\n") is None,
           "analyse : un nom ne finit pas par un retour à la ligne")

        # ── Montage : une LUT sans auteur est à Cal ───────────
        auth.set_current(auth.user("bastien"))
        try:
            montage._can_edit_lut({"id": "lut-x"})
            ok(False, "montage : une LUT sans auteur n'est pas à tous")
        except http.HttpError as e:
            ok(e.status == 403, "montage : une LUT sans auteur est à Cal")
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
    finally:
        for jid in queued:
            try:
                jobs.cancel(jid)
            except (KeyError, TypeError):
                pass
        auth.set_current(None)
        jobs.set_mode(None, "active")
        auth.set_settings({"visibility": "all"}, by="cal")
        config.CFG["auth"] = before
        config.CFG["upload_max_mb"] = max_mb
        if max_json is not None:
            http.MAX_JSON = max_json
