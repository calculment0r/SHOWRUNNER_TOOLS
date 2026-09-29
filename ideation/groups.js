// IDÉATION — les groupes (l'étude : docs/etudes/ideation_miro.md § 3).
//
// Deux conteneurs seulement, chacun sa règle : le CADRE est une zone du plan
// (ce qui est entièrement dedans lui appartient, il sert la présentation et
// l'export) ; le GROUPE est une appartenance, écrite sur l'enfant (`group`),
// qui sert la mise en forme et le repli. Un nœud `type: 'group'` porte le nom
// et la mise en forme ; il n'a pas de liste d'enfants (une seule vérité) :
//
//   { id, type: 'group', name, x, y, w, h, collapsed, lod,
//     layout: { mode: 'free' | 'flow', width, gap, fit: '' | 'h' | 'w' } }
//   { id, type: 'media', …, group: 'g1' }            coordonnées absolues
//
// Pas de groupes imbriqués (un groupe n'a pas de `group`), pas de cadre dans
// un groupe ; un groupe sans enfant disparaît, un groupe à un enfant se dissout
// (tldraw). L'ordre des enfants est leur ordre d'empilement dans `nodes`.
// Déplié, la boîte d'un groupe est celle de ses enfants + 24 px (refaite à
// chaque rendu, comme la hauteur des notes : ce n'est pas un geste) ; réduit,
// c'est une carte de 280 px posée au coin de la boîte, les enfants gardent
// leurs places (déplacer la carte les emmène, déplier les remet).
//
// Le serveur (server/tools/ideation.py, normalize) tient les mêmes règles.
// Ici : la mise en forme (pure), les ports d'un groupe réduit (les fils qui
// traversent sa frontière, comme un sous-graphe de ComfyUI), et les gestes de
// l'app (grouper, dégrouper, réduire, lâcher un objet sur un autre).

import { toast } from '../commun/shell.js';
import { KINDS, portOf, nameOf } from './ports.js';
import { treeOf, withTrees, asRoots } from './objets/mindmap.js';

export const PAD = 24;        // la boîte d'un groupe déplié : ses enfants + 24 px
export const GAP = 24;        // l'espacement par défaut d'une rangée (px du monde)
export const CARD_W = 280;    // un groupe réduit : une carte de 280 px de large
export const LOD_PX = 240;    // « se réduit de loin » : une carte quand sa boîte fait moins de 240 px à l'écran
export const EXIT = 32;       // un enfant lâché à plus de 32 px hors de la boîte en sort (tldraw onDragShapesOut)
const CARDS = new Set(['gen', 'vgen', 'compose']);
const AUTO = new Set(['note', 'sticky', 'title', 'gen', 'vgen', 'compose']);   // leur hauteur suit leur contenu (canvas.js, AUTO_H)
const keeps = (n) => (n.type === 'media' && n.kind !== 'audio') || n.type === 'ink';   // une image, un trait gardent leurs proportions
const minW = (n) => (CARDS.has(n.type) ? 270 : n.type === 'frame' ? 120 : 48);

export const isGroup = (n) => n?.type === 'group';
export function bboxOf(list) {
  if (!list.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of list) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
// les enfants de chaque groupe, dans l'ordre de la planche
export function kidsMap(B) {
  const m = new Map();
  for (const n of B?.nodes || []) {
    if (!n.group) continue;
    let a = m.get(n.group);
    if (!a) m.set(n.group, (a = []));
    a.push(n);
  }
  return m;
}
export const kidsOf = (B, gid) => (B?.nodes || []).filter((n) => n.group === gid);
export const layoutOf = (g) => ({ mode: 'free', width: 0, gap: GAP, fit: '', ...(g?.layout || {}) });
// l'ordre de lecture : par rangées (40 px de tolérance), de gauche à droite (app.tidy)
export const readingOrder = (list) => [...list].sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x));

