// ODIO — la génération par région : la piste générative, sa région, le
// panneau du bas, les prises.
//
// Une piste générative est une piste audio (`kind: 'audio'`) qui porte
// `gen: { model, task }` : elle joue, se mixe, s'exporte et se sépare comme
// les autres ; ce qui change est qu'on y DESSINE une région (tirer sur le
// vide de sa voie). La région est un clip audio qui porte `gen` :
//   gen.model, gen.task     ACE-Step 1.5 (une piste, morceau, compléter,
//                           repeindre, variation, isoler) ou YuE2 (chanson,
//                           reprise) — les tâches du schéma
//   gen.v                   les réglages de la tâche (generatif_modeles.json)
//   gen.ctx                 les pistes de « ce qui joue autour » (null : toutes)
//   gen.takes, gen.take     les prises reçues, celle qui joue (le clip porte
//                           alors son `item` et son `off`, comme tout clip audio)
// « Garder la prise » retire `gen` : la région devient un clip audio ordinaire.
//
// Le panneau du bas (la vue de détail, onglet Clip) se dessine depuis le
// schéma : ce que le modèle prend, ses bornes, ses défauts, ses sources ; ce
// qu'il n'a pas, désactivé avec la raison. Ce qui vient du projet (tempo,
// mesure, tonalité, bornes, sections, ce qui joue autour) est lu dans la
// session, et recalculé par le serveur (server/tools/music_gen.py).
//
// Les travaux : `music.gen.ace`, `music.gen.yue` (les prises), `music.yue.abc`
// (la partition seule), `music.midi` (generatif_midi.js). Leur retour passe
// par genJobDone, appelé par la file de musique.js (P.pending).

import { api, jobs, toast, href, uploadFile, pick, ITEM_MIME } from '../commun/shell.js';
import { TRACK_KINDS, keyLabel, MODES } from './modules.js';
import { renderMix, wav24 } from './moteur.js';
import { el, put, menu, tok, inlineEdit } from './ui.js';
import { loadSchema, schemaNow, model, task, firstTask, cond, defaultsFor, requestV, unavailable, trackFr, aceKeyOf, secs,
  choiceIds, choiceLabel } from './generatif_modeles.js';
import { writeAbc, sectionsOf, reportVoices, skyline, chordsFromNotes, chordToNotes, abcKey } from './generatif_abc.js';
import { openExtract, midiDone, placeNotes, clipNotes, listMidi, midiSub } from './generatif_midi.js';

// les styles du génératif, à part de musique.css
{
  const u = new URL('./generatif.css', import.meta.url).href;
  if (!document.querySelector(`link[data-gen-css]`)) document.head.append(el('link', { rel: 'stylesheet', href: u, 'data-gen-css': '' }));
}
loadSchema();

export const GEN_KINDS = new Set(['takes', 'abc', 'midi']);
export const isGenTrack = (t) => !!t?.gen && t.kind === 'audio';
export const isRegion = (c) => !!c?.gen;
let target = null;                              // la dernière région montrée dans le panneau
export const genTarget = (app) => (target && app.clip(target)?.gen ? app.clip(target) : null);
// le jugement d'abc_tools sur la partition d'une région, gardé hors du projet
// (le rapport peut être long) et valable tant que le texte ne change pas
const checks = new Map();
const lastCheck = (c) => { const x = checks.get(c.id); return x && x.abc === (c.gen?.v?.abc || '') ? x.r : undefined; };
const setCheck = (c, r) => checks.set(c.id, { abc: c.gen?.v?.abc || '', r });

