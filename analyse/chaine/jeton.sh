#!/usr/bin/env bash
# Pose le jeton Hugging Face à sa place, depuis TON clavier — puis vérifie.
#   ~/reelbench/skill/jeton.sh
mkdir -p "$HOME/.cache/huggingface"
printf "Colle le jeton Hugging Face (hf_…) puis Entrée — rien ne s affiche : "
read -r -s tok; echo
tok="$(printf "%s" "$tok" | tr -d "[:space:]")"
case "$tok" in
  hf_*) ;;
  *) echo "✗ ça ne ressemble pas à un jeton (doit commencer par hf_) — rien écrit"; exit 1 ;;
esac
printf "%s" "$tok" > "$HOME/.cache/huggingface/token"
chmod 600 "$HOME/.cache/huggingface/token"
echo "✓ écrit dans ~/.cache/huggingface/token (${#tok} caractères)"
exec "$HOME/reelbench/skill/hf-check.sh"
