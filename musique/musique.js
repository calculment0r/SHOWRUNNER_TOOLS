// MUSIQUE — l'outil : un projet, trois vues de la même chose.
//   Timeline  l'arrangement : pistes, clips, tempo, boucle
//   Rack      les instruments et effets d'une piste, et l'éditeur de motifs
//   Nodal     le graphe des modules et de leurs câbles
// Un câble changé dans le nodal change le son partout : les trois vues
// lisent et écrivent le même projet, et le moteur (moteur.js) le joue.
// Le projet s'enregistre seul sur le serveur (server/tools/music.py).

import { mountHeader, api, jobs, pick, uploadFile, toast, $, href, fmtDur, stateFr } from '../commun/shell.js';
import { Engine, renderMix, wav24, peakDb, songEnd } from './moteur.js';
import { MODULES, TRACK_KINDS, COLORS, DRUM_VOICES } from './modules.js';
import { el, modal, ask, confirmBox, menu, put } from './ui.js';
import { createTimeline } from './timeline.js';
import { createRack } from './rack.js';
import { createNodal } from './nodal.js';

mountHeader('music', { sub: 'rack · nodal · timeline' });

// ── l'état ──────────────────────────────────────────────────
const S = {
  proj: null, list: [], view: 'timeline', engines: null,
  sel: { track: null, pat: null, clip: null, mod: null, cable: null },
  oct: 4, midi: null,
};
const items = new Map();   // les objets de la bibliothèque déjà lus
async function loadItem(id) {
  if (!items.has(id)) items.set(id, api(`library/${id}`).then((it) => ({ ...it, href: href(it.url) })));
  return items.get(id);
}
const engine = new Engine({ loadItem });
engine.onstop = () => { paintTransport(); views[S.view]?.frame(engine.position()); };

export const uid = (p) => p + Math.random().toString(36).slice(2, 9);
const beatsPerBar = () => S.proj.sig;

