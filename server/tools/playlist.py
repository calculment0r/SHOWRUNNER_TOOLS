"""Musique, les playlists : une suite de sons de la bibliothèque, qu'on écoute
et qu'on montre.

Décision de Cal (05/10 au soir, docs/etudes/musique_spaces_playlists.md § 3 et
§ 5 étape 2 ; docs/REPRISE.md § 2.C) : « un outil de playlist super cool ». Une
playlist est un OBJET de la bibliothèque, de sorte `playlist` (id `pla-…`,
library.KINDS) : un document qu'on réécrit en place, comme une planche, et pas un
élément versionné. Elle a donc d'office ce que tout objet a : son Workspace
(`space`), les droits (library.check_write, la corbeille à l'auteur), la corbeille
et son retour, Asset (sa fiche, asset/asset.js), la recherche (titre, artiste,
description : library.query).

- Elle prend TOUT son de la bibliothèque (sorte `audio`) : une chanson de Musique,
  un morceau importé, une piste séparée, un mixage exporté d'ODIO. Un son se lit par
  library.get : du Workspace courant, de n'importe lequel de ses Spaces.
- Elle naît dans le Space courant de la page (`music_space`, `msp-…` ; null : le
  Space par défaut, « Mon Space »), pour qu'on la retrouve ; elle n'y est pas liée
  (étude § 3, « Le modèle »).
- Elle n'a pas de fichier : tout est dans item.json, au champ `playlist` (le lecteur
  d'écoute et l'export .zip le lisent tel quel, la branche « écoute »). Sa vignette
  est celle de sa pochette (une image de la bibliothèque) ; sans pochette, la page
  peint d'office la mosaïque de ses quatre premiers morceaux (commun/pochette.js),
  aux couleurs des jetons — aucune couleur cuite dans un fichier.

L'objet, tel que GET /api/library/<id> le rend (le CONTRAT : la branche « écoute »
fabrique le lecteur et le .zip depuis ce champ, la branche « paroles » y lit `lrc`) :

  {id: "pla-…", kind: "playlist", title, music_space: "msp-…" | null, space, origin,
   created, updated, rev, duration, parents, thumb?, views?,
   playlist: {artist: str, year: str, description: str, cover: <id d'image> | null,
              tracks: [{item: <id audio>, title?, credits?, lyrics?, lrc?}],
              transition: {mode: "gapless" | "crossfade" | "single", crossfade_s: 0..6},
              download: bool}}

Une piste ne porte que ses surcharges : son titre, ses crédits, ses paroles (texte) ou
leur calage (LRC) — sinon, ceux du son (`lrc` de l'objet audio, posé par les paroles
calées). `duration` (la somme des morceaux présents) et `parents` (les sons, la
lignée d'Asset) suivent la liste à chaque réécriture.

Les routes :

  GET  /api/playlist/options                 ce que la page peut faire (l'export .zip, les
                                             paroles calées : présents ou non dans ce portail)
  GET  /api/playlist?music_space=            les playlists du Workspace (un Space, ou toutes)
  POST /api/playlist {title?, music_space?, tracks?, playlist?}   une playlist neuve
  GET  /api/playlist/<id>                    l'objet, ses sons (`items`), ceux qui manquent
                                             (`missing`), le tempo et la tonalité de chacun (`metas`)
  POST /api/playlist/<id> {base_rev?, title?, playlist: {…}}      réécrire (les champs donnés)
  POST /api/playlist/<id>/ordre {tempos?}    « Proposer un ordre » : rien n'est écrit, la page
                                             montre la proposition, la personne garde ou annule

Le tempo et la tonalité d'un son (`track_meta`) : ceux de sa partition (YuE2 les écrit,
Q: et K:), sinon de sa recette (`params.chanson` de Musique, `bpm` et `keyscale`
d'ODIO), sinon ceux de la chanson d'où vient une piste séparée. Un son sans recette (un
import, un mixage) : la page mesure son tempo elle-même, par le détecteur d'ODIO
(musique/tempo.js, essayé par server/tools/music_tempo.py), et l'envoie (`tempos`) ;
sa tonalité reste inconnue — aucun détecteur de tonalité au portail (non documenté).
"""

from __future__ import annotations

import math
import re
import threading
import time
from pathlib import Path

from core import auth, library
from core.http import HttpError

TOOL = "chanson"
KIND = "playlist"
PID = re.compile(r"pla-\d{8}-\d{6}-[0-9a-f]{4}")
MSP = re.compile(r"msp-[A-Za-z0-9_-]{1,60}")      # un Space de Musique (étude § 2 : `music_space`, `msp-…`)
MON = "mon"                                         # « Mon Space », le Space par défaut (la branche des Spaces)
MAX_TRACKS = 500
TITLE_MAX, ARTIST_MAX, YEAR_MAX, DESC_MAX = 200, 120, 16, 4000
TRACK_MAX = {"title": 200, "credits": 1000, "lyrics": 20000, "lrc": 60000}
TRACK_KEYS = ("item", *TRACK_MAX)
TRANSITIONS = ("gapless", "crossfade", "single")   # sans blanc, fondu enchaîné, un seul fichier continu (étude § 3.6)
XFADE_MAX = 6.0                                     # le fondu : de 0 à 6 s (étude § 3.6)
XFADE_DEFAULT = 3.0
DEFAULT_TITLE = "Nouvelle playlist"
FOLDER = "Musique"                                  # le dossier de ce que fait l'app (chanson.py, _store)
REPO = Path(__file__).resolve().parents[2]
LRC_PAGE = REPO / "commun" / "lrc.js"               # l'éditeur des paroles calées (la branche « paroles »)
SPACES_PAGE = REPO / "chanson" / "spaces.js"        # les Spaces de la page (la branche des Spaces : spaceCourant())
ZIP_ROUTE = "/api/ecoute/{id}/zip"                  # l'export .zip (la branche « écoute »)

_lock = threading.RLock()
_app = None                                          # l'App, pour savoir quelles routes existent (options)


# ── l'objet ─────────────────────────────────────────────────
def blank() -> dict:
    """Le champ `playlist` d'une playlist neuve. Le téléchargement n'est permis que si
    on l'autorise (étude § 4, « le bouton Télécharger seulement si on l'autorise »)."""
    return {"artist": "", "year": "", "description": "", "cover": None, "tracks": [],
            "transition": {"mode": "gapless", "crossfade_s": XFADE_DEFAULT}, "download": False}


