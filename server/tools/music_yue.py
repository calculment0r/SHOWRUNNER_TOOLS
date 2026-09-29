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

import json
import math
import random
import re
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


def run_real(ctx):
    p = yue_params(ctx.params)
    ctx.progress(0.02, "prépare YuE2")
    ref_name = None
    parents = []
    if p["ref"]:
        it = library.get(p["ref"])
        ctx.progress(0.03, "envoie la référence à ComfyUI")
        ref_name = ctx.comfy.upload(library.path_of(it))
        parents = [it["id"]]
    graph = build_graph(p, ref_name)
    problems = check_graph(graph, fetch_info(ctx.comfy, [n["class_type"] for n in graph.values()]))
    if problems:
        raise ComfyError("graphe YuE2 refusé avant l'envoi : " + " ; ".join(problems[:8]))
    ctx.check()
    t0 = time.time()
    pid = ctx.comfy.queue(graph)
    entry = ctx.comfy.wait(pid, cancelled=ctx.cancelled, report=ctx.comfy_report("YuE2"), timeout=TIMEOUT)
    secs = round(time.time() - t0, 1)
    score = p["abc"] or _score_of(entry, graph)
    ids = []
    for k, f in enumerate(Comfy.outputs(entry, graph)):
        dest = ctx.comfy.download(f, ctx.workdir / f"yue2_{k:02d}{Path(f['filename']).suffix or '.flac'}")
        it = ctx.add(dest, kind="audio", title=p["title"], prompt=p["tags"], parents=parents,
                     params={**p, "engine": "comfyui", "checkpoint": CKPTS[p["precision"]], "score": score,
                             "render_seconds": secs, "sampling": {"abc": ABC_SAMPLING, "music": MUSIC_SAMPLING,
                                                                  "ksampler": KSAMPLER}},
                     origin={"model": f"yue2-3b-{p['precision']}"}, tags=["musique", "généré", "yue2"],
                     folder="Musique")
        ids.append(it["id"])
    if not ids:
        raise ComfyError("ComfyUI n'a rendu aucun son")
    return {"note": f"YuE2 : chanson rendue en {secs:g} s", "render_seconds": secs, "audio": ids,
            "score": score[:4000]}


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


def run_test(ctx):
    p = yue_params(ctx.params)
    ctx.progress(0.1, "mélodie d'essai (moteur factice)")
    t0 = time.time()
    dest = ctx.workdir / "essai_yue.wav"
    score = p["abc"] or test_song(dest, p)
    if p["abc"]:
        test_song(dest, p)
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
        jobs.register("music.yue", run_real, lane="audio", title="YuE2")
    else:
        jobs.register("music.yue", run_test, lane="cpu", title="YuE2 (essai)")
    app.route("GET", "/api/music/yue/options", api_options)
    app.route("POST", "/api/music/yue/plan", api_plan)
    app.route("POST", "/api/music/yue/generate", api_generate)


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
