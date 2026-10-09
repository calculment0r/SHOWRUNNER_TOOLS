// Image : CRÉER des images photo avec Z-Image, Qwen-Image 2.1 et Krea 2 ;
// caméra, objectif, ouverture, pellicule et lumière en pastilles ; les
// références (images, éléments, personnages de Character Factory). Le
// serveur tient la seule vérité : modèles, tailles, pastilles et prompt
// envoyé viennent de /api/image/*.
//
// Deux modes, un passage clair (Cal, 30/09 : « le panneau Image, c'est pour
// CRÉER par défaut … l'édition est un ATELIER en soi ») : la page arrive
// toujours en Créer ; « Éditer » (le sélecteur en tête, le bouton de la
// visionneuse, le ⋯ d'une image) ouvre l'atelier (image/atelier/), l'image en
// grand, ses essais à droite. Le brouillon d'ici ne garde que la création.
//
// La page (Cal, 29/09, capture 2 de Higgsfield) : le fil en grille sur toute
// la largeur (commun/fil.js) et, en bas, la barre de prompt flottante :
//   ligne 1 — les vignettes des références (un clic : retirer, changer de
//             place ou d'image ; on y dépose), « + » ;
//   ligne 2 — le prompt, d'une à trois lignes, « @ » nomme une référence ;
//   ligne 3 — des puces : + · @ · modèle · format · taille · − n/4 + ·
//             Prise de vue · Paramètres avancés (fermés par défaut : la
//             graine, le rendu propre au modèle, le prompt envoyé ; ce qui
//             s'écarte du défaut se lit sur la puce) ; chaque puce ouvre un
//             petit menu vers le haut (commun/menu.js) ou un panneau ;
//   à droite — « Générer », le seul orange, avec le temps mesuré.
// Peu de texte d'aide (Cal, 29/09 : « calmer les messages redondants ») :
// une infobulle courte là où elle sert ; une action éteinte dit pourquoi.
// « Réutiliser » remplit la barre, graine vidée : « Générer » fait une variante.
//
// Tout emplacement qui attend une image accepte un dépôt (fichier du disque →
// bibliothèque, catégorie Upload ; ou une vignette glissée) : `dropZone` du
// socle ; toute vignette d'ici se glisse (`dragItem`).
//
// Le panneau Asset (commun/dock.js, Ctrl+Espace) : poser (double-clic, Entrée)
// fait ce que fait un dépôt sur la barre (`toBar`) ; ses filtres suivent la
// barre (`followDock`) ; un modèle sans référence le dit.
//
// L'annulation (commun/undo.js) : Ctrl+Z, Ctrl+Maj+Z — sans bouton dans la
// barre (Cal, 30/09 : « on vire le do/undo de la barre de prompt »). Les
// réglages de la barre par instantanés ; aimer, ranger, jeter depuis le fil :
// le fil les range lui-même (commun/fil.js, option undo). Ne s'annulent pas :
// un rendu lancé, un fichier déposé, un élément créé depuis le menu.
import { mountHeader, api, jobs, pick, toast, el, $, href, fmtDate, dropZone, dragItem, dock } from '../commun/shell.js';
import { menu, contextMenu, pageMenu } from '../commun/menu.js';
import { createFil } from '../commun/fil.js';
import { createUndo } from '../commun/undo.js';
import { prefs } from '../commun/prefs.js';
import { scrollBehavior } from '../commun/theme.js';
import { sortable, moveItem, isHeld, heldTitle, sentLabel } from '../commun/refs.js';
import { places } from '../commun/mentions.js';

mountHeader('image', { sub: 'créer' });

const KEY = 'sr-image-draft';
const LAST = 'sr-atelier-last';   // la dernière session de l'atelier (image/atelier/atelier.js) : « Éditer » y revient
const VIA = 'image';
const S = {
  cfg: null,
  model: 'krea2', variant: 'turbo', prompt: '', looks: {}, aspect: '3:4', quality: '', count: 2, seed: '', realism: true,
  refs: [], refChoice: {}, origSeed: null,
  lora: null, loras: null,   // le LoRA d'un moodboard {name, strength} ; la liste (GET /api/lora, `render`)
  transparent: false,
  pop: null, lookTab: 'camera',
  sent: '', notes: [],
  // la file : ce que la page a lancé (suivi un à un), ce qui est arrivé, ce qu'on a retiré
  mine: new Map(), done: new Set(), gone: new Set(), lastList: [], session: new Date().toISOString(),
};
let fil = null;

// ── l'atelier d'édition : une page à part ───────────────────
const atelierHref = (q = '') => href('image/atelier/' + q);
function openAtelier(it, extra = '') {
  fil?.close();
  location.href = atelierHref(`?item=${encodeURIComponent(it.id)}${extra}`);
}
function lastSession() { try { return localStorage.getItem(LAST) || ''; } catch { return ''; } }
function paintMode() {
  const a = $('#mode-edit');
  const sid = lastSession();
  if (a) {
    a.href = atelierHref(sid ? `?s=${encodeURIComponent(sid)}` : '');
    a.title = sid ? 'l’atelier d’édition, là où vous en étiez' : 'l’atelier d’édition : choisir une image';
  }
}