def _text(v, hi: int, what: str) -> str:
    if v is None:
        return ""
    if not isinstance(v, str):
        raise ValueError(f"{what} : un texte")
    v = v.strip()
    if len(v) > hi:
        raise ValueError(f"{what} : {hi} signes au plus")
    return v


def _track(raw, k: int, had: set[str]) -> dict:
    """Une piste jugée. Un son déjà dans la playlist reste, même parti à la corbeille
    entre-temps (la page le dit absent ; réordonner ne casse rien) ; un son NEUF doit
    être un son de la bibliothèque, ici."""
    t = {"item": raw} if isinstance(raw, str) else raw
    if not isinstance(t, dict):
        raise ValueError(f"morceau {k + 1} : un identifiant de son, ou {{item, title?, credits?, lyrics?, lrc?}}")
    bad = [x for x in t if x not in TRACK_KEYS]
    if bad:
        raise ValueError(f"morceau {k + 1} : champ inconnu « {bad[0]} » ({', '.join(TRACK_KEYS)})")
    iid = t.get("item")
    if not isinstance(iid, str) or not library.ID_RE.fullmatch(iid):
        raise ValueError(f"morceau {k + 1} : un identifiant de son de la bibliothèque")
    if iid not in had:
        it = library.get(iid)
        if not it:
            raise ValueError(f"morceau {k + 1} : {iid} n'est pas dans la bibliothèque de ce Workspace")
        if it.get("kind") != "audio":
            raise ValueError(f"morceau {k + 1} : « {it.get('title') or iid} » n'est pas un son "
                             f"({it.get('kind')}) — une playlist ne prend que des sons")
    out = {"item": iid}
    for key, hi in TRACK_MAX.items():
        v = _text(t.get(key), hi, f"morceau {k + 1}, {key}")
        if v:
            out[key] = v
    return out


def clean(d: dict, cur: dict | None = None) -> dict:
    """Le champ `playlist` après une réécriture : `d` donne les champs à changer, les
    autres restent ceux de `cur`. ValueError (400) qui dit pourquoi : une valeur hors
    bornes est refusée, pas corrigée."""
    if not isinstance(d, dict):
        raise ValueError("playlist : un objet")
    bad = [k for k in d if k not in blank()]
    if bad:
        raise ValueError(f"playlist : champ inconnu « {bad[0]} » ({', '.join(blank())})")
    out = {**blank(), **(cur or {})}
    if "artist" in d:
        out["artist"] = _text(d["artist"], ARTIST_MAX, "artiste")
    if "year" in d:
        y = d["year"]
        out["year"] = _text(str(y) if isinstance(y, int) and not isinstance(y, bool) else y, YEAR_MAX, "année")
    if "description" in d:
        out["description"] = _text(d["description"], DESC_MAX, "description")
    if "tracks" in d:
        tr = d["tracks"]
        if not isinstance(tr, list) or len(tr) > MAX_TRACKS:
            raise ValueError(f"morceaux : une liste de {MAX_TRACKS} au plus")
        had = {t["item"] for t in (cur or {}).get("tracks") or []}
        out["tracks"] = [_track(t, k, had) for k, t in enumerate(tr)]
    if "cover" in d:
        c = d["cover"]
        if c in (None, ""):
            out["cover"] = None
        elif not isinstance(c, str) or not library.ID_RE.fullmatch(c):
            raise ValueError("pochette : l'identifiant d'une image de la bibliothèque, ou rien (la mosaïque)")
        elif c != (cur or {}).get("cover"):
            it = library.get(c)
            if not it or it.get("kind") != "image":
                raise ValueError("pochette : une image de la bibliothèque de ce Workspace")
            out["cover"] = c
    if "transition" in d:
        tr = d["transition"]
        if not isinstance(tr, dict) or [k for k in tr if k not in ("mode", "crossfade_s")]:
            raise ValueError("enchaînement : {mode, crossfade_s}")
        mode = tr.get("mode", out["transition"]["mode"])
        if mode not in TRANSITIONS:
            raise ValueError(f"enchaînement : {', '.join(TRANSITIONS)}")
        xf = tr.get("crossfade_s", out["transition"]["crossfade_s"])
        if isinstance(xf, bool) or not isinstance(xf, (int, float)) or xf != xf or not 0 <= xf <= XFADE_MAX:
            raise ValueError(f"fondu : de 0 à {XFADE_MAX:g} secondes")
        out["transition"] = {"mode": mode, "crossfade_s": round(float(xf), 1)}
    if "download" in d:
        if not isinstance(d["download"], bool):
            raise ValueError("téléchargement : vrai ou faux")
        out["download"] = d["download"]
    return out


def _cover_files(it: dict, cover: str | None) -> dict:
    """La vignette et les copies d'affichage d'une playlist : celles de sa pochette
    (library.make_thumb, build_views : de nouvelles adresses versionnées à chaque
    pochette) ; sans pochette, aucune — la page peint la mosaïque."""
    d = library.folder_of(it["id"])
    for p in [d / "thumb.jpg", *d.glob("view-*.webp")]:
        p.unlink(missing_ok=True)
    out = {"thumb": None, "views": None, "views_v": None}
    img = library.get(cover) if cover else None
    if img and img.get("file"):
        src = library.path_of(img)
        if library.make_thumb(src, d / "thumb.jpg", "image"):
            out["thumb"] = "thumb.jpg"
        out["views"], out["views_v"] = library.build_views("image", src, d), library._views_v()
    return out


def _sync(it: dict, pl: dict, cover_changed: bool) -> None:
    """Ce qui suit la liste dans item.json : la durée (les morceaux présents), la
    lignée (les sons, une fois chacun), la vignette (la pochette)."""
    total = 0.0
    for t in pl["tracks"]:
        a = library.get(t["item"])
        total += float((a or {}).get("duration") or 0)
    it["duration"] = round(total, 3)
    it["parents"] = list(dict.fromkeys(t["item"] for t in pl["tracks"]))
    if cover_changed:
        for k, v in _cover_files(it, pl["cover"]).items():
            if v is None:
                it.pop(k, None)
            else:
                it[k] = v


