// MONTAGE — le banc de montage du portail.
//
// Un montage = un projet sur le serveur (server/tools/montage.py), écrit
// seul après chaque geste : pas de bouton « enregistrer ». Chaque geste
// passe par `commit(nom, p => …)` : une entrée d'annulation (ctrl+Z /
// ctrl+maj+Z), un enregistrement, un redessin. Le chutier (le Projet) tient
// ce que le montage a pris dans la bibliothèque commune (vidéos, images,
// sons, séquences), dans ses propres dossiers (projet.js) ; l'export est un travail de la file (`montage.export`, voie cpu,
// ffmpeg) qui range la vidéo dans la bibliothèque.
//
// Les outils, les raccourcis et les menus du clic droit reprennent ceux de
// Premiere Pro (documentation d'Adobe ; la carte des menus et les sources :
// docs/etudes/montage.md). Les menus passent par commun/menu.js, les
// panneaux se redimensionnent par commun/split.js.
//
// Envoi depuis un autre outil : montage/?add=<id> pose l'objet au bout de
// la piste cible du montage ouvert (le dernier ouvert, sinon un nouveau).

import { mountHeader, api, jobs, el, toast, href, uploadFile, dropAnywhere, dropZone, dragItem, ITEM_MIME, fmtDate, stateFr, dock, declareZone,
  session, espace, avecEspace, espaceDocument, surEspace } from '../commun/shell.js';
// $ et $$ cherchent aussi dans les fenêtres détachées (un panneau sur un 2ᵉ écran : docs/etudes/fenetres.md)
import { fenetres, $, $$, winOf } from '../commun/fenetre.js';
import { menu, contextMenu, pageMenu } from '../commun/menu.js';
import { split } from '../commun/split.js';
import * as M from './model.js';
import { Program, Source, tempGains, gradeCss } from './player.js';
import { Timeline } from './timeline.js';
import { getLut, lutGL } from './lut.js';
import { mountProject, MULTI_MIME } from './projet.js';
import { mountEffects, bindEffectDrops, fxOfDesc, lutFamilies } from './effets.js';
import { bindTrackDrag } from './pistes.js';
import { createUndo } from '../commun/undo.js';
import { createElements } from './elements.js';
import { pics, dessiner } from '../commun/onde.js';   // éléments : la pastille « vN+1 » (30/09)
import { REGLE as MOLETTE, AIDE as MOLETTE_AIDE } from '../commun/molette.js';

mountHeader('montage');
// Les panneaux du haut se détachent dans une fenêtre (un 2ᵉ écran) : commun/fenetre.js
// y déplace le nœud ; le code, l'état, l'annulation et le son restent ici.
const F = fenetres('montage', { onchange: () => relayout() });

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
  fxDrag: null,                  // l'effet glissé depuis le panneau Effets
  selTrack: null,                // la piste choisie (id), ou un groupe ('g:<id>')
  fxSel: new Set(),              // les effets choisis dans l'inspecteur
  fxClip: LS('montage-fx-clipboard'), lastCopy: null, fxFocus: false,
};

// ── le projet en mémoire ────────────────────────────────────
const core = (p) => JSON.stringify({ name: p.name, settings: p.settings, tracks: p.tracks, groups: p.groups || [], clips: p.clips, markers: p.markers, range: p.range });
const fps = () => S.p.settings.fps;
const lockedTracks = (p = S.p) => M.lockedSet(p);
const itemOf = (id) => { const it = S.items.get(id); return it && !it.missing ? it : undefined; };
const body = (p, extra = {}) => ({ name: p.name, settings: { format: p.settings.format, fps: p.settings.fps, still: p.settings.still, width: p.settings.width, height: p.settings.height },
  tracks: p.tracks, groups: p.groups || [], clips: p.clips, markers: p.markers, range: p.range, ...extra });

async function ensureItems(ids) {
  const miss = [...new Set(ids)].filter((id) => id && !S.items.has(id));
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
  EL.changed();                                // éléments : un objet de plus ou de moins, les pastilles relues
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
  S.saving = api(`montage/projects/${p.id}`, { method: 'POST', body: body(p, { base_rev: force ? undefined : S.rev }), ...espaceDe(p) });
  try {
    const r = await S.saving;
    if (S.p && S.p.id === p.id) { S.rev = r.rev; S.p.updated = r.updated; }
    S.conflict = false;
    $('#conflict').hidden = true;
    if (r.warnings && r.warnings.length) toast('plans qui se chevauchent : ' + r.warnings.join(' ; '));
  } catch (e) {
    S.dirty = true;
    // 409 d'un objet d'un autre Workspace (server/tools/elements.py, check_space) : la phrase, et le geste à défaire
    if (e.status === 409 && /Workspace/.test(e.message || '')) { S.saving = null; paintSave('err', e.message); foreignRefused(e.message); return; }
    if (e.status === 409) { S.conflict = true; $('#conflict').hidden = false; }
    else { paintSave('err', e.message); clearTimeout(saveT); saveT = setTimeout(save, 4000); S.saving = null; return; }
  }
  S.saving = null;
  paintSave();
}
// Enregistrer une séquence qui pose un objet (ou une LUT) d'un autre Workspace : refusé, la phrase
// du serveur dit lequel, d'où, et qu'il faut le rapatrier. Rien n'est perdu : la séquence garde son
// état d'avant sur le serveur ; ici, on défait le geste, ou on va le rapatrier dans Asset.
// (L'étape 5, « Rapatrier » — POST /api/espaces/<B>/rapatrier —, n'est pas encore là : Asset y mène.)
let foreignOpen = false;
function foreignRefused(msg) {
  if (foreignOpen) return;
  foreignOpen = true;
  const id = (msg.match(/\(([a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4})/) || [])[1];
  const lut = /^la LUT|une LUT/.test(msg);
  modal('Pas de ce Workspace', el('div', { class: 'newfolder' }, el('p', {}, msg),
    el('p', { class: 'note' }, 'La séquence n’est pas enregistrée tant qu’elle le pose ; sur le serveur, elle garde son état d’avant.')),
  (close) => [el('span', { class: 'sp' }),
    el('button', { class: 'tb ghost', onclick: () => { close(); undo(); } }, 'Défaire le geste'),
    id && !lut ? el('button', { class: 'tb go', onclick: () => { close(); window.open(href('asset/#' + id), '_blank', 'noopener'); } }, 'Le voir dans Asset ↗') : null],
  { cls: 'center', onclose: () => { foreignOpen = false; } });
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
// Le Workspace (commun/shell.js, docs/etudes/equipes_espaces.md § 4.3) : une séquence ouverte reste
// dans le sien — ses lectures et ses écritures le disent, même si l'onglet change de Workspace.
// Le sien : son `space`, sinon celui où on l'a ouverte (une séquence d'avant les Workspaces) ;
// chaque onglet de séquence le retient (tabEsp, posé par openProject) : la rouvrir la relit là.
const tabEsp = new Map();
const espaceDeTab = (id) => (tabEsp.get(id) ? { espace: tabEsp.get(id) } : {});
const espaceDe = (p) => (p ? espaceDeTab(p.id) : {});
addEventListener('beforeunload', () => {
  if (!S.dirty || !S.p || S.conflict) return;
  const p = S.p;
  // sendBeacon n'a pas d'en-tête : le Workspace passe par ?e= (celui de la séquence, sinon de l'onglet)
  const u = new URL(avecEspace(href(`api/montage/projects/${p.id}`)), location.href);
  if (tabEsp.get(p.id)) u.searchParams.set('e', tabEsp.get(p.id));
  try { navigator.sendBeacon(u.href, new Blob([JSON.stringify(body(p, { base_rev: S.rev }))], { type: 'application/json' })); } catch { /* */ }
});
// changer de Workspace (l'en-tête) ne recharge pas le Montage : les séquences ouvertes restent
// ouvertes, dans le leur ; le Projet (le chutier) et les LUT se relisent dans le nouveau
surEspace(() => { loadBin(); loadLuts(); });

// ── ouvrir, créer ───────────────────────────────────────────
function applySettings() {
  const st = S.p.settings;
  const f = st.format === 'custom' ? { w: st.width || 1920, h: st.height || 1080 } : (S.meta.formats.find((x) => x.id === st.format) || { w: 1920, h: 1080 });
  st.width = f.w; st.height = f.h;
  $('#stage').style.setProperty('--ar', String(f.w / f.h));
  $('#prg-fmt').textContent = `${f.w} × ${f.h} · ${st.fps} i/s`;
  $('#fps').textContent = st.fps;
  $('#p-name').value = S.p.name;
  document.title = `${S.p.name} · Montage`;
}

async function openProject(id) {
  if (S.p && S.p.id !== id) {
    await flushSave();
    clearTimeout(viewT);
    LS('montage-view-' + S.p.id, viewOf());
    targets.set(S.p.id, { ...S.target });
  }
  const lu = espaceDeTab(id);
  const p = await api(`montage/projects/${id}`, lu);
  if (!p.space && !lu.espace && !espace()) await session();   // le Workspace de l'onglet : dit par /api/auth/me
  const esp = p.space || lu.espace || espace() || null;
  id = p.id;                                   // un « mon-… » d'avant mène à sa séquence
  if (esp) tabEsp.set(id, esp);
  espaceDocument(esp);                         // l'en-tête dit l'espace de la séquence quand ce n'est pas celui de l'onglet
  await ensureItems([id, ...M.mediaIds(p)]);
  program.pause();
  program.clear();
  for (const c of p.clips) M.normClip(c);
  p.groups = p.groups || [];
  S.p = p;
  S.rev = p.rev;
  useUndo(undoFor(id));                        // la pile de cette séquence (gardée tant que la page vit)
  if (targets.has(id)) S.target = { ...targets.get(id) };
  S.sel = new Set(); S.gap = null; S.conflict = false; S.dirty = false; S.selTrack = null; S.fxSel = new Set();
  if (!S.tabs.includes(id)) { S.tabs.push(id); LS('montage-tabs', S.tabs); }
  validTargets();
  $('#conflict').hidden = true;
  applySettings();
  paintSeqTabs();
  LS('montage-last', id);
  if (location.hash.slice(1) !== id) history.replaceState(null, '', location.pathname + '#' + id);
  const v = LS('montage-view-' + id);
  timeline.h = (v && v.h && typeof v.h === 'object') ? { ...v.h } : {};   // la hauteur des pistes de cette séquence (molette commune)
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
  EL.refresh();                                // éléments : les pastilles de version de cette séquence
}

// `bin` : le dossier du Projet où la séquence entre (server/tools/montage_projet.py)
async function createProject(name, settings, bin = '') {
  const p = await api('montage/projects', { method: 'POST', body: { name, settings, bin } });
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
    box.replaceChildren(...(list.length ? list.map(row) : [el('p', { class: 'lbl' }, 'aucune séquence')]));
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
    el('div', { class: 'row' }, el('button', { class: 'tb ghost', onclick: projectsModal }, 'Les séquences'),
      el('button', { class: 'tb ghost', onclick: () => newProjectFlow(project.state.tab) }, 'Nouvelle'))));
}

