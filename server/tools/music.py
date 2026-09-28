"""Musique : un seul projet, trois vues (timeline, rack, nodal).

Le son se fait dans la page (Web Audio) ; le serveur garde les projets et
porte les deux travaux « IA » :

  music.generate   un morceau à partir d'un style et de paroles facultatives
  music.stems      un son de la bibliothèque découpé en voix, batterie, basse
                   et reste

Deux moteurs, choisis par le réglage `music_engine` de
`showrunner.local.json` (lu au démarrage) :

  "factice"  (défaut)  voie `cpu`, sans modèle : un son d'essai synthétisé
                       dans la tonalité et au tempo demandés, et une
                       « séparation » par filtres ffmpeg. De quoi éprouver
                       tout le parcours (file, bibliothèque, timeline) sans
                       GPU. Décision de Cal du 28/09 : on met l'interface en
                       place d'abord, on câble les modèles après.
  "ace-step"           voie `audio` (ComfyUI :8188) : ACE-Step 1.5 XL base
                       avec le graphe du gabarit officiel
                       (`server/workflows/music_ace15_xl_base.json`), et
                       Demucs « htdemucs_ft » par le nœud AudioSeparateDemucs.
                       Essayé une fois sur DGX2 le 28/09 (docs/etudes/musique.md).

Les deux rangent leurs sons dans la bibliothèque (`kind: audio`, la recette
dans `params`, `params.engine` dit lequel). Un projet :
`<data_dir>/musique/<id>.json`.

Les bornes des réglages de génération viennent de la documentation
d'ACE-Step 1.5 (`~/ACE-Step-1.5/docs/en/INFERENCE.md`, table GenerationParams :
caption 512 signes, lyrics 4096 signes et « [Instrumental] » pour un morceau
sans voix, bpm 30-300, duration 10-600 s) et des listes du nœud
`TextEncodeAceStepAudio1.5` relevées sur DGX2 (`/object_info`, 28/09/2026).
"""

from __future__ import annotations

import json
import math
import random
import re
import secrets
import shutil
import subprocess
import threading
import time
import wave
from array import array
from pathlib import Path

from core import config, jobs, library
from core.comfy import Comfy, ComfyError, fill
from core.http import HttpError

WORKFLOWS = Path(__file__).resolve().parents[1] / "workflows"
GEN_GRAPH = "music_ace15_xl_base.json"
GEN_MODEL = "acestep_v1.5_xl_base_bf16.safetensors"
PID_RX = re.compile(r"mus-\d{8}-\d{6}-[0-9a-f]{4}")
ID_RX = re.compile(r"[a-z][a-z0-9]{0,23}")
MAX_BYTES = 4 << 20

# ── ce que la page sait jouer (musique/modules.js en est la vérité) ──
SOURCES = {"drums", "synth", "sampler", "player"}
EFFECTS = {"delay", "reverb", "comp", "eq", "filter", "dist"}
MODULE_TYPES = SOURCES | EFFECTS | {"strip", "master"}
TRACK_SOURCE = {"drums": "drums", "synth": "synth", "sampler": "sampler", "audio": "player"}
COLORS = {"or", "cy", "amb", "grn2", "coral-1", "coral-2", "coral-3"}
DRUM_VOICES = ("bd", "sd", "cp", "ch", "oh", "lt", "ht", "cb")
STEPS = (16, 32, 48, 64)
SIGS = (2, 3, 4, 6)

# ── les listes du nœud TextEncodeAceStepAudio1.5 (object_info, DGX2, 28/09) ──
_NOTES = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"]
KEYSCALES = [f"{n} major" for n in _NOTES] + [f"{n} minor" for n in _NOTES]
TIMESIGS = ("2", "3", "4", "6")
LANGS = ("ar az bg bn ca cs da de el en es fa fi fr he hi hr ht hu id is it ja ko la lt ms ne nl no pa pl "
         "pt ro ru sa sk sr sv sw ta te th tl tr uk ur vi yue zh unknown").split()

# Demucs : les sorties du nœud AudioSeparateDemucs, dans l'ordre (README d'AudioSeparation)
STEMS = (("vocals", "voix"), ("drums", "batterie"), ("bass", "basse"), ("other", "autre"))
DEMUCS_MODEL = "Hybrid Transformer fine-tuned"   # htdemucs_ft, présent dans models/audio/Demucs
ON_DISK = "\U0001F4BE"                           # le nœud marque ainsi un modèle déjà sur disque

_lock = threading.Lock()


def mode() -> str:
    """« factice » tant que Cal n'a pas dit de brancher les modèles."""
    return "ace-step" if config.get("music_engine") == "ace-step" else "factice"


def _dir() -> Path:
    p = config.data_dir() / "musique"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _path(pid: str) -> Path:
    if not PID_RX.fullmatch(pid or ""):
        raise HttpError(400, "identifiant de projet invalide")
    return _dir() / f"{pid}.json"


# ── validation d'un projet ──────────────────────────────────
def _num(v, lo, hi, what) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or not (lo <= v <= hi):
        raise ValueError(f"{what} : attendu un nombre entre {lo} et {hi}")
    return v


def _str(v, hi, what, lo=0) -> str:
    if not isinstance(v, str) or not (lo <= len(v) <= hi):
        raise ValueError(f"{what} : attendu un texte de {lo} à {hi} signes")
    return v


