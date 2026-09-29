"""Montage : des projets de montage (une timeline multipiste) et leur
export en MP4 (H.264 + AAC) par ffmpeg ; une bibliothèque de LUT.

Un projet est un fichier JSON sous `<data_dir>/montage/<id>.json` ; la
page l'enregistre seule à chaque geste, il n'y a rien à « enregistrer ».
Les positions sur la timeline (`start`, `dur`, fondus) sont en **images
entières** à la cadence du projet : une coupe tombe toujours sur une
image, en lecture comme à l'export. Le point d'entrée dans la source
(`in`) est en secondes, la source ayant sa propre cadence ; `speed` dit
combien de secondes de source passent par seconde de timeline.

Le projet porte aussi ses pistes (autant qu'on veut, jusqu'à `MAX_TRACKS`
par sorte, nommées par leur place comme dans Premiere : V1 en bas, A1 en
haut, plus un nom libre), ses marques, ses points d'entrée et de sortie de
séquence (`range`, l'export peut s'y borner) et les dossiers de son
chutier (`bins`). Un projet d'avant ces champs se lit sans perte : ce qui
manque prend sa valeur par défaut (`normalize`).

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
    ffmpeg « Main options », -ss), remise à 0 et à sa vitesse (`setpts`),
    à la cadence du projet (`fps`), cadrée sans déformer (`scale` +
    `force_original_aspect_ratio=decrease`) et passée en RVB **avec la
    matrice que le navigateur emploie pour cette source** (celle de son
    étiquette ; sans étiquette, BT.709 à partir de 720 lignes, BT.601
    en dessous — mesuré dans Chromium le 29/09, voir l'étude), étalonnée
    (`exposure`, `eq`, `colortemperature`), passée par sa LUT (`lut3d`
    trilinéaire ou `lut1d` linéaire, en flottants), remise en YUV BT.709,
    prolongée en figeant sa première ou dernière image quand un fondu
    enchaîné demande plus que la source n'a (`tpad` clone), coupée au
    nombre d'images exact (`trim=end_frame`), fondue en transparence
    (`fade … alpha=1`, en temps : un fondu à cheval sur deux passes reste
    continu), puis décalée à sa place (`setpts=PTS+…`) et posée sur ce qui
    est dessous (`overlay=eof_action=pass`) ; V1 d'abord, la plus haute
    en dernier, donc au-dessus. La sortie est étiquetée BT.709 : tout
    lecteur la décode comme elle a été écrite ;
  - chaque son : le même découpage (`atrim`), sa vitesse (`atempo`),
    `volume`, `afade`, décalé (`adelay` en échantillons, `all=1`), puis
    `amix` sans renormaliser (`normalize=0`).

Essais qui fondent ce graphe (DGX2, ffmpeg 6.1.1) : voir
`docs/etudes/montage.md`.
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

from core import auth, config, jobs, library
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
MAX_TRACKS = 20              # par sorte (vidéo, son) ; la page borne pareil (model.js)
MAX_CLIPS = 3000
NEUTRAL_K = 6500             # colortemperature : défaut de ffmpeg ; on ne pose le filtre qu'en s'en écartant
CHUNK_S = 8.0                # secondes d'image par passe d'export (mémoire bornée)
SPEED_MIN, SPEED_MAX = 0.1, 10.0

PID = re.compile(r"mon-\d{8}-\d{6}-[0-9a-f]{4}")
CID = re.compile(r"[A-Za-z0-9_-]{1,40}")
TID = re.compile(r"[VA](?:[1-9]|1[0-9]|20)")
ITEM = re.compile(r"[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}")
FID = re.compile(r"f[A-Za-z0-9_-]{1,30}")
MID = re.compile(r"m[A-Za-z0-9_-]{1,30}")
LUT_ID = re.compile(r"lut-\d{8}-\d{6}-[0-9a-f]{4}")
SAFE_PATH = re.compile(r"[A-Za-z0-9_./@-]+")

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


def _track(tid: str) -> dict:
    return {"id": tid, "kind": "video" if tid[0] == "V" else "audio",
            "mute": False, "solo": False, "lock": False, "hide": False, "name": ""}


def blank(name: str, settings: dict | None = None) -> dict:
    p = {"id": new_id(), "name": (name or "Sans titre").strip()[:120] or "Sans titre",
         "created": library.now(), "updated": library.now(), "rev": 1,
         "settings": {"format": "1080p", "fps": 25, "still": STILL_DEFAULT},
         "tracks": [_track(t) for t in TRACKS_DEFAULT],
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


def _tracks(raw: list) -> tuple[list[dict], dict[str, str]]:
    """Les pistes, dans l'ordre de l'écran (vidéo de haut en bas, puis son),
    renommées par leur place si elles ne le sont pas (V1 en bas, A1 en
    haut) : rend (pistes, ancien nom → nouveau)."""
    tracks, seen = [], set()
    for t in raw or []:
        tid = str((t or {}).get("id", ""))
        if not TID.fullmatch(tid) or tid in seen:
            raise HttpError(400, f"piste invalide ou en double : {tid!r}")
        seen.add(tid)
        tracks.append({"id": tid, "kind": "video" if tid[0] == "V" else "audio",
                       **{k: bool(t.get(k)) for k in ("mute", "solo", "lock", "hide")},
                       "name": " ".join(str(t.get("name") or "").split())[:40]})
    vids = [t for t in tracks if t["kind"] == "video"]
    auds = [t for t in tracks if t["kind"] == "audio"]
    if not vids:
        vids = [_track("V1")]
    if not auds:
        auds = [_track("A1")]
    if len(vids) > MAX_TRACKS or len(auds) > MAX_TRACKS:
        raise HttpError(400, f"trop de pistes ({MAX_TRACKS} vidéo et {MAX_TRACKS} son au plus)")
    ren = {}
    for i, t in enumerate(vids):
        ren[t["id"]] = f"V{len(vids) - i}"
    for i, t in enumerate(auds):
        ren[t["id"]] = f"A{i + 1}"
    out = [{**t, "id": ren[t["id"]]} for t in vids + auds]
    return out, ren


def _bins(b, known_items: set | None = None) -> dict:
    """Les dossiers du chutier : {folders: [{id, name, parent}], items:
    {objet: dossier}, hidden: [objets retirés du chutier]}. Ce qui ne tient
    pas (dossier inconnu, boucle de parents) tombe : c'est du rangement."""
    b = b if isinstance(b, dict) else {}
    folders, ids = [], set()
    for f in (b.get("folders") or [])[:500]:
        if not isinstance(f, dict):
            continue
        fid = str(f.get("id", ""))
        if not FID.fullmatch(fid) or fid in ids:
            continue
        ids.add(fid)
        name = " ".join(str(f.get("name") or "").split())[:80] or "Dossier"
        folders.append({"id": fid, "name": name, "parent": f.get("parent") if f.get("parent") else None})
    parent = {f["id"]: f["parent"] for f in folders}
    for f in folders:
        if f["parent"] not in ids:
            f["parent"] = None
        # une boucle (a dans b dans a) : le dossier remonte à la racine
        seen, cur = {f["id"]}, f["parent"]
        while cur:
            if cur in seen:
                f["parent"] = None
                break
            seen.add(cur)
            cur = parent.get(cur)
        parent[f["id"]] = f["parent"]
    items = {}
    for k, v in (b.get("items") or {}).items() if isinstance(b.get("items"), dict) else []:
        if ITEM.fullmatch(str(k)) and v in ids and len(items) < 20000:
            items[str(k)] = v
    hidden = []
    for k in b.get("hidden") or []:
        if ITEM.fullmatch(str(k)) and str(k) not in hidden and len(hidden) < 20000:
            hidden.append(str(k))
    return {"folders": folders, "items": items, "hidden": hidden}


