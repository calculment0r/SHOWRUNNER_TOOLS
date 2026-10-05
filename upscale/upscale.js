// Upscale : agrandir une image ou une vidéo, essai après essai, et comparer.
//
// Cal, 29/09 : « il faut une pile par image comme notre banc de comparaison
// de vidéo avec les settings par essai et aussi la barre de slide pour
// comparer. et même chose pour les vidéos » ; « au drag and drop, on
// détermine par le média ce qu'on veut upscale » ; « upscale créatif,
// upscale précis etc. pas les noms des modèles […] "paramètres avancés" en
// accordéon ».
//
// - Déposer (ou choisir dans Asset) une image ou une vidéo ouvre sa pile ; le
//   média choisit seul le chemin (image ou vidéo).
// - La pile (colonne de droite) : la source, puis chaque essai avec ses
//   réglages (préréglage, taille, les avancés touchés) ; A et B pour
//   comparer, rejouer, retirer (corbeille). Lue sur /api/upscale/pile/<id>.
// - Le moniteur (repris du banc NL de Cal) : rideau glissant, côte à côte, A,
//   B ; molette = zoom sous le curseur, bouton du milieu = déplacer,
//   double-clic = ajuster ; le zoom et la position sont les mêmes pour A et
//   B. Une vidéo : lecture synchronisée des deux, par le lecteur du portail
//   (commun/lecteur.js, son écran laissé à la page : sa barre, sa frise, sa
//   tête, son clavier, la copie de défilement de A et de B dans leur couche).
// - Les réglages : trois préréglages en mots simples ; « Paramètres avancés »
//   (fermé) montre le modèle et ses paramètres. La correspondance est sur le
//   serveur, seule (PRESETS de server/tools/upscale.py) ; toucher un avancé
//   passe en « Personnalisé ».
//
// L'annulation (commun/undo.js) : ouvrir, fermer un média, les réglages
// (instantanés) ; retirer un essai (corbeille, libTrash). Ne s'annulent pas :
// un envoi, un fichier déposé, la vue (des préférences, upscale/prefs.json).
import { mountHeader, api, jobs, pick, toast, el, $, href, fmtDur, uploadFile, dropAnywhere, dropZone, stateFr, dock, sorteEffective } from '../commun/shell.js';
import { createUndo, libTrash } from '../commun/undo.js';
import { prefs } from '../commun/prefs.js';
import { contextMenu, pageMenu, kebab } from '../commun/menu.js';
import { lecteur } from '../commun/lecteur.js';   // LE lecteur du portail : ici sans son écran (le moniteur A/B est à la page)

mountHeader('upscale', { sub: 'agrandir · comparer' });

const KEY = 'sr-upscale.v2';
const S = {
  cfg: null,
  piles: [],               // les sources ouvertes, objets de la bibliothèque
  cur: null,               // l'id de la source montrée
  trials: new Map(),       // source → ses essais (la pile, lue sur le serveur)
  sel: new Map(),          // source → { A, B } : ce que le moniteur compare
  pending: new Map(),      // travail → dernier relevé (en file, en cours, échec)
  preset: 'precis', base: null, size: 'x2', adv: { model: '', color: 'lab', denoise: 0.25, prompt: '' }, touched: [],
  advOpen: false,
  plan: null, planErr: '', sending: false,
  view: 'wipe', wipe: 50, loop: true, listen: 'b',
};

// ── petites aides ───────────────────────────────────────────
const M = (id) => S.cfg?.models.find((m) => m.id === id);
const P = (id) => S.cfg?.presets.find((p) => p.id === id);
const stub = () => S.cfg?.backend === 'stub';
const dims = (w, h) => (w && h ? `${w} × ${h}` : '?');
const comma = (x) => String(x).replace('.', ',');
const fmtS = (s) => (s == null ? '' : s < 60 ? `${comma(Math.max(0.1, Math.round(s * 10) / 10))} s` : s < 3600
  ? `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`);
const fmtGb = (g) => (g == null ? '' : `${g < 10 ? comma(g.toFixed(1)) : Math.round(g)} Go`);
const curItem = () => S.piles.find((i) => i.id === S.cur) || null;
const kindCur = () => curItem()?.kind || 'image';
const trialsOf = (id) => S.trials.get(id) || [];
const selOf = (id) => { if (!S.sel.has(id)) S.sel.set(id, { A: id, B: null }); return S.sel.get(id); };
// un objet de la pile courante : la source ou un essai
const byId = (id) => (id === S.cur ? curItem() : trialsOf(S.cur).find((t) => t.id === id) || null);
const put = (box, ...kids) => box.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false && k !== ''));
const head = (label, right) => el('div', { class: 'ipan-h' }, el('span', { class: 'lbl' }, label), right ? el('span', { class: 'r' }, right) : null);

// les tailles proposées : le facteur, ou une cible (les cibles du serveur)
function sizes(kind) {
  const t = S.cfg?.targets?.[kind] || [];
  return [['x2', '×2', { mode: 'factor', factor: 2 }], ['x4', '×4', { mode: 'factor', factor: 4 }],
    ...t.map((x) => [`t:${x.id}`, x.label.replace(' UHD', ''), { mode: 'target', [kind === 'image' ? 'target_image' : 'target_video']: x.id }, x.sub])];
}
function sizeBody(kind = kindCur()) {
  const got = sizes(kind).find((s) => s[0] === S.size) || sizes(kind)[0];
  return { mode: 'factor', factor: 2, target_image: '4k', target_video: '1080p', ...got[2] };
}
// les réglages d'un préréglage pour une sorte de média (la table du serveur)
const presetSet = (id, kind = kindCur()) => P(id)?.[kind] || null;

