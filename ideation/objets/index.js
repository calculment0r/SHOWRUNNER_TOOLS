// IDÉATION · OBJETS — les objets d'atelier du prototype de Cal qui manquaient
// (l'étude : docs/etudes/ideation_atelier.md § 3) : formes (R), cartes tâche,
// lien, mesure, personne (K), mind map (B), crayon (D) ; convertir une
// sélection en mind map, regrouper les post-it par couleur, les guides
// magnétiques, les poignées et « créer et relier », les modèles d'atelier de film.
//
// Le canvas (canvas.js), l'app (ideation.js), les menus (menus.js),
// l'inspecteur (inspector.js), la sélection (selection.js) et les groupes
// (groups.js) passent par `app.objets` :
//   TYPES, has(type), defs                  les sortes neuves et leurs réglages par défaut
//   build(n) → { cls, style, body, noResize }   le dessin d'un objet (le canvas l'habille : .nd, data-id, poignée)
//   key(n)                                  ce qui, s'il change, refait l'objet
//   layout(board) · folded()                les mind maps rangées (avant les groupes) ; ce qu'un nœud replié cache
//   paint(layer)                            les branches des mind maps, les flèches en pointillé
//   writable(n) · editKey(n, ev)            écrire sur place ; Tab / Entrée dans un nœud de mind map
//   menu(n) · boardItems(wx, wy) · selectionItems(us) · linkItems(from, wx, wy)   les menus
//   panels(n, K)                            l'inspecteur
//   mini(n, tok)                            la couleur d'un objet dans la mini-carte
//   tree / subtrees / trees / roots         les arbres de mind map (déplacer, supprimer, grouper)
//   startInk(e, env) · snapper(env, ids)    le crayon ; les guides magnétiques
//   onKey(e) · mindKey(n, key)              les raccourcis
//   regroup() · toMind() · insert(id, cx, cy)   les gestes d'atelier
//   items(board)                            les objets de la bibliothèque à lire (les visages des cartes personne)

import { el, toast } from '../../commun/shell.js';
import { icon, WRITABLE, TO_MIND, ANNOT } from './commun.js';
import * as F from './formes.js';
import * as C from './cartes.js';
import * as M from './mindmap.js';
import * as I from './crayon.js';
import * as G from './guides.js';
import { regroup as regroupStickies } from './couleurs.js';
import { TEMPLATES, insertTemplate, TOOL_ICON as TPL_ICON } from './modeles.js';

if (!document.querySelector('link[data-ide-objets]')) {
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./objets.css', import.meta.url).href, 'data-ide-objets': '' }));
}

export const TYPES = new Set(['shape', 'card', 'mind', 'ink']);
export { ANNOT };
const MAGNET = 'M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4';
const TOOLS = { r: 'shape', k: 'card', b: 'mind', d: 'ink' };

