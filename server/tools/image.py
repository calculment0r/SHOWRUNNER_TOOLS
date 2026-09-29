"""Image : créer et éditer des images photo, avec Z-Image, Qwen-Image 2.1
et Krea 2 — les trois modèles que Cal a retenus pour cet outil (28/09) —
et les outils d'édition que les modèles installés permettent. L'étude qui
fonde chaque choix : `docs/etudes/image.md`.

Deux moteurs (`image_backend` dans showrunner.local.json) :

  stub     le défaut, tant que le câblage n'a pas été essayé (Cal, 28/09 :
           « on se concentre sur l'UX et l'UI … on câblera après ») : une
           image d'essai dessinée par PIL — le modèle, la taille, la graine,
           les réglages, le prompt envoyé — ou l'image source transformée
           de façon visible. Aucun modèle n'est chargé, rien n'est envoyé à
           ComfyUI. Toute l'interface se teste de bout en bout.
  comfyui  le câblage réel, en place mais pas encore essayé : les graphes
           ci-dessous, rendus par l'instance ComfyUI de l'ouvrier.

Les graphes de Krea 2 et de Qwen-Image 2.1 sont ceux de Character
Factory, importés depuis `cf_repo` (`factory/krea2.py`, `qwen21.py`), pas
recopiés : les réglages éprouvés au banc du 28/09 (Krea 2 Turbo 8 pas,
UltraReal 0,7, ordonnanceur beta ; Qwen 2.1 turbo Viggle 6 pas ; Identity
Edit v1.2 par ses nœuds) ne vivent qu'à un endroit. Le détourage BiRefNet
(`factory/comfy.py`), l'agrandissement SeedVR2 (`factory/upscale.py`) et
le changement d'angle Qwen-Image-Edit 2511 (`factory/views_qwen.py`)
aussi. Seuls les graphes de Z-Image sont propres au portail
(`server/workflows/image_zimage_*.json`, tirés des gabarits officiels de
ComfyUI).

Travaux (voie `image`, un ouvrier par DGX) :

  image.generate  texte → image, avec ou sans références (Qwen <imageN>,
                  Krea Identity Edit) ; une image par travail, pour que
                  les deux DGX rendent en même temps ;
  image.edit      une image de la bibliothèque, retouchée : `instruct`
                  (consigne, Qwen ou Krea, sur toute l'image ou sur une
                  zone peinte), `matte` (détourer), `upscale` (SeedVR2),
                  `refine` (affiner ×2 par Z-Image), `angle`
                  (Qwen-Image-Edit 2511 + LoRA d'angles).

Chaque image garde sa recette (`params`, avec `job`), son prompt envoyé,
son modèle (`origin.model`) et sa lignée (`parents`) : « Refaire » et
« Variations » relancent la recette (`POST /api/image/redo`).
"""

from __future__ import annotations

import base64
import json
import math
import random
import re
import secrets
import sys
import threading
import time
from pathlib import Path

from core import config, jobs, library
from core.comfy import Comfy, ComfyError
from core.http import HttpError

REPO = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO / "server" / "workflows"
MAX_SEED = 2 ** 50


def backend() -> str:
    b = str(config.get("image_backend", "stub"))
    return b if b in ("stub", "comfyui") else "stub"


# ── les tailles ─────────────────────────────────────────────
# Les rapports du nœud natif ResolutionSelector de ComfyUI
# (comfy_extras/nodes_resolution.py), celui des gabarits officiels des
# trois modèles ; même calcul : largeur et hauteur tirées du rapport et du
# nombre de mégapixels, arrondies au multiple.
ASPECTS = {"1:1": (1, 1), "2:3": (2, 3), "3:2": (3, 2), "3:4": (3, 4), "4:3": (4, 3),
           "9:16": (9, 16), "16:9": (16, 9), "21:9": (21, 9)}


def size_for(aspect: str, megapixels: float, multiple: int) -> tuple[int, int]:
    wr, hr = ASPECTS[aspect]
    scale = math.sqrt(megapixels * 1024 * 1024 / (wr * hr))
    return round(wr * scale / multiple) * multiple, round(hr * scale / multiple) * multiple


def _table(land: dict) -> dict:
    """Une table de tailles paysage → avec ses portraits (côtés inversés)."""
    out = dict(land)
    for a, (w, h) in land.items():
        wr, hr = a.split(":")
        if wr != hr:
            out[f"{hr}:{wr}"] = (h, w)
    return {a: out.get(a) for a in ASPECTS}


# Z-Image Turbo : les paliers exacts du Space officiel
# (huggingface.co/spaces/Tongyi-MAI/Z-Image-Turbo, app.py) ; la base
# accepte « 512×512 to 2048×2048 (total pixel area, any aspect ratio) ».
ZIMAGE_SIZES = {
    "1024": _table({"1:1": (1024, 1024), "4:3": (1152, 864), "3:2": (1248, 832), "16:9": (1280, 720), "21:9": (1344, 576)}),
    "1280": _table({"1:1": (1280, 1280), "4:3": (1472, 1104), "3:2": (1536, 1024), "16:9": (1536, 864), "21:9": (1680, 720)}),
    "1536": _table({"1:1": (1536, 1536), "4:3": (1728, 1296), "3:2": (1872, 1248), "16:9": (2048, 1152), "21:9": (2016, 864)}),
}
# Qwen-Image 2.1 : 1 Mpx au ResolutionSelector (défaut des gabarits
# officiels, « Prefer multiples of 32 ») ; en 2K, la liste native du README
# (github.com/QwenLM/Qwen-Image-2.1) — pas de 21:9 publié.
QWEN_2K = _table({"1:1": (2048, 2048), "4:3": (2400, 1792), "3:2": (2528, 1696), "16:9": (2752, 1536)})
# Krea 2 Turbo : « 1k ~ 2k », multiples de 16 (README krea-ai/krea-2) ; le
# tutoriel ComfyUI met le ResolutionSelector à 2,0 Mpx pour le 2K.

MODELS: dict[str, dict] = {
    "zimage": {
        "name": "Z-Image", "k": "Z-IMAGE",
        "role": "le plus rapide : une photo nette tirée du texte seul, sans référence",
        "refs": 0,
        "sizes": ZIMAGE_SIZES, "quality_labels": {"1024": "1024", "1280": "1280", "1536": "1536"},
        "variants": {
            "turbo": {"label": "Turbo · 8 pas", "unet": "z_image_turbo_bf16.safetensors", "steps": 8, "cfg": 1.0},
            "base": {"label": "Base · 25 pas", "unet": "z_image_bf16.safetensors", "steps": 25, "cfg": 4.0},
        },
        "refs_why": "Z-Image ne prend pas de référence : son édition (Z-Image-Edit) n'est pas publiée, "
                    "seul le texte → image l'est.",
    },
    "qwen21": {
        "name": "Qwen-Image 2.1", "k": "QWEN 2.1",
        "role": "suit le prompt à la lettre, écrit du texte, édite ; jusqu'à 3 références <image1>…",
        "refs": 3,
        "sizes": {"1": {a: size_for(a, 1.0, 32) for a in ASPECTS}, "2k": QWEN_2K},
        "quality_labels": {"1": "1 Mpx", "2k": "2K natif"},
    },
    "krea2": {
        "name": "Krea 2", "k": "KREA 2",
        "role": "la plus belle photo (peau, lumière) ; reprend une personne d'après 1 ou 2 références",
        "refs": 2,
        "sizes": {"1": {a: size_for(a, 1.0, 16) for a in ASPECTS}, "2": {a: size_for(a, 2.0, 16) for a in ASPECTS}},
        "quality_labels": {"1": "1 Mpx", "2": "2 Mpx"},
    },
}

