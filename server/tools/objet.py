"""Object Creator : un objet est un élément de la bibliothèque (sorte
`object`), fait d'une image choisie par Cal et, au fur et à mesure, de
ses vues (références de rôle `view`). Décision de Cal du 28/09
(Character_Factory/docs/BRIEF_CAL_2026-09-28.md §8 et §10) : une image
validée → des vues faites par nos modèles → TRELLIS sur ces vues ; pas
de Pixal3D.

Ce qui tourne aujourd'hui, et seulement ça :

- TRELLIS.2 **image unique** (`objet.mesh`, voie `image`) : la seule
  entrée documentée de TRELLIS.2 (`run(self, image)` du pipeline ; carte
  « Single Image » — étude du 28/09, §1). Le graphe est celui de
  Character Factory (`<cf_repo>/workflows/trellis2_single.json`), lu, pas
  recopié ; deux écarts, écrits dans `graph()` :
    · `pad_factor` 1,0 au lieu de 1,1 : « pad_factor=1.0 for TRELLIS.2 »
      (ComfyUI 0.37.2, comfy_extras/nodes_trellis2.py l. 450) et
      `size = int(size * 1)` dans `preprocess_image` de TRELLIS.2 ;
    · la sortie rangée sous `showrunner/objet`.
  Le GLB sort en Y haut (relevé sur les neuf meshes TRELLIS.2 de
  Character Factory : `up_axis_in: "Y"`), il n'est pas réorienté. Il est
  rangé dans le dossier de l'élément (`mesh-001.glb`…) et listé dans
  `element.meshes` : le GLB n'est pas une sorte de la bibliothèque.
- Les vues : **aucun modèle retenu** (étude du 28/09, §3.4 : Krea 2 1/4,
  Qwen 2.1 turbo 0/4, LoRA orbit chargé à moitié 1/3). La page les
  accepte à la main (une image de la bibliothèque, rôle `view`) ; aucun
  travail ne les fabrique.

  GET  /api/objet/state        la chaîne : ce qui marche, ce qui attend
  GET  /api/objet/objects      les éléments objet, avec leurs meshes
  POST /api/objet/objects {title, description, item}   un nouvel objet

Le câblage : l'interrupteur `objet_trellis` (Admin → Câblage, écrit dans
`showrunner.local.json`, pris au redémarrage). Tant qu'il ne vaut pas
`true`, `objet.mesh` refuse de partir sur ComfyUI et la page lance
`objet.mesh_factice` (voie `cpu`) : un cube de contrôle, inscrit
`factice: true`, pour que tout le parcours se voie sans GPU.

Câblé, `objet.mesh` part sur la voie « image » (famille `trellis` : la
file du portail vide ComfyUI si une autre famille y est, attend la
mémoire de FAMILY_GB, un seul travail GPU par machine — core/jobs.py) ;
il dépose l'image, juge le graphe contre /object_info de l'instance
avant l'envoi, suit le websocket de ComfyUI pour la progression (l'étape
de chaque nœud, les pas des KSampler), s'arrête par /interrupt, et range
le GLB avec sa durée et celle de chaque étape. Premier rendu réel le
30/09 sur DGX1 : 159 s, 49 614 faces, 3 textures, 35 Mo ; mémoire
disponible de la machine 99,3 → 86,3 Go au plus bas (relevé toutes les
2 s), soit ≈ 13 Go pour TRELLIS.2, sous les 40 Go que FAMILY_GB lui
prête (estimé d'après les poids) ; 45,5 Go avant que la file ne vide
ComfyUI (le Krea 2 du studio, file vide).
"""

from __future__ import annotations

import json
import secrets
import shutil
import struct
import threading
import time
from pathlib import Path

from core import config, jobs, library
from core.comfy import Comfy, ComfyError, fill
from core.http import HttpError

