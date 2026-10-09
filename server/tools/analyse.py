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
  Tailscale (le portail, sur DGX2, est dans le tailnet) ;
- **les projets** (refonte du 29/09, la home « Projets » de MOVIE_ANALYSE) :
  nos films, les analyses faites d'ici, les projets créés dans le portail et
  ceux du dépôt partagé de MOVIE_ANALYSE (lu, fusionné comme le fait son
  `commun/projets.js`) — une seule liste ;
- **les corrections du portail** : le Worker de MOVIE_ANALYSE refuse
  d'écrire depuis l'adresse du portail (son `worker.js`, ligne 18 : ORIGINES ;
  lignes 142 et 148 : 403). Ce qu'on corrige dans un Studio du portail est
  donc gardé ici, pour tous ceux qui ouvrent le portail : seulement ce qui
  diffère du fichier du film et du dépôt partagé, pour que les corrections
  faites ailleurs continuent d'arriver.

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
    analyse_partage      le dépôt partagé lu (défaut : le Worker de MOVIE_ANALYSE ; le contrôle y met un faux)
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
# \Z et non $ : « $ » laisse passer un retour à la ligne final (« abc\n », %0A dans l'adresse)
NOM = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}\Z")
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
    """Les analyses du Workspace courant, comme les projets (projets_liste) : une analyse est
    à son projet — son Workspace (analyse/projets.json), sinon celui du travail qui l'a faite ;
    nos films et les analyses d'avant le 30/09 sont dans Général (library.space_of)."""
    with _store_lock:
        store = {p["id"]: p for p in _store_lit()}

    def ici(d: Path) -> bool:
        jid = (_lit_json(d / "portail.json") or {}).get("job")
        return library.readable(_doc({**store.get(d.name, {}), "id": d.name}, jobs.get(jid) if isinstance(jid, str) else None))
    out = []
    if produites().is_dir():
        faites = [d for d in produites().iterdir() if d.is_dir() and not d.name.startswith(".") and ici(d)]
        out += sorted((_entree(d, "portail") for d in faites), key=lambda e: e["date"], reverse=True)
    if DEPOT.is_dir():
        out += [_entree(d, "depot") for d in sorted(DEPOT.iterdir()) if d.is_dir() and (d / "shots.json").is_file() and ici(d)]
    return {"analyses": out, "runs": str(runs()), "partage": PARTAGE}


# ── le dépôt partagé du Worker (lecture) ────────────────────
def _get(url: str, timeout: float = 8.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "showrunner-portail"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def partage_url() -> str:
    return str(config.get("analyse_partage") or PARTAGE).rstrip("/")


# Ce que le Worker de MOVIE_ANALYSE fait d'une écriture venue du portail (lu dans son code,
# C:\claude\MOVIE_ANALYSE\outils\partage\worker.js, commit fa8d9d9) :
#   l. 18   const ORIGINES = [/^https:\/\/calculment0r\.github\.io$/, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];
#   l. 33   peutEcrire = l'en-tête Origin correspond à l'une d'elles
#   l. 142  PUT /corrections/<nom>.json : 403 { ok: false, erreur: 'origine non autorisée' }, avant toute écriture
#   l. 148  POST /publier/<film> : la même réponse
# La lecture (GET) est ouverte à toutes les origines (l. 24 : access-control-allow-origin = l'origine de la requête ;
# l. 81 : '*' pour les vidéos). Le portail lit donc tout, et n'écrit rien là-bas.
REFUS_ECRITURE = {
    "code": 403, "erreur": "origine non autorisée",
    "pourquoi": "le dépôt partagé de MOVIE_ANALYSE n'accepte d'écriture que depuis https://calculment0r.github.io "
                "et http://127.0.0.1 ou localhost — l'adresse du portail n'y est pas",
    "source": "MOVIE_ANALYSE/outils/partage/worker.js, ligne 18 (ORIGINES) ; lignes 142 et 148 (403)",
    "remede": "Cal ajoute l'adresse du portail à ORIGINES (/^http:\\/\\/(192\\.168\\.10\\.247|100\\.108\\.108\\.65):8790$/), "
              "puis « npx wrangler deploy » dans MOVIE_ANALYSE/outils/partage",
    "ici": "les projets et les corrections faits dans le portail sont gardés sur DGX2, pour tous ceux qui ouvrent le portail",
}


# ── les projets ─────────────────────────────────────────────
# La home de MOVIE_ANALYSE (index.html, commun/projets.js) : les analyses du dépôt sont des projets d'office, les projets
# créés vivent dans le dépôt partagé (projets.json) et dans la mémoire du navigateur ; fusion par projet, le plus récent
# gagne (champ maj) ; une suppression est gardée (supprime: true), et sur une analyse du dépôt elle la retire seulement
# de l'accueil. Ici, même règle : la liste du dépôt partagé est lue, celle du portail est écrite (le Worker la refuse).
NOM_PROJET = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}\Z")
# les identifiants que projets.js ne donne jamais (« projets », « essai ») et les dossiers de l'outil
RESERVES = {"projets", "essai", "analyses", "runs", "film", "diarisation", "commun", "chaine", "outils", "projet", "nouveau"}
_store_lock = threading.Lock()
_partage_cache: dict = {"t": 0.0, "v": None, "corr": {}}


