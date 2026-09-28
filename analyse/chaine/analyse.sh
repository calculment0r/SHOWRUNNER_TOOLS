#!/usr/bin/env bash
# Analyse complète d'une vidéo, en local sur le DGX — un seul appel.
#
#   ./analyse.sh <video.mp4 | URL YouTube> [titre] [--lang fr] [--sceneflow] [--youtube-id ID]
#
# Chaîne :
#   0. yt-dlp            si l'entrée est une URL : vidéo + sous-titres YouTube
#   1. seed / frames     coupes, durées, courbe de mouvement (ffmpeg)      ← mesuré
#   2. whisper           transcription horodatée, langue détectée          ← mesuré
#   3. yolo + bytetrack  pistes de personnes                                ← mesuré
#   4. reid (dinov2)     personnages stables entre plans → casting          ← calculé
#   5. audio par plan    répliques rapportées aux plans, dialogue étayé     ← calculé
#   6. qui parle         attribution des répliques aux personnages          ← calculé
#   7. VLM (ollama)      échelle, catégorie, mouvement, description, rythme ← jugé
#   8. 15 portes         vérification déterministe                         ← code
#   9. rapport           X-VERSE, images embarquées, un seul fichier
#  10. sceneflow         projet + adhérence, si demandé
#
# Chaque étape écrit dans <dossier de travail>/ ; relancer le script reprend
# ce qui existe déjà (les étapes lourdes sont sautées si leur sortie est là).
set -euo pipefail

SKILL="${SKILL:-$HOME/reelbench/skill}"
PY="${PY:-$HOME/comfyui-env/bin/python}"
YTDLP="${YTDLP:-$HOME/.venvs/ytdlp/bin/yt-dlp}"
VLM_API="${VLM_API:-http://127.0.0.1:11434/v1}"
VLM_MODEL="${VLM_MODEL:-mistral-vlm-16k}"

input="${1:?vidéo ou URL}"; shift
title="${1:-}"; [[ "$title" == --* ]] && title="" || { [ $# -gt 0 ] && shift; }
lang="fr"; sceneflow=0; ytid=""
while [ $# -gt 0 ]; do
  case "$1" in
    --lang) lang="$2"; shift 2 ;;
    --sceneflow) sceneflow=1; shift ;;
    --youtube-id) ytid="$2"; shift 2 ;;
    *) echo "option inconnue : $1" >&2; exit 1 ;;
  esac
done

say() { printf '\n\033[1m── %s\033[0m\n' "$*"; }

