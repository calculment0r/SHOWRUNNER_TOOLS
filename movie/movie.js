// VIDÉO (ex « Movie Creator », renommé par Cal le 29/09) — des plans vidéo
// avec H3, dans le thème du portail.
//
// Le parcours suit H3 Studio (github.com/underworldhistory1-ctrl/minimax-h3-higgsfield,
// licence MIT, Copyright (c) 2026 Charles Mod) : les modes Texte / Images /
// Références, les trois champs du prompt H3, les toiles avec temps estimé, la
// durée ; méthode, pas, graine, LoRA repliés. Réécrit ici ; la bibliothèque du
// portail, la file commune et les éléments remplacent leurs fichiers locaux.
//
// Depuis le 29/09, sur le modèle de Higgsfield : le fil des vidéos
// (commun/fil.js), en liste — la grande vidéo et sa carte (modèle, prompt aux
// jetons surlignés, entrées, puces, date) — ; les rendus en file et en cours en
// tête du fil ; au survol, aimer, réutiliser, recréer, télécharger, et le menu ⋯ ;
// un clic ouvre la visionneuse plein écran, la molette passe d'une vidéo à l'autre.
//
// Depuis le 09/10 (Cal : « on doit revoir vraiment le design d'expérience de la
// création de vidéo … trop de texte partout, les infos les plus importantes sont
// mal hiérarchisées ») : la page prend la forme d'Image — le fil sur toute la
// largeur, la barre de création en bas (commun/barre.css) :
//   ligne 1 — les entrées : en Images, la première et la dernière image ; en
//             Références, les vignettes (commun/entrees.js en rangée : l'image,
//             son jeton @element1, son nom) ; on dépose tout sur la barre — du
//             disque, du fil, du panneau Asset, un personnage de Character Factory
//             compris — ; en Texte, un dépôt fait passer en Références ;
//   le Multishot, allumé : la frise des plans (commun/multishot.js) prend la
//             place de l'invite ; on y dépose un élément sur un plan ;
//   ligne 2 — l'invite, une seule quel que soit le mode, jetons en couleur, « @ » ;
//   ligne 3 — des puces qui montrent leur valeur : le mode, le format, la qualité
//             et la résolution (avec le temps estimé), la durée (− 5,2 s +), puis,
//             repliés, Multishot, Son, Aides, Avancé, et ce que H3 reçoit ;
//   à droite — « Générer », le seul orange, et le temps estimé ; ce qui manque
//             dessous, et y mène.
// Le banc « Comparer » reprend le banc NL de Cal : rideau, côte à côte,
// clignotement, zoom sous le curseur, boucle, écoute A/B, recettes et
// différences.
//
// Le serveur fait foi : /api/movie/plan résout tout (toile, étiquettes H3,
// prompt envoyé, graphe, temps estimé, ce qui manque) ; la page l'affiche et
// soumet à la file (movie.t2v / movie.i2v / movie.r2v) ; /api/movie/redo
// recrée une vidéo, /api/movie/frame en tire la première ou la dernière image.
//
// L'annulation (commun/undo.js) : le formulaire par instantanés (images,
// entrées, l'invite une fois écrite, le Multishot, format, toile, durée,
// méthode, LoRA, réglages avancés) ; aimer, ranger, jeter depuis le fil (le fil
// les range lui-même dans la pile : commun/fil.js, option undo). Ne s'annulent
// pas : un rendu lancé, une image tirée d'une vidéo, un fichier déposé. Le banc
// « Comparer » est une vue : il ne s'annule pas.
import { mountHeader, api, jobs, pick, uploadFile, toast, el, $, $$, href, fmtDate, dropAnywhere, dropZone, dock, releve } from '../commun/shell.js';
import { createEntrees } from '../commun/entrees.js';
import { createFil } from '../commun/fil.js';
import { createUndo } from '../commun/undo.js';
import { prefs } from '../commun/prefs.js';
import { menu, pageMenu } from '../commun/menu.js';
import { createMultishot } from '../commun/multishot.js';
import { compose, FPS } from '../commun/multishot_texte.js';

mountHeader('movie');

const store = {   // commodité du navigateur : le formulaire en cours
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* navigation privée */ } },
};
const MODE_FR = { t2v: 'texte', i2v: 'images', r2v: 'références' };
const MODE_SHORT = { t2v: 'Texte', i2v: 'Images', r2v: 'Réf.' };
const MODE_TIP = { t2v: 'le prompt seul', i2v: 'une première image, une dernière, ou les deux', r2v: 'des images, des éléments, des vidéos, des sons, appelés par @' };
const METH_FR = { brouillon: 'brouillon', qualite: 'qualité', turbo: 'turbo · ancien banc', origine: 'origine · ancien banc', spectrum: 'spectrum · ancien banc' };
const PRESETS = ['brouillon', 'qualite'];   // la recette de Cal (30/09) : server/tools/movie.py, METHODS
const ROLE_FR = { face: 'visage', 'full body': 'plein pied', expression: 'expression' };
// le nom d'un format pour les gens : la famille du serveur (server/tools/movie.py, FAMILIES), son rapport
const FAM_FR = { '2,4:1': ['2,4:1', 'la recette'], paysage: ['16:9', 'paysage'], '21:9': ['21:9', 'cinémascope'], portrait: ['9:16', 'portrait'],
  carré: ['1:1', 'carré'], image: ['image', 'd’après l’image'] };
const KINDS = ['image', 'element', 'video', 'audio'];
const mmss = (s) => { if (s == null || !isFinite(s)) return '—'; s = Math.max(0, Math.round(s)); return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : `${s} s`; };
const p2 = (n) => String(n).padStart(2, '0');
const tcode = (t) => { if (!isFinite(t)) t = 0; const m = Math.floor(t / 60), s = t - m * 60; return p2(m) + ':' + s.toFixed(2).padStart(5, '0'); };
const bg = (u) => (u ? { backgroundImage: `url(${href(u)})` } : null);
// replaceChildren écrirait « null » : on ne passe que des nœuds
const put = (box, ...kids) => box.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
const rng = (e) => (e ? `${mmss(e.low)} – ${mmss(e.high)}` : '');
const ms = (iso) => Date.parse(iso || '') || 0;
const secFr = (s) => `${String(Math.round(s * 10) / 10).replace('.', ',')} s`;
// un temps court : « 3–4 min », « 40–55 s »
function rngShort(e) {
  if (!e) return '';
  if (e.high < 90) return `${Math.round(e.low)}–${Math.round(e.high)} s`;
  const lo = Math.round(e.low / 60), hi = Math.round(e.high / 60);
  return lo === hi ? `≈ ${lo} min` : `${lo}–${hi} min`;
}

// ── l'état ──────────────────────────────────────────────────
const saved = store.get('movie.v2', {});
const F = {
  mode: prefs.get('movie.mode', 't2v'),   // un formulaire neuf : la préférence (movie/prefs.json)
  p: { t2v: { desc: '', sound: '', music: '' }, i2v: { desc: '', sound: '', music: '' }, r2v: { desc: '', sound: '', music: '' } },
  start: null, end: null, inputs: {}, refSize: 'match',
  // la toile : null = celle du préréglage (Brouillon 1536 × 640, Qualité 1920 × 800), 'auto' = d'après l'image, [w, h] sinon
  canvas: { t2v: null, i2v: null, r2v: null }, fam: { t2v: '2,4:1', i2v: '2,4:1', r2v: '2,4:1' },
  method: 'brouillon', frames: 124, steps: '', seed: '', origSeed: null, loras: {}, adv: {},
  // le Multishot : allumé ou non, ses plans (des images entières), la langue des répliques, les durées dans le texte
  ms: { on: false, shots: null, lang: null, durations: false },
  ...saved,
};
// une seule invite (09/10) : celle du mode où l'on était, pour les trois
{ const seen = { desc: '', sound: '', music: '', ...((saved.p || {})[saved.mode || F.mode] || {}) };
  for (const k of ['t2v', 'i2v', 'r2v']) F.p[k] = { ...seen }; }
F.ms = { on: false, shots: null, lang: null, durations: false, ...(saved.ms || {}) };
// un formulaire gardé d'avant les préréglages (méthodes turbo / origine / spectrum de l'ancien banc) :
// le Brouillon, la toile du préréglage, les pas par défaut — les prompts restent
if (!PRESETS.includes(F.method)) {
  F.method = 'brouillon'; F.steps = '';
  F.canvas = { t2v: null, i2v: null, r2v: null }; F.fam = { t2v: '2,4:1', i2v: '2,4:1', r2v: '2,4:1' };
  delete F.adv.sampler; delete F.adv.scheduler;
}
delete F.refs; delete F.refKind;   // l'ancienne forme (références nommées)
let E = null;   // les entrées (mode Références), créées quand les options sont là
let M = null;   // le Multishot, monté à son premier allumage
let fil = null; // le fil des vidéos (commun/fil.js)
const S = {
  view: 'create', opts: null, plan: null, seq: 0, items: new Map(), jobs: [], allJobs: [], loras: [], loraMachine: '', A: null, B: null, h3: null,
  myJobs: new Set(store.get('movie.myjobs', [])), seen: new Set(), landed: new Set(), gone: new Set(), pop: null, aides: 'cam',
};
// ── l'annulation ────────────────────────────────────────────
const U = createUndo({ name: 'movie', onapply: (e, { items }) => {
  let reload = false;
  for (const it of items || []) {
    if (it.gone) fil?.remove(it.id);
    else if (fil?.get(it.id)) fil.update(it);
    else reload = true;
  }
  if (reload) fil?.reload();
} });
const sameJ = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const FIELD_FR = { desc: 'écrire ce qu’on voit et entend', sound: 'écrire le son d’ambiance', music: 'écrire la musique' };
const FORM_FR = [['start', 'changer l’image de début'], ['end', 'changer l’image de fin'], ['inputs', 'changer les entrées'],
  ['ms', 'changer le multishot'], ['refSize', 'changer le détail des références'], ['fam', 'changer le format'], ['canvas', 'changer la résolution'],
  ['method', 'changer la qualité'], ['frames', 'changer la durée'], ['steps', 'changer le nombre de pas'], ['seed', 'changer la graine'],
  ['origSeed', 'changer la graine d’origine'], ['loras', 'changer les LoRA'], ['adv', 'changer un réglage avancé']];
const TYPED = new Set(['steps', 'seed']);
let typing = 0;   // chaque passage dans un champ : une saisie, un seul geste
function formDescribe(b, a) {
  // le Multishot réécrit l'invite : son geste est celui du multishot
  if (!sameJ(b.ms, a.ms)) return { label: 'changer le multishot', merge: `ms#${typing}`, mergeMs: 1200 };
  for (const m of ['t2v', 'i2v', 'r2v']) {
    for (const k of ['desc', 'sound', 'music']) {
      if (b.p?.[m]?.[k] !== a.p?.[m]?.[k]) return { label: FIELD_FR[k], merge: `${k}#${typing}`, mergeMs: Infinity };
    }
  }
  for (const [k, label] of FORM_FR) {
    if (!sameJ(b[k], a[k])) return { label, merge: TYPED.has(k) || (k === 'adv' && b.adv?.crf !== a.adv?.crf) ? `${k}#${typing}` : k, mergeMs: TYPED.has(k) ? Infinity : undefined };
  }
  return { label: 'modifier le formulaire' };
}
let form = null;   // posé au démarrage (l'ouverture n'est pas un geste)
function formRestore(s) {
  for (const k of Object.keys(s)) F[k] = s[k];
  if (E) E.set(F.inputs);
  $('#ref-size').value = F.refSize;
  if (S.view !== 'create') setView('create');
  setMode(F.mode);
  syncMultishot();
}

const save = () => { store.set('movie.v2', F); form?.commit(); };
// un ajustement que la page fait seule (un LoRA qui ne va pas au mode) : gardé, sans faire un geste
const quietSave = () => { store.set('movie.v2', F); form?.reset(); };
function changed() { save(); schedulePlan(); paintChips(); }
async function item(id) {
  if (!id) return null;
  if (S.items.has(id)) return S.items.get(id);
  try { const it = await api('library/' + id); S.items.set(id, it); return it; } catch { S.items.set(id, null); return null; }
}

