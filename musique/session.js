// ODIO — la vue Session : le lanceur de clips de Live, au-dessus de la console.
// Demande de Cal (05/10) : « notre partie CONSOLE de ODIO devient la partie
// Scène d'Ableton : un launchpad avec la même logique et les mêmes outils que
// ceux d'Ableton ». Le modèle : manuel de Live 12, chapitres « Session View »,
// « Launching Clips » et « Mixing » ; ce qui est retenu et adapté :
// docs/etudes/odio_session.md.
//
//   la grille      une colonne par piste, une ligne par scène ; chaque case est
//                  vide (son bouton Stop, ou de prise si la piste est armée), un
//                  clip arrêté, un clip qui joue (sa progression), un clip qui
//                  attend son temps (il clignote au temps), une prise
//   à droite       les scènes : lancer une scène lance toute sa ligne (une case
//                  vide arrête sa piste) ; le tempo d'une scène ; tout en bas,
//                  Arrêter tous les clips
//   sous la grille l'état de chaque piste (son bouton Stop, la progression du
//                  clip qui boucle), puis la console (console.js) : la tranche
//                  de chaque piste sous sa colonne — ou la vue Clip du clip ouvert
//   en tête        la quantification globale du lancement, Retour à
//                  l'arrangement, + Scène, Capturer
//
// Le jeu (ce qui tourne, ce qui attend) est l'état du moteur (moteur.js,
// Engine.sess), pas le projet : un lancement ne s'annule pas (Live non plus).
// Tout le reste — clips, scènes, réglages — passe par app.commit (annuler,
// l'enregistrement). Un clip de Session boucle sur sa longueur ; une piste qui
// joue la Session ne joue plus l'arrangement jusqu'au Retour à l'arrangement.

import { toast, api, pick, href, dropZone, ITEM_MIME } from '../commun/shell.js';
import { TRACK_KINDS, COLORS, COLOR_FR, DRUM_MODELS, NOTE_MODELS, drumVoicesOf, moduleName } from './modules.js';
import { el, menu, put, inlineEdit, knob, clamp, ask, letter, tok } from './ui.js';
import { createMixer } from './console.js';
import { patternEditor } from './editeurs.js';
import { placeNotes } from './generatif_midi.js';
import { peaks, clipBuffer } from './moteur.js';
import { QUANTS, quantum, slotQuant, slotAt, sceneName, insererScene, copieSlot, dupliquerScene, retirerScene, capturerScene,
  sceneVersArrangement } from './projet.js';

// Live 12, « Launching Clips », Launch Mode : Trigger, Gate, Toggle, Repeat
const MODES = [
  ['trigger', 'Déclencher', 'appuyer lance le clip ; relâcher ne fait rien'],
  ['gate', 'Porte', 'appuyer lance le clip ; relâcher l\'arrête'],
  ['toggle', 'Bascule', 'appuyer lance le clip ; appuyer encore l\'arrête'],
  ['repeat', 'Répéter', 'tant qu\'on appuie, le clip repart à chaque pas de sa quantification'],
];
const SLOT_MIME = 'application/x-odio-slot';   // un clip de Session qu'on glisse d'une case à l'autre
const ODIO_MIME = 'application/x-odio';        // le navigateur d'ODIO (navigateur.js)
const MAX_PRISE = 64;                          // une prise tient un motif : 256 pas, 64 noires

let presse = null;   // le presse-papiers des clips de Session (Ctrl+C, Ctrl+V)

