"""Le lien d'écoute (05/10/2026) : une playlist de la bibliothèque devient un
lecteur à part, celui de l'album AGOSTA de Cal généralisé, qu'on donne par une
adresse ou dans un .zip. Étude : docs/etudes/musique_spaces_playlists.md § 4 et
§ 5 (étapes 3, 5 et 6) ; décisions de Cal du 05/10 : la destination par défaut
est Cloudflare (L1), publier = `espaces.can_publish` et un guest ne publie jamais
(L2), le lecteur ne nomme pas l'outil (L3), le .zip d'abord.

Le lecteur est dans `ecoute/` (index.html, player.js, app.js, ecoute.css, le
manifeste, le service worker) ; il lit un `playlist.json`. Ici, on fabrique le
PAQUET d'une playlist — le même dossier, zippé (destination C) ou envoyé dans R2
(destination A) :

    index.html             le gabarit, avec le titre et l'aperçu du lien (Open
                           Graph : pochette, titre, artiste dans WhatsApp, iMessage,
                           Slack) écrits pour cette playlist
    playlist.json          les données (l'équivalent d'album-data.js d'AGOSTA)
    player.js, app.js, ecoute.css, service-worker.js   le code, recopié tel quel
    manifest.webmanifest   l'application installable, au nom de la playlist
    assets/                cover-1200.jpg, cover-512.jpg (la pochette carrée),
                           icon-192.png, icon-512.png (PIL)
    audio/                 les MP3, 256 kbit/s, 44,1 kHz, stéréo, ramenés à −14 LUFS
                           intégrés (crête vraie ≤ −1 dBTP) par `ffmpeg loudnorm` en
                           deux passes : une mesure, puis la correction avec les
                           valeurs mesurées (linear=true : un simple gain quand la
                           crête le permet, sinon loudnorm passe en dynamique et le
                           rapport le dit). L'original n'est jamais touché.
    paroles/               les LRC (celui du morceau dans la playlist, sinon le
                           champ `lrc` de l'objet audio)

Les enchaînements (`playlist.transition`) :
  gapless    un fichier par morceau ; le suivant part dès la fin du précédent
             (les MP3 portent l'en-tête LAME : pas de silence d'encodeur). Le
             changement de fichier d'un seul <audio> coûte un court blanc (mesuré
             dans le compte rendu) : qui veut zéro prend « single ».
  crossfade  fondu enchaîné de `crossfade_s` (0 à 6 s), FABRIQUÉ à la publication
             dans un seul fichier continu (`acrossfade`, courbes qsin : la
             puissance reste égale). Un seul <audio> ne joue pas deux sons à la
             fois, et l'API Web Audio couperait la lecture écran verrouillé : le
             fondu ne peut être que dans le fichier.
  single     un seul fichier continu sans fondu (le mode d'AGOSTA, le plus sûr sur
             iPhone écran verrouillé), fabriqué à la publication.
En continu, les bornes de chaque morceau (start, end) sont dans playlist.json,
exactes à l'échantillon (les WAV intermédiaires).

Les destinations :
  C, le .zip   `POST /api/ecoute/<id>/zip {adresse?}` → le travail `ecoute.zip`
               (voie cpu, ffmpeg) ; son résultat : `zip.url`, servi par la route
               des zips d'Asset (gardé deux heures). `adresse` (facultative) :
               l'adresse où Cal hébergera le dossier, pour que l'aperçu du lien
               ait des adresses absolues (Open Graph l'exige).
  A, Cloudflare `POST /api/ecoute/<id>/publier {code?, fin?}` → le travail
               `ecoute.publier` : le paquet sous `ecoute/<jeton>/` du bucket R2
               de la porte (porte/r2_recopie.py), servi par la route `/ecoute/*`
               de porte/worker.js, hors de la porte à code ; le jeton est aléatoire
               (128 bits). Republier met à jour le MÊME lien (seuls les fichiers
               qui ont changé repartent). `POST /api/ecoute/<id>/retirer` efface le
               préfixe : le lien meurt pour de bon. Un code facultatif, une date de
               fin, le compteur d'écoutes : `_lien.json` (jamais servi), lu par le
               Worker. RIEN N'EST DÉPLOYÉ : il faut le jeton R2 de Cal (geste 9 de
               docs/etudes/cloudflare.md) ; sans lui, ces routes le disent (409).
  `GET /api/ecoute/<id>` : le lien, ses réglages, ses écoutes, et si l'on peut
  publier (sinon pourquoi).

Droits : fabriquer un .zip ou un lien, c'est publier — `espaces.can_publish`
dans le Workspace de la playlist (un guest jamais, un lecteur non plus) ; la
garde du calcul (cost « cpu ») juge en plus le travail.

Données : `<data_dir>/ecoute/` — `mesures.json` (la première passe de loudnorm de
chaque son, par empreinte du fichier : republier ne remesure rien), `liens.json`
(les liens publiés : jeton, adresse, réglages, l'empreinte de chaque fichier
envoyé ; l'empreinte du code, jamais le code).
"""

from __future__ import annotations

import colorsys
import hashlib
import html
import importlib.util
import json
import mimetypes
import os
import re
import secrets
import shutil
import stat
import subprocess
import threading
import time
import unicodedata
import wave
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from core import auth, config, espaces, jobs, library
from core.http import HttpError

