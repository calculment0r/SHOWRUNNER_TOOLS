// Musique — les playlists : le volet à droite de la page (Cal, 05/10 : « un
// outil de playlist super cool » ; l'étude :
// docs/etudes/musique_spaces_playlists.md § 3 et § 5 étape 2).
//
// - Une playlist est un objet de la bibliothèque (server/tools/playlist.py) :
//   elle naît ici, dans le Space courant ; elle se réécrit à chaque geste —
//   rien à « enregistrer » (règle 7) — et chaque geste s'annule (Ctrl+Z, la
//   pile de la page).
// - On y glisse les cartes de la scène (une chanson, une piste séparée), du
//   panneau Asset ou des fichiers du disque : tout son de la bibliothèque. On
//   réordonne en glissant les morceaux (ou Alt + ↑ ↓) ; la durée totale reste
//   en tête du volet.
// - « Écouter » joue toute la playlist dans la page : la barre de lecture du
//   portail et les enchaînements (chanson/playlist_lecture.js).
// - La pochette : une image de la bibliothèque, sinon la mosaïque faite
//   d'office (commun/pochette.js). « Fais-moi une pochette » prépare une
//   carte Image — le titre et l'ambiance en prompt, carré — et le rendu reste
//   le geste de la personne (Générer), par les routes de l'outil Image, comme
//   les cartes Générer d'Idéation (ideation/gen.js) ; une image rendue devient
//   la pochette d'un clic.
// - « Proposer un ordre » : tonalités voisines, tempo qui monte puis redescend
//   (POST /api/playlist/<id>/ordre ; rien n'est écrit). Un son sans recette a
//   son tempo mesuré ici, par le détecteur d'ODIO (musique/tempo.js, essayé par
//   server/tools/music_tempo.py). La proposition se montre dans la liste ; la
//   personne garde ou annule.
// - Par morceau : son titre, ses crédits, ses paroles dans la playlist ;
//   « Caler les paroles » ouvre l'éditeur des paroles calées (commun/lrc.js,
//   la branche « paroles ») ; « Exporter en .zip » appelle la route de la
//   branche « écoute ». Absents de ce portail, ils sont éteints et disent
//   pourquoi (GET /api/playlist/options).
//
// Aucune couleur ici : chanson/playlist.css habille avec les jetons.
import { api, jobs, toast, el, href, fmtDur, dropZone, pick, stateFr } from '../commun/shell.js';
import { menu, kebab, contextMenu } from '../commun/menu.js';
import { ask } from '../commun/fil.js';
import { pochette } from '../commun/pochette.js';
import { lecturePlaylist } from './playlist_lecture.js';

if (!document.querySelector('link[data-pl-css]')) {
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./playlist.css', import.meta.url).href, 'data-pl-css': '' }));
}

// ── le Space courant : UNE fonction ─────────────────────────
// Le contrat de la branche des Spaces (chanson/spaces.js) : `spaceCourant()` rend
// { id: 'mon' | 'msp-…', music_space: '' | 'msp-…', name, … }, et l'événement
// `sr:music-space` sur window le redit à chaque changement. Le module n'est importé que
// si le portail le sert (GET /api/playlist/options, `spaces`) : sans lui, ce que
// l'événement a dit, sinon « Mon Space ». Rend la fiche du Space ou null (« Mon Space »).
let spaceDit = null, spacesMod = null;
addEventListener('sr:music-space', (e) => { spaceDit = e.detail && typeof e.detail === 'object' ? e.detail : null; });
export function spaceCourant() { return spacesMod?.spaceCourant?.() || spaceDit || null; }
const spaceEnvoi = () => spaceCourant()?.music_space || null;     // le `music_space` de la création (null : « Mon Space »)
const spaceNom = () => spaceCourant()?.name || 'Mon Space';

