"""Upscale : agrandir et affiner les images et les vidéos de la
bibliothèque. Cal, 29/09 : « il faudra un upscale aussi ». L'étude qui
fonde chaque choix : `docs/etudes/upscale.md`.

Deux moteurs (`upscale_backend` dans showrunner.local.json) :

  stub     le défaut (Cal, 28/09 : « on se concentre sur l'UX et l'UI, le
           câblage des modèles se fera après ») : un agrandissement
           bicubique (PIL pour une image, ffmpeg pour une vidéo), étiqueté
           « FACTICE » dans l'image et dans `origin.model`. Aucun modèle
           n'est chargé, rien n'est envoyé à ComfyUI.
  comfyui  le câblage réel, écrit et validé à vide contre /object_info des
           deux ComfyUI (`GET /api/upscale/models`, « availability ») ; les
           images rendues pour de vrai le 30/09 (les quatre modèles retenus,
           sur DGX2), avec la vraie progression (`image.live_run`) :

  SeedVR2 7B / 3B   restauration en un pas (ByteDance-Seed, Apache-2.0),
                    nœuds natifs de ComfyUI. Image : le graphe de Character
                    Factory (`factory/upscale.py`, `seedvr2_workflow`),
                    importé comme le fait l'outil Image ; vidéo :
                    `server/workflows/upscale_seedvr2_video.json`, tiré du
                    gabarit officiel `utility_seedvr2_3b_int8_upscale_video`.
  RealESRGAN ×2     GAN rapide, image par image. Image : `esrgan_workflow`
                    de Character Factory ; vidéo : `upscale_esrgan_video.json`
                    (gabarit `utility-gan_upscaler`).
  Z-Image Affiner   le graphe « Affiner ×2 » de l'outil Image
                    (`tools.image.edit_graph`, gabarit
                    `utility_z_image_turbo_2k_upscaler`) : réinvente le détail.

Les autres modèles vus sur les machines (AuraSR, SUPIR, InvSR) et FlashVSR
sont montrés éteints, avec ce qui manque (étude §3, §7).

La page parle en préréglages (« Upscale précis », « créatif », « Aperçu
rapide ») : `PRESETS`, la seule correspondance préréglage → modèle et
paramètres, rejouée ici à chaque envoi ; les modèles et leurs réglages ne se
montrent que dans « Paramètres avancés » (préréglage « custom »). Chaque
média a sa pile (`GET /api/upscale/pile/<id>`) : la source et ses essais.

Travaux : `upscale.image`, `upscale.video` — voie `image` (un ouvrier par
DGX) en câblage réel, voie `cpu` en factice. Chaque sortie entre dans la
bibliothèque avec sa lignée (`parents` = la source) et sa recette
(`params`, `origin.model`, `render_s`, `upscale.from/to`).
"""

from __future__ import annotations

import json
import math
import random
import statistics
import subprocess
import threading
import time
from pathlib import Path

from core import config, jobs, library
from core.comfy import Cancelled, Comfy, ComfyError, fill
from core.http import HttpError
from tools import image as img   # les graphes SeedVR2, RealESRGAN (Character Factory) et Z-Image « Affiner »

REPO = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO / "server" / "workflows"
GIB = 1024 ** 3


def backend() -> str:
    b = str(config.get("upscale_backend", "stub"))
    return b if b in ("stub", "comfyui") else "stub"


# ── les modèles ─────────────────────────────────────────────
# `way` : où le modèle se place entre fidélité et invention (étude §4).
# `weights_gb` : la taille des fichiers de poids lus sur les DGX le 29/09
# (Go décimaux) — un plancher de mémoire, pas une estimation complète.
SEEDVR2_3B = "seedvr2_3b_int8_convrot.safetensors"   # gabarit utility_seedvr2_3b_int8_upscale_video

MODELS: dict[str, dict] = {
    "seedvr2-7b": {
        "name": "SeedVR2 7B", "k": "SEEDVR2 · 7B INT8", "kinds": ("image", "video"), "way": "fidèle",
        "role": "restaure sans rien inventer : la même photo, nette et plus grande. Le plus fin des deux SeedVR2.",
        "weights_gb": 8.33 + 0.50,
        "src": "carte ByteDance-Seed/SeedVR2 (Apache-2.0) ; nœuds natifs ComfyUI (PR #14424) ; "
               "gabarit utility_seedvr2_7b_int8_upscale_image ; Character Factory factory/upscale.py",
    },
    "seedvr2-3b": {
        "name": "SeedVR2 3B", "k": "SEEDVR2 · 3B INT8", "kinds": ("image", "video"), "way": "fidèle",
        "role": "le même, plus léger et plus rapide : celui du gabarit vidéo officiel, le défaut pour une vidéo.",
        "weights_gb": 3.46 + 0.50,
        "src": "gabarits utility_seedvr2_3b_int8_upscale_image et _video ; docs.comfy.org/tutorials/utility/seedvr2",
    },
    "esrgan-x2": {
        "name": "RealESRGAN ×2", "k": "GAN · ×2", "kinds": ("image", "video"), "way": "net",
        "role": "rapide, image par image : un aperçu net en quelques secondes, sans lien d'une image à la suivante "
                "(peut scintiller en vidéo).",
        "max_factor": 2.0, "weights_gb": 0.067,
        "src": "RealESRGAN_x2.pth d'ai-forever/Real-ESRGAN (sha256 vérifié, BSD-3-Clause) ; gabarit utility-gan_upscaler ; "
               "Character Factory esrgan_workflow",
    },
    "zimage-refine": {
        "name": "Z-Image · Affiner", "k": "Z-IMAGE TURBO", "kinds": ("image",), "way": "créatif",
        "role": "réinvente le détail fin (peau, tissu) : le plus créatif, il peut changer un visage. "
                "Image seulement ; ramène à 1 Mpx puis ×2.",
        "fixed": True, "weights_gb": 12.31 + 8.04 + 0.34,
        "src": "gabarit utility_z_image_turbo_2k_upscaler ; outil Image, « Affiner ×2 » (image_zimage_refine.json)",
    },
    # vus, pas retenus : éteints, avec ce qui manque
    "aurasr-v2": {
        "name": "AuraSR v2", "k": "GAN · ×4", "kinds": ("image",), "way": "créatif",
        "role": "GAN ×4 de fal, fait pour les images générées ; « pas idéal pour les visages » (sa fiche).",
        "off": "modèle absent : fal/AuraSR-v2 (2,47 Go, Apache-2.0) à télécharger ; nœud AuraSR installé sur DGX2 seulement",
        "src": "huggingface.co/fal/AuraSR-v2 ; README d'AuraSR-ComfyUI (GreenLandisaLie)",
    },
    "flashvsr": {
        "name": "FlashVSR v1.1", "k": "VIDÉO · ×4", "kinds": ("video",), "way": "créatif",
        "role": "super-résolution vidéo par diffusion en un pas (Wan 2.1 1,3B), pensée pour le temps réel.",
        "off": "ni nœud ni poids sur les DGX : FlashVSR v1.1 (6,95 Go, Apache-2.0) et un nœud ComfyUI à installer",
        "src": "huggingface.co/JunhaoZhuang/FlashVSR-v1.1",
    },
    "supir": {
        "name": "SUPIR", "k": "SDXL · 45 PAS", "kinds": ("image",), "way": "créatif",
        "role": "restauration photo par SDXL et un ControlNet dédié ; lourde et lente.",
        "off": "il lui faut un checkpoint SDXL, absent des deux DGX (SUPIR-v0Q y est) ; licence non commerciale",
        "src": "README de ComfyUI-SUPIR (kijai) et de SUPIR (XPixel)",
    },
    "invsr": {
        "name": "InvSR", "k": "SD-TURBO · 1–5 PAS", "kinds": ("image",), "way": "créatif",
        "role": "super-résolution par inversion de diffusion, en 1 à 5 pas.",
        "off": "poids absents (sd-turbo et noise_predictor : le nœud les téléchargerait au premier usage) ; "
               "nœud sur DGX2 seulement ; licence S-Lab non commerciale",
        "src": "README de ComfyUI_InvSR (yuvraj108c)",
    },
}
RETAINED = ("seedvr2-7b", "seedvr2-3b", "esrgan-x2", "zimage-refine")
DEFAULT = {"image": "seedvr2-7b", "video": "seedvr2-3b"}

