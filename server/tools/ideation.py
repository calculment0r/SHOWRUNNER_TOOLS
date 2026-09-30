"""Idéation : un canvas infini où Cal pose, rapproche et fait naître des
idées visuelles avant de passer aux outils de production. L'étude :
`docs/etudes/ideation.md`.

Une planche est un fichier JSON sous `<data_dir>/ideation/<id>.json` ; la
page l'enregistre seule après chaque geste (rien à « enregistrer »), avec
sa version `rev` : un second onglet qui écrirait par-dessus reçoit 409.
À plusieurs, la page envoie ses gestes en opérations par objet et par
propriété (la co-édition : `ideation_collab.py`, qui tient la planche en
mémoire et avance `rev` à chaque lot) ; la planche entière reste le repli.

Ce qu'une planche porte (`nodes`, dans l'ordre d'empilement) :

  media    un objet de la bibliothèque : image, vidéo, son, élément
           (`item` = son identifiant ; la page le lit dans /api/library)
  note     un texte libre            sticky   un post-it (couleur = jeton)
  title    un titre                  frame    un cadre : une zone nommée
  gen      une carte « Générer image » : prompt, modèle, format, prise de
           vue ; entrées `prompt` (un texte) et `refs` (images, éléments)
  vgen     une carte « Générer vidéo » (les travaux movie.* de l'outil
           Vidéo) : mode t2v | i2v | r2v, durée (`frames`), toile, méthode ;
           entrées `prompt`, et selon le mode `start`, `end` ou `image`,
           `element`, `video`, `audio` (@image1…)
  compose  un composeur de prompt : des cases nommées dans l'ordre (`slots` :
           id, name, text, lock, off ; vary, values, skip pour une case qui
           varie ; looks, les pastilles d'une case Photographie), chacune une
           entrée `s:<id>` ; sa sortie est le texte des cases jointes
  palette  un nuancier tiré d'une image (des couleurs de données)

  Les objets d'atelier (ideation/objets/, l'étude docs/etudes/ideation_atelier.md § 3) :
  shape    une forme : `kind` rect | round | ellipse | diamond | hex | para,
           `color` (un jeton de PALETTE), `text`
  card     une carte : `kind` task | link | metric | person, `color`, `text`
           (le titre), `data` (les champs de sa sorte, bornés : _card_data)
  mind     un nœud de mind map : `text`, `parent` (un autre nœud ; une racine
           n'en a pas), `collapsed` ; la page range l'arbre depuis sa racine et
           écrit les places de chaque nœud (x, y, w, h)
  ink      un trait de crayon : `pts` (x, y entiers de 0 à 1000 dans sa boîte),
           `color`, `width` (px d'écran)

  Les diapositives (docs/etudes/presentations.md, 30/09) : un cadre porte `slide`
  (sa place dans la présentation), `skip` (masqué), et, s'il est une diapositive,
  `deck` { ratio 16:9 | 4:3 | 1:1 | 9:16, trans fade | push | morph | cut | fly } —
  sa taille est alors celle de sa scène (DECK_RATIOS), toujours. Un titre ou une
  note porte `style` (TEXT_STYLES) et `align` ; un objet, `mid` (le même objet d'une
  diapositive à l'autre : le morph). La planche porte `pres` { styles } : ce que la
  présentation change aux styles par défaut (_pres).

  group    un groupe (l'étude : docs/etudes/ideation_miro.md § 3) : une
           appartenance, pas une zone — nom, `collapsed` (réduit : une carte),
           `lod` (se réduit de loin), `layout` { mode free | flow, width, gap,
           fit '' | h | w }. Chaque enfant porte `group` (son identifiant) et
           garde ses coordonnées absolues ; le groupe n'a pas de liste d'enfants.

Les règles des groupes (tenues ici et par la page, ideation/groups.js) : `group`
pointe vers un nœud `group` présent, sinon il tombe ; pas de groupes imbriqués
(un groupe n'a pas de `group`) ; un cadre peut être dans un groupe (30/09) ; un groupe sans
enfant disparaît, un groupe à un seul enfant se dissout (ses liens avec lui).
Le cadre reste une zone : ce qui est entièrement dedans lui appartient.

Un objet peut porter `parent` (l'identifiant d'un autre objet de la planche,
l'ancienne place prévue pour les groupes) ; un parent absent tombe, un parent
qui est un groupe devient son `group` (la migration, sans perte). Le `parent`
d'un nœud de mind map est un autre nœud (_minds) : un parent d'une autre sorte
tombe, une boucle se coupe, et tout l'arbre est dans le groupe de sa racine.

Un lien d'annotation (`arrow`, `line`) peut porter `dash` : en pointillé.

Des liens (`links`, a → b) de deux familles (ideation/ports.js, la seule
vérité de ce qui se branche) :

  wire     un fil de données : de la sortie `pa` de a (sa sorte : text,
           image, video, audio, element) à l'entrée `pb` de b ;
  arrow, line   des annotations (flèches droites) ; out : la lignée (« a a
           produit b » : une carte et ses résultats).

Une planche d'avant les fils (`v` absent ou 1) est migrée en la lisant :
une flèche d'une image ou d'un élément vers une carte Générer était sa
référence, elle devient le fil `refs` ; les autres flèches restent des
flèches. Les objets `media`, `gen` et `vgen` gardent leurs travaux en cours
(`jobs`) : rechargée, la page reprend leur attente et pose les résultats.

La validation est stricte sur la structure (identifiants, sortes, liens
vers des objets présents) et tolérante sur le vocabulaire qui peut évoluer
ailleurs (une couleur, un réglage de prise de vue, un modèle retirés
reviennent au défaut) : une vieille planche s'ouvre toujours.

Les générations ne passent pas par ici : la page appelle les routes de
l'outil Image (`/api/image/generate`, `edit`, `redo`), donc ses travaux
`image.generate` et `image.edit`, et ceux de Vidéo (`/api/movie/plan`, puis
`movie.t2v|i2v|r2v` dans la file), avec leurs moteurs (factices aujourd'hui).
Sauf un lot (une case du composeur varie) : `/api/ideation/lot` valide chaque
valeur comme l'outil le ferait et met tout en file d'un coup, la même graine
d'une valeur à l'autre ; ses rendus tombent dans un cadre (lignée `out` marquée
`lot`, les travaux de la carte `jobs` avec leur colonne et leur rang).

Travail `ideation.export` (voie `cpu`) : la planche ou un cadre rendus en
PNG par PIL, aux couleurs de `commun/tokens.css`, rangés dans la
bibliothèque (dossier « Idéation ») avec pour lignée les objets posés.
"""

from __future__ import annotations

import json
import math
import re
import secrets
import shutil
import threading
import time
from pathlib import Path

from core import auth, config, jobs, library
from core.http import HttpError

REPO = Path(__file__).resolve().parents[2]

BID = re.compile(r"ide-\d{8}-\d{6}-[0-9a-f]{4}")
NID = re.compile(r"[A-Za-z0-9_-]{1,40}")
ITEM = re.compile(r"[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}")
JOB = re.compile(r"job-\d{4}-\d{6}-[0-9a-f]{4}")
HEX = re.compile(r"#[0-9a-fA-F]{6}")
REF_FILE = re.compile(r"ref-\d{2}\.[a-z]{3,4}")

TYPES = ("media", "note", "sticky", "title", "frame", "gen", "vgen", "compose", "palette", "group",
         "shape", "card", "mind", "ink",
         "web")   # web : l'objet « Web » (server/tools/web_apercu.py), 30/09
# les objets d'atelier (ideation/objets/ : les mêmes listes ; une valeur inconnue revient au défaut)
SHAPES = ("rect", "round", "ellipse", "diamond", "hex", "para")
PALETTE = ("cy", "or", "grn2", "amb", "ink")          # formes, cartes, traits : acier, orange, vert, ambre, encre
CARD_KINDS = {"task": "or", "link": "cy", "metric": "grn2", "person": "amb"}   # la sorte et sa couleur par défaut
MIND_BRANCH = ("or", "grn2", "cy", "amb", "ink2", "coral-2")   # la couleur des rameaux du premier rang
INK_MAX = 4000           # les nombres d'un trait (2000 points)
MAX_CHECKS = 20
# les groupes (ideation/groups.js : la même règle) : libre ou rangée, même hauteur ou largeur
GROUP_MODES = ("free", "flow")
GROUP_FITS = ("", "h", "w")
GROUP_GAP = 24           # l'espacement d'une rangée par défaut (px du monde)
MEDIA_KINDS = ("image", "video", "audio", "element")
VERSION = 2              # 2 : les fils (29/09) ; une planche plus ancienne est migrée en la lisant
PORT = re.compile(r"[a-z]{1,12}(?::[A-Za-z0-9_-]{1,40})?")
SLOT_ID = re.compile(r"[A-Za-z0-9_-]{1,40}")
MAX_SLOTS = 24
# les rôles des cases du composeur, et les cinq d'un composeur neuf, dans l'ordre de la
# prose (ideation/ports.js, ROLES et SLOTS : le contrôle compare ; étude ideation_weavy.md § 9)
ROLES = ("style", "persos", "action", "decor", "photo", "son", "musique", "libre")
VIDEO_ONLY = ("son", "musique")      # les champs à part d'H3 : overall_soundscape, non_diegetic_music
SLOTS = [("style", "Style"), ("persos", "Personnages"), ("action", "Action"), ("decor", "Décor"), ("photo", "Photographie")]
# la teinte de chaque sorte de fil (ideation/ports.js, KINDS : le contrôle compare)
KIND_COLORS = {"text": "amb", "image": "coral-3", "element": "coral-2", "video": "cy", "audio": "grn2"}
TEXT_TYPES = ("note", "sticky", "title")
# les post-it : des jetons du thème, et l'encre qui se lit dessus
STICKY = {"coral-3": "on-light", "coral-2": "on-light", "coral-1": "on-coral1", "amb": "on-light",
          "verd-3": "on-grn", "verd-4": "on-grn", "cy": "on-cy", "paper": "paper-ink"}
# leurs noms (le cadre d'une colonne quand on regroupe les post-it par couleur, les menus)
STICKY_NAMES = {"coral-3": "corail clair", "coral-2": "corail", "coral-1": "corail sourd", "amb": "ambre",
                "verd-3": "vert", "verd-4": "vert sourd", "cy": "acier", "paper": "papier"}
TITLE_SIZES = {"s": 22, "m": 34, "l": 52}
# ── les diapositives (docs/etudes/presentations.md § 2.4, étapes 1 à 3) ─────
# Un cadre qui porte `deck` {ratio, trans} est une diapositive : une scène de
# taille fixe, en px du monde (le cadre sur la planche EST la scène, que le zoom
# réduit) ; sa taille suit son format, rien d'autre (juste par construction).
DECK_RATIOS = {"16:9": (1920, 1080), "4:3": (1440, 1080), "1:1": (1080, 1080), "9:16": (1080, 1920)}
DECK_TRANS = ("fade", "push", "morph", "cut", "fly")
DECK_GRID = {"cols": 12, "margin": 96, "gutter": 24, "baseline": 8}   # px de la scène (notre choix, § 2.5)
TEXT_ALIGN = ("left", "center", "right")
# les styles de texte nommés (Figma Slides : une gamme ; § 2.5) : leurs valeurs
# par défaut, en px de la scène ; la planche peut les changer (`pres.styles`)
TEXT_STYLES = {
    "display": {"name": "Display", "font": "venus", "size": 120, "weight": 400, "lh": 1.0, "track": 0.02, "upper": True},
    "h1": {"name": "H1", "font": "venus", "size": 72, "weight": 400, "lh": 1.08, "track": 0.03, "upper": True},
    "h2": {"name": "H2", "font": "chakra", "size": 52, "weight": 600, "lh": 1.12, "track": 0.0, "upper": False},
    "body": {"name": "Corps", "font": "chakra", "size": 34, "weight": 400, "lh": 1.45, "track": 0.0, "upper": False},
    "caption": {"name": "Légende", "font": "chakra", "size": 24, "weight": 400, "lh": 1.4, "track": 0.01, "upper": False},
    "label": {"name": "Étiquette", "font": "azeret", "size": 18, "weight": 400, "lh": 1.4, "track": 0.18, "upper": True},
}
# la bibliothèque de polices de présentation : chaque police déclare sa licence
# (§ 2.5, décision 3). `web` / `pdf` : ce que la licence permet à la publication
# et au PDF (étapes 6 et 7, à venir : ils refuseront une police qui ne le permet
# pas, en disant pourquoi). `portail` : servie aujourd'hui par le portail
# (commun/base.css, Google Fonts de index.html) ; `google` : chargée à la demande
# depuis Google Fonts (css2), seulement si un style la prend. Licences relues le
# 30/09 dans les METADATA.pb de github.com/google/fonts (ofl/<nom>) ; Venus Rising
# et Norelli : l'étude, [30] [31].
_OFL = "SIL Open Font License 1.1"
FONTS = [
    {"id": "venus", "family": "Venus Rising", "name": "Venus Rising", "src": "portail", "weights": [400], "gen": "sans-serif",
     "licence": "Typodermic Desktop License", "web": False, "pdf": False, "use": True,
     "note": "la licence web + PDF est en vente (MyFonts, Fontspring)",
     "url": "https://typodermicfonts.com/venus-rising-font/"},
    {"id": "chakra", "family": "Chakra Petch", "name": "Chakra Petch", "src": "portail", "weights": [400, 500, 600, 700], "gen": "sans-serif",
     "licence": _OFL, "web": True, "pdf": True, "use": True, "note": "Cadson Demak", "url": "https://github.com/google/fonts/tree/main/ofl/chakrapetch"},
    {"id": "azeret", "family": "Azeret Mono", "name": "Azeret Mono", "src": "portail", "weights": [300, 400, 500], "gen": "monospace",
     "licence": _OFL, "web": True, "pdf": True, "use": True, "note": "Displaay", "url": "https://github.com/google/fonts/tree/main/ofl/azeretmono"},
    {"id": "norelli", "family": "Norelli", "name": "Norelli Black", "src": "portail", "weights": [400], "gen": "sans-serif",
     "licence": "usage personnel seulement", "web": False, "pdf": False, "use": False,
     "note": "54 signes, ni accents ni chiffres : le logotype seulement, jamais un style", "url": "https://www.dafont.com/norelli-black.font"},
    # les proposées (OFL, aucune n'est imposée) : deux pour les titres qui remplaceraient Venus Rising
    # une fois publiés (Unbounded, Syne : larges, géométriques), deux sérifs de caractère (Fraunces,
    # Instrument Serif), deux linéales de texte (Inter Tight, Space Grotesk)
    {"id": "unbounded", "family": "Unbounded", "name": "Unbounded", "src": "google", "css": "Unbounded:wght@300;400;600;800",
     "weights": [300, 400, 600, 800], "gen": "sans-serif", "licence": _OFL, "web": True, "pdf": True, "use": True, "proposed": True,
     "note": "NaN, 2022 — large et géométrique, le plus proche de Venus Rising", "url": "https://github.com/google/fonts/tree/main/ofl/unbounded"},
    {"id": "syne", "family": "Syne", "name": "Syne", "src": "google", "css": "Syne:wght@400;600;800", "weights": [400, 600, 800],
     "gen": "sans-serif", "licence": _OFL, "web": True, "pdf": True, "use": True, "proposed": True,
     "note": "Bonjour Monde, 2020 — s'élargit en graissant : des titres d'affiche", "url": "https://github.com/google/fonts/tree/main/ofl/syne"},
    {"id": "fraunces", "family": "Fraunces", "name": "Fraunces", "src": "google", "css": "Fraunces:opsz,wght@9..144,300;9..144,400;9..144,600;9..144,800",
     "weights": [300, 400, 600, 800], "gen": "serif", "licence": _OFL, "web": True, "pdf": True, "use": True, "proposed": True,
     "note": "Undercase Type, 2020 — sérif « old style » à taille optique : le grand titre éditorial", "url": "https://github.com/google/fonts/tree/main/ofl/fraunces"},
    {"id": "instrument", "family": "Instrument Serif", "name": "Instrument Serif", "src": "google", "css": "Instrument+Serif",
     "weights": [400], "gen": "serif", "licence": _OFL, "web": True, "pdf": True, "use": True, "proposed": True,
     "note": "Instrument, 2023 — sérif étroite et fine : un Display élégant, une seule graisse", "url": "https://github.com/google/fonts/tree/main/ofl/instrumentserif"},
    {"id": "intertight", "family": "Inter Tight", "name": "Inter Tight", "src": "google", "css": "Inter+Tight:wght@300;400;500;600;700",
     "weights": [300, 400, 500, 600, 700], "gen": "sans-serif", "licence": _OFL, "web": True, "pdf": True, "use": True, "proposed": True,
     "note": "Rasmus Andersson, 2022 — l'Inter serrée pour les grandes tailles : corps et titres nets", "url": "https://github.com/google/fonts/tree/main/ofl/intertight"},
    {"id": "spacegrotesk", "family": "Space Grotesk", "name": "Space Grotesk", "src": "google", "css": "Space+Grotesk:wght@300;400;500;700",
     "weights": [300, 400, 500, 700], "gen": "sans-serif", "licence": _OFL, "web": True, "pdf": True, "use": True, "proposed": True,
     "note": "Florian Karsten, 2020 — linéale à accent technique, proche de Chakra Petch", "url": "https://github.com/google/fonts/tree/main/ofl/spacegrotesk"},
]
FONT_IDS = {f["id"]: f for f in FONTS}
ETYPE_FR = {"character": "personnage", "object": "objet", "place": "lieu", "style": "style", "other": "élément"}
LINK_KINDS = ("wire", "arrow", "line", "out")
MAX_NODES = 3000
MAX_LINKS = 6000
MAX_SIDE = 4096          # le grand côté d'un export
EXPORT_SCALE = 2.0       # une planche petite s'exporte au double : nette à l'écran
MARGIN = 48              # autour de la planche entière, en px du monde
# les lots (une case du composeur varie, étude ideation_weavy.md § 9.3) : le plafond d'un envoi,
# celui d'/api/image/generate (image.py, api_generate : « nombre d'images » de 1 à 8) — le
# contrôle vérifie que les deux disent la même chose ; une vidéo par valeur, sous le même plafond
LOT_MAX = 8
MAX_VALUES = 24          # les valeurs d'une case qui varie (cochées ou non)

_lock = threading.RLock()


def _image():
    """Les modèles, formats et réglages de l'outil Image : la seule vérité."""
    from tools import image
    return image


def _movie():
    """Les modes, durées et méthodes de l'outil Vidéo : la seule vérité."""
    from tools import movie
    return movie


# ── les fichiers ─────────────────────────────────────────────
def _dir() -> Path:
    p = config.data_dir() / "ideation"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _path(bid: str) -> Path:
    if not BID.fullmatch(bid or ""):
        raise HttpError(400, "identifiant de planche invalide")
    return _dir() / f"{bid}.json"


def load(bid: str) -> dict:
    f = _path(bid)
    if not f.exists():
        raise HttpError(404, f"planche introuvable : {bid}")
    # collab : la co-édition tient la planche en mémoire (ideation_collab.py) ; ses
    # opérations partent d'abord sur le disque, chaque lecture lit le vrai
    from tools import ideation_collab
    ideation_collab.hot_flush(bid)
    return json.loads(f.read_text(encoding="utf-8"))


