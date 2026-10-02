"""La stratégie de Cal : son kit de présentation (le positionnement, le deck,
les discours), servi à Cal SEUL, depuis le dossier de données.

Le dépôt est public : le contenu stratégique (positionnement, prix, cibles)
n'y entre jamais. Il vit dans `<data_dir>/strategie/` (sur DGX2 :
`~/showrunner-data/strategie/`) ; ce module n'est que la route.

    GET /strategie/              <data_dir>/strategie/index.html
    GET /strategie/<chemin>      un fichier du dossier, sans jamais en sortir
    GET /strategie               303 vers /strategie/ (les liens du kit sont relatifs)
    GET /api/strategie/moi       {cal, pret, url} pour la page d'admin ; 403 à tout autre

Qui entre : LE compte de Cal (`auth.admin_id()`, « cal »), admin, actif. Un
autre admin, un ami, un invité d'Idéation : 403 (le kit n'est pas « la page
des admins », c'est celle de Cal). Sans session : la porte — la page rend
alors un petit document qui ouvre `commun/porte.js` (taper son pseudo) ; une
fois entré, elle se recharge et le kit s'ouvre. La porte publique « code »
(le Worker) : sans code d'invitation, porte.js mène à `/invitation/?next=`.

Chaque réponse porte `Cache-Control: no-store` (rien dans un cache partagé ni
dans l'historique du navigateur) et `X-Robots-Tag: noindex`. Un dossier
absent répond 404, proprement, en le disant à Cal. Un chemin qui sort du
dossier (`..`, `%2e%2e`, `\\`, un fichier caché, un lien) : 404.

La porte publique (porte/worker.js) : les assets publiés sont l'arbre du
dépôt moins .assetsignore — ce dossier n'y est jamais ; le Worker relaie
`/strategie/…` au portail (VERS_PORTAIL), signé, comme `/character/api/`.
"""

from __future__ import annotations

import html
from pathlib import Path
from urllib.parse import unquote

from core import auth, config
from core.http import FileResponse, HttpError, Response

PREFIX = "/strategie/"
PORTE = "/api/strategie/porte"      # la page de la porte (sans session), posée par la garde ci-dessous
VERS = "/api/strategie/vers"        # /strategie → /strategie/
HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}


def root() -> Path:
    return config.data_dir() / "strategie"


def is_cal(u: dict | None) -> bool:
    """Le compte de Cal, et lui seul : l'id `cal`, admin, actif. La maison sans
    porte (auth: false) donne `pseudo_admin()`, qui est ce compte-là."""
    return bool(u) and u.get("id") == auth.admin_id() and auth.is_admin(u) and u.get("state", "active") == "active"


# ── les pages que rend le module (sans contenu stratégique) ─
_HEAD = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<script src="/commun/theme-tot.js"></script>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/media/icone-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Showrunner">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="theme-color" content="#0a0d0b">
<meta name="robots" content="noindex, nofollow">
<title>SHOWRUNNER TOOLS · STRATÉGIE</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Azeret+Mono:wght@300;400;500&display=swap">
<link rel="stylesheet" href="/commun/tokens.css">
<link rel="stylesheet" href="/commun/base.css">
<link rel="stylesheet" href="/commun/shell.css">
<style>
  body { background: var(--bg); color: var(--ink); font-family: var(--f-ui); margin: 0; }
  .sg-note { max-width: 560px; margin: 18vh auto 0; padding: var(--s6); border-radius: var(--r4);
             background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); }
  .sg-note .ref { font-family: var(--f-mono); font-size: 10px; letter-spacing: .16em; color: var(--ink3); }
  .sg-note h1 { font-family: var(--f-disp); font-size: 18px; letter-spacing: .04em; margin: var(--s3) 0; }
  .sg-note p { color: var(--ink2); line-height: 1.55; }
  .sg-note a { color: var(--cy); }