# Les tailles cibles. Image : 2K = grand côté 2048 (la 2K native de Qwen-Image
# 2.1, outil Image) ; 4K = grand côté 4096 (exemple SeedVR2_4K_image_upscale
# du nœud numz : resolution 4096, max_resolution 4096). Vidéo : les deux
# réglages du nœud numz — `resolution` (« shortest edge », défaut 1080) et
# `max_resolution` (« if any edge exceeds this … both dimensions are scaled
# down ») — au cadre du format : la vidéo tient dans 1920 × 1080 ou
# 3840 × 2160, qu'elle soit 16:9, plus large (1792 × 768 → 1920 × 822) ou
# verticale.
TARGETS = {
    "image": {"2k": {"label": "2K", "sub": "grand côté 2048", "long": 2048},
              "4k": {"label": "4K", "sub": "grand côté 4096", "long": 4096}},
    "video": {"1080p": {"label": "1080p", "sub": "dans 1920 × 1080", "short": 1080, "max": 1920},
              "4k": {"label": "4K UHD", "sub": "dans 3840 × 2160", "short": 2160, "max": 3840}},
}
# SeedVR2PostProcessing.color_correction_method : les infobulles du nœud
COLORS = [
    {"id": "lab", "name": "Lab", "sub": "FIDÈLE", "about": "la couleur de la source recalée en CIELAB, le détail gardé — "
                                                            "« most faithful », le défaut du nœud"},
    {"id": "wavelet", "name": "Ondelettes", "sub": "DÉTAIL", "about": "la couleur basse fréquence de la source, le détail fin de l'agrandie"},
    {"id": "adain", "name": "AdaIN", "sub": "RAPIDE", "about": "moyenne et écart par canal : une teinte globale, le plus rapide"},
    {"id": "none", "name": "Aucune", "sub": "GABARIT", "about": "la géométrie seule, sans recaler la couleur (le réglage des gabarits)"},
]
# ── les préréglages ─────────────────────────────────────────
# Cal, 29/09 : « il faut vraiment parler simplement aux gens : upscale
# créatif, upscale précis etc. pas les noms des modèles […] on met cela en
# paramètres avancés ». La page montre ces mots ; chaque préréglage règle,
# par sorte de média, le modèle et ses paramètres. C'est la seule table de
# correspondance : la page la lit (/api/upscale/models) et le serveur la
# rejoue à l'envoi — un préréglage ne dépend pas de ce que la page envoie à
# côté. Ce qu'un préréglage ne nomme pas prend DEFAULT_SET.
DEFAULT_SET = {"color": "lab", "denoise": 0.25, "prompt": ""}
PRESETS: dict[str, dict] = {
    "precis": {
        "label": "Upscale précis", "short": "Précis", "about": "fidèle, rien d'inventé",
        "image": {"model": "seedvr2-7b", "color": "lab"},
        "video": {"model": "seedvr2-3b", "color": "lab"},
        "src": "SeedVR2 : « conservative upscaling … preserves original structure » (docs.comfy.org/tutorials/utility/seedvr2) ; "
               "image : le 7B, « higher quality » (même page) ; vidéo : le 3B du gabarit officiel "
               "utility_seedvr2_3b_int8_upscale_video ; couleur lab, « most faithful », le défaut de "
               "SeedVR2PostProcessing — étude §3, §4, §6",
    },
    "creatif": {
        "label": "Upscale créatif", "short": "Créatif", "about": "ajoute du détail fin",
        "image": {"model": "zimage-refine", "denoise": 0.25},
        "video": None,
        "off": {"video": "image seulement : aucun modèle créatif pour la vidéo n'est installé (FlashVSR, à télécharger — étude §7)"},
        "src": "gabarit utility_z_image_turbo_2k_upscaler (Z-Image Turbo, « Affiner » de l'outil Image) : réinvente le "
               "détail fin ; débruitage conseillé 0,15–0,35, « au-delà, des défauts » : 0,25 au milieu — étude §3, §4",
    },
    "rapide": {
        "label": "Aperçu rapide", "short": "Rapide", "about": "net, en quelques secondes",
        "image": {"model": "esrgan-x2"},
        "video": {"model": "esrgan-x2"},
        "src": "note du gabarit utility-gan_upscaler : « can't create new detail like diffusion can, but it's much "
               "faster » ; RealESRGAN_x2 fait ×2 au plus — étude §3, §6",
    },
}
ADVANCED = ("model", "color", "denoise", "prompt")   # ce que « Paramètres avancés » règle


def settings_for(c: dict, kind: str) -> dict:
    """Le modèle et ses paramètres pour une sorte de média : ceux du
    préréglage, ou (« custom ») ceux que la page envoie. `who` : le nom que
    la personne voit dans une raison (le préréglage, pas le modèle).
    ValueError : pourquoi ce média ne passe pas."""
    if c["preset"] == "custom":
        s = {k: c[k] for k in ADVANCED}
        who = MODELS[c["model"]]["name"]
    else:
        pr = PRESETS[c["preset"]]
        if not pr.get(kind):
            raise ValueError(pr["off"][kind])
        s = {**DEFAULT_SET, **pr[kind]}
        who = pr["label"]
    if kind not in MODELS[s["model"]]["kinds"]:
        raise ValueError(f"{who} n'agrandit pas les {'vidéos' if kind == 'video' else 'images'}")
    return {**s, "who": who}


MAX_FACTOR = 8.0      # ResizeImageMaskNode « scale by multiplier » : max 8,0 (/object_info)
MAX_IMAGE = 8192      # la limite de l'outil Image pour l'agrandissement
MAX_VIDEO = (2160, 4096)   # la 4K UHD : petit côté, grand côté — la cible de Cal (1080p/4K)
MAX_ITEMS = 50

# La mémoire de SeedVR2 : la loi de ComfyUI (comfy/ldm/seedvr/constants.py,
# ComfyUI 830232b8 du 23/09 sur DGX2) — « the sampler's activation wall is
# linear in T_latent * pixel area » : pic ≈ RESERVED + K·SIGMA + 0,55 Gio par
# mégapixel et par image latente ; une image latente = 4 images vidéo (4n+1).
# Calibrée sur 3B fp16 et une RTX 5090 : un ordre de grandeur.
LAW = {"per_mpx_frame": 0.55, "reserved": 8.5, "sigma": 0.55, "k": 4}


# ── les tailles ─────────────────────────────────────────────
def _even(x: float) -> int:
    """Côtés pairs : le H.264 en yuv420p les veut, et SeedVR2 accepte
    « any resolution divisible by 2 » (README du nœud numz)."""
    return max(2, int(round(x / 2.0)) * 2)


def out_size(model: str, kind: str, w: int, h: int, mode: str, factor: int, target: str) -> tuple[int, int, str]:
    """La taille qui sortira, et son étiquette."""
    if MODELS[model].get("fixed"):
        # ImageScaleToTotalPixels (1 Mpx, pas de 1) puis RealESRGAN ×2
        s = math.sqrt(1024 * 1024 / (w * h))
        return 2 * round(w * s), 2 * round(h * s), "affinée"
    if mode == "factor":
        return _even(w * factor), _even(h * factor), f"×{factor}"
    t = TARGETS[kind][target]
    if "long" in t:
        k = t["long"] / max(w, h)
    else:
        k = t["short"] / min(w, h)
        if max(w, h) * k > t["max"]:
            k = t["max"] / max(w, h)
    return _even(w * k), _even(h * k), t["label"]


def frames_of(it: dict) -> int:
    if it.get("kind") != "video":
        return 1
    d, fps = it.get("duration") or 0, it.get("fps") or 0
    return max(1, int(round(d * fps))) if d and fps else 0


# ── mémoire et temps, avant l'envoi ─────────────────────────
_free: dict = {"t": 0.0, "gib": None, "machine": ""}
_free_lock = threading.Lock()


