"""Les éléments versionnés : une source vivante, des versions figées, des
usages épinglés. L'étude : docs/etudes/apps_studio_elements.md (§ 0, § 2) ;
le socle livré le 30/09 (« Fait le 30/09 » de l'étude).

  Une SOURCE est un document vivant d'un outil (un projet ODIO `mus-…`, une
  séquence `seq-…`, une planche d'Idéation `ide-…`, ou la recette d'un objet
  de la bibliothèque). Un ÉLÉMENT (`kind: element`, `element.versions`) la
  relie à ses VERSIONS : des objets ordinaires et immuables, marqués
  `version: {of, n}` (library.py). Un USAGE est un endroit qui pose
  l'identifiant d'une version (un plan de séquence, un clip d'ODIO, un nœud
  d'Idéation) : épinglé par construction, puisqu'il pointe un fichier que rien
  ne réécrit. Les usages se lisent dans les documents eux-mêmes (un cache
  refait quand un fichier change) : aucun outil n'a rien à tenir à jour.

  POST /api/elements {title, type, source:{tool, doc}, from_item?, note?}
       faire un élément ; `from_item` : un objet existant en devient la v1,
       sans être recopié. Sans `source` ni `from_item` : une planche de
       références, comme avant (core_api.el_create).
  GET  /api/elements?source=<doc>                  les éléments (d'une source), avec leur état
  GET  /api/elements/<id>                          l'élément, sa pile, sa source, ses usages
  POST /api/elements/<id>/versions {item, rev?, note?}   publier : l'objet devient la v n+1
  POST /api/elements/<id>/versions/<n> {state?, note?}   retirer (withdrawn), remettre (ready), annoter
  POST /api/elements/status {items: […]}           pour une page : la version et la dernière de chaque objet
  GET  /api/elements/uses?doc=<id>                 les usages d'un document, avec leur pastille
  POST /api/elements/check-use {el | item, doc}    poser ici ferait-il une boucle ? {ok, why, chain}
  GET  /api/elements/changes?since=<seq>           le journal numéroté, après `seq`

Règles (juste par construction) : une version n'existe qu'une fois son objet
rangé ; elle ne change plus (library._frozen) ; elle ne part pas à la
corbeille tant qu'un document la pose (le garde de library.trash, qui nomme
les usages) ; publier = le propriétaire de l'élément ou Cal (question 4) ;
poser un élément dans sa propre descendance est refusé en nommant la chaîne,
par la page (check-use) et par l'enregistrement du document (check_doc,
appelé par montage.py et music.py).
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import threading
from pathlib import Path

from core import auth, config, library
from core.http import HttpError

# ce qu'une version donne, selon la sorte de l'objet ; « refs » : une planche
MEDIA_OF_KIND = {"image": "image", "video": "video", "audio": "audio", "midi": "midi", "element": "refs"}
TYPE_OF_KIND = {"image": "picture", "video": "other", "audio": "sound", "midi": "music"}
MEDIA_FR = {"image": "une image", "video": "une vidéo", "audio": "un son", "midi": "un clip MIDI", "refs": "une planche"}
TOOL_OF_DOC = {"mus": "music", "seq": "montage", "ide": "ideation"}
DOC_RX = re.compile(r"(mus|seq|ide)-\d{8}-\d{6}-[0-9a-f]{4}")
ITEM_RX = library.ID_RE
NOTE_MAX = 400
STATES = ("ready", "withdrawn")
# ce qui, dans un projet ODIO, ne change pas le rendu (l'étude, § 2.4) : la vue, la
# version, le brouillon du panneau génératif, les réglages rangés, les marques, la boucle
MUS_SKIP = {"id", "name", "rev", "created", "updated", "owner", "shared", "origin", "ui", "pending", "gen", "presets",
            "markers", "loop"}
SEQ_KEEP = ("settings", "tracks", "groups", "clips", "range")

_lock = threading.RLock()


def _canon(x) -> str:
    return json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _norm(x):
    """La forme canonique de ce qui se rend : un flottant entier est un entier (la page
    écrit 1, Python 1.0), un champ vide ou absent est le même champ (la page pose ses
    défauts, `banc: {segs: [], atts: []}` pour `null`). Relevé le 30/09 : sans cela,
    ODIO ouvert et enregistré sans geste disait « modifié depuis la v2 »."""
    if isinstance(x, bool) or x is None:
        return x
    if isinstance(x, float) and x.is_integer():
        return int(x)
    if isinstance(x, dict):
        out = {k: _norm(v) for k, v in x.items()}
        return {k: v for k, v in out.items() if v not in (None, [], {})}
    if isinstance(x, list):
        return [_norm(v) for v in x]
    return x


def fingerprint(obj) -> str:
    return "sha256:" + hashlib.sha256(_canon(_norm(obj)).encode("utf-8")).hexdigest()


# ── les documents : sources et consommateurs ────────────────
def _doc_path(doc: str) -> Path | None:
    if not DOC_RX.fullmatch(doc or ""):
        return None
    kind = doc[:3]
    if kind == "mus":
        return config.data_dir() / "musique" / f"{doc}.json"
    if kind == "seq":
        return library.folder_of(doc) / "sequence.json"
    return config.data_dir() / "ideation" / f"{doc}.json"


def _read_json(p: Path) -> dict | None:
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def _doc_meta(doc: str, d: dict) -> dict:
    """Le titre, le propriétaire, l'adresse d'un document (source ou consommateur)."""
    kind = doc[:3]
    if kind == "seq":
        it = library._items.get(doc) or {}
        return {"title": it.get("title") or d.get("name") or doc, "owner": auth.owner_of(it), "shared": bool(it.get("shared")),
                "open": f"montage/#{doc}", "tool": "montage", "what": "séquence"}
    if kind == "mus":
        return {"title": d.get("name") or doc, "owner": auth.owner_of(d), "shared": bool(d.get("shared")),
                "open": f"musique/?p={doc}", "tool": "music", "what": "projet ODIO"}
    return {"title": d.get("name") or doc, "owner": auth.owner_of(d), "shared": bool(d.get("shared")),
            "open": f"ideation/#{doc}", "tool": "ideation", "what": "planche d'Idéation"}


def _doc_readable(meta: dict, doc: str) -> bool:
    return auth.can_read_item({"id": doc, "origin": {"user": meta.get("owner")}, "shared": meta.get("shared")}, auth.current())


def _refs_in(doc: str, d: dict) -> list[tuple[str, str]]:
    """(objet, où) pour chaque identifiant que le document pose. Les prises d'une
    région générative d'ODIO (`gen.takes`) sont des candidates, pas des usages."""
    out = []
    kind = doc[:3]
    if kind == "seq":
        for c in d.get("clips") or []:
            if isinstance(c, dict) and c.get("item") and c.get("kind") != "adjust":
                out.append((str(c["item"]), f"{c.get('track', '?')} · {c.get('title') or c.get('id')}"))
    elif kind == "mus":
        names = {t.get("id"): t.get("name") for t in d.get("tracks") or [] if isinstance(t, dict)}
        for c in d.get("clips") or []:
            if isinstance(c, dict) and isinstance(c.get("item"), str) and c["item"]:
                out.append((c["item"], f"{names.get(c.get('track')) or c.get('track') or 'piste'} · clip {c.get('id')}"))
    else:
        for n in d.get("nodes") or []:
            if isinstance(n, dict) and isinstance(n.get("item"), str) and n["item"]:
                out.append((n["item"], f"nœud {n.get('id')}"))
    return out


