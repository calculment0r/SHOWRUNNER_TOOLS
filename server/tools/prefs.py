"""Les préférences, rangées par personne (docs/etudes/preferences.md).

Décision de Cal (29/09) : un panneau de préférences générales et par
outil, dont un thème clair et un éditeur de thème. Le panneau se dessine
depuis les schémas ; le serveur tient la seule vérité et refuse ce
qu'aucun schéma ne déclare.

    GET  /api/prefs                les miennes : {prefs, rev, updated, schemas}
    POST /api/prefs {patch}        fusion ; une valeur null retire la clé ; rend le tout
    GET  /api/prefs/schemas        les schémas déclarés

Un schéma = un fichier `prefs.json` : `commun/prefs.json` (le Général) et
`<dossier d'outil>/prefs.json`, chacun `{tool, title, prefs: [{key, type,
default, options|min|max|maxlength, label, help, hidden}]}`. Types :
choice (une des valeurs de `options`), toggle (vrai ou faux), number
(entre min et max), text (maxlength, 200 par défaut). Un outil qui veut une
préférence l'écrit dans son schéma : elle s'enregistre et se dessine
aussitôt, sans rien toucher ici.

Le thème « le mien » (l'éditeur, commun/theme.html) : `theme: {base: dark |
light, name, tokens: {--jeton: couleur}}` ; un nom qui n'est pas un jeton
de couleur de commun/tokens.css, ou une valeur qui n'est pas une couleur
(ni url(), ni var()) : 400. La page applique ces valeurs en ligne sur
<html> : elles ne doivent rien pouvoir charger.

Fichier : `<data_dir>/prefs/<id de la personne>.json`, écrit d'un coup
(fichier temporaire puis renommage) ; 32 Ko au plus par personne.
"""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from core import auth, config
from core.http import HttpError

MAX_BYTES = 32 * 1024
_lock = threading.Lock()
_schemas: dict = {"sig": None, "by": {}}
_tokens: dict = {"mtime": None, "names": set()}

KEY_RX = re.compile(r"^[a-z][a-zA-Z0-9_]{0,39}$")
TOOL_RX = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
TOKEN_RX = re.compile(r"^--[a-z0-9-]{1,40}$")
# le même motif que commun/theme.js (colorOk) : une couleur, rien d'autre
COLOR_RX = re.compile(r"^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)"
                      r"|hsla?\(\s*[\d.]+(deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(,\s*[\d.]+%?\s*)?\)|transparent)$", re.I)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── les schémas ─────────────────────────────────────────────
def _schema_files() -> list[Path]:
    root = config.REPO
    files = [root / "commun" / "prefs.json"]
    for d in sorted(root.iterdir()):
        if d.is_dir() and not d.name.startswith(".") and d.name not in ("commun", "server", "tools", "docs", "node_modules"):
            f = d / "prefs.json"
            if f.is_file():
                files.append(f)
    return [f for f in files if f.is_file()]


def schemas() -> dict:
    """{outil: schéma}, relus quand un fichier change (un outil qui ajoute une préférence)."""
    files = _schema_files()
    sig = tuple((str(f), f.stat().st_mtime) for f in files)
    if _schemas["sig"] == sig:
        return _schemas["by"]
    by = {}
    for f in files:
        try:
            s = json.loads(f.read_text(encoding="utf-8"))
        except ValueError as e:
            print(f"prefs : schéma illisible {f} : {e}", flush=True)
            continue
        tool = str(s.get("tool") or "")
        if not TOOL_RX.match(tool) or tool == "theme":
            print(f"prefs : schéma sans outil valable {f}", flush=True)
            continue
        s["file"] = str(f.relative_to(config.REPO)).replace("\\", "/")
        s["prefs"] = [p for p in s.get("prefs", []) if isinstance(p, dict) and KEY_RX.match(str(p.get("key", "")))]
        by[tool] = s
    _schemas.update(sig=sig, by=by)
    return by


def color_tokens() -> set[str]:
    """Les jetons de couleur de commun/tokens.css (le bloc :root) : ceux que l'éditeur peut changer."""
    f = config.REPO / "commun" / "tokens.css"
    m = f.stat().st_mtime
    if _tokens["mtime"] != m:
        src = f.read_text(encoding="utf-8")
        blk = re.search(r"^:root\s*\{(.*?)\n\}", src, re.S | re.M)
        names = set()
        for name, val in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", blk.group(1) if blk else ""):
            if COLOR_RX.match(val.strip()):
                names.add(name)
        _tokens.update(mtime=m, names=names)
    return _tokens["names"]