def free_memory() -> tuple[float | None, str]:
    """La mémoire libre la plus grande parmi les ComfyUI de la voie image
    (/system_stats, lecture seule) ; None si aucun ne répond."""
    with _free_lock:
        if time.time() - _free["t"] < 30:
            return _free["gib"], _free["machine"]
    best, who = None, ""
    for ep in [e for e in config.get("lanes", {}).get("image", []) if e != "local"]:
        ok, _ = jobs.endpoint_alive(ep)
        if not ok:
            continue
        try:
            st = Comfy(ep, timeout=4).ping()
        except ComfyError:
            continue
        devs = st.get("devices") or []
        free = (devs[0].get("vram_free") if devs else None) or (st.get("system") or {}).get("ram_free")
        if free and (best is None or free / GIB > best):
            best, who = free / GIB, jobs.machine_of(ep)
    with _free_lock:
        _free.update(t=time.time(), gib=best, machine=who)
    return best, who


def mem_estimate(model: str, w: int, h: int, frames: int, free_gib: float | None) -> dict:
    """Le pic de mémoire attendu. SeedVR2 : la loi de ComfyUI (LAW) et son
    découpage automatique en morceaux ; les autres : leurs poids seuls."""
    if not model.startswith("seedvr2"):
        return {"gb": round(MODELS[model]["weights_gb"], 1), "floor": True,
                "how": "poids chargés ; le reste n'est pas documenté"}
    mpx = (math.ceil(w / 16) * 16) * (math.ceil(h / 16) * 16) / 1e6     # SeedVR2Preprocess : pas de 16
    t = 1 if frames <= 1 else 5 if frames <= 4 else frames + (4 - (frames - 1) % 4) % 4   # cut_videos : 4n+1
    lat = (t - 1) // 4 + 1
    base = LAW["reserved"] + LAW["k"] * LAW["sigma"]
    per = LAW["per_mpx_frame"] * mpx
    chunk, chunks = lat, 1
    if free_gib and lat > 1:
        cap = max(1, int((free_gib - base) / per))
        if cap < lat:
            chunk, chunks = cap, math.ceil(lat / cap)
    peak = (base + per * chunk) * GIB / 1e9
    return {"gb": round(peak, 1), "chunks": chunks, "latent_frames": lat,
            "how": "loi de ComfyUI (seedvr/constants.py) : 8,5 Gio + 0,55 Gio par Mpx et image latente"}


_rates: dict = {"t": 0.0, "v": {}}


def rates() -> dict:
    """Les secondes par mégapixel·image mesurées sur les rendus passés,
    par (modèle, sorte) : la seule estimation de temps honnête — aucune
    source ne donne un temps pour nos machines (étude §5)."""
    if time.time() - _rates["t"] < 20:
        return _rates["v"]
    acc: dict = {}
    for it in library.query(["image", "video"], tool="upscale", limit=100000)["items"]:
        sec, up = it.get("render_s"), it.get("upscale") or {}
        to = up.get("to") or [it.get("width"), it.get("height")]
        n = up.get("frames") or 1
        if not sec or not to or not to[0]:
            continue
        key = f"{(it.get('origin') or {}).get('model', '')}|{it['kind']}"
        acc.setdefault(key, []).append(sec / max(1e-6, to[0] * to[1] * n / 1e6))
    _rates.update(t=time.time(), v={k: v[-12:] for k, v in acc.items()})
    return _rates["v"]


def model_id(model: str) -> str:
    return model + ("-factice" if backend() == "stub" else "")


def time_estimate(model: str, kind: str, w: int, h: int, frames: int) -> dict:
    got = rates().get(f"{model_id(model)}|{kind}") or []
    if not got:
        return {"s": None, "how": "non mesuré : le premier rendu donnera la mesure"}
    s = statistics.median(got) * w * h * frames / 1e6
    n = len(got)
    return {"s": round(s, 1), "how": f"d'après {n} rendu{'s' if n > 1 else ''}"
                                     f"{' factice' + ('s' if n > 1 else '') if backend() == 'stub' else ''}, "
                                     "proportionnel aux pixels × images"}


# ── la validation ───────────────────────────────────────────
def _short(t: str, n: int = 42) -> str:
    return t if len(t) <= n else t[:n - 2].rstrip() + "…"


def check(d: dict) -> tuple[dict, list[dict]]:
    """Les réglages communs, et une rangée par fichier : ce qui sortira, ou
    pourquoi il ne sera pas traité."""
    preset = d.get("preset") or "custom"
    if preset != "custom" and preset not in PRESETS:
        raise ValueError(f"préréglage inconnu : {preset} ({', '.join(PRESETS)}, custom)")
    model = d.get("model") if preset == "custom" else None
    m: dict = {}
    if preset == "custom":
        if model not in MODELS:
            raise ValueError(f"modèle inconnu : {model} ({', '.join(RETAINED)})")
        m = MODELS[model]
        if m.get("off"):
            raise ValueError(f"{m['name']} : {m['off']}")
    mode = "fixed" if m.get("fixed") else (d.get("mode") or "factor")
    if mode not in ("factor", "target", "fixed"):
        raise ValueError("taille : un facteur ou une cible")
    try:
        factor = int(d.get("factor", 2))
    except (TypeError, ValueError) as e:
        raise ValueError("facteur : 2 ou 4") from e
    if factor not in (2, 4):
        raise ValueError("facteur : 2 ou 4")
    if mode == "factor" and m.get("max_factor") and factor > m["max_factor"]:
        raise ValueError(f"{m['name']} fait ×2 au plus : le ×4 demande RealESRGAN_x4plus (67 Mo, à télécharger — étude §7)")
    touched = d.get("touched") or []
    touched = [k for k in ADVANCED if preset == "custom" and isinstance(touched, list) and k in touched]
    # le préréglage d'où part un réglage personnalisé (« Précis, modifié ») : de quoi le dire
    base = d.get("base") if preset == "custom" and d.get("base") in PRESETS else None
    ti, tv = d.get("target_image") or "4k", d.get("target_video") or "1080p"
    if ti not in TARGETS["image"] or tv not in TARGETS["video"]:
        raise ValueError("cible inconnue")
    color = d.get("color") or "lab"
    if color not in [c["id"] for c in COLORS]:
        raise ValueError(f"couleur inconnue : {color}")
    try:
        den = float(d.get("denoise", 0.25))
    except (TypeError, ValueError) as e:
        raise ValueError("débruitage : un nombre") from e
    if not 0.1 <= den <= 0.5:
        raise ValueError("débruitage : entre 0,10 et 0,50 (le gabarit conseille 0,15–0,35)")
    ids = d.get("items") or ([d["item"]] if d.get("item") else [])
    if not isinstance(ids, list) or not ids:
        raise ValueError("aucun fichier : choisissez une image ou une vidéo")
    if len(ids) > MAX_ITEMS:
        raise ValueError(f"{MAX_ITEMS} fichiers au plus par envoi")
    common = {"preset": preset, "base": base, "touched": touched, "model": model, "mode": mode, "factor": factor,
              "target_image": ti, "target_video": tv,
              "color": color, "denoise": round(den, 2), "prompt": str(d.get("prompt") or "").strip()[:6000]}
    free, machine = free_memory()
    rows = []
    for iid in ids:
        it = library.get(str(iid))
        if not it:
            raise ValueError(f"introuvable dans la bibliothèque : {iid}")
        rows.append(plan_row(it, common, free, machine))
    return common, rows


