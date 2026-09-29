"""Movie Analysis — le dépouillement d'un film plan par plan, rapatrié de
MOVIE_ANALYSE (d'où, quoi, ce qui est resté : `analyse/PROVENANCE.md`).
La règle de la chaîne ne bouge pas : le code mesure, le modèle juge, le
code vérifie.

Ce module porte trois choses :

- **les analyses** : celles du dépôt (`analyse/analyses/<film>/`, pages
  autonomes copiées de MOVIE_ANALYSE, vidéos sur Cloudflare R2) et celles
  faites depuis le portail (`<data_dir>/analyses/<nom>/`, servies sous
  `analyse/runs/<nom>/`), avec leurs chiffres lus dans `shots.json` et
  `corrections.json` ;
- **le travail `analyse.run`** : la chaîne complète (`analyse.sh`) sur la
  machine du portail (DGX2), dans `~/reelbench/runs/<nom>/`, une seule à
  la fois (voie `analyse`, un ouvrier). La progression est lue dans ce que
  le script dit (« ── 4. … ») et dans les sorties qu'il teste lui-même pour
  reprendre (`cast.done`, `vlm.done`, `whisper.json`…). Il ne démarre que
  si DGX2 est libre (`chaine/gpu-libre.sh`, la règle de MOVIE_ANALYSE),
  tourne sous `nice` et une limite de mémoire. À la fin, ses pages sont
  copiées dans les données du portail ;
- **la diarisation** : l'état du service Nemotron de dgx1 (tailnet,
  :10002) et un relais pour sa page, pour que le poste n'ait pas besoin de
  Tailscale (le portail, sur DGX2, est dans le tailnet).

Réglages (`showrunner.local.json`, tous facultatifs) :

    analyse_skill        la chaîne (défaut : analyse/chaine, la copie du dépôt)
    analyse_runs         où analyse.sh écrit (défaut ~/reelbench/runs ; le vrai script
                         écrit TOUJOURS dans $HOME/reelbench/runs — ne changer que
                         pour la chaîne factice, qui lit $RUNS)
    analyse_diarisation  le service Nemotron (défaut https://dgx1.tail6c4306.ts.net:10002/diarisation)
    analyse_ram_min      Go disponibles exigés avant de lancer (40, comme gpu-libre.sh)
    analyse_memoire_max  plafond de mémoire de la chaîne, en Go (64)
    analyse_attente      attendre que DGX2 soit libre avant de lancer (vrai)
    analyse_scope        systemd-run --user --scope pour la limite de mémoire (vrai)
"""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from core import config, jobs, library
from core.comfy import Cancelled
from core.http import HttpError, Response

TOOL = config.REPO / "analyse"
DEPOT = TOOL / "analyses"
PARTAGE = "https://movie-analysis-partage.luxigone.workers.dev"
DIAR_DEFAUT = "https://dgx1.tail6c4306.ts.net:10002/diarisation"
KIND = "analyse.run"
NOM = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
# une adresse YouTube : analyse.sh la passe à yt-dlp et range le travail sous l'identifiant de la vidéo
YT = re.compile(r"^https://(www\.|m\.)?(youtube\.com/(watch\?|shorts/|live/)|youtu\.be/)", re.I)
YT_ID = re.compile(r"(?:[?&]v=|youtu\.be/|shorts/|live/)([A-Za-z0-9_-]{6,20})")
# les consignes du modèle existent en zh, en et fr (chaine/shots-vlm.mjs, LANGS) ; la sortie française
# ne doit contenir aucun caractère chinois (décision de MOVIE_ANALYSE) : on ne propose que fr et en
LANGUES = {"fr": "français", "en": "anglais"}
# ce que analyse.sh annonce avant chaque étape : printf '\n\033[1m── %s\033[0m\n' "N. libellé"
ANNONCE = re.compile(r"── (\d+b?)\. ([^\x1b\n]*)")
PAGE_FAITE = re.compile(r"→ (\S+)\.html \(à servir")


def skill() -> Path:
    return Path(config.get("analyse_skill") or TOOL / "chaine").expanduser()


def runs() -> Path:
    return Path(config.get("analyse_runs") or Path.home() / "reelbench" / "runs").expanduser()


def produites() -> Path:
    p = config.data_dir() / "analyses"
    p.mkdir(parents=True, exist_ok=True)
    return p


def diar_url() -> str:
    return str(config.get("analyse_diarisation") or DIAR_DEFAUT).rstrip("/")


def _lit_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds")


# ── les analyses et leurs chiffres ──────────────────────────
def chiffres(d: Path) -> dict:
    """Ce qu'une analyse dit d'elle-même : plans, durée, personnages
    (les fiches de la chaîne moins celles que les corrections ont réunies),
    répliques (une réplique qui enjambe un raccord est rangée dans chaque
    plan couvert : on compte les répliques distinctes)."""
    shots = _lit_json(d / "shots.json") or {}
    corr = _lit_json(d / "corrections.json") or {}
    meta = shots.get("meta") or {}
    cast = [c.get("id") for c in shots.get("cast") or [] if isinstance(c, dict)]
    reunies = set((corr.get("fusions") or {}).keys()) & set(cast)
    repliques = {(round(float(ln.get("start") or 0), 2), round(float(ln.get("end") or 0), 2))
                 for s in shots.get("shots") or [] if isinstance(s, dict)
                 for ln in s.get("lines") or [] if isinstance(ln, dict)}
    return {
        "plans": len(shots.get("shots") or []),
        "duree": meta.get("durationSeconds"),
        "personnages": len(cast) - len(reunies),
        "fiches": len(cast),
        "reunies": len(reunies),
        "repliques": len(repliques),
        "largeur": meta.get("width"),
        "hauteur": meta.get("height"),
        "langue": shots.get("lang"),
        "titre_chaine": shots.get("title"),
        "voix": (d / "diarisation.json").is_file(),
        "mots": (d / "mots.json").is_file(),
    }


