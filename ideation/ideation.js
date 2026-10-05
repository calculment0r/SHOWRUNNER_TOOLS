// IDÉATION — le canvas d'idéation du portail : des planches où Cal pose,
// rapproche et fait naître des idées visuelles (images, vidéos, sons,
// personnages, notes, post-it, cadres, cartes « Générer »), avant de
// passer aux outils de production. L'étude : docs/etudes/ideation.md.
//
// Ce module tient la planche : l'ouvrir, l'enregistrer seule (600 ms après
// le dernier geste, avec sa version : un autre onglet ne l'écrase pas en
// silence), annuler et rétablir, le clavier, le dépôt de fichiers, et les
// gestes qui touchent plusieurs objets. Le canvas (canvas.js, wires.js), la
// bibliothèque (library.js), l'inspecteur (inspector.js), les cartes
// (gen.js, video.js, composer.js) passent tous par `app`.
//
// Les fils (ports.js, la seule vérité de ce qui se branche) : `app.flow()`
// rend ce qui passe dans les fils de la planche, recalculé à chaque rendu
// (`app.flowNow()` le recalcule tout de suite) ; `app.caps()` les capacités
// lues chez les outils (Image : /api/image/models, Vidéo : /api/movie/options).
// Brancher : `app.wire(a, pa, b, pb)` (refuse en disant pourquoi), couper :
// `app.cutLink(id)`, détacher : `app.detach(id)`, nourrir une entrée d'objets
// de la bibliothèque : `app.feed(id, port, items)`. Un objet lâché sur un
// autre : `app.dropRules` (la première règle qui le prend), puis
// `app.dropLast` (le groupe : groups.js) — une règle ajoutée à la liste passe
// donc toujours avant le groupe.
//
// Les groupes (groups.js, l'étude ideation_miro.md) : la sélection porte des
// unités — un groupe (ses enfants viennent avec lui), un objet seul, ou un
// enfant choisi dans le groupe ouvert par un double-clic (`S.focus`).
// Supprimer, dupliquer, copier, aligner, ranger passent par ces unités.
//
// Les objets d'atelier (objets/, l'étude ideation_atelier.md § 3) : formes (R),
// cartes (K), mind map (B), crayon (D), et leurs gestes — `app.objets`. Un nœud
// de mind map compte pour tout son arbre quand on le déplace ou l'aligne, pour
// sa descendance quand on le supprime, le copie ou le duplique.

import { mountHeader, api, jobs, toast, el, $, href, fmtDate, uploadFile, pick, session, studioSeul, espace, espaceDocument, avecEspace, surEspace } from '../commun/shell.js';
import { lecteur } from '../commun/lecteur.js';
import { liseuse, nomDe } from '../commun/documents.js';   // LA liseuse d'un document (05/10)
import { menu } from '../commun/menu.js';
import { createCanvas, bbox, ready as viewsReady } from './canvas.js';
import { createGroups, tidy as tidyGroups, kidsOf, setSize, readingOrder, setOrder, layoutOf } from './groups.js';
import { createMenus } from './menus.js';
import { createGen } from './gen.js';
import { createVideo } from './video.js';
import { createComposer } from './composer.js';
import { createInspector } from './inspector.js';
import { createLibrary, cfElement } from './library.js';
import { installPlugins } from './plugins.js';
import { createObjets } from './objets/index.js';
import { flow, canWire, replaces, portOf, outPort, nameOf, newSlots, newSlot, TEXT_TYPES } from './ports.js';
import { installBar } from './barre.js';

mountHeader('ideation', { sub: 'planches · idées' });
// l'invité par un lien (core/auth.py, rôle « invite ») n'a que ses planches : la page ne
// montre pas ce que le portail lui ferme (planche neuve, bibliothèque, export, rendus, outils)
session().then((me) => { if (me?.user?.role === 'invite') document.body.classList.add('ide-guest'); });

const S = {
  meta: null, cfg: null, cfgError: '', mopts: null, moptsError: '', board: null, rev: 0,
  items: new Map(), jobs: new Map(),
  sel: new Set(), link: null, focus: null, tool: 'select', space: false, grid: true,
  view: { x: 0, y: 0, z: 1 },
  undo: [], redo: [], dirty: false, saving: null, again: false, conflict: false, clip: null,
};

function LS(k, v) {
  try {
    if (v === undefined) return JSON.parse(localStorage.getItem('ide-' + k) || 'null');
    localStorage.setItem('ide-' + k, JSON.stringify(v));
  } catch { /* stockage fermé : une commodité en moins */ }
  return null;
}
S.grid = LS('grid') !== false;

