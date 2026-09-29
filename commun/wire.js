// SHOWRUNNER TOOLS — les fils d'un canvas nodal : le dessin des câbles du
// nodal d'ODIO (musique/nodal.js, musique/musique.css), sorti ici pour
// qu'Idéation et les autres canvas aient les mêmes.
//
// Ce qui vient d'ODIO, tel quel : la courbe de Bézier horizontale qui part
// à droite d'une sortie et arrive à gauche d'une entrée (poignées à la moitié
// de l'écart, 40 au moins), le trait de 2 à 75 % dans la teinte de la source
// (--k), la zone de clic de 16, le fil choisi orange à 3 et opaque, le fil
// qu'on tire orange en tirets 5 5, les envois en tirets 6 5. ODIO n'a pas
// d'animation de flux : il n'y en a pas ici non plus.
// Ce qui s'ajoute pour un canvas qui zoome loin (Idéation : 8 % à 400 %) : le
// trait garde son épaisseur à l'écran (vector-effect), le survol l'éclaire,
// un fil qui ne va plus (`bad`) passe à l'orange d'alerte en pointillés et dit
// pourquoi au survol (`why`), un fil au repos (`idle`) s'efface à moitié.
//
//   import { wire, wireD, wireAt, tempWire } from '../commun/wire.js';
//   svg.append(wire([x1, y1], [x2, y2], { color: 'amb', id: 'l1', cls: 'bad', why: '…', label: 'réf. 1' }));
//   temp.setAttribute('d', wireD(a, b));
//
// Les couleurs sont des noms de jetons (commun/tokens.css), jamais des teintes.

const NS = 'http://www.w3.org/2000/svg';

// la feuille des fils, chargée une fois, à côté de ce fichier (comme menu.js)
if (typeof document !== 'undefined' && !document.querySelector('link[data-sr-wire]')) {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./wire.css', import.meta.url).href;
  l.dataset.srWire = '';
  document.head.append(l);
}

const node = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  return n;
};

// les quatre points de la courbe d'ODIO (nodal.js, curve)
export function wirePts([x1, y1], [x2, y2]) {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return [[x1, y1], [x1 + dx, y1], [x2 - dx, y2], [x2, y2]];
}
export function wireD(a, b) {
  const [p, c1, c2, q] = wirePts(a, b);
  return `M${p[0]} ${p[1]} C${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${q[0]} ${q[1]}`;
}
// un point de la courbe (t de 0 à 1) : où poser une étiquette
export function wireAt(a, b, t = 0.5) {
  const [p, c1, c2, q] = wirePts(a, b);
  const u = 1 - t;
  const f = (i) => u * u * u * p[i] + 3 * u * u * t * c1[i] + 3 * u * t * t * c2[i] + t * t * t * q[i];
  return [f(0), f(1)];
}

// un fil : <g class="sr-wire"> avec son trait, sa zone de clic, sa raison au survol
export function wire(a, b, { color = 'ink3', id = null, cls = '', why = '', label = '', labelAt = 0.5 } = {}) {
  const d = wireD(a, b);
  const g = node('g', { class: `sr-wire${cls ? ' ' + cls : ''}`, 'data-link': id, style: `--k: var(--${color})` });
  if (why) { const t = node('title'); t.textContent = why; g.append(t); }
  g.append(node('path', { class: 'vis', d }), node('path', { class: 'hit', d, 'data-link': id }));
  if (label) {
    const [x, y] = wireAt(a, b, labelAt);
    const t = node('text', { class: 'lab', x, y: y - 7 });
    t.textContent = label;
    g.append(t);
  }
  return g;
}

// le fil qu'on tire : un seul par canvas, vidé au lâcher
export function tempWire() {
  return node('path', { class: 'sr-wire-temp' });
}
export function paintTemp(path, a, b, { color = null, snapped = false } = {}) {
  if (!a || !b) { path.setAttribute('d', ''); return; }
  path.setAttribute('d', wireD(a, b));
  path.classList.toggle('snap', !!snapped);
  if (color) path.style.setProperty('--k', `var(--${color})`); else path.style.removeProperty('--k');
}
