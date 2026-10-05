// ODIO — le compresseur de la vue Instruments (Compresseur, Comp d'ODIO).
//
// La référence : Pro-C de FabFilter (l'historique des niveaux et de la
// réduction sur la même échelle que la courbe de transfert, à droite) et
// le Compressor de Live 12 (sa vue « Transfer Curve », le mètre GR) —
// docs/etudes/odio_appareils.md § 3.2. Un seul écran :
//   à gauche   l'historique (3,5 s, de droite à gauche) : le niveau qui
//              entre (aplat), celui qui sort (trait), la réduction de gain
//              tombant du haut, le seuil en travers ;
//   à droite   la courbe de transfert du DynamicsCompressorNode : ce que la
//              détection fait d'une crête (calcul.js, compresseur : le genou
//              de Chromium commence au seuil), le point vivant posé dessus ;
//   au bout    le mètre de réduction de gain (DynamicsCompressorNode.reduction).
// Ce qui se tire : S (le seuil, à l'horizontale ; Alt, molette : le genou
// quand le module en a un), T (le taux, à la verticale, au bout de la
// courbe). Le gain de rattrapage automatique que le nœud ajoute (spécification
// Web Audio, « Computing the makeup gain » : (1 / courbe(0 dB))^0,6) est lu
// à part, avec le gain du module.

import { el } from '../ui.js';
import { compresseur, linVersDb } from './calcul.js';
import { ecran, s, trait, etiquette, poignee, gestes, liaison, trace, plusProche, AIDE } from './surface.js';
import { COMP_KNEE } from '../odio/effects/comp.js';

// les clés de chaque module ; `genou` absent : le genou est fixe (comp.js : COMP_KNEE)
const CLES = {
  comp: { seuil: 'thr', taux: 'ratio', genou: 'knee', att: 'att', rel: 'rel', gain: 'gain' },
  comp3: { seuil: 'threshold', taux: 'ratio', att: 'attack', rel: 'release', gain: 'makeup' },
};
export const EST_COMPRESSEUR = (type) => !!CLES[type];

const H = 150, HIST = 214, GAP = 8, TF = H, MET = 12;
const W = HIST + GAP + TF + GAP + MET;
const X0 = HIST + GAP;                       // le carré de transfert
const DB_MIN = -60, DB_MAX = 6, SPAN = DB_MAX - DB_MIN;
const yDe = (db) => H - ((Math.max(DB_MIN - 6, Math.min(DB_MAX + 6, db)) - DB_MIN) / SPAN) * H;
const xDe = (db) => X0 + ((db - DB_MIN) / SPAN) * TF;
const GR_MAX = 24;                           // le mètre : 0 à −24 dB