// L'empreinte des entrées d'une prise (le canon d'ODIO_01, etude-hub § 2.9 :
// « une branche périmée le sait ») : le modèle, la tâche, les réglages, le
// tempo, la mesure, la tonalité, les bornes de la région. Une prise dont
// l'empreinte n'est plus celle de la région reste jouable, et le dit.
function fingerprint(app, c) {
  const P = app.S.proj, g = c.gen, v = { ...g.v };
  delete v.n; delete v.seed;                                  // une prise de plus ou une autre graine ne la périme pas
  const ctxTask = task(schemaNow(), g.model, g.task)?.sortie === 'contexte';      // le contexte dépend aussi de la place de la région
  const s = JSON.stringify([g.model, g.task, v, g.ctx || null, P.bpm, P.sig, P.key, c.len, ctxTask ? c.start : null]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const stale = (app, c, tk) => tk.fp && tk.fp !== fingerprint(app, c);

// l'état des moteurs (music_gen.py : factice, réel, câblé ou non)
let eng = null, engT = 0;
async function engines() {
  if (!eng || Date.now() - engT > 30000) {
    try { eng = await api('music/gen/engines'); engT = Date.now(); } catch (e) { eng = { error: e.message, engines: {} }; }
  }
  return eng;
}
engines();

// ── la piste générative ─────────────────────────────────────
export function genTrackChoices(app) {
  const s = schemaNow();
  return [{ head: 'générative : dessiner une région, le modèle la remplit' },
    { label: 'Générative · ACE-Step 1.5', sub: 'une piste, morceau, repeindre', dot: 'coral-1', onclick: () => addGenTrack(app, 'ace') },
    { label: 'Générative · YuE2', sub: s ? 'chanson, partition' : '', dot: 'coral-3', onclick: () => addGenTrack(app, 'yue') }];
}
export async function addGenTrack(app, mid, { at } = {}) {
  const s = await loadSchema(), P = app.S.proj;
  const n = P.tracks.filter(isGenTrack).length + 1;
  const tid = mid === 'ace' ? 'lego' : firstTask(s, mid);
  const t = app.addTrack('audio', { name: `Génératif ${n}`, color: mid === 'ace' ? 'coral-1' : 'coral-3', sub: `générative · ${model(s, mid).nom}`, at });
  t.gen = { model: mid, task: tid };
  app.commit('graph');
  toast('piste générative : tirer sur sa voie dessine une région · le panneau du bas la règle', 5000);
  return t;
}

// une région neuve, dessinée sur la voie
export async function newRegion(app, t, a, b) {
  const s = await loadSchema(), P = app.S.proj;
  const mid = t.gen.model, tid = task(s, mid, t.gen.task) ? t.gen.task : firstTask(s, mid);
  const c = { id: app.uid('c'), track: t.id, start: a, len: b - a, off: 0,
    gen: { model: mid, task: tid, v: defaultsFor(s, mid, tid), takes: [], take: null, ctx: null } };
  P.clips.push(c);
  app.selectClips([c.id], true);
  P.ui.detail = 'clip'; P.ui.dock = true;
  app.commit('data');
  return c;
}

// ── ce qui vient du projet ──────────────────────────────────
const regionBars = (P, c) => Math.max(1, Math.ceil(c.len / P.sig - 1e-9));
function covered(P, c) {
  const a = c.start, b = c.start + c.len, out = [];
  for (const s of [...P.sections].sort((x, y) => x.a - y.a)) {
    const lo = Math.max(a, s.a), hi = Math.min(b, s.b);
    if (hi > lo) out.push({ s, bars: Math.max(1, Math.round((hi - lo) / P.sig)) });
  }
  return out;
}
function sectionsFor(P, c) {
  const cov = covered(P, c).map((x) => [x.s.tag || 'verse', x.bars]);
  const need = regionBars(P, c), have = cov.reduce((k, x) => k + x[1], 0);
  if (!cov.length) return [['verse', need]];
  if (have < need) cov[cov.length - 1][1] += need - have;
  return cov;
}
// ce qui joue autour : les pistes (hors bus, hors la piste de la région) dont un clip non muet touche la fenêtre
function around(app, c, w0, w1) {
  const P = app.S.proj;
  return P.tracks.filter((t) => t.kind !== 'bus' && t.id !== c.track && !t.mute
    && P.clips.some((x) => x.track === t.id && !x.mute && x.start < w1 && x.start + x.len > w0 && (x.item || x.pat)));
}
function windowOf(P, c, marge) {
  const m = (marge ?? 2) * P.sig;
  return [Math.max(0, c.start - m), c.start + c.len + m];
}

// Le contexte : les pistes choisies, rendues hors temps réel sur la fenêtre
// (le même graphe que l'export), rangées dans la bibliothèque, envoyées
// comme src_audio ; le modèle rend cette durée exacte (inference.py:606-610).
async function renderContext(app, c, w0, w1, ids) {
  const P = app.S.proj, sel = new Set(ids);
  const sub = { ...P, clips: P.clips.filter((x) => sel.has(x.track) && !x.mute) };
  toast('rendu de ce qui joue autour…', 20000);
  const buf = await renderMix(app.engine, sub, w0, w1, { tail: 0 });
  const it = await uploadFile(new File([wav24(buf)], 'contexte.wav', { type: 'audio/wav' }),
    { tool: 'music', folder: 'Musique', title: `Contexte · ${c.name || 'région'} · ${app.bar(w0)} → ${app.bar(w1)}` });
  app.items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
  return it.id;
}

// ── les attracteurs sur la région ───────────────────────────
// Le banc (banc.js, un autre chantier) doit exposer une fonction qui dit les
// attracteurs actifs à un instant et ce qu'ils ramènent ; tant qu'elle
// n'existe pas, la case le dit. Ses segments, eux, sont dans le projet.
const ATT_FN = ['attracteursActifs', 'attracteursA', 'attracteurs', 'activeAttractors', 'attractorsAt'];
const LANE_FR = { ryt: 'RYTHME', har: 'HARMONIE', tim: 'TIMBRE', nrj: 'ÉNERGIE', ten: 'TENSION' };
async function attractors(app, a, b) {
  const P = app.S.proj;
  const segs = (P.banc?.segs || []).filter((sg) => sg.d < b && sg.d + sg.l > a);
  let fn = null, why = '';
  try { const m = await import('./banc.js'); fn = ATT_FN.map((k) => m[k]).find((f) => typeof f === 'function') || null; } catch (e) { why = e.message; }
  if (!fn) return { segs, items: null, why: why || 'banc.js n\'expose pas encore « les attracteurs actifs à un instant et ce qu\'ils ramènent » (le chantier du nodal) : rien à lire' };
  const items = [];
  for (const t of [a, (a + b) / 2, b - 1e-3]) {
    try { const r = await fn(app, t); if (Array.isArray(r)) for (const x of r) items.push({ ...x, t }); } catch (e) { why = `banc.js : ${e.message}`; }
  }
  return { segs, items, why };
}

// ── la file : les jobs de la région ─────────────────────────
jobs.watch((list) => {
  for (const n of document.querySelectorAll('[data-gen-job]')) {
    const j = list.find((x) => x.id === n.dataset.genJob);
    if (j) n.textContent = `${{ queued: 'en file', running: 'en cours' }[j.state] || j.state}${j.progress != null && j.state === 'running' ? ` · ${Math.round(j.progress * 100)} %` : ''}${j.message ? ` · ${j.message}` : ''}`.slice(0, 90);
  }
});

// Le retour d'un travail (musique.js, watchPending) : les prises dans leur
// région, la partition dans son éditeur, le MIDI sous son clip.
export async function genJobDone(app, pd, full) {
  const P = app.S.proj;
  if (pd.kind === 'midi') { await midiDone(app, pd, full); return; }
  const c = app.clip(pd.clip);
  if (!c?.gen) { toast(`la région a disparu : ${pd.kind === 'abc' ? 'la partition est perdue' : 'ses prises sont dans la bibliothèque (Musique)'}`, 6000); return; }
  if (pd.kind === 'abc') {
    c.gen.v = { ...c.gen.v, abc: full.result?.abc || '' };
    if (full.result?.check) setCheck(c, full.result.check);
    toast(`partition écrite${full.result?.engine === 'factice' ? ' (moteur d\'essai)' : ''} : relis-la, modifie-la, puis Générer`, 5000);
    app.commit('data');
    return;
  }
  const its = full.items || [];
  const fp = pd.fp || fingerprint(app, c);
  for (const it of its) {
    app.items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
    c.gen.takes.push({ item: it.id, job: pd.job, seed: it.params?.seed, k: c.gen.takes.length, engine: it.params?.engine, off: it.params?.region_off || 0, fp,
      model: it.params?.model, task: it.params?.task, score: it.params?.score ? it.params.score.slice(0, 60000) : undefined });
  }
  if (c.gen.take == null && c.gen.takes.length) chooseTake(app, c, c.gen.takes.length - its.length, true);
  toast(`${its.length} prise${its.length > 1 ? 's' : ''} dans « ${c.name || 'la région'} » · la première joue · les autres : panneau du bas`, 5000);
  app.commit('data');
  void P;
}

export function chooseTake(app, c, i, quiet = false) {
  const tk = c.gen.takes[i];
  if (!tk) return;
  c.gen.take = i;
  c.item = tk.item;
  c.off = tk.off || 0;
  app.engine.buffer(tk.item).catch(() => {});
  if (!quiet) app.commit('data');
}
export function keepTake(app, c) {
  if (!c?.gen || c.gen.take == null) { toast('choisis d\'abord une prise'); return; }
  const n = c.gen.takes.length;
  delete c.gen;
  toast(`prise gardée : un clip audio ordinaire${n > 1 ? ` (les ${n - 1} autres restent dans la bibliothèque, Musique)` : ''}`, 5000);
  app.commit('data');
}
// les prises en pistes (les « take lanes » de Live, à plat) : une piste audio
// par prise, sous la piste générative, muettes sauf celle qui joue
export function takesToTracks(app, c) {
  const P = app.S.proj, t = app.track(c.track);
  let at = P.tracks.indexOf(t) + 1;
  c.gen.takes.forEach((tk, i) => {
    if (i === c.gen.take) return;
    const nt = app.addTrack('audio', { name: `Prise ${i + 1} · ${c.name || t.name}`.slice(0, 60), color: t.color, at: at++ });
    nt.mute = true;
    P.clips.push({ id: app.uid('c'), track: nt.id, start: c.start, len: c.len, item: tk.item, off: tk.off || 0 });
  });
  toast('une piste par prise, muettes : S ou M pour comparer', 5000);
  app.commit('graph');
}

// ── le clic droit sur une région ────────────────────────────
export function regionMenuItems(app, c) {
  const g = c.gen, n = g.takes.length;
  return [
    { head: `région · ${schemaNow() ? model(schemaNow(), g.model).court : g.model} · ${n} prise${n > 1 ? 's' : ''}` },
    { label: 'Générer', sub: 'le panneau du bas', onclick: () => { app.selectClips([c.id], true); app.showDetail('clip'); } },
    ...g.takes.map((tk, i) => ({ label: `Prise ${i + 1}${g.take === i ? ' ·' : ''}`, sub: `graine ${tk.seed ?? '?'}${tk.engine === 'factice' ? ' · essai' : ''}`, onclick: () => chooseTake(app, c, i) })),
    n > 1 ? { label: 'Prise suivante', onclick: () => chooseTake(app, c, ((g.take ?? -1) + 1) % n) } : null,
    { label: 'Garder la prise', sub: 'clip audio ordinaire', disabled: g.take == null, why: 'aucune prise encore', onclick: () => keepTake(app, c) },
    { label: 'Les prises en pistes', sub: 'une piste par prise', disabled: n < 2, why: 'il faut deux prises', onclick: () => takesToTracks(app, c) },
    '-',
  ].filter(Boolean);
}

// ── le dessin d'une région sans prise, dans l'arrangement ───
export function drawRegion(g, w, h, c, app) {
  const s = schemaNow(), P = app.S.proj;
  g.fillStyle = tok('line');
  for (let x = -h; x < w; x += 9) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.lineTo(x + h + 1.2, 0); g.lineTo(x + 1.2, h); g.fill(); }
  const busy = (P.pending || []).some((x) => x.clip === c.id && x.kind === 'takes');
  const M = s && model(s, c.gen.model), T = s && task(s, c.gen.model, c.gen.task);
  const what = [M?.court || c.gen.model, T?.nom || c.gen.task, c.gen.v?.track_name ? trackFr(s, c.gen.v.track_name) : ''].filter(Boolean).join(' · ');
  g.fillStyle = tok(busy ? 'amb' : 'ink2');
  g.font = `9px ${tok('f-mono') || 'monospace'}`;
  g.fillText(`${what.toUpperCase()}`, 6, Math.min(h - 6, 14));
  g.fillStyle = tok('ink3');
  g.fillText(busy ? 'EN COURS…' : 'À GÉNÉRER · PANNEAU DU BAS', 6, Math.min(h - 6, 27));
}

// ── le panneau du bas ───────────────────────────────────────
let player = null;
function listen(app, tk, c, btn) {
  if (player) { player.pause(); const was = player._tk; player = null; document.querySelectorAll('.gr-play').forEach((b) => { b.textContent = '▶'; }); if (was === tk) return; }
  app.loadItem(tk.item).then((it) => {
    player = new Audio(href(it.url));
    player._tk = tk;
    player.currentTime = tk.off || 0;
    player.play().catch(() => {});
    btn.textContent = '■';
    const stopAt = (tk.off || 0) + c.len * 60 / app.S.proj.bpm;
    player.ontimeupdate = () => { if (player && player.currentTime >= stopAt) { player.pause(); btn.textContent = '▶'; player = null; } };
    player.onended = () => { btn.textContent = '▶'; player = null; };
  });
}

export function trackPanel(app, host, t) {
  const s = schemaNow();
  const M = s && model(s, t.gen.model);
  put(host, el('div', { class: 'dk-empty gr-empty' }, el('b', { class: 'venus' }, 'Génératif'),
    el('span', {}, `piste générative · ${M?.nom || t.gen.model} · tirer sur sa voie dessine une région (aimantée à la grille) ; le modèle la remplit de prises, qu'on écoute et qu'on choisit`),
    el('span', { class: 'lbl' }, M ? M.doc : '')));
  return null;
}

export function regionPanel(app, host, c, t) {
  const s = schemaNow();
  if (!s || !eng) {
    put(host, el('div', { class: 'dk-empty' }, el('span', { class: 'lbl' }, 'lecture du schéma des modèles…')));
    Promise.all([loadSchema(), engines()]).then(() => app.renderView());
    return null;
  }
  target = c.id;
  document.body.classList.add('mu-gen-dock');
  const P = app.S.proj, g = c.gen;
  if (!model(s, g.model)) g.model = 'ace';
  if (!task(s, g.model, g.task)) g.task = firstTask(s, g.model);
  const M = model(s, g.model), T = task(s, g.model, g.task), E = eng.engines?.[g.model] || {};
  g.v = g.v || {};
  const vals = { ...defaultsFor(s, g.model, g.task), ...g.v };
  const spb = 60 / P.bpm, secsR = c.len * spb;
  const save = () => app.commit('quiet');
  const redraw = () => app.renderView();
  const set = (pid, v) => { g.v[pid] = v; vals[pid] = v; save(); };

  // la colonne de gauche : la région, le modèle, la tâche ; le projet ; les attracteurs
  const name = el('b', { class: 'venus gr-name', title: 'double-clic : renommer la région' }, c.name || 'Région');
  name.addEventListener('dblclick', () => inlineEdit(name, c.name || '', (n) => { c.name = n.slice(0, 60); app.commit('data'); }, { max: 60 }));
  const modelSeg = el('div', { class: 'seg gr-seg' }, Object.entries(s.modeles).map(([mid, MM]) => el('button', { class: `tb${mid === g.model ? ' on' : ''}`, type: 'button',
    title: MM.doc, onclick: () => {
      if (mid === g.model) return;
      g.model = mid; g.task = mid === 'ace' ? 'lego' : firstTask(s, mid); g.v = defaultsFor(s, mid, g.task);
      t.gen = { model: mid, task: g.task }; t.sub = `générative · ${MM.nom}`;
      app.commit('data');
    } }, MM.nom)));
  const tstate = (tid) => {
    const x = E.tasks?.[tid];
    if (!x) return ['', ''];
    if (x.essai) return ['essai', `moteur d'essai (${M.interrupteur}) ; en réel : ${x.real.ok ? `câblé (${x.real.voie})` : `pas câblé — ${x.real.pourquoi}`}`];
    return x.real.ok ? ['réel', x.real.doc || ''] : ['pas câblé', x.real.pourquoi];
  };
  const tasks = el('div', { class: 'gr-tasks' }, Object.entries(M.taches).map(([tid, TT]) => {
    const [st, why] = tstate(tid);
    return el('button', { class: `gr-task${tid === g.task ? ' on' : ''}${st === 'pas câblé' ? ' off' : ''}`, type: 'button', title: `${TT.doc}${why ? `\n— ${why}` : ''}`,
      onclick: () => { if (tid === g.task) return; g.task = tid; g.v = { ...defaultsFor(s, g.model, tid), ...pickKeep(g.v, s, g.model, tid) }; t.gen = { ...t.gen, model: g.model, task: tid }; app.commit('data'); } },
    el('b', {}, TT.nom), el('small', { class: st === 'réel' ? 'ok' : st === 'pas câblé' ? 'no' : '' }, st), TT.base ? el('i', { title: 'modèle base seulement (INFERENCE.md)' }, 'base') : null);
  }));
  const ace = g.model === 'ace';
  const cov = covered(P, c);
  const dur = ace ? (T.params.includes('duration') ? `${secs(Math.max(10, secsR))} demandées${secsR < 10 ? ' (10 s au moins : le clip n\'en joue que la région)' : ''}` : T.sortie === 'source' ? 'celle du son à varier' : 'celle du contexte (fenêtre ± marge)')
    : `${secs(Math.max(10, secsR))} au plus (max_duration)`;
  const lock = (k, v, how) => el('div', { class: 'gr-lock' }, el('i', {}, k), el('b', {}, v), how ? el('span', {}, how) : null);
  const left = el('div', { class: 'gr-col gr-left' },
    el('div', { class: 'gr-box' }, el('span', { class: 'lbl' }, 'région'), name,
      el('span', { class: 'gr-bounds' }, `${app.bar(c.start)} → ${app.bar(c.start + c.len)} · ${regionBars(P, c)} mes. · ${secs(secsR)}`),
      modelSeg, tasks),
    el('div', { class: 'gr-box' }, el('span', { class: 'lbl' }, 'du projet, tout seul'),
      lock('tempo', `${P.bpm}`, ace ? `bpm ${Math.max(30, Math.min(300, P.bpm))}` : `dans le style « ${P.bpm} BPM » et Q:1/4=${P.bpm}`),
      lock('mesure', P.sig === 6 ? '6/8' : `${P.sig}/4`, ace ? `timesignature « ${P.sig} »` : `M:${s.modeles.yue.partition.mesure[P.sig]}`),
      lock('tonalité', keyLabel(P.key), ace ? `« ${aceKeyOf(P.key)} »${['major', 'minor'].includes(P.key.mode) ? '' : ` (${MODES[P.key.mode].label} → par la tierce)`}`
        : `K:${abcKey(P.key)} et « ${aceKeyOf(P.key)} » dans le style`),
      lock('durée', secs(secsR), dur),
      lock('sections', cov.length ? cov.map((x) => `${x.s.name} ${x.bars}`).join(' · ') : 'aucune', cov.length ? `→ ${sectionsFor(P, c).map(([tg]) => `[${tg}]`).join(' ')}` : '[verse]')),
    attBox(app, c));

  // la colonne du milieu : les réglages de la tâche, dessinés depuis le schéma
  const mid = el('div', { class: 'gr-col gr-mid' });
  const main = [], adv = [];
  for (const pid of T.params) {
    const pd = M.params[pid];
    if (pd.projet && pd.type !== 'contexte') continue;              // tempo, tonalité, mesure, durée : à gauche
    const f = field(app, c, s, pid, pd, vals, set, redraw);
    if (!f) continue;
    (pd.avance ? adv : main).push(f);
  }
  // ce que ce modèle n'a pas, ou pas dans cette tâche : désactivé avec la raison
  const absent = [];
  for (const [pid, lab] of [['track_name', 'seulement une piste'], ['style_audio', 'audio de style'], ['autour', 'ce qui joue autour'], ['src_audio', 'variation d\'un son']]) {
    if (T.params.includes(pid)) continue;
    const why = unavailable(s, g.model, pid) || (() => {
      const other = Object.entries(M.taches).find(([, TT]) => TT.params.includes(pid));
      return other ? `dans la tâche « ${other[1].nom} »` : `${M.nom} ne le prend pas`;
    })();
    absent.push(el('div', { class: 'gr-absent' }, el('b', {}, lab), el('span', {}, why)));
  }
  put(mid, el('div', { class: 'gr-fields' }, main),
    adv.length ? el('details', { class: 'gr-adv', open: g.adv || null, ontoggle: (e) => { g.adv = e.target.open || undefined; } },
      el('summary', {}, `réglages avancés · ${adv.length}`), el('div', { class: 'gr-fields' }, adv)) : null,
    g.model === 'yue' && cond('mode!=off', vals) ? partitionBox(app, c, s, vals) : null,
    absent.length ? el('div', { class: 'gr-absents' }, el('span', { class: 'lbl' }, `pas ici · ${T.nom}`), absent) : null);

  // la colonne de droite : les prises, et Générer
  const right = el('div', { class: 'gr-col gr-right' }, takesBox(app, c, s), goBox(app, c, t, s, vals));
  put(host, el('div', { class: 'gr', style: { '--k': `var(--${t.color})` } }, left, mid, right));
  return { frame() {}, key() { return false; } };
}

// garder, en changeant de tâche, ce qui a le même nom (le style, la graine…)
function pickKeep(v, s, mid, tid) {
  const T = task(s, mid, tid), out = {};
  for (const k of Object.keys(v || {})) if (T.params.includes(k) && !['abc'].includes(k)) out[k] = v[k];
  return out;
}

// ── un champ du schéma ──────────────────────────────────────
function field(app, c, s, pid, pd, vals, set, redraw) {
  const g = c.gen, M = model(s, g.model);
  if (!cond(pd.si, vals)) return null;
  const v = vals[pid];
  const lab = (node, extra = '') => el('label', { class: `gr-f gr-${pd.type}`, title: `${pd.doc ? `${pd.doc}\n` : ''}source : ${pd.source}${pd.envoi ? `\nenvoyé comme : ${pd.envoi}` : ''}` },
    el('span', { class: 'lbl' }, pd.label, extra ? el('b', {}, ` · ${extra}`) : null), node);
  if (pd.type === 'texte') {
    const big = pid === 'lyrics' || pid === 'tags';
    const count = el('small', { class: 'gr-count' }, `${(v || '').length} / ${pd.max}`);
    const ta = el('textarea', { class: 'fld', rows: pid === 'lyrics' ? 4 : 2, maxlength: pd.max, placeholder: pd.exemple || '',
      oninput: (e) => { set(pid, e.target.value); count.textContent = `${e.target.value.length} / ${pd.max}`; },
      // en quittant le champ : le panneau se refait (l'orange, qui attendait le style, le voit)
      onchange: () => redraw() });
    ta.value = v || '';
    const tools = [];
    if (pid === 'lyrics') {
      tools.push(el('button', { class: 'tb ghost sm', type: 'button', title: 'un bloc [Verse] [Chorus]… par section que la région couvre',
        onclick: () => { const blocks = sectionsFor(app.S.proj, c).map(([tg]) => `[${tg.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-')}]\n`); set(pid, blocks.join('\n')); redraw(); } }, 'Les sections'));
    }
    if (pid === 'tags' && g.model === 'yue') tools.push(el('span', { class: 'lbl' }, `+ « ${app.S.proj.bpm} BPM, ${aceKeyOf(app.S.proj.key)} » ajoutés seuls`));
    return el('div', { class: `gr-f gr-texte${big ? ' big' : ''}` }, el('div', { class: 'row' }, el('span', { class: 'lbl', title: pd.source }, pd.label), el('span', { class: 'sp' }), ...tools, count), ta);
  }
  if (pd.type === 'bool') {
    return el('label', { class: 'gr-f gr-bool opt mu-check', title: `source : ${pd.source}` },
      el('input', { type: 'checkbox', checked: v || null, onchange: (e) => { set(pid, e.target.checked); redraw(); } }), ` ${pd.label}`);
  }
  if (pd.type === 'choix') {
    const ids = choiceIds(pd);
    if (ids.length <= 4) return lab(el('div', { class: 'seg' }, ids.map((id) => el('button', { class: `tb${v === id ? ' on' : ''}`, type: 'button', onclick: () => { set(pid, id); redraw(); } }, choiceLabel(pd, id)))));
    return lab(el('select', { class: 'fld', onchange: (e) => set(pid, e.target.value) }, ids.map((id) => el('option', { value: id, selected: id === v || null }, choiceLabel(pd, id)))));
  }
  if (pd.type === 'nombre' || pd.type === 'entier') {
    const inp = el('input', { class: 'fld', type: 'number', min: pd.min, max: pd.max, step: pd.step || (pd.type === 'entier' ? 1 : 'any'), value: v ?? '',
      placeholder: pid === 'seed' ? 'au hasard' : '',
      onchange: (e) => {
        const x = e.target.value === '' ? (pid === 'seed' ? -1 : pd.defaut) : +e.target.value;
        if (!(x >= pd.min && x <= pd.max)) { toast(`${pd.label} : de ${pd.min} à ${pd.max}`); e.target.value = v; return; }
        set(pid, pd.type === 'entier' ? Math.round(x) : x);
      } });
    if (pid === 'seed') {
      if (v === -1) inp.value = '';
      return lab(el('div', { class: 'row' }, inp, el('button', { class: 'tb ghost sm', type: 'button', title: 'une graine tirée maintenant (pour la noter)',
        onclick: () => { const x = Math.floor(Math.random() * 2 ** 31); set(pid, x); inp.value = x; } }, 'Dé')), v === -1 ? 'au hasard' : '');
    }
    return lab(inp, `${pd.min} à ${pd.max}`);
  }
  if (pd.type === 'piste' || pd.type === 'pistes') {
    const multi = pd.type === 'pistes', cur = multi ? new Set(v || []) : new Set([v]);
    return el('div', { class: 'gr-f gr-pistes', title: `source : ${pd.source}` }, el('span', { class: 'lbl' }, pd.label),
      el('div', { class: 'gr-chips' }, s.pistes.ordre.map((id) => el('button', { class: `opt${cur.has(id) ? ' on' : ''}`, type: 'button',
        onclick: () => { if (multi) { if (cur.has(id)) cur.delete(id); else cur.add(id); set(pid, s.pistes.ordre.filter((x) => cur.has(x))); } else set(pid, id); redraw(); } }, trackFr(s, id)))));
  }
  if (pd.type === 'son') return soundSlot(app, c, pid, pd, v, set, redraw);
  if (pd.type === 'contexte') return contextBox(app, c, vals);
  if (pd.type === 'partition') return null;                         // la case de la partition, plus bas
  void M;
  return null;
}

// un son : glissé depuis l'arrangement (clic droit « comme… »), le navigateur, la bibliothèque, le disque
function soundSlot(app, c, pid, pd, v, set, redraw) {
  const title = el('span', { class: 'gr-snd-t' }, v ? '…' : 'aucun');
  if (v) app.loadItem(v).then((it) => { title.textContent = it.title; }).catch(() => { title.textContent = 'son introuvable'; });
  const chosen = () => app.S.proj.clips.find((x) => (app.S.sel.clips || []).includes(x.id) && x.id !== c.id && x.item);
  const slot = el('div', { class: `gr-snd${v ? ' has' : ''}`, 'data-gen-slot': pid, 'data-gen-region': c.id,
    title: 'glisser ici un clip audio de l\'arrangement, un son du navigateur, de la bibliothèque ou du disque · ou clic droit sur un clip audio : « Comme… »' },
    title,
    el('span', { class: 'sp' }),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'le clip audio choisi dans l\'arrangement', onclick: () => { const x = chosen(); if (!x) { toast('choisis d\'abord un clip audio dans l\'arrangement (Maj+clic pour garder la région)'); return; } set(pid, x.item); redraw(); } }, 'Clip choisi'),
    el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => { const [it] = await pick({ kinds: ['audio'], title: pd.label }); if (it) { set(pid, it.id); redraw(); } } }, 'Choisir'),
    v ? el('button', { class: 'tb ghost sm', type: 'button', title: 'retirer', onclick: () => { set(pid, null); delete c.gen.v[pid]; redraw(); } }, '×') : null);
  slot.addEventListener('dragover', (e) => { const ty = [...(e.dataTransfer?.types || [])]; if (ty.includes(ITEM_MIME) || ty.includes('application/x-odio') || ty.includes('Files')) { e.preventDefault(); slot.classList.add('drop-on'); } });
  slot.addEventListener('dragleave', () => slot.classList.remove('drop-on'));
  slot.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation(); slot.classList.remove('drop-on');
    let id = null;
    try {
      const raw = e.dataTransfer.getData(ITEM_MIME);
      if (raw) id = JSON.parse(raw).id;
      const od = e.dataTransfer.getData('application/x-odio');
      if (!id && od) { const d = JSON.parse(od); if (d.t === 'son') id = d.item.id; }
      if (!id && e.dataTransfer.files?.length) id = (await uploadFile(e.dataTransfer.files[0], { tool: 'upload', via: 'odio' })).id;
      const it = id && await app.loadItem(id);
      if (!it || it.kind !== 'audio') { toast(`${pd.label} : un son`); return; }
      set(pid, it.id); redraw();
    } catch (err) { toast(err.message); }
  });
  return el('div', { class: 'gr-f gr-son', title: `${pd.doc || ''}\nsource : ${pd.source}` }, el('span', { class: 'lbl' }, pd.label, pd.requis ? el('b', {}, ' · requis') : null), slot);
}