def plan_row(it: dict, c: dict, free: float | None = None, machine: str = "") -> dict:
    kind = it["kind"]
    row = {"item": it["id"], "kind": kind, "title": it.get("title") or it["id"], "ok": False,
           "in": [it.get("width"), it.get("height")]}
    if kind not in ("image", "video"):
        row["why"] = "ni une image ni une vidéo : un élément s'ouvre dans Asset, ses images s'agrandissent une à une"
        return row
    try:
        s = settings_for(c, kind)
    except ValueError as e:
        row["why"] = str(e)
        return row
    model = s["model"]
    m = MODELS[model]
    mode = "fixed" if m.get("fixed") else c["mode"]
    # ce qui partira vraiment : le préréglage rejoué, ou les avancés
    row.update(model=model, mode=mode, set={k: s[k] for k in ADVANCED})
    w, h = it.get("width") or 0, it.get("height") or 0
    if not w or not h:
        row["why"] = "taille inconnue : le fichier ne se lit pas"
        return row
    frames = frames_of(it)
    if kind == "video" and not frames:
        row["why"] = "durée ou cadence inconnue : la vidéo ne se lit pas"
        return row
    W, H, label = out_size(model, kind, w, h, mode, c["factor"],
                           c["target_image"] if kind == "image" else c["target_video"])
    f = max(W / w, H / h)
    row.update(out=[W, H], label=label, frames=frames, fps=it.get("fps"), duration=it.get("duration"),
               factor=round(f, 2))
    if W <= w and H <= h:
        row["why"] = f"rien à agrandir : la source fait déjà {w}×{h}"
    elif not m.get("fixed") and f > MAX_FACTOR + 1e-6:
        # Affiner passe par ImageScaleToTotalPixels (1 Mpx) : la borne ne le concerne pas
        row["why"] = f"×{f:.1f} : au-delà de ×8, le nœud de redimensionnement des gabarits SeedVR2 refuse (max 8,0)"
    elif m.get("max_factor") and f > m["max_factor"] + 0.01:
        row["why"] = f"{s['who']} fait ×2 au plus (ici ×{f:.1f})" + (
            " : RealESRGAN_x4plus à télécharger (67 Mo)" if c["preset"] == "custom" else "")
    elif kind == "image" and max(W, H) > MAX_IMAGE:
        row["why"] = f"trop grand : {W}×{H} dépasse {MAX_IMAGE} px (la limite de l'outil Image)"
    elif kind == "video" and (min(W, H) > MAX_VIDEO[0] or max(W, H) > MAX_VIDEO[1]):
        row["why"] = f"{W}×{H} dépasse la 4K UHD (petit côté 2160, grand côté 4096)"
    else:
        row["ok"] = True
    row["mem"] = mem_estimate(model, W, H, frames, free)
    if machine and row["mem"].get("chunks", 1) > 1:
        row["mem"]["how"] += f" ; {row['mem']['chunks']} morceaux d'après la mémoire libre de {machine}"
    row["est"] = time_estimate(model, kind, W, H, frames)
    return row


# ── les graphes (le câblage réel) ───────────────────────────
def _load(name: str) -> dict:
    wf = json.loads((WORKFLOWS / name).read_text(encoding="utf-8"))
    return {k: v for k, v in wf.items() if not k.startswith("_")}


def _unet(model: str) -> str:
    cf = img._cf()
    if model == "seedvr2-7b":
        return cf.config.setting("seedvr2_unet", cf.upscale.SEEDVR2_UNET)
    return SEEDVR2_3B


def graph_image(model: str, name: str, p: dict, size: tuple[int, int] = (1024, 1024), prompt: str = "") -> dict:
    """Le graphe d'une image, l'entrée déjà déposée (`name`). SeedVR2 reçoit
    l'image déjà agrandie en Lanczos (gabarit officiel, factory/upscale.py)."""
    cf = img._cf()
    if model.startswith("seedvr2"):
        wf = cf.upscale.seedvr2_workflow(name, p["seed"] % (2 ** 32), unet=_unet(model))
        post = next(k for k, n in wf.items() if n["class_type"] == "SeedVR2PostProcessing")
        wf[post]["inputs"]["color_correction_method"] = p["color"]
        return wf
    if model == "esrgan-x2":
        return cf.upscale.esrgan_workflow(name)
    if model == "zimage-refine":
        return img.edit_graph({"tool": "refine", "seed": p["seed"], "denoise": p["denoise"]}, size, [name], prompt)
    raise ValueError(model)


def graph_video(model: str, name: str, p: dict) -> dict:
    """Le graphe d'une vidéo, déposée sous `name` (LoadVideo)."""
    cf = img._cf()
    common = {"video": name, "width": p["width"], "height": p["height"], "prefix": "showrunner/upscale"}
    if model.startswith("seedvr2"):
        return fill(_load("upscale_seedvr2_video.json"), {
            **common, "unet": _unet(model), "vae": cf.config.setting("seedvr2_vae", cf.upscale.SEEDVR2_VAE),
            "seed": p["seed"] % (2 ** 32), "color": p["color"]})
    if model == "esrgan-x2":
        return fill(_load("upscale_esrgan_video.json"), {**common, "model": cf.config.setting("esrgan", cf.upscale.ESRGAN)})
    raise ValueError(f"{MODELS[model]['name']} n'agrandit pas les vidéos")


def _caption(src: dict) -> str:
    """« Une description détaillée » (note du gabarit Z-Image) : le prompt
    d'une image créée par l'outil Image en est une (même règle que lui)."""
    return src.get("prompt") if (src.get("params") or {}).get("job") == "image.generate" else ""


# ── ce que chaque machine sait faire (lecture seule) ─────────
_avail: dict[str, tuple[float, dict]] = {}
_avail_lock = threading.Lock()


def _probe_graphs() -> dict[str, dict[str, dict]]:
    """Les graphes de chaque modèle retenu, par sorte, avec des noms
    d'entrée factices : ceux que l'on juge contre /object_info."""
    p = {"seed": 1, "color": "lab", "denoise": 0.25, "width": 1920, "height": 1080}
    out: dict = {}
    for mid in RETAINED:
        for kind in MODELS[mid]["kinds"]:
            g = graph_image(mid, "src.png", p) if kind == "image" else graph_video(mid, "{{video}}", p)
            out.setdefault(mid, {})[kind] = g
    return out


def _endpoint_check(url: str) -> dict:
    graphs = _probe_graphs()
    classes = sorted({n["class_type"] for per in graphs.values() for g in per.values() for n in g.values()})
    info: dict = {}
    c = Comfy(url, timeout=20)
    for n in classes:
        # une erreur (délai dépassé pendant un rendu, connexion coupée) n'est pas un
        # nœud absent : elle remonte, la machine est « injoignable » (comme l'outil Image)
        info.update(c.object_info(n))
    validate = img._cf().comfy.validate
    return {mid: {kind: validate(g, info) for kind, g in per.items()} for mid, per in graphs.items()}


def availability(max_age: float = 120.0) -> dict:
    """{modèle: {sorte: {"on": [url…], "missing": {machine: [problèmes]}}}} :
    chaque graphe retenu jugé contre le catalogue de nœuds de chaque ComfyUI
    de la voie image (validate de Character Factory) — rien n'est chargé ni
    mis en file."""
    eps = [e for e in config.get("lanes", {}).get("image", []) if e != "local"]
    out: dict = {}
    for ep in eps:
        with _avail_lock:
            t, got = _avail.get(ep, (0.0, None))
        age = max_age if got and "_down" not in got and "_error" not in got else min(max_age, img.DOWN_RETRY_S)
        if got is None or time.time() - t > age:
            ok, why = jobs.endpoint_alive(ep)
            if ok:
                try:
                    got = _endpoint_check(ep)
                except Exception as e:  # une machine qui répond mal ne casse pas la page
                    got = {"_error": str(e)}
            else:
                got = {"_down": why}
            with _avail_lock:
                _avail[ep] = (time.time(), got)
        machine = jobs.machine_of(ep)
        for mid in RETAINED:
            for kind in MODELS[mid]["kinds"]:
                a = out.setdefault(mid, {}).setdefault(kind, {"on": [], "missing": {}, "down": []})
                if "_down" in got:
                    a["missing"][machine] = ["ne répond pas"]
                    a["down"].append(ep)
                elif "_error" in got:
                    a["missing"][machine] = [f"ne répond pas bien ({got['_error'][:160]})"]
                    a["down"].append(ep)
                elif got.get(mid, {}).get(kind):
                    a["missing"][machine] = got[mid][kind]
                else:
                    a["on"].append(ep)
    return out