def create(d: dict) -> dict:
    """Une playlist neuve, dans le Workspace de la requête (403 si l'on n'y crée pas) et
    le Space courant de la page (`music_space` ; null : le Space par défaut)."""
    if not isinstance(d, dict):
        raise ValueError("la demande est un objet")
    library._load()
    title = _text(d.get("title"), TITLE_MAX, "titre") or DEFAULT_TITLE
    msp = birth_space(d.get("music_space"))
    raw = dict(d.get("playlist") or {})
    if "tracks" in d:
        raw["tracks"] = d["tracks"]
    pl = clean(raw)
    origin = library._owned({"tool": TOOL})
    space = library.new_space(origin)                # avant d'écrire quoi que ce soit (403)
    pid = library.new_id(KIND)
    while pid in library._items or library.folder_of(pid).exists():
        pid = library.new_id(KIND)
    library.folder_of(pid).mkdir(parents=True)
    now = library.now()
    it = {"id": pid, "kind": KIND, "title": title, "created": now, "updated": now, "rev": 1,
          "origin": origin, "space": space, "music_space": msp, "prompt": "", "params": {},
          "parents": [], "tags": ["musique", "playlist"], "folder": FOLDER, "fav": False, "playlist": pl}
    _sync(it, pl, bool(pl["cover"]))
    with library._lock:
        library._items[pid] = it
        library._save(it)
    return it


def birth_space(v) -> str | None:
    """Le Space où naît la playlist : null pour « Mon Space » (null, "" ou « mon »), sinon
    un Space du Workspace. La branche des Spaces juge un Space vivant et ouvert
    (`chanson.creatable_space`, ValueError qui dit pourquoi) ; sans elle, la forme seule."""
    if v in (None, "", MON):
        return None
    try:
        from tools import chanson
        judge = getattr(chanson, "creatable_space", None)
    except ImportError:
        judge = None
    if judge:
        return judge(v) or None
    if not (isinstance(v, str) and MSP.fullmatch(v)):
        raise ValueError("Space : « mon » ou un identifiant msp-…")
    return v


def _item(pid: str) -> dict:
    """La playlist du Workspace courant, ou 404 (on ne dit pas qu'un objet invisible existe)."""
    if not PID.fullmatch(pid or ""):
        raise HttpError(400, "identifiant de playlist invalide")
    it = library.get(pid)
    if not it or it.get("kind") != KIND:
        raise HttpError(404, f"playlist introuvable : {pid}")
    return it


def rewrite(pid: str, d: dict) -> dict:
    """Réécrire une playlist : le titre, et les champs donnés de `playlist`. `base_rev` :
    la version que la page avait ; si elle a bougé entre-temps (un autre onglet, un
    ami du Workspace), on refuse (409) plutôt que d'écraser en silence."""
    if not isinstance(d, dict):
        raise ValueError("la demande est un objet")
    bad = [k for k in d if k not in ("base_rev", "title", "playlist")]
    if bad:
        raise ValueError(f"champ inconnu « {bad[0]} » (title, playlist, base_rev)")
    with _lock:
        it = _item(pid)
        library.check_write(it)                      # 403 qui dit pourquoi
        base = d.get("base_rev")
        if base is not None and (isinstance(base, bool) or not isinstance(base, int) or base != int(it.get("rev") or 1)):
            raise HttpError(409, "cette playlist a été modifiée ailleurs (un autre onglet ?) : elle se recharge")
        cur = it.get("playlist") or blank()
        pl = clean(d.get("playlist") or {}, cur)
        title = _text(d["title"], TITLE_MAX, "titre") if "title" in d else it.get("title")
        if not title:
            raise ValueError("un titre, s'il vous plaît")
        new = {**it, "title": title, "playlist": pl, "updated": library.now(), "rev": int(it.get("rev") or 1) + 1}
        _sync(new, pl, pl["cover"] != cur.get("cover"))
        with library._lock:
            if library._items.get(pid) is not it:    # jeté pendant qu'on réécrivait
                raise HttpError(404, f"playlist introuvable : {pid}")
            library._items[pid] = new
            library._save(new)
        return new


# ── le tempo et la tonalité d'un son ────────────────────────
PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
ACC = {"#": 1, "♯": 1, "b": -1, "♭": -1, "": 0}
MAJOR = ("", "maj", "major", "ion", "ionian", "mix", "mixolydian", "lyd", "lydian")
MINOR = ("m", "min", "minor", "aeo", "aeolian", "dor", "dorian", "phr", "phrygian", "loc", "locrian")
KEY_RX = re.compile(r"\s*([A-Ga-g])([#♯b♭]?)\s*([A-Za-z]*)\s*$")
BPM_MIN, BPM_MAX = 20.0, 300.0


def key_of(text) -> dict | None:
    """« F minor » (ACE-Step), « F#m », « Bb », « Dmix » (K: d'une partition ABC) →
    {tonic: 0-11, mode: major | minor, label: « F#m »} ; un mode d'église compte pour
    sa tierce (dorien, phrygien, locrien : mineur ; mixolydien, lydien : majeur)."""
    m = KEY_RX.match(text or "") if isinstance(text, str) else None
    if not m:
        return None
    mode = m.group(3).lower()
    if mode not in MAJOR and mode not in MINOR:
        return None
    minor = mode in MINOR
    acc = {"♯": "#", "♭": "b"}.get(m.group(2), m.group(2))
    return {"tonic": (PC[m.group(1).upper()] + ACC[m.group(2)]) % 12, "mode": "minor" if minor else "major",
            "label": m.group(1).upper() + acc + ("m" if minor else "")}


def _bpm(v) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return round(x, 2) if BPM_MIN <= x <= BPM_MAX else None


def track_meta(it: dict | None, _depth: int = 0) -> dict:
    """{bpm, key, src} d'un son : sa partition (Q:, K: — ce que YuE2 a chanté), sinon sa
    recette (Musique : `params.chanson` ; ODIO : `bpm`, `keyscale`, ou `values` d'une
    région générée), sinon la chanson d'où vient une piste séparée (`params.src` : une
    piste a le tempo et la tonalité de sa chanson). Rien de connu : None, jamais un
    défaut (120 n'est pas une mesure)."""
    p = (it or {}).get("params") or {}
    score = p.get("score") if isinstance(p.get("score"), str) else ""
    q = re.search(r"^Q:\s*(?:\d+/\d+\s*=\s*)?(\d+(?:\.\d+)?)", score, re.M)
    k = re.search(r"^K:\s*(\S+)", score, re.M)
    rec = p.get("chanson") if isinstance(p.get("chanson"), dict) else {}
    vals = p.get("values") if isinstance(p.get("values"), dict) else {}
    bpm = _bpm(q.group(1)) if q else None
    key = key_of(k.group(1)) if k else None
    src = "partition" if bpm or key else ""
    for b, kk in ((rec.get("bpm"), rec.get("key")), (p.get("bpm"), p.get("keyscale")), (vals.get("bpm"), vals.get("keyscale"))):
        if bpm is None and _bpm(b):
            bpm, src = _bpm(b), src or "recette"
        if key is None and key_of(kk):
            key, src = key_of(kk), src or "recette"
    if bpm is None and key is None and p.get("stem") and isinstance(p.get("src"), str) and _depth == 0:
        m = track_meta(library.get(p["src"]), 1)
        if m["bpm"] or m["key"]:
            return {**m, "src": "chanson d'origine"}
    return {"bpm": bpm, "key": key, "src": src}


