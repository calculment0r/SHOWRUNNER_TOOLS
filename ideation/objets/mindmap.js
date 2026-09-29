// IDÉATION · OBJETS — la mind map (étude ideation_atelier.md § 3.3 ; le
// prototype de Cal : outil M, ici B — M est la carte Générer vidéo).
//
//   { id, type: 'mind', x, y, w, h, parent, text, collapsed }
//
// Des nœuds reliés par `parent` (l'identifiant d'un autre nœud ; une racine
// n'en a pas), placés seuls : la racine est là où on l'a posée, le reste se
// range à sa droite — les enfants 84 px après la racine, 58 ensuite, empilés à
// 12 px, centrés sur la hauteur de leur sous-arbre (le `layout` du
// prototype). Les places calculées s'écrivent sur chaque nœud (x, y, w, h) à
// chaque rendu, comme la boîte d'un groupe : l'export, les cadres, la
// mini-carte, les guides les lisent sans rien savoir des arbres. L'ordre des
// frères est leur ordre dans la planche. La couleur est celle du rameau du
// premier rang, héritée dessous. Un nœud replié (`collapsed`) cache sa
// descendance : elle se range sous lui et n'est ni peinte ni choisie.
// Le serveur (server/tools/ideation.py, _minds) tient la même règle : un
// parent qui n'est pas un nœud tombe, une boucle se coupe, et tout l'arbre
// est dans le groupe de sa racine.

import { el } from '../../commun/shell.js';
import { svg, textWidth, cut, bbox } from './commun.js';

export const BRANCH = ['or', 'grn2', 'cy', 'amb', 'ink2', 'coral-2'];
export const TOOL_ICON = 'M12 10a2 2 0 1 0 .01 0M5 5a1.5 1.5 0 1 0 .01 0M19 5a1.5 1.5 0 1 0 .01 0M5 19a1.5 1.5 0 1 0 .01 0M19 19a1.5 1.5 0 1 0 .01 0M10.5 10.5L6 6M13.5 10.5L18 6M10.5 13.5L6 18M13.5 13.5L18 18';
const HEIGHT = [48, 36, 28];
const hOf = (d) => HEIGHT[Math.min(d, 2)];
const DISP = "400 13px 'Venus Rising', 'Chakra Petch', sans-serif";
const UI = "500 14px 'Chakra Petch', sans-serif";
const PH = 'idée';
function wOf(n, d) {
  const t = n.text || PH;
  const w = d === 0 ? textWidth(t.toUpperCase(), DISP) * 1.14 + 40 : textWidth(t, UI) + (d === 1 ? 30 : 12);
  return Math.round(Math.max(d === 0 ? 90 : 44, Math.min(520, w)));
}

