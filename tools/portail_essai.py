#!/usr/bin/env python3
"""Un portail d'essai sans GPU, sans porte et sans connexion, pour une session cloud
(claude.ai/code) ou un agent qui veut voir une page en vrai : données jetables, voies
`cpu` et `image` sur la machine même, donc des moteurs factices (les réglages par défaut).

    python3 tools/portail_essai.py                 # http://127.0.0.1:8795/, données /tmp/sr_essai/data
    python3 tools/portail_essai.py 8796 /tmp/autre # un second portail, à côté (un agent, une copie)
    SR_LORA_MANIFEST=/chemin/trainers.json python3 tools/portail_essai.py   # un faux manifeste d'entraîneurs
    SR_OLLAMA_URL=http://127.0.0.1:11500 python3 tools/portail_essai.py   # l'agent d'Idéation sur un Ollama
                                                                  # (le faux : python3 tools/faux_ollama.py)
    SR_OLLAMA_VISION_URL=http://127.0.0.1:11501 …  # le palier des images sur un second Ollama (l'autre DGX)
    SR_SONS=toujours …                             # l'entrée transcrit les sons même avec Transcrire factice
    SR_CPU=2 …                                     # deux ouvriers sur la voie cpu (les paliers en parallèle)
    SR_FAUX_R2=1 python3 tools/portail_essai.py    # le lien d'écoute publié sans Cloudflare : le faux S3
                                                   # du selftest d'ecoute.py, un jeton d'essai (chanson/pilote_lien.mjs)
    SR_TELEGRAM_URL=http://127.0.0.1:8832 …        # les alertes de Cal sur un faux Telegram (python3
                                                   # tools/faux_telegram.py --port 8832 ; son jeton se colle
                                                   # dans Admin → Demandes → Alertes). Le réglage est toujours
                                                   # <données>/telegram-essai.json : jamais le bot de Cal
    SR_CF_API=http://127.0.0.1:8897 …              # un faux studio Character Factory (/api/characters, /files/…) :
                                                   # la section Character Factory du panneau Asset, son import
                                                   # (movie/pilote_video.mjs en monte un)
    SR_FAUX_MACHINES=1 …                           # deux faux ComfyUI nommés DGX2 et DGX1, hors des voies (rien n'y
                                                   # part), et la mesure de l'aperçu du nom remplacée (ni ssh ni
                                                   # nvidia-smi) : DGX2 à 37 % de GPU, DGX1 non mesuré —
                                                   # commun/pilote_apercu.mjs
    SR_PORTE=1 …                                   # la porte allumée (entrer par un pseudo : nico007 depuis
                                                   # 127.0.0.1, puis les comptes qu'on crée) — admin/pilote_invites.mjs,
                                                   # admin/pilote_tableau.mjs (ce que voit un membre),
                                                   # admin/pilote_teams.mjs

Le même que la session cloud du 05/10 faisait tourner à la main (docs/REPRISE.md, « Session
cloud ») : arrêter par son PID, jamais par `pkill -f` (le motif tue aussi le shell qui le tape).
Jamais sur les DGX : c'est le portail de la maison qui y tourne (tools/portail.sh).
"""

import json
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

config.CFG["auth"] = bool(os.environ.get("SR_PORTE"))   # sans SR_PORTE : pas de connexion, on entre en admin
# les alertes de Cal (core/alertes.py) : un réglage à ce portail, dans ses données — jamais ~/.config/showrunner
config.CFG["alertes"] = {"fichier": str(Path(data) / "telegram-essai.json")}
if os.environ.get("SR_TELEGRAM_URL"):
    config.CFG["alertes"].update(url=os.environ["SR_TELEGRAM_URL"], poll_s=5)
config.CFG["host"] = "127.0.0.1"
config.CFG["lanes"] = {"cpu": ["local"], "image": ["local"]}
if os.environ.get("SR_LORA_MANIFEST"):
    config.CFG["lora_manifest"] = os.environ["SR_LORA_MANIFEST"]
if os.environ.get("SR_OLLAMA_URL"):
    config.CFG["ideation_agent_url"] = os.environ["SR_OLLAMA_URL"]
if os.environ.get("SR_OLLAMA_VISION_URL"):   # server/tools/ideation_agent.py, route_vision
    config.CFG["ideation_agent_vision_url"] = os.environ["SR_OLLAMA_VISION_URL"]
if os.environ.get("SR_SONS"):
    config.CFG["ideation_agent_sons"] = os.environ["SR_SONS"]
if os.environ.get("SR_CF_API"):   # server/tools/core_api.py, _cf_get : jamais le studio de DGX1 depuis un essai
    config.CFG["cf_api"] = os.environ["SR_CF_API"]
if os.environ.get("SR_CPU", "").isdigit():
    config.CFG["lanes"]["cpu"] = ["local"] * max(1, min(4, int(os.environ["SR_CPU"])))
if os.environ.get("SR_FAUX_R2"):   # un jeton d'essai, lu par porte/r2_recopie.py (SR_R2_JETON) ; jamais le vrai
    jeton = Path(data) / "r2-essai.json"
    jeton.write_text(json.dumps({"account_id": "essai", "access_key_id": "AKIAESSAI", "secret_access_key": "essai",
                                 "bucket": "showrunner-bibliotheque"}), encoding="utf-8")
    jeton.chmod(0o600)
    os.environ["SR_R2_JETON"] = str(jeton)

import showrunner  # noqa: E402
from core import jobs  # noqa: E402

app = showrunner.build()
if os.environ.get("SR_FAUX_R2"):
    from tools import ecoute  # noqa: E402
    faux = ecoute._FauxS3()
    ecoute.R2_POINT = faux.point
    print(f"faux R2 : {faux.point} (le bucket showrunner-bibliotheque, en mémoire)", flush=True)
if os.environ.get("SR_FAUX_MACHINES"):   # server/tools/machines_apercu.py : la mesure est la seule chose remplacée
    from tools import admin, machines_apercu  # noqa: E402
    fc = admin._faux()
    _, _, u2 = fc.start(total_gb=130.0, free_gb=88.0)
    _, _, u1 = fc.start(total_gb=107.4, free_gb=31.0)
    config.CFG["extra_instances"] = [u2, u1]
    config.CFG["machine_names"] = {u2: "DGX2", u1: "DGX1"}
    # DGX2 : /proc/meminfo (42 Go sur 130) et nvidia-smi ; DGX1 : nvidia-smi sans mesure, la mémoire du faux ComfyUI
    sorties = {"DGX2": "gpu 37\nMemTotal:       127000000 kB\nMemAvailable:    86000000 kB\n", "DGX1": "gpu [N/A]\n"}
    machines_apercu.LIRE = lambda m, url: sorties.get(m, "")
    print(f"fausses machines : DGX2 {u2}, DGX1 {u1}", flush=True)
jobs.start()
print(f"portail d'essai : http://127.0.0.1:{port}/  (données {data}, PID {os.getpid()})", flush=True)
app.serve("127.0.0.1", int(port))