// ── l'application, telle que les vues la voient ────────────
export const app = {
  S, engine, items, loadItem, uid,
  track: (id) => S.proj.tracks.find((t) => t.id === id),
  mod: (id) => S.proj.modules.find((m) => m.id === id),
  pat: (id) => S.proj.patterns.find((p) => p.id === id),
  clip: (id) => S.proj.clips.find((c) => c.id === id),
  master: () => S.proj.modules.find((m) => m.type === 'master'),
  pos: () => engine.position(),
  bar: (beat) => fmtBar(beat),

  // kind : 'param' (une molette : le moteur suit, rien à redessiner),
  // 'quiet' (la vue s'est déjà redessinée elle-même : on enregistre),
  // 'mute', 'graph' (modules ou câbles), 'data' (clips, motifs), 'meta'
  commit(kind, m) {
    if (kind === 'param' && m) engine.updateModule(m);
    else if (kind === 'mute') engine.mutes();
    else if (kind === 'graph' || kind === 'meta') engine.setProject(S.proj);
    else if (kind === 'data') engine.need(S.proj);
    save();
    if (kind !== 'param' && kind !== 'quiet') render();
  },

  select(patch) {
    Object.assign(S.sel, patch);
    if (patch.track && !patch.pat) {
      const t = app.track(patch.track);
      if (t?.pat) S.sel.pat = t.pat;
    }
    render();
  },

  setView(v) {
    S.view = v;
    S.proj.ui = { ...(S.proj.ui || {}), view: v };
    saveQuiet();
    render(true);
  },

  openPattern(patId) {
    const p = app.pat(patId);
    if (!p) return;
    const t = app.track(p.track);
    t.pat = p.id;
    S.sel.track = t.id; S.sel.pat = p.id;
    app.setView('rack');
  },

  // ── pistes ──
  addTrack(kind, { name, color, at } = {}) {
    const P = S.proj, K = TRACK_KINDS[kind];
    const n = P.tracks.filter((t) => t.kind === kind).length + 1;
    const y = Math.max(0, ...P.modules.filter((m) => m.track).map((m) => m.y)) + 260;
    const t = {
      id: uid('t'), name: name || `${K.label} ${n}`, kind,
      color: color || (kind === 'audio' ? 'grn2' : COLORS[P.tracks.length % COLORS.length]),
      mute: false, solo: false, src: uid('m'), strip: uid('m'),
    };
    const mst = app.master();
    P.modules.push({ id: t.src, type: K.src, track: t.id, x: 40, y, on: true, params: {} },
      { id: t.strip, type: 'strip', track: t.id, x: 380, y, on: true, params: {} });
    P.cables.push({ a: t.src, b: t.strip }, { a: t.strip, b: mst.id });
    if (K.pattern) {
      const p = K.pattern === 'drums'
        ? { id: uid('p'), track: t.id, name: 'Motif 1', steps: 16, lanes: {} }
        : { id: uid('p'), track: t.id, name: 'Motif 1', steps: 16, notes: [] };
      P.patterns.push(p);
      t.pat = p.id;
    }
    if (at === undefined) P.tracks.push(t);
    else P.tracks.splice(at, 0, t);
    S.sel.track = t.id; S.sel.pat = t.pat || null;
    return t;
  },

  async removeTrack(id) {
    const t = app.track(id);
    if (!t) return;
    if (!(await confirmBox('Retirer la piste', `Retirer « ${t.name} », ses modules, ses motifs et ses clips ?`))) return;
    const P = S.proj;
    const mods = new Set(P.modules.filter((m) => m.track === id).map((m) => m.id));
    P.modules = P.modules.filter((m) => !mods.has(m.id));
    P.cables = P.cables.filter((c) => !mods.has(c.a) && !mods.has(c.b));
    P.patterns = P.patterns.filter((p) => p.track !== id);
    P.clips = P.clips.filter((c) => c.track !== id);
    P.tracks = P.tracks.filter((x) => x.id !== id);
    if (S.sel.track === id) S.sel = { track: P.tracks[0]?.id || null, pat: P.tracks[0]?.pat || null, clip: null, mod: null, cable: null };
    app.commit('graph');
  },

  // ── la chaîne d'une piste : source → effets → tranche ──
  chain(trackId) {
    const t = app.track(trackId);
    if (!t) return [];
    const P = S.proj, out = [t.src], seen = new Set(out);
    let cur = t.src;
    for (;;) {
      const next = P.cables.map((c) => c.a === cur && app.mod(c.b)).find((m) => m && m.track === trackId && !seen.has(m.id));
      if (!next) break;
      out.push(next.id); seen.add(next.id);
      if (next.type === 'strip') break;
      cur = next.id;
    }
    return out.map(app.mod);
  },

  // réécrit les câbles entre les maillons consécutifs d'une chaîne
  setChain(trackId, mods) {
    const P = S.proj, old = app.chain(trackId).map((m) => m.id);
    const pairs = (arr) => arr.slice(1).map((b, i) => `${arr[i]}>${b}`);
    const drop = new Set(pairs(old));
    P.cables = P.cables.filter((c) => !drop.has(`${c.a}>${c.b}`));
    for (const k of pairs(mods.map((m) => m.id))) {
      const [a, b] = k.split('>');
      if (!P.cables.some((c) => c.a === a && c.b === b)) P.cables.push({ a, b });
    }
  },

  addEffect(trackId, type, { x, y } = {}) {
    const P = S.proj;
    const m = { id: uid('m'), type, track: trackId || null, x: x ?? 0, y: y ?? 0, on: true, params: {} };
    P.modules.push(m);
    if (trackId) {
      const ch = app.chain(trackId);
      const strip = ch.findIndex((mm) => mm.type === 'strip');
      const src = app.mod(app.track(trackId).src);
      if (x === undefined) { m.x = src.x + 320 * (ch.length - 1); m.y = src.y; }
      if (strip > 0) {
        ch.splice(strip, 0, m);
        app.setChain(trackId, ch);
        const st = app.mod(ch[ch.length - 1].id);
        if (x === undefined) st.x = m.x + 320;
      }
    }
    S.sel.mod = m.id;
    app.commit('graph');
    return m;
  },

  removeModule(id) {
    const P = S.proj, m = app.mod(id);
    if (!m || MODULES[m.type].role !== 'effect') return;
    const ins = P.cables.filter((c) => c.b === id).map((c) => c.a);
    const outs = P.cables.filter((c) => c.a === id).map((c) => c.b);
    P.cables = P.cables.filter((c) => c.a !== id && c.b !== id);
    P.modules = P.modules.filter((x) => x.id !== id);
    for (const a of ins) for (const b of outs) if (!app.wouldCycle(a, b) && !P.cables.some((c) => c.a === a && c.b === b)) P.cables.push({ a, b });
    if (S.sel.mod === id) S.sel.mod = null;
    app.commit('graph');
  },

  moveInChain(trackId, id, dir) {
    const ch = app.chain(trackId), i = ch.findIndex((m) => m.id === id), j = i + dir;
    if (i < 1 || j < 1 || j >= ch.length - 1) return;
    [ch[i], ch[j]] = [ch[j], ch[i]];
    app.setChain(trackId, ch);
    app.commit('graph');
  },

  // ── câbles ──
  wouldCycle(a, b) {
    // a → b ferait une boucle si a est déjà en aval de b
    const P = S.proj, stack = [b], seen = new Set();
    while (stack.length) {
      const n = stack.pop();
      if (n === a) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const c of P.cables) if (c.a === n) stack.push(c.b);
    }
    return false;
  },
  canConnect(a, b) {
    const A = app.mod(a), B = app.mod(b);
    if (!A || !B || a === b) return 'même module';
    if (A.type === 'master') return 'la sortie ne se câble vers rien';
    if (MODULES[B.type].role === 'source') return `${MODULES[B.type].name} n'a pas d'entrée`;
    if (S.proj.cables.some((c) => c.a === a && c.b === b)) return 'ce câble existe déjà';
    if (app.wouldCycle(a, b)) return 'ce câble ferait une boucle : le son tournerait sans fin';
    return null;
  },
  connect(a, b) {
    const why = app.canConnect(a, b);
    if (why) { toast(why); return false; }
    S.proj.cables.push({ a, b });
    app.commit('graph');
    return true;
  },
  disconnect(a, b) {
    S.proj.cables = S.proj.cables.filter((c) => !(c.a === a && c.b === b));
    if (S.sel.cable === `${a}>${b}`) S.sel.cable = null;
    app.commit('graph');
  },

  // ── motifs ──
  newPattern(trackId, from = null) {
    const t = app.track(trackId), P = S.proj;
    const n = P.patterns.filter((p) => p.track === trackId).length + 1;
    const base = from ? JSON.parse(JSON.stringify(from)) : (TRACK_KINDS[t.kind].pattern === 'drums'
      ? { steps: 16, lanes: {} } : { steps: 16, notes: [] });
    const p = { ...base, id: uid('p'), track: trackId, name: from ? `${from.name} bis`.slice(0, 40) : `Motif ${n}` };
    P.patterns.push(p);
    t.pat = p.id; S.sel.pat = p.id;
    app.commit('data');
    return p;
  },

  // ── clips ──
  addClip(trackId, start, extra = {}) {
    const t = app.track(trackId);
    const c = { id: uid('c'), track: trackId, start: Math.max(0, start), ...extra };
    if (t.kind !== 'audio') {
      const p = app.pat(extra.pat || t.pat);
      c.pat = p.id;
      c.len = extra.len || p.steps / 4;
    }
    S.proj.clips.push(c);
    S.sel.clip = c.id; S.sel.track = trackId;
    app.commit('data');
    return c;
  },

  async addAudio(trackId, at) {
    const got = await pick({ kinds: ['audio'], multiple: true, title: 'Des sons de la bibliothèque' });
    if (!got.length) return;
    let t = trackId && app.track(trackId);
    if (!t || t.kind !== 'audio') t = app.addTrack('audio');
    let start = at ?? engine.position();
    for (const it of got) {
      items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
      const len = Math.max(0.25, (it.duration || 4) * S.proj.bpm / 60);
      S.proj.clips.push({ id: uid('c'), track: t.id, start, len, item: it.id, off: 0 });
      start += len;
    }
    app.commit('graph');
  },

  // ── les travaux « IA » ──
  generate: () => openGenerate(),
  stems: (clipId) => runStems(clipId),
  exportMix: () => openExport(),
};

