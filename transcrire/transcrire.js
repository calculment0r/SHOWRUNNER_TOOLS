// Transcrire : un son ou une vidéo → le texte horodaté (et les voix), la
// traduction, la lecture synchronisée, la correction à la main, les
// sous-titres, le carnet. Le serveur tient la seule vérité : moteurs, langues,
// ce qui passe ou non, les sous-titres calculés du document
// (server/tools/transcrire.py, étude docs/etudes/transcrire.md).
//
// Deux modes (Cal, 30/09) : Rapide — un horodatage par réplique, le plus vite
// possible, pour beaucoup de sons ; Complet — les voix séparées, chaque mot à
// son instant, et la frise des voix de Movie Analysis (commun/voix.js : une
// piste par voix, sa ligne de dialogue mot à mot, sous elle son spectre).
// Pas de traduction par défaut (la préférence « Traduire par défaut en » : rien).
// Les voix se renomment à UN endroit (les cartes des voix) : le nom se pose
// partout — répliques, frise, carnet, exports — et reste dans le document.
// Le carnet (à la NotebookLM) : résumé, points clés · décisions · actions,
// chapitres, questions — tiré du seul texte, chaque élément cite ses répliques.
// Le texte et le carnet sont côte à côte, sur un seul écran (Cal, 05/10 : « on
// va réunir ensemble les deux onglets "texte" et "carnet" car les gens ne voient
// pas le "carnet" ») : la transcription à gauche, le carnet à droite, une poignée
// entre eux (commun/split.js, le partage gardé par visiteur) ; quand la place
// manque, les deux s'empilent (@container tr-split, transcrire.css).
//
// Entrée : un dépôt (disque ou vignette glissée), la bibliothèque, ou
// l'adresse transcrire/?src=<id>. Une transcription s'ouvre par #trn-….
//
// L'annulation (commun/undo.js) : chaque correction d'une réplique, d'une
// traduction, d'un nom de voix, avec son contraire (réenregistré). Ne
// s'annulent pas : lancer une transcription, une traduction, le carnet (partis
// dans la file), un fichier déposé, les réglages.
import { mountHeader, api, pick, toast, el, $, $$, href, fmtDur, fmtDate, uploadFile, dropZone, dropAnywhere, dock, sorteEffective, avecEspace, session } from '../commun/shell.js';
import { createUndo } from '../commun/undo.js';
import { prefs } from '../commun/prefs.js';
import { menu, contextMenu, pageMenu, copy } from '../commun/menu.js';
import { lecteur } from '../commun/lecteur.js';
import { friseVoix, teinte } from '../commun/voix.js';
import { split } from '../commun/split.js';

mountHeader('transcrire', { sub: 'transcrire · traduire' });

const KEY = 'sr-transcrire';
const S = {
  cfg: null,
  item: null,                       // le média choisi
  lang: 'auto', to: '', mode: 'rapide', cpl: 42, max_s: 7, stamps: false,
  doc: null, docs: [],
  view: 'both', follow: true, sending: false,
  studio: false,                    // le Montage est ouvert à ce compte (un compte Apps ne l'a pas : commun/shell.js, studioOff)
  wantCarnet: false,                // transcrire/?vue=carnet : le carnet montré à l'ouverture
};
const P = { edits: new Map(), timer: 0, saving: false };   // corrections en attente d'envoi
const U = createUndo({ name: 'transcrire' });
const ACTIVE = ['queued', 'running'];

// ── petites aides ───────────────────────────────────────────
const L = (id) => S.cfg?.langs.find((l) => l.id === id)?.name || id;
const M = (id) => S.cfg?.modes.find((m) => m.id === id);
const stub = () => S.cfg?.engine === 'factice';
const plural = (n, w, pl = w + 's') => `${n} ${n > 1 ? pl : w}`;
const clock = (t) => { t = Math.max(0, t || 0); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0'); };
const put = (box, ...kids) => box.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false && k !== ''));
const head = (label, right) => el('div', { class: 'ipan-h' }, el('span', { class: 'lbl' }, label), right ? el('span', { class: 'r' }, right) : null);
const complet = (d = S.doc) => d?.mode === 'complet' && (d.speakers || []).length > 0;
const busy = (d = S.doc) => !!d && (ACTIVE.includes(d.state) || Object.values(d.translations || {}).some((t) => ACTIVE.includes(t.state))
  || Object.values(d.notes || {}).some((n) => ACTIVE.includes(n.state)) || (d.qa || []).some((q) => ACTIVE.includes(q.state)));
const trLang = () => {
  const have = Object.keys(S.doc?.translations || {}).filter((k) => S.doc.translations[k].state === 'done' || S.doc.segments.some((s) => s.tr?.[k]));
  return have.includes(S.to) ? S.to : have[0] || '';
};
const voiceIndex = (spk) => Math.max(0, (S.doc?.speakers || []).findIndex((v) => v.id === spk));
const voiceName = (spk) => (S.doc?.speakers || []).find((v) => v.id === spk)?.name || spk;
const segById = (id) => S.doc?.segments.find((s) => s.id === id);
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  // « traduire en » n'est pas gardé ici : son défaut est la préférence (rien, par défaut — Cal, 30/09)
  save() {
    try { const { lang, mode, cpl, max_s, stamps } = S; localStorage.setItem(KEY, JSON.stringify({ lang, mode, cpl, max_s, stamps, item: S.item?.id })); } catch { /* stockage fermé */ }
  },
};
// les mots horodatés du moteur remis sur les mots du texte (on_text du serveur) : Whisper découpe
// « qu'est-ce » en trois morceaux ; sans concordance (texte corrigé), pas de mots
function motsDe(s) {
  if (!s.words?.length || s.edited) return null;
  const ws = s.words.map(([w, a, b]) => [String(w).trim(), +a, +b]).filter((x) => x[0]);
  const out = [];
  let k = 0;
  for (const tw of String(s.text || '').split(/\s+/).filter(Boolean)) {
    let acc = '', a = null, b = null;
    while (k < ws.length && acc.length < tw.length) { acc += ws[k][0]; a ??= ws[k][1]; b = ws[k][2]; k++; }
    if (acc !== tw) return null;
    out.push({ w: tw, a, b });
  }
  return k === ws.length ? out : null;
}
// une étiquette de voix du carnet ([S1]) devient le nom du moment, teint de sa voix
function avecNoms(text) {
  const parts = String(text || '').split(/\[(S\d{1,2})\]/);
  return parts.map((p, i) => (i % 2 ? el('span', { class: 'who inl', style: { '--c': teinte(voiceIndex(p)) } }, voiceName(p)) : p));
}

