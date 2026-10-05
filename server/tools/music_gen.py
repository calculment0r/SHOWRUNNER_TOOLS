"""ODIO : la génération par région, sur une piste générative.

Une piste générative est une piste audio d'ODIO (`kind: "audio"`, `gen` :
son modèle et sa tâche par défaut). On y dessine une région ; la région
(un clip audio qui porte `gen`) demande au modèle N propositions, qui
reviennent en **prises** : on en écoute, on en choisit une, elle joue comme
un clip audio ; « Garder la prise » en fait un clip audio ordinaire.

  music.gen.ace   ACE-Step 1.5, une tâche (générer, une piste seule dans le
                  contexte, compléter, refaire la région, variation d'un son)
  music.gen.yue   YuE2 : une chanson à la longueur de la région (partition
                  écrite, relue, modifiée — music_yue.py — ou reprise)

Les paramètres, leurs bornes, leurs défauts et leurs sources ne sont pas
ici : ils sont dans `musique/generatif_modeles.json`, lu par la page (qui
dessine le panneau depuis lui) et par ce module (qui valide la demande
contre lui) — une seule vérité. Ce qui vient du projet (tempo, mesure,
tonalité, bornes de la région, le mixage de ce qui joue autour) est
recalculé ici depuis les nombres du projet, pas cru sur parole.

Moteurs (interrupteurs existants, lus au démarrage) :

  factice (défaut)            voie `cpu` : un son d'essai par prise, synthétisé
                              dans la tonalité, au tempo et à la mesure du
                              projet, selon la tâche et la piste demandée
                              (batterie, basse…) ; une variation passe le son
                              source par un filtre ffmpeg. Étiqueté « essai ».
  "music_engine": "ace-step"  voie `audio` : ACE-Step par ComfyUI, tâche
                              « morceau » seulement (graphe du gabarit officiel,
                              `n` = batch_size ; l'audio de style par
                              ReferenceTimbreAudio, nœud expérimental, écrit et
                              jugé à vide, jamais rendu). Les autres tâches
                              (une piste, compléter, repeindre, variation,
                              isoler) passent par le serveur d'API du dépôt
                              ACE-Step (POST /release_task), pas encore câblé
                              — et lego, complete, extract veulent le modèle
                              base, à télécharger : refusées en réel avec leur
                              raison (le schéma la dit, docs/etudes/musique_generatif.md § 2).
  "music_yue": true           voie `audio` : YuE2 par ComfyUI, une prise par
                              rendu (music_yue.render_real).
"""

from __future__ import annotations

import json
import math
import random
import shutil
import subprocess
import time
import wave
from array import array
from pathlib import Path

from core import config, jobs, library
from core.comfy import ComfyError
from core.http import HttpError
from tools import music as music_core
from tools import music_yue

SCHEMA_FILE = Path(__file__).resolve().parents[2] / "musique" / "generatif_modeles.json"
SR = 48000
MAX_REGION_BEATS = 4096
_schema: dict | None = None


def schema() -> dict:
    global _schema
    if _schema is None:
        _schema = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    return _schema


def mode(model: str) -> str:
    if model == "ace":
        return "reel" if music_core.mode() == "ace-step" else "factice"
    return "reel" if music_yue.mode() == "comfyui" else "factice"


# ── la tonalité : celle d'ACE (modules.js, aceKey — la même règle) ──
TONICS = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
MAJORISH = {"major", "lydian", "mixolydian", "pentamaj"}
SCALES = {"major": (0, 2, 4, 5, 7, 9, 11), "minor": (0, 2, 3, 5, 7, 8, 10), "dorian": (0, 2, 3, 5, 7, 9, 10),
          "phrygian": (0, 1, 3, 5, 7, 8, 10), "lydian": (0, 2, 4, 6, 7, 9, 11), "mixolydian": (0, 2, 4, 5, 7, 9, 10),
          "locrian": (0, 1, 3, 5, 6, 8, 10), "harmonic": (0, 2, 3, 5, 7, 8, 11), "pentamaj": (0, 2, 4, 7, 9),
          "pentamin": (0, 3, 5, 7, 10), "blues": (0, 3, 5, 6, 7, 10)}
KEY_EN = {"major": "major", "minor": "minor"}


def ace_key(tonic: int, md: str) -> str:
    return f"{TONICS[tonic]} {'major' if md in MAJORISH else 'minor'}"


# ── juger une demande contre le schéma ──────────────────────
def _num(v, lo, hi, what, integer=False):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        raise ValueError(f"{what} : un nombre")
    if integer and int(v) != v:
        raise ValueError(f"{what} : un entier")
    if not lo <= v <= hi:
        raise ValueError(f"{what} : de {lo:g} à {hi:g}")
    return int(v) if integer else float(v)


def _cond(expr: str | None, vals: dict) -> bool:
    """« instrumental=false », « mode!=off » : la condition d'un paramètre."""
    if not expr:
        return True
    neg = "!=" in expr
    k, want = expr.split("!=" if neg else "=", 1)
    got = vals.get(k)
    got = str(got).lower() if isinstance(got, bool) else str(got)
    return (got != want) if neg else (got == want)


def _choice_ids(pd: dict) -> list:
    return [c["id"] if isinstance(c, dict) else c for c in pd.get("choix", [])]


def _audio(iid, what) -> str:
    it = library.get(iid) if isinstance(iid, str) and iid else None
    if not it or it.get("kind") != "audio":
        raise ValueError(f"{what} : un son de la bibliothèque")
    return it["id"]


