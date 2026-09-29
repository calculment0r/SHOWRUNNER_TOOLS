// Image : créer et éditer des images photo avec Z-Image, Qwen-Image 2.1
// et Krea 2 ; caméra, objectif, ouverture, pellicule et lumière en
// pastilles ; les références (images, éléments, personnages de Character
// Factory) ; les outils d'édition, dont la zone peinte. Le serveur tient la
// seule vérité : modèles, tailles, pastilles et prompt envoyé viennent de
// /api/image/*.
//
// La page (Cal, 29/09, sur le modèle de Higgsfield) : les réglages à gauche
// — la même colonne que l'outil Vidéo, onglets Créer | Éditer —, le fil au
// centre (commun/fil.js), en grille : les rendus en file et en cours en tête,
// puis les images ; un clic ouvre la visionneuse plein écran, la molette passe
// d'une image à l'autre ; au survol, aimer, réutiliser, recréer, télécharger,
// et le menu ⋯ (le même au clic droit). « Réutiliser » recharge le prompt, les
// références, le modèle et les réglages dans le formulaire, graine vidée :
// « Générer » fait une variante.
//
// Tout emplacement qui attend une image accepte un dépôt (fichier du disque →
// bibliothèque, catégorie Upload ; ou une vignette glissée) : `dropZone` du
// socle ; toute vignette d'ici se glisse (`dragItem`).
import { mountHeader, api, jobs, pick, refBoard, toast, el, $, href, fmtDate, dropZone, dragItem } from '../commun/shell.js';
import { menu } from '../commun/menu.js';
import { createFil } from '../commun/fil.js';

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
  current: null, open: {},
  sent: '', notes: [],
  paint: { on: false, size: 48, canvas: null, for: null, dirty: false },
  // la file : ce que la page a lancé (suivi un à un), ce qui est arrivé, ce qu'on a retiré
  mine: new Map(), done: new Set(), gone: new Set(), lastList: [], session: new Date().toISOString(),
};
let fil = null;

// ── le brouillon : une commodité de ce navigateur ───────────
function saveDraft() {
  try {
    const { model, variant, prompt, looks, aspect, quality, count, seed, realism, transparent, refChoice, open, origSeed } = S;
    const edit = { ...S.edit, refs: S.edit.refs.map((r) => r.id) };
    localStorage.setItem(KEY, JSON.stringify({ model, variant, prompt, looks, aspect, quality, count, seed, realism, transparent, refChoice, open, origSeed,
      refs: S.refs.map((r) => r.id), edit, mode: S.mode, current: S.current?.id }));
  } catch { /* stockage fermé : rien à garder */ }
}
async function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { d = null; }
  if (!d) return null;
  for (const k of ['model', 'variant', 'prompt', 'looks', 'aspect', 'quality', 'count', 'seed', 'realism', 'transparent', 'refChoice', 'open', 'origSeed']) {
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
const ms = (iso) => Date.parse(iso || '') || 0;
const at = (e) => { const r = e.currentTarget.getBoundingClientRect(); return [r.left, r.bottom + 4]; };

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
  paintAct();
}
function paintSent(box) {
  box.replaceChildren(el('pre', { class: 'sent' }, S.sent || '—'));
}
const refsParam = (list) => list.map((it) => ({ item: it.id, ...(S.refChoice[it.id] ? { ref: S.refChoice[it.id] } : {}) }));

// ── le rail ─────────────────────────────────────────────────
function paintRail() {
  const r = $('#rail');
  const top = r.scrollTop;
  const seg = el('div', { class: 'seg mode', role: 'tablist' },
    el('button', { class: 'tb' + (S.mode === 'create' ? ' on' : ''), role: 'tab', onclick: () => setMode('create') }, 'Créer'),
    el('button', { class: 'tb' + (S.mode === 'edit' ? ' on' : ''), role: 'tab', onclick: () => setMode('edit') }, 'Éditer'));
  r.replaceChildren(seg, ...(S.mode === 'create' ? createPanels() : editPanels()));
  r.scrollTop = top;
  schedCompose();
}
function setMode(m) { S.mode = m; S.paint.on = false; saveDraft(); paintRail(); }

