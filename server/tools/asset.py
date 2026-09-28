"""La page « Asset » : ce que la bibliothèque commune (`core/library.py`,
`tools/core_api.py`) ne sait pas encore faire pour elle.

  GET  /api/asset/view?kind=&q=&folder=&sort=&fav=1&tool=&limit=&offset=
       une vue de la page : les objets d'un niveau (la racine ou un
       dossier), les dossiers de la racine avec leurs vignettes en petit,
       les comptes par sorte, les outils d'origine. Une recherche (`q`)
       parcourt tous les dossiers.
  POST /api/asset/move {ids, folder}             ranger (ou sortir : folder "")
  POST /api/asset/folders/rename {from, to}      renommer un dossier = ses objets
  GET  /api/asset/lineage/<id>                   parents et enfants
  GET  /api/asset/trash                          la corbeille
  GET  /api/asset/trash/<id>/thumb               la vignette d'un objet jeté
  POST /api/asset/cf/refresh {id}                un personnage déjà importé,
                                                 remis à jour sur place

Un dossier n'existe que par ses objets (le champ `folder` de chacun,
ARCHITECTURE.md §2) : un dossier vide disparaît de lui-même. Un seul
niveau, comme dans la maquette du 28/09 (« un dossier tient des
personnages et des objets, pas d'autre dossier »).
"""

from __future__ import annotations

import json
import re
import shutil
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from core import config, library
from core.http import FileResponse, HttpError
from tools import core_api

FOLDER_MAX = 60


def _all(q: str = "", sort: str = "new", fav: bool = False, tool: str = "") -> list[dict]:
    return library.query(None, q, None, sort, 1_000_000, 0, fav, tool)["items"]


def _clean_folder(name) -> str:
    if not isinstance(name, str):
        raise HttpError(400, "un nom de dossier est un texte")
    name = " ".join(name.split())[:FOLDER_MAX]
    if "/" in name:
        raise HttpError(400, "un dossier ne se range pas dans un autre : pas de « / » dans son nom")
    return name


def _mini(it: dict) -> dict:
    return {"id": it["id"], "kind": it["kind"], "title": it.get("title", ""), "thumb_url": it.get("thumb_url"),
            "url": it.get("url") if it["kind"] == "video" else None,
            "etype": (it.get("element") or {}).get("type")}


# ── la vue de la page ───────────────────────────────────────
def view(req):
    kinds = [k for k in req.q("kind").split(",") if k in library.KINDS]
    q = req.q("q").strip()
    folder = req.q("folder")
    sort = req.q("sort", "new")
    fav = req.q("fav") == "1"
    tool = req.q("tool")
    try:
        limit = max(1, min(2000, int(req.q("limit", "400") or 400)))
        offset = max(0, int(req.q("offset", "0") or 0))
    except ValueError as e:
        raise HttpError(400, "limit et offset sont des nombres") from e

    everything = _all("", sort)
    tools: dict[str, int] = {}
    for it in everything:
        t = (it.get("origin") or {}).get("tool") or "upload"
        tools[t] = tools.get(t, 0) + 1
    all_folders = sorted({it.get("folder") for it in everything if it.get("folder")}, key=str.lower)

    matching = _all(q, sort, fav, tool)
    if folder:
        scope = [it for it in matching if (it.get("folder") or "") == folder]
    elif q:
        scope = matching                       # une recherche traverse les dossiers
    else:
        scope = [it for it in matching if not it.get("folder")]
    # les comptes : dans un dossier, les siens ; à la racine, toute la bibliothèque
    counted = scope if (folder or q) else matching
    counts = {k: 0 for k in library.KINDS}
    for it in counted:
        counts[it["kind"]] += 1

    items = [it for it in scope if not kinds or it["kind"] in kinds]

    folders = []
    if not folder and not q:
        groups: dict[str, list[dict]] = {}
        for it in matching:
            if it.get("folder"):
                groups.setdefault(it["folder"], []).append(it)
        for name, group in groups.items():
            shown = [it for it in group if not kinds or it["kind"] in kinds]
            if not shown:
                continue
            by_kind = {k: 0 for k in library.KINDS}
            for it in group:
                by_kind[it["kind"]] += 1
            folders.append({"name": name, "count": len(shown), "total": len(group), "kinds": by_kind,
                            "updated": max(it.get("updated") or it["created"] for it in group),
                            "preview": [_mini(it) for it in shown[:4]]})
        if sort == "title":
            folders.sort(key=lambda f: f["name"].lower())
        elif sort == "old":
            folders.sort(key=lambda f: f["updated"])
        else:
            folders.sort(key=lambda f: f["updated"], reverse=True)

    return {"items": items[offset:offset + limit], "total": len(items), "offset": offset,
            "counts": counts, "folders": folders, "all_folders": all_folders, "tools": tools,
            "library_total": len(everything), "folder": folder, "q": q}