// ── le squelette ────────────────────────────────────────────
const fileIn = el('input', { type: 'file', accept: 'audio/*,video/*', hidden: true, onchange: async () => { await addFiles([...fileIn.files]); fileIn.value = ''; } });
function skeleton() {
  $('#rail').replaceChildren(
    el('div', { class: 'row tr-undo' }, el('span', { class: 'lbl' }, 'les réglages'), el('span', { class: 'sp' }),
      el('span', { class: 'sr-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, ...U.buttons())),
    el('section', { class: 'ipan', id: 'p-in' }), el('section', { class: 'ipan', id: 'p-mode' }),
    el('section', { class: 'ipan', id: 'p-lang' }), el('section', { class: 'ipan adv', id: 'p-adv' }),
    el('div', { class: 'act', id: 'act' }), fileIn);
  // le texte à gauche, le carnet à droite (un seul écran, Cal 05/10) ; la frise des voix (complet) dessous
  $('#stage').replaceChildren(el('div', { id: 'banner' }), el('div', { class: 'tr-player', id: 'player' }),
    el('div', { id: 'transport' }), el('div', { class: 'tr-bar', id: 'bar' }), el('div', { class: 'tr-voices', id: 'voices' }),
    el('div', { class: 'tr-splitbox', id: 'splitbox', hidden: true },
      el('div', { class: 'tr-split', id: 'split' },
        el('section', { class: 'tr-col tr-col-l', id: 'col-l', 'aria-label': 'la transcription' },
          el('div', { class: 'tr-col-h', id: 'lines-h' }),
          el('div', { class: 'tr-lines', id: 'lines', role: 'list', 'aria-label': 'les répliques' })),
        el('section', { class: 'tr-col tr-col-r tr-carnet', id: 'carnet', 'aria-label': 'le carnet' }))),
    el('div', { class: 'tr-frise', id: 'frise' }));
  $('#side').replaceChildren(el('p', { class: 'lbl' }, 'chargement'));
  // la poignée entre les deux : glisser, flèches (16 px, Maj 64), double-clic pour revenir à moitié-moitié ;
  // le partage est gardé dans ce navigateur (localStorage « sr-split-transcrire-texte-carnet »)
  const sp = split($('#split'), [{ el: $('#col-l'), grow: 1, min: 300 }, { el: $('#carnet'), grow: 1, min: 300 }],
    { key: 'transcrire-texte-carnet', gutter: 12 });
  sp.gutters[0].setAttribute('aria-label', 'le partage entre la transcription et le carnet');
}

// ── le média ────────────────────────────────────────────────
function paintIn() {
  const box = $('#p-in');
  const it = S.item;
  const row = it ? el('div', { class: 'tr-item' },
    el('div', { class: 'th ' + it.kind, style: it.thumb_url ? { backgroundImage: `url(${href(it.thumb_url)})` } : null },
      el('span', { class: 'k' }, it.kind === 'video' ? 'vidéo' : 'son')),
    el('div', { class: 'tx' }, el('b', {}, it.title || it.id), el('small', {}, [it.kind === 'video' ? 'vidéo' : 'son', fmtDur(it.duration)].filter(Boolean).join(' · '))),
    el('button', { class: 'x', type: 'button', title: 'retirer (reste dans la bibliothèque)', onclick: () => setItem(null) }, '×'))
    : el('div', { class: 'tr-drop-hint' }, el('b', {}, 'Déposez un son ou une vidéo'), el('span', {}, 'ici, ou n’importe où sur la page'));
  put(box, head('Le média', it ? '' : 'son · vidéo'), row,
    el('div', { class: 'row' },
      el('button', { class: 'tb ghost sm', type: 'button', onclick: choose }, 'Bibliothèque'),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => fileIn.click() }, 'Depuis le disque')));
}
async function choose() {
  const got = await pick({ kinds: ['audio', 'video'], title: 'Un son ou une vidéo à transcrire' });
  if (got?.length) setItem(got[0]);
}
async function addFiles(files) {
  const f = files.find((x) => /^(audio|video)\//.test(x.type) || /\.(wav|mp3|flac|m4a|ogg|mp4|webm|mov|m4v)$/i.test(x.name));
  if (!f) { toast('pas pris ici : seuls les sons et les vidéos se transcrivent', 6000); return; }
  toast(`dépôt · ${f.name}`, 60000);
  try { setItem(await uploadFile(f, { tool: 'upload', via: 'transcrire' })); toast('rangé dans la bibliothèque · Upload'); } catch (e) { toast(`${f.name} : ${e.message}`, 7000); }
}
function setItem(it) {
  if (it && !['audio', 'video'].includes(it.kind)) { toast('seuls les sons et les vidéos se transcrivent', 6000); return false; }
  S.item = it; store.save(); paintIn(); paintAct();
  if (it && !S.doc) paintPlayer();
  return true;
}

// le panneau Asset (commun/dock.js, Ctrl+Espace) : poser prend le média, comme un
// dépôt sur « Le média » ; un élément versionné (une chanson d'ODIO) donne sa
// dernière version, comme le fait dropZone (commun/shell.js)
const MEDIA = ['audio', 'video'];
async function lastVersion(it) {
  if (it.kind !== 'element' || !MEDIA.includes(sorteEffective(it)) || !it.element?.head_item) return it;
  try { return await api('library/' + it.element.head_item); } catch { return it; }
}
dock.configure({
  kinds: MEDIA,
  label: 'le média à transcrire',
  placeLabel: 'Transcrire ce média',
  hint: 'double-clic : le média à transcrire · glisser : sur « Le média »',
  place: async (items) => setItem(await lastVersion(items[0])),
});

// ── le mode, les langues, les avancés ───────────────────────
function select(opts, cur, onchange, label) {
  const s = el('select', { class: 'fld', 'aria-label': label, onchange: (e) => onchange(e.target.value) },
    ...opts.map(([v, t]) => el('option', { value: v }, t)));
  s.value = cur;
  return s;
}
function paintMode() {
  put($('#p-mode'), head('Le mode'),
    el('div', { class: 'opts two' }, ...S.cfg.modes.map((m) => el('button', {
      class: 'opt' + (S.mode === m.id ? ' on' : '') + (m.off ? ' off' : ''), type: 'button', 'aria-pressed': String(S.mode === m.id),
      title: m.off || null, onclick: () => { S.mode = m.id; store.save(); paintMode(); paintAdv(); paintAct(); } },
    m.label, el('small', {}, m.about)))));
}
function paintLang() {
  const langs = S.cfg.langs.map((l) => [l.id, l.name]);
  put($('#p-lang'), head('Les langues'),
    el('label', { class: 'fl' }, el('span', { class: 'lbl' }, 'Langue parlée'),
      select([['auto', 'Détecter'], ...langs], S.lang, (v) => { S.lang = v; store.save(); paintAct(); }, 'langue parlée')),
    el('label', { class: 'fl' }, el('span', { class: 'lbl' }, 'Traduire en'),
      select([['', 'Pas de traduction'], ...langs], S.to, (v) => { S.to = v; paintAct(); paintBar(); paintLines(); }, 'traduire en')),
    el('p', { class: 'hint' }, 'Rien par défaut : la transcription seule. Le défaut se règle dans les préférences de Transcrire.'));
}
function paintAdv() {
  const box = $('#p-adv');
  const open = box.querySelector('details')?.open || false;
  const chk = (on, label, set) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: on || null, onchange: (e) => set(e.target.checked) }), el('span', {}, label));
  const C = S.cfg.carnet || {};
  const d = el('details', { class: 'more', open: open || null },
    el('summary', {}, el('span', { class: 'lbl' }, 'Paramètres avancés')),
    el('label', { class: 'fl' }, el('span', { class: 'lbl' }, 'Sous-titres · caractères par ligne'),
      select(S.cfg.cpl.map((n) => [String(n), `${n}`]), String(S.cpl), (v) => { S.cpl = +v; store.save(); }, 'caractères par ligne')),
    el('label', { class: 'fl' }, el('span', { class: 'lbl' }, 'Sous-titres · durée maximale'),
      select(S.cfg.max_s.map((n) => [String(n), `${String(n).replace('.', ',')} s`]), String(S.max_s), (v) => { S.max_s = +v; store.save(); }, 'durée maximale')),
    chk(S.stamps, 'Horodatage dans le texte exporté (TXT)', (v) => { S.stamps = v; store.save(); }),
    el('div', { class: 'engines' }, el('span', { class: 'lbl' }, 'Ce qui tourne derrière'),
      ...S.cfg.modes.map((m) => el('p', { class: 'hint' }, el('b', {}, m.label), ' : ',
        m.asr_list.map((a) => `${a.name}${a.missing?.length ? ' (absent)' : ''}`).join(' puis '),
        m.words ? ', mots horodatés (Whisper : au pas de 20 ms)' : ', un horodatage par réplique',
        m.speakers ? ' · voix : Nemotron (DGX1)' : '', m.mt_name ? ` · traduction : ${m.mt_name}` : '',
        m.off ? el('span', { class: 'reason' }, m.off) : null, m.mt_off ? el('span', { class: 'reason' }, m.mt_off) : null)),
      el('p', { class: 'hint' }, el('b', {}, 'Carnet'), ' : ', stub() ? 'factice (extraits du texte, sans modèle)' : `${C.name} par Ollama, en local`,
        C.off ? el('span', { class: 'reason' }, C.off) : null),
      el('p', { class: 'hint' }, 'Sources, vitesses, licences : ', el('a', { href: href('docs/etudes/transcrire.md'), target: '_blank', rel: 'noopener' }, 'l’étude'), '.')));
  box.replaceChildren(d);
}

