// Image · l'atelier d'édition (Cal, 30/09) : « l'édition est un ATELIER en
// soi : on travaille avec l'image toujours sous les yeux en grand, et à
// droite un carrousel vertical avec les essais de variation, car c'est un
// mode où on itère beaucoup ».
//
//   au centre — l'image en grand : l'original, ou l'essai qu'on regarde ;
//               « Comparer » (l'original contre l'essai, une poignée), le
//               pinceau (UNE zone, sur la base : voir plus bas), « Partir de
//               cet essai » (il devient la base), « Valider » ;
//   à droite  — les essais, le plus récent en haut, l'original en bas : la
//               date, la consigne, l'état (en file, en cours, fini, échec) ;
//               un clic le montre ; ↑ ↓ passent de l'un à l'autre ;
//   en bas    — la base, les références (glisser depuis le panneau Asset),
//               le modèle, de petites INTENTIONS facultatives (elles
//               pré-remplissent la consigne, ou choisissent le graphe quand
//               le modèle l'exige), la consigne en langage naturel, et
//               « Essayer », le seul orange.
//
// La session (server/tools/image_atelier.py) est la seule vérité : les
// essais, la base, ce qu'on regarde, le brouillon de la consigne — tout
// s'enregistre seul (rien à « enregistrer ») ; revenir, c'est retrouver où on
// en était. Les essais ne sont pas des objets de la bibliothèque : « Valider »
// en fait UN, avec sa lignée.
//
// Le pinceau : une zone, une consigne, par essai. Aucun modèle installé ne
// prend de masque ; la zone est une boîte éditée puis recollée (image.py),
// et plusieurs zones ne sont pas documentées (README Qwen-Image 2.1 : une
// vitrine « multi-region », sans mode d'emploi). Plusieurs changements : des
// essais qui s'enchaînent.
//
// Adresses : ?s=<session> ; ?item=<image> (sa session, reprise ou neuve) ;
// &reuse=<image éditée> (sa consigne reprise) ; sans rien : choisir l'image.
import { mountHeader, api, pick, toast, el, $, href, fmtDate, dropZone, dragItem, dock, refBoard } from '../../commun/shell.js';
import { menu, contextMenu, pageMenu } from '../../commun/menu.js';
import { pickView } from '../../commun/proxies.js';
import { prefs } from '../../commun/prefs.js';

mountHeader('image', { sub: 'éditer' });

const LAST = 'sr-atelier-last';
const VIA = 'image';
const S = {
  cfg: null, acfg: null, s: null,
  draft: {}, refs: [], board: null,
  cmp: false, auto: false, pollT: null, saveT: null, composeT: null, notes: [],
  paint: { on: false, size: 48, dirty: false, canvas: null, for: '' },
};
const DOT = { qwen21: 'grn2', krea2: 'coral-2' };
const TOOL_FR = { instruct: 'consigne', matte: 'retirer le fond', upscale: 'agrandir', refine: 'affiner ×2', angle: 'angle' };
const DEF = { prompt: '', model: 'krea2', tool: 'instruct', intent: '', refs: [], looks: {}, keep_face: true, count: 1,
  factor: 2, denoise: 0.25, azimuth: 'front-right quarter view', elevation: 'eye-level shot', distance: 'medium shot', seed: '' };
const plural = (n, w, pl = w + 's') => `${n} ${n > 1 ? pl : w}`;
const fmtS = (s) => (s == null ? '' : s < 60 ? `${String(Math.round(s * 10) / 10).replace('.', ',')} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}`);
const M = (id) => S.cfg.models.find((m) => m.id === id);
const D = () => S.draft;
const T = (id) => S.s?.trials.find((t) => t.id === id) || null;
const newest = () => (S.s?.trials || []).slice().reverse();
const ro = () => S.s?.write_why || S.s?.source_why || '';
const label = (id) => (id === 'src' ? 'original' : `essai ${T(id)?.n ?? id.slice(1)}`);
// replaceChildren(null) écrirait « null » : on ne passe que des nœuds
const put = (node, ...kids) => node.replaceChildren(...kids.filter(Boolean));

// un petit menu qui s'ouvre vers le haut, au-dessus de sa puce
function up(anchor, items) {
  const r = anchor.getBoundingClientRect();
  const { node } = menu(r.left, r.top, items);
  if (!node) return;
  node.style.top = `${Math.max(8, r.top - node.getBoundingClientRect().height - 6)}px`;
}
function chip(text, { value = '', dot = null, onclick, title = '', cls = '', off = '' } = {}) {
  return el('button', { class: `pc ${cls}`.trim(), type: 'button', title: off || title || null, 'aria-disabled': off ? 'true' : null,
    onclick: (e) => { if (off) { toast(off, 5000); return; } onclick(e.currentTarget); } },
  dot ? el('i', { class: 'pc-dot', style: { background: `var(--${dot})` } }) : null,
  text ? el('span', { class: 'pc-l' }, text) : null, value ? el('b', {}, value) : null);
}

// ── la session : lue, enregistrée seule ─────────────────────
function setSession(s, { keepView = false } = {}) {
  const before = S.s;
  S.s = s;
  try { localStorage.setItem(LAST, s.id); } catch { /* stockage fermé */ }
  if (!keepView && !before) {
    S.draft = { ...DEF, model: prefs.get('image.editModel', DEF.model), ...(s.draft || {}) };
  }
  // la vue suit le premier essai fini d'un envoi, tant qu'on n'a pas choisi ailleurs
  if (S.auto) {
    const fresh = s.trials.filter((t) => t.state === 'done' && t.has_file && !before?.trials.find((x) => x.id === t.id && x.state === 'done'));
    if (fresh.length) { S.s.view = fresh[fresh.length - 1].id; S.auto = false; schedSave(); }
  }
  paintAll();
  schedPoll();
}
function schedSave() {
  clearTimeout(S.saveT);
  if (ro()) return;
  S.saveT = setTimeout(async () => {
    const d = { ...D(), refs: refsParam() };
    delete d.seed; delete d.refChoice; delete d.choice;
    // la vue et la base : l'original, ou un essai qui a son image (un essai en cours se regarde sans s'enregistrer)
    const kept = (id) => id === 'src' || !!T(id)?.has_file;
    const body = { draft: d, ...(kept(S.s.view) ? { view: S.s.view } : {}), ...(kept(S.s.base) ? { base: S.s.base } : {}) };
    try { await api(`image/atelier/${S.s.id}`, { method: 'POST', body }); } catch (e) {
      if (e.status !== 400) toast(`l’atelier ne s’enregistre pas : ${e.message}`, 6000);
    }
  }, 500);
}
function schedPoll() {
  clearTimeout(S.pollT);
  if (!S.s?.trials.some((t) => ['queued', 'running'].includes(t.state))) return;
  S.pollT = setTimeout(async () => {
    try { setSession(await api(`image/atelier/${S.s.id}`), { keepView: true }); } catch { schedPoll(); }
  }, 1200);
}

