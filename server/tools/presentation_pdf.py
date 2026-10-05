"""Une présentation d'Idéation en PDF, et en images (06/10/2026) : le travail `presentation.pdf`.

La demande : exporter une présentation fidèle à ce que montre le mode Présentation, sans Ming
(docs/REPRISE.md § 2.E « Slides : publication et PDF » ; docs/etudes/presentations_motion.md § 7 ;
agent_design.md D5 : « Chromium sans affichage sur DGX2, le même rendu que l'export PNG et PDF »).

Juste par construction, le PDF n'est pas un second dessin : Chromium sans affichage, sur la machine
du portail, ouvre LA page de lecture (ideation/presentation/lecture.html?print), qui se sert de
scene.js comme le mode et le lecteur. Chaque diapositive y est à son état final (aucune entrée
jouée : l'état « Fin » de la minuterie, celui de prefers-reduced-motion), à la taille de sa scène (une
page nommée par taille : 16:9 = 1920 × 1080 px = 1440 × 810 pt, 4:3, 1:1, 9:16), polices chargées
(document.fonts.ready), images décodées. `page.pdf` de Chromium en fait le PDF — textes et formes
vectoriels, une page par diapositive ; en option une capture PNG par page, aux mêmes règles d'impression.

Les données ne passent pas par l'API : le travail lit la planche, les réglages et les fiches de ses
objets au nom de la personne, dans le Workspace de la planche (comme ideation.export), et les donne au
script (tools/presentation_export.mjs), qui les sert à la page par page.route comme l'API l'aurait fait ;
seuls les fichiers de ces objets se servent, depuis leur dossier. Ni session ni jeton : rien n'est ouvert
de plus (agent_design.md § 4.4 posait la question d'un « jeton de lecture »). Les pages statiques viennent
du portail lui-même, sur la boucle locale (elles se servent sans session).

Où sont node, Playwright et Chromium (showrunner.local.json, avec leur défaut) :
  presentation_node        le binaire node (défaut : `node` du PATH du portail) ;
  presentation_playwright  le dossier d'où node résout `playwright` (défaut : ~/Character_Sheet, celui de
                           tools/shot.mjs sur DGX2 — CLAUDE.md, « Captures d'écran » —, puis les modules
                           globaux du node trouvé) ;
  presentation_chromium    un Chromium de la machine à lancer à la place de celui de Playwright (défaut : le sien).
Absent, le mode le dit sur son bouton (GET /api/ideation/presentation/pdf), le travail échoue en le disant ;
Admin → Diagnostics → « Présentation · PDF » cherche les trois et lance Chromium.

Les polices : chacune déclare ce que sa licence permet (ideation.FONTS, `pdf`). Un PDF embarque ses
polices : une police dont la licence ne permet pas le PDF (Venus Rising, Norelli) le refuse, en disant
laquelle et sur quelles diapositives ; les images PNG restent possibles (le mode le dit avant de lancer).

Ce qui ne s'imprime pas (scene.js, `print`) : une vidéo montre son affiche, un objet Web l'image de son
aperçu, un son son onde — chacun avec un pied discret (« vidéo », « web · site », « son »).

Le résultat, dans le dossier « Idéation » de la bibliothèque, au Workspace de la planche (ctx.add) :
le PDF, un `document` (server/tools/documents.py : son texte, sa couverture ; sans poppler, le texte de
chaque diapositive lu dans la page et la première diapositive en couverture), lignée = les objets de la
présentation ; en option une image par diapositive (`image`, lignée = les objets de la diapositive).

Routes :
  GET  /api/ideation/presentation/pdf            {ok, why, node, playwright, version, chromium}
  POST /api/ideation/boards/<id>/pdf {pdf, png}   le travail (400 : rien demandé ; 409 : aucune diapositive)
"""

from __future__ import annotations

import json
import os
import queue
import re
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path

from core import auth, config, jobs, library
from core.http import HttpError

REPO = Path(config.REPO)
SCRIPT = REPO / "tools" / "presentation_export.mjs"
PAGE = "ideation/presentation/lecture.html?print#{bid}"
PROBE_TTL = 300          # s : la réponse de la machine, gardée (le bouton la lit à chaque entrée dans le mode)
PROBE_TIMEOUT = 40
RUN_TIMEOUT = 900        # s : un export entier (Chromium, le PDF, les images)
FOLDER = "Idéation"