# ── caméra, objectif, ouverture, pellicule, lumière ─────────
# Une pastille = une phrase anglaise ajoutée au prompt (étude §4).
#   prose  pour Z-Image et Qwen 2.1 : le matériel nommé, puis ce qu'il fait
#          voir (gabarits BFL, fal, Open-Generative-AI, DirectorsConsole) ;
#   krea   pour Krea 2 : ce qu'on voit, sans marque — ses exemples officiels
#          n'en nomment aucune (docs/prompting.md), les guides fal et
#          aireiter disent de décrire le format et ses défauts visibles ;
#   edit   en édition (lumière) : la consigne de rééclairage ;
#   src    d'où vient la phrase ; « à nous » : pas de phrase publiée, à
#          juger au câblage.
# `kind` (caméra, pellicule) : numérique ou film — une pellicule sur un
# boîtier numérique est signalée (règle d'époque de DirectorsConsole).
LOOKS: dict[str, dict] = {
    "camera": {"label": "Caméra", "about": "le boîtier : le grain de l'image, sa dynamique, son époque", "items": [
        {"id": "fullframe", "name": "Plein format", "sub": "HYBRIDE NUMÉRIQUE", "kind": "digital",
         "prose": "Shot on a Sony A7 IV full-frame camera, clean and sharp, high dynamic range",
         "krea": "Clean, sharp modern digital photograph with high dynamic range", "src": "BFL (Sony A7IV)"},
        {"id": "mediumformat", "name": "Moyen format", "sub": "HASSELBLAD X2D", "kind": "digital",
         "prose": "Shot on a Hasselblad X2D medium format camera, smooth tonal gradation and very fine detail",
         "krea": "Medium format photograph with smooth tonal gradation and very fine detail", "src": "BFL (Hasselblad X2D)"},
        {"id": "leica", "name": "Télémétrique 35 mm", "sub": "LEICA M6 · FILM", "kind": "film",
         "prose": "Shot on a Leica M6 35mm film camera, candid and unposed",
         "krea": "Candid 35mm film photograph, natural and unposed", "src": "fal, guide Z-Image (Leica M6)"},
        {"id": "alexa", "name": "Cinéma S35", "sub": "ARRI ALEXA 35", "kind": "digital",
         "prose": "Shot on an ARRI Alexa 35, a film still with natural color science and high dynamic range",
         "krea": "Cinematic film still with natural colour, soft highlight roll-off and high dynamic range",
         "src": "Open-Generative-AI (Studio Digital S35) + DirectorsConsole"},
        {"id": "imax", "name": "Grand format 70 mm", "sub": "IMAX · FILM", "kind": "film",
         "prose": "Shot on a grand format 70mm film camera, epic scale and immense detail",
         "krea": "Large format 70mm film still with immense detail and fine grain", "src": "Open-Generative-AI"},
        {"id": "16mm", "name": "Film 16 mm", "sub": "ARRIFLEX 16SR", "kind": "film",
         "prose": "Shot on a classic 16mm film camera, visible grain and soft contrast",
         "krea": "16mm film frame with visible grain, soft contrast and slightly muted colours", "src": "Open-Generative-AI"},
        {"id": "digicam", "name": "Compact 2000", "sub": "DIGICAM · FLASH", "kind": "digital",
         "prose": "Early digital camera, slight noise, flash photography, candid, 2000s digicam style",
         "krea": "Early digital camera, slight noise, flash photography, candid, 2000s digicam style", "src": "BFL"},
        {"id": "disposable", "name": "Jetable", "sub": "FLASH DIRECT", "kind": "film",
         "prose": "Shot on a disposable camera with direct on-camera flash, hard flash shadows and slightly soft focus",
         "krea": "Disposable camera photo with direct on-camera flash, hard flash shadows and slightly soft focus",
         "src": "aireiter, guide Krea 2 (« disposable camera flash »)"},
        {"id": "phone", "name": "Smartphone", "sub": "IPHONE", "kind": "digital",
         "prose": "Shot on an iPhone, everyday snapshot, deep focus and crisp HDR processing",
         "krea": "Everyday smartphone snapshot, deep focus and crisp HDR processing", "src": "à nous (préréglage « iPhone » de Higgsfield Soul, sans phrase publiée)"},
    ]},
    "lens": {"label": "Objectif", "about": "la focale : la perspective, ce qui entre dans le cadre", "items": [
        {"id": "14", "name": "14 mm", "sub": "ULTRA GRAND-ANGLE",
         "prose": "Shot with a 14mm lens, wide-angle perspective", "krea": "Ultra wide-angle perspective with strong depth and stretched edges",
         "src": "Open-Generative-AI (FOCAL_PERSPECTIVE)"},
        {"id": "24", "name": "24 mm", "sub": "GRAND-ANGLE",
         "prose": "Shot with a 24mm lens, wide-angle dynamic perspective", "krea": "Wide-angle dynamic perspective",
         "src": "Open-Generative-AI"},
        {"id": "35", "name": "35 mm", "sub": "RÉCIT",
         "prose": "Shot with a 35mm lens, natural cinematic perspective", "krea": "Natural cinematic perspective, as seen by the eye",
         "src": "Open-Generative-AI"},
        {"id": "50", "name": "50 mm", "sub": "STANDARD",
         "prose": "Shot with a 50mm lens, standard portrait perspective", "krea": "Standard, undistorted perspective",
         "src": "Open-Generative-AI ; Character Factory (plein pied, 50 mm)"},
        {"id": "85", "name": "85 mm", "sub": "PORTRAIT",
         "prose": "Shot on a full-frame camera with an 85mm lens, classic portrait perspective",
         "krea": "Classic portrait perspective with gentle compression, the background softly out of focus",
         "src": "Open-Generative-AI ; Character Factory (PHOTO_LOOK, banc Krea du 28/09)"},
        {"id": "135", "name": "135 mm", "sub": "TÉLÉ",
         "prose": "Shot with a 135mm telephoto lens, compressed perspective, the background pulled close and blurred",
         "krea": "Telephoto compression, the background pulled close and blurred", "src": "à nous (plages de kiko-flux2-prompt-builder)"},
        {"id": "macro", "name": "Macro", "sub": "TRÈS PRÈS",
         "prose": "Shot with an extreme macro lens, tiny details filling the frame",
         "krea": "Macro lens close-up, tiny details filling the frame", "src": "Open-Generative-AI ; exemples officiels Krea 2 (« macro lens »)"},
        {"id": "anamorphic", "name": "Anamorphique", "sub": "SCOPE",
         "prose": "Shot with a classic anamorphic lens, oval bokeh and horizontal lens flares",
         "krea": "Anamorphic cinema look with oval bokeh and horizontal lens flares", "src": "Open-Generative-AI (Classic Anamorphic) ; effets à nous"},
        {"id": "swirl", "name": "Bokeh tourbillon", "sub": "PETZVAL",
         "prose": "Shot with a swirl bokeh portrait lens", "krea": "Swirling, painterly background bokeh around a sharp subject",
         "src": "Open-Generative-AI (Swirl Bokeh Portrait)"},
        {"id": "vintage", "name": "Optique ancienne", "sub": "CANON K35",
         "prose": "Shot with a vintage prime lens, soft glow and lower contrast", "krea": "Vintage lens rendering with a soft glow and lower contrast",
         "src": "Open-Generative-AI (Vintage Prime) ; effets à nous"},
    ]},
    "aperture": {"label": "Ouverture", "about": "la profondeur de champ", "items": [
        {"id": "f1.4", "name": "f/1.4", "sub": "FLOU CRÉMEUX",
         "prose": "Aperture f/1.4, shallow depth of field, creamy bokeh", "krea": "Shallow depth of field, creamy bokeh",
         "src": "Open-Generative-AI (APERTURE_EFFECT) ; exemples Krea (« shallow depth of field »)"},
        {"id": "f2.8", "name": "f/2.8", "sub": "SUJET DÉTACHÉ",
         "prose": "Aperture f/2.8, the subject sharp against a softly blurred background", "krea": "The subject sharp against a softly blurred background",
         "src": "BFL (« 80mm lens, f/2.8 ») ; effet à nous"},
        {"id": "f4", "name": "f/4", "sub": "ÉQUILIBRÉ",
         "prose": "Aperture f/4, balanced depth of field", "krea": "Balanced depth of field", "src": "Open-Generative-AI"},
        {"id": "f11", "name": "f/11", "sub": "TOUT NET",
         "prose": "Aperture f/11, deep focus clarity, sharp foreground to background", "krea": "Deep focus, sharp from foreground to background",
         "src": "Open-Generative-AI"},
    ]},
    "film": {"label": "Pellicule", "about": "la couleur et le grain d'une émulsion", "items": [
        {"id": "portra400", "name": "Portra 400", "sub": "KODAK · COULEUR", "kind": "film",
         "prose": "Shot on Kodak Portra 400, natural grain, organic colors",
         "krea": "Warm colour negative film look, soft natural skin tones, fine natural grain", "src": "BFL ; teinte : gptimager"},
        {"id": "gold200", "name": "Gold 200", "sub": "KODAK · AMBRE", "kind": "film",
         "prose": "Shot on Kodak Gold 200, warm amber tones, nostalgic consumer film grain",
         "krea": "Warm amber consumer film look with nostalgic grain", "src": "à nous (descripteur gptimager)"},
        {"id": "velvia", "name": "Velvia 50", "sub": "FUJI · DIAPO", "kind": "film",
         "prose": "Shot on Fujifilm Velvia 50 slide film, saturated greens and blues, deep contrast",
         "krea": "Slide film look with saturated greens and blues and deep contrast", "src": "à nous (descripteur gptimager)"},
        {"id": "cinestill", "name": "CineStill 800T", "sub": "TUNGSTÈNE · HALO", "kind": "film",
         "prose": "Shot on CineStill 800T, cool tungsten color balance, red halation glowing around the lights, visible grain",
         "krea": "Cool tungsten film look with red halation glowing around the light sources and visible grain",
         "src": "à nous (descripteurs bako02, gptimager)"},
        {"id": "vision3", "name": "Vision3 500T", "sub": "KODAK · CINÉMA", "kind": "film",
         "prose": "Shot on Kodak Vision3 500T motion picture film, teal shadows and warm highlights, cinematic grain",
         "krea": "Motion picture film look with teal shadows, warm highlights and cinematic grain", "src": "DirectorsConsole (stock) ; teinte : bako02"},
        {"id": "hp5", "name": "HP5 noir et blanc", "sub": "ILFORD · N&B", "kind": "film",
         "prose": "Shot on Ilford HP5 black and white film, pronounced monochrome grain",
         "krea": "Black and white film photograph with pronounced grain", "src": "à nous (descripteur bako02)"},
        {"id": "mediumfilm", "name": "Moyen format argentique", "sub": "120 · GRAIN", "kind": "film",
         "prose": "Shot on medium-format analog film, pronounced grain",
         "krea": "Medium-format analog film look, pronounced grain", "src": "Google, guide Nano Banana"},
        {"id": "80s", "name": "Couleur années 80", "sub": "VINTAGE", "kind": "film",
         "prose": "As if on 1980s color film, slightly grainy",
         "krea": "As if on 1980s color film, slightly grainy", "src": "Google, guide Nano Banana"},
        {"id": "xpro", "name": "Ektachrome croisé", "sub": "CROSS PROCESS", "kind": "film",
         "prose": "Cross-processed Ektachrome showing extreme color shifts",
         "krea": "Cross-processed slide film look with extreme colour shifts", "src": "BFL"},
    ]},
    "light": {"label": "Lumière", "about": "d'où vient la lumière, sa dureté, sa retombée — décrite, pas nommée par le projecteur", "items": [
        {"id": "softbox", "name": "Studio doux", "sub": "BOÎTE À LUMIÈRE",
         "prose": "A single large softbox slightly to camera left with a white bounce card on the right: soft light with a gentle falloff across the far cheek and small catchlights in both eyes",
         "edit": "Relight the scene with a single large softbox slightly to camera left and a white bounce card on the right: soft light with a gentle falloff",
         "src": "Character Factory (PHOTO_LIGHT, gardé au banc Krea du 28/09)"},
        {"id": "window", "name": "Fenêtre", "sub": "LUMIÈRE NATURELLE",
         "prose": "Natural window light creating soft shadows",
         "edit": "Relight the scene with natural window light from the side, creating soft shadows", "src": "fal, guide Z-Image"},
        {"id": "golden", "name": "Heure dorée", "sub": "CONTRE-JOUR CHAUD",
         "prose": "Golden hour backlighting creating long shadows",
         "edit": "Relight the scene as at golden hour: warm low backlight creating long shadows", "src": "Google, guide Nano Banana"},
        {"id": "blue", "name": "Heure bleue", "sub": "APRÈS LE COUCHER",
         "prose": "Blue hour light just after sunset, cool and soft, with no direct sun",
         "edit": "Relight the scene with cool, soft blue hour light just after sunset", "src": "à nous (descripteur trendingprompt)"},
        {"id": "rembrandt", "name": "Rembrandt", "sub": "45° · TRIANGLE",
         "prose": "Rembrandt lighting: key light at roughly 45 degrees and above, a small triangle of light on the shadowed cheek",
         "edit": "Relight the face with Rembrandt lighting: key light at roughly 45 degrees and above, a small triangle of light on the shadowed cheek",
         "src": "trendingprompt"},
        {"id": "butterfly", "name": "Papillon", "sub": "FACE · HAUT",
         "prose": "Butterfly lighting: light directly in front and above, a small shadow under the nose",
         "edit": "Relight the face with butterfly lighting: light directly in front and above, a small shadow under the nose", "src": "trendingprompt"},
        {"id": "split", "name": "Split", "sub": "90° · MOITIÉ",
         "prose": "Split lighting: light from exactly 90 degrees, half the face lit, half in shadow",
         "edit": "Relight the face with split lighting from exactly 90 degrees: half the face lit, half in shadow", "src": "trendingprompt"},
        {"id": "rim", "name": "Contre-jour", "sub": "LISERÉ",
         "prose": "Rim lighting from behind outlining the subject with a thin bright edge",
         "edit": "Relight the scene with a strong rim light from behind outlining the subject with a thin bright edge", "src": "gist Z-Image (« rim lighting ») ; Higgsfield (Contre-jour)"},
        {"id": "chiaroscuro", "name": "Clair-obscur", "sub": "CONTRASTE DUR",
         "prose": "Chiaroscuro lighting with harsh, high contrast",
         "edit": "Relight the scene with chiaroscuro lighting: harsh, high contrast, deep shadows", "src": "Google, guide Nano Banana"},
        {"id": "hardbulb", "name": "Ampoule nue", "sub": "LUMIÈRE DURE",
         "prose": "Hard side light from a bare bulb, deep falloff on the far cheek",
         "edit": "Relight the scene with a hard side light from a bare bulb, deep falloff on the far side", "src": "aireiter, guide Krea 2"},
        {"id": "highkey", "name": "High-key", "sub": "CLAIR · SANS OMBRE",
         "prose": "High-key lighting, bright and even, almost shadowless",
         "edit": "Relight the scene with high-key lighting, bright and even, almost shadowless", "src": "exemples officiels Krea 2 (« high-key lighting »)"},
        {"id": "practicals", "name": "Lampes du décor", "sub": "NÉONS · PRATIQUES",
         "prose": "Lit only by practical lamps and neon signs within the scene, pools of colored light",
         "edit": "Relight the scene so that it is lit only by practical lamps and neon signs within it, pools of colored light",
         "src": "à nous (réglage « Practicals » de Higgsfield Cinema Studio 3.5, sans phrase publiée)"},
    ]},
}
LOOK_ORDER = ("camera", "lens", "aperture", "film", "light")

