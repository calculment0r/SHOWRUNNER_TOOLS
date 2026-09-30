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
    en dessous — mesuré dans Chromium le 29/09, voir l'étude), passée par
    sa chaîne d'effets (`chain_of` : les siens, ceux de sa piste, ceux du
    groupe de sa piste — étalonnage `exposure`, `eq`, `colortemperature` ;
    LUT `lut3d` trilinéaire ou `lut1d` linéaire, en flottants), remise en YUV BT.709,
    prolongée en figeant sa première ou dernière image quand un fondu
    enchaîné demande plus que la source n'a (`tpad` clone), coupée au
    nombre d'images exact (`trim=end_frame`), fondue en transparence
    (`fade … alpha=1`, en temps : un fondu à cheval sur deux passes reste
    continu), puis décalée à sa place (`setpts=PTS+…`) et posée sur ce qui
    est dessous (`overlay=eof_action=pass`) ; V1 d'abord, la plus haute
    en dernier, donc au-dessus. Un calque d'effet (piste X, plan `adjust`)
    dédouble l'image composée jusque-là (`split`), en passe une branche par
    ses effets sur sa durée et la repose dessus. La sortie est étiquetée
    BT.709 : tout lecteur la décode comme elle a été écrite ;
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
FPS = (16, 24, 25, 30, 50, 60)   # des images entières par seconde (le modèle compte en images) ; 16 : Wan 2.x
FPS_CHOICE = (24, 25, 30)        # ce que l'inspecteur propose ; les autres viennent d'un clip (« à partir de l'élément »)
SIZE_MIN, SIZE_MAX = 16, 8192    # un format « sur mesure » (la taille d'un clip), en px pairs
STILL_DEFAULT = 5.0          # durée d'une image fixe posée, en secondes
TRACKS_DEFAULT = ["V3", "V2", "V1", "A1", "A2", "A3"]   # de haut en bas, comme à l'écran
MAX_TRACKS = 20              # par sorte (vidéo, son) ; la page borne pareil (model.js)
MAX_CLIPS = 3000
NEUTRAL_K = 6500             # colortemperature : défaut de ffmpeg ; on ne pose le filtre qu'en s'en écartant
CHUNK_S = 8.0                # secondes d'image par passe d'export (mémoire bornée)
SPEED_MIN, SPEED_MAX = 0.1, 10.0

PID = re.compile(r"(?:seq|mon)-\d{8}-\d{6}-[0-9a-f]{4}")    # une séquence ; « mon- » : un montage d'avant le 29/09 au soir
SID = re.compile(r"seq-\d{8}-\d{6}-[0-9a-f]{4}")
SEQ_FILE = "sequence.json"
CID = re.compile(r"[A-Za-z0-9_-]{1,40}")
TID = re.compile(r"[VAX](?:[1-9]|1[0-9]|20)")    # V : vidéo, X : calques d'effet, A : son
FXID = re.compile(r"f[A-Za-z0-9_-]{1,40}")
GID = re.compile(r"g[A-Za-z0-9_-]{1,40}")
MAX_FX = 32                  # effets par plan, piste ou groupe
CURVES = ("tri", "qsin", "hsin", "esin", "log", "exp", "par", "ipar", "qua", "squ")   # afade (ffmpeg -h filter=afade), celles de la page
ITEM = re.compile(r"[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}")
MID = re.compile(r"m[A-Za-z0-9_-]{1,30}")
LUT_ID = re.compile(r"lut-\d{8}-\d{6}-[0-9a-f]{4}")
SAFE_PATH = re.compile(r"[A-Za-z0-9_./@-]+")

_lock = threading.RLock()


# ── les séquences : des objets de la bibliothèque ────────────
# Décision de Cal du 29/09 au soir : le panneau Projet de Premiere, c'est
# Asset. Une séquence est donc un objet de la bibliothèque, de sorte
# `sequence` (id `seq-…`) : sa timeline dans `library/<id>/sequence.json`,
# son titre, son dossier, sa vignette, sa lignée (les plans qu'elle
# emploie) dans son `item.json`, comme tout objet — elle se range, se
# renomme, part à la corbeille et en revient comme les autres, ici et dans
# Asset. Les montages d'avant (`<data_dir>/montage/mon-*.json`) deviennent des
# séquences au démarrage (`migrate`), sans perte : le fichier d'origine est
# gardé dans `montage/migres/`, son identifiant dans `legacy`.
def _dir() -> Path:
    p = config.data_dir() / "montage"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _seq_file(sid: str) -> Path:
    return library.folder_of(sid) / SEQ_FILE


def _legacy_map() -> dict:
    f = _dir() / "migres" / "table.json"
    try:
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    except ValueError:
        return {}


def _resolve(pid: str) -> str:
    """L'identifiant de séquence : un `mon-…` d'avant mène à la séquence qu'il est devenu."""
    if not PID.fullmatch(pid or ""):
        raise HttpError(400, "identifiant de séquence invalide")
    if pid.startswith("mon-"):
        migrate()
        sid = _legacy_map().get(pid)
        if not sid:
            raise HttpError(404, f"montage introuvable : {pid}")
        return sid
    return pid


def _item(sid: str) -> dict:
    it = library.get(sid)
    if not it or it.get("kind") != "sequence" or not library.readable(it):
        raise HttpError(404, f"séquence introuvable : {sid}")
    return it


def load(pid: str) -> dict:
    sid = _resolve(pid)
    _item(sid)
    f = _seq_file(sid)
    if not f.exists():
        raise HttpError(404, f"séquence sans timeline : {sid}")
    return json.loads(f.read_text(encoding="utf-8"))


def _thumb_of(p: dict) -> Path | None:
    """La vignette d'une séquence : celle du premier plan qui se voit."""
    for c in sorted(p["clips"], key=lambda c: (c["track"][0] != "V", c["start"])):
        if c.get("kind") == "adjust" or not c.get("item"):
            continue
        it = library.get(c["item"])
        if it and it["kind"] in ("video", "image") and it.get("thumb"):
            return library.folder_of(it["id"]) / it["thumb"]
        if it and it["kind"] == "image":
            return library.folder_of(it["id"]) / it["file"]
    return None


def _sync_item(p: dict) -> None:
    """item.json suit la timeline : titre, taille, cadence, durée, lignée, vignette."""
    with library._lock:
        it = library._items.get(p["id"])
        if not it:
            return
        st = p["settings"]
        it.update(title=p["name"], updated=library.now(), width=st["width"], height=st["height"], fps=st["fps"],
                  duration=round(project_end(p) / st["fps"], 3),
                  parents=list(dict.fromkeys(c["item"] for c in p["clips"] if c.get("item"))))
        it["params"] = {**(it.get("params") or {}), "format": st["format"], "clips": len(p["clips"])}
        src = _thumb_of(p)
        d = library.folder_of(p["id"])
        if src and src.exists():
            try:
                from PIL import Image
                with Image.open(src) as im:
                    im = im.convert("RGB")
                    im.thumbnail((library.THUMB, library.THUMB))
                    im.save(d / "thumb.jpg", "JPEG", quality=84)
                it["thumb"] = "thumb.jpg"
            except Exception:  # noqa: BLE001 — une vignette ratée n'empêche pas d'enregistrer
                pass
        elif not p["clips"]:
            it.pop("thumb", None)
        library._save(it)


def _write(p: dict) -> None:
    it = _item(p["id"])
    try:
        library._check_write(it)
    except PermissionError as e:
        raise HttpError(403, str(e)) from e
    f = _seq_file(p["id"])
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(f)
    _sync_item(p)


def new_sequence(p: dict, folder: str = "", legacy: str = "") -> dict:
    """Range une timeline (normalisée) comme un objet neuf de la bibliothèque ;
    rend la timeline, avec son identifiant `seq-…`."""
    library.get("")                        # la bibliothèque chargée
    sid = library.new_id("sequence")
    while library.get(sid) or library.folder_of(sid).exists():
        sid = library.new_id("sequence")
    d = library.folder_of(sid)
    d.mkdir(parents=True, exist_ok=True)
    p = {**p, "id": sid}
    if legacy:
        p["legacy"] = legacy
    p.setdefault("created", library.now())
    p.setdefault("updated", library.now())
    p.setdefault("rev", 1)
    (d / SEQ_FILE).write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding="utf-8")
    it = {"id": sid, "kind": "sequence", "title": p["name"], "created": p["created"], "updated": p["updated"],
          "file": SEQ_FILE, "origin": library._owned({"tool": "montage"}), "prompt": "",
          "params": {"legacy": legacy} if legacy else {}, "parents": [], "tags": [],
          "folder": " ".join(str(folder or "").split())[:60].replace("/", "·"), "fav": False}
    with library._lock:
        library._items[sid] = it
        library._save(it)
    _sync_item(p)
    return p


_migrating = threading.Lock()


def migrate() -> list[str]:
    """Les montages d'avant (`montage/mon-*.json`) deviennent des séquences."""
    made = []
    with _migrating:
        old = sorted(_dir().glob("mon-*.json"))
        if not old:
            return made
        dest = _dir() / "migres"
        dest.mkdir(exist_ok=True)
        table = _legacy_map()
        for f in old:
            try:
                p = normalize(json.loads(f.read_text(encoding="utf-8")))
            except (ValueError, HttpError):
                continue
            mid = f.stem
            if mid not in table:
                table[mid] = new_sequence(p, legacy=mid)["id"]
                made.append(table[mid])
            (dest / "table.json").write_text(json.dumps(table, ensure_ascii=False, indent=1), encoding="utf-8")
            shutil.move(str(f), str(dest / f.name))
    return made


def _kind_of(tid: str) -> str:
    return {"V": "video", "X": "fx"}.get(tid[0], "audio")


def _track(tid: str) -> dict:
    return {"id": tid, "kind": _kind_of(tid),
            "mute": False, "solo": False, "lock": False, "hide": False, "name": "", "fx": []}


def blank(name: str, settings: dict | None = None) -> dict:
    p = {"id": None, "name": (name or "Sans titre").strip()[:120] or "Sans titre",
         "created": library.now(), "updated": library.now(), "rev": 1,
         "settings": {"format": "1080p", "fps": 25, "still": STILL_DEFAULT},
         "tracks": [_track(t) for t in TRACKS_DEFAULT],
         "clips": []}
    if settings:
        p["settings"].update({k: v for k, v in settings.items() if k in ("format", "fps", "still", "width", "height")})
    return normalize(p)


