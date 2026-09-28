"""Montage : des projets de montage (une timeline multipiste) et leur
export en MP4 (H.264 + AAC) par ffmpeg.

Un projet est un fichier JSON sous `<data_dir>/montage/<id>.json` ; la
page l'enregistre seule à chaque geste, il n'y a rien à « enregistrer ».
Les positions sur la timeline (`start`, `dur`, fondus) sont en **images
entières** à la cadence du projet : une coupe tombe toujours sur une
image, en lecture comme à l'export. Le point d'entrée dans la source
(`in`) est en secondes, la source ayant sa propre cadence.

L'export (`montage.export`, voie `cpu`) suit `plan()` — la page lit le
même modèle (`montage/model.js`, `windows`). L'image se rend par passes
de `CHUNK_S` secondes (une commande ffmpeg chacune, qui n'ouvre que les
plans de sa tranche), puis une dernière passe met le son et recolle les
tranches sans les ré-encoder (démuxeur `concat`, `-c:v copy` ; doc
ffmpeg-formats, concat). Pourquoi : un seul graphe ouvre un décodeur par
plan dès le départ — mesuré le 28/09 sur 91 plans en 1080p, 14 Go de
mémoire pour ffmpeg ; par passes, la mémoire ne dépend plus de la
longueur du film. Dans chaque passe :

  - un fond noir à la taille et à la cadence du projet (`color`) ;
  - chaque plan vidéo ou image : une entrée lue à partir de son point
    d'entrée (`-ss` avant `-i` : recherche exacte en transcodage, doc
    ffmpeg « Main options », -ss), remise à 0 (`setpts`), à la cadence
    du projet (`fps`), cadrée sans déformer (`scale` +
    `force_original_aspect_ratio=decrease`, `pad` transparent), étalonnée
    (`exposure`, `eq`, `colortemperature`), prolongée en figeant sa
    première ou dernière image quand un fondu enchaîné demande plus que
    la source n'a (`tpad` clone), coupée au nombre d'images exact
    (`trim=end_frame`), fondue en transparence (`fade … alpha=1`, en
    temps : un fondu à cheval sur deux passes reste continu), puis
    décalée à sa place (`setpts=PTS+…`) et posée sur ce qui est dessous
    (`overlay=eof_action=pass` : quand le plan finit, le dessous repasse —
    doc ffmpeg-filters, overlay / framesync) ; piste V1 d'abord, V3 en
    dernier, donc au-dessus ;
  - chaque son : le même découpage (`atrim`), `volume`, `afade`, décalé
    (`adelay` en échantillons, `all=1`), puis `amix` sans renormaliser
    (`normalize=0` : un plan à 100 % reste à 100 %).

Essais qui fondent ce graphe (DGX2, ffmpeg 6.1.1, 28/09) : un plan posé à
2 s sur un fond de 6 s apparaît à l'image 50 et disparaît à l'image 125,
ni avant ni après ; un fondu `fade=alpha=1` de 25 images sur un plan posé
au-dessus d'un autre donne un mélange linéaire (image 6 : 24 % du second).
Voir `docs/etudes/montage.md`.
"""

from __future__ import annotations

import json
import math
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from core import config, jobs, library
from core.comfy import Cancelled
from core.http import FileResponse, HttpError

# ── les réglages possibles ───────────────────────────────────
FORMATS = {
    "1080p": {"w": 1920, "h": 1080, "label": "1080p · 16:9"},
    "4k": {"w": 3840, "h": 2160, "label": "4K · 16:9"},
    "720p": {"w": 1280, "h": 720, "label": "720p · 16:9"},
    "9:16": {"w": 1080, "h": 1920, "label": "9:16 · vertical"},
    "4k-9:16": {"w": 2160, "h": 3840, "label": "4K · 9:16"},
    "1:1": {"w": 1080, "h": 1080, "label": "1:1 · carré"},
    "scope": {"w": 1920, "h": 804, "label": "2,39:1 · scope"},
}
FPS = (24, 25, 30)
STILL_DEFAULT = 5.0          # durée d'une image fixe posée, en secondes
TRACKS_DEFAULT = ["V3", "V2", "V1", "A1", "A2", "A3"]   # de haut en bas, comme à l'écran
MAX_CLIPS = 3000
NEUTRAL_K = 6500             # colortemperature : défaut de ffmpeg ; on ne pose le filtre qu'en s'en écartant
CHUNK_S = 8.0                # secondes d'image par passe d'export (mémoire bornée)

PID = re.compile(r"mon-\d{8}-\d{6}-[0-9a-f]{4}")
CID = re.compile(r"[A-Za-z0-9_-]{1,40}")
TID = re.compile(r"[VA][1-9]")
ITEM = re.compile(r"[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}")

_lock = threading.RLock()


# ── les fichiers ─────────────────────────────────────────────
def _dir() -> Path:
    p = config.data_dir() / "montage"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _path(pid: str) -> Path:
    if not PID.fullmatch(pid or ""):
        raise HttpError(400, "identifiant de montage invalide")
    return _dir() / f"{pid}.json"


def load(pid: str) -> dict:
    f = _path(pid)
    if not f.exists():
        raise HttpError(404, f"montage introuvable : {pid}")
    return json.loads(f.read_text(encoding="utf-8"))


def _write(p: dict) -> None:
    f = _path(p["id"])
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(f)


def new_id() -> str:
    return f"mon-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"


def blank(name: str, settings: dict | None = None) -> dict:
    p = {"id": new_id(), "name": (name or "Sans titre").strip()[:120] or "Sans titre",
         "created": library.now(), "updated": library.now(), "rev": 1,
         "settings": {"format": "1080p", "fps": 25, "still": STILL_DEFAULT},
         "tracks": [{"id": t, "kind": "video" if t[0] == "V" else "audio",
                     "mute": False, "solo": False, "lock": False, "hide": False} for t in TRACKS_DEFAULT],
         "clips": []}
    if settings:
        p["settings"].update({k: v for k, v in settings.items() if k in ("format", "fps", "still")})
    return normalize(p)


