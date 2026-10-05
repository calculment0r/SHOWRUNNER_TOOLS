// ODIO — les filtres de la vue Instruments : le Filtre, le Filtre drive
// d'ODIO, et le filtre des synthés (Synthé, Analog, Basse acide, Numérique).
//
// La référence : Auto Filter de Live 12 (la courbe du filtre, qu'on tire),
// le filtre d'un synthé de Bitwig ou de Live (la courbe, et la course de
// l'enveloppe) — docs/etudes/odio_appareils.md § 3.3. Une surface :
//   la courbe     la réponse exacte du ou des biquads du moteur (calcul.js) ;
//   le point      à la coupure, posé sur la courbe : glisser = la coupure
//                 (horizontal) et la résonance (vertical) ; molette : la
//                 résonance ; double-clic : les deux à défaut ; Maj : fin ;
//   l'enveloppe   pour un synthé : la courbe au sommet de l'enveloppe de
//                 filtre, en pointillé, et l'aire balayée entre les deux ;
//   le spectre    pour un effet : ce qui sort du filtre, en fond.
// Le passe-bas et le passe-haut lisent leur résonance en décibels
// (spécification Web Audio, α_QdB) : la bosse à la coupure vaut ce réglage,
// et le point se tire alors exactement sur l'échelle de gauche.

import { el } from '../ui.js';
import { ouverture, resonanceParEtage } from '../odio/instruments/acid-bass.js';
import { fVersN, nVersF, REPERES_F, frequences, reponse, gainA } from './calcul.js';
import { ecran, s, trait, etiquette, poignee, gestes, liaison, trace, selecteur, AIDE } from './surface.js';

const TYPES = ['lowpass', 'highpass', 'bandpass', 'allpass'];
const NOM = { lowpass: 'PASSE-BAS', highpass: 'PASSE-HAUT', bandpass: 'PASSE-BANDE', allpass: 'AUCUN' };

// Chaque module : où lire le type, la coupure, la résonance ; ses étages ;
// le sommet de son enveloppe de filtre (une fonction de ses réglages).
const FILTRES = {
  filter: { type: (L) => TYPES[L.get('type')], f: 'freq', q: 'q', nyq: true, types: 3, spectre: true },
  filtre: { type: (L) => TYPES[L.get('type')], f: 'cutoff', q: 'reso', types: 4, spectre: true, autres: ['drive'] },
  // le synthé du studio : un passe-bas, résonance en dB ; l'enveloppe ouvre de `fenv` octaves (moteur.js, SRC.synth)
  synth: { type: () => 'lowpass', f: 'cut', q: 'res', nyq: true, sommet: (L) => L.get('cut') * Math.pow(2, L.get('fenv')) },
  // Analog : un passe-bas par voix, ouvert de envAmount Hz (odio/instruments/analog-synth.js)
  analog: { type: () => 'lowpass', f: 'cutoff', q: 'resonance', sommet: (L) => Math.min(L.get('cutoff') + L.get('envAmount'), 20000) },
  // Numérique (Plaits) : son mode de filtre, ouvert de envAmount Hz à pleine vélocité (plaits-synth.js)
  plaits: { type: (L) => ['lowpass', 'bandpass', 'highpass'][L.get('fmode')], f: 'cutoff', q: 'resonance', sommet: (L) => Math.min(L.get('cutoff') + L.get('envAmount'), 18000) },
  // Basse acide : trois passe-bas en série, la résonance sur le premier seulement (acid-bass.js, ETAGES, resonanceParEtage)
  // Macro (Plaits complet) : un passe-bas après les voix, sans enveloppe (plaits/macro.js)
  macro: { type: () => 'lowpass', f: 'cutoff', q: 'resonance' },
  acid: { type: () => 'lowpass', f: 'cutoff', q: 'resonance', etages: 3, sommet: (L, fs) => ouverture(L.get('cutoff'), L.get('envMod'), L.get('accent'), false, fs / 2) },
};
export const A_FILTRE = (type) => !!FILTRES[type];

const DB_HAUT = 24, DB_BAS = -36;
const N = 201;

// filtre(app, m, { accent, w, h, compact }) : la surface (et pour un effet,
// son sélecteur de type et ses molettes). `compact` : la surface seule, pour
// la section d'un synthé.
// l'icône d'un type : sa réponse, calculée comme la grande (calcul.js), en 26 × 12
export function icone(type) {
  const n = 27, r = reponse([{ type, f: type === 'lowpass' ? 900 : type === 'highpass' ? 700 : 800, q: type === 'bandpass' ? 2 : 3 }], n, 48000);
  const pts = Array.from(r, (db, i) => [i, 3 + Math.min(9, Math.max(0, -db / 4))]);
  return s('svg', { class: 'ap-icone', width: 26, height: 12, viewBox: '0 0 26 12', 'aria-hidden': 'true' }, s('path', { d: trace(pts) }));
}

