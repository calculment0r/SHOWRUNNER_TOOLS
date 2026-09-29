// Upscale : agrandir et affiner les images et les vidéos de la
// bibliothèque. Le serveur tient la seule vérité : modèles, tailles, ce
// qui passe ou non, mémoire et temps estimés viennent de /api/upscale/*
// (server/tools/upscale.py, étude docs/etudes/upscale.md).
//
// Entrée : la bibliothèque (pick), un dépôt de fichiers, ou l'adresse
// upscale/?src=<id>[,<id>…] — la bibliothèque et les autres outils y
// envoient. Résultat : avant/après en rideau ou côte à côte, loupe 1:1 qui
// suit la souris, lecture synchronisée pour une vidéo (le banc A/B de Movie
// Creator), puis la bibliothèque et le montage.
import { mountHeader, api, jobs, pick, thumb, toast, el, $, $$, href, fmtDur, fmtDate, uploadFile, dropAnywhere, kindFr, stateFr } from '../commun/shell.js';

mountHeader('upscale', { sub: 'agrandir · affiner' });

const KEY = 'sr-upscale';
const S = {
  cfg: null,
  items: [],
  model: '', mode: 'factor', factor: 2, ti: '4k', tv: '1080p', color: 'lab', denoise: 0.25, prompt: '',
  plan: null, planErr: '', sending: false,
  runs: new Map(),   // source → {job, state, item}
  mine: new Map(),   // travail → dernier relevé
  cur: null,         // {a: la source, b: l'agrandie ou null}
  view: 'wipe', wipe: 50, loupe: true, loop: true, listen: 'b',
};

// ── petites aides ───────────────────────────────────────────
const M = (id) => S.cfg?.models.find((m) => m.id === id);
const stub = () => S.cfg?.backend === 'stub';
const plural = (n, w, pl = w + 's') => `${n} ${n > 1 ? pl : w}`;
const dims = (w, h) => (w && h ? `${w} × ${h}` : '?');
const fmtS = (s) => (s == null ? '' : s < 60 ? `${String(Math.max(0.1, Math.round(s * 10) / 10)).replace('.', ',')} s` : s < 3600
  ? `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`);
const fmtGb = (g) => (g == null ? '' : `${g < 10 ? g.toFixed(1).replace('.', ',') : Math.round(g)} Go`);
const kinds = () => ({ image: S.items.some((i) => i.kind === 'image'), video: S.items.some((i) => i.kind === 'video') });
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  save() {
    try {
      const { model, mode, factor, ti, tv, color, denoise, view, loupe, loop } = S;
      localStorage.setItem(KEY, JSON.stringify({ model, mode, factor, ti, tv, color, denoise, view, loupe, loop, items: S.items.map((i) => i.id) }));
    } catch { /* stockage fermé : rien à garder */ }
  },
};
// replaceChildren écrirait « null » : on ne pose que ce qui existe
const put = (box, ...kids) => box.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false && k !== ''));
function head(label, right, cls = '') {
  return el('div', { class: 'ipan-h ' + cls }, el('span', { class: 'lbl' }, label), right ? el('span', { class: 'r' }, right) : null);
}
const planRow = (id) => S.plan?.rows?.find((r) => r.item === id) || null;
const memTxt = (m) => (!m ? '' : `${m.floor ? '≥ ' : '≈ '}${fmtGb(m.gb)}${m.chunks > 1 ? ` · ${m.chunks} morceaux` : ''}`);
const estTxt = (e) => (!e ? '' : e.s == null ? 'temps non mesuré' : `≈ ${fmtS(e.s)}`);

// ce que les machines savent faire ; en factice, rien ne bloque
function modelOff(m) {
  if (m.off) return m.off;
  if (stub()) return '';
  const av = m.availability || {};
  const need = m.kinds.filter((k) => kinds()[k]);
  const dead = (need.length ? need : m.kinds).filter((k) => av[k] && !av[k].on.length);
  if (!dead.length) return '';
  const miss = Object.entries(av[dead[0]].missing).map(([mm, v]) => `${mm} : ${v.slice(0, 3).join(', ')}`).join(' · ');
  return `aucune machine ne peut le faire (${miss || 'aucune ne répond'})`;
}
function availTxt(m) {
  if (m.off) return '';
  if (stub()) return 'factice';
  const av = Object.values(m.availability || {});
  if (!av.length) return '';
  const on = av.map((a) => new Set(a.on)).reduce((x, y) => new Set([...x].filter((v) => y.has(v))));
  return on.size ? [...on].join(' + ') : '';
}

// ── le squelette ────────────────────────────────────────────
const fileIn = el('input', { type: 'file', multiple: true, accept: 'image/*,video/*', hidden: true, onchange: async () => { await addFiles([...fileIn.files]); fileIn.value = ''; } });
function skeleton() {
  $('#rail').replaceChildren(
    el('section', { class: 'ipan', id: 'p-in' }), el('section', { class: 'ipan', id: 'p-model' }),
    el('section', { class: 'ipan', id: 'p-size' }), el('section', { class: 'ipan', id: 'p-set' }),
    el('div', { class: 'act', id: 'act' }), fileIn);
  $('#stage').replaceChildren(
    el('div', { id: 'banner' }), el('div', { class: 'vtools', id: 'vtools' }), el('div', { class: 'cmpv', id: 'viewer', tabindex: '0' }),
    el('div', { id: 'transport' }), el('div', { id: 'info' }), el('section', { class: 'queue', id: 'queue' }));
  $('#side').replaceChildren(el('p', { class: 'lbl' }, 'chargement'));
}