# ── validation : le projet tel qu'il doit être ───────────────
def _num(v, lo, hi, default, integer=False):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(x):
        return default
    x = max(lo, min(hi, x))
    return int(round(x)) if integer else x


def normalize(p: dict) -> dict:
    """Rend un projet propre ou lève HttpError(400) en disant pourquoi.
    Les nombres sont bornés, les champs inconnus tombent."""
    if not isinstance(p, dict):
        raise HttpError(400, "un projet est un objet JSON")
    s = p.get("settings") or {}
    fmt = s.get("format") if s.get("format") in FORMATS else "1080p"
    fps = int(s.get("fps")) if str(s.get("fps")) in {str(f) for f in FPS} else 25
    settings = {"format": fmt, "fps": fps, "width": FORMATS[fmt]["w"], "height": FORMATS[fmt]["h"],
                "still": _num(s.get("still"), 0.2, 600, STILL_DEFAULT)}
    tracks, seen = [], set()
    for t in p.get("tracks") or []:
        tid = str((t or {}).get("id", ""))
        if not TID.fullmatch(tid) or tid in seen:
            raise HttpError(400, f"piste invalide ou en double : {tid!r}")
        seen.add(tid)
        tracks.append({"id": tid, "kind": "video" if tid[0] == "V" else "audio",
                       **{k: bool(t.get(k)) for k in ("mute", "solo", "lock", "hide")}})
    if not tracks:
        tracks = blank("x")["tracks"]
    kinds = {t["id"]: t["kind"] for t in tracks}
    clips, ids = [], set()
    raw = p.get("clips") or []
    if len(raw) > MAX_CLIPS:
        raise HttpError(400, f"trop de plans ({len(raw)} > {MAX_CLIPS})")
    for c in raw:
        if not isinstance(c, dict):
            raise HttpError(400, "un plan est un objet")
        cid = str(c.get("id", ""))
        if not CID.fullmatch(cid) or cid in ids:
            raise HttpError(400, f"plan sans identifiant valide ou en double : {cid!r}")
        ids.add(cid)
        tid = c.get("track")
        if tid not in kinds:
            raise HttpError(400, f"le plan {cid} est sur une piste inconnue : {tid!r}")
        kind = c.get("kind")
        if kind not in ("video", "image", "audio"):
            raise HttpError(400, f"le plan {cid} n'est ni vidéo, ni image, ni son")
        if kinds[tid] == "video" and kind == "audio":
            raise HttpError(400, f"le plan {cid} est un son sur une piste vidéo")
        if kinds[tid] == "audio" and kind == "image":
            raise HttpError(400, f"le plan {cid} est une image sur une piste son")
        item = str(c.get("item", ""))
        if not ITEM.fullmatch(item):
            raise HttpError(400, f"le plan {cid} ne pointe vers aucun objet de la bibliothèque")
        dur = _num(c.get("dur"), 1, 10 ** 8, 1, True)
        g = c.get("grade") or {}
        clips.append({
            "id": cid, "track": tid, "item": item, "kind": kind,
            "title": str(c.get("title", ""))[:200],
            "start": _num(c.get("start"), 0, 10 ** 8, 0, True),
            "dur": dur,
            "in": _num(c.get("in"), 0, 10 ** 7, 0.0),
            "src_dur": _num(c.get("src_dur"), 0, 10 ** 7, 0.0),
            "vol": _num(c.get("vol"), 0, 4, 1.0),
            "fade_in": _num(c.get("fade_in"), 0, dur, 0, True),
            "fade_out": _num(c.get("fade_out"), 0, dur, 0, True),
            "xfade": _num(c.get("xfade"), 0, 10 ** 6, 0, True),
            "audio": bool(c.get("audio")) if kind == "video" else kind == "audio",
            "grade": {"exposure": _num(g.get("exposure"), -2, 2, 0.0),
                      "contrast": _num(g.get("contrast"), -100, 100, 0.0),
                      "saturation": _num(g.get("saturation"), -100, 100, 0.0),
                      "temperature": _num(g.get("temperature"), 2000, 12000, float(NEUTRAL_K))},
        })
    out = {"id": p.get("id"), "name": str(p.get("name") or "Sans titre")[:120], "settings": settings,
           "tracks": tracks, "clips": clips}
    for k in ("created", "updated", "rev"):
        if k in p:
            out[k] = p[k]
    return out


def overlaps(p: dict) -> list[str]:
    """Les plans qui se chevauchent sur une même piste (la page n'en crée
    jamais ; l'export refuse s'il en trouve, en les nommant)."""
    bad = []
    for t in p["tracks"]:
        cl = sorted((c for c in p["clips"] if c["track"] == t["id"]), key=lambda c: c["start"])
        for a, b in zip(cl, cl[1:]):
            if a["start"] + a["dur"] > b["start"]:
                bad.append(f"{t['id']} : « {a['title'] or a['id']} » et « {b['title'] or b['id']} »")
    return bad


def project_end(p: dict) -> int:
    return max((c["start"] + c["dur"] for c in p["clips"]), default=0)


# ── le modèle de lecture, commun à la page et à l'export ─────
def xfade_frames(a: dict, b: dict) -> int:
    """Un fondu enchaîné à la tête de `b` ne vaut que si `a` le touche."""
    if b.get("xfade", 0) <= 0 or a["start"] + a["dur"] != b["start"]:
        return 0
    return max(0, min(b["xfade"], a["dur"], b["dur"]))