// ── l'annulation (Ctrl+Z) ───────────────────────────────────
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
// la barre, par instantanés : ce que garde le brouillon, les objets entiers
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const BAR_FR = [['model', 'changer de modèle'], ['variant', 'changer la variante de Z-Image'], ['refs', 'changer les références'],
  ['refChoice', 'changer l’image envoyée d’un élément'], ['aspect', 'changer le format'],
  ['quality', 'changer la taille'], ['realism', 'changer le rendu photo'], ['transparent', 'changer le fond'], ['looks', 'changer la prise de vue'],
  ['lora', 'changer le LoRA'],
  ['count', 'changer le nombre d’images'], ['seed', 'changer la graine'], ['origSeed', 'changer la graine d’origine'], ['prompt', 'écrire le prompt']];
const TYPED = new Set(['prompt', 'seed']);   // une saisie : un seul geste tant que le champ garde la main
let typing = 0;
function barDescribe(b, a) {
  for (const [k, label] of BAR_FR) {
    if (!same(b[k], a[k])) return { label, merge: TYPED.has(k) ? `${k}#${typing}` : k, mergeMs: TYPED.has(k) ? Infinity : undefined };
  }
  return { label: 'modifier la barre' };
}
let bar = null;   // posé au démarrage, une fois le brouillon relu (l'ouverture n'est pas un geste)
function barState() {
  const { model, variant, prompt, looks, aspect, quality, count, seed, realism, transparent, refChoice, origSeed, lookTab, lora } = S;
  return { model, variant, prompt, looks, aspect, quality, count, seed, realism, transparent, refChoice, origSeed, lookTab, lora, refs: S.refs };
}
function barRestore(s) {
  const { refs, ...rest } = s;
  Object.assign(S, rest);
  S.refs = refs || [];
  S.pop = null;
  saveDraft(); paintBar();
}

// ── le brouillon : une commodité de ce navigateur ───────────
function saveDraft() {
  try {
    const { model, variant, prompt, looks, aspect, quality, count, seed, realism, transparent, refChoice, origSeed, lookTab, lora } = S;
    localStorage.setItem(KEY, JSON.stringify({ model, variant, prompt, looks, aspect, quality, count, seed, realism, transparent, refChoice, origSeed, lookTab, lora,
      refs: S.refs.map((r) => r.id) }));
  } catch { /* stockage fermé : rien à garder */ }
  bar?.commit();   // chaque changement de la barre passe ici : un geste qu'on annule
}
// un brouillon d'avant (qui gardait une édition) : seule sa part création est relue
async function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { d = null; }
  if (!d) {
    // un brouillon neuf : les préférences de la personne (image/prefs.json)
    S.model = prefs.get('image.model', S.model);
    S.count = prefs.get('image.count', S.count);
    return;
  }
  for (const k of ['model', 'variant', 'prompt', 'looks', 'aspect', 'quality', 'count', 'seed', 'realism', 'transparent', 'refChoice', 'origSeed', 'lookTab', 'lora']) {
    if (d[k] !== undefined && d[k] !== null) S[k] = d[k];
  }
  S.refs = (await Promise.all((d.refs || []).map((id) => api('library/' + id).catch(() => null)))).filter(Boolean);
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
  // aucune machine ne répond : ce n'est pas un modèle absent (le dire juste)
  const down = Object.values(a.missing).every((v) => v.some((x) => String(x).startsWith('ne répond')));
  return a.on.length ? { ok: true, on: a.on } : { ok: false, why, head: down ? 'machine injoignable' : 'modèle absent' };
}
function capCreate() {
  if (S.model === 'zimage') return 'zimage:' + S.variant;
  if (S.model === 'krea2' && S.refs.length) return 'krea2:edit';   // Krea 2 prend au moins une place
  return S.model;
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
  const body = { mode: 'generate', model: S.model, prompt: S.prompt, looks: S.looks, refs: refsParam(S.refs), transparent: S.model === 'qwen21' && S.transparent,
    variant: S.variant, lora: loraFit().sent };
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
  n.hidden = !S.notes.length;
  n.textContent = S.notes.join(' · ');
  n.title = S.notes.join('\n');
}

// ── la barre ────────────────────────────────────────────────
function paintBar() {
  fixQuality();
  paintRefs();
  paintText();
  paintChips();
  paintPop();
  paintAct();
  paintNote();
  schedCompose();
  followDock();
}