def from_item(it: dict) -> dict:
    """« Nouvelle séquence à partir de l'élément » (Premiere, « New Sequence
    From Clip ») : la séquence prend la taille et la cadence du clip, son nom,
    et le clip posé en tête, entier — sa durée est celle du clip. Adobe :
    « This ensures that the sequence settings match those of your footage.
    The new sequence will adopt the clip's name too » (helpx.adobe.com/
    premiere-pro/how-to/arranging-clips-to-sequence.html)."""
    kind = it["kind"]
    if kind not in ("video", "image", "audio"):
        raise HttpError(400, "une séquence se fait à partir d'une vidéo, d'une image ou d'un son")
    fps = it.get("fps") or 0
    near = min(FPS, key=lambda f: abs(f - fps)) if fps else 25
    settings = {"fps": near}
    if kind in ("video", "image") and it.get("width") and it.get("height"):
        w, h = int(it["width"]), int(it["height"])
        preset = next((k for k, f in FORMATS.items() if f["w"] == w and f["h"] == h), None)
        settings.update({"format": preset} if preset else {"format": "custom", "width": w, "height": h})
    p = blank(it.get("title") or "Séquence", settings)
    f = p["settings"]["fps"]
    if kind == "image":
        dur = round(STILL_DEFAULT * f)
    else:
        dur = max(1, math.floor((it.get("duration") or 5) * f + 1e-6))
    clip = {"id": "k" + secrets.token_hex(4), "track": "A1" if kind == "audio" else "V1", "item": it["id"], "kind": kind,
            "title": it.get("title", ""), "start": 0, "dur": dur, "in": 0, "src_dur": 0 if kind == "image" else (it.get("duration") or 0),
            "audio": kind == "audio" or bool(it.get("audio"))}
    p = normalize({**p, "clips": [clip]})
    note = "" if not fps or abs(near - fps) < 1e-3 else f"cadence {fps:g} i/s arrondie à {near} (le montage compte en images entières)"
    return {**p, "note": note}


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


def _fx_list(raw, image: bool = True) -> list[dict]:
    """Une liste d'effets propre (la page : montage/model.js, `newFx`).
    `grade` : exposure (IL), contrast, saturation (−100..100), temperature (K) ;
    `lut` : une LUT de la bibliothèque et son intensité. Un effet d'image
    n'a rien à faire sur le son : `image=False` rend une liste vide."""
    out, ids = [], set()
    if not image or not isinstance(raw, list):
        return out
    for f in raw[:MAX_FX]:
        if not isinstance(f, dict) or f.get("type") not in ("grade", "lut"):
            continue
        fid = str(f.get("id", ""))
        if not FXID.fullmatch(fid) or fid in ids:
            fid = "f" + secrets.token_hex(4)
        ids.add(fid)
        e = {"id": fid, "type": f["type"], "on": f.get("on") is not False}
        if f["type"] == "lut":
            if not LUT_ID.fullmatch(str(f.get("lut", ""))):
                continue
            e.update(lut=str(f["lut"]), mix=round(_num(f.get("mix"), 0, 1, 1.0), 3))
        else:
            e.update(exposure=_num(f.get("exposure"), -2, 2, 0.0), contrast=_num(f.get("contrast"), -100, 100, 0.0),
                     saturation=_num(f.get("saturation"), -100, 100, 0.0),
                     temperature=_num(f.get("temperature"), 2000, 12000, float(NEUTRAL_K)))
        out.append(e)
    return out


def _grade_neutral(g: dict) -> bool:
    return (abs(g.get("exposure", 0)) < 1e-4 and abs(g.get("contrast", 0)) < 1e-4 and abs(g.get("saturation", 0)) < 1e-4
            and abs(g.get("temperature", NEUTRAL_K) - NEUTRAL_K) <= 0.5)


def _tracks(raw: list) -> tuple[list[dict], dict[str, str]]:
    """Les pistes, dans l'ordre de l'écran : l'image (vidéo et calques
    d'effet, mêlés, la plus haute d'abord), puis le son ; renommées par leur
    place si elles ne le sont pas (V1 et X1 en bas, A1 en haut) : rend
    (pistes, ancien nom → nouveau)."""
    tracks, seen = [], set()
    for t in raw or []:
        tid = str((t or {}).get("id", ""))
        if not TID.fullmatch(tid) or tid in seen:
            raise HttpError(400, f"piste invalide ou en double : {tid!r}")
        seen.add(tid)
        kind = _kind_of(tid)
        tr = {"id": tid, "kind": kind, **{k: bool(t.get(k)) for k in ("mute", "solo", "lock", "hide")},
              "name": " ".join(str(t.get("name") or "").split())[:40], "fx": _fx_list(t.get("fx"), kind == "video")}
        if GID.fullmatch(str(t.get("grp") or "")):
            tr["grp"] = t["grp"]
        tracks.append(tr)
    img = [t for t in tracks if t["kind"] != "audio"]
    auds = [t for t in tracks if t["kind"] == "audio"]
    if not any(t["kind"] == "video" for t in img):
        img.append(_track("V1"))
    if not auds:
        auds = [_track("A1")]
    for kind in ("video", "fx", "audio"):
        if sum(t["kind"] == kind for t in img + auds) > MAX_TRACKS:
            raise HttpError(400, f"trop de pistes ({MAX_TRACKS} de chaque sorte au plus)")
    ren = {}
    for kind, pre in (("video", "V"), ("fx", "X")):
        lst = [t for t in img if t["kind"] == kind]
        for i, t in enumerate(lst):
            ren[t["id"]] = f"{pre}{len(lst) - i}"
    for i, t in enumerate(auds):
        ren[t["id"]] = f"A{i + 1}"
    out = [{**t, "id": ren[t["id"]]} for t in img + auds]
    return out, ren


def _groups(raw, tracks: list[dict]) -> list[dict]:
    """Les groupes de pistes : un nom, des effets ; au moins deux membres
    contigus d'une même famille (sinon le groupe se défait, comme dans la page)."""
    by = {}
    for g in (raw if isinstance(raw, list) else [])[:100]:
        if isinstance(g, dict) and GID.fullmatch(str(g.get("id", ""))) and g["id"] not in by:
            by[g["id"]] = g
    fam = lambda t: "audio" if t["kind"] == "audio" else "image"   # noqa: E731
    for i, t in enumerate(tracks):
        gid = t.get("grp")
        if not gid:
            continue
        prev = tracks[i - 1] if i else None
        first = not prev or prev.get("grp") != gid
        # un membre séparé des autres, ou d'une autre famille, sort du groupe
        if gid not in by or (first and any(x.get("grp") == gid for x in tracks[:i])) or (prev and prev.get("grp") == gid and fam(prev) != fam(t)):
            t.pop("grp", None)
    count = {}
    for t in tracks:
        if t.get("grp"):
            count[t["grp"]] = count.get(t["grp"], 0) + 1
    for t in tracks:
        if t.get("grp") and count[t["grp"]] < 2:
            t.pop("grp")
    out = []
    for gid, g in by.items():
        members = [t for t in tracks if t.get("grp") == gid]
        if len(members) >= 2:
            out.append({"id": gid, "name": " ".join(str(g.get("name") or "Groupe").split())[:40] or "Groupe",
                        "fx": _fx_list(g.get("fx"), members[0]["kind"] != "audio")})
    return out


