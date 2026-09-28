// MUSIQUE — la définition des modules : leurs réglages (bornes, défaut,
// unité), leurs voix, leurs couleurs. Une seule vérité pour le moteur
// (moteur.js), le rack, le nodal et le serveur (server/tools/music.py
// n'en garde que la liste des sortes, pour valider un projet).
//
// Bornes des nœuds Web Audio : MDN (BiquadFilterNode, DynamicsCompressorNode,
// DelayNode, StereoPannerNode, WaveShaperNode). Les réglages d'un module
// absents du projet prennent leur défaut ici : un projet neuf ne porte que
// ce qui diffère.

// ── les sortes de réglage ───────────────────────────────────
// { k, label, min, max, def, unit, curve: 'lin' | 'log', step, opts: [libellés] }
const P = (k, label, min, max, def, unit = '', curve = 'lin', step = 0) => ({ k, label, min, max, def, unit, curve, step });
const O = (k, label, opts, def = 0) => ({ k, label, opts, def, min: 0, max: opts.length - 1, step: 1 });

// Les voix de la DR-9, synthétisées (aucun échantillon). Recettes et
// sources dans moteur.js, au-dessus de chaque voix.
export const DRUM_VOICES = [
  { id: 'bd', name: 'Grosse caisse', short: 'BD' },
  { id: 'sd', name: 'Caisse claire', short: 'SD' },
  { id: 'cp', name: 'Clap', short: 'CP' },
  { id: 'ch', name: 'Charley fermé', short: 'CH' },
  { id: 'oh', name: 'Charley ouvert', short: 'OH' },
  { id: 'lt', name: 'Tom grave', short: 'LT' },
  { id: 'ht', name: 'Tom aigu', short: 'HT' },
  { id: 'cb', name: 'Cloche', short: 'CB' },
];

const drumParams = [P('lvl', 'Niveau', -40, 6, 0, 'dB')];
for (const v of DRUM_VOICES) {
  drumParams.push(P(`${v.id}_tune`, `${v.short} accord`, -12, 12, 0, 'dt', 'lin', 1));
  drumParams.push(P(`${v.id}_dec`, `${v.short} déclin`, 0.25, 4, 1, '×', 'log'));
  drumParams.push(P(`${v.id}_lvl`, `${v.short} niveau`, -40, 6, 0, 'dB'));
}

export const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];   // OscillatorNode.type (MDN)
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'];   // BiquadFilterNode.type (MDN)
export const DELAY_DIVS = [0.25, 0.5, 0.75, 1, 1.5, 2];            // en temps (noire = 1)

