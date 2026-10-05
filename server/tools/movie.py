"""Vidéo (ex « Movie Creator », renommé par Cal le 29/09) : des plans vidéo
avec MiniMax H3, en local, son compris. Le chemin (`movie/`), les travaux
(`movie.*`) et les routes (`/api/movie/*`) gardent leur nom.

Trois travaux dans la file commune, comme les trois modes de la page :

  movie.t2v  Texte        MiniMaxH3ImageToVideo sans image (poids fl2va).
  movie.i2v  Images       MiniMaxH3ImageToVideo (fl2va) : une première image,
                          une dernière, ou les deux ; le plan part de l'une et
                          finit sur l'autre.
  movie.r2v  Références   MiniMaxH3ReferenceToVideo (poids ref2va) : des
                          images, des éléments (un personnage : les images
                          que le préréglage demande, voir plus bas), des
                          vidéos et des sons, chacun nommé `@nom` dans le
                          prompt ; les mentions deviennent les étiquettes H3.

H3 rend l'image et le son ensemble : le son est gardé.

Deux préréglages, LES réglages de l'outil (Cal, 30/09 : sa recette,
RECETTE-DRAFT-QUALITE.md, et le graphe de ses scripts test-meteorite*.py,
repris dans server/workflows/h3_recette.json) — tout le reste est avancé :

  brouillon  768 × 320 puis l'agrandisseur latent → 1536 × 640, deux étages,
             8 pas ; un personnage donne sa planche « corps 3 vues, visage
             masqué » et ses gros plans du visage (≈ 6 min 46 s chez Cal, 192 images).
  qualite    1920 × 800, un étage, 8 pas ; un personnage donne les 5 images
             de la méthode « .char » (visage face, visage 3/4, tenue haut,
             tenue bas, corps de dos) (≈ 16 min chez Cal, 192 images).

La recette tourne sur les ComfyUI :8188 (ComfyUI 0.37.2 : les nœuds Turbo,
BlockSparseAttention, l'agrandisseur latent y sont ; ComfyUI-H3TEST :8189 ne
les a pas) : la voie `h3` pointe vers eux (réglage `lanes.h3`).

D'où vient chaque réglage (le détail : docs/etudes/movie.md) :
  - le graphe : la recette de Cal ci-dessus ; les références vidéo et son
    suivent GRAPH_MAP.md de H3 Studio (LoadVideo → GetVideoComponents, LoadAudio) ;
  - 24 i/s, la grille 17k+5, 124 à 362 images : comfy_extras/nodes_minimax_h3.py
    (FPS = 24 ; « trained range is ~124-362 ») ; le banc écrivait 25 i/s,
    ce qui raccourcit l'image sous un son resté à 24 ;
  - les toiles : celles de H3 Studio (docs/GRAPH_MAP.md), le 21:9 exact du
    banc de Cal (R0, R5), le plafond 768 × 1344 de la note officielle ;
  - les limites des références : le nœud (9 images, 3 vidéos, 3 sons,
    vidéos de 2 à 15 s) et H3 Studio (12 fichiers, 15 s par type) ;
  - les prompts : les guides officiels MiniMax (VIDEO_PROMPT_WRITING_GUIDE
    base et ref) et leur résumé dans corpus/h3_*style_rules.md de H3 Studio ;
  - le temps estimé : les rendus mesurés par Cal (DRAFT, Q1080), mis à
    l'échelle par la forme d'un ajustement sur cinq rendus de DGX1 (R0, R3,
    R5, banc i2v, banc ref2v), puis les rendus H3 de l'outil.

Des morceaux viennent de H3 Studio (github.com/underworldhistory1-ctrl/
minimax-h3-higgsfield, licence MIT, Copyright (c) 2026 Charles Mod) : la
forme des définitions et des marqueurs de rétention par rôle, la règle
« chaque référence est mentionnée », le câblage des références vidéo et
son, les toiles et les durées. Réécrits ici en Python ; la mention de
licence MIT de ce projet s'applique à ces morceaux.

Deux moteurs (réglage `movie_engine`) :

  factice  le défaut. Décision de Cal du 28/09 au soir : l'UX et l'UI
           d'abord, le câblage d'H3 après (il l'a déjà avancé ailleurs).
           Le travail tourne sur la voie `cpu` et fabrique une vraie vidéo
           d'essai (ffmpeg testsrc2, les images posées dessus, un bip),
           rangée dans la bibliothèque avec sa recette : toute la page se
           teste de bout en bout sans GPU. Le graphe H3 est tout de même
           construit, et rangé dans la recette.
  h3       le câblage ci-dessous, voie `h3` : rendus réels le 30/09 sur
           DGX2 (les trois modes, références image / vidéo / son,
           annulation, les deux préréglages avec le personnage d'essai de Cal).

Une instance H3 à la demande (ComfyUI-H3TEST, port `h3_service_port`, 8189)
reste gérée si la voie en déclare une : arrêtée au repos, démarrée par le
gardien dès qu'un travail H3 attend et qu'aucune instance ne répond
(systemctl, en local ou par ssh sur le câble direct), arrêtée après
`h3_idle_minutes` sans rendu — seulement une instance qu'il a démarrée. Les
ComfyUI :8188 ne sont jamais démarrés ni arrêtés ici. Avant chaque rendu, la
mémoire libre de la machine est lue ; sous `h3_min_free_gb`, on décharge
l'instance, le modèle de texte d'Ollama, puis l'autre ComfyUI de la machine
s'il ne calcule pas, et on refuse s'il manque encore de la place.
"""

from __future__ import annotations

import base64
import json
import math
import os
import random
import re
import socket
import struct
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from core import config, jobs, library, machines
from core.comfy import Comfy, ComfyError, fill
from core.http import HttpError

WF_DIR = config.REPO / "server" / "workflows"


def engine() -> str:
    return "h3" if config.get("movie_engine", "factice") == "h3" else "factice"


# ── ce que dit le code du nœud (comfy_extras/nodes_minimax_h3.py) ──
FPS = 24
CANVAS_MULTIPLE = 32
BASE_SHORT_EDGE = 768
MAX_PIXELS = 768 * 1344
# toute la grille 17k+5 dans la plage entraînée : « Frame count at 24 fps, snapped up to the
# model's 17k+5 grid (124 = ~5s; trained range is ~124-362) » (le nœud, relu le 29/09) —
# les pas du curseur de durée (Cal, 29/09 : « on veut un curseur pour la durée ») ; H3 Studio
# n'en proposait que cinq (124, 175, 226, 294, 362)
FRAMES = tuple(range(124, 363, 17))
LIMITS = {"image": 9, "video": 3, "audio": 3, "files": 12, "seconds": 15.0, "min_seconds": 2.0}

MODES = {
    "t2v": {"label": "Texte", "sub": "le prompt seul", "workflow": "h3_recette.json", "weights": "fl2va"},
    "i2v": {"label": "Images", "sub": "début · fin", "workflow": "h3_recette.json", "weights": "fl2va"},
    "r2v": {"label": "Références", "sub": "images · vidéos · sons", "workflow": "h3_recette.json", "weights": "ref2va"},
}
UNETS = {
    "fl2va": [
        {"f": "minimax_h3_fl2va_pruned_int8_convrot.safetensors", "nom": "fl2va élagué int8", "defaut": True,
         "note": "le modèle du banc H3 et du gabarit officiel ; la recette de Cal ne nomme que le ref2va"},
        {"f": "minimax_h3_fl2va_int8_convrot.safetensors", "nom": "fl2va complet int8 (34 Go)"},
    ],
    "ref2va": [
        {"f": "Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors", "nom": "Singularity ref2va v1.3 int8", "defaut": True,
         "note": "la recette de Cal (30/09)"},
        {"f": "minimax_h3_ref2va_pruned_int8_convrot.safetensors", "nom": "ref2va élagué int8 (R5)"},
        {"f": "Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors", "nom": "Singularity ref2va v1.3 élagué (R9, R10)"},
    ],
}
# la pile de LoRA de la recette, dans cet ordre précis (Cal : « People → LoRA cinéma DY → Turbo »)
PEOPLE = "h3-realism-people-t2v-i2v-r2v.safetensors"
CINE = "h3-cinematic-texture-DY-v0.1.safetensors"
TURBO_V4 = "minimax_h3_turbo_v4_step600_ema.safetensors"
RECIPE_LORAS = (PEOPLE, CINE, TURBO_V4)
QUALITY_TAG = "r34l1sm. DY."   # en tête de la description (Cal) : les déclencheurs de People et du LoRA cinéma
LATENT_UP = "minimax_h3_latent_upscaler_3d_bf16.safetensors"
DRAFT_SIGMAS = "0.8000, 0.6316, 0.3158, 0.0000"
METHODS = {   # les préréglages : `canvas` la toile, `stages` 2 = brouillon puis l'agrandisseur latent
    "brouillon": {"label": "Brouillon", "sub": "rapide · 1536 × 640 en deux étages", "canvas": (1536, 640), "stages": 2,
                  "steps": (4, 6, 8), "default_steps": 8, "refs": "planche",
                  "cal": {"seconds": 406, "frames": 192, "what": "DRAFT, 6 min 46 s pour 192 images"},
                  "note": "768 × 320, puis l'agrandisseur latent H3 → 1536 × 640 (sigmas 0,8 / 0,63 / 0,32). Un personnage "
                          "donne sa planche corps 3 vues visage masqué et ses gros plans du visage (validé à l'œil par Cal). "
                          "Pour la prévis, les essais de prompt et de mise en scène."},
    "qualite": {"label": "Qualité", "sub": "1920 × 800 en un étage", "canvas": (1920, 800), "stages": 1,
                "steps": (4, 6, 8), "default_steps": 8, "refs": "char",
                "cal": {"seconds": 960, "frames": 192, "what": "Q1080, ≈ 16 min pour 192 images"},
                "note": "1920 × 800 direct, 8 pas. Un personnage donne les 5 images de la méthode « .char » (visage face, "
                        "visage 3/4, tenue haut, tenue bas, corps de dos) : la planche masquée y fait régresser l'identité "
                        "(80 % → 50 %). Pour le rendu final, les plans clés."},
}
DEFAULT_METHOD = "brouillon"
OLD_METHODS = ("turbo", "origine", "spectrum")   # l'ancien banc (ComfyUI-H3TEST) : relu comme un Brouillon
CANVASES = [   # (largeur, hauteur, famille, libellé, source)
    (1536, 640, "2,4:1", "Brouillon", "la recette de Cal (30/09) : 768 × 320 agrandi ×2"),
    (1920, 800, "2,4:1", "Qualité", "la recette de Cal (30/09) : Q1080, un étage"),
    (1280, 544, "2,4:1", "720p", "Q720 et F720 des essais de Cal (test-meteorite.py)"),
    (1344, 768, "paysage", "détail natif", "toile par défaut du nœud H3, plafond 768 × 1344 de la note officielle"),
    (1280, 704, "paysage", "≈ 720p", "toiles H3 Base de H3 Studio (docs/GRAPH_MAP.md)"),
    (1024, 576, "paysage", "compact", "toiles H3 Base de H3 Studio"),
    (864, 480, "paysage", "brouillon", "toiles H3 Base de H3 Studio"),
    (2240, 960, "21:9", "R5 · final", "banc H3 de Cal : le run R5 retenu"),
    (1792, 768, "21:9", "R0", "banc H3 de Cal : R0, propre en 4 steps"),
    (1344, 576, "21:9", "compact", "21:9 exact de la liste du banc H3"),
    (768, 1344, "portrait", "détail natif", "le plafond 768 × 1344, debout ; plein pied de Character Factory"),
    (704, 1280, "portrait", "≈ 720p", "H3 Studio, debout"),
    (576, 1024, "portrait", "compact", "9:16 de la liste du banc H3"),
    (480, 864, "portrait", "brouillon", "H3 Studio, debout"),
    (768, 768, "carré", "détail natif", "768 de petit côté : visage de Character Factory, essais d'expression"),
    (1024, 1024, "carré", "grand", "carré de la liste du banc H3"),
]
FAMILIES = ["2,4:1", "paysage", "21:9", "portrait", "carré"]
ROLES = {   # « utiliser comme » : les rôles de H3 Studio ; « auto » laisse le prompt dire ce que c'est
    "image": [("auto", "auto"), ("character", "personnage"), ("location", "lieu"), ("style", "look"), ("object", "objet")],
    "video": [("motion", "mouvement"), ("camera", "caméra"), ("action", "action"), ("scene", "scène entière")],
    "audio": [("voice", "voix"), ("music", "musique"), ("effects", "bruitages")],
}
ROLE_EN = {"character": "character identity", "location": "location", "style": "visual style", "object": "object",
           "motion": "motion", "camera": "camera movement", "action": "action", "voice": "voice",
           "music": "music", "effects": "sound effects"}
REF_ROLES = ("face", "full body")    # ce qu'un élément donne à H3 : son visage, son plein pied
ROLE_FR = {"face": "visage", "full body": "plein pied", "expression": "expression", "outfit": "tenue",
           "view": "vue", "detail": "détail", "style": "style", "voice": "voix"}
# Les entrées du mode Références, appelées par position (décision de Cal du 29/09) :
# @image1…, @element1…, @video1…, @audio1… — commun/entrees.js fait le même compte
INPUT_CATS = ("image", "element", "video", "audio")
TOKEN_RX = re.compile(r"(?<![^\W_]|[@_])@([^\W\d]+)(\d*)")
AUDIO_EXT = (".wav", ".mp3", ".flac", ".m4a", ".ogg")
SECTION_HEADS = ("integrated_multimodal_description:", "subject_definitions:")
CAMERA = [   # le vocabulaire contrôlé de MiniMax (corpus/h3_style_rules.md) et sa phrase
    ("Push In", "The camera pushes in"), ("Pull Out", "The camera pulls out"),
    ("Zoom In", "The camera zooms in"), ("Zoom Out", "The camera zooms out"),
    ("Pan Left", "The camera pans left"), ("Pan Right", "The camera pans right"),
    ("Truck Left", "The camera trucks left"), ("Truck Right", "The camera trucks right"),
    ("Tilt Up", "The camera tilts up"), ("Tilt Down", "The camera tilts down"),
    ("Pedestal Up", "The camera pedestals up"), ("Pedestal Down", "The camera pedestals down"),
    ("Arc Shot", "The camera arcs around the subject"), ("Tracking Shot", "A tracking shot follows the subject"),
    ("Static Shot", "Static shot, the camera holds still"), ("POV", "POV shot through the character's eyes"),
    ("Shake Slightly", "The camera shakes slightly"), ("Shake Strongly", "The camera shakes strongly"),
    ("Roll Clockwise", "The camera rolls clockwise"), ("Roll Counterclockwise", "The camera rolls counterclockwise"),
]


def _defaut(lst: list[dict]) -> str:
    return next(x["f"] for x in lst if x.get("defaut"))


def _r32(v: float) -> int:
    return max(CANVAS_MULTIPLE, round(v / CANVAS_MULTIPLE) * CANVAS_MULTIPLE)


def adapt_canvas(width: float, height: float) -> tuple[int, int]:
    """La toile d'H3 pour un rapport quelconque — copie de `adapt_canvas`
    (comfy_extras/nodes_minimax_h3.py) : 768 px de petit côté, aire
    plafonnée à 768 × 1344, chaque côté arrondi à 32. Sert au format
    « d'après l'image » : la première image n'est ni déformée ni rognée
    au-delà de l'arrondi."""
    ratio = width / height
    if ratio >= 1.0:
        nw, nh = BASE_SHORT_EDGE * ratio, BASE_SHORT_EDGE
    else:
        nw, nh = BASE_SHORT_EDGE, BASE_SHORT_EDGE / ratio
    if nw * nh > MAX_PIXELS:
        s = math.sqrt(MAX_PIXELS / (nw * nh))
        nw, nh = nw * s, nh * s
    return _r32(nw), _r32(nh)


def frame_count(seconds: float) -> int:
    """`align_frame_count(max(5, round(s × 24)))` : la grille 17k + 5 du modèle."""
    n = max(5, round(seconds * FPS))
    while n % 17 != 5:
        n += 1
    return n


def default_steps(method: str, w: int = 0, h: int = 0) -> int:
    return METHODS[method]["default_steps"]


def draft_canvas(w: int, h: int) -> tuple[int, int]:
    """Le premier étage d'un Brouillon : la moitié de la toile, alignée sur 32
    (768 × 320 pour 1536 × 640, la recette ; l'agrandisseur fait ×2 en
    « target dimensions », align 32)."""
    return _r32(w / 2), _r32(h / 2)


# ── le temps estimé ─────────────────────────────────────────
# La forme : un ajustement sur cinq rendus mesurés sur DGX1 (R0 1792×768 124 img
# 4 pas 300 s ; R3 2240×960 4 pas 510 s ; R5 2240×960 8 pas 691 s ; banc i2v
# 1792×768 243 img 8 pas 1024 s ; banc ref2v 1344×576 243 img 8 pas 481 s) :
# P = Mpx × images / 124, u ≈ 40 + 135·P + 9,8·P²·pas (écarts −12 % à +5 %).
# L'échelle : les rendus de Cal avec sa recette (DRAFT 406 s, Q1080 ≈ 960 s,
# 192 images) — le Brouillon compte ses deux étages (la demi-toile à `steps`
# pas, puis la toile à 3 sigmas). Puis les rendus H3 de l'outil, même préréglage.
# Les vidéos de référence : H3 les lit à la taille du plan, et elles comptent
# presque comme autant d'images du plan. Relevé le 30/09 sur DGX2 (journal de
# Sol-Attn, 864 × 480, 124 images) : 15 527 jetons en texte seul, 17 214 avec
# deux images, 34 812 avec une image et une vidéo de 5,17 s — et 401 s de
# rendu contre 95. `ref_frames` : leurs images à 24 i/s, ajoutées à celles du plan.
def _units(method: str, w: int, h: int, frames: int, steps: int, stages: int | None = None) -> float:
    def u(ww, hh, n):
        p = (ww * hh / 1e6) * (frames / 124)
        return 135 * p + 9.8 * p * p * n
    if (stages or METHODS[method]["stages"]) == 2:
        dw, dh = draft_canvas(w, h)
        return 40 + u(dw, dh, steps) + u(w, h, 3)
    return 40 + u(w, h, steps)


