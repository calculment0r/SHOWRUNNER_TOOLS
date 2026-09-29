// Image : créer et éditer des images photo avec Z-Image, Qwen-Image 2.1
// et Krea 2 ; caméra, objectif, ouverture, pellicule et lumière en
// pastilles ; les références (images, éléments, personnages de Character
// Factory) ; les outils d'édition, dont la zone peinte. Le serveur tient la
// seule vérité : modèles, tailles, pastilles et prompt envoyé viennent de
// /api/image/*.
//
// La colonne de droite est la file et l'historique vivants : une demande
// envoyée y paraît aussitôt (sa place dans la file, sa progression,
// « Arrêter »), ses images s'y posent en arrivant, groupées par demande
// (`params.batch`). Un clic montre une image au centre sans rien arrêter.
// Tout emplacement qui attend une image accepte un dépôt (fichier du disque →
// bibliothèque, catégorie Upload ; ou une vignette glissée) : `dropZone` du
// socle ; toute vignette d'ici se glisse (`dragItem`).
import { mountHeader, api, jobs, pick, refBoard, toast, el, $, href, fmtDate, dropZone, dragItem } from '../commun/shell.js';

mountHeader('image', { sub: 'créer · éditer' });

const KEY = 'sr-image-draft';
const VIA = 'image';
const S = {
  cfg: null,
  mode: 'create',
  model: 'krea2', variant: 'turbo', prompt: '', looks: {}, aspect: '3:4', quality: '', count: 2, seed: '', realism: true,
  refs: [], refChoice: {},
  edit: { tool: 'instruct', model: 'krea2', prompt: '', keepFace: true, factor: 2, denoise: 0.25,
    azimuth: '', elevation: '', distance: '', count: 1, seed: '', looks: {}, refs: [] },
  transparent: false,
  current: null, parent: null, compare: false, open: {}, mine: new Map(),
  sent: '', notes: [],
  paint: { on: false, size: 48, canvas: null, for: null, dirty: false },
  // la colonne : les images de l'outil, le filtre, ce qui vient d'arriver
  items: [], total: 0, hist: 'all', fresh: new Set(), done: new Set(), cells: new Map(), autoShow: new Set(),
  session: sessionStart(),
};

// le début de cette session : le premier chargement de la page dans cet onglet
function sessionStart() {
  try {
    let s = sessionStorage.getItem('sr-image-session');
    if (!s) { s = new Date().toISOString(); sessionStorage.setItem('sr-image-session', s); }
    return s;
  } catch { return new Date().toISOString(); }
}

