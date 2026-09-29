"""ODIO, le studio musique du portail : les projets et la génération ACE-Step.

Le son se fait dans la page (Web Audio, `musique/`) ; le serveur garde les
projets, les valide, et porte la génération ACE-Step :

  music.generate      ACE-Step 1.5 : un morceau à partir d'un style et de
                      paroles facultatives (ci-dessous)

Les deux autres travaux d'ODIO sont tenus ailleurs, chacun avec son moteur
d'essai : `music.yue` (YuE2, server/tools/music_yue.py) et `music.stems`
(la séparation en pistes, server/tools/music_stems.py). Ce module dit
seulement s'ils sont déclarés (`GET /api/music/engines` → `contracts`) : la
page ne demande leurs options que dans ce cas.

ACE-Step : deux moteurs, par le réglage `music_engine` de
`showrunner.local.json` (lu au démarrage) :

  "factice"  (défaut)  voie `cpu`, sans modèle : un son d'essai synthétisé
                       dans la tonalité et au tempo demandés. Décision de Cal
                       du 28/09 : l'interface d'abord, les modèles après.
  "ace-step"           voie `audio` (ComfyUI :8188) : ACE-Step 1.5 XL base
                       avec le graphe du gabarit officiel
                       (`server/workflows/music_ace15_xl_base.json`).
                       Essayé une fois sur DGX2 le 28/09 (docs/etudes/musique.md).

Tout son créé va dans la bibliothèque (`kind: audio`, la recette dans
`params`, `params.engine` dit lequel). Un projet :
`<data_dir>/musique/<id>.json`, version 2 (musique/projet.js en décrit la
forme ; un projet de version 1 est migré par la page et reste accepté ici).

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
import threading
import time
import wave
from array import array
from pathlib import Path

from core import config, jobs, library
from core.comfy import Comfy, ComfyError, fill
from core.http import HttpError

from . import music_jouets   # jouets : les jouets du Playground, leurs câbles de notes et de valeur

WORKFLOWS = Path(__file__).resolve().parents[1] / "workflows"
GEN_GRAPH = "music_ace15_xl_base.json"
GEN_MODEL = "acestep_v1.5_xl_base_bf16.safetensors"
PID_RX = re.compile(r"mus-\d{8}-\d{6}-[0-9a-f]{4}")
ID_RX = re.compile(r"[a-z][a-z0-9]{0,23}")
MAX_BYTES = 4 << 20

# ── ce que la page sait jouer (musique/modules.js en est la vérité) ──
# Les modules d'ODIO (le prototype de Cal, porté dans musique/odio/) : leurs
# sortes seulement ; leurs réglages sont les leurs.
ODIO_SOURCES = {"rythme", "analog", "acid", "plaits"}
ODIO_EFFECTS = {"reverbe", "chorus", "rtt", "comp3", "eq3", "filtre", "satura", "crush", "table", "volume"}
SOURCES = {"drums", "synth", "sampler", "player"} | ODIO_SOURCES
EFFECTS = {"delay", "reverb", "comp", "eq", "filter", "dist"} | ODIO_EFFECTS
MODULE_TYPES = SOURCES | EFFECTS | {"strip", "master", "bus"} | music_jouets.TYPES   # jouets : leurs sortes
TRACK_SOURCES = {"drums": {"drums", "rythme"}, "synth": {"synth", "analog", "acid", "plaits"},
                 "sampler": {"sampler"}, "audio": {"player"}, "bus": {"bus"}}
COLORS = {"or", "cy", "amb", "grn2", "coral-1", "coral-2", "coral-3"}
# les voix de la DR-9 et celles de la boîte à rythme d'ODIO (onze, TR-8S)
DRUM_VOICES = ("bd", "sd", "cp", "ch", "oh", "lt", "ht", "cb", "mt", "rs", "cc", "rc")
SIGS = (2, 3, 4, 6)
MODES = {"major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonic",
         "pentamaj", "pentamin", "blues"}
ARC_TO = ("lpf", "vol", "both")
TEMPLATES = ("rythme", "session", "vide")
GEN_MODELS = ("ace", "yue")          # musique/generatif_modeles.json, « modeles »

# ── les listes du nœud TextEncodeAceStepAudio1.5 (object_info, DGX2, 28/09) ──
_NOTES = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"]
KEYSCALES = [f"{n} major" for n in _NOTES] + [f"{n} minor" for n in _NOTES]
TIMESIGS = ("2", "3", "4", "6")
LANGS = ("ar az bg bn ca cs da de el en es fa fi fr he hi hr ht hu id is it ja ko la lt ms ne nl no pa pl "
         "pt ro ru sa sk sr sv sw ta te th tl tr uk ur vi yue zh unknown").split()

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


def _bool(d: dict, k: str, what: str) -> None:
    if k in d and d[k] is not None and not isinstance(d[k], bool):
        raise ValueError(f"{what} : vrai ou faux")


def _curve(pts, what) -> None:
    if not isinstance(pts, list) or len(pts) > 8192:
        raise ValueError(f"{what} : une liste de 8192 points au plus")
    for pt in pts:
        if not isinstance(pt, list) or len(pt) != 2:
            raise ValueError(f"{what} : un point est [temps, valeur]")
        _num(pt[0], 0, 1e5, f"{what} (temps)")
        _num(pt[1], 0, 1, f"{what} (valeur)")


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

    # les groupes de pistes de l'arrangement (29/09, musique/projet.js) : une
    # étiquette sur des pistes qui se suivent, repliée ou non ; pas de son
    groups = p.get("groups", [])
    if not isinstance(groups, list) or len(groups) > 64:
        raise ValueError("groupes de pistes : une liste de 64 au plus")
    gids = set()
    for g in groups:
        gid = _id((g or {}).get("id"), "groupe de pistes")
        if gid in gids:
            raise ValueError(f"groupe de pistes en double : {gid}")
        gids.add(gid)
        _str(g.get("name"), 40, "nom de groupe", 1)
        _bool(g, "fold", f"{g['name']} : replié")

    by_track: dict = {}
    for t in tracks:
        tid = _id((t or {}).get("id"), "piste")
        if tid in by_track:
            raise ValueError(f"piste en double : {tid}")
        _str(t.get("name"), 60, "nom de piste", 1)
        if t.get("kind") not in TRACK_SOURCES:
            raise ValueError(f"sorte de piste inconnue : {t.get('kind')!r}")
        if t.get("color") not in COLORS:
            raise ValueError(f"couleur de piste inconnue : {t.get('color')!r}")
        if t.get("sub") is not None:
            _str(t["sub"], 60, "sous-titre de piste")
        if t.get("grp") is not None and t["grp"] not in gids:
            raise ValueError(f"{t['name']} : groupe de pistes inconnu ({t['grp']!r})")
        for k in ("mute", "solo", "arm"):
            _bool(t, k, f"{t['name']} : {k}")
        # une piste générative (29/09) : une piste audio qui porte son modèle et
        # sa tâche par défaut (musique/generatif_region.js, music_gen.py)
        if t.get("gen") is not None:
            if t["kind"] != "audio" or not isinstance(t["gen"], dict) or len(json.dumps(t["gen"])) > 4096:
                raise ValueError(f"{t['name']} : une piste générative est une piste audio (4 ko de réglages au plus)")
            if t["gen"].get("model") not in GEN_MODELS:
                raise ValueError(f"{t['name']} : modèle génératif inconnu ({t['gen'].get('model')!r})")
        src, strip = by_mod.get(t.get("src")), by_mod.get(t.get("strip"))
        if not src or src["type"] not in TRACK_SOURCES[t["kind"]]:
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
        if c.get("t") is not None:   # jouets : un câble de notes ou de valeur, vu par music_jouets.check
            if (a, b, c.get("t"), c.get("k")) in seen:
                raise ValueError("câble en double")
            seen.add((a, b, c.get("t"), c.get("k")))
            continue
        if by_mod[a]["type"] == "master":
            raise ValueError("la sortie ne se câble vers rien")
        if by_mod[b]["type"] in SOURCES:
            raise ValueError(f"{by_mod[b]['type']} n'a pas d'entrée")
        if (a, b) in seen:
            raise ValueError("câble en double")
        if c.get("send") is not None:
            _num(c["send"], -60, 6, "niveau d'envoi (dB)")
        seen.add((a, b))
    if _cycle(set(by_mod), [c for c in cables if c.get("t") is None]):   # jouets : le son seul
        raise ValueError("le câblage fait une boucle : le son tournerait sans fin")
    music_jouets.check(p, by_mod)   # jouets : leurs câbles, leurs boucles, le chemin de l'aimant

    by_pat: dict = {}
    for pt in pats:
        pid = _id((pt or {}).get("id"), "motif")
        tr = by_track.get(pt.get("track"))
        if not tr or tr["kind"] in ("audio", "bus"):
            raise ValueError(f"{pid} : piste absente ou sans motif")
        steps = pt.get("steps")
        if not isinstance(steps, int) or isinstance(steps, bool) or not (4 <= steps <= 256) or steps % 4:
            raise ValueError(f"{pid} : de 4 à 256 pas, par quatre")
        _str(pt.get("name", ""), 40, "nom de motif")
        if tr["kind"] == "drums":
            lanes = pt.get("lanes")
            if not isinstance(lanes, dict) or not set(lanes) <= set(DRUM_VOICES):
                raise ValueError(f"{pid} : voix de batterie inconnues")
            for v in lanes.values():
                if not isinstance(v, list) or len(v) != steps:
                    raise ValueError(f"{pid} : une case par pas")
                for x in v:
                    _num(x, 0, 1, "vélocité")
        else:
            notes = pt.get("notes")
            if not isinstance(notes, list) or len(notes) > 4000:
                raise ValueError(f"{pid} : notes invalides")
            for nt in notes:
                _num((nt or {}).get("s"), 0, steps - 1e-6, "départ de note")
                _num(nt.get("l"), 0.0625, steps, "longueur de note")
                _num(nt.get("p"), 0, 127, "hauteur de note")
                _num(nt.get("v", 0.8), 0, 1, "vélocité")
                _bool(nt, "ac", "accent")
                _bool(nt, "sl", "liaison")
        by_pat[pid] = pt
    cids = set()
    for c in clips:
        cid = _id((c or {}).get("id"), "clip")
        if cid in cids:
            raise ValueError(f"clip en double : {cid}")
        cids.add(cid)
        tr = by_track.get(c.get("track"))
        if not tr or tr["kind"] == "bus":
            raise ValueError(f"{cid} : piste absente")
        _num(c.get("start"), 0, 1e5, "début de clip")
        _num(c.get("len"), 0.0625, 1e5, "longueur de clip")
        for k in ("mute", "loop"):
            _bool(c, k, f"{cid} : {k}")
        if c.get("name") is not None:
            _str(c["name"], 60, "nom de clip")
        if tr["kind"] == "audio":
            # une région générative (`gen` : modèle, tâche, réglages, prises) n'a
            # de son qu'une fois une prise choisie
            g = c.get("gen")
            if g is not None:
                if not isinstance(g, dict) or len(json.dumps(g)) > 98304:
                    raise ValueError(f"{cid} : région générative, 96 ko au plus")
                if g.get("model") not in GEN_MODELS:
                    raise ValueError(f"{cid} : modèle génératif inconnu ({g.get('model')!r})")
                takes = g.get("takes", [])
                if not isinstance(takes, list) or len(takes) > 64 or not all(isinstance(x, dict) and isinstance(x.get("item"), str) for x in takes):
                    raise ValueError(f"{cid} : prises, 64 au plus, chacune un son")
            if g is None or c.get("item") is not None:
                _str(c.get("item"), 64, "son du clip", 1)
            _num(c.get("off", 0), 0, 1e5, "décalage du clip")
            _num(c.get("gain", 0) or 0, -60, 24, "gain du clip (dB)")
            _num(c.get("fi", 0) or 0, 0, 600, "fondu d'entrée (s)")
            _num(c.get("fo", 0) or 0, 0, 600, "fondu de sortie (s)")
            if c.get("llen") is not None:
                _num(c["llen"], 0, 1e5, "longueur de boucle (s)")
            # transposition (demi-tons, vitesse et hauteur ensemble), à
            # l'envers, début de la boucle dans le son (29/09)
            _num(c.get("pitch", 0) or 0, -48, 48, "transposition du clip (demi-tons)")
            _bool(c, "rev", f"{cid} : rev")
            if c.get("ls") is not None:
                _num(c["ls"], 0, 1e5, "début de boucle (s)")
        elif c.get("pat") not in by_pat or by_pat[c["pat"]]["track"] != tr["id"]:
            raise ValueError(f"{cid} : motif absent")
        else:
            _num(c.get("off", 0), 0, 1e5, "décalage du motif")
    pend = p.get("pending", [])
    if not isinstance(pend, list) or len(pend) > 64:
        raise ValueError("travaux en attente invalides")

    # ── la version 2 : tonalité, sections, marqueurs, arc, automation ──
    key = p.get("key")
    if key is not None:
        if not isinstance(key, dict) or key.get("mode") not in MODES:
            raise ValueError("tonalité : un mode connu")
        _num(key.get("tonic"), 0, 11, "tonique")
    secs = p.get("sections", [])
    if not isinstance(secs, list) or len(secs) > 128:
        raise ValueError("sections : une liste de 128 au plus")
    sids = set()
    for s in secs:
        sid = _id((s or {}).get("id"), "section")
        if sid in sids:
            raise ValueError(f"section en double : {sid}")
        sids.add(sid)
        _str(s.get("name"), 40, "nom de section", 1)
        sa = _num(s.get("a"), 0, 1e5, "début de section")
        sb = _num(s.get("b"), 0, 1e5, "fin de section")
        if sb <= sa:
            raise ValueError(f"{s['name']} : la section finit avant de commencer")
        if s.get("color") is not None and s["color"] not in COLORS:
            raise ValueError(f"{s['name']} : couleur inconnue")
        if s.get("tag") is not None:
            _str(s["tag"], 20, "étiquette de section")
    marks = p.get("markers", [])
    if not isinstance(marks, list) or len(marks) > 256:
        raise ValueError("marqueurs : une liste de 256 au plus")
    for mk in marks:
        _id((mk or {}).get("id"), "marqueur")
        _num(mk.get("b"), 0, 1e5, "position du marqueur")
        _str(mk.get("name", ""), 40, "nom de marqueur")
    arc = p.get("arc")
    if arc is not None:
        if not isinstance(arc, dict) or arc.get("to", "lpf") not in ARC_TO:
            raise ValueError("arc d'énergie : filtre, volume ou les deux")
        _bool(arc, "on", "arc d'énergie")
        _curve(arc.get("pts", []), "arc d'énergie")
    autos = p.get("auto", [])
    if not isinstance(autos, list) or len(autos) > 256:
        raise ValueError("automation : 256 voies au plus")
    for L in autos:
        _id((L or {}).get("id"), "voie d'automation")
        if L.get("mod") not in by_mod:
            raise ValueError("automation : module absent")
        _str(L.get("k"), 24, "réglage automatisé", 1)
        _bool(L, "on", "automation")
        _curve(L.get("pts", []), "automation")
    gen = p.get("gen")
    if gen is not None and (not isinstance(gen, dict) or len(json.dumps(gen)) > 65536):
        raise ValueError("brouillon du génératif : 64 ko au plus")
    # les réglages enregistrés (le navigateur, « Les miens ») et le banc du
    # nodal (segments, attracteurs, la courbe de tension) — 29/09
    pres = p.get("presets", [])
    if not isinstance(pres, list) or len(pres) > 200:
        raise ValueError("réglages enregistrés : 200 au plus")
    rids = set()
    for r in pres:
        rid = _id((r or {}).get("id"), "réglage")
        if rid in rids:
            raise ValueError(f"réglage en double : {rid}")
        rids.add(rid)
        _str(r.get("name"), 40, "nom de réglage", 1)
        if r.get("type") not in SOURCES:
            raise ValueError(f"{r['name']} : un réglage de source connue")
        if not isinstance(r.get("params", {}), dict) or len(r.get("params", {})) > 200:
            raise ValueError(f"{r['name']} : réglages invalides")
    banc = p.get("banc")
    if banc is not None and (not isinstance(banc, dict) or len(json.dumps(banc)) > 65536):
        raise ValueError("banc du nodal : 64 ko au plus")
    if isinstance(banc, dict):
        for k in ("segs", "atts"):
            if not isinstance(banc.get(k, []), list) or len(banc.get(k, [])) > 256:
                raise ValueError(f"banc du nodal : {k}, 256 au plus")
        if banc.get("ten") is not None:
            _curve(banc["ten"], "courbe de tension")


# ── les projets de départ ───────────────────────────────────
def _v2(p: dict, **extra) -> dict:
    p.update({"v": 2, "key": {"tonic": 9, "mode": "minor"}, "sections": [], "markers": [],
              "arc": {"on": True, "to": "lpf", "pts": []}, "auto": []})
    p.update(extra)
    return p


def starter(name: str) -> dict:
    """Une batterie et une basse sur huit mesures, câblées source → tranche
    → sortie. Les réglages absents prennent leur défaut dans la page."""
    kick = [1, 0, 0, 0] * 4
    snare = [0, 0, 0, 0, 1, 0, 0, 0] * 2
    hats = [0, 0, 1, 0] * 4
    bass = [{"s": s, "l": 2, "p": p, "v": 0.85} for s, p in
            ((0, 45), (3, 45), (6, 57), (8, 43), (11, 43), (14, 55))]
    return _v2({
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
    })


def _steps(s: str, vel: float = 1.0) -> list:
    return [vel if ch == "x" else round(vel * 0.55, 2) if ch == "o" else 0 for ch in s]


def session(name: str) -> dict:
    """La session de la maquette « STUDIO · NL—60 » de Cal : 16 mesures en
    quatre sections (intro, couplet, refrain, final), 112 BPM, fa mineur ;
    batterie (boîte à rythme d'ODIO), basse acide (ODIO), nappe de trois scies,
    lead carré et scie ; deux bus (réverbération, RTT-01) et leurs envois.
    Les notes sont écrites à la main dans la gamme (choix d'écriture)."""
    kit_intro = {"bd": _steps("x.......x......."), "ch": _steps("x.x.x.x.x.x.x.x.", 0.6)}
    kit = {"bd": _steps("x.....x.x......."), "sd": _steps("....x.......x..."),
           "ch": _steps("x.x.x.x.x.x.x.x.", 0.7), "oh": _steps("..............x.", 0.8)}
    roots = (41, 37, 44, 39)                                  # fa, ré bémol, la bémol, mi bémol
    bass = []
    for i, r in enumerate(roots):
        o = 16 * i
        bass += [{"s": o, "l": 2, "p": r, "v": 0.9}, {"s": o + 3, "l": 1, "p": r, "v": 0.7},
                 {"s": o + 6, "l": 2, "p": r + 12, "v": 0.9, "ac": True}, {"s": o + 8, "l": 2, "p": r, "v": 0.8},
                 {"s": o + 10, "l": 1, "p": r + 7, "v": 0.7}, {"s": o + 11, "l": 1, "p": r + 12, "v": 0.8, "sl": True},
                 {"s": o + 14, "l": 2, "p": r, "v": 0.8}]
    chords = ((53, 56, 60), (49, 53, 56), (48, 51, 56), (51, 55, 58))
    pad = [{"s": 16 * i, "l": 16, "p": n, "v": 0.7} for i, ch in enumerate(chords) for n in ch]
    lead = [{"s": s, "l": l, "p": p, "v": 0.8} for s, l, p in (
        (0, 4, 72), (4, 2, 68), (6, 2, 67), (8, 4, 65), (12, 4, 68),
        (16, 4, 65), (20, 2, 68), (22, 2, 70), (24, 8, 72),
        (32, 4, 75), (36, 4, 72), (40, 4, 68), (44, 4, 72),
        (48, 6, 70), (54, 2, 67), (56, 4, 63), (60, 2, 67), (62, 2, 70))]
    T = [("t1", "Batterie", "drums", "or", "kit · 4 voix", "rythme", {"kit": 0}, 0),
         ("t2", "Basse", "synth", "grn2", "scie · filtre", "acid", {}, -2),
         ("t3", "Nappe", "synth", "cy", "3 scies désaccordées", "synth",
          {"wave": 2, "oct": 0, "uni": 3, "det": 14, "wave2": 5, "cut": 2200, "res": 2, "fenv": 0.5, "fdec": 1.2,
           "a": 0.35, "d": 1.5, "s": 0.8, "r": 1.4, "vol": -17}, -4),
         ("t4", "Lead", "synth", "coral-2", "carré · scie", "synth",
          {"wave": 3, "oct": 0, "uni": 1, "det": 8, "wave2": 3, "oct2": 0, "mix2": 0.45, "cut": 3200, "res": 5,
           "fenv": 1.5, "fdec": 0.3, "a": 0.005, "d": 0.25, "s": 0.7, "r": 0.2, "vol": -15}, -3)]
    tracks, mods, cables = [], [], []
    for i, (tid, nm, kind, color, sub, src, params, vol) in enumerate(T):
        s, st = f"m{2 * i + 1}", f"m{2 * i + 2}"
        tracks.append({"id": tid, "name": nm, "kind": kind, "color": color, "sub": sub, "mute": False, "solo": False,
                       "src": s, "strip": st, "pat": f"p{i + 1}"})
        mods += [{"id": s, "type": src, "track": tid, "x": 40, "y": 40 + 260 * i, "on": True, "params": params},
                 {"id": st, "type": "strip", "track": tid, "x": 380, "y": 40 + 260 * i, "on": True, "params": {"vol": vol}}]
        cables += [{"a": s, "b": st}, {"a": st, "b": "m0"}]
    # deux bus d'effets : entrée → effet (tout mouillé) → tranche → sortie
    for j, (tid, nm, color, fx, fxp) in enumerate((("t8", "Réverb", "cy", "reverb", {"mix": 1, "time": 2.6}),
                                                   ("t9", "RTT-01", "amb", "rtt", {"mix": 100, "time": 400, "fdb": 45}))):
        b, e, st = f"b{j + 1}", f"e{j + 1}", f"s{j + 1}"
        y = 40 + 260 * (4 + j)
        tracks.append({"id": tid, "name": nm, "kind": "bus", "color": color, "mute": False, "solo": False, "src": b, "strip": st})
        mods += [{"id": b, "type": "bus", "track": tid, "x": 40, "y": y, "on": True, "params": {}},
                 {"id": e, "type": fx, "track": tid, "x": 380, "y": y, "on": True, "params": fxp},
                 {"id": st, "type": "strip", "track": tid, "x": 720, "y": y, "on": True, "params": {}}]
        cables += [{"a": b, "b": e}, {"a": e, "b": st}, {"a": st, "b": "m0"}]
    cables += [{"a": "m6", "b": "b1", "send": -8}, {"a": "m8", "b": "b1", "send": -12}, {"a": "m8", "b": "b2", "send": -14},
               {"a": "m2", "b": "b1", "send": -22}]
    mods.append({"id": "m0", "type": "master", "track": None, "x": 1100, "y": 400, "on": True, "params": {}})
    secs = [("s1", "Intro", 0, "cy", "intro"), ("s2", "Couplet", 16, "grn2", "verse"),
            ("s3", "Refrain", 32, "or", "chorus"), ("s4", "Final", 48, "coral-3", "outro")]
    clips = []
    n = 0

    def clip(track, start, pat):
        nonlocal n
        n += 1
        clips.append({"id": f"c{n}", "track": track, "start": start, "len": 16, "pat": pat})

    clip("t1", 0, "p5")
    for a in (16, 32, 48):
        clip("t1", a, "p1")
        clip("t2", a, "p2")
    for a in (0, 16, 32, 48):
        clip("t3", a, "p3")
    for a in (32, 48):
        clip("t4", a, "p4")
    return _v2({
        "name": name, "bpm": 112, "sig": 4, "loop": {"on": False, "a": 0, "b": 16},
        "tracks": tracks, "modules": mods, "cables": cables,
        "patterns": [
            {"id": "p1", "track": "t1", "name": "Kit", "steps": 16, "lanes": kit},
            {"id": "p5", "track": "t1", "name": "Kit", "steps": 16, "lanes": kit_intro},
            {"id": "p2", "track": "t2", "name": "Basse", "steps": 64, "notes": bass},
            {"id": "p3", "track": "t3", "name": "Accords", "steps": 64, "notes": pad},
            {"id": "p4", "track": "t4", "name": "Thème", "steps": 64, "notes": lead},
        ],
        "clips": clips, "pending": [], "ui": {"view": "timeline"},
    }, key={"tonic": 5, "mode": "minor"},
        sections=[{"id": i, "name": nm, "a": a, "b": a + 16, "color": c, "tag": tg} for i, nm, a, c, tg in secs])


def empty(name: str) -> dict:
    return _v2({"name": name, "bpm": 120, "sig": 4, "loop": {"on": False, "a": 0, "b": 16},
                "tracks": [], "modules": [{"id": "m0", "type": "master", "track": None, "x": 600, "y": 200,
                                           "on": True, "params": {}}],
                "cables": [], "patterns": [], "clips": [], "pending": [], "ui": {"view": "timeline"}})


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
    tpl = d.get("template") or "rythme"
    if tpl not in TEMPLATES:
        raise HttpError(400, f"départ inconnu : {tpl} ({', '.join(TEMPLATES)})")
    p = {"rythme": starter, "session": session, "vide": empty}[tpl](name)
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


CONTRACTS = ("music.yue", "music.stems", "music.yue.abc", "music.gen.ace", "music.gen.yue", "music.midi", "music.midi.abc")


def contracts() -> dict:
    """Les travaux tenus par d'autres modules (YuE et sa partition, la
    séparation, les régions génératives, le MIDI) : sont-ils déclarés ? Lu à
    chaque appel — ils se chargent après celui-ci."""
    return {k: k in jobs.HANDLERS for k in CONTRACTS}


def engines(req=None):
    if time.time() - _eng_cache["t"] < 60 and _eng_cache["v"]:
        return {**_eng_cache["v"], "contracts": contracts()}
    extra = {"mode": mode(), "keyscales": KEYSCALES, "timesigs": list(TIMESIGS), "languages": LANGS}
    if mode() == "factice":
        cpu = [e for e in config.get("lanes", {}).get("cpu", [])]
        why = "" if cpu else "aucune voie « cpu » dans la configuration du portail"
        v = {"generate": {"ok": bool(cpu), "model": "son d'essai (factice)", "why": why, "machine": jobs.machine_of("local")},
             "note": "mode essai : ACE-Step 1.5 se branche par \"music_engine\": \"ace-step\"", **extra}
        _eng_cache.update(t=time.time(), v=v)
        return {**v, "contracts": contracts()}
    lanes = config.get("lanes", {}).get("audio", [])
    gen = {"ok": False, "model": "ACE-Step 1.5 XL base", "why": ""}
    if not lanes:
        gen["why"] = "aucune voie « audio » dans la configuration du portail"
    else:
        ep = _audio_endpoint()
        if not ep:
            gen["why"] = "le ComfyUI de la voie audio ne répond pas (" + ", ".join(lanes) + ")"
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
    v = {"generate": gen, **extra}
    _eng_cache.update(t=time.time(), v=v)
    return {**v, "contracts": contracts()}


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


def register(app) -> None:
    if mode() == "ace-step":
        jobs.register("music.generate", run_generate_ace, lane="audio", title="Musique")
    else:
        jobs.register("music.generate", run_generate_test, lane="cpu", title="Musique (essai)")
    app.route("GET", "/api/music/projects", list_projects)
    app.route("POST", "/api/music/projects", create_project)
    app.route("GET", "/api/music/projects/{pid}", get_project)
    app.route("POST", "/api/music/projects/{pid}", save_project)
    app.route("POST", "/api/music/projects/{pid}/delete", delete_project)
    app.route("GET", "/api/music/engines", engines)
    app.route("POST", "/api/music/generate", api_generate)


# ── le contrôle sans GPU (tools/check.py) ───────────────────
def selftest(call, ok) -> None:
    st, p = call("POST", "/api/music/projects", {"name": "Essai"})
    ok(st == 200 and PID_RX.fullmatch(p.get("id", "")) and len(p["tracks"]) == 2 and p.get("v") == 2, f"un projet neuf ({st} {p})")
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

    def refused(mut, why, word=""):
        bad = json.loads(json.dumps(got))
        mut(bad)
        st, r = call("POST", f"/api/music/projects/{pid}", bad)
        ok(st == 400 and word in r.get("error", ""), f"refusé : {why} ({st} {r})")

    refused(lambda b: b["cables"].append({"a": "m0", "b": "m2"}), "la sortie câblée", "sortie")
    refused(lambda b: b["cables"].append({"a": "m4", "b": "m5"}), "une boucle", "boucle")
    refused(lambda b: b.update(bpm=999), "un tempo hors bornes")
    refused(lambda b: b["modules"].append({"id": "m9", "type": "theremine", "track": None, "x": 0, "y": 0, "params": {}}), "un module inconnu", "inconnu")
    refused(lambda b: b["clips"].append({"id": "c9", "track": "t1", "start": 0, "len": 4, "pat": "p2"}), "un clip qui joue le motif d'une autre piste")
    # la version 2
    refused(lambda b: b["sections"].append({"id": "s1", "name": "Intro", "a": 8, "b": 4}), "une section à l'envers", "section")
    refused(lambda b: b.update(key={"tonic": 3, "mode": "mixolydien"}), "un mode inconnu", "mode")
    refused(lambda b: b["arc"].update(pts=[[0, 1.4]]), "un point d'arc hors de 0..1", "arc")
    refused(lambda b: b["auto"].append({"id": "a1", "mod": "m99", "k": "vol", "pts": []}), "une automation sans module", "automation")
    refused(lambda b: b["cables"].append({"a": "m2", "b": "m5", "send": 12}), "un envoi au-dessus de +6 dB", "envoi")
    refused(lambda b: b["patterns"][0].update(steps=18), "un motif de 18 pas", "pas")
    good = json.loads(json.dumps(got))
    good["sections"] = [{"id": "s1", "name": "Intro", "a": 0, "b": 16, "color": "cy", "tag": "intro"}]
    good["markers"] = [{"id": "k1", "b": 4, "name": "Repère"}]
    good["arc"] = {"on": True, "to": "both", "pts": [[0, 0.2], [8, 1.0]]}
    good["auto"] = [{"id": "a1", "mod": "m4", "k": "vol", "on": True, "pts": [[0, 0.5], [4, 0.9]]}]
    good["key"] = {"tonic": 5, "mode": "dorian"}
    good["clips"][0].update(mute=True, name="Intro · kit")
    good["presets"] = [{"id": "r1", "name": "Ma basse", "type": "acid", "params": {"cutoff": 0.4}}]
    good["banc"] = {"segs": [{"id": "g1", "lane": "ryt", "d": 4, "l": 8}], "atts": [], "ten": [[0, 0.5], [8, 0.7]]}
    refused(lambda b: b.update(presets=[{"id": "r1", "name": "X", "type": "theremine", "params": {}}]), "un réglage d'une source inconnue", "source")
    refused(lambda b: b.update(banc={"segs": [], "atts": [], "ten": [[0, 2]]}), "une tension hors de 0..1", "tension")
    # les groupes de pistes (29/09)
    refused(lambda b: b["tracks"][0].update(grp="gx"), "une piste dans un groupe absent", "groupe")
    refused(lambda b: b.update(groups=[{"id": "g1", "name": ""}]), "un groupe sans nom", "groupe")
    good["groups"] = [{"id": "g1", "name": "Rythmique", "fold": True}]
    good["tracks"][0]["grp"] = "g1"
    st, r = call("POST", f"/api/music/projects/{pid}", good)
    ok(st == 200 and r.get("rev") == 3, f"sections, marqueurs, arc, automation, tonalité passent ({st} {r})")
    good["rev"] = 3

    st, s = call("POST", "/api/music/projects", {"name": "Session", "template": "session"})
    ok(st == 200 and len(s.get("sections", [])) == 4 and s["bpm"] == 112 and s["key"] == {"tonic": 5, "mode": "minor"}
       and sum(1 for t in s["tracks"] if t["kind"] == "bus") == 2
       and sum(1 for c in s["cables"] if "send" in c) == 4, f"la session de la maquette : 4 sections, 2 bus, 4 envois ({st})")
    ok(any(m["type"] == "rythme" for m in s.get("modules", [])) and any(m["type"] == "acid" for m in s.get("modules", [])),
       "la session joue la boîte à rythme et la basse acide d'ODIO")
    st, e = call("POST", "/api/music/projects", {"name": "Vide", "template": "vide"})
    ok(st == 200 and not e["tracks"] and len(e["modules"]) == 1, "un projet vide")
    st, r = call("POST", "/api/music/projects", {"name": "X", "template": "orchestre"})
    ok(st == 400, "un départ inconnu est refusé")

    st, eng = call("GET", "/api/music/engines")
    ok(st == 200 and eng.get("mode") == "factice" and eng["generate"]["ok"], f"mode essai par défaut ({eng})")
    ok(len(eng.get("keyscales", [])) == 34, "les 34 tonalités du nœud ACE-Step")
    ok(isinstance(eng.get("contracts"), dict) and set(eng["contracts"]) == set(CONTRACTS) and all(eng["contracts"].values()),
       f"les contrats YuE, partition, séparation, régions, MIDI sont dits et déclarés ({eng.get('contracts')})")

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
        jj = {}
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

    # YuE2 et la séparation sont tenus ailleurs (music_yue.py, music_stems.py) : ce module n'en déclare aucun
    ok(all(k not in jobs.HANDLERS or jobs.HANDLERS[k][0].__module__ != __name__ for k in ("music.yue", "music.stems")),
       "music.yue et music.stems ne sont pas tenus ici")
    st, r = call("POST", "/api/music/stems", {"item": items[0]["id"] if items else ""})
    ok(st in (404, 405), f"l'ancienne route /api/music/stems a disparu ({st})")

    st, r = call("POST", f"/api/music/projects/{pid}/delete")
    st2, _ = call("GET", f"/api/music/projects/{pid}")
    ok(st == 200 and st2 == 404, "un projet va à la corbeille")
    st, _ = call("GET", "/api/music/projects/..%2F..%2Fjobs")
    ok(st in (400, 404), "un identifiant de projet douteux est refusé")