function fmtBar(beat) {
  const b = Math.max(0, beat), bpb = beatsPerBar();
  const bar = Math.floor(b / bpb) + 1, bt = Math.floor(b % bpb) + 1;
  return `${String(bar).padStart(2, '0')}.${bt}`;
}

// ── l'enregistrement ────────────────────────────────────────
let saveT = null, saving = false, again = false;
function status(txt, err = false) {
  const s = $('#mu-save');
  if (s) { s.textContent = txt; s.classList.toggle('err', err); }
}
function save() { clearTimeout(saveT); status('modifié'); saveT = setTimeout(flush, 600); }
function saveQuiet() { clearTimeout(saveT); saveT = setTimeout(flush, 600); }
async function flush() {
  if (!S.proj) return;
  if (saving) { again = true; return; }
  saving = true; status('enregistrement');
  try {
    const r = await api(`music/projects/${S.proj.id}`, { method: 'POST', body: S.proj });
    S.proj.rev = r.rev;
    status('enregistré');
    const it = S.list.find((x) => x.id === S.proj.id);
    if (it) it.name = S.proj.name;
  } catch (e) {
    if (e.status === 409) { toast(e.message, 6000); await openProject(S.proj.id); }
    else status(`non enregistré : ${e.message}`, true);
  }
  saving = false;
  if (again) { again = false; flush(); }
}
addEventListener('pagehide', () => {
  if (saveT && S.proj) {
    clearTimeout(saveT);
    fetch(href(`api/music/projects/${S.proj.id}`), { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.proj) });
  }
});

