#!/usr/bin/env python3
"""La mesure du calage des paroles (server/tools/paroles.py) sur des LRC calés
à la main : ceux d'AGOSTA (aeneas + espeak), s'ils sont là. Rien n'est lu ni
écrit ailleurs ; rien de ce dossier ne part dans notre dépôt (public).

    python3 tools/paroles_mesure.py                       # /home/user/agosta/audio, 5 graines, tous les niveaux
    python3 tools/paroles_mesure.py ~/AGOSTA/audio --graines 10 --niveaux moyen fort
    python3 tools/paroles_mesure.py --blocs               # compare avec le SequenceMatcher seul
    python3 tools/paroles_mesure.py --json resultats.json # les écarts, chanson par chanson

Pour chaque LRC : des « mots entendus » fabriqués (paroles.entendre : le temps
de chaque ligne réparti sur ses mots, du bruit, des mots manqués, ajoutés, mal
entendus, des lignes sautées, aux taux de paroles.BRUITS), alignés sur les
paroles du LRC (paroles.caler), puis l'écart ligne à ligne au temps calé à la
main : médiane, 90e centile, pire, part des lignes à 0,5 s ou moins.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from tools import paroles as P  # noqa: E402


def duree_de(mp3: Path, lignes: list) -> float:
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp3)],
                           capture_output=True, text=True, timeout=30)
        return float(r.stdout.strip())
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return (lignes[-1][0] + 10.0) if lignes else 0.0


def chansons(dossier: Path) -> list[dict]:
    out = []
    for lrc in sorted(dossier.glob("*.lrc")):
        d = P.lire_lrc(lrc.read_text(encoding="utf-8", errors="replace"))
        lignes = [(t, x) for t, x in d["lignes"] if P.jetons(x, "en")]
        if not lignes:
            continue
        mp3 = next((m for m in dossier.glob("*.mp3") if m.stem.replace("_", " ").lower() == lrc.stem.lower()), None)
        out.append({"nom": lrc.stem, "lignes": sorted(lignes), "duree": duree_de(mp3, lignes) if mp3 else lignes[-1][0] + 10})
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="la mesure du calage des paroles sur des LRC calés à la main")
    ap.add_argument("dossier", nargs="?", default="/home/user/agosta/audio")
    ap.add_argument("--graines", type=int, default=5)
    ap.add_argument("--niveaux", nargs="*", default=list(P.BRUITS))
    ap.add_argument("--langue", default="en")
    ap.add_argument("--blocs", action="store_true", help="comparer avec le SequenceMatcher seul (apparier_blocs)")
    ap.add_argument("--sans-voix", action="store_true", help="sans les passages chantés de la voix seule (le mélange transcrit)")
    ap.add_argument("--json")
    a = ap.parse_args()
    dossier = Path(a.dossier).expanduser()
    if not dossier.is_dir():
        print(f"pas de dossier : {dossier} (le dépôt d'AGOSTA n'est pas là ; rien à mesurer)")
        return 0
    songs = chansons(dossier)
    print(f"{len(songs)} LRC, {sum(len(s['lignes']) for s in songs)} lignes, {a.graines} graines\n")
    methodes = [("global", None)] + ([("blocs", P.apparier_blocs)] if a.blocs else [])
    res = {}
    for niv in a.niveaux:
        for nom_m, fn in methodes:
            tous, pires, t0 = [], [], time.time()
            par_chanson = {}
            for s in songs:
                e_s = []
                for g in range(a.graines):
                    mots = P.entendre(s["lignes"], s["duree"], niv, graine=1000 * g + len(s["nom"]), langue=a.langue)
                    voix = None if a.sans_voix else P.voix_simulee(s["lignes"], s["duree"], graine=1000 * g, langue=a.langue)
                    cal = P.caler([x for _, x in s["lignes"]], mots, a.langue, s["duree"], voix=voix, appariement=fn)
                    e = P.ecarts(cal, s["lignes"])
                    e_s += e
                r = P.resume_ecarts(e_s)
                par_chanson[s["nom"]] = r
                pires.append((r["pire"], s["nom"]))
                tous += e_s
            R = P.resume_ecarts(tous)
            R["secondes"] = round(time.time() - t0, 1)
            res[f"{niv}/{nom_m}"] = {"total": R, "chansons": par_chanson}
            print(f"{niv:8s} {nom_m:6s}  médiane {R['mediane']:.2f} s · p90 {R['p90']:.2f} s · pire {R['pire']:.2f} s "
                  f"· ≤ 0,5 s : {100 * R['sous_05']:.0f} %  ({R['n']} lignes, {R['secondes']} s)")
            worst = sorted(pires, reverse=True)[:3]
            print("          les pires chansons : " + ", ".join(f"{n} {p:.1f} s (p90 {par_chanson[n]['p90']:.2f})" for p, n in worst))
    if a.json:
        Path(a.json).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
