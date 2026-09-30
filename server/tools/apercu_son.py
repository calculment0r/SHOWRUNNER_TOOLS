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


def peaks(src: Path, cols: int = W, duration: float | None = None) -> list[float] | None:
    """Le pic de chaque colonne (0 à 1, normalisé sur le plus fort), ou None si
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
    n = len(a)
    if not n:
        return None
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


def soon(src: Path, duration: float | None = None, voice: bool = False) -> None:
    """L'accroche de la mise en bibliothèque (core/library.py : `add_file` pour un son,
    `_add_voice` avec voice=True pour la voix d'un élément) : le masque se calcule à
    côté, dans un fil à part — le dépôt n'attend pas ; une page qui le demande avant
    la fin attend le même verrou."""
    src = Path(src)
    dest = src.parent / (wave_name(src.name) if voice else wave_name())
    threading.Thread(target=ensure, args=(src, dest, duration), daemon=True, name="apercu-son").start()


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


def register(app) -> None:
    app.route("GET", "/api/son/apercu/{iid}", r_wave)
    # l'invité d'Idéation voit la forme des sons de ses planches : `library.see` le juge
    auth.guest_realm("apercu_son", routes=[("GET", r"/api/son/apercu/(?P<iid>[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4})", None)])


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


def _tiny_png() -> bytes:
    from PIL import Image
    out = BytesIO()
    Image.new("RGB", (8, 8), (10, 10, 10)).save(out, "PNG")
    return out.getvalue()