def normalize(p: dict) -> dict:
    """Rend un projet propre ou lève HttpError(400) en disant pourquoi.
    Les nombres sont bornés, les champs inconnus tombent, les champs
    nouveaux (vitesse, LUT, marques…) prennent leur défaut : un projet
    enregistré avant eux se relit tel quel."""
    if not isinstance(p, dict):
        raise HttpError(400, "un projet est un objet JSON")
    s = p.get("settings") or {}
    fmt = s.get("format") if s.get("format") in FORMATS else "1080p"
    fps = int(s.get("fps")) if str(s.get("fps")) in {str(f) for f in FPS} else 25
    settings = {"format": fmt, "fps": fps, "width": FORMATS[fmt]["w"], "height": FORMATS[fmt]["h"],
                "still": _num(s.get("still"), 0.2, 600, STILL_DEFAULT)}
    tracks, ren = _tracks(p.get("tracks") or [_track(t) for t in TRACKS_DEFAULT])
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
        tid = ren.get(c.get("track"))
        if tid not in kinds:
            raise HttpError(400, f"le plan {cid} est sur une piste inconnue : {c.get('track')!r}")
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
        lut = c.get("lut") if isinstance(c.get("lut"), dict) else None
        if lut and LUT_ID.fullmatch(str(lut.get("id", ""))) and kinds[tid] == "video":
            lut = {"id": str(lut["id"]), "mix": round(_num(lut.get("mix"), 0, 1, 1.0), 3)}
        else:
            lut = None
        clips.append({
            "id": cid, "track": tid, "item": item, "kind": kind,
            "title": str(c.get("title", ""))[:200],
            "start": _num(c.get("start"), 0, 10 ** 8, 0, True),
            "dur": dur,
            "in": _num(c.get("in"), 0, 10 ** 7, 0.0),
            "src_dur": _num(c.get("src_dur"), 0, 10 ** 7, 0.0),
            "speed": 1.0 if kind == "image" else _num(c.get("speed"), SPEED_MIN, SPEED_MAX, 1.0),
            "enabled": c.get("enabled") is not False,
            "vol": _num(c.get("vol"), 0, 4, 1.0),
            "fade_in": _num(c.get("fade_in"), 0, dur, 0, True),
            "fade_out": _num(c.get("fade_out"), 0, dur, 0, True),
            "xfade": _num(c.get("xfade"), 0, 10 ** 6, 0, True),
            "audio": bool(c.get("audio")) if kind == "video" else kind == "audio",
            "grade": {"exposure": _num(g.get("exposure"), -2, 2, 0.0),
                      "contrast": _num(g.get("contrast"), -100, 100, 0.0),
                      "saturation": _num(g.get("saturation"), -100, 100, 0.0),
                      "temperature": _num(g.get("temperature"), 2000, 12000, float(NEUTRAL_K))},
            "lut": lut,
        })
    markers, mids = [], set()
    for m in (p.get("markers") or [])[:500]:
        if not isinstance(m, dict) or not MID.fullmatch(str(m.get("id", ""))) or m["id"] in mids:
            continue
        mids.add(m["id"])
        markers.append({"id": m["id"], "f": _num(m.get("f"), 0, 10 ** 8, 0, True),
                        "name": " ".join(str(m.get("name") or "").split())[:80]})
    markers.sort(key=lambda m: m["f"])
    r = p.get("range") if isinstance(p.get("range"), dict) else {}
    rin = _num(r.get("in"), 0, 10 ** 8, None, True) if r.get("in") is not None else None
    rout = _num(r.get("out"), 0, 10 ** 8, None, True) if r.get("out") is not None else None
    if rin is not None and rout is not None and rout <= rin:
        rout = None
    out = {"id": p.get("id"), "name": str(p.get("name") or "Sans titre")[:120], "settings": settings,
           "tracks": tracks, "clips": clips, "markers": markers, "range": {"in": rin, "out": rout},
           "bins": _bins(p.get("bins"))}
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
    B à la fin ; son son descend sur les mêmes N images). Un plan
    désactivé ne fond avec personne."""
    out = {}
    by_track: dict[str, list] = {}
    for c in p["clips"]:
        out[c["id"]] = {"clip": c, "ws": c["start"], "we": c["start"] + c["dur"],
                        "fin": c["fade_in"], "fout": c["fade_out"], "xin": 0, "xout": 0}
        if c.get("enabled", True):
            by_track.setdefault(c["track"], []).append(c)
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


# ── les LUT ──────────────────────────────────────────────────
# Une LUT est rangée sous `<data_dir>/luts/<id>.cube`, réécrite sous une
# forme unique (TITLE, LUT_3D_SIZE ou LUT_1D_SIZE, puis les valeurs à six
# décimales, rouge le plus rapide) : la page (montage/lut.js) et ffmpeg lisent
# le même fichier, et le lecteur de ffmpeg (vf_lut3d.c, parse_cube) n'a que
# des lignes qu'il comprend. Le domaine d'entrée doit être 0..1 (ffmpeg 6.1
# ne tient compte que de max − min, pas de min : un autre domaine serait
# lu autrement par les deux).
LUT_MAX_3D = 65
LUT_MAX_1D = 4096
LUT_INPUTS = {"rec709": "Rec.709 / sRGB", "flog": "F-Log", "flog2": "F-Log2", "flog2c": "F-Log2 C",
              "log": "autre log", "inconnu": "non documenté"}


def _luts_dir() -> Path:
    p = config.data_dir() / "luts"
    p.mkdir(parents=True, exist_ok=True)
    return p


def parse_cube(text: str) -> dict:
    """Lit un fichier .cube (Adobe « Cube LUT Specification 1.0 », et les
    mots de Resolve LUT_3D_INPUT_RANGE / LUT_1D_INPUT_RANGE) : rend
    {kind: 3d|1d, size, values: [r, g, b, …], title}. Lève ValueError en
    français si le fichier ne se lit pas comme la spécification le dit."""
    kind = size = None
    title = ""
    lo, hi = [0.0, 0.0, 0.0], [1.0, 1.0, 1.0]
    vals: list[float] = []
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        head = line.split()[0]
        if head[0] in "+-.0123456789":
            parts = line.split()
            if len(parts) != 3:
                raise ValueError(f"ligne {n} : trois nombres attendus")
            try:
                v = [float(x) for x in parts]
            except ValueError as e:
                raise ValueError(f"ligne {n} : nombre illisible") from e
            if not all(math.isfinite(x) for x in v):
                raise ValueError(f"ligne {n} : valeur non finie")
            vals.extend(v)
            continue
        if vals:
            raise ValueError(f"ligne {n} : un mot-clé après les données ({head})")
        rest = line[len(head):].strip()
        if head == "TITLE":
            title = rest.strip('"')[:120]
        elif head in ("LUT_3D_SIZE", "LUT_1D_SIZE"):
            if kind:
                raise ValueError("LUT 1D et 3D dans le même fichier (préparation 1D + 3D) : non prise en charge")
            kind = "3d" if head == "LUT_3D_SIZE" else "1d"
            try:
                size = int(rest)
            except ValueError as e:
                raise ValueError(f"{head} illisible") from e
            top = LUT_MAX_3D if kind == "3d" else LUT_MAX_1D
            if not 2 <= size <= top:
                raise ValueError(f"{head} {size} : de 2 à {top}")
        elif head in ("DOMAIN_MIN", "DOMAIN_MAX"):
            try:
                v = [float(x) for x in rest.split()]
            except ValueError as e:
                raise ValueError(f"{head} illisible") from e
            if len(v) != 3:
                raise ValueError(f"{head} : trois nombres attendus")
            (lo if head == "DOMAIN_MIN" else hi)[:] = v
        elif head in ("LUT_3D_INPUT_RANGE", "LUT_1D_INPUT_RANGE"):
            try:
                a, b = (float(x) for x in rest.split())
            except ValueError as e:
                raise ValueError(f"{head} : deux nombres attendus") from e
            lo[:], hi[:] = [a] * 3, [b] * 3
        # un autre mot-clé (commentaire d'outil) : la spécification ne le connaît pas, il ne change rien ici
    if not kind:
        raise ValueError("ni LUT_3D_SIZE ni LUT_1D_SIZE : ce n'est pas un fichier .cube")
    if any(abs(x) > 1e-6 for x in lo) or any(abs(x - 1) > 1e-6 for x in hi):
        raise ValueError(f"domaine d'entrée {lo} → {hi} : seul 0..1 est pris en charge (ffmpeg lirait autrement)")
    want = (size ** 3 if kind == "3d" else size) * 3
    if len(vals) != want:
        raise ValueError(f"{len(vals) // 3} lignes de valeurs, {want // 3} attendues pour {kind.upper()} {size}")
    return {"kind": kind, "size": size, "values": vals, "title": title}


def parse_hald(data: bytes) -> dict:
    """Une HaldCLUT en PNG (image carrée de L³ × L³ pixels, L² points par
    côté, rouge le plus rapide puis vert puis bleu — l'ordre même de
    `update_clut_packed` de ffmpeg vf_lut3d.c) : rendue comme une LUT 3D."""
    from io import BytesIO
    from PIL import Image
    try:
        im = Image.open(BytesIO(data))
        im.load()
    except Exception as e:  # noqa: BLE001 — PIL lève toutes sortes d'erreurs
        raise ValueError(f"image illisible : {e}") from e
    w, h = im.size
    n = round((w * h) ** (1 / 3))
    if w != h or n ** 3 != w * h:
        raise ValueError(f"{w}×{h} : une HaldCLUT est carrée, de L³ pixels de côté")
    if n > LUT_MAX_3D:
        raise ValueError(f"HaldCLUT de {n} points par côté : {LUT_MAX_3D} au plus")
    px = im.convert("RGB").tobytes()
    return {"kind": "3d", "size": n, "values": [b / 255 for b in px], "title": ""}


def cube_text(lut: dict, title: str = "") -> str:
    """La forme unique d'une LUT (voir plus haut)."""
    t = re.sub(r'["\r\n]', "", title or lut.get("title") or "LUT")[:120]
    head = f'TITLE "{t}"\n' + ("LUT_3D_SIZE" if lut["kind"] == "3d" else "LUT_1D_SIZE") + f" {lut['size']}\n"
    v = lut["values"]
    return head + "".join(f"{v[i]:.6f} {v[i + 1]:.6f} {v[i + 2]:.6f}\n" for i in range(0, len(v), 3))


