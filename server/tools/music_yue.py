"""YuE2 : une chanson complète, voix et accompagnement, à partir d'un style
et de paroles (m-a-p, dépôt multimodal-art-projection/YuE, poids
m-a-p/YuE2-3B sous CC BY-NC 4.0). La musique générative d'ODIO.

  music.yue    style (+ paroles, + partition ABC ou morceau de référence)
               -> un son FLAC 48 kHz stéréo dans la bibliothèque, avec la
                  partition ABC que YuE2 a écrite avant de chanter

Deux moteurs, choisis par `showrunner.local.json` (lu au démarrage) :

  factice (défaut)      voie `cpu`, sans modèle : une mélodie d'essai étiquetée
                        « essai », à la durée, au tempo (« 96 BPM » lu dans le
                        style) et à la graine demandés, et une partition ABC
                        d'essai. Décision de Cal (28-29/09) : l'interface
                        d'abord, le câblage ensuite.
  "music_yue": true     voie `audio` : les nœuds YuE2 du cœur de ComfyUI
                        (comfy_extras/nodes_yue2.py, v0.37.2 sur les deux DGX),
                        graphe du gabarit officiel « audio_yue2_text2music »
                        (comfyui_workflow_templates_json 0.1.95) et du
                        workflow 02 de Cal pour la reprise (SheetSage2 ->
                        partition -> YuE2). Le graphe est jugé contre
                        /object_info avant d'être envoyé.

Pourquoi ComfyUI et pas le dépôt autonome ~/YuE, les sources de chaque borne,
les temps mesurés : docs/etudes/yue.md.

Ce que YuE2 prend vraiment (skill yue2-music, generation-and-covers.md) :
`style` (alias `tags`), `lyrics`, `cot` (full | melody | off), `seed`, `abc`,
`cfg_scale`. Il n'a **pas** d'entrée « son de référence », ni de tempo, de
voix de référence ou de prompt négatif : la voix, la langue et le tempo se
décrivent dans le style. Une référence audio passe par sa partition : c'est
la reprise (SheetSage2 transcrit la mélodie, YuE2 la rechante, cot=melody).
"""

from __future__ import annotations

import importlib.util
import json
import math
import random
import re
import sys
import time
import wave
from array import array
from pathlib import Path

from core import config, jobs, library
from core.comfy import Comfy, ComfyError
from core.http import HttpError

# ── ce que les machines ont (mêmes fichiers sur les deux DGX : tools/mirror_yue.sh) ──
CKPTS = {"bf16": "yue2_3b_bf16.safetensors",          # Comfy-Org/YuE2, 7,80 Go : qualité, LoRA
         "int8": "yue2_3b_int8_convrot.safetensors"}  # 3,96 Go : le gabarit officiel, plus rapide
SHEETSAGE = "sheetsage2_bf16.safetensors"             # models/audio_encoders, 1,39 Go
MODES = ("full", "melody", "off")
FPS = 25              # jetons musicaux par seconde (comfy/text_encoders/yue2.py, FRAMES_PER_SECOND)
CONTEXT = 24576       # contexte du modèle, partagé par le prompt, la partition et la musique (idem, CONTEXT)
DUR_MIN = 10.0        # le rendu ne s'arrête pas avant 200 jetons = 8 s (min_tokens, idem)
DUR_MAX = 900.0       # YuE2GenerateMusic.max_duration : 0,04 à 900 s (/object_info)
DUR_DEFAULT = 60.0    # workflow 01 de Cal : « 60 s pour itérer vite, 360 pour un morceau entier »
DUR_SUGGESTED = (30, 60, 120, 180, 240, 360)
# garde-fous du portail (pas des bornes du modèle : la vraie limite est le contexte)
MAX_TAGS, MAX_LYRICS, MAX_ABC = 2000, 12000, 60000
SEED_MAX = 2 ** 64 - 1  # YuE2GenerateABC / YuE2GenerateMusic / KSampler : 0 .. 0xffffffffffffffff

# réglages d'échantillonnage : ceux du gabarit officiel, repris tels quels
ABC_SAMPLING = {"max_abc_tokens": 8192, "temperature": 0.7, "top_p": 0.9, "top_k": 30,
                "repetition_penalty": 1.005, "penalty_window": 100}
MUSIC_SAMPLING = {"temperature": 1.0, "top_p": 0.95, "top_k": 100, "repetition_penalty": 1.2}
KSAMPLER = {"steps": 32, "cfg": 1.0, "sampler_name": "dpm_2", "scheduler": "sgm_uniform", "denoise": 1.0}
OUT_PREFIX = "showrunner/yue2"
TIMEOUT = 3600        # 341 s de chanson ont pris 504 s sur DGX1 (dépôt autonome, 10/09)
SCORE_KEEP = 65536    # la partition gardée dans la recette, en signes

TEMPLATE = "comfyui_workflow_templates_json 0.1.95 · audio_yue2_text2music.json"
CARD = "github.com/multimodal-art-projection/YuE (README, docs/generation.md, skills/yue2-music)"


def mode() -> str:
    """« factice » tant que Cal n'a pas dit de brancher YuE2."""
    return "comfyui" if config.get("music_yue") is True else "factice"


# l'interrupteur, déclaré pour la page Admin → Câblage (admin.py l'attendait : EXPECTED)
config.declare_switch("music_yue", [False, True], label="Musique · YuE2", default=False,
                      doc="server/tools/music_yue.py, mode() : factice (mélodie d'essai) ou les nœuds YuE2 du cœur de ComfyUI ; "
                          "aussi la partition seule (music.yue.abc) et les prises YuE2 d'une région (music.gen.yue)")


# ── les réglages d'une chanson ──────────────────────────────
def _num(v, what: str) -> float:
    if isinstance(v, bool):
        raise ValueError(f"{what} : un nombre")
    try:
        x = float(v)
    except (TypeError, ValueError) as e:
        raise ValueError(f"{what} : un nombre") from e
    if x != x or x in (float("inf"), float("-inf")):
        raise ValueError(f"{what} : un nombre")
    return x


def yue_params(d: dict) -> dict:
    """Les réglages d'une chanson, bornés comme le disent le nœud et la
    documentation de YuE2 ; une valeur hors bornes est refusée, pas corrigée."""
    if not isinstance(d, dict):
        raise ValueError("les réglages sont un objet")
    tags, style = d.get("tags"), d.get("style")
    if isinstance(tags, str) and isinstance(style, str) and tags.strip() and style.strip() \
            and tags.strip() != style.strip():
        raise ValueError("« tags » et « style » disent la même chose pour YuE2 : ils doivent concorder")
    tags = (tags or style or "")
    if not isinstance(tags, str) or not tags.strip():
        raise ValueError("décris le style : langue, genre, voix, tempo, instruments (YuE2)")
    tags = tags.strip()
    if len(tags) > MAX_TAGS:
        raise ValueError(f"le style tient en {MAX_TAGS} signes au plus (garde-fou du portail)")
    lyrics = d.get("lyrics") or ""
    if not isinstance(lyrics, str):
        raise ValueError("les paroles sont un texte")
    lyrics = lyrics.strip()
    if len(lyrics) > MAX_LYRICS:
        raise ValueError(f"les paroles tiennent en {MAX_LYRICS} signes au plus (garde-fou du portail)")
    dur = _num(d.get("duration_s", DUR_DEFAULT), "durée")
    if not DUR_MIN <= dur <= DUR_MAX:
        raise ValueError(f"durée : de {DUR_MIN:g} à {DUR_MAX:g} secondes (YuE2)")
    seed = d.get("seed")
    if seed in (None, "", -1):
        seed = random.randint(0, 2 ** 32 - 1)
    if isinstance(seed, bool):
        raise ValueError("graine invalide")
    try:
        seed = int(seed)
    except (TypeError, ValueError) as e:
        raise ValueError("graine invalide") from e
    if not 0 <= seed <= SEED_MAX:
        raise ValueError("graine : de 0 à 2^64 - 1")
    precision = d.get("precision") or "bf16"
    if precision not in CKPTS:
        raise ValueError("précision : bf16 (qualité) ou int8 (rapide)")
    ref = d.get("ref") or ""
    abc = d.get("abc") or ""
    if not isinstance(ref, str) or not isinstance(abc, str):
        raise ValueError("référence ou partition invalide")
    abc = abc.strip()
    if ref and abc:
        raise ValueError("une référence ou une partition, pas les deux")
    if len(abc) > MAX_ABC:
        raise ValueError(f"la partition tient en {MAX_ABC} signes au plus (garde-fou du portail)")
    m = d.get("mode") or ("melody" if ref else "full")
    if m not in MODES:
        raise ValueError("partition : full (mélodie et accords), melody (mélodie seule) ou off (sans)")
    if (ref or abc) and m == "off":
        raise ValueError("une partition fournie ou tirée d'une référence demande full ou melody (YuE2)")
    if ref:
        it = library.get(ref)
        if not it or it.get("kind") != "audio":
            raise ValueError("la référence n'est pas un son de la bibliothèque")
    if abc:
        # une partition qu'on a relue ou nourrie d'un clip MIDI : mise au dialecte sans
        # toucher à la musique, puis jugée (sa forme partout, abc_tools s'il est là) avant
        # d'aller au modèle ; une faute est dite en français, avec sa ligne (abc_pret)
        abc, _ = abc_pret(abc)
    title = (d.get("title") or "")
    title = (title.strip() if isinstance(title, str) else "")[:80] or tags[:60]
    return {"tags": tags, "lyrics": lyrics, "instrumental": not lyrics, "duration_s": round(dur, 2),
            "seed": seed, "mode": m, "precision": precision, "ref": ref, "abc": abc, "title": title}


