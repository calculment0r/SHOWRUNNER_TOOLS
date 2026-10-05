"""La page « Asset » : ce que la bibliothèque commune (`core/library.py`,
`tools/core_api.py`) ne sait pas encore faire pour elle.

  GET  /api/asset/view?kind=&q=&folder=&fspace=&space=&sort=&fav=1&tool=&origin=&limit=&offset=
       une vue de la page : les objets d'un niveau (la racine ou un
       dossier), les dossiers de la racine avec leurs vignettes en petit,
       les comptes par sorte et par origine, les outils d'origine. Une
       recherche (`q`) parcourt tous les dossiers. `origin=upload` : ce
       qu'on a déposé de son disque (`origin.tool == "upload"`, la
       catégorie « Uploads ») ; `origin=made` : ce que les outils ont fait.
       Teams et Workspaces (étape 5, equipes_espaces.md § 3.1) : tous les
       Workspaces que la personne voit (`spaces` : ses Teams, le courant en
       tête, le compte de chacun) ; `space=` n'en montre qu'un. Chaque objet
       dit le sien (`space`), le courant vient en tête. Un dossier est à un
       Workspace (`fspace`, par défaut le courant) : ceux d'ailleurs se
       montrent, marqués, et ne se touchent pas d'ici.
       La page de gestion (30/09, « asset-page ») y ajoute : `space=a,b` (une
       Team : ses Workspaces), `flat=1` (tout, dossiers traversés : Favoris,
       Récents, un filtre), `author=<uid>`, `since=<jours>`, et les tris
       `kind`, `size`, `space` (en plus de new, old, updated, title) ; chaque
       objet dit son poids (`bytes`), la vue rend les auteurs (`authors`) et
       les dossiers de chaque Workspace (`folders_by_space`, déclarés compris).
  GET  /api/asset/tree                           l'arbre de la page : Teams → Workspaces →
       dossiers, avec leurs comptes ; favoris, récents (7 jours), corbeille
  POST /api/asset/folders {name}                 déclarer un dossier (vide) dans le Workspace
       de la requête ; POST /api/asset/folders/forget {name} l'oublie (ses objets restent)
  POST /api/asset/folders/delete {name}          supprimer un dossier : ses objets à la
       corbeille (tout ou rien), le nom oublié ; rend `trashed` (l'annuler les rend)
  GET  /api/asset/trash?spaces=*                 la corbeille de chaque Workspace qu'on voit
  POST /api/asset/trash/empty {ids?}             vider la corbeille du Workspace de la requête
       (ou ces objets-là) : ce que la personne peut jeter (l'auteur, un admin
       du Workspace, Cal) — le seul geste qui efface, jamais annulable
  GET  /api/asset/espaces                        les Workspaces que la personne voit (le filtre, le panneau)
  POST /api/espaces/<B>/rapatrier {items, folder?}   (server/tools/equipes.py) : une copie neuve dans B
  POST /api/asset/move {ids, folder}             ranger (ou sortir : folder "")
  POST /api/asset/folders/rename {from, to}      renommer un dossier = ses objets
  POST /api/asset/bulk {ids, fav?, tags_add?, tags_remove?}   plusieurs à la fois ;
       rend l'état d'avant (`before`), que {restore: before} remet
  POST /api/asset/trash {ids} · /api/asset/restore {ids}      corbeille, retour, en lot
  POST /api/asset/zip {ids}                      un zip de la sélection (voir `zip_make`)
  GET  /api/asset/zip/<jeton>/<nom>.zip          le zip, servi en flux depuis le disque
  GET  /api/asset/lineage/<id>                   parents et enfants
  GET  /api/asset/trash                          la corbeille
  GET  /api/asset/trash/<id>/thumb               la vignette d'un objet jeté
  POST /api/asset/cf/refresh {id}                un personnage déjà importé,
                                                 remis à jour sur place ; s'il est
                                                 un élément versionné (ou l'une de ses
                                                 planches) : une version de plus (30/09)
  POST /api/asset/refs/<id> {refs}               la planche d'un élément, dans l'ordre
  GET  /api/asset/dock?kind=&etype=&media=&q=&folder=&fav=1&space=&spaces=*&limit=&offset=
       le panneau Asset commun (commun/dock.js) : une page d'objets, les
       comptes des pastilles ; etype= et media= : voir `dock_list` ; par
       défaut le Workspace courant, `space=` un autre qu'on voit (« Autres
       workspaces »), `spaces=*` tous

Un dossier existe par ses objets (le champ `folder` de chacun,
ARCHITECTURE.md §2) ; un dossier créé dans la page (« Nouveau dossier »)
est aussi DÉCLARÉ (`asset_folders.json` des données, par Workspace) : il
reste, vide, jusqu'à ce qu'on le supprime ou le dégroupe — comme un
dossier du Finder. Un seul niveau, comme dans la maquette du 28/09 (« un
dossier tient des personnages et des objets, pas d'autre dossier »).

Montrer et toucher (étape 5) : la page montre tous les Workspaces qu'on voit
(library.query(spaces=…), library.see) ; ranger, aimer, taguer, jeter ne
touchent que le Workspace courant (library.get) — un objet d'ailleurs répond
409, qui dit où il est et qu'on le rapatrie (core_api.elsewhere_or_404).
Télécharger (un zip, la lignée) montre : où qu'il soit. La page de gestion
(asset/asset.js) envoie donc chaque geste DANS le Workspace de l'objet
(l'en-tête X-SR-Espace de la requête) : le serveur y juge le rôle de la
personne, comme si l'onglet y était ; passer d'un Workspace à un autre reste
une copie (rapatrier), jamais un déplacement.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import threading
import time
import unicodedata
import urllib.parse
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from core import auth, config, espaces, library
from core.http import FileResponse, HttpError
from tools import core_api

FOLDER_MAX = 60


def _all(q: str = "", sort: str = "new", fav: bool = False, tool: str = "", versions: bool = False,
         spaces=None) -> list[dict]:
    """Les objets de la page ; les versions d'un élément restent empilées sous lui
    (`versions=False`, library.query) — la lignée, elle, les voit toutes. `spaces` :
    None, le Workspace courant (ranger, renommer : on ne touche que lui) ; une liste,
    ou « * » : montrer (library.query)."""
    return library.query(None, q, None, sort, 1_000_000, 0, fav, tool, versions=versions, spaces=spaces)["items"]


def spaces_seen() -> list[dict]:
    """Les Workspaces que la personne voit, pour MONTRER (equipes_espaces.md § 3.1) : ceux
    de ses Teams (le menu de l'en-tête : espaces.teams_of — Cal n'y a pas les « Chez moi »
    des autres, qu'il pourrait voir mais qui ne sont pas les siens), plus le courant s'il
    n'y est pas ; le courant en tête. Chacun : son nom, sa Team, s'il est le courant, si
    l'on peut y rapatrier (et pourquoi pas). [] : pas de personne (le socle), pas de Teams."""
    u = auth.current()
    here = library.here()
    out, seen = [], set()

    def add(s: dict, t: dict) -> None:
        if s["id"] in seen or not (s.get("can") or {}).get("view"):
            return
        seen.add(s["id"])
        out.append({"id": s["id"], "name": s["name"], "team": t.get("id"), "team_name": t.get("name"),
                    "personal": bool(t.get("personal")), "archived": bool(s.get("archived")), "here": s["id"] == here,
                    "import": bool((s.get("can") or {}).get("import")), "import_why": (s.get("why") or {}).get("import"),
                    "create": bool((s.get("can") or {}).get("create")), "create_why": (s.get("why") or {}).get("create")})
    if u is not None:
        for t in espaces.teams_of(u):
            for s in t.get("spaces") or []:
                add(s, t)
        if here and here not in seen:
            cur = espaces.space_public(u, here)
            if cur:
                add(cur, {"id": cur.get("team"), "name": cur.get("team_name"), "personal": cur.get("personal")})
    out.sort(key=lambda s: not s["here"])   # le courant en tête ; les autres dans l'ordre des Teams
    return out


def _space_ids(seen: list[dict]):
    """Ce que `library.query(spaces=)` reçoit pour « tout ce qu'on voit » : la liste, ou « * »
    sans Teams (le socle, la maison sans teams.json : tout ce que `can_read_item` laisse voir)."""
    return [s["id"] for s in seen] if seen else "*"


def _here_first(items: list[dict], here: str | None, key=lambda it: it.get("space")) -> list[dict]:
    """Le Workspace courant en tête, chaque groupe dans l'ordre demandé (tri stable)."""
    return sorted(items, key=lambda it: key(it) != here) if here else items


def espaces_list(req):
    """GET /api/asset/espaces — les Workspaces que la personne voit (spaces_seen)."""
    return {"spaces": spaces_seen(), "here": library.here()}


def _with_state(items: list[dict]) -> list[dict]:
    """Un élément versionné dit l'état de sa source (« modifiée depuis la v2 »…) :
    seulement pour ceux de la page, relu chez tools/elements.py — et du Workspace courant
    (la source d'un élément d'ailleurs n'est pas lue d'ici)."""
    from tools import elements
    out = []
    for it in items:
        if it.get("kind") == "element" and isinstance((it.get("element") or {}).get("versions"), list):
            raw = library.get(it["id"])
            if raw:
                it = {**it, "source_state": elements.source_state(raw)}
        out.append(it)
    return out


def _tool(it: dict) -> str:
    """L'outil d'origine ; un objet sans origine a été déposé (`lib_upload`)."""
    return (it.get("origin") or {}).get("tool") or "upload"


def _ids(d: dict, write: bool = False, trash: bool = False, show: bool = False) -> list[dict]:
    """Les objets nommés par `ids`, tous présents et visibles dans ce Workspace
    (library.get), sinon 404 — ou 409 pour un objet qu'on voit dans un autre Workspace
    (il se rapatrie). `show` : où qu'ils soient, s'ils se voient (un zip : montrer).
    `write` : tous modifiables par la personne (un éditeur du Workspace, Cal) ; `trash` :
    tous jetables par elle (les siens, ou tout pour un admin du Workspace) — sinon 403
    avant d'en toucher un seul : un geste en lot se fait en entier ou pas du tout."""
    ids = d.get("ids")
    if not isinstance(ids, list) or not ids:
        raise HttpError(400, "ids : la liste des objets")
    out = []
    for iid in ids:
        if show:
            it = library.see(str(iid))
            if not it:
                raise HttpError(404, f"introuvable : {iid}")
        else:
            it = core_api.elsewhere_or_404(str(iid))
        if it not in out:
            out.append(it)
    if write:
        for it in out:
            library.check_write(it)
    if trash:
        for it in out:
            library.check_trash(it)
    return out


def _clean_folder(name) -> str:
    if not isinstance(name, str):
        raise HttpError(400, "un nom de dossier est un texte")
    name = " ".join(name.split())[:FOLDER_MAX]
    if "/" in name:
        raise HttpError(400, "un dossier ne se range pas dans un autre : pas de « / » dans son nom")
    return name


def _mini(it: dict) -> dict:
    return {"id": it["id"], "kind": it["kind"], "title": it.get("title", ""), "thumb_url": it.get("thumb_url"),
            "views": it.get("views"), "view_urls": it.get("view_urls"), "space": it.get("space"),
            "url": it.get("url") if it["kind"] == "video" else None,
            "etype": (it.get("element") or {}).get("type")}


# ══ asset-page (30/09) : la page de gestion — dossiers déclarés, tris, filtres, l'arbre ══
# Les dossiers déclarés : un par Workspace et par nom, dans les données (hors du dépôt).
# Une écriture complète et atomique (un fichier voisin, puis os.replace), sous un verrou.
_FOLDERS_LOCK = threading.Lock()


def _folders_file() -> Path:
    return config.data_dir() / "asset_folders.json"


def _declared_all() -> dict[str, list[str]]:
    try:
        d = json.loads(_folders_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {str(k): [str(n) for n in v if isinstance(n, str)] for k, v in d.items() if isinstance(v, list)} if isinstance(d, dict) else {}


def declared(space: str | None) -> list[str]:
    """Les dossiers déclarés d'un Workspace (None : le socle, sans Workspace)."""
    return _declared_all().get(space or "", [])


def _declare(space: str | None, name: str, *, on: bool = True, to: str | None = None) -> None:
    """Déclarer (`on`), oublier (`on=False`) ou renommer (`to`) un dossier d'un Workspace."""
    with _FOLDERS_LOCK:
        d = _declared_all()
        cur = [n for n in d.get(space or "", []) if n != name]
        if to:
            if name in d.get(space or "", []) and to not in cur:
                cur.append(to)
        elif on:
            cur.append(name)
        d[space or ""] = sorted(set(cur), key=str.lower)
        f = _folders_file()
        tmp = f.with_name(f.name + ".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, f)


# Le poids d'un objet : son fichier principal, ou (un élément) ses références et sa voix ;
# lu sur le disque, gardé par (id, date de modification).
_SIZES: dict[tuple, int] = {}


def _bytes(it: dict) -> int:
    key = (it["id"], it.get("updated") or it.get("created"))
    if key in _SIZES:
        return _SIZES[key]
    d = library.folder_of(it["id"])
    names = [it["file"]] if it.get("file") else [r.get("file") for r in ((it.get("element") or {}).get("refs") or [])
                                                  + ((it.get("element") or {}).get("voices") or [])]
    n = 0
    for name in names:
        try:
            n += (d / str(name)).stat().st_size if name else 0
        except OSError:
            pass
    _SIZES[key] = n
    return n


KIND_ORDER = {k: n for n, k in enumerate(("image", "element", "video", "audio", "sequence", "midi", "document"))}
SORTS = ("new", "old", "updated", "title", "kind", "size", "space")


def _sorted(items: list[dict], sort: str, order: list[str]) -> list[dict]:
    """Les tris que library.query ne fait pas : par sorte (puis titre), par poids (le plus
    lourd d'abord), par Workspace (dans l'ordre de l'arbre : le courant, puis les Teams ;
    dans chacun, du plus récent au plus ancien). `items` arrive trié par date (new)."""
    if sort == "kind":
        return sorted(items, key=lambda i: (KIND_ORDER.get(i["kind"], 9), (i.get("title") or "").lower()))
    if sort == "size":
        return sorted(items, key=lambda i: -_bytes(i))
    if sort == "space":
        rank = {s: n for n, s in enumerate(order)}
        return sorted(items, key=lambda i: rank.get(i.get("space"), len(rank)))
    return items


def _since(days: str) -> str | None:
    """La date limite d'un filtre « depuis N jours » (ISO, comparable à `updated`)."""
    if not days:
        return None
    try:
        n = max(1, min(3650, int(days)))
    except ValueError as e:
        raise HttpError(400, "since : un nombre de jours") from e
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat(timespec="seconds")


def _touched(it: dict) -> str:
    return it.get("updated") or it.get("created") or ""


# ── la vue de la page ───────────────────────────────────────
def view(req):
    kinds = [k for k in req.q("kind").split(",") if k in library.KINDS]
    q = req.q("q").strip()
    folder = req.q("folder")
    sort = req.q("sort", "new")
    if sort not in SORTS:
        sort = "new"
    fav = req.q("fav") == "1"
    tool = req.q("tool")
    origin = req.q("origin")
    flat = req.q("flat") == "1"       # tout, dossiers traversés (Favoris, Récents, un filtre)
    author = req.q("author")
    since = _since(req.q("since"))
    try:
        limit = max(1, min(2000, int(req.q("limit", "400") or 400)))
        offset = max(0, int(req.q("offset", "0") or 0))
    except ValueError as e:
        raise HttpError(400, "limit et offset sont des nombres") from e

    # les Workspaces : tous ceux qu'on voit, un seul (`space=`), ou ceux d'une Team (`space=a,b`) ;
    # un dossier est à un Workspace
    here = library.here()
    seen = spaces_seen()
    known = {s["id"] for s in seen}
    wants = [w for w in req.q("space").split(",") if w]
    for w in wants:
        if seen and w not in known:
            raise HttpError(404, f"Workspace {w} : inconnu, ou pas pour toi")
    want = wants[0] if len(wants) == 1 else None
    scope_spaces = wants or _space_ids(seen)
    fspace = (req.q("fspace") or here) if folder else None
    if fspace and seen and fspace not in known:
        raise HttpError(404, f"Workspace {fspace} : inconnu, ou pas pour toi")
    qsort = sort if sort in ("new", "old", "updated", "title") else "new"

    all_seen = _all("", qsort, spaces=_space_ids(seen))
    everything = [it for it in all_seen if not wants or it.get("space") in wants]
    tools: dict[str, int] = {}
    for it in everything:
        t = _tool(it)
        tools[t] = tools.get(t, 0) + 1
    # les dossiers où l'on peut ranger : ceux du Workspace courant (ranger ne touche que lui)
    all_folders = sorted({it.get("folder") for it in all_seen if it.get("folder") and (not here or it.get("space") == here)}
                         | set(declared(here)), key=str.lower)
    # et ceux de chaque Workspace qu'on voit (la page de gestion range dans le Workspace de l'objet)
    by_space: dict[str, set] = {s["id"]: set(declared(s["id"])) for s in seen}
    for it in all_seen:
        if it.get("folder"):
            by_space.setdefault(it.get("space") or "", set()).add(it["folder"])
    folders_by_space = {k: sorted(v, key=str.lower) for k, v in by_space.items()}

    every_space = [it for it in _all(q, qsort, fav, tool, spaces=_space_ids(seen)) if not since or _touched(it) >= since]
    # les auteurs : dans le périmètre de la vue, avant leur propre filtre
    who: dict[str, int] = {}
    for it in every_space:
        if not wants or it.get("space") in wants:
            o = auth.owner_of(it) or ""
            who[o] = who.get(o, 0) + 1
    authors = sorted(({"id": k, "name": auth.display_name(k) if k else "sans auteur", "count": n} for k, n in who.items()),
                     key=lambda a: -a["count"])
    if author:
        every_space = [it for it in every_space if (auth.owner_of(it) or "") == author]
    per_space: dict[str, int] = {}
    for it in every_space:
        per_space[it.get("space")] = per_space.get(it.get("space"), 0) + 1
    before_origin = every_space if not wants else [it for it in every_space if it.get("space") in wants]
    in_folder = lambda it: (it.get("folder") or "") == folder and (not fspace or it.get("space") == fspace)   # noqa: E731
    # les comptes des onglets d'origine : dans le même périmètre que la vue
    if folder:
        o_scope = [it for it in before_origin if in_folder(it)]
    else:
        o_scope = before_origin
    origins = {"upload": sum(1 for it in o_scope if _tool(it) == "upload")}
    origins["made"] = len(o_scope) - origins["upload"]
    matching = [it for it in before_origin if not origin or (_tool(it) == "upload") == (origin == "upload")]
    if folder:
        scope = [it for it in matching if in_folder(it)]
    elif q or flat:
        scope = matching                       # une recherche, Favoris, Récents : à travers les dossiers
    else:
        scope = [it for it in matching if not it.get("folder")]
    # les comptes : dans un dossier, les siens ; à la racine, toute la bibliothèque
    counted = scope if (folder or q or flat) else matching
    counts = {k: 0 for k in library.KINDS}
    for it in counted:
        counts[it["kind"]] += 1

    order = [s["id"] for s in seen]
    items = _sorted([it for it in scope if not kinds or it["kind"] in kinds], sort, order)
    if sort == "space":
        items = _here_first(items, here)

    folders = []
    if not folder and not q and not flat:
        # un dossier par Workspace et par nom : « Lycée » de A et « Lycée » de B sont deux dossiers
        groups: dict[tuple, list[dict]] = {}
        for it in matching:
            if it.get("folder"):
                groups.setdefault((it.get("space"), it["folder"]), []).append(it)
        # les dossiers déclarés, vides compris, quand aucun filtre ne trie les objets
        if not (kinds or fav or tool or origin or author or since):
            for sp in (wants or order or [here]):
                for name in declared(sp):
                    groups.setdefault((sp, name), [])
        for (sp, name), group in groups.items():
            shown = [it for it in group if not kinds or it["kind"] in kinds]
            if group and not shown:
                continue
            by_kind = {k: 0 for k in library.KINDS}
            for it in group:
                by_kind[it["kind"]] += 1
            folders.append({"name": name, "space": sp, "count": len(shown), "total": len(group), "kinds": by_kind,
                            "updated": max((_touched(it) for it in group), default=""),
                            "preview": [_mini(it) for it in shown[:4]]})
        rank = {s: n for n, s in enumerate(order)}
        if sort in ("title", "kind"):
            folders.sort(key=lambda f: f["name"].lower())
        elif sort == "old":
            folders.sort(key=lambda f: f["updated"])
        elif sort == "space":
            folders.sort(key=lambda f: (rank.get(f["space"], len(rank)), f["name"].lower()))
        elif sort == "size":
            folders.sort(key=lambda f: -f["total"])
        else:
            folders.sort(key=lambda f: f["updated"], reverse=True)

    page = [{**it, "bytes": _bytes(it)} for it in items[offset:offset + limit]]
    return {"items": _with_state(page), "total": len(items), "offset": offset,
            "counts": counts, "folders": folders, "all_folders": all_folders, "folders_by_space": folders_by_space,
            "tools": tools, "origins": origins, "authors": authors,
            "library_total": len(everything), "folder": folder, "fspace": fspace, "q": q, "sort": sort,
            "here": here, "space": want or None, "spaces_in": wants,
            "spaces": [{**s, "count": per_space.get(s["id"], 0)} for s in seen]}


def tree(req):
    """GET /api/asset/tree — l'arbre de la page : chaque Team que la personne voit, ses
    Workspaces (le courant en tête), dans chacun les objets hors dossier (`root`) et ses
    dossiers (déclarés compris) avec leurs comptes ; en tête, les favoris, les récents
    (touchés depuis 7 jours) et la corbeille de chaque Workspace (ce qu'on peut en rendre)."""
    here = library.here()
    seen = spaces_seen()
    items = _all("", "new", spaces=_space_ids(seen))
    cut = _since("7")
    per: dict[str, dict] = {}
    for it in items:
        p = per.setdefault(it.get("space") or "", {"count": 0, "root": 0, "folders": {}})
        p["count"] += 1
        if it.get("folder"):
            p["folders"][it["folder"]] = p["folders"].get(it["folder"], 0) + 1
        else:
            p["root"] += 1
    trash = _trash_counts({s["id"] for s in seen} or None)
    teams: list[dict] = []
    # sans Teams (le socle, la maison sans teams.json) : un nœud par Workspace des objets
    bare = [{"id": k, "name": k.replace("esp-", "") or "Asset", "team": None, "team_name": "", "here": k == (here or ""),
             "import": True, "create": True} for k in sorted(per, key=lambda k: k != (here or ""))] or \
           [{"id": here or "", "name": "Asset", "team": None, "team_name": "", "here": True, "import": True, "create": True}]
    for s in seen or bare:
        p = per.get(s["id"], {"count": 0, "root": 0, "folders": {}})
        names = set(p["folders"]) | set(declared(s["id"] or None))
        node = {**s, "count": p["count"], "root": p["root"], "trash": trash.get(s["id"], 0),
                "folders": [{"name": n, "count": p["folders"].get(n, 0)} for n in sorted(names, key=str.lower)]}
        t = next((t for t in teams if t["id"] == s.get("team")), None)
        if t is None:
            t = {"id": s.get("team"), "name": s.get("team_name") or "", "personal": bool(s.get("personal")), "count": 0, "spaces": []}
            teams.append(t)
        t["spaces"].append(node)
        t["count"] += node["count"]
    return {"here": here, "teams": teams, "total": len(items), "fav": sum(1 for it in items if it.get("fav")),
            "recent": sum(1 for it in items if _touched(it) >= cut), "trash": sum(trash.values())}


# ── les dossiers : créer (déclarer), oublier, supprimer ─────
def folder_create(req):
    """Un dossier neuf, vide, dans le Workspace de la requête : il faut pouvoir y créer."""
    name = _clean_folder(req.json().get("name", ""))
    if not name:
        raise HttpError(400, "il lui faut un nom")
    library.check_create(library.here())
    _declare(library.here(), name)
    return {"folder": name, "space": library.here()}


def folder_forget(req):
    """Oublier un dossier déclaré (ses objets, s'il en a, gardent leur champ `folder`) :
    le contraire de folder_create, et la fin d'un « dégrouper »."""
    name = _clean_folder(req.json().get("name", ""))
    library.check_create(library.here())
    _declare(library.here(), name, on=False)
    return {"folder": name, "space": library.here()}


def folder_delete(req):
    """Supprimer un dossier : ses objets à la corbeille — tous jetables par la personne, sinon
    rien (403) — puis le nom oublié. La corbeille garde le champ `folder` : rétablir les rend
    à leur dossier (l'annuler de la page les rétablit et redéclare le nom)."""
    name = _clean_folder(req.json().get("name", ""))
    if not name:
        raise HttpError(400, "quel dossier ?")
    members = [it for it in _all() if (it.get("folder") or "") == name]
    if not members and name not in declared(library.here()):
        raise HttpError(404, f"aucun dossier « {name} »")
    library.check_create(library.here())
    for it in members:                   # tout jetable (le rôle, une version en usage), avant d'en jeter un seul
        library.check_trash(it)
        for guard in library.TRASH_GUARDS:
            guard(it)
    gone = []
    for it in members:
        library.trash(it["id"])
        gone.append(it["id"])
    was = name in declared(library.here())
    _declare(library.here(), name, on=False)
    return {"folder": name, "trashed": gone, "declared": was}


def _trash_space(meta: dict) -> str:
    return library.space_of(meta) or ""


def _trash_counts(spaces: set | None) -> dict[str, int]:
    """Ce que la personne peut rendre, dans la corbeille de chaque Workspace qu'elle voit."""
    u = auth.current()
    out: dict[str, int] = {}
    for d in library.trash_root().iterdir():
        if not d.is_dir():
            continue
        try:
            meta = library.trashed_meta(d.name)
        except KeyError:
            continue
        sp = _trash_space(meta)
        if (spaces is None or sp in spaces) and auth.can_read_item(meta, u) and auth.can_trash_item(meta, u):
            out[sp] = out.get(sp, 0) + 1
    return out


def trash_empty(req):
    """POST /api/asset/trash/empty {ids?} — effacer pour de bon ce que la corbeille du
    Workspace de la requête tient et que la personne peut jeter (`ids` : ceux-là
    seulement). Le seul geste qui efface ; le journal le garde. Un fichier principal
    rapatrié ailleurs (un lien dur) vit tant que la copie le porte (§ 3.2)."""
    ids = req.json().get("ids")
    root = library.trash_root()
    todo = []
    for d in root.iterdir():
        if d.is_dir() and _mine_in_trash(d) and (not isinstance(ids, list) or d.name in {str(i) for i in ids}):
            todo.append(d)
    for d in todo:
        shutil.rmtree(d, ignore_errors=True)
    u = auth.current()
    auth.journal("corbeille vidée (Asset)", by=(u or {}).get("id"), space=library.here(), items=len(todo))
    return {"removed": [d.name for d in todo]}
# ══ fin asset-page ══


# ── ranger ──────────────────────────────────────────────────
def move(req):
    d = req.json()
    folder = _clean_folder(d.get("folder", ""))
    moved = [{"id": it["id"], "from": it.get("folder") or ""} for it in _ids(d, write=True)]
    for m in moved:
        library.update(m["id"], {"folder": folder})
    return {"moved": moved, "folder": folder}


def rename_folder(req):
    d = req.json()
    old = _clean_folder(d.get("from", ""))
    new = _clean_folder(d.get("to", ""))
    if not old:
        raise HttpError(400, "quel dossier ?")
    if not new:
        raise HttpError(400, "il lui faut un nom")
    everyone = [it for it in _all() if (it.get("folder") or "") == old]
    decl = old in declared(library.here())   # asset-page : un dossier déclaré, vide ou non, se renomme aussi
    if not everyone and not decl:
        raise HttpError(404, f"aucun dossier « {old} »")
    # un dossier n'est que le champ `folder` de ses objets : chacun renomme les siens
    # (Cal, tous) ; ceux des autres gardent leur dossier (`kept`)
    u = auth.current()
    members = [it for it in everyone if auth.can_write_item(it, u)]
    if everyone and not members:
        library.check_write(everyone[0])   # 403, qui dit à qui ils sont
    if not everyone:
        library.check_create(library.here())
    merged = new != old and (any((it.get("folder") or "") == new for it in _all()) or new in declared(library.here()))
    for it in members:
        library.update(it["id"], {"folder": new})
    if decl:
        _declare(library.here(), old, to=new)
    return {"renamed": len(members), "kept": len(everyone) - len(members), "folder": new, "merged": merged}


# ── plusieurs à la fois : favori, tags, corbeille ───────────
# la forme d'un identifiant de la bibliothèque : une seule vérité, library.new_id /
# library.ID_RE — toutes les sortes (mid-, seq- compris ; avant le 29/09, la
# restauration en lot ne rendait que ima|vid|aud|ele et taisait les autres)
ID_RX = library.ID_RE


def bulk(req):
    """Favori et tags sur une sélection. Rend l'état d'avant de chacun, que
    `{restore: before}` remet (l'« annuler » de la page)."""
    d = req.json()
    if isinstance(d.get("restore"), list):
        back = [(it, b) for b in d["restore"] if isinstance(b, dict)
                for it in [library.get(str(b.get("id", "")))] if it]
        for it, _ in back:
            library.check_write(it)
        for it, b in back:
            library.update(it["id"], {"fav": bool(b.get("fav")), "tags": [str(t)[:40] for t in b.get("tags") or []][:64]})
        return {"restored": len(back)}
    items = _ids(d, write=True)
    add = [str(t).strip()[:40] for t in d.get("tags_add") or [] if str(t).strip()]
    rem = {str(t) for t in d.get("tags_remove") or []}
    before = []
    for it in items:
        before.append({"id": it["id"], "fav": bool(it.get("fav")), "tags": list(it.get("tags") or [])})
        patch = {}
        if "fav" in d:
            patch["fav"] = bool(d["fav"])
        if add or rem:
            tags = [t for t in it.get("tags") or [] if t not in rem]
            patch["tags"] = tags + [t for t in add if t not in tags]
        if patch:
            library.update(it["id"], patch)
    return {"before": before, "count": len(items)}


def trash_many(req):
    items = _ids(req.json(), trash=True)
    for it in items:
        library.trash(it["id"])
    return {"trashed": [it["id"] for it in items]}


def restore_many(req):
    ids = req.json().get("ids")
    if not isinstance(ids, list):
        raise HttpError(400, "ids : la liste des objets")
    # un id se tient à sa forme : rien ne sort de la corbeille par « .. » ; un id
    # qui n'y est pas est passé sous silence (il en est déjà revenu)
    # (la corbeille est par Workspace : celle d'un autre n'existe pas ici, passée sous silence)
    todo = [str(i) for i in ids if ID_RX.fullmatch(str(i)) and (library.trash_root() / str(i)).is_dir()
            and library.readable(library.trashed_meta(str(i)))]
    for iid in todo:                     # tout jetable par soi, avant d'en rendre un seul
        library.check_trash(library.trashed_meta(iid))
    back = []
    for iid in todo:
        try:
            back.append(library.restore(iid)["id"])
        except (KeyError, ValueError):
            pass
    return {"restored": back}


# ── télécharger : un zip de la sélection ────────────────────
ZIP_KEEP_S = 2 * 3600
_UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')
ROLE_FR = {"face": "visage", "full body": "plein pied", "expression": "expression", "outfit": "tenue",
           "view": "vue", "detail": "détail", "style": "style"}


def _safe(name, fallback: str) -> str:
    n = _UNSAFE.sub("_", str(name or "")).strip(" ._")[:80]
    return n or fallback


def _zip_dir() -> Path:
    d = config.data_dir() / "zips"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _zip_clean() -> None:
    now = time.time()
    for p in _zip_dir().iterdir():
        try:
            if now - p.stat().st_mtime > ZIP_KEEP_S:
                shutil.rmtree(p) if p.is_dir() else p.unlink()
        except OSError:
            pass


def zip_make(req):
    """Un zip de la sélection, fait ici, sur la machine qui a les fichiers.

    Une image, une vidéo, un son : son fichier, au nom de son titre. Un
    élément : un dossier à son nom avec ses références dans l'ordre
    (« 01 visage · neutre.png »), ses GLB s'il en a, et sa description.
    Les fichiers ne sont pas recompressés (`ZIP_STORED`) : PNG, JPEG, MP4
    le sont déjà. Le zip est écrit dans `<data>/zips/<jeton>/`, servi en flux
    par `zip_get` (les requêtes partielles marchent), effacé après deux
    heures.

    Plus tard, bibliothèque publiée sur R2 (docs/etudes/asset.md) : R2 n'a
    pas d'opération d'archive (API S3 : GetObject, pas de zip). Le zip reste
    fait par la DGX qui a les fichiers, le Worker ne fait que le relayer ;
    ou, DGX éteintes, par le navigateur en flux depuis R2.
    """
    items = _ids(req.json(), show=True)   # exporter un fichier déjà fait : tout profil qui voit (§ 2.4)
    _zip_clean()
    token = secrets.token_hex(8)
    d = _zip_dir() / token
    d.mkdir()
    base = _safe(items[0].get("title"), items[0]["id"]) if len(items) == 1 else f"asset · {len(items)} objets"
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", unicodedata.normalize("NFKD", base).encode("ascii", "ignore").decode()).strip("-")[:60]
    path = d / f"{slug or 'asset'}.zip"
    used: set[str] = set()

    def arc(name: str) -> str:
        stem, ext = os.path.splitext(name)
        n, k = name, 2
        while n.lower() in used:
            n, k = f"{stem} ({k}){ext}", k + 1
        used.add(n.lower())
        return n

    files = 0
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED, allowZip64=True) as z:
        for it in items:
            title = _safe(it.get("title"), it["id"])
            if library.is_living(it):   # un élément versionné : sa dernière version, sous son titre à lui
                it = library.resolve(it) or {"id": it["id"], "kind": "none"}
            src = library.folder_of(it["id"])
            if it["kind"] == "element":
                top = arc(title)
                el = it["element"]
                for k, r in enumerate(el.get("refs") or []):
                    p = src / r["file"]
                    if p.is_file():
                        label = _safe(" · ".join(x for x in (ROLE_FR.get(r.get("role"), r.get("role") or ""), r.get("label") or "") if x), "")
                        z.write(p, f"{top}/{k + 1:02d}{' ' + label if label else ''}{p.suffix.lower()}")
                        files += 1
                for v in el.get("voices") or []:
                    p = src / v["file"]
                    if p.is_file():
                        z.write(p, f"{top}/voix{' · ' + _safe(v.get('label'), '') if v.get('label') and v.get('label') != 'voix' else ''}{p.suffix.lower()}")
                        files += 1
                for m in el.get("meshes") or []:
                    p = src / m["file"]
                    if p.is_file():
                        z.write(p, f"{top}/{'factice ' if m.get('factice') else ''}{m['file']}")
                        files += 1
                if (el.get("description") or "").strip():
                    z.writestr(f"{top}/description.txt", el["description"].strip() + "\n")
            elif it.get("file"):
                p = src / it["file"]
                if p.is_file():
                    z.write(p, arc(title + p.suffix.lower()))
                    files += 1
    return {"url": f"api/asset/zip/{token}/{path.name}", "name": f"{base}.zip", "size": path.stat().st_size,
            "files": files, "count": len(items)}


def zip_get(req, token, name):
    if not re.fullmatch(r"[0-9a-f]{16}", token) or not re.fullmatch(r"[A-Za-z0-9._-]{1,80}\.zip", name):
        raise HttpError(404, "introuvable")
    p = _zip_dir() / token / name
    if not p.is_file():
        raise HttpError(404, "ce zip n'existe plus (gardé deux heures) : refais-le")
    return FileResponse(p, "application/zip")


# ── la lignée ───────────────────────────────────────────────
def _parent_ids(it: dict) -> list[str]:
    """Les parents déclarés, plus l'image d'origine de chaque référence d'un
    élément : `library.add_ref` ne les ajoute pas à `parents`."""
    ids = list(it.get("parents") or [])
    el = it.get("element") or {}
    for r in (el.get("refs") or []) + (el.get("voices") or []):
        if r.get("item") and r["item"] not in ids:
            ids.append(r["item"])
    return ids


def lineage(req, item_id):
    """Montrer : la lignée d'un objet où qu'il soit, parents et enfants de tous les
    Workspaces qu'on voit (chacun dit le sien, `space`) ; un parent resté dans A d'une
    copie rapatriée dans B se montre, marqué — invisible, il est tu (`hidden`)."""
    it = library.see(item_id)
    if not it:
        raise HttpError(404, f"introuvable : {item_id}")
    ids = _parent_ids(it)
    parents = [library.public(p) for p in (library.see(x) for x in ids) if p]
    every = _all(versions=True, spaces=_space_ids(spaces_seen()))
    children = [c for c in every if item_id in _parent_ids(c)]
    # une copie rapatriée : l'original d'où elle vient (origin.from), s'il se voit encore ; un
    # original : ses copies rapatriées ailleurs (celles qu'on voit)
    frm = (it.get("origin") or {}).get("from") or {}
    source = library.see(str(frm.get("item") or "")) if frm.get("item") else None
    copies = [c for c in every if ((c.get("origin") or {}).get("from") or {}).get("item") == item_id]
    return {"parents": parents, "children": children, "hidden": len(ids) - len(parents),
            "source": library.public(source) if source else None, "source_gone": bool(frm.get("item")) and source is None,
            "copies": copies}


# ── la corbeille ────────────────────────────────────────────
def _trashed(folder: Path) -> dict | None:
    try:
        it = json.loads((folder / "item.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    # le renommage vers la corbeille met à jour le ctime du dossier (Linux) : l'heure du geste
    when = datetime.fromtimestamp(folder.stat().st_ctime, timezone.utc).isoformat(timespec="seconds")
    return {"id": it.get("id", folder.name), "kind": it.get("kind"), "title": it.get("title", ""),
            "created": it.get("created"), "trashed": when, "folder": it.get("folder", ""), "space": library.space_of(it),
            "owner": auth.owner_of(it),
            "etype": (it.get("element") or {}).get("type"), "duration": it.get("duration"),
            "thumb_url": f"api/asset/trash/{folder.name}/thumb" if it.get("thumb") else None}


def _mine_in_trash(folder: Path) -> bool:
    """La corbeille du Workspace courant (une par Workspace, equipes_espaces.md § 3.4 :
    l'`item.json` jeté dit le sien), et dans elle ce que la personne peut rendre (le
    sien ; un admin du Workspace, Cal : tout)."""
    try:
        meta = library.trashed_meta(folder.name)
    except KeyError:
        return False
    return library.readable(meta) and auth.can_trash_item(meta, auth.current())


def _seen_in_trash(folder: Path, spaces: set | None = None) -> bool:
    """asset-page : la corbeille de CHAQUE Workspace qu'on voit (`spaces`, None : tous) —
    montrer ; rendre et vider passent toujours par le Workspace de la requête."""
    try:
        meta = library.trashed_meta(folder.name)
    except KeyError:
        return False
    u = auth.current()
    return (spaces is None or _trash_space(meta) in spaces) and auth.can_read_item(meta, u) and auth.can_trash_item(meta, u)


def trash_list(req):
    if req.q("spaces") == "*":
        seen = {s["id"] for s in spaces_seen()} or None
        keep = lambda d: _seen_in_trash(d, seen)   # noqa: E731
    else:
        keep = _mine_in_trash
    out = [t for t in (_trashed(d) for d in library.trash_root().iterdir() if d.is_dir() and keep(d)) if t]
    out.sort(key=lambda t: t["trashed"], reverse=True)
    return {"items": out}


def trash_thumb(req, item_id):
    root = library.trash_root().resolve()
    d = (root / item_id).resolve()
    if not d.is_relative_to(root) or not (d / "item.json").is_file() or not _seen_in_trash(d):
        raise HttpError(404, "pas dans la corbeille")
    try:
        name = json.loads((d / "item.json").read_text(encoding="utf-8")).get("thumb") or ""
    except ValueError as e:
        raise HttpError(404, "illisible") from e
    f = (d / name).resolve()
    if not name or not f.is_relative_to(d) or not f.is_file():
        raise HttpError(404, "pas de vignette")
    return FileResponse(f)


# ── la planche d'un élément ─────────────────────────────────
REF_FILE = re.compile(r"ref-\d{2,3}\.(png|jpe?g|webp)")
VOICE_FILE = re.compile(r"voice-\d{2,3}\.(wav|mp3|flac|m4a|ogg)")


def _set_voices(it: dict, d: Path, voices: list) -> list:
    """La voix d'un élément (`element.voices`, library._add_voice), dans
    l'ordre donné ; un fichier retiré reste dans le dossier, pour « annuler »."""
    old = {v["file"]: v for v in it["element"].get("voices") or []}
    out, seen = [], set()
    for v in voices:
        f = str((v or {}).get("file", ""))
        if not VOICE_FILE.fullmatch(f) or not (d / f).is_file() or f in seen:
            raise HttpError(400, f"voix inconnue dans cet élément : {f or '?'}")
        seen.add(f)
        prev = old.get(f) or {}
        entry = {**prev, "file": f, "role": "voice", "label": str(v.get("label", prev.get("label", "voix")))[:80]}
        if not prev:
            if isinstance(v.get("item"), str) and library.get(v["item"]):
                entry["item"] = v["item"]
            entry.update(library.probe(d / f))
        out.append(entry)
    return out


def set_refs(req, item_id):
    """Pose la liste des références d'un élément, dans l'ordre donné :
    réordonner, changer un rôle, retirer, et remettre une référence qu'on
    vient de retirer (son fichier reste dans le dossier de l'élément ;
    `POST /api/library/<id>` ne sait pas la faire revenir). `voices`, s'il
    est donné, pose de même la voix de l'élément."""
    it = core_api.elsewhere_or_404(item_id)   # d'un autre Workspace : 409, il se rapatrie
    if it["kind"] != "element":
        raise HttpError(404, f"élément introuvable : {item_id}")
    library.check_write(it)   # la planche d'un autre ne se touche pas (avant le 29/09 : aucun contrôle)
    library._frozen(it, "sa planche")   # la planche publiée d'un élément ne change plus (30/09)
    body = req.json()
    refs, voices = body.get("refs"), body.get("voices")
    if refs is None and voices is None:
        raise HttpError(400, "refs ou voices : la liste des références")
    if (refs is not None and not isinstance(refs, list)) or (voices is not None and not isinstance(voices, list)):
        raise HttpError(400, "refs et voices sont des listes")
    d = library.folder_of(item_id)
    vout = _set_voices(it, d, voices) if voices is not None else None
    old = {r["file"]: r for r in it["element"]["refs"]}
    out, seen = [], set()
    for r in refs if refs is not None else it["element"]["refs"]:
        f = str((r or {}).get("file", ""))
        if not REF_FILE.fullmatch(f) or not (d / f).is_file():
            raise HttpError(400, f"référence inconnue dans cet élément : {f or '?'}")
        if f in seen:
            raise HttpError(400, f"référence en double : {f}")
        seen.add(f)
        prev = old.get(f) or {}
        entry = {**prev, "file": f, "role": str(r.get("role", prev.get("role", "")))[:40],
                 "label": str(r.get("label", prev.get("label", "")))[:80]}
        thumb = Path(f).stem + ".thumb.jpg"
        if (d / thumb).is_file():
            entry["thumb"] = thumb
        if not prev:
            if isinstance(r.get("item"), str) and library.get(r["item"]):
                entry["item"] = r["item"]
            entry.update(library.probe(d / f))
        out.append(entry)
    with library._lock:
        it["element"]["refs"] = out
        if out and out[0].get("thumb"):
            it["thumb"] = out[0]["thumb"]
        elif not out:
            it.pop("thumb", None)
        if vout is not None:
            if vout:
                it["element"]["voices"] = vout
            else:
                it["element"].pop("voices", None)
        it["updated"] = library.now()
        library._save(it)
    return library.public(it)


# ── Character Factory : remettre à jour un personnage importé ─
def cf_refresh(req):
    """Relit le personnage dans le studio et remplace les références de
    l'élément sur place : son id ne change pas, donc tout ce qui l'appelle
    déjà (un plan de Movie Creator, une image) suit. Titre, dossier,
    favori et tags restent ceux de Cal. Rien n'est touché si le studio ne
    rend aucune image."""
    iid = req.json().get("id", "")
    it = library.get(iid)
    if not it or it["kind"] != "element":
        raise HttpError(404, f"élément introuvable : {iid}")
    library.check_write(it)   # avant d'effacer quoi que ce soit (avant le 29/09 : le refus venait après l'effacement)
    # éléments (30/09, question 1 de l'étude : oui) : un personnage déjà versionné — l'élément, ou
    # l'une de ses planches publiées — reçoit une version de plus ; rien n'est réécrit sur place
    ver = it.get("version") if isinstance(it.get("version"), dict) else None
    living = it if library.is_living(it) else (library.get(ver["of"]) if ver else None)
    if living is not None:
        return _cf_new_version(living)
    src = it["element"].get("source") or {}
    slug = src.get("slug", "")
    if src.get("tool") != "character-factory" or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", slug):
        raise HttpError(400, "cet élément ne vient pas de Character Factory")
    c, got, tmp = _cf_fetch(slug)
    if not any(r["role"] != "voice" for r in got):
        shutil.rmtree(tmp, ignore_errors=True)
        raise HttpError(409, "le studio ne rend aucune image validée pour ce personnage : l'élément reste tel quel")
    d = library.folder_of(iid)
    with library._lock:
        for r in it["element"]["refs"] + (it["element"].get("voices") or []):
            for name in (r.get("file"), r.get("thumb")):
                if name:
                    (d / name).unlink(missing_ok=True)
        it["element"]["refs"] = []
        it["element"].pop("voices", None)
        it.pop("thumb", None)
        for r in got:
            library.add_ref(iid, r["path"], r["role"], r["label"])
        desc = core_api._cf_description(c)
        if desc:
            it["element"]["description"] = desc
        it["element"]["source"] = {**src, "refreshed": library.now()}
        it["updated"] = library.now()
        library._save(it)
    shutil.rmtree(tmp, ignore_errors=True)
    return library.public(it)


def _cf_new_version(e: dict):
    """Le personnage relu dans le studio devient une planche neuve, rangée comme
    version n+1 de son élément : les plans et les planches qui posaient la
    précédente la gardent et voient la pastille."""
    from tools import elements
    library.check_write(e)
    src = e["element"].get("source") or {}
    head = library.resolve(e) or {}
    slug = src.get("slug") or ((head.get("element") or {}).get("source") or {}).get("slug", "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", slug or ""):
        raise HttpError(400, "cet élément ne vient pas de Character Factory")
    c, got, tmp = _cf_fetch(slug)
    try:
        if not any(r["role"] != "voice" for r in got):
            raise HttpError(409, "le studio ne rend aucune image validée pour ce personnage : rien n'est publié")
        planche = library.create_element(c.get("name") or e["title"], "character", core_api._cf_description(c), got,
                                         source={"tool": "character-factory", "slug": slug, "open": core_api._cf_open(slug)},
                                         folder=e.get("folder") or "")
        elements.publish(e["id"], planche["id"], note="relu dans le studio Character Factory")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return library.public(library.get(e["id"]))


def _cf_fetch(slug: str):
    """(la fiche du personnage, ses images et sa voix rapatriées, le dossier de travail)."""
    c = json.loads(core_api._cf_get(f"/api/characters/{slug}")).get("character") or {}
    tmp = config.data_dir() / "cf_import" / f"refresh-{slug}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True, exist_ok=True)
    got: list[dict] = []

    def fetch(rel, role: str, label: str = "") -> None:
        # même lecture que core_api.cf_import : un chemin relatif au dossier du personnage
        if not rel or not isinstance(rel, str) or ".." in rel:
            return
        ext = Path(rel).suffix.lower() or ".png"
        if ext not in (".png", ".jpg", ".jpeg", ".webp") and not (role == "voice" and ext in library.AUDIO_EXT):
            return
        dest = tmp / f"{len(got):02d}{ext}"
        try:
            dest.write_bytes(core_api._cf_get(urllib.parse.quote(f"/files/{slug}/{rel}"), timeout=60))
        except HttpError:
            return
        got.append({"path": dest, "role": role, "label": label})

    core_api._walk_cf(c, fetch)            # les images, puis la voix s'il en a une
    return c, got, tmp


# ── accroche du panneau Asset commun (commun/dock.js, docs/etudes/panneau_asset.md § 2.3, § 4.1) ──
# Deux filtres que `library.query` (server/core, un autre chantier) ne sait pas encore :
#   etype=character,object   les éléments de ces types seulement (les autres sortes ne bougent pas) ;
#   media=audio,image…       compte aussi l'élément versionné dont la DERNIÈRE version est de ces
#                            sortes (`element.head_kind`, library.public) : une chanson d'ODIO est un
#                            son pour le panneau, même si `element` n'est pas dans `kind`.
# La sorte effective d'un objet : `sorte_effective` ici, sa jumelle `sorteEffective` dans
# commun/shell.js. Le tout passe par `_all` (tous les objets visibles, comme la vue d'Asset), puis
# se découpe en pages : à descendre dans `library.query` quand son propriétaire le voudra.
DOCK_MEDIA = ("image", "video", "audio", "midi", "sequence")


def sorte_effective(it: dict) -> str:
    """La sorte d'un objet pour les filtres : `kind`, sauf l'élément versionné, qui vaut sa dernière version."""
    if it.get("kind") == "element":
        return (it.get("element") or {}).get("head_kind") or "element"
    return it.get("kind") or ""


def dock_match(it: dict, kinds: list[str], etypes: list[str], media: list[str]) -> bool:
    k = it.get("kind")
    if k == "element":
        if kinds and "element" in kinds and (not etypes or (it.get("element") or {}).get("type") in etypes):
            return True
        head = (it.get("element") or {}).get("head_kind")
        return bool(media and head in media and head != "element")
    return not kinds or k in kinds


def dock_list(req):
    """GET /api/asset/dock?kind=&etype=&media=&q=&folder=&fav=1&sort=&limit=&offset=
    → {items, total, counts, etypes, folders} ; `counts` et `etypes` comptent dans la recherche
    (et le dossier, les favoris), toutes sortes confondues : les pastilles du panneau."""
    csv = lambda name, allowed=None: [x for x in req.q(name).split(",") if x and (allowed is None or x in allowed)]
    kinds = csv("kind", library.KINDS)
    etypes = csv("etype")
    media = csv("media", DOCK_MEDIA)
    folder = req.query.get("folder", [None])[0]
    try:
        limit = max(1, min(600, int(req.q("limit", "120") or 120)))
        offset = max(0, int(req.q("offset", "0") or 0))
    except ValueError as e:
        raise HttpError(400, "limit et offset sont des nombres") from e
    # le Workspace courant par défaut (ce que l'outil pose, il le lit : library.get) ; « Autres
    # workspaces » : `space=` un autre qu'on voit, `spaces=*` tous — chaque objet dit le sien
    # (`space`), et le poser dans l'outil passe par POST /api/espaces/<courant>/rapatrier
    want, every = req.q("space"), req.q("spaces") == "*"
    spaces = None
    if want or every:
        seen = spaces_seen()
        if want and seen and want not in {s["id"] for s in seen}:
            raise HttpError(404, f"Workspace {want} : inconnu, ou pas pour toi")
        spaces = [want] if want else _space_ids(seen)
    base = _all(req.q("q").strip(), req.q("sort", "new"), req.q("fav") == "1", spaces=spaces)
    scope = base if folder is None else [it for it in base if (it.get("folder") or "") == folder]
    counts = {k: 0 for k in library.KINDS}
    by_etype: dict[str, int] = {}
    for it in scope:
        counts[it["kind"]] = counts.get(it["kind"], 0) + 1
        s = sorte_effective(it)
        if it["kind"] == "element":
            t = (it.get("element") or {}).get("type") or "other"
            by_etype[t] = by_etype.get(t, 0) + 1
            if s in DOCK_MEDIA:
                counts[s] = counts.get(s, 0) + 1   # la pastille « sons » compte la chanson versionnée
    items = [it for it in scope if dock_match(it, kinds, etypes, media)]
    folders = sorted({it.get("folder") for it in base if it.get("folder")}, key=str.lower)
    return {"items": items[offset:offset + limit], "total": len(items), "counts": counts,
            "etypes": by_etype, "folders": folders}


def register(app) -> None:
    app.route("GET", "/api/asset/dock", dock_list)   # le panneau Asset commun (ci-dessus)
    app.route("GET", "/api/asset/espaces", espaces_list)
    app.route("GET", "/api/asset/view", view)
    app.route("GET", "/api/asset/tree", tree)                       # asset-page
    app.route("POST", "/api/asset/folders", folder_create)          # asset-page
    app.route("POST", "/api/asset/folders/forget", folder_forget)   # asset-page
    app.route("POST", "/api/asset/folders/delete", folder_delete)   # asset-page
    app.route("POST", "/api/asset/trash/empty", trash_empty)        # asset-page
    app.route("POST", "/api/asset/move", move)
    app.route("POST", "/api/asset/folders/rename", rename_folder)
    app.route("GET", "/api/asset/lineage/{item_id}", lineage)
    app.route("GET", "/api/asset/trash", trash_list)
    app.route("GET", "/api/asset/trash/{item_id}/thumb", trash_thumb)
    app.route("POST", "/api/asset/cf/refresh", cf_refresh)
    app.route("POST", "/api/asset/refs/{item_id}", set_refs)
    app.route("POST", "/api/asset/bulk", bulk)
    app.route("POST", "/api/asset/trash", trash_many)
    app.route("POST", "/api/asset/restore", restore_many)
    app.route("POST", "/api/asset/zip", zip_make)
    app.route("GET", "/api/asset/zip/{token}/{name}", zip_get)


# ── le contrôle, sans GPU ───────────────────────────────────
def selftest(call, ok) -> None:
    import io
    from PIL import Image

    def png(color) -> bytes:
        buf = io.BytesIO()
        Image.new("RGB", (40, 30), color).save(buf, "PNG")
        return buf.getvalue()

    st, a = call("PUT", "/api/library/upload?name=a.png&title=Asset%20A", raw=png((200, 10, 10)))
    st2, b = call("PUT", "/api/library/upload?name=b.png&title=Asset%20B", raw=png((10, 200, 10)))
    ok(st == 200 and st2 == 200, "asset : deux images déposées")
    st, m = call("POST", "/api/asset/move", {"ids": [a["id"], b["id"]], "folder": "  Essai   asset "})
    ok(st == 200 and m["folder"] == "Essai asset" and len(m["moved"]) == 2, f"asset : ranger deux objets ({st} {m})")
    st, v = call("GET", "/api/asset/view?sort=new")
    f = [x for x in v.get("folders", []) if x["name"] == "Essai asset"]
    ok(st == 200 and f and f[0]["count"] == 2 and len(f[0]["preview"]) == 2, "asset : le dossier à la racine, ses vignettes en petit")
    ok(all(it["id"] not in (a["id"], b["id"]) for it in v["items"]), "asset : un objet rangé quitte la racine")
    st, v = call("GET", "/api/asset/view?folder=Essai%20asset&kind=image")
    ok(st == 200 and v["total"] == 2 and v["counts"]["image"] == 2, "asset : ouvrir un dossier")
    st, v = call("GET", "/api/asset/view?q=Asset%20A")
    ok(st == 200 and any(it["id"] == a["id"] for it in v["items"]), "asset : la recherche traverse les dossiers")
    st, bad = call("POST", "/api/asset/move", {"ids": [a["id"]], "folder": "a/b"})
    ok(st == 400, "asset : pas de dossier dans un dossier")
    st, r = call("POST", "/api/asset/folders/rename", {"from": "Essai asset", "to": "Renommé"})
    ok(st == 200 and r["renamed"] == 2, f"asset : renommer un dossier ({st} {r})")
    st, got = call("GET", f"/api/library/{a['id']}")
    ok(got.get("folder") == "Renommé", "asset : ses objets suivent")
    st, c = call("POST", "/api/elements", {"title": "Él", "type": "object", "refs": [{"item": a["id"], "role": "view"}]})
    st, lin = call("GET", f"/api/asset/lineage/{a['id']}")
    ok(st == 200 and any(x["id"] == c["id"] for x in lin["children"]), "asset : la lignée, un enfant")
    st, lin = call("GET", f"/api/asset/lineage/{c['id']}")
    ok(st == 200 and any(x["id"] == a["id"] for x in lin["parents"]), "asset : la lignée, un parent")
    call("POST", f"/api/library/{b['id']}/delete")
    st, t = call("GET", "/api/asset/trash")
    ok(st == 200 and any(x["id"] == b["id"] and x["thumb_url"] for x in t["items"]), "asset : la corbeille se liste")
    st, raw = call("GET", f"/api/asset/trash/{b['id']}/thumb")
    ok(st == 200 and isinstance(raw, bytes) and raw[:2] == b"\xff\xd8", "asset : la vignette d'un objet jeté")
    st, _ = call("GET", "/api/asset/trash/..%2F..%2Fjobs.json/thumb")
    ok(st in (400, 404), "asset : la corbeille ne sort pas de son dossier")   # 400 : la garde du routeur
    st, back = call("POST", f"/api/library/{b['id']}/restore")
    ok(st == 200 and back["id"] == b["id"], "asset : retour de la corbeille")
    st, _ = call("POST", "/api/asset/cf/refresh", {"id": c["id"]})
    ok(st == 400, "asset : remettre à jour refuse un élément qui ne vient pas de Character Factory")
    st, c2 = call("POST", f"/api/elements/{c['id']}/refs", {"item": b["id"], "role": "detail"})
    refs = c2["element"]["refs"]
    ok(st == 200 and len(refs) == 2, "asset : une deuxième référence")
    st, c3 = call("POST", f"/api/asset/refs/{c['id']}", {"refs": [{"file": refs[1]["file"], "role": "style"}]})
    ok(st == 200 and [r["file"] for r in c3["element"]["refs"]] == [refs[1]["file"]]
       and c3["element"]["refs"][0]["role"] == "style", f"asset : retirer une référence, changer un rôle ({st})")
    st, c4 = call("POST", f"/api/asset/refs/{c['id']}", {"refs": [{"file": r["file"], "role": r["role"], "label": r["label"],
                                                                    "item": r.get("item")} for r in reversed(refs)]})
    ok(st == 200 and [r["file"] for r in c4["element"]["refs"]] == [refs[1]["file"], refs[0]["file"]]
       and c4["element"]["refs"][1].get("item") == a["id"], "asset : la référence retirée revient, l'ordre est gardé")
    st, _ = call("POST", f"/api/asset/refs/{c['id']}", {"refs": [{"file": "../item.json"}]})
    ok(st == 400, "asset : une référence hors de l'élément est refusée")

    # la catégorie Upload : ce qu'on dépose, à part de ce que les outils font
    st, u = call("PUT", "/api/library/upload?name=u.png&title=Depot&tool=upload&via=asset", raw=png((9, 9, 200)))
    ok(st == 200 and u["origin"].get("via") == "asset", "asset : un dépôt dit par où il est entré (via)")
    st, v = call("GET", "/api/asset/view?origin=upload&q=Depot")
    ok(st == 200 and [i["id"] for i in v["items"]] == [u["id"]] and v["origins"]["upload"] >= 1, "asset : l'onglet Uploads")
    st, v = call("GET", "/api/asset/view?origin=made&q=%C3%89l")
    ok(st == 200 and any(i["id"] == c["id"] for i in v["items"]) and all(i["origin"]["tool"] != "upload" for i in v["items"]),
       "asset : l'onglet des créations")

    # plusieurs à la fois
    st, bk = call("POST", "/api/asset/bulk", {"ids": [a["id"], u["id"]], "fav": True, "tags_add": ["lot"]})
    st, g = call("GET", f"/api/library/{u['id']}")
    ok(st == 200 and g["fav"] and g["tags"] == ["lot"] and len(bk["before"]) == 2, "asset : favori et tag en lot")
    st, _ = call("POST", "/api/asset/bulk", {"restore": bk["before"]})
    st, g = call("GET", f"/api/library/{u['id']}")
    ok(not g["fav"] and g["tags"] == [], "asset : annuler un lot")
    st, t = call("POST", "/api/asset/trash", {"ids": [u["id"], b["id"]]})
    st2, gone = call("GET", f"/api/library/{u['id']}")
    ok(st == 200 and len(t["trashed"]) == 2 and st2 == 404, "asset : corbeille en lot")
    st, r = call("POST", "/api/asset/restore", {"ids": [u["id"], b["id"], "../library"]})
    ok(st == 200 and sorted(r["restored"]) == sorted([u["id"], b["id"]]), "asset : retour en lot, un id mal formé ignoré")

    # le zip : une image à son titre, un élément en dossier avec ses références
    import zipfile as _z
    st, zp = call("POST", "/api/asset/zip", {"ids": [a["id"], c["id"]]})
    ok(st == 200 and zp["files"] == 3 and zp["url"].startswith("api/asset/zip/"), f"asset : un zip de la sélection ({st} {zp})")
    st, raw = call("GET", "/" + zp["url"])
    names = sorted(_z.ZipFile(io.BytesIO(raw)).namelist()) if st == 200 else []
    ok(names == ["Asset A.png", "Él/01 détail.png", "Él/02 vue.png"], f"asset : ce que le zip contient ({names})")
    st, _ = call("GET", "/api/asset/zip/0123456789abcdef/../jobs.json")
    ok(st == 404, "asset : le zip ne sert que ses fichiers")

    # la voix d'un élément : un son, à côté des images, jamais parmi elles
    import subprocess
    wav = config.data_dir() / "voix_selftest.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=1.5", str(wav)],
                   capture_output=True, timeout=60)
    st, snd = call("PUT", "/api/library/upload?name=voix.wav&title=Voix&tool=upload&via=asset", raw=wav.read_bytes())
    ok(st == 200 and snd["kind"] == "audio", "asset : un son déposé")
    st, e2 = call("POST", f"/api/elements/{c['id']}/refs", {"item": snd["id"], "role": "voice"})
    vs = (e2.get("element") or {}).get("voices") or []
    ok(st == 200 and len(vs) == 1 and vs[0]["role"] == "voice" and vs[0]["url"].endswith(vs[0]["file"])
       and abs(vs[0].get("duration", 0) - 1.5) < 0.2 and "thumb" not in vs[0], f"asset : une voix ajoutée, avec sa durée ({st} {vs})")
    ok(all(r["file"].startswith("ref-") for r in e2["element"]["refs"]), "asset : la voix n'entre pas dans les références d'images")
    from core import library as _lib
    ok(len(_lib.ref_paths(_lib.get(c["id"]))) == len(e2["element"]["refs"])
       and len(_lib.ref_paths(_lib.get(c["id"]), ["voice"])) == 1, "asset : ref_paths ne rend la voix que si on la demande")
    st, e3 = call("POST", "/api/elements", {"title": "Avec voix", "type": "character",
                                            "refs": [{"item": a["id"], "role": "face"}, {"item": snd["id"], "role": "voice"}]})
    ok(st == 200 and len(e3["element"]["refs"]) == 1 and len(e3["element"].get("voices") or []) == 1,
       "asset : un élément créé avec une image et une voix")
    st, e4 = call("POST", f"/api/asset/refs/{c['id']}", {"voices": []})
    ok(st == 200 and not e4["element"].get("voices") and len(e4["element"]["refs"]) == 2, "asset : retirer la voix, les images restent")
    st, e5 = call("POST", f"/api/asset/refs/{c['id']}", {"voices": [{"file": vs[0]["file"], "label": "voix grave", "item": snd["id"]}]})
    ok(st == 200 and e5["element"]["voices"][0]["label"] == "voix grave", "asset : la voix revient (annuler)")
    st, zp = call("POST", "/api/asset/zip", {"ids": [c["id"]]})
    st, raw = call("GET", "/" + zp["url"])
    names = sorted(_z.ZipFile(io.BytesIO(raw)).namelist()) if st == 200 else []
    ok("Él/voix · voix grave.wav" in names, f"asset : le zip d'un élément apporte sa voix ({names})")
    st, lin = call("GET", f"/api/asset/lineage/{snd['id']}")
    ok(any(x["id"] == c["id"] for x in lin["children"]), "asset : la lignée d'un son mène à l'élément qui le porte")

    # le panneau Asset commun (commun/dock.js) : etype=, media=, la sorte effective, les pages
    st, d = call("GET", "/api/asset/dock?kind=element&etype=character")
    ok(st == 200 and any(i["id"] == e3["id"] for i in d["items"])
       and all((i.get("element") or {}).get("type") == "character" for i in d["items"]), "asset : le panneau, etype= ne garde que ce type d'élément")
    st, d = call("GET", "/api/asset/dock?kind=image,element&etype=character&limit=1")
    ok(st == 200 and len(d["items"]) == 1 and d["total"] >= 2 and d["counts"]["image"] >= 1 and d["etypes"].get("character", 0) >= 1,
       f"asset : le panneau, une page et les comptes des pastilles ({st} {d.get('total')} {d.get('etypes')})")
    song = {"kind": "element", "element": {"type": "other", "head_kind": "audio"}}
    ok(dock_match(song, ["audio"], [], ["audio"]) and not dock_match(song, ["audio"], [], []) and sorte_effective(song) == "audio"
       and not dock_match({"kind": "element", "element": {"type": "object"}}, ["element"], ["character"], []),
       "asset : le panneau, media= compte l'élément versionné par sa dernière version")

    _page_selftest(call, ok, a, b)

    # Teams et Workspaces, étape 5 : Asset montre tout ce qu'on voit ; rapatrier
    bad = in_place_writers()
    ok(not bad, f"rapatrier : aucun code n'écrit dans le fichier principal d'un objet (lecture du code) {bad}")
    _rapatrier_selftest(ok)


# ── le contrôle de la page de gestion (asset-page, 30/09) ─────────────────────
def _page_selftest(call, ok, a: dict, b: dict) -> None:
    """Les dossiers déclarés (créer vide, renommer, supprimer = corbeille, oublier),
    l'arbre, les tris et filtres neufs de la vue, vider la corbeille."""
    st, f = call("POST", "/api/asset/folders", {"name": "  Groupe   vide "})
    ok(st == 200 and f["folder"] == "Groupe vide", f"asset-page : un dossier vide se crée ({st} {f})")
    st, t = call("GET", "/api/asset/tree")
    nodes = [s for tm in t.get("teams", []) for s in tm["spaces"]]
    fl = [x for s in nodes for x in s["folders"] if x["name"] == "Groupe vide"]
    ok(st == 200 and fl and fl[0]["count"] == 0 and t["total"] >= 2 and "trash" in t and "recent" in t,
       f"asset-page : l'arbre montre le dossier vide ({st} {fl})")
    st, v = call("GET", "/api/asset/view")
    ok(any(x["name"] == "Groupe vide" and x["total"] == 0 for x in v["folders"]) and "Groupe vide" in v["all_folders"],
       "asset-page : la racine montre le dossier vide, où l'on peut ranger")
    st, r = call("POST", "/api/asset/folders/rename", {"from": "Groupe vide", "to": "Groupe 2"})
    st2, t = call("GET", "/api/asset/tree")
    names = {x["name"] for tm in t["teams"] for s in tm["spaces"] for x in s["folders"]}
    ok(st == 200 and "Groupe 2" in names and "Groupe vide" not in names, f"asset-page : un dossier vide se renomme ({st} {r})")
    call("POST", "/api/asset/move", {"ids": [a["id"]], "folder": "Groupe 2"})
    call("POST", "/api/asset/move", {"ids": [a["id"]], "folder": "Renommé"})
    st, v = call("GET", "/api/asset/view")
    ok(any(x["name"] == "Groupe 2" and x["total"] == 0 for x in v["folders"]), "asset-page : vidé par un glisser, le dossier déclaré reste")
    call("POST", "/api/asset/move", {"ids": [a["id"]], "folder": "Groupe 2"})
    st, d = call("POST", "/api/asset/folders/delete", {"name": "Groupe 2"})
    st2, gone = call("GET", f"/api/library/{a['id']}")
    st3, tr = call("GET", "/api/asset/trash")
    ok(st == 200 and d["trashed"] == [a["id"]] and d["declared"] and st2 == 404
       and any(x["id"] == a["id"] and x["folder"] == "Groupe 2" for x in tr["items"]),
       f"asset-page : supprimer un dossier met ses objets à la corbeille, avec leur dossier ({st} {d})")
    st, back = call("POST", "/api/asset/restore", {"ids": d["trashed"]})
    call("POST", "/api/asset/folders", {"name": "Groupe 2"})
    st2, got = call("GET", f"/api/library/{a['id']}")
    ok(st == 200 and got.get("folder") == "Groupe 2", "asset-page : l'annuler rétablit les objets dans leur dossier")
    call("POST", "/api/asset/move", {"ids": [a["id"]], "folder": "Renommé"})
    st, _ = call("POST", "/api/asset/folders/forget", {"name": "Groupe 2"})
    st2, t = call("GET", "/api/asset/tree")
    ok(st == 200 and "Groupe 2" not in {x["name"] for tm in t["teams"] for s in tm["spaces"] for x in s["folders"]},
       "asset-page : un dossier vide oublié disparaît")
    st, _ = call("POST", "/api/asset/folders/delete", {"name": "Personne"})
    ok(st == 404, "asset-page : supprimer un dossier qui n'existe pas : 404")

    # les tris et les filtres neufs
    st, v = call("GET", "/api/asset/view?flat=1&sort=size")
    sizes = [x["bytes"] for x in v["items"]]
    ok(st == 200 and sizes == sorted(sizes, reverse=True) and any(x["id"] == a["id"] for x in v["items"]),
       f"asset-page : à plat (dossiers traversés), du plus lourd au plus léger ({sizes[:5]})")
    st, v = call("GET", "/api/asset/view?flat=1&sort=kind")
    ks = [KIND_ORDER.get(x["kind"], 9) for x in v["items"]]
    ok(st == 200 and ks == sorted(ks), "asset-page : le tri par sorte")
    st, v = call("GET", "/api/asset/view?flat=1&sort=space")
    ok(st == 200 and v["sort"] == "space", "asset-page : le tri par Workspace")
    st, v = call("GET", "/api/asset/view?flat=1&since=1")
    st2, v2 = call("GET", "/api/asset/view?flat=1&since=abc")
    ok(st == 200 and any(x["id"] == a["id"] for x in v["items"]) and st2 == 400, "asset-page : le filtre de date (depuis N jours)")
    st, v = call("GET", "/api/asset/view?flat=1&author=personne-inconnue")
    ok(st == 200 and v["total"] == 0 and isinstance(v["authors"], list), "asset-page : le filtre par auteur")
    st, v = call("GET", "/api/asset/view?sort=nimporte")
    ok(st == 200 and v["sort"] == "new", "asset-page : un tri inconnu revient au plus récent")

    # vider la corbeille : le seul geste qui efface ; ids= : ceux-là seulement
    call("POST", "/api/asset/trash", {"ids": [b["id"]]})
    st, e = call("POST", "/api/asset/trash/empty", {"ids": [b["id"]]})
    st2, tr = call("GET", "/api/asset/trash?spaces=*")
    st3, r = call("POST", "/api/asset/restore", {"ids": [b["id"]]})
    ok(st == 200 and e["removed"] == [b["id"]] and all(x["id"] != b["id"] for x in tr["items"]) and r["restored"] == [],
       f"asset-page : vider la corbeille efface pour de bon ({st} {e})")


# ── le contrôle de l'étape 5 : montrer tous les Workspaces, rapatrier ─────────
# Le lien dur de `main.*` (décision 8) n'est juste que si aucun code ne réécrit le fichier
# principal EN PLACE : une écriture en place changerait les deux objets à la fois. Deux
# preuves : la lecture du code (in_place_writers : tout appel qui écrit — write_bytes,
# write_text, open en écriture, PIL save, shutil/os vers une destination, une sortie
# ffmpeg — dont la cible nomme le fichier principal : `path_of(it)`, `it["file"]`,
# « main.* ») ; et l'essai (_rapatrier_selftest : chaque écriture de la bibliothèque passée
# sur l'original et sur la copie, l'inode et le contenu relus après chacune).
_MAIN_TARGET = re.compile(r"path_of\(\s*[^,()]+\)\s*\)?$|\[\s*['\"]file['\"]\s*\]|\.get\(\s*['\"]file['\"]|['\"]main\.")
# des écritures de « main.* » qui ne sont pas un objet de la bibliothèque : les données
# jetables d'un contrôle (la migration essayée sur une copie, server/tools/equipes.py)
_MAIN_ALLOWED = {("server/tools/equipes.py", "_migration")}


def in_place_writers() -> list[str]:
    import ast
    root = config.REPO
    out = []
    for f in sorted((root / "server").rglob("*.py")):
        rel = f.relative_to(root).as_posix()
        try:
            src = f.read_text(encoding="utf-8")
            tree = ast.parse(src)
        except (OSError, SyntaxError, ValueError):
            continue
        seg = lambda n: ast.get_source_segment(src, n) or ""   # noqa: E731

        def visit(node, stack):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                stack = stack + [node.name]
            if isinstance(node, ast.Call):
                fn = node.func
                name = fn.attr if isinstance(fn, ast.Attribute) else fn.id if isinstance(fn, ast.Name) else ""
                targets = []
                if name in ("write_bytes", "write_text", "touch") and isinstance(fn, ast.Attribute):
                    targets.append(fn.value)
                elif name in ("replace", "rename", "hardlink_to", "symlink_to") and isinstance(fn, ast.Attribute) and node.args \
                        and not (isinstance(fn.value, ast.Name) and fn.value.id in ("os",)) and len(node.args) == 1:
                    targets.append(node.args[0])                        # Path.replace(cible)
                elif name == "save" and node.args:
                    targets.append(node.args[0])                        # PIL : im.save(cible, …)
                elif name == "open" and len(node.args) >= 2 and isinstance(node.args[1], ast.Constant) \
                        and any(c in str(node.args[1].value) for c in "wa+"):
                    targets.append(node.args[0])
                elif name in ("copyfile", "copy", "copy2", "move", "copytree", "link", "symlink", "replace", "rename") \
                        and len(node.args) >= 2:
                    targets.append(node.args[1])                        # shutil / os : (source, destination)
                elif name in ("run", "Popen", "check_call", "check_output", "call") and node.args \
                        and isinstance(node.args[0], (ast.List, ast.Tuple)):
                    elts = node.args[0].elts
                    for k, e in enumerate(elts):   # une sortie de ffmpeg : tout sauf ce qui suit « -i »
                        prev = elts[k - 1] if k else None
                        if not (isinstance(prev, ast.Constant) and prev.value == "-i"):
                            targets.append(e)
                for t in targets:
                    if _MAIN_TARGET.search(seg(t).strip()) and not any((rel, s) in _MAIN_ALLOWED for s in stack):
                        out.append(f"{rel}:{node.lineno} {seg(node)[:90]}")
            for ch in ast.iter_child_nodes(node):
                visit(ch, stack)
        visit(tree, [])
    return out


def _rapatrier_selftest(ok) -> None:
    import hashlib
    import io
    import shutil as _sh
    import subprocess
    import tempfile

    from PIL import Image

    from tools.admin import essai_http as H

    def err(d) -> str:
        return d.get("error", "") if isinstance(d, dict) else str(d)[:80]

    def png(color, size=(300, 200)) -> bytes:
        buf = io.BytesIO()
        Image.new("RGB", size, color).save(buf, "PNG")
        return buf.getvalue()

    before = {k: config.CFG.get(k) for k in ("auth",)}
    config.CFG["auth"] = True
    auth.startup()
    with auth._lock:
        auth._hits.clear()
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    try:
        _, d, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)

        def who(tok, space=None):
            def req(method, path, body=None, *, raw=None, hd=None):
                h = {**same, **({"X-SR-Espace": space} if space else {}), **(hd or {})}
                return H(method, path, body, cookie=tok, headers=h, raw=raw)[:2]
            return req

        C = who(cal)
        s, t = C("POST", "/api/equipes", {"name": "Rapatrier Essai"})
        ok(s == 200, f"rapatrier : une Team d'essai ({s} {err(t)})")
        tid, A = t["id"], t["spaces"][0]["id"]
        s, sp = C("POST", f"/api/equipes/{tid}/espaces", {"name": "Client Rapatrier"})
        B = sp.get("id")
        s1, _ = C("POST", f"/api/equipes/{tid}/membres", {"pseudo": "Rea Rapatrie", "role": "member"})
        s2, _ = C("POST", f"/api/equipes/{tid}/membres", {"pseudo": "Vio Rapatrie", "role": "guest", "guest": "viewer", "spaces": [A, B]})
        s3, _ = C("POST", f"/api/equipes/{tid}/membres", {"pseudo": "Gab Rapatrie", "role": "guest", "guest": "acteur", "spaces": [A, B]})
        s4, _ = C("POST", "/api/admin/users", {"name": "Xen Rapatrie", "access": "studio"})
        _, _, REA = H("POST", "/api/auth/enter", {"name": "Rea Rapatrie"}, headers=same)
        _, _, VIO = H("POST", "/api/auth/enter", {"name": "Vio Rapatrie"}, headers=same)
        _, _, GAB = H("POST", "/api/auth/enter", {"name": "Gab Rapatrie"}, headers=same)
        _, _, XEN = H("POST", "/api/auth/enter", {"name": "Xen Rapatrie"}, headers=same)
        X = who(XEN)
        s5, tx = X("POST", "/api/equipes", {"name": "Ailleurs Rapatrie"})
        XS = ((tx or {}).get("spaces") or [{}])[0].get("id") if isinstance(tx, dict) else None
        ok((s1, s2, s3, s4, s5) == (200,) * 5 and B and REA and VIO and GAB and XEN and XS,
           f"rapatrier : Rea (membre), Vio (guest viewer), Gab (guest acteur), Xen (une autre Team) ({s1} {s2} {s3} {s4} {s5})")
        ra, rb = who(REA, A), who(REA, B)

        # ── ce que Rea fait dans A : une image, un son, une vidéo, une planche ──
        s, img = ra("PUT", "/api/library/upload?name=a.png&title=Image+de+A&folder=Planches", raw=png((200, 40, 40)),
                    hd={"Content-Type": "image/png"})
        ra("POST", f"/api/library/{img.get('id')}", {"tags": ["rouge", "essai"], "prompt": "une image rouge"})
        wav = Path(tempfile.mkdtemp(prefix="sr_rap_")) / "a.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=1", str(wav)],
                       capture_output=True, timeout=60)
        s2, snd = ra("PUT", "/api/library/upload?name=a.wav&title=Son+de+A", raw=wav.read_bytes(), hd={"Content-Type": "audio/wav"})
        mp4 = wav.with_suffix(".mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10", "-t", "1",
                        "-pix_fmt", "yuv420p", str(mp4)], capture_output=True, timeout=60)
        s3, vid = ra("PUT", "/api/library/upload?name=a.mp4&title=Film+de+A", raw=mp4.read_bytes(), hd={"Content-Type": "video/mp4"})
        s4, el = ra("POST", "/api/elements", {"title": "Planche de A", "type": "object", "refs": [{"item": img.get("id"), "role": "view"}]})
        ok((s, s2, s3, s4) == (200,) * 4 and img.get("space") == A and el.get("space") == A,
           f"rapatrier : Rea crée dans A ({s} {s2} {s3} {s4} {img.get('space')})")
        from tools import defilement
        for _ in range(200):   # la copie de défilement de la vidéo, faite à l'entrée (server/tools/defilement.py)
            if (library.folder_of(vid["id"]) / defilement.name()).exists():
                break
            time.sleep(0.05)
        rb("GET", f"/api/son/apercu/{snd['id']}?v=1")   # l'onde du son, rangée à côté (montrer : jugé par l'objet)

        # ── Asset montre tous les Workspaces ; le courant en tête ; un filtre par Workspace ──
        s, v = rb("GET", "/api/asset/view?q=de+A")
        ids = [x["id"] for x in v.get("items", [])]
        spaces = v.get("spaces") or []
        ok(s == 200 and img["id"] in ids and spaces and spaces[0]["id"] == B and spaces[0]["here"]
           and any(x["id"] == A and not x["here"] and x["count"] >= 3 for x in spaces) and v.get("here") == B,
           f"rapatrier : Asset dans B montre les objets de A, B en tête ({s} {[(x['id'], x.get('count')) for x in spaces]})")
        mine = next((x for x in v["items"] if x["id"] == img["id"]), {})
        ok(mine.get("space") == A, "rapatrier : chaque carte dit son Workspace")
        s, v2 = rb("GET", f"/api/asset/view?space={B}")
        ok(s == 200 and img["id"] not in [x["id"] for x in v2["items"]], "rapatrier : le filtre ne montre qu'un Workspace")
        s, v3 = rb("GET", "/api/asset/view")
        fl = [f for f in v3.get("folders", []) if f["name"] == "Planches"]
        ok(s == 200 and fl and fl[0]["space"] == A and "Planches" not in v3["all_folders"],
           f"rapatrier : un dossier de A se montre, marqué ; on n'y range pas depuis B ({[(f['name'], f['space']) for f in fl]})")
        s, v4 = rb("GET", f"/api/asset/view?folder=Planches&fspace={A}")
        ok(s == 200 and [x["id"] for x in v4["items"]] == [img["id"]], "rapatrier : ouvrir le dossier de A depuis B")
        s, _ = X("GET", f"/api/asset/view?space={A}")
        ok(s == 404, f"rapatrier : Xen ne filtre pas un Workspace qu'il ne voit pas ({s})")
        s, dk = rb("GET", "/api/asset/dock?spaces=*")
        s_, dk2 = rb("GET", "/api/asset/dock")
        ok(s == 200 and img["id"] in [x["id"] for x in dk["items"]] and img["id"] not in [x["id"] for x in dk2["items"]],
           "rapatrier : le panneau lit son Workspace ; « spaces=* » montre les autres")

        # ── montrer sans toucher : lire par see, écrire par get ──
        got = (rb("GET", f"/api/library/{img['id']}")[0], rb("GET", f"/api/library/{img['id']}?spaces=*")[0],
               rb("GET", f"/api/library/{img['id']}/view?w=256")[0], rb("GET", f"/api/asset/lineage/{img['id']}")[0])
        s, bt = rb("POST", "/api/library/batch", {"ids": [img["id"]], "spaces": "*"})
        s_, bt2 = rb("POST", "/api/library/batch", {"ids": [img["id"]]})
        ok(got == (404, 200, 200, 200) and [x["id"] for x in bt["items"]] == [img["id"]] and bt2["missing"] == [img["id"]],
           f"rapatrier : depuis B, l'objet de A se montre (spaces=*, view, lot, lignée), un outil ne l'atteint pas ({got})")
        writes = (rb("POST", f"/api/library/{img['id']}", {"title": "par B"}), rb("POST", "/api/asset/trash", {"ids": [img["id"]]}),
                  rb("POST", "/api/asset/move", {"ids": [img["id"]], "folder": "x"}),
                  rb("POST", "/api/elements", {"title": "x", "refs": [{"item": img["id"], "role": "face"}]}))
        ok(all(w[0] == 409 and "rapatrie" in err(w[1]) for w in writes) and library.see(img["id"])["title"] == "Image de A",
           f"rapatrier : depuis B, toucher l'objet de A répond 409 et dit de le rapatrier ({[w[0] for w in writes]})")
        s, zp = rb("POST", "/api/asset/zip", {"ids": [img["id"]]})
        ok(s == 200 and zp.get("files") == 1, f"rapatrier : télécharger un objet d'un autre Workspace (montrer) ({s})")

        # ── rapatrier ──
        before_b = {x["id"] for x in library.query(limit=10**6, spaces=[B])["items"]}
        src = {k: library.see(x["id"]) for k, x in (("img", img), ("snd", snd), ("vid", vid), ("el", el))}
        uids = {k: library.uid_of(x) for k, x in src.items()}
        s, r = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": [img["id"], snd["id"], vid["id"], el["id"]], "folder": "Reçus"})
        cp = dict(zip(("img", "snd", "vid", "el"), r.get("items", []))) if s == 200 else {}
        ok(s == 200 and len(cp) == 4 and r.get("earlier") == 0, f"rapatrier : quatre objets de A dans B ({s} {err(r)})")
        if len(cp) != 4:
            return
        rea = auth.user("rea-rapatrie")
        inst = library.instance()["uuid"]
        for k, c in cp.items():
            o = src[k]
            frm = (c.get("origin") or {}).get("from") or {}
            ok(c["id"] != o["id"] and c["id"] not in before_b and c["space"] == B and c.get("uid") == f"sr:{inst}/{c['id']}"
               and c["uid"] != uids[k] and (c.get("origin") or {}).get("user") == rea["id"]
               and frm.get("space") == A and frm.get("item") == o["id"] and frm.get("uid") == uids[k] and frm.get("at")
               and c.get("folder") == "Reçus" and not c.get("fav"),
               f"rapatrier : {k} — un objet neuf dans B, id et uid neufs, origin.user et origin.from ({c['id']} {c.get('uid')} {frm})")
            same_keys = [x for x in ("kind", "title", "prompt", "params", "tags", "width", "height", "duration", "fps", "parents") if x in o]
            ok(all(c.get(x) == o.get(x) for x in same_keys), f"rapatrier : {k} — titre, recette, tags, dimensions, lignée suivent")
        ok(cp["el"].get("parents") == [img["id"]] and (cp["el"].get("parents_space") or {}).get(img["id"]) == A,
           f"rapatrier : la lignée garde ses ids, marqués « dans A » ({cp['el'].get('parents_space')})")
        ok(len(cp["el"]["element"]["refs"]) == 1 and cp["el"]["element"]["refs"][0]["item"] == img["id"],
           "rapatrier : la planche garde ses références")

        # les fichiers : main.* par un lien dur, le reste en copie pleine
        def files(iid):
            d = library.folder_of(iid)
            return {p.name: p for p in d.iterdir() if p.is_file() and p.name not in library.IMPORT_SKIP}
        linked, apart = True, True
        for k in cp:
            fa, fb = files(src[k]["id"]), files(cp[k]["id"])
            for name, pa in fa.items():
                pb = fb.get(name)
                if pb is None or pa.read_bytes() != pb.read_bytes():
                    apart = False
                    continue
                if library.MAIN_RX.fullmatch(name):
                    linked &= pa.stat().st_ino == pb.stat().st_ino and pa.stat().st_nlink == 2
                else:
                    apart &= pa.stat().st_ino != pb.stat().st_ino
        ok(linked, "rapatrier : le fichier principal (main.*) est un lien dur — le même inode, deux noms")
        ok(apart, "rapatrier : vignette, copies d'affichage, références, onde, défilement : des copies pleines, mêmes octets")
        ok(sorted(files(cp["el"]["id"])) == sorted(files(src["el"]["id"])) and not any(p.stat().st_ino == q.stat().st_ino
           for p in files(cp["el"]["id"]).values() for q in files(src["el"]["id"]).values()),
           "rapatrier : un élément — ses références copiées, aucune partagée")

        # le contrôle qui fonde le lien dur : chaque écriture de la bibliothèque, sur l'original
        # et sur la copie ; après chacune, le même inode et les mêmes octets pour main.*
        mains = []
        for k in ("img", "snd", "vid"):
            pa = library.path_of(src[k])
            mains.append((k, pa.name, hashlib.sha256(pa.read_bytes()).hexdigest()))
        broken = []

        def loc(iid, name):   # dans la bibliothèque, ou à la corbeille
            p = library.folder_of(iid) / name
            return p if p.exists() else library.trash_root() / iid / name

        def check(step):
            for k, name, h in mains:
                pa, pb = loc(src[k]["id"], name), loc(cp[k]["id"], name)
                try:
                    sa, sb = pa.stat(), pb.stat()
                    good = sa.st_ino == sb.st_ino and hashlib.sha256(pa.read_bytes()).hexdigest() == h \
                        and hashlib.sha256(pb.read_bytes()).hexdigest() == h
                except OSError:
                    good = False
                if not good:
                    broken.append(f"{step} ({k})")

        for who_, sid, ids_ in ((ra, A, [src[k]["id"] for k in ("img", "snd", "vid")]), (rb, B, [cp[k]["id"] for k in ("img", "snd", "vid")])):
            for iid in ids_:
                who_("POST", f"/api/library/{iid}", {"title": "retitré", "tags": ["t"], "prompt": "autre", "fav": True})
                check("modifier la fiche")
            who_("POST", "/api/asset/move", {"ids": ids_, "folder": "Rangés"}); check("ranger")
            who_("POST", "/api/asset/folders/rename", {"from": "Rangés", "to": "Rangés 2"}); check("renommer un dossier")
            who_("POST", "/api/asset/bulk", {"ids": ids_, "fav": False, "tags_add": ["lot"]}); check("en lot")
            who_("POST", "/api/asset/zip", {"ids": ids_}); check("zip")
            who_("GET", f"/api/son/apercu/{ids_[1]}?v=1"); check("l'onde d'un son")
            who_("GET", f"/api/defil/{ids_[2]}"); check("la copie de défilement")
            s, e2 = who_("POST", "/api/elements", {"title": "réf", "type": "object", "refs": [{"item": ids_[0], "role": "view"}]})
            check("en faire une référence")
            if s == 200:
                who_("POST", f"/api/elements/{e2['id']}/refs", {"item": ids_[0], "role": "detail"}); check("ajouter une référence")
                who_("POST", f"/api/asset/refs/{e2['id']}", {"refs": []}); check("retoucher la planche")
            who_("POST", "/api/elements", {"from_item": ids_[0], "note": "v1"}); check("en faire la v1 d'un élément")
            auth.set_current(None)
            auth.set_current_space(None)
            for iid in ids_:
                library.ensure_views(iid, force=True)
            check("refaire les copies d'affichage")
            who_("POST", "/api/asset/trash", {"ids": ids_[:1]}); check("la corbeille")
            who_("POST", "/api/asset/restore", {"ids": ids_[:1]}); check("en revenir")
        s, j = C("POST", "/api/library/views", {"ids": [src["img"]["id"], cp["img"]["id"]], "force": True})
        for _ in range(100):
            s, j = C("GET", f"/api/jobs/{j.get('id')}")
            if j.get("state") in ("done", "error", "cancelled"):
                break
            time.sleep(0.1)
        check("le rattrapage des copies d'affichage (la file)")
        ok(not broken, f"rapatrier : aucune écriture de la bibliothèque ne réécrit main.* en place — inode et octets gardés {broken}")

        # éditer B ne touche pas A, et inversement
        rb("POST", f"/api/library/{cp['img']['id']}", {"title": "Copie retouchée", "tags": ["b"]})
        ra("POST", f"/api/library/{img['id']}", {"title": "Original retouché"})
        a_now, b_now = library.see(img["id"]), library.see(cp["img"]["id"])
        ok(a_now["title"] == "Original retouché" and b_now["title"] == "Copie retouchée" and b_now["tags"] == ["b"]
           and a_now["tags"] != ["b"], "rapatrier : éditer la copie ne touche pas l'original, ni l'inverse")
        rb("POST", f"/api/asset/refs/{cp['el']['id']}", {"refs": []})
        ok(len(library.see(el["id"])["element"]["refs"]) == 1, "rapatrier : retoucher la planche copiée laisse celle de A")

        # la corbeille et le vidage d'un côté laissent l'autre intact
        k, _name, h = mains[0]
        rb("POST", "/api/asset/trash", {"ids": [cp["img"]["id"]]})
        ok(hashlib.sha256(library.path_of(library.see(img["id"])).read_bytes()).hexdigest() == h,
           "rapatrier : la copie à la corbeille, l'original intact")
        rb("POST", "/api/asset/restore", {"ids": [cp["img"]["id"]]})
        s, _ = ra("POST", "/api/asset/trash", {"ids": [img["id"]]})
        _sh.rmtree(library.trash_root() / img["id"])   # vider la corbeille de A
        pbn = library.path_of(library.see(cp["img"]["id"]))
        ok(s == 200 and pbn.is_file() and hashlib.sha256(pbn.read_bytes()).hexdigest() == h and pbn.stat().st_nlink == 1
           and rb("GET", f"/library/{cp['img']['id']}/{pbn.name}")[0] == 200,
           "rapatrier : l'original jeté et la corbeille vidée, la copie de B garde son fichier (le lien dur vit par son nom)")
        s, lin = rb("GET", f"/api/asset/lineage/{cp['el']['id']}")
        ok(s == 200 and lin.get("source", {}).get("id") == el["id"], "rapatrier : la lignée d'une copie mène à son original")

        # annuler (Ctrl+Z de la page) : la copie à la corbeille, par qui l'a rapatriée
        s, r2 = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": [snd["id"]]})
        cid = (r2.get("items") or [{}])[0].get("id")
        s2, t = rb("POST", "/api/asset/trash", {"ids": [cid]})
        ok(s == 200 and r2.get("earlier") == 1 and s2 == 200 and not library.see(cid) and library.see(snd["id"]),
           f"rapatrier : une seconde copie (B en avait une) ; l'annuler la met à la corbeille, l'original reste ({s} {s2})")

        # une LUT du Montage : son .cube copié, une LUT neuve dans B
        from tools import montage
        cube = montage._test_cube(2, lambda r, g, bl: (1 - r, 1 - g, 1 - bl)).encode()
        s, lut = ra("PUT", "/api/montage/luts?name=inv.cube&title=Inversion+de+A", raw=cube, hd={"Content-Type": "application/octet-stream"})
        s2, r3 = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": [lut.get("id", "x")]})
        nl = (r3.get("luts") or [{}])[0] if isinstance(r3, dict) else {}
        in_b = {x["id"]: x for x in rb("GET", "/api/montage/luts")[1].get("luts", [])}
        in_a = {x["id"] for x in ra("GET", "/api/montage/luts")[1].get("luts", [])}
        d_ = montage._luts_dir()
        ok(s == 200 and s2 == 200 and nl.get("id") in in_b and nl["id"] != lut["id"] and lut["id"] in in_a and nl["id"] not in in_a
           and (nl.get("from") or {}).get("item") == lut["id"] and nl.get("space") == B
           and (d_ / f"{nl['id']}.cube").read_bytes() == (d_ / f"{lut['id']}.cube").read_bytes()
           and (d_ / f"{nl['id']}.cube").stat().st_ino != (d_ / f"{lut['id']}.cube").stat().st_ino,
           f"rapatrier : une LUT — une LUT neuve dans B, son .cube copié, l'original reste dans A ({s} {s2} {err(r3)})")
        s, d = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": [nl.get("id", "x")]})
        ok(s == 409, f"rapatrier : une LUT déjà dans B ({s})")

        # ── les refus ──
        n0 = len(library.query(limit=10**6, spaces=[B])["items"])
        s, d = who(VIO, B)("POST", f"/api/espaces/{B}/rapatrier", {"items": [el["id"]]})
        ok(s == 403 and "viewer" in err(d), f"rapatrier : un guest viewer ne rapatrie pas ({s} {err(d)[:80]})")
        s, d = who(GAB, B)("POST", f"/api/espaces/{B}/rapatrier", {"items": [el["id"]]})
        gab_copy = (d.get("items") or [{}])[0] if isinstance(d, dict) else {}
        ok(s == 200 and gab_copy.get("space") == B, f"rapatrier : un guest acteur rapatrie (créer, pas calculer) ({s} {err(d)[:60]})")
        s, d = X("POST", f"/api/espaces/{XS}/rapatrier", {"items": [el["id"]]})
        s2, d2 = X("POST", f"/api/espaces/{B}/rapatrier", {"items": [el["id"]]})
        ok(s == 404 and s2 == 404, f"rapatrier : une autre Team — ni l'objet, ni le Workspace ({s} {s2})")
        s, lv = ra("POST", "/api/elements", {"from_item": snd["id"], "note": "v1"})
        s2, d = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": [snd["id"], lv.get("id", "x")], "versions": {lv.get("id", "x"): 7}})
        ok(s == 200 and s2 == 409 and "v7" in err(d), f"rapatrier : un élément versionné, une version qui n'existe pas — refusé ({s} {s2} {err(d)[:60]})")
        s, sq = ra("POST", "/api/montage/projects", {"name": "Séquence de A"})
        s2, d = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": [sq.get("id", "x")]})
        ok(s2 == 409 and "séquence" in err(d), f"rapatrier : une séquence, pas encore ({s} {s2} {err(d)[:50]})")
        s, d = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": [cp["vid"]["id"]]})
        ok(s == 409 and "déjà" in err(d), f"rapatrier : un objet déjà dans B ({s})")
        s, d = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": []})
        s2, _ = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": ["ima-20000101-000000-dead"]})
        s3, _ = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": [snd["id"]], "folder": "a/b"})
        ok((s, s2, s3) == (400, 404, 400), f"rapatrier : une liste vide, un objet inconnu, un dossier dans un dossier ({s} {s2} {s3})")
        n1 = len(library.query(limit=10**6, spaces=[B])["items"])
        ok(n1 == n0 + 1, f"rapatrier : tout ou rien — un refus ne laisse aucune copie ({n0} → {n1}, la seule : celle de Gab)")
        # un outil de B se sert de la copie, pas de l'original
        s, e3 = rb("POST", "/api/elements", {"title": "Dans B", "refs": [{"item": cp["vid"]["id"], "role": "view"}]})
        s2, _ = rb("POST", "/api/elements", {"title": "Dans B", "refs": [{"item": vid["id"], "role": "view"}]})
        ok(s2 == 409, f"rapatrier : dans B, un outil n'atteint pas l'objet de A — il se rapatrie ({s2})")
        auth.set_current(rea)
        auth.set_current_space(B)
        try:
            ok(library.get(cp["vid"]["id"]) is not None and library.get(vid["id"]) is None,
               "rapatrier : library.get dans B rend la copie, jamais l'original")
        finally:
            auth.set_current(None)
            auth.set_current_space(None)
        _selftest_living(ok, err, ra, rb, A, B, lv, snd, wav, rea)
        _sh.rmtree(wav.parent, ignore_errors=True)
    finally:
        auth.set_current(None)
        auth.set_current_space(None)
        config.CFG["auth"] = before["auth"]