// ── les arbres ─────────────────────────────────────────────────
function maps(board) {
  const byId = new Map(), kids = new Map();
  for (const n of board?.nodes || []) if (n.type === 'mind') byId.set(n.id, n);
  for (const n of byId.values()) {
    const p = n.parent ? byId.get(n.parent) : null;
    if (!p || p === n) continue;
    let a = kids.get(p.id);
    if (!a) kids.set(p.id, (a = []));
    a.push(n);
  }
  return { byId, kids };
}
// (les tables se font une fois par appel : une sélection de mille nœuds reste linéaire)
function rootIn(M, n) {
  let r = n;
  for (let i = 0; i < M.byId.size && r.parent && M.byId.get(r.parent) && M.byId.get(r.parent) !== n; i++) r = M.byId.get(r.parent);
  return r;
}
function subIn(M, n, out, seen) {
  const todo = [n];
  while (todo.length) {
    const x = todo.pop();
    if (seen.has(x.id)) continue;
    seen.add(x.id); out.push(x);
    const ch = M.kids.get(x.id) || [];
    for (let i = ch.length - 1; i >= 0; i--) todo.push(ch[i]);   // l'ordre des frères gardé
  }
  return out;
}
export const rootOf = (board, n) => (n?.type === 'mind' ? rootIn(maps(board), n) : n);
// n et toute sa descendance (dans l'ordre : le nœud, puis ses enfants dans leur ordre)
export const subtreeOf = (board, n) => (n?.type === 'mind' ? subIn(maps(board), n, [], new Set()) : n ? [n] : []);
// l'arbre entier d'un nœud (sa racine et toute la descendance)
export function treeOf(board, n) {
  if (n?.type !== 'mind') return n ? [n] : [];
  const M = maps(board);
  return subIn(M, rootIn(M, n), [], new Set());
}
// une liste d'objets où chaque nœud entraîne son arbre entier (déplacer, grouper)
export function withTrees(board, list) {
  const M = maps(board), out = [], seen = new Set();
  for (const n of list) {
    if (n.type === 'mind') subIn(M, rootIn(M, n), out, seen);
    else if (!seen.has(n.id)) { seen.add(n.id); out.push(n); }
  }
  return out;
}
// … ou sa descendance (supprimer, copier, dupliquer une branche)
export function withSubtrees(board, list) {
  const M = maps(board), out = [], seen = new Set();
  for (const n of list) {
    if (n.type === 'mind') subIn(M, n, out, seen);
    else if (!seen.has(n.id)) { seen.add(n.id); out.push(n); }
  }
  return out;
}
// une liste où chaque nœud est remplacé par la racine de son arbre, sans doublon (aligner, ranger)
export function asRoots(board, list) {
  const M = maps(board), out = new Map();
  for (const n of list) { const r = n.type === 'mind' ? rootIn(M, n) : n; out.set(r.id, r); }
  return [...out.values()];
}

// ── la mise en place ───────────────────────────────────────────
// Rend { info: id → { depth, color, kids }, folded: id → le nœud replié qui le cache }.
export function mindLayout(board) {
  const info = new Map(), folded = new Map();
  const { byId, kids } = maps(board);
  if (!byId.size) return { info, folded };
  const memo = new Map();
  const subH = (o, d) => {
    if (memo.has(o.id)) return memo.get(o.id);
    memo.set(o.id, hOf(d));   // une garde contre une boucle (le serveur les coupe)
    const ch = o.collapsed ? [] : kids.get(o.id) || [];
    const v = ch.length ? Math.max(hOf(d), ch.reduce((s, c) => s + subH(c, d + 1), 0) + (ch.length - 1) * 12) : hOf(d);
    memo.set(o.id, v);
    return v;
  };
  const seen = new Set();
  const hide = (o, by) => {
    for (const c of kids.get(o.id) || []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      Object.assign(c, { x: by.x, y: by.y, w: by.w, h: by.h });
      folded.set(c.id, by.id);
      const I = info.get(o.id);
      info.set(c.id, { depth: I.depth + 1, color: I.depth === 0 ? BRANCH[(kids.get(o.id) || []).indexOf(c) % BRANCH.length] : I.color, kids: (kids.get(c.id) || []).length });
      hide(c, by);
    }
  };
  const place = (o, d, x, yTop, color) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    const w = wOf(o, d), h = hOf(d), tot = subH(o, d);
    o.x = Math.round(x); o.y = Math.round(yTop + tot / 2 - h / 2); o.w = w; o.h = h;
    const ch = kids.get(o.id) || [];
    info.set(o.id, { depth: d, color, kids: ch.length });
    if (o.collapsed) { hide(o, o); return; }
    const inner = ch.reduce((s, c) => s + subH(c, d + 1), 0) + Math.max(0, ch.length - 1) * 12;
    let yy = yTop + (tot - inner) / 2;
    ch.forEach((c, i) => { place(c, d + 1, o.x + w + (d === 0 ? 84 : 58), yy, d === 0 ? BRANCH[i % BRANCH.length] : color); yy += subH(c, d + 1) + 12; });
  };
  // une racine : là où on l'a posée ; un nœud sans racine atteignable (une boucle) fait racine
  const roots = [...byId.values()].filter((n) => !n.parent || !byId.has(n.parent) || n.parent === n.id);
  for (const r of roots) place(r, 0, r.x, r.y - subH(r, 0) / 2 + hOf(0) / 2, 'or');
  for (const n of byId.values()) if (!seen.has(n.id)) place(n, 0, n.x, n.y - subH(n, 0) / 2 + hOf(0) / 2, 'or');
  return { info, folded };
}