// la carte du modèle : son nom, ce qu'il fait, « Changer » (le menu des modèles)
function modelCard(ids, current, onpick, disabled = {}, extra = null) {
  const m = M(current);
  const change = el('button', { class: 'tb ghost sm', type: 'button', 'aria-haspopup': 'menu', title: 'choisir un autre modèle',
    onclick: (e) => {
      const [x, y] = at(e);
      menu(x, y, [{ head: 'Modèle' }, ...ids.map((id) => {
        const it = M(id);
        const off = disabled[id] || '';
        return { label: it.name, sub: it.refs ? `${it.refs} réf.` : 'texte seul', checked: current === id, disabled: !!off,
          why: off ? `${it.name} : ${off}` : '', title: it.role, onclick: () => onpick(id) };
      })]);
    } }, 'Changer');
  return el('section', { class: 'mcard' },
    el('div', { class: 'mc-h' }, el('span', { class: 'mk' }, m.k), el('span', { class: 'sp' }), change),
    el('b', {}, m.name), el('span', { class: 'role' }, m.role), extra);
}

// ── créer ───────────────────────────────────────────────────
function createPanels() {
  fixQuality();
  const m = M(S.model);
  const out = [];
  out.push(modelCard(['zimage', 'qwen21', 'krea2'], S.model, (id) => {
    S.model = id;
    if (S.refs.length > M(id).refs) S.refs = S.refs.slice(0, M(id).refs);
    fixQuality(); saveDraft(); paintRail();
  }, {}, variantRow(m)));
  out.push(refsPanel(m));

  const ta = el('textarea', { class: 'fld prompt', id: 'prompt', rows: 6, placeholder: promptHint(),
    oninput: (e) => { S.prompt = e.target.value; saveDraft(); schedCompose(); paintAct(); } });
  ta.value = S.prompt;
  out.push(pan('Prompt', 'en anglais', ta, tokenRow(ta, S.refs, 1)));

  // format, taille, nombre : trois pavés, chacun son menu (comme la barre de Higgsfield)
  const sizes = m.sizes[S.quality];
  const qLabel = m.quality.find((q) => q.id === S.quality)?.label || '';
  const wh = sizes[S.aspect];
  out.push(el('section', { class: 'params3' },
    pavé('Format', S.aspect, () => [{ head: `Format · ${qLabel}` }, ...S.cfg.aspects.map((a) => {
      const x = sizes[a];
      return { label: a, sub: x ? `${x[0]}×${x[1]}` : '', checked: S.aspect === a, disabled: !x,
        why: `${a} : non documenté en ${qLabel} pour ${m.name}`, onclick: () => { S.aspect = a; saveDraft(); paintRail(); } };
    })]),
    pavé('Taille', qLabel, () => [{ head: 'Taille' }, ...m.quality.map((q) => ({ label: q.label, checked: S.quality === q.id,
      onclick: () => { S.quality = q.id; fixQuality(); saveDraft(); paintRail(); } }))]),
    pavé('Nombre', String(S.count), () => [{ head: 'Images par envoi' }, ...[1, 2, 3, 4].map((n) => ({ label: plural(n, 'image'),
      sub: n > 1 ? 'graines qui se suivent' : '', checked: S.count === n, onclick: () => { S.count = n; saveDraft(); paintRail(); } }))]),
    el('p', { class: 'hint' }, `${wh ? wh.join(' × ') + ' · ' : ''}${sizeNote(m)}${S.count > 1 ? ` · ${S.count} travaux, les deux DGX les rendent en même temps` : ''}`)));

  const chosen = S.cfg.looks.map((g) => g.items.find((x) => x.id === S.looks[g.id])?.name).filter(Boolean);
  out.push(fold('looks', 'Prise de vue', chosen.join(' · '),
    el('div', { class: 'row' }, el('p', { class: 'hint' }, 'caméra, objectif, ouverture, pellicule, lumière : des phrases ajoutées au prompt'),
      el('button', { class: 'tb ghost sm', title: 'tout retirer', disabled: chosen.length ? null : true,
        onclick: () => { S.looks = {}; saveDraft(); paintRail(); } }, 'aucune')),
    ...S.cfg.looks.map((g) => lookGroup(g, S.looks, 'generate'))));
  out.push(advPanel(S));
  out.push(el('div', { class: 'act', id: 'act' }));
  setTimeout(paintAct);
  return out;
}