// ce qui joue autour : les pistes, cochées ; la fenêtre ± la marge
function contextBox(app, c, vals) {
  const P = app.S.proj, [w0, w1] = windowOf(P, c, vals.marge);
  const list = around(app, c, w0, w1);
  const on = new Set(c.gen.ctx || list.map((t) => t.id));
  return el('div', { class: 'gr-f gr-ctx', title: 'rendu hors temps réel à l\'envoi (le même graphe que l\'export), puis envoyé comme src_audio ; la région y garde sa place (repainting_start / repainting_end)' },
    el('span', { class: 'lbl' }, 'ce qui joue autour', el('b', {}, ` · ${app.bar(w0)} → ${app.bar(w1)}, ${secs((w1 - w0) * 60 / P.bpm)}`)),
    list.length ? el('div', { class: 'gr-chips' }, list.map((t) => el('button', { class: `opt${on.has(t.id) ? ' on' : ''}`, type: 'button', style: { '--c': `var(--${t.color})` },
      onclick: () => { if (on.has(t.id)) on.delete(t.id); else on.add(t.id); c.gen.ctx = [...on]; app.commit('quiet'); app.renderView(); } }, el('i', { class: 'dot' }), t.name)))
      : el('p', { class: 'why' }, 'rien ne joue autour de la région : pose des clips sur d\'autres pistes, ou choisis la tâche « morceau »'));
}

