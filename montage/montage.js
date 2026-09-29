// MONTAGE — le banc de montage du portail.
//
// Un montage = un projet sur le serveur (server/tools/montage.py), écrit
// seul après chaque geste : pas de bouton « enregistrer ». Chaque geste
// passe par `commit(nom, p => …)` : une entrée d'annulation (ctrl+Z /
// ctrl+maj+Z), un enregistrement, un redessin. Le chutier est la
// bibliothèque commune (vidéos, images, sons) ; l'export est un travail
// de la file (`montage.export`, voie cpu, ffmpeg) qui range la vidéo
// dans la bibliothèque.
//
// Envoi depuis un autre outil : montage/?add=<id> pose l'objet au bout de
// la piste cible du montage ouvert (le dernier ouvert, sinon un nouveau).

import { mountHeader, api, jobs, el, $, $$, toast, href, uploadFile, dropAnywhere, dropZone, dragItem, ITEM_MIME, fmtDate, stateFr } from '../commun/shell.js';
import * as M from './model.js';
import { Program, Source } from './player.js';
import { Timeline } from './timeline.js';

mountHeader('montage');

const S = {
  p: null, rev: 0, meta: null,
  sel: new Set(), gap: null,
  tool: 'select', snap: true, focus: 'program',
  target: { video: 'V1', audio: 'A1' },
  undo: [], redo: [], pending: null,
  items: new Map(), bin: [], binKind: '', binQ: '',
  dirty: false, saving: null, conflict: false,
  dragging: null, shuttle: 0,
  exportJob: null, exports: [],
};
const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return null; };

// ── le projet en mémoire ────────────────────────────────────
const core = (p) => JSON.stringify({ name: p.name, settings: p.settings, tracks: p.tracks, clips: p.clips });
const fps = () => S.p.settings.fps;
const lockedTracks = (p = S.p) => new Set(p.tracks.filter((t) => t.lock).map((t) => t.id));
const itemOf = (id) => { const it = S.items.get(id); return it && !it.missing ? it : undefined; };

async function ensureItems(ids) {
  const miss = [...new Set(ids)].filter((id) => !S.items.has(id));
  await Promise.all(miss.map(async (id) => {
    try { S.items.set(id, await api('library/' + id)); } catch { S.items.set(id, { id, missing: true, title: '(introuvable)' }); }
  }));
}

function commit(label, fn) {
  if (!S.p) return;
  const before = core(S.p);
  fn(S.p);
  if (core(S.p) === before) return;
  S.undo.push({ label, s: before });
  if (S.undo.length > 300) S.undo.shift();
  S.redo = [];
  changed();
}

// un réglage continu (curseur) : une seule entrée d'annulation pour tout le geste
function beginEdit(label) { if (!S.pending && S.p) S.pending = { label, s: core(S.p) }; }
function endEdit() {
  const pend = S.pending;
  S.pending = null;
  if (!pend || !S.p || core(S.p) === pend.s) return;
  S.undo.push(pend);
  S.redo = [];
  changed({ inspector: false });
}
let liveRaf = 0;
function live() {
  if (liveRaf) return;
  liveRaf = requestAnimationFrame(() => { liveRaf = 0; program.invalidate(); timeline.render(); });
}

function changed({ inspector = true } = {}) {
  const ids = new Set(S.p.clips.map((c) => c.id));
  for (const id of [...S.sel]) if (!ids.has(id)) S.sel.delete(id);
  if (S.gap && !M.gapAt(S.p, S.gap.track, S.gap.s)) S.gap = null;
  program.invalidate();
  timeline.render();
  if (inspector) paintInspector();
  paintBar();
  paintBin();
  scheduleSave();
}