_docs: dict[str, tuple] = {}   # chemin → (mtime, taille, résumé)


def _summaries() -> list[dict]:
    """Chaque document qui pose des objets, relu seulement s'il a changé sur le
    disque : les séquences, les projets ODIO, les planches d'Idéation."""
    library._load()
    paths: list[tuple[str, Path]] = []
    for sid, it in list(library._items.items()):
        if it.get("kind") == "sequence":
            paths.append((sid, library.folder_of(sid) / "sequence.json"))
    for sub, pre in (("musique", "mus"), ("ideation", "ide")):
        d = config.data_dir() / sub
        if d.is_dir():
            paths += [(f.stem, f) for f in d.glob(f"{pre}-*.json") if DOC_RX.fullmatch(f.stem)]
    out, seen = [], set()
    with _lock:
        for doc, p in paths:
            try:
                st = p.stat()
            except OSError:
                continue
            key = str(p)
            seen.add(key)
            c = _docs.get(key)
            if not c or c[0] != st.st_mtime_ns or c[1] != st.st_size:
                d = _read_json(p)
                if d is None:
                    continue
                c = (st.st_mtime_ns, st.st_size, {"doc": doc, "refs": _refs_in(doc, d), "fp": _source_fp(doc, d),
                                                  "rev": d.get("rev"), **_doc_meta(doc, d)})
                _docs[key] = c
            s = c[2]
            if doc[:3] == "seq":   # le titre et le propriétaire d'une séquence vivent dans item.json
                s = {**s, **{k: v for k, v in _doc_meta(doc, {}).items() if k in ("title", "owner", "shared")}}
            out.append(s)
        for k in [k for k in _docs if k not in seen]:
            _docs.pop(k, None)
    return out


def _source_fp(doc: str, d: dict) -> str | None:
    """L'empreinte de ce qui, dans la source, change le rendu (l'étude, § 2.4)."""
    kind = doc[:3]
    if kind == "mus":
        return fingerprint({k: v for k, v in d.items() if k not in MUS_SKIP})
    if kind == "seq":
        return fingerprint({k: d.get(k) for k in SEQ_KEEP})
    return None   # un cadre d'Idéation : son empreinte viendra avec son adaptateur (étape 2 de l'étude)


# ── la source d'un élément, et son état ─────────────────────
def _source_now(src: dict) -> dict:
    """Ce qu'est la source d'un élément en ce moment : {kind, title, open, fp, rev,
    snapshot, readable} ; `lost` si elle n'existe plus."""
    doc = str(src.get("doc") or "")
    if DOC_RX.fullmatch(doc):
        p = _doc_path(doc)
        d = _read_json(p) if p else None
        if d is None or (doc[:3] == "seq" and doc not in library._items):
            return {"kind": "doc", "doc": doc, "lost": True, "title": doc, "open": None}
        meta = _doc_meta(doc, d)
        return {"kind": "doc", "doc": doc, "lost": False, "fp": _source_fp(doc, d), "rev": d.get("rev"), "snapshot": d,
                "readable": _doc_readable(meta, doc), **meta}
    if ITEM_RX.fullmatch(doc):
        # la recette d'un objet (§ 3.4) : son prompt et ses réglages ; l'objet est immuable
        it = library._items.get(doc)
        if not it:
            return {"kind": "recipe", "doc": doc, "lost": True, "title": doc, "open": None}
        rec = {"prompt": it.get("prompt", ""), "params": it.get("params") or {}}
        return {"kind": "recipe", "doc": doc, "lost": False, "fp": fingerprint(rec), "rev": None, "snapshot": rec,
                "readable": library.readable(it), "title": it.get("title") or doc, "open": f"asset/#{doc}",
                "tool": (it.get("origin") or {}).get("tool") or "upload", "what": "recette"}
    if src.get("tool") == "character-factory" and src.get("slug"):
        return {"kind": "character", "doc": src["slug"], "lost": False, "fp": None, "rev": None, "snapshot": None,
                "readable": True, "title": src["slug"], "open": src.get("open"), "tool": "character-factory",
                "what": "personnage"}
    return {"kind": "none", "doc": doc, "lost": False, "fp": None, "rev": None, "snapshot": None, "readable": True,
            "title": "", "open": None}


def source_state(e: dict) -> dict:
    """« à jour », « modifiée depuis la vN », « perdue », « sans version », ou « non suivie »
    (une source dont l'empreinte n'est pas encore écrite)."""
    src = e["element"].get("source") or {}
    now = _source_now(src)
    head = library.head_entry(e)
    out = {"tool": src.get("tool"), "doc": now.get("doc"), "title": now.get("title"), "open": now.get("open"),
           "what": now.get("what"), "rev": now.get("rev")}
    if now.get("lost"):
        return {**out, "state": "perdue"}
    if not head:
        return {**out, "state": "sans version"}
    if not now.get("fp") or not head.get("fp"):
        return {**out, "state": "non suivie", "since": head["n"]}
    return {**out, "state": "à jour" if now["fp"] == head["fp"] else "modifiée", "since": head["n"]}


# ── les usages ──────────────────────────────────────────────
def _version_of(item_id: str) -> tuple[str, int] | None:
    it = library._items.get(item_id)
    v = (it or {}).get("version")
    return (v["of"], int(v.get("n") or 0)) if isinstance(v, dict) and v.get("of") else None


def _use(s: dict, where: str, item: str, see: bool) -> dict:
    if not see:   # le document d'un autre, quand chacun ne voit que le sien : compté, pas nommé
        return {"hidden": True, "tool": s["tool"], "what": s["what"], "item": item}
    return {"doc": s["doc"], "tool": s["tool"], "what": s["what"], "title": s["title"], "where": where, "item": item,
            "owner": s.get("owner"), "owner_name": auth.display_name(s.get("owner")) if s.get("owner") else auth.admin_name(),
            "open": s["open"]}


