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

import { mountHeader, api, jobs, toast, el, $, href, fmtDate, uploadFile, pick } from '../commun/shell.js';
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
import { flow, canWire, replaces, portOf, outPort, nameOf, newSlots, newSlot, TEXT_TYPES } from './ports.js';

mountHeader('ideation', { sub: 'planches · idées' });

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
  return cut(n.text || { note: 'note vide', sticky: 'post-it vide', title: 'titre vide' }[n.type]);
};
app.kindLabel = (n) => (n.type === 'media' ? { image: 'image', video: 'vidéo', audio: 'son', element: 'élément' }[n.kind]
  : { note: 'note', sticky: 'post-it', title: 'titre', frame: 'cadre', group: 'groupe', gen: 'image', vgen: 'vidéo', compose: 'composeur', palette: 'nuancier' }[n.type]);

// ── annuler, rétablir, enregistrer ─────────────────────────
const snapshot = () => JSON.stringify({ name: S.board.name, nodes: S.board.nodes, links: S.board.links });
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
  $('#b-name').value = o.name;
  pruneSel();
  app.commit();
}
app.undoStep = () => { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); paintUndo(); };
app.redoStep = () => { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); paintUndo(); };
function paintUndo() { $('#b-undo').disabled = !S.undo.length; $('#b-redo').disabled = !S.redo.length; }