// la case des attracteurs
function attBox(app, c) {
  const box = el('div', { class: 'gr-box gr-att' }, el('span', { class: 'lbl' }, 'ce que disent les attracteurs'), el('span', { class: 'lbl' }, '…'));
  attractors(app, c.start, c.start + c.len).then(({ segs, items, why }) => {
    const rows = [];
    for (const sg of segs) rows.push(el('div', { class: 'gr-lock' }, el('i', {}, LANE_FR[sg.lane] || sg.lane), el('b', {}, `${app.bar(sg.d)} → ${app.bar(sg.d + sg.l)}`), el('span', {}, sg.atr ? 'attracteur posé' : 'segment dormant')));
    if (items?.length) {
      for (const x of items.slice(0, 12)) rows.push(el('div', { class: 'gr-lock' }, el('i', {}, x.facette || x.lane || ''), el('b', {}, x.label || x.nom || x.name || x.blocNom || ''),
        el('span', {}, x.op != null ? `${typeof x.op === 'number' ? x.op.toFixed(2) : x.op} ${x.unite || ''}` : x.valeur != null ? String(x.valeur) : '')));
    }
    put(box, el('span', { class: 'lbl' }, 'ce que disent les attracteurs'),
      rows.length ? rows : null,
      !segs.length && !items?.length ? el('p', { class: 'why' }, 'aucun segment du banc sur cette région (Nodal, le banc : tracer un segment, en tirer un attracteur)') : null,
      items === null ? el('p', { class: 'why' }, why) : null);
  });
  return box;
}

