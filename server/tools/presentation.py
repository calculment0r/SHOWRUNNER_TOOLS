"""Les présentations d'Idéation : le motion et les modèles (docs/etudes/presentations.md § 10).

Ce module ne sert aucune route : il tient la RÈGLE des champs neufs d'une planche,
que ideation.normalize garde par deux petits branchements délimités (`_node`, `_pres`) :

  objet    `motion` { in: {fx, dur, delay, ease, by, stagger, dist}, out: {fx, dur, ease},
                      loop: {fx, dur, amp}, depth, step,
                      keys: {x, y, scale, rot, op: [{t, v, e, p}]} }   des données bornées, jamais du code
                    (les images clés et les courbes libres {bz}, {spring} : 06/10, courbes.js de la page)
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


def _fin(v) -> bool:
    return not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v)


def _r(v: float, nd: int) -> float:
    """Arrondi comme Math.round de la page (au plus proche, la moitié vers le haut) : les mêmes chiffres des deux côtés."""
    f = 10 ** nd
    return math.floor(v * f + 0.5) / f


def clean_ease(e):
    """Une courbe : un nom du schéma, {bz: [x1, y1, x2, y2]} ou {spring: {k, c, m}} bornés (courbes.js, cleanEase) ; sinon None."""
    S = schema()
    if isinstance(e, str):
        return e if e in S["ease"] else None
    if not isinstance(e, dict):
        return None
    F = S["ease_free"]
    bz = e.get("bz")
    if isinstance(bz, list) and len(bz) == 4 and all(_fin(v) for v in bz):
        lim = (F["bzx"], F["bzy"], F["bzx"], F["bzy"])
        return {"bz": [_r(max(lo, min(hi, float(v))), 4) for v, (lo, hi) in zip(bz, lim)]}
    sp = e.get("spring")
    if isinstance(sp, dict):
        dflt = {"k": 180, "c": 16, "m": 1}
        return {"spring": {k: (_r(max(F[k][0], min(F[k][1], float(sp[k]))), 4) if _fin(sp.get(k)) else dflt[k]) for k in ("k", "c", "m")}}
    return None


def clean_keys(raw) -> dict | None:
    """Les images clés d'un objet (courbes.js, cleanKeys) : par propriété, triées, une par instant (la
    dernière l'emporte), bornées ; t en ms dans l'étape (0,1 ms), v (4 décimales), e la courbe vers la
    suivante (linéaire : tue), p 'in' | 'out' (un préréglage). Rien de lisible : None."""
    if not isinstance(raw, dict):
        return None
    K = schema()["keys"]
    t_lo, t_hi = K["t"]
    out = {}
    for prop in ("x", "y", "scale", "rot", "op"):
        lst = raw.get(prop)
        if not isinstance(lst, list):
            continue
        lo, hi = K[prop]
        by: dict = {}
        for k in lst[: K["max"] * 4]:
            if not isinstance(k, dict) or not _fin(k.get("t")) or not _fin(k.get("v")):
                continue
            t = _r(max(t_lo, min(t_hi, float(k["t"]))), 1)
            o = {"t": t, "v": _r(max(lo, min(hi, float(k["v"]))), 4)}
            e = clean_ease(k.get("e"))
            if e and e != "linear":
                o["e"] = e
            if k.get("p") in ("in", "out"):
                o["p"] = k["p"]
            by[t] = o
        lst2 = sorted(by.values(), key=lambda x: x["t"])[: K["max"]]
        if lst2:
            out[prop] = lst2
    return out or None


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
        e = clean_ease(i.get("ease"))
        if e is not None:
            o["ease"] = e
        if i.get("by") in S["by"]:
            o["by"] = i["by"]
        out["in"] = o
    x = m.get("out")
    if isinstance(x, dict) and x.get("fx") in S["fx_out"] and x["fx"] != "none":
        o = {"fx": x["fx"]}
        v = _num(x.get("dur"), *_lim("dur"))
        if v is not None:
            o["dur"] = v
        e = clean_ease(x.get("ease"))
        if e is not None:
            o["ease"] = e
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
    k = clean_keys(m.get("keys"))
    if k:
        out["keys"] = k
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
    e = clean_ease(m.get("ease"))
    if e is not None:
        out["ease"] = e
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


# ── les courbes et les images clés (06/10) : courbes.js de la page, par node ──────────
# La note de spécification du 06/10 demande des essais RÉELS de l'interpolation et de chaque courbe :
# ils tournent sur le module de la page lui-même (le même code que le moteur et le panneau), et ses
# clés propres sont comparées à celles d'ici (clean_keys) sur les mêmes entrées.
_COURBES_JS = r"""
const C = await import(process.env.COURBES_URL);
const cases = JSON.parse(process.env.CASES);
const R = {};
R.names = C.EASE_NAMES; R.lim = C.LIM; R.props = C.KEY_PROPS.map((p) => [p.id, p.lim]); R.t = C.KEY_T; R.max = C.KEY_MAX;
const U = Array.from({ length: 101 }, (_, i) => i / 100);
R.curves = {};
for (const e of [...C.EASE_NAMES, { bz: [0, 0, 1, 1] }, { bz: [0.42, 0, 0.58, 1] }, { spring: { k: 300, c: 6, m: 1 } }, { spring: { k: 100, c: 40, m: 1 } }, { spring: { k: 180, c: 16, m: 1 } }]) {
  const f = C.easeFn(e); const ys = U.map(f);
  R.curves[typeof e === 'string' ? e : JSON.stringify(e)] = { y: ys, css: C.easeCss(e) };
}
// le ressort : la fonction JS est l'interpolation des mêmes points que linear() (ce que le navigateur peint)
const pts = C.springPoints({ k: 300, c: 6, m: 1 });
const lin = (u) => { const f = u * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)); return pts[i] + (pts[i + 1] - pts[i]) * (f - i); };
R.springMatch = Math.max(...U.map((u) => Math.abs(C.easeFn({ spring: { k: 300, c: 6, m: 1 } })(u) - lin(u))));
// les clés propres, puis leurs valeurs
R.clean = cases.map((raw) => C.cleanKeys(raw));
const K = C.cleanKeys({ x: [{ t: 100, v: 0 }, { t: 600, v: 200, e: 'in-out' }, { t: 1100, v: 100 }], op: [{ t: 300, v: 0.5 }] });
R.vals = [0, 100, 350, 600, 850, 1100, 2000].map((t) => C.keysAt(K, t));
R.mid = C.valueAt(C.cleanKeys({ x: [{ t: 0, v: 0 }, { t: 1000, v: 100 }] }).x, 500);
R.wa = C.waapiTracks(C.cleanKeys({ x: [{ t: 200, v: -50, e: 'out' }, { t: 700, v: 0 }], y: [{ t: 0, v: 10 }], op: [{ t: 0, v: 0 }, { t: 1000, v: 1, e: { bz: [0.1, 0.2, 0.3, 0.4] } }] }));
// poser, basculer, déplacer, la courbe d'une clé
let k2 = C.setKey(null, 'x', 500, 40); k2 = C.setKey(k2, 'x', 0, -40); k2 = C.toggleKey(k2, 'x', 250); R.toggle = k2.x.map((k) => [k.t, k.v]);
k2 = C.toggleKey(k2, 'x', 250); R.untoggle = k2.x.map((k) => k.t);
R.move = C.moveKeys(k2, 'x', 500, 300).x.map((k) => k.t); R.moveOnto = C.moveKeys(k2, 'x', 0, 500).x.map((k) => [k.t, k.v]);
R.ease = C.setEaseAt(k2, null, 0, { spring: { k: 50 } }).x[0].e;
// les préréglages fabriquent des clés ordinaires ; réappliquer remplace les siennes, garde les autres
let p = C.presetKeys({ x: [{ t: 2000, v: 30 }] }, 'in', { kind: 'slide', dir: 'left', dist: 80, delay: 100, dur: 600, ease: 'out' });
R.preset1 = p; p = C.presetKeys(p, 'in', { kind: 'scale', dist: 20, delay: 0, dur: 400, ease: 'in-out' }); R.preset2 = p;
R.presetOut = C.presetKeys(p, 'out', { kind: 'slide', dir: 'down', dist: 50, delay: 3000, dur: 500, ease: 'in' });
// la cascade : avant, arrière, hasard semé (reproductible)
const items = [{ id: 'a', mo: { in: { fx: 'fade', delay: 300 } } }, { id: 'b', mo: { in: { fx: 'rise', delay: 0 } } }, { id: 'c', mo: { in: { fx: 'none' }, keys: K } }, { id: 'd', mo: { in: { fx: 'none' } } }];
R.cascade = ['forward', 'reverse', 'random'].map((o) => [...C.cascade(items, { order: o, interval: 150, seed: 7 })]);
R.random2 = [...C.cascade(items, { order: 'random', interval: 150, seed: 7 })];
R.random3 = [...C.cascade(items, { order: 'random', interval: 150, seed: 8 })];
console.log(JSON.stringify(R));
"""


def _selftest_courbes(ok) -> None:
    import os
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        ok(True, "présentations : node absent, les courbes de la page ne sont pas essayées ici")
        return
    S = schema()
    cases = [
        {"x": [{"t": 300, "v": 5}, {"t": 100, "v": 1, "e": "out"}, {"t": 300, "v": 7, "p": "in"}, {"t": -10, "v": 99999, "e": {"bz": [2, 5, -1, -7]}}],
         "op": [{"t": 70000, "v": 2, "e": {"spring": {"k": 5, "c": 500, "m": "x"}}}], "rot": [{"t": "a", "v": 1}, {"t": 1, "v": True}], "w": [{"t": 1, "v": 1}]},
        {"scale": [{"t": 12.34, "v": 1.23456, "e": "linear", "p": "autre"}], "y": []},
        {"x": "rien"},
        None,
    ]
    env = {**os.environ, "COURBES_URL": (DIR / "courbes.js").as_uri(), "CASES": json.dumps(cases)}
    r = subprocess.run([node, "--input-type=module", "-e", _COURBES_JS], capture_output=True, text=True, timeout=60, env=env)
    try:
        R = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        ok(False, f"présentations : courbes.js ne répond pas ({r.returncode} {r.stderr[-400:]})")
        return
    F, K = S["ease_free"], S["keys"]
    ok(R["names"] == S["ease"], f"présentations : courbes.js et le schéma ont les mêmes courbes ({R['names']} / {S['ease']})")
    ok(R["lim"] == {"bzx": F["bzx"], "bzy": F["bzy"], "k": F["k"], "c": F["c"], "m": F["m"]} and R["t"] == K["t"] and R["max"] == K["max"]
       and all(lim == K[pid] for pid, lim in R["props"]) and [pid for pid, _ in R["props"]] == ["x", "y", "scale", "rot", "op"],
       f"présentations : courbes.js et le schéma ont les mêmes bornes ({R['lim']} {R['props']})")
    cv = R["curves"]
    for name, c in cv.items():
        y = c["y"]
        ok(abs(y[0]) < 1e-9 and abs(y[-1] - 1) < 1e-9 and c["css"] and all(v == v for v in y),
           f"présentations : la courbe {name} va de 0 à 1 ({y[0]}, {y[-1]}, {c['css'][:40]})")
    mono = lambda y: all(b >= a - 1e-9 for a, b in zip(y, y[1:]))  # noqa: E731
    lin = cv["linear"]["y"]
    ok(all(abs(v - i / 100) < 1e-9 for i, v in enumerate(lin)), "présentations : la courbe linéaire est la diagonale")
    ok(mono(cv["in"]["y"]) and cv["in"]["y"][50] < 0.25 and mono(cv["out"]["y"]) and cv["out"]["y"][50] > 0.75
       and mono(cv["in-out"]["y"]) and abs(cv["in-out"]["y"][50] - 0.5) < 1e-3 and cv["in-out"]["y"][25] < 0.25,
       f"présentations : entrée lente au début, sortie lente à la fin, entrée-sortie symétrique ({cv['in']['y'][50]:.3f} {cv['out']['y'][50]:.3f} {cv['in-out']['y'][50]:.3f})")
    ok(all(abs(a - b) < 1e-4 for a, b in zip(cv['{"bz":[0,0,1,1]}']["y"], lin)) and cv['{"bz":[0,0,1,1]}']["css"] == "cubic-bezier(0, 0, 1, 1)",
       "présentations : une cubic-bezier (0, 0, 1, 1) est la diagonale")
    # CSS ease-in-out = cubic-bezier(0.42, 0, 0.58, 1) : à x = 0,25, y ≈ 0,1291 (la courbe de WebKit, résolue ici par dichotomie)
    y25 = cv['{"bz":[0.42,0,0.58,1]}']["y"][25]
    ok(abs(y25 - 0.12916) < 2e-4, f"présentations : la cubic-bezier résolue comme le navigateur ({y25:.5f})")
    ok(max(cv["back"]["y"]) > 1.05, "présentations : le rebond dépasse avant de revenir")
    sp_lo, sp_hi = cv['{"spring":{"k":300,"c":6,"m":1}}']["y"], cv['{"spring":{"k":100,"c":40,"m":1}}']["y"]
    ok(max(sp_lo) > 1.2 and min(sp_lo[40:]) < 1 and mono(sp_hi) and max(sp_hi) <= 1 + 1e-9,
       f"présentations : le ressort peu amorti oscille, le très amorti arrive sans dépasser ({max(sp_lo):.3f}, {max(sp_hi):.3f})")
    ok(cv['{"spring":{"k":180,"c":16,"m":1}}']["css"] == cv["spring"]["css"] and cv["spring"]["css"].startswith("linear(0, ")
       and R["springMatch"] < 1e-12, f"présentations : le ressort en JS est la courbe linear() que peint le navigateur (écart {R['springMatch']})")
    # les clés propres : les mêmes ici et dans la page
    for raw, js in zip(cases, R["clean"]):
        ok(clean_keys(raw) == js, f"présentations : clean_keys et cleanKeys de la page rendent les mêmes clés ({str(raw)[:70]} → {clean_keys(raw)} / {js})")
    ok(R["clean"][0]["x"] == [{"t": 0, "v": 4000, "e": {"bz": [1, 3, 0, -2]}}, {"t": 100, "v": 1, "e": "out"}, {"t": 300, "v": 7, "p": "in"}]
       and R["clean"][0]["op"] == [{"t": 60000, "v": 1, "e": {"spring": {"k": 10, "c": 100, "m": 1}}}] and "rot" not in R["clean"][0],
       f"présentations : des clés propres — triées, une par instant (la dernière l'emporte), bornées, l'illisible laissé ({R['clean'][0]})")
    v = R["vals"]
    ok(R["mid"] == 50 and v[0]["x"] == 0 and v[1]["x"] == 0 and abs(v[2]["x"] - 100) < 1e-9 and v[3]["x"] == 200 and abs(v[4]["x"] - 150) < 1e-9
       and v[5]["x"] == 100 and v[6]["x"] == 100 and v[0]["op"] == 0.5 and v[6]["op"] == 0.5 and v[3]["scale"] == 1 and v[3]["rot"] == 0 and v[3]["y"] == 0,
       f"présentations : l'interpolation — avant la première clé sa valeur, après la dernière la sienne, linéaire entre, la courbe de la clé qui part ({v})")
    wa = {t["prop"]: t for t in R["wa"]}
    x, y, op = wa.get("x", {}), wa.get("y", {}), wa.get("op", {})
    ok(x.get("timing", {}).get("delay") == 200 and x["timing"]["duration"] == 500 and x["keyframes"][0]["translate"] == "-50px 0px"
       and x["keyframes"][0]["easing"].startswith("cubic-bezier(0.33, 1, 0.68, 1)") and x["keyframes"][1]["offset"] == 1
       and y.get("timing", {}).get("composite") == "add" and y["keyframes"][0]["translate"] == "0px 10px" and len(y["keyframes"]) == 2
       and op["keyframes"][0]["easing"] == "linear" and op["timing"]["fill"] == "both",
       f"présentations : les clés en animations Web (délai, durée, décalages, courbe par clé, translate y additionné) ({R['wa']})")
    ok(R["toggle"] == [[0, -40], [250, 0], [500, 40]] and R["untoggle"] == [0, 500] and R["move"] == [0, 800] and R["moveOnto"] == [[500, -40]]
       and R["ease"] == {"spring": {"k": 50, "c": 16, "m": 1}},
       f"présentations : poser, basculer (la valeur qui s'y voit), déplacer (sur une autre : la remplace), la courbe d'une clé "
       f"({R['toggle']} {R['untoggle']} {R['move']} {R['moveOnto']} {R['ease']})")
    p1, p2, po = R["preset1"], R["preset2"], R["presetOut"]
    ok(p1["x"] == [{"t": 100, "v": -80, "e": "out", "p": "in"}, {"t": 700, "v": 0, "p": "in"}, {"t": 2000, "v": 30}]
       and p1["op"] == [{"t": 100, "v": 0, "e": "out", "p": "in"}, {"t": 700, "v": 1, "p": "in"}],
       f"présentations : un préréglage d'entrée fabrique des clés ordinaires (glisse depuis la gauche, apparaît) ({p1})")
    ok(p2.get("x") == [{"t": 2000, "v": 30}] and p2["scale"] == [{"t": 0, "v": 0.8, "e": "in-out", "p": "in"}, {"t": 400, "v": 1, "p": "in"}]
       and [k["t"] for k in p2["op"]] == [0, 400],
       f"présentations : le réappliquer remplace ses clés, garde les autres ({p2})")
    ok(po["y"] == [{"t": 3000, "v": 0, "e": "in", "p": "out"}, {"t": 3500, "v": 50, "p": "out"}] and [k["t"] for k in po["op"]] == [0, 400, 3000, 3500]
       and po["scale"] == p2["scale"], f"présentations : une sortie s'ajoute à l'entrée (glisse vers le bas, disparaît) ({po})")
    fw, rv, rd = (dict(x) for x in R["cascade"])
    ok(fw == {"a": -300, "b": 150, "c": 200} and rv == {"c": -100, "b": 150, "a": 0} and "d" not in fw,
       f"présentations : la cascade avant, arrière (0, 150, 300 ms depuis le premier début ; un objet sans entrée ni clé n'y est pas) ({fw} {rv})")
    starts = {"a": 300, "b": 0, "c": 100}
    ok(dict(R["random2"]) == rd and sorted(starts[i] + d for i, d in rd.items()) == [0, 150, 300],
       f"présentations : la cascade au hasard semé est reproductible — la même graine, le même ordre ({rd} ; graine 8 : {dict(R['random3'])})")


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
    _selftest_courbes(ok)
    tsrc = (DIR / "transitions.js").read_text(encoding="utf-8")
    for k in S["trans"]:
        ok(k == "cut" or f"case '{k}'" in tsrc, f"présentations : transitions.js joue {k}")
    ssrc = (DIR / "scene.js").read_text(encoding="utf-8")
    for k in S["decor"]:
        ok(f"case '{k}'" in ssrc, f"présentations : scene.js pose le décor {k}")
    # l'interface : aucune couleur en dur (les palettes des modèles sont des données JSON)
    for name in ("presentation.css", "mode.js", "lecteur.js", "scene.js", "moteur.js", "transitions.js", "assist.js", "modeles.js", "lecture.js", "lecture.html",
                 "export.js", "courbes.js", "programme.js", "courbe.js"):
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
                    "out": {"fx": "sink", "dur": 400}, "loop": {"fx": "float", "dur": 5000, "amp": 999}, "depth": 3, "step": 2,
                    "keys": {"x": [{"t": 0, "v": -120, "e": {"bz": [0.3, -0.5, 0.2, 9]}, "p": "in"}, {"t": 700, "v": 0, "p": "in"}],
                             "op": [{"t": 900, "v": 1}, {"t": 1500, "v": 0.25, "e": "eval"}], "z": [{"t": 1, "v": 1}]}}},
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
                            "out": {"fx": "sink", "dur": 400.0}, "loop": {"fx": "float", "dur": 5000.0, "amp": 200.0}, "depth": 1.0, "step": 2,
                            "keys": {"x": [{"t": 0.0, "v": -120.0, "e": {"bz": [0.3, -0.5, 0.2, 3.0]}, "p": "in"}, {"t": 700.0, "v": 0.0, "p": "in"}],
                                     "op": [{"t": 900.0, "v": 1.0}, {"t": 1500.0, "v": 0.25}]}}
       and t1.get("tone") == "accent", f"présentations : un objet garde son motion borné, ses images clés et son ton ({t1.get('motion')}, {t1.get('tone')})")
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
