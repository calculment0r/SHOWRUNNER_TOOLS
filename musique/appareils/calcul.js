// ODIO — les appareils de la vue Instruments : le calcul, sans DOM.
//
// Ce que les surfaces dessinent est calculé ici, avec les formules mêmes du
// moteur — jamais une courbe d'illustration :
//   - les filtres biquad : les coefficients de la spécification Web Audio
//     (« Filters Characteristics », https://webaudio.github.io/web-audio-api/#filters-characteristics,
//     tirés de l'Audio EQ Cookbook), que BiquadFilterNode applique et que
//     getFrequencyResponse renvoie ; les cas limites (fréquence à 0 ou à
//     Nyquist) comme Chromium (third_party/blink/renderer/platform/audio/biquad.cc).
//     Le passe-bas et le passe-haut lisent leur Q en décibels (α_QdB), les
//     autres en Q linéaire (α_Q), les plateaux l'ignorent (S = 1) ;
//   - le compresseur : la courbe statique de DynamicsCompressorNode telle que
//     Chromium la calcule (dynamics_compressor.cc : KneeCurve, Saturate,
//     KAtSlope), et le gain de rattrapage automatique que la spécification
//     impose (« Computing the makeup gain » : (1 / courbe(1))^0,6) ;
//   - les tables de saturation : celles que les WaveShaperNode reçoivent
//     (moteur.js distCurve, odio/effects drive.js, crush.js, filter.js).
// L'essai : docs/etudes/odio_appareils.md § 5 (écart mesuré contre le
// navigateur).

import { saturate } from '../odio/effects/drive.js';
import { quantize } from '../odio/effects/crush.js';
import { makeDriveCurve } from '../odio/effects/filter.js';
import { distCurve } from '../moteur.js';

// ── les échelles ────────────────────────────────────────────
// Fréquences : 20 Hz à 20 kHz en logarithme (la règle des égaliseurs).
export const F_MIN = 20, F_MAX = 20000;
const LF = Math.log(F_MAX / F_MIN);
export const fVersN = (f) => Math.log(Math.max(1e-6, f) / F_MIN) / LF;
export const nVersF = (n) => F_MIN * Math.exp(n * LF);
// les repères : les décades et leurs moitiés, étiquetés ; les autres traits sans texte
export const REPERES_F = [
  [30, ''], [40, ''], [50, '50'], [60, ''], [70, ''], [80, ''], [90, ''], [100, '100'], [200, '200'], [300, ''], [400, ''],
  [500, '500'], [600, ''], [700, ''], [800, ''], [900, ''], [1000, '1k'], [2000, '2k'], [3000, ''], [4000, ''], [5000, '5k'],
  [6000, ''], [7000, ''], [8000, ''], [9000, ''], [10000, '10k'],
];
export const dbVersLin = (db) => Math.pow(10, db / 20);
export const linVersDb = (v) => (v > 0 ? 20 * Math.log10(v) : -1000);   // la spécification : 0 → −1000 dB

// Les n fréquences d'un tracé (réparties en logarithme), une fois par taille.
const FREQS = new Map();
export function frequences(n) {
  if (!FREQS.has(n)) FREQS.set(n, Float64Array.from({ length: n }, (_, i) => nVersF(i / (n - 1))));
  return FREQS.get(n);
}

