// ODIO — la vue Session : le lanceur de clips de Live, en couche PAR-DESSUS
// l'arrangement. Demande de Cal (05/10) : « notre partie CONSOLE de ODIO
// devient la partie Scène d'Ableton : un launchpad avec la même logique et les
// mêmes outils que ceux d'Ableton » ; refaite le soir sur sa parole : « il est
// vierge et ne veut pas reproduire les pistes de la partie arrangement. C'est
// vraiment un truc "marche on top" pour lancer des trucs EN PLUS de ce qui
// avance dans la timeline de l'arrangement » — et « un design mieux et centré,
// car tout est à gauche ». Le modèle : manuel de Live 12 (« Session View »,
// « Launching Clips », « Mixing ») ; ce qui est retenu et adapté :
// docs/etudes/odio_session.md (§ 6 : la refonte).
//
//   les voies      les colonnes, à la Session (p.voies, projet.js) : vierges
//                  dans un projet neuf (+ Voie, ou un clip glissé), ou nées d'une
//                  piste (« Envoyer à la Session », biblio.js). Chacune a sa
//                  source, sa chaîne et sa tranche ; elle joue EN PLUS de
//                  l'arrangement, sur la même horloge, sans rien en arrêter
//   la grille      une colonne par voie, une ligne par scène, au centre ; chaque
//                  case est vide (son bouton Stop, ou de prise si la voie est
//                  armée), un clip arrêté, un clip qui joue (sa progression), un
//                  clip qui attend son temps (il clignote au temps), une prise ;
//                  à droite des voies, une colonne libre (une voie neuve) ; sous
//                  la grille, l'état de chaque voie (Stop, le clip qui boucle)
//   à droite       les scènes, collées à la grille : lancer une scène lance
//                  toute sa ligne (une case vide arrête sa voie) ; le tempo d'une
//                  scène ; tout en bas, Arrêter tous les clips
//   en bas         la console en groupes — voies, pistes de l'arrangement,
//                  retours, sortie (console.js) — ou la vue Clip du clip ouvert
//   à gauche       le navigateur d'ODIO, le même que celui de l'arrangement
//                  (navigateur.js ; la rubrique « Projet » en tête : biblio.js)
//   en tête        la quantification globale du lancement, + Voie, + Scène,
//                  Capturer
//
// Le jeu (ce qui tourne, ce qui attend) est l'état du moteur (moteur.js,
// Engine.sess), pas le projet : un lancement ne s'annule pas (Live non plus).
// Tout le reste — voies, clips, scènes, réglages — passe par app.commit
// (annuler, l'enregistrement). Un clip de Session boucle sur sa longueur.

import { toast, api, pick, href, dropZone, ITEM_MIME } from '../commun/shell.js';
import { TRACK_KINDS, COLORS, COLOR_FR, DRUM_MODELS, NOTE_MODELS, SOURCES_OF, MODULES, EFFECT_TYPES, drumVoicesOf, moduleName, kindOfSource } from './modules.js';
import { el, menu, put, inlineEdit, knob, clamp, ask, letter, tok, splitter } from './ui.js';
import { createMixer } from './console.js';
import { createBrowser } from './navigateur.js';
import { patternEditor } from './editeurs.js';
import { placeNotes } from './generatif_midi.js';
import { peaks, clipBuffer } from './moteur.js';
import { QUANTS, quantum, slotQuant, slotAt, sceneName, insererScene, copieSlot, dupliquerScene, retirerScene, capturerScene,
  sceneVersArrangement, voieNeuve, retirerVoies } from './projet.js';
