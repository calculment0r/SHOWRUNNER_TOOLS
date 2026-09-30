// Transcrire : un son ou une vidéo → le texte horodaté (et les voix), la
// traduction, la lecture synchronisée, la correction à la main, les
// sous-titres. Le serveur tient la seule vérité : moteurs, langues, ce qui
// passe ou non, les sous-titres calculés du document
// (server/tools/transcrire.py, étude docs/etudes/transcrire.md).
//
// Entrée : un dépôt (disque ou vignette glissée), la bibliothèque, ou
// l'adresse transcrire/?src=<id>. Une transcription s'ouvre par #trn-….
//
// L'annulation (commun/undo.js) : chaque correction d'une réplique, d'une
// traduction, d'un nom de voix, avec son contraire (réenregistré). Ne
// s'annulent pas : lancer une transcription ou une traduction (partie dans la
// file), un fichier déposé, les réglages.
import { mountHeader, api, pick, toast, el, $, $$, href, fmtDur, fmtDate, uploadFile, dropZone, dropAnywhere, dock, sorteEffective, avecEspace } from '../commun/shell.js';
import { createUndo } from '../commun/undo.js';
import { prefs } from '../commun/prefs.js';
import { menu, contextMenu, pageMenu, copy } from '../commun/menu.js';
import { lecteur } from '../commun/lecteur.js';

mountHeader('transcrire', { sub: 'transcrire · traduire' });

const KEY = 'sr-transcrire';
const S = {
  cfg: null,
  item: null,                       // le média choisi
  lang: 'auto', to: 'en', mode: 'rapide', speakers: null, cpl: 42, max_s: 7, stamps: false,
  doc: null, docs: [],
  view: 'both', follow: true, sending: false,
};
const P = { edits: new Map(), timer: 0, saving: false };   // corrections en attente d'envoi
const U = createUndo({ name: 'transcrire' });

// ── petites aides ───────────────────────────────────────────
const L = (id) => S.cfg?.langs.find((l) => l.id === id)?.name || id;
const M = (id) => S.cfg?.modes.find((m) => m.id === id);
const stub = () => S.cfg?.engine === 'factice';
const plural = (n, w, pl = w + 's') => `${n} ${n > 1 ? pl : w}`;
const clock = (t) => { t = Math.max(0, t || 0); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0'); };
const put = (box, ...kids) => box.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false && k !== ''));
const head = (label, right) => el('div', { class: 'ipan-h' }, el('span', { class: 'lbl' }, label), right ? el('span', { class: 'r' }, right) : null);
const speakersOn = () => (S.speakers === null ? !!M(S.mode)?.speakers : S.speakers);
const busy = (d = S.doc) => !!d && (['queued', 'running'].includes(d.state) || Object.values(d.translations || {}).some((t) => ['queued', 'running'].includes(t.state)));
const trLang = () => {
  const have = Object.keys(S.doc?.translations || {}).filter((k) => S.doc.translations[k].state === 'done' || S.doc.segments.some((s) => s.tr?.[k]));
  return have.includes(S.to) ? S.to : have[0] || '';
};
const voiceIndex = (spk) => Math.max(0, (S.doc?.speakers || []).findIndex((v) => v.id === spk)) % 8;
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  save() {
    try { const { lang, to, mode, speakers, cpl, max_s, stamps } = S; localStorage.setItem(KEY, JSON.stringify({ lang, to, mode, speakers, cpl, max_s, stamps, item: S.item?.id })); } catch { /* stockage fermé */ }
  },
};