// ── ce que le modèle sait faire ─────────────────────────────
const stub = () => S.cfg?.backend === 'stub';
function avail(cap) {
  const a = S.cfg?.availability?.[cap];
  if (stub() || !a) return { ok: true, on: stub() ? ['factice'] : [] };
  const why = Object.entries(a.missing).map(([m, v]) => `${m} : ${v.join(', ')}`).join(' · ') || 'aucune machine';
  return a.on.length ? { ok: true, on: a.on } : { ok: false, why };
}
const capOf = () => (D().tool === 'instruct' ? (D().model === 'krea2' ? 'krea2:edit' : 'qwen21') : D().tool);
const intent = () => S.acfg?.intents.find((i) => i.id === D().intent) || null;
// l'intention qui exige un modèle (Retirer : Qwen) ; une référence adressée par <image2> aussi
function modelRule() {
  const i = intent();
  if (D().tool !== 'instruct' || !i) return null;
  if (i.model) return { model: i.model, why: i.model_why };
  if (i.ref_model && S.refs.length) return { model: i.ref_model, why: i.ref_why };
  return null;
}
function applyRule() {
  const r = modelRule();
  if (r && D().model !== r.model) { D().model = r.model; toast(`${M(r.model).name} : ${r.why}`, 6000); }
}
const sendRefs = () => Math.max(0, M(D().model).refs - 1);   // l'image éditée compte

// ── le modèle de phrase d'une intention ─────────────────────
function template(i = intent(), model = D().model) {
  if (!i) return '';
  const t = i.templates || (i.choices || []).find((c) => c.tool === D().tool || c.id === D().choice)?.templates || {};
  return (S.refs.length && t[`${model}_ref`]) || t[model] || t.qwen21 || '';
}
let lastTemplate = '';
// une intention remplit la consigne si elle est vide (ou encore le modèle d'avant) ; sinon elle reste en exemple
function fillTemplate() {
  const t = template();
  const ta = $('#prompt');
  if (t && (!D().prompt.trim() || D().prompt === lastTemplate)) { D().prompt = t; ta.value = t; }
  lastTemplate = t;
  paintText();
}
function pickIntent(i, anchor) {
  if (i.off) { toast(`${i.name} : ${i.off}`, 7000); return; }
  if (D().intent === i.id && !i.choices && !i.lights) { D().intent = ''; lastTemplate = ''; afterDraft(); return; }
  const set = (tool = 'instruct', choice = '') => {
    D().intent = i.id; D().tool = tool; D().choice = choice;
    applyRule(); fillTemplate(); afterDraft();
    if (tool === 'instruct') $('#prompt').focus();
  };
  if (i.choices) {
    up(anchor, [{ head: i.name }, ...i.choices.map((c) => ({ label: c.label, sub: (c.sub || '').toLowerCase(), title: `source : ${c.src}`,
      checked: D().intent === i.id && (D().choice === c.id || (c.tool !== 'instruct' && D().tool === c.tool)),
      onclick: () => set(c.tool, c.id) }))]);
    return;
  }
  if (i.lights) {
    const light = S.cfg.looks.find((g) => g.id === 'light');
    up(anchor, [{ head: 'Lumière · la consigne s’écrit ici' },
      { label: 'Écrire la mienne', sub: 'relight…', onclick: () => set() },
      '-',
      ...light.items.map((x) => ({ label: x.name, sub: (x.sub || '').toLowerCase(), title: `« ${x.edit || x.prose} »\nsource : ${x.src}`,
        onclick: () => { set(); D().prompt = `${x.edit || x.prose}; keep everything else unchanged.`; lastTemplate = D().prompt; paintText(); afterDraft(); } }))]);
    return;
  }
  set();
}

// ── tout repeindre ──────────────────────────────────────────
function paintAll() {
  $('#atl').hidden = false; $('#home').hidden = true;
  paintSrc(); paintStage(); paintRail(); paintBar(); followDock();
}
function paintSrc() {
  const it = S.s.source_item;
  const t = it ? pickView(it, 96).url : '';
  put($('#src'),
    el('span', { class: 'as-im', style: t ? { backgroundImage: `url("${t}")` } : null }),
    el('span', { class: 'as-t' }, el('b', {}, it?.title || S.s.source), el('span', { class: 'lbl' },
      `${plural(S.s.trials.length, 'essai')} · ${plural((S.s.validated || []).length, 'validé', 'validés')}${S.s.owner_name ? ` · ${S.s.owner_name}` : ''}`)),
    it ? el('a', { class: 'lbl as-a', href: href('asset/#' + it.id), title: 'la fiche de l’image d’origine dans Asset' }, 'dans Asset') : null);
  $('#banner').replaceChildren(...(stub() ? [el('span', { class: 'banner', title: 'des mires, aucun modèle chargé — Admin → Câblage' }, el('b', {}, 'Moteur factice'))] : []));
}