TEMPLATE = "trellis2_single.json"
# ce que le graphe charge (trellis2_single.json de Character Factory)
MODELS = {
    "UNETLoader": ("unet_name", "trellis_2_int8_convrot.safetensors"),
    "CLIPVisionLoader": ("clip_name", "dino_v3_L_naf_fp32.safetensors"),
    "LoadBackgroundRemovalModel": ("bg_removal_name", "birefnet.safetensors"),
}
VAES = ("trellis_2_shape_vae_bf16.safetensors", "trellis_2_texture_vae_bf16.safetensors")
# Character Factory décime à 50 000 faces (factory/mesh_comfy.py, FACES) ;
# pour un objet, aucune valeur documentée : on garde la sienne.
FACES = 50_000
VIEW_LABELS = ("face · 0°", "gauche · 90°", "dos · 180°", "droite · 270°")


def template_path() -> Path:
    return Path(config.get("cf_repo")).expanduser() / "workflows" / TEMPLATE


def graph(image_name: str, seed: int, faces: int = FACES) -> dict:
    """Le graphe TRELLIS.2 image unique, prêt pour ComfyUI."""
    p = template_path()
    if not p.is_file():
        raise RuntimeError(f"gabarit introuvable : {p} (réglage cf_repo)")
    wf = {k: v for k, v in json.loads(p.read_text(encoding="utf-8")).items() if not k.startswith("_")}
    refs = [nid for nid, n in wf.items() if (n.get("_meta") or {}).get("title") == "REF 1"]
    if len(refs) != 1:
        raise RuntimeError(f"{TEMPLATE} : un nœud « REF 1 » attendu, {len(refs)} trouvé(s)")
    wf[refs[0]]["inputs"]["image"] = image_name
    for n in wf.values():
        if n.get("class_type") == "ImageCropToMask":
            n["inputs"]["pad_factor"] = 1.0      # nodes_trellis2.py l. 450 ; preprocess_image de TRELLIS.2
        if n.get("class_type") == "SaveGLB":
            n["inputs"]["filename_prefix"] = "showrunner/objet"
    return fill(wf, {"seed": int(seed), "faces": int(faces)})


def wired() -> bool:
    """TRELLIS.2 n'est lancé que si Cal l'a câblé (`objet_trellis: true`)."""
    return config.get("objet_trellis") is True


# ── ce que ComfyUI a, pour de vrai (lecture de /object_info, aucun rendu) ──
_state_cache: dict = {"t": 0.0, "v": None}
_state_lock = threading.Lock()


def _choices(c: Comfy, node: str, field: str) -> list:
    """Les valeurs d'une liste de choix dans /object_info : les deux formes
    de ComfyUI 0.37 — `[[a, b], {…}]` et `["COMBO", {"options": [a, b]}]`."""
    spec = (c.object_info(node).get(node) or {})["input"]["required"][field]
    if spec and spec[0] == "COMBO":
        return list((spec[1] if len(spec) > 1 else {}).get("options") or [])
    return list(spec[0]) if spec and isinstance(spec[0], list) else []


def _missing_on(ep: str) -> list[str]:
    c = Comfy(ep, timeout=20)
    missing = []
    for node, (field, name) in MODELS.items():
        try:
            if name not in _choices(c, node, field):
                missing.append(name)
        except (KeyError, IndexError, TypeError):
            missing.append(f"nœud {node}")
    try:
        vae = _choices(c, "VAELoader", "vae_name")
        missing += [v for v in VAES if v not in vae]
    except (KeyError, IndexError, TypeError):
        missing.append("nœud VAELoader")
    for node in ("Trellis2Conditioning", "Trellis2ShapeStage", "SaveGLB", "RemoveBackground", "ImageCropToMask"):
        try:
            if node not in c.object_info(node):
                missing.append(f"nœud {node}")
        except ComfyError:
            missing.append(f"nœud {node}")
    return missing


def comfy_endpoints() -> list[str]:
    """Les instances ComfyUI de la voie « image ». Une entrée `local` (une
    instance d'essai : `"image": ["local"]`) est l'ouvrier du portail
    lui-même, sans ComfyUI (`jobs.Ctx` : `comfy = None`) — on ne lui
    demande pas /object_info (avant le 29/09 : `Comfy("local")`, une URL
    sans schéma, ValueError de urllib, 500). Même règle qu'Image, Upscale
    et Vidéo (`e.startswith("http")`)."""
    return [ep for ep in (config.get("lanes") or {}).get("image", []) if str(ep).startswith("http")]