def mixed(lut: dict, k: float) -> dict:
    """La LUT à l'intensité k : (1 − k)·identité + k·LUT. L'interpolation
    (trilinéaire, linéaire en 1D) est linéaire en ses valeurs et rend
    l'identité exacte : lire cette LUT = mêler l'image et l'image passée
    par la LUT, ce que fait l'aperçu (mix dans le shader)."""
    n, v = lut["size"], lut["values"]
    out = []
    if lut["kind"] == "3d":
        for b in range(n):
            for g in range(n):
                for r in range(n):
                    i = 3 * (r + g * n + b * n * n)
                    for ch, x in enumerate((r, g, b)):
                        out.append((1 - k) * x / (n - 1) + k * v[i + ch])
    else:
        for i in range(n):
            for ch in range(3):
                out.append((1 - k) * i / (n - 1) + k * v[3 * i + ch])
    return {**lut, "values": out}


def lut_meta(lid: str) -> dict | None:
    if not LUT_ID.fullmatch(lid or ""):
        return None
    f = _luts_dir() / f"{lid}.json"
    if not f.exists():
        return None
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except ValueError:
        return None


def _lut_public(m: dict) -> dict:
    return {**m, "url": f"api/montage/luts/{m['id']}/cube", "input_label": LUT_INPUTS.get(m.get("input"), "non documenté")}