// ── l'entrée ────────────────────────────────────────────────
function paintIn() {
  const box = $('#p-in');
  box.replaceChildren(
    head('Entrée', S.items.length ? plural(S.items.length, 'fichier') : ''),
    S.items.length ? el('div', { class: 'inlist' }, ...S.items.map(inRow))
      : el('p', { class: 'hint' }, 'Des images ou des vidéos de la bibliothèque, ou déposées ici depuis le disque. Un autre outil les envoie par l’adresse upscale/?src=<id>.'),
    el('div', { class: 'row' },
      el('button', { class: 'tb ghost sm', onclick: choose }, 'Bibliothèque'),
      el('button', { class: 'tb ghost sm', onclick: () => fileIn.click() }, 'Depuis le disque'),
      el('span', { class: 'sp' }),
      S.items.length ? el('button', { class: 'tb ghost sm', title: 'retirer tous les fichiers de l’entrée (ils restent dans la bibliothèque)', onclick: () => setItems([]) }, 'Vider') : null));
}
function inRow(it) {
  const pr = planRow(it.id);
  const run = S.runs.get(it.id);
  const sub = [kindFr(it.kind), dims(it.width, it.height), it.duration ? fmtDur(it.duration) : '', it.fps ? `${Math.round(it.fps * 100) / 100} i/s` : ''].filter(Boolean).join(' · ');
  let plan = null;
  if (pr?.ok) {
    plan = el('span', { class: 'pl', title: [pr.mem?.how && `mémoire : ${pr.mem.how}`, pr.est?.how && `temps : ${pr.est.how}`].filter(Boolean).join('\n') },
      el('b', {}, `→ ${dims(pr.out[0], pr.out[1])}`), el('span', {}, [pr.label, memTxt(pr.mem), estTxt(pr.est)].filter(Boolean).join(' · ')));
  }
  else if (pr) plan = el('span', { class: 'pl no' }, pr.why);
  const st = run ? el('span', { class: 'st ' + (run.state || '') }, run.state === 'running' && run.progress != null
    ? `en cours ${Math.round(run.progress * 100)} %` : stateFr(run.state || 'queued')) : null;
  return el('div', { class: 'inrow' + (S.cur?.a?.id === it.id ? ' on' : ''), role: 'button', tabindex: '0', title: 'le voir', onclick: () => showSource(it),
    onkeydown: (e) => { if (e.key === 'Enter') showSource(it); } },
  el('div', { class: 'th', style: { backgroundImage: it.thumb_url ? `url(${href(it.thumb_url)})` : null } },
    it.kind === 'video' ? el('span', { class: 'k' }, 'vidéo') : null),
  el('div', { class: 'tx' }, el('b', {}, it.title || it.id), el('small', {}, sub), plan, st),
  el('button', { class: 'x', title: 'retirer de l’entrée', onclick: (e) => { e.stopPropagation(); setItems(S.items.filter((x) => x.id !== it.id)); } }, '×'));
}
async function choose() {
  const got = await pick({ kinds: ['image', 'video'], multiple: true, title: 'Images et vidéos à agrandir' });
  addItems(got);
}
async function addFiles(files) {
  const got = [];
  for (const f of files) {
    try { got.push(await uploadFile(f, { tool: 'upload' })); } catch (e) { toast(`${f.name} : ${e.message}`, 6000); }
  }
  if (got.length) toast(`${plural(got.length, 'fichier')} rangé${got.length > 1 ? 's' : ''} dans la bibliothèque`);
  addItems(got);
}
function addItems(list) {
  const ok = list.filter((it) => it && (it.kind === 'image' || it.kind === 'video'));
  if (list.length > ok.length) toast('un élément ou un son ne s’agrandit pas : seules les images et les vidéos entrent ici', 6000);
  const next = [...S.items];
  for (const it of ok) if (!next.some((x) => x.id === it.id)) next.push(it);
  const max = S.cfg?.max_items || 50;
  if (next.length > max) toast(`${max} fichiers au plus par envoi`);
  setItems(next.slice(0, max));
  if (ok.length && !S.cur) showSource(ok[0]);
}
function setItems(list) {
  S.items = list;
  if (S.cur && !S.cur.b && !list.some((x) => x.id === S.cur.a.id)) { S.cur = null; paintViewer(); paintInfo(); }
  store.save(); paintIn(); paintModel(); paintSize(); paintAct(); schedPlan();
}

// ── le modèle ───────────────────────────────────────────────
function paintModel() {
  const box = $('#p-model');
  const on = S.cfg.models.filter((m) => m.retained);
  const off = S.cfg.models.filter((m) => !m.retained);
  box.replaceChildren(head('Modèle', 'fidèle → créatif'),
    el('div', { class: 'models' }, ...on.map(card)),
    el('details', { class: 'more' }, el('summary', {}, el('span', { class: 'lbl' }, `Pas installés · ${off.length}`),
      el('span', { class: 'r' }, 'ce qui manque')),
    el('div', { class: 'models' }, ...off.map(card)),
    el('p', { class: 'hint' }, 'Téléchargements proposés, tailles et licences : ', el('a', { href: href('docs/etudes/upscale.md'), target: '_blank', rel: 'noopener' }, 'l’étude, §7'), '.')));
}
function card(m) {
  const why = modelOff(m);
  const av = availTxt(m);
  return el('button', { class: 'opt model' + (S.model === m.id ? ' on' : '') + (why ? ' off' : ''), type: 'button', 'aria-disabled': why ? 'true' : null,
    title: `${why ? why + '\n' : ''}source : ${m.src}`, onclick: () => (why ? toast(`${m.name} : ${why}`, 7000) : setModel(m.id)) },
  el('span', { class: 'mk' }, m.k), el('span', { class: 'way w-' + (m.way === 'fidèle' ? 'f' : m.way === 'créatif' ? 'c' : 'n') }, m.way),
  el('b', {}, m.name), el('span', { class: 'role' }, m.role),
  why ? el('span', { class: 'reason' }, why) : null,
  el('span', { class: 'cap' }, m.kinds.map((k) => (k === 'video' ? 'vidéo' : k)).join(' · ') + (av ? ` · ${av}` : '')));
}
function setModel(id) {
  S.model = id;
  const m = M(id);
  if (m.id === 'esrgan-x2' && S.factor > 2) S.factor = 2;
  store.save(); paintModel(); paintSize(); paintSet(); schedPlan();
}

