#!/usr/bin/env python3
"""Pourquoi YuE2 « ne tient pas compte des paroles » : ce que les dernières chansons ont VRAIMENT reçu.

Lecture seule, bibliothèque standard. Sur DGX2, depuis ~/SHOWRUNNER_TOOLS :
    python3 tools/diag_yue.py            les 3 dernières chansons YuE2
    python3 tools/diag_yue.py 6          les 6 dernières

Pour chacune : le moteur et le point de contrôle réellement utilisés, le style et les paroles gardés dans la
recette, la durée, le mode, puis la partition ABC que YuE2 a écrite AVANT de chanter. Dans une partition ABC, les
lignes `w:` portent les paroles : si ses mots sont là, le plan les a reçus ; si elles manquent ou chantent autre
chose, la perte est avant le modèle (portail) ou dans YuE2GenerateABC (nœud). Rien n'est modifié.
"""
import json
import sys
from pathlib import Path

DATA = Path.home() / "showrunner-data" / "library"
N = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 3


def items():
    for f in DATA.glob("*/item.json"):
        try:
            it = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        model = str((it.get("origin") or {}).get("model") or "")
        if it.get("kind") == "audio" and (model.startswith("yue2") or "yue2" in (it.get("tags") or [])):
            yield f.stat().st_mtime, it


rows = sorted(items(), key=lambda r: r[0], reverse=True)[:N]
if not rows:
    print(f"aucune chanson YuE2 dans {DATA} (le moteur était peut-être factice ou ACE-Step)")
for _, it in rows:
    p = it.get("params") or {}
    score = str(p.get("score") or "")
    wl = [ln for ln in score.splitlines() if ln.strip().startswith("w:")]
    print("=" * 78)
    print(f"{it.get('id')}  « {it.get('title')} »  moteur={p.get('engine')}  modèle={(it.get('origin') or {}).get('model')}")
    print(f"durée demandée={p.get('duration_s')} s   mode={p.get('mode')}   graine={p.get('seed')}   rendu en {p.get('render_seconds')} s")
    print(f"style : {p.get('tags')}")
    ly = str(p.get('lyrics') or "")
    print(f"paroles gardées dans la recette ({len(ly)} signes, instrumental={p.get('instrumental')}) :")
    print("  " + (ly[:600].replace("\n", "\n  ") if ly else "(AUCUNE : les paroles n'ont pas atteint le rendu)"))
    print(f"partition ABC : {len(score)} signes, {len(wl)} ligne(s) de paroles « w: »")
    for ln in wl[:8]:
        print("  " + ln.strip()[:140])
    if not score:
        print("  (pas de partition gardée : mode off, ou rendu factice)")