_probe: dict = {"t": 0.0, "key": None, "v": None}
_plock = threading.Lock()


# ── la machine : node, Playwright, Chromium ──────────────────
def node_bin() -> str | None:
    v = str(config.get("presentation_node") or "").strip()
    if not v:
        return shutil.which("node")
    p = Path(v).expanduser()
    if "/" in v:
        return str(p) if p.is_file() and os.access(p, os.X_OK) else None
    return shutil.which(v)


def playwright_bases(node: str | None) -> list[str]:
    """Les dossiers d'où node résout `playwright`, dans l'ordre : le réglage seul s'il est posé."""
    v = str(config.get("presentation_playwright") or "").strip()
    if v:
        return [str(Path(v).expanduser())]
    out = [str(Path.home() / "Character_Sheet")]
    if node:
        out.append(str(Path(node).resolve().parent.parent / "lib" / "node_modules"))
    return out


def chromium_path() -> str:
    v = str(config.get("presentation_chromium") or "").strip()
    return str(Path(v).expanduser()) if v else ""


def _config_key() -> tuple:
    return (config.get("presentation_node"), config.get("presentation_playwright"), config.get("presentation_chromium"))


def state(fresh: bool = False, launch: bool = False) -> dict:
    """La machine du portail sait-elle faire un PDF ? {ok, why, node, playwright, version, chromium} ;
    gardé PROBE_TTL secondes (`fresh` : relu ; `launch` : Chromium lancé pour de bon, le diagnostic)."""
    key = _config_key()
    with _plock:
        if not fresh and not launch and _probe["v"] and _probe["key"] == key and time.time() - _probe["t"] < PROBE_TTL:
            return dict(_probe["v"])
    node = node_bin()
    v = {"ok": False, "why": "", "node": node, "playwright": None, "version": "", "chromium": None}
    if not node:
        v["why"] = (f"le node réglé n'existe pas ({config.get('presentation_node')}) — réglage presentation_node de showrunner.local.json"
                    if config.get("presentation_node") else
                    "node n'est pas sur la machine du portail — réglage presentation_node de showrunner.local.json : le chemin du binaire")
    elif not SCRIPT.is_file():
        v["why"] = f"le script d'export manque ({SCRIPT.relative_to(REPO)})"
    else:
        arg = json.dumps({"bases": playwright_bases(node), "chromium": chromium_path(), "launch": launch})
        try:
            r = subprocess.run([node, str(SCRIPT), "--probe", arg], cwd=str(REPO), capture_output=True, text=True,
                               timeout=PROBE_TIMEOUT + (60 if launch else 0))
            got = _last_json(r.stdout)
            if got.get("t") == "probe":
                v.update({k: got.get(k) for k in ("ok", "why", "playwright", "version", "chromium", "browser", "pdf_bytes") if k in got})
                if not got.get("ok") and "Playwright introuvable" in str(got.get("why")):
                    v["why"] += " — réglage presentation_playwright : le dossier d'où node le résout (comme tools/shot.mjs)"
                elif not got.get("ok") and "Chromium" in str(got.get("why")):
                    v["why"] += " — réglage presentation_chromium : un Chromium de la machine"
            else:
                v["why"] = f"node ne répond pas comme prévu ({(got.get('message') or r.stderr.strip()[-300:] or r.returncode)})"
        except (OSError, subprocess.TimeoutExpired) as e:
            v["why"] = f"node ne se lance pas ({type(e).__name__} : {e})"[:400]
    v["ok"] = bool(v.get("ok"))
    if not launch:
        with _plock:
            _probe.update(t=time.time(), key=key, v=dict(v))
    return v


def _last_json(out: str) -> dict:
    for line in reversed((out or "").strip().splitlines()):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if isinstance(d, dict):
            return d
    return {}


def refused_fonts() -> list[dict]:
    """Les polices dont la licence ne permet pas le PDF (ideation.FONTS) : {family, why}."""
    from tools import ideation as ide
    return [{"family": f["family"], "why": f"sa licence ({f['licence']}) ne permet pas le PDF" + (f" — {f['note']}" if f.get("note") else "")}
            for f in ide.FONTS if not f.get("pdf")]


