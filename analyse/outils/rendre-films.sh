#!/usr/bin/env bash
# Re-rendre les pages des films du dépôt (analyse/analyses/<film>/index.html) dans la forme du portail
# (chaine/studio.mjs, 29/09), depuis leurs données — sans GPU, sans réseau, quelques secondes.
#
#   bash analyse/outils/rendre-films.sh [getaround wall …]      (node 18+ ; depuis n'importe où)
#
# La recette est celle de MOVIE_ANALYSE (HANDOFF-MOVIE-ANALYSIS.md §3) : les images (images clés, silhouettes
# SAM 3, portraits refaits à la main le 27-28/09) sont ressorties de la page publiée elle-même
# (outils/ressors.mjs) — ce sont celles que Cal a validées, les dossiers de calcul (~/reelbench/runs/<film>) n'ont
# pas les portraits refaits ; les données sont celles du dossier du film : shots.json (la sortie de la chaîne),
# corrections.json, diarisation.json, mots.json, son.json. La vidéo reste sur R2 (--video-url), son repli est le
# fichier posé à côté de la page. Refaire une page déjà dans la forme du portail rend la même page : ses images
# se ressortent de la même façon.
set -euo pipefail
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANALYSE="$(cd "$ICI/.." && pwd)"
S=https://movie-analysis-partage.luxigone.workers.dev
films=("$@"); [ ${#films[@]} -gt 0 ] || films=(getaround wall)
for film in "${films[@]}"; do
  d="$ANALYSE/analyses/$film"
  [ -f "$d/index.html" ] && [ -f "$d/shots.json" ] || { echo "$film : pas de page ou pas de shots.json dans $d" >&2; exit 1; }
  video="$(node -e 'const p=require(process.argv[1]); console.log(p.video || "")' "$d/portail.json" 2>/dev/null || true)"
  video="${video:-$film.mp4}"
  titre="$(node -e 'const p=require(process.argv[1]); console.log(p.titre || "")' "$d/portail.json" 2>/dev/null || true)"
  t="$(mktemp -d)"
  node "$ICI/ressors.mjs" "$d/index.html" "$t"
  for f in shots.json corrections.json diarisation.json mots.json son.json; do [ -f "$d/$f" ] && cp "$d/$f" "$t/"; done
  ( cd "$t" && node "$ANALYSE/chaine/studio.mjs" shots.json --video "$video" --video-url "$S/video" \
      --frames frames --overlays overlays --portraits portraits --slug "$film" ${titre:+--titre "$titre"} \
      --depot calculment0r/MOVIE_ANALYSE --branche claude/new-session-forpe9 --corrections-url "$S/corrections" -o index.html )
  mv "$t/index.html" "$d/index.html"
  rm -rf "$t"
  echo "$film → $d/index.html"
done