// ── la scène : l'image en grand ─────────────────────────────
function viewInfo(id) {
  const src = S.s.source_item;
  if (id === 'src' || !T(id)) return { id: 'src', url: src ? pickView(src, 2400).url : '', full: src ? href(src.url) : '', w: src?.width || 1024, h: src?.height || 1024, t: null };
  const t = T(id);
  const [bw, bh] = t.base_size || [src?.width || 1024, src?.height || 1024];
  return { id, url: t.url ? href(t.url) : '', w: t.width || bw, h: t.height || bh, t };
}
function fit(wrap, W, H) {
  const box = $('#st-box');
  const cs = getComputedStyle(box);
  const bw = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const bh = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (bw <= 0 || bh <= 0 || !W || !H) return;
  const k = Math.min(bw / W, bh / H);
  wrap.style.width = `${Math.round(W * k)}px`;
  wrap.style.height = `${Math.round(H * k)}px`;
}
function paintStage() {
  const v = viewInfo(S.s.view);
  const base = S.s.base;
  const t = v.t;
  const isBase = v.id === base;
  const P = S.paint;
  if (P.on && !isBase) P.on = false;
  if (S.cmp && v.id === 'src') S.cmp = false;
  // en haut : ce qu'on regarde ; les outils de la scène
  const bits = v.id === 'src' ? ['original', v.w && `${v.w} × ${v.h}`]
    : [`essai ${t.n}`, t.model ? (M(t.model)?.name || t.model) : TOOL_FR[t.tool], fmtDate(t.created), t.width && `${t.width} × ${t.height}`];
  const cmpOff = v.id === 'src' ? 'l’original : choisissez un essai pour le comparer' : !t?.url ? 'cet essai n’a pas d’image à comparer' : '';
  const paintOff = ro() || (!isBase ? `le pinceau peint la base (${label(base)}) : revenez-y, ou « Partir de cet essai »`
    : D().tool !== 'instruct' ? `${TOOL_FR[D().tool]} : toute l’image, pas de zone` : '');
  S.paintOff = paintOff;
  put($('#st-top'),
    el('span', { class: 'st-what' }, el('span', { class: 'lbl' }, bits.filter(Boolean).join(' · ')),
      isBase ? el('span', { class: 'st-tag' }, 'base') : null,
      t?.validated ? el('span', { class: 'st-tag ok' }, 'validé') : null),
    el('span', { class: 'sp' }),
    el('button', { class: 'tb sm ' + (S.cmp ? 'on' : 'ghost'), type: 'button', 'aria-pressed': S.cmp ? 'true' : 'false', 'aria-disabled': cmpOff ? 'true' : null,
      title: cmpOff || 'l’original contre cet essai : glissez la poignée (C)', onclick: () => (cmpOff ? toast(cmpOff, 5000) : toggleCmp()) }, 'Comparer'),
    el('button', { class: 'tb sm ' + (P.on ? 'on' : 'ghost'), type: 'button', 'aria-pressed': P.on ? 'true' : 'false', 'aria-disabled': paintOff ? 'true' : null,
      title: paintOff || 'peindre LA zone qui change (une zone par essai) — B', onclick: () => (paintOff ? toast(paintOff, 6000) : togglePaint()) }, 'Pinceau'),
    P.on ? el('label', { class: 'st-brush', title: 'la taille du pinceau' }, el('span', { class: 'lbl' }, 'taille'),
      el('input', { type: 'range', min: 8, max: 200, value: P.size, 'aria-label': 'taille du pinceau', oninput: (e) => { P.size = Number(e.target.value); } })) : null,
    P.dirty && P.for === paintKey() ? el('button', { class: 'tb ghost sm', type: 'button', title: 'effacer la zone : toute l’image change', onclick: () => { clearPaint(); paintStage(); paintBar(); } }, 'Effacer la zone') : null);
  // l'image (ou la comparaison), à sa place, contenue dans la scène
  const box = $('#st-box');
  const wrap = el('div', { class: 'st-wrap' + (S.cmp ? ' cmp' : '') });
  if (t && !t.url) {
    const b = viewInfo(t.base);
    wrap.append(el('img', { src: b.url, alt: '', class: 'dim', draggable: 'false' }),
      el('div', { class: 'st-wait' }, el('span', { class: 'lbl' }, stateFr(t)),
        ['queued', 'running'].includes(t.state) ? el('i', { class: 'st-bar', style: { width: `${Math.round((t.progress || 0.04) * 100)}%` } }) : null,
        t.message ? el('p', {}, t.message) : null));
  } else if (S.cmp) {
    const o = viewInfo('src');
    const imA = el('img', { src: o.url, alt: 'original', draggable: 'false', class: 'a' });
    const imB = el('img', { src: v.url, alt: 'essai', draggable: 'false', class: 'b' });
    const handle = el('div', { class: 'handle' }, el('div', { class: 'grip' }, el('i'), el('i')));
    const set = (x) => { const p = Math.max(0, Math.min(100, x)); imB.style.clipPath = `inset(0 0 0 ${p}%)`; handle.style.left = `${p}%`; };
    const move = (e) => { const r = wrap.getBoundingClientRect(); set(((e.clientX - r.left) / r.width) * 100); };
    wrap.addEventListener('pointerdown', (e) => { wrap.setPointerCapture(e.pointerId); move(e); wrap.onpointermove = move; });
    wrap.addEventListener('pointerup', () => { wrap.onpointermove = null; });
    wrap.append(imA, imB, handle, el('span', { class: 'cap a' }, 'original'), el('span', { class: 'cap b' }, `essai ${t.n}`));
    set(50);
  } else {
    const img = el('img', { src: v.url, alt: v.id === 'src' ? 'l’original' : `essai ${t.n}`, draggable: 'false' });
    wrap.append(img);
    if (v.id === 'src' && S.s.source_item) dragItem(img, S.s.source_item);
    if (isBase && D().tool === 'instruct') wrap.append(paintCanvas(v.w, v.h));
  }
  box.replaceChildren(wrap);
  fit(wrap, v.w, v.h);
  // en bas : la consigne de l'essai, et ce qu'on en fait
  paintFoot(v, isBase);
}
const stateFr = (t) => ({ queued: 'en file', running: `en cours · ${Math.round((t.progress || 0) * 100)} %`, error: 'échec', cancelled: 'arrêté' }[t.state]
  || (t.purged ? 'fichier nettoyé' : 'pas d’image'));
