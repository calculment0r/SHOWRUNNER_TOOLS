// ODIO — les saturations de la vue Instruments : Distorsion, Satura, Crush.
//
// La référence : Saturator de Live 12 (la courbe de mise en forme, avec le
// signal posé dessus) — docs/etudes/odio_appareils.md § 3.4. Un écran :
//   à gauche   la courbe de transfert, celle que le WaveShaperNode reçoit
//              (calcul.js, transfert : la table même), la diagonale du son
//              intact en pointillé ; la part de la courbe que le signal
//              parcourt maintenant, soulignée (la crête qui entre) ;
//   à droite   ce qu'elle fait d'un sinus : l'entrée en pointillé, la
//              sortie (le mélange sec / traité et le gain de sortie compris)
//              — à la crête qui entre quand le son joue, à pleine échelle sinon.
// Le point de la courbe se tire : à la verticale la saturation (Crush : la
// résolution), à l'horizontale le décalage (Satura : bias) ou la poussée
// (Crush : drive) ; Maj : fin ; double-clic : défaut.

import { el } from '../ui.js';
import { transfert, dbVersLin, linVersDb } from './calcul.js';
import { ecran, s, trait, etiquette, poignee, gestes, liaison, trace, AIDE } from './surface.js';

// mix : sa clé et sa course (0..1 ou 0..100) ; x / y : ce que le point tire, et de combien par pixel
const SATS = {
  dist: { r: (L) => ({ drive: L.get('drive') }), mix: ['mix', 1], out: 'out', y: ['drive', 0.6], ks: ['drive', 'tone', 'mix', 'out'], nom: 'DISTORSION' },
  satura: { r: (L) => ({ drive: L.get('drive'), bias: L.get('bias') }), mix: ['mix', 100], y: ['drive', 0.6], x: ['bias', 0.5], ks: ['drive', 'bias', 'tone', 'mix'], nom: 'SATURATION' },
  crush: { r: (L) => ({ bits: L.get('bits'), drive: L.get('drive') }), mix: ['mix', 100], y: ['bits', -0.1], x: ['drive', 0.6], ks: ['bits', 'drive', 'tone', 'mix'], nom: 'RÉSOLUTION' },
};
export const EST_SATURATION = (type) => !!SATS[type];

const H = 140, TF = H, GAP = 8, WV = 236, W = TF + GAP + WV;
const XA = 0.5;                         // le point se pose sur la courbe en x = 0,5

