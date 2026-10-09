"""L'atelier d'édition d'Image (Cal, 30/09 : « l'édition est un ATELIER en
soi : on travaille avec l'image toujours sous les yeux en grand, et à droite
un carrousel vertical avec les essais de variation »). La page :
`image/atelier/`. L'outil Image (`image.py`) reste la création ; ses graphes
d'édition, sa validation des réglages et son moteur factice servent ici tels
quels (`check_edit`, `stub_edit`, `_real_edit`, `compose`) : une seule vérité.

Une SESSION par image source et par Workspace (un document d'outil, comme un
projet ODIO : `owner`, `space`, jugés par core/library.py) :

  <data>/image_atelier/<sid>.json      la session : la source, la base courante,
                                       ce qu'on regarde, le brouillon du prompt,
                                       les essais (prompt, réglages, zone, date,
                                       qui), les validations
  <data>/image_atelier/<sid>/e<n>.png  le fichier d'un essai, et sa vignette

Les essais ne sont PAS des objets de la bibliothèque (Cal : « on ne garde pas
tout le versioning, ça alourdit la bibliothèque ») : « Valider » en fait UN
objet, neuf, avec sa lignée (`parents` : la source, puis les références) —
l'usage du portail, où une version publiée ne se réécrit jamais
(library._frozen, server/tools/elements.py). Une source qui est la version
d'un élément se publie ensuite comme version suivante par la route des
éléments (la page le propose).

« Éditer » sur une image rouvre sa session : celle dont elle est la source,
ou celle d'où elle a été validée (`params.atelier`).

Le nettoyage (une règle, dite dans la page) :
  - une session gardée au plus `image_atelier_files` (48) fichiers d'essai :
    au-delà, les plus anciens perdent leur fichier — jamais la base, ni ce
    qu'on regarde, ni la base d'un essai en cours ; leur ligne reste (prompt,
    date, réglages) ;
  - une session sans geste depuis `image_atelier_days` (30) jours perd tous
    ses fichiers d'essai (les lignes restent) ; si sa source a quitté la
    bibliothèque, la session part entière.
Ce qui a été validé est dans la bibliothèque : le nettoyage n'y touche jamais.

Le pinceau : UNE zone, une consigne, par essai. Aucun modèle installé ne
prend de masque (TextEncodeQwenImage21, Krea2EditModelPatch : aucune entrée
de masque) ; la zone est notre méthode (la boîte autour de la zone, éditée,
recollée par le masque adouci — image.py, zone_box / paste_zone), qui borne
un seul rectangle. Le README de Qwen-Image 2.1 montre « Circle-guided
multi-region editing » en vitrine, sans mode d'emploi : non documenté, donc
pas de zones de plusieurs couleurs. Plusieurs changements : des essais qui
s'enchaînent (« Partir de cet essai »).

Routes :
  GET  /api/image/atelier/config               les intentions (et leurs sources), la règle de nettoyage
  GET  /api/image/atelier                      les sessions du Workspace, la plus récente d'abord
  POST /api/image/atelier/open {item}          la session de cette image (la reprend, ou la crée)
  GET  /api/image/atelier/{sid}                la session (l'état des essais en cours lu dans la file)
  POST /api/image/atelier/{sid} {draft?, base?, view?}   où on en est (enregistré seul, par la page)
  POST /api/image/atelier/{sid}/run {…}        un essai (ou n) : jobs.submit, sorte « image.atelier »
  POST /api/image/atelier/{sid}/validate {trial}         l'essai devient un objet de la bibliothèque
  POST /api/image/atelier/{sid}/forget {trial} retirer un essai de l'historique
  GET  /api/image/atelier/{sid}/f/{name}       le fichier d'un essai, sa vignette, sa zone
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import threading
import time
from datetime import datetime
from pathlib import Path

from core import auth, config, jobs, library
from core.http import FileResponse, HttpError
from tools import image as IM

KIND = "image.atelier"
SID_RX = re.compile(r"^atl-[0-9a-f]{12}$")
TID_RX = re.compile(r"^e[1-9]\d{0,4}$")
FILE_RX = re.compile(r"^(e[1-9]\d{0,4})(\.t)?\.png$")
KEEP_FILES = 48
KEEP_DAYS = 30
TOOLS = [t for t, v in IM.EDIT_TOOLS.items() if not v.get("off")]

_lock = threading.RLock()
_swept = [0.0]


# ── les intentions : facultatives, elles pré-remplissent le prompt ──
# Chaque modèle de phrase dit sa source ; « model » : le seul modèle qui sait
# le faire (et pourquoi) ; « tool » : un autre graphe que la consigne.
INTENTS: list[dict] = [
    {"id": "detail", "name": "Détail", "about": "changer un détail, une couleur, une matière",
     "templates": {"qwen21": "Change the … in <image1> to …; keep everything else unchanged.",
                   "krea2": "Recolor the … to …"},
     "src": "README Qwen-Image 2.1 (« change hair color ») ; README comfyui-krea2edit (« recolor the car to matte black »)"},
    {"id": "light", "name": "Lumière", "about": "rééclairer : d'où vient la lumière, sa dureté",
     "templates": {"qwen21": "Relight the scene with …; keep everything else unchanged.",
                   "krea2": "Relight the scene with …; keep everything else unchanged."},
     "lights": True,
     "src": "les consignes « Relight the scene… » des pastilles de lumière (image.py, LOOKS, lumière)"},
    {"id": "style", "name": "Style", "about": "un autre rendu ; une image de référence donne le style",
     "templates": {"qwen21": "Restyle <image1> as …; keep the composition and the subject unchanged.",
                   "qwen21_ref": "Restyle <image1> in the style of <image2>; keep the composition and the subject unchanged.",
                   "krea2": "Restyle the image as …; keep the composition and the subject unchanged."},
     "ref": "le style", "ref_model": "qwen21",
     "ref_why": "une image de style s'adresse par <image2> : Qwen-Image 2.1 (Krea 2 ne prend qu'un sujet en 2ᵉ entrée)",
     "src": "Krea 2 : README comfyui-krea2edit (« restyles », Turbo) ; Qwen 2.1 : les références <imageN> (README) — "
            "le transfert de style par une image n'y est pas documenté : à juger au banc"},
    {"id": "add", "name": "Ajouter", "about": "ajouter une chose ; une image de l'objet (des lunettes…) le montre",
     "templates": {"qwen21": "Add … to <image1>; keep everything else unchanged.",
                   "qwen21_ref": "Add the … from <image2> to <image1>, …; keep the original background and original lighting.",
                   "krea2": "Add … to the scene; keep everything else unchanged."},
     "ref": "l'objet", "ref_model": "qwen21",
     "ref_why": "un objet d'une autre image s'adresse par <image2> : Qwen-Image 2.1 (Krea 2 : une personne en 2ᵉ entrée, "
                "d'après sa fiche)",
     "src": "gabarit officiel Qwen 2.1 (« Add the … from <image2> ») ; README comfyui-krea2edit (« add/insert »)"},
    {"id": "remove", "name": "Retirer", "about": "retirer une chose — peignez la zone",
     "templates": {"qwen21": "Remove … from <image1>; keep everything else unchanged."},
     "model": "qwen21",
     "model_why": "Krea 2 Turbo ne retire pas : « Removals … need … the Raw model at CFG 3 » (README comfyui-krea2edit) — "
                  "Krea Raw n'est pas installé",
     "zone": True, "src": "README Qwen-Image 2.1 (« remove watch »)"},
    {"id": "background", "name": "Fond", "about": "changer le fond, ou le retirer (fond transparent)",
     "choices": [
         {"id": "change", "label": "Changer le fond", "tool": "instruct",
          "templates": {"qwen21": "Change the background to …", "krea2": "Change the background to …"},
          "src": "README Qwen-Image 2.1 (« Change the background to a sunset beach »)"},
         {"id": "matte", "label": "Retirer le fond", "tool": "matte", "sub": "BIREFNET",
          "src": "BiRefNet (gabarit utility_birefnet_remove_background ; Character Factory)"}]},
    {"id": "extend", "name": "Étendre", "about": "agrandir le cadre (outpaint)", "off": IM.EDIT_TOOLS["extend"]["off"]},
]


# ── le rangement ────────────────────────────────────────────
def root() -> Path:
    p = config.data_dir() / "image_atelier"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _json(sid: str) -> Path:
    return root() / f"{sid}.json"


def _dir(sid: str) -> Path:
    return root() / sid


def _read(sid: str) -> dict | None:
    if not SID_RX.fullmatch(sid or ""):
        return None
    try:
        return json.loads(_json(sid).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write(s: dict) -> None:
    f = _json(s["id"])
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, f)


def _all() -> list[dict]:
    out = []
    for f in root().glob("atl-*.json"):
        s = _read(f.stem)
        if s:
            out.append(s)
    return out


def _ts(iso: str) -> float:
    try:
        return datetime.fromisoformat(iso).timestamp()
    except (TypeError, ValueError):
        return 0.0


def keep_files() -> int:
    return max(4, int(config.get("image_atelier_files", KEEP_FILES) or KEEP_FILES))


def keep_days() -> float:
    return max(1.0, float(config.get("image_atelier_days", KEEP_DAYS) or KEEP_DAYS))


def _trial(s: dict, tid: str) -> dict | None:
    return next((t for t in s.get("trials", []) if t["id"] == tid), None)


def _has_file(s: dict, tid: str) -> bool:
    t = _trial(s, tid)
    return bool(t and t.get("file") and (_dir(s["id"]) / t["file"]).is_file())


# ── les droits : un document d'outil, jugé par la bibliothèque ──
def _session_or_404(sid: str, *, show: bool = False) -> dict:
    s = _read(sid)
    # `show` : montrer un fichier (comme une vignette de la bibliothèque, tous
    # Workspaces qu'on voit) ; sinon s'en servir : le Workspace de la requête
    if not s or not (library.visible(s) if show else library.readable(s)):
        raise HttpError(404, "session d'atelier introuvable")
    return s


def _write_why(s: dict) -> str:
    try:
        library.check_write(s)
        return ""
    except PermissionError as e:
        return str(e)


def _compute_why(s: dict) -> str:
    """La garde du calcul, dite d'avance à la page (jobs.submit juge de même)."""
    u = auth.current()
    why = auth.compute_refusal(u, library.space_of(s), jobs.cost_of(KIND, {}))
    return why or ""