</style>
</head>
<body>
"""


def _page(ref: str, title: str, text: str, status: int) -> Response:
    body = (_HEAD + f'<section class="sg-note"><span class="ref">{html.escape(ref)}</span>'
            f"<h1>{html.escape(title)}</h1><p>{text}</p>"
            '<p><a href="/admin/">la page d’admin</a> · <a href="/">l’accueil</a></p></section>\n</body>\n</html>\n')
    return Response(body, status, "text/html; charset=utf-8", dict(HEADERS))


def _door_page() -> Response:
    """Sans session : la porte du portail (commun/porte.js), puis la page se recharge."""
    body = (_HEAD + '<script type="module">import { showDoor } from "/commun/shell.js"; showDoor();</script>\n'
            "<noscript>la porte du portail demande JavaScript</noscript>\n</body>\n</html>\n")
    return Response(body, 401, "text/html; charset=utf-8", dict(HEADERS))


def _forbidden() -> Response:
    return _page("403 · STRATÉGIE", "Réservé à Cal",
                 "Ce kit de présentation n’est ouvert qu’au compte de Cal.", 403)


def _missing() -> Response:
    return _page("404 · STRATÉGIE", "Le kit n’est pas encore posé",
                 "Le dossier <code>strategie/</code> manque dans les données du portail "
                 "(sur DGX2 : <code>~/showrunner-data/strategie/</code>). Il n’entre jamais dans le dépôt, "
                 "qui est public : on l’y copie à la main.", 404)


# ── le chemin, jugé avant d'être résolu, puis résolu et rejugé ──
def _safe_rel(rest: str) -> str | None:
    """Le chemin relatif demandé, ou None s'il ne peut pas rester dans le dossier."""
    rel = unquote(rest or "")
    if rel == "":
        return rel
    if any(c in rel for c in ("\\", "\x00", "\r", "\n")) or rel.startswith("/"):
        return None
    parts = rel.split("/")
    if rel.endswith("/"):
        parts = parts[:-1]
    # ni segment vide, ni « . », ni « .. », ni fichier caché
    if any(p in ("", ".", "..") or p.startswith(".") for p in parts):
        return None
    return rel


def serve(req, rest: str):
    if req.method not in ("GET", "HEAD"):
        raise HttpError(405, "lecture seule")
    if not is_cal(getattr(req, "user", None)):
        return _forbidden()
    base = root()
    if not base.is_dir():
        return _missing()
    rel = _safe_rel(rest)
    if rel is None:
        raise HttpError(404, "introuvable")
    if rel == "" or rel.endswith("/"):
        rel += "index.html"
    folder = base.resolve()
    target = (folder / rel).resolve()
    if not target.is_relative_to(folder):
        raise HttpError(404, "introuvable")
    if target.is_dir():
        if (target / "index.html").is_file():
            return Response(b"", 303, "text/plain; charset=utf-8",
                            {**HEADERS, "Location": PREFIX + rel.rstrip("/") + "/"})
        raise HttpError(404, "introuvable")
    if not target.is_file():
        if rel == "index.html":
            return _missing()
        raise HttpError(404, "introuvable")
    return FileResponse(target, cache="no-store")


def r_moi(req):
    if not is_cal(getattr(req, "user", None)):
        raise HttpError(403, "réservé à Cal")
    base = root()
    return {"cal": True, "pret": (base / "index.html").is_file(), "url": PREFIX}


def r_porte(req):
    return _door_page()


def r_vers(req):
    return Response(b"", 303, "text/plain; charset=utf-8", {**HEADERS, "Location": PREFIX})


def _page_path(path: str) -> bool:
    return path == PREFIX.rstrip("/") or path.startswith(PREFIX)


def _guard(app) -> None:
    """La porte du socle (core/auth.py) répond 401 en JSON à un chemin gardé sans
    session : pour une PAGE du kit, on rend la porte à la place (même statut). Et
    `/strategie` sans barre finale mène à `/strategie/`. Rien d'autre ne change :
    le socle juge d'abord, toujours."""
    inner = app.gate
    if inner is None or getattr(inner, "_strategie", False):
        return

    def gate(req, a):
        try:
            inner(req, a)
        except HttpError as e:
            if e.status == 401 and req.method in ("GET", "HEAD") and _page_path(req.path):
                req.path = PORTE
                return
            raise
        if req.method in ("GET", "HEAD") and req.path == PREFIX.rstrip("/"):
            req.path = VERS

    gate._strategie = True
    app.gate = gate


def register(app) -> None:
    app.prefix(PREFIX, serve)
    app.route("GET", "/api/strategie/moi", r_moi)
    app.route("GET", PORTE, r_porte)
    app.route("GET", VERS, r_vers)
    _guard(app)


