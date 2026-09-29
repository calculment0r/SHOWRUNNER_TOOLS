// IDÉATION · OBJETS — les guides magnétiques (étude ideation_atelier.md § 3.4,
// le `moveDrag` du prototype de Cal). Pendant qu'on déplace une sélection (sauf
// Alt tenu, ou l'aimant éteint), les x gauche, centre, droit et les y haut,
// milieu, bas de la boîte déplacée se comparent aux mêmes valeurs des autres
// objets affichés ; en deçà de 6 px d'écran (6 / zoom dans le monde), la boîte
// saute sur le plus proche, en x et en y séparément ; une ligne pointillée
// traverse la vue à la coordonnée prise.

import { svg } from './commun.js';

export const SNAP_PX = 6;

// les repères : ceux des objets affichés (hors de la vue, le culling les a éteints), sauf ce qu'on déplace
export function targets(app, moving) {
  const xs = [], ys = [];
  const C = app.canvas;
  for (const n of app.S.board?.nodes || []) {
    if (moving.has(n.id)) continue;
    const d = C.dom.get(n.id);
    if (!d || d.off || !d.el.isConnected) continue;
    if (n.type === 'group' && !C.isCard(n)) continue;   // un groupe n'a pas de dessin à lui
    const b = C.dispBox(n);
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}

// la boîte déplacée { x, y, w, h } → le complément à ajouter et les coordonnées prises
export function snap(box, T, th) {
  let bx = null, by = null;
  const mx = [box.x, box.x + box.w / 2, box.x + box.w], my = [box.y, box.y + box.h / 2, box.y + box.h];
  for (const v of T.xs) for (const m of mx) { const d = v - m; if (Math.abs(d) < th && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, v }; }
  for (const v of T.ys) for (const m of my) { const d = v - m; if (Math.abs(d) < th && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, v }; }
  return { dx: bx ? bx.d : 0, dy: by ? by.d : 0, gx: bx ? bx.v : null, gy: by ? by.v : null };
}

// les lignes, sur le calque d'écran de la planche (coordonnées de .cv)
export function paintGuides(over, view, cvW, cvH, g) {
  let layer = over.querySelector('g.guides');
  if (!layer) { layer = svg('g', { class: 'guides' }); over.append(layer); }
  layer.replaceChildren();
  if (!g) return;
  if (g.gx !== null) { const x = view.x + g.gx * view.z; layer.append(svg('line', { x1: x, y1: 0, x2: x, y2: cvH })); }
  if (g.gy !== null) { const y = view.y + g.gy * view.z; layer.append(svg('line', { x1: 0, y1: y, x2: cvW, y2: y })); }
}