// ── le brouillon : une commodité de ce navigateur ───────────
function saveDraft() {
  try {
    const { model, variant, prompt, looks, aspect, quality, count, seed, realism, transparent, refChoice, open } = S;
    const edit = { ...S.edit, refs: S.edit.refs.map((r) => r.id) };
    localStorage.setItem(KEY, JSON.stringify({ model, variant, prompt, looks, aspect, quality, count, seed, realism, transparent, refChoice, open,
      refs: S.refs.map((r) => r.id), edit, mode: S.mode, current: S.current?.id, hist: S.hist }));
  } catch { /* stockage fermé : rien à garder */ }
}
async function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { d = null; }
  if (!d) return null;
  for (const k of ['model', 'variant', 'prompt', 'looks', 'aspect', 'quality', 'count', 'seed', 'realism', 'transparent', 'refChoice', 'open', 'hist']) {
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
const fmtS = (s) => (s == null ? '' : s < 60 ? `${Math.round(s * 10) / 10} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}`);

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

function pan(label, right, ...kids) {
  return el('section', { class: 'ipan' },
    el('div', { class: 'ipan-h' }, el('span', { class: 'lbl' }, label), right ? el('span', { class: 'r' }, right) : null), ...kids);
}
// un groupe repliable : l'en-tête dit ce qui est choisi
function fold(id, label, value, ...kids) {
  const d = el('details', { class: 'ipan fold', open: S.open[id] ? true : null },
    el('summary', { class: 'ipan-h' }, el('span', { class: 'lbl' }, label), el('span', { class: 'r' + (value ? ' set' : '') }, value || '—')),
    ...kids);
  d.addEventListener('toggle', () => { S.open[id] = d.open; saveDraft(); });
  return d;
}

// ── le prompt envoyé : demandé au serveur ───────────────────
let composeT = null;
function schedCompose() { clearTimeout(composeT); composeT = setTimeout(doCompose, 220); }
async function doCompose() {
  if (S.mode === 'edit' && S.edit.tool !== 'instruct') return;
  const body = S.mode === 'create'
    ? { mode: 'generate', model: S.model, prompt: S.prompt, looks: S.looks, refs: refsParam(S.refs), transparent: S.model === 'qwen21' && S.transparent }
    : { mode: 'edit', model: S.edit.model, prompt: S.edit.prompt, looks: S.edit.looks, refs: refsParam(S.edit.refs), keep_face: S.edit.keepFace };
  try {
    const r = await api('image/compose', { method: 'POST', body });
    S.sent = r.prompt; S.notes = r.notes || [];
  } catch (e) { S.sent = ''; S.notes = [e.message]; }
  const box = $('#sent');
  if (box) paintSent(box);
  const cnt = $('#sent-n');
  if (cnt) cnt.textContent = S.notes.length ? plural(S.notes.length, 'note') : `${S.sent.split(/\s+/).filter(Boolean).length} mots`;
}
function paintSent(box) {
  box.replaceChildren(el('pre', { class: 'sent' }, S.sent || '—'), ...S.notes.map((n) => el('p', { class: 'reason' }, n)));
}
const refsParam = (list) => list.map((it) => ({ item: it.id, ...(S.refChoice[it.id] ? { ref: S.refChoice[it.id] } : {}) }));

// ── le rail ─────────────────────────────────────────────────
function paintRail() {
  const r = $('#rail');
  const top = r.scrollTop;
  const seg = el('div', { class: 'seg mode' },
    el('button', { class: 'tb' + (S.mode === 'create' ? ' on' : ''), onclick: () => setMode('create') }, 'Créer'),
    el('button', { class: 'tb' + (S.mode === 'edit' ? ' on' : ''), onclick: () => setMode('edit') }, 'Éditer'));
  r.replaceChildren(seg, ...(S.mode === 'create' ? createPanels() : editPanels()));
  r.scrollTop = top;
  schedCompose();
}
function setMode(m) { S.mode = m; S.paint.on = false; saveDraft(); paintRail(); paintStage(); }

function modelCards(ids, current, onpick, disabled = {}) {
  return el('div', { class: 'models' }, ...ids.map((id) => {
    const m = M(id);
    const off = disabled[id];
    return el('button', { class: 'opt model' + (current === id ? ' on' : '') + (off ? ' off' : ''), 'aria-disabled': off ? 'true' : null,
      title: off || m.role, onclick: () => (off ? toast(`${m.name} : ${off}`, 5000) : onpick(id)) },
    el('span', { class: 'mk' }, m.k), el('b', {}, m.name), el('span', { class: 'role' }, off || m.role),
    el('span', { class: 'cap' }, off ? 'indisponible ici' : m.refs ? `${m.refs} réf. au plus` : 'texte seul'));
  }));
}

// ── créer ───────────────────────────────────────────────────
function createPanels() {
  fixQuality();
  const m = M(S.model);
  const out = [];
  out.push(pan('Modèle', null, modelCards(['zimage', 'qwen21', 'krea2'], S.model, (id) => {
    S.model = id;
    if (S.refs.length > M(id).refs) S.refs = S.refs.slice(0, M(id).refs);
    fixQuality(); saveDraft(); paintRail();
  }), variantRow(m)));

  const ta = el('textarea', { class: 'fld prompt', rows: 6, placeholder: promptHint(),
    oninput: (e) => { S.prompt = e.target.value; saveDraft(); schedCompose(); paintAct(); } });
  ta.value = S.prompt;
  out.push(pan('Prompt', 'en anglais', ta, tokenRow(ta, S.refs, 1)));
  out.push(refsPanel(m));
  out.push(el('div', { class: 'looks-h' }, el('span', { class: 'lbl' }, 'Prise de vue'),
    el('button', { class: 'tb ghost sm', title: 'tout retirer', disabled: Object.values(S.looks).some(Boolean) ? null : true,
      onclick: () => { S.looks = {}; saveDraft(); paintRail(); } }, 'aucune')));
  for (const g of S.cfg.looks) out.push(lookGroup(g, S.looks, 'generate'));

  const sizes = m.sizes[S.quality];
  out.push(pan('Format', sizes[S.aspect] ? `${sizes[S.aspect][0]} × ${sizes[S.aspect][1]}` : '',
    el('div', { class: 'aspects' }, ...S.cfg.aspects.map((a) => {
      const [w, h] = a.split(':').map(Number);
      const wh = sizes[a];
      return el('button', { class: 'opt asp' + (S.aspect === a ? ' on' : ''), disabled: wh ? null : true,
        title: wh ? `${wh[0]} × ${wh[1]}` : `${a} : non documenté en ${m.quality.find((q) => q.id === S.quality).label}`,
        onclick: () => { S.aspect = a; saveDraft(); paintRail(); } },
      el('i', { style: { aspectRatio: `${w} / ${h}`, [w >= h ? 'width' : 'height']: '22px' } }), el('span', {}, a));
    })),
    el('div', { class: 'opts' }, ...m.quality.map((q) => el('button', { class: 'opt' + (S.quality === q.id ? ' on' : ''),
      onclick: () => { S.quality = q.id; fixQuality(); saveDraft(); paintRail(); } }, q.label))),
    el('p', { class: 'hint' }, sizeNote(m))));

  out.push(countSeed(S, [1, 2, 3, 4],
    S.count > 1 ? `${S.count} images, graines qui se suivent : un travail chacune, les deux DGX les rendent en même temps` : ''));
  out.push(sentPanel());
  out.push(el('div', { class: 'act', id: 'act' }));
  setTimeout(paintAct);
  return out;
}

function paintAct() {
  const box = $('#act');
  if (!box) return;
  let label; let why; let info;
  if (S.mode === 'create') {
    const m = M(S.model);
    const a = avail(capCreate());
    why = !S.prompt.trim() ? 'écrivez un prompt' : !a.ok ? `modèle absent — ${a.why}` : '';
    label = S.count > 1 ? `Générer ${S.count} images` : 'Générer';
    const wh = m.sizes[S.quality]?.[S.aspect];
    info = `${m.name} · ${wh ? wh.join(' × ') : ''}${a.on?.length ? ' · ' + a.on.join(' + ') : ''}`;
    box.replaceChildren(el('button', { class: 'tb go block', disabled: why ? true : null, onclick: generate }, label),
      el('p', { class: why ? 'why' : 'hint' }, why || info));
    return;
  }
  const E = S.edit;
  const a = avail(capEdit());
  label = { instruct: E.mask || S.paint.dirty ? 'Éditer la zone' : 'Éditer', matte: 'Détourer', upscale: `Agrandir ×${E.factor}`,
    refine: 'Affiner ×2', angle: 'Tourner la caméra' }[E.tool] || 'Éditer';
  why = !S.current ? 'choisissez l’image à éditer' : !a.ok ? `modèle absent — ${a.why}`
    : (E.tool === 'instruct' && !E.prompt.trim()) ? 'écrivez une consigne' : '';
  box.replaceChildren(el('button', { class: 'tb go block', disabled: why ? true : null, onclick: editRun }, label),
    el('p', { class: why ? 'why' : 'hint' }, why || (a.on?.length ? `sur ${a.on.join(' + ')}` : '')));
}

function sizeNote(m) {
  if (m.id === 'zimage') return 'paliers du Space officiel Z-Image-Turbo';
  if (m.id === 'qwen21') return S.quality === '2k' ? 'tailles natives du README Qwen-Image 2.1 (pas de 21:9 publié)' : '1 Mpx au pas de 32, défaut des gabarits ComfyUI';
  return 'Krea 2 Turbo : de 1k à 2k, au pas de 16';
}
function promptHint() {
  if (S.model === 'qwen21') return 'Décrivez l’image, en anglais. Les références se nomment <image1>, <image2>…';
  if (S.model === 'krea2') return 'Décrivez la photo en langage naturel, long et précis : le sujet, le lieu, la lumière — en anglais.';
  return 'Décrivez l’image en anglais, en phrases détaillées : le sujet, le lieu, la lumière.';
}

function variantRow(m) {
  if (m.id === 'zimage') {
    return el('div', { class: 'opts sub' }, ...m.variants.map((v) => {
      const a = avail('zimage:' + v.id);
      const where = S.cfg.availability?.['zimage:' + v.id]?.on || [];
      return el('button', { class: 'opt' + (S.variant === v.id ? ' on' : ''), disabled: a.ok ? null : true,
        title: a.ok ? (where.length ? `sur ${where.join(' + ')}` : '') : a.why,
        onclick: () => { S.variant = v.id; saveDraft(); paintRail(); } }, v.label,
      el('small', {}, where.length ? where.join(' + ') : 'absent des machines'));
    }));
  }
  if (m.id === 'krea2') {
    return el('label', { class: 'tog' }, el('input', { type: 'checkbox', checked: S.realism ? true : null,
      onchange: (e) => { S.realism = e.target.checked; saveDraft(); } }),
    el('span', {}, 'UltraReal 0,7'), el('small', {}, 'LoRA photo, banc Character Factory du 28/09 · sans effet avec une référence'));
  }
  return el('div', { class: 'stack' },
    el('label', { class: 'tog' }, el('input', { type: 'checkbox', checked: S.transparent ? true : null,
      onchange: (e) => { S.transparent = e.target.checked; saveDraft(); schedCompose(); } }),
    el('span', {}, 'Fond transparent'), el('small', {}, 'RGBA natif de Qwen 2.1, sans détourage : le prompt prend le gabarit officiel')),
    el('p', { class: 'hint' }, 'turbo Viggle, 6 pas — le réglage de Character Factory'));
}

// les références : la planche commune, et le choix d'une image dans un élément
function refsPanel(m) {
  if (!m.refs) {
    return pan('Références', 'aucune', el('p', { class: 'reason' }, m.refs_why),
      el('div', { class: 'row' },
        el('button', { class: 'tb ghost sm', onclick: () => { S.model = 'qwen21'; fixQuality(); saveDraft(); paintRail(); } }, 'Passer à Qwen 2.1'),
        el('button', { class: 'tb ghost sm', onclick: () => { S.model = 'krea2'; fixQuality(); saveDraft(); paintRail(); } }, 'Passer à Krea 2')));
  }
  const box = el('div', { class: 'refs' });
  const choices = el('div', { class: 'choices' });
  const bd = refBoard(box, { max: m.refs, via: VIA, onchange: (list) => {
    S.refs = list.slice(); saveDraft(); paintChoices(choices, S.refs, 1, (k) => bd.set(swap(S.refs, k))); schedCompose();
    $('#refs-n') && ($('#refs-n').textContent = `${S.refs.length} / ${m.refs}`);
  } });
  bd.set(S.refs.slice(0, m.refs));
  const hint = m.id === 'qwen21'
    ? 'dans l’ordre de la planche : <image1>, <image2>, <image3> — nommez-les dans le prompt ; un personnage de Character Factory s’importe d’un clic (+ → onglet Character Factory)'
    : '1 référence : la personne ou l’objet à reprendre · 2 : la scène d’abord, puis le sujet (Identity Edit v1.2) ; un personnage de Character Factory s’importe d’un clic';
  return el('section', { class: 'ipan' }, el('div', { class: 'ipan-h' }, el('span', { class: 'lbl' }, 'Références'),
    el('span', { class: 'r', id: 'refs-n' }, `${S.refs.length} / ${m.refs}`)), box, choices, el('p', { class: 'hint' }, hint));
}

// l'ordre compte : <image1>, <image2>… (Qwen) ; la scène puis le sujet (Krea)
const swap = (list, k) => { const l = list.slice(); [l[k - 1], l[k]] = [l[k], l[k - 1]]; return l; };
function paintChoices(box, list, first, onUp) {
  box.replaceChildren(...list.map((it, k) => {
    const tag = el('span', { class: 'tok' }, `<image${first + k}>`);
    const up = k > 0 && onUp ? el('button', { class: 'tb ghost sm up', title: 'passer avant', onclick: () => onUp(k) }, '↑') : null;
    if (it.kind !== 'element') return el('div', { class: 'choice' }, tag, el('span', { class: 'nm' }, it.title), up);
    const refs = it.element?.refs || [];
    const sel = el('select', { class: 'fld sm', title: 'quelle image de l’élément envoyer',
      onchange: (e) => { S.refChoice[it.id] = e.target.value; saveDraft(); schedCompose(); } },
    ...refs.map((r) => el('option', { value: r.file, selected: (S.refChoice[it.id] || refs[0]?.file) === r.file ? true : null },
      `${r.label || r.role || r.file}${r.role ? ' · ' + r.role : ''}`)));
    return el('div', { class: 'choice' }, tag, el('span', { class: 'nm' }, it.title), sel, up);
  }));
}

// les jetons <imageN> à glisser dans le prompt (Qwen)
function tokenRow(ta, list, first) {
  const model = S.mode === 'create' ? S.model : S.edit.model;
  if (model !== 'qwen21') return null;
  const toks = (S.mode === 'edit' ? [{ title: 'l’image éditée' }] : []).concat(list);
  if (!toks.length) return null;
  const start = S.mode === 'edit' ? 1 : first;
  return el('div', { class: 'row toks' }, ...toks.map((it, k) => el('button', { class: 'tb ghost sm', title: `insérer <image${start + k}> — ${it.title}`,
    onclick: () => {
      const t = `<image${start + k}>`;
      const p = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, p) + t + ta.value.slice(ta.selectionEnd ?? p);
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    } }, `<image${start + k}>`)));
}