// ── l'action ────────────────────────────────────────────────
function paintAct() {
  const m = M(S.mode);
  const why = !S.item ? 'choisissez d’abord un son ou une vidéo'
    : S.item.kind === 'video' && S.item.audio === false ? 'cette vidéo n’a pas de piste son'
      : m?.off ? `${m.label} : ${m.off}`
        : S.to && m?.mt_off ? `traduire : ${m.mt_off}` : '';
  put($('#act'),
    S.item ? el('div', { class: 'sum' }, el('span', {}, el('b', {}, fmtDur(S.item.duration)), ` · ${m?.label.toLowerCase() || ''}`),
      el('span', {}, [S.lang === 'auto' ? 'langue détectée' : L(S.lang), S.to ? `→ ${L(S.to)}` : 'sans traduction'].join(' '))) : null,
    why ? el('div', { class: 'tr-why' }, why) : null,
    el('button', { class: 'tb go block', type: 'button', disabled: !!why || S.sending || null, onclick: launch }, S.sending ? 'Envoi…' : 'Transcrire'),
    stub() ? el('div', { class: 'hint c' }, 'moteur factice : un texte d’essai, horodaté') : null);
}
async function launch() {
  S.sending = true; paintAct();
  try {
    const r = await api('transcrire/run', { method: 'POST', body: { item: S.item.id, lang: S.lang, to: S.to, mode: S.mode, cpl: S.cpl, max_s: S.max_s } });
    openDoc(r.doc);
    loadDocs();
  } catch (e) { toast(e.message, 8000); }
  S.sending = false; paintAct();
}

// ── le document ouvert ──────────────────────────────────────
let pollT = 0;
function openDoc(d, { keepMedia = false } = {}) {
  const same = S.doc?.id === d?.id;
  S.doc = d;
  try { history.replaceState(null, '', location.pathname + location.search + (d ? '#' + d.id : '')); } catch { /* sans historique */ }
  if (!same || !keepMedia) paintPlayer();
  else paintStrip();   // la frise suit les répliques arrivées
  paintBar(); paintVoices(); paintFrise(!same); paintLines(); paintCarnet(); markSide();
  if (S.wantCarnet && d?.state === 'done') { S.wantCarnet = false; requestAnimationFrame(() => showCarnet(false)); }
  clearTimeout(pollT);
  if (busy(d)) pollT = setTimeout(poll, 900);
}
async function poll() {
  if (!S.doc) return;
  const was = S.doc;
  try {
    const d = await api('transcrire/docs/' + was.id);
    if (S.doc?.id !== d.id) return;
    const finished = busy(was) && !busy(d);
    if (P.edits.size || $('.tx[contenteditable="true"]') || document.activeElement?.closest?.('.vcard')) {
      S.doc = { ...d, segments: S.doc.segments, speakers: S.doc.speakers };
      paintCarnet();
    } else openDoc(d, { keepMedia: true });
    if (finished) { loadDocs(); toast(d.state === 'error' ? `échec : ${d.error}` : 'fini'); }
  } catch (e) { toast(e.message); }
  clearTimeout(pollT);
  if (busy(S.doc)) pollT = setTimeout(poll, 900);
}

// ── la lecture ──────────────────────────────────────────────
// LE lecteur du portail (commun/lecteur.js, 30/09) : l'image (ou l'onde du
// son importé), la règle des temps et la tête de lecture du Montage ; les
// répliques sont une piste de sa frise (une teinte par voix), sous l'onde.
const V = { L: null, cap: null, active: null, strip: null, n: 0, F: null, probas: null, wrow: null, wk: -2 };
function paintPlayer() {
  V.L?.detruire();
  const box = $('#player');
  const it = S.doc ? { id: S.doc.item, kind: S.doc.kind, title: S.doc.title, url: null } : S.item;
  V.L = null; V.active = null; V.strip = null;
  const n = ++V.n;
  if (!it) {
    box.className = 'tr-player empty';
    box.replaceChildren(el('div', { class: 'empty' }, el('b', {}, 'Transcrire'),
      el('span', {}, 'Un son ou une vidéo, le mode, puis « Transcrire ».')));
    $('#transport').replaceChildren();
    return;
  }
  box.className = 'tr-player lect ' + it.kind;
  box.replaceChildren(el('p', { class: 'lbl tr-wait-media' }, 'chargement du média'));
  // l'objet entier (adresse, cadence, copies d'affichage) vient de la bibliothèque
  (it.url ? Promise.resolve(it) : api('library/' + it.id)).then((full) => {
    if (n !== V.n) return;
    V.cap = el('div', { class: 'cap', 'aria-live': 'off' });
    const Lc = lecteur(full, { clavier: 'page', sur: full.kind === 'video' ? V.cap : null, onTemps: tick });
    V.L = Lc;
    V.strip = Lc.piste(el('div', { class: 'tr-strip', title: 'les répliques · clic, glisser : la tête de lecture' }));
    // replaceChildren(null) écrirait « null » : on ne passe que des nœuds
    box.replaceChildren(...(full.kind === 'audio' ? [el('div', { class: 'aud' }, el('span', { class: 'lbl' }, 'son'), el('b', {}, full.title || ''), V.cap)] : []), Lc.el);
    Lc.media.addEventListener('loadedmetadata', paintStrip);
    paintStrip();
  }).catch(() => { if (n === V.n) box.replaceChildren(el('p', { class: 'warn' }, 'le média a quitté la bibliothèque')); });
  $('#transport').replaceChildren(el('div', { class: 'transport tr-nav' }, el('span', { class: 'lbl' }, 'répliques'),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'réplique précédente (↑)', onclick: () => step(-1) }, '‹'),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'réplique suivante (↓)', onclick: () => step(1) }, '›')));
}
function seek(t, play = true) { const Lc = V.L; if (!Lc) return; Lc.seek(Math.max(0, t)); if (play && !Lc.lecture) Lc.play(); }
const dur = () => V.L?.duree || S.doc?.duration || S.item?.duration || 0;
function paintStrip() {
  if (!V.strip) return;
  const d = dur();
  const segs = S.doc?.segments || [];
  V.strip.replaceChildren(...(d ? segs.map((s) => el('span', { class: 'sg', 'data-id': s.id, style: { left: `${(s.a / d) * 100}%`, width: `${Math.max(0.15, ((s.b - s.a) / d) * 100)}%`, '--c': s.spk ? teinte(voiceIndex(s.spk)) : null } })) : []));
  V.active = undefined;
  tick(V.L?.t || 0, V.L?.lecture);
}
function segAt(t) {
  const segs = S.doc?.segments || [];
  let lo = 0, hi = segs.length - 1, hit = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (segs[mid].a <= t) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
  return hit !== null && t < segs[hit].b + 0.25 ? segs[hit] : null;
}
// le lecteur dit où est la tête (à chaque image en lecture, à chaque geste) : la réplique, le mot, le sous-titre, la frise
function tick(t = V.L?.t || 0, playing = false) {
  if (!V.L) return;
  V.F?.temps(t, playing);
  const s = segAt(t);
  if (s?.id !== V.active) {
    V.active = s?.id || null;
    $$('#lines .ln.on').forEach((x) => x.classList.remove('on'));
    $$('#player .tr-strip .sg.on').forEach((x) => x.classList.remove('on'));
    if (s) {
      const row = $(`#lines .ln[data-id="${s.id}"]`);
      row?.classList.add('on');
      V.strip?.querySelector(`.sg[data-id="${s.id}"]`)?.classList.add('on');
      if (row && S.follow && !$('.tx[contenteditable="true"]') && playing) scrollInto(row);
    }
    paintCap(s);
  }
  paintWords(t);
}
// le mot qu'on entend, dans la réplique lue (mode complet) : les mots dits pâlissent, le mot dit maintenant se souligne
function paintWords(t) {
  const row = V.active ? $(`#lines .ln[data-id="${V.active}"] .tx[data-f="src"]:not([contenteditable="true"])`) : null;
  if (row !== V.wrow) { V.wrow?.querySelectorAll('.w').forEach((x) => x.classList.remove('dit', 'ici')); V.wrow = row; V.wk = -2; }
  if (!row) return;
  const spans = row.querySelectorAll('.w');
  let k = -1;
  for (let i = 0; i < spans.length; i++) { if (+spans[i].dataset.a <= t) k = i; else break; }
  const now = k >= 0 && t < +spans[k].dataset.b + 0.12 ? k : -1;
  const key = k * 2 + (now >= 0 ? 1 : 0);
  if (key === V.wk) return;
  V.wk = key;
  spans.forEach((x, i) => { x.classList.toggle('dit', i < k || (i === k && now < 0)); x.classList.toggle('ici', i === now); });
}
function scrollInto(row) {
  const box = $('#lines');
  const r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
  if (r.top < b.top + 8 || r.bottom > b.bottom - 8) box.scrollTop += r.top - b.top - b.height / 3;
}
function paintCap(s) {
  if (!V.cap) return;
  const tl = trLang();
  const src = s && S.view !== 'tr' ? s.text : '', tr = s && S.view !== 'src' && tl ? s.tr?.[tl] || '' : '';
  put(V.cap, src ? el('span', { class: 'o' }, src) : null, tr ? el('span', { class: 't' }, tr) : null);
}
function step(n) {
  const segs = S.doc?.segments || [];
  if (!segs.length || !V.L) return;
  const t = V.L.t || 0;
  const k = n > 0 ? segs.findIndex((s) => s.a > t + 0.05) : segs.map((s) => s.a < t - 0.6).lastIndexOf(true);
  const s = segs[k < 0 ? (n > 0 ? segs.length - 1 : 0) : k];
  seek(s.a, V.L.lecture);
}
const seekSeg = (id) => { const s = segById(id); if (s) seek(s.a, true); };

