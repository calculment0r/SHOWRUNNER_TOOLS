#!/usr/bin/env python3
"""Régler les machines d'une voie de calcul (showrunner.local.json), sans éditer le JSON à la main.

Sur DGX2, depuis ~/SHOWRUNNER_TOOLS :
    python3 tools/voie.py                          les voies telles qu'elles sont (rien n'est écrit)
    python3 tools/voie.py audio dgx2 dgx1          la voie audio sur les deux machines
    python3 tools/voie.py audio dgx2               la voie audio sur DGX2 seule (le défaut)
puis : tools/portail.sh restart

Machines connues : dgx2 = 127.0.0.1:8188 (la machine du portail), dgx1 = 169.254.110.6:8188 (le câble). Un port
particulier s'écrit « dgx1:8189 ». Seule la voie nommée change (les listes sont remplacées, les autres voies et
les autres réglages gardés) ; une copie datée de showrunner.local.json est faite avant d'écrire.
Avant d'ajouter DGX1 à une voie, les modèles de cette voie doivent y être : bash tools/mirror_yue.sh --check,
bash tools/mirror_stems.sh --check (ACE-Step : ses fichiers dans ~/ComfyUI/models de DGX1).
"""
import json
import shutil
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LOCAL = REPO / "showrunner.local.json"
HOTES = {"dgx2": "127.0.0.1", "dgx1": "169.254.110.6"}
VOIES = ("image", "h3", "audio", "cpu", "analyse")


def url(m):
    nom, _, port = m.partition(":")
    if nom not in HOTES:
        sys.exit(f"machine inconnue « {m} » (dgx1 ou dgx2, avec un port facultatif : dgx1:8189)")
    return f"http://{HOTES[nom]}:{port or '8188'}"


sys.path.insert(0, str(REPO / "server"))
from core import config  # noqa: E402

cur = json.loads(LOCAL.read_text(encoding="utf-8")) if LOCAL.exists() else {}
if len(sys.argv) == 1:
    for lane, eps in (config.load().get("lanes") or {}).items():
        print(f"{lane:8} {', '.join(eps)}")
    sys.exit(0)

lane, machines = sys.argv[1], sys.argv[2:]
if lane not in VOIES or not machines:
    sys.exit(f"usage : voie.py <{'|'.join(VOIES)}> dgx2 [dgx1]")
eps = list(dict.fromkeys(url(m) for m in machines))
if LOCAL.exists():
    shutil.copy2(LOCAL, LOCAL.with_name(f"showrunner.local.json.{time.strftime('%Y%m%d-%H%M%S')}"))
cur.setdefault("lanes", {})[lane] = eps
LOCAL.write_text(json.dumps(cur, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"voie {lane} : {', '.join(eps)}\nécrit dans {LOCAL.name} (copie datée à côté) ; relancer : tools/portail.sh restart")