// le sigle posé sur la vignette dessinée (image.css) d'une caméra ou d'un objectif
const ABBR = {
  camera: { fullframe: 'FF', mediumformat: 'MF', leica: 'M6', alexa: 'S35', imax: '70', '16mm': '16', digicam: 'DC', disposable: 'FL', phone: 'PH' },
  lens: { 14: '14', 24: '24', 35: '35', 50: '50', 85: '85', 135: '135', macro: '1:1', anamorphic: '2.39', swirl: 'PTZ', vintage: 'K35' },
};

function lookGroup(g, looks, mode) {
  const cur = g.items.find((x) => x.id === looks[g.id]);
  const model = mode === 'edit' ? S.edit.model : S.model;
  return fold(`look-${mode}-${g.id}`, g.label, cur ? cur.name : '',
    g.about ? el('p', { class: 'hint' }, g.about) : null,
    el('div', { class: 'looks' }, ...g.items.map((x) => {
      const said = mode === 'edit' ? (x.edit || x.prose) : (model === 'krea2' && x.krea ? x.krea : x.prose);
      return el('button', { class: 'opt look' + (looks[g.id] === x.id ? ' on' : ''), title: `« ${said} »\nsource : ${x.src}`,
        onclick: () => { looks[g.id] = looks[g.id] === x.id ? null : x.id; saveDraft(); paintRail(); } },
      el('span', { class: 'sw', 'data-g': g.id, 'data-id': x.id, 'data-abbr': ABBR[g.id]?.[x.id] ?? null }), el('b', {}, x.name), x.sub ? el('small', {}, x.sub) : null);
    })));
}

function sentPanel() {
  const box = el('div', { id: 'sent' });
  paintSent(box);
  const d = el('details', { class: 'ipan fold', open: S.open.sent ? true : null },
    el('summary', { class: 'ipan-h' }, el('span', { class: 'lbl' }, 'Prompt envoyé'), el('span', { class: 'r set', id: 'sent-n' }, '…')), box);
  d.addEventListener('toggle', () => { S.open.sent = d.open; saveDraft(); });
  return d;
}

function countSeed(o, counts, note = '') {
  const seed = el('input', { class: 'fld seed', inputmode: 'numeric', placeholder: 'au hasard', value: o.seed, title: 'la graine : la même graine et la même recette refont la même image',
    oninput: (e) => { o.seed = e.target.value.replace(/\D/g, ''); e.target.value = o.seed; saveDraft(); } });
  return pan('Nombre · graine', null, el('div', { class: 'row' },
    el('div', { class: 'seg' }, ...counts.map((n) => el('button', { class: 'tb' + (o.count === n ? ' on' : ''),
      onclick: () => { o.count = n; saveDraft(); paintRail(); } }, String(n)))),
    el('span', { class: 'sp' }), seed,
    el('button', { class: 'tb ghost sm', title: 'une graine au hasard', onclick: () => { o.seed = String(Math.floor(Math.random() * 1e9)); seed.value = o.seed; saveDraft(); } }, 'dé')),
  note ? el('p', { class: 'hint' }, note) : null);
}

// ── éditer ──────────────────────────────────────────────────
// Des consignes toutes faites, tirées des exemples officiels (étude §6).
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