def _check_value(tool: str, spec: dict, v):
    where = f"{tool}.{spec['key']}"
    t = spec.get("type", "text")
    if t == "choice":
        allowed = [o[0] if isinstance(o, list) else o for o in spec.get("options", [])]
        if not any(v == a and type(v) is type(a) for a in allowed):
            raise HttpError(400, f"{where} : une valeur parmi {', '.join(json.dumps(a, ensure_ascii=False) for a in allowed)}")
        return v
    if t == "toggle":
        if not isinstance(v, bool):
            raise HttpError(400, f"{where} : vrai ou faux")
        return v
    if t == "number":
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise HttpError(400, f"{where} : un nombre")
        lo, hi = spec.get("min"), spec.get("max")
        if (lo is not None and v < lo) or (hi is not None and v > hi):
            raise HttpError(400, f"{where} : entre {lo} et {hi}")
        return v
    if t == "text":
        if not isinstance(v, str) or len(v) > int(spec.get("maxlength", 200)):
            raise HttpError(400, f"{where} : un texte de {spec.get('maxlength', 200)} signes au plus")
        return v
    raise HttpError(400, f"{where} : type de préférence inconnu ({t})")


def _check_theme(patch) -> dict:
    if not isinstance(patch, dict):
        raise HttpError(400, "theme : un objet {base, name, tokens}")
    out = {}
    for k, v in patch.items():
        if k == "base":
            if v not in ("dark", "light", None):
                raise HttpError(400, "theme.base : dark ou light")
            out[k] = v
        elif k == "name":
            if v is not None and (not isinstance(v, str) or len(v) > 60):
                raise HttpError(400, "theme.name : 60 signes au plus")
            out[k] = v
        elif k == "tokens":
            if v is None:
                out[k] = None
                continue
            if not isinstance(v, dict):
                raise HttpError(400, "theme.tokens : {--jeton: couleur}")
            known = color_tokens()
            toks = {}
            for n, c in v.items():
                if not TOKEN_RX.match(str(n)) or n not in known:
                    raise HttpError(400, f"theme.tokens : « {n} » n'est pas un jeton de couleur de commun/tokens.css")
                if c is not None and (not isinstance(c, str) or len(c) > 64 or not COLOR_RX.match(c.strip())):
                    raise HttpError(400, f"theme.tokens : {n} : une couleur (#rrggbb, rgb(), rgba(), hsl()), rien d'autre")
                toks[n] = c.strip() if isinstance(c, str) else None
            out[k] = toks
        else:
            raise HttpError(400, f"theme : clé inconnue « {k} »")
    return out


def validate(patch: dict) -> dict:
    if not isinstance(patch, dict):
        raise HttpError(400, "patch : un objet {outil: {clé: valeur}}")
    by = schemas()
    out = {}
    for tool, vals in patch.items():
        if tool == "theme":
            out["theme"] = _check_theme(vals)
            continue
        if tool not in by:
            raise HttpError(400, f"outil sans préférences déclarées : « {tool} » (il lui faut un prefs.json)")
        if vals is None:
            out[tool] = None
            continue
        if not isinstance(vals, dict):
            raise HttpError(400, f"{tool} : un objet {{clé: valeur}}")
        specs = {p["key"]: p for p in by[tool]["prefs"]}
        clean = {}
        for k, v in vals.items():
            if k not in specs:
                raise HttpError(400, f"préférence inconnue : {tool}.{k} (à déclarer dans {by[tool]['file']})")
            clean[k] = None if v is None else _check_value(tool, specs[k], v)
        out[tool] = clean
    return out


# ── le fichier d'une personne ───────────────────────────────
def _dir() -> Path:
    d = config.data_dir() / "prefs"
    d.mkdir(exist_ok=True)
    return d


def _file(uid: str) -> Path:
    if not re.fullmatch(r"[a-z0-9-]{1,40}", uid or ""):
        raise HttpError(400, "personne inconnue")
    return _dir() / f"{uid}.json"