def _id(v, what) -> str:
    if not isinstance(v, str) or not ID_RX.fullmatch(v):
        raise ValueError(f"{what} : identifiant invalide ({v!r})")
    return v


def _cycle(nodes: set, cables: list) -> bool:
    out: dict = {n: [] for n in nodes}
    for c in cables:
        out[c["a"]].append(c["b"])
    state: dict = {}

    def visit(n) -> bool:
        state[n] = 1
        for m in out[n]:
            if state.get(m) == 1 or (state.get(m) is None and visit(m)):
                return True
        state[n] = 2
        return False

    return any(state.get(n) is None and visit(n) for n in nodes)


def validate(p: dict) -> None:
    """Refuse un projet que la page ne saurait pas jouer : le graphe audio
    doit être un graphe sans boucle, chaque référence doit exister."""
    if not isinstance(p, dict):
        raise ValueError("un projet est un objet")
    _str(p.get("name"), 80, "nom", 1)
    _num(p.get("bpm"), 20, 300, "tempo")
    if p.get("sig") not in SIGS:
        raise ValueError(f"mesure : {', '.join(map(str, SIGS))} temps")
    loop = p.get("loop") or {}
    if not isinstance(loop, dict) or not isinstance(loop.get("on", False), bool):
        raise ValueError("boucle invalide")
    a = _num(loop.get("a", 0), 0, 1e5, "début de boucle")
    b = _num(loop.get("b", 16), 0, 1e5, "fin de boucle")
    if b <= a:
        raise ValueError("la boucle finit avant de commencer")

    tracks = p.get("tracks")
    mods = p.get("modules")
    cables = p.get("cables")
    pats = p.get("patterns")
    clips = p.get("clips")
    for v, n, what in ((tracks, 64, "pistes"), (mods, 512, "modules"), (cables, 1024, "câbles"),
                       (pats, 512, "motifs"), (clips, 4000, "clips")):
        if not isinstance(v, list) or len(v) > n:
            raise ValueError(f"{what} : une liste de {n} au plus")

    by_mod: dict = {}
    for m in mods:
        if not isinstance(m, dict):
            raise ValueError("module invalide")
        mid = _id(m.get("id"), "module")
        if mid in by_mod:
            raise ValueError(f"module en double : {mid}")
        if m.get("type") not in MODULE_TYPES:
            raise ValueError(f"module inconnu : {m.get('type')!r}")
        _num(m.get("x", 0), -1e5, 1e5, "position")
        _num(m.get("y", 0), -1e5, 1e5, "position")
        params = m.get("params", {})
        if not isinstance(params, dict) or len(params) > 200:
            raise ValueError(f"{mid} : réglages invalides")
        for k, v in params.items():
            if isinstance(v, str):
                _str(v, 200, f"{mid}.{k}")
            elif not isinstance(v, (int, float)) or isinstance(v, bool) or v != v:
                raise ValueError(f"{mid}.{k} : un nombre ou un texte")
        by_mod[mid] = m
    masters = [m for m in mods if m["type"] == "master"]
    if len(masters) != 1:
        raise ValueError("il faut une et une seule sortie")

    by_track: dict = {}
    for t in tracks:
        tid = _id((t or {}).get("id"), "piste")
        if tid in by_track:
            raise ValueError(f"piste en double : {tid}")
        _str(t.get("name"), 60, "nom de piste", 1)
        if t.get("kind") not in TRACK_SOURCE:
            raise ValueError(f"sorte de piste inconnue : {t.get('kind')!r}")
        if t.get("color") not in COLORS:
            raise ValueError(f"couleur de piste inconnue : {t.get('color')!r}")
        src, strip = by_mod.get(t.get("src")), by_mod.get(t.get("strip"))
        if not src or src["type"] != TRACK_SOURCE[t["kind"]]:
            raise ValueError(f"{t['name']} : sa source manque")
        if not strip or strip["type"] != "strip":
            raise ValueError(f"{t['name']} : sa tranche de console manque")
        by_track[tid] = t
    for m in mods:
        if m.get("track") is not None and m["track"] not in by_track:
            raise ValueError(f"{m['id']} : piste inconnue")

    seen = set()
    for c in cables:
        a, b = (c or {}).get("a"), (c or {}).get("b")
        if a not in by_mod or b not in by_mod or a == b:
            raise ValueError("câble vers un module absent")
        if by_mod[a]["type"] == "master":
            raise ValueError("la sortie ne se câble vers rien")
        if by_mod[b]["type"] in SOURCES:
            raise ValueError(f"{by_mod[b]['type']} n'a pas d'entrée")
        if (a, b) in seen:
            raise ValueError("câble en double")
        seen.add((a, b))
    if _cycle(set(by_mod), cables):
        raise ValueError("le câblage fait une boucle : le son tournerait sans fin")

    by_pat: dict = {}
    for pt in pats:
        pid = _id((pt or {}).get("id"), "motif")
        tr = by_track.get(pt.get("track"))
        if not tr or tr["kind"] == "audio":
            raise ValueError(f"{pid} : piste absente ou sans motif")
        if pt.get("steps") not in STEPS:
            raise ValueError(f"{pid} : {', '.join(map(str, STEPS))} pas")
        _str(pt.get("name", ""), 40, "nom de motif")
        if tr["kind"] == "drums":
            lanes = pt.get("lanes")
            if not isinstance(lanes, dict) or not set(lanes) <= set(DRUM_VOICES):
                raise ValueError(f"{pid} : voix de batterie inconnues")
            for v in lanes.values():
                if not isinstance(v, list) or len(v) != pt["steps"]:
                    raise ValueError(f"{pid} : une case par pas")
                for x in v:
                    _num(x, 0, 1, "vélocité")
        else:
            notes = pt.get("notes")
            if not isinstance(notes, list) or len(notes) > 4000:
                raise ValueError(f"{pid} : notes invalides")
            for nt in notes:
                _num((nt or {}).get("s"), 0, pt["steps"] - 1, "départ de note")
                _num(nt.get("l"), 0.25, pt["steps"], "longueur de note")
                _num(nt.get("p"), 0, 127, "hauteur de note")
                _num(nt.get("v", 0.8), 0, 1, "vélocité")
        by_pat[pid] = pt
    cids = set()
    for c in clips:
        cid = _id((c or {}).get("id"), "clip")
        if cid in cids:
            raise ValueError(f"clip en double : {cid}")
        cids.add(cid)
        tr = by_track.get(c.get("track"))
        if not tr:
            raise ValueError(f"{cid} : piste absente")
        _num(c.get("start"), 0, 1e5, "début de clip")
        _num(c.get("len"), 0.0625, 1e5, "longueur de clip")
        if tr["kind"] == "audio":
            _str(c.get("item"), 64, "son du clip", 1)
            _num(c.get("off", 0), 0, 1e5, "décalage du clip")
        elif c.get("pat") not in by_pat or by_pat[c["pat"]]["track"] != tr["id"]:
            raise ValueError(f"{cid} : motif absent")
        else:
            _num(c.get("off", 0), 0, 1e5, "décalage du motif")
    pend = p.get("pending", [])
    if not isinstance(pend, list) or len(pend) > 64:
        raise ValueError("travaux en attente invalides")