# ── le contrôle (tools/check.py) ────────────────────────────
def selftest(call, ok) -> None:
    import http.client
    import shutil
    import types

    base = root()
    had = base.exists()
    port = config.get("port")

    def raw(path: str, cookie: str | None = None):
        """Une requête telle quelle (le chemin n'est pas normalisé) : (statut, en-têtes, corps)."""
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
        h = {"Cookie": f"{auth.COOKIE}={cookie}"} if cookie else {}
        c.request("GET", path, headers=h)
        r = c.getresponse()
        out = (r.status, {k.lower(): v for k, v in r.getheaders()}, r.read())
        c.close()
        return out

    try:
        # la porte coupée (le contrôle) : on est Cal
        if not had:
            s, hd, body = raw("/strategie/")
            ok(s == 404 and b"pas encore pos" in body, f"stratégie : sans dossier, 404 propre ({s})")
            s, d = call("GET", "/api/strategie/moi")
            ok(s == 200 and d.get("pret") is False, f"stratégie : moi, pas prêt ({s} {d})")
        (base / "img").mkdir(parents=True, exist_ok=True)
        (base / "index.html").write_text("<!doctype html><title>kit</title>KIT-DE-CAL", "utf-8")
        (base / "img" / "a.txt").write_text("image", "utf-8")
        (base / ".cache").write_text("caché", "utf-8")
        s, hd, body = raw("/strategie/")
        ok(s == 200 and b"KIT-DE-CAL" in body and hd.get("cache-control") == "no-store",
           f"stratégie : Cal lit le kit, no-store ({s} {hd.get('cache-control')})")
        s, hd, _ = raw("/strategie")
        ok(s == 303 and hd.get("location") == "/strategie/", f"stratégie : /strategie → /strategie/ ({s})")
        s, hd, body = raw("/strategie/img/a.txt")
        ok(s == 200 and body == b"image", f"stratégie : un fichier du dossier ({s})")
        s, hd, _ = raw("/strategie/img")
        ok(s == 404, f"stratégie : un dossier sans index ({s})")
        for bad in ("/strategie/../server/showrunner.py", "/strategie/%2e%2e/%2e%2e/server/core/auth.py",
                    "/strategie/img/..%2f..%2findex.html", "/strategie/..%5cindex.html", "/strategie/.cache",
                    "/strategie//etc/passwd", "/strategie/img/%00a.txt", "/strategie/%2e%2e/auth.json"):
            s, hd, body = raw(bad)
            ok(s == 404 and b"KIT-DE-CAL" not in body and b"import" not in body,
               f"stratégie : chemin refusé {bad} ({s})")
        s, d = call("GET", "/api/strategie/moi")
        ok(s == 200 and d.get("cal") is True and d.get("pret") is True, f"stratégie : moi, prêt ({s} {d})")

        # la porte allumée : Cal, un autre admin, un ami, un invité, personne
        before = config.CFG.get("auth")
        config.CFG["auth"] = True
        auth.startup()
        made = []
        fake = types.SimpleNamespace(headers={}, door=None)
        try:
            for pseudo, role, access in (("Kimadm7", "admin", "studio"), ("Zedami7", "ami", "studio")):
                u = auth.create_friend(pseudo, by="stratégie (contrôle)", role=role, access=access)
                made.append(u["id"])
            with auth._lock:
                db = auth._data()
                db["users"]["invstrat"] = {"id": "invstrat", "name": "Invité", "pseudo": "Invité", "role": auth.GUEST,
                                           "state": "active", "created": auth.now_iso(), "quotas": {}}
                auth._save()
            made.append("invstrat")
            tok = {uid: auth._new_session(uid, fake) for uid in (auth.admin_id(), *made)}
            s, hd, body = raw("/strategie/")
            ok(s == 401 and b"showDoor" in body and b"KIT-DE-CAL" not in body and hd.get("cache-control") == "no-store",
               f"stratégie : sans session, la porte ({s})")
            s, hd, body = raw("/strategie/img/a.txt")
            ok(s == 401 and b"image" != body, f"stratégie : sans session, aucun fichier ({s})")
            s, hd, body = raw("/api/strategie/moi")
            ok(s == 401, f"stratégie : moi sans session ({s})")
            s, hd, body = raw("/strategie/", tok[auth.admin_id()])
            ok(s == 200 and b"KIT-DE-CAL" in body, f"stratégie : Cal entre ({s})")
            s, hd, body = raw("/api/strategie/moi", tok[auth.admin_id()])
            ok(s == 200 and b'"cal": true' in body, f"stratégie : moi pour Cal ({s})")
            for uid, who in (("kimadm7", "un autre admin"), ("zedami7", "un ami"), ("invstrat", "un invité")):
                s, hd, body = raw("/strategie/", tok[uid])
                ok(s == 403 and b"KIT-DE-CAL" not in body, f"stratégie : {who} refusé ({s})")
                s, hd, body = raw("/strategie/img/a.txt", tok[uid])
                ok(s == 403 and body != b"image", f"stratégie : {who}, aucun fichier ({s})")
                s, hd, body = raw("/api/strategie/moi", tok[uid])
                ok(s == 403, f"stratégie : moi refusé à {who} ({s})")
            s, hd, body = raw("/strategie/../server/showrunner.py", tok[auth.admin_id()])
            ok(s == 404, f"stratégie : Cal non plus ne remonte pas ({s})")
        finally:
            with auth._lock:
                db = auth._data()
                for uid in made:
                    db["users"].pop(uid, None)
                for k in [k for k, x in db["sessions"].items() if x.get("user") in (*made, auth.admin_id())]:
                    db["sessions"].pop(k, None)
                auth._save()
            config.CFG["auth"] = before
    finally:
        if not had:
            shutil.rmtree(base, ignore_errors=True)