# ── « Proposer un ordre » ───────────────────────────────────
# Deux règles, celles de l'étude (§ 3.3) :
#  - des tonalités voisines sur le cycle des quintes : la même tonalité, une quinte
#    au-dessus ou au-dessous, la relative (la majeure et sa mineure, même armure) sont
#    voisines ; c'est la règle du « mixage harmonique » des DJ (la roue Camelot : un
#    cran autour du cercle, ou la même case de l'autre anneau). La distance entre deux
#    tonalités = les quintes qui séparent leurs armures, plus 1 si le mode change ;
#  - un tempo qui monte puis redescend : un arc, les plus lents aux deux bouts, le plus
#    rapide au sommet, placé aux deux tiers (PEAK — notre choix : on monte plus
#    longtemps qu'on ne redescend ; aucune source ne le fixe).
# La méthode, juste par construction : l'arc d'abord (le tempo rangé par quantiles sur
# la forme de l'arc), puis des échanges de deux morceaux tant qu'ils baissent le coût
# total (chaque enchaînement éloigné coûte, chaque écart à l'arc aussi, W_TEMPO par
# octave d'écart) ; un morceau dont le tempo reste inconnu garde sa place.
PEAK = 2 / 3
W_TEMPO = 6.0          # le coût d'une octave d'écart à l'arc : 10 % de tempo ≈ 0,8 (un peu moins qu'un enchaînement éloigné d'un cran)
UNKNOWN_KEY = 0.5      # un enchaînement dont une tonalité est inconnue : ni bon ni mauvais
MAX_ROUNDS = 10        # des tours d'échanges : 10 par morceau au plus (en pratique, quelques-uns)
BEST_MAX = 60          # jusque-là, le meilleur échange à chaque tour (60 morceaux : ~0,5 s mesuré)


def fifths(key: dict) -> int:
    """La place d'une tonalité sur le cycle des quintes (do majeur = la mineur = 0)."""
    return ((key["tonic"] + (3 if key["mode"] == "minor" else 0)) * 7) % 12


def key_distance(a: dict | None, b: dict | None) -> int | None:
    if not a or not b:
        return None
    f = abs(fifths(a) - fifths(b)) % 12
    return min(f, 12 - f) + (1 if a["mode"] != b["mode"] else 0)


def relation(a: dict | None, b: dict | None) -> str:
    """L'enchaînement de deux tonalités, en mots."""
    d = key_distance(a, b)
    if d is None:
        return "tonalité inconnue"
    if d == 0:
        return "même tonalité"
    f = min(abs(fifths(a) - fifths(b)) % 12, 12 - abs(fifths(a) - fifths(b)) % 12)
    if f == 0:
        return "relative"
    if d == 1:
        return "quinte voisine"
    return f"{f} quinte{'s' if f > 1 else ''}" + (", autre mode" if a["mode"] != b["mode"] else "")


def voisines(a: dict | None, b: dict | None) -> bool:
    """Deux tonalités voisines : la même, une quinte, la relative (un cran de la roue)."""
    d = key_distance(a, b)
    return d is not None and d <= 1


def _key_cost(a: dict | None, b: dict | None) -> float:
    d = key_distance(a, b)
    return UNKNOWN_KEY if d is None else max(0, d - 1)


def arch_targets(tempos: list[float], peak: float = PEAK) -> list[float]:
    """Le tempo voulu à chaque place (k places) : les tempos donnés, rangés sur l'arc —
    la place la plus basse de l'arc reçoit le plus lent ; à hauteur égale, la plus tôt."""
    k = len(tempos)
    if k == 1:
        return list(tempos)
    u = []
    for j in range(k):
        x = j / (k - 1)
        u.append(round(x / peak if x <= peak else (1 - x) / (1 - peak), 9))   # arrondi : deux places à même hauteur sont égales
    places = sorted(range(k), key=lambda j: (u[j], j))
    out = [0.0] * k
    for j, t in zip(places, sorted(tempos)):
        out[j] = t
    return out


def propose(metas: list[dict], peak: float = PEAK) -> dict:
    """L'ordre proposé pour des morceaux ({bpm, key}, dans l'ordre actuel) : `order`, les
    places d'avant dans l'ordre nouveau ; `cost` avant et après. Les morceaux sans tempo
    ne bougent pas ; les autres prennent leurs places sur l'arc, puis s'échangent deux à
    deux tant que le coût baisse."""
    n = len(metas)
    slots = [i for i in range(n) if metas[i].get("bpm")]
    seq = list(range(n))
    if len(slots) < 2:
        return {"order": seq, "cost": [0.0, 0.0], "moved": 0}
    by_tempo = sorted(slots, key=lambda i: (metas[i]["bpm"], i))
    target = dict(zip(slots, arch_targets([metas[i]["bpm"] for i in slots], peak)))
    # la première pose : le plus lent à la place la plus basse de l'arc (même rang que arch_targets)
    want = sorted(slots, key=lambda p: (target[p], p))
    for p, i in zip(want, by_tempo):
        seq[p] = i

    def tcost(i: int, p: int) -> float:
        return W_TEMPO * abs(math.log2(metas[i]["bpm"] / target[p]))

    def kcost(p: int) -> float:              # l'enchaînement p → p + 1
        return _key_cost(metas[seq[p]].get("key"), metas[seq[p + 1]].get("key"))

    def total() -> float:
        return sum(kcost(p) for p in range(n - 1)) + sum(tcost(seq[p], p) for p in slots)

    def local(a: int, b: int) -> float:
        edges = {e for e in (a - 1, a, b - 1, b) if 0 <= e < n - 1}
        return sum(kcost(e) for e in edges) + tcost(seq[a], a) + tcost(seq[b], b)

    before_seq = list(range(n))
    before = (sum(_key_cost(metas[p].get("key"), metas[p + 1].get("key")) for p in range(n - 1))
              + sum(W_TEMPO * abs(math.log2(metas[p]["bpm"] / target[p])) for p in slots))
    # le meilleur échange à chaque tour : le premier qui améliore s'enferme vite dans un creux
    # (essayé sur quatre morceaux : il laissait C → F# en tête). Au-delà de BEST_MAX morceaux, le
    # premier qui améliore, balayage après balayage, pour rester sous la seconde.
    best = len(slots) <= BEST_MAX
    for _ in range(MAX_ROUNDS * len(slots)):
        gain, pick, done = 1e-9, None, 0
        for x in range(len(slots)):
            for y in range(x + 1, len(slots)):
                a, b = slots[x], slots[y]
                c0 = local(a, b)
                seq[a], seq[b] = seq[b], seq[a]
                g = c0 - local(a, b)
                if not best and g > 1e-9:
                    done += 1                     # gardé tout de suite
                    continue
                seq[a], seq[b] = seq[b], seq[a]
                if g > gain:
                    gain, pick = g, (a, b)
        if best and pick:
            a, b = pick
            seq[a], seq[b] = seq[b], seq[a]
        elif not done:
            break
    after = total()
    if after >= before - 1e-9:                     # l'ordre d'avant tenait déjà aussi bien : rien à proposer
        seq, after = before_seq, before
    return {"order": seq, "cost": [round(before, 3), round(after, 3)],
            "moved": sum(1 for p in range(n) if seq[p] != before_seq[p])}


