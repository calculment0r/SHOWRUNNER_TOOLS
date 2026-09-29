"""ODIO — les jouets du Playground dans un projet : leurs sortes, leurs câbles.

Les quatorze jouets du « ODIO-O1 Playground » de Cal et l'horloge sont des
modules du nodal (musique/jouets/, dont defs.js est la vérité : ce fichier
n'en garde que les sortes et leurs ports). Deux sortes de câbles s'ajoutent au
son : `t: "notes"` (des notes, d'un jouet vers un instrument ou un jouet) et
`t: "mod"` (une valeur 0..1, d'un jouet vers le réglage `k` d'un module).
Chaque réseau doit être sans boucle, comme le son.

`check(p, by_mod)` est appelé par music.validate ; `selftest` par tools/check.py.
"""
from __future__ import annotations

import json

# les quatre qu'on traverse (du son entre et sort), puis ceux qui n'ont pas de son
EFFETS = {"reel", "sprg", "mag", "alch"}
MUETS = {"fount", "pong", "sling", "ninja", "shake", "pach", "toast", "pin", "inv", "newt", "horloge"}
TYPES = EFFETS | MUETS
NOTES_OUT = {"fount", "pong", "sling", "ninja", "shake", "pach", "toast", "pin", "inv", "newt", "horloge"}
NOTES_IN = ({"fount", "pong", "sling", "sprg", "ninja", "shake", "pach", "toast", "pin", "inv", "newt"}
            | {"drums", "synth", "sampler", "rythme", "analog", "acid", "plaits"})
MOD_OUT = {"reel", "alch", "pong", "sprg", "mag", "shake", "pach", "toast", "newt"}


def _cycle(nodes, cables) -> bool:
    out = {n: [] for n in nodes}
    for c in cables:
        out[c["a"]].append(c["b"])
    state: dict = {}

    def visit(n) -> bool:
        state[n] = 1
        for m in out[n]:
            if state.get(m) == 1 or (state.get(m) is None and visit(m)):
                return True
        state[n] = 2
        return False

    return any(state.get(n) is None and visit(n) for n in nodes)


def check(p: dict, by_mod: dict) -> None:
    """Refuse ce que la page ne saurait pas jouer : un câble de son vers un
    jouet muet, un câble de notes ou de valeur entre des ports qui n'existent
    pas, une boucle dans un réseau, un chemin d'aimant hors de la scène."""
    typed = {"notes": [], "mod": []}
    for c in p.get("cables", []):
        a, b, t = by_mod[c["a"]], by_mod[c["b"]], c.get("t")
        if t is None:
            if a["type"] in MUETS or b["type"] in MUETS:
                raise ValueError("un jouet sans son ne se câble pas au son")
            continue
        if t not in typed:
            raise ValueError(f"sorte de câble inconnue : {t!r}")
        if t == "notes":
            if a["type"] not in NOTES_OUT or b["type"] not in NOTES_IN:
                raise ValueError(f"câble de notes : {a['type']} → {b['type']} n'existe pas")
        else:
            k = c.get("k")
            if a["type"] not in MOD_OUT or b["type"] == "master":
                raise ValueError(f"câble de valeur : {a['type']} → {b['type']} n'existe pas")
            if not isinstance(k, str) or not (1 <= len(k) <= 24):
                raise ValueError("câble de valeur : le réglage piloté manque")
        typed[t].append(c)
    for t, cs in typed.items():
        if _cycle(set(by_mod), cs):
            raise ValueError(f"le câblage des {'notes' if t == 'notes' else 'valeurs'} fait une boucle")
    for m in by_mod.values():
        path = m.get("path")
        if path is None:
            continue
        if m["type"] != "mag" or not isinstance(path, list) or len(path) > 512:
            raise ValueError("chemin d'aimant : une liste de 512 points au plus, sur un AIMANT")
        for pt in path:
            if (not isinstance(pt, list) or len(pt) != 2
                    or any(isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or not (0 <= v <= 1) for v in pt)):
                raise ValueError("chemin d'aimant : des points [x, y] entre 0 et 1")


