"""Une présentation d'Idéation en vidéo MP4 (06/10/2026) : le travail `presentation.video`.

La demande (docs/etudes/presentations_motion.md § 10) : reprendre de la note de spécification d'un
éditeur de motion design partagée par Cal le 06/10 l'export MP4 « par Chromium sans affichage sur une
page de rendu sans interface, qui pose chaque image à son instant exact et l'envoie à ffmpeg
(libx264, yuv420p, CRF 16, +faststart), après les polices et les images », avec sa progression et
son annulation — par le même chemin que le PDF (presentation_pdf.py, § 9).

Juste par construction, la vidéo n'est pas un second dessin : Chromium sans affichage ouvre LA page
de lecture en mode rendu (ideation/presentation/lecture.html?video, programme.js), qui se sert de
scene.js, moteur.js et transitions.js comme le mode et le lecteur ; pour chaque image k, la page pose
la présentation à l'instant k / fps (SR_RENDU.seek : la frise, la transition, la sortie, les vidéos à
leur image), Chromium la capture (PNG, sans perte), ffmpeg la reçoit par son entrée standard. Une image
ne dépend que de la planche et de son instant : le contrôle le vérifie (le même instant deux fois,
les mêmes pixels ; la première, la médiane et la dernière image du MP4 contre le rendu au même instant).

Les données ne passent pas par l'API (comme le PDF) : le travail lit la planche, les réglages et les
fiches de ses objets au nom de la personne et les donne au script, qui les sert à la page.

Les polices : une vidéo diffusée embarque le dessin des glyphes ; une police dont la licence ne
permet pas le PDF (ideation.FONTS, `pdf` : Venus Rising, Norelli) refuse aussi la vidéo, en disant
laquelle et sur quelles diapositives — la même règle, gardée telle quelle : la décision est à Cal.

Le résultat, dans le dossier « Idéation » de la bibliothèque, au Workspace de la planche : une
`video` (sa vignette, sa durée, sa cadence : library.add_file), lignée = les objets montrés.

Routes :
  GET  /api/ideation/presentation/pdf                       (presentation_pdf.py) dit aussi `ffmpeg`
  POST /api/ideation/boards/<id>/video {slide?, fps?, scale?, hold?}   le travail (409 : aucune diapositive)
"""

from __future__ import annotations

import json
import shutil
import subprocess
import time
from pathlib import Path

from core import auth, jobs, library
from core.http import HttpError

from tools import presentation_pdf as pdf

PAGE = "ideation/presentation/lecture.html?video{q}#{bid}"
FOLDER = pdf.FOLDER
FPS = (24, 25, 30, 50, 60)
HOLD_MAX = 20.0          # s : la pause d'une diapositive sans avance seule
DUREE_MAX = 600.0        # s : une vidéo de dix minutes au plus (au-delà, le travail le dit avant de partir)


def ffmpeg_bin() -> str | None:
    return shutil.which("ffmpeg")


def _slides(b: dict) -> list[dict]:
    return pdf._slides(b)


def _params(d: dict, b: dict) -> dict:
    """Les réglages de l'export, bornés : une diapositive (son id) ou toutes, la cadence, l'échelle
    (1 : la taille de la scène, 1920 × 1080 en 16:9 ; 2 : le double, 3840 × 2160), la pause (s)."""
    slide = d.get("slide")
    if slide is not None and slide not in {f["id"] for f in _slides(b)}:
        raise HttpError(400, "cette diapositive n'est pas dans la présentation")
    fps = d.get("fps", 30)
    if fps not in FPS:
        raise HttpError(400, f"cadence : {', '.join(map(str, FPS))} images par seconde")
    scale = d.get("scale", 1)
    if scale not in (1, 2):
        raise HttpError(400, "échelle : 1 (la taille de la scène) ou 2 (le double : 4K pour une scène 16:9)")
    hold = d.get("hold", 2)
    if isinstance(hold, bool) or not isinstance(hold, (int, float)) or not 0 <= hold <= HOLD_MAX:
        raise HttpError(400, f"pause : de 0 à {HOLD_MAX:g} s")
    return {"slide": slide, "fps": fps, "scale": scale, "hold": float(hold)}