# Teams et Workspaces (étape 2) : une planche est à son Workspace (`space`), posé à sa
# naissance (celui de la requête : library.new_space, qui juge « créer ») et gardé par
# `_write`, le seul écrivain des planches — la page, la co-édition, `normalize` n'y
# touchent pas. Retenu en mémoire : seul `_write` l'écrit (la migration, portail arrêté).
_spaces: dict[str, str] = {}


def board_space(bid: str) -> str | None:
    """Le Workspace d'une planche (sans le champ : celui qu'elle a déjà, space_of)."""
    s = _spaces.get(bid)
    if s:
        return s
    try:
        d = json.loads(_path(bid).read_text(encoding="utf-8"))
    except (OSError, ValueError, HttpError):
        return None
    from tools import ideation_collab   # l'auteur d'une planche est dans son fichier d'accès
    s = library.space_of({"space": d.get("space") if isinstance(d, dict) else None,
                          "owner": ideation_collab._access(bid).get("owner")})
    _spaces[bid] = s
    return s


def _write(b: dict) -> None:
    f = _path(b["id"])
    # le Workspace : celui du fichier (jamais celui de la page) ; une planche neuve, celui de la requête
    b["space"] = board_space(b["id"]) if f.exists() else library.new_space()
    # ce qu'elle pose est de son Workspace (409 qui mène au rapatriement, tools/elements.py,
    # ID_FIELDS) : par ici passent l'enregistrement, la co-édition (qui écarte déjà chaque
    # opération qui poserait un objet d'ailleurs), renommer, dupliquer. Le jugement ne
    # dépend que de la planche et des objets : il vaut aussi dans le fil de la co-édition
    from tools import elements
    elements.check_space(b["id"], b, b["space"])
    _spaces[b["id"]] = b["space"]
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(b, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(f)
    # collab : une planche écrite entière (l'enregistrement de repli, renommer)
    # remplace la copie des opérations ; les onglets reliés se recalent
    from tools import ideation_collab
    ideation_collab.hot_forget(b)


def new_id() -> str:
    return f"ide-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"


def blank(name: str) -> dict:
    now = library.now()
    return {"id": new_id(), "name": (name or "").strip()[:120] or "Sans titre",
            "created": now, "updated": now, "rev": 1, "v": VERSION, "nodes": [], "links": []}


# ── validation ───────────────────────────────────────────────
def _num(v, lo: float, hi: float, default: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(x):
        return default
    return round(max(lo, min(hi, x)), 2)


def _s(v, n: int) -> str:
    return str(v if v is not None else "")[:n]


def _jobs(v) -> list:
    out = []
    for j in (v or [])[:32]:
        if isinstance(j, dict) and JOB.fullmatch(str(j.get("id", ""))):
            e = {"id": j["id"], "act": _s(j.get("act"), 20)}
            # un rendu de lot : son cadre, sa colonne (la valeur), son rang, sa place dans le cadre
            if NID.fullmatch(str(j.get("frame", ""))):
                e.update(frame=j["frame"], col=int(_num(j.get("col"), 0, LOT_MAX, 0)), row=int(_num(j.get("row"), 0, LOT_MAX, 0)),
                         dx=_num(j.get("dx"), 0, 20000, 20.0), w=_num(j.get("w"), 16, 4000, 220.0))
            out.append(e)
    return out


def _slot_lot(s: dict, role: str) -> dict:
    """Ce qu'une case du composeur porte en plus (ideation/ports.js) : `vary`
    (elle varie ; ni Son ni Musique), `values` [{t, on}] (ses valeurs écrites),
    `skip` (les lignes décochées d'une case branchée), `looks` (les pastilles
    d'une case Photographie, celles de l'outil Image : une pastille disparue
    tombe, comme sur la carte Générer)."""
    out = {}
    if s.get("vary") and role not in VIDEO_ONLY:
        out["vary"] = True
    if isinstance(s.get("values"), list):
        out["values"] = [{"t": " ".join(_s(v.get("t"), 2000).split()), "on": v.get("on") is not False}
                         for v in s["values"][:MAX_VALUES] if isinstance(v, dict)]
    if isinstance(s.get("skip"), list):
        out["skip"] = [" ".join(_s(x, 2000).split()) for x in s["skip"][:MAX_VALUES] if isinstance(x, str)]
    if role == "photo" and isinstance(s.get("looks"), dict):
        img = _image()
        looks = {g: lid for g, lid in s["looks"].items() if g in img.LOOKS and any(x["id"] == lid for x in img.LOOKS[g]["items"])}
        if looks:
            out["looks"] = looks
    return out


def _node(n) -> dict:
    if not isinstance(n, dict):
        raise HttpError(400, "un objet de la planche est un objet JSON")
    nid = str(n.get("id", ""))
    if not NID.fullmatch(nid):
        raise HttpError(400, f"objet sans identifiant valide : {nid!r}")
    t = n.get("type")
    if t not in TYPES:
        raise HttpError(400, f"sorte d'objet inconnue : {t!r} ({', '.join(TYPES)})")
    out = {"id": nid, "type": t, "x": _num(n.get("x"), -1e6, 1e6, 0.0), "y": _num(n.get("y"), -1e6, 1e6, 0.0),
           "w": _num(n.get("w"), 16, 20000, 200.0), "h": _num(n.get("h"), 16, 20000, 120.0)}
    par = n.get("parent")
    if isinstance(par, str) and NID.fullmatch(par) and par != nid:
        out["parent"] = par          # vérifié dans normalize : un parent absent tombe
    grp = n.get("group")
    # un cadre entre dans un groupe comme les autres objets (Cal, 30/09 : « on ne peut pas les grouper ? »)
    if t != "group" and isinstance(grp, str) and NID.fullmatch(grp) and grp != nid:
        out["group"] = grp           # vérifié dans normalize : un groupe absent tombe
    mid = n.get("mid")
    if t not in ("frame", "group") and isinstance(mid, str) and NID.fullmatch(mid):
        out["mid"] = mid             # le « morph » d'une diapositive à l'autre : le même objet (dupliquer la diapositive)
    if t == "group":
        lay = n.get("layout") if isinstance(n.get("layout"), dict) else {}
        out.update(name=_s(n.get("name"), 120), collapsed=bool(n.get("collapsed")), lod=bool(n.get("lod")),
                   layout={"mode": lay.get("mode") if lay.get("mode") in GROUP_MODES else "free",
                           "width": _num(lay.get("width"), 0, 20000, 0.0), "gap": _num(lay.get("gap"), 0, 400, GROUP_GAP),
                           "fit": lay.get("fit") if lay.get("fit") in GROUP_FITS else ""})
    elif t == "media":
        item = str(n.get("item", ""))
        if not ITEM.fullmatch(item):
            raise HttpError(400, f"l'objet {nid} ne pointe vers aucun objet de la bibliothèque")
        if n.get("kind") not in MEDIA_KINDS:
            raise HttpError(400, f"l'objet {nid} n'est ni image, ni vidéo, ni son, ni élément")
        out.update(item=item, kind=n["kind"], title=_s(n.get("title"), 200), jobs=_jobs(n.get("jobs")))
    elif t in ("note", "sticky", "title"):
        out["text"] = _s(n.get("text"), 5000)
        if t == "sticky":
            out["color"] = n.get("color") if n.get("color") in STICKY else next(iter(STICKY))
        if t == "title":
            out["size"] = n.get("size") if n.get("size") in TITLE_SIZES else "m"
        if t != "sticky":
            # un style de texte nommé (diapositives) et l'alignement ; un style inconnu tombe
            if n.get("style") in TEXT_STYLES:
                out["style"] = n["style"]
            if n.get("align") in TEXT_ALIGN[1:]:
                out["align"] = n["align"]
    elif t == "frame":
        out["name"] = _s(n.get("name"), 120)
        # l'ordre de présentation (atelier : présentation par cadres) ; un nombre, sinon rien
        sl = n.get("slide")
        if isinstance(sl, (int, float)) and not isinstance(sl, bool) and math.isfinite(sl):
            out["slide"] = int(max(0, min(9999, sl))) if float(sl).is_integer() else round(max(0.0, min(9999.0, float(sl))), 3)
        if n.get("skip") is True:
            out["skip"] = True       # masquée dans la présentation (le cadre reste sur la planche)
        dk = n.get("deck")
        if isinstance(dk, dict) and dk.get("ratio") in DECK_RATIOS:
            # une diapositive : la scène de son format, toujours (le cadre ne se redimensionne pas)
            out["deck"] = {"ratio": dk["ratio"], "trans": dk.get("trans") if dk.get("trans") in DECK_TRANS else "fade"}
            out["w"], out["h"] = (float(v) for v in DECK_RATIOS[dk["ratio"]])
    elif t == "gen":
        img = _image()
        model = n.get("model") if n.get("model") in img.MODELS else "krea2"
        looks = {}
        for g, lid in (n.get("looks") or {}).items() if isinstance(n.get("looks"), dict) else []:
            if g in img.LOOKS and any(x["id"] == lid for x in img.LOOKS[g]["items"]):
                looks[g] = lid
        choice = {}
        for k, v in (n.get("refChoice") or {}).items() if isinstance(n.get("refChoice"), dict) else []:
            if ITEM.fullmatch(str(k)) and REF_FILE.fullmatch(str(v)):
                choice[k] = v
        try:
            count = int(n.get("count", 2))
        except (TypeError, ValueError):
            count = 2
        seed = re.sub(r"\D", "", str(n.get("seed") or ""))[:15]
        out.update(prompt=_s(n.get("prompt"), 6000), model=model,
                   aspect=n.get("aspect") if n.get("aspect") in img.ASPECTS else "3:4",
                   quality=_s(n.get("quality"), 8), count=max(1, min(4, count)), looks=looks,
                   variant="base" if n.get("variant") == "base" else "turbo",
                   realism=bool(n.get("realism", True)), seed=seed, refChoice=choice,
                   jobs=_jobs(n.get("jobs")), error=_s(n.get("error"), 500))
    elif t == "vgen":
        mv = _movie()
        try:
            frames = int(n.get("frames", mv.FRAMES[0]))
        except (TypeError, ValueError):
            frames = mv.FRAMES[0]
        canvas = str(n.get("canvas") or "auto")
        if canvas != "auto" and not re.fullmatch(r"\d{3,4}x\d{3,4}", canvas):
            canvas = "auto"
        out.update(prompt=_s(n.get("prompt"), 6000), mode=n.get("mode") if n.get("mode") in mv.MODES else "i2v",
                   frames=min(mv.FRAMES, key=lambda f: abs(f - frames)), canvas=canvas,
                   method=n.get("method") if n.get("method") in mv.METHODS else "turbo",
                   seed=re.sub(r"\D", "", str(n.get("seed") or ""))[:15], sound=_s(n.get("sound"), 2000),
                   music=_s(n.get("music"), 2000), jobs=_jobs(n.get("jobs")), error=_s(n.get("error"), 500))
    elif t == "compose":
        raw = n.get("slots") if isinstance(n.get("slots"), list) else [{"id": i, "role": i, "name": nm} for i, nm in SLOTS]
        slots, seen = [], set()
        for s in raw[:MAX_SLOTS]:
            sid = str(s.get("id", "")) if isinstance(s, dict) else ""
            if not SLOT_ID.fullmatch(sid) or sid in seen:
                continue
            seen.add(sid)
            role = s.get("role") if s.get("role") in ROLES else sid if sid in ROLES else "libre"
            slot = {"id": sid, "role": role, "name": _s(s.get("name"), 40).strip() or "case", "text": _s(s.get("text"), 4000),
                    "lock": bool(s.get("lock")), "off": bool(s.get("off"))}
            slot.update(_slot_lot(s, role))
            slots.append(slot)
        out["slots"] = slots
    elif t == "palette":
        out["colors"] = [c.lower() for c in (n.get("colors") or [])[:16] if isinstance(c, str) and HEX.fullmatch(c)]
        if ITEM.fullmatch(str(n.get("item", ""))):
            out["item"] = n["item"]
    elif t == "shape":
        out.update(kind=n.get("kind") if n.get("kind") in SHAPES else "round",
                   color=n.get("color") if n.get("color") in PALETTE else "cy", text=_s(n.get("text"), 2000))
    elif t == "card":
        kind = n.get("kind") if n.get("kind") in CARD_KINDS else "task"
        out.update(kind=kind, color=n.get("color") if n.get("color") in PALETTE else CARD_KINDS[kind],
                   text=_s(n.get("text"), 300), data=_card_data(kind, n.get("data")))
    elif t == "mind":
        # un nœud tient sur une ligne ; son parent est vérifié dans normalize (_minds)
        out.update(text=" ".join(_s(n.get("text"), 300).split()), collapsed=bool(n.get("collapsed")))
    elif t == "ink":
        pts = n.get("pts")
        if (not isinstance(pts, list) or len(pts) < 4 or len(pts) % 2 or len(pts) > INK_MAX
                or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in pts)):
            raise HttpError(400, f"le trait {nid} n'a pas de points lisibles (des paires x, y de 0 à 1000, {INK_MAX // 2} au plus)")
        out.update(pts=[int(max(0, min(1000, round(v)))) for v in pts],
                   color=n.get("color") if n.get("color") in PALETTE else "or", width=_num(n.get("width"), 0.5, 12, 2.2))
    elif t == "web":   # web : l'adresse (http, https) et ce que l'aperçu en a lu — server/tools/web_apercu.py
        from tools import web_apercu
        out.update(web_apercu.node_fields(n))
    return out


def _pres(p) -> dict | None:
    """Le design de la présentation (`pres` de la planche) : les styles de texte
    changés par rapport aux défauts (TEXT_STYLES). Une valeur hors bornes revient
    au défaut ; une police inconnue ou hors des styles (Norelli) tombe. Rien de
    changé : None (la planche ne porte pas `pres`)."""
    if not isinstance(p, dict):
        return None
    styles = {}
    raw = p.get("styles") if isinstance(p.get("styles"), dict) else {}
    for sid, st in raw.items():
        if sid not in TEXT_STYLES or not isinstance(st, dict):
            continue
        o = {}
        f = st.get("font")
        if isinstance(f, str) and f in FONT_IDS and FONT_IDS[f]["use"]:
            o["font"] = f
        for k, lo, hi in (("size", 6, 400), ("lh", 0.7, 3.0), ("track", -0.2, 1.0)):
            v = st.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
                o[k] = round(max(lo, min(hi, float(v))), 3)
        w = st.get("weight")
        if isinstance(w, (int, float)) and not isinstance(w, bool) and math.isfinite(w):
            o["weight"] = int(max(100, min(900, round(w / 100) * 100)))
        if isinstance(st.get("upper"), bool):
            o["upper"] = st["upper"]
        if o:
            styles[sid] = o
    return {"styles": styles} if styles else None


def style_of(b: dict, sid: str) -> dict:
    """Un style de texte tel que la planche le montre : le défaut, puis ce que `pres` en change."""
    return {**TEXT_STYLES[sid], **((b.get("pres") or {}).get("styles") or {}).get(sid, {})}


def _card_data(kind: str, d) -> dict:
    """Les champs d'une carte, selon sa sorte (ideation/objets/cartes.js) : bornés,
    ceux d'une autre sorte tombent."""
    d = d if isinstance(d, dict) else {}
    line = lambda v, n: " ".join(_s(v, n).split())   # noqa: E731
    if kind == "task":
        try:
            status = int(d.get("status", 0))
        except (TypeError, ValueError):
            status = 0
        checks = []
        for c in (d.get("checks") if isinstance(d.get("checks"), list) else [])[:MAX_CHECKS * 4]:
            if isinstance(c, (list, tuple)) and c and len(checks) < MAX_CHECKS:
                checks.append([line(c[0], 200), bool(c[1]) if len(c) > 1 else False])
        return {"status": max(0, min(3, status)), "who": line(d.get("who"), 4).upper(), "due": line(d.get("due"), 24), "checks": checks}
    if kind == "link":
        return {"url": line(d.get("url"), 500), "desc": _s(d.get("desc"), 1000)}
    if kind == "metric":
        series = [round(float(v), 4) for v in (d.get("series") if isinstance(d.get("series"), list) else [])[:60]
                  if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)]
        return {"value": line(d.get("value"), 24), "unit": line(d.get("unit"), 12), "delta": line(d.get("delta"), 12), "series": series}
    item = str(d.get("item") or "")
    return {"who": line(d.get("who"), 4).upper(), "role": line(d.get("role"), 60), "item": item if ITEM.fullmatch(item) else ""}


def _minds(nodes: list) -> None:
    """Les arbres de mind map (ideation/objets/mindmap.js : la même règle) : le
    parent d'un nœud est un nœud, sinon il tombe (le nœud fait racine) ; une
    boucle se coupe ; tout l'arbre est dans le groupe de sa racine."""
    byid = {nn["id"]: nn for nn in nodes if nn["type"] == "mind"}
    for nn in byid.values():
        if nn.get("parent") not in byid:
            nn.pop("parent", None)
    # une boucle : en remontant depuis un nœud, on retombe sur lui ; son parent se coupe
    for nn in byid.values():
        p, steps = nn.get("parent"), 0
        while p and steps <= len(byid):
            if p == nn["id"]:
                nn.pop("parent")
                break
            p, steps = byid[p].get("parent"), steps + 1

    def root(nn):
        r, steps = nn, 0
        while r.get("parent") and steps <= len(byid):
            r, steps = byid[r["parent"]], steps + 1
        return r
    for nn in byid.values():
        r = root(nn)
        if r is nn:
            continue
        if r.get("group"):
            nn["group"] = r["group"]
        else:
            nn.pop("group", None)


def _mind_info(nodes: list) -> dict:
    """La profondeur, la couleur du rameau et le repli de chaque nœud de mind
    map (ideation/objets/mindmap.js, mindLayout) : { id: (rang, jeton, caché) }."""
    byid = {nn["id"]: nn for nn in nodes if nn["type"] == "mind"}
    kids: dict[str, list] = {}
    for nn in byid.values():
        if nn.get("parent") in byid:
            kids.setdefault(nn["parent"], []).append(nn)
    out: dict[str, tuple] = {}
    # un parcours sans récursion (un arbre de 3000 rangs ne fait pas déborder la pile)
    todo = [(nn, 0, "or", False) for nn in byid.values() if nn.get("parent") not in byid]
    while todo:
        nn, depth, color, hidden = todo.pop()
        if nn["id"] in out:
            continue
        out[nn["id"]] = (depth, color, hidden)
        for i, c in enumerate(kids.get(nn["id"], [])):
            todo.append((c, depth + 1, MIND_BRANCH[i % len(MIND_BRANCH)] if depth == 0 else color, hidden or bool(nn.get("collapsed"))))
    return out


