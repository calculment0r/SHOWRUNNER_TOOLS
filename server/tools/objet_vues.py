"""Object Creator · les vues : proposer, valider, affiner (Cal, 09/10/2026).

« Quand je donne l'image d'une voiture en perspective, il ne me propose pas
automatiquement de faire les vues dont il a besoin … On valide les vues
principales, et si on valide on refait plus de vues avec nos vues validées,
pour avoir un modèle et des textures super bien faits … On doit avoir aussi
les images pour faire une sheet pour H3, et les images du modèle. » L'étude
qui fonde chaque choix, avec ses sources : docs/etudes/objet_scenes_3d.md.

Le plan des vues vit DANS l'élément (`element.vues` de son item.json : le
Workspace de l'objet, aucun magasin de plus) :

  source   d'où l'image choisie voit l'objet (`az`, `el`), dit par la
           personne, proposé par le modèle qui voit, ou « face » par défaut
  passes   les passes planifiées (1, puis 2)
  slots    une place par vue : {id, az, el, pass, state, job, items, ref,
           pick, from, seed, why} ; `state` : prevue | file | proposee |
           gardee | rejetee | echec | source
  face     l'azimut du modèle 3D qui regarde comme l'image (0, 90, 180,
           270) : le calage des rendus, non documenté pour TRELLIS.2
`element.classe` : ce qu'est l'image (objet, bâtiment, décor, intérieur,
personnage), proposé par le modèle qui voit (`objet.classer`) ou dit.

Ce qui fait foi : les références de l'élément. Une vue est « gardée » parce
qu'elle est une référence `view` de l'élément ; une référence retirée
ailleurs (Asset, Ctrl+Z) rend sa place « proposée » au prochain coup d'œil
(`normalize`) ; l'état d'un travail se lit dans la file, jamais recopié.

Les angles : l'azimut se compte depuis la face, vers la GAUCHE de l'objet
(90° : son côté gauche), comme `_VIEW_AZIMUTHS` de Pixal3DMultiViewConditioning
(ComfyUI 0.37.2, comfy_extras/nodes_trellis2.py : front 0, left 90, back 180,
right 270) et les nœuds multi-vues de visualbruno ; la hauteur : 0 (œil),
30, 60, 90 (dessus) — les hauteurs des deux LoRA d'angles (fal : −30 à 60 ;
akhaliq : 0 à 90).

Les passes :
  1 principales  face, gauche, dos, droite à hauteur d'œil : les quatre vues
                 qu'attendent les reconstructions multi-vues (Pixal3D MV,
                 Hunyuan3D-2mv, visualbruno) et les « vues orthogonales » de
                 Character Factory ;
  2 affinage     les quatre 3/4 et le dessus, faits À PARTIR DES VUES GARDÉES :
                 chaque vue part de la vue gardée la plus proche en angle (la
                 plus grande surface vue en commun — notre règle, aucune
                 documentation de modèle ne la donne), sinon de l'image choisie.

Les générateurs (interrupteur `objet_vues`, Admin → Câblage) :
  factice          le défaut : une mire étiquetée (l'angle, la vue de départ,
                   la graine), voie cpu ;
  qwen-edit-2511   Qwen-Image-Edit 2511 + LoRA Multiple-Angles de fal : le
                   graphe de l'outil Image (« Angle », image.py), installé sur
                   les deux DGX ; pas de vue de dessus dans son vocabulaire ;
  qwen21-anyangle  Qwen-Image 2.1 + LoRA AnyAngle : l'angle vient d'un RENDU du
                   modèle 3D (RenderMesh), le style de la vue de départ ;
                   « Change the camera angle from <image2> to <image1>. »,
                   20 pas, CFG 3, euler / simple (gabarit d'AnyAngle Studio T8) ;
                   le LoRA est à télécharger (120 Mo), un modèle 3D réel d'abord.

Les rendus (`objet.rendus`, interrupteur `objet_rendus`) : le GLB vu des
angles de la planche, fond blanc, par les nœuds natifs de ComfyUI 0.37.2
(Load 3D (Advanced) → Get 3D Components → Render Mesh, caméra Create Camera
Info) ; factices : la boîte du mesh projetée (PIL). La planche (`objet.planche`,
PIL, voie cpu) : la forme de la planche des personnages pour H3 (movie.py :
« corps 3 vues », fond blanc de studio) — face, profil, dos, un 3/4 s'il est
gardé, côte à côte, sans texte.

  GET  /api/objet/{eid}/vues                     le plan, ses images, le générateur
  POST /api/objet/{eid}/vues/source {az, el, file?}   d'où l'image choisie voit l'objet (et laquelle)
  POST /api/objet/{eid}/vues/plan {pass: 2} | {az, el}   plus de vues
  POST /api/objet/{eid}/vues/generer {slots?, seed?}     un travail par vue
  POST /api/objet/{eid}/vues/{sid} {action, item?}       garder, poser (une image de la bibliothèque),
                                                         rejeter, rouvrir, retirer
  POST /api/objet/{eid}/classe {value}           ce qu'est l'image, dit par la personne
  POST /api/objet/{eid}/classer                  le modèle qui voit le propose (et l'angle)
  POST /api/objet/{eid}/face {face}              la face du modèle 3D (calage des rendus)
  POST /api/objet/{eid}/rendus                   les rendus du dernier modèle 3D
  POST /api/objet/{eid}/planche                  la planche des vues gardées
"""

from __future__ import annotations

import copy
import json
import math
import secrets
import struct
import time
from pathlib import Path

from core import auth, config, jobs, library
from core.http import HttpError

config.declare_switch("objet_vues", ["factice", "qwen-edit-2511", "qwen21-anyangle"], label="Object Creator · vues",
                      default="factice", doc="server/tools/objet_vues.py, generator() : le générateur des vues d'un objet")
config.declare_switch("objet_rendus", [False, True], label="Object Creator · rendus (RenderMesh)", default=False,
                      doc="server/tools/objet_vues.py, renders_wired() : les rendus du GLB par ComfyUI")

AZ_NAMES = {0: "face", 45: "3/4 avant gauche", 90: "gauche", 135: "3/4 arrière gauche", 180: "dos",
            225: "3/4 arrière droit", 270: "droite", 315: "3/4 avant droit"}
EL_NAMES = {0: "hauteur d'œil", 30: "surélevé", 60: "plongée", 90: "dessus"}
PASSES = {
    1: {"name": "principales", "angles": [(0, 0), (90, 0), (180, 0), (270, 0)],
        "why": "les quatre vues d'une reconstruction multi-vues (Pixal3D MV, Hunyuan3D-2mv) et de la planche"},
    2: {"name": "affinage", "angles": [(45, 0), (135, 0), (225, 0), (315, 0), (0, 90)],
        "why": "les 3/4 et le dessus, chacun depuis la vue gardée la plus proche"},
    3: {"name": "ajoutées", "angles": [], "why": "à la main"},
}
CLASSES = {"objet": "un objet", "batiment": "un bâtiment vu de dehors", "decor": "un décor extérieur",
           "interieur": "une pièce intérieure", "personnage": "un personnage"}
# ce que chaque classe ouvre : la voie objet (des vues autour, un modèle), ou une autre
CLASS_ROUTE = {"objet": "objet", "batiment": "objet", "decor": "scene", "interieur": "scene", "personnage": "character"}
CLASS_WHY = {"scene": "une scène ne se tourne pas comme un objet : sa voie (images cohérentes d'un espace, panorama, "
                      "gaussian splatting) est à l'étude — docs/etudes/objet_scenes_3d.md § 5",
             "character": "un personnage passe par Character Factory (visage, costumes, planche, vues, 3D)"}
STATES = ("prevue", "file", "proposee", "gardee", "rejetee", "echec", "source")
FOLDER = "Objets"           # les vues proposées, les planches : un dossier de la bibliothèque, comme « Idéation »
SIDE = 1024                 # le côté d'une vue factice, d'un rendu, d'une case de planche
FACTICE_S = 1.2             # le temps d'une vue factice : la page doit la voir en file, en cours, puis finie
RENDER_FOV = 30.0           # le champ vertical des rendus (degrés) ; la sphère du mesh y tient avec 4 % d'air
RENDER_TOP_EL = 89.0        # « dessus » : à 90° le repère regarder-vers de RenderMesh dégénère (l'axe Y en haut)
RENDER_ANGLES = [(az, 0) for az in sorted(AZ_NAMES)] + [(0, 90)]
STUDIO_WHITE = (255, 255, 255)   # le fond des rendus et de la planche : le « white studio background » des planches H3 (movie.py)

# Qwen-Image-Edit 2511 + Multiple-Angles (fal, Apache-2.0) : « <sks> <azimut> <hauteur> <distance> » ;
# le vocabulaire de sa fiche, celui de l'outil Image (image.py, ANGLE_*) — les côtés y sont ceux du sujet
FAL_AZ = {0: "front view", 45: "front-left quarter view", 90: "left side view", 135: "back-left quarter view",
          180: "back view", 225: "back-right quarter view", 270: "right side view", 315: "front-right quarter view"}
FAL_EL = {0: "eye-level shot", 30: "elevated shot", 60: "high-angle shot"}
FAL_DISTANCE = "medium shot"   # l'objet entier dans le cadre
ANYANGLE_LORA = "QI2.1_AnyAngle.safetensors"
ANYANGLE_PROMPT = "Change the camera angle from <image2> to <image1>."   # le gabarit d'AnyAngle Studio T8, tel quel
GENS = {
    "factice": {"name": "factice", "sub": "une mire étiquetée, aucun modèle chargé", "els": (0, 30, 60, 90),
                "kind": "objet.vue_factice"},
    "qwen-edit-2511": {"name": "Qwen-Image-Edit 2511 · angles", "sub": "LoRA Multiple-Angles de fal, installé (l'outil Image)",
                       "els": (0, 30, 60), "kind": "objet.vue", "family": "qwenedit"},
    "qwen21-anyangle": {"name": "Qwen-Image 2.1 · AnyAngle", "sub": "l'angle vient d'un rendu du modèle 3D",
                        "els": (0, 30, 60, 90), "kind": "objet.vue", "family": "qwen21", "needs_mesh": True},
}


def generator() -> str:
    g = config.get("objet_vues") or "factice"
    return g if g in GENS else "factice"


def renders_wired() -> bool:
    return config.get("objet_rendus") is True


def angle_label(az: int, el: int) -> str:
    """« gauche · 90° », « 3/4 avant gauche · 45° · surélevé 30° », « dessus · 90° » : à hauteur
    d'œil, les libellés des vues posées à la main avant le 09/10 (objet.py, VIEW_LABELS)."""
    if el == 90:
        return "dessus · 90°"
    s = f"{AZ_NAMES[az]} · {az}°"
    return s if el == 0 else f"{s} · {EL_NAMES[el].split()[0]} {el}°"


def _angle(az, el) -> tuple[int, int]:
    try:
        a, e = int(az), int(el)
    except (TypeError, ValueError):
        raise HttpError(400, "un angle : azimut (0, 45 … 315) et hauteur (0, 30, 60, 90)")
    if e == 90:
        a = 0   # le dessus n'a pas d'azimut
    if a not in AZ_NAMES or e not in EL_NAMES:
        raise HttpError(400, f"angle inconnu : {az}°, {el}° (azimuts {sorted(AZ_NAMES)}, hauteurs {sorted(EL_NAMES)})")
    return a, e