// ── les projets ─────────────────────────────────────────────
async function openProject(id) {
  if (engine.running) engine.stop();
  const p = await api(`music/projects/${id}`);
  S.proj = p;
  for (const k of ['pending', 'patterns', 'clips', 'cables', 'modules', 'tracks']) p[k] = p[k] || [];
  S.view = p.ui?.view || 'timeline';
  const t0 = p.tracks[0];
  S.sel = { track: t0?.id || null, pat: t0?.pat || null, clip: null, mod: null, cable: null };
  engine.pos = 0;
  engine.setProject(p);
  history.replaceState(null, '', `?p=${id}`);
  try { localStorage.setItem('mu:last', id); } catch { /* stockage refusé */ }
  status('enregistré');
  render(true);
  watchPending();
}

async function newProject() {
  const name = await ask('Nouveau projet', 'Nom du projet', '');
  if (!name) return;
  const p = await api('music/projects', { method: 'POST', body: { name } });
  S.list.unshift({ id: p.id, name: p.name });
  await openProject(p.id);
}

async function loadList() {
  S.list = (await api('music/projects')).projects;
}

// ── la barre : projet, vues, transport ──────────────────────
const bar = el('div', { class: 'mu-bar' });
const viewBox = el('div', { class: 'mu-view' });
document.body.append(el('main', { class: 'mu-app' }, bar, viewBox));

function paintBar() {
  const P = S.proj;
  const sel = el('select', { class: 'fld mu-proj', 'aria-label': 'projet', onchange: (e) => openProject(e.target.value) },
    S.list.map((x) => el('option', { value: x.id, selected: x.id === P.id || null }, x.name)));
  const views = el('div', { class: 'seg', role: 'tablist' },
    [['timeline', 'Timeline'], ['rack', 'Rack'], ['nodal', 'Nodal']].map(([v, l]) =>
      el('button', { class: `tb${S.view === v ? ' on' : ''}`, role: 'tab', 'aria-selected': S.view === v, type: 'button',
        onclick: () => app.setView(v) }, l)));
  const bpm = el('input', { class: 'fld mu-num', type: 'number', min: 20, max: 300, step: 1, value: P.bpm, 'aria-label': 'tempo',
    onchange: (e) => {
      const v = Math.round(+e.target.value);
      if (!(v >= 20 && v <= 300)) { e.target.value = P.bpm; toast('tempo : de 20 à 300'); return; }
      P.bpm = v;
      const was = engine.running, at = engine.position();
      app.commit('meta');
      if (was) engine.playFrom(at);
    } });
  const sig = el('select', { class: 'fld mu-num', 'aria-label': 'temps par mesure',
    onchange: (e) => { P.sig = +e.target.value; app.commit('meta'); } },
  [2, 3, 4, 6].map((n) => el('option', { value: n, selected: n === P.sig || null }, `${n} temps`)));
  const pend = (P.pending || []).length;
  put(bar,
    el('div', { class: 'grp' }, sel,
      el('button', { class: 'tb ghost sm', type: 'button', onclick: newProject, title: 'un projet neuf' }, 'Nouveau'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'renommer, corbeille', onclick: (e) => projMenu(e) }, '···')),
    views,
    el('div', { class: 'grp' },
      el('button', { class: 'tb go', id: 'mu-play', type: 'button', onclick: togglePlay, title: 'espace' }, 'Lecture'),
      el('button', { class: `tb ghost${P.loop.on ? ' on' : ''}`, type: 'button', title: 'boucle',
        onclick: () => { P.loop.on = !P.loop.on; app.commit('meta'); } }, 'Boucle'),
      el('div', { class: 'mu-tc' }, el('b', { id: 'mu-pos' }, fmtBar(engine.position())), el('small', { id: 'mu-sec' }, ''))),
    el('div', { class: 'grp' }, el('label', { class: 'mu-lab' }, el('span', { class: 'lbl' }, 'bpm'), bpm),
      el('label', { class: 'mu-lab' }, el('span', { class: 'lbl' }, 'mesure'), sig)),
    el('span', { class: 'sp' }),
    el('div', { class: 'grp' },
      el('span', { class: 'lbl mu-kb', id: 'mu-kb', title: 'jouer au clavier de l\'ordinateur : la rangée du milieu (touches physiques A S D F… d\'un clavier QWERTY, Q S D F… en AZERTY) ; les touches Z et X physiques (W et X en AZERTY) changent d\'octave' }, `oct ${S.oct}`),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: startMidi, title: 'brancher un clavier MIDI (Web MIDI)' },
        S.midi ? `MIDI · ${S.midi}` : 'MIDI'),
      pend ? el('span', { class: 'pill work', title: 'travaux en cours pour ce projet' }, el('i'), el('span', {}, `${pend} en cours`)) : null,
      el('button', { class: 'tb ghost', type: 'button', onclick: openGenerate }, 'Générer'),
      el('button', { class: 'tb ghost', type: 'button', onclick: openExport }, 'Exporter'),
      el('span', { class: 'lbl mu-save', id: 'mu-save' }, 'enregistré')));
  paintTransport();
}