function editPanels() {
  const out = [];
  const src = S.current;
  const pickSrc = async () => { const [it] = await pick({ kinds: ['image'], title: 'L’image à éditer' }); if (it) pickShow(it); };
  // l'emplacement de l'image à éditer : un dépôt (fichier ou vignette) la remplace
  const srcZone = (node) => dropZone(node, { kinds: ['image'], multiple: false, via: VIA, onitems: ([it]) => pickShow(it) });
  if (!src || src.kind !== 'image') {
    out.push(srcZone(pan('Image à éditer', 'déposez-la ici',
      el('div', { class: 'dropslot' }, el('b', {}, '+'),
        el('span', {}, 'Glissez une image ici — un fichier de votre disque, ou une vignette de l’historique à droite.')),
      el('button', { class: 'tb ghost block', onclick: pickSrc }, 'Choisir dans la bibliothèque'))));
    out.push(el('div', { class: 'act', id: 'act' }));
    setTimeout(paintAct);
    return out;
  }
  out.push(srcZone(pan('Image à éditer', `${src.width || '?'} × ${src.height || '?'}`,
    el('div', { class: 'srcrow' }, dragItem(el('span', { class: 'srcim', title: 'glissez-la vers les références',
      style: { backgroundImage: `url(${href(src.thumb_url || src.url)})` } }), src),
    el('div', { class: 'srcnm' }, el('b', {}, src.title || src.id), el('small', {}, src.origin?.model || src.origin?.tool || '')),
    el('button', { class: 'tb ghost sm', onclick: pickSrc }, 'changer')),
    el('p', { class: 'hint' }, 'une autre image se dépose ici pour la remplacer'))));

  const E = S.edit;
  out.push(pan('Outil', null, el('div', { class: 'tools' }, ...S.cfg.edit_tools.map((t) => {
    const a = t.off ? { ok: false } : avail(t.id === 'instruct' ? (E.model === 'krea2' ? 'krea2:edit' : 'qwen21') : t.id);
    return el('button', { class: 'opt tool' + (E.tool === t.id ? ' on' : '') + (t.off ? ' off' : ''), title: t.off || (a.ok ? t.about : a.why),
      onclick: () => { E.tool = t.id; S.paint.on = false; saveDraft(); paintRail(); paintStage(); } },
    el('b', {}, t.name), el('small', {}, t.sub));
  }))));

  const tool = S.cfg.edit_tools.find((t) => t.id === E.tool);
  if (tool?.off) {
    out.push(pan(tool.name, 'indisponible', el('p', { class: 'reason' }, tool.off),
      el('a', { class: 'tb ghost sm', href: href('docs/etudes/image.md'), target: '_blank' }, 'L’étude, §9')));
    return out;
  }
  out.push(el('p', { class: 'hint tool-about' }, tool?.about || ''));

  if (E.tool === 'instruct') {
    out.push(pan('Modèle', null, modelCards(['qwen21', 'krea2', 'zimage'], E.model, (id) => {
      E.model = id;
      const max = M(id).refs - 1;
      if (E.refs.length > max) E.refs = E.refs.slice(0, max);
      saveDraft(); paintRail();
    }, { zimage: 'n’édite pas par consigne (Z-Image-Edit n’est pas publié) — il sait affiner : outil « Affiner ×2 »' })));
    const ta = el('textarea', { class: 'fld prompt', rows: 5, placeholder: E.model === 'qwen21'
      ? 'La consigne, en anglais : « Change the jacket in <image1> to a red leather jacket »'
      : 'La consigne, en anglais : « Recolor the jacket to red leather »',
    oninput: (e) => { E.prompt = e.target.value; saveDraft(); schedCompose(); paintAct(); } });
    ta.value = E.prompt;
    out.push(pan('Consigne', 'en anglais', ta, tokenRow(ta, E.refs, 2),
      el('div', { class: 'opts quick' }, ...QUICK[E.model].map((q) => el('button', { class: 'opt', title: `${q.text}\nsource : ${q.src}`,
        onclick: () => { E.prompt = q.text; saveDraft(); paintRail(); } }, q.name))),
      E.model === 'krea2' ? el('p', { class: 'hint' }, 'Krea Turbo retire mal (il faut Krea Raw, CFG 3, non installé) : pour retirer, prenez Qwen.') : null));
    out.push(zonePanel());
    const max = M(E.model).refs - 1;
    const box = el('div', { class: 'refs' });
    const choices = el('div', { class: 'choices' });
    const eb = refBoard(box, { max, via: VIA, onchange: (list) => {
      E.refs = list.slice(); saveDraft(); paintChoices(choices, E.refs, 2, (k) => eb.set(swap(E.refs, k))); schedCompose();
      $('#erefs-n') && ($('#erefs-n').textContent = `${E.refs.length} / ${max}`);
    } });
    eb.set(E.refs.slice(0, max));
    out.push(el('section', { class: 'ipan' }, el('div', { class: 'ipan-h' }, el('span', { class: 'lbl' }, 'Références'),
      el('span', { class: 'r', id: 'erefs-n' }, `${E.refs.length} / ${max}`)), box, choices,
    el('p', { class: 'hint' }, E.model === 'qwen21'
      ? 'l’image éditée est <image1> ; les références suivent : <image2>, <image3>'
      : 'l’image éditée est la scène ; une référence = le sujet à y mettre (Identity Edit v1.2, 2 images au plus)')));
    const light = S.cfg.looks.find((g) => g.id === 'light');
    if (light) out.push(lookGroup({ ...light, label: 'Rééclairer', about: 'la consigne de lumière s’ajoute à la vôtre' }, E.looks, 'edit'));
    out.push(el('label', { class: 'tog' }, el('input', { type: 'checkbox', checked: E.keepFace ? true : null,
      onchange: (e) => { E.keepFace = e.target.checked; saveDraft(); schedCompose(); } }),
    el('span', {}, 'Garder le visage'), el('small', {}, E.model === 'qwen21' ? 'phrase du gabarit officiel Qwen 2.1' : 'phrase de Character Factory, banc du 28/09')));
    out.push(countSeed(E, [1, 2, 3, 4]));
    out.push(sentPanel());
  } else if (E.tool === 'upscale') {
    out.push(pan('Facteur', null, el('div', { class: 'opts' }, ...[2, 4].map((f) => {
      const big = Math.max(src.width || 0, src.height || 0) * f;
      return el('button', { class: 'opt' + (E.factor === f ? ' on' : ''), disabled: big > 8192 ? true : null,
        title: big > 8192 ? 'plus de 8192 px' : '', onclick: () => { E.factor = f; saveDraft(); paintRail(); } }, `×${f}`,
      el('small', {}, `${(src.width || 0) * f} × ${(src.height || 0) * f}`));
    })), el('p', { class: 'hint' }, 'SeedVR2 7B en un pas : l’image agrandie en Lanczos puis restaurée, couleurs recalées sur l’originale (gabarit officiel ComfyUI, repris de Character Factory).')));
  } else if (E.tool === 'refine') {
    const val = el('span', { class: 'val' }, E.denoise.toFixed(2));
    out.push(pan('Débruitage', null, el('div', { class: 'slide' },
      el('input', { type: 'range', min: 0.1, max: 0.5, step: 0.01, value: E.denoise,
        oninput: (e) => { E.denoise = Number(e.target.value); val.textContent = E.denoise.toFixed(2); saveDraft(); } }), val),
    el('div', { class: 'scale' }, el('span', {}, 'proche'), el('span', {}, 'réinventé'), el('span', {}, 'défauts')),
    el('p', { class: 'hint' }, '0,15–0,25 reste proche · 0,25–0,35 réinvente le détail · au-delà, des défauts (note du gabarit officiel Z-Image 2K).')));
    // « une description détaillée » : le prompt d'une image créée ici en est
    // une ; celui d'une édition n'est qu'une consigne, il n'est pas repris
    const caption = src.params?.job === 'image.generate' ? (src.prompt || '') : '';
    if (E.captionFor !== src.id) { E.caption = caption; E.captionFor = src.id; }
    const ta = el('textarea', { class: 'fld prompt', rows: 4, placeholder: 'une description détaillée de l’image tient mieux (note du gabarit) — en anglais',
      oninput: (e) => { E.caption = e.target.value; saveDraft(); } });
    ta.value = E.caption || '';
    out.push(pan('Description', caption && E.caption === caption ? 'reprise de l’image' : '', ta));
    out.push(countSeed(E, [1, 2]));
  } else if (E.tool === 'angle') {
    const A = S.cfg.angles;
    if (!E.azimuth) E.azimuth = A.azimuth[1][0];
    if (!E.elevation) E.elevation = 'eye-level shot';
    if (!E.distance) E.distance = 'medium shot';
    out.push(pan('Autour du sujet', A.azimuth.find(([id]) => id === E.azimuth)?.[1] || '', compass(A.azimuth, E)));
    const grp = (key, title, list) => pan(title, null, el('div', { class: 'opts' }, ...list.map(([id, name]) => el('button', {
      class: 'opt' + (E[key] === id ? ' on' : ''), title: id, onclick: () => { E[key] = id; saveDraft(); paintRail(); } }, name))));
    out.push(grp('elevation', 'Hauteur', A.elevation), grp('distance', 'Distance', A.distance));
    out.push(countSeed(E, [1, 2, 3, 4]));
    out.push(pan('Prompt envoyé', null, el('pre', { class: 'sent' }, `<sks> ${E.azimuth} ${E.elevation} ${E.distance}`),
      el('p', { class: 'hint' }, 'LoRA fal Multiple-Angles sur Qwen-Image-Edit 2511 (Lightning 4 pas), Apache-2.0 ; les côtés sont ceux du sujet.')));
  } else if (E.tool === 'matte') {
    out.push(pan('Détourer', null, el('p', { class: 'hint' }, 'BiRefNet (nœuds natifs de ComfyUI) : un PNG transparent, le sujet seul — le détourage de Character Factory.')));
  }
  out.push(el('div', { class: 'act', id: 'act' }));
  setTimeout(paintAct);
  return out;
}