// ── l'annulation, la mémoire de ce navigateur ───────────────
const U = createUndo({ name: 'upscale', onapply: () => { if (S.cur) loadPile(S.cur); } });
let doc = null;   // posé au démarrage : l'ouverture n'est pas un geste
let typing = 0;
const known = new Map();   // id → objet, pour reposer une pile fermée
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  save(commit = true) {
    try {
      const { preset, base, size, adv, touched, cur, advOpen } = S;
      localStorage.setItem(KEY, JSON.stringify({ preset, base, size, adv, touched, cur, advOpen, piles: S.piles.map((i) => i.id) }));
    } catch { /* stockage fermé */ }
    if (commit) doc?.commit();
  },
};
const docState = () => ({ preset: S.preset, base: S.base, size: S.size, adv: { ...S.adv }, touched: [...S.touched], piles: S.piles.map((i) => i.id) });
function docRestore(s) {
  Object.assign(S, { preset: s.preset, base: s.base, size: s.size, adv: { ...s.adv }, touched: [...s.touched] });
  S.piles = s.piles.map((id) => known.get(id)).filter(Boolean);
  if (!S.piles.some((i) => i.id === S.cur)) S.cur = S.piles[0]?.id || null;
  store.save(false);
  paintAll();
}
function docDescribe(b, a) {
  if (b.piles.join() !== a.piles.join()) {
    const plus = a.piles.filter((x) => !b.piles.includes(x)), minus = b.piles.filter((x) => !a.piles.includes(x));
    const t = (l) => (l.length > 1 ? `${l.length} médias` : `« ${known.get(l[0])?.title || l[0]} »`);
    return { label: plus.length && !minus.length ? `ouvrir ${t(plus)}` : minus.length && !plus.length ? `fermer ${t(minus)}` : 'changer les médias' };
  }
  if (b.preset !== a.preset && a.preset !== 'custom') return { label: `choisir « ${P(a.preset)?.label || a.preset} »` };
  if (b.size !== a.size) return { label: `taille ${sizes(kindCur()).find((x) => x[0] === a.size)?.[1] || a.size}` };
  if (b.adv.denoise !== a.adv.denoise) return { label: 'régler le débruitage', merge: 'denoise' };
  if (b.adv.prompt !== a.adv.prompt) return { label: 'écrire la description', merge: `prompt#${typing}`, mergeMs: Infinity };
  if (b.adv.model !== a.adv.model) return { label: `choisir ${M(a.adv.model)?.name || a.adv.model}` };
  if (b.adv.color !== a.adv.color) return { label: 'changer la couleur' };
  return { label: 'modifier les réglages' };
}