export function saturation(app, m, { accent = 'cy' } = {}) {
  const D = SATS[m.type];
  const L = liaison(app, m, () => peindre());
  let crete = 1, vive = false;          // la crête qui entre (linéaire), et si le son joue

  const E = ecran(W, H, 'ap-sat');
  const xT = (v) => ((v + 1) / 2) * TF, yT = (v) => H / 2 - v * (H / 2 - 6);
  const X1 = TF + GAP, yW = (v) => H / 2 - v * (H / 2 - 12);
  {
    const g = E.c.grille;
    for (const v of [-0.5, 0.5]) { g.append(trait(xT(v), 0, xT(v), H)); g.append(trait(0, yT(v), TF, yT(v))); }
    g.append(trait(xT(0), 0, xT(0), H, 'zero')); g.append(trait(0, yT(0), TF, yT(0), 'zero'));
    g.append(s('line', { class: 'ap-diag', x1: xT(-1), y1: yT(-1), x2: xT(1), y2: yT(1) }));
    g.append(trait(TF + GAP / 2, 0, TF + GAP / 2, H));
    g.append(trait(X1, yW(0), W, yW(0), 'zero'));
    for (const v of [1, -1]) g.append(trait(X1, yW(v), W, yW(v)));
    g.append(etiquette(4, H - 4, 'ENTRÉE →'));
    g.append(etiquette(W - 4, H - 4, 'UN SINUS : ENTRÉE ┄ SORTIE ─', '', 'end'));
  }
  const courbe = s('path', { class: 'ap-courbe' }), part = s('path', { class: 'ap-part' });
  const sinIn = s('path', { class: 'ap-sin' }), sinOut = s('path', { class: 'ap-courbe' });
  E.c.courbes.append(part, courbe, sinIn, sinOut);   // la part parcourue : un halo sous la courbe
  const pt = poignee('D', '');
  E.c.points.append(pt);
  const lecture = s('text', { class: 'ap-lecture', x: 6, y: 11 });
  const lectureW = s('text', { class: 'ap-lecture', x: X1 + 6, y: 11 });
  E.c.texte.append(lecture, lectureW);
  lecture.textContent = D.nom;

  function peindre() {
    const f = transfert(m.type, D.r(L));
    const n = m.type === 'crush' ? 600 : 160;
    const pts = [];
    for (let i = 0; i <= n; i++) { const x = -1 + (2 * i) / n; pts.push([xT(x), yT(f(x))]); }
    courbe.setAttribute('d', trace(pts));
    // la part parcourue par le signal : [−crête, +crête]
    if (vive) {
      const a = Math.min(1, crete), pp = [];
      for (let i = 0; i <= 80; i++) { const x = -a + (2 * a * i) / 80; pp.push([xT(x), yT(f(x))]); }
      part.setAttribute('d', trace(pp));
    } else part.setAttribute('d', '');
    pt.poser(xT(XA), yT(f(XA)));
    // le sinus : deux périodes, à la crête qui entre (ou à pleine échelle)
    const A = vive ? Math.min(1, crete) : 1;
    const mix = L.get(D.mix[0]) / D.mix[1], sec = Math.cos(mix * Math.PI / 2), tr = Math.sin(mix * Math.PI / 2);
    const post = D.out ? dbVersLin(L.get(D.out)) : 1;
    const si = [], so = [];
    for (let i = 0; i <= 200; i++) {
      const ph = (i / 200) * 4 * Math.PI, x = A * Math.sin(ph), X = X1 + (i / 200) * WV;
      si.push([X, yW(x)]);
      so.push([X, Math.max(-2, Math.min(H + 2, yW((sec * x + tr * f(x)) * post)))]);
    }
    sinIn.setAttribute('d', trace(si)); sinOut.setAttribute('d', trace(so));
    let pk = 0;
    for (const [, y] of so) pk = Math.max(pk, Math.abs((H / 2 - y) / (H / 2 - 12)));
    const dbTxt = (v) => (v < 1e-5 ? '−∞' : linVersDb(v).toFixed(1).replace('-', '−'));
    lectureW.textContent = `${vive ? dbTxt(crete) : '0.0'} → ${dbTxt(pk)} dB CRÊTE`;
  }

  let ax = 0, ay = 0;
  gestes(E, {
    trouver: (p) => (Math.hypot(pt.px - p.x, pt.py - p.y) < 14 ? { id: 'D', curseur: D.x ? 'move' : 'ns-resize' } : null),
    survol: (c) => pt.classList.toggle('survol', !!c),
    debut: () => { ay = L.get(D.y[0]); ax = D.x ? L.get(D.x[0]) : 0; pt.classList.add('on'); },
    tire: (c, d) => {
      const sy = L.sp(D.y[0]);
      ay = Math.max(sy.min, Math.min(sy.max, ay - d.dy * D.y[1]));
      L.pose(D.y[0], ay, true);
      if (D.x) { const sx = L.sp(D.x[0]); ax = Math.max(sx.min, Math.min(sx.max, ax + d.dx * D.x[1])); L.pose(D.x[0], ax, true); }
      peindre();
    },
    fin: () => { pt.classList.remove('on'); L.fin(); },
    double: () => { L.pose(D.y[0], L.defaut(D.y[0]), true); if (D.x) L.pose(D.x[0], L.defaut(D.x[0]), true); peindre(); L.fin(); },
    clavier: (touche, e) => {
      const k = e.shiftKey ? 0.2 : 1;
      if ((touche === 'ArrowLeft' || touche === 'ArrowRight') && D.x) L.pose(D.x[0], L.get(D.x[0]) + (touche === 'ArrowRight' ? 1 : -1) * k / D.x[1] * 0.5);
      else if (touche === 'ArrowUp' || touche === 'ArrowDown') L.pose(D.y[0], L.get(D.y[0]) + (touche === 'ArrowUp' ? 1 : -1) * k * 5 * D.y[1]);
      clearTimeout(molT); molT = setTimeout(() => L.fin(), 300);
    },
  });
  let molT = null;
  E.box.title = `le point : ${L.sp(D.y[0]).label.toLowerCase()} (vertical)${D.x ? `, ${L.sp(D.x[0]).label.toLowerCase()} (horizontal)` : ''} · ${AIDE}`;

  // la crête qui entre, à chaque image (dix fois par seconde suffit à l'œil)
  let an = null, buf = null, tour = 0, tenue = 0;
  function frame() {
    if (++tour % 6) return;
    if (!an) { an = app.engine.sonde?.(m.id, 'in', 2048); if (!an) return; buf = new Float32Array(2048); }
    an.getFloatTimeDomainData(buf);
    let p = 0;
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v; }
    // une crête tenue, qui retombe doucement (lisible à dix images par seconde)
    tenue = Math.max(p, tenue * 0.85);
    const v = tenue > 0.01;   // sous −40 dB, le sinus de pleine échelle se lit mieux
    if (!v && !vive) return;
    vive = v; crete = tenue;
    peindre();
  }

  const root = el('div', { class: 'ap ap-satx', style: { width: `${W}px` } }, E.box,
    el('div', { class: 'ap-reglages' }, el('div', { class: 'ap-kns' }, D.ks.map((k, i) => L.molette(k, { accent: i < 2 ? accent : 'cy' })))));
  peindre();
  return { el: root, frame, peindre };
}