# La page d'un film dans le portail (chaine/studio.mjs, 29/09) le dit elle-même en tête : elle charge le thème et
# l'en-tête du portail, et porte le Studio, le Casting et le Dépouillement (?vue=…). Une page d'avant (autonome,
# X—VERSE) ne le dit pas : ses liens restent les siens.
FORME = b'<meta name="sr-forme" content="portail">'


def forme(page: Path) -> str:
    try:
        with open(page, "rb") as f:
            return "portail" if FORME in f.read(4096) else "autonome"
    except OSError:
        return "absente"


def _entree(d: Path, source: str) -> dict:
    base = ("analyse/analyses/" if source == "depot" else "analyse/runs/") + d.name + "/"
    info = _lit_json(d / "portail.json") or {}
    c = chiffres(d)
    page = info.get("page") or "index.html"
    f = forme(d / page)
    if f == "portail":
        # une seule page, trois vues ; l'adresse du dossier plutôt que index.html
        studio = base if page == "index.html" else base + page
        vues = {"studio": studio, "casting": studio + "?vue=casting", "depouillement": studio + "?vue=depouillement"}
    else:
        dep = info.get("depouillement") or ("depouillement.html" if (d / "depouillement.html").is_file() else None)
        vues = {"studio": base + page if f != "absente" else None, "casting": None,
                "depouillement": base + dep if dep and (d / dep).is_file() else None}
    vignette = base + "vignette.jpg" if (d / "vignette.jpg").is_file() else None
    return {
        "id": d.name, "source": source, "forme": f,
        "titre": info.get("titre") or c["titre_chaine"] or d.name,
        "genre": info.get("genre", ""),
        **vues,
        "vignette": vignette,
        # l'image en grand des cartes « Nos films » (une image clé à 1280 px) ; à défaut, la vignette
        "affiche": base + "affiche.jpg" if (d / "affiche.jpg").is_file() else vignette,
        "labo": "analyse/diarisation/?projet=" + urllib.parse.quote(d.name),
        "date": info.get("date") or _iso((d / page).stat().st_mtime if (d / page).is_file() else d.stat().st_mtime),
        "job": info.get("job"), "run": info.get("run"), "origine": info.get("origine"),
        "chiffres": c,
    }


def analyses_list(req):
    out = []
    if produites().is_dir():
        faites = [d for d in produites().iterdir() if d.is_dir() and not d.name.startswith(".")]
        out += sorted((_entree(d, "portail") for d in faites), key=lambda e: e["date"], reverse=True)
    if DEPOT.is_dir():
        out += [_entree(d, "depot") for d in sorted(DEPOT.iterdir()) if d.is_dir() and (d / "shots.json").is_file()]
    return {"analyses": out, "runs": str(runs()), "partage": PARTAGE}