const KEY = 'sr-chanson-playlist.v1';         // { open, id } : une commodité de ce navigateur
const TEMPO_KEY = 'sr-playlist-tempo.v1';     // les tempos mesurés ici, par son (un son ne change jamais)
const CONFIANCE_MIN = 0.5;                    // en dessous, le tempo mesuré n'est pas pris (notre seuil : musique/tempo.js, § 7)
const ICON = {
  play: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z"/></svg>',
  pause: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5h2.6v9H2.5zM6.9 1.5h2.6v9H6.9z"/></svg>',
};
const P = {
  U: null, opts: null, list: [], cur: null, open: false, onPlay: () => {},
  q: Promise.resolve(), attente: 0,     // les écritures, une à la fois : `base_rev` suit
  ordre: null,                          // la proposition : { rows, resume, order, avant }
  mesure: null,                         // la mesure des tempos en cours : { k, n }
  carte: null,                          // « Fais-moi une pochette » : { prompt, model, models, jobs, images }
  dropAt: null,
  ecouteOrdre: false,                   // l'écoute en cours suit l'ordre proposé (pas encore gardé)
};
const put = (box, ...kids) => box && box.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false && k !== ''));
const memo = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
const garder = (d) => { try { localStorage.setItem(KEY, JSON.stringify({ ...memo(), ...d })); } catch { /* stockage fermé */ } };
const tempos = () => { try { return JSON.parse(localStorage.getItem(TEMPO_KEY) || '{}') || {}; } catch { return {}; } };
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
// une durée totale : « 12 min 30 s », « 1 h 05 min »
function total(s) {
  s = Math.round(s || 0);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min${r ? ` ${String(r).padStart(2, '0')} s` : ''}`;
}
const V = {};                           // les nœuds du volet, faits une fois
const lect = { P: null };

// ── ce que la playlist courante dit d'elle ──────────────────
const pl = () => P.cur?.playlist;
const trs = () => (P.ordre ? P.ordre.order.map((i) => P.ordre.avant[i]) : pl()?.tracks || []);
const son = (id) => P.cur?.items?.[id] || null;
const titreDe = (t) => t.title || son(t.item)?.title || 'son absent';
function duree() {
  let s = 0, absents = 0;
  for (const t of pl()?.tracks || []) { const a = son(t.item); if (a) s += a.duration || 0; else absents += 1; }
  return { s, absents };
}
function metaDe(id) {
  const m = P.cur?.metas?.[id] || {};
  const mes = !m.bpm && tempos()[id];
  return { bpm: m.bpm || mes || null, key: m.key || null, mesure: !!mes };
}

// ── lire, créer ─────────────────────────────────────────────
async function chargerListe() {
  try { P.list = (await api('playlist')).playlists || []; } catch (e) { P.list = []; toast(e.message, 6000); }
}
async function ouvrir(id) {
  if (lect.P?.actif && P.cur?.id !== id) lect.P.arreter();   // une autre playlist : l'écoute de l'autre s'arrête
  if (!id) { P.cur = null; paint(); return; }
  try { P.cur = await api('playlist/' + id); } catch (e) {
    P.cur = null; garder({ id: null });
    if (e.status !== 404) toast(e.message, 6000);
  }
  P.ordre = null; P.carte = null;
  if (P.cur) garder({ id: P.cur.id });
  paint();
}
async function creer(premiers = []) {
  let d;
  try {
    d = await api('playlist', { method: 'POST', body: { music_space: spaceEnvoi(), tracks: premiers.map((it) => it.id) } });
  } catch (e) { toast(e.message, 7000); return null; }
  P.list = [{ id: d.id, title: d.title, tracks: d.playlist.tracks.length, duration: d.duration }, ...P.list];
  P.cur = d; P.ordre = null; P.carte = null;
  garder({ id: d.id });
  // créer s'annule : la playlist part à la corbeille (et en revient)
  P.U?.record({ label: `créer la playlist « ${d.title} »`,
    undo: async () => { await api(`library/${d.id}/delete`, { method: 'POST' }); if (P.cur?.id === d.id) { P.cur = null; } await chargerListe(); paint(); },
    redo: async () => { await api(`library/${d.id}/restore`, { method: 'POST' }); await chargerListe(); await ouvrir(d.id); } });
  paint();
  setTimeout(() => V.corps?.querySelector('.pl-titre')?.select(), 30);
  return d;
}

// ── écrire : chaque geste réécrit la playlist ───────────────
// L'état se pose tout de suite dans la page ; l'écriture suit, une à la fois (`base_rev`
// : une autre page qui aurait écrit entre-temps fait recharger plutôt qu'écraser).
const snap = () => ({ title: P.cur.title, playlist: JSON.parse(JSON.stringify(P.cur.playlist)) });
function envoyer(change) {
  const id = P.cur?.id;
  if (!id) return Promise.resolve();
  P.attente += 1;
  const run = P.q.catch(() => {}).then(async () => {
    try {
      const d = await api('playlist/' + id, { method: 'POST', body: { base_rev: P.cur?.id === id ? P.cur.rev : undefined, ...change } });
      if (P.cur?.id !== id) return;
      // une écriture encore en attente garde ce que la page montre ; le reste vient du serveur
      const keep = P.attente > 1 ? { title: P.cur.title, playlist: P.cur.playlist } : {};
      P.cur = { ...d, ...keep };
      const row = P.list.find((x) => x.id === id);
      if (row) Object.assign(row, { title: d.title, tracks: d.playlist.tracks.length, duration: d.duration, thumb_url: d.thumb_url });
      paintTete(); paintId(false); paintActs(); paintListe();
    } catch (e) {
      toast(e.message, 7000);
      if (e.status === 409 || e.status === 404) await ouvrir(id);
      throw e;
    } finally { P.attente -= 1; }
  });
  P.q = run;
  return run;                           // rejetée sur un refus : un contraire refusé fait tomber le geste (commun/undo.js)
}
// un geste : posé, écrit, rangé avec son contraire
function ecrire(change, label, { merge = null } = {}) {
  if (!P.cur) return Promise.resolve();
  const avant = snap();
  if ('title' in change) P.cur.title = change.title;
  if (change.playlist) P.cur.playlist = { ...P.cur.playlist, ...change.playlist };
  const apres = snap();
  P.U?.record({ label, merge, undo: () => poser(avant), redo: () => poser(apres) });
  return envoyer(change).catch(() => {});   // le refus est déjà dit (toast), la page rechargée s'il le faut
}
// un contraire : l'état entier d'avant (le serveur juge encore chaque son)
function poser(s) {
  if (!P.cur) return Promise.reject(new Error('plus de playlist ouverte'));
  P.cur.title = s.title;
  P.cur.playlist = JSON.parse(JSON.stringify(s.playlist));
  P.ordre = null;
  if (lect.P.actif) lect.P.arreter();
  paint();
  return envoyer({ title: s.title, playlist: s.playlist });
}

// ── les morceaux ────────────────────────────────────────────
function ajouter(items, at = null) {
  const sons = (items || []).filter((it) => it && it.kind === 'audio');
  const refus = (items || []).length - sons.length;
  if (refus) toast('une playlist ne prend que des sons', 5000);
  if (!sons.length) return;
  for (const it of sons) P.cur.items = { ...P.cur.items, [it.id]: it };
  const list = pl().tracks.slice();
  const k = at === null || at === undefined ? list.length : Math.max(0, Math.min(list.length, at));
  list.splice(k, 0, ...sons.map((it) => ({ item: it.id })));
  suivre((i) => (i >= k ? i + sons.length : i), list);
  ecrire({ playlist: { tracks: list } }, sons.length > 1 ? `ajouter ${sons.length} sons à « ${P.cur.title} »` : `ajouter « ${sons[0].title} » à « ${P.cur.title} »`);
  paintTete(); paintActs(); paintListe();
  toast(sons.length > 1 ? `${sons.length} sons dans la playlist` : `dans la playlist · ${sons[0].title}`);
}
function deplacer(from, to) {
  const list = pl().tracks.slice();
  if (from === to || from < 0 || from >= list.length) return;
  const [x] = list.splice(from, 1);
  list.splice(to, 0, x);
  suivre((i) => (i === from ? to : from < i && i <= to ? i - 1 : to <= i && i < from ? i + 1 : i), list);
  ecrire({ playlist: { tracks: list } }, `déplacer « ${titreDe(x)} »`);
  paintListe();
}
function retirer(k) {
  const list = pl().tracks.slice();
  const [x] = list.splice(k, 1);
  if (lect.P?.actif && lect.P.index === k) lect.P.arreter();
  else suivre((i) => (i > k ? i - 1 : i), list);
  ecrire({ playlist: { tracks: list } }, `retirer « ${titreDe(x)} » de la playlist`);
  paintTete(); paintActs(); paintListe();
}
// la liste change pendant l'écoute : le morceau en cours continue, la suite suit
function suivre(f, list) {
  if (!lect.P?.actif || lect.P.index < 0) return;
  const i = f(lect.P.index);
  if (i >= 0) lect.P.suite(file(list), i);
}
const file = (list) => list.map((t) => ({ it: son(t.item) || { id: t.item, title: titreDe(t) }, titre: titreDe(t) }));

// ── écouter ─────────────────────────────────────────────────
function ecouter(k = 0) {
  if (!P.cur || !pl().tracks.length) { toast('la playlist est vide : glisse des chansons dedans', 5000); return; }
  P.ecouteOrdre = !!P.ordre;            // l'ordre proposé s'écoute avant d'être gardé
  lect.P.jouer(file(trs()), k, pl().transition);
}
function paintLecture(i) {
  for (const r of V.liste?.querySelectorAll('.pl-tr') || []) {
    const on = !P.ordre && +r.dataset.k === i;
    r.classList.toggle('on', on);
    const b = r.querySelector('.pl-jouer');
    const joue = on && lect.P.lecture;
    if (b) { b.innerHTML = joue ? ICON.pause : ICON.play; b.setAttribute('aria-label', joue ? 'pause' : 'écouter à partir d’ici'); }
  }
  const b = V.acts?.querySelector('[data-act="ecouter"]');
  if (b) b.textContent = lect.P.lecture ? 'Pause' : lect.P.actif && lect.P.index >= 0 ? 'Reprendre' : 'Écouter';
}

// ── « Proposer un ordre » ───────────────────────────────────
// Le tempo d'un son que ni sa partition ni sa recette ne disent : mesuré ici (musique/tempo.js,
// sur le son décodé et rééchantillonné à son taux par un OfflineAudioContext — MDN :
// decodeAudioData rééchantillonne au taux du contexte), mono, ses quatre premières minutes.
async function tempoDe(it) {
  const { analyser, REGLAGES } = await import('../musique/tempo.js');
  const sr = REGLAGES.sr;
  const buf = await (await fetch(href(it.url))).arrayBuffer();
  const dec = await new OfflineAudioContext(1, 1, sr).decodeAudioData(buf);
  const n = Math.min(dec.length, sr * 240);
  const x = new Float32Array(n);
  for (let c = 0; c < dec.numberOfChannels; c++) {
    const d = dec.getChannelData(c);
    for (let i = 0; i < n; i++) x[i] += d[i] / dec.numberOfChannels;
  }
  const r = await analyser(x, sr, { sig: 4 });
  return r.ok && r.confiance >= CONFIANCE_MIN ? r.propose : 0;   // 0 : mesuré, sans tempo sûr
}
async function mesurer(ids) {
  const memo0 = tempos(), out = {};
  const todo = ids.filter((id) => !(id in memo0));
  P.mesure = todo.length ? { k: 0, n: todo.length } : null;
  paintActs();
  for (const id of todo) {
    try { memo0[id] = await tempoDe(son(id)); } catch { memo0[id] = 0; }
    P.mesure.k += 1; paintActs();
  }
  P.mesure = null;
  try { localStorage.setItem(TEMPO_KEY, JSON.stringify(memo0)); } catch { /* stockage fermé */ }
  for (const id of ids) if (memo0[id]) out[id] = memo0[id];
  return out;
}
async function proposer() {
  if (!P.cur || P.ordre || P.mesure) return;
  if (pl().tracks.length < 2) { toast('il faut au moins deux morceaux pour un ordre', 5000); return; }
  const sans = [...new Set(pl().tracks.map((t) => t.item))].filter((id) => son(id) && !P.cur.metas?.[id]?.bpm);
  let r;
  try {
    const mes = await mesurer(sans);
    r = await api(`playlist/${P.cur.id}/ordre`, { method: 'POST', body: { tempos: mes } });
  } catch (e) { P.mesure = null; paintActs(); toast(e.message, 7000); return; }
  paintActs();
  if (!r.changed) { toast('l’ordre tient déjà : tonalités voisines, tempo en arc — rien à changer', 5000); return; }
  P.ordre = { ...r, avant: pl().tracks.slice() };
  if (lect.P.actif) lect.P.pause();
  paintActs(); paintOrdre(); paintListe();
}
function garderOrdre() {
  if (!P.ordre) return;
  const o = P.ordre;
  const list = o.order.map((i) => o.avant[i]);
  P.ordre = null;
  if (!P.ecouteOrdre) suivre((i) => o.order.indexOf(i), list);   // écoutée dans l'ordre proposé : elle y est déjà
  P.ecouteOrdre = false;
  ecrire({ playlist: { tracks: list } }, `l’ordre proposé pour « ${P.cur.title} »`);
  paintActs(); paintOrdre(); paintListe();
  toast('ordre gardé · Ctrl+Z le défait');
}
function annulerOrdre() {
  P.ordre = null;
  if (P.ecouteOrdre && lect.P.actif) lect.P.arreter();             // l'écoute de la proposition s'arrête avec elle
  P.ecouteOrdre = false;
  paintActs(); paintOrdre(); paintListe();
}

// ── la pochette ─────────────────────────────────────────────
async function choisirPochette() {
  const got = await pick({ kinds: ['image'], title: 'La pochette de la playlist' });
  if (got[0]) poserPochette(got[0]);
}
function poserPochette(img) {
  if (!P.cur) return;
  ecrire({ playlist: { cover: img ? img.id : null } }, img ? `la pochette de « ${P.cur.title} »` : `la mosaïque pour « ${P.cur.title} »`);
  paintId(true);
}
// « Fais-moi une pochette » : le titre et l'ambiance (la description, sinon les styles des
// morceaux, leur recette) en prompt ; le modèle lit l'anglais (comme les mots de style de
// la page), la personne le relit et le change avant de lancer
function promptPochette() {
  const styles = [...new Set(pl().tracks.map((t) => (son(t.item)?.params?.chanson?.prompt || '').trim()).filter(Boolean))].slice(0, 3);
  const mood = (pl().description || '').trim() || styles.join(' ; ');
  return [`square album cover artwork for a music playlist titled "${P.cur.title}"`, pl().artist ? `by ${pl().artist}` : '',
    mood ? `mood: ${mood}` : '', 'no text, no lettering, no logo'].filter(Boolean).join(', ');
}
async function ouvrirCarte() {
  if (!P.cur) return;
  if (P.carte) { P.carte = null; paintCarte(); return; }
  P.carte = { prompt: promptPochette(), model: 'krea2', models: [], jobs: [], images: [], sending: false };
  paintCarte();
  try {
    const m = await api('image/models');
    P.carte.models = (m.models || []).map((x) => ({ id: x.id, name: x.name }));
    if (!P.carte.models.some((x) => x.id === P.carte.model)) P.carte.model = P.carte.models[0]?.id || '';
    P.carte.essai = m.backend !== 'comfyui';
  } catch (e) { P.carte.why = e.message; }
  paintCarte();
}
async function generer() {
  const C = P.carte;
  if (!C || C.sending || !C.prompt.trim() || !C.model) return;
  C.sending = true; paintCarte();
  try {
    const r = await api('image/generate', { method: 'POST', body: { model: C.model, prompt: C.prompt.trim(), aspect: '1:1', count: 2 } });
    C.jobs = [...(r.jobs || []), ...C.jobs];
    jobs.poll(true);
    for (const j of r.jobs || []) {
      jobs.wait(j.id, (x) => { const k = C.jobs.findIndex((y) => y.id === x.id); if (k >= 0) C.jobs[k] = x; paintCarte(); }).then((done) => {
        if (done.state === 'done') C.images = [...(done.items || []).filter((it) => it.kind === 'image'), ...C.images];
        else toast(`pochette : ${stateFr(done.state)}${done.message ? ' — ' + done.message : ''}`, 6000);
        C.jobs = C.jobs.filter((y) => y.id !== done.id);
        if (P.carte === C) paintCarte();
      }).catch(() => {});
    }
  } catch (e) { toast(e.message, 7000); }
  C.sending = false; paintCarte();
}

// ── par morceau : titre, crédits, paroles ; les paroles calées ──
function fiche(k) {
  const t = pl().tracks[k], a = son(t.item);
  const champ = (key, label, { area = false, ph = '' } = {}) => {
    const n = el(area ? 'textarea' : 'input', { class: 'fld', rows: area ? 8 : null, placeholder: ph, 'aria-label': label,
      onchange: (e) => {
        const list = pl().tracks.slice();
        const v = e.target.value.trim();
        const cur = { ...list[k] };
        if (v) cur[key] = v; else delete cur[key];
        list[k] = cur;
        ecrire({ playlist: { tracks: list } }, `${label} de « ${titreDe(t)} » dans la playlist`);
        paintListe();
      } });
    n.value = t[key] || '';
    return el('label', { class: 'pl-champ' }, el('span', { class: 'lbl' }, label), n);
  };
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const scrim = el('div', { class: 'scrim pl-fiche', onclick: (e) => { if (e.target === scrim) close(); } },
    el('div', { class: 'modal', role: 'dialog', 'aria-label': `le morceau ${k + 1}` },
      el('div', { class: 'modal-head' }, el('span', { class: 't' }, `${String(k + 1).padStart(2, '0')} · ${titreDe(t)}`)),
      el('div', { class: 'modal-body' },
        el('p', { class: 'ch-note' }, 'Ce que la playlist dit de ce morceau, sans toucher au son : vide, c’est celui du son.'),
        champ('title', 'titre', { ph: a?.title || '' }),
        champ('credits', 'crédits', { ph: 'qui a écrit, chanté, produit' }),
        champ('lyrics', 'paroles', { area: true, ph: a?.params?.chanson?.lyrics || 'les paroles (texte)' })),
      el('div', { class: 'modal-foot' }, el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: close }, 'Fermer'))));
  document.addEventListener('keydown', esc, true);
  document.body.append(scrim);
  scrim.querySelector('input')?.focus();
}
async function calerParoles(k) {
  const o = P.opts?.lrc;
  if (!o?.ready) { toast(o?.why || 'les paroles calées ne sont pas encore là', 7000); return; }
  const t = pl().tracks[k], a = son(t.item);
  if (!a) { toast('ce son n’est plus dans la bibliothèque', 5000); return; }
  let m;
  try { m = await import(new URL('../commun/lrc.js', import.meta.url).href); } catch (e) { toast(`l’éditeur des paroles ne se charge pas : ${e.message}`, 7000); return; }
  m.ouvrirEditeurLrc({ item: a, lrc: t.lrc || a.lrc || '', lyrics: t.lyrics || a.params?.chanson?.lyrics || '',
    onSave: async (lrc) => {
      // le son garde son calage (la branche « paroles » l'y range) ; la piste ne le surcharge que s'il diffère
      let neuf = a;
      try { neuf = await api('library/' + a.id); P.cur.items = { ...P.cur.items, [a.id]: neuf }; } catch { /* lu tel quel */ }
      const list = pl().tracks.slice();
      const cur = { ...list[k] };
      if (lrc && lrc !== (neuf.lrc || '')) cur.lrc = lrc; else delete cur.lrc;
      if (JSON.stringify(cur) === JSON.stringify(list[k])) return;
      list[k] = cur;
      ecrire({ playlist: { tracks: list } }, `les paroles calées de « ${titreDe(t)} »`);
      paintListe();
    } });
}
async function exporterZip() {
  const o = P.opts?.zip;
  if (!o?.ready) { toast(o?.why || 'l’export .zip n’est pas encore là', 7000); return; }
  try {
    const j = await api(`ecoute/${P.cur.id}/zip`, { method: 'POST', body: {} });
    toast('le .zip se prépare (la file)', 5000);
    jobs.poll(true);
    const done = j?.id ? await jobs.wait(j.id) : j;
    if (done.state && done.state !== 'done') throw new Error(`.zip : ${stateFr(done.state)}${done.message ? ' — ' + done.message : ''}`);
    const url = done.result?.url || done.url;
    if (url) { const a = el('a', { href: href(url), download: '' }); document.body.append(a); a.click(); a.remove(); }
    else toast('le .zip est prêt', 5000);
  } catch (e) { toast(e.message, 7000); }
}
async function jeter() {
  if (!P.cur) return;
  const d = P.cur;
  const yes = await ask({ title: 'Mettre la playlist à la corbeille ?', text: `« ${d.title} » part à la corbeille ; ses sons restent dans la bibliothèque. Ctrl+Z la rend.`, ok: 'Corbeille' });
  if (!yes) return;
  try { await api(`library/${d.id}/delete`, { method: 'POST' }); } catch (e) { toast(e.message, 7000); return; }
  lect.P.arreter();
  P.U?.record({ label: `mettre « ${d.title} » à la corbeille`,
    undo: async () => { await api(`library/${d.id}/restore`, { method: 'POST' }); await chargerListe(); await ouvrir(d.id); },
    redo: async () => { await api(`library/${d.id}/delete`, { method: 'POST' }); if (P.cur?.id === d.id) P.cur = null; await chargerListe(); paint(); } });
  P.cur = null; garder({ id: null });
  await chargerListe();
  paint();
  toast('à la corbeille · Ctrl+Z la rend');
}

// ── le volet ────────────────────────────────────────────────
function squelette() {
  V.choix = el('button', { class: 'pl-choix', type: 'button', 'aria-haspopup': 'menu', title: 'changer de playlist, en créer une', onclick: (e) => menuPlaylists(e.currentTarget) });
  V.sum = el('div', { class: 'pl-sum', 'aria-live': 'polite' });
  V.id = el('section', { class: 'pl-id' });
  V.acts = el('div', { class: 'pl-acts' });
  V.ordre = el('div', { class: 'pl-ordre-box' });
  V.carte = el('div', { class: 'pl-carte-box' });
  V.liste = el('ol', { class: 'pl-liste', 'aria-label': 'les morceaux' });
  V.vide = el('div', { class: 'pl-vide' });
  V.plus = el('details', { class: 'pl-plus' });
  V.barre = el('div', { class: 'pl-barre' });
  V.corps = el('div', { class: 'pl-corps' }, V.id, V.acts, V.ordre, V.carte, V.liste, V.vide, V.plus);
  V.root = el('aside', { class: 'pl-volet', id: 'pl-volet', 'aria-label': 'la playlist', hidden: true },
    el('header', { class: 'pl-h' },
      el('div', { class: 'pl-h1' }, el('span', { class: 'lbl' }, 'Playlist'), V.choix,
        el('button', { class: 'ch-x', type: 'button', title: 'fermer le volet', 'aria-label': 'fermer le volet', onclick: () => fermer() }, '×')),
      V.sum),
    V.corps, V.barre);
  lect.P = lecturePlaylist(V.barre, { onChange: (i) => paintLecture(i), onPlay: () => P.onPlay(), onStop: () => paintLecture(-1) });
  // un dépôt n'importe où dans le volet : des sons, à la fin (ou là où la ligne le montre)
  dropZone(V.corps, { kinds: ['audio'], multiple: true, via: 'chanson', label: 'la playlist', onitems: async (its) => {
    const at = P.dropAt; P.dropAt = null; clearDrop();
    if (P.ordre) { toast('garde ou annule d’abord l’ordre proposé', 5000); return; }
    if (!P.cur && !(await creer())) return;
    ajouter(its, at);
  } });
  V.corps.addEventListener('dragover', (e) => {
    const rows = [...V.liste.querySelectorAll('.pl-tr')];
    clearDrop();
    // entre les morceaux : là où la ligne le montre ; ailleurs dans le volet (la pochette, le bas) : à la fin
    const box = V.liste.getBoundingClientRect();
    if (!rows.length || e.clientY < box.top - 14 || e.clientY > box.bottom + 14) { P.dropAt = null; return; }
    let at = rows.length;
    for (const [k, r] of rows.entries()) { const b = r.getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) { at = k; break; } }
    P.dropAt = at;
    if (at < rows.length) rows[at].classList.add('drop-before'); else rows.at(-1).classList.add('drop-after');
  });
  V.corps.addEventListener('dragleave', (e) => { if (!V.corps.contains(e.relatedTarget)) clearDrop(); });
  addEventListener('drop', () => requestAnimationFrame(clearDrop), true);   // la ligne s'efface, la place reste lue (P.dropAt)
  reordonner(V.liste);
  contextMenu(V.liste, (e) => { const r = e.target.closest('.pl-tr'); return r && !P.ordre ? menuMorceau(+r.dataset.k) : null; });
}
const clearDrop = () => V.liste?.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));

// réordonner en glissant, de haut en bas (commun/refs.js range en ligne, pas en colonne) ;
// Alt + ↑ ↓ au clavier. Un simple clic reste un clic.
function reordonner(box) {
  let g = null;
  const rows = () => [...box.querySelectorAll(':scope > .pl-tr')];
  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || P.ordre) return;
    const n = e.target.closest('.pl-tr');
    if (!n || e.target.closest('button, input, a, [data-nodrag]')) return;
    g = { n, from: rows().indexOf(n), y: e.clientY, id: e.pointerId, on: false, to: null };
  });
  box.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    if (!g.on) {
      if (Math.abs(e.clientY - g.y) < 5) return;
      g.on = true;
      try { box.setPointerCapture(e.pointerId); } catch { /* parti */ }
      g.n.classList.add('dragging');
    }
    const l = rows();
    l.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    let at = l.length;
    for (const [k, r] of l.entries()) { const b = r.getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) { at = k; break; } }
    if (at < l.length) l[at].classList.add('drop-before'); else l.at(-1).classList.add('drop-after');
    let to = at > g.from ? at - 1 : at;
    g.to = to === g.from ? null : to;
  });
  const fin = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const d = g; g = null;
    rows().forEach((r) => r.classList.remove('drop-before', 'drop-after', 'dragging'));
    if (d.on && e.type === 'pointerup' && d.to !== null) { lache = Date.now(); deplacer(d.from, d.to); }
  };
  let lache = 0;
  box.addEventListener('click', (c) => { if (Date.now() - lache < 400) { c.stopPropagation(); c.preventDefault(); } }, true);
  box.addEventListener('pointerup', fin);
  box.addEventListener('pointercancel', fin);
  box.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || P.ordre) return;
    const n = e.target.closest('.pl-tr');
    if (!n) return;
    const from = rows().indexOf(n), to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= rows().length) return;
    e.preventDefault();
    deplacer(from, to);
    requestAnimationFrame(() => rows()[to]?.focus());
  });
}

function menuPlaylists(btn) {
  const r = btn.getBoundingClientRect();
  menu(r.left, r.bottom + 4, [
    { head: 'Les playlists de ce Workspace' },
    ...P.list.map((x) => ({ label: x.title || x.id, checked: P.cur?.id === x.id, sub: `${plural(x.tracks || 0, 'morceau', 'morceaux')} · ${total(x.duration)}`,
      onclick: () => ouvrir(x.id) })),
    P.list.length ? '-' : null,
    { label: 'Nouvelle playlist', icon: '+', sub: `dans « ${spaceNom()} »`, onclick: () => creer() },
  ].filter(Boolean));
}
function menuMorceau(k) {
  const t = pl().tracks[k], a = son(t.item), o = P.opts || {};
  const joue = lect.P.actif && lect.P.index === k && lect.P.lecture;
  return [{ head: `${String(k + 1).padStart(2, '0')} · ${titreDe(t)}` },
    { label: joue ? 'Pause' : 'Écouter à partir d’ici', icon: joue ? '❚❚' : '▶', disabled: !a, why: 'ce son n’est plus dans la bibliothèque',
      onclick: () => (joue ? lect.P.toggle() : ecouter(k)) },
    { label: 'Titre, crédits, paroles…', icon: '✎', sub: 'dans la playlist', onclick: () => fiche(k) },
    { label: 'Caler les paroles', icon: '♪', disabled: !o.lrc?.ready || !a, why: !a ? 'ce son n’est plus dans la bibliothèque' : o.lrc?.why, onclick: () => calerParoles(k) },
    '-',
    { label: 'Monter', icon: '↑', key: 'Alt+↑', disabled: k === 0, why: 'déjà en tête', onclick: () => deplacer(k, k - 1) },
    { label: 'Descendre', icon: '↓', key: 'Alt+↓', disabled: k === pl().tracks.length - 1, why: 'déjà le dernier', onclick: () => deplacer(k, k + 1) },
    '-',
    a ? { label: 'Ouvrir dans Asset', icon: '▦', onclick: () => { location.href = href('asset/#' + a.id); } } : null,
    { label: 'Retirer de la playlist', icon: '×', sub: 'le son reste dans la bibliothèque', onclick: () => retirer(k) }].filter(Boolean);
}
function menuPlaylist() {
  if (!P.cur) return [];
  return [{ head: P.cur.title },
    { label: 'Choisir une pochette…', icon: '▣', sub: 'une image de la bibliothèque', onclick: choisirPochette },
    pl().cover ? { label: 'Revenir à la mosaïque', icon: '▦', onclick: () => poserPochette(null) } : null,
    { label: 'Fais-moi une pochette', icon: '✦', sub: 'une carte Image', onclick: ouvrirCarte },
    '-',
    { label: 'Exporter en .zip', icon: '↓', disabled: !P.opts?.zip?.ready, why: P.opts?.zip?.why, onclick: exporterZip },
    { label: 'Ouvrir dans Asset', icon: '▦', onclick: () => { location.href = href('asset/#' + P.cur.id); } },
    '-',
    { label: 'Mettre à la corbeille', icon: '×', sub: 'Ctrl+Z la rend', onclick: jeter }].filter(Boolean);
}

function paint() {
  if (!V.root) return;
  paintTete(); paintId(true); paintActs(); paintOrdre(); paintCarte(); paintListe(); paintPlus();
}
function paintTete() {
  V.choix.textContent = P.cur ? P.cur.title || 'sans titre' : P.list.length ? 'choisir une playlist' : 'aucune playlist';
  V.choix.append(el('i', { class: 'pl-chev', 'aria-hidden': 'true' }));
  if (!P.cur) { put(V.sum); V.sum.hidden = true; return; }
  V.sum.hidden = false;
  const n = pl().tracks.length, d = duree();
  put(V.sum, el('b', {}, plural(n, 'morceau', 'morceaux')), el('span', {}, ' · '), el('b', { class: 'pl-total' }, total(d.s)),
    d.absents ? el('span', { class: 'pl-abs', title: 'à la corbeille, ou plus dans ce Workspace : la playlist les garde à leur place' }, ` · ${plural(d.absents, 'absent', 'absents')}`) : null);
}
function paintId(fort) {
  if (!P.cur) {
    put(V.id, el('div', { class: 'pl-accueil' },
      el('b', {}, P.list.length ? 'Choisis une playlist, ou crée-en une.' : 'Ta première playlist.'),
      el('span', {}, 'Glisse des chansons de la scène dans ce volet : elles s’y rangent dans l’ordre que tu veux, de tous tes Spaces.'),
      el('button', { class: 'tb', type: 'button', onclick: () => creer() }, 'Nouvelle playlist'),
      P.list.length ? el('div', { class: 'pl-autres' }, P.list.slice(0, 8).map((x) => el('button', { class: 'pl-autre', type: 'button', onclick: () => ouvrir(x.id) },
        el('b', {}, x.title || x.id), el('small', {}, `${plural(x.tracks || 0, 'morceau', 'morceaux')} · ${total(x.duration)}`)))) : null));
    return;
  }
  const focus = V.id.contains(document.activeElement);
  if (!fort && focus) { const p = V.id.querySelector('.pl-poch'); if (p) p.replaceChildren(pochette(P.cur, { items: P.cur.items, px: 104 })); return; }
  const champ = (cls, value, label, ph, onval, hi) => {
    const n = el('input', { class: 'fld ' + cls, value: value || '', maxlength: hi, placeholder: ph, 'aria-label': label, spellcheck: 'false' });
    let t = null;
    n.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => onval(n.value), 700); });
    n.addEventListener('change', () => { clearTimeout(t); onval(n.value); });
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter') n.blur(); });
    return n;
  };
  const p = pl();
  put(V.id,
    el('button', { class: 'pl-poch', type: 'button', title: p.cover ? 'la pochette · clic : en choisir une autre' : 'la mosaïque de ses premiers morceaux, faite d’office · clic : choisir une image',
      onclick: choisirPochette }, pochette(P.cur, { items: P.cur.items, px: 104 })),
    el('div', { class: 'pl-idx' },
      champ('pl-titre', P.cur.title, 'titre de la playlist', 'le titre', (v) => { v = v.trim(); if (v && v !== P.cur.title) { ecrire({ title: v }, `renommer la playlist en « ${v} »`, { merge: `pl-titre-${P.cur.id}` }); paintTete(); } }, 200),
      el('div', { class: 'pl-ligne' },
        champ('pl-artiste', p.artist, 'artiste affiché', 'artiste', (v) => { if (v.trim() !== p.artist) ecrire({ playlist: { artist: v.trim() } }, 'changer l’artiste', { merge: `pl-artiste-${P.cur.id}` }); }, 120),
        champ('pl-annee', p.year, 'année', 'année', (v) => { if (v.trim() !== p.year) ecrire({ playlist: { year: v.trim() } }, 'changer l’année', { merge: `pl-annee-${P.cur.id}` }); }, 16)),
      el('div', { class: 'pl-poch-acts' },
        el('button', { class: 'tb ghost sm', type: 'button', title: 'une image de la bibliothèque', onclick: choisirPochette }, 'Image…'),
        p.cover ? el('button', { class: 'tb ghost sm', type: 'button', title: 'la mosaïque de ses quatre premiers morceaux', onclick: () => poserPochette(null) }, 'Mosaïque') : null,
        el('button', { class: 'tb ghost sm' + (P.carte ? ' on' : ''), type: 'button', 'aria-pressed': String(!!P.carte), title: 'une carte Image avec le titre et l’ambiance en prompt : tu la relis, puis tu lances',
          onclick: ouvrirCarte }, 'Fais-moi une pochette'))));
}
function paintActs() {
  if (!P.cur) { put(V.acts); return; }
  const o = P.opts || {}, n = pl().tracks.length;
  const zipOff = !o.zip?.ready ? o.zip?.why || 'pas encore là' : '';
  const mes = P.mesure ? `tempo ${P.mesure.k} / ${P.mesure.n}` : '';
  put(V.acts,
    el('button', { class: 'tb sm', type: 'button', 'data-act': 'ecouter', title: 'toute la playlist, dans la page', disabled: !n || null,
      onclick: () => (lect.P.actif && lect.P.index >= 0 ? lect.P.toggle() : ecouter(0)) },
    lect.P.lecture ? 'Pause' : lect.P.actif && lect.P.index >= 0 ? 'Reprendre' : 'Écouter'),
    el('button', { class: 'tb ghost sm', type: 'button', 'data-act': 'ordre', disabled: n < 2 || !!P.ordre || !!P.mesure || null,
      title: n < 2 ? 'il faut au moins deux morceaux' : 'des tonalités voisines, un tempo qui monte puis redescend : tu gardes ou tu annules', onclick: proposer },
    P.mesure ? mes : 'Proposer un ordre'),
    // éteint, il dit pourquoi (au survol, au clic) et la pastille le montre
    el('button', { class: 'tb ghost sm', type: 'button', 'data-act': 'zip', 'aria-disabled': zipOff ? 'true' : null, title: zipOff || 'le lecteur et ses fichiers, à héberger où tu veux',
      onclick: exporterZip }, 'Exporter en .zip', zipOff ? el('span', { class: 'ch-lock' }, 'à venir') : null),
    el('span', { class: 'sp' }),
    kebab(menuPlaylist, { title: 'la playlist : pochette, Asset, corbeille' }));
  paintLecture(lect.P.index);
}
function paintOrdre() {
  if (!P.ordre) { put(V.ordre); return; }
  const R = P.ordre.resume;
  put(V.ordre, el('section', { class: 'pl-ordre', 'aria-label': 'l’ordre proposé' },
    el('div', { class: 'pl-ordre-h' }, el('span', { class: 'lbl' }, 'Ordre proposé'), el('span', { class: 'sp' }),
      el('button', { class: 'tb sm', type: 'button', 'data-act': 'garder', onclick: garderOrdre }, 'Garder'),
      el('button', { class: 'tb ghost sm', type: 'button', 'data-act': 'annuler', onclick: annulerOrdre }, 'Annuler')),
    el('p', { class: 'ch-note' },
      `tempo de ${Math.round(R.bpm_lo)} à ${Math.round(R.bpm_hi)} BPM, au sommet au morceau ${R.peak} ; `,
      R.keyed ? `${R.near} enchaînement${R.near > 1 ? 's' : ''} voisin${R.near > 1 ? 's' : ''} sur ${R.keyed} dont les tonalités sont connues` : 'tonalités inconnues : le tempo seul',
      R.unknown_tempo ? ` ; ${plural(R.unknown_tempo, 'morceau sans tempo garde sa place', 'morceaux sans tempo gardent leur place')}` : '')));
}
function paintCarte() {
  const C = P.carte;
  const b = V.id?.querySelector('.pl-poch-acts .tb:last-child');
  if (b) { b.classList.toggle('on', !!C); b.setAttribute('aria-pressed', String(!!C)); }
  if (!C || !P.cur) { put(V.carte); return; }
  const ta = el('textarea', { class: 'fld pl-carte-p', rows: 4, 'aria-label': 'le prompt de la pochette', oninput: (e) => { C.prompt = e.target.value; } });
  ta.value = C.prompt;
  const live = C.jobs.filter((j) => ['queued', 'running'].includes(j.state));
  put(V.carte, el('section', { class: 'pl-carte', 'aria-label': 'une pochette par Image' },
    el('div', { class: 'pl-carte-h' }, el('span', { class: 'lbl' }, 'Une pochette par Image'),
      C.essai ? el('span', { class: 'ch-fake', title: 'moteur d’essai : des images de test, pas le modèle — il se branche dans Admin → Câblage' }, 'essai') : null,
      el('span', { class: 'sp' }), el('button', { class: 'ch-x', type: 'button', title: 'fermer la carte', onclick: () => { P.carte = null; paintCarte(); } }, '×')),
    ta,
    el('div', { class: 'pl-carte-m' }, el('span', { class: 'lbl' }, 'carré · 2 images'), el('span', { class: 'sp' }),
      el('div', { class: 'seg', role: 'group', 'aria-label': 'modèle' }, C.models.map((m) => el('button', { class: 'tb' + (C.model === m.id ? ' on' : ''), type: 'button',
        onclick: () => { C.model = m.id; paintCarte(); } }, m.name)))),
    C.why ? el('p', { class: 'why' }, C.why) : null,
    el('div', { class: 'pl-carte-a' },
      el('button', { class: 'tb sm', type: 'button', 'data-act': 'generer', disabled: C.sending || !C.prompt.trim() || !C.model || null,
        title: 'le rendu part dans la file de l’outil Image : c’est ton geste', onclick: generer }, C.sending ? 'Envoi…' : 'Générer'),
      live.length ? el('span', { class: 'pill work' }, el('i'), el('span', {}, live.map((j) => j.state === 'running' && j.progress != null ? `${Math.round(j.progress * 100)} %` : stateFr(j.state)).join(' · '))) : null),
    C.images.length ? el('div', { class: 'pl-carte-i' }, C.images.map((it) => el('button', { class: 'pl-carte-img' + (pl().cover === it.id ? ' on' : ''), type: 'button',
      title: 'en faire la pochette', onclick: () => poserPochette(it) }, pochette({ ...it, playlist: null }, { px: 96 })))) : null,
    el('p', { class: 'ch-note' }, C.images.length ? 'clic sur une image : elle devient la pochette. Elles restent dans la bibliothèque (Image).' : 'relis le prompt, change-le si tu veux, puis Générer.')));
}
function paintListe() {
  if (!P.cur) {
    put(V.liste);
    put(V.vide, el('div', { class: 'pl-vide-in' }, el('b', {}, 'Glisse des chansons ici.'), el('span', {}, `Une playlist naît avec elles, dans « ${spaceNom()} ».`)));
    return;
  }
  const list = trs(), rows = P.ordre?.rows;
  put(V.liste, list.map((t, k) => {
    const a = son(t.item), m = metaDe(t.item), r = rows?.[k];
    const bits = [a ? fmtDur(a.duration) : 'absent', m.bpm ? `${Math.round(m.bpm)} BPM${m.mesure ? ' mesuré' : ''}` : '', m.key || ''].filter(Boolean);
    const li = el('li', { class: 'pl-tr' + (a ? '' : ' absent'), 'data-k': k, 'data-item': t.item, tabindex: 0,
      title: P.ordre ? '' : 'glisser pour changer sa place · Alt + ↑ ↓' },
    el('span', { class: 'pl-grip', 'aria-hidden': 'true' }),
    el('span', { class: 'pl-n' }, String(k + 1).padStart(2, '0')),
    el('button', { class: 'pl-jouer', type: 'button', html: ICON.play, 'aria-label': 'écouter à partir d’ici', disabled: !a || !!P.ordre || null,
      onclick: () => (lect.P.actif && lect.P.index === k ? lect.P.toggle() : ecouter(k)) }),
    el('div', { class: 'pl-tt' }, el('b', { title: titreDe(t) }, titreDe(t)),
      el('small', {}, bits.join(' · '), t.lrc || a?.lrc ? el('span', { class: 'pl-lrc', title: 'paroles calées' }, ' · LRC') : null,
        r?.link ? el('span', { class: 'pl-lien' + (r.near ? ' voisin' : '') }, ` · ${r.link}`) : null)),
    P.ordre ? (r && r.from !== k ? el('span', { class: 'pl-from', title: 'sa place d’avant' }, `était ${r.from + 1}`) : el('span'))
      : kebab(() => menuMorceau(k), { title: 'le morceau' }));
    return li;
  }));
  put(V.vide, list.length ? el('p', { class: 'pl-glisse' }, 'glisse d’autres sons ici') : el('div', { class: 'pl-vide-in' },
    el('b', {}, 'Glisse des chansons ici.'), el('span', {}, 'Une carte de la scène, une piste séparée, un son du panneau Asset ou un fichier : tout son de la bibliothèque.')));
  paintLecture(lect.P.index);
}
function paintPlus() {
  if (!P.cur) { put(V.plus); V.plus.hidden = true; return; }
  V.plus.hidden = false;
  const p = pl(), T = p.transition;
  const set = (tr, label) => {
    const t = { ...T, ...tr };
    ecrire({ playlist: { transition: t } }, label);
    lect.P.transition = t;
    paintPlus();
  };
  const desc = el('textarea', { class: 'fld', rows: 3, maxlength: 4000, placeholder: 'quelques mots : l’ambiance, l’histoire', 'aria-label': 'description' });
  desc.value = p.description || '';
  let tm = null;
  const dire = () => { const v = desc.value.trim(); if (v !== (pl().description || '')) ecrire({ playlist: { description: v } }, 'changer la description', { merge: `pl-desc-${P.cur.id}` }); };
  desc.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(dire, 800); });
  desc.addEventListener('change', () => { clearTimeout(tm); dire(); });
  const xf = el('input', { type: 'range', min: '0', max: String(P.opts?.crossfade_max || 6), step: '0.5', value: String(T.crossfade_s), 'aria-label': 'durée du fondu (s)',
    disabled: T.mode !== 'crossfade' || null,
    onchange: (e) => set({ crossfade_s: +e.target.value }, `fondu de ${e.target.value} s`) });
  const MODES = [['gapless', 'Sans blanc', 'le suivant part à la fin du précédent'], ['crossfade', 'Fondu', 'le suivant entre pendant que le précédent s’efface'],
    ['single', 'Un seul fichier', 'un fichier continu à la publication, le plus sûr sur iPhone écran verrouillé ; ici, comme « sans blanc »']];
  const open = V.plus.open;
  put(V.plus, el('summary', {}, el('span', { class: 'lbl' }, 'Enchaînements, téléchargement, description'),
    el('span', { class: 'r' }, [MODES.find((m) => m[0] === T.mode)?.[1], T.mode === 'crossfade' ? `${T.crossfade_s} s` : '', p.download ? 'téléchargeable' : ''].filter(Boolean).join(' · '))),
  el('div', { class: 'pl-plus-in' },
    el('span', { class: 'lbl' }, 'Enchaîner'),
    el('div', { class: 'seg ch-full', role: 'group', 'aria-label': 'enchaînement' }, MODES.map(([id, lab, why]) => el('button', { class: 'tb' + (T.mode === id ? ' on' : ''), type: 'button', title: why,
      onclick: () => set({ mode: id }, `enchaîner : ${lab.toLowerCase()}`) }, lab))),
    el('span', { class: 'lbl' }, 'Fondu'), el('div', { class: 'pl-xf' }, xf, el('span', { class: 'pl-xf-v' }, `${T.crossfade_s} s`)),
    el('span', { class: 'lbl' }, 'Télécharger'),
    el('label', { class: 'pl-dl' }, el('input', { type: 'checkbox', checked: p.download || null, onchange: (e) => ecrire({ playlist: { download: e.target.checked } }, e.target.checked ? 'permettre le téléchargement' : 'ne plus permettre le téléchargement') }),
      el('span', {}, 'le lecteur publié montre « Télécharger »')),
    el('span', { class: 'lbl' }, 'Description'), desc));
  V.plus.open = open;
}

// ── monter le volet ─────────────────────────────────────────
function ouvrirVolet() {
  P.open = true; garder({ open: true });
  V.root.hidden = false;
  document.querySelector('main.ch-studio')?.classList.add('pl-on');
  V.btn?.setAttribute('aria-pressed', 'true');
  V.btn?.classList.add('on');
}
function fermer() {
  P.open = false; garder({ open: false });
  V.root.hidden = true;
  document.querySelector('main.ch-studio')?.classList.remove('pl-on');
  V.btn?.setAttribute('aria-pressed', 'false');
  V.btn?.classList.remove('on');
}
const basculer = () => (P.open ? fermer() : ouvrirVolet());

// monterPlaylists({ U, onPlay }) : le volet, posé à droite de la scène. `U` : la pile de la
// page (chaque geste s'y range) ; `onPlay` : la page arrête sa propre écoute.
export function monterPlaylists({ U = null, onPlay = () => {} } = {}) {
  P.U = U; P.onPlay = onPlay;
  squelette();
  document.querySelector('main.ch-studio')?.append(V.root);
  V.btn = el('button', { class: 'tb ghost sm pl-btn', type: 'button', 'aria-pressed': 'false', title: 'le volet des playlists', onclick: basculer }, 'Playlist');
  const m = memo();
  // chanson/?playlist=<id> (la fiche d'Asset y mène) : le volet ouvert sur elle
  const voulue = new URLSearchParams(location.search).get('playlist');
  if (voulue) { try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* sans historique */ } }
  (async () => {
    try { P.opts = await api('playlist/options'); } catch { P.opts = null; }
    if (P.opts?.spaces) spacesMod = await import('./spaces.js').catch(() => null);   // le même module que la page
    await chargerListe();
    const id = voulue || m.id;
    if (id && (voulue || P.list.some((x) => x.id === id))) await ouvrir(id); else paint();
  })();
  if (m.open || voulue) ouvrirVolet();
  addEventListener('sr:music-space', () => { if (!P.cur) paintListe(); });   // « une playlist naît dans … » suit le Space
  return {
    bouton: () => V.btn,
    ouvrir: ouvrirVolet, fermer, basculer,
    async ajouter(items) {
      if (!P.open) ouvrirVolet();
      if (!P.cur && !(await creer())) return;
      if (P.ordre) { toast('garde ou annule d’abord l’ordre proposé', 5000); return; }
      ajouter(items);
    },
    pause: () => { if (lect.P?.lecture) lect.P.pause(); },
    lecture: () => !!lect.P?.lecture,
    actif: () => !!(lect.P?.actif && lect.P.index >= 0),
    toggle: () => lect.P?.toggle(),
    etat: () => ({ id: P.cur?.id || null, tracks: (pl()?.tracks || []).map((t) => t.item), ordre: !!P.ordre, lecture: lect.P?.etat() }),
  };
}