// ── la partition (YuE2) ─────────────────────────────────────
async function check(abc) {
  if (!abc?.trim()) return null;
  try { return await api('music/yue/abc/check', { method: 'POST', body: { abc } }); } catch (e) { return { ok: false, error: e.message }; }
}
function partitionBox(app, c, s, vals) {
  const P = app.S.proj, g = c.gen, PT = s.modeles.yue.partition;
  const ta = el('textarea', { class: 'fld gr-abc-t', rows: 8, spellcheck: 'false', placeholder: 'X:1\nT:\nM:4/4\nL:1/16\nQ:1/4=112\n… — « Écrire la partition », ou déposer un clip de notes dans Chant, Thème, Accords' });
  ta.value = vals.abc || '';
  const state = el('span', { class: 'lbl gr-abc-s' });
  const roll = el('canvas', { class: 'gr-roll' });
  const paintState = (r) => {
    if (!r) { state.textContent = g.v.abc ? 'pas vérifiée' : 'vide : sans partition, YuE2 écrit la sienne au rendu'; state.className = 'lbl gr-abc-s'; drawRoll(roll, null, P); return; }
    if (r.ok === null) { state.textContent = `vérification indisponible : ${r.why}`; state.className = 'lbl gr-abc-s'; return; }
    if (!r.ok) { state.textContent = `ne passe pas : ${r.error}`; state.className = 'lbl gr-abc-s no'; drawRoll(roll, null, P); return; }
    const vo = r.report.voices;
    state.textContent = `vérifiée (abc_tools) · ${vo.Vocal.measures} mes. · Q ${r.report.bpm} · chant ${vo.Vocal.sounding_notes} notes · thème ${vo.Ins.sounding_notes} · ${vo.Vocal.chords.length} accords · ${secs(r.report.nominal_duration_seconds)}`;
    state.className = 'lbl gr-abc-s ok';
    drawRoll(roll, r.report, P);
  };
  let t = null;
  const recheck = async () => { const r = await check(g.v.abc); setCheck(c, r); paintState(r); };
  ta.addEventListener('input', () => { g.v.abc = ta.value; app.commit('quiet'); clearTimeout(t); t = setTimeout(recheck, 700); });
  requestAnimationFrame(() => (lastCheck(c) !== undefined ? paintState(lastCheck(c)) : recheck()));
  const busy = (P.pending || []).find((x) => x.clip === c.id && x.kind === 'abc');
  const write = el('button', { class: 'tb ghost sm', type: 'button', disabled: busy || !(vals.tags || '').trim() || null,
    title: busy ? 'en cours' : !(vals.tags || '').trim() ? 'décris d\'abord le style (YuE2GenerateABC le lit)' : 'YuE2GenerateABC seul : la partition, rien n\'est chanté (travail music.yue.abc)',
    onclick: () => ecrirePartition(app, c, vals) }, 'Écrire la partition');
  const fromTake = g.takes.filter((x) => x.score);
  const cases = Object.entries(PT.cases).map(([k, cs]) => caseSlot(app, c, s, k, cs));
  return el('div', { class: 'gr-abc' },
    el('div', { class: 'row' }, el('b', { class: 'venus' }, 'Partition'), state, el('span', { class: 'sp' }),
      busy ? el('span', { class: 'lbl', 'data-gen-job': busy.job }, 'en file') : null, write,
      fromTake.length ? el('button', { class: 'tb ghost sm', type: 'button', title: 'la partition qu\'une prise a chantée', onclick: (e) => menu(e.clientX, e.clientY,
        [{ head: 'la partition d\'une prise' }, ...fromTake.map((x) => ({ label: `Prise ${x.k + 1}`, sub: `graine ${x.seed}`, onclick: () => { g.v.abc = x.score; app.commit('data'); } }))]) }, 'D\'une prise') : null,
      el('button', { class: 'tb ghost sm', type: 'button', title: lastCheck(c)?.ok ? 'jouer la partition par nos instruments : une piste de notes par voix (chant, thème, accords), sous la région' : 'une partition vérifiée d\'abord',
        disabled: !lastCheck(c)?.ok || null, onclick: () => toMotifs(app, c, s) }, 'Par nos instruments'),
      g.v.abc ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { g.v.abc = ''; app.commit('data'); } }, 'Vider') : null),
    el('div', { class: 'gr-cases' }, cases, el('p', { class: 'gr-note gr-refuse' }, `ne passent pas : ${PT.refuse}`)),
    el('div', { class: 'gr-abc-w' }, ta, roll));
}