# ── ce que la page voit ─────────────────────────────────────
def _furl(s: dict, name: str, v: str = "") -> str:
    return f"api/image/atelier/{s['id']}/f/{name}" + (f"?v={v}" if v else "")


def _live(s: dict) -> bool:
    """L'état des essais pas encore rendus, lu dans la file ; un échec s'y
    inscrit (la ligne reste, avec son message). Rend vrai si la session a changé."""
    changed = False
    for t in s.get("trials", []):
        if t.get("state") not in ("queued", "running"):
            continue
        j = jobs.get(t.get("job") or "")
        if not j:
            t.update(state="error", message="le travail a quitté la file")
            changed = True
        elif j["state"] in ("queued", "running"):
            t["progress"], t["live"] = j.get("progress"), j.get("message") or ""
        elif j["state"] in ("error", "cancelled", "interrupted"):
            t.update(state="error" if j["state"] != "cancelled" else "cancelled", message=j.get("message") or j["state"])
            t.pop("progress", None)
            t.pop("live", None)
            changed = True
    return changed


def public_trial(s: dict, t: dict) -> dict:
    out = {k: v for k, v in t.items() if k not in ("file", "thumb", "v")}
    ok = _has_file(s, t["id"])
    if ok:
        out["url"] = _furl(s, t["file"], t.get("v", ""))
        out["thumb_url"] = _furl(s, t.get("thumb") or t["file"], t.get("v", ""))
    elif t.get("validated"):
        it = library.see(t["validated"])   # le fichier nettoyé : l'image validée se montre à sa place
        if it:
            pub = library.public(it)
            out["thumb_url"], out["url"] = pub.get("thumb_url") or pub.get("url"), pub.get("url")
    out["has_file"] = ok
    if t.get("mask"):
        out["mask_url"] = _furl(s, t["mask"])
    out["by_name"] = auth.display_name(t.get("by")) if t.get("by") else ""
    return out


def public(s: dict) -> dict:
    src = library.get(s["source"])
    out = {k: v for k, v in s.items() if k not in ("trials",)}
    out["trials"] = [public_trial(s, t) for t in s.get("trials", [])]
    out["source_item"] = library.public(src) if src else None
    out["source_why"] = "" if src else "l'image d'origine a quitté la bibliothèque (corbeille ?) : plus d'essai possible"
    out["write_why"] = _write_why(s)
    out["compute_why"] = _compute_why(s)
    out["owner_name"] = auth.display_name(s.get("owner")) if s.get("owner") else ""
    out["keep"] = {"files": keep_files(), "days": keep_days()}
    return out


# ── retrouver, ouvrir ───────────────────────────────────────
def find_for(it: dict) -> dict | None:
    """La session d'une image : celle d'où elle a été validée, sinon celle dont
    elle est la source — parmi celles que la personne lit dans ce Workspace."""
    sid = str((it.get("params") or {}).get("atelier") or "")
    s = _read(sid) if sid else None
    if s and library.readable(s):
        return s
    mine = [x for x in _all() if x.get("source") == it["id"] and library.readable(x)]
    return max(mine, key=lambda x: x.get("updated", "")) if mine else None