# ── un projet neuf : de quoi entendre quelque chose tout de suite ──
def starter(name: str) -> dict:
    """Une batterie et une basse sur huit mesures, câblées source → tranche
    → sortie. Les réglages absents prennent leur défaut dans la page."""
    kick = [1, 0, 0, 0] * 4
    snare = [0, 0, 0, 0, 1, 0, 0, 0] * 2
    hats = [0, 0, 1, 0] * 4
    bass = [{"s": s, "l": 2, "p": p, "v": 0.85} for s, p in
            ((0, 45), (3, 45), (6, 57), (8, 43), (11, 43), (14, 55))]
    return {
        "name": name, "bpm": 110, "sig": 4,
        "loop": {"on": True, "a": 0, "b": 16},
        "tracks": [
            {"id": "t1", "name": "Batterie", "kind": "drums", "color": "or", "mute": False, "solo": False,
             "src": "m1", "strip": "m2", "pat": "p1"},
            {"id": "t2", "name": "Basse", "kind": "synth", "color": "cy", "mute": False, "solo": False,
             "src": "m3", "strip": "m4", "pat": "p2"},
        ],
        "modules": [
            {"id": "m1", "type": "drums", "track": "t1", "x": 40, "y": 40, "on": True, "params": {}},
            {"id": "m2", "type": "strip", "track": "t1", "x": 360, "y": 40, "on": True, "params": {}},
            {"id": "m3", "type": "synth", "track": "t2", "x": 40, "y": 330, "on": True,
             "params": {"wave": 2, "cut": 700, "fenv": 3, "vol": -12}},
            {"id": "m5", "type": "delay", "track": "t2", "x": 360, "y": 330, "on": True,
             "params": {"mix": 0.18}},
            {"id": "m4", "type": "strip", "track": "t2", "x": 680, "y": 330, "on": True, "params": {}},
            {"id": "m0", "type": "master", "track": None, "x": 1000, "y": 180, "on": True, "params": {}},
        ],
        "cables": [{"a": "m1", "b": "m2"}, {"a": "m2", "b": "m0"}, {"a": "m3", "b": "m5"},
                   {"a": "m5", "b": "m4"}, {"a": "m4", "b": "m0"}],
        "patterns": [
            {"id": "p1", "track": "t1", "name": "Motif 1", "steps": 16,
             "lanes": {"bd": kick, "sd": snare, "ch": hats}},
            {"id": "p2", "track": "t2", "name": "Motif 1", "steps": 16, "notes": bass},
        ],
        "clips": [
            {"id": "c1", "track": "t1", "start": 0, "len": 32, "pat": "p1"},
            {"id": "c2", "track": "t2", "start": 16, "len": 16, "pat": "p2"},
        ],
        "pending": [],
        "ui": {"view": "timeline"},
    }


def _summary(p: dict) -> dict:
    return {"id": p["id"], "name": p["name"], "updated": p.get("updated"), "bpm": p.get("bpm"),
            "tracks": len(p.get("tracks") or []), "clips": len(p.get("clips") or [])}


def _write(p: dict) -> None:
    f = _path(p["id"])
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(p, ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)