# ── ranger ──────────────────────────────────────────────────
def move(req):
    d = req.json()
    ids = d.get("ids")
    if not isinstance(ids, list) or not ids:
        raise HttpError(400, "ids : la liste des objets à ranger")
    folder = _clean_folder(d.get("folder", ""))
    moved = []
    for iid in ids:
        it = library.get(str(iid))
        if not it:
            raise HttpError(404, f"introuvable : {iid}")
        moved.append({"id": it["id"], "from": it.get("folder") or ""})
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
    members = [it for it in _all() if (it.get("folder") or "") == old]
    if not members:
        raise HttpError(404, f"aucun dossier « {old} »")
    merged = new != old and any((it.get("folder") or "") == new for it in _all())
    for it in members:
        library.update(it["id"], {"folder": new})
    return {"renamed": len(members), "folder": new, "merged": merged}


# ── la lignée ───────────────────────────────────────────────
def _parent_ids(it: dict) -> list[str]:
    """Les parents déclarés, plus l'image d'origine de chaque référence d'un
    élément : `library.add_ref` ne les ajoute pas à `parents`."""
    ids = list(it.get("parents") or [])
    for r in (it.get("element") or {}).get("refs", []):
        if r.get("item") and r["item"] not in ids:
            ids.append(r["item"])
    return ids


def lineage(req, item_id):
    it = library.get(item_id)
    if not it:
        raise HttpError(404, f"introuvable : {item_id}")
    parents = [library.public(p) for p in (library.get(x) for x in _parent_ids(it)) if p]
    children = [c for c in _all() if item_id in _parent_ids(c)]
    return {"parents": parents, "children": children}


# ── la corbeille ────────────────────────────────────────────
def _trashed(folder: Path) -> dict | None:
    try:
        it = json.loads((folder / "item.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    # le renommage vers la corbeille met à jour le ctime du dossier (Linux) : l'heure du geste
    when = datetime.fromtimestamp(folder.stat().st_ctime, timezone.utc).isoformat(timespec="seconds")
    return {"id": it.get("id", folder.name), "kind": it.get("kind"), "title": it.get("title", ""),
            "created": it.get("created"), "trashed": when, "folder": it.get("folder", ""),
            "etype": (it.get("element") or {}).get("type"), "duration": it.get("duration"),
            "thumb_url": f"api/asset/trash/{folder.name}/thumb" if it.get("thumb") else None}


def trash_list(req):
    out = [t for t in (_trashed(d) for d in library.trash_root().iterdir() if d.is_dir()) if t]
    out.sort(key=lambda t: t["trashed"], reverse=True)
    return {"items": out}


def trash_thumb(req, item_id):
    root = library.trash_root().resolve()
    d = (root / item_id).resolve()
    if not d.is_relative_to(root) or not (d / "item.json").is_file():
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


def set_refs(req, item_id):
    """Pose la liste des références d'un élément, dans l'ordre donné :
    réordonner, changer un rôle, retirer, et remettre une référence qu'on
    vient de retirer (son fichier reste dans le dossier de l'élément ;
    `POST /api/library/<id>` ne sait pas la faire revenir)."""
    it = library.get(item_id)
    if not it or it["kind"] != "element":
        raise HttpError(404, f"élément introuvable : {item_id}")
    refs = req.json().get("refs")
    if not isinstance(refs, list):
        raise HttpError(400, "refs : la liste des références")
    d = library.folder_of(item_id)
    old = {r["file"]: r for r in it["element"]["refs"]}
    out, seen = [], set()
    for r in refs:
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
    src = it["element"].get("source") or {}
    slug = src.get("slug", "")
    if src.get("tool") != "character-factory" or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", slug):
        raise HttpError(400, "cet élément ne vient pas de Character Factory")
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
        if ext not in (".png", ".jpg", ".jpeg", ".webp"):
            return
        dest = tmp / f"{len(got):02d}{ext}"
        try:
            dest.write_bytes(core_api._cf_get(urllib.parse.quote(f"/files/{slug}/{rel}"), timeout=60))
        except HttpError:
            return
        got.append({"path": dest, "role": role, "label": label})

    core_api._walk_cf(c, fetch)
    if not got:
        shutil.rmtree(tmp, ignore_errors=True)
        raise HttpError(409, "le studio ne rend aucune image validée pour ce personnage : l'élément reste tel quel")
    d = library.folder_of(iid)
    with library._lock:
        for r in it["element"]["refs"]:
            for name in (r.get("file"), r.get("thumb")):
                if name:
                    (d / name).unlink(missing_ok=True)
        it["element"]["refs"] = []
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


def register(app) -> None:
    app.route("GET", "/api/asset/view", view)
    app.route("POST", "/api/asset/move", move)
    app.route("POST", "/api/asset/folders/rename", rename_folder)
    app.route("GET", "/api/asset/lineage/{item_id}", lineage)
    app.route("GET", "/api/asset/trash", trash_list)
    app.route("GET", "/api/asset/trash/{item_id}/thumb", trash_thumb)
    app.route("POST", "/api/asset/cf/refresh", cf_refresh)
    app.route("POST", "/api/asset/refs/{item_id}", set_refs)


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
    ok(st == 404, "asset : la corbeille ne sort pas de son dossier")
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