export function createSession(app) {
  const { S, engine } = app;
  const P = () => S.proj;
  const ui = () => (S.proj.ui.sess = S.proj.ui.sess || { bas: 'mix' });
  const root = el('section', { class: 'ss', 'aria-label': 'session' });
  const head = el('div', { class: 'ss-head' });
  const grid = el('div', { class: 'ss-grid' });   // la grille qui défile
  const bot = el('div', { class: 'ss-bot' });     // l'état des pistes et la console : suit la grille à l'horizontale
  const clipBox = el('div', { class: 'ss-clip' });
  root.append(head, grid, bot, clipBox);
  const mixer = createMixer(app, { onSelect: (t) => choisir(t.id, cur.s) });

  // la case choisie : une piste (ou 'M', la colonne des scènes) et une scène
  const cur = { t: null, s: null };
  // ce que la vue dessine, pour que frame() n'y touche qu'en cas de changement
  const cells = new Map();     // id du clip → { node, slot, st }
  const nodes = new Map();     // « piste|scène » → la case
  const states = new Map();    // piste → { node, txt, st }
  const scenesEl = new Map();  // scène → { node, ids, st }
  let backBtn = null, stopAll = null, ed = null, zone = 'grid', tic = null;
  let arrTracks = new Set();   // les pistes qui ont des clips dans l'arrangement
  let prise = null;            // la prise de Session en cours : { tid, sid, pat, open, last, n }
  let tenu = null, repT = null;

  const tracks = () => P().tracks.filter((t) => t.kind !== 'bus');
  const slotById = (id) => (P().slots || []).find((s) => s.id === id) || null;
  const scene = (id) => P().scenes.find((x) => x.id === id) || null;
  const barsTxt = (len) => { const sig = P().sig, b = len / sig; return Number.isInteger(b) ? `${b}` : Number.isInteger(len) ? `${len}t` : len.toFixed(2); };
  const slotName = (s) => s.name || (s.pat ? app.pat(s.pat)?.name : null) || (s.item ? 'son' : 'clip');
  const patKind = (t) => TRACK_KINDS[t?.kind]?.pattern || null;

  // ── choisir une case ──
  function choisir(tid, sid, { peindre = true } = {}) {
    cur.t = tid; cur.s = sid || cur.s || P().scenes[0]?.id || null;
    if (tid && tid !== 'M') {
      const t = app.track(tid);
      if (t) { S.sel.track = t.id; S.sel.tracks = [t.id]; S.sel.pat = t.pat || null; S.sel.clip = null; S.sel.clips = []; }
    }
    const s = tid && tid !== 'M' ? slotAt(P(), tid, cur.s) : null;
    if (s) S.sel.slot = s.id;
    if (peindre) paintSel();
  }
  function paintSel() {
    for (const [k, n] of nodes) n.classList.toggle('cur', k === `${cur.t}|${cur.s}`);
    for (const n of root.querySelectorAll('[data-track]')) n.classList.toggle('sel', n.dataset.track === S.sel.track);
    const k = nodes.get(`${cur.t}|${cur.s}`);
    k?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  // ── lancer, arrêter ──
  const globalQ = () => quantum(P().launch?.q, P().sig);
  async function lancer(list, q) {
    if (!list.length) return;
    await engine.lancer(list.map((s) => ({ track: s.track, slot: s.id })), q ?? slotQuant(P(), list[0]));
    app.paintTransport();
  }
  async function arreter(tids, q = globalQ()) {
    if (!tids.length) return;
    await engine.lancer(tids.map((tid) => ({ track: tid, slot: null })), q);
  }
  // le tempo d'une scène (Live 12 : la scène pose son tempo) : comme la barre (musique.js, setBpm)
  async function tempo(v) {
    const p = P();
    v = Math.round(v);
    if (!(v >= 20 && v <= 300) || v === p.bpm) return;
    const was = engine.running, at = engine.position();
    p.bpm = v;
    app.commit('meta');
    if (was) await engine.playFrom(at);
  }
  async function lancerScene(sid, { suivante = true } = {}) {
    const p = P(), sc = scene(sid);
    if (!sc) return;
    if (sc.bpm) await tempo(sc.bpm);
    // une case vide arrête sa piste (Live : le bouton Stop de la case)
    await engine.lancer(tracks().map((t) => ({ track: t.id, slot: slotAt(p, t.id, sid)?.id || null })), globalQ());
    app.paintTransport();
    // Live : « Select Next Scene on Launch » — la scène d'en dessous attend d'être lancée
    const i = p.scenes.indexOf(sc);
    if (suivante && p.scenes[i + 1] && cur.s === sid) { cur.s = p.scenes[i + 1].id; paintSel(); }
  }
  // Appuyer sur le bouton d'un clip, selon son mode de lancement ; `clavier` :
  // Entrée, qui ne se relâche pas ici (Porte et Répéter y lancent seulement)
  async function appuyer(sid, { clavier = false } = {}) {
    const s = slotById(sid);
    if (!s) return;
    if (prise && prise.sid === sid) { finirPrise(); return; }   // presser la prise la finit : le clip boucle
    const mode = s.mode || 'trigger';
    const J = engine.sess.joue.get(s.track), att = engine.sess.file.find((ev) => ev.track === s.track);
    if (mode === 'toggle' && (J?.slot === sid || att?.slot === sid)) { await arreter([s.track], slotQuant(P(), s)); return; }
    // tenu avant d'attendre le départ : un relâcher rapide le trouve
    if (!clavier && (mode === 'gate' || mode === 'repeat')) tenu = { sid, mode, tid: s.track };
    await lancer([s]);
    if (tenu?.sid === sid) {
      if (tenu.mode === 'repeat') {
        // tant qu'on tient : un nouveau départ à chaque pas de la quantification (1/16 sans quantification)
        const q = slotQuant(P(), s) || 0.25;
        clearInterval(repT);
        repT = setInterval(() => {
          if (!tenu || !engine.running) return;
          if (!engine.sess.file.some((ev) => ev.track === tenu.tid)) engine.lancer([{ track: tenu.tid, slot: tenu.sid }], q);
        }, 20);
      }
    }
  }
  function relacher() {
    if (!tenu) return;
    const { sid, mode, tid } = tenu;
    tenu = null;
    clearInterval(repT);
    if (mode === 'gate') arreter([tid], slotQuant(P(), slotById(sid)));
  }
  addEventListener('pointerup', relacher);
  addEventListener('pointercancel', relacher);

  // ── la prise de Session : une case vide d'une piste armée ──
  // Live 12 (« Session View ») : sur une piste armée, les cases vides deviennent
  // des boutons de prise. La prise part quantifiée ; ce qu'on joue au clavier de
  // l'ordinateur ou en MIDI s'écrit dans un motif neuf ; presser le clip la finit
  // à la fin de la mesure en cours, et le clip boucle sur cette longueur.
  async function prendre(t, sid) {
    const p = P();
    if (!patKind(t)) { toast('la prise de Session : une piste de batterie ou de synthé ; le micro se prend dans l\'arrangement (Rec, F9)', 5000); return; }
    if (prise) finirPrise();
    const pat = app.newPattern(t.id, null, { quiet: true, name: 'Prise' });
    pat.steps = MAX_PRISE * 4;
    const s = { id: app.uid('cl'), track: t.id, scene: sid, pat: pat.id, len: p.sig * 4, name: 'Prise' };
    p.slots.push(s);
    prise = { tid: t.id, sid: s.id, pat: pat.id, open: new Map(), last: 0, n: 0 };
    app.label(`prise de Session sur « ${t.name} »`);
    app.commit('data');
    await engine.lancer([{ track: t.id, slot: s.id, rec: true }], globalQ());
    toast(S.kbd ? 'prise : joue (le clavier de l\'ordinateur, ou le MIDI) · clic sur le clip : il boucle' : 'prise : joue en MIDI, ou allume le clavier (M) · clic sur le clip : il boucle', 5000);
  }
  // où en est la prise, en noires depuis son départ (null : elle n'écoute pas)
  function posPrise(t) {
    if (!prise || t.id !== prise.tid) return null;
    const J = engine.sess.joue.get(t.id), now = engine.absNow();
    if (!J?.rec || J.slot !== prise.sid || now === null || now < J.origin) return null;
    return now - J.origin;
  }
  function noteOn(t, pitch, vel, key) {
    const pos = posPrise(t), pat = prise && app.pat(prise.pat);
    if (pos === null || !pat || pos * 4 >= pat.steps) return;
    if (t.kind === 'drums') {
      const v = drumVoicesOf(app.mod(t.src)?.type)[((pitch % 12) + 12) % 12];
      if (!v) return;
      const i = Math.min(pat.steps - 1, Math.round(pos * 4));
      if (!pat.lanes[v.id]) pat.lanes[v.id] = Array(pat.steps).fill(0);
      pat.lanes[v.id][i] = Math.max(pat.lanes[v.id][i], Math.round(vel * 100) / 100);
      prise.n++;
    } else prise.open.set(key, { p: pitch, v: vel, on: pos });
  }
  function fermerNote(o, pos) {
    const pat = app.pat(prise?.pat);
    if (!pat?.notes) return;
    const s = Math.round(o.on * 4 * 100) / 100;
    if (s >= pat.steps) return;
    const l = Math.max(0.25, Math.min(pat.steps - s, Math.round((pos - o.on) * 4 * 100) / 100));
    pat.notes.push({ s, l, p: o.p, v: Math.round(o.v * 100) / 100 });
    prise.n++;
  }
  function noteOff(key) {
    const o = prise?.open.get(key);
    if (!o) return;
    prise.open.delete(key);
    const J = engine.sess.joue.get(prise.tid), now = engine.absNow();
    fermerNote(o, J && now !== null ? now - J.origin : o.on + 0.25);
  }
  // `arret` : la prise s'arrête avec sa piste (Stop, la lecture arrêtée) ; sinon
  // elle finit à la fin de la mesure en cours, et le clip boucle de là
  function finirPrise({ arret = false } = {}) {
    const pr = prise;
    if (!pr) return;
    const p = P(), s = slotById(pr.sid), pat = app.pat(pr.pat), J = engine.sess.joue.get(pr.tid);
    const now = engine.absNow();
    const pos = J?.rec && now !== null ? now - J.origin : pr.last;
    for (const o of pr.open.values()) fermerNote(o, pos);
    prise = null;
    engine.finPrise(pr.tid);
    if (!s || !pat) return;
    if (!pr.n) {
      p.slots = p.slots.filter((x) => x !== s);
      p.patterns = p.patterns.filter((x) => x !== pat);
      if (J?.slot === s.id && !arret) arreter([pr.tid], 0);
      toast('prise vide : rien de gardé');
      app.label('prise de Session vide');
      app.commit('data');
      return;
    }
    const sig = p.sig;
    const len = clamp(Math.ceil(pos / sig - 1e-6) * sig, sig, MAX_PRISE);
    s.len = len;
    const n = len * 4;
    if (pat.lanes) for (const k of Object.keys(pat.lanes)) pat.lanes[k] = pat.lanes[k].slice(0, n);
    if (pat.notes) pat.notes = pat.notes.filter((x) => x.s < n).map((x) => ({ ...x, l: Math.min(x.l, n - x.s) }));
    pat.steps = n;
    toast(`prise gardée : ${barsTxt(len)} mesure${len / sig > 1 ? 's' : ''}, ${pr.n} note${pr.n > 1 ? 's' : ''}${arret ? '' : ' · elle boucle'}`);
    app.label(`prise de Session sur « ${app.track(pr.tid)?.name || ''} »`);
    app.commit('data');
  }

  // ── poser des clips ──
  // une scène plus bas (créée au besoin) : où vont les objets suivants d'un dépôt
  function sceneSous(sid) {
    const p = P(), i = p.scenes.findIndex((x) => x.id === sid);
    return (p.scenes[i + 1] || insererScene(p, p.scenes.length, app.uid)).id;
  }
  // la case visée : `here` { t, s } ; s === '+' : une scène neuve ; t null : une piste neuve
  function caseDe(here) {
    const p = P();
    let sid = here?.s && here.s !== '+' ? here.s : null;
    if (!sid) sid = (here?.s === '+' || !p.scenes.length ? insererScene(p, p.scenes.length, app.uid) : scene(cur.s) || p.scenes[0]).id;
    return sid;
  }
  // Un clip déjà fait (copier, glisser) posé dans une case : la case prise est
  // remplacée (Ctrl+Z la rend). D'une piste à une autre, un motif est copié.
  function poser(s, tid, sid, { move = false } = {}) {
    const p = P(), t = app.track(tid), from = app.track(s.track);
    if (!t || t.kind === 'bus') return null;
    if ((t.kind === 'audio') !== !!s.item) { toast(s.item ? 'un son va sur une piste audio' : 'un clip de notes va sur une piste de batterie ou de synthé'); return null; }
    if (!s.item && patKind(t) !== patKind(from)) { toast('ce motif ne va que sur une piste de la même sorte (batterie ↔ batterie, notes ↔ notes)'); return null; }
    const old = slotAt(p, tid, sid);
    if (old === s) return s;
    let pat = s.pat;
    if (!s.item && tid !== s.track) { const src = app.pat(s.pat); if (src) pat = app.newPattern(tid, src, { quiet: true, name: src.name }).id; }
    if (old) p.slots = p.slots.filter((x) => x !== old);
    if (move) { Object.assign(s, { track: tid, scene: sid }, pat ? { pat } : {}); return s; }
    const n = copieSlot(s, app.uid, { track: tid, scene: sid, ...(pat ? { pat } : {}) });
    p.slots.push(n);
    return n;
  }
  function placer(tid, sid, fields) {
    const p = P(), old = slotAt(p, tid, sid);
    if (old) p.slots = p.slots.filter((x) => x !== old);
    const s = { id: app.uid('cl'), track: tid, scene: sid, ...fields };
    p.slots.push(s);
    return s;
  }
  // un son : sa longueur en noires, arrondie à la mesure (au temps sous la mesure) —
  // ODIO ne cale pas un son au tempo (pas de warp) : la boucle se ferme sur la grille
  async function lenDuSon(it) {
    let d = it.duration;
    if (!d) { try { d = (await engine.buffer(it.id)).duration; } catch { d = 4; } }
    const p = P(), b = d * p.bpm / 60;
    return clamp(b >= p.sig ? Math.round(b / p.sig) * p.sig : Math.max(1, Math.round(b)), 1, 4096);
  }
  // un clip MIDI de la bibliothèque → un motif de la piste (generatif_midi.js, placeNotes), dans la case
  async function midiDans(t, sid, id) {
    const p = P(), r = await api(`music/midi/${id}/notes`);
    if (!r.notes?.length) { toast('ce clip MIDI n\'a pas de note'); return null; }
    const notes = r.notes.map(([s, l, pp, v, ch]) => [s, l, pp, v, ch]);
    const name = `${(r.title || 'MIDI').replace(/ \(essai\)/g, '')}`.slice(0, 40);
    if (!t) {
      const drums = notes.every((n) => n[4] === 9);
      t = app.addTrack(drums ? 'drums' : 'synth', { type: drums ? 'rythme' : 'synth', name });
    }
    const { made, lost } = placeNotes(app, t.id, notes, 0, { name });
    const gone = new Set(made.map((c) => c.id));
    p.clips = p.clips.filter((c) => !gone.has(c.id));
    const extra = new Set(made.slice(1).map((c) => c.pat));
    if (extra.size) { p.patterns = p.patterns.filter((x) => !extra.has(x.id)); toast(`clip MIDI long : la case prend ses ${barsTxt(made[0].len)} premières mesures (un motif tient 256 pas)`, 5000); }
    if (lost) toast(`${lost} coup${lost > 1 ? 's' : ''} sans voix sur cette batterie (table General MIDI) : laissé${lost > 1 ? 's' : ''}`, 5000);
    return placer(t.id, sid, { pat: made[0].pat, len: made[0].len, name });
  }
  // Des objets de la bibliothèque (le panneau Asset, le navigateur, le disque),
  // lâchés sur une case : les suivants descendent d'une scène à chaque fois (Live).
  async function deposer(items, here) {
    if (!items.length) return;
    let sid = caseDe(here), t = here?.t ? app.track(here.t) : null;
    const made = [];
    for (const it of items) {
      if (it.kind === 'audio') {
        app.items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
        let tt = t;
        if (!tt || tt.kind !== 'audio') {
          if (tt) { toast(`« ${it.title || it.id} » : un son va sur une piste audio — une piste neuve le prend`, 4000); }
          tt = app.addTrack('audio', { name: (it.title || 'Audio').slice(0, 60) });
          t = tt;
        }
        made.push(placer(tt.id, sid, { item: it.id, off: 0, len: await lenDuSon(it), name: (it.title || 'son').slice(0, 60) }));
      } else if (it.kind === 'midi') {
        const s = await midiDans(patKind(t) ? t : null, sid, it.id).catch((e) => { toast(e.message); return null; });
        if (s) { made.push(s); t = app.track(s.track); }
      } else { toast(`la Session prend des sons et des clips MIDI : « ${it.title || it.id} » n'en est pas un`); continue; }
      sid = sceneSous(sid);
    }
    if (!made.length) return;
    cur.t = made[0].track; cur.s = made[0].scene; S.sel.slot = made[0].id;
    app.label(made.length > 1 ? `poser ${made.length} clips de Session` : `poser « ${slotName(made[0])} » en Session`);
    app.commit('graph');
  }
  // ce que le navigateur d'ODIO lâche (navigateur.js) sur une case
  async function deposerOdio(d, here) {
    const p = P(), t = here?.t ? app.track(here.t) : null;
    if (d.t === 'son') return deposer([d.item], here);
    if (d.t === 'midi') return deposer([{ id: d.id, kind: 'midi' }], here);
    if (d.t === 'motif') {
      const src = app.pat(d.pat), from = src && app.track(src.track);
      if (!src) return null;
      const tt = t || from;
      if (patKind(tt) !== patKind(from)) { toast('ce motif ne va que sur une piste de la même sorte'); return null; }
      const sid = caseDe(here);
      const pat = tt.id === from.id ? src : app.newPattern(tt.id, src, { quiet: true, name: src.name });
      const s = placer(tt.id, sid, { pat: pat.id, len: pat.steps / 4, name: src.name });
      app.label(`poser « ${src.name} » en Session`); app.commit('data');
      return s;
    }
    if (d.t === 'modele') {
      const want = d.kind === 'drums' ? 'drums' : 'notes';
      let tt = patKind(t) === want ? t : null;
      if (!tt) tt = app.addTrack(want === 'drums' ? 'drums' : 'synth', { type: want === 'drums' ? 'rythme' : 'synth' });
      const m = want === 'drums' ? DRUM_MODELS.find((x) => x.id === d.id) : NOTE_MODELS.find((x) => x.id === d.id);
      if (!m) return null;
      const pat = app.newPattern(tt.id, null, { quiet: true, name: m.name });
      Object.assign(pat, want === 'drums' ? { steps: 16, lanes: JSON.parse(JSON.stringify(m.lanes)) } : m.make(p.key, p.sig));
      const s = placer(tt.id, caseDe(here), { pat: pat.id, len: pat.steps / 4, name: m.name });
      app.label(`poser « ${m.name} » en Session`); app.commit('graph');
      return s;
    }
    // un instrument, un effet, un réglage, un bus : ce que fait le navigateur (des pistes, pas des clips)
    return app.dropItem(d, t?.id || null, 0);
  }

  // ── les gestes sur un clip ──
  function nouveauMidi(t, sid) {
    if (!patKind(t)) return null;
    const p = P(), pat = app.newPattern(t.id, null, { quiet: true, name: 'Nouveau' });
    const s = placer(t.id, sid, { pat: pat.id, len: p.sig, name: 'Nouveau' });
    S.sel.slot = s.id; ui().bas = 'clip'; centrer = true;
    cur.t = t.id; cur.s = sid;
    app.label(`un clip MIDI en Session sur « ${t.name} »`);
    app.commit('data');
    return s;
  }
  async function sonDans(t, sid) {
    const got = await pick({ kinds: ['audio'], multiple: true, title: 'Des sons de la bibliothèque, dans la Session' });
    if (got.length) deposer(got, { t: t.id, s: sid });
  }
  let centrer = false;   // la vue Clip vient de s'ouvrir : le piano roll se centre sur ses notes
  function ouvrir(sid) {
    const s = slotById(sid);
    if (!s) return;
    S.sel.slot = s.id; ui().bas = 'clip'; centrer = true;
    cur.t = s.track; cur.s = s.scene;
    app.saveUi();
    render();
  }
  function renommer(s) {
    const n = cells.get(s.id)?.node.querySelector('.nm');
    if (!n) return;
    inlineEdit(n, slotName(s), (v) => { s.name = v.slice(0, 60); app.label(`renommer le clip de Session en « ${s.name} »`); app.commit('data'); }, { max: 60 });
  }
  function retirer(s) {
    const p = P();
    p.slots = p.slots.filter((x) => x !== s);
    if (S.sel.slot === s.id) S.sel.slot = null;
    app.label(`retirer « ${slotName(s)} » de la Session`);
    app.commit('data');
  }
  // Ctrl+D : la copie va dans la case libre suivante, en dessous (une scène neuve au besoin)
  function dupliquer(s) {
    const p = P();
    let i = p.scenes.findIndex((x) => x.id === s.scene) + 1;
    while (p.scenes[i] && slotAt(p, s.track, p.scenes[i].id)) i++;
    const sc = p.scenes[i] || insererScene(p, i, app.uid);
    const n = poser(s, s.track, sc.id);
    if (!n) return;
    cur.t = n.track; cur.s = sc.id; S.sel.slot = n.id;
    app.label(`dupliquer « ${slotName(s)} »`);
    app.commit('data');
  }
  function coller(tid, sid) {
    if (!presse) { toast('rien à coller : Ctrl+C sur un clip de Session'); return; }
    const n = poser(presse, tid, sid);
    if (!n) return;
    S.sel.slot = n.id;
    app.label(`coller « ${slotName(n)} » en Session`);
    app.commit('data');
  }
  // une scène vers l'arrangement, à la tête de lecture (au début de sa mesure)
  function versArrangement(sids) {
    const p = P();
    let at = Math.floor(engine.position() / p.sig + 1e-9) * p.sig;
    const a0 = at;
    let n = 0;
    for (const sid of sids) {
      const r = sceneVersArrangement(p, sid, at, app.uid);
      n += r.made.length;
      at += r.len;
    }
    if (!n) { toast('rien à copier : ces scènes n\'ont pas de clip'); return; }
    app.label(sids.length > 1 ? 'les scènes dans l\'arrangement' : `la scène « ${sceneName(p, scene(sids[0]))} » dans l'arrangement`);
    app.commit('data');
    toast(`${n} clip${n > 1 ? 's' : ''} posé${n > 1 ? 's' : ''} dans l'arrangement, de ${app.bar(a0)} à ${app.bar(at)} · Retour à l'arrangement pour l'entendre`, 6000);
  }
  function scenesNeuve(i) {
    const sc = insererScene(P(), i, app.uid);
    cur.s = sc.id;
    app.label('insérer une scène'); app.commit('data');
    return sc;
  }
  function capturer() {
    const p = P(), joue = new Map([...engine.sess.joue].map(([tid, J]) => [tid, J.slot]));
    if (!joue.size) { toast('rien à capturer : aucun clip de Session ne joue'); return; }
    const sc = capturerScene(p, joue, cur.s, app.uid);
    cur.s = sc.id;
    app.label('capturer et insérer une scène'); app.commit('data');
  }

  // ── la tête : la quantification, le retour à l'arrangement, les scènes ──
  function paintHead() {
    const p = P(), q = p.launch?.q || '1';
    backBtn = el('button', { class: 'tb sm ss-back', type: 'button', title: 'Retour à l\'arrangement (Live : Back to Arrangement) : les pistes qui jouent la Session reprennent l\'arrangement, tout de suite',
      onclick: () => { engine.retourArrangement(); app.paintTransport(); } }, el('i'), 'Retour à l\'arrangement');
    const bas = ui().bas;
    const sel = slotById(S.sel.slot);
    put(head,
      el('b', { class: 'venus' }, 'Session'),
      el('span', { class: 'lbl' }, `${tracks().length} pistes · ${p.scenes.length} scènes · ${(p.slots || []).length} clips`),
      el('label', { class: 'ss-q', title: 'la quantification globale du lancement (Live : Global Quantization) : un clip, une scène, un arrêt partent au prochain pas de cette grille, calée sur la tête de lecture' },
        el('span', { class: 'k' }, 'lancement'),
        el('select', { class: 'fld mu-mini', 'aria-label': 'quantification du lancement', onchange: (e) => { p.launch = { q: e.target.value }; app.label(`quantification du lancement : ${QUANTS.find((x) => x[0] === e.target.value)?.[1]}`); app.commit('quiet'); } },
          QUANTS.map(([k, l]) => el('option', { value: k, selected: k === q || null }, l)))),
      backBtn,
      el('span', { class: 'sp' }),
      el('span', { class: 'ss-hint' }, 'Entrée : lancer · flèches : choisir · double-clic : un clip MIDI · glisser un son ou un MIDI de la bibliothèque dans une case'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'une scène vide sous la scène choisie (Ctrl+I)', onclick: () => scenesNeuve(p.scenes.findIndex((x) => x.id === cur.s) + 1 || p.scenes.length) }, '+ Scène'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'une scène neuve avec une copie des clips qui jouent (Live : Capture and Insert Scene)', onclick: capturer }, 'Capturer'),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: mixer.busMenu }, '+ Bus'),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.setView('nodal') }, 'Voir les câbles'),
      el('div', { class: 'seg ss-bas', role: 'tablist', 'aria-label': 'le bas de la vue' },
        el('button', { class: `tb${bas === 'mix' ? ' on' : ''}`, type: 'button', title: 'la console sous la grille (clic encore : la cacher)',
          onclick: () => { ui().bas = bas === 'mix' ? 'none' : 'mix'; app.saveUi(); render(); } }, 'Console'),
        el('button', { class: `tb${bas === 'clip' ? ' on' : ''}`, type: 'button', disabled: sel ? null : true,
          title: sel ? `la vue Clip de « ${slotName(sel)} » (double-clic sur un clip)` : 'choisis un clip de Session : double-clic dessus',
          onclick: () => { ui().bas = bas === 'clip' ? 'mix' : 'clip'; app.saveUi(); render(); } }, 'Clip')));
  }

  // ── la grille ──
  function titleRow(ts, bs) {
    const p = P();
    return el('div', { class: 'ss-r ss-tr' },
      ts.map((t) => el('div', { class: `ss-t${S.sel.track === t.id ? ' sel' : ''}${engine.sess.hors.has(t.id) ? ' hors' : ''}`, 'data-track': t.id, style: { '--c': `var(--${t.color})` },
        title: `${t.name} · clic : la choisir · double-clic : renommer · clic droit : arrêter, revenir à l'arrangement`,
        onclick: () => choisir(t.id, cur.s) },
      el('b', {}, t.name), el('span', { class: 'lbl' }, `${t.arm ? '● ' : ''}${t.sub || moduleName(app.mod(t.src)?.type) || TRACK_KINDS[t.kind].label}`))),
      bs.map((t) => el('div', { class: 'ss-t bus', 'data-track': t.id, style: { '--c': `var(--${t.color})` }, title: 'un bus (retour) : pas de clips, ses envois sont dans la console' },
        el('b', {}, t.name), el('span', { class: 'lbl' }, 'retour'))),
      el('div', { class: 'ss-fill ss-t add' },
        el('button', { class: 'tb ghost sm', type: 'button', title: 'une piste neuve (ou glisser ici un son, un clip MIDI)', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom + 4, app.trackChoices()); } }, '+ Piste'),
        ts.length ? null : el('span', { class: 'ss-vide' }, 'ou glisser ici un son, un clip MIDI de la bibliothèque (le panneau Asset) : une piste neuve, son clip dans la scène visée')),
      el('div', { class: 'ss-m ss-t master' }, el('b', {}, 'Scènes'), el('span', { class: 'lbl' }, `${p.scenes.length} · lancer une ligne`)));
  }
  function cellOf(t, sc) {
    const p = P(), s = slotAt(p, t.id, sc.id);
    const k = `${t.id}|${sc.id}`;
    const c = el('div', { class: `ss-c${s ? ' full' : ''}${cur.t === t.id && cur.s === sc.id ? ' cur' : ''}`, 'data-t': t.id, 'data-s': sc.id, style: { '--c': `var(--${s?.color || t.color})` } });
    nodes.set(k, c);
    if (s) {
      c.dataset.slot = s.id;
      c.draggable = true;
      c.title = `${slotName(s)} · ${barsTxt(s.len)} mes.${s.mode && s.mode !== 'trigger' ? ` · ${MODES.find((m) => m[0] === s.mode)?.[1]}` : ''} — ▶ : lancer · double-clic : la vue Clip · glisser : déplacer (Ctrl : copier)`;
      c.append(el('button', { class: 'ss-go', type: 'button', 'aria-label': `lancer ${slotName(s)}`, tabindex: -1 }),
        el('span', { class: 'nm' }, slotName(s)),
        el('span', { class: 'len' }, barsTxt(s.len)),
        el('i', { class: 'pr' }));
      cells.set(s.id, { node: c, slot: s, st: '' });
    } else {
      const rec = t.arm && patKind(t), audioArm = t.arm && !patKind(t);
      c.append(el('button', { class: `ss-stop${rec ? ' rec' : ''}${audioArm ? ' rec off' : ''}`, type: 'button', tabindex: -1,
        title: rec ? 'prise : un clip neuf, enregistré ici (piste armée)' : audioArm ? 'la prise audio se fait dans l\'arrangement (Rec, F9)' : 'arrêter la piste (Live : Clip Stop) · double-clic : un clip MIDI vide' }));
    }
    return c;
  }
  function sceneRow(sc, ts, bs) {
    const p = P(), ids = (p.slots || []).filter((s) => s.scene === sc.id).map((s) => s.id);
    const b = el('div', { class: `ss-m ss-sc${cur.t === 'M' && cur.s === sc.id ? ' cur' : ''}`, 'data-s': sc.id, title: `scène ${sceneName(p, sc)} · ▶ : lancer la ligne · double-clic : renommer · clic droit : tempo, dupliquer, vers l'arrangement` },
      el('button', { class: 'ss-sgo', type: 'button', 'aria-label': `lancer la scène ${sceneName(p, sc)}`, tabindex: -1 }),
      el('span', { class: `nm${sc.name ? '' : ' num'}` }, sceneName(p, sc)),
      sc.bpm ? el('span', { class: 'bpm' }, `${sc.bpm}`) : null);
    nodes.set(`M|${sc.id}`, b);
    scenesEl.set(sc.id, { node: b, ids, st: '' });
    return el('div', { class: 'ss-r' }, ts.map((t) => cellOf(t, sc)), bs.map(() => el('div', { class: 'ss-c void' })),
      el('div', { class: 'ss-fill ss-new', 'data-s': sc.id, title: 'glisser ici un son ou un clip MIDI : une piste neuve' }), b);
  }
  function addRow(ts, bs) {
    return el('div', { class: 'ss-r ss-add' },
      ts.map((t) => el('div', { class: 'ss-c ghost', 'data-t': t.id, 'data-s': '+', title: 'glisser ici : une scène neuve' })),
      bs.map(() => el('div', { class: 'ss-c void ghost' })), el('div', { class: 'ss-fill', 'data-s': '+' }),
      el('div', { class: 'ss-m ss-sc add' }, el('button', { class: 'tb ghost sm', type: 'button', title: 'une scène vide, à la fin (Ctrl+I : sous la scène choisie)', onclick: () => scenesNeuve(P().scenes.length) }, '+ Scène')));
  }

  // ── le bas : l'état des pistes, la console ──
  function statusRow(ts, bs) {
    stopAll = el('button', { class: 'ss-all', type: 'button', title: 'Arrêter tous les clips (Live : Stop All Clips), au prochain pas de la quantification', onclick: () => arreter(tracks().map((t) => t.id)) },
      el('i'), el('span', {}, 'tout arrêter'));
    return el('div', { class: 'ss-r ss-str' },
      ts.map((t) => {
        const txt = el('span', { class: 'tx' }), pie = el('i', { class: 'pie' });
        const n = el('div', { class: 'ss-st', 'data-track': t.id, style: { '--c': `var(--${t.color})` } },
          el('button', { class: 'ss-tstop', type: 'button', title: `arrêter « ${t.name} » (Live : Clip Stop), au prochain pas de la quantification`, onclick: () => arreter([t.id]) }), pie, txt);
        states.set(t.id, { node: n, txt, st: '' });
        return n;
      }),
      bs.map(() => el('div', { class: 'ss-st void' })), el('div', { class: 'ss-fill' }), el('div', { class: 'ss-m ss-st master' }, stopAll));
  }
  function mixRow(ts, bs) {
    return el('div', { class: 'ss-r ss-mix' }, ts.map((t) => mixer.strip(t)), bs.map((t) => mixer.strip(t, { bus: true })),
      el('div', { class: 'ss-fill' }), el('div', { class: 'ss-m' }, mixer.masterStrip()));
  }

  // ── la vue Clip d'un clip de Session ──
  function slotMenuItems(s) {
    const p = P();
    return {
      modes: MODES.map(([k, l, sub]) => ({ label: l, sub, checked: (s.mode || 'trigger') === k, onclick: () => { s.mode = k === 'trigger' ? undefined : k; app.label(`mode de lancement : ${l}`); app.commit('data'); } })),
      quant: [{ label: 'Globale', sub: QUANTS.find((x) => x[0] === p.launch?.q)?.[1], checked: !s.q || s.q === 'global', onclick: () => { s.q = undefined; app.commit('data'); } },
        ...QUANTS.map(([k, l]) => ({ label: l, checked: s.q === k, onclick: () => { s.q = k; app.label(`quantification du clip : ${l}`); app.commit('data'); } }))],
      len: [1, 2, 4, 8, 16].map((b) => ({ label: `${b} mesure${b > 1 ? 's' : ''}`, checked: Math.abs(s.len - b * p.sig) < 1e-9,
        onclick: () => { s.len = b * p.sig; app.label(`longueur du clip : ${b} mes.`); app.commit('data'); } })),
      color: [{ label: 'Celle de la piste', checked: !s.color, onclick: () => { s.color = undefined; app.commit('data'); } },
        ...COLORS.map((c) => ({ label: COLOR_FR[c], dot: c, checked: s.color === c, onclick: () => { s.color = c; app.label(`colorer le clip en ${COLOR_FR[c]}`); app.commit('data'); } }))],
    };
  }
  // Un clip de notes boucle d'ordinaire sur tout son motif : quand la vue Clip
  // change la longueur du motif (son menu « mes. », Doubler), le clip suit — sauf
  // si sa longueur avait été choisie à part (menu Longueur).
  let lien = null;   // { slot, steps } : le motif tel que la vue Clip l'a montré
  function suivreMotif(s) {
    const pat = s?.pat && app.pat(s.pat);
    if (pat && lien?.slot === s.id && lien.steps !== pat.steps && Math.abs(s.len - lien.steps / 4) < 1e-9) s.len = pat.steps / 4;
    lien = pat ? { slot: s.id, steps: pat.steps } : null;
  }
  function paintClip() {
    const s = slotById(S.sel.slot), t = s && app.track(s.track);
    ed = null;
    if (ui().bas !== 'clip' || !s || !t) { clipBox.hidden = true; put(clipBox); if (ui().bas === 'clip' && !s) ui().bas = 'mix'; return; }
    clipBox.hidden = false;
    const p = P(), m = slotMenuItems(s);
    const sub = (label, items) => el('button', { class: 'tb ghost sm', type: 'button', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom + 4, items); } }, label);
    const nm = el('b', { class: 'venus', title: 'double-clic : renommer', ondblclick: () => inlineEdit(nm, slotName(s), (v) => { s.name = v.slice(0, 60); app.commit('data'); }, { max: 60 }) }, slotName(s));
    const host = el('div', { class: 'ss-cbody' });
    put(clipBox,
      el('div', { class: 'ss-chead', style: { '--c': `var(--${s.color || t.color})` } },
        el('i', { class: 'dot' }), nm, el('span', { class: 'lbl' }, `${t.name} · scène ${sceneName(p, scene(s.scene))} · boucle de ${barsTxt(s.len)} mes.`),
        el('span', { class: 'sp' }),
        sub(`Longueur · ${barsTxt(s.len)} mes.`, m.len),
        sub(`Lancement · ${MODES.find((x) => x[0] === (s.mode || 'trigger'))[1]}`, m.modes),
        sub(`Quantification · ${s.q && s.q !== 'global' ? QUANTS.find((x) => x[0] === s.q)?.[1] : 'globale'}`, m.quant),
        sub('Couleur', m.color),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'ce clip dans l\'arrangement, à la tête de lecture (autant de tours que sa scène)', onclick: () => versArrangement([s.scene]) }, 'Vers l\'arrangement'),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { ui().bas = 'mix'; app.saveUi(); render(); } }, 'Fermer')),
      host);
    ed = t.kind === 'audio' ? audioPanel(host, s) : patternEditor(app, host, t, s);
    if (centrer) { centrer = false; const e = ed; requestAnimationFrame(() => e?.centrer?.()); }
  }
  // un son en Session : la boucle qu'il joue, son gain, sa transposition, son départ
  function audioPanel(host, s) {
    const p = P(), buf = engine.buffers.get(s.item);
    const cv = el('canvas', { class: 'ss-wave' });
    const draw = () => {
      const b = clipBuffer(engine.buffers.get(s.item), s);
      const w = Math.max(200, host.clientWidth - 260), h = 96, dpr = devicePixelRatio || 1;
      cv.width = w * dpr; cv.height = h * dpr; cv.style.width = `${w}px`; cv.style.height = `${h}px`;
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!b) { g.fillStyle = tok('line'); g.fillRect(0, h / 2, w, 1); return; }
      const rate = Math.pow(2, (s.pitch || 0) / 12), a = (s.off || 0) / b.duration, z = Math.min(1, ((s.off || 0) + s.len * 60 / p.bpm * rate) / b.duration);
      g.fillStyle = tok('cy-bg'); g.fillRect(a * w, 0, (z - a) * w, h);
      const pk = peaks(b, 1200);
      g.fillStyle = tok('cy');
      for (let x = 0; x < w; x++) { const v = Math.min(1, pk[Math.floor((x / w) * pk.length)] || 0), hh = Math.max(1, v * (h - 6)); g.fillRect(x, (h - hh) / 2, 1, hh); }
    };
    const set = (k, v, lab) => { s[k] = v || undefined; app.label(lab); app.commit('quiet'); draw(); };
    put(host, el('div', { class: 'ss-audio' },
      cv,
      el('div', { class: 'ss-knobs' },
        knob({ k: 'gain', label: 'Gain', min: -24, max: 12, def: 0, unit: 'dB', step: 0.1 }, s.gain || 0, { accent: 'cy', onChange: (v) => set('gain', Math.round(v * 10) / 10, 'gain du clip de Session') }),
        knob({ k: 'pitch', label: 'Transposer', min: -24, max: 24, def: 0, unit: 'dt', step: 1 }, s.pitch || 0, { accent: 'cy', onChange: (v) => set('pitch', Math.round(v), 'transposer le clip de Session') }),
        knob({ k: 'off', label: 'Départ', min: 0, max: Math.max(0.1, (buf?.duration || 4) - 0.05), def: 0, unit: 's' }, s.off || 0, { accent: 'cy', onChange: (v) => set('off', Math.round(v * 1000) / 1000, 'le départ du son') })),
      el('p', { class: 'lbl' }, 'le son boucle sur la longueur du clip, depuis son départ · la transposition change la vitesse (Live : Re-Pitch) · rien n\'est calé au tempo')));
    requestAnimationFrame(draw);
    if (!buf) engine.buffer(s.item).then(draw).catch(() => {});
    return null;
  }

  // ── l'ensemble ──
  function render() {
    const p = P();
    mixer.reset();
    cells.clear(); nodes.clear(); states.clear(); scenesEl.clear();
    if (!scene(cur.s)) cur.s = p.scenes[0]?.id || null;
    if (!cur.t || (cur.t !== 'M' && !app.track(cur.t))) cur.t = app.track(S.sel.track)?.kind !== 'bus' && S.sel.track ? S.sel.track : tracks()[0]?.id || 'M';
    if (S.sel.slot && !slotById(S.sel.slot)) S.sel.slot = null;
    if (ui().bas === 'clip' && !S.sel.slot) ui().bas = 'mix';
    suivreMotif(ui().bas === 'clip' ? slotById(S.sel.slot) : null);
    arrTracks = new Set(p.clips.map((c) => c.track));
    const ts = tracks(), bs = mixer.buses();
    const sx = grid.scrollLeft, sy = grid.scrollTop;
    paintHead();
    put(grid, titleRow(ts, bs), p.scenes.map((sc) => sceneRow(sc, ts, bs)), addRow(ts, bs));
    put(bot, statusRow(ts, bs), ui().bas === 'mix' ? mixRow(ts, bs) : null);
    paintClip();
    grid.scrollLeft = sx; grid.scrollTop = sy; bot.scrollLeft = sx;
    for (const x of cells.values()) x.st = '';
    tic = null;
  }

  // l'état du jeu, à chaque image : rien n'est redessiné, seules les classes changent
  function frame(b) {
    mixer.frame();
    ed?.frame?.(b);
    const E = engine.sess, now = engine.absNow();
    const t2 = now !== null && ((now % 1) + 1) % 1 < 0.5;   // le clignotement, au temps
    if (t2 !== tic) { tic = t2; root.classList.toggle('tic', t2); }
    const att = new Map();
    for (const ev of E.file) att.set(ev.track, ev);
    const etat = new Map();   // clip → 'on' | 'wait' | 'rec' (+ ' end' : un arrêt attend)
    for (const [tid, J] of E.joue) {
      const ev = att.get(tid);
      let st = now !== null && now + 1e-6 >= J.depuis ? (J.rec ? 'rec' : 'on') : 'wait';
      if (ev && ev.slot !== J.slot) st += ' end';
      etat.set(J.slot, { st, J });
    }
    // un départ attendu : le clip clignote (déjà en train de jouer : il joue et clignote — il repartira)
    for (const ev of att.values()) {
      if (!ev.slot) continue;
      const was = etat.get(ev.slot);
      etat.set(ev.slot, { ...was, st: was?.st?.startsWith('on') ? 'on wait' : ev.rec ? 'rec wait' : 'wait' });
    }
    for (const [sid, x] of cells) {
      const e = etat.get(sid), st = e?.st || '';
      if (st !== x.st) {
        x.node.classList.remove('on', 'wait', 'rec', 'end');
        if (st) x.node.classList.add(...st.split(' ').filter(Boolean));
        x.st = st;
      }
      if (e?.J && now !== null && st.startsWith('on')) {
        const len = x.slot.len, pr = (((now - e.J.origin) % len) + len) % len / len;
        x.node.style.setProperty('--pr', pr.toFixed(4));
      }
    }
    // l'état des pistes : le clip qui boucle (son camembert, ses tours), l'arrangement, l'arrêt attendu
    for (const [tid, x] of states) {
      const J = E.joue.get(tid), ev = att.get(tid);
      let st, txt = '';
      const s = J && slotById(J.slot);
      if (s && now !== null && now >= J.depuis) {
        const d = now - J.origin;
        st = J.rec ? 'rec' : 'on';
        txt = J.rec ? `prise ${Math.floor(d / P().sig) + 1}` : `×${Math.floor(d / s.len) + 1}`;
        if (!J.rec) x.node.style.setProperty('--pr', (((d % s.len) + s.len) % s.len / s.len).toFixed(4));
      } else st = E.hors.has(tid) ? 'off' : engine.running && arrTracks.has(tid) ? 'arr' : '';
      if (st === 'arr') txt = 'arr.';
      if (ev && !ev.slot) st += ' end';
      if (st !== x.st || x.node.dataset.tx !== txt) {
        x.node.classList.remove('on', 'rec', 'off', 'arr', 'end');
        if (st) x.node.classList.add(...st.split(' ').filter(Boolean));
        x.st = st;
        x.node.dataset.tx = txt;
        x.txt.textContent = txt;
      }
    }
    // une scène joue quand chacun de ses clips joue ; elle attend quand ils attendent
    for (const x of scenesEl.values()) {
      const sts = x.ids.map((id) => etat.get(id)?.st || '');
      const st = !sts.length ? '' : sts.every((v) => v.startsWith('on')) ? 'on' : sts.every((v) => v) && sts.some((v) => v.startsWith('wait')) ? 'wait' : '';
      if (st !== x.st) { x.node.classList.toggle('on', st === 'on'); x.node.classList.toggle('wait', st === 'wait'); x.st = st; }
    }
    backBtn?.classList.toggle('lit', E.hors.size > 0);
    stopAll?.classList.toggle('lit', E.joue.size > 0);
    // la prise : sa place, et sa fin quand la piste ne l'écoute plus (Stop, la lecture arrêtée)
    if (prise) {
      const J = E.joue.get(prise.tid);
      if (J?.rec && J.slot === prise.sid) { if (now !== null) prise.last = Math.max(prise.last, now - J.origin); } else if (!E.file.some((ev) => ev.slot === prise.sid)) finirPrise({ arret: true });
    }
  }

  // ── la souris ──
  let downOn = null;
  grid.addEventListener('pointerdown', (e) => {
    zone = 'grid';
    downOn = e.target;
    if (e.button !== 0) return;
    const c = e.target.closest('.ss-c'), sc = e.target.closest('.ss-sc');
    if (e.target.closest('.ss-go') && c?.dataset.slot) { e.preventDefault(); choisir(c.dataset.t, c.dataset.s); appuyer(c.dataset.slot); return; }
    if (e.target.closest('.ss-sgo') && sc) { e.preventDefault(); choisir('M', sc.dataset.s); lancerScene(sc.dataset.s); return; }
    if (e.target.closest('.ss-stop') && c && !c.classList.contains('ghost')) {
      e.preventDefault();
      const t = app.track(c.dataset.t);
      choisir(c.dataset.t, c.dataset.s);
      if (t?.arm && patKind(t)) prendre(t, c.dataset.s);
      else if (!t?.arm) arreter([c.dataset.t]);
      else toast('la prise audio se fait dans l\'arrangement (Rec, F9)');
      return;
    }
    if (c && c.dataset.t && !c.classList.contains('ghost')) choisir(c.dataset.t, c.dataset.s);
    else if (sc && sc.dataset.s) choisir('M', sc.dataset.s);
  });
  grid.addEventListener('dblclick', (e) => {
    const c = e.target.closest('.ss-c'), sc = e.target.closest('.ss-sc');
    if (e.target.closest('.ss-go, .ss-sgo, .mu-inline')) return;
    if (c?.dataset.slot) { ouvrir(c.dataset.slot); return; }
    if (c?.dataset.t && !c.classList.contains('ghost')) {
      const t = app.track(c.dataset.t);
      if (patKind(t)) nouveauMidi(t, c.dataset.s); else if (t?.kind === 'audio') sonDans(t, c.dataset.s);
      return;
    }
    if (sc?.dataset.s) { const s = scene(sc.dataset.s), n = sc.querySelector('.nm'); if (s && n) inlineEdit(n, s.name, (v) => { s.name = v.slice(0, 40); app.label('renommer la scène'); app.commit('data'); }, { max: 40 }); return; }
    const th = e.target.closest('.ss-t[data-track]');
    if (th && !th.classList.contains('bus')) { const t = app.track(th.dataset.track), n = th.querySelector('b'); if (t && n) inlineEdit(n, t.name, (v) => { t.name = v.slice(0, 60); app.commit('data'); }, { max: 60 }); }
  });
  clipBox.addEventListener('pointerdown', () => { zone = 'clip'; });
  bot.addEventListener('pointerdown', () => { zone = 'grid'; });
  // la grille et le bas défilent ensemble, à l'horizontale ; la molette sur le bas fait défiler la grille
  let syncing = false;
  grid.addEventListener('scroll', () => { if (syncing) return; syncing = true; bot.scrollLeft = grid.scrollLeft; syncing = false; });
  bot.addEventListener('wheel', (e) => {
    if (e.target.closest('.kn, .fdr') || !(e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) return;
    grid.scrollLeft += e.deltaX || e.deltaY;
    e.preventDefault();
  }, { passive: false });

  // ── glisser, déposer ──
  // Le panneau Asset et les fichiers du disque : dropZone (commun/shell.js) — l'import dans la
  // bibliothèque, la dernière version d'un élément, le rapatriement d'un autre Workspace ; la case
  // visée est celle que le glisser survolait. Le navigateur d'ODIO et les clips de Session : ici.
  let survol = null, depot = null;
  const caseSous = (e) => {
    const c = e.target.closest?.('.ss-c, .ss-fill, .ss-t[data-track]');
    if (!c || c.classList.contains('void') || c.classList.contains('bus')) return null;
    // l'en-tête d'une piste : sa première case libre (une scène neuve s'il n'y en a pas)
    if (c.classList.contains('ss-t')) return { node: c, t: c.dataset.track, s: P().scenes.find((sc) => !slotAt(P(), c.dataset.track, sc.id))?.id || '+' };
    return { node: c, t: c.dataset.t || null, s: c.dataset.s || null };
  };
  const marquer = (h) => { if (survol?.node !== h?.node) { survol?.node.classList.remove('drop'); h?.node.classList.add('drop'); } survol = h; };
  dropZone(grid, { kinds: ['audio', 'midi'], via: 'odio', label: 'la Session', onitems: (items) => deposer(items, depot) });
  grid.addEventListener('dragstart', (e) => {
    const c = e.target.closest?.('.ss-c');
    if (!c?.dataset.slot || downOn?.closest?.('.ss-go')) { if (c) e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(SLOT_MIME, c.dataset.slot);
    c.classList.add('lift');
  });
  grid.addEventListener('dragend', () => { for (const n of grid.querySelectorAll('.lift')) n.classList.remove('lift'); marquer(null); });
  grid.addEventListener('dragover', (e) => {
    const ty = [...(e.dataTransfer?.types || [])];
    const ours = ty.includes(SLOT_MIME) || ty.includes(ODIO_MIME);
    if (!ours && !ty.includes('Files') && !ty.includes(ITEM_MIME)) return;
    const h = caseSous(e);
    marquer(h);
    if (ours && h) { e.preventDefault(); e.dataTransfer.dropEffect = ty.includes(SLOT_MIME) && !(e.ctrlKey || e.altKey) ? 'move' : 'copy'; }
  });
  grid.addEventListener('dragleave', (e) => { if (!grid.contains(e.relatedTarget)) marquer(null); });
  grid.addEventListener('drop', (e) => {
    const h = caseSous(e);
    marquer(null);
    depot = h ? { t: h.t, s: h.s } : null;
    const ty = [...(e.dataTransfer?.types || [])];
    if (ty.includes('Files') || ty.includes(ITEM_MIME) || !h) return;   // dropZone s'en charge
    e.preventDefault();
    const id = e.dataTransfer.getData(SLOT_MIME);
    if (id) {
      const s = slotById(id);
      if (!s) return;
      if (!depot.t) { toast('un clip de Session va dans une case de piste'); return; }
      const sid = caseDe(depot), tid = depot.t;
      const n = poser(s, tid, sid, { move: !(e.ctrlKey || e.altKey) });
      if (!n) return;
      choisir(n.track, n.scene, { peindre: false });
      S.sel.slot = n.id;
      app.label(e.ctrlKey || e.altKey ? `copier « ${slotName(s)} »` : `déplacer « ${slotName(s)} »`);
      app.commit('data');
      return;
    }
    let d = null;
    try { d = JSON.parse(e.dataTransfer.getData(ODIO_MIME)); } catch { return; }
    deposerOdio(d, depot).catch((err) => toast(err.message));
  });

  // ── le clavier (musique.js le passe à la vue) ──
  function bouger(dx, dy) {
    const p = P(), cols = [...tracks().map((t) => t.id), 'M'];
    let i = cols.indexOf(cur.t), j = p.scenes.findIndex((x) => x.id === cur.s);
    if (i < 0) i = 0;
    if (j < 0) j = 0;
    i = clamp(i + dx, 0, cols.length - 1); j = clamp(j + dy, 0, Math.max(0, p.scenes.length - 1));
    choisir(cols[i], p.scenes[j]?.id || null);
  }
  function key(e) {
    if (zone === 'clip' && ed?.key?.(e)) return true;
    const p = P(), ctrl = e.ctrlKey || e.metaKey, k = e.key;
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dirs[k] && !ctrl && !e.altKey) { e.preventDefault(); bouger(...dirs[k]); return true; }
    const s = cur.t && cur.t !== 'M' ? slotAt(p, cur.t, cur.s) : null;
    const sc = scene(cur.s);
    if (k === 'Enter') {
      e.preventDefault();
      if (e.repeat) return true;
      if (cur.t === 'M') { if (sc) lancerScene(sc.id); return true; }
      const t = app.track(cur.t);
      if (s) appuyer(s.id, { clavier: true });
      else if (t?.arm && patKind(t) && sc) prendre(t, sc.id);
      else if (t) arreter([t.id]);
      return true;
    }
    if ((k === 'Delete' || k === 'Backspace') && !ctrl) {
      if (s) { retirer(s); return true; }
      if (cur.t === 'M' && sc) { retirerScene(p, sc.id); app.label('retirer la scène'); app.commit('data'); return true; }
      return false;
    }
    if (!ctrl || e.altKey) return false;
    const L = letter(e);
    if (L === 'd') { e.preventDefault(); if (s) dupliquer(s); else if (cur.t === 'M' && sc) { const n = dupliquerScene(p, sc.id, app.uid); cur.s = n.id; app.label('dupliquer la scène'); app.commit('data'); } return true; }
    if (L === 'r') { e.preventDefault(); if (s) renommer(s); else if (sc) { const n = nodes.get(`M|${sc.id}`)?.querySelector('.nm'); if (n) inlineEdit(n, sc.name, (v) => { sc.name = v.slice(0, 40); app.commit('data'); }, { max: 40 }); } return true; }
    if (L === 'c' && s) { presse = JSON.parse(JSON.stringify(s)); toast(`« ${slotName(s)} » copié`); return true; }
    if (L === 'x' && s) { presse = JSON.parse(JSON.stringify(s)); retirer(s); return true; }
    if (L === 'v' && cur.t !== 'M' && sc) { coller(cur.t, sc.id); return true; }
    if (L === 'i') { e.preventDefault(); if (e.shiftKey) capturer(); else scenesNeuve(p.scenes.findIndex((x) => x.id === cur.s) + 1 || p.scenes.length); return true; }
    return false;
  }

  // ── le clic droit : le menu de ce qu'on survole ──
  function zoneMenu(e) {
    const p = P();
    const c = e.target.closest?.('.ss-c'), scn = e.target.closest?.('.ss-sc'), th = e.target.closest?.('.ss-t[data-track], .ss-st[data-track]');
    if (c?.dataset.slot) {
      const s = slotById(c.dataset.slot);
      if (!s) return null;
      const m = slotMenuItems(s);
      choisir(c.dataset.t, c.dataset.s);
      return [
        { head: `${slotName(s)} · ${barsTxt(s.len)} mes.` },
        { label: 'Lancer', key: 'Entrée', onclick: () => appuyer(s.id) },
        { label: 'Arrêter la piste', onclick: () => arreter([s.track]) },
        { label: 'Ouvrir dans la vue Clip', sub: 'double-clic', onclick: () => ouvrir(s.id) },
        '-',
        { label: 'Renommer', key: 'Ctrl+R', onclick: () => renommer(s) },
        { label: 'Dupliquer', key: 'Ctrl+D', onclick: () => dupliquer(s) },
        { label: 'Copier', key: 'Ctrl+C', onclick: () => { presse = JSON.parse(JSON.stringify(s)); } },
        { label: 'Coller ici', key: 'Ctrl+V', disabled: !presse, why: 'rien à coller : Ctrl+C sur un clip de Session', onclick: () => coller(s.track, s.scene) },
        { label: 'Mode de lancement', items: m.modes },
        { label: 'Quantification', items: m.quant },
        { label: 'Longueur', items: m.len },
        { label: 'Couleur', items: m.color },
        { label: 'Vers l\'arrangement', sub: 'la scène entière, à la tête de lecture', onclick: () => versArrangement([s.scene]) },
        '-',
        { label: 'Retirer', key: 'Suppr', danger: true, onclick: () => retirer(s) },
      ];
    }
    if (c?.dataset.t && !c.classList.contains('void')) {
      const t = app.track(c.dataset.t), sid = c.dataset.s === '+' ? null : c.dataset.s;
      if (sid) choisir(t.id, sid);
      return [
        { head: `${t.name} · scène ${sid ? sceneName(p, scene(sid)) : 'neuve'}` },
        patKind(t) ? { label: 'Un clip MIDI vide', sub: 'double-clic', onclick: () => nouveauMidi(t, sid || caseDe({ s: '+' })) } : null,
        t.kind === 'audio' ? { label: 'Un son de la bibliothèque', sub: 'double-clic', onclick: () => sonDans(t, sid || caseDe({ s: '+' })) } : null,
        t.arm && patKind(t) ? { label: 'Prendre ici', sub: 'la piste est armée', onclick: () => prendre(t, sid || caseDe({ s: '+' })) } : null,
        { label: 'Coller ici', key: 'Ctrl+V', disabled: !presse, why: 'rien à coller : Ctrl+C sur un clip de Session', onclick: () => coller(t.id, sid || caseDe({ s: '+' })) },
        { label: 'Arrêter la piste', onclick: () => arreter([t.id]) },
      ];
    }
    if (scn?.dataset.s) {
      const sc = scene(scn.dataset.s);
      choisir('M', sc.id);
      const i = p.scenes.indexOf(sc);
      return [
        { head: `scène ${sceneName(p, sc)}` },
        { label: 'Lancer la scène', key: 'Entrée', onclick: () => lancerScene(sc.id) },
        { label: 'Renommer', key: 'Ctrl+R', onclick: () => { const n = scn.querySelector('.nm'); inlineEdit(n, sc.name, (v) => { sc.name = v.slice(0, 40); app.commit('data'); }, { max: 40 }); } },
        { label: 'Tempo de la scène', sub: sc.bpm ? `${sc.bpm} BPM` : 'aucun', onclick: async () => {
          const v = await ask('Tempo de la scène', 'BPM posé au lancement de la scène (20 à 300) · 0 : aucun', String(sc.bpm || P().bpm), 'Régler');
          if (v === null) return;
          const n = Math.round(+v);
          sc.bpm = n >= 20 && n <= 300 ? n : undefined;
          app.label('tempo de la scène'); app.commit('data');
        } },
        '-',
        { label: 'Insérer une scène dessous', key: 'Ctrl+I', onclick: () => scenesNeuve(i + 1) },
        { label: 'Capturer et insérer', sub: 'les clips qui jouent', onclick: capturer },
        { label: 'Dupliquer la scène', key: 'Ctrl+D', onclick: () => { const n = dupliquerScene(p, sc.id, app.uid); cur.s = n.id; app.label('dupliquer la scène'); app.commit('data'); } },
        { label: 'Monter', disabled: i === 0, why: 'déjà en haut', onclick: () => { p.scenes.splice(i, 1); p.scenes.splice(i - 1, 0, sc); app.label('monter la scène'); app.commit('data'); } },
        { label: 'Descendre', disabled: i === p.scenes.length - 1, why: 'déjà en bas', onclick: () => { p.scenes.splice(i, 1); p.scenes.splice(i + 1, 0, sc); app.label('descendre la scène'); app.commit('data'); } },
        '-',
        { label: 'Copier la scène dans l\'arrangement', sub: 'à la tête de lecture', onclick: () => versArrangement([sc.id]) },
        { label: 'Toutes les scènes dans l\'arrangement', sub: 'à la suite, depuis la tête', onclick: () => versArrangement(p.scenes.map((x) => x.id)) },
        '-',
        { label: 'Retirer la scène', sub: 'et ses clips', danger: true, onclick: () => { retirerScene(p, sc.id); app.label('retirer la scène'); app.commit('data'); } },
      ];
    }
    if (th?.dataset.track) {
      const t = app.track(th.dataset.track);
      if (!t || t.kind === 'bus') return null;
      return [
        { head: t.name },
        { label: 'Arrêter la piste', onclick: () => arreter([t.id]) },
        { label: 'Revenir à l\'arrangement', sub: 'cette piste', disabled: !engine.sess.hors.has(t.id), why: 'elle joue déjà l\'arrangement', onclick: () => engine.retourArrangement([t.id]) },
        { label: t.arm ? 'Désarmer' : 'Armer', sub: 'la prise de Session', onclick: () => { t.arm = !t.arm; app.commit('quiet'); render(); } },
        { label: 'Retirer la piste', danger: true, onclick: () => app.removeTrack(t.id) },
      ];
    }
    return null;
  }

  // la prise lit le clavier de l'ordinateur et le MIDI (musique.js les lui passe)
  app.session = { noteOn, noteOff };
  return { el: root, render, frame, key, zoneMenu, paintSel, lancerScene, appuyer, arreter, finirPrise, get prise() { return prise; } };
}