function restore(s) {
  Object.assign(S.p, JSON.parse(s));
  applySettings();
  changed();
}
function undo() {
  const u = S.undo.pop();
  if (!u) return toast('rien à annuler');
  S.redo.push({ label: u.label, s: core(S.p) });
  restore(u.s);
  toast(`annulé : ${u.label}`, 1600);
}
function redo() {
  const r = S.redo.pop();
  if (!r) return toast('rien à rétablir');
  S.undo.push({ label: r.label, s: core(S.p) });
  restore(r.s);
  toast(`rétabli : ${r.label}`, 1600);
}

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
  const body = { name: p.name, settings: { format: p.settings.format, fps: p.settings.fps, still: p.settings.still },
    tracks: p.tracks, clips: p.clips, base_rev: force ? undefined : S.rev };
  paintSave('work');
  S.saving = api(`montage/projects/${p.id}`, { method: 'POST', body });
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
  pill.className = 'pill ' + st;
  pill.lastChild.textContent = S.conflict ? 'non enregistré' : st === 'err' ? 'hors ligne · nouvel essai' : st === 'work' ? 'enregistrement' :
    `enregistré${S.p && S.p.updated ? ' · ' + fmtDate(S.p.updated).split(' ')[1] : ''}`;
  pill.title = msg || 'le montage s’enregistre seul à chaque geste';
}
addEventListener('beforeunload', () => {
  if (!S.dirty || !S.p || S.conflict) return;
  const p = S.p;
  const body = JSON.stringify({ name: p.name, settings: p.settings, tracks: p.tracks, clips: p.clips, base_rev: S.rev });
  try { navigator.sendBeacon(href(`api/montage/projects/${p.id}`), new Blob([body], { type: 'application/json' })); } catch { /* */ }
});

// ── ouvrir, créer ───────────────────────────────────────────
function applySettings() {
  const st = S.p.settings;
  const f = (S.meta.formats.find((x) => x.id === st.format) || { w: 1920, h: 1080 });
  st.width = f.w; st.height = f.h;
  $('#stage').style.setProperty('--ar', String(f.w / f.h));
  $('#fps').textContent = st.fps;
  $('#p-name').value = S.p.name;
  document.title = `${S.p.name} · Montage`;
}

async function openProject(id) {
  if (S.p && S.p.id !== id) await flushSave();
  const p = await api(`montage/projects/${id}`);
  await ensureItems(p.clips.map((c) => c.item));
  program.pause();
  program.clear();
  S.p = p;
  S.rev = p.rev;
  S.undo = []; S.redo = []; S.sel = new Set(); S.gap = null; S.conflict = false; S.dirty = false;
  $('#conflict').hidden = true;
  applySettings();
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

async function createProject(name, settings) {
  const p = await api('montage/projects', { method: 'POST', body: { name, settings } });
  await openProject(p.id);
  return p;
}

function modal(title, body, foot, { cls = '', onclose } = {}) {
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc, true); if (onclose) onclose(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const scrim = el('div', { class: 'scrim', onpointerdown: (e) => { if (e.target === scrim) close(); } },
    el('div', { class: 'modal ' + cls, role: 'dialog', 'aria-label': title },
      el('div', { class: 'modal-head' }, el('span', { class: 't' }, title), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', onclick: close, title: 'fermer · Échap' }, 'Fermer')),
      el('div', { class: 'modal-body' }, body),
      foot ? el('div', { class: 'modal-foot' }, foot(close)) : null));
  document.addEventListener('keydown', esc, true);
  document.body.append(scrim);
  return close;
}

function askName(title, value = '', action = 'Créer') {
  return new Promise((resolve) => {
    let done = false;
    const inp = el('input', { class: 'fld', value, placeholder: 'le nom du montage', maxlength: 120 });
    const ok = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } done = true; close(); resolve(v); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    const close = modal(title, el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'nom'), inp),
      (cl) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', onclick: cl }, 'Annuler'), el('button', { class: 'tb go', onclick: ok }, action)],
      { onclose: () => { if (!done) resolve(null); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}

async function newProjectFlow() {
  const d = new Date();
  const name = await askName('Nouveau montage', `Montage du ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`);
  if (name) await createProject(name, S.p ? { format: S.p.settings.format, fps: S.p.settings.fps } : undefined);
  return name;
}

async function projectsModal() {
  let list = [];
  const box = el('div', { class: 'plist' });
  const count = el('span', { class: 'lbl' });
  const paint = () => {
    count.textContent = `${list.length} montage${list.length > 1 ? 's' : ''}`;
    box.replaceChildren(...(list.length ? list.map(row) : [el('p', {}, 'Aucun montage encore. Créez-en un : il s’enregistre seul, à chaque geste.')]));
  };
  const row = (pr) => {
    const name = el('b', {}, pr.name);
    let armed = false;
    const del = el('button', { class: 'tb ghost sm', title: 'mettre à la corbeille des montages', onclick: async () => {
      if (!armed) { armed = true; del.textContent = 'Confirmer'; setTimeout(() => { armed = false; del.textContent = 'Supprimer'; }, 3000); return; }
      await api(`montage/projects/${pr.id}/delete`, { method: 'POST' });
      list = list.filter((x) => x.id !== pr.id);
      if (S.p && S.p.id === pr.id) { S.p = null; program.clear(); location.hash = ''; }
      paint();
    } }, 'Supprimer');
    return el('div', { class: 'prow' + (S.p && S.p.id === pr.id ? ' on' : '') },
      el('span', { class: 'th', style: pr.thumb_url ? { backgroundImage: `url("${href(pr.thumb_url)}")` } : null }),
      el('div', { style: { minWidth: 0 } }, name,
        el('small', {}, `${M.short(pr.duration)} · ${pr.clips} plan${pr.clips > 1 ? 's' : ''} · ${pr.format} · ${pr.fps} i/s · ${fmtDate(pr.updated)}`)),
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
          list.unshift(r); paint(); toast(`« ${r.name} » créé`);
        } }, 'Dupliquer'),
        del));
  };
  const close = modal('Les montages', el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, count, box),
    (cl) => [el('span', { class: 'sp' }), el('button', { class: 'tb go', onclick: async () => { const n = await newProjectFlow(); if (n) cl(); } }, 'Nouveau montage')],
    { cls: 'lg', onclose: () => { if (!S.p) paintEmptyState(); } });
  try { ({ projects: list } = await api('montage/projects')); } catch (e) { box.replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
  paint();
}