// la boussole des huit azimuts : la vue de dessus, le sujet au centre
function compass(list, E) {
  const box = el('div', { class: 'compass' }, el('span', { class: 'who' }, 'sujet'));
  list.forEach(([id, name], k) => {
    const ang = (k * 45 - 90) * Math.PI / 180;
    // « 3/4 avant droit » sur deux lignes : la boussole reste compacte
    const m = name.match(/^(3\/4 \S+) (.+)$/);
    box.append(el('button', { class: 'pt' + (E.azimuth === id ? ' on' : ''), title: `${name} — ${id}`,
      style: { left: `${50 + 40 * Math.cos(ang)}%`, top: `${50 + 40 * Math.sin(ang)}%` },
      onclick: () => { E.azimuth = id; saveDraft(); paintRail(); } }, ...(m ? [m[1].replace('3/4', '¾'), el('br'), m[2]] : [name])));
  });
  return box;
}

// la zone peinte : un masque au pinceau sur l'image, à sa taille réelle
function zonePanel() {
  const P = S.paint;
  const has = P.dirty && P.for === S.current?.id;
  return pan('Zone', has ? 'peinte' : 'toute l’image',
    el('div', { class: 'row' },
      el('button', { class: 'tb sm' + (P.on ? ' on' : ' ghost'), onclick: () => { P.on = !P.on; paintStage(); paintRail(); } },
        P.on ? 'Peindre : actif' : 'Peindre une zone'),
      el('button', { class: 'tb ghost sm', disabled: has ? null : true, onclick: () => { clearPaint(); paintStage(); paintRail(); } }, 'Effacer'),
      el('span', { class: 'sp' }),
      el('label', { class: 'brush' }, el('span', { class: 'lbl' }, 'pinceau'),
        el('input', { type: 'range', min: 8, max: 200, value: P.size, oninput: (e) => { P.size = Number(e.target.value); } }))),
    el('p', { class: 'hint' }, 'Seule la zone peinte change : elle est éditée de près puis recollée, bord adouci — le reste de l’image ne bouge pas (méthode du report de visage de Character Factory).'));
}
function paintCanvas() {
  const P = S.paint;
  const it = S.current;
  if (!P.canvas || P.for !== it.id) {
    P.canvas = el('canvas', { class: 'paint', width: it.width || 1024, height: it.height || 1024 });
    P.for = it.id; P.dirty = false;
    let drawing = false;
    const ctx = P.canvas.getContext('2d');
    const at = (e) => { const r = P.canvas.getBoundingClientRect(); return [(e.clientX - r.left) * P.canvas.width / r.width, (e.clientY - r.top) * P.canvas.height / r.height]; };
    const dot = (e) => {
      const [x, y] = at(e);
      const r = P.canvas.getBoundingClientRect();
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--or').trim();
      ctx.beginPath(); ctx.arc(x, y, (P.size / 2) * P.canvas.width / r.width, 0, Math.PI * 2); ctx.fill();
      if (!P.dirty) { P.dirty = true; paintRail(); }
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
    const mask = maskDataUrl();
    if (mask) body.mask = mask;
  }
  if (E.tool === 'upscale') body.factor = E.factor;
  if (E.tool === 'refine') Object.assign(body, { denoise: E.denoise, prompt: E.caption || '', count: E.count });
  if (E.tool === 'angle') Object.assign(body, { azimuth: E.azimuth, elevation: E.elevation, distance: E.distance, count: E.count });
  await launch('image/edit', body);
}
async function launch(path, body) {
  const btn = $('#act .tb.go');
  if (btn) btn.disabled = true;
  let r;
  try { r = await api(path, { method: 'POST', body }); } catch (e) { toast(e.message, 7000); paintAct(); return; }
  // la première image de chaque demande envoyée s'affichera au centre, tant
  // qu'on n'a rien choisi d'autre depuis (un clic dans la colonne l'annule)
  S.autoShow.add(r.batch || r.jobs[0]?.id);
  for (const j of r.jobs) follow(j);
  toast(r.jobs.length > 1 ? `${r.jobs.length} rendus en file — à droite` : 'en file — à droite');
  paintAct();
  paintSide();
}
// les travaux lancés d'ici : suivis un à un (la file commune ne les voit
// qu'au relevé suivant) ; leurs images se posent dans la colonne en arrivant
function follow(j) {
  S.mine.set(j.id, j);
  jobs.wait(j.id, (now) => { S.mine.set(j.id, now); paintSide(); }).then((done) => {
    S.mine.delete(j.id);
    // un échec reste dans la colonne (Relancer, ×) ; le reste laisse la place à ses images
    if (done.state === 'error') S.mine.set(j.id, done); else S.done.add(j.id);
    if (done.state === 'done' && done.items?.length) arrived(done.items, j.params?.batch);
    else if (done.state === 'error') toast(`échec : ${done.message}`, 9000);
    paintSide();
  }).catch(() => { S.mine.delete(j.id); });
}
function arrived(items, batch) {
  for (const it of items) {
    if (!S.items.some((x) => x.id === it.id)) { S.items.unshift(it); S.total += 1; }
    S.fresh.add(it.id);
  }
  if (S.autoShow.delete(batch)) { S.fresh.delete(items[0].id); show(items[0]); }
}

// ── la scène ────────────────────────────────────────────────
async function show(it) {
  S.current = it; S.compare = false; S.parent = null; S.paint.on = false;
  try { history.replaceState(null, '', '#' + it.id); } catch { /* sans historique */ }
  saveDraft();
  const pid = it.parents?.[0];
  if (pid) {
    try { const p = await api('library/' + pid); if (p.kind === 'image' && S.current?.id === it.id) S.parent = p; } catch { /* parti */ }
  }
  paintStage();
  if (S.mode === 'edit') paintRail();
  paintSide();
}
// un choix de Cal (clic dans la colonne, dépôt, sélecteur) : l'image arrivée
// ensuite ne lui passera pas devant
function pickShow(it) {
  S.autoShow.clear();
  // vue une image d'une demande, ses sœurs ne sont plus « nouvelles »
  const b = it.params?.batch;
  for (const x of S.items) if (x.id === it.id || (b && x.params?.batch === b)) S.fresh.delete(x.id);
  return show(it);
}

function paintStage() {
  const st = $('#stage');
  st.replaceChildren(...[
    stub() ? el('div', { class: 'banner' }, el('b', {}, 'Moteur factice'),
      el('span', {}, 'les images sont des mires dessinées — aucun modèle n’est chargé. Le câblage réel est en place : « image_backend » : « comfyui » dans showrunner.local.json.')) : null,
    viewer(), actionBar(), meta()].filter(Boolean));
}

// les gestes sur l'image montrée : sous elle, pour ne rien cacher de l'image
function actionBar() {
  const it = S.current;
  if (!it) return null;
  const rec = it.params?.job;
  const g = (label, fn, title = '', on = false) => el('button', { class: 'tb sm ' + (on ? 'on' : 'ghost'), title, onclick: fn }, label);
  return el('div', { class: 'vbar' },
    el('div', { class: 'grp' }, el('span', { class: 'lbl' }, 'Éditer'),
      g('Consigne', () => editWith('instruct'), 'changer l’image par une phrase, sur tout ou une zone'),
      g('Détourer', () => editWith('matte')), g('Agrandir', () => editWith('upscale')),
      g('Affiner', () => editWith('refine')), g('Angle', () => editWith('angle'))),
    el('div', { class: 'grp' }, el('span', { class: 'lbl' }, 'Recette'),
      rec ? g('Variations', () => redo(4), 'la même recette, 4 autres graines') : null,
      rec ? g('Refaire', () => redo(0), 'la même recette, la même graine') : null,
      !rec ? el('span', { class: 'hint' }, 'image sans recette : déposée ou faite ailleurs') : null),
    el('span', { class: 'sp' }),
    el('div', { class: 'grp' },
      S.parent ? g('Avant / après', () => { S.compare = !S.compare; paintStage(); }, 'comparer à l’image source', S.compare) : null,
      g('Référence', () => useAsRef(it), 'l’ajouter aux références de « Créer »'),
      el('a', { class: 'tb ghost sm', href: href(it.url), download: `${(it.title || it.id).replace(/[^\w.-]+/g, '_').slice(0, 60)}${(it.file || '.png').slice((it.file || '.png').lastIndexOf('.'))}` }, 'Télécharger')));
}

// le grand cadre : on y dépose une image (fichier ou vignette) pour la voir
// — ou, en avant / après, pour la mettre « avant » et comparer deux images
function viewerZone(box) {
  return dropZone(box, { kinds: ['image'], multiple: false, via: VIA, onitems: ([it]) => {
    if (S.compare && S.current) { S.parent = it; paintStage(); toast(`« ${it.title} » en « avant »`); } else pickShow(it);
  } });
}

function viewer() {
  const it = S.current;
  if (!it) {
    return viewerZone(el('div', { class: 'viewer iv' }, el('div', { class: 'empty' },
      el('b', {}, S.mode === 'edit' ? 'Quelle image ?' : 'Rien encore'),
      el('span', {}, S.mode === 'edit'
        ? 'Déposez ici l’image à éditer — un fichier de votre disque ou une vignette de la colonne de droite —, ou choisissez-la à gauche.'
        : 'Réglez à gauche, puis « Générer » : les rendus paraissent à droite dès l’envoi, leurs images s’y posent en arrivant. Une image déposée ici s’ouvre.'))));
  }
  const alpha = /birefnet/.test(it.origin?.model || '') || it.params?.transparent;
  const box = viewerZone(el('div', { class: 'viewer iv' + (alpha ? ' alpha' : '') }));
  const painting = S.mode === 'edit' && S.edit.tool === 'instruct';
  if (S.compare && S.parent) box.append(compareView(S.parent, it));
  else {
    const withPaint = painting && (S.paint.on || (S.paint.dirty && S.paint.for === it.id));
    // l'image se glisse vers les références ou un autre outil, sauf quand on peint dessus
    const img = el('img', { src: href(it.url), alt: it.title || '', draggable: withPaint ? 'false' : null });
    if (!withPaint) dragItem(img, it);
    const wrap = el('div', { class: 'imwrap' }, img);
    if (withPaint) wrap.append(paintCanvas());
    box.append(wrap);
  }
  const fac = /factice/.test(it.origin?.model || '');
  box.append(el('div', { class: 'tagm' }, el('b', {}, (it.origin?.model || it.origin?.tool || '').replace(/-factice$/, '').toUpperCase()),
    el('span', {}, `${it.width || '?'} × ${it.height || '?'}${fac ? ' · factice' : ''}`)));
  if (S.paint.on && painting) box.append(el('div', { class: 'painthint' }, 'peignez la zone à changer'));
  return box;
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
  wrap.append(imA, imB, handle, el('span', { class: 'cap a', title: 'déposez une autre image sur le cadre pour la comparer' }, 'avant · déposer pour changer'),
    el('span', { class: 'cap b' }, 'après'));
  set(50);
  return wrap;
}

function meta() {
  const it = S.current;
  if (!it) return null;
  const p = it.params || {};
  const kv = [
    ['modèle', it.origin?.model || it.origin?.tool || ''],
    ['taille', it.width ? `${it.width} × ${it.height}` : ''],
    ['graine', p.seed ?? ''],
    ['durée', fmtS(it.render_s)],
    ['machine', it.origin?.machine || ''],
    ['créée', fmtDate(it.created)],
  ].filter(([, v]) => v !== '' && v != null);
  const looks = Object.entries(p.looks || {}).filter(([, v]) => v).map(([g, v]) => {
    const grp = S.cfg.looks.find((x) => x.id === g);
    return grp?.items.find((x) => x.id === v)?.name || v;
  });
  const lineage = el('div', { class: 'lineage' });
  (async () => {
    const got = (await Promise.all((it.parents || []).map((id) => api('library/' + id).catch(() => null)))).filter(Boolean);
    if (!got.length) return;
    lineage.replaceChildren(el('span', { class: 'lbl' }, 'Lignée'), ...got.map((x, k) => dragItem(el('button', {
      class: 'par', title: `${k === 0 && p.job === 'image.edit' ? 'source' : 'référence'} : ${x.title}`,
      style: { backgroundImage: x.thumb_url ? `url(${href(x.thumb_url)})` : null },
      onclick: () => (x.kind === 'image' ? pickShow(x) : toast(`${x.title} : un élément de la bibliothèque`)) },
    el('span', {}, k === 0 && p.job === 'image.edit' ? 'source' : 'réf.')), x)));
  })();
  return el('section', { class: 'ipan meta-i' },
    el('div', { class: 'ipan-h' }, el('span', { class: 'lbl' }, 'L’image'), el('span', { class: 'r' },
      el('a', { href: href('asset/#' + it.id) }, 'dans Asset'))),
    el('h2', { class: 'ttl' }, it.title || it.id),
    el('dl', { class: 'kv' }, ...kv.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))])),
    looks.length ? el('div', { class: 'opts' }, ...looks.map((n) => el('span', { class: 'chip' }, n))) : null,
    lineage,
    it.prompt ? el('details', { class: 'pr' }, el('summary', { class: 'lbl' }, 'Prompt envoyé'), el('pre', { class: 'sent' }, it.prompt)) : null,
    el('div', { class: 'row' },
      p.job === 'image.generate' ? el('button', { class: 'tb ghost sm', title: 'le formulaire « Créer » reprend sa recette', onclick: () => takeRecipe(it) }, 'Reprendre ses réglages') : null,
      el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', title: 'à la corbeille de la bibliothèque, d’où elle peut revenir (Asset)', onclick: () => trashIt(it) }, 'Corbeille')));
}

