"""Les présentations d'Idéation : le motion et les modèles (docs/etudes/presentations.md § 10).

Ce module ne sert aucune route : il tient la RÈGLE des champs neufs d'une planche,
que ideation.normalize garde par deux petits branchements délimités (`_node`, `_pres`) :

  objet    `motion` { in: {fx, dur, delay, ease, by, stagger, dist}, out: {fx, dur, ease},
                      loop: {fx, dur, amp}, depth, step }      des données bornées, jamais du code
           `tone`   le rôle de couleur dans la palette du modèle (ink, accent, veil…)
  cadre    `motion` { trans, tdur, ease, bg, auto }           la transition d'arrivée, le fond, l'avance seule
  planche  `pres.template`                                     le modèle appliqué (un fichier de modeles/)

La vérité des noms (effets, courbes, transitions, tons…) est UNE : ideation/presentation/
schema.json, lu ici, par le moteur de la page (moteur.js) et par le contrôle. Une valeur
inconnue ou hors bornes tombe (ou revient à la borne), comme ailleurs dans normalize.

Le contrôle (selftest, tools/check.py) : chaque modèle est valide selon le schéma (palette,
styles que _pres garde tels quels, décor, motion, exemple dont chaque objet passe _node) ;
chaque effet du schéma existe dans moteur.js ; une planche garde son motion à l'aller-retour ;
aucune couleur en dur dans l'interface (presentation.css, les modules).
"""

from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path

from core import config

DIR = Path(config.REPO) / "ideation" / "presentation"
HEX = re.compile(r"#[0-9a-fA-F]{6}")
TPL_ID = re.compile(r"[a-z0-9-]{1,32}")