// ── le squelette ────────────────────────────────────────────
const fileIn = el('input', { type: 'file', accept: 'audio/*,video/*', hidden: true, onchange: async () => { await addFiles([...fileIn.files]); fileIn.value = ''; } });
function skeleton() {
  $('#rail').replaceChildren(
    el('div', { class: 'row tr-undo' }, el('span', { class: 'lbl' }, 'les réglages'), el('span', { class: 'sp' }),
      el('span', { class: 'sr-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, ...U.buttons())),
    el('section', { class: 'ipan', id: 'p-in' }), el('section', { class: 'ipan', id: 'p-lang' }),
    el('section', { class: 'ipan', id: 'p-mode' }), el('section', { class: 'ipan adv', id: 'p-adv' }),
    el('div', { class: 'act', id: 'act' }), fileIn);
  $('#stage').replaceChildren(el('div', { id: 'banner' }), el('div', { class: 'tr-player', id: 'player' }),
    el('div', { id: 'transport' }), el('div', { class: 'tr-bar', id: 'bar' }), el('div', { class: 'tr-voices', id: 'voices' }),
    el('div', { class: 'tr-lines', id: 'lines', role: 'list', 'aria-label': 'les répliques' }));
  $('#side').replaceChildren(el('p', { class: 'lbl' }, 'chargement'));
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

// ── les langues, la vitesse, les avancés ────────────────────
function select(opts, cur, onchange, label) {
  const s = el('select', { class: 'fld', 'aria-label': label, onchange: (e) => onchange(e.target.value) },
    ...opts.map(([v, t]) => el('option', { value: v }, t)));
  s.value = cur;
  return s;
}
function paintLang() {
  const langs = S.cfg.langs.map((l) => [l.id, l.name]);
  put($('#p-lang'), head('Les langues'),
    el('label', { class: 'fl' }, el('span', { class: 'lbl' }, 'Langue parlée'),
      select([['auto', 'Détecter'], ...langs], S.lang, (v) => { S.lang = v; store.save(); paintAct(); }, 'langue parlée')),
    el('label', { class: 'fl' }, el('span', { class: 'lbl' }, 'Traduire en'),
      select([['', 'Pas de traduction'], ...langs], S.to, (v) => { S.to = v; store.save(); paintAct(); paintBar(); paintLines(); }, 'traduire en')));
}
function paintMode() {
  put($('#p-mode'), head('Vitesse'),
    el('div', { class: 'opts two' }, ...S.cfg.modes.map((m) => el('button', {
      class: 'opt' + (S.mode === m.id ? ' on' : '') + (m.off ? ' off' : ''), type: 'button', 'aria-pressed': String(S.mode === m.id),
      title: m.off || null, onclick: () => { S.mode = m.id; store.save(); paintMode(); paintAdv(); paintAct(); } },
    m.label, el('small', {}, m.about)))));
}
function paintAdv() {
  const box = $('#p-adv');
  const open = box.querySelector('details')?.open || false;
  const chk = (on, label, set) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: on || null, onchange: (e) => set(e.target.checked) }), el('span', {}, label));
  const d = el('details', { class: 'more', open: open || null },
    el('summary', {}, el('span', { class: 'lbl' }, 'Paramètres avancés')),
    chk(speakersOn(), 'Séparer les voix', (v) => { S.speakers = v === !!M(S.mode)?.speakers ? null : v; store.save(); paintAct(); }),
    el('label', { class: 'fl' }, el('span', { class: 'lbl' }, 'Sous-titres · caractères par ligne'),
      select(S.cfg.cpl.map((n) => [String(n), `${n}`]), String(S.cpl), (v) => { S.cpl = +v; store.save(); }, 'caractères par ligne')),
    el('label', { class: 'fl' }, el('span', { class: 'lbl' }, 'Sous-titres · durée maximale'),
      select(S.cfg.max_s.map((n) => [String(n), `${String(n).replace('.', ',')} s`]), String(S.max_s), (v) => { S.max_s = +v; store.save(); }, 'durée maximale')),
    chk(S.stamps, 'Horodatage dans le texte exporté (TXT)', (v) => { S.stamps = v; store.save(); }),
    el('div', { class: 'engines' }, el('span', { class: 'lbl' }, 'Ce qui tourne derrière'),
      ...S.cfg.modes.map((m) => el('p', { class: 'hint' }, el('b', {}, m.label), ' : ',
        m.asr_list.map((a) => `${a.name}${a.missing?.length ? ' (absent)' : ''}`).join(' puis '),
        m.speakers ? ' · voix : Nemotron (DGX1)' : ' · voix, si coché : Nemotron (DGX1)', m.mt_name ? ` · traduction : ${m.mt_name}` : '',
        m.off ? el('span', { class: 'reason' }, m.off) : null, m.mt_off ? el('span', { class: 'reason' }, m.mt_off) : null)),
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
    S.item ? el('div', { class: 'sum' }, el('span', {}, el('b', {}, fmtDur(S.item.duration)), ' à transcrire'),
      el('span', {}, [S.lang === 'auto' ? 'langue détectée' : L(S.lang), S.to ? `→ ${L(S.to)}` : ''].filter(Boolean).join(' '))) : null,
    why ? el('div', { class: 'tr-why' }, why) : null,
    el('button', { class: 'tb go block', type: 'button', disabled: !!why || S.sending || null, onclick: launch }, S.sending ? 'Envoi…' : 'Transcrire'),
    stub() ? el('div', { class: 'hint c' }, 'moteur factice : un texte d’essai, horodaté') : null);
}
async function launch() {
  S.sending = true; paintAct();
  try {
    const r = await api('transcrire/run', { method: 'POST', body: { item: S.item.id, lang: S.lang, to: S.to, mode: S.mode, speakers: speakersOn(), cpl: S.cpl, max_s: S.max_s } });
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
  paintBar(); paintVoices(); paintLines(); markSide();
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
    if (P.edits.size || $('.tx[contenteditable="true"]')) { S.doc = { ...d, segments: S.doc.segments }; }
    else openDoc(d, { keepMedia: true });
    if (finished) { loadDocs(); toast(d.state === 'error' ? `échec : ${d.error}` : 'fini'); }
  } catch (e) { toast(e.message); }
  clearTimeout(pollT);
  if (busy(S.doc)) pollT = setTimeout(poll, 900);
}

// ── la lecture ──────────────────────────────────────────────
// LE lecteur du portail (commun/lecteur.js, 30/09) : l'image (ou l'onde du
// son importé), la règle des temps et la tête de lecture du Montage ; les
// répliques sont une piste de sa frise (une teinte par voix), sous l'onde.
const V = { L: null, cap: null, active: null, strip: null, n: 0 };
function paintPlayer() {
  V.L?.detruire();
  const box = $('#player');
  const it = S.doc ? { id: S.doc.item, kind: S.doc.kind, title: S.doc.title, url: null } : S.item;
  V.L = null; V.active = null; V.strip = null;
  const n = ++V.n;
  if (!it) {
    box.className = 'tr-player empty';
    box.replaceChildren(el('div', { class: 'empty' }, el('b', {}, 'Transcrire'),
      el('span', {}, 'Un son ou une vidéo, les langues, puis « Transcrire ».')));
    $('#transport').replaceChildren();
    return;
  }
  box.className = 'tr-player lect ' + it.kind;
  box.replaceChildren(el('p', { class: 'lbl tr-wait-media' }, 'chargement du média'));
  // l'objet entier (adresse, cadence, copies d'affichage) vient de la bibliothèque
  (it.url ? Promise.resolve(it) : api('library/' + it.id)).then((full) => {
    if (n !== V.n) return;
    V.cap = el('div', { class: 'cap', 'aria-live': 'off' });
    const L = lecteur(full, { clavier: 'page', sur: full.kind === 'video' ? V.cap : null, onTemps: tick });
    V.L = L;
    V.strip = L.piste(el('div', { class: 'tr-strip', title: 'les répliques · clic, glisser : la tête de lecture' }));
    // replaceChildren(null) écrirait « null » : on ne passe que des nœuds
    box.replaceChildren(...(full.kind === 'audio' ? [el('div', { class: 'aud' }, el('span', { class: 'lbl' }, 'son'), el('b', {}, full.title || ''), V.cap)] : []), L.el);
    L.media.addEventListener('loadedmetadata', paintStrip);
    paintStrip();
  }).catch(() => { if (n === V.n) box.replaceChildren(el('p', { class: 'warn' }, 'le média a quitté la bibliothèque')); });
  $('#transport').replaceChildren(el('div', { class: 'transport tr-nav' }, el('span', { class: 'lbl' }, 'répliques'),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'réplique précédente (↑)', onclick: () => step(-1) }, '‹'),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'réplique suivante (↓)', onclick: () => step(1) }, '›')));
}
function seek(t, play = true) { const L = V.L; if (!L) return; L.seek(Math.max(0, t)); if (play && !L.lecture) L.play(); }
const dur = () => V.L?.duree || S.doc?.duration || S.item?.duration || 0;
function paintStrip() {
  if (!V.strip) return;
  const d = dur();
  const segs = S.doc?.segments || [];
  V.strip.replaceChildren(...(d ? segs.map((s) => el('span', { class: `sg v${voiceIndex(s.spk)}`, 'data-id': s.id, style: { left: `${(s.a / d) * 100}%`, width: `${Math.max(0.15, ((s.b - s.a) / d) * 100)}%` } })) : []));
  V.active = undefined;
  tick(V.L?.t || 0, V.L?.lecture);
}
function segAt(t) {
  const segs = S.doc?.segments || [];
  let lo = 0, hi = segs.length - 1, hit = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (segs[mid].a <= t) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
  return hit !== null && t < segs[hit].b + 0.25 ? segs[hit] : null;
}
// le lecteur dit où est la tête (à chaque image en lecture, à chaque geste) : la réplique, le sous-titre
function tick(t = V.L?.t || 0, playing = false) {
  if (!V.L) return;
  const s = segAt(t);
  if (s?.id === V.active) return;
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

// ── la barre du texte ───────────────────────────────────────
function paintBar() {
  const box = $('#bar');
  const d = S.doc;
  if (!d) { box.replaceChildren(); return; }
  const tl = trLang();
  const views = [['src', 'Original'], ['tr', 'Traduction'], ['both', 'Les deux']];
  const tr = d.translations?.[S.to];
  const canTranslate = d.state === 'done' && S.to && S.to !== d.detected && !['queued', 'running'].includes(tr?.state);
  const stale = S.to && d.stale?.[S.to];
  const trBtn = canTranslate && (!tr || tr.state === 'error' || stale)
    ? el('button', { class: 'tb ghost sm', type: 'button', title: stale ? 'les répliques corrigées depuis la traduction' : '', onclick: () => translate(S.to) },
      tr && stale ? `Retraduire ${plural(stale, 'réplique')}` : `Traduire en ${L(S.to).toLowerCase()}`) : null;
  put(box,
    el('div', { class: 'ttl' }, el('span', { class: 'lbl' }, 'transcription'), el('b', {}, d.title || d.id),
      el('span', { class: 'lbl meta' }, [d.detected ? L(d.detected) : d.lang === 'auto' ? 'langue à détecter' : L(d.lang), tl ? `→ ${L(tl)}` : '',
        d.segments?.length ? plural(d.segments.length, 'réplique') : '', d.engine?.backend === 'factice' ? 'factice' : ''].filter(Boolean).join(' · '))),
    el('span', { class: 'sp' }),
    tl ? el('div', { class: 'seg' }, ...views.map(([v, lab]) => el('button', { class: 'tb' + (S.view === v ? ' on' : ''), type: 'button', onclick: () => setView(v) }, lab))) : null,
    trBtn,
    d.state === 'done' ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => copyText() }, 'Copier le texte') : null,
    d.state === 'done' ? el('button', { class: 'tb ghost sm', type: 'button', 'aria-haspopup': 'menu', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom + 4, exportItems(), { focusFirst: e.detail === 0 }); } }, 'Exporter') : null);
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
    { label: 'Texte TXT', icon: '↓', onclick: () => download('txt', which) }];
  return [...block('src', `original · ${src}`), ...trs.flatMap((k) => ['-', ...block(k, `traduction · ${L(k).toLowerCase()}`)]), '-',
    { label: 'Ranger les sous-titres dans Asset', icon: '▦', disabled: !S.cfg.asset, why: S.cfg.asset_why, onclick: toAsset }];
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