def windows(p: dict) -> dict[str, dict]:
    """Pour chaque plan, la fenêtre où il se voit et s'entend (en images)
    et ses rampes. Même calcul que `windows()` de montage/model.js.

    Un fondu enchaîné de N images entre A et B (collés, même piste) est
    centré sur la coupe : B commence N//2 images plus tôt et monte de 0 à 1
    sur N images, posé sur A ; A dure N - N//2 images de plus (caché sous
    B à la fin ; son son descend sur les mêmes N images)."""
    out = {}
    by_track: dict[str, list] = {}
    for c in p["clips"]:
        by_track.setdefault(c["track"], []).append(c)
        out[c["id"]] = {"clip": c, "ws": c["start"], "we": c["start"] + c["dur"],
                        "fin": c["fade_in"], "fout": c["fade_out"], "xin": 0, "xout": 0}
    for cl in by_track.values():
        cl.sort(key=lambda c: c["start"])
        for a, b in zip(cl, cl[1:]):
            n = xfade_frames(a, b)
            if n:
                h1 = n // 2
                wa, wb = out[a["id"]], out[b["id"]]
                wb.update(ws=b["start"] - h1, xin=n, fin=0)
                wa.update(we=a["start"] + a["dur"] + (n - h1), xout=n, fout=0)
    return out


def audible(p: dict) -> set[str]:
    """Les pistes qu'on entend : pas muettes, et solo s'il y en a un."""
    solo = any(t["solo"] for t in p["tracks"])
    return {t["id"] for t in p["tracks"] if not t["mute"] and (t["solo"] or not solo)}


# ── la commande ffmpeg ───────────────────────────────────────
def _f(x: float) -> str:
    s = f"{x:.6f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def _grade(g: dict) -> list[str]:
    out = []
    if abs(g.get("exposure", 0)) > 1e-4:
        out.append(f"exposure=exposure={_f(g['exposure'])}")          # doc : -3..3 IL, multiplie
    c, s = g.get("contrast", 0), g.get("saturation", 0)
    if abs(c) > 1e-4 or abs(s) > 1e-4:
        out.append(f"eq=contrast={_f(1 + c / 100)}:saturation={_f(1 + s / 100)}")   # doc : 1 = neutre
    k = g.get("temperature", NEUTRAL_K)
    if abs(k - NEUTRAL_K) > 0.5:
        out.append(f"colortemperature=temperature={_f(k)}")           # doc : 1000..40000 K
    return out


def _check(p: dict, media: dict[str, dict]) -> int:
    total = project_end(p)
    if total <= 0:
        raise ValueError("le montage est vide : posez au moins un plan sur la timeline")
    bad = overlaps(p)
    if bad:
        raise ValueError("des plans se chevauchent : " + " ; ".join(bad[:6]))
    missing = sorted({c["item"] for c in p["clips"] if c["item"] not in media})
    if missing:
        raise ValueError("objets absents de la bibliothèque (à la corbeille ?) : " + ", ".join(missing[:8]))
    return total


def _shift(frames: int, fps: int) -> str:
    return f"{'+' if frames >= 0 else '-'}{abs(frames)}/({fps}*TB)"


def _open(c: dict, m: dict, fps: int, a: int, b: int) -> tuple[list[str], int]:
    """L'entrée ffmpeg qui lit le plan `c` pour les images [a, b) de la
    timeline ; rend (arguments, images de tête figées). Avant le début de
    la source (tête d'un fondu enchaîné), sa première image se fige ; après
    sa fin, la dernière (`tpad` clone, dans le graphe)."""
    nf = b - a
    if m["kind"] == "image":
        return ["-loop", "1", "-framerate", str(fps), "-t", _f(nf / fps + 2 / fps), "-i", m["path"]], 0
    src = c["in"] + (a - c["start"]) / fps
    pre = 0
    if src < 0:
        pre = min(nf, round(-src * fps))
        src = 0.0
    length = (nf - pre) / fps + 2 / fps
    D = m.get("duration") or 0
    if D:
        if src >= D - 0.5 / fps:          # tout ce morceau est au-delà de la source : sa dernière image
            src = max(0.0, D - 1 / fps)
        length = min(length, D - src + 1 / fps)
    return (["-ss", _f(src)] if src > 0 else []) + ["-t", _f(max(length, 1 / fps)), "-i", m["path"]], pre


def _head() -> list[str]:
    return ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-v", "error", "-progress", "pipe:1", "-nostats"]


def plan_video(p: dict, media: dict[str, dict], f0: int, f1: int, out_path: str, preset: str = "medium") -> dict:
    """Une passe d'image : les images [f0, f1) du montage, sans son."""
    fps = p["settings"]["fps"]
    W, H = p["settings"]["width"], p["settings"]["height"]
    win = windows(p)
    hidden = {t["id"] for t in p["tracks"] if t["hide"]}
    order = [t["id"] for t in reversed([t for t in p["tracks"] if t["kind"] == "video"])]   # V1 d'abord
    inputs: list[list[str]] = []
    graph = [f"color=c=black:s={W}x{H}:r={fps}:d={_f((f1 - f0) / fps)},format=yuv420p[base]"]
    last = "base"
    used: list[str] = []
    for tid in order:
        if tid in hidden:
            continue
        for c in sorted((c for c in p["clips"] if c["track"] == tid), key=lambda c: c["start"]):
            w = win[c["id"]]
            a, b = max(w["ws"], f0), min(w["we"], f1)
            if a >= b:
                continue
            args, pre = _open(c, media[c["item"]], fps, a, b)
            inputs.append(args)
            k = len(inputs) - 1
            nw = w["we"] - w["ws"]
            # horodatage relatif au début de la fenêtre du plan : les fondus
            # (en temps) se calculent comme si le plan était rendu d'un bloc
            chain = ["setpts=PTS-STARTPTS", f"fps={fps}",
                     f"scale={W}:{H}:force_original_aspect_ratio=decrease:force_divisible_by=2", "setsar=1",
                     *_grade(c["grade"]),
                     "format=yuva420p", f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black@0",
                     f"tpad=start={pre}:start_mode=clone:stop=-1:stop_mode=clone",
                     f"trim=end_frame={b - a}", f"setpts=PTS-STARTPTS{_shift(a - w['ws'], fps)}"]
            if w["xin"]:
                chain.append(f"fade=t=in:st=0:d={_f(w['xin'] / fps)}:alpha=1")
            if w["fin"]:
                chain.append(f"fade=t=in:st=0:d={_f(w['fin'] / fps)}:alpha=1")
            if w["fout"]:
                chain.append(f"fade=t=out:st={_f((nw - w['fout']) / fps)}:d={_f(w['fout'] / fps)}:alpha=1")
            chain.append(f"setpts=PTS{_shift(w['ws'] - f0, fps)}")
            graph.append(f"[{k}:v]" + ",".join(chain) + f"[v{c['id']}]")
            graph.append(f"[{last}][v{c['id']}]overlay=eof_action=pass[o{c['id']}]")
            last = f"o{c['id']}"
            used.append(c["item"])
    graph.append(f"[{last}]format=yuv420p[vout]")
    g = ";".join(graph)
    # beaucoup d'entrées : deux fils de décodage chacune (auto = un par cœur,
    # mesuré : 14 Go pour 91 entrées en auto, 5,5 Go à 2 fils)
    threads = ["-threads", "2"] if len(inputs) > 8 else []
    args = _head()
    for a in inputs:
        args += threads + a
    args += ["-filter_complex", g, "-map", "[vout]", "-an",
             "-c:v", "libx264", "-preset", preset, "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(fps),
             "-frames:v", str(f1 - f0), out_path]
    return {"args": args, "graph": g, "inputs": len(inputs), "items": used, "f0": f0, "f1": f1, "out": out_path}