def state(req=None):
    with _state_lock:
        if time.time() - _state_cache["t"] < 60 and _state_cache["v"]:
            return _state_cache["v"]
    machines = []
    for ep in comfy_endpoints():
        up, why = jobs.endpoint_alive(ep)
        entry = {"machine": jobs.machine_of(ep), "url": ep, "up": up}
        if up:
            try:
                entry["missing"] = _missing_on(ep)
            except ComfyError as e:
                entry.update(up=False, why=str(e)[:200])
        else:
            entry["why"] = why[:200]
        machines.append(entry)
    tpl = template_path().is_file()
    ready = tpl and any(m["up"] and not m.get("missing") for m in machines)
    v = {"trellis": {"wired": wired(), "ready": ready, "template": str(template_path()), "template_ok": tpl,
                     "machines": machines, "faces": FACES, "pad_factor": 1.0},
         "views": {"model": None, "labels": list(VIEW_LABELS)}}
    with _state_lock:
        _state_cache.update(t=time.time(), v=v)
    return v


# ── les objets ──────────────────────────────────────────────
def _is_object(it: dict) -> bool:
    return it["kind"] == "element" and (it.get("element") or {}).get("type") == "object"


def objects(req):
    items = [it for it in library.query(["element"], "", None, req.q("sort", "new"), 100000)["items"] if _is_object(it)]
    return {"items": items}


def create(req):
    d = req.json()
    title = " ".join(str(d.get("title", "")).split())[:80]
    if not title:
        raise HttpError(400, "il lui faut un nom")
    src = library.get(str(d.get("item", "")))
    if not src or src["kind"] != "image":
        raise HttpError(400, "il lui faut une image de la bibliothèque")
    it = library.create_element(title, "object", str(d.get("description", ""))[:4000],
                                [{"item": src["id"], "role": "view", "label": VIEW_LABELS[0]}],
                                source={"tool": "object"}, folder=str(d.get("folder", ""))[:60])
    return library.public(it)


# ── le GLB : de quoi le dire sans l'ouvrir dans un viewer ───
def glb_stats(path: Path) -> dict:
    """Sommets, faces et encombrement d'un GLB, lus dans son JSON (glTF 2.0,
    §4.4 « GLB file format ») ; `min`/`max` de POSITION sont obligatoires."""
    with open(path, "rb") as f:
        magic, _version, _length = struct.unpack("<4sII", f.read(12))
        if magic != b"glTF":
            raise ValueError("pas un GLB")
        n, kind = struct.unpack("<I4s", f.read(8))
        if kind != b"JSON":
            raise ValueError("GLB sans JSON en tête")
        doc = json.loads(f.read(n))
    acc = doc.get("accessors", [])
    verts = faces = 0
    lo, hi = [float("inf")] * 3, [float("-inf")] * 3
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            pos = acc[prim["attributes"]["POSITION"]]
            verts += pos.get("count", 0)
            if "indices" in prim:
                faces += acc[prim["indices"]].get("count", 0) // 3
            for k in range(3):
                lo[k] = min(lo[k], (pos.get("min") or [0, 0, 0])[k])
                hi[k] = max(hi[k], (pos.get("max") or [0, 0, 0])[k])
    ext = [round(hi[k] - lo[k], 4) for k in range(3)] if verts else None
    return {"vertices": verts, "faces": faces, "extent": ext, "textures": len(doc.get("images", [])),
            "bytes": path.stat().st_size}


def attach_mesh(eid: str, glb: Path, meta: dict) -> dict:
    """Range un GLB dans le dossier de l'élément et l'inscrit dans `element.meshes`."""
    with library._lock:
        it = library.get(eid)
        if not it or not _is_object(it):
            raise KeyError(eid)
        library.check_write(it)   # au nom du propriétaire du travail : un mesh ne s'ajoute qu'à son objet
        meshes = it["element"].setdefault("meshes", [])
        n = 1 + max([int(m["file"][5:8]) for m in meshes if m.get("file", "")[5:8].isdigit()] or [0])
        name = f"mesh-{n:03d}.glb"
        shutil.move(str(glb), str(library.folder_of(eid) / name))
        entry = {"file": name, "created": library.now(), **meta}
        try:
            entry.update(glb_stats(library.folder_of(eid) / name))
        except (OSError, ValueError, KeyError, struct.error) as e:
            entry["stats_error"] = str(e)[:200]
        meshes.append(entry)
        it["updated"] = library.now()
        library._save(it)
        return entry


