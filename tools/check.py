#!/usr/bin/env python3
"""Le contrôle du portail, sans GPU : le socle, puis le `selftest` de
chaque outil qui en a un. Rend 0 si tout passe.

    python3 tools/check.py
    python3 tools/check.py chanson documents   # seulement ces selftests (plus vite)
    python3 tools/check.py socle garde chanson # « socle », « garde », « registre », « isolement » les ajoutent

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
# les alertes de Cal (core/alertes.py) : jamais le vrai bot — un réglage d'essai, absent tant que le selftest
# d'alertes.py ne le pose pas (contre le faux Telegram) ; sur DGX2, le contrôle n'écoute ni n'écrit au bot de Cal
config.CFG["alertes"] = {"fichier": str(Path(DATA) / "telegram-essai.json")}
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
    # 05/10 : tout fichier entre (un document, server/tools/documents.py) ; un EPS n'est jamais lu par
    # PIL (Ghostscript, audit du 28/09) : rangé tel quel, il se télécharge ; sa vignette est une carte dessinée
    ok(st == 200 and bad.get("kind") == "document" and bad.get("file") == "main.eps" and bad.get("doc", {}).get("format") == "eps",
       f"un EPS devient un document, jamais lu par PIL (Ghostscript, audit du 28/09) ({st} {bad.get('kind') if isinstance(bad, dict) else bad})")
    # 06/10 (Cal : « un cadre Vidéos avec les sons dedans ») : un .webm, un .mp4 sans piste d'image sont des sons
    import shutil
    import subprocess
    if shutil.which("ffmpeg"):
        tmp = Path(tempfile.mkdtemp(prefix="sr_son_"))
        got = {}
        for name, args in (("voix.webm", ["-f", "lavfi", "-i", "sine=frequency=330:duration=1", "-c:a", "libopus"]),
                           ("voix.mp4", ["-f", "lavfi", "-i", "sine=frequency=330:duration=1", "-c:a", "aac"]),
                           ("plan.webm", ["-f", "lavfi", "-i", "testsrc=size=160x90:rate=10", "-t", "1", "-c:v", "libvpx-vp9"])):
            subprocess.run(["ffmpeg", "-v", "error", "-y", *args, str(tmp / name)], capture_output=True, timeout=60)
            st, it = call("PUT", f"/api/library/upload?name={name}&title={name}", raw=(tmp / name).read_bytes())
            got[name] = (st, it.get("kind") if isinstance(it, dict) else it, it.get("duration") if isinstance(it, dict) else None)
        ok(got["voix.webm"][:2] == (200, "audio") and got["voix.mp4"][:2] == (200, "audio") and got["voix.webm"][2]
           and got["plan.webm"][:2] == (200, "video"),
           f"un .webm et un .mp4 sans image rangés en sons, une vraie vidéo reste une vidéo ({got})")
        shutil.rmtree(tmp, ignore_errors=True)
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

    jobs.register("check.echo", echo, lane="cpu", cost="cpu")
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


# ── la garde du calcul (docs/etudes/equipes_espaces.md § 2.5, point 5) ──
# Les routes d'outils qui lancent chaque sorte : relevées pendant les contrôles des
# outils (la première requête qui a mené à jobs.submit pour cette sorte), puis
# rejouées telles quelles par un guest. Un outil neuf qui lance une sorte par sa
# route et l'essaie dans son selftest est couvert sans rien écrire ici.
_REQ = threading.local()
ROUTES: dict[str, list] = {}   # sorte → les requêtes (distinctes, 8 au plus) qui l'ont lancée
# une sorte que le selftest de son outil ne lance pas : la requête d'une sœur, un réglage changé
VARIANTES = {"music.gen.yue": ("music.gen.ace", {"model": "yue", "task": "chanson", "v": {"tags": "pop", "n": 1}}),
             "music.midi.gpu": ("music.midi", {"engine": "bytedance"}),
             # le selftest d'analyse laisse son dossier de sortie : un autre titre, un autre dossier
             "analyse.run": ("analyse.run", {"titre": "Garde du calcul"})}
# les sortes qui n'ont pas d'autre route que la route commune (en plus des sortes
# `direct`, dont la page passe par POST /api/jobs) — chacune avec sa raison
SANS_ROUTE_OUTIL = {
    "library.views": "sa route (POST /api/library/views) est à Cal ; sinon le rattrapage au démarrage, sans personne",
    "check.echo": "essai du socle",
    "check.chaine": "essai de la garde : un travail qui en lance un autre",
    "check.canari": "essai de l'isolement : le témoin, un travail en file dans Général",
    "compte.essai": "essai de la porte",
    "droits.route": "essai des droits : une sorte qui a sa route",
    "essai.krea2": "essai de l'ordonnanceur", "essai.qwen21": "essai de l'ordonnanceur",
    "essai.zimage": "essai de l'ordonnanceur", "essai.h3": "essai de l'ordonnanceur",
    "lora.train": "il ne part que si l'entraîneur de son modèle est installé (tools/lora_install.sh) ; son parcours est celui de lora.train_factice, essayé",
}
# un chemin d'essai pour chaque motif de auth.COMPUTE_ROUTES
COMPUTE_SAMPLES = {r"/character/.*": "/character/api/essai-garde", r"/api/movie/h3/start": "/api/movie/h3/start",
                   r"/api/analyse/diar/analyse": "/api/analyse/diar/analyse"}


# écrites ici : une sorte que rien ne lance dans les selftests (l'édition d'image n'y est essayée
# qu'à blanc, `dry`) ; une traduction, sur un document du guest (celui de Cal lui est fermé avant)
ECRITES = {"image.edit": lambda fx, g: ("POST", "/api/image/edit",
                                        {"source": fx["image"], "tool": "instruct", "model": "qwen21", "prompt": "un chapeau"}),
           "transcrire.translate": lambda fx, g: fx["trn"].get(g)}


def tool_requests(kind: str, fx: dict, g: str) -> list:
    """Les requêtes de la route de l'outil qui lancent `kind` : relevées, dérivées d'une sœur
    (VARIANTES), ou écrites ici (ECRITES) pour le guest `g`."""
    recs = list(ROUTES.get(kind, []))
    if kind in VARIANTES:
        src, patch = VARIANTES[kind]
        for method, path, raw, ctype in ROUTES.get(src, []):
            try:
                body = json.loads(raw or b"{}")
            except ValueError:
                continue
            recs.append((method, path, json.dumps({**body, **patch}).encode(), ctype or "application/json"))
    if kind in ECRITES:
        w = ECRITES[kind](fx, g)
        if w:
            method, path, body = w
            recs.append((method, path, json.dumps(body).encode(), "application/json"))
    return recs


def record_routes(app) -> None:
    from core.http import StreamResponse
    gate0, after0, submit0, dispatch0 = app.gate, app.after, jobs.submit, app.dispatch

    def gate(req, a):
        _REQ.r = req
        return gate0(req, a)

    def dispatch(req):
        out = dispatch0(req)
        req._sr_read = req.method == "GET" and not isinstance(out, StreamResponse)   # un flux ne se rejoue pas
        return out

    def after(req, status):
        _REQ.r = None
        if getattr(req, "_sr_read", False) and 200 <= status < 300:
            record_read(req._h.path)
        return after0(req, status)

    def submit(kind, *a, **kw):
        r = getattr(_REQ, "r", None)
        if r is not None and r.method in ("POST", "PUT") and not r.path.startswith("/api/jobs"):
            rec = (r.method, r._h.path, r._body or b"", r.headers.get("Content-Type") or "")
            got = ROUTES.setdefault(kind, [])
            if rec not in got and len(got) < 8:
                got.append(rec)
        return submit0(kind, *a, **kw)

    app.gate, app.after, jobs.submit, app.dispatch = gate, after, submit, dispatch


# ── l'isolement des Workspaces (docs/etudes/equipes_espaces.md § 2.3, § 3.1, étape 2) ──
# Les lectures des pages : chaque GET qui a répondu 2xx pendant les contrôles des outils
# (trois adresses au plus par forme d'adresse), rejouées ensuite par une personne d'une
# autre Team. Un outil neuf dont le selftest lit ses documents est couvert sans rien
# écrire ici.
READS: dict[str, list] = {}
ID_ANY = r"[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}"
SHAPE_RX = __import__("re").compile(ID_ANY + r"|job-\d{4}-\d{6}-[0-9a-f]{4}|(?:esp|tea|msp|inv)-[a-z0-9-]{4,48}|[0-9a-f]{16,}|\d+")


def record_read(path: str) -> None:
    if not path.startswith(("/api/", "/library/")):
        return
    got = READS.setdefault(SHAPE_RX.sub("·", path), [])
    if path not in got and len(got) < 3:
        got.append(path)


# Ce que chaque outil écrit sous <data_dir>, et d'où son Workspace lui vient : l'inventaire,
# vérifié sur les données que laissent les contrôles. Une entrée qu'il ne connaît pas fait
# échouer le contrôle (l'outil qui l'écrit dit d'abord à qui elle est). « champ » : chaque
# document y porte `space`, un Workspace connu (library.stamp, new_space à la naissance ;
# keep à chaque réécriture) ; « Workspace » : un fichier, ou une clé, par Workspace ;
# « parent » : il suit le document ou l'objet dont il dépend ; « personne », « instance » :
# à personne d'autre ; « cache », « temporaire » : ce qu'un calcul ou un aperçu refait.
def _json(p):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _docs(*globs):
    return lambda root: ((str(p.relative_to(root)), _json(p)) for g in globs for p in sorted(root.glob(g))
                         if not p.name.endswith(".voix.json"))


def _projets(root):
    for x in (_json(root / "analyse" / "projets.json") or {}).get("projets") or []:
        if isinstance(x, dict) and x.get("auteur"):   # un projet créé dans le portail (pas un film du dépôt)
            yield f"analyse/projets.json#{x.get('id')}", x


def _journal(root):
    try:
        lines = (root / "elements" / "journal.jsonl").read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for k, line in enumerate(lines):
        try:
            yield f"elements/journal.jsonl:{k + 1}", json.loads(line)
        except ValueError:
            continue


STORES = {
    "library": ("champ", "les objets de la bibliothèque : item.json (library._owned, new_space)", _docs("library/*/item.json")),
    "trash": ("champ", "la corbeille : l'objet et son item.json, son Workspace gardé", _docs("trash/*/item.json")),
    "musique": ("champ", "les projets ODIO (music.py : library.stamp, keep)", _docs("musique/mus-*.json")),
    "ideation": ("champ", "les planches d'Idéation (ideation._write : new_space, board_space)", _docs("ideation/ide-*.json")),
    "transcrire": ("champ", "les transcriptions (library.stamp, du son) ; <id>.voix.json : celle de sa transcription",
                   _docs("transcrire/trn-*.json")),
    "luts": ("champ", "les LUT du Montage (montage.py)", _docs("luts/lut-*.json")),
    "image_atelier": ("champ", "les sessions de l'atelier d'Image (library.stamp, de l'image source)", _docs("image_atelier/*.json")),
    "paroles": ("champ", "les paroles calées d'un son (library.stamp, du son)", _docs("paroles/*.json")),
    "analyse": ("champ", "Movie Analysis : projets.json (chaque projet créé ici porte space) ; corrections/ : par film", _projets),
    "elements": ("champ", "le journal des éléments : chaque ligne porte space", _journal),
    "montage": ("Workspace", "projet/<Workspace>.json : le Projet du Montage ; migres/ : les montages d'avant les séquences", None),
    "chanson": ("Workspace", "spaces.json : les Spaces de Musique, une table par Workspace ; odio.json, ondes/ : par son", None),
    "asset_folders.json": ("Workspace", "les dossiers déclarés d'Asset, une liste par Workspace", None),
    "analyses": ("parent", "les dépouillements de Movie Analysis : ceux de leur projet (analyse/projets.json)", None),
    "ecoute": ("parent", "les liens d'écoute : ceux de leur playlist ; mesures.json : un cache par fichier", None),
    "lora": ("parent", "l'état d'un LoRA : celui de son moodboard (sa planche)", None),
    "ideation_collab": ("parent", "l'accès, les liens, le fil de chaque planche", None),
    "ideation_agent": ("parent", "les conversations de l'agent sur une planche", None),
    "prefs": ("personne", "les préférences de chacun", None),
    "strategie": ("personne", "le kit de présentation de Cal", None),
    "auth.json": ("instance", "les comptes, les connexions", None),
    "teams.json": ("instance", "les Teams, les Workspaces, les liens d'invitation", None),
    "instance.json": ("instance", "l'identité mondiale de l'instance (uid)", None),
    "jobs.json": ("instance", "la file : chaque travail porte son Workspace (space)", None),
    "queue.json": ("instance", "l'état de la file", None),
    "durations.json": ("instance", "les durées mesurées, par sorte", None),
    "conso.jsonl": ("instance", "la consommation : chaque ligne porte sa Team et son Workspace", None),
    "journal.jsonl": ("instance", "le journal des écritures : chaque ligne porte son Workspace", None),
    "porte-demo.json": ("instance", "les codes de la porte", None),
    "alertes.json": ("instance", "les alertes de Cal (Telegram) : les décisions en attente, l'offset, le dernier envoi", None),
    "movie_h3.json": ("instance", "l'état du serveur H3", None),
    "ideation_web": ("cache", "les aperçus d'adresses web : le web public", None),
    "echantillons": ("instance", "les banques d'échantillons d'ODIO, communes au portail (VCSL, Salamander : "
                     "server/tools/music_banques.py, importées par tools/echantillons.py)", None),
    "image_masks": ("temporaire", "les zones peintes d'une édition d'Image, lues par son travail", None),
    "uploads": ("temporaire", "les dépôts en cours", None),
    "work": ("temporaire", "le dossier de travail de chaque calcul", None),
    "zips": ("temporaire", "les zips d'Asset (un jeton par zip)", None),
    "cf_import": ("temporaire", "les imports de Character Factory en cours", None),
    "sauvegarde-espaces-*": ("instance", "la sauvegarde de la migration des Workspaces", None),
    "*essai*": ("essai", "ce que laissent les selftests (données jetables)", None),
    "*selftest*": ("essai", "ce que laissent les selftests (données jetables)", None),
}


# Le registre de l'agent (docs/etudes/agent_autonome.md § 5.6) : chaque sorte de la file est le TRAVAIL d'une capacité
# (agent/capacites/*.json), ou marquée ici interne, avec sa raison — comme STORES pour <data_dir>. Toutes les sortes, pas
# seulement celles de coût gpu ou api : dans le contrôle, la plupart des sortes GPU s'enregistrent sur la voie cpu (les
# moteurs factices) ; le coût qu'on y lit ne dit pas celui des DGX. Une sorte neuve sans fiche fait échouer le contrôle.
INTERNES = {
    "ideation.agent": "l'agent lui-même : un tour de la conversation",
    "ideation.palier": "l'agent lui-même : un palier d'arrière-plan de l'entrée d'un projet",
    "ideation.export": "l'export PNG d'une planche, lancé par sa page",
    "library.views": "les copies d'affichage de la bibliothèque, faites par le portail",
    "ecoute.zip": "le zip d'un lien d'écoute, lancé par sa page",
    "ecoute.publier": "une publication : jamais par l'agent (agent_autonome.md § 5.10)",
    "paroles.caler": "le calage des paroles d'un son, lancé par la page de Musique",
    "lora.train": "l'entraînement d'un LoRA, lancé par son moodboard (Idéation) : hors du vocabulaire de l'agent",
    "lora.train_factice": "l'essai sans GPU de lora.train",
    "objet.mesh_factice": "le moteur d'essai d'objet.mesh",
    "objet.vue_factice": "le moteur d'essai d'objet.vue", "objet.rendus_factice": "le moteur d'essai d'objet.rendus",
    "objet.classer": "une étape d'Object Creator : ce que montre l'image et d'où (le modèle qui voit)",
    "objet.planche": "une étape d'Object Creator : la planche des vues gardées (une sheet)",
    "chanson.plan": "une étape de Chanson, Soigné (la partition avant le chant) : musique.chanson.soignee",
    "chanson.paroles": "une étape de Chanson : écrire les paroles",
    "music.yue.abc": "une étape d'ODIO : la partition seule de YuE2",
    "music.midi.abc": "une étape d'ODIO : la partition d'un son",
    "music.midi.gpu": "la voie piano d'Extraire le MIDI : musique.midi",
    "check.*": "un essai du contrôle", "essai.*": "un essai de l'ordonnanceur (Admin)", "budget.*": "un essai des budgets (equipes)",
    "droits.*": "un essai des droits", "compte.essai": "un essai de la porte", "detruire.essai": "un essai de la destruction (equipes)",
    "registre.*": "un essai du registre (agent_registre)",
}


def registre_checks() -> None:
    """Le registre de l'agent est complet : chaque sorte de jobs.HANDLERS est le travail d'une capacité ou marquée
    interne ; une sorte interne n'est pas aussi le travail d'une capacité ; une sorte GPU neuve, sans fiche, est vue."""
    import fnmatch
    from tools import agent_registre as ar
    reg = ar.charger()
    ok(not reg["erreurs"], f"registre : agent/ se lit ({reg['erreurs'][:4]})")
    travaux = {c["travail"] for c in reg["capacites"] if c.get("travail")}
    interne = lambda k: any(fnmatch.fnmatch(k, pat) for pat in INTERNES)   # noqa: E731
    orphelines = [k for k in sorted(jobs.HANDLERS) if k not in travaux and not interne(k)]
    ok(not orphelines, "registre : chaque sorte de la file est le travail d'une capacité (agent/capacites/) ou marquée interne "
                       f"(INTERNES, tools/check.py) — sans fiche : {orphelines}")
    deux = sorted(t for t in travaux if interne(t))
    ok(not deux, f"registre : une sorte est une capacité ou interne, pas les deux ({deux})")
    jobs.register("orpheline.gpu", lambda ctx: {"note": "ok"}, lane="cpu", title="Essai : une sorte sans fiche", cost="gpu")
    try:
        vue = [k for k in sorted(jobs.HANDLERS) if k not in travaux and not interne(k)] == ["orpheline.gpu"]
    finally:
        jobs.HANDLERS.pop("orpheline.gpu", None)
        jobs._META.pop("orpheline.gpu", None)
    ok(vue, "registre : une sorte GPU déclarée sans fiche ni raison est vue (le contrôle échouerait)")


def isolation_checks() -> None:
    """1. L'inventaire (STORES) : chaque entrée de <data_dir> est déclarée ; chaque document
    d'un magasin « champ » porte un Workspace connu. 2. Un membre d'une autre Team (dans son
    seul Workspace) rejoue chaque lecture relevée (READS) : aucune réponse ne nomme un objet,
    un document ou un travail d'un Workspace qu'il ne voit pas, et aucune adresse qui en nomme
    un ne lui rend son contenu."""
    import fnmatch
    import functools
    import re
    from core import auth, espaces
    from tools.admin import essai_http as H

    root = config.data_dir()
    # un Workspace détruit (D4) reste connu : sa fiche est dans la corbeille des Workspaces détruits, et ce
    # qu'il tenait n'est à personne (core/espaces.py, gone) jusqu'à ce que Cal le rende
    known = set(espaces._data().get("spaces") or {}) | set(espaces._data().get("destroyed_spaces") or {})
    # 1. l'inventaire
    unknown = [p.name for p in sorted(root.iterdir()) if not any(fnmatch.fnmatch(p.name, k) for k in STORES)]
    ok(not unknown, f"isolement : chaque entrée de <data_dir> est déclarée dans STORES (tools/check.py) — inconnues : {unknown}")
    # ce que tient un Workspace (l'aperçu du ménage, la fiche d'un Workspace détruit : espaces.content_of)
    # compte chaque magasin « champ », ou dit pourquoi pas : un magasin neuf non compté échoue
    loose = [k for k, (how, _w, _d) in STORES.items() if how == "champ"
             and k not in espaces.CONTENT_STORES and k not in espaces.CONTENT_SKIP]
    ok(not loose, f"isolement : chaque magasin « champ » est compté par espaces.content_of (CONTENT_DOCS) ou dit pourquoi "
                  f"pas (CONTENT_SKIP) — oubliés : {loose}")
    for name, (how, what, docs) in STORES.items():
        if how != "champ" or docs is None:
            continue
        bad, n = [], 0
        for where, d in docs(root):
            n += 1
            if not isinstance(d, dict) or d.get("space") not in known:
                bad.append((where, d.get("space") if isinstance(d, dict) else type(d).__name__))
        ok(not bad, f"isolement : « {name} » ({what}) : chaque document porte un Workspace connu ({n} lus) — {bad[:4]}")
    # l'inventaire de qui a créé quoi (core/inventaire.py, ARCHITECTURE.md § 11) : chaque magasin à documents y est
    # énuméré par son outil (inventaire.declare) ou rattaché à ce dont il dépend (inventaire.attach), et rien d'autre
    from core import inventaire
    lost = [n for n, (how, _, _) in STORES.items() if how == "champ" and n not in inventaire.covered()]
    ok(not lost, f"isolement : chaque magasin « champ » est dans l'inventaire (core/inventaire.py : declare ou attach) — manquent : {lost}")
    stray = sorted(n for n in inventaire.covered() if not any(fnmatch.fnmatch(n, k) for k in STORES))
    ok(not stray, f"isolement : l'inventaire ne nomme que des entrées de STORES — inconnues : {stray}")

    # 2. le rejeu : une personne d'une autre Team, dans son seul Workspace
    before = config.CFG.get("auth")
    config.CFG["auth"] = True
    auth.startup()
    with auth._lock:
        auth._hits.clear()
    same = {"Origin": BASE}
    try:
        _, _, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        s, t, _ = H("POST", "/api/equipes", {"name": "Isolement"}, cookie=cal, headers=same)
        ok(s == 200, f"isolement : Cal crée une Team ({s})")
        mine = t["spaces"][0]["id"]
        s, d, _ = H("POST", f"/api/equipes/{t['id']}/membres", {"pseudo": "Ivo Isole", "role": "member"}, cookie=cal, headers=same)
        _, _, tok = H("POST", "/api/auth/enter", {"name": "Ivo Isole"}, headers=same)
        ivo = auth.find_pseudo("Ivo Isole")
        known = set(espaces._data().get("spaces") or {}) | set(espaces._data().get("destroyed_spaces") or {})
        sees = {x for x in known if espaces.can_view(ivo, x)} if ivo else set()
        ok(s == 200 and tok and ivo and sees - {espaces.personal_space_id(ivo["id"])} == {mine},
           f"isolement : Ivo entre, membre de la seule Team « Isolement » ({s} {sees})")
        if not (tok and ivo):
            return
        # ce qui n'est pas à lui : les objets et les documents des Workspaces qu'il ne voit pas
        theirs: dict[str, str] = {}
        for name, (how, what, docs) in STORES.items():
            if how == "champ" and docs is not None:
                for where, d in docs(root):
                    if isinstance(d, dict) and d.get("space") not in sees:
                        for x in {str(d.get("id") or "")} | set(re.findall(ID_ANY, where)):
                            if re.fullmatch(ID_ANY, x):
                                theirs[x] = d.get("space")
        # les travaux d'ailleurs : la file des machines est commune, ils y gardent leur place (masqués,
        # leur identifiant compris) ; mais une adresse qui en nomme un ne lui rend rien
        their_jobs = {j["id"] for j in list(jobs._jobs.values()) if j.get("space") not in sees}
        # un témoin : un travail en file dans Général, au titre et à la recette reconnaissables
        auth.set_current(auth.user(auth.admin_id()) or auth.pseudo_admin())
        auth.set_current_space(espaces.GENERAL)
        jobs.set_mode(None, "paused")
        jobs.register("check.canari", lambda ctx: {"note": "canari-isolement"}, lane="cpu", title="Essai : le témoin de l'isolement",
                      cost="cpu")
        try:
            canari = jobs.submit("check.canari", {"prompt": "canari-isolement"}, title="canari-isolement", tool="check")
        finally:
            auth.set_current(None)
            auth.set_current_space(None)
        their_jobs.add(canari["id"])
        ok(len(theirs) > 20, f"isolement : des objets et des documents d'ailleurs à ne pas voir ({len(theirs)})")
        leaks, opened, n = [], [], 0
        ids_rx = re.compile(ID_ANY + r"|job-\d{4}-\d{6}-[0-9a-f]{4}")
        def get(path: str, hd: dict):
            req = urllib.request.Request(BASE + path, headers={"Cookie": f"{auth.COOKIE}={tok}", **hd})
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return r.status, r.read()
            except urllib.error.HTTPError as e:
                return e.code, e.read()

        def absent(x: str) -> str:   # un identifiant de la même forme, qui n'existe pas
            return x[:4] + ("0000-000000-0000" if x.startswith("job-") else "20000101-000000-0000")
        for shape, paths in sorted(READS.items()):
            for path in paths:
                for hd in ({"X-SR-Espace": mine}, {}):
                    try:
                        st, body = get(path, hd)
                    except OSError:
                        continue
                    n += 1
                    asked = set(ids_rx.findall(path))
                    txt = body.decode("utf-8", "replace")
                    seen = {x for x in ids_rx.findall(txt) if x in theirs and x not in asked}
                    if seen or "canari-isolement" in txt:
                        leaks.append((path, st, sorted(seen)[:3] or ["canari-isolement"]))
                    foreign = [x for x in asked if x in theirs or x in their_jobs]
                    if 200 <= st < 300 and foreign:
                        # ce qu'on ne lui montre pas lui répond comme ce qui n'existe pas : sinon, il en apprend quelque chose
                        p2 = path
                        for x in foreign:
                            p2 = p2.replace(x, absent(x))
                        try:
                            st2, body2 = get(p2, hd)
                        except OSError:
                            st2, body2 = None, b""
                        norm = lambda t, xs: functools.reduce(lambda acc, x: acc.replace(x, "·"), xs, t)   # noqa: E731
                        if st2 != st or norm(txt, foreign) != norm(body2.decode("utf-8", "replace"), [absent(x) for x in foreign]):
                            opened.append((path, st))
        print(f"  isolement : {len(READS)} formes de lecture, {n} requêtes rejouées par un membre d'une autre Team")
        ok(n > 0, "isolement : des lectures relevées à rejouer (les selftests des outils ont tourné)")
        ok(not leaks, f"isolement : aucune réponse ne nomme un objet, un document ou un travail d'un Workspace qu'il ne voit pas "
                      f"({len(leaks)} : {leaks[:6]})")
        ok(not opened, f"isolement : une adresse qui nomme ce qui n'est pas à lui répond comme pour ce qui n'existe pas "
                       f"({len(opened)} : {opened[:6]})")
        try:
            jobs.cancel(canari["id"])
        except KeyError:
            pass
    finally:
        jobs.set_mode(None, "active")
        config.CFG["auth"] = before


def compute_guard_checks(ran: set | None = None) -> None:
    """Pour CHAQUE sorte de jobs.HANDLERS : un coût déclaré ; un guest (viewer et
    acteur) refusé (403 qui dit pourquoi) par jobs.submit, par la route commune et
    par la route de son outil ; chaque profil de la matrice (lecteur, commentateur,
    autre Team : refusés ; éditeur, admin du Workspace : en file). Puis : l'invité
    d'une planche, un membre (son Workspace sur le travail, le travail lancé par un
    travail), retry, les calculs hors file (auth.COMPUTE_ROUTES), et le message de
    _gpu_block. `ran` : les selftests qui ont tourné (un contrôle filtré) — la route
    d'outil n'est rejouée et exigée que pour les sortes de ces modules-là ; None : tous."""
    from core import auth, espaces
    from core.http import HttpError
    from tools.admin import essai_http as H

    err = lambda d: d.get("error", "") if isinstance(d, dict) else str(d)[:120]   # noqa: E731
    GUEST = espaces.WHY["guest_compute"]
    kinds = sorted(jobs.HANDLERS)

    # 1. chaque sorte déclare son coût ; une sorte sans coût fait échouer le contrôle
    for kind in kinds:
        ok(jobs.cost_declared(kind), f"garde : « {kind} » déclare son coût (jobs.register(…, cost=))")
        ok(jobs.cost_of(kind, {}) in jobs.COSTS, f"garde : « {kind} » a un coût connu ({jobs.cost_of(kind, {})})")
    ok(espaces.GARDES.get("calcul") is True, "garde : espaces.garde_prete(\"calcul\") est déclarée par la file")
    ok(not jobs.cost_declared("n.existe.pas") and jobs.cost_of("n.existe.pas") == "gpu",
       "garde : une sorte sans coût vaut gpu hors de la voie cpu (l'oubli est refusé)")

    before = {k: config.CFG.get(k) for k in ("auth", "equipes_guests_essai")}
    config.CFG["auth"] = True
    config.CFG["equipes_guests_essai"] = True   # la garde de la bibliothèque (étape 2) n'est pas de ce contrôle
    auth.startup()
    with auth._lock:
        auth._hits.clear()
    same = {"Origin": BASE}
    queued: list[str] = []

    def drop() -> None:
        for jid in queued:
            try:
                if jid:
                    jobs.cancel(jid)
            except (KeyError, TypeError):
                pass
        queued.clear()

    def chaine(ctx):
        child = jobs.submit("check.echo", {"src": ctx.params.get("src", "")}, title="enfant", tool="check")
        return {"child": child["id"]}

    jobs.register("check.chaine", chaine, lane="cpu", title="Essai : un travail qui en lance un autre", cost="cpu")
    jobs.register("check.direct", lambda ctx: {"note": "ok"}, lane="cpu", title="Essai : direct", direct=True, cost="cpu")
    try:
        jobs.set_mode(None, "paused")   # rien ne part : on juge l'entrée
        _, d, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        P = lambda path, body=None, tok=cal, hd=None: H("POST", path, body if body is not None else {}, cookie=tok,   # noqa: E731
                                                         headers={**same, **(hd or {})})
        s, t, _ = P("/api/equipes", {"name": "Garde Calcul"})
        ok(s == 200 and t.get("plan") == "studio", f"garde : Cal crée une Team ({s} {err(t)})")
        tid, s1 = t["id"], t["spaces"][0]["id"]
        s, sp2, _ = P(f"/api/equipes/{tid}/espaces", {"name": "Second"})
        s2 = sp2.get("id")
        toks, people = {}, {}
        for name, uid, role, mode in (("Gv Calcul", "gv-calcul", "guest", "viewer"), ("Ga Calcul", "ga-calcul", "guest", "acteur"),
                                      ("Mo Calcul", "mo-calcul", "member", None)):
            body = {"pseudo": name, "role": role, **({"guest": mode, "spaces": [s1]} if mode else {})}
            s, d, _ = P(f"/api/equipes/{tid}/membres", body)
            _, _, tok = H("POST", "/api/auth/enter", {"name": name}, headers=same)
            toks[uid], people[uid] = tok, auth.user(uid)
            ok(s == 200 and tok, f"garde : {name} ({role} {mode or ''}) entre ({s} {err(d)})")
            if mode:   # guests aussi de Général : les requêtes rejouées y nomment ce que les selftests y ont rangé
                s, d, _ = P(f"/api/equipes/{espaces.NIRVALAB}/membres", {**body, "spaces": [espaces.GENERAL]})
                ok(s == 200, f"garde : {name}, guest {mode} de Général ({s} {err(d)})")
        guests = ("gv-calcul", "ga-calcul")
        # le Workspace des requêtes rejouées : un outil n'atteint que son Workspace (étape 2) ; les objets
        # et documents qu'elles nomment sont dans Général, où Cal a fait tourner les selftests
        here = espaces.GENERAL
        ROLE = espaces.WHY["role"].split(" (")[0]   # « ton rôle dans ce Workspace » : un viewer ne modifie ni ne crée
        mo = people["mo-calcul"]
        s, img, _ = H("PUT", "/api/library/upload?name=garde.png&title=Garde", raw=tiny_png(), cookie=cal,
                      headers={**same, "Content-Type": "image/png"})
        ok(s == 200, f"garde : une image de Cal pour les essais ({s})")
        fixture = {"image": img.get("id", "") if isinstance(img, dict) else "", "trn": {}}
        # un document de transcription fini, à chaque guest (copie de celui qu'a traduit le selftest)
        trn = ROUTES.get("transcrire.translate") or []
        if trn:
            import secrets
            from tools import transcrire as T
            method, path, raw, _ = trn[0]
            d0 = T._read(path.split("/docs/")[1].split("/")[0])
            for k, g in enumerate(guests):
                nid = f"trn-20260930-00000{k}-{secrets.token_hex(2)}"
                with T._lock:
                    T._write({**d0, "id": nid, "owner": g, "translations": {}, "rev": 1})
                fixture["trn"][g] = (method, f"/api/transcrire/docs/{nid}/translate", json.loads(raw or b"{}"))

        # 2. par jobs.submit (l'endroit par où tout passe), par la route commune, par la route de l'outil
        covered, missing = 0, []
        for kind in kinds:
            cost = jobs.cost_of(kind, {})
            if cost == "none":
                ok(True, f"garde : « {kind} » ne calcule rien (none)")
                continue
            for g in guests:
                auth.set_current(people[g])
                auth.set_current_space(s1)
                try:
                    jobs.submit(kind, {}, title="guest", tool="check")
                    ok(False, f"garde : jobs.submit refuse « {kind} » ({cost}) au guest {g}")
                except HttpError as e:
                    ok(e.status == 403 and GUEST in e.message, f"garde : jobs.submit refuse « {kind} » au guest {g} ({e.status} {e.message[:90]})")
                finally:
                    auth.set_current(None)
                    auth.set_current_space(None)
                s, d, _ = P("/api/jobs", {"kind": kind, "params": {}}, tok=toks[g], hd={"X-SR-Espace": s1})
                ok(s == 403 and GUEST in err(d), f"garde : la route commune refuse « {kind} » ({cost}) au guest {g} ({s} {err(d)[:90]})")
            if ran is not None and getattr(jobs.HANDLERS[kind][0], "__module__", "").split(".")[-1] not in ran:
                continue   # un contrôle filtré : le selftest de son outil n'a pas tourné, ses routes ne sont pas relevées
            if any(tool_requests(kind, fixture, g) for g in guests) and kind not in SANS_ROUTE_OUTIL:
                # chaque requête rejouée : jamais un travail ; l'une au moins atteint la garde (les
                # autres peuvent être refusées plus tôt par l'outil : un objet qui n'est pas au guest…)
                covered += 1
                for g in guests:
                    seen = []
                    for method, path, raw, ctype in tool_requests(kind, fixture, g):
                        s, d, _ = H(method, path, raw=raw, cookie=toks[g],
                                    headers={**same, "X-SR-Espace": here, **({"Content-Type": ctype} if ctype else {})})
                        seen.append((s, f"{method} {path.split('?')[0]}", err(d)))
                    # l'acteur atteint la garde du calcul ; le viewer peut être refusé avant, par son rôle
                    # (modifier ou créer : étape 2) — jamais un travail dans les deux cas
                    ok(not any(200 <= x[0] < 300 for x in seen)
                       and any(x[0] == 403 and (GUEST in x[2] or (g == "gv-calcul" and ROLE in x[2])) for x in seen),
                       f"garde : la route de l'outil refuse « {kind} » au guest {g}, par la garde du calcul "
                       f"({[(x[0], x[1], x[2][:80]) for x in seen]})")
            elif not (jobs._META.get(kind, {}).get("direct") or kind in SANS_ROUTE_OUTIL):
                missing.append(kind)
        ok(not missing, f"garde : chaque sorte a sa route d'outil essayée (selftest) ou sa raison (SANS_ROUTE_OUTIL) — "
                        f"manquent : {missing}")
        print(f"  garde : {len(kinds)} sortes, {covered} routes d'outils rejouées par un guest")
        mine = [x["id"] for x in jobs._jobs.values() if x.get("owner") in guests]
        ok(not mine, f"garde : aucun travail au nom d'un guest, après tout cela ({mine})")

        # 2 bis. la matrice entière (§ 2.4), pour CHAQUE sorte, par jobs.submit : qui ne calcule pas dans
        # ce Workspace — un lecteur, un commentateur, quelqu'un d'une autre Team — reçoit 403 qui dit
        # pourquoi ; qui calcule — un éditeur, un admin du Workspace — met le travail en file, dans ce
        # Workspace, à son coût (l'API payante : coupée pour la Team, 403 qui le dit)
        s, ot, _ = P("/api/equipes", {"name": "Autre Calcul"})
        for name, uid, team_id, space_role in (("Lu Calcul", "lu-calcul", tid, "viewer"), ("Co Calcul", "co-calcul", tid, "commenter"),
                                               ("Ad Calcul", "ad-calcul", tid, "admin"), ("Et Calcul", "et-calcul", ot.get("id"), None)):
            s, d, _ = P(f"/api/equipes/{team_id}/membres", {"pseudo": name, "role": "member"})
            if space_role:
                P(f"/api/espaces/{s1}/membres/{uid}", {"role": space_role})
            people[uid] = auth.user(uid)
            ok(s == 200 and people[uid], f"garde : {name} ({space_role or 'autre Team'}) ({s} {err(d)})")
        api_why = espaces.WHY["api"]
        refused = {"lu-calcul": "lecteur", "co-calcul": "commentateur", "et-calcul": espaces.WHY["none"]}
        allowed = ("mo-calcul", "ad-calcul")
        n_kinds = 0
        for kind in kinds:
            cost = jobs.cost_of(kind, {})
            if cost == "none":
                continue
            n_kinds += 1
            for uid in (*refused, *allowed):
                p = people.get(uid)
                if not p:
                    continue
                auth.set_current(p)
                auth.set_current_space(s1)
                try:
                    j = jobs.submit(kind, {}, title="matrice", tool="check")
                    queued.append(j["id"])
                    ok(uid in allowed and cost != "api" and j.get("space") == s1 and j.get("cost") == cost,
                       f"garde : « {kind} » ({cost}) par {uid} : {'en file, dans son Workspace' if uid in allowed else 'devait être refusé'} "
                       f"({j.get('space')} {j.get('cost')})")
                except HttpError as e:
                    want = api_why if uid in allowed else refused[uid]
                    ok(e.status == 403 and want in e.message, f"garde : « {kind} » ({cost}) refusé à {uid} ({e.status} {e.message[:90]})")
                finally:
                    auth.set_current(None)
                    auth.set_current_space(None)
                drop()   # son quota de travaux en file : chaque essai sort aussitôt
        print(f"  garde : {n_kinds} sortes qui calculent × 5 profils de la matrice")

        # 3. l'invité d'une planche (rôle « invite ») : jamais, sans Workspace ni Team
        auth.set_current({"id": "planche-essai", "name": "Planche", "role": auth.GUEST, "state": "active"})
        try:
            jobs.submit("check.echo", {}, tool="check")
            ok(False, "garde : l'invité d'une planche ne calcule pas")
        except HttpError as e:
            ok(e.status == 403 and e.message.startswith(auth.GUEST_COMPUTE_WHY), f"garde : l'invité d'une planche, 403 ({e.message[:80]})")
        finally:
            auth.set_current(None)

        # 4. un membre : le travail porte son Workspace et son coût ; le travail qu'il lance les garde
        espaces.set_last(mo, s2)   # son Workspace par défaut n'est pas celui du travail
        s, j, _ = P("/api/jobs", {"kind": "check.direct", "params": {}}, tok=toks["mo-calcul"], hd={"X-SR-Espace": s1})
        ok(s == 200 and j.get("space") == s1 and j.get("cost") == "cpu" and j.get("owner") == "mo-calcul",
           f"garde : un membre lance, dans le Workspace de sa page ({s} {j.get('space') if isinstance(j, dict) else j} {err(j)})")
        queued.append(j.get("id"))
        auth.set_current(mo)
        auth.set_current_space(s1)
        try:
            parent = jobs.submit("check.chaine", {}, title="parent", tool="check")
        finally:
            auth.set_current(None)
            auth.set_current_space(None)
        jobs._run(parent, "local")   # comme un ouvrier : la personne et le Workspace posés le temps du run
        child = jobs.get((parent.get("result") or {}).get("child") or "")
        ok(parent["state"] == "done" and child and child.get("owner") == "mo-calcul" and child.get("space") == s1,
           f"garde : le travail lancé par un travail garde la personne et le Workspace ({parent.get('message')} "
           f"{child and (child.get('owner'), child.get('space'))})")
        if child:
            queued.append(child["id"])
        ok(auth.current() is None and auth.current_space() is None, "garde : après le run, ni personne ni Workspace ne restent")

        # 5. retry : la même garde ; le Workspace d'origine
        auth.set_current(people["ga-calcul"])
        auth.set_current_space(s1)
        try:
            jobs.retry(parent["id"])
            ok(False, "garde : un guest ne relance pas")
        except HttpError as e:
            ok(e.status == 403 and GUEST in e.message, f"garde : retry passe par la garde ({e.status} {e.message[:80]})")
        finally:
            auth.set_current(None)
            auth.set_current_space(None)
        s, d, _ = P(f"/api/jobs/{parent['id']}/retry", tok=toks["ga-calcul"], hd={"X-SR-Espace": s1})
        ok(s == 403, f"garde : POST …/retry d'un guest : 403 ({s} {err(d)[:80]})")
        s, j2, _ = P(f"/api/jobs/{parent['id']}/retry")
        ok(s == 200 and j2.get("owner") == "mo-calcul" and j2.get("space") == s1,
           f"garde : Cal relance au nom du membre, dans le Workspace d'origine ({s} {j2.get('space') if isinstance(j2, dict) else ''})")
        queued.append(j2.get("id") if isinstance(j2, dict) else None)
        drop()   # son quota de travaux en file (3) : on vide ce qui attend
        s, d, _ = P("/api/jobs", {"kind": "check.direct", "params": {}}, tok=toks["mo-calcul"], hd={"X-SR-Espace": s2})
        queued.append(d.get("id") if isinstance(d, dict) else None)
        ok(s == 200 and d.get("space") == s2, f"garde : l'en-tête X-SR-Espace choisit le Workspace du travail ({s})")
        P(f"/api/espaces/{s2}/membres/mo-calcul", {"role": "viewer"})
        s, d, _ = P("/api/jobs", {"kind": "check.direct", "params": {}}, tok=toks["mo-calcul"], hd={"X-SR-Espace": s2})
        ok(s == 403 and "lecteur" in err(d), f"garde : lecteur dans un Workspace, il n'y calcule pas ({s} {err(d)[:80]})")

        # 6. les calculs hors file : auth.COMPUTE_ROUTES, jugés par la porte
        for methods, rx, cost in auth.COMPUTE_ROUTES:
            path = COMPUTE_SAMPLES.get(rx)
            ok(bool(path), f"garde : COMPUTE_ROUTES « {rx} » a son chemin d'essai (COMPUTE_SAMPLES)")
            if not path:
                continue
            for m in methods.split():
                for g in guests:
                    s, d, _ = H(m, path, {}, cookie=toks[g], headers={**same, "X-SR-Espace": s1})
                    ok(s == 403 and GUEST in err(d), f"garde : {m} {path} (hors file, {cost}) refusé au guest {g} ({s} {err(d)[:80]})")
        s, d, _ = P("/api/movie/h3/start", {}, tok=toks["mo-calcul"], hd={"X-SR-Espace": s1})
        ok(not (s == 403 and "calcul" in err(d)), f"garde : un membre passe la porte de h3/start ({s} {err(d)[:60]})")

        # 7. _gpu_block : un travail qui se prépare ne s'attend pas lui-même
        fake = {"id": "job-essai-soi", "kind": "check.echo", "lane": "image", "title": "Moi-même", "state": "queued",
                "gpu": True, "_claim": "http://10.255.0.1:8188", "params": {}, "seq": 0.0}
        m = jobs.machine_of(fake["_claim"])
        with jobs._cv:
            jobs._jobs[fake["id"]] = fake
            try:
                own, other = jobs._gpu_block(fake["_claim"], m, fake), jobs._gpu_block(fake["_claim"], m)
            finally:
                jobs._jobs.pop(fake["id"], None)
        ok("Moi-même" not in own, f"file : un travail pris ne se bloque pas lui-même ({own!r})")
        ok("prépare « Moi-même »" in other and "calcule «" not in other and ":8188" in other,
           f"file : les autres lisent qu'il se prépare, et où ({other!r})")
        # ce que dit un travail retenu : la machine, le travail qui tourne, l'instance, la règle ; et chaque
        # machine retenue, pas la première seule (deux DGX occupées : les deux sont nommées)
        fake.update(state="running", endpoint=fake.pop("_claim"))
        with jobs._cv:
            jobs._jobs[fake["id"]] = fake
            try:
                tourne = jobs._gpu_block(fake["endpoint"], m)
                deux = jobs._gpu_says([jobs._gpu_wait(fake["endpoint"], m), ("calcule", "DGX1 calcule « Autre » (ComfyUI :8188)")])
            finally:
                jobs._jobs.pop(fake["id"], None)
        ok(tourne == f"attend : {m} calcule « Moi-même » (ComfyUI :8188) · un calcul GPU du portail à la fois par machine",
           f"file : un travail retenu dit qui calcule, où, et la règle ({tourne!r})")
        ok(f"{m} calcule « Moi-même »" in deux and "DGX1 calcule « Autre »" in deux and deux.count("à la fois") == 1,
           f"file : deux machines retenues, les deux nommées, la règle une fois ({deux!r})")
        ok("Moi-même" not in jobs._gpu_block(fake["endpoint"], m), "file : le travail parti, plus rien ne le cite")
    finally:
        auth.set_current(None)
        auth.set_current_space(None)
        drop()
        jobs.set_mode(None, "active")
        config.CFG["auth"] = before["auth"]
        if before["equipes_guests_essai"] is None:
            config.CFG.pop("equipes_guests_essai", None)
        else:
            config.CFG["equipes_guests_essai"] = before["equipes_guests_essai"]


def main() -> int:
    # des données jetables comme celles de DGX2 depuis le 30/09 : migrées (equipes_espaces.md
    # § 5.1), la Team « Nirvalab » et son Workspace « Général », l'espace par défaut — ce qu'on
    # crée sans Workspace dit y va, et Cal y travaille
    from core import espaces
    espaces.migrate(DATA)
    app = showrunner.build()
    record_routes(app)
    jobs.start()
    threading.Thread(target=app.serve, args=("127.0.0.1", PORT), daemon=True).start()
    for _ in range(50):
        try:
            urllib.request.urlopen(BASE + "/api/library", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    seul = set(sys.argv[1:])   # vide : tout ; sinon les selftests nommés, « socle », « garde »
    if not seul or "socle" in seul:
        print("le socle")
        core_checks()
    import tools
    import pkgutil
    for mod in sorted(pkgutil.iter_modules(tools.__path__), key=lambda m: m.name):
        if seul and mod.name not in seul:
            continue
        m = importlib.import_module(f"tools.{mod.name}")
        if hasattr(m, "selftest"):
            print(mod.name)
            try:
                m.selftest(call, ok)
            except Exception as e:  # un selftest qui plante est un échec, pas un arrêt
                ok(False, f"{mod.name} : selftest a planté : {type(e).__name__}: {e}")
    if not seul or "garde" in seul:
        print("la garde du calcul")
        try:
            compute_guard_checks(seul or None)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            ok(False, f"la garde du calcul : le contrôle a planté : {type(e).__name__}: {e}")
    if not seul or "garde" in seul or "registre" in seul:
        print("le registre de l'agent")
        try:
            registre_checks()
        except Exception as e:  # noqa: BLE001
            ok(False, f"le registre de l'agent : le contrôle a planté : {type(e).__name__}: {e}")
    if not seul or "isolement" in seul:
        print("l'isolement des Workspaces")
        try:
            isolation_checks()
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            ok(False, f"l'isolement des Workspaces : le contrôle a planté : {type(e).__name__}: {e}")
    print(f"\n{passed} passés, {len(failed)} en échec — données dans {DATA}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
