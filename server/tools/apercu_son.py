"""Le visuel d'un son (30/09/2026) : sa forme d'onde, calculée une fois sur le
serveur et servie comme vignette d'un objet audio de la bibliothèque.

Demande de Cal (30/09) : « on peut avoir un spectre pour les sons car on n'a pas
de visuel pour les icônes élément ou même sur le canva ».

Forme d'onde plutôt que spectrogramme (docs/etudes/ideation_collab.md, § 10.1) :
- à la taille d'une vignette (180 px) ou d'un bloc de planche (≈ 230 × 45 px),
  l'enveloppe se lit d'un coup d'œil — attaques, silences, phrases, où cliquer
  dans la timeline ; un spectrogramme (`showspectrumpic` de ffmpeg) y devient
  une tache colorée qu'il faut apprendre à lire ;
- le spectrogramme code l'intensité par une échelle de couleurs, qu'aucun jeton
  du thème ne peut redonner ; la forme d'onde est une FORME : l'image n'est qu'un
  masque (blanc, alpha), et la page la peint avec un jeton (`mask-image` +
  `background: var(--grn2)`), dans les deux thèmes, et en deux teintes pour la
  tête de lecture (le joué, le reste) — aucune couleur en dur.

Pourquoi pas `showwavespic` tel quel (ffmpeg 6.1, lu dans ffmpeg-filters) : il
dessine l'amplitude brute, sans normalisation — une prise faible devient un trait
plat — et sa couleur est cuite dans l'image. On demande donc à ffmpeg le son
décodé (PCM 16 bits, mono, fréquence réduite), on prend le pic de chaque colonne,
on normalise sur le plus grand, et PIL dessine le masque (symétrique, bords
lissés) : une seule image de `W × H`, qui couvre la durée entière, de bord à bord
— la position x d'un clic est donc le temps × largeur / durée, sans marge.

Où : `<data_dir>/library/<id>/wave.v1.png`, à côté du fichier du son (une voix
d'élément : `<fichier>.wave.v1.png`) ; la corbeille d'Asset l'emporte avec
l'objet. Quand :
- à la mise en bibliothèque, si `core/library.py` appelle `soon()` (l'accroche
  d'une ligne, décrite dans le rapport de ce travail, posée par l'agent de la
  bibliothèque) ;
- sinon, à la première demande (`GET /api/son/apercu/<id>`) : les sons déjà
  présents ont ainsi leur visuel dès qu'une page le montre. Un calcul par fichier
  (un verrou par chemin), deux ffmpeg en même temps au plus.

Route : `GET /api/son/apercu/<id>[?voix=<k>][&v=1]` → le PNG (masque). Lecture
jugée par `library.get` (qui voit l'objet voit sa forme) ; l'invité d'Idéation
(rôle `invite`) y est admis pour les sons de ses planches (`guest_realm`, la
route juge elle-même). Avec `v=1` (la version du dessin), gardé un an.
"""

from __future__ import annotations

import array
import struct
import subprocess
import sys
import threading
import time
from io import BytesIO
from pathlib import Path

from core import auth, library
from core.http import FileResponse, HttpError

VERSION = 1                  # le dessin ; le changer refait les images (nom et adresse changent)
W, H = 1200, 160             # le masque : large (la planche zoome jusqu'à 400 %), bas (l'onde est symétrique)
SR = 8000                    # la fréquence du son décodé : assez pour l'enveloppe, 4 Mo par minute au plus
MIN_SR = 400                 # un son de plusieurs heures descend jusque-là (au moins 400 pics / s décodés)
MAX_SAMPLES = 8_000_000      # 16 Mo lus au plus : la fréquence s'abaisse pour tenir la durée entière
TIMEOUT = 60                 # s, un décodage
CACHE = "private, max-age=31536000, immutable"   # comme les copies d'affichage (core/library.py, VIEW_CACHE)

_locks: dict[str, threading.Lock] = {}
_locks_lock = threading.Lock()
_slots = threading.BoundedSemaphore(2)           # deux ffmpeg à la fois au plus


def wave_name(src_name: str | None = None) -> str:
    """Le nom du masque : `wave.v1.png` pour le fichier principal, `<voix>.wave.v1.png` pour une voix."""
    return f"{src_name}.wave.v{VERSION}.png" if src_name else f"wave.v{VERSION}.png"


def _lock_for(p: Path) -> threading.Lock:
    with _locks_lock:
        return _locks.setdefault(str(p), threading.Lock())


