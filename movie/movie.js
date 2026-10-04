// VIDÉO (ex « Movie Creator », renommé par Cal le 29/09) — des plans vidéo
// avec H3, dans le thème du portail.
//
// Le parcours suit H3 Studio (github.com/underworldhistory1-ctrl/minimax-h3-higgsfield,
// licence MIT, Copyright (c) 2026 Charles Mod) : une colonne de création (carte
// du modèle, modes Texte / Images / Références, les trois champs du prompt H3,
// toiles avec temps estimé, durée ; méthode, pas, graine, LoRA repliés).
// Réécrit ici ; la bibliothèque du portail, la file commune et les éléments
// remplacent leurs fichiers locaux.
//
// Depuis le 29/09, sur le modèle de Higgsfield : les réglages à gauche, le
// fil des vidéos au centre (commun/fil.js), en liste — la grande vidéo et sa
// carte (modèle, prompt aux jetons surlignés, entrées, puces, date) — ; les
// rendus en file et en cours en tête du fil ; au survol, aimer, réutiliser,
// recréer, télécharger, et le menu ⋯ ; un clic ouvre la visionneuse plein
// écran, la molette passe d'une vidéo à l'autre.
//
// Les entrées du mode Références passent par le cadre commun (commun/entrees.js) :
// rangées par sorte, appelées par position — @image1, @element1, @video1,
// @audio1 — vertes si leur place est remplie, rouges sinon (décision de Cal
// du 29/09 : on garde le prompt en changeant les images).
//
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
// entrées, les trois champs une fois écrits, toile, durée, méthode, LoRA,
// réglages avancés) ; aimer, ranger, jeter depuis le fil (le fil les range
// lui-même dans la pile : commun/fil.js, option undo). Ne s'annulent pas : un rendu lancé, une image tirée d'une
// vidéo, un fichier déposé. Le banc « Comparer » est une vue : il ne s'annule pas.
import { mountHeader, api, jobs, pick, uploadFile, toast, el, $, $$, href, fmtDate, dropAnywhere, dropZone, dock } from '../commun/shell.js';
import { createEntrees } from '../commun/entrees.js';
import { createFil } from '../commun/fil.js';
import { createUndo } from '../commun/undo.js';
import { prefs } from '../commun/prefs.js';
import { pageMenu } from '../commun/menu.js';

mountHeader('movie');

const store = {   // commodité du navigateur : le formulaire en cours
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* navigation privée */ } },
};
const MODE_FR = { t2v: 'texte', i2v: 'images', r2v: 'références' };
const METH_FR = { brouillon: 'brouillon', qualite: 'qualité', turbo: 'turbo · ancien banc', origine: 'origine · ancien banc', spectrum: 'spectrum · ancien banc' };
const PRESETS = ['brouillon', 'qualite'];   // la recette de Cal (30/09) : server/tools/movie.py, METHODS
const ROLE_FR = { face: 'visage', 'full body': 'plein pied', expression: 'expression' };
const mmss = (s) => { if (s == null || !isFinite(s)) return '—'; s = Math.max(0, Math.round(s)); return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : `${s} s`; };
const p2 = (n) => String(n).padStart(2, '0');
const tcode = (t) => { if (!isFinite(t)) t = 0; const m = Math.floor(t / 60), s = t - m * 60; return p2(m) + ':' + s.toFixed(2).padStart(5, '0'); };
const bg = (u) => (u ? { backgroundImage: `url(${href(u)})` } : null);
// replaceChildren écrirait « null » : on ne passe que des nœuds
const put = (box, ...kids) => box.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
const rng = (e) => (e ? `${mmss(e.low)} – ${mmss(e.high)}` : '');
const ms = (iso) => Date.parse(iso || '') || 0;