def _pin_for(model: str, kind: str) -> str | None:
    """L'instance où épingler un travail dont le graphe ne passe que sur une
    machine ; aucune : refus, avec la raison. En factice, rien."""
    if backend() == "stub":
        return None
    eps = [e for e in config.get("lanes", {}).get("image", []) if e != "local"]
    try:
        a = availability().get(model, {}).get(kind)
    except Exception:
        return None
    if not a or not eps:
        return None
    if not a["on"]:
        miss = "; ".join(f"{mm} : {', '.join(v)}" for mm, v in a["missing"].items())
        raise HttpError(409, f"aucune machine ne peut le faire ({miss})")
    # n'écarter que la machine à qui il manque quelque chose, pas celle qui ne répond
    # pas à l'instant (la file ne lui donne rien tant qu'elle ne répond pas)
    able = [e for e in eps if e in a["on"] or e in a.get("down", [])]
    return None if len(able) == len(eps) else a["on"][0]


# ── le moteur factice ───────────────────────────────────────
def _has_alpha(im) -> bool:
    return im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)


def _stamp(im, text: str):
    """« FACTICE · … » en bas à droite — là où le rideau montre l'agrandie ;
    le reste de l'image reste comparable."""
    from PIL import ImageDraw
    T = img.tokens()
    d = ImageDraw.Draw(im)
    s = min(im.size)
    fs = max(12, s // 48)
    f = img._font(fs)
    pad = max(6, s // 90)
    w = int(d.textlength(text, font=f))
    x0 = max(0, im.width - max(8, s // 60) - w - 2 * pad)
    y0 = max(0, im.height - max(8, s // 60) - fs - 2 * pad)
    d.rectangle([x0, y0, x0 + w + 2 * pad, y0 + fs + 2 * pad], fill=T["panel"] + ((255,) if im.mode == "RGBA" else ()))
    d.text((x0 + pad, y0 + pad), text, font=f, fill=T["or"])
    return im


def stub_image(ctx, p: dict, src_path: Path, out: Path) -> Path:
    from PIL import Image, ImageFilter
    m = MODELS[p["model"]]
    img._stub_wait(ctx, m["name"], 1.2)
    with Image.open(src_path) as im:
        alpha = _has_alpha(im)
        im = im.convert("RGBA" if alpha else "RGB")
        big = im.resize((p["width"], p["height"]), Image.BICUBIC)
    if p["model"] == "zimage-refine" and not alpha:
        big = big.filter(ImageFilter.UnsharpMask(2, 80, 2))
    _stamp(big, f"FACTICE · {m['name']} : ici un bicubique")
    big.save(out)
    return out


def _ff_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def stub_video(ctx, p: dict, src_path: Path, out: Path, duration: float) -> Path:
    """ffmpeg : bicubique à la taille prévue, « FACTICE » incrusté, le son
    gardé (AAC) ; la progression lue sur -progress."""
    T = img.tokens()
    hx = lambda rgb: "0x%02x%02x%02x" % rgb  # noqa: E731
    W, H = p["width"], p["height"]
    label = ctx.workdir / "label.txt"
    label.write_text(f"FACTICE · {MODELS[p['model']]['name']} : ici un bicubique", encoding="utf-8")
    font = REPO / "commun" / "fonts" / "azeret-mono.ttf"
    fs = max(14, min(W, H) // 40)
    vf = (f"scale={W}:{H}:flags=bicubic,drawtext=fontfile='{_ff_escape(str(font))}':textfile='{_ff_escape(str(label))}'"
          f":x=w-tw-{fs}:y=h-th-{fs}:fontsize={fs}:fontcolor={hx(T['or'])}:box=1:boxcolor={hx(T['panel'])}@0.85:boxborderw={fs // 2}")
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src_path), "-map", "0:v:0", "-map", "0:a?", "-vf", vf,
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(out)]
    err = ctx.workdir / "ffmpeg.log"
    with open(err, "wb") as ef:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=ef, text=True)
        try:
            for line in proc.stdout:
                if ctx.cancelled():
                    proc.kill()
                    raise Cancelled("arrêté")
                k, _, v = line.strip().partition("=")
                if k == "out_time_us" and v.isdigit() and duration:
                    frac = min(1.0, int(v) / 1e6 / duration)
                    ctx.progress(0.05 + 0.9 * frac, f"bicubique {int(frac * 100)} % (factice)")
            proc.wait()
        finally:
            if proc.poll() is None:
                proc.kill()
    if proc.returncode != 0 or not out.exists():
        raise RuntimeError("ffmpeg a échoué : " + err.read_text(encoding="utf-8", errors="replace")[-600:])
    return out


# ── les travaux ─────────────────────────────────────────────
def _source(p: dict) -> tuple[dict, Path]:
    src = library.get(p["source"])
    if not src:
        raise RuntimeError("la source a quitté la bibliothèque")
    return src, library.path_of(src)


def _finish(ctx, out: Path, src: dict, p: dict, kind: str, t0: float) -> dict:
    ctx.progress(0.97, "range dans la bibliothèque")
    secs = round(time.time() - t0, 1)
    m = MODELS[p["model"]]
    title = f"{_short(src.get('title') or src['id'])} · {p['label']}"
    it = ctx.add(out, kind=kind, title=title, prompt=p.get("prompt_sent", ""),
                 params={"job": f"upscale.{kind}", **{k: v for k, v in p.items() if k != "prompt_sent"}},
                 parents=[src["id"]], origin={"model": model_id(p["model"]), "backend": backend()},
                 extra={"render_s": secs, "upscale": {"from": [src.get("width"), src.get("height")],
                                                      "to": [p["width"], p["height"]], "frames": p.get("frames", 1)}})
    _rates["t"] = 0.0
    return {"note": f"{m['name']} · {p['label']} · {secs} s", "seconds": secs, "item": it["id"]}


def run_image(ctx) -> dict:
    from PIL import Image
    p = dict(ctx.params)
    t0 = time.time()
    src, src_path = _source(p)
    out = ctx.workdir / "up.png"
    if backend() == "stub":
        ctx.progress(0.02, "prépare")
        stub_image(ctx, p, src_path, out)
        return _finish(ctx, out, src, p, "image", t0)
    W, H = p["width"], p["height"]
    with Image.open(src_path) as im:
        alpha = im.convert("RGBA").split()[-1] if _has_alpha(im) else None
        w0, h0 = im.size
    local = ctx.workdir / "src.png"
    img._rgb(src_path, local)
    if p["model"].startswith("seedvr2"):
        # SeedVR2 restaure une image déjà à la taille voulue : Lanczos d'abord
        with Image.open(local) as im:
            im.resize((W, H), Image.LANCZOS).save(local)
    prompt = ""
    if p["model"] == "zimage-refine":
        prompt = p.get("prompt") or _caption(src) or ""
        p["prompt_sent"] = prompt
    name = ctx.comfy.upload(local, f"sr_upscale_{ctx.job['id']}.png")
    ctx.progress(0.05, f"{MODELS[p['model']]['name']} : {w0}×{h0} → {W}×{H}")
    # la vraie progression (websocket de ComfyUI) et une erreur lisible : le même rendu que l'outil Image
    res = img.live_run(ctx, graph_image(p["model"], name, p, (w0, h0), prompt), prefix="up",
                       label=MODELS[p["model"]]["name"], lo=0.05, hi=0.95)[0]
    with Image.open(res) as r:
        r = r.convert("RGB")
        if r.size != (W, H):
            r = r.resize((W, H), Image.LANCZOS)   # comme factory/upscale.py : la taille prévue, par construction
        if alpha is not None:
            r.putalpha(alpha.resize((W, H), Image.LANCZOS))
        r.save(out)
    return _finish(ctx, out, src, p, "image", t0)


def run_video(ctx) -> dict:
    p = dict(ctx.params)
    t0 = time.time()
    src, src_path = _source(p)
    out = ctx.workdir / "up.mp4"
    if backend() == "stub":
        ctx.progress(0.02, "prépare")
        stub_video(ctx, p, src_path, out, float(src.get("duration") or 0))
        return _finish(ctx, out, src, p, "video", t0)
    name = ctx.comfy.upload(src_path, f"sr_upscale_{ctx.job['id']}{src_path.suffix.lower()}")
    wf = graph_video(p["model"], name, p)
    ctx.progress(0.05, f"{MODELS[p['model']]['name']} : {p['frames']} images → {p['width']}×{p['height']}")
    # la vraie progression (websocket de ComfyUI) et une erreur lisible, comme pour une image ;
    # une vidéo 4K peut être longue : 4 h avant d'abandonner (garde-fou, pas une mesure)
    res = img.live_run(ctx, wf, prefix="up", label=MODELS[p["model"]]["name"], lo=0.05, hi=0.95, timeout=4 * 3600)[0]
    return _finish(ctx, res, src, p, "video", t0)


# ── les routes ──────────────────────────────────────────────
def api_models(req) -> dict:
    try:
        av = availability()
        av_err = ""
    except Exception as e:
        av, av_err = {}, str(e)
    cf_ok = img.cf_available()
    models = []
    for mid, m in MODELS.items():
        e = {"id": mid, **{k: v for k, v in m.items() if k not in ("weights_gb",)}, "kinds": list(m["kinds"]),
             "retained": mid in RETAINED}
        if mid in RETAINED and not cf_ok and backend() == "comfyui":
            e["off"] = "Character Factory introuvable (réglage cf_repo) : ses graphes SeedVR2 et RealESRGAN manquent"
        e["availability"] = {k: {"on": [jobs.machine_of(u) for u in v["on"]], "missing": v["missing"]}
                             for k, v in av.get(mid, {}).items()}
        models.append(e)
    free, machine = free_memory()
    presets = [{"id": k, **{kk: vv for kk, vv in v.items() if kk not in ("image", "video")},
                "image": v.get("image") and {**DEFAULT_SET, **v["image"]},
                "video": v.get("video") and {**DEFAULT_SET, **v["video"]}} for k, v in PRESETS.items()]
    return {"backend": backend(), "models": models, "default": DEFAULT, "presets": presets,
            "default_set": DEFAULT_SET, "advanced": list(ADVANCED),
            "targets": {k: [{"id": i, **{kk: vv for kk, vv in t.items() if kk in ("label", "sub")}} for i, t in v.items()]
                        for k, v in TARGETS.items()},
            "colors": COLORS, "denoise": {"min": 0.10, "max": 0.50, "default": 0.25, "advice": [0.15, 0.35]},
            "max_items": MAX_ITEMS, "free_gb": round(free * GIB / 1e9, 1) if free else None, "free_machine": machine,
            "availability_error": av_err, "cf": cf_ok}


def api_plan(req) -> dict:
    try:
        common, rows = check(req.json())
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    ok = [r for r in rows if r["ok"]]
    known = [r["est"]["s"] for r in ok if r.get("est", {}).get("s") is not None]
    return {"backend": backend(), "params": common, "rows": rows, "count": len(ok),
            "total_s": round(sum(known), 1) if known and len(known) == len(ok) else None}


def api_run(req) -> dict:
    d = req.json()
    try:
        common, rows = check(d)
        seed = d.get("seed")
        seed = random.randrange(2 ** 32) if seed in (None, "") else int(seed) % (2 ** 32)
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    ok = [r for r in rows if r["ok"]]
    skipped = [{"item": r["item"], "title": r["title"], "why": r.get("why", "")} for r in rows if not r["ok"]]
    if not ok:
        raise HttpError(400, "rien à agrandir : " + "; ".join(f"{s['title']} — {s['why']}" for s in skipped))
    # chaque rangée porte ses réglages résolus (le préréglage rejoué pour sa sorte)
    params = lambda r, **kw: {**common, **r["set"], "model": r["model"], "mode": r["mode"], **kw}  # noqa: E731
    if d.get("dry"):
        out = {"backend": backend(), "rows": rows, "graphs": {}}
        if img.cf_available():
            for r in ok:
                p = params(r, seed=seed, width=r["out"][0], height=r["out"][1])
                src = library.get(r["item"])
                out["graphs"][r["item"]] = (graph_image(r["model"], "src.png", p, tuple(r["in"]),
                                                        p["prompt"] or _caption(src) or "")
                                            if r["kind"] == "image" else graph_video(r["model"], "src.mp4", p))
        return out
    submitted = []
    for k, r in enumerate(ok):
        pin = _pin_for(r["model"], r["kind"])
        src = library.get(r["item"])
        p = params(r, source=r["item"], seed=(seed + k) % (2 ** 32), width=r["out"][0], height=r["out"][1],
                   label=r["label"], frames=r.get("frames", 1))
        who = PRESETS[common["preset"]]["label"] if common["preset"] != "custom" else MODELS[r["model"]]["name"]
        j = jobs.submit(f"upscale.{r['kind']}", p, title=f"{who} · {_short(r['title'], 36)} · {r['label']}",
                        tool="upscale", pin=pin, thumb=library.public(src).get("thumb_url"))
        submitted.append({**jobs.public(j), "source": r["item"]})
    return {"jobs": submitted, "skipped": skipped}


def api_pile(req, item_id) -> dict:
    """La pile d'un média (Cal, 29/09 : « une pile par image comme notre banc
    de comparaison ») : la source, puis ses essais — les agrandies de cet
    outil dont elle est le parent, de la plus ancienne à la plus récente.
    Un essai retiré est à la corbeille : il n'y est plus."""
    src = library.get(item_id)
    if not src:
        raise HttpError(404, "introuvable dans la bibliothèque")
    got = library.query(["image", "video"], tool="upscale", sort="old", limit=100000)["items"]
    return {"source": library.public(src), "trials": [it for it in got if item_id in (it.get("parents") or [])]}


# La famille de chaque modèle pour la file (core/jobs.py : la famille déjà
# chargée d'abord, /free quand on en change) : Affiner charge les poids de
# Z-Image Turbo, la famille « zimage » de FAMILY_GB (Character_Factory/
# factory/memory.py) ; SeedVR2 et RealESRGAN n'y sont pas. La mémoire d'une
# image SeedVR2 : la loi de ComfyUI (mem_estimate) ; les autres : la famille,
# sinon le seuil par défaut de la file (`min_free_gb`) — rien d'inventé.
FAMILY = {"seedvr2-7b": "seedvr2-7b", "seedvr2-3b": "seedvr2-3b", "esrgan-x2": "esrgan", "zimage-refine": "zimage"}


def family_of(p: dict) -> str:
    return FAMILY.get(p.get("model") or "", "?")


def mem_image(p: dict) -> float | None:
    m = p.get("model") or ""
    if m.startswith("seedvr2") and p.get("width") and p.get("height"):
        return mem_estimate(m, int(p["width"]), int(p["height"]), 1, None)["gb"]
    return None


def mem_video(p: dict) -> float | None:
    """Une vidéo SeedVR2 : ce qu'il faut pour partir, un morceau d'une image
    latente (la loi de ComfyUI) — SeedVR2TemporalChunk en mode « auto »
    découpe ensuite à la mémoire libre (« predict the largest chunk that fits
    free VRAM », gabarit officiel). Relevé le 30/09 sur DGX2 : 1728 × 960,
    124 images, pic de 27 Gio sur le GPU. Les autres : la famille."""
    return mem_image(p)


config.declare_switch("upscale_backend", ["stub", "comfyui"], label="Upscale · moteur", default="stub",
                      doc="server/tools/upscale.py, backend() : stub (bicubique factice, voie cpu) ou comfyui "
                          "(SeedVR2 7B/3B, RealESRGAN ×2, Z-Image Affiner sur la voie image)")


def register(app) -> None:
    lane = "image" if backend() == "comfyui" else "cpu"
    jobs.register("upscale.image", run_image, lane=lane, title="Agrandir une image", family=family_of, mem_gb=mem_image)
    jobs.register("upscale.video", run_video, lane=lane, title="Agrandir une vidéo", family=family_of, mem_gb=mem_video)
    app.route("GET", "/api/upscale/models", api_models)
    app.route("POST", "/api/upscale/plan", api_plan)
    app.route("POST", "/api/upscale/run", api_run)
    app.route("GET", "/api/upscale/pile/{item_id}", api_pile)


# ── le contrôle sans GPU ────────────────────────────────────
def selftest(call, ok) -> None:
    import shutil as _sh
    import tempfile
    from io import BytesIO
    from PIL import Image

    st, m = call("GET", "/api/upscale/models")
    ids = [x["id"] for x in m.get("models", [])]
    ok(st == 200 and all(r in ids for r in RETAINED), f"upscale : les modèles retenus ({st} {ids})")
    ok(all(x.get("src") for x in m.get("models", [])), "upscale : chaque modèle dit sa source")
    ok(all(x.get("off") for x in m.get("models", []) if not x.get("retained")), "upscale : un modèle absent dit pourquoi")
    ok(m.get("backend") == "stub", "upscale : factice par défaut")

    buf = BytesIO()
    Image.new("RGB", (96, 64), (120, 110, 90)).save(buf, "PNG")
    st, up = call("PUT", "/api/library/upload?name=petit.png&title=Petit&tool=upload", raw=buf.getvalue())
    iid = up.get("id")
    ab = BytesIO()
    Image.new("RGBA", (40, 30), (200, 10, 10, 128)).save(ab, "PNG")
    st, upa = call("PUT", "/api/library/upload?name=alpha.png&title=Alpha&tool=upload", raw=ab.getvalue())
    aid = upa.get("id")

    def plan(**kw):
        return call("POST", "/api/upscale/plan", {"items": [iid], "model": "seedvr2-7b", **kw})

    st, r = plan(factor=2)
    ok(st == 200 and r["rows"][0]["out"] == [192, 128] and r["rows"][0]["ok"], f"upscale : ×2 = 192×128 ({st} {r})")
    st, r = plan(factor=4)
    ok(st == 200 and r["rows"][0]["out"] == [384, 256], "upscale : ×4 = 384×256")
    st, r = plan(mode="target", target_image="2k")
    row = r["rows"][0] if st == 200 else {}
    ok(row.get("ok") is False and "×8" in row.get("why", ""), f"upscale : 96 px → 2K (×21) refusé, au-delà de ×8 ({row})")
    gb = BytesIO()
    Image.new("RGB", (1024, 683), (90, 110, 120)).save(gb, "PNG")
    st, upg = call("PUT", "/api/library/upload?name=grand.png&title=Grand&tool=upload", raw=gb.getvalue())
    st, r = call("POST", "/api/upscale/plan", {"items": [upg.get("id")], "model": "seedvr2-7b", "mode": "target", "target_image": "4k"})
    row = r["rows"][0] if st == 200 else {}
    ok(row.get("ok") and max(row["out"]) == 4096 and all(v % 2 == 0 for v in row["out"]), f"upscale : cible 4K = grand côté 4096, côtés pairs ({row})")
    # 4096×2732 → 4096×2736 au pas de 16 : 11,2 Mpx × 0,55 + 8,5 + 2,2 Gio
    want = round((8.5 + 2.2 + 0.55 * 4096 * 2736 / 1e6) * GIB / 1e9, 1)
    ok(row.get("mem", {}).get("gb") == want, f"upscale : mémoire SeedVR2 par la loi de ComfyUI ({row.get('mem')} ≠ {want})")
    ok(out_size("seedvr2-3b", "video", 1792, 768, "target", 2, "1080p")[:2] == (1920, 822)
       and out_size("seedvr2-3b", "video", 1792, 768, "target", 2, "4k")[:2] == (3840, 1646)
       and out_size("seedvr2-3b", "video", 768, 1344, "target", 2, "1080p")[:2] == (1080, 1890),
       "upscale : une vidéo H3 tient dans le cadre 1080p / 4K UHD, large ou verticale")
    st, r = call("POST", "/api/upscale/plan", {"items": [iid], "model": "zimage-refine"})
    s = math.sqrt(1024 * 1024 / (96 * 64))
    ok(st == 200 and r["rows"][0]["out"] == [2 * round(96 * s), 2 * round(64 * s)], f"upscale : Affiner = 1 Mpx ×2 ({r})")
    bad = [({"items": [iid], "model": "n-existe-pas"}, "modèle inconnu"),
           ({"items": [iid], "model": "aurasr-v2"}, "modèle éteint, avec sa raison"),
           ({"items": [], "model": "seedvr2-3b"}, "aucun fichier"),
           ({"items": ["ima-rien"], "model": "seedvr2-3b"}, "fichier introuvable"),
           ({"items": [iid], "model": "seedvr2-3b", "factor": 3}, "facteur 3"),
           ({"items": [iid], "model": "esrgan-x2", "factor": 4}, "RealESRGAN ×4"),
           ({"items": [iid], "model": "zimage-refine", "denoise": 0.9}, "débruitage hors plage")]
    for body, msg in bad:
        st, r = call("POST", "/api/upscale/plan", body)
        ok(st == 400 and r.get("error"), f"upscale : refusé — {msg} ({st} {r})")
    st, r = call("POST", "/api/upscale/plan", {"items": [iid], "model": "esrgan-x2", "factor": 4})
    ok("x4plus" in (r or {}).get("error", ""), "upscale : le ×4 GAN dit quoi télécharger")

    # les préréglages : la seule table, rejouée par le serveur quoi que la page envoie à côté
    pr = {p["id"]: p for p in m.get("presets", [])}
    ok(set(pr) == set(PRESETS) and all(p.get("src") and p.get("label") for p in pr.values()),
       f"upscale : les préréglages, chacun avec sa source ({list(pr)})")
    ok(all(v and v["model"] in RETAINED for p in pr.values() for v in (p["image"], p["video"]) if v),
       "upscale : un préréglage ne mène qu'à un modèle retenu")
    st, r = call("POST", "/api/upscale/plan", {"items": [iid], "preset": "precis", "model": "esrgan-x2", "factor": 2})
    row = r["rows"][0] if st == 200 else {}
    ok(row.get("ok") and row.get("model") == "seedvr2-7b" and row["set"]["color"] == "lab",
       f"upscale : « précis » sur une image = SeedVR2 7B, lab — le modèle envoyé à côté ignoré ({row})")
    st, r = call("POST", "/api/upscale/plan", {"items": [iid], "preset": "creatif"})
    row = r["rows"][0] if st == 200 else {}
    ok(row.get("ok") and row.get("model") == "zimage-refine" and row["set"]["denoise"] == 0.25 and row.get("mode") == "fixed",
       f"upscale : « créatif » sur une image = Affiner, 0,25, taille fixe ({row})")
    st, r = call("POST", "/api/upscale/plan", {"items": [iid], "preset": "rapide", "factor": 4})
    row = r["rows"][0] if st == 200 else {}
    ok(st == 200 and not row.get("ok") and "×2 au plus" in row.get("why", "") and "RealESRGAN" not in row.get("why", ""),
       f"upscale : « rapide » ×4 refusé, en mots simples ({row})")
    st, r = call("POST", "/api/upscale/plan", {"items": [iid], "preset": "n-existe-pas"})
    ok(st == 400, "upscale : préréglage inconnu refusé")

    # une vidéo d'essai (ffmpeg), si ffmpeg est là
    vid = None
    if _sh.which("ffmpeg"):
        tmp = Path(tempfile.mkdtemp(prefix="sr_up_"))
        mp4 = tmp / "essai.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24:duration=1",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-c:a", "aac", str(mp4)], capture_output=True, timeout=60)
        if mp4.exists():
            st, v = call("PUT", "/api/library/upload?name=essai.mp4&title=Essai&tool=upload", raw=mp4.read_bytes())
            vid = v.get("id") if st == 200 else None
        _sh.rmtree(tmp, ignore_errors=True)
    if vid:
        st, r = call("POST", "/api/upscale/plan", {"items": [iid, vid], "model": "seedvr2-3b", "mode": "target",
                                                   "target_image": "2k", "target_video": "1080p"})
        rv = next((x for x in r.get("rows", []) if x["item"] == vid), {})
        ok(st == 200 and rv.get("out") == [1920, 1080] and rv.get("frames") == 24, f"upscale : vidéo 160×90 → 1080p ({rv})")
        ok(rv.get("mem", {}).get("latent_frames") == 7, f"upscale : 24 images → 25 (4n+1) → 7 images latentes ({rv.get('mem')})")
        st, r = call("POST", "/api/upscale/plan", {"items": [vid], "model": "zimage-refine"})
        ok(st == 200 and not r["rows"][0]["ok"] and "vidéo" in r["rows"][0]["why"], "upscale : Z-Image ne prend pas la vidéo, et le dit")
    else:
        print("  (ffmpeg absent : pas d'essai vidéo)")

    # les graphes, construits pour chaque modèle retenu
    if img.cf_available():
        for mid in RETAINED:
            for kind, item in (("image", iid), ("video", vid)):
                if kind not in MODELS[mid]["kinds"] or not item:
                    continue
                body = {"items": [item], "model": mid, "factor": 2, "color": "wavelet", "dry": True}
                st, r = call("POST", "/api/upscale/run", body)
                g = (r or {}).get("graphs", {}).get(item) or {}
                text = json.dumps(g)
                outs = [n for n in g.values() if (n.get("_meta") or {}).get("title") == "OUT"]
                ok(st == 200 and len(outs) == 1 and "{{" not in text, f"upscale : graphe {mid} {kind} ({st} {text[:300]})")
                if mid.startswith("seedvr2") and st == 200:
                    post = [n for n in g.values() if n["class_type"] == "SeedVR2PostProcessing"]
                    ok(post and post[0]["inputs"]["color_correction_method"] == "wavelet", f"upscale : {mid} {kind}, couleur réglée")
                    unet = [n["inputs"]["unet_name"] for n in g.values() if n["class_type"] == "UNETLoader"]
                    ok(unet and ("7b" in unet[0]) == (mid == "seedvr2-7b"), f"upscale : {mid} charge le bon modèle ({unet})")
                if kind == "video" and st == 200:
                    rs = [n["inputs"] for n in g.values() if n["class_type"] == "ResizeImageMaskNode"]
                    ok(rs and (rs[0]["resize_type.width"], rs[0]["resize_type.height"]) == (320, 180),
                       f"upscale : {mid} vidéo à la taille prévue ({rs})")
                if mid.startswith("seedvr2") and kind == "video" and st == 200:
                    ok(any(n["class_type"] == "SeedVR2TemporalChunk" and n["inputs"]["chunking_mode"] == "auto" for n in g.values()),
                       "upscale : SeedVR2 vidéo découpée en morceaux (auto)")
        # les graphes passent la validation à blanc de Character Factory contre eux-mêmes (structure)
        try:
            pg = _probe_graphs()
            ok(all(g for per in pg.values() for g in per.values()), "upscale : graphes de sondage construits")
        except Exception as e:
            ok(False, f"upscale : graphes de sondage ({e})")
    else:
        print("  (Character Factory absent : graphes SeedVR2 / RealESRGAN non construits)")

    # le moteur factice, de bout en bout
    def wait(jid):
        for _ in range(150):
            st, j = call("GET", f"/api/jobs/{jid}")
            if j.get("state") in ("done", "error", "cancelled"):
                return j
            time.sleep(0.2)
        return j

    st, r = call("POST", "/api/upscale/run", {"items": [iid, aid], "model": "seedvr2-3b", "factor": 2})
    ok(st == 200 and len(r.get("jobs", [])) == 2, f"upscale : deux travaux image ({st} {r})")
    for jj in r.get("jobs", []):
        j = wait(jj["id"])
        it = (j.get("items") or [{}])[0]
        src_id = jj["source"]
        want = [192, 128] if src_id == iid else [80, 60]
        ok(j.get("state") == "done" and it.get("kind") == "image" and [it.get("width"), it.get("height")] == want
           and it.get("parents") == [src_id] and it.get("origin", {}).get("model") == "seedvr2-3b-factice"
           and it.get("params", {}).get("job") == "upscale.image", f"upscale : image factice rangée avec sa lignée ({j})")
        if src_id == aid and it.get("url"):
            st, raw = call("GET", "/" + it["url"])
            ok(isinstance(raw, bytes) and Image.open(BytesIO(raw)).mode == "RGBA", "upscale : la transparence est gardée")
    if vid:
        st, r = call("POST", "/api/upscale/run", {"items": [vid], "model": "esrgan-x2", "factor": 2})
        j = wait(r["jobs"][0]["id"]) if st == 200 else {}
        it = (j.get("items") or [{}])[0]
        ok(j.get("state") == "done" and it.get("kind") == "video" and [it.get("width"), it.get("height")] == [320, 180]
           and abs((it.get("duration") or 0) - 1.0) < 0.2 and it.get("parents") == [vid] and it.get("audio"),
           f"upscale : vidéo factice 320×180, son gardé ({j})")
        st, r = call("POST", "/api/upscale/plan", {"items": [vid], "model": "esrgan-x2", "factor": 2})
        est = r["rows"][0].get("est", {}) if st == 200 else {}
        ok(est.get("s") is not None and "rendu" in est.get("how", ""), f"upscale : le temps s'estime sur les rendus mesurés ({est})")
        st, r = call("POST", "/api/upscale/plan", {"items": [vid], "preset": "precis", "factor": 2})
        row = r["rows"][0] if st == 200 else {}
        ok(row.get("ok") and row.get("model") == "seedvr2-3b", f"upscale : « précis » sur une vidéo = SeedVR2 3B ({row})")
        st, r = call("POST", "/api/upscale/plan", {"items": [vid], "preset": "creatif"})
        row = r["rows"][0] if st == 200 else {}
        ok(st == 200 and not row.get("ok") and "image seulement" in row.get("why", ""), f"upscale : « créatif » dit qu'il ne prend pas la vidéo ({row})")

    # un essai par préréglage, puis la pile de la source
    st, r = call("POST", "/api/upscale/run", {"items": [iid], "preset": "precis", "factor": 2})
    j = wait(r["jobs"][0]["id"]) if st == 200 else {}
    it = (j.get("items") or [{}])[0]
    ok(j.get("state") == "done" and it.get("params", {}).get("preset") == "precis" and it["params"].get("model") == "seedvr2-7b"
       and it["params"].get("touched") == [], f"upscale : l'essai garde son préréglage et le modèle résolu ({it.get('params')})")
    st, r = call("POST", "/api/upscale/run", {"items": [iid], "preset": "custom", "model": "seedvr2-3b", "color": "wavelet",
                                               "touched": ["color", "n-existe-pas"], "base": "precis", "factor": 2})
    j2 = wait(r["jobs"][0]["id"]) if st == 200 else {}
    it2 = (j2.get("items") or [{}])[0]
    ok(j2.get("state") == "done" and it2.get("params", {}).get("touched") == ["color"] and it2["params"].get("color") == "wavelet"
       and it2["params"].get("base") == "precis",
       f"upscale : un essai personnalisé garde ce qui a été touché ({it2.get('params')})")
    st, pile = call("GET", f"/api/upscale/pile/{iid}")
    ids = [t["id"] for t in pile.get("trials", [])] if st == 200 else []
    ok(st == 200 and pile["source"]["id"] == iid and it.get("id") in ids and it2.get("id") in ids
       and ids.index(it["id"]) < ids.index(it2["id"]) and all(iid in t["parents"] for t in pile["trials"]),
       f"upscale : la pile = la source puis ses essais, dans l'ordre ({st} {ids})")
    call("POST", f"/api/library/{it2['id']}/delete")
    st, pile = call("GET", f"/api/upscale/pile/{iid}")
    ok(st == 200 and it2["id"] not in [t["id"] for t in pile["trials"]], "upscale : un essai retiré (corbeille) quitte la pile")
    st, _ = call("GET", "/api/upscale/pile/ima-20000101-000000-dead")
    ok(st == 404, "upscale : la pile d'un média absent : 404")