// ── vues : créer, comparer ──────────────────────────────────
function setView(v) {
  S.view = v;
  document.body.dataset.view = v;
  $$('.v-views [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('#view').hidden = v !== 'create';
  $('#pbar').hidden = v !== 'create';
  $('#cmp').hidden = v !== 'cmp';
  if (v === 'cmp') benchLoad(); else pauseBench();
  syncUrl();
  followDock();
}
$$('.v-views [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
// ↶ ↷ et le journal, au bout de la ligne du haut
$('.v-top').append(el('span', { class: 'sr-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, ...U.buttons()));
$('#pbar').addEventListener('focusin', (e) => { if (e.target.matches?.('textarea, input')) typing++; });

// Une seule invite, quel que soit le mode (09/10) : on change de mode sans perdre ce qu'on a écrit
// (les brouillons par mode de H3 Studio faisaient disparaître l'invite quand un dépôt changeait le mode).
function setMode(m) {
  if (m !== F.mode) F.p[m] = { ...F.p[F.mode] };
  F.mode = m;
  document.body.dataset.mode = m;
  $$('#pbar [data-for]').forEach((n) => { n.hidden = n.dataset.for !== m; });
  $('#pb-refs').hidden = m === 't2v';
  descEl.placeholder = PH[m];
  syncFields();
  if (m === 'i2v') { paintSlot('start'); paintSlot('end'); }
  paintLoras();
  paintAdv();
  save(); schedulePlan();
  syncUrl();
  followDock();
  paintChips();
  M?.refresh();
}

function syncUrl() {
  const q = new URLSearchParams();
  if (S.view === 'cmp') { q.set('view', 'cmp'); if (S.A) q.set('a', S.A); if (S.B) q.set('b', S.B); }
  else q.set('mode', F.mode);
  try { history.replaceState(null, '', '?' + q + location.hash); } catch { /* aperçu */ }
}

// ── Images : la première et la dernière image, dans la barre ─
async function paintSlot(which) {
  const box = $(which === 'start' ? '#start-slot' : '#end-slot');
  const it = await item(F[which]);
  if (F[which] && !it) { F[which] = null; save(); }
  const lab = which === 'start' ? 'début' : 'fin';
  const tag = which === 'start' || !F.start ? '<Picture 1>' : '<Picture 2>';
  box.replaceChildren();
  box.className = 'v-slot' + (it ? '' : ' empty');
  if (!it) {
    box.title = `l’image de ${lab} : choisir, ou déposer une image (ou un personnage : son plein pied)`;
    box.append(el('button', { class: 'v-im', type: 'button', onclick: () => chooseImage(which) }, el('b', {}, '+')),
      el('span', { class: 'v-tok' }, lab), el('span', { class: 'v-name' }, ' '));
    return;
  }
  box.title = `${it.title || ''} — l’image de ${lab} · ${it.width}×${it.height} · clic : changer, retirer`;
  box.append(el('button', { class: 'v-im', type: 'button', style: bg(it.thumb_url || it.url),
    onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.top - 4, [{ head: `${lab} · ${it.title || ''}` },
      { label: `Insérer ${tag}`, sub: 'dans le prompt', onclick: () => insertAt(descEl, tag) },
      { label: 'Changer d’image…', onclick: () => chooseImage(which) },
      { label: 'Voir en grand', onclick: () => fil?.open(it) },
      '-', { label: 'Retirer', icon: '×', danger: true, onclick: () => { F[which] = null; changed(); paintSlot(which); } }]); } }),
  el('span', { class: 'v-tok' }, lab), el('span', { class: 'v-name' }, it.title || ''));
}
async function chooseImage(which) {
  const [it] = await pick({ kinds: ['image', 'element'], multiple: false, title: which === 'start' ? 'Image de début' : 'Image de fin' });
  if (it) setImage(which, it);
}
// Déposer sur un emplacement : un fichier du disque (bibliothèque · Upload,
// via movie) ou une vignette glissée d'ailleurs dans le portail (dropZone).
for (const which of ['start', 'end']) {
  dropZone($(which === 'start' ? '#start-slot' : '#end-slot'), { kinds: ['image', 'element'], multiple: false, via: 'movie',
    label: which === 'start' ? 'l’image de début' : 'l’image de fin', onitems: ([it]) => setImage(which, it) });
}
async function setImage(which, it) {
  const img = it.kind === 'element' ? await fromElement(it) : it;
  if (!img) return;
  S.items.set(img.id, img);
  F[which] = img.id;
  // la toile reste celle choisie (le plan annonce le recadrage) ; « d'après l'image » se choisit au format
  changed(); paintSlot(which);
}
// un élément comme image de départ : laquelle de ses images ? (le plein pied d'abord)
function fromElement(elem) {
  const rank = (r) => ({ 'full body': 0, face: 1, expression: 2 }[r] ?? 3);
  const refs = [...(elem.element?.refs || [])].sort((a, b) => rank(a.role) - rank(b.role));
  return new Promise((resolve) => {
    const close = (v) => { scrim.remove(); document.removeEventListener('keydown', esc); resolve(v); };
    const esc = (e) => { if (e.key === 'Escape') close(null); };
    const grid = el('div', { class: 'grid sm' }, ...refs.map((r) => {
      const b = el('button', { class: 'thumb', type: 'button', onclick: async () => {
        b.classList.add('pending');
        try { close(await api('movie/element-image', { method: 'POST', body: { element: elem.id, file: r.file } })); }
        catch (e) { toast(e.message); b.classList.remove('pending'); }
      } },
      el('div', { class: 'im' }, el('img', { src: href(r.thumb_url || r.url), alt: '' }), el('span', { class: 'kind element' }, ROLE_FR[r.role] || r.role || 'réf.')),
      el('div', { class: 'cap' }, el('div', { class: 't' }, r.label || ROLE_FR[r.role] || 'image'), el('div', { class: 's' }, r.width ? `${r.width}×${r.height}` : '')));
      return b;
    }));
    const scrim = el('div', { class: 'scrim picker' }, el('div', { class: 'modal', role: 'dialog', 'aria-label': 'image de départ' },
      el('div', { class: 'modal-head' }, el('span', { class: 't' }, `Quelle image de ${elem.title} ?`), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', onclick: () => close(null) }, 'Annuler')),
      el('div', { class: 'modal-body' }, el('p', {}, 'Le plan partira exactement de cette image.'),
        refs.length ? grid : el('p', { class: 'warn' }, 'cet élément n’a aucune image'))));
    document.addEventListener('keydown', esc);
    document.body.append(scrim);
  });
}

// ── Entrées (mode Références) : le cadre commun, en rangée ──
$('#ref-size').value = F.refSize;
$('#ref-size').addEventListener('change', (e) => { F.refSize = e.target.value; changed(); });
const AUDIO_EXT = /\.(wav|mp3|flac|m4a|ogg)$/i;
function elementParts(it) {   // le même compte que element_parts() de server/tools/movie.py
  const refs = it.element?.refs || [];
  const imgs = refs.filter((r) => !AUDIO_EXT.test(r.file || ''));
  // la voix est rangée à part (element.voices) ; un son dans refs (ancienne forme) compte aussi
  const voices = [...(it.element?.voices || []), ...refs.filter((r) => AUDIO_EXT.test(r.file || ''))].slice(0, 1);
  if (it.element?.type === 'object') {   // object_parts() : la planche de l'objet, puis ses vues gardées — 4 images au plus
    const sheet = imgs.filter((r) => r.role === 'sheet').slice(0, 1);
    const OLD = ['face · 0°', '3/4 avant gauche · 45°', 'gauche · 90°', '3/4 arrière gauche · 135°', 'dos · 180°',
      '3/4 arrière droit · 225°', 'droite · 270°', '3/4 avant droit · 315°'];   // objet_vues._ref_angle : les libellés d'avant le 09/10
    const views = imgs.filter((r) => r.role === 'view' && (Number.isInteger(r.az) || OLD.includes((r.label || '').trim())));
    const n = Math.min(4, sheet.length + views.length);
    return { imgs: n ? imgs.slice(0, n) : imgs.slice(0, 2), voices };
  }
  const chosen = ['face', 'full body'].map((role) => imgs.find((r) => r.role === role)).filter(Boolean);
  return { imgs: chosen.length ? chosen : imgs.slice(0, 2), voices };
}
function h3Cost(it, p = {}) {   // ce qu'une entrée prend des limites d'H3
  if (it.kind === 'element') { const { imgs, voices } = elementParts(it); return { image: imgs.length, audio: voices.length, files: imgs.length + voices.length }; }
  if (it.kind === 'video') return { video: 1, audio: p.sound ? 1 : 0, files: 1 };
  return { [it.kind]: 1, files: 1 };
}
function mountEntrees() {
  const L = S.opts.limits;
  const roles = Object.fromEntries(Object.entries(S.opts.roles).map(([k, v]) => [k, v.map((r) => [r.id, r.label])]));
  E = createEntrees($('#entrees'), { limits: { image: L.image, video: L.video, audio: L.audio, files: L.files }, cost: h3Cost,
    roles, via: 'movie', state: F.inputs, layout: 'rangee', insert: insertToken,
    onchange: (st) => { F.inputs = st; changed(); M?.refresh(); } });
  for (const ta of [descEl, soundEl, musicEl]) E.bindField(ta);
  E.enable(F.mode === 'r2v');
}
// un jeton d'entrée : dans le plan choisi du Multishot s'il est allumé, sinon dans l'invite
function insertToken(tok) {
  if (F.ms.on && M) { const ta = $('#ms .ms-ta'); if (ta) { insertAt(ta, tok); return; } }
  insertAt(descEl, tok);
}
// ce que prend la barre (un dépôt, « poser » du panneau Asset) : chaque objet là où il sert
// — Images : le début, puis la fin ; sinon les entrées (on passe en Références s'il le faut).
// `toks` reçoit les jetons des entrées posées. Faux si rien n'a été posé.
async function toBar(items, toks = null) {
  if (!items.length) return false;
  if (F.mode === 'i2v' && !toks) {
    const imgs = items.filter((x) => x.kind === 'image' || x.kind === 'element');
    const rest = items.filter((x) => !imgs.includes(x));
    let n = 0;
    for (const it of imgs) {
      if (F.start && F.end) break;
      const before = [F.start, F.end].join();
      await setImage(!F.start ? 'start' : 'end', it);
      if ([F.start, F.end].join() !== before) n++;
    }
    if (!rest.length) return n > 0;
    toast(`${rest.map((x) => x.title).join(', ')} : une vidéo, un son vont en mode Références`, 5000);
    return n > 0;
  }
  if (F.mode !== 'r2v') {
    setMode('r2v');
    toast('passé en mode Références : les entrées s’appellent par leur jeton (@element1…)', 5000);
  }
  return E ? E.add(items, toks) > 0 || (toks?.length > 0) : false;
}

// ── le prompt : une invite, le son et la musique à part ─────
const PH = {
  t2v: 'Décrivez le plan : ce qu’on voit, ce qu’on entend, la caméra',
  i2v: 'Ce qui se passe à partir de l’image : l’action, la caméra, une réplique',
  r2v: 'Le plan, avec ses entrées : @element1 marche dans @image1… (tapez @)',
};
const descEl = $('#desc'), soundEl = $('#sound'), musicEl = $('#music');
function syncFields() {
  const p = F.p[F.mode];
  if (descEl.value !== p.desc) descEl.value = p.desc;
  soundEl.value = p.sound; musicEl.value = p.music;
  if (E) { E.enable(F.mode === 'r2v'); E.refreshFields(); }
}
descEl.addEventListener('input', () => { F.p[F.mode].desc = descEl.value; changed(); });
soundEl.addEventListener('input', () => { F.p[F.mode].sound = soundEl.value; changed(); });
musicEl.addEventListener('input', () => { F.p[F.mode].music = musicEl.value; changed(); });
// Ctrl (ou ⌘) + Entrée : lancer, d'où qu'on écrive dans la barre
$('#pbar').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); launch(); } });

