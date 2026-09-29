// IDÉATION · OBJETS — le crayon (étude ideation_atelier.md § 3.9 ; le prototype
// de Cal : outil P, ici D — P est le composeur, D le « draw » de tldraw).
//
//   { id, type: 'ink', x, y, w, h, pts: [x0, y0, x1, y1…], color, width }
//
// Un trait à main levée. Ses points sont rangés en entiers de 0 à 1000 dans sa
// boîte : le déplacer, le mettre à l'échelle, l'annuler passent par x, y, w, h
// comme pour tout objet. Son épaisseur (2,2 px par défaut) est une épaisseur
// d'écran, bornée au zoom (× 0,6 à × 1,6, comme le prototype). Il se choisit
// par son trait (une zone de 14 px), pas par sa boîte.

import { el } from '../../commun/shell.js';
import { svg, PALETTE } from './commun.js';
import { swatches } from './formes.js';

export const TOOL_ICON = 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3';
export const WIDTHS = [[1.4, 'fin'], [2.2, 'moyen'], [4, 'épais']];
const MAXPTS = 2000;
const zk = (z) => Math.max(0.6, Math.min(1.6, z));

// une courbe douce par les milieux (une quadratique par point)
function smooth(P) {
  if (!P.length) return '';
  if (P.length < 3) return `M${P[0][0]} ${P[0][1]}` + P.slice(1).map((p) => `L${p[0]} ${p[1]}`).join('') + (P.length === 1 ? 'l0.01 0' : '');
  let d = `M${P[0][0]} ${P[0][1]}`;
  for (let i = 1; i < P.length - 1; i++) {
    const mx = (P[i][0] + P[i + 1][0]) / 2, my = (P[i][1] + P[i + 1][1]) / 2;
    d += `Q${P[i][0]} ${P[i][1]} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const L = P[P.length - 1];
  return d + `L${L[0]} ${L[1]}`;
}
export function inkPath(flat) {
  const P = [];
  for (let i = 0; i + 1 < (flat || []).length; i += 2) P.push([flat[i], flat[i + 1]]);
  return smooth(P);
}
// Ramer-Douglas-Peucker : les points qui s'écartent de moins de eps de la corde tombent
function simplify(P, eps) {
  if (P.length < 3) return P;
  const keep = new Uint8Array(P.length);
  keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = P[a], [bx, by] = P[b];
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - P[i][1]) - (ax - P[i][0]) * (by - ay)) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return P.filter((_, i) => keep[i]);
}

// tracer : les points en coordonnées de la planche ; le trait vivant sur le calque d'écran
export function startInk(app, env, e) {
  const { cv, over, drag, toWorld } = env;
  const S = app.S;
  if (!S.board) return;
  const color = PALETTE.some((c) => c.id === app.LS('ink-color')) ? app.LS('ink-color') : 'or';
  const width = WIDTHS.some(([w]) => w === app.LS('ink-width')) ? app.LS('ink-width') : 2.2;
  const z = S.view.z;
  const r = cv.getBoundingClientRect();
  const scr = [[e.clientX - r.left, e.clientY - r.top]];
  const pts = [toWorld(e.clientX, e.clientY)];
  const live = svg('path', { class: 'ink-live', style: `stroke: var(--${color}); stroke-width: ${(width * zk(z)).toFixed(2)}px` });
  over.append(live);
  live.setAttribute('d', smooth(scr));
  drag((ev) => {
    const p = [ev.clientX - r.left, ev.clientY - r.top], q = scr[scr.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.5) return;
    scr.push(p);
    pts.push(toWorld(ev.clientX, ev.clientY));
    live.setAttribute('d', smooth(scr));
  }, () => {
    live.remove();
    if (pts.length < 2) return;
    let P = simplify(pts, 0.7 / z);
    while (P.length > MAXPTS) P = P.filter((_, i) => i % 2 === 0 || i === P.length - 1);
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    let x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
    // une boîte de 16 au moins (un trait droit n'a pas d'épaisseur) : élargie autour du trait
    if (w < 16) { x0 -= (16 - w) / 2; w = 16; }
    if (h < 16) { y0 -= (16 - h) / 2; h = 16; }
    const flat = P.flatMap(([x, y]) => [Math.round((x - x0) / w * 1000), Math.round((y - y0) / h * 1000)]);
    const n = { id: app.uid('n'), type: 'ink', x: Math.round(x0), y: Math.round(y0), w: Math.round(w), h: Math.round(h), pts: flat, color, width };
    app.mutate((B) => { B.nodes.push(n); });
  });
}

export function buildInk(n) {
  const d = inkPath(n.pts);
  return {
    style: { '--k': `var(--${n.color || 'or'})`, '--iw': String(n.width || 2.2) },
    body: [svg('svg', { class: 'ink', viewBox: '0 0 1000 1000', preserveAspectRatio: 'none' }, svg('path', { class: 'ihit', d }), svg('path', { class: 'ivis', d }))],
  };
}

export function inkMenu(app, n) {
  const set = (fn) => () => { const c = app.node(n.id); if (c) app.mutate(() => fn(c)); };
  return [
    { label: 'Couleur', items: PALETTE.map((c) => ({ label: c.name, dot: c.id, checked: n.color === c.id, onclick: () => { set((x) => { x.color = c.id; })(); app.LS('ink-color', c.id); } })) },
    { label: 'Épaisseur', items: WIDTHS.map(([w, name]) => ({ label: name, checked: Math.abs((n.width || 2.2) - w) < 0.01, onclick: () => { set((x) => { x.width = w; })(); app.LS('ink-width', w); } })) },
  ];
}

export function inkPanel(app, n, K) {
  const { card, hint } = K;
  return [card('Trait', `${Math.round((n.pts || []).length / 2)} points`, swatches(app, n, 'ink-color'),
    el('div', { class: 'seg' }, ...WIDTHS.map(([w, name]) => el('button', { class: 'tb' + (Math.abs((n.width || 2.2) - w) < 0.01 ? ' on' : ''), type: 'button',
      onclick: () => { const c = app.node(n.id); if (c) app.mutate(() => { c.width = w; }); app.LS('ink-width', w); } }, name))),
    hint('D : le crayon ; il reste pris après un trait (Échap le repose). Un trait se choisit par son tracé, se déplace, se met à l’échelle par son coin.'))];
}