export const MODULES = {
  // ── sources ──
  drums: {
    name: 'DR-9', kind: 'boîte à rythmes', role: 'source', color: 'or',
    params: drumParams, face: ['lvl'],
  },
  synth: {
    name: 'Synthé', kind: 'soustractif', role: 'source', color: 'cy',
    params: [
      O('wave', 'Forme', ['Sinus', 'Triangle', 'Dent de scie', 'Carré'], 2),
      P('oct', 'Octave', -2, 2, 0, '', 'lin', 1),
      P('det', 'Désaccord', 0, 50, 8, 'ct'),
      P('cut', 'Coupure', 40, 16000, 1400, 'Hz', 'log'),
      // BiquadFilterNode passe-bas : Q est une résonance en dB (spécification Web Audio)
      P('res', 'Résonance', 0, 24, 6, 'dB'),
      P('fenv', 'Env. filtre', 0, 6, 2.5, 'oct'),
      P('fdec', 'Déclin filtre', 0.01, 3, 0.35, 's', 'log'),
      P('a', 'Attaque', 0.001, 3, 0.005, 's', 'log'),
      P('d', 'Déclin', 0.01, 3, 0.3, 's', 'log'),
      P('s', 'Tenue', 0, 1, 0.6, ''),
      P('r', 'Chute', 0.005, 4, 0.25, 's', 'log'),
      P('vol', 'Volume', -40, 6, -12, 'dB'),
    ],
    face: ['cut', 'res', 'd', 'vol'],
    sections: [['Oscillateur', ['wave', 'oct', 'det']], ['Filtre', ['cut', 'res', 'fenv', 'fdec']],
      ['Enveloppe', ['a', 'd', 's', 'r']], ['Sortie', ['vol']]],
  },
  sampler: {
    name: 'Échantillonneur', kind: 'lit un son', role: 'source', color: 'coral-2',
    params: [
      P('root', 'Note racine', 24, 96, 60, '', 'lin', 1),
      P('start', 'Départ', 0, 0.99, 0, ''),
      P('a', 'Attaque', 0.001, 2, 0.003, 's', 'log'),
      P('r', 'Chute', 0.005, 4, 0.2, 's', 'log'),
      P('vol', 'Volume', -40, 6, -3, 'dB'),
    ],
    face: ['root', 'start', 'vol'],
  },
  player: {
    name: 'Lecteur', kind: 'clips audio', role: 'source', color: 'grn2',
    // -6 dB : un son généré arrive mastérisé près de 0 dBFS (ACE-Step : -0,4 dB
    // mesuré le 28/09) ; posé à côté de la batterie, il saturerait la sortie
    params: [P('vol', 'Volume', -40, 6, -6, 'dB')], face: ['vol'],
  },
  // ── effets ──
  delay: {
    name: 'Délai', kind: 'écho synchronisé', role: 'effect', color: 'amb',
    params: [
      O('div', 'Temps', ['1/16', '1/8', '1/8 p.', '1/4', '1/4 p.', '1/2'], 1),
      P('fb', 'Retour', 0, 0.9, 0.35, ''),
      P('tone', 'Ton', 400, 12000, 3500, 'Hz', 'log'),
      P('mix', 'Mix', 0, 1, 0.3, ''),
    ],
    face: ['div', 'fb', 'mix'],
  },
  reverb: {
    name: 'Réverbération', kind: 'convolution', role: 'effect', color: 'cy',
    params: [
      P('time', 'Durée', 0.2, 8, 2.2, 's', 'log'),
      P('pre', 'Pré-délai', 0, 0.2, 0.015, 's'),
      P('damp', 'Amorti', 800, 16000, 6000, 'Hz', 'log'),
      P('mix', 'Mix', 0, 1, 0.25, ''),
    ],
    face: ['time', 'damp', 'mix'],
  },
  comp: {
    name: 'Compresseur', kind: 'dynamique', role: 'effect', color: 'coral-1',
    // bornes des AudioParam de DynamicsCompressorNode (MDN)
    params: [
      P('thr', 'Seuil', -60, 0, -18, 'dB'),
      P('ratio', 'Taux', 1, 20, 4, ':1', 'log'),
      P('att', 'Attaque', 0.001, 1, 0.01, 's', 'log'),
      P('rel', 'Relâche', 0.01, 1, 0.2, 's', 'log'),
      P('knee', 'Genou', 0, 40, 6, 'dB'),
      P('gain', 'Gain', 0, 24, 3, 'dB'),
    ],
    face: ['thr', 'ratio', 'gain'],
  },
  eq: {
    name: 'Égaliseur', kind: '3 bandes', role: 'effect', color: 'coral-3',
    params: [
      P('lf', 'Graves', 40, 600, 180, 'Hz', 'log'), P('lg', 'Gain gr.', -18, 18, 0, 'dB'),
      P('mf', 'Médiums', 200, 6000, 1000, 'Hz', 'log'), P('mg', 'Gain méd.', -18, 18, 0, 'dB'),
      P('hf', 'Aigus', 1500, 16000, 5000, 'Hz', 'log'), P('hg', 'Gain aig.', -18, 18, 0, 'dB'),
    ],
    face: ['lg', 'mg', 'hg'],
  },
  filter: {
    name: 'Filtre', kind: 'résonant', role: 'effect', color: 'cy',
    params: [
      O('type', 'Type', ['Passe-bas', 'Passe-haut', 'Passe-bande'], 0),
      P('freq', 'Fréquence', 30, 18000, 2400, 'Hz', 'log'),
      P('q', 'Résonance', 0.1, 20, 1, '', 'log'),
    ],
    face: ['freq', 'q'],
  },
  dist: {
    name: 'Distorsion', kind: 'saturation', role: 'effect', color: 'coral-1',
    params: [P('drive', 'Saturation', 0, 100, 30, ''), P('tone', 'Ton', 500, 16000, 6000, 'Hz', 'log'),
      P('mix', 'Mix', 0, 1, 1, ''), P('out', 'Sortie', -24, 6, -6, 'dB')],
    face: ['drive', 'mix'],
  },
  // ── la console ──
  strip: {
    name: 'Piste', kind: 'tranche', role: 'strip', color: 'ink2',
    params: [P('vol', 'Volume', -60, 6, 0, 'dB'), P('pan', 'Panoramique', -1, 1, 0, '')],
    face: ['vol', 'pan'],
  },
  master: {
    name: 'Sortie', kind: 'master', role: 'master', color: 'grn2',
    params: [P('vol', 'Volume', -60, 6, 0, 'dB')], face: ['vol'],
  },
};