def open_for(item_id: str) -> tuple[dict, bool]:
    it = library.get(item_id or "")
    if not it:
        raise HttpError(404, "image introuvable dans ce Workspace")
    if it["kind"] == "element":
        head = library.resolve(it)   # un élément versionné : sa dernière version, si c'est une image
        if head and head.get("kind") == "image":
            it = head
    if it["kind"] != "image":
        raise HttpError(400, f"« {it.get('title') or it['id']} » n'est pas une image : l'atelier édite une image")
    with _lock:
        s = find_for(it)
        if s:
            return s, False
        now = library.now()
        s = {"id": "atl-" + secrets.token_hex(6), "source": it["id"], "created": now, "updated": now,
             "base": "src", "view": "src", "n": 0, "draft": {}, "trials": [], "validated": []}
        library.stamp(s, source=it)   # le Workspace de la source ; PermissionError si l'on n'y crée pas
        _write(s)
        return s, True


# ── le brouillon : où on en est ─────────────────────────────
def _draft(d) -> dict:
    """Le brouillon de la barre, nettoyé : ce que la page relit en revenant."""
    if not isinstance(d, dict):
        raise ValueError("draft : un objet")
    out: dict = {}
    if "prompt" in d:
        out["prompt"] = str(d["prompt"] or "")[:6000]
    if d.get("model") in ("qwen21", "krea2"):
        out["model"] = d["model"]
    if d.get("tool") in TOOLS:
        out["tool"] = d["tool"]
    if isinstance(d.get("intent"), str) and (d["intent"] == "" or any(i["id"] == d["intent"] for i in INTENTS)):
        out["intent"] = d["intent"]
    if "refs" in d:
        refs = []
        for r in (d.get("refs") or [])[:IM.REFS_CAP - 1]:
            r = {"item": r} if isinstance(r, str) else r
            if isinstance(r, dict) and isinstance(r.get("item"), str) and library.ID_RE.fullmatch(r["item"]):
                refs.append({"item": r["item"], **({"ref": str(r["ref"])[:120]} if r.get("ref") else {})})
        out["refs"] = refs
    if "looks" in d:
        out["looks"] = IM._looks(d.get("looks"))
    if "keep_face" in d:
        out["keep_face"] = bool(d["keep_face"])
    if "count" in d:
        out["count"] = IM._int(d["count"], 1, 4, "nombre d'essais")
    if "factor" in d:
        out["factor"] = 4 if d["factor"] == 4 else 2
    if "denoise" in d:
        try:
            out["denoise"] = min(0.5, max(0.1, round(float(d["denoise"]), 2)))
        except (TypeError, ValueError) as e:
            raise ValueError("débruitage : un nombre") from e
    for k, lst in (("azimuth", IM.ANGLE_AZIMUTH), ("elevation", IM.ANGLE_ELEVATION), ("distance", IM.ANGLE_DISTANCE)):
        if d.get(k) in dict(lst):
            out[k] = d[k]
    return out


def _pointer(s: dict, v) -> str:
    """« src » ou un essai qui a son fichier (la base, ce qu'on regarde)."""
    if v == "src":
        return "src"
    if isinstance(v, str) and TID_RX.fullmatch(v) and _has_file(s, v):
        return v
    raise ValueError("cet essai n'a plus de fichier (nettoyé, ou pas encore rendu)")


def save(sid: str, d: dict) -> dict:
    with _lock:
        s = _session_or_404(sid)
        library.check_write(s)
        if "draft" in d:
            s["draft"] = {**(s.get("draft") or {}), **_draft(d["draft"])}
        if "base" in d:
            s["base"] = _pointer(s, d["base"])
        if "view" in d:
            s["view"] = _pointer(s, d["view"])
        s["updated"] = library.now()
        _write(s)
        return s


# ── un essai ────────────────────────────────────────────────
def _base_path(s: dict, base: str, src: dict) -> Path:
    if base == "src":
        return library.path_of(src)
    t = _trial(s, base)
    if not t or not _has_file(s, base):
        raise ValueError("la base n'a plus de fichier (nettoyée) : repartez de l'original ou d'un autre essai")
    return _dir(s["id"]) / t["file"]


def run(sid: str, d: dict) -> dict:
    """Un essai (ou `count`) : la recette jugée par image.check_edit (la source de
    la session en garantit l'existence), l'essai rendu depuis `base`."""
    from PIL import Image
    s = _session_or_404(sid)
    library.check_write(s)
    # la garde du calcul avant d'écrire quoi que ce soit (un masque, un essai)
    why = _compute_why(s)
    if why:
        raise HttpError(403, f"{why} (« {KIND} », calcul {jobs.cost_of(KIND, {})})")
    src = library.get(s["source"])
    if not src:
        raise HttpError(409, "l'image d'origine a quitté la bibliothèque (corbeille ?) : plus d'essai possible")
    try:
        base = _pointer(s, d.get("base") or s.get("base") or "src")
        with Image.open(_base_path(s, base, src)) as im:
            bw, bh = im.size
        p = IM.check_edit({**d, "source": src["id"]})
        count = IM._int(d.get("count", 1), 1, 4, "nombre d'essais")
        if p["tool"] == "upscale" and max(bw, bh) * p["factor"] > 8192:
            raise ValueError(f"trop grand : {bw}×{bh} ×{p['factor']} dépasserait 8192 px")
        intent = d.get("intent") if any(i["id"] == d.get("intent") for i in INTENTS) else ""
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    pin = IM._pin_for(IM._cap_edit(p))
    n = count if p["tool"] in ("instruct", "angle", "refine") else 1
    title = (src.get("title") or src["id"])[:48]
    with _lock:
        s = _session_or_404(sid)
        made = []
        for k in range(n):
            s["n"] = int(s.get("n") or 0) + 1
            tid = f"e{s['n']}"
            pk = {**p, "seed": (p["seed"] + k) % IM.MAX_SEED, "atelier": sid, "trial": tid, "base": base}
            j = jobs.submit(KIND, pk, title=f"Atelier · {title}", tool="image", pin=pin)
            t = {"id": tid, "n": s["n"], "created": library.now(), "by": auth.current_id(), "base": base,
                 "tool": p["tool"], "model": p.get("model", ""), "prompt": d.get("prompt") if p["tool"] == "instruct" else p.get("prompt", ""),
                 "intent": intent, "seed": pk["seed"], "job": j["id"], "state": "queued",
                 "base_size": [bw, bh]}
            for key in ("looks", "keep_face", "refs", "refs_held", "mask", "factor", "denoise", "azimuth", "elevation", "distance"):
                if key in p:
                    t[key] = p[key]
            s["trials"].append(t)
            made.append(tid)
        s["base"] = base
        s["updated"] = library.now()
        _write(s)
    return {"trials": made, "session": s}


def _thumb(src: Path, dest: Path, side: int = 360) -> None:
    from PIL import Image
    with Image.open(src) as im:
        im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
        im.thumbnail((side, side), Image.LANCZOS)
        im.save(dest)