# ── le graphe ComfyUI ───────────────────────────────────────
def build_graph(p: dict, ref_name: str | None = None) -> dict:
    """Le graphe au format API. Nœuds du gabarit officiel (CheckpointLoaderSimple
    -> YuE2GenerateABC -> YuE2GenerateMusic -> EmptyYuE2LatentAudio -> KSampler ->
    VAEDecodeAudio), la même graine partout comme son SeedNode ; la reprise
    ajoute LoadAudio -> AudioEncoderLoader(SheetSage2) -> SheetSage2AudioToABC
    comme le workflow 02 de Cal. `mode` off : partition vide, le nœud passe
    alors de lui-même en « off » (son infobulle)."""
    seed = p["seed"]
    g = {
        "1": {"class_type": "CheckpointLoaderSimple", "_meta": {"title": "YuE2"},
              "inputs": {"ckpt_name": CKPTS[p["precision"]]}},
        "3": {"class_type": "YuE2GenerateMusic", "_meta": {"title": "rendu musical"},
              "inputs": {"clip": ["1", 1], "style": p["tags"], "lyrics": p["lyrics"], "abc": "",
                         "seed": seed, "mode": "full" if p["mode"] == "off" else p["mode"],
                         "max_duration": float(p["duration_s"]), **MUSIC_SAMPLING}},
        "4": {"class_type": "ConditioningZeroOut", "_meta": {"title": "négatif"},
              "inputs": {"conditioning": ["3", 0]}},
        "5": {"class_type": "EmptyYuE2LatentAudio", "_meta": {"title": "durée (auto)"},
              "inputs": {"seconds": ["3", 1], "batch_size": 1}},
        "6": {"class_type": "KSampler", "_meta": {"title": "synthèse"},
              "inputs": {"model": ["1", 0], "positive": ["3", 0], "negative": ["4", 0],
                         "latent_image": ["5", 0], "seed": seed, **KSAMPLER}},
        "7": {"class_type": "VAEDecodeAudio", "_meta": {"title": "décodage"},
              "inputs": {"samples": ["6", 0], "vae": ["1", 2]}},
        "8": {"class_type": "SaveAudioAdvanced", "_meta": {"title": "OUT"},
              "inputs": {"audio": ["7", 0], "filename_prefix": OUT_PREFIX, "format": "flac"}},
    }
    if p["ref"]:
        g["10"] = {"class_type": "LoadAudio", "_meta": {"title": "référence"},
                   "inputs": {"audio": ref_name or "<référence>"}}
        g["11"] = {"class_type": "AudioEncoderLoader", "_meta": {"title": "SheetSage2"},
                   "inputs": {"audio_encoder_name": SHEETSAGE}}
        g["12"] = {"class_type": "SheetSage2AudioToABC", "_meta": {"title": "morceau -> partition"},
                   "inputs": {"audio_encoder": ["11", 0], "audio": ["10", 0], "mode": p["mode"]}}
        g["3"]["inputs"]["abc"] = ["12", 0]
        g["9"] = {"class_type": "PreviewAny", "_meta": {"title": "ABC"}, "inputs": {"source": ["12", 0]}}
    elif p["abc"]:
        g["3"]["inputs"]["abc"] = p["abc"]
    elif p["mode"] != "off":
        g["2"] = {"class_type": "YuE2GenerateABC", "_meta": {"title": "plan ABC"},
                  "inputs": {"clip": ["1", 1], "style": p["tags"], "lyrics": p["lyrics"], "seed": seed,
                             "mode": p["mode"], **ABC_SAMPLING}}
        g["3"]["inputs"]["abc"] = ["2", 0]
        g["9"] = {"class_type": "PreviewAny", "_meta": {"title": "ABC"}, "inputs": {"source": ["2", 0]}}
    return g


# ── juger un graphe contre /object_info, sans rien mettre en file ──
def _spec_type(conf):
    """(type, options) d'une entrée : les deux formes de liste de ComfyUI."""
    if not isinstance(conf, list) or not conf:
        return None, None
    t = conf[0]
    extra = conf[1] if len(conf) > 1 and isinstance(conf[1], dict) else {}
    if isinstance(t, list):
        return "COMBO", t
    if t == "COMBO":
        return "COMBO", extra.get("options")
    if t == "COMFY_DYNAMICCOMBO_V3":
        return "COMBO", [o.get("key") for o in extra.get("options", []) if isinstance(o, dict)]
    return t, None


def check_graph(graph: dict, info: dict) -> list[str]:
    """Ce qui ferait refuser le graphe : nœud absent, entrée manquante ou
    inconnue, valeur hors de la liste ou des bornes, lien vers une sortie qui
    n'existe pas ou d'un autre type. Une entrée d'envoi de fichier
    (`audio_upload`, `image_upload`) n'est pas jugée : le fichier monte au
    moment du rendu."""
    problems: list[str] = []
    for nid, node in graph.items():
        ct = node.get("class_type")
        spec = info.get(ct)
        if not spec:
            problems.append(f"nœud absent : {ct}")
            continue
        req = (spec.get("input") or {}).get("required") or {}
        opt = (spec.get("input") or {}).get("optional") or {}
        inputs = node.get("inputs") or {}
        for name, conf in req.items():
            if name not in inputs and not (isinstance(conf, list) and conf and conf[0] == "COMFY_AUTOGROW_V3"):
                problems.append(f"{ct} : entrée « {name} » manquante")
        for name, val in inputs.items():
            conf = req.get(name, opt.get(name))
            if conf is None:
                problems.append(f"{ct} : entrée « {name} » inconnue")
                continue
            t, options = _spec_type(conf)
            extra = conf[1] if len(conf) > 1 and isinstance(conf[1], dict) else {}
            if isinstance(val, list):                               # un lien [nœud, sortie]
                if len(val) != 2 or str(val[0]) not in graph:
                    problems.append(f"{ct}.{name} : lien vers un nœud absent ({val})")
                    continue
                src = info.get(graph[str(val[0])].get("class_type")) or {}
                outs = src.get("output") or []
                if not isinstance(val[1], int) or not 0 <= val[1] < len(outs):
                    problems.append(f"{ct}.{name} : la sortie {val[1]} n'existe pas")
                    continue
                ot = outs[val[1]]
                ot = "COMBO" if isinstance(ot, list) else ot
                if t not in ("*", None) and ot != "*" and ot != t and not (t == "COMBO" and ot in ("COMBO", "STRING")):
                    problems.append(f"{ct}.{name} : attend {t}, reçoit {ot}")
                continue
            if extra.get("audio_upload") or extra.get("image_upload"):
                continue
            if t == "COMBO":
                if options is not None and val not in options:
                    problems.append(f"{ct}.{name} : « {val} » n'est pas sur cette machine")
            elif t == "INT":
                if isinstance(val, bool) or not isinstance(val, int):
                    problems.append(f"{ct}.{name} : un entier")
                elif ("min" in extra and val < extra["min"]) or ("max" in extra and val > extra["max"]):
                    problems.append(f"{ct}.{name} : {val} hors de [{extra.get('min')}, {extra.get('max')}]")
            elif t == "FLOAT":
                if isinstance(val, bool) or not isinstance(val, (int, float)):
                    problems.append(f"{ct}.{name} : un nombre")
                elif ("min" in extra and val < extra["min"]) or ("max" in extra and val > extra["max"]):
                    problems.append(f"{ct}.{name} : {val} hors de [{extra.get('min')}, {extra.get('max')}]")
            elif t == "STRING" and not isinstance(val, str):
                problems.append(f"{ct}.{name} : un texte")
            elif t == "BOOLEAN" and not isinstance(val, bool):
                problems.append(f"{ct}.{name} : vrai ou faux")
    if not any((n.get("_meta") or {}).get("title", "").startswith("OUT") for n in graph.values()):
        problems.append("aucune sortie OUT")
    return problems


def fetch_info(c: Comfy, classes) -> dict:
    """/object_info nœud par nœud : rien n'est chargé ni rendu."""
    info: dict = {}
    for ct in sorted(set(classes)):
        try:
            info.update(c.object_info(ct))
        except ComfyError:
            pass
    return info


# ── ce que les machines savent faire ────────────────────────
TEXT_NODES = ("CheckpointLoaderSimple", "YuE2GenerateABC", "YuE2GenerateMusic", "ConditioningZeroOut",
              "EmptyYuE2LatentAudio", "KSampler", "VAEDecodeAudio", "SaveAudioAdvanced", "PreviewAny")
REF_NODES = ("LoadAudio", "AudioEncoderLoader", "SheetSage2AudioToABC")
_mach: dict = {"t": 0.0, "v": None}


def _endpoints() -> list[tuple[str, bool]]:
    """Les ComfyUI connus du portail : ceux de la voie audio (où partent les
    travaux) puis ceux de la voie image (pour dire si l'autre DGX est prête)."""
    lanes = config.get("lanes", {})
    audio = [e for e in lanes.get("audio", []) if e != "local"]
    others = [e for e in lanes.get("image", []) if e != "local" and e not in audio]
    return [(e, True) for e in audio] + [(e, False) for e in others]


def _combo(info: dict, node: str, field: str) -> list:
    conf = ((info.get(node) or {}).get("input") or {}).get("required", {}).get(field)
    return _spec_type(conf)[1] or [] if conf else []


def machines(max_age: float = 60.0) -> list[dict]:
    if _mach["v"] is not None and time.time() - _mach["t"] < max_age:
        return _mach["v"]
    out = []
    for ep, in_lane in _endpoints():
        m = {"machine": jobs.machine_of(ep), "endpoint": ep, "in_lane": in_lane,
             "text": False, "ref": False, "precisions": [], "why": ""}
        ok, why = jobs.endpoint_alive(ep)
        if not ok:
            m["why"] = f"ComfyUI ne répond pas ({why})"[:300]
            out.append(m)
            continue
        info = fetch_info(Comfy(ep, timeout=20), TEXT_NODES + REF_NODES)
        miss = [n for n in TEXT_NODES if n not in info]
        m["precisions"] = [k for k, f in CKPTS.items() if f in _combo(info, "CheckpointLoaderSimple", "ckpt_name")]
        if miss:
            m["why"] = "nœuds absents : " + ", ".join(miss)
        elif not m["precisions"]:
            m["why"] = "aucun poids YuE2 dans models/checkpoints"
        else:
            m["text"] = True
        rmiss = [n for n in REF_NODES if n not in info]
        if m["text"] and not rmiss and SHEETSAGE in _combo(info, "AudioEncoderLoader", "audio_encoder_name"):
            m["ref"] = True
        elif m["text"]:
            m["why"] = "reprise impossible : " + (", ".join(rmiss) if rmiss else f"{SHEETSAGE} absent")
        out.append(m)
    _mach.update(t=time.time(), v=out)
    return out


