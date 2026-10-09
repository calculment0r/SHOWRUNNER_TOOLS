// MUSIQUE — la définition des modules : leurs réglages (bornes, défaut,
// unité), leurs voix, leurs couleurs ; les gammes, les étiquettes de
// section, les préréglages et les modèles de motifs. Une seule vérité pour
// le moteur (moteur.js), les vues et le serveur (server/tools/music.py n'en
// garde que la liste des sortes, pour valider un projet).
//
// Bornes des nœuds Web Audio : MDN (BiquadFilterNode, DynamicsCompressorNode,
// DelayNode, StereoPannerNode, WaveShaperNode). Les réglages d'un module
// absents du projet prennent leur défaut ici : un projet neuf ne porte que
// ce qui diffère.

// Les instruments et effets d'ODIO (le prototype de Cal, calculment0r/ODIO_01
// @ 6d8a7ed) : portés tels quels dans ./odio/ (musique/PROVENANCE.md). Leurs
// réglages sont lus sur leurs propres descripteurs (getParameters), jamais
// recopiés ici : une seule vérité.
import { AnalogSynth } from './odio/instruments/analog-synth.js';
import { AcidBass } from './odio/instruments/acid-bass.js';
import { RhythmBox } from './odio/instruments/rhythm-box.js';
import { PlaitsSynth } from './odio/instruments/plaits-synth.js';
// Macro : Plaits complet, ses 24 moteurs (06/10 ; musique/plaits/, même contrat que les instruments d'ODIO)
import { MacroPlaits } from './plaits/macro.js';
// Résonateur (Rings) et Physique (Elements) : la même méthode que Macro (09/10 ; musique/mutable/)
import { Resonateur } from './mutable/resonateur.js';
import { Physique } from './mutable/physique.js';
import { VOIX } from './odio/instruments/drums-voices.js';
import { ReverbEffect } from './odio/effects/reverb.js';
import { ChorusEffect } from './odio/effects/chorus.js';
import { DelayEffect } from './odio/effects/delay.js';
import { CompEffect } from './odio/effects/comp.js';
import { EqEffect } from './odio/effects/eq3.js';
import { FilterEffect } from './odio/effects/filter.js';
import { DriveEffect } from './odio/effects/drive.js';
import { CrushEffect } from './odio/effects/crush.js';
import { MixTable } from './odio/effects/table.js';
import { VolumeEffect } from './odio/effects/volume.js';
import { JOUETS } from './jouets/defs.js';   // jouets : les quatorze jouets du Playground de Cal (musique/jouets/)
import { ARP_MODES, ARP_DIVS } from './arpege.js';   // l'arpégiateur des instruments mélodiques (06/10)
import { BANQUE } from './prereglages.js';   // la banque de préréglages (06/10, docs/etudes/odio_synthes.md)
import { declarer } from './facettes.js';   // attracteurs : la sorte de chaque réglage, sa facette (09/10)

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
const drumSortes = { lvl: 'niveau' };
for (const v of DRUM_VOICES) {
  drumParams.push(P(`${v.id}_tune`, `${v.short} accord`, -12, 12, 0, 'dt', 'lin', 1));
  drumParams.push(P(`${v.id}_dec`, `${v.short} déclin`, 0.25, 4, 1, '×', 'log'));
  drumParams.push(P(`${v.id}_lvl`, `${v.short} niveau`, -40, 6, 0, 'dB'));
  Object.assign(drumSortes, { [`${v.id}_tune`]: 'accord', [`${v.id}_dec`]: 'enveloppe', [`${v.id}_lvl`]: 'niveau' });
}

export const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];   // OscillatorNode.type (MDN)
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'];   // BiquadFilterNode.type (MDN)
export const DELAY_DIVS = [0.25, 0.5, 0.75, 1, 1.5, 2];            // en temps (noire = 1)
// l'oscillateur B : « comme A » garde le comportement d'avant (un second
// oscillateur de la même forme, là seulement si le désaccord est non nul)
export const WAVES2 = ['Comme A', 'Sinus', 'Triangle', 'Dent de scie', 'Carré', 'Aucun'];
// les formes du LFO du Synthé (OscillatorNode.type, MDN)
export const LFO_WAVES = ['sine', 'triangle', 'square', 'sawtooth'];
// L'arpège (arpege.js) : les mêmes quatre réglages sur chaque instrument
// mélodique ; « Non » le laisse éteint (le motif joue tel qu'il est écrit).
// Ils sont lus au moment de planifier les notes, pas par un AudioParam : ils
// ne s'automatisent pas.
export const ARP_PARAMS = [
  O('arp', 'Arpège', ARP_MODES, 0),
  O('arp_div', 'Division', ARP_DIVS.map(([l]) => l), 3),
  P('arp_oct', 'Octaves', 1, 4, 1, '', 'lin', 1),
  P('arp_gate', 'Durée', 0.05, 1, 0.5, ''),
];
const ARP_SORTES = { arp_oct: 'hauteur', arp_gate: 'duree' };
// LE SWING des batteries (09/10 : la facette « swing » de la lane RYTHME n'avait
// rien à capter) : la seconde double croche de chaque paire tombe à swing % de la
// paire — 50 % droit, 66 % ternaire, 75 % au plus : la loi de la MPC de Roger Linn
// (« 50 % swing means no swing, 66 % is a perfect triplet swing », entretien à
// Attack Magazine, 2013). Lu au moment de planifier les coups (moteur.js,
// Graph.notes), comme l'arpège : il ne s'automatise pas.
export const SWING_PARAMS = [P('swing', 'Swing', 50, 75, 50, '%')];
// ce que lit le planificateur, pas un nœud du son : l'arpège, le swing
export const PLANIFIES = new Set([...ARP_PARAMS, ...SWING_PARAMS].map((x) => x.k));

