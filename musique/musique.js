// ODIO — le studio musique du portail : une DAW.
//   Arrangement  sections, arc d'énergie, pistes, clips, automation ; en
//                bas la vue de détail (le clip choisi, ou les instruments
//                et effets de la piste), à gauche le navigateur
//   Console      faders, panoramiques, envois vers les bus, vu-mètres, sortie
//   Nodal        le graphe des modules et de leurs câbles (le même projet),
//                et en bas le banc d'ODIO_01 (banc.js) ; Tab bascule
//                Arrangement ↔ Nodal
// Autour : le transport (retour, lecture, stop, prise, boucle, métronome),
// la position mesure.temps.double-croche, le tempo (et sa frappe), la
// tonalité, la forme d'onde de la session, annuler / rétablir, Générer (YuE,
// ACE-Step, séparation en pistes), Exporter (mixage et stems), et le GUIDE.
// Les raccourcis sont ceux de Live 12 (guide.js en donne la table et la source).
// Le projet s'enregistre seul (server/tools/music.py) ; le moteur
// (moteur.js) le joue ; ce qu'on entend est ce qu'on exporte.

import { mountHeader, api, jobs, pick, uploadFile, toast, $, href, fmtDur, stateFr } from '../commun/shell.js';
import { Engine, renderMix, renderClips, wav24, peakDb, songEnd, peaks } from './moteur.js';
import { MODULES, TRACK_KINDS, COLORS, PRESETS, SOURCES_OF, DRUM_MODELS, NOTE_MODELS, TONICS, TONICS_FR, MODES,
  kindOfSource, keyLabel, moduleName } from './modules.js';
import { el, modal, ask, confirmBox, menu, put, tok } from './ui.js';
import { migrate, History, copyClips, pasteClips, splitClip, consolidatePatterns, clipRate } from './projet.js';
import { createTimeline } from './timeline.js';
import { createConsole } from './console.js';
import { createNodal } from './nodal.js';
import { createJouets } from './jouets/index.js';   // jouets : les jouets du Playground de Cal
import { createRecorder } from './enregistrement.js';
import { openGenerative, options, bestStems, STEM_FR } from './generatif.js';
import { GEN_KINDS, genJobDone } from './generatif_region.js';   // génératif : les prises d'une région, sa partition, le MIDI extrait
import { openGuide } from './guide.js';

mountHeader('music', { sub: 'studio · YuE · stems' });

// ── l'état ──────────────────────────────────────────────────
const S = {
  proj: null, list: [], view: 'timeline', engines: null,
  sel: { track: null, pat: null, clip: null, clips: [], mod: null, cable: null },
  oct: 4, vel: 0.85, kbd: true, midi: null, rec: false, metro: false,
};
const items = new Map();   // les objets de la bibliothèque déjà lus
async function loadItem(id) {
  if (!items.has(id)) items.set(id, api(`library/${id}`).then((it) => ({ ...it, href: href(it.url) })));
  return items.get(id);
}
const engine = new Engine({ loadItem });
engine.onstop = () => { if (rec.active) rec.end(); paintTransport(); views[S.view]?.frame?.(engine.position()); };
engine.onplay = () => { if (S.rec) rec.begin(); paintTransport(); };

export const uid = (p) => p + Math.random().toString(36).slice(2, 9);