def _read(pid: str) -> dict:
    f = _path(pid)
    if not f.exists():
        raise HttpError(404, f"projet introuvable : {pid}")
    return json.loads(f.read_text(encoding="utf-8"))


# ── routes des projets ──────────────────────────────────────
def list_projects(req):
    out = []
    for f in _dir().glob("mus-*.json"):
        try:
            out.append(_summary(json.loads(f.read_text(encoding="utf-8"))))
        except (ValueError, KeyError):
            continue
    out.sort(key=lambda s: s.get("updated") or "", reverse=True)
    return {"projects": out}


def create_project(req):
    d = req.json()
    name = (d.get("name") or "").strip()[:80] or "Sans titre"
    p = starter(name)
    now = library.now()
    p.update(id=f"mus-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}", rev=1, created=now, updated=now)
    validate(p)
    with _lock:
        _write(p)
    return p


def get_project(req, pid):
    return _read(pid)


def save_project(req, pid):
    if int(req.headers.get("Content-Length") or 0) > MAX_BYTES:
        raise HttpError(413, "projet trop gros (4 Mo au plus)")
    d = req.json()
    try:
        validate(d)
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    with _lock:
        cur = _read(pid)
        if d.get("rev") != cur.get("rev"):
            raise HttpError(409, "ce projet a changé ailleurs (un autre onglet ?) : il faut le recharger")
        d.update(id=pid, created=cur.get("created"), updated=library.now(), rev=int(cur.get("rev") or 0) + 1)
        _write(d)
    return {"ok": True, "rev": d["rev"], "updated": d["updated"]}


def delete_project(req, pid):
    f = _path(pid)
    if not f.exists():
        raise HttpError(404, f"projet introuvable : {pid}")
    trash = _dir() / "corbeille"
    trash.mkdir(exist_ok=True)
    shutil.move(str(f), str(trash / f.name))
    return {"ok": True, "trashed": pid}


# ── ce que les machines savent faire ────────────────────────
_eng_cache: dict = {"t": 0.0, "v": None}


def _audio_endpoint() -> str | None:
    for ep in config.get("lanes", {}).get("audio", []):
        if ep != "local" and jobs.endpoint_alive(ep)[0]:
            return ep
    return None


def pick_demucs(options: list[str]) -> str:
    """Le modèle htdemucs_ft s'il est déjà sur disque ; jamais un téléchargement
    (les options « ⬇️ » en déclencheraient un, que Cal n'a pas accordé)."""
    for o in options:
        if o.startswith(ON_DISK) and o.endswith(DEMUCS_MODEL):
            return o
    raise ValueError("le modèle Demucs « htdemucs_ft » n'est pas sur disque (models/audio/Demucs) : "
                     "le télécharger demande l'accord de Cal")


def engines(req=None):
    if time.time() - _eng_cache["t"] < 60 and _eng_cache["v"]:
        return _eng_cache["v"]
    extra = {"mode": mode(), "keyscales": KEYSCALES, "timesigs": list(TIMESIGS), "languages": LANGS}
    if mode() == "factice":
        cpu = [e for e in config.get("lanes", {}).get("cpu", [])]
        why = "" if cpu else "aucune voie « cpu » dans la configuration du portail"
        ff = shutil.which("ffmpeg")
        v = {"generate": {"ok": bool(cpu), "model": "son d'essai (factice)", "why": why, "machine": jobs.machine_of("local")},
             "stems": {"ok": bool(cpu and ff), "model": "filtres ffmpeg (factice)",
                       "why": why or ("" if ff else "ffmpeg manque sur la machine du portail"),
                       "machine": jobs.machine_of("local")},
             "note": "mode essai : ACE-Step 1.5 et Demucs se branchent par \"music_engine\": \"ace-step\"", **extra}
        _eng_cache.update(t=time.time(), v=v)
        return v
    lanes = config.get("lanes", {}).get("audio", [])
    gen = {"ok": False, "model": "ACE-Step 1.5 XL base", "why": ""}
    stems = {"ok": False, "model": "Demucs htdemucs_ft", "why": ""}
    if not lanes:
        gen["why"] = stems["why"] = "aucune voie « audio » dans la configuration du portail"
    else:
        ep = _audio_endpoint()
        if not ep:
            gen["why"] = stems["why"] = "le ComfyUI de la voie audio ne répond pas (" + ", ".join(lanes) + ")"
        else:
            c = Comfy(ep)
            machine = jobs.machine_of(ep)
            try:
                unets = c.object_info("UNETLoader")["UNETLoader"]["input"]["required"]["unet_name"][0]
                enc = c.object_info("TextEncodeAceStepAudio1.5")
                if GEN_MODEL not in unets:
                    gen["why"] = f"{GEN_MODEL} absent de models/diffusion_models sur {machine}"
                elif "TextEncodeAceStepAudio1.5" not in enc:
                    gen["why"] = f"le nœud TextEncodeAceStepAudio1.5 manque au ComfyUI de {machine}"
                else:
                    gen.update(ok=True, machine=machine)
            except (ComfyError, KeyError, IndexError) as e:
                gen["why"] = f"ComfyUI de {machine} : {e}"[:300]
            try:
                opts = c.object_info("AudioSeparateDemucs")["AudioSeparateDemucs"]["input"]["required"]["model"][0]
                pick_demucs(opts)
                stems.update(ok=True, machine=machine)
            except ValueError as e:
                stems["why"] = str(e)
            except (ComfyError, KeyError, IndexError) as e:
                stems["why"] = f"le nœud AudioSeparateDemucs manque au ComfyUI de {machine} ({e})"[:300]
    v = {"generate": gen, "stems": stems, **extra}
    _eng_cache.update(t=time.time(), v=v)
    return v