let saveT = 0;
function scheduleSave() { paintSave(); clearTimeout(saveT); saveT = setTimeout(flushSave, 600); }
async function flushSave() {
  clearTimeout(saveT);
  if (!S.board || !S.dirty || S.conflict) return;
  if (S.saving) { S.again = true; return S.saving; }
  const b = S.board;
  const body = { name: b.name, v: b.v, nodes: b.nodes, links: b.links, base_rev: S.rev };
  S.dirty = false;
  paintSave();
  S.saving = api(`ideation/boards/${b.id}`, { method: 'POST', body }).then((r) => {
    if (S.board?.id === b.id) { S.rev = r.rev; b.updated = r.updated; b.rev = r.rev; }
  }).catch((e) => {
    if (e.status === 409) { S.conflict = true; $('#conflict').hidden = false; }
    else { S.dirty = true; toast(`enregistrement impossible : ${e.message}`, 7000); }
  }).finally(() => {
    S.saving = null;
    paintSave();
    if (S.again) { S.again = false; if (S.dirty) flushSave(); }
  });
  return S.saving;
}
app.flushSave = flushSave;
function paintSave() {
  const p = $('#save-st');
  const [cls, txt] = S.conflict ? ['err', 'conflit'] : S.saving ? ['work', 'enregistre'] : S.dirty ? ['work', 'modifiée'] : S.board ? ['on', 'enregistrée'] : ['', '—'];
  p.className = 'pill ' + cls;
  p.lastChild.textContent = txt;
}
addEventListener('beforeunload', () => {
  if (!S.dirty || !S.board || S.conflict) return;
  const b = S.board;
  const body = JSON.stringify({ name: b.name, v: b.v, nodes: b.nodes, links: b.links, base_rev: S.rev });
  try { navigator.sendBeacon(href(`api/ideation/boards/${b.id}`), new Blob([body], { type: 'application/json' })); } catch { /* */ }
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
  for (const b of document.querySelectorAll('#tools [data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
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
// poser un objet ; `link` : une flèche d'annotation depuis cet objet ; `wireIn` : { from, pa, pb }
// un fil qui y entre ; `wireOut` : { to, pb } un fil qui en part ; `preset` : ses réglages
app.addAt = (type, wx, wy, { edit = false, select = true, link = null, w, h, preset = null, wireIn = null, wireOut = null } = {}) => {
  if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return null; }
  const n = { id: app.uid('n'), type, x: Math.round(wx), y: Math.round(wy), ...DEF[type](), ...(preset ? JSON.parse(JSON.stringify(preset)) : {}) };
  if (w) n.w = Math.round(w);
  if (h) n.h = Math.round(h);
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
app.pickAt = async (wx, wy) => {
  const got = await pick({ kinds: ['image', 'video', 'audio', 'element'], multiple: true, title: 'Poser sur la planche' });
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
const selectedAll = () => app.groups.expand(selected());
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
  S.sel = new Set(made.filter((c) => !c.group || !groups.has(c.group)).map((c) => c.id));
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
app.align = (k) => {
  const list = selected();
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
  const list = selected();
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
  const list = selected().filter((n) => n.type !== 'frame');
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
app.sameSize = (axis) => {
  const list = selected();
  if (list.length === 1 && list[0].type === 'group') { app.groups.fit(list[0].id, axis); return; }
  const objs = list.filter((n) => n.type !== 'group' && n.type !== 'frame');
  if (objs.length < 2) { toast('choisissez au moins deux objets'); return; }
  const ref = axis === 'h' ? objs[0].h : objs[0].w;
  app.mutate(() => { for (const n of objs.slice(1)) setSize(n, axis, ref); });
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
  const media = n.kind === 'video' ? el('video', { src: href(it.url), controls: true, autoplay: true, loop: true }) : el('img', { src: href(it.url), alt: it.title || '' });
  app.modal(it.title || it.id, el('div', { class: 'lightbox' }, media), null, { cls: 'lb' });
};

// ── les planches ───────────────────────────────────────────
app.newBoard = async () => {
  const d = new Date();
  const name = await askName('Nouvelle planche', `Planche du ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`);
  if (!name) return null;
  let b;
  try { b = await api('ideation/boards', { method: 'POST', body: { name } }); } catch (e) { toast(e.message, 6000); return null; }
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
    const kinds = Object.entries(bd.kinds || {}).map(([k, v]) => `${v} ${({ image: 'image', video: 'vidéo', audio: 'son', element: 'élément', note: 'note', sticky: 'post-it', title: 'titre', frame: 'cadre', group: 'groupe', gen: 'carte image', vgen: 'carte vidéo', compose: 'composeur', palette: 'nuancier' })[k] || k}${v > 1 && !['son'].includes(k) ? 's' : ''}`).join(' · ');
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
        el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => {
          if (S.board?.id === bd.id) await flushSave();
          try { const r = await api(`ideation/boards/${bd.id}/duplicate`, { method: 'POST' }); list.unshift(r); paint(); toast(`« ${r.name} » créée`); } catch (e) { toast(e.message); }
        } }, 'Dupliquer'),
        del));
  };
  const close = app.modal('Les planches', el('div', { class: 'stack' }, count, box),
    (cl) => [el('span', { class: 'sp' }), el('button', { class: 'tb go', type: 'button', onclick: async () => { cl(); await app.newBoard(); } }, 'Nouvelle planche')],
    { cls: 'lg' });
  if (S.board) await flushSave();
  try { ({ boards: list } = await api('ideation/boards')); } catch (e) { box.replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
  paint();
};

// les fiches des objets posés : par paquets de 500, une requête chacun (POST /api/library/batch ;
// une planche de 1000 images en faisait 1000 — étude de fluidité, § 2.2) ; un serveur sans lot :
// une par objet, huit à la fois
async function ensureItems(ids) {
  const want = [...new Set(ids)].filter((id) => !S.items.has(id));
  const one = (list) => Promise.all(list.map((id) => api('library/' + id)
    .then((it) => S.items.set(id, it)).catch(() => S.items.set(id, { id, missing: true }))));
  for (let i = 0; i < want.length; i += 500) {
    const chunk = want.slice(i, i + 500);
    try {
      const r = await api('library/batch', { method: 'POST', body: { ids: chunk } });
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
  S.undo = []; S.redo = []; S.sel = new Set(); S.link = null; S.focus = null; S.dirty = false; S.conflict = false; S.clip = null;
  $('#conflict').hidden = true;
  LS('last', id);
  if (location.hash.slice(1) !== id) history.replaceState(null, '', location.pathname + '#' + id);
  $('#b-name').value = b.name;
  document.title = `${b.name} · Idéation`;
  await ensureItems(b.nodes.filter((n) => n.type === 'media').map((n) => n.item));
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
function closeBoard() {
  S.board = null; S.sel.clear(); S.link = null;
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
  let j;
  try { j = await api(`ideation/boards/${S.board.id}/export`, { method: 'POST', body: { frame } }); } catch (e) { toast(e.message, 6000); return; }
  const st = $('#exp-st');
  st.hidden = false;
  st.replaceChildren(el('span', { class: 'pill work' }, el('i'), el('span', {}, 'export en file')));
  const done = await jobs.wait(j.id, (x) => {
    st.firstChild.lastChild.textContent = x.state === 'running' ? `export ${Math.round((x.progress || 0) * 100)} %` : 'export en file';
  }).catch((e) => ({ state: 'error', message: e.message }));
  if (done.state !== 'done' || !done.items?.length) {
    st.replaceChildren(el('span', { class: 'pill err', title: done.message || '' }, el('i'), el('span', {}, 'export en échec')));
    toast(`export : ${done.message}`, 8000);
    return;
  }
  const it = done.items[0];
  st.replaceChildren(el('a', { class: 'tb ghost sm', href: href(`asset/#${it.id}`), target: '_blank', rel: 'noopener', title: `${it.title} — ${it.width} × ${it.height}` },
    `PNG ${it.width} × ${it.height} · Asset ↗`));
  toast(`« ${it.title} » est dans la bibliothèque (dossier Idéation)`);
  app.lib.reload();
};

// ── la barre ───────────────────────────────────────────────
function paintBar() {
  const f = S.sel.size === 1 && app.node([...S.sel][0])?.type === 'frame';
  const ex = $('#b-export');
  ex.textContent = f ? 'Exporter le cadre' : 'Exporter';
  ex.title = f ? 'ce cadre en PNG, dans la bibliothèque' : 'la planche en PNG, dans la bibliothèque (dossier Idéation)';
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
$('#b-lib').addEventListener('click', () => {
  const on = document.body.classList.toggle('nolib');
  LS('nolib', on);
  $('#b-lib').classList.toggle('on', !on);
  setTimeout(() => app.canvas.paintMini(), 250);
});
if (LS('nolib')) { document.body.classList.add('nolib'); $('#b-lib').classList.remove('on'); }
for (const b of document.querySelectorAll('#tools [data-tool]')) b.addEventListener('click', () => app.setTool(b.dataset.tool));
$('#b-help').addEventListener('click', help);
function help() {
  const K = [['V', 'choisir'], ['H · espace', 'se déplacer'], ['L', 'une flèche d’annotation'], ['N', 'note'], ['S', 'post-it'], ['T', 'titre'], ['F', 'cadre (tracer)'],
    ['G', 'carte Générer image'], ['M', 'carte Générer vidéo'], ['P', 'composeur de prompt'],
    ['tirer une sortie', 'un fil : sur une carte, la bonne entrée ; dans le vide, un objet déjà branché'], ['texte sur texte', 'un composeur'],
    ['texte sur une carte Générer', 'un composeur'],
    ['un objet lâché sur un autre', 'un groupe (Alt : poser par-dessus) ; une image sur une carte : sa référence'],
    ['ctrl+G · ctrl+maj+G', 'grouper · dégrouper'], ['double-clic dans un groupe · Échap', 'choisir l’objet · remonter au groupe'],
    ['ctrl+alt+G', 'encadrer la sélection'], ['Alt+A · D · W · S', 'aligner à gauche, à droite, en haut, en bas'], ['Alt+H · Alt+V', 'aligner les centres'],
    ['Alt+maj+H · V', 'distribuer'], ['ctrl+alt+T', 'ranger'],
    ['molette · pincer', 'zoomer'], ['Maj+1 · Maj+0', 'tout voir · 100 %'], ['glisser le fond', 'cadre de sélection'], ['Alt + glisser', 'lasso'],
    ['Maj + clic', 'ajouter, retirer'], ['ctrl+A', 'tout choisir'], ['ctrl+D', 'dupliquer'], ['ctrl+C · ctrl+V', 'copier, coller (et coller une image)'],
    ['Suppr', 'supprimer'], ['[ · ]', 'arrière-plan · premier plan'], ['flèches', 'déplacer (Maj : 10)'], ['Entrée · double-clic', 'écrire'],
    ['ctrl+Z · ctrl+maj+Z', 'annuler · rétablir'], ['Échap', 'remonter au groupe, puis rien choisi']];
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
    S.sel.clear(); S.link = null; app.setTool('select'); app.selectionChanged(); app.canvas.paintLinks(); return;
  }
  // aligner et distribuer au clavier (Figma, tldraw) — pas de raccourci pour « même taille »
  if (e.altKey && !mod && S.sel.size > 1) {
    // la lettre inscrite sur la touche (AZERTY compris), sinon sa place (Alt+lettre peut rendre un signe)
    const L = /^[a-z]$/.test(low) ? low : (e.code || '').replace(/^Key/, '').toLowerCase();
    const A = { a: 'left', d: 'right', w: 'top', s: 'bottom', h: 'hcenter', v: 'vmiddle' }[L];
    if (e.shiftKey && (L === 'h' || L === 'v')) { e.preventDefault(); app.distribute(L === 'h' ? 'x' : 'y'); return; }
    if (A && !e.shiftKey) { e.preventDefault(); app.align(A); return; }
  }
  if (k === 'Enter' && S.sel.size === 1) {
    const n = app.node([...S.sel][0]);
    if (n && ['note', 'sticky', 'title'].includes(n.type)) { e.preventDefault(); app.canvas.editText(n.id); }
    if (n && n.type === 'frame') { e.preventDefault(); app.canvas.renameFrame(n.id); }
    return;
  }
  if (k.startsWith('Arrow') && S.sel.size) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    const [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[k];
    if (!arrowSnap) { app.snap(); arrowSnap = true; }
    for (const n of selectedAll()) { n.x += dx; n.y += dy; }
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
    { label: 'Les planches…', onclick: () => app.boardsModal() }, { label: 'Nouvelle planche…', onclick: () => app.newBoard() },
    { label: 'Exporter la planche en PNG', sub: 'dans la bibliothèque', disabled: !S.board?.nodes.length, why: 'la planche est vide', onclick: () => app.exportBoard('') },
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
  if (got.length) {
    app.placeMany(got, wx, wy, { free: !at });
    toast(got.length > 1 ? `${got.length} fichiers rangés dans la bibliothèque · Upload` : 'rangé dans la bibliothèque · Upload');
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
// un objet lâché sur un autre, en dernier recours (après app.dropRules) : un groupe
app.dropLast = [app.groups.rule];
app.menus = createMenus(app);
app.canvas = createCanvas(app);
app.insp = createInspector(app);
app.elementModal = (ids, name) => app.insp.elementModal(ids, name);
app.lib = createLibrary(app);
app.menu = menu;
app.setTool('select');
installPlugins(app);

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
  const want = location.hash.slice(1) || LS('last');
  if (want && await openBoard(want)) return;
  const { boards } = await api('ideation/boards').catch(() => ({ boards: [] }));
  if (boards.length) await openBoard(boards[0].id);
  else { app.canvas.render(); app.insp.render(); }
}
addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== S.board?.id) openBoard(id); });
start();

// pour les essais (playwright) et le débogage : l'état, en lecture
window.ideation = { S, app, flow: () => app.flowNow() };