function paintEmptyState() {
  $('#p-name').value = '';
  $('#insp').replaceChildren(el('div', { class: 'card proj' },
    el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Aucun montage ouvert')),
    el('p', { class: 'note' }, 'Ouvrez un montage ou créez-en un.'),
    el('div', { class: 'row' }, el('button', { class: 'tb ghost', onclick: projectsModal }, 'Les montages'),
      el('button', { class: 'tb ghost', onclick: newProjectFlow }, 'Nouveau'))));
}

// ── le chutier ──────────────────────────────────────────────
const BIN_KINDS = [['', 'Tout'], ['video', 'Vidéos'], ['image', 'Images'], ['audio', 'Sons']];
let binT = 0;
async function loadBin() {
  const kinds = S.binKind || 'video,image,audio';
  try {
    const r = await api(`library?kind=${kinds}&q=${encodeURIComponent(S.binQ)}&limit=400`);
    S.bin = r.items;
    for (const it of r.items) S.items.set(it.id, it);
  } catch (e) { S.bin = []; $('#bin-list').replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
  paintBin();
}

function itemMeta(it) {
  const bits = [];
  if (it.duration) bits.push(M.short(it.duration));
  if (it.width && it.height) bits.push(`${it.width}×${it.height}`);
  if (it.fps) bits.push(`${Math.round(it.fps * 100) / 100} i/s`);
  if (it.kind === 'video') bits.push(it.audio ? 'son' : 'muet');
  if (it.kind === 'image') bits.push('image');
  if (it.kind === 'audio') bits.push('son');
  return bits.join(' · ');
}

function paintBin() {
  const box = $('#bin-list');
  $('#bin-n').textContent = S.bin.length;
  const used = new Set(S.p ? S.p.clips.map((c) => c.item) : []);
  const cur = source.item && source.item.id;
  if (!S.bin.length) {
    box.replaceChildren(el('p', { class: 'lbl' }, S.binQ ? 'rien ne correspond' : 'la bibliothèque est vide : déposez des vidéos, images ou sons (bouton Déposer, ou glissez-les sur la page)'));
    return;
  }
  box.replaceChildren(...S.bin.map((it) => {
    const row = el('div', { class: 'bi' + (it.id === cur ? ' on' : ''), 'data-id': it.id, title: `${it.title}\n${itemMeta(it)}\ndouble-clic : dans la source · glisser : sur la timeline, la source, une autre page`,
      ondblclick: () => openSource(it), onclick: () => openSource(it) },
      el('span', { class: 'th' + (it.kind === 'audio' ? ' audio' : ''), style: it.thumb_url ? { backgroundImage: `url("${href(it.thumb_url)}")` } : null }),
      el('span', { class: 'tx' }, el('b', {}, it.title || it.id), el('small', {}, itemMeta(it))),
      used.has(it.id) ? el('span', { class: 'used', title: 'déjà dans ce montage' }) : null);
    // la vignette se glisse comme partout dans le portail (dragItem, ITEM_MIME) ;
    // on retient en plus sa durée pour l'ombre posée sur la timeline
    dragItem(row, it);
    row.addEventListener('dragstart', () => markDrag(it, 0, it.duration || 0, 'bin'));
    row.addEventListener('dragend', () => { S.dragging = null; });
    return row;
  }));
}

// ce qu'on glisse depuis cette page : sa longueur sur la timeline, d'où il part
function markDrag(it, tin, tout, from) {
  const frames = it.kind === 'image' ? Math.round(S.p ? S.p.settings.still * fps() : 125)
    : Math.max(1, Math.round(((tout || it.duration || 5) - (tin || 0)) * (S.p ? fps() : 25)));
  S.dragging = { id: it.id, kind: it.kind, frames, from };
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
    in: tin, src_dur: it.kind === 'image' ? 0 : (it.duration || 0), vol: 1, fade_in: 0, fade_out: 0, xfade: 0,
    audio: it.kind === 'video' && !!it.audio, grade: { ...M.NEUTRAL } };
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
  if (!playing) saveView();
}

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
  select,
  focus,
  seekFrame: (f) => program.seekFrame(f),
  cut,
  trackFor: (tid, kind) => trackFor(tid, kind),
  placeItem,
  dropFiles: async (files, tid, frame, mode) => {
    let at = frame;
    for (const it of await uploadMany(files)) {
      const c = await placeItem({ id: it.id, in: 0, out: it.duration || 0 }, tid, at, mode);
      if (c) at = M.clipEnd(c);
    }
  },
  openClipInSource: (id) => {
    const c = M.byId(S.p, id);
    const it = c && itemOf(c.item);
    if (it) openSource(it, { in: c.in || 0, out: (c.in || 0) + c.dur / fps() });
  },
  toggleTrack: (tid, k, label) => commit(label, (p) => { const t = p.tracks.find((x) => x.id === tid); t[k] = !t[k]; }),
  setTarget: (t) => { S.target[t.kind] = t.id; timeline.render(); },
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

