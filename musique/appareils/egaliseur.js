// ODIO — l'égaliseur graphique de la vue Instruments (Égaliseur, EQ-3, et
// le correcteur de la Table de mix).
//
// La référence : EQ Eight de Live 12 et Pro-Q de FabFilter
// (docs/etudes/odio_appareils.md § 3.1). Une seule surface : la courbe de
// réponse de toute la chaîne de biquads, calculée avec les formules du
// moteur (calcul.js : celles de BiquadFilterNode), le spectre de ce qui sort
// de l'égaliseur en fond (un AnalyserNode piqué sur sa sortie, moteur.js
// Graph.sonde) et un point par bande, numéroté, qu'on attrape :
//   glisser          fréquence (horizontal) et gain (vertical) ; pour une
//                    coupe, le vertical est sa résonance (le point est posé
//                    sur sa courbe : 20·log10 Q à la coupure)
//   Alt + glisser    le Q (vertical)            molette sur le point : le Q
//   Maj              le réglage fin             double-clic : la bande à défaut
//   flèches          la bande choisie (Alt : le Q, Maj : fin)
// Une coupe éteinte reste dessinée en creux : la tirer l'allume.
// Sous l'écran : les bandes (choisir, allumer une coupe) et les molettes de
// la bande choisie, pour lire et régler fin ; à droite, la sortie.

import { el } from '../ui.js';
import { LOW_CORNER, HIGH_CORNER } from '../odio/effects/eq3.js';
import { fVersN, nVersF, REPERES_F, frequences, reponse, linVersDb } from './calcul.js';
import { ecran, s, trait, etiquette, poignee, gestes, liaison, trace, AIDE } from './surface.js';

// Les bandes de chaque module. f / g / q : les clés des réglages ; fFixe,
// qFixe : ce que le module ne règle pas (les coudes de l'EQ-3, le Q par
// défaut d'un BiquadFilterNode : 1) ; qDb : le Q que le nœud lit en
// décibels (passe-bas, passe-haut) ; nyq : la fréquence que le moteur borne
// à 0,45 × la fréquence d'échantillonnage (moteur.js, nyq) ; on : l'interrupteur.
const BANDES = {
  eq: [
    { n: 1, nom: 'coupe-bas', court: 'C.-BAS', type: 'highpass', f: 'hpf', q: 'hpq', qDb: true, on: 'hpo' },
    { n: 2, nom: 'graves', court: 'GRAVES', type: 'lowshelf', f: 'lf', g: 'lg' },
    { n: 3, nom: 'médiums', court: 'MÉD.', type: 'peaking', f: 'mf', g: 'mg', q: 'mq' },
    { n: 4, nom: 'aigus', court: 'AIGUS', type: 'highshelf', f: 'hf', g: 'hg', nyq: true },
    { n: 5, nom: 'coupe-haut', court: 'C.-HAUT', type: 'lowpass', f: 'lpf', q: 'lpq', qDb: true, on: 'lpo', nyq: true },
  ],
  eq3: [
    { n: 1, nom: 'grave', court: 'GRAVE', type: 'lowshelf', fFixe: LOW_CORNER, g: 'low' },
    { n: 2, nom: 'médium', court: 'MÉDIUM', type: 'peaking', f: 'midHz', g: 'mid', q: 'width' },
    { n: 3, nom: 'aigu', court: 'AIGU', type: 'highshelf', fFixe: HIGH_CORNER, g: 'high' },
  ],
  // la table de mix : le correcteur de l'EQ-3 (table.js), sans largeur — le Q
  // par défaut du nœud
  table: [
    { n: 1, nom: 'grave', court: 'GRAVE', type: 'lowshelf', fFixe: LOW_CORNER, g: 'low' },
    { n: 2, nom: 'médium', court: 'MÉDIUM', type: 'peaking', f: 'midHz', g: 'mid', qFixe: 1 },
    { n: 3, nom: 'aigu', court: 'AIGU', type: 'highshelf', fFixe: HIGH_CORNER, g: 'high' },
  ],
};
const TYPE_FR = { highpass: 'coupe-bas · 12 dB/oct.', lowpass: 'coupe-haut · 12 dB/oct.', lowshelf: 'plateau', highshelf: 'plateau', peaking: 'cloche' };
// ce que l'égaliseur règle en plus de ses bandes, sous l'écran à droite
const AUTRES = { eq: ['out'], eq3: [], table: ['gain', 'pano', 'niveau'] };