def check_submit(params: dict) -> None:
    """À l'entrée de `POST /api/jobs` (jobs.register(…, direct=)) : l'objet
    existe, se voit, et il est à la personne (ou Cal) — son mesh s'y ajoutera."""
    it = library.get(str(params.get("element") or ""))
    if not it or not _is_object(it):
        raise ValueError(f"objet introuvable : {params.get('element')}")
    library.check_write(it)


def _source(ctx) -> tuple[str, dict, dict]:
    eid = str(ctx.params.get("element") or "")
    it = library.get(eid)
    if not it or not _is_object(it):
        raise RuntimeError(f"objet introuvable : {eid}")
    library.check_write(it)   # revalidé au départ : le travail ne compte pas sur la route qui l'a mis en file
    refs = [r for r in it["element"]["refs"] if r.get("role") == "view"] or it["element"]["refs"]
    if not refs:
        raise RuntimeError("cet objet n'a pas d'image")
    ctx.job["thumb"] = library.public(it).get("thumb_url")
    return eid, it, refs[0]


def cube_glb(dest: Path, size: float = 1.0) -> Path:
    """Un cube gris, 24 sommets et leurs normales : le GLB de contrôle du
    mode factice (glTF 2.0, un seul tampon binaire)."""
    h = size / 2
    faces = [((1, 0, 0), [(h, -h, -h), (h, h, -h), (h, h, h), (h, -h, h)]),
             ((-1, 0, 0), [(-h, -h, h), (-h, h, h), (-h, h, -h), (-h, -h, -h)]),
             ((0, 1, 0), [(-h, h, -h), (-h, h, h), (h, h, h), (h, h, -h)]),
             ((0, -1, 0), [(-h, -h, h), (-h, -h, -h), (h, -h, -h), (h, -h, h)]),
             ((0, 0, 1), [(-h, -h, h), (h, -h, h), (h, h, h), (-h, h, h)]),
             ((0, 0, -1), [(h, -h, -h), (-h, -h, -h), (-h, h, -h), (h, h, -h)])]
    pos, nrm, idx = [], [], []
    for k, (n, quad) in enumerate(faces):
        for p in quad:
            pos += [p[0], p[1] + h, p[2]]        # posé au sol, y ≥ 0
            nrm += list(n)
        b = 4 * k
        idx += [b, b + 1, b + 2, b, b + 2, b + 3]
    pb = struct.pack(f"<{len(pos)}f", *pos)
    nb = struct.pack(f"<{len(nrm)}f", *nrm)
    ib = struct.pack(f"<{len(idx)}H", *idx)
    ib += b"\0" * (-len(ib) % 4)
    blob = pb + nb + ib
    doc = {"asset": {"version": "2.0", "generator": "showrunner objet factice"},
           "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "cube factice"}],
           "materials": [{"name": "controle", "pbrMetallicRoughness": {"baseColorFactor": [0.55, 0.57, 0.56, 1.0],
                                                                      "metallicFactor": 0.0, "roughnessFactor": 0.7}}],
           "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]}],
           "buffers": [{"byteLength": len(blob)}],
           "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(pb), "target": 34962},
                           {"buffer": 0, "byteOffset": len(pb), "byteLength": len(nb), "target": 34962},
                           {"buffer": 0, "byteOffset": len(pb) + len(nb), "byteLength": len(idx) * 2, "target": 34963}],
           "accessors": [{"bufferView": 0, "componentType": 5126, "count": 24, "type": "VEC3",
                          "min": [-h, 0.0, -h], "max": [h, size, h]},
                         {"bufferView": 1, "componentType": 5126, "count": 24, "type": "VEC3"},
                         {"bufferView": 2, "componentType": 5123, "count": len(idx), "type": "SCALAR"}]}
    js = json.dumps(doc).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    dest.write_bytes(struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js
                     + struct.pack("<I4s", len(blob), b"BIN\0") + blob)
    return dest