async function trashIt(it) {
  try { await api(`library/${it.id}/delete`, { method: 'POST' }); } catch (e) { toast(e.message); return; }
  toast(`« ${it.title} » à la corbeille — elle revient depuis Asset`);
  S.current = null; S.parent = null;
  S.items = S.items.filter((x) => x.id !== it.id); S.total = Math.max(0, S.total - 1);
  S.cells.delete('i:' + it.id);
  try { history.replaceState(null, '', location.pathname); } catch { /* sans historique */ }
  saveDraft(); paintStage(); if (S.mode === 'edit') paintRail();
  paintSide();
}

function editWith(tool) {
  S.mode = 'edit'; S.edit.tool = tool; S.paint.on = false;
  saveDraft(); paintRail(); paintStage();
  $('#rail').scrollTop = 0;
}
function useAsRef(it) {
  if (!M(S.model).refs) S.model = 'krea2';
  const max = M(S.model).refs;
  if (!S.refs.some((r) => r.id === it.id)) S.refs = [...S.refs, it].slice(-max);
  S.mode = 'create';
  saveDraft(); paintRail(); paintStage();
  toast(`« ${it.title} » ajoutée aux références de ${M(S.model).name}`);
}
async function takeRecipe(it) {
  const p = it.params || {};
  Object.assign(S, { model: p.model || S.model, prompt: p.prompt || '', looks: { ...(p.looks || {}) }, aspect: p.aspect || S.aspect,
    quality: p.quality || S.quality, seed: p.seed != null ? String(p.seed) : '', variant: p.variant || S.variant,
    realism: p.realism ?? S.realism, mode: 'create' });
  S.refs = (await Promise.all((p.refs || []).map((r) => api('library/' + r.item).catch(() => null)))).filter(Boolean);
  for (const r of p.refs || []) if (r.ref) S.refChoice[r.item] = r.ref;
  saveDraft(); paintRail(); paintStage();
  toast('réglages repris : même graine, même recette');
}
async function redo(n) { await launch('image/redo', { item: S.current.id, variations: n }); }

