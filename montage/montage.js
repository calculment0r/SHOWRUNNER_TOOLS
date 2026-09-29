// MONTAGE — le banc de montage du portail.
//
// Un montage = un projet sur le serveur (server/tools/montage.py), écrit
// seul après chaque geste : pas de bouton « enregistrer ». Chaque geste
// passe par `commit(nom, p => …)` : une entrée d'annulation (ctrl+Z /
// ctrl+maj+Z), un enregistrement, un redessin. Le chutier est la
// bibliothèque commune (vidéos, images, sons), rangée dans les dossiers du
// projet ; l'export est un travail de la file (`montage.export`, voie cpu,
// ffmpeg) qui range la vidéo dans la bibliothèque.
//
// Les outils, les raccourcis et les menus du clic droit reprennent ceux de
// Premiere Pro (documentation d'Adobe ; la carte des menus et les sources :
// docs/etudes/montage.md). Les menus passent par commun/menu.js, les
// panneaux se redimensionnent par commun/split.js.
//
// Envoi depuis un autre outil : montage/?add=<id> pose l'objet au bout de
// la piste cible du montage ouvert (le dernier ouvert, sinon un nouveau).

import { mountHeader, api, jobs, el, $, $$, toast, href, uploadFile, dropAnywhere, dropZone, dragItem, ITEM_MIME, fmtDate, stateFr } from '../commun/shell.js';
import { menu, contextMenu, pageMenu } from '../commun/menu.js';
import { split } from '../commun/split.js';
import * as M from './model.js';
import { Program, Source, tempGains } from './player.js';
import { Timeline } from './timeline.js';
import { getLut, getMini, lutGL } from './lut.js';
import { mountProject, MULTI_MIME } from './projet.js';
import { createUndo } from '../commun/undo.js';

mountHeader('montage');

const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return null; };

const S = {
  p: null, rev: 0, meta: null,
  sel: new Set(), gap: null,
  tool: 'select', snap: true, focus: 'program',
  target: { video: 'V1', audio: 'A1' },
  undo: [], redo: [], pending: null, gesture: null,
  items: new Map(),
  clip: LS('montage-clipboard'), luts: [], safe: !!LS('montage-safe'),
  dirty: false, saving: null, conflict: false,
  dragging: null, shuttle: 0,
  exportJob: null, exports: [],
};

// ── le projet en mémoire ────────────────────────────────────
const core = (p) => JSON.stringify({ name: p.name, settings: p.settings, tracks: p.tracks, clips: p.clips, markers: p.markers, range: p.range });
const fps = () => S.p.settings.fps;
const lockedTracks = (p = S.p) => M.lockedSet(p);
const itemOf = (id) => { const it = S.items.get(id); return it && !it.missing ? it : undefined; };
const body = (p, extra = {}) => ({ name: p.name, settings: { format: p.settings.format, fps: p.settings.fps, still: p.settings.still, width: p.settings.width, height: p.settings.height },
  tracks: p.tracks, clips: p.clips, markers: p.markers, range: p.range, ...extra });

async function ensureItems(ids) {
  const miss = [...new Set(ids)].filter((id) => !S.items.has(id));
  await Promise.all(miss.map(async (id) => {
    try { S.items.set(id, await api('library/' + id)); } catch { S.items.set(id, { id, missing: true, title: '(introuvable)' }); }
  }));
}

// ── l'annulation : commun/undo.js, une pile par séquence ────
// Chaque séquence ouverte a sa pile (createUndo), activée avec son onglet :
// ctrl+Z, ctrl+maj+Z / ctrl+Y, les boutons et le journal viennent du
// gestionnaire commun. Un geste de la timeline s'y range comme l'état d'avant
// et d'après de la séquence ; un geste de la bibliothèque (ranger, renommer,
// jeter) comme ses deux fonctions (pushLibUndo).
const undos = new Map();
const baseU = createUndo({ name: 'montage', onapply: () => paintBar() });   // sans séquence ouverte : les gestes du Projet
let U = baseU;
function undoFor(id) {
  if (!undos.has(id)) undos.set(id, createUndo({ name: 'montage · ' + id, onapply: () => paintBar() }));
  return undos.get(id);
}
function useUndo(u) {
  U = u;
  U.activate();
  const box = $('#undo-box');
  if (box) box.replaceChildren(...U.buttons());
}
// ranger un geste de la séquence ouverte : on le rejoue sur elle seule
function recordSeq(label, before, after) {
  const sid = S.p.id;
  const go = (s) => { if (!S.p || S.p.id !== sid) throw new Error('cette séquence n’est plus ouverte'); restore(s); };
  U.record({ label, undo: () => go(before), redo: () => go(after) });
}

function commit(label, fn) {
  if (!S.p) return;
  const before = core(S.p);
  fn(S.p);
  const after = core(S.p);
  if (after === before) return;
  recordSeq(label, before, after);
  changed();
}

// un réglage continu (curseur) : une seule entrée d'annulation pour tout le geste
function beginEdit(label) { if (!S.pending && S.p) S.pending = { label, s: core(S.p) }; }
function endEdit() {
  const pend = S.pending;
  S.pending = null;
  if (!pend || !S.p || core(S.p) === pend.s) return;
  recordSeq(pend.label, pend.s, core(S.p));
  changed({ inspector: false });
}
let liveRaf = 0;
function live() {
  if (liveRaf) return;
  liveRaf = requestAnimationFrame(() => { liveRaf = 0; program.invalidate(); timeline.render(); });
}

// Un geste de la timeline vu en direct (propagation, coupe, vitesse, slip,
// slide) : chaque mouvement repart des plans d'avant le geste.
const gesture = {
  begin(label) { S.gesture = { label, s: core(S.p), clips: JSON.stringify(S.p.clips) }; },
  apply(fn) { const g = S.gesture; if (!g) return; S.p.clips = JSON.parse(g.clips); fn(S.p); live(); },
  end() {
    const g = S.gesture;
    S.gesture = null;
    if (!g) return;
    if (core(S.p) === g.s) { program.invalidate(); timeline.render(); return; }
    recordSeq(g.label, g.s, core(S.p));
    changed();
  },
};

function changed({ inspector = true } = {}) {
  const ids = new Set(S.p.clips.map((c) => c.id));
  for (const id of [...S.sel]) if (!ids.has(id)) S.sel.delete(id);
  if (S.gap && !M.gapAt(S.p, S.gap.track, S.gap.s)) S.gap = null;
  validTargets();
  program.invalidate();
  timeline.render();
  if (inspector) paintInspector();
  paintBar();
  paintBin();
  scheduleSave();
}

// la piste cible existe toujours (après une piste supprimée, une annulation…)
function validTargets() {
  for (const k of ['video', 'audio']) if (!S.p.tracks.some((t) => t.id === S.target[k] && t.kind === k)) S.target[k] = (k === 'video' ? S.p.tracks.filter((t) => t.kind === k).slice(-1)[0] : S.p.tracks.find((t) => t.kind === k)).id;
}
function remapTargets(map) {
  for (const k of ['video', 'audio']) if (map[S.target[k]]) S.target[k] = map[S.target[k]];
  if (S.gap && map[S.gap.track]) S.gap = { ...S.gap, track: map[S.gap.track] };
}

function restore(s) {
  Object.assign(S.p, JSON.parse(s));
  applySettings();
  changed();
}
const undo = () => U.undo();
const redo = () => U.redo();

// ── l'enregistrement, seul ──────────────────────────────────
let saveT = 0;
function scheduleSave() {
  S.dirty = true;
  paintSave();
  clearTimeout(saveT);
  saveT = setTimeout(save, 500);
}
async function save(force = false) {
  if (!S.p || (S.conflict && !force)) return;
  if (S.saving) { await S.saving.catch(() => {}); if (!S.dirty) return; }
  clearTimeout(saveT);
  S.dirty = false;
  const p = S.p;
  paintSave('work');
  S.saving = api(`montage/projects/${p.id}`, { method: 'POST', body: body(p, { base_rev: force ? undefined : S.rev }) });
  try {
    const r = await S.saving;
    if (S.p && S.p.id === p.id) { S.rev = r.rev; S.p.updated = r.updated; }
    S.conflict = false;
    $('#conflict').hidden = true;
    if (r.warnings && r.warnings.length) toast('plans qui se chevauchent : ' + r.warnings.join(' ; '));
  } catch (e) {
    S.dirty = true;
    if (e.status === 409) { S.conflict = true; $('#conflict').hidden = false; }
    else { paintSave('err', e.message); clearTimeout(saveT); saveT = setTimeout(save, 4000); S.saving = null; return; }
  }
  S.saving = null;
  paintSave();
}
async function flushSave() {
  clearTimeout(saveT);
  if (S.dirty || S.saving) await save();
  if (S.saving) await S.saving.catch(() => {});
}
function paintSave(state, msg) {
  const pill = $('#save-st');
  const st = state || (S.conflict ? 'err' : S.dirty ? 'work' : 'on');
  pill.className = 'pill save ' + st;
  pill.lastChild.textContent = S.conflict ? 'non enregistré' : st === 'err' ? 'hors ligne' : st === 'work' ? 'enregistrement' :
    `enregistré${S.p && S.p.updated ? ' · ' + fmtDate(S.p.updated).split(' ')[1] : ''}`;
  pill.title = msg || (st === 'err' ? 'le serveur ne répond pas : nouvel essai dans 4 s' : 'le montage s’enregistre seul à chaque geste');
}
addEventListener('beforeunload', () => {
  if (!S.dirty || !S.p || S.conflict) return;
  const p = S.p;
  try { navigator.sendBeacon(href(`api/montage/projects/${p.id}`), new Blob([JSON.stringify(body(p, { base_rev: S.rev }))], { type: 'application/json' })); } catch { /* */ }
});

// ── ouvrir, créer ───────────────────────────────────────────
function applySettings() {
  const st = S.p.settings;
  const f = st.format === 'custom' ? { w: st.width || 1920, h: st.height || 1080 } : (S.meta.formats.find((x) => x.id === st.format) || { w: 1920, h: 1080 });
  st.width = f.w; st.height = f.h;
  $('#stage').style.setProperty('--ar', String(f.w / f.h));
  $('#fps').textContent = st.fps;
  $('#p-name').value = S.p.name;
  document.title = `${S.p.name} · Montage`;
}

async function openProject(id) {
  if (S.p && S.p.id !== id) {
    await flushSave();
    clearTimeout(viewT);
    LS('montage-view-' + S.p.id, { pps: timeline.pps, scroll: timeline.scroll.scrollLeft, t: program.t });
    targets.set(S.p.id, { ...S.target });
  }
  const p = await api(`montage/projects/${id}`);
  id = p.id;                                   // un « mon-… » d'avant mène à sa séquence
  await ensureItems([id, ...p.clips.map((c) => c.item)]);
  program.pause();
  program.clear();
  S.p = p;
  S.rev = p.rev;
  useUndo(undoFor(id));                        // la pile de cette séquence (gardée tant que la page vit)
  if (targets.has(id)) S.target = { ...targets.get(id) };
  S.sel = new Set(); S.gap = null; S.conflict = false; S.dirty = false;
  if (!S.tabs.includes(id)) { S.tabs.push(id); LS('montage-tabs', S.tabs); }
  validTargets();
  $('#conflict').hidden = true;
  applySettings();
  paintSeqTabs();
  LS('montage-last', id);
  if (location.hash.slice(1) !== id) history.replaceState(null, '', location.pathname + '#' + id);
  const v = LS('montage-view-' + id);
  timeline.render();
  if (v && v.pps) { timeline.pps = v.pps; timeline.render(); timeline.scroll.scrollLeft = v.scroll || 0; timeline.paintRuler(); } else timeline.fit();
  program.invalidate();
  program.seek(v && v.t ? v.t : 0);
  zoomed(timeline.pps);
  paintInspector();
  paintBar();
  paintBin();
  paintSave();
  loadExports();
  resumeExport();
}

async function createProject(name, settings, folder = '') {
  const p = await api('montage/projects', { method: 'POST', body: { name, settings, folder } });
  await openProject(p.id);
  loadBin();
  return p;
}

function modal(title, bodyNode, foot, { cls = '', onclose } = {}) {
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc, true); if (onclose) onclose(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const scrim = el('div', { class: 'scrim', onpointerdown: (e) => { if (e.target === scrim) close(); } },
    el('div', { class: 'modal ' + cls, role: 'dialog', 'aria-label': title },
      el('div', { class: 'modal-head' }, el('span', { class: 't' }, title), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', onclick: close, title: 'fermer · Échap' }, 'Fermer')),
      el('div', { class: 'modal-body' }, bodyNode),
      foot ? el('div', { class: 'modal-foot' }, foot(close)) : null));
  document.addEventListener('keydown', esc, true);
  document.body.append(scrim);
  return close;
}

function askName(title, value = '', action = 'Créer', { placeholder = 'le nom du montage', max = 120, empty = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const inp = el('input', { class: 'fld', value, placeholder, maxlength: max });
    const ok = () => { const v = inp.value.trim(); if (!v && !empty) { inp.focus(); return; } done = true; close(); resolve(v); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    const close = modal(title, el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'nom'), inp),
      (cl) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', onclick: cl }, 'Annuler'), el('button', { class: 'tb go', onclick: ok }, action)],
      { onclose: () => { if (!done) resolve(null); } });
    inp.focus(); inp.select();
    setTimeout(() => { if (document.activeElement !== inp) { inp.focus(); inp.select(); } }, 30);
  });
}

// une question à deux issues (la seconde est l'action)
function confirmBox(title, text, action) {
  return new Promise((resolve) => {
    let done = false;
    const close = modal(title, el('p', {}, text), (cl) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', onclick: cl }, 'Annuler'),
      el('button', { class: 'tb go', onclick: () => { done = true; cl(); resolve(true); } }, action)], { onclose: () => { if (!done) resolve(false); } });
    return close;
  });
}

async function newProjectFlow(folder = '') {
  const d = new Date();
  const name = await askName('Nouvelle séquence', `Séquence du ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`, 'Créer', { placeholder: 'le nom de la séquence' });
  const st = S.p ? { format: S.p.settings.format, fps: S.p.settings.fps, width: S.p.settings.width, height: S.p.settings.height } : undefined;
  if (name) await createProject(name, st, typeof folder === 'string' ? folder : '');
  return name;
}

async function projectsModal() {
  let list = [];
  const box = el('div', { class: 'plist' });
  const count = el('span', { class: 'lbl' });
  const paint = () => {
    count.textContent = `${list.length} séquence${list.length > 1 ? 's' : ''} dans Asset`;
    box.replaceChildren(...(list.length ? list.map(row) : [el('p', {}, 'Aucune séquence encore. Créez-en une (ou clic droit sur un clip du projet → « Nouvelle séquence à partir de l’élément ») : elle s’enregistre seule, à chaque geste.')]));
  };
  const row = (pr) => {
    const name = el('b', {}, pr.name);
    let armed = false;
    const del = el('button', { class: 'tb ghost sm', title: 'mettre à la corbeille d’Asset (elle en revient)', onclick: async () => {
      if (!armed) { armed = true; del.textContent = 'Confirmer'; setTimeout(() => { armed = false; del.textContent = 'Supprimer'; }, 3000); return; }
      await api(`montage/projects/${pr.id}/delete`, { method: 'POST' });
      list = list.filter((x) => x.id !== pr.id);
      await closeSeqTab(pr.id, { quiet: true });
      loadBin();
      paint();
    } }, 'Supprimer');
    return el('div', { class: 'prow' + (S.p && S.p.id === pr.id ? ' on' : '') },
      el('span', { class: 'th', style: pr.thumb_url ? { backgroundImage: `url("${href(pr.thumb_url)}")` } : null }),
      el('div', { style: { minWidth: 0 } }, name,
        el('small', {}, `${M.short(pr.duration)} · ${pr.clips} plan${pr.clips > 1 ? 's' : ''} · ${pr.width}×${pr.height} · ${pr.fps} i/s${pr.folder ? ' · ' + pr.folder : ''} · ${fmtDate(pr.updated)}`)),
      el('div', { class: 'row' },
        el('button', { class: 'tb ghost sm', onclick: async () => { close(); await openProject(pr.id); } }, 'Ouvrir'),
        el('button', { class: 'tb ghost sm', onclick: async () => {
          const n = await askName('Renommer', pr.name, 'Renommer');
          if (!n) return;
          if (S.p && S.p.id === pr.id) { commit('renommer', (p) => { p.name = n; }); applySettings(); await flushSave(); pr.name = n; paint(); return; }
          const r = await api(`montage/projects/${pr.id}/rename`, { method: 'POST', body: { name: n } });
          Object.assign(pr, r); paint();
        } }, 'Renommer'),
        el('button', { class: 'tb ghost sm', onclick: async () => {
          if (S.p && S.p.id === pr.id) await flushSave();
          const r = await api(`montage/projects/${pr.id}/duplicate`, { method: 'POST' });
          list.unshift(r); paint(); loadBin(); toast(`« ${r.name} » créée`);
        } }, 'Dupliquer'),
        del));
  };
  const close = modal('Les séquences', el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, count, box),
    (cl) => [el('span', { class: 'sp' }), el('button', { class: 'tb go', onclick: async () => { const n = await newProjectFlow(project.state.tab); if (n) cl(); } }, 'Nouvelle séquence')],
    { cls: 'lg', onclose: () => { if (!S.p) paintEmptyState(); } });
  try { ({ projects: list } = await api('montage/projects')); } catch (e) { box.replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
  paint();
}