def run_factice(ctx):
    """Le parcours sans GPU : un cube à la place de TRELLIS.2."""
    eid, it, ref = _source(ctx)
    for k, msg in enumerate(("lit l'image choisie", "détourage · factice", "forme · factice", "texture · factice")):
        ctx.check()
        ctx.progress(0.1 + 0.2 * k, msg)
        time.sleep(0.6)
    glb = cube_glb(ctx.workdir / "cube.glb")
    entry = attach_mesh(eid, glb, {"factice": True, "job": ctx.job["id"], "machine": jobs.machine_of(ctx.endpoint),
                                   "from": ref["file"], "model": "factice · cube de contrôle, pas TRELLIS.2"})
    return {"element": eid, "mesh": entry["file"], "note": "factice : un cube, pas TRELLIS.2"}


def validate(c: Comfy, g: dict) -> list[str]:
    """Le graphe contre le schéma réel de l'instance (/object_info), avant
    l'envoi : un nœud, une entrée ou un poids absent se dit tout de suite,
    pas après le chargement de TRELLIS.2. L'image d'entrée n'est pas jugée :
    elle vient d'être déposée, sous le nom que ComfyUI a rendu."""
    problems, cache = [], {}
    for nid, node in g.items():
        ct = node["class_type"]
        if ct not in cache:
            try:
                cache[ct] = c.object_info(ct).get(ct)
            except ComfyError:
                cache[ct] = None
        spec = cache[ct]
        if not spec:
            problems.append(f"nœud absent : {ct}")
            continue
        req = (spec.get("input") or {}).get("required") or {}
        for name, conf in req.items():
            if name not in node["inputs"]:
                problems.append(f"{ct} : entrée « {name} » manquante")
                continue
            val = node["inputs"][name]
            if isinstance(val, list) or (ct == "LoadImage" and name == "image"):
                continue
            opts = None
            if isinstance(conf, list) and conf and isinstance(conf[0], list):
                opts = conf[0]
            elif isinstance(conf, list) and conf and conf[0] == "COMBO" and len(conf) > 1 and isinstance(conf[1], dict):
                opts = conf[1].get("options")
            if opts is not None and val not in opts and str(val) not in [str(o) for o in opts]:
                problems.append(f"{ct} : « {val} » absent de cette machine ({name})")
        for name, val in node["inputs"].items():
            if isinstance(val, list) and len(val) == 2 and isinstance(val[0], str) and val[0] not in g:
                problems.append(f"{ct} : « {name} » lié au nœud {val[0]}, absent du graphe")
    return problems


def stages(g: dict) -> dict[str, tuple[str, str]]:
    """Ce que fait chaque nœud long du graphe, lu dans le graphe lui-même :
    un KSampler se reconnaît à l'étage qui lui fournit son latent (structure,
    forme, forme fine, texture), les autres à leur sorte."""
    feed = {"EmptyTrellis2LatentStructure": ("structure", "échantillonne la structure"),
            "Trellis2ShapeStage": ("forme", "échantillonne la forme"),
            "Trellis2UpsampleStage": ("forme fine", "affine la forme (1536)"),
            "Trellis2TextureStage": ("texture", "échantillonne la texture")}
    kinds = {"LoadBackgroundRemovalModel": ("détourage", "charge BiRefNet"),
             "RemoveBackground": ("détourage", "détoure l'objet (BiRefNet)"),
             "ImageCropToMask": ("détourage", "recadre en carré, 1024 px"),
             "CLIPVisionLoader": ("chargement", "charge DINOv3"),
             "Trellis2Conditioning": ("chargement", "lit l'image (DINOv3)"),
             "UNETLoader": ("chargement", "charge TRELLIS.2"),
             "VAELoader": ("chargement", "charge les VAE de TRELLIS.2"),
             "VaeDecodeStructureTrellis2": ("structure", "décode la structure"),
             "VaeDecodeShapeTrellis": ("forme fine", "décode la forme"),
             "VaeDecodeTextureTrellis": ("texture", "décode la texture"),
             "RemeshMesh": ("mesh", "remaille (768)"),
             "DecimateMesh": ("mesh", f"décime à {FACES:,} faces".replace(",", " ")),
             "UnwrapMesh": ("mesh", "déplie les UV"),
             "BakeTextureFromVoxel": ("cuisson", "cuit la couleur, le métal, la rugosité"),
             "BakeNormalMapFromMesh": ("cuisson", "cuit les normales"),
             "BakeAmbientOcclusion": ("cuisson", "cuit l'occlusion"),
             "ApplyTextureToMesh": ("cuisson", "applique les textures"),
             "SaveGLB": ("mesh", "écrit le GLB")}
    out = {}
    for nid, n in g.items():
        ct = n["class_type"]
        if ct == "KSampler":
            src = (n["inputs"].get("latent_image") or [None])[0]
            out[nid] = feed.get((g.get(src) or {}).get("class_type"), ("échantillonnage", "échantillonne"))
        elif ct in kinds:
            out[nid] = kinds[ct]
    return out