# ── les routes ──────────────────────────────────────────────
def _public(it: dict) -> dict:
    out = library.public(it)
    out.setdefault("music_space", None)
    return out


def _route_exists(method: str, path: str) -> bool:
    return any(m == method and rx.match(path) for m, rx, _ in (_app.routes if _app else []))


def options(req=None) -> dict:
    """Ce que la page peut faire ici : l'export .zip (la route de la branche « écoute »
    est-elle dans ce portail ?) et les paroles calées (l'éditeur de la branche
    « paroles » est-il servi ?). Une action absente dit pourquoi."""
    zip_ok = _route_exists("POST", ZIP_ROUTE.format(id="pla-20260101-000000-0000"))
    lrc_ok = LRC_PAGE.is_file()
    spaces_ok = SPACES_PAGE.is_file()
    return {"zip": {"ready": zip_ok, "route": ZIP_ROUTE,
                    "why": "" if zip_ok else "l'export .zip arrive avec le lecteur d'écoute (POST /api/ecoute/<id>/zip) : "
                                             "il n'est pas encore dans ce portail"},
            "lrc": {"ready": lrc_ok, "module": "commun/lrc.js",
                    "why": "" if lrc_ok else "l'éditeur des paroles calées (commun/lrc.js) arrive avec les paroles calées : "
                                             "il n'est pas encore dans ce portail"},
            "spaces": spaces_ok,   # la page lit alors le Space courant par chanson/spaces.js
            "transitions": list(TRANSITIONS), "crossfade_max": XFADE_MAX, "max_tracks": MAX_TRACKS,
            "peak": round(PEAK, 3), "bpm": [BPM_MIN, BPM_MAX]}


def api_options(req):
    return options(req)


def api_list(req):
    """Les playlists du Workspace, les plus récemment touchées d'abord ; `music_space` :
    celles d'un Space (« default » : le Space par défaut), sinon toutes."""
    want = req.q("music_space")
    out = []
    for it in library.query([KIND], sort="updated", limit=10 ** 6)["items"]:
        msp = it.get("music_space")
        if want and not ((want in ("default", MON) and not msp) or want == msp):
            continue
        pl = it.get("playlist") or {}
        out.append({"id": it["id"], "title": it.get("title", ""), "music_space": msp, "updated": it.get("updated"),
                    "tracks": len(pl.get("tracks") or []), "duration": it.get("duration") or 0,
                    "thumb_url": it.get("thumb_url"), "owner": it.get("owner")})
    return {"playlists": out}


def api_create(req):
    try:
        it = create(req.json())
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    return detail(it)


def detail(it: dict) -> dict:
    """L'objet, et ce que la page en montre sans autre requête : ses sons (`items`),
    ceux qui manquent (à la corbeille, ou d'ailleurs), le tempo et la tonalité de
    chacun (`metas`)."""
    items, missing, metas = {}, [], {}
    for t in (it.get("playlist") or {}).get("tracks") or []:
        iid = t["item"]
        if iid in items or iid in missing:
            continue
        a = library.get(iid)
        if a and a.get("kind") == "audio":
            items[iid] = library.public(a)
            m = track_meta(a)
            metas[iid] = {"bpm": m["bpm"], "key": m["key"]["label"] if m["key"] else None, "src": m["src"]}
        else:
            missing.append(iid)
    return {**_public(it), "items": items, "missing": missing, "metas": metas}


def api_get(req, pid):
    return detail(_item(pid))


def api_rewrite(req, pid):
    try:
        it = rewrite(pid, req.json())
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    return detail(it)


def api_order(req, pid):
    """« Proposer un ordre » : rien n'est écrit. `tempos` : ceux que la page a mesurés
    ({id du son: BPM}) pour les sons dont la recette ne dit rien ; le serveur garde les
    siens (la partition, la recette) quand il les a."""
    it = _item(pid)
    d = req.json() or {}
    tempos = d.get("tempos") or {}
    if not isinstance(tempos, dict) or len(tempos) > MAX_TRACKS:
        raise HttpError(400, "tempos : {id du son: BPM}")
    for k, v in tempos.items():
        if not library.ID_RE.fullmatch(str(k)) or _bpm(v) is None:
            raise HttpError(400, f"tempo de {k} : de {BPM_MIN:g} à {BPM_MAX:g} BPM")
    tracks = (it.get("playlist") or {}).get("tracks") or []
    metas = []
    for t in tracks:
        m = track_meta(library.get(t["item"]))
        if m["bpm"] is None and t["item"] in tempos:
            m = {**m, "bpm": _bpm(tempos[t["item"]]), "src": m["src"] or "mesuré"}
        metas.append(m)
    known_t = sum(1 for m in metas if m["bpm"])
    if known_t < 2:
        raise HttpError(409, "rien à proposer : il faut le tempo d'au moins deux morceaux "
                             f"({known_t} connu{'s' if known_t > 1 else ''} sur {len(tracks)})")
    r = propose(metas)
    order = r["order"]
    rows = []
    for p, i in enumerate(order):
        m = metas[i]
        prev = metas[order[p - 1]] if p else None
        rows.append({"from": i, "item": tracks[i]["item"], "bpm": m["bpm"], "key": m["key"]["label"] if m["key"] else None,
                     "src": m["src"], "link": relation(prev["key"], m["key"]) if prev else "",
                     "near": bool(prev) and voisines(prev["key"], m["key"])})
    near = sum(1 for x in rows[1:] if x["near"])
    keyed = sum(1 for p in range(1, len(order)) if metas[order[p - 1]]["key"] and metas[order[p]]["key"])
    bpms = [x["bpm"] for x in rows if x["bpm"]]
    top = max(range(len(rows)), key=lambda p: rows[p]["bpm"] or 0)
    return {"order": order, "rows": rows, "changed": order != list(range(len(order))), "moved": r["moved"],
            "cost": r["cost"], "base_rev": it.get("rev") or 1,
            "resume": {"near": near, "keyed": keyed, "edges": max(0, len(order) - 1), "bpm_lo": min(bpms), "bpm_hi": max(bpms),
                       "peak": top + 1, "unknown_tempo": len(order) - known_t}}