def _dossier() -> Path:
    p = config.data_dir() / "analyse"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _ecrit_json(p: Path, doc) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name("." + p.name + ".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    tmp.replace(p)


def _store_lit() -> list[dict]:
    doc = _lit_json(_dossier() / "projets.json") or {}
    liste = doc.get("projets") if isinstance(doc, dict) else None
    return [p for p in liste if isinstance(p, dict) and isinstance(p.get("id"), str) and NOM_PROJET.match(p["id"])] \
        if isinstance(liste, list) else []


def _store_ecrit(liste: list[dict]) -> None:
    _ecrit_json(_dossier() / "projets.json", {"format": "movie-analysis-projets", "version": 1, "projets": liste})


def _partage_projets(frais: bool = False) -> dict:
    """projets.json du dépôt partagé, lu comme le lit commun/projets.js (GET, 6 s au plus), gardé 30 s."""
    with _verrou:
        v = _partage_cache["v"]
        if v and not frais and time.time() - _partage_cache["t"] < 30:
            return v
    url = partage_url() + "/corrections/projets.json"
    try:
        doc = json.loads(_get(url, timeout=6))
        liste = doc.get("projets") if isinstance(doc, dict) else None
        v = {"etat": "lu", "url": url, "lu": library.now(),
             "projets": [p for p in (liste if isinstance(liste, list) else [])
                         if isinstance(p, dict) and isinstance(p.get("id"), str) and NOM_PROJET.match(p["id"])],
             # {} : personne n'a encore créé de projet depuis la home de MOVIE_ANALYSE
             "vide": not isinstance(liste, list)}
    except (OSError, ValueError) as e:
        v = {"etat": "injoignable", "url": url, "lu": library.now(), "projets": [], "erreur": str(e)[:200]}
    with _verrou:
        _partage_cache.update(t=time.time(), v=v)
    return v


def _fusion(*listes: tuple[str, list]) -> dict[str, dict]:
    """commun/projets.js, fusion() : par projet, le plus récent (maj) gagne ; `_de` dit d'où il vient."""
    m: dict[str, dict] = {}
    for de, liste in listes:
        for p in liste:
            x = m.get(p["id"])
            if x is None or str(p.get("maj") or "") > str(x.get("maj") or ""):
                m[p["id"]] = {**p, "_de": de}
    return m


def _slug_projet(nom: str, pris: set) -> str:
    """commun/projets.js, slug() : sans accents, minuscules, tirets, 48 signes, « -2 » s'il est pris."""
    import unicodedata
    s = unicodedata.normalize("NFD", nom)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn").lower()
    base = re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:48].strip("-") or "projet"
    out, n = base, 2
    while out in pris:
        suffixe = f"-{n}"
        out = base[: 48 - len(suffixe)].rstrip("-") + suffixe
        n += 1
    return out


def _nom_propre(nom) -> str:
    return re.sub(r"\s+", " ", str(nom or "")).strip()[:80]


def _duree_lisible(s) -> str:
    try:
        s = int(round(float(s)))
    except (TypeError, ValueError):
        return ""
    return f"{s} s" if s < 60 else f"{s // 60} min {s % 60:02d}"


def _films() -> dict[str, Path]:
    return {d.name: d for d in sorted(DEPOT.iterdir()) if d.is_dir() and (d / "shots.json").is_file()} if DEPOT.is_dir() else {}


def _faites() -> dict[str, Path]:
    p = produites()
    return {d.name: d for d in sorted(p.iterdir()) if d.is_dir() and not d.name.startswith(".")}


ETAT_JOB = {"queued": "en file", "running": "en cours", "error": "échec", "cancelled": "arrêté", "interrupted": "interrompu"}