# ── l'édition ───────────────────────────────────────────────
EDIT_TOOLS: dict[str, dict] = {
    "instruct": {"name": "Consigne", "sub": "QWEN 2.1 · KREA 2",
                 "about": "dire le changement ; une zone peinte le borne ; des références ajoutent une personne, un objet, une tenue"},
    "matte": {"name": "Détourer", "sub": "BIREFNET", "about": "le sujet seul, sur fond transparent (PNG)"},
    "upscale": {"name": "Agrandir", "sub": "SEEDVR2 7B",
                "about": "×2 ou ×4 sans rien inventer : l'image restaurée, couleurs recalées sur l'originale"},
    "refine": {"name": "Affiner ×2", "sub": "Z-IMAGE TURBO",
               "about": "×2 en réinventant le détail fin (peau, tissu) ; débruitage 0,15–0,35"},
    "angle": {"name": "Angle", "sub": "QWEN-EDIT 2511",
              "about": "la même scène vue d'ailleurs : autour, au-dessus, plus près"},
    "extend": {"name": "Étendre", "sub": "À TÉLÉCHARGER",
               "about": "agrandir le cadre (outpaint)", "off": "aucune méthode documentée pour nos trois modèles "
               "(Krea Identity Edit v1.2 l'annonce sans mode d'emploi) ; proposition dans l'étude §9 : "
               "Z-Image-Turbo-Fun-Controlnet-Union-2.1 (inpaint documenté), ou un essai au câblage"},
}

# Changement d'angle : le LoRA fal/Qwen-Image-Edit-2511-Multiple-Angles
# (Apache-2.0) répond à « <sks> <azimut> <hauteur> <distance> »
# (factory/views_qwen.py ; vocabulaire de sa fiche Hugging Face). Les côtés
# sont ceux du sujet, convention du LoRA (à vérifier au câblage).
ANGLE_AZIMUTH = [("front view", "face"), ("front-right quarter view", "3/4 avant droit"),
                 ("right side view", "profil droit"), ("back-right quarter view", "3/4 arrière droit"),
                 ("back view", "dos"), ("back-left quarter view", "3/4 arrière gauche"),
                 ("left side view", "profil gauche"), ("front-left quarter view", "3/4 avant gauche")]
ANGLE_ELEVATION = [("low-angle shot", "contre-plongée −30°"), ("eye-level shot", "hauteur d'œil"),
                   ("elevated shot", "surélevé +30°"), ("high-angle shot", "plongée +60°")]
ANGLE_DISTANCE = [("close-up", "gros plan"), ("medium shot", "plan moyen"), ("wide shot", "plan large")]


# ── Character Factory, importé ──────────────────────────────
_cf_mod = None
_cf_lock = threading.Lock()


def _cf():
    """Les modules de Character Factory (`cf_repo`) : krea2, qwen21, comfy,
    upscale, views_qwen, config. Ajouté en fin de chemin : `factory` n'a
    pas d'homonyme dans le portail, qui garde ses paquets `core` et `tools`.
    `factory.config` lit le factory.local.json de Character Factory."""
    global _cf_mod
    with _cf_lock:
        if _cf_mod is None:
            repo = str(Path(config.get("cf_repo")).expanduser())
            if not (Path(repo) / "factory" / "krea2.py").is_file():
                raise RuntimeError(f"Character Factory introuvable dans {repo} (réglage cf_repo) : "
                                   "les graphes Krea 2 et Qwen 2.1 en viennent")
            if repo not in sys.path:
                sys.path.append(repo)
            import importlib
            ns = type("CF", (), {})()
            for name in ("config", "comfy", "krea2", "qwen21", "upscale", "views_qwen"):
                setattr(ns, name, importlib.import_module(f"factory.{name}"))
            _cf_mod = ns
        return _cf_mod


def cf_available() -> bool:
    try:
        _cf()
        return True
    except Exception:
        return False


# ── ce que chaque machine sait faire (lecture seule) ─────────
def _requires() -> dict[str, list[tuple[str, str | None, str | None]]]:
    """(nœud chargeur, entrée, fichier) par capacité ; fichier None : le
    nœud seul. Les noms viennent des modules de Character Factory."""
    cf = _cf()
    k2, q21 = cf.krea2, cf.qwen21
    st = cf.config.setting
    krea = [("UNETLoader", "unet_name", st("krea2_unet", k2.UNET)), ("CLIPLoader", "clip_name", st("krea2_clip", k2.CLIP)),
            ("VAELoader", "vae_name", st("krea2_vae", k2.VAE))]
    zi = [("CLIPLoader", "clip_name", "qwen_3_4b.safetensors"), ("VAELoader", "vae_name", "ae.safetensors")]
    return {
        "zimage:turbo": [("UNETLoader", "unet_name", MODELS["zimage"]["variants"]["turbo"]["unet"])] + zi,
        "zimage:base": [("UNETLoader", "unet_name", MODELS["zimage"]["variants"]["base"]["unet"])] + zi,
        "qwen21": [("UNETLoader", "unet_name", st("qwen21_unet", q21.UNET)), ("CLIPLoader", "clip_name", st("qwen21_clip", q21.CLIP)),
                   ("VAELoader", "vae_name", q21.VAE), ("LoraLoaderBypassModelOnly", "lora_name", st("qwen21_lora", q21.LORA)),
                   ("TextEncodeQwenImage21", None, None), ("QwenImage21Cache", None, None)],
        "krea2": krea + [("LoraLoaderModelOnly", "lora_name", name) for name, _ in k2.photo_loras()],
        # les nœuds v1.2 (`fit_mode`) : ceux que le graphe `edit="node"` appelle ;
        # DGX1 servait encore la signature v1.1 le 28/09 (validation à blanc)
        "krea2:edit": krea + [("LoraLoaderModelOnly", "lora_name", st("krea2_edit_lora_v12", k2.EDIT_LORA_V12)),
                              ("Krea2EditModelPatch", "fit_mode", None), ("Krea2EditGroundedEncode", None, None)],
        "matte": [("LoadBackgroundRemovalModel", "bg_removal_name", st("birefnet", "birefnet.safetensors"))],
        "upscale": [("UNETLoader", "unet_name", st("seedvr2_unet", cf.upscale.SEEDVR2_UNET)),
                    ("VAELoader", "vae_name", st("seedvr2_vae", cf.upscale.SEEDVR2_VAE)), ("SeedVR2Conditioning", None, None)],
        "refine": [("UNETLoader", "unet_name", "z_image_turbo_bf16.safetensors"), ("UpscaleModelLoader", "model_name", "RealESRGAN_x2.pth")] + zi,
        "angle": [("UNETLoader", "unet_name", "qwen_image_edit_2511_fp8mixed.safetensors"),
                  ("LoraLoaderModelOnly", "lora_name", "qwen-image-edit-2511-multiple-angles-lora.safetensors"),
                  ("LoraLoaderModelOnly", "lora_name", "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"),
                  ("CLIPLoader", "clip_name", "qwen_2.5_vl_7b_fp8_scaled.safetensors"), ("VAELoader", "vae_name", "qwen_image_vae.safetensors")],
    }


_avail: dict[str, tuple[float, dict]] = {}
_avail_lock = threading.Lock()


def _endpoint_caps(url: str) -> dict[str, list[str]]:
    """Pour une instance ComfyUI : {capacité: [ce qui manque]}. Lit
    /object_info nœud par nœud — rien n'est chargé ni rendu."""
    reqs = _requires()
    nodes = sorted({n for r in reqs.values() for n, _, _ in r})
    info: dict = {}
    c = Comfy(url, timeout=20)
    for n in nodes:
        try:
            info.update(c.object_info(n))
        except ComfyError:
            pass
    out = {}
    for cap, need in reqs.items():
        missing = []
        for node, field, name in need:
            spec = info.get(node)
            if not spec:
                missing.append(f"nœud {node}")
                continue
            inp = {**spec.get("input", {}).get("required", {}), **spec.get("input", {}).get("optional", {})}
            if field and not name:
                if field not in inp:
                    missing.append(f"nœud {node} sans « {field} » (version plus ancienne)")
            elif field:
                opt = inp.get(field) or [[]]
                opts = opt[0] if isinstance(opt[0], list) else (opt[1].get("options", []) if len(opt) > 1 and isinstance(opt[1], dict) else [])
                if name not in opts:
                    missing.append(name)
        out[cap] = missing
    return out


def availability(max_age: float = 120.0) -> dict:
    """{capacité: {"on": [url…], "missing": {machine: [fichiers]}}} sur la voie image."""
    eps = [e for e in config.get("lanes", {}).get("image", []) if e != "local"]
    caps: dict[str, dict] = {}
    for ep in eps:
        with _avail_lock:
            t, got = _avail.get(ep, (0.0, None))
        if got is None or time.time() - t > max_age:
            ok, why = jobs.endpoint_alive(ep)
            if ok:
                try:
                    got = _endpoint_caps(ep)
                except Exception as e:  # une machine qui répond mal ne casse pas la page
                    got = {"_error": str(e)}
            else:
                got = {"_down": why}
            with _avail_lock:
                _avail[ep] = (time.time(), got)
        m = jobs.machine_of(ep)
        for cap in _requires():
            c = caps.setdefault(cap, {"on": [], "missing": {}})
            if "_down" in got or "_error" in got:
                c["missing"][m] = ["ne répond pas"]
            elif got.get(cap):
                c["missing"][m] = got[cap]
            else:
                c["on"].append(ep)
    return caps


def _pin_for(cap: str) -> str | None:
    """L'instance où épingler un travail dont le modèle n'est que sur une
    machine (Z-Image base : DGX1). Aucune : on refuse, en disant pourquoi.
    En factice, rien n'est épinglé : aucun modèle n'est chargé."""
    if backend() == "stub":
        return None
    eps = [e for e in config.get("lanes", {}).get("image", []) if e != "local"]
    try:
        av = availability().get(cap)
    except Exception:
        return None
    if not av or not eps:
        return None
    if not av["on"]:
        miss = "; ".join(f"{m} : {', '.join(v)}" for m, v in av["missing"].items())
        raise HttpError(409, f"aucune machine ne peut le faire ({miss})")
    return None if len(av["on"]) == len(eps) else av["on"][0]


# ── le prompt ───────────────────────────────────────────────
def _look(group: str, lid: str) -> dict | None:
    return next((x for x in LOOKS[group]["items"] if x["id"] == lid), None)


def _sentence(s: str) -> str:
    s = (s or "").strip()
    return s if not s or s[-1] in ".!?»\"'" else s + "."