export function filtre(app, m, { accent = 'cy', w = 380, h = 140, compact = false, L: lie = null } = {}) {
  const D = FILTRES[m.type];
  const L = lie || liaison(app, m);
  L.ecoute(() => peindre());
  const fs = () => app.engine.ctx?.sampleRate || 48000;
  const HAUT = compact ? 4 : 14, BAS = h - (compact ? 4 : 13);
  const yDe = (db) => HAUT + ((DB_HAUT - db) / (DB_HAUT - DB_BAS)) * (BAS - HAUT);
  const xDe = (f) => fVersN(f) * w;
  const type = () => D.type(L);
  const qDb = () => type() === 'lowpass' || type() === 'highpass';
  const coupure = () => (D.nyq ? Math.min(L.get(D.f), fs() * 0.45) : L.get(D.f));
  // les étages du moteur à une coupure donnée
  const etages = (f) => {
    if (!D.etages) return [{ type: type(), f, q: L.get(D.q) }];
    const out = [];
    for (let i = 0; i < D.etages; i++) out.push({ type: 'lowpass', f, q: i === 0 ? resonanceParEtage(L.get(D.q), D.etages) : 0.5 });
    return out;
  };

  const E = ecran(w, h, `ap-filtre${compact ? ' compact' : ''}`);
  {
    const g = E.c.grille;
    for (const [f, t] of REPERES_F) {
      g.append(trait(xDe(f), 0, xDe(f), h, t ? 'fort' : ''));
      if (t && !compact) g.append(etiquette(xDe(f) + 3, h - 3, t));
    }
    for (const db of [12, -12, -24]) g.append(trait(0, yDe(db), w, yDe(db)));
    g.append(trait(0, yDe(0), w, yDe(0), 'zero'));
    if (!compact) for (const db of [12, 0, -24]) g.append(etiquette(4, yDe(db) - 3, db > 0 ? `+${db}` : db < 0 ? `−${-db}` : '0 dB'));
  }
  const spectre = s('path', { class: 'ap-spectre' });
  E.c.spectre.append(spectre);
  const balaye = s('path', { class: 'ap-balaye' }), courbeEnv = s('path', { class: 'ap-courbe-env' });
  const aire = s('path', { class: 'ap-aire' }), courbe = s('path', { class: 'ap-courbe' });
  E.c.courbes.append(balaye, courbeEnv, aire, courbe);
  const pt = poignee('F', '');
  E.c.points.append(pt);
  const lecture = s('text', { class: 'ap-lecture', x: 6, y: 11 });
  if (!compact) E.c.texte.append(lecture);

  const tracer = (f) => Array.from(reponse(etages(f), N, fs()), (db, i) => [(i / (N - 1)) * w, Math.max(-2, Math.min(h + 2, yDe(db)))]);
  function peindre() {
    const f = coupure(), xy = tracer(f);
    courbe.setAttribute('d', trace(xy));
    aire.setAttribute('d', `${trace(xy)} L${w} ${h} L0 ${h} Z`);
    if (D.sommet) {
      const fe = Math.min(D.sommet(L, fs()), fs() * 0.45);
      const xe = tracer(fe);
      courbeEnv.setAttribute('d', fe > f * 1.01 ? trace(xe) : '');
      // l'aire que l'enveloppe balaie : entre la courbe au repos et la courbe au sommet
      balaye.setAttribute('d', fe > f * 1.01 ? `${trace(xe)} L${trace(xy.slice().reverse()).slice(1)} Z` : '');
    }
    const y = gainA(etages(f), f, fs());
    pt.poser(xDe(f), Math.max(HAUT, Math.min(BAS, yDe(y))));
    const q = L.get(D.q);
    lecture.textContent = `${NOM[type()]}   ${L.texte(D.f)}   ${qDb() ? `RÉSONANCE ${q >= 0 ? '+' : ''}${q.toFixed(1)} dB` : `Q ${q.toFixed(2)}`}${D.etages ? `   ${D.etages * 6} dB/OCT.` : type() === 'allpass' ? '' : '   12 dB/OCT.'}`;
  }

  let nx = 0, qv = 0;
  gestes(E, {
    trouver: (p) => (Math.hypot(pt.px - p.x, pt.py - p.y) < 14 ? { id: 'F', curseur: 'move' } : null),
    survol: (c) => pt.classList.toggle('survol', !!c),
    debut: () => { nx = fVersN(L.get(D.f)); qv = L.get(D.q); pt.classList.add('on'); },
    tire: (c, d) => {
      nx += d.dx / w;
      const s1 = L.sp(D.f);
      L.pose(D.f, Math.max(s1.min, Math.min(s1.max, nVersF(nx))), true);
      // la résonance : monter la pousse ; en décibels pour un passe-bas, un
      // passe-haut (à l'échelle de gauche : le point suit la main), en Q sinon
      const sq = L.sp(D.q);
      qv = qDb() && !D.etages ? qv - d.dy / ((BAS - HAUT) / (DB_HAUT - DB_BAS)) : qv * Math.exp(-d.dy * 0.02);
      qv = Math.max(sq.min, Math.min(sq.max, qv));
      L.pose(D.q, qv, true);
      peindre();
    },
    fin: () => { pt.classList.remove('on'); L.fin(); },
    molette: (c, sens, e) => { L.pose(D.q, L.get(D.q) * Math.pow(e.shiftKey ? 1.03 : 1.12, sens)); clearTimeout(molT); molT = setTimeout(() => L.fin(), 300); },
    double: () => { L.pose(D.f, L.defaut(D.f), true); L.pose(D.q, L.defaut(D.q)); L.fin(); },
    clavier: (touche, e) => {
      const k = e.shiftKey ? 0.2 : 1;
      if (touche === 'ArrowLeft' || touche === 'ArrowRight') L.pose(D.f, nVersF(fVersN(L.get(D.f)) + (touche === 'ArrowRight' ? 0.01 : -0.01) * k));
      else L.pose(D.q, L.get(D.q) * Math.pow(1.06, (touche === 'ArrowUp' ? 1 : -1) * k));
      clearTimeout(molT); molT = setTimeout(() => L.fin(), 300);
    },
  });
  let molT = null;
  E.box.title = `le point : la coupure et la résonance · molette : la résonance · ${AIDE}`;

  // ── le spectre de la sortie (un effet) ──
  let an = null, buf = null, tour = 0, plein = false;
  function frame() {
    if (!D.spectre || ++tour % 2) return;
    if (!an) { an = app.engine.sonde?.(m.id, 'out'); if (!an) return; buf = new Float32Array(an.frequencyBinCount); }
    an.getFloatFrequencyData(buf);
    const F = frequences(N), bin = (fs() / 2) / buf.length;
    const xy = [];
    let vivant = false;
    for (let i = 0; i < N; i++) {
      const fa = i ? Math.sqrt(F[i - 1] * F[i]) : F[0], fb = i < N - 1 ? Math.sqrt(F[i] * F[i + 1]) : F[N - 1];
      const ia = Math.max(1, Math.floor(fa / bin)), ib = Math.min(buf.length - 1, Math.max(ia, Math.ceil(fb / bin)));
      let v = -Infinity;
      for (let j = ia; j <= ib; j++) if (buf[j] > v) v = buf[j];
      v += 3 * Math.log2(F[i] / 1000);   // la pente d'affichage de l'égaliseur (egaliseur.js)
      if (v > -97) vivant = true;
      xy.push([(i / (N - 1)) * w, h - ((Math.max(-100, Math.min(-10, v)) + 100) / 90) * h]);
    }
    if (!vivant) { if (plein) { spectre.setAttribute('d', ''); plein = false; } return; }
    plein = true;
    spectre.setAttribute('d', `M0 ${h} L${trace(xy).slice(1)} L${w} ${h} Z`);
  }

  peindre();
  if (compact) return { el: E.box, frame, peindre, L };
  // le type : la forme de chaque filtre en petit (le sélecteur d'Auto Filter), son nom au survol
  const typeSel = D.types ? selecteur(TYPES.slice(0, D.types).map(icone), L.get('type'), (i) => { L.pose('type', i); L.fin(); }, { titre: 'type de filtre', cls: 'ap-types' }) : null;
  if (typeSel) [...typeSel.children].forEach((b, i) => { b.title = NOM[TYPES[i]].toLowerCase(); b.setAttribute('aria-label', b.title); });
  const ks = [D.f, D.q, ...(D.autres || [])].map((k, i) => L.molette(k, { accent: i < 2 ? accent : 'cy' }));
  const root = el('div', { class: 'ap ap-filtrex', style: { width: `${w}px` } }, E.box,
    el('div', { class: 'ap-reglages' }, typeSel, el('div', { class: 'ap-kns' }, ks)));
  return { el: root, frame, peindre };
}