// ── les biquads ─────────────────────────────────────────────
// coefs(type, f0, Q, G, fs) → { b0, b1, b2, a1, a2 } normalisés par a0.
// `type` : les noms de BiquadFilterNode.type (MDN).
export function coefs(type, f0, Q = 1, G = 0, fs = 48000) {
  const ny = fs / 2, f = Math.min(1, Math.max(0, f0 / ny));   // la fréquence ramenée à Nyquist, bornée (biquad.cc)
  const A = Math.pow(10, G / 40), w = Math.PI * f, cw = Math.cos(w), sw = Math.sin(w);
  const n = (b0, b1, b2, a0, a1, a2) => ({ b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 });
  const passe = n(1, 0, 0, 1, 0, 0), rien = n(0, 0, 0, 1, 0, 0);
  switch (type) {
    case 'lowpass': {
      if (f >= 1) return passe;
      if (f <= 0) return rien;
      const al = sw / (2 * Math.pow(10, Q / 20)), be = (1 - cw) / 2;
      return n(be, 2 * be, be, 1 + al, -2 * cw, 1 - al);
    }
    case 'highpass': {
      if (f >= 1) return rien;
      if (f <= 0) return passe;
      const al = sw / (2 * Math.pow(10, Q / 20)), be = (1 + cw) / 2;
      return n(be, -2 * be, be, 1 + al, -2 * cw, 1 - al);
    }
    case 'bandpass': {
      if (f <= 0 || f >= 1 || Q <= 0) return f > 0 && f < 1 ? passe : rien;
      const al = sw / (2 * Q);
      return n(al, 0, -al, 1 + al, -2 * cw, 1 - al);
    }
    case 'notch': {
      if (f <= 0 || f >= 1 || Q <= 0) return f > 0 && f < 1 ? rien : passe;
      const al = sw / (2 * Q);
      return n(1, -2 * cw, 1, 1 + al, -2 * cw, 1 - al);
    }
    case 'allpass': return passe;   // module plat : seule la phase tourne
    case 'peaking': {
      if (f <= 0 || f >= 1) return passe;
      if (Q <= 0) return n(A * A, 0, 0, 1, 0, 0);
      const al = sw / (2 * Q);
      return n(1 + al * A, -2 * cw, 1 - al * A, 1 + al / A, -2 * cw, 1 - al / A);
    }
    case 'lowshelf': case 'highshelf': {
      const bas = type === 'lowshelf';
      if (f >= 1) return bas ? n(A * A, 0, 0, 1, 0, 0) : passe;
      if (f <= 0) return bas ? passe : n(A * A, 0, 0, 1, 0, 0);
      const al = (sw / 2) * Math.SQRT2, k2 = 2 * Math.sqrt(A) * al, p = A + 1, m = A - 1;   // S = 1 : α_S = sin ω0 / √2
      return bas
        ? n(A * (p - m * cw + k2), 2 * A * (m - p * cw), A * (p - m * cw - k2), p + m * cw + k2, -2 * (m + p * cw), p + m * cw - k2)
        : n(A * (p + m * cw + k2), -2 * A * (m + p * cw), A * (p + m * cw - k2), p - m * cw + k2, 2 * (m - p * cw), p - m * cw - k2);
    }
    default: return passe;
  }
}

// |H(e^jω)| d'un biquad à la fréquence f
export function module(c, f, fs = 48000) {
  const w = 2 * Math.PI * f / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2, ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = 1 + c.a1 * c1 + c.a2 * c2, di = -(c.a1 * s1 + c.a2 * s2);
  return Math.sqrt((nr * nr + ni * ni) / Math.max(1e-30, dr * dr + di * di));
}

// La réponse d'une chaîne d'étages, en dB, sur les n fréquences de `frequences(n)` :
// les modules se multiplient (des étages en série), les décibels s'ajoutent.
// étage : { type, f, q, g } ; `gain` : un gain plat en dB en plus.
export function reponse(etages, n, fs = 48000, gain = 0) {
  const fr = frequences(n), out = new Float64Array(n).fill(gain);
  for (const e of etages) {
    const c = coefs(e.type, e.f, e.q ?? 1, e.g ?? 0, fs);
    for (let i = 0; i < n; i++) out[i] += linVersDb(module(c, fr[i], fs));
  }
  return out;
}
// la réponse d'un seul étage à une fréquence (le point d'une bande posé sur la courbe)
export const gainA = (etages, f, fs = 48000) => etages.reduce((s, e) => s + linVersDb(module(coefs(e.type, e.f, e.q ?? 1, e.g ?? 0, fs), f, fs)), 0);

