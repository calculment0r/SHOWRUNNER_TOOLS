// IDÉATION · OBJETS — ce que les objets d'atelier partagent (formes, cartes,
// mind map, crayon ; l'étude : docs/etudes/ideation_atelier.md § 3).
//
// Les couleurs sont des noms de jetons (commun/tokens.css), jamais des
// valeurs : la page les pose en var(--nom), l'export (server/tools/ideation.py)
// les lit dans le même fichier. Le serveur tient les mêmes listes (PALETTE,
// SHAPES, CARD_KINDS, MIND_BRANCH) : une couleur inconnue y revient au défaut.

export const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
  for (const c of kids) if (c) n.append(c);
  return n;
}
// une icône de 24 × 24 (les traits du prototype de Cal)
export const icon = (d, cls = '') => svg('svg', { viewBox: '0 0 24 24', class: cls || null }, svg('path', { d }));

// les couleurs des formes, des cartes et des traits : acier, orange, vert, ambre, encre
// (le prototype : acier, corail, vert, sable, encre — le sable n'a pas de jeton : l'ambre)
export const PALETTE = [
  { id: 'cy', name: 'acier' }, { id: 'or', name: 'orange' }, { id: 'grn2', name: 'vert' },
  { id: 'amb', name: 'ambre' }, { id: 'ink', name: 'encre' },
];
export const colorName = (id) => PALETTE.find((c) => c.id === id)?.name || id;

// les objets d'annotation : ils portent les quatre poignées des connecteurs
export const ANNOT = new Set(['note', 'sticky', 'title', 'shape', 'card', 'mind', 'text']);
// les objets qu'on écrit sur place (double-clic, Entrée) ; le texte (texte.js) en édition riche
export const WRITABLE = new Set(['note', 'sticky', 'title', 'shape', 'card', 'mind', 'text']);
// ce qui se convertit en mind map (étude § 3.3)
export const TO_MIND = new Set(['note', 'sticky', 'title', 'shape', 'card']);

export const cut = (s, k = 60) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > k ? s.slice(0, k - 1) + '…' : s; };
export function bbox(list) {
  if (!list.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of list) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
// la mesure d'un texte (les nœuds de mind map prennent la largeur de leur nom)
let ctx2 = null;
export function textWidth(t, font) {
  if (!ctx2) ctx2 = document.createElement('canvas').getContext('2d');
  ctx2.font = font;
  return ctx2.measureText(t).width;
}
