#!/usr/bin/env bash
# Miroir de la séparation de sources (stems) entre DGX1 et DGX2, par le câble.
#
#   bash tools/mirror_stems.sh            copie ce qui manque d'un côté, puis vérifie
#   bash tools/mirror_stems.sh --check    vérifie seulement : rien n'est copié
#
# À lancer sur DGX1 ou sur DGX2, jamais depuis le PC (tools/mirror_lib.sh).
# Ce que le moteur du portail (server/tools/music_stems.py) utilise :
#   DGX2  les nœuds ComfyUI AudioSeparation (set-soft, Demucs et MDX-Net) et
#         audio-separation-nodes-comfyui ; Demucs htdemucs_ft (models/audio/Demucs) ;
#         BS-RoFormer viperx 1297 rangé pour le portail dans models/audio/RoFormer
#         (amorcé depuis ~/reelbench/models/audio-separator, même fichier que
#         ~/Maestro/app/ckpts/roformer sur DGX1)
#   DGX1  le venv ~/audio-studio/.venv (audio-separator 0.44.2, demucs 4.0.1),
#         lanceur de BS-RoFormer, et le cache torch hub de Demucs (htdemucs,
#         htdemucs_6s) que ce demucs charge hors ligne
# Le venv ~/audio-studio est celui d'AUDIOLAB (service de Cal, DGX1 seulement) :
# sur DGX1 il est lu, jamais écrit. La copie de DGX2 (sans service) avait perdu
# les 9 125 fichiers rangés sous un dossier nommé « data » ou « io » (dont
# torch/utils/data : import impossible) ; le miroir les lui rend, sans rien
# effacer.
# Les nœuds copiés n'apparaissent dans ComfyUI qu'après son redémarrage ; le
# script le dit (et si la file est vide), il ne relance rien.
. "$(dirname "$0")/mirror_lib.sh"

ITEMS=(
  "DGX2|ComfyUI/custom_nodes/AudioSeparation/"
  "DGX2|ComfyUI/custom_nodes/audio-separation-nodes-comfyui/"
  "DGX2|ComfyUI/models/audio/Demucs/htdemucs_ft.safetensors"
  "DGX2|ComfyUI/models/audio/Demucs/.catalog.csv"
  "DGX2|ComfyUI/models/audio/MDX/"
  "DGX2|ComfyUI/models/audio/RoFormer/"
  "DGX1|audio-studio/.venv/"
  "DGX1|.cache/torch/hub/checkpoints/955717e8-8726e21a.th"
  "DGX1|.cache/torch/hub/checkpoints/5c90dfd2-34c22ccb.th"
)
SEEDS=(
  "DGX2|ComfyUI/models/audio/RoFormer|reelbench/models/audio-separator"
)
# set-soft/audio_separation (Hugging Face, MIT), oid LFS de Demucs/htdemucs_ft.safetensors
EXPECT["ComfyUI/models/audio/Demucs/htdemucs_ft.safetensors"]="255c2650d26537ce4887c9c4cf08c6d4896fad2fecc0b78dc5b875b117bcc575|HF set-soft/audio_separation, LFS"
# dl.fbaipublicfiles.com/demucs : torch.hub vérifie le préfixe du sha256 écrit dans le nom
EXPECT[".cache/torch/hub/checkpoints/955717e8-8726e21a.th"]="8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4|Demucs htdemucs (préfixe 8726e21a du nom)"
EXPECT[".cache/torch/hub/checkpoints/5c90dfd2-34c22ccb.th"]="34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd|Demucs htdemucs_6s (préfixe 34c22ccb du nom)"