let seq = 0;
const app = {
  S, LS,
  uid: (p = 'n') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`,
  node: (id) => S.board?.nodes.find((n) => n.id === id) || null,
};

// ── les fils : ce que les outils disent de leurs modèles, ce qui passe ─────
app.caps = () => ({ image: S.cfg, movie: S.mopts });
let F = null;
app.flowNow = () => (F = flow(S.board || { nodes: [], links: [] }, app.caps(), S.items));
app.flow = () => F || app.flowNow();

// ── les libellés ───────────────────────────────────────────
app.label = (n) => {
  if (!n) return '?';
  const cut = (s, k = 42) => { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length > k ? s.slice(0, k - 1) + '…' : s; };
  if (n.type === 'media') return cut(S.items.get(n.item)?.title || n.title || n.item);
  if (n.type === 'frame') return cut(n.name || 'Cadre');
  if (n.type === 'group') return cut(n.name || 'Groupe');
  if (n.type === 'gen') return 'Générer image · ' + cut(app.flow().prompt(n.id)?.text || n.prompt || '—', 30);
  if (n.type === 'vgen') return 'Générer vidéo · ' + cut(app.flow().prompt(n.id)?.text || n.prompt || '—', 30);
  if (n.type === 'compose') return 'Composeur · ' + cut(app.flow().text(n.id) || '—', 30);
  if (n.type === 'palette') return 'Nuancier';
  if (n.type === 'ink') return 'Trait de crayon';
  return cut(n.text || { note: 'note vide', sticky: 'post-it vide', title: 'titre vide', shape: 'forme vide', card: 'carte sans titre', mind: 'nœud vide' }[n.type]);
};
app.kindLabel = (n) => (n.type === 'media' ? { image: 'image', video: 'vidéo', audio: 'son', element: 'élément', document: 'document' }[n.kind]
  : n.type === 'card' ? { task: 'tâche', link: 'lien', metric: 'mesure', person: 'personne' }[n.kind] || 'carte'
    : { note: 'note', sticky: 'post-it', title: 'titre', frame: 'cadre', group: 'groupe', gen: 'image', vgen: 'vidéo', compose: 'composeur', palette: 'nuancier',
      shape: 'forme', mind: 'mind map', ink: 'trait' }[n.type]);

// ── annuler, rétablir, enregistrer ─────────────────────────
// `pres` : le design de la présentation (les styles de texte, diapo/) — annulé comme le reste
const snapshot = () => JSON.stringify({ name: S.board.name, nodes: S.board.nodes, links: S.board.links, pres: S.board.pres ?? null });
app.snap = () => {
  if (!S.board) return;
  S.undo.push(snapshot());
  if (S.undo.length > 150) S.undo.shift();
  S.redo = [];
  paintUndo();
};
app.touch = () => { if (S.board) { S.dirty = true; scheduleSave(); } };
app.render = () => app.canvas.render();
app.selectionChanged = () => { app.canvas.paintSel(); app.insp.render(); paintBar(); };
// chaque geste finit ici : la structure des groupes se remet d'aplomb (un groupe
// de moins de deux enfants se dissout, groups.js tidy — la règle du serveur)
app.commit = () => { if (S.board && tidyGroups(S.board)) pruneSel(); app.touch(); app.canvas.render(); app.insp.render(); paintBar(); };
app.mutate = (fn) => { if (!S.board) return; app.snap(); fn(S.board); pruneSel(); app.commit(); };
// un changement qui n'est pas un geste de Cal (un travail qui avance) : ni annuler ni rétablir
app.quiet = (fn) => { if (!S.board) return; fn(S.board); app.touch(); app.canvas.render(); };
// un champ qu'on remplit : un seul pas d'annulation pour toute la saisie, et un commit
// quand elle se pose (0,6 s sans frappe) — chaque geste finit par un commit, que les
// modules greffés entendent (machine temporelle, collaboration)
let editT = 0;
app.editing = () => {
  let done = false;
  return () => {
    if (!done) { app.snap(); done = true; }
    app.touch();
    clearTimeout(editT);
    editT = setTimeout(() => { if (S.board) app.commit(); }, 600);
  };
};

function pruneSel() {
  const ids = new Set(S.board.nodes.map((n) => n.id));
  for (const id of [...S.sel]) if (!ids.has(id)) S.sel.delete(id);
  if (S.link && !S.board.links.some((l) => l.id === S.link)) S.link = null;
  pruneFocus();
}
// le groupe ouvert (double-clic sur un enfant) le reste tant qu'on choisit dedans
function pruneFocus() {
  if (!S.focus) return;
  const g = app.node(S.focus);
  if (!g || g.type !== 'group' || !S.sel.size || ![...S.sel].every((id) => app.node(id)?.group === S.focus)) S.focus = null;
}
function restore(json) {
  const o = JSON.parse(json);
  S.board.name = o.name; S.board.nodes = o.nodes; S.board.links = o.links;
  if (o.pres) S.board.pres = o.pres; else delete S.board.pres;
  $('#b-name').value = o.name;
  pruneSel();
  app.commit();
}
app.undoStep = () => { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); paintUndo(); };
// un geste repris sans rien changer (un objet de la planche lâché sur le champ de l'agent, qui revient à sa
// place : agent.js, app.dropOut) : son pas d'annulation s'en va
app.unsnap = () => { if (S.undo.length) { S.undo.pop(); paintUndo(); } };
app.redoStep = () => { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); paintUndo(); };
function paintUndo() { $('#b-undo').disabled = !S.undo.length; $('#b-redo').disabled = !S.redo.length; }

let saveT = 0;
function scheduleSave() { paintSave(); clearTimeout(saveT); saveT = setTimeout(flushSave, 600); }
async function flushSave() {
  clearTimeout(saveT);
  // collab : à plusieurs, les gestes partent en opérations (coedition.js) ; la planche entière reste le repli
  if (app.coed?.on()) return app.coed.save();
  if (!S.board || !S.dirty || S.conflict) return;
  if (S.saving) { S.again = true; return S.saving; }
  const b = S.board;
  const body = { name: b.name, v: b.v, nodes: b.nodes, links: b.links, pres: b.pres ?? null, base_rev: S.rev };
  S.dirty = false;
  paintSave();
  S.saving = api(`ideation/boards/${b.id}`, { method: 'POST', body }).then((r) => {
    if (S.board?.id === b.id) { S.rev = r.rev; b.updated = r.updated; b.rev = r.rev; }
    S.refused = '';   // ── idéation, 30/09 : un refus de Workspace levé ──
  }).catch((e) => {
    // ── idéation, 30/09 : un objet d'un autre Workspace (elements.check_doc, 409) n'est pas un
    // conflit de version : la phrase du serveur dit lequel et mène au rapatriement (règle 7) ;
    // la planche reste « modifiée », le prochain geste réessaie ──
    if (e.status === 409 && /Workspace/i.test(e.message || '')) { S.dirty = true; if (S.refused !== e.message) toast(e.message, 12000); S.refused = e.message; }
    // ── fin idéation ──
    else if (e.status === 409) { S.conflict = true; $('#conflict').hidden = false; }
    else { S.dirty = true; toast(`enregistrement impossible : ${e.message}`, 7000); }
  }).finally(() => {
    S.saving = null;
    paintSave();
    if (S.again) { S.again = false; if (S.dirty) flushSave(); }
  });
  return S.saving;
}
app.flushSave = flushSave;
app.paintSave = () => paintSave();   // collab : la co-édition dit où en sont ses envois
function paintSave() {
  const p = $('#save-st');
  const [cls, txt] = S.conflict ? ['err', 'conflit'] : S.refused && S.dirty ? ['err', 'refusée'] : S.saving ? ['work', 'enregistre'] : S.dirty ? ['work', 'modifiée'] : S.board ? ['on', 'enregistrée'] : ['', '—'];
  p.className = 'pill ' + cls;
  p.lastChild.textContent = txt;
  p.title = S.refused && S.dirty ? S.refused : `${txt} — la planche s’enregistre seule à chaque geste`;   // étroite, la barre n'en montre que le point
}
addEventListener('beforeunload', () => {
  if (app.coed?.on()) { app.coed.unload(); return; }   // collab : les dernières opérations, par sendBeacon
  if (!S.dirty || !S.board || S.conflict) return;
  const b = S.board;
  const body = JSON.stringify({ name: b.name, v: b.v, nodes: b.nodes, links: b.links, pres: b.pres ?? null, base_rev: S.rev });
  try { navigator.sendBeacon(avecEspace(href(`api/ideation/boards/${b.id}`)), new Blob([body], { type: 'application/json' })); } catch { /* */ }
});
$('#c-reload').addEventListener('click', async () => { S.conflict = false; $('#conflict').hidden = true; await openBoard(S.board.id, { force: true }); });
$('#c-force').addEventListener('click', async () => {
  try {
    const cur = await api(`ideation/boards/${S.board.id}`);
    S.rev = cur.rev; S.conflict = false; $('#conflict').hidden = true; S.dirty = true; flushSave();
  } catch (e) { toast(e.message); }
});

// ── la sélection, les outils ───────────────────────────────
app.select = (ids, { toggle = false } = {}) => {
  if (!toggle) S.sel.clear();
  for (const id of ids) { if (toggle && S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); }
  S.link = null;
  pruneFocus();
  app.selectionChanged();
};
// choisir un objet dans son groupe (double-clic, le plan de l'inspecteur) : le groupe s'ouvre
app.enter = (id) => {
  const n = app.node(id);
  if (!n) return;
  S.focus = n.group || null;
  S.sel = new Set([id]); S.link = null;
  app.selectionChanged();
};
app.selectLink = (id) => { S.sel.clear(); S.link = id; app.canvas.paintLinks(); app.selectionChanged(); };
app.setTool = (t) => {
  S.tool = t;
  // tous les outils de la barre (les deux groupes, et ceux que objets/ y ajoute)
  for (const b of document.querySelectorAll('.ide-bar [data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
  app.canvas.el.dataset.tool = t;
};

// ── poser ──────────────────────────────────────────────────
const DEF = {
  note: () => ({ w: 230, h: 80, text: '' }),
  sticky: () => ({ w: 190, h: 150, text: '', color: LS('sticky') || 'coral-3' }),
  title: () => ({ w: 460, h: 50, text: '', size: 'm' }),
  frame: () => ({ w: 560, h: 380, name: `Cadre ${S.board.nodes.filter((n) => n.type === 'frame').length + 1}` }),
  gen: () => ({ w: 320, h: 300, prompt: '', model: LS('gen-model') || 'krea2', aspect: '3:4', quality: '', count: 2, looks: {},
    variant: 'turbo', realism: true, seed: '', refChoice: {}, jobs: [], error: '' }),
  vgen: () => ({ w: 330, h: 320, prompt: '', mode: 'i2v', frames: S.mopts?.frames?.[0]?.frames || 124, canvas: 'auto', method: 'turbo',
    seed: '', sound: '', music: '', jobs: [], error: '' }),
  compose: () => ({ w: 340, h: 300, slots: newSlots() }),
  palette: () => ({ w: 280, h: 64, colors: [] }),
};
// les réglages d'un objet neuf de cette sorte (l'agent pose ses objets sans app.addAt, dans son seul app.mutate : agent.js)
app.def = (type) => (DEF[type] ? DEF[type]() : {});
// poser un objet ; `link` : une flèche d'annotation depuis cet objet ; `wireIn` : { from, pa, pb }
// un fil qui y entre ; `wireOut` : { to, pb } un fil qui en part ; `preset` : ses réglages ;
// `at` : le point est son coin (défaut), son centre ('center') ou le milieu de son bord gauche ('left')
app.addAt = (type, wx, wy, { edit = false, select = true, link = null, w, h, preset = null, wireIn = null, wireOut = null, at = 'corner' } = {}) => {
  if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return null; }
  const n = { id: app.uid('n'), type, x: Math.round(wx), y: Math.round(wy), ...DEF[type](), ...(preset ? JSON.parse(JSON.stringify(preset)) : {}) };
  if (w) n.w = Math.round(w);
  if (h) n.h = Math.round(h);
  if (at === 'center') { n.x = Math.round(wx - n.w / 2); n.y = Math.round(wy - n.h / 2); }
  if (at === 'left') n.y = Math.round(wy - n.h / 2);
  let why = '';
  app.mutate((B) => {
    B.nodes.push(n);
    if (link && app.node(link)) B.links.push({ id: app.uid('l'), a: link, b: n.id, kind: 'arrow', label: '' });
    if (wireIn) {
      why = canWire(B, wireIn.from, wireIn.pa, n.id, wireIn.pb, app.caps(), S.items);
      if (!why) B.links.push({ id: app.uid('l'), a: wireIn.from, b: n.id, kind: 'wire', pa: wireIn.pa, pb: wireIn.pb, label: '' });
    }
    if (wireOut) {
      const o = outPort(n);
      why = o ? canWire(B, n.id, o.id, wireOut.to, wireOut.pb, app.caps(), S.items) : 'cet objet ne donne rien';
      if (!why) {
        const old = replaces(B, wireOut.to, wireOut.pb, app.caps());
        if (old) B.links = B.links.filter((l) => l !== old);
        B.links.push({ id: app.uid('l'), a: n.id, b: wireOut.to, kind: 'wire', pa: o.id, pb: wireOut.pb, label: '' });
      }
    }
    if (select) { S.sel = new Set([n.id]); S.link = null; }
  });
  if (why) toast(why, 6000);
  if (edit) setTimeout(() => app.canvas.editText(n.id), 30);
  if (type === 'gen' || type === 'vgen') setTimeout(() => app.canvas.dom.get(n.id)?.el.querySelector('textarea')?.focus({ preventScroll: true }), 30);
  return n;
};
// la taille où poser un objet : son grand côté à W, son rapport gardé
app.sizeFor = (it, W = 280) => {
  if (it.kind === 'audio') return [260, 104];
  // un document : une page debout (sa couverture, son format, son titre) — 190 × 250 à W = 280, comme projet.js
  if (it.kind === 'document') return [Math.round(W * 0.68), Math.round(W * 0.68 * 1.316)];
  if (it.kind === 'element') return [Math.round(W * 0.8), Math.round(W * 0.8 * 1.36)];
  const r = it.width && it.height ? it.width / it.height : 4 / 3;
  return r >= 1 ? [W, Math.round(W / r)] : [Math.round(W * r), W];
};
app.newMedia = (it, x, y, w, h) => ({ id: app.uid('n'), type: 'media', item: it.id, kind: it.kind, title: it.title || '',
  x: Math.round(x), y: Math.round(y), w, h, jobs: [] });
// la place libre la plus proche de (x0, y0), sur une grille à la taille de
// l'objet : à droite et autour (`around` : de tous côtés, pour un objet posé
// au centre de la vue)
app.freeSpot = (x0, y0, w, h, { around = false } = {}) => {
  const busy = S.board.nodes.filter((n) => n.type !== 'frame');
  const free = (x, y) => !busy.some((n) => x < n.x + n.w + 16 && x + w + 16 > n.x && y < n.y + n.h + 16 && y + h + 16 > n.y);
  const sx = w + 24, sy = h + 24, cand = [];
  for (let c = around ? -6 : 0; c <= 8; c++) for (let r = around ? -6 : -2; r <= 10; r++) cand.push([c, r, Math.hypot(c * sx, r * sy * 1.15)]);
  cand.sort((a, b) => a[2] - b[2]);
  for (const [c, r] of cand) if (free(x0 + c * sx, y0 + r * sy)) return [Math.round(x0 + c * sx), Math.round(y0 + r * sy)];
  return [x0, y0];
};
app.placeItem = (it, wx, wy, { select = true, free = false } = {}) => {
  S.items.set(it.id, it);
  const [w, h] = app.sizeFor(it);
  const [x, y] = free ? app.freeSpot(wx - w / 2, wy - h / 2, w, h, { around: true }) : [wx - w / 2, wy - h / 2];
  const n = app.newMedia(it, x, y, w, h);
  app.mutate((B) => { B.nodes.push(n); if (select) { S.sel = new Set([n.id]); S.link = null; } });
  return n;
};
// plusieurs objets posés côte à côte, le premier centré sur (wx, wy)
// (`free` : chacun sur une place libre autour du point, pour ce qui arrive au centre de la vue)
app.placeMany = (items, wx, wy, { free = false } = {}) => {
  if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return; }
  if (!items.length) return;
  for (const it of items) S.items.set(it.id, it);
  app.mutate((B) => {
    S.sel.clear(); S.link = null;
    let x = null;
    for (const it of items) {
      const [w, h] = app.sizeFor(it);
      if (x === null) x = wx - w / 2;
      const [px, py] = free ? app.freeSpot(wx - w / 2, wy - h / 2, w, h, { around: true }) : [x, wy - h / 2];
      const n = app.newMedia(it, px, py, w, h);
      B.nodes.push(n);
      S.sel.add(n.id);
      x += w + 24;
    }
  });
};
// une partie d'un élément (inspector.js, le panneau de l'élément ; PART_MIME) : une de ses images devient
// une image de la bibliothèque (POST /api/elements/<id>/part, une fois) ; un modèle 3D, la visionneuse
app.placePart = async (p, wx, wy) => {
  if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return null; }
  try {
    if (p.kind === 'mesh') {
      const it = S.items.get(p.eid) || await api('library/' + p.eid);
      return app.modele3d?.place(it, wx, wy, p.file) || null;
    }
    const it = p.kind === 'item' ? await api('library/' + p.id) : await api(`elements/${p.eid}/part`, { method: 'POST', body: { file: p.file } });
    return app.placeItem(it, wx, wy, { free: true });
  } catch (e) { toast(e.message, 6000); return null; }
};
app.pickAt = async (wx, wy) => {
  const got = await pick({ kinds: app.mediaKinds(), multiple: true, title: 'Poser sur la planche' });
  app.placeMany(got, wx, wy);
};
// un personnage de Character Factory : importé (s'il ne l'est pas), puis posé
app.placeCf = async (cf, wx, wy) => {
  if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return; }
  let it;
  try { it = await cfElement(api, cf); } catch (e) { toast(`Character Factory : ${e.message}`, 7000); return; }
  app.placeItem(it, wx, wy, { free: !!cf.center });
  app.lib.reload();
};
// ── brancher ───────────────────────────────────────────────
// un fil de la sortie `pa` de a vers l'entrée `pb` de b : refusé en le disant
// (ports.js, canWire) ; sur une entrée à une place, il remplace l'ancien
app.wire = (a, pa, b, pb, { quiet = false } = {}) => {
  if (!S.board) return false;
  const why = canWire(S.board, a, pa, b, pb, app.caps(), S.items);
  if (why) { if (!quiet) toast(why, 6000); return false; }
  const old = replaces(S.board, b, pb, app.caps());
  app.mutate((B) => {
    if (old) B.links = B.links.filter((l) => l !== old);
    B.links.push({ id: app.uid('l'), a, b, kind: 'wire', pa, pb, label: '' });
  });
  if (!quiet) {
    const port = portOf(app.node(b), pb, app.caps());
    toast(old ? `${port?.label || pb} vient maintenant de ${nameOf(app.node(a))} (ctrl+Z : l’ancien fil)` : `branché : ${port?.label || pb} de ${nameOf(app.node(b))}`);
  }
  return true;
};
// couper un lien (ou plusieurs, en un seul pas d'annulation)
app.cutLink = (ids) => {
  const gone = new Set([].concat(ids));
  if (S.board?.links.some((l) => gone.has(l.id))) app.mutate((B) => { B.links = B.links.filter((l) => !gone.has(l.id)); });
};
// détacher : le texte reçu est copié là où il arrivait (le champ de la carte, la case), le fil coupé
app.detach = (id) => {
  const l = S.board?.links.find((x) => x.id === id && x.kind === 'wire');
  if (!l) return;
  const Fl = app.flowNow();
  const text = Fl.text(l.a);
  const x = Fl.extras(l.a);
  const b = app.node(l.b);
  app.mutate((B) => {
    if (b?.type === 'compose' && l.pb.startsWith('s:')) { const s = b.slots.find((y) => 's:' + y.id === l.pb); if (s) s.text = text; }
    else if (b && l.pb === 'prompt') {
      b.prompt = text;
      if (b.type === 'vgen') { if (x.son) b.sound = x.son; if (x.musique) b.music = x.musique; }
    }
    B.links = B.links.filter((y) => y !== l);
  });
  toast('détaché : le texte est copié, le fil coupé');
};
// un fil avant ou après ses voisins de la même entrée (l'ordre fait réf. 1, 2… et @image1, @image2…)
app.moveWire = (id, dir) => {
  const L = S.board?.links;
  const l = L?.find((x) => x.id === id);
  if (!l) return;
  const same = L.filter((x) => x.kind === 'wire' && x.b === l.b && x.pb === l.pb);
  const k = same.indexOf(l), o = same[k + dir];
  if (!o) return;
  app.mutate(() => { const i = L.indexOf(l), j = L.indexOf(o); [L[i], L[j]] = [L[j], L[i]]; });
};
// des objets de la bibliothèque vers une entrée (déposés dans la carte, ou pris dans la
// bibliothèque) : posés à gauche de la carte, branchés — la planche montre d'où ils viennent
app.feed = (id, port, items, { at = null } = {}) => {
  const g = app.node(id);
  if (!g || !items.length || !S.board) return;
  for (const it of items) S.items.set(it.id, it);
  const caps = app.caps();
  const refused = [];
  let done = 0;
  app.mutate((B) => {
    items.forEach((it, k) => {
      // un objet déjà sur la planche est branché tel quel ; sinon il se pose à gauche de la carte
      let n = B.nodes.find((x) => x.type === 'media' && x.item === it.id);
      const fresh = !n;
      if (fresh) {
        const [w, h] = app.sizeFor(it, 180);
        const [x, y] = at ? [at[0] - w, at[1] + k * (h + 16)] : app.freeSpot(g.x - w - 70, g.y, w, h);
        n = app.newMedia(it, x, y, w, h);
        B.nodes.push(n);
      }
      const why = canWire(B, n.id, it.kind, id, port, caps, S.items);
      if (why) { refused.push(why); if (fresh) B.nodes = B.nodes.filter((x) => x !== n); return; }
      const old = replaces(B, id, port, caps);
      if (old) B.links = B.links.filter((l) => l !== old);
      B.links.push({ id: app.uid('l'), a: n.id, b: id, kind: 'wire', pa: it.kind, pb: port, label: '' });
      done++;
    });
  });
  if (refused.length) toast(done ? `${done} branché${done > 1 ? 's' : ''} ; refusé : ${refused[0]}` : refused[0], 6000);
};
app.addRefs = (genId, items) => app.feed(genId, 'refs', items.filter((it) => ['image', 'element'].includes(it.kind)));
app.pickRefs = async (genId) => {
  const got = await pick({ kinds: ['image', 'element'], multiple: true, title: 'Références de la carte' });
  app.addRefs(genId, got);
};
// une flèche d'annotation (l'outil L, « relier par une flèche ») : elle ne porte rien
app.connect = (a, b) => {
  if (S.board.links.some((l) => l.a === a && l.b === b && l.kind !== 'wire')) { toast('ces deux objets sont déjà reliés'); return; }
  app.mutate((P) => { P.links.push({ id: app.uid('l'), a, b, kind: 'arrow', label: '' }); });
};
app.genWith = (ids) => {
  const refs = ids.map((id) => app.node(id)).filter(Boolean);
  const r = bbox(refs);
  const g = { id: app.uid('n'), type: 'gen', ...DEF.gen(), x: Math.round(r.x + r.w + 90), y: Math.round(r.y) };
  // un modèle qui prend ces références : Krea 2 jusqu'à deux, Qwen 2.1 au-delà (/api/image/models)
  const models = S.cfg?.models || [];
  const fits = (id) => (models.find((m) => m.id === id)?.refs ?? 0) >= refs.length;
  if (!fits(g.model)) g.model = ['krea2', 'qwen21'].find(fits) || models.filter((m) => m.refs).sort((a, b) => b.refs - a.refs)[0]?.id || g.model;
  app.mutate((B) => {
    B.nodes.push(g);
    for (const n of refs) {
      const o = outPort(n);
      if (o && !canWire(B, n.id, o.id, g.id, 'refs', app.caps(), S.items)) B.links.push({ id: app.uid('l'), a: n.id, b: g.id, kind: 'wire', pa: o.id, pb: 'refs', label: '' });
    }
    S.sel = new Set([g.id]); S.link = null;
  });
  setTimeout(() => app.canvas.dom.get(g.id)?.el.querySelector('textarea')?.focus({ preventScroll: true }), 30);
};

// ── un objet lâché sur un autre ────────────────────────────
// { name, test(moving, target) → ce qui arrivera (dit pendant le geste) | '', run(moving, target, orig) }.
// `run` modifie S.board puis appelle app.commit() : le pas d'annulation est déjà pris (le glisser l'a pris).
// « Deux textes qui se rencontrent font un composeur » (étude ideation_weavy.md § 9.5) : les notes
// restent des sources, branchées, et le texte glissé revient à sa place.
const isText = (n) => n && TEXT_TYPES.includes(n.type);
const back = (orig) => { for (const [n, x, y] of orig) { n.x = x; n.y = y; } };
app.dropRules = [
  { name: 'texte sur texte',
    test: (mv, t) => (mv.length === 1 && isText(mv[0]) && isText(t) ? 'lâcher : un composeur de prompt, les deux textes branchés' : ''),
    run: (mv, t, orig) => {
      back(orig);
      const d = mv[0];
      const c = { id: app.uid('n'), type: 'compose', ...DEF.compose(), slots: newSlots(['libre', 'libre']) };
      const [x, y] = app.freeSpot(Math.max(t.x + t.w, d.x + d.w) + 90, Math.min(t.y, d.y), c.w, 220);
      Object.assign(c, { x, y });
      S.board.nodes.push(c);
      for (const [src, s] of [[t, c.slots[0]], [d, c.slots[1]]]) S.board.links.push({ id: app.uid('l'), a: src.id, b: c.id, kind: 'wire', pa: 'text', pb: 's:' + s.id, label: '' });
      S.sel = new Set([c.id]); S.link = null;
      app.commit();
      toast('un composeur : les deux textes y sont branchés — un clic sur une étiquette donne son rôle');
    } },
  { name: 'texte sur composeur',
    test: (mv, t) => (mv.length === 1 && isText(mv[0]) && t?.type === 'compose' ? 'lâcher : dans une case du composeur' : ''),
    run: (mv, t, orig, ev) => {
      back(orig);
      const d = mv[0];
      const caps = app.caps();
      // la case sous le curseur (vide, ou remplacée), sinon la première libre, sinon une case Libre neuve
      const under = ev && document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-row^="s:"]')?.dataset.row;
      const free = (s) => !s.lock && !S.board.links.some((l) => l.kind === 'wire' && l.b === t.id && l.pb === 's:' + s.id);
      let s = under && t.slots.find((x) => 's:' + x.id === under && !x.lock);
      if (!s) s = t.slots.find((x) => free(x) && !x.text);
      if (!s) { s = newSlot('libre', t.slots); t.slots.push(s); }
      const why = canWire(S.board, d.id, 'text', t.id, 's:' + s.id, caps, S.items);
      if (why) { app.commit(); toast(why, 6000); return; }
      const old = replaces(S.board, t.id, 's:' + s.id, caps);
      if (old) S.board.links = S.board.links.filter((l) => l !== old);
      S.board.links.push({ id: app.uid('l'), a: d.id, b: t.id, kind: 'wire', pa: 'text', pb: 's:' + s.id, label: '' });
      app.commit();
      toast(`branché dans la case « ${s.name} »${old ? ' (ctrl+Z : l’ancien fil)' : ''}`);
    } },
  // une image ou un élément lâché sur une carte Générer : sa référence (le sens que la planche
  // donne aux liens vers une carte, étude ideation.md § 2) ; la carte qui n'en prend pas laisse
  // la place au groupe (une carte et ses références font un groupe de fabrication)
  { name: 'référence sur une carte', cls: 'drop-grp', tag: 'RÉFÉRENCE',
    test: (mv, t) => (refPort(mv, t) ? `lâcher : ${refPort(mv, t).label} de la carte (l’image revient à sa place)` : ''),
    run: (mv, t, orig) => {
      back(orig);
      const p = refPort(mv, t);
      const d = mv[0];
      if (!p) { app.commit(); return; }
      const old = replaces(S.board, t.id, p.id, app.caps());
      if (old) S.board.links = S.board.links.filter((l) => l !== old);
      S.board.links.push({ id: app.uid('l'), a: d.id, b: t.id, kind: 'wire', pa: d.kind, pb: p.id, label: '' });
      app.commit();
      toast(`branché : ${p.label} de ${nameOf(t)}${old ? ' (ctrl+Z : l’ancien fil)' : ''}`);
    } },
];
// l'entrée d'une carte Générer qui prend l'objet qu'on y lâche (null : aucune)
function refPort(mv, t) {
  if (mv.length !== 1 || !t || (t.type !== 'gen' && t.type !== 'vgen')) return null;
  const d = mv[0];
  if (d.type !== 'media' || !['image', 'element'].includes(d.kind)) return null;
  const caps = app.caps();
  const want = t.type === 'gen' ? ['refs'] : t.mode === 'i2v' ? ['start', 'end'] : t.mode === 'r2v' ? [d.kind] : [];
  const ports = want.map((id) => portOf(t, id, caps)).filter(Boolean);
  // une première image vide avant une dernière image vide ; sinon la première qui prend
  const free = ports.find((p) => !replaces(S.board, t.id, p.id, caps) && !canWire(S.board, d.id, d.kind, t.id, p.id, caps, S.items));
  return free || ports.find((p) => !canWire(S.board, d.id, d.kind, t.id, p.id, caps, S.items)) || null;
}
app.dropOnto = (moving, target, orig, ev) => {
  const r = [...app.dropRules, ...(app.dropLast || [])].find((x) => x.test(moving, target));
  if (!r) return false;
  r.run(moving, target, orig, ev);
  return true;
};
app.palette = async (id) => {
  const n = app.node(id);
  if (!n) return;
  let r;
  try { r = await api(`ideation/palette/${n.item}?n=6`); } catch (e) { toast(e.message, 6000); return; }
  app.mutate((B) => {
    const p = { id: app.uid('n'), type: 'palette', x: n.x, y: n.y + n.h + 20, w: Math.max(n.w, 240), h: 64, colors: r.colors.map((c) => c.hex), item: n.item };
    const [x, y] = app.freeSpot(p.x, p.y, p.w, p.h);
    Object.assign(p, { x, y });
    B.nodes.push(p);
    B.links.push({ id: app.uid('l'), a: n.id, b: p.id, kind: 'out', label: '' });
    S.sel = new Set([p.id]);
  });
};

// ── plusieurs objets ───────────────────────────────────────
// les unités choisies (un groupe, un objet, un enfant du groupe ouvert), et la même liste
// avec les enfants de ses groupes (ce qui part, se copie, s'empile avec eux)
const selected = () => [...S.sel].map(app.node).filter(Boolean);
// … et la descendance d'un nœud de mind map (supprimer, copier, dupliquer une branche l'emportent)
const selectedAll = () => app.objets.subtrees(app.groups.expand(selected()));
app.remove = () => {
  if (S.link && !S.sel.size) { app.mutate((B) => { B.links = B.links.filter((l) => l.id !== S.link); }); S.link = null; app.insp.render(); return; }
  if (!S.sel.size) return;
  const gone = new Set(selectedAll().map((n) => n.id));
  app.mutate((B) => {
    B.nodes = B.nodes.filter((n) => !gone.has(n.id));
    B.links = B.links.filter((l) => !gone.has(l.a) && !gone.has(l.b));
    S.sel.clear();
  });
};
// des copies, décalées, avec les liens qui les reliaient entre elles ; `inputs` : les fils qui
// y entraient depuis le reste de la planche entrent aussi dans les copies (une variante garde
// ses sources : dupliquer un composeur et sa carte, puis changer une case). L'appartenance suit
// comme les deux bouts d'un lien : un groupe copié emmène ses enfants ; un enfant copié seul
// reste dans son groupe (`keepGroup`, ctrl+D) ou le quitte (coller ailleurs)
function cloneInto(B, list, dx, dy, links, { inputs = false, keepGroup = false } = {}) {
  const map = new Map();
  const made = [];
  for (const n of list) {
    const c = JSON.parse(JSON.stringify(n));
    c.id = app.uid(n.type === 'group' ? 'g' : 'n'); c.x += dx; c.y += dy;
    if (c.jobs) c.jobs = [];
    map.set(n.id, c.id);
    made.push(c);
    B.nodes.push(c);
  }
  for (const c of made) {
    // un nœud de mind map copié : son parent, s'il est copié aussi ; sinon il reste une branche de
    // son parent (ctrl+D) ou devient une racine (coller ailleurs)
    if (c.parent && c.type === 'mind') {
      if (map.has(c.parent)) c.parent = map.get(c.parent);
      else if (!keepGroup || !B.nodes.some((n) => n.id === c.parent)) delete c.parent;
    }
    if (!c.group) continue;
    if (map.has(c.group)) c.group = map.get(c.group);
    else if (!keepGroup || !B.nodes.some((n) => n.id === c.group)) delete c.group;
  }
  for (const l of links) {
    if (map.has(l.a) && map.has(l.b)) B.links.push({ ...l, id: app.uid('l'), a: map.get(l.a), b: map.get(l.b) });
    else if (inputs && l.kind === 'wire' && map.has(l.b) && B.nodes.some((n) => n.id === l.a)) B.links.push({ ...l, id: app.uid('l'), b: map.get(l.b) });
  }
  // choisies : les copies qui sont des unités (pas les enfants d'un groupe copié)
  const groups = new Set(made.filter((c) => c.type === 'group').map((c) => c.id));
  const tops = new Set(made.map((c) => c.id));
  S.sel = new Set(made.filter((c) => (!c.group || !groups.has(c.group)) && !(c.type === 'mind' && tops.has(c.parent))).map((c) => c.id));
  if (!made.some((c) => c.group && !groups.has(c.group))) S.focus = null;
}
app.duplicate = () => {
  const list = selectedAll();
  if (!list.length) return;
  app.mutate((B) => cloneInto(B, list, 30, 30, B.links.slice(), { inputs: true, keepGroup: true }));
};
app.order = (dir) => {
  if (!S.sel.size) return;
  const mineIds = new Set(selectedAll().map((n) => n.id));
  app.mutate((B) => {
    const mine = B.nodes.filter((n) => mineIds.has(n.id)), rest = B.nodes.filter((n) => !mineIds.has(n.id));
    B.nodes = dir > 0 ? [...rest, ...mine] : [...mine, ...rest];
  });
};
app.frameAround = () => {
  const list = selected();
  const r = bbox(list.map((n) => app.canvas.dispBox(n)));
  if (!r) return;
  const pad = 36;
  app.mutate((B) => {
    const f = { id: app.uid('n'), type: 'frame', ...DEF.frame(), x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
    B.nodes.unshift(f);
    S.sel = new Set([f.id]);
  });
  setTimeout(() => app.canvas.renameFrame([...S.sel][0]), 30);
};
// aligner, distribuer, ranger : sur les unités (un groupe bouge d'un bloc, par sa boîte)
const boxOf = (n) => app.canvas.dispBox(n);
// les unités qu'on aligne, distribue, range : une mind map compte pour sa racine (son arbre la suit)
const layoutUnits = () => app.objets.roots(selected());
app.align = (k) => {
  const list = layoutUnits();
  const r = bbox(list.map(boxOf));
  if (!r || list.length < 2) return;
  app.mutate(() => {
    for (const n of list) {
      const b = boxOf(n);
      let x = b.x, y = b.y;
      if (k === 'left') x = r.x;
      if (k === 'right') x = r.x + r.w - b.w;
      if (k === 'hcenter') x = Math.round(r.x + r.w / 2 - b.w / 2);
      if (k === 'top') y = r.y;
      if (k === 'bottom') y = r.y + r.h - b.h;
      if (k === 'vmiddle') y = Math.round(r.y + r.h / 2 - b.h / 2);
      app.groups.shift(n, x - b.x, y - b.y);
    }
  });
};
app.distribute = (axis) => {
  const list = layoutUnits();
  if (list.length < 3) return;
  const W = axis === 'x' ? 'w' : 'h';
  const s = list.map((n) => [n, { ...boxOf(n) }]).sort((a, b) => a[1][axis] - b[1][axis]);
  const last = s[s.length - 1][1];
  const span = last[axis] + last[W] - s[0][1][axis];
  const gap = (span - s.reduce((t, [, b]) => t + b[W], 0)) / (s.length - 1);
  app.mutate(() => {
    let p = s[0][1][axis];
    for (const [n, b] of s) { const d = Math.round(p) - b[axis]; app.groups.shift(n, axis === 'x' ? d : 0, axis === 'y' ? d : 0); p += b[W] + gap; }
  });
};
// ranger en grille : les objets choisis, dans l'ordre de lecture, en colonnes régulières ; un
// groupe seul passe en rangée (sa mise en forme reste : la pastille à droite règle sa largeur)
app.tidy = () => {
  const list = layoutUnits().filter((n) => n.type !== 'frame');
  if (list.length === 1 && list[0].type === 'group') {
    const g = list[0];
    const kids = kidsOf(S.board, g.id);
    const cols = Math.max(1, Math.round(Math.sqrt(kids.length * 1.4)));
    const cw = Math.max(...kids.map((n) => n.w));
    const L = layoutOf(g);
    app.mutate((B) => {
      setOrder(B, g.id, readingOrder(kidsOf(B, g.id)));
      g.layout = { ...L, mode: 'flow', width: cols * (cw + L.gap) - L.gap };
    });
    return;
  }
  if (list.length < 2) return;
  const r = bbox(list.map(boxOf));
  const cols = Math.max(1, Math.round(Math.sqrt(list.length * 1.4)));
  const cw = Math.max(...list.map((n) => boxOf(n).w)) + 24;
  const s = readingOrder(list.map((n) => ({ n, ...boxOf(n) })));
  app.mutate(() => {
    let y = r.y;
    for (let i = 0; i < s.length; i += cols) {
      const line = s.slice(i, i + cols);
      line.forEach((b, k) => app.groups.shift(b.n, r.x + k * cw - b.x, y - b.y));
      y += Math.max(...line.map((b) => b.h)) + 24;
    }
  });
};
// même hauteur, même largeur (PureRef « Normalize ») : une fois, d'après le premier choisi ;
// sur un groupe, elle reste (groups.js, fit)
// `axis` : 'h', 'w', ou 'wh' (même taille : les deux). Les cadres aussi (Cal, 30/09), sauf une
// diapositive, qui garde sa scène
app.sameSize = (axis) => {
  const list = selected();
  if (list.length === 1 && list[0].type === 'group' && axis !== 'wh') { app.groups.fit(list[0].id, axis); return; }
  const objs = list.filter((n) => n.type !== 'group' && !n.deck);
  if (objs.length < 2) { toast('choisissez au moins deux objets (une diapositive garde la taille de sa scène)'); return; }
  const ref = objs[0];
  app.mutate(() => {
    for (const n of objs.slice(1)) {
      if (axis !== 'h') setSize(n, 'w', ref.w);
      if (axis !== 'w') setSize(n, 'h', ref.h);
    }
  });
};
app.chain = () => {
  const ids = [...S.sel];
  if (ids.length < 2) return;
  app.mutate((B) => {
    for (let i = 0; i + 1 < ids.length; i++) {
      if (!B.links.some((l) => l.a === ids[i] && l.b === ids[i + 1])) B.links.push({ id: app.uid('l'), a: ids[i], b: ids[i + 1], kind: 'arrow', label: '' });
    }
  });
};

// ── modales ────────────────────────────────────────────────
app.modal = (title, body, foot, { cls = '', onclose } = {}) => {
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc, true); if (onclose) onclose(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const scrim = el('div', { class: 'scrim', onpointerdown: (e) => { if (e.target === scrim) close(); } },
    el('div', { class: 'modal ' + cls, role: 'dialog', 'aria-label': title },
      el('div', { class: 'modal-head' }, el('span', { class: 't' }, title), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => close(), title: 'fermer · Échap' }, 'Fermer')),
      el('div', { class: 'modal-body' }, body),
      foot ? el('div', { class: 'modal-foot' }, foot(close)) : null));
  document.addEventListener('keydown', esc, true);
  document.body.append(scrim);
  return close;
};
function askName(title, value = '', action = 'Créer') {
  return new Promise((resolve) => {
    let done = false;
    const inp = el('input', { class: 'fld', value, placeholder: 'le nom de la planche', maxlength: 120 });
    const ok = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } done = true; close(); resolve(v); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    const close = app.modal(title, el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'nom'), inp),
      (cl) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: cl }, 'Annuler'),
        el('button', { class: 'tb go', type: 'button', onclick: ok }, action)],
      { onclose: () => { if (!done) resolve(null); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}
app.lightbox = (n) => {
  const it = S.items.get(n.item);
  if (!it || it.missing) return;
  if (n.kind === 'document') return app.liseuse(n);
  // une vidéo : le lecteur du portail (commun/lecteur.js), jamais les contrôles du navigateur (Cal, 01/10)
  const L = n.kind === 'video' ? lecteur(it, { clavier: 'page' }) : null;
  const media = L ? L.el : el('img', { src: href(it.url), alt: it.title || '' });
  app.modal(it.title || it.id, el('div', { class: 'lightbox' + (L ? ' lb-lect' : '') }, media), null, { cls: 'lb', onclose: () => L?.detruire() });
  if (L) requestAnimationFrame(() => L.play());
};

// un document : LA liseuse (commun/documents.js) — ses pages, son texte ; un PDF que le portail n'a
// pas lu se lit ici (et lui est déposé si l'on peut l'écrire : la carte se refait avec sa couverture)
app.liseuse = (n, { page = 1 } = {}) => {
  const it = S.items.get(n.item);
  if (!it || it.missing) return;
  const L = liseuse(it, { page, telecharger: false, onitem: (nv) => { S.items.set(nv.id, nv); app.canvas.renderSoon(); } });
  app.modal(it.title || it.id, el('div', { class: 'lis-box' }, L.el), () => [
    el('a', { class: 'tb ghost', href: href(`asset/#${it.id}`), target: '_blank', rel: 'noopener', title: 'sa fiche dans Asset' }, 'Dans Asset'),
    el('span', { class: 'sp' }),
    it.url ? el('a', { class: 'tb ghost', href: href(it.url), download: nomDe(it), title: 'le fichier tel qu’il a été déposé' }, 'Télécharger') : null],
  { cls: 'lis', onclose: () => L.detruire() });
};
// les sortes qu'un objet `media` peut porter : celles du portail (/api/ideation/meta, MEDIA_KINDS)
app.mediaKinds = () => S.meta?.media_kinds || ['image', 'video', 'audio', 'element', 'document'];