function projMenu(e) {
  const r = e.currentTarget.getBoundingClientRect();
  menu(r.left, r.bottom + 4, [
    { label: 'Renommer', onclick: async () => {
      const n = await ask('Renommer le projet', 'Nom du projet', S.proj.name, 'Renommer');
      if (n) { S.proj.name = n; const it = S.list.find((x) => x.id === S.proj.id); if (it) it.name = n; app.commit('meta'); }
    } },
    { label: 'Mettre à la corbeille', onclick: async () => {
      if (!(await confirmBox('Corbeille', `Mettre « ${S.proj.name} » à la corbeille du serveur ?`, 'Mettre à la corbeille'))) return;
      await api(`music/projects/${S.proj.id}/delete`, { method: 'POST' });
      clearTimeout(saveT);
      await loadList();
      if (!S.list.length) {
        const p = await api('music/projects', { method: 'POST', body: { name: 'Premier projet' } });
        S.list = [{ id: p.id, name: p.name }];
      }
      await openProject(S.list[0].id);
    } },
  ]);
}

function paintTransport() {
  const b = $('#mu-play');
  if (b) b.textContent = engine.running ? 'Stop' : 'Lecture';
}

async function togglePlay() {
  if (engine.running) engine.stop();
  else await engine.playFrom(engine.pos);
  paintTransport();
}

// ── les vues ────────────────────────────────────────────────
const views = {};
function render(full = false) {
  if (!S.proj) return;
  paintBar();
  if (!views[S.view]) views[S.view] = { timeline: createTimeline, rack: createRack, nodal: createNodal }[S.view](app);
  const v = views[S.view];
  if (full || viewBox.firstChild !== v.el) put(viewBox, v.el);
  document.body.dataset.view = S.view;
  v.render();
}

// la tête de lecture et les vu-mètres : à chaque image
function frame() {
  if (S.proj) {
    const b = engine.position();
    const pos = $('#mu-pos'), sec = $('#mu-sec');
    if (pos) pos.textContent = fmtBar(b);
    if (sec) sec.textContent = fmtDur(b * 60 / S.proj.bpm);
    views[S.view]?.frame?.(b);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── le clavier de l'ordinateur ──────────────────────────────
// KeyboardEvent.code (MDN) : la touche physique, pas la lettre — la même
// rangée joue en QWERTY comme en AZERTY. Disposition des logiciels de
// musique : rangée du milieu = touches blanches, rangée du dessus = noires.
const KEYS = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10,
  KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16 };
const held = new Map();
const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable]');

function srcForPlay() {
  const t = app.track(S.sel.track) || S.proj.tracks.find((x) => x.kind !== 'audio');
  return t && t.kind !== 'audio' ? t : null;
}

addEventListener('keydown', async (e) => {
  if (!S.proj || typing(e) || e.metaKey || e.ctrlKey || e.altKey) {
    if (S.proj && !typing(e) && (e.ctrlKey || e.metaKey) && e.code === 'KeyD') { e.preventDefault(); views[S.view]?.key?.(e); }
    return;
  }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) togglePlay(); return; }
  if (e.code === 'KeyZ' || e.code === 'KeyX') {
    S.oct = Math.max(0, Math.min(8, S.oct + (e.code === 'KeyZ' ? -1 : 1)));
    const k = $('#mu-kb'); if (k) k.textContent = `oct ${S.oct}`;
    return;
  }
  if (e.code in KEYS) {
    if (e.repeat || held.has(e.code)) return;
    const t = srcForPlay();
    if (!t) return;
    const pitch = t.kind === 'drums' ? KEYS[e.code] : 12 * (S.oct + 1) + KEYS[e.code];
    held.set(e.code, null);
    const h = await engine.noteOn(t.src, pitch, 0.85);
    if (held.has(e.code)) held.set(e.code, h); else engine.noteOff(h);
    views[S.view]?.played?.(t, pitch);
    return;
  }
  views[S.view]?.key?.(e);
});
addEventListener('keyup', (e) => {
  if (!held.has(e.code)) return;
  const h = held.get(e.code);
  held.delete(e.code);
  if (h) engine.noteOff(h);
});