def normalize(p: dict) -> dict:
    """Rend un projet propre ou lève HttpError(400) en disant pourquoi.
    Les nombres sont bornés, les champs inconnus tombent, les champs
    nouveaux (vitesse, LUT, marques…) prennent leur défaut : un projet
    enregistré avant eux se relit tel quel."""
    if not isinstance(p, dict):
        raise HttpError(400, "un projet est un objet JSON")
    s = p.get("settings") or {}
    fmt = s.get("format") if s.get("format") in FORMATS or s.get("format") == "custom" else "1080p"
    fps = int(s.get("fps")) if str(s.get("fps")) in {str(f) for f in FPS} else 25
    if fmt == "custom":                    # la taille d'un clip : des px pairs (H.264 4:2:0)
        W = _num(s.get("width"), SIZE_MIN, SIZE_MAX, 1920, True) // 2 * 2
        H = _num(s.get("height"), SIZE_MIN, SIZE_MAX, 1080, True) // 2 * 2
    else:
        W, H = FORMATS[fmt]["w"], FORMATS[fmt]["h"]
    settings = {"format": fmt, "fps": fps, "width": W, "height": H,
                "still": _num(s.get("still"), 0.2, 600, STILL_DEFAULT)}
    tracks, ren = _tracks(p.get("tracks") or [_track(t) for t in TRACKS_DEFAULT])
    groups = _groups(p.get("groups"), tracks)
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
        if kind not in ("video", "image", "audio", "adjust"):
            raise HttpError(400, f"le plan {cid} n'est ni vidéo, ni image, ni son, ni calque d'effet")
        if (kind == "adjust") != (kinds[tid] == "fx"):
            raise HttpError(400, f"le plan {cid} : un calque d'effet va sur une piste de calques (X), et seulement lui")
        if kinds[tid] == "video" and kind == "audio":
            raise HttpError(400, f"le plan {cid} est un son sur une piste vidéo")
        if kinds[tid] == "audio" and kind == "image":
            raise HttpError(400, f"le plan {cid} est une image sur une piste son")
        item = str(c.get("item") or "")
        if kind == "adjust":
            item = ""
        elif not ITEM.fullmatch(item):
            raise HttpError(400, f"le plan {cid} ne pointe vers aucun objet de la bibliothèque")
        dur = _num(c.get("dur"), 1, 10 ** 8, 1, True)
        image = kinds[tid] != "audio"
        if isinstance(c.get("fx"), list):
            fx = _fx_list(c["fx"], image)
        else:
            # un plan d'avant le 29/09 au soir : son étalonnage, puis sa LUT, deviennent ses effets
            g = c.get("grade") or {}
            old = []
            if not _grade_neutral(g):
                old.append({"id": "fg" + cid[-8:].replace("-", "_"), "type": "grade", **g})
            lut = c.get("lut") if isinstance(c.get("lut"), dict) else None
            if lut and LUT_ID.fullmatch(str(lut.get("id", ""))):
                old.append({"id": "fl" + cid[-8:].replace("-", "_"), "type": "lut", "lut": lut["id"], "mix": lut.get("mix", 1)})
            fx = _fx_list(old, image)
        fi = _num(c.get("fade_in"), 0, dur, 0, True)
        fc = c.get("fcurve") if isinstance(c.get("fcurve"), dict) else {}
        clips.append({
            "id": cid, "track": tid, "item": item, "kind": kind,
            "title": str(c.get("title", ""))[:200],
            "start": _num(c.get("start"), 0, 10 ** 8, 0, True),
            "dur": dur,
            "in": _num(c.get("in"), 0, 10 ** 7, 0.0),
            "src_dur": _num(c.get("src_dur"), 0, 10 ** 7, 0.0),
            "speed": 1.0 if kind in ("image", "adjust") else _num(c.get("speed"), SPEED_MIN, SPEED_MAX, 1.0),
            "enabled": c.get("enabled") is not False,
            "vol": _num(c.get("vol"), 0, 4, 1.0),
            "fade_in": fi,
            "fade_out": _num(c.get("fade_out"), 0, dur - fi, 0, True),
            "fcurve": {"in": fc.get("in") if fc.get("in") in CURVES else "tri", "out": fc.get("out") if fc.get("out") in CURVES else "tri"},
            "xfade": 0 if kind == "adjust" else _num(c.get("xfade"), 0, 10 ** 6, 0, True),
            "audio": bool(c.get("audio")) if kind == "video" else kind == "audio",
            "fx": fx,
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
    # (les dossiers « bins » propres au montage du 29/09 midi ne sont plus lus : le chutier est Asset,
    # ses dossiers sont ceux de la bibliothèque ; aucun montage enregistré n'en portait)
    out = {"id": p.get("id"), "name": str(p.get("name") or "Sans titre")[:120], "settings": settings,
           "tracks": tracks, "groups": groups, "clips": clips, "markers": markers, "range": {"in": rin, "out": rout}}
    for k in ("created", "updated", "rev", "legacy"):
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
        fc = c.get("fcurve") or {}
        out[c["id"]] = {"clip": c, "ws": c["start"], "we": c["start"] + c["dur"],
                        "fin": c["fade_in"], "fout": c["fade_out"], "xin": 0, "xout": 0,
                        "cin": fc.get("in", "tri"), "cout": fc.get("out", "tri")}
        if c.get("enabled", True) and c.get("kind") != "adjust":
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


def chain_of(p: dict, c: dict) -> list[dict]:
    """Ce que l'image d'un plan traverse, dans l'ordre : ses effets, ceux de
    sa piste, ceux du groupe de sa piste (un calque d'effet : les siens).
    Même calcul que `chainOf` de montage/model.js."""
    on = lambda lst: [f for f in (lst or []) if f.get("on", True) and f.get("type") in ("grade", "lut")]   # noqa: E731
    if c.get("kind") == "adjust":
        steps = on(c.get("fx"))
    else:
        t = next((x for x in p["tracks"] if x["id"] == c["track"]), None)
        if not t or t["kind"] != "video":
            return []
        g = next((x for x in p.get("groups") or [] if x["id"] == t.get("grp")), None)
        steps = on(c.get("fx")) + on(t.get("fx")) + (on(g.get("fx")) if g else [])
    return [f for f in steps if f["type"] != "grade" or not _grade_neutral(f)]


# ── les LUT ──────────────────────────────────────────────────
# Une LUT est rangée sous `<data_dir>/luts/<id>.cube`, réécrite sous une
# forme unique (TITLE, LUT_3D_SIZE ou LUT_1D_SIZE, puis les valeurs à six
# décimales, rouge le plus rapide) : la page (montage/lut.js) et ffmpeg lisent
# le même fichier, et le lecteur de ffmpeg (vf_lut3d.c, parse_cube) n'a que
# des lignes qu'il comprend. Le domaine d'entrée doit être 0..1 (ffmpeg 6.1
# ne tient compte que de max − min, pas de min : un autre domaine serait
# lu autrement par les deux).
LUT_MAX_3D = 65              # rangée telle quelle jusque-là ; au-delà, rééchantillonnée à LUT_RESAMPLE
LUT_MAX_3D_IN = 256          # ce qu'on accepte d'un fichier (une HaldCLUT de niveau 12 a 144 points)
LUT_RESAMPLE = 33
LUT_MAX_1D = 4096
LUT_MINI = 17                # les vignettes de l'étagère : 17³, sur 8 bits (route /mini)
LUT_INPUTS = {"rec709": "Rec.709 / sRGB", "flog": "F-Log", "flog2": "F-Log2", "flog2c": "F-Log2 C",
              "log": "autre log", "inconnu": "non documenté"}


def _luts_dir() -> Path:
    p = config.data_dir() / "luts"
    p.mkdir(parents=True, exist_ok=True)
    return p


def parse_cube(text: str, max3d: int = LUT_MAX_3D, strict_domain: bool = True) -> dict:
    """Lit un fichier .cube (Adobe « Cube LUT Specification 1.0 », et les
    mots de Resolve LUT_3D_INPUT_RANGE / LUT_1D_INPUT_RANGE) : rend
    {kind: 3d|1d, size, values: [r, g, b, …], title, domain: (min, max)}.
    Lève ValueError en français si le fichier ne se lit pas comme la
    spécification le dit. `strict_domain=False` : un domaine autre que 0..1
    est rendu au lieu d'être refusé (le cuiseur s'en sert, la bibliothèque
    non)."""
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
            top = max3d if kind == "3d" else LUT_MAX_1D
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
    if strict_domain and (any(abs(x) > 1e-6 for x in lo) or any(abs(x - 1) > 1e-6 for x in hi)):
        raise ValueError(f"domaine d'entrée {lo} → {hi} : seul 0..1 est pris en charge (ffmpeg lirait autrement)")
    want = (size ** 3 if kind == "3d" else size) * 3
    if len(vals) != want:
        raise ValueError(f"{len(vals) // 3} lignes de valeurs, {want // 3} attendues pour {kind.upper()} {size}")
    return {"kind": kind, "size": size, "values": vals, "title": title, "domain": (tuple(lo), tuple(hi))}


def parse_hald(data: bytes) -> dict:
    """Une HaldCLUT en PNG (image carrée de L³ × L³ pixels, L² points par
    côté, rouge le plus rapide puis vert puis bleu — l'ordre même de
    `update_clut_packed` de ffmpeg vf_lut3d.c) : rendue comme une LUT 3D.
    Les valeurs restent les octets de l'image (`scale` = 1/255) : une
    HaldCLUT de niveau 12 (144 points, 3 millions de pixels) ne devient pas
    9 millions de flottants Python."""
    from io import BytesIO
    from PIL import Image
    try:
        im = Image.open(BytesIO(data), formats=["PNG"])   # PIL ne devine rien d'autre (un EPS → Ghostscript, audit H2)
        im.load()
    except Exception as e:  # noqa: BLE001 — PIL lève toutes sortes d'erreurs
        raise ValueError(f"image illisible : {e}") from e
    w, h = im.size
    n = round((w * h) ** (1 / 3))
    if w != h or n ** 3 != w * h:
        raise ValueError(f"{w}×{h} : une HaldCLUT est carrée, de L³ pixels de côté")
    if n > LUT_MAX_3D_IN:
        raise ValueError(f"HaldCLUT de {n} points par côté : {LUT_MAX_3D_IN} au plus")
    px = im.convert("RGB").tobytes()
    return {"kind": "3d", "size": n, "values": px, "scale": 1 / 255, "title": ""}


# ── échantillonner une LUT : l'interpolation trilinéaire de ffmpeg ──
def sample3(lut: dict, r: float, g: float, b: float) -> tuple[float, float, float]:
    """La LUT 3D à ce point, comme `interp_trilinear` de ffmpeg 6.1.1
    (vf_lut3d.c) : entrée bornée à 0..1 puis × (N − 1), voisins (int)x et
    min((int)x + 1, N − 1), mélanges sur r, puis g, puis b."""
    n = lut["size"]
    v = lut["values"]
    k = lut.get("scale", 1.0)
    m = n - 1
    sr, sg, sb = (min(max(x, 0.0), 1.0) * m for x in (r, g, b))
    pr, pg, pb = int(sr), int(sg), int(sb)
    qr, qg, qb = min(pr + 1, m), min(pg + 1, m), min(pb + 1, m)
    dr, dg, db = sr - pr, sg - pg, sb - pb
    n2 = n * n

    def at(i, j, l):
        o = 3 * (i + j * n + l * n2)
        return v[o] * k, v[o + 1] * k, v[o + 2] * k

    def lerp(a, c, t):
        return a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t
    c00 = lerp(at(pr, pg, pb), at(qr, pg, pb), dr)
    c10 = lerp(at(pr, qg, pb), at(qr, qg, pb), dr)
    c01 = lerp(at(pr, pg, qb), at(qr, pg, qb), dr)
    c11 = lerp(at(pr, qg, qb), at(qr, qg, qb), dr)
    return lerp(lerp(c00, c10, dg), lerp(c01, c11, dg), db)


def sample1(lut: dict, x: tuple[float, float, float]) -> tuple[float, float, float]:
    """Une LUT 1D, comme `interp_1d_linear` de ffmpeg (vf_lut3d.c)."""
    n, v = lut["size"], lut["values"]
    out = []
    for ch in range(3):
        s = min(max(x[ch], 0.0), 1.0) * (n - 1)
        p = int(s)
        q = min(p + 1, n - 1)
        out.append(v[3 * p + ch] + (v[3 * q + ch] - v[3 * p + ch]) * (s - p))
    return tuple(out)


def grid(n: int, fn) -> dict:
    """Une LUT 3D de n points par côté : fn(r, g, b) aux nœuds, rouge le plus rapide."""
    vals = []
    for b in range(n):
        for g in range(n):
            for r in range(n):
                vals.extend(fn(r / (n - 1), g / (n - 1), b / (n - 1)))
    return {"kind": "3d", "size": n, "values": vals, "title": ""}


def resample(lut: dict, n: int) -> dict:
    """La même LUT sur une grille de n points (trilinéaire, comme ffmpeg la lirait)."""
    if lut["kind"] == "1d":
        return {**grid(n, lambda r, g, b: sample1(lut, (r, g, b))), "title": lut.get("title", "")}
    return {**grid(n, lambda r, g, b: sample3(lut, r, g, b)), "title": lut.get("title", "")}


# ── de Rec.709 à F-Log2 : pour les LUT de Fujifilm ────────────
# Les LUT de Fujifilm attendent du F-Log2 (ou F-Log2 C) en F-Gamut (ou
# F-Gamut C). Nos vidéos sont en Rec.709. La conversion, en trois pas :
#   1. la valeur Rec.709 → lumière de scène linéaire : l'inverse de l'OETF
#      de l'ITU-R BT.709-6 (§ 1.2 : V = 1,099 L^0,45 − 0,099 si L ≥ 0,018,
#      4,500 L sinon), le blanc (V = 1) valant une réflexion de 100 % ;
#   2. les primaires BT.709 → F-Gamut (= celles de BT.2020) ou F-Gamut C,
#      toutes en D65 : la matrice calculée depuis les coordonnées x, y des
#      fiches Fujifilm (méthode SMPTE RP 177) ;
#   3. la courbe F-Log2 : « F-Log2 Data Sheet Ver.1.1 » et « F-Log2 C Data
#      Sheet Ver.1.0 » de Fujifilm (dl.fujifilm-x.com/technical-data/…,
#      § 2-3, la même courbe pour les deux) : out = c·log10(a·in + b) + d si
#      in ≥ cut1, e·in + f sinon ; 0 ≤ out ≤ 1 (0 % → 95/1023, 18 % → 400,
#      90 % → 570) : la valeur de code normalisée que lit la LUT.
# Ce qui n'est pas documenté et qu'on suppose : que la vidéo Rec.709 soit
# « scène » (inverse OETF, pas BT.1886), que son blanc soit une réflexion de
# 100 % (code 581/1023 : les hautes lumières au-delà ne servent pas) et que
# la LUT lise la valeur de code pleine échelle (0..1 = 0..1023). Une
# approximation, donc — la LUT « entrée F-Log2 » d'origine est gardée.
FLOG2 = {"a": 5.555556, "b": 0.064829, "c": 0.245281, "d": 0.384316, "e": 8.799461, "f": 0.092864,
         "cut1": 0.000889, "cut2": 0.100686685370811}
PRIMARIES = {                     # x, y de R, G, B ; blanc D65 (0,3127 ; 0,3290) partout
    "bt709": ((0.64, 0.33), (0.30, 0.60), (0.15, 0.06)),
    "fgamut": ((0.708, 0.292), (0.170, 0.797), (0.131, 0.046)),        # F-Log2 Data Sheet § 3 (= BT.2020)
    "fgamutc": ((0.7347, 0.2653), (0.0263, 0.9737), (0.1173, -0.0224)),  # F-Log2 C Data Sheet § 3
}
D65 = (0.3127, 0.3290)


def flog2_encode(x: float) -> float:
    f = FLOG2
    return f["c"] * math.log10(f["a"] * x + f["b"]) + f["d"] if x >= f["cut1"] else f["e"] * x + f["f"]


def flog2_decode(y: float) -> float:
    f = FLOG2
    return 10 ** ((y - f["d"]) / f["c"]) / f["a"] - f["b"] / f["a"] if y >= f["cut2"] else (y - f["f"]) / f["e"]


def rec709_decode(v: float) -> float:
    return v / 4.5 if v < 0.081 else ((v + 0.099) / 1.099) ** (1 / 0.45)


def rec709_encode(l: float) -> float:
    return 4.5 * l if l < 0.018 else 1.099 * l ** 0.45 - 0.099


def _inv3(m):
    (a, b, c), (d, e, f), (g, h, i) = m
    det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    return [[(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
            [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
            [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]]


def _mul3(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def npm(prim) -> list:
    """RVB → XYZ d'après les primaires et le blanc (SMPTE RP 177)."""
    xyz = [[x / y, 1.0, (1 - x - y) / y] for x, y in prim]
    p = [[xyz[j][i] for j in range(3)] for i in range(3)]           # colonnes = primaires
    w = [D65[0] / D65[1], 1.0, (1 - D65[0] - D65[1]) / D65[1]]
    s = [sum(_inv3(p)[i][k] * w[k] for k in range(3)) for i in range(3)]
    return [[p[i][j] * s[j] for j in range(3)] for i in range(3)]


def gamut_matrix(src: str, dst: str) -> list:
    return _mul3(_inv3(npm(PRIMARIES[dst])), npm(PRIMARIES[src]))


def rec709_to_flog2(rgb, gamut: str = "fgamut"):
    """Une couleur Rec.709 (0..1) → le code F-Log2 (0..1) qu'aurait écrit le boîtier."""
    m = gamut_matrix("bt709", gamut)
    lin = [rec709_decode(x) for x in rgb]
    return tuple(flog2_encode(max(0.0, sum(m[i][k] * lin[k] for k in range(3)))) for i in range(3))


def bake_rec709(lut: dict, gamut: str = "fgamut", n: int = LUT_RESAMPLE) -> dict:
    """Une LUT « entrée Rec.709 » : la conversion Rec.709 → F-Log2 puis la
    LUT de Fujifilm (lue trilinéaire, dans son domaine), cuites en un cube
    de n points."""
    m = gamut_matrix("bt709", gamut)
    lo, hi = lut.get("domain", ((0, 0, 0), (1, 1, 1)))

    def fn(r, g, b):
        lin = (rec709_decode(r), rec709_decode(g), rec709_decode(b))
        code = [flog2_encode(max(0.0, sum(m[i][k] * lin[k] for k in range(3)))) for i in range(3)]
        x = [(code[i] - lo[i]) / (hi[i] - lo[i]) for i in range(3)]
        return sample3(lut, *x) if lut["kind"] == "3d" else sample1(lut, x)
    return {**grid(n, fn), "title": lut.get("title", "")}


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
    return {**m, "url": f"api/montage/luts/{m['id']}/cube", "mini_url": f"api/montage/luts/{m['id']}/mini",
            "input_label": LUT_INPUTS.get(m.get("input"), "non documenté"),
            "family": m.get("family") or "Importées", "fav": int(m.get("fav") or 0)}


def _clean(s, n: int) -> str:
    return " ".join(str(s or "").split())[:n]


def store_lut(lut: dict, title: str, inp: str = "inconnu", source: str = "", family: str = "", pack: str = "",
              fav: int = 0, owner: str | None = None, note: str = "") -> dict:
    """Range une LUT lue (parse_cube, parse_hald, bake_rec709…) sous sa forme
    unique ; au-delà de 65 points, rééchantillonnée à 33 (trilinéaire)."""
    orig = lut["size"]
    if lut["kind"] == "3d" and (lut["size"] > LUT_MAX_3D or "scale" in lut):
        lut = resample(lut, LUT_RESAMPLE if lut["size"] > LUT_MAX_3D else lut["size"])
    d = _luts_dir()
    while True:
        lid = f"lut-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"
        if not (d / f"{lid}.json").exists():
            break
    title = _clean(title or lut.get("title") or "LUT", 80)
    (d / f"{lid}.cube").write_text(cube_text(lut, title), encoding="utf-8")
    meta = {"id": lid, "title": title, "kind": lut["kind"], "size": lut["size"],
            "input": inp if inp in LUT_INPUTS else "inconnu", "source": _clean(source, 240),
            "family": _clean(family, 60) or "Importées", "pack": _clean(pack, 80), "fav": int(fav or 0),
            "created": library.now(), "owner": owner if owner is not None else auth.current_id()}
    if orig != lut["size"]:
        meta["resampled_from"] = orig
    if note:
        meta["note"] = _clean(note, 300)
    (d / f"{lid}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    return meta


def create_lut(data: bytes, name: str, title: str = "", inp: str = "inconnu", source: str = "", family: str = "") -> dict:
    ext = Path(name or "").suffix.lower()
    if ext == ".png":
        lut = parse_hald(data)
    elif ext in (".cube", ""):
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError as e:
            raise ValueError("un .cube est un fichier texte (UTF-8)") from e
        lut = parse_cube(text, max3d=LUT_MAX_3D_IN)
    else:
        raise ValueError(f"{ext} : attendu un .cube (ou une HaldCLUT .png)")
    return store_lut(lut, title or lut["title"] or Path(name).stem, inp, source or name, family)


def mini_bytes(lid: str) -> bytes:
    """La LUT en 17³ sur 8 bits (14 739 octets, rouge le plus rapide) : de
    quoi dessiner les vignettes de l'étagère sans charger des centaines de
    cubes d'un mégaoctet. Seulement pour les vignettes : un plan lit le cube."""
    cache = _luts_dir() / "mini"
    cache.mkdir(exist_ok=True)
    f = cache / f"{lid}.bin"
    if f.exists():
        return f.read_bytes()
    small = resample(read_lut(lid), LUT_MINI)
    b = bytes(max(0, min(255, round(x * 255))) for x in small["values"])
    tmp = cache / f"{lid}.{secrets.token_hex(3)}.tmp"
    tmp.write_bytes(b)
    tmp.replace(f)
    return b


def read_lut(lid: str) -> dict:
    return parse_cube((_luts_dir() / f"{lid}.cube").read_text(encoding="utf-8"))


def lut_key(f: dict) -> str | None:
    """La clé d'un effet LUT (la LUT et son intensité), None s'il n'agit pas."""
    return f"{f['lut']}@{round(f['mix'] * 1000)}" if f.get("type") == "lut" and f.get("mix", 0) > 0 else None


def lut_steps(p: dict) -> list[dict]:
    """Tous les effets LUT que l'export traverse (plans actifs, calques)."""
    return [f for c in p["clips"] if c.get("enabled", True) for f in chain_of(p, c) if lut_key(f)]


def prepare_luts(p: dict, workdir: str, write: bool = True) -> dict[str, dict]:
    """Les fichiers de LUT dont l'export a besoin, par `lut_key` : la LUT
    rangée à 100 %, sinon une copie mêlée à son intensité dans le dossier
    du travail. Une LUT absente n'y est pas (l'export le dira)."""
    out = {}
    for f in lut_steps(p):
        key = lut_key(f)
        if key in out:
            continue
        m = lut_meta(f["lut"])
        if not m:
            continue
        mix = round(f["mix"] * 1000)
        path = _luts_dir() / f"{m['id']}.cube"
        if mix < 1000:
            path = Path(workdir) / f"{m['id']}-{mix:04d}.cube"
            if write:
                path.write_text(cube_text(mixed(read_lut(m["id"]), mix / 1000), m["title"]), encoding="utf-8")
        out[key] = {"path": str(path), "kind": m["kind"], "title": m["title"]}
    return out


# ── les packs : RawTherapee Film Simulation, Fujifilm ─────────
# Importés côté serveur (python3 -m tools.montage luts …, depuis server/),
# les archives d'origine restant hors du dépôt (~/showrunner-refs/luts/).
# Une LUT déjà importée (même `source`) ne l'est pas deux fois.
BRANDS = {"fuji": "Fuji", "fujifilm": "Fuji", "kodak": "Kodak", "eastman": "Kodak", "agfa": "Agfa", "polaroid": "Polaroid",
          "impossible": "Polaroid", "ilford": "Ilford", "kentmere": "Ilford", "rollei": "Rollei", "lomography": "Lomography",
          "lomo": "Lomography", "konica": "Konica", "cinestill": "CineStill", "fomapan": "Foma", "foma": "Foma", "adox": "Adox",
          "efke": "Efke", "ferrania": "Ferrania", "bergger": "Bergger", "orwo": "ORWO", "svema": "Svema", "arista": "Arista",
          "tasma": "Tasma", "shanghai": "Shanghai", "lucky": "Lucky", "revolog": "Revolog"}
FUJI_SIMS = [("eternableachbypass", "ETERNA BLEACH BYPASS"), ("eterna", "ETERNA"), ("provia", "PROVIA"), ("velvia", "Velvia"),
             ("astia", "ASTIA"), ("classicchrome", "CLASSIC CHROME"), ("realaace", "REALA ACE"), ("reala", "REALA ACE"),
             ("proneghi", "PRO Neg. Hi"), ("pronegstd", "PRO Neg. Std"), ("classicneg", "CLASSIC Neg."),
             ("nostalgicneg", "NOSTALGIC Neg."), ("acros", "ACROS"), ("monochrome", "MONOCHROME"), ("sepia", "SEPIA"),
             ("neutral", "Neutral"), ("natural", "Natural")]
# Les favoris : des pellicules et des simulations réputées, par motif sur le
# titre (le premier qui correspond ; un motif sans correspondant est sauté,
# le suivant de la liste de secours prend sa place).
FAVS = [r"^ETERNA$", r"CLASSIC CHROME", r"REALA ACE", r"ETERNA BLEACH BYPASS", r"CLASSIC Neg", r"^ACROS",
        r"Portra 400", r"Ektar 100", r"Kodachrome 64", r"Velvia 50", r"Polaroid 669", r"HP5"]
FAVS_SPARE = [r"PROVIA", r"Portra 160", r"Superia 400", r"Tri-?X", r"Astia 100", r"Agfa Vista 200", r"400H", r"Velvia 100"]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def _known_sources() -> set:
    out = set()
    for f in _luts_dir().glob("lut-*.json"):
        try:
            out.add(json.loads(f.read_text(encoding="utf-8")).get("source", ""))
        except ValueError:
            continue
    return out


def import_rawtherapee(zip_path: str, owner: str | None = None, log=print) -> list[dict]:
    """La collection « RawTherapee Film Simulation » (Pat David, CC BY-SA 4.0) :
    des HaldCLUT PNG (sRGB) rangées par dossiers ; la famille est la marque
    (premier mot du nom de fichier, sinon le dossier)."""
    import zipfile
    zname = Path(zip_path).name
    known = _known_sources()
    made = []
    with zipfile.ZipFile(zip_path) as z:
        members = sorted(n for n in z.namelist() if n.lower().endswith(".png") and not n.startswith("__MACOSX"))
        for i, name in enumerate(members):
            src = f"{zname}:{name}"
            if src in known:
                continue
            parts = [p for p in name.split("/") if p]
            stem = Path(parts[-1]).stem
            first = _norm(stem.split()[0]) if stem.split() else ""
            family = BRANDS.get(first)
            if not family:
                for p in reversed(parts[:-1]):
                    if _norm(p) in BRANDS:
                        family = BRANDS[_norm(p)]
                        break
            family = family or "Autres pellicules"
            bw = any(re.search(r"black|b ?& ?w|\bbw\b|noir", p, re.I) for p in parts[:-1])
            try:
                lut = parse_hald(z.read(name))
            except ValueError as e:
                log(f"  sauté {name} : {e}")
                continue
            m = store_lut(lut, stem + (" · N&B" if bw and not re.search(r"b ?& ?w|bw\b", stem, re.I) else ""), "rec709", src,
                          family, "RawTherapee Film Simulation", owner=owner,
                          note="HaldCLUT sRGB de la collection RawTherapee (Pat David, CC BY-SA 4.0)")
            made.append(m)
            if (i + 1) % 25 == 0:
                log(f"  {i + 1}/{len(members)}")
    log(f"RawTherapee : {len(made)} LUT importées ({len(members)} HaldCLUT dans l'archive)")
    return made


def _fuji_fields(name: str) -> dict:
    stem = Path(name).stem
    s = _norm(name)
    inp = "flog2c" if re.search(r"flog2c", s) else "flog2" if "flog2" in s else "flog" if "flog" in s else "inconnu"
    gamut = "fgamutc" if "fgamutc" in s or (inp == "flog2c" and "fgamut" not in s) else "fgamut"
    hdr = bool(re.search(r"2100|hlg|pq\b|hdr", name, re.I))
    wdr = bool(re.search(r"wdr", name, re.I))
    s2 = re.sub(r"(gfx)?eterna55", "", s)           # le boîtier GFX ETERNA 55, pas la simulation
    sim = next((t for k, t in FUJI_SIMS if k in s2), None)
    return {"stem": stem, "input": inp, "gamut": gamut, "hdr": hdr, "wdr": wdr, "sim": sim}


FUJI_BAKE = 65              # mesuré le 29/09 (étude) : la cuite 33³ s'écarte de la chaîne exacte jusqu'à 5,3/255 près du noir, la 65³ jusqu'à 1,1


def import_fujifilm(zip_path: str, owner: str | None = None, log=print, bake_size: int = FUJI_BAKE) -> list[dict]:
    """Les LUT de Fujifilm (entrée F-Log2 / F-Log2 C) : chaque cube de sortie
    BT.709 est rangé tel quel (« entrée F-Log2 »), et cuit en une version
    « entrée Rec.709 » (bake_rec709, 65 points). Les sorties HDR (BT.2100)
    ne sont pas prises : le banc est en SDR."""
    import zipfile
    zname = Path(zip_path).name
    known = _known_sources()
    made = []
    with zipfile.ZipFile(zip_path) as z:
        cubes = sorted(n for n in z.namelist() if n.lower().endswith(".cube") and not n.startswith("__MACOSX"))
        log(f"Fujifilm : {len(cubes)} cubes dans l'archive")
        best: dict = {}
        for name in cubes:
            fl = _fuji_fields(name)
            if fl["hdr"]:
                log(f"  sauté (HDR) {name}")
                continue
            try:
                lut = parse_cube(z.read(name).decode("utf-8-sig"), max3d=LUT_MAX_3D_IN, strict_domain=False)
            except (ValueError, UnicodeDecodeError) as e:
                log(f"  sauté {name} : {e}")
                continue
            key = (fl["sim"] or fl["stem"], fl["input"], fl["gamut"], fl["wdr"])
            # plusieurs grilles d'une même LUT : la plus fine
            if key not in best or lut["size"] > best[key][1]["size"]:
                best[key] = (name, lut, fl)
        # une seule version Rec.709 par simulation : cuite depuis l'entrée F-Log2 (F-Gamut = primaires BT.2020)
        # s'il y en a une, sinon depuis F-Log2 C (F-Gamut C)
        bake_from = {}
        for (simname, inp, gamut, wdr), (name, lut, fl) in best.items():
            if inp in ("flog2", "flog2c"):
                k = (simname, wdr)
                if k not in bake_from or (inp == "flog2" and bake_from[k] != "flog2"):
                    bake_from[k] = inp
        for (simname, inp, gamut, wdr), (name, lut, fl) in sorted(best.items(), key=lambda kv: str(kv[0])):
            label = simname + (" · WDR" if wdr else "")
            dom_ok = all(abs(x) < 1e-6 for x in lut["domain"][0]) and all(abs(x - 1) < 1e-6 for x in lut["domain"][1])
            src = f"{zname}:{name}"
            if src not in known and dom_ok and inp in ("flog2", "flog2c", "flog"):
                made.append(store_lut(lut, f"{label} · entrée {LUT_INPUTS[inp]}", inp, src, "Fujifilm · entrée F-Log2 (d'origine)",
                                      "Fujifilm GFX ETERNA 55 3D LUT", owner=owner, note=f"LUT Fujifilm d'origine ({lut['size']} points)"))
            if inp not in ("flog2", "flog2c"):
                log(f"  pas de version Rec.709 pour {name} (entrée {inp} : la conversion n'est écrite que pour F-Log2)")
                continue
            if bake_from.get((simname, wdr)) != inp:
                continue
            srcb = f"{src} · cuit Rec.709"
            if srcb in known:
                continue
            baked = bake_rec709(lut, gamut, bake_size)
            made.append(store_lut(baked, label, "rec709", srcb, "Fujifilm · entrée Rec.709 (cuites)", "Fujifilm GFX ETERNA 55 3D LUT", owner=owner,
                                  note=f"Rec.709 → {LUT_INPUTS[inp]} ({'F-Gamut C' if gamut == 'fgamutc' else 'F-Gamut'}, fiches F-Log2 / F-Log2 C "
                                       f"de Fujifilm) puis la LUT {Path(name).name}, cuites en {bake_size}³ ; approximation (étude montage)"))
            log(f"  {label} : {lut['size']}³ {inp} → cuite {bake_size}³")
    log(f"Fujifilm : {len(made)} LUT importées")
    return made


def set_favourites(patterns=FAVS, spare=FAVS_SPARE, log=print) -> list[dict]:
    """Les favoris de l'étagère, dans l'ordre : pour chaque motif, la LUT dont
    le titre correspond (les cuites Rec.709 avant les d'origine F-Log2). Les
    autres LUT perdent leur rang de favori."""
    metas = [m for m in (lut_meta(f.stem) for f in _luts_dir().glob("lut-*.json")) if m]
    metas.sort(key=lambda m: (m.get("input") != "rec709", m.get("family", ""), m["title"]))
    picked, used = [], set()
    queue = list(patterns) + list(spare)
    for pat in queue:
        if len(picked) >= len(patterns):
            break
        m = next((x for x in metas if x["id"] not in used and re.search(pat, x["title"], re.I)), None)
        if not m:
            log(f"  favori sans correspondant : {pat}")
            continue
        used.add(m["id"])
        picked.append(m)
    for m in metas:
        rank = next((i + 1 for i, x in enumerate(picked) if x["id"] == m["id"]), 0)
        if int(m.get("fav") or 0) != rank:
            m["fav"] = rank
            (_luts_dir() / f"{m['id']}.json").write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
    log("favoris : " + " · ".join(f"{i + 1}. {m['title']} ({m.get('family')})" for i, m in enumerate(picked)))
    return picked


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


def _fx_filters(steps: list[dict], luts: dict) -> list[str]:
    """Les filtres d'une chaîne d'effets, dans l'ordre (entrée en RVB gbrp)."""
    out = []
    for f in steps:
        if f["type"] == "grade":
            out += _grade(f)
        elif lut_key(f):
            if lut_key(f) not in luts:
                raise ValueError(f"LUT introuvable : {f['lut']}")
            out += _lut_filter(luts[lut_key(f)])
    return out


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
    live = [c for c in p["clips"] if c.get("enabled", True) and c.get("kind") != "adjust"]
    missing = sorted({c["item"] for c in live if c["item"] not in media})
    if missing:
        raise ValueError("objets absents de la bibliothèque (à la corbeille ?) : " + ", ".join(missing[:8]))
    if luts is not None:
        gone = sorted({f["lut"] for f in lut_steps(p) if lut_key(f) not in luts})
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
    # l'image, du bas vers le haut : V1 d'abord ; un calque d'effet agit sur tout ce qui est posé avant lui
    order = [t["id"] for t in reversed([t for t in p["tracks"] if t["kind"] != "audio"])]
    kinds = {t["id"]: t["kind"] for t in p["tracks"]}
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
            if kinds[tid] == "fx":
                # Un calque d'effet : l'image composée jusqu'ici, dédoublée
                # (split) ; une branche, coupée à la fenêtre du calque (trim),
                # passe en RVB BT.709 (la matrice de la sortie), traverse les
                # effets, revient en YUV, fond en transparence comme un plan, et
                # se pose sur l'autre (overlay, eof_action=pass).
                steps = chain_of(p, c)
                if not steps:
                    continue
                nw = w["we"] - w["ws"]
                chain = [f"trim=start_frame={a - f0}:end_frame={b - f0}", f"setpts=PTS-STARTPTS{_shift(a - w['ws'], fps)}",
                         "scale=in_color_matrix=bt709:in_range=limited", "format=gbrp", *_fx_filters(steps, luts),
                         "scale=out_color_matrix=bt709:out_range=limited", "format=yuva420p"]
                if w["fin"]:
                    chain.append(f"fade=t=in:st=0:d={_f(w['fin'] / fps)}:alpha=1")
                if w["fout"]:
                    chain.append(f"fade=t=out:st={_f((nw - w['fout']) / fps)}:d={_f(w['fout'] / fps)}:alpha=1")
                chain.append(f"setpts=PTS{_shift(w['ws'] - f0, fps)}")
                k = c["id"]
                graph.append(f"[{last}]split=2[s{k}][t{k}]")
                graph.append(f"[t{k}]" + ",".join(chain) + f"[x{k}]")
                graph.append(f"[s{k}][x{k}]overlay=eof_action=pass[o{k}]")
                last = f"o{k}"
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
                     *_fx_filters(chain_of(p, c), luts),
                     "scale=out_color_matrix=bt709:out_range=limited", "format=yuva420p",
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
        if t["kind"] == "fx":
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
            # les fondus d'entrée et de sortie suivent leur courbe (afade curve ; la page : curveGain)
            if w["fin"]:
                chain.append(f"afade=t=in:ss=0:ns={round(w['fin'] / fps * 48000)}" + (f":curve={w['cin']}" if w["cin"] != "tri" else ""))
            if w["xout"]:
                chain.append(f"afade=t=out:ss={round((nf - w['xout']) / fps * 48000)}:ns={round(w['xout'] / fps * 48000)}")
            if w["fout"]:
                chain.append(f"afade=t=out:ss={round((nf - w['fout']) / fps * 48000)}:ns={round(w['fout'] / fps * 48000)}"
                             + (f":curve={w['cout']}" if w["cout"] != "tri" else ""))
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
    for iid in {c["item"] for c in p["clips"] if c.get("kind") != "adjust" and c.get("item")}:
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
    snap = {k: p[k] for k in ("id", "name", "settings", "tracks", "groups", "clips", "markers", "range", "rev") if k in p}
    it = ctx.add(out, kind="video", title=p["name"] + (" (entrée → sortie)" if rng else ""),
                 params={"montage": p["id"], "rev": p.get("rev"), "project": snap, "preset": preset,
                         "range": list(rng) if rng else None},
                 parents=pl["items"], origin={"model": "ffmpeg"})
    return {"note": f"{T:.2f} s rendues en {time.time() - t0:.0f} s ({n} passe{'s' if n > 1 else ''})",
            "montage": p["id"], "item": it["id"], "passes": n}


# ── les routes ───────────────────────────────────────────────
def _summary(p: dict) -> dict:
    fps = p["settings"]["fps"]
    it = library.get(p["id"]) or {}
    pub = library.public(it) if it else {}
    return {"id": p["id"], "name": p["name"], "updated": p.get("updated"), "created": p.get("created"),
            "rev": p.get("rev", 1), "clips": len(p["clips"]), "duration": round(project_end(p) / fps, 3),
            "format": p["settings"]["format"], "width": p["settings"]["width"], "height": p["settings"]["height"],
            "fps": fps, "thumb_url": pub.get("thumb_url"), "folder": it.get("folder", ""), "legacy": p.get("legacy")}


def r_meta(req):
    return {"formats": [{"id": k, **v} for k, v in FORMATS.items()], "fps": list(FPS_CHOICE), "fps_all": list(FPS),
            "still": STILL_DEFAULT, "tracks": TRACKS_DEFAULT, "neutral_k": NEUTRAL_K,
            "max_tracks": MAX_TRACKS, "speed": [SPEED_MIN, SPEED_MAX],
            "lut_inputs": [{"id": k, "label": v} for k, v in LUT_INPUTS.items()]}


def r_list(req):
    """Les séquences qu'on peut lire (les objets `sequence` de la bibliothèque)."""
    migrate()
    out = []
    for it in library.query(["sequence"], limit=100000)["items"]:
        st = (it.get("params") or {})
        out.append({"id": it["id"], "name": it.get("title", ""), "updated": it.get("updated"), "created": it.get("created"),
                    "clips": st.get("clips", 0), "duration": it.get("duration") or 0, "format": st.get("format", ""),
                    "width": it.get("width"), "height": it.get("height"), "fps": it.get("fps"),
                    "thumb_url": it.get("thumb_url"), "folder": it.get("folder", ""), "legacy": st.get("legacy")})
    out.sort(key=lambda s: s.get("updated") or "", reverse=True)
    return {"projects": out}


def r_create(req):
    """Une séquence neuve : vide (nom, réglages), ou « à partir de l'élément »
    (`from_item` : la taille, la cadence, le nom et la durée du clip). `folder` :
    le dossier d'Asset où la ranger."""
    d = req.json()
    folder = d.get("folder") or ""
    if d.get("from_item"):
        it = library.get(str(d["from_item"]))
        if not it or not library.readable(it):
            raise HttpError(404, f"introuvable : {d['from_item']}")
        p = from_item(it)
        note = p.pop("note", "")
        with _lock:
            p = new_sequence(p, folder or it.get("folder") or "")
        return {**p, "note": note}
    p = blank(d.get("name", ""), d.get("settings"))
    with _lock:
        return new_sequence(p, folder)


def r_get(req, pid):
    return normalize(load(pid))


def r_save(req, pid):
    """La page envoie le projet entier après chaque geste. `base_rev` :
    la version qu'elle avait ; si le fichier a bougé entre-temps (un autre
    onglet), on refuse plutôt que d'écraser en silence."""
    d = req.json()
    sid = _resolve(pid)
    with _lock:
        cur = load(sid)
        base = d.get("base_rev")
        if base is not None and int(base) != int(cur.get("rev", 1)):
            raise HttpError(409, "ce montage a été modifié ailleurs (un autre onglet ?) : rechargez-le")
        new = normalize({**d, "id": sid, "legacy": cur.get("legacy")} if cur.get("legacy") else {**d, "id": sid})
        # éléments : poser un élément de sa propre descendance est refusé, la chaîne nommée (tools/elements.py, 30/09)
        from tools import elements
        elements.check_doc(sid, [c["item"] for c in new["clips"] if c.get("item")])
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
        it = library.get(src["id"]) or {}
        p = {**src, "name": (src["name"] + " (copie)")[:120], "created": library.now(), "updated": library.now(), "rev": 1}
        p.pop("legacy", None)
        p = new_sequence(p, it.get("folder", ""))
    return _summary(p)


def r_delete(req, pid):
    """À la corbeille de la bibliothèque (Asset la montre, et l'en sort)."""
    sid = _resolve(pid)
    _item(sid)
    try:
        library.trash(sid)
    except PermissionError as e:
        raise HttpError(403, str(e)) from e
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
    out.sort(key=lambda m: (m["family"].lower(), m["title"].lower()))
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
            m = create_lut(data, name, req.q("title"), req.q("input", "inconnu"), req.q("source"), req.q("family"))
    except ValueError as e:
        raise HttpError(400, f"{name} : {e}") from e
    return _lut_public(m)


def _lut_or_404(lid: str) -> dict:
    m = lut_meta(lid)
    if not m:
        raise HttpError(404, f"LUT introuvable : {lid}")
    return m


def _can_edit_lut(m: dict) -> None:
    # la règle des objets (auth.can_write_item) : une LUT sans `owner` est d'avant la porte, donc à Cal
    # (avant le 29/09, une LUT sans auteur se changeait et se jetait par tous)
    if not auth.can_write_item(m, auth.current()):
        raise HttpError(403, "cette LUT est à quelqu'un d'autre : seul son auteur (ou Cal) la change")


def r_lut_file(req, lid):
    _lut_or_404(lid)
    return FileResponse(_luts_dir() / f"{lid}.cube", "text/plain; charset=utf-8", cache="max-age=86400")


def r_lut_mini(req, lid):
    _lut_or_404(lid)
    try:
        mini_bytes(lid)
    except (ValueError, OSError) as e:
        raise HttpError(500, f"vignette de LUT impossible : {e}") from e
    return FileResponse(_luts_dir() / "mini" / f"{lid}.bin", "application/octet-stream", cache="max-age=86400")


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
        if "family" in d:
            m["family"] = _clean(d.get("family"), 60) or "Importées"
        if "fav" in d:
            # favori : au bout de la liste (rang = le plus grand + 1) ; retiré : 0
            if d["fav"]:
                if not int(m.get("fav") or 0):
                    ranks = [int((lut_meta(f.stem) or {}).get("fav") or 0) for f in _luts_dir().glob("lut-*.json")]
                    m["fav"] = max(ranks + [0]) + 1
            else:
                m["fav"] = 0
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
    try:
        made = migrate()                   # les montages d'avant deviennent des séquences (une fois)
        if made:
            print(f"montage : {len(made)} montage(s) d'avant rangé(s) comme séquences de la bibliothèque")
    except Exception as e:  # noqa: BLE001 — le portail démarre quand même ; la liste réessaiera
        print(f"montage : migration remise à plus tard ({e})")
    # lancé par la page (montage.js) sur la route commune : la séquence doit se voir (load → 404) ;
    # `run_export` la relit de même au départ, et ses plans passent par library.get (qui juge la lecture)
    jobs.register("montage.export", run_export, lane="cpu", title="Montage · export",
                  direct=lambda p: load(str(p.get("project") or "")))
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
    app.route("GET", "/api/montage/luts/{lid}/mini", r_lut_mini)
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
    ok(st == 200 and SID.fullmatch(p.get("id", "")) and p["settings"]["width"] == 1280 and len(p["tracks"]) == 6,
       f"montage : créer une séquence ({st} {str(p)[:200]})")
    pid = p["id"]
    st, lst = call("GET", "/api/montage/projects")
    ok(st == 200 and any(x["id"] == pid for x in lst["projects"]), "montage : la liste")
    # une séquence est un objet de la bibliothèque : Asset la voit, la range, la renomme, la jette et la rend
    st, li = call("GET", f"/api/library/{pid}")
    ok(st == 200 and li.get("kind") == "sequence" and li.get("title") == "Essai montage" and li.get("url", "").endswith("/sequence.json")
       and li.get("width") == 1280 and li.get("fps") == 25, f"montage : la séquence est un objet « sequence » de la bibliothèque ({st} {str(li)[:160]})")
    st, lk = call("GET", "/api/library?kind=sequence")
    ok(st == 200 and any(x["id"] == pid for x in lk["items"]), "montage : la bibliothèque liste ses séquences")
    st, mv = call("POST", "/api/asset/move", {"ids": [pid], "folder": "Séquences d'essai"})
    st, lst = call("GET", "/api/montage/projects")
    ok(any(x["id"] == pid and x["folder"] == "Séquences d'essai" for x in lst["projects"]), "montage : rangée dans un dossier d'Asset")
    st, av = call("GET", "/api/asset/view?folder=S%C3%A9quences%20d%27essai")
    ok(st == 200 and any(x["id"] == pid for x in av.get("items", [])), f"montage : la page Asset montre la séquence dans son dossier ({st})")
    st, rn = call("POST", f"/api/montage/projects/{pid}/rename", {"name": "Essai renommé"})
    st, li = call("GET", f"/api/library/{pid}")
    ok(li.get("title") == "Essai renommé", "montage : renommer la séquence renomme l'objet")
    call("POST", f"/api/montage/projects/{pid}/rename", {"name": "Essai montage"})
    st, dup = call("POST", f"/api/montage/projects/{pid}/duplicate")
    ok(st == 200 and SID.fullmatch(dup.get("id", "")) and dup["folder"] == "Séquences d'essai", "montage : dupliquer une séquence (même dossier)")
    st, _ = call("POST", f"/api/montage/projects/{dup['id']}/delete")
    st2, gone = call("GET", f"/api/library/{dup['id']}")
    st3, back = call("POST", f"/api/library/{dup['id']}/restore")
    st4, again = call("GET", f"/api/montage/projects/{dup['id']}")
    ok(st == 200 and st2 == 404 and st3 == 200 and st4 == 200 and again.get("name", "").endswith("(copie)"),
       "montage : une séquence supprimée va à la corbeille d'Asset et en revient entière")
    call("POST", f"/api/library/{dup['id']}/delete")
    st, p = call("GET", f"/api/montage/projects/{pid}")
    # un montage d'avant (montage/mon-*.json) devient une séquence, sans perte ; son ancienne adresse y mène
    legacy_id = "mon-20260929-080000-beef"
    (_dir() / f"{legacy_id}.json").write_text(json.dumps({"id": legacy_id, "name": "Montage d'avant", "rev": 3,
        "settings": {"format": "720p", "fps": 24}, "tracks": [_track(t) for t in TRACKS_DEFAULT], "clips": [],
        "created": "2026-09-29T08:00:00+00:00", "updated": "2026-09-29T08:30:00+00:00"}), encoding="utf-8")
    made = migrate()
    st, lg = call("GET", f"/api/montage/projects/{legacy_id}")
    ok(len(made) == 1 and st == 200 and SID.fullmatch(lg.get("id", "")) and lg.get("legacy") == legacy_id and lg["rev"] == 3
       and lg["settings"]["fps"] == 24 and (_dir() / "migres" / f"{legacy_id}.json").exists() and not (_dir() / f"{legacy_id}.json").exists(),
       f"montage : un montage d'avant devient une séquence (même contenu, l'ancienne adresse y mène, l'original gardé) ({st} {str(lg)[:120]})")
    ok(not migrate(), "montage : la migration ne se fait qu'une fois")
    call("POST", f"/api/montage/projects/{lg.get('id')}/delete")
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
       and c0["speed"] == 1.0 and c0["enabled"] is True and [(f["type"], f["exposure"]) for f in c0["fx"]] == [("grade", 0.5)]
       and "grade" not in c0 and "lut" not in c0 and mig["groups"] == [] and mig["markers"] == []
       and mig["range"] == {"in": None, "out": None} and "bins" not in mig
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
    cu = normalize({**old, "settings": {"format": "custom", "width": 705, "height": 897, "fps": 16}})
    ok(cu["settings"]["width"] == 704 and cu["settings"]["height"] == 896 and cu["settings"]["fps"] == 16,
       "montage : un format sur mesure (pair) et 16 i/s")
    mk = normalize({**old, "markers": [{"id": "m1", "f": 50, "name": "  refrain "}, {"id": "m0", "f": 10}], "range": {"in": 20, "out": 10}})
    ok([m["f"] for m in mk["markers"]] == [10, 50] and mk["markers"][1]["name"] == "refrain" and mk["range"] == {"in": 20, "out": None},
       "montage : les marques triées, une sortie avant l'entrée tombe")
    # un plan d'avant avec une LUT : ses effets, l'étalonnage d'abord ; relu, il ne bouge plus
    lo = normalize({**old, "clips": [{**old["clips"][0], "lut": {"id": "lut-20260929-000000-abcd", "mix": 0.4}}]})
    ok([f["type"] for f in lo["clips"][0]["fx"]] == ["grade", "lut"] and lo["clips"][0]["fx"][1]["mix"] == 0.4 and normalize(lo) == lo,
       "montage : un plan d'avant (étalonnage + LUT) devient deux effets, dans cet ordre")
    # les calques d'effet (X), les groupes de pistes, les fondus et leurs courbes
    fxp = normalize({**old, "tracks": [{"id": "X1", "name": "FX Inversion"}, {"id": "V2", "grp": "gA"}, {"id": "V1", "grp": "gA"},
                                        {"id": "A1", "grp": "gB"}, {"id": "A2"}],
                     "groups": [{"id": "gA", "name": "Image", "fx": [{"id": "f1", "type": "grade", "saturation": -100}]}, {"id": "gB", "name": "seul"}],
                     "clips": [{**old["clips"][0], "fade_in": 30, "fade_out": 30, "fcurve": {"in": "qsin", "out": "bogus"}},
                               {"id": "x", "track": "X1", "kind": "adjust", "item": "n'importe", "start": 0, "dur": 20,
                                "fx": [{"id": "f2", "type": "lut", "lut": "lut-20260929-000000-abcd", "mix": 2}, {"type": "flou"}]}]})
    xc = next(c for c in fxp["clips"] if c["id"] == "x")
    ok([t["id"] for t in fxp["tracks"]] == ["X1", "V2", "V1", "A1", "A2"] and fxp["tracks"][0]["kind"] == "fx"
       and [g["id"] for g in fxp["groups"]] == ["gA"] and "grp" not in fxp["tracks"][3] and xc["item"] == "" and xc["fx"][0]["mix"] == 1
       and len(xc["fx"]) == 1 and fxp["clips"][0]["fade_out"] == 18 and fxp["clips"][0]["fcurve"] == {"in": "qsin", "out": "tri"},
       f"montage : piste de calques X1, groupe gardé (deux pistes) ou défait (une seule), fondus bornés, courbe inconnue → linéaire ({fxp['tracks']} {fxp['groups']})")
    try:
        normalize({**old, "clips": [{**old["clips"][0], "track": "X1"}], "tracks": [{"id": "X1"}, {"id": "V1"}, {"id": "A1"}]})
        ok(False, "montage : une vidéo sur une piste de calques doit être refusée")
    except HttpError:
        ok(True, "montage : une vidéo sur une piste de calques est refusée")

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
    # un calque d'effet (X1, images 10 à 40, fondu d'entrée de 5) sur V1 ; un groupe V2+V1 qui désature ; une courbe de son
    lk = "lut-20260929-000000-abcd"
    fxg = normalize({**fake, "tracks": [{"id": "X1"}, {"id": "V2", "grp": "gA"}, {"id": "V1", "grp": "gA"}, {"id": "A1"}],
                     "groups": [{"id": "gA", "name": "g", "fx": [{"id": "fs", "type": "grade", "saturation": -50}]}],
                     "clips": [fake["clips"][0], {**fake["clips"][3], "fade_in": 25, "fcurve": {"in": "qsin"}},
                               {"id": "x", "track": "X1", "kind": "adjust", "start": 10, "dur": 30, "fade_in": 5,
                                "fx": [{"id": "fl", "type": "lut", "lut": lk, "mix": 1}]}]})
    gx = plan(fxg, med, "/o.mp4", luts={f"{lk}@1000": {"path": "/l.cube", "kind": "3d", "title": "l"}})["graph"]
    ok("[oa]split=2[sx][tx]" in gx and "[tx]trim=start_frame=10:end_frame=40,setpts=PTS-STARTPTS+0/(25*TB),scale=in_color_matrix=bt709:in_range=limited,format=gbrp,format=gbrpf32le,lut3d=file='/l.cube'" in gx
       and "fade=t=in:st=0:d=0.2:alpha=1,setpts=PTS+10/(25*TB)[xx];[sx][xx]overlay=eof_action=pass[ox]" in gx,
       f"montage : le calque d'effet agit sur ce qui est dessous, sur sa durée, avec son fondu ({gx[:300]})")
    ok("setsar=1,eq=contrast=1:saturation=0.5,scale=out_color_matrix" in gx, "montage : l'effet du groupe s'applique aux plans de ses pistes")
    ok("afade=t=in:ss=0:ns=48000:curve=qsin" in gx, "montage : un fondu de son en quart de sinus (afade curve=qsin)")

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

    # 2 ter. les packs : F-Log2, la cuisson Rec.709, les HaldCLUT de niveau 12, l'import, les favoris
    ok(round(flog2_encode(0.0) * 1023) == 95 and round(flog2_encode(0.18) * 1023) == 400 and round(flog2_encode(0.9) * 1023) == 570,
       "montage : la courbe F-Log2 de la fiche Fujifilm (0 % → 95, 18 % → 400, 90 % → 570 sur 1023)")
    ok(all(abs(flog2_decode(flog2_encode(x)) - x) < 1e-5 for x in (0.0, 0.0005, 0.01, 0.18, 0.9, 4.0)), "montage : F-Log2, aller et retour")
    m2020 = gamut_matrix("bt709", "fgamut")
    bt2087 = [[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0114], [0.0164, 0.0880, 0.8956]]
    ok(all(abs(m2020[i][j] - bt2087[i][j]) < 6e-4 for i in range(3) for j in range(3)),
       f"montage : BT.709 → F-Gamut calculée depuis les primaires = la matrice de l'UIT-R BT.2087 ({[[round(x, 4) for x in r] for r in m2020]})")
    mc = gamut_matrix("bt709", "fgamutc")
    ok(all(abs(sum(r) - 1) < 1e-6 for r in mc), "montage : BT.709 → F-Gamut C garde le blanc (lignes de somme 1)")
    # une « Neutral » d'essai (F-Log2 → Rec.709 exact) cuite en Rec.709 doit rendre l'identité
    inv = _inv3(gamut_matrix("bt709", "fgamut"))

    def neutral(r, g, b):
        refl = [flog2_decode(x) for x in (r, g, b)]
        lin = [sum(inv[i][k] * refl[k] for k in range(3)) for i in range(3)]
        return tuple(rec709_encode(min(1.0, max(0.0, x))) for x in lin)
    import random
    rnd = random.Random(7)
    pts = [[rnd.random() for _ in range(3)] for _ in range(400)]
    back = max(max(abs(a - b) for a, b in zip(neutral(*rec709_to_flog2(c)), c)) for c in pts)
    ok(back * 255 < 0.1, f"montage : 709 → F-Log2 → (F-Log2 → 709) rend l'image, sans LUT (écart max {back * 255:.4f} sur 255)")
    fake = grid(33, neutral)
    baked = bake_rec709(fake, "fgamut", 33)
    errs = [max(abs(a - b) for a, b in zip(sample3(baked, *c), sample3(fake, *rec709_to_flog2(c)))) * 255 for c in pts]
    ok(sum(errs) / len(errs) < 0.4 and max(errs) < 8,
       f"montage : la cuite 33³ suit la chaîne 709 → F-Log2 → LUT (écart moyen {sum(errs) / len(errs):.2f}, max {max(errs):.2f} sur 255)")
    from io import BytesIO
    from PIL import Image
    import zipfile

    def hald(level, fn):                     # une HaldCLUT de niveau `level` (level² points)
        n = level * level
        im = Image.new("RGB", (level ** 3, level ** 3))
        im.putdata([tuple(round(255 * x) for x in fn((i % n) / (n - 1), (i // n % n) / (n - 1), (i // (n * n)) / (n - 1))) for i in range(n ** 3)])
        b = BytesIO()
        im.save(b, "PNG")
        return b.getvalue()
    big = parse_hald(hald(9, lambda r, g, b: (r, g, b)))
    ok(big["size"] == 81, "montage : une HaldCLUT de niveau 9 se lit (81 points)")
    zdir = Path(tempfile.mkdtemp(prefix="sr_luts_"))
    with zipfile.ZipFile(zdir / "HaldCLUT.zip", "w") as z:
        z.writestr("HaldCLUT/Color/Kodak/Kodak Portra 400.png", hald(9, lambda r, g, b: (r ** 0.9, g, b ** 1.1)))
        z.writestr("HaldCLUT/Black and White/Ilford/Ilford HP5 Plus 400.png", hald(3, lambda r, g, b: (0.3 * r + 0.59 * g + 0.11 * b,) * 3))
        z.writestr("HaldCLUT/Color/Misc/Lomo Redscale.png", hald(2, lambda r, g, b: (r, g * 0.5, b * 0.2)))
    with zipfile.ZipFile(zdir / "fuji.zip", "w") as z:
        z.writestr("LUT/33grid/ETERNA55_FLog2C_FGamutC_to_BT.709_ETERNA_33grid.cube", cube_text(grid(9, neutral), "e"))
        z.writestr("LUT/65grid/ETERNA55_FLog2C_FGamutC_to_BT.709_ETERNA_65grid.cube", cube_text(grid(11, neutral), "e"))
        z.writestr("LUT/33grid/ETERNA55_FLog2_FGamut_to_BT.709_CLASSIC-CHROME_33grid.cube", cube_text(grid(9, neutral), "c"))
        z.writestr("LUT/33grid/ETERNA55_FLog2_FGamut_to_BT.2100-HLG_ETERNA_33grid.cube", cube_text(grid(5, neutral), "h"))
    rt = import_rawtherapee(str(zdir / "HaldCLUT.zip"), owner="cal", log=lambda *_: None)
    fam = {m["title"]: (m["family"], m["size"], m.get("resampled_from")) for m in rt}
    ok(fam.get("Kodak Portra 400") == ("Kodak", 33, 81) and fam.get("Ilford HP5 Plus 400 · N&B", ("?",))[0] == "Ilford"
       and fam.get("Lomo Redscale", ("?",))[0] == "Lomography",
       f"montage : RawTherapee importé par familles (Kodak, Ilford N&B, Lomography), le niveau 9 rééchantillonné à 33 ({fam})")
    fj = import_fujifilm(str(zdir / "fuji.zip"), owner="cal", log=lambda *_: None, bake_size=9)
    kinds = sorted((m["title"], m["input"], m["family"]) for m in fj)
    ok(len(fj) == 4 and [k[0] for k in kinds].count("ETERNA") == 1 and ("ETERNA", "rec709", "Fujifilm · entrée Rec.709 (cuites)") in kinds
       and ("ETERNA · entrée F-Log2 C", "flog2c", "Fujifilm · entrée F-Log2 (d'origine)") in kinds
       and ("CLASSIC CHROME", "rec709", "Fujifilm · entrée Rec.709 (cuites)") in kinds and not any("2100" in m["source"] for m in fj)
       and next(m for m in fj if m["title"] == "ETERNA · entrée F-Log2 C")["size"] == 11,
       f"montage : Fujifilm : la grille la plus fine, l'originale F-Log2 C et sa cuite Rec.709, pas de HDR ({kinds})")
    ok(not import_rawtherapee(str(zdir / "HaldCLUT.zip"), log=lambda *_: None) and not import_fujifilm(str(zdir / "fuji.zip"), log=lambda *_: None),
       "montage : réimporter un pack n'ajoute rien")
    favs = set_favourites(log=lambda *_: None)
    ok([m["title"] for m in favs][:3] == ["ETERNA", "CLASSIC CHROME", "Kodak Portra 400"],
       f"montage : les favoris suivent la liste, un motif sans correspondant est sauté ({[m['title'] for m in favs]})")
    st, ls = call("GET", "/api/montage/luts")
    et = next((x for x in ls["luts"] if x["title"] == "ETERNA"), {})
    ok(st == 200 and et.get("fav") == 1 and et.get("family") == "Fujifilm · entrée Rec.709 (cuites)" and et.get("mini_url"),
       "montage : la liste dit la famille et le rang de favori")
    st, mb = call("GET", f"/api/montage/luts/{et.get('id')}/mini")
    ok(st == 200 and isinstance(mb, bytes) and len(mb) == 17 ** 3 * 3, f"montage : la vignette 17³ sur 8 bits ({len(mb) if isinstance(mb, bytes) else mb})")
    st, e2 = call("POST", f"/api/montage/luts/{et.get('id')}", {"fav": False})
    st, e3 = call("POST", f"/api/montage/luts/{et.get('id')}", {"fav": True})
    ok(e2.get("fav") == 0 and e3.get("fav", 0) > 1, "montage : retirer un favori, le remettre (au bout de la liste)")
    shutil.rmtree(zdir, ignore_errors=True)

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
    # « Nouvelle séquence à partir de l'élément » : la taille, la cadence, le nom et la durée du clip
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "color=c=green:s=704x896:r=24:d=2", "-f", "lavfi",
                    "-i", "sine=f=330:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(tmp / "haut.mp4")],
                   check=True, timeout=60)
    st, haut = call("PUT", "/api/library/upload?name=haut.mp4&title=Plan%20haut", raw=(tmp / "haut.mp4").read_bytes())
    st, fs = call("POST", "/api/montage/projects", {"from_item": haut["id"]})
    fc = (fs.get("clips") or [{}])[0]
    ok(st == 200 and fs["settings"] == {"format": "custom", "fps": 24, "width": 704, "height": 896, "still": STILL_DEFAULT}
       and fs["name"] == "Plan haut" and len(fs["clips"]) == 1 and fc.get("track") == "V1" and fc.get("dur") == 48 and fc.get("audio") is True,
       f"montage : nouvelle séquence à partir d'un clip 704×896 à 24 i/s : ses réglages, son nom, le clip entier en V1 ({st} {str(fs)[:220]})")
    st, fs2 = call("POST", "/api/montage/projects", {"from_item": rvb["id"]})
    ok(st == 200 and fs2["settings"]["format"] == "720p" and fs2["settings"]["fps"] == 25 and fs2["clips"][0]["dur"] == 75,
       "montage : à partir d'un clip 1280×720 à 25 i/s : le format 720p")
    for x in (fs, fs2):
        call("POST", f"/api/montage/projects/{x.get('id')}/delete")
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
    # 5. un calque d'effet (inversion, images 10 à 30) au-dessus du rouge de rvb.mp4
    st, cur = call("GET", f"/api/montage/projects/{pid}")
    st, sv = call("POST", f"/api/montage/projects/{pid}", {**cur, "base_rev": cur["rev"], "range": {"in": None, "out": None},
                  "tracks": [{"id": "X1", "name": "FX Inversion"}] + [t for t in cur["tracks"]],
                  "clips": [{"id": "q1", "track": "V1", "item": rvb["id"], "kind": "video", "start": 0, "dur": 25, "in": 0, "src_dur": 3},
                            {"id": "qx", "track": "X1", "kind": "adjust", "start": 10, "dur": 10, "fx": [{"id": "fi", "type": "lut", "lut": lut["id"], "mix": 1}]}]})
    ok(st == 200, f"montage : enregistrer un calque d'effet ({st} {sv})")
    j = export({}, "calque d'effet")
    if j["state"] == "done" and j["items"]:
        path = str(library.path_of(library.get(j["items"][0]["id"])))
        q = {f: _pixel(path, f) for f in (5, 15, 22)}
        cy = q[15]
        ok(red(q[5]) and red(q[22]) and abs(cy[0] - 35) <= 6 and abs(cy[1] - 215) <= 6 and abs(cy[2] - 215) <= 6,
           f"montage : le calque d'effet inverse ce qui est dessous sur sa durée seulement ({q})")
    shutil.rmtree(tmp, ignore_errors=True)


# ── en ligne de commande : importer un pack de LUT ───────────
#   cd server && SHOWRUNNER_DATA=~/showrunner-data python3 -m tools.montage luts rawtherapee ~/showrunner-refs/luts/HaldCLUT.zip
#   … luts fujifilm ~/showrunner-refs/luts/gfx-eterna-55-3d-lut-v110.zip
#   … luts favoris
# Les fichiers s'écrivent dans <data_dir>/luts/ : le portail en marche les
# voit à la requête suivante, sans redémarrer.
if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    if len(args) < 2 or args[0] != "luts" or args[1] not in ("rawtherapee", "fujifilm", "favoris"):
        print(__doc__.split("\n")[0])
        print("usage : python3 -m tools.montage luts rawtherapee|fujifilm <archive.zip> · luts favoris")
        sys.exit(2)
    print("données :", config.data_dir())
    owner = auth.admin_id()
    if args[1] == "rawtherapee":
        import_rawtherapee(args[2], owner=owner)
    elif args[1] == "fujifilm":
        import_fujifilm(args[2], owner=owner)
    set_favourites()