def create_lut(data: bytes, name: str, title: str = "", inp: str = "inconnu", source: str = "") -> dict:
    ext = Path(name or "").suffix.lower()
    if ext == ".png":
        lut = parse_hald(data)
    elif ext in (".cube", ""):
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError as e:
            raise ValueError("un .cube est un fichier texte (UTF-8)") from e
        lut = parse_cube(text)
    else:
        raise ValueError(f"{ext} : attendu un .cube (ou une HaldCLUT .png)")
    lid = f"lut-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"
    title = " ".join((title or lut["title"] or Path(name).stem or "LUT").split())[:80]
    d = _luts_dir()
    (d / f"{lid}.cube").write_text(cube_text(lut, title), encoding="utf-8")
    meta = {"id": lid, "title": title, "kind": lut["kind"], "size": lut["size"],
            "input": inp if inp in LUT_INPUTS else "inconnu", "source": str(source or name)[:200],
            "created": library.now(), "owner": auth.current_id()}
    (d / f"{lid}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    return meta


def read_lut(lid: str) -> dict:
    return parse_cube((_luts_dir() / f"{lid}.cube").read_text(encoding="utf-8"))


def lut_key(c: dict) -> str | None:
    lut = c.get("lut")
    return f"{lut['id']}@{round(lut['mix'] * 1000)}" if lut and lut.get("mix", 0) > 0 else None


def prepare_luts(p: dict, workdir: str, write: bool = True) -> dict[str, dict]:
    """Les fichiers de LUT dont l'export a besoin, par `lut_key` : la LUT
    rangée à 100 %, sinon une copie mêlée à son intensité dans le dossier
    du travail. Une LUT absente n'y est pas (l'export le dira)."""
    out = {}
    for c in p["clips"]:
        key = lut_key(c)
        if not key or key in out:
            continue
        m = lut_meta(c["lut"]["id"])
        if not m:
            continue
        mix = round(c["lut"]["mix"] * 1000)
        path = _luts_dir() / f"{m['id']}.cube"
        if mix < 1000:
            path = Path(workdir) / f"{m['id']}-{mix:04d}.cube"
            if write:
                path.write_text(cube_text(mixed(read_lut(m["id"]), mix / 1000), m["title"]), encoding="utf-8")
        out[key] = {"path": str(path), "kind": m["kind"], "title": m["title"]}
    return out


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


def _lut_filter(info: dict) -> list[str]:
    if not SAFE_PATH.fullmatch(info["path"]):
        raise ValueError(f"chemin de LUT inattendu : {info['path']}")
    # en flottants : le chemin 8 bits de lut3d tronque au lieu d'arrondir (vf_lut3d.c, av_clip_uint8)
    if info["kind"] == "1d":
        return ["format=gbrpf32le", f"lut1d=file='{info['path']}':interp=linear"]
    return ["format=gbrpf32le", f"lut3d=file='{info['path']}':interp=trilinear"]


def _atempo(speed: float) -> list[str]:
    """atempo prend 0,5 à 100 (ffmpeg 6.1, -h filter=atempo) : en dessous, on enchaîne."""
    out, s = [], speed
    while s < 0.5 - 1e-9:
        out.append("atempo=0.5")
        s /= 0.5
    if abs(s - 1) > 1e-6:
        out.append(f"atempo={_f(s)}")
    return out


def _check(p: dict, media: dict[str, dict], luts: dict | None = None, rng=None) -> int:
    total = project_end(p)
    if total <= 0:
        raise ValueError("le montage est vide : posez au moins un plan sur la timeline")
    bad = overlaps(p)
    if bad:
        raise ValueError("des plans se chevauchent : " + " ; ".join(bad[:6]))
    live = [c for c in p["clips"] if c.get("enabled", True)]
    missing = sorted({c["item"] for c in live if c["item"] not in media})
    if missing:
        raise ValueError("objets absents de la bibliothèque (à la corbeille ?) : " + ", ".join(missing[:8]))
    if luts is not None:
        gone = sorted({c["lut"]["id"] for c in live if lut_key(c) and lut_key(c) not in luts})
        if gone:
            raise ValueError("LUT introuvables (supprimées ?) : " + ", ".join(gone[:8]))
    if rng and not (0 <= rng[0] < rng[1]):
        raise ValueError("la plage d'export est vide : posez une entrée avant la sortie")
    return total


def _shift(frames: int, fps: int) -> str:
    return f"{'+' if frames >= 0 else '-'}{abs(frames)}/({fps}*TB)"


def _open(c: dict, m: dict, fps: int, a: int, b: int, video: bool = True) -> tuple[list[str], int]:
    """L'entrée ffmpeg qui lit le plan `c` pour les images [a, b) de la
    timeline ; rend (arguments, images de tête figées). Avant le début de
    la source (tête d'un fondu enchaîné), sa première image se fige ; après
    sa fin, la dernière (`tpad` clone, dans le graphe). La vitesse change
    combien de source on lit."""
    nf = b - a
    if m["kind"] == "image":
        return ["-loop", "1", "-framerate", str(fps), "-t", _f(nf / fps + 2 / fps), "-i", m["path"]], 0
    sp = c.get("speed", 1.0) or 1.0
    src = c["in"] + (a - c["start"]) / fps * sp
    pre = 0
    if src < 0:
        pre = min(nf, round(-src / sp * fps))
        src = 0.0
    length = ((nf - pre) / fps + 2 / fps) * sp
    D = m.get("duration") or 0
    if D:
        if src >= D - 0.5 / fps:          # tout ce morceau est au-delà de la source : sa dernière image
            src = max(0.0, D - 1 / fps)
        length = min(length, D - src + 1 / fps)
    # L'image que montre le navigateur à l'instant `src` est celle qui le
    # contient (elle a commencé avant) ; `-ss` exact garde la première image
    # qui commence à `src` ou après. Entre deux images de la source (une
    # entrée à 0,5 s en 25 i/s), les deux différaient d'une image (mesuré le
    # 29/09 sur une mire animée : 4,9 d'écart moyen, 1 une fois recalé). On
    # recule donc au début de l'image qui contient `src`, moins un quart
    # d'image pour ne pas la perdre à l'arrondi des horodatages.
    # (l'image seulement : le son, lui, part à l'échantillon près)
    F = m.get("fps") or 0
    if video and F and m["kind"] == "video" and src > 0:
        src = max(0.0, (math.floor(src * F + 1e-6) - 0.25) / F)
    return (["-ss", _f(src)] if src > 0 else []) + ["-t", _f(max(length, 1 / fps)), "-i", m["path"]], pre


def _head() -> list[str]:
    return ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-v", "error", "-progress", "pipe:1", "-nostats"]


# la sortie : BT.709 écrit et annoncé (VUI de H.264) — sans étiquette, Chromium
# choisit la matrice d'après la hauteur de l'image (mesuré, voir l'étude)
OUT_COLOR = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]


def _to_rgb(m: dict) -> str:
    """Les réglages de `scale` qui passent la source en RVB comme le
    navigateur la montre : sa matrice et sa plage (media_of les relit)."""
    if m["kind"] == "image":
        return ""                       # PNG en RVB ; un JPEG porte sa matrice (ffmpeg la lit)
    return f":in_color_matrix={m.get('matrix') or 'bt709'}:in_range={m.get('range') or 'limited'}"


def plan_video(p: dict, media: dict[str, dict], f0: int, f1: int, out_path: str, preset: str = "medium",
               luts: dict | None = None) -> dict:
    """Une passe d'image : les images [f0, f1) du montage, sans son."""
    fps = p["settings"]["fps"]
    W, H = p["settings"]["width"], p["settings"]["height"]
    luts = luts or {}
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
            if not c.get("enabled", True):
                continue
            w = win[c["id"]]
            a, b = max(w["ws"], f0), min(w["we"], f1)
            if a >= b:
                continue
            m = media[c["item"]]
            args, pre = _open(c, m, fps, a, b)
            inputs.append(args)
            k = len(inputs) - 1
            nw = w["we"] - w["ws"]
            sp = c.get("speed", 1.0) or 1.0
            # horodatage relatif au début de la fenêtre du plan : les fondus
            # (en temps) se calculent comme si le plan était rendu d'un bloc
            chain = ["setpts=PTS-STARTPTS" if abs(sp - 1) < 1e-6 or m["kind"] == "image" else f"setpts=(PTS-STARTPTS)/{_f(sp)}",
                     f"fps={fps}",
                     f"scale={W}:{H}:force_original_aspect_ratio=decrease:force_divisible_by=2{_to_rgb(m)}",
                     "format=gbrp", "setsar=1",
                     *_grade(c["grade"])]
            key = lut_key(c)
            if key:
                if key not in luts:
                    raise ValueError(f"LUT introuvable : {c['lut']['id']}")
                chain += _lut_filter(luts[key])
            chain += ["scale=out_color_matrix=bt709:out_range=limited", "format=yuva420p",
                      f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black@0",
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
             "-c:v", "libx264", "-preset", preset, "-crf", "18", "-pix_fmt", "yuv420p", *OUT_COLOR, "-r", str(fps),
             "-frames:v", str(f1 - f0), out_path]
    return {"args": args, "graph": g, "inputs": len(inputs), "items": used, "f0": f0, "f1": f1, "out": out_path}