# ── les routes ───────────────────────────────────────────────
def r_state(req):
    fresh = req.q("frais") == "1" and auth.is_admin(getattr(req, "user", None) or auth.current())
    st = state(fresh=fresh)
    return {**st, "refused_fonts": refused_fonts()}


def _slides(b: dict) -> list[dict]:
    return [n for n in b["nodes"] if n["type"] == "frame" and n.get("deck") and not n.get("skip")]


def r_pdf(req, bid):
    """Lance l'export : le PDF (`pdf`, vrai par défaut) et/ou une image par diapositive (`png`). La
    garde du calcul juge dans jobs.submit (au Workspace de la planche, comme ideation.export) ; Chromium
    absent, le travail le dit dès son départ (le mode le dit avant, sur son bouton)."""
    from tools import elements
    from tools import ideation as ide
    ide._need(req, bid, "see")
    d = req.json()
    if not isinstance(d, dict):
        raise HttpError(400, "{pdf, png} attendu")
    want_pdf, want_png = d.get("pdf", True) is not False, d.get("png") is True
    if not (want_pdf or want_png):
        raise HttpError(400, "rien à exporter : le PDF, les images, ou les deux")
    b = ide.normalize(ide.load(bid))
    if not _slides(b):
        raise HttpError(409, "aucune diapositive à exporter : le panneau Diapositives en fait (+ Diapositive)")
    space = ide.board_space(bid)
    elements.check_space(bid, b, space)
    what = "PDF" if want_pdf else "Images"
    j = jobs.submit("presentation.pdf", {"board": bid, "rev": b.get("rev"), "pdf": want_pdf, "png": want_png},
                    title=f"{what} · {b['name']}", tool="ideation", space=space)
    return jobs.public(j)


# ── le travail ───────────────────────────────────────────────
def _snapshot(b: dict, space: str | None) -> tuple[dict, dict, dict, dict, list[str]]:
    """Ce que la page d'impression demande à l'API, lu ici au nom de la personne (le Workspace du
    travail) : {clé « MÉTHODE chemin » : réponse}, les dossiers des objets, les images des objets Web,
    les ondes des sons ; et les objets de la bibliothèque posés (la lignée)."""
    from tools import apercu_son, web_apercu
    from tools import ideation as ide
    ids = list(dict.fromkeys(n["item"] for n in b["nodes"] if n["type"] == "media" and n.get("item")))
    items, missing, files, waves = [], [], {}, {}
    for i in ids:
        it = library.get(i)
        if not it:
            missing.append(i)
            continue
        items.append(library.public(it))
        folder = library.folder_of(i)
        files[i] = str(folder)
        if it.get("kind") == "audio" and (folder / apercu_son.wave_name()).is_file():
            waves[i] = str(folder / apercu_son.wave_name())
    web = {}
    for n in b["nodes"]:
        if n["type"] == "web" and n.get("img"):
            f = web_apercu.image_file(n["img"])
            if f:
                web[n["img"]] = str(f)
    api = {f"GET ideation/boards/{b['id']}": {**b, "space": space},
           "GET ideation/meta": ide.r_meta(None),
           "POST library/batch": {"items": items, "missing": missing}}
    return api, files, web, waves, [it["id"] for it in items]


def _prefs(uid: str | None) -> dict:
    """Le thème de la personne (une scène sans modèle prend les jetons du thème) ; la taille de
    l'interface reste à 100 % (le zoom changerait la scène)."""
    if not uid:
        return {}
    from tools import prefs
    try:
        p = prefs.read(uid).get("prefs") or {}
    except HttpError:
        return {}
    g = p.get("general") if isinstance(p.get("general"), dict) else {}
    out: dict = {"general": {"theme": g.get("theme")} if g.get("theme") else {}}
    if isinstance(p.get("theme"), dict):
        out["theme"] = p["theme"]
    return out


def _base_url() -> str:
    host = str(config.get("host") or "127.0.0.1")
    if host in ("0.0.0.0", "", "::"):
        host = "127.0.0.1"
    return f"http://{host}:{int(config.get('port'))}/"