def separation(a: tuple[int, int], b: tuple[int, int]) -> float:
    """L'écart entre deux directions de vue (degrés, sur la sphère) : le plus petit écart,
    la vue de départ la plus proche — la plus grande surface vue en commun."""
    def v(az, el):
        ra, re_ = math.radians(az), math.radians(el)
        return (math.cos(re_) * math.sin(ra), math.sin(re_), math.cos(re_) * math.cos(ra))
    x, y = v(*a), v(*b)
    return math.degrees(math.acos(max(-1.0, min(1.0, sum(p * q for p, q in zip(x, y))))))


# ── le plan, dans l'élément ─────────────────────────────────
def _is_object(it: dict | None) -> bool:
    return bool(it) and it["kind"] == "element" and (it.get("element") or {}).get("type") == "object"


def _ref_angle(r: dict) -> tuple[int, int] | None:
    """L'angle d'une référence : posé par cet outil (`az`, `el`), sinon lu dans un libellé
    d'avant le 09/10 (« gauche · 90° »)."""
    if isinstance(r.get("az"), int) and isinstance(r.get("el"), int):
        return r["az"], r["el"]
    for az, name in AZ_NAMES.items():
        if (r.get("label") or "").strip() == f"{name} · {az}°":
            return az, 0
    return None


def _blank(it: dict) -> dict:
    """Le plan d'un objet qui n'en a pas : l'image choisie vue de face (par défaut, jusqu'à ce
    qu'on dise d'où elle le voit), la passe 1 prévue ; les vues posées à la main avant le 09/10
    reprennent leur place, gardées."""
    refs = [r for r in it["element"].get("refs") or [] if r.get("role") == "view"] or it["element"].get("refs") or []
    v = {"v": 1, "source": {"az": 0, "el": 0, "by": "defaut", "file": refs[0]["file"] if refs else None},
         "passes": [1], "slots": [], "n": 0, "face": 0}
    for r in refs[1:]:
        a = _ref_angle(r)
        if a and a != (0, 0):
            v["n"] += 1
            v["slots"].append({"id": f"v{v['n']:02d}", "az": a[0], "el": a[1], "pass": 1 if a in PASSES[1]["angles"] else 3,
                               "state": "gardee", "job": None, "items": [r["item"]] if r.get("item") else [],
                               "ref": r["file"], "pick": r.get("item"), "from": None, "seed": None, "why": ""})
    return v


def _new_slot(v: dict, az: int, el: int, p: int) -> dict:
    v["n"] += 1
    s = {"id": f"v{v['n']:02d}", "az": az, "el": el, "pass": p, "state": "prevue", "job": None, "items": [],
         "ref": None, "pick": None, "from": None, "seed": None, "why": ""}
    v["slots"].append(s)
    return s


def normalize(it: dict, v: dict) -> dict:
    """Le plan remis d'accord avec l'élément et la file — idempotent, juste par construction :
    la place de l'image choisie, une place par angle des passes planifiées, une vue « gardée »
    seulement si sa référence est dans l'élément, l'état d'un travail lu dans la file."""
    refs = {r["file"]: r for r in it["element"].get("refs") or []}
    src = v.setdefault("source", {"az": 0, "el": 0, "by": "defaut", "file": None})
    if src.get("file") not in refs:
        views = [r for r in refs.values() if r.get("role") == "view"] or list(refs.values())
        src["file"] = views[0]["file"] if views else None
    v.setdefault("passes", [1])
    v.setdefault("slots", [])
    v.setdefault("n", len(v["slots"]))
    v.setdefault("face", 0)
    sa = (src["az"], src["el"])
    # la place de l'image choisie (passe 0) : une seule, à son angle
    v["slots"] = [s for s in v["slots"] if s["pass"] != 0]
    v["slots"].insert(0, {"id": "v00", "az": sa[0], "el": sa[1], "pass": 0, "state": "source", "job": None,
                          "items": [], "ref": src["file"], "pick": None, "from": None, "seed": None, "why": ""})
    # une place prévue à l'angle de l'image choisie n'a plus lieu d'être : l'image la tient
    v["slots"] = [s for s in v["slots"] if not (s["pass"] and (s["az"], s["el"]) == sa and s["state"] == "prevue" and not s["items"])]
    have = {(s["az"], s["el"]) for s in v["slots"]}
    for p in sorted(set(v["passes"])):
        for a in PASSES.get(p, {}).get("angles", []):
            if a not in have:
                _new_slot(v, a[0], a[1], p)
                have.add(a)
    for s in v["slots"]:
        if s["pass"] == 0:
            continue
        # l'état se DÉDUIT : la file d'abord (un travail en cours), puis la référence (gardée),
        # puis ce qu'on a dit (rejetée), puis le travail fini (échec), puis les propositions
        if s.get("ref") not in refs:
            s.update(ref=None, pick=None)
        j = jobs.get(s["job"]) if s.get("job") else None
        if s.get("job") and j is None:
            s["job"] = None
            if s["state"] == "file":
                s["why"] = "le travail a quitté la file"
        if j and j["state"] in ("queued", "running"):
            s["state"] = "file"
        elif s["ref"]:
            s["state"] = "gardee"
        elif s["state"] == "rejetee":
            pass
        elif j and j["state"] in ("error", "cancelled", "interrupted"):
            s.update(state="echec", why=(j.get("message") or j["state"])[:300])
        elif s["items"]:
            s["state"] = "proposee"
        elif s["state"] != "echec":
            s["state"] = "prevue"
    v["slots"].sort(key=lambda s: (s["pass"], s["el"], s["az"]))
    return v


def plan_of(it: dict) -> dict:
    """Le plan d'un objet, à lire (une copie, remise d'accord ; rien n'est écrit)."""
    v = copy.deepcopy(it["element"].get("vues")) if isinstance(it["element"].get("vues"), dict) else _blank(it)
    return normalize(it, v)


def edit_plan(eid: str, fn) -> dict:
    """Change le plan d'un objet sous le verrou de la bibliothèque : `fn(it, plan)`, puis le plan
    remis d'accord et l'élément écrit. Au nom de la personne de la requête, ou du travail."""
    with library._lock:
        it = library.get(eid)
        if not _is_object(it):
            raise KeyError(eid)
        library.check_write(it)
        v = it["element"].get("vues") if isinstance(it["element"].get("vues"), dict) else _blank(it)
        normalize(it, v)
        out = fn(it, v)
        normalize(it, v)
        it["element"]["vues"] = v
        it["updated"] = library.now()
        library._save(it)
        return out


def _slot(v: dict, sid: str) -> dict:
    s = next((x for x in v["slots"] if x["id"] == sid), None)
    if not s:
        raise HttpError(404, f"vue inconnue : {sid}")
    return s


def _drop_ref(it: dict, name: str | None) -> None:
    """Retire une référence de la planche de l'élément ; son fichier reste dans son dossier
    (comme POST /api/asset/refs : une référence retirée peut revenir)."""
    if name:
        it["element"]["refs"] = [r for r in it["element"]["refs"] if r["file"] != name]
        if it.get("thumb", "").startswith(Path(name).stem + "."):
            first = next((r for r in it["element"]["refs"] if r.get("thumb")), None)
            it["thumb"] = first["thumb"] if first else it.get("thumb")


def _keep(it: dict, s: dict, image: dict) -> str:
    """La vue proposée devient une référence `view` de l'élément (copiée, comme toute
    référence), avec son angle ; une vue déjà gardée à cette place est remplacée."""
    eid = it["id"]
    _drop_ref(it, s.get("ref"))
    library.add_ref(eid, library.path_of(image), role="view", label=angle_label(s["az"], s["el"]), from_item=image["id"])
    it2 = library.get(eid)
    ref = it2["element"]["refs"][-1]
    ref.update(az=s["az"], el=s["el"])
    return ref["file"]


def class_of(it: dict) -> dict:
    c = it["element"].get("classe")
    return c if isinstance(c, dict) else {"value": None, "by": None}


def nearest_from(it: dict, v: dict, target: tuple[int, int]) -> dict:
    """La vue de départ d'une vue à faire : la vue gardée la plus proche en angle (l'image
    choisie comprise) ; à égalité, l'image choisie."""
    refs = {r["file"]: r for r in it["element"].get("refs") or []}
    cands = [s for s in v["slots"] if (s["state"] == "gardee" or s["pass"] == 0) and s.get("ref") in refs]
    best = min(cands, key=lambda s: (separation((s["az"], s["el"]), target), s["pass"] != 0), default=None)
    if not best:
        raise HttpError(409, "cet objet n'a pas d'image : choisis-en une")
    return {"file": best["ref"], "az": best["az"], "el": best["el"], "slot": best["id"],
            "label": ("l'image choisie · " if best["pass"] == 0 else "") + angle_label(best["az"], best["el"])}


def latest_mesh(it: dict, real: bool = False) -> dict | None:
    ms = [m for m in it["element"].get("meshes") or [] if m.get("file") and (not real or not m.get("factice"))]
    return ms[-1] if ms else None


def plan_public(it: dict) -> dict:
    """Ce que la page lit : le plan, l'image de chaque place (les proposées, la gardée), la
    classe, le générateur, ce qui peut partir et sinon pourquoi."""
    v = plan_of(it)
    ids = sorted({i for s in v["slots"] for i in s["items"]})
    items = {}
    for iid in ids:
        x = library.get(iid)
        if x:
            p = library.public(x)
            items[iid] = {k: p.get(k) for k in ("id", "title", "url", "thumb_url", "views", "view_urls", "width", "height",
                                                  "params", "origin", "created")}
    pub = library.public(it)
    refs = {r["file"]: r for r in pub["element"]["refs"]}
    for s in v["slots"]:
        s["label"] = angle_label(s["az"], s["el"])
        if s.get("ref") in refs:
            s["ref_url"], s["ref_thumb"] = refs[s["ref"]]["url"], refs[s["ref"]]["thumb_url"]
        if s.get("job"):
            j = jobs.get(s["job"])
            if j:
                s["job_state"], s["progress"], s["message"] = j["state"], j.get("progress"), (j.get("message") or "")[:200]
    g = generator()
    return {"element": it["id"], "vues": v, "items": items, "classe": class_of(it), "gen": {"id": g, **GENS[g]},
            "pass_open": pass_open(v), "go": go_state(it, v)}


def pass_open(v: dict) -> dict:
    """La passe 2 (« plus de vues à partir des validées ») s'ouvre quand chaque vue principale
    est décidée (gardée ou rejetée) et qu'une au moins est gardée — sinon, pourquoi."""
    if 2 in v["passes"]:
        return {"ok": False, "why": "l'affinage est déjà prévu"}
    main = [s for s in v["slots"] if s["pass"] == 1]
    open_ = [s for s in main if s["state"] not in ("gardee", "rejetee")]
    if open_:
        return {"ok": False, "why": f"valide d'abord les vues principales : {len(open_)} restent ("
                                    + ", ".join(angle_label(s["az"], s["el"]) for s in open_[:4]) + ")"}
    if not any(s["state"] == "gardee" for s in main):
        return {"ok": False, "why": "garde au moins une vue principale : l'affinage part des vues gardées"}
    return {"ok": True, "why": ""}


def go_state(it: dict, v: dict) -> dict:
    """Générer peut-il partir, et sinon pourquoi : la classe de l'image, le générateur."""
    c = class_of(it)
    route = CLASS_ROUTE.get(c.get("value") or "objet", "objet")
    if route != "objet":
        return {"ok": False, "why": CLASS_WHY[route], "route": route}
    gen = GENS[generator()]
    if gen.get("needs_mesh") and not latest_mesh(it, real=True):
        return {"ok": False, "why": f"{gen['name']} part d'un rendu du modèle 3D : tire d'abord la 3D (TRELLIS.2, image unique)",
                "route": "objet"}
    return {"ok": True, "why": "", "route": "objet"}


