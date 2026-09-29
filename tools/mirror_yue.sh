#!/usr/bin/env bash
# Miroir de YuE (YuE2) entre DGX1 et DGX2, par le câble direct.
#
#   bash tools/mirror_yue.sh            copie ce qui manque d'un côté, puis vérifie
#   bash tools/mirror_yue.sh --check    vérifie seulement : rien n'est copié
#
# À lancer sur DGX1 ou sur DGX2, jamais depuis le PC (tools/mirror_lib.sh).
# Références :
#   DGX2  les poids ComfyUI (repack Comfy-Org de YuE2, SheetSage2 pour les
#         reprises), les nœuds Olm-YuE2 et YuE2-Trainer, les workflows YuE2
#         de Cal (user/default/workflows/AUDIO/0{1,2,6,7}_YuE2_*.json)
#   DGX1  le dépôt autonome ~/YuE (son .venv, webui.py) et le cache Hugging
#         Face m-a-p/YuE2-3B et m-a-p/YuE2-Vae
# Les rendus (~/YuE/out, ~/YuE/webui-out) et les __pycache__ ne sont pas copiés.
# Les nœuds Olm/Trainer n'apparaissent dans ComfyUI qu'après son redémarrage :
# le script le dit, et dit si la file est vide ; il ne relance rien.
. "$(dirname "$0")/mirror_lib.sh"

ITEMS=(
  "DGX2|ComfyUI/models/checkpoints/yue2_3b_bf16.safetensors"
  "DGX2|ComfyUI/models/checkpoints/yue2_3b_int8_convrot.safetensors"
  "DGX2|ComfyUI/models/audio_encoders/sheetsage2_bf16.safetensors"
  "DGX2|ComfyUI/models/.cache/huggingface/download/checkpoints/yue2_3b_bf16.safetensors.metadata"
  "DGX2|ComfyUI/models/.cache/huggingface/download/checkpoints/yue2_3b_int8_convrot.safetensors.metadata"
  "DGX2|ComfyUI/models/.cache/huggingface/download/audio_encoders/sheetsage2_bf16.safetensors.metadata"
  "DGX2|ComfyUI/custom_nodes/o-l-l-i_ComfyUI-Olm-YuE2/"
  "DGX2|ComfyUI/custom_nodes/ComfyUI-YuE2-Trainer/"
  "DGX2|ComfyUI/user/default/workflows/AUDIO/01_YuE2_texte_vers_musique.json"
  "DGX2|ComfyUI/user/default/workflows/AUDIO/02_YuE2_reprise_de_morceau.json"
  "DGX2|ComfyUI/user/default/workflows/AUDIO/06_YuE2_entrainement_LoRA.json"
  "DGX2|ComfyUI/user/default/workflows/AUDIO/07_YuE2_generation_avec_LoRA.json"
  "DGX1|YuE/"
  "DGX1|.cache/huggingface/hub/models--m-a-p--YuE2-3B/"
  "DGX1|.cache/huggingface/hub/models--m-a-p--YuE2-Vae/"
)
EXCLUDES["YuE/"]="--exclude=/out/ --exclude=/webui-out/"
# l'empreinte LFS de Hugging Face (Comfy-Org/YuE2, commit 8e6fcf0f), relevée
# dans les .metadata de hf download sur DGX2 le 15/09
EXPECT["ComfyUI/models/checkpoints/yue2_3b_bf16.safetensors"]="33765adbf9813c9a50318218760b2fd819a319862460a04884607581961c6fee|Comfy-Org/YuE2, LFS"
EXPECT["ComfyUI/models/checkpoints/yue2_3b_int8_convrot.safetensors"]="96fe199377309001ed8cd26a944baeee8cc31a20ba7c36d1d3c0a7e1f4149db6|Comfy-Org/YuE2, LFS"
EXPECT["ComfyUI/models/audio_encoders/sheetsage2_bf16.safetensors"]="5fd960ce3df281e3f3a889d174584d88f96247711480cf96377b12d7e8b6adc5|Comfy-Org/YuE2, LFS"

