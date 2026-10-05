"""La copie de défilement d'une vidéo (30/09/2026) : une copie de la vidéo
faite pour qu'on la parcoure image par image, servie au lecteur commun
(`commun/lecteur.js`) pendant qu'on déplace la tête de lecture ; la vidéo
d'origine reste celle qu'on lit (image pleine, son).

Demande de Cal (30/09) : « quand je déplace la cue il n'affiche pas trop
rapidement l'update […] on veut vraiment pouvoir naviguer facilement dans la
timeline pour voir précisément le footage ».

Pourquoi c'est lent sans elle (mesuré le 30/09 sur la bibliothèque de DGX2,
`ffprobe -skip_frame nokey`) : les vidéos rendues (Kling, H3, Hunyuan…) n'ont
qu'une à trois images clés pour 5 à 20 s — la vidéo Kling de la capture de Cal,
2208×936, 241 images, n'en a qu'UNE. Un navigateur qui saute à l'instant t
décode depuis l'image clé précédente (H.264 : les images P et B se calculent à
partir des précédentes) : jusqu'à 240 images de 2208×936 à décoder pour en
montrer une. Mesuré dans Chromium (sans affichage, DGX2) : 850 ms au milieu
pour un saut, 2 s de retard en glissant, aucune image vue pendant le geste.

La copie (le choix mesuré le 30/09 sur trois vidéos de la bibliothèque — Kling
2208×936, 1920×1080, 1248×1664 —, Chromium de DGX2 ; délai entre un saut et
l'image présentée, requestVideoFrameCallback, au milieu ; poids pour les trois) :
  l'originale                          850, 156, 470 ms   35, 11, 33 Mo
  tout-intra, 1280 px                   15,  12,  10 ms  8,8, 8,0, 19,3 Mo
  tout-intra, 960 px                     6,   7,  15 ms  5,7, 5,3, 12,9 Mo
  une clé toutes les 6 images, 960 px    8,  11,  11 ms  4,1, 4,6,  6,4 Mo
  une clé toutes les 12 images, 960 px  13,  12,  13 ms  3,7, 4,3,  4,8 Mo
En glissant (90 mouvements en 1,5 s), toutes les copies suivent en 10 à 17 ms au
milieu, 18 à 25 ms à 95 %, 80 à 87 images vues ; l'originale : 0,9 à 2 s, aucune
image vue pendant le geste. Retenue : une clé toutes les 6 images, 960 px — le
délai du tout-intra (à une image d'écran près), moitié moins lourde ; faite en
0,7 à 1,3 s pour 10 s de vidéo (DGX2, 4 fils) :
- H.264 (lu partout : Chrome, Edge, Safari, Firefox), `libx264 -preset veryfast
  -tune fastdecode` (x264 : sans CABAC ni filtre de déblocage, le décodage le
  plus léger) ;
- une image clé toutes les 6 images (`-g 6 -keyint_min 6 -sc_threshold 0`),
  sans images B (`-bf 0`) : un saut ne décode jamais plus de 6 images ;
- 960 px de grand côté au plus (jamais agrandie) : l'image du défilement,
  pas celle de l'arrêt (le lecteur repasse sur l'originale dès qu'elle est
  prête) ;
- les temps de l'originale (`-fps_mode passthrough`, doc ffmpeg : « Each frame
  is passed with its timestamp from the demuxer to the muxer ») : l'image n de
  la copie est l'image n de l'originale ;
- l'index en tête (`-movflags +faststart`, doc ffmpeg : « Run a second pass
  moving the index (moov atom) to the beginning of the file ») : la page la lit
  sans aller chercher la fin du fichier ;
- sans son (`-an`) : le son vient de l'originale.

Où : `<data_dir>/library/<id>/defil.v1.mp4`, servie par `/library/<id>/…` (le
même juge que le fichier : qui voit la vidéo voit sa copie ; requêtes
partielles) ; la corbeille d'Asset l'emporte avec l'objet. Quand : à la mise
en bibliothèque (`core/library.py`, `add_file`, l'accroche d'une ligne), sinon
à la première demande de la page (le rattrapage des vidéos rangées avant).
Une copie à la fois (un fil, une file), au processeur (`nice`, 4 fils) : pas
de GPU, rien à verrouiller. Au-delà de 30 min (un film entier), pas de copie :
le lecteur le dit et défile sur l'originale.

Route : `GET /api/defil/<id>` → `{ready, url, pending, why}` ; pas prête : la
demande passe en tête de la file, la page redemande.

Le son de défilement (06/10/2026) — Cal : « entendre le son quand on fait glisser
la tête de lecture […] hyper important pour caler un cut ». La page
(`commun/scrub.js`) joue de courts grains du son à la place de la tête ; il lui
faut le son DÉCODÉ (un AudioBuffer de Web Audio). Décoder l'original ferait
télécharger toute la vidéo, l'image avec ; on sert le son seul :
- mono, 22 050 Hz (11 025 Hz au-delà de 10 min : la page garde le son décodé en
  flottants, 88 Ko par seconde à 22 050 Hz) ;
- FLAC (sans perte, lu par `decodeAudioData` dans Chrome, Edge, Firefox et
  Safari) : un codeur à trames (AAC, MP3) ajoute un délai au début (les
  « priming samples ») qui décalerait les grains de quelques dizaines de ms ;
- les temps de l'originale : `aresample=…:async=1:first_pts=0` (doc
  ffmpeg-filters, aresample : « first_pts … pad … with silence ») — un son qui
  commence après l'image est précédé de silence.
Où : `<data_dir>/library/<id>/defil-son.v1.flac`, servi par `/library/<id>/…`.
Quand : à la première demande (`GET /api/defil/<id>/son` → `{ready, url, sr,
why}`), calculé sur place (quelques secondes pour 10 min, deux ffmpeg à la fois
au plus) ; au-delà de 30 min, pas de copie (la page n'a pas de son au
défilement pour ce média, et le dit).
"""