def _kill(p: subprocess.Popen) -> None:
    try:
        os.killpg(p.pid, signal.SIGKILL)   # node et le Chromium qu'il a lancé
    except (OSError, ProcessLookupError):
        try:
            p.kill()
        except OSError:
            pass


def _node_run(ctx, node: str, spec_path: Path) -> dict:
    """Lance le script, suit sa progression (une ligne JSON par pas), l'arrête si on arrête le travail."""
    p = subprocess.Popen([node, str(SCRIPT), str(spec_path)], cwd=str(REPO), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, start_new_session=True)
    lines: queue.Queue = queue.Queue()
    err: list[str] = []
    threading.Thread(target=lambda: [lines.put(x) for x in p.stdout] + [lines.put(None)], daemon=True).start()
    threading.Thread(target=lambda: [err.append(x) for x in p.stderr], daemon=True).start()
    t0, last = time.time(), {}
    try:
        while True:
            ctx.check()
            if time.time() - t0 > RUN_TIMEOUT:
                raise RuntimeError(f"Chromium n'a pas fini en {RUN_TIMEOUT // 60} min")
            try:
                line = lines.get(timeout=0.4)
            except queue.Empty:
                continue
            if line is None:
                break
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if d.get("t") == "progress":
                ctx.progress(0.05 + 0.83 * max(0.0, min(1.0, float(d.get("p") or 0))), str(d.get("m") or "")[:120])
            elif d.get("t") in ("done", "error"):
                last = d
    finally:
        if p.poll() is None:
            _kill(p)
        p.wait(timeout=10)
    if last.get("t") == "error":
        raise RuntimeError(f"l'export n'a pas abouti : {last.get('message')}")
    if last.get("t") != "done":
        raise RuntimeError(f"l'export s'est arrêté sans rien dire ({p.returncode}) : {''.join(err)[-400:].strip()}")
    return last


def run(ctx) -> dict:
    from tools import elements
    from tools import ideation as ide
    prm = ctx.params
    bid = str(prm.get("board") or "")
    want_pdf, want_png = prm.get("pdf", True) is not False, prm.get("png") is True
    st = state()
    if not st["ok"]:
        raise RuntimeError(f"l'export demande Chromium sur la machine du portail : {st['why']}")
    b = ide.normalize(ide.load(bid))
    space = ide.board_space(bid)
    # ses entrées : les objets de la planche, lus dans le Workspace du travail (celui de la planche, r_pdf)
    if auth.current_space() and auth.current_space() != space:
        raise RuntimeError("ce rendu n'est pas du Workspace de la planche : relance-le depuis la planche")
    try:
        elements.check_space(bid, b, space)
    except HttpError as e:
        raise RuntimeError(e.message) from e
    ctx.progress(0.03, "lit la présentation")
    api, files, web, waves, parents = _snapshot(b, space)
    out = ctx.workdir
    spec = {"bases": playwright_bases(st["node"]), "chromium": chromium_path(), "base": _base_url(),
            "page": PAGE.format(bid=bid), "api": api, "files": files, "web": web, "waves": waves,
            "prefs": _prefs(ctx.job.get("owner")), "out": str(out), "pdf": want_pdf, "png": want_png,
            "pdf_refuse": refused_fonts()}
    spec_path = out / "spec.json"
    spec_path.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    got = _node_run(ctx, st["node"], spec_path)
    if got.get("refused"):
        r = got["refused"]
        sl = r.get("slides") or []
        where = f"{'diapositives' if len(sl) > 1 else 'diapositive'} {', '.join(map(str, sl))}"
        more = f" (et {', '.join(r['others'])})" if r.get("others") else ""
        raise RuntimeError(f"PDF refusé : {r.get('family')}{more}, {where} — {r.get('why') or 'sa licence ne permet pas le PDF'}. "
                           "Un modèle de présentation (onglet Modèles : polices OFL) ou une police OFL dans ce style le permet ; "
                           "les images PNG seules restent possibles")
    pages = got.get("pages") or []
    n = len(pages)
    name = b["name"]
    ctx.progress(0.9, "range dans la bibliothèque")
    base_params = {"job": "presentation.pdf", "board": bid, "rev": b.get("rev"), "slides": n}
    pdf_it = None
    if want_pdf:
        pdf = Path(got.get("pdf") or "")
        if not pdf.is_file() or pdf.stat().st_size < 200:
            raise RuntimeError("Chromium n'a pas écrit le PDF")
        pdf_it = ctx.add(pdf, kind="document", title=name, folder=FOLDER, params=base_params, parents=parents,
                         origin={"model": "chromium"})
        # sans poppler, le serveur n'a lu ni texte ni première page : la page d'impression les a
        if (pdf_it.get("doc") or {}).get("needs_page"):
            from tools import documents
            cover = Path(got.get("cover") or "")
            pdf_it = documents.deposer(pdf_it, [p.get("text") or "" for p in pages], cover=cover if cover.is_file() else None,
                                       count=n, via="chromium") or pdf_it
    pngs = []
    if want_png:
        for k, (pg, path) in enumerate(zip(pages, got.get("png") or [])):
            ctx.check()
            title = f"{name} · {k + 1:02d}" + (f" · {pg['name']}" if pg.get("name") else "")
            it = ctx.add(Path(path), kind="image", title=title, folder=FOLDER,
                         params={**base_params, "frame": pg.get("id"), "slide": k + 1},
                         parents=[i for i in pg.get("items") or [] if i in parents], origin={"model": "chromium"})
            pngs.append(it["id"])
    bits = [f"{n} diapositive{'s' if n > 1 else ''}"]
    if pdf_it:
        bits.append(f"PDF {max(1, round(Path(library.path_of(pdf_it)).stat().st_size / 1024))} Ko")
    if pngs:
        bits.append(f"{len(pngs)} image{'s' if len(pngs) > 1 else ''}")
    warn = got.get("warnings") or []
    return {"note": " · ".join(bits) + (f" — {warn[0]}" if warn else ""), "item": pdf_it["id"] if pdf_it else (pngs[0] if pngs else None),
            "pdf": pdf_it["id"] if pdf_it else None, "png": pngs, "board": bid, "pages": n, "fonts": got.get("fonts") or [],
            "warnings": warn[:10]}


