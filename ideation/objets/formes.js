// IDÉATION · OBJETS — les formes (étude ideation_atelier.md § 3.1, le prototype
// de Cal : outil S, ici R). Six contours dans une boîte 100 × 100 étirée à la
// taille de l'objet ; le trait garde son épaisseur d'écran à tout zoom
// (non-scaling-stroke), le fond est la couleur du trait à 8 %, le texte centré.
//
//   { id, type: 'shape', x, y, w, h, kind, color, text }

import { el } from '../../commun/shell.js';
import { svg, icon, PALETTE } from './commun.js';

export const SHAPES = {
  rect:    { name: 'Rectangle', d: 'M0 0H100V100H0Z' },
  round:   { name: 'Arrondi', d: 'M12 0H88Q100 0 100 12V88Q100 100 88 100H12Q0 100 0 88V12Q0 0 12 0Z' },
  ellipse: { name: 'Ellipse', d: 'M50 0A50 50 0 1 1 49.99 0Z' },
  diamond: { name: 'Décision', d: 'M50 0L100 50L50 100L0 50Z' },
  hex:     { name: 'Hexagone', d: 'M22 0H78L100 50L78 100H22L0 50Z' },
  para:    { name: 'Données', d: 'M18 0H100L82 100H0Z' },
};
export const SHAPE_KINDS = Object.keys(SHAPES);
// l'icône d'un contour dans 24 × 24 (le prototype : chaque nombre × 0,2 + 2)
// (l'ellipse à part : ses drapeaux d'arc ne se mettent pas à l'échelle)
export const shapeIcon = (k) => icon(k === 'ellipse' ? 'M12 2A10 10 0 1 1 11.99 2Z'
  : (SHAPES[k] || SHAPES.round).d.replace(/(\d+(\.\d+)?)/g, (m) => String(+(+m * 0.2 + 2).toFixed(2))));
export const TOOL_ICON = 'M3.5 3.5h9v9h-9zM16.5 12a4.5 4.5 0 1 0 .01 0';

export function shapeDefaults(kind = 'round') {
  const k = SHAPES[kind] ? kind : 'round';
  return k === 'diamond' ? { w: 150, h: 120, kind: k, color: 'or', text: '' } : { w: 160, h: 96, kind: k, color: 'cy', text: '' };
}

export function buildShape(n) {
  const s = SHAPES[n.kind] || SHAPES.round;
  return {
    style: { '--k': `var(--${n.color || 'cy'})` },
    body: [svg('svg', { class: 'shp', viewBox: '0 0 100 100', preserveAspectRatio: 'none' }, svg('path', { d: s.d })),
      // vide, une forme ne dit rien (un schéma reste propre) ; double-clic : écrire
      el('div', { class: 'txt' + (n.text ? '' : ' ph') }, n.text || '')],
  };
}

export function shapeMenu(app, n) {
  const set = (patch) => () => app.mutate(() => Object.assign(n, patch));
  return [
    { label: 'Écrire', key: 'Entrée', onclick: () => app.canvas.editText(n.id) },
    { label: 'Contour', items: SHAPE_KINDS.map((k) => ({ label: SHAPES[k].name, checked: n.kind === k, onclick: set({ kind: k }) })) },
    { label: 'Couleur', items: PALETTE.map((c) => ({ label: c.name, dot: c.id, checked: n.color === c.id, onclick: () => { app.mutate(() => { n.color = c.id; }); app.LS('shape-color', c.id); } })) },
  ];
}

export function shapePanel(app, n, K) {
  const { card, hint } = K;
  const ta = el('textarea', { class: 'fld', rows: 3, placeholder: 'le texte de la forme' });
  ta.value = n.text || '';
  let ch = () => {};
  ta.addEventListener('focus', () => { ch = app.editing(); });
  ta.addEventListener('input', () => { ch(); n.text = ta.value; app.canvas.renderSoon(); });
  const grid = el('div', { class: 'ob-grid' }, ...SHAPE_KINDS.map((k) => el('button', { class: 'ob-cell' + (n.kind === k ? ' on' : ''), type: 'button', title: SHAPES[k].name,
    onclick: () => { app.mutate(() => { n.kind = k; }); app.LS('shape-kind', k); } }, shapeIcon(k), el('span', {}, SHAPES[k].name))));
  return [card('Forme', SHAPES[n.kind]?.name || '', ta, grid, swatches(app, n, 'shape-color'),
    hint('double-clic : écrire sur place · les poignées autour d’une forme choisie la relient à un autre objet'))];
}

// les pastilles de couleur (formes, cartes, traits)
export function swatches(app, n, key) {
  return el('div', { class: 'swatches' }, ...PALETTE.map((c) => el('button', { class: 'swc' + (n.color === c.id ? ' on' : ''), type: 'button', title: c.name,
    style: { background: `var(--${c.id})` }, onclick: () => { app.mutate(() => { n.color = c.id; }); app.LS(key, c.id); } })));
}
