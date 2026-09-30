// IDÉATION · DIAPOSITIVES — l'ordre des diapositives, gardé sur la planche
// (docs/etudes/presentations.md, étape 1). Chaque cadre est une diapositive.
// Le serveur garde sur un cadre `slide` (sa place, un nombre) et `skip` (masquée) :
// server/tools/ideation.py, _node. L'ordre : les cadres qui ont une place, par
// place (à égalité, l'ordre de lecture) ; puis ceux qui n'en ont pas (un cadre
// posé depuis), dans l'ordre de lecture de la planche. Réordonner donne à chaque
// cadre sa place, dans un seul geste (app.mutate : un pas d'annulation, et la
// co-édition envoie un registre `slide` par cadre).

import { readingOrder } from '../atelier/socle.js';

export const isSlide = (f) => !!(f && f.type === 'frame' && f.deck && f.deck.ratio);
// la transition qui mène à une diapositive ; un cadre libre garde le vol sur la planche
export const transOf = (f) => (isSlide(f) ? f.deck.trans || 'fade' : 'fly');

export function deckOf(B) {
  const all = B ? B.nodes.filter((n) => n.type === 'frame') : [];
  const ro = readingOrder(all);
  const rank = new Map(ro.map((f, i) => [f.id, i]));
  const placed = all.filter((f) => Number.isFinite(f.slide)).sort((a, b) => a.slide - b.slide || rank.get(a.id) - rank.get(b.id));
  const seq = [...placed, ...ro.filter((f) => !Number.isFinite(f.slide))];
  return { seq, skip: new Set(all.filter((f) => f.skip).map((f) => f.id)), custom: placed.length > 0 };
}
export const shownOf = (B) => { const { seq, skip } = deckOf(B); return seq.filter((f) => !skip.has(f.id)); };

// l'ordre `ids` (des cadres) sur la planche : places 1, 2, 3… (en place dans une mutation)
export function putOrder(B, ids) {
  ids.forEach((id, i) => { const f = B.nodes.find((n) => n.id === id && n.type === 'frame'); if (f) f.slide = i + 1; });
}
export function setOrder(app, ids) { app.mutate((B) => putOrder(B, ids)); }
// revenir à l'ordre de lecture : plus aucune place
export function readingReset(app) {
  app.mutate((B) => { for (const f of B.nodes) if (f.type === 'frame') delete f.slide; });
}
export function setSkip(app, id, on) {
  app.mutate((B) => { const f = B.nodes.find((n) => n.id === id); if (f) { if (on) f.skip = true; else delete f.skip; } });
}
