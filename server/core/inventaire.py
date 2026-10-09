"""L'inventaire : qui a créé quoi, où (Cal, 09/10/2026 : « [un ami] a lancé des transcripts
et je ne vois pas où il a créé cet asset : je dois moi avoir un dashboard qui me permette
de voir toutes les teams, workspaces et assets créés par les gens »).

Le contrat (docs/ARCHITECTURE.md § 11, « Qui a créé quoi, où ») : chaque magasin de ce que
les gens créent se déclare ici par UNE fonction d'énumération, écrite par l'outil qui
l'écrit, dans son `register(app)` — lui seul connaît son format (l'auteur d'une planche est
dans son fichier d'accès, celui d'un projet d'analyse dans `auteur`, celui d'un LoRA dans
ses versions, le Workspace d'un Space de Musique est la clé de sa table) ; l'inventaire ne
lit le dossier d'aucun outil. La bibliothèque, qui est du socle, est déclarée ici même.

    inventaire.declare("transcription", label="transcription", plural="transcriptions",
                       tool="transcrire", store="transcrire", lister=_inventaire)

Une fonction d'énumération rend des fiches (dict), une par création :
    id         l'identifiant (obligatoire)
    title      le titre
    owner      l'auteur (uid) tel que le document le porte, ou None
    job        le travail qui l'a fait, s'il le dit (son `owner` est l'auteur d'un document
               qui ne le porte pas)
    space      le Workspace tel que le document le porte (None : la règle de espaces.space_of,
               l'espace par défaut de l'instance — jamais « sans Workspace »)
    created, updated   ISO
    open       l'adresse qui l'ouvre dans son outil, relative à la racine du portail, sans
               `?e=` (posé ici, `with_e` : le lien ouvre l'onglet dans le Workspace de l'objet)
    sub        une précision lisible (personnage, chanson, complet · carnet…)
    tool       l'outil qui l'a fait (`origin.tool` d'un objet ; sinon celui de la sorte)
    thumb      l'adresse de sa vignette, ou une fonction qui la rend (calculée pour la page
               montrée seulement)

Un magasin à documents (« champ » dans STORES de tools/check.py) qui n'est pas une création en
soi se déclare RATTACHÉ (`attach`, avec la raison) : le contrôle de l'isolement exige que
chacun soit l'un ou l'autre — un outil neuf qui range des documents sans les déclarer fait
échouer `tools/check.py`.

L'auteur, quand le document ne le porte pas (un objet d'avant la porte, une planche d'avant
le 30/09, une LUT importée en ligne de commande) : le travail qui l'a fait (`job`, que la file
garde : ses 400 derniers), sinon la première écriture du journal (`journal.jsonl`, et sa
rotation) qui nomme son identifiant, sinon « auteur inconnu » — chaque fiche dit d'où vient
son auteur (`via` : doc | travail | journal | None).

Les droits : une fiche n'est rendue qu'à qui la verrait dans une liste d'Asset —
`auth.item_reader` (le rôle dans son Workspace, `visibility` ; Cal : tout) ; jamais celle
d'un Workspace où l'on n'entre pas.
"""

from __future__ import annotations

import json
import re
import threading
import unicodedata
from pathlib import Path

from . import auth, config, espaces, library

SOURCES: dict[str, dict] = {}     # sorte → {kind, label, plural, tool, store, lister, order}
ATTACHED: dict[str, str] = {}     # magasin → pourquoi ce n'est pas une création en soi
_lock = threading.RLock()


def declare(kind: str, *, label: str, plural: str, tool: str, store: str, lister, order: int = 50) -> None:
    """Une sorte de création et sa fonction d'énumération (idempotent : un module rechargé
    redéclare la sienne). `store` : l'entrée de <data_dir> où elle est rangée (STORES)."""
    SOURCES[kind] = {"kind": kind, "label": label, "plural": plural, "tool": tool, "store": store,
                     "lister": lister, "order": order}


def attach(store: str, why: str) -> None:
    """Un magasin à documents qui n'est pas une création en soi (l'état d'un calcul d'un son,
    le journal des éléments, la corbeille) : il suit ce dont il dépend."""
    ATTACHED[store] = why


def covered() -> set[str]:
    """Les magasins que l'inventaire connaît : énumérés ou rattachés."""
    return {s["store"] for s in SOURCES.values()} | set(ATTACHED)


def kinds() -> list[dict]:
    """Les sortes, dans l'ordre de la page : {id, label, plural, tool, store}."""
    out = sorted(SOURCES.values(), key=lambda s: (s["order"], s["kind"]))
    return [{"id": s["kind"], "label": s["label"], "plural": s["plural"], "tool": s["tool"], "store": s["store"]} for s in out]


# ── lire les documents d'un outil : relus seulement s'ils ont changé ──
_docs: dict[tuple, tuple[tuple, dict | None]] = {}


