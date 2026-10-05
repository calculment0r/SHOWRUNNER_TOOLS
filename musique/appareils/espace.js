// ODIO — l'espace dans la vue Instruments : Réverbération, Réverbe d'ODIO,
// Délai, RTT-01, Chorus.
//
// La référence : Reverb et Delay de Live 12, Pro-R de FabFilter (la
// décroissance qu'on voit et qu'on tire) — docs/etudes/odio_appareils.md
// § 3.5. Ce qui est dessiné est ce que le moteur fabrique :
//   réverbération  la réponse impulsionnelle (calcul.js, reverb : du bruit
//                  sous l'enveloppe du moteur), le pré-délai, la fin de la
//                  queue (−60 dB pour la réverbération du studio), le son sec
//                  à 0 ; l'amorti en médaillon (le passe-bas du moteur) ;
//   délai          le coup sec, puis chaque écho à son instant et à son
//                  niveau (mix × retour^n), assombri à chaque passage dans
//                  le filtre de la boucle ; la grille des temps du morceau ;
//   chorus         les trois lignes de retard modulées (odio/effects/chorus.js :
//                  11, 17 et 23 ms, ± profondeur × 6 ms), leur place dans
//                  l'image stéréo.
// Les poignées : T (la durée, la fin de la queue), P (le pré-délai), M (le
// mélange, à la verticale) ; 1 (le temps, à l'horizontale ; le mélange, à la
// verticale), 2 (le retour, à la verticale) ; Maj : fin ; double-clic : défaut.

import { el } from '../ui.js';
import { DELAY_DIVS } from '../modules.js';
import { reverb, bruit, reponse, fVersN, nVersF, coefs, module as mod } from './calcul.js';
import { ecran, s, trait, etiquette, poignee, gestes, liaison, trace, choixLie, plusProche, AIDE } from './surface.js';

