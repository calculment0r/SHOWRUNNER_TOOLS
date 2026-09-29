// Musique, l'app : une chanson par prompt, avec nos modèles libres.
//
// Cal, 29/09 : « faire de la musique (simple avec prompt, fonctions de base
// de YuE (ou YuE2), avec quand même la possibilité de pouvoir mettre une réf
// son pour faire une cover ou s'en inspirer) » ; « la séparation de stems
// reste possible mais envoie vers le studio ODIO et il faudra un autre
// abonnement ». L'étude : docs/etudes/musique_app.md.
//
// - Le rail : le style (et des mots à cocher), chanté ou instrumental, les
//   paroles (« Écris-les pour moi »), la durée, une référence son (déposer,
//   Asset, disque) à « Reprendre » ou dont « S'en inspirer », la qualité en
//   mots simples (Rapide, Soigné) ; le modèle et le reste dans « Paramètres
//   avancés », fermés. Créer (le seul orange).
// - Tes chansons : les rendus en file en tête, puis chaque chanson avec son
//   lecteur (forme d'onde, clic = aller là), Variante, Séparer les pistes,
//   Ouvrir dans ODIO (ces deux-là : le Studio ; sans lui, le bouton dit
//   pourquoi et mène à la demande), ses pistes séparées à écouter seules.
// - Le serveur tient tout (server/tools/chanson.py) : la correspondance mots
//   simples → modèle, les bornes, la recette d'une variante, le projet ODIO.
//
// L'annulation (commun/undo.js) : mettre une chanson à la corbeille. Le
// formulaire se garde dans ce navigateur (localStorage), rien à enregistrer.
import { mountHeader, api, jobs, pick, toast, el, $, href, fmtDur, fmtWait, uploadFile, dropZone, dropAnywhere, stateFr, TOOLS } from '../commun/shell.js';
import { createUndo, libTrash } from '../commun/undo.js';
import { prefs } from '../commun/prefs.js';
import { contextMenu, pageMenu, kebab } from '../commun/menu.js';
import { ask } from '../commun/fil.js';

const hdr = mountHeader('chanson', { sub: 'une chanson par prompt' });
// accroche : tant que commun/shell.js (TOOLS) ne connaît pas l'app, elle pose son nom elle-même
if (!TOOLS.some((t) => t.id === 'chanson')) {
  hdr.querySelector('.logo')?.after(el('span', { class: 'tool-name' }, el('span', { class: 'k' }, 'SR—11'), el('b', {}, 'Musique'),
    el('span', { class: 'lbl' }, 'une chanson par prompt')));
}

const KEY = 'sr-chanson.v1';
const DEF = { prompt: '', vocal: true, lyrics: '', duration: 60, exact: '', preset: 'rapide', refMode: 'cover', n: 1, seed: '',
  precision: 'bf16', bpm: '', key: '', language: 'fr' };
const S = {
  cfg: null, f: { ...DEF }, ref: null, advOpen: false,
  songs: [], total: 0, jobs: [], sending: false, writing: false,
  cur: null,               // ce qui joue : { id, song }
  waves: new Map(), fresh: new Set(),
};
// des mots de style : la page les montre en français, le modèle les lit en anglais (ses exemples le sont)
const CHIPS = [['pop', 'pop'], ['rock', 'rock'], ['jazz', 'jazz'], ['électro', 'electronic'], ['folk', 'folk'], ['hip-hop', 'hip-hop'],
  ['piano', 'piano'], ['guitare', 'acoustic guitar'], ['cordes', 'strings'], ['voix féminine', 'female vocal'],
  ['voix masculine', 'male vocal'], ['lent', 'slow'], ['entraînant', 'upbeat']];