function cut(f, onlyId) {
  commit('couper', (p) => {
    const locked = lockedTracks(p);
    const ids = onlyId ? [onlyId] : p.clips.filter((c) => c.start < f && M.clipEnd(c) > f).map((c) => c.id);
    for (const id of ids) { const c = M.byId(p, id); if (c && !locked.has(c.track)) M.cutAt(p, id, f); }
  });
}

function cutAtPlayhead() {
  const f = program.frame();
  const ids = [...S.sel].filter((id) => { const c = M.byId(S.p, id); return c && c.start < f && M.clipEnd(c) > f; });
  if (S.sel.size && !ids.length) return toast('la tête de lecture ne passe pas dans le plan choisi');
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
  commit(ripple ? 'supprimer avec raccord' : 'supprimer', (p) => (ripple ? M.rippleDelete(p, ids) : M.deleteClips(p, ids)));
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
  if (!c || c.kind !== 'video' || !c.audio) return;
  const tid = S.target.audio;
  if (lockedTracks().has(tid)) return toast(`la piste ${tid} est verrouillée`);
  const a = { ...c, id: M.newClipId(), track: tid, grade: { ...M.NEUTRAL }, audio: true };
  commit('détacher le son', (p) => { M.byId(p, id).audio = false; M.placeClip(p, a, 'overwrite'); });
  toast(`le son est sur ${tid} : il se déplace et se coupe à part`);
}

function stepEdit(dir) {
  const pts = M.editPoints(S.p);
  const f = program.frame();
  const next = dir > 0 ? pts.find((x) => x > f) : [...pts].reverse().find((x) => x < f);
  if (next !== undefined) program.seekFrame(next);
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
      el('p', { class: 'note' }, 'Glissez-les ensemble sur la timeline ; maj ou ctrl + clic pour en ajouter ou en retirer.'),
      el('div', { class: 'row' }, el('button', { class: 'tb ghost sm', onclick: () => del(false) }, 'Supprimer'),
        el('button', { class: 'tb ghost sm', onclick: () => del(true) }, 'Avec raccord'))));
  } else if (S.gap) {
    cards.push(el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('span', { class: 't' }, `Vide · ${S.gap.track}`)),
      el('dl', { class: 'props' }, el('dt', {}, 'de'), el('dd', {}, M.tc(S.gap.s, f)), el('dt', {}, 'à'), el('dd', {}, M.tc(S.gap.e, f)),
        el('dt', {}, 'durée'), el('dd', {}, M.short((S.gap.e - S.gap.s) / f))),
      el('button', { class: 'tb ghost sm', onclick: () => del(true), title: 'Suppr' }, 'Refermer le vide')));
  }
  if (!S.sel.size) cards.push(...projectCards(f));
  box.replaceChildren(...cards);
}

