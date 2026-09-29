// IDÉATION · OBJETS — regrouper les post-it par couleur (étude
// ideation_atelier.md § 3.6, le `cluster` du prototype de Cal). Les post-it
// choisis (ou tous, s'il n'y en a pas deux choisis) se rangent en colonnes, une
// par couleur, dans l'ordre du nuancier des post-it, 190 px de large à 18 px
// d'écart ; chaque colonne dans un cadre titré « couleur · nombre ». Ils
// glissent jusqu'à leur place (0,6 s). Un post-it qui était dans un groupe en
// sort : c'est le cadre qui le range maintenant. Un seul pas d'annulation.
//
// Les noms des couleurs viennent du serveur (/api/ideation/meta, sticky[].name).

import { toast } from '../../commun/shell.js';
import { bbox } from './commun.js';

const W = 190, G = 18, HEAD = 44;

export function stickyName(app, id) {
  return app.S.meta?.sticky?.find((c) => c.id === id)?.name || id;
}

export function regroup(app) {
  const { S } = app;
  if (!S.board) return;
  const chosen = app.groups.expand([...S.sel].map((id) => app.node(id)).filter(Boolean)).filter((n) => n.type === 'sticky');
  const st = chosen.length >= 2 ? chosen : S.board.nodes.filter((n) => n.type === 'sticky' && !app.canvas.hiddenIn(n.id));
  if (st.length < 2) { toast('il faut au moins deux post-it à regrouper'); return; }
  const b = bbox(st);
  const order = (S.meta?.sticky || []).map((c) => c.id);
  const cols = new Map();
  for (const id of order) cols.set(id, []);
  // l'ordre de lecture dans chaque colonne (de haut en bas, de gauche à droite)
  for (const n of [...st].sort((p, q) => (Math.abs(p.y - q.y) > 40 ? p.y - q.y : p.x - q.x))) {
    if (!cols.has(n.color)) cols.set(n.color, []);
    cols.get(n.color).push(n);
  }
  const used = [...cols.entries()].filter(([, l]) => l.length);
  const frames = [];
  glide(app);   // la transition est posée avant que les places changent
  app.mutate((B) => {
    used.forEach(([c, list], ci) => {
      const x = Math.round(b.x + ci * (W + G * 3));
      let y = b.y + HEAD;
      for (const n of list) {
        n.x = x + G; n.y = Math.round(y); n.w = W;
        delete n.group;
        y += Math.max(n.h, 150) + G;
      }
      const f = { id: app.uid('n'), type: 'frame', x, y: Math.round(b.y), w: W + 2 * G, h: Math.round(y - b.y), name: `${stickyName(app, c)} · ${list.length}` };
      frames.push(f);
    });
    B.nodes.unshift(...frames);
    S.sel = new Set(); S.link = null; S.focus = null;
  });
  toast(`${st.length} post-it regroupés en ${used.length} colonne${used.length > 1 ? 's' : ''} — ctrl+Z les remet`);
}

// les objets glissent jusqu'à leur place (le canvas ne fait que les replacer : une transition passagère)
export function glide(app, ms = 700) {
  const cv = app.canvas.el;
  cv.classList.add('glide');
  clearTimeout(glide.t);
  glide.t = setTimeout(() => { cv.classList.remove('glide'); app.canvas.paintLinks(); app.canvas.sel?.follow(); }, ms);
}