// ── la taille ───────────────────────────────────────────────
function paintSize() {
  const box = $('#p-size');
  const m = M(S.model);
  if (!m) return;
  if (m.fixed) {
    box.replaceChildren(head('Taille', 'fixée par le gabarit'),
      el('p', { class: 'hint' }, 'Affiner ramène l’image à 1 Mpx puis la double : environ 4 Mpx (2048 × 2048 pour un carré). Une image déjà plus grande ne passe pas : elle rapetisserait.'));
    return;
  }
  const gan = m.id === 'esrgan-x2';
  const b = (mode, f, lab) => {
    const off = gan && f === 4;
    const on = S.mode === mode && (mode === 'target' || S.factor === f);
    return el('button', { class: 'tb' + (on ? ' on' : ''), type: 'button', disabled: off || null, title: off ? 'RealESRGAN ×2 ne fait que ×2' : null,
      onclick: () => { S.mode = mode; if (f) S.factor = f; store.save(); paintSize(); schedPlan(); } }, lab);
  };
  const k = kinds();
  const tg = (kind, cur, set) => el('div', { class: 'tgt' }, el('span', { class: 'lbl' }, kind === 'image' ? 'Images' : 'Vidéos'),
    el('div', { class: 'opts' }, ...S.cfg.targets[kind].map((t) => el('button', { class: 'opt' + (cur === t.id ? ' on' : ''), type: 'button',
      onclick: () => { set(t.id); store.save(); paintSize(); schedPlan(); } }, t.label, el('small', {}, t.sub)))));
  const right = S.mode === 'factor' ? `×${S.factor}` : [k.image || !k.video ? S.cfg.targets.image.find((t) => t.id === S.ti)?.label : '', k.video ? S.cfg.targets.video.find((t) => t.id === S.tv)?.label : ''].filter(Boolean).join(' · ');
  put(box, head('Taille', right),
    el('div', { class: 'seg sz' }, b('factor', 2, '×2'), b('factor', 4, '×4'), b('target', null, 'Cible')),
    gan ? el('p', { class: 'why' }, '×4 éteint : il demande RealESRGAN_x4plus (67 Mo), à télécharger — ', el('a', { href: href('docs/etudes/upscale.md'), target: '_blank', rel: 'noopener' }, 'étude §7')) : null,
    S.mode === 'target' && (k.image || !k.video) ? tg('image', S.ti, (v) => { S.ti = v; }) : null,
    S.mode === 'target' && k.video ? tg('video', S.tv, (v) => { S.tv = v; }) : null,
    el('p', { class: 'hint' }, S.mode === 'target'
      ? 'Une image se règle par son grand côté ; une vidéo tient dans le cadre du format, qu’elle soit large ou verticale. Les proportions sont gardées, les côtés arrondis au pair.'
      : 'Chaque fichier garde ses proportions ; la taille exacte de sortie s’affiche sous son nom.'));
}

// ── les réglages du modèle ──────────────────────────────────
function paintSet() {
  const box = $('#p-set');
  const m = M(S.model);
  if (!m) return;
  if (m.id.startsWith('seedvr2')) {
    const c = S.cfg.colors.find((x) => x.id === S.color) || S.cfg.colors[0];
    box.replaceChildren(head('Couleur', c.name),
      el('div', { class: 'opts four' }, ...S.cfg.colors.map((x) => el('button', { class: 'opt' + (x.id === S.color ? ' on' : ''), type: 'button', title: x.about,
        onclick: () => { S.color = x.id; store.save(); paintSet(); schedPlan(); } }, x.name, el('small', {}, x.sub)))),
      el('p', { class: 'hint' }, c.about + '.'),
      el('p', { class: 'hint' }, 'SeedVR2 restaure en un pas, sans prompt : pas d’autre réglage utile documenté. Sur une source déjà propre, il peut trop accentuer (sa fiche) : comparez à la loupe.'));
  } else if (m.id === 'zimage-refine') {
    const d = S.cfg.denoise;
    const val = el('span', { class: 'val' }, S.denoise.toFixed(2).replace('.', ','));
    const ta = el('textarea', { class: 'fld', rows: 3, placeholder: 'Description de l’image, en anglais (facultatif : le prompt d’une image créée dans l’outil Image est repris)',
      oninput: (e) => { S.prompt = e.target.value; schedPlan(); } });
    ta.value = S.prompt;
    box.replaceChildren(head('Débruitage', 'fidèle → créatif'),
      el('div', { class: 'slide' }, el('input', { type: 'range', min: d.min, max: d.max, step: 0.01, value: S.denoise,
        oninput: (e) => { S.denoise = +e.target.value; val.textContent = S.denoise.toFixed(2).replace('.', ','); store.save(); schedPlan(); } }), val),
      el('div', { class: 'scale' }, el('span', {}, '0,10 fidèle'), el('span', {}, `conseillé ${String(d.advice[0]).replace('.', ',')}–${String(d.advice[1]).replace('.', ',')}`), el('span', {}, '0,50 créatif')),
      el('p', { class: 'hint' }, 'Au-delà de 0,35, des défauts (note du gabarit). Une description détaillée tient mieux le résultat.'),
      ta);
  } else {
    box.replaceChildren(head('Réglages', 'aucun'),
      el('p', { class: 'hint' }, 'RealESRGAN fait ×2, image par image ; une cible plus petite que ×2 est obtenue ensuite en Lanczos (le conseil du gabarit GAN).'));
  }
}

