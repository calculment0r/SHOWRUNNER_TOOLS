// ODIO — la génération par région : la piste générative, sa région, ses
// versions (les prises), et ce qui revient des travaux.
//
// Une piste générative est une piste audio (`kind: 'audio'`) qui porte
// `gen: { model, task }` : elle joue, se mixe, s'exporte et se sépare comme
// les autres ; ce qui change est qu'on y DESSINE une région (tirer sur le
// vide de sa voie). La région est un clip audio qui porte `gen` :
//   gen.quoi                la réponse à « Que veux-tu générer ? » (06/10) :
//                           chanson, instrument, variation, suite
//   gen.voie                la voie qui la fait (schéma, intentions) ; elle dit
//   gen.model, gen.task     le modèle et la tâche — ACE-Step 1.5 ou YuE2
//   gen.v                   les réglages de la tâche (generatif_modeles.json) ;
//                           le clip d'inspiration (style_audio), le clip à
//                           varier (src_audio, ref), la partition (abc) y sont
//   gen.libre               ce qui change du projet pour cette génération
//                           ({ bpm, tonic, mode, sig }) ; le reste vient du projet
//   gen.instrument          un instrument seul : sa piste (ACE-Step) ou « other »
//   gen.apres               « stems » : la version choisie, séparée ensuite
//   gen.ctx                 les pistes de « ce qui joue autour » (null : toutes)
//   gen.takes, gen.take     les versions reçues, celle qui joue dans le segment
//                           (le clip porte alors son `item` et son `off`)
// Comme les « take lanes » de Live et les « take folders » de Logic, la
// région garde toutes ses versions ; on change d'un geste celle qui joue ;
// « Garder celle-ci » retire `gen` : un clip audio ordinaire.
//
// Le panneau qui la règle est « Générer » (generatif_panneau.js) ; la vue du
// bas d'une région n'en montre que les versions et y mène.
//
// Les travaux : `music.gen.ace`, `music.gen.yue` (les versions), `music.yue.abc`
// (la partition seule), `music.stems` (le stem gardé d'une version « chanson
// puis stem »), `music.midi` (generatif_midi.js). Leur retour passe par
// genJobDone, appelé par la file de musique.js (P.pending).

import { api, toast, href, uploadFile, ITEM_MIME } from '../commun/shell.js';
import { renderMix, wav24 } from './moteur.js';
import { noterOrigine } from './projet.js';
import { el, put, tok } from './ui.js';
import { loadSchema, schemaNow, model, task, firstTask, trackFr } from './generatif_modeles.js';
import { writeAbc, sectionsOf, reportVoices, skyline, chordsFromNotes, abcKey } from './generatif_abc.js';
import { midiDone, clipNotes } from './generatif_midi.js';
import { ouvrirGenerer, cibleOuverte, versionsBox, repeindre } from './generatif_panneau.js';
import { options } from './generatif.js';

// les styles du génératif, à part de musique.css
{
  const u = new URL('./generatif.css', import.meta.url).href;
  if (!document.querySelector(`link[data-gen-css]`)) document.head.append(el('link', { rel: 'stylesheet', href: u, 'data-gen-css': '' }));
}
loadSchema();

export const GEN_KINDS = new Set(['takes', 'abc', 'midi', 'garder']);
export const isGenTrack = (t) => !!t?.gen && t.kind === 'audio';
export const isRegion = (c) => !!c?.gen;
// la cible du panneau « Générer » ouvert : une région, ou le brouillon d'une
// plage encore vide (un objet qui a la forme d'une région, sans id)
export const genTarget = (app) => cibleOuverte(app);
// le jugement d'abc_tools sur la partition d'une cible, gardé hors du projet
// (le rapport peut être long) et valable tant que le texte ne change pas
const checks = new Map();
const cle = (c) => c.id || 'brouillon';
export const lastCheck = (c) => { const x = checks.get(cle(c)); return x && x.abc === (c.gen?.v?.abc || '') ? x.r : undefined; };
export const setCheck = (c, r) => checks.set(cle(c), { abc: c.gen?.v?.abc || '', r });

// Ce que la génération prend du projet, et ce que la personne en a changé
// (gen.libre) : le tempo, la tonalité, la mesure (Cal, 06/10 : « la tonalité,
// qu'on peut modifier, mais par défaut il prend la nôtre »).
export function effectif(P, g) {
  const L = g?.libre || {};
  return { bpm: L.bpm ?? P.bpm, sig: L.sig ?? P.sig, key: { tonic: L.tonic ?? P.key.tonic, mode: L.mode ?? P.key.mode } };
}