def _pcm(src: Path, duration: float | None = None):
    """Le son décodé (PCM 16 bits mono, `array('h')`) et sa fréquence, ou None si
    ffmpeg ne lit pas de son. La fréquence de décodage s'abaisse pour les longs
    sons : la durée entière tient toujours dans MAX_SAMPLES."""
    sr = SR
    if duration and duration > 0:
        sr = max(MIN_SR, min(SR, int(MAX_SAMPLES / duration)))
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", str(src), "-map", "0:a:0", "-ac", "1", "-ar", str(sr),
           "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"]
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError:
        return None
    killer = threading.Timer(TIMEOUT, p.kill)
    killer.start()
    buf = bytearray()
    try:
        while True:
            chunk = p.stdout.read(1 << 16)
            if not chunk:
                break
            buf += chunk
            if len(buf) > 2 * MAX_SAMPLES + (1 << 20):   # durée inconnue ou fausse : on s'arrête là
                p.kill()
                break
        p.wait(timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        p.kill()
        return None
    finally:
        killer.cancel()
    a = array.array("h")
    a.frombytes(bytes(buf[: len(buf) // 2 * 2]))
    if sys.byteorder == "big":
        a.byteswap()
    return (a, sr) if len(a) else None


def peaks(src: Path, cols: int = W, duration: float | None = None) -> list[float] | None:
    """Le pic de chaque colonne (0 à 1, normalisé sur le plus fort), ou None si
    ffmpeg ne lit pas de son."""
    got = _pcm(src, duration)
    if not got:
        return None
    a, _sr = got
    n = len(a)
    out = []
    for c in range(cols):
        i0 = c * n // cols
        i1 = max(i0 + 1, (c + 1) * n // cols)
        s = a[i0:i1]
        out.append(max(max(s), -min(s)))
    top = max(out) or 1
    return [v / top for v in out]


def draw(amps: list[float], w: int = W, h: int = H) -> bytes:
    """Le masque PNG (niveaux de gris + alpha, blanc) : pour chaque colonne, une
    barre symétrique autour du milieu, ses deux bouts adoucis (alpha partiel) ;
    un silence reste un trait fin, pour que la timeline se lise d'un bout à l'autre."""
    from PIL import Image
    cy, half = h // 2, h // 2 - 1
    rows = []   # une colonne de l'image = une ligne de h octets (on transpose ensuite)
    for x in range(w):
        a = amps[min(len(amps) - 1, x * len(amps) // w)] if amps else 0.0
        hh = max(0.75, a * half)
        k = min(half, int(hh))
        edge = int(round((hh - k) * 255)) if k < half else 0
        top = cy - k - 1
        col = bytes(top) + bytes((edge,)) + b"\xff" * (2 * k) + bytes((edge,))
        rows.append(col + bytes(h - len(col)))
    alpha = Image.frombytes("L", (h, w), b"".join(rows)).transpose(Image.Transpose.TRANSPOSE)
    im = Image.merge("LA", (Image.new("L", (w, h), 255), alpha))
    out = BytesIO()
    im.save(out, "PNG", optimize=True)
    return out.getvalue()


def make(src: Path, dest: Path, duration: float | None = None) -> bool:
    """Calcule le masque de `src` dans `dest` (écrit d'un coup : jamais à moitié)."""
    with _slots:
        amps = peaks(src, W, duration)
    if amps is None:
        return False
    data = draw(amps)
    tmp = dest.with_suffix(".tmp")
    tmp.write_bytes(data)
    tmp.replace(dest)
    return True


def ensure(src: Path, dest: Path, duration: float | None = None) -> bool:
    """Le masque existe-t-il (calculé ici s'il le faut, une seule fois) ?"""
    if dest.is_file():
        return True
    with _lock_for(dest):
        if dest.is_file():      # un autre fil l'a fait pendant qu'on attendait
            return True
        return make(src, dest, duration)


# ── les pics (01/10) ─────────────────────────────────────────
# Cal, 01/10 : « dans le canva elle semble bien dessinée et précise alors que dans montage
# elle est super mal faite : on dirait une image en basse définition ». Le Montage étirait
# une image fixe de ffmpeg (showwavespic 2400 × 96, sans normalisation) sur toute la
# longueur du plan. Ici : le pic de chaque 1/BPS de seconde (0 à 255, normalisé sur le plus
# fort), calculé une fois, et la page DESSINE l'onde à la résolution de l'écran, pour la
# seule partie visible (commun/onde.js) — nette à tout zoom.
BPS = 200                    # pics par seconde : 5 ms ; au zoom le plus fort du Montage (800 px/s), 4 px par pic


def pics_name(src_name: str | None = None) -> str:
    return f"{src_name}.pics.v{VERSION}.bin" if src_name else f"pics.v{VERSION}.bin"


def make_pics(src: Path, dest: Path, duration: float | None = None) -> bool:
    """Les pics de `src` dans `dest` (un octet par 1/BPS s ; écrit d'un coup)."""
    with _slots:
        got = _pcm(src, duration)
    if not got:
        return False
    a, sr = got
    step = sr / BPS
    n = max(1, int(len(a) / step))
    out = []
    for c in range(n):
        i0 = int(c * step)
        i1 = max(i0 + 1, int((c + 1) * step))
        s = a[i0:i1]
        out.append(max(max(s), -min(s)) if s else 0)
    top = max(out) or 1
    data = bytes(min(255, round(v * 255 / top)) for v in out)
    tmp = dest.with_suffix(".tmp")
    tmp.write_bytes(data)
    tmp.replace(dest)
    return True


def ensure_pics(src: Path, dest: Path, duration: float | None = None) -> bool:
    if dest.is_file():
        return True
    with _lock_for(dest):
        if dest.is_file():
            return True
        return make_pics(src, dest, duration)


# ── l'onde précise (06/10) ───────────────────────────────────
# Cal, 06/10 : « L'onde audio est super mal définie (sur une capture zoomée de Transcrire :
# des blocs en escalier) ». Les causes (docs/etudes/onde_spectre.md § 1) : le lecteur commun
# étirait le masque de 1200 colonnes sur toute la frise (au zoom de 800 px/s, 80 px d'écran
# par colonne pour 2 min de son) ; les pics du Montage (ci-dessus) n'ont qu'une valeur par
# 5 ms, d'un son décodé à 8 kHz (le filtre du rééchantillonnage ôte les aigus : les « s »
# perdent leurs crêtes), sur un octet, le pic seul (|crête|, symétrique) — l'interpolation
# entre deux pics dessine une enveloppe lisse, pas le son.
#
# Ici, la précision vient des données (le principe de BBC audiowaveform — des paires min/max
# « over groups of N input samples » — et des résumés d'Audacity, min/max de 256 puis de
# 65 536 échantillons) :
# - le son décodé à SA fréquence (sans rééchantillonnage), en mono 16 bits, aux temps de
#   l'originale comme le son de défilement (defilement.py : `aresample=async=1:first_pts=0`) ;
# - une PYRAMIDE de paires (min, max) exactes, en 16 bits : le palier 0 résume 64 échantillons,
#   chaque palier en résume 4 fois plus (64, 256, 1024… jusqu'au son entier) ; la page prend le
#   palier qui tient sous la largeur d'un pixel d'écran, pour la seule partie visible ;
# - sous 64 échantillons par pixel, les ÉCHANTILLONS eux-mêmes, lus dans la copie d'analyse
#   (`onde.v2.flac` : FLAC, sans perte ; ffmpeg y saute à l'échantillon près, ce qu'il ne fait
#   pas dans un MP3, un AAC ou un Opus — essayé le 06/10 : 17 à 200 échantillons d'écart).
# La pyramide et la copie sortent du même décodage (`asplit`) : leurs échantillons sont les
# mêmes, par construction. Le spectre de la page (commun/spectre.js) lit les mêmes.
#
# Où : à côté du son (`onde.v2.bin`, `onde.v2.flac` ; une voix d'élément : `<fichier>.onde.v2.*`),
# la corbeille les emporte avec l'objet. Quand : à la mise en bibliothèque (`soon`), sinon à la
# première demande ; une à la fois (une file, `nice`), la page redemande tant que ce n'est pas prêt.
ONDE_V = 2                   # le format ; le changer refait les fichiers (nom et adresse changent)
ONDE_B0, ONDE_F = 64, 4      # le palier 0 : min/max de 64 échantillons ; chaque palier : ×4
ONDE_MAGIC = b"SRONDE02"
ONDE_TIMEOUT = 3600          # s, un calcul
ECH_MAX = 1 << 18            # échantillons par demande au plus (5,5 s à 48 kHz, 512 Ko : peu de requêtes, cloudflare.md)
NIV_MAX = 1 << 16            # paires par demande au plus (256 Ko)
_ONDE_HDR = struct.Struct("<8sIIQiIII")   # magic, version, sr, n, peak, b0, f, nombre de paliers
_onde_cv = threading.Condition()
_onde_q: list[tuple[Path, Path, Path]] = []
_onde_busy: set[str] = set()
_onde_failed: dict[str, str] = {}
_onde_worker: threading.Thread | None = None
_onde_head: dict[str, tuple[int, dict]] = {}   # chemin → (mtime, en-tête lu) : relu si le fichier change
_fen = threading.BoundedSemaphore(4)            # quatre lectures d'échantillons à la fois au plus


def onde_names(src_name: str | None = None) -> tuple[str, str]:
    """Les noms de la pyramide et de la copie d'analyse : `onde.v2.bin`, `onde.v2.flac` (une voix : préfixés)."""
    base = f"{src_name}.onde.v{ONDE_V}" if src_name else f"onde.v{ONDE_V}"
    return base + ".bin", base + ".flac"


def _probe_sr(src: Path) -> int | None:
    """La fréquence d'échantillonnage du premier son du fichier (ffprobe), ou None."""
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate",
                            "-of", "csv=p=0", str(src)], capture_output=True, text=True, timeout=30)
        sr = int((r.stdout or "").strip().splitlines()[0])
        return sr if 1000 <= sr <= 768000 else None
    except (OSError, ValueError, IndexError, subprocess.TimeoutExpired):
        return None


def onde_command(src: Path, flac: Path, sr: int) -> list[str]:
    """Le décodage (une seule vérité : le contrôle la relit) : la copie d'analyse en FLAC, et le
    même son, échantillon pour échantillon, en PCM sur la sortie standard (pour la pyramide)."""
    graph = (f"[0:a:0]aresample={sr}:async=1:first_pts=0,"
             "aformat=sample_fmts=s16:channel_layouts=mono,asplit=2[f][p]")
    return ["nice", "-n", "10", "ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(src), "-filter_complex", graph,
            "-map", "[f]", "-c:a", "flac", "-compression_level", "5", "-f", "flac", str(flac),
            "-map", "[p]", "-f", "s16le", "-c:a", "pcm_s16le", "pipe:1"]


def make_onde(src: Path, dest: Path, flac: Path) -> bool:
    """La pyramide `dest` et la copie `flac` de `src` (écrites à côté, puis renommées : jamais à moitié)."""
    sr = _probe_sr(src)
    if not sr:
        _onde_failed[str(dest)] = "pas de son lisible dans ce fichier"
        return False
    tmp_flac = flac.with_name("." + flac.name + ".tmp")
    try:
        p = subprocess.Popen(onde_command(src, tmp_flac, sr), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError:
        return False
    killer = threading.Timer(ONDE_TIMEOUT, p.kill)
    killer.start()
    b0 = ONDE_B0
    mn, mx = array.array("h"), array.array("h")
    rest = array.array("h")
    n = 0
    swap = sys.byteorder == "big"
    try:
        while True:
            chunk = p.stdout.read(b0 * 2 * 8192)            # 8192 blocs : 1 Mo
            if not chunk:
                break
            a = array.array("h")
            a.frombytes(chunk[: len(chunk) // 2 * 2])
            if swap:
                a.byteswap()
            if rest:
                a = rest + a
            full = len(a) // b0 * b0
            for i in range(0, full, b0):
                s = a[i:i + b0]
                mn.append(min(s))
                mx.append(max(s))
            rest = a[full:]
            n += full
        if rest:                                          # le dernier bloc, incomplet
            mn.append(min(rest))
            mx.append(max(rest))
            n += len(rest)
        p.wait(timeout=30)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        p.kill()
        tmp_flac.unlink(missing_ok=True)
        return False
    finally:
        killer.cancel()
    if p.returncode != 0 or not n or not tmp_flac.is_file():
        tmp_flac.unlink(missing_ok=True)
        _onde_failed[str(dest)] = "ffmpeg ne lit pas de son dans ce fichier"
        return False
    levels = [(mn, mx)]
    while len(levels[-1][0]) > 1:                         # chaque palier : 4 fois moins de paires
        pm, px = levels[-1]
        f = ONDE_F
        levels.append((array.array("h", (min(pm[i:i + f]) for i in range(0, len(pm), f))),
                       array.array("h", (max(px[i:i + f]) for i in range(0, len(px), f)))))
    peak = max(max(mx), -min(mn))
    out = bytearray(_ONDE_HDR.pack(ONDE_MAGIC, ONDE_V, sr, n, peak, b0, ONDE_F, len(levels)))
    out += struct.pack(f"<{len(levels)}I", *(len(lm) for lm, _ in levels))
    for lm, lx in levels:                                 # (min, max) entrelacés, petit-boutiste
        pair = array.array("h", bytes(4 * len(lm)))
        pair[0::2], pair[1::2] = lm, lx
        if swap:
            pair.byteswap()
        out += pair.tobytes()
    tmp = dest.with_name("." + dest.name + ".tmp")
    tmp.write_bytes(bytes(out))
    tmp_flac.replace(flac)                                # la copie d'abord : la pyramide prête dit que tout l'est
    tmp.replace(dest)
    return True


def _onde_run() -> None:
    while True:
        with _onde_cv:
            while not _onde_q:
                _onde_cv.wait()
            src, dest, flac = _onde_q.pop(0)
        try:
            if not dest.is_file():
                with _lock_for(dest):
                    if not dest.is_file():
                        make_onde(src, dest, flac)
        except Exception as e:  # noqa: BLE001 — une file ne meurt pas d'un fichier
            _onde_failed[str(dest)] = f"calcul interrompu : {e}"
        finally:
            with _onde_cv:
                _onde_busy.discard(str(dest))


def onde_queue(src: Path, dest: Path, flac: Path, first: bool = False) -> None:
    """Met le calcul en file (une seule fois) ; `first` : en tête (une page l'attend)."""
    global _onde_worker
    with _onde_cv:
        key = str(dest)
        if key in _onde_busy:
            if first:                                     # déjà en file : passe devant
                for i, x in enumerate(_onde_q):
                    if str(x[1]) == key:
                        _onde_q.insert(0, _onde_q.pop(i))
                        break
            return
        _onde_busy.add(key)
        if first:
            _onde_q.insert(0, (src, dest, flac))
        else:
            _onde_q.append((src, dest, flac))
        if _onde_worker is None or not _onde_worker.is_alive():
            _onde_worker = threading.Thread(target=_onde_run, daemon=True, name="onde-precise")
            _onde_worker.start()
        _onde_cv.notify()


def onde_head(dest: Path) -> dict | None:
    """L'en-tête de la pyramide : {sr, n, peak, b0, f, niveaux, offs} (offs : où commence chaque palier)."""
    try:
        st = dest.stat()
    except OSError:
        return None
    got = _onde_head.get(str(dest))
    if got and got[0] == st.st_mtime_ns:
        return got[1]
    with open(dest, "rb") as fh:
        raw = fh.read(_ONDE_HDR.size)
        if len(raw) < _ONDE_HDR.size:
            return None
        magic, v, sr, n, peak, b0, f, nl = _ONDE_HDR.unpack(raw)
        if magic != ONDE_MAGIC or v != ONDE_V or not 0 < nl < 64:
            return None
        counts = list(struct.unpack(f"<{nl}I", fh.read(4 * nl)))
    offs, o = [], _ONDE_HDR.size + 4 * nl
    for c in counts:
        offs.append(o)
        o += 4 * c
    h = {"sr": sr, "n": n, "peak": peak, "b0": b0, "f": f, "niveaux": counts, "offs": offs}
    _onde_head[str(dest)] = (st.st_mtime_ns, h)
    return h


def soon(src: Path, duration: float | None = None, voice: bool = False) -> None:
    """L'accroche de la mise en bibliothèque (core/library.py : `add_file` pour un son,
    `_add_voice` avec voice=True pour la voix d'un élément) : le masque se calcule à
    côté, dans un fil à part — le dépôt n'attend pas ; une page qui le demande avant
    la fin attend le même verrou. L'onde précise (06/10) se met en file, derrière."""
    src = Path(src)
    dest = src.parent / (wave_name(src.name) if voice else wave_name())
    threading.Thread(target=ensure, args=(src, dest, duration), daemon=True, name="apercu-son").start()
    b, f = onde_names(src.name if voice else None)
    if not (src.parent / b).is_file():
        onde_queue(src, src.parent / b, src.parent / f)


def _source(it: dict, voice: str) -> tuple[Path, Path, float | None]:
    """Le fichier son d'un objet (le son lui-même, ou une voix d'élément) et son masque."""
    if it["kind"] == "audio":
        if voice:
            raise HttpError(400, "un son n'a pas de voix : sans « voix= »")
        src = library.path_of(it)
        return src, src.parent / wave_name(), it.get("duration")
    if it["kind"] == "element":
        voices = (it.get("element") or {}).get("voices") or []
        try:
            v = voices[int(voice or 0)]
        except (ValueError, IndexError):
            raise HttpError(404, "cet élément n'a pas cette voix") from None
        src = library.path_of(it, v["file"])
        return src, src.parent / wave_name(v["file"]), v.get("duration")
    raise HttpError(404, "ni un son, ni un élément qui a une voix")


def r_wave(req, iid):
    # montrer : l'aperçu d'un son se juge par l'objet (can_read_item), pas par le Workspace courant —
    # une page (Asset, le panneau) montre tous les Workspaces qu'on voit, sans X-SR-Espace (étape 2)
    it = library.see(iid)
    if not it:
        raise HttpError(404, f"introuvable : {iid}")
    src, dest, dur = _source(it, req.q("voix"))
    if not src.is_file():
        raise HttpError(404, "le fichier du son manque")
    if not ensure(src, dest, dur):
        raise HttpError(422, "ffmpeg ne lit pas de son dans ce fichier")
    return FileResponse(dest, "image/png", cache=CACHE if req.q("v") == str(VERSION) else "no-cache")


def r_pics(req, iid):
    """`GET /api/son/pics/<id>[?voix=k][&v=1]` → {bps, n, b64} : les pics d'un son, d'une voix
    d'élément, ou de la piste son d'une vidéo (le Montage). Jugé par l'objet, comme le masque."""
    import base64
    it = library.see(iid)
    if not it:
        raise HttpError(404, f"introuvable : {iid}")
    if it["kind"] == "video":
        src = library.path_of(it)
        dur = it.get("duration")
        dest = src.parent / pics_name()
    else:
        src, wave, dur = _source(it, req.q("voix"))
        dest = wave.parent / (pics_name(wave.name[: -len(wave_name())].rstrip(".")) if wave.name != wave_name() else pics_name())
    if not src.is_file():
        raise HttpError(404, "le fichier du son manque")
    if not ensure_pics(src, dest, dur):
        raise HttpError(422, "ffmpeg ne lit pas de son dans ce fichier")
    data = dest.read_bytes()
    import json
    from core.http import Response
    return Response(json.dumps({"bps": BPS, "n": len(data), "b64": base64.b64encode(data).decode("ascii")}),
                    ctype="application/json; charset=utf-8",
                    headers={"Cache-Control": CACHE if req.q("v") == str(VERSION) else "no-cache"})


def _onde_files(req, iid) -> tuple[Path, Path, Path]:
    """Le son d'un objet (un son, une voix d'élément, la piste son d'une vidéo), sa pyramide et
    sa copie d'analyse. Jugé par l'objet, comme le masque (qui voit l'objet voit son onde)."""
    it = library.see(iid)
    if not it:
        raise HttpError(404, f"introuvable : {iid}")
    if it["kind"] == "video":
        src, name = library.path_of(it), None
    else:
        src, wave, _dur = _source(it, req.q("voix"))
        name = None if wave.name == wave_name() else src.name
    if not src.is_file():
        raise HttpError(404, "le fichier du son manque")
    b, f = onde_names(name)
    return src, src.parent / b, src.parent / f


def _onde_cache(req) -> str:
    return CACHE if req.q("v") == str(ONDE_V) else "no-cache"


def _entier(req, nom: str, lo: int, hi: int) -> int:
    try:
        v = int(req.q(nom))
    except ValueError:
        raise HttpError(400, f"« {nom} » : un entier est attendu") from None
    if not lo <= v <= hi:
        raise HttpError(400, f"« {nom} » hors des bornes ({lo} à {hi})")
    return v


def r_onde(req, iid):
    """`GET /api/son/onde/<id>[?voix=k][&v=2]` → l'en-tête `{pret, sr, n, peak, b0, f, niveaux}` (pas
    prête : `{pret: false, attente}`, le calcul passe en tête de la file, la page redemande) ;
    `…?niveau=k&de=i&n=m` → les paires (min, max) i à i+m du palier k, en octets (int16 petit-boutiste)."""
    from core.http import Response
    import json
    src, dest, flac = _onde_files(req, iid)
    h = onde_head(dest) if dest.is_file() else None
    if not h:
        why = _onde_failed.get(str(dest))
        if why:
            raise HttpError(422, why)
        onde_queue(src, dest, flac, first=True)
        return Response(json.dumps({"pret": False, "attente": True}), ctype="application/json; charset=utf-8",
                        headers={"Cache-Control": "no-store"})
    if not req.q("niveau"):
        body = {"pret": True, "v": ONDE_V, **{k: h[k] for k in ("sr", "n", "peak", "b0", "f", "niveaux")}}
        return Response(json.dumps(body), ctype="application/json; charset=utf-8", headers={"Cache-Control": _onde_cache(req)})
    k = _entier(req, "niveau", 0, len(h["niveaux"]) - 1)
    de = _entier(req, "de", 0, max(0, h["niveaux"][k] - 1))
    n = min(_entier(req, "n", 1, NIV_MAX), h["niveaux"][k] - de)
    with open(dest, "rb") as fh:
        fh.seek(h["offs"][k] + 4 * de)
        data = fh.read(4 * n)
    return Response(data, ctype="application/octet-stream", headers={"Cache-Control": _onde_cache(req)})


def r_echantillons(req, iid):
    """`GET /api/son/echantillons/<id>?de=i&n=m[&voix=k][&v=2]` → les échantillons i à i+m (mono, int16
    petit-boutiste, à la fréquence du son), lus dans la copie d'analyse : ceux de la pyramide."""
    from core.http import Response
    _src, dest, flac = _onde_files(req, iid)
    h = onde_head(dest) if dest.is_file() else None
    if not h or not flac.is_file():
        raise HttpError(409, "l'onde de ce son se calcule : demander d'abord /api/son/onde")
    de = _entier(req, "de", 0, max(0, h["n"] - 1))
    n = min(_entier(req, "n", 1, ECH_MAX), h["n"] - de)
    sr = h["sr"]
    # -ss avant l'entrée : ffmpeg saute dans le FLAC puis décode jusqu'à l'instant exact
    # (« accurate_seek », par défaut) ; atrim coupe au nombre d'échantillons
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{de / sr:.9f}", "-i", str(flac),
           "-af", f"atrim=end_sample={n}", "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"]
    with _fen:
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=TIMEOUT)
        except (OSError, subprocess.TimeoutExpired):
            raise HttpError(500, "la lecture des échantillons a échoué") from None
    data = r.stdout[: 2 * n]
    if r.returncode != 0:
        raise HttpError(500, "la lecture des échantillons a échoué")
    if len(data) < 2 * n:                                # la fin du son : complétée de silence
        data += bytes(2 * n - len(data))
    return Response(data, ctype="application/octet-stream", headers={"Cache-Control": _onde_cache(req)})


def register(app) -> None:
    app.route("GET", "/api/son/apercu/{iid}", r_wave)
    app.route("GET", "/api/son/pics/{iid}", r_pics)
    app.route("GET", "/api/son/onde/{iid}", r_onde)
    app.route("GET", "/api/son/echantillons/{iid}", r_echantillons)
    # l'invité d'Idéation voit la forme des sons de ses planches : `library.see` le juge
    rid = r"(?P<iid>[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4})"
    auth.guest_realm("apercu_son", routes=[("GET", r"/api/son/apercu/" + rid, None), ("GET", r"/api/son/onde/" + rid, None),
                                           ("GET", r"/api/son/echantillons/" + rid, None)])


# ── le contrôle (tools/check.py) ─────────────────────────────
def _wav(parts: list[tuple[float, float]], rate: int = 16000) -> bytes:
    """Un WAV mono 16 bits : des morceaux (durée s, amplitude 0-1) d'un son de
    400 Hz (une période tient en un nombre entier d'échantillons : on la répète)."""
    import math
    import wave
    per = rate // 400
    frames = array.array("h")
    for dur, amp in parts:
        one = array.array("h", (int(amp * 32000 * math.sin(2 * math.pi * k / per)) for k in range(per)))
        frames.extend(one * int(dur * 400))
    if sys.byteorder == "big":
        frames.byteswap()
    out = BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames.tobytes())
    return out.getvalue()


def selftest(call, ok) -> None:
    from PIL import Image
    # 1 s de silence, 2 s fort, 1 s faible : la forme doit le montrer, colonne par colonne
    st, it = call("PUT", "/api/library/upload?name=essai-onde.wav&title=Essai%20onde", raw=_wav([(1, 0), (2, 0.9), (1, 0.2)]))
    iid = it.get("id", "") if isinstance(it, dict) else ""
    ok(st == 200 and it.get("kind") == "audio", f"son : un WAV dans la bibliothèque ({st})")
    t0 = time.time()
    st, png = call("GET", f"/api/son/apercu/{iid}?v={VERSION}")
    dt = time.time() - t0
    ok(st == 200 and isinstance(png, bytes) and png[:4] == b"\x89PNG", f"son : le visuel se calcule et se sert ({st}, {dt:.2f} s)")
    if st != 200 or not isinstance(png, bytes):
        return
    # les pics (01/10) : 4 s de son → 4 × BPS pics ; le silence à 0, le fort au plus haut, le faible entre
    import base64
    st, pj = call("GET", f"/api/son/pics/{iid}?v={VERSION}")
    ok(st == 200 and isinstance(pj, dict) and pj.get("bps") == BPS and abs(pj.get("n", 0) - 4 * BPS) <= 2,
       f"son : les pics se servent ({st}, {pj.get('n') if isinstance(pj, dict) else '?'} pics pour 4 s)")
    if st == 200 and isinstance(pj, dict):
        a = base64.b64decode(pj["b64"])
        sil, fort, faible = max(a[10:BPS - 10]), max(a[BPS + 10:3 * BPS - 10]), max(a[3 * BPS + 10:4 * BPS - 10])
        ok(sil <= 5 and fort >= 250 and 20 <= faible <= 120, f"son : les pics suivent le son (silence {sil}, fort {fort}, faible {faible})")
    im = Image.open(BytesIO(png))
    ok(im.size == (W, H) and im.mode == "LA", f"son : un masque {W}×{H} en niveaux de gris + alpha ({im.size} {im.mode})")
    alpha = im.getchannel("A")

    def extent(x0: float, x1: float) -> float:
        """La hauteur moyenne de l'onde (px) entre deux fractions de la largeur."""
        cols = range(int(x0 * W) + 3, int(x1 * W) - 3)
        return sum(sum(1 for y in range(H) if alpha.getpixel((x, y)) > 127) for x in cols) / len(cols)

    sil, loud, soft = extent(0, 0.25), extent(0.25, 0.75), extent(0.75, 1)
    ok(sil <= 2 and loud >= 0.9 * (H - 2) and 0.15 * H <= soft <= 0.3 * H,
       f"son : l'onde suit le son — silence {sil:.1f} px, fort {loud:.1f} px, faible {soft:.1f} px (sur {H})")
    ok(set(im.getchannel("L").getdata()) == {255}, "son : l'image est un masque blanc (la page la peint avec un jeton)")
    d = library.folder_of(iid)
    f = d / wave_name()
    m0 = f.stat().st_mtime_ns if f.exists() else None
    st2, png2 = call("GET", f"/api/son/apercu/{iid}")
    ok(st2 == 200 and png2 == png and f.stat().st_mtime_ns == m0, "son : calculé une fois — la deuxième demande lit le fichier")
    st, _ = call("GET", "/api/son/apercu/aud-20260101-000000-0000")
    ok(st == 404, f"son : un objet absent → 404 ({st})")
    st, img = call("PUT", "/api/library/upload?name=pas-un-son.png", raw=_tiny_png())
    st, _ = call("GET", f"/api/son/apercu/{img.get('id')}")
    ok(st == 404, f"son : une image n'a pas de forme d'onde ({st})")
    st, _ = call("GET", f"/api/son/apercu/{iid}?voix=0")
    ok(st == 400, f"son : « voix= » sur un son est refusé ({st})")
    # la voix d'un élément (element.voices) : son visuel à côté de son fichier
    st, el = call("POST", "/api/elements", {"title": "Voix essai", "type": "character", "refs": [{"item": img.get("id"), "role": "face"}, {"item": iid, "role": "voice"}]})
    eid = el.get("id", "") if isinstance(el, dict) else ""
    has_voice = bool(((el or {}).get("element") or {}).get("voices")) if isinstance(el, dict) else False
    st2, vpng = call("GET", f"/api/son/apercu/{eid}?voix=0&v={VERSION}")
    st3, _ = call("GET", f"/api/son/apercu/{eid}?voix=5")
    ok(st == 200 and has_voice and st2 == 200 and isinstance(vpng, bytes) and vpng[:4] == b"\x89PNG" and st3 == 404,
       f"son : la voix d'un élément a son visuel ({st} {has_voice} {st2}), une voix absente → 404 ({st3})")
    # l'accroche de la mise en bibliothèque : `soon` calcule à côté, sans faire attendre
    st, it2 = call("PUT", "/api/library/upload?name=essai-onde-2.wav", raw=_wav([(0.5, 0.5)]))
    src = library.path_of(library.get(it2["id"]))
    t0 = time.time()
    soon(src, it2.get("duration"))
    quick = time.time() - t0
    for _ in range(100):
        if (src.parent / wave_name()).is_file():
            break
        time.sleep(0.05)
    ok(quick < 0.05 and (src.parent / wave_name()).is_file(), f"son : `soon` rend la main ({quick * 1000:.1f} ms) et le masque arrive")
    # un long son (10 min) : la fréquence s'abaisse, la durée entière tient
    long = library.folder_of(iid) / "long.wav"
    long.write_bytes(_wav([(300, 0.0), (300, 0.8)], rate=8000))
    t0 = time.time()
    amps = peaks(long, W, 600)
    ok(amps is not None and max(amps[: W // 2 - 2]) < 0.01 and min(amps[W // 2 + 2:]) > 0.9,
       f"son : un son de 10 min se lit en entier, la moitié silencieuse à gauche ({time.time() - t0:.2f} s)")
    long.unlink()
    _selftest_onde(call, ok, eid)


def _wav_ech(ech: array.array, rate: int) -> bytes:
    """Un WAV mono 16 bits de ces échantillons-là, tels quels."""
    import wave
    a = array.array("h", ech)
    if sys.byteorder == "big":
        a.byteswap()
    out = BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(a.tobytes())
    return out.getvalue()


def _selftest_onde(call, ok, eid: str) -> None:
    """L'onde précise (06/10) : la pyramide et les échantillons servis sont ceux du son, exactement."""
    def attendre(path: str):
        for _ in range(150):
            st, r = call("GET", path)
            if st != 200 or not isinstance(r, dict) or r.get("pret"):
                return st, r
            time.sleep(0.2)
        return st, r

    def i16(raw) -> array.array:
        a = array.array("h")
        a.frombytes(raw if isinstance(raw, bytes) else b"")
        if sys.byteorder == "big":
            a.byteswap()
        return a

    # un son dissymétrique (des crêtes positives seules, tous les 97 échantillons), d'une longueur sans compte rond
    ech = array.array("h", [(i * 7919) % 20000 - 7000 if i % 97 else 31000 for i in range(48000 * 2 + 123)])
    st, it = call("PUT", "/api/library/upload?name=essai-onde-precise.wav", raw=_wav_ech(ech, 48000))
    iid = it.get("id", "") if isinstance(it, dict) else ""
    t0 = time.time()
    st, h = attendre(f"/api/son/onde/{iid}?v={ONDE_V}")
    ok(st == 200 and h.get("pret") and h.get("sr") == 48000 and h.get("n") == len(ech) and h.get("peak") == 31000
       and h.get("b0") == ONDE_B0 and h.get("niveaux", [0])[-1] == 1,
       f"onde : l'en-tête — 48 kHz, {len(ech)} échantillons, le plus fort 31000, jusqu'au son entier ({st}, {time.time() - t0:.1f} s)")
    if not (st == 200 and h.get("pret")):
        return
    d = library.folder_of(iid)
    b, f = onde_names()
    ok((d / b).is_file() and (d / f).is_file(), "onde : la pyramide et la copie d'analyse rangées à côté du son")
    juste = True
    for k in (0, 1, 2):
        B = ONDE_B0 * ONDE_F ** k
        st, raw = call("GET", f"/api/son/onde/{iid}?v={ONDE_V}&niveau={k}&de=0&n={h['niveaux'][k]}")
        p = i16(raw)
        attendu = array.array("h")
        for i in range(0, len(ech), B):
            attendu.extend((min(ech[i:i + B]), max(ech[i:i + B])))
        juste = juste and st == 200 and p == attendu
    ok(juste, "onde : les paliers 0, 1 et 2 sont les min et max exacts de 64, 256 et 1024 échantillons")
    st, raw = call("GET", f"/api/son/onde/{iid}?v={ONDE_V}&niveau={len(h['niveaux']) - 1}&de=0&n=4")
    ok(st == 200 and i16(raw) == array.array("h", (min(ech), max(ech))), "onde : le dernier palier résume le son entier")
    st, raw = call("GET", f"/api/son/onde/{iid}?v={ONDE_V}&niveau=0&de=10&n=3")
    ok(st == 200 and i16(raw) == array.array("h", (min(ech[640:704]), max(ech[640:704]), min(ech[704:768]), max(ech[704:768]),
                                                   min(ech[768:832]), max(ech[768:832]))), "onde : une tranche d'un palier, à sa place")
    t0 = time.time()
    st, raw = call("GET", f"/api/son/echantillons/{iid}?v={ONDE_V}&de=12345&n=4000")
    ok(st == 200 and i16(raw) == ech[12345:16345], f"onde : les échantillons 12345 à 16344, exacts ({st}, {(time.time() - t0) * 1000:.0f} ms)")
    st, raw = call("GET", f"/api/son/echantillons/{iid}?v={ONDE_V}&de={len(ech) - 10}&n=100")
    ok(st == 200 and i16(raw) == ech[-10:], f"onde : la fin du son — les 10 derniers, pas plus ({st})")
    bad = [call("GET", f"/api/son/onde/{iid}?niveau=99&de=0&n=1")[0], call("GET", f"/api/son/onde/{iid}?niveau=0&de=-1&n=1")[0],
           call("GET", f"/api/son/echantillons/{iid}?de=0&n=0")[0], call("GET", f"/api/son/echantillons/{iid}?de=0&n={ECH_MAX + 1}")[0],
           call("GET", f"/api/son/echantillons/{iid}?de=x&n=1")[0]]
    ok(bad == [400] * 5, f"onde : un palier, un début, un nombre hors des bornes → 400 ({bad})")
    st, img = call("PUT", "/api/library/upload?name=pas-un-son-2.png", raw=_tiny_png())
    st2, _ = call("GET", f"/api/son/onde/{img.get('id')}")
    st3, _ = call("GET", "/api/son/echantillons/aud-20260101-000000-0000?de=0&n=1")
    ok(st2 == 404 and st3 == 404, f"onde : une image n'en a pas, un objet absent non plus ({st2}, {st3})")
    m0 = (d / b).stat().st_mtime_ns
    st, h2 = call("GET", f"/api/son/onde/{iid}")
    ok(st == 200 and h2.get("n") == h["n"] and (d / b).stat().st_mtime_ns == m0, "onde : calculée une fois — la deuxième demande lit le fichier")
    cmd = " ".join(onde_command(Path("x"), Path("y"), 48000))
    ok("aresample=48000:async=1:first_pts=0" in cmd and "asplit=2" in cmd and "-c:a flac" in cmd,
       "onde : un seul décodage, aux temps de l'originale, pour la pyramide et la copie sans perte")
    # la voix d'un élément : la sienne, à côté de son fichier
    st, hv = attendre(f"/api/son/onde/{eid}?voix=0&v={ONDE_V}")
    ok(st == 200 and hv.get("pret") and hv.get("n", 0) > 0, f"onde : la voix d'un élément a la sienne ({st})")
    # le son d'une vidéo (le Montage) : un MP4 avec un son AAC
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        mp4 = Path(td) / "v.mp4"
        r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "color=c=gray:s=64x64:r=25:d=1",
                            "-f", "lavfi", "-i", "sine=f=440:sample_rate=48000:d=1", "-c:v", "libx264", "-preset", "ultrafast",
                            "-c:a", "aac", "-shortest", str(mp4)], capture_output=True, timeout=60)
        if r.returncode == 0:
            st, vid = call("PUT", "/api/library/upload?name=essai-onde-video.mp4", raw=mp4.read_bytes())
            vid_id = vid.get("id", "") if isinstance(vid, dict) else ""
            st, hv = attendre(f"/api/son/onde/{vid_id}?v={ONDE_V}")
            st2, raw = call("GET", f"/api/son/echantillons/{vid_id}?v={ONDE_V}&de=0&n={ONDE_B0}")
            st3, rawp = call("GET", f"/api/son/onde/{vid_id}?v={ONDE_V}&niveau=0&de=0&n=1")
            e0 = i16(raw)
            ok(st == 200 and hv.get("pret") and hv.get("sr") == 48000 and st2 == 200 and len(e0) == ONDE_B0
               and i16(rawp) == array.array("h", (min(e0), max(e0))),
               f"onde : le son d'une vidéo — sa pyramide et ses échantillons s'accordent ({st}, {st2}, {st3})")


def _tiny_png() -> bytes:
    from PIL import Image
    out = BytesIO()
    Image.new("RGB", (8, 8), (10, 10, 10)).save(out, "PNG")
    return out.getvalue()