function paintEmptyState() {
  $('#p-name').value = '';
  document.title = 'Montage';
  $('#insp').replaceChildren(el('div', { class: 'card proj' },
    el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Aucune séquence ouverte')),
    el('p', { class: 'note' }, 'Double-cliquez une séquence du projet, créez-en une, ou clic droit sur un clip → « Nouvelle séquence à partir de l’élément » (ses réglages, comme dans Premiere).'),
    el('div', { class: 'row' }, el('button', { class: 'tb ghost', onclick: projectsModal }, 'Les séquences'),
      el('button', { class: 'tb ghost', onclick: () => newProjectFlow(project.state.tab) }, 'Nouvelle'))));
}

// ── le projet : la bibliothèque Asset (projet.js) ───────────
const project = mountProject({
  root: $('.bin'),
  items: S.items,
  modal, confirmBox,
  hasSequence: () => !!S.p,
  usedIds: () => new Set(S.p ? S.p.clips.map((c) => c.item) : []),
  usedAnywhere: (id) => !!(S.p && S.p.clips.some((c) => c.item === id)),
  sourceId: () => source.item && source.item.id,
  openSequenceId: () => S.p && S.p.id,
  openSource: (it) => openSource(it),
  openSequence: (id) => openProject(id),
  closeSequence: (id) => closeSeqTab(id, { quiet: true }),
  newSequence: (folder) => newProjectFlow(folder),
  newSequenceFrom: (it) => newSequenceFrom(it),
  renameSequence: (id, name) => renameSequence(id, name),
  duplicateSequence: (id) => duplicateSequence(id),
  fromBin: (it, mode) => fromBin(it, mode),
  appendMany: (ids) => appendMany(ids),
  markDrag: (it, ids) => markDrag(it, 0, it.duration || 0, 'bin', ids),
  clearDrag: () => { S.dragging = null; },
  uploadMany: (files) => uploadMany(files),
  pushUndo: (label, undoFn, redoFn) => pushLibUndo(label, undoFn, redoFn),
});
const loadBin = () => project.load();
const paintBin = () => project.paint();
const revealInBin = (id) => project.reveal(id);
const revealInAsset = (id) => window.open(href('asset/#' + id), '_blank', 'noopener');

// Un geste de la bibliothèque (ranger, renommer, jeter) s'annule comme les
// gestes de la timeline (ctrl+Z) : une entrée qui porte ses deux fonctions.
function pushLibUndo(label, undoFn, redoFn) {
  U.record({ label, undo: undoFn, redo: redoFn });
}

// ce qu'on glisse depuis cette page : sa longueur sur la timeline, d'où il part
function markDrag(it, tin, tout, from, ids = null) {
  const frames = it.kind === 'image' ? Math.round(S.p ? S.p.settings.still * fps() : 125)
    : Math.max(1, Math.round(((tout || it.duration || 5) - (tin || 0)) * (S.p ? fps() : 25)));
  S.dragging = { id: it.id, kind: it.kind, frames, from, ids };
}

// la source se glisse avec ses points d'entrée et de sortie (même type que dragItem)
function startDrag(e, it, tin, tout) {
  markDrag(it, tin, tout, 'source');
  e.dataTransfer.setData(ITEM_MIME, JSON.stringify({ id: it.id, kind: it.kind, title: it.title, thumb_url: it.thumb_url, in: tin, out: tout }));
  if (it.url) e.dataTransfer.setData('text/uri-list', href(it.url));
  e.dataTransfer.effectAllowed = 'copyMove';
}

// un fichier du disque, déposé où que ce soit dans le montage : catégorie
// Upload de la bibliothèque, entré par le montage (seul l'export garde `montage`)
async function uploadMany(files) {
  const out = [];
  for (const f of files) {
    try { toast(`dépôt de ${f.name}…`, 1500); const it = await uploadFile(f, { tool: 'upload', via: 'montage' }); S.items.set(it.id, it); out.push(it); }
    catch (e) { toast(`${f.name} : ${e.message}`); }
  }
  if (out.length) { toast(`${out.length} fichier${out.length > 1 ? 's' : ''} dans la bibliothèque`); loadBin(); }
  return out;
}

async function appendMany(ids) {
  for (const id of ids) {
    const it = S.items.get(id);
    if (it && it.kind === 'sequence') { toast('une séquence ne se pose pas (encore) dans une autre : l’imbrication n’est pas faite'); continue; }
    await appendItem(id);
  }
}

// ── les séquences : des objets d'Asset, en onglets au-dessus de la timeline ──
// Adobe, « Navigate sequences in the timeline » : « Each sequence appears as a
// tab within that timeline » ; « double-click the sequence in the Project
// panel. The sequence opens in a new tab. » Chaque onglet garde sa tête de
// lecture, son zoom (montage-view-<id>) et ses annulations (en mémoire).
S.tabs = (LS('montage-tabs') || []).filter((x) => typeof x === 'string');
const targets = new Map();         // id → les pistes cibles de la séquence (les annulations : undoFor)
function paintSeqTabs() {
  const box = $('#seq-tabs');
  if (!box) return;
  const cur = S.p && S.p.id;
  box.replaceChildren(...S.tabs.map((id) => {
    const it = S.items.get(id);
    const name = id === cur ? S.p.name : (it && it.title) || '…';
    const t = el('div', { class: 'stab' + (id === cur ? ' on' : ''), role: 'tab', 'data-seq': id, title: `${name} — clic : y passer · clic du milieu ou × : fermer · clic droit`,
      onclick: (e) => { if (e.target.closest('.x')) return; if (id !== cur) openProject(id); },
      onauxclick: (e) => { if (e.button === 1) closeSeqTab(id); } },
    el('i', { class: 'sq', html: '<svg viewBox="0 0 24 24"><path d="M3 6h18v12H3zM3 10h18M3 14h18M8 6v4M14 10v4M11 14v4"/></svg>' }),
    el('span', { class: 'nm' }, name), el('button', { class: 'x', title: 'fermer l’onglet', 'aria-label': 'fermer', onclick: (e) => { e.stopPropagation(); closeSeqTab(id); } }, '×'));
    return t;
  }), el('button', { class: 'stab add', title: 'nouvelle séquence', onclick: () => newProjectFlow(project.state.tab) }, '+'));
}
async function closeSeqTab(id, { quiet = false } = {}) {
  const i = S.tabs.indexOf(id);
  if (i < 0) return;
  S.tabs.splice(i, 1);
  LS('montage-tabs', S.tabs);
  targets.delete(id);
  undos.delete(id);                            // fermer l'onglet oublie ses annulations (comme Premiere en fermant la séquence)
  if (S.p && S.p.id === id) {
    await flushSave();
    const next = S.tabs[Math.min(i, S.tabs.length - 1)];
    if (next) { S.p = null; await openProject(next); }
    else closeAll();
  }
  paintSeqTabs();
  if (!quiet) toast('onglet fermé : la séquence reste dans le projet (double-clic pour la rouvrir)', 2000);
}
function closeAll() {
  program.pause(); program.clear();
  S.p = null; S.sel = new Set(); S.gap = null;
  useUndo(baseU);
  history.replaceState(null, '', location.pathname);
  LS('montage-last', null);
  timeline.clear();
  paintEmptyState();
  paintSeqTabs();
  paintBin();
}
async function newSequenceFrom(it) {
  if (!it || !['video', 'image', 'audio'].includes(it.kind)) return toast('une séquence se fait à partir d’une vidéo, d’une image ou d’un son');
  try {
    const p = await api('montage/projects', { method: 'POST', body: { from_item: it.id, folder: project.state.tab || it.folder || '' } });
    toast(`séquence « ${p.name} » : ${p.settings.width}×${p.settings.height} · ${p.settings.fps} i/s · ${M.short(M.projectEnd(p) / p.settings.fps)}${p.note ? ' · ' + p.note : ''}`, 4000);
    await openProject(p.id);
    loadBin();
  } catch (e) { toast(e.message); }
}
async function renameSequence(id, name) {
  if (S.p && S.p.id === id) { commit('renommer', (p) => { p.name = name.slice(0, 120); }); applySettings(); await flushSave(); paintSeqTabs(); return; }
  try { await api(`montage/projects/${id}/rename`, { method: 'POST', body: { name } }); } catch (e) { toast(e.message); }
  loadBin();
}
async function duplicateSequence(id) {
  if (S.p && S.p.id === id) await flushSave();
  try { const r = await api(`montage/projects/${id}/duplicate`, { method: 'POST' }); toast(`« ${r.name} » créée`); loadBin(); } catch (e) { toast(e.message); }
}

// ── la source ───────────────────────────────────────────────
const source = new Source($('#src-screen'), { onTick: paintSource, fpsOf: () => (S.p ? fps() : 25) });

function openSource(it, marks) {
  S.items.set(it.id, it);
  source.load(it, marks);
  const wave = $('#src-screen .wave');
  if (wave) wave.remove();
  if (it.kind === 'audio') {
    const u = `url("${href('api/montage/wave/' + it.id)}")`;
    $('#src-screen').append(el('i', { class: 'wave', style: { maskImage: u, webkitMaskImage: u } }));
  }
  $('#src-name').textContent = it.title || it.id;
  focus('source');
  paintBin();
  paintSource();
}

function paintSource() {
  const it = source.item;
  const f = source.fps;
  const D = source.duration;
  $('#src-tc').textContent = M.tc(source.t * f, f);
  const pct = (x) => (D ? Math.max(0, Math.min(100, x / D * 100)) : 0) + '%';
  $('#src-pos').style.left = pct(source.t);
  $('#src-rng').style.left = pct(source.in);
  $('#src-rng').style.width = D ? `calc(${pct(source.out)} - ${pct(source.in)})` : '0';
  $('#s-play').textContent = source.playing ? '❚❚' : '▶';
  $('#s-dur').textContent = !it ? '' : it.kind === 'image' ? `image · ${M.short(S.p ? S.p.settings.still : 5)}` : `retenu ${M.short(Math.max(0, source.out - source.in))}`;
  for (const b of ['#s-in', '#s-out', '#s-prev', '#s-next', '#s-play']) $(b).disabled = !it || it.kind === 'image';
  for (const b of ['#s-insert', '#s-over']) {
    $(b).disabled = !it || !S.p;
    $(b).title = !it ? 'choisissez d’abord un plan dans le chutier' : !S.p ? 'ouvrez d’abord un montage' : $(b).dataset.title || $(b).title;
  }
}
$('#s-insert').dataset.title = $('#s-insert').title;
$('#s-over').dataset.title = $('#s-over').title;

function fromSource(mode) {
  const it = source.item;
  if (!it || !S.p) return;
  const tid = it.kind === 'audio' ? S.target.audio : S.target.video;
  placeItem({ id: it.id, in: source.in, out: it.kind === 'image' ? null : source.out }, tid, program.frame(), mode);
}
function fromBin(it, mode) {
  if (!S.p) return toast('ouvrez d’abord un montage');
  placeItem({ id: it.id, in: 0, out: it.duration || 0 }, it.kind === 'audio' ? S.target.audio : S.target.video, program.frame(), mode);
}

// ── poser un objet sur la timeline ──────────────────────────
function trackFor(tid, kind) {
  if (!kind || M.accepts(tid, kind)) return tid;
  return kind === 'audio' ? S.target.audio : S.target.video;
}

async function placeItem(desc, tid, frame, mode = 'overwrite') {
  if (!S.p) return toast('ouvrez d’abord un montage');
  await ensureItems([desc.id]);
  const it = itemOf(desc.id);
  if (!it) return toast('objet introuvable dans la bibliothèque');
  if (it.kind === 'sequence') return toast('une séquence ne se pose pas (encore) dans une autre : l’imbrication n’est pas faite — double-cliquez-la pour l’ouvrir');
  if (!['video', 'image', 'audio'].includes(it.kind)) return toast('un élément ne se monte pas : prenez une vidéo, une image ou un son');
  let track = trackFor(tid, it.kind);
  if (M.trackKind(track) === 'audio' && it.kind === 'video' && !it.audio) { toast('cette vidéo n’a pas de son : posée sur la piste vidéo cible'); track = S.target.video; }
  const t = S.p.tracks.find((x) => x.id === track);
  if (t.lock) return toast(`la piste ${track} est verrouillée`);
  const f = fps();
  const tin = it.kind === 'image' ? 0 : Math.max(0, desc.in || 0);
  const tout = it.kind === 'image' ? 0 : (desc.out || it.duration || tin + 5);
  const dur = it.kind === 'image' ? Math.round(S.p.settings.still * f) : Math.round((tout - tin) * f);
  if (dur < 1) return toast('plan trop court : réglez l’entrée et la sortie');
  const clip = { id: M.newClipId(), track, item: it.id, kind: it.kind, title: it.title || '', start: Math.max(0, frame), dur,
    in: tin, src_dur: it.kind === 'image' ? 0 : (it.duration || 0), speed: 1, enabled: true, vol: 1, fade_in: 0, fade_out: 0, xfade: 0,
    audio: it.kind === 'video' && !!it.audio, grade: { ...M.NEUTRAL }, lut: null };
  commit(`${mode === 'insert' ? 'insérer' : 'poser'} « ${clip.title || 'plan'} »`, (p) => M.placeClip(p, clip, mode));
  select(new Set([clip.id]));
  return clip;
}

async function appendItem(id, marks = {}) {
  if (!S.p) return toast('ouvrez d’abord un montage');
  await ensureItems([id]);
  const it = itemOf(id);
  if (!it) return toast('objet introuvable : ' + id);
  const tid = it.kind === 'audio' ? S.target.audio : S.target.video;
  const end = M.trackClips(S.p, tid).reduce((m, c) => Math.max(m, M.clipEnd(c)), 0);
  const c = await placeItem({ id, in: marks.in || 0, out: marks.out || it.duration || 0 }, tid, end);
  if (c) {
    toast(`« ${it.title} » ajouté au montage « ${S.p.name} »`);
    program.seekFrame(c.start);
    if (!source.item || source.item.id !== it.id) openSource(it);
  }
}

// ── le programme ────────────────────────────────────────────
const program = new Program($('#stage'), { getP: () => S.p, itemOf, onTick: paintProgram });

function paintProgram(t, playing) {
  if (!S.p) return;
  const f = fps();
  const frame = Math.floor(t * f + 1e-6);
  $('#tc').textContent = M.tc(frame, f);
  const D = program.duration();
  const pct = D ? Math.min(100, t / D * 100) : 0;
  $('#prg-fill').style.width = pct + '%';
  $('#prg-pos').style.left = pct + '%';
  timeline.paintPlayhead(frame);
  const play = $('#p-play');
  play.textContent = playing ? (program.rate !== 1 ? `×${program.rate}` : 'Pause') : 'Lecture';
  play.classList.toggle('on', !!playing);
  const st = $('#prg-state');
  st.textContent = playing ? (program.rate < 0 ? 'arrière' : 'lecture') : 'arrêt';
  st.classList.toggle('on', !!playing);
  const vis = program.visible || [];
  $('#prg-name').textContent = vis.length ? vis[vis.length - 1].title || '' : (D && t >= D ? 'fin du montage' : '—');
  $('#prg-empty').hidden = !!S.p.clips.length;
  if (!playing) { saveView(); clearTimeout(shelfT); shelfT = setTimeout(paintShelf, 180); }
}
let shelfT = 0;

let viewT = 0;
function saveView() {
  clearTimeout(viewT);
  viewT = setTimeout(() => { if (S.p) LS('montage-view-' + S.p.id, { pps: timeline.pps, scroll: timeline.scroll.scrollLeft, t: program.t }); }, 400);
}

function shuttle(dir) {
  const mon = S.focus === 'source' ? source : program;
  if (dir === 0) { S.shuttle = 0; mon.pause(); return; }
  let r = S.shuttle;
  if (dir > 0) r = r <= 0 ? 1 : Math.min(8, r * 2);
  else r = r >= 0 ? -1 : Math.max(-8, r * 2);
  S.shuttle = r;
  mon.play(r);
}

function focus(which) {
  S.focus = which;
  $('#src').classList.toggle('focus', which === 'source');
  $('#prg').classList.toggle('focus', which === 'program');
}