// ── avant l'envoi ───────────────────────────────────────────
let planT = null;
let planSeq = 0;
function schedPlan() { clearTimeout(planT); planT = setTimeout(doPlan, 180); }
const body = () => ({ items: S.items.map((i) => i.id), model: S.model, mode: S.mode, factor: S.factor, target_image: S.ti, target_video: S.tv,
  color: S.color, denoise: S.denoise, prompt: S.prompt });
async function doPlan() {
  const seq = ++planSeq;
  if (!S.items.length) { S.plan = null; S.planErr = ''; paintIn(); paintAct(); return; }
  try {
    const p = await api('upscale/plan', { method: 'POST', body: body() });
    if (seq !== planSeq) return;
    S.plan = p; S.planErr = '';
  } catch (e) { if (seq !== planSeq) return; S.plan = null; S.planErr = e.message; }
  paintIn(); paintAct();
}
function paintAct() {
  const box = $('#act');
  const pl = S.plan;
  const okRows = pl ? pl.rows.filter((r) => r.ok) : [];
  const nI = okRows.filter((r) => r.kind === 'image').length, nV = okRows.filter((r) => r.kind === 'video').length;
  const why = !S.items.length ? 'choisissez au moins une image ou une vidéo'
    : S.planErr ? S.planErr
      : pl && !okRows.length ? 'aucun fichier ne passe avec ces réglages : la raison est sous chaque nom' : '';
  const label = !okRows.length ? 'Agrandir'
    : `Agrandir ${[nI ? plural(nI, 'image') : '', nV ? plural(nV, 'vidéo') : ''].filter(Boolean).join(' et ')}`;
  const peak = okRows.map((r) => r.mem?.gb || 0).reduce((a, b) => Math.max(a, b), 0);
  const floor = okRows.some((r) => r.mem?.floor);
  const summary = okRows.length ? el('div', { class: 'sum' },
    el('span', {}, el('b', {}, pl.total_s != null ? `≈ ${fmtS(pl.total_s)}` : 'temps non mesuré'), pl.total_s != null ? ' en tout' : ' : le premier rendu le mesurera'),
    el('span', {}, 'pic ', el('b', {}, `${floor ? '≥ ' : '≈ '}${fmtGb(peak)}`), S.cfg.free_gb ? ` · ${fmtGb(S.cfg.free_gb)} libres sur ${S.cfg.free_machine}` : '')) : null;
  put(box, summary,
    why ? el('div', { class: 'why' }, why) : null,
    el('button', { class: 'tb go block', type: 'button', disabled: !!why || !okRows.length || S.sending || null, onclick: launch }, S.sending ? 'Envoi…' : label),
    stub() ? el('div', { class: 'hint c' }, 'moteur factice : un bicubique, étiqueté') : null);
}

async function launch() {
  S.sending = true; paintAct();
  let r;
  try { r = await api('upscale/run', { method: 'POST', body: body() }); } catch (e) { S.sending = false; toast(e.message, 8000); paintAct(); return; }
  S.sending = false;
  for (const j of r.jobs) follow(j);
  toast(`${plural(r.jobs.length, 'travail', 'travaux')} en file${r.skipped.length ? ` · ${plural(r.skipped.length, 'laissé')} : ${r.skipped[0].why}` : ''}`, r.skipped.length ? 7000 : 3200);
  paintAct(); paintIn(); paintQueue();
}
function follow(j) {
  S.mine.set(j.id, j);
  S.runs.set(j.source || j.params?.source, { job: j.id, state: j.state });
  jobs.wait(j.id, (t) => tick(t)).then((done) => {
    tick(done);
    const src = done.params?.source;
    const out = done.items?.[0];
    if (done.state === 'done' && out) {
      S.runs.set(src, { job: done.id, state: 'done', item: out });
      const a = S.items.find((x) => x.id === src);
      if (!S.cur || S.cur.a?.id === src) { if (a) showPair(a, out); else showResult(out); }
      loadHistory();
    } else if (done.state === 'error') toast(`échec : ${done.message}`, 9000);
    paintIn();
    schedPlan();   // un rendu mesuré de plus : le temps estimé se précise
  }).catch(() => {});
}
function tick(t) {
  S.mine.set(t.id, t);
  const src = t.params?.source;
  if (src) S.runs.set(src, { ...(S.runs.get(src) || {}), job: t.id, state: t.state, progress: t.progress });
  paintQueue(); paintInRuns();
}
let inT = null;
function paintInRuns() { clearTimeout(inT); inT = setTimeout(paintIn, 250); }