// ── le squelette ────────────────────────────────────────────
const fileIn = el('input', { type: 'file', multiple: true, accept: 'image/*,video/*', hidden: true, onchange: async () => { await addFiles([...fileIn.files]); fileIn.value = ''; } });
function skeleton() {
  $('#rail').replaceChildren(
    el('div', { class: 'row up-undo' }, el('span', { class: 'lbl' }, 'Médias'), el('span', { class: 'sp' }),
      el('span', { class: 'sr-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, ...U.buttons())),
    el('div', { class: 'mtiles', id: 'tiles' }),
    el('section', { class: 'ipan', id: 'p-set' }),
    el('div', { class: 'act', id: 'act' }), fileIn);
  $('#stage').replaceChildren(el('div', { class: 'vtools', id: 'vtools' }), el('div', { class: 'monitor upm', id: 'mon', tabindex: '0' }),
    el('div', { id: 'transport' }));
  $('#side').replaceChildren(el('p', { class: 'lbl' }, 'chargement'));
}
function paintAll() { paintTiles(); paintSettings(); paintAct(); paintPile(); paintMonitor(); schedPlan(); }

// ── les médias : une pile chacun ────────────────────────────
function paintTiles() {
  put($('#tiles'), ...S.piles.map((it) => {
    const n = trialsOf(it.id).length;
    return el('button', { class: 'mtile' + (it.id === S.cur ? ' on' : ''), type: 'button', title: it.title || it.id, 'data-id': it.id,
      style: { backgroundImage: it.thumb_url ? `url("${href(it.thumb_url)}")` : null }, onclick: () => setCur(it.id) },
    it.kind === 'video' ? el('span', { class: 'k' }, 'vidéo') : null,
    n ? el('span', { class: 'n' }, String(n)) : null);
  }), el('button', { class: 'mtile add', type: 'button', title: 'une image ou une vidéo : de la bibliothèque ou du disque (ou déposez-la n’importe où)', onclick: choose }, '+'));
}
async function choose() {
  const got = await pick({ kinds: ['image', 'video'], multiple: true, title: 'Une image ou une vidéo à agrandir' });
  openItems(got);
}
const MEDIA_RX = /\.(png|jpe?g|webp|mp4|webm|mov|m4v)$/i;
async function addFiles(files) {
  const ok = files.filter((f) => /^(image|video)\//.test(f.type) || MEDIA_RX.test(f.name));
  if (ok.length < files.length) toast('seules les images et les vidéos s’agrandissent ici', 5000);
  const got = [];
  for (const f of ok) {
    toast(`dépôt · ${f.name}`, 60000);
    try { got.push(await uploadFile(f, { tool: 'upload', via: 'upscale' })); } catch (e) { toast(`${f.name} : ${e.message}`, 6000); }
  }
  if (got.length) toast(got.length > 1 ? `${got.length} fichiers rangés dans la bibliothèque` : 'rangé dans la bibliothèque');
  openItems(got);
}
function openItems(list) {
  const ok = (list || []).filter((it) => it && (it.kind === 'image' || it.kind === 'video'));
  if ((list || []).length > ok.length) toast('un élément ou un son ne s’agrandit pas', 5000);
  if (!ok.length) return;
  for (const it of ok) {
    known.set(it.id, it);
    if (!S.piles.some((x) => x.id === it.id)) S.piles.push(it);
  }
  S.cur = ok[0].id;
  syncKind();
  store.save();
  for (const it of ok) loadPile(it.id);
  resetZoom();
  paintAll();
}
// le panneau Asset (commun/dock.js, Ctrl+Espace) : poser ouvre la pile du média,
// comme un dépôt sur le moniteur ou sur les médias ; ses filtres : images, vidéos.
// Un élément versionné dont la dernière version est une image ou une vidéo donne
// cette version, comme le fait dropZone (commun/shell.js).
const MEDIA = ['image', 'video'];
async function lastVersion(it) {
  if (it.kind !== 'element' || !MEDIA.includes(sorteEffective(it)) || !it.element?.head_item) return it;
  try { return await api('library/' + it.element.head_item); } catch { return it; }
}
dock.configure({
  kinds: MEDIA,
  label: 'les médias à agrandir',
  placeLabel: 'Ouvrir sa pile',
  hint: 'double-clic : ouvrir sa pile · glisser : sur le moniteur ou sur les médias',
  place: async (items) => {
    const got = await Promise.all(items.map(lastVersion));
    openItems(got);
    return got.some((it) => MEDIA.includes(it.kind));
  },
});
function closePile(id) {
  S.piles = S.piles.filter((x) => x.id !== id);
  if (S.cur === id) { S.cur = S.piles[0]?.id || null; resetZoom(); syncKind(); }
  store.save();
  paintAll();
}
function setCur(id) {
  if (id === S.cur) return;
  S.cur = id;
  syncKind();
  resetZoom();
  store.save(false);
  if (!S.trials.has(id)) loadPile(id);
  paintAll();
}
async function loadPile(id) {
  let r;
  try { r = await api('upscale/pile/' + id); } catch (e) { if (id === S.cur) toast(e.message, 6000); return; }
  known.set(id, r.source);
  S.piles = S.piles.map((x) => (x.id === id ? r.source : x));
  const before = trialsOf(id).map((t) => t.id).join();
  S.trials.set(id, r.trials);
  const s = selOf(id);
  const ids = new Set([id, ...r.trials.map((t) => t.id)]);
  if (!ids.has(s.A)) s.A = id;
  if (s.B && !ids.has(s.B)) s.B = null;
  if (!s.B && r.trials.length && !s.chosen) s.B = r.trials[r.trials.length - 1].id;
  paintTiles();
  if (id === S.cur) { paintPile(); if (before !== r.trials.map((t) => t.id).join() || !monOk()) paintMonitor(); }
}

// ── les réglages ────────────────────────────────────────────
// le média a changé de sorte : le préréglage suit (un préréglage sans cette
// sorte revient à « précis ») ; un modèle personnalisé qui ne la prend pas
// revient au défaut du serveur pour elle
function syncKind() {
  const kind = kindCur();
  if (!S.cfg) return;
  if (S.preset !== 'custom') {
    if (!presetSet(S.preset, kind)) S.preset = 'precis';
    S.adv = { ...presetSet(S.preset, kind) };
  } else if (!M(S.adv.model)?.kinds.includes(kind)) {
    S.adv = { ...S.adv, model: S.cfg.default[kind] };
  }
  if (!sizes(kind).some((s) => s[0] === S.size)) S.size = 'x2';
}
function setPreset(id) {
  const why = presetOff(id);
  if (why) { toast(why, 7000); return; }
  S.preset = id; S.base = null; S.touched = [];
  S.adv = { ...presetSet(id) };
  if (M(S.adv.model)?.max_factor && sizeBody().mode === 'factor' && sizeBody().factor > M(S.adv.model).max_factor) S.size = 'x2';
  store.save(); paintSettings(); schedPlan();
}
// toucher un avancé : le préréglage devient « Personnalisé »
function setAdv(k, v, repaint = true) {
  if (S.preset !== 'custom') { S.base = S.preset; S.preset = 'custom'; }
  S.adv = { ...S.adv, [k]: v };
  if (!S.touched.includes(k)) S.touched = [...S.touched, k];
  store.save();
  if (repaint) paintSettings();
  schedPlan();
}
const presetOff = (id) => (presetSet(id) ? '' : P(id)?.off?.[kindCur()] || 'pas pour ce média');
// ce que les machines savent faire (câblage réel) ; en factice, rien ne bloque
function modelOff(m) {
  if (m.off) return m.off;
  if (stub()) return '';
  const a = (m.availability || {})[kindCur()];
  if (!a || a.on.length) return '';
  const miss = Object.entries(a.missing).map(([mm, v]) => `${mm} : ${v.slice(0, 3).join(', ')}`).join(' · ');
  return `aucune machine ne peut le faire (${miss || 'aucune ne répond'})`;
}

function paintSettings() {
  const box = $('#p-set');
  const kind = kindCur();
  const m = M(S.adv.model);
  const card = (p) => {
    const why = presetOff(p.id);
    return el('button', { class: 'opt preset' + (S.preset === p.id ? ' on' : '') + (why ? ' off' : ''), type: 'button',
      'aria-disabled': why ? 'true' : null, title: why || null, onclick: () => setPreset(p.id) },
    el('b', {}, p.label), el('span', {}, why ? `pas pour une ${kindCur() === 'video' ? 'vidéo' : 'image'}` : p.about));
  };
  const custom = S.preset === 'custom'
    ? el('div', { class: 'opt preset on custom' }, el('b', {}, 'Personnalisé'), el('span', {}, S.base ? `d’après « ${P(S.base)?.label} »` : 'réglé à la main'))
    : null;
  const gan = m?.max_factor;
  const size = m?.fixed
    ? el('p', { class: 'fixed', title: 'l’affinage ramène l’image à 1 Mpx puis la double' }, el('span', { class: 'lbl' }, 'Taille'), el('span', {}, 'fixe · ≈ 4 Mpx'))
    : el('div', { class: 'seg sz', role: 'group', 'aria-label': 'taille' }, ...sizes(kind).map(([id, lab, b, sub]) => {
      const off = gan && b.mode === 'factor' && b.factor > gan;
      return el('button', { class: 'tb' + (S.size === id ? ' on' : ''), type: 'button', disabled: off || null,
        title: off ? `×${gan} au plus avec ${S.preset === 'custom' ? m.name : 'ce préréglage'}` : sub || null,
        onclick: () => { S.size = id; store.save(); paintSettings(); schedPlan(); } }, lab);
    }));
  put(box,
    head('Réglages', stub() ? el('span', { class: 'fake', title: 'moteur factice : les essais sont des agrandissements bicubiques étiquetés « FACTICE » — le câblage des modèles se branche dans Admin → Câblage' }, 'factice') : null),
    el('div', { class: 'presets' }, ...S.cfg.presets.map(card), custom),
    size,
    advanced(kind, m));
}
function advanced(kind, m) {
  const d = el('details', { class: 'adv', open: S.advOpen || null });
  d.addEventListener('toggle', () => { S.advOpen = d.open; store.save(false); });
  const models = S.cfg.models.filter((x) => x.retained && x.kinds.includes(kind));
  const kids = [
    el('span', { class: 'lbl' }, 'Modèle'),
    el('div', { class: 'models' }, ...models.map((x) => {
      const why = modelOff(x);
      return el('button', { class: 'opt model' + (x.id === S.adv.model ? ' on' : '') + (why ? ' off' : ''), type: 'button',
        'aria-disabled': why ? 'true' : null, title: `${why ? why + '\n' : ''}${x.role}\nsource : ${x.src}`,
        onclick: () => (why ? toast(`${x.name} : ${why}`, 7000) : setAdv('model', x.id)) },
      el('b', {}, x.name), el('small', {}, x.way));
    })),
  ];
  if (m?.id.startsWith('seedvr2')) {
    kids.push(el('span', { class: 'lbl' }, 'Couleur'),
      el('div', { class: 'opts four' }, ...S.cfg.colors.map((c) => el('button', { class: 'opt' + (c.id === S.adv.color ? ' on' : ''), type: 'button', title: c.about,
        onclick: () => setAdv('color', c.id) }, c.name))));
  }
  if (m?.id === 'zimage-refine') {
    const dn = S.cfg.denoise;
    const val = el('span', { class: 'val' }, comma(S.adv.denoise.toFixed(2)));
    const ta = el('textarea', { class: 'fld', rows: 2, placeholder: 'description, en anglais (facultatif)',
      oninput: (e) => setAdv('prompt', e.target.value, false) });
    ta.value = S.adv.prompt || '';
    kids.push(el('span', { class: 'lbl', title: `conseillé ${comma(dn.advice[0])}–${comma(dn.advice[1])} (note du gabarit) : au-delà, des défauts` }, 'Débruitage'),
      el('div', { class: 'slide' }, el('span', { class: 'end' }, 'fidèle'),
        el('input', { type: 'range', min: dn.min, max: dn.max, step: 0.01, value: S.adv.denoise, 'aria-label': 'débruitage',
          oninput: (e) => { val.textContent = comma((+e.target.value).toFixed(2)); setAdv('denoise', +e.target.value, false); } }),
        el('span', { class: 'end' }, 'créatif'), val),
      el('span', { class: 'lbl' }, 'Description'), ta);
  }
  d.replaceChildren(el('summary', {}, el('span', { class: 'lbl' }, 'Paramètres avancés'),
    S.preset === 'custom' ? el('span', { class: 'r' }, 'touchés') : null), el('div', { class: 'advin' }, ...kids));
  return d;
}

// ── avant l'envoi ───────────────────────────────────────────
let planT = null, planSeq = 0;
function schedPlan() { clearTimeout(planT); planT = setTimeout(doPlan, 160); }
const body = (items) => ({ items, preset: S.preset, base: S.base, touched: S.touched, ...S.adv, ...sizeBody() });
async function doPlan() {
  const seq = ++planSeq;
  if (!S.cur || !S.cfg) { S.plan = null; S.planErr = ''; paintAct(); return; }
  try {
    const p = await api('upscale/plan', { method: 'POST', body: body([S.cur]) });
    if (seq !== planSeq) return;
    S.plan = p.rows[0] || null; S.planErr = '';
  } catch (e) { if (seq !== planSeq) return; S.plan = null; S.planErr = e.message; }
  paintAct();
}
function paintAct() {
  const box = $('#act');
  const r = S.plan;
  const why = !S.cur ? 'déposez une image ou une vidéo' : S.planErr || (r && !r.ok ? r.why : '');
  const est = r?.ok ? [`→ ${dims(r.out[0], r.out[1])}`, r.est?.s != null ? `≈ ${fmtS(r.est.s)}` : ''].filter(Boolean).join(' · ') : '';
  const tip = r?.ok ? [r.mem && `mémoire ${r.mem.floor ? '≥' : '≈'} ${fmtGb(r.mem.gb)}${r.mem.chunks > 1 ? ` (${r.mem.chunks} morceaux)` : ''} — ${r.mem.how}`,
    r.est && `temps : ${r.est.how}`].filter(Boolean).join('\n') : '';
  put(box,
    el('button', { class: 'tb go block', type: 'button', disabled: !!why || !r || S.sending || null, onclick: () => launch() }, S.sending ? 'Envoi…' : 'Upscaler'),
    why ? el('div', { class: 'why' }, why) : est ? el('div', { class: 'est', title: tip }, est) : null);
}
async function launch(b = body([S.cur])) {
  S.sending = true; paintAct();
  let r;
  try { r = await api('upscale/run', { method: 'POST', body: b }); } catch (e) { S.sending = false; toast(e.message, 8000); paintAct(); return; }
  S.sending = false;
  for (const j of r.jobs) follow({ ...j, params: j.params || { source: j.source } });
  if (r.skipped.length) toast(r.skipped[0].why, 7000);
  paintAct(); paintPile();
}
// rejouer un essai : ses réglages, une nouvelle graine
function replayBody(t) {
  const p = t.params || {};
  return { items: [S.cur], preset: p.preset || 'custom', base: p.base || null, touched: p.touched || [], model: p.model,
    color: p.color || 'lab', denoise: p.denoise ?? 0.25, prompt: p.prompt || '',
    mode: p.mode === 'fixed' ? 'factor' : p.mode || 'factor', factor: p.factor || 2, target_image: p.target_image || '4k', target_video: p.target_video || '1080p' };
}
function takeSettings(t) {
  const b = replayBody(t);
  S.preset = P(b.preset) ? b.preset : 'custom';
  S.base = b.base; S.touched = [...b.touched];
  S.adv = S.preset === 'custom' ? { model: b.model, color: b.color, denoise: b.denoise, prompt: b.prompt } : { ...presetSet(S.preset) };
  S.size = b.mode === 'target' ? `t:${kindCur() === 'image' ? b.target_image : b.target_video}` : `x${b.factor}`;
  syncKind(); store.save(); paintSettings(); schedPlan();
  toast('réglages repris');
}

// ── les travaux ─────────────────────────────────────────────
function follow(j) {
  if (S.pending.has(j.id) && S.pending.get(j.id).following) return;
  S.pending.set(j.id, { ...j, following: true });
  jobs.wait(j.id, (t) => { S.pending.set(t.id, { ...t, following: true }); paintPileSoon(); }).then(async (done) => {
    const src = done.params?.source;
    if (done.state === 'done') {
      S.pending.delete(done.id);
      const out = done.items?.[0];
      if (src && out) { const s = selOf(src); s.B = out.id; s.chosen = true; if (!s.A) s.A = src; }
      if (src) await loadPile(src);
      if (src === S.cur) paintMonitor();
      schedPlan();   // un rendu mesuré de plus : le temps estimé se précise
    } else {
      S.pending.set(done.id, done);
      if (done.state === 'error') toast(`échec : ${done.message}`, 8000);
      paintPile();
    }
  }).catch(() => {});
}
jobs.watch((list) => {
  for (const j of list) {
    if (j.tool !== 'upscale' || !['queued', 'running'].includes(j.state)) continue;
    if (!S.pending.has(j.id) && S.piles.some((x) => x.id === j.params?.source)) follow(j);
  }
});
let pileT = null;
function paintPileSoon() { clearTimeout(pileT); pileT = setTimeout(paintPile, 200); }

// ── la pile ─────────────────────────────────────────────────
// ce qu'un essai a été : le préréglage, la taille, et les avancés touchés
function recipe(t) {
  const p = t.params || {};
  const pr = P(p.preset);
  const what = pr ? pr.short : p.preset === 'custom' ? (P(p.base) ? `${P(p.base).short}, modifié` : 'Personnalisé') : M(p.model)?.name || p.model || '';
  const extra = [];
  const touched = p.preset === 'custom' ? (p.touched || []) : [];
  if (touched.includes('model') || (p.preset === 'custom' && !p.base)) extra.push(M(p.model)?.name || p.model);
  if (touched.includes('color')) extra.push(`couleur ${S.cfg.colors.find((c) => c.id === p.color)?.name || p.color}`);
  if (touched.includes('denoise')) extra.push(`débruitage ${comma(p.denoise)}`);
  if (touched.includes('prompt') && p.prompt) extra.push('description');
  return [what, p.label, ...extra].filter(Boolean).join(' · ');
}
const isFake = (t) => /factice/.test(t.origin?.model || '');
function paintPile() {
  const side = $('#side');
  const src = curItem();
  if (!src) { put(side, head('Pile'), el('p', { class: 'hint' }, 'Chaque média a sa pile : la source, puis ses essais.')); return; }
  const s = selOf(src.id);
  const list = trialsOf(src.id);
  const pend = [...S.pending.values()].filter((j) => j.params?.source === src.id).sort((a, b) => (a.created < b.created ? -1 : 1));
  const ab = (id, has = true) => [['A', 'isA'], ['B', 'isB']].map(([k, cls]) => el('button', { class: 'ab' + (s[k] === id ? ' ' + cls : ''), type: 'button',
    disabled: !has || null, title: `montrer en ${k}`, onclick: (e) => { e.stopPropagation(); setSlot(k, id); } }, k));
  const row = (it, n) => {
    const trial = n > 0;
    const sub = trial ? recipe(it) : `source · ${it.kind === 'video' ? 'vidéo' : 'image'}`;
    const meta = [dims(it.width, it.height), it.duration && !trial ? fmtDur(it.duration) : '', trial && it.render_s ? fmtS(it.render_s) : '', trial && isFake(it) ? 'factice' : ''].filter(Boolean).join(' · ');
    return el('div', { class: 'prow' + (s.A === it.id ? ' selA' : '') + (s.B === it.id ? ' selB' : ''), role: 'button', tabindex: '0', 'data-id': it.id,
      onclick: () => setSlot(trial ? 'B' : 'A', it.id), onkeydown: (e) => { if (e.key === 'Enter') setSlot(trial ? 'B' : 'A', it.id); } },
    el('div', { class: 'th', style: { backgroundImage: it.thumb_url ? `url("${href(it.thumb_url)}")` : null } }),
    el('div', { class: 'tx' }, el('b', {}, trial ? `Essai ${n}` : 'Source'), el('span', { class: 'rc' }, sub), el('small', {}, meta)),
    el('div', { class: 'acts' }, ...ab(it.id), kebab(() => rowItems(it, n), { title: 'plus' })));
  };
  const prow = (j, n) => {
    const live = j.state === 'queued' || j.state === 'running';
    const p = j.params || {};
    return el('div', { class: 'prow pend' + (j.state === 'error' ? ' err' : '') },
      el('div', { class: 'th', style: { backgroundImage: src.thumb_url ? `url("${href(src.thumb_url)}")` : null } }),
      el('div', { class: 'tx' }, el('b', {}, `Essai ${n}`), el('span', { class: 'rc' }, recipe({ params: p })),
        el('small', {}, live ? (j.state === 'running' && j.progress != null ? `${Math.round(j.progress * 100)} %` : stateFr(j.state)) : `${stateFr(j.state)}${j.message ? ' — ' + j.message : ''}`)),
      el('div', { class: 'acts' }, live
        ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => jobs.cancel(j.id) }, 'Arrêter')
        : [el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => { S.pending.delete(j.id); follow(await jobs.retry(j.id)); } }, 'Relancer'),
          el('button', { class: 'x', type: 'button', title: 'l’oublier', onclick: () => { S.pending.delete(j.id); paintPile(); } }, '×')]),
      live ? el('div', { class: 'bar' }, el('i', { style: { width: j.progress != null ? `${Math.round(j.progress * 100)}%` : '100%', opacity: j.progress != null ? 1 : 0.35 } })) : null);
  };
  put(side, head('Pile', `${list.length} essai${list.length > 1 ? 's' : ''}`),
    el('div', { class: 'ptitle', title: src.title || src.id }, src.title || src.id),
    el('div', { class: 'plist' }, row(src, 0), ...list.map((t, i) => row(t, i + 1)), ...pend.map((j, i) => prow(j, list.length + i + 1))));
}
function setSlot(k, id) {
  const s = selOf(S.cur);
  s[k] = id;
  if (k === 'B') s.chosen = true;
  paintPile(); paintMonitor();
}
function download(it) {
  const ext = (it.file || '.png').slice((it.file || '.png').lastIndexOf('.'));
  const a = el('a', { href: href(it.url), download: `${(it.title || it.id).replace(/[^\w.-]+/g, '_').slice(0, 60)}${ext}` });
  document.body.append(a); a.click(); a.remove();
}
const goTo = (u) => () => { location.href = href(u); };
function rowItems(it, n) {
  const s = selOf(S.cur);
  const lib = [{ label: 'Ouvrir dans la bibliothèque', icon: '▦', onclick: goTo('asset/#' + it.id) },
    { label: 'Envoyer au montage', icon: '▤', onclick: goTo('montage/?add=' + encodeURIComponent(it.id)) },
    { label: 'Télécharger', icon: '↓', onclick: () => download(it) }];
  if (!n) {
    return [{ head: 'la source' }, { label: 'Montrer en A', icon: 'A', checked: s.A === it.id, onclick: () => setSlot('A', it.id) }, '-', ...lib, '-',
      { label: 'Fermer ce média', icon: '×', sub: 'il reste dans la bibliothèque', onclick: () => closePile(it.id) }];
  }
  return [{ head: `essai ${n} · ${recipe(it)}` },
    { label: 'Montrer en A', icon: 'A', checked: s.A === it.id, onclick: () => setSlot('A', it.id) },
    { label: 'Montrer en B', icon: 'B', checked: s.B === it.id, onclick: () => setSlot('B', it.id) },
    '-',
    { label: 'Rejouer', icon: '↻', sub: 'les mêmes réglages', onclick: () => launch(replayBody(it)) },
    { label: 'Reprendre ces réglages', icon: '⤓', onclick: () => takeSettings(it) },
    '-', ...lib, '-',
    { label: 'Retirer de la pile', icon: '×', sub: 'à la corbeille', onclick: () => retire(it, n) }];
}
async function retire(it, n) {
  try { await libTrash(U, it, `retirer l’essai ${n}`); } catch (e) { toast(e.message, 6000); return; }
  await loadPile(S.cur);
}

