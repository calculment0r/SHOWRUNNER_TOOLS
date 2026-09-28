#!/usr/bin/env bash
# Le DGX est-il libre pour un calcul ? À lancer SUR la machine, juste avant chaque calcul GPU.
#
#   bash gpu-libre.sh [--ram-min 40] [--gpu-max 20]     → code 0 si libre, 1 sinon (et dit pourquoi)
#
# L'utilisateur fait tourner ses propres calculs (ComfyUI, 40 à 65 Go) sur la mémoire unifiée du GB10 ;
# deux grosses tâches GPU en même temps ont déjà gelé dgx2 (24/09). On ne lance donc rien si :
#   - le GPU travaille (moyenne sur 5 s au-dessus de --gpu-max %),
#   - une file ComfyUI (8188, 8189) a un travail en cours ou en attente,
#   - la mémoire disponible est sous --ram-min Go.
set -u
RAM_MIN=40; GPU_MAX=20
while [ $# -gt 0 ]; do case "$1" in --ram-min) RAM_MIN=$2; shift 2;; --gpu-max) GPU_MAX=$2; shift 2;; *) shift;; esac; done
occupe=()
tot=0; for i in 1 2 3 4 5; do u=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits | head -1); tot=$((tot + ${u:-0})); sleep 1; done
gpu=$((tot / 5))
[ "$gpu" -gt "$GPU_MAX" ] && occupe+=("GPU à ${gpu} % (seuil ${GPU_MAX} %)")
for p in 8188 8189; do
  q=$(curl -s -m 3 "http://127.0.0.1:$p/queue" | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); print(len(d.get("queue_running",[]))+len(d.get("queue_pending",[])))
except Exception: print(0)' 2>/dev/null)
  [ "${q:-0}" -gt 0 ] && occupe+=("ComfyUI :$p a $q travail(aux) en file")
done
dispo=$(awk '/MemAvailable/ {printf "%d", $2/1048576}' /proc/meminfo)
[ "$dispo" -lt "$RAM_MIN" ] && occupe+=("mémoire disponible ${dispo} Go (il en faut ${RAM_MIN})")
if [ ${#occupe[@]} -gt 0 ]; then
  echo "OCCUPÉ ($(hostname)) : ${occupe[*]}"; exit 1
fi
echo "LIBRE ($(hostname)) : GPU ${gpu} %, ${dispo} Go disponibles, files ComfyUI vides"