// YuE2GenerateABC seul (travail music.yue.abc) : la partition, rien n'est chanté
async function ecrirePartition(app, c, vals) {
  const P = app.S.proj;
  try {
    const j = await api('music/yue/abc', { method: 'POST', body: { tags: vals.tags, lyrics: vals.lyrics || '', seed: vals.seed ?? -1, mode: vals.mode || 'full', precision: vals.precision || 'bf16',
      projet: { bpm: P.bpm, sig: P.sig, tonic: P.key.tonic, mode: P.key.mode }, sections: sectionsFor(P, c), title: c.name || 'région' } });
    P.pending.push({ job: j.id, kind: 'abc', clip: c.id, title: j.title });
    app.commit('data'); jobs.poll(true);
  } catch (e) { toast(e.message, 6000); }
}

// une case de la partition : Chant (Vocal), Thème (Ins), Accords (symboles dans Vocal)
function caseSlot(app, c, s, k, cs) {
  const box = el('div', { class: 'gr-case', 'data-gen-case': k, 'data-gen-region': c.id, title: `${cs.doc}\nglisser ici un clip de notes de l'arrangement, un motif ou un clip MIDI\nsource : ${cs.source}` }, el('b', {}, cs.label), el('span', { class: 'lbl' }, `voix ${cs.voix}`),
    el('button', { class: 'tb ghost sm', type: 'button', onclick: (e) => caseMenu(app, c, s, k, e) }, 'Choisir'));
  box.addEventListener('dragover', (e) => { const ty = [...(e.dataTransfer?.types || [])]; if (ty.includes('application/x-odio') || ty.includes(ITEM_MIME)) { e.preventDefault(); box.classList.add('drop-on'); } });
  box.addEventListener('dragleave', () => box.classList.remove('drop-on'));
  box.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation(); box.classList.remove('drop-on');
    try {
      const od = e.dataTransfer.getData('application/x-odio'), raw = e.dataTransfer.getData(ITEM_MIME);
      const d = od ? JSON.parse(od) : null;
      if (d?.t === 'midi') { await injectFrom(app, c, s, k, { item: d.id }); return; }
      if (d?.t === 'motif') { await injectFrom(app, c, s, k, { pat: d.pat }); return; }
      if (raw) { const it = JSON.parse(raw); if (it.kind === 'midi') { await injectFrom(app, c, s, k, { item: it.id }); return; } }
      toast(`${cs.label} : un clip de notes (arrangement), un motif ou un clip MIDI de la bibliothèque`);
    } catch (err) { toast(err.message); }
  });
  return box;
}
async function caseMenu(app, c, s, k, e) {
  const P = app.S.proj, a = c.start, b = c.start + c.len, x0 = e.clientX, y0 = e.clientY;
  const clips = P.clips.filter((x) => x.pat && x.start < b && x.start + x.len > a && TRACK_KINDS[app.track(x.track)?.kind]?.pattern === 'notes');
  const lib = (await listMidi().catch(() => [])).filter((it) => !it.params?.drums).slice(0, 12);
  menu(x0, y0, [{ head: `dans la partition · ${s.modeles.yue.partition.cases[k].label}` },
    ...(clips.length ? [{ head: 'les clips de notes sous la région' }] : [{ head: 'aucun clip de notes sous la région' }]),
    ...clips.slice(0, 20).map((x) => ({ label: `${app.track(x.track).name} · ${app.pat(x.pat)?.name || 'motif'}`, sub: `${app.bar(x.start)} → ${app.bar(x.start + x.len)}`,
      onclick: () => injectFrom(app, c, s, k, { clip: x.id }) })),
    '-', { head: lib.length ? 'la bibliothèque MIDI' : 'bibliothèque MIDI vide' },
    ...lib.map((it) => ({ label: it.title, sub: midiSub(it), onclick: () => injectFrom(app, c, s, k, { item: it.id }) }))]);
}

// Un clip audio de l'arrangement comme son d'une région : le clic droit
// « Comme audio de style… » de timeline.js — la case de son de la tâche
// (audio de style, son à varier, clip à reprendre).
export function soundSlotsOf(app) {
  const c = genTarget(app), s = schemaNow();
  if (!c || !s) return [];
  const M = model(s, c.gen.model), T = task(s, c.gen.model, c.gen.task);
  return T.params.filter((pid) => M.params[pid].type === 'son').map((pid) => ({ pid, label: M.params[pid].label, region: c }));
}
export function useSound(app, region, pid, itemId) {
  region.gen.v = { ...region.gen.v, [pid]: itemId };
  toast(`« ${schemaNow() ? model(schemaNow(), region.gen.model).params[pid].label : pid} » de ${region.name || 'la région'} : ce clip`, 3000);
  app.commit('data');
}