// ── le Projet : ce que le montage a pris dans la bibliothèque (projet.js) ──
const project = mountProject({
  root: $('.bin'),
  items: S.items,
  modal, confirmBox,
  hasSequence: () => !!S.p,
  usedIds: () => new Set(S.p ? M.mediaIds(S.p) : []),
  usedAnywhere: (id) => !!(S.p && S.p.clips.some((c) => c.item === id)),
  sourceId: () => source.item && source.item.id,
  openSequenceId: () => S.p && S.p.id,
  openSource: (it, opts) => openSource(it, null, opts),
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
  uploadMany: (files, opts) => uploadMany(files, opts),
  // retirer du Projet un objet posé : combien de plans dans la séquence ouverte, et les ôter (un geste)
  clipsUsing: (ids) => {
    if (!S.p) return { n: 0, locked: 0 };
    const set = new Set(ids), locked = lockedTracks();
    const cs = S.p.clips.filter((c) => set.has(c.item));
    return { n: cs.length, locked: cs.filter((c) => locked.has(c.track)).length };
  },
  stripClips: (ids) => stripClips(ids),
  pushUndo: (label, undoFn, redoFn) => pushLibUndo(label, undoFn, redoFn),
  detachItem: () => F.entree('bin'),
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
// Upload de la bibliothèque, entré par le montage (seul l'export garde `montage`),
// et dans le Projet (`bin` : son dossier, « » la racine ; false : l'appelant l'y range)
async function uploadMany(files, { bin = '' } = {}) {
  const out = [];
  for (const f of files) {
    try { toast(`dépôt de ${f.name}…`, 1500); const it = await uploadFile(f, { tool: 'upload', via: 'montage' }); S.items.set(it.id, it); out.push(it); }
    catch (e) { toast(`${f.name} : ${e.message}`); }
  }
  if (out.length && bin !== false) {
    await api('montage/bin/put', { method: 'POST', body: { ids: out.map((x) => x.id), folder: bin } }).catch((e) => toast(e.message));
    toast(`${out.length} fichier${out.length > 1 ? 's' : ''} dans la bibliothèque et le Projet${bin ? ` (« ${bin} »)` : ''}`);
    loadBin();
  }
  return out;
}

// ôter de la séquence ouverte les plans de ces objets (hors pistes verrouillées) ; rend de
// quoi défaire et refaire, rangé par l'appelant dans le même geste que le retrait du Projet
function stripClips(ids) {
  if (!S.p) return null;
  const set = new Set(ids), locked = lockedTracks(), sid = S.p.id;
  const gone = new Set(S.p.clips.filter((c) => set.has(c.item) && !locked.has(c.track)).map((c) => c.id));
  if (!gone.size) return null;
  const before = core(S.p);
  M.deleteClips(S.p, gone);
  const after = core(S.p);
  changed();
  const go = (s) => { if (!S.p || S.p.id !== sid) throw new Error('cette séquence n’est plus ouverte'); restore(s); };
  return { n: gone.size, undo: () => go(before), redo: () => go(after) };
}

async function appendMany(ids) {
  for (const id of ids) {
    const it = S.items.get(id);
    if (it && it.kind === 'sequence') { toast('une séquence ne se pose pas dans une autre'); continue; }
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
}
function closeAll() {
  program.pause(); program.clear();
  S.p = null; S.sel = new Set(); S.gap = null;
  espaceDocument(null);
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
    const p = await api('montage/projects', { method: 'POST', body: { from_item: it.id, bin: project.state.tab || '' } });
    toast(`séquence « ${p.name} » : ${p.settings.width}×${p.settings.height} · ${p.settings.fps} i/s · ${M.short(M.projectEnd(p) / p.settings.fps)}${p.note ? ' · ' + p.note : ''}`, 4000);
    await openProject(p.id);
    loadBin();
  } catch (e) { toast(e.message); }
}
async function renameSequence(id, name) {
  if (S.p && S.p.id === id) { commit('renommer', (p) => { p.name = name.slice(0, 120); }); applySettings(); await flushSave(); paintSeqTabs(); return; }
  try { await api(`montage/projects/${id}/rename`, { method: 'POST', body: { name }, ...espaceDeTab(id) }); } catch (e) { toast(e.message); }
  loadBin();
}
async function duplicateSequence(id) {
  if (S.p && S.p.id === id) await flushSave();
  try { const r = await api(`montage/projects/${id}/duplicate`, { method: 'POST', ...espaceDeTab(id) }); toast(`« ${r.name} » créée`); loadBin(); } catch (e) { toast(e.message); }
}

// ── la source ───────────────────────────────────────────────
const source = new Source($('#src-screen'), { onTick: paintSource, fpsOf: () => (S.p ? fps() : 25) });

// ── le panneau Effets (effets.js) ───────────────────────────
let thumbImg = null;
// l'image des vignettes : le plan choisi, sinon celui qu'on voit au programme
function thumbSource(again) {
  if (!S.p) return null;
  const pick = S.sel.size === 1 ? M.byId(S.p, [...S.sel][0]) : null;
  const vis = program.visible || [];
  const c = pick && (pick.kind === 'video' || pick.kind === 'image') && M.trackKind(pick.track) === 'video' ? pick
    : vis[vis.length - 1] || S.p.clips.find((x) => (x.kind === 'video' || x.kind === 'image') && M.trackKind(x.track) === 'video');
  if (!c) return null;
  const e = program.els.get(c.id);
  if (e && e.tag === 'video' && e.el.readyState >= 2) return { el: e.el, key: `${c.id}|${e.el.currentTime.toFixed(3)}` };
  if (e && e.tag === 'img' && e.el.complete && e.el.naturalWidth) return { el: e.el, key: `${c.id}|img` };
  const it = S.items.get(c.item);
  const u = it && (c.kind === 'image' ? it.url : it.thumb_url);
  if (!u) return null;
  if (!thumbImg || thumbImg.dataset.u !== u) {
    thumbImg = new Image();
    thumbImg.dataset.u = u;
    thumbImg.onload = () => again();
    thumbImg.src = href(u);
    return null;
  }
  if (!thumbImg.complete || !thumbImg.naturalWidth) return null;
  return { el: thumbImg, key: u };
}
const effects = mountEffects({ root: $('#fx-pane'), app: {
  luts: () => S.luts,
  setFxDrag: (d) => { S.fxDrag = d; },
  applyToSelection: (d) => applyToSelection(d),
  importLut: () => importLutModal(),
  thumbSource,
  tempGains,
} });

// ── les effets : les poser, les régler, les copier ──────────
const lutMetaOf = (id) => (S.lutById ? S.lutById.get(id) : null);
function fxName(f) {
  if (f.type === 'lut') { const m = lutMetaOf(f.lut); return (m ? m.title : 'LUT') + (f.mix < 0.999 ? ` ${Math.round(f.mix * 100)} %` : ''); }
  if (f.type === 'grade') {
    const parts = [];
    if (f.exposure) parts.push(`${f.exposure > 0 ? '+' : ''}${(+f.exposure).toFixed(2)} IL`);
    if (f.contrast) parts.push(`contraste ${f.contrast > 0 ? '+' : ''}${Math.round(f.contrast)}`);
    if (f.saturation) parts.push(f.saturation <= -100 ? 'N&B' : `saturation ${f.saturation > 0 ? '+' : ''}${Math.round(f.saturation)}`);
    if (Math.abs((f.temperature || 6500) - 6500) > 0.5) parts.push(`${Math.round(f.temperature)} K`);
    return parts.length ? `Étalonnage (${parts.join(', ')})` : 'Étalonnage';
  }
  return f.type;
}

// Le propriétaire d'une liste d'effets : un plan, une piste, un groupe ;
// `list(p)` rend sa liste (à modifier dans le projet `p`).
function ownerOf(key) {
  if (!key) return null;
  if (key.startsWith('g:')) {
    const gid = key.slice(2);
    return { key, kind: 'group', label: 'groupe', list: (p) => { const g = M.groupOf(p, gid); if (!g) return null; g.fx = g.fx || []; return g.fx; } };
  }
  if (key.startsWith('t:')) {
    const tid = key.slice(2);
    return { key, kind: 'track', label: `piste ${tid}`, list: (p) => { const t = M.trackOf(p, tid); if (!t || t.kind !== 'video') return null; t.fx = t.fx || []; return t.fx; } };
  }
  const id = key.slice(2);
  return { key, kind: 'clip', label: 'plan', list: (p) => { const c = M.byId(p, id); if (!c || !(c.kind === 'adjust' || M.trackKind(c.track) === 'video')) return null; c.fx = c.fx || []; return c.fx; } };
}
// ce que l'inspecteur montre : la liste qui reçoit un collage
function inspectorOwner() {
  if (!S.p) return null;
  if (S.selTrack) return ownerOf(S.selTrack.startsWith('g:') ? S.selTrack : 't:' + S.selTrack);
  if (S.sel.size === 1) return ownerOf('c:' + [...S.sel][0]);
  return null;
}
const trackLocked = (tid) => { const t = M.trackOf(S.p, tid); return !!(t && t.lock); };

// Poser un effet sur des plans : une LUT remplace la LUT du plan (on change
// de look), Maj l'ajoute en plus ; les autres effets s'ajoutent au bout.
function addFxTo(keys, desc, { add = false } = {}) {
  const fx = fxOfDesc(desc);
  if (!fx) return 0;
  let n = 0;
  commit(`effet « ${desc.title} »`, (p) => {
    for (const k of keys) {
      const o = ownerOf(k);
      const list = o && o.list(p);
      if (!list) continue;
      if (k.startsWith('c:') && trackLocked(M.byId(p, k.slice(2)).track)) continue;
      const cur = fx.type === 'lut' && !add ? list.find((f) => f.type === 'lut') : null;
      if (cur) { cur.lut = fx.lut; cur.on = true; } else list.push({ ...fx, id: M.newId('f') });
      n++;
    }
  });
  const m = desc.type === 'lut' ? lutMetaOf(desc.lut) : null;
  if (n && m && m.input && m.input !== 'rec709') toast(`« ${m.title} » attend du ${m.input_label}`, 3000);
  return n;
}

// un fondu lâché sur un plan : au bord le plus proche (une seconde, dans ce que le plan permet)
function dropFade(id, side, cross) {
  const c = M.byId(S.p, id);
  if (!c) return;
  if (trackLocked(c.track)) return toast(`la piste ${c.track} est verrouillée`);
  const f = fps();
  if (cross) {
    if (side === 'l') return dissolve(c.id, f);
    const next = M.trackClips(S.p, c.track).find((x) => x.start === M.clipEnd(c) && x.id !== c.id);
    if (!next) return toast('pas de plan collé après');
    return dissolve(next.id, f);
  }
  commit(side === 'l' ? 'fondu d’entrée' : 'fondu de sortie', (p) => {
    const x = M.byId(p, id);
    if (side === 'l') { x.xfade = 0; x.fade_in = Math.min(f, x.dur - (x.fade_out || 0)); }
    else x.fade_out = Math.min(f, x.dur - (x.fade_in || 0));
    M.fitFades(x);
  });
}

// Un effet lâché sur la timeline (effets.js, bindEffectDrops).
function dropEffect(d, t, { add = false } = {}) {
  if (!S.p || !d) return;
  // le champ de recherche du panneau garde sinon le clavier : ctrl+Z défait ce geste, pas le texte cherché
  const a = document.activeElement;
  if (a && a.closest && a.closest('#fx-pane')) a.blur();
  focus('program');
  if (d.type === 'fade' || d.type === 'xfade') { if (t.kind === 'clip') dropFade(t.id, t.side, d.type === 'xfade'); return; }
  const fx = fxOfDesc(d);
  if (!fx) return;
  if (t.kind === 'new' || t.kind === 'layer') {
    const f = fps();
    const from = Math.max(0, t.frame);
    const end = M.projectEnd(S.p);
    const dur = end - from >= f ? end - from : 5 * f;
    const name = `FX ${d.title}`.slice(0, 40);
    let made = null;
    if (t.kind === 'new') {
      commit(`calque « ${name} »`, (p) => { made = M.addFxLayer(p, fx, from, dur, name); if (made) remapTargets(made.map); });
      if (!made) return toast(`${M.MAX_TRACKS} pistes de calques au plus`);
      remapHeights(made.map);
    } else {
      const free = M.trackClips(S.p, t.track).find((c) => c.start <= from && M.clipEnd(c) > from);
      if (free) return addFxTo(['c:' + free.id], d, { add });
      const nextC = M.trackClips(S.p, t.track).find((c) => c.start > from);
      const len = Math.min(dur, nextC ? nextC.start - from : dur);
      commit(`calque « ${name} »`, (p) => {
        const c = { id: M.newClipId(), track: t.track, item: '', kind: 'adjust', title: name, start: from, dur: Math.max(1, len), in: 0, src_dur: 0, speed: 1,
          enabled: true, vol: 1, fade_in: 0, fade_out: 0, xfade: 0, audio: false, fx: [fx] };
        p.clips.push(c);
        made = { clip: c.id };
      });
    }
    if (made) select(new Set([made.clip]));
    return;
  }
  if (t.kind === 'clip') {
    const ids = S.sel.has(t.id) ? [...S.sel] : [t.id];
    addFxTo(ids.map((x) => 'c:' + x), d, { add });
    if (!S.sel.has(t.id)) select(new Set([t.id])); else paintInspector();
    return;
  }
  if (t.kind === 'track') { addFxTo(['t:' + t.id], d, { add }); selectTrack(t.id); return; }
  if (t.kind === 'group') { addFxTo(['g:' + t.id], d, { add }); selectTrack('g:' + t.id); }
}

// double-clic sur un effet du panneau : sur ce qui est choisi
function applyToSelection(d) {
  if (!S.p) return toast('aucune séquence ouverte');
  if (d.type === 'fade' || d.type === 'xfade') {
    if (S.sel.size !== 1) return toast('choisissez un plan');
    return dropFade([...S.sel][0], 'l', d.type === 'xfade');
  }
  const o = inspectorOwner();
  const keys = S.sel.size ? [...S.sel].map((x) => 'c:' + x) : o ? [o.key] : [];
  if (!keys.length) return toast('choisissez un plan, une piste ou un groupe');
  if (!addFxTo(keys, d)) toast('un effet d’image va sur un plan vidéo, une piste vidéo ou un calque');
  paintInspector();
}

// les gestes sur une liste d'effets (l'inspecteur)
function editFx(owner, label, fn) {
  commit(label, (p) => { const list = owner.list(p); if (list) fn(list, p); });
}
function copyFx(owner) {
  const list = owner.list(S.p) || [];
  const picked = list.filter((f) => S.fxSel.has(f.id));
  const out = picked.length ? picked : list;
  if (!out.length) return toast('aucun effet à copier');
  S.fxClip = JSON.parse(JSON.stringify(out));
  S.lastCopy = 'fx';
  LS('montage-fx-clipboard', S.fxClip);
  toast(`${out.length} effet${out.length > 1 ? 's' : ''} copié${out.length > 1 ? 's' : ''}`, 1200);
}
function pasteFx(keys) {
  if (!S.fxClip || !S.fxClip.length) return toast('aucun effet copié');
  let n = 0;
  commit(`coller ${S.fxClip.length > 1 ? S.fxClip.length + ' effets' : 'un effet'}`, (p) => {
    for (const k of keys) {
      const list = ownerOf(k)?.list(p);
      if (!list) continue;
      list.push(...M.cloneFx(S.fxClip));
      n++;
    }
  });
  if (!n) toast('les effets d’image vont sur un plan vidéo, une piste vidéo, un groupe ou un calque');
}
function pasteKeys() {
  if (S.sel.size) return [...S.sel].map((x) => 'c:' + x);
  const o = inspectorOwner();
  return o ? [o.key] : [];
}

// ── les pistes : déplacer, grouper (pistes.js) ──────────────
// la hauteur de chaque piste (molette commune) suit son nom quand les pistes se renumérotent
function remapHeights(map) {
  const h = {};
  for (const [id, v] of Object.entries(timeline.h || {})) if (map[id] !== null) h[map[id] || id] = v;
  timeline.h = h;
  saveView();
}
function afterTracks(map) {
  if (!map) return;
  remapTargets(map);
  remapHeights(map);
  if (S.selTrack && !S.selTrack.startsWith('g:') && map[S.selTrack]) S.selTrack = map[S.selTrack];
}
function moveTracks(ids, cible, cote) {
  let map = null;
  commit(ids.length > 1 ? `déplacer ${ids.length} pistes` : 'déplacer la piste', (p) => { map = M.moveTracks(p, ids, cible, cote); if (map) remapTargets(map); });
  if (map) { remapHeights(map); if (S.selTrack && map[S.selTrack]) S.selTrack = map[S.selTrack]; timeline.render(); paintInspector(); }
}
function groupTracks(ids, cible) {
  let r = null;
  commit('grouper des pistes', (p) => { r = M.groupTracks(p, ids, cible); if (r) remapTargets(r.map); });
  if (r) { remapHeights(r.map); selectTrack('g:' + r.g.id); toast(`« ${r.g.name} »`, 1200); }
}
function ungroupTracks(gid) {
  commit('défaire le groupe', (p) => M.ungroup(p, gid));
  if (S.selTrack === 'g:' + gid) selectTrack(null);
}
async function renameGroup(gid) {
  const g = M.groupOf(S.p, gid);
  if (!g) return;
  const v = await askName('Renommer le groupe', g.name, 'Renommer', { placeholder: 'le nom du groupe', max: 40 });
  if (v) commit('renommer le groupe', (p) => { M.groupOf(p, gid).name = v; });
}

// Le panneau Source a deux onglets : Effets (montré au départ) et Source.
// Ouvrir un plan dans la source y bascule (double-clic dans le Projet,
// « Ouvrir dans le moniteur source », concordance des images) ; un simple
// clic dans le Projet le charge sans quitter les effets.
function srcTab(which) {
  S.srcTab = which;
  for (const b of $$('#src-tabs [data-tab]')) { b.classList.toggle('on', b.dataset.tab === which); b.setAttribute('aria-selected', String(b.dataset.tab === which)); }
  $('#fx-pane').hidden = which !== 'fx';
  $('#src-pane').hidden = which !== 'src';
  $('#src-meta').hidden = which !== 'src';
  if (which === 'fx') { effects.paint(); if (S.focus === 'source') focus('program'); }
  else focus('source');
}

function openSource(it, marks, { show = true } = {}) {
  S.items.set(it.id, it);
  if (show && S.srcTab !== 'src') srcTab('src');
  source.load(it, marks || undefined);
  const wave = $('#src-screen .wave');
  if (wave) wave.remove();
  if (it.kind === 'audio') {
    // le son entier, dessiné à la taille de l'écran Source (commun/onde.js), redessiné s'il change de taille
    const cv = el('canvas', { class: 'wave' });
    $('#src-screen').append(cv);
    const peindre = () => pics(it.id).then((P) => { if (cv.isConnected) dessiner(cv, P); }).catch(() => {});
    new ResizeObserver(peindre).observe(cv);
    document.addEventListener('sr:theme', peindre);
  }
  $('#src-name').textContent = it.title || it.id;
  if (S.srcTab === 'src') focus('source');
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
    $(b).title = !it ? 'aucun plan dans la source' : !S.p ? 'aucune séquence ouverte' : $(b).dataset.title || $(b).title;
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
  // éléments : un élément pose sa dernière version ; un élément de sa propre descendance est refusé
  if (it.version?.of || (it.kind === 'element' && Array.isArray(it.element?.versions))) {
    const v = await EL.resolve(it, S.p.id);
    if (!v) return undefined;
    if (v.id !== it.id) return placeItem({ id: v.id, in: 0, out: 0 }, tid, frame, mode);
  }
  if (it.kind === 'sequence') return toast('une séquence ne se pose pas dans une autre');
  if (!['video', 'image', 'audio'].includes(it.kind)) return toast('seulement une vidéo, une image ou un son');
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
    audio: it.kind === 'video' && !!it.audio, fx: [], fcurve: { in: 'tri', out: 'tri' } };
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
    program.seekFrame(c.start);
    if (!source.item || source.item.id !== it.id) openSource(it, null, { show: false });
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
  if (!playing) { saveView(); clearTimeout(shelfT); shelfT = setTimeout(() => effects.thumbs(), 250); }
}
let shelfT = 0;

let viewT = 0;
// la vue d'une séquence, gardée dans ce navigateur : zoom, défilement, tête de lecture, hauteur des pistes
const viewOf = () => ({ pps: timeline.pps, scroll: timeline.scroll.scrollLeft, t: program.t, h: timeline.h });
function saveView() {
  clearTimeout(viewT);
  viewT = setTimeout(() => { if (S.p) LS('montage-view-' + S.p.id, viewOf()); }, 400);
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
  S.fxFocus = null;                 // un clic ailleurs rend le clavier aux raccourcis du montage
  $('#src').classList.toggle('focus', which === 'source');
  $('#prg').classList.toggle('focus', which === 'program');
}

// ── éléments : la pastille « vN+1 » des plans qui posent une version (montage/elements.js, 30/09) ──
const EL = createElements({ getP: () => S.p, commit, ensureItems, itemOf, rerender: () => { timeline.render(); } });

// ── la timeline ─────────────────────────────────────────────
const timeline = new Timeline($('#tl'), {
  p: () => S.p,
  sel: () => S.sel,
  elementBadge: (c) => EL.badge(c),            // éléments : la pastille de version d'un plan
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
  scrub: (on) => program.scrub(on),            // la tête glissée sur la règle : la copie de défilement (player.js)
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
  resized: () => saveView(),
  selTrack: () => S.selTrack,
  fxName: (f) => fxName(f),
  renameGroup: (gid) => renameGroup(gid),
});

function zoomed(pps) {
  $('#z-val').textContent = `${Math.round(pps / 40 * 100)} %`;
  saveView();
}

function select(sel, gap = null) {
  S.sel = sel;
  S.gap = gap;
  S.selTrack = null;
  S.fxSel = new Set();
  S.fxFocus = null;
  timeline.render();
  paintInspector();
  paintBar();
}

// choisir une piste ('V2') ou un groupe ('g:<id>') : l'inspecteur montre ses effets
function selectTrack(key) {
  S.sel = new Set(); S.gap = null;
  S.selTrack = key;
  S.fxSel = new Set();
  S.fxFocus = null;
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
    if (!at) return toast('choisissez le plan d’arrivée');
    return dissolve(at.id, frames);
  }
  const prev = prevClip(S.p, c);
  if (!prev) return toast('pas de plan collé avant');
  const n = Math.max(2, Math.min(frames || fps(), c.dur, prev.dur));
  commit('fondu enchaîné', (p) => { const x = M.byId(p, c.id); x.xfade = n; x.fade_in = 0; const pv = M.byId(p, prev.id); pv.fade_out = 0; });
  select(new Set([c.id]));
}