// LES SORTES DES RÉGLAGES (09/10, musique/facettes.js) : chaque module dit,
// pour chacun de ses réglages continus, ce qu'il est ; la sorte donne la
// facette qu'un attracteur capte, ou le met hors attracteurs. Un réglage
// discret n'a rien à déclarer (hors d'office). Un module neuf déclare les
// siens : la garde (server/tools/music_attracteurs.py) refuse un oubli.

export const MODULES = {
  // ── sources ──
  drums: {
    name: 'DR-9', kind: 'boîte à rythmes', role: 'source', color: 'or',
    params: [...drumParams, ...SWING_PARAMS], face: ['lvl'], sortes: { ...drumSortes, swing: 'swing' },
  },
  synth: {
    name: 'Synthé', kind: 'soustractif', role: 'source', color: 'cy',
    params: [
      O('wave', 'Forme A', ['Sinus', 'Triangle', 'Dent de scie', 'Carré'], 2),
      P('oct', 'Octave', -2, 2, 0, '', 'lin', 1),
      // copies de l'oscillateur A réparties dans le désaccord (une « nappe » de
      // scies) : 1, 2 ou 3 — choix de réglage, pas une recette sourcée
      P('uni', 'Copies A', 1, 3, 1, '', 'lin', 1),
      P('det', 'Désaccord', 0, 50, 8, 'ct'),
      O('wave2', 'Forme B', WAVES2, 0),
      P('oct2', 'Octave B', -2, 2, 0, '', 'lin', 1),
      P('mix2', 'Part de B', 0, 1, 0.5, ''),
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
      // 06/10 (docs/etudes/odio_synthes.md) : après les réglages d'avant, qui
      // gardent leur ordre (les rails de la tuile du nodal) ; à leur défaut, le
      // Synthé sonne exactement comme avant (aucun nœud de plus par voix)
      P('osc', 'Oscillateurs', 0, 1, 1, ''),          // le niveau de A et B ensemble (0 : le bruit seul)
      P('noise', 'Bruit', 0, 1, 0, ''),               // bruit blanc, avant le filtre
      P('glide', 'Glissé', 0, 1, 0, 's'),             // portamento depuis la note d'avant
      P('penv', 'Env. hauteur', -24, 48, 0, 'dt', 'lin', 1),   // la hauteur part de là…
      P('pdec', 'Retour hauteur', 0.005, 2, 0.08, 's', 'log'),  // … et revient en ce temps
      O('lfo_w', 'Forme LFO', ['Sinus', 'Triangle', 'Carré', 'Dent de scie'], 0),
      P('lfo_f', 'Vitesse LFO', 0.05, 20, 5, 'Hz', 'log'),
      P('lfo_d', 'Délai LFO', 0, 2, 0, 's'),          // la profondeur monte en ce temps après l'attaque
      P('lfo_p', 'LFO → hauteur', 0, 100, 0, 'ct'),
      P('lfo_c', 'LFO → coupure', 0, 3, 0, 'oct'),
      P('lfo_a', 'LFO → volume', 0, 1, 0, ''),
      ...ARP_PARAMS,
    ],
    face: ['cut', 'res', 'd', 'vol'],
    sortes: { oct: 'hauteur', uni: 'forme', det: 'desaccord', oct2: 'hauteur', mix2: 'forme', cut: 'coupure', res: 'resonance',
      fenv: 'enveloppe', fdec: 'enveloppe', a: 'enveloppe', d: 'enveloppe', s: 'enveloppe', r: 'enveloppe', vol: 'niveau',
      osc: 'forme', noise: 'forme', glide: 'glisse', penv: 'enveloppe', pdec: 'enveloppe',
      lfo_f: 'modulation', lfo_d: 'modulation', lfo_p: 'desaccord', lfo_c: 'modulation', lfo_a: 'modulation', ...ARP_SORTES },
    sections: [['Oscillateur A', ['wave', 'oct', 'uni', 'det']], ['Oscillateur B', ['wave2', 'oct2', 'mix2']],
      ['Bruit · hauteur', ['osc', 'noise', 'glide', 'penv', 'pdec']],
      ['Filtre', ['cut', 'res', 'fenv', 'fdec']], ['Enveloppe', ['a', 'd', 's', 'r']],
      ['LFO', ['lfo_w', 'lfo_f', 'lfo_d', 'lfo_p', 'lfo_c', 'lfo_a']], ['Arpège', ['arp', 'arp_div', 'arp_oct', 'arp_gate']], ['Sortie', ['vol']]],
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
    sortes: { root: 'hauteur', start: 'forme', a: 'enveloppe', r: 'enveloppe', vol: 'niveau' },
  },
  // les banques d'échantillons (09/10, décision 4 de docs/etudes/odio_synthes.md) :
  // des zones de notes et de vélocités, des tours, des boucles, l'enveloppe de
  // chaque zone (la cartographie SFZ de l'auteur, banques.js) ; la banque est
  // `params.banque` (son identifiant, comme `item` pour l'échantillonneur). Les
  // réglages ne font que déplacer ce que la banque dit : la transposition,
  // l'accord fin, l'attaque et la chute multipliées, le suivi de vélocité.
  banque: {
    name: 'Échantillons', kind: 'zones · vélocités · boucles', role: 'source', color: 'amb',
    params: [
      P('transpo', 'Transposition', -24, 24, 0, 'dt', 'lin', 1),
      P('accord', 'Accord fin', -100, 100, 0, 'ct'),
      P('att', 'Attaque', 0.25, 8, 1, '×', 'log'),
      P('rel', 'Chute', 0.25, 8, 1, '×', 'log'),
      P('dyn', 'Dynamique', 0, 1, 1, ''),
      // −8 dB : les cartographies de VCSL relèvent chaque zone jusqu'à son plein niveau
      // (« volume » de +7 à +37 dB) ; une note forte seule crête vers −4 dBFS, un accord
      // dépasserait. À −8, la phrase d'écoute d'un clavier crête de −9 à −12 dBFS (mesuré)
      P('vol', 'Volume', -40, 6, -8, 'dB'),
      ...ARP_PARAMS,
    ],
    face: ['transpo', 'rel', 'dyn', 'vol'],
    // les attracteurs (musique/facettes.js) : la sorte de chaque réglage continu
    sortes: { transpo: 'hauteur', accord: 'desaccord', att: 'enveloppe', rel: 'enveloppe', dyn: 'dynamique', vol: 'niveau', arp_oct: 'hauteur', arp_gate: 'duree' },
  },
  player: {
    name: 'Lecteur', kind: 'clips audio', role: 'source', color: 'grn2',
    // -6 dB : un son généré arrive mastérisé près de 0 dBFS (ACE-Step : -0,4 dB
    // mesuré le 28/09) ; posé à côté de la batterie, il saturerait la sortie
    params: [P('vol', 'Volume', -40, 6, -6, 'dB')], face: ['vol'], sortes: { vol: 'niveau' },
  },
  // ── effets ──
  delay: {
    name: 'Délai', kind: 'écho synchronisé', role: 'effect', color: 'amb',
    params: [
      O('div', 'Temps', ['1/16', '1/8', '1/8 p.', '1/4', '1/4 p.', '1/2'], 1),
      P('fb', 'Retour', 0, 0.9, 0.35, ''),
      P('tone', 'Ton', 400, 12000, 3500, 'Hz', 'log'),
      P('mix', 'Mix', 0, 1, 0.3, ''),
      // en retour de bus, le son sec est déjà dans la piste : on le coupe
      O('dry', 'Son sec', ['Garder', 'Couper'], 0),
    ],
    face: ['div', 'fb', 'mix'],
    sortes: { fb: 'espace', tone: 'coupure', mix: 'espace' },
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
    sortes: { time: 'espace', pre: 'espace', damp: 'coupure', mix: 'espace' },
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
    sortes: { thr: 'dynamique', ratio: 'dynamique', att: 'dynamique', rel: 'dynamique', knee: 'dynamique', gain: 'niveau' },
  },
  // l'égaliseur paramétrique : cinq bandes, la découpe d'EQ Eight (coupe-bas,
  // plateau, cloche, plateau, coupe-haut) ; les deux coupes éteintes et le Q
  // de la cloche à 0,9 rendent l'égaliseur trois bandes d'avant, au son près
  // (moteur.js, FX.eq). Le Q d'une coupe : 0,71 = Butterworth (aucune bosse).
  eq: {
    name: 'Égaliseur', kind: 'paramétrique · 5 bandes', role: 'effect', color: 'coral-3',
    // les six réglages d'avant d'abord : la tuile du nodal garde son ordre de rails
    params: [
      P('lf', 'Graves', 40, 600, 180, 'Hz', 'log'), P('lg', 'Gain gr.', -18, 18, 0, 'dB'),
      P('mf', 'Médiums', 200, 6000, 1000, 'Hz', 'log'), P('mg', 'Gain méd.', -18, 18, 0, 'dB'),
      P('hf', 'Aigus', 1500, 16000, 5000, 'Hz', 'log'), P('hg', 'Gain aig.', -18, 18, 0, 'dB'),
      P('mq', 'Q médiums', 0.1, 10, 0.9, 'Q', 'log'),
      O('hpo', 'Coupe-bas', ['Éteint', 'Actif'], 0),
      P('hpf', 'Fréq. coupe-bas', 20, 2000, 40, 'Hz', 'log'), P('hpq', 'Q coupe-bas', 0.3, 8, 0.71, 'Q', 'log'),
      O('lpo', 'Coupe-haut', ['Éteint', 'Actif'], 0),
      P('lpf', 'Fréq. coupe-haut', 1000, 20000, 16000, 'Hz', 'log'), P('lpq', 'Q coupe-haut', 0.3, 8, 0.71, 'Q', 'log'),
      P('out', 'Sortie', -24, 12, 0, 'dB'),
    ],
    face: ['lg', 'mg', 'hg'],
    // le Q d'une coupe-haut est sa résonance (la bosse à la coupure)
    sortes: { lf: 'bande', lg: 'bande', mf: 'bande', mg: 'bande', hf: 'aigu', hg: 'aigu', mq: 'bande',
      hpf: 'bande', hpq: 'bande', lpf: 'coupure', lpq: 'resonance', out: 'niveau' },
  },
  filter: {
    name: 'Filtre', kind: 'résonant', role: 'effect', color: 'cy',
    params: [
      O('type', 'Type', ['Passe-bas', 'Passe-haut', 'Passe-bande'], 0),
      P('freq', 'Fréquence', 30, 18000, 2400, 'Hz', 'log'),
      P('q', 'Résonance', 0.1, 20, 1, '', 'log'),
    ],
    face: ['freq', 'q'],
    sortes: { freq: 'coupure', q: 'resonance' },
  },
  dist: {
    name: 'Distorsion', kind: 'saturation', role: 'effect', color: 'coral-1',
    params: [P('drive', 'Saturation', 0, 100, 30, ''), P('tone', 'Ton', 500, 16000, 6000, 'Hz', 'log'),
      P('mix', 'Mix', 0, 1, 1, ''), P('out', 'Sortie', -24, 6, -6, 'dB')],
    face: ['drive', 'mix'],
    sortes: { drive: 'saturation', tone: 'coupure', mix: 'saturation', out: 'niveau' },
  },
  // ── la console ──
  strip: {
    name: 'Piste', kind: 'tranche', role: 'strip', color: 'ink2',
    params: [P('vol', 'Volume', -60, 6, 0, 'dB'), P('pan', 'Panoramique', -1, 1, 0, '')],
    face: ['vol', 'pan'], sortes: { vol: 'niveau', pan: 'pano' },
  },
  // l'entrée d'un bus d'effets : ce que les envois de la console y versent
  bus: {
    name: 'Retour', kind: 'entrée de bus', role: 'bus', color: 'cy',
    params: [P('in', 'Entrée', -24, 12, 0, 'dB')], face: ['in'], sortes: { in: 'niveau' },
  },
  master: {
    name: 'Sortie', kind: 'master', role: 'master', color: 'grn2',
    params: [
      P('vol', 'Volume', -60, 6, 0, 'dB'),
      // l'arc d'énergie : 0 = coupure basse (arc_lo) et volume baissé de
      // arc_db, 1 = filtre grand ouvert, volume plein — choix de réglage
      P('arc_lo', 'Arc · coupure basse', 80, 8000, 350, 'Hz', 'log'),
      P('arc_db', 'Arc · volume bas', -36, 0, -12, 'dB'),
    ],
    face: ['vol'], sortes: { vol: 'niveau', arc_lo: 'arc', arc_db: 'arc' },
  },
};