def _cal_rate(method: str) -> float:
    m = METHODS[method]
    w, h = m["canvas"]
    return m["cal"]["seconds"] / _units(method, w, h, m["cal"]["frames"], m["default_steps"])


def estimate(method: str, w: int, h: int, frames: int, steps: int, *, ref_max: bool = False,
             samples: list | None = None, ref_frames: int = 0, stages: int | None = None) -> dict:
    units = _units(method, w, h, frames + ref_frames, steps, stages)
    own = [s for s in (samples or []) if s["method"] == method and s["units"] > 0]
    if own:
        rates = sorted(s["seconds"] / s["units"] for s in own[-12:])
        r = rates[len(rates) // 2]
        low, high = units * r * (0.8 if len(own) > 1 else 0.65), units * r * (1.25 if len(own) > 1 else 1.6)
        basis = f"d'après {len(own)} rendu{'s' if len(own) > 1 else ''} H3 de l'outil, même préréglage"
    else:
        r = _cal_rate(method)
        low, high = units * r * 0.85, units * r * 1.2
        basis = f"d'après le rendu de Cal ({METHODS[method]['cal']['what']}), à l'échelle de la toile et de la durée"
    if ref_max:
        high *= 3
        basis += " ; références « max » : jusqu'à plusieurs fois plus lent (infobulle du nœud)"
    if ref_frames:
        basis += f" ; les vidéos de référence comptées comme {ref_frames} images de plus (jetons relevés le 30/09)"
    return {"low": round(low), "high": round(high), "units": round(units, 2), "basis": basis}


def _samples() -> list[dict]:
    """Les rendus H3 de l'outil (pas les factices) : de quoi recaler l'estimation."""
    out = []
    for it in library.query(["video"], limit=500, tool="movie")["items"]:
        p = it.get("params") or {}
        if p.get("engine") == "h3" and it.get("render_seconds") and p.get("estimate", {}).get("units"):
            out.append({"method": p.get("method"), "seconds": it["render_seconds"], "units": p["estimate"]["units"]})
    return out


# ── les références : @nom, rôle, étiquettes ─────────────────
def _pic(path: Path, item: dict, label: str, role: str, thumb: str | None) -> dict:
    return {"path": path, "item": item["id"], "label": label, "role": role, "thumb_url": thumb}


def _image(item_id: str, what: str, errors: list) -> dict | None:
    if not item_id:
        return None
    it = library.get(item_id)
    if not it:
        errors.append(f"{what} n'est plus dans la bibliothèque ({item_id})")
        return None
    if it["kind"] != "image":
        errors.append(f"{what} doit être une image ({it['kind']} reçu)")
        return None
    return it


# Les images d'un personnage que chaque préréglage demande (Cal, 30/09,
# RECETTE-DRAFT-QUALITE.md) — leur ordre est celui de ses scripts :
#   « .char » (Qualité)   visage face, visage 3/4, tenue haut, tenue bas, corps de dos
#   planche (Brouillon)   corps 3 vues visage masqué, puis les gros plans du visage :
#                         face, 3/4 sourire, 3/4 neutre, profil
# Une référence d'élément dit ce qu'elle est par son rôle et son libellé
# (`_ref_kind`) ; un personnage à qui une pièce manque envoie ce qu'il a, et
# le plan le dit (`notes`).
CHAR_SET = ("face_front", "face_34", "outfit_top", "outfit_bottom", "back")
SHEET_SET = ("sheet", "face_front", "face_34_smile", "face_34", "face_profile")
KIND_FR = {"face_front": "visage de face", "face_34": "visage 3/4", "face_34_smile": "visage 3/4 sourire",
           "face_profile": "visage de profil", "outfit_top": "tenue haut", "outfit_bottom": "tenue bas",
           "back": "corps de dos", "sheet": "planche corps 3 vues visage masqué"}


def _ref_kind(r: dict) -> str:
    role = (r.get("role") or "").lower()
    txt = f"{r.get('label') or ''} {r.get('file') or ''}".lower()
    if role == "sheet" or "masqu" in txt or "masked" in txt:
        return "sheet"
    if role in ("face", "expression"):
        if "profil" in txt:
            return "face_profile"
        if re.search(r"3/4|\b34\b|-34|trois|three", txt):
            return "face_34_smile" if re.search(r"sourire|smil", txt) else "face_34"
        return "face_front" if role == "face" else "expression"
    if role == "outfit" or re.search(r"tenue", txt):
        if re.search(r"haut|\btop\b", txt):
            return "outfit_top"
        if re.search(r"\bbas\b|bottom", txt):
            return "outfit_bottom"
    if re.search(r"\bdos\b|\bback\b", txt) and role in ("view", "full body", "outfit", ""):
        return "back"
    return role.replace(" ", "_") or "other"


def element_parts(el: dict, method: str = DEFAULT_METHOD) -> tuple[list, list, str]:
    """Ce qu'un élément envoie pour ce préréglage : les images de sa méthode
    (planche pour Brouillon, « .char » pour Qualité) quand il les a ; sinon
    son premier visage et son premier plein pied (sans eux, ses deux
    premières images) ; et sa voix quand sa carte en porte une. Rend aussi
    ce que le plan doit dire (une pièce manque). movie.js fait le même compte
    pour la capacité. `el` : le contenu d'élément déjà résolu (library.resolve)."""
    refs = el.get("refs") or []
    imgs = [r for r in refs if not r.get("file", "").lower().endswith(AUDIO_EXT)]
    # la voix est rangée à part (element.voices, library.py) ; un son dans refs
    # (ancienne forme) compte aussi
    voices = list(el.get("voices") or []) + [r for r in refs if r.get("file", "").lower().endswith(AUDIO_EXT)]
    want = SHEET_SET if METHODS.get(method, METHODS[DEFAULT_METHOD])["refs"] == "planche" else CHAR_SET
    # Cal prend des gros plans du visage à part pour la planche (ref-visage-*.png) et les crops
    # .char pour Qualité (ref-1-visage-face.png…) : un « gros plan » passe d'abord pour la planche, après sinon
    close = lambda r: ("gros plan" in (r.get("label") or "").lower()) != (want == SHEET_SET)  # noqa: E731
    by = {}
    for r in sorted(imgs, key=close):
        by.setdefault(_ref_kind(r), r)
    got = [dict(by[k], _kind=k) for k in want if k in by]
    note = ""
    if want == SHEET_SET and "sheet" not in by:
        # pas de planche : la méthode « .char » si elle est là (Cal : elle vaut mieux qu'un mélange)
        char = [dict(by[k], _kind=k) for k in CHAR_SET if k in by]
        if len(char) >= 3:
            missing = [KIND_FR[k] for k in CHAR_SET if k not in by]
            return char, voices[:1], ("pas de planche « corps 3 vues visage masqué » : la méthode .char à la place"
                                      + (f" (manquent : {', '.join(missing)})" if missing else ""))
        got = []
    if len(got) >= 3 and (want != SHEET_SET or "sheet" in by):
        missing = [KIND_FR[k] for k in want if k not in by and k != "face_34_smile"]
        return got, voices[:1], (f"manquent : {', '.join(missing)}" if missing else "")
    chosen = [r for role in REF_ROLES for r in [next((x for x in imgs if x.get("role") == role), None)] if r]
    need = "la planche masquée et les gros plans du visage" if want == SHEET_SET else "les 5 images de la méthode .char"
    return (chosen or imgs[:2]), voices[:1], f"n'a pas {need} : son visage et son plein pied à la place"


def token_key(kind: str, num: str) -> str:
    return f"{kind.lower()}{num}"


def _inputs(inputs: dict, errors: list, method: str = DEFAULT_METHOD, notes: list | None = None) -> dict:
    """Les entrées par position : {image: [{item, role}|None…], element: […],
    video: [{item, role, sound}|None…], audio: […]}. Une place vide garde sa
    position (son jeton est rouge). L'ordre d'H3 : les images (celles de la
    catégorie Images, puis celles des éléments), puis les vidéos, puis les
    sons (les bandes-son de vidéo d'abord, puis les sons, puis les voix des
    éléments — MiniMaxH3ReferenceToVideo). Rend les images (`<Picture n>`),
    les sujets (`<Subject k>`), les vidéos, les sons et la table jeton → étiquette."""
    slots = {c: (inputs.get(c) if isinstance(inputs.get(c), list) else []) for c in INPUT_CATS}
    pictures, subjects, videos, audios, tags, used = [], [], [], [], {}, []

    def entry(cat, pos, p, kinds):
        if not isinstance(p, dict) or not p.get("item"):
            return None
        it = library.get(p["item"])
        if not it:
            errors.append(f"@{cat}{pos + 1} n'est plus dans la bibliothèque ({p['item']})")
            return None
        if it["kind"] not in kinds:
            errors.append(f"@{cat}{pos + 1} : une {it['kind']} n'a pas sa place parmi les {cat}s")
            return None
        roles = [r for r, _ in ROLES.get("image" if cat in ("image", "element") else cat, [])]
        role = p.get("role") if p.get("role") in roles else (roles[0] if roles else "")
        used.append(it["id"])
        return it, role

    for pos, p in enumerate(slots["image"]):
        got = entry("image", pos, p, ("image",))
        if not got:
            continue
        it, role = got
        pictures.append(_pic(library.path_of(it), it, it.get("title") or it["id"], "", library.public(it).get("thumb_url")))
        subjects.append({"kind": "image", "title": it.get("title") or "", "token": f"image{pos + 1}", "role": role,
                         "pics": [len(pictures)], "nums": {}, "item": it["id"]})
        tags[f"image{pos + 1}"] = f"<Subject {len(subjects)}>"
    element_voices = []
    for pos, p in enumerate(slots["element"]):
        got = entry("element", pos, p, ("element",))
        if not got:
            continue
        it, role = got
        # un élément versionné n'a pas de références lui-même : sa matière est dans sa
        # dernière version (library.resolve) ; une planche (personnage importé de
        # Character Factory, `refs` propres) se lit telle quelle
        src = library.resolve(it)
        if not src:
            errors.append(f"@element{pos + 1} « {it['title']} » n'a pas encore de version publiée")
            continue
        el = it["element"]
        if src["kind"] == "image":   # une version qui est une image
            imgs, voices, why = [{"file": src["file"], "role": "", "label": src.get("title") or ""}], [], ""
        else:
            imgs, voices, why = element_parts(src["element"], method)
        if not imgs:
            errors.append(f"@element{pos + 1} « {it['title']} » n'a aucune image")
            continue
        if why and notes is not None:
            notes.append(f"@element{pos + 1} « {it['title']} » : {why}")
        pub_refs = {r["file"]: r for r in (library.public(src).get("element") or {}).get("refs", [])}
        nums = {}
        for r in imgs:
            pictures.append(_pic(library.path_of(src, r["file"]), it,
                                 f"{it['title']} · {r.get('label') or KIND_FR.get(r.get('_kind'), '') or ROLE_FR.get(r.get('role'), r.get('role') or 'réf.')}",
                                 r.get("role", ""), pub_refs.get(r["file"], {}).get("thumb_url")
                                 or (library.public(src).get("thumb_url") if src["kind"] == "image" else None)))
            nums.setdefault(r.get("_kind") or r.get("role") or "other", []).append(len(pictures))
        subjects.append({"kind": "element", "etype": el.get("type"), "title": it["title"], "token": f"element{pos + 1}",
                         "role": "character" if el.get("type") in (None, "character") else "object",
                         "description": ((src.get("element") or el).get("description") or el.get("description") or "").strip(),
                         "nums": nums, "pics": [n for v in nums.values() for n in v], "item": it["id"]})
        tags[f"element{pos + 1}"] = f"<Subject {len(subjects)}>"
        for r in voices:
            element_voices.append({"path": library.path_of(src, r["file"]), "item": it["id"], "token": None,
                                   "role": "voice", "duration": r.get("duration") or 0, "subject": len(subjects)})
    for pos, p in enumerate(slots["video"]):
        got = entry("video", pos, p, ("video",))
        if not got:
            continue
        it, role = got
        dur = it.get("duration") or 0
        if dur and not (LIMITS["min_seconds"] <= dur <= LIMITS["seconds"] + 0.1):
            errors.append(f"@video{pos + 1} : une vidéo de référence dure de 2 à 15 s ({dur:.1f} s)")
        sound = bool(p.get("sound"))
        if sound and not it.get("audio"):
            errors.append(f"@video{pos + 1} : cette vidéo n'a pas de son")
        videos.append({"path": library.path_of(it), "item": it["id"], "token": f"video{pos + 1}", "role": role,
                       "sound": sound, "duration": dur, "thumb_url": library.public(it).get("thumb_url")})
        tags[f"video{pos + 1}"] = f"<Video {len(videos)}>"
    for pos, p in enumerate(slots["audio"]):
        got = entry("audio", pos, p, ("audio",))
        if not got:
            continue
        it, role = got
        dur = it.get("duration") or 0
        if dur and not (LIMITS["min_seconds"] <= dur <= LIMITS["seconds"] + 0.1):
            errors.append(f"@audio{pos + 1} : un son de référence dure de 2 à 15 s ({dur:.1f} s)")
        audios.append({"path": library.path_of(it), "item": it["id"], "token": f"audio{pos + 1}", "role": role, "duration": dur})
    audios += element_voices
    # une bande-son de vidéo prend son <Audio j> avant les sons seuls (le nœud)
    n_audio = 0
    for v in videos:
        if v["sound"]:
            n_audio += 1
            v["audio_tag"] = f"<Audio {n_audio}>"
    for a in audios:
        n_audio += 1
        a["tag"] = f"<Audio {n_audio}>"
        if a["token"]:
            tags[a["token"]] = a["tag"]
    if len(pictures) > LIMITS["image"]:
        errors.append(f"{len(pictures)} images : H3 en prend {LIMITS['image']} au plus (un personnage en envoie deux)")
    if len(videos) > LIMITS["video"]:
        errors.append(f"{len(videos)} vidéos : H3 en prend {LIMITS['video']} au plus")
    if n_audio > LIMITS["audio"]:
        errors.append(f"{n_audio} sons (bandes-son et voix comprises) : H3 en prend {LIMITS['audio']} au plus")
    if len(pictures) + len(videos) + len(audios) > LIMITS["files"]:
        errors.append(f"{LIMITS['files']} fichiers de référence au plus")
    for what, lst in (("vidéos", videos), ("sons", audios)):
        total = sum(x["duration"] or 0 for x in lst)
        if total > LIMITS["seconds"] + 0.1:
            errors.append(f"les {what} de référence font {total:.1f} s ensemble : 15 s au plus par type")
    norm = {c: [({k: v for k, v in p.items() if k in ("item", "role", "sound")} if isinstance(p, dict) and p.get("item") else None)
                for p in slots[c]] for c in INPUT_CATS}
    return {"inputs": norm, "pictures": pictures, "subjects": subjects, "videos": videos, "audios": audios,
            "tags": tags, "parents": list(dict.fromkeys(used))}


def check_tokens(texts: list[str], tags: dict) -> tuple[list, set]:
    """Les jetons des champs : ceux qui ne pointent vers rien (rouges), et
    ceux qui servent."""
    bad, seen = [], set()
    for t in texts:
        for m in TOKEN_RX.finditer(t or ""):
            k = token_key(m.group(1), m.group(2))
            seen.add(k)
            if k not in tags and m.group(0) not in bad:
                bad.append(m.group(0))
    return bad, seen


# ── les répliques : au format H3, jamais « entre guillemets » ─────────────────────────────────────────────────────
# H3 ne prend une réplique que dans sa notation : `The weathered man (S1) mutters: <d>[English] Not tonight.</d>`
# (l'aide « Réplique » de la page Vidéo, les guides MiniMax). Une phrase écrite « Marc dit : "vive Nirvalab !" » n'est
# pour lui qu'un texte à raconter : la voix lit la phrase comme un narrateur, ou y ajoute n'importe quoi. Le portail
# met donc au format H3 ce qui est sans ambiguïté une réplique citée — un verbe de parole puis des guillemets, ou deux
# points puis des guillemets —, et laisse tel quel tout ce qui est déjà en `<d>`. Une seule personne parle (S1) :
# pour plusieurs voix, écrire soi-même les `<d>`.
_SPEECH_CUES = (r"dit|dis|disent|répond|répondit|demande|crie|hurle|murmure|chuchote|lance|s['’]exclame|annonce|déclare|"
                r"ajoute|souffle|chante|says?|said|shouts?|whispers?|mutters?|replies|asks?|exclaims?|yells?|calls?|"
                r"announces?|declares?|sings?|adds?")
_SPEECH_RX = re.compile(
    r"(?:\b(?:et|and|puis|then)\s+)?(?:\b(?:" + _SPEECH_CUES + r")\b)?\s*:?\s*(?<![\w])[\"“«]\s*([^\"”»<>]+?)\s*[\"”»]",
    re.IGNORECASE)
_SPEECH_LANG = {"fr": "French", "en": "English"}


def speech_to_h3(desc: str, lang: str = "fr") -> tuple[str, int]:
    """(texte, nombre de répliques mises au format H3). Les `<d>…</d>` déjà écrits ne sont pas touchés ; un
    texte entre guillemets sans verbe de parole ni deux points avant lui (un titre, une enseigne) non plus."""
    name = _SPEECH_LANG.get(lang, "French")
    n = 0

    def one(m):
        nonlocal n
        before = m.group(0)[:m.start(1) - m.start(0)]
        if not re.search(r"(?:\b(?:" + _SPEECH_CUES + r")\b|:)\s*[\"“«]\s*$", before, re.IGNORECASE):
            return m.group(0)          # des guillemets seuls : une enseigne, un titre, pas une réplique
        n += 1
        return f"(S1) says: <d>[{name}] {m.group(1).strip()}</d>"

    parts = re.split(r"(<d>.*?</d>)", desc, flags=re.DOTALL)
    out = [x if x.startswith("<d>") else _SPEECH_RX.sub(one, x) for x in parts]
    return "".join(out), n


def swap_tokens(text: str, tags: dict) -> str:
    return TOKEN_RX.sub(lambda m: tags.get(token_key(m.group(1), m.group(2)), m.group(0)), text or "")


def _tags(nums: list[int], word: str = "Picture") -> str:
    t = [f"<{word} {n}>" for n in nums]
    return t[0] if len(t) == 1 else ", ".join(t[:-1]) + " and " + t[-1]


def _first_sentence(text: str) -> str:
    one = " ".join(text.split())
    m = re.match(r"(.+?[.!?])(\s|$)", one)
    s = (m.group(1) if m else one)[:300]
    return s if s.endswith((".", "!", "?")) else s + "."


def _sound(sound: str, music: str) -> tuple[str, str]:
    sound = " ".join((sound or "").split()) or "Natural diegetic sound of the scene, in sync with the action on screen."
    music = " ".join((music or "").split()) or "N/A"
    return sound, music


def _shots(body: str) -> str:
    """Les plans que la description découpe (« [Shot 1], [Shot 2]… »), pour
    `appears in` de la rétention — comme Cal les liste ; « [Shot 1] » sinon."""
    got = list(dict.fromkeys(re.findall(r"\[Shot \d+\]", body)))
    return ", ".join(got) if got else "[Shot 1]"


def _story(body: str) -> str:
    """La phrase du résumé : la première du premier plan (une ligne de look
    placée avant [Shot 1] n'est pas l'histoire)."""
    m = re.search(r"\[Shot \d+\]\s*(.*)", body, re.S)
    return _first_sentence(m.group(1) if m else body)


def _shot(desc: str) -> str:
    # une description découpée en plans ([Shot 1]…[Shot 5], précédés ou non d'une ligne de look,
    # comme celle de Cal) part telle quelle ; sinon, c'est un plan unique
    return desc if "[Shot" in desc else "[Shot 1] " + desc


def compose_base(desc: str, sound: str, music: str, *, first: bool, last: bool, seconds: float) -> str:
    """Texte et Images : les trois champs du guide de base
    (VIDEO_PROMPT_WRITING_GUIDE_base_en.md), et la ligne d'ancrage des
    images au-dessus, générée ici parce qu'elle porte la durée."""
    head = []
    if first:
        head.append("For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.")
    if last:
        n = 2 if first else 1
        head.append(f"<Picture {n}> (from [Shot 1]) aligns with the {seconds:.2f}-second mark of the target video.")
    body = desc
    if (first or last) and "<Picture" not in desc:
        # le guide : se référer aux images par leur étiquette dans la description
        body = ("Begin with <Picture 1> and end with <Picture 2>. " if first and last else
                "Begin with <Picture 1>. " if first else "End with <Picture 1>. ") + desc
    snd, mus = _sound(sound, music)
    text = f"integrated_multimodal_description:\n{_tagged(_shot(body))}\n\noverall_soundscape:\n{snd}\n\nnon_diegetic_music:\n{mus}"
    return ("\n".join(head) + "\n\n" + text) if head else text


def compose_ref(desc: str, sound: str, music: str, R: dict) -> str:
    """Références : les six sections du guide ref (VIDEO_PROMPT_WRITING_GUIDE_ref_en.md).
    Chaque sujet est défini (un élément : son nom, sa description, d'où
    viennent son visage et son corps — la forme de Character Factory) ; la
    rétention suit le rôle : un look passe en attribute_transfer (H3 Studio),
    un lieu garde son monde mais pas son cadrage (la planète de
    test-r2v-h3.py), le reste est fully_preserved (le guide). Les jetons
    (@image1, @element1…) deviennent les étiquettes."""
    defs, keep, notes = [], [], []
    shots = _shots(_shot(desc))
    for k, s in enumerate(R["subjects"], start=1):
        subj = f"<Subject {k}>"
        if s["kind"] == "element":
            nums = s["nums"]
            src = []

            def tg(keys):
                return [n for k in keys for n in nums.get(k, [])]
            faces = tg(("face", "face_front", "face_34_smile", "face_34", "face_profile"))
            sheet, outfit, back = tg(("sheet",)), tg(("outfit_top", "outfit_bottom")), tg(("back",))
            # la forme des définitions de Cal (test-meteorite*.py) : d'où vient chaque partie du personnage
            if sheet:
                src.append(f"whose body, outfit and pose are shown in {_tags(sheet)} (front, back and side views, face "
                           "blanked out -- ignore the blank grey oval, do not reproduce it)")
            if faces:
                src.append(f"whose face, hair, age and identity come from {_tags(faces)}")
            if outfit:
                src.append(f"whose outfit is shown in {_tags(outfit)}")
            if back:
                src.append(f"whose body from behind is shown in {_tags(back)}")
            if nums.get("full body"):
                src.append(f"whose body proportions and outfit come from {_tags(nums['full body'])}")
            known = {"face", "face_front", "face_34_smile", "face_34", "face_profile", "sheet", "outfit_top",
                     "outfit_bottom", "back", "full body"}
            others = [n for r, v in nums.items() if r not in known for n in v]
            if others:
                src.append(f"shown in {_tags(others)}")
            d = s["description"].rstrip(".")
            defs.append(f"{subj} is {s['title']}" + (f", {d}" if d else "") + (", " + ", and ".join(src) if src else "") + ".")
        elif s["role"] == "auto":   # le prompt dit ce que c'est
            defs.append(f"{subj} is what {_tags(s['pics'])} shows. Keep its visible defining details.")
        else:
            defs.append(f"{subj} is the {ROLE_EN[s['role']]} shown in {_tags(s['pics'])}. Keep its visible defining details.")
        pics = _tags(s["pics"])
        if s["role"] == "style":
            keep.append(f"{subj} (appears in {shots}): attribute_transfer - the look, palette, light and texture of {pics} carry over.")
        elif s["role"] == "location":
            keep.append(f"{subj} (appears in {shots}): partially_preserved - its terrain, key features, light and atmosphere "
                        f"are retained; the framing and camera position of {pics} are not reproduced.")
        elif s["kind"] == "element" and s.get("etype") in (None, "character"):
            sheet = "the multi-view sheet layout and white studio background" if s["nums"].get("sheet") else \
                "the backgrounds, poses and framing"
            keep.append(f"{subj} (appears in {shots}): fully_preserved - the face, hair, age, identity, body proportions and "
                        f"outfit are retained; {sheet} of its reference images are not reproduced.")
        else:
            keep.append(f"{subj} (appears in {shots}): fully_preserved - the defining visual attributes shown in {pics} are retained.")
    for n, v in enumerate(R["videos"], start=1):
        tag = f"<Video {n}>"
        if v.get("audio_tag"):
            notes.append(f"{v['audio_tag']} is the soundtrack paired with {tag}.")
        if v["role"] == "scene":
            notes.append(f"{tag} is a whole-scene reference. Follow its visible setting, subjects, action, camera movement, "
                         "composition and timing as closely as possible; apply only the change explicitly requested in "
                         "[Shot 1]. Generate a new video rather than treating reference frames as locked pixels.")
        else:
            notes.append(f"{tag} is a {ROLE_EN[v['role']]} reference.")
    for a in R["audios"]:
        if a.get("subject"):   # la voix d'un élément
            notes.append(f"{a['tag']} is the voice reference of <Subject {a['subject']}>: timbre, tone and delivery only, never its words.")
        else:
            notes.append(f"{a['tag']} is a {ROLE_EN[a['role']]} reference.")
    body = swap_tokens(desc, R["tags"])
    snd, mus = _sound(swap_tokens(sound, R["tags"]), swap_tokens(music, R["tags"]))
    return ("subject_definitions:\n" + ("\n".join(defs) or "No separate still-image subject is defined.")
            + "\n\nsummary:\n[reference generation] " + _story(body) + ((" " + " ".join(notes)) if notes else "")
            + "\n\nretention_analysis:\n" + ("\n".join(keep) or "Preserve the motion and sound qualities of the cited references.")
            + "\n\ndetailed_description:\n" + _tagged(_shot(body))
            + f"\n\noverall_soundscape:\n{snd}\n\nnon_diegetic_music:\n{mus}")


def _tagged(text: str) -> str:
    """Le tag de la recette en tête de la description (Cal : « r34l1sm. DY. ») —
    les déclencheurs des LoRA People et cinéma de la pile ; pas deux fois."""
    return text if text.lstrip().startswith(QUALITY_TAG) else f"{QUALITY_TAG} {text}"


# ── le plan d'un rendu ──────────────────────────────────────
def _num(v, cast, default):
    try:
        return cast(v) if v not in (None, "") else default
    except (TypeError, ValueError):
        return default


def plan(mode: str, p: dict, *, with_graph: bool = False) -> dict:
    """Tout ce qu'un rendu enverra, résolu et vérifié ; `errors` dit ce qui
    manque. La page l'affiche avant de lancer, le travail le refait."""
    if mode not in MODES:
        raise HttpError(400, f"mode inconnu : {mode}")
    errors, notes = [], []
    weights = MODES[mode]["weights"]
    desc = (p.get("desc") or "").strip()
    sound, music = p.get("sound") or "", p.get("music") or ""
    if not desc:
        errors.append("écrivez la description : ce qu'on voit et ce qu'on entend")
    frames = _num(p.get("frames"), int, 124)
    frames = min(FRAMES, key=lambda f: abs(f - frames))
    seconds = frames / FPS
    method = p.get("method") if p.get("method") in METHODS else DEFAULT_METHOD
    if p.get("method") in OLD_METHODS:
        notes.append(f"la méthode « {p['method']} » de l'ancien banc (ComfyUI-H3TEST) est relue comme un "
                     f"{METHODS[method]['label']} : la recette de Cal (30/09) la remplace")
    start = end = None
    pictures, parents = [], []
    R = {"inputs": None, "pictures": [], "subjects": [], "videos": [], "audios": [], "tags": {}, "parents": []}
    auto = None
    if mode == "i2v":
        start = _image(p.get("start") or "", "la première image", errors)
        end = _image(p.get("end") or "", "la dernière image", errors)
        if not p.get("start") and not p.get("end"):
            errors.append("ajoutez une première image, une dernière, ou les deux")
        for it, lab in ((start, "première image"), (end, "dernière image")):
            if it:
                pictures.append(_pic(library.path_of(it), it, lab, "", library.public(it).get("thumb_url")))
                parents.append(it["id"])
        anchor = start or end
        if anchor and anchor.get("width") and anchor.get("height"):
            auto = adapt_canvas(anchor["width"], anchor["height"])
    if mode == "r2v":
        R = _inputs(p.get("inputs") if isinstance(p.get("inputs"), dict) else {}, errors, method, notes)
        pictures, parents = R["pictures"], R["parents"]
        if not R["tags"]:
            errors.append("ajoutez une entrée : une image, un élément (un personnage), une vidéo ou un son")
    # les jetons des trois champs : rouges s'ils ne pointent vers rien (commun/entrees.js en direct)
    bad, seen = check_tokens([desc, sound, music], R["tags"])
    if bad:
        errors.append(("ces jetons ne pointent vers rien : " + ", ".join(bad) + " — remplissez leur place dans les entrées, "
                       "ou retirez-les") if mode == "r2v" else
                      ("les jetons " + ", ".join(bad) + " ne servent qu'en mode Références"))
    if mode == "r2v":
        idle = [f"@{k}" for k in R["tags"] if k not in seen]
        if idle and desc:
            notes.append(f"{', '.join(idle)} {'ne sont' if len(idle) > 1 else 'n’est'} pas dans le prompt : H3 "
                         f"{'les' if len(idle) > 1 else 'la'} reçoit quand même, définie{'s' if len(idle) > 1 else ''} dans subject_definitions")
    # la toile : celle du préréglage, sauf si « Paramètres avancés » en pose une
    canvas = p.get("canvas")
    preset_wh = METHODS[method]["canvas"]
    if canvas == "auto" and auto:
        width, height = auto
        fam = "image"
    elif canvas in (None, "", "auto", "preset"):
        width, height = preset_wh
        fam = "2,4:1"
    else:
        try:
            width, height = int(canvas[0]), int(canvas[1])
            fam = next((c[2] for c in CANVASES if (c[0], c[1]) == (width, height)), "libre")
        except (TypeError, ValueError, IndexError, KeyError):
            width, height = preset_wh
            fam = "2,4:1"
        if width % 32 or height % 32 or min(width, height) < 256 or width * height > 2688 * 1152:
            errors.append("toile : des multiples de 32, 256 au moins, 2688 × 1152 au plus (liste du banc H3)")
    stages = METHODS[method]["stages"]
    if mode == "i2v" and stages == 2:
        # les images clés d'H3 vivent sur la grille du premier étage : posées sur la demi-toile,
        # l'agrandisseur latent les interpole (première et dernière image hachées) ; posées à la
        # toile, le premier étage refuse (« shape mismatch… [1920, 96] … [480, 96] ») — rendus du
        # 30/09 sur DGX2. En Images, le Brouillon fait donc un seul étage, à sa toile
        stages = 1
        notes.append("en mode Images, le Brouillon rend en un seul étage : l'agrandisseur latent abîme la première "
                     "et la dernière image (essai du 30/09)")
    draft = draft_canvas(width, height) if stages == 2 else None
    if mode == "i2v" and start and start.get("width"):
        r_img, r_can = start["width"] / start["height"], width / height
        if abs(math.log(r_img / r_can)) > 0.01:
            notes.append(f"la première image ({start['width']}×{start['height']}) sera recadrée au centre au rapport "
                         f"{width}×{height} : H3 l'étirerait sinon (« plain stretch to canvas »)")
    steps = _num(p.get("steps"), int, None) or default_steps(method)
    steps = max(1, min(100, steps))
    if not 4 <= steps <= 8:
        notes.append(f"{steps} pas : le LoRA Turbo v4 est fait pour 4 à 8 (« past 8 steps it stops helping », "
                     "README de ComfyUI-MiniMax-H3-Turbo) ; la recette de Cal : 8")
    seed = _num(p.get("seed"), int, None)
    loras = []   # les LoRA ajoutés dans « Paramètres avancés », après la pile de la recette
    triggers = []   # les mots déclencheurs des LoRA de moodboard (server/tools/lora.py), en tête de la description
    from tools import lora as moodlora
    for l in p.get("loras") or []:
        if isinstance(l, dict) and l.get("name"):
            name = str(l["name"])
            mb = moodlora.info(name) if name.startswith(moodlora.COMFY_DIR) else None
            if mb:   # un LoRA de moodboard : ni de la pile, ni un accélérateur, quel que soit son nom (« cinema »)
                if mb.get("hidden") or mb["model"] != "h3":
                    errors.append(f"{name} : " + ("il vient d'un moodboard que tu ne vois pas" if mb.get("hidden") else
                                                  f"entraîné pour {moodlora.MODELS[mb['model']]['name']}, pas pour H3"))
                    continue
                if mb["trigger"] and mb["trigger"] not in triggers:
                    triggers.append(mb["trigger"])
            elif name.split("/")[-1] in RECIPE_LORAS or ACCEL_RX.search(name.split("/")[-1]):
                continue   # déjà dans la pile, ou un autre accélérateur (on n'en cumule pas deux)
            other = "ref2v" if weights == "fl2va" else "fl2v"
            if other in name.lower() and not ("fl2v" in name.lower() and "ref2v" in name.lower()):
                errors.append(f"{name} vise l'autre modèle ({'ref2va' if weights == 'fl2va' else 'fl2va'}) : il ne va pas avec ce mode")
            loras.append({"name": name, "strength": max(0.0, min(2.0, _num(l.get("strength"), float, 1.0)))})
    adv = p.get("adv") if isinstance(p.get("adv"), dict) else {}
    unets = UNETS[weights]
    unet = adv.get("unet") if adv.get("unet") in [u["f"] for u in unets] else _defaut(unets)
    ref_size = p.get("ref_image_size") if p.get("ref_image_size") in ("match", "max") else "match"
    crf = max(10, min(30, _num(adv.get("crf"), int, 12)))   # 12 : la recette de Cal
    raw = any(h in desc for h in SECTION_HEADS)
    spoken = 0
    if not raw:
        desc_h3, spoken = speech_to_h3(desc, p.get("speech_lang") or "fr")
        if spoken:
            notes.append(f"{spoken} réplique{'s' if spoken > 1 else ''} mise{'s' if spoken > 1 else ''} au format H3 "
                         "« (S1) says: <d>[langue] … </d> » : H3 ne parle qu'une réplique écrite ainsi (sinon un narrateur "
                         "la raconte) ; pour plusieurs voix, écris tes <d> toi-même")
            desc = desc_h3
    if raw:
        sent = swap_tokens(desc, R["tags"])
        notes.append("prompt déjà au format H3 (sections) : envoyé tel quel, jetons remplacés")
    elif mode == "r2v":
        sent = compose_ref(desc, sound, music, R) if (R["subjects"] or R["videos"] or R["audios"]) else ""
    else:
        sent = compose_base(desc, sound, music, first=bool(start), last=bool(end), seconds=seconds)
    if triggers:
        # comme dans ses légendes d'entraînement (ai-toolkit met le mot en tête de chacune), après le tag
        # de la recette ; un prompt écrit en sections part tel quel : à la personne de l'y mettre
        miss = [t for t in triggers if t not in sent]
        if raw and miss:
            notes.append(f"prompt en sections, envoyé tel quel : écrivez-y le mot déclencheur de votre LoRA "
                         f"({', '.join(miss)}) en tête de la description")
        elif miss and QUALITY_TAG in sent:
            sent = sent.replace(QUALITY_TAG, f"{QUALITY_TAG} {' '.join(miss)}", 1)
            notes.append(f"LoRA de moodboard : son mot déclencheur ({', '.join(miss)}) en tête de la description, "
                         "comme dans ses légendes d'entraînement")
    words = len(desc.split())
    if desc and words < 60 and not raw:
        notes.append(f"{words} mots : les guides MiniMax visent 350 à 500 mots pour la description — l'échec "
                     "documenté est le manque de précision, pas l'excès")
    samples = _samples()
    ref_frames = round(sum(min(v["duration"] or 0, LIMITS["seconds"]) for v in R["videos"]) * FPS)
    est = estimate(method, width, height, frames, steps, ref_max=(mode == "r2v" and ref_size == "max"), samples=samples,
                   ref_frames=ref_frames, stages=stages)
    rows = []
    for w, h, family, label, src in CANVASES:
        rows.append({"w": w, "h": h, "family": family, "label": label, "source": src,
                     "estimate": estimate(method, w, h, frames, steps, samples=samples, ref_frames=ref_frames, stages=stages)})
    if auto:
        rows.insert(0, {"w": auto[0], "h": auto[1], "family": "image", "label": "d'après l'image",
                        "source": "la règle du nœud : 768 de petit côté, aire ≤ 768 × 1344",
                        "estimate": estimate(method, auto[0], auto[1], frames, steps, samples=samples, ref_frames=ref_frames,
                                             stages=stages)})
    # chaque préréglage à sa toile, pour les deux boutons de la page (le temps de chacun)
    presets = {k: estimate(k, *m["canvas"], frames, default_steps(k), samples=samples, ref_frames=ref_frames,
                           stages=1 if mode == "i2v" else m["stages"])
               for k, m in METHODS.items()}
    out = {
        "mode": mode, "errors": errors, "notes": notes, "ok": not errors, "engine": engine(),
        "desc": desc, "sound": sound, "music": music, "prompt_sent": sent, "raw": raw,
        "method": method, "width": width, "height": height, "family": fam, "frames": frames,
        "seconds": round(seconds, 3), "fps": FPS, "steps": steps, "seed": seed,
        "sampler": "MiniMaxH3TurboSampler", "scheduler": "simple", "stages": stages, "draft": list(draft) if draft else None,
        "unet": unet, "unet_nom": next((u["nom"] for u in unets if u["f"] == unet), unet),
        "recipe_loras": [{"name": PEOPLE, "strength": 0.6}, {"name": CINE, "strength": 0.6}, {"name": TURBO_V4, "strength": 1.0}],
        "loras": loras, "ref_image_size": ref_size, "crf": crf,
        "estimate": est, "presets": presets, "canvases": rows, "weights": weights,
        "pictures": [{k: v for k, v in x.items() if k != "path"} | {"tag": f"<Picture {n}>"}
                     for n, x in enumerate(pictures, start=1)],
        "subjects": [{"tag": f"<Subject {k}>", "token": "@" + s["token"], "title": s["title"], "role": s["role"],
                      "pictures": [f"<Picture {n}>" for n in s["pics"]]} for k, s in enumerate(R["subjects"], start=1)],
        "videos": [{"tag": f"<Video {n}>", "token": "@" + v["token"], "role": v["role"], "sound": v["sound"],
                    "audio_tag": v.get("audio_tag")} for n, v in enumerate(R["videos"], start=1)],
        "audios": [{"tag": a["tag"], "token": "@" + a["token"] if a["token"] else None, "role": a["role"]} for a in R["audios"]],
        "mentions": {"@" + k: v for k, v in R["tags"].items()},
        "start": start["id"] if start else None, "end": end["id"] if end else None,
        "inputs": R["inputs"],
        "parents": parents, "_pictures": pictures, "_R": R,
    }
    if with_graph and not errors:
        names = [f"<{Path(x['path']).name}>" for x in pictures]
        out["graph"] = build_graph(mode, out, names, "showrunner/movie_apercu",
                                   videos=[f"<{Path(v['path']).name}>" for v in R["videos"]],
                                   audios=[f"<{Path(a['path']).name}>" for a in R["audios"]])
    return out


def public_plan(pl: dict) -> dict:
    return {k: v for k, v in pl.items() if not k.startswith("_")}


# ── le graphe ───────────────────────────────────────────────
def build_graph(mode: str, pl: dict, names: list[str], prefix: str, *, videos: list[str] | None = None,
                audios: list[str] | None = None) -> dict:
    """Le graphe ComfyUI du plan : la recette de Cal (h3_recette.json), le
    préréglage posé (Brouillon : les nœuds 30 à 34 du second étage, comme
    graphe() de test-meteorite.py). `names` : les images montées (dans
    l'ordre des `<Picture n>`), `videos`, `audios` : les fichiers montés."""
    tpl = json.loads((WF_DIR / MODES[mode]["workflow"]).read_text(encoding="utf-8"))
    tpl = {k: v for k, v in tpl.items() if not k.startswith("_")}
    seed = pl["seed"] if pl["seed"] is not None else 0
    values = {"prompt": pl["prompt_sent"], "width": pl["width"], "height": pl["height"], "length": pl["frames"],
              "steps": pl["steps"], "seed": seed, "unet": pl["unet"], "crf": pl["crf"], "prefix": prefix,
              "ref_image_size": pl["ref_image_size"]}
    g = fill(tpl, values)
    inp = g["6"]["inputs"]
    if mode in ("t2v", "i2v"):
        # le nœud Turbo documente « t2v et i2v » : MiniMaxH3ImageToVideo, sans audio_vae ni ref_image_size
        g["6"] = {"class_type": "MiniMaxH3ImageToVideo", "inputs": {k: v for k, v in inp.items()
                                                                     if k not in ("audio_vae", "ref_image_size")}}
        inp = g["6"]["inputs"]
        if mode == "i2v":
            k = 0
            for key, has in (("first_frame", pl["start"]), ("last_frame", pl["end"])):
                if has:
                    nid = str(20 + k)
                    g[nid] = {"class_type": "LoadImage", "inputs": {"image": names[k]},
                              "_meta": {"title": "première image" if key == "first_frame" else "dernière image"}}
                    inp[key] = [nid, 0]
                    k += 1
    if mode == "r2v":
        # les images dans l'ordre des places (@image1 = la première) : nœuds 20, 21… comme les scripts de Cal
        for k, nm in enumerate(names):
            nid = str(20 + k)
            g[nid] = {"class_type": "LoadImage", "inputs": {"image": nm}, "_meta": {"title": f"<Picture {k + 1}>"}}
            inp[f"ref_images.ref_image_{k}"] = [nid, 0]
        # vidéos (LoadVideo → GetVideoComponents) et sons (LoadAudio) : GRAPH_MAP.md de H3 Studio
        nid = 300
        for k, (v, fname) in enumerate(zip(pl["_R"]["videos"], videos or [])):
            g[str(nid)] = {"class_type": "LoadVideo", "inputs": {"file": fname}, "_meta": {"title": f"<Video {k + 1}>"}}
            g[str(nid + 1)] = {"class_type": "GetVideoComponents", "inputs": {"video": [str(nid), 0]}}
            inp[f"ref_videos.ref_video_{k}"] = [str(nid + 1), 0]
            if v["sound"]:
                inp[f"ref_video_audios.ref_video_audio_{k}"] = [str(nid + 1), 1]
            nid += 2
        for k, fname in enumerate(audios or []):
            g[str(nid)] = {"class_type": "LoadAudio", "inputs": {"audio": fname}, "_meta": {"title": f"son {k + 1}"}}
            inp[f"ref_audios.ref_audio_{k}"] = [str(nid), 0]
            nid += 1
    # Brouillon : la demi-toile, puis l'agrandisseur latent qui refait trois sigmas à la toile
    # (graphe() de test-meteorite.py : nœuds 30 à 34, graine + 1 pour le second bruit)
    if pl.get("stages") == 2 and pl.get("draft"):
        dw, dh = pl["draft"]
        # le conditionnement reste à la toile, le premier étage part d'un latent vide à la
        # demi-toile : le nœud 6 de Cal (test-meteorite.py). Pas en mode Images (plan() : un étage)
        g["30"] = {"class_type": "EmptyMiniMaxH3LatentAV", "inputs": {"width": dw, "height": dh, "length": pl["frames"]}}
        g["11"]["inputs"]["latent_image"] = ["30", 0]
        g["31"] = {"class_type": "ManualSigmas", "inputs": {"sigmas": DRAFT_SIGMAS}}
        g["32"] = {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}
        g["33"] = {"class_type": "RandomNoise", "inputs": {"noise_seed": seed + 1}}
        g["34"] = {"class_type": "MinimaxH3LatentUpscaler3DRefineHandoff", "inputs": {
            "latent": ["11", 0], "noise": ["33", 0], "sampler": ["32", 0], "sigmas": ["31", 0],
            "model_name": LATENT_UP, "mode": "target dimensions", "scale": 2.0, "width": pl["width"], "height": pl["height"],
            "megapixels": 1.0, "align": 32, "keep_proportion": True, "lock_audio": True, "cfg": 1.0, "device": "cuda",
            "precision": "bf16", "offload_after_upscale": False, "model": ["5", 0], "positive": ["6", 0]},
            "_meta": {"title": "agrandisseur latent · second étage"}}
        g["12"]["inputs"]["samples"] = ["34", 0]
        g["13"]["inputs"]["samples"] = ["34", 0]
    # les LoRA ajoutés (avancé), après la pile People → DY, avant le Turbo
    prev = ["102", 0]
    for k, l in enumerate(pl["loras"]):
        nid = str(50 + k)
        g[nid] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": prev, "lora_name": l["name"],
                                                                  "strength_model": l["strength"]}, "_meta": {"title": "LoRA"}}
        prev = [nid, 0]
    g["101"]["inputs"]["model"] = prev
    return g