// ── l'application, telle que les vues la voient ────────────
export const app = {
  S, engine, items, loadItem, uid, board: null,
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
    else if (kind === 'data') { engine.need(S.proj); engine.settle(); }
    save();
    hist.mark();
    overviewSoon();
    if (kind !== 'param' && kind !== 'quiet') render();
  },
  saveUi() { saveQuiet(); },
  renderView: () => render(),
  kbdOn: () => S.kbd,
  playStop: () => togglePlay(),

  // choisir une piste (clic sur son en-tête) : ses clips ne sont plus choisis
  selectTrack(id) {
    const t = app.track(id);
    if (!t) return;
    Object.assign(S.sel, { track: id, pat: t.pat || null, clip: null, clips: [], mod: null });
    if (views[S.view]?.paintSel) views[S.view].paintSel(); else render();
  },
  // la vue de détail en bas : 'clip' ou 'device' (Live : Clip View, Device View)
  showDetail(which) {
    S.proj.ui.detail = which;
    S.proj.ui.dock = true;
    saveQuiet();
    if (S.view !== 'timeline') app.setView('timeline'); else render();
  },

  select(patch) {
    Object.assign(S.sel, patch);
    if (patch.track && !patch.pat) {
      const t = app.track(patch.track);
      if (t?.pat) S.sel.pat = t.pat;
      if (!patch.clip) { S.sel.clip = null; S.sel.clips = []; }
    }
    render();
  },
  selectClips(ids, keep = false) {
    S.sel.clips = [...ids];
    S.sel.clip = ids[ids.length - 1] || null;
    const c = app.clip(S.sel.clip);
    if (c) S.sel.track = c.track;
    if (!keep) render();
  },

  setView(v) {
    // l'ancienne vue Rack est la vue de détail « Instruments » de l'arrangement
    if (v === 'rack') { S.proj.ui = { ...(S.proj.ui || {}), detail: 'device', dock: true }; v = 'timeline'; }
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
    app.showDetail('clip');
  },

  // ── pistes ──
  addTrack(kind, { name, color, at, type, params, sub } = {}) {
    const P = S.proj, K = TRACK_KINDS[kind];
    const n = P.tracks.filter((t) => t.kind === kind).length + 1;
    const y = Math.max(0, ...P.modules.filter((m) => m.track).map((m) => m.y)) + 260;
    const src = type || K.src;
    const t = {
      id: uid('t'), name: name || `${kind === 'bus' ? 'Bus' : kind === 'audio' ? 'Audio' : MODULES[src].name} ${n}`.slice(0, 60), kind,
      color: color || (kind === 'audio' ? 'grn2' : MODULES[src].color || COLORS[P.tracks.length % COLORS.length]),
      mute: false, solo: false, src: uid('m'), strip: uid('m'),
    };
    if (sub) t.sub = sub.slice(0, 60);
    const mst = app.master();
    P.modules.push({ id: t.src, type: src, track: t.id, x: 40, y, on: true, params: { ...(params || {}) } },
      { id: t.strip, type: 'strip', track: t.id, x: 380, y, on: true, params: {} });
    P.cables.push({ a: t.src, b: t.strip }, { a: t.strip, b: mst.id });
    if (K.pattern) {
      const p = K.pattern === 'drums'
        ? { id: uid('p'), track: t.id, name: 'Motif 1', steps: 16, lanes: {} }
        : { id: uid('p'), track: t.id, name: 'Motif 1', steps: 16, notes: [] };
      P.patterns.push(p);
      t.pat = p.id;
    }
    if (at === undefined) {
      // les bus restent en bas de la liste
      const firstBus = kind === 'bus' ? -1 : P.tracks.findIndex((x) => x.kind === 'bus');
      if (firstBus >= 0) P.tracks.splice(firstBus, 0, t); else P.tracks.push(t);
    } else P.tracks.splice(at, 0, t);
    if (kind !== 'bus') { S.sel.track = t.id; S.sel.pat = t.pat || null; }
    return t;
  },

  // les pistes qu'on peut ajouter, pour un menu
  trackChoices() {
    const out = [{ head: 'une piste' }];
    for (const [k, list] of Object.entries(SOURCES_OF)) {
      if (k === 'bus') continue;
      for (const type of list) out.push({ label: k === 'audio' ? 'Audio' : `${TRACK_KINDS[k].label} · ${MODULES[type].name}`, sub: k === 'audio' ? 'clips, import, micro' : MODULES[type].kind,
        dot: MODULES[type].color, onclick: () => { app.addTrack(k, { type }); app.commit('graph'); } });
    }
    out.push('-', { label: 'Bus d\'effets (réverbération)', sub: 'retour de la console', dot: 'cy', onclick: () => app.addBus('reverb') });
    return out;
  },

  // un bus d'effets : entrée → effet → tranche → sortie ; les pistes y envoient
  addBus(fx) {
    const t = app.addTrack('bus', { name: fx ? `${MODULES[fx].name}` : 'Bus', color: fx ? MODULES[fx].color : 'cy' });
    if (fx) {
      // un retour ne rend que l'effet : le son sec est déjà dans la piste
      const m = app.addEffect(t.id, fx, { quiet: true });
      m.params = MODULES[fx].odio ? { mix: 100 } : fx === 'delay' ? { mix: 1, dry: 1 } : { mix: 1 };
    }
    toast(`bus « ${t.name} » : ses envois sont dans la console`);
    app.commit('graph');
    return t;
  },

  // changer l'instrument d'une piste : la source garde son identifiant et
  // ses câbles ; ses réglages repartent de zéro (ils ne se traduisent pas)
  setSource(trackId, type, params = {}) {
    const t = app.track(trackId), m = t && app.mod(t.src);
    if (!m || !(SOURCES_OF[t.kind] || []).includes(type)) return;
    m.type = type; m.params = { ...params };
    t.sub = undefined;
    toast(`${t.name} : ${MODULES[type].name}`);
    app.commit('graph');
  },
  preset: (id) => PRESETS.find((x) => x.id === id) || (S.proj.presets || []).find((x) => x.id === id),
  applyPreset(trackId, presetId) {
    const t = app.track(trackId), p = app.preset(presetId);
    if (!t || !p) return;
    const m = app.mod(t.src);
    if (m.type !== p.type) m.type = p.type;
    m.params = { ...p.params };
    t.sub = p.sub || p.name;
    toast(`${t.name} : ${p.name}`);
    app.commit('graph');
  },
  // garder le réglage de la source d'une piste dans le projet : il s'ajoute
  // au navigateur (Préréglages, Les miens), où un double-clic le renomme
  savePreset(trackId) {
    const t = app.track(trackId), m = t && app.mod(t.src);
    if (!m) return null;
    const P = S.proj;
    P.presets = P.presets || [];
    if (P.presets.length >= 200) { toast('200 réglages au plus par projet'); return null; }
    const n = P.presets.filter((x) => x.type === m.type).length + 1;
    const p = { id: uid('r'), name: `${MODULES[m.type].name} ${n}`.slice(0, 40), type: m.type, params: JSON.parse(JSON.stringify(m.params || {})) };
    P.presets.push(p);
    P.ui.navOpen = { ...(P.ui.navOpen || { inst: true, son: true }), pre: true };
    if (P.ui.nav === false) P.ui.nav = true;
    toast(`réglage « ${p.name} » gardé : navigateur, Préréglages · double-clic pour le renommer`, 5000);
    app.commit('data');
    return p;
  },

  async removeTrack(id) {
    const t = app.track(id);
    if (!t) return;
    if (!(await confirmBox('Retirer la piste', `Retirer « ${t.name} », ses modules, ses motifs, ses clips et ses courbes ?`))) return;
    const P = S.proj;
    const mods = new Set(P.modules.filter((m) => m.track === id).map((m) => m.id));
    P.modules = P.modules.filter((m) => !mods.has(m.id));
    P.cables = P.cables.filter((c) => !mods.has(c.a) && !mods.has(c.b));
    P.patterns = P.patterns.filter((p) => p.track !== id);
    P.clips = P.clips.filter((c) => c.track !== id);
    P.auto = (P.auto || []).filter((L) => !mods.has(L.mod));
    P.tracks = P.tracks.filter((x) => x.id !== id);
    const first = P.tracks.find((x) => x.kind !== 'bus');
    if (S.sel.track === id) S.sel = { track: first?.id || null, pat: first?.pat || null, clip: null, clips: [], mod: null, cable: null };
    app.commit('graph');
  },

  // ── la chaîne d'une piste : source → effets → tranche ──
  chain(trackId) {
    const t = app.track(trackId);
    if (!t) return [];
    const P = S.proj, out = [t.src], seen = new Set(out);
    let cur = t.src;
    for (;;) {
      const next = P.cables.map((c) => c.a === cur && typeof c.send !== 'number' && !c.t && app.mod(c.b)).find((m) => m && m.track === trackId && !seen.has(m.id));   // jouets : !c.t, le son seul
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
    P.cables = P.cables.filter((c) => c.t || !drop.has(`${c.a}>${c.b}`));   // jouets : c.t, les câbles de notes et de valeur restent
    for (const k of pairs(mods.map((m) => m.id))) {
      const [a, b] = k.split('>');
      if (!P.cables.some((c) => c.a === a && c.b === b && !c.t)) P.cables.push({ a, b });   // jouets : !c.t
    }
  },

  addEffect(trackId, type, { x, y, quiet = false } = {}) {
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
        if (x === undefined) st.x = m.x + Math.max(320, (app.toys?.width(m) || 0) + 84);   // jouets : une carte de jouet est plus large
      }
    }
    S.sel.mod = m.id;
    if (!quiet) app.commit('graph');
    return m;
  },

  removeModule(id) {
    const P = S.proj, m = app.mod(id);
    if (!m || MODULES[m.type].role !== 'effect') return;
    const ins = P.cables.filter((c) => c.b === id && typeof c.send !== 'number' && !c.t).map((c) => c.a);   // jouets : !c.t, le son seul se referme
    const outs = P.cables.filter((c) => c.a === id && !c.t).map((c) => c.b);   // jouets : idem
    P.cables = P.cables.filter((c) => c.a !== id && c.b !== id);
    P.modules = P.modules.filter((x) => x.id !== id);
    P.auto = (P.auto || []).filter((L) => L.mod !== id);
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
      for (const c of P.cables) if (c.a === n && !c.t) stack.push(c.b);   // jouets : !c.t, une boucle de son seulement
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

  // ── motifs et clips ──
  newPattern(trackId, from = null, { name, quiet = false } = {}) {
    const t = app.track(trackId), P = S.proj;
    const n = P.patterns.filter((p) => p.track === trackId).length + 1;
    const base = from ? JSON.parse(JSON.stringify(from)) : (TRACK_KINDS[t.kind].pattern === 'drums'
      ? { steps: P.sig * 4, lanes: {} } : { steps: P.sig * 4, notes: [] });
    const p = { ...base, id: uid('p'), track: trackId, name: name || (from ? `${from.name} bis`.slice(0, 40) : `Motif ${n}`) };
    P.patterns.push(p);
    t.pat = p.id; S.sel.pat = p.id;
    if (!quiet) app.commit('data');
    return p;
  },
  // un clip neuf d'une mesure, sur un motif vide « Nouveau »
  newClip(trackId, b) {
    const t = app.track(trackId);
    if (!t || !TRACK_KINDS[t.kind].pattern) return null;
    const p = app.newPattern(trackId, null, { name: 'Nouveau', quiet: true });
    return app.addClip(trackId, b, { pat: p.id, len: S.proj.sig });
  },
  addClip(trackId, start, extra = {}) {
    const t = app.track(trackId);
    const c = { id: uid('c'), track: trackId, start: Math.max(0, start), ...extra };
    if (t.kind !== 'audio') {
      const p = app.pat(extra.pat || t.pat);
      c.pat = p.id;
      c.len = extra.len || p.steps / 4;
    }
    S.proj.clips.push(c);
    S.sel.clip = c.id; S.sel.clips = [c.id]; S.sel.track = trackId;
    app.commit('data');
    return c;
  },
  uniqueClip(id) {
    const c = app.clip(id);
    if (!c?.pat) return;
    const p = app.newPattern(c.track, app.pat(c.pat), { quiet: true });
    c.pat = p.id;
    toast(`ce clip joue maintenant « ${p.name} »`);
    app.commit('data');
  },

  async addAudio(trackId, at) {
    const got = await pick({ kinds: ['audio'], multiple: true, title: 'Des sons de la bibliothèque' });
    if (got.length) app.placeItems(got, { track: trackId, at: at ?? engine.position() });
  },

  // Des sons de la bibliothèque sur l'arrangement. `track` : une piste audio
  // (ils s'y suivent) ; sinon une piste audio neuve (ou une par son, `perTrack`).
  async placeItems(list, { track = null, at = 0, perTrack = false, names = null } = {}) {
    const P = S.proj;
    const its = await Promise.all(list.map((x) => (typeof x === 'string' ? loadItem(x) : Promise.resolve({ ...x, href: href(x.url) }))));
    let t = track && app.track(track);
    if (t && t.kind !== 'audio') t = null;
    let start = at;
    const placed = [];
    for (const [i, it] of its.entries()) {
      items.set(it.id, Promise.resolve(it));
      let dur = it.duration;
      if (!dur) { try { dur = (await engine.buffer(it.id)).duration; } catch { dur = 4; } }
      const len = Math.max(0.25, dur * P.bpm / 60);
      if (!t || perTrack) t = app.addTrack('audio', { name: (names?.[i] || it.title || 'Audio').slice(0, 60) });
      const c = { id: uid('c'), track: t.id, start: perTrack ? at : start, len, item: it.id, off: 0 };
      P.clips.push(c);
      placed.push(c);
      if (!perTrack) start += len;
    }
    if (placed.length) app.selectClips(placed.map((c) => c.id), true);
    app.commit('graph');
    document.dispatchEvent(new CustomEvent('mu:placed'));
    return placed;
  },

  // Des fichiers du disque : la bibliothèque (catégorie Upload), puis l'arrangement
  async importFiles(files, { track = null, at = 0, perTrack = false } = {}) {
    const got = [];
    for (const [i, f] of files.entries()) {
      toast(files.length > 1 ? `import ${i + 1} / ${files.length} · ${f.name}` : `import · ${f.name}`, 60000);
      try { got.push(await uploadFile(f, { tool: 'upload', via: 'odio', folder: '' })); } catch (e) { toast(`${f.name} : ${e.message}`, 6000); }
    }
    if (!got.length) return;
    const audio = got.filter((it) => it.kind === 'audio');
    if (audio.length < got.length) toast('un fichier n\'est pas un son : il reste dans la bibliothèque', 5000);
    if (audio.length) {
      await app.placeItems(audio, { track, at, perTrack });
      toast(`${audio.length} son${audio.length > 1 ? 's' : ''} importé${audio.length > 1 ? 's' : ''} · rangé${audio.length > 1 ? 's' : ''} dans la bibliothèque (Upload)`);
    }
  },

  // ce qu'on lâche depuis le navigateur (ou un son glissé du portail)
  async dropItem(d, trackId, at) {
    const P = S.proj;
    const t = trackId && app.track(trackId);
    if (d.t === 'inst') {
      if (d.kind === 'audio') { const n = app.addTrack('audio'); app.commit('graph'); return n; }
      if (t && t.kind === d.kind) { app.setSource(t.id, d.type); return t; }
      app.addTrack(d.kind, { type: d.type }); app.commit('graph'); return null;
    }
    if (d.t === 'fx') { if (!t) { toast('glisser l\'effet sur une piste'); return null; } return app.addEffect(t.id, d.type); }
    if (d.t === 'bus') return app.addBus(d.fx);
    if (d.t === 'preset') {
      const p = app.preset(d.id);
      if (!p) return null;
      if (t && app.mod(t.src)?.type === p.type) { app.applyPreset(t.id, p.id); return t; }
      const k = kindOfSource(p.type);
      if (t && t.kind === k) { app.applyPreset(t.id, p.id); return t; }
      const n = app.addTrack(k, { type: p.type, params: p.params, name: p.name, sub: p.sub });
      app.commit('graph'); return n;
    }
    if (d.t === 'son') {
      if (t?.kind === 'sampler') {
        const m = app.mod(t.src);
        items.set(d.item.id, Promise.resolve({ ...d.item, href: href(d.item.url) }));
        m.params.item = d.item.id;
        await engine.buffer(d.item.id).catch(() => {});
        toast(`${t.name} joue « ${d.item.title} »`);
        app.commit('graph'); return t;
      }
      return app.placeItems([d.item], { track: t?.kind === 'audio' ? t.id : null, at });
    }
    if (d.t === 'motif') {
      const p = app.pat(d.pat);
      if (!p) return null;
      if (!t || t.id === p.track) return app.addClip(p.track, at, { pat: p.id });
      const src = app.track(p.track);
      if (TRACK_KINDS[t.kind].pattern !== TRACK_KINDS[src.kind].pattern) { toast('ce motif ne va que sur une piste de la même sorte'); return null; }
      const cp = app.newPattern(t.id, p, { quiet: true, name: p.name });
      return app.addClip(t.id, at, { pat: cp.id });
    }
    if (d.t === 'modele') {
      const want = d.kind === 'drums' ? 'drums' : 'notes';
      let tt = t && TRACK_KINDS[t.kind].pattern === want ? t : null;
      if (!tt) tt = app.addTrack(d.kind === 'drums' ? 'drums' : 'synth', { type: d.kind === 'drums' ? 'rythme' : 'synth' });
      const m = d.kind === 'drums' ? DRUM_MODELS.find((x) => x.id === d.id) : NOTE_MODELS.find((x) => x.id === d.id);
      const g = d.kind === 'drums' ? { steps: 16, lanes: JSON.parse(JSON.stringify(m.lanes)) } : m.make(P.key, P.sig);
      const p = app.newPattern(tt.id, null, { quiet: true, name: m.name });
      Object.assign(p, g);
      return app.addClip(tt.id, at, { pat: p.id });
    }
    return null;
  },

  // ── la sélection de clips ──
  selected: () => S.proj.clips.filter((c) => (S.sel.clips || []).includes(c.id)),
  splitAtPlayhead() {
    const pos = Math.round(engine.position() * 4) / 4;
    const g = app.selected().length ? app.selected() : S.proj.clips.filter((c) => c.track === S.sel.track);
    const made = [];
    for (const c of g) { const n = splitClip(S.proj, c, pos, uid); if (n) made.push(n); }
    if (!made.length) { toast('la tête de lecture n\'est dans aucun clip choisi'); return; }
    S.sel.clips = made.map((c) => c.id); S.sel.clip = made[0].id;
    app.commit('data');
  },
  duplicateSel() {
    const g = app.selected();
    if (!g.length) return;
    const b = copyClips(S.proj, g.map((c) => c.id));
    const made = pasteClips(S.proj, b, b.base + b.len, uid);
    S.sel.clips = made.map((c) => c.id); S.sel.clip = made[made.length - 1]?.id || null;
    app.commit('data');
  },
  copySel() { const b = copyClips(S.proj, S.sel.clips || []); if (b) { app.board = b; toast(`${b.items.length} clip${b.items.length > 1 ? 's' : ''} copié${b.items.length > 1 ? 's' : ''}`); } },
  cutSel() { app.copySel(); app.removeSel(); },
  paste() {
    if (!app.board) { toast('rien à coller : Ctrl+C sur des clips'); return; }
    const at = Math.round(engine.position() * 4) / 4;
    const made = pasteClips(S.proj, app.board, at, uid, S.sel.track);
    if (!made.length) { toast('rien à coller ici : les pistes d\'origine ont disparu'); return; }
    S.sel.clips = made.map((c) => c.id); S.sel.clip = made[made.length - 1].id;
    app.commit('data');
  },
  removeSel() {
    const ids = new Set(S.sel.clips || []);
    if (!ids.size) return;
    S.proj.clips = S.proj.clips.filter((c) => !ids.has(c.id));
    S.sel.clips = []; S.sel.clip = null;
    app.commit('data');
  },
  muteSel() {
    const g = app.selected();
    const to = !g.every((c) => c.mute);
    for (const c of g) c.mute = to || undefined;
    app.commit('data');
  },
  // la boucle d'un clip audio : l'accolade prend la région jouée (du
  // marqueur de début à celui de fin) ; sans boucle, la fin revient au son
  async toggleLoop(id) {
    const c = app.clip(id);
    if (!c?.item) return;
    const rate = clipRate(c);
    if (c.loop) {
      c.loop = undefined; c.ls = undefined; c.llen = undefined;
      const buf = engine.buffers.get(c.item);
      if (buf) c.len = Math.min(c.len, (buf.duration - (c.off || 0)) / rate * S.proj.bpm / 60);
    } else {
      const buf = await engine.buffer(c.item).catch(() => null);
      c.loop = true;
      c.ls = c.off || 0;
      c.llen = Math.round(Math.max(0.02, Math.min(c.len * 60 / S.proj.bpm * rate, buf ? buf.duration - c.ls : 4)) * 1000) / 1000;
      toast('en boucle : tirer le bord droit du clip répète le son');
    }
    app.commit('data');
  },
  // R (Live : « Reverse audio clip selection ») : le son à l'envers ; les
  // marqueurs sont retournés avec lui, la même région joue, de la fin au début
  async reverseSel(ids = null) {
    const g = (ids ? ids.map(app.clip) : app.selected()).filter((c) => c?.item);
    if (!g.length) { toast('R inverse les clips audio choisis'); return; }
    for (const c of g) {
      const buf = await engine.buffer(c.item).catch(() => null);
      if (!buf) continue;
      const D = buf.duration, rate = clipRate(c);
      if (c.loop) {
        // l'accolade se retourne ; un début posé sur elle y reste
        const off = c.off || 0, ls = c.ls ?? off, le = Math.min(D, ls + (c.llen || D - ls));
        c.ls = Math.round(Math.max(0, D - le) * 1e6) / 1e6; c.llen = le - ls;
        c.off = Math.abs(off - ls) < 1e-6 ? c.ls : Math.max(0, Math.min(D - 0.01, D - off));
      } else {
        const end = Math.min(D, (c.off || 0) + c.len * 60 / S.proj.bpm * rate);
        c.off = Math.round(Math.max(0, D - end) * 1e6) / 1e6;
      }
      c.rev = !c.rev || undefined;
    }
    toast(g.length > 1 ? `${g.length} clips inversés` : (g[0].rev ? 'le son joue à l\'envers' : 'le son joue à l\'endroit'));
    app.commit('data');
  },
  // Ctrl+L (Live : « Loop selection ») : la boucle sur les clips choisis ;
  // sans clip choisi, la boucle s'allume ou s'éteint
  loopSelection() {
    const g = app.selected(), P = S.proj;
    if (!g.length) { P.loop.on = !P.loop.on; app.commit('meta'); return; }
    const a = Math.min(...g.map((c) => c.start)), b = Math.max(...g.map((c) => c.start + c.len));
    P.loop = { on: true, a, b };
    toast(`boucle : ${fmtBar(a)} → ${fmtBar(b)}`);
    app.commit('meta');
  },
  // Ctrl+J (Live : « Consolidate ») : les clips choisis d'une piste en un
  // seul. Motifs : un motif neuf qui contient ce qu'ils jouaient ; sons :
  // leur son rendu tel qu'ils le lisent (moteur.js, renderClips), en WAV
  // dans la bibliothèque (dossier Musique), sans les effets de la piste.
  async consolidateSel() {
    const P = S.proj, g = app.selected();
    if (!g.length) { toast('Ctrl+J : choisis des clips'); return; }
    const byTrack = new Map();
    for (const c of g) { if (!byTrack.has(c.track)) byTrack.set(c.track, []); byTrack.get(c.track).push(c); }
    const made = [];
    for (const [tid, cs] of byTrack) {
      const t = app.track(tid);
      if (t.kind === 'audio') {
        const a = Math.min(...cs.map((c) => c.start)), b = Math.max(...cs.map((c) => c.start + c.len));
        toast(`consolidation · ${t.name}…`, 20000);
        try {
          const buf = await renderClips(engine, P, cs, a, b);
          const name = `${`${t.name} consolidé`.replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 60)}.wav`;
          const it = await uploadFile(new File([wav24(buf)], name, { type: 'audio/wav' }), { tool: 'music', folder: 'Musique', title: `${t.name} · consolidé` });
          items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
          const ids = new Set(cs.map((c) => c.id));
          P.clips = P.clips.filter((c) => !ids.has(c.id));
          const n = { id: uid('c'), track: tid, start: a, len: b - a, item: it.id, off: 0 };
          P.clips.push(n); made.push(n);
        } catch (e) { toast(`consolider : ${e.message}`, 6000); }
      } else {
        const r = consolidatePatterns(P, cs, uid);
        if (typeof r === 'string') { toast(`consolider ${t.name} : ${r}`, 5000); continue; }
        const ids = new Set(cs.map((c) => c.id));
        P.clips = P.clips.filter((c) => !ids.has(c.id));
        P.patterns.push(r.pattern);
        P.clips.push(r.clip); made.push(r.clip);
      }
    }
    if (!made.length) return;
    S.sel.clips = made.map((c) => c.id); S.sel.clip = made[0].id;
    toast(made.length > 1 ? `${made.length} clips consolidés (un par piste)` : 'consolidé : un seul clip');
    app.commit('data');
  },

  addMarker(b) {
    const P = S.proj;
    const m = { id: uid('k'), b: Math.max(0, Math.round(b * 4) / 4), name: `Repère ${P.markers.length + 1}` };
    P.markers.push(m);
    app.commit('data');
    return m;
  },
  addAuto(modId, k) {
    const P = S.proj, m = app.mod(modId);
    if (!m || P.auto.some((L) => L.mod === modId && L.k === k)) return;
    P.auto.push({ id: uid('a'), mod: modId, k, on: true, pts: [] });
    if (m.track) P.ui.auto = { ...(P.ui.auto || {}), [m.track]: true };
    toast(`automation : ${moduleName(m.type)} · ${MODULES[m.type].params.find((x) => x.k === k)?.label} — peindre la courbe`);
    app.commit('data');
  },

  // ── la génération et la séparation ──
  generate: () => openGenerative(app),
  engines,
  stems: (clipId) => {
    const c = app.clip(clipId);
    if (c?.item) runStems(c.item, { track: c.track, start: c.start, len: c.len, off: c.off || 0, gain: c.gain, clip: c.id });
  },
  stemsItem: (itemId) => runStems(itemId, null),
  exportMix: () => openExport(),
  paintTransport: () => paintTransport(),
};
const rec = createRecorder(app);
app.rec = rec;
app.toys = createJouets(app);   // jouets : les jouets posés, leur boucle, leurs câbles de notes et de valeur