function detachSound(id) {
  const c = M.byId(S.p, id);
  if (!c || c.kind !== 'video' || !c.audio) return toast('rien à dissocier : ce plan n’a pas de son attaché');
  const tid = S.target.audio;
  if (lockedTracks().has(tid)) return toast(`la piste ${tid} est verrouillée`);
  const a = { ...JSON.parse(JSON.stringify(c)), id: M.newClipId(), track: tid, fx: [], audio: true };
  commit('dissocier le son', (p) => { M.byId(p, id).audio = false; M.placeClip(p, a, 'overwrite'); });
  toast(`son sur ${tid}`, 1400);
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
  remapHeights(res.map);
}
async function deleteTrack(tid) {
  const t = M.trackOf(S.p, tid);
  const n = S.p.clips.filter((c) => c.track === tid).length;
  if (n && !(await confirmBox('Supprimer la piste', `${tid}${t.name ? ` « ${t.name} »` : ''} : ${n} plan${n > 1 ? 's' : ''} ${n > 1 ? 'partent' : 'part'} avec elle.`, 'Supprimer la piste'))) return;
  let map = null;
  commit(`supprimer la piste ${tid}`, (p) => { map = M.deleteTrack(p, tid); if (map) remapTargets(map); });
  if (map) { remapHeights(map); if (S.selTrack === tid) selectTrack(null); }
}
async function renameTrack(tid) {
  const t = M.trackOf(S.p, tid);
  if (!t) return;
  const v = await askName(`Renommer la piste ${tid}`, t.name || '', 'Renommer', { placeholder: 'le nom de la piste (vide : aucun)', max: 40, empty: true });
  if (v === null) return;
  commit('renommer la piste', (p) => { M.trackOf(p, tid).name = v; });
}