from __future__ import annotations

import subprocess
import threading
import time
from pathlib import Path

from core import library
from core.http import HttpError

VERSION = 1
LONG = 960                   # px, le grand côté au plus
GOP = 6                      # une image clé toutes les 6 images
CRF = 23
MAX_DURATION = 1800          # s : au-delà, pas de copie (un film : 30 min font déjà ≈ 500 Mo)
TIMEOUT = 900                # s, une copie
THREADS = 4


def name() -> str:
    return f"defil.v{VERSION}.mp4"


def command(src: Path, dest: Path) -> list[str]:
    """La commande ffmpeg (une seule vérité : le contrôle la relit)."""
    # le grand côté ramené à LONG, jamais agrandi, pair (-2) ; portrait ou paysage
    scale = (f"scale=w='if(gte(iw,ih),min({LONG},iw),-2)':h='if(gte(iw,ih),-2,min({LONG},ih))'")
    return ["nice", "-n", "10", "ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(src),
            "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", scale, "-fps_mode", "passthrough",
            "-c:v", "libx264", "-preset", "veryfast", "-tune", "fastdecode", "-crf", str(CRF),
            "-g", str(GOP), "-keyint_min", str(GOP), "-sc_threshold", "0", "-bf", "0",
            "-pix_fmt", "yuv420p", "-threads", str(THREADS), "-movflags", "+faststart", "-f", "mp4", str(dest)]


def make(src: Path, dest: Path) -> bool:
    """Calcule la copie (écrite à côté, puis renommée : jamais à moitié sous son nom)."""
    tmp = dest.with_name("." + dest.name + ".tmp")
    try:
        r = subprocess.run(command(src, tmp), capture_output=True, timeout=TIMEOUT)
    except (OSError, subprocess.TimeoutExpired):
        tmp.unlink(missing_ok=True)
        return False
    if r.returncode != 0 or not tmp.is_file() or not tmp.stat().st_size:
        tmp.unlink(missing_ok=True)
        _failed.add(str(dest))
        return False
    tmp.replace(dest)
    return True


# ── la file : une copie à la fois ───────────────────────────
_q: list[tuple[Path, Path]] = []
_cv = threading.Condition()
_busy: set[str] = set()
_failed: set[str] = set()
_worker: threading.Thread | None = None


