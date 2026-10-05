// IDÉATION · PRÉSENTATION — le choix d'une courbe et son aperçu en direct (06/10).
//
// La note de spécification d'un éditeur de motion design partagée par Cal le 06/10 : « easing picker
// with live curve preview. Plain-language labels; tooltip on every non-obvious control explaining what
// it changes. » Un réglage du panneau du mode (l'entrée d'un objet, la transition d'une diapositive, la
// courbe d'une image clé) :
//   - une liste : les courbes nommées (linéaire, entrée, sortie, entrée-sortie, et celles du moteur),
//     « cubic-bezier · poignées » et « ressort réglé », chacune avec sa phrase simple ;
//   - le dessin de la courbe (le temps en x, le chemin parcouru en y, l'arrivée en pointillé) — redessiné
//     pendant qu'on glisse une poignée ou un réglage du ressort ; ses poignées (cubic-bezier) se glissent ;
//   - le ressort : raideur, amortissement, masse (le fader du thème, couché, et un champ) ;
//   - « Voir » : un point qui fait le trajet en une seconde, avec cette courbe.
// La courbe ne s'écrit qu'au bout du geste (onChange : un pas d'annulation) ; le dessin suit en direct.
// Aucune couleur ici : les traits prennent les jetons du thème (presentation.css, .pm-cv).

import { el } from '../../commun/shell.js';
import { easeFn, easeCss, cleanEase, bzOf, SPRING0, LIM } from './courbes.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
// les courbes, en mots simples (l'infobulle dit ce que chacune change)
export const EASE_FR = [
  ['linear', 'linéaire', 'à vitesse constante, du début à la fin'],
  ['in', 'entrée', 'part lentement, accélère, arrive vite'],
  ['out', 'sortie', 'part vite, ralentit, se pose doucement'],
  ['in-out', 'entrée-sortie', 'lent au départ et à l’arrivée, vif au milieu'],
  ['out-expo', 'expo', 'très vif au départ, puis un long freinage'],
  ['out-quint', 'quint', 'vif au départ, freinage marqué'],
  ['standard', 'standard', 'la courbe de Material : vive, sans à-coup'],
  ['in-out-expo', 'expo entrée-sortie', 'très lent aux deux bouts, très vif au milieu'],
  ['back', 'rebond', 'dépasse un peu l’arrivée, puis revient'],
  ['spring', 'ressort', 'oscille autour de l’arrivée avant de s’y poser (raideur 180, amortissement 16, masse 1)'],
];
const FR = Object.fromEntries(EASE_FR.map(([v, l, t]) => [v, { l, t }]));
const SP = [
  ['k', 'raideur', 'la force qui ramène vers l’arrivée : plus raide, plus vif et plus d’allers-retours', 1],
  ['c', 'amortissement', 'le frein : plus amorti, moins d’oscillations (beaucoup : il arrive sans dépasser)', 1],
  ['m', 'masse', 'le poids : plus lourd, plus lent et plus ample', 0.1],
];
// le cadre du dessin : u de 0 à 1 en x ; le chemin de −0,3 à 1,3 en y (un rebond, un ressort s'y voient)
const VW = 200, VH = 100, PX = 12, PY = 6, Y0 = -0.3, Y1 = 1.3;
const X = (u) => PX + u * (VW - 2 * PX);
const Y = (v) => PY + ((Y1 - Math.max(Y0, Math.min(Y1, v))) / (Y1 - Y0)) * (VH - 2 * PY);
const r2 = (v) => Math.round(v * 100) / 100;
const modeOf = (e) => (e && typeof e === 'object' ? (e.bz ? 'bz' : 'sp') : e || 'linear');