# ── les routes ──────────────────────────────────────────────
def _object(eid: str) -> dict:
    from tools import core_api
    it = core_api.elsewhere_or_404(eid)
    if not _is_object(it):
        raise HttpError(404, f"pas un objet : {eid}")
    return it


def _garde(kind: str) -> None:
    """La garde du calcul (celle de jobs.submit) AVANT tout jugement du plan : une personne qui ne
    calcule pas ici l'apprend par elle, et rien de l'objet ne lui en est dit (le motif d'Image,
    `api_edit`)."""
    me = auth.current()
    jobs._guard(kind, {}, me, me, jobs._space_for(me))


def _edit(eid: str, fn):
    try:
        return edit_plan(eid, fn)
    except KeyError:
        raise HttpError(404, f"objet introuvable : {eid}")


def r_get(req, eid):
    return plan_public(_object(eid))


def r_source(req, eid):
    """D'où l'image choisie voit l'objet : sa place dans la grille (la place prévue à cet angle
    s'efface), son libellé et son angle sur sa référence."""
    _object(eid)
    d = req.json()
    az, el = _angle(d.get("az"), d.get("el"))

    def fn(it, v):
        if d.get("file"):   # une autre image choisie (« Changer d'image ») : une référence de l'objet
            if not any(r["file"] == d["file"] for r in it["element"]["refs"]):
                raise HttpError(400, f"référence inconnue dans cet objet : {d['file']}")
            v["source"]["file"] = d["file"]
        v["source"].update(az=az, el=el, by="personne")
        for r in it["element"]["refs"]:
            if r["file"] == v["source"].get("file"):
                r.update(az=az, el=el, label=angle_label(az, el))
    _edit(eid, fn)
    return plan_public(library.get(eid))


def r_plan(req, eid):
    """Plus de vues : la passe 2 (les 3/4 et le dessus, depuis les vues gardées), ou une vue à
    un angle choisi (passe 3)."""
    _object(eid)
    d = req.json()

    def fn(it, v):
        if d.get("pass") == 2:
            po = pass_open(v)
            if not po["ok"]:
                raise HttpError(409, po["why"])
            v["passes"] = sorted(set(v["passes"]) | {2})
            return
        az, el = _angle(d.get("az"), d.get("el"))
        if any((s["az"], s["el"]) == (az, el) for s in v["slots"]):
            raise HttpError(409, f"la vue {angle_label(az, el)} est déjà dans le plan")
        _new_slot(v, az, el, 3)
    _edit(eid, fn)
    return plan_public(library.get(eid))


def r_generer(req, eid):
    """Un travail par vue : celles qu'on nomme, sinon toutes les prévues et celles en échec.
    La garde du calcul juge chaque mise en file (jobs.submit) AVANT que le plan ne change."""
    _garde(GENS[generator()]["kind"])
    it = _object(eid)
    library.check_write(it)
    d = req.json()
    v = plan_of(it)
    go = go_state(it, v)
    if not go["ok"]:
        raise HttpError(409, go["why"])
    g = generator()
    gen = GENS[g]
    want = d.get("slots")
    if want is not None and (not isinstance(want, list) or not all(isinstance(x, str) for x in want)):
        raise HttpError(400, "slots : une liste d'identifiants de vues")
    todo = [s for s in v["slots"] if s["pass"] and (s["id"] in want if want else s["state"] in ("prevue", "echec"))]
    if want:
        busy = [s for s in todo if s["state"] == "file"]
        if busy:
            raise HttpError(409, f"la vue {angle_label(busy[0]['az'], busy[0]['el'])} est déjà en file")
    if not todo:
        raise HttpError(409, "aucune vue à faire : toutes sont proposées, gardées ou rejetées")
    skipped = [s for s in todo if s["el"] not in gen["els"]]
    if skipped and want:
        raise HttpError(409, f"{gen['name']} ne fait pas la vue {angle_label(skipped[0]['az'], skipped[0]['el'])} "
                             f"(ses hauteurs : {', '.join(f'{e}°' for e in gen['els'])})")
    todo = [s for s in todo if s["el"] in gen["els"]]
    if not todo:
        raise HttpError(409, f"{gen['name']} ne fait aucune de ces vues (ses hauteurs : {', '.join(f'{e}°' for e in gen['els'])})")
    pin = None
    if gen["kind"] == "objet.vue" and g == "qwen-edit-2511":
        from tools import image
        pin = image._pin_for("angle")   # la machine qui a le modèle et ses deux LoRA (409 sinon)
    mesh = latest_mesh(it, real=True) if gen.get("needs_mesh") else None
    seed0 = d.get("seed")
    made, refused = [], ""
    for k, s in enumerate(todo):
        frm = nearest_from(it, v, (s["az"], s["el"]))
        seed = int(seed0) + k if isinstance(seed0, int) and not isinstance(seed0, bool) else secrets.randbelow(2**31)
        params = {"element": eid, "slot": s["id"], "az": s["az"], "el": s["el"], "gen": g, "seed": seed, "from": frm,
                  "face": v.get("face", 0), **({"mesh": mesh["file"]} if mesh else {})}
        try:
            j = jobs.submit(gen["kind"], params, title=f"{it['title']} · vue {angle_label(s['az'], s['el'])}",
                            tool="object", pin=pin, thumb=library.public(it).get("thumb_url"))
        except HttpError as e:
            if not made:
                raise
            refused = e.message
            break
        made.append((s["id"], j, frm, seed))

    def fn(it2, v2):
        for sid, j, frm, seed in made:
            s2 = _slot(v2, sid)
            s2.update(state="file", job=j["id"], **{"from": frm}, seed=seed, why="")
    try:
        _edit(eid, fn)
    except Exception:
        for _, j, _, _ in made:
            try:
                jobs.cancel(j["id"])
            except (KeyError, PermissionError):
                pass
        raise
    out = plan_public(library.get(eid))
    out["jobs"] = [j["id"] for _, j, _, _ in made]
    out["refused"] = refused
    out["skipped"] = [angle_label(s["az"], s["el"]) for s in skipped]
    return out


def r_slot(req, eid, sid):
    """Garder (la proposition montrée, sinon la dernière), rejeter, rouvrir (le contraire des
    deux : Ctrl+Z), retirer une vue ajoutée à la main."""
    _object(eid)
    d = req.json()
    action = d.get("action")
    if action not in ("garder", "poser", "rejeter", "rouvrir", "retirer"):
        raise HttpError(400, "action : garder, poser, rejeter, rouvrir ou retirer")

    def fn(it, v):
        s = _slot(v, sid)
        if s["pass"] == 0:
            raise HttpError(409, "c'est l'image choisie : elle se change dans « son image »")
        if s["state"] == "file" and action != "retirer":
            raise HttpError(409, "cette vue est en train de se faire : attends-la, ou arrête son travail")
        if action == "poser":   # une image de la bibliothèque (un dépôt, le panneau Asset) devient cette vue
            image = library.get(str(d.get("item") or ""))
            if not image or image["kind"] != "image":
                raise HttpError(400, "il faut une image de la bibliothèque")
            if image["id"] not in s["items"]:
                s["items"].append(image["id"])
            s.update(state="gardee", ref=_keep(it, s, image), pick=image["id"], why="")
        elif action == "garder":
            item = d.get("item") or (s["items"][-1] if s["items"] else None)
            if not item or item not in s["items"]:
                raise HttpError(409, "rien à garder : aucune proposition pour cette vue" if not s["items"]
                                else "cette image n'est pas une proposition de cette vue")
            image = library.get(item)
            if not image or image["kind"] != "image":
                raise HttpError(409, "cette proposition a quitté la bibliothèque (la corbeille ?)")
            s.update(state="gardee", ref=_keep(it, s, image), pick=item, why="")
        elif action == "rejeter":
            _drop_ref(it, s.get("ref"))
            s.update(state="rejetee", ref=None, pick=None)
        elif action == "rouvrir":
            _drop_ref(it, s.get("ref"))
            s.update(state="proposee" if s["items"] else "prevue", ref=None, pick=None)
        else:
            if s["pass"] != 3 or s["state"] in ("file", "gardee"):
                raise HttpError(409, "seule une vue ajoutée à la main, ni en cours ni gardée, se retire ; les autres se rejettent")
            v["slots"].remove(s)
    _edit(eid, fn)
    return plan_public(library.get(eid))


def r_classe(req, eid):
    _object(eid)
    value = req.json().get("value")
    if value not in CLASSES and value is not None:
        raise HttpError(400, f"classe : {', '.join(CLASSES)}")

    def fn(it, v):
        it["element"]["classe"] = {**class_of(it), "value": value, "by": "personne", "at": library.now()}
    _edit(eid, fn)
    return plan_public(library.get(eid))


def r_face(req, eid):
    _object(eid)
    face = req.json().get("face")
    if face not in (0, 90, 180, 270):
        raise HttpError(400, "face : 0, 90, 180 ou 270")
    _edit(eid, lambda it, v: v.update(face=face))
    return plan_public(library.get(eid))


def r_classer(req, eid):
    """Le modèle qui voit dit ce qu'est l'image et d'où elle voit l'objet : un travail (la
    garde du calcul, la mémoire), sur la machine du modèle (ideation_agent.route_vision)."""
    from tools import ideation_agent as A
    _garde("objet.classer")
    it = _object(eid)
    library.check_write(it)
    r = A.route_vision()
    same = r["model"] == A.model_name()
    j = jobs.submit("objet.classer", {"element": eid, "url": r["url"], "model": r["model"],
                                      "family": "ollama-agent" if same else "ollama-vision",
                                      "mem_gb": A.MEM_GB if same else int(config.get("ideation_agent_vision_gb") or A.MEM_GB)},
                    title=f"{it['title']} · ce que c'est", tool="object", pin=r["pin"], thumb=library.public(it).get("thumb_url"))

    def fn(it2, v):
        it2["element"]["classe"] = {**class_of(it2), "job": j["id"], "why": ""}
    _edit(eid, fn)
    return {**plan_public(library.get(eid)), "job": j["id"]}


def r_rendus(req, eid):
    _garde("objet.rendus" if renders_wired() else "objet.rendus_factice")
    it = _object(eid)
    library.check_write(it)
    m = latest_mesh(it)
    if not m:
        raise HttpError(409, "pas encore de modèle 3D : tire d'abord la 3D")
    v = plan_of(it)
    kind = "objet.rendus" if renders_wired() else "objet.rendus_factice"
    j = jobs.submit(kind, {"element": eid, "mesh": m["file"], "face": v.get("face", 0)},
                    title=f"{it['title']} · rendus{'' if renders_wired() else ' factices'}", tool="object",
                    thumb=library.public(it).get("thumb_url"))
    return {"job": j["id"], "kind": kind}


def sheet_views(it: dict) -> list[dict]:
    """Les vues de la planche, dans l'ordre d'une planche de personnage (face, profil, dos) :
    la face (0°), un profil (gauche, sinon droite), le dos, et un 3/4 avant s'il y en a un —
    les vues gardées et l'image choisie si elle est l'une d'elles."""
    by = {}
    for r in it["element"].get("refs") or []:
        a = _ref_angle(r)
        if r.get("role") == "view" and a and a[1] == 0:
            by.setdefault(a[0], r)
    order = [0, 90 if 90 in by else 270, 180, 45 if 45 in by else 315]
    return [{**by[a], "az": a} for a in order if a in by]


