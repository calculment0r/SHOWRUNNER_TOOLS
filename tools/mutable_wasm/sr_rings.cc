// SHOWRUNNER — Rings (Émilie Gillet, Mutable Instruments, licence MIT : voir
// musique/mutable/LICENSE-mutable.txt) exposé à un AudioWorklet : le résonateur
// tel que le module le fait tourner (rings/rings.cc, FillBuffer), sans audio
// branché dans IN — l'excitateur interne, frappé par chaque note (le STRUM).
//
//   initialiser()                       une fois, après __wasm_call_ctors
//   tamponSortie(), tamponAux()         ODD et EVEN du dernier rendu (float)
//   rendre(voix, modele, note, accord, structure, brillance, amorti, position,
//          frappe, n)                   n ≤ tailleBloc() échantillons à 48 kHz
//   rendreSynthe(polyphonie, effet, note, accord, structure, brillance, amorti,
//          position, frappe, n)         le synthé de cordes caché du module
//
// `modele` : 0..5, les six modèles de rings::Part (modal, cordes sympathiques,
// corde inharmonique, voix FM, cordes sympathiques en accords, corde et
// réverbe). La note est la note MIDI (tonique à 0, comme un V/OCT seul).
//
// LA POLYPHONIE. Le module la fait dans un seul Part (polyphonie 2 ou 4 : la
// résolution du modal tombe à 28 ou 12 modes par voix). On tient ici QUATRE
// Part entiers à la polyphonie 1 — chacun ses 60 modes, ses deux sorties (les
// deux jeux d'harmoniques) —, et le worklet distribue les notes à tour de rôle,
// comme le module. Pourquoi : un Part polyphonique ne donne à ses voix qui ne
// sonnent plus que du silence (Part::Process, « Inactive voices receive
// silence ») ; leurs filtres descendent alors sous le plus petit flottant
// normal, et un processeur x86 calcule ces nombres dénormaux cent fois plus
// lentement (mesuré : 2 % d'un cœur par voix, puis 30 à 50 % en quelques
// secondes). Le Cortex-M4 du module n'a pas ce défaut ; WebAssembly ne peut pas
// les mettre à zéro. Remède, juste par construction : l'entrée IN de chaque
// voix reçoit un bruit à −300 dBFS (le plancher d'un convertisseur réel est
// 150 dB au-dessus), qui garde chaque filtre loin des dénormaux. Le synthé de
// cordes reçoit le même bruit (il le recopie dans ses sorties : −300 dBFS).
// Rien n'est changé dans les sources de l'autrice.
#include "rings/dsp/part.h"
#include "rings/dsp/string_synth_part.h"

using namespace rings;

namespace {
const int kVoix = 4;
uint16_t reverb_[kVoix + 1][32768];   // un tampon de réverbe par Part, un pour le synthé (rings.cc)
Part part_[kVoix];
StringSynthPart synthe_;
int modele_[kVoix];
int polyphonieSynthe_ = 1;
float entree_[kMaxBlockSize];
float sortie_[kMaxBlockSize];
float aux_[kMaxBlockSize];
uint32_t alea_ = 1;

// le plancher : ±1e-15 (−300 dBFS), un signe au hasard par échantillon
void plancher(int n) {
  for (int i = 0; i < n; ++i) {
    alea_ = alea_ * 1664525u + 1013904223u;
    entree_[i] = (alea_ >> 31) ? 1e-15f : -1e-15f;
  }
}
void etat(PerformanceState* s, float note, int accord, int frappe) {
  s->strum = frappe != 0;
  s->internal_exciter = true;   // rien dans IN : l'excitateur du module
  s->internal_strum = false;    // le STRUM vient des notes
  s->internal_note = false;     // la note vient du V/OCT
  s->tonic = 0.0f;
  s->note = note;
  s->fm = 0.0f;
  s->chord = accord < 0 ? 0 : accord >= kNumChords ? kNumChords - 1 : accord;
}
}

#define EXPORT(nom) __attribute__((export_name(#nom)))

extern "C" {
EXPORT(initialiser) void initialiser() {
  for (int v = 0; v < kVoix; ++v) { part_[v].Init(reverb_[v]); modele_[v] = 0; }
  synthe_.Init(reverb_[kVoix]);
  polyphonieSynthe_ = 1;
  alea_ = 1;
}
EXPORT(tamponSortie) float* tamponSortie() { return sortie_; }
EXPORT(tamponAux) float* tamponAux() { return aux_; }
EXPORT(tailleBloc) int tailleBloc() { return (int)kMaxBlockSize; }
EXPORT(nombreVoix) int nombreVoix() { return kVoix; }
EXPORT(rendre) void rendre(int v, int modele, float note, int accord, float structure, float brillance,
                           float amorti, float position, int frappe, int n) {
  if (v < 0 || v >= kVoix || n <= 0) return;
  if (n > (int)kMaxBlockSize) n = (int)kMaxBlockSize;
  if (modele < 0) modele = 0;
  if (modele >= RESONATOR_MODEL_LAST) modele = RESONATOR_MODEL_LAST - 1;
  // set_model ne refait les résonateurs que s'il change (part.h)
  if (modele != modele_[v]) { part_[v].set_model(ResonatorModel(modele)); modele_[v] = modele; }
  PerformanceState s;
  etat(&s, note, accord, frappe);
  Patch p;
  p.structure = structure; p.brightness = brillance; p.damping = amorti; p.position = position;
  plancher(n);
  part_[v].Process(s, p, entree_, sortie_, aux_, (size_t)n);
}
EXPORT(rendreSynthe) void rendreSynthe(int polyphonie, int effet, float note, int accord, float structure,
                                       float brillance, float amorti, float position, int frappe, int n) {
  if (n <= 0) return;
  if (n > (int)kMaxBlockSize) n = (int)kMaxBlockSize;
  if (polyphonie < 1) polyphonie = 1;
  if (polyphonie > kMaxStringSynthPolyphony) polyphonie = kMaxStringSynthPolyphony;
  // set_polyphony seulement quand elle change, comme l'interface du module (ui.cc)
  if (polyphonie != polyphonieSynthe_) { synthe_.set_polyphony(polyphonie); polyphonieSynthe_ = polyphonie; }
  synthe_.set_fx(FxType(effet < 0 ? 0 : effet >= FX_LAST ? FX_LAST - 1 : effet));
  PerformanceState s;
  etat(&s, note, accord, frappe);
  Patch p;
  p.structure = structure; p.brightness = brillance; p.damping = amorti; p.position = position;
  plancher(n);
  synthe_.Process(s, p, entree_, sortie_, aux_, (size_t)n);
}
}