// ── Web MIDI (MDN : Navigator.requestMIDIAccess) ────────────
async function startMidi() {
  if (!navigator.requestMIDIAccess) { toast('ce navigateur ne connaît pas Web MIDI'); return; }
  try {
    const access = await navigator.requestMIDIAccess();
    const notes = new Map();
    const bind = () => {
      let n = 0;
      for (const inp of access.inputs.values()) {
        n++;
        inp.onmidimessage = async (m) => {
          const [st, d1, d2] = m.data, cmd = st & 0xf0;
          const t = srcForPlay();
          if (!t) return;
          if (cmd === 0x90 && d2 > 0) notes.set(d1, await engine.noteOn(t.src, t.kind === 'drums' ? d1 - 36 : d1, d2 / 127));
          else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) { engine.noteOff(notes.get(d1)); notes.delete(d1); }
        };
      }
      S.midi = n ? `${n} entrée${n > 1 ? 's' : ''}` : 'aucune entrée';
      paintBar();
    };
    access.onstatechange = bind;
    bind();
  } catch (err) { toast(`MIDI refusé : ${err.message}`); }
}

// ── générer (ACE-Step 1.5, ou le son d'essai) ───────────────
async function engines() {
  try { S.engines = await api('music/engines'); } catch (e) { S.engines = { error: e.message }; }
  return S.engines;
}