function clipCards(c, f) {
  const it = S.items.get(c.item) || {};
  const track = S.p.tracks.find((t) => t.id === c.track);
  const locked = track.lock;
  const set = (fn) => (v) => { const x = M.byId(S.p, c.id); if (x) fn(x, v); };
  const cards = [];
  const props = [['piste', c.track + (locked ? ' · verrouillée' : '')], ['début', M.tc(c.start, f)], ['fin', M.tc(M.clipEnd(c), f)], ['durée', `${M.tc(c.dur, f)}`]];
  if (c.kind !== 'image') props.push(['entrée source', M.short(c.in || 0) + (c.src_dur ? ` / ${M.short(c.src_dur)}` : '')]);
  const head = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Plan · ', el('b', {}, c.title || it.title || c.item))),
    el('dl', { class: 'props' }, ...props.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])));
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
    el('button', { class: 'tb ghost sm', onclick: () => timeline.app.openClipInSource(c.id), disabled: it.missing || null }, 'Dans la source'));
  if (c.kind === 'video' && track.kind === 'video') {
    acts.append(c.audio ? el('button', { class: 'tb ghost sm', disabled: locked || null, title: `mettre le son sur ${S.target.audio} pour le déplacer à part`, onclick: () => detachSound(c.id) }, 'Détacher le son')
      : el('span', { class: 'lbl' }, it.audio ? 'son détaché' : 'vidéo sans son'));
  }
  head.append(acts);
  cards.push(head);

  // transitions
  const prev = prevClip(S.p, c);
  const mode = c.xfade > 0 && prev ? 'x' : c.fade_in > 0 ? 'f' : 'c';
  const isV1 = track.kind === 'video' && track.id === S.p.tracks.filter((t) => t.kind === 'video').slice(-1)[0].id;
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
      if (!audibleTracksNow().has(track.id)) snd.append(el('p', { class: 'why' }, `la piste ${track.id} ne s’entend pas (muette, ou un autre solo)`));
    } else snd.append(el('p', { class: 'note' }, it.audio ? `son détaché : il est sur une piste son` : 'cette vidéo n’a pas de son'));
    cards.push(snd);
  }

  // l'étalonnage
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
  }
  return cards;
}

function audibleTracksNow() { return M.audibleTracks(S.p); }