def _projet(pid: str, e: dict | None, d: Path | None, source: str | None, job: dict | None) -> dict:
    """Un projet tel que la page le montre : une carte, sa visionneuse (la page projet de MOVIE_ANALYSE)."""
    e = e or {}
    a = _entree(d, source) if d else None
    info = (_lit_json(d / "portail.json") or {}) if d else {}
    c = (a or {}).get("chiffres") or {}
    sorte = "film" if source == "depot" else "analyse" if (a or job) else "projet"
    p_job = (job or {}).get("params") or {}
    nom = (e.get("nom") if sorte != "film" else None) or (a or {}).get("titre") or p_job.get("titre") or pid
    if a:
        dep = {"etat": "fait", "resume": f"{nb(c.get('plans'))} plans · {nb(c.get('personnages'))} personnages · {nb(c.get('repliques'))} répliques"}
    elif job:
        dep = {"etat": ETAT_JOB.get(job["state"], job["state"]), "job": job["id"], "message": job.get("message") or "",
               "progress": job.get("progress")}
    else:
        dep = {"etat": "à faire"}
    voix = {"etat": "fait" if c.get("voix") else "à faire", "mots": bool(c.get("mots"))}
    w, h = c.get("largeur"), c.get("hauteur")
    video = info.get("video")
    if sorte == "film" and video:
        media = f"{PARTAGE}/video/{urllib.parse.quote(pid)}/{urllib.parse.quote(video)}"
    elif d and video and (d / video).is_file():
        media = f"analyse/runs/{pid}/{urllib.parse.quote(video)}"
    else:
        media = None
    # la vidéo de la bibliothèque qu'une analyse lancée d'ici a dépouillée (_publie, `origine`) : la
    # visionneuse en tire le son au défilement de son lecteur (GET /api/defil/<item>/son, 06/10)
    origine = info.get("origine") if isinstance(info.get("origine"), dict) else {}
    meta = info.get("meta") or " · ".join(x for x in (info.get("genre") or (a or {}).get("genre"), _duree_lisible(c.get("duree")),
                                                     f"{w}×{h}" if w and h else "") if x)
    return {
        "id": pid, "nom": nom, "sorte": sorte,
        # d'où vient la fiche : le dépôt de MOVIE_ANALYSE (nos films), le portail (analyse lancée ou projet créé d'ici),
        # le dépôt partagé (un projet créé depuis la home de MOVIE_ANALYSE)
        "origine": "depot" if sorte == "film" else "portail" if (a or job or e.get("_de") == "portail") else "partage",
        "retire": bool(e.get("supprime")), "retire_par": e.get("_de") if e.get("supprime") else None,
        "cree": e.get("cree") or (a or {}).get("date") or (job or {}).get("created"), "maj": e.get("maj"), "par": e.get("par"),
        "meta": meta or ("créé le " + str(e.get("cree") or "")[:10] if e.get("cree") else ""),
        # un dépouillement en cours n'a pas encore d'image clé : la vignette de sa vidéo (celle du travail)
        "vignette": (a or {}).get("vignette") or (job or {}).get("thumb"), "affiche": (a or {}).get("affiche"), "media": media,
        "item": origine.get("item") if media and isinstance(origine.get("item"), str) else None,
        "largeur": w, "hauteur": h, "duree": c.get("duree"),
        "studio": (a or {}).get("studio"), "casting": (a or {}).get("casting"), "depouillement": (a or {}).get("depouillement"),
        "labo": "analyse/diarisation/?projet=" + urllib.parse.quote(pid),
        "etapes": {"depouillement": dep, "voix": voix},
        "chiffres": c or None, "langue": c.get("langue"),
        "run": (a or {}).get("run") or (str(runs() / p_job["nom"]) if p_job.get("nom") else None),
        "date": (a or {}).get("date") or e.get("maj") or e.get("cree") or (job or {}).get("created"),
        "renommer": sorte != "film",
        # MOVIE_ANALYSE (projet/index.html) : une analyse du dépôt se retire de l'accueil (fichiers gardés, « Restaurer ») ;
        # un projet créé se supprime pour de bon. Une analyse lancée d'ici se retire comme une analyse du dépôt.
        "supprimer": "supprimer" if sorte == "projet" else "retirer",
    }


def nb(x) -> str:
    return "—" if x is None else str(x)


def projets_liste(req=None, frais: bool = False) -> dict:
    partage = _partage_projets(frais or (req is not None and req.q("frais") == "1"))
    with _store_lock:
        portail = _store_lit()
    fus = _fusion(("partage", partage["projets"]), ("portail", portail))
    films, faites = _films(), _faites()
    travaux: dict[str, dict] = {}
    for j in jobs.listing(tool="analyse", limit=200):
        n = (j.get("params") or {}).get("nom")
        if j.get("kind") == KIND and n and n not in travaux and j["state"] in ETAT_JOB:
            travaux[n] = j
    out, vus = [], set()
    # les projets du Workspace courant (Teams et Workspaces, étape 2) : ceux sans Workspace
    # (nos films, le dépôt partagé, d'avant le 30/09) sont dans Général (library.space_of)
    ici = lambda pid, e, j=None: library.readable(_doc({**(e or {}), "id": pid}, j))   # noqa: E731
    for pid, d in films.items():
        vus.add(pid)
        if ici(pid, fus.get(pid)):
            out.append(_projet(pid, fus.get(pid), d, "depot", None))
    for pid, d in faites.items():
        if pid not in vus:
            vus.add(pid)
            if ici(pid, fus.get(pid)):
                out.append(_projet(pid, fus.get(pid), d, "portail", None))
    for pid, j in travaux.items():
        if pid not in vus:
            vus.add(pid)
            if ici(pid, fus.get(pid), j):
                out.append(_projet(pid, fus.get(pid), None, None, j))
    for pid, e in fus.items():
        # un projet créé puis supprimé l'est pour de bon ; un masque (depot: true) sans analyse ne désigne rien ici
        if pid in vus or e.get("supprime") or e.get("depot"):
            continue
        vus.add(pid)
        if ici(pid, e):
            out.append(_projet(pid, e, None, None, None))
    # nos films en tête, puis le plus récent d'abord
    films_l = [p for p in out if p["sorte"] == "film"]
    autres = sorted((p for p in out if p["sorte"] != "film"), key=lambda p: str(p["date"] or ""), reverse=True)
    return {"projets": films_l + autres, "runs": str(runs()),
            "partage": {"etat": partage["etat"], "url": partage["url"], "lu": partage["lu"], "erreur": partage.get("erreur"),
                        "n": len(partage["projets"]), "vide": partage.get("vide", False),
                        "video": PARTAGE + "/video/", "ecriture": REFUS_ECRITURE},
            "portail": {"n": len(portail), "ou": str(_dossier() / "projets.json")}}


def _un(pid: str) -> dict | None:
    return next((p for p in projets_liste()["projets"] if p["id"] == pid), None)


def _pris() -> set:
    with _store_lock:
        ids = {p["id"] for p in _store_lit()}
    ids |= {p["id"] for p in _partage_projets()["projets"]} | set(_films()) | set(_faites()) | RESERVES
    try:
        ids |= {d.name for d in runs().iterdir()}
    except OSError:
        pass
    ids |= {(j.get("params") or {}).get("nom") for j in jobs.listing(active=True, tool="analyse")}
    return ids