// ── l'état ──────────────────────────────────────────────────
const saved = store.get('movie.v2', {});
const F = {
  mode: prefs.get('movie.mode', 't2v'),   // un formulaire neuf : la préférence (movie/prefs.json)
  p: { t2v: { desc: '', sound: '', music: '' }, i2v: { desc: '', sound: '', music: '' }, r2v: { desc: '', sound: '', music: '' } },
  start: null, end: null, inputs: {}, refSize: 'match',
  // la toile : null = celle du préréglage (Brouillon 1536 × 640, Qualité 1920 × 800) ; une autre se choisit en avancé
  canvas: { t2v: null, i2v: null, r2v: null }, fam: { t2v: '2,4:1', i2v: '2,4:1', r2v: '2,4:1' },
  method: 'brouillon', frames: 124, steps: '', seed: '', origSeed: null, loras: {}, adv: {},
  ...saved,
};
for (const k of ['t2v', 'i2v', 'r2v']) F.p[k] = { desc: '', sound: '', music: '', ...((saved.p || {})[k] || {}) };
// un formulaire gardé d'avant les préréglages (méthodes turbo / origine / spectrum de l'ancien banc) :
// le Brouillon, la toile du préréglage, les pas par défaut — les prompts restent
if (!PRESETS.includes(F.method)) {
  F.method = 'brouillon'; F.steps = '';
  F.canvas = { t2v: null, i2v: null, r2v: null }; F.fam = { t2v: '2,4:1', i2v: '2,4:1', r2v: '2,4:1' };
  delete F.adv.sampler; delete F.adv.scheduler;
}
delete F.refs; delete F.refKind;   // l'ancienne forme (références nommées)
let E = null;   // le cadre des entrées, créé quand les options sont là
let fil = null; // le fil des vidéos (commun/fil.js)
const S = {
  view: 'create', opts: null, plan: null, seq: 0, items: new Map(), jobs: [], allJobs: [], loras: [], loraMachine: '', A: null, B: null, h3: null,
  myJobs: new Set(store.get('movie.myjobs', [])), seen: new Set(), landed: new Set(), gone: new Set(),
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
  ['refSize', 'changer le détail des références'], ['fam', 'changer le format'], ['canvas', 'changer la toile'], ['method', 'changer de méthode'],
  ['frames', 'changer la durée'], ['steps', 'changer le nombre de pas'], ['seed', 'changer la graine'], ['origSeed', 'changer la graine d’origine'],
  ['loras', 'changer les LoRA'], ['adv', 'changer un réglage avancé']];