# 0. la source ----------------------------------------------------------------
if [[ "$input" =~ ^https?:// ]]; then
  say "0. yt-dlp : $input"
  ytid="${ytid:-$("$YTDLP" --print id "$input")}"
  work="$HOME/reelbench/runs/$ytid"; mkdir -p "$work"; cd "$work"
  [ -f source.mp4 ] || "$YTDLP" -f "bv*[height<=1080]+ba/b[height<=1080]" --merge-output-format mp4 -o source.mp4 "$input"
  "$YTDLP" --skip-download --write-auto-subs --write-subs --sub-langs "$lang.*,en.*" --convert-subs srt -o "youtube.%(ext)s" "$input" >/dev/null 2>&1 || true
  [ -n "$title" ] || title="$("$YTDLP" --print title "$input")"
  video="source.mp4"
else
  video="$(realpath "$input")"
  base="$(basename "${video%.*}")"
  work="$HOME/reelbench/runs/$base"; mkdir -p "$work"; cd "$work"
  [ -n "$title" ] || title="$base"
fi
echo "dossier : $work"

# 1. mesures ------------------------------------------------------------------
say "1. coupes, durées, mouvement"
[ -f shots.json ] || node "$SKILL/video-shots.mjs" seed "$video" --track track.json --title "$title" --lang "$lang" > shots.json
[ -d frames ] && [ "$(ls frames | wc -l)" -ge 2 ] || node "$SKILL/video-shots.mjs" frames shots.json --video "$video"
# l'image de fin du dernier plan tombe parfois après la dernière image décodable
last="$(node -e "const d=require('./shots.json');const s=d.shots.at(-1);console.log(s.id, (s.end-0.3).toFixed(2))")"
set -- $last; [ -f "frames/$1b.jpg" ] || ffmpeg -v error -y -ss "$2" -i "$video" -frames:v 1 -vf scale=480:-2 -q:v 3 "frames/$1b.jpg" || true
[ -f sheets/sheet-a01.jpg ] || node "$SKILL/video-shots.mjs" sheet shots.json --cols 4 --rows 6 >/dev/null

# 2. transcription --------------------------------------------------------------
say "2. transcription (whisper large-v3-turbo, langue détectée)"
[ -f whisper.json ] || "$PY" "$SKILL/whisper-run.py" "$video" whisper

# 3. pistes de personnes -----------------------------------------------------------
say "3. suivi des personnes (yolo11m + bytetrack)"
[ -f tracks.json ] || "$PY" "$SKILL/track-run.py" "$video" tracks.json

# 4. personnages ------------------------------------------------------------------
say "4. ré-identification par le visage → casting, puis noms"
# reid-face fusionne sous contrainte (jamais à l'image ensemble) ; le VLM ne NOMME que,
# il ne fusionne pas — testé : il prend DiCaprio pour Jonah Hill à 0.9 de confiance.
[ -f cast.done ] || { "$PY" "$SKILL/reid-face.py" shots.json "$video" tracks.json --face-threshold 1.05 --face-merge 1.25 --portraits portraits -o shots.json \
  && node "$SKILL/cast-name.mjs" shots.json --portraits portraits --api "$VLM_API" --model "$VLM_MODEL" -o shots.json && touch cast.done; } \
  || { echo "   ✗ casting : échec, voir ci-dessus" >&2; exit 1; }

# 4b. silhouettes ---------------------------------------------------------------
say "4b. segmentation par personnage (SAM 3, fichier local)"
if [ -f "$HOME/reelbench/models/sam3/sam3.pt" ]; then
  [ -f masks.json ] || "$PY" "$SKILL/segment-run.py" shots.json "$video" tracks.json --mode text -o shots.json || echo "   (segmentation sautée)"
else echo "   (pas de poids SAM 3 dans ~/reelbench/models/sam3/ — sautée)"; fi

# 5-6. répliques ------------------------------------------------------------------
say "5. répliques par plan, catégorie dialogue étayée"
node "$SKILL/captions-to-audio.mjs" shots.json whisper.srt -o shots.json
say "6. qui parle"
# avec le jeton Hugging Face : diarisation pyannote (mesuré) ; sans : règle de plateau (deviné, et dit)
if [ -s "$HOME/.cache/huggingface/token" ]; then
  [ -f turns.json ] || "$PY" "$SKILL/diarize-run.py" "$video" turns.json || true
fi
if [ -f turns.json ]; then
  # les lèvres tranchent le champ/contre-champ : quel visage bouge la bouche pendant chaque tour
  [ -f voices.json ] || "$PY" "$SKILL/lips-run.py" "$video" shots.json tracks.json turns.json voices.json || true
  if [ -f voices.json ]; then node "$SKILL/speakers.mjs" shots.json whisper.json --diarization turns.json --voices voices.json -o shots.json
  else node "$SKILL/speakers.mjs" shots.json whisper.json --diarization turns.json -o shots.json; fi
else node "$SKILL/speakers.mjs" shots.json whisper.json -o shots.json; fi

# 7-8. jugement + portes -------------------------------------------------------------
say "7. VLM : $VLM_MODEL"
[ -f vlm.done ] || { VIDEO_SHOTS_MJS="$SKILL/video-shots.mjs" node "$SKILL/shots-vlm.mjs" annotate shots.json --frames frames --track track.json \
  --api "$VLM_API" --model "$VLM_MODEL" --lang "$lang" --concurrency 4 --repair 3 --retries 3 -o shots.json && touch vlm.done; }
# le VLM a jugé sans les répliques : on les remet, et on repromeut les dialogues
node "$SKILL/captions-to-audio.mjs" shots.json whisper.srt -o shots.json >/dev/null
if [ -f turns.json ]; then node "$SKILL/speakers.mjs" shots.json whisper.json --diarization turns.json -o shots.json >/dev/null
else node "$SKILL/speakers.mjs" shots.json whisper.json -o shots.json >/dev/null; fi
node "$SKILL/frenchify.mjs" shots.json --check || true
say "8. portes"
node "$SKILL/video-shots.mjs" validate shots.json --track track.json --frames frames || true

# 9. rapport --------------------------------------------------------------------
say "9. rapport"
node "$SKILL/video-shots.mjs" render shots.json --md --track track.json > shots.md
node "$SKILL/video-shots.mjs" render shots.json --html --track track.json --video "$(basename "$video")" > rapport.html
slug="$(echo "$title" | tr -cs '[:alnum:]' '-' | tr '[:upper:]' '[:lower:]' | sed 's/-$//')"
node "$SKILL/inline-frames.mjs" rapport.html --frames frames -o "$slug-liste.html"
say "9b. studio — vidéo, scénario, timeline, fiche du plan, silhouettes"
node "$SKILL/studio.mjs" shots.json --video "$(basename "$video")" --frames frames --overlays overlays --portraits portraits \
  --report "$slug-liste.html" --css "$SKILL/report.css" -o "$slug.html"
echo "   → $slug.html (à servir à côté de $(basename "$video") ; #S03 ouvre sur le plan 3)"

# 10. sceneflow ------------------------------------------------------------------
if [ "$sceneflow" = 1 ]; then
  say "10. SceneFlow : projet + adhérence"
  node "$SKILL/sceneflow-export.mjs" shots.json ${ytid:+--youtube "$ytid"} -o sceneflow.json
  node "$SKILL/adherence.mjs" sceneflow.json shots.json --track track.json -o adherence.json | tail -1
fi

say "terminé → $work"
ls -1 "$work" | sed 's/^/   /'