const W = 380, H = 130, BASE = H - 14, HAUTEUR = BASE - 18;
const cosM = (v) => Math.cos(v * Math.PI / 2), sinM = (v) => Math.sin(v * Math.PI / 2);
const ms = (t) => (t < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(2)} s`);
// un pas de grille lisible pour une durée totale
const pasDe = (T) => [0.05, 0.1, 0.25, 0.5, 1, 2].find((p) => T / p <= 8) || 2;

export const EST_ESPACE = (type) => ['reverb', 'reverbe', 'delay', 'rtt', 'chorus'].includes(type);
export function espace(app, m, opts) {
  if (m.type === 'reverb' || m.type === 'reverbe') return reverbe(app, m, opts);
  if (m.type === 'delay' || m.type === 'rtt') return delai(app, m, opts);
  return chorus(app, m, opts);
}

// grille de temps commune
function grilleTemps(g, T, xDe) {
  const p = pasDe(T);
  for (let t = p; t < T - 1e-6; t += p) { g.append(trait(xDe(t), 0, xDe(t), BASE)); g.append(etiquette(xDe(t) + 3, H - 3, ms(t))); }
  g.append(trait(0, BASE, W, BASE, 'zero'));
}

// ── la réverbération ────────────────────────────────────────
function reverbe(app, m, { accent = 'cy' } = {}) {
  const odio = m.type === 'reverbe';
  const K = odio ? { mix: ['mix', 100], damp: 'damp', ks: ['size', 'decay', 'damp', 'mix'] } : { mix: ['mix', 1], damp: 'damp', ks: ['time', 'pre', 'damp', 'mix'] };
  const L = liaison(app, m, () => peindre());
  const fs = () => app.engine.ctx?.sampleRate || 48000;
  const r = () => reverb(m.type, odio ? { size: L.get('size'), decay: L.get('decay') } : { time: L.get('time'), pre: L.get('pre') });
  const mix = () => L.get(K.mix[0]) / K.mix[1];
  const E = ecran(W, H, 'ap-rvb');
  let T = 1, xDe = (t) => (t / T) * W;
  const bars = s('path', { class: 'ap-ir' }), env = s('path', { class: 'ap-courbe' }), sec = s('path', { class: 'ap-sec' });
  const fin = s('line', { class: 'ap-seuil', y1: 14, y2: BASE }), pre = s('path', { class: 'ap-pre' });
  E.c.courbes.append(bars, env, sec, fin, pre);
  // l'amorti : le passe-bas du moteur, en médaillon en haut à droite
  const MW = 112, MH = 40, MX = W - MW - 6, MY = 18;
  const med = s('g', { class: 'ap-med' });
  med.append(s('rect', { class: 'ap-med-f', x: MX, y: MY, width: MW, height: MH, rx: 4 }));
  const medC = s('path', { class: 'ap-courbe ap-fin' });
  med.append(medC, etiquette(MX + 4, MY + MH - 4, 'AMORTI'));
  E.c.courbes.append(med);
  const pT = poignee('T', 'T'), pP = poignee('P', 'P'), pM = poignee('M', 'M'), pA = poignee('A', 'A');
  E.c.points.append(pT, ...(odio ? [] : [pP]), pM, pA);
  const lecture = s('text', { class: 'ap-lecture', x: 6, y: 11 });
  E.c.texte.append(lecture);
  const N = bruit(W, 11);

  function peindre() {
    const R = r(), wet = sinM(mix()), dry = cosM(mix());
    const total = R.queue * 1.15;
    T = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 10].find((x) => x >= total) || 10;
    xDe = (t) => (t / T) * W;
    E.c.grille.replaceChildren();
    grilleTemps(E.c.grille, T, xDe);
    // la réponse : une barre par pixel, bruit × enveloppe, au niveau traité
    let d = '', e = [];
    for (let x = 1; x < W; x++) {
      const t = (x / W) * T, a = R.niveau(t) * wet, hgt = a * Math.abs(N[x]) * HAUTEUR;
      if (hgt > 0.3) d += `M${x}.5 ${BASE} V${(BASE - hgt).toFixed(1)} `;
      e.push([x, BASE - a * HAUTEUR]);
    }
    bars.setAttribute('d', d);
    env.setAttribute('d', trace(e));
    sec.setAttribute('d', `M1.5 ${BASE} V${(BASE - dry * HAUTEUR).toFixed(1)}`);
    fin.setAttribute('x1', xDe(R.queue)); fin.setAttribute('x2', xDe(R.queue));
    pre.setAttribute('d', R.pre > 0.0005 ? `M1 ${BASE + 4} H${xDe(R.pre).toFixed(1)}` : '');
    pT.poser(xDe(R.queue), BASE - 6);
    pP.poser(Math.max(8, xDe(R.pre)), BASE - 6);
    pM.poser(Math.max(10, xDe(R.pre) + 10), BASE - R.niveau(R.pre + 1e-4) * wet * HAUTEUR);
    // le médaillon : la réponse du passe-bas d'amorti (Q par défaut du nœud : 1)
    const n = 60, rr = reponse([{ type: 'lowpass', f: Math.min(L.get(K.damp), fs() * 0.45), q: 1 }], n, fs());
    const yM = (db) => MY + 6 + Math.min(MH - 8, Math.max(0, (-db / 24) * (MH - 8)));
    medC.setAttribute('d', trace(Array.from(rr, (db, i) => [MX + (i / (n - 1)) * MW, yM(db)])));
    pA.poser(MX + fVersN(L.get(K.damp)) * MW, yM(-3));
    lecture.textContent = odio
      ? `QUEUE ${ms(R.queue)}   PRÉ ${ms(R.pre)}   AMORTI ${L.texte(K.damp)}   MIX ${L.texte('mix')}`
      : `−60 dB EN ${ms(L.get('time'))}   PRÉ ${ms(R.pre)}   AMORTI ${L.texte(K.damp)}   MIX ${Math.round(mix() * 100)}`;
  }

  const prises = () => [['T', pT], ...(odio ? [] : [['P', pP]]), ['M', pM], ['A', pA]];
  let v0 = 0;
  gestes(E, {
    trouver: (p) => { const id = plusProche(p, prises()); return id ? { id, curseur: id === 'M' ? 'ns-resize' : 'ew-resize' } : null; },
    survol: (c) => { for (const [id, q] of prises()) q.classList.toggle('survol', c?.id === id); },
    debut: ({ id }) => {
      v0 = id === 'T' ? (odio ? L.get('decay') : L.get('time')) : id === 'P' ? L.get('pre') : id === 'M' ? L.get(K.mix[0]) : fVersN(L.get(K.damp));
      for (const [i, q] of prises()) q.classList.toggle('on', i === id);
    },
    tire: ({ id }, d) => {
      if (id === 'T') {
        const k = odio ? 0.3 + L.get('size') / 100 : 1;   // la queue d'ODIO vaut decay × (0,3 + taille)
        v0 += (d.dx / W) * T / k; L.pose(odio ? 'decay' : 'time', v0);
      } else if (id === 'P') { v0 += (d.dx / W) * T; L.pose('pre', v0); }
      else if (id === 'M') { v0 -= (d.dy / HAUTEUR) * K.mix[1]; L.pose(K.mix[0], v0); }
      else { v0 += d.dx / MW; L.pose(K.damp, nVersF(v0)); }
    },
    fin: () => { for (const [, q] of prises()) q.classList.remove('on'); L.fin(); },
    double: ({ id }) => {
      const k = id === 'T' ? (odio ? 'decay' : 'time') : id === 'P' ? 'pre' : id === 'M' ? K.mix[0] : K.damp;
      L.pose(k, L.defaut(k)); L.fin();
    },
  });
  E.box.title = `T : la durée · ${odio ? '' : 'P : le pré-délai · '}M : le mélange · A : l'amorti · ${AIDE}`;
  peindre();
  const root = el('div', { class: 'ap ap-rvbx', style: { width: `${W}px` } }, E.box,
    el('div', { class: 'ap-reglages' }, el('div', { class: 'ap-kns' }, K.ks.map((k, i) => L.molette(k, { accent: i < 2 ? accent : 'cy' })))));
  return { el: root, peindre };
}