// ── la barre du texte ───────────────────────────────────────
function paintBar() {
  const box = $('#bar');
  const d = S.doc;
  if (!d) { box.replaceChildren(); return; }
  const tl = trLang();
  const views = [['src', 'Original'], ['tr', 'Traduction'], ['both', 'Les deux']];
  const tr = d.translations?.[S.to];
  const canTranslate = d.state === 'done' && S.to && S.to !== d.detected && !ACTIVE.includes(tr?.state);
  const stale = S.to && d.stale?.[S.to];
  const trBtn = canTranslate && (!tr || tr.state === 'error' || stale)
    ? el('button', { class: 'tb ghost sm', type: 'button', title: stale ? 'les répliques corrigées depuis la traduction' : '', onclick: () => translate(S.to) },
      tr && stale ? `Retraduire ${plural(stale, 'réplique')}` : `Traduire en ${L(S.to).toLowerCase()}`) : null;
  put(box,
    el('div', { class: 'ttl' }, el('span', { class: 'lbl' }, 'transcription'), el('b', {}, d.title || d.id),
      el('span', { class: 'lbl meta' }, [d.mode === 'complet' ? 'complet' : 'rapide', d.detected ? L(d.detected) : d.lang === 'auto' ? 'langue à détecter' : L(d.lang), tl ? `→ ${L(tl)}` : '',
        d.segments?.length ? plural(d.segments.length, 'réplique') : '', d.engine?.backend === 'factice' ? 'factice' : ''].filter(Boolean).join(' · '))),
    el('span', { class: 'sp' }),
    tl ? el('div', { class: 'seg' }, ...views.map(([v, lab]) => el('button', { class: 'tb' + (S.view === v ? ' on' : ''), type: 'button', onclick: () => setView(v) }, lab))) : null,
    trBtn,
    d.state === 'done' ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => copyText() }, 'Copier le texte') : null,
    d.state === 'done' ? el('button', { class: 'tb ghost sm', type: 'button', 'aria-haspopup': 'menu', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom + 4, exportItems(), { focusFirst: e.detail === 0 }); } }, 'Exporter') : null);
}
// le carnet montré (le panneau de droite, ou sous le texte quand ils s'empilent) ; `ask` : la question prend la main
function showCarnet(ask = true) {
  const box = $('#carnet');
  if (!box || $('#splitbox').hidden) return;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (ask) box.querySelector('.cn-ask input')?.focus({ preventScroll: true });
}
function setView(v) { S.view = v; prefs.set('transcrire.view', v); paintBar(); paintLines(); paintCap(segAt(V.L?.t || 0)); }
async function translate(to, all = false) {
  try { const r = await api(`transcrire/docs/${S.doc.id}/translate`, { method: 'POST', body: { to, all } }); openDoc(r.doc, { keepMedia: true }); toast(`traduction en ${L(to).toLowerCase()} en file`); }
  catch (e) { toast(e.message, 7000); }
}
// une adresse de l'API prise hors d'api() (un lien de téléchargement, un fetch) : elle porte le Workspace (avecEspace)
const exportUrl = (fmt, which) => avecEspace(href(`api/transcrire/docs/${S.doc.id}/export?format=${fmt}&which=${which}${fmt === 'txt' && S.stamps ? '&stamps=1' : ''}`));
function download(fmt, which) { const a = el('a', { href: exportUrl(fmt, which), download: '' }); document.body.append(a); a.click(); a.remove(); }
function exportItems() {
  const d = S.doc;
  const src = d.detected ? L(d.detected).toLowerCase() : 'original';
  const trs = Object.keys(d.translations || {}).filter((k) => d.segments.some((s) => s.tr?.[k]));
  const block = (which, name) => [{ head: name },
    { label: 'Sous-titres SRT', icon: '↓', onclick: () => download('srt', which) },
    { label: 'Sous-titres VTT', icon: '↓', onclick: () => download('vtt', which) },
    { label: 'Texte TXT', icon: '↓', onclick: () => download('txt', which) },
    { label: 'Mots horodatés JSON', icon: '↓', sub: d.mode === 'complet' && which === 'src' ? 'temps du moteur' : 'temps au prorata', onclick: () => download('json', which) }];
  return [{ head: 'compte rendu' }, { label: 'Compte rendu Markdown', icon: '↓', sub: 'carnet + transcription', onclick: () => download('md', 'src') }, '-',
    ...block('src', `original · ${src}`), ...trs.flatMap((k) => ['-', ...block(k, `traduction · ${L(k).toLowerCase()}`)]), '-',
    { label: 'Ranger les sous-titres dans Asset', icon: '▦', disabled: !S.cfg.asset, why: S.cfg.asset_why, onclick: toAsset },
    montageItem(d)];
}
// le média de la transcription dans le Montage : montage/?add=<id> le pose au bout de la piste de la
// séquence ouverte (sinon une séquence à ses réglages) et l'inscrit dans le Projet (montage.js, start ;
// server/tools/montage.py, r_create). Un compte Apps n'a pas le Montage : rien à proposer.
function montageItem(d) {
  if (!S.studio || !d?.item) return null;
  return { label: `Envoyer ${d.kind === 'video' ? 'la vidéo' : 'le son'} au Montage`, icon: '▤',
    onclick: () => { location.href = href(`montage/?add=${encodeURIComponent(d.item)}`); } };
}
async function toAsset() {
  try { const it = await api(`transcrire/docs/${S.doc.id}/asset`, { method: 'POST', body: { format: 'srt', which: S.view === 'tr' && trLang() ? trLang() : 'src' } }); toast(`rangé dans Asset : ${it.title}`); }
  catch (e) { toast(e.message, 8000); }
}
async function copyText(which = S.view === 'tr' && trLang() ? trLang() : 'src') {
  try {
    const r = await fetch(exportUrl('txt', which));
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    copy(await r.text(), which === 'src' ? 'texte copié' : `traduction (${L(which).toLowerCase()}) copiée`);
  } catch (e) { toast(e.message); }
}