function fmtBar(beat) {
  const b = Math.max(0, beat), bpb = S.proj?.sig || 4;
  const bar = Math.floor(b / bpb) + 1, bt = Math.floor(b % bpb) + 1;
  return `${String(bar).padStart(2, '0')}.${bt}`;
}
// la position comme sur le transport : mesure.temps.double-croche
function fmtPos(beat) {
  const b = Math.max(0, beat + 1e-9), sig = S.proj?.sig || 4;
  const bar = Math.floor(b / sig) + 1, bt = Math.floor(b % sig) + 1, six = Math.floor((b % 1) * 4) + 1;
  return `${String(Math.min(999, bar)).padStart(3, '0')}.${bt}.${six}`;
}
// le temps, toujours sur sept signes : mm:ss.d (dixièmes tronqués, pas
// arrondis : 59,97 s reste 00:59.9)
function fmtClock(sec) {
  const t = Math.max(0, Math.floor(sec * 10)), m = Math.min(99, Math.floor(t / 600)), r = t % 600;
  return `${String(m).padStart(2, '0')}:${String(Math.floor(r / 10)).padStart(2, '0')}.${r % 10}`;
}
// Le compteur ne pousse rien : un signe par case de largeur fixe (chiffres
// et ponctuation ont chacun la leur, musique.css), la boîte a sa largeur ;
// seules les cases qui changent sont récrites.
function setCue(node, str) {
  if (node.childElementCount !== str.length) {
    node.replaceChildren(...[...str].map((ch) => el('i', { class: /\d/.test(ch) ? 'd' : 'p' }, ch)));
    return;
  }
  for (let i = 0; i < str.length; i++) { const k = node.children[i]; if (k.textContent !== str[i]) k.textContent = str[i]; }
}