# ── les options (le contrat que lit la page d'ODIO) ─────────
def options(req=None) -> dict:
    fake = mode() == "factice"
    ms = machines()
    lane = [m for m in ms if m["in_lane"]]
    real_text = any(m["text"] for m in lane)
    real_ref = any(m["ref"] for m in lane)
    cpu = bool(config.get("lanes", {}).get("cpu"))
    if fake:
        ready, why = cpu, ("" if cpu else "aucune voie « cpu » dans la configuration du portail")
    else:
        ready = real_text
        why = "" if ready else ("aucune machine de la voie audio n'a YuE2 : "
                                + "; ".join(f"{m['machine']} : {m['why']}" for m in lane) if lane
                                else "aucune voie « audio » dans la configuration du portail")
    return {
        "engine": mode(),
        "ready": ready, "why": why,
        "ref_ready": cpu if fake else real_ref,
        "switch": "\"music_yue\": true dans showrunner.local.json, puis tools/portail.sh restart",
        "job": {"kind": "music.yue", "lane": "cpu" if fake else "audio",
                "submit": "POST /api/music/yue/generate (ou POST /api/jobs {kind: \"music.yue\", params})",
                "dry_run": "POST /api/music/yue/plan : le graphe et son jugement contre /object_info, rien en file"},
        "params": {
            "tags": {"type": "texte", "required": True, "max": MAX_TAGS, "alias": "style",
                     "doc": "langue + genre + voix + tempo + instruments + caractère (gabarit officiel)"},
            "lyrics": {"type": "texte", "max": MAX_LYRICS,
                       "doc": "seulement les mots chantés, par sections ; vide = instrumental (infobulle du nœud Olm YuE2 Request)"},
            "duration_s": {"type": "nombre", "min": DUR_MIN, "max": DUR_MAX, "default": DUR_DEFAULT,
                           "suggested": list(DUR_SUGGESTED),
                           "doc": "une durée maximale : réduite d'office si le prompt est long, la chanson peut finir avant (nœud YuE2GenerateMusic)"},
            "seed": {"type": "entier", "min": 0, "max": SEED_MAX, "default": "au hasard (-1 ou absent)"},
            "mode": {"type": "choix", "values": list(MODES), "default": "full (melody avec une référence)"},
            "precision": {"type": "choix", "values": list(CKPTS), "default": "bf16"},
            "ref": {"type": "id d'un son de la bibliothèque", "doc": "reprise : SheetSage2 en tire la mélodie, YuE2 la rechante avec ton style et tes paroles"},
            "abc": {"type": "texte", "max": MAX_ABC, "doc": "ta partition ABC (voix « Vocal » et « Ins ») ; exclut ref, demande full ou melody"},
            "title": {"type": "texte", "max": 80},
        },
        "modes": [
            {"id": "full", "label": "partition complète", "doc": "YuE2 écrit mélodie et accords, puis les chante (défaut des chansons neuves)"},
            {"id": "melody", "label": "mélodie seule", "doc": "une mélodie sans accords, l'accompagnement est libre (recommandé pour les reprises)"},
            {"id": "off", "label": "sans partition", "doc": "directement du style et des paroles"},
        ],
        "precisions": [
            {"id": "bf16", "file": CKPTS["bf16"], "size_gb": 7.80, "doc": "qualité ; celle des LoRA (workflow 07 de Cal)"},
            {"id": "int8", "file": CKPTS["int8"], "size_gb": 3.96, "doc": "rapide ; celle du gabarit officiel"},
        ],
        "partition": {
            "edit": True, "check": abc_tools_state(),
            "doc": "YuE2 écrit d'abord la partition (YuE2GenerateABC) ; YuE2GenerateMusic prend « an edited score » : "
                   "POST /api/music/yue/abc l'écrit seule (travail music.yue.abc, rien n'est chanté), "
                   "POST /api/music/yue/abc/check la juge (abc_tools.py), puis `abc` la fait chanter",
            "dialect": "deux voix monophoniques Vocal et Ins, accords entre guillemets dans Vocal, L:1/16 ou 1/32, "
                       "groupes d'une à quatre mesures (abc-editing.md)"},
        "reference": {
            "icl": False,
            "doc": "YuE2 n'a pas d'entrée son de référence (pas d'ICL comme YuE v1) : une référence passe par sa partition. "
                   "SheetSage2 (models/audio_encoders/" + SHEETSAGE + ") la transcrit, YuE2 la rechante (cot=melody)."},
        "tags": {
            "order": ["langue", "genre", "voix", "tempo", "instruments", "caractère"],
            "suggestions": {
                "langue": ["English", "Chinese", "Japanese"],
                "genre": ["pop", "jazz", "rock", "electronic", "folk"],
                "voix": ["warm female vocal", "expressive male vocal", "soft vocals"],
                "tempo": ["90 BPM", "slow", "upbeat"],
                "instruments": ["piano", "electric guitar", "bass", "drums", "synths"],
            },
            "example": "English, warm female vocal, contemporary pop, 96 BPM, piano, rounded electric bass, restrained drums, clear diction",
            "source": TEMPLATE},
        "voices": {
            "doc": "la voix se décrit dans le style : YuE2 n'a ni choix de chanteur ni voix de référence",
            "examples": ["warm female vocal", "expressive male vocal", "soft vocals", "expressive female voice",
                         "intimate female jazz vocal"]},
        "lyrics": {"sections": ["[Verse]", "[Chorus]", "[Bridge]", "[Outro]"],
                   "example": "[Verse]\nMorning light across the window\nCity waking down below\n\n[Chorus]\nRun with me into the sunlight\nLeave the shadows far behind",
                   "source": TEMPLATE},
        "output": {"format": "flac", "sample_rate": 48000, "channels": 2, "kind": "audio", "folder": "Musique",
                   "score": "params.score : la partition ABC écrite par YuE2 (ou tirée de la référence)"},
        "limits": {"context_tokens": CONTEXT, "tokens_per_second": FPS,
                   "doc": "prompt, partition et musique partagent le contexte ; au-delà, YuE2 raccourcit la musique"},
        "timing": [
            {"where": "DGX1, dépôt autonome, bf16", "audio_s": 60.0, "wall_s": 162.6,
             "detail": "plan 12,7 s · jetons 34,6 s · NAR 7,3 s · VAE (chargement + décodage) 66,8 s", "source": "~/YuE/out/song/result.json"},
            {"where": "DGX1, dépôt autonome, bf16", "audio_s": 74.6, "wall_s": 191.5, "source": "~/YuE/webui-out/765a0013bb"},
            {"where": "DGX1, dépôt autonome, bf16", "audio_s": 341.1, "wall_s": 503.6,
             "detail": "partition tronquée à 4096 jetons", "source": "~/YuE/webui-out/bc0175148d"},
            {"where": "DGX2, ComfyUI, bf16", "audio_s": 30.0, "wall_s": 40, "source": "~/yue2_bf16_run.log (relevé toutes les 10 s)"},
            {"where": "DGX2, ComfyUI, int8", "audio_s": 30.0, "wall_s": 20, "source": "~/yue2_test_run.log (relevé toutes les 10 s)"},
        ],
        "memory": "24 Go de VRAM BF16 conseillés (README YuE2) ; les DGX ont 128 Go de mémoire unifiée",
        "license": "poids YuE2 : CC BY-NC 4.0 (usage non commercial) ; code : Apache 2.0",
        "machines": ms,
        "sources": [CARD, TEMPLATE, "ComfyUI v0.37.2 comfy_extras/nodes_yue2.py, comfy/text_encoders/yue2.py",
                    "~/ComfyUI/user/default/workflows/AUDIO/01_YuE2_texte_vers_musique.json, 02_YuE2_reprise_de_morceau.json"],
    }


def api_options(req):
    return options(req)


def api_plan(req):
    """Le graphe qu'enverrait ce réglage, jugé contre /object_info de chaque
    machine qui répond. Rien n'est mis en file."""
    try:
        p = yue_params(req.json())
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    g = build_graph(p)
    checks = {}
    for ep, in_lane in _endpoints():
        if not jobs.endpoint_alive(ep)[0]:
            checks[jobs.machine_of(ep)] = ["ComfyUI ne répond pas"]
            continue
        info = fetch_info(Comfy(ep, timeout=20), [n["class_type"] for n in g.values()])
        checks[jobs.machine_of(ep)] = check_graph(g, info)
    return {"engine": mode(), "params": p, "graph": g, "checks": checks}


def api_generate(req):
    try:
        p = yue_params(req.json())
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    j = jobs.submit("music.yue", p, title=f"YuE2 · {p['title']}"[:90], tool="music")
    return jobs.public(j)


# ── le moteur réel : ComfyUI ────────────────────────────────
def _score_of(entry: dict, graph: dict) -> str:
    """La partition affichée par le nœud PreviewAny « ABC » (sortie ui « text »)."""
    for nid, node in graph.items():
        if node.get("class_type") == "PreviewAny":
            out = (entry.get("outputs") or {}).get(nid) or {}
            txt = out.get("text")
            if isinstance(txt, list):
                return "\n".join(str(t) for t in txt)[:SCORE_KEEP]
            if isinstance(txt, str):
                return txt[:SCORE_KEEP]
    return ""


def render_real(ctx, p: dict):
    """Un rendu YuE2 par ComfyUI : rend [(fichier, partition)] — la partition
    fournie, ou celle que le nœud PreviewAny « ABC » a affichée. Partagé par
    music.yue et par les prises d'une région (music_gen.py)."""
    ctx.progress(message="prépare YuE2")
    ref_name = None
    if p["ref"]:
        ctx.progress(message="envoie la référence à ComfyUI")
        ref_name = ctx.comfy.upload(library.path_of(library.get(p["ref"])))
    graph = build_graph(p, ref_name)
    problems = check_graph(graph, fetch_info(ctx.comfy, [n["class_type"] for n in graph.values()]))
    if problems:
        raise ComfyError("graphe YuE2 refusé avant l'envoi : " + " ; ".join(problems[:8]))
    ctx.check()
    pid = ctx.comfy.queue(graph)
    entry = ctx.comfy.wait(pid, cancelled=ctx.cancelled, report=ctx.comfy_report("YuE2"), timeout=TIMEOUT)
    score = p["abc"] or _score_of(entry, graph)
    out = []
    for k, f in enumerate(Comfy.outputs(entry, graph)):
        out.append((ctx.comfy.download(f, ctx.workdir / f"yue2_{int(time.time() * 1000) % 10 ** 8}_{k:02d}{Path(f['filename']).suffix or '.flac'}"), score))
    if not out:
        raise ComfyError("ComfyUI n'a rendu aucun son")
    return out


def run_real(ctx):
    p = yue_params(ctx.params)
    ctx.progress(0.02, "prépare YuE2")
    parents = [p["ref"]] if p["ref"] else []
    t0 = time.time()
    got = render_real(ctx, p)
    secs = round(time.time() - t0, 1)
    ids = []
    for dest, score in got:
        it = ctx.add(dest, kind="audio", title=p["title"], prompt=p["tags"], parents=parents,
                     params={**p, "engine": "comfyui", "checkpoint": CKPTS[p["precision"]], "score": score,
                             "render_seconds": secs, "sampling": {"abc": ABC_SAMPLING, "music": MUSIC_SAMPLING,
                                                                  "ksampler": KSAMPLER}},
                     origin={"model": f"yue2-3b-{p['precision']}"}, tags=["musique", "généré", "yue2"],
                     folder="Musique")
        ids.append(it["id"])
    score = got[0][1]
    return {"note": f"YuE2 : chanson rendue en {secs:g} s", "render_seconds": secs, "audio": ids,
            "score": score[:4000]}