// ── les voix : LE seul endroit où l'on renomme ─────────────
function paintVoices() {
  const box = $('#voices');
  const d = S.doc;
  const vs = d?.state === 'done' ? d.speakers || [] : [];
  if (!vs.length) { box.replaceChildren(); return; }
  const talk = Object.fromEntries(vs.map((v) => [v.id, [0, 0]]));
  for (const s of d.segments) if (talk[s.spk]) { talk[s.spk][0] += s.b - s.a; talk[s.spk][1]++; }
  box.replaceChildren(el('div', { class: 'tr-voices-h' }, el('span', { class: 'lbl' }, 'les voix'),
    el('span', { class: 'hint' }, 'un nom tapé ici se pose partout : répliques, frise, carnet, exports')),
  el('div', { class: 'tr-vcards' }, ...vs.map((v, i) => {
    const inp = el('input', { class: 'fld', value: v.name, maxlength: '40', 'aria-label': `nom de la voix ${i + 1}`, spellcheck: 'false' });
    const commit = () => { const t = inp.value.replace(/\s+/g, ' ').trim(); if (!t) { inp.value = v.name; return; } renameVoice(v.id, v.name, t); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } else if (e.key === 'Escape') { inp.value = v.name; inp.blur(); } });
    inp.addEventListener('change', commit);
    const [secs, n] = talk[v.id];
    return el('div', { class: 'vcard', style: { '--c': teinte(i) }, 'data-spk': v.id },
      el('i'), inp, el('small', {}, `${clock(secs)} · ${plural(n, 'réplique')}`));
  })));
}
function renameVoice(id, before, after) {
  if (!after || after === before) return;
  const apply = (name) => {
    const v = S.doc.speakers.find((x) => x.id === id); if (v) v.name = name;
    queue({ speaker: { id, name } });
    const inp = $(`#voices .vcard[data-spk="${id}"] input`);
    if (inp && document.activeElement !== inp) inp.value = name;
    paintLines(); paintCarnet(); V.F && paintFrise(false);
  };
  apply(after);
  U.record({ label: `renommer la voix « ${before} »`, undo: () => apply(before), redo: () => apply(after) });
}

// ── la frise des voix (complet) : commun/voix.js, le dessin de la diarisation de Movie Analysis ──
async function paintFrise(fresh) {
  const box = $('#frise');
  const d = S.doc;
  if (!d || d.state !== 'done' || !complet(d)) { box.hidden = true; return; }
  box.hidden = false;
  if (!V.F) { V.F = friseVoix({ onSeek: (t) => seek(t, false), cle: 'transcrire' }); box.replaceChildren(V.F.el); }
  if (fresh || V.probas?.id !== d.id) {
    V.probas = { id: d.id, data: null };
    if (d.voix) { try { V.probas.data = await api(`transcrire/docs/${d.id}/voix`); } catch { V.probas.data = null; } }
    if (S.doc?.id !== d.id) return;
  }
  V.F.donner({
    duree: dur() || d.duration,
    voix: d.speakers.map((v, i) => ({ id: v.id, nom: v.name, col: i, idx: parseInt(v.id.slice(1), 10) - 1 })),
    probas: V.probas.data,
    lignes: d.segments.filter((s) => s.spk).map((s) => ({ id: s.id, a: s.a, b: s.b, voix: s.spk, texte: s.text, mots: motsDe(s) })),
  });
  V.F.temps(V.L?.t || 0);
}

// ── les répliques ───────────────────────────────────────────
function paintLines() {
  const box = $('#lines');
  const d = S.doc;
  $('#splitbox').hidden = !d;
  paintLinesHead();
  if (!d) { box.replaceChildren(); return; }
  if (d.state !== 'done') {
    const lv = d.live || {};
    const p = lv.progress;
    box.replaceChildren(el('div', { class: 'tr-wait' + (d.state === 'error' ? ' err' : '') },
      el('b', {}, d.state === 'error' ? 'Échec' : d.state === 'queued' ? 'En file' : 'Transcription'),
      el('span', {}, d.state === 'error' ? d.error || '' : lv.message || (lv.position ? `${lv.position} devant` : 'en attente de la machine')),
      d.state !== 'error' ? el('div', { class: 'bar' }, el('i', { style: { width: p != null ? `${Math.round(p * 100)}%` : '100%', opacity: p != null ? 1 : 0.35 } })) : null));
    return;
  }
  const tl = trLang();
  const tr = d.translations?.[tl] || {};
  const showSrc = S.view !== 'tr' || !tl, showTr = S.view !== 'src' && tl;
  const voices = (d.speakers || []).length > 0;
  const pending = ACTIVE.includes(tr.state);
  const scroll = box.scrollTop;
  box.classList.toggle('sans-voix', !voices);
  put(box,
    pending ? el('div', { class: 'tr-wait slim' }, el('b', {}, `traduction · ${L(tl).toLowerCase()}`), el('span', {}, tr.live?.message || 'en file'),
      el('div', { class: 'bar' }, el('i', { style: { width: tr.live?.progress != null ? `${Math.round(tr.live.progress * 100)}%` : '100%' } }))) : null,
    d.segments.length ? null : el('p', { class: 'hint c' }, 'Aucune parole trouvée dans ce média.'),
    ...d.segments.map((s, i) => {
      const prev = d.segments[i - 1];
      const ws = d.mode === 'complet' ? motsDe(s) : null;
      const src = el('div', { class: 'tx', 'data-f': 'src', tabindex: '0' },
        ...(ws ? ws.flatMap((w, k) => [k ? ' ' : null, el('span', { class: 'w', 'data-a': w.a, 'data-b': w.b }, w.w)]) : [s.text]));
      return el('div', { class: 'ln' + (V.active === s.id ? ' on' : ''), 'data-id': s.id, role: 'listitem' },
        el('button', { class: 'tc', type: 'button', title: 'aller à ce moment', tabindex: '-1' }, clock(s.a)),
        voices ? (s.spk && s.spk !== prev?.spk ? el('span', { class: 'who', style: { '--c': teinte(voiceIndex(s.spk)) } }, voiceName(s.spk)) : el('span', { class: 'who none' })) : null,
        el('div', { class: 'txs' },
          showSrc ? src : null,
          showTr ? el('div', { class: 'tx tr' + (s.tr?.[tl] ? '' : ' miss') + (isStale(s, tl) ? ' stale' : ''), 'data-f': tl, tabindex: '0',
            title: isStale(s, tl) ? 'la réplique a été corrigée depuis : à retraduire' : null }, s.tr?.[tl] || (pending ? '…' : '')) : null));
    }));
  box.scrollTop = scroll;
  V.wrow = null; V.wk = -2;
}
// l'en-tête de la colonne du texte : ce qu'elle tient, et ses gestes
function paintLinesHead() {
  const d = S.doc;
  const n = d?.state === 'done' ? d.segments.length : 0;
  const about = d?.state === 'done' ? 'clic : y aller · double-clic ou Entrée : corriger · ↑ ↓ : réplique précédente, suivante' : 'le texte arrive ici, horodaté';
  put($('#lines-h'), el('div', { class: 'cn-about' }, el('b', {}, 'La transcription'), el('span', { title: about }, about)),
    n ? el('span', { class: 'cn-st' }, plural(n, 'réplique')) : null);
}
// le serveur dit quelles répliques ont changé depuis leur traduction (stale_ids)
function isStale(s, tl) { return !!(tl && s.tr?.[tl] && S.doc?.stale_ids?.[tl]?.includes(s.id)); }
function wireLines() {
  const box = $('#lines');
  box.addEventListener('click', (e) => {
    const row = e.target.closest('.ln');
    if (!row || e.target.closest('[contenteditable="true"]')) return;
    const w = e.target.closest('.w');   // un mot : son instant
    if (w) { seek(+w.dataset.a, true); return; }
    const s = segById(row.dataset.id);
    if (s) seek(s.a, true);
  });
  box.addEventListener('dblclick', (e) => { const tx = e.target.closest('.tx'); if (tx) startEdit(tx); });
  box.addEventListener('keydown', (e) => { const tx = e.target.closest('.tx'); if (tx && e.key === 'Enter' && tx.contentEditable !== 'true') { e.preventDefault(); startEdit(tx); } });
}
function startEdit(tx) {
  const row = tx.closest('.ln');
  const s = segById(row.dataset.id);
  const f = tx.dataset.f;
  const before = f === 'src' ? s.text : s.tr?.[f] || '';
  V.L?.pause();
  if (f === 'src') tx.textContent = before;   // les mots redeviennent du texte le temps de la correction
  editText(tx, before, (after) => setField(s.id, f, before, after, true));
}
// un champ édité sur place : Entrée garde, Échap rend, sortir garde
function editText(node, before, done) {
  if (node.contentEditable === 'true') return;
  node.contentEditable = 'true';
  node.classList.add('editing');
  node.focus();
  const sel = getSelection(); sel.selectAllChildren(node); sel.collapseToEnd();
  let over = false;
  const end = (keep) => {
    if (over) return; over = true;
    node.contentEditable = 'false'; node.classList.remove('editing');
    const after = node.textContent.replace(/\s+/g, ' ').trim();
    if (!keep) { node.textContent = before; paintLines(); }
    else done(after);
  };
  node.addEventListener('keydown', function k(e) {
    if (e.key === 'Enter') { e.preventDefault(); node.removeEventListener('keydown', k); end(true); node.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); node.removeEventListener('keydown', k); end(false); }
  });
  node.addEventListener('blur', () => end(true), { once: true });
}
function setField(id, f, before, after, record) {
  if (after === before || (f === 'src' && !after)) { paintLines(); return; }
  const apply = (v) => {
    const s = segById(id);
    if (!s) return;
    if (f === 'src') { s.text = v; s.edited = true; } else { (s.tr ||= {})[f] = v; }
    queue({ seg: { id, f, v } });
    paintLines(); paintCap(segAt(V.L?.t || 0));
    if (f === 'src') paintFrise(false);
  };
  apply(after);
  if (record) U.record({ label: `corriger la réplique ${clock(segById(id)?.a)}`, undo: () => apply(before), redo: () => apply(after) });
}