def json_docs(paths, fiche):
    """La fiche de chaque fichier JSON lisible de `paths` : `fiche(chemin, document)` (un dict,
    ou None : pas une création). Seule la fiche est gardée en mémoire, jamais le document (une
    transcription au mot pèse des mégaoctets) ; un fichier n'est relu que si sa date ou sa
    taille a changé (les outils écrivent d'un coup : tmp puis replace). La fiche revient d'un
    appel à l'autre : à lire, jamais à modifier ; ce qui dépend d'un autre document (le titre
    d'une image source, l'auteur d'un fichier d'accès) se lit à part, à chaque fois."""
    who = (getattr(fiche, "__module__", ""), getattr(fiche, "__qualname__", ""))
    for p in paths:
        try:
            st = p.stat()
        except OSError:
            continue
        key, sig = (*who, str(p)), (st.st_mtime_ns, st.st_size)
        hit = _docs.get(key)
        if hit and hit[0] == sig:
            got = hit[1]
        else:
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            got = fiche(p, d) if isinstance(d, dict) else None
            if len(_docs) > 50000:   # un garde-fou : la mémoire ne grossit pas sans fin
                _docs.clear()
            _docs[key] = (sig, got)
        if got is not None:
            yield got


# ── l'auteur d'un document qui ne le porte pas ──────────────
# Les identifiants que le journal des écritures peut nommer dans un chemin (une planche, un
# projet, une transcription, une séquence… ; une session d'atelier, un Space de Musique).
ID_RX = re.compile(r"[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}|atl-[0-9a-f]{12}|msp-[0-9a-f]{12}")
_jr = {"root": None, "sig": None, "off": 0, "map": {}}


def _journal_scan(f: Path, off: int, out: dict) -> int:
    """Les écritures réussies de `f` à partir de `off` : le premier qui a écrit sur chaque
    identifiant nommé dans un chemin. Rend la nouvelle position (une ligne entière)."""
    try:
        with open(f, "rb") as fh:
            fh.seek(off)
            raw = fh.read()
    except OSError:
        return off
    end = raw.rfind(b"\n") + 1   # une ligne en cours d'écriture attend la lecture suivante
    for line in raw[:end].splitlines():
        if b'"http"' not in line:
            continue
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("event") != "http" or not e.get("user") or e.get("method") not in ("POST", "PUT") \
                or not isinstance(e.get("status"), int) or e["status"] >= 400:
            continue
        for x in ID_RX.findall(str(e.get("path") or "")):
            out.setdefault(x, e["user"])
    return off + end


def journal_authors() -> dict[str, str]:
    """identifiant → le premier qui l'a écrit, d'après le journal (core/auth.py, `journal`) et
    sa rotation (`journal.1.jsonl`, plus ancienne). Lu une fois, puis à la suite seulement ;
    relu en entier si le fichier a tourné."""
    root = config.data_dir()
    cur, old = root / "journal.jsonl", root / "journal.1.jsonl"
    with _lock:
        try:
            st = cur.stat()
            sig = (st.st_ino, old.stat().st_ino if old.exists() else None)
            size = st.st_size
        except OSError:
            sig, size = None, 0
        if _jr["root"] != str(root) or _jr["sig"] != sig or size < _jr["off"]:
            m: dict[str, str] = {}
            if old.exists():
                _journal_scan(old, 0, m)
            _jr.update(root=str(root), sig=sig, map=m, off=_journal_scan(cur, 0, m) if sig else 0)
        elif size > _jr["off"]:
            _jr["off"] = _journal_scan(cur, _jr["off"], _jr["map"])
        return _jr["map"]


def author(r: dict, jr: dict | None = None) -> tuple[str | None, str | None]:
    """(auteur, d'où on le sait) d'une fiche : le document ; sinon son travail ; sinon le
    journal ; sinon (None, None) — « auteur inconnu »."""
    if r.get("owner"):
        return r["owner"], "doc"
    if r.get("job"):
        from . import jobs
        o = (jobs.get(str(r["job"])) or {}).get("owner")
        if o:
            return o, "travail"
    who = (journal_authors() if jr is None else jr).get(str(r.get("id") or ""))
    return (who, "journal") if who else (None, None)


