// ODIO — la banque de préréglages des instruments (06/10, Cal : « nos
// générateurs de son ne sont pas encore super […] des synthés avec des
// presets »). Étude : docs/etudes/odio_synthes.md.
//
// Un préréglage est un jeu de réglages d'UNE source (Synthé, Analog, Basse
// acide, Numérique, Boîte à rythme, DR-9, Échantillonneur), rangé dans une
// catégorie, avec une ligne qui dit ce qu'il est (`sub`). Ce sont des choix
// de réglage écrits ici, pas des recettes sourcées ; chacun a été rendu hors
// temps réel et mesuré (niveau, pas de silence, pas d'écrêtage : l'étude,
// § 4). Le goût est à Cal : rien n'a été écouté au casque dans la session.
//
// Les dix-neuf préréglages d'avant gardent leur identifiant et leurs
// réglages (un projet ou une session qui les nomme sonne pareil) ; seul le
// « TR-909 » prend maintenant les hauteurs et les chutes de la 909 (avant, il
// gardait celles de la 808 sous le circuit de la 909 : les réglages d'une
// voix sont des valeurs absolues, drums-voices.js).
//
// L'écoute (le navigateur) joue une PHRASE par catégorie, dans la tonalité de
// la session, au tempo du projet : `phraseDe(préréglage)`.

import { VOIX } from './odio/instruments/drums-voices.js';

// ── les catégories, dans l'ordre du navigateur ──────────────
export const CATEGORIES = [
  ['basse', 'Basses'], ['lead', 'Leads'], ['nappe', 'Nappes'], ['clavier', 'Claviers'], ['pluck', 'Plucks'],
  ['cloche', 'Cloches'], ['arp', 'Arpèges'], ['perc', 'Percussions'], ['fx', 'Effets'], ['kit', 'Kits'], ['env', 'Enveloppes'],
];
export const CATEGORIE_FR = Object.fromEntries(CATEGORIES);

// ── les kits de la boîte à rythme : les cotes des deux machines ──
// (drums-voices.js) : hauteur et chute de chaque voix dans le kit choisi,
// puis ce qui change
function kit(k, plus = {}) {
  const out = { kit: k === '909' ? 1 : 0 };
  for (const v of VOIX) { out[`${v.id}.tune`] = v.kits[k].hauteur; out[`${v.id}.decay`] = v.kits[k].chute; }
  return { ...out, ...plus };
}
// une chute multipliée pour toutes les voix d'un kit (kit sec, kit long)
function chutes(k, f, plus = {}) {
  const o = kit(k);
  for (const v of VOIX) o[`${v.id}.decay`] = Math.min(v.chute.max, Math.max(v.chute.min, Math.round(v.kits[k].chute * f * 1000) / 1000));
  return { ...o, ...plus };
}

const S = (id, cat, name, sub, params) => ({ id, type: 'synth', cat, name, sub, params });
const A = (id, cat, name, sub, params) => ({ id, type: 'analog', cat, name, sub, params });
const B = (id, cat, name, sub, params) => ({ id, type: 'acid', cat, name, sub, params });
const N = (id, cat, name, sub, params) => ({ id, type: 'plaits', cat, name, sub, params });
const R = (id, name, sub, params) => ({ id, type: 'rythme', cat: 'kit', name, sub, params });
const D = (id, name, sub, params) => ({ id, type: 'drums', cat: 'kit', name, sub, params });
const E = (id, name, sub, params) => ({ id, type: 'sampler', cat: 'env', name, sub, params });