// ── la timeline ─────────────────────────────────────────────
const timeline = new Timeline($('#tl'), {
  p: () => S.p,
  sel: () => S.sel,
  gap: () => S.gap,
  tool: () => S.tool,
  snap: () => S.snap,
  targets: () => S.target,
  playhead: () => program.frame(),
  playing: () => program.playing,
  item: (id) => S.items.get(id),
  dragging: () => S.dragging,
  commit,
  gesture,
  select,
  focus,
  seekFrame: (f) => program.seekFrame(f),
  cut,
  trackFor: (tid, kind) => trackFor(tid, kind),
  placeItem,
  placeMany: async (ids, tid, frame, mode) => {
    await ensureItems(ids);
    let at = frame;
    for (const id of ids) {
      const it = itemOf(id);
      if (!it || it.kind === 'sequence') continue;
      const c = await placeItem({ id, in: 0, out: it.duration || 0 }, trackFor(tid, it.kind), at, mode);
      if (c) at = M.clipEnd(c);
    }
  },
  dropFiles: async (files, tid, frame, mode) => {
    let at = frame;
    for (const it of await uploadMany(files)) {
      const c = await placeItem({ id: it.id, in: 0, out: it.duration || 0 }, tid, at, mode);
      if (c) at = M.clipEnd(c);
    }
  },
  openClipInSource,
  toggleTrack: (tid, k, label) => commit(label, (p) => { const t = p.tracks.find((x) => x.id === tid); t[k] = !t[k]; }),
  setTarget: (t) => { S.target[t.kind] = t.id; timeline.render(); },
  renameTrack,
  renameMarker,
  locked: (tid) => toast(`la piste ${tid} est verrouillée`),
  say: (m) => toast(m),
  // montrer le plan au moniteur le temps d'un geste (la tête de lecture y
  // est déjà : on n'y touche pas ; sinon sa première image), puis revenir
  peek: (c) => {
    const t0 = program.t, fr = program.frame();
    const inside = c.start <= fr && M.clipEnd(c) > fr;
    if (!inside) program.seekFrame(c.start);
    return () => { if (!inside) program.seek(t0); };
  },
  zoomed,
});

function zoomed(pps) {
  $('#z-val').textContent = `${Math.round(pps / 40 * 100)} %`;
  saveView();
}

function select(sel, gap = null) {
  S.sel = sel;
  S.gap = gap;
  timeline.render();
  paintInspector();
  paintBar();
}

function openClipInSource(id, at = null) {
  const c = M.byId(S.p, id);
  const it = c && itemOf(c.item);
  if (it) openSource(it, { in: c.in || 0, out: (c.in || 0) + c.dur / fps() * M.spd(c), at });
}

// Concordance des images (Premiere « Match Frame », F) : le plan visible
// sous la tête de lecture, ouvert dans la source à la même image.
function matchFrame() {
  const f = program.frame();
  const vis = program.visible || [];
  const c = vis[vis.length - 1] || S.p.clips.find((x) => x.start <= f && M.clipEnd(x) > f && M.isOn(x));
  if (!c) return toast('rien sous la tête de lecture');
  openClipInSource(c.id, c.kind === 'image' ? null : M.srcTime(c, program.t, fps()));
}

function cut(f, onlyId) {
  commit('couper', (p) => {
    const locked = lockedTracks(p);
    const ids = onlyId ? [onlyId] : p.clips.filter((c) => c.start < f && M.clipEnd(c) > f).map((c) => c.id);
    for (const id of ids) { const c = M.byId(p, id); if (c && !locked.has(c.track)) M.cutAt(p, id, f); }
  });
}

// Ajouter une coupe (Premiere, ctrl+K) : les plans choisis, sinon ceux de
// toutes les pistes libres ; ctrl+maj+K : toutes les pistes, toujours.
function cutAtPlayhead(all = false) {
  const f = program.frame();
  const ids = all ? [] : [...S.sel].filter((id) => { const c = M.byId(S.p, id); return c && c.start < f && M.clipEnd(c) > f; });
  if (!all && S.sel.size && !ids.length) return toast('la tête de lecture ne passe pas dans le plan choisi');
  if (ids.length) commit('couper', (p) => { for (const id of ids) if (!lockedTracks(p).has(M.byId(p, id).track)) M.cutAt(p, id, f); });
  else cut(f, null);
}

function del(ripple) {
  if (!S.p) return;
  if (!S.sel.size && S.gap) {
    const g = S.gap;
    if (lockedTracks().has(g.track)) return toast(`la piste ${g.track} est verrouillée`);
    commit('refermer le vide', (p) => M.closeGap(p, g));
    S.gap = null;
    paintInspector();
    return;
  }
  const locked = lockedTracks();
  const ids = new Set([...S.sel].filter((id) => { const c = M.byId(S.p, id); return c && !locked.has(c.track); }));
  if (!ids.size) return toast(S.sel.size ? 'ces plans sont sur une piste verrouillée' : 'choisissez d’abord un plan, ou un vide entre deux plans');
  commit(ripple ? 'supprimer et raccorder' : 'supprimer', (p) => (ripple ? M.rippleDelete(p, ids) : M.deleteClips(p, ids)));
  select(new Set());
}

function prevClip(p, c) {
  return M.trackClips(p, c.track).find((x) => M.clipEnd(x) === c.start && x.id !== c.id);
}

function dissolve(id, frames) {
  const c = id ? M.byId(S.p, id) : null;
  if (!c) {
    // sans plan choisi : la coupe sous la tête de lecture, sur la piste vidéo cible
    const f = program.frame();
    const at = M.trackClips(S.p, S.target.video).find((x) => Math.abs(x.start - f) <= 2 && x.start > 0);
    if (!at) return toast('choisissez le plan d’arrivée, ou placez la tête de lecture sur une coupe de la piste cible');
    return dissolve(at.id, frames);
  }
  const prev = prevClip(S.p, c);
  if (!prev) return toast('fondu enchaîné : il faut un plan collé juste avant, sur la même piste');
  const n = Math.max(2, Math.min(frames || fps(), c.dur, prev.dur));
  commit('fondu enchaîné', (p) => { const x = M.byId(p, c.id); x.xfade = n; x.fade_in = 0; const pv = M.byId(p, prev.id); pv.fade_out = 0; });
  select(new Set([c.id]));
}

function detachSound(id) {
  const c = M.byId(S.p, id);
  if (!c || c.kind !== 'video' || !c.audio) return toast('rien à dissocier : ce plan n’a pas de son attaché');
  const tid = S.target.audio;
  if (lockedTracks().has(tid)) return toast(`la piste ${tid} est verrouillée`);
  const a = { ...JSON.parse(JSON.stringify(c)), id: M.newClipId(), track: tid, grade: { ...M.NEUTRAL }, lut: null, audio: true };
  commit('dissocier le son', (p) => { M.byId(p, id).audio = false; M.placeClip(p, a, 'overwrite'); });
  toast(`le son est sur ${tid} : il se déplace et se coupe à part`);
}

function stepEdit(dir) {
  const pts = M.editPoints(S.p);
  const f = program.frame();
  const next = dir > 0 ? pts.find((x) => x > f) : [...pts].reverse().find((x) => x < f);
  if (next !== undefined) program.seekFrame(next);
}

// ── les pistes : ajouter, renommer, supprimer ───────────────
function addTrack(kind, ref, where) {
  let res = null;
  commit(`ajouter une piste ${kind === 'video' ? 'vidéo' : 'son'}`, (p) => { res = M.addTrack(p, kind, ref, where); if (res) remapTargets(res.map); });
  if (!res) return toast(`${M.MAX_TRACKS} pistes ${kind === 'video' ? 'vidéo' : 'son'} au plus`);
  toast(`piste ${res.id} ajoutée`, 1600);
}
async function deleteTrack(tid) {
  const t = M.trackOf(S.p, tid);
  const n = S.p.clips.filter((c) => c.track === tid).length;
  if (n && !(await confirmBox('Supprimer la piste', `La piste ${tid}${t.name ? ` (« ${t.name} »)` : ''} porte ${n} plan${n > 1 ? 's' : ''} : ${n > 1 ? 'ils partent' : 'il part'} avec elle (ctrl+Z pour revenir).`, 'Supprimer la piste'))) return;
  let map = null;
  commit(`supprimer la piste ${tid}`, (p) => { map = M.deleteTrack(p, tid); if (map) remapTargets(map); });
}
async function renameTrack(tid) {
  const t = M.trackOf(S.p, tid);
  if (!t) return;
  const v = await askName(`Renommer la piste ${tid}`, t.name || '', 'Renommer', { placeholder: 'le nom de la piste (vide : aucun)', max: 40, empty: true });
  if (v === null) return;
  commit('renommer la piste', (p) => { M.trackOf(p, tid).name = v; });
}

// ── les marques, l'entrée et la sortie de séquence ──────────
function addMarkerAt(f) { commit('ajouter une marque', (p) => M.addMarker(p, f)); toast(`marque à ${M.tc(f, fps())} · double-clic dessus : la nommer`, 1800); }
async function renameMarker(id) {
  const m = (S.p.markers || []).find((x) => x.id === id);
  if (!m) return;
  const v = await askName(`Marque · ${M.tc(m.f, fps())}`, m.name || '', 'Nommer', { placeholder: 'le nom de la marque', max: 80, empty: true });
  if (v !== null) commit('nommer la marque', (p) => { p.markers.find((x) => x.id === id).name = v; });
}
function markerAt(f) { return (S.p.markers || []).find((m) => Math.abs(m.f - f) <= 1); }
function gotoMarker(dir) {
  const f = program.frame();
  const ms = S.p.markers || [];
  const m = dir > 0 ? ms.find((x) => x.f > f) : [...ms].reverse().find((x) => x.f < f);
  if (m) program.seekFrame(m.f); else toast(dir > 0 ? 'pas de marque après' : 'pas de marque avant', 1200);
}
function setRange(k, f) {
  commit(k === 'in' ? 'point d’entrée' : 'point de sortie', (p) => {
    p.range = { ...(p.range || { in: null, out: null }), [k]: f };
    if (p.range.in !== null && p.range.out !== null && p.range.out <= p.range.in) p.range[k === 'in' ? 'out' : 'in'] = null;
  });
}
function clearRange(which) {
  commit(which === 'both' ? 'effacer l’entrée et la sortie' : which === 'in' ? 'effacer l’entrée' : 'effacer la sortie', (p) => {
    p.range = { ...(p.range || {}), ...(which === 'both' ? { in: null, out: null } : { [which]: null }) };
  });
}
function rangeBounds() {
  const r = S.p.range || {};
  if (r.in === null && r.out === null) return null;
  return [r.in ?? 0, r.out ?? M.projectEnd(S.p)];
}
function liftExtract(extract) {
  const b = rangeBounds();
  if (!b || b[1] <= b[0]) return toast('posez d’abord une entrée et une sortie (I, O) sur la séquence');
  // extraire referme la plage : l'entrée et la sortie n'ont plus d'objet (une seule annulation)
  commit(extract ? 'extraire' : 'prélever', (p) => { if (extract) { M.extractRange(p, b[0], b[1]); p.range = { in: null, out: null }; } else M.liftRange(p, b[0], b[1]); });
  program.seekFrame(b[0]);
}

// ── le presse-papiers, dupliquer ────────────────────────────
function copySel() {
  const cl = [...S.sel].map((id) => M.byId(S.p, id)).filter(Boolean);
  if (!cl.length) return toast('choisissez d’abord des plans');
  S.clip = { clips: JSON.parse(JSON.stringify(cl)) };
  LS('montage-clipboard', S.clip);
  toast(`${cl.length} plan${cl.length > 1 ? 's' : ''} copié${cl.length > 1 ? 's' : ''}`, 1400);
}
async function paste(insert, at = program.frame()) {
  if (!S.clip || !S.clip.clips.length) return toast('rien à coller : copiez d’abord des plans (ctrl+C)');
  await ensureItems(S.clip.clips.map((c) => c.item));
  let ids = [];
  commit(insert ? 'coller et insérer' : 'coller', (p) => { ids = M.pasteClips(p, S.clip.clips, at, insert ? 'insert' : 'overwrite', S.target); });
  if (!ids.length) return toast('rien collé : les pistes sont verrouillées');
  select(new Set(ids));
}
function duplicateAfter(id) {
  const c = M.byId(S.p, id);
  if (!c) return;
  let nid = null;
  commit('dupliquer à la suite', (p) => { const x = { ...JSON.parse(JSON.stringify(c)), id: M.newClipId(), start: M.clipEnd(c), xfade: 0 }; M.placeClip(p, x, 'insert'); nid = x.id; });
  if (nid) select(new Set([nid]));
}

// ── vitesse, activer, LUT ───────────────────────────────────
function toggleEnabled(ids = [...S.sel]) {
  const list = ids.map((id) => M.byId(S.p, id)).filter(Boolean);
  if (!list.length) return toast('choisissez d’abord des plans');
  const on = !list.every(M.isOn);
  commit(on ? 'activer' : 'désactiver', (p) => { for (const c of list) M.byId(p, c.id).enabled = on; });
  toast(on ? 'activé' : 'désactivé : ni vu, ni entendu, ni exporté', 1600);
}

function speedModal(id) {
  const c = M.byId(S.p, id);
  if (!c) return toast('choisissez d’abord un plan');
  if (c.kind === 'image') return toast('une image fixe n’a pas de vitesse : réglez sa durée dans l’inspecteur');
  const f = fps(), sp0 = M.spd(c);
  const inp = el('input', { class: 'fld nfld', type: 'number', min: Math.round(M.SPEED_MIN * 100), max: Math.round(M.SPEED_MAX * 100), step: 1, value: Math.round(sp0 * 100) });
  const rip = el('input', { type: 'checkbox' });
  const out = el('dd', { class: 'big' });
  const paint = () => { const s = Math.max(M.SPEED_MIN, Math.min(M.SPEED_MAX, (+inp.value || 100) / 100)); out.textContent = M.tc(Math.max(1, Math.round(c.dur * sp0 / s)), f); };
  inp.addEventListener('input', paint);
  paint();
  const apply = (close) => {
    const s = Math.max(M.SPEED_MIN, Math.min(M.SPEED_MAX, (+inp.value || 100) / 100));
    let nd = 0;
    commit('vitesse/durée', (p) => { nd = M.setSpeed(p, c.id, s, rip.checked); });
    const want = Math.round(c.dur * sp0 / s);
    if (nd && nd < want) toast(`durée arrêtée au plan suivant (${M.short(nd / f)}) : cochez « propager » pour pousser la suite`, 4000);
    close();
  };
  modal('Vitesse/Durée', el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'vitesse (%)'), el('span', { class: 'sp' }), inp),
    el('dl', { class: 'kv' }, el('dt', {}, 'durée'), out, el('dt', {}, 'matière'), el('dd', {}, `${M.short(c.dur / f * sp0)} de source (${M.short(c.in || 0)} → ${M.short((c.in || 0) + c.dur / f * sp0)})`)),
    el('label', { class: 'row chk' }, rip, el('span', {}, 'propager : décaler la suite de la piste (Premiere : « Montage par propagation, décaler les éléments suivants »)')),
    el('p', { class: 'note' }, `de ${Math.round(M.SPEED_MIN * 100)} à ${Math.round(M.SPEED_MAX * 100)} % · le son garde sa hauteur (atempo à l’export, preservesPitch à l’aperçu).`)),
  (close) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', onclick: close }, 'Annuler'), el('button', { class: 'tb go', onclick: () => apply(close) }, 'Appliquer')]);
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}

async function loadLuts() {
  try { const r = await api('montage/luts'); S.luts = r.luts; } catch { S.luts = []; }
  S.lutById = new Map(S.luts.map((l) => [l.id, l]));
  if (S.sel.size === 1) paintInspector();
}
const lutMeta = (id) => (S.lutById ? S.lutById.get(id) : S.luts.find((l) => l.id === id));