// ligne 1 : les références. La règle commune (commun/refs.js) : un carrousel
// ordonné ; l'adresse d'une référence est sa place ; le modèle envoie les N
// premières, les suivantes restent grisées ; changer de modèle n'en retire
// aucune ; on les réordonne en les glissant. L'adresse s'écrit comme partout
// (09/10, commun/mentions.js) : @image1, @element1, chaque sorte comptée à part ;
// le serveur la compile pour le modèle (roleOf : ce que le modèle lit).
function roleOf(model, k, n) {
  if (model === 'qwen21') return `<image${1 + k}>`;
  return n > 1 ? (k === 0 ? 'la scène' : 'le sujet') : 'la personne ou l’objet';
}
const tokOf = (list, k) => `@${places(list.map((it) => (it.kind === 'element' ? 'element' : 'image')))[k]}`;
const swap = (list, k) => moveItem(list, k, k - 1);
// le carrousel prend ce que prend le plus grand des modèles
const CAP = () => Math.max(...S.cfg.models.map((m) => m.refs));
// `max` : ce que le modèle choisi envoie ; `sent` : combien partent
function refsOf() {
  const R = { list: S.refs, max: M(S.model).refs, model: S.model, set: (l) => { S.refs = l.slice(0, CAP()); afterRefs(); } };
  R.sent = Math.min(R.list.length, Math.max(0, R.max));
  return R;
}
function afterRefs() { saveDraft(); schedCompose(); paintRefs(); paintChips(); paintAct(); }
function refMenu(it, k, R) {
  const els = it.kind === 'element' ? (it.element?.refs || []) : [];
  const cur = S.refChoice[it.id] || els[0]?.file;
  const place = (j) => (isHeld(j, R.max) ? `${tokOf(R.list, j)} · non envoyée` : `${tokOf(R.list, j)} · ${roleOf(R.model, j, R.sent)}`);
  return [
    { head: `${place(k)} · ${it.title || it.id}` },
    isHeld(k, R.max) ? { head: maxWhy(R) } : null,
    k > 0 ? { label: 'Passer avant', sub: place(k - 1), onclick: () => R.set(swap(R.list, k)) } : null,
    k < R.list.length - 1 ? { label: 'Passer après', sub: place(k + 1), onclick: () => R.set(swap(R.list, k + 1)) } : null,
    els.length ? '-' : null,
    els.length ? { head: 'l’image de l’élément envoyée' } : null,
    ...els.map((r) => ({ label: r.label || r.role || r.file, sub: r.role || '', checked: cur === r.file,
      onclick: () => { S.refChoice[it.id] = r.file; saveDraft(); schedCompose(); paintRefs(); } })),
    '-',
    { label: 'Voir en grand', onclick: () => fil.open(it) },
    it.kind === 'image' ? { label: 'Éditer cette image', sub: 'l’atelier', onclick: () => openAtelier(it) } : null,
    { label: 'Retirer', icon: '×', danger: true, onclick: () => R.set(R.list.filter((_, i) => i !== k)) },
  ];
}
function refThumb(it, k, R) {
  const t = it.kind === 'element' ? (it.element?.refs?.find((r) => r.file === S.refChoice[it.id])?.thumb_url || it.thumb_url) : (it.thumb_url || it.url);
  // au-delà de ce que prend le modèle : grisée, gardée, non envoyée (sa place reste son numéro)
  const held = isHeld(k, R.max);
  const role = held ? tokOf(R.list, k) : `${tokOf(R.list, k)} · ${roleOf(R.model, k, R.sent)}`;
  const b = el('button', { class: 'pb-ref r' + (it.kind === 'element' ? ' element' : '') + (held ? ' held' : ''), type: 'button', 'data-k': k,
    title: held ? `${heldTitle(maxWhy(R))} · ${it.title || ''}` : `${role} · ${it.title || ''} — glisser pour changer sa place`,
    style: t ? { backgroundImage: `url(${href(t)})` } : null,
    onclick: (e) => up(e.currentTarget, refMenu(it, k, R)) },
  el('span', { class: 'n' }, tokOf(R.list, k)));
  // déposer sur une vignette la remplace, à la même place
  dropZone(b, { kinds: ['image', 'element'], multiple: false, via: VIA, onitems: ([x]) => { const l = R.list.slice(); l[k] = x; R.set(l); } });
  b._menu = () => refMenu(it, k, R);   // le même menu au clic droit
  return b;
}
// pourquoi on ne peut plus ajouter : la limite du modèle, dite par le serveur
function maxWhy(R) {
  const m = M(R.model);
  if (!R.max) return m.refs_why || `${m.name} ne prend pas de référence`;
  return m.refs_max_why || `${m.name} : ${plural(R.max, 'référence')} au plus`;
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
  const R = refsOf();
  const m = M(S.model);
  const kids = R.list.map((it, k) => refThumb(it, k, R));
  if (m.refs && R.list.length < m.refs) {
    kids.push(el('button', { class: 'pb-ref add', type: 'button', title: `ajouter une référence (${R.list.length}/${m.refs})`, onclick: addRefs }, '+'));
  }
  $('#pb-refs').replaceChildren(...kids);
}