async function openGenerate() {
  const E = await engines();
  const P = S.proj;
  const g = E.generate || { ok: false, why: E.error };
  const at = engine.position();
  const f = {
    title: el('input', { class: 'fld', maxlength: 80, placeholder: 'le titre dans la bibliothèque' }),
    tags: el('textarea', { class: 'fld', maxlength: 512, rows: 3,
      placeholder: 'genre, instruments, ambiance, voix… (anglais conseillé par la doc ACE-Step)' }),
    lyrics: el('textarea', { class: 'fld', maxlength: 4096, rows: 5, placeholder: '[Verse]\n…\n[Chorus]\n…' }),
    inst: el('input', { type: 'checkbox' }),
    dur: el('input', { class: 'fld', type: 'number', min: 10, max: 600, step: 1,
      value: Math.round(Math.min(600, Math.max(10, P.loop.on ? (P.loop.b - P.loop.a) * 60 / P.bpm : 30))) }),
    bpm: el('input', { class: 'fld', type: 'number', min: 30, max: 300, value: Math.min(300, Math.max(30, P.bpm)) }),
    key: el('select', { class: 'fld' }, (E.keyscales || []).map((k) => el('option', { value: k, selected: k === 'A minor' || null }, k))),
    ts: el('select', { class: 'fld' }, (E.timesigs || ['4']).map((k) => el('option', { value: k, selected: +k === P.sig || null }, k === '6' ? '6/8' : `${k}/4`))),
    lang: el('select', { class: 'fld' }, (E.languages || ['fr']).map((k) => el('option', { value: k, selected: k === 'fr' || null }, k))),
    seed: el('input', { class: 'fld', type: 'number', min: 0, placeholder: 'aléatoire' }),
  };
  const count = el('span', { class: 'lbl' }, '0 / 512');
  f.tags.addEventListener('input', () => { count.textContent = `${f.tags.value.length} / 512`; });
  const syncInst = () => { f.lyrics.disabled = f.inst.checked; };
  f.inst.addEventListener('change', syncInst);
  const lab = (t, n, extra) => el('label', { class: 'field' }, el('span', { class: 'lbl' }, t, extra ? el('b', {}, ` · ${extra}`) : null), n);
  const go = el('button', { class: 'tb go', type: 'button', disabled: !g.ok || null }, 'Lancer');
  const why = g.ok ? null : el('p', { class: 'why' }, `génération indisponible : ${g.why || 'raison inconnue'}`);
  const m = modal({
    title: 'Générer un morceau', wide: true,
    body: [
      el('div', { class: `mu-engine${E.mode === 'factice' ? ' essai' : ''}` },
        el('b', {}, g.model || 'ACE-Step 1.5'), el('span', {}, g.ok ? `prêt${g.machine ? ` · ${g.machine}` : ''}` : 'indisponible'),
        E.mode === 'factice' ? el('span', { class: 'lbl' }, 'mode essai : un son synthétisé dans la tonalité et au tempo demandés, pour éprouver le parcours ; le modèle se branche plus tard') : null),
      why,
      lab('Titre', f.title),
      el('label', { class: 'field' }, el('span', { class: 'row' }, el('span', { class: 'lbl' }, 'Style'), el('span', { class: 'sp' }), count), f.tags),
      el('div', { class: 'row' }, el('label', { class: 'opt mu-check' }, f.inst, ' Instrumental (sans paroles)')),
      lab('Paroles', f.lyrics, 'facultatives, [Verse] [Chorus]…'),
      el('div', { class: 'mu-form4' }, lab('Durée (s)', f.dur, '10 à 600'), lab('Tempo', f.bpm), lab('Tonalité', f.key), lab('Mesure', f.ts),
        lab('Langue', f.lang), lab('Graine', f.seed)),
      el('p', { class: 'lbl' }, `le son se pose sur une piste audio neuve, à la mesure ${fmtBar(at)}, et entre dans la bibliothèque (dossier Musique)`),
    ],
    foot: [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Annuler'), go],
  });
  go.addEventListener('click', async () => {
    const body = {
      title: f.title.value.trim(), tags: f.tags.value.trim(), lyrics: f.inst.checked ? '' : f.lyrics.value.trim(),
      instrumental: f.inst.checked, duration: +f.dur.value, bpm: +f.bpm.value, keyscale: f.key.value,
      timesignature: f.ts.value, language: f.lang.value, seed: f.seed.value === '' ? null : +f.seed.value,
    };
    go.disabled = true;
    try {
      const j = await api('music/generate', { method: 'POST', body });
      P.pending.push({ job: j.id, kind: 'generate', at, title: j.params.title });
      app.commit('data');
      m.close();
      toast(`en file : ${j.title}`);
      jobs.poll(true);
    } catch (e) { toast(e.message, 5000); go.disabled = false; }
  });
}

async function runStems(clipId) {
  const c = app.clip(clipId);
  if (!c?.item) return;
  const E = await engines();
  if (!E.stems?.ok) { toast(`séparation indisponible : ${E.stems?.why || E.error}`, 5000); return; }
  try {
    const j = await api('music/stems', { method: 'POST', body: { item: c.item } });
    S.proj.pending.push({ job: j.id, kind: 'stems', clip: { track: c.track, start: c.start, len: c.len, off: c.off || 0 } });
    app.commit('data');
    toast(`en file : ${j.title}${E.mode === 'factice' ? ' (mode essai : des filtres, pas une vraie séparation)' : ''}`, 5000);
    jobs.poll(true);
  } catch (e) { toast(e.message, 5000); }
}

// Les travaux du projet : quand l'un finit, son son se pose sur la timeline.
const handled = new Set();
let unwatch = null;
function watchPending() {
  if (unwatch) unwatch();
  unwatch = jobs.watch(async (list) => {
    const P = S.proj;
    if (!P?.pending?.length) return;
    for (const pd of [...P.pending]) {
      if (handled.has(pd.job)) continue;
      let j = list.find((x) => x.id === pd.job);
      if (!j) { try { j = await api(`jobs/${pd.job}`); } catch { j = { state: 'error', message: 'travail perdu' }; } }
      if (!['done', 'error', 'cancelled', 'interrupted'].includes(j.state)) continue;
      handled.add(pd.job);
      if (P !== S.proj) return;
      P.pending = P.pending.filter((x) => x.job !== pd.job);
      if (j.state !== 'done') { toast(`${j.title || 'travail'} : ${stateFr(j.state)} — ${j.message || ''}`, 6000); app.commit('data'); continue; }
      const full = await api(`jobs/${pd.job}`);
      for (const it of full.items || []) items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
      if (pd.kind === 'generate') {
        for (const it of full.items || []) {
          const t = app.addTrack('audio', { name: (it.title || 'Généré').slice(0, 60) });
          P.clips.push({ id: uid('c'), track: t.id, start: pd.at || 0, len: Math.max(0.25, (it.duration || 10) * P.bpm / 60), item: it.id, off: 0 });
        }
        toast(`posé sur la timeline : ${full.title}`);
      } else if (pd.kind === 'stems') {
        const FR = { vocals: 'Voix', drums: 'Batterie', bass: 'Basse', other: 'Autre' };
        const src = app.track(pd.clip.track);
        let at = src ? P.tracks.indexOf(src) + 1 : P.tracks.length;
        for (const [stem, id] of Object.entries(full.result?.stems || {})) {
          const it = (full.items || []).find((x) => x.id === id);
          const t = app.addTrack('audio', { name: `${FR[stem] || stem}${src ? ` · ${src.name}` : ''}`.slice(0, 60), at: at++ });
          P.clips.push({ id: uid('c'), track: t.id, start: pd.clip.start, len: pd.clip.len, item: id, off: pd.clip.off });
          if (it) items.set(id, Promise.resolve({ ...it, href: href(it.url) }));
        }
        if (src) src.mute = true;
        toast('quatre pistes posées sous l\'original, qui est coupé');
      }
      app.commit('graph');
    }
  });
}

// ── exporter le mixage en WAV → la bibliothèque ─────────────
function openExport() {
  const P = S.proj;
  const end = songEnd(P);
  let range = P.loop.on ? 'loop' : 'song';
  const tail = el('input', { class: 'fld', type: 'number', min: 0, max: 20, step: 0.5, value: 2 });
  const title = el('input', { class: 'fld', maxlength: 80, value: `${P.name} · mixage` });
  const seg = el('div', { class: 'seg' });
  const opts = [['loop', `Boucle (${fmtBar(P.loop.a)} → ${fmtBar(P.loop.b)})`], ['song', `Morceau (01.1 → ${fmtBar(end)})`]];
  const paintSeg = () => put(seg, ...opts.map(([k, l]) => el('button', { class: `tb${range === k ? ' on' : ''}`, type: 'button',
    onclick: () => { range = k; paintSeg(); } }, l)));
  paintSeg();
  const out = el('div', { class: 'mu-export' });
  const empty = end <= 0 && !P.loop.on;
  const go = el('button', { class: 'tb go', type: 'button', disabled: empty || null,
    title: empty ? 'rien à exporter : pose un clip sur la timeline, ou règle une boucle' : '' }, 'Exporter');
  const m = modal({
    title: 'Exporter le mixage', wide: true,
    body: [
      el('p', {}, 'Le mixage est rendu dans la page, hors temps réel, par le même graphe que la lecture (OfflineAudioContext) : WAV 24 bits, 48 kHz, stéréo. Il entre dans la bibliothèque, prêt pour le montage.'),
      el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'Étendue'), seg),
      el('div', { class: 'mu-form4' }, el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'Queue (s)', el('b', {}, ' · réverbérations, chutes')), tail),
        el('label', { class: 'field wide' }, el('span', { class: 'lbl' }, 'Titre'), title)),
      out,
    ],
    foot: [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Fermer'), go],
  });
  go.addEventListener('click', async () => {
    const [a, b] = range === 'loop' ? [P.loop.a, P.loop.b] : [0, end];
    if (b <= a) { toast('rien à exporter : pas de clip'); return; }
    go.disabled = true;
    const say = (t) => put(out, el('p', { class: 'lbl' }, t));
    try {
      say('rendu du mixage…');
      const t0 = performance.now();
      const buf = await renderMix(engine, P, a, b, { tail: Math.max(0, +tail.value || 0) });
      const pk = peakDb(buf);
      say('encodage WAV…');
      const blob = wav24(buf);
      say('dépôt dans la bibliothèque…');
      const name = `${(title.value.trim() || P.name).replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 60)}.wav`;
      const it = await uploadFile(new File([blob], name, { type: 'audio/wav' }), { tool: 'music', folder: 'Musique', title: title.value.trim() || P.name });
      items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      window.__muLastExport = { id: it.id, url: it.url, peak: pk, duration: buf.duration, secs: +secs };
      put(out,
        el('div', { class: 'mu-done' },
          el('div', {}, el('b', {}, it.title), el('span', { class: 'lbl' }, ` ${fmtDur(buf.duration)} · crête ${pk.toFixed(1)} dBFS · rendu en ${secs} s`)),
          pk > -0.1 ? el('p', { class: 'warn' }, 'la crête touche 0 dBFS : le mixage sature, baisse la sortie ou les pistes') : null,
          el('audio', { src: href(it.url), controls: true, preload: 'metadata' }),
          el('div', { class: 'row' },
            el('a', { class: 'tb ghost', href: href(`montage/?add=${encodeURIComponent(it.id)}`) }, 'Envoyer au montage'),
            el('a', { class: 'tb ghost', href: href('asset/') }, 'Voir dans Asset'))));
      go.disabled = false;
    } catch (e) { say(''); toast(`export : ${e.message}`, 6000); go.disabled = false; }
  });
}

// ── démarrage ───────────────────────────────────────────────
(async () => {
  try {
    await loadList();
    if (!S.list.length) {
      const p = await api('music/projects', { method: 'POST', body: { name: 'Premier projet' } });
      S.list = [{ id: p.id, name: p.name }];
    }
    const q = new URLSearchParams(location.search).get('p');
    let last = null;
    try { last = localStorage.getItem('mu:last'); } catch { /* stockage refusé */ }
    const id = [q, last].find((x) => x && S.list.some((p) => p.id === x)) || S.list[0].id;
    await openProject(id);
    engines();
  } catch (e) {
    put(viewBox, el('p', { class: 'warn' }, `le portail ne répond pas : ${e.message}`));
  }
})();

// pour les essais pilotés (playwright) : l'état, le moteur, l'export
window.__mu = { S, app, engine, renderMix, wav24, peakDb };
export { DRUM_VOICES };