# ── génération : ACE-Step 1.5 ───────────────────────────────
def gen_params(d: dict) -> dict:
    """Les réglages d'une génération, bornés comme le dit la documentation
    d'ACE-Step 1.5 ; une valeur hors bornes est refusée, pas corrigée."""
    tags = (d.get("tags") or "").strip()
    if not tags:
        raise ValueError("décris le style du morceau (genre, instruments, ambiance)")
    if len(tags) > 512:
        raise ValueError("le style tient en 512 signes au plus (ACE-Step 1.5)")
    lyrics = (d.get("lyrics") or "").strip()
    if len(lyrics) > 4096:
        raise ValueError("les paroles tiennent en 4096 signes au plus (ACE-Step 1.5)")
    instrumental = bool(d.get("instrumental")) or not lyrics
    duration = float(d.get("duration", 30))
    if not 10 <= duration <= 600:
        raise ValueError("durée : de 10 à 600 secondes (ACE-Step 1.5)")
    bpm = int(round(float(d.get("bpm", 120))))
    if not 30 <= bpm <= 300:
        raise ValueError("tempo : de 30 à 300 BPM (ACE-Step 1.5)")
    keyscale = d.get("keyscale") or "C major"
    if keyscale not in KEYSCALES:
        raise ValueError(f"tonalité inconnue : {keyscale}")
    ts = str(d.get("timesignature") or "4")
    if ts not in TIMESIGS:
        raise ValueError("mesure : 2, 3, 4 ou 6 (6/8)")
    lang = d.get("language") or "fr"
    if lang not in LANGS:
        raise ValueError(f"langue inconnue : {lang}")
    seed = d.get("seed")
    if seed in (None, "", -1):
        seed = random.randint(0, 2 ** 32 - 1)
    seed = int(seed)
    if not 0 <= seed < 2 ** 64:
        raise ValueError("graine invalide")
    title = (d.get("title") or "").strip()[:80] or tags[:60]
    return {"tags": tags, "lyrics": "[Instrumental]" if instrumental else lyrics, "instrumental": instrumental,
            "duration": round(duration, 2), "bpm": bpm, "keyscale": keyscale, "timesignature": ts,
            "language": lang, "seed": seed, "title": title}


def _load_graph(name: str) -> dict:
    g = json.loads((WORKFLOWS / name).read_text(encoding="utf-8"))
    return {k: v for k, v in g.items() if not k.startswith("_")}   # « _source » : la note, pas un nœud


def build_generate_graph(p: dict) -> dict:
    return fill(_load_graph(GEN_GRAPH), {
        "tags": p["tags"], "lyrics": p["lyrics"], "seed": p["seed"], "bpm": p["bpm"],
        "duration": float(p["duration"]), "timesignature": p["timesignature"],
        "language": p["language"], "keyscale": p["keyscale"]})


def run_generate_ace(ctx):
    p = gen_params(ctx.params)
    ctx.progress(0.02, "prépare ACE-Step 1.5")
    graph = build_generate_graph(p)
    t0 = time.time()
    paths = ctx.run_graph(graph, prefix="musique", label="ACE-Step 1.5", timeout=3600)
    secs = round(time.time() - t0, 1)
    ids = []
    for path in paths:
        it = ctx.add(path, kind="audio", title=p["title"], prompt=p["tags"],
                     params={**p, "engine": "ace-step", "graph": GEN_GRAPH, "model": GEN_MODEL,
                             "render_seconds": secs},
                     origin={"model": "ace-step-1.5-xl-base"}, tags=["musique", "généré"], folder="Musique")
        ids.append(it["id"])
    return {"note": f"{p['duration']:g} s de musique en {secs:g} s", "render_seconds": secs, "audio": ids}