def _selftest_living(ok, err, ra, rb, A: str, B: str, lv: dict, snd: dict, wav, rea) -> None:
    """Rapatrier un élément versionné (equipes_espaces.md § 3.3, a — la version figée) : un
    élément NEUF dans B dont la v1 est une copie de la version choisie (la dernière prête par
    défaut) ; l'élément de A, ses versions et sa source ne bougent pas ; rien ne relie les deux
    (publier dans B ne touche pas A). `lv` : un élément de A dont `snd` est la v1."""
    from core import auth, library
    eid = lv.get("id", "x")
    s, s2v = ra("PUT", "/api/library/upload?name=b.wav&title=Son+2+de+A", raw=wav.read_bytes(), hd={"Content-Type": "audio/wav"})
    s2, _ = ra("POST", f"/api/elements/{eid}/versions", {"item": s2v.get("id", "x"), "note": "v2"})
    ok(s == 200 and s2 == 200, f"élément entre Workspaces : la v2 de l'élément de A ({s} {s2})")
    a_before = json.dumps(library.see(eid), sort_keys=True)
    s, d = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": [eid]})
    items = (d.get("items") or []) if isinstance(d, dict) else []
    e2 = next((x for x in items if x.get("kind") == "element"), {})
    v2 = next((x for x in items if x.get("kind") == "audio"), {})
    el2 = e2.get("element") or {}
    vers = el2.get("versions") or []
    ok(s == 200 and len(items) == 2 and e2.get("space") == B and v2.get("space") == B and e2.get("id") not in (eid, None),
       f"élément entre Workspaces : un élément neuf dans B, et sa v1 ({s} {err(d)[:80]} {[x.get('kind') for x in items]})")
    ok(len(vers) == 1 and vers[0].get("n") == 1 and vers[0].get("item") == v2.get("id") and vers[0].get("state") == "ready"
       and {k: (v2.get("version") or {}).get(k) for k in ("of", "n")} == {"of": e2.get("id"), "n": 1},
       f"élément entre Workspaces : sa pile — une seule version, la v1, marquée de l'élément de B ({vers} {v2.get('version')})")
    frm, vfrm = (e2.get("origin") or {}).get("from") or {}, (v2.get("origin") or {}).get("from") or {}
    ok(frm.get("space") == A and frm.get("item") == eid and frm.get("n") == 2 and frm.get("uid") == library.uid_of(library.see(eid))
       and vfrm.get("item") == s2v.get("id") and vfrm.get("version") == {"of": eid, "n": 2},
       f"élément entre Workspaces : par défaut, la dernière version (v2), d'où elle vient ({frm} {vfrm})")
    src2 = el2.get("source") or {}
    ok("doc" not in src2 and (src2.get("from") or {}).get("space") == A and e2.get("uid") != library.see(eid).get("uid"),
       f"élément entre Workspaces : sa source reste dans A (non suivie ici), un uid neuf ({src2})")
    ok(json.dumps(library.see(eid), sort_keys=True) == a_before and (library.see(s2v.get("id", "x")) or {}).get("version") == {"of": eid, "n": 2},
       "élément entre Workspaces : l'élément de A, ses versions, sa marque : intacts")
    s, det = rb("GET", f"/api/elements/{e2.get('id')}")
    det = det if isinstance(det, dict) else {}
    ok(s == 200 and (det.get("source_state") or {}).get("state") in ("non suivie", "sans version") and (det.get("versions") or [{}])[0].get("head")
       and (det.get("source_state") or {}).get("elsewhere"),
       f"élément entre Workspaces : sa fiche dans B — la v1 en tête, la source restée dans A, non suivie ({s} {det.get('source_state')})")
    # publier dans B : l'élément de B avance, celui de A ne bouge pas (jamais un lien vivant)
    s, b3 = rb("PUT", "/api/library/upload?name=c.wav&title=Son+de+B", raw=wav.read_bytes(), hd={"Content-Type": "audio/wav"})
    s2, _ = rb("POST", f"/api/elements/{e2.get('id')}/versions", {"item": b3.get("id", "x"), "note": "v2 de B"})
    ok(s2 == 200 and len(library.see(e2["id"])["element"]["versions"]) == 2 and len(library.see(eid)["element"]["versions"]) == 2
       and json.dumps(library.see(eid), sort_keys=True) == a_before,
       f"élément entre Workspaces : la v2 de B ne touche pas l'élément de A ({s2})")
    auth.set_current(rea)
    auth.set_current_space(B)
    try:
        ok((library.resolve(library.get(e2["id"])) or {}).get("id") == b3.get("id") and library.get(eid) is None,
           "élément entre Workspaces : dans B, un outil lit l'élément de B (sa dernière version), jamais celui de A")
    finally:
        auth.set_current(None)
        auth.set_current_space(None)
    # une version choisie ; une version retirée ; un élément sans version prête
    s, d = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": [eid], "versions": {eid: 1}})
    v1 = next((x for x in (d.get("items") or []) if x.get("kind") == "audio"), {}) if isinstance(d, dict) else {}
    ok(s == 200 and ((v1.get("origin") or {}).get("from") or {}).get("item") == snd["id"],
       f"élément entre Workspaces : la v1 demandée — la copie de la v1 ({s} {err(d)[:60]})")
    ra("POST", f"/api/elements/{eid}/versions/1", {"state": "withdrawn"})
    n0 = len(library.query(limit=10**6, spaces=[B])["items"])
    s, d = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": [eid], "versions": {eid: 1}})
    ok(s == 409 and "retirée" in err(d) and len(library.query(limit=10**6, spaces=[B])["items"]) == n0,
       f"élément entre Workspaces : une version retirée ne se rapatrie pas, rien n'est copié ({s} {err(d)[:70]})")
    s, d = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": [eid], "versions": {eid: "1"}})
    ok(s == 400, f"élément entre Workspaces : versions — un numéro ({s})")
    s, pj = ra("POST", "/api/music/projects", {"name": "Chanson de A"})
    s2, ne = ra("POST", "/api/elements", {"title": "Sans version", "source": {"tool": "music", "doc": pj.get("id", "x")}})
    s3, d = rb("POST", f"/api/espaces/{B}/rapatrier", {"items": [ne.get("id", "x")]})
    ok(s2 == 200 and s3 == 409 and "version prête" in err(d), f"élément entre Workspaces : sans version prête, rien à figer ({s2} {s3} {err(d)[:60]})")