// ── le délai ────────────────────────────────────────────────
function delai(app, m, { accent = 'cy' } = {}) {
  const odio = m.type === 'rtt';
  const L = liaison(app, m, () => peindre());
  const fs = () => app.engine.ctx?.sampleRate || 48000;
  const bpm = () => app.S.proj.bpm || 120;
  // le temps d'un écho (s) ; le niveau du traité et du sec ; le retour ; le ton
  const temps = () => (odio ? L.get('time') / 1000 : Math.min(4, DELAY_DIVS[L.get('div')] * 60 / bpm()));
  const wet = () => (odio ? sinM(L.get('mix') / 100) : L.get('mix'));
  const dry = () => (odio ? cosM(L.get('mix') / 100) : L.get('dry') ? 0 : 1);
  const fb = () => (odio ? L.get('fdb') / 100 : L.get('fb'));
  const E = ecran(W, H, 'ap-dly');
  let T = 2, xDe = (t) => (t / T) * W;
  const echos = s('g', { class: 'ap-echos' }), sec = s('path', { class: 'ap-sec' }), lien = s('path', { class: 'ap-courbe-env' });
  E.c.courbes.append(lien, sec, echos);
  const p1 = poignee('1', '1'), p2 = poignee('2', '2');
  E.c.points.append(p1, p2);
  const lecture = s('text', { class: 'ap-lecture', x: 6, y: 11 });
  E.c.texte.append(lecture);

  function peindre() {
    const dt = temps(), w0 = wet(), g = fb();
    T = Math.max(1, Math.min(8, dt * 7.2));
    xDe = (t) => 4 + (t / T) * (W - 10);
    // la grille : les temps du morceau (une noire), et les mesures plus franches
    const G = E.c.grille;
    G.replaceChildren();
    const noire = 60 / bpm(), sig = app.S.proj.sig || 4;
    const pas = noire * (T / noire > 24 ? sig : 1);
    for (let t = pas; t < T; t += pas) {
      const fort = Math.abs((t / noire) % sig) < 1e-6 || Math.abs((t / noire) % sig - sig) < 1e-6;
      G.append(trait(xDe(t), 14, xDe(t), BASE, fort ? 'fort' : ''));
      // mesure.temps, comptés depuis le coup sec (1.1)
      const b = Math.round(t / noire);
      if (fort || T / noire <= 8) G.append(etiquette(xDe(t) + 3, H - 3, `${Math.floor(b / sig) + 1}.${(b % sig) + 1}`));
    }
    G.append(trait(0, BASE, W, BASE, 'zero'));
    // le filtre de la boucle à 3 kHz : ce qu'un écho garde de brillance, passage après passage
    const lp = mod(coefs('lowpass', Math.min(L.get('tone'), fs() * 0.45), 0, 0, fs()), 3000, fs());
    echos.replaceChildren();
    const sommets = [];
    let lvl = w0;
    for (let n = 1; n < 64; n++) {
      const t = n * dt;
      if (t > T || lvl < 0.004) break;
      const passes = odio ? n : n - 1;
      const brille = Math.pow(lp, passes), x = xDe(t), y = BASE - lvl * HAUTEUR;
      echos.append(s('rect', { class: 'ap-echo', x: x - 2, y, width: 4, height: Math.max(0.5, BASE - y), rx: 1.5, style: `fill-opacity:${(0.3 + 0.7 * Math.min(1, brille)).toFixed(2)}` }));
      sommets.push([x, y]);
      lvl *= g;
    }
    lien.setAttribute('d', sommets.length > 1 ? trace(sommets) : '');
    sec.setAttribute('d', `M${xDe(0)} ${BASE} V${(BASE - dry() * HAUTEUR).toFixed(1)}`);
    p1.poser(xDe(dt), Math.max(16, BASE - w0 * HAUTEUR));
    p2.poser(xDe(2 * dt), Math.max(16, BASE - w0 * g * HAUTEUR));
    p2.style.display = 2 * dt > T ? 'none' : '';
    const quoi = odio ? `${Math.round(dt * 1000)} ms` : `${L.texte('div')} · ${Math.round(dt * 1000)} ms`;
    lecture.textContent = `${quoi}   RETOUR ${Math.round(g * 100)} %   TON ${L.texte('tone')}   MIX ${Math.round((odio ? L.get('mix') / 100 : L.get('mix')) * 100)}`;
  }

  let vx = 0, vy = 0;
  gestes(E, {
    trouver: (p) => { const id = plusProche(p, [['1', p1], ['2', p2]]); return id ? { id, curseur: id === '1' ? 'move' : 'ns-resize' } : null; },
    survol: (c) => { p1.classList.toggle('survol', c?.id === '1'); p2.classList.toggle('survol', c?.id === '2'); },
    debut: ({ id }) => {
      vx = temps(); vy = id === '1' ? (odio ? L.get('mix') : L.get('mix')) : (odio ? L.get('fdb') : L.get('fb'));
      p1.classList.toggle('on', id === '1'); p2.classList.toggle('on', id === '2');
    },
    tire: ({ id }, d) => {
      if (id === '1') {
        vx += (d.dx / (W - 10)) * T;
        if (odio) L.pose('time', vx * 1000, true);
        else {
          // le délai du studio se cale sur les valeurs de note : la plus proche
          const b = vx * bpm() / 60;
          let best = 0;
          DELAY_DIVS.forEach((v, i) => { if (Math.abs(v - b) < Math.abs(DELAY_DIVS[best] - b)) best = i; });
          L.pose('div', best, true);
        }
        // la hauteur du premier écho : le mélange (la loi du module : sinus pour ODIO, linéaire ici)
        vy -= (d.dy / HAUTEUR) * (odio ? 100 : 1);
        L.pose('mix', vy, true);
      } else {
        vy -= (d.dy / HAUTEUR) * (odio ? 100 : 1) / Math.max(0.05, wet());
        L.pose(odio ? 'fdb' : 'fb', vy, true);
      }
      peindre();
    },
    fin: () => { p1.classList.remove('on'); p2.classList.remove('on'); L.fin(); },
    double: ({ id }) => {
      if (id === '1') { L.pose(odio ? 'time' : 'div', L.defaut(odio ? 'time' : 'div'), true); L.pose('mix', L.defaut('mix'), true); } else L.pose(odio ? 'fdb' : 'fb', L.defaut(odio ? 'fdb' : 'fb'), true);
      peindre(); L.fin();
    },
  });
  E.box.title = `1 : le temps (horizontal) et le mélange (vertical) · 2 : le retour · ${AIDE}`;
  peindre();
  // le temps du délai du studio : une molette à crans (ses six valeurs de note) ; le son sec : un choix
  const ks = odio ? ['time', 'fdb', 'tone', 'mix'] : ['div', 'fb', 'tone', 'mix'];
  const root = el('div', { class: 'ap ap-dlyx', style: { width: `${W}px` } }, E.box,
    el('div', { class: 'ap-reglages' }, el('div', { class: 'ap-kns' }, ks.map((k, i) => L.molette(k, { accent: i < 2 ? accent : 'cy' }))),
      odio ? null : choixLie(L, 'dry')));
  return { el: root, peindre };
}