# ── le mode essai : un son synthétisé, sans modèle ──────────
_PC = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7,
       "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def test_tone(path: Path, p: dict, sr: int = 48000) -> float:
    """Le son d'essai : une mesure (arpège de l'accord de la tonalité en
    croches, une grosse caisse à chaque temps) calculée une fois puis
    répétée jusqu'à la durée demandée. WAV 16 bits stéréo, 48 kHz comme
    ACE-Step. Ce n'est pas de la musique générée : c'est un repère qui
    prouve que le tempo, la tonalité et la durée ont fait tout le trajet."""
    note, scale = p["keyscale"].split(" ")
    root = 48 + _PC[note]
    third = 3 if scale == "minor" else 4
    arp = [root, root + third, root + 7, root + 12, root + 7, root + third, root, root - 5]
    beats = int(p["timesignature"])
    spb = 60.0 / p["bpm"]
    bar_n = int(round(beats * spb * sr))
    bar = [0.0] * bar_n
    eighth = spb / 2
    for k in range(beats * 2):                       # l'arpège, une note par croche
        f = 440.0 * 2 ** ((arp[k % len(arp)] - 69) / 12)
        t0 = int(k * eighth * sr)
        for i in range(min(int(eighth * sr), bar_n - t0)):
            t = i / sr
            env = math.exp(-t * 6.0) * min(1.0, t / 0.004)
            bar[t0 + i] += 0.28 * env * (math.sin(2 * math.pi * f * t) + 0.3 * math.sin(4 * math.pi * f * t))
    for k in range(beats):                           # la grosse caisse : sinus qui chute de 120 Hz
        t0 = int(k * spb * sr)
        ph = 0.0
        for i in range(min(int(0.4 * sr), bar_n - t0)):
            t = i / sr
            ph += 2 * math.pi * (45 + 75 * math.exp(-t * 18)) / sr
            bar[t0 + i] += 0.7 * math.exp(-t * 7) * math.sin(ph)
    peak = max(1e-9, max(abs(x) for x in bar))
    pcm = array("h", (int(x / peak * 0.7 * 32767) for x in bar for _ in (0, 1)))
    total = int(p["duration"] * sr)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        left = total
        while left > 0:
            n = min(left, bar_n)
            w.writeframes(pcm[: n * 2].tobytes())
            left -= n
    return total / sr


def run_generate_test(ctx):
    p = gen_params(ctx.params)
    ctx.progress(0.1, "son d'essai (mode factice)")
    t0 = time.time()
    dest = ctx.workdir / "essai.wav"
    test_tone(dest, p)
    ctx.check()
    secs = round(time.time() - t0, 1)
    it = ctx.add(dest, kind="audio", title=f"{p['title']} (essai)", prompt=p["tags"],
                 params={**p, "engine": "factice", "render_seconds": secs},
                 origin={"model": "factice"}, tags=["musique", "essai"], folder="Musique")
    return {"note": f"son d'essai de {p['duration']:g} s (mode factice)", "render_seconds": secs, "audio": [it["id"]]}


def api_generate(req):
    d = req.json()
    try:
        p = gen_params(d)
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    j = jobs.submit("music.generate", p, title=f"Musique · {p['title']}"[:90], tool="music")
    return jobs.public(j)


# ── séparation : Demucs ─────────────────────────────────────
def build_stems_graph(audio_name: str, model: str) -> dict:
    """Réglages du nœud AudioSeparateDemucs tels que l'exemple « 04_Demucs »
    du paquet AudioSeparation : shifts 0, overlap 0.25, segment du modèle."""
    g = {"1": {"class_type": "LoadAudio", "_meta": {"title": "son"}, "inputs": {"audio": audio_name}},
         "2": {"class_type": "AudioSeparateDemucs", "_meta": {"title": "Demucs"},
               "inputs": {"input_sound": ["1", 0], "model": model, "shifts": 0, "overlap": 0.25,
                          "custom_segment": False, "segment": 44, "target_device": "cuda"}}}
    for k, (stem, fr) in enumerate(STEMS):
        g[str(10 + k)] = {"class_type": "SaveAudioAdvanced", "_meta": {"title": f"OUT {stem}"},
                          "inputs": {"audio": ["2", k], "filename_prefix": f"showrunner/stem_{stem}",
                                     "format": "flac"}}
    return g


def _stem_source(ctx) -> dict:
    it = library.get(ctx.params.get("item", ""))
    if not it or it["kind"] != "audio":
        raise ValueError("le son à séparer n'est plus dans la bibliothèque")
    return it


# mode essai : des filtres ffmpeg (passe-haut / passe-bas, documentation
# ffmpeg-filters), pas une séparation — de quoi éprouver le parcours
TEST_FILTERS = {"vocals": "highpass=f=300,lowpass=f=3400", "drums": "highpass=f=4000",
                "bass": "lowpass=f=160", "other": "highpass=f=160,lowpass=f=4000"}


def run_stems_test(ctx):
    it = _stem_source(ctx)
    src = library.path_of(it)
    out = {}
    fr = dict(STEMS)
    t0 = time.time()
    for k, (stem, _) in enumerate(STEMS):
        ctx.check()
        ctx.progress(k / len(STEMS), f"filtre {fr[stem]} (mode factice)")
        dest = ctx.workdir / f"{stem}.flac"
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", TEST_FILTERS[stem],
                            "-c:a", "flac", str(dest)], capture_output=True, text=True, timeout=600)
        if r.returncode != 0 or not dest.exists():
            raise RuntimeError(f"ffmpeg : {r.stderr.strip()[:400]}")
        got = ctx.add(dest, kind="audio", title=f"{it.get('title') or it['id']} · {fr[stem]} (essai)",
                      parents=[it["id"]], params={"stem": stem, "source": it["id"], "engine": "factice",
                                                  "filter": TEST_FILTERS[stem]},
                      origin={"model": "factice"}, tags=["musique", "essai"], folder="Musique")
        out[stem] = got["id"]
    secs = round(time.time() - t0, 1)
    return {"note": f"4 pistes d'essai en {secs:g} s (filtres, mode factice)", "stems": out, "render_seconds": secs}


