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
    # la porte (core/auth.py) : activée ; "auth": false seulement pour les essais
    "auth": True,
    "admin_name": "Cal",
    # la file (core/jobs.py) : un seul travail GPU du portail par machine
    # (Character_Factory/factory/memory.py : « un seul gros travail GPU à la
    # fois ») ; la famille déjà chargée d'abord parmi les 4 premiers ; un
    # travail ne se fait pas doubler plus de 3 fois
    "gpu_jobs_per_machine": 1,
    "group_window": 4,
    "max_overtake": 3,
    # mémoire d'un modèle inconnu : le seuil du studio (factory/memory.py, min_free_gb=30)
    "min_free_gb": 30,
    # les Ollama de chaque machine (page admin : modèles de texte chargés, décharger)
    "machine_ollama": {"DGX2": "http://127.0.0.1:11434", "DGX1": "http://169.254.110.6:11434"},
    # le journal du serveur (tools/portail.sh), lu par la page admin
    "log_file": str(Path.home() / "showrunner.log"),
}

# Les interrupteurs de câblage que la page admin lit et change : chaque
# outil déclare les siens (declare_switch), avec les valeurs que son code
# comprend. Ils s'écrivent dans showrunner.local.json et prennent effet au
# redémarrage du portail (le serveur ne relit ce fichier qu'au démarrage).
SWITCHES: dict[str, dict] = {}


def declare_switch(key: str, values: list, *, label: str, default=None, doc: str = "") -> None:
    SWITCHES[key] = {"key": key, "values": list(values), "label": label, "default": default, "doc": doc}


def read_local() -> dict:
    if not LOCAL.exists():
        return {}
    try:
        return json.loads(LOCAL.read_text(encoding="utf-8"))
    except ValueError:
        return {}


def write_local(key: str, value) -> dict:
    """Écrit une clé de showrunner.local.json, les autres gardées telles quelles."""
    data = read_local()
    data[key] = value
    tmp = LOCAL.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(LOCAL)
    return data


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