# ── les routes ───────────────────────────────────────────────
def r_video(req, bid):
    """Lance l'export vidéo. La garde du calcul juge dans jobs.submit (au Workspace de la planche) ;
    Chromium ou ffmpeg absents, le travail le dit dès son départ (le mode le dit avant, sur son menu)."""
    from tools import elements
    from tools import ideation as ide
    ide._need(req, bid, "see")
    d = req.json()
    if not isinstance(d, dict):
        raise HttpError(400, "{slide, fps, scale, hold} attendu")
    b = ide.normalize(ide.load(bid))
    if not _slides(b):
        raise HttpError(409, "aucune diapositive à exporter : le panneau Diapositives en fait (+ Diapositive)")
    prm = _params(d, b)
    space = ide.board_space(bid)
    elements.check_space(bid, b, space)
    what = "Vidéo" if not prm["slide"] else "Vidéo · diapositive"
    j = jobs.submit("presentation.video", {"board": bid, "rev": b.get("rev"), **prm},
                    title=f"{what} · {b['name']}", tool="ideation", space=space)
    return jobs.public(j)


# ── le travail ───────────────────────────────────────────────
def _spec(b: dict, bid: str, space, kind: str, prm: dict, out: Path, owner, st: dict, **more) -> dict:
    api, files, web, waves, parents = pdf._snapshot(b, space)
    fr = _slides(b)
    first = next((f for f in fr if f["id"] == prm.get("slide")), fr[0]) if fr else {"w": 1920, "h": 1080}
    q = "".join([f"&slide={prm['slide']}" if prm.get("slide") else "", f"&hold={int(round(prm.get('hold', 2) * 1000))}"])
    return {"kind": kind, "bases": pdf.playwright_bases(st["node"]), "chromium": pdf.chromium_path(), "base": pdf._base_url(),
            "page": PAGE.format(q=q, bid=bid), "api": api, "files": files, "web": web, "waves": waves,
            "prefs": pdf._prefs(owner), "out": str(out), "size": [int(first["w"]), int(first["h"])],
            "scale": prm.get("scale", 1), "fps": prm.get("fps", 30), "ffmpeg": ffmpeg_bin(),
            "pdf_refuse": pdf.refused_fonts(), "_parents": parents, **more}