def register(app) -> None:
    global _app
    _app = app
    app.route("GET", "/api/playlist/options", api_options)
    app.route("GET", "/api/playlist", api_list)
    app.route("POST", "/api/playlist", api_create)
    app.route("GET", "/api/playlist/{pid}", api_get)
    app.route("POST", "/api/playlist/{pid}", api_rewrite)
    app.route("POST", "/api/playlist/{pid}/ordre", api_order)


# ── le contrôle sans GPU (tools/check.py) ───────────────────
def _wav(seconds: float, freq: float = 440.0) -> bytes:
    """Un WAV 16 bits mono de 8 kHz : un son quelconque pour la bibliothèque."""
    import io
    import struct
    import wave
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * freq * i / 8000)))
                               for i in range(int(seconds * 8000))))
    return b.getvalue()


def selftest(call, ok) -> None:
    ok(KIND in library.KINDS and library.new_id(KIND).startswith("pla-"), "playlist : une sorte de la bibliothèque, id pla-…")
    st, o = call("GET", "/api/playlist/options")
    ok(st == 200 and o.get("transitions") == list(TRANSITIONS) and o.get("crossfade_max") == XFADE_MAX
       and isinstance(o.get("zip", {}).get("ready"), bool) and (o["zip"]["ready"] or o["zip"]["why"])
       and (o.get("lrc", {}).get("ready") or o.get("lrc", {}).get("why")),
       f"playlist : les options disent l'export .zip et les paroles calées, présents ou pourquoi absents ({st})")
    sons = []
    for k, (sec, f) in enumerate(((2.0, 220), (3.0, 330), (1.5, 440), (2.5, 550))):
        st, it = call("PUT", f"/api/library/upload?name=pl{k}.wav&title=Morceau%20{k + 1}", raw=_wav(sec, f))
        sons.append(it if st == 200 else {})
    ok(all(s.get("kind") == "audio" for s in sons), "playlist : quatre sons dans la bibliothèque")
    if not all(s.get("id") for s in sons):
        return
    ids = [s["id"] for s in sons]
    st, img = call("PUT", "/api/library/upload?name=pochette.png&title=Pochette", raw=_png())
    st, im2 = call("PUT", "/api/library/upload?name=pochette2.png&title=Pochette%202", raw=_png((40, 120, 200)))

    # créer : dans le Space courant, avec des sons, le contrat du champ `playlist` ; avec la branche des
    # Spaces, un Space vivant du Workspace (créé ici par sa route), sinon la forme msp-… suffit
    msp = "msp-0123456789ab"
    try:
        from tools import chanson
        if getattr(chanson, "creatable_space", None):
            st, sp = call("POST", "/api/chanson/spaces", {"name": f"Essai playlists {int(time.time() * 1000) % 100000}"})
            msp = sp.get("id", msp) if st == 200 else msp
    except ImportError:
        pass
    st, p = call("POST", "/api/playlist", {"title": "Album été", "music_space": msp, "tracks": ids[:2]})
    pid = p.get("id", "") if isinstance(p, dict) else ""
    pl = p.get("playlist", {}) if isinstance(p, dict) else {}
    ok(st == 200 and PID.fullmatch(pid) and p["kind"] == KIND and p["music_space"] == msp and p.get("space")
       and p["origin"]["tool"] == TOOL and p["folder"] == FOLDER and p["rev"] == 1
       and set(pl) == {"artist", "year", "description", "cover", "tracks", "transition", "download"}
       and pl["tracks"] == [{"item": ids[0]}, {"item": ids[1]}] and pl["cover"] is None and pl["download"] is False
       and pl["transition"] == {"mode": "gapless", "crossfade_s": XFADE_DEFAULT},
       f"créer : une playlist, son Space, ses deux morceaux, le contrat ({st} {str(p)[:200]})")
    if not pid:
        return
    ok(abs(p.get("duration", 0) - 5.0) < 0.1 and p.get("parents") == ids[:2] and set(p.get("items", {})) == set(ids[:2])
       and p.get("missing") == [] and set(p.get("metas", {})) == set(ids[:2]),
       f"créer : la durée totale, la lignée, les sons et leurs métas ({p.get('duration')})")
    st, lp = call("GET", f"/api/library/{pid}")
    ok(st == 200 and lp.get("kind") == KIND and lp.get("playlist") == pl and lp.get("music_space") == msp
       and "url" not in lp, "lire : GET /api/library/<id> rend l'objet et son champ `playlist`, sans fichier")
    st, p0 = call("POST", "/api/playlist", {})
    ok(st == 200 and p0.get("title") == DEFAULT_TITLE and p0.get("music_space") is None and p0["playlist"]["tracks"] == [],
       f"créer sans rien : un titre par défaut, le Space par défaut (null) ({st})")

    # réécrire : titre, infos, morceaux (ajout, ordre, surcharges), enchaînement, pochette
    body = {"base_rev": 1, "title": "Album été 2026",
            "playlist": {"artist": "Cal", "year": "2026", "description": "des chansons d'été, lentes puis vives",
                         "tracks": [ids[2], {"item": ids[0], "title": "Ouverture", "credits": "Cal · voix"}, ids[1],
                                    {"item": ids[3], "lrc": "[00:00.50]la nuit\n[00:01.20]tombe"}],
                         "transition": {"mode": "crossfade", "crossfade_s": 4}, "download": True, "cover": img["id"]}}
    st, p2 = call("POST", f"/api/playlist/{pid}", body)
    pl2 = p2.get("playlist", {}) if isinstance(p2, dict) else {}
    ok(st == 200 and p2["title"] == "Album été 2026" and p2["rev"] == 2 and pl2["artist"] == "Cal" and pl2["year"] == "2026"
       and [t["item"] for t in pl2["tracks"]] == [ids[2], ids[0], ids[1], ids[3]] and pl2["tracks"][1]["title"] == "Ouverture"
       and pl2["tracks"][3]["lrc"].startswith("[00:00.50]") and pl2["transition"] == {"mode": "crossfade", "crossfade_s": 4.0}
       and pl2["download"] is True and pl2["cover"] == img["id"],
       f"réécrire : titre, artiste, année, l'ordre, les surcharges d'une piste, le fondu, la pochette ({st} {str(p2)[:160]})")
    ok(abs(p2.get("duration", 0) - 9.0) < 0.1 and p2.get("parents") == [ids[2], ids[0], ids[1], ids[3]]
       and p2.get("thumb_url", "").split("?")[0].endswith("thumb.jpg") and p2.get("views"),
       f"réécrire : la durée suit, la vignette et les copies d'affichage sont celles de la pochette ({p2.get('duration')})")
    v1 = dict(p2.get("view_urls") or {})
    st, p3 = call("POST", f"/api/playlist/{pid}", {"base_rev": 2, "playlist": {"cover": im2["id"]}})
    ok(st == 200 and p3["playlist"]["cover"] == im2["id"] and p3.get("view_urls") and p3["view_urls"] != v1
       and p3["playlist"]["tracks"] == pl2["tracks"] and p3["title"] == "Album été 2026",
       "une autre pochette : d'autres adresses de copies (le cache du navigateur ne ment pas), le reste intact")
    st, p4 = call("POST", f"/api/playlist/{pid}", {"base_rev": 3, "playlist": {"cover": None}})
    ok(st == 200 and p4["playlist"]["cover"] is None and not p4.get("thumb_url") and not p4.get("views")
       and not (library.folder_of(pid) / "thumb.jpg").exists(),
       "sans pochette : ni vignette ni copie (la page peint la mosaïque)")
    st, bad = call("POST", f"/api/playlist/{pid}", {"base_rev": 1, "title": "x"})
    ok(st == 409 and "ailleurs" in bad.get("error", ""), f"une version périmée (un autre onglet) : refusée, 409 ({st})")
    for b, why in (({"playlist": {"tracks": [pid]}}, "une playlist dans une playlist"),
                   ({"playlist": {"tracks": [img["id"]]}}, "une image comme morceau"),
                   ({"playlist": {"tracks": ["aud-20260101-000000-dead"]}}, "un son absent"),
                   ({"playlist": {"tracks": [{"item": ids[0], "bpm": 120}]}}, "un champ hors contrat dans une piste"),
                   ({"playlist": {"transition": {"mode": "crossfade", "crossfade_s": 7}}}, "un fondu de 7 s"),
                   ({"playlist": {"transition": {"mode": "fondu"}}}, "un enchaînement inconnu"),
                   ({"playlist": {"download": "oui"}}, "télécharger : ni vrai ni faux"),
                   ({"playlist": {"cover": ids[0]}}, "un son en pochette"),
                   ({"playlist": {"couleur": "or"}}, "un champ inconnu"),
                   ({"title": ""}, "un titre vide"),
                   ({"playlist": {"description": "x" * (DESC_MAX + 1)}}, "une description trop longue")):
        st, r = call("POST", f"/api/playlist/{pid}", b)
        ok(st == 400 and r.get("error"), f"réécrire : refusé — {why} ({st} {r.get('error', '')[:80]})")
    st, p5 = call("GET", f"/api/playlist/{pid}")
    ok(st == 200 and p5["rev"] == 4 and p5["playlist"]["tracks"] == pl2["tracks"], "les refus n'ont rien écrit")
    st, r = call("POST", "/api/playlist", {"music_space": "mon space"})
    ok(st == 400, f"créer : un Space qui n'est pas msp-… est refusé ({st})")
    ok(birth_space("") is None and birth_space(MON) is None and birth_space(None) is None,
       "créer : « mon », vide ou null — le Space par défaut (null)")

    # un son parti à la corbeille : la playlist le garde (absent), réordonner marche encore
    st, _ = call("POST", f"/api/library/{ids[1]}/delete")
    st, p6 = call("GET", f"/api/playlist/{pid}")
    ok(st == 200 and p6["missing"] == [ids[1]] and ids[1] not in p6["items"], f"un son à la corbeille : dit absent ({p6.get('missing')})")
    rev = [t for t in reversed(p6["playlist"]["tracks"])]
    st, p7 = call("POST", f"/api/playlist/{pid}", {"base_rev": p6["rev"], "playlist": {"tracks": rev}})
    ok(st == 200 and [t["item"] for t in p7["playlist"]["tracks"]] == [t["item"] for t in rev] and abs(p7["duration"] - 6.0) < 0.1,
       f"réordonner avec un son absent : gardé à sa place, la durée sans lui ({st} {p7.get('duration') if isinstance(p7, dict) else ''})")
    st, _ = call("POST", f"/api/library/{ids[1]}/restore")

    # la recherche, la liste, le Space
    st, q = call("GET", "/api/library?kind=playlist&q=lentes%20puis")
    ok(st == 200 and [x["id"] for x in q.get("items", [])] == [pid], "la recherche trouve une playlist par sa description")
    st, ls = call("GET", f"/api/playlist?music_space={msp}")
    st2, ld = call("GET", "/api/playlist?music_space=mon")
    ok(st == 200 and [x["id"] for x in ls["playlists"]] == [pid] and ls["playlists"][0]["tracks"] == 4
       and p0["id"] in [x["id"] for x in ld["playlists"]] and pid not in [x["id"] for x in ld["playlists"]],
       "la liste : par Space (le sien, le Space par défaut)")

    # Asset : la corbeille et son retour, et rapatrier dit pourquoi pas
    st, _ = call("POST", f"/api/library/{p0['id']}/delete")
    st2, back = call("POST", f"/api/library/{p0['id']}/restore")
    ok(st == 200 and st2 == 200 and back.get("kind") == KIND and back.get("playlist", {}).get("tracks") == [],
       "corbeille et retour : comme tout objet")
    # rapatrier : une copie, avec ses sons et sa pochette (server/tools/elements.py, DOC_IMPORT ; essayé par asset.py)
    ok(library.import_refusal(library.get(pid), "esp-ailleurs") is None and KIND in library.DOC_IMPORT,
       "rapatrier une playlist : permis, ses sons et sa pochette viennent avec elle")

    # le tempo et la tonalité d'un son : la partition, la recette, la chanson d'une piste
    ok(key_of("F minor") == {"tonic": 5, "mode": "minor", "label": "Fm"} and key_of("Bb")["tonic"] == 10
       and key_of("F#m")["label"] == "F#m" and key_of("Dmix")["mode"] == "major" and key_of("Edor")["mode"] == "minor"
       and key_of("C major")["label"] == "C" and key_of("none") is None and key_of("") is None,
       "les tonalités : ACE-Step, ABC, modes d'église")
    yue = {"params": {"score": "X:1\nQ:1/4=88\nK:Fm\n", "chanson": {"model": "yue"}}}
    ace = {"params": {"chanson": {"bpm": 110, "key": "D major"}}}
    odio = {"params": {"bpm": 96, "keyscale": "A minor"}}
    region = {"params": {"values": {"bpm": 124, "keyscale": "G major"}}}
    ok(track_meta(yue) == {"bpm": 88.0, "key": key_of("Fm"), "src": "partition"}
       and track_meta(ace) == {"bpm": 110.0, "key": key_of("D major"), "src": "recette"}
       and track_meta(odio)["bpm"] == 96 and track_meta(odio)["key"]["label"] == "Am"
       and track_meta(region)["key"]["label"] == "G" and track_meta({"params": {}}) == {"bpm": None, "key": None, "src": ""},
       "le tempo et la tonalité : la partition, puis la recette (Musique, ODIO) ; rien de connu : rien d'inventé")

    # « Proposer un ordre » : l'arc du tempo, les tonalités voisines
    ok(key_distance(key_of("C"), key_of("G")) == 1 and key_distance(key_of("C"), key_of("Am")) == 1
       and key_distance(key_of("C"), key_of("C")) == 0 and key_distance(key_of("C"), key_of("F#")) == 6
       and key_distance(key_of("C"), key_of("Cm")) == 4 and relation(key_of("Am"), key_of("C")) == "relative"
       and relation(key_of("C"), key_of("F")) == "quinte voisine"
       and voisines(key_of("C"), key_of("C")) and voisines(key_of("Am"), key_of("C")) and not voisines(key_of("C"), key_of("D"))
       and not voisines(None, key_of("C")),
       "le cycle des quintes : quinte, relative, triton, parallèle")
    ok(arch_targets([90, 100, 110, 120, 130]) == [90, 110, 120, 130, 100],
       f"l'arc : lent, monte, sommet aux deux tiers, redescend ({arch_targets([90, 100, 110, 120, 130])})")
    m = [{"bpm": b, "key": None} for b in (130, 90, 120, 100, 110)]
    r = propose(m)
    ok([m[i]["bpm"] for i in r["order"]] == [90, 110, 120, 130, 100], f"sans tonalité : l'arc du tempo ({r})")
    # deux morceaux au même tempo : la tonalité tranche (C → G voisins, pas C → F#)
    m = [{"bpm": 100, "key": key_of("C")}, {"bpm": 120, "key": key_of("F#")}, {"bpm": 120, "key": key_of("G")},
         {"bpm": 110, "key": key_of("D")}]
    r = propose(m)
    seq = [m[i]["key"]["label"] for i in r["order"]]
    ok(seq[0] == "C" and r["cost"][1] <= r["cost"][0], f"les tonalités voisines départagent ({seq}, coût {r['cost']})")
    m = [{"bpm": b, "key": None} for b in (90, 110, 120, 130, 100)]
    ok(propose(m)["order"] == [0, 1, 2, 3, 4] and propose(m)["moved"] == 0, "un ordre déjà en arc : rien à proposer")
    m = [{"bpm": None, "key": None}, {"bpm": 140, "key": None}, {"bpm": None, "key": None}, {"bpm": 80, "key": None}]
    r = propose(m)
    ok(r["order"][0] == 0 and r["order"][2] == 2 and [m[i]["bpm"] for i in (r["order"][1], r["order"][3])] == [80, 140],
       f"un morceau sans tempo garde sa place ({r['order']})")
    st, od = call("POST", f"/api/playlist/{pid}/ordre", {})
    ok(st == 409 and "tempo" in od.get("error", ""), f"proposer sans aucun tempo connu : dit pourquoi ({st})")
    tr = p7["playlist"]["tracks"]
    tempos = {tr[0]["item"]: 128, tr[1]["item"]: 92, tr[2]["item"]: 110, tr[3]["item"]: 100}
    st, od = call("POST", f"/api/playlist/{pid}/ordre", {"tempos": tempos})
    got = [x["bpm"] for x in od.get("rows", [])] if isinstance(od, dict) else []
    ok(st == 200 and got == [92, 110, 128, 100] and od["changed"] and od["resume"]["bpm_hi"] == 128
       and od["resume"]["peak"] == 3 and all(x["src"] == "mesuré" for x in od["rows"]),
       f"proposer avec les tempos mesurés par la page : l'arc ({st} {got})")
    st, p8 = call("GET", f"/api/playlist/{pid}")
    ok(p8["rev"] == p7["rev"] and p8["playlist"]["tracks"] == tr, "proposer n'écrit rien : la personne garde ou annule")
    st, bad = call("POST", f"/api/playlist/{pid}/ordre", {"tempos": {tr[0]["item"]: 999}})
    ok(st == 400, f"un tempo hors bornes : refusé ({st})")

    # les droits : un lecteur du Workspace ne réécrit pas (le juge commun, library.check_write)
    ami = {"id": "ami-pl", "name": "Ami", "role": "ami", "state": "active"}
    auth.set_current(ami)
    try:
        try:
            rewrite(pid, {"title": "à moi"})
            ok(False, "un autre compte ne réécrit pas la playlist de Cal")
        except (PermissionError, HttpError):
            ok(True, "un autre compte ne réécrit pas la playlist de Cal (403 ou 404)")
    finally:
        auth.set_current(None)


def _png(color=(200, 90, 60)) -> bytes:
    import io
    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (600, 600), color).save(b, "PNG")   # assez grande pour ses copies de 256 et 512
    return b.getvalue()