// ── le moniteur (le banc NL de Cal) ─────────────────────────
// Le zoom et la position sont les mêmes pour A et B : un décalage relatif à
// la couche (qui fait la moitié du moniteur en côte à côte) et un facteur.
const Z = { z: 1, x: 0, y: 0 };
const V = { a: null, b: null, itA: null, itB: null, drag: null, lect: null, key: '' };
const mon = () => $('#mon');
const monOk = () => { const s = S.cur && selOf(S.cur); return !!s && V.key === `${S.cur}|${s.A}|${s.B}`; };
function resetZoom() { Z.z = 1; Z.x = 0; Z.y = 0; }
function media(it) {
  if (it.kind === 'video') {
    const v = el('video', { src: href(it.url), playsinline: true, preload: 'auto', loop: S.loop || null });
    v.muted = true;
    v.addEventListener('loadedmetadata', applyZoom);
    return v;
  }
  const im = el('img', { src: href(it.url), alt: '', draggable: 'false' });
  im.addEventListener('load', applyZoom);
  return im;
}
const label = (id) => {
  if (id === S.cur) return 'Source';
  const n = trialsOf(S.cur).findIndex((t) => t.id === id);
  return n < 0 ? '' : `Essai ${n + 1}`;
};
function paintMonitor() {
  const box = mon();
  const src = curItem();
  V.lect?.detruire(); V.lect = null;
  V.a = V.b = null; V.itA = V.itB = null;
  if (!src) {
    V.key = '';
    box.className = 'monitor upm empty';
    box.replaceChildren(el('div', { class: 'empty' }, el('b', {}, 'Déposez une image ou une vidéo'),
      el('div', { class: 'row' }, el('button', { class: 'tb ghost', type: 'button', onclick: choose }, 'Bibliothèque'),
        el('button', { class: 'tb ghost', type: 'button', onclick: () => fileIn.click() }, 'Depuis le disque'))));
    $('#transport').replaceChildren(); paintTools();
    return;
  }
  const s = selOf(src.id);
  const A = byId(s.A) || src, B = s.B && s.B !== A.id ? byId(s.B) : null;
  const t0 = V.t || 0;
  V.key = `${src.id}|${s.A}|${s.B}`;
  V.itA = A; V.itB = B;
  V.a = media(A);
  const kids = [el('div', { class: 'layer a' }, el('div', { class: 'zs' }, V.a))];
  if (B) {
    V.b = media(B);
    kids.push(el('div', { class: 'layer b' }, el('div', { class: 'zs' }, V.b)),
      el('div', { class: 'handle', role: 'slider', 'aria-label': 'rideau', 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('span', { class: 'grip' }, el('i'), el('i'))));
  }
  const tag = (k, it) => el('div', { class: 'tag ' + k.toLowerCase() }, el('b', {}, k),
    el('span', {}, [label(it.id), it.id !== src.id ? recipe(it) : '', dims(it.width, it.height)].filter(Boolean).join(' · ')));
  kids.push(tag('A', A));
  if (B) kids.push(tag('B', B));
  box.className = `monitor upm mode-${B ? S.view : 'solo'}`;
  box.replaceChildren(...kids);
  if (B) setWipe(S.wipe);
  applyZoom();
  paintTools();
  if (src.kind === 'video') wireVideo(t0); else $('#transport').replaceChildren();
}
function paintTools() {
  const box = $('#vtools');
  const s = S.cur ? selOf(S.cur) : null;
  const pair = !!(s && s.B && s.B !== s.A);
  const modes = [['wipe', 'Rideau'], ['side', 'Côte à côte'], ['a', 'A'], ['b', 'B']];
  put(box,
    pair ? el('div', { class: 'seg', role: 'group', 'aria-label': 'la vue' }, ...modes.map(([id, lab], i) => el('button', { class: 'tb' + (S.view === id ? ' on' : ''), type: 'button',
      title: `touche ${i + 1}`, onclick: () => setView(id) }, lab))) : null,
    el('span', { class: 'sp' }),
    S.cur ? el('button', { class: 'tb ghost sm zoom', type: 'button', id: 'zoomBtn', onclick: () => { resetZoom(); applyZoom(); },
      title: 'molette : zoom · bouton du milieu : déplacer · double-clic ou 0 : ajuster' }, zoomTxt()) : null);
}
const zoomTxt = () => (Z.z <= 1.0001 ? 'ajusté' : `${Z.z < 10 ? comma(Z.z.toFixed(1)) : Math.round(Z.z)}×`);
function setView(v) {
  S.view = v; prefs.set('upscale.view', v);
  const box = mon();
  if (box && V.b) { box.className = 'monitor upm mode-' + v; if (v === 'wipe') setWipe(S.wipe); else box.querySelector('.layer.b').style.clipPath = ''; }
  applyZoom(); paintTools();
}
function setWipe(p) {
  S.wipe = Math.max(0, Math.min(100, p));
  const box = mon();
  const lb = box?.querySelector('.layer.b'), h = box?.querySelector('.handle');
  if (!lb || !h) return;
  if (S.view === 'wipe') lb.style.clipPath = `inset(0 0 0 ${S.wipe}%)`;
  h.style.left = S.wipe + '%';
  h.setAttribute('aria-valuenow', Math.round(S.wipe));
}
// l'échelle « ajustée » d'un média dans sa couche, et la couche elle-même
const natural = (m) => (m.tagName === 'VIDEO' ? [m.videoWidth, m.videoHeight] : [m.naturalWidth, m.naturalHeight]);
function fitOf(m) {
  const L = m.parentElement.parentElement.getBoundingClientRect();
  const [w, h] = natural(m);
  return w && h ? Math.min(L.width / w, L.height / h) : 0;
}
function zmax() {
  // jusqu'à 8 pixels d'écran par pixel du média le plus fin (la source)
  const f = [V.a, V.b].filter(Boolean).map(fitOf).filter((x) => x > 0);
  return Math.max(8, f.length ? 8 / Math.min(...f) : 8);
}
function applyZoom() {
  const box = mon();
  if (!box || !V.a) return;
  if (Z.z <= 1.0001) { Z.z = 1; Z.x = 0; Z.y = 0; }
  Z.x = Math.max(-(Z.z - 1), Math.min(0, Z.x));
  Z.y = Math.max(-(Z.z - 1), Math.min(0, Z.y));
  for (const zs of box.querySelectorAll('.zs')) {
    const L = zs.parentElement.getBoundingClientRect();
    zs.style.transform = Z.z === 1 ? '' : `translate(${(Z.x * L.width).toFixed(2)}px, ${(Z.y * L.height).toFixed(2)}px) scale(${Z.z})`;
  }
  // au-delà de 4 pixels d'écran par pixel : les pixels tels quels (on inspecte)
  for (const m of [V.a, V.b]) if (m) m.classList.toggle('px', fitOf(m) * Z.z >= 4);
  const zbtn = $('#zoomBtn');
  if (zbtn) zbtn.textContent = zoomTxt();
  box.classList.toggle('zoomed', Z.z > 1);
}
// le point sous la souris, dans la couche qu'il touche (la moitié en côte à côte)
function at(e) {
  const r = mon().getBoundingClientRect();
  const side = V.b && S.view === 'side';
  const W = side ? r.width / 2 : r.width;
  let x = e.clientX - r.left;
  if (side && x > W) x -= W;
  return { x, y: e.clientY - r.top, W, H: r.height };
}
function zoomAt(nz, p) {
  const r = mon().getBoundingClientRect();
  const side = V.b && S.view === 'side';
  const q = p || { x: (side ? r.width / 2 : r.width) / 2, y: r.height / 2, W: side ? r.width / 2 : r.width, H: r.height };
  nz = Math.max(1, Math.min(zmax(), nz));
  const k = nz / Z.z;
  Z.x = (q.x - (q.x - Z.x * q.W) * k) / q.W;
  Z.y = (q.y - (q.y - Z.y * q.H) * k) / q.H;
  Z.z = nz;
  applyZoom();
}
function wireMonitor() {
  const box = mon();
  box.addEventListener('wheel', (e) => {
    if (!V.a) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.clientHeight : 1;
    zoomAt(Z.z * Math.exp(-e.deltaY * unit * 0.0022), at(e));
  }, { passive: false });
  // bouton du milieu : déplacer (et jamais le défilement automatique du navigateur)
  box.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  box.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  box.addEventListener('pointerdown', (e) => {
    if (!V.a || (e.button !== 0 && e.button !== 1)) return;
    const r = box.getBoundingClientRect();
    const wipe = V.b && S.view === 'wipe';
    if (e.button === 1 || (!wipe && Z.z > 1)) V.drag = { k: 'pan', x: e.clientX, y: e.clientY };
    else if (wipe) { V.drag = { k: 'wipe' }; setWipe(((e.clientX - r.left) / r.width) * 100); }
    if (!V.drag) return;
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    box.classList.toggle('panning', V.drag.k === 'pan');
  });
  box.addEventListener('pointermove', (e) => {
    if (!V.drag) return;
    const r = box.getBoundingClientRect();
    if (V.drag.k === 'wipe') { setWipe(((e.clientX - r.left) / r.width) * 100); return; }
    const W = V.b && S.view === 'side' ? r.width / 2 : r.width;
    Z.x += (e.clientX - V.drag.x) / W; Z.y += (e.clientY - V.drag.y) / r.height;
    V.drag.x = e.clientX; V.drag.y = e.clientY;
    applyZoom();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => box.addEventListener(ev, () => { V.drag = null; box.classList.remove('panning'); }));
  box.addEventListener('dblclick', () => { resetZoom(); applyZoom(); });
  new ResizeObserver(() => applyZoom()).observe(box);
  dropZone(box, { kinds: ['image', 'video'], via: 'upscale', onitems: openItems });
  dropZone($('#tiles'), { kinds: ['image', 'video'], via: 'upscale', onitems: openItems });
}

// la lecture synchronisée des deux vidéos (le banc A/B de l'outil Vidéo) : le lecteur du portail
// (commun/lecteur.js) sans son écran — sa barre et sa frise sous le moniteur, son clavier (Espace,
// J K L, ← →, Début, Fin) ; il pilote la maîtresse (B, l'essai ; A sans B) et l'autre la suit ; la
// copie de défilement de chacune se pose dans sa couche (le zoom et le rideau la prennent avec elle).
// Le son : on écoute A, B ou rien (un réglage de la page, dans la barre du lecteur).
function wireVideo(t0) {
  const a = V.a, b = V.b;
  const master = b && b.tagName === 'VIDEO' ? b : a;
  const other = master === b && a && a.tagName === 'VIDEO' ? a : null;
  const itOf = (v) => (v === a ? V.itA : V.itB);
  const it = itOf(master);
  const audio = () => {
    const want = S.listen === 'a' ? a : S.listen === 'b' ? (b || a) : null;
    for (const v of [a, b]) if (v && v.tagName === 'VIDEO') v.muted = v !== want;
    for (const x of seg.querySelectorAll('.tb')) x.classList.toggle('on', x.dataset.a === S.listen);
  };
  const seg = el('div', { class: 'seg aud', role: 'group', 'aria-label': 'le son entendu' }, ...[['a', 'Son A'], ['b', 'B'], ['0', 'muet']].filter(([id]) => b || id !== 'b').map(([id, lab]) => {
    const x = el('button', { class: 'tb sm', type: 'button', onclick: () => { S.listen = id; audio(); } }, lab);
    x.dataset.a = id;
    return x;
  }));
  const L = lecteur(it, {
    clavier: 'page', ecran: false, media: master, suiveurs: other ? [{ el: other, it: itOf(other) }] : [],
    son: false, outils: [seg], fps: it.fps || curItem()?.fps || 24,
    boucle: S.loop, onBoucle: (on) => { S.loop = on; prefs.set('upscale.loop', on); },
    onTemps: (t) => { V.t = t; },
  });
  V.lect = L;
  $('#transport').replaceChildren(L.el);
  if (t0) master.addEventListener('loadedmetadata', () => { if (V.lect === L) L.seek(t0); }, { once: true });
  audio();
}

// ── le clavier ──────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || $('.scrim') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  const k = e.key;
  const pair = !!V.b;
  if (k >= '1' && k <= '4' && pair) setView(['wipe', 'side', 'a', 'b'][+k - 1]);
  else if (k === '0' && V.a) { resetZoom(); applyZoom(); }
  else if ((k === '+' || k === '=') && V.a) zoomAt(Z.z * 1.25);
  else if (k === '-' && V.a) zoomAt(Z.z / 1.25);
  else if (k === '[' && pair) setWipe(S.wipe - 2);
  else if (k === ']' && pair) setWipe(S.wipe + 2);
  else if ((k === 's' || k === 'S') && pair) swap();
  // Espace, J K L, les flèches, Début, Fin : le lecteur du portail (commun/lecteur.js) les prend
});
function swap() { const s = selOf(S.cur); [s.A, s.B] = [s.B, s.A]; s.chosen = true; paintPile(); paintMonitor(); }