def read(uid: str) -> dict:
    f = _file(uid)
    if not f.exists():
        return {"prefs": {}, "rev": 0, "updated": None}
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
    except ValueError:
        return {"prefs": {}, "rev": 0, "updated": None}
    return {"prefs": d.get("prefs") or {}, "rev": int(d.get("rev") or 0), "updated": d.get("updated")}


def _merge(cur: dict, patch: dict) -> dict:
    out = dict(cur)
    for k, v in patch.items():
        if v is None:
            out.pop(k, None)
        elif isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
            if not out[k]:
                out.pop(k)
        elif isinstance(v, dict):
            sub = _merge({}, v)
            if sub:
                out[k] = sub
        else:
            out[k] = v
    return out


def write(uid: str, patch: dict) -> dict:
    clean = validate(patch)
    with _lock:
        cur = read(uid)
        prefs = _merge(cur["prefs"], clean)
        doc = {"prefs": prefs, "rev": cur["rev"] + 1, "updated": now_iso()}
        raw = json.dumps(doc, ensure_ascii=False, indent=1)
        if len(raw.encode("utf-8")) > MAX_BYTES:
            raise HttpError(413, f"préférences trop grosses : {MAX_BYTES // 1024} Ko au plus")
        f = _file(uid)
        tmp = f.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(raw)
        tmp.replace(f)
    return doc


# ── les routes ──────────────────────────────────────────────
def _uid(req) -> str:
    u = getattr(req, "user", None) or auth.current()
    if not u:
        raise HttpError(401, "connexion requise")
    return u["id"]


def public_schemas() -> list[dict]:
    return [{k: v for k, v in s.items()} for s in schemas().values()]


def r_get(req):
    d = read(_uid(req))
    return {**d, "schemas": public_schemas(), "tokens": sorted(color_tokens())}


def r_post(req):
    body = req.json()
    if not isinstance(body.get("patch"), dict):
        raise HttpError(400, "{patch: {outil: {clé: valeur}}} attendu")
    raw = json.dumps(body["patch"], ensure_ascii=False)
    if len(raw.encode("utf-8")) > MAX_BYTES:
        raise HttpError(413, f"préférences trop grosses : {MAX_BYTES // 1024} Ko au plus")
    return write(_uid(req), body["patch"])


def r_schemas(req):
    return {"schemas": public_schemas(), "tokens": sorted(color_tokens())}


def register(app) -> None:
    app.route("GET", "/api/prefs", r_get)
    app.route("POST", "/api/prefs", r_post)
    app.route("GET", "/api/prefs/schemas", r_schemas)


