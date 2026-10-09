"""ODIO, les banques d'échantillons : un piano, des maillets, un orgue… joués
par l'instrument « Échantillons » (musique/moteur.js, SRC.banque ; étude :
docs/etudes/odio_synthes.md § 7).

Décision 4 de l'étude (recommandée, 06/10) : VCSL (CC0) d'abord, puis
Salamander Grand Piano (CC-BY 3.0, son auteur cité). JAMAIS dans le dépôt, qui
est public, ni depuis un CDN tiers : les sons sont importés une fois sur la
machine du portail (tools/echantillons.py, que Cal lance sur DGX2) dans
`<data_dir>/echantillons/<banque>/`, et servis par le portail, à qui est
connecté. Une banque :

  banque.json   le manifeste (MANIFESTE ci-dessous) : d'où elle vient, sa
                licence, son crédit, et ses ZONES
  z0001.flac …  un fichier par zone, FLAC 16 bits à 48 kHz

Une zone est une région SFZ aplatie (la cartographie de l'auteur de la banque :
le format SFZ, lu par `lire_sfz` — VCSL publie la sienne sur sa branche `sfz`,
Salamander dans son dépôt) : ses notes (bas..haut, la note où le son est juste),
ses vélocités (vbas..vhaut, et les fondus de vélocité xfin / xfout), son tour
(seq_length / seq_position), son niveau (volume, en dB), son accord (tune en
cents, transpose), son départ (offset), sa boucle, son enveloppe (ampeg), le
suivi de vélocité (amp_veltrack). Les lois sont celles de sfizz (BSD-2,
sfztools/sfizz, src/sfizz/RegionStateful.cpp et ModifierHelpers.h) : le moteur
de la page les applique (moteur.js).

Les banques sont communes au portail (comme les polices) : elles ne sont à
aucun Workspace, et ne nomment ni personne ni projet.

  GET /api/music/banques                   {banques: [{id, nom, cat, source, licence, credit, zones, octets, decode}]}
  GET /api/music/banques/<id>              le manifeste
  GET /api/music/banques/<id>/f/<fichier>  le son d'une zone (gardé un jour par le navigateur)
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from core import config
from core.http import FileResponse, HttpError

ID_RX = re.compile(r"[a-z0-9][a-z0-9-]{0,47}")
FICHIER_RX = re.compile(r"z\d{4}\.(flac|wav)")
CATS = ("basse", "lead", "nappe", "clavier", "pluck", "cloche", "arp", "perc", "fx", "kit", "env")
VERSION = 1
CACHE = "private, max-age=86400"


def dossier() -> Path:
    return config.data_dir() / "echantillons"


# ── le manifeste ─────────────────────────────────────────────
def _nombre(v, lo, hi, quoi) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or not lo <= v <= hi:
        raise ValueError(f"{quoi} : un nombre de {lo} à {hi}")
    return v


def valider(m: dict, ici: Path | None = None) -> dict:
    """Refuse un manifeste que la page ne saurait pas jouer. `ici` : le dossier de
    la banque, dont chaque fichier nommé doit exister."""
    if not isinstance(m, dict) or m.get("v") != VERSION:
        raise ValueError(f"manifeste : version {VERSION} attendue")
    if not ID_RX.fullmatch(str(m.get("id", ""))):
        raise ValueError("manifeste : identifiant invalide")
    for k in ("nom", "source", "licence"):
        if not isinstance(m.get(k), str) or not 0 < len(m[k]) <= 200:
            raise ValueError(f"manifeste : {k} manquant")
    if m.get("cat") not in CATS:
        raise ValueError(f"manifeste : catégorie inconnue ({m.get('cat')!r})")
    zones = m.get("zones")
    if not isinstance(zones, list) or not 0 < len(zones) <= 4000:
        raise ValueError("manifeste : de 1 à 4000 zones")
    for i, z in enumerate(zones):
        q = f"zone {i + 1}"
        if not isinstance(z, dict) or not FICHIER_RX.fullmatch(str(z.get("f", ""))):
            raise ValueError(f"{q} : fichier invalide")
        if ici is not None and not (ici / z["f"]).is_file():
            raise ValueError(f"{q} : {z['f']} manque")
        for k in ("cle", "bas", "haut"):
            _nombre(z.get(k), 0, 127, f"{q}.{k}")
        for k in ("vbas", "vhaut"):
            _nombre(z.get(k), 0, 127, f"{q}.{k}")
        if z["bas"] > z["haut"] or z["vbas"] > z["vhaut"]:
            raise ValueError(f"{q} : une plage à l'envers")
        for k in ("xin", "xout"):
            if not (isinstance(z.get(k), list) and len(z[k]) == 2):
                raise ValueError(f"{q}.{k} : deux vélocités")
            for v in z[k]:
                _nombre(v, 0, 127, f"{q}.{k}")
        rr = z.get("rr")
        if not (isinstance(rr, list) and len(rr) == 2 and 1 <= rr[1] <= rr[0] <= 64):
            raise ValueError(f"{q}.rr : [longueur, place]")
        _nombre(z.get("db"), -144, 48, f"{q}.db")
        _nombre(z.get("ct"), -4800, 4800, f"{q}.ct")
        _nombre(z.get("dec"), 0, 600, f"{q}.dec")
        b = z.get("boucle")
        if b is not None and not (isinstance(b, list) and len(b) == 2 and 0 <= b[0] < b[1] <= 600):
            raise ValueError(f"{q}.boucle : [début, fin] en secondes")
        env = z.get("env")
        if not (isinstance(env, list) and len(env) == 5):
            raise ValueError(f"{q}.env : [attaque, tenue, déclin, maintien, chute]")
        for v, hi in zip(env, (100, 100, 100, 1, 100)):
            _nombre(v, 0, hi, f"{q}.env")
        _nombre(z.get("vt"), -1, 1, f"{q}.vt")
        if not isinstance(z.get("seul"), bool):
            raise ValueError(f"{q}.seul : vrai ou faux")
    return m


def lire(bid: str) -> dict:
    if not ID_RX.fullmatch(bid or ""):
        raise HttpError(404, f"banque introuvable : {bid}")
    d = dossier() / bid
    f = d / "banque.json"
    if not f.is_file():
        raise HttpError(404, f"banque introuvable : {bid}")
    try:
        return valider(json.loads(f.read_text("utf-8")))
    except (OSError, ValueError) as e:
        raise HttpError(422, f"banque {bid} : {e}")


def fiche(m: dict) -> dict:
    return {k: m.get(k) for k in ("id", "nom", "cat", "sub", "source", "auteur", "licence", "url", "credit", "octets", "decode")} \
        | {"zones": len(m["zones"])}


# ── les routes ───────────────────────────────────────────────
def r_liste(req):
    out = []
    racine = dossier()
    if racine.is_dir():
        for d in sorted(racine.iterdir()):
            if d.is_dir() and ID_RX.fullmatch(d.name) and (d / "banque.json").is_file():
                try:
                    out.append(fiche(lire(d.name)))
                except HttpError:
                    continue   # une banque abîmée ne cache pas les autres
    return {"banques": out}


def r_banque(req, bid):
    return lire(bid)


def r_fichier(req, bid, fichier):
    m = lire(bid)
    if not FICHIER_RX.fullmatch(fichier or "") or not any(z["f"] == fichier for z in m["zones"]):
        raise HttpError(404, f"introuvable : {fichier}")
    p = dossier() / bid / fichier
    if not p.is_file():
        raise HttpError(404, f"introuvable : {fichier}")
    return FileResponse(p, "audio/flac" if fichier.endswith(".flac") else "audio/wav", cache=CACHE)


def register(app) -> None:
    app.route("GET", "/api/music/banques", r_liste)
    app.route("GET", "/api/music/banques/{bid}", r_banque)
    app.route("GET", "/api/music/banques/{bid}/f/{fichier}", r_fichier)


# ── le format SFZ : la cartographie de l'auteur, aplatie en zones ────────
# Ce que lit `lire_sfz` : les en-têtes <control> <global> <master> <group>
# <region> (chacun hérite des précédents), `#define $X valeur` et
# `#include "fichier"` (SFZ v2), les commentaires // et /* */ ; une valeur
# s'arrête au prochain `opcode=` (un nom de fichier peut avoir des espaces).
# Les régions jouées au relâchement (trigger=release, release_key) ou par une
# commande (on_locc…) ne sont pas des notes : elles sont écartées, et dites.
# Les régions d'un sélecteur de touches (sw_last) ne gardent que celles de son
# défaut (sw_default).
_ENTETE = re.compile(r"<(\w+)>")
_OPCODE = re.compile(r"([A-Za-z_][\w$]*)=")
_NOTE = re.compile(r"([A-Ga-g])([#b]?)(-?\d)")
_DEMI = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def note_sfz(v) -> int:
    """Une note SFZ : un nombre MIDI, ou un nom (c4 = 60, la convention de SFZ)."""
    s = str(v).strip()
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    m = _NOTE.fullmatch(s)
    if not m:
        raise ValueError(f"note SFZ illisible : {s!r}")
    n = _DEMI[m.group(1).lower()] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return 12 * (int(m.group(3)) + 1) + n


def _texte_sfz(chemin: Path, defs: dict, base: Path, profondeur: int = 0) -> str:
    """Le texte d'un SFZ, ses #include déroulés et ses $X remplacés. Un #include se
    lit depuis le dossier du .sfz de départ (`base`), comme le fait sfizz."""
    if profondeur > 8:
        raise ValueError("#include trop profond")
    t = chemin.read_text("utf-8", errors="replace")
    t = re.sub(r"/\*.*?\*/", " ", t, flags=re.S)
    out = []
    for ligne in t.splitlines():
        ligne = re.sub(r"//.*$", "", ligne)
        # #define et #include peuvent suivre un en-tête sur la même ligne (Salamander : Data/notes.txt)
        for mo in re.split(r'(#define\s+\$\w+\s+\S+|#include\s+"[^"]+")', ligne):
            d = re.fullmatch(r"#define\s+(\$\w+)\s+(\S+)", mo.strip())
            i = re.fullmatch(r'#include\s+"([^"]+)"', mo.strip())
            if d:
                defs[d.group(1)] = d.group(2)
            elif i:
                inc = (base / i.group(1)).resolve()
                if not inc.is_relative_to(base.resolve()):
                    raise ValueError(f"#include hors du dossier : {i.group(1)}")
                out.append(_texte_sfz(inc, defs, base, profondeur + 1))
            else:
                # les $X les plus longs d'abord ($OFF10 avant $OFF1)
                for k in sorted(defs, key=len, reverse=True):
                    mo = mo.replace(k, defs[k])
                out.append(mo)
        out.append("\n")
    return " ".join(out)


def lire_sfz(chemin: Path) -> tuple[list[dict], dict]:
    """Les régions d'un fichier SFZ, chacune avec tous ses opcodes hérités, et
    le <control> (default_path). Rend (régions, contrôle)."""
    texte = _texte_sfz(chemin, {}, chemin.parent)
    niveaux = {"control": {}, "global": {}, "master": {}, "group": {}}
    regions, cle = [], None
    courant: dict = {}
    for morceau in _ENTETE.split(texte):
        if morceau in ("control", "global", "master", "group", "region", "curve", "effect", "midi", "sample"):
            cle = morceau
            if cle == "global":
                niveaux.update(master={}, group={})
                courant = niveaux["global"] = {}
            elif cle == "master":
                niveaux["group"] = {}
                courant = niveaux["master"] = {}
            elif cle == "group":
                courant = niveaux["group"] = {}
            elif cle == "control":
                courant = niveaux["control"] = {}
            elif cle == "region":
                courant = {}
                regions.append((dict(niveaux["global"]), dict(niveaux["master"]), dict(niveaux["group"]), courant))
            else:
                courant = {}   # <curve> <effect> … : lus, sans effet ici
            continue
        if cle is None:
            continue
        pos = [(m.start(), m.group(1)) for m in _OPCODE.finditer(morceau)]
        for j, (debut, nom) in enumerate(pos):
            fin = pos[j + 1][0] if j + 1 < len(pos) else len(morceau)
            courant[nom] = morceau[debut + len(nom) + 1:fin].strip()
    out = []
    for g, ma, gr, r in regions:
        out.append({**g, **ma, **gr, **r})
    return out, niveaux["control"]


def _f(r: dict, k: str, defaut: float) -> float:
    try:
        return float(r[k]) if k in r else defaut
    except ValueError:
        raise ValueError(f"{k}={r[k]!r} n'est pas un nombre")


def zones_sfz(regions: list[dict], *, couches: list[int] | None = None) -> tuple[list[dict], dict]:
    """Aplatit des régions SFZ en zones (sans fichier : `sample` reste à
    convertir). `couches` : ne garder que ces couches de vélocité (leur rang,
    de 1 à n, du plus doux au plus fort) ; chaque couche gardée prend les
    vélocités des couches retirées sous elle, la dernière monte à 127.
    Rend (zones, écartées : {raison: nombre})."""
    ecartees: dict = {}

    def ecarter(raison):
        ecartees[raison] = ecartees.get(raison, 0) + 1

    zones = []
    for r in regions:
        if r.get("trigger", "attack") not in ("attack", "first", "legato") or "release_key" in r:
            ecarter("relâchement")
            continue
        if any(k.startswith(("on_locc", "on_hicc")) for k in r):
            ecarter("déclenchée par une commande")
            continue
        if "sw_last" in r and "sw_default" in r and note_sfz(r["sw_last"]) != note_sfz(r["sw_default"]):
            ecarter("autre articulation (sélecteur de touches)")
            continue
        if "sample" not in r:
            ecarter("sans son")
            continue
        if "key" in r:
            bas = haut = cle = note_sfz(r["key"])
        else:
            bas, haut = note_sfz(r.get("lokey", 0)), note_sfz(r.get("hikey", 127))
            cle = note_sfz(r.get("pitch_keycenter", 60))
        if "pitch_keycenter" in r:
            cle = note_sfz(r["pitch_keycenter"])
        mode = r.get("loop_mode", "")
        boucle = None
        if mode in ("loop_continuous", "loop_sustain") and "loop_start" in r and "loop_end" in r:
            boucle = [int(float(r["loop_start"])), int(float(r["loop_end"]))]   # en échantillons de la source : la conversion les passe en secondes
        zones.append({
            "sample": r["sample"].replace("\\", "/"),
            "cle": cle, "bas": bas, "haut": haut,
            "vbas": int(_f(r, "lovel", 0)), "vhaut": int(_f(r, "hivel", 127)),
            "xin": [int(_f(r, "xfin_lovel", 0)), int(_f(r, "xfin_hivel", 0))],
            "xout": [int(_f(r, "xfout_lovel", 127)), int(_f(r, "xfout_hivel", 127))],
            "rr": [int(_f(r, "seq_length", 1)), int(_f(r, "seq_position", 1))],
            "db": _f(r, "volume", 0.0),
            "ct": _f(r, "tune", 0.0) + 100 * _f(r, "transpose", 0.0),
            "offset": int(_f(r, "offset", 0)),
            "boucle_src": boucle,
            # l'enveloppe d'amplitude (SFZ : attaque, tenue, déclin en s ; maintien en % ; chute en s)
            "env": [_f(r, "ampeg_attack", 0.0), _f(r, "ampeg_hold", 0.0), _f(r, "ampeg_decay", 0.0),
                    _f(r, "ampeg_sustain", 100.0) / 100, _f(r, "ampeg_release", 0.001)],
            "vt": _f(r, "amp_veltrack", 100.0) / 100,
            "seul": mode == "one_shot",
        })
    if couches:
        # les couches : les plages de vélocité distinctes, du plus doux au plus fort
        plages = sorted({(z["vbas"], z["vhaut"]) for z in zones})
        garde = [plages[i - 1] for i in sorted(set(couches)) if 1 <= i <= len(plages)]
        nouvelle, bas = {}, 0
        for k, pl in enumerate(garde):
            nouvelle[pl] = (bas, 127 if k == len(garde) - 1 else pl[1])
            bas = pl[1] + 1
        avant = len(zones)
        zones = [z for z in zones if (z["vbas"], z["vhaut"]) in nouvelle]
        for z in zones:
            z["vbas"], z["vhaut"] = nouvelle[(z["vbas"], z["vhaut"])]
        if avant > len(zones):
            ecartees["couche de vélocité non gardée"] = avant - len(zones)
    for z in zones:
        z["bas"], z["haut"], z["cle"] = (max(0, min(127, z[k])) for k in ("bas", "haut", "cle"))
        z["vbas"], z["vhaut"] = max(0, min(127, z["vbas"])), max(0, min(127, z["vhaut"]))
    return zones, ecartees


# ── le contrôle sans GPU (tools/check.py) ───────────────────
def _wav(path: Path, f0: float, secs: float = 0.5, sr: int = 48000) -> None:
    import math
    import struct
    import wave
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        n = int(secs * sr)
        w.writeframes(b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * f0 * i / sr))) for i in range(n)))


def selftest(call, ok) -> None:
    import shutil
    import tempfile
    # le SFZ : un en-tête par niveau, #define, #include, des noms de notes, un relâchement écarté
    t = Path(tempfile.mkdtemp(prefix="sfz-essai-"))
    try:
        (t / "Data").mkdir()
        (t / "Data" / "notes.txt").write_text('<region> sample=A $VEL.wav lokey=c4 hikey=d4 pitch_keycenter=60 volume=-3\n')
        (t / "essai.sfz").write_text(
            "// essai\n<control> default_path=Samples/\n<global> ampeg_release=0.5 amp_veltrack=73\n"
            "<group> #define $VEL v1 lovel=1 hivel=64 #include \"Data/notes.txt\"\n"
            "<group> #define $VEL v2 lovel=65 hivel=127 #include \"Data/notes.txt\"\n"
            "<group> trigger=release\n<region> sample=rel.wav key=60\n"
            "<group> seq_length=2\n<region> seq_position=2 sample=Mon fichier.wav key=72 loop_mode=one_shot\n")
        regions, ctl = lire_sfz(t / "essai.sfz")
        ok(len(regions) == 4 and ctl.get("default_path") == "Samples/" and regions[0]["sample"] == "A v1.wav" and regions[1]["sample"] == "A v2.wav",
           f"banques : le SFZ se lit (#define, #include, en-têtes) ({[r.get('sample') for r in regions]})")
        zs, ec = zones_sfz(regions)
        z0 = zs[0] if zs else {}
        ok(len(zs) == 3 and ec == {"relâchement": 1} and z0.get("bas") == 60 and z0.get("haut") == 62 and z0.get("vt") == 0.73
           and z0.get("env", [0] * 5)[4] == 0.5 and zs[2]["sample"] == "Mon fichier.wav" and zs[2]["seul"] and zs[2]["rr"] == [2, 2],
           f"banques : les régions s'aplatissent en zones (héritage, notes nommées, tour, un coup) ({zs} {ec})")
        zs2, ec2 = zones_sfz(regions, couches=[2])
        ok(sorted({(z["vbas"], z["vhaut"]) for z in zs2}) == [(0, 127)] and ec2.get("couche de vélocité non gardée") == 2,
           f"banques : une couche gardée prend les vélocités de celles qu'on retire ({[(z['vbas'], z['vhaut']) for z in zs2]} {ec2})")
        ok(note_sfz("c4") == 60 and note_sfz("a#0") == 22 and note_sfz("Db4") == 61 and note_sfz("69") == 69, "banques : les noms de notes SFZ")
    finally:
        shutil.rmtree(t, ignore_errors=True)

    # une banque d'essai, posée comme tools/echantillons.py la pose : servie, listée, gardée
    bid = "essai-banque"
    d = dossier() / bid
    d.mkdir(parents=True, exist_ok=True)
    try:
        _wav(d / "z0001.wav", 261.63)
        _wav(d / "z0002.wav", 523.25)
        zone = {"xin": [0, 0], "xout": [127, 127], "rr": [1, 1], "db": 0, "ct": 0, "dec": 0, "boucle": None,
                "env": [0.004, 0, 0, 1, 0.3], "vt": 1, "seul": False, "vbas": 0, "vhaut": 127}
        man = {"v": VERSION, "id": bid, "nom": "Essai", "cat": "clavier", "source": "essai", "licence": "CC0 1.0",
               "zones": [{**zone, "f": "z0001.wav", "cle": 60, "bas": 0, "haut": 66}, {**zone, "f": "z0002.wav", "cle": 72, "bas": 67, "haut": 127}],
               "octets": 96000, "decode": 192000}
        (d / "banque.json").write_text(json.dumps(man))
        st, lst = call("GET", "/api/music/banques")
        ok(st == 200 and any(b["id"] == bid and b["zones"] == 2 for b in lst.get("banques", [])), f"banques : la liste ({st} {lst})")
        st, m = call("GET", f"/api/music/banques/{bid}")
        ok(st == 200 and m.get("zones", [{}])[1].get("cle") == 72, f"banques : le manifeste ({st})")
        st, son = call("GET", f"/api/music/banques/{bid}/f/z0002.wav")
        ok(st == 200 and isinstance(son, bytes) and son == (d / "z0002.wav").read_bytes(), f"banques : le son d'une zone se sert ({st})")
        for chemin in (f"/api/music/banques/{bid}/f/banque.json", f"/api/music/banques/{bid}/f/z0009.wav",
                       f"/api/music/banques/{bid}/f/..%2Fbanque.json", "/api/music/banques/..%2F..%2Fauth", "/api/music/banques/inconnue"):
            st, _ = call("GET", chemin)
            ok(st in (400, 404), f"banques : {chemin} n'est pas servi ({st})")   # 400 : le socle refuse un %2F
        # un manifeste abîmé : refusé, il ne cache pas les autres
        bad = dossier() / "essai-abimee"
        bad.mkdir(exist_ok=True)
        (bad / "banque.json").write_text(json.dumps({**man, "id": "essai-abimee", "zones": [{**man["zones"][0], "bas": 90, "haut": 10}]}))
        st, lst = call("GET", "/api/music/banques")
        ids = [b["id"] for b in lst.get("banques", [])]
        st2, r2 = call("GET", "/api/music/banques/essai-abimee")
        ok(st == 200 and bid in ids and "essai-abimee" not in ids and st2 == 422, f"banques : un manifeste abîmé est écarté ({ids} {st2} {r2})")
        shutil.rmtree(bad, ignore_errors=True)
        try:
            valider({**man, "zones": [{**man["zones"][0], "f": "../x.wav"}]})
            ok(False, "banques : un nom de fichier hors de la banque est refusé")
        except ValueError:
            ok(True, "banques : un nom de fichier hors de la banque est refusé")
    finally:
        # la banque d'essai reste pour le pilote de la page si on la garde ; le contrôle la retire
        shutil.rmtree(d, ignore_errors=True)