def projet_creer(req):
    """« Nouveau projet » (index.html de MOVIE_ANALYSE) : le nom tout de suite, le projet créé, la page l'ouvre."""
    nom = _nom_propre(req.json().get("nom"))
    if not nom:
        raise HttpError(400, "il faut un nom")
    pris = _pris()
    with _store_lock:
        store = _store_lit()
        pid = _slug_projet(nom, pris | {p["id"] for p in store})
        now = library.now()
        # `auteur` : qui l'a créé, posé une fois (`par` suit le dernier geste) ; `space` : son Workspace,
        # celui de la requête (library.new_space : 403 si l'on n'y crée pas) — ses éditeurs le changent
        store.append({"id": pid, "nom": nom, "cree": now, "maj": now, "par": auth_id(), "auteur": auth_id(),
                      "space": library.new_space()})
        _store_ecrit(store)
    return {"projet": _un(pid), "enregistre": "portail", "partage": REFUS_ECRITURE}


def _doc(e: dict | None, job: dict | None = None) -> dict:
    """Un projet vu comme un document de la bibliothèque : son auteur, son Workspace
    (sans le champ — une analyse du dépôt, du dépôt partagé, d'avant le 30/09 :
    l'espace par défaut, Général)."""
    e = e or {}
    return {"id": e.get("id"), "owner": e.get("auteur"), "space": e.get("space") or (job or {}).get("space")}


def _peut_ecrire(pid: str, store: list[dict] | None = None) -> bool:
    """La règle des objets (auth.can_write_item) sur un projet du portail : un éditeur
    de son Workspace (décision 9), ou Cal. Un projet sans auteur — une analyse du dépôt,
    un projet du dépôt partagé, un projet d'avant le 29/09 — est à Cal, dans Général."""
    from core import auth
    e = next((p for p in (store if store is not None else _store_lit()) if p["id"] == pid), None)
    return library.in_here(_doc(e)) and auth.can_write_item(_doc(e), auth.current())


def _refuse_ecriture(pid: str) -> None:
    raise HttpError(403, f"« {pid} » n'est pas à toi : seul son auteur (ou Cal) le renomme, le retire, "
                         "le corrige ou relance son dépouillement")


def projet_modifier(req, pid):
    """Renommer, supprimer (un projet créé) ou retirer de l'accueil (une analyse), restaurer."""
    if not NOM_PROJET.match(pid):
        raise HttpError(404, "projet inconnu")
    d = req.json()
    cur = _un(pid)
    if cur is None:
        # un projet déjà supprimé, ou retiré par le dépôt partagé : on peut encore le restaurer
        fus = _fusion(("partage", _partage_projets()["projets"]), ("portail", _store_lit()))
        if pid not in fus:
            raise HttpError(404, f"projet inconnu : {pid}")
    elif "nom" in d and not cur["renommer"]:
        raise HttpError(400, "le titre d'un de nos films vient de MOVIE_ANALYSE (analyse/analyses/<film>/portail.json) : il ne se renomme pas d'ici")
    with _store_lock:
        store = _store_lit()
        if not _peut_ecrire(pid, store):
            _refuse_ecriture(pid)
        e = next((p for p in store if p["id"] == pid), None)
        if e is None:
            base = _fusion(("partage", _partage_projets()["projets"]), ("portail", store)).get(pid) or {"id": pid}
            # l'auteur ne vient jamais d'ailleurs que d'ici (projet_creer)
            e = {k: v for k, v in base.items() if not k.startswith("_") and k != "auteur"}
            e.setdefault("cree", library.now())
            if cur and cur["sorte"] != "projet":
                e["depot"] = True   # comme projets.js : un masque sur une analyse, pas un projet créé
            store.append(e)
        if "nom" in d:
            nom = _nom_propre(d["nom"])
            if not nom:
                raise HttpError(400, "il faut un nom")
            e["nom"] = nom
        if "supprime" in d:
            e["supprime"] = bool(d["supprime"])
        e["maj"], e["par"] = library.now(), auth_id()
        _store_ecrit(store)
    return {"projet": _un(pid), "enregistre": "portail"}


def auth_id():
    from core import auth
    try:
        return auth.current_id()
    except Exception:   # hors d'une requête (le contrôle)
        return None


# ── les corrections faites dans un Studio du portail ────────
CLES_CORR = ("noms", "fusions", "repliques", "locuteurs", "voix")


def _dossier_film(film: str) -> Path | None:
    if (DEPOT / film / "shots.json").is_file():
        return DEPOT / film
    d = produites() / film
    return d if d.is_dir() else None


def _partage_corr(film: str) -> dict:
    """Les corrections du dépôt partagé pour un de nos films (GET, ouvert), gardées 20 s."""
    with _verrou:
        t, v = _partage_cache["corr"].get(film, (0.0, None))
        if v is not None and time.time() - t < 20:
            return v
    try:
        v = json.loads(_get(f"{partage_url()}/corrections/{urllib.parse.quote(film)}.json", timeout=6))
        v = v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        v = {}
    with _verrou:
        _partage_cache["corr"][film] = (time.time(), v)
    return v


def _corr_base(film: str) -> dict:
    """Ce que la page a sous les yeux avant le portail : le fichier du film, puis le dépôt partagé par-dessus, clé
    par clé (studio.mjs, lecture au chargement)."""
    d = _dossier_film(film)
    base = (_lit_json(d / "corrections.json") if d else None) or {}
    if (DEPOT / film / "shots.json").is_file():
        w = _partage_corr(film)
        for k in CLES_CORR:
            base[k] = {**(base.get(k) or {}), **(w.get(k) or {})}
    return base