# ── toutes les fiches ───────────────────────────────────────
def records() -> list[dict]:
    """Chaque création de l'instance, une fiche normalisée : sorte, auteur (et d'où on le
    sait), Workspace (jamais vide). Le socle : sans juger qui regarde (`visible_records`)."""
    jr = journal_authors()
    out: list[dict] = []
    for src in sorted(SOURCES.values(), key=lambda s: (s["order"], s["kind"])):
        try:
            got = list(src["lister"]())
        except Exception as e:   # noqa: BLE001 — un outil en panne ne cache pas les autres
            print(f"inventaire : « {src['kind']} » illisible ({type(e).__name__}: {e})", flush=True)
            continue
        for r in got:
            if not isinstance(r, dict) or not r.get("id"):
                continue
            owner, via = author(r, jr)
            rec = {"kind": r.get("kind") or src["kind"], "id": str(r["id"]), "title": str(r.get("title") or r["id"])[:200],
                   "owner": owner, "via": via, "created": r.get("created") or r.get("updated") or "",
                   "updated": r.get("updated") or r.get("created") or "", "open": r.get("open") or "",
                   "sub": r.get("sub") or "", "tool": r.get("tool") or src["tool"], "thumb": r.get("thumb")}
            rec["space"] = espaces.space_of({"space": r.get("space"), "owner": owner}, owner)
            out.append(rec)
    return out


def visible_records(u) -> list[dict]:
    """Les fiches que la personne voit : la règle des listes d'Asset (auth.item_reader : le
    rôle dans le Workspace, `visibility`) — jamais celle d'un Workspace où l'on n'entre pas.
    Cal (et le socle) : toutes."""
    sees = auth.item_reader(u)
    return [r for r in records() if sees({"id": r["id"], "space": r["space"], "owner": r["owner"]})]


def with_e(path: str, sid: str | None) -> str:
    """L'adresse avec `e=<Workspace>` dans sa requête (avant le `#`) : l'onglet s'ouvre dans le
    Workspace de l'objet (commun/shell.js, ESPACE) — un document d'ailleurs n'y répond pas 403."""
    if not sid:
        return path
    base, _, frag = path.partition("#")
    base = base + ("&" if "?" in base else "?") + f"e={sid}"
    return base + (f"#{frag}" if frag else "")


def fold(s: str) -> str:
    """Pour chercher : bas de casse, sans accents."""
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "").lower()) if unicodedata.category(c) != "Mn")


def thumb_of(r: dict) -> str | None:
    t = r.get("thumb")
    if callable(t):
        try:
            t = t()
        except Exception:   # noqa: BLE001 — une vignette qui manque n'empêche pas la ligne
            t = None
    return t if isinstance(t, str) and t else None


# ── la bibliothèque (le socle) ──────────────────────────────
ETYPE_FR = {"character": "personnage", "object": "objet", "place": "lieu", "style": "style", "other": "autre",
            "music": "musique versionnée", "sound": "son versionné", "sequence": "séquence versionnée",
            "picture": "image versionnée"}
TOOL_SUB = {"chanson": "chanson", "upload": "déposé", "montage": "", "ideation": "Idéation"}


def _open_item(it: dict) -> str:
    """Où s'ouvre un objet : une séquence dans le Montage, une playlist dans Musique, le reste
    dans sa fiche d'Asset."""
    if it["kind"] == "sequence":
        return f"montage/#{it['id']}"
    if it["kind"] == "playlist":
        return f"chanson/?playlist={it['id']}"
    return f"asset/#{it['id']}"


def _library_lister(kind: str):
    def lister():
        library._load()
        with library._lock:
            items = [i for i in library._items.values() if i.get("kind") == kind]
            present = set(library._items)
        for it in items:
            v = it.get("version")
            if isinstance(v, dict) and v.get("of") in present:
                continue   # une version reste sous son élément (comme dans Asset)
            o = it.get("origin") or {}
            sub = ""
            if kind == "element":
                el = it.get("element") or {}
                sub = "personnage · Character Factory" if (el.get("source") or {}).get("tool") == "character-factory" \
                    else ETYPE_FR.get(el.get("type"), el.get("type") or "")
            elif o.get("tool") in TOOL_SUB:
                sub = TOOL_SUB[o["tool"]]
            yield {"id": it["id"], "title": it.get("title"), "owner": o.get("user"), "job": o.get("job"),
                   "space": it.get("space"), "created": it.get("created"), "updated": it.get("updated"),
                   "open": _open_item(it), "sub": sub, "tool": o.get("tool") or "asset",
                   "thumb": lambda it=it: library.public(it).get("thumb_url")}
    return lister


LIBRARY_FR = {"image": ("image", "images"), "video": ("vidéo", "vidéos"), "audio": ("son", "sons"),
              "midi": ("clip MIDI", "clips MIDI"), "document": ("document", "documents"), "element": ("élément", "éléments"),
              "sequence": ("séquence", "séquences"), "playlist": ("playlist", "playlists")}
for _k in library.KINDS:
    _l, _p = LIBRARY_FR.get(_k, (_k, _k))
    declare(_k, label=_l, plural=_p, tool="asset", store="library", lister=_library_lister(_k),
            order=10 + library.KINDS.index(_k))
attach("trash", "la corbeille d'Asset : ce qui en sort redevient un objet de la bibliothèque (il garde son auteur, son Workspace)")
