"""Montage : le Projet (le chutier) — ce que le montage a pris dans la bibliothèque.

Demande de Cal du 30/09 : un asset glissé du panneau Asset dans la fenêtre
Projet y **entre** (à la racine, ou dans le dossier sur lequel on le lâche) ;
« supprimer » dans le Projet le **retire du montage seulement** : il reste dans
la bibliothèque générale. Jusque-là (décision du 29/09 au soir, « le panneau
Projet, c'est Asset »), le Projet montrait toute la bibliothèque et « Suppr »
l'envoyait à la corbeille d'Asset (`montage/projet.js`, `trash` →
`POST /api/asset/trash`). Le panneau Asset commun (30/09) montre désormais la
bibliothèque entière à côté : le Projet redevient ce qui est propre au montage,
comme dans Premiere, où le panneau Projet et le panneau Bibliothèques sont deux
panneaux, et où un élément de bibliothèque glissé dans le Projet y est ajouté
(docs/etudes/panneau_asset.md, [PR1][PR3]).

Un Projet par Workspace (comme la bibliothèque et les LUT, qui sont par
Workspace) : `<data_dir>/montage/projet/<workspace>.json`

    {"space": …, "rev": n, "seeded": date,
     "items": {"<id>": {"folder": "Rushes", "added": date, "by": uid}}}

- On y met des **objets de la bibliothèque** (séquence, vidéo, image, son) ;
  un élément versionné y entre par sa dernière version (la règle du Montage :
  « glisser un élément pose sa dernière version », elements.js).
- Ses **dossiers sont les siens** : un seul niveau, un dossier n'existe que par
  ce qu'il contient (la règle d'Asset) ; ranger ici ne touche plus le dossier
  d'Asset de l'objet.
- **Retirer** ôte l'objet du Projet, rien d'autre : la bibliothèque le garde.
- Chaque geste rend l'état d'avant (`before` : [{id, folder|None}], None = pas
  dans le Projet), que `restore` remet : l'annulation de la page.
- Ce que le montage **crée ou pose** y entre seul (montage.py, `_projet`) : une
  séquence neuve ou dupliquée, un export, un objet posé pour la première fois
  sur une timeline (Premiere : ce qu'on pose depuis une bibliothèque entre dans
  le projet). Un objet qu'on a retiré en gardant ses plans n'y revient pas tant
  qu'on ne le pose pas de nouveau.
- La première lecture d'un Workspace (le fichier absent) reprend ce que le
  Projet montrait jusque-là : les séquences, vidéos, images et sons du
  Workspace, chacun dans son dossier d'Asset — rien ne disparaît à l'écran.

Modifier le Projet : le droit de créer dans ce Workspace (library.check_create ;
un lecteur, un guest viewer : non). Le lire : tout qui lit le Workspace ; les
objets montrés passent par library.get (la règle de lecture, la borne du
Workspace) : un objet à la corbeille d'Asset ou illisible ne se montre pas, mais
reste inscrit (revenu de la corbeille, il reparaît).
"""

from __future__ import annotations

import json
import re
import threading
from pathlib import Path

from core import auth, config, library
from core.http import HttpError

KINDS = ("sequence", "video", "image", "audio")
FOLDER_MAX = 60
IDS_MAX = 5000
ID_RX = re.compile(r"[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}")

_lock = threading.RLock()


def _dir() -> Path:
    p = config.data_dir() / "montage" / "projet"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _space() -> str:
    """Le Workspace du Projet : celui de la requête, ou du travail en cours ; sinon
    (le socle) l'espace par défaut de la personne (library.new_space)."""
    return library.new_space(check=False) or "_"


def _file(space: str) -> Path:
    return _dir() / (re.sub(r"[^A-Za-z0-9_-]", "_", space)[:80] + ".json")


def clean_folder(s) -> str:
    return " ".join(str(s or "").split())[:FOLDER_MAX]


def _write(d: dict) -> None:
    f = _file(d["space"])
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(f)