def _canon(v) -> str:
    return json.dumps(v, sort_keys=True, ensure_ascii=False)


def corrections_lire(req, film):
    if not NOM_PROJET.match(film) or _dossier_film(film) is None:
        raise HttpError(404, f"film inconnu : {film}")
    doc = _lit_json(_dossier() / "corrections" / f"{film}.json") or {}
    return {**{k: doc.get(k) or {} for k in CLES_CORR}, "maj": doc.get("maj"), "par": doc.get("par"), "enregistre": "portail"}


def corrections_ecrire(req, film):
    """Le Studio envoie tout ce qu'il a (le fichier, le dépôt partagé, le portail, ses gestes) : on ne garde que ce qui
    diffère du fichier et du dépôt partagé. Une correction faite ailleurs sur une autre clé continue donc d'arriver."""
    if not NOM_PROJET.match(film) or _dossier_film(film) is None:
        raise HttpError(404, f"film inconnu : {film}")
    if not _peut_ecrire(film):   # les corrections d'un film : l'auteur de son projet, ou Cal (nos films : Cal)
        _refuse_ecriture(film)
    if len(req.body()) > 1 << 20:
        raise HttpError(413, "document trop gros (1 Mo au plus)")
    d = req.json()
    base = _corr_base(film)
    doc = {"format": "portail-corrections", "film": film}
    n = 0
    for k in CLES_CORR:
        v = d.get(k) or {}
        if not isinstance(v, dict):
            raise HttpError(400, f"« {k} » : un objet est attendu")
        b = base.get(k) or {}
        garde = {}
        for x, val in v.items():
            if x in b and _canon(val) == _canon(b[x]):
                continue
            # ce que vaut une clé absente : une fusion « à part » (x → x), l'automatique (null) — rien à garder
            if x not in b and (val is None or (k == "fusions" and val == x)):
                continue
            garde[x] = val
        doc[k] = garde
        n += len(garde)
    doc.update(maj=library.now(), par=auth_id())
    _ecrit_json(_dossier() / "corrections" / f"{film}.json", doc)
    return {"ok": True, "enregistre": "portail", "entrees": n, "partage": REFUS_ECRITURE}


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
    if method != "GET":
        # écrire sur dgx1 (déposer un son à diariser, retirer un travail) passe hors de la file du
        # portail — ni quota, ni propriétaire : réservé aux admins (29/09) ; lire reste à tous
        from core import auth
        if not auth.is_admin(auth.current()):
            raise HttpError(403, "la diarisation directe (déposer, retirer) passe hors de la file : réservée à Cal")
    try:
        n = int(req.headers.get("Content-Length") or 0) if method == "POST" else 0
    except ValueError as e:
        raise HttpError(400, "Content-Length illisible") from e
    if n < 0:
        raise HttpError(400, "Content-Length négatif")
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
def _a_lance(nom: str) -> bool:
    """Reprendre un dépouillement (il réécrit sa page publiée) : Cal, ou la
    personne qui a lancé le dernier travail de ce nom (la file en garde 400)."""
    from core import auth
    u = auth.current()
    if u is None or auth.is_admin(u):
        return True
    last = next((j for j in jobs.listing(tool="analyse", limit=jobs.KEEP) if (j.get("params") or {}).get("nom") == nom), None)
    return bool(last) and last.get("owner") == u["id"]


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
    # lancée depuis un projet (sa visionneuse, « Lancer le dépouillement ») : le dossier de travail porte son nom
    projet = str(d.get("projet") or "").strip()
    if projet:
        pr = _un(projet)
        if not pr or pr["sorte"] != "projet":
            raise HttpError(400, f"« {projet} » n'est pas un projet à dépouiller (déjà fait, ou inconnu)")
        if not _peut_ecrire(projet):
            _refuse_ecriture(projet)
        titre = titre or pr["nom"]
    if item_id:
        it = library.get(str(item_id))
        if not it or it["kind"] != "video":
            raise HttpError(400, "ce n'est pas une vidéo de la bibliothèque")
        titre = titre or it.get("title") or ""
        nom = projet or str(d.get("nom") or _slug(titre))
        if not NOM.match(nom):
            raise HttpError(400, "nom du dossier : minuscules, chiffres et tirets (48 au plus)")
        if nom in _films():
            raise HttpError(409, f"« {nom} » est un de nos films (analyse/analyses/{nom}/) : changer le titre")
        if not projet:
            with _store_lock:
                autre = next((p for p in _store_lit() if p["id"] == nom and not p.get("supprime")), None)
            if autre:
                raise HttpError(409, f"le projet « {autre.get('nom') or nom} » porte déjà ce nom : le lancer depuis sa fiche, ou changer le titre")
        thumb = library.public(it).get("thumb_url")
        params = {"item": it["id"]}
    else:
        if not YT.match(url):
            raise HttpError(400, "une adresse YouTube : https://www.youtube.com/watch?v=…, https://youtu.be/…")
        m = YT_ID.search(url)
        if not m:
            raise HttpError(400, "identifiant de vidéo introuvable dans l'adresse")
        # analyse.sh range un travail YouTube sous --youtube-id (l'identifiant de la vidéo s'il manque) : c'est son nom ;
        # lancé depuis un projet, le projet lui donne le sien (analyse.sh : work="$HOME/reelbench/runs/$ytid")
        nom = projet or m.group(1)
        if nom in _films():
            raise HttpError(409, f"« {nom} » est un de nos films : on n'y touche pas")
        params = {"url": url}
    w = runs() / nom
    reprendre = bool(d.get("reprendre"))
    if reprendre and not projet and not _a_lance(nom):
        _refuse_ecriture(nom)
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
def _inventaire():
    """Les projets créés dans le portail, pour l'inventaire (core/inventaire.py) : `auteur`
    (posé une fois par projet_creer ; `par` ne dit que le dernier geste) et `space`. Une
    analyse du dépôt masquée ici (`depot`) n'est pas une création ; un projet supprimé non
    plus. Les dépouillements (analyses/) suivent leur projet."""
    for e in _store_lit():
        if e.get("depot") or e.get("supprime"):
            continue
        yield {"id": e["id"], "title": e.get("nom") or e["id"], "owner": e.get("auteur"), "space": e.get("space"),
               "created": e.get("cree"), "updated": e.get("maj"), "open": f"analyse/?projet={e['id']}"}