TOOL = "ecoute"
GABARIT = config.REPO / "ecoute"
CODE = ("player.js", "app.js", "ecoute.css", "service-worker.js")   # recopiés tels quels dans chaque paquet
VERSION = 1                     # la forme de playlist.json
CIBLE_LUFS = -14.0              # le niveau des plateformes d'écoute (étude § 3.5)
CRETE_DBTP = -1.0
DEBIT, FREQ = "256k", 44100
FONDU_MAX = 6.0
MAX_MORCEAUX = 200
MODES = ("gapless", "crossfade", "single")
OG_MAX = 300_000                # l'aperçu de WhatsApp tient sous 300 Ko (mesuré : une pochette 1200 en q82, ~150 Ko)
COMPTE_S = 60                   # les écoutes lues dans R2, gardées une minute
FFMPEG = 2                      # deux ffmpeg à la fois au plus (le portail en fait tourner d'autres)
R2_POINT: str | None = None     # essais : un faux S3 local à la place de R2 (selftest)
TYPES = {".html": "text/html; charset=utf-8", ".json": "application/json", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg",
         ".lrc": "text/plain; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".txt": "text/plain; charset=utf-8"}

_lock = threading.Lock()
_slots = threading.BoundedSemaphore(FFMPEG)
_compte: dict[str, tuple[float, dict]] = {}


def _dir() -> Path:
    d = config.data_dir() / "ecoute"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _lis(name: str) -> dict:
    try:
        return json.loads((_dir() / name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _ecris(name: str, d: dict) -> None:
    f = _dir() / name
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    os.chmod(tmp, 0o600)   # liens.json porte l'empreinte des codes
    tmp.replace(f)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _slug(s: str, fallback: str = "morceau") -> str:
    a = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", a).strip("-")[:48] or fallback


def _sha(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for buf in iter(lambda: fh.read(1 << 20), b""):
            h.update(buf)
    return h.hexdigest()


# ── les couleurs : celles du thème du portail (commun/tokens.css), jamais en dur ──
def jetons() -> dict:
    """Les jetons de commun/tokens.css : {"dark": {nom: valeur}, "light": {…}} (le bloc
    :root, puis le bloc [data-theme="light"]). Une seule vérité, lue ici aussi : les
    couleurs que le serveur écrit (manifeste, icônes sans pochette, contraste de
    l'accent) en viennent."""
    return _blocs((config.REPO / "commun" / "tokens.css").read_text(encoding="utf-8"))


def _blocs(css: str) -> dict:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out = {}
    for name, sel in (("dark", r":root\s*\{"), ("light", r"\[data-theme=\"light\"\]\s*\{")):
        m = re.search(sel + r"(.*?)\}", css, flags=re.S)
        out[name] = {k: " ".join(v.split()) for k, v in re.findall(r"--([a-z0-9-]+)\s*:\s*([^;]+);", m.group(1) if m else "")}
    return out


def _rgb(hexa: str) -> tuple[int, int, int]:
    h = hexa.strip().lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _hexa(rgb) -> str:
    return "#" + "".join(f"{max(0, min(255, round(c))):02x}" for c in rgb)


def _lum(rgb) -> float:
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contraste(a, b) -> float:
    """Le rapport de contraste WCAG 2 entre deux couleurs RGB."""
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def _ajuste(rgb, fonds: list, sens: int) -> tuple:
    """La teinte gardée, la clarté poussée (sens +1 : plus claire, −1 : plus sombre)
    jusqu'au contraste AA (4,5:1) sur chacun des fonds du thème."""
    h, l, s = colorsys.rgb_to_hls(*(c / 255 for c in rgb))
    for _ in range(101):
        cur = tuple(c * 255 for c in colorsys.hls_to_rgb(h, l, s))
        if min(contraste(cur, f) for f in fonds) >= 4.5:
            return cur
        l = max(0.0, min(1.0, l + 0.01 * sens))
    return tuple(c * 255 for c in colorsys.hls_to_rgb(h, l, s))


def accent(im) -> dict | None:
    """La couleur dominante d'une pochette, en accent du lecteur (étude § 3.2) : la
    plus présente des couleurs franches (quantification médiane en 10 teintes,
    pondérée par la saturation ; ni le noir ni le blanc), puis, pour chaque thème,
    sa clarté poussée jusqu'au contraste AA sur les fonds du thème, et l'encre de
    l'aplat (le bouton lecture) choisie entre les encres du thème. None : une
    pochette sans couleur (noir et blanc) — le lecteur garde l'orange du thème."""
    from PIL import Image
    small = im.convert("RGB")
    small.thumbnail((96, 96))
    q = small.quantize(colors=10, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette() or []
    counts = q.getcolors() or []
    total = sum(c for c, _ in counts) or 1
    best, score = None, 0.0
    for c, i in counts:
        rgb = tuple(pal[3 * i:3 * i + 3])
        h, l, s = colorsys.rgb_to_hls(*(x / 255 for x in rgb))
        if l < 0.08 or l > 0.94 or s < 0.12:
            continue
        sc = (c / total) * (0.25 + s) * (1 - abs(l - 0.5))
        if sc > score:
            best, score = rgb, sc
    if best is None:
        return None
    j = jetons()
    out = {}
    for th, sens in (("dark", +1), ("light", -1)):
        fonds = [_rgb(j[th][k]) for k in ("bg", "panel", "panel2", "panel3")]
        acc = _ajuste(best, fonds, sens)
        encres = [_rgb(j["dark"]["bg"]), _rgb(j["light"]["panel"])]
        out[th] = _hexa(acc)
        out[f"{th}_ink"] = _hexa(max(encres, key=lambda e: contraste(e, acc)))
    return out


# ── les pochettes et les icônes ──
def pochettes(src: Path | None, assets: Path) -> dict:
    """cover-1200.jpg, cover-512.jpg, icon-192.png, icon-512.png dans `assets` ;
    rend {cover: bool, accent}. Une pochette non carrée est recadrée au centre ;
    sans pochette, les icônes sont faites des couleurs du thème."""
    from PIL import Image, ImageDraw, ImageOps
    assets.mkdir(parents=True, exist_ok=True)
    if src is None:
        j = jetons()["dark"]
        for n in (192, 512):
            im = Image.new("RGB", (n, n), _rgb(j["bg"]))
            ImageDraw.Draw(im).ellipse((n * 0.22, n * 0.22, n * 0.78, n * 0.78), fill=_rgb(j["or"]))
            im.save(assets / f"icon-{n}.png", "PNG", optimize=True)
        return {"cover": False, "accent": None}
    with Image.open(src, formats=library.PIL_FORMATS) as im0:
        im = ImageOps.exif_transpose(im0).convert("RGB")
    side = min(im.size)
    left, top = (im.width - side) // 2, (im.height - side) // 2
    sq = im.crop((left, top, left + side, top + side))
    big = sq.resize((1200, 1200), Image.LANCZOS)
    for q in (82, 72, 62):   # l'aperçu du lien sous 300 Ko
        big.save(assets / "cover-1200.jpg", "JPEG", quality=q, optimize=True, progressive=True)
        if (assets / "cover-1200.jpg").stat().st_size <= OG_MAX:
            break
    sq.resize((512, 512), Image.LANCZOS).save(assets / "cover-512.jpg", "JPEG", quality=85, optimize=True)
    for n in (192, 512):
        sq.resize((n, n), Image.LANCZOS).save(assets / f"icon-{n}.png", "PNG", optimize=True)
    return {"cover": True, "accent": accent(sq)}


# ── le son ──
def _ff(args: list, timeout: float = 3600) -> subprocess.CompletedProcess:
    with _slots:
        return subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-nostats", *args], capture_output=True, text=True,
                              timeout=timeout)


def _json_loudnorm(stderr: str) -> dict:
    """Le bloc JSON que loudnorm écrit à la fin (print_format=json)."""
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", stderr, flags=re.S)
    if not m:
        raise RuntimeError("loudnorm n'a rien mesuré (le fichier a-t-il du son ?)")
    return json.loads(m.group(0))


def mesure(src: Path) -> dict:
    """La première passe de loudnorm : le volume intégré, la crête vraie, l'étendue
    (LRA) et le seuil du son. Gardée par empreinte du fichier (mesures.json)."""
    sha = _sha(src)
    with _lock:
        got = _lis("mesures.json").get(sha)
    if got:
        return got
    r = _ff(["-i", str(src), "-vn", "-af", f"loudnorm=I={CIBLE_LUFS}:TP={CRETE_DBTP}:LRA=11:print_format=json",
             "-f", "null", "-"])
    m = _json_loudnorm(r.stderr)
    with _lock:
        d = _lis("mesures.json")
        d[sha] = m
        _ecris("mesures.json", d)
    return m


TOLERANCE_LU = 0.5   # l'écart permis au niveau visé (EBU R 128 : ±0,5 LU quand la normalisation peut être exacte)


def reglage(m: dict) -> tuple[float, float]:
    """(niveau visé, crête visée) de la seconde passe, choisis pour que loudnorm reste
    LINÉAIRE (un simple gain : la dynamique du morceau ne bouge pas) chaque fois que
    c'est possible. Loudnorm n'est linéaire que si la crête après le gain reste sous la
    crête visée ; sinon il passe en dynamique, qui compresse (mesuré sur l'album AGOSTA
    le 05/10 : LONELYNESS, −0,5 dB à faire, étendue LRA tombée de 5,8 à 3,5 LU). Donc :
      · le gain laisse la crête sous −1 dBTP : −14 LUFS, −1 dBTP ;
      · un gain négatif (le son baisse, ses crêtes aussi) : −14 LUFS, la crête visée
        haussée jusqu'à celle que donne le gain (0 dBTP au plus : au-delà, un master qui
        écrête déjà, loudnorm limite) ;
      · un gain positif que la crête bride de 0,5 LU au plus : le plus fort gain
        linéaire (le niveau visé à moins de 0,5 LU de −14) ;
      · sinon (un son trop faible dont la crête bloque) : −14 LUFS en dynamique, comme
        décidé (étude § 3.5) ; le rapport le dit."""
    i, tp = float(m["input_i"]), float(m["input_tp"])
    gain = CIBLE_LUFS - i
    apres = tp + gain
    if apres <= CRETE_DBTP:
        return CIBLE_LUFS, CRETE_DBTP
    if gain <= 0:
        return CIBLE_LUFS, min(0.0, round(apres + 0.02, 2))
    if apres - CRETE_DBTP <= TOLERANCE_LU:
        return round(CIBLE_LUFS - (apres - CRETE_DBTP) - 0.01, 2), CRETE_DBTP
    return CIBLE_LUFS, CRETE_DBTP


def normalise(src: Path, dest: Path, m: dict) -> dict:
    """La seconde passe : le son ramené à −14 LUFS (reglage), en WAV 44,1 kHz stéréo
    16 bits. LRA visé = au moins celui mesuré (sinon loudnorm refuse aussi le linéaire)."""
    cible, crete = reglage(m)
    lra = min(50.0, max(11.0, float(m["input_lra"]) + 1))
    af = (f"loudnorm=I={cible:g}:TP={crete:g}:LRA={lra:g}:measured_I={m['input_i']}:measured_TP={m['input_tp']}"
          f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}"
          ":linear=true:print_format=json")
    r = _ff(["-y", "-i", str(src), "-vn", "-af", af, "-ar", str(FREQ), "-ac", "2", "-c:a", "pcm_s16le", str(dest)])
    if r.returncode or not dest.exists():
        raise RuntimeError(f"ffmpeg (loudnorm) : {r.stderr.strip()[-300:]}")
    return {**_json_loudnorm(r.stderr), "cible": cible, "crete": crete}


def duree_wav(p: Path) -> float:
    with wave.open(str(p), "rb") as w:
        return w.getnframes() / w.getframerate()


def _mp3(src: Path, dest: Path, meta: dict, cover: Path | None) -> None:
    """MP3 256 kbit/s CBR, 44,1 kHz, stéréo ; les balises ID3 (titre, artiste, album,
    numéro, année) et la pochette 512 pour qui le télécharge ; l'en-tête LAME
    (délai et remplissage de l'encodeur : pas de silence ajouté entre deux morceaux)."""
    args = ["-y", "-i", str(src)]
    if cover is not None:
        args += ["-i", str(cover), "-map", "0:a", "-map", "1:v", "-c:v", "copy", "-disposition:v", "attached_pic",
                 "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)"]
    args += ["-c:a", "libmp3lame", "-b:a", DEBIT, "-ar", str(FREQ), "-ac", "2", "-id3v2_version", "3"]
    for k, v in meta.items():
        if v:
            args += ["-metadata", f"{k}={v}"]
    r = _ff(args + [str(dest)])
    if r.returncode or not dest.exists():
        raise RuntimeError(f"ffmpeg (mp3) : {r.stderr.strip()[-300:]}")


def continu(wavs: list[Path], fondu: float, dest: Path) -> list[tuple[float, float]]:
    """Un seul fichier (WAV) fait des morceaux à la suite : bout à bout (fondu = 0) ou
    en fondus enchaînés. Rend les bornes (start, end) de chaque morceau dans ce
    fichier, à l'échantillon : avec un fondu, le morceau k+1 commence quand celui
    d'avant commence à s'éteindre ; le fondu d'une paire ne dépasse jamais la
    moitié du plus court des deux."""
    durs = [duree_wav(w) for w in wavs]
    ins = []
    for w in wavs:
        ins += ["-i", str(w)]
    n = len(wavs)
    fondus = [min(fondu, durs[k] / 2, durs[k + 1] / 2) if fondu > 0 else 0.0 for k in range(n - 1)]
    if n == 1:
        graph, out = "[0:a]anull[o]", "[o]"
    elif fondu <= 0:
        graph, out = "".join(f"[{k}:a]" for k in range(n)) + f"concat=n={n}:v=0:a=1[o]", "[o]"
    else:
        parts, prev = [], "[0:a]"
        for k in range(1, n):
            tag = f"[x{k}]"
            parts.append(f"{prev}[{k}:a]acrossfade=d={fondus[k - 1]:.6f}:c1=qsin:c2=qsin{tag}")
            prev = tag
        graph, out = ";".join(parts), prev
    r = _ff(["-y", *ins, "-filter_complex", graph, "-map", out, "-ar", str(FREQ), "-ac", "2", "-c:a", "pcm_s16le", str(dest)])
    if r.returncode or not dest.exists():
        raise RuntimeError(f"ffmpeg (fichier continu) : {r.stderr.strip()[-300:]}")
    bornes, t = [], 0.0
    for k, d in enumerate(durs):
        bornes.append((t, t + d))
        t += d - (fondus[k] if k < n - 1 else 0.0)
    return bornes


# ── la playlist ──
def _texte_lrc(txt) -> str:
    return str(txt or "").replace("\ufeff", "").replace("\r\n", "\n").strip()


def lrc_de(track: dict, it: dict) -> str:
    """Le LRC d'un morceau : celui de la playlist (`tracks[i].lrc`), sinon le champ
    `lrc` de l'objet audio (posé par l'outil des paroles calées) — un texte LRC, ou
    le nom d'un fichier .lrc rangé dans le dossier de l'objet."""
    for v in (track.get("lrc"), it.get("lrc")):
        if isinstance(v, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,120}\.lrc", v.strip()):
            p = library.folder_of(it["id"]) / v.strip()
            if p.is_file():
                return _texte_lrc(p.read_text(encoding="utf-8", errors="replace"))
            continue
        if isinstance(v, str) and v.strip():
            return _texte_lrc(v)
    return ""


def paroles_de(track: dict, it: dict) -> str:
    """Des paroles sans temps (affichées sans défilement) : celles de la playlist,
    sinon celles de la recette d'une chanson de Musique (`params.chanson.lyrics`),
    sans ses repères de structure ([verse], [chorus]…)."""
    txt = track.get("lyrics")
    if not (isinstance(txt, str) and txt.strip()):
        txt = ((it.get("params") or {}).get("chanson") or {}).get("lyrics") or ""
    lines = [ln.rstrip() for ln in str(txt).replace("\r\n", "\n").split("\n")]
    return "\n".join(ln for ln in lines if not re.fullmatch(r"\s*\[[^\]:]*\]\s*", ln)).strip()


def lis_playlist(pl_it: dict) -> dict:
    """La playlist validée (ValueError qui dit ce qui manque) : ses morceaux avec leur
    objet audio (lu dans le Workspace courant : `library.get`), son enchaînement."""
    p = pl_it.get("playlist") if isinstance(pl_it.get("playlist"), dict) else {}
    raw = p.get("tracks") if isinstance(p.get("tracks"), list) else []
    if not raw:
        raise ValueError("la playlist est vide : ajoutez-y des sons")
    if len(raw) > MAX_MORCEAUX:
        raise ValueError(f"{len(raw)} morceaux : {MAX_MORCEAUX} au plus")
    tracks = []
    for k, t in enumerate(raw):
        t = t if isinstance(t, dict) else {"item": t}
        it = library.get(str(t.get("item") or ""))
        if not it or it.get("kind") != "audio" or not it.get("file"):
            raise ValueError(f"morceau {k + 1} : son introuvable dans ce Workspace ({t.get('item')})")
        src = library.path_of(it)
        if not src.is_file():
            raise ValueError(f"morceau {k + 1} : le fichier de « {it.get('title')} » manque")
        tracks.append({"track": t, "item": it, "src": src})
    tr = p.get("transition") if isinstance(p.get("transition"), dict) else {}
    mode = tr.get("mode") if tr.get("mode") in MODES else "gapless"
    try:
        fondu = max(0.0, min(FONDU_MAX, float(tr.get("crossfade_s") or 0)))
    except (TypeError, ValueError):
        fondu = 0.0
    cover = None
    if p.get("cover"):
        ci = library.get(str(p["cover"]))
        if ci and ci.get("kind") == "image" and ci.get("file") and library.path_of(ci).is_file():
            cover = library.path_of(ci)
    return {"title": str(pl_it.get("title") or "Playlist")[:200], "artist": str(p.get("artist") or "")[:200],
            "year": str(p.get("year") or "")[:20], "description": str(p.get("description") or "")[:2000],
            "cover": cover, "tracks": tracks, "mode": mode, "fondu": fondu if mode == "crossfade" else 0.0,
            "download": p.get("download") is True, "id": pl_it["id"]}


def _adresse(a) -> str:
    """L'adresse publique du dossier (https://…/), ou "" ; ValueError sinon."""
    a = str(a or "").strip()
    if not a:
        return ""
    if not re.fullmatch(r"https?://[^\s\"'<>]{1,400}", a):
        raise ValueError("adresse : une adresse http(s)://… complète, là où le dossier sera hébergé")
    return a if a.endswith("/") else a + "/"


def _tete(pl: dict, adresse: str, couv: bool, nb: int) -> str:
    """Le bloc ecoute:tete d'index.html : le titre, la description, l'aperçu du lien
    (Open Graph : https://ogp.me/ ; og:image en adresse absolue, sinon les aperçus
    l'ignorent : on n'en écrit une que si l'adresse est connue), la couleur de la
    barre du navigateur (les fonds des deux thèmes)."""
    e = lambda s: html.escape(str(s), quote=True)   # noqa: E731
    j = jetons()
    titre = pl["title"] + (f" — {pl['artist']}" if pl["artist"] else "")
    bits = [x for x in (pl["artist"], pl["year"], f"{nb} titre{'s' if nb > 1 else ''}") if x]
    desc = pl["description"] or " · ".join(bits)
    out = [f"<title>{e(titre)}</title>",
           f'<meta name="description" content="{e(desc)}">',
           f'<meta name="apple-mobile-web-app-title" content="{e(pl["title"][:30])}">',
           f'<meta name="theme-color" media="(prefers-color-scheme: dark)" content="{e(j["dark"]["bg"])}">',
           f'<meta name="theme-color" media="(prefers-color-scheme: light)" content="{e(j["light"]["bg"])}">',
           '<meta property="og:type" content="music.playlist">',
           f'<meta property="og:title" content="{e(pl["title"])}">',
           f'<meta property="og:description" content="{e(" · ".join(bits) if pl["description"] else desc)}">']
    if adresse:
        out.append(f'<meta property="og:url" content="{e(adresse)}">')
        if couv:
            out += [f'<meta property="og:image" content="{e(adresse + "assets/cover-1200.jpg")}">',
                    '<meta property="og:image:type" content="image/jpeg">',
                    '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="1200">',
                    f'<meta property="og:image:alt" content="{e("Pochette de " + pl["title"])}">',
                    '<meta name="twitter:card" content="summary_large_image">']
    return "\n".join(out)


def _v(p: Path) -> str:
    return _sha(p)[:10]


def fabrique(pl_it: dict, dest: Path, *, adresse: str = "", stats: bool = False, check=lambda: None,
             progress=lambda f=None, m=None: None) -> dict:
    """Le paquet du lecteur de cette playlist dans `dest` (créé, vidé). Rend le
    rapport : pour chaque morceau, le volume intégré et la crête vraie avant et
    après, le mode de loudnorm ; la durée, la taille. `stats` : le lecteur compte
    les écoutes (la destination Cloudflare, dont le Worker les range)."""
    pl = lis_playlist(pl_it)
    if dest.exists():
        shutil.rmtree(dest)
    for sub in ("assets", "audio", "paroles"):
        (dest / sub).mkdir(parents=True)
    tmp = dest.parent / f".{dest.name}-wav"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    try:
        progress(0.02, "la pochette")
        cv = pochettes(pl["cover"], dest / "assets")
        cover512 = dest / "assets" / "cover-512.jpg" if cv["cover"] else None
        n = len(pl["tracks"])
        done = [0]

        def un(k):   # mesurer, puis normaliser (deux ffmpeg à la fois au plus : _slots)
            check()
            t = pl["tracks"][k]
            m = mesure(t["src"])
            check()
            wav = tmp / f"{k + 1:03d}.wav"
            after = normalise(t["src"], wav, m)
            done[0] += 1
            progress(0.05 + 0.7 * done[0] / n, f"volume égal · {done[0]}/{n}")
            return m, after, wav

        with ThreadPoolExecutor(max_workers=FFMPEG) as pool:
            res = list(pool.map(un, range(n)))
        check()
        tracks, rapport = [], []
        width = 2 if n < 100 else 3
        for k, (t, (m, after, wav)) in enumerate(zip(pl["tracks"], res)):
            tr, it = t["track"], t["item"]
            title = str(tr.get("title") or it.get("title") or f"Morceau {k + 1}")[:200]
            name = f"{k + 1:0{width}d}-{_slug(title)}"
            e = {"number": k + 1, "title": title, "duration": round(duree_wav(wav), 3)}
            if str(tr.get("credits") or "").strip():
                e["credits"] = str(tr["credits"]).strip()[:300]
            lrc = lrc_de(tr, it)
            if lrc:
                (dest / "paroles" / f"{name}.lrc").write_text(lrc + "\n", encoding="utf-8")
                e["lyricsFile"] = f"./paroles/{name}.lrc"
            else:
                txt = paroles_de(tr, it)
                if txt:
                    e["lyrics"] = txt[:20000]
            tracks.append({**e, "_wav": wav, "_name": name})
            rapport.append({"n": k + 1, "title": title, "item": it["id"], "avant_lufs": float(m["input_i"]),
                            "avant_crete": float(m["input_tp"]), "apres_lufs": float(after["output_i"]),
                            "apres_crete": float(after["output_tp"]), "mode": after.get("normalization_type"),
                            "cible_lufs": after["cible"], "crete_visee": after["crete"]})
        meta = {"artist": pl["artist"], "album": pl["title"], "date": pl["year"]}
        data: dict = {"v": VERSION, "id": pl["id"], "title": pl["title"], "artist": pl["artist"], "year": pl["year"],
                      "description": pl["description"], "download": pl["download"], "stats": bool(stats),
                      "transition": {"mode": pl["mode"], "crossfade_s": pl["fondu"]},
                      "loudness": {"target_lufs": CIBLE_LUFS, "true_peak_dbtp": CRETE_DBTP}, "built": _now()}
        if cv["cover"]:
            data["cover"] = f"./assets/cover-1200.jpg?v={_v(dest / 'assets' / 'cover-1200.jpg')}"
            data["artwork512"] = f"./assets/cover-512.jpg?v={_v(dest / 'assets' / 'cover-512.jpg')}"
        if cv["accent"]:
            data["accent"] = cv["accent"]
        progress(0.8, "les MP3")
        if pl["mode"] == "gapless":
            data["playbackMode"] = "separate"

            def enc(t):
                check()
                p = dest / "audio" / f"{t['_name']}.mp3"
                _mp3(t["_wav"], p, {**meta, "title": t["title"], "track": f"{t['number']}/{n}"}, cover512)
                return p

            with ThreadPoolExecutor(max_workers=FFMPEG) as pool:
                files = list(pool.map(enc, tracks))
            for t, p in zip(tracks, files):
                t["file"] = f"./audio/{p.name}?v={_v(p)}"
        else:
            data["playbackMode"] = "continuous"
            whole = tmp / "continu.wav"
            bornes = continu([t["_wav"] for t in tracks], pl["fondu"], whole)
            check()
            p = dest / "audio" / f"{_slug(pl['title'], 'playlist')}.mp3"
            _mp3(whole, p, {**meta, "title": pl["title"]}, cover512)
            data["continuousFile"] = f"./audio/{p.name}?v={_v(p)}"
            for t, (a, b) in zip(tracks, bornes):
                t["start"], t["end"] = round(a, 3), round(b, 3)
        data["tracks"] = [{k: v for k, v in t.items() if not k.startswith("_")} for t in tracks]
        progress(0.95, "le lecteur")
        (dest / "playlist.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        for f in CODE:
            shutil.copyfile(GABARIT / f, dest / f)
        page = (GABARIT / "index.html").read_text(encoding="utf-8")
        page = re.sub(r"<!--ecoute:tete-->.*?<!--/ecoute:tete-->", lambda _m: _tete(pl, adresse, cv["cover"], n), page,
                      count=1, flags=re.S)
        page = re.sub(r"\n<!-- Le lien d'écoute :.*?-->", "", page, count=1, flags=re.S)   # la note du gabarit
        (dest / "index.html").write_text(page, encoding="utf-8")
        j = jetons()["dark"]
        man = {"name": pl["title"] + (f" — {pl['artist']}" if pl["artist"] else ""), "short_name": pl["title"][:12],
               "description": pl["description"][:300] or pl["title"], "start_url": ".", "scope": ".", "display": "standalone",
               "background_color": j["bg"], "theme_color": j["bg"],
               "icons": [{"src": f"./assets/icon-{s}.png", "sizes": f"{s}x{s}", "type": "image/png", "purpose": "any"}
                         for s in (192, 512)]}
        (dest / "manifest.webmanifest").write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    size = sum(p.stat().st_size for p in dest.rglob("*") if p.is_file())
    return {"morceaux": rapport, "mode": pl["mode"], "fondu_s": pl["fondu"], "taille": size,
            "duree": round(sum(t["duration"] for t in data["tracks"]) - pl["fondu"] * max(0, n - 1), 3),
            "pochette": cv["cover"], "accent": cv["accent"]}


LISEZMOI = """{titre}

Un lecteur d'écoute à héberger tel quel sur un serveur web statique (GitHub Pages, Netlify, un hébergement
mutualisé, un NAS…) : déposer le contenu de ce dossier, puis ouvrir son adresse. Tout est en chemins relatifs :
le dossier marche à la racine d'un site comme dans un sous-dossier.

Il faut un serveur HTTP, pas un double-clic sur index.html (le navigateur refuse alors de lire playlist.json).
Pour essayer sur l'ordinateur : python3 -m http.server 8000 dans ce dossier, puis http://localhost:8000/.
La lecture écran verrouillé et l'installation sur l'écran d'accueil demandent une adresse en https.

Un morceau direct : ajouter #3 à l'adresse ouvre le 3e morceau.
"""


def _zip(dest: Path, titre: str) -> dict:
    """Le dossier zippé sous un dossier à son nom, dans les zips d'Asset (gardés deux
    heures, servis par GET /api/asset/zip/<jeton>/<nom>)."""
    from tools import asset
    asset._zip_clean()
    token = secrets.token_hex(8)
    d = asset._zip_dir() / token
    d.mkdir()
    slug = _slug(titre, "playlist")
    path = d / f"{slug}-ecoute.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
        for p in sorted(dest.rglob("*")):
            if p.is_file():
                rel = p.relative_to(dest).as_posix()
                # les MP3 et les images sont déjà compressés
                z.write(p, f"{slug}/{rel}", compress_type=zipfile.ZIP_STORED if p.suffix in (".mp3", ".jpg", ".png") else None)
        z.writestr(f"{slug}/LISEZMOI.txt", LISEZMOI.format(titre=titre))
    return {"url": f"api/asset/zip/{token}/{path.name}", "name": f"{titre} · écoute.zip", "size": path.stat().st_size}


# ── les droits ──
def juge_publier(space: str | None) -> None:
    """Fabriquer un .zip ou un lien, c'est publier (décision L2) : `espaces.can_publish`
    dans ce Workspace — un guest jamais (la raison de la matrice), un lecteur non
    plus. Le socle (personne), et Cal hors de tout Workspace connu : oui, comme
    `library.check_create`. HttpError 403 qui dit pourquoi."""
    u = auth.current()
    if u is None or (auth.is_admin(u) and espaces.space(space) is None):
        return
    ok, why = espaces.judge(u, space, "publish")
    if not ok:
        raise HttpError(403, f"publier un lien d'écoute : {why}")


def _playlist(pid: str) -> dict:
    it = library.get(pid)
    if not it or it.get("kind") != "playlist":
        raise HttpError(404, f"playlist introuvable : {pid}")
    return it


def _avant(req, pid: str) -> dict:
    """Le juge d'une route qui publie : le droit dans le Workspace de la page D'ABORD
    (un guest l'apprend même s'il ne voit pas la playlist), puis la playlist, puis le
    droit dans le Workspace de la playlist."""
    juge_publier(library.here())
    it = _playlist(pid)
    juge_publier(library.space_of(it))
    return it


def _du_travail(ctx) -> dict:
    it = library.get(str(ctx.params.get("playlist") or ""))
    if not it or it.get("kind") != "playlist":
        raise RuntimeError("cette playlist n'est plus dans ce Workspace (à la corbeille ?)")
    try:
        juge_publier(library.space_of(it))
    except HttpError as e:
        raise RuntimeError(e.message) from e
    return it


# ── C : le .zip ──
def run_zip(ctx) -> dict:
    it = _du_travail(ctx)
    dest = ctx.workdir / "paquet"
    try:
        rapport = fabrique(it, dest, adresse=ctx.params.get("adresse") or "", check=ctx.check, progress=ctx.progress)
    except ValueError as e:
        raise RuntimeError(str(e)) from e
    ctx.progress(0.98, "le zip")
    z = _zip(dest, str(it.get("title") or "playlist"))
    shutil.rmtree(dest, ignore_errors=True)
    return {"zip": z, "rapport": rapport, "playlist": it["id"],
            "note": f"{len(rapport['morceaux'])} morceaux · {z['size'] / 1e6:.1f} Mo"}


def r_zip(req, pid):
    it = _avant(req, pid)
    d = req.json() if req.method == "POST" else {}
    try:
        adresse = _adresse(d.get("adresse"))
        lis_playlist(it)   # une playlist vide ou un son manquant : 400 tout de suite, pas un travail en erreur
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    j = jobs.submit("ecoute.zip", {"playlist": it["id"], "adresse": adresse}, title=f"Écoute · {it.get('title') or pid}"[:90],
                    tool=TOOL, space=library.space_of(it))
    return jobs.public(j)


# ── A : Cloudflare (R2 + le Worker) ──
_r2mod = None


def r2_module():
    """porte/r2_recopie.py (la signature SigV4 en bibliothèque standard, l'envoi, la liste)."""
    global _r2mod
    if _r2mod is None:
        spec = importlib.util.spec_from_file_location("r2_recopie", config.REPO / "porte" / "r2_recopie.py")
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _r2mod = m
    return _r2mod


def r2_pret():
    """(le client R2, None) ou (None, pourquoi) : le jeton de Cal (geste 9 de
    docs/etudes/cloudflare.md), lisible par lui seul. Jamais d'appel réseau ici."""
    m = r2_module()
    f = Path(m.JETON)
    try:
        st = f.stat()
    except OSError:
        return None, ("le jeton R2 manque : c'est le geste 9 de docs/etudes/cloudflare.md (Cal crée un jeton « Object "
                      "Read & Write » limité au bucket, et l'écrit dans ~/.config/showrunner/r2.json sur DGX2)")
    if stat.S_IMODE(st.st_mode) & 0o077:
        return None, f"{f} est lisible par d'autres : chmod 600 {f}"
    try:
        cfg = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, f"{f} n'est pas un JSON lisible"
    manque = [k for k in ("account_id", "access_key_id", "secret_access_key", "bucket") if not cfg.get(k)]
    if manque:
        return None, f"{f} : il manque {', '.join(manque)}"
    return m.R2(cfg, R2_POINT), None


def _code(v) -> tuple[str, str] | None:
    """Le code d'un lien : (sel, empreinte) ou None (pas de code). Comparé sans espaces
    ni casse (le Worker fait de même) ; 4 à 64 signes."""
    c = re.sub(r"\s+", "", str(v or "")).upper()
    if not c:
        return None
    if not 4 <= len(c) <= 64:
        raise ValueError("code : de 4 à 64 signes")
    sel = secrets.token_hex(8)
    return sel, hashlib.sha256(f"{sel}:{c}".encode()).hexdigest()


def _fin(v) -> str | None:
    """La date de fin : « 2026-10-31 » (le lien marche jusqu'au bout de ce jour, heure de
    Paris) ou une date et heure ISO ; "" : pas de fin. Rend l'instant UTC ISO."""
    s = str(v or "").strip()
    if not s:
        return None
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            from zoneinfo import ZoneInfo
            d = datetime.fromisoformat(s).replace(tzinfo=ZoneInfo("Europe/Paris")) + timedelta(days=1)
        else:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if d.tzinfo is None:
                raise ValueError
    except (ValueError, KeyError) as e:
        raise ValueError("fin : une date AAAA-MM-JJ, ou une date et heure ISO avec son fuseau") from e
    if d <= datetime.now(timezone.utc):
        raise ValueError("fin : cette date est déjà passée")
    return d.astimezone(timezone.utc).isoformat(timespec="seconds")


def _url(jeton: str) -> str:
    return f"{auth.door_settings()['url']}/ecoute/{jeton}/"


def _ctype(p: Path) -> str:
    return TYPES.get(p.suffix.lower()) or mimetypes.guess_type(p.name)[0] or "application/octet-stream"


def run_publier(ctx) -> dict:
    it = _du_travail(ctx)
    r2, why = r2_pret()
    if r2 is None:
        raise RuntimeError(why)
    pid = it["id"]
    with _lock:
        lien = dict(_lis("liens.json").get(pid) or {})
    if not lien.get("jeton"):
        raise RuntimeError("le lien n'a pas été préparé (relance « Publier le lien »)")
    jeton = lien["jeton"]
    base = _url(jeton)
    dest = ctx.workdir / "paquet"
    try:
        rapport = fabrique(it, dest, adresse=base, stats=True, check=ctx.check, progress=ctx.progress)
    except ValueError as e:
        raise RuntimeError(str(e)) from e
    pfx = f"ecoute/{jeton}/"
    voulu = {pfx + p.relative_to(dest).as_posix(): p for p in sorted(dest.rglob("*")) if p.is_file()}
    avant = dict(lien.get("cles") or {})
    # l'ordre : les fichiers, puis index.html et playlist.json (une page neuve ne vise jamais un fichier pas encore
    # là), puis _lien.json (un premier envoi n'est servi qu'une fois complet), puis ce qui ne sert plus
    dernier = (pfx + "index.html", pfx + "playlist.json")
    ordre = [k for k in voulu if k not in dernier] + [k for k in dernier if k in voulu]
    cles, envoyes, octets = {}, 0, 0
    for k, key in enumerate(ordre):
        ctx.check()
        p = voulu[key]
        sha = _sha(p)
        if avant.get(key) != sha:
            r2.put(key, path=p, ctype=_ctype(p), sha=sha)
            envoyes += 1
            octets += p.stat().st_size
        cles[key] = sha
        ctx.progress(0.96 + 0.03 * (k + 1) / len(ordre), f"envoi · {k + 1}/{len(ordre)}")
    fiche = {"v": 1, "title": str(it.get("title") or ""), "artist": str((it.get("playlist") or {}).get("artist") or ""),
             "code": lien.get("code_hash"), "fin": lien.get("fin"), "ecoutes": True, "accent": rapport.get("accent"),
             "maj": _now()}
    body = json.dumps(fiche, ensure_ascii=False).encode()
    r2.put(pfx + "_lien.json", data=body, ctype="application/json", sha=hashlib.sha256(body).hexdigest())
    retires = 0
    for key in avant:
        if key not in cles:
            r2.delete(key)
            retires += 1
    shutil.rmtree(dest, ignore_errors=True)
    with _lock:
        d = _lis("liens.json")
        cur = d.get(pid) or {}
        if cur.get("jeton") == jeton:   # retiré entre-temps : on ne le fait pas revivre
            cur.update(cles=cles, maj=_now(), publie=True, url=base)
            d[pid] = cur
            _ecris("liens.json", d)
    return {"lien": {"url": base, "code": bool(lien.get("code_hash")), "fin": lien.get("fin")}, "rapport": rapport,
            "envoyes": envoyes, "retires": retires, "playlist": pid,
            "note": f"{envoyes} fichiers envoyés ({octets / 1e6:.1f} Mo), {retires} retirés"}


def r_publier(req, pid):
    it = _avant(req, pid)
    d = req.json()
    r2, why = r2_pret()
    if r2 is None:
        raise HttpError(409, f"publier le lien : {why}")
    try:
        lis_playlist(it)
        code = _code(d["code"]) if "code" in d else "garde"
        fin = _fin(d["fin"]) if "fin" in d else "garde"
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    with _lock:
        liens = _lis("liens.json")
        lien = liens.get(it["id"]) or {"jeton": secrets.token_hex(16), "cree": _now(), "par": auth.current_id()}
        if code != "garde":
            lien["code_hash"] = {"sel": code[0], "sha256": code[1]} if code else None
        if fin != "garde":
            lien["fin"] = fin
        lien["url"] = _url(lien["jeton"])
        liens[it["id"]] = lien
        _ecris("liens.json", liens)
    j = jobs.submit("ecoute.publier", {"playlist": it["id"]}, title=f"Lien d'écoute · {it.get('title') or pid}"[:90],
                    tool=TOOL, space=library.space_of(it))
    return {**jobs.public(j), "lien": _public(lien)}


def r_retirer(req, pid):
    it = _avant(req, pid)
    with _lock:
        lien = _lis("liens.json").get(it["id"])
    if not lien:
        raise HttpError(404, "cette playlist n'a pas de lien publié")
    r2, why = r2_pret()
    if r2 is None:
        raise HttpError(409, f"retirer le lien : {why}")
    pfx = f"ecoute/{lien['jeton']}/"
    n = 0
    try:
        cles = r2.liste(pfx)
        # _lien.json d'abord : le Worker cesse aussitôt de servir le lien, même si un effacement échoue en route
        for key in sorted(cles, key=lambda k: k != pfx + "_lien.json"):
            r2.delete(key)
            n += 1
    except OSError as e:
        raise HttpError(502, f"R2 : {e}") from e
    with _lock:
        d = _lis("liens.json")
        d.pop(it["id"], None)
        _ecris("liens.json", d)
    _compte.pop(lien["jeton"], None)
    return {"ok": True, "retires": n}


def _public(lien: dict | None) -> dict | None:
    if not lien:
        return None
    return {"url": lien.get("url") or _url(lien["jeton"]), "cree": lien.get("cree"), "maj": lien.get("maj"),
            "publie": bool(lien.get("publie")), "code": bool(lien.get("code_hash")), "fin": lien.get("fin")}


def ecoutes(r2, jeton: str) -> dict:
    """Les écoutes rangées par le Worker sous ecoute/<jeton>/_ecoutes/<jour>/<ms>-<hasard>-<n> :
    le total, par morceau, par jour. Gardées une minute."""
    hit = _compte.get(jeton)
    if hit and time.time() - hit[0] < COMPTE_S:
        return hit[1]
    par_n: dict[str, int] = {}
    par_jour: dict[str, int] = {}
    total = 0
    for key in r2.liste(f"ecoute/{jeton}/_ecoutes/"):
        m = re.search(r"/_ecoutes/(\d{4}-\d{2}-\d{2})/\d+-[0-9a-z]+-(\d{1,3})$", key)
        if not m:
            continue
        total += 1
        par_jour[m.group(1)] = par_jour.get(m.group(1), 0) + 1
        par_n[m.group(2)] = par_n.get(m.group(2), 0) + 1
    out = {"total": total, "par_morceau": par_n, "par_jour": par_jour}
    _compte[jeton] = (time.time(), out)
    return out


def r_etat(req, pid):
    it = _playlist(pid)
    try:
        juge_publier(library.space_of(it))
        peut, pourquoi = True, None
    except HttpError as e:
        peut, pourquoi = False, e.message
    r2, why = r2_pret()
    with _lock:
        lien = _lis("liens.json").get(it["id"])
    out = {"playlist": it["id"], "peut_publier": peut, "pourquoi": pourquoi, "r2": {"pret": r2 is not None, "pourquoi": why},
           "lien": _public(lien), "ecoutes": None}
    if lien and lien.get("publie") and r2 is not None and req.q("ecoutes") == "1":
        try:
            out["ecoutes"] = ecoutes(r2, lien["jeton"])
        except OSError as e:
            out["ecoutes_pourquoi"] = f"R2 : {e}"
    return out


def register(app) -> None:
    jobs.register("ecoute.zip", run_zip, lane="cpu", title="Lien d'écoute · zip", cost="cpu")
    jobs.register("ecoute.publier", run_publier, lane="cpu", title="Lien d'écoute · publier", cost="cpu")
    app.route("GET", "/api/ecoute/{pid}", r_etat)
    app.route("POST", "/api/ecoute/{pid}/zip", r_zip)
    app.route("POST", "/api/ecoute/{pid}/publier", r_publier)
    app.route("POST", "/api/ecoute/{pid}/retirer", r_retirer)


# ── les essais ──
def playlist_essai(title: str, tracks: list, *, artist: str = "", year: str = "", description: str = "",
                   cover: str | None = None, transition: dict | None = None, download: bool = False) -> dict:
    """Une playlist pour les essais (ce selftest, le premier essai sur l'album AGOSTA),
    tant que la sorte `playlist` n'a pas son outil (wip2/playlists) : un objet de la
    bibliothèque tel que le contrat le décrit (`playlist: {artist, year, description,
    cover, tracks, transition, download}`), rien de plus."""
    library.get("")
    org = library._owned({"tool": TOOL})
    space = library.new_space(org)
    iid = library.new_id("playlist")
    library.folder_of(iid).mkdir(parents=True, exist_ok=True)
    now = library.now()
    it = {"id": iid, "kind": "playlist", "title": title, "created": now, "updated": now, "origin": org, "space": space,
          "prompt": "", "params": {}, "parents": [t["item"] for t in tracks if isinstance(t, dict)], "tags": [],
          "folder": "", "fav": False,
          "playlist": {"artist": artist, "year": year, "description": description, "cover": cover, "tracks": tracks,
                       "transition": transition or {"mode": "gapless", "crossfade_s": 0}, "download": download}}
    with library._lock:
        library._items[iid] = it
        library._save(it)
    return it


def _lufs(p: Path) -> tuple[float, float]:
    """(volume intégré, crête vraie) d'un fichier, par le filtre ebur128 de ffmpeg."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(p), "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=600)
    tail = r.stderr[r.stderr.rfind("Summary:"):]
    i = re.search(r"I:\s+(-?[\d.]+) LUFS", tail)
    tp = re.search(r"Peak:\s+(-?[\d.]+) dBFS", tail)
    return (float(i.group(1)) if i else 0.0), (float(tp.group(1)) if tp else 0.0)


def _probe(p: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(p)],
                         capture_output=True, text=True, timeout=60)
    return json.loads(out.stdout or "{}")


class _FauxS3:
    """Un faux S3 local (PUT, GET, DELETE, ListObjectsV2) pour essayer la destination
    Cloudflare sans réseau : il garde les objets en mémoire et vérifie qu'une requête
    est signée (Authorization SigV4) et que le corps a l'empreinte annoncée."""

    def __init__(self) -> None:
        import http.server
        import socketserver
        from urllib.parse import unquote
        self.objets: dict[str, tuple[bytes, str]] = {}
        faux = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _ok_sig(self) -> bool:
                return self.headers.get("authorization", "").startswith("AWS4-HMAC-SHA256 Credential=")

            def do_PUT(self):
                n = int(self.headers.get("content-length") or 0)
                body = self.rfile.read(n)
                if not self._ok_sig() or hashlib.sha256(body).hexdigest() != self.headers.get("x-amz-content-sha256"):
                    self.send_response(403); self.end_headers(); return   # noqa: E702
                faux.objets[unquote(self.path).split("/", 2)[2]] = (body, self.headers.get("content-type", ""))
                self.send_response(200); self.send_header("content-length", "0"); self.end_headers()   # noqa: E702

            def do_DELETE(self):
                faux.objets.pop(unquote(self.path).split("/", 2)[2], None)
                self.send_response(204); self.end_headers()   # noqa: E702

            def do_GET(self):
                from urllib.parse import parse_qs, urlsplit
                u = urlsplit(self.path)
                q = parse_qs(u.query)
                if "list-type" in q:
                    pfx = q.get("prefix", [""])[0]
                    keys = sorted(k for k in faux.objets if k.startswith(pfx))
                    start = int(q.get("continuation-token", ["0"])[0])
                    page = keys[start:start + 2]   # des pages de 2 : la suite (continuation) est essayée aussi
                    more = start + 2 < len(keys)
                    xml = ('<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                           + "".join(f"<Contents><Key>{html.escape(k)}</Key></Contents>" for k in page)
                           + f"<IsTruncated>{'true' if more else 'false'}</IsTruncated>"
                           + (f"<NextContinuationToken>{start + 2}</NextContinuationToken>" if more else "")
                           + "</ListBucketResult>").encode()
                    self.send_response(200); self.send_header("content-length", str(len(xml))); self.end_headers()   # noqa: E702
                    self.wfile.write(xml)
                    return
                got = faux.objets.get(unquote(u.path).split("/", 2)[2])
                self.send_response(200 if got else 404)
                self.send_header("content-length", str(len(got[0]) if got else 0))
                self.end_headers()
                if got:
                    self.wfile.write(got[0])

        self.srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
        self.srv.daemon_threads = True
        self.point = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def stop(self) -> None:
        self.srv.shutdown()
        self.srv.server_close()


def selftest(call, ok) -> None:
    import io
    import tempfile
    global R2_POINT

    def wait(j, limit=300):
        t0 = time.time()
        while time.time() - t0 < limit:
            st, j = call("GET", f"/api/jobs/{j['id']}")
            if j.get("state") in ("done", "error", "cancelled"):
                return j
            time.sleep(0.3)
        return j

    # 1. les jetons recopiés dans ecoute.css (la seule exception à la règle du thème) : les mêmes que commun/tokens.css
    copie = _blocs((GABARIT / "ecoute.css").read_text(encoding="utf-8"))
    src = jetons()
    ecarts = [f"{th} --{k} : {v} ≠ {src[th].get(k)}" for th in ("dark", "light") for k, v in copie[th].items() if src[th].get(k) != v]
    ok(len(copie["dark"]) >= 10 and set(copie["dark"]) == set(copie["light"]) and not ecarts,
       f"écoute : les jetons recopiés dans ecoute.css sont ceux de commun/tokens.css, dans les deux thèmes ({ecarts[:3]})")
    lecteur = "\n".join((GABARIT / f).read_text(encoding="utf-8") for f in ("index.html", *CODE))
    ok("showrunner" not in lecteur.lower(), "écoute : le lecteur ne nomme pas l'outil (décision L3)")
    css = re.sub(r"/\*.*?\*/", "", (GABARIT / "ecoute.css").read_text(encoding="utf-8"), flags=re.S)
    dur = [ln.strip() for ln in css.splitlines() if re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(", ln) and not ln.strip().startswith("--")]
    ok(not dur and "border:" not in css.replace("border: 0", ""), f"écoute : aucune couleur en dur ni bordure hors des jetons ({dur[:2]})")

    # 2. l'accent : la teinte de la pochette, au contraste AA sur tous les fonds des deux thèmes
    from PIL import Image
    im = Image.new("RGB", (300, 200), (20, 30, 160))
    im.paste((240, 240, 235), (0, 0, 300, 60))
    a = accent(im)
    j = jetons()
    ok(a is not None and all(min(contraste(_rgb(a[th]), _rgb(j[th][k])) for k in ("bg", "panel", "panel2", "panel3")) >= 4.5
                             and contraste(_rgb(a[f"{th}_ink"]), _rgb(a[th])) >= 3 for th in ("dark", "light")),
       f"écoute : l'accent d'une pochette bleue, lisible dans les deux thèmes ({a})")
    h = colorsys.rgb_to_hls(*(c / 255 for c in _rgb(a["dark"] if a else "#000000")))[0]
    ok(0.58 < h < 0.72, f"écoute : l'accent garde la teinte de la pochette (bleu, teinte {h:.2f})")
    ok(accent(Image.new("RGB", (64, 64), (128, 128, 128))) is None, "écoute : une pochette sans couleur garde l'accent du thème")

    # 3. des sons d'essai : trois tons à des volumes très différents, une pochette
    tmp = Path(tempfile.mkdtemp(prefix="sr-ecoute-"))
    sons = []
    for k, (freq, vol, d) in enumerate(((330, 0.05, 2.0), (440, 0.6, 3.0), (550, 0.2, 2.5))):
        p = tmp / f"ton{k}.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=f={freq}:d={d}:sample_rate=48000",
                        "-af", f"volume={vol}", "-ac", "1", str(p)], capture_output=True, timeout=60)
        st, it = call("PUT", f"/api/library/upload?name=ton{k}.wav&title=Ton%20{k}", raw=p.read_bytes())
        sons.append(it.get("id") if isinstance(it, dict) else None)
    ok(all(sons), f"écoute : trois sons dans la bibliothèque ({sons})")
    buf = io.BytesIO()
    im.save(buf, "PNG")
    st, cov = call("PUT", "/api/library/upload?name=pochette.png&title=Pochette", raw=buf.getvalue())
    if not all(sons) or st != 200:
        return
    lrc = "[00:00.50] Première ligne <b>\n[00:01.50] Deuxième ligne"
    it2 = library._items[sons[1]]
    it2["lrc"] = lrc   # le champ que pose l'outil des paroles calées
    library._save(it2)
    tracks = [{"item": sons[0], "title": "Le « premier » & <seul>", "credits": "Cal"},
              {"item": sons[1]}, {"item": sons[2], "lyrics": "[verse]\nune ligne simple\n[chorus]\nune autre"}]
    pl = playlist_essai("Essai d'écoute", tracks, artist="L'Artiste", year="2026", description="Trois tons.",
                        cover=cov["id"], download=True)
    pid = pl["id"]
    st, got = call("GET", f"/api/library/{pid}")
    ok(st == 200 and got.get("kind") == "playlist" and pid.startswith("pla-") and got["playlist"]["tracks"][1]["item"] == sons[1],
       f"écoute : la sorte playlist, lue par GET /api/library/<id> ({st} {pid})")

    # 4. le .zip (gapless, téléchargement permis)
    st, jb = call("POST", f"/api/ecoute/{pid}/zip", {"adresse": "https://exemple.test/ecoute/essai"})
    ok(st == 200 and jb.get("kind") == "ecoute.zip" and jb.get("cost") == "cpu", f"écoute : le .zip est un travail de la file ({st} {jb})")
    jb = wait(jb)
    z = (jb.get("result") or {}).get("zip") or {}
    ok(jb.get("state") == "done" and z.get("url", "").startswith("api/asset/zip/"), f"écoute : le travail rend un .zip ({jb.get('state')} {jb.get('message')})")
    st, raw = call("GET", "/" + z.get("url", "x"))
    ok(st == 200 and isinstance(raw, bytes) and raw[:2] == b"PK", f"écoute : le .zip se télécharge ({st})")
    out = tmp / "zip"
    if st == 200 and isinstance(raw, bytes):
        zipfile.ZipFile(io.BytesIO(raw)).extractall(out)
    root = out / "essai-d-ecoute"
    names = sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()) if root.is_dir() else []
    want = ["LISEZMOI.txt", "app.js", "assets/cover-1200.jpg", "assets/cover-512.jpg", "assets/icon-192.png",
            "assets/icon-512.png", "audio/01-le-premier-seul.mp3", "audio/02-ton-1.mp3", "audio/03-ton-2.mp3", "ecoute.css",
            "index.html", "manifest.webmanifest", "paroles/02-ton-1.lrc", "player.js", "playlist.json", "service-worker.js"]
    ok(names == want, f"écoute : ce que contient le paquet ({names})")
    if names != want:
        return
    data = json.loads((root / "playlist.json").read_text(encoding="utf-8"))
    t0, t1, t2 = data["tracks"]
    ok(data["playbackMode"] == "separate" and data["download"] is True and data["stats"] is False and data["accent"] == a
       and t0["title"] == "Le « premier » & <seul>" and t0["credits"] == "Cal" and t0["file"].startswith("./audio/01-le-premier-seul.mp3?v=")
       and t1["lyricsFile"] == "./paroles/02-ton-1.lrc" and t2["lyrics"] == "une ligne simple\nune autre"
       and abs(t1["duration"] - 3.0) < 0.05, f"écoute : playlist.json ({json.dumps(data)[:300]})")
    ok((root / "paroles/02-ton-1.lrc").read_text(encoding="utf-8").startswith("[00:00.50] Première ligne"), "écoute : le LRC de l'objet audio")
    page = (root / "index.html").read_text(encoding="utf-8")
    ok("<title>Essai d&#x27;écoute — L&#x27;Artiste</title>" in page
       and '<meta property="og:image" content="https://exemple.test/ecoute/essai/assets/cover-1200.jpg">' in page
       and '<meta property="og:url" content="https://exemple.test/ecoute/essai/">' in page
       and "ecoute:tete" not in page and "Le lien d'écoute :" not in page, "écoute : index.html porte le titre et l'aperçu du lien (Open Graph), échappés")
    man = json.loads((root / "manifest.webmanifest").read_text(encoding="utf-8"))
    ok(man["name"] == "Essai d'écoute — L'Artiste" and man["background_color"] == j["dark"]["bg"], f"écoute : le manifeste ({man})")
    info = _probe(root / "audio/02-ton-1.mp3")
    au = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), {})
    ok(au.get("codec_name") == "mp3" and au.get("sample_rate") == "44100" and au.get("channels") == 2
       and abs(int(au.get("bit_rate") or 0) - 256000) < 1000, f"écoute : MP3 256 kbit/s, 44,1 kHz, stéréo ({au.get('codec_name')} {au.get('sample_rate')} {au.get('bit_rate')})")
    tags = (info.get("format") or {}).get("tags") or {}
    ok(tags.get("artist") == "L'Artiste" and tags.get("album") == "Essai d'écoute" and tags.get("track") == "2/3"
       and any(s.get("disposition", {}).get("attached_pic") for s in info.get("streams", [])),
       f"écoute : les balises ID3 et la pochette dans le MP3 ({tags})")
    niveaux = [_lufs(root / f"audio/{n}.mp3") for n in ("01-le-premier-seul", "02-ton-1", "03-ton-2")]
    avant = [_lufs(library.path_of(library._items[s])) for s in sons]
    ok(all(abs(i - CIBLE_LUFS) <= 1.0 and tp <= CRETE_DBTP + 0.6 for i, tp in niveaux) and max(i for i, _ in avant) - min(i for i, _ in avant) > 15,
       f"écoute : trois sons très inégaux ({[round(i, 1) for i, _ in avant]} LUFS) ramenés à −14 LUFS ({[(round(i, 1), round(tp, 1)) for i, tp in niveaux]})")
    rap = (jb.get("result") or {}).get("rapport") or {}
    ok(len(rap.get("morceaux", [])) == 3 and all("avant_lufs" in m and "apres_lufs" in m and m.get("mode") for m in rap["morceaux"]),
       f"écoute : le rapport dit le volume avant et après ({rap.get('morceaux', [])[:1]})")
    ok(_sha(library.path_of(library._items[sons[1]])) == _sha(tmp / "ton1.wav"), "écoute : l'original n'est pas touché")
    ok(len(_lis("mesures.json")) >= 3, "écoute : la première passe est gardée (republier ne remesure rien)")
    # la règle du linéaire, sur les mesures de l'album AGOSTA (05/10)
    cas = {"to-late": ({"input_i": "-13.33", "input_tp": "-0.62"}, (-14.0, -1.0)),
           "lonelyness": ({"input_i": "-13.51", "input_tp": "0.43"}, (-14.0, -0.04)),
           "the-map": ({"input_i": "-14.13", "input_tp": "-1.11"}, (-14.03, -1.0)),
           "20-yo": ({"input_i": "-15.23", "input_tp": "0.03"}, (-14.0, -1.0)),
           "écrêté": ({"input_i": "-13.0", "input_tp": "1.5"}, (-14.0, 0.0))}
    got = {k: reglage(v[0]) for k, v in cas.items()}
    ok(all(abs(got[k][0] - v[1][0]) < 0.006 and abs(got[k][1] - v[1][1]) < 0.006 for k, v in cas.items()),
       f"écoute : le niveau et la crête visés gardent loudnorm linéaire quand un gain suffit ({got})")

    # 5. les enchaînements : un fondu de 1 s fabriqué dans un fichier continu ; puis bout à bout
    pli = library._items[pid]
    pli["playlist"]["transition"] = {"mode": "crossfade", "crossfade_s": 1}
    pli["playlist"]["download"] = False
    pli["playlist"]["cover"] = None
    library._save(pli)
    jb = wait(call("POST", f"/api/ecoute/{pid}/zip", {})[1])
    st, raw = call("GET", "/" + ((jb.get("result") or {}).get("zip") or {}).get("url", "x"))
    zz = zipfile.ZipFile(io.BytesIO(raw)) if st == 200 else None
    data = json.loads(zz.read("essai-d-ecoute/playlist.json")) if zz else {}
    b = [(t.get("start"), t.get("end")) for t in data.get("tracks", [])]
    ok(data.get("playbackMode") == "continuous" and data.get("continuousFile", "").startswith("./audio/essai-d-ecoute.mp3?v=")
       and b and abs(b[1][0] - 1.0) < 0.01 and abs(b[2][0] - 3.0) < 0.01 and abs(b[2][1] - 5.5) < 0.01 and data.get("download") is False,
       f"écoute : un fondu enchaîné de 1 s, fabriqué dans un seul fichier ; les bornes à l'échantillon ({b})")
    if zz:
        p = tmp / "continu.mp3"
        p.write_bytes(zz.read("essai-d-ecoute/audio/essai-d-ecoute.mp3"))
        dur = float((_probe(p).get("format") or {}).get("duration") or 0)
        ok(abs(dur - 5.5) < 0.1, f"écoute : le fichier continu dure la somme moins les fondus (5,5 s : {dur:.2f})")
        names = zz.namelist()
        ok(not any("cover-" in n for n in names) and "essai-d-ecoute/assets/icon-512.png" in names and "accent" not in data,
           "écoute : sans pochette, des icônes aux couleurs du thème et l'accent du thème")
        page = zz.read("essai-d-ecoute/index.html").decode()
        ok("og:image" not in page and "og:url" not in page, "écoute : sans adresse, aucun aperçu en adresse relative")
    pli["playlist"]["transition"] = {"mode": "single"}
    library._save(pli)
    jb = wait(call("POST", f"/api/ecoute/{pid}/zip", {})[1])
    st, raw = call("GET", "/" + ((jb.get("result") or {}).get("zip") or {}).get("url", "x"))
    data = json.loads(zipfile.ZipFile(io.BytesIO(raw)).read("essai-d-ecoute/playlist.json")) if st == 200 else {}
    b = [(t.get("start"), t.get("end")) for t in data.get("tracks", [])]
    ok(data.get("transition", {}).get("mode") == "single" and b and abs(b[1][0] - 2.0) < 0.01 and abs(b[2][1] - 7.5) < 0.01,
       f"écoute : « un seul fichier continu », bout à bout ({b})")

    # 6. les refus : une adresse qui n'en est pas une, une playlist vide, un objet qui n'est pas une playlist
    st, d = call("POST", f"/api/ecoute/{pid}/zip", {"adresse": "javascript:alert(1)"})
    ok(st == 400 and "adresse" in d.get("error", ""), f"écoute : une adresse qui n'est pas http(s) ({st})")
    vide = playlist_essai("Vide", [])
    st, d = call("POST", f"/api/ecoute/{vide['id']}/zip", {})
    ok(st == 400 and "vide" in d.get("error", ""), f"écoute : une playlist vide, refusée avant la file ({st} {d})")
    st, d = call("POST", f"/api/ecoute/{sons[0]}/zip", {})
    ok(st == 404, f"écoute : un son n'est pas une playlist ({st})")

    # 7. publier = espaces.can_publish : un lecteur du Workspace ne publie pas (le guest : la garde du calcul, check.py)
    from core import espaces as E
    u = {"id": "lecteur-ecoute", "name": "Lecteur", "role": "user", "state": "active"}
    real = E.judge
    E.judge = lambda uu, s, action: (False, "ton rôle dans ce Workspace (lecteur) ne le permet pas") if uu is u and action == "publish" else real(uu, s, action)
    auth.set_current(u)
    try:
        juge_publier(library.space_of(pli))
        ok(False, "écoute : un lecteur ne publie pas")
    except HttpError as e:
        ok(e.status == 403 and "publier" in e.message and "lecteur" in e.message, f"écoute : un lecteur ne publie pas ({e.message})")
    finally:
        auth.set_current(None)
        E.judge = real

    # 8. Cloudflare : sans le jeton R2, publier le dit (409), sans rien mettre en file
    m = r2_module()
    old_jeton, old_point = m.JETON, R2_POINT
    m.JETON = tmp / "pas-de-jeton.json"
    st, d = call("POST", f"/api/ecoute/{pid}/publier", {})
    ok(st == 409 and "geste 9" in d.get("error", ""), f"écoute : sans jeton R2, publier le dit ({st} {d.get('error', '')[:80]})")
    st, e0 = call("GET", f"/api/ecoute/{pid}")
    ok(st == 200 and e0.get("peut_publier") is True and e0["r2"]["pret"] is False and e0["lien"] is None, f"écoute : l'état ({e0})")

    # … avec un faux S3 local : le paquet sous ecoute/<jeton>/, republier garde le lien, retirer efface le préfixe
    faux = _FauxS3()
    try:
        jf = tmp / "r2.json"
        jf.write_text(json.dumps({"account_id": "essai", "access_key_id": "AKIAESSAI", "secret_access_key": "secret",
                                  "bucket": "showrunner-bibliotheque"}))
        os.chmod(jf, 0o644)
        m.JETON = jf
        st, d = call("POST", f"/api/ecoute/{pid}/publier", {})
        ok(st == 409 and "chmod 600" in d.get("error", ""), f"écoute : un jeton lisible par d'autres est refusé ({st})")
        os.chmod(jf, 0o600)
        R2_POINT = faux.point
        pli["playlist"]["transition"] = {"mode": "gapless"}
        pli["playlist"]["cover"] = cov["id"]
        library._save(pli)
        st, d = call("POST", f"/api/ecoute/{pid}/publier", {"code": " 12 34 ", "fin": "2099-12-31"})
        ok(st == 200 and d.get("kind") == "ecoute.publier" and d["lien"]["code"] is True and d["lien"]["fin"] == "2099-12-31T23:00:00+00:00",
           f"écoute : publier, avec un code et une date de fin (heure de Paris) ({st} {d.get('lien') or d})")
        jb = wait(d)
        lien = (jb.get("result") or {}).get("lien") or {}
        jeton = re.search(r"/ecoute/([0-9a-f]{32})/$", lien.get("url", ""))
        ok(jb.get("state") == "done" and jeton and lien["url"].startswith(auth.door_settings()["url"]),
           f"écoute : le lien, à un jeton de 128 bits ({jb.get('state')} {jb.get('message')} {lien})")
        jt = jeton.group(1) if jeton else "x"
        keys = sorted(faux.objets)
        ok(f"ecoute/{jt}/index.html" in keys and f"ecoute/{jt}/_lien.json" in keys and all(k.startswith(f"ecoute/{jt}/") for k in keys)
           and faux.objets[f"ecoute/{jt}/index.html"][1].startswith("text/html") and faux.objets[f"ecoute/{jt}/audio/02-ton-1.mp3"][1] == "audio/mpeg",
           f"écoute : tout est sous ecoute/<jeton>/, avec son type ({keys[:4]}…)")
        fiche = json.loads(faux.objets.get(f"ecoute/{jt}/_lien.json", (b"{}", ""))[0])
        ok(fiche.get("code", {}).get("sha256") == hashlib.sha256(f"{fiche['code']['sel']}:1234".encode()).hexdigest()
           and fiche.get("fin") == "2099-12-31T23:00:00+00:00" and fiche.get("ecoutes") is True and "1234" not in json.dumps(fiche),
           f"écoute : _lien.json porte l'empreinte du code (jamais le code), la fin, le compteur ({fiche})")
        pj = json.loads(faux.objets[f"ecoute/{jt}/playlist.json"][0])
        ix = faux.objets[f"ecoute/{jt}/index.html"][0].decode()
        ok(pj.get("stats") is True and f"/ecoute/{jt}/assets/cover-1200.jpg" in ix, "écoute : le lien compte les écoutes ; l'aperçu en adresse absolue")
        st, e1 = call("GET", f"/api/ecoute/{pid}")
        ok(e1.get("lien", {}).get("url") == lien.get("url") and "code_hash" not in json.dumps(e1) and e1["lien"]["publie"],
           f"écoute : l'état dit le lien, jamais l'empreinte du code ({e1.get('lien')})")
        # deux écoutes rangées par le Worker
        for k, n in enumerate((2, 2, 3)):
            faux.objets[f"ecoute/{jt}/_ecoutes/2026-10-05/17000000000{k}-abc{k}-{n}"] = (b"", "")
        st, e2 = call("GET", f"/api/ecoute/{pid}?ecoutes=1")
        ok((e2.get("ecoutes") or {}).get("total") == 3 and e2["ecoutes"]["par_morceau"] == {"2": 2, "3": 1},
           f"écoute : les écoutes rangées par le Worker, comptées (liste paginée) ({e2.get('ecoutes')})")
        # republier : le même lien ; seul ce qui a changé repart ; ce qui ne sert plus est retiré
        pli["playlist"]["tracks"] = pli["playlist"]["tracks"][:2]
        library._save(pli)
        jb = wait(call("POST", f"/api/ecoute/{pid}/publier", {"code": ""})[1])
        r = jb.get("result") or {}
        fiche = json.loads(faux.objets.get(f"ecoute/{jt}/_lien.json", (b"{}", ""))[0])
        ok(jb.get("state") == "done" and r.get("lien", {}).get("url") == lien.get("url") and r.get("retires") == 1
           and f"ecoute/{jt}/audio/03-ton-2.mp3" not in faux.objets and fiche.get("code") is None and r.get("envoyes", 99) < 8,
           f"écoute : republier met à jour le même lien, sans le code ({r.get('note')} {r.get('lien')})")
        ok(any(k.startswith(f"ecoute/{jt}/_ecoutes/") for k in faux.objets), "écoute : republier garde les écoutes")
        st, d = call("POST", f"/api/ecoute/{pid}/publier", {"fin": "2001-01-01"})
        ok(st == 400 and "passée" in d.get("error", ""), f"écoute : une date de fin passée ({st})")
        st, d = call("POST", f"/api/ecoute/{pid}/publier", {"code": "12"})
        ok(st == 400 and "code" in d.get("error", ""), f"écoute : un code trop court ({st})")
        st, d = call("POST", f"/api/ecoute/{pid}/retirer", {})
        ok(st == 200 and d.get("retires", 0) > 10 and not any(k.startswith(f"ecoute/{jt}/") for k in faux.objets),
           f"écoute : retirer le lien efface tout le préfixe, écoutes comprises ({st} {d})")
        st, e3 = call("GET", f"/api/ecoute/{pid}")
        ok(e3.get("lien") is None, "écoute : après retrait, plus de lien")
        st, d = call("POST", f"/api/ecoute/{pid}/retirer", {})
        ok(st == 404, f"écoute : retirer un lien qui n'existe pas ({st})")
    finally:
        faux.stop()
        m.JETON, R2_POINT = old_jeton, old_point
        shutil.rmtree(tmp, ignore_errors=True)