def _groups(nodes: list) -> tuple[list, set]:
    """Les règles des groupes (ideation/groups.js, tidy : la même) : un ancien
    `parent` qui est un groupe devient `group` ; `group` pointe vers un groupe
    présent, sinon il tombe ; pas de groupe dans un groupe (`_node` ne le garde
    pas ; un cadre, lui, y entre) ; un groupe de moins de deux enfants se dissout. Rend les objets
    gardés et les identifiants des groupes retirés."""
    groups = {nn["id"] for nn in nodes if nn["type"] == "group"}
    for nn in nodes:
        if "group" not in nn and nn.get("parent") in groups and nn["type"] not in ("frame", "group"):
            nn["group"] = nn.pop("parent")
        if nn.get("group") not in groups:
            nn.pop("group", None)
    count: dict[str, int] = {}
    for nn in nodes:
        if nn.get("group"):
            count[nn["group"]] = count.get(nn["group"], 0) + 1
    gone = {g for g in groups if count.get(g, 0) < 2}
    if not gone:
        return nodes, gone
    for nn in nodes:
        if nn.get("group") in gone:
            nn.pop("group")
        if nn.get("parent") in gone:
            nn.pop("parent")
    return [nn for nn in nodes if nn["id"] not in gone], gone


def normalize(b: dict) -> dict:
    """Rend une planche propre, ou lève HttpError(400) en disant pourquoi."""
    if not isinstance(b, dict):
        raise HttpError(400, "une planche est un objet JSON")
    raw = b.get("nodes") or []
    if not isinstance(raw, list) or len(raw) > MAX_NODES:
        raise HttpError(400, f"trop d'objets ({MAX_NODES} au plus)")
    nodes, ids = [], set()
    for n in raw:
        nn = _node(n)
        if nn["id"] in ids:
            raise HttpError(400, f"objet en double : {nn['id']}")
        ids.add(nn["id"])
        nodes.append(nn)
    for nn in nodes:
        if nn.get("parent") not in ids:
            nn.pop("parent", None)
    _minds(nodes)
    nodes, gone = _groups(nodes)
    ids -= gone
    byid = {nn["id"]: nn for nn in nodes}
    try:
        old = int(b.get("v") or 1) < VERSION
    except (TypeError, ValueError):
        old = True
    rawl = b.get("links") or []
    if not isinstance(rawl, list) or len(rawl) > MAX_LINKS:
        raise HttpError(400, f"trop de liens ({MAX_LINKS} au plus)")
    links, lids, wires = [], set(), set()
    for lk in rawl:
        if not isinstance(lk, dict):
            raise HttpError(400, "un lien est un objet JSON")
        lid = str(lk.get("id", ""))
        if not NID.fullmatch(lid) or lid in lids:
            raise HttpError(400, f"lien sans identifiant valide ou en double : {lid!r}")
        a, z = str(lk.get("a", "")), str(lk.get("b", ""))
        if a in gone or z in gone:
            continue              # un lien vers un groupe dissous part avec lui
        if a not in ids or z not in ids:
            raise HttpError(400, f"le lien {lid} relie un objet absent de la planche")
        if a == z:
            raise HttpError(400, f"le lien {lid} relie un objet à lui-même")
        kind = lk.get("kind") if lk.get("kind") in LINK_KINDS else "arrow"
        entry = {"id": lid, "a": a, "b": z, "kind": kind, "label": _s(lk.get("label"), 120)}
        src, dst = byid[a], byid[z]
        # la migration : avant les fils, une image ou un élément relié à une carte Générer en était la référence
        if old and kind == "arrow" and dst["type"] == "gen" and src["type"] == "media" and src.get("kind") in ("image", "element"):
            entry.update(kind="wire", pa=src["kind"], pb="refs")
        elif kind == "wire":
            pa, pb = str(lk.get("pa", "")), str(lk.get("pb", ""))
            if not PORT.fullmatch(pa) or not PORT.fullmatch(pb):
                raise HttpError(400, f"le fil {lid} n'a pas de sortie ou d'entrée valide ({pa!r} → {pb!r})")
            entry.update(pa=pa, pb=pb)
        elif kind == "out" and str(lk.get("lot", "")) in ids and byid[str(lk["lot"])]["type"] == "frame":
            entry["lot"] = lk["lot"]      # la lignée d'un rendu de lot : son cadre (la page ne dessine qu'un lien, vers lui)
        if entry["kind"] in ("arrow", "line") and lk.get("dash") is True:
            entry["dash"] = True          # une annotation en pointillé (le menu du lien, les modèles)
        if entry["kind"] == "wire":
            key = (a, entry["pa"], z, entry["pb"])
            if key in wires:
                continue          # le même fil deux fois : gardé une fois
            wires.add(key)
        lids.add(lid)
        links.append(entry)
    out = {"id": b.get("id"), "name": _s(b.get("name") or "Sans titre", 120).strip() or "Sans titre",
           "v": VERSION, "nodes": nodes, "links": links}
    pres = _pres(b.get("pres"))
    if pres:
        out["pres"] = pres
    for k in ("created", "updated", "rev"):
        if k in b:
            out[k] = b[k]
    return out


# ── les routes ───────────────────────────────────────────────
def _need(req, bid: str, what: str) -> None:
    """collab : le rôle de la personne sur la planche (ideation_collab.py : propriétaire,
    éditeur, spectateur) permet-il `what` (see, edit, invite) ? Sinon 403, en disant pourquoi."""
    from tools import ideation_collab
    ideation_collab.need(req, bid, what)


def _summary(b: dict) -> dict:
    thumb = None
    kinds: dict[str, int] = {}
    for n in b["nodes"]:
        k = n.get("kind") if n["type"] == "media" else n["type"]
        kinds[k] = kinds.get(k, 0) + 1
        if thumb is None and n["type"] == "media" and n.get("kind") in ("image", "video", "element"):
            it = library.get(n["item"])
            if it:
                thumb = library.public(it).get("thumb_url")
    return {"id": b["id"], "name": b["name"], "created": b.get("created"), "updated": b.get("updated"),
            "rev": b.get("rev", 1), "nodes": len(b["nodes"]), "links": len(b["links"]), "kinds": kinds,
            "thumb_url": thumb}


def r_meta(req):
    img = _image()
    return {"sticky": [{"id": k, "ink": v, "name": STICKY_NAMES.get(k, k)} for k, v in STICKY.items()], "title_sizes": TITLE_SIZES,
            "objets": {"shapes": list(SHAPES), "palette": list(PALETTE), "cards": list(CARD_KINDS), "branch": list(MIND_BRANCH), "ink_max": INK_MAX},
            "link_kinds": list(LINK_KINDS), "types": list(TYPES), "version": VERSION,
            "limits": {"nodes": MAX_NODES, "links": MAX_LINKS, "slots": MAX_SLOTS},
            "lot": {"max": LOT_MAX, "values": MAX_VALUES},
            "element_types": list(library.ELEMENT_TYPES), "backend": img.backend(), "movie_engine": _movie().engine(),
            "deck": {"ratios": {k: list(v) for k, v in DECK_RATIOS.items()}, "trans": list(DECK_TRANS), "grid": DECK_GRID,
                     "align": list(TEXT_ALIGN), "styles": TEXT_STYLES, "fonts": FONTS}}


def r_list(req):
    from tools import ideation_collab   # collab : seulement les planches où l'on a un rôle
    out = []
    for f in _dir().glob("ide-*.json"):
        try:
            if not ideation_collab.can(getattr(req, "user", None), f.stem, "see"):
                continue
            s = _summary(normalize(json.loads(f.read_text(encoding="utf-8"))))
            s["role"] = ideation_collab.role_of(getattr(req, "user", None), f.stem)
            out.append(s)
        except (ValueError, HttpError):
            continue
    out.sort(key=lambda s: s.get("updated") or "", reverse=True)
    return {"boards": out}


def r_create(req):
    b = blank(req.json().get("name", ""))
    with _lock:
        _write(b)
    from tools import ideation_collab   # collab : qui crée la planche en est le propriétaire
    ideation_collab.created(b, getattr(req, "user", None))
    return b


def r_get(req, bid):
    """La planche, et son Workspace (`space`, comme ODIO et le Montage le rendent)."""
    _need(req, bid, "see")
    return {**normalize(load(bid)), "space": board_space(bid)}


def r_save(req, bid):
    """La page envoie la planche entière. `base_rev` : la version qu'elle
    avait ; si le fichier a bougé entre-temps, on refuse plutôt que
    d'écraser en silence."""
    _need(req, bid, "edit")
    d = req.json()
    with _lock:
        cur = load(bid)
        base = d.get("base_rev")
        if base is not None and int(base) != int(cur.get("rev", 1)):
            raise HttpError(409, "cette planche a été modifiée ailleurs (un autre onglet ?) : rechargez-la")
        # la version : celle de la page (qui a lu la planche migrée), sinon celle du fichier
        new = normalize({**d, "id": bid, "name": d.get("name", cur.get("name")), "v": d.get("v") or cur.get("v") or 1})
        from tools import ideation_collab   # un invité ne pose que ce qu'il voit déjà
        if not ideation_collab.guest_nodes_ok(getattr(req, "user", None), cur.get("nodes") or [], new["nodes"]):
            raise HttpError(403, "invité : on ne pose ici que des objets déjà sur tes planches")
        # le Workspace de ce qu'elle pose (409), les boucles d'éléments (400) : tools/elements.py
        from tools import elements
        elements.check_doc(bid, new, board_space(bid))
        new.update(created=cur.get("created"), updated=library.now(), rev=int(cur.get("rev", 1)) + 1)
        _write(new)
    return {"ok": True, "rev": new["rev"], "updated": new["updated"]}


def r_rename(req, bid):
    _need(req, bid, "edit")
    name = str(req.json().get("name", "")).strip()[:120]
    if not name:
        raise HttpError(400, "un nom, s'il vous plaît")
    with _lock:
        b = load(bid)
        b.update(name=name, updated=library.now(), rev=int(b.get("rev", 1)) + 1)
        _write(b)
    return _summary(normalize(b))


def r_duplicate(req, bid):
    _need(req, bid, "edit")
    with _lock:
        src = normalize(load(bid))
        now = library.now()
        # les travaux en cours restent à l'original : la copie ne poserait pas deux fois leurs images
        nodes = [{**n, "jobs": []} if "jobs" in n else n for n in src["nodes"]]
        b = {**src, "id": new_id(), "name": (src["name"] + " (copie)")[:120], "nodes": nodes,
             "created": now, "updated": now, "rev": 1}
        _write(b)
    from tools import ideation_collab   # collab : la copie est à qui l'a faite
    ideation_collab.created(b, getattr(req, "user", None))
    return _summary(b)


def r_delete(req, bid):
    _need(req, bid, "invite")   # collab : seul le propriétaire met sa planche à la corbeille
    f = _path(bid)
    if not f.exists():
        raise HttpError(404, "planche introuvable")
    trash = _dir() / "corbeille"
    trash.mkdir(exist_ok=True)
    with _lock:
        shutil.move(str(f), str(trash / f.name))
    return {"ok": True}


def r_export(req, bid):
    _need(req, bid, "see")
    d = req.json()
    b = normalize(load(bid))
    fid = str(d.get("frame") or "")
    title = b["name"]
    if fid:
        fr = next((n for n in b["nodes"] if n["id"] == fid and n["type"] == "frame"), None)
        if not fr:
            raise HttpError(400, "ce cadre n'est pas sur la planche")
        title = f"{b['name']} · {fr['name'] or 'cadre'}"
    elif not b["nodes"]:
        raise HttpError(409, "la planche est vide : posez quelque chose avant de l'exporter")
    # le travail est du Workspace de la planche : il y lit ses objets (library.get, borné au
    # Workspace du travail), et la garde du calcul le juge là
    j = jobs.submit("ideation.export", {"board": bid, "frame": fid, "rev": b.get("rev")},
                    title=f"Export · {title}", tool="ideation", space=board_space(bid))
    return jobs.public(j)


# ── le nuancier ──────────────────────────────────────────────
def picture_of(it: dict) -> Path | None:
    """Le fichier image qui représente un objet : l'image, la vignette d'une
    vidéo, la première référence d'un élément."""
    if it["kind"] == "image":
        return library.path_of(it)
    if it["kind"] == "video" and it.get("thumb"):
        return library.path_of(it, it["thumb"])
    if it["kind"] == "element":
        refs = (it.get("element") or {}).get("refs") or []
        if refs:
            return library.path_of(it, refs[0]["file"])
    return None


def palette_of(path: Path, n: int = 6) -> list[dict]:
    """Les `n` couleurs dominantes : quantification médiane de PIL
    (`Image.quantize`, MEDIANCUT), de la plus présente à la moins présente."""
    from PIL import Image
    method = Image.Quantize.MEDIANCUT if hasattr(Image, "Quantize") else 0
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((256, 256))
        q = im.quantize(colors=n, method=method)
    pal = q.getpalette() or []
    counts = sorted(q.getcolors() or [], reverse=True)
    total = sum(c for c, _ in counts) or 1
    return [{"hex": "#{:02x}{:02x}{:02x}".format(*pal[3 * i:3 * i + 3]), "share": round(c / total, 3)}
            for c, i in counts if 3 * i + 2 < len(pal)]


def r_palette(req, item_id):
    if not ITEM.fullmatch(item_id or ""):
        raise HttpError(400, "objet invalide")
    it = library.get(item_id)
    if not it or not library.readable(it):   # comme /api/library : un objet invisible n'existe pas
        raise HttpError(404, f"introuvable : {item_id}")
    path = picture_of(it)
    if not path or not path.exists():
        raise HttpError(409, "cet objet n'a pas d'image d'où tirer des couleurs")
    try:
        n = max(3, min(10, int(req.q("n", "6"))))
    except ValueError:
        n = 6
    return {"item": item_id, "colors": palette_of(path, n)}


# ── l'export en PNG ──────────────────────────────────────────
_tok: dict | None = None


def tokens() -> dict:
    """Les couleurs de commun/tokens.css, en RVB ; un jeton `rgba()` est
    posé sur le fond (`--bg`), comme à l'écran."""
    global _tok
    if _tok is None:
        # le thème sombre, le défaut (:root) : le bloc clair ([data-theme="light"]) redonne les
        # mêmes noms plus bas dans le fichier, il ne doit pas les écraser
        css = re.split(r'\n\[data-theme="light"\]\s*\{', (REPO / "commun" / "tokens.css").read_text(encoding="utf-8"))[0]
        out = {k: tuple(int(v[i:i + 2], 16) for i in (1, 3, 5))
               for k, v in re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})\b", css)}
        bg = out.get("bg", (0, 0, 0))
        for k, r, g, b_, a in re.findall(r"--([\w-]+):\s*rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)", css):
            al = float(a)
            out[k] = tuple(round(int(c) * al + bg[i] * (1 - al)) for i, c in enumerate((r, g, b_)))
        _tok = out
    return _tok


_fonts: dict = {}


def _font(kind: str, size: float):
    from PIL import ImageFont
    size = max(6, int(round(size)))
    key = (kind, size)
    if key not in _fonts:
        name = {"ui": "chakra-petch-light.ttf", "mono": "azeret-mono.ttf", "disp": "venus-rising.otf"}[kind]
        try:
            _fonts[key] = ImageFont.truetype(str(REPO / "commun" / "fonts" / name), size)
        except OSError:
            _fonts[key] = ImageFont.load_default()
    return _fonts[key]


def _wrap(draw, text: str, font, width: float, max_lines: int) -> list[str]:
    lines: list[str] = []
    for para in (text or "").split("\n"):
        cur = ""
        for w in para.split(" "):
            t = (cur + " " + w) if cur else w
            if draw.textlength(t, font=font) <= width or not cur:
                cur = t
            else:
                lines.append(cur)
                cur = w
            if len(lines) >= max_lines:
                break
        lines.append(cur)
        if len(lines) >= max_lines:
            break
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    return lines


def region_of(b: dict, frame: str = "") -> tuple[float, float, float, float]:
    if frame:
        f = next((n for n in b["nodes"] if n["id"] == frame and n["type"] == "frame"), None)
        if not f:
            raise ValueError("ce cadre n'est plus sur la planche")
        return f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]
    if not b["nodes"]:
        raise ValueError("la planche est vide")
    x0 = min(n["x"] for n in b["nodes"]) - MARGIN
    y0 = min(n["y"] for n in b["nodes"]) - MARGIN - 28   # le nom d'un cadre se pose au-dessus
    x1 = max(n["x"] + n["w"] for n in b["nodes"]) + MARGIN
    y1 = max(n["y"] + n["h"] for n in b["nodes"]) + MARGIN
    return x0, y0, x1, y1


def _edge(a: dict, b: dict) -> tuple[tuple[float, float], tuple[float, float]]:
    """Le segment entre deux boîtes, du bord de l'une au bord de l'autre (la
    droite des centres coupée par chaque boîte) — le même calcul que la page."""
    def clip(n, dx, dy):
        hw, hh = n["w"] / 2, n["h"] / 2
        if dx == 0 and dy == 0:
            return 0.0, 0.0
        t = min(hw / abs(dx) if dx else math.inf, hh / abs(dy) if dy else math.inf)
        return dx * t, dy * t
    ca = (a["x"] + a["w"] / 2, a["y"] + a["h"] / 2)
    cb = (b["x"] + b["w"] / 2, b["y"] + b["h"] / 2)
    dx, dy = cb[0] - ca[0], cb[1] - ca[1]
    ox, oy = clip(a, dx, dy)
    ix, iy = clip(b, -dx, -dy)
    return (ca[0] + ox, ca[1] + oy), (cb[0] + ix, cb[1] + iy)


def _inside(n: dict, r: tuple) -> bool:
    return n["x"] < r[2] and n["x"] + n["w"] > r[0] and n["y"] < r[3] and n["y"] + n["h"] > r[1]


def _wire_pts(p, q, steps: int = 28) -> list:
    """La courbe des fils (commun/wire.js, celle du nodal d'ODIO) en points :
    poignées horizontales à la moitié de l'écart, 40 au moins."""
    dx = max(40.0, abs(q[0] - p[0]) * 0.5)
    c1, c2 = (p[0] + dx, p[1]), (q[0] - dx, q[1])
    out = []
    for k in range(steps + 1):
        t = k / steps
        u = 1 - t
        out.append(tuple(u * u * u * p[i] + 3 * u * u * t * c1[i] + 3 * u * t * t * c2[i] + t * t * t * q[i] for i in (0, 1)))
    return out


def _in_ports(n: dict) -> list:
    """Les entrées d'une carte dans leur ordre d'affichage (ideation/ports.js,
    inPorts) : pour poser le bout d'un fil à sa hauteur dans l'export."""
    if n["type"] == "gen":
        return ["prompt", "refs"]
    if n["type"] == "vgen":
        return ["prompt"] + {"i2v": ["start", "end"], "r2v": ["image", "element", "video", "audio"]}.get(n.get("mode"), [])
    if n["type"] == "compose":
        return ["s:" + s["id"] for s in n.get("slots") or []]
    return []


def _wired_text(b: dict, byid: dict, nid: str, port: str, depth: int = 0) -> str | None:
    """Le texte qu'un fil apporte à une entrée (une note, un post-it, un titre,
    un composeur) ; None si rien n'y est branché."""
    for lk in b["links"]:
        if lk["kind"] == "wire" and lk["b"] == nid and lk.get("pb") == port and lk["a"] in byid:
            return _text_of(b, byid, byid[lk["a"]], depth + 1)
    return None


def _sentence(s: str) -> str:
    """Une case devient une phrase : un point s'il en manque un (image.py, _sentence)."""
    s = " ".join((s or "").split())
    return s if not s or s[-1] in ".!?»\"'" else s + "."


