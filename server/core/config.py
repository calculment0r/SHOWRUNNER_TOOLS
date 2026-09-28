"""Réglages du portail.

Les défauts ci-dessous décrivent les deux DGX de Cal ; chaque machine
peut les surcharger dans `showrunner.local.json`, à la racine du dépôt
(non versionné). Le serveur ne relit ce fichier qu'au démarrage.

Le portail tourne sur DGX2 (Wi-Fi en 5 GHz ; celui de DGX1 est accroché
en 2,4 GHz, voir Character_Factory/docs/REPRISE_CAL.md). Il calcule sur
les deux machines : DGX2 en local, DGX1 par le câble direct
(169.254.110.6).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LOCAL = REPO / "showrunner.local.json"

DEFAULTS: dict = {
    "host": "0.0.0.0",
    "port": 8790,
    # les images, vidéos, éléments et la file : hors du dépôt, qui est public
    "data_dir": str(Path.home() / "showrunner-data"),
    # une voie de calcul = une liste d'instances ComfyUI ; un ouvrier par
    # instance, donc deux rendus d'image à la fois quand les deux DGX sont là
    "lanes": {
        "image": ["http://127.0.0.1:8188", "http://169.254.110.6:8188"],
        # H3 : l'instance de test ComfyUI-H3TEST (:8189), arrêtée au repos
        # (sudo systemctl start comfyui-h3test) — jamais la production :8188
        "h3": ["http://127.0.0.1:8189", "http://169.254.110.6:8189"],
        "audio": ["http://127.0.0.1:8188"],
        "cpu": ["local", "local"],
        # Movie Analysis : la chaîne complète (analyse.sh) est lourde — une seule à la fois, sur la machine du portail
        "analyse": ["local"],
    },
    # Character Factory : son studio (DGX1, joint par le câble) pour lire
    # les personnages, et le lien que Cal ouvre (relais de DGX2)
    "cf_api": "http://169.254.110.6:8765",
    "cf_public": "http://192.168.10.247:8765/",
    # le code de Character Factory sur la machine : ses graphes Krea 2 et
    # Qwen-Image 2.1 éprouvés sont repris tels quels, pas recopiés
    "cf_repo": str(Path.home() / "Character_Factory"),
    # H3 veut ~50 Go : en dessous, on décharge les autres modèles ou on refuse
    "h3_min_free_gb": 45,
    "llm_url": "http://127.0.0.1:11434",
    "llm_model": "qwen3-vl-32b-32k",
}


def _merge(a: dict, b: dict) -> dict:
    out = dict(a)
    for k, v in b.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load() -> dict:
    cfg = DEFAULTS
    if LOCAL.exists():
        cfg = _merge(cfg, json.loads(LOCAL.read_text(encoding="utf-8")))
    env_port = os.environ.get("SHOWRUNNER_PORT")
    if env_port:
        cfg = {**cfg, "port": int(env_port)}
    env_data = os.environ.get("SHOWRUNNER_DATA")
    if env_data:
        cfg = {**cfg, "data_dir": env_data}
    return cfg


CFG = load()


def get(name: str, default=None):
    return CFG.get(name, default)


def data_dir() -> Path:
    p = Path(CFG["data_dir"]).expanduser()
    p.mkdir(parents=True, exist_ok=True)
    return p
