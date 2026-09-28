#!/usr/bin/env bash
# Vérifie le jeton Hugging Face et l accès aux trois dépôts verrouillés.
#   ~/reelbench/skill/hf-check.sh
TOKEN_FILE="$HOME/.cache/huggingface/token"
if [ ! -s "$TOKEN_FILE" ]; then
  echo "✗ jeton absent : $TOKEN_FILE"
  echo "  → hf auth login --token hf_xxx     (ou : printf hf_xxx > $TOKEN_FILE)"
  exit 1
fi
tok="$(tr -d "[:space:]" < "$TOKEN_FILE")"
who="$(curl -s -H "Authorization: Bearer $tok" https://huggingface.co/api/whoami-v2 | grep -o "\"name\":\"[^\"]*\"" | head -1 | cut -d\" -f4)"
[ -n "$who" ] && echo "✓ jeton valide — compte : $who" || { echo "✗ jeton refusé par Hugging Face"; exit 1; }
for repo in facebook/sam3 pyannote/speaker-diarization-3.1 pyannote/segmentation-3.0; do
  code="$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $tok" "https://huggingface.co/$repo/resolve/main/config.yaml")"
  code2="$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $tok" "https://huggingface.co/$repo/resolve/main/config.json")"
  if [ "$code" = 200 ] || [ "$code2" = 200 ]; then echo "✓ accès accordé : $repo"
  else echo "✗ accès refusé ($code/$code2) : $repo — ouvre https://huggingface.co/$repo et clique « Agree and access repository »"; fi
done