// ── l'enregistrement du projet ──────────────────────────────
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

// ── annuler, rétablir ───────────────────────────────────────
const hist = new History(() => S.proj, (o) => {
  const p = S.proj;
  for (const k of Object.keys(o)) p[k] = o[k];
  const ok = new Set(p.clips.map((c) => c.id));
  S.sel.clips = (S.sel.clips || []).filter((id) => ok.has(id));
  if (!ok.has(S.sel.clip)) S.sel.clip = null;
  if (!app.track(S.sel.track)) S.sel.track = p.tracks[0]?.id || null;
  engine.setProject(p);
  save(); overviewSoon();
  render(true);
});
function undo() { if (!hist.back()) toast('rien à annuler'); }
function redo() { if (!hist.fwd()) toast('rien à rétablir'); }

// ── les projets ─────────────────────────────────────────────
async function openProject(id) {
  if (engine.running) engine.stop();
  const p = migrate(await api(`music/projects/${id}`));
  S.proj = p;
  S.view = MAKERS[p.ui?.view] ? p.ui.view : 'timeline';
  const t0 = p.tracks.find((t) => t.kind !== 'bus');
  S.sel = { track: t0?.id || null, pat: t0?.pat || null, clip: null, clips: [], mod: null, cable: null };
  engine.pos = 0;
  engine.setProject(p);
  history.replaceState(null, '', `?p=${id}`);
  try { localStorage.setItem('mu:last', id); } catch { /* stockage refusé */ }
  status('enregistré');
  hist.reset();
  for (const k of Object.keys(views)) delete views[k];
  render(true);
  watchPending();
  overviewSoon(100);
}

