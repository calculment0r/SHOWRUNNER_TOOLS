#!/usr/bin/env bash
# La chaîne FACTICE, pour éprouver le travail « analyse.run » du portail sans GPU ni modèle.
#
#   RUNS=/tmp/runs FAUX_PAUSE=1 bash analyse.sh <video.mp4 | URL> [titre] [--lang fr] [--sceneflow] [--youtube-id ID]
#
# Mêmes arguments, même dossier de travail (<RUNS>/<nom de la vidéo> ou <RUNS>/<id YouTube>), mêmes
# annonces (« ── N. … ») et mêmes sorties-marqueurs que chaine/analyse.sh, dans le même ordre — mais
# aucune mesure ni aucun modèle : les fichiers sont vides ou minimaux, et yt-dlp n'est pas appelé.
#
# FAUX_DEPUIS=<dossier d'un vrai run> (ex. ~/reelbench/runs/getaround, lu seulement) : ses shots.json,
# track.json, frames/, overlays/, portraits/ sont repris, et les étapes 9 et 9b sont les VRAIES (rendu,
# images embarquées, Studio : node, quelques secondes, sans GPU) avec la chaîne de FAUX_CHAINE
# (défaut : analyse/chaine). FAUX_ECHEC=1 : échoue à la fin, pour éprouver le message d'échec.
#
# RUNS n'a pas de défaut sous ~/reelbench : ce dossier-là est celui des vrais travaux.
set -euo pipefail

PAUSE="${FAUX_PAUSE:-1}"
RUNS="${RUNS:-/tmp/sr_faux_runs}"
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHAINE="${FAUX_CHAINE:-$ICI/../../chaine}"

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

say() { printf '\n\033[1m── %s\033[0m\n' "$*"; sleep "$PAUSE"; }

if [[ "$input" =~ ^https?:// ]]; then
  say "0. yt-dlp : $input (factice : rien n'est téléchargé)"
  # (pas d'apostrophe dans le message de ${…:?} : bash y ouvrirait une chaîne)
  [ -n "$ytid" ] || { echo "--youtube-id attendu : la chaîne factice ne télécharge rien" >&2; exit 1; }
  work="$RUNS/$ytid"; mkdir -p "$work"; cd "$work"
  [ -f source.mp4 ] || printf 'faux' > source.mp4
  [ -n "$title" ] || title="$ytid"
  video="source.mp4"
else
  video="$(realpath "$input")"
  base="$(basename "${video%.*}")"
  work="$RUNS/$base"; mkdir -p "$work"; cd "$work"
  [ -n "$title" ] || title="$base"
fi
echo "dossier : $work (chaîne factice, langue $lang)"

say "1. coupes, durées, mouvement"
if [ -n "${FAUX_DEPUIS:-}" ]; then
  for f in shots.json track.json; do [ -f "$FAUX_DEPUIS/$f" ] && cp "$FAUX_DEPUIS/$f" .; done
  for d in frames overlays portraits; do [ -d "$FAUX_DEPUIS/$d" ] && rm -rf "$d" && cp -r "$FAUX_DEPUIS/$d" .; done
else
  cat > shots.json <<JSON
{"source": "$(basename "$video")", "title": "$title", "lang": "$lang",
 "meta": {"durationSeconds": 4.0, "fps": 25, "width": 640, "height": 360},
 "cast": [{"id": "P1", "name": "Personne factice"}],
 "shots": [{"id": "S01", "start": 0, "end": 1.5, "seconds": 1.5, "lines": [{"start": 0.2, "end": 1.2, "speaker": "P1", "text": "essai"}]},
           {"id": "S02", "start": 1.5, "end": 4.0, "seconds": 2.5, "lines": []}]}
JSON
  mkdir -p frames
  for i in S01a S01b S02a S02b; do printf 'faux' > "frames/$i.jpg"; done
fi
mkdir -p sheets; [ -f sheets/sheet-a01.jpg ] || printf 'faux' > sheets/sheet-a01.jpg

say "2. transcription (factice)"
[ -f whisper.json ] || echo '{}' > whisper.json
say "3. suivi des personnes (factice)"
[ -f tracks.json ] || echo '[]' > tracks.json
say "4. ré-identification par le visage → casting, puis noms (factice)"
touch cast.done
say "4b. segmentation par personnage (factice)"
[ -f masks.json ] || echo '{}' > masks.json
say "5. répliques par plan, catégorie dialogue étayée"
say "6. qui parle"
say "7. VLM : factice"
touch vlm.done
say "8. portes"

say "9. rapport"
slug="$(echo "$title" | tr -cs '[:alnum:]' '-' | tr '[:upper:]' '[:lower:]' | sed 's/-$//')"
if [ -n "${FAUX_DEPUIS:-}" ]; then
  trk=(); [ -f track.json ] && trk=(--track track.json)
  node "$CHAINE/video-shots.mjs" render shots.json --md "${trk[@]}" > shots.md
  node "$CHAINE/video-shots.mjs" render shots.json --html "${trk[@]}" --video "$(basename "$video")" > rapport.html
  node "$CHAINE/inline-frames.mjs" rapport.html --frames frames -o "$slug-liste.html"
else
  echo "# $title (factice)" > shots.md
  printf '<!DOCTYPE html><html lang="fr"><meta charset="utf-8"><title>%s</title><p>dépouillement factice</p></html>\n' "$title" > "$slug-liste.html"
fi
say "9b. studio — vidéo, scénario, timeline, fiche du plan, silhouettes"
if [ -n "${FAUX_DEPUIS:-}" ]; then
  node "$CHAINE/studio.mjs" shots.json --video "$(basename "$video")" --frames frames --overlays overlays --portraits portraits \
    --report "$slug-liste.html" --css "$CHAINE/report.css" -o "$slug.html"
elif command -v node >/dev/null 2>&1; then
  # la vraie mise en page (la forme du portail, 29/09) sur les données factices : quelques millisecondes, sans GPU ;
  # le contrôle vérifie ainsi qu'une nouvelle analyse a la forme des films du dépôt
  node "$CHAINE/studio.mjs" shots.json --video "$(basename "$video")" --frames frames -o "$slug.html"
else
  printf '<!DOCTYPE html><html lang="fr"><meta charset="utf-8"><title>%s</title><video src="%s"></video><iframe src="%s"></iframe></html>\n' \
    "$title" "$(basename "$video")" "$slug-liste.html" > "$slug.html"
fi
echo "   → $slug.html (à servir à côté de $(basename "$video") ; #S03 ouvre sur le plan 3)"

if [ "$sceneflow" = 1 ]; then
  say "10. SceneFlow : projet + adhérence (factice)"
  echo '{}' > sceneflow.json
  echo '{}' > adherence.json
fi

[ -z "${FAUX_ECHEC:-}" ] || { echo "échec voulu (FAUX_ECHEC)" >&2; exit 3; }
say "terminé → $work"
ls -1 "$work" | sed 's/^/   /'
