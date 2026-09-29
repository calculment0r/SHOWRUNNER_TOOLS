// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/timing.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Calculs de temps musical. Fonctions pures : c'est ici que vit toute la
 * logique rythmique, et c'est ce qui la rend testable sans AudioContext.
 */

/** Résolution du séquenceur : 4 steps par temps = doubles-croches. */
export const STEPS_PER_BEAT = 4

export function clamp(value        , min        , max        )         {
  return Math.min(max, Math.max(min, value))
}

export function secondsPerBeat(bpm        )         {
  return 60 / bpm
}

/** Durée d'un step en secondes. */
export function stepDuration(bpm        , stepsPerBeat         = STEPS_PER_BEAT)         {
  return secondsPerBeat(bpm) / stepsPerBeat
}

/**
 * Décalage de swing appliqué aux steps impairs.
 *
 * `swing` ∈ [0,1] suit la convention MPC (50 % → 75 %) :
 *   0    = binaire strict
 *   2/3  ≈ feel ternaire, ratio 2:1 entre les deux croches
 *   1    = shuffle extrême (le step impair colle au suivant)
 *
 * Le décalage n'est jamais cumulatif : il s'applique à l'instant émis, pas à
 * la grille. Sinon le tempo dériverait à chaque mesure.
 */
export function swingOffset(step        , swing        , stepDur        )         {
  if (step % 2 === 0) return 0
  return clamp(swing, 0, 1) * 0.5 * stepDur
}

/**
 * Instant absolu d'un step, swing et micro-timing compris.
 *
 * @param micro décalage fin en fraction de step (-0.5 à 0.5), pour pousser ou
 *              tirer une note sans quitter la grille.
 */
export function stepTime(
  gridTime        ,
  step        ,
  swing        ,
  stepDur        ,
  micro = 0,
)         {
  return gridTime + swingOffset(step, swing, stepDur) + clamp(micro, -0.5, 0.5) * stepDur
}

/** Conversion note MIDI → fréquence en Hz (La3 = 440 Hz). */
export function midiToFrequency(note        )         {
  return 440 * Math.pow(2, (note - 69) / 12)
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

/** Nom lisible d'une note MIDI, ex. 60 → "C4". */
export function midiToName(note        )         {
  const index = ((note % 12) + 12) % 12
  const octave = Math.floor(note / 12) - 1
  return `${NOTE_NAMES[index]}${octave}`
}