function insertAt(t, text, { select = null } = {}) {
  const a = t.selectionStart ?? t.value.length, b = t.selectionEnd ?? a;
  const pre = t.value.slice(0, a), post = t.value.slice(b);
  const pad = pre && !/\s$/.test(pre) ? ' ' : '';
  t.value = pre + pad + text + (post && !/^\s/.test(post) ? ' ' : '') + post;
  const at = (pre + pad).length;
  t.focus();
  if (select) t.setSelectionRange(at + select[0], at + select[1]); else t.setSelectionRange(at + text.length, at + text.length);
  t.dispatchEvent(new Event('input', { bubbles: true }));
}
// la caméra : le vocabulaire contrôlé, écrit dans la phrase (dans le plan choisi du Multishot s'il est allumé)
const writeIn = () => (F.ms.on && $('#ms .ms-ta')) || descEl;
const cam = { amp: '', speed: '' };
function segPick(id, cb) { $$(`#${id} .tb`).forEach((b) => b.addEventListener('click', () => { $$(`#${id} .tb`).forEach((x) => x.classList.toggle('on', x === b)); cb(b.dataset.v); })); }
segPick('cam-amp', (v) => { cam.amp = v; });
segPick('cam-speed', (v) => { cam.speed = v; });
function paintCamera() {
  $('#cam-chips').replaceChildren(...(S.opts?.camera || []).map((c) => el('button', { class: 'chip cam-chip', type: 'button', title: c.phrase,
    onclick: () => {
      const fixed = /Shake|Static|POV/.test(c.id);   // l'amplitude est dans le mot, ou n'a pas de sens
      insertAt(writeIn(), c.phrase + (fixed ? '' : cam.amp) + (/Static/.test(c.id) ? '' : cam.speed) + '.');
    } }, c.id)));
}
// la langue de la réplique : la préférence « langue parlée » (Général)
$('#h-say').addEventListener('click', () => {
  const pre = `(S1) says: <d>[${prefs.get('general.langue', 'fr') === 'en' ? 'English' : 'French'}] `;
  insertAt(writeIn(), pre + '…</d>', { select: [pre.length, pre.length + 1] });
});
$('#h-excl').addEventListener('click', () => insertAt(writeIn(), 'No text, subtitles, logos or watermarks of any kind, keep the live-action texture.'));
$$('#aides-tabs .pp-tab').forEach((b) => b.addEventListener('click', () => { S.aides = b.dataset.tab; paintAides(); }));
function paintAides() {
  $$('#aides-tabs .pp-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.aides));
  $$('[data-pop="aides"] .pp-body > [data-tab]').forEach((n) => { n.hidden = n.dataset.tab !== S.aides; });
}

// ── le Multishot, dans la barre ─────────────────────────────
// Allumé, la frise prend la place de l'invite ; chaque geste réécrit l'invite ([Shot n], répliques) ;
// éteint, l'invite garde ce texte et reste modifiable ; rallumé après une modification à la main,
// la frise relit l'invite.
function msMentions() {
  if (!E || F.mode !== 'r2v') return [];
  return Object.entries(E.tokens()).map(([k, t]) => ({ token: '@' + k, label: t.it?.title || '', thumb: t.it?.thumb_url ? href(t.it.thumb_url) : (t.it?.kind === 'image' ? href(t.it.url) : '') }));
}
const lang = () => F.ms.lang || (prefs.get('general.langue', 'fr') === 'en' ? 'en' : 'fr');
// le texte des plans ; des plans tous vides n'écrivent rien (l'invite vide dit ce qui manque)
function msText(shots, o = { lang: lang(), durations: !!F.ms.durations }) {
  if (!shots?.length || shots.every((p) => !(p.text || '').trim() && !(p.lines || []).some((l) => (l.text || '').trim()))) return '';
  return compose(shots.map((p) => ({ ...p, secs: (p.frames || 0) / FPS })), o);
}
function msMount(shots) {
  const grid = (S.opts.frames || []).map((f) => f.frames);
  M = createMultishot($('#ms'), {
    total: F.frames, grid, shots, desc: F.p[F.mode].desc, lang: lang(), durations: F.ms.durations,
    mentions: msMentions,
    onchange: (st) => {
      F.ms.shots = st.shots; F.ms.lang = st.lang; F.ms.durations = st.durations;
      const t = msText(st.shots, st);
      F.p[F.mode].desc = t;
      descEl.value = t;
      changed();
    },
    ontotal: (frames) => { F.frames = frames; },
    drop: { kinds: KINDS, via: 'movie', onitems: async (items) => { const toks = []; await toBar(items, toks); return toks; } },
    bindField: (ta) => E?.bindField(ta),
  });
}
// La frise suit l'état : ses plans s'ils écrivent encore l'invite ; sinon (l'invite changée à la main, ou
// reprise d'une vidéo) elle relit l'invite — ses [Shot n], ou ses phrases.
function syncMultishot() {
  const on = !!F.ms.on && !!S.opts;
  $('#ms').hidden = !on;
  $('#pb-text').hidden = on;
  if (!on) { syncFields(); return; }
  const desc = F.p[F.mode].desc;
  const fits = F.ms.shots?.length && msText(F.ms.shots) === desc;
  if (!M) msMount(fits ? F.ms.shots : null);
  else M.set({ shots: fits ? F.ms.shots : null, desc, total: F.frames });
  M.refresh();
}
function toggleMultishot() {
  F.ms.on = !F.ms.on;
  syncMultishot();
  if (F.ms.on) {
    const st = M.get();
    F.ms.shots = st.shots;
    const t = msText(st.shots, st);
    if (t !== F.p[F.mode].desc && t) { F.p[F.mode].desc = t; descEl.value = t; }
  }
  changed();
  (F.ms.on ? $('#ms .ms-ta') : descEl)?.focus();
}

// ── LoRA ────────────────────────────────────────────────────
async function loadLoras() {
  try {
    const r = await api('movie/loras');
    S.loras = r.loras; S.loraMachine = r.machine;
    $('#lora-count').textContent = r.loras.length ? `${r.loras.length} installés · ${r.machine}` : '';
    if (!r.loras.length) $('#loras').replaceChildren(el('span', { class: 'why' }, r.why || 'aucun LoRA H3 trouvé'));
  } catch (e) { $('#loras').replaceChildren(el('span', { class: 'why' }, e.message)); }
  paintLoras();
}
$('#lora-refresh').addEventListener('click', loadLoras);
function paintLoras() {
  if (!S.loras.length) return;
  const accel = S.loras.filter((l) => l.accel && !l.recipe);
  // la pile de la recette (People 0,6 → DY 0,6 → Turbo v4) : toujours posée, montrée cochée et figée
  const pile = S.loras.filter((l) => l.recipe).map((l) => el('div', { class: 'lora on recipe', title: l.note || '' },
    el('label', { class: 'lh' }, el('input', { type: 'checkbox', checked: true, disabled: true }), el('b', {}, l.nom),
      el('input', { class: 'fld force', value: l.force, disabled: true, 'aria-label': 'force' }))));
  put($('#loras'), ...pile, ...S.loras.filter((l) => !l.accel && !l.recipe).map((l) => {
    const st = F.loras[l.name] || (F.loras[l.name] = { on: false, strength: l.force });
    const fits = l.modes.includes(F.mode);
    const off = l.accel || !fits;
    if (off && st.on) { st.on = false; quietSave(); }
    const force = el('input', { class: 'fld force', inputmode: 'decimal', value: st.strength, 'aria-label': 'force', disabled: off || null,
      onchange: (e) => { const v = parseFloat(e.target.value.replace(',', '.')); st.strength = isFinite(v) ? Math.max(0, Math.min(2, v)) : l.force; e.target.value = st.strength; changed(); } });
    return el('div', { class: 'lora' + (st.on ? ' on' : '') + (off ? ' off' : ''), title: [l.note, l.warn ? 'décision de Cal : exclu pour ses personnages' : ''].filter(Boolean).join('\n') },
      el('label', { class: 'lh' },
        el('input', { type: 'checkbox', checked: st.on || null, disabled: off || null, onchange: (e) => { st.on = e.target.checked; changed(); paintLoras(); } }),
        // un LoRA de moodboard d'Idéation, entraîné par le portail (server/tools/lora.py)
        el('b', {}, l.nom), l.moodboard ? el('span', { class: 'lbl mb', title: l.trigger ? `mot déclencheur « ${l.trigger} »` : '' }, 'moodboard') : null, force),
      !fits && !l.accel ? el('span', { class: 'why' }, `pas pour ce mode : ${l.modes.map((m) => MODE_FR[m]).join(', ')}`) : null,
      l.warn ? el('span', { class: 'warn-t' }, 'exclu pour les personnages de Cal') : null);
  }), accel.length ? el('details', { class: 'accel' },
    el('summary', {}, el('span', { class: 'lbl' }, `${accel.length} autres accélérateurs · la recette pose le Turbo v4`)),
    el('div', { class: 'accel-list' }, ...accel.map((l) => el('span', { title: l.name }, l.nom)))) : null);
}

// ── le format, la qualité, la résolution ────────────────────
// L'échelle du serveur quand il la donne (opts.formats : [{ id, label, sub, sizes: [{ w, h, label }] }]) ; sinon
// les toiles de /api/movie/options rangées par famille (server/tools/movie.py, CANVASES et FAMILIES). Le temps de
// chaque toile vient du plan (pl.canvases, même préréglage, même durée).
function formats() {
  const o = S.opts;
  if (!o) return [];
  const pl = S.plan;
  const list = Array.isArray(o.formats) && o.formats.length
    ? o.formats.map((f) => ({ id: f.id, label: f.label || f.id, sub: f.sub || '', sizes: (f.sizes || []).map((c) => ({ ...c, family: f.id })) }))
    : o.families.map((f) => ({ id: f, label: (FAM_FR[f] || [f])[0], sub: (FAM_FR[f] || [])[1] || '',
      sizes: o.canvases.filter((c) => c.family === f) }));
  // en Images, avec une image : « d'après l'image » (la règle du nœud)
  const auto = F.mode === 'i2v' ? (pl?.canvases || []).find((c) => c.family === 'image') : null;
  if (auto) list.unshift({ id: 'image', label: FAM_FR.image[0], sub: FAM_FR.image[1], sizes: [{ ...auto, auto: true }] });
  const est = new Map((pl?.canvases || []).map((c) => [`${c.w}x${c.h}`, c.estimate]));
  for (const f of list) {
    f.sizes = f.sizes.map((c) => ({ ...c, estimate: c.estimate || est.get(`${c.w}x${c.h}`) || null })).sort((a, b) => a.w * a.h - b.w * b.h);
    f.ratio = f.sizes.length ? f.sizes[f.sizes.length - 1].w / f.sizes[f.sizes.length - 1].h : 1;
  }
  return list;
}
const presetWH = () => S.opts?.methods.find((m) => m.id === F.method)?.canvas || [1536, 640];
// la toile choisie, en clair : [w, h], 'auto', ou celle du préréglage
function canvasNow() {
  const cv = F.canvas[F.mode];
  if (cv === 'auto') return { auto: true, w: S.plan?.width, h: S.plan?.height };
  if (Array.isArray(cv)) return { w: cv[0], h: cv[1] };
  const [w, h] = presetWH();
  return { w, h, preset: true };
}
function formatNow(list = formats()) {
  const c = canvasNow();
  if (c.auto) return list.find((f) => f.id === 'image') || null;
  return list.find((f) => f.sizes.some((s) => s.w === c.w && s.h === c.h)) || list.find((f) => f.id === F.fam[F.mode]) || list[0] || null;
}
function setCanvas(w, h, fam) {
  const [pw, ph] = presetWH();
  F.canvas[F.mode] = fam === 'image' ? 'auto' : w === pw && h === ph ? null : [w, h];
  if (fam) F.fam[F.mode] = fam;
  changed(); paintFmt();
}
// un autre format : la toile de ce format la plus proche de l'aire actuelle
function pickFormat(f) {
  if (f.id === 'image') { setCanvas(0, 0, 'image'); return; }
  const c = canvasNow();
  const area = (c.w || 1536) * (c.h || 640);
  const best = f.sizes.reduce((b, s) => (!b || Math.abs(Math.log((s.w * s.h) / area)) < Math.abs(Math.log((b.w * b.h) / area)) ? s : b), null);
  if (best) setCanvas(best.w, best.h, f.id);
}
const glyph = (ratio, cls = '') => el('span', { class: 'v-ratio ' + cls, style: { aspectRatio: String(Math.max(0.4, Math.min(2.6, ratio || 1))) } });
function paintFmt() {
  const box = $('[data-pop="fmt"]');
  if (box.hidden || !S.opts) return;
  const list = formats(), cur = formatNow(list), c = canvasNow(), pl = S.plan;
  const keep = box.querySelector('.pp-body')?.scrollTop || 0;
  const head = el('div', { class: 'pp-h' }, el('span', { class: 'lbl' }, 'Format · qualité · résolution'),
    el('span', { class: 'lbl pp-sum' }, pl ? `${pl.width}×${pl.height} · ${secFr(pl.seconds)} · ≈ ${rngShort(pl.estimate)}` : ''), el('span', { class: 'sp' }),
    el('button', { class: 'pp-x', type: 'button', title: 'fermer (Échap)', 'aria-label': 'fermer', onclick: () => togglePop('fmt') }, '×'));
  const fmts = el('div', { class: 'v-fmts', role: 'radiogroup', 'aria-label': 'format' }, ...list.map((f) => el('button', {
    class: 'v-fmt' + (f === cur ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': f === cur ? 'true' : 'false',
    title: `${f.label}${f.sub ? ' · ' + f.sub : ''} — ${f.sizes.map((s) => `${s.w}×${s.h}`).join(', ')}`, onclick: () => pickFormat(f) },
  glyph(f.ratio), el('b', {}, f.label), el('small', {}, f.sub))));
  const meths = el('div', { class: 'v-qs', role: 'radiogroup', 'aria-label': 'qualité' }, ...S.opts.methods.map((m) => el('button', {
    class: 'v-q' + (F.method === m.id ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': F.method === m.id ? 'true' : 'false', title: m.note,
    onclick: () => { if (F.method !== m.id) { F.method = m.id; F.steps = ''; changed(); paintFmt(); } } },
  el('b', {}, m.label), el('span', {}, m.id === 'brouillon' ? 'rapide, deux étages' : 'le rendu final, un étage'),
  el('i', {}, pl?.presets?.[m.id] ? `≈ ${rngShort(pl.presets[m.id])}` : m.cal.what))));
  const rows = (cur?.sizes || []).map((s) => {
    const on = s.auto ? c.auto : !c.auto && s.w === c.w && s.h === c.h;
    const native = !s.auto && s.w === presetWH()[0] && s.h === presetWH()[1];
    return el('button', { class: 'cv-row' + (on ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', title: s.source || '',
      onclick: () => setCanvas(s.w, s.h, cur.id) },
    el('b', {}, s.auto && !s.w ? 'd’après l’image' : `${s.w} × ${s.h}`),
    el('span', { class: 'cv-l' }, native ? `la recette du ${S.opts.methods.find((m) => m.id === F.method)?.label.toLowerCase()}` : s.label || ''),
    el('span', { class: 'cv-e' }, s.estimate ? rngShort(s.estimate) : '—'));
  });
  const body = el('div', { class: 'pp-body' },
    el('div', { class: 'v-sec' }, el('span', { class: 'lbl' }, 'Format'), fmts),
    el('div', { class: 'v-sec' }, el('span', { class: 'lbl' }, 'Qualité'), meths),
    el('div', { class: 'v-sec' }, el('span', { class: 'lbl' }, `Résolution · ${cur?.label || ''}`),
      el('div', { class: 'canvases', role: 'radiogroup', 'aria-label': 'résolution' }, ...rows)),
    pl ? el('p', { class: 'hint' }, `${pl.estimate.basis}. Chargement du modèle, image et son compris ; le premier rendu après un démarrage d’H3 est plus long.`) : null);
  box.replaceChildren(head, body);
  body.scrollTop = keep;
}

// ── la durée : les pas d'H3 (la grille 17k+5 à 24 i/s, lue dans /api/movie/options) ──
function durIndex() {
  const fr = S.opts?.frames || [];
  let k = 0;
  fr.forEach((f, i) => { if (Math.abs(f.frames - F.frames) < Math.abs(fr[k].frames - F.frames)) k = i; });
  return k;
}
function setFrames(frames) {
  if (frames === F.frames) return;
  F.frames = frames;
  if (F.ms.on && M) M.setTotal(frames);   // la fin de la frise suit ; le dernier plan prend l'écart
  changed();
}

// ── les puces de la barre ───────────────────────────────────
function chip(label, { value = '', onclick, title = '', cls = '', off = '', open = false, glyphOf = null, small = '' } = {}) {
  return el('button', { class: `pc ${cls}${open ? ' on' : ''}`.trim(), type: 'button', 'aria-haspopup': 'true',
    'aria-expanded': open ? 'true' : null, title: off || title || null, 'aria-disabled': off ? 'true' : null,
    onclick: (e) => { if (off) { toast(off, 5000); return; } onclick(e.currentTarget); } },
  glyphOf ? glyph(glyphOf, 'sm') : null,
  label ? el('span', { class: 'pc-l' }, label) : null,
  value ? el('b', {}, value) : null,
  small ? el('small', { class: 'pc-s' }, small) : null);
}
// un petit menu qui s'ouvre vers le haut, au-dessus de sa puce (la barre est en bas)
function up(anchor, items) {
  const r = anchor.getBoundingClientRect();
  const { node } = menu(r.left, r.top, items);
  if (!node) return;
  const h = node.getBoundingClientRect().height;
  node.style.top = `${Math.max(8, r.top - h - 6)}px`;
}
function advAlt() {
  const pl = S.plan;
  const unetDef = (S.opts?.unets?.[pl?.weights] || []).find((u) => u.defaut)?.f;
  return [F.seed ? `graine ${F.seed}` : '', F.steps ? `${F.steps} pas` : '',
    pl?.loras?.length ? `${pl.loras.length} LoRA` : '', F.adv.crf ? `crf ${F.adv.crf}` : '',
    pl && unetDef && pl.unet !== unetDef ? pl.unet_nom : '', F.mode === 'r2v' && F.refSize === 'max' ? 'détail max' : ''].filter(Boolean);
}
function paintChips() {
  const box = $('#pb-chips');
  if (!box || !S.opts) return;
  const pl = S.plan;
  const list = formats(), cur = formatNow(list), c = canvasNow();
  const meth = S.opts.methods.find((m) => m.id === F.method);
  const fr = S.opts.frames || [];
  const k = durIndex();
  const step = (d) => { const j = Math.max(0, Math.min(fr.length - 1, k + d)); setFrames(fr[j].frames); };
  const nShots = F.ms.on && F.ms.shots ? F.ms.shots.length : 0;
  const snd = [F.p[F.mode].sound.trim() ? 'ambiance' : '', F.p[F.mode].music.trim() ? 'musique' : ''].filter(Boolean).join(' · ');
  const notes = pl?.notes?.length || 0;
  const alt = advAlt();
  const wh = c.auto ? (pl ? `${pl.width}×${pl.height}` : 'd’après l’image') : `${c.w}×${c.h}`;
  box.replaceChildren(
    el('span', { class: 'pc-seg', role: 'tablist', 'aria-label': 'mode' }, ...['t2v', 'i2v', 'r2v'].map((m) => el('button', {
      class: F.mode === m ? 'on' : '', type: 'button', role: 'tab', 'aria-selected': F.mode === m ? 'true' : 'false',
      title: `${MODE_FR[m].replace(/^./, (x) => x.toUpperCase())} : ${MODE_TIP[m]}`, onclick: () => setMode(m) }, MODE_SHORT[m]))),
    chip('', { value: cur?.label || '', glyphOf: cur?.ratio, open: S.pop === 'fmt', cls: 'fmt',
      title: `format · ${cur?.sub || ''}${c.auto ? '' : ` · ${c.w} × ${c.h}`}`, onclick: () => togglePop('fmt') }),
    chip('', { value: `${meth?.label || ''} · ${wh}`, small: pl ? `≈ ${rngShort(pl.estimate)}` : '', open: S.pop === 'fmt', cls: 'res',
      title: `qualité et résolution — le temps estimé de ce plan sur H3${pl ? ` : ${rng(pl.estimate)}` : ''}`, onclick: () => togglePop('fmt') }),
    el('span', { class: 'pc count dur', title: `durée : ${fr[k]?.frames || F.frames} images à 24 i/s — les pas d’H3 (17 images), de ${secFr(fr[0]?.seconds || 5.17)} à ${secFr(fr[fr.length - 1]?.seconds || 15.08)}` },
      el('button', { type: 'button', 'aria-label': 'plus court', disabled: k <= 0 ? true : null, onclick: () => step(-1) }, '−'),
      el('b', { role: 'button', tabindex: 0, title: 'toutes les durées', onclick: (e) => up(e.currentTarget.parentElement, [{ head: 'Durée' },
        ...fr.map((f) => ({ label: secFr(f.seconds), sub: `${f.frames} im.`, checked: f.frames === (fr[k]?.frames), onclick: () => setFrames(f.frames) }))]) },
      secFr(fr[k]?.seconds || F.frames / 24)),
      el('button', { type: 'button', 'aria-label': 'plus long', disabled: k >= fr.length - 1 ? true : null, onclick: () => step(1) }, '+')),
    chip('Multishot', { value: nShots ? `${nShots} plans` : '', cls: 'ms-chip' + (F.ms.on ? ' set' : ''), open: F.ms.on,
      title: F.ms.on ? 'éteindre le multishot : l’invite garde le texte des plans' : 'découper la vidéo en plans : une frise, un texte et des répliques par plan',
      onclick: toggleMultishot }),
    chip('Son', { value: snd, cls: snd ? 'set' : '', open: S.pop === 'son', title: 'le son d’ambiance et la musique hors champ (H3 rend le son avec l’image)', onclick: () => togglePop('son') }),
    chip('Aides', { open: S.pop === 'aides', title: 'caméra, réplique, exclusions, assistant', onclick: () => togglePop('aides') }),
    chip('Avancé', { value: alt.join(' · '), cls: 'adv' + (alt.length ? ' set' : ''), open: S.pop === 'adv',
      title: 'pas, graine, LoRA, modèle, compression, détail des références, le graphe', onclick: () => togglePop('adv') }),
    chip('Reçu par H3', { value: notes ? String(notes) : '', cls: 'recu', open: S.pop === 'recu',
      title: `ce que le modèle reçoit : le prompt compilé, les images dans l’ordre, la toile, la durée${notes ? ` — ${notes} note${notes > 1 ? 's' : ''} du serveur` : ''}`,
      onclick: () => togglePop('recu') }));
}

// ── les panneaux au-dessus de la barre ──────────────────────
function togglePop(id) {
  S.pop = S.pop === id ? null : id;
  $$('#pops > .pb-pop').forEach((n) => { n.hidden = n.dataset.pop !== S.pop; });
  if (S.pop === 'fmt') paintFmt();
  if (S.pop === 'recu') paintRecu();
  if (S.pop === 'aides') paintAides();
  if (S.pop === 'adv' && !S.plan?.graph) runPlan();
  paintChips();
}
$$('#pops .pp-x').forEach((b) => b.addEventListener('click', () => togglePop(S.pop)));
// un panneau se ferme par Échap ou un clic hors de la barre
addEventListener('pointerdown', (e) => {
  if (!S.pop || $('#pbar').contains(e.target) || e.target.closest?.('.sr-menu, .scrim, .fv, .sr-dock, aside')) return;
  togglePop(S.pop);
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !S.pop || document.querySelector('.sr-menu, .scrim, .fv')) return;
  togglePop(S.pop);
});

// ── ce que H3 reçoit ────────────────────────────────────────
// Le plan résolu par le serveur (/api/movie/plan) : le prompt compilé, les images dans l'ordre où H3 les charge, la
// toile, la durée, les notes. La route d'aperçu de l'audit (POST /api/movie/apercu : la mise en forme de l'invite par
// le modèle de texte) s'y ajoute dès que /api/movie/options l'annonce (`apercu`) ; sans elle, sa place reste masquée.
async function apercu() {
  if (!S.opts?.apercu) return null;   // la route de l'audit s'annonce dans /api/movie/options ; sans elle, rien
  try { return await api('movie/apercu', { method: 'POST', body: { mode: F.mode, params: params(F.mode) } }); } catch { return null; }
}
async function paintRecu() {
  const box = $('#recu');
  const pl = S.plan;
  if (!pl) { box.replaceChildren(el('p', { class: 'hint' }, 'le plan se résout…')); return; }
  const words = (pl.desc || '').trim() ? pl.desc.trim().split(/\s+/).length : 0;
  $('#recu-sum').textContent = `${MODE_FR[pl.mode]} · ${pl.width}×${pl.height} · ${pl.frames} im. · ${secFr(pl.seconds)} · ${pl.steps} pas`;
  const pics = (pl.pictures || []).map((p) => el('div', { class: 'v-pic', title: [p.label, p.role].filter(Boolean).join(' · ') },
    el('span', { class: 'v-pic-im', style: bg(p.thumb_url) }), el('b', {}, p.tag), el('small', {}, p.label || p.role || '')));
  const subj = (pl.subjects || []).map((s) => `${s.token} → ${s.tag} (${s.pictures.join(', ')})`);
  const kids = [
    pl.notes.length ? el('ul', { class: 'v-notes' }, ...pl.notes.map((n) => el('li', {}, n))) : null,
    pics.length ? el('div', { class: 'v-sec' }, el('span', { class: 'lbl' }, `Images chargées, dans l’ordre · ${pics.length}`), el('div', { class: 'v-pics' }, ...pics)) : null,
    subj.length || (pl.videos || []).length || (pl.audios || []).length ? el('div', { class: 'v-sec' }, el('span', { class: 'lbl' }, 'Étiquettes'),
      el('p', { class: 'v-tags' }, [...subj, ...(pl.videos || []).map((v) => `${v.token} → ${v.tag}`), ...(pl.audios || []).map((a) => `${a.token || 'bande-son'} → ${a.tag}`)].join(' · '))) : null,
    el('div', { class: 'v-sec' }, el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Le prompt envoyé'), el('span', { class: 'sp' }),
      el('span', { class: 'lbl' + (words && words < 60 ? ' low' : ''), title: 'les guides MiniMax visent 350 à 500 mots pour la description' }, `${words} mot${words > 1 ? 's' : ''} · visé 350–500`)),
    el('pre', { class: 'sent' }, pl.prompt_sent || (pl.ok ? '' : `rien encore : ${pl.errors[0] || ''}`))),
    el('div', { class: 'v-sec', id: 'apercu', hidden: true }),
  ];
  put(box, ...kids);
  const r = await apercu();
  if (!r || S.pop !== 'recu') return;
  const ap = $('#apercu');
  ap.hidden = false;
  ap.replaceChildren(el('span', { class: 'lbl' }, r.titre || 'mis en forme pour H3'), el('pre', { class: 'sent' }, r.prompt || r.prompt_sent || JSON.stringify(r, null, 1)));
}

// ── réglages avancés ────────────────────────────────────────
function paintAdv() {
  const o = S.opts;
  if (!o) return;
  const w = o.modes.find((m) => m.id === F.mode).weights;
  const a = F.adv;
  const sel = (id, list, cur) => { const s = $(id); s.replaceChildren(...list.map((x) => el('option', { value: x.v, title: x.t || '' }, x.n))); s.value = cur ?? list[0].v; };
  sel('#a-unet', o.unets[w].map((u) => ({ v: u.f, n: u.nom, t: u.note })), a['unet_' + w]);
  $('#a-crf').value = a.crf || '';
}
$('#a-unet').addEventListener('change', (e) => { F.adv['unet_' + S.opts.modes.find((m) => m.id === F.mode).weights] = e.target.value; changed(); });
$('#a-crf').addEventListener('input', (e) => { F.adv.crf = e.target.value.replace(/[^0-9]/g, ''); changed(); });
function paintOutput() {
  const o = S.opts, pl = S.plan;
  if (!o) return;
  if (!o.methods.some((m) => m.id === F.method)) F.method = o.default_method || o.methods[0].id;
  const meth = o.methods.find((m) => m.id === F.method);
  const steps = pl?.steps;
  $('#step-presets').replaceChildren(...meth.steps.map((s) => el('button', { class: 'tb' + (Number(F.steps || steps) === s ? ' on' : ''), type: 'button',
    onclick: () => { F.steps = String(s); $('#steps').value = F.steps; changed(); paintOutput(); } },
  `${s}${s === meth.default_steps ? ' · recette' : ''}`)));
  if (document.activeElement !== $('#steps')) $('#steps').value = F.steps;
  $('#steps').placeholder = steps ? `auto · ${steps}` : 'auto';
  const rec = o.recipe || {};
  $('#profile').replaceChildren(el('b', {}, `${meth.label}${pl ? ` · ${pl.width} × ${pl.height}` : ''}${pl?.draft ? ` (depuis ${pl.draft[0]} × ${pl.draft[1]})` : ''}${steps ? ' · ' + steps + ' pas' : ''}`),
    el('span', {}, `La recette de Cal : ${(rec.loras || []).map((l) => `${l.name.replace('.safetensors', '')} ${String(l.strength).replace('.', ',')}`).join(' → ')} ; ${rec.attention || ''} ; ${rec.sampler || ''}, planning ${rec.scheduler || ''}.`));
  if (document.activeElement !== $('#seed')) $('#seed').value = F.seed;
  $('#adv-sum').textContent = advAlt().join(' · ');
  paintSeedOrig();
}
function paintSeedOrig() {
  const b = $('#seed-orig');
  b.hidden = F.origSeed === null || F.origSeed === undefined;
  b.title = b.hidden ? '' : `la graine de la vidéo réutilisée : ${F.origSeed} — la même recette refait le même plan`;
}
$('#steps').addEventListener('input', (e) => { F.steps = e.target.value.replace(/[^0-9]/g, ''); if (e.target.value !== F.steps) e.target.value = F.steps; changed(); });
$('#seed').addEventListener('input', (e) => { F.seed = e.target.value.replace(/[^0-9]/g, ''); if (e.target.value !== F.seed) e.target.value = F.seed; changed(); });
$('#seed-rand').addEventListener('click', () => { F.seed = String(Math.floor(Math.random() * 2 ** 31)); $('#seed').value = F.seed; changed(); });
$('#seed-orig').addEventListener('click', () => { if (F.origSeed == null) return; F.seed = String(F.origSeed); $('#seed').value = F.seed; changed(); });
$('#adv-graph').addEventListener('toggle', () => { if ($('#adv-graph').open) runPlan(); });

function params(mode = F.mode) {
  const p = F.p[mode];
  const w = S.opts?.modes.find((m) => m.id === mode)?.weights;
  const out = {
    desc: p.desc, sound: p.sound, music: p.music, method: F.method, frames: F.frames,
    steps: F.steps ? Number(F.steps) : null, seed: F.seed === '' ? null : Number(F.seed),
    canvas: F.canvas[mode], speech_lang: prefs.get('general.langue', 'fr') === 'en' ? 'en' : 'fr',
    loras: S.loras.filter((l) => F.loras[l.name]?.on && l.modes.includes(mode) && !l.accel).map((l) => ({ name: l.name, strength: F.loras[l.name].strength })),
    adv: { unet: F.adv['unet_' + w], crf: F.adv.crf || null },
  };
  if (mode === 'i2v') { out.start = F.start; out.end = F.end; }
  if (mode === 'r2v') { out.inputs = E ? E.get() : F.inputs; out.ref_image_size = F.refSize; }
  // les plans du Multishot, pour que « Réutiliser » rouvre la frise telle quelle (le prompt, lui, les porte déjà)
  if (F.ms.on && F.ms.shots) out.multishot = { shots: F.ms.shots.map(({ frames, text, lines }) => ({ frames, text, lines })), lang: lang(), durations: !!F.ms.durations };
  return out;
}

// ── le plan résolu par le serveur ───────────────────────────
let planT = null;
function schedulePlan() { clearTimeout(planT); planT = setTimeout(runPlan, 220); }
async function runPlan() {
  const seq = ++S.seq, mode = F.mode;
  try {
    const pl = await api('movie/plan', { method: 'POST', body: { mode, params: params(mode), graph: S.pop === 'adv' || $('#adv-graph').open } });
    if (seq !== S.seq || mode !== F.mode) return;
    S.plan = pl;
    paintPlan();
  } catch (e) { $('#why').replaceChildren(el('span', {}, 'le portail ne répond pas : ' + e.message)); $('#go').disabled = true; }
}
// ce qui manque, en peu de mots sous « Générer » (la phrase entière du serveur au survol)
const SHORT = [[/^écrivez la description/, 'décrivez le plan'], [/ajoutez une première image/, 'ajoutez une image'],
  [/^ajoutez une entrée/, 'ajoutez une entrée'], [/ne pointent vers rien/, 'des jetons sans entrée'],
  [/ne servent qu'en mode Références/, 'les jetons @ : mode Références'], [/^toile/, 'résolution hors limites']];
const short = (e) => SHORT.find(([rx]) => rx.test(e))?.[1] || e;
const FIX = [   // chaque blocage mène à ce qui le lève
  [/première image, une dernière/, () => chooseImage('start')],
  [/ajoutez une entrée/, () => $('#entrees .ent-drop')?.click()],
  [/ne pointent vers rien|mode Références/, () => descEl.focus()],
  [/description|déclencheur/, () => (F.ms.on ? $('#ms .ms-ta') : descEl)?.focus()],
  [/toile/, () => { if (S.pop !== 'fmt') togglePop('fmt'); }],
];
function paintPlan() {
  const pl = S.plan;
  const first = pl.errors[0];
  const fix = first ? FIX.find(([rx]) => rx.test(first)) : null;
  $('#why').replaceChildren(...(first ? [el('span', { class: fix ? 'fix' : '', role: fix ? 'button' : null, tabindex: fix ? 0 : null,
    title: pl.errors.join('\n'), onclick: fix ? () => fix[1](first) : null }, short(first) + (pl.errors.length > 1 ? ` (+${pl.errors.length - 1})` : ''))] : []));
  $('#go').disabled = !pl.ok;
  $('#go').title = pl.ok ? `${pl.width} × ${pl.height} · ${secFr(pl.seconds)} · ${pl.frames} images · ${pl.steps} pas — estimé ${rng(pl.estimate)} (Ctrl + Entrée)` : pl.errors.join('\n');
  $('#go-sub').textContent = pl.ok ? `≈ ${rngShort(pl.estimate)}` : '';
  $('#graph').textContent = pl.graph ? JSON.stringify(pl.graph, null, 1) : (pl.ok ? 'ouvrez ce pli pour le construire' : 'le graphe se construit quand le plan est complet');
  paintOutput();
  paintChips();
  if (S.pop === 'fmt') paintFmt();
  if (S.pop === 'recu') paintRecu();
}
$('#go').addEventListener('click', launch);
async function launch() {
  const pl = S.plan;
  if (!pl?.ok) { if (pl?.errors?.[0]) toast(pl.errors[0], 5000); return; }
  const mode = F.mode;
  $('#go').disabled = true;
  try {
    const title = (F.p[mode].desc.replace(/\[Shot \d+\]\s*/g, '').replace(/@([\p{L}\p{N}_-]+)/gu, '$1').trim().replace(/\s+/g, ' ') || MODE_FR[mode]).slice(0, 70);
    const j = await jobs.submit('movie.' + mode, params(mode), { title, tool: 'movie' });
    mine(j);
    toast(pl.engine === 'h3' ? 'rendu en file, en tête du fil : H3 démarre s’il dort' : 'rendu en file, en tête du fil · moteur factice : une vidéo d’essai');
  } catch (e) { toast(e.message); }
  finally { $('#go').disabled = !S.plan?.ok; }
}
// un rendu lancé d'ici : il est dans le fil aussitôt, avant le relevé de la file
function mine(j) {
  S.myJobs.add(j.id);
  store.set('movie.myjobs', [...S.myJobs].slice(-40));
  S.seen.add(j.id);
  S.jobs = [j, ...S.jobs.filter((x) => x.id !== j.id)];
  fil?.paintJobs();
}

// ── le moteur ───────────────────────────────────────────────
async function paintEngine() {
  const pill = $('#engine-pill');
  try { S.h3 = await api('movie/h3'); } catch { S.h3 = null; }
  const h = S.h3;
  let cls = 'pill', txt = 'moteur illisible', tip = '';
  if (h?.engine === 'factice') { cls = 'pill work'; txt = 'moteur factice'; tip = 'une vidéo d’essai (mire, vos images, un bip) : pas H3'; }
  else if (h) {
    const upI = h.instances.filter((i) => i.up), st = h.instances.find((i) => i.starting_for != null);
    const sleeper = h.instances.some((i) => i.managed);   // une instance que le gardien démarre
    cls = 'pill ' + (upI.length ? 'on' : st ? 'work' : '');
    txt = upI.length ? `H3 prêt · ${upI.map((i) => i.machine).join(' + ')}` : st ? `H3 démarre · ${st.machine}`
      : sleeper ? 'H3 dort · démarre au rendu' : `H3 ne répond pas · ${h.instances.map((i) => `${i.machine} :${i.port}`).join(', ') || 'aucune instance (lanes.h3)'}`;
    tip = upI.map((i) => `${i.machine} : ${Math.round(i.free_gb ?? 0)} Go libres${i.stops_in != null ? ` · s’arrête dans ${mmss(i.stops_in)}` : ''}`).join('\n');
  }
  pill.className = cls; pill.lastChild.textContent = txt; pill.title = tip;
}

// la recette d'une vidéo, lisible (la visionneuse, le banc)
function recipeRows(it) {
  const p = it.params || {};
  const o = S.opts;
  const unet = o && p.weights ? (o.unets[p.weights]?.find((u) => u.f === p.unet)?.nom || p.unet) : p.unet;
  return [
    ['Mode', MODE_FR[p.mode]],
    ['Préréglage', p.method ? `${o?.methods.find((m) => m.id === p.method)?.label || METH_FR[p.method] || p.method}` : null],
    ['Toile', it.width ? `${it.width} × ${it.height}${p.draft ? ` · depuis ${p.draft[0]} × ${p.draft[1]}` : ''}${p.family ? ' · ' + p.family : ''}` : null],
    ['Durée', it.duration ? `${it.duration.toFixed(2)} s${p.frames ? ` · ${p.frames} images` : ''}${it.fps ? ` · ${it.fps} i/s` : ''}` : null],
    ['Plans', p.request?.multishot?.shots?.length ? `${p.request.multishot.shots.length} · multishot` : null],
    ['Pas', p.steps], ['Graine', p.seed],
    ['Sampler', p.sampler ? `${p.sampler} · ${p.scheduler}` : null],
    ['Modèle', unet],
    ['LoRA', p.method !== undefined ? [...(p.recipe_loras || []), ...(p.loras || [])].map((l) => `${l.name.split('/').pop().replace('.safetensors', '')} × ${l.strength}`)
      .concat(p.turbo ? ['turbo du banc'] : []).join(' → ') || 'aucun' : null],
    ['Entrées', p.mode === 'r2v' ? Object.entries(p.mentions || {}).map(([k, v]) => `${k} → ${v}`).join(' · ') + ` · détail ${p.ref_image_size}` : null],
    ['Images', p.mode === 'i2v' ? [p.start ? 'début' : null, p.end ? 'fin' : null].filter(Boolean).join(' + ') : null],
    ['Son', it.audio ? 'oui, rendu avec l’image' : 'non'],
    ['Moteur', p.engine === 'factice' ? 'factice · vidéo d’essai, pas H3' : it.origin?.model || it.origin?.tool],
    ['Rendu', it.render_seconds != null ? `${mmss(it.render_seconds)}${it.machine ? ' · ' + it.machine : ''}${p.estimate ? ` (estimé H3 ${rng(p.estimate)})` : ''}` : null],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
}

// ── réutiliser : la recette dans le formulaire, graine vidée ──
// les réglages d'envoi d'une vidéo : ceux qu'elle a reçus (`request`, rangés
// depuis le 29/09), sinon refaits depuis sa recette — request_of() du serveur
function requestOf(p) {
  if (p.request && typeof p.request === 'object') return p.request;
  return { desc: p.desc, sound: p.sound, music: p.music, method: p.method, frames: p.frames, steps: p.steps, seed: p.seed,
    canvas: p.family === 'image' ? 'auto' : [p.width, p.height], loras: p.loras || [],
    adv: { unet: p.unet, crf: p.crf }, start: p.start, end: p.end,
    inputs: p.inputs || {}, ref_image_size: p.ref_image_size };
}
const noRecipe = (it) => (it.params?.mode && MODE_FR[it.params.mode] ? '' : 'vidéo sans recette de l’outil Vidéo : déposée, ou faite ailleurs');
function reuse(it) {
  const p = it.params || {};
  const mode = p.mode;
  if (!MODE_FR[mode]) { toast(noRecipe(it)); return; }
  const r = requestOf(p);
  F.mode = mode;
  F.p[mode] = { desc: r.desc ?? it.prompt ?? '', sound: r.sound || '', music: r.music || '' };
  // une vidéo de l'ancien banc (turbo, origine, spectrum) se reprend en Brouillon, à la toile du préréglage
  const old = !PRESETS.includes(r.method);
  F.method = old ? 'brouillon' : r.method; F.frames = r.frames || 124; F.steps = !old && r.steps ? String(r.steps) : '';
  F.seed = ''; F.origSeed = p.seed ?? r.seed ?? null;
  const cv = r.canvas;
  F.canvas[mode] = old || cv == null || cv === 'preset' ? null : cv === 'auto' ? 'auto' : Array.isArray(cv) ? cv.map(Number) : null;
  F.fam[mode] = F.canvas[mode] === 'auto' ? 'image' : !Array.isArray(F.canvas[mode]) ? '2,4:1'
    : (S.opts?.canvases.find((c) => c.w === F.canvas[mode][0] && c.h === F.canvas[mode][1])?.family || p.family || 'paysage');
  if (old) toast('vidéo de l’ancien banc : ses réglages sont repris en Brouillon, la recette de Cal', 6000);
  if (mode === 'i2v') { F.start = r.start || null; F.end = r.end || null; }
  if (mode === 'r2v') { F.inputs = r.inputs || {}; E?.set(F.inputs); F.refSize = r.ref_image_size || 'match'; $('#ref-size').value = F.refSize; }
  // le Multishot : ses plans s'ils ont été rangés ; sinon un prompt en [Shot n] le rallume, relu
  const msr = r.multishot && Array.isArray(r.multishot.shots) ? r.multishot : null;
  F.ms = { on: !!msr || /\[Shot \d+\]/.test(F.p[mode].desc), shots: msr ? msr.shots : null, lang: msr?.lang || null, durations: !!msr?.durations };
  for (const k of Object.keys(F.loras)) F.loras[k].on = false;
  for (const l of r.loras || []) F.loras[l.name] = { on: true, strength: l.strength };
  const adv = r.adv || {};
  if (p.weights) F.adv['unet_' + p.weights] = old ? undefined : adv.unet || p.unet;
  const crf = adv.crf ?? p.crf;
  F.adv.crf = crf && Number(crf) !== 12 ? String(crf) : '';
  if (S.view !== 'create') setView('create');
  setMode(mode);
  syncMultishot();
  (F.ms.on ? $('#ms .ms-ta') : descEl)?.focus();
  toast('réglages repris · graine vidée : « Générer » fait une variante (la graine d’origine : Avancé)', 5500);
}
async function recreate(it, same = false) {
  try {
    const j = await api('movie/redo', { method: 'POST', body: { item: it.id, same_seed: same } });
    mine(j);
    jobs.poll(true);
    toast(same ? 'refait à l’identique, même graine : en tête du fil' : 'recréé, nouvelle graine : en tête du fil');
  } catch (e) { toast(e.message, 6000); }
}
// la première ou la dernière image d'une vidéo, rangée dans la bibliothèque
async function frame(it, which) {
  try { return await api('movie/frame', { method: 'POST', body: { item: it.id, which } }); } catch (e) { toast(e.message, 6000); return null; }
}
async function extract(it, which) {
  const img = await frame(it, which);
  if (img) toast(`« ${img.title} » dans la bibliothèque (Asset) — elle se reprend en image de début, en référence, dans Image`, 6000);
}
// continuer le plan : sa dernière image devient la première d'un nouveau plan
async function continueFrom(it) {
  const img = await frame(it, 'last');
  if (!img) return;
  fil.close();
  if (S.view !== 'create') setView('create');
  setMode('i2v');
  await setImage('start', img);
  toast('la dernière image en début de plan : décrivez la suite', 5000);
}
function asRef(it) {
  fil.close();
  if (S.view !== 'create') setView('create');
  toBar([it]);
}
function toBench(k, it) {
  S.items.set(it.id, it);
  fil.close();
  assign(k, it.id);
}

// ── le panneau Asset (commun/dock.js, Ctrl+Espace) ──────────
// Poser (double-clic, Entrée) fait ce que fait un dépôt sur la barre (toBar) : Images → le début,
// puis la fin ; sinon les entrées, chacune dans sa catégorie (en Texte, on passe en Références) ;
// Comparer → A, puis B. Glisser une vignette sur un plan du Multishot l'y écrit.
const DOCK_CTX = {
  t2v: { kinds: KINDS, label: 'les entrées · mode Références' },
  i2v: { kinds: ['image', 'element'], label: 'la première image, la dernière' },
  r2v: { kinds: KINDS, label: 'les entrées' },
  cmp: { kinds: ['video'], label: 'le banc A/B' },
};
function followDock() { dock.contexte(DOCK_CTX[S.view === 'cmp' ? 'cmp' : F.mode] || null); }
async function dockPlace(items) {
  if (S.view === 'cmp') {
    const v = items.find((x) => x.kind === 'video');
    if (!v) { toast('le banc compare des vidéos'); return false; }
    toBench(!S.A ? 'A' : 'B', v);
    return true;
  }
  return toBar(items);
}
dock.configure({
  label: 'la barre',
  placeLabel: 'Poser dans la barre',
  hint: 'double-clic : dans la barre · glisser : sur la barre, un plan du multishot, A ou B',
  place: (items) => dockPlace(items),
  menu: (it, chosen) => {
    const one = chosen.length === 1;
    if (S.view === 'cmp') {
      return it.kind === 'video' && one ? [{ label: 'En A', onclick: () => toBench('A', it) }, { label: 'En B', onclick: () => toBench('B', it) }] : [];
    }
    const img = one && (it.kind === 'image' || it.kind === 'element');
    return [
      img && F.mode === 'i2v' ? { label: 'En image de début', onclick: () => setImage('start', it) } : null,
      img && F.mode === 'i2v' ? { label: 'En image de fin', onclick: () => setImage('end', it) } : null,
      img && F.mode !== 'i2v' ? { label: 'En image de début', sub: 'mode Images', onclick: () => { setMode('i2v'); setImage('start', it); } } : null,
      F.mode !== 'r2v' ? { label: 'En entrée', sub: 'mode Références', onclick: () => { setMode('r2v'); E?.add(chosen); } } : null,
      it.kind === 'video' && one ? { label: 'Comparer', sub: 'en A', onclick: () => toBench('A', it) } : null,
    ];
  },
});
// la barre entière prend un dépôt (ses emplacements — début, fin, une vignette, un plan — le prennent d'abord)
dropZone($('#pbar'), { kinds: KINDS, multiple: true, via: 'movie', label: 'la barre', onitems: (items) => toBar(items) });
const go = (path) => () => { location.href = href(path); };
function menuFor(it) {
  const id = it.id;
  const vid = it.kind === 'video';
  return [
    { label: 'Extraire une image', icon: '▣', items: [
      { label: 'La première', onclick: () => extract(it, 'first') },
      { label: 'La dernière', onclick: () => extract(it, 'last') },
    ] },
    { label: 'Continuer le plan', icon: '→', sub: 'dernière image', title: 'sa dernière image en première image d’un nouveau plan', onclick: () => continueFrom(it) },
    { label: 'Prendre en référence', icon: '+', sub: '@video', title: 'dans les entrées du mode Références', onclick: () => asRef(it) },
    { label: 'Comparer', icon: '◧', items: [
      { label: 'en A', onclick: () => toBench('A', it) },
      { label: 'en B', onclick: () => toBench('B', it) },
    ] },
    { label: 'Agrandir dans Upscale', icon: '⇱', disabled: !vid, why: 'pas une vidéo', onclick: go(`upscale/?src=${id}`) },
    { label: 'Envoyer au Montage', icon: '▤', studio: true, onclick: go(`montage/?add=${id}`) },   // retiré sans le Studio (commun/menu.js)
    { label: 'Créer un élément', icon: '◆', disabled: true,
      why: 'un élément se fait d’images (et d’une voix) : tirez d’abord une image de la vidéo (⋯ → Extraire une image), puis faites l’élément depuis Image ou Asset' },
  ];
}
function extra(it) {
  const p = it.params || {};
  const out = [];
  if (p.sound || p.music) {
    out.push(el('section', { class: 'fv-sec' },
      p.sound ? el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'Son demandé'), el('p', { class: 'fv-prompt' }, p.sound)) : null,
      p.music ? el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'Musique'), el('p', { class: 'fv-prompt' }, p.music)) : null));
  }
  if (p.prompt_sent) out.push(el('section', { class: 'fv-sec' }, el('details', {}, el('summary', { class: 'lbl' }, 'Le prompt envoyé à H3'), el('pre', {}, p.prompt_sent))));
  if (p.graph) out.push(el('section', { class: 'fv-sec' }, el('details', {}, el('summary', { class: 'lbl' }, 'Le graphe H3'), el('pre', {}, JSON.stringify(p.graph, null, 1)))));
  return out;
}
function badge(it) {
  const p = it.params || {};
  if (!p.mode) return it.origin?.tool === 'upload' ? 'déposée' : (it.origin?.tool || 'vidéo');
  return ['H3', MODE_FR[p.mode], METH_FR[p.method] || '', p.engine === 'factice' ? 'factice' : ''].filter(Boolean).join(' · ');
}

// ── la file dans le fil : les rendus en file, en cours, et mes échecs récents ──
function liveJobs() {
  const recent = (j) => Date.now() - ms(j.finished || j.created) < 3 * 3600e3;
  return S.jobs.filter((j) => !S.gone.has(j.id) && (['queued', 'running'].includes(j.state)
    || (j.state === 'done' && S.seen.has(j.id) && !S.landed.has(j.id))    // arrive : sa vidéo est en route
    || (j.state === 'error' && recent(j) && S.myJobs.has(j.id))))
    .sort((a, b) => ms(b.created) - ms(a.created));
}
function jobLines(j) {
  const run = j.state === 'running';
  const t0 = j.started ? ms(j.started) : null;
  const spent = t0 ? (Date.now() - t0) / 1000 : null;
  const p = j.progress;
  const est = j.estimate || j.params?.estimate;
  let rest = null;
  if (run && p > 0.2 && spent) rest = (spent * (1 - p)) / p;
  else if (run && est && spent != null) rest = (est.low + est.high) / 2 - spent;
  return [MODE_FR[(j.kind || '').split('.')[1]], j.message === 'en file' ? '' : j.message,
    run && spent != null ? `écoulé ${mmss(spent)}` : '',
    run && rest != null ? (rest > 0 ? `restant ≈ ${mmss(rest)}` : 'estimation dépassée · ça continue') : '',
    j.machine];
}
const onJob = {
  cancel: (j) => jobs.cancel(j.id).then(() => toast('rendu arrêté')).catch((e) => toast(e.message)),
  retry: (j) => jobs.retry(j.id).then((n) => { S.gone.add(j.id); mine(n); }).catch((e) => toast(e.message)),
  forget: (j) => { S.gone.add(j.id); jobs.forget(j.id).catch(() => {}); fil.paintJobs(); },
};

function mountFil() {
  fil = createFil($('#fil'), {
    id: 'movie', layout: 'list', title: 'Historique', undo: U,
    scopes: [{ id: 'movie', label: 'Vidéo' }, { id: 'all', label: 'Toute la bibliothèque' }],
    query: ({ scope }) => (scope === 'all' ? 'library?kind=video' : 'library?kind=video&tool=movie'),
    jobs: liveJobs, jobLines, onJob,
    prompt: (it) => it.params?.desc ?? it.prompt ?? '',
    promptLabel: 'Prompt',
    badge,
    chips: (it) => [it.width ? `${it.width}×${it.height}` : '', it.duration ? `${it.duration.toFixed(1).replace('.', ',')} s` : '',
      it.params?.family || '', it.params?.request?.multishot?.shots?.length ? `${it.params.request.multishot.shots.length} plans` : '', it.audio ? 'son' : 'muet'],
    details: (it) => recipeRows(it),
    extra,
    viewerActions: (it) => [
      el('button', { class: 'tb ghost', type: 'button', title: 'la mettre en A du banc', onclick: () => toBench(S.A && S.A !== it.id ? 'B' : 'A', it) }, 'Comparer'),
      el('button', { class: 'tb ghost', type: 'button', title: 'sa dernière image en première image d’un nouveau plan', onclick: () => continueFrom(it) }, 'Continuer'),
    ],
    reuse: { run: reuse, why: noRecipe },
    recreate: {
      run: (it) => recreate(it, false), why: noRecipe,
      more: (it) => [
        { label: 'Nouvelle graine', onclick: () => recreate(it, false) },
        { label: 'À l’identique', sub: 'même graine', onclick: () => recreate(it, true) },
      ],
    },
    menu: menuFor,
    link: (it) => href('movie/#' + it.id),
    empty: 'Décrivez le plan en bas, puis « Générer » : le rendu paraît ici dès l’envoi.',
  });
}

// ── la file ─────────────────────────────────────────────────
let jobsKey = '';
// un rendu fini que la page a vu partir : sa vidéo prend sa place dans le fil
const fetching = new Set();
async function land(j) {
  if (S.landed.has(j.id) || fetching.has(j.id)) return;
  fetching.add(j.id);
  try {
    const full = await jobs.get(j.id);
    if (full.items?.length) { for (const it of full.items) S.items.set(it.id, it); fil?.add(full.items); }
  } catch { /* parti */ }
  S.landed.add(j.id);
  fetching.delete(j.id);
  fil?.paintJobs();
}
jobs.watch((list) => {
  S.allJobs = list;
  // les rendus de l'outil ; ceux que la page vient de lancer restent même avant le relevé
  const fresh = S.jobs.filter((j) => !list.some((x) => x.id === j.id) && ['queued', 'running'].includes(j.state));
  S.jobs = [...fresh, ...list.filter((j) => j.tool === 'movie')];
  for (const j of S.jobs) {
    if (['queued', 'running'].includes(j.state)) S.seen.add(j.id);
    else if (j.state === 'done' && S.seen.has(j.id)) land(j);   // même si la fin a eu lieu entre deux relevés
  }
  const key = S.jobs.map((j) => `${j.id}:${j.state}:${j.progress}:${j.message}`).join('|');
  if (key === jobsKey) return;
  jobsKey = key;
  fil?.paintJobs();
});
document.addEventListener('sr:job', (e) => {
  const j = e.detail;
  if (j.tool !== 'movie') return;
  if (j.state === 'done') { S.seen.add(j.id); land(j); toast(`vidéo prête · ${j.result?.note || ''}`); }
  else if (j.state === 'error') toast('échec : ' + (j.message || '').slice(0, 160));
});
setInterval(() => { if (S.jobs.some((j) => j.state === 'running')) fil?.paintJobs(); }, 1000);   // l'écoulé avance

// ── la barre : sa hauteur (le fil garde sa marge basse) ─────
{
  const box = $('#pbar');
  const setH = () => document.documentElement.style.setProperty('--pbar-h', `${Math.ceil(box.getBoundingClientRect().height)}px`);
  if ('ResizeObserver' in window) new ResizeObserver(setH).observe(box);
  setH();
}

// ── le banc A/B (repris du banc NL de Cal) ──────────────────
const vA = $('#vA'), vB = $('#vB'), mon = $('#monitor'), layA = $('#layA'), layB = $('#layB'), handle = $('#handle');
const zsA = $('#zsA'), zsB = $('#zsB'), scrub = $('#scrub'), fill = $('#fill');
// la vue du banc et la boucle : des préférences de la personne (movie/prefs.json) ;
// l'ancienne clé de ce navigateur sert une fois de départ
const BS = { mode: prefs.get('movie.benchMode', store.get('movie.bench.mode', 'wipe')), listen: 'a', zoom: 1, pan: { x: 0, y: 0 },
  loop: prefs.get('movie.benchLoop', store.get('movie.bench.loop', true)),
  speed: 1, wipe: 50, blinkT: null, seeking: false, volume: 1 };
function assign(k, id) { S[k] = id; if (S.view !== 'cmp') setView('cmp'); else { benchLoad(); syncUrl(); } }
function paintSlots() {
  for (const k of ['A', 'B']) {
    const it = S[k] ? S.items.get(S[k]) : null;
    const p = it?.params || {};
    $('#slot-' + k.toLowerCase()).replaceChildren(
      el('b', { class: 'k' }, k),
      el('div', { class: 'th', style: bg(it?.thumb_url) }),
      el('div', { class: 'ab-txt' }, el('span', { class: 't' }, it ? (it.title || it.id) : 'aucun plan'),
        el('span', { class: 'lbl' }, it ? [p.mode ? MODE_FR[p.mode] : null, p.method || null, it.width ? `${it.width}×${it.height}` : null].filter(Boolean).join(' · ') : 'à choisir, ou déposez une vidéo ici')),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => chooseAB(k) }, 'Choisir'));
  }
}
async function chooseAB(k) { const [it] = await pick({ kinds: ['video'], multiple: false, title: `Plan ${k}` }); if (it) { S.items.set(it.id, it); assign(k, it.id); } }
for (const k of ['A', 'B']) {   // une vidéo déposée sur A ou B : du disque, ou une vignette du fil glissée
  dropZone($('#slot-' + k.toLowerCase()), { kinds: ['video'], multiple: false, via: 'movie', onitems: ([it]) => { S.items.set(it.id, it); assign(k, it.id); } });
}
const master = () => (vA.getAttribute('src') ? vA : vB);
const both = () => [vA, vB].filter((v) => v.getAttribute('src'));
function minDur() { const ds = both().filter((v) => isFinite(v.duration)).map((v) => v.duration); return ds.length ? Math.min(...ds) : 0; }
function fpsOf() { const a = S.items.get(S.A), b = S.items.get(S.B); return (a && a.fps) || (b && b.fps) || 24; }
async function benchLoad() {
  const [a, b] = [await item(S.A), await item(S.B)];
  const t = vA.currentTime || 0;
  for (const [v, it] of [[vA, a], [vB, b]]) {
    const src = it?.url ? href(it.url) : null;
    if (src && v.getAttribute('src') !== src) { v.setAttribute('src', src); v.load(); }
    else if (!src && v.getAttribute('src')) { v.removeAttribute('src'); v.load(); }
    v.playbackRate = BS.speed;
  }
  $('#tagA').textContent = a ? (a.title || a.id) : '';
  $('#tagB').textContent = b ? (b.title || b.id) : '';
  $('#tagA').parentElement.hidden = !a;   // une étiquette sans plan n'a rien à dire
  $('#tagB').parentElement.hidden = !b;
  $('#benchEmpty').hidden = !!(a || b);
  applyAudio();
  const once = (v) => v.addEventListener('loadedmetadata', () => { seekBoth(Math.min(t, minDur())); updateTime(); }, { once: true });
  once(vA); once(vB);
  paintMetas(a, b); paintSlots(); setBenchMode(BS.mode);
}
function seekBoth(t) { BS.seeking = true; both().forEach((v) => { try { v.currentTime = t; } catch { /* pas prête */ } }); setTimeout(() => { BS.seeking = false; }, 30); }
async function play() { const vs = both(); if (!vs.length) return; try { await Promise.all(vs.map((v) => v.play())); } catch { /* geste requis */ } setPlayIcon(); }
function pauseBench() { both().forEach((v) => v.pause()); setPlayIcon(); }
const playing = () => { const m = master(); return m && !m.paused && !m.ended; };
function setPlayIcon() { $('#icoPlay').innerHTML = playing() ? '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>' : '<path d="M7 4l13 8-13 8z"/>'; }
$('#bPlay').addEventListener('click', () => (playing() ? pauseBench() : play()));
setInterval(() => { if (!playing() || BS.seeking) return; const m = master(), o = m === vA ? vB : vA; if (o.getAttribute('src') && isFinite(o.duration) && Math.abs(o.currentTime - m.currentTime) > 0.06) o.currentTime = m.currentTime; }, 200);
[vA, vB].forEach((v) => {
  v.addEventListener('ended', () => { if (v !== master()) return; if (BS.loop) { seekBoth(0); play(); } else pauseBench(); });
  v.addEventListener('timeupdate', updateTime); v.addEventListener('play', setPlayIcon); v.addEventListener('pause', setPlayIcon);
});
function updateTime() {
  const m = master(); if (!m) return;
  const t = m.currentTime || 0, d = minDur() || m.duration || 0, fps = fpsOf();
  $('#tc').firstChild.nodeValue = tcode(t);
  $('#frameNo').textContent = `img ${Math.round(t * fps)} / ${Math.round(d * fps)}`;
  $('#readout').textContent = tcode(t); $('#tlL').textContent = tcode(t); $('#tlR').textContent = tcode(d);
  if (!scrub.matches(':active')) scrub.value = d ? Math.round((t / d) * 1000) : 0;
  fill.style.width = (d ? (t / d) * 100 : 0) + '%';
}
scrub.addEventListener('input', () => { seekBoth((scrub.value / 1000) * minDur()); updateTime(); });
function step(n) { pauseBench(); const m = master(); if (!m) return; seekBoth(Math.max(0, Math.min(minDur(), m.currentTime + n / fpsOf()))); updateTime(); }
$('#bPrev').addEventListener('click', () => step(-1));
$('#bNext').addEventListener('click', () => step(1));
$('#bLoop').classList.toggle('on', BS.loop);
$('#bLoop').addEventListener('click', () => { BS.loop = !BS.loop; $('#bLoop').classList.toggle('on', BS.loop); prefs.set('movie.benchLoop', BS.loop); });
prefs.on('movie.benchLoop', (v) => { BS.loop = v !== false; $('#bLoop').classList.toggle('on', BS.loop); });
prefs.on('movie.benchMode', (v) => { if (v && v !== BS.mode) setBenchMode(v); });
$('#bSwap').addEventListener('click', () => { [S.A, S.B] = [S.B, S.A]; benchLoad(); syncUrl(); });
function seg(id, attr, cb) { $$(`#${id} .tb`).forEach((b) => b.addEventListener('click', () => { $$(`#${id} .tb`).forEach((x) => x.classList.remove('on')); b.classList.add('on'); cb(b.dataset[attr]); })); }
seg('segSpeed', 'v', (v) => { BS.speed = +v; vA.playbackRate = vB.playbackRate = BS.speed; });
seg('segMode', 'm', (m) => setBenchMode(m));
seg('segAudio', 'a', (a) => { BS.listen = a; applyAudio(); });
seg('segZoom', 'z', (z) => zoomAt(+z, null, null));
$('#vol').addEventListener('input', (e) => { BS.volume = e.target.value / 100; vA.volume = vB.volume = BS.volume; });
function setBenchMode(m) {
  BS.mode = m; mon.className = 'monitor mode-' + m; clearInterval(BS.blinkT);
  layA.style.visibility = layB.style.visibility = '';
  if (m === 'blink') { let on = false; BS.blinkT = setInterval(() => { on = !on; layB.style.visibility = on ? 'visible' : 'hidden'; layA.style.visibility = on ? 'hidden' : 'visible'; }, 500); }
  if (m === 'wipe') setWipe(BS.wipe); else layB.style.clipPath = '';   // le rideau pose un découpage en ligne
  $$('#segMode .tb').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  prefs.set('movie.benchMode', m);
}
function applyAudio() {
  const hasA = !!vA.getAttribute('src'), hasB = !!vB.getAttribute('src');
  let src = BS.listen;
  if (src === 'a' && !hasA && hasB) src = 'b';
  if (src === 'b' && !hasB && hasA) src = 'a';
  vA.muted = !(src === 'a' && hasA); vB.muted = !(src === 'b' && hasB);
  vA.volume = vB.volume = BS.volume;
  $('#spkA').classList.toggle('on', !vA.muted); $('#spkB').classList.toggle('on', !vB.muted);
  $$('#segAudio .tb').forEach((b) => b.classList.toggle('on', b.dataset.a === BS.listen));
}
function setWipe(p) { BS.wipe = Math.max(0, Math.min(100, p)); layB.style.clipPath = `inset(0 0 0 ${BS.wipe}%)`; handle.style.left = BS.wipe + '%'; handle.setAttribute('aria-valuenow', Math.round(BS.wipe)); }
const ZMIN = 1, ZMAX = 12;   // zoom continu ancré sous le curseur : le point visé ne bouge pas
function zoomAt(nz, cx, cy) {
  nz = Math.max(ZMIN, Math.min(ZMAX, nz));
  const r = mon.getBoundingClientRect();
  if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
  BS.pan.x = cx - (cx - BS.pan.x) * (nz / BS.zoom); BS.pan.y = cy - (cy - BS.pan.y) * (nz / BS.zoom); BS.zoom = nz;
  if (BS.zoom <= ZMIN + 1e-4) { BS.zoom = ZMIN; BS.pan = { x: 0, y: 0 }; }
  applyZoom();
  const z = BS.zoom;
  $('#zoomBadge').hidden = z <= ZMIN + 1e-4;
  $('#zoomBadge').textContent = `zoom ${z < 10 ? z.toFixed(z % 1 ? 1 : 0) : Math.round(z)}× · glisser pour déplacer`;
  $$('#segZoom .tb').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.z - z) < 0.02));
}
function applyZoom() {
  const r = mon.getBoundingClientRect();
  BS.pan.x = Math.max(-r.width * (BS.zoom - 1), Math.min(0, BS.pan.x)); BS.pan.y = Math.max(-r.height * (BS.zoom - 1), Math.min(0, BS.pan.y));
  zsA.style.transform = zsB.style.transform = `translate(${BS.pan.x.toFixed(2)}px, ${BS.pan.y.toFixed(2)}px) scale(${BS.zoom})`;
  mon.style.cursor = BS.zoom > 1 ? 'grab' : '';
}
mon.addEventListener('wheel', (e) => { e.preventDefault(); const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? mon.clientHeight : 1; const r = mon.getBoundingClientRect(); zoomAt(BS.zoom * Math.exp(-e.deltaY * unit * 0.0022), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
let drag = null;
mon.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const r = mon.getBoundingClientRect();
  const onHandle = BS.mode === 'wipe' && Math.abs(e.clientX - (r.left + (r.width * BS.wipe) / 100)) < 16;
  if (onHandle) drag = { k: 'wipe' };
  else if (BS.zoom > 1) drag = { k: 'pan', x: e.clientX - BS.pan.x, y: e.clientY - BS.pan.y };
  else if (BS.mode === 'wipe') { drag = { k: 'wipe' }; setWipe(((e.clientX - r.left) / r.width) * 100); }
  if (drag) { mon.setPointerCapture(e.pointerId); e.preventDefault(); if (drag.k === 'pan') mon.style.cursor = 'grabbing'; }
});
mon.addEventListener('pointermove', (e) => { if (!drag) return; const r = mon.getBoundingClientRect(); if (drag.k === 'wipe') setWipe(((e.clientX - r.left) / r.width) * 100); else { BS.pan.x = e.clientX - drag.x; BS.pan.y = e.clientY - drag.y; applyZoom(); } });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => mon.addEventListener(ev, () => { drag = null; if (BS.zoom > 1) mon.style.cursor = 'grab'; }));
mon.addEventListener('dblclick', (e) => { const r = mon.getBoundingClientRect(); zoomAt(BS.zoom > 1 ? 1 : 2, e.clientX - r.left, e.clientY - r.top); });
document.addEventListener('keydown', (e) => {
  if (S.view !== 'cmp' || $('.scrim') || $('.fv') || $('.sr-menu')) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); playing() ? pauseBench() : play(); }
  else if (k === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) { pauseBench(); seekBoth(Math.max(0, master().currentTime - 1)); updateTime(); } else step(-1); }
  else if (k === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) { pauseBench(); seekBoth(Math.min(minDur(), master().currentTime + 1)); updateTime(); } else step(1); }
  else if (k === '[') setWipe(BS.wipe - 2); else if (k === ']') setWipe(BS.wipe + 2);
  else if (k === 'l' || k === 'L') $('#bLoop').click(); else if (k === 's' || k === 'S') $('#bSwap').click();
  else if (k === 'a' || k === 'A') { BS.listen = 'a'; applyAudio(); } else if (k === 'b' || k === 'B') { BS.listen = 'b'; applyAudio(); }
  else if (k === 'm' || k === 'M') { BS.listen = '0'; applyAudio(); }
  else if (k === '+' || k === '=') zoomAt(BS.zoom * 1.25, null, null); else if (k === '-') zoomAt(BS.zoom / 1.25, null, null); else if (k === '0') zoomAt(1, null, null);
  else if (k >= '1' && k <= '5') setBenchMode(['wipe', 'side', 'a', 'b', 'blink'][+k - 1]);
});
function paintMetas(a, b) {   // les recettes côte à côte : ce qui diffère est marqué
  const rows = (it) => (it ? Object.fromEntries(recipeRows(it).concat([['Prompt', it.prompt || ''], ['Son demandé', it.params?.sound || '']])) : null);
  const ra = rows(a), rb = rows(b);
  const keys = [...new Set([...(ra ? Object.keys(ra) : []), ...(rb ? Object.keys(rb) : [])])];
  const differs = (k) => ra && rb && k !== 'Rendu' && String(ra[k] ?? '') !== String(rb[k] ?? '');
  const dk = keys.filter(differs);
  const bare = a && b && !a.params?.mode && !b.params?.mode;
  $('#diffline').replaceChildren(!(a && b) ? el('span', { class: 'lbl' }, 'choisissez deux plans pour voir ce qui diffère')
    : bare ? el('span', {}, 'ces vidéos n’ont pas de recette (déposées, pas faites ici) : seuls l’image et le son se comparent')
    : dk.length ? el('span', {}, el('b', {}, `${dk.length} différence${dk.length > 1 ? 's' : ''}`), ' · ' + dk.join(', ').toLowerCase())
      : el('span', {}, 'mêmes réglages : seul le hasard du rendu les sépare'));
  for (const [k, it, r] of [['a', a, ra], ['b', b, rb]]) {
    const box = $('#meta' + k.toUpperCase());
    const head = el('div', { class: 'head' }, el('b', {}, k.toUpperCase()), el('span', { class: 'lbl' }, it ? fmtDate(it.created) : '—'));
    if (!it) { box.replaceChildren(el('span', { class: 'dots' }), head, el('span', { class: 'lbl' }, 'aucun plan')); continue; }
    box.replaceChildren(el('span', { class: 'dots' }), head, el('div', { class: 'name' }, it.title || it.id),
      el('dl', { class: 'kv' }, ...keys.filter((x) => r[x] !== undefined && r[x] !== '').flatMap((x) => {
        const d = differs(x) ? 'diff' : '';
        const long = x === 'Prompt' || x === 'Son demandé' || x === 'Entrées' ? ' long' : '';
        return [el('dt', { class: d }, x), el('dd', { class: (d + long + (x === 'Rendu' ? ' big' : '')).trim() }, String(r[x]))];
      })));
  }
}