// un pavé de réglage : sa valeur, son menu
function pavé(label, value, items) {
  return el('button', { class: 'pb', type: 'button', 'aria-haspopup': 'menu', title: `${label} : choisir`,
    onclick: (e) => { const [x, y] = at(e); menu(x, y, items()); } },
  el('span', { class: 'lbl' }, label), el('b', {}, value || '—'));
}

// ce qui est avancé : la graine, et le prompt réellement envoyé
function advPanel(o) {
  const seed = el('input', { class: 'fld seed', inputmode: 'numeric', placeholder: 'au hasard', value: o.seed, title: 'la graine : la même graine et la même recette refont la même image',
    oninput: (e) => { o.seed = e.target.value.replace(/\D/g, ''); e.target.value = o.seed; saveDraft(); } });
  const box = el('div', { id: 'sent' });
  paintSent(box);
  const instruct = S.mode === 'create' || S.edit.tool === 'instruct';
  return fold('adv-' + S.mode, 'Avancé', o.seed ? `graine ${o.seed}` : 'graine au hasard',
    el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Graine'), el('span', { class: 'sp' }), seed,
      el('button', { class: 'tb ghost sm', title: 'une graine au hasard', onclick: () => { o.seed = String(Math.floor(Math.random() * 1e9)); seed.value = o.seed; saveDraft(); } }, 'dé'),
      o.origSeed != null ? el('button', { class: 'tb ghost sm', title: `la graine de l’image réutilisée : ${o.origSeed} — la même recette refait la même image`,
        onclick: () => { o.seed = String(o.origSeed); seed.value = o.seed; saveDraft(); } }, 'd’origine') : null),
    instruct ? el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'Prompt envoyé'), box) : null);
}

