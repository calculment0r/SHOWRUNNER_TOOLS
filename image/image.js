// Image : créer et éditer des images photo avec Z-Image, Qwen-Image 2.1
// et Krea 2 ; caméra, objectif, ouverture, pellicule et lumière en
// pastilles ; les références (images, éléments, personnages de Character
// Factory) ; les outils d'édition, dont la zone peinte. Le serveur tient la
// seule vérité : modèles, tailles, pastilles et prompt envoyé viennent de
// /api/image/*.
//
// La page (Cal, 29/09, capture 2 de Higgsfield) : le fil en grille sur toute
// la largeur (commun/fil.js) et, en bas, la barre de prompt flottante :
//   ligne 1 — les vignettes des références (un clic : retirer, changer de
//             place ou d'image ; on y dépose), « + », le passage en édition ;
//   ligne 2 — le prompt, d'une à trois lignes, « @ » nomme une référence ;
//   ligne 3 — des puces : + · @ · modèle · format · taille · − n/4 + ·
//             Prise de vue · Paramètres avancés (fermés par défaut : la
//             graine, le rendu propre au modèle, le visage gardé, le prompt
//             envoyé ; ce qui s'écarte du défaut se lit sur la puce) ; chaque
//             puce ouvre un petit menu vers le haut (commun/menu.js) ou un
//             panneau au-dessus de la barre ;
// Peu de texte d'aide (Cal, 29/09 : « calmer les messages redondants ») :
// une infobulle courte là où elle sert ; une action éteinte dit pourquoi.
//   à droite — « Générer », le seul orange, avec le temps mesuré.
// L'édition part de la visionneuse ou du ⋯ → Éditer : la barre passe en
// édition (l'image source en vignette, l'outil en puce) ; la zone se peint
// dans sa grande fenêtre. « Réutiliser » remplit la barre, graine vidée :
// « Générer » fait une variante.
//
// Tout emplacement qui attend une image accepte un dépôt (fichier du disque →
// bibliothèque, catégorie Upload ; ou une vignette glissée) : `dropZone` du
// socle ; toute vignette d'ici se glisse (`dragItem`).
//
// L'annulation (commun/undo.js) : les réglages de la barre (modèle, format,
// références, prise de vue, graine, le prompt une fois écrit…) par
// instantanés ; aimer, ranger dans un dossier, mettre à la corbeille depuis
// le fil : le fil les range lui-même dans la pile (commun/fil.js, option undo).
// Ne s'annulent pas : un rendu lancé, un fichier déposé, un élément créé
// depuis le menu (il se jette depuis Asset).
import { mountHeader, api, jobs, pick, toast, el, $, href, fmtDate, dropZone, dragItem } from '../commun/shell.js';
import { menu, contextMenu, pageMenu } from '../commun/menu.js';
import { createFil } from '../commun/fil.js';
import { createUndo } from '../commun/undo.js';
import { prefs } from '../commun/prefs.js';
import { scrollBehavior } from '../commun/theme.js';

mountHeader('image', { sub: 'créer · éditer' });

const KEY = 'sr-image-draft';
const VIA = 'image';
const S = {
  cfg: null,
  mode: 'create',
  model: 'krea2', variant: 'turbo', prompt: '', looks: {}, aspect: '3:4', quality: '', count: 2, seed: '', realism: true,
  refs: [], refChoice: {}, origSeed: null,
  edit: { tool: 'instruct', model: 'krea2', prompt: '', keepFace: true, factor: 2, denoise: 0.25, mask: '',
    azimuth: '', elevation: '', distance: '', count: 1, seed: '', looks: {}, refs: [], origSeed: null },
  transparent: false,
  current: null,
  pop: null, lookTab: 'camera',
  sent: '', notes: [],
  paint: { on: false, size: 48, canvas: null, for: null, dirty: false },
  // la file : ce que la page a lancé (suivi un à un), ce qui est arrivé, ce qu'on a retiré
  mine: new Map(), done: new Set(), gone: new Set(), lastList: [], session: new Date().toISOString(),
};
let fil = null;