// ── les planches ───────────────────────────────────────────
app.newBoard = async () => {
  const d = new Date();
  const name = await askName('Nouvelle planche', `Planche du ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`);
  if (!name) return null;
  let b;
  try { b = await api('ideation/boards', { method: 'POST', body: { name }, espace: espace() }); } catch (e) { toast(e.message, 6000); return null; }
  await openBoard(b.id);
  return b;
};
app.boardsModal = async () => {
  let list = [];
  const box = el('div', { class: 'blist' });
  const count = el('span', { class: 'lbl' });
  const paint = () => {
    count.textContent = `${list.length} planche${list.length > 1 ? 's' : ''}`;
    box.replaceChildren(...(list.length ? list.map(row) : [el('p', {}, 'Aucune planche encore. Créez-en une : elle s’enregistre seule, à chaque geste.')]));
  };
  const row = (bd) => {
    let armed = false;
    const del = el('button', { class: 'tb ghost sm', type: 'button', title: 'à la corbeille des planches', onclick: async () => {
      if (!armed) { armed = true; del.textContent = 'Confirmer'; setTimeout(() => { armed = false; del.textContent = 'Supprimer'; }, 3000); return; }
      try { await api(`ideation/boards/${bd.id}/delete`, { method: 'POST' }); } catch (e) { toast(e.message); return; }
      list = list.filter((x) => x.id !== bd.id);
      if (S.board?.id === bd.id) closeBoard();
      paint();
    } }, 'Supprimer');
    const kinds = Object.entries(bd.kinds || {}).map(([k, v]) => `${v} ${({ image: 'image', video: 'vidéo', audio: 'son', element: 'élément', document: 'document', note: 'note', sticky: 'post-it', title: 'titre', frame: 'cadre', group: 'groupe', gen: 'carte image', vgen: 'carte vidéo', compose: 'composeur', palette: 'nuancier', shape: 'forme', card: 'carte', mind: 'nœud', ink: 'trait', text: 'texte' })[k] || k}${v > 1 && !['son'].includes(k) ? 's' : ''}`).join(' · ');
    return el('div', { class: 'brow' + (S.board?.id === bd.id ? ' on' : '') },
      el('span', { class: 'th', style: bd.thumb_url ? { backgroundImage: `url("${href(bd.thumb_url)}")` } : null }),
      el('div', { class: 'bt' }, el('b', {}, bd.name), el('small', {}, `${kinds || 'vide'} · ${fmtDate(bd.updated)}`)),
      el('div', { class: 'row' },
        el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => { close(); await openBoard(bd.id); } }, 'Ouvrir'),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => {
          const nm = await askName('Renommer', bd.name, 'Renommer');
          if (!nm) return;
          if (S.board?.id === bd.id) { setName(nm); await flushSave(); bd.name = nm; paint(); return; }
          try { Object.assign(bd, await api(`ideation/boards/${bd.id}/rename`, { method: 'POST', body: { name: nm } })); } catch (e) { toast(e.message); }
          paint();
        } }, 'Renommer'),
        studioSeul(el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => {
          if (S.board?.id === bd.id) await flushSave();
          try { const r = await api(`ideation/boards/${bd.id}/duplicate`, { method: 'POST' }); list.unshift(r); paint(); toast(`« ${r.name} » créée`); } catch (e) { toast(e.message); }
        } }, 'Dupliquer')),
        del));
  };
  const close = app.modal('Les planches', el('div', { class: 'stack' }, count, box),
    (cl) => [el('span', { class: 'sp' }), studioSeul(el('button', { class: 'tb go', type: 'button', onclick: async () => { cl(); await app.newBoard(); } }, 'Nouvelle planche'))],
    { cls: 'lg' });
  if (S.board) await flushSave();
  try { ({ boards: list } = await api('ideation/boards', { espace: espace() })); } catch (e) { box.replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
  paint();
};