async function newProject() {
  const name = el('input', { class: 'fld', maxlength: 80, value: '', placeholder: 'Nom du projet' });
  let tpl = 'session';
  const cards = el('div', { class: 'mu-tpls' });
  const T = [['session', 'Session', '16 mesures en 4 sections (intro, couplet, refrain, final), batterie, basse acide, nappe, lead, deux bus — comme la maquette NL—60'],
    ['rythme', 'Batterie et basse', 'huit mesures qui tournent : de quoi entendre tout de suite'], ['vide', 'Vide', 'rien que la sortie']];
  const paintT = () => put(cards, ...T.map(([k, t, s]) => el('button', { class: `mu-tpl${tpl === k ? ' on' : ''}`, type: 'button', onclick: () => { tpl = k; paintT(); } }, el('b', {}, t), el('span', {}, s))));
  paintT();
  const go = el('button', { class: 'tb go', type: 'button' }, 'Créer');
  const m = modal({ title: 'Nouveau projet', wide: true,
    body: [el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'Nom'), name), el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'Départ'), cards)],
    foot: [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Annuler'), go] });
  setTimeout(() => name.focus(), 30);
  go.addEventListener('click', async () => {
    const n = name.value.trim() || 'Sans titre';
    go.disabled = true;
    try {
      const p = await api('music/projects', { method: 'POST', body: { name: n, template: tpl } });
      S.list.unshift({ id: p.id, name: p.name });
      m.close();
      await openProject(p.id);
    } catch (e) { toast(e.message); go.disabled = false; }
  });
}

async function loadList() {
  S.list = (await api('music/projects')).projects;
}

// ── la barre : projet, transport, tempo, tonalité, vues ─────
const bar = el('div', { class: 'mu-bar' });
const viewBox = el('div', { class: 'mu-view' });
document.body.append(el('main', { class: 'mu-app' }, bar, viewBox));
const ov = el('canvas', { class: 'mu-ov', title: 'la forme d\'onde de la session (rendu hors temps réel) · clic : aller là' });
const posEl = el('b', { id: 'mu-pos' });
const secEl = el('small', { id: 'mu-sec' });
setCue(posEl, '001.1.1'); setCue(secEl, '00:00.0');

function paintBar() {
  const P = S.proj;
  const sel = el('select', { class: 'fld mu-proj', 'aria-label': 'projet', onchange: (e) => openProject(e.target.value) },
    S.list.map((x) => el('option', { value: x.id, selected: x.id === P.id || null }, x.name)));
  const ic = (label, title, fn, cls = '', attrs = {}) => el('button', { class: `tb sm mu-ic ${cls}`, type: 'button', title, onclick: fn, ...attrs }, label);
  const views = el('div', { class: 'seg mu-views', role: 'tablist' },
    [['timeline', 'Arrangement', 'Tab : Arrangement ↔ Nodal'], ['console', 'Console', ''], ['nodal', 'Nodal', 'Tab : Arrangement ↔ Nodal']].map(([v, l, ti]) =>
      el('button', { class: `tb${S.view === v ? ' on' : ''}`, role: 'tab', 'aria-selected': S.view === v, type: 'button', 'data-view': v, title: ti,
        onclick: () => app.setView(v) }, l)));
  const bpm = el('button', { class: 'mu-bpm', id: 'mu-bpm', type: 'button', title: 'tempo · clic : le saisir · molette : ± 1', onclick: editBpm,
    onwheel: (e) => { e.preventDefault(); setBpm(P.bpm + (e.deltaY < 0 ? 1 : -1)); } }, el('b', {}, String(P.bpm)), el('small', {}, 'bpm'));
  const tap = el('button', { class: 'tb ghost sm mu-tap', id: 'mu-tap', type: 'button',
    title: 'frapper le tempo : quatre frappes ou plus, au temps · Maj+T · la moyenne des dernières frappes (jusqu\'à huit) ; une pause de deux secondes recommence',
    onpointerdown: (e) => { e.preventDefault(); tapTempo(e.timeStamp); } }, 'Tap');
  const pend = (P.pending || []).length;
  put(bar,
    el('div', { class: 'grp mu-brand', title: 'ODIO · le studio musique · le projet s\'enregistre seul' }, el('b', { class: 'venus' }, 'ODIO'),
      el('span', { class: 'lbl mu-save', id: 'mu-save' }, 'enregistré')),
    el('div', { class: 'grp' }, sel,
      el('button', { class: 'tb ghost sm', type: 'button', title: 'nouveau projet, renommer, corbeille', onclick: (e) => projMenu(e) }, '···')),
    el('div', { class: 'grp mu-tr' },
      ic('⏮', 'retour au début · Origine (Home)', () => engine.seek(0)),
      ic(engine.running ? '❚❚' : '▶', engine.running ? 'pause (on reste là) · Maj+Espace : reprendre' : 'lecture · Espace', togglePause, 'play', { id: 'mu-play' }),
      ic('■', 'stop : retour où la lecture a commencé (à l\'arrêt : au début) · Espace', stopBtn),
      el('button', { class: `tb sm mu-rec${S.rec ? ' on' : ''}${rec.active ? ' live' : ''}`, id: 'mu-rec', type: 'button', title: 'prise : armée, la lecture enregistre les pistes armées · F9',
        onclick: toggleRec }, el('i'), 'Rec'),
      el('button', { class: `tb sm${P.loop.on ? ' on' : ' ghost'}`, type: 'button', title: 'boucle · Ctrl+L (sur les clips choisis : la boucle les prend)', onclick: () => { P.loop.on = !P.loop.on; app.commit('meta'); } }, 'Boucle'),
      el('button', { class: `tb sm${S.metro ? ' on' : ' ghost'}`, type: 'button', title: 'métronome · O (clavier MIDI éteint)', onclick: toggleMetro }, 'Clic'),
      el('button', { class: `tb sm mu-kbd${S.kbd ? ' on' : ' ghost'}`, id: 'mu-kbd', type: 'button',
        title: S.kbd ? 'clavier MIDI de l\'ordinateur : allumé — les lettres jouent des notes (A W S E D…), Z X l\'octave, C V la vélocité · M : l\'éteindre (les lettres redeviennent des raccourcis)'
          : 'clavier MIDI de l\'ordinateur : éteint — les lettres sont des raccourcis (Z, X, W, H, O, S, C, A) · M : l\'allumer',
        onclick: toggleKbd }, 'Clavier')),
    el('div', { class: 'mu-tc', title: 'mesure . temps . double-croche · minutes : secondes' }, posEl, secEl),
    el('div', { class: 'grp mu-tempo' },
      ic('−', 'tempo − 1 (Maj : − 10)', (e) => setBpm(P.bpm - (e.shiftKey ? 10 : 1))), bpm, ic('+', 'tempo + 1 (Maj : + 10)', (e) => setBpm(P.bpm + (e.shiftKey ? 10 : 1))), tap,
      el('select', { class: 'fld mu-mini', 'aria-label': 'mesure', title: 'temps par mesure', onchange: (e) => { P.sig = +e.target.value; app.commit('meta'); } },
        [2, 3, 4, 6].map((n) => el('option', { value: n, selected: n === P.sig || null }, n === 6 ? '6/8' : `${n}/4`))),
      el('button', { class: 'mu-key', id: 'mu-key', type: 'button', title: 'tonalité et mode de la session', onclick: keyPop }, el('b', {}, keyLabel(P.key)))),
    views,
    el('div', { class: 'grp mu-ovw' }, ov),
    el('div', { class: 'grp' },
      ic('↶', 'annuler · Ctrl+Z', undo, 'ghost'), ic('↷', 'rétablir · Ctrl+Y', redo, 'ghost')),
    el('span', { class: 'sp' }),
    el('div', { class: 'grp' },
      S.midi ? el('span', { class: 'pill on', title: 'Web MIDI : les entrées jouent la piste armée ou choisie' }, el('i'), el('span', {}, `MIDI · ${S.midi}`)) : null,
      pend ? el('span', { class: 'pill work', title: 'travaux en cours pour ce projet' }, el('i'), el('span', {}, `${pend} en cours`)) : null,
      el('button', { class: 'tb ghost sm', id: 'mu-gen', type: 'button', title: 'YuE2, ACE-Step, séparation en pistes', onclick: () => openGenerative(app) }, 'Générer'),
      el('button', { class: 'tb ghost sm', id: 'mu-exp', type: 'button', title: 'le mixage et les pistes en WAV, vers la bibliothèque', onclick: openExport }, 'Exporter'),
      el('button', { class: 'tb go', id: 'mu-guide', type: 'button', title: 'l\'aide, à côté de la session', onclick: () => openGuide(app) }, 'Guide')));
  paintTransport();
  drawOverview();
}

