// SHOWRUNNER — la voix de Plaits (Émilie Gillet, Mutable Instruments, licence
// MIT : voir LICENSE-plaits.txt) exposée à un AudioWorklet. Huit voix, chacune
// une plaits::Voice complète (les 24 moteurs, la porte basse, les enveloppes
// internes), chacune son tampon de 16 Ko comme le module (plaits.cc).
//
//   initialiser()                       une fois, après __wasm_call_ctors
//   tamponSortie(), tamponAux()         les deux sorties du dernier rendu (float)
//   rendre(voix, moteur, note, harmo, timbre, morph, porte, niveau, declin,
//          couleur, frappe, n)          n ≤ tailleBloc() échantillons à 48 kHz
//
// `porte` : la note tenue (le TRIG du module, branché : un front montant
// déclenche, sa hauteur tient les enveloppes des moteurs FM-6) ; `frappe` :
// 1 = la porte basse « pingée » par le déclenchement (LEVEL débranché : le son
// percussif du module, réglé par `declin` et `couleur`), 0 = LEVEL branché à
// `niveau` (la porte basse suit le niveau : un son tenu).
#include "plaits/dsp/voice.h"

using namespace plaits;

namespace {
const int kVoix = 8;
const size_t kRam = 16384;
Voice voix_[kVoix];
char ram_[kVoix][kRam];
stmlib::BufferAllocator alloc_[kVoix];
Voice::Frame trames_[kMaxBlockSize];
float sortie_[kMaxBlockSize];
float aux_[kMaxBlockSize];
}

#define EXPORT(nom) __attribute__((export_name(#nom)))

extern "C" {
EXPORT(initialiser) void initialiser() {
  for (int v = 0; v < kVoix; ++v) { alloc_[v].Init(ram_[v], kRam); voix_[v].Init(&alloc_[v]); }
}
EXPORT(reinitialiserVoix) void reinitialiserVoix(int v) {
  if (v < 0 || v >= kVoix) return;
  alloc_[v].Init(ram_[v], kRam);
  voix_[v].Init(&alloc_[v]);
}
EXPORT(tamponSortie) float* tamponSortie() { return sortie_; }
EXPORT(tamponAux) float* tamponAux() { return aux_; }
EXPORT(tailleBloc) int tailleBloc() { return (int)kMaxBlockSize; }
EXPORT(nombreVoix) int nombreVoix() { return kVoix; }
EXPORT(nombreMoteurs) int nombreMoteurs() { return kMaxEngines; }
EXPORT(rendre) void rendre(int v, int moteur, float note, float harmo, float timbre, float morph,
                           float porte, float niveau, float declin, float couleur, int frappe, int n) {
  if (v < 0 || v >= kVoix || n <= 0) return;
  if (n > (int)kMaxBlockSize) n = (int)kMaxBlockSize;
  Patch p;
  p.note = note; p.harmonics = harmo; p.timbre = timbre; p.morph = morph;
  p.frequency_modulation_amount = 0.0f; p.timbre_modulation_amount = 0.0f; p.morph_modulation_amount = 0.0f;
  p.engine = moteur; p.decay = declin; p.lpg_colour = couleur;
  Modulations m;
  m.engine = 0.0f; m.note = 0.0f; m.frequency = 0.0f; m.harmonics = 0.0f; m.timbre = 0.0f; m.morph = 0.0f;
  m.trigger = porte; m.level = niveau;
  m.frequency_patched = false; m.timbre_patched = false; m.morph_patched = false;
  m.trigger_patched = true; m.level_patched = !frappe;
  voix_[v].Render(p, m, trames_, (size_t)n);
  // la sortie du module est inversée (ChannelPostProcessor : gain × −32767) : on la remet à l'endroit
  for (int i = 0; i < n; ++i) { sortie_[i] = trames_[i].out * (-1.0f / 32768.0f); aux_[i] = trames_[i].aux * (-1.0f / 32768.0f); }
}
}