// ── le carnet (à la NotebookLM) : la colonne de droite ─────
// Une réplique citée : un bouton à son temps (un saut), ses mots en survol.
const said = (s) => { const t = String(s.text || ''); return t.length > 140 ? t.slice(0, 139) + '…' : t; };
const refChips = (refs) => (refs || []).map(segById).filter(Boolean).map((s) => el('button', { class: 'ref', type: 'button',
  title: `aller à ${clock(s.a)} · « ${said(s)} »`, onclick: () => seekSeg(s.id) }, clock(s.a)));
// Les répliques qui fondent une réponse, telles quelles : leur temps, leur voix, leurs mots. La citation est
// juste par construction : le modèle ne choisit que des numéros de répliques (le schéma les borne), le texte
// et le temps viennent du document.
const QUOTES = 4;
function quotes(refs) {
  const ss = (refs || []).map(segById).filter(Boolean);
  if (!ss.length) return null;
  return el('div', { class: 'cn-quotes' }, ...ss.slice(0, QUOTES).map((s) => el('button', { class: 'cn-quote', type: 'button',
    title: 'aller à cette réplique', onclick: () => seekSeg(s.id) },
  el('span', { class: 'ref' }, clock(s.a)),
  s.spk ? el('span', { class: 'who', style: { '--c': teinte(voiceIndex(s.spk)) } }, voiceName(s.spk)) : null,
  el('span', { class: 'q' }, `« ${said(s)} »`))),
  ss.length > QUOTES ? el('div', { class: 'cn-refs' }, ...refChips(ss.slice(QUOTES).map((s) => s.id))) : null);
}
// ce sur quoi repose une réponse (server/tools/transcrire.py, QA_BASIS) ; une réponse d'avant le 05/10 n'a que « found »
const BASIS = { said: ['dit dans le texte', ''], inferred: ['déduit du texte', ' inf'], not_said: ['le texte ne le dit pas', ' nf'] };
const basisOf = (q) => (BASIS[q.basis] ? q.basis : q.found === false ? 'not_said' : 'said');
function noteState(n) {
  if (!n) return null;
  if (ACTIVE.includes(n.state)) return el('span', { class: 'cn-st run' }, n.live?.message || (n.state === 'queued' ? 'en file' : 'en cours'));
  if (n.state === 'error') return el('span', { class: 'cn-st err' }, n.error || 'échec');
  if (n.stale) return el('span', { class: 'cn-st old', title: 'des répliques ont été corrigées depuis' }, 'le texte a changé depuis');
  return el('span', { class: 'cn-st' }, [n.model === 'factice' ? 'factice' : n.model, n.at ? fmtDate(n.at) : ''].filter(Boolean).join(' · '));
}
async function notes(kinds) {
  try { const r = await api(`transcrire/docs/${S.doc.id}/notes`, { method: 'POST', body: { kinds } }); openDoc(r.doc, { keepMedia: true }); }
  catch (e) { toast(e.message, 8000); }
}
async function ask(q) {
  try { const r = await api(`transcrire/docs/${S.doc.id}/notes`, { method: 'POST', body: { question: q } }); openDoc(r.doc, { keepMedia: true }); return true; }
  catch (e) { toast(e.message, 8000); return false; }
}
async function forget(qid) {
  try { openDoc(await api(`transcrire/docs/${S.doc.id}/qa/${qid}/delete`, { method: 'POST' }), { keepMedia: true }); } catch (e) { toast(e.message, 7000); }
}
// Le carnet se montre dès qu'une transcription est ouverte, à côté du texte : tant que le texte n'est pas
// fini, ses cartes disent ce qu'elles feront et attendent (Cal, 05/10 : « les gens ne voient pas le carnet »).
function paintCarnet() {
  const box = $('#carnet');
  const d = S.doc;
  if (!d) { box.replaceChildren(); return; }
  const C = S.cfg.carnet || {};
  const ready = d.state === 'done';
  const off = C.off || (ready && !d.segments.length ? 'aucune parole dans ce texte : rien à résumer' : '');
  const wait = !ready ? (d.state === 'error' ? 'La transcription a échoué : pas de carnet.' : 'Le carnet s’écrit à partir du texte : il attend la fin de la transcription.') : '';
  const block = off || wait;
  const nt = d.notes || {};
  const card = (k, body, empty) => {
    const n = nt[k], run = ACTIVE.includes(n?.state);
    return el('section', { class: 'cn-card', 'data-k': k },
      el('div', { class: 'cn-card-h' }, el('span', { class: 'lbl' }, C.kinds?.find((x) => x.id === k)?.label || k), noteState(n), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', type: 'button', disabled: run || !!block || null, title: block || (run ? 'en cours' : null), onclick: () => notes([k]) },
          n?.state === 'done' || n?.state === 'error' ? 'Refaire' : 'Écrire')),
      n?.state === 'done' ? body(n.data || {}) : el('p', { class: 'hint' }, run ? '…' : empty));
  };
  const list = (items, who = false) => el('ul', { class: 'cn-list' }, ...items.map((x) => el('li', {},
    el('span', { class: 'cn-t' }, ...avecNoms(x.text), who && x.who ? el('span', { class: 'cn-who' }, ' → ', ...avecNoms(x.who)) : null), ...refChips(x.refs))));
  const all = Object.keys(CARNET_KINDS());
  const anyRun = all.some((k) => ACTIVE.includes(nt[k]?.state));
  // la question en cours de frappe survit à un nouveau dessin (une réponse qui arrive)
  const was = box.querySelector('.cn-ask input');
  const inp = el('input', { class: 'fld', type: 'text', maxlength: String(C.q_max || 500), placeholder: 'Une question sur ce qui a été dit…', 'aria-label': 'une question sur le texte',
    value: was?.value || null, disabled: !!block || null, title: block || null });
  if (was && document.activeElement === was) requestAnimationFrame(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); });
  const send = async () => { const q = inp.value.trim(); if (!q) return; inp.disabled = true; if (await ask(q)) inp.value = ''; inp.disabled = false; };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  const scroll = box.scrollTop;
  const about = `résumé, questions, points clés, chapitres : tirés du seul texte, chaque élément renvoie à ses répliques · ${stub() ? 'factice, sans modèle' : `${C.name}, en local`}`;
  put(box,
    el('div', { class: 'cn-head' },
      el('div', { class: 'cn-about' }, el('b', {}, 'Le carnet'), el('span', { title: about },
        about)),
      el('button', { class: 'tb ghost sm', type: 'button', disabled: anyRun || !!block || null, title: block || null,
        onclick: () => notes(all) }, all.every((k) => nt[k]?.state === 'done') ? 'Tout refaire' : 'Tout préparer')),
    off ? el('div', { class: 'reason' }, off) : wait ? el('p', { class: 'hint cn-wait' }, wait) : null,
    el('div', { class: 'cn-grid' },
      card('resume', (x) => el('div', { class: 'cn-body' }, el('p', { class: 'cn-p' }, ...avecNoms(x.text)), el('div', { class: 'cn-refs' }, ...refChips(x.refs))),
        'L’essentiel en quelques phrases : « Écrire ».'),
      el('section', { class: 'cn-card cn-qa', 'data-k': 'qa' },
        el('div', { class: 'cn-card-h' }, el('span', { class: 'lbl' }, 'Questions'), el('span', { class: 'cn-st' }, 'la réponse ne vient que du texte'), el('span', { class: 'sp' })),
        el('div', { class: 'cn-ask' }, inp, el('button', { class: 'tb ghost sm', type: 'button', disabled: !!block || null, title: block || null, onclick: send }, 'Demander')),
        (d.qa || []).length ? el('div', { class: 'cn-qas' }, ...[...d.qa].reverse().map((q) => {
          const b = q.state === 'done' ? basisOf(q) : null;
          return el('div', { class: 'cn-q' + (b ? BASIS[b][1] : '') },
            el('div', { class: 'cn-qq' }, el('b', {}, q.q), noteState(q), el('span', { class: 'sp' }),
              el('button', { class: 'x', type: 'button', title: 'retirer la question', onclick: () => forget(q.id) }, '×')),
            b ? el('div', { class: 'cn-qa-a' }, el('span', { class: 'cn-basis' }, BASIS[b][0]), el('p', { class: 'cn-p' }, ...avecNoms(q.text)), quotes(q.refs)) : null);
        }))
          : el('p', { class: 'hint' }, 'Demandez ce qui a été dit, décidé, par qui : la réponse parle des voix à la troisième personne, cite ses répliques, ou dit que le texte n’en parle pas.')),
      card('points', (x) => el('div', { class: 'cn-body' },
        ...[['points', 'Points clés'], ['decisions', 'Décisions'], ['actions', 'Actions']].map(([k, lab]) => el('div', { class: 'cn-sub' },
          el('span', { class: 'lbl' }, lab), (x[k] || []).length ? list(x[k], k === 'actions') : el('p', { class: 'hint' }, k === 'points' ? 'Aucun.' : 'Aucune dite dans le texte.')))),
        'Points clés, décisions, actions — pour une réunion.'),
      card('chapitres', (x) => (x.chapitres || []).length ? el('ol', { class: 'cn-chap' }, ...x.chapitres.map((c) => el('li', {},
        el('button', { class: 'ref', type: 'button', onclick: () => seek(c.a, true) }, clock(c.a)),
        el('div', {}, el('b', {}, ...avecNoms(c.title)), el('span', {}, ...avecNoms(c.text)))))) : el('p', { class: 'hint' }, 'Aucun chapitre.'),
        'Les parties du texte, chacune à son instant.')));
  box.scrollTop = scroll;
}
const CARNET_KINDS = () => Object.fromEntries((S.cfg.carnet?.kinds || []).map((k) => [k.id, k]));