// ── le compresseur ──────────────────────────────────────────
// compresseur(seuil, genou, taux) → { sortie(dB) : la crête de sortie pour
// une crête d'entrée, rattrapage automatique compris ; reduction(dB) : la
// réduction de gain (ce que `reduction` lit, sans le rattrapage) ;
// rattrapage : le gain automatique en dB }.
// Chromium : linéaire jusqu'au seuil, une exponentielle de pente 1 au seuil
// sur le genou [seuil, seuil + genou] (k cherché par 15 moyennes
// géométriques pour que la pente en dB y vaille 1/taux), puis la droite
// de pente 1/taux. Le genou n'est donc pas centré sur le seuil : il
// commence au seuil.
export function compresseur(seuil, genou, taux) {
  const lt = dbVersLin(seuil);
  const coude = (x, k) => (x < lt ? x : lt + (1 - Math.exp(-k * (x - lt))) / k);
  const xDb = seuil + genou, x = dbVersLin(xDb);
  let x2 = 1, x2Db = 0;
  if (!(x < lt)) { x2 = x * 1.001; x2Db = linVersDb(x2); }
  let kMin = 0.1, kMax = 10000, k = 5, pente = 1;
  for (let i = 0; i < 15; i++) {
    if (!(x < lt)) pente = (linVersDb(coude(x2, k)) - linVersDb(coude(x, k))) / (x2Db - xDb);
    if (pente < 1 / taux) kMax = k; else kMin = k;
    k = Math.sqrt(kMin * kMax);
  }
  const yDb = linVersDb(coude(x, k));
  const sat = (v) => (v < x ? coude(v, k) : dbVersLin(yDb + (linVersDb(v) - xDb) / taux));
  const rattrapage = 0.6 * -linVersDb(sat(1));
  return {
    rattrapage,
    reduction: (e) => linVersDb(sat(dbVersLin(e))) - e,
    sortie: (e) => linVersDb(sat(dbVersLin(e))) + rattrapage,
  };
}

// ── les saturations : la table que reçoit le WaveShaperNode ─
// table(sorte, réglages) → fonction x (−1..1) → y, lue comme le nœud la lit
// (interpolation linéaire entre les points de la table, spécification
// WaveShaperNode « curve »).
function lecteur(courbe) {
  const n = courbe.length;
  return (x) => {
    const v = ((Math.max(-1, Math.min(1, x)) + 1) / 2) * (n - 1), i = Math.floor(v), f = v - i;
    return i >= n - 1 ? courbe[n - 1] : courbe[i] * (1 - f) + courbe[i + 1] * f;
  };
}
const TABLES = new Map();
function memo(cle, fab) { if (!TABLES.has(cle)) { if (TABLES.size > 64) TABLES.clear(); TABLES.set(cle, lecteur(fab())); } return TABLES.get(cle); }
export function transfert(sorte, r) {
  if (sorte === 'dist') return memo(`d${r.drive}`, () => distCurve(r.drive));
  if (sorte === 'satura') return (x) => saturate(x, r.drive, r.bias);   // 1024 points : la fonction même, sans écart visible
  if (sorte === 'crush') return (x) => quantize(x, r.bits, r.drive);    // l'escalier, sans suréchantillonnage (crush.js)
  if (sorte === 'filtre') return memo(`f${r.drive}`, () => makeDriveCurve(r.drive));
  return (x) => x;
}

// ── la réverbération : l'enveloppe de la réponse impulsionnelle ─
// natif (moteur.js impulse) : du bruit qui perd 60 dB en `time` secondes,
// après le pré-délai `pre` ; ODIO (odio/effects/reverb.js #renderImpulse) :
// pré-délai 0,005 × 4 × taille, queue de decay × (0,3 + taille) bornée à
// 8 s, enveloppe (1 − t)^2,6.
export function reverb(sorte, r) {
  if (sorte === 'reverbe') {
    const queue = Math.min(8, r.decay * (0.3 + r.size / 100)), pre = 0.005 * (r.size / 100) * 4;
    return { pre, queue, niveau: (t) => (t < pre || t > queue ? 0 : Math.pow(1 - (t - pre) / Math.max(1e-6, queue - pre), 2.6)) };
  }
  return { pre: r.pre, queue: r.pre + r.time, niveau: (t) => (t < r.pre || t > r.pre + r.time ? 0 : Math.pow(10, (-3 * (t - r.pre)) / r.time)) };
}

// Un bruit fixe (même tirage à chaque dessin) pour figurer la réponse
// impulsionnelle : un générateur congruentiel, graine constante.
export function bruit(n, graine = 7) {
  const out = new Float32Array(n);
  let s = graine;
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; out[i] = (s / 4294967296) * 2 - 1; }
  return out;
}