function paintFoot(v, isBase) {
  const t = v.t;
  const foot = $('#st-foot');
  if (!t) {
    put(foot, el('p', { class: 'st-p' }, S.s.base === 'src' ? 'L’original : vos essais partent de lui.'
      : `L’original. Vos essais partent de l’${label(S.s.base)}.`),
    el('span', { class: 'sp' }),
    S.s.base !== 'src' ? el('button', { class: 'tb ghost sm', type: 'button', disabled: ro() ? true : null, title: ro() || 'les essais suivants partent de l’original',
      onclick: () => setBase('src') }, 'Repartir de l’original') : null);
    return;
  }
  const baseOff = ro() || (isBase ? 'c’est déjà la base' : !t.has_file ? 'cet essai n’a pas d’image' : '');
  const valOff = S.s.write_why || (!t.has_file ? (t.purged ? 'fichier nettoyé (règle de l’atelier) : il ne se valide plus' : 'pas encore d’image') : '');
  put(foot,
    el('div', { class: 'st-p' }, el('span', { class: 'lbl' }, `${label(t.id)} · depuis l’${label(t.base)}${t.intent ? ` · ${(S.acfg.intents.find((i) => i.id === t.intent)?.name || '').toLowerCase()}` : ''}${t.mask ? ' · zone' : ''}`),
      el('p', { title: t.prompt_sent ? `prompt envoyé : ${t.prompt_sent}` : '' }, t.prompt || TOOL_FR[t.tool] || t.tool)),
    el('span', { class: 'sp' }),
    el('button', { class: 'tb ghost sm', type: 'button', 'aria-disabled': baseOff ? 'true' : null, title: baseOff || 'les essais suivants partent de celui-ci',
      onclick: () => (baseOff ? toast(baseOff, 4000) : setBase(t.id)) }, 'Partir de cet essai'),
    t.validated ? el('a', { class: 'tb ghost sm', href: href('asset/#' + t.validated), title: 'l’image validée, dans la bibliothèque' }, 'Validé · dans Asset')
      : el('button', { class: 'tb on sm', type: 'button', 'aria-disabled': valOff ? 'true' : null,
        title: valOff || 'cet essai devient une image de la bibliothèque (une seule, avec sa lignée) ; les autres restent ici',
        onclick: () => (valOff ? toast(valOff, 5000) : validate(t)) }, 'Valider'),
    t.validated && S.s.source_item?.version?.of ? el('button', { class: 'tb ghost sm', type: 'button', title: 'l’image d’origine est une version d’un élément : publier celle-ci comme la suivante',
      onclick: () => publishVersion(t) }, 'Publier en version') : null);
}
function toggleCmp() { S.cmp = !S.cmp; if (S.cmp) S.paint.on = false; paintStage(); }
function setView(id, { user = true } = {}) {
  if (!S.s || S.s.view === id) return;
  if (user) S.auto = false;
  S.s.view = id;
  schedSave(); paintStage(); paintRail();
  $(`#rail [data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function setBase(id) {
  if (ro()) { toast(ro(), 5000); return; }
  S.s.base = id;
  if (S.paint.for !== paintKey()) clearPaint();
  schedSave(); paintStage(); paintRail(); paintBar();
  toast(`les essais suivants partent de l’${label(id)}`);
}

// ── le pinceau : UNE zone, sur la base ──────────────────────
const paintKey = () => `${S.s?.id}:${S.s?.base}`;
function togglePaint() { S.paint.on = !S.paint.on; if (S.paint.on) S.cmp = false; paintStage(); }
function paintCanvas(w, h) {
  const P = S.paint;
  if (!P.canvas || P.for !== paintKey() || P.canvas.width !== w || P.canvas.height !== h) {
    P.canvas = el('canvas', { class: 'paint', width: w, height: h });
    P.for = paintKey(); P.dirty = false;
    let drawing = false;
    const ctx = P.canvas.getContext('2d');
    const pos = (e) => { const r = P.canvas.getBoundingClientRect(); return [(e.clientX - r.left) * P.canvas.width / r.width, (e.clientY - r.top) * P.canvas.height / r.height]; };
    const dot = (e) => {
      const [x, y] = pos(e);
      const r = P.canvas.getBoundingClientRect();
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--or').trim();
      ctx.beginPath(); ctx.arc(x, y, (P.size / 2) * P.canvas.width / r.width, 0, Math.PI * 2); ctx.fill();
      if (!P.dirty) { P.dirty = true; paintBar(); }
    };
    P.canvas.addEventListener('pointerdown', (e) => { if (!P.on) return; drawing = true; P.canvas.setPointerCapture(e.pointerId); dot(e); });
    P.canvas.addEventListener('pointermove', (e) => { if (drawing && P.on) dot(e); });
    P.canvas.addEventListener('pointerup', () => { if (drawing) { drawing = false; paintStage(); } });
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
  if (!P.canvas || !P.dirty || P.for !== paintKey()) return null;
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
// la zone d'un essai, reprise sur la base (si c'est la même base)
async function reuseZone(t) {
  const v = viewInfo(S.s.base);
  const img = new Image();
  img.src = href(t.mask_url);
  try { await img.decode(); } catch { toast('la zone de cet essai ne se relit pas'); return; }
  setView(S.s.base);
  const cv = paintCanvas(v.w, v.h);
  const ctx = cv.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = v.w; tmp.height = v.h;
  const tc = tmp.getContext('2d');
  tc.drawImage(img, 0, 0, v.w, v.h);
  const data = tc.getImageData(0, 0, v.w, v.h);
  const col = getComputedStyle(document.documentElement).getPropertyValue('--or').trim();
  ctx.clearRect(0, 0, v.w, v.h);
  ctx.fillStyle = col;
  for (let y = 0; y < v.h; y += 1) for (let x = 0; x < v.w; x += 1) if (data.data[(y * v.w + x) * 4] > 127) ctx.fillRect(x, y, 1, 1);
  S.paint.dirty = true;
  paintStage(); paintBar();
  toast('la zone de cet essai est reprise');
}

// ── à droite : les essais ───────────────────────────────────
function paintRail() {
  const rail = $('#rail');
  const keep = rail.querySelector('.rl-list')?.scrollTop || 0;
  const k = S.s.keep || { files: 48, days: 30 };
  const card = (t) => {
    const on = S.s.view === t.id;
    const busy = ['queued', 'running'].includes(t.state);
    const b = el('button', { class: `tr${on ? ' on' : ''}${S.s.base === t.id ? ' base' : ''}${busy ? ' busy' : ''}${t.state === 'error' || t.state === 'cancelled' ? ' err' : ''}`,
      type: 'button', 'data-id': t.id, 'aria-current': on ? 'true' : null, onclick: () => setView(t.id) },
    el('span', { class: 'tr-im', style: t.thumb_url ? { backgroundImage: `url("${href(t.thumb_url)}")` } : null },
      busy ? el('i', { class: 'tr-bar', style: { width: `${Math.round((t.progress || 0.04) * 100)}%` } }) : null,
      !t.thumb_url ? el('span', { class: 'lbl' }, stateFr(t)) : null),
    el('span', { class: 'tr-h' }, el('b', { class: 'lbl' }, `essai ${t.n}`), el('time', { class: 'lbl', datetime: t.created }, fmtDate(t.created))),
    el('span', { class: 'tr-p' }, t.prompt || TOOL_FR[t.tool] || t.tool),
    el('span', { class: 'tr-tags' },
      S.s.base === t.id ? el('span', { class: 'st-tag' }, 'base') : null,
      t.validated ? el('span', { class: 'st-tag ok' }, 'validé') : null,
      t.mask ? el('span', { class: 'st-tag dim' }, 'zone') : null,
      t.purged && !t.validated ? el('span', { class: 'st-tag dim', title: `fichier nettoyé : l’atelier garde ${k.files} fichiers, et ${k.days} jours sans geste` }, 'nettoyé') : null,
      busy ? el('span', { class: 'st-tag dim' }, stateFr(t)) : null,
      t.state === 'error' ? el('span', { class: 'st-tag err', title: t.message || '' }, 'échec') : null));
    b._menu = () => trialMenu(t);
    return b;
  };
  const src = S.s.source_item;
  const orig = el('button', { class: `tr orig${S.s.view === 'src' ? ' on' : ''}${S.s.base === 'src' ? ' base' : ''}`, type: 'button', 'data-id': 'src',
    onclick: () => setView('src') },
  el('span', { class: 'tr-im', style: src ? { backgroundImage: `url("${pickView(src, 240).url}")` } : null }),
  el('span', { class: 'tr-h' }, el('b', { class: 'lbl' }, 'original'), el('time', { class: 'lbl' }, fmtDate(src?.created))),
  el('span', { class: 'tr-tags' }, S.s.base === 'src' ? el('span', { class: 'st-tag' }, 'base') : null));
  orig._menu = () => [{ head: 'l’original' }, { label: 'Voir', onclick: () => setView('src') },
    { label: 'Repartir de l’original', disabled: S.s.base === 'src' || !!ro(), why: ro() || 'c’est déjà la base', onclick: () => setBase('src') }];
  const list = el('div', { class: 'rl-list' }, ...newest().map(card), orig);
  rail.replaceChildren(
    el('div', { class: 'rl-h' }, el('span', { class: 'lbl' }, 'essais'), el('span', { class: 'lbl rl-n' }, String(S.s.trials.length)),
      el('span', { class: 'sp' }),
      el('span', { class: 'lbl rl-rule', title: `les essais ne sont pas dans la bibliothèque tant qu’on ne valide pas ; l’atelier garde les ${k.files} derniers fichiers, et une session sans geste depuis ${k.days} jours perd ses fichiers (les lignes restent)` },
        `${k.files} gardés`)),
    list);
  list.scrollTop = keep;
}
function trialMenu(t) {
  const same = t.base === S.s.base;
  return [{ head: `essai ${t.n} · ${fmtDate(t.created)}` },
    { label: 'Voir', onclick: () => setView(t.id) },
    { label: 'Comparer à l’original', disabled: !t.has_file, why: 'pas d’image', onclick: () => { setView(t.id); S.cmp = true; paintStage(); } },
    { label: 'Partir de cet essai', disabled: !t.has_file || S.s.base === t.id || !!ro(), why: ro() || (S.s.base === t.id ? 'c’est déjà la base' : 'pas d’image'), onclick: () => setBase(t.id) },
    '-',
    { label: 'Reprendre sa consigne', sub: 'la barre', disabled: !!ro(), why: ro(), onclick: () => reuseTrial(t) },
    t.mask_url ? { label: 'Reprendre sa zone', disabled: !same || !!ro(), why: ro() || `sa zone est peinte sur l’${label(t.base)}, pas sur la base`, onclick: () => reuseZone(t) } : null,
    t.validated ? { label: 'Voir dans Asset', onclick: () => { location.href = href('asset/#' + t.validated); } }
      : { label: 'Valider', disabled: !t.has_file || !!S.s.write_why, why: S.s.write_why || 'pas d’image', onclick: () => validate(t) },
    '-',
    { label: 'Retirer de l’historique', icon: '×', danger: true, disabled: !!ro(), why: ro(), onclick: () => forget(t) }];
}
function reuseTrial(t) {
  Object.assign(D(), { tool: t.tool, model: t.model || D().model, prompt: t.prompt || '', intent: t.intent || '', looks: { ...(t.looks || {}) },
    keep_face: t.keep_face ?? D().keep_face, factor: t.factor || D().factor, denoise: t.denoise ?? D().denoise,
    azimuth: t.azimuth || D().azimuth, elevation: t.elevation || D().elevation, distance: t.distance || D().distance, seed: String(t.seed ?? '') });
  lastTemplate = '';
  setRefsFrom(t.refs || []).then(() => { afterDraft(); $('#prompt').focus(); toast(`la consigne de l’essai ${t.n}, graine comprise : changez un mot, essayez`, 5000); });
}
async function setRefsFrom(list) {
  const got = (await Promise.all(list.map((r) => api('library/' + (r.item || r)).catch(() => null)))).filter(Boolean);
  S.draft.refChoice = Object.fromEntries(list.filter((r) => r.ref).map((r) => [r.item, r.ref]));
  S.refs = got;
  S.silent = true;
  S.board?.set(got);
  S.silent = false;
}

// ── en bas : la consigne ────────────────────────────────────
function paintBar() {
  const E = D();
  const off = ro();
  const bar = $('#bar');
  bar.classList.toggle('ro', !!off);
  // la base, les références, le modèle, le nombre, le reste
  const row = $('#ab-row');
  const kids = [chip('base', { value: label(S.s.base), cls: S.s.base === 'src' ? '' : 'set',
    title: 'ce dont partent les essais', onclick: (a) => up(a, [{ head: `base · ${label(S.s.base)}` },
      { label: 'Voir la base', onclick: () => setView(S.s.base) },
      { label: 'Repartir de l’original', disabled: S.s.base === 'src' || !!off, why: off || 'c’est déjà l’original', onclick: () => setBase('src') }]) })];
  const refBox = el('div', { class: 'ab-refs' });
  if (E.tool === 'instruct') kids.push(refBox);
  kids.push(el('span', { class: 'sp' }));
  if (E.tool === 'instruct') {
    const rule = modelRule();
    kids.push(chip('', { value: M(E.model).name, dot: DOT[E.model], title: M(E.model).role, onclick: (a) => up(a, [{ head: 'Modèle' },
      ...['krea2', 'qwen21'].map((id) => ({ label: M(id).name, dot: DOT[id], checked: E.model === id, sub: `${M(id).refs - 1} réf.`,
        disabled: !!(rule && rule.model !== id), why: rule ? `${M(id).name} : ${rule.why}` : '', title: M(id).role,
        onclick: () => { E.model = id; fillTemplate(); afterDraft(); } }))]) }));
  } else {
    kids.push(chip('', { value: TOOL_FR[E.tool], cls: 'set', title: S.cfg.edit_tools.find((x) => x.id === E.tool)?.about || '',
      onclick: (a) => up(a, [{ head: TOOL_FR[E.tool] }, { label: 'Revenir à la consigne', onclick: () => { E.tool = 'instruct'; E.intent = ''; afterDraft(); } }]) }));
    if (E.tool === 'upscale') kids.push(chip('facteur', { value: `×${E.factor}`, onclick: (a) => up(a, [2, 4].map((f) => ({ label: `×${f}`, checked: E.factor === f, onclick: () => { E.factor = f; afterDraft(); } }))) }));
    if (E.tool === 'refine') kids.push(chip('débruitage', { value: E.denoise.toFixed(2).replace('.', ','), onclick: (a) => up(a, [{ head: 'débruitage · gabarit Z-Image 2K : 0,15–0,35' },
      ...[0.15, 0.2, 0.25, 0.3, 0.35].map((x) => ({ label: x.toFixed(2).replace('.', ','), checked: E.denoise === x, onclick: () => { E.denoise = x; afterDraft(); } }))]) }));
    if (E.tool === 'angle') {
      for (const [key, list, name] of [['azimuth', S.cfg.angles.azimuth, 'vue'], ['elevation', S.cfg.angles.elevation, 'hauteur'], ['distance', S.cfg.angles.distance, 'distance']]) {
        kids.push(chip(name, { value: (list.find(([x]) => x === E[key]) || [])[1] || E[key], onclick: (a) => up(a, list.map(([id, fr]) => ({ label: fr, sub: id, checked: E[key] === id, onclick: () => { E[key] = id; afterDraft(); } }))) }));
      }
    }
  }
  if (['instruct', 'angle', 'refine'].includes(E.tool)) {
    const set = (n) => { E.count = Math.max(1, Math.min(4, n)); afterDraft(); };
    kids.push(el('span', { class: 'pc count', title: 'essais par envoi, 4 au plus (des graines qui se suivent)' },
      el('button', { type: 'button', 'aria-label': 'un de moins', disabled: E.count <= 1 ? true : null, onclick: () => set(E.count - 1) }, '−'),
      el('b', {}, `${E.count}/4`),
      el('button', { type: 'button', 'aria-label': 'un de plus', disabled: E.count >= 4 ? true : null, onclick: () => set(E.count + 1) }, '+')));
  }
  kids.push(chip('', { value: '⋯', cls: 'ic', title: 'les autres outils, le visage, la graine', onclick: (a) => up(a, moreItems()) }));
  row.replaceChildren(...kids);
  // les références : le carrousel commun (commun/refs.js) — l'image éditée est <image1>, elles suivent
  if (E.tool === 'instruct') {
    S.board = refBoard(refBox, { kinds: ['image', 'element'], max: 9, send: sendRefs, via: VIA, label: 'réf.',
      heldWhy: () => `${M(E.model).name} : ${plural(sendRefs(), 'référence')} en plus de l’image éditée`,
      onchange: (list) => {
        if (S.silent) return;   // la barre qui se repeint n'est pas un geste
        S.refs = list.slice(); applyRule(); fillTemplate(); afterDraft({ board: false });
      } });
    S.silent = true;
    S.board.set(S.refs);
    S.silent = false;
    refBox.title = 'des références : un style, un objet à ajouter (glissez-les depuis le panneau Asset)';
  } else S.board = null;
  // les intentions : facultatives, petites
  $('#intents').replaceChildren(el('span', { class: 'lbl' }, 'intention'), ...S.acfg.intents.map((i) => {
    const on = E.intent === i.id;
    return el('button', { class: `it${on ? ' on' : ''}`, type: 'button', 'aria-pressed': on ? 'true' : 'false', 'aria-disabled': i.off || off ? 'true' : null,
      title: i.off ? `${i.name} : ${i.off}` : `${i.about}${i.model_why ? `\n${i.model_why}` : ''}\nsource : ${i.src || (i.choices || []).map((c) => c.src).join(' ; ')}`,
      onclick: (e) => (off ? toast(off, 5000) : pickIntent(i, e.currentTarget)) }, i.name);
  }));
  paintText();
  paintAct();
}
function moreItems() {
  const E = D();
  const v = T(S.s.view);
  return [{ head: 'autres outils · leur propre graphe' },
    ...['angle', 'upscale', 'refine', 'matte'].map((id) => {
      const t = S.cfg.edit_tools.find((x) => x.id === id);
      return { label: t?.name || id, sub: (t?.sub || '').toLowerCase(), checked: E.tool === id, title: t?.about || '',
        onclick: () => { E.tool = id; E.intent = id === 'matte' ? 'background' : ''; afterDraft(); } };
    }),
    E.tool !== 'instruct' ? { label: 'Revenir à la consigne', onclick: () => { E.tool = 'instruct'; E.intent = ''; afterDraft(); } } : null,
    '-',
    E.tool === 'instruct' ? { label: 'Garder le visage', checked: !!E.keep_face, title: E.model === 'qwen21' ? 'phrase du gabarit officiel Qwen 2.1' : 'phrase de Character Factory (banc du 28/09)',
      onclick: () => { E.keep_face = !E.keep_face; afterDraft(); } } : null,
    { head: `graine · ${E.seed ? E.seed : 'au hasard'}` },
    { label: 'Au hasard', checked: !E.seed, onclick: () => { E.seed = ''; afterDraft(); } },
    v?.seed != null ? { label: `Celle de l’essai ${v.n}`, sub: String(v.seed), checked: E.seed === String(v.seed), onclick: () => { E.seed = String(v.seed); afterDraft(); } } : null];
}
function paintText() {
  const E = D();
  const ta = $('#prompt'), fx = $('#fixed');
  const typed = E.tool === 'instruct' || E.tool === 'refine';
  ta.hidden = !typed;
  fx.hidden = typed;
  if (!typed) {
    fx.textContent = { matte: 'Le sujet seul, sur fond transparent (BiRefNet) : aucune consigne.', upscale: `×${E.factor} par SeedVR2 7B, sans rien inventer.`,
      angle: 'La même scène, vue d’ailleurs (Qwen-Image-Edit 2511, LoRA d’angles).' }[E.tool] || '';
    return;
  }
  if (ta.value !== E.prompt) ta.value = E.prompt || '';
  const t = template();
  ta.placeholder = E.tool === 'refine' ? 'Une description détaillée de l’image, en anglais'
    : t || (E.model === 'qwen21' ? 'Dites le changement, en anglais : « Change the jacket in <image1> to red leather »'
      : 'Dites le changement, en anglais : « Recolor the jacket to red leather »');
  ta.readOnly = !!ro();
}
function afterDraft({ board = true } = {}) {
  schedSave(); schedCompose();
  if (board) paintBar(); else { paintAct(); }
  paintStage();
}

// le prompt envoyé : composé par le serveur (les notes : une référence présentée d'office…)
function schedCompose() { clearTimeout(S.composeT); S.composeT = setTimeout(doCompose, 250); }
async function doCompose() {
  const E = D();
  if (E.tool !== 'instruct') { S.notes = []; paintNote(); return; }
  try {
    const r = await api('image/compose', { method: 'POST', body: { mode: 'edit', model: E.model, prompt: E.prompt, looks: E.looks, refs: refsParam(), keep_face: E.keep_face } });
    S.notes = r.notes || []; S.sent = r.prompt;
  } catch (e) { S.notes = [e.message]; }
  paintNote();
}
function paintNote() {
  const n = $('#note');
  const rule = modelRule();
  const notes = [...(rule ? [`${M(rule.model).name} : ${rule.why}`] : []), ...S.notes];
  const i = intent();
  if (i?.zone && !S.paint.dirty) notes.push('peignez la zone à retirer (Pinceau) : rien ne change hors d’elle');
  n.hidden = !notes.length;
  n.textContent = notes.join(' · ');
  n.title = [...notes, S.sent ? `prompt envoyé : ${S.sent}` : ''].filter(Boolean).join('\n');
}
const refsParam = () => S.refs.map((it) => ({ item: it.id, ...(S.draft.refChoice?.[it.id] ? { ref: S.draft.refChoice[it.id] } : {}) }));

// à droite de la consigne : « Essayer », le seul orange
function measured() {
  const E = D();
  const want = E.tool === 'instruct' ? `${E.model}-edit` : { matte: 'birefnet', upscale: 'seedvr2', refine: 'zimage-refine', angle: 'qwen-edit-2511-angles' }[E.tool];
  const xs = S.s.trials.filter((t) => t.render_s && (t.model_id || '').startsWith(want)).map((t) => t.render_s).sort((a, b) => a - b);
  return xs.length ? `≈ ${fmtS(xs[Math.floor(xs.length / 2)])}` : 'temps non mesuré';
}
function paintAct() {
  const E = D();
  const a = avail(capOf());
  const n = ['instruct', 'angle', 'refine'].includes(E.tool) ? E.count : 1;
  const why = S.s.source_why || S.s.write_why || S.s.compute_why || (!a.ok ? `modèle absent — ${a.why}` : '')
    || (E.tool === 'instruct' && !E.prompt.trim() ? 'écrivez la consigne (ou choisissez une intention)' : '')
    || (T(S.s.base) && !T(S.s.base).has_file ? 'la base n’a plus d’image : repartez de l’original' : '');
  const zone = E.tool === 'instruct' && S.paint.dirty && S.paint.for === paintKey();
  $('#act').replaceChildren(...[
    el('button', { class: 'tb go ab-gen', type: 'button', disabled: why ? true : null,
      title: `depuis l’${label(S.s.base)}${zone ? ', sur la zone peinte' : ''} · Ctrl+Entrée${a.on?.length ? `\n${a.on.join(' + ')}` : ''}`, onclick: runTrial },
    el('span', { class: 'gl' }, 'Essayer'), el('small', {}, `${zone ? 'zone · ' : ''}${n > 1 ? `${n} × ` : ''}${measured()}`)),
    why ? el('p', { class: 'why' }, why) : null].filter(Boolean));
  paintNote();
}

// ── les gestes vers le serveur ──────────────────────────────
async function runTrial() {
  const E = D();
  const btn = $('#act .ab-gen');
  if (btn) btn.disabled = true;
  const body = { tool: E.tool, model: E.model, prompt: E.prompt, looks: E.looks, keep_face: E.keep_face, refs: refsParam(), count: E.count,
    base: S.s.base, intent: E.intent, factor: E.factor, denoise: E.denoise, azimuth: E.azimuth, elevation: E.elevation, distance: E.distance };
  if (E.seed) body.seed = Number(E.seed);
  if (E.tool === 'instruct') { const m = maskDataUrl(); if (m) body.mask = m; }
  try {
    const r = await api(`image/atelier/${S.s.id}/run`, { method: 'POST', body });
    S.auto = true;
    setSession(r, { keepView: true });
    toast(r.made.length > 1 ? `${r.made.length} essais en file — à droite` : 'essai en file — à droite');
  } catch (e) { toast(e.message, 8000); paintAct(); }
}
async function validate(t) {
  try {
    const r = await api(`image/atelier/${S.s.id}/validate`, { method: 'POST', body: { trial: t.id } });
    setSession(r.session, { keepView: true });
    toast(`validé : « ${r.item.title} » est dans la bibliothèque — les autres essais restent ici`, 6000);
    dock.recent?.([r.item]);
  } catch (e) { toast(e.message, 7000); }
}
async function publishVersion(t) {
  const of = S.s.source_item?.version?.of;
  try {
    const r = await api(`elements/${of}/versions`, { method: 'POST', body: { item: t.validated } });
    toast(`publiée : v${r.version.n} de l’élément`, 5000);
  } catch (e) { toast(e.message, 7000); }
}
async function forget(t) {
  try {
    const s = await api(`image/atelier/${S.s.id}/forget`, { method: 'POST', body: { trial: t.id } });
    setSession(s, { keepView: true });
  } catch (e) { toast(e.message, 6000); }
}

// ── ouvrir ──────────────────────────────────────────────────
async function openItem(id, reuse = '') {
  let s;
  try { s = await api('image/atelier/open', { method: 'POST', body: { item: id } }); } catch (e) { toast(e.message, 8000); showHome(); return; }
  S.s = null;
  setSession(s);
  try { history.replaceState(null, '', `${location.pathname}?s=${encodeURIComponent(s.id)}`); } catch { /* sans historique */ }
  await setRefsFrom(s.draft?.refs || []);
  if (reuse) {
    const it = await api('library/' + encodeURIComponent(reuse)).catch(() => null);
    const p = it?.params || {};
    if (p.job === 'image.edit') {
      Object.assign(D(), { tool: p.tool || 'instruct', model: ['qwen21', 'krea2'].includes(p.model) ? p.model : D().model, prompt: p.prompt || '',
        looks: { ...(p.looks || {}) }, keep_face: p.keep_face ?? D().keep_face, factor: p.factor || D().factor, denoise: p.denoise ?? D().denoise,
        azimuth: p.azimuth || D().azimuth, elevation: p.elevation || D().elevation, distance: p.distance || D().distance, intent: '' });
      await setRefsFrom([...(p.refs || []), ...(p.refs_held || [])]);
      toast(`la consigne de « ${it.title} » est reprise, graine vidée`, 5000);
    }
  }
  if (s.created_now) toast('l’atelier de cette image : vos essais se rangeront à droite');
  afterDraft();
}
async function openSession(sid) {
  let s;
  try { s = await api(`image/atelier/${encodeURIComponent(sid)}`); } catch (e) {
    try { localStorage.removeItem(LAST); } catch { /* */ }
    toast(`${e.message} — choisissez une image`, 6000); showHome(); return;
  }
  S.s = null;
  setSession(s);
  await setRefsFrom(s.draft?.refs || []);
  afterDraft();
}
function go(id) { location.href = `./?item=${encodeURIComponent(id)}`; }

// ── sans session : choisir l'image, ou reprendre ────────────
async function showHome() {
  $('#atl').hidden = true; $('#home').hidden = false;
  S.s = null;
  dock.contexte({ kinds: ['image'], label: 'l’image à éditer' });
  let list = [];
  try { list = (await api('image/atelier')).sessions; } catch (e) { toast(e.message); }
  $('#count').textContent = list.length ? plural(list.length, 'image') : '';
  $('#sessions').replaceChildren(...(list.length ? list.map((x) => el('a', { class: 'ah-card', href: `./?s=${encodeURIComponent(x.id)}` },
    el('span', { class: 'ah-im', style: x.thumb_url ? { backgroundImage: `url("${href(x.thumb_url)}")` } : null }),
    el('b', {}, x.title), el('span', { class: 'lbl' }, `${plural(x.trials, 'essai')} · ${x.validated ? `${x.validated} validé${x.validated > 1 ? 's' : ''} · ` : ''}${fmtDate(x.updated)}`),
    x.gone ? el('span', { class: 'lbl warn' }, 'l’original est parti') : null))
    : [el('p', { class: 'hint' }, 'Aucune image en cours d’édition dans ce Workspace.')]));
}
$('#pick').addEventListener('click', async () => { const [it] = await pick({ kinds: ['image'], title: 'L’image à éditer' }); if (it) go(it.id); });
dropZone($('#drop'), { kinds: ['image'], multiple: false, via: VIA, label: 'l’image à éditer', onitems: ([it]) => go(it.id) });
// sur la scène : une autre image déposée ouvre son atelier
dropZone($('#stage'), { kinds: ['image'], multiple: false, via: VIA, label: 'l’image à éditer', onitems: ([it]) => {
  if (it.id === S.s?.source) return;
  go(it.id);
} });

// ── le panneau Asset (commun/dock.js) ───────────────────────
// poser : une référence (en consigne), ou l'image à éditer (sans session)
function followDock() {
  if (!S.s) { dock.contexte({ kinds: ['image'], label: 'l’image à éditer' }); return; }
  if (D().tool !== 'instruct') { dock.contexte({ kinds: [], label: 'les références', why: `${TOOL_FR[D().tool]} : pas de référence` }); return; }
  dock.contexte({ kinds: ['image', 'element'], label: 'les références' });
}
dock.configure({
  label: 'l’atelier',
  placeLabel: 'Poser dans l’atelier',
  hint: 'double-clic : en référence · glisser : sur la consigne, ou sur l’image pour l’éditer',
  place: (items) => {
    if (!S.s) { const img = items.find((x) => x.kind === 'image'); if (img) { go(img.id); return true; } return false; }
    if (D().tool !== 'instruct' || !S.board) { toast(`${TOOL_FR[D().tool]} : pas de référence`); return false; }
    const n = S.refs.length;
    S.board.set([...S.refs, ...items.filter((x) => !S.refs.some((r) => r.id === x.id))].slice(0, 9));
    return S.refs.length > n;
  },
  menu: (it, chosen) => {
    const img = chosen.length === 1 && it.kind === 'image' ? it : null;
    return [img && img.id !== S.s?.source ? { label: 'Éditer cette image', sub: 'son atelier', onclick: () => go(img.id) } : null];
  },
});

// ── le clavier ──────────────────────────────────────────────
const typingIn = (t) => !!(t instanceof Element && t.closest('input, textarea, select, [contenteditable]'));
$('#prompt').addEventListener('input', (e) => { D().prompt = e.target.value; schedSave(); schedCompose(); paintAct(); });
$('#prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#act .ab-gen')?.click(); }
});
document.addEventListener('keydown', (e) => {
  if (!S.s || typingIn(e.target) || document.querySelector('.sr-menu, .scrim:not([hidden])') || e.ctrlKey || e.metaKey || e.altKey) return;
  const ids = [...newest().map((t) => t.id), 'src'];
  const k = ids.indexOf(S.s.view);
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const n = Math.max(0, Math.min(ids.length - 1, k + (e.key === 'ArrowDown' ? 1 : -1)));
    setView(ids[n]);
  } else if (e.key === 'c' || e.key === 'C') {
    if (S.s.view !== 'src') toggleCmp();
  } else if (e.key === 'b' || e.key === 'B') {
    if (S.paintOff) toast(S.paintOff, 5000); else togglePaint();
  } else if (e.key === 'Escape' && (S.cmp || S.paint.on)) {
    S.cmp = false; S.paint.on = false; paintStage();
  }
});
if ('ResizeObserver' in window) new ResizeObserver(() => { const w = $('#st-box .st-wrap'); if (w && S.s) { const v = viewInfo(S.s.view); fit(w, v.w, v.h); } }).observe($('#st-box'));

// ── le clic droit : les essais ; ailleurs, les gestes de l'atelier ──
contextMenu($('#rail'), (e) => e.target.closest('.tr')?._menu?.() || null);
pageMenu(() => {
  if (!S.s) return [{ head: 'Image · éditer' }, { label: 'Choisir une image…', onclick: () => $('#pick').click() }, { label: 'Créer', onclick: () => { location.href = href('image/'); } }];
  const btn = $('#act .ab-gen');
  const v = T(S.s.view);
  return [{ head: 'Image · éditer' },
    { label: 'Essayer', icon: '▶', disabled: !btn || btn.disabled, why: $('#act .why')?.textContent || '', onclick: runTrial },
    v ? { label: 'Valider cet essai', disabled: !!v.validated || !v.has_file || !!S.s.write_why, why: v.validated ? 'déjà validé' : S.s.write_why || 'pas d’image', onclick: () => validate(v) } : null,
    v ? { label: 'Partir de cet essai', disabled: S.s.base === v.id || !v.has_file, why: 'c’est déjà la base', onclick: () => setBase(v.id) } : null,
    '-',
    { label: 'Comparer à l’original', disabled: !v?.has_file, why: 'choisissez un essai', onclick: toggleCmp },
    { label: 'Autre image…', onclick: () => { location.href = './'; } },
    { label: 'Créer', sub: 'image', onclick: () => { location.href = href('image/'); } }];
});

// ── démarrage ───────────────────────────────────────────────
async function start() {
  try { [S.cfg, S.acfg] = await Promise.all([api('image/models'), api('image/atelier/config')]); } catch (e) {
    toast(`le portail ne répond pas : ${e.message}`, 8000); return;
  }
  const qs = new URLSearchParams(location.search);
  if (qs.get('s')) await openSession(qs.get('s'));
  else if (qs.get('item')) await openItem(qs.get('item'), qs.get('reuse') || '');
  else await showHome();
}
start();