def plan_mux(p: dict, media: dict[str, dict], list_path: str, out_path: str) -> dict:
    """La dernière passe : les tranches d'image recollées sans ré-encodage
    (démuxeur concat, `-c:v copy`) et tout le son, mêlé."""
    fps = p["settings"]["fps"]
    T = project_end(p) / fps
    win = windows(p)
    hear = audible(p)
    inputs: list[list[str]] = [["-f", "concat", "-safe", "0", "-i", list_path]]
    graph: list[str] = []
    audio_labels: list[str] = []
    used: list[str] = []
    # le son : les plans son, et le son des plans vidéo qui en ont un
    for t in p["tracks"]:
        if t["id"] not in hear:
            continue
        for c in sorted((c for c in p["clips"] if c["track"] == t["id"]), key=lambda c: c["start"]):
            m = media[c["item"]]
            if c["vol"] <= 0 or not m.get("audio") or m["kind"] == "image":
                continue
            if t["kind"] == "video" and not c["audio"]:
                continue
            w = win[c["id"]]
            args, pre = _open(c, m, fps, w["ws"], w["we"])
            inputs.append(args)
            k = len(inputs) - 1
            nf = w["we"] - w["ws"]
            chain = ["asetpts=PTS-STARTPTS", "aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo"]
            if pre:
                chain.append(f"adelay=delays={round(pre / fps * 48000)}S:all=1")
            chain += ["apad", f"atrim=end_sample={round(nf / fps * 48000)}", "asetpts=PTS-STARTPTS"]
            if abs(c["vol"] - 1) > 1e-4:
                chain.append(f"volume={_f(c['vol'])}")
            if w["xin"]:
                chain.append(f"afade=t=in:ss=0:ns={round(w['xin'] / fps * 48000)}")
            if w["fin"]:
                chain.append(f"afade=t=in:ss=0:ns={round(w['fin'] / fps * 48000)}")
            if w["xout"]:
                chain.append(f"afade=t=out:ss={round((nf - w['xout']) / fps * 48000)}:ns={round(w['xout'] / fps * 48000)}")
            if w["fout"]:
                chain.append(f"afade=t=out:ss={round((nf - w['fout']) / fps * 48000)}:ns={round(w['fout'] / fps * 48000)}")
            if w["ws"]:
                chain.append(f"adelay=delays={round(w['ws'] / fps * 48000)}S:all=1")
            graph.append(f"[{k}:a]" + ",".join(chain) + f"[a{c['id']}]")
            audio_labels.append(f"a{c['id']}")
            used.append(c["item"])
    tail = f"apad=whole_len={round(T * 48000)},atrim=end_sample={round(T * 48000)}"
    if not audio_labels:
        graph.append(f"anullsrc=r=48000:cl=stereo,{tail}[aout]")
    elif len(audio_labels) == 1:
        graph.append(f"[{audio_labels[0]}]{tail}[aout]")
    else:
        graph.append("".join(f"[{a}]" for a in audio_labels)
                     + f"amix=inputs={len(audio_labels)}:duration=longest:dropout_transition=0:normalize=0,{tail}[aout]")

    g = ";".join(graph)
    args = _head()
    for a in inputs:
        args += a
    args += ["-filter_complex", g, "-map", "0:v", "-map", "[aout]", "-c:v", "copy",
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
             "-movflags", "+faststart", "-t", _f(T), out_path]
    return {"args": args, "graph": g, "inputs": len(inputs), "items": used}


def plan(p: dict, media: dict[str, dict], out_path: str, preset: str = "medium",
         chunk_s: float = CHUNK_S, workdir: str = ".") -> dict:
    """Toutes les commandes d'un export : les passes d'image, puis
    l'assemblage avec le son.

    `media` : {id d'objet: {"path", "kind", "duration" (s, None pour une
    image), "audio" (la source a un son)}}. Rend {"chunks", "mux",
    "list_path", "list", "graph", "duration", "frames", "inputs", "items"}.
    Lève ValueError en français si le montage ne peut pas se rendre."""
    total = _check(p, media)
    fps = p["settings"]["fps"]
    step = max(1, round(chunk_s * fps))
    bounds = list(range(0, total, step)) + [total]
    chunks = [plan_video(p, media, f0, f1, f"{workdir}/passe-{i:04d}.mp4", preset)
              for i, (f0, f1) in enumerate(zip(bounds, bounds[1:]))]
    list_path = f"{workdir}/passes.txt"
    mux = plan_mux(p, media, list_path, out_path)
    used = [i for ch in chunks for i in ch["items"]] + mux["items"]
    return {"chunks": chunks, "mux": mux, "list_path": list_path,
            "list": "".join(f"file '{ch['out']}'\n" for ch in chunks),
            "graph": "\n".join([ch["graph"] for ch in chunks] + [mux["graph"]]),
            "duration": total / fps, "frames": total,
            "inputs": max([ch["inputs"] for ch in chunks] + [mux["inputs"]]),
            "items": list(dict.fromkeys(used))}