// ── les voix ────────────────────────────────────────────────
function paintVoices() {
  const box = $('#voices');
  const vs = S.doc?.state === 'done' ? S.doc.speakers || [] : [];
  if (!vs.length) { box.replaceChildren(); return; }
  box.replaceChildren(el('span', { class: 'lbl' }, 'les voix'), ...vs.map((v, i) => {
    const chip = el('span', { class: `who v${i % 8}`, tabindex: '0', title: 'double-clic : renommer', 'data-spk': v.id }, v.name);
    chip.addEventListener('dblclick', () => editText(chip, v.name, (t) => renameVoice(v.id, v.name, t)));
    chip.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); editText(chip, v.name, (t) => renameVoice(v.id, v.name, t)); } });
    return chip;
  }));
}
function renameVoice(id, before, after) {
  if (!after || after === before) return;
  const apply = (name) => { const v = S.doc.speakers.find((x) => x.id === id); if (v) v.name = name; queue({ speaker: { id, name } }); paintVoices(); paintLines(); };
  apply(after);
  U.record({ label: `renommer la voix « ${before} »`, undo: () => apply(before), redo: () => apply(after) });
}

// ── les répliques ───────────────────────────────────────────
function paintLines() {
  const box = $('#lines');
  const d = S.doc;
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
  const names = Object.fromEntries((d.speakers || []).map((v) => [v.id, v.name]));
  const pending = ['queued', 'running'].includes(tr.state);
  const scroll = box.scrollTop;
  put(box,
    pending ? el('div', { class: 'tr-wait slim' }, el('b', {}, `traduction · ${L(tl).toLowerCase()}`), el('span', {}, tr.live?.message || 'en file'),
      el('div', { class: 'bar' }, el('i', { style: { width: tr.live?.progress != null ? `${Math.round(tr.live.progress * 100)}%` : '100%' } }))) : null,
    d.segments.length ? null : el('p', { class: 'hint c' }, 'Aucune parole trouvée dans ce média.'),
    ...d.segments.map((s, i) => {
      const prev = d.segments[i - 1];
      const row = el('div', { class: 'ln' + (V.active === s.id ? ' on' : ''), 'data-id': s.id, role: 'listitem' },
        el('button', { class: 'tc', type: 'button', title: 'aller à ce moment', tabindex: '-1' }, clock(s.a)),
        s.spk && s.spk !== prev?.spk ? el('span', { class: `who v${voiceIndex(s.spk)}` }, names[s.spk] || s.spk) : el('span', { class: 'who none' }),
        el('div', { class: 'txs' },
          showSrc ? el('div', { class: 'tx', 'data-f': 'src', tabindex: '0' }, s.text) : null,
          showTr ? el('div', { class: 'tx tr' + (s.tr?.[tl] ? '' : ' miss') + (isStale(s, tl) ? ' stale' : ''), 'data-f': tl, tabindex: '0',
            title: isStale(s, tl) ? 'la réplique a été corrigée depuis : à retraduire' : null }, s.tr?.[tl] || (pending ? '…' : '')) : null));
      return row;
    }));
  box.scrollTop = scroll;
}
// le serveur dit quelles répliques ont changé depuis leur traduction (stale_ids)
function isStale(s, tl) { return !!(tl && s.tr?.[tl] && S.doc?.stale_ids?.[tl]?.includes(s.id)); }
function wireLines() {
  const box = $('#lines');
  box.addEventListener('click', (e) => {
    const row = e.target.closest('.ln');
    if (!row || e.target.closest('[contenteditable="true"]')) return;
    const s = S.doc?.segments.find((x) => x.id === row.dataset.id);
    if (s) seek(s.a, true);
  });
  box.addEventListener('dblclick', (e) => { const tx = e.target.closest('.tx'); if (tx) startEdit(tx); });
  box.addEventListener('keydown', (e) => { const tx = e.target.closest('.tx'); if (tx && e.key === 'Enter' && tx.contentEditable !== 'true') { e.preventDefault(); startEdit(tx); } });
}
function startEdit(tx) {
  const row = tx.closest('.ln');
  const s = S.doc.segments.find((x) => x.id === row.dataset.id);
  const f = tx.dataset.f;
  const before = f === 'src' ? s.text : s.tr?.[f] || '';
  V.L?.pause();
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
    if (!keep) node.textContent = before;
    else done(after);
  };
  node.addEventListener('keydown', function k(e) {
    if (e.key === 'Enter') { e.preventDefault(); node.removeEventListener('keydown', k); end(true); node.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); node.removeEventListener('keydown', k); end(false); node.focus(); }
  });
  node.addEventListener('blur', () => end(true), { once: true });
}
function setField(id, f, before, after, record) {
  if (after === before || (f === 'src' && !after)) { paintLines(); return; }
  const apply = (v) => {
    const s = S.doc.segments.find((x) => x.id === id);
    if (!s) return;
    if (f === 'src') { s.text = v; s.edited = true; } else { (s.tr ||= {})[f] = v; }
    queue({ seg: { id, f, v } });
    paintLines(); paintCap(segAt(V.L?.t || 0));
  };
  apply(after);
  if (record) U.record({ label: `corriger la réplique ${clock(S.doc.segments.find((x) => x.id === id)?.a)}`, undo: () => apply(before), redo: () => apply(after) });
}

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
      if (!editing && !P.edits.size) { paintBar(); paintLines(); }
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
    S.docs.length ? el('div', { class: 'tr-docs' }, ...S.docs.map(docRow)) : el('p', { class: 'hint' }, 'Chaque transcription se range ici, avec ses traductions.'));
  markSide();
}
function docRow(x) {
  const st = x.live?.state || x.state;
  const row = el('div', { class: 'drow', role: 'button', tabindex: '0', 'data-id': x.id, onclick: () => openById(x.id),
    onkeydown: (e) => { if (e.key === 'Enter') openById(x.id); } },
  el('div', { class: 'th ' + (x.kind || ''), style: x.thumb_url ? { backgroundImage: `url(${href(x.thumb_url)})` } : null }),
  el('div', { class: 'tx' }, el('b', {}, x.title || x.id),
    el('small', {}, [fmtDur(x.duration), [x.detected ? x.detected.toUpperCase() : '', ...(x.to || []).map((k) => k.toUpperCase())].filter(Boolean).join(' → '),
      st === 'done' ? fmtDate(x.created) : st === 'error' ? 'échec' : st === 'running' ? 'en cours' : 'en file'].filter(Boolean).join(' · '))));
  return row;
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
    const s = S.doc.segments.find((x) => x.id === row.dataset.id);
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
    return [{ head: 'une transcription' }, { label: 'Ouvrir', icon: '⤢', onclick: () => openById(d.dataset.id) },
      { label: 'Ouvrir le média dans la bibliothèque', icon: '▦', onclick: () => { const x = S.docs.find((y) => y.id === d.dataset.id); if (x) location.href = href('asset/#' + x.item); } },
      '-', { label: 'Mettre à la corbeille…', icon: '×', onclick: () => removeDoc(d.dataset.id) }];
  }
  return null;
}
pageMenu(() => {
  const go = $('#act .tb.go');
  return [{ head: 'Transcrire' },
    { label: 'Transcrire', icon: '▶', disabled: !go || go.disabled, why: $('#act .tr-why')?.textContent || 'rien à envoyer', onclick: launch },
    '-',
    { label: 'Choisir dans la bibliothèque…', icon: '+', onclick: choose },
    { label: 'Depuis le disque…', icon: '↑', onclick: () => fileIn.click() },
    S.doc?.state === 'done' ? '-' : null,
    S.doc?.state === 'done' ? { label: 'Copier le texte', icon: '⧉', onclick: () => copyText() } : null,
    ...(S.doc?.state === 'done' ? [{ label: 'Exporter', icon: '↓', items: exportItems() }] : [])];
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
  for (const k of ['lang', 'to', 'mode', 'speakers', 'cpl', 'max_s', 'stamps']) if (d[k] !== undefined && d[k] !== null) S[k] = d[k];
  if (!M(S.mode)) S.mode = 'rapide';
  S.view = prefs.get('transcrire.view', S.view);
  S.follow = prefs.get('transcrire.follow', S.follow) !== false;
  prefs.on('transcrire.view', (v) => { if (v && v !== S.view) setView(v); });
  prefs.on('transcrire.follow', (v) => { S.follow = v !== false; });
  put($('#banner'), stub() ? el('div', { class: 'banner' }, el('b', {}, 'Moteur factice'),
    el('span', {}, 'le texte est un texte d’essai, calé sur les passages parlés du son — aucun modèle n’est chargé. Le câblage réel attend l’accord de Cal (Admin → Câblage).')) : null);
  const q = new URLSearchParams(location.search);
  const want = q.get('src') || d.item;
  if (want) { try { const it = await api('library/' + want); if (['audio', 'video'].includes(it.kind)) S.item = it; } catch { /* parti */ } }
  paintIn(); paintLang(); paintMode(); paintAdv(); paintAct(); paintPlayer();
  loadDocs();
  const h = location.hash.slice(1);
  if (h) openById(h);
}
addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== S.doc?.id) openById(id); });
addEventListener('beforeunload', () => { if (P.edits.size) flush(); });
start();