def region_params(d: dict) -> dict:
    """La demande d'une région, jugée contre le schéma : un paramètre qui n'est
    pas celui de la tâche est refusé, une valeur hors bornes aussi (pas
    corrigée). Rend la recette complète du travail."""
    if not isinstance(d, dict):
        raise ValueError("la demande est un objet")
    S = schema()
    model, task = d.get("model"), d.get("task")
    M = S["modeles"].get(model)
    if not M:
        raise ValueError(f"modèle inconnu : {model!r} ({', '.join(S['modeles'])})")
    T = M["taches"].get(task)
    if not T:
        raise ValueError(f"{M['nom']} n'a pas de tâche « {task} » ({', '.join(M['taches'])})")
    v = d.get("v") or {}
    if not isinstance(v, dict):
        raise ValueError("les réglages sont un objet")
    allowed = T["params"]
    extra = [k for k in v if k not in allowed]
    if extra:
        why = M.get("indisponible", {}).get(extra[0])
        raise ValueError(f"« {extra[0]} » n'est pas un réglage de {M['nom']} · {T['nom']}" + (f" : {why}" if why else ""))

    pj = d.get("projet") or {}
    bpm = _num(pj.get("bpm"), 20, 300, "tempo du projet")
    sig = pj.get("sig")
    if sig not in (2, 3, 4, 6):
        raise ValueError("mesure du projet : 2, 3, 4 ou 6 temps")
    tonic = _num(pj.get("tonic", 9), 0, 11, "tonique", integer=True)
    md = pj.get("mode", "minor")
    if md not in SCALES:
        raise ValueError(f"mode inconnu : {md}")
    rg = d.get("region") or {}
    a = _num(rg.get("a"), 0, 1e5, "début de la région")
    b = _num(rg.get("b"), 0, 1e5, "fin de la région")
    if b <= a or b - a > MAX_REGION_BEATS:
        raise ValueError(f"la région va de son début à sa fin, {MAX_REGION_BEATS} temps au plus")
    spb = 60.0 / bpm
    secs = (b - a) * spb
    zone = T.get("zone")
    if zone and not zone["min"] <= secs <= zone["max"]:
        raise ValueError(f"{T['nom']} : la région dure {secs:.1f} s, la zone va de {zone['min']} à {zone['max']} s ({zone['source']})")
    # le contexte (ce qui joue autour) : une fenêtre [w0, w1] qui contient la région
    w0, w1 = a, b
    if T["sortie"] == "contexte":
        w0 = _num(rg.get("w0", a), 0, a, "début du contexte")
        w1 = _num(rg.get("w1", b), b, 1e5, "fin du contexte")
        if (w1 - w0) * spb > 600:
            raise ValueError(f"le contexte dure {(w1 - w0) * spb:.0f} s : 600 au plus (la borne d'audio_duration, API.md)")

    vals: dict = {}
    for pid in allowed:          # d'abord ce qui décide des conditions
        pd = M["params"][pid]
        if pd["type"] == "bool":
            raw = v.get(pid, pd.get("defaut"))
            if not isinstance(raw, bool):
                raise ValueError(f"{pd['label']} : vrai ou faux")
            vals[pid] = raw
        elif pd["type"] == "choix" and not pd.get("projet"):
            raw = v.get(pid, pd.get("defaut"))
            if raw not in _choice_ids(pd):
                raise ValueError(f"{pd['label']} : {raw!r} n'est pas dans {', '.join(map(str, _choice_ids(pd)))}")
            vals[pid] = raw
    refs: list[str] = []
    for pid in allowed:
        pd = M["params"][pid]
        if pid in vals:
            continue
        if not _cond(pd.get("si"), vals):
            # un réglage qui ne compte pas dans cet état (des paroles sans voix,
            # une partition « sans partition ») : refusé plutôt que perdu en silence
            if v.get(pid) not in (None, "", []):
                raise ValueError(f"« {pd['label']} » ne compte que si {pd['si'].replace('!=', ' ≠ ').replace('=', ' = ')}")
            continue
        src = pd.get("projet")
        if src == "bpm":
            if not pd["min"] <= bpm <= pd["max"]:
                raise ValueError(f"le tempo du projet ({bpm:g}) sort des {pd['min']}-{pd['max']} de {M['nom']}")
            vals[pid] = int(round(bpm))
            continue
        if src == "key":
            vals[pid] = ace_key(tonic, md)
            continue
        if src == "sig":
            vals[pid] = str(sig)
            continue
        if src == "region":
            if secs > pd["max"]:
                raise ValueError(f"la région dure {secs:.1f} s : {M['nom']} en rend {pd['max']:g} au plus")
            vals[pid] = round(max(pd["min"], secs), 2)
            continue
        if src == "autour":
            vals[pid] = _audio(d.get("context"), "le contexte (ce qui joue autour)")
            refs.append(vals[pid])
            continue
        raw = v.get(pid, pd.get("defaut"))
        t = pd["type"]
        if raw is None or raw == "" or raw == []:
            if pd.get("requis"):
                raise ValueError(f"{pd['label']} : à remplir pour {T['nom']}")
            continue
        if t == "texte" or t == "partition":
            if not isinstance(raw, str) or len(raw) > pd["max"]:
                raise ValueError(f"{pd['label']} : un texte de {pd['max']} signes au plus")
            vals[pid] = raw.strip()
        elif t in ("nombre", "entier"):
            vals[pid] = _num(raw, pd["min"], pd["max"], pd["label"], integer=(t == "entier"))
        elif t == "piste":
            if raw not in S["pistes"]["ordre"]:
                raise ValueError(f"{pd['label']} : une piste d'ACE-Step ({', '.join(S['pistes']['ordre'])})")
            vals[pid] = raw
        elif t == "pistes":
            if not isinstance(raw, list) or not raw or any(x not in S["pistes"]["ordre"] for x in raw) or len(set(raw)) != len(raw):
                raise ValueError(f"{pd['label']} : une ou plusieurs pistes d'ACE-Step, sans doublon")
            vals[pid] = [x for x in S["pistes"]["ordre"] if x in raw]
        elif t == "son":
            vals[pid] = _audio(raw, pd["label"])
            refs.append(vals[pid])
        else:
            raise ValueError(f"{pd['label']} : sorte de réglage inconnue ({t})")
    for pid in allowed:
        pd = M["params"][pid]
        if pd.get("requis") and _cond(pd.get("si"), vals) and pid not in vals:
            raise ValueError(f"{pd['label']} : à remplir pour {T['nom']}")
    if model == "yue":
        if vals.get("abc") and vals.get("mode") == "off":
            raise ValueError("une partition demande « mélodie et accords » ou « mélodie seule » (YuE2)")
        if vals.get("abc"):
            # mise au dialecte et jugée ici, avant la file : une faute revient tout de suite,
            # en français, avec sa ligne (music_yue.abc_pret)
            vals["abc"], _ = music_yue.abc_pret(vals["abc"])
        # YuE2 n'a pas d'entrée tempo ni tonalité : elles s'écrivent dans le style
        tags = vals.get("tags", "")
        add = [x for x in (f"{int(round(bpm))} BPM", f"{TONICS[tonic]} {'major' if md in MAJORISH else 'minor'}")
               if x.lower() not in tags.lower()]
        vals["tags"] = ", ".join([t for t in [tags] + add if t])[:M["params"]["tags"]["max"]]
    # les sections que la région couvre (leurs étiquettes de paroles), assez de
    # mesures pour la durée demandée : le plan d'une partition d'essai
    need = max(1, math.ceil(max(secs, vals.get("duration_s") or vals.get("duration") or 0) / (sig * spb) - 1e-9))
    sections = d.get("sections") or [["verse", need]]
    if not isinstance(sections, list) or not all(isinstance(s, list) and len(s) == 2 and isinstance(s[0], str) and len(s[0]) <= 20
                                                 and isinstance(s[1], int) and 1 <= s[1] <= 512 for s in sections):
        raise ValueError("sections : [[étiquette, mesures], …]")
    have = sum(s[1] for s in sections)
    if have < need:
        sections = [*sections[:-1], [sections[-1][0], sections[-1][1] + need - have]]
    if sum(s[1] for s in sections) > 1024:
        raise ValueError("sections : 1024 mesures au plus")
    seed = vals.get("seed", -1)
    if seed == -1:
        seed = random.randint(0, 2 ** 31 - 1)
    vals["seed"] = seed
    n = vals.get("n", 1)
    title = (d.get("title") or "").strip()[:80] if isinstance(d.get("title"), str) else ""
    if mode(model) == "reel" and not T["reel"]["ok"]:
        raise ValueError(f"{M['nom']} · {T['nom']} : pas câblé en réel — {T['reel'].get('pourquoi', '')}")
    return {"model": model, "task": task, "values": vals, "n": n, "seed": seed,
            "projet": {"bpm": bpm, "sig": sig, "tonic": tonic, "mode": md, "keyscale": ace_key(tonic, md)},
            "region": {"a": a, "b": b, "secs": round(secs, 4), "w0": w0, "w1": w1,
                       "win_secs": round((w1 - w0) * spb, 4), "off": round((a - w0) * spb, 4)},
            "refs": refs, "sortie": T["sortie"], "sections": sections,
            "title": title or f"{M['court']} · {T['nom']}", "clip": str(d.get("clip") or "")[:24]}