function setBpm(v) {
  const P = S.proj;
  v = Math.round(v);
  if (!(v >= 20 && v <= 300)) { toast('tempo : de 20 à 300'); return; }
  if (v === P.bpm) return;
  const was = engine.running, at = engine.position();
  P.bpm = v;
  app.commit('meta');
  if (was) engine.playFrom(at);
}
async function editBpm() {
  const v = await ask('Tempo', 'Battements par minute (20 à 300)', String(S.proj.bpm), 'Régler');
  if (v !== null && !isNaN(+v)) setBpm(+v);
}
function keyPop(e) {
  const P = S.proj;
  const r = e.currentTarget.getBoundingClientRect();
  const pop = el('div', { class: 'mu-menu mu-keypop', role: 'dialog' },
    el('div', { class: 'head' }, 'tonique'),
    el('div', { class: 'kp-t' }, TONICS.map((n, i) => el('button', { class: `tb sm${P.key.tonic === i ? ' on' : ' ghost'}`, type: 'button', title: TONICS_FR[i],
      onclick: () => { P.key = { ...P.key, tonic: i }; app.commit('meta'); pop.remove(); } }, n))),
    el('div', { class: 'head' }, 'mode'),
    el('div', { class: 'kp-m' }, Object.entries(MODES).map(([k, m]) => el('button', { class: `tb sm${P.key.mode === k ? ' on' : ' ghost'}`, type: 'button',
      onclick: () => { P.key = { ...P.key, mode: k }; app.commit('meta'); pop.remove(); } }, m.label))));
  document.body.append(pop);
  pop.style.left = `${Math.min(r.left, innerWidth - 340)}px`; pop.style.top = `${r.bottom + 6}px`;
  setTimeout(() => addEventListener('pointerdown', function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); removeEventListener('pointerdown', off, true); } }, true));
}

function projMenu(e) {
  const r = e.currentTarget.getBoundingClientRect();
  menu(r.left, r.bottom + 4, [
    { label: 'Nouveau projet', sub: 'session, rythme, vide', onclick: newProject },
    { label: S.midi ? `MIDI · ${S.midi}` : 'Brancher un clavier MIDI', sub: 'Web MIDI', onclick: startMidi },
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
        const p = await api('music/projects', { method: 'POST', body: { name: 'Premier projet', template: 'session' } });
        S.list = [{ id: p.id, name: p.name }];
      }
      await openProject(S.list[0].id);
    } },
  ]);
}

function paintTransport() {
  const b = $('#mu-play');
  if (b) { b.textContent = engine.running ? '❚❚' : '▶'; b.classList.toggle('on', engine.running); }
  const r = $('#mu-rec');
  if (r) { r.classList.toggle('on', S.rec); r.classList.toggle('live', rec.active); }
}
async function togglePause() {
  if (engine.running) engine.stop(false, { stay: true });
  else await engine.playFrom(engine.pos);
  paintTransport();
}
async function togglePlay() {
  if (engine.running) engine.stop();
  else await engine.playFrom(engine.pos);
  paintTransport();
}
function stopBtn() {
  if (engine.running) engine.stop();
  else engine.seek(0);
  paintTransport();
}
function toggleRec() {
  S.rec = !S.rec;
  if (S.rec && engine.running) rec.begin();
  if (!S.rec && rec.active) rec.end();
  if (S.rec && !engine.running) toast('prise armée : Lecture pour enregistrer les pistes armées (●)', 4000);
  paintTransport();
}
function toggleMetro() {
  S.metro = !S.metro; engine.metro = S.metro;
  paintBar();
}
// M (Live : « Computer MIDI Keyboard ») : les lettres jouent, ou commandent
function toggleKbd() {
  S.kbd = !S.kbd;
  toast(S.kbd ? 'clavier MIDI allumé : les lettres jouent des notes · M pour l\'éteindre' : 'clavier MIDI éteint : les lettres sont des raccourcis · M pour l\'allumer', 2500);
  paintBar();
}

// ── frapper le tempo ────────────────────────────────────────
// Chaque frappe note son instant (performance.now, en millisecondes) ; le
// tempo est 60 000 divisé par la moyenne des intervalles entre les
// dernières frappes (huit au plus, donc sept intervalles). Une pause de plus
// de deux secondes recommence le compte. Dès deux frappes le tempo suit,
// arrondi au battement (le projet garde un tempo entier, de 20 à 300).
// Choix de réglage : Live 12 n'a pas de raccourci par défaut pour frapper
// le tempo (son bouton TAP se mappe) ; Maj+T est donc à ODIO.
// L'instant d'une frappe est celui de l'événement (Event.timeStamp, même
// horloge que performance.now, MDN) : une page occupée à redessiner le
// tempo précédent ne retarde pas la mesure de la frappe suivante.
const taps = [];
function tapTempo(at = performance.now()) {
  const t = at;
  if (taps.length && t - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(t);
  if (taps.length > 8) taps.shift();
  const b = $('#mu-tap');
  if (b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 90); }
  if (taps.length < 2) { toast('tempo : frappe encore, au temps', 1500); return; }
  const iv = taps.slice(1).map((x, i) => x - taps[i]);
  const bpm = 60000 / (iv.reduce((a, x) => a + x, 0) / iv.length);
  window.__muTap = { taps: taps.length, bpm };
  if (bpm < 20 || bpm > 300) return;
  setBpm(bpm);
}

// ── la forme d'onde de la session ───────────────────────────
// Le mixage rendu hors temps réel (le même graphe qu'à l'export), refait
// une seconde et demie après la dernière retouche. 44,1 kHz : les filtres
// d'ODIO montent jusqu'à 20 kHz, un contexte plus lent les écrêterait.
let ovBuf = null, ovT = null, ovBusy = false, ovAgain = false, ovEnd = 0;
const OV_W = 120;
function overviewSoon(ms = 1500) { clearTimeout(ovT); ovT = setTimeout(renderOverview, ms); }
async function renderOverview() {
  if (!S.proj) return;
  if (ovBusy) { ovAgain = true; return; }        // une retouche pendant le rendu : on le refait après
  const end = Math.max(songEnd(S.proj), 1);
  if (end > 2400) return;
  ovBusy = true;
  try { ovBuf = await renderMix(engine, S.proj, 0, end, { tail: 0.5, sampleRate: 44100 }); ovEnd = end; } catch { ovBuf = null; }
  ovBusy = false;
  drawOverview();
  if (ovAgain) { ovAgain = false; overviewSoon(300); }
}
function drawOverview() {
  const w = OV_W, h = 28, dpr = devicePixelRatio || 1;
  ov.width = w * dpr; ov.height = h * dpr; ov.style.width = `${w}px`; ov.style.height = `${h}px`;
  const g = ov.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!ovBuf || !S.proj) { g.fillStyle = tok('line'); g.fillRect(0, h / 2, w, 1); return; }
  const spb = 60 / S.proj.bpm, tot = ovEnd * spb, pk = peaks(ovBuf, 340);
  const L = S.proj.loop;
  if (L.on) { g.fillStyle = tok('cy-bg'); g.fillRect((L.a * spb / tot) * w, 0, ((L.b - L.a) * spb / tot) * w, h); }
  g.fillStyle = tok('cy');
  for (let x = 0; x < w; x++) {
    const i = Math.floor(((x / w) * tot / ovBuf.duration) * pk.length);
    const v = Math.min(1, pk[Math.min(pk.length - 1, i)] || 0), hh = Math.max(1, v * (h - 4));
    g.fillRect(x, (h - hh) / 2, 1, hh);
  }
  ov.dataset.tot = tot;
}
ov.addEventListener('pointerdown', (e) => {
  if (!ovBuf) return;
  const r = ov.getBoundingClientRect();
  engine.seek(((e.clientX - r.left) / r.width) * ovEnd);
});

// ── les vues ────────────────────────────────────────────────
const views = {};
const MAKERS = { timeline: createTimeline, console: createConsole, nodal: createNodal };
function render(full = false) {
  if (!S.proj) return;
  paintBar();
  if (!views[S.view]) views[S.view] = MAKERS[S.view](app);
  const v = views[S.view];
  if (full || viewBox.firstChild !== v.el) put(viewBox, v.el);
  if (S.view !== 'nodal') views.nodal?.hide?.();
  document.body.dataset.view = S.view;
  v.render();
  app.toys?.wake();   // jouets : un projet qui a des jouets les fait vivre, dans toutes les vues
}