def _run() -> None:
    while True:
        with _cv:
            while not _q:
                _cv.wait()
            src, dest = _q.pop(0)
            _busy.add(str(dest))
        try:
            if not dest.is_file() and src.is_file() and dest.parent.is_dir():
                make(src, dest)
        except Exception:
            pass
        finally:
            with _cv:
                _busy.discard(str(dest))


def enqueue(src: Path, dest: Path, front: bool = False) -> None:
    global _worker
    with _cv:
        if str(dest) in _busy or str(dest) in _failed:
            return
        cur = [x for x in _q if x[1] != dest]
        _q[:] = ([(src, dest)] + cur) if front else (cur + [(src, dest)])
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, daemon=True, name="defilement")
            _worker.start()
        _cv.notify()


def pending(dest: Path) -> bool:
    with _cv:
        return str(dest) in _busy or any(x[1] == dest for x in _q)


def soon(src: Path, duration: float | None = None) -> None:
    """L'accroche de la mise en bibliothèque (core/library.py, `add_file` d'une
    vidéo) : la copie se fait à la suite, le dépôt n'attend pas."""
    if duration is not None and duration > MAX_DURATION:
        return
    src = Path(src)
    enqueue(src, src.parent / name())


def state(it: dict, ask: bool = True) -> dict:
    """Où en est la copie d'une vidéo ; `ask` : pas prête, elle passe en tête."""
    if it.get("kind") != "video" or not it.get("file"):
        raise HttpError(404, "seule une vidéo a une copie de défilement")
    src = library.path_of(it)
    dest = src.parent / name()
    if dest.is_file():
        return {"ready": True, "url": f"library/{it['id']}/{name()}?v={VERSION}"}
    if (it.get("duration") or 0) > MAX_DURATION:
        return {"ready": False, "pending": False, "why": f"plus de {MAX_DURATION // 60} min : on défile sur l'originale"}
    if str(dest) in _failed:
        return {"ready": False, "pending": False, "why": "ffmpeg n'a pas pu la faire : on défile sur l'originale"}
    if not src.is_file():
        raise HttpError(404, "le fichier de la vidéo manque")
    if ask:
        enqueue(src, dest, front=True)
    return {"ready": False, "pending": True}


def r_state(req, iid):
    it = library.see(iid)   # montrer : jugé par l'objet, pas par le Workspace courant (comme /library/)
    if not it:
        raise HttpError(404, f"introuvable : {iid}")
    return state(it)


# ── le son de défilement (06/10, en tête de ce fichier) ──────
SON_VERSION = 1
SON_SR, SON_SR_LONG, SON_LONG = 22050, 11025, 600     # Hz ; au-delà de SON_LONG s, la fréquence basse
SON_TIMEOUT = 300                                     # s, une copie
_son_locks: dict[str, threading.Lock] = {}
_son_lock = threading.Lock()
_son_slots = threading.BoundedSemaphore(2)            # deux ffmpeg à la fois au plus


def son_name() -> str:
    return f"defil-son.v{SON_VERSION}.flac"


def son_sr(duration: float | None) -> int:
    return SON_SR if (duration or 0) <= SON_LONG else SON_SR_LONG


def son_command(src: Path, dest: Path, sr: int) -> list[str]:
    """La commande ffmpeg du son de défilement (une seule vérité : le contrôle la relit)."""
    return ["nice", "-n", "10", "ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(src),
            "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "1", "-af", f"aresample={sr}:async=1:first_pts=0",
            "-c:a", "flac", "-compression_level", "5", "-f", "flac", str(dest)]


def son_make(src: Path, dest: Path, sr: int) -> bool:
    tmp = dest.with_name("." + dest.name + ".tmp")
    try:
        r = subprocess.run(son_command(src, tmp, sr), capture_output=True, timeout=SON_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired):
        tmp.unlink(missing_ok=True)
        return False
    if r.returncode != 0 or not tmp.is_file() or not tmp.stat().st_size:
        tmp.unlink(missing_ok=True)
        _failed.add(str(dest))
        return False
    tmp.replace(dest)
    return True