// ── la file de cette page ───────────────────────────────────
function paintQueue() {
  const box = $('#queue');
  const list = [...S.mine.values()].sort((a, b) => (a.created < b.created ? 1 : -1));
  if (!list.length) { box.replaceChildren(); return; }
  const live = list.filter((j) => j.state === 'queued' || j.state === 'running').length;
  box.replaceChildren(head('La file', live ? `${plural(live, 'travail', 'travaux')} en cours` : 'fini'),
    ...list.map((j) => {
      const out = j.items?.[0];
      const cls = j.state === 'running' ? 'run' : j.state === 'error' ? 'err' : j.state === 'done' ? 'ok' : '';
      return el('div', { class: 'qrow ' + cls, role: out ? 'button' : null, tabindex: out ? '0' : null,
        title: out ? 'voir l’avant/après' : j.message || '', onclick: () => { if (out) showResult(out); } },
      el('div', { class: 'jt', style: j.thumb ? { backgroundImage: `url(${href(j.thumb)})` } : null }),
      el('div', { class: 'tx' }, el('b', {}, j.title),
        el('small', {}, `${stateFr(j.state)}${j.machine ? ' · ' + j.machine : ''}${j.message ? ' — ' + j.message : ''}`)),
      el('div', { class: 'acts' },
        j.state === 'queued' || j.state === 'running' ? el('button', { class: 'tb ghost sm', type: 'button', onclick: (e) => { e.stopPropagation(); jobs.cancel(j.id); } }, 'Arrêter')
          : j.state === 'error' || j.state === 'cancelled' || j.state === 'interrupted'
            ? el('button', { class: 'tb ghost sm', type: 'button', onclick: async (e) => { e.stopPropagation(); const n = await jobs.retry(j.id); follow({ ...n, source: j.params?.source }); } }, 'Relancer')
            : out ? el('span', { class: 'lbl' }, dims(out.width, out.height)) : null),
      j.state === 'running' ? el('div', { class: 'bar' }, el('i', { style: { width: j.progress != null ? `${Math.round(j.progress * 100)}%` : '100%', opacity: j.progress != null ? 1 : 0.35 } })) : null);
    }));
}
jobs.watch((list) => {
  let changed = false;
  for (const j of list) {
    if (j.tool !== 'upscale') continue;
    if (S.mine.has(j.id) || j.state === 'queued' || j.state === 'running') {
      const old = S.mine.get(j.id);
      if (!old || old.state !== j.state || old.progress !== j.progress || old.message !== j.message) { S.mine.set(j.id, { ...old, ...j }); changed = true; }
    }
  }
  if (changed) paintQueue();
});

// ── la scène : avant / après ────────────────────────────────
async function showSource(it) {
  const run = S.runs.get(it.id);
  showPair(it, run?.item || null);
}
async function showResult(out) {
  let a = null;
  const pid = out.parents?.[0];
  if (pid) { try { a = await api('library/' + pid); } catch { a = null; } }
  showPair(a, out);
}
function showPair(a, b) {
  if (!a && b) { a = b; b = null; }
  if (!a) return;
  S.cur = { a, b };
  try { history.replaceState(null, '', location.pathname + location.search + (b ? '#' + b.id : '')); } catch { /* sans historique */ }
  paintViewer(); paintInfo(); paintIn(); markHistory();
}