const TYPED = new Set(['steps', 'seed']);
let typing = 0;   // chaque passage dans un champ : une saisie, un seul geste
function formDescribe(b, a) {
  for (const m of ['t2v', 'i2v', 'r2v']) {
    for (const k of ['desc', 'sound', 'music']) {
      if (b.p?.[m]?.[k] !== a.p?.[m]?.[k]) return { label: FIELD_FR[k], merge: `${m}.${k}#${typing}`, mergeMs: Infinity };
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
}

const save = () => { store.set('movie.v2', F); form?.commit(); };
// un ajustement que la page fait seule (un LoRA qui ne va pas au mode) : gardé, sans faire un geste
const quietSave = () => { store.set('movie.v2', F); form?.reset(); };
function changed() { save(); schedulePlan(); }
async function item(id) {
  if (!id) return null;
  if (S.items.has(id)) return S.items.get(id);
  try { const it = await api('library/' + id); S.items.set(id, it); return it; } catch { S.items.set(id, null); return null; }
}

// ── vues : créer, comparer ──────────────────────────────────
function setView(v) {
  S.view = v;
  document.body.dataset.view = v;
  $$('.rail-tabs [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('#create').hidden = v !== 'create';
  $('#cmp-rail').hidden = v !== 'cmp';
  $('#dock').hidden = v !== 'create';
  $('#view').hidden = v !== 'create';
  $('#bench').hidden = v !== 'cmp';
  if (v === 'cmp') benchLoad(); else pauseBench();
  syncUrl();
  followDock();
}
$$('.rail-tabs [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
// ↶ ↷ et le journal, au bout des onglets de la colonne
$('.rail-tabs').append(el('span', { class: 'sr-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, ...U.buttons()));
$('#rail').addEventListener('focusin', (e) => { if (e.target.matches?.('textarea, input')) typing++; });

function setMode(m) {
  F.mode = m;
  document.body.dataset.mode = m;
  $$('#modes [data-mode]').forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $$('#create [data-for]').forEach((n) => { n.hidden = n.dataset.for !== m; });
  $$('#adv [data-for]').forEach((n) => { n.hidden = n.dataset.for !== m; });
  $('#desc-lbl').textContent = m === 'r2v' ? 'Ce qu’on voit et entend · detailed_description' : 'Ce qu’on voit et entend · integrated_multimodal_description';
  $('#desc').placeholder = PH[m];
  syncFields();
  if (m === 'i2v') { paintSlot('start'); paintSlot('end'); }
  paintLoras();
  paintAdv();
  save(); schedulePlan();
  syncUrl();
  followDock();
}
$$('#modes [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

function syncUrl() {
  const q = new URLSearchParams();
  if (S.view === 'cmp') { q.set('view', 'cmp'); if (S.A) q.set('a', S.A); if (S.B) q.set('b', S.B); }
  else q.set('mode', F.mode);
  try { history.replaceState(null, '', '?' + q + location.hash); } catch { /* aperçu */ }
}

// ── Images : début · fin ────────────────────────────────────
async function paintSlot(which) {
  const box = $(which === 'start' ? '#start-slot' : '#end-slot');
  const it = await item(F[which]);
  if (F[which] && !it) { F[which] = null; save(); }
  box.replaceChildren();
  box.onclick = null;
  if (!it) {
    box.className = 'slot empty';
    box.append(el('button', { class: 'slot-empty', type: 'button', onclick: () => chooseImage(which) },
      el('b', {}, which === 'start' ? '+ début' : '+ fin'), el('span', {}, 'choisir, déposer, ou le plein pied d’un personnage')));
    return;
  }
  box.className = 'slot';
  box.title = 'changer d’image';
  box.append(el('img', { src: href(it.thumb_url || it.url), alt: it.title || '' }),
    el('span', { class: 'cap' }, `${it.width}×${it.height}`),
    el('button', { class: 'x', type: 'button', title: 'retirer', onclick: (e) => { e.stopPropagation(); F[which] = null; changed(); paintSlot(which); } }, '×'));
  box.onclick = () => chooseImage(which);
}
async function chooseImage(which) {
  const [it] = await pick({ kinds: ['image', 'element'], multiple: false, title: which === 'start' ? 'Image de début' : 'Image de fin' });
  if (it) setImage(which, it);
}
// Déposer sur un emplacement : un fichier du disque (bibliothèque · Upload,
// via movie) ou une vignette glissée d'ailleurs dans le portail (dropZone).
for (const which of ['start', 'end']) {
  dropZone($(which === 'start' ? '#start-slot' : '#end-slot'), { kinds: ['image', 'element'], multiple: false, via: 'movie',
    onitems: ([it]) => setImage(which, it) });
}
async function setImage(which, it) {
  const img = it.kind === 'element' ? await fromElement(it) : it;
  if (!img) return;
  S.items.set(img.id, img);
  F[which] = img.id;
  // la toile reste celle du préréglage (le plan annonce le recadrage) ; « d'après l'image » se choisit en avancé
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
      el('div', { class: 'modal-body' }, el('p', {}, 'Le plan partira exactement de cette image. Le plein pied montre le personnage entier, dans sa tenue.'),
        refs.length ? grid : el('p', { class: 'warn' }, 'cet élément n’a aucune image'))));
    document.addEventListener('keydown', esc);
    document.body.append(scrim);
  });
}

// ── Entrées (mode Références) : le cadre commun ─────────────
$('#ref-size').value = F.refSize;
$('#ref-size').addEventListener('change', (e) => { F.refSize = e.target.value; changed(); });
const AUDIO_EXT = /\.(wav|mp3|flac|m4a|ogg)$/i;
function elementParts(it) {   // le même compte que element_parts() de server/tools/movie.py
  const refs = it.element?.refs || [];
  const imgs = refs.filter((r) => !AUDIO_EXT.test(r.file || ''));
  // la voix est rangée à part (element.voices) ; un son dans refs (ancienne forme) compte aussi
  const voices = [...(it.element?.voices || []), ...refs.filter((r) => AUDIO_EXT.test(r.file || ''))].slice(0, 1);
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
    roles, via: 'movie', state: F.inputs, onchange: (st) => { F.inputs = st; changed(); } });
  for (const ta of [descEl, soundEl, musicEl]) E.bindField(ta);
  E.enable(F.mode === 'r2v');
}
// ── le prompt : trois champs, mentions, caméra ──────────────
const PH = {
  t2v: 'Ce qu’on voit et entend, dans l’ordre. Ex. : [Shot 1] Live-action, cinematic. A lighthouse keeper climbs a spiral staircase at dawn; the camera tracks up with him at slow speed. The weathered man (S1) mutters: <d>[English] Not tonight.</d>',
  i2v: 'Ce qui se passe à partir de l’image : l’action, la caméra, une réplique. Ex. : The man shown in <Picture 1> slowly turns toward the lens and smiles; the camera pushes in with small amplitude at slow speed.',
  r2v: 'Le plan, avec les jetons des entrées (tapez @). Ex. : @element1 runs through @image1 at night; a tracking shot follows him at fast speed, neon reflections on wet asphalt.',
};
const descEl = $('#desc'), soundEl = $('#sound'), musicEl = $('#music');
function syncFields() {
  const p = F.p[F.mode];
  descEl.value = p.desc; soundEl.value = p.sound; musicEl.value = p.music;
  if (E) { E.enable(F.mode === 'r2v'); E.refreshFields(); }
  paintWords();
}
function paintWords() {
  const n = F.p[F.mode].desc.trim() ? F.p[F.mode].desc.trim().split(/\s+/).length : 0;
  $('#words').textContent = `${n} mot${n > 1 ? 's' : ''} · visé 350–500`;
  $('#words').classList.toggle('low', n > 0 && n < 60);
}
descEl.addEventListener('input', () => { F.p[F.mode].desc = descEl.value; paintWords(); changed(); });
soundEl.addEventListener('input', () => { F.p[F.mode].sound = soundEl.value; changed(); });
musicEl.addEventListener('input', () => { F.p[F.mode].music = musicEl.value; changed(); });

function insertAt(t, text, { select = null } = {}) {
  const a = t.selectionStart ?? t.value.length, b = t.selectionEnd ?? a;
  const pre = t.value.slice(0, a), post = t.value.slice(b);
  const pad = pre && !/\s$/.test(pre) ? ' ' : '';
  t.value = pre + pad + text + (post && !/^\s/.test(post) ? ' ' : '') + post;
  const at = (pre + pad).length;
  t.focus();
  if (select) t.setSelectionRange(at + select[0], at + select[1]); else t.setSelectionRange(at + text.length, at + text.length);
  t.dispatchEvent(new Event('input'));
}
// les étiquettes des images de début et de fin (en Références, les jetons sont sur les vignettes et dans le menu « @ »)
function paintChips() {
  const pl = S.plan;
  const chips = F.mode === 'i2v' ? (pl?.pictures || []).map((p) => ({ ins: p.tag, lab: p.label })) : [];
  $('#chips').replaceChildren(...chips.map((c) => el('button', { class: 'chip', type: 'button', title: `insérer ${c.ins}`, onclick: () => insertAt(descEl, c.ins) },
    el('b', {}, c.ins), c.lab ? ' ' + c.lab : '')));
}
// la caméra : le vocabulaire contrôlé, écrit dans la phrase
const cam = { amp: '', speed: '' };
function segPick(id, cb) { $$(`#${id} .tb`).forEach((b) => b.addEventListener('click', () => { $$(`#${id} .tb`).forEach((x) => x.classList.toggle('on', x === b)); cb(b.dataset.v); })); }
segPick('cam-amp', (v) => { cam.amp = v; });
segPick('cam-speed', (v) => { cam.speed = v; });
function paintCamera() {
  $('#cam-chips').replaceChildren(...(S.opts?.camera || []).map((c) => el('button', { class: 'chip cam-chip', type: 'button', title: c.phrase,
    onclick: () => {
      const fixed = /Shake|Static|POV/.test(c.id);   // l'amplitude est dans le mot, ou n'a pas de sens
      insertAt(descEl, c.phrase + (fixed ? '' : cam.amp) + (/Static/.test(c.id) ? '' : cam.speed) + '.');
    } }, c.id)));
}
$('#h-cam').addEventListener('click', () => { $('#cam').hidden = !$('#cam').hidden; $('#h-cam').classList.toggle('on', !$('#cam').hidden); });
$('#h-assist').addEventListener('click', () => { $('#assist').hidden = !$('#assist').hidden; $('#h-assist').classList.toggle('on', !$('#assist').hidden); });
// la langue de la réplique : la préférence « langue parlée » (Général)
$('#h-say').addEventListener('click', () => {
  const pre = `(S1) says: <d>[${prefs.get('general.langue', 'fr') === 'en' ? 'English' : 'French'}] `;
  insertAt(descEl, pre + '…</d>', { select: [pre.length, pre.length + 1] });
});
// le multishot : le panneau de la frise (commun/multishot.js) écrit les [Shot n] et les <d> dans le prompt
$('#h-multi').addEventListener('click', async () => {
  const { openMultishot } = await import('../commun/multishot.js');
  const fr = S.opts?.frames || [];
  const secs = fr[durIndex()]?.seconds || F.frames / 24;
  const mentions = Object.entries(S.plan?.mentions || {}).map(([token, label]) => ({ token, label: String(label || '').replace(/^<|>$/g, '') }));
  openMultishot({ total: secs, desc: descEl.value, mentions, lang: prefs.get('general.langue', 'fr') === 'en' ? 'en' : 'fr',
    onApply: (text) => { descEl.value = text; descEl.dispatchEvent(new Event('input', { bubbles: true })); descEl.focus(); } });
});
$('#h-excl').addEventListener('click', () => insertAt(descEl, 'No text, subtitles, logos or watermarks of any kind, keep the live-action texture.'));

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
  const pile = S.loras.filter((l) => l.recipe).map((l) => el('div', { class: 'lora on recipe' },
    el('label', { class: 'lh' }, el('input', { type: 'checkbox', checked: true, disabled: true }), el('b', {}, l.nom),
      el('input', { class: 'fld force', value: l.force, disabled: true, 'aria-label': 'force' })),
    el('span', { class: 'hint' }, l.note)));
  put($('#loras'), ...pile, ...S.loras.filter((l) => !l.accel && !l.recipe).map((l) => {
    const st = F.loras[l.name] || (F.loras[l.name] = { on: false, strength: l.force });
    const fits = l.modes.includes(F.mode);
    const off = l.accel || !fits;
    if (off && st.on) { st.on = false; quietSave(); }
    const force = el('input', { class: 'fld force', inputmode: 'decimal', value: st.strength, 'aria-label': 'force', disabled: off || null,
      onchange: (e) => { const v = parseFloat(e.target.value.replace(',', '.')); st.strength = isFinite(v) ? Math.max(0, Math.min(2, v)) : l.force; e.target.value = st.strength; changed(); } });
    return el('div', { class: 'lora' + (st.on ? ' on' : '') + (off ? ' off' : '') },
      el('label', { class: 'lh' },
        el('input', { type: 'checkbox', checked: st.on || null, disabled: off || null, onchange: (e) => { st.on = e.target.checked; changed(); paintLoras(); } }),
        el('b', {}, l.nom), force),
      el('span', { class: 'hint' }, l.note),
      !fits && !l.accel ? el('span', { class: 'why' }, `pas pour ce mode : ${l.modes.map((m) => MODE_FR[m]).join(', ')}`) : null,
      l.warn ? el('span', { class: 'warn-t' }, 'décision de Cal : exclu pour ses personnages') : null);
  }), accel.length ? el('details', { class: 'accel' },
    el('summary', {}, el('span', { class: 'lbl' }, `${accel.length} autres accélérateurs · la recette pose le Turbo v4`)),
    el('div', { class: 'accel-list' }, ...accel.map((l) => el('span', { title: l.name }, l.nom)))) : null);
}

// ── Sortie : préréglage, durée ; en avancé : toile, pas, graine ─
function paintOutput() {
  const o = S.opts, pl = S.plan;
  if (!o) return;
  if (!o.methods.some((m) => m.id === F.method)) F.method = o.default_method || o.methods[0].id;
  const meth = o.methods.find((m) => m.id === F.method);
  // les deux préréglages : le mot, ce qu'il fait, son temps estimé pour ce plan (le temps de Cal sinon)
  $('#presets').replaceChildren(...o.methods.map((m) => el('button', { class: F.method === m.id ? 'on' : '', type: 'button', role: 'radio',
    'aria-checked': F.method === m.id ? 'true' : 'false', title: m.note,
    onclick: () => { if (F.method !== m.id) { F.method = m.id; F.steps = ''; changed(); paintOutput(); } } },
  el('b', {}, m.label), el('span', {}, m.sub),
  el('i', {}, pl?.presets?.[m.id] ? `≈ ${rng(pl.presets[m.id])}` : `chez Cal : ${m.cal.what}`))));
  $('#preset-note').textContent = meth.note;
  // la toile (avancé) : celle du préréglage d'abord ; sinon une famille, puis sa toile
  const fams = ['préréglage'].concat(F.mode === 'i2v' && pl?.canvases?.[0]?.family === 'image' ? ['image'] : [], o.families);
  const famNow = F.canvas[F.mode] == null ? 'préréglage' : F.canvas[F.mode] === 'auto' ? 'image' : F.fam[F.mode];
  $('#fam').replaceChildren(...fams.map((f) => el('button', { class: 'tb' + (famNow === f ? ' on' : ''), type: 'button',
    onclick: () => {   // une famille : sa première toile, pour que l'affiché soit l'envoyé
      if (f === 'préréglage') F.canvas[F.mode] = null;
      else {
        F.fam[F.mode] = f;
        const first = o.canvases.find((c) => c.family === f);
        F.canvas[F.mode] = f === 'image' ? 'auto' : first ? [first.w, first.h] : null;
      }
      changed(); paintOutput();
    } }, f === 'préréglage' ? 'recette' : f)));
  // une ligne par toile de la famille — sa taille, son nom, son temps estimé à droite ; ce qui est coché part
  const [pw, ph] = meth.canvas;
  const rows = famNow === 'préréglage'
    ? [{ w: pw, h: ph, family: 'préréglage', label: `${meth.label} · la recette`, source: 'la toile du préréglage', estimate: pl?.presets?.[F.method] }]
    : (pl?.canvases || o.canvases.map((c) => ({ ...c, estimate: null }))).filter((c) => c.family === famNow);
  const cur = F.canvas[F.mode];
  const key = (c) => (c.family === 'préréglage' ? 'preset' : c.family === 'image' ? 'auto' : `${c.w}x${c.h}`);
  const curKey = cur == null ? 'preset' : cur === 'auto' ? 'auto' : Array.isArray(cur) ? `${cur[0]}x${cur[1]}` : '';
  $('#canvas').replaceChildren(...rows.map((c) => el('button', { class: 'cv-row' + (key(c) === curKey ? ' on' : ''), type: 'button', role: 'radio',
    'aria-checked': key(c) === curKey ? 'true' : 'false', title: c.source,
    onclick: () => { F.canvas[F.mode] = c.family === 'préréglage' ? null : c.family === 'image' ? 'auto' : [c.w, c.h]; changed(); paintOutput(); } },
  el('b', {}, c.family === 'image' && !c.w ? 'd’après l’image' : `${c.w} × ${c.h}`), el('span', { class: 'cv-l' }, c.label || ''),
  el('span', { class: 'cv-e' }, c.estimate ? rngShort(c.estimate) : ''))));
  $('#estimate-short').textContent = pl ? `${pl.width}×${pl.height} · ≈ ${rng(pl.estimate)}` : '';
  $('#adv-sum').textContent = pl ? `${meth.label.toLowerCase()} · ${pl.steps} pas${F.seed ? ' · graine ' + F.seed : ''}${pl.loras.length ? ` · ${pl.loras.length} LoRA de plus` : ''}${F.canvas[F.mode] != null ? ` · ${pl.width}×${pl.height}` : ''}` : '';
  paintDuration();
  const steps = pl?.steps;
  $('#step-presets').replaceChildren(...meth.steps.map((s) => el('button', { class: 'tb' + (Number(F.steps || steps) === s ? ' on' : ''), type: 'button',
    onclick: () => { F.steps = String(s); $('#steps').value = F.steps; changed(); paintOutput(); } },
  `${s}${s === 8 ? ' · la recette' : ''}`)));
  $('#steps').value = F.steps;
  $('#steps').placeholder = steps ? `auto · ${steps}` : 'auto';
  const rec = o.recipe || {};
  $('#profile').replaceChildren(el('b', {}, `${meth.label}${pl ? ` · ${pl.width} × ${pl.height}` : ''}${pl?.draft ? ` (depuis ${pl.draft[0]} × ${pl.draft[1]})` : ''}${steps ? ' · ' + steps + ' pas' : ''}`),
    el('span', {}, `La recette de Cal : ${(rec.loras || []).map((l) => `${l.name.replace('.safetensors', '')} ${String(l.strength).replace('.', ',')}`).join(' → ')} ; ${rec.attention || ''} ; ${rec.sampler || ''}, planning ${rec.scheduler || ''} ; « ${rec.tag || ''} » en tête de la description.`));
  $('#seed').value = F.seed;
  paintSeedOrig();
  if (pl) $('#estimate').replaceChildren(el('b', {}, `Estimé ${pl.width}×${pl.height} : ${rng(pl.estimate)}`),
    el('span', { class: 'hint' }, `${pl.estimate.basis}. Chargement du modèle, image et son compris ; le premier rendu après un démarrage d’H3 est plus long.`));
}
function paintSeedOrig() {
  const b = $('#seed-orig');
  b.hidden = F.origSeed === null || F.origSeed === undefined;
  b.title = b.hidden ? '' : `la graine de la vidéo réutilisée : ${F.origSeed} — la même recette refait le même plan`;
}
// la durée : un curseur en secondes, aux pas permis par H3 (la grille 17k+5 à 24 i/s, lue dans
// /api/movie/options) ; la valeur en clair, le nombre d'images en petit
const secFr = (s) => `${String(Math.round(s * 10) / 10).replace('.', ',')} s`;
function durIndex() {
  const fr = S.opts?.frames || [];
  let k = 0;
  fr.forEach((f, i) => { if (Math.abs(f.frames - F.frames) < Math.abs(fr[k].frames - F.frames)) k = i; });
  return k;
}
function paintDuration(k = durIndex()) {
  const fr = S.opts?.frames || [];
  if (!fr.length) return;
  const r = $('#frames');
  r.max = String(fr.length - 1);
  r.value = String(k);
  $('#dur-v').textContent = secFr(fr[k].seconds);
  $('#dur-n').textContent = `${fr[k].frames} images`;
  $('#dur-lo').textContent = secFr(fr[0].seconds);
  $('#dur-hi').textContent = secFr(fr[fr.length - 1].seconds);
}
$('#frames').addEventListener('input', (e) => paintDuration(Number(e.target.value)));
$('#frames').addEventListener('change', (e) => { F.frames = S.opts.frames[Number(e.target.value)].frames; changed(); });
// un temps court pour une ligne de toile : « 3–4 min », « 40–55 s »
function rngShort(e) {
  if (!e) return '';
  if (e.high < 90) return `${Math.round(e.low)}–${Math.round(e.high)} s`;
  const lo = Math.round(e.low / 60), hi = Math.round(e.high / 60);
  return lo === hi ? `≈ ${lo} min` : `${lo}–${hi} min`;
}
$('#steps').addEventListener('input', (e) => { F.steps = e.target.value.replace(/[^0-9]/g, ''); if (e.target.value !== F.steps) e.target.value = F.steps; changed(); });
$('#seed').addEventListener('input', (e) => { F.seed = e.target.value.replace(/[^0-9]/g, ''); if (e.target.value !== F.seed) e.target.value = F.seed; changed(); });
$('#seed-rand').addEventListener('click', () => { F.seed = String(Math.floor(Math.random() * 2 ** 31)); $('#seed').value = F.seed; changed(); });
$('#seed-orig').addEventListener('click', () => { if (F.origSeed == null) return; F.seed = String(F.origSeed); $('#seed').value = F.seed; changed(); });

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
  return out;
}