// Les LUT rangées pour l'étagère : les favoris (par rang), puis les familles —
// les cuites Rec.709 de Fujifilm d'abord, les marques de pellicules, les
// LUT d'origine en log à la fin (elles ne vont pas sur nos vidéos).
const lutFav = () => S.luts.filter((l) => l.fav > 0).sort((a, b) => a.fav - b.fav);
function lutFamilies() {
  const by = new Map();
  for (const l of S.luts) { if (!by.has(l.family)) by.set(l.family, []); by.get(l.family).push(l); }
  const rank = (f) => (/rec\.?709/i.test(f) && /fuji/i.test(f) ? 0 : /origine|log/i.test(f) ? 3 : /import/i.test(f) ? 2 : 1);
  return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'fr'))
    .map(([name, list]) => ({ name, list: list.sort((a, b) => a.title.localeCompare(b.title, 'fr')) }));
}
function lutSearch(q) {
  const words = q.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/\s+/).filter(Boolean);
  const hay = (l) => `${l.title} ${l.family} ${l.pack || ''} ${l.input_label}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return S.luts.filter((l) => words.every((w) => hay(l).includes(w)));
}

function setLut(ids, lutId, mix = null) {
  const list = ids.map((id) => M.byId(S.p, id)).filter((c) => c && M.trackKind(c.track) === 'video');
  if (!list.length) return toast('une LUT se pose sur un plan d’une piste vidéo');
  const m = lutId ? lutMeta(lutId) : null;
  commit(lutId ? `LUT « ${m ? m.title : lutId} »` : 'retirer la LUT', (p) => {
    for (const c of list) M.byId(p, c.id).lut = lutId ? { id: lutId, mix: mix ?? (c.lut && c.lut.id === lutId ? c.lut.mix : 1) } : null;
  });
  if (m && m.input && m.input !== 'rec709') toast(`« ${m.title} » attend du ${m.input_label} : sur une image Rec.709 le rendu sera faux (voir l’étude)`, 5000);
}

function importLutModal(then) {
  const file = el('input', { type: 'file', accept: '.cube,.png', class: 'fld' });
  const title = el('input', { class: 'fld', placeholder: 'le nom de la LUT (sinon celui du fichier)', maxlength: 80 });
  const inp = el('select', { class: 'fld' }, ...(S.meta.lut_inputs || []).map((x) => el('option', { value: x.id, selected: x.id === 'rec709' ? '' : null }, x.label)));
  const fam = el('input', { class: 'fld', placeholder: 'la famille sur l’étagère (sinon « Importées »)', maxlength: 60, list: 'lut-families' });
  const famList = el('datalist', { id: 'lut-families' }, ...lutFamilies().map((f) => el('option', { value: f.name })));
  const why = el('p', { class: 'why', hidden: true });
  let busy = false;
  const go = async (close) => {
    if (busy) return;
    const f = file.files && file.files[0];
    if (!f) { why.hidden = false; why.textContent = 'choisissez un fichier .cube (ou une HaldCLUT .png)'; return; }
    busy = true;
    try {
      const q = new URLSearchParams({ name: f.name, title: title.value.trim(), input: inp.value, source: f.name, family: fam.value.trim() });
      const m = await api('montage/luts?' + q, { method: 'PUT', raw: f, headers: { 'Content-Type': 'application/octet-stream' } });
      toast(`LUT « ${m.title} » rangée (${m.kind.toUpperCase()} ${m.size})`);
      close();
      await loadLuts();
      if (then) then(m);
    } catch (e) { why.hidden = false; why.textContent = e.message; busy = false; }
  };
  modal('Importer une LUT', el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    el('p', {}, 'Un fichier .cube (3D, ou 1D jusqu’à 4096 entrées, domaine 0..1 — Adobe « Cube LUT Specification 1.0 ») ou une HaldCLUT en PNG ; au-delà de 65 points, elle est rééchantillonnée à 33. Elle est rangée dans les données du portail, pas dans le dépôt.'),
    file, title, fam, famList, el('span', { class: 'lbl' }, 'l’image qu’elle attend'), inp,
    el('p', { class: 'note' }, 'une LUT faite pour du log (F-Log, F-Log2…) donne un rendu faux sur nos vidéos Rec.709 : le banc le dira quand vous la poserez.'), why),
  (close) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', onclick: close }, 'Annuler'), el('button', { class: 'tb go', onclick: () => go(close) }, 'Importer')]);
}

// ── l'inspecteur ────────────────────────────────────────────
function slider({ label, min, max, step, value, fmt, color = 'var(--cy)', cls = '', title = '', apply, disabled = false }) {
  const out = el('output', {}, fmt(value));
  const inp = el('input', { type: 'range', class: 'rg ' + cls, min, max, step, value, title, 'aria-label': label, disabled: disabled || null });
  const paint = () => {
    const v = +inp.value;
    out.textContent = fmt(v);
    inp.style.setProperty('--rg-p', ((v - min) / (max - min) * 100) + '%');
  };
  inp.style.setProperty('--rg-c', color);
  paint();
  inp.addEventListener('pointerdown', () => beginEdit(label));
  inp.addEventListener('keydown', () => beginEdit(label));
  inp.addEventListener('input', () => { beginEdit(label); apply(+inp.value); paint(); live(); });
  inp.addEventListener('change', () => { endEdit(); paintBar(); });
  return el('label', { class: 'slider' + (disabled ? ' off' : ''), title }, el('span', {}, label), inp, out);
}

const dB = (v) => (v <= 0 ? '−∞ dB' : `${(20 * Math.log10(v)).toFixed(1)} dB`);

function paintInspector() {
  const box = $('#insp');
  if (!S.p) return paintEmptyState();
  const cards = [];
  const f = fps();
  if (S.sel.size === 1) {
    const c = M.byId(S.p, [...S.sel][0]);
    if (c) cards.push(...clipCards(c, f));
  } else if (S.sel.size > 1) {
    cards.push(el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('span', { class: 't' }, `${S.sel.size} plans choisis`)),
      el('p', { class: 'note' }, 'Glissez-les ensemble sur la timeline ; maj ou ctrl + clic pour en ajouter ou en retirer ; clic droit pour la LUT, activer, copier.'),
      el('div', { class: 'row' }, el('button', { class: 'tb ghost sm', onclick: () => del(false) }, 'Supprimer'),
        el('button', { class: 'tb ghost sm', onclick: () => del(true) }, 'Et raccorder'))));
  } else if (S.gap) {
    cards.push(el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('span', { class: 't' }, `Vide · ${S.gap.track}`)),
      el('dl', { class: 'props' }, el('dt', {}, 'de'), el('dd', { class: 'tcv' }, M.tc(S.gap.s, f)), el('dt', {}, 'à'), el('dd', { class: 'tcv' }, M.tc(S.gap.e, f)),
        el('dt', {}, 'durée'), el('dd', {}, M.short((S.gap.e - S.gap.s) / f))),
      el('button', { class: 'tb ghost sm', onclick: () => del(true), title: 'Suppr' }, 'Supprimer et raccorder')));
  }
  if (!S.sel.size) cards.push(...projectCards(f));
  box.replaceChildren(...cards);
  paintShelf();
}

function clipCards(c, f) {
  const it = S.items.get(c.item) || {};
  const track = S.p.tracks.find((t) => t.id === c.track);
  const locked = track.lock;
  const set = (fn) => (v) => { const x = M.byId(S.p, c.id); if (x) fn(x, v); };
  const cards = [];
  const sp = M.spd(c);
  const props = [['piste', c.track + (track.name ? ` · ${track.name}` : '') + (locked ? ' · verrouillée' : ''), ''], ['début', M.tc(c.start, f), 'tcv'], ['fin', M.tc(M.clipEnd(c), f), 'tcv'], ['durée', M.tc(c.dur, f), 'tcv']];
  if (c.kind !== 'image') props.push(['entrée source', M.short(c.in || 0) + (c.src_dur ? ` / ${M.short(c.src_dur)}` : ''), ''], ['vitesse', M.pct(sp), '']);
  const head = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Plan · ', el('b', {}, c.title || it.title || c.item)),
      el('span', { class: 'snapper', title: 'un plan désactivé ne se voit, ne s’entend ni ne s’exporte · maj+E' }, 'actif',
        el('button', { class: 'sw' + (M.isOn(c) ? ' on' : ''), disabled: locked || null, 'aria-pressed': String(M.isOn(c)), onclick: () => toggleEnabled([c.id]) }, el('i')))),
    el('dl', { class: 'props' }, ...props.flatMap(([k, v, cls]) => [el('dt', {}, k), el('dd', { class: cls }, v)])));
  if (it.missing) head.append(el('p', { class: 'warn' }, 'objet introuvable dans la bibliothèque (à la corbeille ?) : l’export le refusera'));
  if (c.kind === 'image') {
    const inp = el('input', { class: 'fld nfld', type: 'number', min: 0.04, step: 0.5, value: (c.dur / f).toFixed(2), disabled: locked || null });
    const next = M.trackClips(S.p, c.track).find((x) => x.start >= M.clipEnd(c) && x.id !== c.id);
    inp.addEventListener('change', () => {
      let d = Math.max(1, Math.round(+inp.value * f));
      if (next) d = Math.min(d, next.start - c.start);
      commit('durée de l’image', (p) => { const x = M.byId(p, c.id); x.dur = d; x.fade_in = Math.min(x.fade_in, d); x.fade_out = Math.min(x.fade_out, d); });
    });
    head.append(el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'durée de l’image (s)'), el('span', { class: 'sp' }), inp));
    if (next) head.append(el('p', { class: 'why' }, `au plus ${M.short((next.start - c.start) / f)} : le plan suivant commence là`));
  }
  const acts = el('div', { class: 'row' },
    el('button', { class: 'tb ghost sm', onclick: () => openClipInSource(c.id), disabled: it.missing || null }, 'Dans la source'));
  if (c.kind !== 'image') acts.append(el('button', { class: 'tb ghost sm', disabled: locked || null, title: 'ctrl+R', onclick: () => speedModal(c.id) }, 'Vitesse…'));
  if (c.kind === 'video' && track.kind === 'video') {
    acts.append(c.audio ? el('button', { class: 'tb ghost sm', disabled: locked || null, title: `mettre le son sur ${S.target.audio} pour le déplacer à part · ctrl+L`, onclick: () => detachSound(c.id) }, 'Dissocier le son')
      : el('span', { class: 'lbl' }, it.audio ? 'son dissocié' : 'vidéo sans son'));
  }
  head.append(acts);
  cards.push(head);

  // transitions
  const prev = prevClip(S.p, c);
  const mode = c.xfade > 0 && prev ? 'x' : c.fade_in > 0 ? 'f' : 'c';
  const isV1 = track.kind === 'video' && track.id === 'V1';
  const fadeName = track.kind === 'audio' ? 'fondu (du silence)' : isV1 ? 'fondu au noir' : 'fondu (transparence)';
  const maxT = Math.max(2, Math.min(c.dur, 5 * f));
  const trans = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Transitions')));
  const opt = (id, label, why) => el('button', { class: 'opt' + (mode === id ? ' on' : ''), disabled: (locked || why) ? true : null, title: why || '', onclick: () => {
    commit(label, (p) => {
      const x = M.byId(p, c.id), pv = prev ? M.byId(p, prev.id) : null;
      const n = Math.max(2, Math.min(f, x.dur, pv ? pv.dur : Infinity));
      if (id === 'c') { x.xfade = 0; x.fade_in = 0; if (pv && pv.fade_out && mode === 'f') pv.fade_out = 0; }
      if (id === 'x') { x.xfade = n; x.fade_in = 0; if (pv) pv.fade_out = 0; }
      if (id === 'f') { x.xfade = 0; x.fade_in = Math.min(x.dur, Math.round(f / 2)); if (pv) pv.fade_out = Math.min(pv.dur, Math.round(f / 2)); }
    });
  } }, label);
  trans.append(el('span', { class: 'lbl' }, 'à l’entrée'),
    el('div', { class: 'opts tight' }, opt('c', 'coupe franche'), opt('x', 'fondu enchaîné', prev ? '' : 'il faut un plan collé juste avant, sur la même piste'), opt('f', fadeName)));
  if (mode === 'x') {
    const lim = Math.max(2, Math.min(c.dur, prev.dur));
    trans.append(slider({ label: 'durée', min: 2, max: lim, step: 1, value: Math.min(c.xfade, lim), fmt: (v) => M.short(v / f), disabled: locked,
      apply: set((x, v) => { x.xfade = v; }), title: 'centré sur la coupe : prend la matière au-delà des points d’entrée/sortie, ou fige l’image s’il n’y en a pas' }));
    trans.append(el('p', { class: 'note' }, 'centré sur la coupe ; sans matière au-delà des bords, l’image se fige le temps du fondu.'));
  }
  if (mode === 'f') {
    trans.append(slider({ label: 'durée', min: 1, max: maxT, step: 1, value: Math.min(c.fade_in, maxT), fmt: (v) => M.short(v / f), disabled: locked,
      apply: set((x, v) => { x.fade_in = v; if (prev) { const pv = M.byId(S.p, prev.id); if (pv) pv.fade_out = Math.min(pv.dur, v); } }) }));
    if (prev) trans.append(el('p', { class: 'note' }, 'le plan d’avant descend au noir sur la même durée.'));
  }
  const nextTouch = M.trackClips(S.p, c.track).find((x) => x.start === M.clipEnd(c) && x.xfade > 0);
  trans.append(el('span', { class: 'lbl' }, 'à la sortie'),
    nextTouch ? el('p', { class: 'note' }, 'fondu enchaîné avec le plan suivant (réglé sur celui-ci)')
      : slider({ label: 'fondu', title: `${fadeName.replace('fondu', 'fondu de sortie')} ; 0 = coupe franche`, min: 0, max: maxT, step: 1, value: Math.min(c.fade_out || 0, maxT), fmt: (v) => (v ? M.short(v / f) : 'coupe'), disabled: locked,
        apply: set((x, v) => { x.fade_out = v; }) }));
  cards.push(trans);

  // le son
  const sound = track.kind === 'audio' || (c.kind === 'video' && c.audio);
  if (c.kind !== 'image') {
    const snd = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Son')));
    if (sound) {
      snd.append(slider({ label: 'volume', min: 0, max: 2, step: 0.01, value: c.vol ?? 1, fmt: (v) => `${Math.round(v * 100)} %`, color: 'var(--grn2)', disabled: locked,
        title: '0 à 200 % ; au-delà de 100 %, gare à la saturation', apply: set((x, v) => { x.vol = v; }) }),
      el('div', { class: 'row' }, el('span', { class: 'lbl' }, dB(c.vol ?? 1)), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', disabled: locked || null, onclick: () => commit('volume à 100 %', (p) => { M.byId(p, c.id).vol = 1; }) }, '100 %')));
      if (!M.audibleTracks(S.p).has(track.id)) snd.append(el('p', { class: 'why' }, `la piste ${track.id} ne s’entend pas (muette, ou un autre solo)`));
    } else snd.append(el('p', { class: 'note' }, it.audio ? `son dissocié : il est sur une piste son` : 'cette vidéo n’a pas de son'));
    cards.push(snd);
  }

  // l'étalonnage et la LUT
  if (track.kind === 'video') {
    const g = c.grade || { ...M.NEUTRAL };
    const gs = (k) => set((x, v) => { x.grade = { ...(x.grade || M.NEUTRAL), [k]: v }; });
    const neutral = !g.exposure && !g.contrast && !g.saturation && (g.temperature || 6500) === 6500;
    cards.push(el('div', { class: 'card grade' },
      el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Étalonnage'),
        el('button', { class: 'lnk', disabled: (neutral || locked) ? true : null, onclick: () => commit('réinitialiser l’étalonnage', (p) => { M.byId(p, c.id).grade = { ...M.NEUTRAL }; }) }, 'Réinit.')),
      slider({ label: 'exposition', min: -2, max: 2, step: 0.05, value: g.exposure || 0, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} IL`, disabled: locked, apply: gs('exposure'), title: 'ffmpeg exposure (IL) · aperçu brightness()' }),
      slider({ label: 'contraste', min: -100, max: 100, step: 1, value: g.contrast || 0, fmt: (v) => `${v > 0 ? '+' : ''}${v}`, disabled: locked, apply: gs('contrast'), title: 'ffmpeg eq contrast · aperçu contrast()' }),
      slider({ label: 'saturation', min: -100, max: 100, step: 1, value: g.saturation || 0, fmt: (v) => `${v > 0 ? '+' : ''}${v}`, color: 'var(--or)', disabled: locked, apply: gs('saturation'), title: 'ffmpeg eq saturation · aperçu saturate()' }),
      slider({ label: 'température', min: 2000, max: 12000, step: 100, value: g.temperature || 6500, fmt: (v) => `${v} K`, cls: 'temp', disabled: locked, apply: gs('temperature'),
        title: 'ffmpeg colortemperature : bas = chaud (orangé), haut = froid (bleuté) ; 6500 K = neutre' }),
      el('p', { class: 'note' }, 'l’aperçu reprend les filtres de l’export, mesurés ; l’export fait foi.')));
    cards.push(lutCard(c, locked));
  }
  return cards;
}