def _combo_options(conf) -> list | None:
    if not isinstance(conf, list) or not conf:
        return None
    if isinstance(conf[0], list):
        return conf[0]
    if conf[0] == "COMBO" and len(conf) > 1 and isinstance(conf[1], dict):
        return conf[1].get("options")
    return None


def validate_graph(comfy: Comfy, g: dict) -> list[str]:
    """Le graphe contre le schéma réel de l'instance, avant d'envoyer :
    un nœud ou un fichier absent se dit tout de suite, pas après le
    chargement de 50 Go (garde-fou repris du banc H3)."""
    problems, cache = [], {}
    for nid, node in g.items():
        ct = node["class_type"]
        if ct not in cache:
            try:
                cache[ct] = comfy.object_info(ct).get(ct)
            except ComfyError:
                cache[ct] = None
        spec = cache[ct]
        if not spec:
            problems.append(f"nœud absent de l'instance H3 : {ct}")
            continue
        for name, conf in ((spec.get("input") or {}).get("required") or {}).items():
            if isinstance(conf, list) and conf and conf[0] == "COMFY_AUTOGROW_V3":
                continue
            if name not in node["inputs"]:
                problems.append(f"{ct} : entrée « {name} » manquante")
                continue
            val = node["inputs"][name]
            if isinstance(val, list):
                continue
            opts = _combo_options(conf)
            if opts is not None and val not in opts:
                problems.append(f"{ct} : « {val} » n'est pas sur cette machine ({name})")
    return problems


