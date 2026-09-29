"""Idéation : un canvas infini où Cal pose, rapproche et fait naître des
idées visuelles avant de passer aux outils de production. L'étude :
`docs/etudes/ideation.md`.

Une planche est un fichier JSON sous `<data_dir>/ideation/<id>.json` ; la
page l'enregistre seule après chaque geste (rien à « enregistrer »), avec
sa version `rev` : un second onglet qui écrirait par-dessus reçoit 409.

Ce qu'une planche porte (`nodes`, dans l'ordre d'empilement) :

  media    un objet de la bibliothèque : image, vidéo, son, élément
           (`item` = son identifiant ; la page le lit dans /api/library)
  note     un texte libre            sticky   un post-it (couleur = jeton)
  title    un titre                  frame    un cadre : une zone nommée
  gen      une carte « Générer » : prompt, modèle, format, prise de vue ;
           les images et éléments qui lui sont reliés sont ses références
  palette  un nuancier tiré d'une image (des couleurs de données)

et des liens (`links` : a → b, `arrow`, `line`, ou `out` = « a produit
b »). Les objets `media` et `gen` gardent leurs travaux en cours
(`jobs`) : rechargée, la page reprend leur attente et pose les résultats.

La validation est stricte sur la structure (identifiants, sortes, liens
vers des objets présents) et tolérante sur le vocabulaire qui peut évoluer
ailleurs (une couleur, un réglage de prise de vue, un modèle retirés
reviennent au défaut) : une vieille planche s'ouvre toujours.

Les générations ne passent pas par ici : la page appelle les routes de
l'outil Image (`/api/image/generate`, `edit`, `redo`), donc ses travaux
`image.generate` et `image.edit` et leur moteur (factice aujourd'hui).

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

from core import config, jobs, library
from core.http import HttpError

REPO = Path(__file__).resolve().parents[2]

BID = re.compile(r"ide-\d{8}-\d{6}-[0-9a-f]{4}")
NID = re.compile(r"[A-Za-z0-9_-]{1,40}")
ITEM = re.compile(r"[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}")
JOB = re.compile(r"job-\d{4}-\d{6}-[0-9a-f]{4}")
HEX = re.compile(r"#[0-9a-fA-F]{6}")
REF_FILE = re.compile(r"ref-\d{2}\.[a-z]{3,4}")

TYPES = ("media", "note", "sticky", "title", "frame", "gen", "palette")
MEDIA_KINDS = ("image", "video", "audio", "element")
# les post-it : des jetons du thème, et l'encre qui se lit dessus
STICKY = {"coral-3": "on-light", "coral-2": "on-light", "coral-1": "on-coral1", "amb": "on-light",
          "verd-3": "on-grn", "verd-4": "on-grn", "cy": "on-cy", "paper": "paper-ink"}
TITLE_SIZES = {"s": 22, "m": 34, "l": 52}
ETYPE_FR = {"character": "personnage", "object": "objet", "place": "lieu", "style": "style", "other": "élément"}
LINK_KINDS = ("arrow", "line", "out")
MAX_NODES = 3000
MAX_LINKS = 6000
MAX_SIDE = 4096          # le grand côté d'un export
EXPORT_SCALE = 2.0       # une planche petite s'exporte au double : nette à l'écran
MARGIN = 48              # autour de la planche entière, en px du monde

_lock = threading.RLock()


def _image():
    """Les modèles, formats et réglages de l'outil Image : la seule vérité."""
    from tools import image
    return image


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
    return json.loads(f.read_text(encoding="utf-8"))