// les fiches des objets posés : par paquets de 500, une requête chacun (POST /api/library/batch ;
// une planche de 1000 images en faisait 1000 — étude de fluidité, § 2.2) ; un serveur sans lot :
// une par objet, huit à la fois. MONTRER (`spaces: '*'`) : ce qui est posé est du Workspace de la
// planche (le serveur le garde), qui n'est pas celui de l'onglet quand un lien l'ouvre (un ami
// « Apps », un membre d'un autre Workspace : core/auth.py, can_read_item)
async function ensureItems(ids) {
  const want = [...new Set(ids)].filter((id) => !S.items.has(id));
  const one = (list) => Promise.all(list.map((id) => api('library/' + id + '?spaces=*')
    .then((it) => S.items.set(id, it)).catch(() => S.items.set(id, { id, missing: true }))));
  for (let i = 0; i < want.length; i += 500) {
    const chunk = want.slice(i, i + 500);
    try {
      const r = await api('library/batch', { method: 'POST', body: { ids: chunk, spaces: '*' } });
      for (const it of r.items || []) S.items.set(it.id, it);
      for (const id of r.missing || []) S.items.set(id, { id, missing: true });
    } catch {
      for (let k = 0; k < chunk.length; k += 8) await one(chunk.slice(k, k + 8));
    }
  }
}