function projectCards(f) {
  const st = S.p.settings;
  const cards = [];
  const fmtOpts = el('div', { class: 'opts tight' }, ...S.meta.formats.map((x) => el('button', { class: 'opt' + (x.id === st.format ? ' on' : ''),
    onclick: () => { commit('format', (p) => { p.settings.format = x.id; }); applySettings(); paintInspector(); } }, x.label, el('small', {}, `${x.w}×${x.h}`))));
  const fpsOpts = el('div', { class: 'opts tight' }, ...S.meta.fps.map((x) => el('button', { class: 'opt' + (x === st.fps ? ' on' : ''),
    onclick: () => {
      if (x === st.fps) return;
      const t = program.t;
      commit(`cadence ${x} i/s`, (p) => M.convertFps(p, x));
      applySettings(); timeline.render(); program.seek(t); paintInspector();
    } }, `${x} i/s`)));
  const dur = M.projectEnd(S.p) / f;
  cards.push(el('div', { class: 'card proj' },
    el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Projet · ', el('b', {}, S.p.name))),
    el('dl', { class: 'props' }, el('dt', {}, 'durée'), el('dd', {}, M.tc(M.projectEnd(S.p), f)), el('dt', {}, 'plans'), el('dd', {}, String(S.p.clips.length)),
      el('dt', {}, 'sortie'), el('dd', {}, `${st.width}×${st.height} · ${st.fps} i/s`)),
    el('span', { class: 'lbl' }, 'format'), fmtOpts,
    el('span', { class: 'lbl' }, 'cadence'), fpsOpts,
    slider({ label: 'image fixe', min: 0.5, max: 20, step: 0.5, value: st.still, fmt: (v) => M.short(v), title: 'durée d’une image posée sur la timeline (réglable ensuite, plan par plan)',
      apply: (v) => { S.p.settings.still = v; } }),
    el('p', { class: 'note' }, 'changer de cadence recale chaque bord sur la nouvelle grille ; deux plans collés le restent.')));
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
  const hidden = S.p.tracks.filter((t) => t.hide).map((t) => t.id);
  const hear = M.audibleTracks(S.p);
  const deaf = S.p.tracks.filter((t) => !hear.has(t.id) && S.p.clips.some((c) => c.track === t.id && (t.kind === 'audio' || c.audio))).map((t) => t.id);
  const missing = S.p.clips.filter((c) => !itemOf(c.item));
  const q = el('div', { class: 'opts' });
  const paintQ = () => q.replaceChildren(
    el('button', { class: 'opt' + (!draft ? ' on' : ''), onclick: () => { draft = false; paintQ(); } }, 'finale', el('small', {}, 'x264 medium · crf 18')),
    el('button', { class: 'opt' + (draft ? ' on' : ''), onclick: () => { draft = true; paintQ(); } }, 'brouillon', el('small', {}, 'x264 veryfast · plus rapide')));
  paintQ();
  const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    el('dl', { class: 'kv' },
      el('dt', {}, 'montage'), el('dd', {}, S.p.name),
      el('dt', {}, 'format'), el('dd', {}, `${fmtx ? fmtx.label : st.format} · ${st.width}×${st.height}`),
      el('dt', {}, 'cadence'), el('dd', {}, `${f} i/s`),
      el('dt', {}, 'durée'), el('dd', { class: 'big' }, M.tc(M.projectEnd(S.p), f)),
      el('dt', {}, 'plans'), el('dd', {}, String(S.p.clips.length)),
      el('dt', {}, 'fichier'), el('dd', {}, 'MP4 · H.264 + AAC 48 kHz stéréo')),
    el('span', { class: 'lbl' }, 'qualité'), q,
    el('p', {}, 'L’export rend ce que vous voyez et entendez : ' + (hidden.length || deaf.length
      ? `${hidden.length ? `piste${hidden.length > 1 ? 's' : ''} masquée${hidden.length > 1 ? 's' : ''} ${hidden.join(', ')}` : ''}${hidden.length && deaf.length ? ' et ' : ''}${deaf.length ? `${deaf.join(', ')} qu’on n’entend pas` : ''} n’y seront pas.`
      : 'toutes les pistes y sont.')),
    missing.length ? el('p', { class: 'warn' }, `${missing.length} plan(s) pointent vers un objet introuvable : l’export sera refusé`) : null);
  modal('Exporter', body, (close) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', onclick: close }, 'Annuler'),
    el('button', { class: 'tb go', onclick: async () => { close(); await startExport(draft); } }, 'Lancer l’export')]);
}