// ── la mise en forme ──────────────────────────────────────────
// même hauteur / même largeur (PureRef, « Normalize Height / Width ») : une
// image garde ses proportions (l'autre côté suit) ; une note, un post-it, une
// carte : leur hauteur suit leur texte, seule leur largeur se règle
export function setSize(n, axis, v) {
  if (n.type === 'mind') return;   // un nœud de mind map prend la taille de son nom
  if (axis === 'h') {
    if (AUTO.has(n.type) || n.type === 'frame' || n.type === 'group') return;
    if (keeps(n) && n.h > 0) n.w = Math.max(16, Math.round(v * n.w / n.h));
    n.h = Math.max(16, Math.round(v));
  } else {
    if (n.type === 'frame' || n.type === 'group') return;
    const w = Math.max(minW(n), Math.round(v));
    if (keeps(n) && n.w > 0) n.h = Math.max(16, Math.round(w * n.h / n.w));
    n.w = w;
  }
}
// la rangée : à la suite, à la ligne quand la largeur est atteinte, alignés en haut
export function flowAt(list, ox, oy, width, gap) {
  const W = Math.max(width || 0, ...list.map((k) => k.w));
  let x = ox, y = oy, row = 0;
  for (const k of list) {
    if (x > ox && x + k.w > ox + W + 0.5) { x = ox; y += row + gap; row = 0; }
    k.x = Math.round(x); k.y = Math.round(y);
    x += k.w + gap;
    row = Math.max(row, k.h);
  }
}
// le nombre de colonnes d'une rangée d'objets de même largeur (le repère de la poignée)
export function columns(kids, width, gap) {
  if (!kids.length || kids.some((k) => Math.abs(k.w - kids[0].w) > 1)) return 0;
  return Math.max(1, Math.min(kids.length, Math.floor((Math.max(width, kids[0].w) + gap + 0.5) / (kids[0].w + gap))));
}
export function fitBox(g, kids) {
  const b = bboxOf(kids);
  if (!b) return;
  g.x = Math.round(b.x - PAD); g.y = Math.round(b.y - PAD);
  g.w = Math.round(b.w + 2 * PAD); g.h = Math.round(b.h + 2 * PAD);
}
const sig = (kids) => kids.map((k) => `${k.x},${k.y},${k.w},${k.h}`).join('|');
// un groupe déplié se remet en forme : même taille (d'après le premier), puis la
// rangée depuis son coin ; sa boîte suit. Rend true si un enfant a bougé.
export function arrange(g, kids) {
  if (!kids.length) return false;
  const L = layoutOf(g);
  const before = sig(kids);
  const sized = kids.filter((k) => k.type !== 'mind');
  if (L.fit && sized.length > 1) {
    const ref = L.fit === 'h' ? sized[0].h : sized[0].w;
    for (const k of sized.slice(1)) setSize(k, L.fit, ref);
  }
  if (L.mode === 'flow') {
    // une mind map se range d'un bloc (sa boîte), ses nœuds suivent (objets/mindmap.js les place depuis leur racine)
    const blocks = blocksOf(kids);
    flowAt(blocks, g.x + PAD, g.y + PAD, L.width, L.gap);
    for (const b of blocks) {
      const dx = b.x - b.x0, dy = b.y - b.y0;
      if (dx || dy) for (const m of b.members) { m.x = Math.round(m.x + dx); m.y = Math.round(m.y + dy); }
    }
  }
  fitBox(g, kids);
  return sig(kids) !== before;
}
// les unités d'une rangée : un objet, ou une mind map entière (tous ses nœuds dans la boîte de l'arbre)
function blocksOf(kids) {
  const out = [], trees = new Map();
  const byId = new Map(kids.map((k) => [k.id, k]));
  for (const k of kids) {
    if (k.type !== 'mind') { out.push({ x: k.x, y: k.y, w: k.w, h: k.h, x0: k.x, y0: k.y, members: [k] }); continue; }
    let r = k;
    for (let i = 0; i < kids.length && r.parent && byId.get(r.parent)?.type === 'mind'; i++) r = byId.get(r.parent);
    let b = trees.get(r.id);
    if (!b) { b = { members: [] }; trees.set(r.id, b); out.push(b); }
    b.members.push(k);
  }
  for (const b of trees.values()) { const bb = bboxOf(b.members); Object.assign(b, bb, { x0: bb.x, y0: bb.y }); }
  return out;
}
// tous les groupes dépliés (un groupe réduit ne bouge pas : sa carte garde sa place)
export function layoutAll(B) {
  const K = kidsMap(B);
  let moved = false;
  for (const g of B?.nodes || []) {
    if (g.type !== 'group' || g.collapsed) continue;
    const kids = K.get(g.id);
    if (kids?.length) moved = arrange(g, kids) || moved;
  }
  return moved;
}
// la structure, après chaque geste : une appartenance vers un groupe absent tombe ;
// ni groupe ni cadre dans un groupe ; un groupe de moins de deux enfants se
// dissout (ses liens avec lui) — la même règle que le serveur
export function tidy(B) {
  if (!B) return false;
  const byId = new Map(B.nodes.map((n) => [n.id, n]));
  let changed = false;
  // une mind map est tout entière dans le groupe de sa racine (le serveur tient la même règle)
  const root = (n) => { let r = n; for (let i = 0; i < B.nodes.length && r.parent && byId.get(r.parent)?.type === 'mind' && byId.get(r.parent) !== n; i++) r = byId.get(r.parent); return r; };
  for (const n of B.nodes) {
    if (n.type !== 'mind' || !n.parent) continue;
    const r = root(n);
    if (r !== n && (n.group || '') !== (r.group || '')) { if (r.group) n.group = r.group; else delete n.group; changed = true; }
  }
  for (const n of B.nodes) {
    if (!n.group) continue;
    const g = byId.get(n.group);
    if (!g || g.type !== 'group' || n.type === 'group' || n.type === 'frame' || n.group === n.id) { delete n.group; changed = true; }
  }
  const K = kidsMap(B);
  const gone = new Set();
  for (const g of B.nodes) {
    if (g.type !== 'group') continue;
    const kids = K.get(g.id) || [];
    if (kids.length < 2) { for (const k of kids) delete k.group; gone.add(g.id); }
  }
  if (gone.size) {
    B.nodes = B.nodes.filter((n) => !gone.has(n.id));
    B.links = B.links.filter((l) => !gone.has(l.a) && !gone.has(l.b));
    changed = true;
  }
  return changed;
}
// l'ordre des enfants : ils reprennent, dans cet ordre, les places qu'ils occupaient dans `nodes`
export function setOrder(B, gid, list) {
  const idx = [];
  B.nodes.forEach((n, i) => { if (n.group === gid) idx.push(i); });
  if (idx.length !== list.length) return;
  idx.forEach((i, k) => { B.nodes[i] = list[k]; });
}
// la place d'insertion dans une rangée, sous le pointeur (wx, wy) : l'indice parmi les autres enfants
export function slotAt(rest, wx, wy) {
  if (!rest.length) return 0;
  // la rangée du pointeur (celle dont il est le plus près en hauteur), puis la première dont le centre est à sa droite
  let best = null;
  for (const k of rest) {
    const d = wy < k.y ? k.y - wy : wy > k.y + k.h ? wy - k.y - k.h : 0;
    if (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && k.y < best.k.y)) best = { d, k };
  }
  const rowY = best.k.y;
  const row = rest.map((k, i) => [k, i]).filter(([k]) => Math.abs(k.y - rowY) < 1);
  for (const [k, i] of row) if (wx < k.x + k.w / 2) return i;
  return row[row.length - 1][1] + 1;
}