async function openBoard(id, { force = false } = {}) {
  if (!force && S.board && S.board.id !== id) await flushSave();
  let b;
  try { b = await api('ideation/boards/' + id); } catch (e) { toast(e.message, 6000); return false; }
  S.board = b; S.rev = b.rev;
  // la planche est dans son Workspace : l'en-tête le dit, et tout ce qu'on y fait y part — son flux,
  // ses enregistrements, ce qu'on y génère ou dépose —, même après un changement de Workspace dans
  // l'en-tête (commun/shell.js, espaceDocument `outil`) ; la liste des planches reste celle de l'onglet
  espaceDocument(b.space || null, b.id, { outil: true });
  app.emit?.('board:open', b);   // collab : la co-édition part de la planche telle que le serveur l'a donnée
  S.undo = []; S.redo = []; S.sel = new Set(); S.link = null; S.focus = null; S.dirty = false; S.conflict = false; S.clip = null;
  $('#conflict').hidden = true;
  LS('last', id);
  if (location.hash.slice(1) !== id) history.replaceState(null, '', location.pathname + '#' + id);
  $('#b-name').value = b.name;
  document.title = `${b.name} · Idéation`;
  // les objets posés, et les visages des cartes personne (objets/cartes.js)
  await ensureItems([...b.nodes.filter((n) => n.type === 'media').map((n) => n.item), ...app.objets.items(b)]);
  await viewsReady;   // les copies d'affichage (commun/proxies.js) choisies dès le premier rendu
  // la vue avant le premier rendu (celle gardée, sinon toute la planche) : les images se
  // choisissent au bon zoom dès l'ouverture (étude de fluidité, § 2.6)
  const v = LS('view-' + id);
  app.canvas.prime(v && Number.isFinite(v.z) ? v : null);
  app.canvas.render();
  app.canvas.applyView();
  app.insp.render();
  paintUndo(); paintSave(); paintBar();
  app.gen.resume();
  return true;
}
// relire la planche du serveur sans recharger la page (la collaboration : quelqu'un d'autre
// l'a changée) ; ce qui n'est pas enregistré ici est perdu — la page qui appelle le sait
app.reloadBoard = () => (S.board ? openBoard(S.board.id, { force: true }) : Promise.resolve(false));
// ouvrir une planche par son id (« Commencer un projet », projet.js : celle qu'il vient de créer)
app.openBoard = (id) => openBoard(id);
// « Commencer un projet » (le mode showrunner, projet.js) : la fenêtre par-dessus la planche
app.projet = (o) => import('./projet.js').then((m) => m.ouvrirProjet(app, o)).catch((e) => toast(`Commencer un projet : ${e.message}`, 7000));
function closeBoard() {
  S.board = null; S.sel.clear(); S.link = null;
  espaceDocument(null);
  $('#b-name').value = '';
  history.replaceState(null, '', location.pathname);
  app.canvas.render(); app.insp.render(); paintSave(); paintBar();
}
function setName(nm) {
  if (!S.board || !nm || nm === S.board.name) return;
  app.mutate((B) => { B.name = nm; });
  $('#b-name').value = nm;
  document.title = `${nm} · Idéation`;
}
$('#b-name').addEventListener('change', (e) => { const v = e.target.value.trim(); if (v) setName(v); else e.target.value = S.board?.name || ''; });
$('#b-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

// ── l'export en PNG ────────────────────────────────────────
app.exportBoard = async (frame = '') => {
  if (!S.board) return;
  await flushSave();
  // Cal, 05/10 : l'export ne va plus dans la bibliothèque ni dans un volet du portail — le PNG
  // s'enregistre sur l'ordinateur et part dans le presse-papier
  const st = $('#exp-st');
  st.hidden = false;
  st.replaceChildren(el('span', { class: 'pill work' }, el('i'), el('span', {}, 'export…')));
  const fr = frame ? app.node(frame) : null;
  const name = (fr ? `${S.board.name} · ${fr.name || 'cadre'}` : S.board.name).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'planche';
  let blob;
  try { blob = await api(`ideation/boards/${S.board.id}/png`, { method: 'POST', body: { frame }, blob: true }); } catch (e) {
    st.hidden = true;
    toast(`export : ${e.message}`, 8000);
    return;
  }
  st.hidden = true;
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `${name}.png`, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  let copied = false;
  try {
    if (navigator.clipboard && window.ClipboardItem) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); copied = true; }
  } catch { /* le presse-papier refusé (page http hors localhost, autorisation) : le fichier suffit */ }
  toast(copied ? `« ${name}.png » enregistré sur l’ordinateur et copié dans le presse-papier (ctrl+V pour le coller)`
    : `« ${name}.png » enregistré sur l’ordinateur — le navigateur n’a pas permis la copie dans le presse-papier (il faut une adresse https)`, 7000);
};