def plan_mux(p: dict, media: dict[str, dict], list_path: str, out_path: str, rng=None) -> dict:
    """La dernière passe : les tranches d'image recollées sans ré-encodage
    (démuxeur concat, `-c:v copy`) et tout le son, mêlé, coupé à la plage."""
    fps = p["settings"]["fps"]
    r0, r1 = rng or (0, project_end(p))
    T = (r1 - r0) / fps
    full = round(project_end(p) / fps * 48000)
    s0, s1 = round(r0 / fps * 48000), round(r1 / fps * 48000)
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
            m = media.get(c["item"])
            if not c.get("enabled", True) or not m or c["vol"] <= 0 or not m.get("audio") or m["kind"] == "image":
                continue
            if t["kind"] == "video" and not c["audio"]:
                continue
            w = win[c["id"]]
            if w["we"] <= r0 or w["ws"] >= r1:
                continue
            args, pre = _open(c, m, fps, w["ws"], w["we"], video=False)
            inputs.append(args)
            k = len(inputs) - 1
            nf = w["we"] - w["ws"]
            chain = ["asetpts=PTS-STARTPTS", "aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo",
                     *_atempo(c.get("speed", 1.0) or 1.0)]
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
    tail = f"apad=whole_len={full},atrim=start_sample={s0}:end_sample={s1},asetpts=PTS-STARTPTS"
    if not audio_labels:
        graph.append(f"anullsrc=r=48000:cl=stereo,apad=whole_len={s1 - s0},atrim=end_sample={s1 - s0}[aout]")
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
         chunk_s: float = CHUNK_S, workdir: str = ".", luts: dict | None = None, rng=None) -> dict:
    """Toutes les commandes d'un export : les passes d'image, puis
    l'assemblage avec le son.

    `media` : {id d'objet: {"path", "kind", "duration" (s, None pour une
    image), "audio" (la source a un son), "matrix", "range"}}. `luts` :
    {lut_key: {"path", "kind"}} (prepare_luts). `rng` : (première image,
    image de fin) de la plage à rendre, tout le montage sinon. Rend
    {"chunks", "mux", "list_path", "list", "graph", "duration", "frames",
    "inputs", "items"}. Lève ValueError en français si le montage ne peut
    pas se rendre."""
    total = _check(p, media, luts if luts is not None else {}, rng)
    fps = p["settings"]["fps"]
    r0, r1 = rng or (0, total)
    step = max(1, round(chunk_s * fps))
    bounds = list(range(r0, r1, step)) + [r1]
    chunks = [plan_video(p, media, f0, f1, f"{workdir}/passe-{i:04d}.mp4", preset, luts)
              for i, (f0, f1) in enumerate(zip(bounds, bounds[1:]))]
    list_path = f"{workdir}/passes.txt"
    mux = plan_mux(p, media, list_path, out_path, (r0, r1))
    used = [i for ch in chunks for i in ch["items"]] + mux["items"]
    return {"chunks": chunks, "mux": mux, "list_path": list_path,
            "list": "".join(f"file '{ch['out']}'\n" for ch in chunks),
            "graph": "\n".join([ch["graph"] for ch in chunks] + [mux["graph"]]),
            "duration": (r1 - r0) / fps, "frames": r1 - r0,
            "inputs": max([ch["inputs"] for ch in chunks] + [mux["inputs"]]),
            "items": list(dict.fromkeys(used))}


MATRIX = {"bt709": "bt709", "smpte170m": "bt601", "bt470bg": "bt601", "bt2020nc": "bt2020", "bt2020c": "bt2020",
          "smpte240m": "smpte240m", "fcc": "fcc"}


def _video_color(path: Path) -> dict:
    """La matrice et la plage avec lesquelles le navigateur décode cette
    vidéo : son étiquette, sinon — mesuré dans Chromium le 29/09 (étude
    montage) — BT.709 à partir de 720 lignes, BT.601 en dessous ; plage
    limitée sauf étiquette « pc » ou format yuvj."""
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                            "stream=color_space,color_range,height,pix_fmt", "-of", "json", str(path)],
                           capture_output=True, text=True, timeout=30)
        s = (json.loads(r.stdout or "{}").get("streams") or [{}])[0]
    except (OSError, ValueError, subprocess.SubprocessError):
        s = {}
    h = int(s.get("height") or 0)
    matrix = MATRIX.get(s.get("color_space") or "", "bt709" if h >= 720 else "bt601")
    full = s.get("color_range") == "pc" or str(s.get("pix_fmt", "")).startswith("yuvj")
    return {"matrix": matrix, "range": "full" if full else "limited"}


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
                    "audio": bool(it.get("audio")) or it["kind"] == "audio", "title": it.get("title", ""),
                    "fps": it.get("fps") or 0}
        if it["kind"] == "video":
            out[iid].update(_video_color(path))
    return out


def export_range(p: dict, want: bool) -> tuple[int, int] | None:
    """La plage d'export : l'entrée et la sortie de séquence si on les
    demande (une seule posée : jusqu'à la fin, ou depuis le début)."""
    if not want:
        return None
    r = p.get("range") or {}
    a = r.get("in") if r.get("in") is not None else 0
    b = r.get("out") if r.get("out") is not None else project_end(p)
    return (a, min(b, project_end(p)))


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
    rng = export_range(p, bool(ctx.params.get("range")))
    ctx.progress(0.0, "prépare les passes")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", p["name"])[:60] or "montage"
    out = ctx.workdir / f"{safe}.mp4"
    try:
        luts = prepare_luts(p, str(ctx.workdir))
        pl = plan(p, media_of(p), str(out), preset, chunk_s, str(ctx.workdir), luts, rng)
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
    snap = {k: p[k] for k in ("id", "name", "settings", "tracks", "clips", "markers", "range", "rev") if k in p}
    it = ctx.add(out, kind="video", title=p["name"] + (" (entrée → sortie)" if rng else ""),
                 params={"montage": p["id"], "rev": p.get("rev"), "project": snap, "preset": preset,
                         "range": list(rng) if rng else None},
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
            "still": STILL_DEFAULT, "tracks": TRACKS_DEFAULT, "neutral_k": NEUTRAL_K,
            "max_tracks": MAX_TRACKS, "speed": [SPEED_MIN, SPEED_MAX],
            "lut_inputs": [{"id": k, "label": v} for k, v in LUT_INPUTS.items()]}


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
    `steps` = chaque passe d'image puis l'assemblage. `?range=1` : bornées
    à l'entrée et à la sortie de séquence."""
    p = normalize(load(pid))
    try:
        pl = plan(p, media_of(p), "sortie.mp4", luts=prepare_luts(p, "travail", write=False),
                  rng=export_range(p, req.q("range") == "1"))
    except ValueError as e:
        raise HttpError(409, str(e)) from e
    return {"steps": [c["args"] for c in pl["chunks"]] + [pl["mux"]["args"]],
            **{k: pl[k] for k in ("graph", "duration", "frames", "inputs", "items")}}


# les LUT : une bibliothèque commune, rangée dans les données (pas dans le dépôt)
def r_luts(req):
    out = []
    for f in _luts_dir().glob("lut-*.json"):
        m = lut_meta(f.stem)
        if m and (_luts_dir() / f"{m['id']}.cube").exists():
            out.append(_lut_public(m))
    out.sort(key=lambda m: m["title"].lower())
    return {"luts": out, "inputs": [{"id": k, "label": v} for k, v in LUT_INPUTS.items()]}


def r_lut_upload(req):
    name = req.q("name", "lut.cube")
    data = req.body()
    if not data:
        raise HttpError(400, "fichier vide")
    if len(data) > 40 * 1024 * 1024:
        raise HttpError(413, "LUT trop grosse (40 Mo au plus)")
    try:
        with _lock:
            m = create_lut(data, name, req.q("title"), req.q("input", "inconnu"), req.q("source"))
    except ValueError as e:
        raise HttpError(400, f"{name} : {e}") from e
    return _lut_public(m)