// ── les ports d'un groupe réduit ──────────────────────────────
// chaque fil `wire` qui traverse la frontière : `a` dedans, `b` dehors → une
// sortie ; `a` dehors, `b` dedans → une entrée. Un port par couple (objet
// intérieur, port) ; rangés dans l'ordre vertical des objets intérieurs.
export function crossing(B, inside) {
  const ins = new Map(), outs = new Map();
  for (const l of B?.links || []) {
    if (l.kind !== 'wire') continue;
    const ai = inside.has(l.a), bi = inside.has(l.b);
    if (ai === bi) continue;
    const [map, inner, port] = ai ? [outs, l.a, l.pa] : [ins, l.b, l.pb];
    const k = `${inner}|${port}`;
    if (!map.has(k)) map.set(k, { key: k, inner, port, links: [] });
    map.get(k).links.push(l);
  }
  const byId = new Map((B?.nodes || []).map((n) => [n.id, n]));
  const order = (a, b) => { const p = byId.get(a.inner), q = byId.get(b.inner); return (p?.y ?? 0) - (q?.y ?? 0) || (p?.x ?? 0) - (q?.x ?? 0); };
  return { ins: [...ins.values()].sort(order), outs: [...outs.values()].sort(order) };
}
// l'étiquette d'un port : « nom de l'objet · port »
export function portLabel(app, p, side) {
  const n = app.node(p.inner);
  const what = side === 'out' ? KINDS[p.port]?.label || p.port : portOf(n, p.port, app.caps())?.label || p.port;
  const nm = String(app.label(n) || nameOf(n)).replace(/^Générer (image|vidéo) · /, '');
  return `${nm.length > 18 ? nm.slice(0, 17) + '…' : nm} · ${what}`;
}