def son_state(it: dict) -> dict:
    """Le son de défilement d'une vidéo ou d'un son, calculé au besoin."""
    if it.get("kind") not in ("video", "audio") or not it.get("file"):
        raise HttpError(404, "seuls une vidéo et un son ont un son de défilement")
    if it["kind"] == "video" and not it.get("audio"):
        return {"ready": False, "why": "cette vidéo n'a pas de son"}
    src = library.path_of(it)
    dest = src.parent / son_name()
    sr = son_sr(it.get("duration"))
    ready = {"ready": True, "url": f"library/{it['id']}/{son_name()}?v={SON_VERSION}", "sr": sr}
    if dest.is_file():
        return ready
    if (it.get("duration") or 0) > MAX_DURATION:
        return {"ready": False, "why": f"plus de {MAX_DURATION // 60} min : pas de son au défilement"}
    if str(dest) in _failed:
        return {"ready": False, "why": "ffmpeg n'a pas pu lire son son"}
    if not src.is_file():
        raise HttpError(404, "le fichier manque")
    with _son_lock:
        lock = _son_locks.setdefault(str(dest), threading.Lock())
    with lock:
        if not dest.is_file():
            with _son_slots:
                son_make(src, dest, sr)
    if dest.is_file():
        return ready
    return {"ready": False, "why": "ffmpeg n'a pas pu lire son son"}


def r_son(req, iid):
    it = library.see(iid)   # comme r_state : qui voit l'objet entend son son
    if not it:
        raise HttpError(404, f"introuvable : {iid}")
    return son_state(it)


def register(app) -> None:
    app.route("GET", "/api/defil/{iid}", r_state)
    app.route("GET", "/api/defil/{iid}/son", r_son)


# ── le contrôle (tools/check.py) ─────────────────────────────
def _probe_keys(p: Path) -> list[float]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
                          "-show_entries", "frame=pts_time", "-of", "csv=p=0", str(p)], capture_output=True, text=True, timeout=60)
    return [float(x.strip(",")) for x in out.stdout.split() if x.strip(",")]


def _probe(p: Path, what: str) -> str:
    return subprocess.run(["ffprobe", "-v", "error", "-show_entries", what, "-of", "csv=p=0", str(p)],
                          capture_output=True, text=True, timeout=60).stdout.strip()