def media_of(p: dict) -> dict[str, dict]:
    """Les fichiers des objets du montage, lus dans la bibliothèque."""
    out = {}
    for iid in {c["item"] for c in p["clips"]}:
        it = library.get(iid)
        if not it or it["kind"] not in ("video", "image", "audio"):
            continue
        path = library.path_of(it)
        if not path.exists():
            continue
        out[iid] = {"path": str(path), "kind": it["kind"], "duration": it.get("duration"),
                    "audio": bool(it.get("audio")) or it["kind"] == "audio", "title": it.get("title", "")}
    return out


# ── le travail d'export ──────────────────────────────────────
def _ffmpeg(ctx, args: list[str], name: str, on_time) -> None:
    """Lance une commande ffmpeg ; `on_time(secondes rendues, vitesse)` à
    chaque relevé de `-progress` (doc ffmpeg, -progress : des lignes
    clé=valeur, out_time_us, speed, progress=end). Arrête ffmpeg si Cal
    arrête le travail ; lève avec la fin de son message s'il échoue."""
    i = args.index("-filter_complex")
    if len(args[i + 1]) > 100_000:          # un argument est borné (MAX_ARG_STRLEN, 128 Kio)
        gf = ctx.workdir / f"{name}.graphe.txt"
        gf.write_text(args[i + 1], encoding="utf-8")
        args = args[:i] + ["-filter_complex_script", str(gf)] + args[i + 2:]
    err_path = ctx.workdir / f"{name}.err"
    with open(err_path, "w", encoding="utf-8") as err:
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=err, text=True, bufsize=1)
        speed = ""
        try:
            for line in proc.stdout:
                if ctx.cancelled():
                    proc.kill()
                    raise Cancelled("arrêté")
                k, _, v = line.strip().partition("=")
                if k == "speed":
                    speed = v if v != "N/A" else ""
                elif k == "out_time_us" and v.lstrip("-").isdigit():
                    on_time(max(0.0, int(v) / 1e6), speed)
            proc.wait()
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
    if proc.returncode != 0:
        tail = err_path.read_text(encoding="utf-8", errors="replace")[-900:]
        raise RuntimeError(f"ffmpeg a échoué ({name}, code {proc.returncode}) : {tail.strip() or 'sans message'}")


def run_export(ctx) -> dict:
    pid = ctx.params.get("project", "")
    p = normalize(load(pid))
    preset = "veryfast" if ctx.params.get("draft") else "medium"
    chunk_s = _num(ctx.params.get("chunk"), 0.5, 120, CHUNK_S)
    ctx.progress(0.0, "prépare les passes")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", p["name"])[:60] or "montage"
    out = ctx.workdir / f"{safe}.mp4"
    try:
        pl = plan(p, media_of(p), str(out), preset, chunk_s, str(ctx.workdir))
    except ValueError as e:
        raise RuntimeError(str(e)) from e
    Path(pl["list_path"]).write_text(pl["list"], encoding="utf-8")
    (ctx.workdir / "commandes.json").write_text(json.dumps([c["args"] for c in pl["chunks"]] + [pl["mux"]["args"]],
                                                           ensure_ascii=False, indent=1), encoding="utf-8")
    fps, total, T = p["settings"]["fps"], pl["frames"], pl["duration"]
    n = len(pl["chunks"])
    t0 = time.time()
    done = 0
    for i, ch in enumerate(pl["chunks"]):
        def tick(sec, speed, base=done, i=i):
            f = min(total, base + sec * fps)
            frac = 0.95 * f / total
            ctx.progress(frac, f"image {round(frac / 0.95 * 100)} % · {f / fps:.1f} / {T:.1f} s · passe {i + 1}/{n}"
                               + (f" · {speed}" if speed else ""))
        tick(0, "")
        _ffmpeg(ctx, ch["args"], f"passe-{i:04d}", tick)
        done += ch["f1"] - ch["f0"]
    ctx.progress(0.95, "le son et l'assemblage")
    _ffmpeg(ctx, pl["mux"]["args"], "assemblage",
            lambda sec, speed: ctx.progress(0.95 + 0.04 * min(1.0, sec / T), f"le son et l'assemblage · {sec:.1f} / {T:.1f} s"))
    if not out.exists():
        raise RuntimeError("ffmpeg n'a rien écrit")
    ctx.progress(0.99, "range dans la bibliothèque")
    snap = {k: p[k] for k in ("id", "name", "settings", "tracks", "clips", "rev") if k in p}
    it = ctx.add(out, kind="video", title=p["name"],
                 params={"montage": p["id"], "rev": p.get("rev"), "project": snap, "preset": preset},
                 parents=pl["items"], origin={"model": "ffmpeg"})
    return {"note": f"{T:.2f} s rendues en {time.time() - t0:.0f} s ({n} passe{'s' if n > 1 else ''})",
            "montage": p["id"], "item": it["id"], "passes": n}


# ── les routes ───────────────────────────────────────────────
def _summary(p: dict) -> dict:
    fps = p["settings"]["fps"]
    thumb = None
    for c in sorted(p["clips"], key=lambda c: (c["track"][0] != "V", c["start"])):
        it = library.get(c["item"])
        if it and it["kind"] in ("video", "image"):
            thumb = library.public(it).get("thumb_url")
            break
    return {"id": p["id"], "name": p["name"], "updated": p.get("updated"), "created": p.get("created"),
            "rev": p.get("rev", 1), "clips": len(p["clips"]), "duration": round(project_end(p) / fps, 3),
            "format": p["settings"]["format"], "fps": fps, "thumb_url": thumb}