// ── les marques, l'entrée et la sortie de séquence ──────────
function addMarkerAt(f) { commit('ajouter une marque', (p) => M.addMarker(p, f)); }
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
  if (!b || b[1] <= b[0]) return toast('pas d’entrée ni de sortie (I, O)');
  // extraire referme la plage : l'entrée et la sortie n'ont plus d'objet (une seule annulation)
  commit(extract ? 'extraire' : 'prélever', (p) => { if (extract) { M.extractRange(p, b[0], b[1]); p.range = { in: null, out: null }; } else M.liftRange(p, b[0], b[1]); });
  program.seekFrame(b[0]);
}

// ── le presse-papiers, dupliquer ────────────────────────────
function copySel() {
  const cl = [...S.sel].map((id) => M.byId(S.p, id)).filter(Boolean);
  if (!cl.length) return toast('choisissez d’abord des plans');
  S.clip = { clips: JSON.parse(JSON.stringify(cl)) };
  S.lastCopy = 'clips';
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
}

function speedModal(id) {
  const c = M.byId(S.p, id);
  if (!c) return toast('choisissez d’abord un plan');
  if (M.still(c)) return toast('pas de vitesse : étirez-le');
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
    if (nd && nd < want) toast(`arrêtée au plan suivant (${M.short(nd / f)})`, 2500);
    close();
  };
  modal('Vitesse/Durée', el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'vitesse (%)'), el('span', { class: 'sp' }), inp),
    el('dl', { class: 'kv' }, el('dt', {}, 'durée'), out, el('dt', {}, 'matière'), el('dd', {}, `${M.short(c.dur / f * sp0)} de source (${M.short(c.in || 0)} → ${M.short((c.in || 0) + c.dur / f * sp0)})`)),
    el('label', { class: 'row chk' }, rip, el('span', {}, 'propager (décaler la suite de la piste)'))),
  (close) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', onclick: close }, 'Annuler'), el('button', { class: 'tb go', onclick: () => apply(close) }, 'Appliquer')]);
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}

async function loadLuts() {
  try { const r = await api('montage/luts'); S.luts = r.luts; } catch { S.luts = []; }
  S.lutById = new Map(S.luts.map((l) => [l.id, l]));
  effects.paint();
  if (S.p) { timeline.render(); paintInspector(); }
}
const lutMeta = (id) => (S.lutById ? S.lutById.get(id) : S.luts.find((l) => l.id === id));

function importLutModal(then) {
  const file = el('input', { type: 'file', accept: '.cube,.png', class: 'fld' });
  const title = el('input', { class: 'fld', placeholder: 'le nom de la LUT (sinon celui du fichier)', maxlength: 80 });
  const inp = el('select', { class: 'fld' }, ...(S.meta.lut_inputs || []).map((x) => el('option', { value: x.id, selected: x.id === 'rec709' ? '' : null }, x.label)));
  const fam = el('input', { class: 'fld', placeholder: 'la famille sur l’étagère (sinon « Importées »)', maxlength: 60, list: 'lut-families' });
  const famList = el('datalist', { id: 'lut-families' }, ...lutFamilies(S.luts).map((f) => el('option', { value: f.name })));
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
    file, title, fam, famList, el('span', { class: 'lbl' }, 'l’image qu’elle attend'), inp, why),
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
  suivrePanneau();   // la piste choisie fait les filtres du panneau Asset (tout changement de choix repasse ici)
  const box = $('#insp');
  if (!S.p) return paintEmptyState();
  const keep = box.scrollTop;
  const cards = [];
  const f = fps();
  if (S.selTrack) cards.push(...trackCards(S.selTrack));
  else if (S.sel.size === 1) {
    const c = M.byId(S.p, [...S.sel][0]);
    if (c) cards.push(...(c.kind === 'adjust' ? adjustCards(c, f) : clipCards(c, f)));
  } else if (S.sel.size > 1) {
    cards.push(el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('span', { class: 't' }, `${S.sel.size} plans choisis`)),
      el('div', { class: 'row' }, el('button', { class: 'tb ghost sm', onclick: () => del(false) }, 'Supprimer'),
        el('button', { class: 'tb ghost sm', onclick: () => del(true) }, 'Et raccorder'),
        el('button', { class: 'tb ghost sm', disabled: !(S.fxClip && S.fxClip.length) || null, title: 'Ctrl+Alt+V', onclick: () => pasteFx(pasteKeys()) }, 'Coller les effets'))));
  } else if (S.gap) {
    cards.push(el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('span', { class: 't' }, `Vide · ${S.gap.track}`)),
      el('dl', { class: 'props' }, el('dt', {}, 'de'), el('dd', { class: 'tcv' }, M.tc(S.gap.s, f)), el('dt', {}, 'à'), el('dd', { class: 'tcv' }, M.tc(S.gap.e, f)),
        el('dt', {}, 'durée'), el('dd', {}, M.short((S.gap.e - S.gap.s) / f))),
      el('button', { class: 'tb ghost sm', onclick: () => del(true), title: 'Suppr' }, 'Supprimer et raccorder')));
  }
  if (!S.sel.size && !S.selTrack) cards.push(...projectCards(f));
  box.replaceChildren(...cards);
  box.scrollTop = keep;
}

// ── la liste d'effets d'un plan, d'une piste, d'un groupe, d'un calque ──
// Clic : choisir (Maj : jusqu'à lui, Ctrl : ajouter ou retirer) ; glisser par
// la poignée : réordonner ; l'interrupteur : désactiver ; × ou Suppr :
// retirer ; Ctrl+C / Ctrl+V : copier, coller sur une autre piste ou un autre
// plan (Ctrl+Alt+V : « Coller les attributs » de Premiere, toujours les effets).
function fxCard(owner, locked = false) {
  const list = owner.list(S.p) || [];
  const rows = el('div', { class: 'fxl' });
  const card = el('div', { class: 'card fxc', 'data-owner': owner.key },
    el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Effets'),
      el('span', { class: 'acts' },
        el('button', { class: 'lnk', disabled: !list.length || null, title: 'Ctrl+C', onclick: () => copyFx(owner) }, 'Copier'),
        el('button', { class: 'lnk', disabled: (!(S.fxClip && S.fxClip.length) || locked) || null, title: 'Ctrl+V', onclick: () => pasteFx([owner.key]) }, 'Coller'))),
    rows);
  if (!list.length) rows.append(el('p', { class: 'lbl fx-empty' }, 'aucun effet'));
  for (const fx of list) {
    const on = fx.on !== false;
    const lm = fx.type === 'lut' ? lutMeta(fx.lut) : null;
    const gone = fx.type === 'lut' && S.luts.length && !lm;
    const row = el('div', { class: `fxr${S.fxSel.has(fx.id) ? ' on' : ''}${on ? '' : ' off'}${gone ? ' gone' : ''}`, 'data-fx': fx.id, title: gone ? 'LUT introuvable : l’export la refusera' : '' },
      el('i', { class: 'grip' }),
      el('button', { class: 'sw sm' + (on ? ' on' : ''), title: on ? 'désactiver' : 'activer', 'aria-pressed': String(on), disabled: locked || null,
        onclick: (e) => { e.stopPropagation(); editFx(owner, on ? 'désactiver un effet' : 'activer un effet', (l) => { const x = l.find((y) => y.id === fx.id); if (x) x.on = !on; }); } }, el('i')),
      el('span', { class: 'nm' }, fxName(fx)),
      el('button', { class: 'x', title: 'retirer', 'aria-label': 'retirer', disabled: locked || null, onclick: (e) => { e.stopPropagation(); removeFx(owner, [fx.id]); } }, '×'));
    row.addEventListener('pointerdown', (e) => fxRowDown(e, owner, fx.id, rows, locked));
    rows.append(row);
    if (S.fxSel.size === 1 && S.fxSel.has(fx.id)) rows.append(fxParams(owner, fx, locked));
  }
  card.addEventListener('pointerdown', () => { S.fxFocus = owner.key; }, true);
  return card;
}

function removeFx(owner, ids) {
  const gone = new Set(ids);
  editFx(owner, ids.length > 1 ? `retirer ${ids.length} effets` : 'retirer un effet', (l) => { const keep = l.filter((f) => !gone.has(f.id)); l.splice(0, l.length, ...keep); });
  for (const id of ids) S.fxSel.delete(id);
  paintInspector();
}

// choisir, ou glisser pour réordonner (le trait dit où l'effet ira)
function fxRowDown(e, owner, id, rows, locked) {
  if (e.button !== 0 || e.target.closest('button')) return;
  const list = owner.list(S.p) || [];
  const y0 = e.clientY;
  let moving = false, to = -1;
  const line = el('i', { class: 'fx-line' });
  const mv = (ev) => {
    if (!moving && Math.abs(ev.clientY - y0) < 4) return;
    if (locked) return;
    moving = true;
    const rs = [...rows.querySelectorAll('.fxr')];
    to = rs.length;
    for (let i = 0; i < rs.length; i++) { const b = rs[i].getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { to = i; break; } }
    const ref = rs[to];
    if (ref) ref.before(line); else rows.append(line);
  };
  const W = winOf(rows);                 // l'inspecteur peut être dans sa fenêtre (commun/fenetre.js)
  const up = (ev) => {
    W.removeEventListener('pointermove', mv, true);
    W.removeEventListener('pointerup', up, true);
    line.remove();
    if (moving) {
      const from = list.findIndex((f) => f.id === id);
      const picked = S.fxSel.has(id) ? list.filter((f) => S.fxSel.has(f.id)).map((f) => f.id) : [id];
      if (from >= 0) editFx(owner, 'réordonner les effets', (l) => {
        const moved = l.filter((f) => picked.includes(f.id));
        const before = l.slice(0, to).filter((f) => !picked.includes(f.id)).length;
        const rest = l.filter((f) => !picked.includes(f.id));
        rest.splice(before, 0, ...moved);
        l.splice(0, l.length, ...rest);
      });
      return;
    }
    // un clic : choisir (Maj : jusqu'à lui ; Ctrl : ajouter ou retirer)
    const ids = list.map((f) => f.id);
    if (ev.shiftKey && S.fxAnchor && ids.includes(S.fxAnchor)) {
      const [a, b] = [ids.indexOf(S.fxAnchor), ids.indexOf(id)].sort((x, y) => x - y);
      S.fxSel = new Set(ids.slice(a, b + 1));
    } else if (ev.ctrlKey || ev.metaKey) {
      S.fxSel.has(id) ? S.fxSel.delete(id) : S.fxSel.add(id);
      S.fxAnchor = id;
    } else {
      S.fxSel = S.fxSel.size === 1 && S.fxSel.has(id) ? new Set() : new Set([id]);
      S.fxAnchor = id;
    }
    S.fxFocus = owner.key;
    paintInspector();
  };
  W.addEventListener('pointermove', mv, true);
  W.addEventListener('pointerup', up, true);
}