// L'empreinte des entrées d'une version (le canon d'ODIO_01, etude-hub § 2.9 :
// « une branche périmée le sait ») : le modèle, la tâche, les réglages, le
// tempo, la mesure, la tonalité (ceux qu'elle a pris), les bornes de la région.
// Une version dont l'empreinte n'est plus celle de la région reste jouable, et le dit.
export function fingerprint(app, c) {
  const P = app.S.proj, g = c.gen, v = { ...g.v }, E = effectif(P, g);
  delete v.n; delete v.seed;                                  // une version de plus ou une autre graine ne la périme pas
  const ctxTask = task(schemaNow(), g.model, g.task)?.sortie === 'contexte';      // le contexte dépend aussi de la place de la région
  const s = JSON.stringify([g.model, g.task, v, g.ctx || null, E.bpm, E.sig, E.key, g.instrument || null, c.len, ctxTask ? c.start : null]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
export const stale = (app, c, tk) => tk.fp && tk.fp !== fingerprint(app, c);

// l'état des moteurs (music_gen.py : factice, réel, câblé ou non)
let eng = null, engT = 0;
export async function engines() {
  if (!eng || Date.now() - engT > 30000) {
    try { eng = await api('music/gen/engines'); engT = Date.now(); } catch (e) { eng = { error: e.message, engines: {} }; }
  }
  return eng;
}
export const engNow = () => eng;
engines();

// La réponse d'une région d'avant le 06/10 (sans `quoi`) : lue dans sa tâche
export function quoiDe(g) {
  if (g?.quoi) return g.quoi;
  return { lego: 'instrument', complete: 'instrument', extract: 'instrument', cover: 'variation', reprise: 'variation', repaint: 'suite' }[g?.task] || 'chanson';
}

// ── la piste générative ─────────────────────────────────────
export function genTrackChoices(app) {
  return [{ head: 'générative : une plage, le panneau Générer la remplit' },
    { label: 'Générer…', sub: 'chanson, un instrument seul, une variation, la suite', dot: 'coral-1', onclick: () => ouvrirGenerer(app) },
    { label: 'Piste générative', sub: 'tirer sur sa voie dessine une région', dot: 'coral-3', onclick: () => addGenTrack(app, 'ace') }];
}
export async function addGenTrack(app, mid, { at, name } = {}) {
  const s = await loadSchema(), P = app.S.proj;
  const n = P.tracks.filter(isGenTrack).length + 1;
  const tid = mid === 'ace' ? 'lego' : firstTask(s, mid);
  const t = app.addTrack('audio', { name: name || `Génératif ${n}`, color: mid === 'ace' ? 'coral-1' : 'coral-3', sub: `générative · ${model(s, mid).nom}`, at });
  t.gen = { model: mid, task: tid };
  app.commit('graph');
  if (!name) toast('piste générative : tirer sur sa voie dessine une région · le panneau Générer la règle', 5000);
  return t;
}

// une région neuve, dessinée sur la voie : le panneau Générer s'ouvre dessus
export async function newRegion(app, t, a, b) {
  await loadSchema();
  const P = app.S.proj, base = P.gen?.brouillon;
  const c = { id: app.uid('c'), track: t.id, start: a, len: b - a, off: 0, gen: null };
  c.gen = { quoi: base?.quoi || quoiDe(t.gen), model: t.gen.model, task: t.gen.task, v: {}, takes: [], take: null, ctx: null };
  P.clips.push(c);
  app.selectClips([c.id], true);
  app.commit('data');
  ouvrirGenerer(app, { region: c.id });
  return c;
}

// ── ce qui vient du projet ──────────────────────────────────
// les mesures de la région, à la mesure et au tempo qu'elle prend
export function regionBars(P, c) {
  const E = effectif(P, c.gen), secsR = c.len * 60 / P.bpm;
  return Math.max(1, Math.ceil(secsR * E.bpm / 60 / E.sig - 1e-9));
}
// les sections du projet que la région couvre (P.sections : une seule vérité,
// la rangée de structure au-dessus de l'arc)
export function covered(P, c) {
  const a = c.start, b = c.start + c.len, out = [];
  for (const s of [...P.sections].sort((x, y) => x.a - y.a)) {
    const lo = Math.max(a, s.a), hi = Math.min(b, s.b);
    if (hi > lo) out.push({ s, bars: Math.max(1, Math.round((hi - lo) / P.sig)) });
  }
  return out;
}
export function sectionsFor(P, c) {
  const cov = covered(P, c).map((x) => [x.s.tag || 'verse', x.bars]);
  const need = regionBars(P, c), have = cov.reduce((k, x) => k + x[1], 0);
  if (!cov.length) return [['verse', need]];
  if (have < need) cov[cov.length - 1][1] += need - have;
  return cov;
}
// ce qui joue autour : les pistes (hors bus, hors la piste de la région) dont un clip non muet touche la fenêtre
export function around(app, c, w0, w1) {
  const P = app.S.proj;
  return P.tracks.filter((t) => t.kind !== 'bus' && t.id !== c.track && !t.mute
    && P.clips.some((x) => x.track === t.id && x.id !== c.id && !x.mute && x.start < w1 && x.start + x.len > w0 && (x.item || x.pat)));
}
export function windowOf(P, c, marge) {
  const m = (marge ?? 2) * P.sig;
  return [Math.max(0, c.start - m), c.start + c.len + m];
}

// Le contexte : les pistes choisies, rendues hors temps réel sur la fenêtre
// (le même graphe que l'export), rangées dans la bibliothèque, envoyées
// comme src_audio ; le modèle rend cette durée exacte (inference.py:606-610).
export async function renderContext(app, c, w0, w1, ids) {
  const P = app.S.proj, sel = new Set(ids);
  const sub = { ...P, clips: P.clips.filter((x) => sel.has(x.track) && !x.mute) };
  toast('rendu de ce qui joue autour…', 20000);
  const buf = await renderMix(app.engine, sub, w0, w1, { tail: 0 });
  const it = await uploadFile(new File([wav24(buf)], 'contexte.wav', { type: 'audio/wav' }),
    { tool: 'music', folder: 'Musique', title: `Contexte · ${c.name || 'région'} · ${app.bar(w0)} → ${app.bar(w1)}` });
  app.items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
  return it.id;
}

// Le retour d'un travail (musique.js, watchPending) : les versions dans leur
// région, la partition dans son éditeur, le stem gardé à la place de sa
// chanson, le MIDI sous son clip.
export async function genJobDone(app, pd, full) {
  const P = app.S.proj;
  if (pd.kind === 'midi') { await midiDone(app, pd, full); return; }
  const c = app.clip(pd.clip);
  if (!c?.gen) {
    // une partition écrite pour le brouillon (une plage encore vide) : elle y entre
    if (pd.kind === 'abc' && !pd.clip && P.gen?.brouillon) {
      P.gen.brouillon.v = { ...(P.gen.brouillon.v || {}), abc: full.result?.abc || '' };
      toastPartition(full);
      app.commit('data'); repeindre();
      return;
    }
    toast(`la région a disparu : ${pd.kind === 'abc' ? 'la partition est perdue' : 'ses versions sont dans la bibliothèque (Musique)'}`, 6000);
    return;
  }
  if (pd.kind === 'abc') {
    c.gen.v = { ...c.gen.v, abc: full.result?.abc || '' };
    if (full.result?.check) setCheck(c, full.result.check);
    toastPartition(full);
    app.commit('data'); repeindre();
    return;
  }
  if (pd.kind === 'garder') { gardeFaite(app, c, pd, full); return; }
  const its = full.items || [];
  const fp = pd.fp || fingerprint(app, c);
  const made = [];
  for (const it of its) {
    app.items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
    noterOrigine(P, it.id, 'generation');
    const tk = { item: it.id, job: pd.job, seed: it.params?.seed, k: c.gen.takes.length, engine: it.params?.engine, off: it.params?.region_off || 0, fp,
      model: it.params?.model, task: it.params?.task, score: it.params?.score ? it.params.score.slice(0, 60000) : undefined };
    c.gen.takes.push(tk);
    made.push(tk);
  }
  if (c.gen.take == null && c.gen.takes.length) chooseTake(app, c, c.gen.takes.length - its.length, true);
  // « chanson puis stem » : chaque version est séparée, seul le stem voulu reste
  if (pd.garder) for (const tk of made) await lancerGarde(app, c, tk, pd.garder);
  toast(`${its.length} version${its.length > 1 ? 's' : ''} dans « ${c.name || 'la région'} » · la première joue dans le segment${pd.garder ? ` · on en garde ${pd.garderFr || pd.garder}` : ''}`, 5000);
  app.commit('data');
  if (pd.apres === 'stems' && c.gen.take != null && !pd.garder) app.stems(c.id);
  repeindre();
}
function toastPartition(full) {
  const fixes = full.result?.normalise || [];        // ce que le serveur a mis au dialecte (une fin coupée…)
  toast(`partition écrite${full.result?.engine === 'factice' ? ' (moteur d\'essai)' : ''} : relis-la, modifie-la, puis Générer${fixes.length ? ` · ${fixes.join(' · ')}` : ''}`, fixes.length ? 9000 : 5000);
}

// La voie de repli d'« un instrument seul » (étude § 8.3) : la chanson rendue
// est séparée (music.stems, le meilleur séparateur prêt qui rend ce stem) ;
// seul le stem voulu reste dans la version, la chanson en parent.
async function lancerGarde(app, c, tk, stem) {
  const s = await options('music/stems/options', 'music.stems');
  if (!s.ok) { toast(`séparation indisponible : ${s.why} — la version garde la chanson entière`, 7000); return; }
  const list = (s.o.models || []).filter((m) => m.ready !== false && (m.stems || []).includes(stem));
  const m = list.find((x) => x.id === s.o.recommended) || list[0];
  if (!m) { toast(`aucun séparateur prêt ne rend « ${stem} » — la version garde la chanson entière`, 7000); return; }
  try {
    const j = await api('music/stems/separate', { method: 'POST', body: { src: tk.item, model: m.id, stems: [stem], project: app.S.proj.id } });
    app.S.proj.pending.push({ job: j.id, kind: 'garder', clip: c.id, take: tk.item, stem, title: j.title });
    tk.attente = stem;
  } catch (e) { toast(e.message, 6000); }
}
function gardeFaite(app, c, pd, full) {
  const P = app.S.proj, i = c.gen.takes.findIndex((x) => x.item === pd.take);
  const id = full.result?.stems?.[pd.stem] || (full.items || [])[0]?.id;
  if (i < 0 || !id) { toast('le stem est rangé dans la bibliothèque (Musique), sa version a disparu', 6000); return; }
  for (const it of full.items || []) app.items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
  const tk = c.gen.takes[i];
  tk.chanson = tk.item; tk.item = id; tk.stem = pd.stem;
  delete tk.attente;
  noterOrigine(P, id, 'generation');
  if (c.gen.take === i) chooseTake(app, c, i, true);
  toast(`version ${i + 1} : ${pd.stem} gardé, la chanson entière reste dans la bibliothèque`, 4000);
  app.commit('data'); repeindre();
}

export function chooseTake(app, c, i, quiet = false) {
  const tk = c.gen.takes[i];
  if (!tk) return;
  if (c.gen.take != null && c.gen.take !== i) c.gen.ab = c.gen.take;      // la précédente : l'autre moitié d'un A/B
  c.gen.take = i;
  c.item = tk.item;
  c.off = tk.off || 0;
  app.engine.buffer(tk.item).catch(() => {});
  if (!quiet) { app.commit('data'); repeindre(); }
}
export function keepTake(app, c) {
  if (!c?.gen || c.gen.take == null) { toast('choisis d\'abord une version'); return; }
  const n = c.gen.takes.length;
  delete c.gen;
  toast(`version gardée : un clip audio ordinaire${n > 1 ? ` (les ${n - 1} autres restent dans la bibliothèque, Musique)` : ''}`, 5000);
  app.commit('data'); repeindre();
}
// jeter une version : elle quitte la région, son son reste dans la bibliothèque
export function dropTake(app, c, i) {
  const g = c.gen;
  g.takes.splice(i, 1); g.takes.forEach((x, k) => { x.k = k; });
  if (g.ab === i) delete g.ab; else if (g.ab > i) g.ab--;
  if (g.take === i) { g.take = null; delete c.item; c.off = 0; if (g.takes.length) chooseTake(app, c, 0, true); } else if (g.take > i) g.take--;
  app.commit('data'); repeindre();
}
// les versions en pistes (les « take lanes » de Live, à plat) : une piste audio
// par version, sous la piste générative, muettes sauf celle qui joue
export function takesToTracks(app, c) {
  const P = app.S.proj, t = app.track(c.track);
  let at = P.tracks.indexOf(t) + 1;
  c.gen.takes.forEach((tk, i) => {
    if (i === c.gen.take) return;
    const nt = app.addTrack('audio', { name: `Version ${i + 1} · ${c.name || t.name}`.slice(0, 60), color: t.color, at: at++ });
    nt.mute = true;
    P.clips.push({ id: app.uid('c'), track: nt.id, start: c.start, len: c.len, item: tk.item, off: tk.off || 0 });
  });
  toast('une piste par version, muettes : S ou M pour comparer', 5000);
  app.commit('graph');
}

// ── le clic droit sur une région ────────────────────────────
export function regionMenuItems(app, c) {
  const g = c.gen, n = g.takes.length;
  return [
    { head: `région · ${schemaNow() ? model(schemaNow(), g.model).court : g.model} · ${n} version${n > 1 ? 's' : ''}` },
    { label: 'Générer…', sub: 'le panneau Générer', onclick: () => ouvrirGenerer(app, { region: c.id }) },
    ...g.takes.map((tk, i) => ({ label: `Version ${i + 1}${g.take === i ? ' · dans le segment' : ''}`, sub: `graine ${tk.seed ?? '?'}${tk.engine === 'factice' ? ' · essai' : ''}`, onclick: () => chooseTake(app, c, i) })),
    n > 1 ? { label: 'Version suivante', onclick: () => chooseTake(app, c, ((g.take ?? -1) + 1) % n) } : null,
    { label: 'Garder celle-ci', sub: 'un clip audio ordinaire', disabled: g.take == null, why: 'aucune version encore', onclick: () => keepTake(app, c) },
    { label: 'Les versions en pistes', sub: 'une piste par version', disabled: n < 2, why: 'il faut deux versions', onclick: () => takesToTracks(app, c) },
    '-',
  ].filter(Boolean);
}

// ── le dessin d'une région sans version, dans l'arrangement ─
export function drawRegion(g, w, h, c, app) {
  const s = schemaNow(), P = app.S.proj;
  g.fillStyle = tok('line');
  for (let x = -h; x < w; x += 9) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.lineTo(x + h + 1.2, 0); g.lineTo(x + 1.2, h); g.fill(); }
  const busy = (P.pending || []).some((x) => x.clip === c.id && (x.kind === 'takes' || x.kind === 'abc'));
  const M = s && model(s, c.gen.model), T = s && task(s, c.gen.model, c.gen.task);
  const what = [M?.court || c.gen.model, T?.nom || c.gen.task, c.gen.instrument || c.gen.v?.track_name ? trackFr(s, c.gen.instrument || c.gen.v.track_name) : ''].filter(Boolean).join(' · ');
  g.fillStyle = tok(busy ? 'amb' : 'ink2');
  g.font = `9px ${tok('f-mono') || 'monospace'}`;
  g.fillText(`${what.toUpperCase()}`, 6, Math.min(h - 6, 14));
  g.fillStyle = tok('ink3');
  g.fillText(busy ? 'EN COURS…' : 'À GÉNÉRER · DOUBLE-CLIC : LE PANNEAU', 6, Math.min(h - 6, 27));
}

// ── la vue du bas ───────────────────────────────────────────
export function trackPanel(app, host, t) {
  const s = schemaNow();
  const M = s && model(s, t.gen.model);
  put(host, el('div', { class: 'dk-empty gr-empty' }, el('b', { class: 'venus' }, 'Génératif'),
    el('span', {}, 'piste générative · tirer sur sa voie dessine une région (aimantée à la grille) ; le panneau Générer la règle, ses versions reviennent ici'),
    el('button', { class: 'tb ghost sm', type: 'button', onclick: () => ouvrirGenerer(app) }, 'Générer…'),
    el('span', { class: 'lbl' }, M ? M.doc : '')));
  return null;
}
// une région : ses versions, en cartes (les écouter, choisir celle qui joue dans
// le segment) ; ses réglages sont dans le panneau Générer
export function regionPanel(app, host, c, t) {
  if (!schemaNow() || !eng) {
    put(host, el('div', { class: 'dk-empty' }, el('span', { class: 'lbl' }, 'lecture du schéma des modèles…')));
    Promise.all([loadSchema(), engines()]).then(() => app.renderView());
    return null;
  }
  put(host, el('div', { class: 'gr-dock', style: { '--k': `var(--${t.color})` } }, versionsBox(app, c, { bande: true })));
  return { frame() {}, key() { return false; } };
}

// ── un son, un clip de notes, lâchés dans le panneau ────────
// Les cases de son de la cible (inspiration, clip à varier) : le clic droit
// d'un clip audio de l'arrangement les propose (timeline.js).
export function soundSlotsOf(app) {
  const c = genTarget(app), s = schemaNow();
  if (!c || !s) return [];
  const M = model(s, c.gen.model), T = task(s, c.gen.model, c.gen.task);
  return (T?.params || []).filter((pid) => M.params[pid].type === 'son').map((pid) => ({ pid, label: M.params[pid].label, region: c }));
}
export function useSound(app, region, pid, itemId) {
  region.gen.v = { ...region.gen.v, [pid]: itemId };
  toast(`« ${schemaNow() ? model(schemaNow(), region.gen.model).params[pid].label : pid} » : ce clip`, 3000);
  app.commit('data'); repeindre();
}
// Un clip de l'arrangement lâché sur une case du panneau (timeline.js, le
// glisser d'un clip) : le son d'une case de son, les notes d'une case de la
// partition ; le clip ne bouge pas.
export function deposerClip(app, slot, c) {
  const reg = slot.dataset.genRegion ? app.clip(slot.dataset.genRegion) : genTarget(app);
  if (!reg?.gen) return;
  if (slot.dataset.genSlot) {
    if (c.item) useSound(app, reg, slot.dataset.genSlot, c.item);
    else toast(isRegion(c) ? 'une région sans version n\'a pas encore de son' : 'cette case prend un clip audio');
  } else if (c.pat) injectFrom(app, reg, schemaNow(), slot.dataset.genCase, { clip: c.id });
  else toast('le guide MIDI prend des clips de notes (chant, thème, accords)');
}

export async function check(abc) {
  if (!abc?.trim()) return null;
  try { return await api('music/yue/abc/check', { method: 'POST', body: { abc } }); } catch (e) { return { ok: false, error: e.message }; }
}

// Le guide MIDI — nos notes dans la partition de YuE2 : on relit la partition
// actuelle par abc_tools (la seule lecture), on remplace une voix (ou les
// accords), on la réécrit dans le dialecte, puis abc_tools la juge de nouveau.
// Le tempo, la mesure, la tonalité : ceux que la génération prend (effectif).
export async function injectFrom(app, c, s, k, src) {
  const P = app.S.proj, g = c.gen, PT = s.modeles.yue.partition, E = effectif(P, g);
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
  if (!notes.length) { toast(drumsIn ? 'la batterie ne passe pas dans la partition (le dialecte) : dis-la dans le style' : 'aucune note dans la plage'); return; }
  const cur = await check(g.v?.abc);
  const bars = regionBars(P, c);
  const data = cur?.ok ? reportVoices(cur.report) : { vocal: [], ins: [], chords: [] };
  let msg = '';
  if (k === 'chant' || k === 'theme') {
    const r = skyline(notes);
    data[k === 'chant' ? 'vocal' : 'ins'] = r.notes;
    msg = `${r.notes.length} notes${r.dropped ? ` (${r.dropped} sous d'autres : la plus haute reste)` : ''}`;
  } else {
    data.chords = chordsFromNotes(notes, abcKey(E.key), PT.intervalles);
    msg = data.chords.length ? `${data.chords.length} accords : ${data.chords.slice(0, 6).map((x) => x.name).join(' ')}${data.chords.length > 6 ? '…' : ''}` : 'aucun accord reconnu (trois notes ensemble au moins)';
  }
  const secsOf = g.v?.abc ? sectionsOf(g.v.abc) : [];
  const abc = writeAbc({ bpm: E.bpm, sig: E.sig, key: E.key, bars: Math.max(bars, data.bars || 0), meter: PT.mesure[E.sig],
    sections: secsOf.length ? secsOf : sectionsFor(P, c), vocal: data.vocal, ins: data.ins, chords: data.chords });
  g.v = { ...(g.v || {}), abc };
  const r = await check(abc);
  setCheck(c, r);
  if (g.v.mode === 'off' || !g.v.mode) g.v.mode = data.chords.length ? 'full' : 'melody';
  toast(`${PT.cases[k].label} : ${msg}${r?.ok === false ? ` — la partition ne passe pas : ${r.error_fr || r.error}` : ''}`, 6000);
  app.commit('data'); repeindre();
  return r;
}

// ce qui se lâche sur une case : un son (application/x-sr-item, application/x-odio, un fichier)
export async function itemOfDrop(e) {
  const raw = e.dataTransfer.getData(ITEM_MIME);
  if (raw) return JSON.parse(raw).id;
  const od = e.dataTransfer.getData('application/x-odio');
  if (od) { const d = JSON.parse(od); if (d.t === 'son') return d.item.id; }
  if (e.dataTransfer.files?.length) return (await uploadFile(e.dataTransfer.files[0], { tool: 'upload', via: 'odio' })).id;
  return null;
}