// ── l'enregistrement des corrections ────────────────────────
function queue({ seg, speaker }) {
  const e = P.edits;
  if (seg) { const cur = e.get(seg.id) || { id: seg.id }; if (seg.f === 'src') cur.text = seg.v; else (cur.tr ||= {})[seg.f] = seg.v; e.set(seg.id, cur); }
  if (speaker) e.set('voice:' + speaker.id, { voice: speaker });
  clearTimeout(P.timer); P.timer = setTimeout(flush, 450);
}
async function flush() {
  if (P.saving || !P.edits.size || !S.doc) return;
  P.saving = true;
  const batch = [...P.edits.values()];
  P.edits.clear();
  const body = { rev: S.doc.rev, segments: batch.filter((x) => x.id), speakers: batch.filter((x) => x.voice).map((x) => x.voice) };
  const id = S.doc.id;
  try {
    let d;
    try { d = await api(`transcrire/docs/${id}`, { method: 'POST', body }); }
    catch (e) {
      if (e.status !== 409) throw e;
      const fresh = await api(`transcrire/docs/${id}`);   // changé ailleurs : les mêmes corrections, sur la version d'aujourd'hui
      d = await api(`transcrire/docs/${id}`, { method: 'POST', body: { ...body, rev: fresh.rev } });
    }
    if (S.doc?.id === id) {
      const editing = $('.tx[contenteditable="true"]');
      S.doc = { ...d, segments: P.edits.size || editing ? S.doc.segments : d.segments };
      S.doc.rev = d.rev;
      if (!editing && !P.edits.size) { paintBar(); paintLines(); paintCarnet(); }
    }
  } catch (e) { toast(`correction non enregistrée : ${e.message}`, 8000); }
  P.saving = false;
  if (P.edits.size) flush();
}

