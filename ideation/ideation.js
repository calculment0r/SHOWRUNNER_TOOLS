// IDÉATION — le canvas d'idéation du portail : des planches où Cal pose,
// rapproche et fait naître des idées visuelles (images, vidéos, sons,
// personnages, notes, post-it, cadres, cartes « Générer »), avant de
// passer aux outils de production. L'étude : docs/etudes/ideation.md.
//
// Ce module tient la planche : l'ouvrir, l'enregistrer seule (600 ms après
// le dernier geste, avec sa version : un autre onglet ne l'écrase pas en
// silence), annuler et rétablir, le clavier, le dépôt de fichiers, et les
// gestes qui touchent plusieurs objets. Le canvas (canvas.js), la
// bibliothèque (library.js), l'inspecteur (inspector.js) et les générations
// (gen.js) passent tous par `app`.

import { mountHeader, api, jobs, toast, el, $, href, fmtDate, uploadFile, pick } from '../commun/shell.js';
import { createCanvas, bbox, menu } from './canvas.js';
import { createGen } from './gen.js';
import { createInspector } from './inspector.js';
import { createLibrary, cfElement } from './library.js';
import { installPlugins } from './plugins.js';

mountHeader('ideation', { sub: 'planches · idées' });

const S = {
  meta: null, cfg: null, cfgError: '', board: null, rev: 0,
  items: new Map(), jobs: new Map(),
  sel: new Set(), link: null, tool: 'select', space: false, grid: true,
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

// ── les libellés ───────────────────────────────────────────
app.label = (n) => {
  if (!n) return '?';
  const cut = (s, k = 42) => { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length > k ? s.slice(0, k - 1) + '…' : s; };
  if (n.type === 'media') return cut(S.items.get(n.item)?.title || n.title || n.item);
  if (n.type === 'frame') return cut(n.name || 'Cadre');
  if (n.type === 'gen') return 'Générer · ' + cut(n.prompt || '—', 30);
  if (n.type === 'palette') return 'Nuancier';
  return cut(n.text || { note: 'note vide', sticky: 'post-it vide', title: 'titre vide' }[n.type]);
};
app.kindLabel = (n) => (n.type === 'media' ? { image: 'image', video: 'vidéo', audio: 'son', element: 'élément' }[n.kind]
  : { note: 'note', sticky: 'post-it', title: 'titre', frame: 'cadre', gen: 'générer', palette: 'nuancier' }[n.type]);

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
app.commit = () => { app.touch(); app.canvas.render(); app.insp.render(); paintBar(); };
app.mutate = (fn) => { if (!S.board) return; app.snap(); fn(S.board); pruneSel(); app.commit(); };
// un changement qui n'est pas un geste de Cal (un travail qui avance) : ni annuler ni rétablir
app.quiet = (fn) => { if (!S.board) return; fn(S.board); app.touch(); app.canvas.render(); };
// un champ qu'on remplit : un seul pas d'annulation pour toute la saisie
app.editing = () => { let done = false; return () => { if (!done) { app.snap(); done = true; } app.touch(); }; };

function pruneSel() {
  for (const id of [...S.sel]) if (!app.node(id)) S.sel.delete(id);
  if (S.link && !S.board.links.some((l) => l.id === S.link)) S.link = null;
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
  const body = { name: b.name, nodes: b.nodes, links: b.links, base_rev: S.rev };
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
  const body = JSON.stringify({ name: b.name, nodes: b.nodes, links: b.links, base_rev: S.rev });
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
  palette: () => ({ w: 280, h: 64, colors: [] }),
};
app.addAt = (type, wx, wy, { edit = false, select = true, link = null, w, h } = {}) => {
  if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return null; }
  const n = { id: app.uid('n'), type, x: Math.round(wx), y: Math.round(wy), ...DEF[type]() };
  if (w) n.w = Math.round(w);
  if (h) n.h = Math.round(h);
  app.mutate((B) => {
    B.nodes.push(n);
    if (link && app.node(link)) B.links.push({ id: app.uid('l'), a: link, b: n.id, kind: 'arrow', label: '' });
    if (select) { S.sel = new Set([n.id]); S.link = null; }
  });
  if (edit) setTimeout(() => app.canvas.editText(n.id), 30);
  if (type === 'gen') setTimeout(() => app.canvas.dom.get(n.id)?.el.querySelector('textarea')?.focus({ preventScroll: true }), 30);
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
// des références ajoutées à une carte Générer (déposées dans la carte, ou prises dans la
// bibliothèque) : posées à sa gauche, reliées à elle — la planche montre d'où elles viennent
app.addRefs = (genId, items) => {
  const g = app.node(genId);
  if (!g || !items.length) return;
  const have = new Set(app.gen.refsOf(g).map((n) => n.item));
  const fresh = items.filter((it) => ['image', 'element'].includes(it.kind) && !have.has(it.id));
  if (!fresh.length) { toast('déjà en référence'); return; }
  for (const it of fresh) S.items.set(it.id, it);
  app.mutate((B) => {
    for (const it of fresh) {
      // un objet déjà sur la planche est relié tel quel ; sinon il se pose à gauche de la carte
      let n = B.nodes.find((x) => x.type === 'media' && x.item === it.id);
      if (!n) {
        const [w, h] = app.sizeFor(it, 180);
        const [x, y] = app.freeSpot(g.x - w - 70, g.y, w, h);
        n = app.newMedia(it, x, y, w, h);
        B.nodes.push(n);
      }
      B.links.push({ id: app.uid('l'), a: n.id, b: g.id, kind: 'arrow', label: '' });
    }
  });
  const m = app.gen.M(g.model);
  const k = app.gen.refsOf(g).length;
  if (m && k > m.refs) toast(`${m.name} prend ${m.refs} référence${m.refs > 1 ? 's' : ''} au plus — ${k} reliées : la carte le dit`, 6000);
};
app.pickRefs = async (genId) => {
  const got = await pick({ kinds: ['image', 'element'], multiple: true, title: 'Références de la carte' });
  app.addRefs(genId, got);
};
app.connect = (a, b) => {
  if (S.board.links.some((l) => l.a === a && l.b === b)) { toast('ces deux objets sont déjà reliés'); return; }
  const A = app.node(a), B = app.node(b);
  app.mutate((P) => { P.links.push({ id: app.uid('l'), a, b, kind: 'arrow', label: '' }); });
  if (B?.type === 'gen' && A?.type === 'media' && ['image', 'element'].includes(A.kind)) {
    const m = app.gen.M(B.model);
    const k = app.gen.refsOf(B).length;
    toast(m && k > m.refs ? `${m.name} prend ${m.refs} référence${m.refs > 1 ? 's' : ''} au plus : la carte le dit` : `référence ${k} de la carte Générer`);
  }
};
app.genWith = (ids) => {
  const refs = ids.map((id) => app.node(id)).filter(Boolean);
  const r = bbox(refs);
  const g = { id: app.uid('n'), type: 'gen', ...DEF.gen(), x: Math.round(r.x + r.w + 90), y: Math.round(r.y) };
  if (refs.length > 2 && g.model !== 'qwen21') g.model = 'qwen21';
  app.mutate((B) => {
    B.nodes.push(g);
    for (const n of refs) B.links.push({ id: app.uid('l'), a: n.id, b: g.id, kind: 'arrow', label: '' });
    S.sel = new Set([g.id]); S.link = null;
  });
  setTimeout(() => app.canvas.dom.get(g.id)?.el.querySelector('textarea')?.focus({ preventScroll: true }), 30);
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
const selected = () => [...S.sel].map(app.node).filter(Boolean);
app.remove = () => {
  if (S.link && !S.sel.size) { app.mutate((B) => { B.links = B.links.filter((l) => l.id !== S.link); }); S.link = null; app.insp.render(); return; }
  if (!S.sel.size) return;
  const gone = new Set(S.sel);
  app.mutate((B) => {
    B.nodes = B.nodes.filter((n) => !gone.has(n.id));
    B.links = B.links.filter((l) => !gone.has(l.a) && !gone.has(l.b));
    S.sel.clear();
  });
};
// des copies, décalées, avec les liens qui les reliaient entre elles
function cloneInto(B, list, dx, dy, links) {
  const map = new Map();
  for (const n of list) {
    const c = JSON.parse(JSON.stringify(n));
    c.id = app.uid('n'); c.x += dx; c.y += dy;
    if (c.jobs) c.jobs = [];
    map.set(n.id, c.id);
    B.nodes.push(c);
  }
  for (const l of links) if (map.has(l.a) && map.has(l.b)) B.links.push({ ...l, id: app.uid('l'), a: map.get(l.a), b: map.get(l.b) });
  S.sel = new Set(map.values());
}
app.duplicate = () => {
  const list = selected();
  if (!list.length) return;
  app.mutate((B) => cloneInto(B, list, 30, 30, B.links.slice()));
};
app.order = (dir) => {
  if (!S.sel.size) return;
  app.mutate((B) => {
    const mine = B.nodes.filter((n) => S.sel.has(n.id)), rest = B.nodes.filter((n) => !S.sel.has(n.id));
    B.nodes = dir > 0 ? [...rest, ...mine] : [...mine, ...rest];
  });
};
app.frameAround = () => {
  const list = selected();
  const r = bbox(list);
  if (!r) return;
  const pad = 36;
  app.mutate((B) => {
    const f = { id: app.uid('n'), type: 'frame', ...DEF.frame(), x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
    B.nodes.unshift(f);
    S.sel = new Set([f.id]);
  });
  setTimeout(() => app.canvas.renameFrame([...S.sel][0]), 30);
};
app.align = (k) => {
  const list = selected();
  const r = bbox(list);
  if (!r || list.length < 2) return;
  app.mutate(() => {
    for (const n of list) {
      if (k === 'left') n.x = r.x;
      if (k === 'right') n.x = r.x + r.w - n.w;
      if (k === 'hcenter') n.x = Math.round(r.x + r.w / 2 - n.w / 2);
      if (k === 'top') n.y = r.y;
      if (k === 'bottom') n.y = r.y + r.h - n.h;
      if (k === 'vmiddle') n.y = Math.round(r.y + r.h / 2 - n.h / 2);
    }
  });
};
app.distribute = (axis) => {
  const list = selected();
  if (list.length < 3) return;
  const W = axis === 'x' ? 'w' : 'h';
  const s = [...list].sort((a, b) => a[axis] - b[axis]);
  const span = s[s.length - 1][axis] + s[s.length - 1][W] - s[0][axis];
  const gap = (span - s.reduce((t, n) => t + n[W], 0)) / (s.length - 1);
  app.mutate(() => { let p = s[0][axis]; for (const n of s) { n[axis] = Math.round(p); p += n[W] + gap; } });
};
// ranger en grille : les objets choisis, dans l'ordre de lecture, en colonnes régulières
app.tidy = () => {
  const list = selected().filter((n) => n.type !== 'frame');
  if (list.length < 2) return;
  const r = bbox(list);
  const cols = Math.max(1, Math.round(Math.sqrt(list.length * 1.4)));
  const cw = Math.max(...list.map((n) => n.w)) + 24;
  const s = [...list].sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x));
  app.mutate(() => {
    let y = r.y;
    for (let i = 0; i < s.length; i += cols) {
      const line = s.slice(i, i + cols);
      line.forEach((n, k) => { n.x = r.x + k * cw; n.y = y; });
      y += Math.max(...line.map((n) => n.h)) + 24;
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
    const kinds = Object.entries(bd.kinds || {}).map(([k, v]) => `${v} ${({ image: 'image', video: 'vidéo', audio: 'son', element: 'élément', note: 'note', sticky: 'post-it', title: 'titre', frame: 'cadre', gen: 'carte', palette: 'nuancier' })[k] || k}${v > 1 && !['son'].includes(k) ? 's' : ''}`).join(' · ');
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

async function ensureItems(ids) {
  const want = [...new Set(ids)].filter((id) => !S.items.has(id));
  for (let i = 0; i < want.length; i += 8) {
    await Promise.all(want.slice(i, i + 8).map((id) => api('library/' + id)
      .then((it) => S.items.set(id, it)).catch(() => S.items.set(id, { id, missing: true }))));
  }
}

async function openBoard(id, { force = false } = {}) {
  if (!force && S.board && S.board.id !== id) await flushSave();
  let b;
  try { b = await api('ideation/boards/' + id); } catch (e) { toast(e.message, 6000); return false; }
  S.board = b; S.rev = b.rev;
  S.undo = []; S.redo = []; S.sel = new Set(); S.link = null; S.dirty = false; S.conflict = false; S.clip = null;
  $('#conflict').hidden = true;
  LS('last', id);
  if (location.hash.slice(1) !== id) history.replaceState(null, '', location.pathname + '#' + id);
  $('#b-name').value = b.name;
  document.title = `${b.name} · Idéation`;
  await ensureItems(b.nodes.filter((n) => n.type === 'media').map((n) => n.item));
  const v = LS('view-' + id);
  if (v && Number.isFinite(v.z)) S.view = v;
  app.canvas.render();
  if (!v) app.canvas.fit(); else app.canvas.applyView();
  app.insp.render();
  paintUndo(); paintSave(); paintBar();
  app.gen.resume();
  return true;
}
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
  const K = [['V', 'choisir'], ['H · espace', 'se déplacer'], ['L', 'relier deux objets'], ['N', 'note'], ['S', 'post-it'], ['T', 'titre'], ['F', 'cadre (tracer)'],
    ['G', 'carte Générer'], ['molette · pincer', 'zoomer'], ['Maj+1 · Maj+0', 'tout voir · 100 %'], ['glisser le fond', 'cadre de sélection'], ['Alt + glisser', 'lasso'],
    ['Maj + clic', 'ajouter, retirer'], ['ctrl+A', 'tout choisir'], ['ctrl+D', 'dupliquer'], ['ctrl+C · ctrl+V', 'copier, coller (et coller une image)'],
    ['Suppr', 'supprimer'], ['[ · ]', 'arrière-plan · premier plan'], ['flèches', 'déplacer (Maj : 10)'], ['Entrée · double-clic', 'écrire'],
    ['ctrl+Z · ctrl+maj+Z', 'annuler · rétablir'], ['Échap', 'rien choisi']];
  app.modal('Raccourcis', el('dl', { class: 'keys' }, ...K.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])));
}

// ── le clavier ─────────────────────────────────────────────
const typing = (t) => t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
document.addEventListener('keydown', (e) => {
  if (typing(e.target) || document.querySelector('.scrim')) return;
  const k = e.key, mod = e.ctrlKey || e.metaKey, low = k.toLowerCase();
  if (k === ' ') { e.preventDefault(); if (!S.space) { S.space = true; app.canvas.el.classList.add('space'); } return; }
  if (!S.board) return;
  if (mod && low === 'z') { e.preventDefault(); if (e.shiftKey) app.redoStep(); else app.undoStep(); return; }
  if (mod && low === 'y') { e.preventDefault(); app.redoStep(); return; }
  if (mod && low === 'd') { e.preventDefault(); app.duplicate(); return; }
  if (mod && low === 'a') { e.preventDefault(); app.select(S.board.nodes.map((n) => n.id)); return; }
  if (mod && (low === 'c' || low === 'x')) {
    const list = selected();
    if (!list.length) return;
    S.clip = JSON.parse(JSON.stringify(list));
    S.clipLinks = S.board.links.filter((l) => S.sel.has(l.a) && S.sel.has(l.b));
    toast(`${list.length} objet${list.length > 1 ? 's' : ''} copié${list.length > 1 ? 's' : ''}`);
    if (low === 'x') app.remove();
    return;
  }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); app.remove(); return; }
  if (k === 'Escape') { S.sel.clear(); S.link = null; app.setTool('select'); app.selectionChanged(); app.canvas.paintLinks(); return; }
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
    for (const n of selected()) { n.x += dx; n.y += dy; }
    app.touch(); app.canvas.render();
    clearTimeout(arrowT); arrowT = setTimeout(() => { arrowSnap = false; }, 600);
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
  const T = { v: 'select', h: 'hand', l: 'link', n: 'note', s: 'sticky', t: 'title', f: 'frame', g: 'gen' }[low];
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
    app.mutate((B) => cloneInto(B, S.clip, Math.round(cx - r.x - r.w / 2), Math.round(cy - r.y - r.h / 2), S.clipLinks || []));
  }
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
  // les modèles de l'outil Image : lus à part, la planche n'attend pas
  api('image/models').then((c) => { S.cfg = c; }).catch((e) => { S.cfgError = e.message; })
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
window.ideation = { S, app };