// ── la colonne : la file et l'historique vivants ────────────
let lastList = [];
const LIVE = ['queued', 'running'];
const RANK = { queued: 0, running: 1, done: 2, error: 2, cancelled: 2, interrupted: 2 };
const ms = (iso) => Date.parse(iso || '') || 0;
const inSession = (iso) => ms(iso) >= ms(S.session);

// les travaux de l'outil à montrer : en file, en cours, et les échecs de la session
function liveJobs() {
  const byId = new Map();
  for (const j of lastList) if (j.tool === 'image') byId.set(j.id, j);
  for (const [id, j] of S.mine) { const cur = byId.get(id); if (!cur || RANK[j.state] >= RANK[cur.state]) byId.set(id, j); }
  // un rendu fini que la page n'a pas encore rapatrié (S.mine) garde sa case
  // jusqu'à ce que son image la remplace : la demande ne « perd » pas d'image
  return [...byId.values()].filter((j) => !S.done.has(j.id) && (LIVE.includes(j.state) || (S.mine.has(j.id) && j.state === 'done')
    || (['error', 'interrupted'].includes(j.state) && inSession(j.created))));
}
// la place dans la file de la voie image (toutes les pages la partagent)
function queuePos(j) {
  // l'état le plus frais d'abord : un rendu que la page sait parti n'est plus devant
  const q = lastList.filter((x) => x.lane === 'image' && x.state === 'queued' && (S.mine.get(x.id)?.state || 'queued') === 'queued')
    .sort((a, b) => ms(a.created) - ms(b.created));
  const k = q.findIndex((x) => x.id === j.id);
  return k < 0 ? null : k + 1;
}

// une demande = un groupe : ses images arrivées et ses rendus qui restent
function groups() {
  const map = new Map();
  const add = (key, when) => {
    let g = map.get(key);
    if (!g) { g = { key, items: [], jobs: [], at: 0 }; map.set(key, g); }
    g.at = Math.max(g.at, ms(when));
    return g;
  };
  for (const it of S.items) {
    if (S.hist === 'session' && !inSession(it.created)) continue;
    add(it.params?.batch || it.id, it.created).items.push(it);
  }
  for (const j of liveJobs()) add(j.params?.batch || j.id, j.created).jobs.push(j);
  return [...map.values()].sort((a, b) => b.at - a.at);
}

const shortModel = (m) => (m || '').replace(/-factice$/, '').replace(/-turbo$/, '').replace(/-edit(-zone)?$/, ' éd.')
  .replace(/^qwen-edit-2511-angles$/, 'angle').toUpperCase();

// une image arrivée : cliquer la montre au centre, sans rien arrêter ; elle se glisse
function itemCell(it) {
  const key = 'i:' + it.id;
  let n = S.cells.get(key);
  if (!n) {
    n = dragItem(el('button', { class: 'hc', type: 'button', title: `${it.title}\n${it.prompt || ''}`.trim(), onclick: () => pickShow(it) },
      el('span', { class: 'im' }, el('img', { src: href(it.thumb_url || it.url), alt: '', loading: S.fresh.has(it.id) ? 'eager' : 'lazy', draggable: 'false' }),
        el('span', { class: 'tg' }, shortModel(it.origin?.model))),
      el('span', { class: 'cap' }, el('span', { class: 't' }, it.title || it.id),
        el('span', { class: 's' }, [it.width ? `${it.width}×${it.height}` : '', fmtS(it.render_s)].filter(Boolean).join(' · ')))), it);
    S.cells.set(key, n);
  }
  n.classList.toggle('sel', S.current?.id === it.id);
  n.classList.toggle('fresh', S.fresh.has(it.id));
  return n;
}

// un rendu qui n'est pas encore là : la forme de l'image attendue, sa place ou sa progression
function jobCell(j) {
  const key = 'j:' + j.id;
  let n = S.cells.get(key);
  if (!n) {
    const P = j.params || {};
    const w = P.width || 1, h = P.height || 1;
    const parts = {
      st: el('b', { class: 'st' }), msg: el('span', { class: 'msg' }), bar: el('i'),
      stop: el('button', { class: 'tb ghost sm', title: 'arrêter ce rendu', onclick: (e) => { e.stopPropagation(); jobs.cancel(j.id).then(paintSide); } }, 'Arrêter'),
      retry: el('button', { class: 'tb ghost sm', onclick: (e) => { e.stopPropagation(); jobs.retry(j.id).then((nj) => { S.done.add(j.id); jobs.forget(j.id); follow(nj); paintSide(); }); } }, 'Relancer'),
      forget: el('button', { class: 'tb ghost sm', title: 'retirer', onclick: (e) => { e.stopPropagation(); S.done.add(j.id); jobs.forget(j.id); paintSide(); } }, '×'),
    };
    n = el('div', { class: 'hc job-c', title: j.title },
      el('span', { class: 'im' }, el('span', { class: 'shape', style: { aspectRatio: `${w} / ${h}`, [w >= h ? 'width' : 'height']: '62%' } }),
        parts.st, el('span', { class: 'bar' }, parts.bar)),
      el('span', { class: 'cap' }, el('span', { class: 't' }, j.title), parts.msg),
      el('span', { class: 'acts' }, parts.stop, parts.retry, parts.forget));
    n._p = parts;
    S.cells.set(key, n);
  }
  const p = n._p;
  const arriving = j.state === 'done';
  const run = j.state === 'running' || arriving, err = !LIVE.includes(j.state) && !arriving;
  n.classList.toggle('run', run);
  n.classList.toggle('err', err);
  const pos = j.state === 'queued' ? queuePos(j) : null;
  p.st.textContent = arriving ? 'arrive' : err ? 'échec' : run ? (j.progress != null ? `${Math.round(j.progress * 100)} %` : 'en cours')
    : pos ? `en file · n° ${pos}` : 'en file';
  // « en file » est déjà écrit sur la case : la légende dit le reste (la machine, une attente)
  p.msg.textContent = err ? (j.message || '') : [j.machine, j.message === 'en file' ? '' : j.message].filter(Boolean).join(' · ');
  p.bar.style.width = arriving ? '100%' : run && j.progress != null ? `${Math.round(j.progress * 100)}%` : '0';
  p.stop.hidden = err || arriving; p.retry.hidden = !err; p.forget.hidden = !err;
  return n;
}