const DUR_FR = (s) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60}` : `${s / 60} min`);
const STEM_FR = { vocals: 'voix', drums: 'batterie', bass: 'basse', other: 'autre', guitar: 'guitare', piano: 'piano', instrumental: 'instrumental' };
const ICON = {
  play: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z"/></svg>',
  pause: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5h2.6v9H2.5zM6.9 1.5h2.6v9H6.9z"/></svg>',
};

const put = (box, ...kids) => box && box.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false && k !== ''));
const PRE = (id) => S.cfg?.presets.find((p) => p.id === id);
const MOD = (id) => S.cfg?.models[id];
const REF = (id) => S.cfg?.refs[id];
const studio = () => !!S.cfg?.studio?.ok;
// le modèle : celui que la référence impose, sinon celui du préréglage (un modèle par préréglage : une seule vérité)
const model = () => (S.ref ? REF(S.f.refMode)?.model : PRE(S.f.preset)?.model) || 'ace';
const presetOf = (m) => S.cfg?.presets.find((p) => p.model === m)?.id;
function duration() {
  const x = parseFloat(String(S.f.exact).replace(',', '.'));
  return String(S.f.exact).trim() !== '' && isFinite(x) ? x : S.f.duration;
}

// ── la mémoire de ce navigateur ─────────────────────────────
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ f: S.f, ref: S.ref?.id || null, advOpen: S.advOpen })); } catch { /* stockage fermé */ }
}
function restore() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

// ── la demande ──────────────────────────────────────────────
function why() {
  const f = S.f, m = MOD(model());
  if (!S.cfg || !m) return 'le portail ne répond pas';
  if (!f.prompt.trim()) return 'décris la chanson : un style, une ambiance';
  if (f.prompt.trim().length > S.cfg.prompt_max) return `la description tient en ${S.cfg.prompt_max} signes`;
  if (f.vocal && !f.lyrics.trim()) return 'écris les paroles, ou « Écris-les pour moi »';
  const d = duration();
  if (!(d >= m.min && d <= m.max)) return `durée : de ${DUR_FR(m.min)} à ${DUR_FR(m.max)}${S.ref ? '' : ` en ${PRE(S.f.preset)?.label.toLowerCase()}`}`;
  if (S.ref && !REF(f.refMode)?.ready) return REF(f.refMode)?.why || 'pas prêt';
  if (!m.ready) return m.why || 'pas prêt';
  return '';
}
function body() {
  const f = S.f, m = model();
  const adv = { language: f.language };
  if (m === 'ace') {
    if (String(f.bpm).trim() !== '') adv.bpm = Math.round(+f.bpm);
    if (f.key) adv.key = f.key;
  } else adv.precision = f.precision;
  const seed = String(f.seed).trim();
  return { prompt: f.prompt.trim(), vocal: f.vocal, lyrics: f.vocal ? f.lyrics.trim() : '', duration: duration(),
    preset: S.ref ? presetOf(m) || f.preset : f.preset, ref: S.ref?.id || '', ref_mode: S.ref ? f.refMode : '',
    n: f.n, seed: seed === '' ? -1 : Math.round(+seed), adv };
}
async function create() {
  if (why() || S.sending) return;
  S.sending = true; paintAct();
  try {
    const j = await api('chanson/create', { method: 'POST', body: body() });
    S.jobs = [j, ...S.jobs.filter((x) => x.id !== j.id)];
    toast(`en file · ${j.title}`);
    jobs.poll(true);
    paintPend();
  } catch (e) { toast(e.message, 7000); }
  S.sending = false; paintAct();
}

// ── le rail ─────────────────────────────────────────────────
const pan = (label, right, ...kids) => el('section', { class: 'ch-pan' },
  el('div', { class: 'ch-pan-h' }, el('span', { class: 'lbl' }, label), right ? el('span', { class: 'r' }, right) : null), ...kids);
const promptTa = el('textarea', { class: 'fld', id: 'ch-prompt', rows: 3, maxlength: 500, 'aria-label': 'le style',
  placeholder: 'le style, l’ambiance — ex. dreamy pop, piano, female vocal, 90 BPM',
  oninput: (e) => { S.f.prompt = e.target.value; save(); paintChips(); paintLyrBtn(); paintAct(); } });
const lyrTa = el('textarea', { class: 'fld ch-lyr', id: 'ch-lyrics', rows: 8, 'aria-label': 'les paroles',
  placeholder: '[Verse]\n…\n\n[Chorus]\n…',
  oninput: (e) => { S.f.lyrics = e.target.value; save(); paintAct(); } });
const fileIn = el('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: async () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) await refFromFile(f); } });

function buildRail() {
  const lyrBtn = el('button', { class: 'tb ghost sm', id: 'ch-write', type: 'button', onclick: writeLyrics }, 'Écris-les pour moi');
  put($('#rail'),
    pan('Style', null, promptTa, el('div', { class: 'ch-chips', id: 'ch-chips' })),
    pan('Voix', null, el('div', { class: 'seg ch-full', id: 'ch-vocal', role: 'group', 'aria-label': 'voix' }),
      el('div', { id: 'ch-lyrbox' }, el('div', { class: 'ch-lyr-h' }, el('span', { class: 'lbl' }, 'Paroles'), el('span', { class: 'sp' }), lyrBtn), lyrTa)),
    pan('Durée', null, el('div', { class: 'seg ch-full', id: 'ch-dur', role: 'group', 'aria-label': 'durée' })),
    pan('Qualité', el('span', { id: 'ch-fake' }), el('div', { class: 'ch-presets', id: 'ch-presets' })),
    pan('Référence son', el('span', { class: 'lbl' }, 'facultatif'), el('div', { id: 'ch-ref' })),
    el('details', { class: 'ch-adv', id: 'ch-adv', open: S.advOpen || null, ontoggle: (e) => { S.advOpen = e.target.open; save(); } }),
    el('div', { class: 'ch-act', id: 'ch-act' }), fileIn);
  promptTa.value = S.f.prompt;
  lyrTa.value = S.f.lyrics;
  paintRail();
}
function paintRail() { paintChips(); paintVocal(); paintLyrBtn(); paintDur(); paintRef(); paintPresets(); paintAdv(); paintAct(); }

// un mot entier (« male vocal » n'est pas dans « female vocal »)
const wordRx = (w) => new RegExp(`(^|[^\\p{L}-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}-])`, 'iu');
function paintChips() {
  put($('#ch-chips'), CHIPS.map(([fr, en]) => el('button', { class: 'opt' + (wordRx(en).test(S.f.prompt) ? ' on' : ''), type: 'button', title: en,
    onclick: () => toggleWord(en) }, fr)));
}
function toggleWord(w) {
  const rx = wordRx(w);
  let parts = S.f.prompt.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.some((x) => rx.test(x))) parts = parts.map((x) => x.replace(rx, '$1').replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
  else parts.push(w);
  S.f.prompt = parts.join(', ');
  promptTa.value = S.f.prompt;
  save(); paintChips(); paintLyrBtn(); paintAct();
}
function paintVocal() {
  put($('#ch-vocal'), [[true, 'Chanté'], [false, 'Instrumental']].map(([v, lab]) => el('button', { class: 'tb' + (S.f.vocal === v ? ' on' : ''), type: 'button',
    onclick: () => { S.f.vocal = v; save(); paintVocal(); paintAct(); } }, lab)));
  $('#ch-lyrbox').hidden = !S.f.vocal;
}
function paintLyrBtn() {
  const b = $('#ch-write');
  if (!b) return;
  const off = !S.f.prompt.trim() ? 'décris d’abord la chanson : les paroles partent de sa description' : !S.cfg?.lyrics?.ready ? S.cfg?.lyrics?.why || '' : '';
  b.textContent = S.writing ? 'J’écris…' : 'Écris-les pour moi';
  b.disabled = S.writing || null;
  b.setAttribute('aria-disabled', off ? 'true' : 'false');
  b.title = off || (S.cfg?.lyrics?.engine === 'factice' ? 'des paroles d’essai (le modèle se branche dans Admin → Câblage)' : 'des paroles écrites d’après ta description');
}
function paintDur() {
  const ex = String(S.f.exact).trim() !== '';
  put($('#ch-dur'), S.cfg.durations.map((d) => el('button', { class: 'tb' + (!ex && S.f.duration === d ? ' on' : ''), type: 'button',
    onclick: () => { S.f.duration = d; S.f.exact = ''; save(); paintDur(); paintAdv(); paintAct(); } }, DUR_FR(d))));
}
function paintRef() {
  const box = $('#ch-ref');
  if (!S.ref) {
    const drop = el('div', { class: 'ch-drop', id: 'ch-drop' }, el('span', {}, 'Déposer un son'), el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: chooseRef }, 'Asset'),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => fileIn.click() }, 'Disque'));
    dropZone(drop, { kinds: ['audio'], multiple: false, via: 'chanson', onitems: (its) => setRef(its[0]) });
    put(box, drop);
    return;
  }
  const r = S.ref, R = REF(S.f.refMode);
  const playing = S.cur?.id === r.id;
  const row = el('div', { class: 'ch-ref', id: 'ch-refrow' },
    el('button', { class: 'ch-play' + (playing ? ' on' : ''), type: 'button', style: { width: '28px', height: '28px' }, 'aria-label': playing ? 'pause' : 'écouter la référence',
      html: playing && !player.paused ? ICON.pause : ICON.play, onclick: () => toggle(r, null) }),
    el('div', {}, el('div', { class: 't', title: r.title }, r.title || r.id), el('small', {}, fmtDur(r.duration))),
    el('button', { class: 'ch-x', type: 'button', title: 'retirer la référence', onclick: () => setRef(null) }, '×'));
  dropZone(row, { kinds: ['audio'], multiple: false, via: 'chanson', onitems: (its) => setRef(its[0]) });
  put(box, row,
    el('div', { class: 'seg ch-full', id: 'ch-refmode', role: 'group', 'aria-label': 'que faire de la référence' },
      Object.entries(S.cfg.refs).map(([id, x]) => el('button', { class: 'tb' + (S.f.refMode === id ? ' on' : ''), type: 'button', title: x.ready ? x.about : x.why,
        onclick: () => { S.f.refMode = id; save(); paintRef(); paintPresets(); paintAdv(); paintAct(); } }, x.label))),
    el('p', { class: 'ch-note' + (R && !R.ready ? ' warn' : '') }, R ? (R.ready ? R.about : R.why) : ''));
}
async function chooseRef() {
  const got = await pick({ kinds: ['audio'], title: 'Une référence son' });
  if (got[0]) setRef(got[0]);
}
async function refFromFile(f) {
  toast(`dépôt · ${f.name}`, 60000);
  try { setRef(await uploadFile(f, { tool: 'upload', via: 'chanson' })); toast('rangé dans la bibliothèque · Upload'); } catch (e) { toast(`${f.name} : ${e.message}`, 6000); }
}
function setRef(it) {
  if (it && it.kind !== 'audio') { toast('une référence est un son', 5000); return; }
  if (!it && S.cur && S.cur.id === S.ref?.id) stop();
  S.ref = it || null;
  save(); paintRef(); paintPresets(); paintAdv(); paintAct();
}
function paintPresets() {
  const m = model();
  const forced = S.ref ? REF(S.f.refMode) : null;
  put($('#ch-presets'), S.cfg.presets.map((p) => {
    const on = forced ? p.model === m : S.f.preset === p.id;
    const off = forced && p.model !== m ? `pas avec « ${forced.label} »` : '';
    return el('button', { class: 'opt ch-preset' + (on ? ' on' : '') + (off ? ' off' : ''), type: 'button', 'aria-disabled': off ? 'true' : null,
      'aria-pressed': on ? 'true' : 'false', title: off || null, 'data-preset': p.id,
      onclick: () => { if (off) { toast(off, 4000); return; } S.f.preset = p.id; save(); paintPresets(); paintAdv(); paintAct(); } },
    el('b', {}, p.label), el('span', {}, off || p.about));
  }));
  const M = MOD(m);
  put($('#ch-fake'), M?.engine === 'factice' ? el('span', { class: 'ch-fake', title: 'moteur d’essai : des sons synthétisés, pas le modèle — il se branche dans Admin → Câblage' }, 'essai') : null);
}
function paintAdv() {
  const d = $('#ch-adv');
  const m = model(), M = MOD(m), f = S.f;
  const set = (k, v, rep = true) => { S.f[k] = v; save(); if (rep) { paintAdv(); paintDur(); } paintAct(); };
  const num = (k, attrs) => el('input', { class: 'fld', inputmode: 'numeric', value: f[k] ?? '', ...attrs, oninput: (e) => set(k, e.target.value, false) });
  const kids = [
    el('span', { class: 'lbl' }, 'Modèle'),
    el('div', { class: 'ch-models' }, Object.entries(S.cfg.models).map(([id, x]) => {
      const off = S.ref && REF(S.f.refMode)?.model !== id ? `pas avec « ${REF(S.f.refMode).label} »` : !x.ready ? x.why : '';
      return el('button', { class: 'opt ch-model' + (id === m ? ' on' : '') + (off ? ' off' : ''), type: 'button', title: `${off ? off + '\n' : ''}${x.full}\n${x.source}`,
        'aria-disabled': off ? 'true' : null, onclick: () => { if (off) { toast(off, 5000); return; } S.f.preset = presetOf(id); save(); paintPresets(); paintAdv(); paintAct(); } },
      el('b', {}, x.name), el('small', {}, x.engine === 'factice' ? 'essai' : x.ready ? 'prêt' : 'pas prêt'));
    })),
  ];
  if (m === 'yue') {
    kids.push(el('span', { class: 'lbl' }, 'Précision'), el('div', { class: 'seg ch-full' }, [['bf16', 'qualité'], ['int8', 'rapide']].map(([v, lab]) =>
      el('button', { class: 'tb' + (f.precision === v ? ' on' : ''), type: 'button', title: v, onclick: () => set('precision', v) }, lab))));
  } else {
    kids.push(el('span', { class: 'lbl' }, 'Tempo'), num('bpm', { placeholder: 'lu dans le style, sinon 120', 'aria-label': 'tempo (BPM)' }),
      el('span', { class: 'lbl' }, 'Tonalité'), el('select', { class: 'fld', 'aria-label': 'tonalité', onchange: (e) => set('key', e.target.value) },
        el('option', { value: '' }, 'C major'), S.cfg.keys.filter((k) => k !== 'C major').map((k) => el('option', { value: k, selected: f.key === k || null }, k))));
  }
  kids.push(el('span', { class: 'lbl' }, 'Langue du chant'), el('select', { class: 'fld', 'aria-label': 'langue du chant', onchange: (e) => set('language', e.target.value) },
    S.cfg.languages.map((l) => el('option', { value: l.id, selected: f.language === l.id || null }, l.label))),
  el('span', { class: 'lbl' }, 'Durée exacte'), num('exact', { placeholder: `en secondes, ${M.min} à ${M.max}`, 'aria-label': 'durée exacte (s)',
    onchange: () => { paintDur(); } }),
  el('span', { class: 'lbl' }, 'Versions'), el('div', { class: 'seg ch-full', role: 'group', 'aria-label': 'versions' },
    Array.from({ length: S.cfg.max_n }, (_, i) => i + 1).map((n) => el('button', { class: 'tb' + (f.n === n ? ' on' : ''), type: 'button', onclick: () => set('n', n) }, String(n)))),
  el('span', { class: 'lbl' }, 'Graine'), num('seed', { placeholder: 'au hasard', 'aria-label': 'graine' }));
  const touched = [f.exact !== '' && 'durée', f.n > 1 && `${f.n} versions`, String(f.seed).trim() !== '' && 'graine'].filter(Boolean).join(' · ');
  put(d, el('summary', {}, el('span', { class: 'lbl' }, 'Paramètres avancés'), el('span', { class: 'r' }, [M.name, touched].filter(Boolean).join(' · '))),
    el('div', { class: 'ch-advin' }, kids));
}
function paintAct() {
  const w = why();
  put($('#ch-act'), el('button', { class: 'tb go block', id: 'ch-create', type: 'button', disabled: !!w || S.sending || null, onclick: create },
    S.sending ? 'Envoi…' : S.f.n > 1 ? `Créer ${S.f.n} versions` : 'Créer'),
  w ? el('div', { class: 'why' }, w) : null);
}

// ── « Écris-les pour moi » ──────────────────────────────────
async function writeLyrics() {
  if (!S.f.prompt.trim()) { toast('décris d’abord la chanson : les paroles partent de sa description', 5000); promptTa.focus(); return; }
  if (!S.cfg.lyrics.ready) { toast(S.cfg.lyrics.why || 'pas prêt', 6000); return; }
  S.writing = true; paintLyrBtn();
  try {
    const j = await api('chanson/paroles', { method: 'POST', body: { prompt: S.f.prompt.trim(), language: S.f.language } });
    jobs.poll(true);
    const done = await jobs.wait(j.id);
    if (done.state !== 'done') throw new Error(`paroles : ${stateFr(done.state)}${done.message ? ' — ' + done.message : ''}`);
    const txt = done.result?.lyrics || '';
    if (S.f.lyrics.trim() && S.f.lyrics.trim() !== txt.trim()) {
      const yes = await ask({ title: 'Remplacer les paroles ?', text: 'Les nouvelles paroles prennent la place des tiennes.', ok: 'Remplacer' });
      if (!yes) return;
    }
    S.f.lyrics = txt; S.f.vocal = true; lyrTa.value = txt;
    save(); paintVocal(); paintAct();
    toast(done.result?.engine === 'factice' ? 'paroles d’essai (moteur factice)' : 'paroles écrites', 4000);
  } catch (e) { toast(e.message, 7000); } finally { S.writing = false; paintLyrBtn(); }
}

// ── l'écoute : un seul lecteur pour la page ─────────────────
const player = new Audio();
player.preload = 'auto';
let raf = 0;
function find(id) {
  for (const s of S.songs) {
    if (s.id === id) return { it: s, song: s };
    const st = (s.stems || []).find((x) => x.id === id);
    if (st) return { it: st, song: s };
  }
  return null;
}
function toggle(it, song, at = null) {
  if (S.cur?.id === it.id && at === null) {
    if (player.paused) player.play().catch(() => {}); else player.pause();
    return;
  }
  const t0 = at ?? (S.cur && song && S.cur.song === song.id ? player.currentTime : 0);   // d'une piste à l'autre de la même chanson : au même instant
  S.cur = { id: it.id, song: song?.id || null };
  player.src = href(it.url);
  player.currentTime = 0;
  const go = () => { try { player.currentTime = Math.min(t0, (it.duration || 1e9) - 0.05); } catch { /* pas prêt */ } player.play().catch(() => {}); };
  if (t0) player.addEventListener('loadedmetadata', go, { once: true }); else go();
  paintPlaying();
}
function stop() { player.pause(); S.cur = null; paintPlaying(); }
function paintPlaying() {
  for (const card of document.querySelectorAll('.ch-song')) {
    const id = card.dataset.id;
    const on = S.cur?.song === id;
    card.classList.toggle('on', on);
    const b = card.querySelector('.ch-play');
    const mine = S.cur?.id === id && !player.paused;
    b.classList.toggle('on', mine);
    b.innerHTML = mine ? ICON.pause : ICON.play;
    b.setAttribute('aria-label', mine ? 'pause' : 'écouter');
    for (const c of card.querySelectorAll('.ch-stem')) {
      const p = S.cur?.id === c.dataset.id && !player.paused;
      c.classList.toggle('on', p);
      c.querySelector('i').innerHTML = p ? ICON.pause : ICON.play;
    }
    drawWave(card);
  }
  if (S.ref) { const rb = $('#ch-refrow .ch-play'); if (rb) { const p = S.cur?.id === S.ref.id && !player.paused; rb.classList.toggle('on', p); rb.innerHTML = p ? ICON.pause : ICON.play; } }
}
function tick() {
  cancelAnimationFrame(raf);
  const card = S.cur?.song && document.querySelector(`.ch-song[data-id="${S.cur.song}"]`);
  if (card) drawWave(card);
  if (!player.paused) raf = requestAnimationFrame(tick);
}
player.addEventListener('play', () => { paintPlaying(); tick(); });
player.addEventListener('pause', paintPlaying);
player.addEventListener('ended', () => { player.currentTime = 0; paintPlaying(); });

// ── la forme d'onde : des pics lus sur le serveur, dessinés aux couleurs des jetons ──
async function loadWave(song, card) {
  if (S.waves.has(song.id)) { drawWave(card); return; }
  S.waves.set(song.id, null);
  try { S.waves.set(song.id, await api(`chanson/onde/${song.id}`)); } catch { S.waves.delete(song.id); return; }
  const c = document.querySelector(`.ch-song[data-id="${song.id}"]`);
  if (c) drawWave(c);
}
function drawWave(card) {
  const cv = card.querySelector('canvas.ch-wave');
  const w = S.waves.get(card.dataset.id);
  if (!cv) return;
  const r = cv.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  const cs = getComputedStyle(cv);
  const base = cs.color, played = cs.getPropertyValue('--played').trim() || base;
  const song = S.songs.find((s) => s.id === card.dataset.id);
  const dur = song?.duration || w?.duration || 0;
  const mine = S.cur?.song === card.dataset.id;
  const t = mine ? player.currentTime : 0;
  const px = dur ? (t / dur) * W : 0;
  const peaks = w?.peaks;
  if (!peaks) {
    g.fillStyle = base; g.globalAlpha = 0.4; g.fillRect(0, H / 2 - dpr / 2, W, dpr); g.globalAlpha = 1;
  } else {
    const n = peaks.length, bw = W / n, gap = Math.min(dpr, bw * 0.3);
    for (let i = 0; i < n; i++) {
      const h = Math.max(dpr, peaks[i] * H * 0.92);
      const x = i * bw;
      g.fillStyle = mine && x + bw / 2 <= px ? played : base;
      g.fillRect(x, (H - h) / 2, Math.max(dpr * 0.6, bw - gap), h);
    }
  }
  if (mine) { g.fillStyle = played; g.fillRect(Math.min(W - dpr, px), 0, Math.max(1, dpr), H); }
  const tl = card.querySelector('.ch-time');
  if (tl) tl.textContent = mine ? `${fmtDur(t)} / ${fmtDur(dur)}` : fmtDur(dur);
}
new MutationObserver(() => requestAnimationFrame(() => document.querySelectorAll('.ch-song').forEach(drawWave)))
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
const ro = new ResizeObserver((ents) => { for (const e of ents) { const c = e.target.closest('.ch-song'); if (c) drawWave(c); } });

// ── tes chansons ────────────────────────────────────────────
const U = createUndo({ name: 'chanson', onapply: () => loadSongs() });
function buildStage() {
  put($('#stage'),
    el('div', { class: 'ch-head' }, el('span', { class: 'lbl' }, 'Tes chansons'), el('span', { class: 'n', id: 'ch-count' }), el('span', { class: 'sp' }),
      el('span', { class: 'sr-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, ...U.buttons())),
    el('div', { class: 'ch-list', id: 'ch-pend' }),
    el('div', { class: 'ch-list', id: 'ch-list' }));
}
let loadT = null;
const loadSoon = () => { clearTimeout(loadT); loadT = setTimeout(loadSongs, 250); };
async function loadSongs() {
  let r;
  try { r = await api('chanson/list?limit=80'); } catch (e) { put($('#ch-list'), el('p', { class: 'warn' }, e.message)); return; }
  const before = new Set(S.songs.map((s) => s.id));
  S.songs = r.songs; S.total = r.total;
  const neu = S.songs.filter((s) => !before.has(s.id));
  if (before.size) {
    // une chanson qui arrive se voit (un filet vert), quelques secondes
    neu.forEach((s) => S.fresh.add(s.id));
    setTimeout(() => { neu.forEach((s) => { S.fresh.delete(s.id); document.querySelector(`.ch-song[data-id="${s.id}"]`)?.classList.remove('fresh'); }); }, 8000);
  }
  paintSongs();
  if (before.size && neu.length && prefs.get('chanson.autoplay', false)) toggle(neu[0], neu[0]);
}
const recOf = (s) => s.params?.chanson || {};
function metaOf(s) {
  const r = recOf(s), p = s.params || {};
  const what = r.ref_mode === 'cover' ? 'reprise' : r.ref_mode === 'inspire' ? 'inspirée' : (PRE(r.preset)?.label || '').toLowerCase();
  return [what, fmtDur(s.duration), r.vocal === false ? 'instrumental' : r.vocal ? 'chanté' : '', r.parent ? 'variante' : '',
    p.engine === 'factice' ? el('span', { class: 'e' }, 'essai') : ''].filter(Boolean);
}
function paintSongs() {
  const box = $('#ch-list');
  $('#ch-count').textContent = S.total ? String(S.total) : '';
  ro.disconnect();
  if (!S.songs.length) {
    put(box, activeJobs().length ? null : el('div', { class: 'ch-empty' }, el('b', {}, 'Tes chansons arriveront ici.'),
      el('span', {}, 'Décris un style à gauche, puis Créer.')));
    return;
  }
  put(box, S.songs.map(card));
  for (const c of box.querySelectorAll('.ch-song')) { const s = S.songs.find((x) => x.id === c.dataset.id); loadWave(s, c); ro.observe(c.querySelector('canvas')); }
  paintPlaying();
}
const stemJob = (s) => S.jobs.find((j) => j.kind === 'music.stems' && j.params?.src === s.id && ['queued', 'running', 'error'].includes(j.state) && !j.forgotten);
function card(s) {
  const lock = studio() ? null : el('span', { class: 'ch-lock' }, 'Studio');
  const sj = stemJob(s);
  const sep = s.stems?.length ? null : sj
    ? el('span', { class: 'ch-busy' + (sj.state === 'error' ? ' err' : '') }, sj.state === 'error' ? `séparation : échec — ${sj.message || ''}`
      : `séparation · ${sj.state === 'running' && sj.progress != null ? Math.round(sj.progress * 100) + ' %' : stateFr(sj.state)}`)
    : el('button', { class: 'tb ghost sm', type: 'button', 'data-act': 'stems', title: studio() ? 'voix, batterie, basse, autre : chacune sur sa piste' : S.cfg.studio.why,
      onclick: () => separate(s) }, 'Séparer les pistes', lock);
  const cv = el('canvas', { class: 'ch-wave', 'aria-label': 'forme d’onde · clic : écouter à partir d’ici' });
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    const at = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (s.duration || 0);
    const it = S.cur?.song === s.id ? find(S.cur.id)?.it || s : s;
    toggle(it, s, at);
  });
  const c = el('article', { class: 'ch-song' + (S.fresh.has(s.id) ? ' fresh' : ''), 'data-id': s.id },
    el('div', { class: 'ch-top' },
      el('button', { class: 'ch-play', type: 'button', 'aria-label': 'écouter', html: ICON.play, onclick: () => toggle(s, s) }),
      el('div', { class: 'ch-tx' }, el('b', { title: s.prompt || s.title }, s.title || s.id), el('div', { class: 'ch-meta' }, metaOf(s).flatMap((x, i) => (i ? [' · ', x] : [x])))),
      kebab(() => songMenu(s), { title: 'plus' })),
    el('div', { class: 'ch-wavebox' }, cv, el('span', { class: 'ch-time' }, fmtDur(s.duration))),
    el('div', { class: 'ch-acts' },
      el('button', { class: 'tb ghost sm', type: 'button', 'data-act': 'variant', title: 'la même recette, une autre graine', onclick: () => variant(s) }, 'Variante'),
      sep,
      el('button', { class: 'tb ghost sm', type: 'button', 'data-act': 'odio', title: studio() ? (s.stems?.length ? 'la chanson et ses pistes dans le studio' : 'la chanson dans le studio') : S.cfg.studio.why,
        onclick: () => openOdio(s) }, 'Ouvrir dans ODIO', studio() ? null : el('span', { class: 'ch-lock' }, 'Studio'))),
    s.stems?.length ? el('div', { class: 'ch-stems' }, el('span', { class: 'lbl' }, 'pistes'),
      s.stems.map((st) => el('button', { class: 'ch-stem', type: 'button', 'data-id': st.id, title: `écouter ${STEM_FR[st.params?.stem] || st.params?.stem} seule`,
        onclick: () => toggle(st, s) }, el('i', { html: ICON.play }), STEM_FR[st.params?.stem] || st.params?.stem))) : null);
  return c;
}
function songMenu(s) {
  const playing = S.cur?.id === s.id && !player.paused;
  return [{ head: s.title || s.id },
    { label: playing ? 'Pause' : 'Écouter', icon: playing ? '❚❚' : '▶', key: 'Espace', onclick: () => toggle(s, s) },
    { label: 'Reprendre ces réglages', icon: '⤓', sub: 'dans le formulaire', onclick: () => takeRecipe(s) },
    { label: 'Une variante', icon: '↻', sub: 'une autre graine', onclick: () => variant(s) },
    s.params?.score ? { label: 'Copier la partition', icon: '♪', sub: 'ABC', onclick: () => copyScore(s) } : null,
    '-',
    { label: 'Séparer les pistes', icon: '≡', disabled: !!s.stems?.length || !!stemJob(s), why: s.stems?.length ? 'déjà séparée' : 'en cours', onclick: () => separate(s) },
    { label: 'Ouvrir dans ODIO', icon: '◆', sub: studio() ? '' : 'Studio', onclick: () => openOdio(s) },
    '-',
    { label: 'Ouvrir dans Asset', icon: '▦', onclick: () => { location.href = href('asset/#' + s.id); } },
    { label: 'Télécharger', icon: '↓', onclick: () => download(s) },
    '-',
    { label: 'Mettre à la corbeille', icon: '×', sub: 'Ctrl+Z la rend', onclick: () => trash(s) }].filter(Boolean);
}
function download(it) {
  const ext = (it.file || '.wav').slice((it.file || '.wav').lastIndexOf('.'));
  const a = el('a', { href: href(it.url), download: `${(it.title || it.id).replace(/[^\w.-]+/g, '_').slice(0, 60)}${ext}` });
  document.body.append(a); a.click(); a.remove();
}
function copyScore(s) {
  import('../commun/fil.js').then((m) => m.copyText(s.params.score, 'partition copiée'));
}
async function trash(s) {
  if (S.cur?.song === s.id) stop();
  try { await libTrash(U, s, `mettre « ${s.title} » à la corbeille`); } catch (e) { toast(e.message, 6000); return; }
  toast('à la corbeille · Ctrl+Z la rend');
  loadSongs();
}
async function variant(s) {
  try { const j = await api('chanson/variant', { method: 'POST', body: { item: s.id } }); S.jobs = [j, ...S.jobs]; toast(`en file · ${j.title}`); jobs.poll(true); paintPend(); } catch (e) { toast(e.message, 7000); }
}
async function takeRecipe(s) {
  const r = recOf(s);
  if (!r.prompt) { toast('cette chanson n’a pas de recette', 5000); return; }
  const f = S.f;
  Object.assign(f, { prompt: r.prompt, vocal: r.vocal !== false, lyrics: r.lyrics || '', preset: r.preset || presetOf(r.model) || 'rapide',
    refMode: r.ref_mode || f.refMode, n: 1, seed: '', precision: r.precision || 'bf16', bpm: r.bpm && r.bpm !== 120 ? String(r.bpm) : '',
    key: r.key && r.key !== 'C major' ? r.key : '', language: r.language || 'fr' });
  if (S.cfg.durations.includes(r.duration)) { f.duration = r.duration; f.exact = ''; } else f.exact = String(r.duration || '');
  S.ref = null;
  if (r.ref) { try { S.ref = await api('library/' + r.ref); } catch { toast('la référence n’est plus dans la bibliothèque', 5000); } }
  promptTa.value = f.prompt; lyrTa.value = f.lyrics;
  save(); paintRail();
  toast('réglages repris');
}

// ── le Studio : séparer, ouvrir dans ODIO ───────────────────
async function separate(s) {
  if (!studio()) return studioPanel();
  try {
    const j = await api('chanson/stems', { method: 'POST', body: { item: s.id } });
    S.jobs = [j, ...S.jobs]; jobs.poll(true); paintSongs();
    toast(S.cfg.stems.engine === 'factice' ? 'séparation en file (moteur d’essai : des filtres)' : 'séparation en file');
  } catch (e) { toast(e.message, 7000); }
}
async function openOdio(s) {
  if (!studio()) return studioPanel();
  try {
    const r = await api('chanson/odio', { method: 'POST', body: { item: s.id } });
    location.href = href(r.open);
  } catch (e) { toast(e.message, 7000); }
}
function studioPanel() {
  const st = S.cfg.studio;
  const asked = (d) => el('p', { class: 'asked' }, `Demande envoyée le ${new Date(d).toLocaleDateString('fr-FR')} : Cal te l’ouvrira.`);
  const askBtn = el('button', { class: 'tb', type: 'button', disabled: st.asked ? true : null }, st.asked ? 'Demandé' : 'Demander le Studio');
  const body = el('div', { class: 'modal-body' },
    el('p', {}, st.why || ''),
    el('p', {}, 'ODIO, le studio musique, reçoit la chanson et ses pistes : voix, batterie, basse, le reste — chacune sur sa piste, à retravailler.'),
    st.asked ? asked(st.asked) : null);
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  askBtn.addEventListener('click', async () => {
    askBtn.disabled = true;
    try {
      const r = await api('chanson/studio/demande', { method: 'POST', body: {} });
      if (r.ok) { S.cfg = await api('chanson/options'); close(); paintSongs(); return; }
      st.asked = r.asked; body.append(asked(r.asked)); askBtn.textContent = 'Demandé';
    } catch (e) { toast(e.message, 6000); askBtn.disabled = false; }
  });
  const scrim = el('div', { class: 'scrim ch-studio-modal', onclick: (e) => { if (e.target === scrim) close(); } },
    el('div', { class: 'modal', role: 'dialog', 'aria-label': 'le Studio' },
      el('div', { class: 'modal-head' }, el('span', { class: 't' }, 'Le Studio')),
      body,
      el('div', { class: 'modal-foot' }, el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: close }, 'Fermer'), askBtn)));
  document.addEventListener('keydown', esc, true);
  document.body.append(scrim);
  askBtn.focus();
}

// ── la file : ce qui attend, ce qui tourne ──────────────────
const SONG_KINDS = new Set(['chanson.ace', 'chanson.yue']);
const activeJobs = () => S.jobs.filter((j) => SONG_KINDS.has(j.kind) && ['queued', 'running'].includes(j.state));
const forgotten = new Set();
function paintPend() {
  const rows = S.jobs.filter((j) => SONG_KINDS.has(j.kind) && !forgotten.has(j.id) && ['queued', 'running', 'error', 'interrupted'].includes(j.state));
  put($('#ch-pend'), rows.map((j) => {
    const live = j.state === 'queued' || j.state === 'running';
    const where = j.state === 'running' ? (j.progress != null ? `${Math.round(j.progress * 100)} %` : 'en cours')
      : j.state === 'queued' ? [j.ahead ? `${j.ahead} devant toi` : 'en file', j.eta_s != null ? `départ ≈ ${fmtWait(j.eta_s)}` : ''].filter(Boolean).join(' · ')
        : `${stateFr(j.state)}${j.message ? ' — ' + j.message : ''}`;
    return el('div', { class: 'ch-pend' + (live ? '' : ' err'), 'data-job': j.id },
      el('div', {}, el('b', {}, j.title || 'Chanson'), el('small', {}, where)),
      el('div', { class: 'acts' }, live
        ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => jobs.cancel(j.id).catch((e) => toast(e.message)) }, 'Arrêter')
        : [el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => { forgotten.add(j.id); try { await jobs.retry(j.id); } catch (e) { toast(e.message); } } }, 'Relancer'),
          el('button', { class: 'ch-x', type: 'button', title: 'l’oublier', onclick: () => { forgotten.add(j.id); paintPend(); } }, '×')]),
      live ? el('div', { class: 'bar' }, el('i', { style: { width: j.progress != null ? `${Math.round(j.progress * 100)}%` : '100%', opacity: j.progress != null ? 1 : 0.3 } })) : null);
  }));
  if (!S.songs.length) paintSongs();
}
let wasActive = new Set();
function onJobs(list) {
  const mine = list.filter((j) => j.tool === 'chanson' && j.mine !== false);
  // ce que la page vient d'envoyer et que le relevé n'a pas encore vu reste en tête
  const seen = new Set(mine.map((j) => j.id));
  S.jobs = [...mine, ...S.jobs.filter((j) => !seen.has(j.id) && ['queued', 'running'].includes(j.state) && Date.now() - Date.parse(j.created || 0) < 15000)];
  const now = new Set(S.jobs.filter((j) => ['queued', 'running'].includes(j.state)).map((j) => j.id));
  const ended = [...wasActive].some((id) => !now.has(id));
  wasActive = now;
  paintPend();
  if (ended) loadSongs();
  else if (S.jobs.some((j) => j.kind === 'music.stems')) for (const s of S.songs) {
    const c = document.querySelector(`.ch-song[data-id="${s.id}"] .ch-busy`);
    const sj = stemJob(s);
    if (c && sj) c.textContent = `séparation · ${sj.state === 'running' && sj.progress != null ? Math.round(sj.progress * 100) + ' %' : stateFr(sj.state)}`;
  }
}

// ── le clavier, le clic droit ───────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.scrim')) return;
  const t = document.activeElement;
  if (t && (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable)) return;
  if (e.key === ' ') {
    const f = S.cur ? find(S.cur.id) : null;
    const it = f?.it || S.songs[0];
    if (!it) return;
    e.preventDefault();
    toggle(it, f?.song || it);
  }
});
function stageMenu(e) {
  const c = e.target.closest('.ch-song[data-id]');
  const s = c && S.songs.find((x) => x.id === c.dataset.id);
  return s ? songMenu(s) : null;
}
pageMenu(() => [{ head: 'Musique' },
  { label: 'Créer', icon: '▶', disabled: !!why(), why: why(), onclick: create },
  { label: 'Écris-les pour moi', icon: '✎', disabled: !S.f.prompt.trim() || S.writing, why: 'décris d’abord la chanson', onclick: writeLyrics },
  { label: 'Choisir une référence son…', icon: '+', onclick: chooseRef },
  S.ref ? { label: 'Retirer la référence', icon: '×', onclick: () => setRef(null) } : null].filter(Boolean));

// ── démarrage ───────────────────────────────────────────────
async function start() {
  put($('#rail'), el('p', { class: 'lbl' }, 'chargement'));
  buildStage();
  try { S.cfg = await api('chanson/options'); } catch (e) {
    put($('#rail'), el('p', { class: 'warn' }, `le portail ne répond pas : ${e.message}`)); return;
  }
  const d = restore() || {};
  if (d.f && typeof d.f === 'object') S.f = { ...DEF, ...d.f };
  if (!PRE(S.f.preset)) S.f.preset = 'rapide';
  if (!S.cfg.refs[S.f.refMode]) S.f.refMode = 'cover';
  S.advOpen = !!d.advOpen;
  if (d.ref) { try { S.ref = await api('library/' + d.ref); } catch { S.ref = null; } }
  buildRail();
  contextMenu($('#stage'), stageMenu);
  dropAnywhere((files) => { const f = files.find((x) => /^audio\//.test(x.type) || /\.(wav|mp3|flac|m4a|ogg)$/i.test(x.name)); if (f) refFromFile(f); else toast('seul un son se dépose ici : la référence', 5000); });
  await loadSongs();
  jobs.watch(onJobs);
  document.addEventListener('sr:job', (e) => { if (e.detail?.tool === 'chanson') loadSoon(); });
  prefs.on?.('general.theme', () => requestAnimationFrame(() => document.querySelectorAll('.ch-song').forEach(drawWave)));
}
start();