# ── la progression, lue sur le websocket de ComfyUI ─────────
PHASES = {
    "UNETLoader": (0.04, "charge le modèle vidéo H3"),
    "CLIPLoader": (0.08, "charge l'encodeur de texte Qwen3-VL 32B"),
    "VAELoader": (0.10, "charge les VAE"),
    "LoadImage": (0.11, "lit les images"),
    "LoadVideo": (0.11, "lit les vidéos de référence"),
    "LoadAudio": (0.11, "lit les sons de référence"),
    "LoraLoaderModelOnly": (0.12, "applique les LoRA"),
    "MiniMaxH3TurboLoRA": (0.12, "applique le LoRA Turbo"),
    "MiniMaxH3ImageToVideo": (0.14, "lit le prompt et les images"),
    "MiniMaxH3ReferenceToVideo": (0.14, "lit le prompt et les références"),
    "SamplerCustomAdvanced": (0.20, "échantillonne"),
    "MinimaxH3LatentUpscaler3DRefineHandoff": (0.56, "second étage : agrandit et affine"),
    # l'ordre relevé le 30/09 sur DGX2 : le son (≈ 2 s), puis l'image (≈ 20 s à 864 × 480)
    "VAEDecodeAudio": (0.87, "décode le son"),
    "VAEDecode": (0.88, "décode la vidéo"),
    "VHS_VideoCombine": (0.96, "assemble le mp4"),
}
SAMPLE_SPAN = (0.20, 0.86)


def _ws_frames(sock: socket.socket, buf: bytearray):
    """Lit les trames d'un websocket (serveur → client, non masquées)."""
    def need(n):
        while len(buf) < n:
            chunk = sock.recv(65536)
            if not chunk:
                raise ConnectionError("fermé")
            buf.extend(chunk)
    while True:
        need(2)
        b0, b1 = buf[0], buf[1]
        ln, off = b1 & 0x7F, 2
        if ln == 126:
            need(4)
            ln, off = struct.unpack(">H", bytes(buf[2:4]))[0], 4
        elif ln == 127:
            need(10)
            ln, off = struct.unpack(">Q", bytes(buf[2:10]))[0], 10
        if b1 & 0x80:
            off += 4
        need(off + ln)
        payload = bytes(buf[off:off + ln])
        del buf[:off + ln]
        yield b0 & 0x0F, payload


def _ws_send(sock: socket.socket, opcode: int, payload: bytes = b"") -> None:
    mask = os.urandom(4)
    head = bytes([0x80 | opcode])
    n = len(payload)
    head += bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n)
    sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))