# ── la partition : le dialecte natif de YuE2 ────────────────
# YuE2 écrit d'abord une partition ABC (YuE2GenerateABC) que YuE2GenerateMusic
# chante ; son entrée `abc` prend aussi « an edited score » (infobulle du
# nœud). Le dialecte natif est décrit par ~/YuE/skills/yue2-music/references/
# abc-editing.md et vérifié par abc_tools.py (même dépôt, Apache 2.0,
# bibliothèque standard) : chargé ici tel quel, jamais recopié.
ABC_TOOLS_DEFAULT = Path.home() / "YuE/skills/yue2-music/scripts/abc_tools.py"
_abc = {"m": None, "why": "", "path": ""}
ABC_VOICES = ('V: Vocal clef=treble name="Vocal Melody" snm="Vocal"', 'V: Ins clef=treble name="Ins Melody" snm="Inst."')
ABC_DURS = (48, 32, 24, 16, 12, 8, 6, 4, 3, 2, 1)          # abc-editing.md : les durées permises
_NAT = dict(zip("CDEFGAB", (0, 2, 4, 5, 7, 9, 11)))
# le nombre d'altérations de chaque armure (abc_tools.py, KEYS)
_KEY_COUNT = {**dict(zip(("Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"), range(-7, 8))),
              **dict(zip(("Abm", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm", "Am", "Em", "Bm", "F#m", "C#m", "G#m", "D#m", "A#m"), range(-7, 8)))}
# la tonique d'ODIO (0 = do) écrite comme une armure que le dialecte connaît
_MAJ_NAME = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
_MIN_NAME = ("Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm")
_MAJORISH = {"major", "lydian", "mixolydian", "pentamaj"}
KEY_MODES = ("major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonic", "pentamaj", "pentamin", "blues")


def abc_tools():
    if _abc["m"] is None and not _abc["why"]:
        path = Path(config.get("yue_abc_tools") or ABC_TOOLS_DEFAULT).expanduser()
        if not path.exists():
            _abc["why"] = f"abc_tools.py absent ({path}) : la partition ne peut pas être vérifiée"
        else:
            try:
                spec = importlib.util.spec_from_file_location("yue2_abc_tools", path)
                m = importlib.util.module_from_spec(spec)
                sys.modules["yue2_abc_tools"] = m          # ses dataclasses se cherchent là
                spec.loader.exec_module(m)
                _abc.update(m=m, path=str(path))
            except Exception as e:  # un fichier cassé ne doit pas empêcher le portail de démarrer
                _abc["why"] = f"abc_tools.py illisible : {type(e).__name__}: {e}"
    return _abc["m"]


def abc_tools_state() -> dict:
    m = abc_tools()
    return {"ok": bool(m), "path": _abc["path"], "why": _abc["why"],
            "source": "~/YuE/skills/yue2-music/scripts/abc_tools.py (YuE, Apache 2.0) : « a bounded native ABC dialect »"}


def abc_check(text: str) -> dict:
    """La partition jugée : d'abord sa forme (abc_marche, la marche par groupes
    d'abc_tools.parse, sans lire les notes — elle tourne partout), puis
    abc_tools.parse_abc s'il est là : {ok, error, error_fr, ligne} ou {ok,
    report} (notes MIDI, instants et durées en noires, accords, mesures, par
    voix) ; {ok: None} quand la forme est bonne et qu'abc_tools manque."""
    if not isinstance(text, str) or not text.strip():
        return {"ok": False, "error": "partition vide", "error_fr": "la partition est vide", "ligne": None}
    r = abc_marche(text)
    if not r["ok"]:
        return {"ok": False, "error": r["en"], "error_fr": abc_message(r), "ligne": r["ligne"]}
    m = abc_tools()
    if not m:
        return {"ok": None, "why": _abc["why"]}
    try:
        # les lignes blanches du bout et les espaces de fin de ligne ne sont pas du dialecte
        score = m.parse_abc("\n".join(ln.rstrip() for ln in text.strip().splitlines()))
    except m.AbcError as e:
        fr, ligne = abc_traduire(str(e), text)
        return {"ok": False, "error": str(e), "error_fr": fr, "ligne": ligne}
    return {"ok": True, "report": json.loads(json.dumps(m.report(score), default=m.json_value))}


# ── la forme d'une partition, dite en français, et ce qu'on corrige sans risque ──
# Cal (06/10) : « LA PARTITION NE PASSE PAS : group 67, Ins: music line must end with a
# plain barline ». La règle est celle d'abc_tools.parse (~/YuE/skills/yue2-music/scripts/
# abc_tools.py, l. 176-218 sur la branche main lue le 05/10/2026) : après l'en-tête de huit
# lignes, la partition est une suite de GROUPES — des « % section » facultatifs, « V: Vocal »,
# sa ligne de musique, « V: Ins », sa ligne ; chaque ligne de musique finit par une barre
# simple « | », porte une à quatre mesures (Z2… comptent pour deux…), autant dans les deux
# voix. Une partition de 67 groupes pour seize mesures demandées : YuE2GenerateABC a écrit
# jusqu'à sa borne (max_abc_tokens 8 192, ABC_SAMPLING — 8 192 / 67 ≈ 122 jetons par groupe)
# et sa dernière ligne est coupée ; c'est notre lecture, rien ne la dément ni ne la prouve.
# abc_marche refait cette marche (pas les notes : abc_tools reste le seul juge des mesures)
# pour nommer la LIGNE en cause ; abc_normalise ne fait que ce qui ne change pas la musique,
# et, sur demande (couper), retire un dernier groupe coupé.
VOIX_FR = {"Vocal": "chant (Vocal)", "Ins": "thème (Ins)"}
ENTETE = 8                    # X:, T:, M:, L:, Q:, les deux voix, K: (abc_tools.parse, l. 155-170)


def _lignes(text: str) -> tuple[list[str], int]:
    """Les lignes sans leurs espaces de fin, sans les lignes blanches du début et
    de la fin (abc_check les ôte aussi) ; le décalage rend leurs numéros à l'écran."""
    raw = [ln.rstrip() for ln in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    off = 0
    while off < len(raw) and not raw[off]:
        off += 1
    end = len(raw)
    while end > off and not raw[end - 1]:
        end -= 1
    return raw[off:end], off


def abc_marche(text: str) -> dict:
    """La forme, comme abc_tools.parse la parcourt : {ok: True, groupes} ou la
    première faute {ok: False, ligne (comptée à l'écran), groupe, voix, code,
    en (le message même d'abc_tools), fr, groupes (ceux d'avant, entiers)}.
    Un groupe : {debut, fin (indices), Vocal, Ins (l'indice de leur ligne de
    musique), mesures}."""
    lines, off = _lignes(text if isinstance(text, str) else "")
    n = len(lines)
    groups: list[dict] = []

    def faute(i, code, en, fr, group=None, voice=None):
        # la faute est-elle dans le DERNIER groupe (aucun « V: Vocal » après elle) : la marque d'une partition coupée
        queue = i is not None and not any(ln == "V: Vocal" for ln in lines[i + 1:])
        return {"ok": False, "ligne": (None if i is None else min(i, max(0, n - 1)) + off + 1), "groupe": group,
                "voix": voice, "code": code, "en": en, "fr": fr, "groupes": groups, "n": n, "off": off, "queue": queue}
    if n < 12:
        return faute(None, "entete", "Incomplete native two-voice ABC", "la partition est incomplète : l'en-tête (huit lignes) et au moins un groupe des deux voix")
    for i, ok_, en, fr in ((0, lines[0:2] == ["X:1", "T:"], "Expected native X:1 and blank T: header", "les deux premières lignes sont « X:1 » puis « T: »"),
                           (2, lines[2].startswith("M:"), "Missing header M:", "la ligne 3 dit la mesure (« M:4/4 »)"),
                           (3, re.fullmatch(r"L:1/([1-9][0-9]*)", lines[3]) is not None, "Expected L:1/<power of two>, usually L:1/32",
                            "la ligne 4 dit l'unité (« L:1/16 »)"),
                           (4, re.fullmatch(r"Q:1/4=([1-9][0-9]*)", lines[4]) is not None, "Expected integer quarter-note tempo Q:1/4=<BPM>",
                            "la ligne 5 dit le tempo en nombre entier (« Q:1/4=112 »)"),
                           (5, lines[5:7] == list(ABC_VOICES), "Preserve native Vocal and Ins voice definitions",
                            "les lignes 6 et 7 déclarent les deux voix telles que YuE2 les écrit (« V: Vocal clef=treble … », « V: Ins … »)"),
                           (7, lines[7].startswith("K:"), "Missing header K:", "la ligne 8 dit la tonalité (« K:Fm »)")):
        if not ok_:
            return faute(i, "entete", en, fr)
    cur, group = ENTETE, 0
    while cur < n:
        start = cur
        while cur < n and lines[cur].startswith("% "):
            cur += 1
        if cur == n:
            return faute(start, "commentaire", "Dangling section comment without music", "un commentaire de section « % … » n'a pas de musique après lui", group + 1)
        group += 1
        g: dict = {"debut": start}
        counts = []
        for name in ("Vocal", "Ins"):
            ctx = f"group {group}, {name}"
            if cur >= n or lines[cur] != f"V: {name}":
                why = "une ligne vide au milieu de la partition : le dialecte n'en a pas" if cur < n and not lines[cur] else f"il manque « V: {name} » ici"
                return faute(cur, "voix", f"{ctx}: expected V: {name}", why, group, name)
            cur += 1
            while cur < n and lines[cur].startswith(("M:", "K:")):
                cur += 1
            if cur >= n:
                return faute(cur, "ligne", f"{ctx}: missing music line", "la ligne de musique manque", group, name)
            line = lines[cur]
            if not line.endswith("|"):
                return faute(cur, "barre", f"{ctx}: music line must end with a plain barline",
                             "une ligne de musique finit par une barre simple « | »", group, name)
            bars = 0
            for bar in line[:-1].split("|"):
                bar = bar.strip()
                if not bar:
                    return faute(cur, "vide", f"{ctx}: empty measure or unsupported double/repeat barline",
                                 "une mesure vide, ou une double barre, une reprise (« || », « |: », « :| ») : le dialecte n'en a pas", group, name)
                m = re.fullmatch(r"Z([2-4])?", bar)
                bars += int(m.group(1) or "1") if m else 1
            if not 1 <= bars <= 4:
                return faute(cur, "mesures", f"{ctx}: expected 1–4 measures after expanding Z rests",
                             f"{bars} mesures sur cette ligne : un groupe en porte une à quatre", group, name)
            g[name] = cur
            counts.append(bars)
            cur += 1
        if counts[0] != counts[1]:
            return faute(cur - 1, "compte", f"group {group}: voices have different measure counts",
                         f"le chant a {counts[0]} mesure{'s' if counts[0] > 1 else ''}, le thème {counts[1]} : autant dans les deux voix", group)
        groups.append({**g, "fin": cur, "mesures": counts[0]})
    return {"ok": True, "groupes": groups, "n": n, "off": off}


def abc_message(r: dict) -> str:
    """Une faute de forme, pour Cal : la ligne, le groupe, la voix, quoi faire ;
    le message d'abc_tools à la fin, tel quel (pour le retrouver)."""
    where = [f"ligne {r['ligne']}"] if r.get("ligne") else []
    if r.get("groupe"):
        where.append(f"groupe {r['groupe']}" + (f", {VOIX_FR.get(r['voix'], r['voix'])}" if r.get("voix") else ""))
    head = f"{where[0]} ({', '.join(where[1:])})" if len(where) > 1 else (where[0] if where else "")
    todo = ""
    if r.get("code") in ("barre", "ligne", "voix") and r.get("queue") and r.get("groupes"):
        todo = " — la fin de la partition semble coupée : « Corriger » retire ce dernier groupe incomplet"
    elif r.get("code") == "barre":
        todo = " — ajoute « | » au bout de cette ligne si sa dernière mesure est complète"
    return f"{head + ' : ' if head else ''}{r['fr']}{todo} (abc_tools : « {r['en']} »)"


# les messages d'abc_tools.parse et parse_bar (l. 87-224), en français
_FR = (
    (r"duration (\S+) quarter notes != meter duration (\S+)", lambda m: f"la mesure dure {m[1]} noire(s) au lieu de {m[2]}"),
    (r"note/rest exceeds meter duration", lambda m: "une note ou un silence dépasse la fin de la mesure"),
    (r"event after the measure end", lambda m: "un signe après la fin de la mesure"),
    (r"unsupported token at (.*)", lambda m: f"un signe que le dialecte ne connaît pas : {m[1]}"),
    (r"unsupported duration (\d+).*", lambda m: f"la durée {m[1]} n'est pas dans la liste (1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48) : la lier en plusieurs (« C8-C2 »)"),
    (r"unsupported chord (.*)", lambda m: f"l'accord {m[1]} n'est pas une des 15 qualités du dialecte (abc-editing.md)"),
    (r"tie changes pitch.*", lambda m: "une liaison change de hauteur"),
    (r"tie enters a .*rest", lambda m: "une liaison mène à un silence"),
    (r"mixed octave marks", lambda m: "une note porte à la fois « , » et « ' »"),
    (r"pitch (\d+) is outside MIDI range", lambda m: f"la hauteur {m[1]} sort des notes MIDI (0 à 127)"),
    (r"a rest cannot have accidentals, octave marks or ties", lambda m: "un silence ne porte ni altération, ni octave, ni liaison"),
    (r"unresolved tie at end of score", lambda m: "une liaison à la fin de la partition ne se résout pas"),
    (r"Native chord symbols belong in Vocal, not Ins", lambda m: "les accords s'écrivent dans le chant (Vocal), pas dans le thème (Ins)"),
    (r"Voice meter/time grids differ", lambda m: "les deux voix n'ont pas les mêmes mesures"),
    (r"Voice key-change timelines differ", lambda m: "les deux voix ne changent pas de tonalité aux mêmes instants"),
    (r"Unsupported key (.*); .*", lambda m: f"la tonalité {m[1]} n'est pas du dialecte : majeure ou mineure (« K:C », « K:Fm »)"),
    (r"Unsupported meter (.*); .*", lambda m: f"la mesure {m[1]} s'écrit en fraction (« M:4/4 »)"),
    (r"duplicate (\w): field", lambda m: f"deux champs « {m[1]}: » de suite"),
)


def abc_traduire(err: str, text: str) -> tuple[str, int | None]:
    """Un message d'abc_tools en français, avec la ligne quand il nomme un groupe
    et une voix (« group 12, Ins, bar 3: … ») : (texte, ligne à l'écran)."""
    m = re.match(r"group (\d+)(?:, (Vocal|Ins))?(?:, bar (\d+))?: (.*)", err) or re.match(r"(Vocal|Ins): (.*)", err)
    group = voice = bar = None
    rest = err
    if m and m.re.pattern.startswith("group"):
        group, voice, bar, rest = int(m[1]), m[2], m[3], m[4]
    elif m:
        voice, rest = m[1], m[2]
    fr = next((f(mm) for pat, f in _FR for mm in [re.fullmatch(pat, rest)] if mm), None)
    ligne = None
    if group:
        r = abc_marche(text)
        gs = r["groupes"]
        if group <= len(gs):
            g = gs[group - 1]
            idx = g.get(voice or "Vocal", g["debut"])
            ligne = idx + (r.get("off") or 0) + 1
    where = []
    if ligne:
        where.append(f"ligne {ligne}")
    det = ", ".join(x for x in (f"groupe {group}" if group else "", VOIX_FR.get(voice, "") if voice else "", f"mesure {bar}" if bar else "") if x)
    head = f"{where[0]} ({det})" if where and det else (where[0] if where else det)
    return f"{head + ' : ' if head else ''}{fr or rest} (abc_tools : « {err} »)", ligne


def abc_normalise(text: str, couper: bool = False) -> tuple[str, list[str]]:
    """La partition mise au dialecte sans toucher à la musique : espaces de fin
    de ligne, lignes blanches (au bout et au milieu), retours chariot, une
    liaison sur la toute dernière note de chaque voix (qui ne se résout jamais :
    abc_tools la refuse). Avec `couper` (une partition écrite par YuE2, ou
    « Corriger ») : un dernier groupe coupé est retiré — sa barre manque, ou sa
    seconde voix — et une partition plus longue que MAX_ABC perd ses derniers
    groupes. Rend (texte, ce qui a été fait, en français)."""
    if not isinstance(text, str):
        return "", []
    notes: list[str] = []
    lines, _ = _lignes(text)
    blank = sum(1 for ln in lines if not ln)
    if blank:
        lines = [ln for ln in lines if ln]
        notes.append(f"{blank} ligne{'s' if blank > 1 else ''} vide{'s' if blank > 1 else ''} retirée{'s' if blank > 1 else ''}")
    out = "\n".join(lines)
    if couper:
        for _ in range(3):
            r = abc_marche(out)
            if r["ok"] or r["code"] not in ("barre", "ligne", "voix") or not r["groupe"]:
                break
            lines = out.split("\n")
            at = (r["ligne"] or 1) - 1
            if not r["queue"]:
                break                                   # une faute au milieu : pas sûre à corriger
            gs = r["groupes"]
            if not gs:
                break                                   # rien d'entier à garder
            if r["code"] == "barre" and abc_tools():
                # la barre seule manquait-elle ? abc_tools juge la mesure ainsi fermée
                fixed = lines[:at] + [lines[at] + "|"] + lines[at + 1:]
                if abc_check("\n".join(fixed)).get("ok"):
                    out = "\n".join(fixed)
                    notes.append(f"ligne {at + 1} : la barre « | » de fin ajoutée (la mesure était complète)")
                    continue
            out = "\n".join(lines[:gs[-1]["fin"]])
            notes.append(f"la fin était coupée au milieu du groupe {r['groupe']} (ligne {at + 1}) : ce groupe incomplet est retiré, "
                         f"{len(gs)} groupe{'s' if len(gs) > 1 else ''} reste{'nt' if len(gs) > 1 else ''} "
                         f"({sum(g['mesures'] for g in gs)} mesures)")
        r = abc_marche(out)
        if r["ok"] and len(out) > MAX_ABC and len(r["groupes"]) > 1:
            lines, gs = out.split("\n"), r["groupes"]
            k = len(gs)
            while k > 1 and len("\n".join(lines[:gs[k - 1]["fin"]])) > MAX_ABC:
                k -= 1
            out = "\n".join(lines[:gs[k - 1]["fin"]])
            notes.append(f"la partition dépassait {MAX_ABC} signes : {len(gs) - k} groupes de la fin retirés")
    # une liaison sur la dernière note d'une voix ne se résout jamais : on la retire
    r = abc_marche(out)
    if r["ok"] and r["groupes"]:
        lines, g = out.split("\n"), r["groupes"][-1]
        for name in ("Vocal", "Ins"):
            ln = lines[g[name]]
            if ln.endswith("-|"):
                lines[g[name]] = ln[:-2] + "|"
                notes.append(f"{VOIX_FR[name]} : la liaison de la dernière note retirée")
        out = "\n".join(lines)
    return out, notes


def abc_pret(text: str, couper: bool = False) -> tuple[str, list[str]]:
    """La partition qu'on envoie : normalisée, puis jugée (la forme partout,
    abc_tools s'il est là) ; une faute lève ValueError, en français, avec la
    ligne. Rend (texte, ce qui a été corrigé)."""
    out, notes = abc_normalise(text, couper)
    chk = abc_check(out)
    if chk["ok"] is False:
        raise ValueError(f"la partition ne suit pas le dialecte de YuE2 : {chk['error_fr']}")
    return out, notes


def abc_key(tonic: int, md: str) -> str:
    return (_MAJ_NAME if md in _MAJORISH else _MIN_NAME)[tonic]


def abc_note(pitch: int, key: str, local: dict) -> str:
    """Une hauteur MIDI écrite dans le dialecte natif (C = do4 = 60, c = do5,
    C, = do3, c' = do6), l'altération seulement quand l'armure et les
    altérations déjà posées dans la mesure ne la donnent pas (elles valent
    pour la lettre à toutes les octaves : abc-editing.md)."""
    count = _KEY_COUNT[key]
    key_alt = {k: 0 for k in _NAT}
    for letter in ("FCGDAEB" if count > 0 else "BEADGCF")[:abs(count)]:
        key_alt[letter] = 1 if count > 0 else -1
    pc = pitch % 12
    cands = []
    for letter, n in _NAT.items():
        for alt in (0, 1, -1):
            if (n + alt) % 12 == pc:
                cands.append((letter, alt))
    # d'abord la lettre que l'armure donne telle quelle, puis le sens de l'armure
    cands.sort(key=lambda c: (c[1] != key_alt[c[0]], c[1] != 0, (c[1] < 0) if count >= 0 else (c[1] > 0)))
    letter, alt = cands[0]
    cur = local.get(letter, key_alt[letter])
    acc = "" if cur == alt else {0: "=", 1: "^", -1: "_"}[alt]
    if acc:
        local[letter] = alt
    natural = pitch - alt
    octave = natural // 12 - 1
    if octave <= 4:
        return acc + letter + "," * (4 - octave)
    return acc + letter.lower() + "'" * (octave - 5)


def abc_durs(units: int) -> list[int]:
    out = []
    while units > 0:
        d = next(x for x in ABC_DURS if x <= units)
        out.append(d)
        units -= d
    return out


def fake_abc(seed: int, bpm: float, sig: int, tonic: int, md: str, sections: list, sing: bool = True,
             chords: bool = True) -> str:
    """La partition d'essai (moteur factice), dans le dialecte natif : une
    mélodie tirée de la graine dans la gamme du projet, un accord par mesure
    (i VI III VII en mineur, I V vi IV en majeur) dans la voix Vocal, la voix
    Ins au repos ; une section `% tag` par section que la région couvre.
    Ce n'est pas la partition de YuE2 : c'est de quoi relire, modifier et
    vérifier le trajet."""
    rng = random.Random(seed)
    key = abc_key(tonic, md)
    minor = md not in _MAJORISH
    sc = (0, 2, 3, 5, 7, 8, 10) if minor else (0, 2, 4, 5, 7, 9, 11)
    degs = (0, 5, 2, 6) if minor else (0, 4, 5, 3)
    qual = ({0: "m", 5: "", 2: "", 6: ""} if minor else {0: "", 4: "", 5: "m", 3: ""})
    names = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    unit = sig * 4                                       # L:1/16 : une mesure de sig noires
    lines = ["X:1", "T:", f"M:{sig}/4", "L:1/16", f"Q:1/4={int(round(bpm))}", *ABC_VOICES, f"K:{key}"]
    bar_no = 0
    deg = 7                                              # la mélodie part de la tonique aiguë
    for tag, n in sections:
        n = int(n)
        g = 0
        while g < n:
            size = min(4, n - g)
            vocal = []
            for _ in range(size):
                d = degs[bar_no % 4]
                chord = f'"{names[(tonic + sc[d]) % 12]}{qual[d]}"' if chords else ""
                local: dict = {}
                if not sing:
                    vocal.append(chord + "".join(f"z{x}" if x != 1 else "z" for x in abc_durs(unit)))
                else:
                    toks, left = [], unit
                    while left > 0:
                        ln = min(left, rng.choice((2, 2, 4, 4, 6, 8)))
                        deg = max(0, min(11, deg + rng.choice((-2, -1, -1, 0, 1, 1, 2))))
                        pitch = 60 + tonic + sc[deg % 7] + 12 * (deg // 7)
                        parts = abc_durs(ln)
                        note = abc_note(pitch, key, local)
                        toks.append("-".join(note + (str(x) if x != 1 else "") for x in parts))
                        left -= ln
                    vocal.append(chord + "".join(toks))
                bar_no += 1
            lines += [f"% {tag}", "V: Vocal", "|".join(vocal) + "|", "V: Ins", ("Z" if size == 1 else f"Z{size}") + "|"]
            g += size
    return "\n".join(lines)


def abc_song(path: Path, abc: str, max_s: float, sr: int = 24000) -> float:
    """Le son d'essai d'une partition : ses notes jouées telles que
    abc_tools les lit (Vocal en sinus vibré, Ins en triangle, les accords en
    nappe), au tempo de la partition, jusqu'à `max_s` secondes. De quoi
    entendre qu'une partition modifiée a fait le trajet."""
    chk = abc_check(abc)
    if not chk.get("ok"):
        raise ValueError(f"partition refusée : {chk.get('error') or chk.get('why')}")
    rep = chk["report"]
    spq = 60.0 / rep["bpm"]
    total = min(max_s, float(rep["nominal_duration_seconds"])) if max_s else float(rep["nominal_duration_seconds"])
    n = max(1, int(total * sr))
    buf = [0.0] * n

    def frac(s):
        a, _, b = str(s).partition("/")
        return float(a) / float(b or 1)

    def tone(t0, dur, midi, amp, tri=False, vib=0.0):
        f = 440.0 * 2 ** ((midi - 69) / 12)
        i0, ln = int(t0 * sr), int(dur * sr)
        ph = 0.0
        for i in range(max(0, min(ln, n - i0))):
            t = i / sr
            env = min(1.0, t / 0.02) * min(1.0, (ln - i) / (0.03 * sr))
            ph += 2 * math.pi * f * (1 + vib * math.sin(2 * math.pi * 5.5 * t)) / sr
            s = (2 / math.pi) * math.asin(math.sin(ph)) if tri else math.sin(ph) + 0.25 * math.sin(2 * ph)
            buf[i0 + i] += amp * env * s
    for name, amp, tri, vib in (("Vocal", 0.32, False, 0.006), ("Ins", 0.22, True, 0.0)):
        for nt in rep["voices"][name]["notes"]:
            tone(frac(nt["onset_quarters"]) * spq, frac(nt["duration_quarters"]) * spq, nt["midi_pitch"], amp, tri, vib)
    # les accords : la racine lue dans le symbole, tenue jusqu'au suivant (une nappe grave)
    ch = rep["voices"]["Vocal"]["chords"]
    root = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    for i, (t, name) in enumerate(ch):
        t0 = frac(t) * spq
        t1 = frac(ch[i + 1][0]) * spq if i + 1 < len(ch) else total
        pc = root[name[0]] + (1 if name[1:2] == "#" else -1 if name[1:2] == "b" else 0)
        minor = name[1:].lstrip("#b").startswith("m") and not name[1:].lstrip("#b").startswith("maj")
        for iv in (0, 3 if minor else 4, 7):
            tone(t0, t1 - t0, 48 + pc + iv, 0.07)
    peak = max(1e-9, max(abs(x) for x in buf))
    pcm = array("h", (int(x / peak * 0.7 * 32767) for x in buf for _ in (0, 1)))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return total


def abc_params(d: dict) -> dict:
    """Écrire seulement la partition (YuE2GenerateABC) : le style, les paroles,
    la graine, le mode (full ou melody : le nœud n'a pas « off »), la
    précision ; et, pour le moteur d'essai, ce que dit le projet (tempo,
    mesure, tonalité, les sections de la région)."""
    base = yue_params({**d, "duration_s": DUR_DEFAULT, "ref": "", "abc": ""})
    if base["mode"] == "off":
        raise ValueError("écrire la partition demande « mélodie et accords » ou « mélodie seule » (YuE2GenerateABC)")
    pj = d.get("projet") or {}
    bpm = _num(pj.get("bpm", 120), "tempo")
    sig = pj.get("sig", 4)
    if sig not in (2, 3, 4, 6) or not 20 <= bpm <= 300:
        raise ValueError("tempo (20 à 300) et mesure (2, 3, 4 ou 6) du projet")
    tonic = pj.get("tonic", 9)
    if isinstance(tonic, bool) or not isinstance(tonic, int) or not 0 <= tonic <= 11:
        raise ValueError("tonique : 0 à 11")
    md = pj.get("mode", "minor")
    if md not in KEY_MODES:
        raise ValueError(f"mode inconnu : {md}")
    secs = d.get("sections") or [["verse", 4]]
    if not isinstance(secs, list) or not all(isinstance(s, list) and len(s) == 2 and isinstance(s[0], str)
                                             and isinstance(s[1], int) and 1 <= s[1] <= 256 for s in secs) or sum(s[1] for s in secs) > 512:
        raise ValueError("sections : [[étiquette, mesures], …], 512 mesures au plus")
    return {**base, "projet": {"bpm": bpm, "sig": sig, "tonic": tonic, "mode": md}, "sections": secs}


def build_abc_graph(p: dict) -> dict:
    """Seulement le plan : CheckpointLoaderSimple → YuE2GenerateABC →
    PreviewAny (« OUT ABC », la sortie texte que lit _score_of)."""
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "_meta": {"title": "YuE2"}, "inputs": {"ckpt_name": CKPTS[p["precision"]]}},
        "2": {"class_type": "YuE2GenerateABC", "_meta": {"title": "plan ABC"},
              "inputs": {"clip": ["1", 1], "style": p["tags"], "lyrics": p["lyrics"], "seed": p["seed"], "mode": p["mode"], **ABC_SAMPLING}},
        "9": {"class_type": "PreviewAny", "_meta": {"title": "OUT ABC"}, "inputs": {"source": ["2", 0]}},
    }


def run_abc_test(ctx):
    p = abc_params(ctx.params)
    ctx.progress(0.2, "partition d'essai (moteur factice)")
    pj = p["projet"]
    abc = fake_abc(p["seed"], pj["bpm"], pj["sig"], pj["tonic"], pj["mode"], p["sections"], sing=bool(p["lyrics"]),
                   chords=p["mode"] == "full")
    abc, notes = abc_normalise(abc, couper=True)
    return {"note": "partition d'essai écrite (moteur factice, pas YuE2)", "abc": abc, "engine": "factice", "check": abc_check(abc),
            "normalise": notes}


def run_abc_real(ctx):
    p = abc_params(ctx.params)
    g = build_abc_graph(p)
    problems = check_graph(g, fetch_info(ctx.comfy, [n["class_type"] for n in g.values()]))
    if problems:
        raise ComfyError("graphe de la partition refusé avant l'envoi : " + " ; ".join(problems[:8]))
    pid = ctx.comfy.queue(g)
    entry = ctx.comfy.wait(pid, cancelled=ctx.cancelled, report=ctx.comfy_report("YuE2 · partition"), timeout=TIMEOUT)
    abc = _score_of(entry, g)
    if not abc.strip():
        raise ComfyError("YuE2 n'a pas rendu de partition (sortie texte de PreviewAny vide)")
    # ce que YuE2 a écrit, mis au dialecte : une fin coupée (sa borne de jetons) perd son
    # dernier groupe incomplet, et le dit (06/10, « group 67, Ins: music line must end… »)
    abc, notes = abc_normalise(abc, couper=True)
    note = "partition écrite par YuE2" + (f" ; {' ; '.join(notes)}" if notes else "")
    return {"note": note, "abc": abc, "engine": "comfyui", "check": abc_check(abc), "normalise": notes}


def api_abc(req):
    try:
        p = abc_params(req.json())
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    j = jobs.submit("music.yue.abc", {**req.json(), "seed": p["seed"]}, title=f"YuE2 · partition · {p['title']}"[:90], tool="music")
    return jobs.public(j)


def api_abc_check(req):
    """Juger une partition (la page, à chaque frappe) : le jugement, et, si elle ne
    passe pas, `corriger` — la partition que « Corriger » poserait (abc_normalise
    avec couper) et ce qu'elle change — quand elle, passe. `{corriger: true}` :
    rend directement la partition corrigée et son jugement."""
    d = req.json()
    text = d.get("abc")
    if not isinstance(text, str) or len(text) > 4 * MAX_ABC:
        raise HttpError(400, f"partition : un texte de {4 * MAX_ABC} signes au plus")
    if d.get("corriger"):
        out, notes = abc_normalise(text, couper=True)
        return {**abc_check(out), "abc": out, "normalise": notes, "tools": abc_tools_state()}
    chk = abc_check(text)
    if chk["ok"] is False:
        out, notes = abc_normalise(text, couper=True)
        if notes and abc_check(out)["ok"] is not False:
            chk["corriger"] = {"abc": out, "notes": notes}
    return {**chk, "tools": abc_tools_state()}


# ── le moteur factice : une mélodie d'essai, sans modèle ────
_ABC_NOTE = {0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B", 12: "c"}
_SCALE = (0, 2, 4, 5, 7, 9, 11, 12)


def _tempo(tags: str) -> int:
    m = re.search(r"(\d{2,3})\s*bpm", tags, re.I)
    bpm = int(m.group(1)) if m else 96
    return bpm if 40 <= bpm <= 220 else 96


def test_song(path: Path, p: dict, sr: int = 48000) -> str:
    """Le son d'essai : deux mesures (une « voix » en sinus vibré sur une nappe
    d'accord, ou la nappe seule sans paroles) tirées de la graine, calculées
    une fois puis répétées jusqu'à la durée. WAV 16 bits stéréo 48 kHz comme
    YuE2. Ce n'est pas de la musique générée : c'est un repère qui prouve que
    la durée, la graine et le tempo ont fait tout le trajet. Rend la
    partition ABC (d'essai) de la mélodie jouée."""
    rng = random.Random(p["seed"])
    bpm = _tempo(p["tags"])
    beat = 60.0 / bpm
    melody = [rng.choice(_SCALE) for _ in range(8)]
    n = int(round(8 * beat * sr))
    buf = [0.0] * n
    root = 57                                            # la grave (A3) : la nappe
    for k, iv in enumerate((0, 4, 7)):
        f = 440.0 * 2 ** ((root - 12 + iv - 69) / 12)
        for i in range(n):
            buf[i] += 0.09 * math.sin(2 * math.pi * f * i / sr + k)
    if not p["instrumental"]:
        base = 60                                        # do médium : la « voix »
        for b, deg in enumerate(melody):
            f = 440.0 * 2 ** ((base + deg - 69) / 12)
            t0 = int(b * beat * sr)
            ln = int(beat * sr * 0.92)
            ph = 0.0
            for i in range(min(ln, n - t0)):
                t = i / sr
                env = min(1.0, t / 0.03) * min(1.0, (ln - i) / (0.08 * sr))
                ph += 2 * math.pi * f * (1 + 0.006 * math.sin(2 * math.pi * 5.5 * t)) / sr
                buf[t0 + i] += 0.35 * env * (math.sin(ph) + 0.25 * math.sin(2 * ph))
    for b in range(8):                                   # un clic par temps
        t0 = int(b * beat * sr)
        for i in range(min(int(0.02 * sr), n - t0)):
            buf[t0 + i] += 0.2 * math.exp(-i / (0.004 * sr)) * (1 if i % 2 else -1)
    peak = max(1e-9, max(abs(x) for x in buf))
    pcm = array("h", (int(x / peak * 0.7 * 32767) for x in buf for _ in (0, 1)))
    total = int(p["duration_s"] * sr)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        left = total
        while left > 0:
            k = min(left, n)
            w.writeframes(pcm[: k * 2].tobytes())
            left -= k
    notes = " ".join(_ABC_NOTE[d] for d in melody[:4]) + " | " + " ".join(_ABC_NOTE[d] for d in melody[4:]) + " |"
    return (f"X:1\nT:{p['title']} (partition d'essai, moteur factice)\nM:4/4\nL:1/4\nQ:1/4={bpm}\nK:C\n"
            f"V:Vocal\n{notes if not p['instrumental'] else 'z4 | z4 |'}\n")


def fake_render(dest: Path, p: dict) -> str:
    """Le rendu d'essai d'une chanson (réglages de yue_params) dans `dest`
    (WAV) ; rend la partition qu'on entend. Partagé par music.yue et par
    l'app Musique (server/tools/chanson.py)."""
    if abc_tools():
        # comme YuE2 : d'abord une partition (la sienne, ou une d'essai dans le
        # dialecte natif), puis le son qu'elle dit — la partition rangée est
        # celle qu'on entend
        bpm = _tempo(p["tags"])
        bars = max(1, math.ceil(p["duration_s"] / (4 * 60 / bpm)))
        score = p["abc"] or fake_abc(p["seed"], bpm, 4, 9, "minor", [["verse", bars]], sing=not p["instrumental"],
                                     chords=p["mode"] == "full")
        abc_song(dest, score, p["duration_s"])
        return score
    score = p["abc"] or test_song(dest, p)
    if p["abc"]:
        test_song(dest, p)
    return score


def run_test(ctx):
    p = yue_params(ctx.params)
    ctx.progress(0.1, "mélodie d'essai (moteur factice)")
    t0 = time.time()
    dest = ctx.workdir / "essai_yue.wav"
    score = fake_render(dest, p)
    ctx.check()
    secs = round(time.time() - t0, 1)
    it = ctx.add(dest, kind="audio", title=f"{p['title']} (essai)", prompt=p["tags"],
                 parents=[p["ref"]] if p["ref"] else [],
                 params={**p, "engine": "factice", "score": score, "render_seconds": secs},
                 origin={"model": "factice"}, tags=["musique", "essai", "yue2"], folder="Musique")
    return {"note": f"son d'essai de {p['duration_s']:g} s (moteur factice, pas YuE2)", "render_seconds": secs,
            "audio": [it["id"]], "score": score[:4000]}


def register(app) -> None:
    if mode() == "comfyui":
        jobs.register("music.yue", run_real, lane="audio", title="YuE2", cost="gpu")
        jobs.register("music.yue.abc", run_abc_real, lane="audio", title="YuE2 · partition", family="yue", gpu=True, cost="gpu")
    else:
        jobs.register("music.yue", run_test, lane="cpu", title="YuE2 (essai)", cost="cpu")
        jobs.register("music.yue.abc", run_abc_test, lane="cpu", title="YuE2 · partition (essai)", cost="cpu")
    app.route("GET", "/api/music/yue/options", api_options)
    app.route("POST", "/api/music/yue/plan", api_plan)
    app.route("POST", "/api/music/yue/generate", api_generate)
    # la partition : l'écrire seule (YuE2GenerateABC), la vérifier (abc_tools)
    app.route("POST", "/api/music/yue/abc", api_abc)
    app.route("POST", "/api/music/yue/abc/check", api_abc_check)


# ── le contrôle sans GPU (tools/check.py) ───────────────────
# le schéma des nœuds tel que /object_info le rend sur DGX2 (ComfyUI v0.37.2,
# 29/09/2026), réduit aux entrées du graphe : de quoi éprouver check_graph
FAKE_INFO = {
    "CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [[CKPTS["bf16"], CKPTS["int8"], "autre.safetensors"]]}},
                               "output": ["MODEL", "CLIP", "VAE"]},
    "YuE2GenerateABC": {"input": {"required": {
        "clip": ["CLIP"], "style": ["STRING", {"multiline": True}], "lyrics": ["STRING", {"multiline": True}],
        "seed": ["INT", {"default": 0, "min": 0, "max": SEED_MAX}], "mode": ["COMBO", {"options": ["full", "melody"]}],
        "max_abc_tokens": ["INT", {"min": 1, "max": 20000}], "temperature": ["FLOAT", {"min": 0.0, "max": 5.0}],
        "top_p": ["FLOAT", {"min": 0.01, "max": 1.0}], "top_k": ["INT", {"min": 1, "max": 32768}],
        "repetition_penalty": ["FLOAT", {"min": 0.01, "max": 10.0}], "penalty_window": ["INT", {"min": 1, "max": 20000}]}},
        "output": ["STRING"]},
    "YuE2GenerateMusic": {"input": {"required": {
        "clip": ["CLIP"], "style": ["STRING", {}], "lyrics": ["STRING", {}], "abc": ["STRING", {"default": ""}],
        "seed": ["INT", {"min": 0, "max": SEED_MAX}], "mode": ["COMBO", {"options": ["full", "melody"]}],
        "max_duration": ["FLOAT", {"min": 0.04, "max": 900.0}], "temperature": ["FLOAT", {"min": 0.0, "max": 5.0}],
        "top_p": ["FLOAT", {"min": 0.01, "max": 1.0}], "top_k": ["INT", {"min": 1, "max": 32768}],
        "repetition_penalty": ["FLOAT", {"min": 0.01, "max": 10.0}]},
        "optional": {"cfg_scale": ["FLOAT", {"min": 0.0, "max": 100.0}]}}, "output": ["CONDITIONING", "FLOAT"]},
    "ConditioningZeroOut": {"input": {"required": {"conditioning": ["CONDITIONING"]}}, "output": ["CONDITIONING"]},
    "EmptyYuE2LatentAudio": {"input": {"required": {"seconds": ["FLOAT", {"min": 0.04, "max": 1000.0}],
                                                    "batch_size": ["INT", {"min": 1, "max": 4096}]}}, "output": ["LATENT"]},
    "KSampler": {"input": {"required": {
        "model": ["MODEL"], "seed": ["INT", {"min": 0, "max": SEED_MAX}], "steps": ["INT", {"min": 1, "max": 10000}],
        "cfg": ["FLOAT", {"min": 0.0, "max": 100.0}], "sampler_name": [["euler", "dpm_2"]],
        "scheduler": [["simple", "sgm_uniform"]], "positive": ["CONDITIONING"], "negative": ["CONDITIONING"],
        "latent_image": ["LATENT"], "denoise": ["FLOAT", {"min": 0.0, "max": 1.0}]}}, "output": ["LATENT"]},
    "VAEDecodeAudio": {"input": {"required": {"samples": ["LATENT"], "vae": ["VAE"]}}, "output": ["AUDIO"]},
    "SaveAudioAdvanced": {"input": {"required": {
        "audio": ["AUDIO", {}], "filename_prefix": ["STRING", {"default": "audio/ComfyUI"}],
        "format": ["COMFY_DYNAMICCOMBO_V3", {"options": [{"key": "flac"}, {"key": "mp3"}, {"key": "opus"}]}]}},
        "output": []},
    "PreviewAny": {"input": {"required": {"source": ["*", {}]}}, "output": ["STRING"]},
    "LoadAudio": {"input": {"required": {"audio": ["COMBO", {"options": ["a.flac"], "audio_upload": True}]}}, "output": ["AUDIO"]},
    "AudioEncoderLoader": {"input": {"required": {"audio_encoder_name": [[SHEETSAGE]]}}, "output": ["AUDIO_ENCODER"]},
    "SheetSage2AudioToABC": {"input": {"required": {"audio_encoder": ["AUDIO_ENCODER"], "audio": ["AUDIO"],
                                                    "mode": ["COMBO", {"options": ["melody", "full"]}]}}, "output": ["STRING"]},
}


def selftest(call, ok) -> None:
    st, o = call("GET", "/api/music/yue/options")
    ok(st == 200 and o.get("engine") == "factice" and o.get("ready") is True, f"options, moteur factice prêt ({st} {str(o)[:200]})")
    ok([m["id"] for m in o.get("modes", [])] == ["full", "melody", "off"], "les trois modes de partition")
    ok(o.get("params", {}).get("duration_s", {}).get("max") == 900.0 and o["params"]["duration_s"]["min"] == 10.0,
       "durées 10 à 900 s")
    ok(o.get("reference", {}).get("icl") is False and o["job"]["kind"] == "music.yue", "pas d'ICL : la référence passe par la partition")

    p = yue_params({"tags": "English, pop, 96 BPM", "lyrics": "[Verse]\nla nuit", "seed": 7})
    ok(p["mode"] == "full" and p["precision"] == "bf16" and p["duration_s"] == 60.0 and not p["instrumental"], "défauts")
    ok(yue_params({"style": "folk"})["tags"] == "folk", "« style » vaut « tags »")
    ok(yue_params({"tags": "folk"})["instrumental"], "sans paroles : instrumental")
    s = yue_params({"tags": "folk", "seed": -1})["seed"]
    ok(0 <= s < 2 ** 32, "graine -1 : au hasard")
    for bad, why in (({"tags": ""}, "style vide"), ({"tags": "x", "duration_s": 5}, "durée < 10 s"),
                     ({"tags": "x", "duration_s": 901}, "durée > 900 s"), ({"tags": "x", "mode": "karaoke"}, "mode inconnu"),
                     ({"tags": "x", "precision": "fp4"}, "précision inconnue"),
                     ({"tags": "x", "abc": "X:1", "mode": "off"}, "partition sans mode"),
                     ({"tags": "x", "abc": "X:1", "ref": "aud-x"}, "référence et partition"),
                     ({"tags": "x", "ref": "aud-nexiste-pas"}, "référence absente"),
                     ({"tags": "a", "style": "b"}, "tags et style discordants"),
                     ({"tags": "x", "seed": 2 ** 64}, "graine trop grande"), ({"tags": "x", "duration_s": True}, "durée booléenne")):
        try:
            yue_params(bad)
            ok(False, f"refusé : {why}")
        except ValueError:
            ok(True, why)

    g = build_graph(p)
    ok(g["3"]["inputs"]["abc"] == ["2", 0] and g["2"]["inputs"]["mode"] == "full" and g["9"]["inputs"]["source"] == ["2", 0],
       "full : la partition du plan ABC nourrit le rendu")
    ok(g["6"]["inputs"]["seed"] == g["2"]["inputs"]["seed"] == g["3"]["inputs"]["seed"] == 7, "une graine partout")
    ok(g["1"]["inputs"]["ckpt_name"] == CKPTS["bf16"] and g["8"]["_meta"]["title"] == "OUT", "poids bf16, sortie OUT")
    ok(check_graph(g, FAKE_INFO) == [], f"graphe full jugé bon ({check_graph(g, FAKE_INFO)})")
    goff = build_graph({**p, "mode": "off"})
    ok("2" not in goff and goff["3"]["inputs"]["abc"] == "" and goff["3"]["inputs"]["mode"] == "full"
       and check_graph(goff, FAKE_INFO) == [], "off : partition vide, le nœud passe en off")
    gabc = build_graph({**p, "abc": "X:1\nK:C\nC D E F |", "mode": "melody"})
    ok(gabc["3"]["inputs"]["abc"].startswith("X:1") and "2" not in gabc and check_graph(gabc, FAKE_INFO) == [], "partition fournie")
    gref = build_graph({**p, "ref": "aud-x", "mode": "melody"}, "sr_ref.flac")
    ok(gref["3"]["inputs"]["abc"] == ["12", 0] and gref["12"]["inputs"]["mode"] == "melody"
       and gref["10"]["inputs"]["audio"] == "sr_ref.flac" and check_graph(gref, FAKE_INFO) == [],
       f"reprise : SheetSage2 -> partition -> YuE2 ({check_graph(gref, FAKE_INFO)})")
    ok("{{" not in json.dumps(g), "plus aucun trou dans le graphe")

    bad = json.loads(json.dumps(g))
    bad["1"]["inputs"]["ckpt_name"] = "yue2_absent.safetensors"
    bad["3"]["inputs"]["max_duration"] = 1200.0
    bad["6"]["inputs"]["negative"] = ["4", 3]
    bad["7"]["inputs"]["vae"] = ["1", 1]
    bad["99"] = {"class_type": "YuE2Inexistant", "inputs": {}}
    del bad["5"]["inputs"]["batch_size"]
    probs = " | ".join(check_graph(bad, FAKE_INFO))
    for frag, why in (("yue2_absent", "poids absent"), ("1200", "durée hors bornes"), ("sortie 3", "sortie inexistante"),
                      ("attend VAE", "type de lien"), ("YuE2Inexistant", "nœud absent"), ("batch_size", "entrée manquante")):
        ok(frag in probs, f"check_graph voit : {why} ({probs[:300]})")

    st, r = call("POST", "/api/music/yue/generate", {"tags": ""})
    ok(st == 400 and r.get("error"), "une chanson sans style est refusée à l'entrée")
    st, pl = call("POST", "/api/music/yue/plan", {"tags": "folk", "lyrics": "[Verse]\nla", "seed": 3})
    ok(st == 200 and pl["graph"]["3"]["class_type"] == "YuE2GenerateMusic" and isinstance(pl["checks"], dict),
       f"le plan à vide ({st})")

    def wait(jid):
        jj = {}
        for _ in range(300):
            _, jj = call("GET", f"/api/jobs/{jid}")
            if jj.get("state") in ("done", "error", "cancelled"):
                return jj
            time.sleep(0.2)
        return jj

    st, j = call("POST", "/api/music/yue/generate", {"tags": "English, pop, 120 BPM", "lyrics": "[Verse]\nla la",
                                                      "duration_s": 12, "seed": 11, "title": "Essai YuE"})
    ok(st == 200 and j.get("state") == "queued" and j["kind"] == "music.yue", f"une chanson en file ({st})")
    j = wait(j["id"]) if st == 200 else {}
    items = j.get("items") or []
    ok(j.get("state") == "done" and len(items) == 1 and items[0]["kind"] == "audio"
       and abs((items[0].get("duration") or 0) - 12) < 0.05 and items[0]["params"]["engine"] == "factice"
       and items[0]["params"]["score"].startswith("X:1") and "(essai)" in items[0]["title"],
       f"le son d'essai rentre dans la bibliothèque avec sa partition ({j.get('state')} {j.get('message')})")
    if items:
        st, j2 = call("POST", "/api/jobs", {"kind": "music.yue", "params": {"tags": "jazz", "ref": items[0]["id"],
                                                                            "duration_s": 10, "seed": 1}})
        j2 = wait(j2["id"]) if st == 200 else {}
        it2 = (j2.get("items") or [{}])[0]
        ok(j2.get("state") == "done" and it2.get("parents") == [items[0]["id"]] and it2["params"]["mode"] == "melody",
           f"une reprise garde sa référence pour parent ({j2.get('state')} {j2.get('message')})")

    # ── la partition : le dialecte natif, écrit, vérifié, chanté ──
    # La route de la partition seule (travail music.yue.abc) ne demande pas abc_tools.py :
    # le moteur d'essai l'écrit (fake_abc), abc_tools la juge s'il est là. Elle s'essaie
    # donc partout, et la garde du calcul de tools/check.py la rejoue pour un guest.
    judge = bool(abc_tools())
    st, j = call("POST", "/api/music/yue/abc", {"tags": "pop", "seed": 4, "mode": "full", "projet": {"bpm": 112, "sig": 4, "tonic": 5, "mode": "minor"},
                                              "sections": [["verse", 4], ["chorus", 4]], "lyrics": "[Verse]\nla"})
    j = wait(j["id"]) if st == 200 else {}
    res = j.get("result") or {}
    ok(j.get("state") == "done" and "Q:1/4=112" in res.get("abc", "") and "K:Fm" in res["abc"]
       and res.get("check", {}).get("ok") is (True if judge else None),
       f"la partition d'essai d'une région : 112, fa mineur, {'jugée bonne' if judge else 'pas jugée (abc_tools.py absent)'} "
       f"({j.get('state')} {j.get('message')})")

    # ── la forme (06/10, Cal : « group 67, Ins: music line must end with a plain barline ») ──
    # Une partition de 67 groupes dont la dernière ligne est coupée au milieu, comme une
    # écriture arrêtée à sa borne de jetons. La marche par groupes est la nôtre (elle tourne
    # sans abc_tools) et redit son message mot pour mot ; abc_tools, s'il est là, le confirme.
    full = fake_abc(5, 112, 4, 5, "minor", [["verse", 4]] * 67, sing=True)
    cut = "\n".join(full.split("\n")[:-1] + ['F4G4A4c4|d4c4A4'])
    nlines = len(cut.split("\n"))
    chk = abc_check(cut)
    ok(chk["ok"] is False and chk["error"] == "group 67, Ins: music line must end with a plain barline"
       and chk["ligne"] == nlines and f"ligne {nlines}" in chk["error_fr"] and "groupe 67" in chk["error_fr"]
       and "thème (Ins)" in chk["error_fr"] and "Corriger" in chk["error_fr"],
       f"la faute de Cal reproduite, dite en français avec sa ligne ({chk})")
    if judge:
        try:
            abc_tools().parse_abc(cut)
            ok(False, "abc_tools refuse aussi la partition coupée")
        except abc_tools().AbcError as e:
            ok(str(e) == chk["error"], f"abc_tools dit le même message que notre marche ({e})")
    fixed, notes = abc_normalise(cut, couper=True)
    rf = abc_marche(fixed)
    ok(rf["ok"] and len(rf["groupes"]) == 66 and abc_check(fixed)["ok"] is (True if judge else None)
       and any("groupe 67" in x for x in notes), f"normalisée : le groupe coupé retiré, 66 groupes, elle passe ({notes})")
    ok(abc_normalise(cut)[0] == cut.strip(), "sans « couper » (une saisie en cours), rien n'est retiré")
    st, r = call("POST", "/api/music/yue/abc/check", {"abc": cut})
    ok(st == 200 and r.get("ok") is False and r.get("corriger", {}).get("abc") == fixed and r["error_fr"] == chk["error_fr"],
       f"la route de vérification propose « Corriger » ({st} {str(r)[:160]})")
    st, r = call("POST", "/api/music/yue/abc/check", {"abc": cut, "corriger": True})
    ok(st == 200 and r.get("ok") is not False and r.get("abc") == fixed and r.get("normalise") == notes, "« Corriger » rend la partition qui passe")
    # la barre seule oubliée au bout d'une mesure complète : abc_tools le sait, sinon le groupe part
    lone = full.rstrip("|")
    fl, nl = abc_normalise(lone, couper=True)
    ok((fl == full and "barre" in nl[0]) if judge else (len(abc_marche(fl)["groupes"]) == 66),
       f"une barre oubliée : {'ajoutée (abc_tools juge la mesure complète)' if judge else 'sans abc_tools, le groupe est retiré (sûr)'} ({nl})")
    # au milieu : pas de correction devinée, une faute claire avant l'envoi
    mid = full.split("\n")
    i_mid = next(i for i, ln in enumerate(mid) if ln == "V: Ins") + 1
    mid[i_mid] = mid[i_mid].rstrip("|")
    try:
        abc_pret("\n".join(mid), couper=True)
        ok(False, "une barre manquante au milieu est refusée avant l'envoi")
    except ValueError as e:
        ok(f"ligne {i_mid + 1}" in str(e) and "groupe 1" in str(e) and "ajoute « | »" in str(e),
           f"une barre manquante au milieu : refusée avant l'envoi, la ligne dite ({e})")
    try:
        yue_params({"tags": "pop", "abc": cut, "mode": "full"})
        ok(False, "YuE2 ne reçoit pas une partition coupée")
    except ValueError as e:
        ok(f"ligne {nlines}" in str(e), f"YuE2 ne reçoit pas une partition coupée ({str(e)[:120]})")
    sp = full.split("\n")
    sp[-3] = sp[-3][:-1] + "-|"                     # la dernière note du chant, liée vers… rien
    sp.insert(12, "")
    tied = "\n".join(sp)
    tn, tnotes = abc_normalise(tied)
    ok(abc_marche(tn)["ok"] and not tn.endswith("-|") and len(tnotes) == 2,
       f"une ligne vide et une liaison sur la dernière note : retirées sans toucher à la musique ({tnotes})")

    if not judge:
        ok(True, f"abc_tools.py absent : essais de la partition sautés ({_abc['why']})")
        return
    ex = ('X:1\nT:\nM:4/4\nL:1/16\nQ:1/4=88\n' + "\n".join(ABC_VOICES) + '\nK:C\n% verse\nV: Vocal\n'
          '"C"E2G2A2G2E2D2C4|"G"D2E2G2E2D2C2D4|\nV: Ins\nZ2|\n')
    chk = abc_check(ex)
    ok(chk["ok"] and chk["report"]["voices"]["Vocal"]["sounding_notes"] == 14 and chk["report"]["bpm"] == 88,
       f"abc_tools lit l'exemple du dépôt YuE ({str(chk)[:200]})")
    bad = abc_check(ex.replace("C4|", "C4C|"))
    ok(bad["ok"] is False and "bar 1" in bad["error"], f"une mesure trop longue est refusée, la mesure nommée ({bad})")
    ok(abc_note(66, "D", {}) == "F" and abc_note(65, "D", {}) == "=F" and abc_note(70, "F", {}) == "B"
       and abc_note(72, "C", {}) == "c" and abc_note(48, "C", {}) == "C," and abc_note(61, "C", {}) == "^C",
       "les hauteurs dans l'armure : F dièse en ré, si bémol en fa, do5 en minuscule, do3 avec une virgule")
    loc: dict = {}
    ok([abc_note(p, "C", loc) for p in (66, 66, 65)] == ["^F", "F", "=F"], "une altération vaut pour la mesure, un bécarre la défait")
    for sig in (2, 3, 4, 6):
        f = fake_abc(3, 112, sig, 5, "minor", [["verse", 5], ["chorus", 3]], sing=True)
        c = abc_check(f)
        ok(c["ok"] and c["report"]["voices"]["Vocal"]["measures"] == 8 and len(c["report"]["voices"]["Vocal"]["chords"]) == 8,
           f"partition d'essai en {sig}/4 : 8 mesures, un accord par mesure, jugée bonne ({str(c)[:160]})")
    ok(abc_check(fake_abc(3, 90, 4, 0, "major", [["intro", 2]], sing=False))["ok"], "partition instrumentale : des silences sous les accords")
    try:
        yue_params({"tags": "pop", "abc": ex.replace("C4|", "C4C|"), "mode": "full"})
        ok(False, "une partition hors dialecte est refusée avant le modèle")
    except ValueError:
        ok(True, "une partition hors dialecte est refusée avant le modèle")
    gg = build_abc_graph(abc_params({"tags": "pop", "seed": 2, "mode": "melody"}))
    ok(check_graph(gg, FAKE_INFO) == [] and gg["2"]["inputs"]["mode"] == "melody", f"le graphe de la partition seule ({check_graph(gg, FAKE_INFO)})")
    st, r = call("POST", "/api/music/yue/abc/check", {"abc": ex})
    ok(st == 200 and r.get("ok") is True and r["tools"]["ok"], f"la route de vérification ({st})")
    st, j = call("POST", "/api/music/yue/generate", {"tags": "pop", "abc": ex, "mode": "full", "duration_s": 12, "seed": 1})
    j = wait(j["id"]) if st == 200 else {}
    it3 = (j.get("items") or [{}])[0]
    ok(j.get("state") == "done" and it3.get("params", {}).get("score") == ex.strip() and abs(it3.get("duration", 0) - 8 * 60 / 88) < 0.05,
       f"une partition fournie est chantée telle quelle : 8 temps à 88 = 5,45 s ({j.get('state')} {it3.get('duration')})")
