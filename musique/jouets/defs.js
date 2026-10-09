// JOUETS — ce que le nodal sait des quatorze jouets du « ODIO-O1 Playground »
// de Cal (et de l'horloge qui les cadence) : leur nom, leur taille, leurs
// réglages, leurs bornes. Aucune importation : modules.js l'ajoute à MODULES
// sans boucle d'import (musique/jouets/index.js fait tourner les jouets).
//
// Les réglages sont ceux du Playground, mêmes clés, mêmes bornes, mêmes
// défauts (`BLOCKS` de code.jsx) ; `face` les pose sur la carte. Les réglages
// « de port » (octave, durée, calage, tonique, gamme, note) sont ajoutés ici :
// ils disent ce qu'une note émise devient chez l'instrument branché.
//
// Les rôles : `effect` (le son passe dedans : REEL–2, RESSORT, AIMANT,
// ALCHIMIE — la décision d'ODIO_01, rack.ts : « ils ne déclenchent rien, ils
// TRAITENT »), `jouet` (des notes et des valeurs, pas de son).

export const NOTES = ['do', 'do#', 'ré', 'ré#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'si'];
// les gammes du Playground (SCALES), en demi-tons depuis la tonique
export const SCALES = [
  { n: 'pentatonique', d: [0, 2, 4, 7, 9] },
  { n: 'éthiopienne', d: [0, 1, 5, 7, 8] },
  { n: 'majeure', d: [0, 2, 4, 5, 7, 9, 11] },
  { n: 'mineure harm.', d: [0, 2, 3, 5, 7, 8, 11] },
  { n: 'blues', d: [0, 3, 5, 6, 7, 10] },
];
// le calage d'une note émise sur le transport, en temps (noire = 1)
export const CALAGES = [0, 0.125, 0.25, 0.5, 1];

// un réglage du Playground : P(k, libellé, min, max, défaut, unité, pas)
const P = (k, label, min, max, def, unit = '%', step = 0, fmt) => ({ k, label, min, max, def, unit, curve: 'lin', step, ...(fmt ? { fmt } : {}) });
const O = (k, label, opts, def = 0) => ({ k, label, opts, def, min: 0, max: opts.length - 1, step: 1 });
const g = (v) => (v / 100).toFixed(2);                                   // fmt() du Playground, unité « g »
const sgn = (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`;                // unité « n »
const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)}`);

// les réglages de port
const PORT = [
  P('oct', 'Octave', 1, 7, 4, '', 1),
  P('dur', 'Durée', 0.125, 4, 0.5, 'temps', 0),
  O('q', 'Calage', ['libre', '1/32', '1/16', '1/8', '1/4'], 2),
];
const NOTE = [O('note', 'Note', NOTES, 0)];
const GAMME = [O('root', 'Tonique', NOTES, 0), O('scale', 'Gamme', SCALES.map((s) => s.n), 0)];

const J = (o) => ({ jouet: true, role: 'jouet', color: 'coral-3', ...o });
const FX = (o) => ({ jouet: true, role: 'effect', color: 'cy', ...o });

// w, h : la taille du bloc dans le Playground ; la scène (le <canvas>) en
// fait w − 2 × h − 102 (bordure 1 px, en-tête 38, rangée de réglages 62)
export const JOUETS = {
  fount: J({ no: '00', name: 'Shuffle fountain', kind: 'aléa par gravité', hint: 'clique pour tirer', w: 780, h: 540,
    params: [P('force', 'Force', 10, 100, 62), P('rate', 'Débit', 0, 100, 34), P('fuse', 'Fusion', 100, 3000, 700, 'ms', 0, ms), P('hold', 'Maintien', 200, 6000, 2200, 'ms', 0, ms), ...NOTE, ...PORT],
    face: ['force', 'rate', 'fuse', 'hold'], ins: ['notes', 'mod'], outs: ['notes'] }),
  reel: FX({ no: '01', name: 'Reel–2', kind: 'écho à bande', hint: 'glisse sur la bande pour scruber', w: 640, h: 400,
    params: [P('speed', 'Vitesse', 0, 100, 46), P('fdb', 'Feedback', 0, 100, 52), P('wow', 'Wow', 0, 100, 22)],
    face: ['speed', 'fdb', 'wow'], ins: ['audio', 'mod'], outs: ['audio', 'mod'], modOut: 'bande' }),
  alch: FX({ no: '02', name: 'Alchimie', kind: 'mélange', hint: 'baisse le niveau : la fiole se penche', w: 420, h: 400,
    params: [P('level', 'Niveau', 0, 100, 72), P('visc', 'Viscosité', 0, 100, 40)],
    face: ['level', 'visc'], ins: ['audio', 'mod'], outs: ['audio', 'mod'], modOut: 'niveau' }),
  pong: J({ no: '03', name: 'Ping–pong', kind: 'générateur de trigs', hint: 'attrape la balle et lâche-la', w: 520, h: 400,
    params: [P('grav', 'Gravité', 20, 200, 92, 'g', 0, g), P('elast', 'Rebond', 40, 99, 82), P('spin', 'Effet', -100, 100, 0, '', 0, sgn), ...NOTE, ...PORT],
    face: ['grav', 'elast', 'spin'], ins: ['notes', 'mod'], outs: ['notes', 'mod'], modOut: 'hauteur' }),
  sling: J({ no: '04', name: 'Lance–pierre', kind: 'tir sur cible mobile', hint: 'tire la boule en arrière et lâche', w: 640, h: 440,
    params: [P('band', 'Tension', 30, 100, 72), P('tspd', 'Cible', 0, 100, 58), ...GAMME, ...PORT],
    face: ['band', 'tspd'], ins: ['notes', 'mod'], outs: ['notes'] }),
  sprg: FX({ no: '05', name: 'Ressort', kind: 'réverbération', hint: 'pince le ressort et relâche', w: 420, h: 440,
    params: [P('decay', 'Decay', 0, 100, 64), P('tens', 'Tension', 10, 100, 55), P('mix', 'Mix', 0, 100, 38)],
    face: ['decay', 'tens', 'mix'], ins: ['audio', 'notes', 'mod'], outs: ['audio', 'mod'], modOut: 'énergie' }),
  mag: FX({ no: '06', name: 'Aimant', kind: 'filtre à trajectoire', hint: 'dessine un chemin : il se boucle', w: 520, h: 440,
    params: [P('force', 'Champ', 10, 100, 62), O('bars', 'Boucle', ['1 mes.', '2 mes.', '4 mes.', '8 mes.'], 1), P('grain', 'Grain', 0, 100, 40)],
    face: ['force', 'bars', 'grain'], ins: ['audio', 'mod'], outs: ['audio', 'mod'], modOut: 'coupure' }),
  ninja: J({ no: '07', name: 'Ninja', kind: 'notes lancées', hint: 'tranche les formes · combo = harmoniques', w: 780, h: 480,
    params: [O('root', 'Tonique', NOTES, 0), O('scale', 'Gamme', SCALES.map((s) => s.n), 0), P('pull', 'Pull', 20, 100, 62), ...PORT],
    face: ['root', 'scale', 'pull'], ins: ['notes', 'mod'], outs: ['notes'] }),
  shake: J({ no: '08', name: 'Secousse', kind: 'boîte à billes', hint: 'secoue le bloc par son en-tête', w: 420, h: 480,
    params: [P('fric', 'Friction', 0, 100, 28), P('num', 'Billes', 3, 14, 8, '', 1, sgn), ...PORT],
    face: ['fric', 'num'], ins: ['notes', 'mod'], outs: ['notes', 'mod'], modOut: 'agitation' }),
  pach: J({ no: '09', name: 'Pachinko', kind: 'probabilités', hint: 'clique en haut pour lâcher une bille', w: 380, h: 480,
    params: [P('bias', 'Biais', -100, 100, 0, '', 0, sgn), P('rate', 'Débit', 0, 100, 30), ...GAMME, ...PORT],
    face: ['bias', 'rate'], ins: ['notes', 'mod'], outs: ['notes', 'mod'], modOut: 'bac' }),
  toast: J({ no: '10', name: 'Grille–pain', kind: 'trig à retardement', hint: 'baisse le levier · ça saute tout seul', w: 480, h: 340,
    params: [P('brown', 'Brunissage', 0, 100, 62), P('pop', 'Ressort', 30, 100, 72), P('slices', 'Tranches', 1, 2, 2, '', 1, sgn), ...PORT],
    face: ['brown', 'pop', 'slices'], ins: ['notes', 'mod'], outs: ['notes', 'mod'], modOut: 'chaleur' }),
  pin: J({ no: '11', name: 'Flipper', kind: 'notes à mémoriser', hint: 'survole · clic gauche / clic droit = palettes', w: 460, h: 660,
    params: [P('grav', 'Gravité', 20, 200, 104, 'g', 0, g), P('kick', 'Palette', 30, 100, 70), P('idle', 'Patience', 3, 14, 7, 's', 0, (v) => String(Math.round(v))), ...PORT],
    face: ['grav', 'kick', 'idle'], ins: ['notes', 'mod'], outs: ['notes'] }),
  inv: J({ no: '12', name: 'Navette', kind: 'défilement infini', hint: 'survole · flèches = déplacer · clic = tirer', w: 560, h: 660,
    params: [P('spd', 'Descente', 10, 100, 42), P('dens', 'Densité', 10, 100, 46), P('rate', 'Cadence', 20, 100, 64), ...GAMME, ...PORT],
    face: ['spd', 'dens', 'rate'], ins: ['notes', 'mod'], outs: ['notes'] }),
  newt: J({ no: '13', name: 'Berceau', kind: 'conservation du mouvement', hint: 'tire une bille de bout et lâche', w: 700, h: 420,
    params: [P('damp', 'Amorti', 0, 100, 12), P('num', 'Billes', 5, 7, 7, '', 1, sgn), P('len', 'Longueur', 40, 100, 74), ...PORT],
    face: ['damp', 'num', 'len'], ins: ['notes', 'mod'], outs: ['notes', 'mod'], modOut: 'énergie' }),
  // l'horloge n'est pas du Playground : elle donne aux jouets le temps du
  // transport (une note par division, tant qu'il joue)
  horloge: J({ no: '', name: 'Horloge', kind: 'le temps du transport', hint: 'une note par division, tant que le transport joue', color: 'ink2', scene: false,
    params: [O('div', 'Division', ['1/1', '1/2', '1/4', '1/8', '1/16'], 2), ...NOTE, P('oct', 'Octave', 1, 7, 4, '', 1), P('dur', 'Durée', 0.125, 4, 0.25, 'temps', 0)],
    face: ['div', 'note'], ins: [], outs: ['notes'] }),
};
export const JOUET_TYPES = Object.keys(JOUETS);
// les instruments qui reçoivent des notes (le lecteur de clips audio n'en joue pas)
export const NOTE_SOURCES = ['drums', 'synth', 'sampler', 'rythme', 'analog', 'acid', 'plaits', 'macro', 'resonateur', 'physique'];
