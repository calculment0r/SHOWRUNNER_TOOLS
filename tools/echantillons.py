#!/usr/bin/env python3
"""Les banques d'échantillons d'ODIO : les télécharger et les importer dans les
données du portail (09/10 ; docs/etudes/odio_synthes.md § 7, décision 4).

À lancer par Cal, sur la machine du portail (DGX2), une fois :

    python3 tools/echantillons.py liste                    # les banques, leurs sources, leurs licences
    python3 tools/echantillons.py taille [ids…]            # ce que le téléchargement pèsera (l'API de GitHub)
    python3 tools/echantillons.py importer tout            # tout (VCSL puis Salamander)
    python3 tools/echantillons.py importer vcsl-vibraphone salamander
        --donnees ~/showrunner-data    les données du portail (défaut : $SHOWRUNNER_DATA, sinon ~/showrunner-data)
        --travail /tmp/echantillons    les sources téléchargées (gardées : un second import ne retélécharge pas)
        --essai N                      N zones seulement, autour du do central (un essai)
        --remplacer                    refaire une banque déjà importée

Rien ne va dans le dépôt, qui est public ; rien n'est servi depuis un tiers :
le portail sert ce qui est dans <données>/echantillons/ (server/tools/music_banques.py).

Les sources, aux commits fixés, par git (un clone partiel : on ne prend que les
fichiers d'une banque) :
  - VCSL, Versilian Community Sample Library (Versilian Studios LLC), licence
    CC0 1.0 (son README, son LICENSE) : sa branche `sfz`, où l'éditeur publie la
    cartographie SFZ de chaque instrument (générée par l'outil de Peter
    Eastman, son README) — les notes, les vélocités, les niveaux et les tours
    de l'auteur, lus tels quels ;
  - Salamander Grand Piano V3, d'Alexander Holm, licence CC-BY 3.0 (le README
    et le LICENSE du dépôt sfzinstruments/SalamanderGrandPiano, sa cartographie
    SFZ par kinwie). Le crédit est écrit dans la banque, et la page le montre.

Chaque son est converti par ffmpeg en FLAC 16 bits à 48 kHz (la fréquence du
studio), sa queue coupée à `duree` secondes avec un fondu d'une demi-seconde
(une boucle est toujours gardée entière) : un navigateur décode un son en
nombres flottants (4 octets par échantillon et par voie), une banque entière
tient en mémoire — la taille décodée est écrite dans son manifeste (`decode`).
Le manifeste est validé par le serveur (music_banques.valider) avant d'être mis
en place ; une banque se pose d'un coup (dossier temporaire, puis renommage).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI.parent / "server"))
from tools import music_banques as MB  # noqa: E402  (une seule vérité : le format SFZ et le manifeste)

SOURCES = {
    "vcsl": {
        "url": "https://github.com/sgossner/VCSL", "commit": "dfcf4a4918771eee884b96ad4493de82ef84daf6",   # branche sfz, 23/12/2020
        "source": "VCSL", "auteur": "Versilian Studios LLC", "licence": "CC0 1.0",
        "credit": "Versilian Community Sample Library (Versilian Studios LLC), CC0 1.0",
    },
    "salamander": {
        "url": "https://github.com/sfzinstruments/SalamanderGrandPiano", "commit": "3382bf9496bba2486f5ab0de55a264d1dfc38404",   # 03/01/2022
        "source": "Salamander Grand Piano V3", "auteur": "Alexander Holm", "licence": "CC-BY 3.0",
        "credit": "Salamander Grand Piano V3 par Alexander Holm, licence CC-BY 3.0 "
                  "(https://archive.org/details/SalamanderGrandPianoV3) ; cartographie SFZ : kinwie (sfzinstruments)",
    },
}

# Les banques : (identifiant, source, fichier SFZ, nom, ligne, catégorie du navigateur, durée gardée en s).
# Choix d'un premier jeu : ce qui manque au studio (piano, maillets, orgue, vents, cordes pincées).
_V = "vcsl"
BANQUES = [
    ("vcsl-piano-droit", _V, "Chordophones/Zithers/Upright Piano, Yamaha.sfz", "Piano droit", "VCSL · Yamaha", "clavier", 8),
    ("vcsl-piano-queue", _V, "Chordophones/Zithers/Grand Piano, Steinway B.sfz", "Piano à queue", "VCSL · Steinway B", "clavier", 8),
    ("vcsl-clavecin", _V, "Chordophones/Zithers/Harpsichord, English - Normal.sfz", "Clavecin", "VCSL · anglais", "clavier", 6),
    ("vcsl-piano-fm", _V, "Electrophones/TX81Z - FM Piano.sfz", "Piano FM", "VCSL · TX81Z", "clavier", 6),
    ("vcsl-orgue", _V, "Aerophones/Edge-blown Aerophones/Pipe Organ - Loud.sfz", "Orgue à tuyaux", "VCSL · grand jeu", "nappe", 8),
    ("vcsl-orgue-doux", _V, "Aerophones/Edge-blown Aerophones/Pipe Organ - Quiet.sfz", "Orgue doux", "VCSL · jeu doux", "nappe", 8),
    ("vcsl-vibraphone", _V, "Idiophones/Struck Idiophones/Vibraphone - Hard Mallets.sfz", "Vibraphone", "VCSL · maillets durs", "cloche", 8),
    ("vcsl-marimba", _V, "Idiophones/Struck Idiophones/Marimba.sfz", "Marimba", "VCSL", "pluck", 4),
    ("vcsl-xylophone", _V, "Idiophones/Struck Idiophones/Xylophone - Medium Mallets.sfz", "Xylophone", "VCSL · maillets moyens", "pluck", 3),
    ("vcsl-glockenspiel", _V, "Idiophones/Struck Idiophones/Glockenspiel.sfz", "Glockenspiel", "VCSL", "cloche", 4),
    ("vcsl-cloches", _V, "Idiophones/Struck Idiophones/Tubular Bells 1.sfz", "Cloches tubes", "VCSL", "cloche", 8),
    ("vcsl-harpe", _V, "Chordophones/Composite Chordophones/Concert Harp.sfz", "Harpe", "VCSL · harpe de concert", "pluck", 8),
    ("vcsl-kalimba", _V, "Idiophones/Plucked Idiophones/Kalimba, Kenya.sfz", "Kalimba", "VCSL · Kenya", "pluck", 4),
    ("vcsl-dan-tranh", _V, "Chordophones/Zithers/Dan Tranh - Normal.sfz", "Dan tranh", "VCSL · cithare", "pluck", 6),
    ("vcsl-sax", _V, "Aerophones/Reed Aerophones/Tenor Saxophone - Vibrato.sfz", "Saxophone ténor", "VCSL · vibrato", "lead", 6),
    ("vcsl-flute-bec", _V, "Aerophones/Edge-blown Aerophones/Baroque Alto Recorder - Sustain.sfz", "Flûte à bec", "VCSL · alto baroque", "lead", 6),
    ("vcsl-harmonica", _V, "Aerophones/Free Aerophones/Harmonica-Hohner-Special20-C - Normal.sfz", "Harmonica", "VCSL · Hohner Special 20", "lead", 6),
    ("vcsl-verres", _V, "Idiophones/Friction Idiophones/Wine Glasses - Slow.sfz", "Verres chantants", "VCSL", "fx", 8),
    ("vcsl-timbales", _V, "Membranophones/Struck Membranophones/Timpani 1 - Hit.sfz", "Timbales", "VCSL", "perc", 6),
    # le piano de concert : trois couches de vélocité sur seize (la 6e, la 11e, la 16e), pour tenir en mémoire
    ("salamander", "salamander", "Salamander Grand Piano V3.sfz", "Piano de concert", "Salamander · Yamaha C5", "clavier", 8),
]
COUCHES = {"salamander": [6, 11, 16]}
# le suivi de vélocité de Salamander : son README (« sets its default amp_veltrack value at 73% » ;
# son SFZ le règle par une commande ARIA, que le lecteur ne lit pas)
SUIVI = {"salamander": 0.73}
# sa chute : son SFZ la donne par une commande (ampeg_release_oncc72=2, la commande à 0,5 par
# set_hdcc72) : 2 × 0,5 = 1 s ; le lecteur ne lit pas les commandes, on l'écrit ici
CHUTE = {"salamander": 1.0}
# ses dossiers d'#include, à prendre avec le SFZ
AUSSI = {"salamander": ["Data"]}

FONDU = 0.5


def git(args: list[str], cwd: Path) -> str:
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"git {' '.join(args[:3])}… : {r.stderr.strip()[-400:]}")
    return r.stdout


def depot(nom: str, travail: Path) -> Path:
    """Le clone partiel d'une source à son commit : les arbres, pas les fichiers."""
    s = SOURCES[nom]
    d = travail / nom
    if not (d / ".git").is_dir():
        d.mkdir(parents=True, exist_ok=True)
        git(["init", "-q"], d)
        git(["remote", "add", "origin", s["url"]], d)
    git(["fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", s["commit"]], d)
    return d