def _text_of(b: dict, byid: dict, n: dict, depth: int = 0) -> str:
    """La prose d'une sortie (ideation/ports.js, flow().text) : une note telle
    qu'écrite ; un composeur, ses cases ni coupées ni vides, ni Son ni
    Musique, en phrases jointes par une espace."""
    if n["type"] in TEXT_TYPES:
        return n.get("text") or ""
    if n["type"] != "compose" or depth > 12:
        return ""
    parts = []
    for s in n.get("slots") or []:
        if s.get("off") or s.get("role") in VIDEO_ONLY:
            continue
        got = _wired_text(b, byid, n["id"], "s:" + s["id"], depth)
        t = _sentence(_slot_value(s, got))
        if t:
            parts.append(t)
    return " ".join(parts)


def _varies(s: dict) -> bool:
    return bool(s.get("vary")) and not s.get("lock") and s.get("role") not in VIDEO_ONLY


def _slot_values(s: dict, got: str | None) -> list[tuple[str, bool]]:
    """Les valeurs d'une case qui varie (ports.js, valuesOf) : branchée, les
    lignes du texte reçu (`skip` : les décochées) ; écrite, `values`, sinon
    les lignes de son texte."""
    lines = lambda t: [x for x in (" ".join(y.split()) for y in (t or "").split("\n")) if x]   # noqa: E731
    if got is not None:
        skip = set(s.get("skip") or [])
        return [(t, t not in skip) for t in lines(got)]
    if isinstance(s.get("values"), list):
        return [(" ".join((v.get("t") or "").split()), v.get("on") is not False) for v in s["values"]]
    return [(t, True) for t in lines(s.get("text"))]


def _slot_value(s: dict, got: str | None) -> str:
    """Le texte d'une case : ce que son fil apporte, sinon le sien ; si elle
    varie, sa première valeur cochée (ce que la page montre et envoie hors lot)."""
    if not _varies(s):
        return got if got is not None else s.get("text") or ""
    return next((t for t, on in _slot_values(s, got) if on and t), "")