def _read(space: str | None = None) -> dict:
    space = space or _space()
    f = _file(space)
    if f.exists():
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(d, dict) and isinstance(d.get("items"), dict):
                return d
        except ValueError:
            pass
        # illisible : on le garde de côté plutôt que de l'écraser
        f.replace(f.with_suffix(f".illisible-{library.now().replace(':', '')}.json"))
    # la première fois : ce que le Projet montrait jusque-là (toute la bibliothèque du Workspace)
    now = library.now()
    items = {it["id"]: {"folder": clean_folder(it.get("folder")), "added": now, "by": "reprise"}
             for it in library.query(list(KINDS), limit=10 ** 7)["items"]}
    d = {"space": space, "rev": 1, "seeded": now, "items": items}
    _write(d)
    return d


def _check_edit(space: str) -> None:
    try:
        library.check_create(space)
    except PermissionError as e:
        raise HttpError(403, f"le Projet du Montage : {e}") from e


def _ids(raw) -> list[str]:
    if not isinstance(raw, list):
        raise HttpError(400, "ids : une liste")
    if len(raw) > IDS_MAX:
        raise HttpError(400, f"{IDS_MAX} objets au plus")
    return list(dict.fromkeys(str(i) for i in raw if ID_RX.fullmatch(str(i))))


def _usable(iid: str) -> tuple[dict | None, str]:
    """L'objet à inscrire (un élément : sa dernière version), ou pourquoi pas."""
    it = library.get(iid)
    if not it:
        return None, "introuvable dans ce Workspace (rapatriez-le d'abord)"
    if it["kind"] == "element":
        head = (library.head_entry(it) or {}).get("item") if library.is_living(it) else None
        hi = library.get(head) if head else None
        if not hi:
            return None, "un élément sans version prête"
        it = hi
    if it["kind"] not in KINDS:
        return None, f"une sorte que le montage ne prend pas ({it['kind']})"
    return it, ""


# ── les gestes (rendent l'état d'avant) ──────────────────────
def put(ids: list[str], folder: str = "", only_new: bool = False, check: bool = True) -> dict:
    """Inscrit `ids` dans `folder` (« » : la racine) ; un objet déjà là change de
    dossier (sauf `only_new` : il reste où il est). Rend {before, ids, refused}."""
    folder = clean_folder(folder)
    if "/" in folder:
        raise HttpError(400, "un dossier ne se range pas dans un autre : pas de « / » dans son nom")
    with _lock:
        d = _read()
        if check:
            _check_edit(d["space"])
        before, done, refused = [], [], []
        uid = auth.current_id() or ""
        for iid in ids:
            it, why = _usable(iid)
            if not it:
                refused.append({"id": iid, "why": why})
                continue
            cur = d["items"].get(it["id"])
            if cur is not None and (only_new or cur.get("folder", "") == folder):
                if it["id"] not in done:
                    done.append(it["id"])
                continue
            before.append({"id": it["id"], "folder": cur.get("folder", "") if cur is not None else None})
            d["items"][it["id"]] = {**(cur or {"added": library.now(), "by": uid}), "folder": folder}
            done.append(it["id"])
        if before:
            d["rev"] = int(d.get("rev", 1)) + 1
            _write(d)
    return {"before": before, "ids": done, "refused": refused, "folder": folder}


def ensure(ids) -> None:
    """Ce que le montage crée ou pose : inscrit à la racine s'il n'y est pas déjà."""
    put([i for i in ids if i], "", only_new=True, check=False)


def remove(ids: list[str]) -> dict:
    """Retire du Projet — rien d'autre : l'objet reste dans la bibliothèque."""
    with _lock:
        d = _read()
        _check_edit(d["space"])
        before = [{"id": i, "folder": d["items"].pop(i).get("folder", "")} for i in ids if i in d["items"]]
        if before:
            d["rev"] = int(d.get("rev", 1)) + 1
            _write(d)
    return {"before": before, "removed": [b["id"] for b in before]}


def restore(before) -> dict:
    """Remet un état d'avant : [{id, folder}] (folder None : l'objet n'y était pas)."""
    if not isinstance(before, list):
        raise HttpError(400, "before : une liste")
    with _lock:
        d = _read()
        _check_edit(d["space"])
        n = 0
        for b in before[:IDS_MAX]:
            iid = str((b or {}).get("id", "")) if isinstance(b, dict) else ""
            if not ID_RX.fullmatch(iid):
                continue
            if b.get("folder") is None:
                n += d["items"].pop(iid, None) is not None
            elif iid in d["items"] or library.get(iid):
                d["items"][iid] = {**d["items"].get(iid, {"added": library.now(), "by": auth.current_id() or ""}),
                                   "folder": clean_folder(b["folder"])}
                n += 1
        d["rev"] = int(d.get("rev", 1)) + 1
        _write(d)
    return {"restored": n}