def r_meta(req):
    return {"formats": [{"id": k, **v} for k, v in FORMATS.items()], "fps": list(FPS),
            "still": STILL_DEFAULT, "tracks": TRACKS_DEFAULT, "neutral_k": NEUTRAL_K}


def r_list(req):
    out = []
    for f in _dir().glob("mon-*.json"):
        try:
            out.append(_summary(normalize(json.loads(f.read_text(encoding="utf-8")))))
        except (ValueError, HttpError):
            continue
    out.sort(key=lambda s: s.get("updated") or "", reverse=True)
    return {"projects": out}


def r_create(req):
    d = req.json()
    p = blank(d.get("name", ""), d.get("settings"))
    with _lock:
        _write(p)
    return p


def r_get(req, pid):
    return normalize(load(pid))


def r_save(req, pid):
    """La page envoie le projet entier après chaque geste. `base_rev` :
    la version qu'elle avait ; si le fichier a bougé entre-temps (un autre
    onglet), on refuse plutôt que d'écraser en silence."""
    d = req.json()
    with _lock:
        cur = load(pid)
        base = d.get("base_rev")
        if base is not None and int(base) != int(cur.get("rev", 1)):
            raise HttpError(409, "ce montage a été modifié ailleurs (un autre onglet ?) : rechargez-le")
        new = normalize({**d, "id": pid})
        new.update(created=cur.get("created"), updated=library.now(), rev=int(cur.get("rev", 1)) + 1)
        _write(new)
    return {"ok": True, "rev": new["rev"], "updated": new["updated"], "warnings": overlaps(new)}


def r_rename(req, pid):
    name = str(req.json().get("name", "")).strip()[:120]
    if not name:
        raise HttpError(400, "un nom, s'il vous plaît")
    with _lock:
        p = load(pid)
        p.update(name=name, updated=library.now(), rev=int(p.get("rev", 1)) + 1)
        _write(p)
    return _summary(normalize(p))


def r_duplicate(req, pid):
    with _lock:
        src = normalize(load(pid))
        p = {**src, "id": new_id(), "name": (src["name"] + " (copie)")[:120],
             "created": library.now(), "updated": library.now(), "rev": 1}
        _write(p)
    return _summary(p)


def r_delete(req, pid):
    f = _path(pid)
    if not f.exists():
        raise HttpError(404, "montage introuvable")
    trash = _dir() / "corbeille"
    trash.mkdir(exist_ok=True)
    with _lock:
        shutil.move(str(f), str(trash / f.name))
    return {"ok": True}


def r_wave(req, item_id):
    """La forme d'onde d'un son (ou du son d'une vidéo), en PNG blanc sur
    transparent : la page s'en sert comme masque, la couleur vient des
    jetons. ffmpeg `showwavespic` (doc ffmpeg-filters), mise en cache."""
    if not ITEM.fullmatch(item_id or ""):
        raise HttpError(400, "objet invalide")
    it = library.get(item_id)
    if not it or it["kind"] not in ("audio", "video") or (it["kind"] == "video" and not it.get("audio")):
        raise HttpError(404, "pas de son pour cet objet")
    cache = _dir() / "ondes"
    cache.mkdir(exist_ok=True)
    png = cache / f"{item_id}.png"
    if not png.exists():
        tmp = cache / f"{item_id}.{secrets.token_hex(3)}.png"
        r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(library.path_of(it)),
                            "-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=2400x96:colors=white:scale=sqrt:filter=peak",
                            "-frames:v", "1", str(tmp)], capture_output=True, timeout=120)
        if r.returncode != 0 or not tmp.exists():
            tmp.unlink(missing_ok=True)
            raise HttpError(500, "forme d'onde impossible : " + r.stderr.decode("utf-8", "replace")[-300:])
        tmp.replace(png)
    return FileResponse(png, "image/png", cache="max-age=86400")


def r_plan(req, pid):
    """Les commandes d'export telles qu'elles partiraient (pour vérifier) :
    `steps` = chaque passe d'image puis l'assemblage."""
    p = normalize(load(pid))
    try:
        pl = plan(p, media_of(p), "sortie.mp4")
    except ValueError as e:
        raise HttpError(409, str(e)) from e
    return {"steps": [c["args"] for c in pl["chunks"]] + [pl["mux"]["args"]],
            **{k: pl[k] for k in ("graph", "duration", "frames", "inputs", "items")}}


def register(app) -> None:
    jobs.register("montage.export", run_export, lane="cpu", title="Montage · export")
    app.route("GET", "/api/montage/meta", r_meta)
    app.route("GET", "/api/montage/projects", r_list)
    app.route("POST", "/api/montage/projects", r_create)
    app.route("GET", "/api/montage/projects/{pid}", r_get)
    app.route("POST", "/api/montage/projects/{pid}", r_save)
    app.route("POST", "/api/montage/projects/{pid}/rename", r_rename)
    app.route("POST", "/api/montage/projects/{pid}/duplicate", r_duplicate)
    app.route("POST", "/api/montage/projects/{pid}/delete", r_delete)
    app.route("GET", "/api/montage/projects/{pid}/plan", r_plan)
    app.route("GET", "/api/montage/wave/{item_id}", r_wave)


# ── le contrôle (tools/check.py) ─────────────────────────────
def _probe(path: str) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-print_format", "json", "-show_format",
                        "-show_streams", path], capture_output=True, text=True, timeout=60)
    return json.loads(r.stdout or "{}")


def _pixel(path: str, frame: int, where: str = "center") -> tuple[int, int, int]:
    """La couleur moyenne d'un carré de 16 px d'une image de la vidéo :
    au centre, ou au bord gauche (`left`)."""
    crop = "crop=16:16" if where == "center" else "crop=16:16:0:(ih-16)/2"
    r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-vf", f"select=eq(n\\,{frame}),{crop},scale=1:1",
                        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, timeout=60)
    b = r.stdout[:3]
    return tuple(b) if len(b) == 3 else (-1, -1, -1)