def run(ctx) -> dict:
    from tools import elements
    from tools import ideation as ide
    prm = ctx.params
    bid = str(prm.get("board") or "")
    st = pdf.state()
    if not st["ok"]:
        raise RuntimeError(f"la vidéo demande Chromium sur la machine du portail : {st['why']}")
    if not ffmpeg_bin():
        raise RuntimeError("la vidéo demande ffmpeg sur la machine du portail (il n'est pas dans le PATH du portail)")
    b = ide.normalize(ide.load(bid))
    space = ide.board_space(bid)
    if auth.current_space() and auth.current_space() != space:
        raise RuntimeError("ce rendu n'est pas du Workspace de la planche : relance-le depuis la planche")
    try:
        elements.check_space(bid, b, space)
    except HttpError as e:
        raise RuntimeError(e.message) from e
    if prm.get("slide") and prm["slide"] not in {f["id"] for f in _slides(b)}:
        raise RuntimeError("cette diapositive n'est plus dans la présentation")
    ctx.progress(0.03, "lit la présentation")
    spec = _spec(b, bid, space, "video", prm, ctx.workdir, ctx.job.get("owner"), st)
    parents = spec.pop("_parents")
    spec_path = ctx.workdir / "spec.json"
    spec_path.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    got = pdf._node_run(ctx, st["node"], spec_path)
    if got.get("refused"):
        r = got["refused"]
        sl = r.get("slides") or []
        where = f"{'diapositives' if len(sl) > 1 else 'diapositive'} {', '.join(map(str, sl))}"
        more = f" (et {', '.join(r['others'])})" if r.get("others") else ""
        why = (r.get("why") or "sa licence ne permet pas le PDF").replace("ne permet pas le PDF", "ne permet ni le PDF ni la vidéo")
        raise RuntimeError(f"vidéo refusée : {r.get('family')}{more}, {where} — {why} (une vidéo diffusée embarque le dessin des "
                           "lettres : la règle du PDF, gardée). Un modèle de présentation (onglet Modèles : polices OFL) ou une "
                           "police OFL dans ce style le permet")
    mp4 = Path(got.get("mp4") or "")
    if not mp4.is_file() or mp4.stat().st_size < 1000:
        raise RuntimeError("ffmpeg n'a pas écrit la vidéo")
    ctx.progress(0.97, "range dans la bibliothèque")
    slides = got.get("slides") or []
    title = b["name"] if not prm.get("slide") else f"{b['name']} · {slides[0]['n']:02d}" + (f" · {slides[0]['name']}" if slides and slides[0].get("name") else "")
    used = list(dict.fromkeys(i for s in slides for i in s.get("items") or []))
    it = ctx.add(mp4, kind="video", title=title, folder=FOLDER,
                 params={"job": "presentation.video", "board": bid, "rev": b.get("rev"), "slide": prm.get("slide"), "fps": got.get("fps"),
                         "scale": prm.get("scale", 1), "hold": prm.get("hold"), "frames": got.get("frames"), "slides": len(slides)},
                 parents=[i for i in used if i in parents] or parents, origin={"model": "chromium"})
    warn = got.get("warnings") or []
    secs = (got.get("frames") or 0) / max(1, got.get("fps") or 30)
    note = f"{secs:.1f} s · {got.get('w')} × {got.get('h')} · {got.get('fps')} i/s · {len(slides)} diapositive{'s' if len(slides) > 1 else ''}"
    return {"note": note + (f" — {warn[0]}" if warn else ""), "item": it["id"], "board": bid, "frames": got.get("frames"),
            "fps": got.get("fps"), "w": got.get("w"), "h": got.get("h"), "fonts": got.get("fonts") or [], "warnings": warn[:10]}


def stills(bid: str, times: list[float], *, slide: str | None = None, hold: float = 2, scale: int = 1, out: Path) -> dict:
    """Les images de la présentation aux instants `times` (ms), en PNG, par la même page et le même
    script que la vidéo (sans file : le contrôle s'en sert). Rend {stills: [{t, path}], total, …}."""
    from tools import ideation as ide

    class _Ctx:
        def check(self):
            return None

        def progress(self, *_a, **_k):
            return None

    st = pdf.state()
    if not st["ok"]:
        raise RuntimeError(st["why"])
    b = ide.normalize(ide.load(bid))
    out.mkdir(parents=True, exist_ok=True)
    spec = _spec(b, bid, ide.board_space(bid), "stills", {"slide": slide, "hold": hold, "scale": scale}, out, None, st, times=list(times))
    spec.pop("_parents")
    p = out / "spec.json"
    p.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    return pdf._node_run(_Ctx(), st["node"], p)


def register(app) -> None:
    jobs.register("presentation.video", run, lane="cpu", title="Présentation · vidéo", cost="cpu")
    app.route("POST", "/api/ideation/boards/{bid}/video", r_video)


# ── le contrôle (tools/check.py) ─────────────────────────────
def _diff(a: Path, b: Path) -> tuple[float, float]:
    """L'écart moyen (0-255, sur les trois canaux) et le PSNR (dB) de deux images de même taille."""
    from PIL import Image, ImageChops, ImageStat
    import math
    with Image.open(a) as ia, Image.open(b) as ib:
        x, y = ia.convert("RGB"), ib.convert("RGB")
        if x.size != y.size:
            return 255.0, 0.0
        st = ImageStat.Stat(ImageChops.difference(x, y))
        mse = sum(st.sum2) / (3 * x.size[0] * x.size[1])
        return sum(st.mean) / 3, (99.0 if mse == 0 else 10 * math.log10(255 * 255 / mse))