# la part de chaque étape dans le temps d'un rendu, relevée sur le premier
# rendu réel (DGX1, 30/09, 159 s, poids déjà dans le cache disque : départs
# de chaque étape à 1,7 · 3,0 · 5,0 · 12,3 · 18,9 · 66,2 · 95,4 · 109,0 s,
# GLB écrit à 151 s ; chaque mesh garde les siens dans `stages_s`). L'ordre
# est celui où ComfyUI les a exécutées ; la barre ne recule jamais.
SHARE = {"détourage": 0.02, "chargement": 0.03, "structure": 0.05, "forme": 0.04, "forme fine": 0.30,
         "texture": 0.18, "mesh": 0.09, "cuisson": 0.29}
ORDER = ("détourage", "chargement", "structure", "forme", "forme fine", "texture", "mesh", "cuisson")


def run_mesh(ctx):
    if not wired():
        # verrou : aucun rendu tant que Cal n'a pas câblé la voie (Admin → Câblage)
        raise RuntimeError("TRELLIS.2 n'est pas câblé pour les objets : Admin → Câblage → "
                           "« Object Creator · TRELLIS.2 » (objet_trellis)")
    if ctx.comfy is None:
        raise RuntimeError(f"la voie « image » n'a pas de ComfyUI ici ({ctx.endpoint}) : TRELLIS.2 ne peut pas partir")
    from tools.movie import watch_progress   # le websocket de ComfyUI, lu comme Vidéo le lit (une seule vérité)

    eid, it, ref = _source(ctx)
    machine = jobs.machine_of(ctx.endpoint)
    seed = int(ctx.params.get("seed") or secrets.randbelow(2**31))
    t0 = time.time()
    ctx.progress(0.01, f"envoie « {ref.get('label') or ref['file']} » à {machine}")
    name = ctx.comfy.upload(library.path_of(it, ref["file"]), f"sr_objet_{ctx.job['id']}{Path(ref['file']).suffix.lower()}")
    ctx.check()
    g = graph(name, seed)
    ctx.progress(0.02, f"vérifie le graphe contre ComfyUI de {machine}")
    problems = validate(ctx.comfy, g)
    if problems:
        raise RuntimeError(f"TRELLIS.2 ne peut pas partir sur {machine} : " + " · ".join(problems[:6]))
    st = stages(g)
    ksteps = {nid for nid, n in g.items() if n["class_type"] == "KSampler"}
    seen: dict[str, float] = {}      # étape → secondes depuis le départ, quand elle commence

    def frac(stage: str, inner: float = 0.0) -> float:
        k = ORDER.index(stage) if stage in ORDER else 0
        before = 0.03 + sum(SHARE[s] for s in ORDER[:k]) * 0.94
        return before + SHARE.get(stage, 0) * 0.94 * max(0.0, min(1.0, inner))

    def on_msg(m):
        d = m.get("data") or {}
        nid = str(d.get("node") or "")
        if m.get("type") == "executing" and nid in st:
            stage, label = st[nid]
            seen.setdefault(stage, round(time.time() - t0, 1))
            f = frac(stage)
            ctx.progress(max(f, ctx.job.get("progress") or 0), f"{label} · {machine}")
        elif m.get("type") == "progress" and nid in ksteps and nid in st:
            stage, label = st[nid]
            v, mx = d.get("value") or 0, d.get("max") or 1
            ctx.progress(max(frac(stage, v / mx), ctx.job.get("progress") or 0), f"{label} · pas {v}/{mx} · {machine}")

    def report(state, ahead):
        if state == "wait":
            ctx.progress(message=f"attend ComfyUI de {machine} · {ahead} devant")

    stop = threading.Event()
    threading.Thread(target=watch_progress, args=(ctx.endpoint, ctx.comfy.client_id, on_msg, stop),
                     daemon=True, name="objet-ws").start()
    time.sleep(0.3)
    try:
        pid = ctx.comfy.queue(g)
        entry = ctx.comfy.wait(pid, cancelled=ctx.cancelled, report=report, timeout=3600)
    except ComfyError as e:
        raise RuntimeError(f"TRELLIS.2 sur {machine} : {e}") from e
    finally:
        stop.set()
    files = [f for f in Comfy.outputs(entry, g) if f["filename"].lower().endswith(".glb")]
    if not files:
        raise RuntimeError(f"TRELLIS.2 n'a rendu aucun GLB sur {machine} (voir le journal de ComfyUI)")
    ctx.progress(0.98, "rapatrie le GLB")
    glb = ctx.comfy.download(files[0], ctx.workdir / "trellis2.glb")
    secs = round(time.time() - t0, 1)
    entry = attach_mesh(eid, glb, {"seed": seed, "job": ctx.job["id"], "machine": machine,
                                   "from": ref["file"], "model": "TRELLIS.2 · image unique", "pad_factor": 1.0,
                                   "target_faces": FACES, "secs": secs, "stages_s": seen})
    return {"element": eid, "mesh": entry["file"], "secs": secs,
            "note": f"{entry.get('faces', '?')} faces · {secs:.0f} s sur {machine}"}