// Nos notes → la partition : on relit la partition actuelle par abc_tools
// (la seule lecture), on remplace une voix (ou les accords), on la réécrit
// dans le dialecte, puis abc_tools la juge de nouveau.
export async function injectFrom(app, c, s, k, src) {
  const P = app.S.proj, g = c.gen, PT = s.modeles.yue.partition;
  let notes = [];                                    // en noires depuis le début de la région
  if (src.clip) {
    const x = app.clip(src.clip);
    notes = clipNotes(app, x).map(([st, l, p, v, ch]) => [x.start - c.start + st, l, p, v, ch]);
  } else if (src.pat) {
    const pat = app.pat(src.pat);
    notes = (pat?.notes || []).map((n) => [n.s / 4, n.l / 4, n.p, n.v ?? 0.8, 0]);
  } else if (src.item) {
    notes = (await api(`music/midi/${src.item}/notes`)).notes;
  }
  const drumsIn = notes.filter((n) => n[4] === 9).length;
  notes = notes.filter((n) => n[4] !== 9 && n[0] < c.len && n[0] + n[1] > 0).map(([st, l, p]) => ({ s: Math.max(0, st) * 4, l: (Math.min(c.len, st + l) - Math.max(0, st)) * 4, p }));
  if (!notes.length) { toast(drumsIn ? 'la batterie ne passe pas dans la partition (le dialecte) : dis-la dans le style' : 'aucune note dans la région'); return; }
  const cur = await check(g.v.abc);
  const bars = regionBars(P, c);
  const data = cur?.ok ? reportVoices(cur.report) : { vocal: [], ins: [], chords: [] };
  let msg = '';
  if (k === 'chant' || k === 'theme') {
    const r = skyline(notes);
    data[k === 'chant' ? 'vocal' : 'ins'] = r.notes;
    msg = `${r.notes.length} notes${r.dropped ? ` (${r.dropped} sous d'autres : la plus haute reste)` : ''}`;
  } else {
    data.chords = chordsFromNotes(notes, abcKey(P.key), PT.intervalles);
    msg = data.chords.length ? `${data.chords.length} accords : ${data.chords.slice(0, 6).map((x) => x.name).join(' ')}${data.chords.length > 6 ? '…' : ''}` : 'aucun accord reconnu (trois notes ensemble au moins)';
  }
  const secsOf = g.v.abc ? sectionsOf(g.v.abc) : [];
  const abc = writeAbc({ bpm: P.bpm, sig: P.sig, key: P.key, bars: Math.max(bars, data.bars || 0), meter: PT.mesure[P.sig],
    sections: secsOf.length ? secsOf : sectionsFor(P, c), vocal: data.vocal, ins: data.ins, chords: data.chords });
  g.v.abc = abc;
  const r = await check(abc);
  setCheck(c, r);
  if (g.v.mode === 'off' || !g.v.mode) g.v.mode = data.chords.length ? 'full' : 'melody';
  toast(`${PT.cases[k].label} : ${msg}${r?.ok === false ? ` — la partition ne passe pas : ${r.error}` : ''}`, 6000);
  app.commit('data');
  return r;
}

// la partition jouée par nos instruments : une piste de notes par voix
function toMotifs(app, c, s) {
  const P = app.S.proj, rep = lastCheck(c)?.report;
  if (!rep) return;
  const d = reportVoices(rep), k = P.bpm / rep.bpm;
  const t = app.track(c.track);
  let at = P.tracks.indexOf(t) + 1;
  const made = [];
  const q = (n) => [n.s / 4 * k, (n.e - n.s) / 4 * k, n.p, 0.85, 0];
  const end = rep.voices.Vocal.measures * P.sig * 4;
  const groups = [['Chant', d.vocal.map(q)], ['Thème', d.ins.map(q)],
    ['Accords', d.chords.flatMap((ch, i) => chordToNotes(ch.name, ch.t / 4 * k, ((d.chords[i + 1]?.t ?? end) - ch.t) / 4 * k, s.modeles.yue.partition.intervalles))]];
  for (const [nm, notes] of groups) {
    if (!notes.length) continue;
    const nt = app.addTrack('synth', { type: 'synth', name: `${nm} · ${c.name || 'partition'}`.slice(0, 60), at: at++ });
    made.push(...placeNotes(app, nt.id, notes, c.start, { quantize: 'libre', name: nm }).made);
  }
  app.selectClips(made.map((x) => x.id), true);
  toast(`la partition jouée par nos instruments : ${made.length} clip${made.length > 1 ? 's' : ''}, sous la région`, 5000);
  app.commit('graph');
}
function drawRoll(cv, rep, P) {
  const w = cv.clientWidth || 400, h = cv.clientHeight || 120, dpr = devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!rep) { g.fillStyle = tok('line'); g.fillRect(0, h / 2, w, 1); return; }
  const d = reportVoices(rep), end = Math.max(1, rep.voices.Vocal.measures * P.sig * 4);
  const all = [...d.vocal, ...d.ins].map((n) => n.p);
  const lo = Math.min(...all, 55) - 2, hi = Math.max(...all, 80) + 2;
  const X = (u) => (u / end) * w, Y = (p) => 14 + (1 - (p - lo) / (hi - lo)) * (h - 18);
  g.fillStyle = tok('line');
  for (let b = 0; b <= end; b += P.sig * 4) g.fillRect(X(b), 0, 1, h);
  g.font = `8px ${tok('f-mono') || 'monospace'}`;
  for (const ch of d.chords) { g.fillStyle = tok('amb'); g.fillText(ch.name, X(ch.t) + 2, 9); }
  for (const [notes, col] of [[d.ins, 'cy'], [d.vocal, 'coral-3']]) {
    g.fillStyle = tok(col);
    for (const n of notes) g.fillRect(X(n.s), Y(n.p) - 1.5, Math.max(2, X(n.e) - X(n.s) - 1), 3);
  }
}

// ── les prises ──────────────────────────────────────────────
function takesBox(app, c, s) {
  const P = app.S.proj, g = c.gen;
  const pend = (P.pending || []).filter((x) => x.clip === c.id && x.kind === 'takes');
  const rows = g.takes.map((tk, i) => {
    const play = el('button', { class: 'gr-play', type: 'button', title: 'écouter la prise, depuis la région', onclick: () => listen(app, tk, c, play) }, '▶');
    const old = stale(app, c, tk);
    return el('div', { class: `gr-take${g.take === i ? ' on' : ''}${old ? ' old' : ''}` },
      el('button', { class: 'gr-pick', type: 'button', title: 'cette prise joue dans la région', onclick: () => chooseTake(app, c, i) }, el('i')),
      el('b', {}, `Prise ${i + 1}`), el('span', { class: 'lbl' }, `graine ${tk.seed ?? '?'}${tk.engine === 'factice' ? ' · essai' : ''}`),
      old ? el('span', { class: 'gr-old', title: 'la région, ses réglages, le tempo, la mesure ou la tonalité ont changé depuis cette prise : elle joue toujours, Générer en refait' }, 'périmée') : null,
      el('span', { class: 'sp' }), play,
      el('button', { class: 'tb ghost sm', type: 'button', title: 'retirer la prise (le son reste dans la bibliothèque)', onclick: () => {
        g.takes.splice(i, 1); g.takes.forEach((x, k) => { x.k = k; });
        if (g.take === i) { g.take = null; delete c.item; c.off = 0; if (g.takes.length) chooseTake(app, c, 0, true); } else if (g.take > i) g.take--;
        app.commit('data');
      } }, '×'));
  });
  const chosen = g.take != null;
  return el('div', { class: 'gr-box gr-takes' }, el('div', { class: 'row' }, el('span', { class: 'lbl' }, `prises · ${g.takes.length}`), el('span', { class: 'sp' }),
    g.takes.length > 1 ? el('button', { class: 'tb ghost sm', type: 'button', title: 'une piste audio par prise, sous la piste générative (muettes)', onclick: () => takesToTracks(app, c) }, 'En pistes') : null),
  pend.map((x) => el('div', { class: 'gr-take busy' }, el('span', { class: 'pill work' }, el('i'), el('span', {}, 'génère')), el('span', { class: 'lbl', 'data-gen-job': x.job }, 'en file'))),
  rows.length ? rows : pend.length ? null : el('p', { class: 'lbl' }, 'aucune prise : Générer, en bas'),
  el('div', { class: 'row gr-after' },
    el('button', { class: 'tb ghost sm', type: 'button', disabled: !chosen || null, title: chosen ? 'la région devient un clip audio ordinaire (sa provenance reste dans la bibliothèque)' : 'choisis une prise', onclick: () => keepTake(app, c) }, 'Garder'),
    el('button', { class: 'tb ghost sm', type: 'button', disabled: !chosen || null, title: chosen ? 'voix, batterie, basse… chacune sur sa piste, sous la région' : 'choisis une prise', onclick: () => app.stems(c.id) }, 'Séparer en stems'),
    el('button', { class: 'tb ghost sm', type: 'button', disabled: !chosen || null, title: chosen ? 'les notes de la prise, en clips de notes sous elle' : 'choisis une prise', onclick: () => openExtract(app, c.id) }, 'Extraire le MIDI')));
}

