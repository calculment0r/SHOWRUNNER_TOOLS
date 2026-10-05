#!/bin/bash
# SHOWRUNNER — compile Plaits (Émilie Gillet, Mutable Instruments, licence MIT)
# en WebAssembly pour l'instrument « Macro » d'ODIO : musique/plaits/plaits.wasm.
# Étude et mesures : docs/etudes/odio_synthes.md § 3.2 ; provenance :
# musique/PROVENANCE.md.
#
#   tools/plaits_wasm/construire.sh [dossier de travail]
#
# Il faut clang et wasm-ld (version 18 : ceux d'Ubuntu 24.04, la chaîne qui a
# compilé le WASM d'ODIO) et git. Les sources sont prises aux commits fixés
# ci-dessous, rien d'autre : pas de bibliothèque C (-ffreestanding) — ce que
# Plaits appelle de la bibliothèque standard est dans shim/ et sr_math.cc ; la
# voix est exposée par sr_plaits.cc.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
DEPOT="$(cd "$ICI/../.." && pwd)"
TRAVAIL="${1:-/tmp/plaits_wasm}"
EURORACK=08460a69a7e1f7a81c5a2abcc7189c9a6b7208d4   # pichenettes/eurorack, 16/08/2023
STMLIB=d18def816c51d1da0c108236928b2bbd25c17481      # pichenettes/stmlib, 03/09/2023
mkdir -p "$TRAVAIL" && cd "$TRAVAIL"
prendre() {   # dépôt, commit, dossier, chemins
  local url=$1 rev=$2 dir=$3; shift 3
  if [ ! -d "$dir/.git" ]; then git init -q "$dir"; git -C "$dir" remote add origin "$url"; fi
  git -C "$dir" fetch -q --depth 1 origin "$rev"
  git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD -- "$@"
}
prendre https://github.com/pichenettes/eurorack "$EURORACK" eurorack plaits/dsp plaits/resources.cc plaits/resources.h
prendre https://github.com/pichenettes/stmlib "$STMLIB" stmlib stmlib.h dsp utils LICENSE
# le code de Plaits : la notice MIT dans chaque fichier ; le refuser sinon
for f in $(find eurorack/plaits/dsp -type f) eurorack/plaits/resources.cc; do
  grep -q "Permission is hereby granted" "$f" || { echo "pas de notice MIT : $f" >&2; exit 1; }
done
# `-I.` : stmlib est inclus par "stmlib/…" ; shim/ passe devant (user_data.h sans mémoire flash)
CF="--target=wasm32 -O2 -msimd128 -mbulk-memory -msign-ext -ffreestanding -nostdlib -fno-exceptions -fno-rtti \
    -fno-c++-static-destructors -std=c++11 -DTEST -I$ICI/shim -Ieurorack -I."
rm -rf obj && mkdir obj
for f in $(cd eurorack && find plaits/dsp -name '*.cc' | sort) plaits/resources.cc; do
  clang++ $CF -c "eurorack/$f" -o "obj/$(echo "$f" | tr / _).o"
done
for f in dsp/units.cc dsp/atan.cc utils/random.cc; do
  [ -f "stmlib/$f" ] && clang++ $CF -c "stmlib/$f" -o "obj/stmlib_$(echo "$f" | tr / _).o"
done
clang++ $CF -c "$ICI/sr_plaits.cc" -o obj/sr_plaits.o
clang++ $CF -fno-builtin -c "$ICI/sr_math.cc" -o obj/sr_math.o
wasm-ld --no-entry --export=__wasm_call_ctors -z stack-size=131072 --gc-sections --strip-all obj/*.o -o plaits.wasm
cp plaits.wasm "$DEPOT/musique/plaits/plaits.wasm"
echo "musique/plaits/plaits.wasm : $(wc -c < plaits.wasm) octets"