// ── le chorus ───────────────────────────────────────────────
// odio/effects/chorus.js : BASE_DELAY 11, 17, 23 ms ; MAX_SWING 6 ms ; les
// oscillateurs partent à index/3 × 0,37 s d'écart (leur déphasage)
function chorus(app, m, { accent = 'cy' } = {}) {
  const L = liaison(app, m, () => peindre());
  const CW = 340, CH = 120, D0 = [0.011, 0.017, 0.023], SW = 0.006, T = 2;
  const E = ecran(CW, CH, 'ap-chr');
  const yDe = (sec) => 12 + ((0.031 - sec) / 0.026) * (CH - 26), xDe = (t) => (t / T) * (CW - 40);
  {
    const g = E.c.grille;
    for (const d of D0) g.append(trait(0, yDe(d), CW - 40, yDe(d)));
    for (const t of [0.5, 1, 1.5]) { g.append(trait(xDe(t), 12, xDe(t), CH - 14)); g.append(etiquette(xDe(t) + 3, CH - 3, ms(t))); }
    g.append(trait(CW - 36, 12, CW - 36, CH - 14));
    g.append(etiquette(CW - 18, CH - 3, 'G · D', '', 'middle'));
  }
  const voix = D0.map(() => s('path', { class: 'ap-courbe' }));
  const places = D0.map(() => s('circle', { class: 'ap-place', r: 3.5 }));
  E.c.courbes.append(...voix, ...places);
  const pt = poignee('V', '');
  E.c.points.append(pt);
  const lecture = s('text', { class: 'ap-lecture', x: 6, y: 9 });
  E.c.texte.append(lecture);
  function peindre() {
    const rate = L.get('rate'), depth = L.get('depth') / 100, spread = L.get('spread') / 100;
    D0.forEach((d0, i) => {
      const off = (i / 3) * 0.37, pts = [];
      for (let k = 0; k <= 160; k++) { const t = (k / 160) * T; pts.push([xDe(t), yDe(d0 + depth * SW * Math.sin(2 * Math.PI * rate * (t - off)))]); }
      voix[i].setAttribute('d', trace(pts));
      voix[i].style.strokeOpacity = i === 1 ? 1 : 0.55;
      places[i].setAttribute('cx', CW - 18 + [-1, 0, 1][i] * spread * 14);
      places[i].setAttribute('cy', yDe(d0));
    });
    pt.poser(xDe(Math.min(T, 0.25 / rate)), yDe(D0[0] + depth * SW));
    lecture.textContent = `RETARDS 11 · 17 · 23 ms   ±${(depth * 6).toFixed(1)} ms À ${L.texte('rate')}   LARGEUR ${Math.round(spread * 100)}`;
  }
  let lr = 0, dp = 0;
  gestes(E, {
    trouver: (p) => (Math.hypot(pt.px - p.x, pt.py - p.y) < 13 ? { id: 'V', curseur: 'move' } : null),
    survol: (c) => pt.classList.toggle('survol', !!c),
    debut: () => { lr = Math.log(L.get('rate')); dp = L.get('depth'); pt.classList.add('on'); },
    // la crête de la première voix : à gauche, plus vite (sa période raccourcit) ; en haut, plus profond
    tire: (c, d) => { lr -= d.dx * 0.01; dp -= d.dy * 0.8; L.pose('rate', Math.exp(lr), true); L.pose('depth', dp, true); peindre(); },
    fin: () => { pt.classList.remove('on'); L.fin(); },
    double: () => { L.pose('rate', L.defaut('rate'), true); L.pose('depth', L.defaut('depth')); L.fin(); },
  });
  E.box.title = `le point : la vitesse (horizontal) et la profondeur (vertical) · ${AIDE}`;
  peindre();
  const root = el('div', { class: 'ap ap-chrx', style: { width: `${CW}px` } }, E.box,
    el('div', { class: 'ap-reglages' }, el('div', { class: 'ap-kns' }, ['rate', 'depth', 'spread', 'mix'].map((k, i) => L.molette(k, { accent: i < 2 ? accent : 'cy' })))));
  return { el: root, peindre };
}

