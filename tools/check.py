#!/usr/bin/env python3
"""Le contrôle du portail, sans GPU : le socle, puis le `selftest` de
chaque outil qui en a un. Rend 0 si tout passe.

    python3 tools/check.py

Il lance le serveur dans ce processus, sur un port libre et des données
jetables, et le mène par son API comme une page le ferait. Un outil
ajoute ses propres essais par une fonction `selftest(call, ok)` dans son
module `server/tools/<outil>.py` : `call(méthode, chemin, corps=None,
brut=None)` rend (statut, réponse) ; `ok(condition, message)` compte.
"""

from __future__ import annotations

import importlib
import json
import os
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DATA = tempfile.mkdtemp(prefix="sr_check_")
os.environ["SHOWRUNNER_DATA"] = DATA
sys.path.insert(0, str(REPO / "server"))

with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    PORT = s.getsockname()[1]
os.environ["SHOWRUNNER_PORT"] = str(PORT)

from core import config, jobs  # noqa: E402

config.CFG["lanes"] = {"cpu": ["local"]}  # aucun GPU pour le contrôle
# la porte coupée pour les outils : tout se passe comme si Cal était connecté ;
# la porte elle-même s'essaie à part, allumée (server/tools/compte.py, admin.py)
config.CFG["auth"] = False
import showrunner  # noqa: E402

BASE = f"http://127.0.0.1:{PORT}"
passed, failed = 0, []


def ok(cond: bool, msg: str) -> None:
    global passed
    if cond:
        passed += 1
    else:
        failed.append(msg)
        print("  ÉCHEC", msg)


def call(method: str, path: str, body=None, raw: bytes | None = None, headers: dict | None = None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        txt, status = e.read(), e.code
    try:
        return status, json.loads(txt)
    except ValueError:
        return status, txt


def tiny_png(w: int = 64, h: int = 48, color=(200, 90, 60)) -> bytes:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "PNG")
    return buf.getvalue()


def core_checks() -> None:
    st, home = call("GET", "/")
    ok(st == 200 and b"Showrunner" in home or b"SHOWRUNNER" in home, "l'accueil se sert")
    st, _ = call("GET", "/commun/shell.js")
    ok(st == 200, "shell.js se sert")
    for bad in ("/server/showrunner.py", "/../etc/passwd", "/commun/../server/core/config.py", "/.git/config",
                "/library/../jobs.json"):
        st, _ = call("GET", bad)
        ok(st == 404, f"refusé : {bad} ({st})")
    st, up = call("PUT", "/api/library/upload?name=essai.png&title=Essai", raw=tiny_png())
    ok(st == 200 and up.get("kind") == "image" and up.get("width") == 64, f"dépôt d'une image ({st} {up})")
    iid = up.get("id")
    st, got = call("GET", f"/api/library/{iid}")
    ok(st == 200 and got.get("url", "").startswith(f"library/{iid}/"), "l'objet a son adresse")
    st, raw = call("GET", "/" + got.get("url", ""))
    ok(st == 200 and isinstance(raw, bytes) and raw[:4] == b"\x89PNG", "le fichier se lit")
    st, raw = call("GET", "/" + got.get("url", ""), headers={"Range": "bytes=0-3"})
    ok(st == 206 and raw == b"\x89PNG", "requête partielle (Range)")
    st, bad = call("PUT", "/api/library/upload?name=x.eps", raw=b"%!PS")
    ok(st == 415, "un EPS est refusé (Ghostscript, audit du 28/09)")
    st, el = call("POST", "/api/elements", {"title": "Perso", "type": "character", "description": "un homme",
                                            "refs": [{"item": iid, "role": "face"}]})
    ok(st == 200 and el.get("kind") == "element" and el["element"]["refs"][0]["role"] == "face", f"un élément ({st} {el})")
    st, el2 = call("POST", f"/api/elements/{el.get('id')}/refs", {"item": iid, "role": "full body"})
    ok(st == 200 and len(el2["element"]["refs"]) == 2, "une référence ajoutée")
    st, upd = call("POST", f"/api/library/{iid}", {"title": "Renommée", "fav": True, "folder": "Essais"})
    ok(st == 200 and upd["title"] == "Renommée" and upd["folder"] == "Essais", "renommer, ranger")
    st, lst = call("GET", "/api/library?kind=image&folder=Essais")
    ok(st == 200 and lst["total"] == 1 and "Essais" in lst["folders"], "filtrer par dossier")
    st, lst = call("GET", "/api/library?q=homme")
    ok(st == 200 and any(i["kind"] == "element" for i in lst["items"]), "chercher dans les descriptions")

    # la file : un travail factice sur la voie cpu
    def echo(ctx):
        ctx.progress(0.5, "à mi-chemin")
        p = ctx.workdir / "o.png"
        p.write_bytes(tiny_png(32, 32, (10, 200, 10)))
        ctx.add(p, kind="image", title="sortie", parents=[ctx.params["src"]])
        return {"note": "fini"}

    jobs.register("check.echo", echo, lane="cpu")
    st, j = call("POST", "/api/jobs", {"kind": "check.echo", "params": {"src": iid}, "title": "écho"})
    ok(st == 200 and j["state"] == "queued", "un travail en file")
    for _ in range(50):
        st, j = call("GET", f"/api/jobs/{j['id']}")
        if j["state"] in ("done", "error"):
            break
        time.sleep(0.2)
    ok(j["state"] == "done" and len(j["items"]) == 1 and j["items"][0]["parents"] == [iid], f"le travail range sa sortie ({j})")
    st, _ = call("POST", "/api/jobs", {"kind": "n.existe.pas", "params": {}})
    ok(st == 400, "un travail inconnu est refusé")
    st, _ = call("POST", f"/api/library/{iid}/delete")
    st, gone = call("GET", f"/api/library/{iid}")
    ok(gone == {"error": f"introuvable : {iid}"} or st == 404, "la corbeille")
    st, back = call("POST", f"/api/library/{iid}/restore")
    ok(st == 200 and back["id"] == iid, "retour de la corbeille")


def main() -> int:
    app = showrunner.build()
    jobs.start()
    threading.Thread(target=app.serve, args=("127.0.0.1", PORT), daemon=True).start()
    for _ in range(50):
        try:
            urllib.request.urlopen(BASE + "/api/library", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    print("le socle")
    core_checks()
    import tools
    import pkgutil
    for mod in sorted(pkgutil.iter_modules(tools.__path__), key=lambda m: m.name):
        m = importlib.import_module(f"tools.{mod.name}")
        if hasattr(m, "selftest"):
            print(mod.name)
            try:
                m.selftest(call, ok)
            except Exception as e:  # un selftest qui plante est un échec, pas un arrêt
                ok(False, f"{mod.name} : selftest a planté : {type(e).__name__}: {e}")
    print(f"\n{passed} passés, {len(failed)} en échec — données dans {DATA}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