# ── le son d'essai : des voix synthétisées, une boucle de deux mesures ──
def _hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


class _Loop:
    """Deux mesures calculées une fois, puis répétées (comme test_tone de
    music.py) : de quoi prouver que tempo, mesure et tonalité ont fait le
    trajet. Ce n'est pas de la musique générée."""

    def __init__(self, bpm: float, sig: int, sr: int = SR):
        self.sr, self.spb, self.sig = sr, 60.0 / bpm, sig
        self.n = int(round(2 * sig * self.spb * sr))
        self.buf = [0.0] * self.n

    def tone(self, t0: float, dur: float, f: float, amp: float, harm=(1.0,), decay=4.0, attack=0.005, vib=0.0):
        sr, n0 = self.sr, int(t0 * self.sr)
        ln = min(int(dur * sr), self.n - n0)
        ph = 0.0
        for i in range(max(0, ln)):
            t = i / sr
            env = min(1.0, t / attack) * math.exp(-t * decay) * min(1.0, (ln - i) / (0.01 * sr))
            ph += 2 * math.pi * f * (1 + vib * math.sin(2 * math.pi * 5.5 * t)) / sr
            s = 0.0
            for k, h in enumerate(harm):
                s += h * math.sin((k + 1) * ph)
            self.buf[n0 + i] += amp * env * s

    def kick(self, t0: float, amp=0.8):
        sr, n0, ph = self.sr, int(t0 * self.sr), 0.0
        for i in range(min(int(0.35 * sr), self.n - n0)):
            t = i / sr
            ph += 2 * math.pi * (45 + 80 * math.exp(-t * 20)) / sr
            self.buf[n0 + i] += amp * math.exp(-t * 8) * math.sin(ph)

    def noise(self, t0: float, dur: float, amp: float, decay: float, rng: random.Random, hp=True):
        sr, n0, prev = self.sr, int(t0 * self.sr), 0.0
        for i in range(min(int(dur * sr), self.n - n0)):
            x = rng.uniform(-1, 1)
            y = x - prev if hp else x                   # différence d'ordre un : un passe-haut
            prev = x
            self.buf[n0 + i] += amp * math.exp(-i / sr * decay) * y

    def write(self, path: Path, total_s: float, gain_db: float = -3.0) -> float:
        peak = max(1e-9, max(abs(x) for x in self.buf))
        k = 10 ** (gain_db / 20) / peak
        pcm = array("h", (int(max(-1.0, min(1.0, x * k)) * 32767) for x in self.buf for _ in (0, 1)))
        total = int(total_s * self.sr)
        with wave.open(str(path), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(self.sr)
            left = total
            while left > 0:
                m = min(left, self.n)
                w.writeframes(pcm[: m * 2].tobytes())
                left -= m
        return total / self.sr


def _chords(tonic: int, md: str) -> list[list[int]]:
    """Quatre accords de trois sons tirés de la gamme du projet : i VI III VII
    en mineur, I V vi IV en majeur (les degrés du modèle « fondamentales » de
    modules.js pour le mineur ; la suite pop courante pour le majeur)."""
    sc = SCALES[md] if len(SCALES[md]) == 7 else SCALES["major" if md in MAJORISH else "minor"]
    degs = (0, 4, 5, 3) if md in MAJORISH else (0, 5, 2, 6)

    def note(d, o):
        return 12 * (o + 1) + tonic + sc[d % 7] + 12 * (d // 7)
    return [[note(d, 3), note(d + 2, 3), note(d + 4, 3)] for d in degs]


FAMILY = {"drums": "drums", "percussion": "perc", "bass": "bass", "guitar": "pluck", "keyboard": "keys", "synth": "arp",
          "strings": "pad", "brass": "brass", "woodwinds": "lead", "vocals": "voice", "backing_vocals": "choir", "fx": "fx"}


def _voice(L: _Loop, fam: str, chords, rng: random.Random, spb: float, sig: int):
    steps = 2 * sig * 4                                  # deux mesures en doubles-croches
    st = spb / 4
    bar = sig * spb

    def ch(i):                                           # l'accord de la mesure (deux par boucle, la suite tourne à la graine)
        return chords[(i + rng_off) % len(chords)]
    rng_off = rng.randrange(4)
    if fam == "drums":
        kick = rng.choice(["x...x...x...x...", "x.....x.x.......", "x..x..x...x.....", "x.......x.x....."])
        hat = rng.choice((1, 2, 2))
        for s in range(steps):
            ss = s % (sig * 4)                               # la double-croche dans la mesure
            if kick[ss % 16] == "x":
                L.kick(s * st)
            if ss in ((4, 12) if sig >= 4 else (4,)):          # la caisse claire sur les temps faibles
                L.noise(s * st, 0.18, 0.45, 18, rng, hp=False)
            if s % hat == 0:
                L.noise(s * st, 0.05, 0.16 if s % 4 else 0.22, 60, rng)
    elif fam == "perc":
        for s in range(steps):
            if rng.random() < 0.35:
                L.tone(s * st, 0.18, rng.choice((196, 262, 330)), 0.35, harm=(1.0, 0.2), decay=22)
    elif fam == "bass":
        for s in range(0, steps, 2):
            root = ch(s // (sig * 4))[0] - 12
            p = root + (12 if (s // 2) % 4 == 2 and rng.random() < 0.6 else 7 if rng.random() < 0.15 else 0)
            L.tone(s * st, 2 * st * 0.9, _hz(p), 0.5, harm=(1.0, 0.5, 0.25), decay=3)
    elif fam in ("pluck", "keys", "arp", "lead"):
        order = rng.choice([(0, 1, 2, 1), (0, 2, 1, 2), (2, 1, 0, 1)])
        every = {"pluck": 2, "keys": 4, "arp": 1, "lead": 4}[fam]
        harm = {"pluck": (1.0, 0.6, 0.3, 0.15), "keys": (1.0, 0.4, 0.2), "arp": (1.0, 0.0, 0.33, 0.0, 0.2), "lead": (1.0, 0.3)}[fam]
        for s in range(0, steps, every):
            c = ch(s // (sig * 4))
            up = 12 if fam in ("arp", "lead") else 0
            if fam == "keys":
                for p in c:
                    L.tone(s * st, every * st * 0.95, _hz(p + 12), 0.18, harm=harm, decay=3)
            else:
                p = c[order[(s // every) % len(order)]] + up
                L.tone(s * st, every * st * 0.95, _hz(p), 0.3, harm=harm, decay=5 if fam == "pluck" else 2.5,
                       vib=0.004 if fam == "lead" else 0)
    elif fam in ("pad", "brass", "choir"):
        for i in range(2):
            for p in ch(i):
                L.tone(i * bar, bar * 0.98, _hz(p + (12 if fam == "choir" else 0)), 0.14, harm=(1.0, 0.5, 0.3),
                       decay=0.4, attack=0.3 if fam != "brass" else 0.05, vib=0.004 if fam == "choir" else 0)
    elif fam == "voice":
        for s in range(0, steps, 4):
            c = ch(s // (sig * 4))
            L.tone(s * st, 4 * st * 0.92, _hz(rng.choice(c) + 12), 0.35, harm=(1.0, 0.25), decay=0.8, attack=0.03, vib=0.006)
    elif fam == "fx":
        L.noise(0, 2 * bar, 0.08, 0.2, rng)


def fake_take(dest: Path, p: dict, k: int) -> float:
    """La prise k (graine + k) : le son d'essai de la tâche, sur la région
    (ou la fenêtre du contexte, la région gardant sa place dedans)."""
    v, pj, rg = p["values"], p["projet"], p["region"]
    rng = random.Random(p["seed"] + k)
    L = _Loop(pj["bpm"], pj["sig"])
    chords = _chords(pj["tonic"], pj["mode"])
    task = p["task"]
    if task in ("lego", "extract"):
        fams = [FAMILY[v["track_name"]]]
    elif task == "complete":
        fams = [FAMILY[x] for x in v["track_classes"]]
    else:
        # un morceau entier : batterie, basse, clavier, et une « voix » s'il y a des paroles
        sings = bool(v.get("lyrics")) if p["model"] == "yue" else not v.get("instrumental", True)
        fams = ["drums", "bass", "keys"] + (["voice"] if sings else [])
    for fam in fams:
        _voice(L, fam, chords, rng, L.spb, pj["sig"])
    total = rg["win_secs"] if p["sortie"] == "contexte" else max(rg["secs"], v.get("duration", v.get("duration_s", 0)) or 0)
    return L.write(dest, total)


def fake_cover(dest: Path, src_id: str, p: dict, k: int) -> float:
    """La variation d'essai : le son source passé par un filtre ffmpeg (écho,
    passe-bande, un autre à chaque prise), à la durée du son source — celle
    que rend cover (inference.py:606-610), bornée à 600 s."""
    it = library.get(src_id)
    src = library.path_of(it)
    filt = ["aecho=0.8:0.7:60:0.35,highpass=f=180", "lowpass=f=1800,aecho=0.8:0.6:120:0.3",
            "bandpass=f=900:width_type=o:w=2,volume=2", "highpass=f=400,aecho=0.8:0.8:40:0.4"][k % 4]
    dur = min(600.0, float(it.get("duration") or p["region"]["secs"]))
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-t", f"{dur:.3f}", "-af", filt, "-ar", str(SR),
                        "-ac", "2", "-c:a", "pcm_s16le", str(dest)], capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg (variation d'essai) : {r.stderr.strip()[:300]}")
    return dur


def _store(ctx, p: dict, dest: Path, k: int, engine: str, extra: dict | None = None) -> dict:
    essai = engine == "factice"
    M = schema()["modeles"][p["model"]]
    return ctx.add(dest, kind="audio", title=f"{p['title']} · prise {k + 1}" + (" (essai)" if essai else ""),
                   prompt=p["values"].get("caption") or p["values"].get("tags") or "", parents=p["refs"],
                   params={"model": p["model"], "task": p["task"], "values": p["values"], "projet": p["projet"],
                           "region": p["region"], "seed": p["seed"] + k, "take": k, "region_off": p["region"]["off"]
                           if p["sortie"] == "contexte" else 0.0, "engine": engine, "clip": p["clip"], **(extra or {})},
                   origin={"model": "factice" if essai else M["nom"]}, tags=["musique", "région", "essai" if essai else "généré"],
                   folder="Musique")


def run_test(ctx):
    p = region_params(ctx.params)
    t0 = time.time()
    ids = []
    for k in range(p["n"]):
        ctx.check()
        ctx.progress(0.05 + 0.9 * k / p["n"], f"prise {k + 1} / {p['n']} (moteur d'essai)")
        dest = ctx.workdir / f"prise_{k + 1:02d}.wav"
        extra = {}
        v, pj = p["values"], p["projet"]
        if p["task"] == "cover":
            fake_cover(dest, v["src_audio"], p, k)
        elif p["model"] == "yue" and v.get("mode", "full") != "off" and music_yue.abc_tools():
            # comme YuE2 : une partition d'abord (la tienne, ou une d'essai à la
            # graine de la prise), puis le son qu'elle dit ; elle est rangée avec
            # la prise pour être reprise, relue, modifiée
            dur = max(p["region"]["secs"], v.get("duration_s", 10))
            abc = v.get("abc") or music_yue.fake_abc(p["seed"] + k, pj["bpm"], pj["sig"], pj["tonic"], pj["mode"],
                                                    p["sections"], sing=bool(v.get("lyrics")), chords=v.get("mode", "full") == "full")
            music_yue.abc_song(dest, abc, dur)
            extra = {"score": abc}
        else:
            fake_take(dest, p, k)
        ids.append(_store(ctx, p, dest, k, "factice", extra)["id"])
    secs = round(time.time() - t0, 1)
    return {"note": f"{len(ids)} prise{'s' if len(ids) > 1 else ''} d'essai en {secs:g} s (moteur factice)", "takes": ids,
            "render_seconds": secs}


# ── le moteur réel ──────────────────────────────────────────
def build_ace_graph(p: dict, style_name: str | None = None) -> dict:
    """Le graphe du gabarit officiel (music.py, build_generate_graph) à la
    longueur de la région, `n` prises par batch_size, les réglages avancés du
    schéma là où le gabarit les porte ; l'audio de style par LoadAudio →
    VAEEncodeAudio → ReferenceTimbreAudio (nodes_ace.py, expérimental)."""
    v = p["values"]
    ace = music_core.gen_params({"tags": v.get("caption") or "instrumental", "lyrics": "" if v.get("instrumental", True) else v.get("lyrics", ""),
                                 "instrumental": v.get("instrumental", True), "duration": v["duration"], "bpm": v["bpm"],
                                 "keyscale": v["keyscale"], "timesignature": v["timesignature"],
                                 "language": v.get("language", "en"), "seed": p["seed"], "title": p["title"]})
    g = music_core.build_generate_graph(ace)
    g["98"]["inputs"]["batch_size"] = p["n"]
    g["3"]["inputs"].update(steps=v.get("inference_steps", 50), cfg=float(v.get("guidance_scale", 6.0)))
    g["78"]["inputs"]["shift"] = float(v.get("shift", 3.0))
    g["94"]["inputs"].update(generate_audio_codes=bool(v.get("thinking", True)), temperature=float(v.get("lm_temperature", 0.85)),
                             cfg_scale=float(v.get("lm_cfg_scale", 2.0)), top_p=float(v.get("lm_top_p", 0.9)))
    if v.get("style_audio"):
        g["120"] = {"class_type": "LoadAudio", "_meta": {"title": "audio de style"}, "inputs": {"audio": style_name or "<style>"}}
        g["121"] = {"class_type": "VAEEncodeAudio", "_meta": {"title": "style → latent"}, "inputs": {"audio": ["120", 0], "vae": ["106", 0]}}
        g["122"] = {"class_type": "ReferenceTimbreAudio", "_meta": {"title": "timbre de référence"},
                    "inputs": {"conditioning": ["94", 0], "latent": ["121", 0]}}
        g["3"]["inputs"]["positive"] = ["122", 0]
    return g


def run_real(ctx):
    p = region_params(ctx.params)
    t0 = time.time()
    ids = []
    if p["model"] == "ace":
        style = None
        if p["values"].get("style_audio"):
            style = ctx.comfy.upload(library.path_of(library.get(p["values"]["style_audio"])))
        g = build_ace_graph(p, style)
        problems = music_yue.check_graph(g, music_yue.fetch_info(ctx.comfy, [n["class_type"] for n in g.values()]))
        if problems:
            raise ComfyError("graphe ACE-Step refusé avant l'envoi : " + " ; ".join(problems[:8]))
        paths = ctx.run_graph(g, prefix="region", label="ACE-Step 1.5", timeout=3600)
        for k, path in enumerate(paths):
            ids.append(_store(ctx, p, path, k, "comfyui", {"graph": "music_ace15_xl_base.json"})["id"])
    else:
        v = p["values"]
        for k in range(p["n"]):
            ctx.check()
            ctx.progress(0.05 + 0.9 * k / p["n"], f"YuE2 · prise {k + 1} / {p['n']}")
            yp = music_yue.yue_params({"tags": v["tags"], "lyrics": v.get("lyrics", ""), "duration_s": v["duration_s"],
                                       "seed": p["seed"] + k, "mode": v.get("mode", "full"), "precision": v.get("precision", "bf16"),
                                       "ref": v.get("ref", ""), "abc": v.get("abc", ""), "title": f"{p['title']} · prise {k + 1}"})
            for path, score in music_yue.render_real(ctx, yp):
                ids.append(_store(ctx, p, path, k, "comfyui", {"score": score})["id"])
    if not ids:
        raise ComfyError("aucune prise rendue")
    secs = round(time.time() - t0, 1)
    return {"note": f"{len(ids)} prises en {secs:g} s", "takes": ids, "render_seconds": secs}


# ── les routes ──────────────────────────────────────────────
def api_schema(req):
    """Le schéma et l'état des moteurs : la page n'y ajoute rien."""
    S = schema()
    out = {"engines": {}, "abc_tools": music_yue.abc_tools_state()}
    for mid, M in S["modeles"].items():
        md = mode(mid)
        out["engines"][mid] = {"engine": md, "switch": M["interrupteur"],
                               "tasks": {tid: {"ok": md == "factice" or T["reel"]["ok"],
                                               "real": T["reel"], "essai": md == "factice"} for tid, T in M["taches"].items()}}
    return out


def api_generate(req):
    d = req.json()
    try:
        p = region_params(d)
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    # la graine tirée au hasard est gardée : le travail la rejouera telle quelle
    d = {**d, "v": {**(d.get("v") or {}), "seed": p["seed"]}}
    j = jobs.submit(f"music.gen.{p['model']}", d, title=f"Région · {p['title']}"[:90], tool="music")
    return jobs.public(j)


def register(app) -> None:
    for model in ("ace", "yue"):
        real = mode(model) == "reel"
        # la famille de modèles : l'ordonnanceur garde ComfyUI chargé entre deux
        # prises du même modèle et le vide avant un autre (core/jobs.py, _preflight)
        jobs.register(f"music.gen.{model}", run_real if real else run_test, lane="audio" if real else "cpu",
                      title=f"Région · {schema()['modeles'][model]['nom']}" + ("" if real else " (essai)"),
                      family=("ace-step" if model == "ace" else "yue") if real else None, gpu=real, cost="gpu" if real else "cpu")
    app.route("GET", "/api/music/gen/engines", api_schema)
    app.route("POST", "/api/music/gen/generate", api_generate)


# ── le contrôle sans GPU (tools/check.py) ───────────────────
FAKE_INFO_ACE = {
    "UNETLoader": {"input": {"required": {"unet_name": [[music_core.GEN_MODEL]], "weight_dtype": [["default"]]}}, "output": ["MODEL"]},
    "DualCLIPLoader": {"input": {"required": {"clip_name1": [["qwen_0.6b_ace15.safetensors"]], "clip_name2": [["qwen_4b_ace15.safetensors"]],
                                              "type": [["ace"]], "device": [["default"]]}}, "output": ["CLIP"]},
    "VAELoader": {"input": {"required": {"vae_name": [["ace_1.5_vae.safetensors"]]}}, "output": ["VAE"]},
    "ModelSamplingAuraFlow": {"input": {"required": {"model": ["MODEL"], "shift": ["FLOAT", {"min": 0.0, "max": 100.0}]}}, "output": ["MODEL"]},
    "TextEncodeAceStepAudio1.5": {"input": {"required": {
        "clip": ["CLIP"], "tags": ["STRING", {}], "lyrics": ["STRING", {}], "seed": ["INT", {"min": 0, "max": 2 ** 64 - 1}],
        "bpm": ["INT", {"min": 10, "max": 300}], "duration": ["FLOAT", {"min": 0.0, "max": 2000.0}],
        "timesignature": [["2", "3", "4", "6"]], "language": [music_core.LANGS], "keyscale": [music_core.KEYSCALES],
        "generate_audio_codes": ["BOOLEAN", {}], "cfg_scale": ["FLOAT", {"min": 0.0, "max": 100.0}],
        "temperature": ["FLOAT", {"min": 0.0, "max": 2.0}], "top_p": ["FLOAT", {"min": 0.0, "max": 2000.0}],
        "top_k": ["INT", {"min": 0, "max": 100}], "min_p": ["FLOAT", {"min": 0.0, "max": 1.0}]}}, "output": ["CONDITIONING"]},
    "EmptyAceStep1.5LatentAudio": {"input": {"required": {"seconds": ["FLOAT", {"min": 1.0, "max": 1000.0}],
                                                          "batch_size": ["INT", {"min": 1, "max": 4096}]}}, "output": ["LATENT"]},
    "ConditioningZeroOut": {"input": {"required": {"conditioning": ["CONDITIONING"]}}, "output": ["CONDITIONING"]},
    "KSampler": music_yue.FAKE_INFO["KSampler"],
    "VAEDecodeAudio": music_yue.FAKE_INFO["VAEDecodeAudio"],
    "SaveAudioAdvanced": music_yue.FAKE_INFO["SaveAudioAdvanced"],
    "LoadAudio": music_yue.FAKE_INFO["LoadAudio"],
    "VAEEncodeAudio": {"input": {"required": {"audio": ["AUDIO"], "vae": ["VAE"]}}, "output": ["LATENT"]},
    "ReferenceTimbreAudio": {"input": {"required": {"conditioning": ["CONDITIONING"]}, "optional": {"latent": ["LATENT"]}},
                             "output": ["CONDITIONING"]},
}


def selftest(call, ok) -> None:
    S = schema()
    ok(set(S["modeles"]) == {"ace", "yue"} and "lego" in S["modeles"]["ace"]["taches"], "le schéma : ACE-Step et YuE2, la tâche lego")
    for mid, M in S["modeles"].items():
        miss = [(t, x) for t, T in M["taches"].items() for x in T["params"] if x not in M["params"]]
        ok(not miss, f"{mid} : chaque paramètre d'une tâche est décrit ({miss[:3]})")
        nosrc = [x for x, pd in M["params"].items() if not pd.get("source")]
        ok(not nosrc, f"{mid} : chaque paramètre porte sa source ({nosrc[:3]})")
    ok(len(S["pistes"]["ordre"]) == 12 and set(S["pistes"]["fr"]) == set(S["pistes"]["ordre"]), "les douze pistes d'ACE-Step (TRACK_NAMES)")
    st, eng = call("GET", "/api/music/gen/engines")
    ok(st == 200 and eng["engines"]["ace"]["engine"] == "factice" and eng["engines"]["ace"]["tasks"]["lego"]["ok"]
       and eng["engines"]["ace"]["tasks"]["lego"]["real"]["ok"] is False, f"moteurs : essai, lego pas câblé en réel ({st})")

    base = {"projet": {"bpm": 112, "sig": 4, "tonic": 5, "mode": "minor"}, "region": {"a": 16, "b": 48}}
    p = region_params({**base, "model": "ace", "task": "text2music", "v": {"caption": "funk drums", "n": 3, "seed": 7}})
    ok(p["values"]["bpm"] == 112 and p["values"]["keyscale"] == "F minor" and p["values"]["timesignature"] == "4"
       and abs(p["values"]["duration"] - 32 * 60 / 112) < 0.01 and p["n"] == 3, f"le projet arrive seul : tempo, tonalité, mesure, durée ({p['values']})")
    try:
        region_params({**base, "region": {"a": 0, "b": 200, "w0": 0, "w1": 200}, "model": "ace", "task": "repaint", "v": {}, "context": "x"})
        ok(False, "repeindre plus de 90 s est refusé (Tutorial.md:787)")
    except ValueError as e:
        ok("90" in str(e), "repeindre plus de 90 s est refusé (Tutorial.md:787)")
    p2 = region_params({**base, "region": {"a": 0, "b": 4}, "model": "ace", "task": "text2music", "v": {}})
    ok(p2["values"]["duration"] == 10 and p2["region"]["secs"] < 3, "une région de 2 s : 10 s demandées (le minimum d'ACE)")
    ok(region_params({**base, "projet": {"bpm": 112, "sig": 4, "tonic": 2, "mode": "dorian"}, "model": "ace", "task": "text2music",
                      "v": {}})["values"]["keyscale"] == "D minor", "un mode se ramène à majeur ou mineur")
    y = region_params({**base, "model": "yue", "task": "chanson", "v": {"tags": "pop", "n": 1}})
    ok("112 BPM" in y["values"]["tags"] and "F minor" in y["values"]["tags"], f"YuE2 : tempo et tonalité dans le style ({y['values']['tags']})")
    for bad, why in (({"model": "ace", "task": "text2music", "v": {"track_name": "drums"}}, "une piste seule hors de lego"),
                     ({"model": "yue", "task": "chanson", "v": {"tags": "x", "track_name": "drums"}}, "YuE2 n'a pas de piste seule"),
                     ({"model": "yue", "task": "chanson", "v": {"tags": "x", "style_audio": "aud-x"}}, "YuE2 n'a pas d'audio de style"),
                     ({"model": "ace", "task": "lego", "v": {"track_name": "drums"}}, "lego sans contexte"),
                     ({"model": "ace", "task": "lego", "v": {"track_name": "kazoo"}, "context": "x"}, "piste inconnue"),
                     ({"model": "ace", "task": "text2music", "v": {"n": 9}}, "9 propositions"),
                     ({"model": "ace", "task": "text2music", "v": {"guidance_scale": 20}}, "guidage hors bornes"),
                     ({"model": "ace", "task": "cover", "v": {}}, "variation sans son"),
                     ({"model": "ace", "task": "vocode", "v": {}}, "tâche inconnue"),
                     ({"model": "yue", "task": "chanson", "v": {"tags": "x", "mode": "off", "abc": "X:1"}}, "partition sans mode")):
        try:
            region_params({**base, **bad})
            ok(False, f"refusé : {why}")
        except ValueError:
            ok(True, f"refusé : {why}")
    # une partition coupée (06/10, « group 67, Ins: music line must end with a plain barline ») :
    # refusée à l'entrée, en français, la ligne dite ; la même, normalisée, passe
    cut = music_yue.fake_abc(3, 112, 4, 5, "minor", [["verse", 4]] * 3, sing=True)
    cut = cut[:-1] + "z4"
    try:
        region_params({**base, "model": "yue", "task": "chanson", "v": {"tags": "pop", "mode": "full", "abc": cut}})
        ok(False, "une partition coupée est refusée avant la file")
    except ValueError as e:
        ok("ligne" in str(e) and "groupe 3" in str(e), f"une partition coupée est refusée avant la file, la ligne dite ({str(e)[:140]})")
    fixed, _ = music_yue.abc_normalise(cut, couper=True)
    ok(region_params({**base, "model": "yue", "task": "chanson", "v": {"tags": "pop", "mode": "full", "abc": fixed}})["values"]["abc"] == fixed,
       "la même, corrigée, part telle quelle")
    try:
        region_params({**base, "projet": {"bpm": 25, "sig": 4, "tonic": 0, "mode": "major"}, "model": "ace", "task": "text2music", "v": {}})
        ok(False, "un tempo de 25 est refusé pour ACE (30-300)")
    except ValueError as e:
        ok("30" in str(e), "un tempo de 25 est refusé pour ACE (30-300)")

    g = build_ace_graph(p)
    ok(g["98"]["inputs"]["batch_size"] == 3 and g["98"]["inputs"]["seconds"] == p["values"]["duration"]
       and music_yue.check_graph(g, FAKE_INFO_ACE) == [], f"le graphe ACE d'une région : 3 prises, jugé bon ({music_yue.check_graph(g, FAKE_INFO_ACE)})")
    gs = build_ace_graph({**p, "values": {**p["values"], "style_audio": "aud-x"}}, "style.flac")
    ok(gs["3"]["inputs"]["positive"] == ["122", 0] and gs["122"]["inputs"]["latent"] == ["121", 0]
       and music_yue.check_graph(gs, FAKE_INFO_ACE) == [], "l'audio de style : LoadAudio → VAEEncodeAudio → ReferenceTimbreAudio")

    def wait(jid):
        jj = {}
        for _ in range(400):
            _, jj = call("GET", f"/api/jobs/{jid}")
            if jj.get("state") in ("done", "error", "cancelled"):
                return jj
            time.sleep(0.2)
        return jj

    st, j = call("POST", "/api/music/gen/generate", {**base, "model": "ace", "task": "text2music", "v": {"caption": "funk", "n": 2, "seed": 5},
                                                     "title": "Essai région"})
    ok(st == 200 and j.get("kind") == "music.gen.ace", f"une région en file ({st} {str(j)[:200]})")
    j = wait(j["id"]) if st == 200 else {}
    its = j.get("items") or []
    ok(j.get("state") == "done" and len(its) == 2 and [i["params"]["seed"] for i in its] == [5, 6]
       and all(abs(i.get("duration", 0) - 32 * 60 / 112) < 0.05 for i in its) and "(essai)" in its[0]["title"],
       f"deux prises d'essai à la longueur de la région, graines 5 et 6 ({j.get('state')} {j.get('message')})")
    if its:
        st, j2 = call("POST", "/api/music/gen/generate", {**base, "region": {"a": 16, "b": 24, "w0": 8, "w1": 32}, "model": "ace", "task": "lego",
                                                          "v": {"track_name": "bass", "n": 1}, "context": its[0]["id"]})
        j2 = wait(j2["id"]) if st == 200 else {}
        it2 = (j2.get("items") or [{}])[0]
        ok(j2.get("state") == "done" and abs(it2.get("duration", 0) - 24 * 60 / 112) < 0.05
           and abs(it2["params"]["region_off"] - 8 * 60 / 112) < 0.01 and it2["parents"] == [its[0]["id"]],
           f"lego d'essai : la fenêtre du contexte, la région à sa place dedans ({j2.get('state')} {j2.get('message')})")
        if shutil.which("ffmpeg"):
            st, j3 = call("POST", "/api/music/gen/generate", {**base, "model": "ace", "task": "cover", "v": {"src_audio": its[0]["id"], "n": 1}})
            j3 = wait(j3["id"]) if st == 200 else {}
            ok(j3.get("state") == "done" and (j3.get("items") or [{}])[0].get("parents") == [its[0]["id"]],
               f"variation d'essai d'un son ({j3.get('state')} {j3.get('message')})")