let raf = 0, syncT = 0;
const V = { box: null, ma: null, mb: null, lp: null, cv: null, lpbox: null, pos: null, drag: false };
const LOUPE = 150, GAP = 6;
function media(it, cls) {
  if (it.kind === 'video') {
    const v = el('video', { src: href(it.url), class: cls, playsinline: true, preload: 'auto', loop: S.loop || null });
    v.muted = true;
    return v;
  }
  return el('img', { src: href(it.url), class: cls, alt: '', draggable: 'false' });
}
function paintViewer() {
  cancelAnimationFrame(raf); clearInterval(syncT);
  const box = $('#viewer');
  const c = S.cur;
  V.box = box; V.ma = V.mb = null;
  paintTools();
  if (!c) {
    box.className = 'cmpv empty';
    box.replaceChildren(el('div', { class: 'empty' }, el('b', {}, 'Avant / après'),
      el('span', {}, S.items.length ? 'Cliquez un fichier à gauche pour le voir ; « Agrandir » pose l’agrandie à côté.'
        : 'Choisissez à gauche des images ou des vidéos de la bibliothèque, ou déposez-les n’importe où sur la page.')));
    $('#transport').replaceChildren();
    return;
  }
  const pair = !!c.b;
  V.ma = media(c.a, 'm');
  const la = el('div', { class: 'lay a' }, V.ma);
  const kids = [la];
  if (pair) {
    V.mb = media(c.b, 'm');
    kids.push(el('div', { class: 'lay b' }, V.mb),
      el('div', { class: 'handle', role: 'slider', 'aria-label': 'rideau', 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('div', { class: 'grip' }, el('i'), el('i'))));
  }
  const fac = /factice/.test(c.b?.origin?.model || '');
  kids.push(el('div', { class: 'tag a' }, el('b', {}, 'Avant'), el('span', {}, dims(c.a.width, c.a.height))));
  if (pair) kids.push(el('div', { class: 'tag b' }, el('b', {}, 'Après'), el('span', {}, `${dims(c.b.width, c.b.height)} · ${modelName(c.b)}${fac ? ' · factice' : ''}`)));
  V.lpbox = el('div', { class: 'lpbox', hidden: true });
  V.cv = el('canvas');
  V.lp = el('div', { class: 'loupe', hidden: true }, V.cv,
    el('div', { class: 'lcap' }, el('span', {}, 'avant, agrandi simplement'), el('span', { class: 'b' }, 'après · 1:1')));
  kids.push(V.lpbox, V.lp);
  box.className = 'cmpv mode-' + (pair ? S.view : 'solo');
  box.replaceChildren(...kids);
  if (pair) setWipe(S.wipe);
  if (c.a.kind === 'video') wireVideo(); else $('#transport').replaceChildren();
}
const modelName = (it) => {
  const id = (it.origin?.model || '').replace(/-factice$/, '');
  return M(id)?.name || id || it.origin?.tool || '';
};
function paintTools() {
  const box = $('#vtools');
  const c = S.cur;
  if (!c || !c.b) { put(box, c ? el('span', { class: 'lbl' }, 'la source seule — l’agrandie viendra à côté') : null); return; }
  const modes = [['wipe', 'Rideau', '1'], ['side', 'Côte à côte', '2'], ['a', 'Avant', '3'], ['b', 'Après', '4']];
  box.replaceChildren(
    el('div', { class: 'seg' }, ...modes.map(([id, lab, k]) => el('button', { class: 'tb' + (S.view === id ? ' on' : ''), type: 'button', title: `touche ${k}`,
      onclick: () => setView(id) }, lab))),
    el('button', { class: 'tb sm ' + (S.loupe ? 'on' : 'ghost'), type: 'button', title: 'une loupe 1:1 suit la souris (touche L)', onclick: () => { S.loupe = !S.loupe; store.save(); paintTools(); hideLoupe(); } }, 'Loupe 1:1'),
    el('span', { class: 'sp' }),
    el('span', { class: 'lbl keys' }, S.view === 'wipe' ? 'glisser : le rideau · [ ] au clavier' : '1–4 : la vue · L : la loupe'));
}
function setView(v) {
  S.view = v; store.save();
  if (V.box && S.cur?.b) { V.box.className = 'cmpv mode-' + v; if (v === 'wipe') setWipe(S.wipe); else V.box.querySelector('.lay.b').style.clipPath = ''; }
  paintTools(); hideLoupe();
}
function setWipe(p) {
  S.wipe = Math.max(0, Math.min(100, p));
  const lb = V.box?.querySelector('.lay.b');
  const h = V.box?.querySelector('.handle');
  if (!lb || !h) return;
  if (S.view === 'wipe') lb.style.clipPath = `inset(0 0 0 ${S.wipe}%)`;
  h.style.left = S.wipe + '%';
  h.setAttribute('aria-valuenow', Math.round(S.wipe));
}

// la loupe : la même zone avant et après, à l'échelle 1:1 de l'agrandie
const natural = (m) => (m ? (m.tagName === 'VIDEO' ? [m.videoWidth, m.videoHeight] : [m.naturalWidth, m.naturalHeight]) : [0, 0]);
function contentRect(m) {
  const r = m.getBoundingClientRect();
  const [nw, nh] = natural(m);
  if (!nw || !nh) return null;
  const s = Math.min(r.width / nw, r.height / nh);
  return { x: r.left + (r.width - nw * s) / 2, y: r.top + (r.height - nh * s) / 2, w: nw * s, h: nh * s, s };
}
function hideLoupe() { if (V.lp) V.lp.hidden = true; if (V.lpbox) V.lpbox.hidden = true; V.pos = null; }
function placeLoupe(e) {
  if (!S.loupe || !S.cur?.b || !V.ma || !V.mb) return hideLoupe();
  // en côte à côte, la moitié sous la souris donne la position ; sinon l'agrandie
  const ref = S.view === 'side' && e.clientX < V.box.getBoundingClientRect().left + V.box.clientWidth / 2 ? V.ma : V.mb;
  const cr = contentRect(ref);
  if (!cr) return hideLoupe();
  const u = (e.clientX - cr.x) / cr.w, v = (e.clientY - cr.y) / cr.h;
  if (u < 0 || u > 1 || v < 0 || v > 1) return hideLoupe();
  V.pos = { u, v };
  const b = V.box.getBoundingClientRect();
  const [NW] = natural(V.mb);
  // le carré montré dans la vue : la zone que la loupe grossit
  const side = LOUPE * cr.w / NW;
  Object.assign(V.lpbox.style, { left: `${e.clientX - b.left - side / 2}px`, top: `${e.clientY - b.top - side / 2}px`, width: `${side}px`, height: `${side}px` });
  V.lpbox.hidden = side < 6;
  const W = 2 * LOUPE + GAP, H = LOUPE + 22;
  let x = e.clientX - b.left + 22, y = e.clientY - b.top + 22;
  if (x + W > b.width - 6) x = e.clientX - b.left - W - 22;
  if (y + H > b.height - 6) y = e.clientY - b.top - H - 22;
  Object.assign(V.lp.style, { left: `${Math.max(6, x)}px`, top: `${Math.max(6, y)}px` });
  V.lp.hidden = false;
  drawLoupe();
}
function drawLoupe() {
  if (!V.pos || !V.cv || V.lp.hidden) return;
  const [NW, NH] = natural(V.mb), [nw] = natural(V.ma);
  if (!NW || !nw) return;
  const dpr = window.devicePixelRatio || 1;
  const W = 2 * LOUPE + GAP;
  if (V.cv.width !== Math.round(W * dpr)) { V.cv.width = Math.round(W * dpr); V.cv.height = Math.round(LOUPE * dpr); V.cv.style.width = W + 'px'; V.cv.style.height = LOUPE + 'px'; }
  const g = V.cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, LOUPE);
  const cx = V.pos.u * NW, cy = V.pos.v * NH;
  const k = nw / NW;
  try {
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(V.ma, (cx - LOUPE / 2) * k, (cy - LOUPE / 2) * k, LOUPE * k, LOUPE * k, 0, 0, LOUPE, LOUPE);
    g.imageSmoothingEnabled = false;
    g.drawImage(V.mb, cx - LOUPE / 2, cy - LOUPE / 2, LOUPE, LOUPE, LOUPE + GAP, 0, LOUPE, LOUPE);
  } catch { /* image pas encore prête */ }
}
function wireViewer() {
  const box = $('#viewer');
  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !S.cur?.b || S.view !== 'wipe') return;
    V.drag = true; box.setPointerCapture(e.pointerId);
    const r = box.getBoundingClientRect(); setWipe(((e.clientX - r.left) / r.width) * 100);
  });
  box.addEventListener('pointermove', (e) => {
    if (V.drag) { const r = box.getBoundingClientRect(); setWipe(((e.clientX - r.left) / r.width) * 100); }
    if (e.pointerType === 'mouse') placeLoupe(e);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => box.addEventListener(ev, () => { V.drag = false; }));
  box.addEventListener('pointerleave', hideLoupe);
}