def sheet_why(it: dict) -> str:
    got = {r["az"] for r in sheet_views(it)}
    if 0 not in got:
        return "la planche part de la face (0°) : garde-la, ou dis que l'image choisie la montre"
    if not got & {90, 270, 180}:
        return "il faut la face et au moins un profil ou le dos, gardés"
    return ""


def r_planche(req, eid):
    _garde("objet.planche")
    it = _object(eid)
    library.check_write(it)
    why = sheet_why(it)
    if why:
        raise HttpError(409, why)
    j = jobs.submit("objet.planche", {"element": eid}, title=f"{it['title']} · planche", tool="object",
                    thumb=library.public(it).get("thumb_url"))
    return {"job": j["id"]}


def meta() -> dict:
    """Ce que la page affiche de la chaîne des vues (avec /api/objet/state)."""
    from tools import ideation_agent as A
    g = generator()
    r = A.route_vision()
    st = A.engine_state(url=r["url"], model=r["model"])   # lu, jamais appelé à calculer ; gardé 30 s
    seeing = bool(st.get("present")) and "vision" in (st.get("caps") or [])
    vision = {"ready": seeing, "model": r["model"], "machine": r["machine"],
              "why": "" if seeing else (st.get("why") or f"le modèle {r['model']} ne voit pas les images")}
    return {"gen": {"id": g, **GENS[g]}, "gens": GENS, "rendus": {"wired": renders_wired()}, "vision": vision,
            "angles": {"az": AZ_NAMES, "el": EL_NAMES}, "passes": PASSES, "classes": CLASSES, "routes": CLASS_ROUTE,
            "class_why": CLASS_WHY, "render_angles": RENDER_ANGLES}


# ── les travaux ─────────────────────────────────────────────
def _job_object(ctx) -> tuple[str, dict]:
    eid = str(ctx.params.get("element") or "")
    it = library.get(eid)
    if not _is_object(it):
        raise RuntimeError(f"objet introuvable : {eid}")
    library.check_write(it)   # revalidé au départ : le travail ne compte pas sur la route qui l'a mis en file
    ctx.job["thumb"] = library.public(it).get("thumb_url")
    return eid, it


def _from_path(it: dict, frm: dict) -> Path:
    ref = next((r for r in it["element"]["refs"] if r["file"] == frm.get("file")), None)
    if not ref:
        raise RuntimeError("la vue de départ n'est plus dans l'objet : relance la vue")
    return library.path_of(it, ref["file"])


def _finish_view(ctx, eid: str, out: Path, *, prompt: str, model: str, backend: str, secs: float, extra: dict | None = None) -> dict:
    p = ctx.params
    it = library.get(eid)
    label = angle_label(p["az"], p["el"])
    new = ctx.add(out, kind="image", title=f"{it['title']} · {label}", prompt=prompt, folder=FOLDER,
                  params={"job": ctx.job["kind"], "element": eid, "slot": p["slot"], "az": p["az"], "el": p["el"],
                          "gen": p["gen"], "seed": p["seed"], "from": p["from"]},
                  parents=[eid] + ([p["from"]["item"]] if p["from"].get("item") else []),
                  origin={"model": model, "backend": backend}, extra={"render_s": secs, **(extra or {})})

    def fn(it2, v):
        s = next((x for x in v["slots"] if x["id"] == p["slot"]), None)
        if s is None:   # la vue a été retirée pendant le calcul : l'image reste dans la bibliothèque
            return
        s["items"].append(new["id"])
        if s.get("job") == ctx.job["id"]:   # son état se déduit ensuite (normalize) : proposée, ou gardée si elle l'était
            s.update(job=None, state="proposee", why="")
    edit_plan(eid, fn)
    return {"item": new["id"], "note": f"{label} · {secs:.0f} s", "slot": p["slot"]}