def uses_of(item_ids: set[str] | None = None) -> dict[str, list[dict]]:
    """objet → les endroits qui le posent (tous les documents, ou seulement ces objets)."""
    out: dict[str, list[dict]] = {}
    for s in _summaries():
        see = _doc_readable(s, s["doc"])
        for item, where in s["refs"]:
            if item_ids is None or item in item_ids:
                out.setdefault(item, []).append(_use(s, where, item, see))
    return out


def _use_name(u: dict) -> str:
    if u.get("hidden"):
        return f"un·e {u['what']} d'une autre personne"
    return f"{u['what']} « {u['title']} » ({u['where']})"


def trash_guard(it: dict) -> None:
    """Le garde de library.trash : une version posée quelque part ne part pas à la
    corbeille (409), et la réponse nomme où elle est posée."""
    v = _version_of(it["id"])
    if not v:
        return
    uses = uses_of({it["id"]}).get(it["id"]) or []
    if uses:
        e = library._items.get(v[0]) or {}
        names = "; ".join(_use_name(u) for u in uses[:6]) + (f" et {len(uses) - 6} autres" if len(uses) > 6 else "")
        raise HttpError(409, f"« {it.get('title') or it['id']} » est la v{v[1]} de « {e.get('title') or v[0]} », posée dans : "
                             f"{names}. Passe ces usages à une autre version (ou retire-les) avant de la jeter.")


# ── ce qu'un élément contient ; les boucles ─────────────────
def _contained(eid: str, by_doc: dict[str, list[str]]) -> list[str]:
    """Les éléments qu'un élément contient : ceux dont une version est posée dans sa
    source, et ceux que ses versions publiées contenaient (`deps`)."""
    e = library._items.get(eid)
    if not library.is_living(e):
        return []
    out = []
    doc = str((e["element"].get("source") or {}).get("doc") or "")
    for item in by_doc.get(doc, []):
        v = _version_of(item)
        x = v[0] if v else (item if library.is_living(library._items.get(item)) else None)
        if x and x not in out:
            out.append(x)
    for ver in e["element"]["versions"]:
        for d in ver.get("deps") or []:
            if d.get("el") and d["el"] not in out:
                out.append(d["el"])
    return out


def _chain(eid: str, doc: str) -> list[str] | None:
    """Si l'élément `eid` posé dans `doc` ferait une boucle : la chaîne [eid, …, E] où
    E a `doc` pour source ; sinon None."""
    library._load()
    owners = {i for i, it in library._items.items()
              if library.is_living(it) and str((it["element"].get("source") or {}).get("doc") or "") == doc}
    if not owners:
        return None
    by_doc: dict[str, list[str]] = {}
    for s in _summaries():
        by_doc[s["doc"]] = [i for i, _ in s["refs"]]
    seen: set[str] = set()

    def walk(x: str, path: list[str]) -> list[str] | None:
        if x in owners:
            return path + [x]
        if x in seen:
            return None
        seen.add(x)
        for y in _contained(x, by_doc):
            r = walk(y, path + [x])
            if r:
                return r
        return None

    return walk(eid, [])


def _doc_title(doc: str) -> str:
    p = _doc_path(doc)
    d = _read_json(p) if p else None
    return _doc_meta(doc, d or {})["title"] if d is not None else doc


def check_use(eid: str, doc: str) -> dict:
    """{ok: True} ou {ok: False, why, chain} : poser l'élément `eid` dans `doc`."""
    ch = _chain(eid, doc)
    if not ch:
        return {"ok": True}
    t = _doc_title(doc)
    names = [f"« {(library._items.get(x) or {}).get('title') or x} »" for x in ch]
    why = (f"« {t} » → " + " → ".join(names) + f" : « {(library._items.get(ch[-1]) or {}).get('title')} » a « {t} » pour source. "
           "Un élément ne se pose pas dans sa propre descendance.")
    return {"ok": False, "why": why, "chain": ch}


def check_doc(doc: str, items) -> None:
    """Le garde des enregistrements (montage.r_save, music.save_project) : un document
    qui poserait un élément de sa propre descendance est refusé (400), la chaîne nommée."""
    library._load()
    done = set()
    for item in items:
        v = _version_of(str(item))
        x = v[0] if v else (str(item) if library.is_living(library._items.get(str(item))) else None)
        if not x or x in done:
            continue
        done.add(x)
        r = check_use(x, doc)
        if not r["ok"]:
            raise HttpError(400, r["why"])


# ── le journal ──────────────────────────────────────────────
_jlock = threading.Lock()
_jseq: dict[str, int] = {}


def _jpath() -> Path:
    d = config.data_dir() / "elements"
    d.mkdir(parents=True, exist_ok=True)
    return d / "journal.jsonl"


def _last_seq(p: Path) -> int:
    if str(p) in _jseq:
        return _jseq[str(p)]
    n = 0
    try:
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                n = max(n, int(json.loads(line).get("seq") or 0))
            except (ValueError, AttributeError):
                continue
    except OSError:
        pass
    _jseq[str(p)] = n
    return n


def emit(ev: str, **kw) -> int:
    """Une ligne de plus au journal, numérotée ; rend son numéro."""
    p = _jpath()
    with _jlock:
        seq = _last_seq(p) + 1
        line = {"seq": seq, "at": library.now(), "ev": ev, "by": auth.current_id(), **kw}
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
        _jseq[str(p)] = seq
    return seq


def changes(since: int) -> dict:
    p = _jpath()
    out = []
    try:
        lines = p.read_text(encoding="utf-8").splitlines()
    except OSError:
        lines = []
    for line in lines:
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if int(ev.get("seq") or 0) > since and (not ev.get("el") or library.get(ev["el"])):
            out.append(ev)
    with _jlock:
        last = _last_seq(p)
    return {"seq": last, "events": out[-500:]}


# ── faire un élément, publier ───────────────────────────────
def _element_or_404(eid: str) -> dict:
    e = library.get(eid)
    if not library.is_living(e):
        raise HttpError(404, f"élément versionné introuvable : {eid}")
    return e


def _source_of_doc(doc: str) -> dict:
    now = _source_now({"doc": doc})
    if now.get("lost") or now["kind"] == "none":
        raise HttpError(404, f"source introuvable : {doc}")
    if not now.get("readable"):
        raise HttpError(404, f"source introuvable : {doc}")
    return {"tool": now.get("tool") or TOOL_OF_DOC.get(doc[:3]), "doc": doc, "open": now.get("open")}