def _frames(mp4: Path, idx: list[int], out: Path) -> list[Path]:
    """Les images d'indices `idx` du MP4, extraites par ffmpeg (sélection par numéro d'image)."""
    paths = []
    for k in idx:
        p = out / f"mp4-{k:04d}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(mp4), "-vf", f"select=eq(n\\,{k})", "-frames:v", "1",
                        "-fps_mode", "passthrough", str(p)], capture_output=True, timeout=60)
        paths.append(p)
    return paths


def _valeur_js(keys: dict, prop: str, t: float):
    """La valeur d'une propriété à l'instant t, calculée par courbes.js (node) : ce que la page croit peindre."""
    node = shutil.which("node")
    if not node:
        return None
    url = (pdf.REPO / "ideation" / "presentation" / "courbes.js").as_uri()
    js = f"const C = await import({json.dumps(url)}); console.log(JSON.stringify(C.valueAt(C.cleanKeys({json.dumps(keys)})[{json.dumps(prop)}], {t})));"
    r = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, text=True, timeout=30)
    try:
        return float(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return None


def selftest(call, ok) -> None:
    import tempfile
    from tools import ideation as ide
    st, s = call("GET", "/api/ideation/presentation/pdf")
    ok(st == 200 and isinstance(s.get("ffmpeg"), bool), f"présentation · vidéo : la machine dit si ffmpeg est là ({s.get('ffmpeg')})")
    st, _ = call("GET", "/ideation/presentation/programme.js")
    ok(st == 200, f"présentation · vidéo : le rendu image par image se sert ({st})")
    src = pdf.SCRIPT.read_text(encoding="utf-8")
    ok(all(x in src for x in ("libx264", "yuv420p", "'16'", "+faststart", "image2pipe", "SR_RENDU.seek")),
       "présentation · vidéo : le script donne chaque image à ffmpeg (libx264, yuv420p, CRF 16, +faststart)")

    # la présentation d'essai : une diapositive de 3 s — un titre qui monte, une forme menée par des
    # images clés (de la gauche avec un ressort, son opacité de 0 à 1) — et une seconde diapositive
    G = 2200
    nodes = [
        {"id": "f1", "type": "frame", "x": 0, "y": 0, "w": 1920, "h": 1080, "name": "Mouvement", "deck": {"ratio": "16:9", "trans": "fade"}},
        {"id": "f2", "type": "frame", "x": G, "y": 0, "w": 1920, "h": 1080, "name": "Suite", "deck": {"ratio": "16:9", "trans": "fade"},
         "motion": {"trans": "push", "tdur": 600}},
        {"id": "t1", "type": "title", "x": 96, "y": 120, "w": 1600, "h": 160, "text": "Le mouvement", "size": "l", "style": "h2",
         "motion": {"in": {"fx": "rise", "dur": 800, "delay": 100, "ease": "out-expo"}}},
        {"id": "s1", "type": "shape", "kind": "rect", "color": "or", "x": 760, "y": 460, "w": 400, "h": 400,
         "motion": {"in": {"fx": "none"}, "keys": {"x": [{"t": 0, "v": -600, "e": {"spring": {"k": 120, "c": 14, "m": 1}}}, {"t": 1600, "v": 0}],
                                                   "op": [{"t": 0, "v": 0, "e": "out"}, {"t": 900, "v": 1}],
                                                   "rot": [{"t": 400, "v": 0, "e": {"bz": [0.3, 0, 0.2, 1]}}, {"t": 1600, "v": 90}]}}},
        {"id": "n2", "type": "note", "x": G + 96, "y": 500, "w": 1200, "h": 80, "text": "Deuxième diapositive", "style": "body"},
    ]
    st, b = call("POST", "/api/ideation/boards", {"name": "Essai vidéo"})
    bid = b["id"]
    st, sv = call("POST", f"/api/ideation/boards/{bid}", {"name": b["name"], "v": ide.VERSION, "nodes": nodes, "links": [], "base_rev": 1})
    ok(st == 200, f"présentation · vidéo : la planche d'essai ({st} {sv})")
    st, got = call("GET", f"/api/ideation/boards/{bid}")
    s1 = next((n for n in got.get("nodes", []) if n["id"] == "s1"), {})
    ok((s1.get("motion") or {}).get("keys", {}).get("x", [{}])[0].get("e") == {"spring": {"k": 120.0, "c": 14.0, "m": 1.0}},
       f"présentation · vidéo : la planche garde les images clés et leurs courbes ({(s1.get('motion') or {}).get('keys')})")
    st, r = call("POST", f"/api/ideation/boards/{bid}/video", {"fps": 7})
    ok(st == 400 and "cadence" in str(r.get("error")), f"présentation · vidéo : une cadence inconnue est refusée ({st} {r})")
    st, r = call("POST", f"/api/ideation/boards/{bid}/video", {"slide": "nulle-part"})
    ok(st == 400, f"présentation · vidéo : une diapositive absente est refusée ({st})")
    st, e0 = call("POST", "/api/ideation/boards", {"name": "Essai vidéo vide"})
    st, r = call("POST", f"/api/ideation/boards/{e0['id']}/video", {})
    ok(st == 409, f"présentation · vidéo : une planche sans diapositive le dit ({st} {r})")

    pstate = pdf.state()
    if not pstate["ok"] or not ffmpeg_bin():
        st, j = call("POST", f"/api/ideation/boards/{bid}/video", {"slide": "f1", "hold": 0.6})
        j = pdf._wait(call, j["id"]) if st == 200 else j
        ok(j.get("state") == "error", f"présentation · vidéo : sans Chromium ou ffmpeg, le travail le dit ({j.get('state')} {j.get('message')})")
        print(f"  (Chromium ou ffmpeg absent : la vidéo n'est pas essayée ici — {pstate.get('why') or 'ffmpeg'})")
        return

    out = Path(tempfile.mkdtemp(prefix="sr_video_"))
    # le DÉTERMINISME : le même instant rendu deux fois (entre les deux, un autre) donne les mêmes pixels ;
    # et l'animation bouge vraiment (0 s et 1,5 s diffèrent)
    t_mid = 1100.0
    try:
        R = stills(bid, [0, t_mid, 2400, t_mid, 0], slide="f1", hold=0.8, out=out / "stills")
    except RuntimeError as e:
        ok(False, f"présentation · vidéo : les images d'un instant ({e})")
        return
    S = [Path(x["path"]) for x in R.get("stills") or []]
    ok(len(S) == 5 and R.get("total") == 2400, f"présentation · vidéo : la frise de la diapositive (1,6 s de motion, 0,8 s de pause : {R.get('total')})")
    if len(S) == 5:
        same = S[1].read_bytes() == S[3].read_bytes() and S[0].read_bytes() == S[4].read_bytes()
        d01 = _diff(S[0], S[1])[0]
        ok(same and d01 > 1, f"présentation · vidéo : le même instant rendu deux fois donne les mêmes pixels (1,1 s et 0 s), et 0 s ≠ 1,1 s (écart {d01:.1f})")
        # l'image d'un instant : la forme menée par ses clés a son centre là où courbes.js le place (le
        # ressort à 1,1 s ; la rotation tourne autour du centre)
        want = _valeur_js({"x": nodes[3]["motion"]["keys"]["x"]}, "x", t_mid)
        from PIL import Image
        with Image.open(S[1]) as im:
            im = im.convert("RGB")
            bg = im.getpixel((8, 660))
            far = lambda c: sum(abs(a - b) for a, b in zip(c, bg)) > 90   # noqa: E731
            cols = [x for x in range(0, 1920) if far(im.getpixel((x, 660)))]
        cx = (cols[0] + cols[-1]) / 2 if cols else None
        ok(want is not None and cx is not None and abs(cx - (960 + want)) <= 3,
           f"présentation · vidéo : à 1,1 s, la forme est où ses images clés la mènent (centre {cx} px, attendu {want is not None and 960 + want:.1f})")
    # l'EXPORT : une diapositive de 3 s (1,6 s de motion, 1,4 s de pause), 30 i/s, 90 images ; la
    # première, la médiane et la dernière extraites par ffmpeg, comparées au rendu au même instant
    st, j = call("POST", f"/api/ideation/boards/{bid}/video", {"slide": "f1", "hold": 1.4, "fps": 30})
    ok(st == 200 and j.get("kind") == "presentation.video" and j.get("lane") == "cpu" and j.get("tool") == "ideation",
       f"présentation · vidéo : le travail part dans la file, voie cpu ({st} {j.get('kind')} {j.get('lane')})")
    j = pdf._wait(call, j["id"], 300) if st == 200 else j
    items = j.get("items") or []
    ok(j.get("state") == "done" and len(items) == 1 and items[0]["kind"] == "video",
       f"présentation · vidéo : une vidéo rangée ({j.get('state')} {j.get('message')} {[x['kind'] for x in items]})")
    if not items:
        return
    it = items[0]
    ok(it.get("folder") == FOLDER and it.get("origin", {}).get("tool") == "ideation" and it.get("space") == ide.board_space(bid)
       and it.get("width") == 1920 and it.get("height") == 1080 and abs((it.get("duration") or 0) - 3.0) < 0.05 and it.get("fps") == 30
       and it["title"].startswith("Essai vidéo · 01") and it.get("thumb_url"),
       f"présentation · vidéo : dans la bibliothèque, dossier Idéation, 1920 × 1080, 3 s, 30 i/s, sa vignette "
       f"({it.get('folder')} {it.get('width')}×{it.get('height')} {it.get('duration')} s {it.get('fps')} {it.get('title')})")
    mp4 = library.path_of(library.get(it["id"]))
    n = 90
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
                            "stream=codec_name,pix_fmt,nb_read_frames,color_space", "-of", "json", str(mp4)], capture_output=True, text=True, timeout=60)
    try:
        vs = json.loads(probe.stdout)["streams"][0]
    except (ValueError, KeyError, IndexError):
        vs = {}
    head = mp4.read_bytes()[:65536]
    fast = b"moov" in head and (b"mdat" not in head or head.find(b"moov") < head.find(b"mdat"))
    ok(vs.get("codec_name") == "h264" and vs.get("pix_fmt") == "yuv420p" and int(vs.get("nb_read_frames") or 0) == n and fast
       and vs.get("color_space") == "bt709",
       f"présentation · vidéo : H.264, yuv420p, BT.709, {n} images, l'index en tête (+faststart) ({vs} {fast})")
    idx = [0, n // 2, n - 1]
    times = [k * 1000 / 30 for k in idx]
    R2 = stills(bid, times, slide="f1", hold=1.4, out=out / "ref")
    refs = [Path(x["path"]) for x in R2.get("stills") or []]
    ext = _frames(mp4, idx, out)
    res = [_diff(a, b) for a, b in zip(ext, refs)] if len(refs) == 3 and all(p.is_file() for p in ext) else []
    print(f"  (le MP4 contre le rendu, images {idx} : écart moyen et PSNR {[(round(m, 2), round(ps, 1)) for m, ps in res]})")
    ok(len(res) == 3 and all(m < 3.0 and ps > 32 for m, ps in res),
       f"présentation · vidéo : la première, la médiane et la dernière image du MP4 sont le rendu au même instant "
       f"(écart moyen < 3/255, PSNR > 32 dB : {[(round(m, 2), round(ps, 1)) for m, ps in res]})")

    # l'ANNULATION : arrêter le travail arrête Chromium et ffmpeg ; rien n'est rangé
    st, j = call("POST", f"/api/ideation/boards/{bid}/video", {"hold": 8, "fps": 30})
    t0 = time.time()
    while st == 200 and time.time() - t0 < 60:
        _, cur = call("GET", f"/api/jobs/{j['id']}")
        if cur.get("state") == "running" and (cur.get("progress") or 0) > 0.3:
            break
        time.sleep(0.2)
    call("POST", f"/api/jobs/{j['id']}/cancel")
    j = pdf._wait(call, j["id"], 60)
    left = subprocess.run(["pgrep", "-f", f"work/{j['id']}/spec.json"], capture_output=True, text=True).stdout.strip()
    ok(j.get("state") == "cancelled" and not j.get("items") and not left,
       f"présentation · vidéo : arrêté en route, rien n'est rangé, plus de processus ({j.get('state')} {j.get('items')} {left!r})")

    # la présentation entière : deux diapositives, la poussée de 0,6 s entre elles — 1,6 s de motion + 0,4 s
    # de pause, puis la poussée (les entrées de la seconde partent à 55 %), 0,4 s de pause : 3 s, 72 images
    st, j = call("POST", f"/api/ideation/boards/{bid}/video", {"hold": 0.4, "fps": 24})
    j = pdf._wait(call, j["id"], 300) if st == 200 else j
    it2 = (j.get("items") or [{}])[0]
    ok(j.get("state") == "done" and it2.get("title") == "Essai vidéo" and it2.get("fps") == 24 and abs((it2.get("duration") or 0) - 3.0) < 0.05
       and (j.get("result") or {}).get("frames") == 72,
       f"présentation · vidéo : la présentation entière, sa transition ({j.get('state')} {j.get('message')} {it2.get('duration')} s)")
    if j.get("state") == "done":
        # au milieu de la poussée (2,3 s) : la première diapositive à moitié partie à gauche, la seconde à moitié arrivée
        R3 = stills(bid, [2300], hold=0.4, out=out / "push")
        from PIL import Image
        with Image.open((R3.get("stills") or [{}])[0].get("path")) as im:
            im = im.convert("RGB")
            bg = im.getpixel((1900, 40))
            row = [x for x in range(0, 1920) if sum(abs(a - b) for a, b in zip(im.getpixel((x, 660)), bg)) > 90]
        ok(bool(row) and row[-1] < 400, f"présentation · vidéo : au milieu de la poussée, la forme de la première est partie à gauche (jusqu'à {row and row[-1]} px)")

    # une police dont la licence refuse le PDF refuse la vidéo (un titre sans style : Venus Rising)
    st, b2 = call("POST", "/api/ideation/boards", {"name": "Essai vidéo licence"})
    n2 = [{"id": "f1", "type": "frame", "x": 0, "y": 0, "w": 1920, "h": 1080, "name": "Une", "deck": {"ratio": "16:9"}},
          {"id": "t1", "type": "title", "x": 96, "y": 400, "w": 1400, "h": 120, "text": "Titre sans style", "size": "l"}]
    call("POST", f"/api/ideation/boards/{b2['id']}", {"name": b2["name"], "v": ide.VERSION, "nodes": n2, "links": [], "base_rev": 1})
    st, j = call("POST", f"/api/ideation/boards/{b2['id']}/video", {"hold": 0.5})
    j = pdf._wait(call, j["id"]) if st == 200 else j
    ok(j.get("state") == "error" and "Venus Rising" in str(j.get("message")) and "diapositive 1" in str(j.get("message")) and not j.get("items"),
       f"présentation · vidéo : une police que sa licence refuse au PDF refuse aussi la vidéo, en disant laquelle et où ({j.get('state')} {j.get('message')})")
    shutil.rmtree(out, ignore_errors=True)