// ── ODIO : les instruments et les effets du prototype ───────
// Chaque entrée nomme sa classe ; ses réglages viennent de getParameters()
// d'une instance posée dans un petit contexte hors temps réel. `skip` : un
// réglage qui ne ferait rien ici (l'envoi de la table de mix n'est branché
// sur rien dans la console d'ODIO — la console a ses propres envois).
// `trim` : le gain de sortie de l'adaptateur, pour que chaque instrument
// arrive au niveau des autres (mesuré, docs/etudes/musique.md). `sortes` :
// la sorte de chaque réglage continu (musique/facettes.js), sur les
// identifiants de ses descripteurs.
// la boîte à rythme : quatre réglages par voix (odio/instruments/rhythm-box.js)
const SORTES_RYTHME = { drive: 'saturation', gain: 'niveau' };
for (const v of VOIX) Object.assign(SORTES_RYTHME, { [`${v.id}.tune`]: 'accord', [`${v.id}.decay`]: 'enveloppe', [`${v.id}.ctrl`]: 'forme', [`${v.id}.niv`]: 'niveau' });
const SORTES_ENV = { attack: 'enveloppe', decay: 'enveloppe', sustain: 'enveloppe', release: 'enveloppe', gain: 'niveau' };
const ODIO = {
  rythme: { cls: RhythmBox, name: 'Boîte à rythme', kind: '808 · 909 · onze voix', role: 'source', color: 'or', drum: true, face: ['kit', 'drive', 'gain'], trim: -8,
    sortes: SORTES_RYTHME },
  analog: { cls: AnalogSynth, name: 'Analog', kind: 'soustractif · ODIO', role: 'source', color: 'cy', face: ['cutoff', 'resonance', 'decay', 'gain'], trim: -6,
    sortes: { detune: 'desaccord', cutoff: 'coupure', resonance: 'resonance', envAmount: 'enveloppe', ...SORTES_ENV } },
  acid: { cls: AcidBass, name: 'Basse acide', kind: '303 · filtre 18 dB', role: 'source', color: 'grn2', face: ['cutoff', 'resonance', 'envMod', 'decay'], trim: -12,
    sortes: { cutoff: 'coupure', resonance: 'resonance', envMod: 'enveloppe', decay: 'enveloppe', accent: 'accent', glide: 'glisse', gain: 'niveau' } },
  // le timbre de Plaits : brillance, le choix du 29/09 (FACETTES_MODULES)
  plaits: { cls: PlaitsSynth, name: 'Numérique', kind: 'Plaits · wasm', role: 'source', color: 'coral-2', face: ['modele', 'harmo', 'timbre', 'morph'], trim: -2,
    sortes: { harmo: 'forme', timbre: ['forme', 'brillance'], morph: 'forme', cutoff: 'coupure', resonance: 'resonance', envAmount: 'enveloppe', ...SORTES_ENV } },
  // pas d'ODIO_01 : écrit ici sur son contrat (musique/plaits/macro.js, docs/etudes/odio_synthes.md)
  macro: { cls: MacroPlaits, name: 'Macro', kind: 'Plaits · 24 moteurs', role: 'source', color: 'coral-3', face: ['moteur', 'harmo', 'timbre', 'morph'], trim: 0,
    // les sortes du lot « odio-attracteurs », et l'enveloppe de filtre neuve (09/10, plaits/macro.js)
    sortes: { harmo: 'forme', timbre: ['forme', 'brillance'], morph: 'forme', aux: 'forme', declin: 'enveloppe', couleur: 'forme',
      cutoff: 'coupure', resonance: 'resonance', envAmount: 'enveloppe', attack: 'enveloppe', decay: 'enveloppe', sustain: 'enveloppe', release: 'enveloppe', gain: 'niveau' } },
  // 09/10 : Rings et Elements, compilés comme Plaits (musique/mutable/, docs/etudes/odio_synthes.md § 7)
  // `trim` : mesuré sur leurs préréglages (docs/etudes/odio_synthes.md § 7) — le module sort
  // ses résonances plus bas que les autres instruments (Rings), ou plus haut (Elements)
  // `sortes` : la sorte de chaque réglage continu, pour les attracteurs (la règle du lot
  // « odio-attracteurs », musique/facettes.js) ; les choix (modèle, polyphonie…) sont discrets
  resonateur: { cls: Resonateur, name: 'Résonateur', kind: 'Rings · modal, cordes', role: 'source', color: 'amb', face: ['structure', 'brillance', 'amorti', 'position'], trim: 8,
    sortes: { structure: 'forme', brillance: 'coupure', amorti: 'enveloppe', position: 'forme', largeur: 'pano', gain: 'niveau' } },
  physique: { cls: Physique, name: 'Physique', kind: 'Elements · archet, souffle, frappe', role: 'source', color: 'grn2', face: ['geometrie', 'brillance', 'amorti', 'position'], trim: -6,
    sortes: { contour: 'enveloppe', archet: 'forme', archet_t: 'forme', souffle: 'forme', flux: 'forme', souffle_t: 'forme', frappe: 'forme', maillet: 'forme',
      frappe_t: 'forme', geometrie: 'forme', brillance: 'coupure', amorti: 'enveloppe', position: 'forme', espace: 'espace', gain: 'niveau' } },
  reverbe: { cls: ReverbEffect, name: 'Réverbe', kind: 'rvb-02 · convolution', role: 'effect', color: 'cy', face: ['size', 'decay', 'mix'],
    sortes: { size: 'espace', decay: 'espace', damp: 'coupure', mix: 'espace' } },
  // la largeur d'un chorus est sa place dans le champ stéréo
  chorus: { cls: ChorusEffect, name: 'Chorus', kind: 'chr-04 · trois retards', role: 'effect', color: 'cy', face: ['rate', 'depth', 'mix'],
    sortes: { rate: 'modulation', depth: 'modulation', spread: 'pano', mix: 'modulation' } },
  rtt: { cls: DelayEffect, name: 'RTT-01', kind: 'délai · filtre en boucle', role: 'effect', color: 'amb', face: ['time', 'fdb', 'mix'],
    sortes: { time: 'cadence', fdb: 'espace', tone: 'coupure', mix: 'espace' } },
  comp3: { cls: CompEffect, name: 'Comp', kind: 'cmp-03', role: 'effect', color: 'coral-1', face: ['threshold', 'ratio', 'makeup'],
    sortes: { threshold: 'dynamique', ratio: 'dynamique', attack: 'dynamique', release: 'dynamique', makeup: 'niveau' } },
  eq3: { cls: EqEffect, name: 'EQ-3', kind: 'eq-03 · trois bandes', role: 'effect', color: 'coral-3', face: ['low', 'mid', 'high'],
    sortes: { low: 'bande', mid: 'bande', midHz: 'bande', high: 'aigu', width: 'bande' } },
  filtre: { cls: FilterEffect, name: 'Filtre drive', kind: 'flt-07', role: 'effect', color: 'cy', face: ['cutoff', 'reso', 'drive'],
    sortes: { cutoff: 'coupure', reso: 'resonance', drive: 'saturation' } },
  satura: { cls: DriveEffect, name: 'Satura', kind: 'sat-09 · saturation', role: 'effect', color: 'coral-1', face: ['drive', 'bias', 'mix'],
    sortes: { drive: 'saturation', bias: 'saturation', tone: 'coupure', mix: 'saturation' } },
  crush: { cls: CrushEffect, name: 'Crush', kind: 'crs-06 · résolution', role: 'effect', color: 'coral-2', face: ['bits', 'drive', 'mix'],
    sortes: { bits: 'saturation', drive: 'saturation', tone: 'coupure', mix: 'saturation' } },
  // `coupe` : le muet de la tranche (0 ou 1, écrit continu par son descripteur)
  table: { cls: MixTable, name: 'Table de mix', kind: 'mix-01 · tranche', role: 'effect', color: 'ink2', face: ['gain', 'low', 'high', 'niveau'], skip: ['envoi'],
    sortes: { gain: 'niveau', low: 'bande', mid: 'bande', midHz: 'bande', high: 'aigu', pano: 'pano', niveau: 'niveau', coupe: 'routage' } },
  volume: { cls: VolumeEffect, name: 'Volume', kind: 'vol-05', role: 'effect', color: 'ink2', face: ['niveau', 'pano'], sortes: { niveau: 'niveau', pano: 'pano' } },
};
const CHOICE_FR = { sawtooth: 'Scie', square: 'Carré', triangle: 'Triangle', sine: 'Sinus', lowpass: 'Passe-bas',
  highpass: 'Passe-haut', bandpass: 'Passe-bande', none: 'Aucun', lp: 'Passe-bas', bp: 'Passe-bande', hp: 'Passe-haut' };