// ── la barre ───────────────────────────────────────────────
function paintBar() {
  const f = S.sel.size === 1 && app.node([...S.sel][0])?.type === 'frame';
  const ex = $('#b-export');
  const exWord = f ? 'Exporter le cadre' : 'Exporter';
  ex.querySelector('.bt').textContent = exWord;
  ex.setAttribute('aria-label', exWord.toLowerCase());   // étroite, la barre n'en montre que l'icône (ideation.css)
  ex.title = f ? 'ce cadre en PNG : sur l’ordinateur et dans le presse-papier' : 'la planche en PNG : sur l’ordinateur et dans le presse-papier';
  ex.disabled = !S.board || !S.board.nodes.length;
}
$('#b-boards').addEventListener('click', () => app.boardsModal());
$('#b-new').addEventListener('click', () => app.newBoard());
$('#b-undo').addEventListener('click', () => app.undoStep());
$('#b-redo').addEventListener('click', () => app.redoStep());
$('#b-export').addEventListener('click', () => {
  const f = S.sel.size === 1 && app.node([...S.sel][0])?.type === 'frame' ? [...S.sel][0] : '';
  app.exportBoard(f);
});
// #b-lib : le panneau Asset commun (commun/dock.js) s'ouvre et se ferme par library.js ; Ctrl+Espace partout
// les outils : un clic le prend (les boutons « poser » n'avaient pas d'écoute : seul le clavier les prenait)
// (les deux barres : celle du haut, et celle des outils à gauche, sur la planche — barres.css)
for (const bar of document.querySelectorAll('.ide-bar')) bar.addEventListener('click', (e) => { const b = e.target.closest?.('[data-tool]'); if (b) app.setTool(b.dataset.tool); });
$('#b-help').addEventListener('click', help);
// les médias de la barre de gauche : objets/medias.js (chargé avec les modules) ; pas encore là, il le dit
for (const [id, fn] of [['#b-son', 'son'], ['#b-web', 'web']]) {
  $(id)?.addEventListener('click', () => { if (app.medias?.[fn]) app.medias[fn](); else toast('les médias (son, web) se chargent encore : un instant'); });
}
function help() {
  const K = [['V', 'choisir'], ['H · espace', 'se déplacer'], ['L', 'une flèche d’annotation'], ['N', 'note'], ['S', 'post-it'], ['T · Maj+T', 'texte (fond transparent, sa barre au-dessus) · titre'], ['F', 'cadre (tracer)'],
    ['double-clic sur une image', 'la recadrer (Entrée applique, Échap annule ; l’image reste entière)'],
    ['G', 'carte Générer image'], ['M', 'carte Générer vidéo'], ['P', 'composeur de prompt'],
    ['R', 'forme (la grille des six contours)'], ['K', 'carte : tâche, lien, mesure, personne'], ['B', 'mind map'], ['D', 'crayon (Échap : le reposer)'],
    ['Tab · Entrée', 'sur un nœud de mind map : un enfant · un frère'], ['Entrée · F2', 'écrire dans l’objet choisi'],
    ['les poignées d’un objet', 'une flèche vers un autre ; dans le vide : créer et relier'],
    ['glisser · Alt', 'l’aimant aligne bords et centres · libre le temps du geste'],
    ['tirer une sortie', 'un fil : sur une carte, la bonne entrée ; dans le vide, un objet déjà branché'], ['texte sur texte', 'un composeur'],
    ['texte sur une carte Générer', 'un composeur'],
    ['un objet lâché sur un autre', 'un groupe (Alt : poser par-dessus) ; une image sur une carte : sa référence'],
    ['ctrl+G · ctrl+maj+G', 'grouper · dégrouper'], ['double-clic dans un groupe · Échap', 'choisir l’objet · remonter au groupe'],
    ['ctrl+alt+G', 'encadrer la sélection'], ['Alt+A · D · W · S', 'aligner à gauche, à droite, en haut, en bas'], ['Alt+H · Alt+V', 'aligner les centres'],
    ['Alt+maj+H · V', 'distribuer'], ['ctrl+alt+T', 'ranger'],
    ['molette · pincer', 'zoomer'], ['Maj+1 · Maj+0', 'tout voir · 100 %'], ['glisser le fond', 'cadre de sélection'], ['Alt + glisser', 'lasso'],
    ['Maj + clic', 'ajouter, retirer'], ['ctrl+A', 'tout choisir'], ['ctrl+D', 'dupliquer'], ['ctrl+C · ctrl+V', 'copier, coller (et coller une image)'],
    ['Suppr', 'supprimer'], ['[ · ]', 'arrière-plan · premier plan'], ['flèches', 'déplacer (Maj : 10)'], ['Entrée · double-clic', 'écrire'],
    ['ctrl+Z · ctrl+maj+Z', 'annuler · rétablir'], ['Échap', 'remonter au groupe, puis rien choisi'],
    ['ctrl+Espace', 'le panneau Asset (la bibliothèque) : l’ouvrir, le fermer']];
  app.modal('Raccourcis', el('dl', { class: 'keys' }, ...K.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])));
}