// la tête de lecture, les vu-mètres, la position : à chaque image
function frame() {
  if (S.proj) {
    const b = engine.position();
    setCue(posEl, fmtPos(b));
    setCue(secEl, fmtClock(b * 60 / S.proj.bpm));
    views[S.view]?.frame?.(b);
    if (ovBuf && ov.dataset.tot) {
      // la tête sur la forme d'onde
      drawOverview();
      const g = ov.getContext('2d'), w = OV_W, x = ((b * 60 / S.proj.bpm) / +ov.dataset.tot) * w;
      g.fillStyle = tok('or'); g.fillRect(Math.min(w - 1, x), 0, 1.5, 28);
    }
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
  const armed = S.proj.tracks.find((x) => x.arm && TRACK_KINDS[x.kind]?.pattern);
  const t = armed || app.track(S.sel.track) || S.proj.tracks.find((x) => TRACK_KINDS[x.kind]?.pattern);
  return t && TRACK_KINDS[t.kind]?.pattern ? t : null;
}

// Les raccourcis sont ceux de Live 12 (« Live Keyboard Shortcuts », manuel
// de référence ; la table est dans guide.js). Comme dans Live, les lettres
// seules jouent des notes tant que le clavier MIDI de l'ordinateur est
// allumé (M) ; éteint, elles redeviennent des commandes.
const newTrack = (kind, type) => { app.addTrack(kind, type ? { type } : {}); app.commit('graph'); };
addEventListener('keydown', async (e) => {
  if (!S.proj || typing(e) || document.querySelector('.scrim')) return;
  const ctrl = e.ctrlKey || e.metaKey, c = e.code;
  // annuler, rétablir (Ctrl+Z ; Ctrl+Y, ou Cmd+Maj+Z sur Mac)
  if (ctrl && !e.altKey && c === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (ctrl && c === 'KeyY') { e.preventDefault(); redo(); return; }
  // les vues : Tab Arrangement ↔ Nodal (Live : Session ↔ Arrangement),
  // Maj+Tab ou F12 : Clip ↔ Instruments, Ctrl+Alt+B : le navigateur,
  // Ctrl+Alt+3 / 4 : la vue Clip / Instruments
  if (c === 'Tab' && !ctrl && !e.altKey) {
    e.preventDefault();
    if (e.shiftKey) app.showDetail(S.proj.ui.detail === 'device' ? 'clip' : 'device');
    else app.setView(S.view === 'nodal' ? 'timeline' : 'nodal');
    return;
  }
  if (c === 'F12') { e.preventDefault(); app.showDetail(S.proj.ui.detail === 'device' ? 'clip' : 'device'); return; }
  if (ctrl && e.altKey && c === 'KeyB') { e.preventDefault(); S.proj.ui.nav = S.proj.ui.nav === false; saveQuiet(); render(); return; }
  if (ctrl && e.altKey && c === 'Digit3') { e.preventDefault(); app.showDetail('clip'); return; }
  if (ctrl && e.altKey && c === 'Digit4') { e.preventDefault(); app.showDetail('device'); return; }
  // les pistes : Ctrl+T audio, Ctrl+Maj+T MIDI (un synthé), Ctrl+Alt+T retour (bus)
  if (ctrl && c === 'KeyT') {
    e.preventDefault();
    if (e.altKey) app.addBus('reverb'); else if (e.shiftKey) newTrack('synth', 'synth'); else newTrack('audio');
    return;
  }
  // Ctrl+Maj+M : un clip MIDI (de motif) à la tête de lecture, sur la piste choisie
  if (ctrl && e.shiftKey && c === 'KeyM') {
    e.preventDefault();
    const t = app.track(S.sel.track);
    if (!t || !TRACK_KINDS[t.kind]?.pattern) { toast('Ctrl+Maj+M : choisis une piste de batterie ou de synthé'); return; }
    if (app.newClip(t.id, Math.floor(engine.position() / S.proj.sig) * S.proj.sig)) app.showDetail('clip');
    return;
  }
  // le transport : Espace lecture / stop, Maj+Espace reprendre là où l'on
  // s'est arrêté, Origine au début (Entrée aussi, l'ancien d'ODIO), F9 prise
  if (c === 'Space') { e.preventDefault(); if (e.repeat) return; if (e.shiftKey) togglePause(); else togglePlay(); return; }
  if (c === 'Home' || c === 'Enter') { e.preventDefault(); engine.seek(0); return; }
  if (c === 'F9') { e.preventDefault(); if (!e.repeat) toggleRec(); return; }
  if (e.shiftKey && c === 'KeyT' && !ctrl && !e.altKey) { e.preventDefault(); tapTempo(e.timeStamp); return; }
  if (e.shiftKey && c === 'KeyM' && !ctrl && !e.altKey) { app.addMarker(engine.position()); return; }
  if (ctrl || e.altKey) { views[S.view]?.key?.(e); return; }
  if (c === 'KeyM' && !e.repeat) { toggleKbd(); return; }
  if (S.kbd) {
    if (c === 'KeyZ' || c === 'KeyX') {
      S.oct = Math.max(0, Math.min(8, S.oct + (c === 'KeyZ' ? -1 : 1)));
      toast(`clavier : octave ${S.oct} (do${S.oct})`, 1200);
      return;
    }
    if (c === 'KeyC' || c === 'KeyV') {
      S.vel = Math.max(0.05, Math.min(1, Math.round((S.vel + (c === 'KeyC' ? -0.15 : 0.15)) * 100) / 100));
      toast(`clavier : vélocité ${Math.round(S.vel * 127)}`, 1200);
      return;
    }
    if (c in KEYS) {
      if (e.repeat || held.has(c)) return;
      const t = srcForPlay();
      if (!t) return;
      const pitch = t.kind === 'drums' ? KEYS[c] : 12 * (S.oct + 1) + KEYS[c];
      held.set(c, null);
      const h = await engine.noteOn(t.src, pitch, S.vel);
      rec.noteOn(t, pitch, S.vel, c);
      if (held.has(c)) held.set(c, h); else engine.noteOff(h);
      return;
    }
  } else if (!e.repeat) {
    // clavier MIDI éteint : les lettres de Live 12
    const t = app.track(S.sel.track);
    if (c === 'KeyO') { toggleMetro(); return; }
    if (c === 'KeyS' && t) { t.solo = !t.solo; app.commit('mute'); return; }
    if (c === 'KeyC' && t) { t.arm = !t.arm; app.commit('quiet'); render(); return; }
    if (c === 'KeyA' && t) { S.proj.ui.auto = { ...(S.proj.ui.auto || {}), [t.id]: !S.proj.ui.auto?.[t.id] }; saveQuiet(); render(); return; }
  }
  views[S.view]?.key?.(e);
});
addEventListener('keyup', (e) => {
  if (!held.has(e.code)) return;
  const h = held.get(e.code);
  held.delete(e.code);
  if (h) engine.noteOff(h);
  rec.noteOff(e.code);
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
          const pitch = t.kind === 'drums' ? d1 - 36 : d1;
          if (cmd === 0x90 && d2 > 0) { notes.set(d1, await engine.noteOn(t.src, pitch, d2 / 127)); rec.noteOn(t, pitch, d2 / 127, `midi${d1}`); }
          else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) { engine.noteOff(notes.get(d1)); notes.delete(d1); rec.noteOff(`midi${d1}`); }
        };
      }
      S.midi = n ? `${n} entrée${n > 1 ? 's' : ''}` : 'aucune entrée';
      paintBar();
    };
    access.onstatechange = bind;
    bind();
  } catch (err) { toast(`MIDI refusé : ${err.message}`); }
}

// ── générer, séparer : les travaux et leur retour ───────────
async function engines() {
  try { S.engines = await api('music/engines'); } catch (e) { S.engines = { error: e.message }; }
  return S.engines;
}

// La séparation : le contrat `music.stems` (server/tools/music_stems.py),
// avec le modèle choisi dans le panneau génératif, sinon celui que ses
// options recommandent (le meilleur prêt).
async function runStems(itemId, clip, want = null) {
  const s = await options('music/stems/options', 'music.stems');
  if (!s.ok) { toast(`séparation indisponible : ${s.why}`, 6000); return; }
  const best = bestStems(s.o, want || S.proj.gen?.stemModel);
  if (!best) { toast('séparation : aucun modèle prêt (voir le guide, Moteurs)', 6000); return; }
  let title = itemId;
  try { title = (await loadItem(itemId)).title || itemId; } catch { /* le titre n'est qu'une étiquette */ }
  try {
    const j = await api('music/stems/separate', { method: 'POST', body: { src: itemId, model: best.id, stems: best.stems } });
    S.proj.pending.push({ job: j.id, kind: 'stems', clip, item: itemId, title: `Séparer · ${title}` });
    app.commit('data');
    toast(`en file : séparation · ${best.name}${s.o.engine === 'factice' ? ' (moteur d\'essai : des filtres, pas une séparation)' : ''}`, 5000);
    jobs.poll(true);
  } catch (e) { toast(e.message, 6000); }
}