def run_job(ctx) -> dict:
    """Le travail « image.atelier » : l'édition d'image.py, depuis la base de la
    session ; le fichier va dans la session, pas dans la bibliothèque."""
    from PIL import Image
    p = ctx.params
    sid, tid = p["atelier"], p["trial"]
    with _lock:
        s = _read(sid)
        if not s:
            raise RuntimeError("la session d'atelier a disparu")
        t = _trial(s, tid)
        if t:   # une relance (la file) : l'essai suit le nouveau travail
            t.update(job=ctx.job["id"], state="running")
            t.pop("message", None)
            _write(s)
    src = library.get(s["source"])
    if not src:
        raise RuntimeError("l'image d'origine a quitté la bibliothèque")
    t0 = time.time()
    base_path = _base_path(s, p.get("base") or "src", src)
    with Image.open(base_path) as im:
        w0, h0 = im.size
    tool = p["tool"]
    refs = [IM._ref(r) for r in p.get("refs", [])] if tool == "instruct" else []
    prompt_sent, notes = "", []
    if tool == "instruct":
        comp = IM.compose(p["model"], p["prompt"], p.get("looks"), refs, mode="edit", keep_face=p.get("keep_face"))
        prompt_sent, notes = comp["prompt"], comp["notes"]
        model_id = p["model"] + "-edit" + ("-zone" if p.get("mask") else "")
    elif tool == "refine":
        prompt_sent, model_id = p.get("prompt") or "", "zimage-refine"
    elif tool == "angle":
        prompt_sent, model_id = IM.angle_prompt(p), "qwen-edit-2511-angles"
    else:
        model_id = {"matte": "birefnet", "upscale": "seedvr2"}[tool]
    ctx.progress(0.02, "prépare")
    out = ctx.workdir / "out.png"
    if IM.backend() == "stub":
        IM.stub_edit(ctx, p, base_path, out, prompt_sent, refs)
        model_id += "-factice"
    else:
        out = IM._real_edit(ctx, p, base_path, (w0, h0), refs, prompt_sent)
    secs = round(time.time() - t0, 1)
    d = _dir(sid)
    d.mkdir(parents=True, exist_ok=True)
    name = f"{tid}.png"
    with Image.open(out) as im:
        im.save(d / name)
        w, h = im.size
    _thumb(d / name, d / f"{tid}.t.png")
    with _lock:
        s = _read(sid)
        if not s:
            raise RuntimeError("la session d'atelier a disparu")
        t = _trial(s, tid)
        if t is None:   # l'essai a été retiré pendant le rendu : rien à garder
            (d / name).unlink(missing_ok=True)
            (d / f"{tid}.t.png").unlink(missing_ok=True)
            return {"note": "essai retiré pendant le rendu", "atelier": sid}
        t.update(state="done", file=name, thumb=f"{tid}.t.png", v=secrets.token_hex(3), width=w, height=h,
                 render_s=secs, prompt_sent=prompt_sent, notes=notes, model_id=model_id, backend=IM.backend(),
                 finished=library.now(), machine=jobs.machine_of(ctx.endpoint))
        for k in ("progress", "live", "message", "purged"):
            t.pop(k, None)
        trim(s)
        s["updated"] = library.now()
        _write(s)
    return {"note": f"Atelier · {IM.EDIT_TOOLS[tool]['name']} · {secs} s", "seconds": secs, "atelier": sid, "trial": tid}


# ── valider : l'essai devient UN objet de la bibliothèque ───
def _chain(s: dict, t: dict) -> list[dict]:
    """Les essais de l'original jusqu'à `t` (la base de chacun)."""
    out, cur, seen = [], t, set()
    while cur and cur["id"] not in seen:
        seen.add(cur["id"])
        out.append(cur)
        cur = _trial(s, cur.get("base")) if cur.get("base") and cur["base"] != "src" else None
    return list(reversed(out))


RECIPE = ("tool", "model", "prompt", "looks", "keep_face", "refs", "refs_held", "mask", "seed", "factor", "denoise",
          "azimuth", "elevation", "distance")


def validate(sid: str, tid: str) -> tuple[dict, dict]:
    with _lock:
        s = _session_or_404(sid)
        library.check_write(s)
        t = _trial(s, tid or "")
        if not t:
            raise HttpError(404, "essai introuvable")
        old = library.get(t.get("validated") or "")
        if old:   # déjà validé : le même objet, pas un double
            return old, s
        if not _has_file(s, tid):
            raise HttpError(409, "cet essai n'a plus de fichier (nettoyé) : il ne se valide plus")
        src = library.get(s["source"])
        if not src:
            raise HttpError(409, "l'image d'origine a quitté la bibliothèque : la lignée n'aurait plus de source")
        chain = _chain(s, t)
        recipe = {k: t[k] for k in RECIPE if k in t}
        if len(chain) == 1 and t.get("base") == "src":
            # une étape depuis l'original : la recette d'image.edit, rejouable (Recréer, Réutiliser)
            params = {"job": "image.edit", **recipe, "source": src["id"], "atelier": sid, "trial": tid}
        else:
            params = {"job": "image.atelier", "source": src["id"], "atelier": sid, "trial": tid, "prompt": t.get("prompt", ""),
                      "steps": [{k: c[k] for k in ("id", "tool", "model", "prompt", "seed", "intent") if c.get(k) not in (None, "")}
                                for c in chain]}
        name = src.get("title") or src["id"]
        name = name if len(name) <= 42 else name[:40].rstrip() + "…"
        label = IM._title(t["prompt"], 5) if t.get("prompt") else IM.EDIT_TOOLS[t["tool"]]["name"].lower()
        parents = [src["id"]] + [r["item"] for r in t.get("refs", []) if isinstance(r, dict) and r.get("item")]
        tmp = root() / f".valider-{secrets.token_hex(4)}.png"
        shutil.copyfile(_dir(sid) / t["file"], tmp)
        try:
            it = library.add_file(tmp, kind="image", title=f"{name} · {label}", prompt=t.get("prompt_sent") or t.get("prompt") or "",
                                  params=params, parents=parents, move=True,
                                  origin={"tool": "image", "model": t.get("model_id") or t["tool"], "backend": t.get("backend", ""),
                                          "atelier": sid, "machine": t.get("machine", "")},
                                  extra={"render_s": t.get("render_s")} if t.get("render_s") else None)
        finally:
            tmp.unlink(missing_ok=True)
        t["validated"] = it["id"]
        s.setdefault("validated", []).append({"item": it["id"], "trial": tid, "at": library.now(), "by": auth.current_id()})
        s["updated"] = library.now()
        _write(s)
        return it, s


def forget(sid: str, tid: str) -> dict:
    with _lock:
        s = _session_or_404(sid)
        library.check_write(s)
        t = _trial(s, tid or "")
        if not t:
            raise HttpError(404, "essai introuvable")
        if t.get("state") in ("queued", "running") and t.get("job"):
            try:
                jobs.cancel(t["job"])
            except KeyError:
                pass
        _drop_files(s, t)
        s["trials"] = [x for x in s["trials"] if x["id"] != tid]
        # ce qui partait de lui repart de l'original ; la base, la vue aussi
        for k in ("base", "view"):
            if s.get(k) == tid:
                s[k] = "src"
        s["updated"] = library.now()
        _write(s)
        return s