// ── le clavier ─────────────────────────────────────────────
const typing = (t) => t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
document.addEventListener('keydown', (e) => {
  if (typing(e.target) || document.querySelector('.scrim')) return;
  const k = e.key, mod = e.ctrlKey || e.metaKey, low = k.toLowerCase();
  if (k === ' ') { e.preventDefault(); if (!S.space) { S.space = true; app.canvas.el.classList.add('space'); } return; }
  if (!S.board) return;
  // le canvas figé (canvas.lock) : la vue seulement
  if (app.canvas.isLocked() && !['+', '=', '-', '_'].includes(k) && !(e.shiftKey && ['Digit0', 'Digit1'].includes(e.code))) return;
  if (mod && low === 'z') { e.preventDefault(); if (e.shiftKey) app.redoStep(); else app.undoStep(); return; }
  if (mod && low === 'y') { e.preventDefault(); app.redoStep(); return; }
  if (mod && low === 'd') { e.preventDefault(); app.duplicate(); return; }
  // les groupes (Miro : ctrl+G, ctrl+maj+G ; tldraw : ctrl+alt+G encadre)
  if (mod && e.altKey && low === 'g') { e.preventDefault(); if (S.sel.size) app.frameAround(); return; }
  if (mod && low === 'g') { e.preventDefault(); if (e.shiftKey) app.groups.ungroup(); else app.groups.group(); return; }
  if (mod && e.altKey && low === 't') { e.preventDefault(); app.tidy(); return; }
  // tout choisir : les unités (un groupe plutôt que ses enfants)
  if (mod && low === 'a') { e.preventDefault(); S.focus = null; app.select(S.board.nodes.filter((n) => !n.group).map((n) => n.id)); return; }
  if (mod && (low === 'c' || low === 'x')) {
    const list = selectedAll();
    if (!list.length) return;
    const ids = new Set(list.map((n) => n.id));
    S.clip = JSON.parse(JSON.stringify(list));
    S.clipLinks = S.board.links.filter((l) => ids.has(l.a) && ids.has(l.b));
    toast(`${S.sel.size} objet${S.sel.size > 1 ? 's' : ''} copié${S.sel.size > 1 ? 's' : ''}`);
    if (low === 'x') app.remove();
    return;
  }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); app.remove(); return; }
  // Échap : de l'objet choisi dans son groupe au groupe, puis à rien
  if (k === 'Escape') {
    if (S.focus) { const g = S.focus; S.focus = null; app.select([g]); return; }
    S.sel.clear(); S.link = null; app.setTool('select'); app.objets.closeSub(); app.selectionChanged(); app.canvas.paintLinks(); return;
  }
  // aligner et distribuer au clavier (Figma, tldraw) — pas de raccourci pour « même taille »
  if (e.altKey && !mod && S.sel.size > 1) {
    // la lettre inscrite sur la touche (AZERTY compris), sinon sa place (Alt+lettre peut rendre un signe)
    const L = /^[a-z]$/.test(low) ? low : (e.code || '').replace(/^Key/, '').toLowerCase();
    const A = { a: 'left', d: 'right', w: 'top', s: 'bottom', h: 'hcenter', v: 'vmiddle' }[L];
    if (e.shiftKey && (L === 'h' || L === 'v')) { e.preventDefault(); app.distribute(L === 'h' ? 'x' : 'y'); return; }
    if (A && !e.shiftKey) { e.preventDefault(); app.align(A); return; }
  }
  // Tab, Entrée sur un nœud de mind map : un enfant, un frère (objets/mindmap.js)
  if ((k === 'Tab' || k === 'Enter') && S.sel.size === 1 && !mod && !e.altKey) {
    const n = app.node([...S.sel][0]);
    if (n && app.objets.mindKey(n, k)) { e.preventDefault(); return; }
  }
  // Entrée, F2 : écrire (une note, un post-it, un titre, une forme, le titre d'une carte, un nœud) ou renommer un cadre
  if ((k === 'Enter' || k === 'F2') && S.sel.size === 1) {
    const n = app.node([...S.sel][0]);
    if (n && (['note', 'sticky', 'title'].includes(n.type) || app.objets.writable(n))) { e.preventDefault(); app.canvas.editText(n.id); }
    if (n && n.type === 'frame') { e.preventDefault(); app.canvas.renameFrame(n.id); }
    return;
  }
  if (k.startsWith('Arrow') && S.sel.size) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    const [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[k];
    if (!arrowSnap) { app.snap(); arrowSnap = true; }
    // une mind map se déplace d'un bloc (ses nœuds se rangent depuis la racine)
    for (const n of app.objets.trees(selectedAll())) { n.x += dx; n.y += dy; }
    app.touch(); app.canvas.render();
    // une suite de flèches est un seul geste : un pas d'annulation, un commit à la fin
    clearTimeout(arrowT); arrowT = setTimeout(() => { arrowSnap = false; app.commit(); }, 600);
    return;
  }
  if (k === ']') { app.order(1); return; }
  if (k === '[') { app.order(-1); return; }
  if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); app.canvas.fit(); return; }
  if (e.shiftKey && e.code === 'Digit0') { e.preventDefault(); app.canvas.zoomTo(1); return; }
  if (k === '+' || k === '=') { app.canvas.zoomBy(1.25); return; }
  if (k === '-' || k === '_') { app.canvas.zoomBy(0.8); return; }
  if (k === '?') { help(); return; }
  if (mod || e.altKey) return;
  // R forme, K carte, B mind map, D crayon (objets/ ; M et P sont la carte vidéo et le composeur, C le « commenter » de la collaboration)
  if (app.objets.onKey(e)) return;
  const T = { v: 'select', h: 'hand', l: 'link', n: 'note', s: 'sticky', t: 'title', f: 'frame', g: 'gen', m: 'vgen', p: 'compose' }[low];
  if (T) app.setTool(T);
});
let arrowSnap = false, arrowT = 0;
document.addEventListener('keyup', (e) => { if (e.key === ' ') { S.space = false; app.canvas.el.classList.remove('space'); } });
addEventListener('blur', () => { S.space = false; app.canvas.el.classList.remove('space'); });