// ── les gestes ────────────────────────────────────────────────
export function createGroups(app) {
  const { S } = app;
  const B = () => S.board;
  const node = (id) => app.node(id);
  // les unités choisies : un groupe (avec ses enfants), un objet seul, un enfant choisi dans son groupe ouvert
  const units = () => [...S.sel].map(node).filter(Boolean);
  // une liste d'unités et les enfants de leurs groupes
  function expand(list) {
    const out = new Map();
    for (const n of list) {
      out.set(n.id, n);
      if (n.type === 'group') for (const k of kidsOf(B(), n.id)) out.set(k.id, k);
    }
    return [...out.values()];
  }
  // déplacer une unité : un groupe emmène ses enfants
  function shift(n, dx, dy) {
    if (!dx && !dy) return;
    // un groupe emmène ses enfants ; un nœud de mind map, son arbre
    const list = n.type === 'group' ? [n, ...kidsOf(B(), n.id)] : n.type === 'mind' ? treeOf(B(), n) : [n];
    for (const m of list) { m.x = Math.round(m.x + dx); m.y = Math.round(m.y + dy); }
  }
  const count = () => B().nodes.filter((n) => n.type === 'group').length;
  function make(kids, { flow = false, name = '' } = {}) {
    const g = { id: app.uid('g'), type: 'group', name: name || `Groupe ${count() + 1}`, x: 0, y: 0, w: 0, h: 0, collapsed: false, lod: false,
      layout: { mode: flow ? 'flow' : 'free', width: 0, gap: GAP, fit: '' } };
    for (const k of kids) k.group = g.id;
    fitBox(g, kids);
    g.layout.width = Math.max(0, g.w - 2 * PAD);
    // le nœud du groupe se range juste avant son premier enfant (l'empilement de la carte réduite)
    const first = Math.min(...kids.map((k) => B().nodes.indexOf(k)));
    B().nodes.splice(Math.max(0, first), 0, g);
    return g;
  }
  // ce qui empêche de grouper la sélection ('' : rien)
  function whyNot(list = units()) {
    const u = list.filter((n) => n.type !== 'frame');
    const gs = u.filter((n) => n.type === 'group');
    if (gs.length > 1) return 'un groupe ne se met pas dans un groupe : dégroupez d’abord';
    if (u.length < 2) return list.some((n) => n.type === 'frame') ? 'un cadre n’entre pas dans un groupe (c’est une zone) : choisissez des objets' : 'choisissez au moins deux objets';
    return '';
  }
  // ctrl+G : grouper la sélection ; le groupe garde les places (libre). Un seul groupe
  // dans la sélection : les autres objets le rejoignent.
  function group() {
    if (!B()) return null;
    const list = units();
    const why = whyNot(list);
    if (why) { toast(why, 5000); return null; }
    let g = null;
    app.mutate(() => {
      const u = list.filter((n) => n.type !== 'frame');
      const host = u.find((n) => n.type === 'group');
      // un nœud de mind map entre avec tout son arbre
      const loose = withTrees(B(), u.filter((n) => n.type !== 'group'));
      if (host) {
        const L = layoutOf(host);
        const kids = kidsOf(B(), host.id);
        // en rangée, ils arrivent à la fin, dans l'ordre de lecture ; libres, ils restent où ils sont
        const add = L.mode === 'flow' ? readingOrder(loose) : loose;
        for (const n of add) { n.group = host.id; B().nodes.splice(B().nodes.indexOf(n), 1); B().nodes.splice(B().nodes.indexOf(kids[kids.length - 1]) + 1, 0, n); kids.push(n); }
        g = host;
      } else g = make(loose);
      S.sel = new Set([g.id]); S.focus = null; S.link = null;
    });
    return g;
  }
  // ctrl+maj+G : dégrouper ; les enfants restent où ils sont, choisis
  function ungroup(ids = null) {
    if (!B()) return;
    const gs = new Set();
    for (const n of ids ? ids.map(node).filter(Boolean) : units()) {
      if (n.type === 'group') gs.add(n.id);
      else if (n.group) gs.add(n.group);
    }
    if (!gs.size) { toast('choisissez un groupe'); return; }
    app.mutate(() => {
      const free = [];
      for (const n of B().nodes) if (n.group && gs.has(n.group)) { delete n.group; free.push(n.id); }
      B().nodes = B().nodes.filter((n) => !gs.has(n.id));
      B().links = B().links.filter((l) => !gs.has(l.a) && !gs.has(l.b));
      S.sel = new Set(free); S.focus = null; S.link = null;
    });
  }
  // réduire : une carte ; déplier : les enfants reviennent autour de son coin
  function collapse(gid, on = true) {
    const g = node(gid);
    if (!g || g.type !== 'group') return;
    app.mutate(() => {
      // la carte au coin de la boîte ; sa hauteur suit son contenu (mesurée au rendu)
      if (on) { fitBox(g, kidsOf(B(), gid)); g.collapsed = true; g.w = CARD_W; g.h = 160; }
      else g.collapsed = false;
      S.sel = new Set([gid]); S.focus = null;
    });
  }
  const setLayout = (gid, patch) => {
    const g = node(gid);
    if (!g) return;
    app.mutate(() => { g.layout = { ...layoutOf(g), ...patch }; });
  };
  // libre → rangée : dans l'ordre de lecture, à la largeur qu'il a (la disposition ne saute pas)
  function flow(gid, on = true) {
    const g = node(gid);
    if (!g) return;
    app.mutate(() => {
      const L = layoutOf(g);
      if (on && L.mode !== 'flow') {
        setOrder(B(), gid, readingOrder(kidsOf(B(), gid)));
        g.layout = { ...L, mode: 'flow', width: Math.max(0, g.w - 2 * PAD) };
      } else if (!on) g.layout = { ...L, mode: 'free' };
    });
  }
  // même hauteur / même largeur : sur un groupe, elle reste (un second clic la retire)
  const fit = (gid, axis) => { const g = node(gid); if (g) setLayout(gid, { fit: layoutOf(g).fit === axis ? '' : axis }); };
  const gap = (gid, d) => { const g = node(gid); if (g) setLayout(gid, { gap: Math.max(0, Math.min(200, layoutOf(g).gap + d)) }); };
  const rename = (gid, name) => { const g = node(gid); if (g && name.trim() && name.trim() !== g.name) app.mutate(() => { g.name = name.trim().slice(0, 120); }); };
  const lod = (gid) => { const g = node(gid); if (g) app.mutate(() => { g.lod = !g.lod; }); };

  // ── un objet lâché sur un autre : un groupe (après les règles de app.dropRules) ──
  // Pour que ce ne soit jamais un accident : l'objet sous le pointeur, après un
  // court arrêt, s'entoure du filet orange « GROUPER » ; Alt pose par-dessus.
  function plan(mv, t) {
    const u = units().filter((n) => n.type !== 'frame');
    if (!u.length || units().some((n) => n.type === 'frame')) return null;
    if (u.some((n) => n.id === t.id || (t.group && n.id === t.group))) return null;
    const host = t.type === 'group' ? t : t.group ? node(t.group) : null;
    const gs = u.filter((n) => n.type === 'group');
    if (gs.length > 1 || (host && gs.length)) return null;          // pas de groupe dans un groupe
    if (host) return { kind: 'join', host, loose: u };
    if (gs.length) return { kind: 'take', host: gs[0], loose: u.filter((n) => n.type !== 'group'), t };
    return { kind: 'new', loose: u, t };
  }
  const rule = {
    name: 'grouper', cls: 'drop-grp', tag: 'GROUPER', dwell: 260,
    test: (mv, t) => {
      const p = t && plan(mv, t);
      if (!p) return '';
      if (p.kind === 'join') return `lâcher : dans le groupe « ${p.host.name || 'groupe'} » — Alt : poser par-dessus`;
      if (p.kind === 'take') return `lâcher : « ${app.label(t)} » entre dans le groupe « ${p.host.name} » — Alt : poser par-dessus`;
      return 'lâcher : un groupe, les objets rangés à droite — Alt : poser par-dessus';
    },
    run: (mv, t) => {
      const p = plan(mv, t);
      if (!p) { app.commit(); return; }
      const nodes = B().nodes;
      const moveAfter = (list, anchor) => {
        let at = nodes.indexOf(anchor);
        for (const n of list) { nodes.splice(nodes.indexOf(n), 1); at = nodes.indexOf(anchor) + 1 + list.indexOf(n); nodes.splice(at, 0, n); }
      };
      // à droite de la cible, alignés en haut (ce qu'on glissait, dans son ordre) ; une mind map
      // s'y range par sa racine (son arbre suit) et entre tout entière dans le groupe
      const toRight = (list, from) => { let x = from.x + from.w + GAP; for (const n of asRoots(B(), list)) { shift(n, x - n.x, from.y - n.y); x += n.w + GAP; } };
      const all = (list) => withTrees(B(), list);
      let g;
      if (p.kind === 'new') {
        const loose = p.loose.filter((n) => n.type !== 'group');
        toRight(loose, t);
        const tt = t.type === 'mind' ? treeOf(B(), t) : [t];
        const moved = all(loose).filter((n) => !tt.includes(n));
        moveAfter(moved, tt[tt.length - 1]);
        g = make([...tt, ...moved], { flow: true });
        g.layout.width = Math.max(0, g.w - 2 * PAD);
      } else if (p.kind === 'join') {
        g = p.host;
        const kids = kidsOf(B(), g.id);
        const anchor = t.type === 'group' ? kids[kids.length - 1] : t;
        if (layoutOf(g).mode !== 'flow') toRight(p.loose, t.type === 'group' ? bboxOf(kids) : t);
        const loose = all(p.loose);
        for (const n of loose) n.group = g.id;
        moveAfter(loose, anchor);
      } else {
        g = p.host;
        const kids = kidsOf(B(), g.id);
        if (layoutOf(g).mode !== 'flow') toRight([t, ...p.loose], bboxOf(kids));
        const loose = all([t, ...p.loose]);
        for (const n of loose) n.group = g.id;
        moveAfter(loose, kids[kids.length - 1]);
      }
      S.sel = new Set([g.id]); S.focus = null; S.link = null;
      app.commit();
      toast(p.kind === 'new' ? 'un groupe : la barre au-dessus le met en forme — ctrl+Z le défait' : `dans le groupe « ${g.name} » — ctrl+Z le défait`);
    },
  };
  return { units, expand, shift, whyNot, group, ungroup, collapse, flow, fit, gap, rename, lod, setLayout, rule, make };
}