// La LUT d'un plan : l'étagère (une vignette par LUT, sur l'image courante du plan), l'intensité.
function lutCard(c, locked) {
  const cur = c.lut && c.lut.id ? lutMeta(c.lut.id) : null;
  const card = el('div', { class: 'card lutc' },
    el('div', { class: 'card-head' }, el('span', { class: 't' }, 'LUT · ', el('b', {}, cur ? cur.title : c.lut ? '(introuvable)' : 'aucune')),
      el('button', { class: 'lnk', disabled: (!c.lut || locked) ? true : null, onclick: () => setLut([c.id], null) }, 'Retirer')));
  if (c.lut && !cur && S.luts.length) card.append(el('p', { class: 'warn' }, 'cette LUT n’est plus dans la bibliothèque (supprimée ?) : l’export la refusera'));
  if (cur && cur.input !== 'rec709') card.append(el('p', { class: 'why' }, `faite pour du ${cur.input_label} : sur une image Rec.709, le rendu sera faux`));
  // l'étagère : chercher, les favoris, puis les familles repliables (l'état par visiteur)
  const shelf = el('div', { class: 'shelf', 'data-clip': c.id });
  const tile = (m) => el('button', { class: 'lt' + (cur && cur.id === m.id ? ' on' : ''), 'data-lut': m.id, disabled: locked || null,
    title: `${m.title} · ${m.family} · ${m.kind.toUpperCase()} ${m.size}${m.resampled_from ? ` (de ${m.resampled_from})` : ''} · attend ${m.input_label}${m.note ? '\n' + m.note : ''}\nclic : poser sur ce plan · clic droit : favori, renommer, supprimer`,
    onclick: () => setLut([c.id], m.id) }, el('canvas', { width: 96, height: 54 }), el('span', {}, m.title),
  m.input !== 'rec709' ? el('i', { class: 'in' }, m.input === 'inconnu' ? '?' : m.input) : null, m.fav ? el('i', { class: 'star', title: 'favori' }, '★') : null);
  const tiles = (list) => el('div', { class: 'tiles' }, ...list.map(tile));
  const open = LS('montage-lut-open') || { '★': true };
  if (cur) open[cur.family] = open[cur.family] ?? true;
  const group = (key, label, list, cap = 400) => {
    const on = !!open[key];
    const head = el('button', { class: 'lg' + (on ? ' open' : ''), title: on ? 'replier' : 'déplier',
      onclick: () => { open[key] = !on; LS('montage-lut-open', open); paintInspector(); } },
    el('i', { class: 'chev' }), el('span', {}, label), el('small', { class: 'num' }, String(list.length)));
    return el('div', { class: 'lgrp' }, head, on ? tiles(list.slice(0, cap)) : null, on && list.length > cap ? el('p', { class: 'note' }, `${list.length - cap} de plus : cherchez`) : null);
  };
  const q = el('input', { class: 'fld lq', placeholder: `chercher parmi ${S.luts.length} LUT (Portra, ETERNA, N&B…)`, value: S.lutQ || '', 'aria-label': 'chercher une LUT' });
  q.addEventListener('input', () => { S.lutQ = q.value; clearTimeout(S.lutQT); S.lutQT = setTimeout(() => { paintInspector(); const n = $('#insp .lq'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 200); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Escape' && q.value) { e.stopPropagation(); S.lutQ = ''; paintInspector(); } });
  if (S.luts.length > 8) shelf.append(q);
  if (S.lutQ && S.lutQ.trim()) {
    const found = lutSearch(S.lutQ.trim());
    shelf.append(el('span', { class: 'lbl' }, found.length ? `${found.length} trouvée${found.length > 1 ? 's' : ''}${found.length > 60 ? ' · les 60 premières' : ''}` : 'aucune LUT ne correspond'), tiles(found.slice(0, 60)));
  } else if (S.luts.length > 12) {
    const fav = lutFav();
    if (fav.length) shelf.append(group('★', 'Favoris', fav));
    for (const f of lutFamilies()) shelf.append(group(f.name, f.name, f.list));
  } else shelf.append(tiles(S.luts));
  if (!S.luts.length) shelf.append(el('p', { class: 'note' }, 'aucune LUT encore : importez un .cube ou une HaldCLUT.'));
  card.append(shelf);
  if (c.lut) {
    card.append(slider({ label: 'intensité', min: 0, max: 100, step: 1, value: Math.round(c.lut.mix * 100), fmt: (v) => `${v} %`, disabled: locked,
      title: 'mêle l’image et l’image passée par la LUT ; l’export lit la même LUT mêlée', apply: (v) => { const x = M.byId(S.p, c.id); if (x && x.lut) x.lut = { ...x.lut, mix: v / 100 }; } }));
  }
  card.append(el('div', { class: 'row' }, el('button', { class: 'tb ghost sm', onclick: () => importLutModal((m) => setLut([c.id], m.id)) }, 'Importer .cube…'),
    el('span', { class: 'sp' }), el('span', { class: 'lbl', title: 'lut3d trilinéaire (lut1d linéaire) à l’export, le même calcul dans le shader WebGL2 de l’aperçu' }, 'aperçu = export')));
  return card;
}

// Les vignettes de l'étagère : l'image courante du plan, passée par chaque
// LUT (sa version 17³ de vignette). Seules les vignettes qui se voient se
// dessinent (IntersectionObserver, MDN), et chacune est gardée tant que
// l'image et l'étalonnage du plan ne changent pas.
let thumbImg = null, shelfIO = null;
const thumbCache = new Map();
function paintShelf() {
  const shelf = $('#insp .shelf');
  if (!shelf) return;
  const c = M.byId(S.p, shelf.dataset.clip);
  if (!c) return;
  const gl = lutGL();
  if (!gl.ok) { shelf.title = gl.why; return; }
  if (shelfIO) shelfIO.disconnect();
  shelfIO = new IntersectionObserver((ents) => {
    const seen = ents.filter((x) => x.isIntersecting).map((x) => x.target);
    for (const t of seen) { t.dataset.vis = '1'; shelfIO.unobserve(t); }
    if (seen.length) drawTiles(c, seen);
  }, { root: $('#insp'), rootMargin: '120px' });
  for (const t of shelf.querySelectorAll('.lt')) shelfIO.observe(t);
}
function drawTiles(c, list) {
  const gl = lutGL();
  const e = program.els.get(c.id);
  let src = null;
  if (e && e.tag === 'video' && e.el.readyState >= 2) src = e.el;
  else if (e && e.tag === 'img' && e.el.complete && e.el.naturalWidth) src = e.el;
  if (!src) {
    const it = S.items.get(c.item);
    const u = it && (c.kind === 'image' ? it.url : it.thumb_url);
    if (!u) return;
    if (!thumbImg || thumbImg.dataset.u !== u) {
      thumbImg = new Image();
      thumbImg.dataset.u = u;
      thumbImg.onload = () => drawTiles(c, list);
      thumbImg.src = href(u);
      return;
    }
    if (!thumbImg.complete || !thumbImg.naturalWidth) return;
    src = thumbImg;
  }
  const g = c.grade || {};
  const temp = g.temperature && Math.abs(g.temperature - 6500) > 0.5 ? tempGains(g.temperature) : [1, 1, 1];
  const srcKey = `${c.id}|${src === thumbImg ? src.dataset.u : (src.currentTime ?? src.src)}|${JSON.stringify(g)}`;
  for (const t of list) {
    if (!t.isConnected) continue;
    const cv = t.querySelector('canvas');
    const key = srcKey + '|' + t.dataset.lut;
    const kept = thumbCache.get(key);
    if (kept) { cv.getContext('2d').drawImage(kept, 0, 0); continue; }
    const lut = getMini(t.dataset.lut, () => drawTiles(c, [t]));
    if (!lut) continue;
    if (gl.draw(src, cv.width, cv.height, { lut, mix: 1, grade: g, temp, srcKey })) {
      cv.getContext('2d').drawImage(gl.cv, 0, 0);
      const keep = document.createElement('canvas');
      keep.width = cv.width; keep.height = cv.height;
      keep.getContext('2d').drawImage(cv, 0, 0);
      thumbCache.set(key, keep);
      if (thumbCache.size > 600) thumbCache.delete(thumbCache.keys().next().value);
    }
  }
}

function projectCards(f) {
  const st = S.p.settings;
  const cards = [];
  const fmtOpts = el('div', { class: 'opts tight' }, ...S.meta.formats.map((x) => el('button', { class: 'opt' + (x.id === st.format ? ' on' : ''),
    onclick: () => { commit('format', (p) => { p.settings.format = x.id; }); applySettings(); paintInspector(); } }, x.label, el('small', {}, `${x.w}×${x.h}`))),
  st.format === 'custom' ? el('button', { class: 'opt on', title: 'la taille du clip dont la séquence est née (« à partir de l’élément »)' }, 'sur mesure', el('small', {}, `${st.width}×${st.height}`)) : null);
  const fpsList = S.meta.fps.includes(st.fps) ? S.meta.fps : [...S.meta.fps, st.fps].sort((a, b) => a - b);
  const fpsOpts = el('div', { class: 'opts tight' }, ...fpsList.map((x) => el('button', { class: 'opt' + (x === st.fps ? ' on' : ''),
    onclick: () => {
      if (x === st.fps) return;
      const t = program.t;
      commit(`cadence ${x} i/s`, (p) => M.convertFps(p, x));
      applySettings(); timeline.render(); program.seek(t); paintInspector();
    } }, `${x} i/s`)));
  const dur = M.projectEnd(S.p) / f;
  cards.push(el('div', { class: 'card proj' },
    el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Séquence · ', el('b', {}, S.p.name))),
    el('dl', { class: 'props' }, el('dt', {}, 'durée'), el('dd', { class: 'tcv' }, M.tc(M.projectEnd(S.p), f)), el('dt', {}, 'plans'), el('dd', {}, String(S.p.clips.length)),
      el('dt', {}, 'pistes'), el('dd', {}, `${S.p.tracks.filter((t) => t.kind === 'video').length} vidéo · ${S.p.tracks.filter((t) => t.kind === 'audio').length} son`),
      el('dt', {}, 'sortie'), el('dd', {}, `${st.width}×${st.height} · ${st.fps} i/s · BT.709`)),
    el('span', { class: 'lbl' }, 'format'), fmtOpts,
    el('span', { class: 'lbl' }, 'cadence'), fpsOpts,
    slider({ label: 'image fixe', min: 0.5, max: 20, step: 0.5, value: st.still, fmt: (v) => M.short(v), title: 'durée d’une image posée sur la timeline (réglable ensuite, plan par plan)',
      apply: (v) => { S.p.settings.still = v; } }),
    el('p', { class: 'note' }, 'changer de cadence recale chaque bord sur la nouvelle grille ; deux plans collés le restent.')));
  // la séquence : entrée, sortie, marques
  const r = S.p.range || {};
  const seq = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Séquence'),
    el('button', { class: 'lnk', disabled: (r.in === null && r.out === null) ? true : null, onclick: () => clearRange('both'), title: 'ctrl+maj+X' }, 'Effacer E/S')),
  el('dl', { class: 'props' }, el('dt', {}, 'entrée'), el('dd', { class: 'tcv' }, r.in !== null && r.in !== undefined ? M.tc(r.in, f) : '—'),
    el('dt', {}, 'sortie'), el('dd', { class: 'tcv' }, r.out !== null && r.out !== undefined ? M.tc(r.out, f) : '—'),
    el('dt', {}, 'marques'), el('dd', {}, String((S.p.markers || []).length))));
  if ((S.p.markers || []).length) {
    seq.append(el('div', { class: 'mlist' }, ...S.p.markers.slice(0, 40).map((m) => el('button', { class: 'mrow', title: 'aller à la marque · double-clic : la nommer',
      onclick: () => program.seekFrame(m.f), ondblclick: () => renameMarker(m.id) }, el('i'), el('span', { class: 'tcv' }, M.tc(m.f, f)), el('span', {}, m.name || 'marque')))));
  } else seq.append(el('p', { class: 'note' }, 'I · O : entrée et sortie à la tête de lecture (l’export peut s’y borner) · M : une marque.'));
  cards.push(seq);
  // l'export
  const ex = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Exports'),
    el('span', { class: 'lbl' }, dur ? `${M.short(dur)} à rendre` : '')));
  if (S.exportJob) ex.append(exportMeter(S.exportJob));
  if (!S.p.clips.length) ex.append(el('p', { class: 'why' }, 'rien à exporter : posez des plans sur la timeline'));
  const mine = S.exports;
  ex.append(mine.length ? el('div', { class: 'exports' }, ...mine.slice(0, 6).map((it) => el('div', { class: 'exp', title: it.title },
    el('span', { class: 'th', style: it.thumb_url ? { backgroundImage: `url("${href(it.thumb_url)}")` } : null }),
    el('div', { style: { minWidth: 0 } }, el('b', {}, it.title), el('small', {}, `${M.short(it.duration || 0)} · ${it.width}×${it.height} · ${fmtDate(it.created)}`)),
    el('div', { class: 'row' }, el('button', { class: 'tb ghost sm', title: 'la regarder dans le moniteur source', onclick: () => openSource(it) }, 'Voir'),
      el('a', { class: 'tb ghost sm', href: href(it.url), download: `${it.title}.mp4`, title: 'télécharger le MP4' }, '↓')))))
    : el('p', { class: 'note' }, 'Les vidéos exportées vont dans la bibliothèque (Asset), avec leur lignée : les plans utilisés et ce montage.'));
  cards.push(ex);
  return cards;
}

// ── l'export ────────────────────────────────────────────────
function exportMeter(j) {
  const pc = j.progress != null ? Math.round(j.progress * 100) : null;
  return el('div', { class: 'meter exp-run' }, `${stateFr(j.state)} · ${j.message || ''}`,
    el('div', { class: 'bar' }, el('i', { style: { width: (pc ?? 4) + '%' } })),
    j.state === 'queued' || j.state === 'running' ? el('button', { class: 'tb ghost sm', onclick: () => jobs.cancel(j.id) }, 'Arrêter l’export') : null);
}

function exportModal() {
  if (!S.p) return;
  if (!S.p.clips.length) return toast('rien à exporter : posez des plans sur la timeline');
  const st = S.p.settings, f = st.fps;
  const fmtx = S.meta.formats.find((x) => x.id === st.format);
  let draft = false;
  const rb = rangeBounds();
  let ranged = !!rb;
  const hidden = S.p.tracks.filter((t) => t.hide).map((t) => t.id);
  const hear = M.audibleTracks(S.p);
  const deaf = S.p.tracks.filter((t) => !hear.has(t.id) && S.p.clips.some((c) => c.track === t.id && (t.kind === 'audio' || c.audio))).map((t) => t.id);
  const off = S.p.clips.filter((c) => !M.isOn(c)).length;
  const missing = S.p.clips.filter((c) => M.isOn(c) && !itemOf(c.item));
  const lutGone = S.p.clips.filter((c) => M.isOn(c) && c.lut && S.luts.length && !lutMeta(c.lut.id));
  const q = el('div', { class: 'opts' });
  const paintQ = () => q.replaceChildren(
    el('button', { class: 'opt' + (!draft ? ' on' : ''), onclick: () => { draft = false; paintQ(); } }, 'finale', el('small', {}, 'x264 medium · crf 18')),
    el('button', { class: 'opt' + (draft ? ' on' : ''), onclick: () => { draft = true; paintQ(); } }, 'brouillon', el('small', {}, 'x264 veryfast · plus rapide')));
  paintQ();
  const rg = el('div', { class: 'opts' });
  const durDd = el('dd', { class: 'big' });
  const paintR = () => {
    durDd.textContent = ranged && rb ? M.tc(rb[1] - rb[0], f) : M.tc(M.projectEnd(S.p), f);
    rg.replaceChildren(
      el('button', { class: 'opt' + (!ranged ? ' on' : ''), onclick: () => { ranged = false; paintR(); } }, 'tout le montage', el('small', {}, `00:00:00:00 → ${M.tc(M.projectEnd(S.p), f)}`)),
      el('button', { class: 'opt' + (ranged ? ' on' : ''), disabled: rb ? null : true, title: rb ? '' : 'posez une entrée et une sortie (I, O) sur la séquence',
        onclick: () => { ranged = true; paintR(); } }, 'de l’entrée à la sortie', el('small', {}, rb ? `${M.tc(rb[0], f)} → ${M.tc(rb[1], f)}` : 'pas d’entrée ni de sortie')));
  };
  paintR();
  const bodyNode = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    el('dl', { class: 'kv' },
      el('dt', {}, 'montage'), el('dd', {}, S.p.name),
      el('dt', {}, 'format'), el('dd', {}, `${fmtx ? fmtx.label : st.format} · ${st.width}×${st.height}`),
      el('dt', {}, 'cadence'), el('dd', {}, `${f} i/s`),
      el('dt', {}, 'durée'), durDd,
      el('dt', {}, 'plans'), el('dd', {}, String(S.p.clips.length) + (off ? ` (${off} désactivé${off > 1 ? 's' : ''})` : '')),
      el('dt', {}, 'fichier'), el('dd', {}, 'MP4 · H.264 BT.709 + AAC 48 kHz stéréo')),
    el('span', { class: 'lbl' }, 'étendue'), rg,
    el('span', { class: 'lbl' }, 'qualité'), q,
    el('p', {}, 'L’export rend ce que vous voyez et entendez : ' + (hidden.length || deaf.length
      ? `${hidden.length ? `piste${hidden.length > 1 ? 's' : ''} masquée${hidden.length > 1 ? 's' : ''} ${hidden.join(', ')}` : ''}${hidden.length && deaf.length ? ' et ' : ''}${deaf.length ? `${deaf.join(', ')} qu’on n’entend pas` : ''} n’y seront pas.`
      : 'toutes les pistes y sont.')),
    missing.length ? el('p', { class: 'warn' }, `${missing.length} plan(s) pointent vers un objet introuvable : l’export sera refusé`) : null,
    lutGone.length ? el('p', { class: 'warn' }, `${lutGone.length} plan(s) portent une LUT supprimée : l’export sera refusé`) : null);
  modal('Exporter', bodyNode, (close) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', onclick: close }, 'Annuler'),
    el('button', { class: 'tb go', onclick: async () => { close(); await startExport(draft, ranged); } }, 'Lancer l’export')]);
}