# ── le nettoyage ────────────────────────────────────────────
def _drop_files(s: dict, t: dict) -> None:
    for name in (t.get("file"), t.get("thumb")):
        if name:
            (_dir(s["id"]) / name).unlink(missing_ok=True)
    t.pop("file", None)
    t.pop("thumb", None)


def trim(s: dict) -> int:
    """Au-delà de `keep_files()` fichiers : les plus anciens perdent le leur
    (jamais la base, ni ce qu'on regarde, ni la base d'un essai en cours) ;
    leur ligne reste, marquée `purged`. Rend le nombre de fichiers retirés."""
    keep = {s.get("base"), s.get("view")} | {x.get("base") for x in s.get("trials", []) if x.get("state") in ("queued", "running")}
    have = [t for t in s.get("trials", []) if t.get("file")]
    extra = len(have) - keep_files()
    n = 0
    for t in sorted(have, key=lambda x: x.get("n", 0)):
        if extra <= 0:
            break
        if t["id"] in keep:
            continue
        _drop_files(s, t)
        t["purged"] = library.now()
        extra -= 1
        n += 1
    return n


def sweep(now: float | None = None) -> dict:
    """Les sessions sans geste depuis `keep_days()` jours : leurs fichiers d'essai
    partent (les lignes restent) ; leur source partie, elles partent entières."""
    now = time.time() if now is None else now
    out = {"purged": 0, "deleted": 0}
    limit = keep_days() * 86400
    with _lock:
        for s in _all():
            if now - _ts(s.get("updated", "")) <= limit:
                continue
            # le socle (aucune personne) voit toute la bibliothèque : la source existe-t-elle encore ?
            u, sp = auth.current(), auth.current_space()
            auth.set_current(None)
            auth.set_current_space(None)
            try:
                alive = library.get(s.get("source") or "") is not None
            finally:
                auth.set_current(u)
                auth.set_current_space(sp)
            if not alive:
                _json(s["id"]).unlink(missing_ok=True)
                shutil.rmtree(_dir(s["id"]), ignore_errors=True)
                out["deleted"] += 1
                continue
            touched = False
            for t in s.get("trials", []):
                if t.get("file") and t.get("state") not in ("queued", "running"):
                    _drop_files(s, t)
                    t["purged"] = library.now()
                    out["purged"] += 1
                    touched = True
            if touched:
                s["base"] = s["view"] = "src"
                _write(s)   # `updated` reste : le nettoyage n'est pas un geste
    _swept[0] = now
    return out


def _sweep_soon() -> None:
    if time.time() - _swept[0] > 3600:
        try:
            sweep()
        except OSError:
            pass


# ── les routes ──────────────────────────────────────────────
def r_config(req) -> dict:
    return {"intents": INTENTS, "tools": TOOLS, "keep": {"files": keep_files(), "days": keep_days()},
            "zones": "une zone par essai : la boîte autour de la zone est éditée puis recollée (image.py) ; "
                     "aucun modèle installé ne prend de masque, plusieurs zones ne sont pas documentées"}


def r_list(req) -> dict:
    _sweep_soon()
    out = []
    for s in sorted((x for x in _all() if library.readable(x)), key=lambda x: x.get("updated", ""), reverse=True)[:60]:
        src = library.see(s["source"])
        last = next((t for t in reversed(s.get("trials", [])) if _has_file(s, t["id"])), None)
        out.append({"id": s["id"], "source": s["source"], "title": (src or {}).get("title") or s["source"],
                    "thumb_url": _furl(s, last["thumb"], last.get("v", "")) if last else (library.public(src).get("thumb_url") if src else ""),
                    "source_thumb_url": library.public(src).get("thumb_url") if src else "",
                    "updated": s.get("updated"), "trials": len(s.get("trials", [])), "validated": len(s.get("validated", [])),
                    "gone": not src})
    return {"sessions": out}


def r_open(req) -> dict:
    d = req.json()
    s, new = open_for(str(d.get("item") or ""))
    if _live(s):
        with _lock:
            _write(s)
    return {**public(s), "created_now": new}


def r_get(req, sid) -> dict:
    s = _session_or_404(sid)
    if _live(s):
        with _lock:
            cur = _read(sid)
            if cur:
                _live(cur)
                _write(cur)
                s = cur
    return public(s)


def r_save(req, sid) -> dict:
    try:
        return public(save(sid, req.json()))
    except ValueError as e:
        raise HttpError(400, str(e)) from e


def r_run(req, sid) -> dict:
    r = run(sid, req.json())
    return {**public(r["session"]), "made": r["trials"]}


def r_validate(req, sid) -> dict:
    it, s = validate(sid, str(req.json().get("trial") or ""))
    return {"item": library.public(it), "session": public(s)}


def r_forget(req, sid) -> dict:
    return public(forget(sid, str(req.json().get("trial") or "")))


def r_file(req, sid, name):
    s = _session_or_404(sid, show=True)
    m = FILE_RX.fullmatch(name)
    if m:
        t = _trial(s, m.group(1))
        want = t and (t.get("thumb") if m.group(2) else t.get("file"))
        if not want or want != name or not (_dir(sid) / name).is_file():
            raise HttpError(404, "fichier nettoyé, ou pas encore rendu")
        v = req.q("v")
        return FileResponse(_dir(sid) / name, "image/png",
                            cache="private, max-age=31536000, immutable" if v and v == t.get("v") else "no-cache")
    if IM.MASK_RX.fullmatch(name) and any(t.get("mask") == name for t in s.get("trials", [])):
        return FileResponse(IM.mask_path(name), "image/png", cache="private, max-age=86400")
    raise HttpError(404, "fichier inconnu")


def _inventaire():
    """Les sessions de l'atelier, pour l'inventaire (core/inventaire.py) : `owner` (qui l'a
    ouverte) et `space` (celui de l'image source), posés par library.stamp. Ce qui a été
    validé est un objet de la bibliothèque (le socle le compte)."""
    from core import inventaire
    for r in inventaire.json_docs(root().glob("atl-*.json"), _inventaire_fiche):
        # le titre et la vignette sont ceux de l'image source : lus à chaque fois (elle se renomme sans la session)
        src = library._items.get(r["source"])
        yield {**r, "title": f"Atelier · {(src or {}).get('title') or r['source'] or '?'}",
               "thumb": (lambda src=src: library.public(src).get("thumb_url")) if src else None}


def _inventaire_fiche(f: Path, s: dict) -> dict:
    n = len(s.get("trials") or [])
    return {"id": f.stem, "source": str(s.get("source") or ""), "owner": s.get("owner"), "space": s.get("space"),
            "created": s.get("created"), "updated": s.get("updated"), "open": f"image/atelier/?s={f.stem}",
            "sub": f"{n} essai{'s' if n > 1 else ''}"}