def _lut_or_404(lid: str) -> dict:
    m = lut_meta(lid)
    if not m:
        raise HttpError(404, f"LUT introuvable : {lid}")
    return m


def _can_edit_lut(m: dict) -> None:
    u = auth.current()
    if m.get("owner") and u and m["owner"] != u.get("id") and not auth.is_admin(u):
        raise HttpError(403, "cette LUT est à quelqu'un d'autre : seul son auteur (ou Cal) la change")


def r_lut_file(req, lid):
    _lut_or_404(lid)
    return FileResponse(_luts_dir() / f"{lid}.cube", "text/plain; charset=utf-8", cache="max-age=86400")


def r_lut_edit(req, lid):
    d = req.json()
    with _lock:
        m = _lut_or_404(lid)
        _can_edit_lut(m)
        if "title" in d:
            t = " ".join(str(d.get("title") or "").split())[:80]
            if not t:
                raise HttpError(400, "un nom, s'il vous plaît")
            m["title"] = t
        if d.get("input") in LUT_INPUTS:
            m["input"] = d["input"]
        (_luts_dir() / f"{lid}.json").write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
    return _lut_public(m)


def r_lut_delete(req, lid):
    with _lock:
        m = _lut_or_404(lid)
        _can_edit_lut(m)
        trash = _luts_dir() / "corbeille"
        trash.mkdir(exist_ok=True)
        for ext in (".cube", ".json"):
            f = _luts_dir() / f"{lid}{ext}"
            if f.exists():
                shutil.move(str(f), str(trash / f.name))
    return {"ok": True}


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
    app.route("GET", "/api/montage/luts", r_luts)
    app.route("PUT", "/api/montage/luts", r_lut_upload)
    app.route("GET", "/api/montage/luts/{lid}/cube", r_lut_file)
    app.route("POST", "/api/montage/luts/{lid}", r_lut_edit)
    app.route("POST", "/api/montage/luts/{lid}/delete", r_lut_delete)


# ── le contrôle (tools/check.py) ─────────────────────────────
def _probe(path: str) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-print_format", "json", "-show_format",
                        "-show_streams", path], capture_output=True, text=True, timeout=60)
    return json.loads(r.stdout or "{}")


def _pixel(path: str, frame: int, where: str = "center") -> tuple[int, int, int]:
    """La couleur moyenne d'un carré de 16 px d'une image de la vidéo :
    au centre, ou au bord gauche (`left`). La matrice de décodage est celle
    que la vidéo annonce (BT.709 pour nos exports)."""
    crop = "crop=16:16" if where == "center" else "crop=16:16:0:(ih-16)/2"
    r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-vf", f"select=eq(n\\,{frame}),{crop},scale=1:1",
                        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, timeout=60)
    b = r.stdout[:3]
    return tuple(b) if len(b) == 3 else (-1, -1, -1)