// ── la banque ───────────────────────────────────────────────
// Synthé (soustractif du studio) : forme A (0 sinus, 1 triangle, 2 scie,
// 3 carré), forme B (0 comme A, 1 sinus, 2 triangle, 3 scie, 4 carré,
// 5 aucun), LFO (forme 0 sinus, 1 triangle, 2 carré, 3 scie), arpège (mode
// 1 monte, 2 descend, 3 va-et-vient, 4 joué, 5 hasard, 6 accord ; division
// 0 1/4, 1 1/8, 2 1/8 t., 3 1/16, 4 1/16 t., 5 1/32) — modules.js.
export const BANQUE = [
  // les quatre kits de la DR-9 d'avant, et six de plus
  D('kit-sec', 'Kit sec', 'déclins courts', {}),
  D('kit-long', 'Kit long', 'déclins longs', { bd_dec: 1.8, sd_dec: 1.4, oh_dec: 1.5, lt_dec: 1.6, ht_dec: 1.6 }),
  D('kit-serre', 'Kit serré', 'serré', { bd_dec: 0.6, sd_dec: 0.6, ch_dec: 0.7, oh_dec: 0.6 }),
  D('kit-grave', 'Kit grave', 'accordé bas', { bd_tune: -3, sd_tune: -2, lt_tune: -3, ht_tune: -2, bd_dec: 1.3 }),
  D('dr9-aigu', 'Kit aigu', 'accordé haut', { bd_tune: 3, sd_tune: 4, lt_tune: 4, ht_tune: 4, cb_tune: 2, sd_dec: 0.8 }),
  D('dr9-boum', 'Boum', 'grosse caisse longue et grave', { bd_tune: -5, bd_dec: 3, bd_lvl: 2, sd_lvl: -2 }),
  D('dr9-claque', 'Claqué', 'clap devant, caisse courte', { cp_lvl: 3, cp_dec: 1.4, sd_dec: 0.7, ch_lvl: -3 }),
  D('dr9-charleys', 'Charleys', 'métaux devant', { ch_lvl: 3, oh_lvl: 2, ch_dec: 1.3, oh_dec: 1.2, bd_lvl: -3 }),
  D('dr9-toms', 'Toms', 'toms longs et forts', { lt_dec: 2, ht_dec: 2, lt_lvl: 3, ht_lvl: 3, lt_tune: -2 }),
  D('dr9-lofi', 'Assourdi', 'grave et étouffé', { bd_tune: -2, sd_tune: -3, ch_tune: -4, oh_tune: -4, ch_dec: 0.6, oh_dec: 0.7, lvl: -2 }),

  // la boîte à rythme d'ODIO (808 · 909)
  R('tr808', 'TR-808', 'kit 808 · onze voix', kit('808')),
  R('tr909', 'TR-909', 'kit 909 · ses hauteurs et ses chutes', kit('909')),
  R('rb-boum', '808 longue', 'grosse caisse qui tient', kit('808', { 'bd.decay': 1.5, 'bd.tune': 44, 'bd.ctrl': 30 })),
  R('rb-sec', '808 sèche', 'toutes les chutes ÷ 2', chutes('808', 0.5)),
  R('rb-dure', '909 dure', 'attaque et saturation', kit('909', { drive: 55, 'bd.ctrl': 85, 'sd.ctrl': 70, gain: 0.75 })),
  R('rb-techno', 'Techno', '909, grosse caisse grave, ouvert long', kit('909', { 'bd.tune': 50, 'bd.decay': 0.5, 'oh.decay': 0.8, 'oh.ctrl': 70, drive: 35, gain: 0.8 })),
  R('rb-lofi', 'Lo-fi', '808 saturée, métaux sombres', kit('808', { drive: 85, gain: 0.6, 'ch.tune': 6000, 'oh.tune': 5600, 'cc.tune': 4500, 'sd.tune': 160 })),
  R('rb-hiphop', 'Hip-hop', '808 grave, caisse timbrée', kit('808', { 'bd.decay': 1.1, 'bd.tune': 46, 'sd.ctrl': 75, 'sd.decay': 0.26, 'ch.decay': 0.04, drive: 30 })),
  R('rb-minimal', 'Minimal', '909 serrée, rimshot devant', chutes('909', 0.6, { 'rs.niv': 1.25, 'sd.niv': 0.6, 'ch.ctrl': 20 })),
  R('rb-tribal', 'Tribal', 'toms longs, accordés', kit('808', { 'lt.decay': 0.9, 'mt.decay': 0.8, 'ht.decay': 0.7, 'lt.niv': 1.25, 'mt.niv': 1.2, 'ht.niv': 1.15, 'lt.tune': 80, 'ht.tune': 220 })),

  // ── Synthé ──
  // les six d'avant
  S('basse-scie', 'basse', 'Basse scie', 'scie · filtre',
    { wave: 2, oct: -1, uni: 1, det: 6, wave2: 5, cut: 600, res: 8, fenv: 3, fdec: 0.25, a: 0.003, d: 0.25, s: 0.5, r: 0.12, vol: -12 }),
  S('sub', 'basse', 'Sub', 'sinus · grave',
    { wave: 0, oct: -1, uni: 1, det: 0, wave2: 5, cut: 400, res: 0, fenv: 0, a: 0.005, d: 0.3, s: 0.9, r: 0.2, vol: -10 }),
  S('nappe-3', 'nappe', 'Nappe', '3 scies désaccordées',
    { wave: 2, oct: 0, uni: 3, det: 14, wave2: 5, cut: 2200, res: 2, fenv: 0.5, fdec: 1.2, a: 0.35, d: 1.5, s: 0.8, r: 1.4, vol: -17 }),
  S('lead-carre', 'lead', 'Lead', 'carré · scie',
    { wave: 3, oct: 0, uni: 1, det: 8, wave2: 3, oct2: 0, mix2: 0.45, cut: 3200, res: 5, fenv: 1.5, fdec: 0.3, a: 0.005, d: 0.25, s: 0.7, r: 0.2, vol: -11 }),
  S('pluck', 'pluck', 'Pluck', 'scie · pincée',
    { wave: 2, uni: 1, det: 4, wave2: 5, cut: 900, res: 10, fenv: 4, fdec: 0.15, a: 0.002, d: 0.18, s: 0, r: 0.15, vol: -10 }),
  S('cloches', 'cloche', 'Cloches', 'triangle · octave',
    { wave: 1, uni: 1, det: 3, wave2: 1, oct2: 1, mix2: 0.35, cut: 5000, res: 2, fenv: 1, fdec: 0.6, a: 0.002, d: 0.9, s: 0.1, r: 1.2, vol: -6 }),
  // basses
  S('s-basse-carree', 'basse', 'Basse carrée', 'carré · filtre qui claque',
    { wave: 3, oct: -1, uni: 1, det: 0, wave2: 5, cut: 420, res: 6, fenv: 2.8, fdec: 0.16, a: 0.002, d: 0.3, s: 0.55, r: 0.1, vol: -13 }),
  S('s-reese', 'basse', 'Reese', '3 scies désaccordées · le filtre ondule',
    { wave: 2, oct: -1, uni: 3, det: 22, wave2: 5, cut: 650, res: 4, fenv: 1, fdec: 0.4, a: 0.005, d: 0.5, s: 0.9, r: 0.15, lfo_f: 0.35, lfo_c: 0.7, vol: -15 }),
  S('s-basse-pincee', 'basse', 'Basse pincée', 'scie et carré · très court',
    { wave: 2, oct: -1, uni: 1, det: 0, wave2: 4, oct2: 0, mix2: 0.3, cut: 260, res: 12, fenv: 4.2, fdec: 0.11, a: 0.001, d: 0.22, s: 0.15, r: 0.08, vol: -11 }),
  S('s-basse-glisse', 'basse', 'Basse glissée', 'deux scies · glissé entre les notes',
    { wave: 2, oct: -1, uni: 2, det: 10, wave2: 5, cut: 800, res: 11, fenv: 2, fdec: 0.25, a: 0.003, d: 0.3, s: 0.7, r: 0.1, glide: 0.09, vol: -17 }),
  S('s-basse-ronde', 'basse', 'Basse ronde', 'triangle et sinus · douce',
    { wave: 1, oct: -1, uni: 1, det: 0, wave2: 1, oct2: -1, mix2: 0.4, cut: 900, res: 1, fenv: 0.8, fdec: 0.2, a: 0.004, d: 0.4, s: 0.7, r: 0.12, vol: -6 }),
  // leads
  S('s-lead-scie', 'lead', 'Lead scie', 'deux scies · vibrato qui arrive',
    { wave: 2, uni: 2, det: 12, wave2: 3, oct2: 1, mix2: 0.22, cut: 2800, res: 6, fenv: 1.5, fdec: 0.4, a: 0.004, d: 0.3, s: 0.75, r: 0.25,
      lfo_f: 5.5, lfo_p: 18, lfo_d: 0.35, glide: 0.04, vol: -11 }),
  S('s-lead-flute', 'lead', 'Flûte', 'triangle, souffle · vibrato',
    { wave: 1, uni: 1, det: 0, wave2: 1, oct2: 1, mix2: 0.18, noise: 0.05, cut: 3600, res: 1, fenv: 0.4, fdec: 0.3, a: 0.06, d: 0.4, s: 0.85, r: 0.25,
      lfo_f: 5, lfo_p: 12, lfo_d: 0.4, vol: -7 }),
  S('s-lead-sifflet', 'lead', 'Sifflet', 'sinus pur · glissé',
    { wave: 0, uni: 1, det: 0, wave2: 5, cut: 8000, res: 0, fenv: 0, a: 0.03, d: 0.3, s: 0.9, r: 0.2, lfo_f: 6, lfo_p: 10, lfo_d: 0.25, glide: 0.06, vol: -9 }),
  S('s-lead-sync', 'lead', 'Lead mordant', 'carré, filtre résonant · enveloppe',
    { wave: 3, uni: 2, det: 6, wave2: 3, oct2: -1, mix2: 0.3, cut: 1300, res: 14, fenv: 2.4, fdec: 0.22, a: 0.002, d: 0.3, s: 0.6, r: 0.15, vol: -13 }),
  // nappes
  S('s-nappe-chaude', 'nappe', 'Nappe chaude', 'triangles · le filtre respire',
    { wave: 1, uni: 3, det: 16, wave2: 2, oct2: -1, mix2: 0.3, cut: 1800, res: 2, fenv: 0.3, fdec: 1.5, a: 0.6, d: 2, s: 0.85, r: 1.8, lfo_f: 0.15, lfo_c: 0.4, vol: -15 }),
  S('s-cordes', 'nappe', 'Cordes', '3 scies · attaque lente, vibrato',
    { wave: 2, uni: 3, det: 18, wave2: 5, cut: 3000, res: 1, fenv: 0.4, fdec: 0.8, a: 0.45, d: 1.2, s: 0.85, r: 1.2, lfo_f: 5.2, lfo_p: 6, lfo_d: 0.6, vol: -16 }),
  S('s-nappe-souffle', 'nappe', 'Souffle', 'sinus et bruit filtré · lente',
    { wave: 0, uni: 2, det: 8, wave2: 1, oct2: 1, mix2: 0.25, noise: 0.35, cut: 1200, res: 8, fenv: 0.6, fdec: 2, a: 1.2, d: 2, s: 0.8, r: 2.5, lfo_f: 0.1, lfo_c: 0.8, vol: -16 }),
  S('s-nappe-sombre', 'nappe', 'Nappe sombre', 'scies graves · filtre fermé qui ondule',
    { wave: 2, oct: -1, uni: 3, det: 20, wave2: 5, cut: 600, res: 6, fenv: 0.2, fdec: 1, a: 0.9, d: 1.5, s: 0.9, r: 2, lfo_f: 0.08, lfo_c: 1, vol: -20 }),
  // claviers
  S('s-orgue', 'clavier', 'Orgue', 'sinus et octave · trémolo',
    { wave: 0, uni: 1, det: 0, wave2: 1, oct2: 1, mix2: 0.45, cut: 6000, res: 0, fenv: 0, a: 0.005, d: 0.1, s: 1, r: 0.08, lfo_f: 6.5, lfo_a: 0.15, vol: -14 }),
  S('s-piano-elec', 'clavier', 'Piano électrique', 'sinus, deux octaves · trémolo',
    { wave: 0, uni: 1, det: 0, wave2: 1, oct2: 2, mix2: 0.15, cut: 4000, res: 0, fenv: 1.5, fdec: 0.3, a: 0.002, d: 1.4, s: 0.25, r: 0.5, lfo_f: 4.5, lfo_a: 0.2, vol: -13 }),
  S('s-clavinet', 'clavier', 'Clavinet', 'carré · résonant et court',
    { wave: 3, uni: 1, det: 0, wave2: 5, cut: 1800, res: 9, fenv: 2.5, fdec: 0.1, a: 0.001, d: 0.35, s: 0.15, r: 0.06, vol: -16 }),
  S('s-stab', 'clavier', 'Accord house', '3 scies · coup filtré',
    { wave: 2, uni: 3, det: 14, wave2: 5, cut: 1400, res: 7, fenv: 2.5, fdec: 0.2, a: 0.002, d: 0.25, s: 0, r: 0.2, vol: -17 }),
  // plucks
  S('s-harpe', 'pluck', 'Harpe', 'triangle · longue chute',
    { wave: 1, uni: 1, det: 0, wave2: 1, oct2: 1, mix2: 0.3, cut: 3000, res: 3, fenv: 2, fdec: 0.2, a: 0.001, d: 1.2, s: 0, r: 1, vol: -10 }),
  S('s-marimba', 'pluck', 'Marimba', 'sinus, deux octaves · coup de hauteur',
    { wave: 0, uni: 1, det: 0, wave2: 1, oct2: 2, mix2: 0.2, cut: 5000, res: 0, fenv: 0, a: 0.001, d: 0.35, s: 0, r: 0.3, penv: 2, pdec: 0.02, vol: -8 }),
  S('s-kalimba', 'pluck', 'Kalimba', 'triangle · clair et court',
    { wave: 1, uni: 1, det: 0, wave2: 1, oct2: 2, mix2: 0.12, cut: 4000, res: 2, fenv: 1, fdec: 0.08, a: 0.001, d: 0.6, s: 0, r: 0.5, vol: -9 }),
  // cloches
  S('s-glock', 'cloche', 'Glockenspiel', 'sinus · deux octaves',
    { wave: 0, uni: 1, det: 0, wave2: 1, oct2: 2, mix2: 0.4, cut: 8000, res: 0, fenv: 0, a: 0.001, d: 1.5, s: 0, r: 1.5, vol: -8 }),
  S('s-cristal', 'cloche', 'Cristal', 'triangle et bruit · brillant',
    { wave: 1, uni: 2, det: 7, wave2: 1, oct2: 2, mix2: 0.3, noise: 0.15, cut: 6000, res: 4, fenv: 1.5, fdec: 0.05, a: 0.001, d: 1, s: 0.05, r: 1.4, vol: -9 }),
  // arpèges
  S('s-arp-pluck', 'arp', 'Arpège pincé', 'pluck · monte en doubles croches, deux octaves',
    { wave: 2, uni: 1, det: 4, wave2: 5, cut: 900, res: 10, fenv: 4, fdec: 0.15, a: 0.002, d: 0.18, s: 0, r: 0.15, arp: 1, arp_div: 3, arp_oct: 2, arp_gate: 0.6, vol: -9 }),
  S('s-arp-trance', 'arp', 'Arpège trance', 'deux scies · va-et-vient sur trois octaves',
    { wave: 2, uni: 2, det: 10, wave2: 5, cut: 1800, res: 10, fenv: 2, fdec: 0.15, a: 0.001, d: 0.2, s: 0.3, r: 0.1, arp: 3, arp_div: 3, arp_oct: 3, arp_gate: 0.5, vol: -13 }),
  S('s-arp-bulles', 'arp', 'Bulles', 'sinus · hasard en triolets',
    { wave: 0, uni: 1, det: 0, wave2: 1, oct2: 1, mix2: 0.25, cut: 5000, res: 0, a: 0.001, d: 0.2, s: 0, r: 0.25, penv: 5, pdec: 0.03, arp: 5, arp_div: 4, arp_oct: 2, arp_gate: 0.5, vol: -6 }),
  // percussions
  S('s-kick', 'perc', 'Grosse caisse', 'sinus · la hauteur tombe',
    { wave: 0, oct: -1, uni: 1, det: 0, wave2: 5, cut: 2000, res: 0, fenv: 0, a: 0.001, d: 0.35, s: 0, r: 0.2, penv: 36, pdec: 0.06, vol: -9 }),
  S('s-tom', 'perc', 'Tom synthé', 'sinus · coup de hauteur',
    { wave: 0, uni: 1, det: 0, wave2: 5, cut: 3000, res: 0, fenv: 0, a: 0.001, d: 0.25, s: 0, r: 0.2, penv: 12, pdec: 0.12, vol: -7 }),
  S('s-charley', 'perc', 'Charley bruit', 'bruit seul · très court',
    { osc: 0, noise: 1, wave2: 5, cut: 16000, res: 0, fenv: 0, a: 0.001, d: 0.05, s: 0, r: 0.04, vol: -9 }),
  S('s-caisse', 'perc', 'Caisse bruit', 'triangle et bruit · coup',
    { osc: 0.6, wave: 1, oct: -1, wave2: 5, noise: 0.8, cut: 6000, res: 2, fenv: 1, fdec: 0.1, a: 0.001, d: 0.15, s: 0, r: 0.1, penv: 7, pdec: 0.03, vol: -10 }),
  // effets
  S('s-zap', 'fx', 'Zap', 'scie · hauteur et filtre qui tombent',
    { wave: 2, uni: 1, det: 0, wave2: 5, cut: 3500, res: 12, fenv: 3, fdec: 0.1, a: 0.001, d: 0.3, s: 0, r: 0.2, penv: 36, pdec: 0.08, vol: -9 }),
  S('s-sirene', 'fx', 'Sirène', 'carré · LFO triangle sur la hauteur',
    { wave: 3, uni: 1, det: 0, wave2: 5, cut: 3000, res: 2, fenv: 0, a: 0.05, d: 0.3, s: 1, r: 0.5, lfo_w: 1, lfo_f: 0.8, lfo_p: 100, vol: -9 }),
  S('s-vent', 'fx', 'Vent', 'bruit · filtre résonant qui balaie',
    { osc: 0, noise: 1, wave2: 5, cut: 800, res: 18, fenv: 0, a: 1, d: 1, s: 1, r: 2, lfo_f: 0.12, lfo_c: 2, vol: -16 }),
  S('s-chute', 'fx', 'Chute', 'scie · deux octaves qui descendent',
    { wave: 2, uni: 2, det: 15, wave2: 5, cut: 2500, res: 5, fenv: 0, a: 0.01, d: 1, s: 0.8, r: 0.5, penv: 24, pdec: 1.6, vol: -11 }),

  // ── Analog (le soustractif d'ODIO : forme 0 scie, 1 carré, 2 triangle, 3 sinus) ──
  A('analog', 'lead', 'Analog', 'scie · deux oscillateurs', {}),
  A('analog-carre', 'lead', 'Analog carré', 'carré · filtre', { wave: 1 }),
  A('an-basse', 'basse', 'Basse analog', 'scie · filtre fermé qui claque',
    { wave: 0, detune: 6, cutoff: 180, resonance: 6, envAmount: 1400, attack: 0.002, decay: 0.22, sustain: 0.35, release: 0.1, gain: 0.56 }),
  A('an-basse-ronde', 'basse', 'Basse ronde', 'triangle · douce',
    { wave: 2, detune: 4, cutoff: 400, resonance: 2, envAmount: 600, attack: 0.003, decay: 0.3, sustain: 0.6, release: 0.12, gain: 0.68 }),
  A('an-lead', 'lead', 'Lead analog', 'scie désaccordée · brillante',
    { wave: 0, detune: 14, cutoff: 2400, resonance: 5, envAmount: 2500, attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.2, gain: 0.5 }),
  A('an-cuivres', 'clavier', 'Cuivres', 'scie · le filtre s\'ouvre à l\'attaque',
    { wave: 0, detune: 10, cutoff: 700, resonance: 2, envAmount: 3200, attack: 0.06, decay: 0.45, sustain: 0.7, release: 0.25, gain: 0.5 }),
  A('an-nappe', 'nappe', 'Nappe analog', 'scie très désaccordée · lente',
    { wave: 0, detune: 28, cutoff: 1500, resonance: 1.5, envAmount: 500, attack: 0.8, decay: 1.5, sustain: 0.8, release: 1.6, gain: 0.45 }),
  A('an-cordes', 'nappe', 'Cordes analog', 'scie · attaque douce',
    { wave: 0, detune: 20, cutoff: 3500, resonance: 0.7, envAmount: 300, attack: 0.5, decay: 1, sustain: 0.9, release: 1.2, gain: 0.4 }),
  A('an-pluck', 'pluck', 'Pluck analog', 'scie · enveloppe de filtre courte',
    { wave: 0, detune: 8, cutoff: 300, resonance: 8, envAmount: 5000, attack: 0.001, decay: 0.18, sustain: 0, release: 0.2, gain: 0.6 }),
  A('an-clavier', 'clavier', 'Clavier analog', 'carré · chute moyenne',
    { wave: 1, detune: 5, cutoff: 1200, resonance: 3, envAmount: 2400, attack: 0.002, decay: 0.5, sustain: 0.2, release: 0.3, gain: 0.3 }),
  A('an-cloche', 'cloche', 'Cloche douce', 'sinus · longue chute',
    { wave: 3, detune: 3, cutoff: 8000, resonance: 1, envAmount: 0, attack: 0.001, decay: 1.2, sustain: 0, release: 1.2, gain: 0.75 }),
  A('an-perc', 'perc', 'Perc analog', 'triangle · filtre qui claque',
    { wave: 2, detune: 0, cutoff: 200, resonance: 10, envAmount: 7000, attack: 0.001, decay: 0.07, sustain: 0, release: 0.05, gain: 0.85 }),
  A('an-arp', 'arp', 'Arpège analog', 'carré · monte en doubles croches',
    { wave: 1, detune: 6, cutoff: 900, resonance: 6, envAmount: 3000, attack: 0.001, decay: 0.15, sustain: 0.1, release: 0.1, gain: 0.55, arp: 1, arp_div: 3, arp_oct: 2, arp_gate: 0.55 }),

  // ── Basse acide (la 303 d'ODIO : forme 0 scie, 1 carré) ──
  B('acide', 'basse', 'Basse acide', 'scie · filtre 18 dB', {}),
  B('acide-carre', 'basse', 'Acide carrée', 'carré · filtre 18 dB', { wave: 1 }),
  B('ac-squelch', 'basse', 'Squelch', 'très résonante · enveloppe forte',
    { cutoff: 300, resonance: 20, envMod: 85, decay: 0.25, accent: 80 }),
  B('ac-profonde', 'basse', 'Profonde', 'filtre fermé · longue',
    { cutoff: 110, resonance: 8, envMod: 35, decay: 0.9, accent: 40, gain: 0.75 }),
  B('ac-caoutchouc', 'basse', 'Caoutchouc', 'résonance moyenne · chute longue',
    { cutoff: 200, resonance: 14, envMod: 50, decay: 1.4, accent: 60 }),
  B('ac-miaou', 'basse', 'Miaou', 'accent à fond',
    { cutoff: 350, resonance: 18, envMod: 70, decay: 0.5, accent: 100, gain: 0.73 }),
  B('ac-rave', 'basse', 'Rave', 'carré · ouvert et court',
    { wave: 1, cutoff: 900, resonance: 16, envMod: 70, decay: 0.15, accent: 70, gain: 0.72 }),
  B('ac-glissee', 'basse', 'Glissée', 'glissé long',
    { cutoff: 400, resonance: 15, envMod: 55, decay: 0.6, glide: 0.2, gain: 0.76 }),
  B('ac-douce', 'basse', 'Douce', 'peu de résonance',
    { cutoff: 600, resonance: 3, envMod: 20, decay: 1.6, accent: 20, gain: 0.92 }),
  B('ac-sub', 'basse', 'Sub acide', 'presque fermée · ronde',
    { cutoff: 80, resonance: 2, envMod: 8, decay: 2, accent: 10, gain: 1.0 }),
  B('ac-lead', 'lead', 'Lead acide', 'scie résonante · plus haut',
    { cutoff: 1200, resonance: 17, envMod: 60, decay: 0.3, accent: 70, gain: 0.84 }),

  // ── Numérique (Plaits : modèle 0 forme, 1 scie, 2 harmo, 3 grain, 4 phase, 5 formants ; filtre 0 lp, 1 bp, 2 hp) ──
  N('plaits-forme', 'lead', 'Numérique', 'Plaits · forme', { modele: 0 }),
  N('plaits-formants', 'lead', 'Formants', 'Plaits · formants', { modele: 5 }),
  N('plaits-grain', 'nappe', 'Grain', 'Plaits · grain', { modele: 3, gain: 0.3 }),
  N('pl-basse', 'basse', 'Basse numérique', 'forme · filtre fermé',
    { modele: 0, harmo: 0.2, timbre: 0.35, morph: 0.6, cutoff: 500, resonance: 4, envAmount: 2500, attack: 0.002, decay: 0.25, sustain: 0.5, release: 0.1, gain: 0.46 }),
  N('pl-scie', 'lead', 'Scies', 'scie · brillante',
    { modele: 1, harmo: 0.6, timbre: 0.6, morph: 0.5, cutoff: 4000, resonance: 3, envAmount: 2000, attack: 0.004, decay: 0.3, sustain: 0.7, release: 0.25, gain: 0.68 }),
  N('pl-orgue', 'clavier', 'Orgue additif', 'harmo · tenu',
    { modele: 2, harmo: 0.3, timbre: 0.6, morph: 0.3, cutoff: 8000, resonance: 1, envAmount: 0, attack: 0.005, decay: 0.2, sustain: 1, release: 0.12, gain: 0.16 }),
  N('pl-cloche', 'cloche', 'Cloche numérique', 'phase · longue chute',
    { modele: 4, harmo: 0.7, timbre: 0.6, morph: 0.2, cutoff: 9000, resonance: 1, envAmount: 0, attack: 0.001, decay: 1.2, sustain: 0, release: 1.2, gain: 0.79 }),
  N('pl-voix', 'nappe', 'Voix', 'formants · lente',
    { modele: 5, harmo: 0.4, timbre: 0.3, morph: 0.6, cutoff: 5000, resonance: 1, envAmount: 500, attack: 0.15, decay: 0.8, sustain: 0.8, release: 0.8, gain: 0.3 }),
  N('pl-nappe', 'nappe', 'Nappe additive', 'harmo · lente, filtre doux',
    { modele: 2, harmo: 0.5, timbre: 0.4, morph: 0.5, cutoff: 2500, resonance: 1.5, envAmount: 300, attack: 0.9, decay: 1.5, sustain: 0.8, release: 2, gain: 0.16 }),
  N('pl-pluck', 'pluck', 'Pluck numérique', 'phase · court, filtre qui claque',
    { modele: 4, harmo: 0.4, timbre: 0.5, morph: 0.5, cutoff: 800, resonance: 5, envAmount: 4000, attack: 0.001, decay: 0.25, sustain: 0, release: 0.3, gain: 0.6 }),
  N('pl-grain', 'fx', 'Grain bruissant', 'grain · passe-bande',
    { modele: 3, harmo: 0.8, timbre: 0.7, morph: 0.7, fmode: 1, cutoff: 2000, resonance: 4, envAmount: 1500, attack: 0.05, decay: 0.6, sustain: 0.6, release: 0.8, gain: 1.0 }),
  N('pl-perc', 'perc', 'Perc numérique', 'forme · très courte',
    { modele: 0, harmo: 0.1, timbre: 0.8, morph: 0.9, cutoff: 3000, resonance: 6, envAmount: 6000, attack: 0.001, decay: 0.08, sustain: 0, release: 0.06, gain: 0.46 }),
  N('pl-arp', 'arp', 'Arpège numérique', 'phase · hasard en doubles croches',
    { modele: 4, harmo: 0.5, timbre: 0.5, morph: 0.4, cutoff: 3000, resonance: 3, envAmount: 2000, attack: 0.001, decay: 0.18, sustain: 0.1, release: 0.15, gain: 0.86, arp: 5, arp_div: 3, arp_oct: 2, arp_gate: 0.5 }),

  // ── Échantillonneur : des enveloppes, qui gardent le son posé ──
  E('ech-coup', 'Coup', 'attaque nette · chute courte', { a: 0.001, r: 0.05 }),
  E('ech-tenu', 'Tenu', 'chute moyenne', { a: 0.005, r: 0.4 }),
  E('ech-doux', 'Doux', 'attaque adoucie', { a: 0.04, r: 0.6 }),
  E('ech-nappe', 'Nappe', 'attaque et chute lentes', { a: 0.8, r: 2 }),
  E('ech-staccato', 'Staccato', 'chute très courte', { a: 0.002, r: 0.02 }),
  E('ech-decale', 'Sans attaque', 'part à 5 % du son', { start: 0.05, a: 0.01, r: 0.3 }),
];