def make(d: dict) -> dict:
    """Faire un élément versionné : d'une source (sans version), ou d'un objet qui
    en devient la v1 sans être recopié (`from_item`)."""
    title = str(d.get("title") or "").strip()[:200]
    src_in = d.get("source") if isinstance(d.get("source"), dict) else {}
    doc = str(src_in.get("doc") or "")
    base = None
    if d.get("from_item"):
        base = library.get(str(d["from_item"]))
        if not base:
            raise HttpError(404, f"introuvable : {d['from_item']}")
        if base["kind"] not in MEDIA_OF_KIND or library.is_living(base):
            raise HttpError(400, "une version est une image, une vidéo, un son, un clip MIDI ou une planche")
        if _version_of(base["id"]):
            raise HttpError(409, f"« {base.get('title')} » est déjà la version d'un élément")
        library.check_write(base)
    if doc:
        source = _source_of_doc(doc)
    elif base is not None:
        bsrc = (base.get("element") or {}).get("source") or {}
        if base["kind"] == "element" and bsrc.get("tool") == "character-factory":
            source = {k: bsrc[k] for k in ("tool", "slug", "open") if k in bsrc}
        else:   # la recette de l'objet (§ 3.4) : l'objet lui-même
            source = {"tool": (base.get("origin") or {}).get("tool") or "upload", "doc": base["id"], "open": f"asset/#{base['id']}"}
    else:
        raise HttpError(400, "source : {tool, doc} (un projet ODIO, une séquence, une planche) ou from_item : un objet")
    if source.get("doc"):
        for it in list(library._items.values()):
            if library.is_living(it) and (it["element"].get("source") or {}).get("doc") == source["doc"] and library.readable(it):
                raise HttpError(409, f"cette source a déjà son élément : « {it.get('title')} » ({it['id']})")
    etype = str(d.get("type") or (base and (TYPE_OF_KIND.get(base["kind"]) or (base.get("element") or {}).get("type")))
                or ("music" if source.get("tool") == "music" else "sequence" if source.get("tool") == "montage" else "other"))
    if etype not in library.ELEMENT_TYPES_ALL:
        raise HttpError(400, f"sorte d'élément inconnue : {etype} ({', '.join(library.ELEMENT_TYPES_ALL)})")
    if not title:
        title = (base or {}).get("title") or _source_now(source).get("title") or "élément"
    e = library.create_living(title, etype, source, folder=str(d.get("folder") if d.get("folder") is not None else (base or {}).get("folder") or "")[:60],
                              tags=[str(t)[:40] for t in (d.get("tags") or [])][:64])
    if base is not None:
        try:
            publish(e["id"], base["id"], note=str(d.get("note") or "")[:NOTE_MAX], quiet=True)
        except Exception:
            # l'élément neuf n'a encore rien : il s'en va, rien ne reste à moitié
            with library._lock:
                library._items.pop(e["id"], None)
                shutil.rmtree(library.folder_of(e["id"]), ignore_errors=True)
            raise
    emit("el.created", el=e["id"], title=e["title"], source=source)
    if base is not None:
        h = e["element"]["versions"][-1]
        emit("el.published", el=e["id"], n=h["n"], item=h["item"], note=h["note"], title=e["title"])
    return library.get(e["id"])