def _test_cube(n: int, fn) -> str:
    lines = ['TITLE "essai"', "# une LUT d'essai", f"LUT_3D_SIZE {n}"]
    for b in range(n):
        for g in range(n):
            for r in range(n):
                lines.append(" ".join(f"{x:.6f}" for x in fn(r / (n - 1), g / (n - 1), b / (n - 1))))
    return "\n".join(lines) + "\n"


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

    # 1 bis. un projet d'avant (29/09 matin) se relit sans perte ; les pistes, les dossiers, les marques
    old = {"id": pid, "name": "ancien", "settings": {"format": "scope", "fps": 24, "width": 1920, "height": 804, "still": 5.0},
           "tracks": [{"id": t, "kind": "video" if t[0] == "V" else "audio", "mute": t == "A2", "solo": False, "lock": False,
                       "hide": False} for t in TRACKS_DEFAULT],
           "clips": [{"id": "a", "track": "V1", "item": "vid-20260928-000000-aaaa", "kind": "video", "title": "A", "start": 10,
                      "dur": 48, "in": 1.5, "src_dur": 5, "vol": 0.7, "fade_in": 3, "fade_out": 0, "xfade": 0, "audio": True,
                      "grade": {"exposure": 0.5, "contrast": 0, "saturation": 0, "temperature": 6500}}],
           "created": "x", "updated": "y", "rev": 7}
    mig = normalize(old)
    c0 = mig["clips"][0]
    ok(all(c0[k] == old["clips"][0][k] for k in ("id", "track", "item", "start", "dur", "in", "vol", "fade_in", "audio"))
       and c0["speed"] == 1.0 and c0["enabled"] is True and c0["lut"] is None and mig["markers"] == []
       and mig["range"] == {"in": None, "out": None} and mig["bins"] == {"folders": [], "items": {}, "hidden": []}
       and mig["tracks"][4]["mute"] is True and mig["rev"] == 7 and normalize(mig) == mig,
       f"montage : un projet d'avant se relit sans perte, les champs neufs à leur défaut ({c0})")
    five = normalize({**old, "tracks": [{"id": f"V{i}"} for i in (5, 4, 3, 2, 1)] + [{"id": "A1", "name": "  voix  off "}]})
    ok([t["id"] for t in five["tracks"]] == ["V5", "V4", "V3", "V2", "V1", "A1"] and five["tracks"][5]["name"] == "voix off",
       "montage : cinq pistes vidéo, une piste son nommée")
    odd = normalize({**old, "tracks": [{"id": "V1"}, {"id": "V2"}, {"id": "A1"}]})
    ok([t["id"] for t in odd["tracks"]] == ["V2", "V1", "A1"] and odd["clips"][0]["track"] == "V2",
       "montage : des pistes mal nommées sont renommées par leur place, les plans suivent")
    try:
        normalize({**old, "tracks": [{"id": "V21"}]})
        ok(False, "montage : V21 doit être refusée")
    except HttpError:
        ok(True, "montage : pas plus de 20 pistes d'une sorte")
    bins = normalize({**old, "bins": {"folders": [{"id": "fa", "name": "Plans", "parent": "fb"}, {"id": "fb", "name": "B", "parent": "fa"},
                                                  {"id": "fc", "name": " Sous  dossier ", "parent": "fa"}, {"id": "bad id", "name": "x"}],
                                      "items": {"vid-20260928-000000-aaaa": "fc", "vid-20260928-000000-bbbb": "fz"},
                                      "hidden": ["ima-20260928-000000-cccc", "nimporte"]},
                           "markers": [{"id": "m1", "f": 50, "name": "  refrain "}, {"id": "m0", "f": 10}],
                           "range": {"in": 20, "out": 10}})["bins"]
    ok([f["id"] for f in bins["folders"]] == ["fa", "fb", "fc"] and sum(1 for f in bins["folders"] if f["parent"] is None) >= 1
       and bins["folders"][2] == {"id": "fc", "name": "Sous dossier", "parent": "fa"}
       and bins["items"] == {"vid-20260928-000000-aaaa": "fc"} and bins["hidden"] == ["ima-20260928-000000-cccc"],
       f"montage : les dossiers du chutier (une boucle est rompue, l'inconnu tombe) ({bins})")
    mk = normalize({**old, "markers": [{"id": "m1", "f": 50, "name": "  refrain "}, {"id": "m0", "f": 10}], "range": {"in": 20, "out": 10}})
    ok([m["f"] for m in mk["markers"]] == [10, 50] and mk["markers"][1]["name"] == "refrain" and mk["range"] == {"in": 20, "out": None},
       "montage : les marques triées, une sortie avant l'entrée tombe")

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
    med = {"vid-20260928-000000-aaaa": {"path": "/a.mp4", "kind": "video", "duration": 2.0, "audio": True, "matrix": "bt601", "range": "limited", "fps": 25},
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
    ok("in_color_matrix=bt601:in_range=limited,format=gbrp" in g and "scale=out_color_matrix=bt709:out_range=limited,format=yuva420p" in g
       and "-colorspace" in pl["chunks"][0]["args"] and "bt709" in pl["chunks"][0]["args"],
       "montage : chaque plan passe en RVB avec la matrice de sa source, repart en BT.709 étiqueté")
    half = plan(normalize({**fake, "clips": [{**fake["clips"][0], "in": 0.5}]}), med, "/o.mp4")
    va, aa = half["chunks"][0]["args"], half["mux"]["args"]
    ok(va[va.index("-ss") + 1] == "0.47" and aa[aa.index("-ss") + 1] == "0.5",
       "montage : une entrée entre deux images de la source (0,5 s en 25 i/s) : l'image est celle que montre le navigateur (-ss 0,47), le son part à 0,5 s")
    ok("volume=0.5" in g and "amix=inputs=2" in g and "normalize=0" in g, "montage : le son (vidéo A + musique) est mêlé sans renormaliser")
    ok(g.index("[vb]") > g.index("[va]") and g.index("[vt]") > g.index("[vb]"), "montage : V1 dessous, V2 dessus")
    # vitesse, plan désactivé, plage
    sp = normalize({**fake, "clips": [{**fake["clips"][0], "speed": 2.0}, {**fake["clips"][1], "enabled": False}, fake["clips"][3]]})
    gs = plan(sp, med, "/o.mp4")["graph"]
    ok("setpts=(PTS-STARTPTS)/2" in gs and "atempo=2" in gs and "[vb]" not in gs, "montage : vitesse ×2 (image et son), un plan désactivé ne sort pas")
    slow = normalize({**fake, "clips": [{**fake["clips"][0], "speed": 0.2}]})
    ok("atempo=0.5,atempo=0.5,atempo=0.8" in plan(slow, med, "/o.mp4")["graph"], "montage : ralenti à 20 % : atempo enchaîné (0,5 × 0,5 × 0,8)")
    pr = plan(fp, med, "/o.mp4", rng=(20, 70), chunk_s=1.0)
    ok(pr["frames"] == 50 and pr["chunks"][0]["f0"] == 20 and pr["chunks"][-1]["f1"] == 70
       and "atrim=start_sample=38400:end_sample=134400" in pr["mux"]["graph"] and pr["mux"]["args"][-2] == "2",
       "montage : export borné à l'entrée et à la sortie (images 20 à 70, le son suit)")
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
    try:
        plan(normalize({**fake, "clips": [{**fake["clips"][0], "lut": {"id": "lut-20260929-000000-abcd", "mix": 1}}]}), med, "/o.mp4", luts={})
        ok(False, "montage : une LUT absente doit être refusée")
    except ValueError as e:
        ok("LUT introuvables" in str(e), f"montage : une LUT absente est refusée en la nommant ({e})")

    # 2 bis. les LUT : lecture de la spécification, forme unique, intensité
    ident = _test_cube(3, lambda r, g, b: (r, g, b))
    ok(parse_cube(ident)["size"] == 3 and len(parse_cube(ident)["values"]) == 81, "montage : un .cube 3D se lit")
    for bad_txt, why in ((ident.replace("LUT_3D_SIZE 3", "LUT_3D_SIZE 4"), "lignes"),
                         ("LUT_3D_SIZE 2\nDOMAIN_MIN -0.1 0 0\n" + "0 0 0\n" * 8, "domaine"),
                         ("LUT_1D_SIZE 2\nLUT_3D_SIZE 2\n", "1D et 3D"), ("bonjour\n", "ni LUT_3D_SIZE")):
        try:
            parse_cube(bad_txt)
            ok(False, f"montage : un .cube faux doit être refusé ({why})")
        except ValueError as e:
            ok(why in str(e), f"montage : un .cube faux est refusé ({why} : {e})")
    oned = parse_cube("TITLE \"g\"\nLUT_1D_SIZE 3\n0 0 0\n0.25 0.25 0.25\n1 1 1\n")
    ok(oned["kind"] == "1d" and oned["size"] == 3, "montage : un .cube 1D se lit")
    half = mixed(parse_cube(_test_cube(2, lambda r, g, b: (1 - r, 1 - g, 1 - b))), 0.5)
    ok(all(abs(v - 0.5) < 1e-9 for v in half["values"]), "montage : l'inversion à 50 % donne un gris moyen partout (identité mêlée)")

    st, bad = call("PUT", "/api/montage/luts?name=faux.cube", raw=b"LUT_3D_SIZE 2\n0 0 0\n")
    ok(st == 400 and "attendues" in bad.get("error", ""), f"montage : une LUT fausse est refusée à l'import ({st} {bad})")
    inv = _test_cube(17, lambda r, g, b: (1 - r, 1 - g, 1 - b))
    st, lut = call("PUT", "/api/montage/luts?name=Inversion.cube&input=rec709&title=Inversion", raw=inv.encode())
    ok(st == 200 and LUT_ID.fullmatch(lut.get("id", "")) and lut["size"] == 17 and lut["input"] == "rec709",
       f"montage : importer une LUT ({st} {str(lut)[:160]})")
    st, got = call("GET", f"/api/montage/luts/{lut.get('id')}/cube")
    txt = got.decode() if isinstance(got, bytes) else str(got)
    ok(st == 200 and txt.startswith('TITLE "Inversion"\nLUT_3D_SIZE 17\n') and "# une LUT" not in txt and txt.count("\n") == 17 ** 3 + 2,
       "montage : la LUT est rangée sous sa forme unique (TITLE, taille, valeurs)")
    from io import BytesIO
    from PIL import Image
    hald = Image.new("RGB", (8, 8))
    hald.putdata([(round(255 * (i % 4) / 3), round(255 * (i // 4 % 4) / 3), round(255 * (i // 16) / 3)) for i in range(64)])
    buf = BytesIO()
    hald.save(buf, "PNG")
    st, hl = call("PUT", "/api/montage/luts?name=hald.png", raw=buf.getvalue())
    ok(st == 200 and hl.get("size") == 4 and hl.get("kind") == "3d", f"montage : une HaldCLUT PNG (niveau 2) devient une LUT 3D de 4 points ({st} {hl})")
    st, ls = call("GET", "/api/montage/luts")
    ok(st == 200 and {lut.get("id"), hl.get("id")} <= {x["id"] for x in ls["luts"]}, "montage : la liste des LUT")
    st, _ = call("POST", f"/api/montage/luts/{hl.get('id')}/delete")
    st, ls = call("GET", "/api/montage/luts")
    ok(hl.get("id") not in {x["id"] for x in ls["luts"]}, "montage : une LUT supprimée part à sa corbeille")

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
    # un plan qui change de couleur chaque seconde (rouge, vert, bleu), étiqueté BT.709, en 1280×720
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "color=c=0xDC2828:s=1280x720:r=25:d=1",
                    "-f", "lavfi", "-i", "color=c=0x28C83C:s=1280x720:r=25:d=1", "-f", "lavfi", "-i", "color=c=0x283CDC:s=1280x720:r=25:d=1",
                    "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
                    "-c:v", "libx264", "-crf", "4", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                    str(tmp / "rvb.mp4")], check=True, timeout=60)
    for name in ("rouge.mp4", "bleu.mp4", "blanc.png", "note.wav", "rvb.mp4"):
        st, it = call("PUT", f"/api/library/upload?name={name}&title={name.split('.')[0]}", raw=(tmp / name).read_bytes())
        made[name] = it
    ok(all(isinstance(v, dict) and v.get("id") for v in made.values()), "montage : sources d'essai dans la bibliothèque")
    ok(made["rouge.mp4"].get("audio") is True, "montage : la bibliothèque sait qu'une vidéo a du son")
    r, b, im, snd, rvb = (made[k] for k in ("rouge.mp4", "bleu.mp4", "blanc.png", "note.wav", "rvb.mp4"))
    clips = [
        {"id": "r", "track": "V1", "item": r["id"], "kind": "video", "start": 0, "dur": 50, "in": 0.5, "src_dur": 3, "audio": True},
        {"id": "b", "track": "V1", "item": b["id"], "kind": "video", "start": 50, "dur": 50, "in": 0, "src_dur": 3, "audio": True, "xfade": 10},
        {"id": "w", "track": "V2", "item": im["id"], "kind": "image", "start": 75, "dur": 10},
        {"id": "s", "track": "A1", "item": snd["id"], "kind": "audio", "start": 0, "dur": 100, "in": 0, "src_dur": 5, "vol": 0.8, "fade_out": 25},
    ]
    st, sv = call("POST", f"/api/montage/projects/{pid}", {**p, "base_rev": p["rev"], "settings": {"format": "720p", "fps": 25}, "clips": clips})
    ok(st == 200 and sv["rev"] == p["rev"] + 1 and not sv["warnings"], f"montage : enregistrer ({st} {sv})")
    rev = sv.get("rev")
    st, stale = call("POST", f"/api/montage/projects/{pid}", {**p, "base_rev": p["rev"], "clips": []})
    ok(st == 409, "montage : une version dépassée ne l'écrase pas")
    st, pl = call("GET", f"/api/montage/projects/{pid}/plan")
    ok(st == 200 and pl["frames"] == 100, f"montage : la commande d'export ({st})")

    def export(params, what):
        st, j = call("POST", "/api/jobs", {"kind": "montage.export", "params": {"project": pid, "draft": True, **params}, "title": "essai"})
        ok(st == 200, f"montage : l'export part en file ({what})")
        for _ in range(300):
            st, j = call("GET", f"/api/jobs/{j['id']}")
            if j["state"] in ("done", "error", "cancelled"):
                break
            time.sleep(0.4)
        ok(j["state"] == "done" and len(j["items"]) == 1, f"montage : l'export se termine ({what} : {j['state']} {j.get('message')} {j.get('result')})")
        return j

    # passes de 2 s : la coupure entre passes tombe à l'image 50, au milieu du fondu enchaîné
    j = export({"chunk": 2.0}, "fondu, deux passes")
    if j["state"] != "done" or not j["items"]:
        return
    ok(j["result"].get("passes") == 2, "montage : deux passes")
    out = j["items"][0]
    ok(out["kind"] == "video" and out["params"]["montage"] == pid and set(out["parents"]) == {r["id"], b["id"], im["id"], snd["id"]},
       "montage : la vidéo rangée garde sa lignée et son montage")
    path = str(library.path_of(library.get(out["id"])))
    info = _probe(path)
    vs = [s for s in info.get("streams", []) if s["codec_type"] == "video"]
    au = [s for s in info.get("streams", []) if s["codec_type"] == "audio"]
    ok(vs and vs[0]["codec_name"] == "h264" and vs[0]["width"] == 1280 and vs[0]["height"] == 720,
       f"montage : H.264 1280×720 ({vs[:1]})")
    ok(vs and vs[0].get("color_space") == "bt709" and vs[0].get("color_transfer") == "bt709",
       f"montage : la sortie annonce BT.709 ({vs[0].get('color_space') if vs else '?'})")
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

    # 4. déplacer dessous (slip), vitesse, LUT à 100 % et à 50 %, plage entrée → sortie
    #    rvb.mp4 : rouge (0-1 s), vert (1-2 s), bleu (2-3 s)
    clips2 = [
        {"id": "p1", "track": "V1", "item": rvb["id"], "kind": "video", "start": 0, "dur": 25, "in": 1.0, "src_dur": 3},      # slip : commence au vert
        {"id": "p2", "track": "V1", "item": rvb["id"], "kind": "video", "start": 25, "dur": 25, "in": 0, "src_dur": 3, "speed": 2.0},  # 2 s de source en 1 s
        {"id": "p3", "track": "V1", "item": rvb["id"], "kind": "video", "start": 50, "dur": 25, "in": 0.2, "src_dur": 3,
         "lut": {"id": lut["id"], "mix": 1}},                                                                                   # rouge inversé : cyan
        {"id": "p4", "track": "V1", "item": rvb["id"], "kind": "video", "start": 75, "dur": 25, "in": 0.2, "src_dur": 3,
         "lut": {"id": lut["id"], "mix": 0.5}},                                                                                 # à moitié : gris moyen
    ]
    st, sv = call("POST", f"/api/montage/projects/{pid}", {**p, "base_rev": rev, "settings": {"format": "720p", "fps": 25},
                                                          "clips": clips2, "range": {"in": 25, "out": 100}})
    ok(st == 200, f"montage : enregistrer slip, vitesse, LUT ({st} {sv})")
    j = export({}, "slip, vitesse, LUT")
    if j["state"] == "done" and j["items"]:
        path = str(library.path_of(library.get(j["items"][0]["id"])))
        q = {f: _pixel(path, f) for f in (2, 20, 28, 40, 60, 85)}
        green = lambda c: c[1] > 170 and c[0] < 70 and c[2] < 90     # noqa: E731
        ok(green(q[2]) and green(q[20]), f"montage : slip (entrée à 1 s) : le plan commence au vert ({q[2]} {q[20]})")
        ok(red(q[28]) and green(q[40]), f"montage : vitesse ×2 : 2 s de source en 1 s, rouge puis vert dès la moitié du plan ({q[28]} {q[40]})")
        cy = q[60]
        ok(abs(cy[0] - 35) <= 6 and abs(cy[1] - 215) <= 6 and abs(cy[2] - 215) <= 6,
           f"montage : LUT d'inversion à 100 % : le rouge (220,40,40) devient (35,215,215) ({cy})")
        ok(all(abs(x - 128) <= 4 for x in q[85]), f"montage : la même à 50 % : gris moyen ({q[85]})")
    j = export({"range": True}, "entrée → sortie")
    if j["state"] == "done" and j["items"]:
        path = str(library.path_of(library.get(j["items"][0]["id"])))
        vs = [s for s in _probe(path).get("streams", []) if s["codec_type"] == "video"]
        ok(vs and int(vs[0].get("nb_read_frames", 0)) == 75 and red(_pixel(path, 3)),
           f"montage : export borné (25 → 100) : 75 images, commence au plan 2 ({vs[0].get('nb_read_frames') if vs else '?'})")
    shutil.rmtree(tmp, ignore_errors=True)