def prendre(d: Path, chemins: list[str]) -> None:
    """Les fichiers nommés, et eux seuls (par paquets : la ligne de commande a une limite)."""
    manque = [c for c in chemins if not (d / c).exists()]
    for i in range(0, len(manque), 100):
        git(["-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD", "--", *manque[i:i + 100]], d)


def sonde(f: Path) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=sample_rate,channels:format=duration",
                        "-of", "json", str(f)], capture_output=True, text=True)
    j = json.loads(r.stdout or "{}")
    st = (j.get("streams") or [{}])[0]
    return {"sr": int(st.get("sample_rate", 0)), "ch": int(st.get("channels", 0)), "duree": float(j.get("format", {}).get("duration", 0))}


def convertir(src: Path, dst: Path, fin: float, coupe: bool) -> None:
    af = [f"atrim=0:{fin:.4f}"]
    if coupe:
        af.append(f"afade=t=out:st={max(0.0, fin - FONDU):.4f}:d={FONDU}")
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", ",".join(af), "-ar", "48000",
                        "-sample_fmt", "s16", "-c:a", "flac", str(dst)], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"ffmpeg : {src.name} : {r.stderr.strip()[-300:]}")


def importer(bid: str, donnees: Path, travail: Path, essai: int = 0, remplacer: bool = False) -> dict:
    b = next((x for x in BANQUES if x[0] == bid), None)
    if not b:
        raise SystemExit(f"banque inconnue : {bid} (python3 tools/echantillons.py liste)")
    _, src, sfz, nom, sub, cat, duree = b
    S = SOURCES[src]
    cible = donnees / "echantillons" / bid
    if cible.exists() and not remplacer:
        print(f"{bid} : déjà importée ({cible}) — --remplacer pour la refaire")
        return json.loads((cible / "banque.json").read_text("utf-8"))
    d = depot(src, travail)
    prendre(d, [sfz, *AUSSI.get(bid, [])])
    regions, ctl = MB.lire_sfz(d / sfz)
    zones, ecartees = MB.zones_sfz(regions, couches=COUCHES.get(bid))
    if not zones:
        raise SystemExit(f"{bid} : aucune zone jouable dans {sfz} ({ecartees})")
    if essai:
        zones = sorted(zones, key=lambda z: (abs(z["cle"] - 62), z["vbas"]))[:essai]
    racine = (d / sfz).parent / ctl.get("default_path", "")
    chemins = sorted({str((racine / z["sample"]).relative_to(d)) for z in zones})
    print(f"{bid} : {len(zones)} zones, {len(chemins)} sons à prendre" + (f" ; écartées : {ecartees}" if ecartees else ""))
    prendre(d, chemins)
    tmp = cible.with_name(f"{bid}.tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    faits, octets, decode, out = {}, 0, 0, []
    for z in zones:
        f = racine / z["sample"]
        if f not in faits:
            i = len(faits) + 1
            nomf = f"z{i:04d}.flac"
            p = sonde(f)
            if not p["sr"]:
                raise SystemExit(f"{bid} : ffprobe ne lit pas {f}")
            fin, coupe = p["duree"], False
            garde = max(duree, (z["boucle_src"][1] / p["sr"] + 0.1) if z["boucle_src"] else 0)
            if fin > garde:
                fin, coupe = garde, True
            convertir(f, tmp / nomf, fin, coupe)
            octets += (tmp / nomf).stat().st_size
            decode += int(round(fin * 48000)) * p["ch"] * 4
            faits[f] = (nomf, p)
            print(f"  {i:4d} {z['sample']}  →  {nomf}  {fin:.1f} s")
        nomf, p = faits[f]
        sr = p["sr"]
        out.append({"f": nomf, "cle": z["cle"], "bas": z["bas"], "haut": z["haut"], "vbas": z["vbas"], "vhaut": z["vhaut"],
                    "xin": z["xin"], "xout": z["xout"], "rr": z["rr"], "db": round(z["db"], 3), "ct": round(z["ct"], 2),
                    "dec": round(z["offset"] / sr, 5),
                    "boucle": [round(z["boucle_src"][0] / sr, 5), round(z["boucle_src"][1] / sr, 5)] if z["boucle_src"] else None,
                    "env": [round(x, 4) for x in z["env"][:4]] + [CHUTE.get(bid, round(z["env"][4], 4))],
                    "vt": SUIVI.get(bid, z["vt"]), "seul": z["seul"]})
    m = {"v": MB.VERSION, "id": bid, "nom": nom, "sub": sub, "cat": cat, "source": S["source"], "auteur": S["auteur"],
         "licence": S["licence"], "url": S["url"], "commit": S["commit"], "sfz": sfz, "credit": S["credit"],
         "zones": out, "octets": octets, "decode": decode, **({"essai": essai} if essai else {})}
    MB.valider(m, tmp)
    (tmp / "banque.json").write_text(json.dumps(m, ensure_ascii=False, indent=1), "utf-8")
    if cible.exists():
        shutil.rmtree(cible)
    tmp.rename(cible)
    print(f"{bid} : {len(out)} zones, {len(faits)} sons, {octets / 1e6:.1f} Mo sur le disque, {decode / 1e6:.0f} Mo décodés dans un onglet → {cible}")
    return m


def taille(ids: list[str]) -> None:
    """Le poids des sons de chaque source, lu dans l'arbre de GitHub (son API, sans clé) : avant de télécharger."""
    for nom, s in SOURCES.items():
        repo = s["url"].split("github.com/")[1]
        try:
            with urllib.request.urlopen(f"https://api.github.com/repos/{repo}/git/trees/{s['commit']}?recursive=1", timeout=60) as r:
                arbre = json.load(r)
        except OSError as e:
            print(f"{nom} : l'API de GitHub ne répond pas ({e}) — le poids s'affichera à l'import")
            continue
        tailles = {t["path"]: t.get("size", 0) for t in arbre.get("tree", []) if t.get("type") == "blob"}
        for bid, src, sfz, *_ in BANQUES:
            if src != nom or (ids and bid not in ids):
                continue
            dossier = sfz.rsplit("/", 1)[0] + "/" if "/" in sfz else ""
            base = Path(sfz).stem.split(" - ")[0]
            n = sum(v for k, v in tailles.items() if k.startswith(dossier + base + "/") or (nom == "salamander" and k.startswith("Samples/")))
            print(f"{bid:22s} au plus {n / 1e6:7.1f} Mo à télécharger (tous les sons de son dossier source)")


def main() -> int:
    a = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("quoi", choices=["liste", "taille", "importer"])
    a.add_argument("ids", nargs="*")
    a.add_argument("--donnees", default=os.environ.get("SHOWRUNNER_DATA", str(Path.home() / "showrunner-data")))
    a.add_argument("--travail", default="/tmp/echantillons")
    a.add_argument("--essai", type=int, default=0)
    a.add_argument("--remplacer", action="store_true")
    o = a.parse_args()
    if o.quoi == "liste":
        for bid, src, sfz, nom, sub, cat, duree in BANQUES:
            print(f"{bid:22s} {nom:20s} {cat:8s} {SOURCES[src]['licence']:10s} {sfz}")
        return 0
    if o.quoi == "taille":
        taille(o.ids)
        return 0
    ids = [b[0] for b in BANQUES] if o.ids in ([], ["tout"]) else o.ids
    for bid in ids:
        importer(bid, Path(o.donnees).expanduser(), Path(o.travail).expanduser(), o.essai, o.remplacer)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