function paintAct() {
  const box = $('#act');
  if (!box) return;
  let label; let why; let info;
  const notes = (S.mode === 'create' || S.edit.tool === 'instruct') ? S.notes : [];
  const noteEls = notes.map((n) => el('p', { class: 'reason' }, n));
  if (S.mode === 'create') {
    const m = M(S.model);
    const a = avail(capCreate());
    why = !S.prompt.trim() ? 'écrivez un prompt' : !a.ok ? `modèle absent — ${a.why}` : '';
    label = S.count > 1 ? `Générer ${S.count} images` : 'Générer';
    const wh = m.sizes[S.quality]?.[S.aspect];
    info = `${m.name} · ${wh ? wh.join(' × ') : ''}${a.on?.length ? ' · ' + a.on.join(' + ') : ''}`;
    box.replaceChildren(...noteEls, el('button', { class: 'tb go block', disabled: why ? true : null, onclick: generate }, label),
      el('p', { class: why ? 'why' : 'hint' }, why || info));
    return;
  }
  const E = S.edit;
  const a = avail(capEdit());
  label = { instruct: (E.mask || (S.paint.dirty && S.paint.for === S.current?.id)) ? 'Éditer la zone' : 'Éditer', matte: 'Détourer', upscale: `Agrandir ×${E.factor}`,
    refine: 'Affiner ×2', angle: 'Tourner la caméra' }[E.tool] || 'Éditer';
  why = !S.current ? 'choisissez l’image à éditer' : !a.ok ? `modèle absent — ${a.why}`
    : (E.tool === 'instruct' && !E.prompt.trim()) ? 'écrivez une consigne' : '';
  box.replaceChildren(...noteEls, el('button', { class: 'tb go block', disabled: why ? true : null, onclick: editRun }, label),
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

// le panneau propre au modèle : ses variantes, ses options
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

function countRow(o, counts) {
  return pan('Nombre', null, el('div', { class: 'seg' }, ...counts.map((n) => el('button', { class: 'tb' + (o.count === n ? ' on' : ''),
    onclick: () => { o.count = n; saveDraft(); paintRail(); } }, String(n)))));
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

function setSource(it) {
  if (!it || it.kind !== 'image') return;
  if (S.current?.id !== it.id) { S.edit.mask = ''; if (S.paint.for !== it.id) clearPaint(); }
  S.current = it;
  saveDraft(); paintRail();
}

function editPanels() {
  const out = [];
  const src = S.current;
  const pickSrc = async () => { const [it] = await pick({ kinds: ['image'], title: 'L’image à éditer' }); if (it) setSource(it); };
  // l'emplacement de l'image à éditer : un dépôt (fichier ou vignette) la remplace
  const srcZone = (node) => dropZone(node, { kinds: ['image'], multiple: false, via: VIA, onitems: ([it]) => setSource(it) });
  if (!src || src.kind !== 'image') {
    out.push(srcZone(pan('Image à éditer', 'déposez-la ici',
      el('div', { class: 'dropslot' }, el('b', {}, '+'),
        el('span', {}, 'Glissez une image ici — un fichier de votre disque, ou une vignette du fil. Ou, sur une image du fil : ⋯ → Éditer.')),
      el('button', { class: 'tb ghost block', onclick: pickSrc }, 'Choisir dans la bibliothèque'))));
    out.push(el('div', { class: 'act', id: 'act' }));
    setTimeout(paintAct);
    return out;
  }
  out.push(srcZone(pan('Image à éditer', `${src.width || '?'} × ${src.height || '?'}`,
    el('div', { class: 'srcrow' }, dragItem(el('button', { class: 'srcim', type: 'button', title: 'la voir en grand — elle se glisse aussi vers les références',
      style: { backgroundImage: `url(${href(src.thumb_url || src.url)})` }, onclick: () => fil?.open(src) }), src),
    el('div', { class: 'srcnm' }, el('b', {}, src.title || src.id), el('small', {}, src.origin?.model || src.origin?.tool || '')),
    el('button', { class: 'tb ghost sm', onclick: pickSrc }, 'changer')),
    el('p', { class: 'hint' }, 'une autre image se dépose ici pour la remplacer'))));

  const E = S.edit;
  out.push(pan('Outil', null, el('div', { class: 'tools' }, ...S.cfg.edit_tools.map((t) => {
    const a = t.off ? { ok: false } : avail(t.id === 'instruct' ? (E.model === 'krea2' ? 'krea2:edit' : 'qwen21') : t.id);
    return el('button', { class: 'opt tool' + (E.tool === t.id ? ' on' : '') + (t.off ? ' off' : ''), title: t.off || (a.ok ? t.about : a.why),
      onclick: () => { E.tool = t.id; S.paint.on = false; saveDraft(); paintRail(); } },
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
    out.push(modelCard(['qwen21', 'krea2', 'zimage'], E.model, (id) => {
      E.model = id;
      const max = M(id).refs - 1;
      if (E.refs.length > max) E.refs = E.refs.slice(0, max);
      saveDraft(); paintRail();
    }, { zimage: 'n’édite pas par consigne (Z-Image-Edit n’est pas publié) — il sait affiner : outil « Affiner ×2 »' }));
    const ta = el('textarea', { class: 'fld prompt', id: 'prompt', rows: 5, placeholder: E.model === 'qwen21'
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
    out.push(countRow(E, [1, 2, 3, 4]));
    out.push(advPanel(E));
  } else if (E.tool === 'upscale') {
    out.push(pan('Facteur', null, el('div', { class: 'opts' }, ...[2, 4].map((f) => {
      const big = Math.max(src.width || 0, src.height || 0) * f;
      return el('button', { class: 'opt' + (E.factor === f ? ' on' : ''), disabled: big > 8192 ? true : null,
        title: big > 8192 ? 'plus de 8192 px' : '', onclick: () => { E.factor = f; saveDraft(); paintRail(); } }, `×${f}`,
      el('small', {}, `${(src.width || 0) * f} × ${(src.height || 0) * f}`));
    })), el('p', { class: 'hint' }, 'SeedVR2 7B en un pas : l’image agrandie en Lanczos puis restaurée, couleurs recalées sur l’originale (gabarit officiel ComfyUI, repris de Character Factory). Pour une vidéo, ou d’autres modèles : l’outil Upscale.')));
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
    out.push(countRow(E, [1, 2]));
    out.push(advPanel(E));
  } else if (E.tool === 'angle') {
    const A = S.cfg.angles;
    if (!E.azimuth) E.azimuth = A.azimuth[1][0];
    if (!E.elevation) E.elevation = 'eye-level shot';
    if (!E.distance) E.distance = 'medium shot';
    out.push(pan('Autour du sujet', A.azimuth.find(([id]) => id === E.azimuth)?.[1] || '', compass(A.azimuth, E)));
    const grp = (key, title, list) => pan(title, null, el('div', { class: 'opts' }, ...list.map(([id, name]) => el('button', {
      class: 'opt' + (E[key] === id ? ' on' : ''), title: id, onclick: () => { E[key] = id; saveDraft(); paintRail(); } }, name))));
    out.push(grp('elevation', 'Hauteur', A.elevation), grp('distance', 'Distance', A.distance));
    out.push(countRow(E, [1, 2, 3, 4]));
    out.push(pan('Prompt envoyé', null, el('pre', { class: 'sent' }, `<sks> ${E.azimuth} ${E.elevation} ${E.distance}`),
      el('p', { class: 'hint' }, 'LoRA fal Multiple-Angles sur Qwen-Image-Edit 2511 (Lightning 4 pas), Apache-2.0 ; les côtés sont ceux du sujet.')));
    out.push(advPanel(E));
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

// ── la zone peinte : un masque au pinceau sur l'image, à sa taille réelle ──
// On peint dans une grande fenêtre (l'image à sa place, en grand) ; le masque
// reste d'une ouverture à l'autre, jusqu'à « Effacer » ou une autre image.
function zonePanel() {
  const P = S.paint;
  const painted = P.dirty && P.for === S.current?.id;
  const reused = !painted && S.edit.mask;
  return pan('Zone', painted ? 'peinte' : reused ? 'reprise' : 'toute l’image',
    el('div', { class: 'row' },
      el('button', { class: 'tb ghost sm', onclick: openPaint }, painted ? 'Reprendre la zone' : 'Peindre une zone'),
      el('button', { class: 'tb ghost sm', disabled: painted || reused ? null : true,
        onclick: () => { clearPaint(); S.edit.mask = ''; saveDraft(); paintRail(); } }, 'Effacer')),
    reused ? el('p', { class: 'hint' }, 'la zone de l’image réutilisée : l’édition reprend le même masque ; « Peindre » en dessine une nouvelle') : null,
    el('p', { class: 'hint' }, 'Seule la zone peinte change : elle est éditée de près puis recollée, bord adouci — le reste de l’image ne bouge pas (méthode du report de visage de Character Factory).'));
}
function openPaint() {
  const it = S.current;
  if (!it) return;
  const P = S.paint;
  P.on = true;
  const cv = paintCanvas();
  const wrap = el('div', { class: 'imwrap' }, el('img', { src: href(it.url), alt: '', draggable: 'false' }), cv);
  const brush = el('input', { type: 'range', min: 8, max: 200, value: P.size, oninput: (e) => { P.size = Number(e.target.value); } });
  const close = () => {
    P.on = false; cv.classList.remove('on');
    if (P.dirty) S.edit.mask = '';   // une zone peinte remplace celle d'une image réutilisée
    scrim.remove(); document.removeEventListener('keydown', esc, true);
    saveDraft(); paintRail();
  };
  const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const scrim = el('div', { class: 'scrim paintm' }, el('div', { class: 'modal lg', role: 'dialog', 'aria-label': 'peindre la zone' },
    el('div', { class: 'modal-head' }, el('span', { class: 't' }, 'Peindre la zone à changer'), el('span', { class: 'sp' }),
      el('label', { class: 'brush' }, el('span', { class: 'lbl' }, 'pinceau'), brush),
      el('button', { class: 'tb ghost sm', onclick: () => clearPaint() }, 'Effacer'),
      el('button', { class: 'tb sm on', onclick: close }, 'Terminé')),
    el('div', { class: 'modal-body pm-body' }, wrap)));
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
  const btn = $('#act .tb.go');
  if (btn) btn.disabled = true;
  let r;
  try { r = await api(path, { method: 'POST', body }); } catch (e) { toast(e.message, 7000); paintAct(); return; }
  for (const j of r.jobs) follow(j);
  toast(r.jobs.length > 1 ? `${r.jobs.length} rendus en file — en tête du fil` : 'en file — en tête du fil');
  paintAct();
  fil?.paintJobs();
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
const TOOL_FR = { instruct: 'consigne', matte: 'détourer', upscale: 'agrandir', refine: 'affiner ×2', angle: 'angle' };

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
  wrap.append(imA, imB, handle, el('span', { class: 'cap a', title: 'déposez une autre image sur le cadre pour la comparer' }, 'avant · déposer pour changer'),
    el('span', { class: 'cap b' }, 'après'));
  set(50);
  return wrap;
}

// ── réutiliser, recréer, et le reste du menu ⋯ ──────────────
async function reuse(it) {
  const p = it.params || {};
  if (p.job === 'image.edit') return reuseEdit(it);
  Object.assign(S, { model: M(p.model) ? p.model : S.model, prompt: p.prompt || '', looks: { ...(p.looks || {}) }, aspect: p.aspect || S.aspect,
    quality: p.quality || S.quality, variant: p.variant || S.variant, realism: p.realism ?? S.realism, transparent: !!p.transparent,
    seed: '', origSeed: p.seed ?? null, mode: 'create' });
  S.refs = (await Promise.all((p.refs || []).map((r) => api('library/' + r.item).catch(() => null)))).filter(Boolean);
  for (const r of p.refs || []) if (r.ref) S.refChoice[r.item] = r.ref;
  const lost = (p.refs || []).length - S.refs.length;
  fixQuality(); saveDraft(); paintRail();
  $('#rail').scrollTop = 0;
  $('#prompt')?.focus();
  toast(`réglages repris${lost ? ` (${plural(lost, 'référence partie', 'références parties')} de la bibliothèque)` : ''} · graine vidée : « Générer » fait une variante`, 5000);
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
  S.edit = { ...S.edit, tool: p.tool, model: p.model || S.edit.model, prompt: p.tool === 'instruct' ? (p.prompt || '') : S.edit.prompt,
    looks: { ...(p.looks || {}) }, keepFace: p.keep_face ?? S.edit.keepFace, factor: p.factor || S.edit.factor, denoise: p.denoise ?? S.edit.denoise,
    azimuth: p.azimuth || S.edit.azimuth, elevation: p.elevation || S.edit.elevation, distance: p.distance || S.edit.distance,
    mask: p.mask || '', refs, seed: '', origSeed: p.seed ?? null };
  if (p.tool === 'refine') { S.edit.caption = p.prompt || ''; S.edit.captionFor = src.id; }
  saveDraft(); paintRail();
  $('#rail').scrollTop = 0;
  toast(`édition reprise (${TOOL_FR[p.tool] || p.tool}) sur la même source · graine vidée : une variante`, 5000);
}
async function redo(it, n) { await launch('image/redo', { item: it.id, variations: n }); }
function editWith(it, tool) {
  if (S.paint.for !== it.id) clearPaint();
  S.current = it; S.mode = 'edit'; S.edit.tool = tool; S.edit.mask = ''; S.paint.on = false;
  fil?.close();
  saveDraft(); paintRail();
  $('#rail').scrollTop = 0;
  toast(`à gauche : Éditer · ${TOOL_FR[tool]}`);
}
function useAsRef(it) {
  if (!M(S.model).refs) S.model = 'krea2';
  const max = M(S.model).refs;
  if (!S.refs.some((r) => r.id === it.id)) S.refs = [...S.refs, it].slice(-max);
  S.mode = 'create';
  fixQuality(); saveDraft(); paintRail();
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
  const huge = Math.max(it.width || 0, it.height || 0) * 2 > 8192;
  return [
    { label: 'Éditer', icon: '✎', items: [
      { label: 'Consigne', sub: 'qwen · krea', title: 'changer l’image par une phrase, sur tout ou une zone peinte', onclick: () => editWith(it, 'instruct') },
      { label: 'Détourer', sub: 'birefnet', onclick: () => editWith(it, 'matte') },
      { label: 'Agrandir ×2 · ×4', sub: 'seedvr2', disabled: huge, why: 'déjà trop grande : ×2 dépasserait 8192 px', onclick: () => editWith(it, 'upscale') },
      { label: 'Affiner ×2', sub: 'z-image', onclick: () => editWith(it, 'refine') },
      { label: 'Angle', sub: 'qwen-edit', onclick: () => editWith(it, 'angle') },
    ] },
    { label: 'Animer', icon: '▶', sub: 'vidéo', title: 'cette image en première image d’un plan (outil Vidéo)', onclick: go(`movie/?start=${id}`) },
    { label: 'Prendre en référence', icon: '+', items: [
      { label: 'ici, dans « Créer »', onclick: () => useAsRef(it) },
      { label: 'dans Vidéo', sub: '@image', onclick: go(`movie/?ref=${id}`) },
    ] },
    { label: 'Agrandir dans Upscale', icon: '⇱', onclick: go(`upscale/?src=${id}`) },
    { label: 'Envoyer au Montage', icon: '▤', onclick: go(`montage/?add=${id}`) },
    { label: 'Créer un élément', icon: '◆', items: ETYPES.map(([t, lab]) => ({ label: lab, onclick: () => makeElement(it, t) })) },
  ];
}

function mountFil() {
  fil = createFil($('#fil'), {
    id: 'image', layout: 'grid', title: 'Historique',
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
      el('button', { class: 'tb ghost', type: 'button', title: 'cette image en première image d’un plan (outil Vidéo)', onclick: go(`movie/?start=${it.id}`) }, 'Animer'),
      el('button', { class: 'tb ghost', type: 'button', title: 'l’ajouter aux références de « Créer »', onclick: () => { fil.close(); useAsRef(it); } }, 'Référence'),
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
    empty: 'Réglez à gauche, puis « Générer » : le rendu paraît ici dès l’envoi, son image s’y pose en arrivant. Une image déposée ici s’ouvre en grand.',
  });
  // une image déposée sur le fil (fichier ou vignette) s'ouvre en grand
  dropZone($('#fil'), { kinds: ['image'], multiple: false, via: VIA, onitems: ([it]) => fil.open(it) });
}

function paintBanner() {
  $('#banner').replaceChildren(...(stub() ? [el('div', { class: 'banner' }, el('b', {}, 'Moteur factice'),
    el('span', {}, 'les images sont des mires dessinées — aucun modèle n’est chargé. Le câblage réel est en place : « image_backend » : « comfyui » dans showrunner.local.json.'))] : []));
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
addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); toast('déposez sur le fil, sur les références ou sur l’image à éditer'); } });

// ── démarrage ───────────────────────────────────────────────
// Adresses : ?edit=<id> (d'Asset, d'Idéation) ouvre l'édition sur cet objet ;
// ?ref=<id> le met dans les références de « Créer » ; #<id> l'ouvre en grand.
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
  paintRail();
  paintBanner();
  mountFil();
  if (want) fil.open(want);
  if (S.cfg.availability_error) toast(`machines : ${S.cfg.availability_error}`, 6000);
}
addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (id && id !== fil?.current()?.id) fil?.open(id);
});
start();