def register(app) -> None:
    jobs.register("presentation.pdf", run, lane="cpu", title="Présentation · PDF", cost="cpu")
    app.route("GET", "/api/ideation/presentation/pdf", r_state)
    app.route("POST", "/api/ideation/boards/{bid}/pdf", r_pdf)


# ── le contrôle (tools/check.py) ─────────────────────────────
def _wait(call, jid: str, t: float = 240) -> dict:
    j: dict = {}
    end = time.time() + t
    while time.time() < end:
        st, j = call("GET", f"/api/jobs/{jid}")
        if st != 200 or j.get("state") in ("done", "error", "cancelled", "interrupted"):
            break
        time.sleep(0.25)
    return j


def _pdf_facts(path: Path) -> tuple[int, list[str], str]:
    """Le nombre de pages, leurs tailles (« 1440 x 810 »), le texte : poppler s'il est là (documents.py le
    cherche aussi), sinon la lecture des boîtes de page dans le fichier (Skia les écrit en clair) et pas de texte."""
    pdfinfo, pdftotext = shutil.which("pdfinfo"), shutil.which("pdftotext")
    if pdfinfo and pdftotext:
        info = subprocess.run([pdfinfo, "-f", "1", "-l", "999", str(path)], capture_output=True, text=True, timeout=60).stdout
        pages = int((re.search(r"^Pages:\s+(\d+)", info, re.M) or [0, 0])[1])
        sizes = [f"{float(a):g} x {float(b):g}" for a, b in re.findall(r"^Page\s+\d+ size:\s+([\d.]+) x ([\d.]+) pts", info, re.M)]
        text = subprocess.run([pdftotext, "-enc", "UTF-8", str(path), "-"], capture_output=True, text=True, timeout=60).stdout
        return pages, sizes, text
    raw = path.read_bytes().decode("latin-1")
    sizes = [f"{float(a):g} x {float(b):g}" for a, b in re.findall(r"/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]", raw)]
    return len(sizes), sizes, ""