def render(b: dict, frame: str = "", check=lambda: None):
    """La planche (ou un cadre) en image PIL, et les objets de la
    bibliothèque qu'elle montre (sa lignée)."""
    from PIL import Image, ImageDraw, ImageOps
    T = tokens()
    r = region_of(b, frame)
    W, H = r[2] - r[0], r[3] - r[1]
    # une diapositive s'exporte à la taille de sa scène (1920 × 1080 en 16:9), pas au double
    deck = next((n for n in b["nodes"] if n["id"] == frame and n.get("deck")), None) if frame else None
    s = 1.0 if deck else min(EXPORT_SCALE, MAX_SIDE / max(W, H, 1))
    size = (max(16, round(W * s)), max(16, round(H * s)))
    img = Image.new("RGB", size, T["bg"])
    d = ImageDraw.Draw(img)
    X = lambda x: (x - r[0]) * s   # noqa: E731
    Y = lambda y: (y - r[1]) * s   # noqa: E731
    box = lambda n: [X(n["x"]), Y(n["y"]), X(n["x"] + n["w"]), Y(n["y"] + n["h"])]   # noqa: E731
    rad = lambda k: max(1, round(k * s))   # noqa: E731

    # la trame de points (24 px du monde, comme à l'écran)
    step = 24
    while step * s < 7:
        step *= 2
    gx = math.floor(r[0] / step) * step
    while gx < r[2]:
        gy = math.floor(r[1] / step) * step
        while gy < r[3]:
            d.point((X(gx), Y(gy)), fill=T["dot"])
            gy += step
        gx += step

    byid = {n["id"]: n for n in b["nodes"]}
    # la descendance d'un nœud de mind map replié n'est pas montrée (comme à l'écran)
    minfo = _mind_info(b["nodes"])
    folded = {k for k, v in minfo.items() if v[2]}
    shown = [n for n in b["nodes"] if _inside(n, r) and n["id"] not in folded]
    parents: list[str] = []

    def picture(n, w, h, radius):
        it = library.get(n["item"])
        p = picture_of(it) if it else None
        if not p or not p.exists():
            return None
        try:
            with Image.open(p) as im:
                im = ImageOps.fit(im.convert("RGB"), (max(1, round(w)), max(1, round(h))), Image.LANCZOS)
        except OSError:
            return None
        mask = Image.new("L", im.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], radius=radius, fill=255)
        return im, mask

    def text(n, lines_font, color, pad, lh_k=1.5, top=0.0):
        font = lines_font
        x0, y0, x1, y1 = box(n)
        width = x1 - x0 - 2 * pad
        lh = font.size * lh_k
        n_lines = max(1, int((y1 - y0 - 2 * pad - top) // lh))
        for k, line in enumerate(_wrap(d, n.get("text", ""), font, width, n_lines)):
            d.text((x0 + pad, y0 + pad + top + k * lh), line, font=font, fill=color)

    # 1. les cadres, dessous, les grands d'abord (comme la page : un cadre dans un autre reste visible)
    for n in sorted((m for m in shown if m["type"] == "frame"), key=lambda m: -m["w"] * m["h"]):
        x0, y0, x1, y1 = box(n)
        if n is deck:            # la scène seule : ni coins ronds, ni filet
            d.rectangle([x0, y0, x1, y1], fill=T["panel"])
            continue
        d.rounded_rectangle([x0, y0, x1, y1], radius=rad(9), fill=T["panel"], outline=T["line"], width=max(1, rad(1)))
        name = (n.get("name") or "cadre").upper()
        d.text((x0 + rad(4), y0 - rad(22)), name, font=_font("disp", 13 * s), fill=T["ink2"])
    check()

    # 2. les branches des mind maps (sous tout le reste), puis les liens : les fils et la
    # lignée en courbes (sortie à droite, entrée à gauche), les annotations en flèches droites
    for n in b["nodes"]:
        p = byid.get(n.get("parent") or "") if n["type"] == "mind" else None
        if not p or n["id"] in folded or n["id"] not in minfo:
            continue
        depth, col, _ = minfo[n["id"]]
        p0 = (p["x"] + p["w"], p["y"] + p["h"] / 2)
        p1 = (n["x"], n["y"] + (n["h"] if depth >= 2 else n["h"] / 2))
        mx = (p0[0] + p1[0]) / 2
        pts = [(X(x), Y(y)) for x, y in _bezier(p0, (mx, p0[1]), (mx, p1[1]), p1)]
        d.line(pts, fill=T.get(col, T["or"]), width=max(1, rad(2.6 if depth == 1 else 1.7 if depth == 2 else 1.2)), joint="curve")
    for lk in b["links"]:
        a, z = byid.get(lk["a"]), byid.get(lk["b"])
        if not a or not z or a["id"] in folded or z["id"] in folded:
            continue
        if lk.get("lot") in byid:
            continue          # un rendu de lot : sa lignée passe par le lien de la carte vers son cadre
        if lk["kind"] in ("wire", "out"):
            ports = _in_ports(z)
            if lk["kind"] == "wire" and lk.get("pb") in ports:
                k = ports.index(lk["pb"])
                py = z["y"] + 48 + (z["h"] - 72) * (k / max(1, len(ports) - 1) if len(ports) > 1 else 0)
            else:
                py = z["y"] + z["h"] / 2
            ay = a["y"] + (24 if a["type"] in ("gen", "vgen", "compose") else a["h"] / 2)
            kind = lk.get("pa") if lk["kind"] == "wire" else {"gen": "image", "vgen": "video"}.get(a["type"], a.get("kind"))
            col = T.get(KIND_COLORS.get(kind or "", ""), T["ink3"])
            pts = [(X(x), Y(y)) for x, y in _wire_pts((a["x"] + a["w"], ay), (z["x"], py))]
            d.line(pts, fill=col, width=max(1, rad(2 if lk["kind"] == "wire" else 1.2)), joint="curve")
            continue
        p0, p1 = _edge(a, z)
        col = T["ink3"]
        q0, q1 = (X(p0[0]), Y(p0[1])), (X(p1[0]), Y(p1[1]))
        if lk.get("dash"):
            _dashed(d, q0, q1, 6 * s, 5 * s, col, max(1, rad(1.5)))
        else:
            d.line([q0, q1], fill=col, width=max(1, rad(1.5)))
        if lk["kind"] != "line":
            ang = math.atan2(q1[1] - q0[1], q1[0] - q0[0])
            L, sp = 10 * s, 0.45
            d.polygon([q1, (q1[0] - L * math.cos(ang - sp), q1[1] - L * math.sin(ang - sp)),
                       (q1[0] - L * math.cos(ang + sp), q1[1] - L * math.sin(ang + sp))], fill=col)
        if lk.get("label"):
            f = _font("mono", 9 * s)
            mx, my = (q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2
            tw = d.textlength(lk["label"].upper(), font=f)
            d.rounded_rectangle([mx - tw / 2 - rad(6), my - rad(9), mx + tw / 2 + rad(6), my + rad(9)],
                                radius=rad(4), fill=T["panel2"])
            d.text((mx - tw / 2, my - f.size * 0.6), lk["label"].upper(), font=f, fill=T["ink2"])
    check()

    # 3. le reste, dans l'ordre d'empilement ; un groupe n'a pas de dessin à lui, et
    # l'export montre le contenu d'un groupe réduit, déplié (l'export sert à montrer les images)
    for n in shown:
        t = n["type"]
        if t in ("frame", "group"):
            continue
        x0, y0, x1, y1 = box(n)
        w, h = x1 - x0, y1 - y0
        if t == "media":
            parents.append(n["item"])
            kind = n.get("kind")
            if kind in ("image", "video"):
                got = picture(n, w, h, rad(7))
                if got:
                    img.paste(got[0], (round(x0), round(y0)), got[1])
                else:
                    d.rounded_rectangle([x0, y0, x1, y1], radius=rad(7), fill=T["panel2"])
                    d.text((x0 + rad(10), y0 + rad(10)), "ABSENT", font=_font("mono", 9 * s), fill=T["or"])
                if kind == "video":
                    c = (x0 + w / 2, y0 + h / 2)
                    R = min(w, h) * 0.12
                    d.ellipse([c[0] - R, c[1] - R, c[0] + R, c[1] + R], fill=T["veil"])
                    d.polygon([(c[0] - R * 0.35, c[1] - R * 0.5), (c[0] - R * 0.35, c[1] + R * 0.5), (c[0] + R * 0.55, c[1])],
                              fill=T["ink"])
            elif kind == "element":
                d.rounded_rectangle([x0, y0, x1, y1], radius=rad(9), fill=T["panel2"], outline=T["line-or"], width=max(1, rad(1)))
                cap = 64 * s
                got = picture(n, w - 2 * rad(8), max(1, h - cap - rad(8)), rad(5))
                if got:
                    img.paste(got[0], (round(x0 + rad(8)), round(y0 + rad(8))), got[1])
                d.text((x0 + rad(12), y1 - cap + rad(10)), (n.get("title") or "élément").upper()[:28],
                       font=_font("disp", 13 * s), fill=T["ink"])
                it = library.get(n["item"]) or {}
                el = it.get("element") or {}
                sub = f"{ETYPE_FR.get(el.get('type'), 'élément')} · {len(el.get('refs') or [])} réf.".upper()
                d.text((x0 + rad(12), y1 - cap + rad(34)), sub, font=_font("mono", 8.5 * s), fill=T["or"])
            else:  # son
                d.rounded_rectangle([x0, y0, x1, y1], radius=rad(9), fill=T["panel2"], outline=T["line"], width=max(1, rad(1)))
                d.text((x0 + rad(14), y0 + rad(12)), "SON", font=_font("mono", 8.5 * s), fill=T["grn2"])
                d.text((x0 + rad(14), y0 + rad(30)), (n.get("title") or "")[:40], font=_font("ui", 13 * s), fill=T["ink"])
        elif t in ("note", "title") and n.get("style") in TEXT_STYLES:
            _styled(d, n, style_of(b, n["style"]), (x0, y0, x1, y1), s, T["ink"])
        elif t == "note":
            d.rounded_rectangle([x0, y0, x1, y1], radius=rad(7), fill=T["panel2"], outline=T["line"], width=max(1, rad(1)))
            text(n, _font("ui", 13 * s), T["ink"], rad(12))
        elif t == "sticky":
            col = T.get(n.get("color"), T["coral-3"])
            d.rounded_rectangle([x0, y0, x1, y1], radius=rad(5), fill=col)
            text(n, _font("ui", 15 * s), T.get(STICKY.get(n.get("color"), "on-light"), T["on-light"]), rad(14), 1.4)
        elif t == "title":
            size = TITLE_SIZES.get(n.get("size"), 34)
            text(n, _font("disp", size * s), T["ink"], 0, 1.15)
        elif t in ("gen", "vgen"):
            d.rounded_rectangle([x0, y0, x1, y1], radius=rad(9), fill=T["panel"], outline=T["line-or"], width=max(1, rad(1)))
            if t == "gen":
                head = f"GÉNÉRER · {_image().MODELS.get(n.get('model'), {}).get('k', '')}"
            else:
                head = f"VIDÉO · {_movie().MODES.get(n.get('mode'), {}).get('label', '').upper()}"
            d.text((x0 + rad(14), y0 + rad(12)), head, font=_font("mono", 8.5 * s), fill=T["or"])
            got = _wired_text(b, byid, n["id"], "prompt")
            text({**n, "text": (got if got is not None else n.get("prompt")) or "—"}, _font("ui", 12 * s), T["ink2"], rad(14), 1.5, top=rad(22))
        elif t == "compose":
            d.rounded_rectangle([x0, y0, x1, y1], radius=rad(9), fill=T["panel"], outline=T["line-amb"], width=max(1, rad(1)))
            d.text((x0 + rad(14), y0 + rad(12)), "COMPOSEUR", font=_font("mono", 8.5 * s), fill=T["amb"])
            lines = []
            for sl in n.get("slots") or []:
                got = _wired_text(b, byid, n["id"], "s:" + sl["id"])
                if _varies(sl):
                    on = [v for v, k in _slot_values(sl, got) if k and v]
                    val = f"× {len(on)} : " + " | ".join(on) if on else "—"
                else:
                    val = " ".join(((got if got is not None else sl.get("text")) or "—").split())
                lines.append(f"{sl['name'].upper()}{' (COUPÉE)' if sl.get('off') else ''} · {val}")
            text({**n, "text": "\n".join(lines)}, _font("ui", 11 * s), T["ink2"], rad(14), 1.5, top=rad(22))
        elif t == "palette":
            cols = n.get("colors") or []
            if cols:
                sw = w / len(cols)
                lab = 18 * s
                for k, c in enumerate(cols):
                    rgb = tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
                    d.rectangle([x0 + k * sw, y0, x0 + (k + 1) * sw, y1 - lab], fill=rgb)
                    d.text((x0 + k * sw + rad(4), y1 - lab + rad(4)), c.upper(), font=_font("mono", 8 * s), fill=T["ink3"])
        elif t == "shape":
            col = T.get(n.get("color"), T["cy"])
            fill = _mix(col, T["bg"], 0.08)
            kind = n.get("kind")
            lw = max(1, rad(1.3))
            if kind == "rect":
                d.rectangle([x0, y0, x1, y1], fill=fill, outline=col, width=lw)
            elif kind == "ellipse":
                d.ellipse([x0, y0, x1, y1], fill=fill, outline=col, width=lw)
            elif kind in _SHAPE_PTS:
                d.polygon([(x0 + px / 100 * w, y0 + py / 100 * h) for px, py in _SHAPE_PTS[kind]], fill=fill, outline=col, width=lw)
            else:   # arrondi
                d.rounded_rectangle([x0, y0, x1, y1], radius=0.12 * min(w, h), fill=fill, outline=col, width=lw)
            _centered(d, n.get("text", ""), _font("ui", 14 * s), (x0 + rad(18), y0, x1 - rad(18), y1), T["ink"])
        elif t == "card":
            _card(d, img, n, (x0, y0, x1, y1), T, s, rad, picture, parents)
        elif t == "mind":
            depth, col, _ = minfo.get(n["id"], (0, "or", False))
            bcol = T.get(col, T["or"])
            if depth == 0:
                d.rounded_rectangle([x0, y0, x1, y1], radius=rad(10), fill=T["or"])
                _centered(d, (n.get("text") or "idée").upper(), _font("disp", 13 * s), (x0, y0, x1, y1), T["on-or"], one=True)
            elif depth == 1:
                d.rounded_rectangle([x0, y0, x1, y1], radius=rad(8), fill=T["panel"], outline=bcol, width=max(1, rad(1.5)))
                _centered(d, n.get("text") or "idée", _font("ui", 14 * s), (x0, y0, x1, y1), T["ink"], one=True)
            else:
                d.line([(x0, y1 - rad(1)), (x1, y1 - rad(1))], fill=bcol, width=max(1, rad(2)))
                f = _font("ui", 14 * s)
                d.text((x0 + rad(6), y0 + (h - f.size) / 2 - rad(2)), n.get("text") or "idée", font=f, fill=T["ink2"])
        elif t == "ink":
            p = n.get("pts") or []
            pts = [(x0 + p[i] / 1000 * w, y0 + p[i + 1] / 1000 * h) for i in range(0, len(p) - 1, 2)]
            if len(pts) > 1:
                d.line(pts, fill=T.get(n.get("color"), T["or"]), width=max(1, rad(n.get("width") or 2.2)), joint="curve")
        check()
    return img, list(dict.fromkeys(parents)), s


# les contours des formes en polygone (ideation/objets/formes.js : les mêmes, dans 100 × 100)
_SHAPE_PTS = {"diamond": [(50, 0), (100, 50), (50, 100), (0, 50)],
              "hex": [(22, 0), (78, 0), (100, 50), (78, 100), (22, 100), (0, 50)],
              "para": [(18, 0), (100, 0), (82, 100), (0, 100)]}
_STATUS = ("À FAIRE", "EN COURS", "REVUE", "FAIT")


def _mix(c, bg, a: float) -> tuple:
    """Une teinte posée à `a` sur le fond (le fond d'une forme : sa couleur à 8 %)."""
    return tuple(round(c[i] * a + bg[i] * (1 - a)) for i in range(3))


def _bezier(p0, c1, c2, p1, steps: int = 24) -> list:
    out = []
    for k in range(steps + 1):
        t = k / steps
        u = 1 - t
        out.append(tuple(u * u * u * p0[i] + 3 * u * u * t * c1[i] + 3 * u * t * t * c2[i] + t * t * t * p1[i] for i in (0, 1)))
    return out


def _dashed(d, q0, q1, dash: float, gap: float, fill, width: int) -> None:
    """Une ligne en pointillé (PIL n'en a pas)."""
    L = math.hypot(q1[0] - q0[0], q1[1] - q0[1])
    if L < 1:
        return
    ux, uy = (q1[0] - q0[0]) / L, (q1[1] - q0[1]) / L
    t = 0.0
    while t < L:
        e = min(L, t + dash)
        d.line([(q0[0] + ux * t, q0[1] + uy * t), (q0[0] + ux * e, q0[1] + uy * e)], fill=fill, width=width)
        t = e + gap


def _styled(d, n: dict, st: dict, bx: tuple, s: float, fill) -> None:
    """Un texte à style nommé (diapositives) : sa taille de scène, son interlignage,
    ses capitales, son alignement. Le serveur n'a que les polices du dépôt
    (commun/fonts) : Venus Rising, Azeret Mono, sinon Chakra Petch."""
    font = _font({"venus": "disp", "azeret": "mono"}.get(st.get("font"), "ui"), st["size"] * s)
    txt = n.get("text", "")
    if st.get("upper"):
        txt = txt.upper()
    x0, y0, x1, _ = bx
    lh = font.size * st["lh"]
    for k, line in enumerate(_wrap(d, txt, font, x1 - x0, 400)):
        tw = d.textlength(line, font=font)
        x = x0 if n.get("align") not in ("center", "right") else (x0 + (x1 - x0 - tw) / 2 if n["align"] == "center" else x1 - tw)
        d.text((x, y0 + k * lh + (lh - font.size) / 2), line, font=font, fill=fill)


def _centered(d, text: str, font, box: tuple, fill, one: bool = False, lh_k: float = 1.3) -> None:
    """Un texte centré dans une boîte (une forme, un nœud) ; `one` : une seule ligne."""
    x0, y0, x1, y1 = box
    lh = font.size * lh_k
    lines = [" ".join((text or "").split())] if one else _wrap(d, text or "", font, max(1, x1 - x0), max(1, int((y1 - y0) // lh)))
    lines = [ln for ln in lines if ln] if not one else lines
    top = y0 + (y1 - y0 - lh * len(lines)) / 2 + (lh - font.size) / 2
    for k, ln in enumerate(lines):
        tw = d.textlength(ln, font=font)
        d.text((x0 + (x1 - x0 - tw) / 2, top + k * lh), ln, font=font, fill=fill)


def _card(d, img, n: dict, bx: tuple, T: dict, s: float, rad, picture, parents: list) -> None:
    """Une carte tâche, lien, mesure ou personne (ideation/objets/cartes.js), telle qu'on la
    voit en travail : sa sorte, son titre, sa ligne."""
    x0, y0, x1, y1 = bx
    data = n.get("data") or {}
    col = T.get(n.get("color"), T["or"])
    d.rounded_rectangle([x0, y0, x1, y1], radius=rad(10), fill=T["panel2"], outline=T["line"], width=max(1, rad(1)))
    p = rad(14)
    d.rectangle([x0 + p, y0 + p + rad(4), x0 + p + rad(8), y0 + p + rad(12)], fill=col)
    mono = _font("mono", 8 * s)
    kind = n.get("kind")
    d.text((x0 + p + rad(15), y0 + p + rad(3)), {"task": "TÂCHE", "link": "LIEN", "metric": "MESURE", "person": "PERSONNE"}.get(kind, "CARTE"), font=mono, fill=T["ink3"])
    if kind == "task":
        st = _STATUS[max(0, min(3, int(data.get("status") or 0)))]
        tw = d.textlength(st, font=mono)
        d.text((x1 - p - tw, y0 + p + rad(3)), st, font=mono, fill=T["cy"])
    title = _font("ui", 15 * s)
    lines = _wrap(d, n.get("text") or "", title, x1 - x0 - 2 * p, 2)
    yy = y0 + p + rad(28)
    for k, ln in enumerate(lines):
        d.text((x0 + p, yy + k * title.size * 1.3), ln, font=title, fill=T["ink"])
    yy += max(1, len([ln for ln in lines if ln])) * title.size * 1.3 + rad(10)
    if kind == "task":
        checks = data.get("checks") or []
        done = sum(1 for c in checks if c[1])
        who = data.get("who") or "—"
        d.rounded_rectangle([x0 + p, yy, x0 + p + rad(20), yy + rad(20)], radius=rad(5), fill=T["verd-5"])
        _centered(d, who, _font("disp", 7 * s), (x0 + p, yy, x0 + p + rad(20), yy + rad(20)), T["on-grn"], one=True)
        d.text((x0 + p + rad(28), yy + rad(5)), (data.get("due") or "").upper(), font=_font("mono", 8.5 * s), fill=T["ink2"])
        if checks:
            bx0, bx1 = x0 + p + rad(110), x1 - p - rad(34)
            if bx1 > bx0:
                d.rectangle([bx0, yy + rad(9), bx1, yy + rad(11)], fill=T["line"])
                d.rectangle([bx0, yy + rad(9), bx0 + (bx1 - bx0) * done / len(checks), yy + rad(11)], fill=T["grn2"])
            d.text((x1 - p - rad(26), yy + rad(5)), f"{done}/{len(checks)}", font=_font("disp", 8.5 * s), fill=T["ink2"])
    elif kind == "link":
        d.text((x0 + p, yy), data.get("url") or "", font=_font("mono", 9 * s), fill=T["cy"])
    elif kind == "metric":
        big = _font("disp", 26 * s)
        d.text((x0 + p, yy), data.get("value") or "—", font=big, fill=T["ink"])
        vw = d.textlength(data.get("value") or "—", font=big)
        d.text((x0 + p + vw + rad(6), yy + big.size - rad(10)), data.get("unit") or "", font=_font("mono", 9 * s), fill=T["ink3"])
        dl = data.get("delta") or ""
        f = _font("disp", 9 * s)
        d.text((x1 - p - d.textlength(dl, font=f), yy + big.size - rad(10)), dl, font=f, fill=T["grn2"])
    elif kind == "person":
        a = rad(34)
        got = picture({"item": data["item"]}, a, a, rad(8)) if data.get("item") else None
        if got:
            img.paste(got[0], (round(x0 + p), round(yy)), got[1])
            parents.append(data["item"])
        else:
            d.rounded_rectangle([x0 + p, yy, x0 + p + a, yy + a], radius=rad(8), fill=T["verd-4"])
            who = (data.get("who") or "".join(w[0] for w in (n.get("text") or "").split()[:2]) or "?").upper()
            _centered(d, who, _font("disp", 10 * s), (x0 + p, yy, x0 + p + a, yy + a), T["on-grn"], one=True)
        d.text((x0 + p + a + rad(10), yy + a / 2 - rad(5)), (data.get("role") or "").upper(), font=_font("mono", 8.5 * s), fill=T["ink2"])


def run_export(ctx) -> dict:
    bid = ctx.params.get("board", "")
    b = normalize(load(bid))
    # ses entrées : les objets de la planche, lus dans le Workspace du travail (celui de la
    # planche, r_export) ; chacun en est (elements.check_space), sinon un objet manquerait en silence
    from tools import elements
    if auth.current_space() and auth.current_space() != board_space(bid):
        raise RuntimeError("ce rendu n'est pas du Workspace de la planche : relance-le depuis la planche")
    try:
        elements.check_space(bid, b, board_space(bid))
    except HttpError as e:
        raise RuntimeError(e.message) from e
    fid = ctx.params.get("frame") or ""
    ctx.progress(0.1, "compose la planche")
    try:
        img, parents, s = render(b, fid, ctx.check)
    except ValueError as e:
        raise RuntimeError(str(e)) from e
    ctx.progress(0.8, "range dans la bibliothèque")
    out = ctx.workdir / "planche.png"
    img.save(out, optimize=True)
    name = b["name"]
    if fid:
        fr = next((n for n in b["nodes"] if n["id"] == fid), {})
        name = f"{b['name']} · {fr.get('name') or 'cadre'}"
    it = ctx.add(out, kind="image", title=name, folder="Idéation",
                 params={"job": "ideation.export", "board": bid, "frame": fid, "rev": b.get("rev"), "scale": round(s, 3)},
                 parents=parents, origin={"model": "ideation"})
    return {"note": f"{img.width} × {img.height}", "item": it["id"], "board": bid}


# ── les lots : une case varie, la même carte part une fois par valeur ────────
# (étude ideation_weavy.md § 9.3). La page envoie, valeur par valeur, le prompt
# résolu (image) ou les réglages du plan (vidéo) ; ici on valide chaque valeur
# comme l'outil le ferait (image.check_generate, movie.plan), dans le plafond
# d'un envoi, avec la même graine d'une valeur à l'autre (l'image k de chaque
# valeur : base + k, comme api_generate) — et tout part, ou rien.
def _lot_values(d: dict) -> list[dict]:
    vals = d.get("values")
    if not isinstance(vals, list) or not vals:
        raise HttpError(400, "un lot sans valeur : cochez au moins une valeur de la case qui varie")
    if len(vals) > LOT_MAX:
        raise HttpError(400, f"{len(vals)} valeurs : {LOT_MAX} au plus par envoi")
    if not all(isinstance(v, dict) for v in vals):
        raise HttpError(400, "une valeur de lot est un objet JSON")
    return vals


def _submit_all(todo: list) -> list:
    """Met en file tous les travaux d'un lot ; un refus en route (un quota
    atteint, la garde du calcul : un coût que la personne ne peut pas dans ce
    Workspace) retire ceux qui y sont déjà — un lot à moitié parti n'aurait pas
    de sens, et rien ne reste d'un envoi refusé. La garde du calcul (celle de
    jobs.submit) juge d'abord chaque travail : un refus n'en met aucun en file
    (sinon des travaux « arrêtés » resteraient dans la file de la personne)."""
    me = auth.current()
    for kind, params, *_ in todo:
        jobs._guard(kind, params, me, me, jobs._space_for(me))
    out = []
    try:
        for kind, params, title, tool, pin, extra in todo:
            out.append({**jobs.public(jobs.submit(kind, params, title=title, tool=tool, pin=pin)), **extra})
    except Exception:
        for j in out:
            jobs.cancel(j["id"])
        raise
    return out


def _lot_image(d: dict, vals: list, name: str) -> dict:
    img = _image()
    card = d.get("image") if isinstance(d.get("image"), dict) else {}
    try:
        count = img._int(card.get("count", 1), 1, LOT_MAX, "nombre d'images")
        base = img._seed(card.get("seed"))
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    if len(vals) * count > LOT_MAX:
        raise HttpError(400, f"{len(vals)} valeurs × {count} images = {len(vals) * count} : {LOT_MAX} au plus par envoi")
    ps = []
    for i, v in enumerate(vals):
        try:
            ps.append(img.check_generate({**card, "prompt": _s(v.get("prompt"), 6001), "seed": base}))
        except ValueError as e:
            raise HttpError(400, f"valeur {i + 1} : {e}") from e
    pin = img._pin_for(img._cap_generate(ps[0]))
    batch = img._batch()
    todo = []
    for i, (v, p) in enumerate(zip(vals, ps)):
        value = " ".join(_s(v.get("value"), 2000).split())
        for k in range(count):
            # chaque image garde son prompt résolu et {case, valeur} : Réutiliser, Recréer, le fil de l'outil Image
            pk = {**p, "seed": (base + k) % img.MAX_SEED, "batch": batch, "lot": {"name": name, "value": value, "index": i}}
            todo.append(("image.generate", pk, f"{img.MODELS[p['model']]['name']} · {name} {i + 1}/{len(vals)} · {img._title(value, 6)}",
                         "image", pin, {"col": i, "row": k}))
    return {"batch": batch, "seed": base, "count": count, "jobs": _submit_all(todo)}


def _lot_video(d: dict, vals: list, name: str) -> dict:
    mv = _movie()
    mode = d.get("mode")
    if mode not in mv.MODES:
        raise HttpError(400, f"mode inconnu : {mode!r} ({', '.join(mv.MODES)})")
    ps = [v.get("params") if isinstance(v.get("params"), dict) else {} for v in vals]
    seed = next((p.get("seed") for p in ps if p.get("seed") not in (None, "")), None)
    try:
        # la graine de la carte, sinon une tirée ici, une fois (movie.run en tire une par plan)
        seed = int(seed) if seed is not None else secrets.randbelow(2 ** 31 - 2) + 1
    except (TypeError, ValueError) as e:
        raise HttpError(400, "graine illisible") from e
    todo = []
    for i, (v, p) in enumerate(zip(vals, ps)):
        p = {**p, "seed": seed}
        pl = mv.plan(mode, p)
        if pl["errors"]:
            raise HttpError(400, f"valeur {i + 1} : {pl['errors'][0]}")
        desc = " ".join(re.sub(r"@([\w-]+)", r"\1", str(p.get("desc") or "")).split())
        todo.append((f"movie.{mode}", p, f"{name} {i + 1}/{len(vals)} · {desc[:56] or mv.MODES[mode]['label']}", "movie", None, {"col": i, "row": 0}))
    return {"batch": "lot-" + secrets.token_hex(4), "seed": seed, "count": 1, "jobs": _submit_all(todo)}


def r_lot(req):
    d = req.json()
    vals = _lot_values(d)
    name = " ".join(_s(d.get("name"), 40).split()) or "case"
    if d.get("kind") == "image":
        return _lot_image(d, vals, name)
    if d.get("kind") == "video":
        return _lot_video(d, vals, name)
    raise HttpError(400, "un lot est d'images ou de vidéos (kind : image | video)")


def register(app) -> None:
    jobs.register("ideation.export", run_export, lane="cpu", title="Idéation · export", cost="cpu")
    app.route("POST", "/api/ideation/lot", r_lot)
    app.route("GET", "/api/ideation/meta", r_meta)
    app.route("GET", "/api/ideation/boards", r_list)
    app.route("POST", "/api/ideation/boards", r_create)
    app.route("GET", "/api/ideation/boards/{bid}", r_get)
    app.route("POST", "/api/ideation/boards/{bid}", r_save)
    app.route("POST", "/api/ideation/boards/{bid}/rename", r_rename)
    app.route("POST", "/api/ideation/boards/{bid}/duplicate", r_duplicate)
    app.route("POST", "/api/ideation/boards/{bid}/delete", r_delete)
    app.route("POST", "/api/ideation/boards/{bid}/export", r_export)
    app.route("GET", "/api/ideation/palette/{item_id}", r_palette)


# ── le contrôle (tools/check.py) ─────────────────────────────
def selftest(call, ok) -> None:
    from io import BytesIO
    from PIL import Image

    st, meta = call("GET", "/api/ideation/meta")
    ok(st == 200 and "coral-3" in [c["id"] for c in meta["sticky"]] and "gen" in meta["types"], f"idéation : réglages ({st})")
    st, b = call("POST", "/api/ideation/boards", {"name": "Essai idéation"})
    ok(st == 200 and BID.fullmatch(b.get("id", "")) and b["rev"] == 1 and b["nodes"] == [], f"idéation : créer une planche ({st} {b})")
    bid = b["id"]
    st, lst = call("GET", "/api/ideation/boards")
    ok(st == 200 and any(x["id"] == bid for x in lst["boards"]), "idéation : la liste")

    # une image rouge | bleue, pour le nuancier et l'export
    buf = BytesIO()
    im = Image.new("RGB", (120, 80), (220, 30, 30))
    im.paste((30, 40, 220), (60, 0, 120, 80))
    im.save(buf, "PNG")
    st, up = call("PUT", "/api/library/upload?name=idee.png&title=Idee&tool=ideation", raw=buf.getvalue())
    iid = up.get("id", "")
    ok(st == 200 and ITEM.fullmatch(iid), "idéation : une image dans la bibliothèque")
    st, pal = call("GET", f"/api/ideation/palette/{iid}?n=4")
    cols = [tuple(int(c["hex"][i:i + 2], 16) for i in (1, 3, 5)) for c in (pal or {}).get("colors", [])]
    ok(st == 200 and any(c[0] > 180 and c[2] < 80 for c in cols) and any(c[2] > 180 and c[0] < 80 for c in cols)
       and abs(sum(c["share"] for c in pal["colors"]) - 1) < 0.02, f"idéation : le nuancier trouve le rouge et le bleu ({pal})")
    st, _ = call("GET", "/api/ideation/palette/ima-20260101-000000-0000")
    ok(st == 404, "idéation : nuancier d'un objet absent refusé")

    nodes = [
        {"id": "f1", "type": "frame", "x": 0, "y": 0, "w": 400, "h": 300, "name": "Ambiance"},
        {"id": "m1", "type": "media", "item": iid, "kind": "image", "x": 40, "y": 40, "w": 120, "h": 80, "title": "Idee"},
        {"id": "n1", "type": "note", "x": 200, "y": 40, "w": 160, "h": 90, "text": "une note\nsur deux lignes"},
        {"id": "s1", "type": "sticky", "x": 200, "y": 160, "w": 150, "h": 110, "text": "post-it", "color": "verd-3"},
        {"id": "t1", "type": "title", "x": 0, "y": -120, "w": 500, "h": 60, "text": "Séquence 1", "size": "l"},
        {"id": "g1", "type": "gen", "x": 480, "y": 0, "w": 300, "h": 320, "prompt": "a woman in the rain", "model": "qwen21",
         "aspect": "16:9", "count": 9, "looks": {"lens": "85", "film": "n-existe-plus"}},
        {"id": "p1", "type": "palette", "x": 40, "y": 140, "w": 120, "h": 50, "colors": ["#dc1e1e", "#1e28dc", "rouge"]},
    ]
    links = [{"id": "l1", "a": "m1", "b": "g1"}, {"id": "l2", "a": "m1", "b": "p1", "kind": "out"}]
    st, sv = call("POST", f"/api/ideation/boards/{bid}", {"name": "Essai idéation", "nodes": nodes, "links": links, "base_rev": 1})
    ok(st == 200 and sv.get("rev") == 2, f"idéation : enregistrer ({st} {sv})")
    st, got = call("GET", f"/api/ideation/boards/{bid}")
    g = next((n for n in got.get("nodes", []) if n["id"] == "g1"), {})
    p = next((n for n in got.get("nodes", []) if n["id"] == "p1"), {})
    ok(st == 200 and len(got["nodes"]) == 7 and len(got["links"]) == 2, "idéation : relire la planche")
    ok(g.get("count") == 4 and g.get("looks") == {"lens": "85"} and g.get("model") == "qwen21",
       f"idéation : la carte Générer est bornée, un réglage disparu tombe ({g})")
    ok(p.get("colors") == ["#dc1e1e", "#1e28dc"], "idéation : un nuancier ne garde que des couleurs")
    st, stale = call("POST", f"/api/ideation/boards/{bid}", {"nodes": [], "links": [], "base_rev": 1})
    ok(st == 409, "idéation : une version dépassée ne l'écrase pas")
    for body, msg in (({"nodes": [{"id": "x", "type": "bombe"}]}, "une sorte inconnue"),
                      ({"nodes": [nodes[2], nodes[2]]}, "un objet en double"),
                      ({"nodes": [nodes[2]], "links": [{"id": "l", "a": "n1", "b": "zz"}]}, "un lien vers un objet absent"),
                      ({"nodes": [{**nodes[1], "item": "../../etc"}]}, "un objet hors de la bibliothèque")):
        st, r = call("POST", f"/api/ideation/boards/{bid}", {**body, "base_rev": 2})
        ok(st == 400, f"idéation : {msg} est refusé ({st} {r})")
    st, _ = call("GET", "/api/ideation/boards/..%2F..%2Fjobs")
    ok(st in (400, 404), f"idéation : un identifiant hors motif est refusé ({st})")

    st, rn = call("POST", f"/api/ideation/boards/{bid}/rename", {"name": "Planche renommée"})
    ok(st == 200 and rn["name"] == "Planche renommée" and rn["rev"] == 3, f"idéation : renommer ({st} {rn})")
    st, dup = call("POST", f"/api/ideation/boards/{bid}/duplicate")
    ok(st == 200 and dup["id"] != bid and dup["nodes"] == 7 and dup["name"].endswith("(copie)"), f"idéation : dupliquer ({st})")
    st, _ = call("POST", f"/api/ideation/boards/{dup['id']}/delete")
    st2, _ = call("GET", f"/api/ideation/boards/{dup['id']}")
    ok(st == 200 and st2 == 404, "idéation : la copie part à la corbeille")

    # l'export : la planche entière, puis le cadre ; l'image rouge doit être là où elle est posée
    def export(body):
        st, j = call("POST", f"/api/ideation/boards/{bid}/export", body)
        if st != 200:
            return st, j
        for _ in range(150):
            st, j = call("GET", f"/api/jobs/{j['id']}")
            if j["state"] in ("done", "error", "cancelled"):
                break
            time.sleep(0.2)
        return st, j
    st, j = export({})
    ok(st == 200 and j.get("state") == "done" and len(j.get("items", [])) == 1,
       f"idéation : exporter la planche ({st} {j.get('state')} {j.get('message')})")
    if j.get("items"):
        out = j["items"][0]
        ok(out["kind"] == "image" and iid in out["parents"] and out.get("folder") == "Idéation",
           "idéation : l'export se range dans la bibliothèque, avec sa lignée")
    st, j = export({"frame": "f1"})
    ok(st == 200 and j.get("state") == "done", f"idéation : exporter un cadre ({j.get('message')})")
    if j.get("items"):
        out = j["items"][0]
        s = out["params"]["scale"]
        ok((out["width"], out["height"]) == (round(400 * s), round(300 * s)), f"idéation : le cadre a sa taille ({out['width']}×{out['height']}, ×{s})")
        with Image.open(library.path_of(library.get(out["id"]))) as ex:
            ex = ex.convert("RGB")
            red = ex.getpixel((round(70 * s), round(80 * s)))     # moitié gauche de l'image posée à (40, 40)
            blue = ex.getpixel((round(130 * s), round(80 * s)))
        ok(red[0] > 180 and red[2] < 80 and blue[2] > 180 and blue[0] < 80,
           f"idéation : l'image posée est à sa place dans l'export ({red} {blue})")
    st, r = call("POST", f"/api/ideation/boards/{bid}/export", {"frame": "n1"})
    ok(st == 400, "idéation : exporter un objet qui n'est pas un cadre est refusé")
    _selftest_wires(call, ok, iid)
    _selftest_ports(call, ok)
    _selftest_lot(call, ok, iid)
    _selftest_groups(call, ok, iid)
    _selftest_objets(call, ok, iid)
    _selftest_deck(call, ok, iid)


def _selftest_deck(call, ok, iid: str) -> None:
    """Les diapositives (docs/etudes/presentations.md § 2.4, étapes 1 à 3) : un cadre
    garde son format (la scène), son ordre et son masque ; un texte, son style ; la
    planche, ses styles changés ; l'export d'une diapositive est sa scène."""
    from PIL import Image
    st, meta = call("GET", "/api/ideation/meta")
    dk = meta.get("deck") or {}
    ok(st == 200 and dk.get("ratios", {}).get("16:9") == [1920, 1080] and set(dk.get("styles", {})) == set(TEXT_STYLES)
       and all(f["licence"] and isinstance(f["web"], bool) for f in dk.get("fonts", [])),
       "diapositives : les formats, les styles et les polices (avec leur licence) dans les réglages")
    ok(all(TEXT_STYLES[s]["font"] in FONT_IDS and FONT_IDS[TEXT_STYLES[s]["font"]]["use"] for s in TEXT_STYLES)
       and sum(1 for f in FONTS if f.get("proposed") and f["licence"] == _OFL) >= 4,
       "diapositives : chaque style a une police de la bibliothèque ; des polices OFL proposées")
    b = blank("Essai des diapositives")
    _write(b)
    nodes = [
        {"id": "f1", "type": "frame", "x": 0, "y": 0, "w": 400, "h": 300, "name": "Ouverture", "deck": {"ratio": "16:9", "trans": "morph"}, "slide": 2},
        {"id": "f2", "type": "frame", "x": 2200, "y": 0, "w": 400, "h": 300, "name": "Constat", "deck": {"ratio": "5:4"}, "skip": True},
        {"id": "f3", "type": "frame", "x": 0, "y": 1400, "w": 500, "h": 500, "deck": {"ratio": "4:3", "trans": "tornade"}, "skip": "oui"},
        {"id": "t1", "type": "title", "x": 96, "y": 96, "w": 1144, "h": 90, "text": "Réponse au brief", "style": "h1", "align": "center"},
        {"id": "n1", "type": "note", "x": 96, "y": 400, "w": 700, "h": 90, "text": "trois lignes de corps", "style": "gras", "align": "left"},
        {"id": "m1", "type": "media", "item": iid, "kind": "image", "x": 1000, "y": 300, "w": 600, "h": 400, "mid": "m-a"},
        {"id": "s1", "type": "sticky", "x": 3000, "y": 0, "w": 150, "h": 150, "text": "x", "style": "h1"},
    ]
    pres = {"styles": {"h1": {"font": "fraunces", "size": 900, "weight": 640, "upper": False}, "body": {"font": "norelli"},
                       "zz": {"size": 10}}}
    st, sv = call("POST", f"/api/ideation/boards/{b['id']}", {"name": b["name"], "v": VERSION, "nodes": nodes, "links": [], "pres": pres, "base_rev": 1})
    st, got = call("GET", f"/api/ideation/boards/{b['id']}")
    N = {n["id"]: n for n in got.get("nodes", [])}
    f1, f2, f3 = N.get("f1", {}), N.get("f2", {}), N.get("f3", {})
    ok((f1.get("w"), f1.get("h")) == (1920, 1080) and f1.get("deck") == {"ratio": "16:9", "trans": "morph"} and f1.get("slide") == 2,
       f"diapositives : un cadre 16:9 prend la scène 1920 × 1080, garde sa transition et son ordre ({f1})")
    ok("deck" not in f2 and (f2.get("w"), f2.get("h")) == (400, 300) and f2.get("skip") is True,
       "diapositives : un format inconnu laisse un cadre libre ; masquée, elle le reste")
    ok((f3.get("w"), f3.get("h")) == (1440, 1080) and f3["deck"]["trans"] == "fade" and "skip" not in f3,
       "diapositives : 4:3 = 1440 × 1080, une transition inconnue revient au fondu, un masque illisible tombe")
    ok(N.get("t1", {}).get("style") == "h1" and N["t1"].get("align") == "center" and "style" not in N.get("n1", {})
       and "align" not in N["n1"] and "style" not in N.get("s1", {}) and N.get("m1", {}).get("mid") == "m-a",
       "diapositives : un texte garde son style et son alignement (un style inconnu tombe, un post-it n'en a pas) ; un objet, son mid")
    ok(got.get("pres") == {"styles": {"h1": {"font": "fraunces", "size": 400.0, "weight": 600, "upper": False}}},
       f"diapositives : les styles de la planche sont bornés, Norelli n'est pas une police de style ({got.get('pres')})")
    ok(style_of(got, "h1")["size"] == 400.0 and style_of(got, "h1")["lh"] == TEXT_STYLES["h1"]["lh"] and style_of(got, "body") == TEXT_STYLES["body"],
       "diapositives : un style lu = son défaut, puis ce que la planche en change")
    # l'export d'une diapositive : sa scène, à l'échelle 1
    st, j = call("POST", f"/api/ideation/boards/{b['id']}/export", {"frame": "f1"})
    for _ in range(150):
        st, j = call("GET", f"/api/jobs/{j['id']}")
        if j["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.2)
    it = (j.get("items") or [{}])[0]
    ok(j.get("state") == "done" and (it.get("width"), it.get("height")) == (1920, 1080),
       f"diapositives : l'export PNG d'une diapositive = la scène ({it.get('width')} × {it.get('height')})")
    if it.get("id"):
        with Image.open(library.path_of(library.get(it["id"]))) as ex:
            px = ex.convert("RGB").getpixel((1150, 500))   # la moitié gauche (rouge) de l'image posée à (1000, 300)
        ok(px[0] > 180 and px[2] < 80, f"diapositives : l'image posée est à sa place dans la scène exportée ({px})")
    st, _ = call("POST", f"/api/ideation/boards/{b['id']}", {**got, "pres": None, "base_rev": got["rev"]})
    st, got = call("GET", f"/api/ideation/boards/{b['id']}")
    ok("pres" not in got, "diapositives : des styles revenus aux défauts ne laissent rien sur la planche")


def _selftest_groups(call, ok, iid: str) -> None:
    """Les groupes (docs/etudes/ideation_miro.md § 3.1) : l'appartenance sur
    l'enfant, bornée ; pas d'imbrication (un cadre, lui, y entre depuis le 30/09) ; un groupe
    vide disparaît, un groupe à un enfant se dissout avec ses liens ; l'ancien
    `parent` vers un groupe devient `group` ; l'export montre un groupe réduit déplié."""
    from PIL import Image
    b = blank("Essai des groupes")
    _write(b)
    nodes = [
        {"id": "g1", "type": "group", "name": "Casting" * 30, "x": 0, "y": 0, "w": 400, "h": 300, "collapsed": 1, "lod": "oui",
         "layout": {"mode": "grille", "width": -5, "gap": 9999, "fit": "x"}},
        {"id": "m1", "type": "media", "item": iid, "kind": "image", "x": 24, "y": 24, "w": 120, "h": 80, "group": "g1"},
        {"id": "n1", "type": "note", "x": 200, "y": 24, "w": 160, "h": 60, "text": "dans le groupe", "group": "g1"},
        {"id": "n3", "type": "note", "x": 200, "y": 120, "w": 160, "h": 60, "text": "l'ancien parent", "parent": "g1"},
        {"id": "f1", "type": "frame", "x": -40, "y": -40, "w": 600, "h": 500, "name": "Zone", "group": "g1"},
        {"id": "g2", "type": "group", "name": "Seul", "x": 800, "y": 0, "w": 200, "h": 100, "group": "g1",
         "layout": {"mode": "flow", "width": 300, "gap": 16, "fit": "h"}},
        {"id": "n2", "type": "note", "x": 824, "y": 24, "w": 160, "h": 60, "text": "seul dans son groupe", "group": "g2"},
        {"id": "g3", "type": "group", "name": "Vide", "x": 0, "y": 600, "w": 100, "h": 100},
        {"id": "s1", "type": "sticky", "x": 0, "y": 800, "w": 190, "h": 150, "text": "", "group": "fantome"},
        {"id": "g4", "type": "group", "name": "Rangée", "x": 0, "y": 1000, "w": 100, "h": 100,
         "layout": {"mode": "flow", "width": 500, "gap": 16, "fit": "h"}},
        {"id": "n4", "type": "note", "x": 24, "y": 1024, "w": 160, "h": 60, "text": "a", "group": "g4"},
        {"id": "n5", "type": "note", "x": 200, "y": 1024, "w": 160, "h": 60, "text": "b", "group": "g4", "parent": "g3"},
    ]
    links = [{"id": "l1", "a": "n2", "b": "g2", "kind": "arrow"}, {"id": "l2", "a": "n1", "b": "g1", "kind": "arrow"},
             {"id": "l3", "a": "g3", "b": "s1", "kind": "line"}]
    st, sv = call("POST", f"/api/ideation/boards/{b['id']}", {"name": b["name"], "v": VERSION, "nodes": nodes, "links": links, "base_rev": 1})
    ok(st == 200, f"groupes : une planche à groupes s'enregistre ({st} {sv})")
    st, got = call("GET", f"/api/ideation/boards/{b['id']}")
    N = {n["id"]: n for n in got.get("nodes", [])}
    g1, g4 = N.get("g1", {}), N.get("g4", {})
    ok(g1.get("layout") == {"mode": "free", "width": 0.0, "gap": 400.0, "fit": ""} and g1.get("collapsed") is True and g1.get("lod") is True
       and len(g1.get("name", "")) == 120 and g4.get("layout") == {"mode": "flow", "width": 500.0, "gap": 16.0, "fit": "h"},
       f"groupes : la mise en forme est bornée (mode, largeur, espacement, même taille) ({g1.get('layout')} {g4.get('layout')})")
    ok(N.get("m1", {}).get("group") == "g1" and N.get("n1", {}).get("group") == "g1",
       "groupes : l'appartenance est sur l'enfant, gardée quand le groupe est là")
    ok(N.get("n3", {}).get("group") == "g1" and "parent" not in N.get("n3", {}),
       f"groupes : un ancien parent qui est un groupe devient son appartenance (sans perte) ({N.get('n3')})")
    ok(N.get("f1", {}).get("group") == "g1" and "g2" not in N and "group" not in N.get("n2", {}),
       "groupes : un cadre entre dans un groupe (Cal, 30/09) ; un groupe dans un groupe n'y reste pas, et, seul avec un enfant, il se dissout")
    ok("g3" not in N and "group" not in N.get("s1", {}) and "parent" not in N.get("n5", {}),
       "groupes : un groupe vide disparaît ; une appartenance vers un groupe absent tombe")
    ok([lk["id"] for lk in got.get("links", [])] == ["l2"],
       f"groupes : les liens d'un groupe dissous partent avec lui, les autres restent ({[lk['id'] for lk in got.get('links', [])]})")
    # un groupe réduit à un enfant (un geste qui en retire un) se dissout à l'enregistrement
    one = [n for n in got["nodes"] if n["id"] != "n5"]
    st, sv = call("POST", f"/api/ideation/boards/{b['id']}", {**got, "nodes": one, "links": got["links"], "base_rev": got["rev"]})
    st, again = call("GET", f"/api/ideation/boards/{b['id']}")
    A = {n["id"]: n for n in again.get("nodes", [])}
    ok(st == 200 and "g4" not in A and "group" not in A.get("n4", {}) and A.get("g1", {}).get("collapsed") is True,
       "groupes : un groupe qui n'a plus qu'un enfant se dissout ; les autres restent tels quels")
    # l'export montre l'intérieur d'un groupe réduit (l'image rouge / bleue, à sa place)
    st, j = call("POST", f"/api/ideation/boards/{b['id']}/export", {})
    for _ in range(150):
        st, j = call("GET", f"/api/jobs/{j['id']}")
        if j["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.2)
    ok(j.get("state") == "done", f"groupes : une planche à groupe réduit s'exporte ({j.get('message')})")
    if j.get("items"):
        out = j["items"][0]
        s = out["params"]["scale"]
        x0, y0 = min(n["x"] for n in again["nodes"]) - MARGIN, min(n["y"] for n in again["nodes"]) - MARGIN - 28
        with Image.open(library.path_of(library.get(out["id"]))) as ex:
            px = ex.convert("RGB").getpixel((round((24 + 30 - x0) * s), round((24 + 40 - y0) * s)))
        ok(px[0] > 180 and px[2] < 80, f"groupes : l'export montre le contenu du groupe réduit, déplié ({px})")


def _selftest_objets(call, ok, iid: str) -> None:
    """Les objets d'atelier (docs/etudes/ideation_atelier.md § 3) : formes, cartes, nœuds de
    mind map, traits de crayon bornés et validés ; les arbres (un parent d'une autre sorte
    tombe, une boucle se coupe, tout l'arbre dans le groupe de sa racine) ; les flèches en
    pointillé ; l'export les dessine à leur place."""
    from PIL import Image
    st, meta = call("GET", "/api/ideation/meta")
    ok(st == 200 and next((c for c in meta.get("sticky", []) if c["id"] == "verd-3"), {}).get("name") == "vert"
       and meta.get("objets", {}).get("shapes") == list(SHAPES) and meta["objets"].get("palette") == list(PALETTE),
       f"objets : les noms des couleurs des post-it et les listes des objets sont dits à la page ({meta.get('objets')})")
    b = blank("Essai des objets")
    _write(b)
    nodes = [
        {"id": "s1", "type": "shape", "x": 0, "y": 0, "w": 160, "h": 96, "kind": "diamond", "color": "grn2", "text": "Validée ?"},
        {"id": "s2", "type": "shape", "x": 200, "y": 0, "w": 160, "h": 96, "kind": "étoile", "color": "#ff0000", "text": "x" * 3000},
        {"id": "c1", "type": "card", "x": 0, "y": 200, "w": 300, "h": 190, "kind": "task", "color": "or", "text": "Essai caméra",
         "data": {"status": 9, "who": "léa brun", "due": "12 oct", "checks": [["Lumière", True], ["Texte", 0], "pas une étape"] + [["x", False]] * 30,
                  "url": "http://en-trop"}},
        {"id": "c2", "type": "card", "x": 320, "y": 200, "w": 300, "h": 150, "kind": "metric", "text": "Disponibilité",
         "data": {"value": "98.4", "unit": "%", "delta": "+1.2", "series": [8, 10, "douze", 12, True]}},
        {"id": "c3", "type": "card", "x": 640, "y": 200, "w": 300, "h": 150, "kind": "person", "text": "Léa Brun",
         "data": {"who": "", "role": "Responsable", "item": iid}},
        {"id": "c4", "type": "card", "x": 960, "y": 200, "w": 300, "h": 150, "kind": "bof", "color": "rose", "data": "rien"},
        {"id": "m0", "type": "mind", "x": 700, "y": 100, "w": 120, "h": 48, "text": "Lumière\n  forte", "group": "g1"},
        {"id": "m1", "type": "mind", "parent": "m0", "x": 900, "y": 60, "w": 80, "h": 36, "text": "Heure", "collapsed": 1},
        {"id": "m2", "type": "mind", "parent": "m1", "x": 1000, "y": 60, "w": 80, "h": 28, "text": "Aube", "group": "autre"},
        {"id": "m3", "type": "mind", "parent": "s1", "x": 700, "y": 600, "w": 90, "h": 48, "text": "sous une forme"},
        {"id": "m4", "type": "mind", "parent": "m5", "x": 900, "y": 600, "w": 90, "h": 48, "text": "boucle a"},
        {"id": "m5", "type": "mind", "parent": "m4", "x": 1000, "y": 600, "w": 90, "h": 48, "text": "boucle b"},
        {"id": "n1", "type": "note", "x": 400, "y": 0, "w": 160, "h": 60, "text": "dans le groupe", "group": "g1"},
        {"id": "i1", "type": "ink", "x": 0, "y": 500, "w": 200, "h": 100, "pts": [0, 0, 500, 1000, 1000.4, 0, 1200, -5], "color": "grn2", "width": 99},
        {"id": "g1", "type": "group", "name": "Lumière", "x": 0, "y": 0, "w": 16, "h": 16},
    ]
    links = [{"id": "a1", "a": "s1", "b": "c1", "kind": "arrow", "dash": True, "label": "non"},
             {"id": "a2", "a": "c1", "b": "c2", "kind": "out", "dash": True},
             {"id": "a3", "a": "s1", "b": "s2", "kind": "line", "dash": "oui"}]
    st, sv = call("POST", f"/api/ideation/boards/{b['id']}", {"name": b["name"], "v": VERSION, "nodes": nodes, "links": links, "base_rev": 1})
    ok(st == 200, f"objets : une planche de formes, cartes, mind map et traits s'enregistre ({st} {sv})")
    st, got = call("GET", f"/api/ideation/boards/{b['id']}")
    N = {n["id"]: n for n in got.get("nodes", [])}
    s1, s2 = N.get("s1", {}), N.get("s2", {})
    ok(s1.get("kind") == "diamond" and s1.get("color") == "grn2" and s2.get("kind") == "round" and s2.get("color") == "cy" and len(s2.get("text", "")) == 2000,
       f"objets : une forme garde son contour et sa couleur ; un contour, une couleur inconnus reviennent au défaut, le texte est borné ({s2.get('kind')} {s2.get('color')})")
    c1, c2, c3, c4 = N.get("c1", {}), N.get("c2", {}), N.get("c3", {}), N.get("c4", {})
    d1 = c1.get("data", {})
    ok(d1.get("status") == 3 and d1.get("who") == "LÉA" and d1.get("due") == "12 oct" and len(d1.get("checks", [])) == MAX_CHECKS
       and d1["checks"][:2] == [["Lumière", True], ["Texte", False]] and "url" not in d1,
       f"objets : une carte tâche est bornée (état 0-3, initiales, {MAX_CHECKS} étapes), les champs d'une autre sorte tombent ({str(d1)[:160]})")
    ok(c2.get("data", {}).get("series") == [8.0, 10.0, 12.0] and c2.get("color") == "grn2" and c3.get("data") == {"who": "", "role": "Responsable", "item": iid}
       and c4.get("kind") == "task" and c4.get("color") == "or" and c4.get("data") == {"status": 0, "who": "", "due": "", "checks": []},
       f"objets : mesure (une courbe de nombres), personne (son visage de la bibliothèque), sorte inconnue : une tâche vide ({c2.get('data')} {c4.get('data')})")
    m = {k: N.get(k, {}) for k in ("m0", "m1", "m2", "m3", "m4", "m5")}
    ok(m["m0"].get("text") == "Lumière forte" and m["m1"].get("group") == "g1" and m["m2"].get("group") == "g1" and m["m1"].get("collapsed") is True,
       f"objets : un nœud tient sur une ligne ; tout l'arbre est dans le groupe de sa racine ({m['m1'].get('group')} {m['m2'].get('group')})")
    ok("parent" not in m["m3"] and ("parent" in m["m4"]) != ("parent" in m["m5"]),
       f"objets : un parent qui n'est pas un nœud tombe ; une boucle se coupe ({m['m4'].get('parent')} {m['m5'].get('parent')})")
    info = _mind_info(got["nodes"])
    ok(info.get("m1", (0, "", False))[:2] == (1, MIND_BRANCH[0]) and info.get("m2", (0, "", False))[2] is True and info.get("m0", (9,))[0] == 0,
       f"objets : le rang, le rameau, le repli de chaque nœud ({info.get('m1')} {info.get('m2')})")
    i1 = N.get("i1", {})
    ok(i1.get("pts") == [0, 0, 500, 1000, 1000, 0, 1000, 0] and i1.get("color") == "grn2" and i1.get("width") == 12,
       f"objets : un trait garde ses points bornés à sa boîte, son épaisseur est bornée ({i1.get('pts')} {i1.get('width')})")
    L = {lk["id"]: lk for lk in got.get("links", [])}
    ok(L.get("a1", {}).get("dash") is True and "dash" not in L.get("a2", {}) and "dash" not in L.get("a3", {}),
       f"objets : une flèche garde son pointillé ; ni la lignée ni un pointillé illisible ({list(L.values())})")
    for bad, msg in (([0, 0, 1000], "un nombre impair de points"), ("0 0 1000 1000", "des points en texte"), ([0, 0], "un seul point"),
                     ([1, 2] * (INK_MAX // 2 + 1), f"plus de {INK_MAX // 2} points")):
        st, r = call("POST", f"/api/ideation/boards/{b['id']}", {**got, "nodes": got["nodes"] + [{**i1, "id": "i9", "pts": bad}], "base_rev": got["rev"]})
        ok(st == 400 and "trait" in str(r), f"objets : un trait à {msg} est refusé ({st})")
    # l'export : la forme (son fond à 8 % de sa couleur), la racine orange, le trait vert, à leur place
    st, j = call("POST", f"/api/ideation/boards/{b['id']}/export", {})
    for _ in range(150):
        st, j = call("GET", f"/api/jobs/{j['id']}")
        if j["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.2)
    ok(j.get("state") == "done", f"objets : une planche d'objets d'atelier s'exporte ({j.get('message')})")
    if j.get("items"):
        out = j["items"][0]
        s = out["params"]["scale"]
        x0, y0 = min(n["x"] for n in got["nodes"]) - MARGIN, min(n["y"] for n in got["nodes"]) - MARGIN - 28
        T = tokens()
        at = lambda x, y: (round((x - x0) * s), round((y - y0) * s))   # noqa: E731
        with Image.open(library.path_of(library.get(out["id"]))) as ex:
            ex = ex.convert("RGB")
            shape, root, ink = ex.getpixel(at(80, 20)), ex.getpixel(at(712, 142)), ex.getpixel(at(50, 550))
        near = lambda p, q, k=24: all(abs(p[i] - q[i]) <= k for i in range(3))   # noqa: E731
        ok(near(shape, _mix(T["grn2"], T["bg"], 0.08), 4) and shape != T["bg"] and near(root, T["or"]) and near(ink, T["grn2"], 40),
           f"objets : l'export dessine le fond de la forme, la racine de la mind map, le trait, à leur place ({shape} {root} {ink})")
        ok(iid in out.get("parents", []), "objets : le visage d'une carte personne entre dans la lignée de l'export")


def _selftest_wires(call, ok, iid: str) -> None:
    """Les fils côté serveur : la migration des planches d'avant, les cartes
    vidéo et composeur bornées, les fils bornés, le parent, l'export."""
    # une planche d'avant les fils (sans « v ») : écrite telle quelle, comme sur le disque de Cal
    old = {"id": new_id(), "name": "Planche d'avant", "created": library.now(), "updated": library.now(), "rev": 4,
           "nodes": [{"id": "m1", "type": "media", "item": iid, "kind": "image", "x": 0, "y": 0, "w": 120, "h": 80},
                     {"id": "n1", "type": "note", "x": 0, "y": 200, "w": 160, "h": 60, "text": "a note"},
                     {"id": "g1", "type": "gen", "x": 300, "y": 0, "w": 300, "h": 300, "prompt": "x", "model": "krea2"}],
           "links": [{"id": "l1", "a": "m1", "b": "g1", "kind": "arrow", "label": "réf. à garder"},
                     {"id": "l2", "a": "n1", "b": "g1", "kind": "arrow"},
                     {"id": "l3", "a": "n1", "b": "m1", "kind": "line"}]}
    _write(old)
    st, got = call("GET", f"/api/ideation/boards/{old['id']}")
    L = {lk["id"]: lk for lk in got.get("links", [])}
    ok(st == 200 and got.get("v") == VERSION and L.get("l1", {}).get("kind") == "wire" and L["l1"].get("pa") == "image"
       and L["l1"].get("pb") == "refs" and L["l1"].get("label") == "réf. à garder",
       f"idéation : migration — la flèche image → Générer devient le fil des références, son mot gardé ({L.get('l1')})")
    ok(L.get("l2", {}).get("kind") == "arrow" and L.get("l3", {}).get("kind") == "line" and len(L) == 3,
       f"idéation : migration — les autres liens restent des annotations ({list(L.values())})")
    st, sv = call("POST", f"/api/ideation/boards/{old['id']}", {**got, "base_rev": got["rev"]})
    st, again = call("GET", f"/api/ideation/boards/{old['id']}")
    ok(st == 200 and [lk["kind"] for lk in again["links"]] == ["wire", "arrow", "line"] and load(old["id"]).get("v") == VERSION,
       "idéation : migration — enregistrée une fois, elle ne se refait pas")
    # une flèche d'annotation tirée exprès (planche déjà en v2) reste une flèche
    st, sv = call("POST", f"/api/ideation/boards/{old['id']}", {**again, "links": again["links"] + [
        {"id": "l4", "a": "m1", "b": "g1", "kind": "arrow"}], "base_rev": again["rev"]})
    st, again = call("GET", f"/api/ideation/boards/{old['id']}")
    ok(any(lk["id"] == "l4" and lk["kind"] == "arrow" for lk in again.get("links", [])), "idéation : une flèche neuve vers une carte reste une flèche")

    b = blank("Essai des fils")
    _write(b)
    nodes = [
        {"id": "n1", "type": "note", "x": 0, "y": 0, "w": 200, "h": 60, "text": "a man runs through the rain"},
        {"id": "m1", "type": "media", "item": iid, "kind": "image", "x": 0, "y": 100, "w": 120, "h": 80, "parent": "c1"},
        {"id": "c1", "type": "compose", "x": 300, "y": 0, "w": 340, "h": 300,
         "slots": [{"id": "action", "name": "Action", "text": "", "lock": 1}, {"id": "action", "name": "doublon"},
                   {"id": "../x", "name": "mauvaise"}, {"id": "free1", "name": "", "text": "35mm film", "off": True}]},
        {"id": "c2", "type": "compose", "x": 300, "y": 400, "w": 340, "h": 300, "parent": "fantome"},
        {"id": "v1", "type": "vgen", "x": 700, "y": 0, "w": 320, "h": 300, "prompt": "p", "mode": "bof", "frames": 200,
         "canvas": "../../etc", "method": "?", "seed": "12a3"},
        {"id": "v2", "type": "vgen", "x": 700, "y": 400, "w": 320, "h": 300, "mode": "r2v", "canvas": "1344x768"},
        {"id": "f1", "type": "frame", "x": -600, "y": 0, "w": 400, "h": 300, "name": "Plan 1", "slide": 2},
        {"id": "f2", "type": "frame", "x": -600, "y": 400, "w": 400, "h": 300, "name": "Plan 2", "slide": "trois"},
    ]
    links = [{"id": "w1", "a": "n1", "b": "c1", "kind": "wire", "pa": "text", "pb": "s:action"},
             {"id": "w2", "a": "n1", "b": "c1", "kind": "wire", "pa": "text", "pb": "s:action"},
             {"id": "w3", "a": "c1", "b": "v1", "kind": "wire", "pa": "text", "pb": "prompt"},
             {"id": "w4", "a": "m1", "b": "v1", "kind": "wire", "pa": "image", "pb": "start"},
             {"id": "w5", "a": "m1", "b": "v2", "kind": "wire", "pa": "image", "pb": "image"}]
    st, sv = call("POST", f"/api/ideation/boards/{b['id']}", {"name": b["name"], "v": VERSION, "nodes": nodes, "links": links, "base_rev": 1})
    ok(st == 200, f"idéation : une planche avec des fils, un composeur, des cartes vidéo ({st} {sv})")
    st, got = call("GET", f"/api/ideation/boards/{b['id']}")
    N = {n["id"]: n for n in got.get("nodes", [])}
    c1, c2, v1 = N.get("c1", {}), N.get("c2", {}), N.get("v1", {})
    ok([s["id"] for s in c1.get("slots", [])] == ["action", "free1"] and c1["slots"][0]["lock"] is True
       and [s["role"] for s in c1["slots"]] == ["action", "libre"] and c1["slots"][1]["name"] == "case" and c1["slots"][1]["off"] is True,
       f"idéation : les cases du composeur sont bornées (doublon et identifiant hors motif retirés) ({c1.get('slots')})")
    ok([s["id"] for s in c2.get("slots", [])] == [i for i, _ in SLOTS], "idéation : un composeur sans cases reçoit les cinq de Cal")
    # 200 images : le pas le plus proche de la grille 17k+5 d'H3 (movie.FRAMES), 192
    ok(v1.get("mode") == "i2v" and v1.get("frames") == 192 and v1.get("canvas") == "auto" and v1.get("method") == "turbo"
       and v1.get("seed") == "123", f"idéation : la carte vidéo est bornée ({v1})")
    ok(N.get("m1", {}).get("parent") == "c1" and "parent" not in c2, "idéation : un parent présent reste, un parent absent tombe")
    ok(N.get("f1", {}).get("slide") == 2 and "slide" not in N.get("f2", {}), "idéation : un cadre garde son ordre de présentation (slide), un ordre illisible tombe")
    ok([lk["id"] for lk in got["links"]] == ["w1", "w3", "w4", "w5"] and all(lk.get("pa") and lk.get("pb") for lk in got["links"]),
       f"idéation : un fil en double n'est gardé qu'une fois, chaque fil garde ses deux ports ({[lk['id'] for lk in got['links']]})")
    st, r = call("POST", f"/api/ideation/boards/{b['id']}", {**got, "base_rev": got["rev"],
                 "links": got["links"] + [{"id": "w9", "a": "n1", "b": "v2", "kind": "wire", "pa": "text", "pb": "../../x"}]})
    ok(st == 400, f"idéation : un fil sans port valide est refusé ({st} {r})")
    # l'export dessine les fils (courbes) et les deux nouvelles cartes
    st2, j = call("POST", f"/api/ideation/boards/{b['id']}/export", {})
    for _ in range(150):
        st2, j = call("GET", f"/api/jobs/{j['id']}")
        if j["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.2)
    ok(j.get("state") == "done", f"idéation : exporter une planche à fils, composeur et vidéo ({j.get('message')})")
    byid = {n["id"]: n for n in got["nodes"]}
    ok(_text_of(got, byid, byid["c1"]) == "a man runs through the rain." and _wired_text(got, byid, "v1", "prompt") == "a man runs through the rain.",
       "idéation : l'export lit la prose qu'un fil apporte (la case coupée n'y est pas)")


# les essais de la fonction pure (ideation/ports.js), menés par node : le
# scénario est ici, ports.js répond, le contrôle compare
_PORTS_JS = r"""
import { readFileSync } from 'fs';
const P = await import(process.env.PORTS_URL);
const { image, movie, iid, eid } = JSON.parse(readFileSync(0, 'utf8'));
const caps = { image, movie };
const items = new Map([[iid, { id: iid, kind: 'image' }],
  [eid, { id: eid, kind: 'element', element: { refs: [{ file: 'ref-01.png', role: 'face' }, { file: 'ref-02.png', role: 'full body' }] } }]]);
const R = {};
const B = { nodes: [
  { id: 'n1', type: 'note', text: 'a man runs' }, { id: 'n2', type: 'sticky', text: 'a woman' },
  { id: 'm1', type: 'media', kind: 'image', item: iid }, { id: 'm2', type: 'media', kind: 'image', item: iid },
  { id: 'm3', type: 'media', kind: 'image', item: iid }, { id: 'e1', type: 'media', kind: 'element', item: eid },
  { id: 'g1', type: 'gen', model: 'krea2', prompt: 'local' }, { id: 'v1', type: 'vgen', mode: 'i2v', prompt: '' },
  { id: 'c1', type: 'compose', slots: P.newSlots() }, { id: 'c2', type: 'compose', slots: P.newSlots() },
], links: [] };
const W = (id, a, pa, b, pb) => B.links.push({ id, a, b, kind: 'wire', pa, pb, label: '' });
const gen = () => B.nodes.find((n) => n.id === 'g1');
const vid = () => B.nodes.find((n) => n.id === 'v1');
R.text_prompt = P.canWire(B, 'n1', 'text', 'g1', 'prompt', caps, items);
R.image_prompt = P.canWire(B, 'm1', 'image', 'g1', 'prompt', caps, items);
R.text_refs = P.canWire(B, 'n1', 'text', 'g1', 'refs', caps, items);
gen().model = 'zimage';
R.zimage_refs = P.canWire(B, 'm1', 'image', 'g1', 'refs', caps, items);
gen().model = 'krea2';
W('r1', 'm1', 'image', 'g1', 'refs'); W('r2', 'm2', 'image', 'g1', 'refs');
R.krea_third = P.canWire(B, 'm3', 'image', 'g1', 'refs', caps, items);
W('r3', 'm3', 'image', 'g1', 'refs'); W('p1', 'n1', 'text', 'g1', 'prompt');
const st = () => ['r1', 'r2', 'r3'].map((id) => P.flow(B, caps, items).state(id));
R.krea_states = st().map((s) => s.ok);
R.krea_why3 = st()[2].why;
// la règle commune des références : la 3e est gardée (grisée, sa place 3), pas en alerte
R.krea_held = [st()[2].held === true, st()[2].idx, P.flow(B, caps, items).bad('g1').length];
gen().model = 'zimage';
R.zimage_states = st().map((s) => s.ok);
R.zimage_why = st()[0].why;
gen().model = 'qwen21';
R.qwen_states = st().map((s) => s.ok);
R.prompt = P.flow(B, caps, items).prompt('g1')?.text;
R.refs_items = P.flow(B, caps, items).take('g1', 'refs').map((e) => e.item === iid);
// la vidéo : image → vidéo, puis le mode change
R.element_start = P.canWire(B, 'e1', 'element', 'v1', 'start', caps, items);
R.image_start = P.canWire(B, 'm1', 'image', 'v1', 'start', caps, items);
W('s1', 'm1', 'image', 'v1', 'start');
vid().mode = 'r2v';
R.r2v_start = P.flow(B, caps, items).state('s1');
R.r2v_element = P.canWire(B, 'e1', 'element', 'v1', 'element', caps, items);
vid().mode = 'i2v';
R.back_i2v = P.flow(B, caps, items).state('s1').ok;
// une carte qui fabrique : son fil attend son premier résultat, puis le prend
B.links = B.links.filter((l) => l.id !== 's1');
W('s2', 'g1', 'image', 'v1', 'start');
R.pending = P.flow(B, caps, items).state('s2');
B.nodes.push({ id: 'm9', type: 'media', kind: 'image', item: 'ima-resultat' });
items.set('ima-resultat', { id: 'ima-resultat', kind: 'image' });
B.links.push({ id: 'o1', a: 'g1', b: 'm9', kind: 'out', label: '' });
R.after = P.flow(B, caps, items).take('v1', 'start').map((e) => [e.item, !!e.pending]);
// le composeur (Style, Personnages, Action, Décor, Photographie) : une case branchée, une écrite, une coupée
const c1 = B.nodes.find((n) => n.id === 'c1');
W('k1', 'n1', 'text', 'c1', 's:action');
c1.slots[1].text = 'a woman in a red coat';
c1.slots[3].text = 'a train station'; c1.slots[3].off = true;
R.composed = P.flow(B, caps, items).text('c1');
c1.slots.push(P.newSlot('son', c1.slots));
c1.slots[5].text = 'rain on the roof';
R.with_son = [P.flow(B, caps, items).text('c1'), P.flow(B, caps, items).extras('c1')];
c1.slots[1].lock = true;
R.locked = P.canWire(B, 'n2', 'text', 'c1', 's:persos', caps, items);
R.replace = (P.replaces(B, 'c1', 's:action', caps) || {}).id;
W('k2', 'c1', 'text', 'c2', 's:action');
R.cycle = P.canWire(B, 'c2', 'text', 'c1', 's:decor', caps, items);
W('k3', 'c1', 'text', 'v1', 'prompt');
R.video_prompt = P.flow(B, caps, items).prompt('v1')?.text;
R.video_sound = P.flow(B, caps, items).prompt('v1')?.son;
c1.slots[2].text = 'ignored while wired';   // la case Action est branchée : son texte écrit ne compte pas
B.nodes.find((n) => n.id === 'n1').text = 'a man walks';
R.live = P.flow(B, caps, items).prompt('v1')?.text;
R.makers_text = P.makersFor('text', caps, { gen: { model: 'zimage' } }).map((m) => m.template.type + ':' + m.port.id);
R.makers_image = P.makersFor('image', caps, { gen: { model: 'zimage' } }).map((m) => m.template.type + ':' + m.port.id + ':' + (m.preset.model || m.preset.mode || ''));
R.makers_video = P.makersFor('video', caps, {}).map((m) => m.template.type + ':' + m.port.id);
R.kinds = Object.fromEntries(Object.entries(P.KINDS).map(([k, v]) => [k, v.color]));
R.slots = P.SLOTS.map((s) => [s.id, s.name]);
R.roles = P.ROLES.map((r) => r.id);
R.sentence = [P.sentence('  a  quiet\nstreet '), P.sentence('Is it?'), P.sentence('')];
R.self = P.canWire(B, 'n1', 'text', 'n1', 'prompt', caps, items);
console.log(JSON.stringify(R));
"""


def _selftest_ports(call, ok) -> None:
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        ok(True, "idéation : node absent, la fonction des ports n'est pas essayée ici")
        return
    st, image = call("GET", "/api/image/models")
    st2, movie = call("GET", "/api/movie/options")
    # un élément (visage + plein pied) et une image : les vrais objets ne sont pas lus par la fonction pure
    payload = {"image": image, "movie": movie, "iid": "ima-20260101-000000-aaaa", "eid": "ele-20260101-000000-bbbb"}
    env = {**__import__("os").environ, "PORTS_URL": (REPO / "ideation" / "ports.js").as_uri()}
    r = subprocess.run([node, "--input-type=module", "-e", _PORTS_JS], input=json.dumps(payload), capture_output=True,
                       text=True, timeout=60, env=env)
    try:
        R = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        ok(False, f"idéation : ports.js ne répond pas ({r.returncode} {r.stderr[-400:]})")
        return
    zwhy = next((m.get("refs_why") for m in image.get("models", []) if m["id"] == "zimage"), "")
    ok(R["text_prompt"] == "" and "prompt" in R["image_prompt"] and "références" in R["text_refs"],
       f"ports : un texte va au prompt, une image n'y va pas, un texte ne va pas aux références ({R['image_prompt']} | {R['text_refs']})")
    ok(R["zimage_refs"] == zwhy and zwhy, f"ports : impossible de relier une référence à Z-Image, avec la raison de l'outil Image ({R['zimage_refs']})")
    ok(R["krea_third"].startswith("Krea 2 prend 2") and R["krea_states"] == [True, True, False] and "3e" in R["krea_why3"],
       f"ports : Krea 2 prend deux références, la troisième est refusée, et marquée si elle est là ({R['krea_third']} · {R['krea_why3']})")
    ok(R["krea_held"] == [True, 2, 0],
       f"ports : la règle commune — au-delà de ce que prend Krea 2, la 3e référence est gardée à sa place, grisée, pas en alerte ({R['krea_held']})")
    ok(R["zimage_states"] == [False, False, False] and R["zimage_why"] == zwhy,
       f"ports : passer à Z-Image met les trois fils en alerte à l'instant, avec la raison ({R['zimage_states']})")
    ok(R["qwen_states"] == [True, True, True] and R["refs_items"] == [True, True, True] and R["prompt"] == "a man runs",
       f"ports : Qwen 2.1 les reprend toutes, le prompt vient de la note ({R['qwen_states']} {R['prompt']!r})")
    ok("Références" in R["element_start"] and R["image_start"] == "",
       f"ports : un élément ne va pas en première image (il va en mode Références), une image si ({R['element_start']})")
    ok(R["r2v_start"]["ok"] is False and "première image" in R["r2v_start"]["why"] and R["r2v_element"] == "" and R["back_i2v"] is True,
       f"ports : changer de mode rend le fil de la première image faux, avec la raison ; revenir le rend bon ({R['r2v_start']})")
    ok(R["pending"]["ok"] is True and "pas encore de résultat" in (R["pending"].get("pending") or "")
       and R["after"] == [["ima-resultat", False]],
       f"ports : le fil d'une carte qui fabrique attend son résultat, puis porte la dernière image ({R['pending']} {R['after']})")
    ok(R["composed"] == "a woman in a red coat. a man runs.",
       f"ports : le composeur fait un paragraphe dans l'ordre des cases (Personnages puis Action), un point par case, la coupée en moins ({R['composed']!r})")
    ok(R["with_son"] == ["a woman in a red coat. a man runs.", {"son": "rain on the roof.", "musique": "", "looks": {}}],
       f"ports : la case Son sort de la prose et part à part ; une case Photographie sans pastille n'en donne aucune ({R['with_son']})")
    ok(R["sentence"] == ["a quiet street.", "Is it?", ""], f"ports : une phrase, un point s'il manque, rien d'inventé ({R['sentence']})")
    ok("verrouillée" in R["locked"] and R["replace"] == "k1", f"ports : une case verrouillée refuse un fil ; un fil neuf remplace l'ancien ({R['locked']})")
    ok("boucle" in R["cycle"], f"ports : une boucle de composeurs est refusée ({R['cycle']})")
    ok(R["video_prompt"] == "a woman in a red coat. a man runs." and R["video_sound"] == "rain on the roof."
       and R["live"] == "a woman in a red coat. a man walks.",
       f"ports : le prompt d'une vidéo vient d'un composeur (son Son à part), et suit la note en direct ({R['live']!r})")
    ok(R["makers_text"] == ["gen:prompt", "vgen:prompt", "vgen:prompt", "vgen:prompt", "compose:s:libre"],
       f"ports : depuis un texte, dans le vide : Générer image, vidéo (trois modes), composeur en case Libre ({R['makers_text']})")
    ok(R["makers_image"] == ["gen:refs:krea2", "vgen:start:i2v", "vgen:image:r2v"],
       f"ports : depuis une image : une carte image (Krea 2, Z-Image n'en prend pas), vidéo en première image ou en référence ({R['makers_image']})")
    ok(R["makers_video"] == ["vgen:video"], f"ports : depuis une vidéo : la vidéo en références seulement ({R['makers_video']})")
    ok(R["kinds"] == KIND_COLORS and R["slots"] == [list(s) for s in SLOTS] and R["roles"] == list(ROLES),
       "ports : la page et l'export ont les mêmes teintes de fil, les mêmes rôles et les mêmes cases de composeur")
    ok(bool(R["self"]), "ports : un objet ne se branche pas sur lui-même")


# le lot côté page (ideation/ports.js : varier une case, le lot d'une carte, la prose valeur par
# valeur, une case à la fois, les pastilles d'une case Photographie), mené par node ; la planche
# est rendue pour que l'export (`_text_of`) lise la même prose
_LOT_JS = r"""
const P = await import(process.env.PORTS_URL);
const R = {};
const c1 = { id: 'c1', type: 'compose', slots: P.newSlots() };
c1.slots[0].text = 'A candid photograph';
c1.slots[1].text = 'A woman in a red coat';
Object.assign(c1.slots[3], { vary: true, values: [{ t: 'A rainy street in Tokyo', on: true }, { t: 'A snowy square', on: false }, { t: ' A desert  road ', on: true }] });
c1.slots[4].looks = { lens: '35', film: '' };
const c2 = { id: 'c2', type: 'compose', slots: P.newSlots(['libre', 'action']) };
const B = { nodes: [c1, c2, { id: 'g1', type: 'gen', model: 'krea2', prompt: '' }, { id: 'n1', type: 'note', text: 'She runs\n\nShe walks\nShe waits' }], links: [] };
const W = (id, a, b, pb) => B.links.push({ id, a, b, kind: 'wire', pa: 'text', pb, label: '' });
W('w1', 'c1', 'g1', 'prompt');
let F = P.flow(B, {}, null);
const L = F.lot('g1') || F.prompt('g1').lot;
R.lot = [L.name, L.on, L.values.length];
R.text = F.text('c1');
R.at = [F.textAt('c1', 0), F.textAt('c1', 1)];
R.prompt1 = F.prompt('g1', 1).text;
R.looks = F.prompt('g1').looks;
R.why_action = P.varyWhy(B, c1, c1.slots[2]);
R.why_son = P.varyWhy(B, c1, P.newSlot('son', c1.slots));
R.why_decor = P.varyWhy(B, c1, c1.slots[3]);
// une case branchée qui varie : les lignes du texte reçu, une décochée par son texte
W('w2', 'n1', 'c2', 's:action');
Object.assign(c2.slots[1], { vary: true, skip: ['She walks'] });
F = P.flow(B, {}, null);
R.wired = [F.lot('c2').on, F.lot('c2').values.length, F.text('c2')];
R.board = JSON.parse(JSON.stringify(B));
// deux cases qui varient sur la même chaîne : refusé à l'ajout, dit sur la carte
c1.slots.push(P.newSlot('libre', c1.slots));
W('w3', 'c2', 'c1', 's:' + c1.slots[5].id);
F = P.flow(B, {}, null);
const K = F.prompt('g1').lot;
R.conflict = K && K.conflict ? K.conflict.map((x) => x.name) : null;
R.family = P.varyWhy(B, c2, c2.slots[1]);
R.why_other = P.varyWhy(B, c2, c2.slots[0]);
console.log(JSON.stringify(R));
"""


def _selftest_lot(call, ok, iid: str) -> None:
    """Les lots : le plafond (celui d'api_generate), un lot d'images 3 × 2 (un
    batch, les mêmes graines d'une colonne à l'autre, {case, valeur} rangés),
    le refus au-delà, un lot vidéo, les cases qui varient bornées et relues,
    la prose de la page et celle de l'export identiques."""
    st, meta = call("GET", "/api/ideation/meta")
    ok(st == 200 and meta.get("lot", {}).get("max") == LOT_MAX, f"lots : le plafond est dit à la page ({meta.get('lot')})")
    st8, _ = call("POST", "/api/image/generate", {"model": "zimage", "prompt": "x", "count": LOT_MAX, "dry": True})
    st9, r9 = call("POST", "/api/image/generate", {"model": "zimage", "prompt": "x", "count": LOT_MAX + 1, "dry": True})
    ok(st8 == 200 and st9 == 400, f"lots : le plafond d'un lot est celui d'/api/image/generate ({st8} {st9} {r9})")

    vals = [{"value": f"place {k}", "prompt": f"A woman runs. Place {k}."} for k in range(3)]
    card = {"model": "zimage", "aspect": "1:1", "count": 2, "seed": 41, "looks": {"lens": "35"}}
    st, r = call("POST", "/api/ideation/lot", {"kind": "image", "name": "Décor", "values": vals, "image": card})
    js = r.get("jobs", []) if st == 200 and isinstance(r, dict) else []
    ok(st == 200 and len(js) == 6 and len({j["params"]["batch"] for j in js}) == 1 and r.get("seed") == 41
       and [(j["col"], j["row"], j["params"]["seed"]) for j in js] == [(c, k, 41 + k) for c in range(3) for k in range(2)],
       f"lots : 3 valeurs × 2 images = un batch de 6, la graine k la même d'une colonne à l'autre ({st} {str(r)[:300]})")
    ok(js and all(j["params"]["prompt"] == vals[j["col"]]["prompt"] and j["params"]["lot"] == {"name": "Décor", "value": f"place {j['col']}", "index": j["col"]}
                  and j["params"]["looks"] == {"lens": "35"} for j in js),
       "lots : chaque image garde son prompt résolu, {case, valeur} et la prise de vue")
    for j in js:
        call("POST", f"/api/jobs/{j['id']}/cancel")
    st, r = call("POST", "/api/ideation/lot", {"kind": "image", "name": "Décor", "values": vals, "image": {**card, "count": 3}})
    ok(st == 400 and f"{LOT_MAX} au plus" in str(r), f"lots : 3 × 3 = 9 images refusé, en disant le plafond ({st} {r})")
    st, r = call("POST", "/api/ideation/lot", {"kind": "image", "name": "Décor", "values": [], "image": card})
    st2, r2 = call("POST", "/api/ideation/lot", {"kind": "image", "name": "Décor", "values": [vals[0], {"value": "vide", "prompt": " "}], "image": card})
    ok(st == 400 and st2 == 400 and "valeur 2" in str(r2), f"lots : sans valeur, ou une valeur au prompt vide : refusé en le disant ({r} | {r2})")
    st, r = call("POST", "/api/ideation/lot", {"kind": "video", "mode": "t2v", "name": "Action", "values": [
        {"value": "runs", "params": {"desc": "A man runs.", "canvas": [864, 480], "frames": 124, "method": "turbo"}},
        {"value": "walks", "params": {"desc": "A man walks.", "canvas": [864, 480], "frames": 124, "method": "turbo"}}]})
    js = r.get("jobs", []) if st == 200 and isinstance(r, dict) else []
    ok(st == 200 and len(js) == 2 and js[0]["params"]["seed"] == js[1]["params"]["seed"] == r.get("seed") and [j["col"] for j in js] == [0, 1]
       and js[1]["params"]["desc"] == "A man walks." and js[0]["kind"] == "movie.t2v",
       f"lots : deux vidéos, la même graine, une par valeur ({st} {str(r)[:300]})")
    for j in js:
        call("POST", f"/api/jobs/{j['id']}/cancel")
    st, r = call("POST", "/api/ideation/lot", {"kind": "video", "mode": "t2v", "name": "Action", "values": [{"value": "x", "params": {"desc": ""}}]})
    ok(st == 400 and "valeur 1" in str(r), f"lots : une vidéo sans description est refusée, avec sa valeur ({st} {r})")

    # la planche : une case qui varie, ses valeurs, les pastilles, un travail de lot, la lignée marquée
    b = blank("Essai des lots")
    _write(b)
    nodes = [
        {"id": "c1", "type": "compose", "x": 0, "y": 0, "w": 340, "h": 300, "slots": [
            {"id": "style", "role": "style", "name": "Style", "text": "A photograph"},
            {"id": "decor", "role": "decor", "name": "Décor", "vary": True,
             "values": [{"t": "  a  rainy street ", "on": True}, {"t": "a snowy square", "on": False}, {"t": "x"}, "pas une valeur"]},
            {"id": "photo", "role": "photo", "name": "Photographie", "looks": {"lens": "35", "film": "n-existe-plus", "zz": "1"}},
            {"id": "son", "role": "son", "name": "Son", "vary": True, "looks": {"lens": "35"}}]},
        {"id": "f1", "type": "frame", "x": 400, "y": 0, "w": 500, "h": 400, "name": "Décor × 2"},
        {"id": "m1", "type": "media", "item": iid, "kind": "image", "x": 420, "y": 60, "w": 220, "h": 147},
        {"id": "g1", "type": "gen", "x": 0, "y": 400, "w": 320, "h": 300, "prompt": "", "model": "zimage",
         "jobs": [{"id": "job-0929-120000-abcd", "act": "lot", "frame": "f1", "col": 1, "row": 0, "dx": 254, "w": 220},
                  {"id": "job-0929-120001-abcd", "act": "gen", "frame": "../x"}]},
    ]
    links = [{"id": "o1", "a": "g1", "b": "f1", "kind": "out"}, {"id": "o2", "a": "g1", "b": "m1", "kind": "out", "lot": "f1"},
             {"id": "o3", "a": "c1", "b": "m1", "kind": "out", "lot": "g1"}]
    st, sv = call("POST", f"/api/ideation/boards/{b['id']}", {"name": b["name"], "v": VERSION, "nodes": nodes, "links": links, "base_rev": 1})
    st, got = call("GET", f"/api/ideation/boards/{b['id']}")
    N = {n["id"]: n for n in got.get("nodes", [])}
    S = {s["id"]: s for s in N.get("c1", {}).get("slots", [])}
    ok(st == 200 and S.get("decor", {}).get("vary") is True
       and S["decor"].get("values") == [{"t": "a rainy street", "on": True}, {"t": "a snowy square", "on": False}, {"t": "x", "on": True}]
       and S.get("photo", {}).get("looks") == {"lens": "35"} and "vary" not in S.get("son", {}) and "looks" not in S.get("son", {}),
       f"lots : une case qui varie garde ses valeurs bornées, une pastille disparue tombe, Son ne varie pas ({list(S.values())})")
    J = N.get("g1", {}).get("jobs", [])
    ok(J == [{"id": "job-0929-120000-abcd", "act": "lot", "frame": "f1", "col": 1, "row": 0, "dx": 254.0, "w": 220.0},
             {"id": "job-0929-120001-abcd", "act": "gen"}],
       f"lots : un travail de lot garde son cadre, sa colonne, son rang ; un cadre illisible tombe ({J})")
    Lk = {lk["id"]: lk for lk in got.get("links", [])}
    ok(Lk.get("o2", {}).get("lot") == "f1" and "lot" not in Lk.get("o1", {}) and "lot" not in Lk.get("o3", {}),
       f"lots : la lignée d'un rendu garde son cadre ; un « cadre » qui n'en est pas un tombe ({list(Lk.values())})")
    byid = {n["id"]: n for n in got["nodes"]}
    ok(_text_of(got, byid, byid["c1"]) == "A photograph. a rainy street.", f"lots : l'export lit la première valeur cochée ({_text_of(got, byid, byid['c1'])!r})")

    # la page (ports.js), par node : le lot, la prose valeur par valeur, une case à la fois
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        ok(True, "lots : node absent, ports.js n'est pas essayé ici")
        return
    env = {**__import__("os").environ, "PORTS_URL": (REPO / "ideation" / "ports.js").as_uri()}
    r = subprocess.run([node, "--input-type=module", "-e", _LOT_JS], capture_output=True, text=True, timeout=60, env=env)
    try:
        R = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        ok(False, f"lots : ports.js ne répond pas ({r.returncode} {r.stderr[-400:]})")
        return
    ok(R["lot"] == ["Décor", ["A rainy street in Tokyo", "A desert road"], 3],
       f"ports : la case Décor varie, deux valeurs cochées sur trois ({R['lot']})")
    ok(R["text"] == "A candid photograph. A woman in a red coat. A rainy street in Tokyo."
       and R["at"][1] == "A candid photograph. A woman in a red coat. A desert road." and R["prompt1"] == R["at"][1],
       f"ports : la prose valeur par valeur, seule la case change ({R['at']})")
    ok(R["looks"] == {"lens": "35"}, f"ports : la carte reçoit les pastilles de la case Photographie ({R['looks']})")
    ok("Décor" in R["why_action"] and "Son" in R["why_son"] and R["why_decor"] == "",
       f"ports : une case à la fois, Son ne varie pas ({R['why_action']} | {R['why_son']})")
    ok(R["wired"] == [["She runs", "She waits"], 3, "She runs."],
       f"ports : une case branchée varie par les lignes du texte reçu, une décochée par son texte ({R['wired']})")
    ok(R["conflict"] == ["Décor", "Action"] and "un autre composeur" in R["family"] and "varie déjà" in R["why_other"],
       f"ports : deux cases qui varient sur la même chaîne : dit, et refusé à l'ajout ({R['conflict']} | {R['family']})")
    pb = normalize({**R["board"], "id": b["id"]})
    pid = {n["id"]: n for n in pb["nodes"]}
    ok(_text_of(pb, pid, pid["c1"]) == R["text"] and _text_of(pb, pid, pid["c2"]) == R["wired"][2],
       f"lots : l'export et la page font la même prose d'une case qui varie ({_text_of(pb, pid, pid['c1'])!r})")