// ── les phrases d'écoute ────────────────────────────────────
// En doubles croches, une mesure de quatre temps, sur do (60 = do4) : la
// session les transpose à sa tonique (tonique ≤ fa# : vers le haut, sinon
// vers le bas). Choix d'écriture.
const n = (s, l, p, v = 0.8, x = {}) => ({ s, l, p, v, ...x });
const accord = (s, l, ps, v = 0.75) => ps.map((p) => n(s, l, p, v));
const PHRASES = {
  basse: { steps: 16, notes: [n(0, 3, 36, 0.9), n(4, 2, 36), n(6, 2, 43), n(8, 3, 39, 0.9), n(12, 2, 41), n(14, 2, 43)] },
  // la phrase de la basse acide d'ODIO (tuiles.js, phraseDeMachine), ramenée sur do : liaisons et accents
  acide: { steps: 16, notes: [[0, 36, 0, 1], [2, 36, 1, 0], [3, 48, 0, 0], [4, 36, 0, 1], [6, 39, 1, 0], [7, 36, 0, 0], [8, 36, 0, 1], [10, 43, 1, 0],
    [11, 36, 0, 0], [12, 48, 0, 1], [14, 46, 1, 0], [15, 39, 0, 0]].map(([s, p, sl, ac]) => n(s, sl ? 2 : 1, p, ac ? 1 : 0.7, { ...(sl ? { sl: true } : {}), ...(ac ? { ac: true } : {}) })) },
  lead: { steps: 16, notes: [n(0, 2, 72), n(2, 2, 75), n(4, 3, 79, 0.9), n(8, 2, 77), n(10, 2, 75), n(12, 4, 74, 0.85)] },
  nappe: { steps: 16, notes: accord(0, 14, [60, 63, 67, 70]) },
  clavier: { steps: 16, notes: [...accord(0, 3, [60, 63, 67]), ...accord(4, 2, [60, 63, 67], 0.65), ...accord(8, 3, [58, 62, 65]), ...accord(12, 3, [58, 62, 65], 0.65)] },
  pluck: { steps: 16, notes: [60, 63, 67, 72, 67, 63, 60, 63, 65, 68, 72, 77, 72, 68, 65, 68].map((p, s) => n(s, 1, p, s % 4 ? 0.7 : 0.9)) },
  cloche: { steps: 16, notes: [n(0, 6, 84), n(4, 6, 79, 0.7), n(8, 6, 87), n(12, 4, 82, 0.7)] },
  perc: { steps: 16, notes: [n(0, 1, 48, 1), n(3, 1, 48, 0.7), n(6, 1, 55, 0.8), n(8, 1, 48, 1), n(11, 1, 52, 0.6), n(12, 1, 60, 0.9), n(14, 1, 55, 0.7)] },
  fx: { steps: 16, notes: [n(0, 12, 60, 0.85)] },
  // une mesure de batterie qui fait entendre le kit : grosse caisse, caisse,
  // clap, charleys, l'ouvert, et une descente de toms à la fin
  kit: { steps: 16, lanes: {
    bd: [1, 0, 0, 0, 0, 0, 0.7, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    sd: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    cp: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0],
    ch: [0.8, 0, 0.5, 0, 0.8, 0, 0.5, 0, 0.8, 0, 0.5, 0, 0.8, 0, 0, 0],
    oh: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0],
    rs: [0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0],
    cb: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0],
    ht: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0],
    mt: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0],
    lt: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9],
  } },
};
PHRASES.arp = PHRASES.nappe;
PHRASES.env = { steps: 16, notes: [n(0, 4, 60), n(4, 4, 67, 0.7), n(8, 8, 63)] };

/**
 * La phrase qui fait entendre un préréglage, et sa transposition :
 * { phrase, tr }. `tonique` : celle de la session (0 = do). Le Synthé a un
 * réglage d'octave : l'écoute le compense, pour qu'une basse s'entende dans
 * le grave quel que soit son réglage (elle joue la phrase à son registre).
 */
export function phraseDe(pr, tonique = 0) {
  const p = pr.params || {};
  let cat = pr.cat || (pr.type === 'rythme' || pr.type === 'drums' ? 'kit' : pr.type === 'sampler' ? 'env' : 'lead');
  if ((p.arp || 0) > 0) cat = 'arp';
  const phrase = pr.type === 'acid' && cat === 'basse' ? PHRASES.acide : (PHRASES[cat] || PHRASES.lead);
  const t = ((tonique % 12) + 12) % 12;
  let tr = t <= 6 ? t : t - 12;
  if (pr.type === 'synth') tr -= 12 * (p.oct || 0);
  return { phrase, tr };
}