import { accepte, refDe, slotDeRef, voiePourRef, caseLibre } from './biblio.js';
import { etatCalcul, poserCalcul } from './calcul.js';   // « ça calcule » (06/10) : une case dont le son est en calcul

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
  const pui = () => S.proj.ui;
  const navW = () => (pui().nav === false ? 30 : clamp(pui().navW || 214, 160, 420));
  const root = el('section', { class: 'ss', 'aria-label': 'session' });
  const head = el('div', { class: 'ss-head' });
  const grid = el('div', { class: 'ss-grid' });   // la grille qui défile, centrée
  const bot = el('div', { class: 'ss-bot' });     // la console, en groupes
  const clipBox = el('div', { class: 'ss-clip' });
  // la hauteur du bas (la console ou la vue Clip) : le filet se tire, elle reste (comme le détail de l'arrangement)
  const botH = () => clamp(ui().botH || 330, 120, Math.max(160, innerHeight - 320));
  const botSplit = splitter('y', { get: botH, min: 120, max: 900, invert: true, reset: 330, title: 'tirer : la hauteur du bas · double-clic : d\'origine',
    set: (v) => { main.style.setProperty('--ss-bh', `${v}px`); }, done: (v) => { ui().botH = v; app.saveUi(); } });
  const main = el('div', { class: 'ss-main' }, grid, botSplit, bot, clipBox);
  const mixer = createMixer(app, { onSelect: (t, deVoie) => { if (deVoie) choisir(t.id, cur.s); else paintSel(); } });
  // le navigateur d'ODIO, commun aux deux vues (Live) : un clic pose dans la case choisie
  const browser = createBrowser(app, { poser: (d) => deposerOdio(d, ici()).catch((e) => toast(e.message)) });
  const navSplit = splitter('x', { get: navW, min: 160, max: 420, reset: 214, title: 'tirer : la largeur du navigateur · double-clic : d\'origine',
    set: (v) => { body.style.setProperty('--nav-w', `${v}px`); }, done: (v) => { pui().navW = v; pui().nav = true; app.saveUi(); } });
  const body = el('div', { class: 'ss-body' }, browser.el, navSplit, main);
  root.append(head, body);

  // la case choisie : une voie (ou 'M', la colonne des scènes) et une scène
  const cur = { v: null, s: null };
  const ici = () => ({ v: cur.v && cur.v !== 'M' ? cur.v : null, s: cur.s });
  // ce que la vue dessine, pour que frame() n'y touche qu'en cas de changement
  const cells = new Map();     // id du clip → { node, slot, st }
  const nodes = new Map();     // « voie|scène » → la case
  const states = new Map();    // voie → { node, txt, st }
  const scenesEl = new Map();  // scène → { node, ids, st }
  let stopAll = null, ed = null, zone = 'grid', tic = null;
  let prise = null;            // la prise de Session en cours : { vid, sid, pat, open, last, n }
  let tenu = null, repT = null;

  const voies = () => P().voies || [];
  const voie = (id) => app.voie(id);
  const slotById = (id) => (P().slots || []).find((s) => s.id === id) || null;
  const scene = (id) => P().scenes.find((x) => x.id === id) || null;
  const barsTxt = (len) => { const sig = P().sig, b = len / sig; return Number.isInteger(b) ? `${b}` : Number.isInteger(len) ? `${len}t` : len.toFixed(2); };
  const slotName = (s) => s.name || (s.pat ? app.pat(s.pat)?.name : null) || (s.item ? 'son' : 'clip');
  const patKind = (v) => TRACK_KINDS[v?.kind]?.pattern || null;
  const nPluriel = (n, un, des) => `${n} ${n > 1 ? des : un}`;

  // ── choisir une case ──
  function choisir(vid, sid, { peindre = true } = {}) {
    cur.v = vid; cur.s = sid || cur.s || P().scenes[0]?.id || null;
    if (vid && vid !== 'M' && voie(vid)) S.sel.voie = vid;
    const s = vid && vid !== 'M' ? slotAt(P(), vid, cur.s) : null;
    if (s) S.sel.slot = s.id;
    if (peindre) paintSel();
  }
  function paintSel() {
    for (const [k, n] of nodes) n.classList.toggle('cur', k === `${cur.v}|${cur.s}`);
    for (const n of root.querySelectorAll('[data-voie]')) n.classList.toggle('sel', n.dataset.voie === S.sel.voie);
    for (const n of bot.querySelectorAll('[data-track]')) n.classList.toggle('sel', n.dataset.track === S.sel.track);
    nodes.get(`${cur.v}|${cur.s}`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  // ── lancer, arrêter ──
  const globalQ = () => quantum(P().launch?.q, P().sig);
  async function lancer(list, q) {
    if (!list.length) return;
    await engine.lancer(list.map((s) => ({ voie: s.voie, slot: s.id })), q ?? slotQuant(P(), list[0]));
    app.paintTransport();
  }
  async function arreter(vids, q = globalQ()) {
    if (!vids.length) return;
    await engine.lancer(vids.map((vid) => ({ voie: vid, slot: null })), q);
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
    // une case vide arrête sa voie (Live : le bouton Stop de la case) ; l'arrangement continue
    await engine.lancer(voies().map((v) => ({ voie: v.id, slot: slotAt(p, v.id, sid)?.id || null })), globalQ());
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
    const J = engine.sess.joue.get(s.voie), att = engine.sess.file.find((ev) => ev.voie === s.voie);
    if (mode === 'toggle' && (J?.slot === sid || att?.slot === sid)) { await arreter([s.voie], slotQuant(P(), s)); return; }
    // tenu avant d'attendre le départ : un relâcher rapide le trouve
    if (!clavier && (mode === 'gate' || mode === 'repeat')) tenu = { sid, mode, vid: s.voie };
    await lancer([s]);
    if (tenu?.sid === sid && tenu.mode === 'repeat') {
      // tant qu'on tient : un nouveau départ à chaque pas de la quantification (1/16 sans quantification)
      const q = slotQuant(P(), s) || 0.25;
      clearInterval(repT);
      repT = setInterval(() => {
        if (!tenu || !engine.running) return;
        if (!engine.sess.file.some((ev) => ev.voie === tenu.vid)) engine.lancer([{ voie: tenu.vid, slot: tenu.sid }], q);
      }, 20);
    }
  }
  function relacher() {
    if (!tenu) return;
    const { sid, mode, vid } = tenu;
    tenu = null;
    clearInterval(repT);
    if (mode === 'gate') arreter([vid], slotQuant(P(), slotById(sid)));
  }
  addEventListener('pointerup', relacher);
  addEventListener('pointercancel', relacher);

  // ── la prise de Session : une case vide d'une voie armée ──
  // Live 12 (« Session View ») : sur une piste armée, les cases vides deviennent
  // des boutons de prise. La prise part quantifiée ; ce qu'on joue au clavier de
  // l'ordinateur ou en MIDI s'écrit dans un motif neuf ; presser le clip la finit
  // à la fin de la mesure en cours, et le clip boucle sur cette longueur.
  async function prendre(v, sid) {
    const p = P();
    if (!patKind(v)) { toast('la prise de Session : une voie de batterie ou de synthé ; le micro se prend dans l\'arrangement (Rec, F9)', 5000); return; }
    if (prise) finirPrise();
    const pat = app.newPattern(v.id, null, { quiet: true, name: 'Prise' });
    pat.steps = MAX_PRISE * 4;
    const s = { id: app.uid('cl'), voie: v.id, scene: sid, pat: pat.id, len: p.sig * 4, name: 'Prise' };
    p.slots.push(s);
    prise = { vid: v.id, sid: s.id, pat: pat.id, open: new Map(), last: 0, n: 0 };
    app.label(`prise de Session sur « ${v.name} »`);
    app.commit('data');
    await engine.lancer([{ voie: v.id, slot: s.id, rec: true }], globalQ());
    toast(S.kbd ? 'prise : joue (le clavier de l\'ordinateur, ou le MIDI) · clic sur le clip : il boucle' : 'prise : joue en MIDI, ou allume le clavier (M) · clic sur le clip : il boucle', 5000);
  }
  // où en est la prise, en noires depuis son départ (null : elle n'écoute pas)
  function posPrise(v) {
    if (!prise || v.id !== prise.vid) return null;
    const J = engine.sess.joue.get(v.id), now = engine.absNow();
    if (!J?.rec || J.slot !== prise.sid || now === null || now < J.origin) return null;
    return now - J.origin;
  }
  function noteOn(v, pitch, vel, key) {
    const pos = posPrise(v), pat = prise && app.pat(prise.pat);
    if (pos === null || !pat || pos * 4 >= pat.steps) return;
    if (v.kind === 'drums') {
      const dv = drumVoicesOf(app.mod(v.src)?.type)[((pitch % 12) + 12) % 12];
      if (!dv) return;
      const i = Math.min(pat.steps - 1, Math.round(pos * 4));
      if (!pat.lanes[dv.id]) pat.lanes[dv.id] = Array(pat.steps).fill(0);
      pat.lanes[dv.id][i] = Math.max(pat.lanes[dv.id][i], Math.round(vel * 100) / 100);
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
    const J = engine.sess.joue.get(prise.vid), now = engine.absNow();
    fermerNote(o, J && now !== null ? now - J.origin : o.on + 0.25);
  }
  // `arret` : la prise s'arrête avec sa voie (Stop, la lecture arrêtée) ; sinon
  // elle finit à la fin de la mesure en cours, et le clip boucle de là
  function finirPrise({ arret = false } = {}) {
    const pr = prise;
    if (!pr) return;
    const p = P(), s = slotById(pr.sid), pat = app.pat(pr.pat), J = engine.sess.joue.get(pr.vid);
    const now = engine.absNow();
    const pos = J?.rec && now !== null ? now - J.origin : pr.last;
    for (const o of pr.open.values()) fermerNote(o, pos);
    prise = null;
    engine.finPrise(pr.vid);
    if (!s || !pat) return;
    if (!pr.n) {
      p.slots = p.slots.filter((x) => x !== s);
      p.patterns = p.patterns.filter((x) => x !== pat);
      if (J?.slot === s.id && !arret) arreter([pr.vid], 0);
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
    app.label(`prise de Session sur « ${voie(pr.vid)?.name || ''} »`);
    app.commit('data');
  }

  // ── les voies ──
  // « + Voie » : les sortes et les instruments d'une piste (musique.js, trackChoices), mais dans la Session
  function voieChoices() {
    const out = [{ head: 'une voie de Session' }];
    for (const [k, list] of Object.entries(SOURCES_OF)) {
      if (k === 'bus') continue;
      for (const type of list) {
        out.push({ label: k === 'audio' ? 'Audio' : `${TRACK_KINDS[k].label} · ${MODULES[type].name}`, sub: k === 'audio' ? 'des sons qui bouclent' : MODULES[type].kind,
          dot: MODULES[type].color, onclick: () => nouvelleVoie(k, { type }) });
      }
    }
    return out;
  }
  function nouvelleVoie(kind, o = {}) {
    const v = voieNeuve(P(), kind, o, app.uid);
    cur.v = v.id; S.sel.voie = v.id;
    app.label(`une voie de Session « ${v.name} »`);
    app.commit('graph');
    return v;
  }
  function retirerVoie(v) {
    const n = (P().slots || []).filter((s) => s.voie === v.id).length;
    retirerVoies(P(), [v.id]);
    if (S.sel.voie === v.id) S.sel.voie = null;
    app.label(`retirer la voie « ${v.name} »`);
    app.commit('graph');
    toast(`« ${v.name} » retirée${n ? `, et ses ${nPluriel(n, 'clip', 'clips')}` : ''} · Ctrl+Z la rend`, 4000);
  }
  function renommerVoie(v, n) {
    if (v && n) inlineEdit(n, v.name, (x) => { v.name = x.slice(0, 60); app.label('renommer la voie'); app.commit('data'); }, { max: 60 });
  }

  // ── poser des clips ──
  // une scène plus bas (créée au besoin) : où vont les objets suivants d'un dépôt
  function sceneSous(sid) {
    const p = P(), i = p.scenes.findIndex((x) => x.id === sid);
    return (p.scenes[i + 1] || insererScene(p, p.scenes.length, app.uid)).id;
  }
  // la scène visée : `here` { v, s } ; s === '+' : une scène neuve ; sans s : la scène choisie
  function caseDe(here) {
    const p = P();
    if (here?.s && here.s !== '+' && scene(here.s)) return here.s;
    return (here?.s === '+' || !p.scenes.length ? insererScene(p, p.scenes.length, app.uid) : scene(cur.s) || p.scenes[0]).id;
  }
  // Un clip déjà fait (copier, glisser) posé dans une case : la case prise est
  // remplacée (Ctrl+Z la rend). D'une voie à une autre, un motif est copié.
  function poser(s, vid, sid, { move = false } = {}) {
    const p = P(), v = voie(vid), from = voie(s.voie);
    if (!v) return null;
    if ((v.kind === 'audio') !== !!s.item) { toast(s.item ? 'un son va dans une voie audio' : 'un clip de notes va dans une voie de batterie ou de synthé'); return null; }
    if (!s.item && patKind(v) !== patKind(from)) { toast('ce motif ne va que dans une voie de la même sorte (batterie ↔ batterie, notes ↔ notes)'); return null; }
    const old = slotAt(p, vid, sid);
    if (old === s) return s;
    let pat = s.pat;
    if (!s.item && vid !== s.voie) { const src = app.pat(s.pat); if (src) pat = app.newPattern(vid, src, { quiet: true, name: src.name }).id; }
    if (old) p.slots = p.slots.filter((x) => x !== old);
    if (move) { Object.assign(s, { voie: vid, scene: sid }, pat ? { pat } : {}); return s; }
    const n = copieSlot(s, app.uid, { voie: vid, scene: sid, ...(pat ? { pat } : {}) });
    p.slots.push(n);
    return n;
  }
  function placer(vid, sid, fields) {
    const p = P(), old = slotAt(p, vid, sid);
    if (old) p.slots = p.slots.filter((x) => x !== old);
    const s = { id: app.uid('cl'), voie: vid, scene: sid, ...fields };
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
  // un clip MIDI de la bibliothèque → un motif de la voie (generatif_midi.js, placeNotes), dans la case
  async function midiDans(v, sid, id) {
    const p = P(), r = await api(`music/midi/${id}/notes`);
    if (!r.notes?.length) { toast('ce clip MIDI n\'a pas de note'); return null; }
    const notes = r.notes.map(([s, l, pp, vv, ch]) => [s, l, pp, vv, ch]);
    const name = `${(r.title || 'MIDI').replace(/ \(essai\)/g, '')}`.slice(0, 40);
    if (!v) {
      const drums = notes.every((n) => n[4] === 9);
      v = voieNeuve(p, drums ? 'drums' : 'synth', { type: drums ? 'rythme' : 'synth', name }, app.uid);
    }
    const { made, lost } = placeNotes(app, v.id, notes, 0, { name });
    const gone = new Set(made.map((c) => c.id));
    p.clips = p.clips.filter((c) => !gone.has(c.id));   // placeNotes pose des clips : la Session n'en garde que le motif
    const extra = new Set(made.slice(1).map((c) => c.pat));
    if (extra.size) { p.patterns = p.patterns.filter((x) => !extra.has(x.id)); toast(`clip MIDI long : la case prend ses ${barsTxt(made[0].len)} premières mesures (un motif tient 256 pas)`, 5000); }
    if (lost) toast(`${lost} coup${lost > 1 ? 's' : ''} sans voix sur cette batterie (table General MIDI) : laissé${lost > 1 ? 's' : ''}`, 5000);
    return placer(v.id, sid, { pat: made[0].pat, len: made[0].len, name });
  }
  // Des objets de la bibliothèque (le panneau Asset, le navigateur, le disque),
  // lâchés sur une case : les suivants descendent d'une scène à chaque fois (Live).
  // Hors d'une voie qui les prend (la colonne libre, la Session vierge) : une voie neuve.
  // Rend le nombre de clips posés.
  async function deposer(items, here) {
    if (!items.length) return 0;
    let sid = caseDe(here), v = here?.v ? voie(here.v) : null;
    const made = [];
    for (const it of items) {
      if (it.kind === 'audio') {
        app.items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
        if (!v || v.kind !== 'audio') {
          if (v) toast(`« ${it.title || it.id} » : un son va dans une voie audio — une voie neuve le prend`, 4000);
          v = voieNeuve(P(), 'audio', { name: (it.title || 'Audio').slice(0, 60) }, app.uid);
        }
        made.push(placer(v.id, sid, { item: it.id, off: 0, len: await lenDuSon(it), name: (it.title || 'son').slice(0, 60) }));
      } else if (it.kind === 'midi') {
        const s = await midiDans(patKind(v) ? v : null, sid, it.id).catch((e) => { toast(e.message); return null; });
        if (s) { made.push(s); v = voie(s.voie); }
      } else { toast(`la Session prend des sons et des clips MIDI : « ${it.title || it.id} » n'en est pas un`); continue; }
      sid = sceneSous(sid);
    }
    if (!made.length) return 0;
    cur.v = made[0].voie; cur.s = made[0].scene; S.sel.slot = made[0].id; S.sel.voie = made[0].voie;
    app.label(made.length > 1 ? `poser ${made.length} clips de Session` : `poser « ${slotName(made[0])} » en Session`);
    app.commit('graph');
    return made.length;
  }
  // ce que le navigateur d'ODIO lâche (navigateur.js) sur une case — ou un clic, dans la case choisie
  async function deposerOdio(d, here) {
    const p = P(), v = here?.v ? voie(here.v) : null;
    const fini = (s, lab) => {
      if (!s) return null;
      cur.v = s.voie; cur.s = s.scene; S.sel.slot = s.id; S.sel.voie = s.voie;
      app.label(lab); app.commit('graph');
      return s;
    };
    if (d.t === 'son') return deposer([d.item], here);
    if (d.t === 'midi') return deposer([{ id: d.id, kind: 'midi' }], here);
    if (d.t === 'pclip') {
      // un clip de la bibliothèque du projet (biblio.js) : dans la voie visée si elle le prend, sinon une voie neuve
      const ref = refDe(p, d.id);
      if (!ref) return null;
      const vv = accepte(v, ref) ? v : voiePourRef(app, ref);
      if (v && vv !== v) toast(`« ${v.name} » ne prend pas ce clip : une voie neuve`, 3500);
      const sid = vv === v ? caseDe(here) : caseLibre(p, vv.id, here?.s, app.uid);
      return fini(slotDeRef(app, ref, vv, sid), `poser « ${ref.name || 'clip du projet'} » en Session`);
    }
    if (d.t === 'motif') {
      const src = app.pat(d.pat), from = src && app.owner(src.track);
      if (!src || !from) return null;
      let vv = patKind(v) === patKind(from) ? v : null;
      if (!vv) { const m = app.mod(from.src); vv = voieNeuve(p, from.kind, { type: m?.type, params: JSON.parse(JSON.stringify(m?.params || {})), name: from.name }, app.uid); }
      const pat = vv.id === src.track ? src : app.newPattern(vv.id, src, { quiet: true, name: src.name });
      return fini(placer(vv.id, caseDe(here), { pat: pat.id, len: pat.steps / 4, name: src.name }), `poser « ${src.name} » en Session`);
    }
    if (d.t === 'modele') {
      const want = d.kind === 'drums' ? 'drums' : 'notes';
      const m = want === 'drums' ? DRUM_MODELS.find((x) => x.id === d.id) : NOTE_MODELS.find((x) => x.id === d.id);
      if (!m) return null;
      const vv = patKind(v) === want ? v : voieNeuve(p, want === 'drums' ? 'drums' : 'synth', { type: want === 'drums' ? 'rythme' : 'synth' }, app.uid);
      const pat = app.newPattern(vv.id, null, { quiet: true, name: m.name });
      Object.assign(pat, want === 'drums' ? { steps: 16, lanes: JSON.parse(JSON.stringify(m.lanes)) } : m.make(p.key, p.sig));
      return fini(placer(vv.id, caseDe(here), { pat: pat.id, len: pat.steps / 4, name: m.name }), `poser « ${m.name} » en Session`);
    }
    // un instrument, un réglage : une voie neuve ; un effet : dans la chaîne de la voie visée ; un bus : la console
    if (d.t === 'inst') { nouvelleVoie(d.kind, { type: d.type }); return null; }
    if (d.t === 'preset') {
      const pr = app.preset(d.id);
      if (pr) nouvelleVoie(kindOfSource(pr.type), { type: pr.type, params: JSON.parse(JSON.stringify(pr.params || {})), name: pr.name, sub: pr.sub || pr.name });
      return null;
    }
    if (d.t === 'fx') { if (!v) { toast('glisser l\'effet sur une voie'); return null; } return app.addEffect(v.id, d.type); }
    if (d.t === 'bus') return app.addBus(d.fx);
    if (d.t === 'gen') { toast('une piste générative se pose dans l\'arrangement'); return null; }
    return null;
  }

  // ── les gestes sur un clip ──
  function nouveauMidi(v, sid) {
    if (!patKind(v)) return null;
    const p = P(), pat = app.newPattern(v.id, null, { quiet: true, name: 'Nouveau' });
    const s = placer(v.id, sid, { pat: pat.id, len: p.sig, name: 'Nouveau' });
    S.sel.slot = s.id; ui().bas = 'clip'; centrer = true;
    cur.v = v.id; cur.s = sid;
    app.label(`un clip MIDI en Session sur « ${v.name} »`);
    app.commit('data');
    return s;
  }
  async function sonDans(v, sid) {
    const got = await pick({ kinds: ['audio'], multiple: true, title: 'Des sons de la bibliothèque, dans la Session' });
    if (got.length) deposer(got, { v: v.id, s: sid });
  }
  let centrer = false;   // la vue Clip vient de s'ouvrir : le piano roll se centre sur ses notes
  function ouvrir(sid) {
    const s = slotById(sid);
    if (!s) return;
    S.sel.slot = s.id; ui().bas = 'clip'; centrer = true;
    cur.v = s.voie; cur.s = s.scene; S.sel.voie = s.voie;
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
    while (p.scenes[i] && slotAt(p, s.voie, p.scenes[i].id)) i++;
    const sc = p.scenes[i] || insererScene(p, i, app.uid);
    const n = poser(s, s.voie, sc.id);
    if (!n) return;
    cur.v = n.voie; cur.s = sc.id; S.sel.slot = n.id;
    app.label(`dupliquer « ${slotName(s)} »`);
    app.commit('data');
  }
  function coller(vid, sid) {
    if (!presse) { toast('rien à coller : Ctrl+C sur un clip de Session'); return; }
    const n = poser(presse, vid, sid);
    if (!n) return;
    S.sel.slot = n.id;
    app.label(`coller « ${slotName(n)} » en Session`);
    app.commit('data');
  }
  // Un clip de Session gardé dans la bibliothèque du projet (biblio.js) : un son,
  // une référence ; des notes, une copie et l'instrument de la voie
  function garder(s) {
    const p = P(), v = voie(s.voie);
    if (!v) return;
    if (s.ref && refDe(p, s.ref)) { toast('ce clip est déjà dans la bibliothèque du projet (navigateur, Projet)'); return; }
    const ref = { id: app.uid('r'), name: slotName(s).slice(0, 60), len: s.len };
    if (s.color) ref.color = s.color;
    if (v.kind === 'audio') {
      Object.assign(ref, { kind: 'audio', item: s.item, off: s.off || 0 });
      for (const k of ['gain', 'pitch', 'rev', 'loop', 'ls', 'llen', 'fi', 'fo']) if (s[k] !== undefined && s[k] !== null) ref[k] = s[k];
    } else {
      const pat = app.pat(s.pat), m = app.mod(v.src);
      if (!pat) return;
      Object.assign(ref, { kind: 'midi', drums: v.kind === 'drums', steps: pat.steps });
      if (pat.lanes) ref.lanes = JSON.parse(JSON.stringify(pat.lanes)); else ref.notes = JSON.parse(JSON.stringify(pat.notes || []));
      if (m) ref.inst = { type: m.type, params: JSON.parse(JSON.stringify(m.params || {})) };
    }
    p.biblio.clips.push(ref);
    s.ref = ref.id;
    app.label(`garder « ${ref.name} » dans le projet`);
    app.commit('data');
    toast(`« ${ref.name} » est dans la bibliothèque du projet (navigateur, Projet)`);
  }
  // une scène vers l'arrangement, à la tête de lecture (au début de sa mesure)
  function versArrangement(sids) {
    const p = P();
    let at = Math.floor(engine.position() / p.sig + 1e-9) * p.sig;
    const a0 = at;
    let n = 0;
    const neuves = [];
    for (const sid of sids) {
      const r = sceneVersArrangement(p, sid, at, app.uid);
      n += r.made.length;
      neuves.push(...r.neuves);
      at += r.len;
    }
    if (!n) { toast('rien à copier : ces scènes n\'ont pas de clip'); return; }
    app.label(sids.length > 1 ? 'les scènes dans l\'arrangement' : `la scène « ${sceneName(p, scene(sids[0]))} » dans l'arrangement`);
    app.commit(neuves.length ? 'graph' : 'data');
    toast(`${nPluriel(n, 'clip posé', 'clips posés')} dans l'arrangement, de ${app.bar(a0)} à ${app.bar(at)}${neuves.length ? ` · ${nPluriel(neuves.length, 'piste neuve', 'pistes neuves')} : « ${neuves.map((t) => t.name).join(' », « ')} »` : ''}`, 6000);
  }
  function scenesNeuve(i) {
    const sc = insererScene(P(), i, app.uid);
    cur.s = sc.id;
    app.label('insérer une scène'); app.commit('data');
    return sc;
  }
  function capturer() {
    const p = P(), joue = new Map([...engine.sess.joue].map(([vid, J]) => [vid, J.slot]));
    if (!joue.size) { toast('rien à capturer : aucun clip de Session ne joue'); return; }
    const sc = capturerScene(p, joue, cur.s, app.uid);
    cur.s = sc.id;
    app.label('capturer et insérer une scène'); app.commit('data');
  }

  // ── la tête : la quantification, les voies, les scènes, le bas ──
  function paintHead() {
    const p = P(), q = p.launch?.q || '1';
    const bas = ui().bas;
    const sel = slotById(S.sel.slot);
    const vs = voies();
    put(head,
      el('b', { class: 'venus' }, 'Session'),
      el('span', { class: 'lbl ss-sum' }, vs.length ? `${nPluriel(vs.length, 'voie', 'voies')} · ${nPluriel(p.scenes.length, 'scène', 'scènes')} · ${nPluriel((p.slots || []).length, 'clip', 'clips')}` : 'vierge'),
      el('span', { class: 'ss-onto', title: 'la Session joue EN PLUS de l\'arrangement, sur la même horloge : lancer un clip n\'arrête rien dans l\'arrangement' }, 'par-dessus l\'arrangement'),
      el('label', { class: 'ss-q', title: 'la quantification globale du lancement (Live : Global Quantization) : un clip, une scène, un arrêt partent au prochain pas de cette grille, calée sur la tête de lecture' },
        el('span', { class: 'k' }, 'lancement'),
        el('select', { class: 'fld mu-mini', 'aria-label': 'quantification du lancement', onchange: (e) => { p.launch = { q: e.target.value }; app.label(`quantification du lancement : ${QUANTS.find((x) => x[0] === e.target.value)?.[1]}`); app.commit('quiet'); } },
          QUANTS.map(([k, l]) => el('option', { value: k, selected: k === q || null }, l)))),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'une voie de Session, vierge : elle joue en plus de l\'arrangement', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom + 4, voieChoices()); } }, '+ Voie'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'une scène vide sous la scène choisie (Ctrl+I)', onclick: () => scenesNeuve(p.scenes.findIndex((x) => x.id === cur.s) + 1 || p.scenes.length) }, '+ Scène'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'une scène neuve avec une copie des clips qui jouent (Live : Capture and Insert Scene)', onclick: capturer }, 'Capturer'),
      el('span', { class: 'sp' }),
      el('span', { class: 'ss-hint' }, 'Entrée : lancer · flèches : choisir · double-clic : un clip MIDI · Tab : les vues'),
      el('div', { class: 'seg ss-bas', role: 'tablist', 'aria-label': 'le bas de la vue' },
        el('button', { class: `tb${bas === 'mix' ? ' on' : ''}`, type: 'button', title: 'la console sous la grille : voies, pistes, retours, sortie (clic encore : la cacher)',
          onclick: () => { ui().bas = bas === 'mix' ? 'none' : 'mix'; app.saveUi(); render(); } }, 'Console'),
        el('button', { class: `tb${bas === 'clip' ? ' on' : ''}`, type: 'button', disabled: sel ? null : true,
          title: sel ? `la vue Clip de « ${slotName(sel)} » (double-clic sur un clip)` : 'choisis un clip de Session : double-clic dessus',
          onclick: () => { ui().bas = bas === 'clip' ? 'mix' : 'clip'; app.saveUi(); render(); } }, 'Clip')));
  }

  // ── la grille : des rangées aux mêmes colonnes ──
  // voies (--ss-w chacune) | la colonne libre (une voie neuve) | les scènes
  function titleRow(vs) {
    const p = P();
    return el('div', { class: 'ss-r ss-tr' },
      vs.map((v) => {
        const de = v.piste && app.track(v.piste);
        return el('div', { class: `ss-t${S.sel.voie === v.id ? ' sel' : ''}${v.mute ? ' muted' : ''}`, 'data-voie': v.id, style: { '--c': `var(--${v.color})` },
          title: `${v.name}${de ? ` · née de la piste « ${de.name} »` : ''} · clic : la choisir · double-clic : renommer · clic droit : son menu · glisser ici : sa première case libre`,
          onclick: () => choisir(v.id, cur.s) },
        el('b', {}, v.name),
        el('span', { class: 'lbl' }, `${v.arm ? '● ' : ''}${v.sub || moduleName(app.mod(v.src)?.type) || TRACK_KINDS[v.kind].label}${de ? ` · ← ${de.name}` : ''}`));
      }),
      el('div', { class: 'ss-t ss-nv' },
        el('button', { class: 'tb ghost sm', type: 'button', title: 'une voie de Session (ou glisser ici un son, un clip MIDI, un clip du projet)', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom + 4, voieChoices()); } }, '+ Voie')),
      el('div', { class: 'ss-m ss-t master' }, el('b', {}, 'Scènes'), el('span', { class: 'lbl' }, `${p.scenes.length} · lancer une ligne`)));
  }
  function cellOf(v, sc) {
    const p = P(), s = slotAt(p, v.id, sc.id);
    const k = `${v.id}|${sc.id}`;
    const c = el('div', { class: `ss-c${s ? ' full' : ''}${cur.v === v.id && cur.s === sc.id ? ' cur' : ''}`, 'data-v': v.id, 'data-s': sc.id, style: { '--c': `var(--${s?.color || v.color})` } });
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
      if (s.item) poserCalcul(c, etatCalcul({ item: s.item }), s.item);   // son son est en calcul (séparé, transcrit) : calcul.js
    } else {
      const rec = v.arm && patKind(v), audioArm = v.arm && !patKind(v);
      c.append(el('button', { class: `ss-stop${rec ? ' rec' : ''}${audioArm ? ' rec off' : ''}`, type: 'button', tabindex: -1,
        title: rec ? 'prise : un clip neuf, enregistré ici (voie armée)' : audioArm ? 'la prise audio se fait dans l\'arrangement (Rec, F9)' : 'arrêter la voie (Live : Clip Stop) · double-clic : un clip MIDI vide' }));
    }
    return c;
  }
  function sceneRow(sc, vs) {
    const p = P(), ids = (p.slots || []).filter((s) => s.scene === sc.id).map((s) => s.id);
    const b = el('div', { class: `ss-m ss-sc${cur.v === 'M' && cur.s === sc.id ? ' cur' : ''}`, 'data-s': sc.id, title: `scène ${sceneName(p, sc)} · ▶ : lancer la ligne · double-clic : renommer · clic droit : tempo, dupliquer, vers l'arrangement` },
      el('button', { class: 'ss-sgo', type: 'button', 'aria-label': `lancer la scène ${sceneName(p, sc)}`, tabindex: -1 }),
      el('span', { class: `nm${sc.name ? '' : ' num'}` }, sceneName(p, sc)),
      sc.bpm ? el('span', { class: 'bpm' }, `${sc.bpm}`) : null);
    nodes.set(`M|${sc.id}`, b);
    scenesEl.set(sc.id, { node: b, ids, st: '' });
    return el('div', { class: 'ss-r' }, vs.map((v) => cellOf(v, sc)),
      el('div', { class: 'ss-fill ss-new', 'data-s': sc.id, title: 'glisser ici un son, un clip MIDI ou un clip du projet : une voie neuve' }), b);
  }
  function addRow(vs) {
    return el('div', { class: 'ss-r ss-add' },
      vs.map((v) => el('div', { class: 'ss-c ghost', 'data-v': v.id, 'data-s': '+', title: 'glisser ici : une scène neuve' })),
      el('div', { class: 'ss-fill ghost', 'data-s': '+' }),
      el('div', { class: 'ss-m ss-sc add' }, el('button', { class: 'tb ghost sm', type: 'button', title: 'une scène vide, à la fin (Ctrl+I : sous la scène choisie)', onclick: () => scenesNeuve(P().scenes.length) }, '+ Scène')));
  }
  // l'état des voies (Live : Track Status), collé sous la grille
  function statusRow(vs) {
    stopAll = el('button', { class: 'ss-all', type: 'button', title: 'Arrêter tous les clips (Live : Stop All Clips), au prochain pas de la quantification · l\'arrangement continue', onclick: () => arreter(voies().map((v) => v.id)) },
      el('i'), el('span', {}, 'tout arrêter'));
    return el('div', { class: 'ss-r ss-str' },
      vs.map((v) => {
        const txt = el('span', { class: 'tx' }), pie = el('i', { class: 'pie' });
        const n = el('div', { class: 'ss-st', 'data-voie': v.id, style: { '--c': `var(--${v.color})` } },
          el('button', { class: 'ss-tstop', type: 'button', title: `arrêter « ${v.name} » (Live : Clip Stop), au prochain pas de la quantification`, onclick: () => arreter([v.id]) }), pie, txt);
        states.set(v.id, { node: n, txt, st: '' });
        return n;
      }),
      el('div', { class: 'ss-fill void' }), el('div', { class: 'ss-m ss-st master' }, stopAll));
  }
  // La Session vierge : ce qu'elle est, et comment y mettre quelque chose
  function vide() {
    const add = (kind, type, label) => el('button', { class: 'tb ghost sm', type: 'button', onclick: () => nouvelleVoie(kind, { type }) }, label);
    return el('div', { class: 'ss-vide ss-fill', 'data-s': '+', title: 'glisser ici : une voie neuve, et son clip dans la première scène' },
      el('span', { class: 'k' }, 'session vierge'),
      el('b', { class: 'venus' }, 'Des clips en plus'),
      el('p', {}, 'La Session a ses propres voies : elles jouent par-dessus l\'arrangement, sur la même horloge, sans rien en arrêter. Un clip lancé boucle jusqu\'à ce qu\'on l\'arrête.'),
      el('div', { class: 'ss-vz' }, 'glisse un clip ici — un son, un clip MIDI, un clip du projet (le navigateur, le panneau Asset), ou un clip de l\'arrangement sur l\'onglet « Session »'),
      el('div', { class: 'row ss-vb' }, add('audio', 'player', '+ Voie audio'), add('drums', 'rythme', '+ Voie batterie'), add('synth', 'synth', '+ Voie synthé')),
      el('p', { class: 'ss-vh' }, 'dans l\'arrangement : clic droit sur un clip ou sur une plage de temps → Envoyer à la Session'));
  }

  // ── la console : en groupes ──
  // L'ordre d'une console (Live 12, « Mixing » : le mixeur de la vue Session
  // range les retours et le Main à droite) : les voies et les pistes à gauche,
  // puis les retours collés à la Sortie, à droite. Deux blocs (06/10, Cal :
  // « Réverbe et RTT-01 doivent être à côté du fader Sortie, à droite ») :
  // la console entière se centre quand elle tient ; quand elle déborde, les
  // voies et les pistes défilent, et le bloc des retours et de la Sortie reste
  // collé au bord droit de la place (session.css, .ss-cfix) — jamais hors de
  // la vue, jamais séparé de la Sortie.
  function consoleEl() {
    const p = P(), vs = voies(), ts = p.tracks.filter((t) => t.kind !== 'bus'), bs = mixer.buses();
    const grp = (cls, label, sub, strips, extra = null) => el('div', { class: `ss-cg ${cls}` },
      el('div', { class: 'ss-cgh' }, el('b', {}, label), el('span', { class: 'lbl' }, sub), extra),
      el('div', { class: 'ss-cgs' }, strips));
    return el('div', { class: 'ss-cons' },
      el('div', { class: 'ss-cdef' },
        grp('v', 'Session', vs.length ? nPluriel(vs.length, 'voie', 'voies') : 'aucune voie', vs.length ? vs.map((v) => mixer.strip(v, { voie: true }))
          : el('p', { class: 'lbl ss-cvide' }, '+ Voie : ses tranches ici')),
        ts.length ? grp('t', 'Arrangement', nPluriel(ts.length, 'piste', 'pistes'), ts.map((t) => mixer.strip(t))) : null),
      el('div', { class: 'ss-cfix' },
        grp('b', 'Retours', bs.length ? nPluriel(bs.length, 'bus', 'bus') : 'aucun', bs.map((t) => mixer.strip(t, { bus: true })),
          el('button', { class: 'tb ghost sm', type: 'button', title: 'un bus d\'effets : les pistes et les voies y envoient', onclick: mixer.busMenu }, '+ Bus')),
        grp('m', 'Sortie', 'master', [mixer.masterStrip()])));
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
      color: [{ label: 'Celle de la voie', checked: !s.color, onclick: () => { s.color = undefined; app.commit('data'); } },
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
    const s = slotById(S.sel.slot), v = s && voie(s.voie);
    ed = null;
    if (ui().bas !== 'clip' || !s || !v) { clipBox.hidden = true; put(clipBox); if (ui().bas === 'clip' && !s) ui().bas = 'mix'; return; }
    clipBox.hidden = false;
    const p = P(), m = slotMenuItems(s);
    const sub = (label, items) => el('button', { class: 'tb ghost sm', type: 'button', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom + 4, items); } }, label);
    const nm = el('b', { class: 'venus', title: 'double-clic : renommer', ondblclick: () => inlineEdit(nm, slotName(s), (x) => { s.name = x.slice(0, 60); app.commit('data'); }, { max: 60 }) }, slotName(s));
    const host = el('div', { class: 'ss-cbody' });
    put(clipBox,
      el('div', { class: 'ss-chead', style: { '--c': `var(--${s.color || v.color})` } },
        el('i', { class: 'dot' }), nm, el('span', { class: 'lbl' }, `${v.name} · scène ${sceneName(p, scene(s.scene))} · boucle de ${barsTxt(s.len)} mes.`),
        el('span', { class: 'sp' }),
        sub(`Longueur · ${barsTxt(s.len)} mes.`, m.len),
        sub(`Lancement · ${MODES.find((x) => x[0] === (s.mode || 'trigger'))[1]}`, m.modes),
        sub(`Quantification · ${s.q && s.q !== 'global' ? QUANTS.find((x) => x[0] === s.q)?.[1] : 'globale'}`, m.quant),
        sub('Couleur', m.color),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'ce clip dans l\'arrangement, à la tête de lecture (autant de tours que sa scène)', onclick: () => versArrangement([s.scene]) }, 'Vers l\'arrangement'),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { ui().bas = 'mix'; app.saveUi(); render(); } }, 'Fermer')),
      host);
    // l'éditeur compact : il tient dans la boîte, cadré sur ses notes (editeurs.js)
    ed = v.kind === 'audio' ? audioPanel(host, s) : patternEditor(app, host, v, s, { taille: 'compact' });
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
    stopAll = null;
    if (!scene(cur.s)) cur.s = p.scenes[0]?.id || null;
    if (!cur.v || (cur.v !== 'M' && !voie(cur.v))) cur.v = voie(S.sel.voie) ? S.sel.voie : voies()[0]?.id || 'M';
    if (S.sel.voie && !voie(S.sel.voie)) S.sel.voie = null;
    if (S.sel.slot && !slotById(S.sel.slot)) S.sel.slot = null;
    if (ui().bas === 'clip' && !S.sel.slot) ui().bas = 'mix';
    suivreMotif(ui().bas === 'clip' ? slotById(S.sel.slot) : null);
    const vs = voies();
    // le navigateur : commun aux deux vues, sa largeur et son repli aussi (Ctrl+Alt+B)
    body.style.setProperty('--nav-w', `${navW()}px`);
    body.classList.toggle('nav-off', pui().nav === false);
    browser.render();
    const sx = grid.scrollLeft, sy = grid.scrollTop;
    paintHead();
    put(grid, vs.length ? el('div', { class: 'ss-board', style: { '--n': vs.length } },
      titleRow(vs), p.scenes.map((sc) => sceneRow(sc, vs)), addRow(vs), statusRow(vs)) : vide());
    put(bot, ui().bas === 'mix' ? consoleEl() : null);
    bot.hidden = ui().bas !== 'mix';
    botSplit.hidden = ui().bas === 'none';
    main.style.setProperty('--ss-bh', `${botH()}px`);
    paintClip();
    grid.scrollLeft = sx; grid.scrollTop = sy;
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
    for (const ev of E.file) att.set(ev.voie, ev);
    const etat = new Map();   // clip → 'on' | 'wait' | 'rec' (+ ' end' : un arrêt attend)
    for (const [vid, J] of E.joue) {
      const ev = att.get(vid);
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
    // l'état des voies : le clip qui boucle (son camembert, ses tours), l'arrêt attendu
    for (const [vid, x] of states) {
      const J = E.joue.get(vid), ev = att.get(vid);
      let st = '', txt = '';
      const s = J && slotById(J.slot);
      if (s && now !== null && now >= J.depuis) {
        const d = now - J.origin;
        st = J.rec ? 'rec' : 'on';
        txt = J.rec ? `prise ${Math.floor(d / P().sig) + 1}` : `×${Math.floor(d / s.len) + 1}`;
        if (!J.rec) x.node.style.setProperty('--pr', (((d % s.len) + s.len) % s.len / s.len).toFixed(4));
      }
      if (ev && !ev.slot) st += ' end';
      if (st !== x.st || x.node.dataset.tx !== txt) {
        x.node.classList.remove('on', 'rec', 'end');
        if (st.trim()) x.node.classList.add(...st.split(' ').filter(Boolean));
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
    stopAll?.classList.toggle('lit', E.joue.size > 0);
    // la prise : sa place, et sa fin quand la voie ne l'écoute plus (Stop, la lecture arrêtée)
    if (prise) {
      const J = E.joue.get(prise.vid);
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
    if (e.target.closest('.ss-go') && c?.dataset.slot) { e.preventDefault(); choisir(c.dataset.v, c.dataset.s); appuyer(c.dataset.slot); return; }
    if (e.target.closest('.ss-sgo') && sc) { e.preventDefault(); choisir('M', sc.dataset.s); lancerScene(sc.dataset.s); return; }
    if (e.target.closest('.ss-stop') && c && !c.classList.contains('ghost')) {
      e.preventDefault();
      const v = voie(c.dataset.v);
      choisir(c.dataset.v, c.dataset.s);
      if (v?.arm && patKind(v)) prendre(v, c.dataset.s);
      else if (!v?.arm) arreter([c.dataset.v]);
      else toast('la prise audio se fait dans l\'arrangement (Rec, F9)');
      return;
    }
    if (c && c.dataset.v && !c.classList.contains('ghost')) choisir(c.dataset.v, c.dataset.s);
    else if (sc && sc.dataset.s) choisir('M', sc.dataset.s);
  });
  grid.addEventListener('dblclick', (e) => {
    const c = e.target.closest('.ss-c'), sc = e.target.closest('.ss-sc');
    if (e.target.closest('.ss-go, .ss-sgo, .mu-inline, .tb')) return;
    if (c?.dataset.slot) { ouvrir(c.dataset.slot); return; }
    if (c?.dataset.v && !c.classList.contains('ghost')) {
      const v = voie(c.dataset.v);
      if (patKind(v)) nouveauMidi(v, c.dataset.s); else if (v?.kind === 'audio') sonDans(v, c.dataset.s);
      return;
    }
    if (sc?.dataset.s) { const s = scene(sc.dataset.s), n = sc.querySelector('.nm'); if (s && n) inlineEdit(n, s.name, (v) => { s.name = v.slice(0, 40); app.label('renommer la scène'); app.commit('data'); }, { max: 40 }); return; }
    const th = e.target.closest('.ss-t[data-voie]');
    if (th) renommerVoie(voie(th.dataset.voie), th.querySelector('b'));
  });
  clipBox.addEventListener('pointerdown', () => { zone = 'clip'; });
  bot.addEventListener('pointerdown', () => { zone = 'grid'; });

  // ── glisser, déposer ──
  // Le panneau Asset et les fichiers du disque : dropZone (commun/shell.js) — l'import dans la
  // bibliothèque, la dernière version d'un élément, le rapatriement d'un autre Workspace ; la case
  // visée est celle que le glisser survolait. Le navigateur d'ODIO et les clips de Session : ici.
  let survol = null, depot = null;
  const caseSous = (e) => {
    const c = e.target.closest?.('.ss-c, .ss-fill, .ss-t[data-voie], .ss-nv');
    if (!c || c.classList.contains('void')) return null;
    // l'en-tête d'une voie : sa première case libre (une scène neuve s'il n'y en a pas)
    if (c.dataset.voie) return { node: c, v: c.dataset.voie, s: P().scenes.find((sc) => !slotAt(P(), c.dataset.voie, sc.id))?.id || '+' };
    return { node: c, v: c.dataset.v || null, s: c.dataset.s || null };
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
    depot = h ? { v: h.v, s: h.s } : null;
    const ty = [...(e.dataTransfer?.types || [])];
    if (ty.includes('Files') || ty.includes(ITEM_MIME) || !h) return;   // dropZone s'en charge
    e.preventDefault();
    const id = e.dataTransfer.getData(SLOT_MIME);
    if (id) {
      const s = slotById(id);
      if (!s) return;
      if (!depot.v) { toast('un clip de Session va dans une case de voie'); return; }
      const sid = caseDe(depot), vid = depot.v;
      const n = poser(s, vid, sid, { move: !(e.ctrlKey || e.altKey) });
      if (!n) return;
      choisir(n.voie, n.scene, { peindre: false });
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
    const p = P(), cols = [...voies().map((v) => v.id), 'M'];
    let i = cols.indexOf(cur.v), j = p.scenes.findIndex((x) => x.id === cur.s);
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
    const s = cur.v && cur.v !== 'M' ? slotAt(p, cur.v, cur.s) : null;
    const sc = scene(cur.s);
    if (k === 'Enter') {
      e.preventDefault();
      if (e.repeat) return true;
      if (cur.v === 'M') { if (sc) lancerScene(sc.id); return true; }
      const v = voie(cur.v);
      if (s) appuyer(s.id, { clavier: true });
      else if (v?.arm && patKind(v) && sc) prendre(v, sc.id);
      else if (v) arreter([v.id]);
      return true;
    }
    if ((k === 'Delete' || k === 'Backspace') && !ctrl) {
      if (s) { retirer(s); return true; }
      if (cur.v === 'M' && sc) { retirerScene(p, sc.id); app.label('retirer la scène'); app.commit('data'); return true; }
      return false;
    }
    if (!ctrl || e.altKey) return false;
    const L = letter(e);
    if (L === 'd') { e.preventDefault(); if (s) dupliquer(s); else if (cur.v === 'M' && sc) { const n = dupliquerScene(p, sc.id, app.uid); cur.s = n.id; app.label('dupliquer la scène'); app.commit('data'); } return true; }
    if (L === 'r') { e.preventDefault(); if (s) renommer(s); else if (sc) { const n = nodes.get(`M|${sc.id}`)?.querySelector('.nm'); if (n) inlineEdit(n, sc.name, (v) => { sc.name = v.slice(0, 40); app.commit('data'); }, { max: 40 }); } return true; }
    if (L === 'c' && s) { presse = JSON.parse(JSON.stringify(s)); toast(`« ${slotName(s)} » copié`); return true; }
    if (L === 'x' && s) { presse = JSON.parse(JSON.stringify(s)); retirer(s); return true; }
    if (L === 'v' && cur.v !== 'M' && sc) { coller(cur.v, sc.id); return true; }
    if (L === 'i') { e.preventDefault(); if (e.shiftKey) capturer(); else scenesNeuve(p.scenes.findIndex((x) => x.id === cur.s) + 1 || p.scenes.length); return true; }
    return false;
  }

  // ── le clic droit : le menu de ce qu'on survole ──
  function voieMenu(v, n = null) {
    const de = v.piste && app.track(v.piste);
    return [
      { head: `voie · ${v.name}` },
      { label: 'Arrêter la voie', sub: 'au prochain pas', onclick: () => arreter([v.id]) },
      { label: 'Renommer', sub: 'double-clic', disabled: !n, why: 'double-clic sur son en-tête', onclick: () => renommerVoie(v, n) },
      { label: 'Couleur', items: COLORS.map((c) => ({ label: COLOR_FR[c], dot: c, checked: v.color === c, onclick: () => { v.color = c; app.label(`colorer la voie en ${COLOR_FR[c]}`); app.commit('data'); } })) },
      { label: v.arm ? 'Désarmer' : 'Armer', sub: 'la prise de Session', onclick: () => { v.arm = !v.arm; app.commit('quiet'); render(); } },
      { label: v.mute ? 'Rendre le son' : 'Muet', onclick: () => { v.mute = !v.mute; app.commit('mute'); render(); } },
      { label: v.solo ? 'Fin du solo' : 'Solo', sub: 'commun aux pistes et aux voies', onclick: () => { v.solo = !v.solo; app.commit('mute'); render(); } },
      { label: 'Un effet dans sa chaîne', items: EFFECT_TYPES.map((k) => ({ label: MODULES[k].name, sub: MODULES[k].odio ? `ODIO · ${MODULES[k].kind}` : MODULES[k].kind, dot: MODULES[k].color, onclick: () => app.addEffect(v.id, k) })) },
      { label: 'Sa chaîne dans le nodal', onclick: () => { S.sel.mod = v.src; app.setView('nodal'); } },
      de ? { head: `née de la piste « ${de.name} »` } : null,
      '-',
      { label: 'Retirer la voie', sub: 'et ses clips', danger: true, onclick: () => retirerVoie(v) },
    ];
  }
  function zoneMenu(e) {
    const p = P();
    const c = e.target.closest?.('.ss-c'), scn = e.target.closest?.('.ss-sc'), th = e.target.closest?.('.ss-t[data-voie], .ss-st[data-voie]');
    if (c?.dataset.slot) {
      const s = slotById(c.dataset.slot);
      if (!s) return null;
      const m = slotMenuItems(s);
      choisir(c.dataset.v, c.dataset.s);
      const gardee = s.ref && refDe(p, s.ref);
      return [
        { head: `${slotName(s)} · ${barsTxt(s.len)} mes.` },
        { label: 'Lancer', key: 'Entrée', onclick: () => appuyer(s.id) },
        { label: 'Arrêter la voie', onclick: () => arreter([s.voie]) },
        { label: 'Ouvrir dans la vue Clip', sub: 'double-clic', onclick: () => ouvrir(s.id) },
        '-',
        { label: 'Renommer', key: 'Ctrl+R', onclick: () => renommer(s) },
        { label: 'Dupliquer', key: 'Ctrl+D', onclick: () => dupliquer(s) },
        { label: 'Copier', key: 'Ctrl+C', onclick: () => { presse = JSON.parse(JSON.stringify(s)); } },
        { label: 'Coller ici', key: 'Ctrl+V', disabled: !presse, why: 'rien à coller : Ctrl+C sur un clip de Session', onclick: () => coller(s.voie, s.scene) },
        { label: 'Mode de lancement', items: m.modes },
        { label: 'Quantification', items: m.quant },
        { label: 'Longueur', items: m.len },
        { label: 'Couleur', items: m.color },
        { label: 'Garder dans le projet', sub: 'navigateur, Projet', disabled: !!gardee, why: 'il y est déjà (navigateur, Projet)', onclick: () => garder(s) },
        { label: 'Vers l\'arrangement', sub: 'la scène entière, à la tête de lecture', onclick: () => versArrangement([s.scene]) },
        '-',
        { label: 'Retirer', key: 'Suppr', danger: true, onclick: () => retirer(s) },
      ];
    }
    if (c?.dataset.v && !c.classList.contains('void')) {
      const v = voie(c.dataset.v), sid = c.dataset.s === '+' ? null : c.dataset.s;
      if (!v) return null;
      if (sid) choisir(v.id, sid);
      return [
        { head: `${v.name} · scène ${sid ? sceneName(p, scene(sid)) : 'neuve'}` },
        patKind(v) ? { label: 'Un clip MIDI vide', sub: 'double-clic', onclick: () => nouveauMidi(v, sid || caseDe({ s: '+' })) } : null,
        v.kind === 'audio' ? { label: 'Un son de la bibliothèque', sub: 'double-clic', onclick: () => sonDans(v, sid || caseDe({ s: '+' })) } : null,
        v.arm && patKind(v) ? { label: 'Prendre ici', sub: 'la voie est armée', onclick: () => prendre(v, sid || caseDe({ s: '+' })) } : null,
        { label: 'Coller ici', key: 'Ctrl+V', disabled: !presse, why: 'rien à coller : Ctrl+C sur un clip de Session', onclick: () => coller(v.id, sid || caseDe({ s: '+' })) },
        '-',
        ...voieMenu(v),
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
    if (th?.dataset.voie) {
      const v = voie(th.dataset.voie);
      return v ? voieMenu(v, th.querySelector('b')) : null;
    }
    if (e.target.closest?.('.ss-fill, .ss-nv, .ss-vide')) return [{ head: 'la Session' }, ...voieChoices().slice(1)];
    if (browser.el.contains(e.target)) return [{ head: 'le navigateur' }, { label: pui().nav === false ? 'Déplier le navigateur' : 'Replier le navigateur', key: 'Ctrl+Alt+B', onclick: () => { pui().nav = pui().nav === false; app.saveUi(); render(); } }];
    return null;
  }

  // la prise lit le clavier de l'ordinateur et le MIDI (musique.js les lui passe) ;
  // le panneau Asset (panneau.js) pose par un clic dans la case choisie, comme le
  // navigateur — sans case de voie choisie (la colonne des scènes, la Session
  // vierge), une voie neuve ; `neuve` : une voie neuve dans la scène choisie
  app.session = { noteOn, noteOff,
    poser: (items, { neuve = false } = {}) => deposer(items, neuve ? { v: null, s: cur.s } : ici()) };
  return { el: root, render, frame, key, zoneMenu, paintSel, lancerScene, appuyer, arreter, finirPrise, get prise() { return prise; } };
}