export function createObjets(app) {
  const { S } = app;
  let L = { info: new Map(), folded: new Map() };   // la dernière mise en place des mind maps
  S.snap = app.LS('snap') !== false;
  let shapeKind = F.SHAPES[app.LS('shape-kind')] ? app.LS('shape-kind') : 'round';
  let cardKind = C.CARD_KINDS[app.LS('card-kind')] ? app.LS('card-kind') : 'task';
  const shapeColor = (kind) => app.LS('shape-color') || F.shapeDefaults(kind).color;

  const defs = {
    shape: () => ({ ...F.shapeDefaults(shapeKind), color: shapeColor(shapeKind) }),
    card: () => C.cardDefaults(cardKind),
    mind: () => M.mindDefaults(),
    ink: () => ({ w: 16, h: 16, pts: [0, 0, 1000, 1000], color: 'or', width: 2.2 }),
  };

  // ── le dessin ────────────────────────────────────────────
  function build(n) {
    if (n.type === 'shape') return F.buildShape(n);
    if (n.type === 'card') return C.buildCard(app, n);
    if (n.type === 'mind') return M.buildMind(app, n, L.info.get(n.id));
    if (n.type === 'ink') return I.buildInk(n);
    return null;
  }
  function key(n) {
    if (n.type === 'mind') return JSON.stringify(L.info.get(n.id) || null);
    if (n.type === 'card' && n.kind === 'person' && n.data?.item) { const it = S.items.get(n.data.item); return `|${it ? (it.missing ? 'x' : it.thumb_url || it.url || '') : '?'}`; }
    return '';
  }
  function layout(board) { L = M.mindLayout(board); return L; }
  function paint(layer) {
    if (!S.board) return;
    M.paintBranches(S.board, L.info, (id) => !!app.canvas.hiddenIn(id), layer);
    for (const l of S.board.links) if (l.dash) layer.querySelector(`g[data-link="${CSS.escape(l.id)}"]`)?.classList.add('dash');
  }
  const mini = (n, tok) => (n.type === 'mind' ? tok(L.info.get(n.id)?.color || 'or') : tok(n.color || 'ink3'));

  // ── poser ────────────────────────────────────────────────
  // une forme ou une carte : centrée sur le point ; une racine de mind map : son bord gauche au point
  function place(type, wx, wy, preset = null, opts = {}) {
    const p = { ...(preset || {}) };
    if (type === 'shape') Object.assign(p, { ...F.shapeDefaults(p.kind || shapeKind), color: shapeColor(p.kind || shapeKind) }, preset || {});
    if (type === 'card') Object.assign(p, C.cardDefaults(p.kind || cardKind), preset || {});
    return app.addAt(type, wx, wy, { preset: p, at: type === 'mind' ? 'left' : 'center', select: true, edit: type === 'shape' || type === 'mind', ...opts });
  }

  // ── les menus ────────────────────────────────────────────
  function menu(n) {
    if (n.type === 'shape') return F.shapeMenu(app, n);
    if (n.type === 'card') return C.cardMenu(app, n);
    if (n.type === 'mind') return M.mindMenu(app, n, L.info.get(n.id));
    if (n.type === 'ink') return I.inkMenu(app, n);
    return [];
  }
  function boardItems(wx, wy) {
    return [
      { label: 'Forme', key: 'R', items: F.SHAPE_KINDS.map((k) => ({ label: F.SHAPES[k].name, onclick: () => place('shape', wx, wy, { kind: k }) })) },
      { label: 'Carte', key: 'K', items: C.CARD_ORDER.map((k) => ({ label: C.CARD_KINDS[k].name, onclick: () => place('card', wx, wy, { kind: k }) })) },
      { label: 'Mind map', key: 'B', onclick: () => place('mind', wx, wy) },
      { label: 'Modèle', items: TEMPLATES.map((t) => ({ label: t.name, title: t.desc, onclick: () => insertTemplate(app, t.id, wx, wy) })) },
    ];
  }
  function selectionItems(us) {
    const flat = app.groups.expand(us);
    const st = flat.filter((n) => n.type === 'sticky');
    const conv = flat.filter((n) => TO_MIND.has(n.type));
    return [st.length >= 2 ? { label: 'Regrouper par couleur', sub: `${st.length} post-it`, onclick: () => regroupStickies(app) } : null,
      conv.length ? { label: 'Convertir en mind map', sub: `${conv.length} objet${conv.length > 1 ? 's' : ''}`, onclick: () => toMind() } : null];
  }
  // lâcher une poignée (ou une flèche de l'outil L) dans le vide : « créer et relier »
  function linkItems(from, wx, wy) {
    const src = app.node(from);
    const mk = (type, preset = null, edit = true) => () => app.addAt(type, wx, wy, { preset, at: 'left', edit, select: true, link: from });
    return [{ head: 'créer et relier' },
      { label: 'Note', key: 'N', onclick: mk('note') }, { label: 'Post-it', key: 'S', onclick: mk('sticky') }, { label: 'Titre', key: 'T', onclick: mk('title') },
      { label: 'Forme', key: 'R', onclick: mk('shape', { ...F.shapeDefaults('round'), color: shapeColor('round') }) },
      { label: 'Décision', onclick: mk('shape', F.shapeDefaults('diamond')) },
      { label: 'Carte tâche', key: 'K', onclick: mk('card', C.cardDefaults('task'), false) },
      src?.type === 'mind' ? { label: 'Nœud de mind map', sub: 'un enfant', key: 'Tab', onclick: () => M.addMind(app, src, true) }
        : { label: 'Nœud de mind map', key: 'B', onclick: mk('mind', M.mindDefaults()) }];
  }

  // ── l'inspecteur ─────────────────────────────────────────
  function panels(n, K) {
    if (n.type === 'shape') return F.shapePanel(app, n, K);
    if (n.type === 'card') return C.cardPanel(app, n, K);
    if (n.type === 'mind') return M.mindPanel(app, n, L.info.get(n.id), K);
    if (n.type === 'ink') return I.inkPanel(app, n, K);
    return [];
  }

  // ── écrire sur place ─────────────────────────────────────
  const writable = (n) => !!n && WRITABLE.has(n.type);
  // une touche pendant qu'on écrit : Tab et Entrée dans un nœud de mind map finissent et
  // ajoutent un enfant, un frère ; Entrée finit le titre d'une carte. Rend true si elle est prise.
  function editKey(n, ev, finish) {
    if (n.type === 'mind' && (ev.key === 'Tab' || (ev.key === 'Enter' && !ev.shiftKey))) {
      ev.preventDefault();
      finish();
      setTimeout(() => M.addMind(app, app.node(n.id), ev.key === 'Tab'), 20);
      return true;
    }
    if (n.type === 'card' && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); finish(); return true; }
    return false;
  }
  // un nœud de mind map tient sur une ligne
  const cleanText = (n, t) => (n.type === 'mind' ? t.replace(/\s+/g, ' ') : t);

  // ── les raccourcis ───────────────────────────────────────
  function onKey(e) {
    const t = TOOLS[e.key.toLowerCase()];
    if (!t) return false;
    pickTool(t, true);
    return true;
  }
  function mindKey(n, k) {
    if (n?.type !== 'mind' || (k !== 'Tab' && k !== 'Enter')) return false;
    M.addMind(app, n, k === 'Tab');
    return true;
  }
  // un outil ; la forme et la carte ouvrent leur grille de choix sous leur bouton
  function pickTool(t, fromKey = false) {
    app.setTool(t);
    if (t === 'shape' || t === 'card') openSub(t, fromKey);
    else closeSub();
  }

  // ── la barre : quatre outils, et la grille des formes et des cartes ──
  let sub = null;
  const outside = (e) => { if (sub && !sub.contains(e.target) && !e.target.closest?.('[data-tool="shape"], [data-tool="card"]')) closeSub(); };
  // Échap : la grille se ferme et l'outil se repose (comme le prototype) ; la sélection reste
  const esc = (e) => { if (e.key === 'Escape' && sub) { e.stopPropagation(); closeSub(); app.setTool('select'); } };
  function closeSub() {
    if (!sub) return;
    sub.remove(); sub = null;
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', esc, true);
  }
  function openSub(kind) {
    const was = sub?.dataset.kind;
    closeSub();
    if (was === kind) return;
    const btn = document.querySelector(`.ide-bar [data-tool="${kind}"]`);
    if (!btn) return;
    const list = kind === 'shape' ? F.SHAPE_KINDS.map((k) => [k, F.SHAPES[k].name, F.shapeIcon(k), shapeKind === k])
      : C.CARD_ORDER.map((k) => [k, C.CARD_KINDS[k].name, C.cardIcon(k), cardKind === k]);
    sub = el('div', { class: 'ob-sub', role: 'menu', 'data-kind': kind, 'aria-label': kind === 'shape' ? 'les formes' : 'les cartes' },
      ...list.map(([k, name, ic, on]) => el('button', { class: 'ob-cell' + (on ? ' on' : ''), type: 'button', role: 'menuitem', title: `${name} — cliquer sur la planche pour la poser`,
        onclick: () => {
          if (kind === 'shape') { shapeKind = k; app.LS('shape-kind', k); } else { cardKind = k; app.LS('card-kind', k); }
          app.setTool(kind); closeSub();
        } }, ic, el('span', {}, name))));
    document.body.append(sub);
    const r = btn.getBoundingClientRect();
    sub.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - sub.offsetWidth / 2, innerWidth - sub.offsetWidth - 8))}px`;
    sub.style.top = `${r.bottom + 6}px`;
    setTimeout(() => { addEventListener('pointerdown', outside, true); addEventListener('keydown', esc, true); });
  }
  function mountTools() {
    const frame = document.querySelector('.ide-bar [data-tool="frame"]');
    if (!frame || document.querySelector('.ide-bar [data-tool="shape"]')) return;
    const mk = (tool, title, d) => {
      const b = el('button', { class: 'ic', type: 'button', 'data-tool': tool, title }, icon(d));
      // la forme et la carte : un clic ouvre aussi leur grille (le choix de la sorte)
      if (tool === 'shape' || tool === 'card') b.addEventListener('click', () => openSub(tool));
      return b;
    };
    frame.after(mk('shape', 'une forme : rectangle, arrondi, ellipse, décision, hexagone, données · R', F.TOOL_ICON),
      mk('card', 'une carte : tâche, lien, mesure, personne · K', C.TOOL_ICON),
      mk('mind', 'une mind map : Tab un enfant, Entrée un frère · B', M.TOOL_ICON),
      mk('ink', 'le crayon : un trait à main levée · D', I.TOOL_ICON));
  }

  // ── le coin bas gauche de la planche : les modèles, l'aimant ──
  let dock = null, tplBox = null;
  function mountDock() {
    const cv = app.canvas?.el;
    if (!cv || dock) return;
    const tpl = el('button', { class: 'ob-dk', type: 'button', title: 'des modèles d’atelier, posés au centre de la vue' }, icon(TPL_ICON), el('span', {}, 'Modèles'));
    const mag = el('button', { class: 'ob-dk mag', type: 'button' }, icon(MAGNET), el('span', {}));
    tpl.addEventListener('click', () => (tplBox ? closeTpl() : openTpl(tpl)));
    mag.addEventListener('click', () => setSnap(!S.snap));
    dock = el('div', { class: 'ob-dock' }, tpl, mag);
    for (const ev of ['pointerdown', 'dblclick', 'contextmenu']) dock.addEventListener(ev, (e) => { if (e.button !== 1) e.stopPropagation(); if (ev === 'contextmenu') e.preventDefault(); });
    cv.append(dock);
    paintDock();
  }
  function paintDock() {
    const mag = dock?.querySelector('.mag');
    if (!mag) return;
    mag.classList.toggle('on', !!S.snap);
    mag.lastChild.textContent = S.snap ? 'Aimant' : 'Libre';
    mag.title = S.snap ? 'l’aimant : bords et centres s’alignent en glissant (Alt : libre le temps d’un geste) — un clic : libre' : 'libre : rien ne s’aimante — un clic : l’aimant';
  }
  function setSnap(on) { S.snap = !!on; app.LS('snap', S.snap); paintDock(); }
  const tplOut = (e) => { if (tplBox && !tplBox.contains(e.target) && !dock.contains(e.target)) closeTpl(); };
  const tplEsc = (e) => { if (e.key === 'Escape' && tplBox) { e.stopPropagation(); closeTpl(); } };
  function openTpl(anchor) {
    closeTpl();
    tplBox = el('div', { class: 'ob-tpl', role: 'menu', 'aria-label': 'les modèles' }, el('span', { class: 'lbl' }, 'insérer au centre de la vue'),
      ...TEMPLATES.map((t) => el('button', { class: 'ob-tr', type: 'button', role: 'menuitem', onclick: () => { closeTpl(); insertTemplate(app, t.id, ...app.canvas.center()); } },
        el('b', {}, t.name), el('span', {}, t.desc))));
    for (const ev of ['pointerdown', 'dblclick', 'wheel']) tplBox.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    app.canvas.el.append(tplBox);
    const c = app.canvas.el.getBoundingClientRect(), r = anchor.getBoundingClientRect();
    tplBox.style.left = `${r.left - c.left}px`;
    tplBox.style.bottom = `${c.bottom - r.top + 8}px`;
    setTimeout(() => { addEventListener('pointerdown', tplOut, true); addEventListener('keydown', tplEsc, true); });
  }
  function closeTpl() {
    tplBox?.remove(); tplBox = null;
    removeEventListener('pointerdown', tplOut, true);
    removeEventListener('keydown', tplEsc, true);
  }

  // ── les guides magnétiques ───────────────────────────────
  // à l'appui : les repères des autres objets ; à chaque pas : le complément qui aimante
  function snapper(env, moving, box0) {
    if (!S.snap || !box0) return null;
    const T = G.targets(app, moving);
    if (!T.xs.length) return null;
    const paint = (g) => G.paintGuides(env.over, S.view, env.cv.clientWidth, env.cv.clientHeight, g);
    return {
      move(dx, dy, free) {
        if (free) { paint(null); return [dx, dy]; }
        const s = G.snap({ x: box0.x + dx, y: box0.y + dy, w: box0.w, h: box0.h }, T, G.SNAP_PX / S.view.z);
        paint(s.gx === null && s.gy === null ? null : s);
        return [dx + s.dx, dy + s.dy];
      },
      end() { paint(null); },
    };
  }

  // ── les gestes d'atelier ─────────────────────────────────
  function toMind() {
    const why = M.toMind(app, app.groups.expand([...S.sel].map((id) => app.node(id)).filter(Boolean)));
    toast(why || 'une mind map : Tab ajoute un enfant, Entrée un frère — ctrl+Z la défait', why ? 5000 : 4000);
  }
  const regroup = () => regroupStickies(app);
  const insert = (id, cx, cy) => insertTemplate(app, id, cx, cy);

  // les commandes de la palette ⌘K (atelier), quand elle est là
  let cmds = false;
  function commands() {
    const A = app.atelier;
    if (cmds || !A?.command) return;
    cmds = true;
    const sel = () => [...S.sel].map((id) => app.node(id)).filter(Boolean);
    A.command({ order: 62, label: 'Regrouper les post-it par couleur', sub: 'la sélection, sinon tous', run: regroup,
      when: () => (S.board?.nodes.filter((n) => n.type === 'sticky').length >= 2 ? true : 'il faut au moins deux post-it') });
    A.command({ order: 63, label: 'Convertir la sélection en mind map', run: toMind,
      when: () => (app.groups.expand(sel()).some((n) => TO_MIND.has(n.type)) ? true : 'choisissez des notes, des post-it, des formes ou des cartes') });
    for (const t of TEMPLATES) A.command({ order: 64, label: `Modèle : ${t.name}`, sub: t.desc, run: () => insert(t.id, ...app.canvas.center()) });
    A.command({ order: 65, label: 'Aimant : activer ou désactiver', sub: 'les guides magnétiques', run: () => { setSnap(!S.snap); toast(S.snap ? 'aimant : les bords et les centres s’alignent' : 'libre : rien ne s’aimante'); } });
  }

  function mount() { mountTools(); mountDock(); }
  // les objets de la bibliothèque qu'une planche montre hors des médias : les visages des cartes personne
  const items = (board) => (board?.nodes || []).filter((n) => n.type === 'card' && n.data?.item).map((n) => n.data.item);

  return {
    TYPES, has: (t) => TYPES.has(t), defs, build, key, layout, folded: () => L.folded, info: (id) => L.info.get(id), paint, mini,
    place, menu, boardItems, selectionItems, linkItems, panels, writable, editKey, cleanText,
    onKey, mindKey, pickTool, closeSub, mount, commands, items, snapper, setSnap,
    startInk: (e, env) => I.startInk(app, env, e),
    tree: (n) => M.treeOf(S.board, n), subtree: (n) => M.subtreeOf(S.board, n),
    trees: (list) => M.withTrees(S.board, list), subtrees: (list) => M.withSubtrees(S.board, list), roots: (list) => M.asRoots(S.board, list),
    rootOf: (n) => M.rootOf(S.board, n), addMind: (n, child) => M.addMind(app, n, child),
    regroup, toMind, insert, faceRule: () => C.faceRule(app), annot: (n) => !!n && ANNOT.has(n.type),
  };
}