// Générer : le seul orange du panneau, et ce qui l'empêche, dit
function goBox(app, c, t, s, vals) {
  const P = app.S.proj, g = c.gen, M = model(s, g.model), T = task(s, g.model, g.task), E = eng.engines?.[g.model] || {};
  const x = E.tasks?.[g.task];
  const spb = 60 / P.bpm, secsR = c.len * spb;
  let why = '';
  if (eng.error) why = `moteurs illisibles : ${eng.error}`;
  else if (x && !x.essai && !x.real.ok) why = `pas câblé : ${x.real.pourquoi}`;
  if (!why) {
    for (const pid of T.params) {
      const pd = M.params[pid];
      if (!pd.requis || !cond(pd.si, vals)) continue;
      if (pd.type === 'contexte') {
        const [w0, w1] = windowOf(P, c, vals.marge);
        const ids = (c.gen.ctx || around(app, c, w0, w1).map((q) => q.id)).filter((id) => around(app, c, w0, w1).some((q) => q.id === id));
        if (!ids.length) { why = 'rien ne joue autour de la région (contexte vide)'; break; }
      } else if (vals[pid] === undefined || vals[pid] === null || vals[pid] === '' || (Array.isArray(vals[pid]) && !vals[pid].length)) { why = `${pd.label} : à remplir`; break; }
    }
  }
  if (!why && T.zone && !(secsR >= T.zone.min && secsR <= T.zone.max)) why = `${T.nom} : la région dure ${secs(secsR)}, de ${T.zone.min} à ${T.zone.max} s (${T.zone.source})`;
  if (!why && ace(g) && T.params.includes('duration') && secsR > 600) why = 'la région dépasse 600 s (ACE-Step)';
  if (!why && g.model === 'yue' && secsR > 900) why = 'la région dépasse 900 s (YuE2)';
  if (!why && g.model === 'yue' && cond('mode!=off', vals) && vals.abc && lastCheck(c)?.ok === false) why = `la partition ne passe pas : ${lastCheck(c).error}`;
  if (!why && ace(g) && (P.bpm < 30)) why = `le tempo ${P.bpm} sort des 30-300 d'ACE-Step`;
  // relire avant de chanter (05/10, Cal : « un mode de validation de ce que le modèle va faire avant de
  // le calculer […] par défaut ») : une chanson YuE2 sans partition fait d'abord écrire la partition
  // (l'orange) ; on la relit à gauche, puis Générer la chante. « Sans relire » reste à côté.
  const relire = !why && g.model === 'yue' && T.params.includes('abc') && cond('mode!=off', vals) && !(vals.abc || '').trim();
  const busyAbc = (P.pending || []).some((x) => x.clip === c.id && x.kind === 'abc');
  const go = relire
    ? el('button', { class: 'tb go gr-go', type: 'button', disabled: busyAbc || !(vals.tags || '').trim() || null,
      title: busyAbc ? 'la partition s\'écrit' : !(vals.tags || '').trim() ? 'décris d\'abord le style (YuE2GenerateABC le lit)' : 'YuE2 écrit d\'abord la partition : tu la relis (à gauche), puis Générer la chante telle quelle',
      onclick: () => ecrirePartition(app, c, vals) }, busyAbc ? 'La partition s\'écrit…' : 'Écrire la partition')
    : el('button', { class: 'tb go gr-go', type: 'button', disabled: why || null, title: why || `${vals.n || 1} prise${(vals.n || 1) > 1 ? 's' : ''}`, onclick: () => launch(app, c, go) }, 'Générer');
  const sans = relire ? el('button', { class: 'tb ghost sm', type: 'button', title: 'YuE2 écrit sa partition et chante d\'un trait, sans la montrer', onclick: (e) => launch(app, c, e.currentTarget) }, 'Sans relire') : null;
  // le moteur en deux lignes ; le détail (la raison entière, ses sources) au survol
  const real = x?.real ? (x.real.ok ? `en réel : câblé (${x.real.voie === 'comfyui' ? 'ComfyUI' : 'serveur d\'API'})` : `en réel : pas câblé — ${x.real.pourquoi.split(/ ; | : /)[0]}`) : '';
  return el('div', { class: 'gr-box gr-gobox' },
    x ? el('p', { class: `gr-eng${x.essai ? ' essai' : ''}`, title: x.real.pourquoi || x.real.doc || '' },
      x.essai ? (g.model === 'yue' ? 'moteur d\'essai : la partition jouée en sinus, à son tempo (sans partition : un son synthétisé) — pas YuE2'
        : `moteur d'essai : un son synthétisé au tempo, dans la tonalité, à la mesure — pas ${M.nom}`) : (x.real.doc || M.nom),
      real ? el('small', {}, real) : null) : null,
    el('div', { class: 'row' }, el('span', { class: why ? 'why' : 'lbl' }, why || (relire ? 'la partition d\'abord, relue à gauche ; le chant ensuite' : `${vals.n || 1} prise${(vals.n || 1) > 1 ? 's' : ''} · ${M.nom} · ${T.nom}`)), el('span', { class: 'sp' }), sans, go));
}
const ace = (g) => g.model === 'ace';

async function launch(app, c, go) {
  const s = await loadSchema(), P = app.S.proj, g = c.gen, T = task(s, g.model, g.task);
  const vals = { ...defaultsFor(s, g.model, g.task), ...g.v };
  go.disabled = true;
  try {
    const body = { model: g.model, task: g.task, v: requestV(s, g.model, g.task, vals), projet: { bpm: P.bpm, sig: P.sig, tonic: P.key.tonic, mode: P.key.mode },
      region: { a: c.start, b: c.start + c.len }, sections: sectionsFor(P, c), title: (c.name || app.track(c.track)?.name || 'région').slice(0, 60), clip: c.id };
    if (T.sortie === 'contexte') {
      const [w0, w1] = windowOf(P, c, vals.marge);
      const all = around(app, c, w0, w1).map((q) => q.id);
      const ids = (g.ctx || all).filter((id) => all.includes(id));
      body.region.w0 = w0; body.region.w1 = w1;
      body.context = await renderContext(app, c, w0, w1, ids);
    }
    const j = await api('music/gen/generate', { method: 'POST', body });
    P.pending.push({ job: j.id, kind: 'takes', clip: c.id, title: j.title, fp: fingerprint(app, c) });
    app.commit('data');
    jobs.poll(true);
    toast(`en file : ${j.title} · ${vals.n || 1} prise${(vals.n || 1) > 1 ? 's' : ''}`, 4000);
  } catch (e) { toast(e.message, 7000); go.disabled = false; }
}