dropAnywhere((files) => addFiles(files));

// ── le clic droit (Cal, 29/09 : jamais le menu du navigateur) ──
function sideMenu(e) {
  const r = e.target.closest('.prow[data-id]');
  if (r) {
    const id = r.dataset.id;
    const n = id === S.cur ? 0 : trialsOf(S.cur).findIndex((t) => t.id === id) + 1;
    const it = byId(id);
    return it ? rowItems(it, n) : null;
  }
  const t = e.target.closest('.mtile[data-id]');
  if (t) {
    const it = S.piles.find((x) => x.id === t.dataset.id);
    return it ? [{ head: it.title || it.id }, { label: 'Voir sa pile', icon: '⤢', onclick: () => setCur(it.id) },
      { label: 'Fermer ce média', icon: '×', sub: 'il reste dans la bibliothèque', onclick: () => closePile(it.id) }] : null;
  }
  return null;
}
pageMenu(() => {
  const go = $('#act .tb.go');
  const pair = !!V.b;
  return [{ head: 'Upscale' },
    { label: 'Upscaler', icon: '▶', disabled: !go || go.disabled, why: $('#act .why')?.textContent || 'rien à envoyer', onclick: () => launch() },
    { label: 'Ouvrir une image ou une vidéo…', icon: '+', onclick: choose },
    '-',
    ...(pair ? [['wipe', 'Rideau'], ['side', 'Côte à côte'], ['a', 'A seul'], ['b', 'B seul']].map(([v, lab], i) => ({ label: lab, checked: S.view === v, key: String(i + 1), onclick: () => setView(v) })) : []),
    pair ? { label: 'Échanger A et B', icon: '⇄', key: 'S', onclick: swap } : null,
    V.a ? { label: 'Ajuster à la vue', icon: '⤢', key: '0', disabled: Z.z === 1, why: 'déjà ajustée', onclick: () => { resetZoom(); applyZoom(); } } : null];
});