def run_stems_demucs(ctx):
    it = _stem_source(ctx)
    ctx.progress(0.05, "envoie le son à ComfyUI")
    name = ctx.comfy.upload(library.path_of(it))
    opts = ctx.comfy.object_info("AudioSeparateDemucs")["AudioSeparateDemucs"]["input"]["required"]["model"][0]
    graph = build_stems_graph(name, pick_demucs(opts))
    ctx.check()
    t0 = time.time()
    pid = ctx.comfy.queue(graph)
    entry = ctx.comfy.wait(pid, cancelled=ctx.cancelled, report=ctx.comfy_report("Demucs"), timeout=3600)
    secs = round(time.time() - t0, 1)
    out = {}
    fr = dict(STEMS)
    for f in Comfy.outputs(entry, graph):
        stem = graph[f["node"]]["_meta"]["title"].split(" ", 1)[1]
        dest = ctx.comfy.download(f, ctx.workdir / f"{stem}.flac")
        got = ctx.add(dest, kind="audio", title=f"{it.get('title') or it['id']} · {fr[stem]}",
                      prompt=it.get("prompt", ""), parents=[it["id"]],
                      params={"stem": stem, "source": it["id"], "engine": "ace-step", "model": "htdemucs_ft",
                              "render_seconds": secs},
                      origin={"model": "demucs-htdemucs_ft"}, tags=["musique", "piste séparée"], folder="Musique")
        out[stem] = got["id"]
    if len(out) != len(STEMS):
        raise ComfyError(f"Demucs n'a rendu que {len(out)} pistes sur {len(STEMS)}")
    return {"note": f"4 pistes en {secs:g} s", "stems": out, "render_seconds": secs}


def api_stems(req):
    d = req.json()
    it = library.get(d.get("item", ""))
    if not it or it["kind"] != "audio":
        raise HttpError(400, "choisis un son de la bibliothèque")
    j = jobs.submit("music.stems", {"item": it["id"]}, title=f"Séparer · {it.get('title') or it['id']}"[:90],
                    tool="music")
    return jobs.public(j)


def register(app) -> None:
    if mode() == "ace-step":
        jobs.register("music.generate", run_generate_ace, lane="audio", title="Musique")
        jobs.register("music.stems", run_stems_demucs, lane="audio", title="Séparer un son")
    else:
        jobs.register("music.generate", run_generate_test, lane="cpu", title="Musique (essai)")
        jobs.register("music.stems", run_stems_test, lane="cpu", title="Séparer un son (essai)")
    app.route("GET", "/api/music/projects", list_projects)
    app.route("POST", "/api/music/projects", create_project)
    app.route("GET", "/api/music/projects/{pid}", get_project)
    app.route("POST", "/api/music/projects/{pid}", save_project)
    app.route("POST", "/api/music/projects/{pid}/delete", delete_project)
    app.route("GET", "/api/music/engines", engines)
    app.route("POST", "/api/music/generate", api_generate)
    app.route("POST", "/api/music/stems", api_stems)