def register(app) -> None:
    from core import inventaire
    inventaire.declare("atelier", label="session d'atelier", plural="sessions d'atelier", tool="image", store="image_atelier",
                       lister=_inventaire, order=24)
    IM._register_job(KIND, run_job, "Atelier", IM._family_edit, IM._mem_edit)
    app.route("GET", "/api/image/atelier/config", r_config)
    app.route("GET", "/api/image/atelier", r_list)
    app.route("POST", "/api/image/atelier/open", r_open)
    app.route("GET", "/api/image/atelier/{sid}", r_get)
    app.route("POST", "/api/image/atelier/{sid}", r_save)
    app.route("POST", "/api/image/atelier/{sid}/run", r_run)
    app.route("POST", "/api/image/atelier/{sid}/validate", r_validate)
    app.route("POST", "/api/image/atelier/{sid}/forget", r_forget)
    app.route("GET", "/api/image/atelier/{sid}/f/{name}", r_file)
    app.on_start(lambda: _sweep_soon())


# ── le contrôle sans GPU (tools/check.py) ───────────────────
def selftest(call, ok) -> None:
    import base64
    from io import BytesIO
    from PIL import Image

    def png(w, h, color):
        b = BytesIO()
        Image.new("RGB", (w, h), color).save(b, "PNG")
        return b.getvalue()

    def render(ids):
        """La voie image n'a pas d'ouvrier dans le contrôle : on rend comme lui (moteur factice)."""
        g = call("GET", f"/api/image/atelier/{sid}")[1]
        for t in g.get("trials", []):
            if t["id"] in ids:
                j = jobs.get(t["job"])
                if j and j["state"] == "queued":
                    jobs._run(j, "local")
        return call("GET", f"/api/image/atelier/{sid}")[1]

    def validated_count():
        library._load()
        return sum(1 for it in library._items.values() if (it.get("params") or {}).get("atelier"))

    tr = lambda s, tid: next((t for t in s.get("trials", []) if t["id"] == tid), {})   # noqa: E731

    st, cfg = call("GET", "/api/image/atelier/config")
    ids = {i["id"] for i in cfg.get("intents", [])} if st == 200 else set()
    ok(ids >= {"detail", "light", "style", "add", "remove", "background", "extend"}, f"atelier : les intentions ({st} {ids})")
    ok(all(i.get("src") or i.get("off") or all(c.get("src") for c in i.get("choices", [])) for i in cfg.get("intents", [])),
       "atelier : chaque intention dit sa source (ou pourquoi elle est éteinte)")
    it_by = {i["id"]: i for i in cfg.get("intents", [])}
    ok(it_by.get("extend", {}).get("off") and it_by.get("remove", {}).get("model") == "qwen21" and "Raw" in it_by.get("remove", {}).get("model_why", ""),
       "atelier : Étendre éteint avec sa raison ; Retirer passe par Qwen (Krea Turbo ne retire pas)")
    ok(jobs.cost_declared(KIND) and jobs.HANDLERS[KIND][1] == "image", "atelier : la sorte image.atelier déclare son coût, sur la voie image")

    st, up = call("PUT", "/api/library/upload?name=atelier.png&title=Atelier%20source&tool=image", raw=png(96, 64, (90, 120, 150)))
    src_id = up.get("id")
    st, s = call("POST", "/api/image/atelier/open", {"item": src_id})
    sid = s.get("id", "") if isinstance(s, dict) else ""
    ok(st == 200 and SID_RX.fullmatch(sid) and s["source"] == src_id and s["base"] == "src" and s["trials"] == [] and s.get("created_now")
       and s.get("space"), f"atelier : ouvrir une image crée sa session, dans son Workspace ({st} {str(s)[:160]})")
    st, s2 = call("POST", "/api/image/atelier/open", {"item": src_id})
    ok(st == 200 and s2.get("id") == sid and not s2.get("created_now"), "atelier : rouvrir la même image reprend sa session")
    st, s3 = call("POST", f"/api/image/atelier/{sid}", {"draft": {"prompt": "a red hat", "model": "qwen21", "intent": "detail", "pirate": 1}})
    st2, g = call("GET", f"/api/image/atelier/{sid}")
    ok(st == 200 and st2 == 200 and g["draft"].get("prompt") == "a red hat" and g["draft"].get("model") == "qwen21" and "pirate" not in g["draft"],
       f"atelier : le brouillon s'enregistre seul et se relit ({st} {g.get('draft')})")
    st, _ = call("POST", f"/api/image/atelier/{sid}", {"view": "e9"})
    ok(st == 400, f"atelier : regarder un essai qui n'existe pas est refusé ({st})")

    before = validated_count()
    mk = Image.new("L", (96, 64), 0)
    mk.paste(255, (30, 20, 60, 50))
    mb = BytesIO()
    mk.save(mb, "PNG")
    durl = "data:image/png;base64," + base64.b64encode(mb.getvalue()).decode()
    st, r = call("POST", f"/api/image/atelier/{sid}/run", {"tool": "instruct", "model": "krea2", "prompt": "a red hat", "mask": durl,
                                                          "count": 2, "seed": 5, "intent": "detail"})
    ok(st == 200 and r.get("made") == ["e1", "e2"] and all(tr(r, x).get("state") == "queued" and tr(r, x).get("job") for x in ("e1", "e2"))
       and [tr(r, x).get("seed") for x in ("e1", "e2")] == [5, 6],
       f"atelier : deux essais en file, graines qui se suivent ({st} {str(r)[:200]})")
    j1 = jobs.get(tr(r, "e1").get("job", ""))
    ok(bool(j1) and j1["kind"] == KIND and j1["params"].get("atelier") == sid and j1["params"].get("base") == "src" and j1.get("cost") in ("cpu", "gpu"),
       "atelier : le travail passe par jobs.submit, avec sa session, sa base et son coût")
    g = render({"e1", "e2"})
    e1 = tr(g, "e1")
    ok(e1.get("state") == "done" and e1.get("has_file") and e1.get("width") == 96 and IM.MASK_RX.fullmatch(e1.get("mask", ""))
       and e1.get("url") and e1.get("mask_url"), f"atelier : l'essai est rendu dans la session, sa zone gardée ({str(e1)[:240]})")
    ok(validated_count() == before, "atelier : un essai n'est PAS un objet de la bibliothèque")
    st, raw = call("GET", "/" + e1.get("url", "x"))
    ok(st == 200 and isinstance(raw, bytes) and raw[:4] == b"\x89PNG", f"atelier : le fichier d'un essai se lit ({st})")
    st, raw = call("GET", "/" + e1.get("mask_url", "x"))
    ok(st == 200 and isinstance(raw, bytes) and raw[:4] == b"\x89PNG", f"atelier : sa zone se relit (reprendre la zone) ({st})")
    for bad in ("..%2Fx.json", "e77.png", "main.png", "msk-000000000000.png"):
        st, _ = call("GET", f"/api/image/atelier/{sid}/f/{bad}")
        ok(st in (400, 404), f"atelier : fichier refusé : {bad} ({st})")

    # partir d'un essai : il devient la base
    st, r = call("POST", f"/api/image/atelier/{sid}/run", {"tool": "instruct", "model": "qwen21", "prompt": "make it night", "base": "e1"})
    g = render({"e3"})
    ok(st == 200 and tr(g, "e3").get("base") == "e1" and tr(g, "e3").get("state") == "done" and g.get("base") == "e1",
       f"atelier : un essai part d'un autre, qui devient la base ({st} {str(tr(g, 'e3'))[:160]})")
    for body, msg in (({"tool": "instruct", "model": "qwen21", "prompt": "x", "base": "e42"}, "une base inconnue"),
                      ({"tool": "extend"}, "Étendre (non documenté)"),
                      ({"tool": "instruct", "model": "zimage", "prompt": "x"}, "Z-Image en consigne"),
                      ({"tool": "instruct", "model": "krea2", "prompt": ""}, "une consigne vide")):
        st, d = call("POST", f"/api/image/atelier/{sid}/run", body)
        ok(st == 400, f"atelier : {msg} est refusé, avec la raison ({st} {d})")

    # valider : UN objet, sa lignée ; deux fois : le même
    st, v = call("POST", f"/api/image/atelier/{sid}/validate", {"trial": "e3"})
    it = (v or {}).get("item", {}) if st == 200 else {}
    p = it.get("params", {})
    ok(st == 200 and it.get("parents", [None])[0] == src_id and p.get("job") == "image.atelier" and p.get("atelier") == sid
       and [x["id"] for x in p.get("steps", [])] == ["e1", "e3"] and validated_count() == before + 1,
       f"atelier : valider fait UN objet, lignée vers la source, ses essais enchaînés ({st} {str(v)[:240]})")
    st, v2 = call("POST", f"/api/image/atelier/{sid}/validate", {"trial": "e3"})
    ok(st == 200 and v2["item"]["id"] == it.get("id") and validated_count() == before + 1, "atelier : valider deux fois rend le même objet")
    st, v1 = call("POST", f"/api/image/atelier/{sid}/validate", {"trial": "e1"})
    p1 = (v1 or {}).get("item", {}).get("params", {}) if st == 200 else {}
    ok(st == 200 and p1.get("job") == "image.edit" and p1.get("mask") == e1.get("mask") and p1.get("source") == src_id,
       f"atelier : un essai d'une étape garde la recette d'image.edit ({st} {str(p1)[:200]})")
    st, rd = call("POST", "/api/image/redo", {"item": v1["item"]["id"]} if st == 200 else {})
    ok(st == 200 and len(rd.get("jobs", [])) == 1, f"atelier : Recréer rejoue la recette d'un essai validé ({st})")
    for j in (rd or {}).get("jobs", []) if isinstance(rd, dict) else []:
        call("POST", f"/api/jobs/{j['id']}/cancel")
    st, s4 = call("POST", "/api/image/atelier/open", {"item": it.get("id", "")})
    ok(st == 200 and s4.get("id") == sid, f"atelier : « Éditer » sur l'image validée rouvre sa session ({st})")
    st, lst = call("GET", "/api/image/atelier")
    ok(st == 200 and any(x["id"] == sid and x["validated"] == 2 for x in lst.get("sessions", [])), "atelier : la session est dans la liste du Workspace")

    # retirer un essai de l'historique
    st, g = call("POST", f"/api/image/atelier/{sid}/forget", {"trial": "e2"})
    ok(st == 200 and not tr(g, "e2") and not (root() / sid / "e2.png").exists(), "atelier : retirer un essai efface sa ligne et son fichier")

    # le nettoyage (1) : au-delà des fichiers gardés, les plus anciens perdent le leur
    old = config.CFG.get("image_atelier_files")
    config.CFG["image_atelier_files"] = 4
    try:
        call("POST", f"/api/image/atelier/{sid}", {"view": "e3"})
        st, r = call("POST", f"/api/image/atelier/{sid}/run", {"tool": "instruct", "model": "krea2", "prompt": "more", "count": 3, "base": "src"})
        g = render(set(r.get("made", [])))
    finally:
        if old is None:
            config.CFG.pop("image_atelier_files", None)
        else:
            config.CFG["image_atelier_files"] = old
    files = [t["id"] for t in g.get("trials", []) if t.get("has_file")]
    ok(len(files) == 4 and not tr(g, "e1").get("has_file") and tr(g, "e1").get("purged") and tr(g, "e3").get("has_file"),
       f"atelier : 4 fichiers gardés, le plus ancien nettoyé, pas celui qu'on regarde ({files})")
    ok(tr(g, "e1").get("url") and tr(g, "e1").get("validated"), "atelier : un essai validé nettoyé se montre par son image de la bibliothèque")
    st, _ = call("POST", f"/api/image/atelier/{sid}/run", {"tool": "instruct", "model": "krea2", "prompt": "x", "base": "e1"})
    ok(st == 400, f"atelier : une base nettoyée est refusée, avec la raison ({st})")

    # le nettoyage (2) : une session sans geste depuis longtemps perd ses fichiers ; sans source, elle part
    with _lock:
        cur = _read(sid)
        cur["updated"] = "2020-01-01T00:00:00+00:00"
        _write(cur)
    st, up2 = call("PUT", "/api/library/upload?name=partie.png&title=Partie&tool=image", raw=png(40, 40, (10, 10, 10)))
    st, sg = call("POST", "/api/image/atelier/open", {"item": up2.get("id")})
    gone_sid = sg.get("id", "")
    with _lock:
        cur = _read(gone_sid)
        cur["updated"] = "2020-01-01T00:00:00+00:00"
        _write(cur)
    call("POST", f"/api/library/{up2.get('id')}/delete")
    out = sweep()
    st, g = call("GET", f"/api/image/atelier/{sid}")
    ok(out["purged"] >= 1 and st == 200 and not any(t.get("has_file") for t in g["trials"]) and len(g["trials"]) >= 4 and g["base"] == "src",
       f"atelier : une session vieille de {KEEP_DAYS} jours perd ses fichiers, garde ses lignes ({out})")
    st, _ = call("GET", f"/api/image/atelier/{gone_sid}")
    ok(out["deleted"] >= 1 and st == 404, f"atelier : une session vieille dont la source est partie part entière ({out} {st})")

    # la page
    st, page = call("GET", "/image/atelier/")
    ok(st == 200 and b"atelier.js" in page and b'id="rail"' in page and b'id="stage"' in page, "atelier : la page se sert")
    repo = Path(__file__).resolve().parents[2]
    ijs = (repo / "image" / "image.js").read_text(encoding="utf-8")
    ok("U.buttons" not in ijs and "undoBox" not in ijs and "mode === 'edit'" not in ijs and "openAtelier" in ijs and "location.replace(atelierHref" in ijs,
       "image : la page arrive en Créer, sans bouton annuler dans la barre ; Éditer ouvre l'atelier ; ?edit= y mène")
    for f in ("image/atelier/atelier.css", "image/image.css"):
        css = re.sub(r"/\*.*?\*/", "", (repo / f).read_text(encoding="utf-8"), flags=re.S)
        ok(not re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", css), f"{f} : aucune couleur en dur")
        ok(not re.search(r"(?<![\w-])border(-(top|right|bottom|left))?\s*:(?!\s*(none|0)\b)", css), f"{f} : des filets, jamais de bordures")
        ok("accent-color" not in css and "::-webkit-slider" not in css, f"{f} : aucun curseur stylé ici (le style commun de base.css)")
    ajs = (repo / "image" / "atelier" / "atelier.js").read_text(encoding="utf-8") + (repo / "image" / "atelier" / "index.html").read_text(encoding="utf-8")
    ok(ajs.count("tb go") == 2, "atelier : un seul orange par écran (Essayer ; Choisir une image quand rien n'est ouvert)")

    # ── les droits, par Workspace (auth allumée) ──
    from tools.admin import essai_http as H
    before_auth, essai = config.CFG.get("auth"), config.CFG.get("equipes_guests_essai")
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    gen = {"X-SR-Espace": "esp-general"}
    err = lambda d: d.get("error", "") if isinstance(d, dict) else str(d)[:120]   # noqa: E731
    try:
        config.CFG["auth"] = True
        config.CFG["equipes_guests_essai"] = True
        auth.startup()
        with auth._lock:
            auth._hits.clear()
        _, _, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        _, _, I = H("POST", "/api/auth/enter", {"name": "Iris Atelier"})
        iris = (auth.find_pseudo("Iris Atelier") or {}).get("id", "")
        H("POST", f"/api/admin/requests/{iris}/accept", cookie=cal, headers=same)
        I = I or H("POST", "/api/auth/enter", {"name": "Iris Atelier"}, headers=same)[2]
        for pseudo, mode in (("Oscar Atelier", "viewer"), ("Gaspard Atelier", "acteur")):
            H("POST", "/api/equipes/tea-nirvalab/membres", {"pseudo": pseudo, "role": "guest", "guest": mode, "spaces": ["esp-general"]},
              cookie=cal, headers=same)
        _, t2, _ = H("POST", "/api/equipes", {"name": "Atelier Ailleurs"}, cookie=cal, headers=same)
        H("POST", f"/api/equipes/{(t2 or {}).get('id')}/membres", {"pseudo": "Lea Atelier", "role": "member"}, cookie=cal, headers=same)
        O = H("POST", "/api/auth/enter", {"name": "Oscar Atelier"}, headers=same)[2]
        G = H("POST", "/api/auth/enter", {"name": "Gaspard Atelier"}, headers=same)[2]
        L = H("POST", "/api/auth/enter", {"name": "Lea Atelier"}, headers=same)[2]
        ok(bool(cal and I and O and G and L), "atelier, droits : Cal, Iris (membre), Oscar (guest viewer), Gaspard (guest acteur), Léa (autre Team) entrent")

        def as_(tok, method, path, body=None, raw=None, ctype=None):
            return H(method, path, body, cookie=tok, raw=raw, headers={**same, **gen, **({"Content-Type": ctype} if ctype else {})})[:2]

        st, img = as_(I, "PUT", "/api/library/upload?name=iris.png&title=Iris", raw=png(64, 48, (200, 120, 60)), ctype="image/png")
        st, si = as_(I, "POST", "/api/image/atelier/open", {"item": (img or {}).get("id", "")})
        isid = si.get("id", "") if isinstance(si, dict) else ""
        ok(st == 200 and si.get("space") == "esp-general" and si.get("owner") == iris and not si.get("write_why"),
           f"atelier, droits : Iris ouvre l'atelier de son image, dans Général ({st} {err(si)})")
        st, r = as_(I, "POST", f"/api/image/atelier/{isid}/run", {"tool": "instruct", "model": "krea2", "prompt": "a hat"})
        ok(st == 200 and r.get("made") == ["e1"], f"atelier, droits : Iris, membre, calcule ({st} {err(r)})")
        if st == 200:
            try:
                jobs.cancel(tr(r, "e1").get("job", ""))
            except KeyError:
                pass
        # Léa, dans son Workspace (Général lui est fermé : la porte refuse l'en-tête, 403)
        st0, _ = as_(L, "GET", f"/api/image/atelier/{isid}")
        st, d, _ = H("GET", f"/api/image/atelier/{isid}", cookie=L, headers=same)
        st2, lst, _ = H("GET", "/api/image/atelier", cookie=L, headers=same)
        st3, d3, _ = H("POST", "/api/image/atelier/open", {"item": (img or {}).get("id", "")}, cookie=L, headers=same)
        ok(st0 == 403 and st == 404 and st2 == 200 and not any(x["id"] == isid for x in (lst or {}).get("sessions", [])) and st3 == 404,
           f"atelier, droits : Léa, d'une autre Team, ne voit ni la session, ni l'image ({st0} {st} {st2} {st3})")
        st, d = as_(O, "GET", f"/api/image/atelier/{isid}")
        ok(st == 200 and d.get("write_why") and d.get("compute_why"), f"atelier, droits : Oscar, guest viewer, lit, et la page sait pourquoi il n'agit pas ({st})")
        for path, body in ((f"/api/image/atelier/{isid}/run", {"tool": "instruct", "model": "krea2", "prompt": "x"}),
                           (f"/api/image/atelier/{isid}", {"draft": {"prompt": "x"}}),
                           (f"/api/image/atelier/{isid}/validate", {"trial": "e1"})):
            st, d = as_(O, "POST", path, body)
            ok(st == 403, f"atelier, droits : Oscar, guest viewer, refusé : {path.rsplit('/', 1)[-1]} ({st} {err(d)[:90]})")
        st, d = as_(G, "POST", f"/api/image/atelier/{isid}/run", {"tool": "instruct", "model": "krea2", "prompt": "x"})
        ok(st == 403 and "guest" in err(d), f"atelier, droits : Gaspard, guest acteur, ne calcule pas ({st} {err(d)[:90]})")
        st, d = as_(G, "POST", f"/api/image/atelier/{isid}", {"draft": {"prompt": "une idée"}})
        ok(st == 200, f"atelier, droits : Gaspard, guest acteur, écrit le brouillon ({st} {err(d)[:90]})")
        st, d = as_(cal, "GET", f"/api/image/atelier/{isid}")
        ok(st == 200, "atelier, droits : Cal voit tout")
    finally:
        auth.set_current(None)
        auth.set_current_space(None)
        config.CFG["auth"] = before_auth
        if essai is None:
            config.CFG.pop("equipes_guests_essai", None)
        else:
            config.CFG["equipes_guests_essai"] = essai