def register(app) -> None:
    app.route("GET", "/api/objet/state", state)
    app.route("GET", "/api/objet/objects", objects)
    app.route("POST", "/api/objet/objects", create)
    # lancés par la page (objet.js) sur la route commune : `check_submit` juge à l'entrée, `_source` au départ
    jobs.register("objet.mesh", run_mesh, lane="image", title="Objet · 3D", direct=check_submit, cost="gpu")
    jobs.register("objet.mesh_factice", run_factice, lane="cpu", title="Objet · 3D factice", direct=check_submit, cost="cpu")


# ── le contrôle, sans GPU ───────────────────────────────────
def selftest(call, ok) -> None:
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (120, 80, 40)).save(buf, "PNG")
    st, img = call("PUT", "/api/library/upload?name=botte.png&title=Botte", raw=buf.getvalue())
    st, o = call("POST", "/api/objet/objects", {"title": "Botte", "description": "une botte", "item": img["id"]})
    ok(st == 200 and o["element"]["type"] == "object" and o["element"]["refs"][0]["role"] == "view",
       f"objet : un élément objet, son image en vue de face ({st} {o})")
    st, bad = call("POST", "/api/objet/objects", {"title": "", "item": img["id"]})
    ok(st == 400, "objet : un objet sans nom est refusé")
    st, lst = call("GET", "/api/objet/objects")
    ok(st == 200 and any(x["id"] == o["id"] for x in lst["items"]), "objet : la liste des objets")
    st, s = call("GET", "/api/objet/state")
    ok(st == 200 and "trellis" in s and s["views"]["model"] is None, "objet : l'état de la chaîne (aucun modèle de vues)")
    # une voie « image » locale (instance d'essai) : pas de ComfyUI à interroger, pas de 500
    lanes = config.CFG.get("lanes")
    config.CFG["lanes"] = {**(lanes or {}), "image": ["local"]}
    _state_cache.update(t=0.0, v=None)
    try:
        st, s2 = call("GET", "/api/objet/state")
    finally:
        config.CFG["lanes"] = lanes
        _state_cache.update(t=0.0, v=None)
    ok(st == 200 and s2["trellis"]["machines"] == [] and s2["trellis"]["ready"] is False,
       f"objet : une voie image « local » ne fait pas un 500 ({st})")
    if template_path().is_file():
        g = graph("sr_test.png", 7)
        crop = [n for n in g.values() if n["class_type"] == "ImageCropToMask"]
        ok(crop and crop[0]["inputs"]["pad_factor"] == 1.0, "objet : pad_factor 1,0 (TRELLIS.2)")
        ok(any(n["class_type"] == "LoadImage" and n["inputs"]["image"] == "sr_test.png" for n in g.values()),
           "objet : l'image entre par REF 1")
        ok(all("{{" not in json.dumps(n) for n in g.values()), "objet : le gabarit est rempli")
        ok(any(n["class_type"] == "KSampler" and n["inputs"]["seed"] == 7 for n in g.values()), "objet : la graine")
        stg = stages(g)
        ks = sorted(stg[nid][0] for nid, n in g.items() if n["class_type"] == "KSampler")
        ok(ks == sorted(["structure", "forme", "forme fine", "texture"]),
           f"objet : chaque KSampler reconnu par l'étage qui le nourrit ({ks})")

        class _Faux:   # un /object_info réduit : le nœud UNETLoader absent, un poids VAE absent
            def object_info(self, node):
                if node == "UNETLoader":
                    return {}
                if node == "VAELoader":
                    return {node: {"input": {"required": {"vae_name": [["trellis_2_shape_vae_bf16.safetensors"]]}}}}
                return {node: {"input": {"required": {}}}}
        probs = validate(_Faux(), g)
        ok(any("UNETLoader" in p for p in probs) and any("trellis_2_texture_vae_bf16" in p for p in probs)
           and not any("LoadImage" in p for p in probs), f"objet : le graphe jugé contre /object_info avant l'envoi ({probs})")
    else:
        print(f"  (gabarit absent ici : {template_path()} — le graphe n'est pas contrôlé)")
    # un GLB minimal : un triangle, POSITION avec min/max
    body = json.dumps({"asset": {"version": "2.0"}, "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
                       "accessors": [{"count": 3, "min": [0, 0, 0], "max": [1, 2, 0.5], "type": "VEC3", "componentType": 5126},
                                     {"count": 3, "type": "SCALAR", "componentType": 5123}]}).encode()
    body += b" " * (-len(body) % 4)
    raw = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(body)) + struct.pack("<I4s", len(body), b"JSON") + body
    tmp = config.data_dir() / "objet_selftest.glb"
    tmp.write_bytes(raw)
    entry = attach_mesh(o["id"], tmp, {"seed": 1})
    ok(entry["file"] == "mesh-001.glb" and entry["faces"] == 1 and entry["extent"] == [1, 2, 0.5],
       f"objet : un GLB rangé dans l'élément, lu ({entry})")
    st, again = call("GET", f"/api/library/{o['id']}")
    ok(again["element"].get("meshes", [{}])[0].get("file") == "mesh-001.glb", "objet : le mesh se voit dans l'élément")
    st, raw2 = call("GET", f"/library/{o['id']}/mesh-001.glb")
    ok(st == 200 and isinstance(raw2, bytes) and raw2[:4] == b"glTF", "objet : le GLB se sert")
    st, j = call("POST", "/api/jobs", {"kind": "objet.mesh", "params": {"element": o["id"]}, "title": "essai"})
    ok(st == 200 and j["state"] == "queued" and j["lane"] == "image", "objet : le travail 3D se met en file (voie image)")
    call("POST", f"/api/jobs/{j['id']}/cancel")
    ok(not wired() or config.get("objet_trellis") is True, "objet : TRELLIS.2 ne part que câblé")
    st, j = call("POST", "/api/jobs", {"kind": "objet.mesh_factice", "params": {"element": o["id"]}, "title": "factice"})
    for _ in range(60):
        st, j = call("GET", f"/api/jobs/{j['id']}")
        if j["state"] in ("done", "error"):
            break
        time.sleep(0.25)
    ok(j["state"] == "done" and j["result"].get("mesh") == "mesh-002.glb", f"objet : le parcours factice va au bout ({j.get('state')} {j.get('message')})")
    st, again = call("GET", f"/api/library/{o['id']}")
    m = again["element"]["meshes"][-1]
    ok(m.get("factice") is True and m.get("faces") == 12 and m.get("extent") == [1.0, 1.0, 1.0],
       f"objet : le cube factice est marqué et lu ({m})")