# ── le contrôle sans GPU (tools/check.py) ───────────────────
def selftest(call, ok) -> None:
    st, p = call("POST", "/api/music/projects", {"name": "Essai"})
    ok(st == 200 and PID_RX.fullmatch(p.get("id", "")) and len(p["tracks"]) == 2, f"un projet neuf ({st} {p})")
    pid = p.get("id", "")
    st, lst = call("GET", "/api/music/projects")
    ok(st == 200 and any(x["id"] == pid for x in lst["projects"]), "la liste des projets")
    st, got = call("GET", f"/api/music/projects/{pid}")
    ok(st == 200 and got["rev"] == 1 and got["modules"][-1]["type"] == "master", "relire un projet")

    got["bpm"] = 128
    st, r = call("POST", f"/api/music/projects/{pid}", got)
    ok(st == 200 and r.get("rev") == 2, f"enregistrer ({st} {r})")
    st, r = call("POST", f"/api/music/projects/{pid}", got)
    ok(st == 409, f"une version dépassée est refusée ({st})")
    got["rev"] = 2

    bad = json.loads(json.dumps(got))
    bad["cables"].append({"a": "m0", "b": "m2"})
    st, r = call("POST", f"/api/music/projects/{pid}", bad)
    ok(st == 400 and "sortie" in r.get("error", ""), f"la sortie ne se câble vers rien ({st} {r})")
    bad = json.loads(json.dumps(got))
    bad["cables"].append({"a": "m4", "b": "m5"})
    st, r = call("POST", f"/api/music/projects/{pid}", bad)
    ok(st == 400 and "boucle" in r.get("error", ""), f"une boucle est refusée ({st} {r})")
    bad = json.loads(json.dumps(got))
    bad["bpm"] = 999
    st, r = call("POST", f"/api/music/projects/{pid}", bad)
    ok(st == 400, "un tempo hors bornes est refusé")
    bad = json.loads(json.dumps(got))
    bad["modules"].append({"id": "m9", "type": "theremine", "track": None, "x": 0, "y": 0, "params": {}})
    st, r = call("POST", f"/api/music/projects/{pid}", bad)
    ok(st == 400 and "inconnu" in r.get("error", ""), "un module inconnu est refusé")
    bad = json.loads(json.dumps(got))
    bad["clips"].append({"id": "c9", "track": "t1", "start": 0, "len": 4, "pat": "p2"})
    st, r = call("POST", f"/api/music/projects/{pid}", bad)
    ok(st == 400, "un clip qui joue le motif d'une autre piste est refusé")

    st, eng = call("GET", "/api/music/engines")
    ok(st == 200 and eng.get("mode") == "factice" and eng["generate"]["ok"], f"mode essai par défaut ({eng})")
    ok(len(eng.get("keyscales", [])) == 34, "les 34 tonalités du nœud ACE-Step")

    p1 = gen_params({"tags": "synthwave, basse analogique", "duration": 30, "bpm": 110, "keyscale": "A minor",
                     "timesignature": "4", "language": "fr", "seed": 7})
    g = build_generate_graph(p1)
    ok(p1["lyrics"] == "[Instrumental]" and p1["instrumental"], "sans paroles : [Instrumental] (doc ACE-Step)")
    ok(g["94"]["inputs"]["tags"] == "synthwave, basse analogique" and g["94"]["inputs"]["seed"] == 7
       and g["98"]["inputs"]["seconds"] == 30.0 and g["94"]["inputs"]["duration"] == 30.0
       and g["3"]["inputs"]["seed"] == 7 and g["94"]["inputs"]["bpm"] == 110, "le graphe ACE-Step est rempli")
    ok("{{" not in json.dumps(g) and not any(k.startswith("_") for k in g), "plus aucun trou ni note dans le graphe")
    ok(g["111"]["_meta"]["title"] == "OUT" and g["104"]["inputs"]["unet_name"] == GEN_MODEL, "sortie et modèle")
    p2 = gen_params({"tags": "ballade", "lyrics": "[Verse]\nla nuit tombe", "seed": 3})
    ok(p2["lyrics"].startswith("[Verse]") and not p2["instrumental"], "des paroles passent telles quelles")
    for bad_p, why in (({"tags": ""}, "style vide"), ({"tags": "x", "duration": 5}, "durée < 10 s"),
                       ({"tags": "x", "keyscale": "H major"}, "tonalité inconnue"),
                       ({"tags": "x", "bpm": 400}, "tempo > 300"), ({"tags": "x" * 513}, "style > 512")):
        try:
            gen_params(bad_p)
            ok(False, f"refusé : {why}")
        except ValueError:
            ok(True, why)
    st, r = call("POST", "/api/music/generate", {"tags": ""})
    ok(st == 400 and r.get("error"), "une génération sans style est refusée à l'entrée")

    def wait(jid):
        for _ in range(300):
            s, jj = call("GET", f"/api/jobs/{jid}")
            if jj.get("state") in ("done", "error", "cancelled"):
                return jj
            time.sleep(0.2)
        return jj

    st, j = call("POST", "/api/music/generate", {"tags": "essai", "duration": 12, "bpm": 120,
                                                 "keyscale": "A minor", "timesignature": "4"})
    ok(st == 200 and j.get("state") == "queued" and j["params"]["lyrics"] == "[Instrumental]", f"une génération en file ({st})")
    j = wait(j["id"]) if st == 200 else {}
    items = j.get("items") or []
    ok(j.get("state") == "done" and len(items) == 1 and items[0]["kind"] == "audio"
       and abs((items[0].get("duration") or 0) - 12) < 0.05 and items[0]["params"]["engine"] == "factice"
       and items[0]["params"]["bpm"] == 120, f"le son d'essai rentre dans la bibliothèque ({j.get('state')} {j.get('message')})")
    if items and shutil.which("ffmpeg"):
        st, sj = call("POST", "/api/music/stems", {"item": items[0]["id"]})
        sj = wait(sj["id"]) if st == 200 else {}
        stems = (sj.get("result") or {}).get("stems") or {}
        ok(sj.get("state") == "done" and set(stems) == {"vocals", "drums", "bass", "other"}
           and all(i["parents"] == [items[0]["id"]] for i in sj.get("items", [])),
           f"quatre pistes d'essai, filles du son ({sj.get('state')} {sj.get('message')})")
    st, r = call("POST", "/api/music/stems", {"item": "aud-nexiste-pas"})
    ok(st == 400, "séparer un son absent est refusé")

    sg = build_stems_graph("x.flac", ON_DISK + " " + DEMUCS_MODEL)
    outs = [v["_meta"]["title"] for v in sg.values() if v["_meta"]["title"].startswith("OUT")]
    ok(outs == ["OUT vocals", "OUT drums", "OUT bass", "OUT other"], "quatre sorties Demucs dans l'ordre du nœud")
    ok(pick_demucs(["⬇️  Hybrid Transformer", ON_DISK + " Hybrid Transformer fine-tuned"]).startswith(ON_DISK),
       "le modèle Demucs sur disque est choisi")
    try:
        pick_demucs(["⬇️  Hybrid Transformer fine-tuned"])
        ok(False, "un modèle à télécharger est refusé")
    except ValueError:
        ok(True, "un modèle à télécharger est refusé")

    st, r = call("POST", f"/api/music/projects/{pid}/delete")
    st2, _ = call("GET", f"/api/music/projects/{pid}")
    ok(st == 200 and st2 == 404, "un projet va à la corbeille")
    st, _ = call("GET", "/api/music/projects/..%2F..%2Fjobs")
    ok(st in (400, 404), "un identifiant de projet douteux est refusé")