stems_imports() {
  local cpy="$HOME/comfyui-env/bin/python"
  [ "$(hostname)" = DGX1 ] && cpy="$HOME/ComfyUI/venv/bin/python"
  echo "  $(hostname)"
  printf '    ~/audio-studio/.venv : '
  "$HOME/audio-studio/.venv/bin/python" -c "import audio_separator.separator, demucs
from importlib.metadata import version
print('import audio_separator ok ·', version('audio-separator'), '· demucs', version('demucs'))" 2>&1 | tail -1
  local rof="$HOME/ComfyUI/models/audio/RoFormer/model_bs_roformer_ep_317_sdr_12.9755.ckpt"
  local orig
  for orig in "$HOME/Maestro/app/ckpts/roformer/model_bs_roformer_ep_317_sdr_12.9755.ckpt" \
              "$HOME/reelbench/models/audio-separator/model_bs_roformer_ep_317_sdr_12.9755.ckpt"; do
    [ -f "$orig" ] && [ -f "$rof" ] && { cmp -s "$orig" "$rof" && echo "    RoFormer du portail = ${orig#$HOME/} (octet pour octet)" \
                                                                || echo "    RoFormer du portail DIFFÈRE de ${orig#$HOME/}"; }
  done
  local code='
import sys, importlib.util
sys.argv = ["main.py"]
sys.path.insert(0, ".")
bad = 0
for name, deps in (("AudioSeparation", ("seconohe",)),
                   ("audio-separation-nodes-comfyui", ("librosa", "moviepy"))):
    p = "custom_nodes/" + name
    miss = [d for d in deps if importlib.util.find_spec(d) is None]
    try:
        spec = importlib.util.spec_from_file_location(name.replace("-", "_"), p + "/__init__.py", submodule_search_locations=[p])
        m = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = m
        spec.loader.exec_module(m)
        msg = "import ok, %d nœuds" % len(m.NODE_CLASS_MAPPINGS)
    except Exception as e:
        msg = "ÉCHEC import %s: %s" % (type(e).__name__, str(e)[:120])
        bad += 1
    print("    %s : %s%s" % (name, msg, (" ; manque : " + ", ".join(miss)) if miss else ""))
sys.exit(1 if bad else 0)'
  (cd "$HOME/ComfyUI" && timeout 300 "$cpy" -c "$code" 2>&1 | grep -E "^    " | tail -3)
}

STEMS_SEE='
import json, sys, urllib.request
host = sys.argv[1]
try:
    d = json.load(urllib.request.urlopen("http://%s:8188/object_info" % host, timeout=120))
    q = json.load(urllib.request.urlopen("http://%s:8188/queue" % host, timeout=10))
except Exception as e:
    print("    ComfyUI ne répond pas : %s" % e); sys.exit(0)
a = sorted(k for k in d if d[k].get("python_module", "").endswith("AudioSeparation"))
b = sorted(k for k in d if d[k].get("python_module", "").endswith("audio-separation-nodes-comfyui"))
m = d.get("AudioSeparateDemucs", {}).get("input", {}).get("required", {}).get("model", [[]])
opts = m[0] if isinstance(m[0], list) else (m[1].get("options", []) if len(m) > 1 else [])
disk = [o for o in opts if o.startswith("\U0001F4BE")]
run, pend = len(q.get("queue_running", [])), len(q.get("queue_pending", []))
print("    AudioSeparation %d nœuds · audio-separation-nodes-comfyui %d nœuds" % (len(a), len(b)))
print("    AudioSeparateDemucs, modèles sur disque : %s" % (", ".join(disk) or "aucun"))
print("    file : %d en cours, %d en attente" % (run, pend))
if not a or not b:
    print("    -> nœuds sur disque mais pas chargés : redémarrage de ComfyUI nécessaire "
          + ("(file vide : possible)" if run == 0 and pend == 0 else "(file occupée : attendre)"))
'

extra_checks() {
  echo "== imports Python"
  stems_imports
  remote stems_imports
  echo "== ce que voit ComfyUI :8188"
  echo "  $SELF"; python3 -c "$STEMS_SEE" 127.0.0.1
  echo "  $PEER_NAME (par le câble)"; python3 -c "$STEMS_SEE" "$PEER"
}

mirror_run