// courbe(valeur, { onChange(e), label, tip }) → { el, set(e) }
export function courbe(value, { onChange = () => {}, label = 'courbe', tip = '' } = {}) {
  let cur = cleanEase(value) ?? 'linear';
  const sel = el('select', { class: 'fld', 'aria-label': label, title: 'la façon dont le mouvement accélère et ralentit' },
    ...EASE_FR.map(([v, l]) => el('option', { value: v }, l)),
    el('option', { value: 'bz', title: 'une courbe libre : glisser ses deux poignées' }, 'cubic-bezier · poignées'),
    el('option', { value: 'sp', title: 'un ressort : sa raideur, son amortissement, sa masse' }, 'ressort réglé'));
  const say = el('small', { class: 'pm-cv-say' });
  // le dessin
  const svg = s('svg', { viewBox: `0 0 ${VW} ${VH}`, class: 'pm-cv-plot', role: 'img' });
  const grid = s('path', { class: 'pm-cv-grid', d: `M${X(0)} ${Y(0)}H${X(1)}M${X(0)} ${Y(1)}H${X(1)}M${X(0)} ${Y(Y0)}V${Y(Y1)}M${X(1)} ${Y(Y0)}V${Y(Y1)}` });
  const diag = s('path', { class: 'pm-cv-diag', d: `M${X(0)} ${Y(0)}L${X(1)} ${Y(1)}` });
  const arms = s('path', { class: 'pm-cv-arm' });
  const path = s('path', { class: 'pm-cv-line' });
  const h1 = s('circle', { class: 'pm-cv-h', r: 4.5, 'data-h': '1' });
  const h2 = s('circle', { class: 'pm-cv-h', r: 4.5, 'data-h': '2' });
  for (const h of [h1, h2]) { h.setAttribute('tabindex', '0'); h.append(s('title')); }
  h1.firstChild.textContent = 'première poignée : le départ (glisser ; flèches : la régler)';
  h2.firstChild.textContent = 'seconde poignée : l’arrivée (glisser ; flèches : la régler)';
  svg.append(grid, diag, arms, path, h1, h2);
  // les champs de la cubic-bezier, ceux du ressort
  const bzF = ['x1', 'y1', 'x2', 'y2'].map((n, i) => el('input', { class: 'fld', type: 'number', step: '0.01', min: i % 2 ? LIM.bzy[0] : 0, max: i % 2 ? LIM.bzy[1] : 1,
    'aria-label': n, title: i % 2 ? `${n} : la hauteur de la poignée (au-delà de 1 : le mouvement dépasse l’arrivée)` : `${n} : la place de la poignée dans le temps (0 à 1)` }));
  const bzRow = el('div', { class: 'pm-cv-bz' }, ...bzF.map((f, i) => el('label', { class: 'pm-cvn' }, el('span', { class: 'lbl' }, ['x1', 'y1', 'x2', 'y2'][i]), f)));
  const spF = SP.map(([k, l, t, step]) => {
    const r = el('input', { type: 'range', min: LIM[k][0], max: LIM[k][1], step, 'aria-label': l, title: t });
    const n = el('input', { class: 'fld', type: 'number', min: LIM[k][0], max: LIM[k][1], step, 'aria-label': l, title: t });
    return { k, r, n, row: el('div', { class: 'pm-cv-sp', title: t }, el('span', { class: 'lbl' }, l), r, n) };
  });
  const spBox = el('div', { class: 'pm-cv-sps' }, ...spF.map((x) => x.row));
  const dot = el('i', { class: 'pm-cv-dot' });
  const seeB = el('button', { class: 'tb ghost sm', type: 'button', title: 'un point fait le trajet en une seconde, avec cette courbe', onclick: () => see() }, 'Voir');
  const root = el('div', { class: 'pm-cv', title: tip || null },
    el('div', { class: 'pm-cv-h1' }, el('span', { class: 'lbl' }, label), sel), say, svg, bzRow, spBox,
    el('div', { class: 'pm-cv-run' }, el('span', { class: 'pm-cv-track' }, dot), seeB));

  function paint(e = cur) {
    const m = modeOf(e);
    sel.value = m;
    const f = easeFn(e);
    let d = '';
    for (let i = 0; i <= 64; i++) { const u = i / 64; d += `${i ? 'L' : 'M'}${X(u).toFixed(2)} ${Y(f(u)).toFixed(2)}`; }
    path.setAttribute('d', d);
    const b = m === 'bz' ? e.bz : null;
    for (const h of [h1, h2]) h.style.display = b ? '' : 'none';
    if (b) {
      h1.setAttribute('cx', X(b[0])); h1.setAttribute('cy', Y(b[1]));
      h2.setAttribute('cx', X(b[2])); h2.setAttribute('cy', Y(b[3]));
      arms.setAttribute('d', `M${X(0)} ${Y(0)}L${X(b[0])} ${Y(b[1])}M${X(1)} ${Y(1)}L${X(b[2])} ${Y(b[3])}`);
      bzF.forEach((x, i) => { if (document.activeElement !== x) x.value = String(r2(b[i])); });
    } else arms.setAttribute('d', '');
    bzRow.hidden = !b;
    spBox.hidden = m !== 'sp';
    if (m === 'sp') for (const x of spF) { if (document.activeElement !== x.n) x.n.value = String(e.spring[x.k]); x.r.value = String(e.spring[x.k]); }
    say.textContent = m === 'bz' ? `cubic-bezier(${b.map(r2).join(', ')}) — glisser les poignées`
      : m === 'sp' ? `ressort : raideur ${e.spring.k}, amortissement ${e.spring.c}, masse ${e.spring.m}` : FR[m]?.t || '';
    svg.setAttribute('aria-label', `la courbe ${m === 'bz' ? 'cubic-bezier' : m === 'sp' ? 'ressort réglé' : FR[m]?.l || m}`);
    root.dataset.mode = m;
  }
  const commit = (e) => { const c = cleanEase(e); if (!c) return; cur = c; paint(); onChange(c); };
  sel.addEventListener('change', () => {
    const v = sel.value;
    if (v === 'bz') commit({ bz: bzOf(cur) || [0.25, 0.1, 0.25, 1] });
    else if (v === 'sp') commit({ spring: cur?.spring || { ...SPRING0 } });
    else commit(v);
  });
  // glisser une poignée : le dessin suit, la courbe s'écrit au lâcher
  svg.addEventListener('pointerdown', (ev) => {
    const h = ev.target.closest?.('.pm-cv-h');
    if (!h || modeOf(cur) !== 'bz') return;
    ev.preventDefault(); ev.stopPropagation();
    svg.setPointerCapture(ev.pointerId);
    const k = h.dataset.h === '1' ? 0 : 2;
    const b = cur.bz.slice();
    const ctm = svg.getScreenCTM().inverse();
    const at = (e2) => { const p = svg.createSVGPoint(); p.x = e2.clientX; p.y = e2.clientY; return p.matrixTransform(ctm); };
    const mv = (e2) => {
      const p = at(e2);
      b[k] = r2(Math.max(0, Math.min(1, (p.x - PX) / (VW - 2 * PX))));
      b[k + 1] = r2(Math.max(Y0, Math.min(Y1, Y1 - ((p.y - PY) / (VH - 2 * PY)) * (Y1 - Y0))));
      paint({ bz: b });
    };
    const up = () => { svg.removeEventListener('pointermove', mv); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); commit({ bz: b }); };
    svg.addEventListener('pointermove', mv); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  });
  // au clavier : une poignée choisie, les flèches la déplacent (Maj : plus fin)
  for (const [h, k] of [[h1, 0], [h2, 2]]) h.addEventListener('keydown', (ev) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[ev.key];
    if (!d || modeOf(cur) !== 'bz') return;
    ev.preventDefault(); ev.stopPropagation();
    const st = ev.shiftKey ? 0.01 : 0.05, b = cur.bz.slice();
    b[k] = r2(Math.max(0, Math.min(1, b[k] + d[0] * st))); b[k + 1] = r2(b[k + 1] + d[1] * st);
    commit({ bz: b });
  });
  bzF.forEach((f, i) => f.addEventListener('change', () => { const b = cur.bz.slice(); const v = Number(f.value); if (Number.isFinite(v)) { b[i] = v; commit({ bz: b }); } }));
  for (const x of spF) {
    const live = (v) => { const sp = { ...cur.spring, [x.k]: Number(v) }; paint({ spring: sp }); return sp; };
    x.r.addEventListener('input', () => live(x.r.value));
    x.r.addEventListener('change', () => commit({ spring: live(x.r.value) }));
    x.n.addEventListener('change', () => { if (Number.isFinite(Number(x.n.value))) commit({ spring: live(x.n.value) }); });
  }
  function see() {
    const w = dot.parentElement.clientWidth - dot.offsetWidth;
    dot.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${w}px)` }], { duration: 1000, easing: easeCss(cur), fill: 'none' });
  }
  paint();
  return { el: root, set(e) { cur = cleanEase(e) ?? 'linear'; paint(); }, get value() { return cur; } };
}