// ── mes transcriptions ──────────────────────────────────────
async function loadDocs() {
  try { S.docs = (await api('transcrire/docs')).docs; } catch (e) { $('#side').replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
  const side = $('#side');
  side.replaceChildren(el('div', { class: 'ipan-h hist-h' }, el('span', { class: 'lbl' }, 'Mes transcriptions'), el('span', { class: 'r' }, String(S.docs.length))),
    S.docs.length ? el('div', { class: 'tr-docs' }, ...S.docs.map(docRow)) : el('p', { class: 'hint' }, 'Chaque transcription se range ici, avec ses traductions et son carnet.'));
  markSide();
}
function docRow(x) {
  const st = x.live?.state || x.state;
  return el('div', { class: 'drow', role: 'button', tabindex: '0', 'data-id': x.id, onclick: () => openById(x.id),
    onkeydown: (e) => { if (e.key === 'Enter') openById(x.id); } },
  el('div', { class: 'th ' + (x.kind || ''), style: x.thumb_url ? { backgroundImage: `url(${href(x.thumb_url)})` } : null }),
  el('div', { class: 'tx' }, el('b', {}, x.title || x.id),
    el('small', {}, [fmtDur(x.duration), x.mode === 'complet' ? 'complet' : 'rapide', [x.detected ? x.detected.toUpperCase() : '', ...(x.to || []).map((k) => k.toUpperCase())].filter(Boolean).join(' → '),
      st === 'done' ? fmtDate(x.created) : st === 'error' ? 'échec' : st === 'running' ? 'en cours' : 'en file'].filter(Boolean).join(' · '))));
}
function markSide() { $$('#side .drow').forEach((r) => r.classList.toggle('on', r.dataset.id === S.doc?.id)); }
async function openById(id) {
  if (P.edits.size) await flush();
  try {
    const d = await api('transcrire/docs/' + id);
    openDoc(d);
    // son média dans le rail : relancer avec d'autres réglages
    if (S.item?.id !== d.item) { try { S.item = await api('library/' + d.item); store.save(); paintIn(); paintAct(); } catch { /* parti */ } }
  } catch (e) { toast(e.message); }
}
async function removeDoc(id) {
  const x = S.docs.find((d) => d.id === id);
  if (!confirm(`Mettre « ${x?.title || id} » à la corbeille de Transcrire ? Le média reste dans la bibliothèque.`)) return;
  try { await api(`transcrire/docs/${id}/delete`, { method: 'POST' }); if (S.doc?.id === id) openDoc(null); loadDocs(); toast('à la corbeille'); } catch (e) { toast(e.message, 7000); }
}

// ── le clavier, le clic droit ───────────────────────────────
document.addEventListener('keydown', (e) => {
  if ($('.scrim') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
  // Espace, J K L, ← →, Début, Fin : le lecteur (commun/lecteur.js, le clavier du Montage) ; ↑ ↓ : les répliques
  if (e.key === 'ArrowDown' && S.doc?.segments?.length) { e.preventDefault(); step(1); }
  else if (e.key === 'ArrowUp' && S.doc?.segments?.length) { e.preventDefault(); step(-1); }
});
function linesMenu(e) {
  const row = e.target.closest('.ln');
  if (row && S.doc) {
    const s = segById(row.dataset.id);
    const tl = trLang();
    return [{ head: `réplique · ${clock(s.a)}` },
      { label: 'Aller à ce moment', icon: '▶', onclick: () => seek(s.a, true) },
      { label: 'Corriger le texte', icon: '✎', key: 'Entrée', onclick: () => { const tx = row.querySelector('.tx[data-f="src"]'); if (tx) startEdit(tx); else { setView('both'); startEdit($(`#lines .ln[data-id="${s.id}"] .tx[data-f="src"]`)); } } },
      tl ? { label: 'Corriger la traduction', icon: '✎', onclick: () => { let tx = row.querySelector(`.tx[data-f="${tl}"]`); if (!tx) { setView('both'); tx = $(`#lines .ln[data-id="${s.id}"] .tx[data-f="${tl}"]`); } startEdit(tx); } } : null,
      '-', { label: 'Copier la réplique', icon: '⧉', onclick: () => copy(s.text, 'réplique copiée') },
      tl && s.tr?.[tl] ? { label: 'Copier la traduction', icon: '⧉', onclick: () => copy(s.tr[tl], 'traduction copiée') } : null];
  }
  const d = e.target.closest('#side .drow');
  if (d) {
    const x = S.docs.find((y) => y.id === d.dataset.id);
    return [{ head: 'une transcription' }, { label: 'Ouvrir', icon: '⤢', onclick: () => openById(d.dataset.id) },
      { label: 'Ouvrir le média dans la bibliothèque', icon: '▦', onclick: () => { if (x) location.href = href('asset/#' + x.item); } },
      montageItem(x),
      '-', { label: 'Mettre à la corbeille…', icon: '×', onclick: () => removeDoc(d.dataset.id) }];
  }
  return null;
}
pageMenu(() => {
  const go = $('#act .tb.go');
  const done = S.doc?.state === 'done';
  return [{ head: 'Transcrire' },
    { label: 'Transcrire', icon: '▶', disabled: !go || go.disabled, why: $('#act .tr-why')?.textContent || 'rien à envoyer', onclick: launch },
    '-',
    { label: 'Choisir dans la bibliothèque…', icon: '+', onclick: choose },
    { label: 'Depuis le disque…', icon: '↑', onclick: () => fileIn.click() },
    done ? '-' : null,
    done ? { label: 'Une question au carnet', icon: '☰', onclick: () => showCarnet(true) } : null,
    done ? { label: 'Copier le texte', icon: '⧉', onclick: () => copyText() } : null,
    ...(done ? [{ label: 'Exporter', icon: '↓', items: exportItems() }] : [])];
});

// ── démarrage ───────────────────────────────────────────────
async function start() {
  skeleton();
  wireLines();
  contextMenu($('#lines'), linesMenu);
  contextMenu($('#side'), linesMenu);
  dropZone($('#p-in'), { kinds: ['audio', 'video'], multiple: false, via: 'transcrire', onitems: (l) => setItem(l[0]) });
  dropAnywhere((files) => addFiles(files));
  try { S.cfg = await api('transcrire/options'); } catch (e) { $('#rail').replaceChildren(el('p', { class: 'warn' }, `le portail ne répond pas : ${e.message}`)); return; }
  const d = store.get() || {};
  for (const k of ['lang', 'mode', 'cpl', 'max_s', 'stamps']) if (d[k] !== undefined && d[k] !== null) S[k] = d[k];
  if (S.mode === 'precis') S.mode = 'complet';   // l'ancien nom
  if (!M(S.mode)) S.mode = 'rapide';
  S.to = prefs.get('transcrire.to', S.cfg.to_default ?? '') || '';
  if (S.to && !S.cfg.langs.some((l) => l.id === S.to)) S.to = '';
  S.view = prefs.get('transcrire.view', S.view);
  S.follow = prefs.get('transcrire.follow', S.follow) !== false;
  prefs.on('transcrire.view', (v) => { if (v && v !== S.view) setView(v); });
  prefs.on('transcrire.follow', (v) => { S.follow = v !== false; });
  prefs.on('transcrire.to', (v) => { S.to = v || ''; paintLang(); paintAct(); paintBar(); });
  put($('#banner'), stub() ? el('div', { class: 'banner' }, el('b', {}, 'Moteur factice'),
    el('span', {}, 'le texte, les voix et le carnet sont des essais, calés sur les passages parlés du son — aucun modèle n’est chargé. Le câblage réel attend l’accord de Cal (Admin → Câblage).')) : null);
  const q = new URLSearchParams(location.search);
  const want = q.get('src') || d.item;
  if (want) { try { const it = await api('library/' + want); if (['audio', 'video'].includes(it.kind)) S.item = it; } catch { /* parti */ } }
  S.wantCarnet = q.get('vue') === 'carnet';
  // le Montage est un outil du Studio : un compte Apps ne s'y voit pas proposer d'envoi (commun/shell.js, studioOff)
  session().then((me) => { S.studio = !!me && !(me.user && me.user.access === 'apps' && me.user.role !== 'invite'); });
  paintIn(); paintMode(); paintLang(); paintAdv(); paintAct(); paintPlayer();
  loadDocs();
  const h = location.hash.slice(1);
  if (h) openById(h);
}
addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== S.doc?.id) openById(id); });
addEventListener('beforeunload', () => { if (P.edits.size) flush(); });
start();