function groupHead(g) {
  const first = g.items[0], job = g.jobs[0];
  const model = first?.origin?.model || job?.params?.model || job?.params?.tool || '';
  const total = g.items.length + g.jobs.length;
  const left = g.jobs.filter((j) => LIVE.includes(j.state)).length;
  const title = (job?.title || first?.title || '').replace(/^(Krea 2|Qwen-Image 2\.1|Z-Image|Variation|Refaire|Consigne|Détourer|Agrandir|Affiner ×2|Angle) · /, '');
  return el('div', { class: 'gh' },
    el('span', { class: 'k' }, shortModel(model)),
    el('span', { class: 'n' }, left ? `${total - left} / ${total}` : `${total} images`),
    el('span', { class: 'when' }, fmtDate(new Date(g.at).toISOString()).split(' ')[1] || ''),
    el('span', { class: 'tt', title }, title));
}

function paintSide() {
  const side = $('#side');
  if (!side || !S.cfg) return;
  const gs = groups();
  const live = liveJobs().filter((j) => LIVE.includes(j.state)).length;
  const seg = el('div', { class: 'seg sm' }, ...[['session', 'Session'], ['all', 'Tout']].map(([id, lab]) => el('button', {
    class: 'tb' + (S.hist === id ? ' on' : ''), title: id === 'session' ? 'ce qui a été fait depuis l’ouverture de cet onglet' : 'toutes les images de l’outil',
    onclick: () => { S.hist = id; saveDraft(); paintSide(); } }, lab)));
  const grid = el('div', { class: 'hist' });
  for (const g of gs) {
    const cells = [...g.items.slice().sort((a, b) => ms(a.created) - ms(b.created)).map(itemCell),
      ...g.jobs.slice().sort((a, b) => ms(a.created) - ms(b.created)).map(jobCell)];
    if (cells.length === 1) grid.append(cells[0]);
    else grid.append(el('div', { class: 'hgrp' + (g.jobs.some((j) => LIVE.includes(j.state)) ? ' live' : '') }, groupHead(g), el('div', { class: 'cells' }, ...cells)));
  }
  const top = side.scrollTop;
  side.replaceChildren(...[
    el('div', { class: 'side-h' },
      el('div', { class: 'ipan-h' }, el('span', { class: 'lbl' }, 'File · historique'),
        el('span', { class: 'r' + (live ? ' set' : '') }, live ? `${live} en cours` : el('a', { href: href('asset/') }, `${S.total} · Asset`))),
      seg),
    gs.length ? grid : el('p', { class: 'hint' }, S.hist === 'session'
      ? 'Rien encore dans cette session. Un rendu paraît ici dès l’envoi ; « Tout » montre les images d’avant.'
      : 'Un rendu paraît ici dès l’envoi, son image s’y pose en arrivant. Rien ne s’arrête quand on en regarde une autre.'),
    S.items.length < S.total && S.hist === 'all'
      ? el('button', { class: 'tb ghost sm block', onclick: () => loadHistory(S.items.length) }, `Plus — ${S.total - S.items.length} autres`) : null,
  ].filter(Boolean));
  side.scrollTop = top;
}

async function loadHistory(offset = 0) {
  let res;
  try { res = await api(`library?kind=image&tool=image&limit=120&offset=${offset}`); } catch (e) {
    $('#side').replaceChildren(el('p', { class: 'warn' }, e.message)); return;
  }
  const known = new Set(offset ? S.items.map((x) => x.id) : []);
  S.items = offset ? S.items.concat(res.items.filter((x) => !known.has(x.id))) : res.items;
  S.total = res.total;
  paintSide();
}

let paintT = null;
jobs.watch((list) => { lastList = list; clearTimeout(paintT); paintT = setTimeout(paintSide, 60); });
// un rendu fini ailleurs (un autre onglet, une relance) : ses images arrivent aussi
document.addEventListener('sr:job', async (e) => {
  const j = e.detail;
  if (j.tool !== 'image' || S.mine.has(j.id) || S.done.has(j.id)) return;
  if (j.state !== 'error') S.done.add(j.id);
  if (j.state === 'done') {
    try { const full = await jobs.get(j.id); if (full.items?.length) arrived(full.items, j.params?.batch); } catch { /* parti */ }
  }
  paintSide();
});

// un fichier lâché hors des emplacements ne doit pas faire quitter la page
addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); toast('déposez sur l’image au centre, sur les références ou sur l’image à éditer'); } });

// ── démarrage ───────────────────────────────────────────────
// Adresses : ?edit=<id> (d'Asset, d'Idéation) ouvre l'édition sur cet objet ;
// ?ref=<id> le met dans les références de « Créer » ; #<id> le montre.
async function resolveImage(id) {
  const it = await api('library/' + encodeURIComponent(id));
  if (it.kind === 'image') return it;
  // un élément : l'image d'où vient sa première référence, s'il y en a une
  const src = (it.element?.refs || []).find((r) => r.item);
  if (src) return api('library/' + src.item);
  throw new Error(`« ${it.title} » n’est pas une image`);
}

async function start() {
  $('#rail').replaceChildren(el('p', { class: 'lbl' }, 'chargement'));
  try { S.cfg = await api('image/models'); } catch (e) {
    $('#rail').replaceChildren(el('p', { class: 'warn' }, `le portail ne répond pas : ${e.message}`)); return;
  }
  const drafted = await loadDraft();
  const qs = new URLSearchParams(location.search);
  let want = (location.hash || '').slice(1) || drafted;
  if (qs.get('edit')) {
    try {
      const it = await resolveImage(qs.get('edit'));
      S.mode = 'edit'; S.edit.tool = 'instruct'; want = it.id;
    } catch (e) { toast(`édition : ${e.message}`, 7000); }
  }
  if (qs.get('ref')) {
    try {
      const it = await api('library/' + encodeURIComponent(qs.get('ref')));
      S.mode = 'create';
      if (!M(S.model).refs) S.model = 'krea2';
      if (!S.refs.some((r) => r.id === it.id)) S.refs = [...S.refs, it].slice(-M(S.model).refs);
    } catch (e) { toast(`référence : ${e.message}`, 7000); }
  }
  if (qs.get('edit') || qs.get('ref')) { try { history.replaceState(null, '', location.pathname + (want ? '#' + want : '')); } catch { /* sans historique */ } }
  if (!S.cfg.models.some((m) => m.id === S.model)) S.model = 'krea2';
  fixQuality();
  paintRail();
  paintSide();
  if (want) { try { await show(await api('library/' + want)); } catch { S.current = null; paintStage(); } } else paintStage();
  loadHistory();
  if (S.cfg.availability_error) toast(`machines : ${S.cfg.availability_error}`, 6000);
}
addEventListener('hashchange', async () => {
  const id = location.hash.slice(1);
  if (id && id !== S.current?.id) { try { pickShow(await api('library/' + id)); } catch { /* introuvable */ } }
});
start();