async function startExport(draft, ranged = false) {
  await flushSave();
  if (S.conflict) return toast('réglez d’abord le conflit d’enregistrement');
  try {
    const j = await jobs.submit('montage.export', { project: S.p.id, draft, range: ranged }, { title: `Montage · ${S.p.name}${ranged ? ' (E→S)' : ''}`, tool: 'montage' });
    watchExport(j);
  } catch (e) { toast(e.message); }
}

async function watchExport(j) {
  S.exportJob = j;
  paintExportPill();
  const pid = j.params && j.params.project;
  const done = await jobs.wait(j.id, (x) => { S.exportJob = x; paintExportPill(); if (!S.sel.size && S.p && S.p.id === pid) paintInspector(); });
  S.exportJob = null;
  paintExportPill();
  if (done.state === 'done') {
    const it = done.items && done.items[0];
    toast(`export fini : ${done.result && done.result.note ? done.result.note : ''}`, 5000);
    if (it) { S.items.set(it.id, it); openSource(it); }
    loadBin();
  } else toast(`export ${stateFr(done.state)} : ${done.message || ''}`, 7000);
  await loadExports();
}

function paintExportPill() {
  const p = $('#exp-st');
  const j = S.exportJob;
  p.hidden = !j;
  if (!j) return;
  p.className = 'pill exp work';
  p.lastChild.textContent = j.state === 'queued' ? 'export en file' : `export ${String(j.progress != null ? Math.round(j.progress * 100) : 0).padStart(3, ' ')} %`;
  p.title = j.message || '';
}

async function loadExports() {
  if (!S.p) return;
  try {
    const r = await api('library?kind=video&tool=montage&limit=200');
    S.exports = r.items.filter((it) => it.params && (it.params.montage === S.p.id || (S.p.legacy && it.params.montage === S.p.legacy)));
  } catch { S.exports = []; }
  if (!S.sel.size) paintInspector();
}

async function resumeExport() {
  try {
    const { jobs: list } = await api('jobs?active=1&tool=montage');
    const j = list.find((x) => x.kind === 'montage.export' && x.params && x.params.project === S.p.id);
    if (j && !S.exportJob) watchExport(j);
  } catch { /* */ }
}

// ── les outils (Premiere Pro : panneau Outils) ──────────────
// Noms français de la doc d'Adobe (helpx.adobe.com/fr/premiere, 2025-2026),
// lettres du tableau « Outils » des raccourcis par défaut (Adobe, 2018) ;
// sources dans docs/etudes/montage.md.
const TOOLS = [
  { id: 'select', key: 'V', fr: 'Sélection', en: 'Selection', hot: [6, 3], what: 'choisir, déplacer, rogner les bords · maj/ctrl : ajouter · alt + glisser : copier',
    d: 'M6 3l12 9-5.5 1.5L10 20z' },
  { id: 'track', key: 'A', fr: 'Sélection de piste en avant', en: 'Track Select Forward', what: 'le plan et tout ce qui suit sur sa piste · maj : sur toutes les pistes',
    d: 'M4 5v14M8 12h12M15 7l5 5-5 5' },
  { id: 'ripple', key: 'B', fr: 'Propagation', en: 'Ripple Edit', what: 'rogner un bord en poussant ou tirant la suite de la piste : pas de vide',
    d: 'M10 5H6v14h4M14 12h7M18 9l3 3-3 3' },
  { id: 'roll', key: 'N', fr: 'Déplacement de la coupe', en: 'Rolling Edit', what: 'bouger la coupe entre deux plans collés : l’un s’allonge, l’autre raccourcit',
    d: 'M9 5v14M15 5v14M9 5H6M9 19H6M15 5h3M15 19h3M2 12h4M18 12h4' },
  { id: 'stretch', key: 'R', fr: 'Modification de la vitesse', en: 'Rate Stretch', what: 'tirer un bord : la durée et la vitesse changent, la matière reste',
    d: 'M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3M9 5l3-2 3 2M9 19l3 2 3-2' },
  { id: 'blade', key: 'C', fr: 'Cutter', en: 'Razor', what: 'couper où l’on clique · maj : toutes les pistes · ctrl+K : à la tête de lecture',
    d: 'M6 3v18M14 5l4 14M14 5l-2 2' },
  { id: 'slip', key: 'Y', fr: 'Déplacer dessous', en: 'Slip', what: 'le contenu glisse dans le plan ; sa place et sa durée ne bougent pas',
    d: 'M3 7h18v10H3zM8 12h8M10 10l-2 2 2 2M14 10l2 2-2 2' },
  { id: 'slide', key: 'U', fr: 'Déplacer le plan', en: 'Slide', what: 'le plan glisse entre ses voisins, qui s’ajustent ; sa matière et sa durée restent',
    d: 'M2 6v12M22 6v12M7 8h10v8H7zM4 12h3M17 12h3' },
  { id: 'hand', key: 'H', fr: 'Main', en: 'Hand', what: 'glisser pour faire défiler la timeline',
    d: 'M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7-3 0-4.5-1.8-6-4.2L3.2 13a1.5 1.5 0 0 1 2.6-1.4L8 14' },
  { id: 'zoom', key: 'Z', fr: 'Zoom', en: 'Zoom', what: 'cliquer pour zoomer · alt + clic : dézoomer',
    d: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5L21 21M8 10.5h5M10.5 8v5' },
];
const TOOL_BY_KEY = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));
const svg = (d) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;

// Le curseur de chaque outil : son icône, dessinée aux couleurs des jetons
// (lues à l'exécution : aucune couleur écrite ici), un contour sombre pour se
// voir sur les plans clairs.
function toolCursors() {
  const cs = getComputedStyle(document.documentElement);
  const ink = cs.getPropertyValue('--ink').trim(), dark = cs.getPropertyValue('--bg').trim();
  const fallback = { select: 'default', track: 'e-resize', ripple: 'ew-resize', roll: 'col-resize', stretch: 'ew-resize', blade: 'crosshair', slip: 'ew-resize', slide: 'move', hand: 'grab', zoom: 'zoom-in' };
  const root = document.documentElement.style;
  for (const t of TOOLS) {
    if (t.id === 'select') continue;
    const s = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${t.d}" stroke="${dark}" stroke-width="4"/><path d="${t.d}" stroke="${ink}" stroke-width="1.7"/></svg>`;
    const [x, y] = t.hot || [12, 12];
    root.setProperty('--cur-' + t.id, `url("data:image/svg+xml,${encodeURIComponent(s)}") ${x} ${y}, ${fallback[t.id]}`);
  }
}

function paintTools() {
  $('#tools').replaceChildren(...TOOLS.map((t) => el('button', { class: 'ic tool' + (S.tool === t.id ? ' on' : ''), 'data-tool': t.id, 'aria-pressed': String(S.tool === t.id),
    title: `${t.fr} (${t.en}) · ${t.key}\n${t.what}`, html: svg(t.d), onclick: () => setTool(t.id) })));
}

function setTool(t) {
  if (S.tool === t) return;
  S.tool = t;
  paintTools();
  timeline.root.dataset.tool = t;
  const d = TOOLS.find((x) => x.id === t);
  toast(`${d.fr} · ${d.key} — ${d.what}`, 1800);
}

// ── la barre ────────────────────────────────────────────────
function paintBar() {
  if (!S.p) return;
  const f = fps();
  $('#tl-n').textContent = S.p.clips.length;
  $('#tl-dur').textContent = M.tc(M.projectEnd(S.p), f);
  $('#prg-dur').textContent = M.tc(M.projectEnd(S.p), f);
  const hasSel = S.sel.size > 0;
  $('#b-del').disabled = !hasSel && !S.gap;
  $('#b-ripple').disabled = !hasSel && !S.gap;
  $('#b-del').title = hasSel || S.gap ? 'effacer · Suppr' : 'choisissez d’abord un plan (ou un vide)';
  const exp = $('#b-export');
  exp.disabled = !S.p.clips.length;
  exp.title = S.p.clips.length ? 'rendre le montage en MP4 (H.264 + AAC) dans la bibliothèque · ctrl+M' : 'rien à exporter : posez des plans sur la timeline';
  $('#prg-empty').hidden = !!S.p.clips.length;
  const sw = $('#b-snap');
  sw.classList.toggle('on', S.snap);
  sw.setAttribute('aria-pressed', String(S.snap));
}

function helpModal() {
  const K = [
    ['OUTILS', ''],
    ...TOOLS.map((t) => [t.key, `${t.fr} (${t.en}) — ${t.what}`]),
    ['LECTURE', ''],
    ['espace', 'lecture / pause du moniteur actif (cliquez-le : source ou programme)'],
    ['J · K · L', 'arrière, arrêt, avant (répéter : plus vite)'],
    ['← →', 'image par image · maj : une seconde'],
    ['↑ ↓', 'point de montage précédent, suivant'],
    ['Origine · Fin', 'début, fin'],
    ['MONTAGE', ''],
    ['I · O', 'entrée, sortie (de la source, ou de la séquence si le programme a le clavier)'],
    ['maj + I · maj + O', 'aller à l’entrée, à la sortie'],
    ['ctrl + maj + I · O · X', 'effacer l’entrée, la sortie, les deux'],
    ['virgule · point', 'insérer, écraser la source à la tête de lecture'],
    ['point-virgule · apostrophe', 'prélever, extraire la plage entrée → sortie'],
    ['ctrl + K · ctrl + maj + K', 'ajouter une coupe à la tête de lecture · à toutes les pistes'],
    ['ctrl + D', 'fondu enchaîné d’une seconde sur le plan choisi'],
    ['Suppr · maj + Suppr', 'effacer · supprimer et raccorder'],
    ['ctrl + C · V · maj + V', 'copier · coller · coller et insérer, à la tête de lecture'],
    ['ctrl + R · maj + E · ctrl + L', 'vitesse/durée · activer · dissocier le son'],
    ['alt + ← →', 'décaler les plans choisis d’une image (maj : cinq)'],
    ['alt + virgule · point', 'déplacer le plan choisi entre ses voisins (slide), d’une image (maj : cinq)'],
    ['ctrl + alt + ← →', 'déplacer dessous (slip) d’une image (maj : cinq)'],
    ['M · maj + M · ctrl + maj + M', 'marque · marque suivante · précédente'],
    ['ctrl + alt + M · + maj', 'effacer la marque sous la tête · toutes les marques'],
    ['D · ctrl + A · ctrl + maj + A', 'choisir sous la tête de lecture · tout · rien'],
    ['F', 'concordance des images : le plan sous la tête, dans la source à la même image'],
    ['S · = · − · \\', 'aimant · zoomer · dézoomer · tout le montage'],
    ['glisser + ctrl', 'insérer (pousse la suite) au lieu d’écraser'],
    ['PROJET (ASSET)', ''],
    ['un objet sur un autre', 'un dossier neuf pour les deux (son nom est demandé) — les dossiers sont ceux d’Asset'],
    ['cadre sur le fond', 'choisir plusieurs objets (maj : ajouter) ; les glisser sur l’icône dossier : un dossier neuf'],
    ['ctrl + B · ctrl + /', 'nouveau dossier avec la sélection'],
    ['double-clic', 'un dossier : dans un onglet · son nom : le renommer · une séquence : dans un onglet de la timeline'],
    ['F2 · Suppr · Entrée', 'renommer · mettre à la corbeille (un dossier : le défaire) · ouvrir'],
    ['ctrl + I', 'importer'],
    ['clic droit', 'partout : les actions de l’endroit (un clip : « Nouvelle séquence à partir de l’élément »)'],
  ];
  modal('Raccourcis (ceux de Premiere Pro)', el('dl', { class: 'keys' }, ...K.flatMap(([k, v]) => (v ? [el('dt', {}, k), el('dd', {}, v)] : [el('dt', { class: 'sec' }, k), el('dd', {})]))), null, { cls: 'lg' });
}

// ── les menus du clic droit (commun/menu.js) ────────────────
// La carte (zone → entrées, avec la référence Premiere) : docs/etudes/montage.md.
const K = { cut: 'Ctrl+K', cutAll: 'Ctrl+Maj+K', del: 'Suppr', ripple: 'Maj+Suppr', copy: 'Ctrl+C', paste: 'Ctrl+V', pasteIns: 'Ctrl+Maj+V',
  speed: 'Ctrl+R', enable: 'Maj+E', unlink: 'Ctrl+L', xfade: 'Ctrl+D', match: 'F', marker: 'M', in: 'I', out: 'O', clearIO: 'Ctrl+Maj+X',
  lift: ';', extract: '\'', newBin: 'Ctrl+B', importK: 'Ctrl+I', rename: 'F2', insert: ',', over: '.', selAll: 'Ctrl+A' };
const noProject = { disabled: true, why: 'ouvrez d’abord un montage' };

function lutItems(ids) {
  const cur = ids.length === 1 ? M.byId(S.p, ids[0]).lut : null;
  const entry = (m) => ({ label: m.title, sub: m.input === 'rec709' ? '' : m.input, checked: !!cur && cur.id === m.id, onclick: () => setLut(ids, m.id) });
  const many = S.luts.length > 12;
  const fav = lutFav();
  return [
    { label: 'Aucune', checked: !cur, onclick: () => setLut(ids, null) },
    ...(S.luts.length ? ['-'] : []),
    ...(many ? [...(fav.length ? [{ head: 'Favoris' }, ...fav.map(entry), '-'] : []),
      ...lutFamilies().map((f) => ({ label: f.name, sub: String(f.list.length), items: f.list.map(entry) }))] : S.luts.map(entry)),
    '-',
    many ? { label: 'Chercher sur l’étagère…', onclick: () => { if (ids.length === 1) select(new Set(ids)); setTimeout(() => { const n = $('#insp .lq'); if (n) { n.scrollIntoView({ block: 'center' }); n.focus(); } }, 60); } } : null,
    { label: 'Importer une LUT…', icon: '+', onclick: () => importLutModal((m) => setLut(ids, m.id)) },
  ];
}

function trackMenu(tid) {
  const t = M.trackOf(S.p, tid);
  if (!t) return null;
  const kindFr = t.kind === 'video' ? 'vidéo' : 'son';
  const other = t.kind === 'video' ? 'audio' : 'video';
  const nClips = S.p.clips.filter((c) => c.track === tid).length;
  const last = S.p.tracks.filter((x) => x.kind === t.kind).length <= 1;
  const full = S.p.tracks.filter((x) => x.kind === t.kind).length >= M.MAX_TRACKS;
  return [
    { head: `Piste ${tid}${t.name ? ' · ' + t.name : ''}` },
    { label: `Ajouter une piste ${kindFr} au-dessus`, icon: '+', disabled: full, why: `${M.MAX_TRACKS} pistes au plus`, onclick: () => addTrack(t.kind, tid, 'above') },
    { label: `Ajouter une piste ${kindFr} au-dessous`, icon: '+', disabled: full, why: `${M.MAX_TRACKS} pistes au plus`, onclick: () => addTrack(t.kind, tid, 'below') },
    { label: `Ajouter une piste ${other === 'video' ? 'vidéo (en haut)' : 'son (en bas)'}`, icon: '+', onclick: () => addTrack(other, null, other === 'video' ? 'above' : 'below') },
    '-',
    { label: 'Renommer la piste…', onclick: () => renameTrack(tid) },
    { label: 'En faire la piste cible', checked: S.target[t.kind] === tid, onclick: () => { S.target[t.kind] = tid; timeline.render(); } },
    { label: 'Choisir tous ses plans', disabled: !nClips, why: 'la piste est vide', onclick: () => select(new Set(S.p.clips.filter((c) => c.track === tid).map((c) => c.id))) },
    t.kind === 'video' ? { label: 'Appliquer une LUT à tous ses plans', disabled: !nClips || t.lock, why: t.lock ? 'la piste est verrouillée' : 'la piste est vide', items: lutItems(S.p.clips.filter((c) => c.track === tid).map((c) => c.id)) } : null,
    '-',
    { label: 'Verrouiller', checked: t.lock, onclick: () => timeline.app.toggleTrack(tid, 'lock', 'verrouiller une piste') },
    t.kind === 'video' ? { label: 'Masquer (ni vue, ni exportée)', checked: t.hide, onclick: () => timeline.app.toggleTrack(tid, 'hide', 'masquer une piste') } : null,
    { label: 'Muette', checked: t.mute, onclick: () => timeline.app.toggleTrack(tid, 'mute', 'couper une piste') },
    { label: 'Solo', checked: t.solo, onclick: () => timeline.app.toggleTrack(tid, 'solo', 'solo') },
    '-',
    { label: 'Supprimer la piste', danger: true, disabled: last, why: `il faut au moins une piste ${kindFr}`, sub: nClips ? `${nClips} plan${nClips > 1 ? 's' : ''}` : '', onclick: () => deleteTrack(tid) },
  ];
}