# ── les imports, dans les deux venvs ──
# le python de ComfyUI :8188 diffère : ~/ComfyUI/venv sur DGX1, ~/comfyui-env sur DGX2
yue_imports() {
  local cpy="$HOME/comfyui-env/bin/python"
  [ "$(hostname)" = DGX1 ] && cpy="$HOME/ComfyUI/venv/bin/python"
  echo "  $(hostname)"
  printf '    ~/YuE/.venv : '
  "$HOME/YuE/.venv/bin/python" -c "import yue2, torch
from importlib.metadata import version
print('import yue2 ok · yue2-infer', version('yue2-infer'), '· torch', torch.__version__, '· CUDA', torch.cuda.is_available())" 2>&1 | tail -1
  local code='
import sys, importlib.util
sys.argv = ["main.py"]
sys.path.insert(0, ".")
bad = 0
for name, deps in (("o-l-l-i_ComfyUI-Olm-YuE2", ("tiktoken", "accelerate")),
                   ("ComfyUI-YuE2-Trainer", ("soundfile", "matplotlib"))):
    p = "custom_nodes/" + name
    try:
        spec = importlib.util.spec_from_file_location(name, p + "/__init__.py", submodule_search_locations=[p])
        m = importlib.util.module_from_spec(spec)
        sys.modules[name] = m
        spec.loader.exec_module(m)
        msg = "import ok, %d nœuds" % len(m.NODE_CLASS_MAPPINGS)
    except Exception as e:
        msg = "ÉCHEC import %s: %s" % (type(e).__name__, e)
        bad += 1
    miss = [d for d in deps if importlib.util.find_spec(d) is None]
    print("    %s : %s ; %s" % (name, msg, ("manque à l exécution : " + ", ".join(miss)) if miss else "dépendances d exécution présentes"))
sys.exit(1 if bad else 0)'
  (cd "$HOME/ComfyUI" && "$cpy" -c "$code" 2>&1 | grep -v "^\s*$" | tail -3)
}

# ── ce que chaque ComfyUI :8188 voit (lecture de /object_info et /queue) ──
YUE_SEE='
import json, sys, urllib.request
host = sys.argv[1]
try:
    d = json.load(urllib.request.urlopen("http://%s:8188/object_info" % host, timeout=120))
    q = json.load(urllib.request.urlopen("http://%s:8188/queue" % host, timeout=10))
except Exception as e:
    print("    ComfyUI ne répond pas : %s" % e); sys.exit(0)
yue = sorted(k for k in d if "YuE2" in k or "SheetSage2" in k)
core = [k for k in yue if d[k].get("python_module", "").startswith("comfy_extras")]
olm = [k for k in yue if "Olm" in d[k].get("python_module", "")]
trn = [k for k in yue if "Trainer" in d[k].get("python_module", "")]
def opts(node, inp):
    s = d.get(node, {}).get("input", {}).get("required", {}).get(inp, [[]])
    return s[0] if isinstance(s[0], list) else (s[1].get("options", []) if len(s) > 1 else [])
ck = [c for c in opts("CheckpointLoaderSimple", "ckpt_name") if "yue2" in c]
ae = [c for c in opts("AudioEncoderLoader", "audio_encoder_name") if "sheetsage2" in c]
run, pend = len(q.get("queue_running", [])), len(q.get("queue_pending", []))
print("    nœuds du cœur %d (%s) · Olm-YuE2 %d · YuE2-Trainer %d" % (len(core), ", ".join(core), len(olm), len(trn)))
print("    CheckpointLoaderSimple voit : %s" % (", ".join(ck) or "aucun yue2"))
print("    AudioEncoderLoader voit : %s" % (", ".join(ae) or "aucun sheetsage2"))
print("    file : %d en cours, %d en attente" % (run, pend))
if not olm or not trn:
    print("    -> nœuds Olm/Trainer sur disque mais pas chargés : redémarrage de ComfyUI nécessaire "
          + ("(file vide : possible)" if run == 0 and pend == 0 else "(file occupée : attendre)"))
'

extra_checks() {
  echo "== imports Python"
  yue_imports
  remote yue_imports
  echo "== ce que voit ComfyUI :8188"
  echo "  $SELF"; python3 -c "$YUE_SEE" 127.0.0.1
  echo "  $PEER_NAME (par le câble)"; python3 -c "$YUE_SEE" "$PEER"
}

mirror_run
