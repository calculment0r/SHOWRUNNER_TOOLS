// ODIO — ce que les modules portés d'ODIO_01 importaient de « @odio/engine » :
// les mêmes fonctions, lues dans les pièces du moteur déjà reprises
// (musique/odio/, musique/PROVENANCE.md) et dans son scale.ts (ici : scale.js).
// Rien n'est réécrit : on ne fait que dire où elles vivent.
export { FREQ_TICKS, MAX_HZ, MIN_HZ, formatHz, freqToNorm, fromNormExp, fromNormLin, normToFreq, normToParam, paramToNorm, toNormExp, toNormLin } from './scale.js';
export { compressorCurve } from '../../odio/effects/comp.js';
export { quantize } from '../../odio/effects/crush.js';
export { saturate } from '../../odio/effects/drive.js';
export { DRUM_VOICES, VOICE_KNOBS, voiceParam } from '../../odio/instruments/rhythm-box.js';