function clipMenu(id, f) {
  const c = M.byId(S.p, id);
  if (!c) return null;
  if (!S.sel.has(id)) select(new Set([id]));
  const ids = [...S.sel];
  const t = M.trackOf(S.p, c.track);
  const lk = t.lock ? { disabled: true, why: `la piste ${c.track} est verrouillée` } : {};
  const ph = program.frame();
  const inPh = c.start < ph && M.clipEnd(c) > ph;
  const inF = c.start < f && M.clipEnd(c) > f;
  const it = S.items.get(c.item) || {};
  return [
    { head: c.title || it.title || 'plan' },
    { label: `Couper ici · ${M.tc(f, fps())}`, key: 'C', ...(!inF ? { disabled: true, why: 'sur un bord : rien à couper' } : lk), onclick: () => cut(f, id) },
    { label: 'Ajouter une coupe à la tête de lecture', key: K.cut, ...(!inPh ? { disabled: true, why: 'la tête de lecture ne passe pas dans ce plan' } : lk), onclick: () => cutAtPlayhead() },
    '-',
    { label: 'Copier', key: K.copy, onclick: copySel },
    { label: 'Coller à la tête de lecture', key: K.paste, disabled: !S.clip, why: 'rien à coller : copiez d’abord des plans', onclick: () => paste(false) },
    { label: 'Dupliquer à la suite', sub: 'insère', ...lk, onclick: () => duplicateAfter(id) },
    '-',
    { label: 'Effacer', key: K.del, ...lk, onclick: () => del(false) },
    { label: 'Supprimer et raccorder', key: K.ripple, ...lk, onclick: () => del(true) },
    '-',
    { label: 'Vitesse/Durée…', key: K.speed, ...(c.kind === 'image' ? { disabled: true, why: 'une image fixe n’a pas de vitesse : réglez sa durée dans l’inspecteur' } : lk), onclick: () => speedModal(id) },
    t.kind === 'video' ? { label: 'LUT', items: lutItems(ids), ...lk } : null,
    { label: 'Activer', key: K.enable, checked: M.isOn(c), ...lk, onclick: () => toggleEnabled(ids) },
    t.kind === 'video' ? { label: 'Fondu enchaîné à l’entrée', key: K.xfade, ...(!prevClip(S.p, c) ? { disabled: true, why: 'il faut un plan collé juste avant, sur la même piste' } : lk), onclick: () => dissolve(id) } : null,
    c.kind === 'video' && t.kind === 'video' ? { label: 'Dissocier le son', key: K.unlink, ...(!c.audio ? { disabled: true, why: it.audio ? 'déjà dissocié' : 'cette vidéo n’a pas de son' } : lk), onclick: () => detachSound(id) } : null,
    '-',
    { label: 'Ouvrir dans le moniteur source', sub: 'double-clic', disabled: !!it.missing, why: 'objet introuvable', onclick: () => openClipInSource(id) },
    { label: 'Concordance des images', key: K.match, ...(!inPh ? { disabled: true, why: 'placez la tête de lecture dans ce plan' } : {}), onclick: matchFrame },
    { label: 'Renommer le plan…', onclick: async () => { const v = await askName('Renommer le plan', c.title || '', 'Renommer', { placeholder: 'le nom du plan dans ce montage', max: 200 }); if (v) commit('renommer le plan', (p) => { M.byId(p, id).title = v; }); } },
    { label: 'Révéler dans le chutier', onclick: () => revealInBin(c.item) },
    { label: 'Révéler dans Asset', sub: '↗', onclick: () => revealInAsset(c.item) },
  ];
}

function laneMenu(tid, f) {
  const t = M.trackOf(S.p, tid);
  const gap = M.gapAt(S.p, tid, f);
  const lk = t.lock ? { disabled: true, why: `la piste ${tid} est verrouillée` } : {};
  return [
    { head: `${tid} · ${M.tc(f, fps())}` },
    { label: 'Supprimer le vide et raccorder', key: K.ripple, ...(!gap ? { disabled: true, why: 'pas de vide entre deux plans ici' } : lk), onclick: () => { select(new Set(), gap); del(true); } },
    { label: 'Coller ici', key: K.paste, disabled: !S.clip, why: 'rien à coller : copiez d’abord des plans', onclick: () => paste(false, f) },
    { label: 'Coller et insérer ici', key: K.pasteIns, disabled: !S.clip, why: 'rien à coller : copiez d’abord des plans', onclick: () => paste(true, f) },
    { label: 'Couper toutes les pistes ici', onclick: () => cut(f, null) },
    { label: 'Placer la tête de lecture ici', onclick: () => program.seekFrame(f) },
    '-',
    { label: 'Ajouter une piste', items: [
      { label: 'Vidéo au-dessus de celle-ci', disabled: t.kind !== 'video', why: 'une piste son : prenez « son »', onclick: () => addTrack('video', tid, 'above') },
      { label: 'Vidéo en haut', onclick: () => addTrack('video', null, 'above') },
      { label: 'Son au-dessous de celle-ci', disabled: t.kind !== 'audio', why: 'une piste vidéo : prenez « vidéo »', onclick: () => addTrack('audio', tid, 'below') },
      { label: 'Son en bas', onclick: () => addTrack('audio', null, 'below') },
    ] },
    { label: 'Tout choisir', key: K.selAll, onclick: () => select(new Set(S.p.clips.map((c) => c.id))) },
  ];
}

function rulerMenu(f) {
  const r = S.p.range || {};
  const has = r.in !== null || r.out !== null;
  const m = markerAt(f);
  return [
    { head: `Règle · ${M.tc(f, fps())}` },
    { label: 'Ajouter une marque ici', key: K.marker, onclick: () => addMarkerAt(f) },
    m ? { label: `Nommer la marque « ${m.name || 'marque'} »…`, onclick: () => renameMarker(m.id) } : null,
    m ? { label: 'Effacer cette marque', key: 'Ctrl+Alt+M', onclick: () => commit('effacer la marque', (p) => { p.markers = p.markers.filter((x) => x.id !== m.id); }) } : null,
    '-',
    { label: 'Point d’entrée ici', key: K.in, onclick: () => setRange('in', f) },
    { label: 'Point de sortie ici', key: K.out, onclick: () => setRange('out', f) },
    { label: 'Effacer l’entrée et la sortie', key: K.clearIO, disabled: !has, why: 'pas d’entrée ni de sortie', onclick: () => clearRange('both') },
    { label: 'Prélever (entrée → sortie)', key: K.lift, disabled: !has, why: 'posez d’abord une entrée et une sortie', onclick: () => liftExtract(false) },
    { label: 'Extraire (entrée → sortie)', key: K.extract, disabled: !has, why: 'posez d’abord une entrée et une sortie', onclick: () => liftExtract(true) },
    '-',
    { label: 'Marque précédente', key: 'Ctrl+Maj+M', onclick: () => gotoMarker(-1) },
    { label: 'Marque suivante', key: 'Maj+M', onclick: () => gotoMarker(1) },
    { label: 'Effacer toutes les marques', key: 'Ctrl+Alt+Maj+M', danger: true, disabled: !(S.p.markers || []).length, why: 'aucune marque', onclick: () => commit('effacer les marques', (p) => { p.markers = []; }) },
  ];
}

function seqTabMenu(e) {
  const t = e.target.closest('.stab[data-seq]');
  if (!t) return [{ head: 'Séquences' }, { label: 'Nouvelle séquence…', onclick: () => newProjectFlow(project.state.tab) }, { label: 'Toutes les séquences…', onclick: projectsModal }];
  const id = t.dataset.seq;
  const it = S.items.get(id);
  return [
    { head: `Séquence · ${(S.p && S.p.id === id ? S.p.name : it && it.title) || id}` },
    { label: 'Y passer', disabled: S.p && S.p.id === id, why: 'c’est la séquence ouverte', onclick: () => openProject(id) },
    { label: 'Renommer…', onclick: async () => { const v = await askName('Renommer la séquence', (S.p && S.p.id === id ? S.p.name : it && it.title) || '', 'Renommer', { placeholder: 'le nom de la séquence' }); if (v) { await renameSequence(id, v); paintSeqTabs(); } } },
    { label: 'Dupliquer', onclick: () => duplicateSequence(id) },
    { label: 'Révéler dans le projet', onclick: () => revealInBin(id) },
    '-',
    { label: 'Fermer l’onglet', onclick: () => closeSeqTab(id) },
    { label: 'Fermer les autres onglets', disabled: S.tabs.length < 2, why: 'un seul onglet', onclick: () => { for (const x of [...S.tabs]) if (x !== id) closeSeqTab(x, { quiet: true }); } },
  ];
}

function markerMenu(id) {
  const m = (S.p.markers || []).find((x) => x.id === id);
  if (!m) return null;
  return [
    { head: `Marque · ${M.tc(m.f, fps())}` },
    { label: 'Y aller', onclick: () => program.seekFrame(m.f) },
    { label: 'Nommer…', sub: 'double-clic', onclick: () => renameMarker(id) },
    { label: 'Effacer', key: 'Ctrl+Alt+M', danger: true, onclick: () => commit('effacer la marque', (p) => { p.markers = p.markers.filter((x) => x.id !== id); }) },
  ];
}

function timelineMenu(e) {
  if (!S.p) return null;
  const f = timeline.frameAt(e.clientX);
  const mk = e.target.closest('.tl-m');
  if (mk) return markerMenu(mk.dataset.marker);
  if (e.target.closest('.tl-ruler')) return rulerMenu(f);
  const hd = e.target.closest('.tl-lanes .tl-hd');
  if (hd) return trackMenu(hd.dataset.head);
  const clip = e.target.closest('.clip');
  if (clip) return clipMenu(clip.dataset.id, f);
  const lane = e.target.closest('.tl-lane');
  if (lane) return laneMenu(lane.dataset.track, f);
  return null;
}

// l'étagère de LUT (inspecteur) : renommer, dire l'image attendue, supprimer
function inspMenu(e) {
  const t = e.target.closest('.lt');
  if (!t) return null;
  const m = lutMeta(t.dataset.lut);
  if (!m) return null;
  const edit = async (patch) => {
    try { await api(`montage/luts/${m.id}`, { method: 'POST', body: patch }); await loadLuts(); }
    catch (er) { toast(er.status === 403 ? 'cette LUT est à quelqu’un d’autre : seul son auteur (ou Cal) la change' : er.message); }
  };
  const users = S.p ? S.p.clips.filter((c) => c.lut && c.lut.id === m.id).length : 0;
  return [
    { head: `LUT · ${m.title}` },
    { label: 'Favori', checked: m.fav > 0, sub: m.fav ? `n° ${m.fav}` : '', onclick: () => edit({ fav: !(m.fav > 0) }) },
    { label: 'Renommer…', onclick: async () => { const v = await askName('Renommer la LUT', m.title, 'Renommer', { placeholder: 'le nom de la LUT', max: 80 }); if (v) edit({ title: v }); } },
    { label: 'Changer de famille…', sub: m.family, onclick: async () => { const v = await askName('Famille de la LUT', m.family, 'Ranger', { placeholder: 'la famille sur l’étagère', max: 60 }); if (v) edit({ family: v }); } },
    { label: 'L’image qu’elle attend', items: (S.meta.lut_inputs || []).map((x) => ({ label: x.label, checked: m.input === x.id, onclick: () => edit({ input: x.id }) })) },
    { label: `${m.kind.toUpperCase()} ${m.size}${m.source ? ' · ' + m.source : ''}`, disabled: true, why: 'la taille de la grille et le fichier d’origine' },
    '-',
    { label: 'Supprimer de la bibliothèque', danger: true, sub: users ? `${users} plan${users > 1 ? 's' : ''} ici` : '', onclick: async () => {
      if (!(await confirmBox('Supprimer la LUT', `« ${m.title} » part à la corbeille des LUT${users ? ` ; ${users} plan${users > 1 ? 's' : ''} de ce montage la ${users > 1 ? 'portent' : 'porte'} encore : l’export les refusera tant qu’ils la gardent` : ''}.`, 'Supprimer'))) return;
      try { await api(`montage/luts/${m.id}/delete`, { method: 'POST' }); await loadLuts(); paintInspector(); } catch (er) { toast(er.message); }
    } },
  ];
}

function sourceMenu() {
  const it = source.item;
  const media = it && it.kind !== 'image';
  const np = S.p ? {} : noProject;
  const none = { disabled: true, why: 'choisissez d’abord un plan dans le chutier' };
  if (!it) return [{ head: 'Source' }, { label: 'Ouvrir un plan : cliquez-le dans le chutier', ...none }];
  const nm = media ? {} : { disabled: true, why: 'une image fixe n’a ni entrée ni sortie' };
  return [
    { head: `Source · ${it.title || ''}` },
    { label: source.playing ? 'Pause' : 'Lecture', key: 'Espace', ...nm, onclick: () => source.toggle() },
    { label: 'Marquer l’entrée', key: K.in, ...nm, onclick: () => source.markIn() },
    { label: 'Marquer la sortie', key: K.out, ...nm, onclick: () => source.markOut() },
    { label: 'Effacer l’entrée et la sortie', key: K.clearIO, ...nm, onclick: () => { source.clearIn(); source.clearOut(); } },
    '-',
    { label: 'Insérer à la tête de lecture', key: K.insert, ...np, onclick: () => fromSource('insert') },
    { label: 'Écraser à la tête de lecture', key: K.over, ...np, onclick: () => fromSource('overwrite') },
    { label: 'Ajouter au bout de la piste cible', ...np, onclick: () => appendItem(it.id, { in: source.in, out: source.out }) },
    '-',
    { label: 'Révéler dans le chutier', onclick: () => revealInBin(it.id) },
    { label: 'Révéler dans Asset', sub: '↗', onclick: () => revealInAsset(it.id) },
  ];
}

function programMenu() {
  if (!S.p) return [{ head: 'Programme' }, { label: 'Ouvrir un montage', onclick: projectsModal }];
  const f = program.frame();
  const r = S.p.range || {};
  return [
    { head: `Programme · ${M.tc(f, fps())}` },
    { label: program.playing ? 'Pause' : 'Lecture', key: 'Espace', onclick: () => program.toggle() },
    { label: 'Aller au début', key: 'Origine', onclick: () => program.seek(0) },
    { label: 'Aller à la fin', key: 'Fin', onclick: () => program.seek(program.duration()) },
    '-',
    { label: 'Point d’entrée à la tête de lecture', key: K.in, onclick: () => setRange('in', f) },
    { label: 'Point de sortie à la tête de lecture', key: K.out, onclick: () => setRange('out', f) },
    { label: 'Effacer l’entrée et la sortie', key: K.clearIO, disabled: r.in === null && r.out === null, why: 'pas d’entrée ni de sortie', onclick: () => clearRange('both') },
    { label: 'Ajouter une marque', key: K.marker, onclick: () => addMarkerAt(f) },
    '-',
    { label: 'Concordance des images', key: K.match, disabled: !(program.visible || []).length, why: 'aucune image sous la tête de lecture', onclick: matchFrame },
    { label: 'Ajouter une coupe à toutes les pistes', key: K.cutAll, onclick: () => cutAtPlayhead(true) },
    { label: 'Zones de sécurité', checked: S.safe, sub: '90 % · 80 %', onclick: () => { S.safe = !S.safe; LS('montage-safe', S.safe); $('#safe').hidden = !S.safe; } },
    '-',
    { label: 'Exporter…', key: 'Ctrl+M', disabled: !S.p.clips.length, why: 'rien à exporter : posez des plans sur la timeline', onclick: exportModal },
  ];
}

// ── le clavier ──────────────────────────────────────────────
function nudge(df) {
  const ids = new Set([...S.sel].filter((id) => { const c = M.byId(S.p, id); return c && !lockedTracks().has(c.track); }));
  if (!ids.size) return toast('choisissez d’abord des plans');
  const min = Math.min(...[...ids].map((id) => M.byId(S.p, id).start));
  if (min + df < 0) return;
  commit('décaler', (p) => M.moveClips(p, ids, df, 0, 'overwrite'));
}
function oneSelected(verb) {
  if (S.sel.size !== 1) { toast(`choisissez un seul plan à ${verb}`); return null; }
  const c = M.byId(S.p, [...S.sel][0]);
  if (!c) return null;
  if (lockedTracks().has(c.track)) { toast(`la piste ${c.track} est verrouillée`); return null; }
  return c;
}
function slipKey(d) {
  const c = oneSelected('déplacer dessous');
  if (!c) return;
  if (c.kind === 'image') return toast('une image fixe n’a rien à faire glisser dessous');
  const [lo, hi] = M.slipLimits(S.p, c);
  const dd = Math.max(lo, Math.min(hi, d));
  if (!dd) return toast('au bout de la source : plus de matière de ce côté', 1400);
  commit('déplacer dessous', (p) => M.slip(p, c.id, dd));
}
function slideKey(d) {
  const c = oneSelected('déplacer');
  if (!c) return;
  const [lo, hi] = M.slideLimits(S.p, c);
  const dd = Math.max(lo, Math.min(hi, d));
  if (!dd) return toast('plus de place de ce côté', 1400);
  commit('déplacer le plan', (p) => M.slide(p, c.id, dd));
}

