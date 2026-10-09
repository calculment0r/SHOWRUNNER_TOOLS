#!/bin/bash
# SHOWRUNNER — compile Rings et Elements (Émilie Gillet, Mutable Instruments,
# licence MIT) en WebAssembly pour les instruments « Résonateur » et « Physique »
# d'ODIO : musique/mutable/rings.wasm, musique/mutable/elements.wasm. Même
# méthode, même chaîne et mêmes commits que Plaits (tools/plaits_wasm/) ;
# étude et mesures : docs/etudes/odio_synthes.md § 7 ; provenance :
# musique/PROVENANCE.md.
#
#   tools/mutable_wasm/construire.sh [dossier de travail]
#
# Il faut clang et wasm-ld (version 18, Ubuntu 24.04) et git. Pas de
# bibliothèque C (-ffreestanding) : ce que les sources appellent de la
# bibliothèque standard est dans ../plaits_wasm/shim, ../plaits_wasm/sr_math.cc
# et shim/ (deux en-têtes vides) ; les modules sont exposés par sr_rings.cc et
# sr_elements.cc. Rien n'est changé dans les sources de l'autrice.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
DEPOT="$(cd "$ICI/../.." && pwd)"
PLAITS="$ICI/../plaits_wasm"
TRAVAIL="${1:-/tmp/mutable_wasm}"
EURORACK=08460a69a7e1f7a81c5a2abcc7189c9a6b7208d4   # pichenettes/eurorack, 16/08/2023 (celui de Plaits)
STMLIB=d18def816c51d1da0c108236928b2bbd25c17481      # pichenettes/stmlib, 03/09/2023
mkdir -p "$TRAVAIL" && cd "$TRAVAIL"
prendre() {   # dépôt, commit, dossier, chemins
  local url=$1 rev=$2 dir=$3; shift 3
  if [ ! -d "$dir/.git" ]; then git init -q "$dir"; git -C "$dir" remote add origin "$url"; fi
  git -C "$dir" fetch -q --depth 1 origin "$rev"
  git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD -- "$@"
}
prendre https://github.com/pichenettes/eurorack "$EURORACK" eurorack rings/dsp rings/resources.cc rings/resources.h \
  elements/dsp elements/resources.cc elements/resources.h
prendre https://github.com/pichenettes/stmlib "$STMLIB" stmlib stmlib.h dsp utils LICENSE
# la notice MIT dans chaque fichier repris ; le refuser sinon (les tests, en GPL, ne sont pas pris)
for f in $(find eurorack/rings/dsp eurorack/elements/dsp -type f) eurorack/rings/resources.* eurorack/elements/resources.*; do
  grep -q "Permission is hereby granted" "$f" || { echo "pas de notice MIT : $f" >&2; exit 1; }
done
# `-I.` : stmlib est inclus par "stmlib/…" ; shim/ puis ../plaits_wasm/shim passent devant
CF="--target=wasm32 -O2 -msimd128 -mbulk-memory -msign-ext -ffreestanding -nostdlib -fno-exceptions -fno-rtti \
    -fno-c++-static-destructors -std=c++11 -DTEST -I$ICI/shim -I$PLAITS/shim -Ieurorack -I."
construire() {   # module : rings | elements
  local m=$1
  rm -rf "obj_$m" && mkdir "obj_$m"
  for f in $(cd eurorack && find "$m/dsp" -name '*.cc' | sort) "$m/resources.cc"; do
    clang++ $CF -c "eurorack/$f" -o "obj_$m/$(echo "$f" | tr / _).o"
  done
  for f in dsp/units.cc dsp/atan.cc utils/random.cc; do
    [ -f "stmlib/$f" ] && clang++ $CF -c "stmlib/$f" -o "obj_$m/stmlib_$(echo "$f" | tr / _).o"
  done
  clang++ $CF -c "$ICI/sr_$m.cc" -o "obj_$m/sr_$m.o"
  clang++ $CF -fno-builtin -c "$PLAITS/sr_math.cc" -o "obj_$m/sr_math.o"
  wasm-ld --no-entry --export=__wasm_call_ctors -z stack-size=131072 --gc-sections --strip-all "obj_$m"/*.o -o "$m.wasm"
  cp "$m.wasm" "$DEPOT/musique/mutable/$m.wasm"
  echo "musique/mutable/$m.wasm : $(wc -c < "$m.wasm") octets"
}
construire rings
construire elements