def _write(b: dict) -> None:
    f = _path(b["id"])
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(b, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(f)


def new_id() -> str:
    return f"ide-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"


def blank(name: str) -> dict:
    now = library.now()
    return {"id": new_id(), "name": (name or "").strip()[:120] or "Sans titre",
            "created": now, "updated": now, "rev": 1, "nodes": [], "links": []}


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
            out.append({"id": j["id"], "act": _s(j.get("act"), 20)})
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
    if t == "media":
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
    elif t == "frame":
        out["name"] = _s(n.get("name"), 120)
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
    elif t == "palette":
        out["colors"] = [c.lower() for c in (n.get("colors") or [])[:16] if isinstance(c, str) and HEX.fullmatch(c)]
        if ITEM.fullmatch(str(n.get("item", ""))):
            out["item"] = n["item"]
    return out


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
    rawl = b.get("links") or []
    if not isinstance(rawl, list) or len(rawl) > MAX_LINKS:
        raise HttpError(400, f"trop de liens ({MAX_LINKS} au plus)")
    links, lids = [], set()
    for lk in rawl:
        if not isinstance(lk, dict):
            raise HttpError(400, "un lien est un objet JSON")
        lid = str(lk.get("id", ""))
        if not NID.fullmatch(lid) or lid in lids:
            raise HttpError(400, f"lien sans identifiant valide ou en double : {lid!r}")
        a, z = str(lk.get("a", "")), str(lk.get("b", ""))
        if a not in ids or z not in ids:
            raise HttpError(400, f"le lien {lid} relie un objet absent de la planche")
        if a == z:
            raise HttpError(400, f"le lien {lid} relie un objet à lui-même")
        lids.add(lid)
        links.append({"id": lid, "a": a, "b": z, "kind": lk.get("kind") if lk.get("kind") in LINK_KINDS else "arrow",
                      "label": _s(lk.get("label"), 120)})
    out = {"id": b.get("id"), "name": _s(b.get("name") or "Sans titre", 120).strip() or "Sans titre",
           "nodes": nodes, "links": links}
    for k in ("created", "updated", "rev"):
        if k in b:
            out[k] = b[k]
    return out


# ── les routes ───────────────────────────────────────────────
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
    return {"sticky": [{"id": k, "ink": v} for k, v in STICKY.items()], "title_sizes": TITLE_SIZES,
            "link_kinds": list(LINK_KINDS), "types": list(TYPES), "limits": {"nodes": MAX_NODES, "links": MAX_LINKS},
            "element_types": list(library.ELEMENT_TYPES), "backend": img.backend()}


def r_list(req):
    out = []
    for f in _dir().glob("ide-*.json"):
        try:
            out.append(_summary(normalize(json.loads(f.read_text(encoding="utf-8")))))
        except (ValueError, HttpError):
            continue
    out.sort(key=lambda s: s.get("updated") or "", reverse=True)
    return {"boards": out}


def r_create(req):
    b = blank(req.json().get("name", ""))
    with _lock:
        _write(b)
    return b


def r_get(req, bid):
    return normalize(load(bid))


def r_save(req, bid):
    """La page envoie la planche entière. `base_rev` : la version qu'elle
    avait ; si le fichier a bougé entre-temps, on refuse plutôt que
    d'écraser en silence."""
    d = req.json()
    with _lock:
        cur = load(bid)
        base = d.get("base_rev")
        if base is not None and int(base) != int(cur.get("rev", 1)):
            raise HttpError(409, "cette planche a été modifiée ailleurs (un autre onglet ?) : rechargez-la")
        new = normalize({**d, "id": bid, "name": d.get("name", cur.get("name"))})
        new.update(created=cur.get("created"), updated=library.now(), rev=int(cur.get("rev", 1)) + 1)
        _write(new)
    return {"ok": True, "rev": new["rev"], "updated": new["updated"]}


def r_rename(req, bid):
    name = str(req.json().get("name", "")).strip()[:120]
    if not name:
        raise HttpError(400, "un nom, s'il vous plaît")
    with _lock:
        b = load(bid)
        b.update(name=name, updated=library.now(), rev=int(b.get("rev", 1)) + 1)
        _write(b)
    return _summary(normalize(b))


def r_duplicate(req, bid):
    with _lock:
        src = normalize(load(bid))
        now = library.now()
        # les travaux en cours restent à l'original : la copie ne poserait pas deux fois leurs images
        nodes = [{**n, "jobs": []} if "jobs" in n else n for n in src["nodes"]]
        b = {**src, "id": new_id(), "name": (src["name"] + " (copie)")[:120], "nodes": nodes,
             "created": now, "updated": now, "rev": 1}
        _write(b)
    return _summary(b)


def r_delete(req, bid):
    f = _path(bid)
    if not f.exists():
        raise HttpError(404, "planche introuvable")
    trash = _dir() / "corbeille"
    trash.mkdir(exist_ok=True)
    with _lock:
        shutil.move(str(f), str(trash / f.name))
    return {"ok": True}


def r_export(req, bid):
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
    j = jobs.submit("ideation.export", {"board": bid, "frame": fid, "rev": b.get("rev")},
                    title=f"Export · {title}", tool="ideation")
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
    if not it:
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
        css = (REPO / "commun" / "tokens.css").read_text(encoding="utf-8")
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


def render(b: dict, frame: str = "", check=lambda: None):
    """La planche (ou un cadre) en image PIL, et les objets de la
    bibliothèque qu'elle montre (sa lignée)."""
    from PIL import Image, ImageDraw, ImageOps
    T = tokens()
    r = region_of(b, frame)
    W, H = r[2] - r[0], r[3] - r[1]
    s = min(EXPORT_SCALE, MAX_SIDE / max(W, H, 1))
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
    shown = [n for n in b["nodes"] if _inside(n, r)]
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
        d.rounded_rectangle([x0, y0, x1, y1], radius=rad(9), fill=T["panel"], outline=T["line"], width=max(1, rad(1)))
        name = (n.get("name") or "cadre").upper()
        d.text((x0 + rad(4), y0 - rad(22)), name, font=_font("disp", 13 * s), fill=T["ink2"])
    check()

    # 2. les liens
    for lk in b["links"]:
        a, z = byid.get(lk["a"]), byid.get(lk["b"])
        if not a or not z:
            continue
        p0, p1 = _edge(a, z)
        into_gen = z["type"] == "gen" and a["type"] == "media" and a.get("kind") in ("image", "element")
        col = T["grn2"] if lk["kind"] == "out" else T["cy"] if into_gen else T["ink3"]
        q0, q1 = (X(p0[0]), Y(p0[1])), (X(p1[0]), Y(p1[1]))
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

    # 3. le reste, dans l'ordre d'empilement
    for n in shown:
        t = n["type"]
        if t == "frame":
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
        elif t == "gen":
            d.rounded_rectangle([x0, y0, x1, y1], radius=rad(9), fill=T["panel"], outline=T["line-or"], width=max(1, rad(1)))
            model = _image().MODELS.get(n.get("model"), {}).get("k", "")
            d.text((x0 + rad(14), y0 + rad(12)), f"GÉNÉRER · {model}", font=_font("mono", 8.5 * s), fill=T["or"])
            text({**n, "text": n.get("prompt") or "—"}, _font("ui", 12 * s), T["ink2"], rad(14), 1.5, top=rad(22))
        elif t == "palette":
            cols = n.get("colors") or []
            if cols:
                sw = w / len(cols)
                lab = 18 * s
                for k, c in enumerate(cols):
                    rgb = tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
                    d.rectangle([x0 + k * sw, y0, x0 + (k + 1) * sw, y1 - lab], fill=rgb)
                    d.text((x0 + k * sw + rad(4), y1 - lab + rad(4)), c.upper(), font=_font("mono", 8 * s), fill=T["ink3"])
        check()
    return img, list(dict.fromkeys(parents)), s


def run_export(ctx) -> dict:
    bid = ctx.params.get("board", "")
    b = normalize(load(bid))
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


def register(app) -> None:
    jobs.register("ideation.export", run_export, lane="cpu", title="Idéation · export")
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