document.addEventListener('keydown', (e) => {
  if ($('.scrim') || $('.sr-menu')) return;         // une boîte ou un menu ouvert garde le clavier
  // espace sur un bouton ou un curseur qui a gardé le focus : c'est la lecture, pas un clic
  if (e.key === ' ' && e.target.matches && e.target.matches('button, input[type=range]')) e.target.blur();
  else if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) {
    if (e.key === 'Escape' || (e.key === 'Enter' && e.target.id === 'p-name')) e.target.blur();
    return;
  }
  const k = e.key, low = k.toLowerCase(), ctrl = e.ctrlKey || e.metaKey, alt = e.altKey, sh = e.shiftKey;
  // le panneau Projet a le clavier (on a cliqué dedans) : F2, Suppr, Entrée, ctrl+A
  if (project.key(e)) return;
  // Premiere : « New Bin » ctrl+B (tableau des raccourcis) ou ctrl+/ (page « Add and delete bins ») — ici, avec la sélection
  if (ctrl && (low === 'b' || k === '/')) { e.preventDefault(); project.askFolder(project.selectedIds()); return; }
  if (ctrl && low === 'i' && !sh) { e.preventDefault(); $('#bin-file').click(); return; }
  if (ctrl && !alt && (low === 'z' || low === 'y')) return;   // commun/undo.js s'en charge (la pile active)
  if (!S.p) return;
  const f = fps();
  const ph = program.frame();
  if (ctrl && alt) {
    if (low === 'm') { e.preventDefault(); if (sh) commit('effacer les marques', (p) => { p.markers = []; }); else { const m = markerAt(ph); if (m) commit('effacer la marque', (p) => { p.markers = p.markers.filter((x) => x.id !== m.id); }); else toast('pas de marque sous la tête de lecture', 1400); } return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); slipKey((k === 'ArrowLeft' ? -1 : 1) * (sh ? 5 : 1)); return; }
    return;
  }
  if (ctrl) {
    if (low === 'k') { e.preventDefault(); cutAtPlayhead(sh); }
    else if (low === 'd') { e.preventDefault(); dissolve(S.sel.size === 1 ? [...S.sel][0] : null); }
    else if (low === 'c') { if (S.sel.size) { e.preventDefault(); copySel(); } }
    else if (low === 'v') { e.preventDefault(); paste(sh); }
    else if (low === 'r') { e.preventDefault(); const c = oneSelected('régler'); if (c) speedModal(c.id); }
    else if (low === 'l') { e.preventDefault(); const c = oneSelected('dissocier'); if (c) detachSound(c.id); }
    else if (low === 'a') { e.preventDefault(); select(sh ? new Set() : new Set(S.p.clips.map((c) => c.id))); }
    else if (low === 'm') { e.preventDefault(); if (sh) gotoMarker(-1); else exportModal(); }
    else if (sh && low === 'i') { e.preventDefault(); S.focus === 'source' ? source.clearIn() : clearRange('in'); }
    else if (sh && low === 'o') { e.preventDefault(); S.focus === 'source' ? source.clearOut() : clearRange('out'); }
    else if (sh && low === 'x') { e.preventDefault(); if (S.focus === 'source') { source.clearIn(); source.clearOut(); } else clearRange('both'); }
    return;
  }
  if (alt) {
    if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); nudge((k === 'ArrowLeft' ? -1 : 1) * (sh ? 5 : 1)); }
    else if (k === ',' || k === '.' || k === ';' || k === ':') { e.preventDefault(); slideKey((k === ',' || k === ';' ? -1 : 1) * (sh ? 5 : 1)); }
    return;
  }
  const mon = S.focus === 'source' && source.item ? source : program;
  if (!sh && TOOL_BY_KEY[low] && !['s', 'm', 'i', 'o', 'j', 'k', 'l', 'd', 'f'].includes(low)) { setTool(TOOL_BY_KEY[low]); return; }
  switch (k) {
    case ' ': e.preventDefault(); S.shuttle = 0; mon.toggle(); break;
    case 'j': case 'J': shuttle(-1); break;
    case 'k': case 'K': shuttle(0); break;
    case 'l': case 'L': shuttle(1); break;
    case 'ArrowLeft': e.preventDefault(); mon.step(sh ? -(mon === source ? Math.round(source.fps) : f) : -1); break;
    case 'ArrowRight': e.preventDefault(); mon.step(sh ? (mon === source ? Math.round(source.fps) : f) : 1); break;
    case 'ArrowUp': e.preventDefault(); stepEdit(-1); break;
    case 'ArrowDown': e.preventDefault(); stepEdit(1); break;
    case 'Home': e.preventDefault(); mon === source ? source.seek(0) : program.seek(0); break;
    case 'End': e.preventDefault(); mon === source ? source.seek(source.duration) : program.seek(program.duration()); break;
    case 'i': if (mon === source) source.markIn(); else setRange('in', ph); break;
    case 'o': if (mon === source) source.markOut(); else setRange('out', ph); break;
    case 'I': if (mon === source) source.seek(source.in); else if (S.p.range && S.p.range.in !== null) program.seekFrame(S.p.range.in); break;
    case 'O': if (mon === source) source.seek(source.out); else if (S.p.range && S.p.range.out !== null) program.seekFrame(S.p.range.out); break;
    case 'm': addMarkerAt(ph); break;
    case 'M': gotoMarker(1); break;
    case 'd': case 'D': select(new Set(S.p.clips.filter((c) => c.start <= ph && M.clipEnd(c) > ph && !lockedTracks().has(c.track)).map((c) => c.id))); break;
    case 'f': case 'F': matchFrame(); break;
    case 'E': if (sh) toggleEnabled(); break;
    case ';': liftExtract(false); break;
    case '\'': liftExtract(true); break;
    case 'Delete': case 'Backspace': e.preventDefault(); del(sh); break;
    case 's': case 'S': S.snap = !S.snap; paintBar(); toast(S.snap ? 'aimant' : 'sans aimant', 1200); break;
    case '+': case '=': timeline.zoom(1.25); break;
    case '-': case '_': timeline.zoom(0.8); break;
    case '\\': timeline.fit(); break;
    case ',': fromSource('insert'); break;
    case '.': fromSource('overwrite'); break;
    case 'Escape': select(new Set()); if (S.tool !== 'select') setTool('select'); break;
    default: return;
  }
});

// ── les boutons ─────────────────────────────────────────────
function wire() {
  $('#b-projects').onclick = projectsModal;
  $('#b-help').onclick = helpModal;
  $('#p-name').addEventListener('change', () => {
    const v = $('#p-name').value.trim();
    if (!S.p) return;
    if (!v) { $('#p-name').value = S.p.name; return; }
    commit('renommer', (p) => { p.name = v.slice(0, 120); });
    applySettings();
  });
  paintTools();
  toolCursors();
  useUndo(U);                                  // les boutons ↶ ↷ et le journal de commun/undo.js
  $('#p-home').onclick = () => { focus('program'); program.seek(0); };
  $('#p-end').onclick = () => { focus('program'); program.seek(program.duration()); };
  $('#p-prev').onclick = () => { focus('program'); program.step(-1); };
  $('#p-next').onclick = () => { focus('program'); program.step(1); };
  $('#p-play').onclick = () => { focus('program'); S.shuttle = 0; program.toggle(); };
  $('#b-export').onclick = exportModal;
  $('#c-reload').onclick = () => { S.conflict = false; S.dirty = false; openProject(S.p.id); };
  $('#c-force').onclick = async () => { await save(true); };
  $('#b-cut').onclick = () => cutAtPlayhead();
  $('#b-xfade').onclick = () => dissolve(S.sel.size === 1 ? [...S.sel][0] : null);
  $('#b-del').onclick = () => del(false);
  $('#b-ripple').onclick = () => del(true);
  $('#b-snap').onclick = () => { S.snap = !S.snap; paintBar(); };
  $('#z-in').onclick = () => timeline.zoom(1.25);
  $('#z-out').onclick = () => timeline.zoom(0.8);
  $('#z-fit').onclick = () => timeline.fit();
  timeline.scroll.addEventListener('scroll', saveView);
  $('#safe').hidden = !S.safe;

  // les panneaux se redimensionnent (commun/split.js) ; la timeline suit sa largeur
  const rerender = () => { if (S.p) timeline.render(); };
  split($('.mtg-top'), [
    { el: $('.bin'), size: 236, min: 170 },
    { el: $('#src'), grow: 1, min: 220 },
    { el: $('#prg'), grow: 1.2, min: 240 },
    { el: $('#insp'), size: 286, min: 230 },
  ], { axis: 'x', key: 'montage-cols', onresize: rerender });
  split($('#mtg'), [
    { el: $('.mtg-top'), grow: 1, min: 220 },
    { el: $('.tlw'), grow: 0.82, min: 190 },
  ], { axis: 'y', key: 'montage-rows', onresize: rerender });
  new ResizeObserver(() => rerender()).observe(timeline.scroll);

  // le clic droit, partout (commun/menu.js)
  contextMenu($('#tl'), timelineMenu);         // (le panneau Projet a le sien : projet.js)
  contextMenu($('#src'), sourceMenu);
  contextMenu($('#prg'), programMenu);
  contextMenu($('#insp'), inspMenu);
  contextMenu($('#seq-tabs'), seqTabMenu);
  // ailleurs (la barre, les outils, les poignées) : les gestes de la séquence, en tête du menu
  // commun de repli (commun/menu.js, pageMenu) — le navigateur n'a jamais le clic droit (Cal, 29/09)
  pageMenu(() => (!S.p ? [{ head: 'Montage' }, { label: 'Nouvelle séquence…', icon: '+', onclick: () => newProjectFlow() }, { label: 'Ouvrir une séquence…', icon: '▤', onclick: projectsModal }]
    : [{ head: `séquence · ${S.p.name}` },
      { label: 'Exporter en MP4…', icon: '↓', key: 'Ctrl+M', disabled: !S.p.clips.length, why: 'rien à exporter : posez des plans sur la timeline', onclick: exportModal },
      { label: 'Nouvelle séquence…', icon: '+', onclick: () => newProjectFlow() },
      { label: 'Ouvrir une séquence…', icon: '▤', onclick: projectsModal },
      { label: 'La voir dans Asset', icon: '▦', onclick: () => { location.href = href('asset/#' + S.p.id); } },
      '-',
      { label: 'Aimant', checked: !!S.snap, onclick: () => $('#b-snap')?.click() },
      { label: 'Les raccourcis', icon: '?', onclick: helpModal }]));

  // moniteurs : le clic donne le clavier
  $('#src').addEventListener('pointerdown', () => focus('source'));
  $('#prg').addEventListener('pointerdown', () => focus('program'));
  $('#s-play').onclick = () => { S.shuttle = 0; source.toggle(); };
  $('#s-prev').onclick = () => source.step(-1);
  $('#s-next').onclick = () => source.step(1);
  $('#s-in').onclick = () => source.markIn();
  $('#s-out').onclick = () => source.markOut();
  $('#s-insert').onclick = () => fromSource('insert');
  $('#s-over').onclick = () => fromSource('overwrite');
  scrubber($('#src-scrub'), (u) => source.seek(u * source.duration));
  scrubber($('#prg-scrub'), (u) => program.seek(u * program.duration()));
  $('#src-screen').addEventListener('dragstart', (e) => {
    const it = source.item;
    if (!it) { e.preventDefault(); return; }
    startDrag(e, it, it.kind === 'image' ? 0 : source.in, it.kind === 'image' ? 0 : source.out);
  });
  $('#src-screen').addEventListener('dragend', () => { S.dragging = null; });

  // le panneau Projet (projet.js) : importer ; un import dans l'onglet d'un dossier s'y range
  $('#bin-up').onclick = () => $('#bin-file').click();
  $('#bin-file').addEventListener('change', async (e) => {
    const got = await uploadMany([...e.target.files]);
    e.target.value = '';
    const tab = project.state.tab;
    if (tab && got.length) await api('asset/move', { method: 'POST', body: { ids: got.map((x) => x.id), folder: tab } }).catch(() => {});
    loadBin();
  });
  dropAnywhere((files) => uploadMany(files));

  // Tout bloc qui attend un asset prend un dépôt (dropZone du socle) : un
  // fichier du disque (bibliothèque, catégorie Upload, via montage) ou une
  // vignette glissée d'une autre page ou du sélecteur (ITEM_MIME). Les pistes
  // ont le leur (timeline.js) : elles posent à l'endroit du dépôt.
  const MEDIA = ['video', 'image', 'audio'];
  const own = (node, from) => {       // ce qui part d'un bloc n'y retombe pas (la liste, les onglets et les icônes du Projet rangent, eux)
    for (const ev of ['dragenter', 'dragover', 'drop']) {
      node.addEventListener(ev, (e) => { if (S.dragging && S.dragging.from === from && !(e.target.closest && e.target.closest('.bin-list, .pan-head'))) e.stopImmediatePropagation(); }, true);
    }
  };
  const bin = $('.bin');
  own(bin, 'bin');
  dropZone(bin, { kinds: MEDIA, via: 'montage', onitems: (items) => {
    for (const it of items) S.items.set(it.id, it);
    loadBin();
    openSource(items[items.length - 1]);
  } });
  own($('#src'), 'source');
  dropZone($('#src'), { kinds: MEDIA, multiple: false, via: 'montage', onitems: ([it]) => { loadBin(); openSource(it); } });
  // sur le programme : au bout de la piste cible (la source y garde ses points d'entrée et de sortie)
  $('#prg').addEventListener('drop', (e) => {
    if (!S.dragging || S.dragging.from !== 'source') return;
    e.preventDefault(); e.stopImmediatePropagation();
    $('#prg').classList.remove('drop-on');
    try { const d = JSON.parse(e.dataTransfer.getData(ITEM_MIME)); appendItem(d.id, d); } catch { /* */ }
  }, true);
  dropZone($('#prg'), { kinds: MEDIA, via: 'montage', onitems: async (items) => {
    for (const it of items) { S.items.set(it.id, it); await appendItem(it.id); }
    loadBin();
  } });
  document.addEventListener('sr:job', (e) => { if (e.detail && e.detail.state === 'done') loadBin(); });
  addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && (!S.p || S.p.id !== id)) openProject(id).catch((er) => toast(er.message)); });
}

function scrubber(bar, go) {
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const a = document.activeElement;
    if (a && a !== document.body && a.blur) a.blur();
    const r = bar.getBoundingClientRect();
    const at = (ev) => go(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)));
    at(e);
    try { bar.setPointerCapture(e.pointerId); } catch { /* */ }
    const mv = (ev) => at(ev);
    const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', mv);
    bar.addEventListener('pointerup', up);
  });
}

// ── le départ ───────────────────────────────────────────────
async function start() {
  wire();
  focus('program');
  try { S.meta = await api('montage/meta'); } catch (e) { toast('le portail ne répond pas : ' + e.message); return; }
  loadBin();
  loadLuts();
  const add = new URLSearchParams(location.search).get('add');
  // les onglets de séquences d'avant : ceux qui existent encore (les autres, jetés, s'en vont)
  const { projects } = await api('montage/projects').catch(() => ({ projects: [] }));
  const known = new Set(projects.map((x) => x.id));
  for (const x of projects) if (x.legacy) known.add(x.legacy);
  S.tabs = S.tabs.filter((x) => known.has(x));
  LS('montage-tabs', S.tabs);
  await ensureItems(S.tabs);
  let id = location.hash.slice(1) || LS('montage-last') || S.tabs[S.tabs.length - 1];
  if (id) { try { await openProject(id); } catch { id = null; } }
  if (!S.p && projects.length && !add) await openProject(projects[0].id).catch(() => {});
  if (add) {
    // envoyé d'un autre outil : au bout de la piste cible de la séquence ouverte ; sans séquence, une à ses réglages
    history.replaceState(null, '', location.pathname + (S.p ? '#' + S.p.id : ''));
    if (S.p) await appendItem(add);
    else { await ensureItems([add]); const it = itemOf(add); if (it) await newSequenceFrom(it); }
  }
  if (!S.p) closeAll();
  paintSeqTabs();
  paintSource();
}

start();

// pour les essais (playwright) et le débogage : l'état, en lecture
window.montage = { S, program, timeline, source, M, commit, placeItem, openProject, flushSave, setTool, lutGL, getLut, loadLuts, paintShelf, focus, select, project, closeSeqTab, undo, redo,
  undoLabels: () => ({ done: U.done.map((e) => e.label), undone: U.undone.map((e) => e.label), name: U.name }) };