def compose(model: str, prompt: str, looks: dict | None = None, refs: list[dict] | None = None,
            mode: str = "generate", keep_face: bool = False, transparent: bool = False) -> dict:
    """Le prompt réellement envoyé, et ce qui mérite d'être dit (`notes`).
    `refs` : [{label}] dans l'ordre d'envoi, sans l'image éditée."""
    looks = looks or {}
    refs = refs or []
    notes = []
    parts = [_sentence(prompt)]
    for g in LOOK_ORDER:
        lid = looks.get(g)
        if not lid:
            continue
        it = _look(g, lid)
        if not it:
            raise ValueError(f"réglage inconnu : {g}={lid}")
        if mode == "edit":
            text = it.get("edit") or it["prose"]
        else:
            text = it["krea"] if model == "krea2" and it.get("krea") else it["prose"]
        parts.append(_sentence(text))
    cam, film = _look("camera", looks.get("camera") or ""), _look("film", looks.get("film") or "")
    if cam and film and cam.get("kind") == "digital":
        notes.append(f"pellicule sur un boîtier numérique ({cam['name']} + {film['name']}) : "
                     "le prompt décrit les deux ; DirectorsConsole l'interdirait")
    if model == "qwen21" and refs:
        # « Mention them in the prompt as <image1>, <image2> » (note du
        # gabarit officiel image_qwen_image_2_1_image_edit) : une référence
        # que le prompt ne nomme pas est présentée en une phrase.
        joined = " ".join(parts)
        first = 2 if mode == "edit" else 1
        for k, r in enumerate(refs):
            tag = f"<image{first + k}>"
            if tag not in joined:
                parts.append(f"{tag} shows {r['label']}.")
                notes.append(f"{tag} présentée automatiquement : le prompt ne la nommait pas")
    if transparent and model == "qwen21" and mode == "generate":
        # le gabarit de la note officielle ComfyUI (image_qwen_image_2_1_t2i)
        # et du README Qwen-Image 2.1 : l'alpha est natif, sans détourage
        body = " ".join(p for p in parts if p).rstrip(".")
        parts = [f"This is an RGBA format image with transparency. {body}. "
                 "The image has an alpha channel and a transparent background."]
    if keep_face:
        if model == "qwen21":
            # formulation du gabarit officiel image_qwen_image_2_1_image_edit
            parts.append("Preserve the original facial features, hair and body shape.")
        elif model == "krea2":
            # formulation de Character Factory (krea2.FACE_PASS, banc du 28/09)
            parts.append("Keep the face, the identity, the age, the skin and the hair exactly as they are.")
    return {"prompt": " ".join(p for p in parts if p), "notes": notes}


# ── les références ──────────────────────────────────────────
ROLE_EN = {"face": "the face of", "full body": "the full body of", "expression": "an expression of",
           "outfit": "the outfit of", "view": "a view of"}


def _ref(r: dict) -> dict:
    """{item, ref?} → {path, label, item, role}. Un élément donne la
    référence choisie (`ref` : son fichier), sinon sa première."""
    it = library.get((r or {}).get("item", ""))
    if not it:
        raise ValueError(f"référence introuvable : {(r or {}).get('item')}")
    if it["kind"] == "image":
        return {"path": library.path_of(it), "label": f"“{it.get('title') or it['id']}”", "item": it["id"], "role": "",
                "title": it.get("title") or it["id"]}
    if it["kind"] != "element":
        raise ValueError(f"une référence est une image ou un élément : {it['id']}")
    refs = it["element"].get("refs") or []
    if not refs:
        raise ValueError(f"l'élément {it.get('title')} n'a aucune image")
    pick = next((x for x in refs if x["file"] == r.get("ref")), refs[0])
    role = pick.get("role") or ""
    who = it.get("title") or "the element"
    label = f"{ROLE_EN.get(role, '')} {who}".strip() if it["element"].get("type") == "character" else who
    return {"path": library.path_of(it, pick["file"]), "label": label, "item": it["id"], "role": role,
            "title": f"{who} · {pick.get('label') or role}"}


def _rgb(src: Path, dest: Path, longest: int | None = None) -> Path:
    """En RVB, l'alpha posé sur du blanc (comme Qwen 2.1 montre l'alpha à son
    encodeur de vision) ; le grand côté borné si demandé."""
    from PIL import Image
    im = Image.open(src)
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.alpha_composite(im)
        im = bg
    im = im.convert("RGB")
    if longest and max(im.size) > longest:
        im.thumbnail((longest, longest), Image.LANCZOS)
    im.save(dest)
    return dest


# ── les masques de zone ─────────────────────────────────────
MASK_RX = re.compile(r"^msk-[0-9a-f]{12}\.png$")


def masks_dir() -> Path:
    p = config.data_dir() / "image_masks"
    p.mkdir(parents=True, exist_ok=True)
    return p


def save_mask(data_url: str) -> str:
    """Le masque peint dans la page (PNG en data URL) : blanc = la zone."""
    from io import BytesIO
    from PIL import Image
    m = re.fullmatch(r"data:image/png;base64,([A-Za-z0-9+/=]+)", (data_url or "").strip())
    if not m:
        raise ValueError("masque : un PNG en data URL est attendu")
    raw = base64.b64decode(m.group(1))
    if len(raw) > 8 << 20:
        raise ValueError("masque trop lourd")
    im = Image.open(BytesIO(raw)).convert("L")
    if not im.getbbox():
        raise ValueError("la zone est vide : peignez sur l'image")
    name = f"msk-{secrets.token_hex(6)}.png"
    im.save(masks_dir() / name)
    return name


def mask_path(name: str) -> Path:
    if not MASK_RX.fullmatch(name or ""):
        raise ValueError("masque inconnu")
    p = masks_dir() / name
    if not p.is_file():
        raise ValueError("masque introuvable")
    return p


def zone_box(mask, size: tuple[int, int], pad: float = 0.25, least: int = 384) -> tuple[int, int, int, int]:
    """La boîte à éditer autour de la zone : élargie de `pad`, au moins
    `least` px de côté, dans l'image."""
    W, H = size
    x0, y0, x1, y1 = mask.getbbox()
    w, h = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, h = max(least, w * (1 + 2 * pad)), max(least, h * (1 + 2 * pad))
    w, h = min(w, W), min(h, H)
    left, top = int(min(max(cx - w / 2, 0), W - w)), int(min(max(cy - h / 2, 0), H - h))
    return left, top, left + int(w), top + int(h)


def paste_zone(src_img, edited, mask, box, dest: Path) -> Path:
    """Recolle l'édition de la boîte dans l'image, par le masque adouci :
    rien ne change hors de la zone, par construction (comme le report du
    visage de Character Factory, krea2.face_pass)."""
    from PIL import Image, ImageFilter
    left, top, right, bottom = box
    patch = edited.convert("RGB").resize((right - left, bottom - top), Image.LANCZOS)
    soft = mask.crop(box).filter(ImageFilter.GaussianBlur(max(2, (right - left) * 0.02)))
    out = src_img.convert("RGB").copy()
    out.paste(patch, (left, top), soft)
    out.save(dest)
    return dest


# ── la validation ───────────────────────────────────────────
def _int(v, lo: int, hi: int, name: str) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError) as e:
        raise ValueError(f"{name} : un entier est attendu") from e
    if not lo <= n <= hi:
        raise ValueError(f"{name} : entre {lo} et {hi}")
    return n


def _seed(v) -> int:
    return random.randrange(MAX_SEED) if v in (None, "") else _int(v, 0, MAX_SEED, "graine")


def _looks(d) -> dict:
    out = {}
    for g, lid in (d or {}).items():
        if g not in LOOKS:
            raise ValueError(f"réglage inconnu : {g}")
        if lid:
            if not _look(g, lid):
                raise ValueError(f"réglage inconnu : {g}={lid}")
            out[g] = lid
    return out


def _refs(d, n_max: int, why: str = "") -> list[dict]:
    out = []
    for r in d or []:
        if isinstance(r, str):
            r = {"item": r}
        if not isinstance(r, dict) or not r.get("item"):
            raise ValueError("référence mal formée")
        out.append({"item": r["item"], **({"ref": r["ref"]} if r.get("ref") else {})})
    if len(out) > n_max:
        raise ValueError(why or f"{n_max} référence{'s' if n_max > 1 else ''} au plus")
    for r in out:
        _ref(r)  # lève si l'objet n'existe pas
    return out


