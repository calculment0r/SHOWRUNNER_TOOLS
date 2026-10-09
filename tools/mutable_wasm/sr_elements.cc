// SHOWRUNNER — Elements (Émilie Gillet, Mutable Instruments, licence MIT : voir
// musique/mutable/LICENSE-mutable.txt) exposé à un AudioWorklet. Le module est
// monophonique (elements/dsp/part.h : kNumVoices = 1, « la polyphonie est
// possible mais demande 16 modes, et ne sonne pas très bien ») : on tient ici
// QUATRE modules entiers, chacun son elements::Part (excitateurs, résonateur,
// réverbe et son tampon de 64 Ko, comme elements.cc), une note chacun.
//
//   initialiser()                       une fois, après __wasm_call_ctors
//   tamponPatch()                       les 19 réglages du module (elements::Patch,
//                                       dans l'ordre de patch.h), écrits par la page
//   tamponSortie(), tamponAux()         les deux sorties du dernier rendu (float)
//   rendre(voix, note, porte, force, resonateur, oeuf, n)
//                                       n ≤ tailleBloc() échantillons à 32 kHz
//
// Elements compte en 32 kHz (elements/dsp/dsp.h, kSampleRate) : le worklet
// rééchantillonne. `porte` : la note tenue (le GATE du module) ; `force` : la
// vélocité (l'entrée STRENGTH) ; `resonateur` : 0 modal, 1 corde, 2 cordes
// (Voice::set_resonator_model) ; `oeuf` : la voix cachée du module
// (OminousVoice, Part::set_easter_egg).
//
// Les entrées BLOW IN et STRIKE IN reçoivent un bruit à −300 dBFS : le
// plancher d'un convertisseur réel (le module en a un, 150 dB plus haut), qui
// garde les filtres loin des nombres dénormaux — un processeur x86 les calcule
// cent fois plus lentement, et WebAssembly ne peut pas les mettre à zéro (mesuré :
// 1,7 % d'un cœur par voix au lieu de 30 à 45 % une seconde après la note ;
// voir sr_rings.cc). Rien n'est changé dans les sources de l'autrice.
#include "elements/dsp/part.h"

using namespace elements;

namespace {
const int kVoix = 4;
uint16_t reverb_[kVoix][32768];
Part part_[kVoix];
float patch_[19];
float plancher_[kMaxBlockSize];
uint32_t alea_ = 1;
float sortie_[kMaxBlockSize];
float aux_[kMaxBlockSize];
}

#define EXPORT(nom) __attribute__((export_name(#nom)))

extern "C" {
EXPORT(initialiser) void initialiser() {
  for (int v = 0; v < kVoix; ++v) part_[v].Init(reverb_[v]);
  alea_ = 1;
  // les réglages de départ du module (Part::Init)
  const Patch& p = *part_[0].mutable_patch();
  const float d[19] = { p.exciter_envelope_shape, p.exciter_bow_level, p.exciter_bow_timbre, p.exciter_blow_level,
    p.exciter_blow_meta, p.exciter_blow_timbre, p.exciter_strike_level, p.exciter_strike_meta, p.exciter_strike_timbre,
    p.exciter_signature, p.resonator_geometry, p.resonator_brightness, p.resonator_damping, p.resonator_position,
    p.resonator_modulation_frequency, p.resonator_modulation_offset, p.reverb_diffusion, p.reverb_lp, p.space };
  for (int i = 0; i < 19; ++i) patch_[i] = d[i];
}
EXPORT(tamponPatch) float* tamponPatch() { return patch_; }
EXPORT(tamponSortie) float* tamponSortie() { return sortie_; }
EXPORT(tamponAux) float* tamponAux() { return aux_; }
EXPORT(tailleBloc) int tailleBloc() { return (int)kMaxBlockSize; }
EXPORT(nombreVoix) int nombreVoix() { return kVoix; }
EXPORT(frequence) float frequence() { return kSampleRate; }
EXPORT(rendre) void rendre(int v, float note, int porte, float force, int resonateur, int oeuf, int n) {
  if (v < 0 || v >= kVoix || n <= 0) return;
  if (n > (int)kMaxBlockSize) n = (int)kMaxBlockSize;
  Part& part = part_[v];
  Patch* p = part.mutable_patch();
  p->exciter_envelope_shape = patch_[0]; p->exciter_bow_level = patch_[1]; p->exciter_bow_timbre = patch_[2];
  p->exciter_blow_level = patch_[3]; p->exciter_blow_meta = patch_[4]; p->exciter_blow_timbre = patch_[5];
  p->exciter_strike_level = patch_[6]; p->exciter_strike_meta = patch_[7]; p->exciter_strike_timbre = patch_[8];
  p->exciter_signature = patch_[9]; p->resonator_geometry = patch_[10]; p->resonator_brightness = patch_[11];
  p->resonator_damping = patch_[12]; p->resonator_position = patch_[13]; p->resonator_modulation_frequency = patch_[14];
  p->resonator_modulation_offset = patch_[15]; p->reverb_diffusion = patch_[16]; p->reverb_lp = patch_[17];
  p->space = patch_[18];
  part.set_resonator_model(ResonatorModel(resonateur < 0 ? 0 : resonateur > 2 ? 2 : resonateur));
  part.set_easter_egg(oeuf != 0);
  PerformanceState s;
  s.gate = porte != 0;
  s.note = note;
  s.modulation = 0.0f;
  s.strength = force;
  // rien dans BLOW IN ni STRIKE IN : les excitateurs internes, sur le plancher (±1e-15)
  for (int i = 0; i < n; ++i) {
    alea_ = alea_ * 1664525u + 1013904223u;
    plancher_[i] = (alea_ >> 31) ? 1e-15f : -1e-15f;
  }
  part.Process(s, plancher_, plancher_, sortie_, aux_, (size_t)n);
}
}