# ── le contrôle sans GPU (tools/check.py) ───────────────────
def selftest(call, ok) -> None:
    st, p = call("POST", "/api/music/projects", {"name": "Jouets"})
    ok(st == 200, f"un projet pour les jouets ({st})")
    pid = p.get("id", "")
    st, got = call("GET", f"/api/music/projects/{pid}")
    src = next((m for m in got["modules"] if m.get("track") and m["type"] in NOTES_IN), None)
    ok(src is not None, "le projet a un instrument")
    base = json.loads(json.dumps(got))
    base["modules"] += [
        {"id": "jpong", "type": "pong", "track": None, "x": 0, "y": 600, "on": True, "params": {"grav": 120}},
        {"id": "jmag", "type": "mag", "track": None, "x": 600, "y": 600, "on": True, "params": {},
         "path": [[0.1, 0.2], [0.8, 0.2], [0.8, 0.8], [0.1, 0.8], [0.3, 0.5]]},
        {"id": "jfount", "type": "fount", "track": None, "x": 0, "y": 0, "on": True, "params": {}},
        {"id": "jclock", "type": "horloge", "track": None, "x": 0, "y": -200, "on": True, "params": {"div": 3}},
    ]
    base["cables"] += [
        {"a": "jpong", "b": src["id"], "t": "notes"},
        {"a": "jclock", "b": "jfount", "t": "notes"},
        {"a": "jpong", "b": "jmag", "t": "mod", "k": "force"},
        {"a": "jmag", "b": "m0"},
    ]

    def refused(mut, why, word=""):
        bad = json.loads(json.dumps(base))
        mut(bad)
        st, r = call("POST", f"/api/music/projects/{pid}", bad)
        ok(st == 400 and word in r.get("error", ""), f"jouets, refusé : {why} ({st} {r})")

    refused(lambda b: b["cables"].append({"a": src["id"], "b": "jpong"}), "le son vers un jouet muet", "jouet")
    refused(lambda b: b["cables"].append({"a": "jpong", "b": "jmag", "t": "notes"}), "des notes vers l'aimant", "notes")
    refused(lambda b: b["cables"].append({"a": "jfount", "b": "jclock", "t": "notes"}), "une horloge qui ne reçoit rien", "notes")
    refused(lambda b: b["cables"].append({"a": "jfount", "b": "jpong", "t": "notes"}) or b["cables"].append({"a": "jpong", "b": "jfount", "t": "notes"}),
            "une boucle de notes", "boucle")
    refused(lambda b: b["cables"].append({"a": "jpong", "b": "jfount", "t": "mod"}), "une valeur sans réglage", "réglage")
    refused(lambda b: b["cables"].append({"a": "jpong", "b": "jfount", "t": "lumière"}), "une sorte de câble inconnue", "sorte")
    refused(lambda b: b["modules"][-3].update(path=[[0.1, 1.4]]), "un chemin hors de la scène", "chemin")
    refused(lambda b: b["modules"].append({"id": "jx", "type": "toupie", "track": None, "x": 0, "y": 0, "params": {}}), "un jouet inconnu", "inconnu")
    st, r = call("POST", f"/api/music/projects/{pid}", base)
    ok(st == 200, f"quatre jouets, leurs câbles de notes et de valeur, un chemin d'aimant passent ({st} {r})")
    st, back = call("GET", f"/api/music/projects/{pid}")
    ok(st == 200 and sum(1 for m in back["modules"] if m["type"] in TYPES) == 4
       and next(m for m in back["modules"] if m["id"] == "jmag").get("path") == base["modules"][-3]["path"]
       and sum(1 for c in back["cables"] if c.get("t")) == 3, "ils reviennent à l'ouverture, chemin compris")