// ── le plan résolu par le serveur ───────────────────────────
let planT = null;
function schedulePlan() { clearTimeout(planT); planT = setTimeout(runPlan, 220); }
async function runPlan() {
  const seq = ++S.seq, mode = F.mode;
  try {
    const pl = await api('movie/plan', { method: 'POST', body: { mode, params: params(mode), graph: $('#adv').open } });
    if (seq !== S.seq || mode !== F.mode) return;
    S.plan = pl;
    paintPlan();
  } catch (e) { $('#why').replaceChildren(el('div', {}, 'le portail ne répond pas : ' + e.message)); $('#go').disabled = true; }
}
$('#adv').addEventListener('toggle', () => { if ($('#adv').open) runPlan(); });
const FIX = [   // chaque blocage mène à ce qui le lève
  [/première image, une dernière/, () => chooseImage('start')],
  [/ajoutez une entrée/, () => $('#entrees .ent-drop').click()],
  [/ne pointent vers rien|mode Références/, () => descEl.focus()],
  [/description|déclencheur/, () => descEl.focus()],
];
function paintPlan() {
  const pl = S.plan;
  $('#why').replaceChildren(...pl.errors.map((e) => {
    const fix = FIX.find(([rx]) => rx.test(e));
    return el('div', { class: fix ? 'fix' : '', role: fix ? 'button' : null, tabindex: fix ? 0 : null, onclick: fix ? () => fix[1](e) : null }, e);
  }));
  $('#go').disabled = !pl.ok;
  $('#go').textContent = pl.ok ? `Générer · ${pl.width}×${pl.height} · ${String(pl.seconds.toFixed(1)).replace('.', ',')} s →` : 'Générer la vidéo →';
  $('#notes').replaceChildren(...pl.notes.map((n) => el('div', {}, n)));
  $('#sent').textContent = pl.prompt_sent || '';
  $('#graph').textContent = pl.graph ? JSON.stringify(pl.graph, null, 1) : (pl.ok ? 'ouvrez ce panneau pour le construire' : 'le graphe se construit quand le plan est complet');
  $('#format-hint').textContent = pl.raw ? 'prompt déjà au format H3 : il part tel quel.'
    : F.mode === 'r2v' ? `À l’envoi : les six sections du guide ref de MiniMax ; ${Object.entries(pl.mentions || {}).map(([k, v]) => `${k} → ${v}`).join(', ') || 'les jetons deviennent <Subject n>, <Video n>, <Audio n>'}.`
      : 'À l’envoi : les trois champs du guide de MiniMax' + (F.mode === 'i2v' ? ', et la ligne d’ancrage des images avec la durée.' : '.');
  paintChips();
  paintOutput();
}
$('#go').addEventListener('click', launch);
async function launch() {
  const pl = S.plan;
  if (!pl?.ok) return;
  const mode = F.mode;
  $('#go').disabled = true;
  try {
    const title = (F.p[mode].desc.replace(/@([\p{L}\p{N}_-]+)/gu, '$1').trim().replace(/\s+/g, ' ') || MODE_FR[mode]).slice(0, 70);
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
  if (h?.engine === 'factice') { cls = 'pill work'; txt = 'moteur factice · pas H3'; tip = 'une vidéo d’essai (mire, vos images, un bip) : le câblage d’H3 vient ensuite'; }
  else if (h) {
    const up = h.instances.filter((i) => i.up), st = h.instances.find((i) => i.starting_for != null);
    const sleeper = h.instances.some((i) => i.managed);   // une instance H3TEST que le gardien démarre
    cls = 'pill ' + (up.length ? 'on' : st ? 'work' : '');
    txt = up.length ? `H3 prêt · ${up.map((i) => i.machine).join(' + ')}` : st ? `H3 démarre · ${st.machine}`
      : sleeper ? 'H3 dort · démarre au rendu' : `H3 ne répond pas · ${h.instances.map((i) => `${i.machine} :${i.port}`).join(', ') || 'aucune instance (lanes.h3)'}`;
    tip = up.map((i) => `${i.machine} : ${Math.round(i.free_gb ?? 0)} Go libres${i.stops_in != null ? ` · s’arrête dans ${mmss(i.stops_in)}` : ''}`).join('\n');
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
  for (const k of Object.keys(F.loras)) F.loras[k].on = false;
  for (const l of r.loras || []) F.loras[l.name] = { on: true, strength: l.strength };
  const adv = r.adv || {};
  if (p.weights) F.adv['unet_' + p.weights] = old ? undefined : adv.unet || p.unet;
  const crf = adv.crf ?? p.crf;
  F.adv.crf = crf && Number(crf) !== 12 ? String(crf) : '';
  if (S.view !== 'create') setView('create');
  setMode(mode);
  $('#rail .rail-scroll').scrollTop = 0;
  descEl.focus();
  toast('réglages repris · graine vidée : « Générer » fait une variante (la graine d’origine : Réglages avancés)', 5500);
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
  setMode('r2v');
  if (E) E.add([it]);
}
function toBench(k, it) {
  S.items.set(it.id, it);
  fil.close();
  assign(k, it.id);
}

// ── le panneau Asset (commun/dock.js, Ctrl+Espace) ──────────
// Poser (double-clic, Entrée) va là où la vue ouverte prend un asset : Images →
// le début, puis la fin ; Références → les entrées, chacune dans sa catégorie ;
// Comparer → A, puis B. Texte ne prend rien : il le dit. Les filtres suivent.
const DOCK_CTX = {
  t2v: { kinds: [], label: 'le mode Texte', why: 'le prompt seul — passer en Images ou en Références pour poser un asset' },
  i2v: { kinds: ['image', 'element'], label: 'la première image' },
  r2v: { kinds: ['image', 'element', 'video', 'audio'], label: 'les entrées' },
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
  if (F.mode === 'i2v') {
    const it = items.find((x) => x.kind === 'image' || x.kind === 'element');
    if (!it) { toast('le début et la fin sont des images (ou l’image d’un élément)'); return false; }
    const before = [F.start, F.end].join();
    await setImage(!F.start ? 'start' : 'end', it);
    return [F.start, F.end].join() !== before;
  }
  if (F.mode === 'r2v') return E ? E.add(items) > 0 : false;
  toast(DOCK_CTX.t2v.why, 5000);
  return false;
}
dock.configure({
  placeLabel: 'Poser dans le plan',
  hint: 'double-clic : dans le plan · glisser : sur une image, une entrée, A ou B',
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
    { label: 'Envoyer au Montage', icon: '▤', onclick: go(`montage/?add=${id}`) },
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
      it.params?.family || '', it.audio ? 'son' : 'muet'],
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
    empty: 'Choisissez un mode, décrivez la scène et le son, « Générer » : le rendu paraît ici dès l’envoi, avec sa place dans la file ; la vidéo reste dans la bibliothèque jusqu’à sa suppression.',
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
  if (n) toast(`${n > 1 ? n + ' fichiers rangés' : 'rangé'} dans la bibliothèque · Upload — déposez sur un emplacement pour vous en servir`);
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
  // à partir d'ici, chaque changement du formulaire est un geste (le mode suit sans en faire un)
  form = U.snapshots({ get: () => F, set: formRestore, describe: formDescribe, ignore: ['mode'] });
  form.reset();
  setView(q.get('view') === 'cmp' || q.get('a') ? 'cmp' : 'create');
  const want = (location.hash || '').slice(1) || q.get('id');
  if (want) fil.open(want);
  loadLoras();
  paintEngine();
  setInterval(paintEngine, 15000);
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
  const go = $('#go');
  const why = [...$$('#why > div')].map((n) => n.textContent).join(' · ');
  return [{ head: `Vidéo · ${MODE_FR[F.mode]}` },
    { label: go?.textContent || 'Générer la vidéo', icon: '▶', disabled: !go || go.disabled, why: why || 'le plan n’est pas complet', onclick: launch },
    '-',
    ...Object.entries(MODE_FR).map(([m, lab]) => ({ label: lab.charAt(0).toUpperCase() + lab.slice(1), checked: F.mode === m, onclick: () => setMode(m) })),
    F.mode === 'i2v' ? { label: 'Choisir l’image de début…', icon: '▭', onclick: () => chooseImage('start') } : null,
    F.mode === 'i2v' ? { label: 'Choisir l’image de fin…', icon: '▭', onclick: () => chooseImage('end') } : null,
    '-',
    { label: 'Comparer deux plans', icon: '◫', onclick: () => setView('cmp') }];
});