export function dynamique(app, m, { accent = 'cy' } = {}) {
  const K = CLES[m.type];
  const L = liaison(app, m, () => peindre());
  const genou = () => (K.genou ? L.get(K.genou) : COMP_KNEE);
  let loi = null;

  const E = ecran(W, H, 'ap-comp');
  {
    const g = E.c.grille;
    for (const db of [-48, -36, -24, -12, 0]) {
      g.append(trait(0, yDe(db), HIST, yDe(db), db === 0 ? 'zero' : ''));
      g.append(trait(X0, yDe(db), X0 + TF, yDe(db), db === 0 ? 'zero' : ''));
      g.append(trait(xDe(db), 0, xDe(db), H, db === 0 ? 'zero' : ''));
    }
    for (const db of [0, -24, -48]) g.append(etiquette(HIST - 3, yDe(db) - 3, db ? `−${-db}` : '0 dB', '', 'end'));
    g.append(s('rect', { class: 'ap-cadre', x: X0 + 0.5, y: 0.5, width: TF - 1, height: H - 1 }));
    g.append(s('line', { class: 'ap-diag', x1: xDe(DB_MIN), y1: yDe(DB_MIN), x2: xDe(DB_MAX), y2: yDe(DB_MAX) }));
    g.append(etiquette(X0 + TF - 4, H - 4, 'ENTRÉE →', '', 'end'));
    g.append(etiquette(X0 + 4, 11, '↑ SORTIE'));
    g.append(trait(W - MET, 0, W - MET, H, ''));
  }
  // l'historique
  const hIn = s('path', { class: 'ap-niv' }), hOut = s('path', { class: 'ap-niv-sortie' }), hGr = s('path', { class: 'ap-gr' });
  const seuilH = s('line', { class: 'ap-seuil', x1: 0, x2: HIST });
  E.c.spectre.append(hIn, hOut, hGr, seuilH);
  // le transfert
  const genouZ = s('rect', { class: 'ap-genou', y: 0, height: H });
  const seuilV = s('line', { class: 'ap-seuil', y1: 0, y2: H });
  const courbe = s('path', { class: 'ap-courbe' });
  const vivant = s('circle', { class: 'ap-vivant', r: 3.5, cx: -10, cy: -10 });
  const metre = s('rect', { class: 'ap-gr-m', x: W - MET + 2, y: 0, width: MET - 4, height: 0 });
  E.c.courbes.append(genouZ, seuilV, courbe, metre, vivant);
  const pS = poignee('S', 'S'), pT = poignee('T', 'T');
  E.c.points.append(pS, pT);
  const lecture = s('text', { class: 'ap-lecture', x: 6, y: 11 });
  const rattrapage = el('span', { class: 'ap-note' });
  const grTxt = s('text', { class: 'ap-et ap-gr-t', x: W - MET - 5, y: 24, 'text-anchor': 'end' }, '');
  E.c.texte.append(lecture, grTxt);

  function peindre() {
    const thr = L.get(K.seuil), r = L.get(K.taux), kn = genou();
    loi = compresseur(thr, kn, r);
    const xy = [];
    for (let i = 0; i <= 132; i++) { const e = DB_MIN + (i / 132) * SPAN; xy.push([xDe(e), yDe(e + loi.reduction(e))]); }
    courbe.setAttribute('d', trace(xy));
    genouZ.setAttribute('x', xDe(thr)); genouZ.setAttribute('width', Math.max(0, xDe(Math.min(DB_MAX, thr + kn)) - xDe(thr)));
    seuilV.setAttribute('x1', xDe(thr)); seuilV.setAttribute('x2', xDe(thr));
    seuilH.setAttribute('y1', yDe(thr)); seuilH.setAttribute('y2', yDe(thr));
    pS.poser(xDe(thr), H - 9);   // le seuil se tire sur l'axe des entrées, sous sa ligne
    const eT = DB_MAX - 4;   // la poignée du taux : au bout de la courbe, posée dessus
    pT.poser(xDe(eT), yDe(eT + loi.reduction(eT)));
    lecture.textContent = `SEUIL ${L.texte(K.seuil)}   ${L.texte(K.taux)}`;
    // ce que le nœud ajoute de lui-même, et le gain du module : la sortie au-dessus de la courbe
    const gain = L.get(K.gain);
    rattrapage.textContent = `genou ${kn.toFixed(0)} dB${K.genou ? '' : ' (fixe)'} · rattrapage automatique ${fmtDb(loi.rattrapage)} dB${gain ? ` · gain ${fmtDb(gain)} dB` : ''}`;
  }
  const fmtDb = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;

  let x0 = 0;
  gestes(E, {
    trouver: (p) => { const id = plusProche(p, [['S', pS], ['T', pT]], 13); return id ? { id, curseur: id === 'S' ? 'ew-resize' : 'ns-resize' } : null; },
    survol: (c) => { pS.classList.toggle('survol', c?.id === 'S'); pT.classList.toggle('survol', c?.id === 'T'); },
    debut: ({ id }) => { x0 = id === 'S' ? L.get(K.seuil) : Math.log(L.get(K.taux)); pS.classList.toggle('on', id === 'S'); pT.classList.toggle('on', id === 'T'); },
    tire: ({ id }, d, p, e) => {
      if (id === 'S' && e.altKey && K.genou) { L.pose(K.genou, L.get(K.genou) - d.dy * 0.25); return; }
      if (id === 'S') { x0 += d.dx * (SPAN / TF); L.pose(K.seuil, x0); return; }
      // le taux : monter la poignée relâche la compression (la pente remonte vers 1:1)
      x0 += d.dy * 0.02;
      L.pose(K.taux, Math.exp(x0));
    },
    fin: () => { pS.classList.remove('on'); pT.classList.remove('on'); L.fin(); },
    molette: ({ id }, sens, e) => {
      if (id === 'S' && K.genou) L.pose(K.genou, L.get(K.genou) + sens * (e.shiftKey ? 0.5 : 2));
      else if (id === 'T') L.pose(K.taux, L.get(K.taux) * Math.pow(e.shiftKey ? 1.02 : 1.1, -sens));
      else return;
      clearTimeout(molT); molT = setTimeout(() => L.fin(), 300);
    },
    double: ({ id }) => {
      if (id === 'S') { L.pose(K.seuil, L.defaut(K.seuil)); if (K.genou) L.pose(K.genou, L.defaut(K.genou)); } else L.pose(K.taux, L.defaut(K.taux));
      L.fin();
    },
    clavier: (touche, e) => {
      const f = e.shiftKey ? 0.2 : 1;
      if (touche === 'ArrowLeft' || touche === 'ArrowRight') L.pose(K.seuil, L.get(K.seuil) + (touche === 'ArrowRight' ? 1 : -1) * f);
      else L.pose(K.taux, L.get(K.taux) * Math.pow(1.05, (touche === 'ArrowUp' ? -1 : 1) * f));
      clearTimeout(molT); molT = setTimeout(() => L.fin(), 300);
    },
  });
  let molT = null;

  const ks = [K.seuil, K.taux, K.genou, K.att, K.rel, K.gain].filter(Boolean);
  const aide = `S : le seuil${K.genou ? ' (Alt, molette : le genou)' : ''} · T : le taux · ${AIDE}`;
  E.box.title = aide;
  const root = el('div', { class: 'ap ap-compx', style: { width: `${W}px` } }, E.box,
    el('div', { class: 'ap-pied' }, rattrapage),
    el('div', { class: 'ap-reglages' }, el('div', { class: 'ap-kns' }, ks.map((k, i) => L.molette(k, { accent: i < 3 ? accent : 'cy' })))));
  peindre();

  // ── l'historique et le mètre, à chaque image ──
  const nIn = new Float32Array(HIST).fill(-200), nOut = new Float32Array(HIST).fill(-200), nGr = new Float32Array(HIST).fill(0);
  let aIn = null, aOut = null, buf = null, calme = HIST, avant = 0;
  const PAS = 3500 / HIST;   // l'historique couvre 3,5 s, quelle que soit la cadence des images
  const crete = (a) => { a.getFloatTimeDomainData(buf); let p = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v; } return linVersDb(p); };
  function frame() {
    if (!aIn) {
      aIn = app.engine.sonde?.(m.id, 'in', 2048); aOut = app.engine.sonde?.(m.id, 'out', 2048);
      if (!aIn || !aOut) { aIn = null; return; }
      buf = new Float32Array(2048);
    }
    const ei = crete(aIn), eo = crete(aOut), gr = Math.min(0, app.engine.reduction(m.id) || 0);
    calme = ei < -90 && gr > -0.05 ? calme + 1 : 0;
    if (calme > HIST + 2) return;   // rien n'entre depuis que l'historique est vide : on ne redessine plus
    const now = performance.now(), n = Math.max(1, Math.min(HIST, Math.round((now - avant) / PAS)));
    avant = now;
    for (const [arr, v] of [[nIn, ei], [nOut, eo], [nGr, gr]]) { arr.copyWithin(0, n); arr.fill(v, HIST - n); }
    const bas = (arr) => `M0 ${H} L${trace(Array.from(arr, (v, i) => [i, yDe(v)])).slice(1)} L${HIST - 1} ${H} Z`;
    hIn.setAttribute('d', bas(nIn));
    hOut.setAttribute('d', trace(Array.from(nOut, (v, i) => [i, yDe(v)])));
    // la réduction tombe du haut, à la même échelle (un dB vaut la même hauteur que pour les niveaux)
    const ppd = H / SPAN;
    hGr.setAttribute('d', `M0 0 L${trace(Array.from(nGr, (v, i) => [i, -v * ppd])).slice(1)} L${HIST - 1} 0 Z`);
    metre.setAttribute('height', Math.min(H, (-gr / GR_MAX) * H).toFixed(1));
    grTxt.textContent = gr < -0.05 ? `RG −${(-gr).toFixed(1)} dB` : '';
    // le point vivant : la crête qui entre, posée sur la courbe
    if (ei > DB_MIN && loi) { vivant.setAttribute('cx', xDe(Math.min(DB_MAX, ei)).toFixed(1)); vivant.setAttribute('cy', yDe(ei + loi.reduction(ei)).toFixed(1)); } else { vivant.setAttribute('cx', -10); }
  }

  return { el: root, frame, peindre };
}