def compass(draw, cx: int, cy: int, r: int, az: int, el: int, T: dict) -> None:
    """La boussole d'une vue (vue de dessus) : l'objet au centre, sa face en bas, la caméra
    sur le cercle — 90° (son côté gauche) à droite, comme quand il nous fait face."""
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=T["ink3"], width=max(2, r // 30))
    s = r // 4
    draw.rectangle([cx - s, cy - s, cx + s, cy + s], outline=T["ink2"], width=max(2, r // 40))
    draw.line([cx - s, cy + s, cx + s, cy + s], fill=T["or"], width=max(3, r // 20))   # la face
    rr = r * (math.cos(math.radians(el)) if el < 90 else 0.0)
    x, y = cx + rr * math.sin(math.radians(az)), cy + rr * math.cos(math.radians(az))
    k = max(6, r // 9)
    draw.ellipse([x - k, y - k, x + k, y + k], fill=T["cy"])


def run_vue_factice(ctx) -> dict:
    """Une vue factice : une mire qui dit l'angle demandé, la vue de départ (en vignette),
    le générateur réglé et ce qu'il recevrait — aucune image d'objet inventée."""
    from PIL import ImageDraw
    from tools import image
    p = ctx.params
    eid, it = _job_object(ctx)
    src = _from_path(it, p["from"])
    label = angle_label(p["az"], p["el"])
    t0 = time.time()
    image._stub_wait(ctx, f"vue {label}", FACTICE_S)
    g = GENS.get(p.get("gen"), GENS["factice"])
    prompt = view_prompt(p)
    card = image.stub_card((SIDE, SIDE), f"vue · {label}",
                           [("depuis", p["from"]["label"]), ("générateur", f"{g['name']} — aucun modèle chargé"),
                            ("graine", p["seed"])], prompt, [src], p["seed"])
    T = image.tokens()
    compass(ImageDraw.Draw(card), int(SIDE * 0.80), int(SIDE * 0.62), int(SIDE * 0.12), p["az"], p["el"], T)
    out = ctx.workdir / "vue.png"
    card.save(out)
    return _finish_view(ctx, eid, out, prompt=prompt, model="factice · vue", backend="factice", secs=round(time.time() - t0, 1))


def view_prompt(p: dict) -> str:
    """Le prompt que le générateur reçoit (montré aussi par la mire factice)."""
    if p.get("gen") == "qwen21-anyangle":
        return ANYANGLE_PROMPT
    if p.get("gen") == "qwen-edit-2511":
        return f"<sks> {FAL_AZ[p['az']]} {FAL_EL.get(p['el'], '?')} {FAL_DISTANCE}"
    return f"vue {angle_label(p['az'], p['el'])} depuis {p['from']['label']}"


def run_vue(ctx) -> dict:
    """Une vue par le générateur câblé, sur la ComfyUI de l'ouvrier."""
    from PIL import Image
    from tools import image
    p = ctx.params
    eid, it = _job_object(ctx)
    if ctx.comfy is None:
        raise RuntimeError(f"la voie « image » n'a pas de ComfyUI ici ({ctx.endpoint}) : la vue ne peut pas partir")
    src = _from_path(it, p["from"])
    t0 = time.time()
    with Image.open(src) as im:
        size = im.size
    if p["gen"] == "qwen-edit-2511":
        if p["el"] not in FAL_EL:
            raise RuntimeError(f"le LoRA d'angles de fal n'a pas la hauteur {p['el']}°")
        q = {"tool": "angle", "azimuth": FAL_AZ[p["az"]], "elevation": FAL_EL[p["el"]], "distance": FAL_DISTANCE,
             "seed": p["seed"]}
        prompt = image.angle_prompt(q)
        out = image._real_edit(ctx, q, src, size, [], prompt)   # le graphe de l'outil Image, tel quel (une seule vérité)
        return _finish_view(ctx, eid, out, prompt=prompt, model="qwen-edit-2511-angles", backend="comfyui",
                            secs=round(time.time() - t0, 1))
    if p["gen"] == "qwen21-anyangle":
        m = next((x for x in it["element"].get("meshes") or [] if x.get("file") == p.get("mesh")), None)
        if not m:
            raise RuntimeError("le modèle 3D de cette vue a quitté l'objet : retire la 3D d'abord")
        local = ctx.workdir / "src.png"
        image._rgb(src, local)
        src_name = ctx.comfy.upload(local)
        glb_name = ctx.comfy.upload(library.path_of(it, m["file"]), f"sr_objet_{ctx.job['id']}.glb", subfolder="3d")
        cam = camera(glb_bounds(library.path_of(it, m["file"])), p["az"] + p.get("face", 0), p["el"])
        g = graph_anyangle(src_name, glb_name, cam, p["seed"])
        from tools import objet
        problems = objet.validate(ctx.comfy, g)
        if problems:
            raise RuntimeError("AnyAngle ne peut pas partir : " + " · ".join(problems[:6]))
        files = _run_named(ctx, g, "AnyAngle")
        out = image._opaque(files["vue"], ctx.workdir / "vue.png")
        guide = files.get("guide")
        extra = {}
        if guide:
            name = f"guide-{p['slot']}-{ctx.job['id'][-4:]}.png"
            guide.replace(library.folder_of(eid) / name)
            extra["guide"] = name
        return _finish_view(ctx, eid, out, prompt=ANYANGLE_PROMPT, model="qwen21-anyangle", backend="comfyui",
                            secs=round(time.time() - t0, 1), extra=extra)
    raise RuntimeError(f"générateur inconnu : {p['gen']}")


def _run_named(ctx, g: dict, label: str) -> dict[str, Path]:
    """Un graphe dont les sorties sont nommées par leur titre (« OUT vue », « OUT az090el00 ») :
    {nom: fichier rapatrié}. La progression : celle du websocket (image.live_run)."""
    from core.comfy import Comfy, ComfyError
    from tools import image
    live = image._Live(ctx, g, label, 0.1, 0.95)
    live.thread.start()
    live.ready.wait(6)
    try:
        pid = ctx.comfy.queue(g)
        entry = ctx.comfy.wait(pid, cancelled=ctx.cancelled, timeout=3600)
    except ComfyError as e:
        raise RuntimeError(image._readable(e, ctx, label)) from e
    finally:
        live.stop.set()
        live.thread.join(3)
    out = {}
    for f in Comfy.outputs(entry, g):
        name = ((g.get(f["node"]) or {}).get("_meta") or {}).get("title", "")[4:].strip() or f["node"]
        out[name] = ctx.comfy.download(f, ctx.workdir / f"{name}{Path(f['filename']).suffix or '.png'}")
    if not out:
        raise RuntimeError(f"{label} n'a rien rendu (voir le journal de ComfyUI)")
    return out


# ── le GLB : ses bornes, la caméra d'un angle ───────────────
def _mat_mul(a: list, b: list) -> list:
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def _node_matrix(n: dict) -> list:
    """La matrice locale d'un nœud glTF (§ 5.25 : `matrix` en colonnes, sinon T·R·S)."""
    if "matrix" in n:
        m = n["matrix"]
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    x, y, z, w = n.get("rotation", (0.0, 0.0, 0.0, 1.0))
    sx, sy, sz = n.get("scale", (1.0, 1.0, 1.0))
    tx, ty, tz = n.get("translation", (0.0, 0.0, 0.0))
    r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[r[0][0] * sx, r[0][1] * sy, r[0][2] * sz, tx], [r[1][0] * sx, r[1][1] * sy, r[1][2] * sz, ty],
            [r[2][0] * sx, r[2][1] * sy, r[2][2] * sz, tz], [0.0, 0.0, 0.0, 1.0]]


def glb_bounds(path: Path) -> dict:
    """La boîte du GLB dans l'espace de la scène : les `min`/`max` de POSITION (obligatoires,
    glTF 2.0 § 5.1.1) de chaque primitive, ses huit coins passés par les transformations des
    nœuds — l'espace où Get 3D Components de ComfyUI pose le mesh (« with their transforms
    applied »). Rend {min, max, center, radius}."""
    with open(path, "rb") as f:
        magic, _v, _n = struct.unpack("<4sII", f.read(12))
        if magic != b"glTF":
            raise ValueError("pas un GLB")
        n, kind = struct.unpack("<I4s", f.read(8))
        if kind != b"JSON":
            raise ValueError("GLB sans JSON en tête")
        doc = json.loads(f.read(n))
    acc, meshes, nodes = doc.get("accessors", []), doc.get("meshes", []), doc.get("nodes", [])
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    ident = [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]

    def walk(k: int, parent: list, depth: int = 0) -> None:
        if depth > 64 or not (0 <= k < len(nodes)):
            return
        node = nodes[k]
        m = _mat_mul(parent, _node_matrix(node))
        if isinstance(node.get("mesh"), int) and 0 <= node["mesh"] < len(meshes):
            for prim in meshes[node["mesh"]].get("primitives", []):
                pos = acc[prim["attributes"]["POSITION"]]
                a, b = pos.get("min"), pos.get("max")
                if not a or not b:
                    continue
                for c in range(8):
                    p = [(b if c >> i & 1 else a)[i] for i in range(3)] + [1.0]
                    w = [sum(m[r][q] * p[q] for q in range(4)) for r in range(3)]
                    for i in range(3):
                        lo[i], hi[i] = min(lo[i], w[i]), max(hi[i], w[i])
        for ch in node.get("children", []):
            walk(ch, m, depth + 1)

    scenes = doc.get("scenes") or [{"nodes": list(range(len(nodes)))}]
    for k in scenes[doc.get("scene", 0) if isinstance(doc.get("scene"), int) else 0].get("nodes", []):
        walk(k, ident)
    if lo[0] == math.inf:
        raise ValueError("GLB sans géométrie lisible (POSITION sans min/max)")
    center = [(lo[i] + hi[i]) / 2 for i in range(3)]
    radius = math.sqrt(sum((hi[i] - lo[i]) ** 2 for i in range(3))) / 2
    return {"min": lo, "max": hi, "center": center, "radius": max(radius, 1e-6)}


def camera(b: dict, az: float, el: float, fov: float = RENDER_FOV) -> dict:
    """La caméra d'un angle autour de la boîte : visée sur son centre, à la distance où sa sphère
    tient dans le champ — la formule du cadrage automatique de Render Mesh
    (`r / tan(fov / 2) × 1,04`, comfy_extras/nodes_mesh_postprocess.py), la même pour toutes
    les vues : une échelle par construction. Repère du visualiseur : Y en haut, la face vers +Z ;
    90° voit le côté gauche de l'objet (+X)."""
    el = min(float(el), RENDER_TOP_EL)
    d = b["radius"] / math.tan(math.radians(fov) / 2) * 1.04
    ra, re_ = math.radians(az), math.radians(el)
    c = b["center"]
    pos = [c[0] + d * math.cos(re_) * math.sin(ra), c[1] + d * math.sin(re_), c[2] + d * math.cos(re_) * math.cos(ra)]
    return {"position": pos, "target": c, "fov": fov, "distance": d}


def _cam_node(cam: dict) -> dict:
    """Create Camera Info (ComfyUI 0.37.2, comfy_extras/nodes_gaussian_splat.py), mode `look_at` ;
    les entrées d'une liste dynamique s'écrivent « mode.position_x » (`finalize_prefix` de
    comfy_api/latest/_io.py : « . » entre les noms ; comme `images.image_1` d'AnyAngle Studio)."""
    p, t = cam["position"], cam["target"]
    return {"class_type": "CreateCameraInfo", "_meta": {"title": "caméra"},
            "inputs": {"mode": "look_at", "mode.position_x": round(p[0], 5), "mode.position_y": round(p[1], 5),
                       "mode.position_z": round(p[2], 5), "target_x": round(t[0], 5), "target_y": round(t[1], 5),
                       "target_z": round(t[2], 5), "roll": 0.0, "fov": cam["fov"], "zoom": 1.0, "camera_type": "perspective"}}


def _mesh_nodes(g: dict, glb_name: str) -> str:
    g["glb"] = {"class_type": "Load3DAdvanced", "_meta": {"title": "GLB"},
                "inputs": {"model_file": glb_name, "viewport_state": {}, "width": SIDE, "height": SIDE}}
    g["mesh"] = {"class_type": "Get3DComponents", "_meta": {"title": "mesh"}, "inputs": {"model_3d": ["glb", 0]}}
    return "mesh"


def graph_rendus(glb_name: str, cams: list[tuple[str, dict]], mode: str = "auto") -> dict:
    """Les rendus d'un GLB : Load 3D (Advanced) → Get 3D Components → Render Mesh par caméra
    (fond blanc), une sortie « OUT <nom> » par vue. Nœuds natifs de ComfyUI 0.37.2, aucun poids."""
    g: dict = {}
    mesh = _mesh_nodes(g, glb_name)
    for name, cam in cams:
        g[f"c_{name}"] = _cam_node(cam)
        g[f"r_{name}"] = {"class_type": "RenderMesh", "_meta": {"title": f"rendu {name}"},
                          "inputs": {"mesh": [mesh, 0], "mode": mode, "width": SIDE, "height": SIDE,
                                     "background": "#FFFFFF", "camera_info": [f"c_{name}", 0]}}
        g[f"s_{name}"] = {"class_type": "SaveImage", "_meta": {"title": f"OUT {name}"},
                          "inputs": {"images": [f"r_{name}", 0], "filename_prefix": "showrunner/objet_rendu"}}
    return g


def graph_anyangle(src_name: str, glb_name: str, cam: dict, seed: int) -> dict:
    """AnyAngle : le guide (le rendu du modèle 3D à l'angle voulu) en <image2>, la vue de départ
    en <image1> ; Qwen-Image 2.1 de base + le LoRA, 20 pas, CFG 3, euler / simple, 1024 —
    AnyAngle-Studio-Qwen21-API.json d'AnyAngle Studio T8 (lilylilith/QI_2.1_AnyAngle). Les fichiers
    de Qwen 2.1 : ceux de Character Factory (factory/qwen21.py, une seule vérité), sans son
    LoRA turbo (AnyAngle n'est documenté qu'en 20 pas)."""
    from tools import image
    cf = image._cf()
    q21, st = cf.qwen21, cf.config.setting
    g: dict = {"ref": {"class_type": "LoadImage", "_meta": {"title": "REF 1"}, "inputs": {"image": src_name}}}
    mesh = _mesh_nodes(g, glb_name)
    g["cam"] = _cam_node(cam)
    g["guide"] = {"class_type": "RenderMesh", "_meta": {"title": "guide"},
                  "inputs": {"mesh": [mesh, 0], "mode": "auto", "width": SIDE, "height": SIDE, "background": "#FFFFFF",
                             "camera_info": ["cam", 0]}}
    g["unet"] = {"class_type": "UNETLoader", "inputs": {"unet_name": st("qwen21_unet", q21.UNET), "weight_dtype": "default"}}
    g["lora"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["unet", 0], "lora_name": ANYANGLE_LORA, "strength_model": 1.0}}
    g["clip"] = {"class_type": "CLIPLoader", "inputs": {"clip_name": st("qwen21_clip", q21.CLIP), "type": "qwen_image", "device": "default"}}
    g["vae"] = {"class_type": "VAELoader", "inputs": {"vae_name": q21.VAE}}
    g["enc"] = {"class_type": "TextEncodeQwenImage21",
                "inputs": {"clip": ["clip", 0], "vae": ["vae", 0], "images.image_1": ["ref", 0], "images.image_2": ["guide", 0],
                           "prompt": ANYANGLE_PROMPT, "negative_prompt": "", "resolution": 1024}}
    g["ks"] = {"class_type": "KSampler", "inputs": {"model": ["lora", 0], "positive": ["enc", 0], "negative": ["enc", 1],
                                                    "latent_image": ["enc", 2], "seed": int(seed), "steps": 20, "cfg": 3.0,
                                                    "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}}
    g["dec"] = {"class_type": "VAEDecode", "inputs": {"samples": ["ks", 0], "vae": ["vae", 0]}}
    g["out"] = {"class_type": "SaveImage", "_meta": {"title": "OUT vue"}, "inputs": {"images": ["dec", 0], "filename_prefix": "showrunner/objet_vue"}}
    g["out_g"] = {"class_type": "SaveImage", "_meta": {"title": "OUT guide"}, "inputs": {"images": ["guide", 0], "filename_prefix": "showrunner/objet_guide"}}
    return g


# ── les rendus du modèle 3D ─────────────────────────────────
def render_name(mesh_file: str, az: int, el: int) -> str:
    return f"rendu-{Path(mesh_file).stem[5:]}-az{az:03d}-el{el:02d}.png"


def _attach_renders(eid: str, mesh_file: str, files: list[tuple[int, int, Path]], meta: dict) -> list[dict]:
    """Range les rendus dans le dossier de l'élément, à côté de leur mesh, et les inscrit dans
    `meshes[…].rendus` (ceux d'avant, du même mesh, sont remplacés)."""
    out = []
    with library._lock:
        it = library.get(eid)
        if not _is_object(it):
            raise RuntimeError(f"objet introuvable : {eid}")
        library.check_write(it)
        m = next((x for x in it["element"].get("meshes") or [] if x.get("file") == mesh_file), None)
        if not m:
            raise RuntimeError("ce modèle 3D a quitté l'objet")
        d = library.folder_of(eid)
        for az, el, src in files:
            name = render_name(mesh_file, az, el)
            src.replace(d / name)
            thumb = Path(name).stem + ".thumb.jpg"
            e = {"file": name, "az": az, "el": el, "label": angle_label(az, el)}
            if library.make_thumb(d / name, d / thumb, "image"):
                e["thumb"] = thumb
            out.append(e)
        m["rendus"] = out
        m["rendus_meta"] = {"at": library.now(), **meta}
        it["updated"] = library.now()
        library._save(it)
    return out


def factice_render(b: dict, az: int, el: int, label: str, dest: Path) -> Path:
    """Le rendu factice d'un mesh : SA BOÎTE, vue de la même caméra que les vrais rendus (la même
    projection, le même cadrage), faces ombrées par leur orientation, fond blanc de studio ; un
    bandeau « FACTICE »."""
    from PIL import Image, ImageDraw
    from tools import image
    T = image.tokens()
    cam = camera(b, az, el)
    pos, tgt = cam["position"], cam["target"]
    f = [tgt[i] - pos[i] for i in range(3)]
    fn = math.sqrt(sum(x * x for x in f))
    f = [x / fn for x in f]
    up = [0.0, 1.0, 0.0]
    r = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]]
    rn = math.sqrt(sum(x * x for x in r)) or 1.0
    r = [x / rn for x in r]
    u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]
    k = (SIDE / 2) / math.tan(math.radians(cam["fov"]) / 2)
    lo, hi = b["min"], b["max"]
    corners = [[(hi if c >> i & 1 else lo)[i] for i in range(3)] for c in range(8)]

    def proj(p):
        d = [p[i] - pos[i] for i in range(3)]
        z = sum(d[i] * f[i] for i in range(3))
        return (SIDE / 2 + k * sum(d[i] * r[i] for i in range(3)) / z, SIDE / 2 - k * sum(d[i] * u[i] for i in range(3)) / z), z
    faces = [((0, 2, 6, 4), (-1, 0, 0)), ((1, 5, 7, 3), (1, 0, 0)), ((0, 4, 5, 1), (0, -1, 0)),
             ((2, 3, 7, 6), (0, 1, 0)), ((0, 1, 3, 2), (0, 0, -1)), ((4, 6, 7, 5), (0, 0, 1))]
    img = Image.new("RGB", (SIDE, SIDE), STUDIO_WHITE)
    dr = ImageDraw.Draw(img)
    light = [0.45, 0.75, 0.5]
    vis = []
    for idx, n in faces:
        c = [sum(corners[i][a] for i in idx) / 4 for a in range(3)]
        if sum(n[a] * (pos[a] - c[a]) for a in range(3)) <= 0:
            continue   # une face qui tourne le dos à la caméra
        pts = [proj(corners[i])[0] for i in idx]
        depth = proj(c)[1]
        shade = 0.45 + 0.55 * max(0.0, sum(n[a] * light[a] for a in range(3)))
        vis.append((depth, pts, shade))
    base = T["verd-5"] if "verd-5" in T else T["panel"]
    for _, pts, shade in sorted(vis, key=lambda x: -x[0]):
        dr.polygon(pts, fill=tuple(int(c * shade) for c in base), outline=T["ink3"])
    img = image.stub_band(img, f"rendu {label} · la boîte du mesh, pas le mesh")
    img.save(dest)
    return dest


def run_rendus_factice(ctx) -> dict:
    p = ctx.params
    eid, it = _job_object(ctx)
    glb = library.path_of(it, p["mesh"])
    if not glb.is_file():
        raise RuntimeError("ce modèle 3D a quitté l'objet")
    b = glb_bounds(glb)
    files = []
    for k, (az, el) in enumerate(RENDER_ANGLES):
        ctx.check()
        ctx.progress(0.05 + 0.9 * k / len(RENDER_ANGLES), f"rendu factice {angle_label(az, el)}")
        files.append((az, el, factice_render(b, (az + p.get("face", 0)) % 360, el, angle_label(az, el), ctx.workdir / f"r{k}.png")))
        time.sleep(FACTICE_S / len(RENDER_ANGLES))
    got = _attach_renders(eid, p["mesh"], files, {"factice": True, "face": p.get("face", 0), "job": ctx.job["id"]})
    return {"element": eid, "rendus": len(got), "note": f"{len(got)} rendus factices : la boîte du mesh"}


def run_rendus(ctx) -> dict:
    """Les rendus par ComfyUI (Render Mesh) : un graphe, une caméra par angle."""
    p = ctx.params
    eid, it = _job_object(ctx)
    if ctx.comfy is None:
        raise RuntimeError(f"la voie « image » n'a pas de ComfyUI ici ({ctx.endpoint}) : les rendus ne peuvent pas partir")
    glb = library.path_of(it, p["mesh"])
    b = glb_bounds(glb)
    name = ctx.comfy.upload(glb, f"sr_objet_{ctx.job['id']}.glb", subfolder="3d")
    cams = [(f"az{az:03d}el{el:02d}", camera(b, (az + p.get("face", 0)) % 360, el)) for az, el in RENDER_ANGLES]
    g = graph_rendus(name, cams)
    from tools import objet
    problems = objet.validate(ctx.comfy, g)
    if problems:
        raise RuntimeError("les rendus ne peuvent pas partir : " + " · ".join(problems[:6]))
    t0 = time.time()
    got = _run_named(ctx, g, "Render Mesh")
    files = [(az, el, got[f"az{az:03d}el{el:02d}"]) for az, el in RENDER_ANGLES if f"az{az:03d}el{el:02d}" in got]
    out = _attach_renders(eid, p["mesh"], files, {"face": p.get("face", 0), "job": ctx.job["id"], "secs": round(time.time() - t0, 1)})
    return {"element": eid, "rendus": len(out), "note": f"{len(out)} rendus · {time.time() - t0:.0f} s"}


# ── la planche (H3) ─────────────────────────────────────────
def run_planche(ctx) -> dict:
    """La planche des vues gardées : une rangée de cases carrées, chaque vue entière au centre
    (92 % de la case), fond blanc de studio, sans texte — la forme de la planche « corps 3 vues »
    des personnages qu'H3 reçoit (movie.py, SHEET_SET). Rangée dans la bibliothèque et posée dans
    l'élément (rôle `sheet`) ; la planche d'avant quitte la planche de l'élément."""
    from PIL import Image
    eid, it = _job_object(ctx)
    why = sheet_why(it)
    if why:
        raise RuntimeError(why)
    views = sheet_views(it)
    sheet = Image.new("RGB", (SIDE * len(views), SIDE), STUDIO_WHITE)
    for k, r in enumerate(views):
        ctx.check()
        ctx.progress(0.1 + 0.8 * k / len(views), f"planche · {r.get('label') or angle_label(r['az'], 0)}")
        with Image.open(library.path_of(it, r["file"])) as im:
            im = im.convert("RGBA")
            im.thumbnail((int(SIDE * 0.92), int(SIDE * 0.92)), Image.LANCZOS)
            cell = Image.new("RGBA", (SIDE, SIDE), STUDIO_WHITE + (255,))
            cell.alpha_composite(im, ((SIDE - im.width) // 2, (SIDE - im.height) // 2))
            sheet.paste(cell.convert("RGB"), (k * SIDE, 0))
    out = ctx.workdir / "planche.png"
    sheet.save(out)
    labels = " · ".join(angle_label(r["az"], 0) for r in views)
    new = ctx.add(out, kind="image", title=f"{it['title']} · planche {len(views)} vues", folder=FOLDER,
                  prompt=labels, params={"job": "objet.planche", "element": eid, "views": [r["file"] for r in views]},
                  parents=[eid] + [r["item"] for r in views if r.get("item")], origin={"model": "planche · PIL", "backend": "cpu"})
    with library._lock:
        it = library.get(eid)
        library.check_write(it)
        for r in [r for r in it["element"]["refs"] if r.get("role") == "sheet"]:
            _drop_ref(it, r["file"])
        library._save(it)
    library.add_ref(eid, library.path_of(new), role="sheet", label=f"planche objet {len(views)} vues", from_item=new["id"])
    return {"element": eid, "item": new["id"], "note": f"planche · {labels}"}


# ── ce que c'est : le modèle qui voit ───────────────────────
CLASS_TASK = ("You look at ONE image for a 3D artist who will turn its subject into a 3D asset. Say what the image is "
              "(one of: objet = a single object or vehicle; batiment = a building seen from outside; decor = an outdoor "
              "place or landscape; interieur = a room seen from inside; personnage = a person or creature), the main "
              "subject in a few French words, and from where the camera sees that subject: its azimuth around the subject "
              "(front, front-left = the camera stands toward the subject's own left side, left, back-left, back, back-right, "
              "right, front-right) and its height (eye-level, elevated about 30 degrees, high about 60 degrees, top-down).")
CLASS_SCHEMA = {"type": "object", "properties": {
    "classe": {"type": "string", "enum": list(CLASSES)},
    "sujet": {"type": "string"},
    "azimut": {"type": "string", "enum": ["front", "front-left", "left", "back-left", "back", "back-right", "right", "front-right"]},
    "hauteur": {"type": "string", "enum": ["eye-level", "elevated", "high", "top-down"]}},
    "required": ["classe", "sujet", "azimut", "hauteur"]}
CLASS_AZ = {"front": 0, "front-left": 45, "left": 90, "back-left": 135, "back": 180, "back-right": 225, "right": 270, "front-right": 315}
CLASS_EL = {"eye-level": 0, "elevated": 30, "high": 60, "top-down": 90}


def run_classer(ctx) -> dict:
    """Le travail `objet.classer` : UN appel du modèle qui voit (ideation_agent.Moteur, sortie
    structurée) ; sa réponse est une PROPOSITION — la classe et l'angle qu'on a dits soi-même
    ne sont jamais remplacés. Sans modèle qui voit : rien d'inventé, la page le dit."""
    from tools import ideation_agent as A
    p = ctx.params
    eid, it = _job_object(ctx)
    v = plan_of(it)
    src = next((r for r in it["element"]["refs"] if r["file"] == v["source"].get("file")), None)
    if not src:
        raise RuntimeError("cet objet n'a pas d'image")
    st = A.engine_state(max_age=0, url=p["url"], model=p["model"])

    def put(**kw):
        def fn(it2, v2):
            c = {**class_of(it2), **kw, "job": None, "at": library.now()}
            it2["element"]["classe"] = c
            a = kw.get("angle")
            if a and v2["source"].get("by") in ("defaut", "modele"):   # l'angle dit par la personne reste le sien
                v2["source"].update(az=a[0], el=a[1], by="modele")
                for r in it2["element"]["refs"]:
                    if r["file"] == v2["source"].get("file"):
                        r.update(az=a[0], el=a[1], label=angle_label(*a))
            if c.get("by") == "personne":
                c["value"] = class_of(it2).get("value")
        edit_plan(eid, fn)
    if not st.get("present") or "vision" not in st.get("caps", []):
        why = st.get("why") or f"le modèle {p['model']} ne voit pas les images"
        put(why=why)
        return {"note": why}
    m = A.Moteur(ctx, st, url=p["url"], model=p["model"])
    try:
        ctx.progress(0.3, f"regarde l'image · {A.machine_name(m.url)}")
        r = m.chat([{"role": "system", "content": CLASS_TASK},
                    {"role": "user", "content": f"The image is titled « {it['title']} ». Answer with the JSON object.",
                     "images": [A.image_b64(library.path_of(it, src["file"]), side=768)]}], fmt=CLASS_SCHEMA)
    finally:
        m.unload()
    d = A._json(r)
    value = d.get("classe") if d.get("classe") in CLASSES else None
    az, el = CLASS_AZ.get(d.get("azimut")), CLASS_EL.get(d.get("hauteur"))
    angle = ((0, 90) if el == 90 else (az, el)) if az is not None and el is not None else None
    sujet = str(d.get("sujet") or "")[:80]
    cur = class_of(it)
    proposal = {"value": value, "angle": list(angle) if angle else None, "sujet": sujet, "model": p["model"]}
    if cur.get("by") == "personne":
        put(proposal=proposal, why="", angle=angle)   # la sienne reste ; la proposition est notée
    else:
        put(value=value, by="modele", proposal=proposal, why="" if value else "réponse illisible du modèle", angle=angle)
    return {"note": f"{CLASSES.get(value, '?')} · {sujet} · vu {angle_label(*angle) if angle else '?'}"}


# ── l'enregistrement ────────────────────────────────────────
def _family_vue(p: dict) -> str | None:
    return GENS.get(p.get("gen"), {}).get("family")


def register(app) -> None:
    from tools import ideation_agent as A
    app.route("GET", "/api/objet/{eid}/vues", r_get)
    # les routes nommées avant /vues/{sid} : la première qui répond l'emporte (core/http.py)
    app.route("POST", "/api/objet/{eid}/vues/source", r_source)
    app.route("POST", "/api/objet/{eid}/vues/plan", r_plan)
    app.route("POST", "/api/objet/{eid}/vues/generer", r_generer)
    app.route("POST", "/api/objet/{eid}/vues/{sid}", r_slot)
    app.route("POST", "/api/objet/{eid}/classe", r_classe)
    app.route("POST", "/api/objet/{eid}/classer", r_classer)
    app.route("POST", "/api/objet/{eid}/face", r_face)
    app.route("POST", "/api/objet/{eid}/rendus", r_rendus)
    app.route("POST", "/api/objet/{eid}/planche", r_planche)
    jobs.register("objet.vue_factice", run_vue_factice, lane="cpu", title="Objet · vue factice", cost="cpu")
    jobs.register("objet.vue", run_vue, lane="image", title="Objet · vue", family=_family_vue, gpu=True, cost="gpu")
    jobs.register("objet.rendus_factice", run_rendus_factice, lane="cpu", title="Objet · rendus factices", cost="cpu")
    jobs.register("objet.rendus", run_rendus, lane="image", title="Objet · rendus", family=None, gpu=True, cost="gpu")
    jobs.register("objet.planche", run_planche, lane="cpu", title="Objet · planche", cost="cpu")
    # le modèle qui voit : la voie audio épinglée sur sa machine (la règle des paliers d'Idéation), cpu sans elle
    lane = A._lane()
    real = lane == "audio"
    jobs.register("objet.classer", run_classer, lane=lane, title="Objet · ce que c'est",
                  family=(lambda p: p.get("family")) if real else None, gpu=real,
                  mem_gb=(lambda p: p.get("mem_gb")) if real else None, cost="gpu" if real else "cpu")


# ── le contrôle, sans GPU ───────────────────────────────────
def selftest(call, ok) -> None:
    import importlib.util
    import io
    from PIL import Image

    def wait(jid: str) -> dict:
        j = {}
        for _ in range(400):
            _, j = call("GET", f"/api/jobs/{jid}")
            if j.get("state") in ("done", "error", "cancelled", "interrupted"):
                break
            time.sleep(0.05)
        return j

    def by_angle(p: dict, az: int, el: int) -> dict:
        return next((s for s in p["vues"]["slots"] if (s["az"], s["el"]) == (az, el)), {})

    # les angles : la gauche de l'objet à 90°, comme Pixal3D (front 0, left 90, back 180, right 270)
    ok(angle_label(90, 0) == "gauche · 90°" and angle_label(45, 30) == "3/4 avant gauche · 45° · surélevé 30°"
       and angle_label(0, 90) == "dessus · 90°", "vues : les libellés des angles (ceux des vues d'avant à hauteur d'œil)")
    ok(abs(separation((135, 0), (90, 0)) - 45) < 1e-6 and abs(separation((0, 90), (180, 0)) - 90) < 1e-6,
       "vues : l'écart entre deux directions de vue, sur la sphère")
    buf = io.BytesIO()
    Image.new("RGB", (256, 192), (40, 90, 160)).save(buf, "PNG")
    st, img = call("PUT", "/api/library/upload?name=voiture.png&title=Voiture", raw=buf.getvalue())
    st, o = call("POST", "/api/objet/objects", {"title": "Voiture", "description": "une voiture vue en perspective", "item": img["id"]})
    eid = o["id"]
    st, p = call("GET", f"/api/objet/{eid}/vues")
    s0 = p["vues"]["slots"][0]
    main = [s for s in p["vues"]["slots"] if s["pass"] == 1]
    ok(st == 200 and s0["state"] == "source" and (s0["az"], s0["el"]) == (0, 0) and s0.get("ref_url")
       and sorted((s["az"], s["el"]) for s in main) == [(90, 0), (180, 0), (270, 0)] and all(s["state"] == "prevue" for s in main)
       and p["gen"]["id"] == "factice" and p["go"]["ok"] and not p["pass_open"]["ok"],
       f"vues : à l'arrivée, l'image choisie vue de face, les trois autres vues principales prévues ({st} {[(s['az'], s['state']) for s in p['vues']['slots']]})")
    st, p = call("POST", f"/api/objet/{eid}/vues/source", {"az": 45, "el": 0})
    main = [s for s in p["vues"]["slots"] if s["pass"] == 1]
    st2, _ = call("GET", f"/api/library/{eid}")
    ok(st == 200 and (p["vues"]["slots"][0]["az"], p["vues"]["source"]["by"]) == (45, "personne") and len(main) == 4
       and by_angle(p, 0, 0).get("state") == "prevue",
       f"vues : l'image choisie vue de 3/4 avant gauche — la face rentre dans le plan ({[(s['az'], s['pass']) for s in p['vues']['slots']]})")
    st, _o = call("GET", f"/api/library/{eid}")
    ok(_o["element"]["refs"][0].get("az") == 45 and _o["element"]["refs"][0]["label"] == "3/4 avant gauche · 45°",
       "vues : la référence de l'image choisie porte son angle et son libellé")
    st, _ = call("POST", f"/api/objet/{eid}/vues/source", {"az": 50, "el": 0})
    ok(st == 400, "vues : un angle hors de la grille est refusé")
    st, p = call("POST", f"/api/objet/{eid}/classe", {"value": "personnage"})
    st2, r = call("POST", f"/api/objet/{eid}/vues/generer", {})
    ok(st == 200 and not p["go"]["ok"] and p["go"]["route"] == "character" and st2 == 409 and "Character Factory" in r.get("error", ""),
       f"vues : un personnage ne passe pas par les vues d'objet, la raison le dit ({st2} {r.get('error')})")
    call("POST", f"/api/objet/{eid}/classe", {"value": "objet"})
    st, r = call("POST", f"/api/objet/{eid}/vues/generer", {})
    ok(st == 200 and len(r.get("jobs", [])) == 4 and all(s["state"] == "file" for s in r["vues"]["slots"] if s["pass"] == 1),
       f"vues : « Générer » met un travail par vue principale en file ({st} {r.get('error') or len(r.get('jobs', []))})")
    done = [wait(j) for j in r.get("jobs", [])]
    st, p = call("GET", f"/api/objet/{eid}/vues")
    main = [s for s in p["vues"]["slots"] if s["pass"] == 1]
    ok(all(j.get("state") == "done" and j.get("kind") == "objet.vue_factice" for j in done)
       and all(s["state"] == "proposee" and len(s["items"]) == 1 and s["items"][0] in p["items"] for s in main),
       f"vues : chaque vue factice est proposée ({[(j.get('state'), j.get('message')) for j in done]})")
    it0 = p["items"][by_angle(p, 90, 0)["items"][0]]
    ok(it0["params"]["from"]["az"] == 45 and it0["params"]["from"]["label"].startswith("l'image choisie")
       and it0["params"]["slot"] == by_angle(p, 90, 0)["id"] and it0["origin"]["tool"] == "object",
       f"vues : la première passe part de l'image choisie ({it0['params'].get('from')})")
    sid = {a: by_angle(p, a, 0)["id"] for a in (0, 90, 180, 270)}
    for a in (0, 90, 180):
        st, p = call("POST", f"/api/objet/{eid}/vues/{sid[a]}", {"action": "garder"})
    st, p = call("POST", f"/api/objet/{eid}/vues/{sid[270]}", {"action": "rejeter"})
    st, el = call("GET", f"/api/library/{eid}")
    views = [r for r in el["element"]["refs"] if r["role"] == "view"]
    ok(st == 200 and [by_angle(p, a, 0)["state"] for a in (0, 90, 180, 270)] == ["gardee"] * 3 + ["rejetee"]
       and sorted((r.get("az"), r["label"]) for r in views)[:2] == [(0, "face · 0°"), (45, "3/4 avant gauche · 45°")]
       and len(views) == 4 and p["pass_open"]["ok"],
       f"vues : garder en fait une référence de l'objet (avec son angle), rejeter non ; l'affinage s'ouvre ({p['pass_open']})")
    st, p = call("POST", f"/api/objet/{eid}/vues/{sid[270]}", {"action": "rouvrir"})
    ok(st == 200 and by_angle(p, 270, 0)["state"] == "proposee" and not p["pass_open"]["ok"],
       f"vues : rouvrir défait le rejet (Ctrl+Z) — l'affinage attend de nouveau ({p['pass_open']['why']})")
    call("POST", f"/api/objet/{eid}/vues/{sid[270]}", {"action": "rejeter"})
    # refaire une vue gardée : la nouvelle proposition arrive, la gardée le reste jusqu'à ce qu'on garde l'autre
    st, r = call("POST", f"/api/objet/{eid}/vues/generer", {"slots": [sid[0]]})
    wait(r["jobs"][0]) if st == 200 else None
    st, p = call("GET", f"/api/objet/{eid}/vues")
    s = by_angle(p, 0, 0)
    ok(st == 200 and s["state"] == "gardee" and len(s["items"]) == 2 and s["pick"] == s["items"][0],
       f"vues : refaire une vue gardée la propose de nouveau sans la défaire ({s.get('state')} {len(s.get('items', []))})")
    st, p = call("POST", f"/api/objet/{eid}/vues/{sid[0]}", {"action": "garder", "item": s["items"][1]})
    st, el = call("GET", f"/api/library/{eid}")
    faces = [r for r in el["element"]["refs"] if r["role"] == "view" and r.get("az") == 0]
    ok(st == 200 and len(faces) == 1 and faces[0]["item"] == s["items"][1],
       f"vues : garder l'autre proposition remplace la référence ({[(r['file'], r.get('item')) for r in faces]})")
    st, r = call("POST", f"/api/objet/{eid}/vues/{sid[90]}", {"action": "garder", "item": img["id"]})
    ok(st == 409, "vues : on ne garde qu'une proposition de la vue")
    st, r = call("POST", f"/api/objet/{eid}/vues/v00", {"action": "rejeter"})
    ok(st == 409, "vues : l'image choisie ne se rejette pas ici")
    # l'affinage : les 3/4 (le 45 est l'image choisie) et le dessus, depuis la vue gardée la plus proche
    st, p = call("POST", f"/api/objet/{eid}/vues/plan", {"pass": 2})
    two = [s for s in p["vues"]["slots"] if s["pass"] == 2]
    ok(st == 200 and sorted((s["az"], s["el"]) for s in two) == [(0, 90), (135, 0), (225, 0), (315, 0)],
       f"vues : « plus de vues » prévoit les 3/4 et le dessus ({[(s['az'], s['el']) for s in two]})")
    st, r = call("POST", f"/api/objet/{eid}/vues/generer", {})
    for j in r.get("jobs", []):
        wait(j)
    st, p = call("GET", f"/api/objet/{eid}/vues")
    frm = {(s["az"], s["el"]): p["items"][s["items"][0]]["params"]["from"] for s in p["vues"]["slots"] if s["pass"] == 2 and s["items"]}
    ok(len(frm) == 4 and frm[(135, 0)]["az"] == 90 and frm[(225, 0)]["az"] == 180 and frm[(315, 0)]["az"] == 0
       and frm[(0, 90)]["slot"] == "v00",
       f"vues : chaque vue de l'affinage part de la vue gardée la plus proche ({ {k: v['az'] for k, v in frm.items()} })")
    st, p = call("POST", f"/api/objet/{eid}/vues/plan", {"az": 45, "el": 30})
    extra = by_angle(p, 45, 30)
    st2, _ = call("POST", f"/api/objet/{eid}/vues/plan", {"az": 45, "el": 30})
    st3, p3 = call("POST", f"/api/objet/{eid}/vues/{extra.get('id')}", {"action": "retirer"})
    ok(st == 200 and extra.get("pass") == 3 and st2 == 409 and st3 == 200 and not by_angle(p3, 45, 30),
       f"vues : une vue à la main s'ajoute, une seule fois, et se retire ({st} {st2} {st3})")
    # les générateurs câblés : la voie image (la route relevée pour la garde du calcul), leurs limites
    saved = {k: config.CFG.get(k) for k in ("objet_vues", "objet_rendus")}
    try:
        config.CFG["objet_vues"] = "qwen-edit-2511"
        _, p = call("POST", f"/api/objet/{eid}/vues/plan", {"az": 135, "el": 30})
        top, s30 = by_angle(p, 0, 90), by_angle(p, 135, 30)
        st, r = call("POST", f"/api/objet/{eid}/vues/generer", {"slots": [top["id"]]})
        ok(st == 409 and "ne fait pas la vue dessus" in r.get("error", ""), f"vues : le LoRA de fal n'a pas de vue de dessus, la page le dit ({r})")
        st, r = call("POST", f"/api/objet/{eid}/vues/generer", {"slots": [s30["id"]]})
        jid = (r.get("jobs") or [""])[0]
        _, j = call("GET", f"/api/jobs/{jid}")
        ok(st == 200 and j.get("kind") == "objet.vue" and j.get("lane") == "image" and j["params"]["gen"] == "qwen-edit-2511",
           f"vues : Qwen-Edit 2511 part sur la voie image ({st} {j.get('kind')} {j.get('lane')})")
        call("POST", f"/api/jobs/{jid}/cancel")
        st, p = call("GET", f"/api/objet/{eid}/vues")
        ok(by_angle(p, 135, 30)["state"] == "echec", f"vues : un travail arrêté laisse la vue en échec, à refaire ({by_angle(p, 135, 30)})")
        call("POST", f"/api/objet/{eid}/vues/{s30['id']}", {"action": "retirer"})
        config.CFG["objet_vues"] = "qwen21-anyangle"
        st, r = call("POST", f"/api/objet/{eid}/vues/generer", {"slots": [top["id"]]})
        ok(st == 409 and "tire d'abord la 3D" in r.get("error", ""), f"vues : AnyAngle attend un modèle 3D réel ({r})")
    finally:
        for k, v in saved.items():
            if v is None:
                config.CFG.pop(k, None)
            else:
                config.CFG[k] = v
    # la 3D (factice), ses rendus, la face du modèle
    st, j = call("POST", "/api/jobs", {"kind": "objet.mesh_factice", "params": {"element": eid}, "title": "factice"})
    j = wait(j["id"])
    st, el = call("GET", f"/api/library/{eid}")
    m = el["element"]["meshes"][-1]
    ok(j.get("state") == "done" and m.get("views_kept") == 3 and "le multi-vues" in j["result"].get("note", ""),
       f"vues : le mesh dit combien de vues gardées attendaient le multi-vues ({m.get('views_kept')} {j.get('result', {}).get('note')})")
    b = glb_bounds(library.path_of(library.get(eid), m["file"]))
    cam = camera(b, 90, 0)
    ok(b["min"] == [-0.5, 0.0, -0.5] and b["max"] == [0.5, 1.0, 0.5] and cam["position"][0] > 1 and abs(cam["position"][2]) < 1e-9,
       f"vues : les bornes du GLB, la caméra de « gauche » sur +X ({b['min']} {b['max']} {cam['position']})")
    st, r = call("POST", f"/api/objet/{eid}/face", {"face": 45})
    st2, p = call("POST", f"/api/objet/{eid}/face", {"face": 90})
    ok(st == 400 and st2 == 200 and p["vues"]["face"] == 90, "vues : la face du modèle 3D, par quarts de tour")
    call("POST", f"/api/objet/{eid}/face", {"face": 0})
    st, r = call("POST", f"/api/objet/{eid}/rendus", {})
    j = wait(r.get("job", ""))
    st, el = call("GET", f"/api/library/{eid}")
    rs = el["element"]["meshes"][-1].get("rendus") or []
    st3, raw = call("GET", f"/library/{eid}/{rs[0]['file']}") if rs else (0, b"")
    ok(j.get("state") == "done" and r.get("kind") == "objet.rendus_factice" and len(rs) == len(RENDER_ANGLES)
       and rs[0]["file"].startswith("rendu-") and st3 == 200 and raw[:4] == b"\x89PNG",
       f"vues : les rendus factices du modèle, rangés avec lui ({j.get('state')} {j.get('message')} {len(rs)})")
    try:
        config.CFG["objet_rendus"] = True
        st, r = call("POST", f"/api/objet/{eid}/rendus", {})
        _, j = call("GET", f"/api/jobs/{r.get('job')}")
        ok(st == 200 and j.get("kind") == "objet.rendus" and j.get("lane") == "image", f"vues : les rendus câblés partent sur la voie image ({j.get('kind')})")
        call("POST", f"/api/jobs/{r.get('job')}/cancel")
    finally:
        config.CFG.pop("objet_rendus", None) if saved["objet_rendus"] is None else config.CFG.update(objet_rendus=saved["objet_rendus"])
    g = graph_rendus("3d/essai.glb", [("az090el00", camera(b, 90, 0))])
    ok(g["c_az090el00"]["inputs"]["mode"] == "look_at" and "mode.position_x" in g["c_az090el00"]["inputs"]
       and g["r_az090el00"]["inputs"]["camera_info"] == ["c_az090el00", 0] and g["s_az090el00"]["_meta"]["title"] == "OUT az090el00",
       "vues : le graphe des rendus (Load 3D → Get 3D Components → Render Mesh, une caméra par vue)")

    class _Faux:   # un /object_info réduit : Render Mesh absent, Create Camera Info présent avec son entrée dynamique
        def object_info(self, node):
            if node == "RenderMesh":
                return {}
            if node == "CreateCameraInfo":
                return {node: {"input": {"required": {"mode": ["COMFY_DYNAMICCOMBO_V3", {}], "fov": ["FLOAT", {}]}}}}
            if node == "Load3DAdvanced":
                return {node: {"input": {"required": {"model_file": [["none"]], "viewport_state": ["LOAD_3D", {}]}}}}
            return {node: {"input": {"required": {}}}}
    from tools import objet
    probs = objet.validate(_Faux(), g)
    ok(any("RenderMesh" in x for x in probs) and not any("model_file" in x or "Create" in x for x in probs),
       f"vues : le graphe des rendus jugé contre /object_info, le GLB déposé et l'entrée dynamique admis ({probs})")
    # la planche : face, profil, dos, et le 3/4 (l'image choisie, à 45°)
    st, r = call("POST", f"/api/objet/{eid}/planche", {})
    j = wait(r.get("job", ""))
    st, el = call("GET", f"/api/library/{eid}")
    sheets = [x for x in el["element"]["refs"] if x["role"] == "sheet"]
    st2, sh = call("GET", f"/api/library/{j.get('result', {}).get('item')}")
    ok(j.get("state") == "done" and len(sheets) == 1 and sh.get("width") == 4 * SIDE and sh.get("height") == SIDE
       and sh.get("folder") == FOLDER, f"vues : la planche des vues gardées, posée dans l'objet ({j.get('message')} {sh.get('width')})")
    st, r = call("POST", f"/api/objet/{eid}/planche", {})
    wait(r.get("job", ""))
    st, el = call("GET", f"/api/library/{eid}")
    ok(len([x for x in el["element"]["refs"] if x["role"] == "sheet"]) == 1, "vues : une planche refaite remplace l'autre")
    from tools import movie
    imgs, _, note = movie.element_parts(el["element"])
    ok([x.get("_kind") for x in imgs][:1] == ["object_sheet"] and len(imgs) == 4 and imgs[1].get("az") == 0,
       f"vues : H3 reçoit la planche de l'objet puis ses vues, la face d'abord ({[(x.get('_kind'), x.get('az')) for x in imgs]} {note})")
    pv = movie.plan("r2v", {"inputs": {"element": [{"item": eid}]}, "desc": "@element1 rolls down a wet street.", "method": "brouillon"})
    ok(pv["ok"] and len(pv["pictures"]) == 4 and "whose shape, materials and details are shown in <Picture 1>" in pv["prompt_sent"]
       and "the multi-view sheet layout and white studio background" in pv["prompt_sent"] and "face blanked out" not in pv["prompt_sent"],
       f"vues : le plan H3 d'un objet le définit par sa planche et ses vues ({pv.get('errors')} {pv['prompt_sent'][:240]})")
    # ce que c'est : le modèle qui voit (le faux Ollama), une proposition — la classe dite reste
    spec = importlib.util.spec_from_file_location("faux_ollama", config.REPO / "tools" / "faux_ollama.py")
    F = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(F)
    f = F.Faux()
    f.structured = lambda schema, msgs: {"classe": "objet", "sujet": "une voiture rouge", "azimut": "front-left", "hauteur": "elevated"}
    keep = {k: config.CFG.get(k) for k in ("ideation_agent_url", "ideation_agent_vision_url")}
    from tools import ideation_agent as A
    try:
        config.CFG["ideation_agent_url"] = f.start()
        config.CFG.pop("ideation_agent_vision_url", None)
        A._probe.clear()
        st, o2 = call("POST", "/api/objet/objects", {"title": "Voiture 2", "item": img["id"]})
        st, r = call("POST", f"/api/objet/{o2['id']}/classer", {})
        j = wait(r.get("job", ""))
        st, p = call("GET", f"/api/objet/{o2['id']}/vues")
        ok(j.get("state") == "done" and p["classe"].get("value") == "objet" and p["classe"].get("by") == "modele"
           and (p["vues"]["source"]["az"], p["vues"]["source"]["el"], p["vues"]["source"]["by"]) == (45, 30, "modele")
           and f.calls and f.calls[-1]["messages"][-1].get("images"),
           f"vues : le modèle qui voit dit ce qu'est l'image et d'où elle la voit ({j.get('message')} {p['classe']} {p['vues']['source']})")
        st, r = call("POST", f"/api/objet/{eid}/classer", {})
        wait(r.get("job", ""))
        st, p = call("GET", f"/api/objet/{eid}/vues")
        ok(p["classe"]["value"] == "objet" and p["classe"]["by"] == "personne" and p["classe"].get("proposal", {}).get("sujet")
           and p["vues"]["source"]["az"] == 45 and p["vues"]["source"]["by"] == "personne",
           f"vues : ce qu'on a dit soi-même n'est pas remplacé, la proposition est notée ({p['classe']})")
        # poser une image de la bibliothèque sur une place : elle devient cette vue, gardée
        st, p = call("GET", f"/api/objet/{o2['id']}/vues")
        g90 = by_angle(p, 90, 0)
        st, p = call("POST", f"/api/objet/{o2['id']}/vues/{g90['id']}", {"action": "poser", "item": img["id"]})
        st2, _ = call("POST", f"/api/objet/{o2['id']}/vues/{g90['id']}", {"action": "poser", "item": "ima-20000101-000000-0000"})
        st3, _ = call("POST", f"/api/objet/{o2['id']}/vues/source", {"az": 0, "el": 0, "file": "ref-99.png"})
        ok(st == 200 and by_angle(p, 90, 0)["state"] == "gardee" and by_angle(p, 90, 0)["pick"] == img["id"] and st2 == 400 and st3 == 400,
           f"vues : une image de la bibliothèque posée sur une place la garde ; une image ou une référence inconnue est refusée ({st} {st2} {st3})")
        f.caps = ["completion", "tools"]
        A._probe.clear()
        st, r = call("POST", f"/api/objet/{o2['id']}/classer", {})
        j = wait(r.get("job", ""))
        st, p = call("GET", f"/api/objet/{o2['id']}/vues")
        ok(j.get("state") == "done" and "ne voit pas" in (p["classe"].get("why") or ""),
           f"vues : sans modèle qui voit, rien n'est inventé, la raison est dite ({p['classe']})")
    finally:
        f.close()
        for k, v in keep.items():
            if v is None:
                config.CFG.pop(k, None)
            else:
                config.CFG[k] = v
        A._probe.clear()