// la lecture synchronisée des deux vidéos (le banc A/B de Movie Creator)
function wireVideo() {
  const a = V.ma, b = V.mb;
  const master = b || a;
  const both = [a, b].filter(Boolean);
  const playBtn = el('button', { class: 'tb', type: 'button', title: 'lire · pause (espace)', onclick: () => toggle() });
  const tc = el('span', { class: 'timecode' }, '0:00.0');
  const fill = el('div', { class: 'fill' });
  const scrub = el('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'position' });
  const fps = S.cur.a.fps || 24;
  const dur = () => { const x = Math.min(...both.map((v) => (isFinite(v.duration) ? v.duration : Infinity))); return isFinite(x) ? x : 0; };
  const seek = (t) => both.forEach((v) => { try { v.currentTime = t; } catch { /* pas prête */ } });
  const playing = () => !master.paused && !master.ended;
  const icon = () => { playBtn.textContent = playing() ? 'Pause' : 'Lire'; };
  const toggle = async () => { if (playing()) both.forEach((v) => v.pause()); else { try { await Promise.all(both.map((v) => v.play())); } catch { /* geste requis */ } } icon(); };
  const step = (n) => { both.forEach((v) => v.pause()); seek(Math.max(0, Math.min(dur() || 0, master.currentTime + n / fps))); icon(); };
  const audio = () => {
    const want = S.listen === 'a' ? a : S.listen === 'b' ? (b || a) : null;
    both.forEach((v) => { v.muted = v !== want; });
    $$('#transport .aud .tb').forEach((x) => x.classList.toggle('on', x.dataset.a === S.listen));
  };
  const upd = () => {
    const t = master.currentTime || 0, d0 = dur(), d = isFinite(d0) ? d0 : 0;
    tc.textContent = `${fmtDur(t)} / ${fmtDur(d)} · img ${Math.round(t * fps)}`;
    if (!scrub.matches(':active')) scrub.value = d ? Math.round((t / d) * 1000) : 0;
    fill.style.width = (d ? (t / d) * 100 : 0) + '%';
  };
  scrub.addEventListener('input', () => { seek((scrub.value / 1000) * (dur() || 0)); upd(); });
  master.addEventListener('timeupdate', upd);
  master.addEventListener('play', icon); master.addEventListener('pause', icon);
  master.addEventListener('ended', () => { if (!S.loop) both.forEach((v) => v.pause()); icon(); });
  both.forEach((v) => { v.loop = S.loop; });
  // l'autre suit la maîtresse : écart corrigé au-delà de 0,06 s (banc A/B)
  if (b) syncT = setInterval(() => { if (!playing()) return; if (a.readyState >= 2 && Math.abs(a.currentTime - b.currentTime) > 0.06) a.currentTime = b.currentTime; }, 200);
  const loop = () => { drawLoupe(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  $('#transport').replaceChildren(el('div', { class: 'transport' },
    playBtn,
    el('button', { class: 'tb ghost sm', type: 'button', title: 'image précédente (←)', onclick: () => step(-1) }, '‹ img'),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'image suivante (→)', onclick: () => step(1) }, 'img ›'),
    tc,
    el('div', { class: 'tl grow' }, el('div', { class: 'track' }, fill), el('div', { class: 'ticks' }), scrub),
    el('button', { class: 'tb sm ' + (S.loop ? 'on' : 'ghost'), type: 'button', title: 'en boucle', onclick: (e) => { S.loop = !S.loop; both.forEach((v) => { v.loop = S.loop; }); e.target.className = 'tb sm ' + (S.loop ? 'on' : 'ghost'); store.save(); } }, 'Boucle'),
    el('div', { class: 'seg aud', title: 'le son entendu' }, ...[['b', 'Son après'], ['a', 'avant'], ['0', 'muet']].map(([id, lab]) => {
      const x = el('button', { class: 'tb', type: 'button', onclick: () => { S.listen = id; audio(); } }, lab);
      x.dataset.a = id;
      return x;
    }))));
  audio(); icon(); upd();
  V.toggle = toggle; V.step = step;
}

function paintInfo() {
  const box = $('#info');
  const c = S.cur;
  if (!c) { box.replaceChildren(); return; }
  const it = c.b || c.a;
  const up = c.b?.upscale || {};
  const kv = c.b ? [
    ['avant', dims(c.a.width, c.a.height)], ['après', dims(c.b.width, c.b.height)],
    ['facteur', c.a.width ? `×${(c.b.width / c.a.width).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')}` : ''],
    ['modèle', modelName(c.b) + (/factice/.test(c.b.origin?.model || '') ? ' (factice)' : '')],
    ['réglage', [c.b.params?.color && c.b.params.model?.startsWith('seedvr2') ? `couleur ${c.b.params.color}` : '', c.b.params?.model === 'zimage-refine' ? `débruitage ${c.b.params.denoise}` : ''].filter(Boolean).join(' · ')],
    ['durée', fmtS(c.b.render_s)], ['machine', c.b.origin?.machine || ''], ['créée', fmtDate(c.b.created)],
    ['images', up.frames > 1 ? String(up.frames) : ''],
  ] : [['source', dims(c.a.width, c.a.height)], ['sorte', kindFr(c.a.kind)], ['durée', c.a.duration ? fmtDur(c.a.duration) : '']];
  const ext = (it.file || '.png').slice((it.file || '.png').lastIndexOf('.'));
  box.replaceChildren(el('section', { class: 'vbar' },
    el('div', { class: 'ttl' }, el('span', { class: 'lbl' }, c.b ? 'L’agrandie' : 'La source'), el('b', {}, it.title || it.id)),
    el('dl', { class: 'kv' }, ...kv.filter(([, v]) => v).flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
    el('div', { class: 'row acts' },
      c.b ? el('button', { class: 'tb ghost sm', type: 'button', title: 'voir la source seule', onclick: () => showPair(c.a, null) }, 'Source') : null,
      el('a', { class: 'tb ghost sm', href: href(it.url), download: `${(it.title || it.id).replace(/[^\w.-]+/g, '_').slice(0, 60)}${ext}` }, 'Télécharger'),
      el('a', { class: 'tb ghost sm', href: href('asset/#' + it.id) }, 'Ouvrir dans la bibliothèque'),
      el('a', { class: 'tb ghost sm', href: href('montage/?add=' + encodeURIComponent(it.id)), title: 'la poser au bout de la timeline du montage ouvert' }, 'Envoyer au montage'))));
}

// ── l'historique ────────────────────────────────────────────
async function loadHistory() {
  const side = $('#side');
  let res;
  try { res = await api('library?kind=image,video&tool=upscale&limit=120'); } catch (e) { side.replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
  side.replaceChildren(
    head('Historique', null, 'hist-h'),
    el('div', { class: 'r2' }, el('a', { class: 'lbl', href: href('asset/') }, `${res.total} dans Asset`)),
    res.items.length ? el('div', { class: 'grid sm hist' }, ...res.items.map((it) => {
      const t = thumb(it, { selected: S.cur?.b?.id === it.id, onclick: () => showResult(it),
        sub: [modelName(it), dims(it.width, it.height)].filter(Boolean).join(' · ') });
      t.dataset.id = it.id;
      return t;
    })) : el('p', { class: 'hint' }, 'Les agrandies se rangent dans la bibliothèque, avec leur source en lignée, et s’affichent ici.'));
}
function markHistory() { for (const b of $$('#side .thumb')) b.classList.toggle('sel', b.dataset.id === S.cur?.b?.id); }

// ── le clavier ──────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if ($('.scrim') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  const k = e.key;
  if (k >= '1' && k <= '4' && S.cur?.b) setView(['wipe', 'side', 'a', 'b'][+k - 1]);
  else if ((k === 'l' || k === 'L') && S.cur?.b) { S.loupe = !S.loupe; store.save(); paintTools(); hideLoupe(); }
  else if (k === '[') setWipe(S.wipe - 2);
  else if (k === ']') setWipe(S.wipe + 2);
  else if (k === ' ' && V.toggle && S.cur?.a?.kind === 'video') { e.preventDefault(); V.toggle(); }
  else if (k === 'ArrowLeft' && V.step && S.cur?.a?.kind === 'video') { e.preventDefault(); V.step(-1); }
  else if (k === 'ArrowRight' && V.step && S.cur?.a?.kind === 'video') { e.preventDefault(); V.step(1); }
});

dropAnywhere((files) => addFiles(files));

// ── démarrage ───────────────────────────────────────────────
async function start() {
  skeleton();
  wireViewer();
  $('#rail').prepend(el('p', { class: 'lbl', id: 'loading' }, 'chargement'));
  try { S.cfg = await api('upscale/models'); } catch (e) {
    $('#rail').replaceChildren(el('p', { class: 'warn' }, `le portail ne répond pas : ${e.message}`)); return;
  }
  $('#loading')?.remove();
  const d = store.get() || {};
  for (const k of ['model', 'mode', 'factor', 'ti', 'tv', 'color', 'denoise', 'view', 'loupe', 'loop']) if (d[k] !== undefined && d[k] !== null) S[k] = d[k];
  const q = new URLSearchParams(location.search);
  const srcs = q.getAll('src').flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  const ids = srcs.length ? srcs : (d.items || []);
  const got = (await Promise.all(ids.map((id) => api('library/' + id).catch(() => null)))).filter((it) => it && (it.kind === 'image' || it.kind === 'video'));
  if (srcs.length && got.length < srcs.length) toast('une source demandée n’est pas une image ou une vidéo de la bibliothèque', 6000);
  S.items = got;
  const m = M(S.model);
  if (!m || m.off) S.model = S.items.length && S.items.every((i) => i.kind === 'video') ? S.cfg.default.video : S.cfg.default.image;
  put($('#banner'), stub() ? el('div', { class: 'banner' }, el('b', {}, 'Moteur factice'),
    el('span', {}, 'les agrandies sont des bicubiques étiquetés « FACTICE » — aucun modèle n’est chargé. Le câblage réel est écrit : « upscale_backend » : « comfyui » dans showrunner.local.json.')) : '');
  paintIn(); paintModel(); paintSize(); paintSet(); paintAct(); paintViewer(); paintInfo();
  schedPlan();
  const want = location.hash.slice(1);
  if (want) { try { await showResult(await api('library/' + want)); } catch { /* introuvable */ } }
  else if (S.items.length) showSource(S.items[0]);
  loadHistory();
  if (S.cfg.availability_error) toast(`machines : ${S.cfg.availability_error}`, 6000);
}
addEventListener('hashchange', async () => {
  const id = location.hash.slice(1);
  if (id && id !== S.cur?.b?.id) { try { showResult(await api('library/' + id)); } catch { /* introuvable */ } }
});
start();