// coller : une image du presse-papiers entre dans la bibliothèque ; sinon les objets copiés
document.addEventListener('paste', (e) => {
  if (typing(e.target) || !S.board || document.querySelector('.scrim')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); app.uploadAndPlace(files); return; }
  if (S.clip?.length) {
    e.preventDefault();
    const r = bbox(S.clip);
    const [cx, cy] = app.canvas.center();
    app.pasteAt(cx - r.w / 2, cy - r.h / 2);
  }
});
// coller les objets copiés, leur coin en (wx, wy) (le menu du fond : « Coller ici »)
app.pasteAt = (wx, wy) => {
  if (!S.board || !S.clip?.length) return;
  const r = bbox(S.clip);
  app.mutate((B) => cloneInto(B, S.clip, Math.round(wx - r.x), Math.round(wy - r.y), S.clipLinks || []));
};
// le clic droit ailleurs dans la page d'Idéation (la barre, l'inspecteur…) : un champ a son menu
// du texte, le reste le menu de la page — jamais celui du navigateur (la planche a les siens)
document.querySelector('.ide')?.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return;
  e.preventDefault();
  const fld = e.target.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
  if (fld) { menu(e.clientX, e.clientY, app.menus.text(fld)); return; }
  menu(e.clientX, e.clientY, [{ head: 'idéation' },
    { label: 'Les planches…', onclick: () => app.boardsModal() }, { label: 'Nouvelle planche…', studio: true, onclick: () => app.newBoard() },
    { label: 'Commencer un projet…', sub: 'une Team, un Workspace, tout rangé', studio: true, onclick: () => app.projet() },
    { label: 'Exporter la planche en PNG', sub: 'ordinateur + presse-papier', studio: true, disabled: !S.board?.nodes.length, why: 'la planche est vide', onclick: () => app.exportBoard('') },
    '-', { label: 'Annuler', key: 'ctrl+Z', disabled: !S.undo.length, why: 'rien à annuler', onclick: () => app.undoStep() },
    { label: 'Rétablir', key: 'ctrl+maj+Z', disabled: !S.redo.length, why: 'rien à rétablir', onclick: () => app.redoStep() },
    '-', { label: 'Les raccourcis', key: '?', onclick: () => help() }]);
});

// ── des fichiers du disque (bouton Déposer, coller) ────────
// Ce que Cal apporte de son disque entre dans la bibliothèque, catégorie
// Upload (`tool: 'upload'`), et dit qu'il est entré par ici (`via`). Le
// glisser-déposer passe par le `dropZone` du socle (canvas.js, gen.js).
app.uploadAndPlace = async (files, at = null) => {
  if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return; }
  const [wx, wy] = at || app.canvas.center();
  const got = [];
  for (const f of files) {
    toast(`dépôt · ${f.name}`, 60000);
    try { got.push(await uploadFile(f, { tool: 'upload', via: 'ideation' })); } catch (e) { toast(`${f.name} : ${e.message}`, 7000); }
  }
  // tout fichier entre dans la bibliothèque ; la planche pose les sortes qu'elle connaît (un clip MIDI reste dans Asset)
  const kinds = app.mediaKinds();
  const put = got.filter((it) => kinds.includes(it.kind));
  const left = got.filter((it) => !kinds.includes(it.kind));
  if (put.length) app.placeMany(put, wx, wy, { free: !at });
  if (got.length) {
    toast(left.length ? `rangé dans la bibliothèque · pas posé ici : ${left.map((it) => it.title || it.id).join(', ')}`
      : got.length > 1 ? `${got.length} fichiers rangés dans la bibliothèque · Upload` : 'rangé dans la bibliothèque · Upload', left.length ? 6000 : 3200);
    app.lib.reload();
  }
};
// un fichier lâché hors d'un emplacement ne doit pas remplacer la page
addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  toast('déposez sur la planche, ou dans une carte Générer');
});

// ── le départ ──────────────────────────────────────────────
app.gen = createGen(app);
app.video = createVideo(app);
app.composer = createComposer(app);
app.groups = createGroups(app);
// les objets d'atelier (objets/) : formes, cartes, mind map, crayon, et leurs gestes
app.objets = createObjets(app);
Object.assign(DEF, app.objets.defs);
// une image ou un personnage lâché sur une carte personne : son visage
app.dropRules.push(app.objets.faceRule());
// une image lâchée sur un moodboard : elle y entre (objets/moodboard.js)
if (app.moodboard?.rule) app.dropRules.push(app.moodboard.rule);
// un objet lâché sur un autre, en dernier recours (après app.dropRules) : un groupe
app.dropLast = [app.groups.rule];
app.menus = createMenus(app);
app.canvas = createCanvas(app);
app.insp = createInspector(app);
app.elementModal = (ids, name) => app.insp.elementModal(ids, name);
app.lib = createLibrary(app);
app.menu = menu;
app.objets.mount();   // ses outils dans la barre, les modèles et l'aimant sur la planche
app.setTool('select');
installPlugins(app);
// les filtres du panneau Asset suivent la carte choisie (library.js, commun/dock.js)
app.lib.follow();
// la barre sur une ligne ; ce qui n'y tient plus passe dans ⋯ (barre.js)
app.bar = installBar();
// ses commandes dans la palette ⌘K, dès que l'atelier est chargé
for (const ev of ['board', 'commit', 'selection']) app.on(ev, () => app.objets.commands());

async function start() {
  app.canvas.render();
  app.insp.render();
  paintSave(); paintUndo(); paintBar();
  try { S.meta = await api('ideation/meta'); } catch (e) { toast(`le portail ne répond pas : ${e.message}`, 8000); return; }
  // les modèles de l'outil Image et les réglages de Vidéo : lus à part, la planche n'attend
  // pas ; lus, ils refont les entrées des cartes (et les fils qui ne vont plus le disent)
  api('image/models').then((c) => { S.cfg = c; }).catch((e) => { S.cfgError = e.message; })
    .finally(() => { app.canvas.render(); app.insp.render(); });
  api('movie/options').then((o) => { S.mopts = o; }).catch((e) => { S.moptsError = e.message; })
    .finally(() => { app.canvas.render(); app.insp.render(); });
  // « Commencer un projet » (l'accueil : ?projet=nouveau ; docs/etudes/mode_showrunner.md) : pas de
  // planche — elle naîtra dans le Workspace neuf ; la fenêtre par-dessus. Fermée sans commencer :
  // le départ ordinaire
  if (new URLSearchParams(location.search).get('projet') === 'nouveau') { app.projet({ annule: ouvrirDerniere }); return; }
  await ouvrirDerniere();
}
// la planche de l'adresse, sinon la dernière ouverte ici, sinon la plus récente
async function ouvrirDerniere() {
  const want = location.hash.slice(1) || LS('last');
  if (want && await openBoard(want)) return;
  const { boards } = await api('ideation/boards', { espace: espace() }).catch(() => ({ boards: [] }));
  if (boards.length) await openBoard(boards[0].id);
  else { app.canvas.render(); app.insp.render(); }
}
addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== S.board?.id) openBoard(id); });
// changer de Workspace (l'en-tête) ne recharge pas Idéation : la planche ouverte reste ouverte, dans
// le sien (l'en-tête le dit) ; « Planches » liste celles du nouveau Workspace
surEspace(() => paintBar());
start();

// pour les essais (playwright) et le débogage : l'état, en lecture
window.ideation = { S, app, flow: () => app.flowNow() };