# ── le dépôt partagé du Worker (lecture) ────────────────────
def _get(url: str, timeout: float = 8.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "showrunner-portail"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def projets(req):
    """Les projets créés depuis la home de MOVIE_ANALYSE, dans le dépôt
    partagé (Worker Cloudflare, GET sans jeton). Lecture seule : le
    Worker n'accepte d'écriture que de calculment0r.github.io et du poste."""
    try:
        doc = json.loads(_get(PARTAGE + "/corrections/projets.json"))
    except (OSError, ValueError) as e:
        return {"etat": "injoignable", "erreur": str(e)[:200], "projets": [], "source": PARTAGE}
    liste = doc.get("projets") if isinstance(doc, dict) else None
    liste = liste if isinstance(liste, list) else []
    vivants = [p for p in liste if isinstance(p, dict) and not p.get("supprime")]
    retires = [p.get("id") for p in liste if isinstance(p, dict) and p.get("supprime") and p.get("depot")]
    return {"etat": "partage", "projets": vivants, "retires": retires, "source": PARTAGE}


# ── la diarisation : état, et relais pour la page ──────────
_REMEDES = [
    "le service tourne sur dgx1 : ssh dgx@192.168.10.205 'systemctl status diarisation --no-pager' "
    "(journal : journalctl -u diarisation -n 100 --no-pager ; relancer : sudo systemctl restart diarisation)",
    "la publication dans le tailnet (port 10002, tailnet seulement) : ssh dgx@192.168.10.205 'tailscale serve status'",
    "depuis DGX2, le vérifier : curl -s https://dgx1.tail6c4306.ts.net:10002/diarisation/etat",
    "installation et pannes : analyse/PROVENANCE.md → HANDOFF-DIARISATION.md de MOVIE_ANALYSE",
]


def diarisation(req):
    url = diar_url()
    try:
        e = json.loads(_get(url + "/etat", timeout=6))
    except (OSError, ValueError) as err:
        return {"up": False, "url": url, "why": str(err)[:300], "remedes": _REMEDES}
    m = e.get("modele") or {}
    return {"up": True, "url": url, "pret": bool(e.get("pret")), "phase": e.get("phase"), "erreur": e.get("erreur"),
            "machine": e.get("machine"), "modele": m.get("nom"), "voix": m.get("voix"), "appareil": m.get("appareil"),
            "attention": m.get("attention"), "transcription": (e.get("transcription") or {}).get("possible"),
            "file": e.get("file"), "remedes": _REMEDES}


def _relais(req, chemin: str, method: str, timeout: float = 30.0):
    """Relaie une requête de la page de diarisation vers le service de
    dgx1. Le corps (un son, une vidéo : jusqu'à 2 Go) passe par morceaux,
    sans être gardé en mémoire."""
    q = urllib.parse.urlencode(req.query, doseq=True)
    u = urllib.parse.urlsplit(diar_url() + chemin + ("?" + q if q else ""))
    conn_cls = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(u.hostname, u.port, timeout=timeout)
    n = int(req.headers.get("Content-Length") or 0) if method == "POST" else 0
    if n > 2 << 30:
        raise HttpError(413, "fichier trop gros (2 Go au plus)")
    try:
        conn.putrequest(method, u.path + ("?" + u.query if u.query else ""))
        for h in ("X-Cle", "Content-Type"):
            if req.headers.get(h):
                conn.putheader(h, req.headers[h])
        if method == "POST":
            conn.putheader("Content-Length", str(n))
        conn.endheaders()
        if method == "POST":
            left, rfile = n, req._h.rfile
            while left > 0:
                buf = rfile.read(min(1 << 20, left))
                if not buf:
                    break
                conn.send(buf)
                left -= len(buf)
            req._body = b""
        r = conn.getresponse()
        body = r.read()
        return Response(body, r.status, r.getheader("Content-Type") or "application/json; charset=utf-8")
    except OSError as e:
        raise HttpError(502, f"le service de diarisation ne répond pas ({diar_url()}) : {e}") from e
    finally:
        conn.close()


# ── la chaîne : ce qu'il lui faut, et où elle en est ────────
_scope = {"ok": None}
_etat_chaine = {"t": 0.0, "v": None}
_verrou = threading.Lock()


def _scope_ok() -> bool:
    """systemd-run --user --scope marche-t-il depuis ce processus ? (il
    faut la session systemd de l'utilisateur) — sinon, nice seul."""
    if _scope["ok"] is None:
        try:
            r = subprocess.run(["systemd-run", "--user", "--scope", "-q", "-p", "MemoryMax=1G", "true"],
                               capture_output=True, timeout=15)
            _scope["ok"] = r.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            _scope["ok"] = False
    return _scope["ok"]


def _empreinte(p: Path) -> str:
    return hashlib.md5(p.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def _compare(a: Path, b: Path) -> dict:
    """La chaîne du portail (a) face à celle de ~/reelbench/skill (b), fins de ligne ignorées."""
    if not a.is_dir() or not b.is_dir():
        return {"compare": False}
    fa = {p.name for p in a.iterdir() if p.is_file()}
    fb = {p.name for p in b.iterdir() if p.is_file()}
    differe = sorted(n for n in fa & fb if _empreinte(a / n) != _empreinte(b / n))
    return {"compare": True, "chemin": str(b), "differe": differe, "absents": sorted(fa - fb),
            "en_plus": sorted(fb - fa), "identiques": len(fa & fb) - len(differe)}


def _ollama_modeles() -> list[str] | None:
    try:
        return [m.get("name", "") for m in json.loads(_get("http://127.0.0.1:11434/api/tags", timeout=4)).get("models", [])]
    except (OSError, ValueError):
        return None


def chaine_etat(req):
    with _verrou:
        if time.time() - _etat_chaine["t"] < 60 and _etat_chaine["v"] and req.q("frais") != "1":
            return _etat_chaine["v"]
    home = Path.home()
    sk = skill()
    # les défauts de analyse.sh : PY, YTDLP, VLM_API, VLM_MODEL
    py = home / "comfyui-env" / "bin" / "python"
    ytdlp = home / ".venvs" / "ytdlp" / "bin" / "yt-dlp"
    modeles = _ollama_modeles()
    vlm = "mistral-vlm-16k"
    outils = [
        {"nom": "analyse.sh", "ok": (sk / "analyse.sh").is_file(), "chemin": str(sk / "analyse.sh"), "requis": True},
        {"nom": "python (comfyui-env)", "ok": py.exists(), "chemin": str(py), "requis": True},
        {"nom": "node", "ok": bool(shutil.which("node")), "chemin": shutil.which("node") or "", "requis": True},
        {"nom": "ffmpeg", "ok": bool(shutil.which("ffmpeg")), "chemin": shutil.which("ffmpeg") or "", "requis": True},
        {"nom": f"ollama · {vlm}", "ok": bool(modeles) and any(m.split(":")[0] == vlm for m in modeles),
         "chemin": "http://127.0.0.1:11434" + ("" if modeles is not None else " (ne répond pas : sudo systemctl start ollama)"),
         "requis": True},
        {"nom": "yt-dlp", "ok": ytdlp.exists(), "chemin": str(ytdlp), "requis": False, "pour": "une adresse YouTube"},
        {"nom": "SAM 3", "ok": (home / "reelbench/models/sam3/sam3.pt").is_file(),
         "chemin": str(home / "reelbench/models/sam3/sam3.pt"), "requis": False, "pour": "les silhouettes (sautées sans lui)"},
        # le jeton lui-même n'est jamais lu : on regarde seulement qu'il est posé
        {"nom": "jeton Hugging Face", "ok": (home / ".cache/huggingface/token").is_file()
         and (home / ".cache/huggingface/token").stat().st_size > 0,
         "chemin": str(home / ".cache/huggingface/token"), "requis": False,
         "pour": "qui parle mesuré par pyannote (sans lui : règle de plateau, devinée et dite)"},
    ]
    v = {
        "machine": socket.gethostname(), "skill": str(sk), "copie_du_depot": sk.resolve() == (TOOL / "chaine").resolve(),
        "runs": str(runs()), "outils": outils, "pret": all(o["ok"] for o in outils if o["requis"]),
        "reelbench": _compare(TOOL / "chaine", home / "reelbench" / "skill"),
        "scope": _scope_ok(), "voie": config.get("lanes", {}).get("analyse"),
        "langues": LANGUES,
    }
    with _verrou:
        _etat_chaine.update(t=time.time(), v=v)
    return v


def nom_libre(req, nom):
    if not (NOM.match(nom) or re.fullmatch(r"[A-Za-z0-9_-]{6,20}", nom)):
        raise HttpError(400, "nom invalide : minuscules, chiffres et tirets")
    w = runs() / nom
    return {"nom": nom, "libre": not w.exists() and not (produites() / nom).exists(),
            "reprendre": (w / "portail.log").is_file(), "run": str(w)}


def _slug(t: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", t or "")
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:48].strip("-")
    return s or "analyse"


# ── lancer ──────────────────────────────────────────────────
def run_submit(req):
    d = req.json()
    langue = str(d.get("langue") or "fr")
    if langue not in LANGUES:
        raise HttpError(400, f"langue du dépouillement : {', '.join(LANGUES)}")
    titre = re.sub(r"\s+", " ", str(d.get("titre") or "")).strip()[:120]
    item_id, url = d.get("item"), str(d.get("url") or "").strip()
    if bool(item_id) == bool(url):
        raise HttpError(400, "une vidéo de la bibliothèque, ou une adresse YouTube")
    thumb = None
    if item_id:
        it = library.get(str(item_id))
        if not it or it["kind"] != "video":
            raise HttpError(400, "ce n'est pas une vidéo de la bibliothèque")
        titre = titre or it.get("title") or ""
        nom = str(d.get("nom") or _slug(titre))
        if not NOM.match(nom):
            raise HttpError(400, "nom du dossier : minuscules, chiffres et tirets (48 au plus)")
        thumb = library.public(it).get("thumb_url")
        params = {"item": it["id"]}
    else:
        if not YT.match(url):
            raise HttpError(400, "une adresse YouTube : https://www.youtube.com/watch?v=…, https://youtu.be/…")
        m = YT_ID.search(url)
        if not m:
            raise HttpError(400, "identifiant de vidéo introuvable dans l'adresse")
        # analyse.sh range un travail YouTube sous l'identifiant de la vidéo : c'est son nom
        nom = m.group(1)
        params = {"url": url}
    w = runs() / nom
    reprendre = bool(d.get("reprendre"))
    if w.exists() and not (reprendre and (w / "portail.log").is_file()):
        if (w / "portail.log").is_file():
            raise HttpError(409, f"~/reelbench/runs/{nom}/ existe déjà (une analyse lancée d'ici) : cocher « reprendre » "
                                 f"la continue où elle s'est arrêtée, ou changer le titre")
        raise HttpError(409, f"~/reelbench/runs/{nom}/ existe déjà et n'a pas été lancé d'ici (un travail de "
                             f"MOVIE_ANALYSE) : on n'y touche pas — changer le titre")
    if (produites() / nom).exists() and not reprendre:
        raise HttpError(409, f"une analyse « {nom} » est déjà dans le portail : changer le titre")
    for j in jobs.listing(active=True, tool="analyse"):
        if (j.get("params") or {}).get("nom") == nom:
            raise HttpError(409, f"« {nom} » est déjà en file")
    if not (skill() / "analyse.sh").is_file():
        raise HttpError(503, f"la chaîne est introuvable : {skill() / 'analyse.sh'}")
    params.update(nom=nom, titre=titre, langue=langue, sceneflow=bool(d.get("sceneflow")))
    j = jobs.submit(KIND, params, title=f"Analyse · {titre or nom}", tool="analyse", thumb=thumb)
    return jobs.public(j)


def _lien(src: Path, dest: Path) -> None:
    """Un lien dur (même disque : ni copie ni place en plus), une copie sinon.
    Pas un lien symbolique : analyse.sh prend le realpath de la vidéo, et
    nommerait le travail d'après le fichier de la bibliothèque (main.mp4)."""
    try:
        os.link(src, dest)
    except OSError:
        shutil.copyfile(src, dest)


def _journal(log: Path, n: int = 65536) -> str:
    try:
        with open(log, "rb") as f:
            f.seek(max(0, log.stat().st_size - n))
            return f.read().decode("utf-8", "replace")
    except OSError:
        return ""


def _frames_ok(w: Path) -> bool:
    d = w / "frames"
    return d.is_dir() and sum(1 for _ in d.iterdir()) >= 2


def _etapes(youtube: bool, sceneflow: bool) -> list[tuple[str, str, object]]:
    """Les étapes d'analyse.sh, dans son ordre, avec la sortie qu'il teste
    lui-même pour sauter une étape déjà faite (None : l'étape n'en laisse pas)."""
    e = [("0", "la vidéo YouTube", lambda w: (w / "source.mp4").is_file())] if youtube else []
    e += [
        ("1", "coupes, durées, mouvement",
         lambda w: (w / "shots.json").is_file() and _frames_ok(w) and (w / "sheets" / "sheet-a01.jpg").is_file()),
        ("2", "transcription", lambda w: (w / "whisper.json").is_file()),
        ("3", "suivi des personnes", lambda w: (w / "tracks.json").is_file()),
        ("4", "casting", lambda w: (w / "cast.done").is_file()),
        ("4b", "silhouettes", lambda w: (w / "masks.json").is_file()),
        ("5", "répliques par plan", None),
        ("6", "qui parle", None),
        ("7", "jugement du modèle", lambda w: (w / "vlm.done").is_file()),
        ("8", "portes", None),
        ("9", "rapport", None),
        ("9b", "studio", None),
    ]
    if sceneflow:
        e.append(("10", "SceneFlow", lambda w: (w / "adherence.json").is_file()))
    return e


def _suit(ctx, w: Path, log: Path, etapes) -> None:
    """La progression dite honnêtement : l'étape que le script annonce,
    rapportée au nombre d'étapes (pas une durée devinée), et les sorties
    déjà sur le disque."""
    annonces = ANNONCE.findall(_journal(log))
    ids = [e[0] for e in etapes]
    k, libelle = -1, "démarre"
    if annonces:
        num, txt = annonces[-1]
        if num in ids:
            k, libelle = ids.index(num), txt.strip() or dict((a, b) for a, b, _ in etapes)[num]
    faites = [lab for _, lab, test in etapes if test and test(w)]
    msg = f"étape {k + 1}/{len(ids)} · {libelle}" if k >= 0 else "démarre"
    if faites:
        msg += " — sur le disque : " + ", ".join(faites)
    ctx.progress(max(k, 0) / len(ids), msg)


def _attend_libre(ctx) -> None:
    """La règle de MOVIE_ANALYSE : ne rien lancer sur un DGX occupé (GPU
    au travail, file ComfyUI non vide, moins de 40 Go disponibles)."""
    if not config.get("analyse_attente", True):
        return
    script = TOOL / "chaine" / "gpu-libre.sh"
    ram = str(config.get("analyse_ram_min", 40))
    while True:
        ctx.check()
        try:
            r = subprocess.run(["bash", str(script), "--ram-min", ram], capture_output=True, text=True, timeout=60)
            if r.returncode == 0:
                return
            why = (r.stdout or r.stderr).strip().splitlines()[-1:] or ["occupé"]
        except (OSError, subprocess.TimeoutExpired) as e:
            why = [str(e)]
        ctx.progress(0.0, f"attend que {socket.gethostname()} se libère — {why[0]}")
        for _ in range(30):
            ctx.check()
            time.sleep(1)


def _arrete(proc: subprocess.Popen) -> None:
    for sig, attente in ((signal.SIGTERM, 15), (signal.SIGKILL, 5)):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            return
        try:
            proc.wait(timeout=attente)
            return
        except subprocess.TimeoutExpired:
            continue


def run(ctx):
    p = ctx.params
    nom, titre, langue, sceneflow = p["nom"], p.get("titre") or "", p.get("langue", "fr"), bool(p.get("sceneflow"))
    script = skill() / "analyse.sh"
    if not script.is_file():
        raise RuntimeError(f"la chaîne est introuvable : {script}")
    w = runs() / nom
    w.mkdir(parents=True, exist_ok=True)
    log = w / "portail.log"
    ctx.progress(0.0, "prépare")
    if p.get("item"):
        it = library.get(p["item"])
        if not it:
            raise RuntimeError("la vidéo n'est plus dans la bibliothèque")
        src = library.path_of(it)
        video = w / f"{nom}{src.suffix.lower()}"
        if not video.exists():
            _lien(src, video)
        entree, youtube, video_nom = str(video), False, video.name
    else:
        entree, youtube, video_nom = p["url"], True, "source.mp4"
    etapes = _etapes(youtube, sceneflow)
    _attend_libre(ctx)
    cmd = ["bash", str(script), entree, titre, "--lang", langue]
    if sceneflow:
        cmd.append("--sceneflow")
    if youtube:
        cmd += ["--youtube-id", nom]
    cmd = ["nice", "-n", "10"] + cmd
    if config.get("analyse_scope", True) and _scope_ok():
        cmd = ["systemd-run", "--user", "--scope", "-q", "-p", f"MemoryMax={int(config.get('analyse_memoire_max', 64))}G"] + cmd
    env = {**os.environ, "SKILL": str(skill()), "RUNS": str(runs())}
    with open(log, "ab") as lf:
        lf.write(f"\n=== portail {library.now()} · {ctx.job['id']} : {' '.join(cmd)}\n".encode())
        lf.flush()
        proc = subprocess.Popen(cmd, cwd=str(w), env=env, stdout=lf, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, start_new_session=True)
    ctx.job["result"].update(run=str(w), log=str(log))
    try:
        while proc.poll() is None:
            if ctx.cancelled():
                _arrete(proc)
                raise Cancelled("arrêté — Relancer reprend où la chaîne s'est arrêtée")
            _suit(ctx, w, log, etapes)
            time.sleep(float(config.get("analyse_releve", 2)))
    except BaseException:
        if proc.poll() is None:
            _arrete(proc)
        raise
    _suit(ctx, w, log, etapes)
    if proc.returncode != 0:
        fin = [ln for ln in _journal(log, 4000).splitlines() if ln.strip()][-4:]
        raise RuntimeError(f"la chaîne s'est arrêtée (code {proc.returncode}) — {ctx.job['message']}. "
                           f"Journal : {log}. Dernières lignes : " + " | ".join(fin) +
                           ". Relancer reprend où elle s'est arrêtée.")
    ctx.progress(0.98, "copie les pages dans le portail")
    dest = _publie(w, log, nom, titre, video_nom, p, ctx.job["id"])
    return {"analyse": nom, "open": f"analyse/runs/{nom}/", "run": str(w), "pages": str(dest)}


def _affiche(video: Path, plan: dict, dest: Path) -> None:
    """L'image en grand de la carte du film : l'image clé du plan le plus long, au même instant que
    video-shots frames (15 % du plan), en 1280 px au lieu de 480. Une image par ffmpeg ; rien s'il échoue
    (la carte prend alors la vignette)."""
    if not video.is_file() or not shutil.which("ffmpeg"):
        return
    try:
        a, b = float(plan.get("start") or 0), float(plan.get("end") or 0)
        t = a + 0.15 * max(0.0, b - a)
        subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1",
                        "-vf", "scale='min(1280,iw)':-2", "-q:v", "4", str(dest)], capture_output=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        pass
    if dest.is_file() and dest.stat().st_size == 0:
        dest.unlink()


def _publie(w: Path, log: Path, nom: str, titre: str, video_nom: str, p: dict, job_id: str) -> Path:
    """La page produite (le Studio, dans la forme du portail : Casting et
    Dépouillement sont ses vues), la vidéo à côté (la page la lit par son
    nom, en chemin relatif), les données, une vignette et une affiche —
    dans les données du portail, servies sous analyse/runs/<nom>/. Le
    rapport-liste de la chaîne (<slug>-liste.html, l'ancienne page à part)
    n'est repris que si le Studio produit est encore de l'ancienne forme."""
    faites = PAGE_FAITE.findall(_journal(log))
    slug = faites[-1] if faites else None
    if not slug:
        listes = sorted(w.glob("*-liste.html"), key=lambda f: f.stat().st_mtime)
        slug = listes[-1].name[: -len("-liste.html")] if listes else None
    studio = w / f"{slug}.html" if slug else None
    if not studio or not studio.is_file():
        raise RuntimeError(f"la chaîne a fini sans page Studio dans {w}")
    tmp = produites() / f".{nom}.tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    shutil.copyfile(studio, tmp / "index.html")
    f_page = forme(tmp / "index.html")
    liste, liste_nom = w / f"{slug}-liste.html", None
    if f_page != "portail" and liste.is_file():
        shutil.copyfile(liste, tmp / liste.name)
        liste_nom = liste.name
    if (w / video_nom).is_file():
        _lien(w / video_nom, tmp / video_nom)
    for f in ("shots.json", "shots.md", "sceneflow.json", "adherence.json", "corrections.json"):
        if (w / f).is_file():
            shutil.copyfile(w / f, tmp / f)
    # le Studio lit corrections.json posé à côté de lui : aucune correction encore, un document vide
    if not (tmp / "corrections.json").is_file():
        (tmp / "corrections.json").write_text("{}\n", encoding="utf-8")
    shots = _lit_json(w / "shots.json") or {}
    plans = [s for s in shots.get("shots") or [] if isinstance(s, dict) and s.get("id")]
    if plans:
        long = max(plans, key=lambda s: float(s.get("seconds") or 0))
        img = w / "frames" / f"{long['id']}a.jpg"
        if img.is_file():
            shutil.copyfile(img, tmp / "vignette.jpg")
        _affiche(w / video_nom, long, tmp / "affiche.jpg")
    (tmp / "portail.json").write_text(json.dumps({
        "titre": titre or shots.get("title") or nom, "page": "index.html", "forme": f_page,
        "depouillement": liste_nom, "video": video_nom,
        "origine": {"item": p.get("item"), "url": p.get("url"), "langue": p.get("langue"), "sceneflow": p.get("sceneflow")},
        "run": str(w), "job": job_id, "chaine": str(skill()), "date": library.now(),
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    dest = produites() / nom
    if dest.exists():
        shutil.rmtree(dest)
    tmp.rename(dest)
    return dest


# ── l'enregistrement ────────────────────────────────────────
def register(app) -> None:
    app.mount("analyse/runs", produites())
    jobs.register(KIND, run, lane="analyse", title="Analyse de film")
    app.route("GET", "/api/analyse/list", analyses_list)
    app.route("GET", "/api/analyse/projets", projets)
    app.route("GET", "/api/analyse/diarisation", diarisation)
    app.route("GET", "/api/analyse/chaine", chaine_etat)
    app.route("GET", "/api/analyse/nom/{nom}", nom_libre)
    app.route("POST", "/api/analyse/run", run_submit)
    # le relais de la page de diarisation (analyse/diarisation/, machine « Portail · relais »)
    app.route("GET", "/api/analyse/diar/etat", lambda req: _relais(req, "/etat", "GET", 10))
    app.route("GET", "/api/analyse/diar/fichiers", lambda req: _relais(req, "/fichiers", "GET", 20))
    app.route("GET", "/api/analyse/diar/travaux", lambda req: _relais(req, "/travaux", "GET", 20))
    app.route("GET", "/api/analyse/diar/travail/{jid}", lambda req, jid: _relais(req, "/travail/" + urllib.parse.quote(jid), "GET", 90))
    app.route("DELETE", "/api/analyse/diar/travail/{jid}", lambda req, jid: _relais(req, "/travail/" + urllib.parse.quote(jid), "DELETE", 20))
    app.route("POST", "/api/analyse/diar/analyse", lambda req: _relais(req, "/analyse", "POST", 600))


# ── le contrôle, sans GPU ───────────────────────────────────
FAUX = TOOL / "outils" / "faux"


def selftest(call, ok) -> None:
    import tempfile

    # les analyses du dépôt et leurs chiffres
    st, res = call("GET", "/api/analyse/list")
    ok(st == 200 and isinstance(res.get("analyses"), list), f"liste des analyses ({st})")
    par = {a["id"]: a for a in res.get("analyses", [])}
    g, wall = par.get("getaround"), par.get("wall")
    ok(bool(g) and g["chiffres"]["plans"] == 12 and round(g["chiffres"]["duree"]) == 30, f"getaround : 12 plans, 30 s ({g and g['chiffres']})")
    ok(bool(wall) and wall["chiffres"]["plans"] == 45 and wall["chiffres"]["personnages"] == 10,
       f"wall : 45 plans, 10 personnages après les fusions ({wall and wall['chiffres']})")
    ok(bool(g) and g["chiffres"]["voix"] and g["studio"] == "analyse/analyses/getaround/", f"getaround a ses voix et son Studio ({g and g['studio']})")
    # nos films, dans la page du portail (29/09) : le thème et l'en-tête communs, trois vues dans une page
    for a in (g, wall):
        if a:
            ok(a["forme"] == "portail", f"{a['id']} : la page est dans la forme du portail ({a['forme']})")
            ok(a["casting"] == a["studio"] + "?vue=casting" and a["depouillement"] == a["studio"] + "?vue=depouillement",
               f"{a['id']} : Casting et Dépouillement sont des vues de la page ({a['casting']}, {a['depouillement']})")
            for k in ("studio", "casting", "depouillement", "vignette", "affiche"):
                st, _ = call("GET", "/" + (a[k] or "absent"))
                ok(st == 200, f"{a['id']} : {k} se sert ({st})")
            st, page = call("GET", "/" + a["studio"])
            txt = page.decode("utf-8", "replace") if isinstance(page, bytes) else ""
            liens = ('href="../../../commun/tokens.css"', 'href="../../../commun/base.css"', 'href="../../../commun/shell.css"',
                     'href="../../film/film.css"', 'src="../../film/film.js"')
            ok(all(x in txt for x in liens) and "<style" not in txt and 'class="bar"' not in txt and "xverse-theme" not in txt,
               f"{a['id']} : le thème et l'en-tête du portail, ni feuille ni barre X—VERSE à elle")
            ok('data-repli="' in txt and "movie-analysis-partage.luxigone.workers.dev/video/" in txt,
               f"{a['id']} : la vidéo sur R2, le fichier d'à côté en repli")
            # l'ancienne page du dépouillement n'est plus : son adresse, pour les liens d'avant, mène à la vue
            ancienne = DEPOT / a["id"] / "depouillement.html"
            ok(not ancienne.exists() or (ancienne.stat().st_size < 4096 and b"?vue=depouillement" in ancienne.read_bytes()),
               f"{a['id']} : plus d'ancienne page de dépouillement à part (depouillement.html ne fait que renvoyer à la vue)")
    for page in ("/analyse/", "/analyse/film/film.css", "/analyse/film/film.js", "/analyse/diarisation/",
                 "/analyse/diarisation/portail.css", "/analyse/commun/projets.js"):
        st, _ = call("GET", page)
        ok(st == 200, f"{page} se sert ({st})")
    st, _ = call("GET", "/analyse/runs/../../jobs.json")
    ok(st == 404, "les pages produites ne sortent pas de leur dossier")

    # le thème (CLAUDE.md) : aucune couleur écrite hors de la palette de film.css — le script des pages lit les jetons
    teinte = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d")
    css = (TOOL / "film" / "film.css").read_text(encoding="utf-8")
    marque = "/* ── fin de la palette"
    ok(marque in css and not teinte.search(css.split(marque, 1)[-1]),
       "film.css : aucune couleur hors de la palette déclarée en tête")
    ok(not re.search(r"(?<![-\w])border(-(top|right|bottom|left))?(-(width|style|color))?\s*:(?!\s*(0|none)\s*[;}])", css),
       "film.css : des filets, jamais de bordures")
    for f in ("voix.js", "son.js", "studio.mjs", "casting-parts.mjs"):
        src = (TOOL / "chaine" / f).read_text(encoding="utf-8")
        ok(not re.search(r"['\"]#[0-9a-fA-F]{3,8}['\"]|rgba?\(\s*\d", src), f"chaine/{f} : aucune couleur écrite")

    # ce qu'on refuse avant de lancer
    st, _ = call("POST", "/api/analyse/run", {"titre": "rien"})
    ok(st == 400, "sans source : refusé")
    st, _ = call("POST", "/api/analyse/run", {"url": "https://example.com/v.mp4"})
    ok(st == 400, "une adresse hors YouTube : refusée")
    st, _ = call("POST", "/api/analyse/run", {"url": "https://youtu.be/dQw4w9WgXcQ", "langue": "zh"})
    ok(st == 400, "une langue hors fr/en : refusée")
    st, _ = call("POST", "/api/analyse/run", {"item": "ima-inexistant"})
    ok(st == 400, "un objet qui n'est pas une vidéo : refusé")

    # une analyse de bout en bout, sur la chaîne factice (outils/faux/analyse.sh : les marqueurs, pas le calcul)
    tmp = Path(tempfile.mkdtemp(prefix="sr_analyse_"))
    config.CFG.update(analyse_skill=str(FAUX), analyse_runs=str(tmp / "runs"), analyse_attente=False, analyse_scope=False,
                      analyse_releve=0.1)
    (tmp / "runs" / "deja").mkdir(parents=True)
    jobs.register(KIND, run, lane="cpu", title="Analyse de film")   # le contrôle n'a que la voie cpu
    os.environ["FAUX_PAUSE"] = "0.25"
    os.environ.pop("FAUX_DEPUIS", None)
    st, vid = call("PUT", "/api/library/upload?name=essai.mp4&title=Essai%20de%20film", raw=b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64)
    ok(st == 200 and vid.get("kind") == "video", f"une vidéo déposée ({st})")
    st, _ = call("POST", "/api/analyse/run", {"item": vid.get("id"), "nom": "deja"})
    ok(st == 409, f"un dossier de run qui n'est pas d'ici : on n'y touche pas ({st})")
    st, j = call("POST", "/api/analyse/run", {"item": vid.get("id"), "titre": "Essai de film", "langue": "fr", "sceneflow": True})
    ok(st == 200 and j.get("state") == "queued" and j["params"]["nom"] == "essai-de-film", f"l'analyse part en file ({st} {j})")
    vus = set()
    for _ in range(300):
        st, j = call("GET", f"/api/jobs/{j['id']}")
        if j.get("message", "").startswith("étape"):
            vus.add(j["message"].split(" ·")[0])
        if j["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.1)
    ok(j["state"] == "done", f"l'analyse factice finit ({j.get('state')} : {j.get('message')})")
    ok(len(vus) >= 3, f"la progression suit les étapes annoncées ({sorted(vus)})")
    ok(j.get("result", {}).get("open") == "analyse/runs/essai-de-film/", f"le résultat mène à la page ({j.get('result')})")
    st, res = call("GET", "/api/analyse/list")
    faite = {a["id"]: a for a in res.get("analyses", [])}.get("essai-de-film")
    ok(bool(faite) and faite["source"] == "portail" and faite["studio"] in ("analyse/runs/essai-de-film/", "analyse/runs/essai-de-film/index.html"),
       f"l'analyse faite est dans la liste ({faite})")
    if faite and shutil.which("node"):
        # la chaîne factice rend sa page par le vrai studio.mjs : une nouvelle analyse a la forme de nos films
        ok(faite["forme"] == "portail" and faite["depouillement"] == "analyse/runs/essai-de-film/?vue=depouillement",
           f"une nouvelle analyse a la forme du portail, Casting et Dépouillement dans sa page ({faite['forme']}, {faite['depouillement']})")
        st, page = call("GET", "/" + faite["studio"])
        txt = page.decode("utf-8", "replace") if isinstance(page, bytes) else ""
        video = re.search(r"<video[^>]*>", txt)
        ok('href="../../film/film.css"' in txt and bool(video) and 'src="essai-de-film.mp4"' in video.group(0)
           and "data-repli" not in video.group(0), f"la page de l'analyse faite : le thème du portail, sa vidéo à côté d'elle ({video and video.group(0)})")
    if faite:
        for k in ("studio", "depouillement", "vignette"):
            st, _ = call("GET", "/" + (faite[k] or "absent"))
            ok(st == 200, f"analyse faite : {k} se sert ({st})")
        st, raw = call("GET", "/analyse/runs/essai-de-film/essai-de-film.mp4", headers={"Range": "bytes=0-3"})
        ok(st == 206, f"la vidéo est à côté de la page, lue par morceaux ({st})")
    st, _ = call("POST", "/api/analyse/run", {"item": vid.get("id"), "titre": "Essai de film"})
    ok(st == 409, "le même nom une seconde fois : refusé")
    st, libre = call("GET", "/api/analyse/nom/essai-de-film")
    ok(st == 200 and libre["libre"] is False and libre["reprendre"] is True, f"le nom est pris, reprenable ({libre})")
    st, ch = call("GET", "/api/analyse/chaine?frais=1")
    ok(st == 200 and ch["skill"] == str(FAUX) and isinstance(ch["outils"], list), f"l'état de la chaîne ({st})")

    # le relais de la diarisation, contre un faux service local (on ne touche pas au vrai, sur dgx1)
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Faux(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _rep(self, doc, code=200):
            b = json.dumps(doc).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            self._rep({"service": "diarisation", "pret": True, "phase": "prêt", "chemin": self.path})

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            recu = 0
            while recu < n:
                recu += len(self.rfile.read(min(1 << 16, n - recu)))
            self._rep({"recu": recu, "chemin": self.path, "cle": self.headers.get("X-Cle")})

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Faux)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    config.CFG["analyse_diarisation"] = f"http://127.0.0.1:{srv.server_address[1]}/diarisation"
    st, e = call("GET", "/api/analyse/diar/etat")
    ok(st == 200 and e.get("chemin") == "/diarisation/etat", f"relais : l'état ({st} {e})")
    corps = os.urandom(3 << 20)
    st, r = call("POST", "/api/analyse/diar/analyse?nom=essai&latence=1.04", raw=corps,
                 headers={"Content-Type": "application/octet-stream", "X-Cle": "k"})
    ok(st == 200 and r.get("recu") == len(corps) and "nom=essai" in r.get("chemin", "") and r.get("cle") == "k",
       f"relais : 3 Mo envoyés par morceaux, la requête et la clé suivent ({st} {r})")
    st, d = call("GET", "/api/analyse/diarisation")
    ok(st == 200 and d.get("up") is True, f"l'état de la diarisation ({d})")
    srv.shutdown()
    config.CFG["analyse_diarisation"] = "http://127.0.0.1:9/diarisation"
    st, d = call("GET", "/api/analyse/diarisation")
    ok(st == 200 and d.get("up") is False and d.get("remedes"), "un service muet : dit, avec quoi faire")
    st, _ = call("GET", "/api/analyse/diar/etat")
    ok(st == 502, f"relais vers un service muet : 502 ({st})")