export const EFFECT_TYPES = ['delay', 'reverb', 'comp', 'eq', 'filter', 'dist'];

export const TRACK_KINDS = {
  drums: { label: 'Batterie', src: 'drums', color: 'or', pattern: 'drums' },
  synth: { label: 'Synthé', src: 'synth', color: 'cy', pattern: 'notes' },
  sampler: { label: 'Échantillonneur', src: 'sampler', color: 'coral-2', pattern: 'notes' },
  audio: { label: 'Audio', src: 'player', color: 'grn2', pattern: null },
};
export const COLORS = ['or', 'cy', 'amb', 'grn2', 'coral-1', 'coral-2', 'coral-3'];

export const spec = (type, k) => MODULES[type].params.find((p) => p.k === k);
export const val = (mod, k) => {
  const v = mod.params?.[k];
  return v === undefined ? spec(mod.type, k).def : v;
};

// ── normaliser : 0..1 pour une molette ──────────────────────
export function toNorm(s, v) {
  if (s.opts) return s.opts.length > 1 ? v / (s.opts.length - 1) : 0;
  if (s.curve === 'log') return Math.log(v / s.min) / Math.log(s.max / s.min);
  return (v - s.min) / (s.max - s.min);
}
export function fromNorm(s, n) {
  n = Math.max(0, Math.min(1, n));
  let v = s.opts ? Math.round(n * (s.opts.length - 1))
    : s.curve === 'log' ? s.min * Math.pow(s.max / s.min, n) : s.min + n * (s.max - s.min);
  if (s.step) v = Math.round(v / s.step) * s.step;
  return v;
}
export function fmt(s, v) {
  if (s.opts) return s.opts[Math.round(v)] ?? '';
  if (s.unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} k` : `${Math.round(v)}`;
  if (s.unit === 's') return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
  if (s.unit === 'dB') return `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}`;
  if (s.unit === 'dt') return `${v > 0 ? '+' : ''}${Math.round(v)}`;
  if (s.k === 'pan') return Math.abs(v) < 0.02 ? 'C' : `${v < 0 ? 'G' : 'D'} ${Math.round(Math.abs(v) * 100)}`;
  if (s.k === 'root') return noteName(v);
  if (s.max <= 1 && s.min >= 0 && !s.unit) return `${Math.round(v * 100)}`;
  if (s.step >= 1) return `${Math.round(v)}`;
  return v.toFixed(v < 10 ? 1 : 0);
}
export const unitOf = (s) => (s.opts ? '' : s.unit === 'dt' ? 'demi-t.' : s.unit === 'ct' ? 'cents' : s.unit === '×' ? '×' : s.unit === 'oct' ? 'oct.' : s.unit);

const NOTE_FR = ['do', 'do#', 'ré', 'ré#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'si'];
export const noteName = (p) => `${NOTE_FR[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
export const isBlack = (p) => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
export const dbToGain = (db) => (db <= -59.9 ? 0 : Math.pow(10, db / 20));