// ligne 2 : le prompt (d'une à trois lignes) ; « @ » nomme une référence
function paintText() {
  const ta = $('#prompt');
  if (ta.value !== S.prompt) ta.value = S.prompt || '';
  ta.placeholder = promptHint();
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
  if (M(S.model)?.refs) return 'Décrivez l’image, en anglais — @ nomme une référence (@image1, @element1)';
  return 'Décrivez l’image, en anglais : le sujet, le lieu, la lumière';
}
const AT = { list: [], sel: 0, q: null };
function atChoices() {
  const R = refsOf();
  if (!R.max) return { why: M(R.model).refs_why || `${M(R.model).name} ne prend pas de référence` };
  // les places envoyées seulement : une grisée n'est pas envoyée (le serveur refuse sa mention, et le dit) ;
  // le jeton est celui de la personne (@image1, @element1), le titre dit ce que le modèle lit à cette place
  const toks = R.list.slice(0, R.sent);
  if (!toks.length) return { why: 'aucune référence : ajoutez-en par « + »' };
  return { toks: toks.map((it, k) => ({ tag: tokOf(R.list, k), title: `${roleOf(R.model, k, R.sent)} · ${it.title || ''}`,
    thumb: it.thumb_url || it.url })) };
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
    S.prompt = ta.value;
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
function modelItems(ids, current, onpick) {
  return [{ head: 'Modèle' }, ...ids.map((id) => {
    const it = M(id);
    return { label: it.name, dot: DOT[id], sub: it.refs ? `${it.refs} réf.` : 'texte seul', checked: current === id, title: it.role, onclick: () => onpick(id) };
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
// ── le LoRA d'un moodboard (server/tools/lora.py) : pour le modèle qui l'a produit, avec sa force ──
// (la même règle que la carte Générer d'Idéation, ideation/gen.js : changer de modèle ne le retire
// pas, il ne part pas et la puce dit pourquoi)
let lorasAsked = 0;
function loadLoras(force = false) {
  if (Date.now() - lorasAsked < (force ? 15000 : 60000)) return;
  lorasAsked = Date.now();
  api('lora').then((r) => { S.loras = { list: r.render || [], names: r.names || {}, max: r.strength_max || 1.5, why: r.why || '' }; })
    .catch((e) => { S.loras = { list: [], names: {}, max: 1.5, why: e.message }; })
    .finally(() => { if (S.cfg) { paintChips(); paintPop(); } });
}
const loraTitle = (x) => `${x.title}${x.v ? ` · v${x.v}` : ''}`;
const fmtF = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
function loraFit() {
  const name = S.lora?.name;
  if (!name) return { sent: null, why: '' };
  const x = (S.loras?.list || []).find((l) => l.name === name);
  const lm = x?.model || (/^showrunner\/(zimage|qwen21|krea2|h3|ace)-/.exec(name) || [])[1] || '';
  const nm = (id) => S.loras?.names?.[id] || M(id)?.name || id;
  if (lm !== S.model) return { sent: null, why: `entraîné pour ${nm(lm)} : pas envoyé à ${nm(S.model)}`, x };
  if (S.model === 'zimage' && S.variant !== 'turbo') return { sent: null, why: 'entraîné sur Z-Image Turbo : pas envoyé avec Base', x };
  const st = Number(S.lora.strength);
  return { sent: { name, strength: Number.isFinite(st) ? st : 1 }, why: '', x };
}
function loraChip() {
  const mine = (S.loras?.list || []).filter((l) => l.model === S.model);
  const f = loraFit();
  const setL = (v) => { S.lora = v; saveDraft(); paintChips(); paintPop(); schedCompose(); };
  const off = !S.loras ? 'lecture des LoRA…' : !mine.length && !S.lora ? `aucun LoRA ${M(S.model).name} : un moodboard d’Idéation en fait un (clic droit → « Entraîner le LoRA… »)` : '';
  const value = S.lora ? (f.why ? 'ne part pas' : `${f.x ? loraTitle(f.x) : S.lora.name.split('/').pop()} · ${fmtF(f.sent.strength)}`) : '';
  return chip('LoRA', { value, cls: S.lora && !f.why ? 'set' : '', off, title: f.why || (f.x?.trigger ? `mot déclencheur « ${f.x.trigger} », mis en tête du prompt` : 'le style d’un moodboard, appris pour ce modèle'),
    onclick: (a) => { loadLoras(true); up(a, [{ head: `LoRA · ${M(S.model).name}` },
      { label: 'Sans LoRA', checked: !S.lora, onclick: () => setL(null) },
      ...mine.map((x) => ({ label: loraTitle(x), checked: S.lora?.name === x.name,
        sub: x.machines && !x.machines.length ? 'absent de ComfyUI' : x.trigger || '',
        title: x.trigger ? `mot déclencheur « ${x.trigger} »` : 'pas de mot déclencheur connu',
        onclick: () => setL({ name: x.name, strength: S.lora?.strength ?? 1 }) })),
      ...(f.why ? [{ label: f.why, disabled: true, why: f.why }] : [])]); } });
}
function loraForce() {
  const max = S.loras?.max || 1.5;
  const inp = el('input', { class: 'fld seed', inputmode: 'decimal', value: fmtF(S.lora.strength ?? 1), 'aria-label': 'force du LoRA',
    title: `de 0 à ${fmtF(max)} (1 : celle de l’essai à l’installation)`,
    onchange: (e) => {
      const v = parseFloat(e.target.value.replace(',', '.'));
      const st = Number.isFinite(v) ? Math.round(Math.max(0, Math.min(max, v)) * 100) / 100 : 1;
      e.target.value = fmtF(st);
      S.lora = { ...S.lora, strength: st }; saveDraft(); paintChips(); schedCompose();
    } });
  return el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Force du LoRA'), inp, el('span', { class: 'hint' }, `0 à ${fmtF(max)}`));
}
// la puce des paramètres avancés : fermée par défaut ; ce qui s'écarte du défaut s'y lit
function advChip() {
  const alt = [S.seed ? `graine ${S.seed}` : '', renderOf(M(S.model)).alt].filter(Boolean);
  return chip('Paramètres avancés', { value: alt.join(' · '), cls: 'adv' + (alt.length ? ' set' : ''), open: S.pop === 'adv', onclick: () => togglePop('adv') });
}
function paintChips() {
  const box = $('#pb-chips');
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
      S.model = id;   // aucune référence retirée : celles de trop se grisent (commun/refs.js)
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
    loraChip(),
    advChip());
}

// ── les panneaux au-dessus de la barre ──────────────────────
function togglePop(id) { S.pop = S.pop === id ? null : id; paintPop(); paintChips(); }
// le sigle posé sur la vignette dessinée (image.css) d'une caméra ou d'un objectif
const ABBR = {
  camera: { fullframe: 'FF', mediumformat: 'MF', leica: 'M6', alexa: 'S35', imax: '70', '16mm': '16', digicam: 'DC', disposable: 'FL', phone: 'PH' },
  lens: { 14: '14', 24: '24', 35: '35', 50: '50', 85: '85', 135: '135', macro: '1:1', anamorphic: '2.39', swirl: 'PTZ', vintage: 'K35' },
};
function swatches(g, looks) {
  return el('div', { class: 'looks' }, ...g.items.map((x) => {
    const said = S.model === 'krea2' && x.krea ? x.krea : x.prose;
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
  if (S.pop === 'looks') {
    const looks = S.looks;
    const groups = S.cfg.looks;
    const g = groups.find((x) => x.id === S.lookTab) || groups[0];
    const chosen = groups.map((x) => x.items.find((i) => i.id === looks[x.id])?.name).filter(Boolean);
    kids = [head('Prise de vue', el('span', { class: 'lbl pp-sum' }, chosen.join(' · ') || 'aucune'),
      el('button', { class: 'tb ghost sm', type: 'button', disabled: chosen.length ? null : true, title: 'tout retirer',
        onclick: () => { for (const x of groups) looks[x.id] = null; saveDraft(); schedCompose(); paintPop(); paintChips(); } }, 'aucune')),
    el('div', { class: 'pp-tabs', role: 'tablist' }, ...groups.map((x) => {
      const cur = x.items.find((i) => i.id === looks[x.id]);
      return el('button', { class: 'pp-tab' + (x.id === g.id ? ' on' : ''), type: 'button', role: 'tab',
        onclick: () => { S.lookTab = x.id; saveDraft(); paintPop(); } }, el('span', {}, x.label), el('small', {}, cur ? cur.name : '—'));
    })),
    el('div', { class: 'pp-body' }, swatches(g, looks))];
  } else if (S.pop === 'adv') {
    const seed = el('input', { class: 'fld seed', id: 'seed', inputmode: 'numeric', placeholder: 'au hasard', value: S.seed,
      title: 'la même graine et la même recette refont la même image',
      oninput: (e) => { S.seed = e.target.value.replace(/\D/g, ''); e.target.value = S.seed; saveDraft(); paintChips(); } });
    // une rangée : un intitulé, des boutons à choix unique
    const opts = (label, list) => el('div', { class: 'row' }, el('span', { class: 'lbl' }, label), el('div', { class: 'opts' }, ...list.map((x) => el('button', {
      class: 'opt' + (x.on ? ' on' : ''), type: 'button', title: x.off || x.title || null, disabled: x.off ? true : null, onclick: x.onclick }, x.label))));
    const rd = renderOf(M(S.model));
    kids = [head('Paramètres avancés'),
      el('div', { class: 'pp-body' },
        el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Graine'), seed,
          el('button', { class: 'tb ghost sm', type: 'button', title: 'une graine au hasard', onclick: () => { S.seed = String(Math.floor(Math.random() * 1e9)); seed.value = S.seed; saveDraft(); paintChips(); } }, 'dé'),
          S.seed ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { S.seed = ''; saveDraft(); paintChips(); paintPop(); } }, 'auto') : null,
          S.origSeed != null ? el('button', { class: 'tb ghost sm', type: 'button', title: `la graine de l’image réutilisée : ${S.origSeed}`,
            onclick: () => { S.seed = String(S.origSeed); seed.value = S.seed; saveDraft(); paintChips(); } }, 'd’origine') : null),
        opts(rd.label, rd.opts),
        S.lora ? loraForce() : null,
        el('details', { class: 'pp-acc', open: S.sentOpen ? true : null, ontoggle: (e) => { S.sentOpen = e.currentTarget.open; } },
          el('summary', { class: 'lbl' }, 'Le prompt envoyé'), el('pre', { class: 'sent', id: 'sent' }, S.sent || '—')))];
  }
  box.hidden = false;
  box.replaceChildren(...kids.filter(Boolean));
  const b = box.querySelector('.pp-body');
  if (b) b.scrollTop = keep;
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
  const m = M(S.model);
  const a = avail(capCreate());
  const why = !S.prompt.trim() ? 'écrivez un prompt' : !a.ok ? `${a.head} — ${a.why}` : '';
  const wh = m.sizes[S.quality]?.[S.aspect];
  const info = `${m.name} · ${wh ? wh.join(' × ') : ''}${a.on?.length ? ' · ' + a.on.join(' + ') : ''}`;
  const est = measured(S.model, 'image.generate');
  // combien de références partent, quand toutes ne partent pas (commun/refs.js)
  const R = refsOf();
  const sent = sentLabel(R.list.length, R.max);
  // replaceChildren(null) écrirait « null » : on ne passe que des nœuds
  box.replaceChildren(...[
    el('button', { class: 'tb go pb-gen', type: 'button', disabled: why ? true : null,
      title: `${info}\n${est.long}${sent ? `\nréférences : ${sent} — ${maxWhy(R)}` : ''}`.trim(), onclick: generate },
    el('span', { class: 'gl' }, 'Générer'), el('small', {}, `${S.count > 1 ? `${S.count} × ` : ''}${est.short}`),
    sent ? el('small', { class: 'sent' }, sent) : null),
    why ? el('p', { class: 'why' }, why) : null].filter(Boolean));
}

// ── lancer ──────────────────────────────────────────────────
async function generate() {
  const body = { model: S.model, variant: S.variant, prompt: S.prompt, looks: S.looks, aspect: S.aspect, quality: S.quality,
    count: S.count, realism: S.realism, transparent: S.model === 'qwen21' && S.transparent, refs: refsParam(S.refs) };
  if (S.seed) body.seed = Number(S.seed);
  const lo = loraFit().sent;
  if (lo) body.lora = lo;
  await launch('image/generate', body);
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
// (les essais de l'atelier ne sont pas du fil : ils vivent dans leur session)
const LIVE = ['queued', 'running'];
const RANK = { queued: 0, running: 1, done: 2, error: 2, cancelled: 2, interrupted: 2 };
const ofFil = (j) => j.tool === 'image' && j.kind !== 'image.atelier';
function liveJobs() {
  const byId = new Map();
  for (const j of S.lastList) if (ofFil(j)) byId.set(j.id, j);
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
const EDITED = ['image.edit', 'image.atelier'];
const hasRecipe = (it) => ['image.generate', 'image.edit'].includes(it.params?.job);
const noRecipe = (it) => (hasRecipe(it) ? ''
  : it.params?.job === 'image.atelier' ? 'édition en plusieurs essais : « Éditer » rouvre son atelier, avec l’historique'
    : 'image sans recette de l’outil Image : déposée, ou faite ailleurs');
function details(it) {
  const p = it.params || {};
  const m = S.cfg.models.find((x) => x.id === p.model);
  return [
    ['modèle', it.origin?.model || it.origin?.tool || ''],
    ['outil', p.job === 'image.edit' ? TOOL_FR[p.tool] || p.tool : p.job === 'image.atelier' ? `atelier · ${plural((p.steps || []).length, 'essai')} enchaînés`
      : p.job === 'image.generate' ? 'créer' : ''],
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
  if (p.job === 'image.atelier' && p.steps?.length) {
    out.push(el('section', { class: 'fv-sec' }, el('span', { class: 'lbl' }, 'Les essais enchaînés'),
      el('ol', { class: 'fv-steps' }, ...p.steps.map((x) => el('li', {}, x.prompt || TOOL_FR[x.tool] || x.tool)))));
  }
  if (it.prompt && it.prompt !== p.prompt) {
    out.push(el('section', { class: 'fv-sec' }, el('details', {}, el('summary', { class: 'lbl' }, 'Prompt envoyé au modèle'), el('pre', {}, it.prompt))));
  }
  return out;
}
// « Avant / après » : l'image éditée contre sa source ; une autre image déposée
// sur le cadre prend la place de « avant »
function viewerTools(it, v) {
  const pid = it.parents?.[0];
  if (!pid || !EDITED.includes(it.params?.job)) return [];
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
  // une édition : son atelier, sa consigne reprise (la source, l'outil, la zone)
  if (p.job === 'image.edit') {
    if (!p.source) { toast('cette édition n’a plus de source', 6000); return; }
    location.href = atelierHref(`?item=${encodeURIComponent(p.source)}&reuse=${encodeURIComponent(it.id)}`);
    return;
  }
  Object.assign(S, { model: M(p.model) ? p.model : S.model, prompt: p.prompt || '', looks: { ...(p.looks || {}) }, aspect: p.aspect || S.aspect,
    quality: p.quality || S.quality, variant: p.variant || S.variant, realism: p.realism ?? S.realism, transparent: !!p.transparent,
    seed: '', origSeed: p.seed ?? null, pop: null, lora: p.lora ? { name: p.lora.name, strength: p.lora.strength } : null });
  // le carrousel entier, dans son ordre : les places envoyées, puis celles restées grisées
  const all = [...(p.refs || []), ...(p.refs_held || [])];
  S.refs = (await Promise.all(all.map((r) => api('library/' + r.item).catch(() => null)))).filter(Boolean);
  for (const r of all) if (r.ref) S.refChoice[r.item] = r.ref;
  const lost = all.length - S.refs.length;
  bar?.label(`réutiliser les réglages de « ${it.title || it.id} »`);
  fixQuality(); saveDraft(); paintBar();
  $('#prompt').focus();
  toast(`réglages repris, graine vidée${lost ? ` · ${plural(lost, 'référence partie', 'références parties')} de la bibliothèque` : ''}`, 5000);
}
async function redo(it, n) { await launch('image/redo', { item: it.id, variations: n }); }
// une référence de plus, à la suite du carrousel ; jamais au prix d'une autre (commun/refs.js)
function pushRef(it) {
  if (!M(S.model).refs) S.model = 'krea2';
  if (S.refs.some((r) => r.id === it.id)) return true;
  if (S.refs.length >= M(S.model).refs) { toast(maxWhy({ model: S.model, max: M(S.model).refs }), 5000); return false; }
  S.refs = [...S.refs, it];
  return true;
}
function useAsRef(it) {
  if (!pushRef(it)) { saveDraft(); paintBar(); return; }
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
function menuFor(it) {
  const id = it.id;
  return [
    { label: 'Éditer', icon: '✎', sub: 'l’atelier', title: 'l’atelier d’édition sur cette image (ses essais, s’il y en a)', onclick: () => openAtelier(it) },
    { label: 'Animer', icon: '▶', sub: 'vidéo', title: 'cette image en première image d’un plan (outil Vidéo)', onclick: go(`movie/?start=${id}`) },
    { label: 'Prendre en référence', icon: '+', items: [
      { label: 'dans la barre', onclick: () => useAsRef(it) },
      { label: 'dans Vidéo', sub: '@image', onclick: go(`movie/?ref=${id}`) },
    ] },
    { label: 'Agrandir dans Upscale', icon: '⇱', onclick: go(`upscale/?src=${id}`) },
    { label: 'Envoyer au Montage', icon: '▤', studio: true, onclick: go(`montage/?add=${id}`) },   // retiré sans le Studio (commun/menu.js)
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
    // « Éditer » ouvre l'atelier sur cette image, directement (Cal, 30/09 : pas de menu)
    viewerActions: (it) => [
      it.kind === 'image' ? el('button', { class: 'tb ghost', type: 'button', title: 'l’atelier d’édition sur cette image (ses essais, s’il y en a)',
        onclick: () => openAtelier(it) }, 'Éditer') : null,
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
  dropZone($('#fil'), { kinds: ['image'], multiple: false, via: VIA, label: 'le fil', onitems: ([it]) => fil.open(it) });
}

function paintBanner() {
  $('#banner').replaceChildren(...(stub() ? [el('div', { class: 'banner' }, el('b', {}, 'Moteur factice'),
    el('span', {}, 'des mires, aucun modèle chargé — ', el('a', { href: href('admin/#cablage') }, 'Admin → Câblage')))] : []));
}

// la barre : ses dépôts, sa hauteur (le fil garde sa marge basse), ses panneaux
function wireBar() {
  const box = $('#pbar');
  // une image, un élément déposés sur la barre : des références
  dropZone(box, { kinds: ['image', 'element'], multiple: true, via: VIA, label: 'la barre', onitems: toBar });
  // le carrousel se réordonne en glissant : la référence prend l'adresse de sa nouvelle place
  sortable($('#pb-refs'), { item: '.pb-ref.r', onmove: (a, b) => {
    const R = refsOf();
    R.set(moveItem(R.list, a, b));
  } });
  const setH = () => document.documentElement.style.setProperty('--pbar-h', `${Math.ceil(box.getBoundingClientRect().height)}px`);
  if ('ResizeObserver' in window) new ResizeObserver(setH).observe(box);
  setH();
  // un panneau se ferme par Échap ou un clic hors de la barre
  addEventListener('pointerdown', (e) => {
    if (!S.pop || box.contains(e.target) || e.target.closest?.('.sr-menu, .scrim, .fv')) return;
    S.pop = null; paintPop(); paintChips();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !S.pop || document.querySelector('.sr-menu, .scrim, .fv')) return;
    S.pop = null; paintPop(); paintChips();
  });
  wireText();
}

// ce que la barre prend : un dépôt sur elle, ou « poser » depuis le panneau Asset.
// Faux si rien n'a changé (le panneau ne le compte alors pas dans les Récents).
function toBar(items) {
  const n = refsOf().list.length;
  addItems(items);
  return refsOf().list.length > n;
}

// ── le panneau Asset (commun/dock.js) ───────────────────────
// ses filtres suivent la barre ; un modèle qui ne prend pas de référence le dit
function followDock() {
  if (!S.cfg) return;
  const R = refsOf();
  dock.contexte(R.max > 0 ? { kinds: ['image', 'element'], label: 'les références' } : { kinds: [], label: 'les références', why: maxWhy(R) });
}
function wireDock() {
  dock.configure({
    label: 'la barre',
    placeLabel: 'Poser dans la barre',
    hint: 'double-clic : dans la barre · glisser : sur la barre, ou sur le fil',
    place: (items) => toBar(items),
    menu: (it, chosen) => {
      const img = chosen.length === 1 && it.kind === 'image' ? it : null;
      return [
        img ? { label: 'Éditer cette image', sub: 'l’atelier', onclick: () => openAtelier(img) } : null,
        img ? { label: 'Voir en grand', icon: '⤢', onclick: () => fil.open(img) } : null,
      ];
    },
  });
  followDock();
}

let paintT = null;
jobs.watch((list) => { S.lastList = list; clearTimeout(paintT); paintT = setTimeout(() => fil?.paintJobs(), 60); });
// un rendu fini ailleurs (un autre onglet, une relance) : ses images arrivent aussi
document.addEventListener('sr:job', async (e) => {
  const j = e.detail;
  if (!ofFil(j) || S.mine.has(j.id) || S.done.has(j.id)) return;
  if (j.state !== 'error') S.done.add(j.id);
  if (j.state === 'done') {
    try { const full = await jobs.get(j.id); if (full.items?.length) fil?.add(full.items); } catch { /* parti */ }
  }
  fil?.paintJobs();
});

// un fichier lâché hors des emplacements ne doit pas faire quitter la page
addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); toast('déposez sur la barre (une référence) ou sur le fil (la voir en grand)'); } });

// ── démarrage ───────────────────────────────────────────────
// Adresses : ?edit=<id> (d'Asset, d'Idéation) ouvre l'atelier sur cet objet ;
// ?ref=<id> le met dans les références ; #<id> l'ouvre en grand.
async function start() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('edit')) { location.replace(atelierHref(`?item=${encodeURIComponent(qs.get('edit'))}`)); return; }
  paintMode();
  try { S.cfg = await api('image/models'); } catch (e) {
    $('#pb-chips').replaceChildren(el('p', { class: 'warn' }, `le portail ne répond pas : ${e.message}`)); return;
  }
  await loadDraft();
  loadLoras();
  if (qs.get('ref')) {
    try {
      const it = await api('library/' + encodeURIComponent(qs.get('ref')));
      pushRef(it);
    } catch (e) { toast(`référence : ${e.message}`, 7000); }
  }
  const want = (location.hash || '').slice(1);
  if (qs.get('ref')) { try { history.replaceState(null, '', location.pathname + (want ? '#' + want : '')); } catch { /* sans historique */ } }
  if (!S.cfg.models.some((m) => m.id === S.model)) S.model = 'krea2';
  fixQuality();
  paintBanner();
  mountFil();
  wireBar();
  wireDock();
  paintBar();
  // à partir d'ici, chaque changement de la barre est un geste (l'onglet des looks suit sans en faire un)
  bar = U.snapshots({ get: barState, set: barRestore, describe: barDescribe, ignore: ['lookTab'] });
  bar.reset();
  if (want) fil.open(want);
  if (S.cfg.availability_error) toast(`machines : ${S.cfg.availability_error}`, 6000);
}
addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (id && id !== fil?.current()?.id) fil?.open(id);
});
// l'onglet revient (l'atelier ouvert ailleurs) : « Éditer » y mène
addEventListener('pageshow', paintMode);

// ── le clic droit (Cal, 29/09 : jamais le menu du navigateur) ──
// une référence de la barre : son menu (le même qu'au clic) ; une carte du
// fil a le sien (commun/fil.js) ; ailleurs, les gestes de la barre en tête du
// menu commun de repli (commun/menu.js, pageMenu)
contextMenu($('#pbar'), (e) => e.target.closest('.pb-ref')?._menu?.() || null);
pageMenu(() => {
  const btn = $('#act .pb-gen');
  const why = $('#act .why')?.textContent || '';
  return [{ head: 'Image · créer' },
    { label: 'Générer', icon: '▶', disabled: !btn || btn.disabled, why: why || 'la barre n’est pas prête', onclick: () => generate() },
    '-',
    { label: 'Ajouter des références…', icon: '+', onclick: addRefs },
    { label: 'Éditer une image…', icon: '✎', sub: 'l’atelier', onclick: () => { location.href = $('#mode-edit')?.href || atelierHref(); } },
    '-',
    { label: 'Le fil en plein écran', icon: '⤢', disabled: !fil?.items().length, why: 'rien dans le fil encore', onclick: () => fil.open(fil.items()[0]) }];
});

start();