def rename_folder(src: str, dst: str) -> dict:
    src, dst = clean_folder(src), clean_folder(dst)
    if not src or not dst:
        raise HttpError(400, "un nom, s'il vous plaît")
    if "/" in dst:
        raise HttpError(400, "pas de « / » dans le nom d'un dossier")
    with _lock:
        d = _read()
        _check_edit(d["space"])
        merged = any(v.get("folder") == dst for v in d["items"].values())
        before = []
        for iid, v in d["items"].items():
            if v.get("folder") == src:
                before.append({"id": iid, "folder": src})
                v["folder"] = dst
        if before:
            d["rev"] = int(d.get("rev", 1)) + 1
            _write(d)
    return {"before": before, "merged": merged, "moved": len(before)}


def folder_of(iid: str) -> str | None:
    with _lock:
        v = _read()["items"].get(iid)
    return None if v is None else v.get("folder", "")


def listing() -> dict:
    with _lock:
        d = _read()
        entries = dict(d["items"])
    out = []
    for iid, v in entries.items():
        it = library.get(iid)
        if it and it["kind"] in KINDS:
            out.append({**library.public(it), "bin": v.get("folder", ""), "bin_added": v.get("added")})
    out.sort(key=lambda x: x.get("created") or "", reverse=True)
    counts: dict[str, int] = {}
    for x in out:
        if x["bin"]:
            counts[x["bin"]] = counts.get(x["bin"], 0) + 1
    return {"items": out, "folders": sorted(counts.items(), key=lambda kv: kv[0].lower()),
            "rev": d.get("rev", 1), "space": d["space"], "hidden": len(entries) - len(out)}


# ── les routes ───────────────────────────────────────────────
def r_list(req):
    return listing()


def r_put(req):
    b = req.json()
    return put(_ids(b.get("ids")), b.get("folder") or "")


def r_remove(req):
    return remove(_ids(req.json().get("ids")))


def r_restore(req):
    return restore(req.json().get("before"))


def r_folder(req):
    b = req.json()
    return rename_folder(b.get("from"), b.get("to"))


def register(app) -> None:
    app.route("GET", "/api/montage/bin", r_list)
    app.route("POST", "/api/montage/bin/put", r_put)
    app.route("POST", "/api/montage/bin/remove", r_remove)
    app.route("POST", "/api/montage/bin/restore", r_restore)
    app.route("POST", "/api/montage/bin/folder", r_folder)