// les réglages de l'effet choisi : l'intensité d'une LUT, les curseurs de l'étalonnage
function fxParams(owner, fx, locked) {
  const box = el('div', { class: 'fxp' });
  const set = (fn) => (v) => { const x = (owner.list(S.p) || []).find((y) => y.id === fx.id); if (x) fn(x, v); };
  if (fx.type === 'lut') {
    const m = lutMeta(fx.lut);
    if (m && m.input !== 'rec709') box.append(el('p', { class: 'why' }, `attend du ${m.input_label}`));
    box.append(slider({ label: 'intensité', min: 0, max: 100, step: 1, value: Math.round((fx.mix ?? 1) * 100), fmt: (v) => `${v} %`, disabled: locked,
      apply: set((x, v) => { x.mix = v / 100; }) }));
  } else if (fx.type === 'grade') {
    const neutral = M.gradeNeutral(fx);
    box.append(
      slider({ label: 'exposition', min: -2, max: 2, step: 0.05, value: fx.exposure || 0, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} IL`, disabled: locked, apply: set((x, v) => { x.exposure = v; }) }),
      slider({ label: 'contraste', min: -100, max: 100, step: 1, value: fx.contrast || 0, fmt: (v) => `${v > 0 ? '+' : ''}${v}`, disabled: locked, apply: set((x, v) => { x.contrast = v; }) }),
      slider({ label: 'saturation', min: -100, max: 100, step: 1, value: fx.saturation || 0, fmt: (v) => `${v > 0 ? '+' : ''}${v}`, color: 'var(--or)', disabled: locked, apply: set((x, v) => { x.saturation = v; }) }),
      slider({ label: 'température', min: 2000, max: 12000, step: 100, value: fx.temperature || 6500, fmt: (v) => `${v} K`, cls: 'temp', disabled: locked, apply: set((x, v) => { x.temperature = v; }) }),
      el('div', { class: 'row' }, el('span', { class: 'sp' }), el('button', { class: 'lnk', disabled: (neutral || locked) || null,
        onclick: () => editFx(owner, 'réinitialiser l’étalonnage', (l) => { const x = l.find((y) => y.id === fx.id); if (x) Object.assign(x, M.NEUTRAL); }) }, 'Réinit.')));
  }
  return box;
}

// Les fondus d'un plan : leur durée (aussi aux poignées, dans les coins du
// plan), la courbe du son (celles d'afade ; l'image fond en ligne droite :
// le `fade` de ffmpeg 6.1 n'a pas de courbe), le fondu enchaîné avec le plan d'avant.
function fadeCard(c, track, locked) {
  const f = fps();
  const set = (fn) => (v) => { const x = M.byId(S.p, c.id); if (x) { fn(x, v); M.fitFades(x); } };
  const card = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Fondus')));
  const prev = c.kind !== 'adjust' ? prevClip(S.p, c) : null;
  const w = M.windows(S.p).get(c.id) || {};
  const maxIn = Math.max(1, c.dur - (c.fade_out || 0)), maxOut = Math.max(1, c.dur - (c.fade_in || 0));
  if (w.xin) {
    card.append(slider({ label: 'enchaîné', min: 2, max: Math.max(2, Math.min(c.dur, prev ? prev.dur : c.dur)), step: 1, value: c.xfade, fmt: (v) => M.short(v / f), disabled: locked,
      apply: set((x, v) => { x.xfade = v; }) }));
  } else {
    card.append(slider({ label: 'entrée', min: 0, max: maxIn, step: 1, value: c.fade_in || 0, fmt: (v) => (v ? M.short(v / f) : '—'), disabled: locked, apply: set((x, v) => { x.fade_in = v; }) }));
  }
  const nextX = M.trackClips(S.p, c.track).find((x) => x.start === M.clipEnd(c) && x.xfade > 0 && x.id !== c.id);
  if (!w.xout) card.append(slider({ label: 'sortie', min: 0, max: maxOut, step: 1, value: c.fade_out || 0, fmt: (v) => (v ? M.short(v / f) : '—'), disabled: locked, apply: set((x, v) => { x.fade_out = v; }) }));
  else if (nextX) card.append(el('p', { class: 'lbl' }, 'sortie : fondu enchaîné'));
  const sound = track.kind === 'audio' || (c.kind === 'video' && c.audio);
  if (sound && (c.fade_in || c.fade_out)) {
    const pick = (side) => {
      const s = el('select', { class: 'fld sm', disabled: locked || null, 'aria-label': 'courbe' }, ...M.CURVES.map(([id, label]) => el('option', { value: id, selected: ((c.fcurve || {})[side] || 'tri') === id ? '' : null }, label)));
      s.addEventListener('change', () => commit('courbe du fondu', (p) => { const x = M.byId(p, c.id); x.fcurve = { in: 'tri', out: 'tri', ...(x.fcurve || {}), [side]: s.value }; }));
      return s;
    };
    card.append(el('div', { class: 'row curves' }, el('span', { class: 'lbl', title: 'la courbe du son ; l’image fond en ligne droite' }, 'courbe'),
      c.fade_in ? pick('in') : null, c.fade_out ? pick('out') : null));
  }
  if (prev && !w.xin && c.kind !== 'adjust') card.append(el('button', { class: 'tb ghost sm', disabled: locked || null, title: 'Ctrl+D', onclick: () => dissolve(c.id) }, 'Fondu enchaîné'));
  if (w.xin) card.append(el('button', { class: 'tb ghost sm', disabled: locked || null, onclick: () => commit('coupe franche', (p) => { M.byId(p, c.id).xfade = 0; }) }, 'Coupe franche'));
  return card;
}

// un calque d'effet : son nom, sa place, ses fondus, ses effets
function adjustCards(c, f) {
  const track = M.trackOf(S.p, c.track);
  const locked = track.lock;
  const head = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Calque · ', el('b', {}, c.title || 'calque')),
      el('span', { class: 'snapper', title: 'maj+E' }, 'actif',
        el('button', { class: 'sw' + (M.isOn(c) ? ' on' : ''), disabled: locked || null, 'aria-pressed': String(M.isOn(c)), onclick: () => toggleEnabled([c.id]) }, el('i')))),
    el('dl', { class: 'props' }, el('dt', {}, 'piste'), el('dd', {}, c.track + (track.name ? ` · ${track.name}` : '')),
      el('dt', {}, 'début'), el('dd', { class: 'tcv' }, M.tc(c.start, f)), el('dt', {}, 'durée'), el('dd', { class: 'tcv' }, M.tc(c.dur, f))),
    el('div', { class: 'row' }, el('button', { class: 'tb ghost sm', onclick: () => renameClip(c.id) }, 'Renommer')));
  return [head, fxCard(ownerOf('c:' + c.id), locked), fadeCard(c, track, locked)];
}

// une piste, ou un groupe de pistes, choisis par leur en-tête
function trackCards(key) {
  if (key.startsWith('g:')) {
    const g = M.groupOf(S.p, key.slice(2));
    if (!g) return [];
    const members = S.p.tracks.filter((t) => t.grp === g.id);
    const img = members.some((t) => t.kind !== 'audio');
    return [el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Groupe · ', el('b', {}, g.name))),
      el('dl', { class: 'props' }, el('dt', {}, 'pistes'), el('dd', {}, members.map((t) => t.id).join(' · '))),
      el('div', { class: 'row' }, el('button', { class: 'tb ghost sm', onclick: () => renameGroup(g.id) }, 'Renommer'),
        el('button', { class: 'tb ghost sm', onclick: () => ungroupTracks(g.id) }, 'Défaire'))),
    ...(img ? [fxCard(ownerOf('g:' + g.id))] : [])];
  }
  const t = M.trackOf(S.p, key);
  if (!t) return [];
  const n = S.p.clips.filter((c) => c.track === t.id).length;
  const g = t.grp ? M.groupOf(S.p, t.grp) : null;
  const cards = [el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('span', { class: 't' }, `Piste ${t.id}`, t.name ? el('b', {}, ' · ' + t.name) : null)),
    el('dl', { class: 'props' }, el('dt', {}, t.kind === 'fx' ? 'calques' : 'plans'), el('dd', {}, String(n)), g ? el('dt', {}, 'groupe') : null, g ? el('dd', {}, g.name) : null),
    el('div', { class: 'row' }, el('button', { class: 'tb ghost sm', onclick: () => renameTrack(t.id) }, 'Renommer'),
      g ? el('button', { class: 'tb ghost sm', onclick: () => leaveGroup(t.id) }, 'Sortir du groupe') : null))];
  if (t.kind === 'video') cards.push(fxCard(ownerOf('t:' + t.id), t.lock));
  return cards;
}

// sortir une piste de son groupe : elle se pose juste sous lui (un groupe d'une seule piste se défait)
function leaveGroup(tid) {
  const t = M.trackOf(S.p, tid);
  if (!t || !t.grp) return;
  const members = S.p.tracks.filter((x) => x.grp === t.grp && x.id !== tid);
  const last = members[members.length - 1];
  let map = null;
  commit('sortir du groupe', (p) => {
    const tt = M.trackOf(p, tid);
    const g = tt.grp;
    delete tt.grp;
    const rest = p.tracks.filter((x) => x.id !== tid);
    rest.splice(rest.findIndex((x) => x.id === last.id) + 1, 0, tt);
    p.tracks = rest;
    map = M.renumber(p);
    if (!p.tracks.some((x) => x.grp === g)) M.ungroup(p, g);
    remapTargets(map);
  });
  if (map) { remapHeights(map); S.selTrack = map[tid] || null; paintInspector(); timeline.render(); }
}

async function renameClip(id) {
  const c = M.byId(S.p, id);
  if (!c) return;
  const v = await askName(c.kind === 'adjust' ? 'Renommer le calque' : 'Renommer le plan', c.title || '', 'Renommer', { placeholder: 'son nom dans cette séquence', max: 200 });
  if (v) commit('renommer', (p) => { M.byId(p, id).title = v; });
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
      el('span', { class: 'snapper', title: 'maj+E' }, 'actif',
        el('button', { class: 'sw' + (M.isOn(c) ? ' on' : ''), disabled: locked || null, 'aria-pressed': String(M.isOn(c)), onclick: () => toggleEnabled([c.id]) }, el('i')))),
    el('dl', { class: 'props' }, ...props.flatMap(([k, v, cls]) => [el('dt', {}, k), el('dd', { class: cls }, v)])));
  if (it.missing) head.append(el('p', { class: 'warn' }, 'introuvable dans la bibliothèque : l’export le refusera'));
  if (c.kind === 'image') {
    const inp = el('input', { class: 'fld nfld', type: 'number', min: 0.04, step: 0.5, value: (c.dur / f).toFixed(2), disabled: locked || null });
    const next = M.trackClips(S.p, c.track).find((x) => x.start >= M.clipEnd(c) && x.id !== c.id);
    inp.addEventListener('change', () => {
      let d = Math.max(1, Math.round(+inp.value * f));
      if (next) d = Math.min(d, next.start - c.start);
      commit('durée de l’image', (p) => { const x = M.byId(p, c.id); x.dur = d; x.fade_in = Math.min(x.fade_in, d); x.fade_out = Math.min(x.fade_out, d); });
    });
    head.append(el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'durée de l’image (s)'), el('span', { class: 'sp' }), inp));
  }
  const acts = el('div', { class: 'row' },
    el('button', { class: 'tb ghost sm', onclick: () => openClipInSource(c.id), disabled: it.missing || null }, 'Dans la source'));
  if (c.kind !== 'image') acts.append(el('button', { class: 'tb ghost sm', disabled: locked || null, title: 'ctrl+R', onclick: () => speedModal(c.id) }, 'Vitesse…'));
  if (c.kind === 'video' && track.kind === 'video') {
    acts.append(c.audio ? el('button', { class: 'tb ghost sm', disabled: locked || null, title: 'ctrl+L', onclick: () => detachSound(c.id) }, 'Dissocier le son')
      : el('span', { class: 'lbl' }, it.audio ? 'son dissocié' : 'vidéo sans son'));
  }
  head.append(acts);
  cards.push(head);

  // les effets (une piste vidéo), puis les fondus
  if (track.kind === 'video') cards.push(fxCard(ownerOf('c:' + c.id), locked));
  cards.push(fadeCard(c, track, locked));

  // le son
  const sound = track.kind === 'audio' || (c.kind === 'video' && c.audio);
  if (c.kind !== 'image') {
    const snd = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Son')));
    if (sound) {
      snd.append(slider({ label: 'volume', min: 0, max: 2, step: 0.01, value: c.vol ?? 1, fmt: (v) => `${Math.round(v * 100)} %`, color: 'var(--grn2)', disabled: locked,
        apply: set((x, v) => { x.vol = v; }) }),
      el('div', { class: 'row' }, el('span', { class: 'lbl' }, dB(c.vol ?? 1)), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', disabled: locked || null, onclick: () => commit('volume à 100 %', (p) => { M.byId(p, c.id).vol = 1; }) }, '100 %')));
      if (!M.audibleTracks(S.p).has(track.id)) snd.append(el('p', { class: 'why' }, `${track.id} ne s’entend pas (muette ou solo)`));
    } else snd.append(el('p', { class: 'lbl' }, it.audio ? 'son dissocié' : 'sans son'));
    cards.push(snd);
  }

  return cards;
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
      el('dt', {}, 'pistes'), el('dd', {}, `${S.p.tracks.filter((t) => t.kind === 'video').length} vidéo · ${S.p.tracks.filter((t) => t.kind === 'audio').length} son${S.p.tracks.some((t) => t.kind === 'fx') ? ` · ${S.p.tracks.filter((t) => t.kind === 'fx').length} calque` : ''}`),
      el('dt', {}, 'sortie'), el('dd', {}, `${st.width}×${st.height} · ${st.fps} i/s · BT.709`)),
    el('span', { class: 'lbl' }, 'format'), fmtOpts,
    el('span', { class: 'lbl' }, 'cadence'), fpsOpts,
    slider({ label: 'image fixe', min: 0.5, max: 20, step: 0.5, value: st.still, fmt: (v) => M.short(v), title: 'durée d’une image posée',
      apply: (v) => { S.p.settings.still = v; } })));
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
  }
  cards.push(seq);
  // l'export
  const ex = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('span', { class: 't' }, 'Exports'),
    el('span', { class: 'lbl' }, dur ? `${M.short(dur)} à rendre` : '')));
  if (S.exportJob) ex.append(exportMeter(S.exportJob));
  const mine = S.exports;
  ex.append(mine.length ? el('div', { class: 'exports' }, ...mine.slice(0, 6).map((it) => el('div', { class: 'exp', title: it.title },
    el('span', { class: 'th', style: it.thumb_url ? { backgroundImage: `url("${href(it.thumb_url)}")` } : null }),
    el('div', { style: { minWidth: 0 } }, el('b', {}, it.title), el('small', {}, `${M.short(it.duration || 0)} · ${it.width}×${it.height} · ${fmtDate(it.created)}`)),
    el('div', { class: 'row' }, el('button', { class: 'tb ghost sm', onclick: () => openSource(it) }, 'Voir'),
      el('a', { class: 'tb ghost sm', href: href(it.url), download: `${it.title}.mp4`, title: 'télécharger' }, '↓')))))
    : el('p', { class: 'lbl' }, 'aucun export'));
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
  const missing = S.p.clips.filter((c) => M.isOn(c) && c.kind !== 'adjust' && !itemOf(c.item));
  const lutGone = S.p.clips.filter((c) => M.isOn(c) && S.luts.length && M.chainOf(S.p, c).some((x) => x.type === 'lut' && !lutMeta(x.lut)));
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
    hidden.length || deaf.length ? el('p', { class: 'lbl' }, `sans ${[...hidden, ...deaf].join(', ')}`) : null,
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
    toast(`export fini${done.machine ? ` sur ${done.machine}` : ''} : ${done.result && done.result.note ? done.result.note : ''}`, 5000);
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
    title: `${t.fr} (${t.en}) · ${t.key}`, html: svg(t.d), onclick: () => setTool(t.id) })));
}

function setTool(t) {
  if (S.tool === t) return;
  S.tool = t;
  paintTools();
  timeline.root.dataset.tool = t;
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
  $('#b-del').title = hasSel || S.gap ? 'Suppr' : 'rien de choisi';
  const exp = $('#b-export');
  exp.disabled = !S.p.clips.length;
  exp.title = S.p.clips.length ? 'MP4 dans la bibliothèque · ctrl+M' : 'rien à exporter';
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
    ['LA MOLETTE (TOUTES LES TIMELINES)', ''],
    ...MOLETTE,
    ['EFFETS', ''],
    ['glisser un effet', 'sur un plan · sur l’en-tête d’une piste ou d’un groupe · sur la règle : un calque d’effet'],
    ['maj + lâcher une LUT', 'l’ajouter au lieu de remplacer celle du plan'],
    ['ctrl + C · ctrl + V', 'dans la liste d’effets : copier, coller'],
    ['ctrl + alt + V', 'coller les effets sur les plans choisis'],
    ['PISTES', ''],
    ['glisser un en-tête', 'entre deux pistes : la déplacer · sur une piste : un groupe'],
    ['coin haut d’un plan', 'poignée de fondu'],
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

// Les effets d'une liste, dans un menu : les activer ou les retirer, coller, tout retirer.
function fxItems(owner, locked) {
  const list = owner.list(S.p) || [];
  const lk = locked ? { disabled: true, why: 'piste verrouillée' } : {};
  return [
    ...list.map((f) => ({ label: fxName(f), checked: f.on !== false, ...lk, onclick: () => editFx(owner, 'activer un effet', (l) => { const x = l.find((y) => y.id === f.id); if (x) x.on = x.on === false; }) })),
    list.length ? '-' : null,
    { label: 'Copier les effets', disabled: !list.length, why: 'aucun effet', onclick: () => copyFx(owner) },
    { label: 'Coller les effets', key: 'Ctrl+Alt+V', ...(!(S.fxClip && S.fxClip.length) ? { disabled: true, why: 'aucun effet copié' } : lk), onclick: () => pasteFx(owner.key.startsWith('c:') && S.sel.size > 1 ? [...S.sel].map((x) => 'c:' + x) : [owner.key]) },
    { label: 'Retirer tous les effets', danger: true, ...(!list.length ? { disabled: true, why: 'aucun effet' } : lk), onclick: () => editFx(owner, 'retirer les effets', (l) => l.splice(0, l.length)) },
  ];
}

function trackMenu(tid) {
  const t = M.trackOf(S.p, tid);
  if (!t) return null;
  const kindFr = t.kind === 'video' ? 'vidéo' : t.kind === 'fx' ? 'de calques' : 'son';
  const other = t.kind === 'audio' ? 'video' : 'audio';
  const nClips = S.p.clips.filter((c) => c.track === tid).length;
  const last = t.kind !== 'fx' && S.p.tracks.filter((x) => x.kind === t.kind).length <= 1;
  const full = S.p.tracks.filter((x) => x.kind === t.kind).length >= M.MAX_TRACKS;
  const g = t.grp ? M.groupOf(S.p, t.grp) : null;
  const same = S.p.tracks.filter((x) => x.id !== tid && M.family(x.kind) === M.family(t.kind));
  const i = S.p.tracks.findIndex((x) => x.id === tid);
  const up = S.p.tracks[i - 1], down = S.p.tracks[i + 1];
  return [
    { head: `Piste ${tid}${t.name ? ' · ' + t.name : ''}` },
    { label: `Ajouter une piste ${kindFr} au-dessus`, icon: '+', disabled: full, why: `${M.MAX_TRACKS} pistes au plus`, onclick: () => addTrack(t.kind, tid, 'above') },
    { label: `Ajouter une piste ${kindFr} au-dessous`, icon: '+', disabled: full, why: `${M.MAX_TRACKS} pistes au plus`, onclick: () => addTrack(t.kind, tid, 'below') },
    { label: `Ajouter une piste ${other === 'video' ? 'vidéo (en haut)' : 'son (en bas)'}`, icon: '+', onclick: () => addTrack(other, null, other === 'video' ? 'above' : 'below') },
    '-',
    { label: 'Renommer la piste…', onclick: () => renameTrack(tid) },
    t.kind !== 'fx' ? { label: 'En faire la piste cible', checked: S.target[t.kind] === tid, onclick: () => { S.target[t.kind] = tid; timeline.render(); } } : null,
    { label: 'Choisir tous ses plans', disabled: !nClips, why: 'la piste est vide', onclick: () => select(new Set(S.p.clips.filter((c) => c.track === tid).map((c) => c.id))) },
    t.kind === 'video' ? { label: 'Effets de la piste', items: fxItems(ownerOf('t:' + tid), t.lock) } : null,
    '-',
    { label: 'Monter', disabled: !up || M.family(up.kind) !== M.family(t.kind), why: 'déjà en haut', onclick: () => moveTracks([tid], up.id, 'avant') },
    { label: 'Descendre', disabled: !down || M.family(down.kind) !== M.family(t.kind), why: 'déjà en bas', onclick: () => moveTracks([tid], down.id, 'apres') },
    g ? { label: `Sortir du groupe « ${g.name} »`, onclick: () => leaveGroup(tid) }
      : { label: 'Grouper avec…', disabled: !same.length, why: 'aucune autre piste de cette famille', items: same.map((x) => ({ label: `${x.id}${x.name ? ' · ' + x.name : ''}`, onclick: () => groupTracks([tid], x.id) })) },
    '-',
    { label: 'Verrouiller', checked: t.lock, onclick: () => timeline.app.toggleTrack(tid, 'lock', 'verrouiller une piste') },
    t.kind !== 'audio' ? { label: t.kind === 'fx' ? 'Couper les calques' : 'Masquer', checked: t.hide, onclick: () => timeline.app.toggleTrack(tid, 'hide', 'masquer une piste') } : null,
    t.kind !== 'fx' ? { label: 'Muette', checked: t.mute, onclick: () => timeline.app.toggleTrack(tid, 'mute', 'couper une piste') } : null,
    t.kind !== 'fx' ? { label: 'Solo', checked: t.solo, onclick: () => timeline.app.toggleTrack(tid, 'solo', 'solo') } : null,
    '-',
    { label: 'Supprimer la piste', danger: true, disabled: last, why: `il faut au moins une piste ${kindFr}`, sub: nClips ? `${nClips} plan${nClips > 1 ? 's' : ''}` : '', onclick: () => deleteTrack(tid) },
  ];
}

function groupMenu(gid) {
  const g = M.groupOf(S.p, gid);
  if (!g) return null;
  const members = S.p.tracks.filter((t) => t.grp === gid);
  const img = members.some((t) => t.kind !== 'audio');
  return [
    { head: `Groupe · ${g.name}` },
    { label: 'Renommer…', sub: 'double-clic', onclick: () => renameGroup(gid) },
    { label: 'Choisir ses plans', onclick: () => select(new Set(S.p.clips.filter((c) => members.some((t) => t.id === c.track)).map((c) => c.id))) },
    img ? { label: 'Effets du groupe', items: fxItems(ownerOf('g:' + gid), false) } : null,
    '-',
    { label: 'Défaire le groupe', sub: 'les pistes restent', onclick: () => ungroupTracks(gid) },
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
    { label: 'Vitesse/Durée…', key: K.speed, ...(M.still(c) ? { disabled: true, why: 'pas de vitesse : étirez-le' } : lk), onclick: () => speedModal(id) },
    t.kind === 'video' || c.kind === 'adjust' ? { label: 'Effets', items: fxItems(ownerOf('c:' + id), t.lock) } : null,
    { label: 'Activer', key: K.enable, checked: M.isOn(c), ...lk, onclick: () => toggleEnabled(ids) },
    t.kind === 'video' ? { label: 'Fondu enchaîné à l’entrée', key: K.xfade, ...(!prevClip(S.p, c) ? { disabled: true, why: 'pas de plan collé avant' } : lk), onclick: () => dissolve(id) } : null,
    { label: 'Fondus', items: [
      { label: 'Fondu d’entrée (1 s)', ...lk, onclick: () => dropFade(id, 'l', false) },
      { label: 'Fondu de sortie (1 s)', ...lk, onclick: () => dropFade(id, 'r', false) },
      { label: 'Sans fondu', ...lk, onclick: () => commit('sans fondu', (p) => { const x = M.byId(p, id); x.fade_in = 0; x.fade_out = 0; }) },
    ] },
    c.kind === 'video' && t.kind === 'video' ? { label: 'Dissocier le son', key: K.unlink, ...(!c.audio ? { disabled: true, why: it.audio ? 'déjà dissocié' : 'sans son' } : lk), onclick: () => detachSound(id) } : null,
    '-',
    c.kind !== 'adjust' ? { label: 'Ouvrir dans le moniteur source', sub: 'double-clic', disabled: !!it.missing, why: 'introuvable', onclick: () => openClipInSource(id) } : null,
    c.kind !== 'adjust' ? { label: 'Concordance des images', key: K.match, ...(!inPh ? { disabled: true, why: 'la tête de lecture n’est pas dans ce plan' } : {}), onclick: matchFrame } : null,
    { label: c.kind === 'adjust' ? 'Renommer le calque…' : 'Renommer le plan…', onclick: () => renameClip(id) },
    c.kind !== 'adjust' ? { label: 'Révéler dans le chutier', onclick: () => revealInBin(c.item) } : null,
    c.kind !== 'adjust' ? { label: 'Révéler dans Asset', sub: '↗', onclick: () => revealInAsset(c.item) } : null,
    ...(EL.items(c).length ? ['-', ...EL.items(c)] : []),   // éléments : mettre à jour, les versions, la source
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
  const gr = e.target.closest('.tl-grp');
  if (gr) return groupMenu(gr.dataset.grp);
  const hd = e.target.closest('.tl-lanes .tl-hd');
  if (hd) return trackMenu(hd.dataset.head);
  const clip = e.target.closest('.clip');
  if (clip) return clipMenu(clip.dataset.id, f);
  const lane = e.target.closest('.tl-lane');
  if (lane) return laneMenu(lane.dataset.track, f);
  return null;
}

// une LUT du panneau Effets : poser, favori, renommer, dire l'image attendue, supprimer
function fxPaneMenu(e) {
  const t = e.target.closest('.fxi.lut');
  if (!t) return [{ head: 'Effets' }, { label: 'Importer une LUT…', icon: '+', onclick: () => importLutModal() }, '-', F.entree('src')];
  const m = lutMeta(t.dataset.lut);
  if (!m) return null;
  const edit = async (patch) => {
    try { await api(`montage/luts/${m.id}`, { method: 'POST', body: patch }); await loadLuts(); }
    catch (er) { toast(er.status === 403 ? 'LUT d’un autre : seul son auteur (ou Cal) la change' : er.message); }
  };
  const users = S.p ? S.p.clips.filter((c) => M.chainOf(S.p, c).some((x) => x.type === 'lut' && x.lut === m.id)).length : 0;
  return [
    { head: `LUT · ${m.title}` },
    { label: 'Poser sur ce qui est choisi', sub: 'double-clic', onclick: () => applyToSelection({ type: 'lut', lut: m.id, title: m.title }) },
    '-',
    { label: 'Favori', checked: m.fav > 0, sub: m.fav ? `n° ${m.fav}` : '', onclick: () => edit({ fav: !(m.fav > 0) }) },
    { label: 'Renommer…', onclick: async () => { const v = await askName('Renommer la LUT', m.title, 'Renommer', { placeholder: 'le nom de la LUT', max: 80 }); if (v) edit({ title: v }); } },
    { label: 'Changer de famille…', sub: m.family, onclick: async () => { const v = await askName('Famille de la LUT', m.family, 'Ranger', { placeholder: 'la famille sur l’étagère', max: 60 }); if (v) edit({ family: v }); } },
    { label: 'L’image qu’elle attend', items: (S.meta.lut_inputs || []).map((x) => ({ label: x.label, checked: m.input === x.id, onclick: () => edit({ input: x.id }) })) },
    { label: `${m.kind.toUpperCase()} ${m.size}${m.source ? ' · ' + m.source : ''}`, disabled: true, why: 'la taille de la grille et le fichier d’origine' },
    '-',
    { label: 'Supprimer de la bibliothèque', danger: true, sub: users ? `${users} plan${users > 1 ? 's' : ''} ici` : '', onclick: async () => {
      if (!(await confirmBox('Supprimer la LUT', `« ${m.title} » part à la corbeille des LUT${users ? ` ; ${users} plan${users > 1 ? 's' : ''} la ${users > 1 ? 'portent' : 'porte'} encore` : ''}.`, 'Supprimer'))) return;
      try { await api(`montage/luts/${m.id}/delete`, { method: 'POST' }); await loadLuts(); paintInspector(); } catch (er) { toast(er.message); }
    } },
  ];
}

function sourceMenu() {
  const it = source.item;
  const media = it && it.kind !== 'image';
  const np = S.p ? {} : noProject;
  if (S.srcTab === 'fx') return null;
  const none = { disabled: true, why: 'double-cliquez un plan du Projet' };
  if (!it) return [{ head: 'Source' }, { label: 'Aucun plan', ...none }, '-', F.entree('src')];
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
    '-',
    F.entree('src'),
  ];
}

function programMenu() {
  if (!S.p) return [{ head: 'Programme' }, { label: 'Ouvrir un montage', onclick: projectsModal }, '-', F.entree('prg')];
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
    '-',
    F.entree('prg'),
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
  // la liste d'effets de l'inspecteur a le clavier (on y a cliqué) : copier, coller, retirer
  const fxOwner = S.fxFocus ? ownerOf(S.fxFocus) : null;
  if (fxOwner && !alt) {
    if (ctrl && low === 'c') { e.preventDefault(); copyFx(fxOwner); return; }
    if (ctrl && low === 'v') { e.preventDefault(); pasteFx([fxOwner.key]); return; }
    if ((k === 'Delete' || k === 'Backspace') && S.fxSel.size) { e.preventDefault(); removeFx(fxOwner, [...S.fxSel]); return; }
    if (ctrl && low === 'a') { e.preventDefault(); S.fxSel = new Set((fxOwner.list(S.p) || []).map((x) => x.id)); paintInspector(); return; }
  }
  // Premiere « Coller les attributs » (ctrl+alt+V) : les effets copiés, sur ce qui est choisi
  if (ctrl && alt && low === 'v') { e.preventDefault(); pasteFx(pasteKeys()); return; }
  if (ctrl && alt) {
    if (low === 'm') { e.preventDefault(); if (sh) commit('effacer les marques', (p) => { p.markers = []; }); else { const m = markerAt(ph); if (m) commit('effacer la marque', (p) => { p.markers = p.markers.filter((x) => x.id !== m.id); }); else toast('pas de marque sous la tête de lecture', 1400); } return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); slipKey((k === 'ArrowLeft' ? -1 : 1) * (sh ? 5 : 1)); return; }
    return;
  }
  if (ctrl) {
    if (low === 'k') { e.preventDefault(); cutAtPlayhead(sh); }
    else if (low === 'd') { e.preventDefault(); dissolve(S.sel.size === 1 ? [...S.sel][0] : null); }
    else if (low === 'c') { if (S.sel.size) { e.preventDefault(); copySel(); } else if (S.selTrack) { e.preventDefault(); copyFx(inspectorOwner()); } }
    else if (low === 'v') {
      e.preventDefault();
      // des effets copiés en dernier, et une piste, un groupe ou des plans choisis : on colle les effets
      if (S.lastCopy === 'fx' && !sh && (S.selTrack || S.sel.size)) pasteFx(pasteKeys()); else paste(sh);
    }
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

// ── les panneaux dans une fenêtre (commun/fenetre.js ; docs/etudes/fenetres.md) ──
// Les quatre panneaux du haut, dans l'ordre de la rangée, avec leurs tailles
// de commun/split.js. Un panneau détaché sort de la rangée : la rangée se
// refait sans lui (ses tailles gardées à part : 'montage-cols-sans-prg'…) et
// le reprend à sa place quand il revient (fenêtre fermée, « Rattacher »).
const COLS = [
  { id: 'bin', sel: '.bin', title: 'Projet', size: 236, min: 170 },
  { id: 'src', sel: '#src', title: 'Source · Effets', grow: 1, min: 220 },
  { id: 'prg', sel: '#prg', title: 'Programme', grow: 1.2, min: 240 },
  { id: 'insp', sel: '#inspw', title: 'Inspecteur', size: 286, min: 230 },
];
const rerender = () => { if (S.p) timeline.render(); };
let cols = null;
function relayout() {
  const top = document.querySelector('.mtg-top');
  if (!top || !COLS[0].node) return;
  if (cols) for (const g of cols.gutters) g.remove();
  const stay = COLS.filter((c) => !F.detache(c.id));
  const gone = COLS.filter((c) => F.detache(c.id)).map((c) => c.id);
  // plus aucun panneau souple : ceux qui restent se partagent la place
  const soft = stay.some((c) => c.grow);
  cols = split(top, stay.map((c) => (soft ? { el: c.node, size: c.size, grow: c.grow, min: c.min } : { el: c.node, grow: 1, min: c.min })),
    { axis: 'x', key: 'montage-cols' + (gone.length ? '-sans-' + gone.join('-') : ''), onresize: rerender });
  top.style.display = stay.length ? '' : 'none';
  // l'horloge du programme bat dans la fenêtre qui le montre (player.js, schedule)
  program.moved();
  source.moved();
  rerender();
}

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
  $('#z-in').title = `zoomer · =\n${MOLETTE_AIDE}`;           // la molette commune (commun/molette.js)
  $('#z-out').onclick = () => timeline.zoom(0.8);
  $('#z-fit').onclick = () => timeline.fit();
  timeline.scroll.addEventListener('scroll', saveView);
  $('#safe').hidden = !S.safe;

  // les panneaux se redimensionnent (commun/split.js) ; la timeline suit sa largeur.
  // Chacun des quatre du haut se détache dans une fenêtre (commun/fenetre.js) :
  // la rangée se refait sans lui (relayout), et le reprend quand il revient.
  for (const c of COLS) {
    c.node = $(c.sel);
    F.panneau(c.id, { node: c.node, title: c.title });
  }
  $('#bin-up').after(F.bouton('bin'));
  $('#src .mon-head').append(F.bouton('src'));
  $('#prg .mon-head').append(F.bouton('prg'));
  $('#insp-head').append(F.bouton('insp'));
  $('#fen-pills').replaceWith(F.pastilles());
  relayout();
  split($('#mtg'), [
    { el: $('.mtg-top'), grow: 1, min: 220 },
    { el: $('.tlw'), grow: 0.82, min: 190 },
  ], { axis: 'y', key: 'montage-rows', onresize: rerender });
  new ResizeObserver(() => rerender()).observe(timeline.scroll);

  // le clic droit, partout (commun/menu.js)
  contextMenu($('#tl'), timelineMenu);         // (le panneau Projet a le sien : projet.js)
  contextMenu($('#fx-pane'), fxPaneMenu);
  contextMenu($('#src'), sourceMenu);
  contextMenu($('#prg'), programMenu);
  contextMenu($('#seq-tabs'), seqTabMenu);
  // les effets se lâchent sur la timeline (effets.js) ; les pistes se glissent par leur en-tête (pistes.js)
  bindEffectDrops(timeline, { fxDrag: () => S.fxDrag, setFxDrag: (d) => { S.fxDrag = d; }, dropEffect });
  bindTrackDrag(timeline, { selectTrack, moveTracks, groupTracks });
  // le panneau Source : ses deux onglets, Effets au départ
  for (const b of $$('#src-tabs [data-tab]')) b.onclick = () => srcTab(b.dataset.tab);
  srcTab('fx');
  // ailleurs (la barre, les outils, les poignées) : les gestes de la séquence, en tête du menu
  // commun de repli (commun/menu.js, pageMenu) — le navigateur n'a jamais le clic droit (Cal, 29/09)
  pageMenu(() => (!S.p ? [{ head: 'Montage' }, { label: 'Nouvelle séquence…', icon: '+', onclick: () => newProjectFlow() }, { label: 'Ouvrir une séquence…', icon: '▤', onclick: projectsModal }]
    : [{ head: `séquence · ${S.p.name}` },
      { label: 'Exporter en MP4…', icon: '↓', key: 'Ctrl+M', disabled: !S.p.clips.length, why: 'rien à exporter', onclick: exportModal },
      { label: 'Nouvelle séquence…', icon: '+', onclick: () => newProjectFlow() },
      { label: 'Ouvrir une séquence…', icon: '▤', onclick: projectsModal },
      { label: 'La voir dans Asset', icon: '▦', onclick: () => { location.href = href('asset/#' + S.p.id); } },
      '-',
      { label: 'Aimant', checked: !!S.snap, onclick: () => $('#b-snap')?.click() },
      { label: 'Les raccourcis', icon: '?', onclick: helpModal },
      '-',
      { head: 'fenêtres · 2ᵉ écran' },
      ...COLS.map((c) => F.entree(c.id))]));

  // moniteurs : le clic donne le clavier
  $('#src').addEventListener('pointerdown', () => { if (S.srcTab === 'src') focus('source'); });
  $('#prg').addEventListener('pointerdown', () => focus('program'));
  $('#s-play').onclick = () => { S.shuttle = 0; source.toggle(); };
  $('#s-prev').onclick = () => source.step(-1);
  $('#s-next').onclick = () => source.step(1);
  $('#s-in').onclick = () => source.markIn();
  $('#s-out').onclick = () => source.markOut();
  $('#s-insert').onclick = () => fromSource('insert');
  $('#s-over').onclick = () => fromSource('overwrite');
  scrubber($('#src-scrub'), (u) => source.seek(u * source.duration), (on) => source.scrub(on));
  scrubber($('#prg-scrub'), (u) => program.seek(u * program.duration()), (on) => program.scrub(on));
  $('#src-screen').addEventListener('dragstart', (e) => {
    const it = source.item;
    if (!it) { e.preventDefault(); return; }
    startDrag(e, it, it.kind === 'image' ? 0 : source.in, it.kind === 'image' ? 0 : source.out);
  });
  $('#src-screen').addEventListener('dragend', () => { S.dragging = null; });

  // le panneau Projet (projet.js) : importer ; un import dans l'onglet d'un dossier s'y range
  $('#bin-up').onclick = () => $('#bin-file').click();
  $('#bin-file').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    await uploadMany(files, { bin: project.state.tab || '' });
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
  // le Projet reçoit lui-même (projet.js, « déposer ») : l'objet y entre, à la racine ou dans le dossier
  // visé — il ne s'ouvre plus dans la source (Cal, 30/09) ; déclaré au panneau Asset pour ses filtres
  declareZone(bin, { kinds: [...MEDIA, 'sequence', 'element'], label: 'le Projet' });
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

// la barre sous un moniteur : cliquer, glisser = la tête ; `geste(on)` : le geste commence, finit
// (pendant, la copie de défilement reste devant : player.js)
function scrubber(bar, go, geste = () => {}) {
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const a = document.activeElement;
    if (a && a !== document.body && a.blur) a.blur();
    const r = bar.getBoundingClientRect();
    const at = (ev) => go(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)));
    geste(true);
    at(e);
    try { bar.setPointerCapture(e.pointerId); } catch { /* */ }
    const mv = (ev) => at(ev);
    const up = () => {
      bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up);
      geste(false);
    };
    bar.addEventListener('pointermove', mv);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });
}

// ── le panneau Asset commun (commun/dock.js, docs/etudes/panneau_asset.md) ──
// Le Projet (le chutier) reste le panneau du montage : Premiere garde son panneau Projet à côté
// de ses Bibliothèques (décision 9 de l'étude). Le panneau Asset, à gauche (Ctrl+Espace), fermé
// au premier passage, sert à toute la bibliothèque : les éléments, les récents, les favoris.
//   - glisser pose là où l'on lâche : la timeline (timeline.js, au point du dépôt ; Ctrl : insérer),
//     le programme (au bout de la piste cible), la source, le Projet ;
//   - double-clic, Entrée : à la tête de lecture, sur les pistes cibles (écraser), à la suite ;
//     une séquence : l'ouvrir ; un élément : sa dernière version (placeItem) ;
//   - le clic droit : la source, insérer, au bout de la piste cible ;
//   - la piste choisie (son en-tête) fait les filtres : V → vidéos, images ; A → sons.
const PANNEAU_KINDS = ['video', 'image', 'audio', 'sequence', 'element'];
// la place que la page garde : le Projet, les effets, le programme, l'inspecteur, lisibles
const PANNEAU_GARDE = 980;
async function headOf(it) {
  if (it?.kind !== 'element' || !it.element?.head_item) return it;
  try { return await api('library/' + it.element.head_item); } catch { return it; }
}
async function poserIci(items, mode = 'overwrite') {
  const seqs = items.filter((it) => it.kind === 'sequence');
  if (seqs.length && seqs.length === items.length) { await openProject(seqs[0].id); return true; }
  if (!S.p) { toast('ouvrez d’abord une séquence : Séquences, ou double-clic sur une séquence du panneau'); return false; }
  let at = program.frame(), n = 0;
  for (const it of items) {
    if (it.kind === 'sequence') continue;
    const c = await placeItem({ id: it.id, in: 0, out: it.duration || 0 }, it.kind === 'audio' ? S.target.audio : S.target.video, at, mode);
    if (c) { at = M.clipEnd(c); n++; }
  }
  return n > 0;
}
function suivrePanneau() {
  const tid = S.p && S.selTrack && !S.selTrack.startsWith('g:') ? S.selTrack : null;
  const k = tid ? M.trackKind(tid) : null;
  if (k === 'video') dock.contexte({ kinds: ['video', 'image'], label: `piste ${tid}` });
  else if (k === 'audio') dock.contexte({ kinds: ['audio'], label: `piste ${tid}` });
  else if (k === 'fx') dock.contexte({ kinds: [], label: `piste ${tid}`, why: 'un calque d’effets ne prend pas d’asset' });
  else dock.contexte(null);
}
function branchePanneau() {
  dock.configure({
    kinds: PANNEAU_KINDS,
    dockMin: PANNEAU_GARDE,
    placeLabel: 'Poser à la tête de lecture',
    hint: 'glisser sur la timeline, le programme ou le Projet · double-clic : à la tête de lecture',
    place: (items) => poserIci(items),
    menu: (it, chosen) => {
      const media = chosen.filter((x) => x.kind !== 'sequence');
      return [
        !media.length ? null : { label: 'Insérer à la tête de lecture', sub: 'ctrl au dépôt', onclick: () => poserIci(media, 'insert') },
        chosen.length === 1 && it.kind !== 'sequence' ? { label: 'Au bout de la piste cible', onclick: async () => { const v = await headOf(it); if (v) appendItem(v.id); } } : null,
        chosen.length === 1 && it.kind !== 'sequence' ? { label: 'Ouvrir dans le moniteur source', onclick: async () => { const v = await headOf(it); if (v && ['video', 'image', 'audio'].includes(v.kind)) openSource(v); else toast('seulement une vidéo, une image ou un son'); } } : null,
        chosen.length === 1 && it.kind === 'sequence' ? { label: 'Ouvrir la séquence', onclick: () => openProject(it.id) } : null,
      ];
    },
  });
  // la timeline a son propre dépôt (timeline.js) : elle le dit au panneau
  declareZone($('#tl'), { kinds: ['video', 'image', 'audio', 'element'], label: 'la timeline' });
}

// ── le départ ───────────────────────────────────────────────
async function start() {
  branchePanneau();
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
window.montage = { S, F, EL, program, timeline, source, M, commit, placeItem, openProject, flushSave, setTool, lutGL, getLut, loadLuts, focus, select, project, closeSeqTab, undo, redo,
  effects, dropEffect, selectTrack, moveTracks, groupTracks, ungroupTracks, leaveGroup, copyFx, pasteFx, ownerOf, srcTab, openSource, paintInspector,
  undoLabels: () => ({ done: U.done.map((e) => e.label), undone: U.undone.map((e) => e.label), name: U.name }) };