const UNIT_FR = { db: 'dB', dB: 'dB', Hz: 'Hz', s: 's', '%': '%', ms: 'ms', cents: 'ct', x: ':1', b: 'bits', Q: 'Q' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function fromOdio(d) {
  if (d.curve === 'choice') return O(d.id, cap(d.label), [...d.choices].map((c) => CHOICE_FR[c] || c), d.default);
  return P(d.id, cap(d.label), d.min, d.max, d.default, UNIT_FR[d.unit || ''] ?? (d.unit || ''), d.curve === 'exponential' ? 'log' : 'lin');
}
{
  // un contexte d'une fraction de seconde, le temps de lire les descripteurs
  const probe = new OfflineAudioContext(2, 128, 48000);
  for (const [type, def] of Object.entries(ODIO)) {
    const inst = new def.cls(probe);
    const params = inst.getParameters().filter((d) => !(def.skip || []).includes(d.id)).map(fromOdio);
    const arp = def.role === 'source' && !def.drum, swing = def.role === 'source' && def.drum;
    if (arp) params.push(...ARP_PARAMS);   // l'arpège : lu par le moteur, pas par l'instrument
    if (swing) params.push(...SWING_PARAMS);   // le swing d'une batterie, de même
    MODULES[type] = { ...def, odio: true, params, sortes: { ...def.sortes, ...(arp ? ARP_SORTES : {}), ...(swing ? { swing: 'swing' } : {}) } };
    inst.dispose?.();
  }
}
export const ODIO_TYPES = Object.keys(ODIO);
Object.assign(MODULES, JOUETS);   // jouets : leurs réglages et leurs ports (musique/jouets/defs.js)
// attracteurs : chaque réglage porte sa sorte et sa facette (musique/facettes.js) ;
// un réglage continu qui n'a pas pris position n'est capté par rien, et la garde le refuse
for (const def of Object.values(MODULES)) def.params = declarer(def.params, def.sortes);

export const EFFECT_TYPES = ['delay', 'reverb', 'comp', 'eq', 'filter', 'dist', ...ODIO_TYPES.filter((t) => ODIO[t].role === 'effect')];
// les sources qu'une piste peut porter, par sorte de piste
export const SOURCES_OF = { drums: ['drums', 'rythme'], synth: ['synth', 'analog', 'acid', 'plaits', 'macro', 'resonateur', 'physique'], sampler: ['sampler', 'banque'], audio: ['player'], bus: ['bus'] };
export const kindOfSource = (type) => Object.keys(SOURCES_OF).find((k) => SOURCES_OF[k].includes(type));

// Les voix d'une batterie, selon sa source : la DR-9 (huit voix) ou la
// boîte à rythme d'ODIO (les onze voix d'une TR-8S, notes 36 à 46).
const VOIX_FR = { GROSSE: 'Grosse', CAISSE: 'Caisse', 'TOM BAS': 'Tom bas', 'TOM MED': 'Tom médium', 'TOM HAUT': 'Tom haut',
  RIMSHOT: 'Rimshot', CLAP: 'Clap', CHARLEY: 'Charley', OUVERT: 'Ouvert', CRASH: 'Crash', RIDE: 'Ride' };
export const RHYTHM_VOICES = VOIX.map((v) => ({ id: v.id, name: VOIX_FR[v.nom] || v.nom, short: v.court, note: v.note }));
export const drumVoicesOf = (type) => (type === 'rythme' ? RHYTHM_VOICES : DRUM_VOICES);
export const ALL_DRUM_IDS = [...new Set([...DRUM_VOICES, ...RHYTHM_VOICES].map((v) => v.id))];

export const TRACK_KINDS = {
  drums: { label: 'Batterie', src: 'drums', color: 'or', pattern: 'drums' },
  synth: { label: 'Synthé', src: 'synth', color: 'cy', pattern: 'notes' },
  sampler: { label: 'Échantillonneur', src: 'sampler', color: 'coral-2', pattern: 'notes' },
  audio: { label: 'Audio', src: 'player', color: 'grn2', pattern: null },
  bus: { label: 'Bus', src: 'bus', color: 'cy', pattern: null },
};
export const COLORS = ['or', 'cy', 'amb', 'grn2', 'coral-1', 'coral-2', 'coral-3'];
export const COLOR_FR = { or: 'orange', cy: 'acier', amb: 'ambre', grn2: 'vert', 'coral-1': 'terre', 'coral-2': 'corail', 'coral-3': 'pêche' };

// ── ce qui s'automatise : les réglages tenus par un AudioParam ─
// (moteur.js : chaque nœud expose `ap[k]`). La coupure du synthé n'est pas
// un AudioParam partagé : elle est lue note par note au moment où la note
// part (moteur.js, Graph.schedule).
export const AUTOMATABLE = {
  strip: ['vol', 'pan'], bus: ['in'], master: ['vol'], synth: ['vol', 'cut'], sampler: ['vol'], player: ['vol'],
  drums: ['lvl'], banque: ['vol'], filter: ['freq', 'q'], delay: ['mix', 'fb'], reverb: ['mix'], dist: ['mix'],
  eq: ['lg', 'mg', 'hg', 'mf', 'hpf', 'lpf'], comp: ['thr', 'gain'],
};
// les modules d'ODIO : tout réglage continu, posé par setParameter(id, valeur,
// instant) — un effet l'applique à l'instant dit, un instrument aux notes
// qui partent ensuite (leur contrat, odio/types.js)
for (const t of ODIO_TYPES) AUTOMATABLE[t] = MODULES[t].params.filter((p) => !p.opts && !PLANIFIES.has(p.k)).map((p) => p.k);

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
  if (s.fmt) return s.fmt(v);   // jouets : les lectures du Playground (0.92 g, +8, 2.2 s)
  if (s.opts) return s.opts[Math.round(v)] ?? '';
  if (s.unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} k` : v < 10 ? v.toFixed(v < 1 ? 2 : 1) : `${Math.round(v)}`;
  if (s.unit === 's') return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
  if (s.unit === 'dB') return v <= -59.9 ? '−∞' : `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}`;
  if (s.unit === 'dt') return `${v > 0 ? '+' : ''}${Math.round(v)}`;
  if (s.unit === '%' || s.unit === 'ms') return `${Math.round(v)}`;
  if (s.unit === 'Q') return v.toFixed(v < 1 ? 2 : 1);
  if (s.unit === ':1' || s.unit === 'bits') return v.toFixed(1);
  if (s.k === 'pan' || s.k === 'pano') return Math.abs(v) < 0.02 ? 'C' : `${v < 0 ? 'G' : 'D'} ${Math.round(Math.abs(v) * 100)}`;
  if (s.k === 'root') return noteName(v);
  if (s.max <= 1 && s.min >= 0 && !s.unit) return `${Math.round(v * 100)}`;
  if (s.step >= 1) return `${Math.round(v)}`;
  return v.toFixed(v < 10 ? 1 : 0);
}
export const unitOf = (s) => (s.opts ? '' : s.unit === 'dt' ? 'demi-t.' : s.unit === 'ct' ? 'cents' : s.unit === '×' ? '×' : s.unit === 'oct' ? 'oct.' : s.unit);
export const moduleName = (type) => MODULES[type]?.name || type;

const NOTE_FR = ['do', 'do#', 'ré', 'ré#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'si'];
export const noteName = (p) => `${NOTE_FR[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
export const isBlack = (p) => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
export const dbToGain = (db) => (db <= -59.9 ? 0 : Math.pow(10, db / 20));

// ── la tonalité de la session ───────────────────────────────
// Intervalles des gammes en demi-tons depuis la tonique : les sept modes
// diatoniques, la mineure harmonique, les deux pentatoniques et la gamme
// blues (définitions de la théorie musicale courante).
export const TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const TONICS_FR = NOTE_FR;
export const MODES = {
  major: { label: 'majeur', short: 'MAJ', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: 'mineur', short: 'MIN', steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { label: 'dorien', short: 'DOR', steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { label: 'phrygien', short: 'PHR', steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { label: 'lydien', short: 'LYD', steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { label: 'mixolydien', short: 'MIX', steps: [0, 2, 4, 5, 7, 9, 10] },
  locrian: { label: 'locrien', short: 'LOC', steps: [0, 1, 3, 5, 6, 8, 10] },
  harmonic: { label: 'mineur harmonique', short: 'HARM', steps: [0, 2, 3, 5, 7, 8, 11] },
  pentamaj: { label: 'pentatonique majeure', short: 'PMAJ', steps: [0, 2, 4, 7, 9] },
  pentamin: { label: 'pentatonique mineure', short: 'PMIN', steps: [0, 3, 5, 7, 10] },
  blues: { label: 'blues', short: 'BLUES', steps: [0, 3, 5, 6, 7, 10] },
};
export const inScale = (key, p) => MODES[key?.mode || 'minor'].steps.includes((((p - (key?.tonic ?? 9)) % 12) + 12) % 12);
export const keyLabel = (key) => `${TONICS[key?.tonic ?? 9]} ${MODES[key?.mode || 'minor'].short}`;
// ACE-Step ne connaît que majeur et mineur (liste de son nœud) : un mode
// se ramène à la tierce de sa tonique
export function aceKey(key) {
  const k = key || { tonic: 9, mode: 'minor' };
  const major = ['major', 'lydian', 'mixolydian', 'pentamaj'].includes(k.mode);
  return `${TONICS[k.tonic]} ${major ? 'major' : 'minor'}`;
}
// la note de la gamme la plus proche (aimanter une note à la gamme)
export function snapToScale(key, p) {
  if (inScale(key, p)) return p;
  for (let d = 1; d < 7; d++) { if (inScale(key, p - d)) return p - d; if (inScale(key, p + d)) return p + d; }
  return p;
}

// ── les étiquettes de section des paroles ───────────────────
// Relevées dans les nœuds YuE2 de DGX2 (~/yue2-candidates : [verse],
// [chorus], [Pre-Chorus], [Bridge], [Intro], [Outro], [instrumental] ; les
// blocs séparés par une ligne vide) ; ACE-Step écrit « [Verse] » (sa
// documentation, INFERENCE.md).
export const SECTION_TAGS = [
  ['intro', 'Intro'], ['verse', 'Couplet'], ['pre-chorus', 'Pré-refrain'], ['chorus', 'Refrain'],
  ['bridge', 'Pont'], ['instrumental', 'Instrumental'], ['outro', 'Final'],
];
export function guessTag(name) {
  const n = (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/pre.?refrain|pre.?chorus/.test(n)) return 'pre-chorus';
  if (/refrain|chorus|hook/.test(n)) return 'chorus';
  if (/couplet|verse/.test(n)) return 'verse';
  if (/pont|bridge/.test(n)) return 'bridge';
  if (/intro/.test(n)) return 'intro';
  if (/final|outro|fin\b|coda/.test(n)) return 'outro';
  if (/solo|instru|break|pause/.test(n)) return 'instrumental';
  return 'verse';
}
// l'ordre habituel d'une chanson, pour nommer la section suivante
export const SECTION_NAMES = ['Intro', 'Couplet', 'Refrain', 'Couplet', 'Refrain', 'Pont', 'Refrain', 'Final'];

// ── les préréglages d'instrument ────────────────────────────
// La banque : musique/prereglages.js (catégories, phrases d'écoute). `sub`
// est la ligne sous le nom de la piste ; `cat` sa catégorie.
export const PRESETS = BANQUE;
export const presetsFor = (type) => PRESETS.filter((p) => p.type === type);

// ── les modèles de motifs ───────────────────────────────────
// Rythmes courants écrits à la main (choix d'écriture), et motifs de notes
// tirés de la gamme de la session.
const R = (s) => [...s].map((c) => (c === 'x' ? 1 : c === 'o' ? 0.5 : 0));
export const DRUM_MODELS = [
  { id: 'quatre', name: 'Quatre temps', lanes: { bd: R('x...x...x...x...'), cp: R('....x.......x...'), ch: R('..x...x...x...x.') } },
  { id: 'rock', name: 'Rock', lanes: { bd: R('x.......x.x.....'), sd: R('....x.......x...'), ch: R('x.x.x.x.x.x.x.x.') } },
  { id: 'demi', name: 'Demi-tempo', lanes: { bd: R('x.........x.....'), sd: R('........x.......'), ch: R('x.x.x.x.x.x.x.x.') } },
  { id: 'break', name: 'Breakbeat', lanes: { bd: R('x.........x..x..'), sd: R('....x..o.x..x...'), ch: R('x.x.x.xox.x.x.xo') } },
  { id: 'charley', name: 'Charley doubles', lanes: { ch: R('xoxoxoxoxoxoxoxo'), oh: R('......x.......x.') } },
];
// motifs de notes : fonctions de la tonalité, sur `bars` mesures de `sig` temps
function scaleNote(key, degree, octave) {
  const st = MODES[key.mode].steps, n = st.length;
  const o = Math.floor(degree / n), d = ((degree % n) + n) % n;
  return 12 * (octave + 1) + key.tonic + st[d] + 12 * o;
}
export const NOTE_MODELS = [
  { id: 'fond', name: 'Basse · fondamentales', make: (key, sig) => {
    const out = [];
    for (let b = 0; b < 4; b++) for (let k = 0; k < sig * 2; k++) out.push({ s: b * sig * 4 + k * 2, l: 2, p: scaleNote(key, [0, 5, 2, 6][b], 2), v: k % 2 ? 0.65 : 0.85 });
    return { steps: 4 * sig * 4, notes: out };
  } },
  { id: 'accords', name: 'Accords tenus', make: (key, sig) => {
    const out = [];
    [0, 5, 2, 6].forEach((deg, b) => { for (const x of [0, 2, 4]) out.push({ s: b * sig * 4, l: sig * 4, p: scaleNote(key, deg + x, 4), v: 0.7 }); });
    return { steps: 4 * sig * 4, notes: out };
  } },
  { id: 'arpege', name: 'Arpège de gamme', make: (key, sig) => {
    const out = [], n = sig * 4;
    for (let s = 0; s < n; s += 2) out.push({ s, l: 2, p: scaleNote(key, [0, 2, 4, 7, 4, 2][(s / 2) % 6], 4), v: 0.75 });
    return { steps: n, notes: out };
  } },
];