def selftest(call, ok) -> None:
    # 1. les projets
    st, meta = call("GET", "/api/montage/meta")
    ok(st == 200 and "1080p" in [f["id"] for f in meta["formats"]] and meta["fps"] == [24, 25, 30], "montage : réglages")
    st, p = call("POST", "/api/montage/projects", {"name": "Essai montage", "settings": {"format": "720p", "fps": 25}})
    ok(st == 200 and PID.fullmatch(p.get("id", "")) and p["settings"]["width"] == 1280 and len(p["tracks"]) == 6,
       f"montage : créer un projet ({st} {str(p)[:200]})")
    pid = p["id"]
    st, lst = call("GET", "/api/montage/projects")
    ok(st == 200 and any(x["id"] == pid for x in lst["projects"]), "montage : la liste")
    st, bad = call("POST", f"/api/montage/projects/{pid}", {**p, "base_rev": p["rev"],
                   "clips": [{"id": "k1", "track": "V9", "item": "vid-20260928-000000-abcd", "kind": "video", "dur": 10}]})
    ok(st == 400 and "piste inconnue" in bad.get("error", ""), f"montage : un plan sur une piste inconnue est refusé ({st} {bad})")
    st, bad = call("POST", f"/api/montage/projects/{pid}", {**p, "base_rev": p["rev"],
                   "clips": [{"id": "k1", "track": "A1", "item": "ima-20260928-000000-abcd", "kind": "image", "dur": 10}]})
    ok(st == 400, "montage : une image sur une piste son est refusée")
    st, bad = call("GET", "/api/montage/projects/..%2F..%2Fjobs")
    ok(st in (400, 404), f"montage : un identifiant hors motif est refusé ({st})")

    # 2. le modèle et la commande, sans fichier
    fake = {"id": pid, "name": "x", "settings": {"format": "720p", "fps": 25}, "tracks": p["tracks"],
            "clips": [
                {"id": "a", "track": "V1", "item": "vid-20260928-000000-aaaa", "kind": "video", "start": 0, "dur": 50, "in": 0, "audio": True},
                {"id": "b", "track": "V1", "item": "vid-20260928-000000-bbbb", "kind": "video", "start": 50, "dur": 50, "in": 0, "xfade": 10},
                {"id": "t", "track": "V2", "item": "ima-20260928-000000-cccc", "kind": "image", "start": 25, "dur": 50, "fade_in": 5, "fade_out": 5,
                 "grade": {"exposure": 0.5, "temperature": 4000}},
                {"id": "m", "track": "A1", "item": "aud-20260928-000000-dddd", "kind": "audio", "start": 10, "dur": 80, "vol": 0.5}]}
    fp = normalize(fake)
    w = windows(fp)
    ok(w["b"]["ws"] == 45 and w["b"]["xin"] == 10 and w["a"]["we"] == 55 and w["a"]["xout"] == 10,
       f"montage : fondu enchaîné centré sur la coupe ({w['a']['ws']}-{w['a']['we']}, {w['b']['ws']}-{w['b']['we']})")
    med = {"vid-20260928-000000-aaaa": {"path": "/a.mp4", "kind": "video", "duration": 2.0, "audio": True},
           "vid-20260928-000000-bbbb": {"path": "/b.mp4", "kind": "video", "duration": 2.0, "audio": False},
           "ima-20260928-000000-cccc": {"path": "/c.png", "kind": "image", "duration": None, "audio": False},
           "aud-20260928-000000-dddd": {"path": "/d.wav", "kind": "audio", "duration": 10.0, "audio": True}}
    pl = plan(fp, med, "/o.mp4")
    g = pl["graph"]
    ok(pl["frames"] == 100 and abs(pl["duration"] - 4.0) < 1e-9, "montage : durée = fin du dernier plan")
    ok(len(pl["chunks"]) == 1 and "fade=t=in:st=0:d=0.4:alpha=1" in g and "tpad=start=5:start_mode=clone" in g,
       "montage : le fondu enchaîné prend 5 images figées avant la source")
    p2 = plan(fp, med, "/o.mp4", chunk_s=2.0)
    g2 = p2["chunks"][1]["graph"]
    ok(len(p2["chunks"]) == 2 and "trim=end_frame=5,setpts=PTS-STARTPTS+50/(25*TB)" in g2
       and "setpts=PTS-STARTPTS+5/(25*TB),fade=t=in:st=0:d=0.4" in g2 and "-c:v" in p2["mux"]["args"]
       and p2["mux"]["args"][p2["mux"]["args"].index("-c:v") + 1] == "copy",
       "montage : deux passes coupées au milieu du fondu, chacune reprend sa fenêtre, recollées sans ré-encoder")
    ok("exposure=exposure=0.5" in g and "colortemperature=temperature=4000" in g, "montage : l'étalonnage passe à ffmpeg")
    ok("volume=0.5" in g and "amix=inputs=2" in g and "normalize=0" in g, "montage : le son (vidéo A + musique) est mêlé sans renormaliser")
    ok(g.index("[vb]") > g.index("[va]") and g.index("[vt]") > g.index("[vb]"), "montage : V1 dessous, V2 dessus")
    fp["tracks"][0]["hide"] = True           # V3 masquée : rien ne change
    fp["tracks"][1]["hide"] = True           # V2 masquée : le titre disparaît
    ok("[vt]" not in plan(fp, med, "/o.mp4")["graph"], "montage : une piste masquée ne s'exporte pas")
    fp["tracks"][3]["mute"] = True
    ok("[am]" not in plan(fp, med, "/o.mp4")["graph"], "montage : une piste muette ne s'exporte pas")
    try:
        plan({**fp, "clips": fp["clips"] + [{**fp["clips"][0], "id": "z", "start": 40}]}, med, "/o.mp4")
        ok(False, "montage : un chevauchement doit être refusé")
    except ValueError as e:
        ok("chevauchent" in str(e), "montage : un chevauchement est refusé")

    # 3. un vrai export, très court : rouge 2 s | bleu 2 s en fondu enchaîné, un son, une image au-dessus
    if not shutil.which("ffmpeg"):
        ok(False, "montage : ffmpeg absent de cette machine")
        return
    tmp = Path(tempfile.mkdtemp(prefix="sr_montage_"))
    made = {}
    for name, src in (("rouge.mp4", "color=c=red:s=320x180:r=25:d=3"), ("bleu.mp4", "color=c=blue:s=320x180:r=25:d=3")):
        subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", src, "-f", "lavfi", "-i",
                        "sine=f=440:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
                        str(tmp / name)], check=True, timeout=60)
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "color=c=white:s=64x64:d=0.04",
                    "-frames:v", "1", str(tmp / "blanc.png")], check=True, timeout=60)
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "sine=f=220:d=5",
                    str(tmp / "note.wav")], check=True, timeout=60)
    for name in ("rouge.mp4", "bleu.mp4", "blanc.png", "note.wav"):
        st, it = call("PUT", f"/api/library/upload?name={name}&title={name.split('.')[0]}", raw=(tmp / name).read_bytes())
        made[name] = it
    ok(all(isinstance(v, dict) and v.get("id") for v in made.values()), "montage : sources d'essai dans la bibliothèque")
    ok(made["rouge.mp4"].get("audio") is True, "montage : la bibliothèque sait qu'une vidéo a du son")
    r, b, im, snd = (made[k] for k in ("rouge.mp4", "bleu.mp4", "blanc.png", "note.wav"))
    clips = [
        {"id": "r", "track": "V1", "item": r["id"], "kind": "video", "start": 0, "dur": 50, "in": 0.5, "src_dur": 3, "audio": True},
        {"id": "b", "track": "V1", "item": b["id"], "kind": "video", "start": 50, "dur": 50, "in": 0, "src_dur": 3, "audio": True, "xfade": 10},
        {"id": "w", "track": "V2", "item": im["id"], "kind": "image", "start": 75, "dur": 10},
        {"id": "s", "track": "A1", "item": snd["id"], "kind": "audio", "start": 0, "dur": 100, "in": 0, "src_dur": 5, "vol": 0.8, "fade_out": 25},
    ]
    st, sv = call("POST", f"/api/montage/projects/{pid}", {**p, "base_rev": p["rev"], "settings": {"format": "720p", "fps": 25}, "clips": clips})
    ok(st == 200 and sv["rev"] == p["rev"] + 1 and not sv["warnings"], f"montage : enregistrer ({st} {sv})")
    st, stale = call("POST", f"/api/montage/projects/{pid}", {**p, "base_rev": p["rev"], "clips": []})
    ok(st == 409, "montage : une version dépassée ne l'écrase pas")
    st, pl = call("GET", f"/api/montage/projects/{pid}/plan")
    ok(st == 200 and pl["frames"] == 100, f"montage : la commande d'export ({st})")
    # passes de 2 s : la coupure entre passes tombe à l'image 50, au milieu du fondu enchaîné
    st, j = call("POST", "/api/jobs", {"kind": "montage.export", "params": {"project": pid, "draft": True, "chunk": 2.0}, "title": "essai"})
    ok(st == 200, "montage : l'export part en file")
    for _ in range(300):
        st, j = call("GET", f"/api/jobs/{j['id']}")
        if j["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.4)
    ok(j["state"] == "done" and len(j["items"]) == 1 and j["result"].get("passes") == 2,
       f"montage : l'export se termine, en deux passes ({j['state']} {j.get('message')} {j.get('result')})")
    if j["state"] != "done" or not j["items"]:
        return
    out = j["items"][0]
    ok(out["kind"] == "video" and out["params"]["montage"] == pid and set(out["parents"]) == {r["id"], b["id"], im["id"], snd["id"]},
       "montage : la vidéo rangée garde sa lignée et son montage")
    path = str(library.path_of(library.get(out["id"])))
    info = _probe(path)
    vs = [s for s in info.get("streams", []) if s["codec_type"] == "video"]
    au = [s for s in info.get("streams", []) if s["codec_type"] == "audio"]
    ok(vs and vs[0]["codec_name"] == "h264" and vs[0]["width"] == 1280 and vs[0]["height"] == 720,
       f"montage : H.264 1280×720 ({vs[:1]})")
    ok(vs and int(vs[0].get("nb_read_frames", 0)) == 100, f"montage : 100 images exactement ({vs[0].get('nb_read_frames') if vs else '?'})")
    ok(au and au[0]["codec_name"] == "aac" and abs(float(info["format"]["duration"]) - 4.0) < 0.1,
       f"montage : AAC, 4 s ({info.get('format', {}).get('duration')})")
    px = {f: _pixel(path, f) for f in (10, 44, 50, 54, 60, 80, 90)}
    red = lambda c: c[0] > 200 and c[2] < 60      # noqa: E731
    blue = lambda c: c[2] > 200 and c[0] < 60     # noqa: E731
    ok(red(px[10]) and red(px[44]), f"montage : rouge avant le fondu ({px[10]} {px[44]})")
    ok(40 < px[50][0] < 200 and 40 < px[50][2] < 200, f"montage : mi-rouge mi-bleu au milieu du fondu ({px[50]})")
    ok(blue(px[60]), f"montage : bleu après le fondu ({px[60]})")
    ok(min(px[80]) > 200, f"montage : l'image blanche de V2 couvre V1 ({px[80]})")
    side = _pixel(path, 80, "left")
    ok(blue(side), f"montage : une image carrée en 16:9 laisse voir V1 sur les côtés, pas du noir ({side})")
    ok(blue(px[90]), f"montage : V1 revient quand l'image finit ({px[90]})")
    shutil.rmtree(tmp, ignore_errors=True)