async function startExport(draft) {
  await flushSave();
  if (S.conflict) return toast('réglez d’abord le conflit d’enregistrement');
  try {
    const j = await jobs.submit('montage.export', { project: S.p.id, draft }, { title: `Montage · ${S.p.name}`, tool: 'montage' });
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
  p.className = 'pill work';
  p.lastChild.textContent = j.state === 'queued' ? 'export en file' : `export ${j.progress != null ? Math.round(j.progress * 100) : 0} %`;
  p.title = j.message || '';
}

async function loadExports() {
  if (!S.p) return;
  try {
    const r = await api('library?kind=video&tool=montage&limit=200');
    S.exports = r.items.filter((it) => it.params && it.params.montage === S.p.id);
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

// ── la barre ────────────────────────────────────────────────
function paintBar() {
  if (!S.p) return;
  const f = fps();
  $('#tl-n').textContent = S.p.clips.length;
  $('#tl-dur').textContent = `· ${M.tc(M.projectEnd(S.p), f)}`;
  $('#prg-dur').textContent = `durée ${M.short(M.projectEnd(S.p) / f)}`;
  $('#b-undo').disabled = !S.undo.length;
  $('#b-undo').title = S.undo.length ? `annuler : ${S.undo[S.undo.length - 1].label} · ctrl+Z` : 'rien à annuler';
  $('#b-redo').disabled = !S.redo.length;
  $('#b-redo').title = S.redo.length ? `rétablir : ${S.redo[S.redo.length - 1].label} · ctrl+maj+Z` : 'rien à rétablir';
  const hasSel = S.sel.size > 0;
  $('#b-del').disabled = !hasSel && !S.gap;
  $('#b-ripple').disabled = !hasSel && !S.gap;
  $('#b-del').title = hasSel || S.gap ? 'supprimer · Suppr' : 'choisissez d’abord un plan (ou un vide)';
  const exp = $('#b-export');
  exp.disabled = !S.p.clips.length;
  exp.title = S.p.clips.length ? 'rendre le montage en MP4 (H.264 + AAC) dans la bibliothèque' : 'rien à exporter : posez des plans sur la timeline';
  $('#prg-empty').hidden = !!S.p.clips.length;
  $('#mtg').classList.toggle('blade', S.tool === 'blade');
  $('#t-select').classList.toggle('on', S.tool === 'select');
  $('#t-blade').classList.toggle('on', S.tool === 'blade');
  const sw = $('#b-snap');
  sw.classList.toggle('on', S.snap);
  sw.setAttribute('aria-pressed', String(S.snap));
}

function setTool(t) { S.tool = t; paintBar(); toast(t === 'blade' ? 'lame : cliquez un plan pour le couper (maj : toutes les pistes)' : 'sélection', 1400); }

function helpModal() {
  const K = [
    ['espace', 'lecture / pause du moniteur actif (cliquez-le : source ou programme)'],
    ['J · K · L', 'arrière, arrêt, avant (répéter : plus vite)'],
    ['← →', 'image par image · maj : une seconde'],
    ['↑ ↓', 'coupe précédente, suivante'],
    ['Origine · Fin', 'début, fin du montage'],
    ['I · O', 'entrée, sortie de la source'],
    ['virgule · point', 'insérer, écraser la source à la tête de lecture'],
    ['V · C (ou B)', 'sélection · lame (maj + clic : toutes les pistes)'],
    ['ctrl + K', 'couper à la tête de lecture'],
    ['ctrl + D', 'fondu enchaîné d’une seconde sur le plan choisi'],
    ['Suppr · maj + Suppr', 'supprimer · supprimer et refermer le vide'],
    ['ctrl + Z · ctrl + maj + Z', 'annuler · rétablir'],
    ['S', 'aimant'],
    ['alt + molette · + · −', 'zoom de la timeline · \\ : tout le montage'],
    ['glisser + ctrl', 'insérer (pousse la suite) au lieu d’écraser'],
    ['double-clic sur un plan', 'le rouvrir dans la source'],
  ];
  modal('Raccourcis', el('dl', { class: 'keys' }, ...K.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])));
}

// ── le clavier ──────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if ($('.scrim')) return;           // une boîte ouverte garde le clavier
  // espace sur un bouton ou un curseur qui a gardé le focus : c'est la lecture, pas un clic
  if (e.key === ' ' && e.target.matches && e.target.matches('button, input[type=range]')) e.target.blur();
  else if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) {
    if (e.key === 'Escape' || (e.key === 'Enter' && e.target.id === 'p-name')) e.target.blur();
    return;
  }
  if (!S.p) return;
  const k = e.key, low = k.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl) {
    if (low === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (low === 'y') { e.preventDefault(); redo(); }
    else if (low === 'k') { e.preventDefault(); cutAtPlayhead(); }
    else if (low === 'd') { e.preventDefault(); dissolve(S.sel.size === 1 ? [...S.sel][0] : null); }
    return;
  }
  if (e.altKey) return;
  const mon = S.focus === 'source' && source.item ? source : program;
  const f = fps();
  switch (k) {
    case ' ': e.preventDefault(); S.shuttle = 0; mon.toggle(); break;
    case 'j': case 'J': shuttle(-1); break;
    case 'k': case 'K': shuttle(0); break;
    case 'l': case 'L': shuttle(1); break;
    case 'ArrowLeft': e.preventDefault(); mon.step(e.shiftKey ? -(mon === source ? Math.round(source.fps) : f) : -1); break;
    case 'ArrowRight': e.preventDefault(); mon.step(e.shiftKey ? (mon === source ? Math.round(source.fps) : f) : 1); break;
    case 'ArrowUp': e.preventDefault(); stepEdit(-1); break;
    case 'ArrowDown': e.preventDefault(); stepEdit(1); break;
    case 'Home': e.preventDefault(); mon === source ? source.seek(0) : program.seek(0); break;
    case 'End': e.preventDefault(); mon === source ? source.seek(source.duration) : program.seek(program.duration()); break;
    case 'i': case 'I': source.markIn(); break;
    case 'o': case 'O': source.markOut(); break;
    case 'v': case 'V': setTool('select'); break;
    case 'c': case 'C': case 'b': case 'B': setTool(S.tool === 'blade' ? 'select' : 'blade'); break;
    case 'Delete': case 'Backspace': e.preventDefault(); del(e.shiftKey); break;
    case 's': case 'S': S.snap = !S.snap; paintBar(); toast(S.snap ? 'aimant' : 'sans aimant', 1200); break;
    case '+': case '=': timeline.zoom(1.25); break;
    case '-': case '_': timeline.zoom(0.8); break;
    case '\\': timeline.fit(); break;
    case ',': fromSource('insert'); break;
    case '.': fromSource('overwrite'); break;
    case 'Escape': select(new Set()); if (S.tool === 'blade') setTool('select'); break;
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
  $('#t-select').onclick = () => setTool('select');
  $('#t-blade').onclick = () => setTool('blade');
  $('#b-undo').onclick = undo;
  $('#b-redo').onclick = redo;
  $('#p-home').onclick = () => { focus('program'); program.seek(0); };
  $('#p-end').onclick = () => { focus('program'); program.seek(program.duration()); };
  $('#p-prev').onclick = () => { focus('program'); program.step(-1); };
  $('#p-next').onclick = () => { focus('program'); program.step(1); };
  $('#p-play').onclick = () => { focus('program'); S.shuttle = 0; program.toggle(); };
  $('#b-export').onclick = exportModal;
  $('#c-reload').onclick = () => { S.conflict = false; S.dirty = false; openProject(S.p.id); };
  $('#c-force').onclick = async () => { await save(true); };
  $('#b-cut').onclick = cutAtPlayhead;
  $('#b-xfade').onclick = () => dissolve(S.sel.size === 1 ? [...S.sel][0] : null);
  $('#b-del').onclick = () => del(false);
  $('#b-ripple').onclick = () => del(true);
  $('#b-snap').onclick = () => { S.snap = !S.snap; paintBar(); };
  $('#z-in').onclick = () => timeline.zoom(1.25);
  $('#z-out').onclick = () => timeline.zoom(0.8);
  $('#z-fit').onclick = () => timeline.fit();
  timeline.scroll.addEventListener('scroll', saveView);

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

  // chutier
  $('#bin-kinds').replaceChildren(...BIN_KINDS.map(([k, lab]) => el('button', { class: 'tb' + (k === S.binKind ? ' on' : ''), onclick: (e) => {
    S.binKind = k; $$('#bin-kinds .tb').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); loadBin();
  } }, lab)));
  $('#bin-q').addEventListener('input', (e) => { S.binQ = e.target.value; clearTimeout(binT); binT = setTimeout(loadBin, 220); });
  $('#bin-up').onclick = () => $('#bin-file').click();
  $('#bin-file').addEventListener('change', async (e) => { await uploadMany([...e.target.files]); e.target.value = ''; });
  dropAnywhere((files) => uploadMany(files));

  // Tout bloc qui attend un asset prend un dépôt (dropZone du socle) : un
  // fichier du disque (bibliothèque, catégorie Upload, via montage) ou une
  // vignette glissée d'une autre page ou du sélecteur (ITEM_MIME). Les pistes
  // ont le leur (timeline.js) : elles posent à l'endroit du dépôt.
  const MEDIA = ['video', 'image', 'audio'];
  const own = (node, from) => {       // ce qui part d'un bloc n'y retombe pas
    for (const ev of ['dragenter', 'dragover', 'drop']) {
      node.addEventListener(ev, (e) => { if (S.dragging && S.dragging.from === from) e.stopImmediatePropagation(); }, true);
    }
  };
  const bin = $('.bin');
  own(bin, 'bin');
  dropZone(bin, { kinds: MEDIA, via: 'montage', onitems: (items) => {
    for (const it of items) S.items.set(it.id, it);
    if (S.binQ || (S.binKind && !items.every((i) => i.kind === S.binKind))) {    // qu'on le voie dans la liste
      S.binQ = ''; $('#bin-q').value = ''; S.binKind = '';
      $$('#bin-kinds .tb').forEach((b, i) => b.classList.toggle('on', i === 0));
    }
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
  addEventListener('resize', () => { if (S.p) timeline.render(); });
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
  const add = new URLSearchParams(location.search).get('add');
  let id = location.hash.slice(1) || LS('montage-last');
  if (id) { try { await openProject(id); } catch { id = null; } }
  if (!S.p && add) {
    const d = new Date();
    await createProject(`Montage du ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`);
  }
  if (!S.p) {
    const { projects } = await api('montage/projects').catch(() => ({ projects: [] }));
    if (projects.length) await openProject(projects[0].id);
    else { paintEmptyState(); await newProjectFlow(); }
  }
  if (add && S.p) {
    history.replaceState(null, '', location.pathname + '#' + S.p.id);
    await appendItem(add);
  }
  paintSource();
}

start();

// pour les essais (playwright) et le débogage : l'état, en lecture
window.montage = { S, program, timeline, source, M, commit, placeItem, openProject, flushSave };