const W = 440, H = 150;
const PLAGE = 20;                       // ±20 dB : la course des gains (±18) et un peu d'air
const HAUT = 14, BAS = H - 14;          // la bande utile, sous la lecture et au-dessus des fréquences
const Y0 = (HAUT + BAS) / 2, PAR_DB = (BAS - HAUT) / 2 / PLAGE;
const yDe = (db) => Y0 - db * PAR_DB;
const xDe = (f) => fVersN(f) * W;
const N = 221;                          // les points d'une courbe : un tous les deux pixels
// le spectre : −100 à −10 dBFS sur toute la hauteur, incliné de 3 dB par octave
// autour de 1 kHz pour qu'une musique se lise à plat (choix d'affichage, la
// « pente » de Pro-Q) ; −100 et −10 : les bornes posées sur l'analyseur
const SP_MIN = -100, SP_MAX = -10, PENTE = 3;

export const EST_EGALISEUR = (type) => !!BANDES[type];
// la bande choisie de chaque égaliseur, le temps de la page (le rack se redessine souvent)
const CHOIX = new Map();

export function egaliseur(app, m, { accent = 'cy' } = {}) {
  const bandes = BANDES[m.type];
  const L = liaison(app, m, () => peindre());
  const fs = () => app.engine.ctx?.sampleRate || 48000;
  let choisie = CHOIX.get(m.id) ?? (bandes.find((b) => b.g && b.f) || bandes[0]).n;
  let survolee = null;

  // ── ce qu'une bande vaut maintenant ──
  const actif = (b) => !b.on || !!L.get(b.on);
  const freq = (b) => (b.f ? L.get(b.f) : b.fFixe);
  const qLin = (b) => (b.q ? L.get(b.q) : b.qFixe ?? 1);
  const etage = (b) => ({
    type: b.type,
    f: b.nyq ? Math.min(freq(b), fs() * 0.45) : freq(b),
    q: b.qDb ? linVersDb(qLin(b)) : qLin(b),
    g: b.g ? L.get(b.g) : 0,
  });
  // le point d'une bande : sa fréquence ; son gain, ou pour une coupe sa
  // bosse à la coupure (20·log10 Q, là où sa courbe passe)
  const yBande = (b) => yDe(b.g ? L.get(b.g) : b.qDb ? linVersDb(qLin(b)) : 0);
  const gainGlobal = () => (m.type === 'eq' ? L.get('out') : 0);

  // ── l'écran ──
  const E = ecran(W, H, 'ap-eq');
  {
    const g = E.c.grille;
    for (const [f, t] of REPERES_F) {
      const x = xDe(f);
      g.append(trait(x, HAUT - 6, x, BAS + 2, t ? 'fort' : ''));
      if (t) g.append(etiquette(x + 3, H - 4, t));
    }
    for (const db of [-18, -12, -6, 6, 12, 18]) g.append(trait(0, yDe(db), W, yDe(db), Math.abs(db) === 12 ? 'fort' : ''));
    g.append(trait(0, Y0, W, Y0, 'zero'));
    // les gains à gauche : la coupe-haut se pose à droite, sur le zéro
    for (const db of [12, 0, -12]) g.append(etiquette(4, yDe(db) - 3, db > 0 ? `+${db}` : db < 0 ? `−${-db}` : '0 dB'));
  }
  const spectre = s('path', { class: 'ap-spectre' });
  E.c.spectre.append(spectre);
  const aire = s('path', { class: 'ap-aire' }), aireB = s('path', { class: 'ap-aire-b' });
  const courbe = s('path', { class: 'ap-courbe' }), courbeB = s('path', { class: 'ap-courbe-b' });
  E.c.courbes.append(aireB, courbeB, aire, courbe);
  const pts = new Map(bandes.map((b) => { const p = poignee(b.n, String(b.n)); E.c.points.append(p); return [b.n, p]; }));
  const lecture = s('text', { class: 'ap-lecture', x: 6, y: 11 });
  E.c.texte.append(lecture);

  function peindre() {
    const et = bandes.filter(actif).map(etage);
    const r = reponse(et, N, fs(), gainGlobal());
    const xy = Array.from(r, (db, i) => [(i / (N - 1)) * W, Math.max(-2, Math.min(H + 2, yDe(db)))]);
    courbe.setAttribute('d', trace(xy));
    aire.setAttribute('d', `${trace(xy)} L${W} ${Y0} L0 ${Y0} Z`);
    // la bande survolée ou choisie : sa propre courbe, en creux
    const b = bandes.find((x) => x.n === (survolee ?? choisie));
    if (b && actif(b)) {
      const rb = reponse([etage(b)], N, fs());
      const xb = Array.from(rb, (db, i) => [(i / (N - 1)) * W, Math.max(-2, Math.min(H + 2, yDe(db)))]);
      courbeB.setAttribute('d', trace(xb));
      aireB.setAttribute('d', `${trace(xb)} L${W} ${Y0} L0 ${Y0} Z`);
    } else { courbeB.setAttribute('d', ''); aireB.setAttribute('d', ''); }
    for (const x of bandes) {
      const p = pts.get(x.n);
      p.poser(xDe(freq(x)), Math.max(HAUT, Math.min(BAS, yBande(x))));
      p.classList.toggle('on', x.n === choisie);
      p.classList.toggle('eteint', !actif(x));
      p.classList.toggle('survol', x.n === survolee);
      p.classList.toggle('fixe', !x.f);
    }
    lire();
    peindreBandes();
  }

  // la lecture, en haut à gauche : la bande survolée, sinon la choisie
  function lire() {
    const b = bandes.find((x) => x.n === (survolee ?? choisie));
    if (!b) { lecture.textContent = ''; return; }
    const parts = [`${b.n} · ${b.nom.toUpperCase()}`];
    if (!actif(b)) parts.push('ÉTEINTE — LA TIRER L\'ALLUME');
    else {
      parts.push(b.f ? L.texte(b.f) : `${freq(b) >= 1000 ? `${(freq(b) / 1000).toFixed(1)} kHz` : `${freq(b)} Hz`}`);
      if (b.g) parts.push(L.texte(b.g));
      if (b.q) parts.push(`Q ${L.texte(b.q)}`);
      parts.push(TYPE_FR[b.type].toUpperCase());
    }
    lecture.textContent = parts.join('   ');
  }

  // ── les gestes ──
  const trouver = (p) => {
    let best = null, dmin = 13;
    for (const b of bandes) {
      const q = pts.get(b.n), d = Math.hypot(q.px - p.x, q.py - p.y);
      if (d < dmin) { dmin = d; best = b; }
    }
    return best ? { b: best, curseur: best.f ? 'move' : 'ns-resize' } : null;
  };
  let nx = 0, gy = 0;   // la position tirée, en espace de réglage (sans arrondi)
  const choisir = (n) => {
    choisie = n;
    CHOIX.set(m.id, n);
    peindreMolettes();
    peindre();
  };
  const fBornes = (b) => [L.sp(b.f).min, L.sp(b.f).max];
  gestes(E, {
    trouver,
    survol: (c) => { survolee = c?.b.n ?? null; peindre(); },
    debut: ({ b }) => {
      if (b.n !== choisie) choisir(b.n);
      if (b.on && !L.get(b.on)) L.pose(b.on, 1);   // une coupe éteinte qu'on tire s'allume
      nx = fVersN(freq(b));
      gy = b.g ? L.get(b.g) : b.q ? linVersDb(qLin(b)) : 0;
    },
    tire: ({ b }, d, p, e) => {
      if (e.altKey && b.q && b.g) {   // Alt : le Q de la cloche, à la verticale
        L.pose(b.q, qLin(b) * Math.exp(-d.dy * 0.025));
        return;
      }
      if (b.f) {
        nx += d.dx / W;
        const [a, z] = fBornes(b);
        L.pose(b.f, Math.max(a, Math.min(z, nVersF(nx))), true);
      }
      gy -= d.dy / PAR_DB;
      if (b.g) L.pose(b.g, gy, true);
      else if (b.qDb) L.pose(b.q, Math.pow(10, gy / 20), true);
      peindre();
    },
    fin: () => L.fin(),
    molette: ({ b }, sens, e) => {
      if (!b.q) return;
      L.pose(b.q, qLin(b) * Math.pow(e.shiftKey ? 1.03 : 1.12, sens));
      clearTimeout(molT); molT = setTimeout(() => L.fin(), 300);
    },
    double: ({ b }) => {
      for (const k of [b.f, b.g, b.q]) if (k) L.pose(k, L.defaut(k), true);
      peindre(); L.fin();
    },
    clavier: (touche, e) => {
      const b = bandes.find((x) => x.n === choisie);
      if (!b) return;
      const fin = e.shiftKey ? 0.2 : 1;
      if (e.altKey && b.q && (touche === 'ArrowUp' || touche === 'ArrowDown')) L.pose(b.q, qLin(b) * Math.pow(1.06, (touche === 'ArrowUp' ? 1 : -1) * fin));
      else if (touche === 'ArrowLeft' || touche === 'ArrowRight') { if (b.f) L.pose(b.f, nVersF(fVersN(freq(b)) + (touche === 'ArrowRight' ? 1 : -1) * 0.01 * fin)); }
      else if (b.g) L.pose(b.g, L.get(b.g) + (touche === 'ArrowUp' ? 0.5 : -0.5) * fin);
      else if (b.qDb) L.pose(b.q, qLin(b) * Math.pow(1.06, (touche === 'ArrowUp' ? 1 : -1) * fin));
      clearTimeout(molT); molT = setTimeout(() => L.fin(), 300);
    },
  });
  let molT = null;

  // ── sous l'écran : les bandes, les molettes de la bande choisie, la sortie ──
  const rangBandes = el('div', { class: 'ap-bandes', role: 'tablist', 'aria-label': 'les bandes' });
  const boutons = bandes.map((b) => {
    const bt = el('button', { class: 'ap-bd', type: 'button', role: 'tab', title: `${b.n} · ${b.nom} (${TYPE_FR[b.type]})${b.on ? ' — clic sur la pastille : allumer, éteindre' : ''}`,
      onclick: (e) => {
        if (b.on && e.target.closest('.ap-bd-on')) { L.pose(b.on, L.get(b.on) ? 0 : 1); L.fin(); return; }
        choisir(b.n);
      } },
    b.on ? el('i', { class: 'ap-bd-on', 'aria-label': 'allumer ou éteindre' }) : null,
    el('b', {}, String(b.n)), el('span', {}, b.court));
    rangBandes.append(bt);
    return [b, bt];
  });
  function peindreBandes() {
    for (const [b, bt] of boutons) {
      bt.classList.toggle('on', b.n === choisie);
      bt.classList.toggle('eteint', !actif(b));
      bt.setAttribute('aria-selected', b.n === choisie ? 'true' : 'false');
    }
  }
  const molettes = el('div', { class: 'ap-kns' });
  function peindreMolettes() {
    const b = bandes.find((x) => x.n === choisie) || bandes[0];
    const k = [];
    if (b.f) k.push(L.molette(b.f, { accent, label: 'Fréquence' }));
    if (b.g) k.push(L.molette(b.g, { accent, label: 'Gain' }));
    if (b.q) k.push(L.molette(b.q, { accent, label: 'Q' }));
    if (!k.length) k.push(el('span', { class: 'lbl ap-vide' }, 'rien à régler'));
    molettes.replaceChildren(...k);
  }
  const autres = el('div', { class: 'ap-kns ap-autres' }, AUTRES[m.type].filter((k) => L.a(k)).map((k) => L.molette(k, { accent: 'cy' })));
  // la table de mix : sa coupure est un interrupteur (≥ 0,5 coupe, table.js), pas une molette
  if (m.type === 'table') {
    const bt = el('button', { class: 'tb sm ghost ap-coupe', type: 'button', title: 'couper la tranche (le niveau reste)',
      onclick: () => { L.pose('coupe', L.get('coupe') >= 0.5 ? 0 : 1); L.fin(); peindreCoupe(); } }, 'Couper');
    const peindreCoupe = () => { bt.classList.toggle('on', L.get('coupe') >= 0.5); bt.classList.toggle('ghost', L.get('coupe') < 0.5); };
    peindreCoupe();
    autres.append(bt);
  }
  peindreMolettes();

  const aide = `glisser un point : la fréquence et le gain · Alt ou molette : le Q · ${AIDE}`;
  E.box.title = aide;
  const root = el('div', { class: 'ap ap-eqx', style: { width: `${W}px` } }, E.box,
    el('div', { class: 'ap-pied' }, rangBandes),
    el('div', { class: 'ap-reglages' }, molettes,
      el('span', { class: 'ap-aide lbl' }, 'glisser : fréq., gain', el('br'), 'alt, molette : q', el('br'), 'maj : fin · 2 clics : défaut'),
      autres.childElementCount ? el('i', { class: 'vsep' }) : null, autres.childElementCount ? autres : null));
  peindre();

  // ── le spectre, à chaque image (30 par seconde) ──
  let an = null, buf = null, tour = 0, plein = false;
  const sp = new Float64Array(N);
  function frame() {
    if (++tour % 2) return;
    if (!an) { an = app.engine.sonde?.(m.id, 'out'); if (!an) return; buf = new Float32Array(an.frequencyBinCount); }
    an.getFloatFrequencyData(buf);
    const F = frequences(N), bin = (fs() / 2) / buf.length;
    let vivant = false;
    for (let i = 0; i < N; i++) {
      // la case de chaque fréquence ; entre deux points, le plus fort (un pic
      // ne disparaît pas entre deux colonnes)
      const fa = i ? Math.sqrt(F[i - 1] * F[i]) : F[0], fb = i < N - 1 ? Math.sqrt(F[i] * F[i + 1]) : F[N - 1];
      const ia = Math.max(1, Math.floor(fa / bin)), ib = Math.min(buf.length - 1, Math.max(ia, Math.ceil(fb / bin)));
      let v = -Infinity;
      for (let j = ia; j <= ib; j++) if (buf[j] > v) v = buf[j];
      v += PENTE * Math.log2(F[i] / 1000);
      if (v > SP_MIN + 3) vivant = true;
      sp[i] = v;
    }
    if (!vivant) { if (plein) { spectre.setAttribute('d', ''); plein = false; } return; }
    plein = true;
    const y = (v) => H - ((Math.max(SP_MIN, Math.min(SP_MAX, v)) - SP_MIN) / (SP_MAX - SP_MIN)) * H;
    const xy = Array.from(sp, (v, i) => [(i / (N - 1)) * W, y(v)]);
    spectre.setAttribute('d', `M0 ${H} L${trace(xy).slice(1)} L${W} ${H} Z`);
  }

  return { el: root, frame, peindre };
}