def watch_progress(url: str, client_id: str, on_msg, stop: threading.Event) -> None:
    """Suit `/ws?clientId=…` : `executing` (le nœud en cours) et `progress`
    (les steps de l'échantillonneur). Une panne ici ne touche pas le rendu."""
    u = urlsplit(url)
    sock = None
    try:
        sock = socket.create_connection((u.hostname, u.port or 80), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        sock.sendall((f"GET /ws?clientId={client_id} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\n"
                      f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                      "Sec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = sock.recv(4096)
            if not chunk:
                return
            head += chunk
        status, rest = head.split(b"\r\n", 1)[0], head.split(b"\r\n\r\n", 1)[1]
        if b" 101" not in status:
            return
        sock.settimeout(1.0)
        buf = bytearray(rest)
        frames = _ws_frames(sock, buf)
        while not stop.is_set():
            try:
                op, payload = next(frames)
            except socket.timeout:
                frames = _ws_frames(sock, buf)
                continue
            if op == 1:
                try:
                    on_msg(json.loads(payload))
                except ValueError:
                    pass
            elif op == 8:
                return
            elif op == 9:
                _ws_send(sock, 0xA, payload)
    except (OSError, ConnectionError, StopIteration):
        return
    finally:
        if sock:
            try:
                sock.close()
            except OSError:
                pass


def _mmss(s: float) -> str:
    s = int(s)
    return f"{s // 60} min {s % 60:02d}" if s >= 60 else f"{s} s"


# ── la mémoire de la machine ────────────────────────────────
def _free_gb(c: Comfy) -> float:
    st = c.ping(timeout=5)
    return (st.get("system") or {}).get("ram_free", 0) / 1e9


def neighbour(endpoint: str) -> str:
    """L'autre ComfyUI de la machine qui porte cette instance H3 : le :8188
    d'une instance H3TEST, l'instance H3TEST (:8189) d'un :8188."""
    u = urlsplit(endpoint)
    port = int(config.get("h3_neighbour_port", 8188))
    if u.port == port:
        port = int(config.get("h3_service_port", 8189))
    return f"{u.scheme}://{u.hostname}:{port}"


def unload_ollama(machine: str) -> list[str]:
    """Les modèles de texte qu'Ollama garde sur la machine, déchargés
    (`keep_alive: 0`) : comme `unload_llm` de Character_Factory/factory/memory.py.
    Un modèle de 30 Go gardé à côté d'H3 (~100 Go) sature un Spark
    (docs/etudes/orchestration.md § 3.1)."""
    import urllib.request
    url = str((config.get("machine_ollama") or {}).get(machine) or "").rstrip("/")
    if not url:
        return []
    gone = []
    try:
        with urllib.request.urlopen(url + "/api/ps", timeout=5) as r:
            names = [m["name"] for m in json.loads(r.read()).get("models", [])]
        for name in names:
            req = urllib.request.Request(url + "/api/generate", data=json.dumps({"model": name, "keep_alive": 0}).encode(),
                                         method="POST", headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                r.read()
            gone.append(name)
    except (OSError, ValueError, KeyError):
        pass
    return gone


def memory_guard(ctx) -> float:
    need = float(config.get("h3_min_free_gb", 45))
    machine = jobs.machine_of(ctx.endpoint)
    free = _free_gb(ctx.comfy)
    if free >= need:
        return free
    ctx.progress(message=f"{free:.0f} Go libres sur {machine}, il en faut {need:.0f} : décharge les modèles")
    try:   # 1. les restes d'un rendu H3 précédent (l'autre mode, un autre modèle)
        ctx.comfy.free()
    except ComfyError:
        pass
    gone = unload_ollama(machine)   # 2. le modèle de texte de la machine
    if gone:
        ctx.progress(message=f"modèle de texte déchargé sur {machine} : {', '.join(gone)}")
    busy = []
    for url in dict.fromkeys([neighbour(ctx.endpoint)] + machines.instances_of(machine)):
        if url == ctx.endpoint:
            continue
        # 3. les autres ComfyUI de la même machine, seulement si leur file est vide :
        # on ne décharge jamais sous le travail d'un autre (core/machines.py, free_instance)
        try:
            q = Comfy(url, timeout=10).queue_state()
            n = len(q.get("queue_running", [])) + len(q.get("queue_pending", []))
            if n:
                busy.append(f"le ComfyUI :{urlsplit(url).port} de {machine} calcule encore ({n} en file)")
            else:
                Comfy(url, timeout=10).free()
        except ComfyError:
            pass
    for _ in range(20):
        time.sleep(3)
        ctx.check()
        free = _free_gb(ctx.comfy)
        if free >= need:
            return free
    why = (" ; ".join(busy) + " : relancez quand il aura fini") if busy else "un autre programme occupe la mémoire"
    raise RuntimeError(f"Mémoire insuffisante sur {machine} : {free:.0f} Go libres après déchargement, "
                       f"H3 en demande {need:.0f}. {why[0].upper() + why[1:]}.")


# ── le rendu ────────────────────────────────────────────────
def _prep_start(ctx, pic: dict, width: int, height: int, name: str = "premiere.png") -> Path:
    """Une image recadrée au centre au rapport de la toile :
    MiniMaxH3ImageToVideo étire la première (« plain stretch to canvas »)."""
    from PIL import Image
    with Image.open(pic["path"]) as im:
        im = im.convert("RGB")
        target = width / height
        w, h = im.size
        if abs(math.log((w / h) / target)) > 0.01:
            if w / h > target:
                nw = round(h * target)
                im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
            else:
                nh = round(w / target)
                im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
        dest = ctx.workdir / name
        im.save(dest)
    return dest


# ce que la page envoie pour un plan (movie.js, params()) : de quoi le refaire tel quel
REQUEST_KEYS = ("desc", "sound", "music", "method", "frames", "steps", "seed", "canvas", "loras", "adv",
                "start", "end", "inputs", "ref_image_size")


def request_of(rec: dict) -> dict:
    """Les réglages d'envoi d'une vidéo faite ici : ceux qu'elle a reçus
    (`request`, rangés depuis le 29/09), sinon refaits depuis sa recette
    (les vidéos d'avant). movie.js, requestOf(), fait le même."""
    if isinstance(rec.get("request"), dict):
        return {k: v for k, v in rec["request"].items() if k in REQUEST_KEYS}
    return {"desc": rec.get("desc", ""), "sound": rec.get("sound", ""), "music": rec.get("music", ""),
            "method": rec.get("method"), "frames": rec.get("frames"), "steps": rec.get("steps"), "seed": rec.get("seed"),
            "canvas": "auto" if rec.get("family") == "image" else [rec.get("width"), rec.get("height")],
            "loras": rec.get("loras") or [],
            "adv": {"unet": rec.get("unet"), "crf": rec.get("crf")},
            "start": rec.get("start"), "end": rec.get("end"), "inputs": rec.get("inputs") or {},
            "ref_image_size": rec.get("ref_image_size")}


def _recipe(pl: dict, eng: str) -> dict:
    """De quoi refaire le plan : ce que « Reprendre ces réglages » relit et
    ce que le banc compare ; le graphe H3 y est rangé tel qu'il partirait."""
    r = {k: pl[k] for k in ("mode", "method", "width", "height", "family", "frames", "seconds", "fps", "steps", "seed",
                            "sampler", "scheduler", "stages", "draft", "unet", "recipe_loras", "loras", "ref_image_size",
                            "crf", "desc", "sound", "music", "raw", "start", "end", "inputs", "estimate", "weights")}
    r["engine"] = eng
    r["prompt_sent"] = pl["prompt_sent"]
    r["pictures"] = [{"tag": x["tag"], "item": x["item"], "label": x["label"], "role": x["role"]} for x in pl["pictures"]]
    r["mentions"] = pl["mentions"]
    return r


def _store(ctx, pl: dict, path: Path, *, secs: float, machine: str, model: str, eng: str, graph: dict | None) -> dict:
    title = " ".join(pl["desc"].split())[:70] or MODES[pl["mode"]]["label"]
    tags = [("h3" if eng == "h3" else "factice"), pl["mode"], pl["method"]]
    params = _recipe(pl, eng)
    # les réglages tels qu'envoyés : « Réutiliser » et « Recréer » (POST
    # /api/movie/redo) repartent d'eux, pas d'une recette relue
    params["request"] = {k: v for k, v in (ctx.params or {}).items() if k in REQUEST_KEYS}
    if graph:
        params["graph"] = graph
    it = ctx.add(path, kind="video", title=title, prompt=pl["desc"], params=params,
                 parents=pl["parents"], tags=tags, origin={"model": model},
                 extra={"render_seconds": secs, "machine": machine})
    note = (f"{'avec' if it.get('audio') else 'sans'} son · {it.get('width')}×{it.get('height')} · "
            f"{'vidéo d’essai ' if eng != 'h3' else ''}rendue en {_mmss(secs)}")
    ctx.progress(1.0, note)
    return {"note": note, "render_seconds": secs, "machine": machine, "engine": eng}


def run_stub(ctx, mode: str, pl: dict, t0: float) -> dict:
    """Le moteur factice : une vraie vidéo, pas H3. La mire testsrc2 à la
    taille du plan, les images posées dessus (la première puis la dernière,
    ou chaque référence à son tour), un bip dont la hauteur suit la graine
    — deux plans se distinguent à l'œil et à l'oreille dans le banc. Les
    étapes d'H3 défilent au rythme de `movie_stub_step_s`. Le graphe H3
    est construit (images nommées comme elles monteraient) et rangé."""
    step_s = float(config.get("movie_stub_step_s", 0.8))
    w, h, dur = pl["width"], pl["height"], pl["frames"] / FPS
    names = [f"sr_movie_{ctx.job['id']}_{k + 1}{Path(x['path']).suffix.lower()}" for k, x in enumerate(pl["_pictures"])]
    graph = build_graph(mode, pl, names, f"showrunner/movie_{ctx.job['id']}",
                        videos=[Path(v["path"]).name for v in pl["_R"]["videos"]],
                        audios=[Path(a["path"]).name for a in pl["_R"]["audios"]])
    ctx.progress(0.05, "factice · lit les images")
    time.sleep(step_s)
    for k in range(pl["steps"]):
        ctx.check()
        a, b = SAMPLE_SPAN
        ctx.progress(a + (b - a) * k / pl["steps"], f"factice · step {k + 1}/{pl['steps']}")
        time.sleep(step_s)
    ctx.progress(0.9, "factice · encode la vidéo d'essai (ffmpeg)")
    pics = pl["_pictures"]
    if mode == "i2v" and pics and pl["start"]:
        srcs = [_prep_start(ctx, pics[0], w, h)] + [p["path"] for p in pics[1:]]
    else:
        srcs = [p["path"] for p in pics]
    bw, bh = int(w * 0.86) // 2 * 2, int(h * 0.86) // 2 * 2
    argv = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size={w}x{h}:rate={FPS}:duration={dur:.3f}"]
    for s in srcs:
        argv += ["-loop", "1", "-framerate", str(FPS), "-t", f"{dur:.3f}", "-i", str(s)]
    freq = 220 + (pl["seed"] % 7) * 55
    argv += ["-f", "lavfi", "-i", f"sine=frequency={freq}:beep_factor=4:sample_rate=48000:duration={dur:.3f}"]
    chain, last = [], "0:v"
    span = dur / max(1, len(srcs))
    for k in range(len(srcs)):
        chain.append(f"[{k + 1}:v]scale={bw}:{bh}:force_original_aspect_ratio=decrease,format=yuv420p[p{k}]")
        t_a, t_b = k * span, (k + 1) * span if k < len(srcs) - 1 else dur + 1
        chain.append(f"[{last}][p{k}]overlay=(W-w)/2:(H-h)/2:enable='between(t,{t_a:.3f},{t_b:.3f})'[v{k}]")
        last = f"v{k}"
    if not chain:
        chain, last = ["[0:v]null[v0]"], "v0"
    argv += ["-filter_complex", ";".join(chain), "-map", f"[{last}]", "-map", f"{len(srcs) + 1}:a",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "160k", "-r", str(FPS), "-t", f"{dur:.3f}", str(ctx.workdir / "plan.mp4")]
    r = subprocess.run(argv, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg (vidéo d'essai) : " + (r.stderr or "").strip()[-600:])
    return _store(ctx, pl, ctx.workdir / "plan.mp4", secs=round(time.time() - t0, 1),
                  machine=jobs.machine_of(ctx.endpoint), model="factice · ffmpeg testsrc2 (pas H3)", eng="factice",
                  graph=graph)


def run(ctx, mode: str) -> dict:
    t0 = time.time()
    pl = plan(mode, ctx.params)
    if pl["errors"]:
        raise RuntimeError(" ; ".join(pl["errors"]))
    if pl["seed"] is None:
        pl["seed"] = random.randrange(1, 2**31 - 1)
    ctx.job["estimate"] = pl["estimate"]
    pics = pl["_pictures"]
    if pics and pics[0].get("thumb_url"):
        ctx.job["thumb"] = pics[0]["thumb_url"]
    if engine() != "h3" or ctx.comfy is None:
        return run_stub(ctx, mode, pl, t0)
    machine = jobs.machine_of(ctx.endpoint)
    ctx.progress(0.01, f"lit la mémoire de {machine}")
    free = memory_guard(ctx)
    ctx.check()
    ctx.progress(0.02, f"{free:.0f} Go libres · envoie les références")
    names = []
    for k, pic in enumerate(pics):
        path = _prep_start(ctx, pic, pl["width"], pl["height"]) if (mode == "i2v" and k == 0 and pl["start"]) else pic["path"]
        names.append(ctx.comfy.upload(path, f"sr_movie_{ctx.job['id']}_{k + 1}{Path(path).suffix.lower()}"))
    vids = [ctx.comfy.upload(v["path"], f"sr_movie_{ctx.job['id']}_v{k + 1}{Path(v['path']).suffix.lower()}")
            for k, v in enumerate(pl["_R"]["videos"])]
    auds = [ctx.comfy.upload(a["path"], f"sr_movie_{ctx.job['id']}_a{k + 1}{Path(a['path']).suffix.lower()}")
            for k, a in enumerate(pl["_R"]["audios"])]
    graph = build_graph(mode, pl, names, f"showrunner/movie_{ctx.job['id']}", videos=vids, audios=auds)
    ctx.progress(0.03, "vérifie le graphe contre l'instance")
    problems = validate_graph(ctx.comfy, graph)
    if problems:
        raise RuntimeError("graphe refusé avant l'envoi : " + " | ".join(problems[:6]))
    kinds = {nid: n["class_type"] for nid, n in graph.items()}
    seen = {"frac": 0.03}

    def forward(frac, label):
        # ComfyUI décode le son avant ou après l'image selon l'ordre du graphe
        # (relevé le 30/09 : le son d'abord) : la barre ne recule jamais
        seen["frac"] = max(seen["frac"], frac)
        ctx.progress(seen["frac"], label)

    two = pl.get("stages") == 2
    spans = {"SamplerCustomAdvanced": ((0.20, 0.55) if two else SAMPLE_SPAN,
                                       "premier étage" if two else "échantillonne"),
             "MinimaxH3LatentUpscaler3DRefineHandoff": ((0.56, 0.86), "second étage")}

    def on_msg(m):
        d = m.get("data") or {}
        if m.get("type") == "executing" and d.get("node"):
            frac, label = PHASES.get(kinds.get(str(d["node"]), ""), (None, None))
            if label:
                forward(frac, label)
        elif m.get("type") == "progress" and kinds.get(str(d.get("node"))) in spans:
            (a, b), label = spans[kinds[str(d["node"])]]
            v, mx = d.get("value") or 0, d.get("max") or 1
            # le compte de l'échantillonneur n'est pas toujours celui des pas (8 pour 4
            # pas avec Spectrum, relevé le 30/09) — on dit « passe », pas « pas »
            forward(a + (b - a) * v / mx, f"{label} · passe {v}/{mx}")

    def report(state, ahead):
        if state == "wait":
            ctx.progress(message=f"attend ComfyUI H3 · {ahead} devant")

    stop = threading.Event()
    threading.Thread(target=watch_progress, args=(ctx.endpoint, ctx.comfy.client_id, on_msg, stop),
                     daemon=True, name="movie-ws").start()
    time.sleep(0.4)
    try:
        pid = ctx.comfy.queue(graph)
        entry = ctx.comfy.wait(pid, cancelled=ctx.cancelled, report=report, timeout=4 * 3600)
    finally:
        stop.set()
    files = [f for f in Comfy.outputs(entry, graph) if f["filename"].lower().endswith(".mp4")]
    files.sort(key=lambda f: "-audio" not in f["filename"])   # la version avec le son d'abord
    if not files:
        raise RuntimeError(f"H3 n'a rendu aucun mp4 (voir le journal du ComfyUI de {machine})")
    ctx.progress(0.98, "rapatrie le mp4")
    dest = ctx.comfy.download(files[0], ctx.workdir / "plan.mp4")
    loras = " + ".join([l["name"].split("/")[-1].replace(".safetensors", "") for l in pl["loras"]])
    model = (f"MiniMax H3 {pl['weights']} · {pl['unet_nom']} · recette de Cal, {METHODS[pl['method']]['label']}"
             + (f" + {loras}" if loras else ""))
    return _store(ctx, pl, dest, secs=round(time.time() - t0, 1), machine=machine, model=model, eng="h3", graph=graph)


def run_t2v(ctx):
    return run(ctx, "t2v")


def run_i2v(ctx):
    return run(ctx, "i2v")


def run_r2v(ctx):
    return run(ctx, "r2v")


# ── les LoRA installés ──────────────────────────────────────
LORA_NOTES = {   # ce qu'on sait de chacun : sources dans docs/etudes/movie.md
    "h3-realism-people-t2v-i2v-r2v.safetensors": {
        "nom": "Realism People · visages, mouvement", "modes": ["t2v", "i2v", "r2v"], "force": 1.0,
        "note": "les trois modes ; déclencheur r34l1sm ; 1.0 prévu (H3 Studio). Cal : 0.6 avec le LoRA cinéma (V5) ; "
                "ajoute du détail de peau, vieillit un visage jeune (essais d'expression)."},
    "h3-cinematic-texture-DY-v0.1.safetensors": {
        "nom": "Texture cinéma DY v0.1", "modes": ["t2v", "i2v", "r2v"], "force": 0.6,
        "note": "déclencheur DY ; 0.7 conseillé, 0.5 en mouvement ; 0.6 dans V5 du banc. v0.1 : 50 modules sur 258 "
                "ne se chargent pas (la v1.0 corrigée est sur Civitai)."},
    "MysticXXX_MMH3-V4.safetensors": {
        "nom": "Mystic XXX V4 (adulte)", "modes": ["t2v", "i2v"], "force": 1.0, "warn": True,
        "note": "LoRA adulte : Cal l'a exclu pour ses personnages (vieillit, fait zoomer le cadrage, 25/09)."},
    "MysticXXX_MMH3-V4-ref2va.safetensors": {
        "nom": "Mystic XXX V4 ref2va (adulte)", "modes": ["r2v"], "force": 1.0, "warn": True,
        "note": "LoRA adulte : Cal l'a exclu pour ses personnages (25/09)."},
    "minimax_h3_flf2v_orbit360_v1.safetensors": {
        "nom": "Orbite 360°", "modes": ["i2v"], "force": 1.0,
        "note": "une orbite complète autour du sujet (première + dernière image) ; Character Factory s'en sert."},
}
ACCEL_RX = re.compile(r"turbo|taomate|lightx2v|ema", re.I)


def _lora_names() -> tuple[list[str], str]:
    """La liste des LoRA de la machine H3 (sinon d'une instance :8188 qui
    partage le dossier des modèles), lue sur /object_info — rien n'est
    démarré pour la lire."""
    eps = h3_endpoints() + [e for e in (config.get("lanes") or {}).get("image", []) if e.startswith("http")]
    for ep in eps:
        if not jobs.endpoint_alive(ep, max_age=30)[0]:
            continue
        try:
            info = Comfy(ep, timeout=15).object_info("LoraLoaderModelOnly")["LoraLoaderModelOnly"]
            opts = _combo_options(info["input"]["required"]["lora_name"]) or []
            # `training_adapters/` : l'adaptateur d'entraînement qu'ai-toolkit y télécharge
            # (minimax_h3_training_adapter_v3, 05/10) — pas un LoRA de rendu
            return [o for o in opts if not str(o).startswith("training_adapters/")], jobs.machine_of(ep)
        except (ComfyError, KeyError, TypeError):
            continue
    return [], ""


def r_loras(req):
    from tools import lora as moodlora
    names, machine = _lora_names()
    out = []
    for n in names:
        base = n.split("/")[-1]
        low = n.lower()
        if n.startswith(moodlora.COMFY_DIR):
            # un LoRA de moodboard entraîné par le portail (h3-<moodboard>-v001-fl2v) : par son préfixe, pas par
            # les mots de son nom (« cinema » contient « ema », que ACCEL_RX prendrait pour un accélérateur)
            mb = moodlora.info(n)
            if mb and not mb.get("hidden") and mb["model"] == "h3":
                v = f" · v{mb['v']}" if mb.get("v") else ""
                out.append({"name": n, "nom": f"{mb['title']}{v}", "modes": ["t2v", "i2v"], "force": 1.0, "accel": False,
                            "warn": False, "moodboard": True, "trigger": mb["trigger"],
                            "note": "LoRA de moodboard (Idéation), entraîné par le portail sur des images (fl2va)"
                                    + (f" ; son mot déclencheur « {mb['trigger']} » se met en tête de la description"
                                       if mb["trigger"] else "")})
            continue
        if not ("minimax" in low or "h3" in low or "mmh3" in low):
            continue
        known = LORA_NOTES.get(base, {})
        accel = bool(ACCEL_RX.search(base)) and not known
        if base in RECIPE_LORAS:
            out.append({"name": n, "nom": known.get("nom") or base.replace(".safetensors", ""), "modes": ["t2v", "i2v", "r2v"],
                        "force": {PEOPLE: 0.6, CINE: 0.6}.get(base, 1.0), "note": "dans la recette de Cal : toujours posé",
                        "accel": base == TURBO_V4, "warn": False, "recipe": True})
            continue
        if accel:
            modes, note = (["r2v"] if "ref2v" in low else ["t2v", "i2v"] if ("fl2v" in low or "flf2v" in low) else ["t2v", "i2v", "r2v"]), \
                "accélérateur : la recette pose le Turbo v4 ; on n'en cumule pas deux"
        else:
            modes = known.get("modes") or (["r2v"] if "ref2v" in low else ["t2v", "i2v"] if ("fl2v" in low or "flf2v" in low)
                                            else ["t2v", "i2v", "r2v"])
            note = known.get("note") or "compatibilité inconnue tant qu'elle n'est pas essayée sur la machine"
        out.append({"name": n, "nom": known.get("nom") or base.replace(".safetensors", ""), "modes": modes,
                    "force": known.get("force", 1.0), "note": note, "accel": accel, "warn": bool(known.get("warn"))})
    out.sort(key=lambda x: (not x.get("recipe"), not x.get("moodboard"), x["accel"], x["warn"], x["nom"].lower()))
    return {"loras": out, "machine": machine,
            "why": "" if machine else "aucune instance ComfyUI ne répond : la liste se lit sur /object_info"}


# ── H3 à la demande ─────────────────────────────────────────
_h3 = {"started": {}, "last_busy": {}, "starting": {}, "errors": {}, "stopped": {}}
_h3_lock = threading.Lock()
START_TIMEOUT = 300.0
_keeper_on = False


def _state_file() -> Path:
    return config.data_dir() / "movie_h3.json"


def _save_state() -> None:
    try:
        _state_file().write_text(json.dumps({"started": _h3["started"], "last_busy": _h3["last_busy"]}),
                                 encoding="utf-8")
    except OSError:
        pass


def _load_state() -> None:
    try:
        d = json.loads(_state_file().read_text(encoding="utf-8"))
        _h3["started"].update(d.get("started") or {})
        _h3["last_busy"].update(d.get("last_busy") or {})
    except (OSError, ValueError):
        pass


def h3_endpoints() -> list[str]:
    """Les instances ComfyUI de la voie h3 (« local » n'en est pas une)."""
    return [ep for ep in ((config.get("lanes") or {}).get("h3") or []) if ep.startswith("http")]


def managed(endpoint: str) -> bool:
    """Une instance que le gardien démarre et arrête : ComfyUI-H3TEST
    (`h3_service`, sur `h3_service_port`). Les ComfyUI :8188, où tourne la
    recette de Cal, ne sont jamais démarrés ni arrêtés ici."""
    try:
        return urlsplit(endpoint).port == int(config.get("h3_service_port", 8189))
    except ValueError:
        return False


def _on_host(endpoint: str, cmd: str, timeout: float = 40) -> subprocess.CompletedProcess:
    host = urlsplit(endpoint).hostname
    if host in ("127.0.0.1", "localhost", "::1"):
        argv = ["sh", "-c", cmd]
    else:   # par le câble direct, avec la clé de la machine (BatchMode : jamais de question)
        argv = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", host, cmd]
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout)


def _service(endpoint: str, action: str) -> tuple[bool, str]:
    svc = config.get("h3_service", "comfyui-h3test")
    try:
        r = _on_host(endpoint, f"sudo -n systemctl {action} {svc}")
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)
    return r.returncode == 0, (r.stderr or r.stdout).strip()[:300]


def _host_free_gb(endpoint: str) -> float | None:
    try:
        r = _on_host(endpoint, "awk '/MemAvailable/ {print $2}' /proc/meminfo", timeout=15)
        return int(r.stdout.strip()) / 1048576 if r.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None


def _busy(endpoint: str) -> bool:
    try:
        q = Comfy(endpoint, timeout=5).queue_state()
        return bool(q.get("queue_running") or q.get("queue_pending"))
    except ComfyError:
        return False


def start_h3(endpoint: str | None = None) -> dict:
    """Démarre une instance H3 : celle demandée, sinon celle de la machine
    qui a le plus de mémoire libre."""
    if engine() != "h3":
        raise HttpError(409, "moteur factice : H3 n'est pas câblé ici (movie_engine), on ne le démarre pas")
    eps = [ep for ep in h3_endpoints() if managed(ep)]
    if not eps:
        raise HttpError(409, "aucune instance H3 à démarrer : la voie h3 ne compte que des ComfyUI toujours allumés "
                             f"({', '.join(jobs.machine_of(e) + ' :' + str(urlsplit(e).port) for e in h3_endpoints()) or 'aucun'})")
    if endpoint and endpoint not in eps:
        raise HttpError(400, f"instance inconnue : {endpoint}")
    with _h3_lock:
        for ep in eps:
            if jobs.endpoint_alive(ep, max_age=2)[0] and (not endpoint or ep == endpoint):
                return {"endpoint": ep, "machine": jobs.machine_of(ep), "already": True}
        now = time.time()
        pending = [ep for ep, t in _h3["starting"].items() if now - t < START_TIMEOUT]
        if pending and (not endpoint or endpoint in pending):
            ep = endpoint or pending[0]
            return {"endpoint": ep, "machine": jobs.machine_of(ep), "starting": True}
        if not endpoint:
            mem = [(ep, _host_free_gb(ep)) for ep in eps]
            known = [(ep, g) for ep, g in mem if g is not None]
            endpoint = max(known, key=lambda x: x[1])[0] if known else eps[0]
        ok, why = _service(endpoint, "start")
        if not ok:
            _h3["errors"][endpoint] = f"démarrage refusé : {why}"
            raise HttpError(502, f"H3 ne démarre pas sur {jobs.machine_of(endpoint)} : {why}")
        _h3["errors"].pop(endpoint, None)
        _h3["starting"][endpoint] = now
        _h3["started"][endpoint] = now
        _h3["last_busy"][endpoint] = now
        _save_state()
        return {"endpoint": endpoint, "machine": jobs.machine_of(endpoint), "starting": True}


def stop_h3(endpoint: str, why: str = "") -> dict:
    if not managed(endpoint):   # un ComfyUI :8188 (la recette de Cal) : jamais arrêté d'ici, comme start_h3
        raise HttpError(409, f"{jobs.machine_of(endpoint)} :{urlsplit(endpoint).port} est un ComfyUI toujours allumé "
                             "(la voie h3) : le portail ne l'arrête pas")
    if _busy(endpoint):
        raise HttpError(409, f"H3 calcule sur {jobs.machine_of(endpoint)} : on ne l'arrête pas en plein rendu")
    ok, err = _service(endpoint, "stop")
    with _h3_lock:
        if ok:
            _h3["started"].pop(endpoint, None)
            _h3["starting"].pop(endpoint, None)
            _h3["stopped"][endpoint] = {"t": time.time(), "why": why}
            _save_state()
    if not ok:
        raise HttpError(502, f"arrêt refusé sur {jobs.machine_of(endpoint)} : {err}")
    return {"endpoint": endpoint, "stopped": True}


def _keeper_tick() -> None:
    eps = h3_endpoints()
    if not eps:
        return
    now = time.time()
    idle = float(config.get("h3_idle_minutes", 10)) * 60
    active = [j for j in jobs.listing(limit=400) if j.get("lane") == "h3" and j["state"] in ("queued", "running")]
    up = {}
    for ep in eps:
        up[ep] = jobs.endpoint_alive(ep, max_age=4)[0]
        if up[ep]:
            if ep in _h3["starting"]:
                _h3["started"][ep] = _h3["starting"].pop(ep)
                _h3["ready_after"] = round(now - _h3["started"][ep])
            if _busy(ep) or any(j.get("endpoint") == ep for j in active):
                _h3["last_busy"][ep] = now
    queued = [j for j in active if j["state"] == "queued"]
    if queued and not any(up.values()):
        if not any(managed(ep) for ep in eps):
            # rien à démarrer : les ComfyUI de la voie sont éteints (machine arrêtée, service tombé)
            msg = ("en attente : aucune instance H3 ne répond (" + ", ".join(f"{jobs.machine_of(ep)} :{urlsplit(ep).port}"
                                                                          for ep in eps) + ") — machine éteinte ou ComfyUI arrêté")
        else:
            try:
                got = start_h3()
                t_start = _h3["starting"].get(got["endpoint"], now)
                msg = f"H3 démarre sur {got['machine']} · {_mmss(now - t_start)}"
            except HttpError as e:
                msg = e.message
        for j in queued:
            real = jobs.get(j["id"])
            if real and real["state"] == "queued":
                real["message"] = msg
    for ep, t in list(_h3["starting"].items()):
        if now - t > START_TIMEOUT:
            _h3["starting"].pop(ep, None)
            _h3["errors"][ep] = (f"H3 n'a pas répondu {int(START_TIMEOUT)} s après son démarrage "
                                 "(journalctl -u comfyui-h3test)")
    for ep, t in list(_h3["started"].items()):   # l'arrêt : seulement une instance démarrée ici
        if ep in _h3["starting"]:
            continue
        if not up.get(ep):
            if now - t > START_TIMEOUT:
                _h3["started"].pop(ep, None)
                _save_state()
            continue
        if active:
            continue
        if now - max(_h3["last_busy"].get(ep, 0), t) > idle:
            try:
                stop_h3(ep, f"{int(idle // 60)} min sans rendu")
            except HttpError as e:
                _h3["errors"][ep] = e.message
    _save_state()


def _keeper() -> None:
    _load_state()
    while True:
        time.sleep(5)
        try:
            _keeper_tick()
        except Exception as e:  # le gardien ne tombe jamais
            _h3["errors"]["keeper"] = f"{type(e).__name__}: {e}"


def h3_status(req=None) -> dict:
    now = time.time()
    base = {"engine": engine(), "idle_minutes": config.get("h3_idle_minutes", 10),
            "min_free_gb": config.get("h3_min_free_gb", 45), "ready_after": _h3.get("ready_after")}
    if engine() != "h3":
        return {**base, "instances": []}
    out = []
    for ep in h3_endpoints():
        ok, _ = jobs.endpoint_alive(ep, max_age=4)
        e = {"url": ep, "machine": jobs.machine_of(ep), "port": urlsplit(ep).port, "managed": managed(ep), "up": ok,
             "started_here": ep in _h3["started"], "error": _h3["errors"].get(ep)}
        if ep in _h3["starting"]:
            e["starting_for"] = round(now - _h3["starting"][ep])
        if ok:
            try:
                e["free_gb"] = round(_free_gb(Comfy(ep, timeout=5)), 1)
            except ComfyError:
                pass
            e["busy"] = _busy(ep)
            if ep in _h3["started"]:
                last = max(_h3["last_busy"].get(ep, 0), _h3["started"][ep])
                e["stops_in"] = max(0, round(float(config.get("h3_idle_minutes", 10)) * 60 - (now - last)))
        if ep in _h3["stopped"]:
            e["stopped"] = {"ago": round(now - _h3["stopped"][ep]["t"]), "why": _h3["stopped"][ep]["why"]}
        out.append(e)
    return {**base, "instances": out}


# ── les routes ──────────────────────────────────────────────
def r_options(req):
    return {
        "modes": [{"id": k, "label": m["label"], "sub": m["sub"], "weights": m["weights"]} for k, m in MODES.items()],
        "methods": [{"id": k, "label": m["label"], "sub": m["sub"], "steps": list(m["steps"]), "note": m["note"],
                     "canvas": list(m["canvas"]), "stages": m["stages"], "refs": m["refs"], "cal": m["cal"]}
                    for k, m in METHODS.items()],
        "default_method": DEFAULT_METHOD,
        "recipe": {"loras": [{"name": PEOPLE, "strength": 0.6}, {"name": CINE, "strength": 0.6}, {"name": TURBO_V4, "strength": 1.0}],
                   "tag": QUALITY_TAG, "sampler": "MiniMaxH3TurboSampler", "scheduler": "simple", "shift": [12, 3],
                   "attention": "comfy kitchen attention + Sol-Attn (tau 1,3)",
                   "source": "Cal, 30/09 : RECETTE-DRAFT-QUALITE.md, test-meteorite*.py"},
        "canvases": [{"w": w, "h": h, "family": f, "label": l, "source": s} for w, h, f, l, s in CANVASES],
        "families": FAMILIES, "frames": [{"frames": f, "seconds": round(f / FPS, 2)} for f in FRAMES], "fps": FPS,
        "roles": {k: [{"id": r, "label": lab} for r, lab in v] for k, v in ROLES.items()},
        "limits": LIMITS, "camera": [{"id": a, "phrase": b} for a, b in CAMERA],
        "unets": UNETS,
        "min_free_gb": config.get("h3_min_free_gb", 45), "idle_minutes": config.get("h3_idle_minutes", 10),
        "engine": engine(), "llm": False,
    }


def r_plan(req):
    d = req.json()
    return public_plan(plan(d.get("mode", ""), d.get("params") or {}, with_graph=bool(d.get("graph"))))


def r_element_image(req):
    """Une référence d'élément comme image de la bibliothèque (le plein pied
    d'un personnage en première image). Déjà là : on la rend telle quelle."""
    d = req.json()
    el = library.get(d.get("element") or "")
    if not el or el["kind"] != "element":
        raise HttpError(404, "élément introuvable")
    ref = next((r for r in el["element"]["refs"] if r["file"] == d.get("file")), None)
    if not ref:
        raise HttpError(404, "référence introuvable dans cet élément")
    if ref.get("item") and library.get(ref["item"]):
        return library.public(library.get(ref["item"]))
    for it in library.query(["image"], limit=100000)["items"]:
        p = it.get("params") or {}
        if p.get("from_element") == el["id"] and p.get("file") == ref["file"]:
            return it
    label = ref.get("label") or ROLE_FR.get(ref.get("role"), ref.get("role") or "réf.")
    it = library.add_file(library.path_of(el, ref["file"]), kind="image", title=f"{el['title']} · {label}",
                          origin={"tool": "asset"}, params={"from_element": el["id"], "file": ref["file"]},
                          parents=[el["id"]], folder=el.get("folder") or "")
    return library.public(it)


def r_redo(req):
    """Recréer une vidéo du fil : ses réglages d'envoi, une nouvelle graine
    (ou la même, `same_seed`), remise en file au nom de la personne."""
    d = req.json()
    it = library.get(d.get("item") or "")
    if not it or it["kind"] != "video":
        raise HttpError(404, "vidéo introuvable")
    rec = it.get("params") or {}
    mode = rec.get("mode")
    if mode not in MODES:
        raise HttpError(409, "cette vidéo n'a pas de recette de l'outil Vidéo (déposée, ou faite ailleurs)")
    p = request_of(rec)
    if d.get("same_seed"):
        if rec.get("seed") is None:
            raise HttpError(409, "la graine de cette vidéo n'a pas été gardée : « à l'identique » est impossible")
        p["seed"] = rec["seed"]
    else:
        p["seed"] = random.randrange(1, 2 ** 31 - 1)
    pl = plan(mode, p)
    if pl["errors"]:
        raise HttpError(409, "la recette ne passe plus : " + " ; ".join(pl["errors"]))
    title = ("Refaire · " if d.get("same_seed") else "Recréer · ") + (it.get("title") or MODES[mode]["label"])[:60]
    return jobs.public(jobs.submit("movie." + mode, p, title=title, tool="movie"))


def r_frame(req):
    """La première ou la dernière image d'une vidéo, rangée dans la
    bibliothèque (une seule fois : redemandée, elle est rendue telle quelle).
    ffmpeg : la première image décodée ; la dernière, en relisant la fin
    (`-sseof`) et en gardant l'image écrite en dernier (`-update 1`)."""
    import shutil
    import tempfile
    d = req.json()
    it = library.get(d.get("item") or "")
    if not it or it["kind"] != "video":
        raise HttpError(404, "vidéo introuvable")
    which = d.get("which")
    if which not in ("first", "last"):
        raise HttpError(400, "which : first (la première image) ou last (la dernière)")
    for x in library.query(["image"], limit=100000)["items"]:
        p = x.get("params") or {}
        if p.get("from_video") == it["id"] and p.get("frame") == which:
            return x
    src = library.path_of(it)
    tmp = Path(tempfile.mkdtemp(prefix="sr_frame_"))
    out = tmp / "frame.png"
    tries = ([["-i", str(src), "-frames:v", "1"]] if which == "first"
             else [["-sseof", "-0.6", "-i", str(src), "-update", "1"], ["-i", str(src), "-update", "1"]])
    err = ""
    for args in tries:
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", *args, str(out)], capture_output=True, text=True, timeout=180)
        if r.returncode == 0 and out.exists() and out.stat().st_size:
            break
        err = (r.stderr or "").strip()[-300:]
    else:
        shutil.rmtree(tmp, ignore_errors=True)
        raise HttpError(500, f"ffmpeg n'a pas pu lire l'image : {err or 'rien écrit'}")
    lab = "première image" if which == "first" else "dernière image"
    name = " ".join((it.get("title") or it["id"]).split())[:50]
    new = library.add_file(out, kind="image", title=f"{name} · {lab}", origin={"tool": "movie", "model": "ffmpeg"},
                           params={"from_video": it["id"], "frame": which}, parents=[it["id"]],
                           folder=it.get("folder") or "", move=True)
    shutil.rmtree(tmp, ignore_errors=True)
    return library.public(new)


def r_assist(req):
    """L'assistant de prompt : l'interface est prête, le modèle de texte
    se câblera plus tard (décision de Cal du 28/09)."""
    raise HttpError(501, "l'assistant n'est pas encore câblé : le modèle de texte du portail (llm_url) viendra ensuite")


def r_h3_start(req):
    return start_h3(req.json().get("endpoint") or None)


def r_h3_stop(req):
    ep = req.json().get("endpoint") or ""
    if ep not in h3_endpoints():
        raise HttpError(400, "instance inconnue")
    return stop_h3(ep, "arrêt demandé")


def check_submit(mode: str):
    """À l'entrée de `POST /api/jobs` (la page Vidéo et Idéation y lancent
    leurs plans) : le plan que `run` referait au départ, ses erreurs → 400.
    `run` le refait de toute façon : il ne compte sur aucune route."""
    def check(params: dict) -> None:
        try:
            pl = plan(mode, params)
        except (TypeError, ValueError, KeyError, AttributeError) as e:
            raise ValueError(f"réglages illisibles : {e}") from e
        if pl["errors"]:
            raise ValueError(" ; ".join(pl["errors"]))
    return check


def register(app) -> None:
    global _keeper_on
    lane = "h3" if engine() == "h3" else "cpu"   # le moteur factice tourne sur la voie cpu (ffmpeg)
    jobs.register("movie.t2v", run_t2v, lane=lane, title="Texte → vidéo", direct=check_submit("t2v"), cost="gpu" if lane == "h3" else "cpu")
    jobs.register("movie.i2v", run_i2v, lane=lane, title="Images → vidéo", direct=check_submit("i2v"), cost="gpu" if lane == "h3" else "cpu")
    jobs.register("movie.r2v", run_r2v, lane=lane, title="Références → vidéo", direct=check_submit("r2v"), cost="gpu" if lane == "h3" else "cpu")
    app.route("GET", "/api/movie/options", r_options)
    app.route("POST", "/api/movie/plan", r_plan)
    app.route("GET", "/api/movie/loras", r_loras)
    app.route("POST", "/api/movie/element-image", r_element_image)
    app.route("POST", "/api/movie/redo", r_redo)
    app.route("POST", "/api/movie/frame", r_frame)
    app.route("POST", "/api/movie/assist", r_assist)
    app.route("GET", "/api/movie/h3", h3_status)
    app.route("POST", "/api/movie/h3/start", r_h3_start)
    app.route("POST", "/api/movie/h3/stop", r_h3_stop)
    if not _keeper_on and engine() == "h3" and h3_endpoints():
        _keeper_on = True
        threading.Thread(target=_keeper, name="movie-h3", daemon=True).start()


# ── le contrôle sans GPU (tools/check.py) ───────────────────
def selftest(call, ok) -> None:
    import io
    from PIL import Image

    def png(w, h, color):
        buf = io.BytesIO()
        Image.new("RGB", (w, h), color).save(buf, "PNG")
        return buf.getvalue()

    ok(adapt_canvas(832, 1216) == (768, 1120), f"la toile du nœud pour une image quelconque ({adapt_canvas(832, 1216)})")
    ok(all(w % 32 == 0 and h % 32 == 0 for w, h, *_ in CANVASES), "toutes les toiles sont des multiples de 32")
    ok(all(f % 17 == 5 and 124 <= f <= 362 for f in FRAMES) and frame_count(5) == 124, "durées sur la grille 17k+5, plage entraînée")
    # le temps : les rendus de Cal avec sa recette (192 images, 8 pas) tombent dans la fourchette
    for meth, (w, h), mesure in (("brouillon", (1536, 640), 406), ("qualite", (1920, 800), 960)):
        e = estimate(meth, w, h, 192, 8)
        ok(e["low"] <= mesure <= e["high"], f"estimation {meth} {w}×{h} 192 img contient le rendu de Cal {mesure} s ({e['low']}–{e['high']})")
    ok(default_steps("brouillon") == 8 and default_steps("qualite") == 8 and draft_canvas(1536, 640) == (768, 320),
       "préréglages : 8 pas, le Brouillon part de 768 × 320 (la recette de Cal)")
    ok(estimate("brouillon", 1536, 640, 192, 8)["high"] < estimate("qualite", 1920, 800, 192, 8)["low"],
       "le Brouillon s'annonce plus court que la Qualité")

    st, opts = call("GET", "/api/movie/options")
    ok(st == 200 and [m["id"] for m in opts.get("modes", [])] == ["t2v", "i2v", "r2v"] and opts["fps"] == 24
       and opts["limits"]["image"] == 9 and len(opts["camera"]) == 20, f"les options ({st})")
    ok([m["id"] for m in opts.get("methods", [])] == ["brouillon", "qualite"] and opts.get("default_method") == "brouillon"
       and [x["name"] for x in opts["recipe"]["loras"]] == [PEOPLE, CINE, TURBO_V4], "deux préréglages, la pile de LoRA de Cal dans l'ordre")

    # Texte
    st, bad = call("POST", "/api/movie/plan", {"mode": "t2v", "params": {}})
    ok(st == 200 and not bad["ok"] and any("description" in e for e in bad["errors"]), "texte sans rien : ce qui manque est dit")
    st, pt = call("POST", "/api/movie/plan", {"mode": "t2v", "graph": True, "params": {
        "desc": "A lighthouse keeper climbs the stairs at dawn. The camera pushes in with small amplitude at slow speed.",
        "music": "Sparse piano, slow tempo.", "frames": 175, "seed": 5}})
    s = pt.get("prompt_sent", "")
    ok(st == 200 and pt["ok"] and s.startswith("integrated_multimodal_description:\nr34l1sm. DY. [Shot 1] A lighthouse")
       and "overall_soundscape:\nNatural diegetic" in s and "non_diegetic_music:\nSparse piano" in s,
       "texte : les trois champs du guide, le tag de la recette en tête")
    g = pt.get("graph") or {}
    ok(pt["method"] == "brouillon" and (pt["width"], pt["height"]) == (1536, 640) and pt["draft"] == [768, 320]
       and g["6"]["class_type"] == "MiniMaxH3ImageToVideo" and "audio_vae" not in g["6"]["inputs"]
       and "first_frame" not in g["6"]["inputs"] and g["6"]["inputs"]["length"] == 175
       and g["30"]["inputs"] == {"width": 768, "height": 320, "length": 175} and g["11"]["inputs"]["latent_image"] == ["30", 0]
       and g["34"]["class_type"] == "MinimaxH3LatentUpscaler3DRefineHandoff" and g["34"]["inputs"]["width"] == 1536
       and g["33"]["inputs"]["noise_seed"] == 6 and g["31"]["inputs"]["sigmas"] == DRAFT_SIGMAS
       and g["12"]["inputs"]["samples"] == ["34", 0] and g["13"]["inputs"]["samples"] == ["34", 0]
       and g["15"]["inputs"]["frame_rate"] == 24 and g["15"]["inputs"]["crf"] == 12 and g["9"]["inputs"]["steps"] == 8
       and g["2"]["inputs"]["unet_name"] == _defaut(UNETS["fl2va"]),
       "graphe texte, Brouillon : 768 × 320 puis l'agrandisseur latent → 1536 × 640, graine + 1, 175 images à 24 i/s")
    ok(g["100"]["inputs"]["lora_name"] == PEOPLE and g["100"]["inputs"]["model"] == ["2", 0]
       and g["102"]["inputs"]["lora_name"] == CINE and g["102"]["inputs"]["model"] == ["100", 0]
       and g["101"]["class_type"] == "MiniMaxH3TurboLoRA" and g["101"]["inputs"]["model"] == ["102", 0]
       and g["40"]["inputs"]["model"] == ["101", 0] and g["41"]["inputs"]["selection.tau"] == 1.3
       and g["5"]["inputs"]["model"] == ["41", 0] and g["5"]["inputs"]["shift_video"] == 12 and g["10"]["class_type"] == "MiniMaxH3TurboSampler",
       "la pile de Cal : People 0,6 → DY 0,6 → Turbo v4, attention kitchen + Sol-Attn, shift 12, TurboSampler")
    st, pq = call("POST", "/api/movie/plan", {"mode": "t2v", "graph": True, "params": {"desc": "A quiet sea.", "method": "qualite", "seed": 9}})
    gq = pq.get("graph") or {}
    ok(pq["ok"] and (pq["width"], pq["height"]) == (1920, 800) and pq["stages"] == 1 and "30" not in gq and "34" not in gq
       and gq["11"]["inputs"]["latent_image"] == ["6", 1] and gq["12"]["inputs"]["samples"] == ["11", 0],
       "Qualité : 1920 × 800, un étage direct")
    st, po = call("POST", "/api/movie/plan", {"mode": "t2v", "params": {"desc": "x", "method": "origine"}})
    ok(po["ok"] and po["method"] == "brouillon" and any("ancien banc" in n for n in po["notes"]),
       "une méthode de l'ancien banc est relue comme un Brouillon, et c'est dit")

    # Images : début · fin
    st, up = call("PUT", "/api/library/upload?name=plein-pied.png&title=Plein+pied", raw=png(832, 1216, (90, 80, 70)))
    sid = up.get("id")
    st, up2 = call("PUT", "/api/library/upload?name=fin.png&title=Fin", raw=png(1344, 768, (20, 30, 40)))
    fid = up2.get("id")
    st, pl = call("POST", "/api/movie/plan", {"mode": "i2v", "graph": True, "params": {
        "start": sid, "end": fid, "desc": "He walks toward the camera and smiles.", "frames": 124, "canvas": "auto"}})
    sent = pl.get("prompt_sent", "")
    ok(st == 200 and pl["ok"] and (pl["width"], pl["height"]) == (768, 1120) and pl["steps"] == 8 and pl["method"] == "brouillon",
       f"images : toile d'après l'image (avancé), Brouillon 8 pas ({pl.get('width')}×{pl.get('height')} {pl.get('errors')})")
    ok(sent.startswith("For the target video, at 0.00 seconds into the target video, <Picture 1>")
       and "<Picture 2> (from [Shot 1]) aligns with the 5.17-second mark" in sent
       and "[Shot 1] Begin with <Picture 1> and end with <Picture 2>. He walks" in sent,
       "images : ancrage de la première et de la dernière image (guide officiel)")
    g = pl.get("graph") or {}
    ok(g.get("6", {}).get("inputs", {}).get("first_frame") == ["20", 0] and g["6"]["inputs"].get("last_frame") == ["21", 0]
       and (g["6"]["inputs"]["width"], g["6"]["inputs"]["height"]) == (768, 1120) and pl["stages"] == 1
       and "30" not in g and "34" not in g and g["11"]["inputs"]["latent_image"] == ["6", 1]
       and any("un seul étage" in n for n in pl["notes"]),
       "graphe images, Brouillon : un seul étage (l'agrandisseur latent abîme les images clés), et c'est dit")
    st, pe = call("POST", "/api/movie/plan", {"mode": "i2v", "graph": True, "params": {"end": fid, "desc": "x y", "canvas": [1344, 768]}})
    ge = pe.get("graph") or {}
    ok(pe["ok"] and "first_frame" not in ge["6"]["inputs"] and ge["6"]["inputs"].get("last_frame") == ["20", 0]
       and "<Picture 1> (from [Shot 1]) aligns with the 5.17-second mark" in pe["prompt_sent"], "images : la dernière seule")
    st, p16 = call("POST", "/api/movie/plan", {"mode": "i2v", "params": {"start": sid, "desc": "x"}})
    ok((p16["width"], p16["height"]) == (1536, 640) and any("recadrée" in n for n in p16.get("notes", [])),
       "la toile du préréglage : le recadrage de la première image est annoncé")

    # Références : les entrées par position, appelées par jeton (@image1, @element1…)
    st, el = call("POST", "/api/elements", {"title": "MJ Survêt", "type": "character", "description": "male, 28, athletic",
                                            "refs": [{"item": sid, "role": "full body", "label": "tenue 1"},
                                                     {"item": fid, "role": "face", "label": "visage"},
                                                     {"item": fid, "role": "expression"}]})
    eid = el.get("id")
    ins = {"image": [{"item": fid, "role": "location"}], "element": [{"item": eid}]}
    st, pr = call("POST", "/api/movie/plan", {"mode": "r2v", "graph": True, "params": {
        "inputs": ins, "desc": "@element1 runs through @image1 at night. Handheld tracking shot.", "sound": "Footsteps, distant sirens."}})
    s = pr.get("prompt_sent", "")
    ok(st == 200 and pr["ok"] and [p["tag"] for p in pr["pictures"]] == ["<Picture 1>", "<Picture 2>", "<Picture 3>"]
       and pr["pictures"][1]["role"] == "face" and pr["mentions"] == {"@image1": "<Subject 1>", "@element1": "<Subject 2>"},
       f"références : @image1 d'abord, puis @element1 = visage + plein pied ({pr.get('errors')})")
    heads = ["subject_definitions:", "summary:", "retention_analysis:", "detailed_description:", "overall_soundscape:",
             "non_diegetic_music:"]
    ok(all(h in s for h in heads) and [s.index(h) for h in heads] == sorted(s.index(h) for h in heads)
       and "[Shot 1] <Subject 2> runs through <Subject 1> at night." in s and "@" not in s,
       "références : six sections dans l'ordre, les jetons devenus étiquettes")
    ok("<Subject 2> is MJ Survêt, male, 28, athletic, whose face, hair, age and identity come from <Picture 2>" in s
       and "<Subject 1> is the location shown in <Picture 1>" in s and "partially_preserved" in s,
       "références : le personnage défini par ses images, le lieu gardé sans son cadrage")
    # une place vide : son jeton est rouge ; les autres sont dits ; une entrée non citée est seulement notée
    st, hole = call("POST", "/api/movie/plan", {"mode": "r2v", "params": {
        "inputs": {"image": [None, {"item": fid}]}, "desc": "@image2 walks by @image1, then @video1. Contact: cal@ex.fr"}})
    bad = " ".join(hole.get("errors", []))
    ok(not hole["ok"] and "@image1" in bad and "@video1" in bad and "@image2" not in bad and "@ex" not in bad
       and hole["mentions"] == {"@image2": "<Subject 1>"}, f"une place vide garde son rang : @image1 rouge, @image2 vert ({bad})")
    st, idle = call("POST", "/api/movie/plan", {"mode": "r2v", "params": {
        "inputs": {"image": [{"item": fid}, {"item": sid}]}, "desc": "@image1 alone."}})
    ok(idle["ok"] and any("@image2" in n for n in idle["notes"]), "une entrée non citée est notée, pas refusée")
    st, many = call("POST", "/api/movie/plan", {"mode": "r2v", "params": {
        "inputs": {"element": [{"item": eid}] * 5}, "desc": " ".join(f"@element{k + 1}" for k in range(5))}})
    ok(not many["ok"] and any("9 au plus" in e for e in many["errors"]), "cinq personnages (10 images) : refusé, 9 au plus")
    st, t2 = call("POST", "/api/movie/plan", {"mode": "t2v", "params": {"desc": "@image1 at dawn."}})
    ok(not t2["ok"] and any("mode Références" in e for e in t2["errors"]), "un jeton en mode Texte est dit")
    # une vidéo de référence de 3 s (ffmpeg), son compris ; un élément qui porte une voix
    import tempfile
    tdir = Path(tempfile.mkdtemp())
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=24:duration=3",
                    "-f", "lavfi", "-i", "sine=duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    "-shortest", str(tdir / "geste.mp4")], capture_output=True, timeout=60)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=4", str(tdir / "voix.wav")],
                   capture_output=True, timeout=60)
    st, vid = call("PUT", "/api/library/upload?name=geste.mp4&title=Geste", raw=(tdir / "geste.mp4").read_bytes())
    pv = plan("r2v", {"inputs": {**ins, "video": [{"item": vid.get("id"), "role": "motion", "sound": True}]},
                      "desc": "@element1 runs through @image1 like @video1."})
    gv = build_graph("r2v", pv, ["f.png", "b.png", "i.png"], "p", videos=["v.mp4"], audios=[]) if pv["ok"] else {}
    ok(pv["ok"] and gv["6"]["inputs"].get("ref_videos.ref_video_0") == ["301", 0] and gv["300"]["class_type"] == "LoadVideo"
       and gv["6"]["inputs"].get("ref_video_audios.ref_video_audio_0") == ["301", 1]
       and "<Video 1> is a motion reference." in pv["prompt_sent"] and "<Audio 1> is the soundtrack paired with <Video 1>." in pv["prompt_sent"],
       f"références : une vidéo et sa bande-son passent par LoadVideo → GetVideoComponents ({pv['errors']})")
    ev = library.create_element("Voix", "character", "", [{"path": library.path_of(library.get(fid)), "role": "face"},
                                                           {"path": tdir / "voix.wav", "role": "voice"}])
    pw = plan("r2v", {"inputs": {"element": [{"item": ev["id"]}], "audio": []}, "desc": "@element1 speaks."})
    ok(pw["ok"] and len(pw["pictures"]) == 1 and pw["audios"] and pw["audios"][0]["tag"] == "<Audio 1>"
       and "<Audio 1> is the voice reference of <Subject 1>" in pw["prompt_sent"],
       f"un élément qui porte une voix l'envoie en <Audio> ({pw.get('errors')})")
    g2 = pr.get("graph") or {}
    ok(g2.get("6", {}).get("class_type") == "MiniMaxH3ReferenceToVideo" and g2["6"]["inputs"]["ref_images.ref_image_0"] == ["20", 0]
       and g2["6"]["inputs"]["ref_images.ref_image_2"] == ["22", 0] and g2["101"]["inputs"]["lora_name"] == TURBO_V4
       and g2["6"]["inputs"]["ref_image_size"] == "match" and g2["2"]["inputs"]["unet_name"] == _defaut(UNETS["ref2va"])
       and "r34l1sm. DY. [Shot 1]" in pr["prompt_sent"],
       "graphe références : trois images dans l'ordre des places, la recette (Singularity, Turbo v4), taille match")
    ok(any("son visage et son plein pied" in n for n in pr["notes"]),
       "un personnage sans planche ni crops .char envoie visage et plein pied, et le plan le dit")
    # un personnage qui a tout : la planche masquée pour Brouillon, les 5 crops .char pour Qualité (Cal, 30/09)
    kinds = [("face", "visage face"), ("face", "visage 3/4"), ("outfit", "tenue haut"), ("outfit", "tenue bas"),
             ("view", "corps dos"), ("view", "planche corps 3 vues visage masqué"), ("face", "visage 3/4 sourire"),
             ("face", "visage profil"), ("full body", "tenue entière")]
    st, eira = call("POST", "/api/elements", {"title": "Eira", "type": "character", "description": "a 15-year-old girl",
                                              "refs": [{"item": sid, "role": r, "label": lab} for r, lab in kinds]})
    ein = {"element": [{"item": eira.get("id")}]}
    pb = plan("r2v", {"inputs": ein, "desc": "@element1 runs.", "method": "brouillon"})
    pq2 = plan("r2v", {"inputs": ein, "desc": "@element1 runs.", "method": "qualite"})
    lab = lambda p: [x["label"].split(" · ", 1)[1] for x in p["pictures"]]  # noqa: E731
    ok(pb["ok"] and lab(pb) == ["planche corps 3 vues visage masqué", "visage face", "visage 3/4 sourire", "visage 3/4", "visage profil"]
       and "(front, back and side views, face blanked out" in pb["prompt_sent"] and "multi-view sheet layout" in pb["prompt_sent"],
       f"Brouillon : la planche masquée puis les 4 gros plans du visage ({lab(pb)})")
    ok(pq2["ok"] and lab(pq2) == ["visage face", "visage 3/4", "tenue haut", "tenue bas", "corps dos"]
       and "whose outfit is shown in <Picture 3> and <Picture 4>" in pq2["prompt_sent"]
       and "whose body from behind is shown in <Picture 5>" in pq2["prompt_sent"] and "blanked out" not in pq2["prompt_sent"],
       f"Qualité : les 5 crops de la méthode .char, dans l'ordre de Cal ({lab(pq2)})")
    # un élément versionné : sa matière est dans sa dernière version (library.resolve) ; sans version, c'est dit
    st, liv = call("POST", "/api/elements", {"from_item": eira.get("id"), "title": "Eira vivante"})
    pvv = plan("r2v", {"inputs": {"element": [{"item": liv.get("id")}]}, "desc": "@element1 runs.", "method": "qualite"})
    ok(st == 200 and library.is_living(library.get(liv.get("id"))) and pvv["ok"] and lab(pvv) == lab(pq2),
       f"un élément versionné envoie les images de sa dernière version ({st} {pvv.get('errors')})")
    empty = library.create_living("Sans version", "character", {"tool": "asset"})
    pne = plan("r2v", {"inputs": {"element": [{"item": empty["id"]}]}, "desc": "@element1"})
    ok(not pne["ok"] and any("pas encore de version" in e for e in pne["errors"]), "un élément sans version publiée : dit")
    st, raw = call("POST", "/api/movie/plan", {"mode": "r2v", "params": {"inputs": {"element": [{"item": eid}]}, "desc": "subject_definitions:\n@element1"}})
    ok(speech_to_h3('@element1 mange de la soupe et dit:"vive Nirvalab!"')[0] == "@element1 mange de la soupe (S1) says: <d>[French] vive Nirvalab!</d>",
       "une réplique citée devient une réplique H3 (plus de narrateur)")
    ok(speech_to_h3('he mutters: <d>[English] hi</d>', "en") == ('he mutters: <d>[English] hi</d>', 0)
       and speech_to_h3('Une enseigne "OPEN" au néon')[1] == 0, "un <d> déjà écrit, ou des guillemets d'enseigne : intacts")
    ok(raw.get("raw") and raw.get("prompt_sent") == "subject_definitions:\n<Subject 1>", "un prompt au format H3 part tel quel, jetons remplacés")
    st, lo = call("POST", "/api/movie/plan", {"mode": "r2v", "params": {"inputs": {"element": [{"item": eid}]}, "desc": "@element1",
                                                                         "loras": [{"name": "Minimax_H3/minimax_h3_fl2v_x.safetensors"}]}})
    ok(not lo["ok"] and any("l'autre modèle" in e for e in lo["errors"]), "un LoRA fl2v est refusé en références")
    pg = plan("t2v", {"desc": "x", "loras": [{"name": PEOPLE, "strength": 1.0}, {"name": "Minimax_H3/minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors"},
                                             {"name": "minimax_h3_flf2v_orbit360_v1.safetensors", "strength": 0.8}]})
    gg = build_graph("t2v", pg, [], "p")
    ok(pg["ok"] and [l["name"] for l in pg["loras"]] == ["minimax_h3_flf2v_orbit360_v1.safetensors"]
       and gg["50"]["inputs"]["model"] == ["102", 0] and gg["101"]["inputs"]["model"] == ["50", 0]
       and gg["50"]["inputs"]["strength_model"] == 0.8,
       "un LoRA ajouté se pose après People → DY, avant le Turbo ; ni doublon de la pile ni second accélérateur")

    # un LoRA de moodboard H3 (server/tools/lora.py) : ni de la pile ni un accélérateur, même si son nom
    # contient « ema » (cinéma) ; son mot déclencheur en tête de la description ; jamais en Références
    from tools import lora as moodlora
    mb = moodlora.essai_version("Cinéma noir", "h3", 1, "mbcin001")
    zi = moodlora.essai_version("Rue", "zimage", 3, "mbrue003")
    pm = plan("t2v", {"desc": "A man walks.", "loras": [{"name": mb, "strength": 0.9}]})
    gm = build_graph("t2v", pm, [], pm["prompt_sent"])
    ok(mb == "showrunner/h3-cinema-noir-v001-fl2v.safetensors" and pm["ok"] and [l["name"] for l in pm["loras"]] == [mb]
       and gm["50"]["inputs"] == {"model": ["102", 0], "lora_name": mb, "strength_model": 0.9} and gm["101"]["inputs"]["model"] == ["50", 0]
       and "r34l1sm. DY. mbcin001 [Shot 1] A man walks." in pm["prompt_sent"],
       f"un LoRA de moodboard H3 : après People → DY, avant le Turbo, son mot déclencheur en tête ({pm.get('errors')} {pm['prompt_sent'][:90]!r})")
    pz = plan("t2v", {"desc": "A man walks.", "loras": [{"name": zi}]})
    ok(not pz["ok"] and any("entraîné pour Z-Image" in e for e in pz["errors"]), f"un LoRA de moodboard Z-Image est refusé pour H3 ({pz['errors']})")
    pr2 = plan("r2v", {"inputs": {"element": [{"item": eid}]}, "desc": "@element1", "loras": [{"name": mb}]})
    ok(not pr2["ok"] and any("l'autre modèle" in e for e in pr2["errors"]), "un LoRA de moodboard (fl2va) est refusé en Références")
    # la liste de la page : ce que liste la ComfyUI, sans l'adaptateur d'entraînement d'ai-toolkit
    import importlib.util
    spec = importlib.util.spec_from_file_location("faux_comfy", config.REPO / "tools" / "faux_comfy.py")
    fx = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fx)
    srv, F, url = fx.start()
    F.loras = [PEOPLE, CINE, TURBO_V4, "training_adapters/minimax_h3_training_adapter_v3.safetensors", mb, zi,
               "minimax_h3_flf2v_orbit360_v1.safetensors"]
    old_eps = globals()["h3_endpoints"]
    try:
        globals()["h3_endpoints"] = lambda: [url]
        names, machine = _lora_names()
        st, lr = call("GET", "/api/movie/loras")
        got = {x["name"]: x for x in lr.get("loras", [])}
        x = got.get(mb, {})
        ok(machine and "training_adapters/minimax_h3_training_adapter_v3.safetensors" not in names and len(names) == 6,
           f"la page Vidéo ne liste pas training_adapters/ ({names})")
        ok(st == 200 and x.get("moodboard") and not x.get("accel") and x.get("modes") == ["t2v", "i2v"] and x.get("nom") == "Cinéma noir · v1"
           and x.get("trigger") == "mbcin001" and zi not in got and [n for n in got][3] == mb,
           f"la page Vidéo reconnaît un LoRA de moodboard H3, le premier après la pile, sans les LoRA d'image ({x} {list(got)})")
    finally:
        globals()["h3_endpoints"] = old_eps
        srv.shutdown()

    st, h3 = call("GET", "/api/movie/h3")
    ok(st == 200 and isinstance(h3.get("instances"), list), "l'état d'H3 se lit")
    st, _ = call("POST", "/api/movie/h3/start", {})
    ok(st == 409 or engine() == "h3", "moteur factice : H3 ne démarre pas")
    ok(managed("http://127.0.0.1:8189") and not managed("http://169.254.110.6:8188")
       and neighbour("http://127.0.0.1:8188") == "http://127.0.0.1:8189" and neighbour("http://127.0.0.1:8189") == "http://127.0.0.1:8188",
       "le gardien ne démarre ni n'arrête un ComfyUI :8188 ; l'autre instance de la machine se trouve")
    try:   # ni la page Admin : son bouton « Arrêter » ne vise qu'une instance gérée (le câblage de Cal : les :8188)
        stop_h3("http://169.254.110.6:8188", "essai")
        ok(False, "un ComfyUI :8188 ne s'arrête pas d'ici")
    except HttpError as e:
        ok(e.status == 409 and "toujours allumé" in e.message, f"un ComfyUI :8188 ne s'arrête pas d'ici ({e.status} {e.message})")
    st, _ = call("POST", "/api/movie/assist", {"brief": "x"})
    ok(st == 501, "l'assistant dit qu'il n'est pas câblé")
    st, lr = call("GET", "/api/movie/loras")
    ok(st == 200 and isinstance(lr.get("loras"), list), "la liste des LoRA se lit (vide sans ComfyUI)")
    st, _ = call("POST", "/api/movie/plan", {"mode": "x", "params": {}})
    ok(st == 400, "un mode inconnu est refusé")
    st, page = call("GET", "/movie/")
    ok(st == 200 and b"movie.js" in (page if isinstance(page, bytes) else b""), "la page Vidéo se sert")
    lane = "h3" if engine() == "h3" else "cpu"
    ok(all(jobs.HANDLERS.get(k, (0, ""))[1] == lane for k in ("movie.t2v", "movie.i2v", "movie.r2v")),
       f"les trois travaux sont sur la voie {lane}")

    ref = next(r for r in el["element"]["refs"] if r["role"] == "full body")
    st, img = call("POST", "/api/movie/element-image", {"element": eid, "file": ref["file"]})
    ok(st == 200 and img.get("id") == sid, "une référence tirée d'une image rend cette image")
    cf = library.create_element("Perso CF", "character", "", [{"path": library.path_of(library.get(sid)), "role": "full body"}])
    st, img2 = call("POST", "/api/movie/element-image", {"element": cf["id"], "file": cf["element"]["refs"][0]["file"]})
    st, img3 = call("POST", "/api/movie/element-image", {"element": cf["id"], "file": cf["element"]["refs"][0]["file"]})
    ok(st == 200 and img2.get("kind") == "image" and img2.get("id") == img3.get("id") and img2["parents"] == [cf["id"]],
       "une référence copiée (Character Factory) devient une image, une seule fois")

    # la page (29/09) : le fil commun, le thème tenu
    st, page = call("GET", "/movie/")
    ok(st == 200 and b"../commun/fil.css" in page and b"Movie Creator" not in page, "la page Vidéo charge le fil commun, sans « Movie Creator »")
    st, fjs = call("GET", "/commun/fil.js")
    ok(st == 200 and b"export function createFil" in fjs, "commun/fil.js se sert")
    mjs = (config.REPO / "movie" / "movie.js").read_text(encoding="utf-8")
    ok("createFil(" in mjs and "movie/redo" in mjs and "movie/frame" in mjs, "movie.js passe par le fil, Recréer et Extraire")
    for name in ("movie/movie.css", "commun/fil.css"):
        css = (config.REPO / name).read_text(encoding="utf-8")
        body = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        ok(not re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", body), f"{name} : aucune couleur en dur (tokens.css seulement)")
        ok(not re.search(r"(?<![\w-])border(-(top|right|bottom|left))?\s*:(?!\s*(none|0)\b)", body), f"{name} : des filets, jamais de bordures")

    # de bout en bout avec le moteur factice : un vrai mp4, sa recette, sa lignée, le graphe H3 rangé
    if engine() != "h3":
        config.CFG["movie_stub_step_s"] = 0.02
        made = []
        for kind, params, parents in (
                ("movie.t2v", {"desc": "A quiet station at dawn.", "canvas": [864, 480], "seed": 2}, set()),
                ("movie.i2v", {"start": sid, "desc": "He turns and smiles.", "seed": 3}, {sid}),
                ("movie.r2v", {"inputs": ins, "desc": "@element1 walks in @image1.", "canvas": [1344, 576], "seed": 4}, {eid, fid})):
            st, j = call("POST", "/api/jobs", {"kind": kind, "params": params, "title": "essai", "tool": "movie"})
            for _ in range(300):
                st, j = call("GET", f"/api/jobs/{j['id']}")
                if j["state"] in ("done", "error", "cancelled"):
                    break
                time.sleep(0.1)
            v = (j.get("items") or [{}])[0]
            pp = v.get("params", {})
            ok(j["state"] == "done" and v.get("kind") == "video" and v.get("audio") and v.get("fps") == 24
               and pp.get("engine") == "factice" and v.get("origin", {}).get("tool") == "movie"
               and set(v.get("parents", [])) == parents and "6" in (pp.get("graph") or {})
               and (v.get("width"), v.get("height")) == (pp.get("width"), pp.get("height")),
               f"{kind} factice : mp4 avec son, recette, lignée, graphe H3 rangé ({j['state']} {j.get('message')})")
            ok(pp.get("request", {}).get("desc") == params["desc"] and pp["request"].get("seed") == params["seed"],
               f"{kind} : la vidéo garde ses réglages d'envoi (request), de quoi Réutiliser et Recréer")
            made.append(v)
        st, hist = call("GET", "/api/library?kind=video&tool=movie")
        ok(st == 200 and hist["total"] == 3, "l'historique : les vidéos de l'outil")

        def wait(jid):
            for _ in range(300):
                st, jj = call("GET", f"/api/jobs/{jid}")
                if jj.get("state") in ("done", "error", "cancelled"):
                    return jj
                time.sleep(0.1)
            return jj

        # Recréer : mêmes réglages, une autre graine ; à l'identique : la même
        t2v = made[0] if made else {}
        st, rj = call("POST", "/api/movie/redo", {"item": t2v.get("id")})
        ok(st == 200 and rj.get("kind") == "movie.t2v" and rj.get("params", {}).get("seed") not in (None, 2)
           and rj["params"].get("desc") == "A quiet station at dawn." and rj.get("tool") == "movie",
           f"Recréer : la recette remise en file, nouvelle graine ({st} {str(rj)[:200]})")
        rv = (wait(rj.get("id")).get("items") or [{}])[0] if st == 200 else {}
        ok(rv.get("params", {}).get("desc") == "A quiet station at dawn." and (rv.get("width"), rv.get("height")) == (864, 480),
           "Recréer : la nouvelle vidéo a la même recette, la même toile")
        st, sj = call("POST", "/api/movie/redo", {"item": made[1]["id"] if len(made) > 1 else "", "same_seed": True})
        ok(st == 200 and sj.get("kind") == "movie.i2v" and sj.get("params", {}).get("seed") == 3
           and sj["params"].get("start") == sid, f"Refaire à l'identique : même graine, même première image ({st})")
        if st == 200:
            wait(sj["id"])
        st, _ = call("POST", "/api/movie/redo", {"item": vid.get("id")})
        ok(st == 409, f"Recréer une vidéo déposée (sans recette) : refusé avec la raison ({st})")
        st, _ = call("POST", "/api/movie/redo", {"item": "vid-rien"})
        ok(st == 404, "Recréer : une vidéo introuvable")
        # la première et la dernière image, rangées une seule fois
        st, f1 = call("POST", "/api/movie/frame", {"item": t2v.get("id"), "which": "first"})
        st2, f2 = call("POST", "/api/movie/frame", {"item": t2v.get("id"), "which": "last"})
        st3, f1b = call("POST", "/api/movie/frame", {"item": t2v.get("id"), "which": "first"})
        ok(st == 200 and st2 == 200 and f1.get("kind") == "image" and f2.get("kind") == "image" and f1["id"] != f2["id"]
           and (f1.get("width"), f1.get("height")) == (864, 480) and f1.get("parents") == [t2v.get("id")] and f1b.get("id") == f1["id"],
           f"Extraire : la première et la dernière image, dans la bibliothèque, une seule fois ({st} {st2} {str(f1)[:160]})")
        st, _ = call("POST", "/api/movie/frame", {"item": t2v.get("id"), "which": "milieu"})
        ok(st == 400, "Extraire : « which » vaut first ou last")
        # aimer (le drapeau fav de la bibliothèque) et la corbeille, comme le fil les fait
        st, fv = call("POST", f"/api/library/{t2v.get('id')}", {"fav": True})
        st2, favs = call("GET", "/api/library?kind=video&tool=movie&fav=1")
        ok(st == 200 and fv.get("fav") is True and st2 == 200 and [x["id"] for x in favs["items"]] == [t2v.get("id")],
           "Aimer : le drapeau fav, et le filtre « aimés » du fil")