// ── dépôt n'importe où ──────────────────────────────────────
// Hors des emplacements (qui prennent le dépôt eux-mêmes) : le fichier entre
// seulement dans la bibliothèque, catégorie Upload, sans rien remplacer.
dropAnywhere(async (files) => {
  let n = 0;
  for (const f of files) {
    try { await uploadFile(f, { tool: 'upload', via: 'movie' }); n++; } catch (e) { toast(`${f.name} : ${e.message}`); }
  }
  if (n) toast(`${n > 1 ? n + ' fichiers rangés' : 'rangé'} dans la bibliothèque · Upload — déposez sur la barre pour vous en servir`);
  fil?.reload();
});

// ── démarrage ───────────────────────────────────────────────
// Adresses : ?mode=t2v|i2v|r2v, ?start=<image>, ?ref=<id>, #<vidéo> (ou ?id=)
// l'ouvre en grand, ?view=cmp&a=<id>&b=<id> le banc.
(async function boot() {
  const q = new URLSearchParams(location.search);
  if (q.get('start')) { F.start = q.get('start'); F.mode = 'i2v'; }
  const refId = q.get('ref');
  if (refId) F.mode = 'r2v';
  if (q.get('mode') && ['t2v', 'i2v', 'r2v'].includes(q.get('mode'))) F.mode = q.get('mode');
  if (q.get('a') || q.get('b')) { S.A = q.get('a'); S.B = q.get('b'); }
  try { S.opts = await api('movie/options'); } catch (e) { toast('options illisibles : ' + e.message); }
  paintCamera();
  if (S.opts) mountEntrees();
  if (refId) { const it = await item(refId); if (it && E) E.add([it]); }   // ?ref=<id> : l'objet entre dans sa catégorie
  mountFil();
  setMode(F.mode);
  syncMultishot();
  // à partir d'ici, chaque changement du formulaire est un geste (le mode suit sans en faire un)
  form = U.snapshots({ get: () => F, set: formRestore, describe: formDescribe, ignore: ['mode'] });
  form.reset();
  setView(q.get('view') === 'cmp' || q.get('a') ? 'cmp' : 'create');
  const want = (location.hash || '').slice(1) || q.get('id');
  if (want) fil.open(want);
  loadLoras();
  // l'état d'H3 relu toutes les 15 s, onglet visible seulement (commun/shell.js, releve)
  releve(paintEngine, 15000, { now: true });
})();
addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (id && id !== fil?.current()?.id) fil?.open(id);
});

