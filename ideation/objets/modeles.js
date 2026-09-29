// IDÉATION · OBJETS — les modèles (étude ideation_atelier.md § 3.7). Le
// prototype de Cal pose kanban, rétrospective, parcours, mind map et SWOT
// « au centre de la vue » ; ici, des modèles d'atelier de film faits des mêmes
// objets (cadres, notes, formes, cartes, mind map), posés au même endroit, tous
// choisis, un seul pas d'annulation. Leurs textes ne sont que des noms de
// cases : rien n'est écrit à la place de Cal.

import { shapeDefaults } from './formes.js';
import { cardDefaults } from './cartes.js';

export const TEMPLATES = [
  { id: 'sequence', name: 'Découpage', desc: 'une séquence en six plans : une case et une note chacun' },
  { id: 'perso', name: 'Fiche personnage', desc: 'visage, tenue, plein pied, voix, et sa carte personne' },
  { id: 'parcours', name: 'Parcours d’un plan', desc: 'de l’intention au plan animé : des formes reliées' },
  { id: 'casting', name: 'Casting', desc: 'pressentis, essais, retenus : des cartes personne' },
  { id: 'lumiere', name: 'Référence lumière', desc: 'une mind map de la lumière et un cadre pour ses images' },
];
export const TOOL_ICON = 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z';

// les objets d'un modèle autour de (cx, cy) : { nodes, links }
export function buildTemplate(app, id, cx, cy) {
  const nodes = [], links = [];
  const N = (type, o) => { const n = { id: app.uid('n'), type, ...o }; nodes.push(n); return n; };
  const F = (name, x, y, w, h) => N('frame', { name, x: Math.round(x), y: Math.round(y), w, h });
  const S = (text, kind, x, y, color) => { const d = shapeDefaults(kind); return N('shape', { ...d, text, color: color || d.color, x: Math.round(x), y: Math.round(y - d.h / 2) }); };
  const K = (kind, x, y, text = '') => N('card', { ...cardDefaults(kind), text, x: Math.round(x), y: Math.round(y) });
  const A = (a, b, label = '', dash = false) => links.push({ id: app.uid('l'), a: a.id, b: b.id, kind: 'arrow', label, ...(dash ? { dash: true } : {}) });
  const note = (x, y, w) => N('note', { x: Math.round(x), y: Math.round(y), w, h: 80, text: '' });
  if (id === 'sequence') {
    const fw = 400, fh = 260, x0 = cx - (3 * fw + 2 * 30) / 2, y0 = cy - fh - 35;
    N('title', { x: Math.round(x0), y: Math.round(y0 - 110), w: 600, h: 50, text: 'Séquence', size: 'm' });
    for (let i = 0; i < 6; i++) {
      const x = x0 + (i % 3) * (fw + 30), y = y0 + Math.floor(i / 3) * (fh + 70);
      F(`Plan ${i + 1}`, x, y, fw, fh);
      note(x + 16, y + fh - 96, fw - 32);
    }
  } else if (id === 'perso') {
    const fw = 360, fh = 440, x0 = cx - (4 * fw + 3 * 30) / 2, y0 = cy - fh / 2 + 90;
    K('person', x0, y0 - 190);
    ['Visage', 'Tenue', 'Plein pied', 'Voix'].forEach((t, i) => F(t, x0 + i * (fw + 30), y0, fw, fh));
    note(x0 + 3 * (fw + 30) + 16, y0 + 20, fw - 32);
  } else if (id === 'parcours') {
    const x0 = cx - 590;
    const a = S('Intention', 'ellipse', x0, cy, 'grn2');
    const b = S('Références', 'round', x0 + 230, cy);
    const c = S('Image', 'round', x0 + 460, cy);
    const d = S('Validée ?', 'diamond', x0 + 690, cy);
    const e = S('Vidéo', 'round', x0 + 920, cy);
    const f = S('Reprendre', 'round', x0 + 685, cy + 170, 'amb');
    A(a, b); A(b, c); A(c, d); A(d, e, 'oui'); A(d, f, 'non', true); A(f, c, '', true);
  } else if (id === 'casting') {
    const fw = 340, fh = 560, x0 = cx - (3 * fw + 2 * 30) / 2, y0 = cy - fh / 2;
    ['Pressentis', 'Essais', 'Retenus'].forEach((t, i) => F(t, x0 + i * (fw + 30), y0, fw, fh));
    K('person', x0 + 20, y0 + 24); K('person', x0 + 20, y0 + 194);
    K('person', x0 + fw + 50, y0 + 24); K('task', x0 + fw + 50, y0 + 194);
    K('person', x0 + 2 * (fw + 30) + 20, y0 + 24);
  } else if (id === 'lumiere') {
    const root = N('mind', { x: Math.round(cx - 560), y: Math.round(cy - 24), w: 120, h: 48, text: 'Lumière', collapsed: false });
    for (const t of ['Heure', 'Source', 'Contraste', 'Couleur', 'Références']) N('mind', { parent: root.id, x: root.x, y: root.y, w: 80, h: 36, text: t, collapsed: false });
    F('Images de référence', cx + 40, cy - 200, 540, 400);
  }
  return { nodes, links };
}

export function insertTemplate(app, id, cx, cy) {
  const { S } = app;
  if (!S.board) return;
  const { nodes, links } = buildTemplate(app, id, cx, cy);
  if (!nodes.length) return;
  app.mutate((B) => {
    // les cadres dessous, le reste par-dessus ; tout est choisi (les enfants d'une mind map viennent avec leur racine)
    B.nodes = [...nodes.filter((n) => n.type === 'frame'), ...B.nodes, ...nodes.filter((n) => n.type !== 'frame')];
    B.links.push(...links);
    S.sel = new Set(nodes.filter((n) => !(n.type === 'mind' && n.parent)).map((n) => n.id)); S.link = null; S.focus = null;
  });
}