// ── démarrage ───────────────────────────────────────────────
async function start() {
  skeleton();
  wireMonitor();
  contextMenu($('#side'), sideMenu);
  contextMenu($('#tiles'), sideMenu);
  try { S.cfg = await api('upscale/models'); } catch (e) {
    $('#rail').replaceChildren(el('p', { class: 'warn' }, `le portail ne répond pas : ${e.message}`)); return;
  }
  const d = store.get() || {};
  for (const k of ['preset', 'base', 'size', 'touched', 'advOpen']) if (d[k] !== undefined && d[k] !== null) S[k] = d[k];
  if (d.adv && typeof d.adv === 'object') S.adv = { ...S.cfg.default_set, ...d.adv };
  if (S.preset !== 'custom' && !P(S.preset)) S.preset = 'precis';
  S.view = prefs.get('upscale.view', S.view);
  if (!['wipe', 'side', 'a', 'b'].includes(S.view)) S.view = 'wipe';
  S.loop = prefs.get('upscale.loop', S.loop);
  // ?src=<id>[,<id>…] (la bibliothèque et les autres outils y envoient), #<essai> : sa pile, lui en B
  const q = new URLSearchParams(location.search);
  const srcs = q.getAll('src').flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  const want = location.hash.slice(1);
  let ids = [...new Set([...(d.piles || []), ...srcs])];
  let wantTrial = null;
  if (want) {
    try { wantTrial = await api('library/' + want); } catch { wantTrial = null; }
    const pid = wantTrial?.parents?.[0];
    if (pid && !ids.includes(pid)) ids.push(pid);
  }
  const got = (await Promise.all(ids.map((id) => api('library/' + id).catch(() => null)))).filter((it) => it && (it.kind === 'image' || it.kind === 'video'));
  if (srcs.length && srcs.some((id) => !got.some((x) => x.id === id))) toast('une source demandée n’est pas une image ou une vidéo de la bibliothèque', 6000);
  for (const it of got) known.set(it.id, it);
  S.piles = got;
  S.cur = (wantTrial?.parents?.[0] && got.some((x) => x.id === wantTrial.parents[0]) ? wantTrial.parents[0] : null)
    || (srcs.find((id) => got.some((x) => x.id === id))) || (got.some((x) => x.id === d.cur) ? d.cur : got[0]?.id) || null;
  if (wantTrial && S.cur === wantTrial.parents?.[0]) { const s = selOf(S.cur); s.B = wantTrial.id; s.chosen = true; }
  syncKind();
  if (!S.adv.model) S.adv = { ...(presetSet(S.preset) || S.cfg.default_set), model: presetSet(S.preset)?.model || S.cfg.default[kindCur()] };
  paintAll();
  await Promise.all(S.piles.map((it) => loadPile(it.id)));
  doc = U.snapshots({ get: docState, set: docRestore, describe: docDescribe });
  doc.reset();
  $('#rail').addEventListener('focusin', (e) => { if (e.target.matches?.('textarea')) typing++; });
  prefs.on('upscale.view', (v) => { if (v && v !== S.view) setView(v); });
  // changée ailleurs (un autre onglet, les Préférences) : le moniteur se refait ; le bouton du lecteur l'a déjà
  prefs.on('upscale.loop', (v) => { const on = v !== false; if (on === S.loop) return; S.loop = on; if (curItem()?.kind === 'video') paintMonitor(); });
  if (S.cfg.availability_error) toast(`machines : ${S.cfg.availability_error}`, 6000);
}
addEventListener('hashchange', async () => {
  const id = location.hash.slice(1);
  if (!id || id === (S.cur && selOf(S.cur).B)) return;
  let it;
  try { it = await api('library/' + id); } catch { return; }
  const pid = it.parents?.[0];
  if (!pid) return;
  if (!S.piles.some((x) => x.id === pid)) { try { openItems([await api('library/' + pid)]); } catch { return; } }
  setCur(pid);
  setSlot('B', id);
});
start();
