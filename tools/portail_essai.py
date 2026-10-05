#!/usr/bin/env python3
"""Un portail d'essai sans GPU, sans porte et sans connexion, pour une session cloud
(claude.ai/code) ou un agent qui veut voir une page en vrai : données jetables, voies
`cpu` et `image` sur la machine même, donc des moteurs factices (les réglages par défaut).

    python3 tools/portail_essai.py                 # http://127.0.0.1:8795/, données /tmp/sr_essai/data
    python3 tools/portail_essai.py 8796 /tmp/autre # un second portail, à côté (un agent, une copie)
    SR_LORA_MANIFEST=/chemin/trainers.json python3 tools/portail_essai.py   # un faux manifeste d'entraîneurs

Le même que la session cloud du 05/10 faisait tourner à la main (docs/REPRISE.md, « Session
cloud ») : arrêter par son PID, jamais par `pkill -f` (le motif tue aussi le shell qui le tape).
Jamais sur les DGX : c'est le portail de la maison qui y tourne (tools/portail.sh).
"""

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
port = sys.argv[1] if len(sys.argv) > 1 else "8795"
data = sys.argv[2] if len(sys.argv) > 2 else "/tmp/sr_essai/data"
os.environ["SHOWRUNNER_PORT"] = port
os.environ["SHOWRUNNER_DATA"] = data
Path(data).mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(REPO / "server"))

from core import config  # noqa: E402

config.CFG["auth"] = False                       # pas de connexion : on entre en admin
config.CFG["host"] = "127.0.0.1"
config.CFG["lanes"] = {"cpu": ["local"], "image": ["local"]}
if os.environ.get("SR_LORA_MANIFEST"):
    config.CFG["lora_manifest"] = os.environ["SR_LORA_MANIFEST"]

import showrunner  # noqa: E402
from core import jobs  # noqa: E402

app = showrunner.build()
jobs.start()
print(f"portail d'essai : http://127.0.0.1:{port}/  (données {data}, PID {os.getpid()})", flush=True)
app.serve("127.0.0.1", int(port))