# ── le contrôle (tools/check.py) ────────────────────────────
def selftest(call, ok) -> None:
    st, d = call("GET", "/api/prefs")
    ok(st == 200 and isinstance(d.get("prefs"), dict) and d.get("rev") is not None, f"prefs : les miennes se lisent ({st} {d if st != 200 else ''})")
    tools = {s["tool"] for s in d.get("schemas", [])}
    ok("general" in tools, f"prefs : le schéma Général est lu ({sorted(tools)})")
    ok({"asset", "image", "movie", "upscale", "object", "admin"} <= tools, f"prefs : les schémas des outils sont lus ({sorted(tools)})")
    ok("--or" in d.get("tokens", []) and "--f-ui" not in d.get("tokens", []), "prefs : les jetons de couleur de tokens.css, et eux seuls")
    rev0 = d.get("rev", 0)

    st, d = call("POST", "/api/prefs", {"patch": {"general": {"theme": "light", "scale": 110}}})
    ok(st == 200 and d["prefs"]["general"] == {"theme": "light", "scale": 110} and d["rev"] == rev0 + 1,
       f"prefs : thème clair et taille 110 rangés ({st} {d})")
    st, d = call("GET", "/api/prefs")
    ok(d["prefs"].get("general", {}).get("theme") == "light", "prefs : relus tels quels")
    st, d = call("POST", "/api/prefs", {"patch": {"general": {"scale": None}, "asset": {"sort": "title", "size": 240}}})
    ok(st == 200 and d["prefs"]["general"] == {"theme": "light"} and d["prefs"]["asset"] == {"sort": "title", "size": 240},
       f"prefs : null retire une clé, un autre outil se range à côté ({d.get('prefs')})")

    for patch, why in (({"general": {"theme": "violet"}}, "une valeur hors du choix"),
                       ({"general": {"scale": "110"}}, "110 en texte n'est pas 110"),
                       ({"general": {"undoSay": "oui"}}, "un interrupteur veut vrai ou faux"),
                       ({"general": {"inconnue": 1}}, "une clé non déclarée"),
                       ({"nulle-part": {"x": 1}}, "un outil sans schéma"),
                       ({"asset": {"size": 5000}}, "un nombre hors bornes"),
                       ({"theme": {"tokens": {"--nexiste-pas": "#fff"}}}, "un jeton qui n'existe pas"),
                       ({"theme": {"tokens": {"--or": "url(http://ailleurs/x.png)"}}}, "une url à la place d'une couleur"),
                       ({"theme": {"tokens": {"--or": "var(--bg)"}}}, "var() à la place d'une couleur"),
                       ({"theme": {"tokens": {"--f-ui": "#fff"}}}, "une fonte n'est pas une couleur"),
                       ({"theme": {"base": "sepia"}}, "une base hors sombre et clair")):
        st, d = call("POST", "/api/prefs", {"patch": patch})
        ok(st == 400 and d.get("error"), f"prefs : refusé, {why} ({st} {d})")
    st, d = call("POST", "/api/prefs", {"patch": {"theme": {"base": "light", "name": "essai",
                                                             "tokens": {"--or": "#b04020", "--bg": "rgba(240, 240, 236, 1)"}}}})
    ok(st == 200 and d["prefs"]["theme"]["tokens"]["--or"] == "#b04020", f"prefs : un thème à moi, deux jetons ({st} {d})")
    st, d = call("POST", "/api/prefs", {"patch": {"theme": {"tokens": {"--or": None}}}})
    ok(st == 200 and d["prefs"]["theme"]["tokens"] == {"--bg": "rgba(240, 240, 236, 1)"}, "prefs : un jeton revient au défaut")
    st, d = call("POST", "/api/prefs", {"patch": {"general": {"langue": "x" * (MAX_BYTES + 10)}}})
    ok(st == 413, f"prefs : un envoi trop gros est refusé ({st})")
    st, _ = call("POST", "/api/prefs", {"prefs": {}})
    ok(st == 400, "prefs : sans patch, refusé")

    # par personne : la porte allumée, deux pseudos, deux jeux de préférences
    from core import config as cfg
    from tools.admin import essai_http as H
    before = cfg.CFG.get("auth")
    cfg.CFG["auth"] = True
    auth.startup()
    same = {"Origin": f"http://127.0.0.1:{cfg.get('port')}"}
    try:
        s, _, _ = H("GET", "/api/prefs")
        ok(s == 401, f"prefs : sans session, refusé ({s})")
        s, _, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        s, d, _ = H("POST", "/api/prefs", {"patch": {"general": {"theme": "light", "langue": "en"}}}, cookie=cal, headers=same)
        ok(s == 200 and d["prefs"]["general"]["langue"] == "en", f"prefs : Cal range les siennes ({s})")
        s, _, t2 = H("POST", "/api/auth/enter", {"name": "Prefessai"}, headers=same)
        H("POST", "/api/admin/requests/prefessai/accept", cookie=cal, headers=same)
        s, d, _ = H("GET", "/api/prefs", cookie=t2)
        ok(s == 200 and d["prefs"] == {}, f"prefs : un autre pseudo ne voit pas celles de Cal ({s} {d.get('prefs') if isinstance(d, dict) else d})")
        s, d, _ = H("POST", "/api/prefs", {"patch": {"general": {"theme": "dark"}}}, cookie=t2, headers=same)
        ok(s == 200, f"prefs : l'autre range les siennes ({s} {d})")
        ok(read("cal")["prefs"]["general"]["theme"] == "light" and read("prefessai")["prefs"]["general"]["theme"] == "dark",
           "prefs : chacun les siennes, dans son fichier")
        s, d, _ = H("POST", "/api/prefs", {"patch": {"general": {"theme": "light"}}}, cookie=t2, headers={"Origin": "http://ailleurs.example"})
        ok(s == 403, f"prefs : une écriture venue d'une autre page est refusée ({s})")
        s, d, t3 = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        s, d, _ = H("GET", "/api/prefs", cookie=t3)
        ok(s == 200 and d["prefs"]["general"]["langue"] == "en", f"prefs : le même pseudo, un autre navigateur, les mêmes préférences ({s})")
    finally:
        cfg.CFG["auth"] = before
        auth.set_current(None)