// ── le dessin ──────────────────────────────────────────────────
export function buildMind(app, n, I) {
  I = I || { depth: 0, color: 'or', kids: 0 };
  // de loin, la racine dit son nombre de branches (« LUMIÈRE · 5 », objets.css)
  const body = [el('span', { class: 'txt' + (n.text ? '' : ' ph'), 'data-n': I.depth === 0 && I.kids ? ` · ${I.kids}` : null }, n.text || PH)];
  if (I.kids) {
    // la pastille : le nombre d'enfants ; un clic replie (« +n ») ou déplie
    body.push(el('button', { class: 'mfold' + (n.collapsed ? ' on' : ''), type: 'button', title: n.collapsed ? `déplier (${I.kids} enfant${I.kids > 1 ? 's' : ''})` : 'replier la descendance',
      onclick: (e) => { e.stopPropagation(); const c = app.node(n.id); if (c) app.mutate(() => { c.collapsed = !c.collapsed; }); } }, n.collapsed ? `+${I.kids}` : String(I.kids)));
  }
  return { cls: ['m' + Math.min(I.depth, 2)], style: { '--k': `var(--${I.color})` }, body, noResize: true };
}
// les branches : des courbes du milieu droit du parent au bord gauche de l'enfant (au pied
// pour les rangs ≥ 2), 2,6 / 1,7 / 1,2 px d'écran ; dans la teinte du rameau
export function paintBranches(board, info, hidden, layer) {
  const { byId } = maps(board);
  if (!byId.size) return;
  const g = svg('g', { class: 'mbr' });
  for (const n of byId.values()) {
    if (!n.parent || hidden(n.id)) continue;
    const p = byId.get(n.parent), I = info.get(n.id);
    if (!p || !I) continue;
    const x1 = p.x + p.w, y1 = p.y + p.h / 2, x2 = n.x, y2 = n.y + (I.depth >= 2 ? n.h : n.h / 2), mx = (x1 + x2) / 2;
    g.append(svg('path', { d: `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, class: 'b' + Math.min(I.depth, 3), style: `stroke: var(--${I.color})` }));
  }
  layer.insertBefore(g, layer.firstChild ? layer.firstChild.nextSibling : null);
}

// ── les gestes ─────────────────────────────────────────────────
// Tab : un enfant ; Entrée : un frère (sur une racine : un enfant). Le nœud neuf est choisi, on y écrit.
export function addMind(app, o, child) {
  const { S } = app;
  o = o && app.node(o.id);
  if (!o || o.type !== 'mind') return null;
  const pid = child || !o.parent || !app.node(o.parent) ? o.id : o.parent;
  const p = app.node(pid);
  const n = { id: app.uid('n'), type: 'mind', parent: pid, x: p.x, y: p.y, w: 80, h: 36, text: '', collapsed: false };
  if (p.group) n.group = p.group;
  app.mutate((B) => {
    if (p.collapsed) p.collapsed = false;
    // un frère se range juste après ce nœud (l'ordre des frères est celui de la planche), un enfant en dernier
    if (pid === o.id) B.nodes.push(n); else B.nodes.splice(B.nodes.indexOf(o) + 1, 0, n);
    S.sel = new Set([n.id]); S.link = null; S.focus = n.group || null;
  });
  setTimeout(() => app.canvas.editText(n.id), 30);
  return n;
}
// une mind map neuve : sa racine
export const mindDefaults = () => ({ w: 120, h: 48, text: '', collapsed: false });

// « Convertir en mind map » : les notes, formes, cartes choisies deviennent une racine
// « Synthèse » au bord gauche de leur boîte et une branche chacune (texte coupé à 60
// signes) ; les objets d'origine s'en vont (un seul pas d'annulation)
export function toMind(app, list) {
  const src = list.filter((n) => ['note', 'sticky', 'title', 'shape', 'card'].includes(n.type));
  if (!src.length) return 'choisissez des notes, des post-it, des titres, des formes ou des cartes';
  const b = bbox(src);
  const S = app.S;
  // l'ordre de lecture : de haut en bas, de gauche à droite
  const order = [...src].sort((a, c) => (Math.abs(a.y - c.y) > 40 ? a.y - c.y : a.x - c.x));
  app.mutate((B) => {
    const root = { id: app.uid('n'), type: 'mind', x: Math.round(b.x), y: Math.round(b.y + b.h / 2 - 24), w: 120, h: 48, text: 'Synthèse', collapsed: false };
    const kids = order.map((o) => ({ id: app.uid('n'), type: 'mind', parent: root.id, x: root.x, y: root.y, w: 80, h: 36, collapsed: false,
      text: cut(o.text || (o.type === 'card' ? 'carte' : o.type === 'shape' ? 'forme' : 'idée'), 60) }));
    const kill = new Set(src.map((o) => o.id));
    B.nodes = [...B.nodes.filter((n) => !kill.has(n.id)), root, ...kids];
    B.links = B.links.filter((l) => !kill.has(l.a) && !kill.has(l.b));
    S.sel = new Set([root.id]); S.link = null; S.focus = null;
  });
  return '';
}

export function mindMenu(app, n, I) {
  const kids = I?.kids || 0;
  return [
    { label: 'Écrire', key: 'double-clic', onclick: () => app.canvas.editText(n.id) },
    { label: 'Ajouter un enfant', key: 'Tab', onclick: () => addMind(app, n, true) },
    { label: n.parent ? 'Ajouter un frère' : 'Ajouter un enfant', key: 'Entrée', onclick: () => addMind(app, n, false) },
    { label: n.collapsed ? `Déplier (+${kids})` : 'Replier la descendance', disabled: !kids, why: 'ce nœud n’a pas d’enfant', onclick: () => { const c = app.node(n.id); if (c) app.mutate(() => { c.collapsed = !c.collapsed; }); } },
    { label: 'Choisir tout l’arbre', onclick: () => app.select(treeOf(app.S.board, n).map((m) => m.id)) },
  ];
}

export function mindPanel(app, n, I, K) {
  const { card, row, hint, b } = K;
  const f = el('input', { class: 'fld', value: n.text || '', maxlength: 300, placeholder: 'le nom du nœud' });
  let ch = () => {};
  f.addEventListener('focus', () => { ch = app.editing(); });
  f.addEventListener('input', () => { ch(); const c = app.node(n.id); if (c) c.text = f.value.replace(/\s+/g, ' '); app.canvas.renderSoon(); });
  f.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); f.blur(); addMind(app, n, e.key === 'Tab'); } });
  const kids = I?.kids || 0;
  const depth = I?.depth || 0;
  return [card('Mind map', depth ? `rang ${depth}${kids ? ` · ${kids} enfant${kids > 1 ? 's' : ''}` : ''}` : `racine${kids ? ` · ${kids} branche${kids > 1 ? 's' : ''}` : ''}`, f,
    row(b('+ Enfant', () => addMind(app, n, true), { title: 'Tab' }), b(n.parent ? '+ Frère' : '+ Branche', () => addMind(app, n, false), { title: 'Entrée' }),
      kids ? b(n.collapsed ? `Déplier (+${kids})` : 'Replier', () => { const c = app.node(n.id); if (c) app.mutate(() => { c.collapsed = !c.collapsed; }); }) : null),
    hint('Tab : un enfant · Entrée : un frère (même en écrivant) · la pastille à droite replie. Déplacer un nœud déplace l’arbre ; supprimer emporte la descendance. La couleur est celle du rameau.'))];
}