# ── le contrôle (tools/check.py) ─────────────────────────────
def selftest(call, ok) -> None:
    from io import BytesIO
    from PIL import Image

    def png(color):
        buf = BytesIO()
        Image.new("RGB", (32, 24), color).save(buf, "PNG")
        return buf.getvalue()

    got = []
    for i, c in enumerate(((10, 20, 30), (40, 50, 60), (70, 80, 90))):
        st, it = call("PUT", f"/api/library/upload?name=projet{i}.png&title=Projet%20{i}", raw=png(c),
                      headers={"Content-Type": "image/png"})
        ok(st == 200 and it.get("id"), f"montage · projet : une image d'essai ({st})")
        got.append(it["id"])
    a, b, c = got
    # la reprise : le Projet d'un Workspace sans fichier prend ce que la bibliothèque montrait (a, b, c y sont)
    st, L = call("GET", "/api/montage/bin")
    _file(L["space"]).unlink()
    st, L = call("GET", "/api/montage/bin")
    ids = {x["id"]: x for x in L.get("items", [])}
    ok(st == 200 and a in ids and b in ids and c in ids, f"montage · projet : la reprise montre la bibliothèque d'avant ({st})")
    # on repart d'un Projet sans a, b, c
    st, r = call("POST", "/api/montage/bin/remove", {"ids": [a, b, c]})
    st, L = call("GET", "/api/montage/bin")
    ok(st == 200 and not {a, b, c} & {x["id"] for x in L["items"]}, "montage · projet : retirer du Projet")
    for iid in (a, b, c):
        st, li = call("GET", f"/api/library/{iid}")
        ok(st == 200 and li.get("id") == iid, f"montage · projet : retiré du Projet, {iid} est toujours dans la bibliothèque ({st})")
    st, t = call("GET", "/api/asset/trash")
    ok(st == 200 and not {a, b, c} & {x.get("id") for x in t.get("items", t if isinstance(t, list) else [])},
       "montage · projet : retirer du Projet ne met rien à la corbeille d'Asset")
    # lâcher sur le fond (la racine), puis dans un dossier ; plusieurs d'un coup
    st, r = call("POST", "/api/montage/bin/put", {"ids": [a], "folder": ""})
    ok(st == 200 and r["before"] == [{"id": a, "folder": None}] and r["ids"] == [a], f"montage · projet : entrer à la racine ({st} {r})")
    st, r = call("POST", "/api/montage/bin/put", {"ids": [a, b, c], "folder": "  Rushes   A "})
    ok(st == 200 and r["folder"] == "Rushes A" and {x["id"]: x["folder"] for x in r["before"]} == {a: "", b: None, c: None},
       f"montage · projet : plusieurs dans un dossier ({r})")
    st, L = call("GET", "/api/montage/bin")
    bins = {x["id"]: x["bin"] for x in L["items"]}
    ok(bins.get(a) == bins.get(b) == bins.get(c) == "Rushes A" and ["Rushes A", 3] in [list(f) for f in L["folders"]],
       f"montage · projet : le dossier et son compte ({L['folders']})")
    st, li = call("GET", f"/api/library/{a}")
    ok(li.get("folder", "") == "", "montage · projet : ranger dans le Projet ne touche pas le dossier d'Asset")
    # annuler : remettre l'état d'avant
    st, u = call("POST", "/api/montage/bin/restore", {"before": r["before"]})
    st, L = call("GET", "/api/montage/bin")
    bins = {x["id"]: x["bin"] for x in L["items"]}
    ok(bins.get(a) == "" and b not in bins and c not in bins, f"montage · projet : annuler remet l'état d'avant ({bins.get(a)!r})")
    call("POST", "/api/montage/bin/put", {"ids": [b, c], "folder": "Plans"})
    st, rn = call("POST", "/api/montage/bin/folder", {"from": "Plans", "to": "Plans larges"})
    st, L = call("GET", "/api/montage/bin")
    ok(st == 200 and rn["moved"] == 2 and {x["bin"] for x in L["items"] if x["id"] in (b, c)} == {"Plans larges"},
       "montage · projet : renommer un dossier")
    st, bad = call("POST", "/api/montage/bin/put", {"ids": [a], "folder": "a/b"})
    ok(st == 400, "montage · projet : pas de dossier dans un dossier")
    st, r = call("POST", "/api/montage/bin/put", {"ids": ["ima-20000101-000000-dead"]})
    ok(st == 200 and r["refused"] and not r["ids"], "montage · projet : un objet absent est refusé, et dit pourquoi")
    # ce que le montage pose entre seul (à la racine) ; ce qu'on a retiré en gardant ses plans n'y revient pas
    call("POST", "/api/montage/bin/remove", {"ids": [a]})
    st, p = call("POST", "/api/montage/projects", {"name": "Essai projet", "bin": "Séquences"})
    st, L = call("GET", "/api/montage/bin")
    bins = {x["id"]: x["bin"] for x in L["items"]}
    ok(bins.get(p["id"]) == "Séquences", f"montage · projet : une séquence neuve entre dans son dossier ({bins.get(p['id'])!r})")
    clip = {"id": "k1", "track": "V1", "item": a, "kind": "image", "start": 0, "dur": 25}
    st, s1 = call("POST", f"/api/montage/projects/{p['id']}", {**p, "base_rev": p["rev"], "clips": [clip]})
    st, L = call("GET", "/api/montage/bin")
    bins = {x["id"]: x["bin"] for x in L["items"]}
    ok(s1.get("ok") and bins.get(a) == "", f"montage · projet : un objet posé sur la timeline entre à la racine ({bins.get(a)!r})")
    call("POST", "/api/montage/bin/remove", {"ids": [a]})
    st, s2 = call("POST", f"/api/montage/projects/{p['id']}", {**p, "base_rev": s1["rev"], "clips": [clip], "name": "Essai projet 2"})
    st, L = call("GET", "/api/montage/bin")
    ok(s2.get("ok") and a not in {x["id"] for x in L["items"]}, "montage · projet : retiré en gardant ses plans, il n'y revient pas seul")
    st, li = call("GET", f"/api/library/{a}")
    ok(st == 200, "montage · projet : l'objet des plans gardés est toujours dans la bibliothèque")
    st, dup = call("POST", f"/api/montage/projects/{p['id']}/duplicate")
    st, L = call("GET", "/api/montage/bin")
    bins = {x["id"]: x["bin"] for x in L["items"]}
    ok(bins.get(dup.get("id")) == "Séquences", "montage · projet : une séquence dupliquée entre dans le dossier de l'originale")
    # une séquence retirée du Projet reste un objet de la bibliothèque, entière
    call("POST", "/api/montage/bin/remove", {"ids": [dup["id"]]})
    st, again = call("GET", f"/api/montage/projects/{dup['id']}")
    ok(st == 200 and again.get("clips"), "montage · projet : une séquence retirée du Projet reste entière dans la bibliothèque")
    # un objet mis à la corbeille d'Asset disparaît du Projet et y reparaît à son retour
    call("POST", "/api/montage/bin/put", {"ids": [c], "folder": "Plans larges"})
    call("POST", "/api/asset/trash", {"ids": [c]})
    st, L = call("GET", "/api/montage/bin")
    ok(c not in {x["id"] for x in L["items"]}, "montage · projet : un objet à la corbeille d'Asset ne se montre pas")
    call("POST", "/api/asset/restore", {"ids": [c]})
    st, L = call("GET", "/api/montage/bin")
    ok({x["id"]: x["bin"] for x in L["items"]}.get(c) == "Plans larges", "montage · projet : revenu de la corbeille, il reparaît à sa place")
    # « Ajouter au montage » sans séquence ouverte (montage/?add=<id> : une séquence « à partir de
    # l'élément », l'objet déjà posé sur sa timeline) : il entre dans le Projet avec elle (Cal, 05/10 :
    # le son envoyé au montage depuis Transcrire « n'est pas arrivé dans les assets du projet »)
    st, snd = call("PUT", "/api/library/upload?name=envoi.wav&title=Envoi&tool=upload&via=transcrire", raw=_wav())
    sid = snd.get("id") if isinstance(snd, dict) else None
    st, L = call("GET", "/api/montage/bin")
    ok(sid and sid not in {x["id"] for x in L["items"]}, f"montage · projet : un son déposé ailleurs n'est pas dans le Projet ({sid})")
    st, fs = call("POST", "/api/montage/projects", {"from_item": sid, "bin": "Séquences"})
    st, L = call("GET", "/api/montage/bin")
    bins = {x["id"]: x["bin"] for x in L["items"]}
    ok(st == 200 and [x["item"] for x in fs.get("clips", [])] == [sid] and bins.get(fs.get("id")) == "Séquences"
       and bins.get(sid) == "Séquences",
       f"montage · projet : « ajouter au montage » sans séquence — le son entre dans le Projet avec sa séquence ({bins.get(sid)!r})")
    st, fb = call("POST", "/api/montage/projects", {"from_item": c, "bin": "Séquences"})
    st, L = call("GET", "/api/montage/bin")
    ok({x["id"]: x["bin"] for x in L["items"]}.get(c) == "Plans larges",
       "montage · projet : une séquence faite d'un objet déjà dans le Projet le laisse dans son dossier")
    for iid in (p["id"], dup["id"], fs.get("id"), fb.get("id")):
        call("POST", f"/api/montage/projects/{iid}/delete")


def _wav(secs: float = 1.0, rate: int = 16000) -> bytes:
    """Un son d'essai (un la à 440 Hz, PCM 16 bits mono), sans ffmpeg."""
    import math
    import struct
    import wave
    from io import BytesIO
    buf = BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * k / rate))) for k in range(int(secs * rate))))
    return buf.getvalue()