def check_generate(d: dict) -> dict:
    model = d.get("model")
    if model not in MODELS:
        raise ValueError(f"modèle inconnu : {model} ({', '.join(MODELS)})")
    m = MODELS[model]
    prompt = (d.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("le prompt est vide")
    if len(prompt) > 6000:
        raise ValueError("prompt trop long (6000 signes au plus)")
    aspect = d.get("aspect") or "1:1"
    if aspect not in ASPECTS:
        raise ValueError(f"format inconnu : {aspect}")
    quality = str(d.get("quality") or next(iter(m["sizes"])))
    if quality not in m["sizes"]:
        raise ValueError(f"{m['name']} : taille « {quality} » non proposée ({', '.join(m['sizes'])})")
    wh = m["sizes"][quality].get(aspect)
    if not wh:
        raise ValueError(f"{m['name']} : le {aspect} n'est pas documenté en {m['quality_labels'][quality]}")
    variant = d.get("variant") or "turbo"
    if model == "zimage" and variant not in m["variants"]:
        raise ValueError(f"Z-Image : variante inconnue {variant}")
    refs = _refs(d.get("refs"), m["refs"], m.get("refs_why", ""))
    out = {"model": model, "prompt": prompt, "looks": _looks(d.get("looks")), "aspect": aspect, "quality": quality,
           "width": wh[0], "height": wh[1], "seed": _seed(d.get("seed")), "refs": refs}
    if model == "zimage":
        out["variant"] = variant
    if model == "krea2":
        out["realism"] = bool(d.get("realism", True))
    if model == "qwen21" and d.get("transparent"):
        out["transparent"] = True
    return out


def check_edit(d: dict) -> dict:
    tool = d.get("tool")
    if tool not in EDIT_TOOLS:
        raise ValueError(f"outil inconnu : {tool} ({', '.join(EDIT_TOOLS)})")
    if EDIT_TOOLS[tool].get("off"):
        raise ValueError(f"{EDIT_TOOLS[tool]['name']} : {EDIT_TOOLS[tool]['off']}")
    src = library.get(d.get("source") or "")
    if not src or src["kind"] != "image":
        raise ValueError("l'image à éditer est introuvable dans la bibliothèque")
    out = {"tool": tool, "source": src["id"], "seed": _seed(d.get("seed"))}
    if tool == "instruct":
        model = d.get("model")
        if model not in ("qwen21", "krea2"):
            raise ValueError("l'édition par consigne se fait avec Qwen-Image 2.1 ou Krea 2 "
                             "(Z-Image n'édite pas : il sait affiner, outil « Affiner ×2 »)")
        prompt = (d.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("la consigne est vide")
        n_max = MODELS[model]["refs"] - 1  # l'image éditée compte
        out.update(model=model, prompt=prompt[:6000], looks=_looks(d.get("looks")), keep_face=bool(d.get("keep_face")),
                   refs=_refs(d.get("refs"), n_max, f"{MODELS[model]['name']} : {n_max} référence"
                              f"{'s' if n_max > 1 else ''} en plus de l'image éditée"))
        if d.get("mask"):
            out["mask"] = d["mask"] if MASK_RX.fullmatch(str(d["mask"])) else save_mask(d["mask"])
            mask_path(out["mask"])
    elif tool == "upscale":
        f = _int(d.get("factor", 2), 2, 4, "facteur")
        if f == 3:
            raise ValueError("facteur : 2 ou 4")
        w, h = src.get("width") or 0, src.get("height") or 0
        if max(w, h) * f > 8192:
            raise ValueError(f"trop grand : {w}×{h} ×{f} dépasserait 8192 px")
        out["factor"] = f
    elif tool == "refine":
        try:
            den = float(d.get("denoise", 0.25))
        except (TypeError, ValueError) as e:
            raise ValueError("débruitage : un nombre") from e
        if not 0.1 <= den <= 0.5:
            raise ValueError("débruitage : entre 0,10 et 0,50 (le gabarit conseille 0,15–0,35)")
        # « une description détaillée » (note du gabarit) : le prompt d'une
        # image créée ici en est une ; celui d'une édition n'est qu'une consigne
        caption = src.get("prompt") if (src.get("params") or {}).get("job") == "image.generate" else ""
        out.update(denoise=round(den, 2), prompt=(d.get("prompt") or caption or "").strip()[:6000])
    elif tool == "angle":
        az, el, di = d.get("azimuth"), d.get("elevation"), d.get("distance")
        if az not in dict(ANGLE_AZIMUTH) or el not in dict(ANGLE_ELEVATION) or di not in dict(ANGLE_DISTANCE):
            raise ValueError("angle : azimut, hauteur et distance à choisir dans la liste")
        out.update(azimuth=az, elevation=el, distance=di)
    return out


# ── les graphes (le câblage réel) ───────────────────────────
def _load(name: str) -> dict:
    wf = json.loads((WORKFLOWS / name).read_text(encoding="utf-8"))
    return {k: v for k, v in wf.items() if not k.startswith("_")}


def _fill(wf: dict, values: dict, names: list[str]) -> dict:
    return _cf().comfy.fill(wf, values, names)


def graph_generate(p: dict, names: list[str], prompt: str) -> dict:
    """Le graphe d'un rendu, références déjà déposées (`names`)."""
    cf = _cf()
    w, h, model = p["width"], p["height"], p["model"]
    if model == "zimage":
        v = MODELS["zimage"]["variants"][p.get("variant", "turbo")]
        wf = _load("image_zimage_turbo.json")
        if p.get("variant") == "base":
            # gabarit image_z_image : un vrai négatif (vide ici), CFG 4
            wf["6"] = {"class_type": "CLIPTextEncode", "inputs": {"clip": ["3", 0], "text": ""}}
        return _fill(wf, {"prompt": prompt, "seed": p["seed"], "width": w, "height": h, "unet": v["unet"],
                          "steps": v["steps"], "cfg": v["cfg"]}, [])
    if model == "qwen21":
        return _fill(cf.qwen21.workflow(len(names), w, h), {"prompt": prompt, "seed": p["seed"]}, names)
    if model == "krea2":
        if names:
            # Identity Edit v1.2 par ses nœuds (`edit="node"`, choix de
            # Character Factory au banc du 28/09) : la source est mise au
            # cadre de la sortie par le nœud (`fit`) ; ordonnanceur simple,
            # le réglage où les éditions ont été essayées.
            wf = cf.krea2.workflow(len(names), w, h, edit="node", scheduler="simple")
        else:
            wf = cf.krea2.workflow(0, w, h, scheduler=cf.config.setting("krea2_scheduler", "beta"),
                                   loras=cf.krea2.photo_loras() if p.get("realism", True) else [])
        return _fill(wf, {"prompt": prompt, "seed": p["seed"]}, names)
    raise ValueError(model)


def qwen_edit_size(w: int, h: int, resolution: int) -> tuple[int, int]:
    """La taille où TextEncodeQwenImage21 met la première image (et son
    latent de sortie) : même calcul que le nœud (comfy_extras/nodes_qwen)."""
    ratio = w / h
    return (max(32, round(math.sqrt(resolution * resolution * ratio) / 32) * 32),
            max(32, round(math.sqrt(resolution * resolution / ratio) / 32) * 32))


def edit_resolution(w: int, h: int) -> int:
    """Qwen 2.1 édite à l'aire de la source : `resolution` est un budget
    (le côté du carré de même aire), de 512 à 1536 — le turbo Viggle a
    appris l'édition en 1024² et 1536² (sa fiche)."""
    return int(min(1536, max(512, round(math.sqrt(w * h) / 32) * 32)))


def krea_edit_size(w: int, h: int) -> tuple[int, int]:
    """Krea 2 édite au rapport de sa source, 2 Mpx au plus (README des
    nœuds comfyui-krea2edit : « Generate at ≤2MP »), au pas de 16."""
    scale = min(1.0, math.sqrt(2 * 1024 * 1024 / (w * h)))
    return max(256, round(w * scale / 16) * 16), max(256, round(h * scale / 16) * 16)


def graph_instruct(p: dict, src_size: tuple[int, int], names: list[str], prompt: str) -> tuple[dict, tuple[int, int]]:
    cf = _cf()
    w0, h0 = src_size
    if p["model"] == "qwen21":
        res = edit_resolution(w0, h0)
        w, h = qwen_edit_size(w0, h0, res)
        wf = cf.qwen21.workflow(len(names), w, h, resolution=res)
        # « custom_size off: canvas comes from the encode latent (image_1) » :
        # l'édition se rend sur le latent de l'encodeur, à la taille de la
        # source ; toute autre taille décale l'édition (infobulle du nœud).
        wf["12"]["inputs"]["latent_image"] = ["6", 2]
        return _fill(wf, {"prompt": prompt, "seed": p["seed"]}, names), (w, h)
    w, h = krea_edit_size(w0, h0)
    wf = cf.krea2.workflow(len(names), w, h, edit="node", scheduler="simple")
    return _fill(wf, {"prompt": prompt, "seed": p["seed"]}, names), (w, h)


def angle_prompt(p: dict) -> str:
    return f"<sks> {p['azimuth']} {p['elevation']} {p['distance']}"


def edit_graph(p: dict, src_size: tuple[int, int], names: list[str], prompt: str = "") -> dict:
    """Le graphe d'une édition (hors consigne), l'entrée déjà déposée."""
    cf = _cf()
    if p["tool"] == "matte":
        return cf.comfy.matte_workflow(names)
    if p["tool"] == "upscale":
        return cf.upscale.seedvr2_workflow(names[0], p["seed"] % (2 ** 32))
    if p["tool"] == "refine":
        return _fill(_load("image_zimage_refine.json"), {"prompt": prompt, "seed": p["seed"], "denoise": p["denoise"]}, names)
    if p["tool"] == "angle":
        return _fill(cf.views_qwen.workflow("qwen-2511"), {"prompt": angle_prompt(p), "seed": p["seed"]}, names)
    raise ValueError(p["tool"])


# ── le moteur factice : une image d'essai ───────────────────
_tok: dict | None = None


def tokens() -> dict:
    """Les couleurs de commun/tokens.css — la seule source, même pour une
    image d'essai."""
    global _tok
    if _tok is None:
        css = (REPO / "commun" / "tokens.css").read_text(encoding="utf-8")
        _tok = {k: tuple(int(v[i:i + 2], 16) for i in (1, 3, 5))
                for k, v in re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})\b", css)}
    return _tok


def _font(size: int, mono: bool = True):
    from PIL import ImageFont
    f = REPO / "commun" / "fonts" / ("azeret-mono.ttf" if mono else "chakra-petch-light.ttf")
    try:
        return ImageFont.truetype(str(f), size)
    except OSError:
        return ImageFont.load_default()


def _wrap(draw, text: str, font, width: int, lines: int) -> list[str]:
    out, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= width:
            cur = t
        else:
            out.append(cur)
            cur = w
            if len(out) >= lines:
                break
    if cur and len(out) < lines:
        out.append(cur)
    if len(out) == lines and " ".join(out) != text.strip():
        out[-1] = out[-1].rstrip(".,; ") + " …"
    return out


def stub_card(size: tuple[int, int], title: str, lines: list[tuple[str, str]], prompt: str, refs: list[Path],
              seed: int) -> "Image":
    """Une mire : le fond aux couleurs du thème, une trame qui dépend de la
    graine (deux graines, deux images), le modèle, les réglages, le prompt
    envoyé et les références en vignettes. Écrit « FACTICE »."""
    from PIL import Image, ImageDraw
    T = tokens()
    W, H = size
    img = Image.new("RGB", size, T["bg"])
    d = ImageDraw.Draw(img)
    rnd = random.Random(seed)
    # un dégradé et des disques, d'après la graine
    for y in range(0, H, 4):
        t = y / max(1, H - 1)
        c = tuple(int(T["panel"][i] * (1 - t) + T["verd-5"][i] * t) for i in range(3))
        d.rectangle([0, y, W, y + 4], fill=c)
    accents = [T["or"], T["grn2"], T["cy"], T["coral-2"], T["verd-3"]]
    for _ in range(7):
        r = rnd.randint(min(W, H) // 12, min(W, H) // 4)
        x, y = rnd.randint(0, W), rnd.randint(0, H)
        col = rnd.choice(accents)
        d.ellipse([x - r, y - r, x + r, y + r], outline=col, width=max(2, r // 18))
    step = max(24, min(W, H) // 24)
    for x in range(0, W, step):
        for y in range(0, H, step):
            d.point((x, y), fill=T["ink3"])
    s = min(W, H)
    pad = int(s * 0.05)
    big, mid, small = _font(max(18, s // 14)), _font(max(12, s // 42)), _font(max(11, s // 52), mono=False)
    tw = int(s * 0.18) if refs else 0
    # le bloc des réglages, sur un panneau : lisible quels que soient les disques
    key_w = int(d.textlength("M" * 12, font=mid))
    val_w = W - 2 * pad - key_w - (tw + pad if tw else 0)
    rows = [(k, _wrap(d, str(v), mid, val_w, 3)) for k, v in lines]
    lh = int(s // 42 * 1.5)
    block_h = int(s // 14 * 1.35) + int(s // 42 * 1.9) + lh * sum(len(r) for _, r in rows) + pad // 2
    d.rectangle([0, 0, W - (tw + pad if tw else 0) + pad // 2, pad + block_h], fill=T["panel"])
    d.text((pad, pad), "FACTICE", font=big, fill=T["or"])
    y = pad + int(s // 14 * 1.35)
    d.text((pad, y), title.upper(), font=mid, fill=T["ink"])
    y += int(s // 42 * 1.9)
    for k, vals in rows:
        d.text((pad, y), k.upper(), font=mid, fill=T["ink3"])
        for line in vals:
            d.text((pad + key_w, y), line, font=mid, fill=T["cy"])
            y += lh
    # le prompt envoyé, en bas, sur un voile
    body = _wrap(d, prompt, small, W - 2 * pad, 7)
    lh = int(s // 52 * 1.5)
    top = H - pad - lh * len(body) - pad // 2
    d.rectangle([0, top - pad // 2, W, H], fill=T["panel"])
    for k, line in enumerate(body):
        d.text((pad, top + k * lh), line, font=small, fill=T["ink2"])
    # les références, en vignettes à droite
    for k, p in enumerate(refs[:3]):
        try:
            with Image.open(p) as r:
                th = r.convert("RGB")
                th.thumbnail((tw, tw))
                x, yy = W - pad - th.width, pad + k * (tw + pad // 2)
                img.paste(th, (x, yy))
                d.rectangle([x - 1, yy - 1, x + th.width, yy + th.height], outline=T["or"], width=2)
                d.text((x, yy + th.height + 2), f"<image{k + 1}>", font=small, fill=T["or"])
        except OSError:
            continue
    return img


def stub_band(img, text: str) -> "Image":
    """L'image source, avec un bandeau « FACTICE · … » posé en bas."""
    from PIL import ImageDraw
    T = tokens()
    img = img.convert("RGBA") if img.mode == "RGBA" else img.convert("RGB")
    d = ImageDraw.Draw(img)
    s = min(img.size)
    f = _font(max(12, s // 42))
    lines = _wrap(d, "FACTICE · " + text, f, img.width - 2 * int(s * 0.04), 3)
    lh = int(max(12, s // 42) * 1.5)
    top = img.height - lh * len(lines) - int(s * 0.05)
    d.rectangle([0, top - int(s * 0.05), img.width, img.height], fill=T["panel"] + ((255,) if img.mode == "RGBA" else ()))
    for k, line in enumerate(lines):
        d.text((int(s * 0.04), top + k * lh), line, font=f, fill=T["or"] if k == 0 else T["ink2"])
    return img


def _stub_wait(ctx, label: str, secs: float = 2.4) -> None:
    """Le temps d'un rendu factice, avec sa progression : la page doit voir
    un travail en file, en cours, puis fini."""
    n = 8
    for k in range(n):
        ctx.check()
        ctx.progress(0.1 + 0.85 * k / n, f"{label} (factice)")
        time.sleep(secs / n)


def stub_generate(ctx, p: dict, refs: list[dict], prompt: str, out: Path) -> Path:
    m = MODELS[p["model"]]
    looks = [(_look(g, v) or {}).get("name", v) for g, v in (p.get("looks") or {}).items() if v]
    lines = [("modèle", m["name"] + (f" {p['variant']}" if p["model"] == "zimage" else "")),
             ("taille", f"{p['width']} × {p['height']} · {p['aspect']}"), ("graine", p["seed"])]
    if looks:
        lines.append(("réglages", " · ".join(looks)))
    if refs:
        lines.append(("références", " · ".join(r["title"] for r in refs)))
    if p.get("transparent"):
        lines.append(("fond", "transparent (RGBA natif de Qwen 2.1)"))
    _stub_wait(ctx, m["name"])
    card = stub_card((p["width"], p["height"]), "image d'essai — aucun modèle chargé", lines, prompt,
                     [r["path"] for r in refs], p["seed"])
    if p.get("transparent"):
        from PIL import Image, ImageDraw
        a = Image.new("L", card.size, 0)
        w, h = card.size
        ImageDraw.Draw(a).rounded_rectangle([w * 0.04, h * 0.03, w * 0.96, h * 0.97], radius=int(min(w, h) * 0.08), fill=255)
        card = card.convert("RGBA")
        card.putalpha(a)
    card.save(out)
    return out


def stub_edit(ctx, p: dict, src_path: Path, out: Path, prompt: str, refs: list[dict]) -> Path:
    from PIL import Image, ImageDraw, ImageFilter, ImageOps
    T = tokens()
    im = Image.open(src_path)
    im = im.convert("RGBA") if im.mode in ("RGBA", "LA") else im.convert("RGB")
    tool = p["tool"]
    _stub_wait(ctx, EDIT_TOOLS[tool]["name"], 1.6 if tool in ("matte", "upscale") else 2.4)
    if tool == "instruct":
        base = im.convert("RGB")
        tint = Image.new("RGB", base.size, T["cy"] if p["model"] == "qwen21" else T["coral-2"])
        if p.get("mask"):
            m = Image.open(mask_path(p["mask"])).convert("L").resize(base.size)
            res = Image.composite(Image.blend(base, tint, 0.45), base, m)
        else:
            res = Image.blend(base, tint, 0.18)
        for k, r in enumerate(refs[:2]):
            with Image.open(r["path"]) as ri:
                th = ri.convert("RGB")
                th.thumbnail((base.width // 5, base.width // 5))
                res.paste(th, (base.width - th.width - 12, 12 + k * (th.height + 12)))
        res = stub_band(res, f"{MODELS[p['model']]['name']} · {prompt}")
    elif tool == "matte":
        base = im.convert("RGB")
        m = Image.new("L", base.size, 0)
        w, h = base.size
        ImageDraw.Draw(m).ellipse([w * 0.18, h * 0.08, w * 0.82, h * 0.98], fill=255)
        m = m.filter(ImageFilter.GaussianBlur(min(w, h) * 0.01))
        res = Image.composite(base, Image.new("RGB", base.size, (0, 0, 0)), m).convert("RGBA")
        res.putalpha(m)
        res = stub_band(res, "détourage BiRefNet : une ellipse à la place du vrai masque")
    elif tool == "upscale":
        f = p["factor"]
        res = stub_band(im.convert("RGB").resize((im.width * f, im.height * f), Image.LANCZOS),
                        f"SeedVR2 ×{f} : ici un simple Lanczos")
    elif tool == "refine":
        big = im.convert("RGB").resize((im.width * 2, im.height * 2), Image.LANCZOS).filter(ImageFilter.UnsharpMask(2, 80, 2))
        res = stub_band(big, f"Z-Image affine ×2 (débruitage {p['denoise']}) : ici Lanczos + netteté")
    elif tool == "angle":
        base = ImageOps.mirror(im.convert("RGB"))
        w, h = base.size
        res = base.transform(base.size, Image.AFFINE, (1, 0.12, -0.06 * h, 0, 1, 0), resample=Image.BICUBIC)
        res = stub_band(res, f"angle : {angle_prompt(p)}")
    else:
        raise RuntimeError(tool)
    res.save(out)
    return out


# ── les travaux ─────────────────────────────────────────────
def _title(prompt: str, n: int = 8) -> str:
    words = prompt.replace("\n", " ").split()
    t = " ".join(words[:n])
    return (t[:70] + "…") if len(t) > 70 or len(words) > n else t


def run_generate(ctx) -> dict:
    p = ctx.params
    t0 = time.time()
    model = p["model"]
    ctx.progress(0.02, "prépare")
    refs = [_ref(r) for r in p.get("refs", [])]
    comp = compose(model, p["prompt"], p.get("looks"), refs, transparent=p.get("transparent", False))
    out = ctx.workdir / "out.png"
    if backend() == "stub":
        stub_generate(ctx, p, refs, comp["prompt"], out)
        model_id = model + (f"-{p['variant']}" if model == "zimage" else "") + "-factice"
    else:
        names = []
        for k, r in enumerate(refs):
            local = ctx.workdir / f"ref{k + 1}.png"
            if model == "krea2":
                _cf().krea2.prepare(_rgb(r["path"], local), local)
            else:
                _rgb(r["path"], local)
            names.append(ctx.comfy.upload(local))
        wf = graph_generate(p, names, comp["prompt"])
        ctx.progress(0.1, f"{MODELS[model]['name']} rend {p['width']}×{p['height']}")
        out = ctx.run_graph(wf, label=MODELS[model]["name"])[0]
        model_id = model + (f"-{p['variant']}" if model == "zimage" else "")
    secs = round(time.time() - t0, 1)
    it = ctx.add(out, kind="image", title=_title(p["prompt"]), prompt=comp["prompt"],
                 params={"job": "image.generate", **p}, parents=[r["item"] for r in refs],
                 origin={"model": model_id, "backend": backend()}, extra={"render_s": secs})
    return {"note": f"{MODELS[model]['name']} · {secs} s", "seconds": secs, "item": it["id"]}


def run_edit(ctx) -> dict:
    from PIL import Image
    p = ctx.params
    t0 = time.time()
    src = library.get(p["source"])
    if not src:
        raise RuntimeError("l'image source a quitté la bibliothèque")
    src_path = library.path_of(src)
    with Image.open(src_path) as im:
        w0, h0 = im.size
    tool = p["tool"]
    parents = [src["id"]]
    name = src.get("title") or src["id"]
    name = name if len(name) <= 42 else name[:40].rstrip() + "…"  # les éditions en chaîne ne s'allongent pas sans fin
    title = f"{name} · {EDIT_TOOLS[tool]['name'].lower()}"
    prompt_sent = ""
    refs = [_ref(r) for r in p.get("refs", [])] if tool == "instruct" else []
    parents += [r["item"] for r in refs]
    if tool == "instruct":
        comp = compose(p["model"], p["prompt"], p.get("looks"), refs, mode="edit", keep_face=p.get("keep_face"))
        prompt_sent = comp["prompt"]
        title = f"{name} · {_title(p['prompt'], 5)}"
        model_id = p["model"] + "-edit" + ("-zone" if p.get("mask") else "")
    elif tool == "refine":
        prompt_sent = p.get("prompt") or ""
        model_id = "zimage-refine"
    elif tool == "angle":
        prompt_sent = angle_prompt(p)
        title = f"{name} · {dict(ANGLE_AZIMUTH).get(p['azimuth'], p['azimuth'])}"
        model_id = "qwen-edit-2511-angles"
    else:
        model_id = {"matte": "birefnet", "upscale": "seedvr2"}[tool]
        if tool == "upscale":
            title = f"{name} · ×{p['factor']}"
    ctx.progress(0.02, "prépare")
    out = ctx.workdir / "out.png"
    if backend() == "stub":
        stub_edit(ctx, p, src_path, out, prompt_sent, refs)
        model_id += "-factice"
    else:
        out = _real_edit(ctx, p, src_path, (w0, h0), refs, prompt_sent)
    secs = round(time.time() - t0, 1)
    it = ctx.add(out, kind="image", title=title, prompt=prompt_sent, params={"job": "image.edit", **p},
                 parents=parents, origin={"model": model_id, "backend": backend()}, extra={"render_s": secs})
    return {"note": f"{EDIT_TOOLS[tool]['name']} · {secs} s", "seconds": secs, "item": it["id"]}


def _real_edit(ctx, p: dict, src_path: Path, size: tuple[int, int], refs: list[dict], prompt: str) -> Path:
    """Le câblage réel d'une édition : pas encore essayé (voir l'étude §8)."""
    from PIL import Image
    cf = _cf()
    tool = p["tool"]
    w0, h0 = size
    if tool == "instruct":
        src_in = ctx.workdir / "src.png"
        _rgb(src_path, src_in)
        box = mask = None
        if p.get("mask"):
            # une zone : on édite la boîte qui l'entoure, à au moins 768 px,
            # puis on recolle par le masque (paste_zone)
            mask = Image.open(mask_path(p["mask"])).convert("L").resize((w0, h0))
            box = zone_box(mask, (w0, h0))
            crop = Image.open(src_in).crop(box)
            k = max(1.0, 768 / max(crop.size))
            crop.resize((int(crop.width * k), int(crop.height * k)), Image.LANCZOS).save(src_in)
        paths = [src_in] + [r["path"] for r in refs]
        names = []
        for k, path in enumerate(paths):
            local = ctx.workdir / f"in{k + 1}.png"
            if p["model"] == "krea2":
                cf.krea2.prepare(_rgb(path, local), local)
            else:
                _rgb(path, local)
            names.append(ctx.comfy.upload(local))
        with Image.open(src_in) as im:
            wf, osz = graph_instruct(p, im.size, names, prompt)
        ctx.progress(0.1, f"{MODELS[p['model']]['name']} édite {osz[0]}×{osz[1]}")
        out = ctx.run_graph(wf, label=MODELS[p["model"]]["name"])[0]
        if box:
            out = paste_zone(Image.open(src_path), Image.open(out), mask, box, ctx.workdir / "zone.png")
        return out
    local = ctx.workdir / "src.png"
    if tool == "upscale":
        with Image.open(src_path) as im:
            # SeedVR2 restaure une image déjà à la taille voulue : elle est
            # agrandie en Lanczos d'abord (gabarit officiel, upscale.py).
            im.convert("RGB").resize((w0 * p["factor"], h0 * p["factor"]), Image.LANCZOS).save(local)
    else:
        _rgb(src_path, local)
    wf = edit_graph(p, size, [ctx.comfy.upload(local)], prompt)
    ctx.progress(0.1, EDIT_TOOLS[tool]["name"])
    out = ctx.run_graph(wf, prefix="mask" if tool == "matte" else "out", label=EDIT_TOOLS[tool]["name"])[0]
    if tool == "matte":
        out = _apply_matte(local, out, ctx.workdir / "matte.png")
    return out


def _apply_matte(src: Path, mask_file: Path, dest: Path) -> Path:
    """L'image en RVBA, l'alpha tiré du masque BiRefNet. La polarité du
    masque n'est pas documentée : on la lit sur l'image, comme Character
    Factory (`comfy.remove_background`) — le pourtour est du fond, il doit
    sortir transparent. Le RVB du fond est mis à zéro : les vignettes (sans
    alpha) le montrent noir, pas avec l'ancien décor."""
    from PIL import Image, ImageChops
    im = Image.open(src).convert("RGB")
    m = Image.open(mask_file).convert("L").resize(im.size, Image.LANCZOS)
    w, h = m.size
    px = m.load()
    rim = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)] + \
          [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    if sum(rim) / len(rim) > 127:
        m = ImageChops.invert(m)
    rgba = Image.composite(im, Image.new("RGB", im.size, (0, 0, 0)), m).convert("RGBA")
    rgba.putalpha(m)
    rgba.save(dest)
    return dest


# ── les routes ──────────────────────────────────────────────
def _submit(kind: str, params: dict, title: str, pin: str | None) -> dict:
    return jobs.public(jobs.submit(kind, params, title=title, tool="image", pin=pin))


def _cap_generate(p: dict) -> str:
    if p["model"] == "zimage":
        return f"zimage:{p.get('variant', 'turbo')}"
    if p["model"] == "krea2" and p.get("refs"):
        return "krea2:edit"
    return p["model"]


def _cap_edit(p: dict) -> str:
    if p["tool"] == "instruct":
        return "krea2:edit" if p["model"] == "krea2" else "qwen21"
    return p["tool"]


# la famille de modèles de chaque travail, pour la file (core/jobs.py) : les
# noms de FAMILY_GB (Character_Factory/factory/memory.py) ; SeedVR2 n'y est pas
EDIT_FAMILY = {"refine": "zimage", "angle": "qwenedit", "matte": "birefnet", "upscale": "seedvr2"}


def _family_generate(p: dict) -> str:
    return p.get("model") or "?"


def _family_edit(p: dict) -> str:
    return p.get("model") or "?" if p.get("tool") == "instruct" else EDIT_FAMILY.get(p.get("tool"), "?")


def _uses_comfy(p: dict) -> bool:
    return backend() == "comfyui"   # le moteur factice ne charge rien : aucune règle de mémoire


def api_models(req) -> dict:
    """Ce que la page affiche : modèles, tailles, réglages photo, outils
    d'édition, le moteur, et ce que chaque machine sait faire."""
    try:
        av = availability()
        av_err = ""
    except Exception as e:
        av, av_err = {}, str(e)
    models = []
    for mid, m in MODELS.items():
        entry = {"id": mid, "name": m["name"], "k": m["k"], "role": m["role"], "refs": m["refs"],
                 "refs_why": m.get("refs_why", ""),
                 "sizes": {q: {a: list(wh) if wh else None for a, wh in t.items()} for q, t in m["sizes"].items()},
                 "quality": [{"id": q, "label": m["quality_labels"][q]} for q in m["sizes"]]}
        if "variants" in m:
            entry["variants"] = [{"id": k, "label": v["label"]} for k, v in m["variants"].items()]
        models.append(entry)
    return {
        "backend": backend(), "models": models, "aspects": list(ASPECTS),
        "looks": [{"id": g, "label": LOOKS[g]["label"], "about": LOOKS[g].get("about", ""),
                   "items": [dict(x) for x in LOOKS[g]["items"]]} for g in LOOK_ORDER],
        "edit_tools": [{"id": k, **v} for k, v in EDIT_TOOLS.items()],
        "angles": {"azimuth": ANGLE_AZIMUTH, "elevation": ANGLE_ELEVATION, "distance": ANGLE_DISTANCE},
        "availability": {cap: {"on": [jobs.machine_of(e) for e in v["on"]], "missing": v["missing"]}
                         for cap, v in av.items()},
        "availability_error": av_err, "cf": cf_available(),
    }


def api_compose(req) -> dict:
    d = req.json()
    try:
        mode = d.get("mode", "generate")
        model = d.get("model")
        if model not in MODELS:
            raise ValueError(f"modèle inconnu : {model}")
        refs = [_ref(r) for r in _refs(d.get("refs"), 4)]
        out = compose(model, d.get("prompt") or "", _looks(d.get("looks")), refs, mode=mode,
                      keep_face=bool(d.get("keep_face")), transparent=bool(d.get("transparent")))
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    return out


def api_generate(req) -> dict:
    d = req.json()
    try:
        p = check_generate(d)
        count = _int(d.get("count", 1), 1, 8, "nombre d'images")
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    if d.get("dry"):
        refs = [_ref(r) for r in p["refs"]]
        comp = compose(p["model"], p["prompt"], p["looks"], refs, transparent=p.get("transparent", False))
        out = {"params": p, "prompt": comp["prompt"], "notes": comp["notes"], "backend": backend()}
        if cf_available():
            out["graph"] = graph_generate(p, [f"ref{k + 1}.png" for k in range(len(refs))], comp["prompt"])
        return out
    pin = _pin_for(_cap_generate(p))
    batch = _batch()
    out = []
    for k in range(count):
        pk = {**p, "seed": (p["seed"] + k) % MAX_SEED, "batch": batch}
        out.append(_submit("image.generate", pk, f"{MODELS[p['model']]['name']} · {_title(p['prompt'], 6)}", pin))
    return {"batch": batch, "jobs": out}


def _batch() -> str:
    """Une demande (« 4 images », « 4 variations ») : ses travaux et ses
    images portent le même `batch` dans leurs réglages — la colonne de la
    page les range ensemble. Relancer une recette en fait une autre
    (`check_*` ne le recopie pas)."""
    return "b-" + secrets.token_hex(4)


def api_edit(req) -> dict:
    d = req.json()
    try:
        p = check_edit(d)
        count = _int(d.get("count", 1), 1, 4, "nombre d'images")
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    src = library.get(p["source"])
    if d.get("dry"):
        info = {"params": p, "backend": backend()}
        size = (src.get("width") or 1024, src.get("height") or 1024)
        if not cf_available():
            return info
        if p["tool"] == "instruct":
            refs = [_ref(r) for r in p["refs"]]
            comp = compose(p["model"], p["prompt"], p["looks"], refs, mode="edit", keep_face=p["keep_face"])
            g, osz = graph_instruct(p, size, [f"in{k + 1}.png" for k in range(1 + len(refs))], comp["prompt"])
            info.update(prompt=comp["prompt"], notes=comp["notes"], graph=g, size=osz)
        else:
            prompt = angle_prompt(p) if p["tool"] == "angle" else p.get("prompt", "")
            info.update(prompt=prompt, graph=edit_graph(p, size, ["src.png"], prompt))
        return info
    pin = _pin_for(_cap_edit(p))
    name = EDIT_TOOLS[p["tool"]]["name"]
    batch = _batch()
    out = []
    n = count if p["tool"] in ("instruct", "angle", "refine") else 1
    for k in range(n):
        pk = {**p, "seed": (p["seed"] + k) % MAX_SEED, "batch": batch}
        out.append(_submit("image.edit", pk, f"{name} · {src.get('title') or src['id']}", pin))
    return {"batch": batch, "jobs": out}


def api_redo(req) -> dict:
    """Relance la recette d'une image : la même (`variations` absent ou 0),
    ou `variations` fois avec d'autres graines."""
    d = req.json()
    it = library.get(d.get("item") or "")
    if not it:
        raise HttpError(404, "image introuvable")
    rec = dict(it.get("params") or {})
    kind = rec.pop("job", None)
    if kind not in ("image.generate", "image.edit"):
        raise HttpError(409, "cette image n'a pas de recette de l'outil Image (déposée, ou faite ailleurs)")
    try:
        p = check_generate(rec) if kind == "image.generate" else check_edit(rec)
        n = _int(d.get("variations", 0), 0, 8, "variations")
    except ValueError as e:
        raise HttpError(400, f"la recette ne passe plus : {e}") from e
    pin = _pin_for(_cap_generate(p) if kind == "image.generate" else _cap_edit(p))
    title = (it.get("title") or it["id"])[:60]
    batch = _batch()
    if not n:
        return {"batch": batch, "jobs": [_submit(kind, {**p, "batch": batch}, f"Refaire · {title}", pin)]}
    base = random.randrange(MAX_SEED)
    return {"batch": batch, "jobs": [_submit(kind, {**p, "seed": (base + k) % MAX_SEED, "batch": batch},
                                             f"Variation · {title}", pin) for k in range(n)]}


def _register_job(kind: str, fn, title: str, family) -> None:
    """`family` et `gpu` (la règle de mémoire de la file) n'existent que dans
    le socle qui les porte ; un socle plus ancien enregistre sans eux."""
    import inspect
    extra = {"family": family, "gpu": _uses_comfy} if "family" in inspect.signature(jobs.register).parameters else {}
    jobs.register(kind, fn, lane="image", title=title, **extra)


def register(app) -> None:
    _register_job("image.generate", run_generate, "Image", _family_generate)
    _register_job("image.edit", run_edit, "Édition", _family_edit)
    app.route("GET", "/api/image/models", api_models)
    app.route("POST", "/api/image/compose", api_compose)
    app.route("POST", "/api/image/generate", api_generate)
    app.route("POST", "/api/image/edit", api_edit)
    app.route("POST", "/api/image/redo", api_redo)


# ── le contrôle sans GPU ────────────────────────────────────
def selftest(call, ok) -> None:
    from io import BytesIO
    from PIL import Image

    st, m = call("GET", "/api/image/models")
    ok(st == 200 and [x["id"] for x in m.get("models", [])] == ["zimage", "qwen21", "krea2"], f"image : trois modèles ({st})")
    ok(all(len(g["items"]) >= 4 for g in m.get("looks", [])) and len(m.get("looks", [])) == 5,
       "image : caméra, objectif, ouverture, pellicule, lumière remplis")
    ok(all(x.get("src") for g in m.get("looks", []) for x in g["items"]), "image : chaque pastille dit sa source")
    sizes = {x["id"]: x["sizes"] for x in m.get("models", [])}
    ok(sizes.get("zimage", {}).get("1024", {}).get("16:9") == [1280, 720], "image : Z-Image 16:9 = 1280×720 (Space officiel)")
    ok(sizes.get("qwen21", {}).get("2k", {}).get("9:16") == [1536, 2752] and sizes["qwen21"]["2k"]["21:9"] is None,
       "image : Qwen 2K = liste du README, sans 21:9")
    ok(all(v % 32 == 0 for wh in sizes.get("qwen21", {}).get("1", {}).values() for v in wh), "image : Qwen 1 Mpx au pas de 32")
    ok(all(v % 16 == 0 for q in sizes.get("krea2", {}).values() for wh in q.values() for v in wh), "image : Krea au pas de 16")
    ok(len(m.get("angles", {}).get("azimuth", [])) == 8, "image : 8 azimuts d'angle")
    ok(any(t["id"] == "extend" and t.get("off") for t in m.get("edit_tools", [])), "image : « Étendre » dit pourquoi il est éteint")

    look = {g["id"]: g["items"][0]["id"] for g in m.get("looks", [])}
    first = {g["id"]: g["items"][0] for g in m.get("looks", [])}
    st, c = call("POST", "/api/image/compose", {"model": "krea2", "prompt": "a woman reading in a café", "looks": look})
    ok(st == 200 and all(first[g]["krea"].rstrip(".") in c["prompt"] for g in first if first[g].get("krea")),
       f"image : le prompt Krea porte les phrases sans marque ({c})")
    ok(st == 200 and "Sony" not in c["prompt"], "image : Krea ne reçoit pas de marque")
    st, c = call("POST", "/api/image/compose", {"model": "zimage", "prompt": "a woman", "looks": look})
    ok(st == 200 and "Sony A7 IV" in c["prompt"] and c["notes"], f"image : Z-Image reçoit le matériel, et la note pellicule/numérique ({c})")
    st, c = call("POST", "/api/image/compose", {"model": "zimage", "prompt": "x", "looks": {"film": "n-existe-pas"}})
    ok(st == 400, "image : un réglage inconnu est refusé")
    st, c = call("POST", "/api/image/compose", {"model": "qwen21", "prompt": "A red apple", "transparent": True})
    ok(st == 200 and c["prompt"].startswith("This is an RGBA format image with transparency. A red apple.")
       and c["prompt"].endswith("transparent background."), f"image : Qwen, fond transparent au gabarit officiel ({c})")

    # une image et un élément dans la bibliothèque, pour les références
    buf = BytesIO()
    Image.new("RGB", (96, 64), (120, 110, 90)).save(buf, "PNG")
    st, up = call("PUT", "/api/library/upload?name=src.png&title=Source&tool=image", raw=buf.getvalue())
    iid = up.get("id")
    st, el = call("POST", "/api/elements", {"title": "Maren", "type": "character", "refs": [{"item": iid, "role": "face"}]})
    eid = el.get("id")
    st, c = call("POST", "/api/image/compose", {"model": "qwen21", "prompt": "she sits at a table", "refs": [{"item": eid}]})
    ok(st == 200 and "<image1> shows the face of Maren." in c["prompt"] and c["notes"], f"image : Qwen présente <image1> ({c})")
    st, c = call("POST", "/api/image/compose", {"model": "qwen21", "prompt": "<image1> at a table", "refs": [{"item": eid}]})
    ok(st == 200 and "shows" not in c["prompt"], "image : une <image1> déjà nommée n'est pas répétée")

    bad = [({"model": "zimage", "prompt": "x", "refs": [iid]}, "Z-Image refuse une référence"),
           ({"model": "dall-e", "prompt": "x"}, "modèle inconnu refusé"),
           ({"model": "krea2", "prompt": ""}, "prompt vide refusé"),
           ({"model": "krea2", "prompt": "x", "aspect": "5:4"}, "format inconnu refusé"),
           ({"model": "krea2", "prompt": "x", "quality": "4"}, "Krea 4 Mpx refusé"),
           ({"model": "qwen21", "prompt": "x", "quality": "2k", "aspect": "21:9"}, "Qwen 2K 21:9 refusé (non documenté)"),
           ({"model": "krea2", "prompt": "x", "refs": [iid, iid, iid]}, "Krea : 3 références refusées"),
           ({"model": "qwen21", "prompt": "x", "refs": ["ima-rien"]}, "référence introuvable refusée")]
    for body, msg in bad:
        st, r = call("POST", "/api/image/generate", {**body, "dry": True})
        ok(st == 400, f"image : {msg} ({st} {r})")
    # une demande de deux images : deux travaux, un même `batch` (le contrôle
    # n'a pas de voie image : ils attendent, on les retire aussitôt)
    st, r = call("POST", "/api/image/generate", {"model": "krea2", "prompt": "a lighthouse", "count": 2, "seed": 5})
    js = (r or {}).get("jobs") or []
    ok(st == 200 and len(js) == 2 and r.get("batch") and all(j["params"].get("batch") == r["batch"] for j in js)
       and [j["params"]["seed"] for j in js] == [5, 6], f"image : une demande = un batch, graines qui se suivent ({st} {str(r)[:200]})")
    for j in js:
        call("POST", f"/api/jobs/{j['id']}/cancel")
    st, r = call("POST", "/api/image/edit", {"source": iid, "tool": "extend", "dry": True})
    ok(st == 400 and "documentée" in r.get("error", ""), "image : « Étendre » refusé avec sa raison")
    st, r = call("POST", "/api/image/edit", {"source": iid, "tool": "instruct", "model": "zimage", "prompt": "x", "dry": True})
    ok(st == 400, "image : Z-Image refusé en consigne, avec la raison")

    # un masque de zone : un PNG en data URL
    mb = BytesIO()
    mk = Image.new("L", (96, 64), 0)
    mk.paste(255, (30, 20, 60, 50))
    mk.save(mb, "PNG")
    durl = "data:image/png;base64," + base64.b64encode(mb.getvalue()).decode()
    st, r = call("POST", "/api/image/edit", {"source": iid, "tool": "instruct", "model": "krea2", "prompt": "a red hat",
                                             "mask": durl, "dry": True})
    ok(st == 200 and MASK_RX.fullmatch(r.get("params", {}).get("mask", "")), f"image : une zone peinte est gardée ({st} {str(r)[:200]})")
    ok(zone_box(mk, (96, 64), least=16) == (22, 12, 67, 57), "image : la boîte de zone, élargie, reste dans l'image")
    # une zone reprise d'une image réutilisée : son nom de masque suffit
    zone = (r or {}).get("params", {}).get("mask", "")
    st, r = call("POST", "/api/image/edit", {"source": iid, "tool": "instruct", "model": "qwen21", "prompt": "a blue hat",
                                             "mask": zone, "dry": True})
    ok(st == 200 and r.get("params", {}).get("mask") == zone, f"image : Réutiliser une édition reprend sa zone ({st})")

    # le fil (29/09) : la page charge le composant commun ; Recréer relance la recette
    st, page = call("GET", "/image/")
    ok(st == 200 and b"../commun/fil.css" in page and b'id="fil"' in page and b'id="pbar"' in page and b'class="rail"' not in page,
       "image : la page porte le fil commun et la barre de prompt flottante, sans colonne")
    ijs = (REPO / "image" / "image.js").read_text(encoding="utf-8")
    ok("createFil(" in ijs and "image/redo" in ijs and "reuse" in ijs, "image : image.js passe par le fil, Réutiliser, Recréer")
    css = re.sub(r"/\*.*?\*/", "", (REPO / "image" / "image.css").read_text(encoding="utf-8"), flags=re.S)
    ok(not re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", css), "image.css : aucune couleur en dur (tokens.css seulement)")
    ok(not re.search(r"(?<![\w-])border(-(top|right|bottom|left))?\s*:(?!\s*(none|0)\b)", css), "image.css : des filets, jamais de bordures")
    import tempfile
    tmp = Path(tempfile.mkdtemp()) / "phare.png"
    Image.new("RGB", (48, 64), (10, 20, 30)).save(tmp)
    rec = check_generate({"model": "krea2", "prompt": "a lighthouse", "aspect": "3:4", "seed": 11, "looks": {"lens": "35"}})
    made = library.add_file(tmp, kind="image", title="phare", prompt="a lighthouse", params={"job": "image.generate", **rec},
                            origin={"tool": "image", "model": "krea2-factice"})
    st, r1 = call("POST", "/api/image/redo", {"item": made["id"], "variations": 1})
    j1 = (r1 or {}).get("jobs") or []
    ok(st == 200 and len(j1) == 1 and j1[0]["params"]["seed"] != 11 and j1[0]["params"]["prompt"] == "a lighthouse"
       and j1[0]["params"]["aspect"] == "3:4" and j1[0]["params"]["looks"] == {"lens": "35"},
       f"image : Recréer = la même recette, une nouvelle graine ({st} {str(r1)[:200]})")
    st, r0 = call("POST", "/api/image/redo", {"item": made["id"]})
    j0 = (r0 or {}).get("jobs") or []
    ok(st == 200 and len(j0) == 1 and j0[0]["params"]["seed"] == 11, "image : Recréer à l'identique = la même graine")
    st, r4 = call("POST", "/api/image/redo", {"item": made["id"], "variations": 4})
    j4 = (r4 or {}).get("jobs") or []
    ok(st == 200 and len(j4) == 4 and len({j["params"]["seed"] for j in j4}) == 4, "image : 4 variations, 4 graines")
    for j in j1 + j0 + j4:
        call("POST", f"/api/jobs/{j['id']}/cancel")
    st, _ = call("POST", "/api/image/redo", {"item": iid})
    ok(st == 409, f"image : Recréer une image déposée (sans recette) est refusé avec la raison ({st})")

    if not cf_available():
        print("  (Character Factory absent : graphes Krea 2 / Qwen 2.1 non construits)")
        return
    for model, extra in (("zimage", {}), ("zimage", {"variant": "base"}), ("qwen21", {}), ("qwen21", {"refs": [{"item": eid}, iid]}),
                         ("krea2", {}), ("krea2", {"refs": [iid]}), ("krea2", {"realism": False})):
        st, r = call("POST", "/api/image/generate", {"model": model, "prompt": "a lighthouse at dusk", "aspect": "16:9",
                                                     "seed": 7, "looks": look, "dry": True, **extra})
        g = (r or {}).get("graph") or {}
        outs = [n for n in g.values() if (n.get("_meta") or {}).get("title") == "OUT"]
        text = json.dumps(g)
        ok(st == 200 and len(outs) == 1 and "{{" not in text and "a lighthouse at dusk" in text,
           f"image : graphe {model} {extra} ({st} {str(r)[:300]})")
        if model == "zimage" and st == 200:
            lat = next(n for n in g.values() if n["class_type"] == "EmptySD3LatentImage")["inputs"]
            ok((lat["width"], lat["height"]) == (1280, 720), f"image : Z-Image à la taille du Space ({lat})")
        if model == "krea2" and extra.get("refs") and st == 200:
            ok(any(n["class_type"] == "Krea2EditModelPatch" for n in g.values()), "image : Krea avec référence = Identity Edit v1.2")
    for body, msg in (({"tool": "instruct", "model": "qwen21", "prompt": "make it night", "refs": [eid]}, "Qwen édite"),
                      ({"tool": "instruct", "model": "krea2", "prompt": "make it night", "keep_face": True}, "Krea édite"),
                      ({"tool": "matte"}, "détourer"), ({"tool": "upscale", "factor": 2}, "agrandir"),
                      ({"tool": "refine", "denoise": 0.25}, "affiner"),
                      ({"tool": "angle", "azimuth": "back view", "elevation": "eye-level shot", "distance": "wide shot"}, "angle")):
        st, r = call("POST", "/api/image/edit", {"source": iid, "seed": 3, "dry": True, **body})
        ok(st == 200 and r.get("graph"), f"image : édition {msg} ({st} {str(r)[:300]})")
        if body.get("model") == "qwen21" and st == 200:
            ok(r["graph"]["12"]["inputs"]["latent_image"] == ["6", 2], "image : Qwen édite sur le latent de sa source")
    ok(qwen_edit_size(1024, 1024, 1024) == (1024, 1024) and qwen_edit_size(1152, 2048, 1536) == (1152, 2048),
       "image : taille d'édition Qwen = celle du nœud")