// ── le clic droit (Cal, 29/09 : jamais le menu du navigateur) ──
// une vidéo du fil a son menu (commun/fil.js) ; ailleurs, les gestes de la
// vue en tête du menu commun de repli (commun/menu.js, pageMenu) : la
// création (lancer, le mode, les images) ou le banc (lecture, image par image, les plans A et B)
pageMenu(() => {
  if (S.view === 'cmp') {
    return [{ head: 'Vidéo · comparer' },
      { label: playing() ? 'Pause' : 'Lecture', icon: playing() ? '❚❚' : '▶', key: 'Espace', onclick: () => (playing() ? pauseBench() : play()) },
      { label: 'Image précédente', icon: '‹', onclick: () => step(-1) }, { label: 'Image suivante', icon: '›', onclick: () => step(1) },
      '-',
      { label: 'Choisir le plan A…', icon: 'A', onclick: () => chooseAB('A') }, { label: 'Choisir le plan B…', icon: 'B', onclick: () => chooseAB('B') },
      { label: 'Revenir à la création', icon: '‹', onclick: () => setView('create') }];
  }
  const why = S.plan?.errors?.join(' · ') || '';
  return [{ head: `Vidéo · ${MODE_FR[F.mode]}` },
    { label: 'Générer', icon: '▶', key: 'Ctrl+Entrée', disabled: !S.plan?.ok, why: why || 'le plan n’est pas complet', onclick: launch },
    '-',
    ...Object.entries(MODE_FR).map(([m, lab]) => ({ label: lab.charAt(0).toUpperCase() + lab.slice(1), checked: F.mode === m, onclick: () => setMode(m) })),
    { label: 'Multishot', checked: !!F.ms.on, onclick: toggleMultishot },
    F.mode === 'i2v' ? { label: 'Choisir l’image de début…', icon: '▭', onclick: () => chooseImage('start') } : null,
    F.mode === 'i2v' ? { label: 'Choisir l’image de fin…', icon: '▭', onclick: () => chooseImage('end') } : null,
    '-',
    { label: 'Comparer deux plans', icon: '◫', onclick: () => setView('cmp') }];
});