@lru_cache(maxsize=1)
def schema() -> dict:
    return json.loads((DIR / "schema.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def template_ids() -> tuple:
    try:
        return tuple(json.loads((DIR / "modeles" / "index.json").read_text(encoding="utf-8"))["modeles"])
    except (OSError, ValueError, KeyError):
        return ()


def _num(v, lo, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return round(max(lo, min(hi, float(v))), 3)


def _lim(k):
    return schema()["limits"][k]


def clean_motion(m) -> dict | None:
    """Le motion d'un objet, borné par le schéma ; rien de lisible : None."""
    if not isinstance(m, dict):
        return None
    S = schema()
    out = {}
    i = m.get("in")
    if isinstance(i, dict) and i.get("fx") in S["fx_in"]:
        o = {"fx": i["fx"]}
        for k, lim in (("dur", "dur"), ("delay", "delay"), ("stagger", "stagger"), ("dist", "dist")):
            v = _num(i.get(k), *_lim(lim))
            if v is not None:
                o[k] = v
        if i.get("ease") in S["ease"]:
            o["ease"] = i["ease"]
        if i.get("by") in S["by"]:
            o["by"] = i["by"]
        out["in"] = o
    x = m.get("out")
    if isinstance(x, dict) and x.get("fx") in S["fx_out"] and x["fx"] != "none":
        o = {"fx": x["fx"]}
        v = _num(x.get("dur"), *_lim("dur"))
        if v is not None:
            o["dur"] = v
        if x.get("ease") in S["ease"]:
            o["ease"] = x["ease"]
        out["out"] = o
    lp = m.get("loop")
    if isinstance(lp, dict) and lp.get("fx") in S["fx_loop"] and lp["fx"] != "none":
        o = {"fx": lp["fx"]}
        for k, lo, hi in (("dur", 400, 60000), ("amp", 0, 200)):
            v = _num(lp.get(k), lo, hi)
            if v is not None:
                o[k] = v
        out["loop"] = o
    d = _num(m.get("depth"), *_lim("depth"))
    if d:
        out["depth"] = d
    s = _num(m.get("step"), *_lim("step"))
    if s:
        out["step"] = int(s)
    return out or None


def clean_frame_motion(m) -> dict | None:
    """Ce qu'une diapositive garde : sa transition d'arrivée, sa durée, sa courbe, son fond, son avance seule."""
    if not isinstance(m, dict):
        return None
    S = schema()
    out = {}
    if m.get("trans") in S["trans"]:
        out["trans"] = m["trans"]
    v = _num(m.get("tdur"), *_lim("tdur"))
    if v is not None:
        out["tdur"] = v
    if m.get("ease") in S["ease"]:
        out["ease"] = m["ease"]
    if m.get("bg") in S["bg"]:
        out["bg"] = m["bg"]
    a = _num(m.get("auto"), *_lim("auto"))
    if a:
        out["auto"] = a
    return out or None


def node_fields(n: dict, t: str) -> dict:
    """Les champs de présentation d'un objet (ideation._node, branchement délimité)."""
    if t == "group":
        return {}
    if t == "frame":
        m = clean_frame_motion(n.get("motion"))
        return {"motion": m} if m else {}
    out = {}
    m = clean_motion(n.get("motion"))
    if m:
        out["motion"] = m
    if n.get("tone") in schema()["tone"]:
        out["tone"] = n["tone"]
    return out


def pres_fields(p) -> dict:
    """Ce que `pres` garde en plus des styles (ideation._pres, branchement délimité) : le modèle appliqué."""
    if isinstance(p, dict) and isinstance(p.get("template"), str) and p["template"] in template_ids():
        return {"template": p["template"]}
    return {}


# ── les modèles, contrôlés ───────────────────────────────────
def validate_template(t: dict) -> list[str]:
    """Les écarts d'un modèle au schéma ([] : valide)."""
    from tools import ideation as ide
    S = schema()
    errs = []
    tid = t.get("id")
    if not isinstance(tid, str) or not TPL_ID.fullmatch(tid):
        return [f"identifiant illisible : {tid!r}"]
    if t.get("kind") not in ("statique", "motion"):
        errs.append(f"{tid} : sorte {t.get('kind')!r} (statique ou motion)")
    for k in ("name", "direction", "line"):
        if not isinstance(t.get(k), str) or not t[k].strip():
            errs.append(f"{tid} : {k} manque")
    pal = t.get("palette") or {}
    for k in S["palette"]:
        if not isinstance(pal.get(k), str) or not HEX.fullmatch(pal[k]):
            errs.append(f"{tid} : palette.{k} n'est pas une couleur #rrggbb ({pal.get(k)!r})")
    # les styles : ce que _pres garde TEL QUEL (sinon la planche montrerait autre chose que le modèle)
    styles = t.get("styles") or {}
    if set(styles) != set(ide.TEXT_STYLES):
        errs.append(f"{tid} : les six styles ({', '.join(ide.TEXT_STYLES)}) — il y a {sorted(styles)}")
    kept = (ide._pres({"styles": styles}) or {}).get("styles", {})
    for sid, st in styles.items():
        if kept.get(sid) != st:
            errs.append(f"{tid} : le style {sid} n'est pas gardé tel quel par la planche ({st} → {kept.get(sid)})")
        f = ide.FONT_IDS.get(st.get("font"))
        if f and not (f["web"] and f["pdf"]):
            errs.append(f"{tid} : le style {sid} prend {f['name']}, dont la licence ne permet ni le web ni le PDF")
    for role, bg in (t.get("slideBg") or {}).items():
        if role not in S["roles"] or bg not in S["bg"]:
            errs.append(f"{tid} : slideBg {role} → {bg}")
    for k, d in enumerate(t.get("decor") or []):
        if d.get("kind") not in S["decor"]:
            errs.append(f"{tid} : décor {k} de sorte inconnue ({d.get('kind')!r})")
        if d.get("tone") not in (None, "auto", *S["tone"]):
            errs.append(f"{tid} : décor {k}, ton {d.get('tone')!r}")
        for key in ("on", "not"):
            v = d.get(key)
            if v is not None and v != "all" and not all(r in S["roles"] for r in (v if isinstance(v, list) else [v])):
                errs.append(f"{tid} : décor {k}, rôles {v!r}")
        if "motion" in d and clean_motion(d["motion"]) != _strip(d["motion"]):
            errs.append(f"{tid} : le motion du décor {k} sort du schéma")
    M = t.get("motion") or {}
    if not isinstance(M.get("rhythm"), (int, float)) or not 0 <= M["rhythm"] <= 1000:
        errs.append(f"{tid} : motion.rhythm (0 à 1000 ms)")
    tr = M.get("trans") or {}
    if "default" not in tr:
        errs.append(f"{tid} : motion.trans.default manque")
    for role, v in tr.items():
        if role != "default" and role not in S["roles"]:
            errs.append(f"{tid} : transition d'un rôle inconnu ({role})")
        if not isinstance(v, dict) or v.get("kind") not in S["trans"] or v.get("ease", "in-out") not in S["ease"] or not 0 <= v.get("dur", 0) <= _lim("tdur")[1]:
            errs.append(f"{tid} : transition {role} hors du schéma ({v})")
    for part, mo in (M.get("parts") or {}).items():
        if part not in S["parts"]:
            errs.append(f"{tid} : motion d'une part inconnue ({part})")
        if clean_motion(mo) != _strip(mo):
            errs.append(f"{tid} : le motion de « {part} » sort du schéma ({mo} → {clean_motion(mo)})")
    if t.get("kind") == "motion" and not M.get("parts"):
        errs.append(f"{tid} : un modèle motion sans entrées")
    if t.get("kind") == "statique" and M.get("parts"):
        errs.append(f"{tid} : un modèle statique n'anime pas ses objets")
    ex = t.get("example") or {}
    slides = ex.get("slides") or []
    if not 5 <= len(slides) <= 8:
        errs.append(f"{tid} : l'exemple a {len(slides)} diapositives (5 à 8)")
    for si, sl in enumerate(slides):
        if sl.get("trans") is not None and sl["trans"] not in S["trans"]:
            errs.append(f"{tid} : diapositive {si + 1}, transition {sl['trans']!r}")
        if sl.get("bg") is not None and sl["bg"] not in S["bg"]:
            errs.append(f"{tid} : diapositive {si + 1}, fond {sl['bg']!r}")
        for oi, o in enumerate(sl.get("objects") or []):
            n = {k: v for k, v in o.items() if k != "mk"}
            n["id"] = f"x{si}o{oi}"
            if n.get("type") == "title":
                n.setdefault("size", "l")
            try:
                kept_n = ide._node(n)
            except Exception as e:  # noqa: BLE001
                errs.append(f"{tid} : diapositive {si + 1}, objet {oi + 1} refusé ({e})")
                continue
            for k in ("style", "align", "tone", "motion", "text", "item"):
                if k in n and kept_n.get(k) != n[k]:
                    errs.append(f"{tid} : diapositive {si + 1}, objet {oi + 1} : {k} n'est pas gardé tel quel ({n[k]!r} → {kept_n.get(k)!r})")
            cx, cy = o.get("x", 0) + o.get("w", 0) / 2, o.get("y", 0) + o.get("h", 0) / 2
            if not (0 < cx < 1920 and 0 < cy < 1080):
                errs.append(f"{tid} : diapositive {si + 1}, objet {oi + 1} hors de la scène (son centre)")
            if o.get("x", 0) < 0 or o.get("y", 0) < 0 or o.get("x", 0) + o.get("w", 0) > 1920 or o.get("y", 0) + o.get("h", 0) > 1080:
                errs.append(f"{tid} : diapositive {si + 1}, objet {oi + 1} déborde de la scène")
    return errs


def _strip(m):
    """Un motion écrit à la main, tel que clean_motion le rendrait s'il est juste (nombres en flottants, zéros tus)."""
    if not isinstance(m, dict):
        return None
    out = {}
    for part in ("in", "out", "loop"):
        v = m.get(part)
        if isinstance(v, dict) and not (part != "in" and v.get("fx") == "none"):
            out[part] = {k: (float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else x) for k, x in v.items()}
    if m.get("depth"):
        out["depth"] = float(m["depth"])
    if m.get("step"):
        out["step"] = int(m["step"])
    return out or None


FIGURE = re.compile(r"^\s*[+\-−]?\s*\d[\d\s.,  ]*\s*[%a-zA-Zéû€$×x+]{0,4}\s*$")


def _part(o: dict) -> str:
    """La part d'un objet, comme scene.js (partOf) la lit."""
    if o.get("type") == "media":
        return "hero" if o.get("w", 0) * o.get("h", 0) >= 0.45 * 1920 * 1080 else "image"
    if o.get("type") == "ink":
        return "stroke"
    if o.get("type") not in ("title", "note"):
        return "other"
    txt = str(o.get("text") or "").strip()
    st = o.get("style") or ("h1" if o["type"] == "title" else "body")
    if st in ("display", "h1", "h2") and FIGURE.match(txt) and len(txt) <= 14:
        return "figure"
    if re.match(r"^[«“\"„]", txt):
        return "quote"
    return {"display": "title", "h1": "title", "h2": "title", "label": "kicker", "caption": "caption"}.get(st, "body")


def _role(sl: dict, i: int, n: int) -> str:
    """Le rôle d'une diapositive, comme scene.js (roleOf) le lit."""
    p = [_part(o) for o in sl.get("objects") or []]
    c = p.count
    if i == 0:
        return "title"
    if n > 2 and i == n - 1:
        return "end"
    if c("hero"):
        return "image"
    if c("quote"):
        return "quote"
    if c("figure") >= 2:
        return "numbers"
    if c("image") >= 3:
        return "grid"
    if c("body") <= 1 and not c("image") and not c("figure") and not c("stroke") and (c("title") or c("kicker")):
        return "section"
    return "content"


def load_templates() -> list[dict]:
    return [json.loads((DIR / "modeles" / f"{i}.json").read_text(encoding="utf-8")) for i in template_ids()]


# ── le contrôle (tools/check.py) ─────────────────────────────
def selftest(call, ok) -> None:
    S = schema()
    ids = template_ids()
    tpls = load_templates()
    ok(len(ids) == 10 and len(set(ids)) == 10, f"présentations : dix modèles déclarés ({len(ids)})")
    kinds = [t.get("kind") for t in tpls]
    ok(kinds.count("motion") == 5 and kinds.count("statique") == 5, f"présentations : cinq motion, cinq statiques ({kinds})")
    for t in tpls:
        errs = validate_template(t)
        ok(not errs, f"présentations : le modèle {t.get('id')} est valide selon le schéma ({'; '.join(errs[:4])})")
    # des directions nettement différentes : ni la même police de titre, ni le même fond deux fois
    ok(len({t["palette"]["bg"] for t in tpls}) == 10, "présentations : dix fonds différents")
    ok(len({(t["styles"]["display"]["font"], t["styles"]["display"]["weight"]) for t in tpls}) >= 8, "présentations : au moins huit Display différents")
    # chaque exemple a les sept sortes de diapositives demandées (titre, section, image plein cadre,
    # citation, chiffres, grille d'images, fin) — lues comme la page les lit (scene.js, partOf / roleOf)
    want = {"title", "section", "image", "quote", "numbers", "grid", "end"}
    for t in tpls:
        roles = [_role(sl, i, len(t["example"]["slides"])) for i, sl in enumerate(t["example"]["slides"])]
        ok(want <= set(roles), f"présentations : l'exemple de {t['id']} a les sept sortes de diapositives ({roles})")
    # le moteur connaît chaque nom du schéma
    src = (DIR / "moteur.js").read_text(encoding="utf-8")
    for fx in S["fx_in"] + S["fx_out"] + S["fx_loop"]:
        ok(re.search(rf"['\"]?{re.escape(fx)}['\"]?\s*:", src) or f"'{fx}'" in src, f"présentations : moteur.js connaît l'effet {fx}")
    for e in S["ease"]:
        ok(re.search(rf"['\"]?{re.escape(e)}['\"]?\s*:", src), f"présentations : moteur.js connaît la courbe {e}")
    tsrc = (DIR / "transitions.js").read_text(encoding="utf-8")
    for k in S["trans"]:
        ok(k == "cut" or f"case '{k}'" in tsrc, f"présentations : transitions.js joue {k}")
    ssrc = (DIR / "scene.js").read_text(encoding="utf-8")
    for k in S["decor"]:
        ok(f"case '{k}'" in ssrc, f"présentations : scene.js pose le décor {k}")
    # l'interface : aucune couleur en dur (les palettes des modèles sont des données JSON)
    for name in ("presentation.css", "mode.js", "lecteur.js", "scene.js", "moteur.js", "transitions.js", "assist.js", "modeles.js", "lecture.js", "lecture.html",
                 "export.js"):
        body = (DIR / name).read_text(encoding="utf-8")
        ok(not re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", body), f"présentations : {name} n'écrit aucune couleur en dur")
    # une planche garde son motion (aller-retour par l'API), et perd ce qui sort du schéma
    st, b = call("POST", "/api/ideation/boards", {"name": "Essai présentation"})
    if st != 200:
        ok(False, f"présentations : planche d'essai ({st} {b})")
        return
    nodes = [
        {"id": "f1", "type": "frame", "x": 0, "y": 0, "w": 1920, "h": 1080, "name": "Une", "deck": {"ratio": "16:9", "trans": "fade"},
         "motion": {"trans": "curtain", "tdur": 99999, "ease": "spring", "bg": "accent", "auto": 4, "code": "alert(1)"}},
        {"id": "t1", "type": "title", "x": 96, "y": 400, "w": 1200, "h": 180, "text": "Titre", "size": "l", "style": "display", "tone": "accent",
         "motion": {"in": {"fx": "reveal", "by": "word", "dur": 900, "delay": -5, "ease": "spring", "stagger": 80, "x": 1},
                    "out": {"fx": "sink", "dur": 400}, "loop": {"fx": "float", "dur": 5000, "amp": 999}, "depth": 3, "step": 2}},
        {"id": "n1", "type": "note", "x": 96, "y": 700, "w": 800, "h": 60, "text": "corps", "style": "body", "tone": "rouge",
         "motion": {"in": {"fx": "eval", "dur": 1}}},
    ]
    from tools import ideation as ide
    st, sv = call("POST", f"/api/ideation/boards/{b['id']}", {"name": b["name"], "v": ide.VERSION, "nodes": nodes, "links": [],
                                                               "pres": {"template": "generique", "styles": {}}, "base_rev": 1})
    st2, got = call("GET", f"/api/ideation/boards/{b['id']}")
    by = {n["id"]: n for n in got.get("nodes", [])} if isinstance(got, dict) else {}
    f1, t1, n1 = by.get("f1", {}), by.get("t1", {}), by.get("n1", {})
    ok(st == 200 and f1.get("motion") == {"trans": "curtain", "tdur": 4000.0, "ease": "spring", "bg": "accent", "auto": 4.0},
       f"présentations : une diapositive garde sa transition, bornée, sans le reste ({f1.get('motion')})")
    ok(t1.get("motion") == {"in": {"fx": "reveal", "dur": 900.0, "delay": 0.0, "stagger": 80.0, "ease": "spring", "by": "word"},
                            "out": {"fx": "sink", "dur": 400.0}, "loop": {"fx": "float", "dur": 5000.0, "amp": 200.0}, "depth": 1.0, "step": 2}
       and t1.get("tone") == "accent", f"présentations : un objet garde son motion borné et son ton ({t1.get('motion')}, {t1.get('tone')})")
    ok("motion" not in n1 and "tone" not in n1, f"présentations : un effet ou un ton inconnus tombent ({n1})")
    ok(got.get("pres") == {"template": "generique"}, f"présentations : la planche garde son modèle ({got.get('pres')})")
    st, sv = call("POST", f"/api/ideation/boards/{b['id']}", {**got, "pres": {"template": "n-existe-pas"}, "base_rev": got.get("rev")})
    st2, got2 = call("GET", f"/api/ideation/boards/{b['id']}")
    ok("pres" not in got2, f"présentations : un modèle inconnu tombe ({got2.get('pres')})")
    # les fichiers de la page se servent
    for path in ("/ideation/presentation/schema.json", "/ideation/presentation/modeles/index.json", "/ideation/presentation/modeles/lumiere.json",
                 "/ideation/presentation/lecture.html", "/ideation/presentation/mode.js"):
        st, _ = call("GET", path)
        ok(st == 200, f"présentations : {path} se sert ({st})")