def register(app) -> None:
    from core import inventaire
    inventaire.declare("analyse", label="projet d'analyse", plural="projets d'analyse", tool="analyse", store="analyse",
                       lister=_inventaire, order=25)
    app.mount("analyse/runs", produites())
    jobs.register(KIND, run, lane="analyse", title="Analyse de film", cost="gpu")   # Whisper, VLM, pyannote sur DGX2
    app.route("GET", "/api/analyse/list", analyses_list)
    # les projets (la home de MOVIE_ANALYSE, refonte du 29/09) et les corrections faites dans un Studio du portail
    app.route("GET", "/api/analyse/projets", projets_liste)
    app.route("POST", "/api/analyse/projets", projet_creer)
    app.route("POST", "/api/analyse/projets/{pid}", projet_modifier)
    app.route("GET", "/api/analyse/corrections/{film}", corrections_lire)
    app.route("PUT", "/api/analyse/corrections/{film}", corrections_ecrire)
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
                 "/analyse/commun/projets.js"):
        st, _ = call("GET", page)
        ok(st == 200, f"{page} se sert ({st})")
    st, _ = call("GET", "/analyse/runs/../../jobs.json")
    ok(st == 404, "les pages produites ne sortent pas de leur dossier")

    # le thème (CLAUDE.md) : aucune couleur écrite hors de la palette de Movie Analysis (film/palette.css, deux jeux :
    # le sombre et le clair) — les scripts des pages lisent les jetons, et les relisent quand le thème change
    teinte = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d")
    bordure = re.compile(r"(?<![-\w])border(-(top|right|bottom|left))?(-(width|style|color))?\s*:(?!\s*(0|none)\s*[;}])")
    css = (TOOL / "film" / "film.css").read_text(encoding="utf-8")
    ok('@import url("palette.css")' in css and not teinte.search(css), "film.css : aucune couleur, la palette importée")
    ok(not bordure.search(css), "film.css : des filets, jamais de bordures")
    pal = (TOOL / "film" / "palette.css").read_text(encoding="utf-8")
    blocs = re.findall(r"(:root|\[data-theme=\"light\"\])\s*\{([^}]*)\}", pal)
    ok([b[0] for b in blocs] == [":root", '[data-theme="light"]']
       and all(re.fullmatch(r"--(pc-\d+|pv-\d|ry-[a-z]+)", n) for _, corps in blocs for n in re.findall(r"(--[\w-]+)\s*:", corps))
       and not teinte.search(re.sub(r"(:root|\[data-theme=\"light\"\])\s*\{[^}]*\}", "", pal)),
       "film/palette.css : la palette seule (personnages, voix, rythme), en deux jeux, sombre et clair")
    for f in ("voix.js", "son.js", "menus.js", "studio.mjs", "casting-parts.mjs"):
        src = (TOOL / "chaine" / f).read_text(encoding="utf-8")
        ok(not re.search(r"['\"]#[0-9a-fA-F]{3,8}['\"]|rgba?\(\s*\d", src), f"chaine/{f} : aucune couleur écrite")
        ok("xverse-theme" not in src, f"chaine/{f} : pas de second choix de thème (xverse-theme)")
    # le labo des voix suit le thème du portail : ses noms de teintes renvoient aux jetons, rien d'écrit en dur
    labo = (TOOL / "diarisation" / "index.html").read_text(encoding="utf-8")
    ok(not re.search(r"['\"(:, ]#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d", labo) and not bordure.search(labo.replace("border:0", ""))
       and 'href="../film/palette.css"' in labo and "sr:theme" in labo,
       "diarisation/index.html : aucune couleur écrite, des filets, la palette des voix, relue quand le thème change")
    # l'en-tête du portail y est celle des autres pages, par les mêmes feuilles (plus de copie bornée à .hdr, l'ancien
    # diarisation/portail.css) : la page charge base.css et shell.css, et ses classes ne croisent pas celles du portail
    # (sa .mono, sa .pill, sa .pan, sa .bar, sa .wrap — celle des préférences — sont devenues .num, .bouton, .onglets,
    # .barre-page, .corps-page le 05/10)
    feuille = re.search(r"<style>(.*?)</style>", re.sub(r"url\(data:[^)]*\)", "", labo), re.S).group(1)
    ok(all(f'href="../../commun/{x}.css"' in labo for x in ("tokens", "base", "shell")) and "portail.css" not in labo
       and not (TOOL / "diarisation" / "portail.css").exists()
       and not re.search(r"(?<![\w-])\.(mono|pill|pan|bar|wrap)(?![\w-])", feuille)
       and not re.search(r"""class(=|: )["'][^"']*\b(mono|pill|pan|bar|wrap)\b""", labo),
       "diarisation/index.html : base.css et shell.css comme partout, aucune classe de la page ne croise base.css")
    # la hauteur de l'écran sous la taille de l'interface : calc(N * var(--vh)), jamais Nvh (étude des préférences § 6)
    for f in ("analyse.css", "film/film.css", "diarisation/index.html"):
        src = (TOOL / f).read_text(encoding="utf-8")
        ok(not re.search(r"(?<![\w.])\d+(\.\d+)?vh\b", re.sub(r"url\(data:[^)]*\)", "", src)), f"{f} : pas de vh sous le zoom de l'interface")

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
    jobs.register(KIND, run, lane="cpu", title="Analyse de film", cost="gpu")   # le contrôle n'a que la voie cpu
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
        st, pl = call("GET", "/api/analyse/projets")
        pr = {x["id"]: x for x in (pl.get("projets") or [])}.get("essai-de-film") or {}
        ok(pr.get("item") == vid.get("id") and (pr.get("media") or "").endswith("essai-de-film.mp4"),
           f"le projet dit la vidéo de la bibliothèque dépouillée : le son au défilement de sa visionneuse ({pr.get('item')}, {pr.get('media')})")
    st, _ = call("POST", "/api/analyse/run", {"item": vid.get("id"), "titre": "Essai de film"})
    ok(st == 409, "le même nom une seconde fois : refusé")
    st, libre = call("GET", "/api/analyse/nom/essai-de-film")
    ok(st == 200 and libre["libre"] is False and libre["reprendre"] is True, f"le nom est pris, reprenable ({libre})")
    st, ch = call("GET", "/api/analyse/chaine?frais=1")
    ok(st == 200 and ch["skill"] == str(FAUX) and isinstance(ch["outils"], list), f"l'état de la chaîne ({st})")

    # les projets (refonte du 29/09), contre un faux dépôt partagé : on ne lit ni n'écrit le vrai Worker de MOVIE_ANALYSE
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    ecrits = []

    class FauxPartage(BaseHTTPRequestHandler):
        DOCS = {
            "/corrections/projets.json": {"format": "movie-analysis-projets", "version": 1, "projets": [
                {"id": "bande-annonce-dune", "nom": "Bande-annonce Dune", "cree": "2026-09-27T10:00:00Z", "maj": "2026-09-27T10:00:00Z"},
                {"id": "wall", "depot": True, "supprime": True, "cree": "2026-09-27T11:00:00Z", "maj": "2026-09-27T11:00:00Z"},
                {"id": "vieux", "nom": "Vieux", "supprime": True, "cree": "2026-09-20T10:00:00Z", "maj": "2026-09-21T10:00:00Z"}]},
            "/corrections/getaround.json": {"noms": {"P1": "Commissaire", "P9": "Le livreur"}},
        }

        def log_message(self, *a):
            pass

        def do_GET(self):
            b = json.dumps(self.DOCS.get(self.path, {})).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_PUT(self):
            ecrits.append(self.path)
            self.send_response(403)
            self.end_headers()

        do_POST = do_PUT

    fp = ThreadingHTTPServer(("127.0.0.1", 0), FauxPartage)
    threading.Thread(target=fp.serve_forever, daemon=True).start()
    config.CFG["analyse_partage"] = f"http://127.0.0.1:{fp.server_address[1]}"
    st, pl = call("GET", "/api/analyse/projets?frais=1")
    par = {p["id"]: p for p in pl.get("projets", [])} if st == 200 else {}
    ok(st == 200 and pl["partage"]["etat"] == "lu" and pl["partage"]["n"] == 3, f"les projets : le dépôt partagé lu ({st} {pl.get('partage')})")
    ids = [p["id"] for p in pl.get("projets", [])]
    ok(ids[:2] == ["getaround", "wall"], f"nos films en tête de la liste ({ids})")
    g2 = par.get("getaround") or {}
    ok(g2.get("sorte") == "film" and g2.get("nom") == "Évadez-vous avec Getaround" and g2["etapes"]["depouillement"]["etat"] == "fait"
       and g2["etapes"]["voix"]["etat"] == "fait" and g2.get("studio") == "analyse/analyses/getaround/"
       and (g2.get("media") or "").endswith("/video/getaround/getaround.mp4"),
       f"Getaround : un film, dépouillé, ses voix, son Studio, sa vidéo sur R2 ({g2})")
    ok(g2.get("meta") == "publicité · 30 s · 1920×804", f"Getaround : la ligne de sa carte, celle de MOVIE_ANALYSE ({g2.get('meta')})")
    ok((par.get("wall") or {}).get("retire") is True and par["wall"].get("retire_par") == "partage",
       f"Wall retiré de l'accueil par le dépôt partagé : retiré ici aussi, restaurable ({par.get('wall')})")
    dune = par.get("bande-annonce-dune") or {}
    ok(dune.get("sorte") == "projet" and dune.get("origine") == "partage" and dune["etapes"]["depouillement"]["etat"] == "à faire",
       f"un projet créé depuis la home de MOVIE_ANALYSE est là, à dépouiller ({dune})")
    ok("vieux" not in par, "un projet supprimé du dépôt partagé ne revient pas")
    ok(pl["partage"]["ecriture"]["code"] == 403 and "worker.js" in pl["partage"]["ecriture"]["source"],
       "le refus d'écriture du Worker est dit, avec sa source")
    st, cr = call("POST", "/api/analyse/projets", {"nom": "  Bande-annonce   Dune "})
    ok(st == 200 and cr["projet"]["id"] == "bande-annonce-dune-2" and cr["projet"]["nom"] == "Bande-annonce Dune"
       and cr["enregistre"] == "portail", f"Nouveau projet : le nom propre, l'identifiant libre ({st} {cr})")
    st, _ = call("POST", "/api/analyse/projets", {"nom": "   "})
    ok(st == 400, "un projet sans nom : refusé")
    st, r = call("POST", "/api/analyse/projets/bande-annonce-dune-2", {"nom": "Dune, la bande-annonce"})
    ok(st == 200 and r["projet"]["nom"] == "Dune, la bande-annonce", f"renommer un projet ({st})")
    st, _ = call("POST", "/api/analyse/projets/getaround", {"nom": "Autre"})
    ok(st == 400, "un de nos films ne se renomme pas d'ici")
    st, r = call("POST", "/api/analyse/projets/getaround", {"supprime": True})
    ok(st == 200 and r["projet"]["retire"] is True and r["projet"]["retire_par"] == "portail", f"retirer Getaround de l'accueil ({st})")
    st, r = call("POST", "/api/analyse/projets/getaround", {"supprime": False})
    ok(st == 200 and r["projet"]["retire"] is False, "et le restaurer")
    st, r = call("POST", "/api/analyse/projets/wall", {"supprime": False})
    ok(st == 200 and r["projet"]["retire"] is False, "restaurer ici un film retiré par le dépôt partagé (le plus récent gagne)")
    st, r = call("POST", "/api/analyse/projets/bande-annonce-dune-2", {"supprime": True})
    st, pl = call("GET", "/api/analyse/projets")
    ok("bande-annonce-dune-2" not in {p["id"] for p in pl["projets"]}, "un projet créé supprimé : pour de bon")
    st, _ = call("POST", "/api/analyse/projets/inconnu-du-tout", {"supprime": True})
    ok(st == 404, "un projet inconnu : 404")
    # lancer le dépouillement d'un projet : le dossier de travail porte son nom
    st, pr = call("POST", "/api/analyse/projets", {"nom": "Mon essai"})
    st, j2 = call("POST", "/api/analyse/run", {"item": vid.get("id"), "projet": "mon-essai", "langue": "fr"})
    ok(st == 200 and j2["params"]["nom"] == "mon-essai" and j2["params"]["titre"] == "Mon essai",
       f"le dépouillement d'un projet part sous son nom ({st} {j2})")
    for _ in range(300):
        st, j2 = call("GET", f"/api/jobs/{j2['id']}")
        if j2["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.1)
    st, pl = call("GET", "/api/analyse/projets")
    me = {p["id"]: p for p in pl["projets"]}.get("mon-essai") or {}
    ok(j2["state"] == "done" and me.get("sorte") == "analyse" and me.get("nom") == "Mon essai"
       and me["etapes"]["depouillement"]["etat"] == "fait" and me.get("studio") == "analyse/runs/mon-essai/",
       f"le projet a son dépouillement, sa page, son nom ({j2['state']} {me})")
    st, _ = call("POST", "/api/analyse/run", {"item": vid.get("id"), "nom": "wall"})
    ok(st == 409, "une analyse au nom d'un de nos films : refusée")
    # les corrections d'un Studio du portail : seulement ce qui diffère du fichier et du dépôt partagé
    st, r = call("PUT", "/api/analyse/corrections/getaround",
                 {"noms": {"P1": "Commissaire", "P9": "Le livreur", "P2": "Le chef"}, "fusions": {"P4": "P4"}, "locuteurs": {"1.0-2.0": None}})
    ok(st == 200 and r.get("ok") is True and r["entrees"] == 1 and r["enregistre"] == "portail", f"corrections : enregistrées dans le portail ({st} {r})")
    st, c = call("GET", "/api/analyse/corrections/getaround")
    ok(st == 200 and c["noms"] == {"P2": "Le chef"} and c["fusions"] == {} and c["locuteurs"] == {},
       f"corrections : le portail ne garde que sa part ({c})")
    st, _ = call("PUT", "/api/analyse/corrections/inconnu", {"noms": {}})
    ok(st == 404, "corrections d'un film inconnu : 404")
    st, _ = call("PUT", "/api/analyse/corrections/getaround", {"noms": ["P1"]})
    ok(st == 400, "corrections mal formées : 400")
    ok(not ecrits, f"rien n'a été écrit dans le dépôt partagé ({ecrits})")
    # la page d'un de nos films lit le fichier, le dépôt partagé, puis le portail, et écrit dans le portail
    st, page = call("GET", "/analyse/analyses/getaround/")
    txt = page.decode("utf-8", "replace") if isinstance(page, bytes) else ""
    ok("window.XV_CORR_PORTAIL = \"../../../api/analyse/corrections/getaround\"" in txt and "XV_PARTAGE_REFUS" in txt,
       "le Studio de Getaround écrit ses corrections dans le portail et dit pourquoi pas dans le dépôt partagé")
    fp.shutdown()
    config.CFG.pop("analyse_partage", None)
    _partage_cache.update(t=0.0, v=None, corr={})

    # le relais de la diarisation, contre un faux service local (on ne touche pas au vrai, sur dgx1)

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