const STEM_COLOR = { vocals: 'coral-3', drums: 'or', bass: 'grn2', other: 'cy', guitar: 'amb', piano: 'coral-2', instrumental: 'cy' };
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
      if (j.state !== 'done') { toast(`${j.title || 'travail'} : ${stateFr(j.state)} — ${j.message || ''}`, 8000); app.commit('data'); continue; }
      const full = await api(`jobs/${pd.job}`);
      for (const it of full.items || []) items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
      if (pd.kind === 'generate') {
        const its = full.items || [];
        const placed = [];
        for (const it of its) {
          const t = app.addTrack('audio', { name: (it.title || 'Généré').slice(0, 60), color: 'coral-2' });
          const c = { id: uid('c'), track: t.id, start: pd.at || 0, len: Math.max(0.25, (it.duration || 10) * P.bpm / 60), item: it.id, off: 0 };
          P.clips.push(c);
          placed.push(c);
        }
        P.gen = P.gen || {};
        P.gen.hist = [...(P.gen.hist || []), { job: pd.job, engine: pd.engine, title: pd.title || full.title, items: its.map((x) => x.id) }].slice(-12);
        toast(`posé dans l'arrangement : ${full.title}${pd.split && placed[0] ? ' · séparation en pistes lancée' : ''}`, 5000);
        app.commit('graph');
        if (pd.split && placed[0]) { const c = placed[0]; runStems(c.item, { track: c.track, start: c.start, len: c.len, off: 0, clip: c.id }, pd.stemModel); }
      } else if (pd.kind === 'stems') {
        const src = pd.clip && app.track(pd.clip.track);
        let at = src ? P.tracks.indexOf(src) + 1 : P.tracks.filter((t) => t.kind !== 'bus').length;
        const byStem = new Map();
        for (const it of full.items || []) byStem.set(it.params?.stem || it.title, it);
        for (const [stem, id] of Object.entries(full.result?.stems || {})) if (!byStem.has(stem)) byStem.set(stem, (full.items || []).find((x) => x.id === id) || { id });
        const start = pd.clip ? pd.clip.start : Math.round(engine.position());
        const made = [];
        for (const [stem, it] of byStem) {
          const t = app.addTrack('audio', { name: `${STEM_FR[stem] || stem}${src ? ` · ${src.name}` : ''}`.slice(0, 60), color: STEM_COLOR[stem] || 'cy', at: at++ });
          let len = pd.clip?.len;
          if (!len) len = Math.max(0.25, (it.duration || 10) * P.bpm / 60);
          const c = { id: uid('c'), track: t.id, start, len, item: it.id, off: pd.clip?.off || 0 };
          if (pd.clip?.gain) c.gain = pd.clip.gain;
          P.clips.push(c);
          made.push(c);
        }
        const orig = pd.clip && app.clip(pd.clip.clip);
        if (orig) orig.mute = true;
        S.sel.clips = made.map((c) => c.id); S.sel.clip = made[0]?.id || null;
        toast(`${made.length} pistes posées sous l'original, alignées ; l'original est rendu muet`, 6000);
        app.commit('graph');
      } else if (GEN_KINDS.has(pd.kind)) {
        await genJobDone(app, pd, full);   // génératif : generatif_region.js
      }
      document.dispatchEvent(new CustomEvent('mu:placed'));
    }
  });
}

// ── exporter : le mixage et les pistes en WAV → la bibliothèque ──
function openExport() {
  const P = S.proj;
  const end = songEnd(P);
  let range = P.loop.on ? 'loop' : 'song';
  const tail = el('input', { class: 'fld', type: 'number', min: 0, max: 20, step: 0.5, value: 2 });
  const title = el('input', { class: 'fld', maxlength: 80, value: `${P.name} · mixage` });
  const stemsBox = el('input', { type: 'checkbox' });
  const seg = el('div', { class: 'seg' });
  const opts = [['loop', `Boucle (${fmtBar(P.loop.a)} → ${fmtBar(P.loop.b)})`], ['song', `Morceau (01.1 → ${fmtBar(end)})`]];
  const paintSeg = () => put(seg, ...opts.map(([k, l]) => el('button', { class: `tb${range === k ? ' on' : ''}`, type: 'button',
    onclick: () => { range = k; paintSeg(); } }, l)));
  paintSeg();
  const out = el('div', { class: 'mu-export' });
  const empty = end <= 0 && !P.loop.on;
  const go = el('button', { class: 'tb go', type: 'button', disabled: empty || null,
    title: empty ? 'rien à exporter : pose un clip dans l\'arrangement, ou règle une boucle' : '' }, 'Exporter');
  const m = modal({
    title: 'Exporter', wide: true,
    body: [
      el('p', {}, 'Le mixage est rendu dans la page, hors temps réel, par le même graphe que la lecture (OfflineAudioContext) — arc d\'énergie et automation compris : WAV 24 bits, 48 kHz, stéréo. Il entre dans la bibliothèque (dossier Musique), prêt pour le montage.'),
      el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'Étendue'), seg),
      el('div', { class: 'mu-form4' }, el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'Queue (s)', el('b', {}, ' · réverbérations, chutes')), tail),
        el('label', { class: 'field wide' }, el('span', { class: 'lbl' }, 'Titre'), title)),
      el('label', { class: 'opt mu-check' }, stemsBox, ' et chaque piste à part (stems) : une piste seule, ses envois aux bus compris'),
      out,
    ],
    foot: [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Fermer'), go],
  });
  go.addEventListener('click', async () => {
    const [a, b] = range === 'loop' ? [P.loop.a, P.loop.b] : [0, end];
    if (b <= a) { toast('rien à exporter : pas de clip'); return; }
    go.disabled = true;
    const say = (t) => put(out, el('p', { class: 'lbl' }, t));
    const results = [];
    const one = async (label, solo) => {
      const buf = await renderMix(engine, P, a, b, { tail: Math.max(0, +tail.value || 0), solo });
      const pk = peakDb(buf);
      const name = `${label.replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 60)}.wav`;
      const it = await uploadFile(new File([wav24(buf)], name, { type: 'audio/wav' }), { tool: 'music', folder: 'Musique', title: label });
      items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
      return { it, pk, dur: buf.duration };
    };
    try {
      const t0 = performance.now();
      say('rendu du mixage…');
      const mix = await one(title.value.trim() || P.name, null);
      results.push(['Mixage', mix]);
      if (stemsBox.checked) {
        const tr = P.tracks.filter((t) => t.kind !== 'bus' && P.clips.some((c) => c.track === t.id && !c.mute));
        for (const [i, t] of tr.entries()) { say(`stem ${i + 1} / ${tr.length} · ${t.name}…`); results.push([t.name, await one(`${P.name} · ${t.name}`, t.id)]); }
      }
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      window.__muLastExport = { id: mix.it.id, url: mix.it.url, peak: mix.pk, duration: mix.dur, secs: +secs, stems: results.slice(1).map(([n, r]) => ({ name: n, id: r.it.id, peak: r.pk })) };
      put(out,
        el('div', { class: 'mu-done' },
          el('div', {}, el('b', {}, mix.it.title), el('span', { class: 'lbl' }, ` ${fmtDur(mix.dur)} · crête ${mix.pk.toFixed(1)} dBFS · ${results.length} fichier${results.length > 1 ? 's' : ''} en ${secs} s`)),
          mix.pk > -0.1 ? el('p', { class: 'warn' }, 'la crête touche 0 dBFS : le mixage sature, baisse la sortie ou les pistes') : null,
          results.map(([n, r]) => el('div', { class: 'mu-exp-row' }, el('span', { class: 'lbl' }, `${n} · ${r.pk.toFixed(1)} dBFS`), el('audio', { src: href(r.it.url), controls: true, preload: 'metadata' }))),
          el('div', { class: 'row' },
            el('a', { class: 'tb ghost', href: href(`montage/?add=${encodeURIComponent(mix.it.id)}`) }, 'Envoyer au montage'),
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
      const p = await api('music/projects', { method: 'POST', body: { name: 'Première session', template: 'session' } });
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
window.__mu = { S, app, engine, renderMix, wav24, peakDb, hist, rec, undo, redo, flush, views, tapTempo };