def selftest(call, ok) -> None:
    from io import BytesIO
    from PIL import Image
    from tools import apercu_son
    from tools import ideation as ide
    st, s = call("GET", "/api/ideation/presentation/pdf")
    ok(st == 200 and isinstance(s.get("ok"), bool) and (s["ok"] or bool(s.get("why"))),
       f"présentation · PDF : la machine du portail dit si elle sait imprimer, sinon pourquoi ({st} {s})")
    refused = {f["family"] for f in s.get("refused_fonts", [])}
    ok(refused == {f["family"] for f in ide.FONTS if not f.get("pdf")} and "Venus Rising" in refused,
       f"présentation · PDF : les polices refusées au PDF sont celles dont FONTS dit la licence ({sorted(refused)})")
    ok(SCRIPT.is_file() and "page.pdf" in SCRIPT.read_text(encoding="utf-8"), "présentation · PDF : le script de Chromium est là")
    st, _ = call("GET", "/ideation/presentation/export.js")
    ok(st == 200, f"présentation · PDF : le bouton du mode se sert ({st})")

    # la présentation d'essai : trois diapositives — un texte, une image, une forme
    buf = BytesIO()
    im = Image.new("RGB", (800, 450), (220, 30, 30))
    im.paste((30, 40, 220), (400, 0, 800, 450))
    im.save(buf, "PNG")
    st, up = call("PUT", "/api/library/upload?name=diapo.png&title=Diapo&tool=ideation", raw=buf.getvalue())
    iid = up.get("id", "")
    st, b = call("POST", "/api/ideation/boards", {"name": "Essai export PDF"})
    bid = b["id"]
    st, r = call("POST", f"/api/ideation/boards/{bid}/pdf", {})
    ok(st == 409 and "diapositive" in str(r.get("error")), f"présentation · PDF : une planche sans diapositive le dit ({st} {r})")
    G = 2200
    nodes = [
        {"id": "f1", "type": "frame", "x": 0, "y": 0, "w": 1920, "h": 1080, "name": "Ouverture", "deck": {"ratio": "16:9", "trans": "fade"}},
        {"id": "f2", "type": "frame", "x": G, "y": 0, "w": 1920, "h": 1080, "name": "Image", "deck": {"ratio": "16:9", "trans": "fade"}},
        {"id": "f3", "type": "frame", "x": 2 * G, "y": 0, "w": 1920, "h": 1080, "name": "Forme", "deck": {"ratio": "16:9", "trans": "fade"}},
        {"id": "t1", "type": "title", "x": 96, "y": 400, "w": 1600, "h": 160, "text": "Bonjour le monde", "size": "l", "style": "h2"},
        {"id": "n1", "type": "note", "x": 96, "y": 700, "w": 1200, "h": 80, "text": "Une ligne de corps lisible", "style": "body"},
        {"id": "m1", "type": "media", "item": iid, "kind": "image", "x": G + 160, "y": 140, "w": 1600, "h": 800, "title": "Diapo"},
        {"id": "s1", "type": "shape", "kind": "ellipse", "color": "or", "x": 2 * G + 560, "y": 240, "w": 800, "h": 600, "text": "Forme ronde"},
    ]
    st, sv = call("POST", f"/api/ideation/boards/{bid}", {"name": b["name"], "v": ide.VERSION, "nodes": nodes, "links": [], "base_rev": 1})
    ok(st == 200, f"présentation · PDF : la planche d'essai ({st} {sv})")
    st, r = call("POST", f"/api/ideation/boards/{bid}/pdf", {"pdf": False, "png": False})
    ok(st == 400, f"présentation · PDF : rien demandé, rien ne part ({st} {r})")
    st, r = call("POST", "/api/ideation/boards/ide-20260101-000000-0000/pdf", {"pdf": True})
    ok(st == 404, f"présentation · PDF : une planche absente ({st})")
    st, j = call("POST", f"/api/ideation/boards/{bid}/pdf", {"pdf": True, "png": True})
    ok(st == 200 and j.get("kind") == "presentation.pdf" and j.get("lane") == "cpu" and j.get("cost") == "cpu" and j.get("tool") == "ideation",
       f"présentation · PDF : le travail part dans la file, voie cpu ({st} {j.get('kind')} {j.get('lane')} {j.get('cost')})")
    j = _wait(call, j["id"]) if st == 200 else j
    if not s["ok"]:
        ok(j.get("state") == "error" and "Chromium" in str(j.get("message")),
           f"présentation · PDF : sans Chromium, le travail le dit ({j.get('state')} {j.get('message')})")
        print(f"  (Chromium absent de cette machine : l'export n'est pas essayé ici — {s.get('why')})")
        return
    items = j.get("items") or []
    docs = [x for x in items if x["kind"] == "document"]
    imgs = [x for x in items if x["kind"] == "image"]
    ok(j.get("state") == "done" and len(docs) == 1 and len(imgs) == 3,
       f"présentation · PDF : un PDF et trois images ({j.get('state')} {j.get('message')} {[x['kind'] for x in items]})")
    if not docs:
        return
    doc = docs[0]
    ok(doc["title"] == "Essai export PDF" and doc.get("folder") == FOLDER and iid in doc.get("parents", [])
       and doc.get("origin", {}).get("tool") == "ideation" and doc.get("space") == ide.board_space(bid),
       f"présentation · PDF : le PDF est un document de la bibliothèque, dossier Idéation, au Workspace de la planche, sa lignée ({doc.get('folder')} {doc.get('parents')} {doc.get('space')})")
    it = library.get(doc["id"])
    path = library.path_of(it)
    pages, sizes, text = _pdf_facts(path)
    ok(pages == 3 and sizes == ["1440 x 810"] * 3,
       f"présentation · PDF : trois pages de la taille de la scène (1920 × 1080 px = 1440 × 810 pt) ({pages} {sizes})")
    d = it.get("doc") or {}
    if not text:
        from tools import documents
        text = documents.text_of(it) or ""
    ok(all(x in text for x in ("Bonjour le monde", "Une ligne de corps lisible", "Forme ronde")),
       f"présentation · PDF : le texte est du texte, dans le PDF ({text[:120]!r})")
    ok(d.get("has_text") and d.get("pages") == 3 and it.get("thumb") and (library.folder_of(doc["id"]) / "cover.png").is_file(),
       f"présentation · PDF : le document a son texte, ses trois pages et sa couverture ({d})")
    shot = sorted(imgs, key=lambda x: x["title"])
    ok(all((x.get("width"), x.get("height")) == (1920, 1080) for x in shot) and shot[1]["title"].endswith("02 · Image")
       and iid in shot[1].get("parents", []) and not shot[0].get("parents"),
       f"présentation · PDF : une image par diapositive, à la taille de la scène, avec les objets de la sienne "
       f"({[(x['title'], x.get('width'), x.get('height'), x.get('parents')) for x in shot]})")
    with Image.open(library.path_of(library.get(shot[1]["id"]))) as ex:
        ex = ex.convert("RGB")
        red, blue = ex.getpixel((560, 540)), ex.getpixel((1360, 540))
    ok(red[0] > 180 and red[2] < 80 and blue[2] > 180 and blue[0] < 80, f"présentation · PDF : l'image est à sa place sur sa diapositive ({red} {blue})")

    # sans poppler (DGX2 : non documenté), le serveur ne lit pas le PDF : la page d'impression lui donne son texte et sa
    # première diapositive en couverture (documents.deposer)
    was = config.CFG.get("documents_poppler")
    config.CFG["documents_poppler"] = False
    try:
        st, j = call("POST", f"/api/ideation/boards/{bid}/pdf", {"pdf": True})
        j = _wait(call, j["id"]) if st == 200 else j
    finally:
        config.CFG["documents_poppler"] = was if was is not None else True
    it2 = library.get(((j.get("items") or [{}])[0]).get("id", ""))
    d2 = (it2 or {}).get("doc") or {}
    from tools import documents
    cover = library.folder_of(it2["id"]) / "cover.png" if it2 else None
    ratio = 0.0
    if cover and cover.is_file():
        with Image.open(cover) as cv:
            ratio = round(cv.width / cv.height, 2)
    ok(j.get("state") == "done" and d2.get("via") == "chromium" and d2.get("has_text") and d2.get("pages") == 3 and not d2.get("needs_page")
       and "Forme ronde" in (documents.text_of(it2) or "") and ratio == 1.78,
       f"présentation · PDF : sans poppler, le texte de chaque diapositive et la première en couverture ({j.get('state')} {d2} {ratio})")

    # une police dont la licence refuse le PDF (un titre sans style : Venus Rising) : le PDF le dit, les images passent
    st, b2 = call("POST", "/api/ideation/boards", {"name": "Essai licence"})
    n2 = [{"id": "f1", "type": "frame", "x": 0, "y": 0, "w": 1920, "h": 1080, "name": "Une", "deck": {"ratio": "16:9"}},
          {"id": "t1", "type": "title", "x": 96, "y": 400, "w": 1400, "h": 120, "text": "Titre sans style", "size": "l"}]
    call("POST", f"/api/ideation/boards/{b2['id']}", {"name": b2["name"], "v": ide.VERSION, "nodes": n2, "links": [], "base_rev": 1})
    st, j = call("POST", f"/api/ideation/boards/{b2['id']}/pdf", {"pdf": True})
    j = _wait(call, j["id"]) if st == 200 else j
    ok(j.get("state") == "error" and "Venus Rising" in str(j.get("message")) and "diapositive 1" in str(j.get("message")) and not j.get("items"),
       f"présentation · PDF : une police que sa licence refuse au PDF le refuse, en disant laquelle et où ({j.get('state')} {j.get('message')})")
    st, j = call("POST", f"/api/ideation/boards/{b2['id']}/pdf", {"pdf": False, "png": True})
    j = _wait(call, j["id"]) if st == 200 else j
    ok(j.get("state") == "done" and [x["kind"] for x in j.get("items") or []] == ["image"],
       f"présentation · PDF : les images seules restent possibles ({j.get('state')} {j.get('message')})")

    # ce qui ne s'imprime pas : un objet Web (sans image) et un son — leur pied discret, et une diapositive 9:16
    st, snd = call("PUT", "/api/library/upload?name=essai-pdf.wav&title=Essai%20son", raw=apercu_son._wav([(1, 0.6)]))
    st, b3 = call("POST", "/api/ideation/boards", {"name": "Essai imprimable"})
    n3 = [{"id": "f1", "type": "frame", "x": 0, "y": 0, "w": 1920, "h": 1080, "name": "Web et son", "deck": {"ratio": "16:9"}},
          {"id": "w1", "type": "web", "x": 96, "y": 96, "w": 800, "h": 500, "url": "https://exemple.org/page", "title": "Une page",
           "site": "exemple.org"},
          {"id": "a1", "type": "media", "item": snd.get("id"), "kind": "audio", "x": 1000, "y": 96, "w": 800, "h": 300, "title": "Essai son"},
          {"id": "f2", "type": "frame", "x": 2200, "y": 0, "w": 1080, "h": 1920, "name": "Debout", "deck": {"ratio": "9:16"}},
          {"id": "n2", "type": "note", "x": 2300, "y": 300, "w": 800, "h": 80, "text": "Debout", "style": "body"}]
    call("POST", f"/api/ideation/boards/{b3['id']}", {"name": b3["name"], "v": ide.VERSION, "nodes": n3, "links": [], "base_rev": 1})
    st, j = call("POST", f"/api/ideation/boards/{b3['id']}/pdf", {"pdf": True})
    j = _wait(call, j["id"]) if st == 200 else j
    ok(j.get("state") == "done", f"présentation · PDF : un objet Web et un son s'impriment ({j.get('state')} {j.get('message')})")
    if j.get("state") == "done":
        it3 = library.get(j["items"][0]["id"])
        pages, sizes, text = _pdf_facts(library.path_of(it3))
        if not text:
            from tools import documents
            text = documents.text_of(it3) or ""
        ok(pages == 2 and sizes == ["1440 x 810", "810 x 1440"],
           f"présentation · PDF : chaque page à la taille de sa scène, 16:9 et 9:16 dans le même PDF ({sizes})")
        flat = " ".join(text.split()).upper()
        ok("WEB · EXEMPLE.ORG" in flat and "SON" in flat and "ESSAI SON" in flat and "UNE PAGE" in flat,
           f"présentation · PDF : leur pied discret (« web · exemple.org », « son ») et leur titre ({flat[:160]!r})")