def selftest(call, ok) -> None:
    import tempfile
    tmp = Path(tempfile.mkdtemp(prefix="sr-defil-"))
    src = tmp / "essai.mp4"
    # 3 s à 24 i/s, 1280×720, UNE image clé (comme les vidéos rendues), avec un son
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=24:d=3",
                        "-f", "lavfi", "-i", "sine=f=440:d=3", "-c:v", "libx264", "-preset", "ultrafast", "-g", "999",
                        "-c:a", "aac", "-shortest", str(src)], capture_output=True, timeout=120)
    ok(r.returncode == 0, "défilement : une vidéo d'essai à une seule image clé")
    if r.returncode:
        return
    st, it = call("PUT", "/api/library/upload?name=essai-defil.mp4&title=Essai%20defil", raw=src.read_bytes())
    iid = it.get("id", "") if isinstance(it, dict) else ""
    ok(st == 200 and it.get("kind") == "video", f"défilement : la vidéo dans la bibliothèque ({st})")
    t0, d = time.time(), {}
    while time.time() - t0 < 60:
        st, d = call("GET", f"/api/defil/{iid}")
        if st != 200 or d.get("ready"):
            break
        time.sleep(0.2)
    ok(st == 200 and d.get("ready") and d.get("url", "").endswith(f"{name()}?v={VERSION}"),
       f"défilement : la copie se fait à l'entrée et se dit prête ({st}, {time.time() - t0:.1f} s)")
    dest = library.folder_of(iid) / name()
    if not dest.is_file():
        return
    keys = _probe_keys(dest)
    gaps = [b - a for a, b in zip(keys, keys[1:])]
    ok(len(keys) >= 12 and max(gaps) <= GOP / 24 + 1e-3, f"défilement : une image clé toutes les {GOP} images ({len(keys)} clés, écart max {max(gaps or [0]):.3f} s)")
    w, h = _probe(dest, "stream=width,height").split(",")[:2]
    ok((int(w), int(h)) == (LONG, 540), f"défilement : {LONG} px de grand côté ({w}×{h})")
    ok(_probe(dest, "stream=codec_type").split() == ["video"], "défilement : sans son (le son vient de l'originale)")
    n_src = _probe(src, "stream=nb_frames").split()[0]
    n_dst = _probe(dest, "stream=nb_frames").split()[0]
    ok(n_src == n_dst, f"défilement : les mêmes images que l'originale ({n_dst} / {n_src})")
    head = dest.read_bytes()[:4096]
    ok(head.find(b"moov") != -1 and (head.find(b"mdat") == -1 or head.find(b"moov") < head.find(b"mdat")),
       "défilement : l'index en tête (faststart)")
    st, body = call("GET", f"/library/{iid}/{name()}")
    ok(st == 200 and isinstance(body, bytes) and len(body) == dest.stat().st_size, f"défilement : servie sous /library/ ({st})")
    st, _ = call("GET", "/api/defil/vid-20260101-000000-0000")
    ok(st == 404, f"défilement : un objet absent → 404 ({st})")
    st, img = call("PUT", "/api/library/upload?name=pas-une-video.png", raw=_tiny_png())
    st, _ = call("GET", f"/api/defil/{img.get('id')}")
    ok(st == 404, f"défilement : une image n'en a pas ({st})")
    # une petite vidéo n'est jamais agrandie ; un portrait garde son sens
    small = tmp / "petit.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=480x640:r=25:d=1", "-c:v", "libx264",
                    "-preset", "ultrafast", str(small)], capture_output=True, timeout=60)
    out = tmp / "petit-defil.mp4"
    ok(make(small, out) and _probe(out, "stream=width,height").split(",")[:2] == ["480", "640"],
       "défilement : une vidéo plus petite n'est pas agrandie (480×640)")
    # le son de défilement (06/10) : mono, 22 050 Hz, FLAC, la durée de l'originale
    st, so = call("GET", f"/api/defil/{iid}/son")
    ok(st == 200 and so.get("ready") and so.get("sr") == SON_SR and so.get("url", "").endswith(f"{son_name()}?v={SON_VERSION}"),
       f"défilement : le son de défilement d'une vidéo ({st} {so})")
    sdest = library.folder_of(iid) / son_name()
    if sdest.is_file():
        info = _probe(sdest, "stream=codec_name,channels,sample_rate").split(",")
        ok(sorted(info[:3]) == sorted(["flac", "22050", "1"]),
           f"défilement : son en FLAC mono 22 050 Hz ({info})")
        dur = float(_probe(sdest, "format=duration") or 0)
        ok(abs(dur - 3.0) < 0.05, f"défilement : le son garde la durée de l'originale ({dur:.3f} s)")
        st, body = call("GET", f"/library/{iid}/{son_name()}")
        ok(st == 200 and isinstance(body, bytes) and body[:4] == b"fLaC", f"défilement : le son servi sous /library/ ({st})")
    # un son de la bibliothèque en a un ; une vidéo muette le dit ; une image n'en a pas
    wav = tmp / "son.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=330:d=2", str(wav)], capture_output=True, timeout=60)
    st, au = call("PUT", "/api/library/upload?name=essai-son.wav", raw=wav.read_bytes())
    st, so = call("GET", f"/api/defil/{au.get('id')}/son")
    ok(st == 200 and so.get("ready"), f"défilement : le son de défilement d'un son ({st} {so})")
    muet = tmp / "muet.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=25:d=1", "-c:v", "libx264",
                    "-preset", "ultrafast", str(muet)], capture_output=True, timeout=60)
    st, mu = call("PUT", "/api/library/upload?name=muet.mp4", raw=muet.read_bytes())
    st, so = call("GET", f"/api/defil/{mu.get('id')}/son")
    ok(st == 200 and not so.get("ready") and "pas de son" in so.get("why", ""), f"défilement : une vidéo muette le dit ({st} {so})")
    st, _ = call("GET", f"/api/defil/{img.get('id')}/son")
    ok(st == 404, f"défilement : une image n'a pas de son de défilement ({st})")
    for p in tmp.iterdir():
        p.unlink(missing_ok=True)
    tmp.rmdir()


def _tiny_png() -> bytes:
    from io import BytesIO
    from PIL import Image
    out = BytesIO()
    Image.new("RGB", (8, 8), (10, 10, 10)).save(out, "PNG")
    return out.getvalue()