def publish(eid: str, item_id: str, note: str = "", rev=None, quiet: bool = False) -> dict:
    """Ranger l'objet `item_id` comme version n+1 de l'élément. L'objet est déjà
    rendu (la page ODIO, une prise choisie, une image recréée) : il reçoit
    `version: {of, n}` ; la source telle qu'elle est est copiée à côté de son
    fichier (`source.json`), avec son empreinte. `rev` : la version de la source
    que la page a rendue — si la source a bougé depuis, 409."""
    with library._lock:
        e = _element_or_404(eid)
        library.check_write(e)                   # le propriétaire de l'élément, ou Cal (question 4)
        it = library.get(str(item_id))
        if not it:
            raise HttpError(404, f"introuvable : {item_id}")
        library.check_write(it)                  # on écrit `version` dans son item.json
        v = _version_of(it["id"])
        if v:
            raise HttpError(409, f"« {it.get('title')} » est déjà la v{v[1]} de « {(library._items.get(v[0]) or {}).get('title')} »")
        if it["kind"] not in MEDIA_OF_KIND or library.is_living(it):
            raise HttpError(400, "une version est une image, une vidéo, un son, un clip MIDI ou une planche")
        media = MEDIA_OF_KIND[it["kind"]]
        want = e["element"].get("media")
        if want and want != media:
            raise HttpError(400, f"une version de « {e['title']} » est {MEDIA_FR.get(want, want)}, pas {MEDIA_FR.get(media, media)}")
        now = _source_now(e["element"].get("source") or {})
        if now.get("lost"):
            raise HttpError(409, "la source de cet élément est perdue (à la corbeille ?) : on ne publie plus")
        if rev is not None and now.get("rev") is not None and int(rev) != int(now["rev"]):
            raise HttpError(409, f"la source a changé pendant le rendu (rendue : rev {rev}, maintenant : rev {now['rev']}) : "
                                 "republie depuis l'état actuel")
        deps = []
        if now.get("kind") == "doc" and now.get("snapshot") is not None:
            for ref, _ in _refs_in(now["doc"], now["snapshot"]):
                x = _version_of(ref)
                if x and not any(dd["item"] == ref for dd in deps):
                    deps.append({"el": x[0], "n": x[1], "item": ref})
            if any(dd["el"] == eid for dd in deps):
                raise HttpError(400, f"la source pose déjà une version de « {e['title']} » : un élément ne se contient pas lui-même")
        n = 1 + max([int(x.get("n") or 0) for x in e["element"]["versions"]] or [0])
        entry = {"n": n, "item": it["id"], "at": library.now(), "by": auth.current_id(),
                 "note": str(note or "")[:NOTE_MAX], "fp": now.get("fp"), "rev": now.get("rev"),
                 "src": {k: v for k, v in (e["element"].get("source") or {}).items() if k in ("tool", "doc", "slug")},
                 "deps": deps, "state": "ready"}
        # d'abord l'objet (sa marque, la source copiée à côté), puis la pile : une
        # version n'est dans la pile qu'une fois marquée et rangée
        d = library.folder_of(it["id"])
        if now.get("snapshot") is not None:
            tmp = d / "source.json.tmp"
            tmp.write_text(json.dumps(now["snapshot"], ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(d / "source.json")
        it["version"] = {"of": eid, "n": n}
        it["updated"] = library.now()
        library._save(it)
        e["element"]["versions"].append(entry)
        e["element"]["media"] = media
        e["updated"] = library.now()
        library._save(e)
    if not quiet:
        emit("el.published", el=eid, n=n, item=it["id"], note=entry["note"], title=e["title"])
    return entry


def set_state(eid: str, n: int, d: dict) -> dict:
    with library._lock:
        e = _element_or_404(eid)
        library.check_write(e)
        v = next((x for x in e["element"]["versions"] if int(x.get("n") or 0) == n), None)
        if not v:
            raise HttpError(404, f"« {e['title']} » n'a pas de v{n}")
        ev = None
        if "state" in d:
            if d["state"] not in STATES:
                raise HttpError(400, "state : ready ou withdrawn")
            if d["state"] != v.get("state", "ready"):
                v["state"] = d["state"]
                ev = "el.withdrawn" if d["state"] == "withdrawn" else "el.ready"
        if "note" in d:
            v["note"] = str(d.get("note") or "")[:NOTE_MAX]
        e["updated"] = library.now()
        library._save(e)
    if ev:
        emit(ev, el=eid, n=n, item=v["item"], title=e["title"])
    return v


# ── ce que les pages lisent ─────────────────────────────────
def _mini(it: dict | None) -> dict | None:
    if not it:
        return None
    p = library.public(it)
    return {k: p.get(k) for k in ("id", "kind", "title", "duration", "width", "height", "thumb_url", "url", "views", "view_urls", "created")}


def _entry_out(e: dict, v: dict, uses: dict, head: dict | None) -> dict:
    iid = v.get("item")
    present = iid in library._items
    return {**{k: v.get(k) for k in ("n", "item", "at", "by", "note", "fp", "rev", "src", "deps")},
            "state": v.get("state", "ready"), "by_name": auth.display_name(v.get("by")) if v.get("by") else auth.admin_name(),
            "present": present, "trashed": (not present) and (library.trash_root() / str(iid)).is_dir(),
            "head": bool(head) and head.get("n") == v.get("n"), "object": _mini(library.get(iid)) if present else None,
            "uses": uses.get(iid, [])}


def detail(e: dict) -> dict:
    head = library.head_entry(e)
    ids = {v.get("item") for v in e["element"]["versions"]}
    uses = uses_of(ids)
    out = library.public(e)
    out["versions"] = [_entry_out(e, v, uses, head) for v in reversed(e["element"]["versions"])]
    out["source_state"] = source_state(e)
    out["uses"] = [{**u, "n": v.get("n"), "latest": bool(head) and v.get("n") == head.get("n")}
                   for v in e["element"]["versions"] for u in uses.get(v.get("item"), [])]
    by_doc = {s["doc"]: [i for i, _ in s["refs"]] for s in _summaries()}
    out["contains"] = [{"el": x, "title": (library._items.get(x) or {}).get("title")} for x in _contained(e["id"], by_doc)
                       if library.get(x)]
    return out


def status(ids: list[str]) -> dict:
    """objet → sa version, et la dernière de son élément (la pastille d'une page)."""
    out = {}
    for iid in dict.fromkeys(ids):
        it = library.get(iid)
        v = _version_of(iid) if it else None
        if not v:
            continue
        e = library.get(v[0])
        if not library.is_living(e):
            out[iid] = {"el": v[0], "n": v[1], "el_present": False}
            continue
        head = library.head_entry(e)
        hit = library._items.get(head["item"]) if head else None
        mine = next((x for x in e["element"]["versions"] if x.get("item") == iid), {})
        out[iid] = {
            "el": e["id"], "title": e["title"], "n": v[1], "state": mine.get("state", "ready"), "el_present": True,
            "head": head["n"] if head else None, "head_item": head["item"] if head else None,
            "head_note": head.get("note") if head else None, "head_by": auth.display_name(head.get("by")) if head and head.get("by") else None,
            "head_at": head.get("at") if head else None, "head_duration": (hit or {}).get("duration"),
            "head_kind": (hit or {}).get("kind"), "duration": it.get("duration"),
            "open": (e["element"].get("source") or {}).get("open"),
            "versions": [{"n": x["n"], "item": x["item"], "note": x.get("note"), "at": x.get("at"),
                          "duration": (library._items.get(x["item"]) or {}).get("duration")}
                         for x in e["element"]["versions"] if x.get("state", "ready") == "ready" and x.get("item") in library._items],
        }
    return out


def listing(source: str = "", tool: str = "") -> list[dict]:
    library._load()
    out = []
    for it in list(library._items.values()):
        if not library.is_living(it) or not library.readable(it):
            continue
        src = it["element"].get("source") or {}
        if source and str(src.get("doc") or src.get("slug") or "") != source:
            continue
        if tool and src.get("tool") != tool:
            continue
        p = library.public(it)
        p["source_state"] = source_state(it)
        out.append(p)
    out.sort(key=lambda x: x.get("updated") or "", reverse=True)
    return out


# ── les routes ──────────────────────────────────────────────
def r_create(req):
    d = req.json()
    if not d.get("from_item") and not isinstance(d.get("source"), dict):
        from tools import core_api
        return core_api.el_create(req)       # une planche de références, comme avant
    return detail(make(d))


def r_list(req):
    return {"items": listing(req.q("source"), req.q("tool"))}


def r_get(req, eid):
    return detail(_element_or_404(eid))


def r_publish(req, eid):
    d = req.json()
    if not isinstance(d.get("item"), str) or not d["item"]:
        raise HttpError(400, "item : l'objet à ranger comme version")
    rev = d.get("rev")
    if rev is not None and not isinstance(rev, int):
        raise HttpError(400, "rev : un entier (la version de la source rendue)")
    entry = publish(eid, d["item"], note=str(d.get("note") or ""), rev=rev)
    return {"version": entry, "element": detail(library.get(eid))}


def r_version(req, eid, n):
    try:
        k = int(n)
    except ValueError as e:
        raise HttpError(400, "n : un numéro de version") from e
    set_state(eid, k, req.json())
    return detail(library.get(eid))


def r_status(req):
    ids = req.json().get("items")
    if not isinstance(ids, list) or len(ids) > 3000 or not all(isinstance(i, str) for i in ids):
        raise HttpError(400, "items : une liste de 3000 identifiants au plus")
    return {"items": status(ids), "seq": changes(10 ** 12)["seq"]}


def r_uses(req):
    doc = req.q("doc")
    if not DOC_RX.fullmatch(doc):
        raise HttpError(400, "doc : une séquence, un projet ODIO ou une planche")
    s = next((x for x in _summaries() if x["doc"] == doc), None)
    if not s or not _doc_readable(s, doc):
        raise HttpError(404, f"document introuvable : {doc}")
    st = status([i for i, _ in s["refs"]])
    out = []
    for item, where in s["refs"]:
        x = st.get(item)
        if x:
            out.append({"item": item, "where": where, **x, "update": bool(x.get("head")) and x["head"] != x["n"]})
    return {"doc": doc, "title": s["title"], "uses": out}


def r_check_use(req):
    d = req.json()
    doc = str(d.get("doc") or "")
    if not DOC_RX.fullmatch(doc):
        raise HttpError(400, "doc : une séquence, un projet ODIO ou une planche")
    eid = str(d.get("el") or "")
    if not eid and d.get("item"):
        v = _version_of(str(d["item"]))
        eid = v[0] if v else (str(d["item"]) if library.is_living(library.get(str(d["item"]))) else "")
    if not eid:
        return {"ok": True}
    if not library.get(eid):
        raise HttpError(404, f"introuvable : {eid}")
    return check_use(eid, doc)


def r_changes(req):
    try:
        since = int(req.q("since", "0") or 0)
    except ValueError as e:
        raise HttpError(400, "since : un numéro du journal") from e
    return changes(since)


def register(app) -> None:
    library.TRASH_GUARDS.append(trash_guard)
    # POST /api/elements est aussi la route des planches (core_api, chargé avant) :
    # celle-ci passe devant et lui rend la main quand le corps n'a ni source ni from_item
    app.route("POST", "/api/elements", r_create)
    app.routes.insert(0, app.routes.pop())
    app.route("GET", "/api/elements", r_list)
    # les chemins fixes avant /api/elements/{eid}
    app.route("POST", "/api/elements/status", r_status)
    app.route("GET", "/api/elements/uses", r_uses)
    app.route("POST", "/api/elements/check-use", r_check_use)
    app.route("GET", "/api/elements/changes", r_changes)
    app.route("GET", "/api/elements/{eid}", r_get)
    app.route("POST", "/api/elements/{eid}/versions", r_publish)
    app.route("POST", "/api/elements/{eid}/versions/{n}", r_version)


# ── le contrôle, sans GPU (tools/check.py) ──────────────────
def selftest(call, ok) -> None:
    import io
    import subprocess
    import tempfile

    from PIL import Image

    def err(d) -> str:
        return d.get("error", "") if isinstance(d, dict) else str(d)[:200]

    def media(args: list[str], ext: str) -> bytes:
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / f"x{ext}"
            subprocess.run(["ffmpeg", "-v", "error", "-y", *args, str(p)], capture_output=True, timeout=60)
            return p.read_bytes() if p.is_file() else b""

    def wav(freq: int, dur: float) -> bytes:
        return media(["-f", "lavfi", "-i", f"sine=frequency={freq}:duration={dur}"], ".wav")

    def up(name: str, body: bytes, title: str) -> dict:
        st, it = call("PUT", f"/api/library/upload?name={name}&title={title}&tool=music", raw=body)
        return it if st == 200 else {}

    a1, a2, a3 = up("v1.wav", wav(330, 2.0), "Pluie%20v1"), up("v2.wav", wav(440, 1.5), "Pluie%20v2"), up("v3.wav", wav(550, 1), "Autre")
    ok(all(x.get("kind") == "audio" for x in (a1, a2, a3)), "éléments : trois sons déposés")

    # ── une source ODIO, un élément sans version, puis la v1 ──
    st, p = call("POST", "/api/music/projects", {"name": "Pluie sur Belleville", "template": "vide"})
    pid = p.get("id", "")
    st, e = call("POST", "/api/elements", {"title": "Pluie", "type": "music", "source": {"tool": "music", "doc": pid}})
    eid = e.get("id", "")
    ok(st == 200 and e.get("kind") == "element" and e["element"]["versions"] == [] and e["element"]["head"] is None
       and e.get("source_state", {}).get("state") == "sans version", f"éléments : faire un élément d'un projet ODIO, sans version ({st} {err(e)})")
    st, d = call("POST", "/api/elements", {"title": "Doublon", "source": {"tool": "music", "doc": pid}})
    ok(st == 409, f"éléments : une source n'a qu'un élément ({st})")
    st, lst = call("GET", f"/api/elements?source={pid}")
    ok(st == 200 and [x["id"] for x in lst.get("items", [])] == [eid], "éléments : la page ODIO retrouve l'élément de son projet")
    st, r = call("POST", f"/api/elements/{eid}/versions", {"item": a1["id"], "rev": p.get("rev"), "note": "premier jet"})
    ok(st == 200 and r["version"]["n"] == 1 and r["element"]["element"]["head"] == 1, f"éléments : publier la v1 ({st} {err(r)})")
    st, g = call("GET", f"/api/library/{a1['id']}")
    ok(g.get("version", {}).get("of") == eid and g["version"]["n"] == 1 and g["version"]["head"] == 1,
       "éléments : la version sait de quel élément elle est la v1, et la dernière")
    snap = library.folder_of(a1["id"]) / "source.json"
    ok(snap.is_file() and json.loads(snap.read_text(encoding="utf-8")).get("id") == pid, "éléments : la source telle qu'elle a été rendue, à côté du son")
    ok(r["element"]["source_state"]["state"] == "à jour", f"éléments : la source est à jour ({r['element']['source_state']})")

    # la source change : « modifiée depuis la v1 » ; une rev périmée : 409
    st, cur = call("GET", f"/api/music/projects/{pid}")
    cur["bpm"] = (cur.get("bpm") or 120) + 7
    st, sv = call("POST", f"/api/music/projects/{pid}", cur)
    st, g = call("GET", f"/api/elements/{eid}")
    ok(g["source_state"]["state"] == "modifiée" and g["source_state"]["since"] == 1, f"éléments : modifiée depuis la v1 ({g['source_state']})")
    cur["ui"] = {"view": "nodal"}
    cur["rev"] = sv.get("rev")
    call("POST", f"/api/music/projects/{pid}", cur)
    st, g2 = call("GET", f"/api/elements/{eid}")
    ok(g2["source_state"]["state"] == "modifiée", "éléments : la vue n'entre pas dans l'empreinte, le tempo oui")
    st, d = call("POST", f"/api/elements/{eid}/versions", {"item": a2["id"], "rev": p.get("rev")})
    ok(st == 409 and "changé pendant le rendu" in err(d), f"éléments : une rev périmée est refusée ({st} {err(d)})")
    ok(fingerprint({"bpm": 120.0, "banc": None, "groups": None}) == fingerprint({"bpm": 120, "banc": {"segs": [], "atts": []}, "groups": []})
       and fingerprint({"bpm": 120}) != fingerprint({"bpm": 121}),
       "éléments : l'empreinte ignore 1.0 contre 1 et un champ vide contre absent (la page et le serveur écrivent pareil)")

    # ── une séquence pose la v1 : un usage, épinglé ──
    st, s = call("POST", "/api/montage/projects", {"name": "Pub 30 s"})
    sid = s.get("id", "")
    clip = {"id": "k1", "track": "A1", "item": a1["id"], "kind": "audio", "title": "Pluie", "start": 0, "dur": 50,
            "in": 0, "src_dur": 2.0}
    s["clips"] = [clip]
    st, sv = call("POST", f"/api/montage/projects/{sid}", {**s, "base_rev": s["rev"]})
    rev_s = sv.get("rev")
    st, u = call("GET", f"/api/elements/uses?doc={sid}")
    ok(st == 200 and len(u.get("uses", [])) == 1 and u["uses"][0]["n"] == 1 and not u["uses"][0]["update"],
       f"éléments : l'usage de la séquence est trouvé, à jour ({st} {u})")

    # ── la v2 : l'usage reste sur la v1 et voit « v2 existe » ──
    st, g = call("GET", f"/api/music/projects/{pid}")
    st, r = call("POST", f"/api/elements/{eid}/versions", {"item": a2["id"], "rev": g.get("rev"), "note": "refrain court"})
    ok(st == 200 and r["version"]["n"] == 2 and r["element"]["source_state"]["state"] == "à jour", f"éléments : publier la v2 ({st} {err(r)})")
    st, u = call("GET", f"/api/elements/uses?doc={sid}")
    x = (u.get("uses") or [{}])[0]
    ok(x.get("item") == a1["id"] and x.get("n") == 1 and x.get("head") == 2 and x.get("head_item") == a2["id"] and x.get("update")
       and x.get("head_note") == "refrain court", f"éléments : l'usage reste épinglé sur la v1 et voit la v2 ({x})")
    st, stt = call("POST", "/api/elements/status", {"items": [a1["id"], a3["id"]]})
    ok(st == 200 and stt["items"][a1["id"]]["head"] == 2 and a3["id"] not in stt["items"]
       and [v["n"] for v in stt["items"][a1["id"]]["versions"]] == [1, 2], "éléments : le statut d'un objet pour une page (la pastille)")
    st, g = call("GET", f"/api/elements/{eid}")
    ok([v["n"] for v in g["versions"]] == [2, 1] and g["versions"][0]["head"] and len(g["versions"][1]["uses"]) == 1
       and g["uses"][0]["latest"] is False, "éléments : la pile (v2 devant), la v1 et son usage")

    # mettre à jour = la page réécrit son document (ici : l'enregistrement de la séquence) ; ctrl+Z = l'inverse
    s["clips"] = [{**clip, "item": a2["id"], "src_dur": 1.5, "dur": 37}]
    st, sv = call("POST", f"/api/montage/projects/{sid}", {**s, "base_rev": rev_s})
    st, u = call("GET", f"/api/elements/uses?doc={sid}")
    ok(u["uses"][0]["n"] == 2 and not u["uses"][0]["update"], "éléments : mis à jour, l'usage pointe la v2")
    s["clips"] = [clip]
    st, sv = call("POST", f"/api/montage/projects/{sid}", {**s, "base_rev": sv.get("rev")})
    st, u = call("GET", f"/api/elements/uses?doc={sid}")
    ok(u["uses"][0]["n"] == 1 and u["uses"][0]["update"], "éléments : annulé, l'usage revient sur la v1")

    # ── la corbeille : une version utilisée ne part pas ──
    st, d = call("POST", f"/api/library/{a1['id']}/delete")
    ok(st == 409 and "Pub 30 s" in err(d) and "v1" in err(d), f"éléments : une version utilisée est refusée à la corbeille, ses usages nommés ({st} {err(d)})")
    st, d = call("POST", "/api/asset/trash", {"ids": [a1["id"]]})
    ok(st == 409 and library.get(a1["id"]) is not None, f"éléments : de même en lot ({st})")
    st, _ = call("POST", f"/api/library/{a2['id']}/delete")
    st2, g = call("GET", f"/api/elements/{eid}")
    ok(st == 200 and g["element"]["head"] == 1 and g["versions"][0]["trashed"], f"éléments : une version libre part ; la dernière redevient la v1 ({st})")
    call("POST", f"/api/library/{a2['id']}/restore")
    st, g = call("GET", f"/api/elements/{eid}")
    ok(g["element"]["head"] == 2, "éléments : elle revient, la v2 redevient la dernière")

    # une version ne change pas ; un objet n'est la version que d'un élément ; la bonne sorte
    st, d = call("POST", f"/api/library/{a1['id']}", {"prompt": "autre recette"})
    st2, d2 = call("POST", f"/api/library/{a1['id']}", {"title": "Pluie · premier jet"})
    ok(st == 403 and "ne change pas" in err(d) and st2 == 200, f"éléments : une version publiée ne change pas (le titre, si) ({st} {st2})")
    st, d = call("POST", f"/api/elements/{eid}/versions", {"item": a1["id"]})
    ok(st == 409 and "déjà la v1" in err(d), f"éléments : un objet n'est pas deux fois une version ({st})")
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (20, 90, 160)).save(buf, "PNG")
    st, img = call("PUT", "/api/library/upload?name=pochette.png&title=Pochette", raw=buf.getvalue())
    st, d = call("POST", f"/api/elements/{eid}/versions", {"item": img["id"]})
    ok(st == 400 and "un son" in err(d), f"éléments : une version de « Pluie » est un son ({st} {err(d)})")

    # retirer la v2 : la v1 redevient la dernière ; la remettre
    st, g = call("POST", f"/api/elements/{eid}/versions/2", {"state": "withdrawn"})
    ok(st == 200 and g["element"]["head"] == 1, f"éléments : retirer la v2 ({st})")
    st, g = call("POST", f"/api/elements/{eid}/versions/2", {"state": "ready", "note": "refrain court (validé)"})
    ok(g["element"]["head"] == 2 and g["versions"][0]["note"] == "refrain court (validé)", "éléments : la remettre, l'annoter")

    # ── faire un élément d'un objet : la v1 sans rien recopier ──
    st, pe = call("POST", "/api/elements", {"from_item": img["id"], "note": "la première"})
    files = sorted(x.name for x in library.folder_of(pe.get("id", "x")).iterdir()) if st == 200 else []
    ok(st == 200 and pe["element"]["head"] == 1 and pe["element"]["type"] == "picture" and pe["title"] == "Pochette"
       and files == ["item.json"] and pe.get("thumb_url", "").startswith(f"library/{img['id']}/"),
       f"éléments : faire un élément d'une image, qui en est la v1, sans copie ({st} {err(pe)} {files})")
    ok(library.ref_paths(library.get(pe["id"]))[0][0] == library.path_of(library.get(img["id"])),
       "éléments : un outil qui lit ses références reçoit la dernière version")
    st, v = call("GET", "/api/asset/view?q=Pochette")
    ids = [i["id"] for i in v.get("items", [])]
    ok(pe["id"] in ids and img["id"] not in ids, "éléments : Asset empile la version sous son élément")

    # l'identité mondiale
    st, g = call("GET", f"/api/library/{img['id']}")
    inst = library.instance()
    ok(g.get("uid") == f"sr:{inst['uuid']}/{img['id']}" and (config.data_dir() / "instance.json").is_file(),
       f"éléments : l'uid d'un objet, sr:<instance>/<id> ({g.get('uid')})")

    # ── les boucles : un élément ne se pose pas dans sa descendance ──
    vid = media(["-f", "lavfi", "-i", "testsrc=size=160x90:rate=10", "-t", "1", "-pix_fmt", "yuv420p"], ".mp4")
    st, mv = call("PUT", "/api/library/upload?name=pub.mp4&title=Pub%20rendu", raw=vid)
    st, se = call("POST", "/api/elements", {"title": "Pub 30 s", "type": "sequence", "source": {"tool": "montage", "doc": sid}})
    st, r = call("POST", f"/api/elements/{se.get('id')}/versions", {"item": mv.get("id")})
    ok(st == 200 and r["version"]["deps"] and r["version"]["deps"][0]["el"] == eid,
       f"éléments : la v1 de la séquence contient la chanson (deps) ({st} {err(r)})")
    st, c = call("POST", "/api/elements/check-use", {"el": se.get("id"), "doc": pid})
    ok(st == 200 and c["ok"] is False and "Pub 30 s" in c["why"] and "Pluie" in c["why"] and c["chain"] == [se["id"], eid],
       f"éléments : poser la séquence dans le projet de la chanson qu'elle contient : refusé, la chaîne nommée ({c})")
    st, c = call("POST", "/api/elements/check-use", {"item": mv.get("id"), "doc": sid})
    ok(c.get("ok") is False and c["chain"] == [se["id"]], f"éléments : une séquence dans elle-même : refusé ({c})")
    st, c = call("POST", "/api/elements/check-use", {"item": a2["id"], "doc": sid})
    ok(c.get("ok") is True, "éléments : la chanson dans la séquence : permis")
    s["clips"] = [clip, {"id": "k2", "track": "V1", "item": mv["id"], "kind": "video", "title": "Pub", "start": 0, "dur": 10,
                         "in": 0, "src_dur": 1.0}]
    st, cur = call("GET", f"/api/montage/projects/{sid}")
    st, d = call("POST", f"/api/montage/projects/{sid}", {**s, "base_rev": cur.get("rev")})
    ok(st == 400 and "propre descendance" in err(d), f"éléments : l'enregistrement d'une séquence qui se contient est refusé ({st} {err(d)})")

    # ── le journal ──
    st, ch = call("GET", "/api/elements/changes?since=0")
    evs = [x["ev"] for x in ch.get("events", []) if x.get("el") == eid]
    ok(st == 200 and evs[:3] == ["el.created", "el.published", "el.published"] and "el.withdrawn" in evs and "el.ready" in evs,
       f"éléments : le journal numéroté ({evs})")
    st, ch2 = call("GET", f"/api/elements/changes?since={ch['seq']}")
    ok(ch2.get("events") == [] and ch2["seq"] == ch["seq"], "éléments : rien de neuf après le dernier numéro")

    # ── les droits : seul le propriétaire de l'élément, ou Cal, publie ──
    from core import auth as _auth
    from tools.admin import essai_http as H
    before = config.CFG.get("auth")
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    try:
        config.CFG["auth"] = True
        _auth.startup()
        with _auth._lock:
            _auth._hits.clear()
        s0, _, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        toks = {}
        for name, uid in (("Albane", "albane"), ("Bastien", "bastien")):
            # (la même entrée que droits.py : une demande, que Cal accepte ; déjà acceptée, on entre)
            s1, d1, t = H("POST", "/api/auth/enter", {"name": name})
            H("POST", f"/api/admin/requests/{uid}/accept", cookie=cal, headers=same)
            toks[uid] = t
        A, B = toks.get("albane"), toks.get("bastien")
        ok(bool(cal and A and B), f"éléments, droits : Cal, Albane, Bastien entrent ({s0})")

        def as_(tok, method, path, body=None, raw=None):
            return H(method, path, body, cookie=tok, headers={**same, **({"Content-Type": "audio/wav"} if raw else {})}, raw=raw)[:2]

        s1, sa = as_(A, "PUT", "/api/library/upload?name=a.wav&title=Son%20d%27Albane", raw=wav(220, 1))
        s2, ea = as_(A, "POST", "/api/elements", {"from_item": sa.get("id")})
        s3, sb = as_(B, "PUT", "/api/library/upload?name=b.wav&title=Son%20de%20Bastien", raw=wav(260, 1))
        ok(s2 == 200 and ea.get("owner") == "albane", f"éléments, droits : Albane fait son élément ({s1} {s2} {err(ea)})")
        s4, d = as_(B, "POST", f"/api/elements/{ea.get('id')}/versions", {"item": sb.get("id")})
        ok(s4 == 403 and library.get(sb.get("id", "x")).get("version") is None, f"éléments, droits : Bastien ne publie pas sur l'élément d'Albane ({s4} {err(d)})")
        s5, d = as_(B, "POST", "/api/elements", {"from_item": sa.get("id")})
        ok(s5 in (403, 409), f"éléments, droits : Bastien ne fait pas un élément de l'objet d'Albane ({s5})")
        s6, d = as_(B, "POST", f"/api/elements/{ea.get('id')}/versions/1", {"state": "withdrawn"})
        ok(s6 == 403, f"éléments, droits : Bastien ne retire pas la version d'Albane ({s6})")
        s7, sa2 = as_(A, "PUT", "/api/library/upload?name=a2.wav&title=Son%202", raw=wav(240, 1))
        s8, d = as_(A, "POST", f"/api/elements/{ea.get('id')}/versions", {"item": sa2.get("id")})
        ok(s8 == 200 and d["version"]["n"] == 2, f"éléments, droits : Albane publie sa v2 ({s8} {err(d)})")
        s9, sc = as_(cal, "PUT", "/api/library/upload?name=c.wav&title=Son%20de%20Cal", raw=wav(280, 1))
        s10, d = as_(cal, "POST", f"/api/elements/{ea.get('id')}/versions", {"item": sc.get("id")})
        ok(s10 == 200 and d["version"]["n"] == 3, f"éléments, droits : Cal publie partout ({s10} {err(d)})")
    finally:
        _auth.set_current(None)
        config.CFG["auth"] = before