// ── l'annulation ────────────────────────────────────────────
// le fil : un objet changé se repeint, un objet revenu de la corbeille fait relire le fil
const U = createUndo({ name: 'image', onapply: (e, { items }) => {
  let reload = false;
  for (const it of items || []) {
    if (it.gone) fil?.remove(it.id);
    else if (fil?.get(it.id)) fil.update(it);
    else reload = true;
  }
  if (reload) fil?.reload();
} });
const undoBox = el('span', { class: 'sr-undo pb-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, ...U.buttons());
// la barre, par instantanés : ce que garde le brouillon, les objets entiers
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const BAR_FR = [['model', 'changer de modèle'], ['variant', 'changer la variante de Z-Image'], ['refs', 'changer les références'],
  ['refChoice', 'changer l’image envoyée d’un élément'], ['current', 'changer l’image à éditer'], ['aspect', 'changer le format'],
  ['quality', 'changer la taille'], ['realism', 'changer le rendu photo'], ['transparent', 'changer le fond'], ['looks', 'changer la prise de vue'],
  ['count', 'changer le nombre d’images'], ['seed', 'changer la graine'], ['origSeed', 'changer la graine d’origine'], ['prompt', 'écrire le prompt']];
const EDIT_FR = [['tool', 'changer d’outil d’édition'], ['model', 'changer de modèle d’édition'], ['refs', 'changer les références'],
  ['keepFace', 'garder le visage, ou non'], ['looks', 'rééclairer'], ['factor', 'changer le facteur'], ['denoise', 'changer le débruitage'],
  ['azimuth', 'changer le point de vue'], ['elevation', 'changer la hauteur de vue'], ['distance', 'changer la distance'], ['mask', 'effacer la zone'],
  ['count', 'changer le nombre d’images'], ['seed', 'changer la graine'], ['prompt', 'écrire la consigne'], ['caption', 'écrire la description']];
const TYPED = new Set(['prompt', 'seed', 'caption']);   // une saisie : un seul geste tant que le champ garde la main
let typing = 0;
function barDescribe(b, a) {
  for (const [k, label] of BAR_FR) {
    if (!same(b[k], a[k])) return { label, merge: TYPED.has(k) ? `${k}#${typing}` : k, mergeMs: TYPED.has(k) ? Infinity : undefined };
  }
  for (const [k, label] of EDIT_FR) {
    if (!same(b.edit?.[k], a.edit?.[k])) return { label, merge: TYPED.has(k) ? `e.${k}#${typing}` : `e.${k}`, mergeMs: TYPED.has(k) ? Infinity : undefined };
  }
  return { label: 'modifier la barre' };
}
let bar = null;   // posé au démarrage, une fois le brouillon relu (l'ouverture n'est pas un geste)
function barState() {
  const { model, variant, prompt, looks, aspect, quality, count, seed, realism, transparent, refChoice, origSeed, lookTab, mode } = S;
  return { model, variant, prompt, looks, aspect, quality, count, seed, realism, transparent, refChoice, origSeed, lookTab, mode,
    refs: S.refs, edit: S.edit, current: S.current };
}
function barRestore(s) {
  const { refs, edit, current, ...rest } = s;
  Object.assign(S, rest);
  S.refs = refs || [];
  S.edit = { ...S.edit, ...edit, refs: edit?.refs || [] };
  if (S.paint.for && S.paint.for !== current?.id) clearPaint();
  S.current = current || null;
  S.pop = null;
  saveDraft(); paintBar();
}

// ── le brouillon : une commodité de ce navigateur ───────────
function saveDraft() {
  try {
    const { model, variant, prompt, looks, aspect, quality, count, seed, realism, transparent, refChoice, origSeed, lookTab } = S;
    const edit = { ...S.edit, refs: S.edit.refs.map((r) => r.id) };
    localStorage.setItem(KEY, JSON.stringify({ model, variant, prompt, looks, aspect, quality, count, seed, realism, transparent, refChoice, origSeed, lookTab,
      refs: S.refs.map((r) => r.id), edit, mode: S.mode, current: S.current?.id }));
  } catch { /* stockage fermé : rien à garder */ }
  bar?.commit();   // chaque changement de la barre passe ici : un geste qu'on annule
}
async function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { d = null; }
  if (!d) {
    // un brouillon neuf : les préférences de la personne (image/prefs.json)
    S.model = prefs.get('image.model', S.model);
    S.count = prefs.get('image.count', S.count);
    return null;
  }
  for (const k of ['model', 'variant', 'prompt', 'looks', 'aspect', 'quality', 'count', 'seed', 'realism', 'transparent', 'refChoice', 'origSeed', 'lookTab']) {
    if (d[k] !== undefined && d[k] !== null) S[k] = d[k];
  }
  const fetchAll = async (ids) => (await Promise.all((ids || []).map((id) => api('library/' + id).catch(() => null)))).filter(Boolean);
  S.refs = await fetchAll(d.refs);
  if (d.edit) S.edit = { ...S.edit, ...d.edit, refs: await fetchAll(d.edit.refs) };
  if (d.mode === 'edit') S.mode = 'edit';
  return d.current || null;
}

// ── petites aides ───────────────────────────────────────────
const M = (id) => S.cfg.models.find((m) => m.id === id);
const stub = () => S.cfg?.backend === 'stub';
const plural = (n, w, pl = w + 's') => `${n} ${n > 1 ? pl : w}`;
const fmtS = (s) => (s == null ? '' : s < 60 ? `${String(Math.round(s * 10) / 10).replace('.', ',')} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}`);
const ms = (iso) => Date.parse(iso || '') || 0;
const DOT = { zimage: 'cy', qwen21: 'grn2', krea2: 'coral-2' };   // la pastille de chaque modèle
const TOOL_FR = { instruct: 'consigne', matte: 'détourer', upscale: 'agrandir', refine: 'affiner ×2', angle: 'angle' };

// un petit menu qui s'ouvre vers le haut, au-dessus de sa puce (la barre est en bas)
function up(anchor, items) {
  const r = anchor.getBoundingClientRect();
  const { node } = menu(r.left, r.top, items);
  if (!node) return;
  const h = node.getBoundingClientRect().height;
  node.style.top = `${Math.max(8, r.top - h - 6)}px`;
}

// ce que les machines savent faire ; en factice, rien ne bloque (aucun modèle chargé)
function avail(cap) {
  const a = S.cfg?.availability?.[cap];
  const why = a && !a.on.length ? (Object.entries(a.missing).map(([m, v]) => `${m} : ${v.join(', ')}`).join(' · ') || 'aucune machine') : '';
  if (stub()) return { ok: true, on: ['factice'], why };
  if (!a) return { ok: true, on: [] };
  return a.on.length ? { ok: true, on: a.on } : { ok: false, why };
}
function capCreate() {
  if (S.model === 'zimage') return 'zimage:' + S.variant;
  if (S.model === 'krea2' && S.refs.length) return 'krea2:edit';
  return S.model;
}
function capEdit() {
  const t = S.edit.tool;
  if (t === 'instruct') return S.edit.model === 'krea2' ? 'krea2:edit' : 'qwen21';
  return t;
}
function fixQuality() {
  const m = M(S.model);
  if (!m.quality.some((q) => q.id === S.quality)) S.quality = m.quality[0].id;
  if (!m.sizes[S.quality][S.aspect]) S.aspect = '1:1';
}

// ── le prompt envoyé : demandé au serveur ───────────────────
let composeT = null;
function schedCompose() { clearTimeout(composeT); composeT = setTimeout(doCompose, 220); }
async function doCompose() {
  if (S.mode === 'edit' && S.edit.tool !== 'instruct') { S.sent = ''; S.notes = []; paintNote(); return; }
  const body = S.mode === 'create'
    ? { mode: 'generate', model: S.model, prompt: S.prompt, looks: S.looks, refs: refsParam(S.refs), transparent: S.model === 'qwen21' && S.transparent }
    : { mode: 'edit', model: S.edit.model, prompt: S.edit.prompt, looks: S.edit.looks, refs: refsParam(S.edit.refs), keep_face: S.edit.keepFace };
  try {
    const r = await api('image/compose', { method: 'POST', body });
    S.sent = r.prompt; S.notes = r.notes || [];
  } catch (e) { S.sent = ''; S.notes = [e.message]; }
  paintNote();
  const box = $('#sent');
  if (box) box.textContent = S.sent || '—';
}
const refsParam = (list) => list.map((it) => ({ item: it.id, ...(S.refChoice[it.id] ? { ref: S.refChoice[it.id] } : {}) }));
function paintNote() {
  const n = $('#pb-note');
  const notes = S.mode === 'create' || S.edit.tool === 'instruct' ? S.notes : [];
  n.hidden = !notes.length;
  n.textContent = notes.join(' · ');
  n.title = notes.join('\n');
}

// ── la barre ────────────────────────────────────────────────
function paintBar() {
  if (S.mode === 'create') fixQuality();
  paintRefs();
  paintText();
  paintChips();
  paintPop();
  paintAct();
  paintNote();
  schedCompose();
}
function setMode(m) {
  S.mode = m; S.pop = null; S.paint.on = false;
  saveDraft(); paintBar();
  const ta = $('#prompt');
  if (!ta.hidden) ta.focus();
}

// ligne 1 : les références (ou, en édition, l'image source et ses références)
function roleOf(model, k, n, edit) {
  if (model === 'qwen21') return `<image${(edit ? 2 : 1) + k}>`;
  if (edit) return 'le sujet';   // Krea : l'image éditée est la scène
  return n > 1 ? (k === 0 ? 'la scène' : 'le sujet') : 'la personne ou l’objet';
}
const swap = (list, k) => { const l = list.slice(); [l[k - 1], l[k]] = [l[k], l[k - 1]]; return l; };
function refsOf() {
  if (S.mode === 'create') return { list: S.refs, max: M(S.model).refs, model: S.model, edit: false, set: (l) => { S.refs = l.slice(0, M(S.model).refs); afterRefs(); } };
  const E = S.edit;
  return { list: E.refs, max: M(E.model).refs - 1, model: E.model, edit: true, set: (l) => { E.refs = l.slice(0, M(E.model).refs - 1); afterRefs(); } };
}
function afterRefs() { saveDraft(); schedCompose(); paintRefs(); paintChips(); paintAct(); }
function refMenu(it, k, R) {
  const els = it.kind === 'element' ? (it.element?.refs || []) : [];
  const cur = S.refChoice[it.id] || els[0]?.file;
  return [
    { head: `${roleOf(R.model, k, R.list.length, R.edit)} · ${it.title || it.id}` },
    k > 0 ? { label: 'Passer avant', sub: roleOf(R.model, k - 1, R.list.length, R.edit), onclick: () => R.set(swap(R.list, k)) } : null,
    k < R.list.length - 1 ? { label: 'Passer après', sub: roleOf(R.model, k + 1, R.list.length, R.edit), onclick: () => R.set(swap(R.list, k + 1)) } : null,
    els.length ? '-' : null,
    els.length ? { head: 'l’image de l’élément envoyée' } : null,
    ...els.map((r) => ({ label: r.label || r.role || r.file, sub: r.role || '', checked: cur === r.file,
      onclick: () => { S.refChoice[it.id] = r.file; saveDraft(); schedCompose(); paintRefs(); } })),
    '-',
    { label: 'Voir en grand', onclick: () => fil.open(it) },
    { label: 'Retirer', icon: '×', danger: true, onclick: () => R.set(R.list.filter((_, i) => i !== k)) },
  ];
}
function refThumb(it, k, R) {
  const t = it.kind === 'element' ? (it.element?.refs?.find((r) => r.file === S.refChoice[it.id])?.thumb_url || it.thumb_url) : (it.thumb_url || it.url);
  const role = roleOf(R.model, k, R.list.length, R.edit);
  const b = el('button', { class: 'pb-ref' + (it.kind === 'element' ? ' element' : ''), type: 'button',
    title: `${role} · ${it.title || ''}`,
    style: t ? { backgroundImage: `url(${href(t)})` } : null,
    onclick: (e) => up(e.currentTarget, refMenu(it, k, R)) },
  el('span', { class: 'n' }, role.replace(/^<image(\d+)>$/, '$1').replace(/^la |^le /, '').replace('personne ou l’objet', 'réf.')));
  // déposer sur une vignette la remplace, à la même place
  dropZone(b, { kinds: ['image', 'element'], multiple: false, via: VIA, onitems: ([x]) => { const l = R.list.slice(); l[k] = x; R.set(l); } });
  b._menu = () => refMenu(it, k, R);   // le même menu au clic droit
  return b;
}
// pourquoi on ne peut plus ajouter : la limite du modèle, dite par le serveur
function maxWhy(R) {
  const m = M(R.model);
  if (!R.max) return m.refs_why || `${m.name} ne prend pas de référence`;
  return R.edit ? `${m.name} : ${plural(R.max, 'référence')} au plus, en plus de l’image éditée` : (m.refs_max_why || `${m.name} : ${plural(R.max, 'référence')} au plus`);
}
async function addRefs() {
  const R = refsOf();
  if (!R.max || R.list.length >= R.max) { toast(maxWhy(R), 5000); return; }
  const got = await pick({ kinds: ['image', 'element'], multiple: true, title: `Références (${R.max} au plus)` });
  addItems(got);
}
function addItems(items) {
  const R = refsOf();
  if (!items?.length) return;
  if (!R.max) { toast(maxWhy(R), 5000); return; }
  const l = R.list.slice();
  for (const it of items) if (l.length < R.max && !l.some((x) => x.id === it.id)) l.push(it);
  if (items.length && l.length >= R.max && l.length - R.list.length < items.length) toast(maxWhy(R), 5000);
  R.set(l);
}
function paintRefs() {
  const box = $('#pb-refs');
  const kids = [];
  if (S.mode === 'create') {
    const R = refsOf();
    const m = M(S.model);
    R.list.forEach((it, k) => kids.push(refThumb(it, k, R)));
    if (m.refs && R.list.length < m.refs) {
      kids.push(el('button', { class: 'pb-ref add', type: 'button', title: `ajouter une référence (${R.list.length}/${m.refs})`, onclick: addRefs }, '+'));
    }
    kids.push(el('span', { class: 'sp' }), undoBox,
      el('button', { class: 'pb-mode', type: 'button', title: 'éditer une image', onclick: () => setMode('edit') },
        el('span', { class: 'ic', 'aria-hidden': 'true' }, '✎'), 'Éditer'));
  } else {
    const src = S.current;
    if (src) {
      const b = el('button', { class: 'pb-ref src', type: 'button', title: `l’image à éditer · ${src.width || '?'} × ${src.height || '?'}`,
        style: { backgroundImage: `url(${href(src.thumb_url || src.url)})` },
        onclick: (e) => up(e.currentTarget, [{ head: `source · ${src.width || '?'} × ${src.height || '?'}` },
          { label: 'Voir en grand', onclick: () => fil.open(src) }, { label: 'Changer d’image…', onclick: pickSrc }]) },
      el('span', { class: 'n' }, 'source'));
      dropZone(b, { kinds: ['image'], multiple: false, via: VIA, onitems: ([x]) => setSource(x) });
      dragItem(b, src);
      kids.push(b);
    } else {
      kids.push(el('button', { class: 'pb-ref add src', type: 'button', title: 'choisir l’image à éditer', onclick: pickSrc }, '+'));
    }
    if (S.edit.tool === 'instruct' && src) {
      const R = refsOf();
      R.list.forEach((it, k) => kids.push(refThumb(it, k, R)));
      if (R.list.length < R.max) kids.push(el('button', { class: 'pb-ref add', type: 'button', title: `ajouter une référence (${R.list.length}/${R.max})`, onclick: addRefs }, '+'));
    }
    kids.push(el('span', { class: 'sp' }), undoBox,
      el('button', { class: 'pb-mode', type: 'button', title: 'revenir à la création d’images', onclick: () => setMode('create') },
        el('span', { class: 'ic', 'aria-hidden': 'true' }, '←'), 'Créer'));
  }
  box.replaceChildren(...kids);
}
async function pickSrc() { const [it] = await pick({ kinds: ['image'], title: 'L’image à éditer' }); if (it) setSource(it); }
function setSource(it) {
  if (!it || it.kind !== 'image') return;
  if (S.current?.id !== it.id) { S.edit.mask = ''; if (S.paint.for !== it.id) clearPaint(); }
  S.current = it;
  if (S.mode !== 'edit') S.mode = 'edit';
  saveDraft(); paintBar();
}

// ligne 2 : le prompt (d'une à trois lignes) ; « @ » nomme une référence
function field() {
  if (S.mode === 'create') return { obj: S, key: 'prompt', ph: promptHint() };
  const E = S.edit;
  if (!S.current) return null;
  if (E.tool === 'instruct') {
    return { obj: E, key: 'prompt', ph: E.model === 'qwen21' ? 'La consigne, en anglais : « Change the jacket in <image1> to red leather »'
      : 'La consigne, en anglais : « Recolor the jacket to red leather »' };
  }
  if (E.tool === 'refine') {
    // « une description détaillée » (note du gabarit Z-Image 2K) : le prompt
    // d'une image créée ici en est une ; une consigne d'édition non
    const caption = S.current.params?.job === 'image.generate' ? (S.current.prompt || '') : '';
    if (E.captionFor !== S.current.id) { E.caption = caption; E.captionFor = S.current.id; }
    return { obj: E, key: 'caption', ph: 'Une description détaillée de l’image, en anglais' };
  }
  return null;
}
function fixedText() {
  const E = S.edit;
  if (!S.current) return 'Choisissez l’image à éditer : « + », ou déposez-la sur la barre.';
  const tool = S.cfg.edit_tools.find((t) => t.id === E.tool);
  if (tool?.off) return `${tool.name} : ${tool.off}`;
  if (E.tool === 'matte') return 'Le sujet seul, sur fond transparent (BiRefNet).';
  if (E.tool === 'upscale') return `×${E.factor} par SeedVR2 7B. Une vidéo : l’outil Upscale.`;
  if (E.tool === 'angle' && angleDefaults()) return `<sks> ${E.azimuth} ${E.elevation} ${E.distance}`;
  return '';
}
function paintText() {
  const ta = $('#prompt'), fx = $('#pb-fixed');
  const f = field();
  ta.hidden = !f;
  fx.hidden = !!f;
  if (!f) { fx.textContent = fixedText(); atClose(); return; }
  const v = f.obj[f.key] || '';
  if (ta.value !== v) ta.value = v;
  ta.placeholder = f.ph;
  grow();
}
function grow() {
  const ta = $('#prompt');
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, lh * 3 + 8)}px`;
}
// Krea : « Long detailed prompts yield best results » (docs/prompting.md) ; Z-Image et Qwen : des phrases détaillées
function promptHint() {
  if (S.model === 'qwen21') return 'Décrivez l’image, en anglais — @ nomme une référence';
  return 'Décrivez l’image, en anglais : le sujet, le lieu, la lumière';
}
const AT = { list: [], sel: 0, q: null };
function atChoices() {
  const R = refsOf();
  if (R.model !== 'qwen21') {
    return { why: R.model === 'krea2' ? 'Krea 2 ne nomme pas ses références : l’ordre suffit (la scène, puis le sujet)'
      : M(R.model).refs_why || `${M(R.model).name} ne prend pas de référence` };
  }
  const toks = (R.edit ? [{ title: 'l’image éditée', url: S.current?.thumb_url || S.current?.url }] : []).concat(R.list);
  if (!toks.length) return { why: 'aucune référence : ajoutez-en par « + »' };
  return { toks: toks.map((it, k) => ({ tag: `<image${k + 1}>`, title: it.title || '', thumb: it.thumb_url || it.url })) };
}
function atCheck() {
  const ta = $('#prompt');
  const m = ta.value.slice(0, ta.selectionStart).match(/(?<![\p{L}\p{N}_])@([\p{L}\p{N}]*)$/u);
  if (!m) { atClose(); return; }
  const c = atChoices();
  AT.q = m[0];
  if (c.why) { AT.list = []; showAt([], c.why); return; }
  const q = m[1].toLowerCase();
  AT.list = c.toks.filter((t) => !q || t.tag.includes(q) || t.title.toLowerCase().includes(q));
  AT.sel = 0;
  showAt(AT.list, AT.list.length ? '' : `rien ne répond à « ${m[1]} »`);
}
function showAt(list, why) {
  const box = $('#pb-at');
  box.hidden = false;
  box.replaceChildren(...(why ? [el('p', { class: 'why' }, why)] : []), ...list.map((t, k) => el('button', { class: 'pb-atb' + (k === AT.sel ? ' on' : ''), type: 'button',
    onmousedown: (e) => { e.preventDefault(); insertTok(t.tag); } },
  el('span', { class: 'mi', style: t.thumb ? { backgroundImage: `url(${href(t.thumb)})` } : null }), el('b', {}, t.tag), el('span', {}, t.title))));
}
function atClose() { const b = $('#pb-at'); if (b) { b.hidden = true; b.replaceChildren(); } AT.q = null; AT.list = []; }
function insertTok(tag) {
  const ta = $('#prompt');
  const at = ta.selectionStart;
  const start = AT.q ? at - AT.q.length : at;
  ta.setRangeText(`${tag} `, start, at, 'end');
  atClose();
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}
// la puce « @ » : tape @ à la place du curseur, le menu des références s'ouvre
function typeAt() {
  const ta = $('#prompt');
  if (ta.hidden) return;
  const c = atChoices();
  if (c.why) { toast(c.why, 5000); return; }
  ta.focus();
  const p = ta.selectionStart ?? ta.value.length;
  const pre = ta.value.slice(0, p);
  ta.setRangeText(`${pre && !/\s$/.test(pre) ? ' ' : ''}@`, p, ta.selectionEnd ?? p, 'end');
  ta.dispatchEvent(new Event('input'));
}
function wireText() {
  const ta = $('#prompt');
  // chaque passage dans un champ de la barre est une saisie : un seul geste à annuler
  $('#pbar').addEventListener('focusin', (e) => { if (e.target.matches?.('textarea, input')) typing++; });
  ta.addEventListener('input', () => {
    const f = field();
    if (!f) return;
    f.obj[f.key] = ta.value;
    saveDraft(); schedCompose(); paintAct(); grow(); atCheck();
  });
  ta.addEventListener('click', atCheck);
  ta.addEventListener('blur', () => setTimeout(atClose, 150));
  ta.addEventListener('keydown', (e) => {
    const box = $('#pb-at');
    if (!box.hidden && AT.list.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        AT.sel = (AT.sel + (e.key === 'ArrowDown' ? 1 : AT.list.length - 1)) % AT.list.length;
        showAt(AT.list, '');
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertTok(AT.list[AT.sel].tag); return; }
    }
    if (!box.hidden && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); atClose(); return; }
    // Ctrl (ou ⌘) + Entrée : lancer
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#act .pb-gen')?.click(); }
  });
}

// ligne 3 : les puces
function chip(label, { value = '', dot = null, onclick, title = '', cls = '', off = '', open = false } = {}) {
  return el('button', { class: `pc ${cls}${open ? ' on' : ''}`.trim(), type: 'button', 'aria-haspopup': 'menu',
    title: off || title || null, 'aria-disabled': off ? 'true' : null,
    onclick: (e) => { if (off) { toast(off, 5000); return; } onclick(e.currentTarget); } },
  dot ? el('i', { class: 'pc-dot', style: { background: `var(--${dot})` } }) : null,
  label ? el('span', { class: 'pc-l' }, label) : null,
  value ? el('b', {}, value) : null);
}
// le nombre : − n/4 +
function counter(o, max) {
  const set = (n) => { o.count = Math.max(1, Math.min(max, n)); saveDraft(); paintChips(); paintAct(); };
  return el('span', { class: 'pc count', title: `images par envoi, ${max} au plus` },
    el('button', { type: 'button', 'aria-label': 'une de moins', disabled: o.count <= 1 ? true : null, onclick: () => set(o.count - 1) }, '−'),
    el('b', {}, `${o.count}/${max}`),
    el('button', { type: 'button', 'aria-label': 'une de plus', disabled: o.count >= max ? true : null, onclick: () => set(o.count + 1) }, '+'));
}
function modelItems(ids, current, onpick, disabled = {}) {
  return [{ head: 'Modèle' }, ...ids.map((id) => {
    const it = M(id);
    const off = disabled[id] || '';
    return { label: it.name, dot: DOT[id], sub: it.refs ? `${it.refs} réf.` : 'texte seul', checked: current === id, disabled: !!off,
      why: off ? `${it.name} : ${off}` : '', title: it.role, onclick: () => onpick(id) };
  })];
}
// le rendu propre à chaque modèle (un réglage rare : dans les paramètres avancés) ;
// `alt` : ce qui s'écarte du défaut, montré sur la puce
function renderOf(m) {
  const set = (k, v) => () => { S[k] = v; saveDraft(); paintBar(); };
  if (m.id === 'zimage') return { label: 'Variante', alt: S.variant !== 'turbo' ? (m.variants.find((v) => v.id === S.variant)?.label || S.variant).split(' · ')[0] : '',
    opts: m.variants.map((v) => {
      const a = avail('zimage:' + v.id);
      return { label: v.label, on: S.variant === v.id, off: a.ok ? '' : a.why, onclick: set('variant', v.id) };
    }) };
  if (m.id === 'krea2') return { label: 'Rendu photo', alt: S.realism ? '' : 'sans LoRA photo',
    opts: [{ label: 'UltraReal 0,7', title: 'LoRA photo (banc Character Factory du 28/09), sans effet avec une référence', on: !!S.realism, onclick: set('realism', true) },
      { label: 'Sans LoRA photo', on: !S.realism, onclick: set('realism', false) }] };
  return { label: 'Fond', alt: S.transparent ? 'fond transparent' : '',
    opts: [{ label: 'Opaque', on: !S.transparent, onclick: set('transparent', false) },
      { label: 'Transparent', title: 'RGBA natif de Qwen 2.1 (gabarit officiel)', on: !!S.transparent, onclick: set('transparent', true) }] };
}
function sizeNote(m) {
  if (m.id === 'zimage') return 'paliers du Space Z-Image-Turbo';
  if (m.id === 'qwen21') return S.quality === '2k' ? 'tailles du README Qwen-Image 2.1' : 'gabarits ComfyUI';
  return 'README Krea 2';
}
// la puce des paramètres avancés : fermée par défaut ; ce qui s'écarte du défaut s'y lit
function advChip() {
  const o = S.mode === 'create' ? S : S.edit;
  const alt = [o.seed ? `graine ${o.seed}` : '',
    S.mode === 'create' ? renderOf(M(S.model)).alt : '',
    S.mode === 'edit' && S.edit.tool === 'instruct' && !S.edit.keepFace ? 'visage libre' : ''].filter(Boolean);
  return chip('Paramètres avancés', { value: alt.join(' · '), cls: 'adv' + (alt.length ? ' set' : ''), open: S.pop === 'adv', onclick: () => togglePop('adv') });
}
function paintChips() {
  const box = $('#pb-chips');
  if (S.mode === 'create') {
    const m = M(S.model);
    const sizes = m.sizes[S.quality];
    const qLabel = m.quality.find((q) => q.id === S.quality)?.label || '';
    const nLooks = Object.values(S.looks).filter(Boolean).length;
    const at = atChoices();
    const R = refsOf();
    box.replaceChildren(
      chip('+', { cls: 'ic', title: m.refs ? `ajouter une référence (${S.refs.length}/${m.refs})` : '',
        off: !m.refs || S.refs.length >= m.refs ? maxWhy(R) : '', onclick: addRefs }),
      chip('@', { cls: 'ic', title: 'nommer une référence', off: at.why || '', onclick: typeAt }),
      chip('', { value: m.name, dot: DOT[m.id], title: m.role, onclick: (a) => up(a, modelItems(['zimage', 'qwen21', 'krea2'], S.model, (id) => {
        S.model = id;
        if (S.refs.length > M(id).refs) S.refs = S.refs.slice(0, M(id).refs);
        fixQuality(); saveDraft(); paintBar();
      })) }),
      chip('', { value: S.aspect, title: `format · ${sizes[S.aspect]?.join(' × ') || ''}`, onclick: (a) => up(a, [{ head: `Format · ${qLabel}` }, ...S.cfg.aspects.map((x) => {
        const wh = sizes[x];
        return { label: x, sub: wh ? `${wh[0]}×${wh[1]}` : '', checked: S.aspect === x, disabled: !wh, why: `${x} : non documenté en ${qLabel} pour ${m.name}`,
          onclick: () => { S.aspect = x; saveDraft(); paintChips(); paintAct(); } };
      })]) }),
      chip('', { value: qLabel, title: `taille · source : ${sizeNote(m)}`, onclick: (a) => up(a, [{ head: 'Taille' }, ...m.quality.map((x) => {
        const wh = m.sizes[x.id][S.aspect];
        return { label: x.label, sub: wh ? `${wh[0]}×${wh[1]}` : `pas de ${S.aspect}`, checked: S.quality === x.id,
          onclick: () => { S.quality = x.id; fixQuality(); saveDraft(); paintChips(); paintAct(); } };
      })]) }),
      counter(S, 4),
      chip('Prise de vue', { value: nLooks ? String(nLooks) : '', cls: nLooks ? 'set' : '', open: S.pop === 'looks', title: 'caméra, objectif, ouverture, pellicule, lumière',
        onclick: () => togglePop('looks') }),
      advChip());
    return;
  }
  const E = S.edit;
  const tool = S.cfg.edit_tools.find((t) => t.id === E.tool);
  const kids = [chip('Outil', { value: tool?.name || E.tool, title: tool?.about || '', onclick: (a) => up(a, [{ head: 'Outil' }, ...S.cfg.edit_tools.map((t) => ({
    label: t.name, sub: t.sub, checked: E.tool === t.id, disabled: !!t.off, why: t.off ? `${t.name} : ${t.off}` : '', title: t.about,
    onclick: () => { E.tool = t.id; S.pop = null; S.paint.on = false; saveDraft(); paintBar(); } }))]) })];
  if (!S.current || tool?.off) { box.replaceChildren(...kids); return; }
  if (E.tool === 'instruct') {
    const P = S.paint;
    const painted = P.dirty && P.for === S.current?.id;
    const light = S.cfg.looks.find((g) => g.id === 'light');
    const lightName = light?.items.find((x) => x.id === E.looks.light)?.name || '';
    const at = atChoices();
    kids.push(
      chip('', { value: M(E.model).name, dot: DOT[E.model], title: M(E.model).role, onclick: (a) => up(a, modelItems(['qwen21', 'krea2', 'zimage'], E.model, (id) => {
        E.model = id;
        if (E.refs.length > M(id).refs - 1) E.refs = E.refs.slice(0, M(id).refs - 1);
        saveDraft(); paintBar();
      }, { zimage: 'n’édite pas par consigne (Z-Image-Edit n’est pas publié) — il sait affiner : outil « Affiner ×2 »' })) }),
      chip('Zone', { value: painted ? 'peinte' : E.mask ? 'reprise' : 'toute l’image', cls: painted || E.mask ? 'set' : '', title: 'la zone qui change',
        onclick: (a) => up(a, [{ head: painted ? 'la zone peinte' : E.mask ? 'la zone de l’image réutilisée' : 'toute l’image change' },
          { label: painted ? 'Reprendre la zone…' : 'Peindre une zone…', sub: 'grande fenêtre', onclick: openPaint },
          { label: 'Effacer la zone', disabled: !(painted || E.mask), why: 'aucune zone : toute l’image change', onclick: () => { clearPaint(); E.mask = ''; saveDraft(); paintBar(); } }]) }),
      chip('Consignes', { title: 'consignes toutes faites', onclick: (a) => up(a, [{ head: `Consignes · ${M(E.model).name}` },
        ...QUICK[E.model].map((q) => ({ label: q.name, title: `${q.text}\nsource : ${q.src}`, onclick: () => { E.prompt = q.text; saveDraft(); paintText(); schedCompose(); paintAct(); $('#prompt').focus(); } })),
        E.model === 'krea2' ? { head: 'retirer : Qwen (Krea Raw non installé)' } : null]) }),
      chip('+', { cls: 'ic', title: `ajouter une référence (${E.refs.length}/${M(E.model).refs - 1})`,
        off: E.refs.length >= M(E.model).refs - 1 ? maxWhy(refsOf()) : '', onclick: addRefs }),
      chip('@', { cls: 'ic', title: 'nommer une image', off: at.why || '', onclick: typeAt }),
      chip('Rééclairer', { value: lightName, cls: lightName ? 'set' : '', open: S.pop === 'relight', title: 'une lumière ajoutée à la consigne', onclick: () => togglePop('relight') }),
      counter(E, 4),
      advChip());
  } else if (E.tool === 'upscale') {
    const src = S.current;
    kids.push(chip('Facteur', { value: `×${E.factor}`, onclick: (a) => up(a, [{ head: 'Agrandir' }, ...[2, 4].map((f) => {
      const big = Math.max(src.width || 0, src.height || 0) * f;
      return { label: `×${f}`, sub: `${(src.width || 0) * f}×${(src.height || 0) * f}`, checked: E.factor === f, disabled: big > 8192, why: `×${f} dépasserait 8192 px`,
        onclick: () => { E.factor = f; saveDraft(); paintBar(); } };
    })]) }));
  } else if (E.tool === 'refine') {
    kids.push(chip('Débruitage', { value: E.denoise.toFixed(2).replace('.', ','), open: S.pop === 'refine',
      onclick: () => togglePop('refine') }), counter(E, 2), advChip());
  } else if (E.tool === 'angle') {
    const A = angleDefaults();
    const name = (list, id) => list.find(([x]) => x === id)?.[1] || id;
    kids.push(chip('Point de vue', { value: `${name(A.azimuth, E.azimuth)} · ${name(A.elevation, E.elevation)} · ${name(A.distance, E.distance)}`,
      open: S.pop === 'angle', onclick: () => togglePop('angle') }), counter(E, 4), advChip());
  }
  box.replaceChildren(...kids);
}

// l'angle par défaut : ¾ avant droit, hauteur d'œil, plan moyen
function angleDefaults() {
  const A = S.cfg.angles, E = S.edit;
  if (!E.azimuth) E.azimuth = A.azimuth[1][0];
  if (!E.elevation) E.elevation = 'eye-level shot';
  if (!E.distance) E.distance = 'medium shot';
  return A;
}

// ── les panneaux au-dessus de la barre ──────────────────────
function togglePop(id) { S.pop = S.pop === id ? null : id; paintPop(); paintChips(); }
// le sigle posé sur la vignette dessinée (image.css) d'une caméra ou d'un objectif
const ABBR = {
  camera: { fullframe: 'FF', mediumformat: 'MF', leica: 'M6', alexa: 'S35', imax: '70', '16mm': '16', digicam: 'DC', disposable: 'FL', phone: 'PH' },
  lens: { 14: '14', 24: '24', 35: '35', 50: '50', 85: '85', 135: '135', macro: '1:1', anamorphic: '2.39', swirl: 'PTZ', vintage: 'K35' },
};
function swatches(g, looks, mode) {
  const model = mode === 'edit' ? S.edit.model : S.model;
  return el('div', { class: 'looks' }, ...g.items.map((x) => {
    const said = mode === 'edit' ? (x.edit || x.prose) : (model === 'krea2' && x.krea ? x.krea : x.prose);
    return el('button', { class: 'opt look' + (looks[g.id] === x.id ? ' on' : ''), type: 'button', title: `« ${said} »\nsource : ${x.src}`,
      onclick: () => { looks[g.id] = looks[g.id] === x.id ? null : x.id; saveDraft(); schedCompose(); paintPop(); paintChips(); } },
    el('span', { class: 'sw', 'data-g': g.id, 'data-id': x.id, 'data-abbr': ABBR[g.id]?.[x.id] ?? null }), el('b', {}, x.name), x.sub ? el('small', {}, x.sub) : null);
  }));
}
function paintPop() {
  const box = $('#pop');
  if (!S.pop) { box.hidden = true; box.replaceChildren(); return; }
  const keep = box.querySelector('.pp-body')?.scrollTop || 0;
  const head = (title, ...right) => el('div', { class: 'pp-h' }, el('span', { class: 'lbl' }, title), el('span', { class: 'sp' }), ...right,
    el('button', { class: 'pp-x', type: 'button', title: 'fermer (Échap)', 'aria-label': 'fermer', onclick: () => togglePop(S.pop) }, '×'));
  let kids = [];
  if (S.pop === 'looks' || S.pop === 'relight') {
    const edit = S.pop === 'relight';
    const looks = edit ? S.edit.looks : S.looks;
    const groups = edit ? S.cfg.looks.filter((g) => g.id === 'light') : S.cfg.looks;
    const g = groups.find((x) => x.id === S.lookTab) || groups[0];
    const chosen = groups.map((x) => x.items.find((i) => i.id === looks[x.id])?.name).filter(Boolean);
    kids = [head(edit ? 'Rééclairer' : 'Prise de vue', el('span', { class: 'lbl pp-sum' }, chosen.join(' · ') || 'aucune'),
      el('button', { class: 'tb ghost sm', type: 'button', disabled: chosen.length ? null : true, title: 'tout retirer',
        onclick: () => { for (const x of groups) looks[x.id] = null; saveDraft(); schedCompose(); paintPop(); paintChips(); } }, 'aucune')),
    groups.length > 1 ? el('div', { class: 'pp-tabs', role: 'tablist' }, ...groups.map((x) => {
      const cur = x.items.find((i) => i.id === looks[x.id]);
      return el('button', { class: 'pp-tab' + (x.id === g.id ? ' on' : ''), type: 'button', role: 'tab',
        onclick: () => { S.lookTab = x.id; saveDraft(); paintPop(); } }, el('span', {}, x.label), el('small', {}, cur ? cur.name : '—'));
    })) : null,
    el('div', { class: 'pp-body' }, swatches(g, looks, edit ? 'edit' : 'generate'))];
  } else if (S.pop === 'adv') {
    const o = S.mode === 'create' ? S : S.edit;
    const seed = el('input', { class: 'fld seed', id: 'seed', inputmode: 'numeric', placeholder: 'au hasard', value: o.seed,
      title: 'la même graine et la même recette refont la même image',
      oninput: (e) => { o.seed = e.target.value.replace(/\D/g, ''); e.target.value = o.seed; saveDraft(); paintChips(); } });
    const instruct = S.mode === 'create' || S.edit.tool === 'instruct';
    // une rangée : un intitulé, des boutons à choix unique
    const opts = (label, list) => el('div', { class: 'row' }, el('span', { class: 'lbl' }, label), el('div', { class: 'opts' }, ...list.map((x) => el('button', {
      class: 'opt' + (x.on ? ' on' : ''), type: 'button', title: x.off || x.title || null, disabled: x.off ? true : null, onclick: x.onclick }, x.label))));
    const rd = S.mode === 'create' ? renderOf(M(S.model)) : null;
    const E = S.edit;
    const face = S.mode === 'edit' && E.tool === 'instruct' ? opts('Visage', [
      { label: 'Gardé', on: E.keepFace, title: E.model === 'qwen21' ? 'phrase du gabarit officiel Qwen 2.1' : 'phrase de Character Factory (banc du 28/09)',
        onclick: () => { E.keepFace = true; saveDraft(); paintBar(); } },
      { label: 'Libre', on: !E.keepFace, onclick: () => { E.keepFace = false; saveDraft(); paintBar(); } }]) : null;
    kids = [head('Paramètres avancés'),
      el('div', { class: 'pp-body' },
        el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Graine'), seed,
          el('button', { class: 'tb ghost sm', type: 'button', title: 'une graine au hasard', onclick: () => { o.seed = String(Math.floor(Math.random() * 1e9)); seed.value = o.seed; saveDraft(); paintChips(); } }, 'dé'),
          o.seed ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { o.seed = ''; saveDraft(); paintChips(); paintPop(); } }, 'auto') : null,
          o.origSeed != null ? el('button', { class: 'tb ghost sm', type: 'button', title: `la graine de l’image réutilisée : ${o.origSeed}`,
            onclick: () => { o.seed = String(o.origSeed); seed.value = o.seed; saveDraft(); paintChips(); } }, 'd’origine') : null),
        rd ? opts(rd.label, rd.opts) : null,
        face,
        instruct ? el('details', { class: 'pp-acc', open: S.sentOpen ? true : null, ontoggle: (e) => { S.sentOpen = e.currentTarget.open; } },
          el('summary', { class: 'lbl' }, 'Le prompt envoyé'), el('pre', { class: 'sent', id: 'sent' }, S.sent || '—')) : null)];
  } else if (S.pop === 'angle') {
    const A = S.cfg.angles, E = S.edit;
    const grp = (key, title, list) => el('div', { class: 'field' }, el('span', { class: 'lbl' }, title), el('div', { class: 'opts' }, ...list.map(([id, name]) => el('button', {
      class: 'opt' + (E[key] === id ? ' on' : ''), type: 'button', title: id, onclick: () => { E[key] = id; saveDraft(); paintPop(); paintChips(); paintText(); } }, name))));
    kids = [head('Angle', el('span', { class: 'lbl pp-sum' }, `<sks> ${E.azimuth} ${E.elevation} ${E.distance}`)),
      el('div', { class: 'pp-body pp-angle' }, compass(A.azimuth, E), el('div', { class: 'stack' },
        grp('elevation', 'Hauteur', A.elevation), grp('distance', 'Distance', A.distance)))];
  } else if (S.pop === 'refine') {
    const E = S.edit;
    const val = el('span', { class: 'val' }, E.denoise.toFixed(2));
    kids = [head('Affiner ×2 · Z-Image Turbo'),
      el('div', { class: 'pp-body' }, el('div', { class: 'slide' },
        el('input', { type: 'range', min: 0.1, max: 0.5, step: 0.01, value: E.denoise, 'aria-label': 'débruitage',
          title: '0,15–0,25 proche · 0,25–0,35 réinvente le détail · au-delà, des défauts (gabarit Z-Image 2K)',
          oninput: (e) => { E.denoise = Number(e.target.value); val.textContent = E.denoise.toFixed(2); saveDraft(); paintChips(); } }), val),
      el('div', { class: 'scale' }, el('span', {}, 'proche'), el('span', {}, 'réinventé'), el('span', {}, 'défauts')))];
  }
  box.hidden = false;
  box.replaceChildren(...kids.filter(Boolean));
  const b = box.querySelector('.pp-body');
  if (b) b.scrollTop = keep;
}
// la boussole des huit azimuts : la vue de dessus, le sujet au centre
function compass(list, E) {
  const box = el('div', { class: 'compass' }, el('span', { class: 'who' }, 'sujet'));
  list.forEach(([id, name], k) => {
    const ang = (k * 45 - 90) * Math.PI / 180;
    // « 3/4 avant droit » sur deux lignes : la boussole reste compacte
    const m = name.match(/^(3\/4 \S+) (.+)$/);
    box.append(el('button', { class: 'pt' + (E.azimuth === id ? ' on' : ''), type: 'button', title: `${name} — ${id}`,
      style: { left: `${50 + 40 * Math.cos(ang)}%`, top: `${50 + 40 * Math.sin(ang)}%` },
      onclick: () => { E.azimuth = id; saveDraft(); paintPop(); paintChips(); paintText(); } }, ...(m ? [m[1].replace('3/4', '¾'), el('br'), m[2]] : [name])));
  });
  return box;
}

// à droite : l'action, le seul orange, avec le temps mesuré
function measured(prefix, job) {
  const xs = (fil?.items() || []).filter((x) => x.render_s && x.params?.job === job && (x.origin?.model || '').startsWith(prefix))
    .map((x) => x.render_s).sort((a, b) => a - b);
  if (!xs.length) return { short: 'temps non mesuré', long: 'aucun rendu de ce modèle dans le fil : pas de temps mesuré' };
  const med = xs[Math.floor(xs.length / 2)];
  return { short: `≈ ${fmtS(med)}`, long: `médiane de ${plural(xs.length, 'rendu')} de ce modèle dans le fil : ${fmtS(med)} par image${stub() ? ' (moteur factice)' : ''}` };
}
function paintAct() {
  const box = $('#act');
  if (!box || !S.cfg) return;
  let label; let why; let info; let est; let n;
  if (S.mode === 'create') {
    const m = M(S.model);
    const a = avail(capCreate());
    why = !S.prompt.trim() ? 'écrivez un prompt' : !a.ok ? `modèle absent — ${a.why}` : '';
    label = 'Générer';
    n = S.count;
    const wh = m.sizes[S.quality]?.[S.aspect];
    info = `${m.name} · ${wh ? wh.join(' × ') : ''}${a.on?.length ? ' · ' + a.on.join(' + ') : ''}`;
    est = measured(S.model, 'image.generate');
  } else {
    const E = S.edit;
    const a = avail(capEdit());
    const tool = S.cfg.edit_tools.find((t) => t.id === E.tool);
    label = { instruct: (E.mask || (S.paint.dirty && S.paint.for === S.current?.id)) ? 'Éditer la zone' : 'Éditer', matte: 'Détourer', upscale: `Agrandir ×${E.factor}`,
      refine: 'Affiner ×2', angle: 'Tourner' }[E.tool] || 'Éditer';
    why = !S.current ? 'choisissez l’image à éditer' : tool?.off ? `${tool.name} : indisponible` : !a.ok ? `modèle absent — ${a.why}`
      : (E.tool === 'instruct' && !E.prompt.trim()) ? 'écrivez une consigne' : '';
    n = ['instruct', 'angle', 'refine'].includes(E.tool) ? E.count : 1;
    info = a.on?.length ? `sur ${a.on.join(' + ')}` : '';
    const prefix = { instruct: `${E.model}-edit`, matte: 'birefnet', upscale: 'seedvr2', refine: 'zimage-refine', angle: 'qwen-edit-2511-angles' }[E.tool] || E.tool;
    est = measured(prefix, 'image.edit');
  }
  // replaceChildren(null) écrirait « null » : on ne passe que des nœuds
  box.replaceChildren(...[
    el('button', { class: 'tb go pb-gen', type: 'button', disabled: why ? true : null, title: `${info}\n${est.long}`.trim(), onclick: S.mode === 'create' ? generate : editRun },
      el('span', { class: 'gl' }, label), el('small', {}, `${n > 1 ? `${n} × ` : ''}${est.short}`)),
    why ? el('p', { class: 'why' }, why) : null].filter(Boolean));
}

// ── éditer : consignes toutes faites, la zone peinte ────────
// Des consignes tirées des exemples officiels (étude §6).
const QUICK = {
  qwen21: [
    { name: 'Essayage', text: 'Keep the person and the pose in <image1> unchanged, put the outfit from <image2> on the person, preserve the original facial features, hair, body shape and pose, natural clothing folds, keep the original background and original lighting.', src: 'gabarit officiel Qwen 2.1 (essayage)' },
    { name: 'Retirer', text: 'Remove … from <image1>; keep everything else unchanged.', src: 'README Qwen 2.1 (« remove watch »)' },
    { name: 'Remplacer', text: 'Replace the … in <image1> with …; keep everything else unchanged.', src: 'README Qwen 2.1 (« replace clothing »)' },
    { name: 'Couleur', text: 'Change the color of the … in <image1> to …; keep everything else unchanged.', src: 'README Qwen 2.1 (« change hair color »)' },
    { name: 'Ajouter', text: 'Add the … from <image2> to <image1>, …; keep the original background and original lighting.', src: 'gabarit officiel Qwen 2.1' },
  ],
  krea2: [
    { name: 'Mettre en scène', text: 'Create a photo of this person at …', src: 'fiche Krea 2 Identity Edit (« at a night market »)' },
    { name: 'À côté de', text: 'Create a photo of this person next to the …', src: 'fiche Krea 2 Identity Edit (« next to the tractor »)' },
    { name: 'Remplacer', text: 'Replace the … with …', src: 'fiche Krea 2 Identity Edit (« replace the woman with a big orangutan »)' },
    { name: 'Recolorer', text: 'Recolor the … to …', src: 'README comfyui-krea2edit (« recolor the car to matte black »)' },
    { name: 'Personne ajoutée', text: 'Place the person from the second image into the scene of the first image, …', src: 'fiche Identity Edit : scène en image 1, personne en image 2' },
  ],
};

// La zone peinte : un masque au pinceau sur l'image, à sa taille réelle, dans
// une grande fenêtre ; il reste d'une ouverture à l'autre, jusqu'à « Effacer »
// ou une autre image.
function openPaint() {
  const it = S.current;
  if (!it) { toast('choisissez d’abord l’image à éditer'); return; }
  const P = S.paint;
  P.on = true;
  const cv = paintCanvas();
  const wrap = el('div', { class: 'imwrap' }, el('img', { src: href(it.url), alt: '', draggable: 'false' }), cv);
  const brush = el('input', { type: 'range', min: 8, max: 200, value: P.size, oninput: (e) => { P.size = Number(e.target.value); } });
  const close = () => {
    P.on = false; cv.classList.remove('on');
    if (P.dirty) S.edit.mask = '';   // une zone peinte remplace celle d'une image réutilisée
    scrim.remove(); document.removeEventListener('keydown', esc, true);
    saveDraft(); paintChips(); paintAct();
  };
  const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const scrim = el('div', { class: 'scrim paintm' }, el('div', { class: 'modal lg', role: 'dialog', 'aria-label': 'peindre la zone' },
    el('div', { class: 'modal-head' }, el('span', { class: 't' }, 'Peindre la zone à changer'), el('span', { class: 'sp' }),
      el('label', { class: 'brush' }, el('span', { class: 'lbl' }, 'pinceau'), brush),
      el('button', { class: 'tb ghost sm', onclick: () => clearPaint() }, 'Effacer'),
      el('button', { class: 'tb sm on', onclick: close }, 'Terminé')),
    el('div', { class: 'modal-body pm-body' }, wrap,
      el('p', { class: 'hint' }, 'Seule la zone peinte change.'))));
  document.addEventListener('keydown', esc, true);
  document.body.append(scrim);
}
function paintCanvas() {
  const P = S.paint;
  const it = S.current;
  if (!P.canvas || P.for !== it.id) {
    P.canvas = el('canvas', { class: 'paint', width: it.width || 1024, height: it.height || 1024 });
    P.for = it.id; P.dirty = false;
    let drawing = false;
    const ctx = P.canvas.getContext('2d');
    const pos = (e) => { const r = P.canvas.getBoundingClientRect(); return [(e.clientX - r.left) * P.canvas.width / r.width, (e.clientY - r.top) * P.canvas.height / r.height]; };
    const dot = (e) => {
      const [x, y] = pos(e);
      const r = P.canvas.getBoundingClientRect();
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--or').trim();
      ctx.beginPath(); ctx.arc(x, y, (P.size / 2) * P.canvas.width / r.width, 0, Math.PI * 2); ctx.fill();
      P.dirty = true;
    };
    P.canvas.addEventListener('pointerdown', (e) => { if (!P.on) return; drawing = true; P.canvas.setPointerCapture(e.pointerId); dot(e); });
    P.canvas.addEventListener('pointermove', (e) => { if (drawing && P.on) dot(e); });
    P.canvas.addEventListener('pointerup', () => { drawing = false; });
  }
  P.canvas.classList.toggle('on', P.on);
  return P.canvas;
}
function clearPaint() {
  const P = S.paint;
  if (P.canvas) P.canvas.getContext('2d').clearRect(0, 0, P.canvas.width, P.canvas.height);
  P.dirty = false;
}
// le masque envoyé : blanc là où l'on a peint, noir ailleurs (des données, pas une couleur de thème)
function maskDataUrl() {
  const P = S.paint;
  if (!P.canvas || !P.dirty || P.for !== S.current?.id) return null;
  const { width: w, height: h } = P.canvas;
  const src = P.canvas.getContext('2d').getImageData(0, 0, w, h);
  const out = new ImageData(w, h);
  for (let i = 0; i < src.data.length; i += 4) {
    const v = src.data[i + 3] > 0 ? 255 : 0;
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(out, 0, 0);
  return c.toDataURL('image/png');
}

// ── lancer ──────────────────────────────────────────────────
async function generate() {
  const body = { model: S.model, variant: S.variant, prompt: S.prompt, looks: S.looks, aspect: S.aspect, quality: S.quality,
    count: S.count, realism: S.realism, transparent: S.model === 'qwen21' && S.transparent, refs: refsParam(S.refs) };
  if (S.seed) body.seed = Number(S.seed);
  await launch('image/generate', body);
}
async function editRun() {
  const E = S.edit;
  const body = { tool: E.tool, source: S.current.id };
  if (E.seed) body.seed = Number(E.seed);
  if (E.tool === 'instruct') {
    Object.assign(body, { model: E.model, prompt: E.prompt, looks: E.looks, keep_face: E.keepFace, refs: refsParam(E.refs), count: E.count });
    const mask = maskDataUrl() || E.mask;
    if (mask) body.mask = mask;
  }
  if (E.tool === 'upscale') body.factor = E.factor;
  if (E.tool === 'refine') Object.assign(body, { denoise: E.denoise, prompt: E.caption || '', count: E.count });
  if (E.tool === 'angle') Object.assign(body, { azimuth: E.azimuth, elevation: E.elevation, distance: E.distance, count: E.count });
  await launch('image/edit', body);
}
async function launch(path, body) {
  const btn = $('#act .pb-gen');
  if (btn) btn.disabled = true;
  let r;
  try { r = await api(path, { method: 'POST', body }); } catch (e) { toast(e.message, 7000); paintAct(); return; }
  for (const j of r.jobs) follow(j);
  toast(r.jobs.length > 1 ? `${r.jobs.length} rendus en file — en tête du fil` : 'en file — en tête du fil');
  paintAct();
  fil?.paintJobs();
  // la tête du fil, où paraissent les rendus (préférence ; doux sauf animations réduites)
  if (prefs.get('image.scrollTop', true)) scrollTo({ top: 0, behavior: scrollBehavior() });
}
// les travaux lancés d'ici : suivis un à un (la file commune ne les voit
// qu'au relevé suivant) ; leurs images se posent dans le fil en arrivant
function follow(j) {
  S.mine.set(j.id, j);
  jobs.wait(j.id, (now) => { S.mine.set(j.id, now); fil?.paintJobs(); }).then((done) => {
    S.mine.delete(j.id);
    // un échec reste dans le fil (Relancer, ×) ; le reste laisse la place à ses images
    if (done.state === 'error') S.mine.set(j.id, done); else S.done.add(j.id);
    if (done.state === 'done' && done.items?.length) fil?.add(done.items);
    else if (done.state === 'error') toast(`échec : ${done.message}`, 9000);
    fil?.paintJobs();
    paintAct();   // le temps mesuré suit les rendus arrivés
  }).catch(() => { S.mine.delete(j.id); });
}

// ── la file dans le fil : en file, en cours, et les échecs de la session ──
const LIVE = ['queued', 'running'];
const RANK = { queued: 0, running: 1, done: 2, error: 2, cancelled: 2, interrupted: 2 };
function liveJobs() {
  const byId = new Map();
  for (const j of S.lastList) if (j.tool === 'image') byId.set(j.id, j);
  for (const [id, j] of S.mine) { const cur = byId.get(id); if (!cur || RANK[j.state] >= RANK[cur.state]) byId.set(id, j); }
  return [...byId.values()].filter((j) => !S.done.has(j.id) && !S.gone.has(j.id)
    && (LIVE.includes(j.state) || (S.mine.has(j.id) && j.state === 'done')
      || (['error', 'interrupted'].includes(j.state) && ms(j.created) >= ms(S.session))))
    .sort((a, b) => ms(b.created) - ms(a.created));
}
const onJob = {
  cancel: (j) => jobs.cancel(j.id).then(() => fil.paintJobs()).catch((e) => toast(e.message)),
  retry: (j) => jobs.retry(j.id).then((nj) => { S.done.add(j.id); S.mine.delete(j.id); jobs.forget(j.id).catch(() => {}); follow(nj); fil.paintJobs(); })
    .catch((e) => toast(e.message)),
  forget: (j) => { S.gone.add(j.id); S.mine.delete(j.id); jobs.forget(j.id).catch(() => {}); fil.paintJobs(); },
};

const shortModel = (m) => (m || '').replace(/^qwen-edit-2511-angles/, 'angle').replace(/-factice$/, ' · factice')
  .replace(/-turbo/, '').replace(/-edit(-zone)?/, ' éd.').toUpperCase();

// ── ce que le fil sait d'une image de l'outil ───────────────
const hasRecipe = (it) => ['image.generate', 'image.edit'].includes(it.params?.job);
const noRecipe = (it) => (hasRecipe(it) ? '' : 'image sans recette de l’outil Image : déposée, ou faite ailleurs');
function details(it) {
  const p = it.params || {};
  const m = S.cfg.models.find((x) => x.id === p.model);
  return [
    ['modèle', it.origin?.model || it.origin?.tool || ''],
    ['outil', p.job === 'image.edit' ? TOOL_FR[p.tool] || p.tool : p.job === 'image.generate' ? 'créer' : ''],
    ['taille', it.width ? `${it.width} × ${it.height}` : ''],
    ['format', p.aspect ? `${p.aspect}${m && p.quality ? ' · ' + (m.quality.find((q) => q.id === p.quality)?.label || p.quality) : ''}` : ''],
    ['graine', p.seed ?? ''],
    ['rendu', fmtS(it.render_s)],
    ['machine', it.origin?.machine || ''],
    ['dossier', it.folder || ''],
    ['créée', fmtDate(it.created)],
  ];
}
function extra(it) {
  const p = it.params || {};
  const looks = Object.entries(p.looks || {}).filter(([, v]) => v).map(([g, v]) => {
    const grp = S.cfg.looks.find((x) => x.id === g);
    return grp?.items.find((x) => x.id === v)?.name || v;
  });
  const out = [];
  if (looks.length) out.push(el('section', { class: 'fv-sec' }, el('span', { class: 'lbl' }, 'Prise de vue'),
    el('div', { class: 'fv-chips' }, ...looks.map((n) => el('span', { class: 'fl-chip' }, n)))));
  if (it.prompt && it.prompt !== p.prompt) {
    out.push(el('section', { class: 'fv-sec' }, el('details', {}, el('summary', { class: 'lbl' }, 'Prompt envoyé au modèle'), el('pre', {}, it.prompt))));
  }
  return out;
}
// « Avant / après » : l'image éditée contre sa source ; une autre image déposée
// sur le cadre prend la place de « avant »
function viewerTools(it, v) {
  const pid = it.parents?.[0];
  if (!pid || it.params?.job !== 'image.edit') return [];
  const b = el('button', { class: 'tb sm ghost', type: 'button', title: 'comparer à l’image source ; déposez une autre image sur le cadre pour changer « avant »' }, 'Avant / après');
  b.onclick = async () => {
    if (b.classList.contains('on')) { b.className = 'tb sm ghost'; v.reset(); return; }
    const src = await api('library/' + pid).catch(() => null);
    if (!src || src.kind !== 'image') { toast('l’image source a quitté la bibliothèque'); return; }
    b.className = 'tb sm on';
    const box = el('div', { class: 'cmpbox' }, compareView(src, it));
    dropZone(box, { kinds: ['image'], multiple: false, via: VIA, onitems: ([x]) => { box.replaceChildren(compareView(x, it)); toast(`« ${x.title} » en « avant »`); } });
    v.media(box);
  };
  return [b];
}
function compareView(a, b) {
  const wrap = el('div', { class: 'cmp' });
  const imA = el('img', { src: href(a.url), alt: 'avant', draggable: 'false' });
  const imB = el('img', { src: href(b.url), alt: 'après', class: 'b', draggable: 'false' });
  const handle = el('div', { class: 'handle' }, el('div', { class: 'grip' }, el('i'), el('i')));
  const set = (x) => { const p = Math.max(0, Math.min(100, x)); imB.style.clipPath = `inset(0 0 0 ${p}%)`; handle.style.left = p + '%'; };
  const move = (e) => { const r = wrap.getBoundingClientRect(); set(((e.clientX - r.left) / r.width) * 100); };
  wrap.addEventListener('pointerdown', (e) => { wrap.setPointerCapture(e.pointerId); move(e); wrap.onpointermove = move; });
  wrap.addEventListener('pointerup', () => { wrap.onpointermove = null; });
  wrap.append(imA, imB, handle, el('span', { class: 'cap a', title: 'déposez une autre image sur le cadre pour la comparer' }, 'avant'),
    el('span', { class: 'cap b' }, 'après'));
  set(50);
  return wrap;
}

// ── réutiliser (remplit la barre), recréer, et le reste du menu ⋯ ──
async function reuse(it) {
  const p = it.params || {};
  if (p.job === 'image.edit') return reuseEdit(it);
  Object.assign(S, { model: M(p.model) ? p.model : S.model, prompt: p.prompt || '', looks: { ...(p.looks || {}) }, aspect: p.aspect || S.aspect,
    quality: p.quality || S.quality, variant: p.variant || S.variant, realism: p.realism ?? S.realism, transparent: !!p.transparent,
    seed: '', origSeed: p.seed ?? null, mode: 'create', pop: null });
  S.refs = (await Promise.all((p.refs || []).map((r) => api('library/' + r.item).catch(() => null)))).filter(Boolean);
  for (const r of p.refs || []) if (r.ref) S.refChoice[r.item] = r.ref;
  const lost = (p.refs || []).length - S.refs.length;
  bar?.label(`réutiliser les réglages de « ${it.title || it.id} »`);
  fixQuality(); saveDraft(); paintBar();
  $('#prompt').focus();
  toast(`réglages repris, graine vidée${lost ? ` · ${plural(lost, 'référence partie', 'références parties')} de la bibliothèque` : ''}`, 5000);
}
async function reuseEdit(it) {
  const p = it.params || {};
  const src = await api('library/' + p.source).catch(() => null);
  if (!src || src.kind !== 'image') { toast('l’image source de cette édition a quitté la bibliothèque', 6000); return; }
  const refs = (await Promise.all((p.refs || []).map((r) => api('library/' + r.item).catch(() => null)))).filter(Boolean);
  for (const r of p.refs || []) if (r.ref) S.refChoice[r.item] = r.ref;
  if (S.paint.for !== src.id) clearPaint();
  S.current = src;
  S.mode = 'edit';
  S.pop = null;
  S.edit = { ...S.edit, tool: p.tool, model: p.model || S.edit.model, prompt: p.tool === 'instruct' ? (p.prompt || '') : S.edit.prompt,
    looks: { ...(p.looks || {}) }, keepFace: p.keep_face ?? S.edit.keepFace, factor: p.factor || S.edit.factor, denoise: p.denoise ?? S.edit.denoise,
    azimuth: p.azimuth || S.edit.azimuth, elevation: p.elevation || S.edit.elevation, distance: p.distance || S.edit.distance,
    mask: p.mask || '', refs, seed: '', origSeed: p.seed ?? null };
  if (p.tool === 'refine') { S.edit.caption = p.prompt || ''; S.edit.captionFor = src.id; }
  bar?.label(`réutiliser l’édition « ${it.title || it.id} »`);
  saveDraft(); paintBar();
  toast(`édition reprise (${TOOL_FR[p.tool] || p.tool}${p.mask ? ', même zone' : ''}), graine vidée`, 5000);
}
async function redo(it, n) { await launch('image/redo', { item: it.id, variations: n }); }
function editWith(it, tool) {
  if (S.paint.for !== it.id) clearPaint();
  S.current = it; S.mode = 'edit'; S.edit.tool = tool; S.edit.mask = ''; S.paint.on = false; S.pop = null;
  fil?.close();
  bar?.label(`éditer « ${it.title || it.id} » · ${TOOL_FR[tool]}`);
  saveDraft(); paintBar();
  if (!$('#prompt').hidden) $('#prompt').focus();
  toast(`la barre passe en édition · ${TOOL_FR[tool]}`);
}
function useAsRef(it) {
  if (!M(S.model).refs) S.model = 'krea2';
  const max = M(S.model).refs;
  if (!S.refs.some((r) => r.id === it.id)) S.refs = [...S.refs, it].slice(-max);
  S.mode = 'create';
  bar?.label(`prendre « ${it.title || it.id} » en référence`);
  fixQuality(); saveDraft(); paintBar();
  toast(`« ${it.title} » dans les références de ${M(S.model).name}`);
}
const ETYPES = [['character', 'Personnage'], ['object', 'Objet'], ['place', 'Lieu'], ['style', 'Style']];
async function makeElement(it, type) {
  try {
    const e = await api('elements', { method: 'POST', body: { title: it.title || 'élément', type, refs: [{ item: it.id, role: '', label: '' }] } });
    toast(`« ${e.title} » est un élément (${ETYPES.find(([t]) => t === type)[1].toLowerCase()}) : dans Asset, pris en référence partout`, 6000);
  } catch (e) { toast(e.message, 6000); }
}
const go = (path) => () => { location.href = href(path); };
function editEntries(it) {
  const huge = Math.max(it.width || 0, it.height || 0) * 2 > 8192;
  return [
    { label: 'Consigne', sub: 'qwen · krea', title: 'changer l’image par une phrase, sur tout ou une zone peinte', onclick: () => editWith(it, 'instruct') },
    { label: 'Zone peinte', sub: 'consigne', title: 'peindre la zone à changer, dans une grande fenêtre', onclick: () => { editWith(it, 'instruct'); openPaint(); } },
    { label: 'Détourer', sub: 'birefnet', onclick: () => editWith(it, 'matte') },
    { label: 'Agrandir ×2 · ×4', sub: 'seedvr2', disabled: huge, why: 'déjà trop grande : ×2 dépasserait 8192 px', onclick: () => editWith(it, 'upscale') },
    { label: 'Affiner ×2', sub: 'z-image', onclick: () => editWith(it, 'refine') },
    { label: 'Angle', sub: 'qwen-edit', onclick: () => editWith(it, 'angle') },
  ];
}
function menuFor(it) {
  const id = it.id;
  return [
    { label: 'Éditer', icon: '✎', items: editEntries(it) },
    { label: 'Animer', icon: '▶', sub: 'vidéo', title: 'cette image en première image d’un plan (outil Vidéo)', onclick: go(`movie/?start=${id}`) },
    { label: 'Prendre en référence', icon: '+', items: [
      { label: 'dans la barre', onclick: () => useAsRef(it) },
      { label: 'dans Vidéo', sub: '@image', onclick: go(`movie/?ref=${id}`) },
    ] },
    { label: 'Agrandir dans Upscale', icon: '⇱', onclick: go(`upscale/?src=${id}`) },
    { label: 'Envoyer au Montage', icon: '▤', onclick: go(`montage/?add=${id}`) },
    { label: 'Créer un élément', icon: '◆', items: ETYPES.map(([t, lab]) => ({ label: lab, onclick: () => makeElement(it, t) })) },
  ];
}

function mountFil() {
  fil = createFil($('#fil'), {
    id: 'image', layout: 'grid', title: 'Historique', undo: U,
    query: () => 'library?kind=image&tool=image',
    jobs: liveJobs, onJob,
    jobLines: (j) => [j.machine, j.message === 'en file' ? '' : j.message],
    prompt: (it) => it.params?.prompt ?? it.prompt ?? '',
    promptLabel: 'Prompt',
    badge: (it) => shortModel(it.origin?.model || it.origin?.tool),
    chips: (it) => [it.width ? `${it.width}×${it.height}` : '', it.params?.aspect || '', it.render_s ? fmtS(it.render_s) : ''],
    details, extra,
    alpha: (it) => /birefnet/.test(it.origin?.model || '') || !!it.params?.transparent,
    viewerTools,
    viewerActions: (it) => [
      el('button', { class: 'tb ghost', type: 'button', onclick: (e) => up(e.currentTarget, [{ head: 'Éditer cette image' }, ...editEntries(it)]) }, 'Éditer'),
      el('button', { class: 'tb ghost', type: 'button', title: 'en première image d’un plan (Vidéo)', onclick: go(`movie/?start=${it.id}`) }, 'Animer'),
      el('button', { class: 'tb ghost', type: 'button', title: 'dans les références de la barre', onclick: () => { fil.close(); useAsRef(it); } }, 'Référence'),
    ],
    reuse: { run: reuse, why: noRecipe },
    recreate: {
      run: (it) => redo(it, 1), why: noRecipe,
      more: (it) => [
        { label: 'Nouvelle graine', sub: '1 image', onclick: () => redo(it, 1) },
        { label: '4 variations', sub: '4 graines', onclick: () => redo(it, 4) },
        { label: 'À l’identique', sub: 'même graine', onclick: () => redo(it, 0) },
      ],
    },
    menu: menuFor,
    link: (it) => href('image/#' + it.id),
    onLoad: () => paintAct(),   // le temps mesuré vient des rendus du fil
    empty: 'Écrivez un prompt en bas, puis « Générer ».',
  });
  // une image déposée sur le fil (fichier ou vignette) s'ouvre en grand
  dropZone($('#fil'), { kinds: ['image'], multiple: false, via: VIA, onitems: ([it]) => fil.open(it) });
}

function paintBanner() {
  $('#banner').replaceChildren(...(stub() ? [el('div', { class: 'banner' }, el('b', {}, 'Moteur factice'),
    el('span', {}, 'des mires, aucun modèle chargé — ', el('a', { href: href('admin/#cablage') }, 'Admin → Câblage')))] : []));
}

// la barre : ses dépôts, sa hauteur (le fil garde sa marge basse), ses panneaux
function wireBar() {
  const bar = $('#pbar');
  // une image, un élément déposés sur la barre : des références (en édition hors consigne : l'image à éditer)
  dropZone(bar, { kinds: ['image', 'element'], multiple: true, via: VIA, onitems: (items) => {
    if (S.mode === 'edit' && (S.edit.tool !== 'instruct' || !S.current)) {
      const img = items.find((x) => x.kind === 'image');
      if (img) setSource(img); else toast('l’image à éditer est une image, pas un élément');
      return;
    }
    addItems(items);
  } });
  const setH = () => document.documentElement.style.setProperty('--pbar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  if ('ResizeObserver' in window) new ResizeObserver(setH).observe(bar);
  setH();
  // un panneau se ferme par Échap ou un clic hors de la barre
  addEventListener('pointerdown', (e) => {
    if (!S.pop || bar.contains(e.target) || e.target.closest?.('.sr-menu, .scrim, .fv')) return;
    S.pop = null; paintPop(); paintChips();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !S.pop || document.querySelector('.sr-menu, .scrim, .fv')) return;
    S.pop = null; paintPop(); paintChips();
  });
  wireText();
}

let paintT = null;
jobs.watch((list) => { S.lastList = list; clearTimeout(paintT); paintT = setTimeout(() => fil?.paintJobs(), 60); });
// un rendu fini ailleurs (un autre onglet, une relance) : ses images arrivent aussi
document.addEventListener('sr:job', async (e) => {
  const j = e.detail;
  if (j.tool !== 'image' || S.mine.has(j.id) || S.done.has(j.id)) return;
  if (j.state !== 'error') S.done.add(j.id);
  if (j.state === 'done') {
    try { const full = await jobs.get(j.id); if (full.items?.length) fil?.add(full.items); } catch { /* parti */ }
  }
  fil?.paintJobs();
});

// un fichier lâché hors des emplacements ne doit pas faire quitter la page
addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); toast('déposez sur la barre (une référence, l’image à éditer) ou sur le fil (la voir en grand)'); } });

// ── démarrage ───────────────────────────────────────────────
// Adresses : ?edit=<id> (d'Asset, d'Idéation) met la barre en édition sur cet
// objet ; ?ref=<id> le met dans les références ; #<id> l'ouvre en grand.
async function resolveImage(id) {
  const it = await api('library/' + encodeURIComponent(id));
  if (it.kind === 'image') return it;
  // un élément : l'image d'où vient sa première référence, s'il y en a une
  const src = (it.element?.refs || []).find((r) => r.item);
  if (src) return api('library/' + src.item);
  throw new Error(`« ${it.title} » n’est pas une image`);
}

async function start() {
  try { S.cfg = await api('image/models'); } catch (e) {
    $('#pb-chips').replaceChildren(el('p', { class: 'warn' }, `le portail ne répond pas : ${e.message}`)); return;
  }
  const drafted = await loadDraft();
  const qs = new URLSearchParams(location.search);
  if (qs.get('edit')) {
    try {
      S.current = await resolveImage(qs.get('edit'));
      S.mode = 'edit'; S.edit.tool = 'instruct'; S.edit.mask = '';
    } catch (e) { toast(`édition : ${e.message}`, 7000); }
  } else if (drafted) {
    S.current = await api('library/' + drafted).catch(() => null);
  }
  if (qs.get('ref')) {
    try {
      const it = await api('library/' + encodeURIComponent(qs.get('ref')));
      S.mode = 'create';
      if (!M(S.model).refs) S.model = 'krea2';
      if (!S.refs.some((r) => r.id === it.id)) S.refs = [...S.refs, it].slice(-M(S.model).refs);
    } catch (e) { toast(`référence : ${e.message}`, 7000); }
  }
  const want = (location.hash || '').slice(1);
  if (qs.get('edit') || qs.get('ref')) { try { history.replaceState(null, '', location.pathname + (want ? '#' + want : '')); } catch { /* sans historique */ } }
  if (!S.cfg.models.some((m) => m.id === S.model)) S.model = 'krea2';
  fixQuality();
  paintBanner();
  mountFil();
  wireBar();
  paintBar();
  // à partir d'ici, chaque changement de la barre est un geste (le mode et l'onglet des looks suivent sans en faire un)
  bar = U.snapshots({ get: barState, set: barRestore, describe: barDescribe, ignore: ['mode', 'lookTab'] });
  bar.reset();
  if (want) fil.open(want);
  if (S.cfg.availability_error) toast(`machines : ${S.cfg.availability_error}`, 6000);
}
addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (id && id !== fil?.current()?.id) fil?.open(id);
});

// ── le clic droit (Cal, 29/09 : jamais le menu du navigateur) ──
// une référence de la barre : son menu (le même qu'au clic) ; une carte du
// fil a le sien (commun/fil.js) ; ailleurs, les gestes de la barre en tête du
// menu commun de repli (commun/menu.js, pageMenu)
contextMenu($('#pbar'), (e) => e.target.closest('.pb-ref')?._menu?.() || null);
pageMenu(() => {
  const go = $('#act .pb-gen');
  const why = $('#act .why')?.textContent || '';
  const E = S.edit;
  return [{ head: S.mode === 'create' ? 'Image · créer' : 'Image · éditer' },
    { label: go?.querySelector('.gl')?.textContent || (S.mode === 'create' ? 'Générer' : 'Éditer'), icon: '▶', disabled: !go || go.disabled, why: why || 'la barre n’est pas prête',
      onclick: () => (S.mode === 'create' ? generate() : editRun()) },
    '-',
    { label: 'Créer', checked: S.mode === 'create', onclick: () => setMode('create') },
    { label: 'Éditer', checked: S.mode === 'edit', onclick: () => setMode('edit') },
    S.mode === 'create' ? { label: 'Ajouter des références…', icon: '+', onclick: addRefs } : { label: S.current ? 'Changer l’image à éditer…' : 'Choisir l’image à éditer…', icon: '▭', onclick: pickSrc },
    S.mode === 'edit' && E.tool === 'instruct' && S.current ? { label: 'Peindre la zone à éditer…', icon: '✎', onclick: openPaint } : null,
    '-',
    { label: 'Le fil en plein écran', icon: '⤢', disabled: !fil?.items().length, why: 'rien dans le fil encore', onclick: () => fil.open(fil.items()[0]) }];
});

start();
