// MONTAGE — le panneau Effets (un onglet du panneau Source, montré par
// défaut) : la bibliothèque des effets que Montage sait rendre à l'export et
// montrer pareil dans l'aperçu — les LUT (rangées par familles, les favoris
// d'abord), l'étalonnage et ses préréglages, les fondus. Premiere a le même
// panneau (« Effects ») : on y cherche, on glisse un effet sur un plan.
//
// Glisser un effet :
//   sur un plan                 il s'ajoute à ses effets (une LUT remplace
//                               la LUT du plan ; Maj : l'ajoute en plus)
//   sur l'en-tête d'une piste   aux effets de la piste (tous ses plans)
//   sur l'en-tête d'un groupe   aux effets du groupe (tous les plans de ses pistes)
//   sur la règle, au-dessus de la première piste
//                               un calque d'effet neuf, en haut de l'image,
//                               nommé « FX <effet> », qui agit sur tout ce qui est dessous
//   sur une piste de calques    un calque de plus, à cet endroit
// Un fondu se lâche sur un plan : il se pose au bord le plus proche.
// Double-clic sur un effet : sur ce qui est choisi (Premiere fait de même).

import { el } from '../commun/shell.js';
import { $, partout } from '../commun/fenetre.js';
import { getMini, lutGL } from './lut.js';
import * as M from './model.js';

export const FX_MIME = 'application/x-sr-effect';

// les préréglages de l'étalonnage : les réglages de l'effet `grade`
const PRESETS = [
  { key: 'grade', title: 'Étalonnage', p: {} },
  { key: 'nb', title: 'Noir et blanc', p: { saturation: -100 } },
  { key: 'desat', title: 'Désaturer', p: { saturation: -40 } },
  { key: 'chaud', title: 'Réchauffer', p: { temperature: 4800 } },
  { key: 'froid', title: 'Refroidir', p: { temperature: 8500 } },
  { key: 'contraste', title: 'Contraste', p: { contrast: 25 } },
  { key: 'clair', title: 'Éclaircir', p: { exposure: 0.5 } },
  { key: 'sombre', title: 'Assombrir', p: { exposure: -0.5 } },
];
const TRANSITIONS = [
  { type: 'fade', title: 'Fondu', hint: 'au noir, ou du silence' },
  { type: 'xfade', title: 'Fondu enchaîné', hint: 'entre deux plans collés' },
];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return null; };

// Les familles de LUT : les cuites Rec.709 de Fujifilm d'abord, les marques de
// pellicules, les importées, les LUT d'origine en log à la fin.
export function lutFamilies(luts) {
  const by = new Map();
  for (const l of luts) { if (!by.has(l.family)) by.set(l.family, []); by.get(l.family).push(l); }
  const rank = (f) => (/rec\.?709/i.test(f) && /fuji/i.test(f) ? 0 : /origine|log/i.test(f) ? 3 : /import/i.test(f) ? 2 : 1);
  return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'fr'))
    .map(([name, list]) => ({ name, list: list.sort((a, b) => a.title.localeCompare(b.title, 'fr')) }));
}

// l'effet qu'un descriptif glissé donne (un effet de liste), ou null pour un fondu
export function fxOfDesc(d) {
  if (d.type === 'lut') return M.newFx('lut', { lut: d.lut, mix: 1 });
  if (d.type === 'grade') return M.newFx('grade', d.p || {});
  return null;
}

export function mountEffects({ root, app }) {
  const S = { q: '', open: LS('montage-fx-open') || { fav: true, couleur: true, trans: true } };
  const head = el('div', { class: 'fx-head' },
    el('input', { class: 'fld fx-q', placeholder: 'chercher un effet', 'aria-label': 'chercher un effet' }),
    el('button', { class: 'ic sm', title: 'importer une LUT (.cube, HaldCLUT)', 'aria-label': 'importer une LUT', html: '<svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4M4 15v5h16v-5"/></svg>', onclick: () => app.importLut() }));
  const list = el('div', { class: 'fx-list' });
  root.replaceChildren(head, list);
  const q = head.querySelector('.fx-q');
  let qT = 0;
  q.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { S.q = q.value; paint(); }, 150); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; S.q = ''; paint(); } });

  const drag = (row, desc) => {
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      app.setFxDrag(desc);
      e.dataTransfer.setData(FX_MIME, JSON.stringify(desc));
      e.dataTransfer.setData('text/plain', desc.title);
      e.dataTransfer.effectAllowed = 'copy';
    });
    row.addEventListener('dragend', () => app.setFxDrag(null));
    row.addEventListener('dblclick', () => app.applyToSelection(desc));
  };
  const lutRow = (m) => {
    const desc = { type: 'lut', lut: m.id, title: m.title };
    const row = el('div', { class: 'fxi lut', 'data-lut': m.id, title: `${m.title} · ${m.family}${m.input !== 'rec709' ? ` · attend ${m.input_label}` : ''}` },
      el('canvas', { width: 64, height: 36 }), el('span', { class: 'nm' }, m.title),
      m.input !== 'rec709' ? el('i', { class: 'in' }, m.input === 'inconnu' ? '?' : m.input) : null, m.fav ? el('i', { class: 'star' }, '★') : null);
    drag(row, desc);
    return row;
  };
  const presetRow = (x) => {
    const desc = { type: 'grade', p: x.p, title: x.title, key: x.key };
    const row = el('div', { class: 'fxi grade', 'data-preset': x.key, title: x.title }, el('canvas', { width: 64, height: 36 }), el('span', { class: 'nm' }, x.title));
    drag(row, desc);
    return row;
  };
  const transRow = (x) => {
    const desc = { type: x.type, title: x.title };
    const row = el('div', { class: 'fxi trans', title: `${x.title} · ${x.hint}` }, el('i', { class: 'tico ' + x.type }), el('span', { class: 'nm' }, x.title));
    drag(row, desc);
    return row;
  };
  const group = (key, label, rows, n = rows.length) => {
    const on = !!S.open[key] || !!S.q;
    const h = el('button', { class: 'lg' + (on ? ' open' : ''), onclick: () => { S.open[key] = !S.open[key]; LS('montage-fx-open', S.open); paint(); } },
      el('i', { class: 'chev' }), el('span', {}, label), el('small', { class: 'num' }, String(n)));
    return el('div', { class: 'lgrp' }, h, on ? el('div', { class: 'fx-rows' }, ...rows) : null);
  };

  function paint() {
    const luts = app.luts();
    const words = norm(S.q).split(/\s+/).filter(Boolean);
    const hit = (s) => words.every((w) => norm(s).includes(w));
    const out = [];
    const trans = TRANSITIONS.filter((x) => hit(x.title + ' transition fondu'));
    const pres = PRESETS.filter((x) => hit(x.title + ' couleur étalonnage'));
    if (trans.length) out.push(group('trans', 'Transitions', trans.map(transRow)));
    if (pres.length) out.push(group('couleur', 'Couleur', pres.map(presetRow)));
    const found = luts.filter((l) => hit(`${l.title} ${l.family} ${l.pack || ''} ${l.input_label} lut`));
    const fav = found.filter((l) => l.fav > 0).sort((a, b) => a.fav - b.fav);
    if (fav.length) out.push(group('fav', 'LUT · favoris', fav.map(lutRow)));
    for (const f of lutFamilies(found)) {
      const key = 'lut:' + f.name;
      const on = !!S.open[key] || !!S.q;
      // une famille repliée ne fabrique pas ses lignes (des centaines de LUT)
      out.push(on ? group(key, f.name, f.list.slice(0, 400).map(lutRow), f.list.length) : group(key, f.name, [], f.list.length));
    }
    if (!out.length) out.push(el('p', { class: 'lbl fx-none' }, luts.length || !words.length ? 'aucun effet' : '…'));
    list.replaceChildren(...out);
    thumbs();
  }

  // Les vignettes : l'image du programme sous la tête de lecture (ou du plan
  // choisi) passée par chaque effet — une LUT par sa version 17³ (route /mini),
  // un préréglage par le même calcul que l'aperçu. Seules celles qui se voient
  // se dessinent (IntersectionObserver, MDN), gardées tant que l'image ne change pas.
  let io = null;
  const cache = new Map();
  function thumbs() {
    const gl = lutGL();
    if (!gl.ok) return;
    if (io) io.disconnect();
    io = new IntersectionObserver((ents) => {
      const seen = ents.filter((x) => x.isIntersecting).map((x) => x.target);
      for (const t of seen) io.unobserve(t);
      if (seen.length) draw(seen);
    }, { root: list, rootMargin: '80px' });
    for (const t of list.querySelectorAll('.fxi.lut, .fxi.grade')) io.observe(t);
  }
  function draw(rows) {
    const gl = lutGL();
    const src = app.thumbSource(() => draw(rows));
    if (!src) return;
    for (const t of rows) {
      if (!t.isConnected) continue;
      const cv = t.querySelector('canvas');
      const what = t.dataset.lut || 'p:' + t.dataset.preset;
      const key = src.key + '|' + what;
      const kept = cache.get(key);
      if (kept) { cv.getContext('2d').drawImage(kept, 0, 0); continue; }
      let pass = null;
      if (t.dataset.lut) {
        const lut = getMini(t.dataset.lut, () => draw([t]));
        if (!lut) continue;
        pass = { lut, mix: 1 };
      } else {
        const x = PRESETS.find((y) => y.key === t.dataset.preset);
        const g = { ...M.NEUTRAL, ...(x ? x.p : {}) };
        pass = { grade: g, temp: Math.abs(g.temperature - 6500) > 0.5 ? app.tempGains(g.temperature) : [1, 1, 1] };
      }
      if (!gl.drawChain(src.el, cv.width, cv.height, [pass], src.key)) continue;
      cv.getContext('2d').drawImage(gl.cv, 0, 0);
      const keep = document.createElement('canvas');
      keep.width = cv.width; keep.height = cv.height;
      keep.getContext('2d').drawImage(cv, 0, 0);
      cache.set(key, keep);
      if (cache.size > 800) cache.delete(cache.keys().next().value);
    }
  }

  paint();
  return { paint, thumbs, input: q, root };
}

// ── les dépôts d'effets sur la timeline ─────────────────────
// La cible sous le pointeur : un plan, l'en-tête d'une piste ou d'un groupe,
// la règle (un calque neuf), le vide d'une piste de calques (un calque de plus).
function targetAt(tl, e, d) {
  const p = tl.p;
  if (!p || !d) return null;
  const isFx = d.type === 'lut' || d.type === 'grade';
  const node = e.target.closest ? e.target : null;
  if (!node) return null;
  if (node.closest('.tl-ruler')) return isFx ? { kind: 'new', frame: tl.frameAt(e.clientX), el: tl.ruler } : null;
  const gh = node.closest('.tl-grp');
  if (gh) {
    const g = M.groupOf(p, gh.dataset.grp);
    const img = g && p.tracks.some((t) => t.grp === g.id && t.kind !== 'audio');
    return isFx && img ? { kind: 'group', id: g.id, el: gh } : null;
  }
  const hd = node.closest('.tl-hd[data-head]');
  if (hd) {
    const t = M.trackOf(p, hd.dataset.head);
    return isFx && t && t.kind === 'video' ? { kind: 'track', id: t.id, el: hd } : null;
  }
  const clip = node.closest('.clip');
  if (clip) {
    const c = M.byId(p, clip.dataset.id);
    const t = c && M.trackOf(p, c.track);
    if (!c || !t) return null;
    if (isFx) return t.kind === 'video' || c.kind === 'adjust' ? { kind: 'clip', id: c.id, el: clip } : null;
    if (c.kind === 'adjust' && d.type === 'xfade') return null;
    const r = clip.getBoundingClientRect();
    return { kind: 'clip', id: c.id, el: clip, side: e.clientX - r.left < r.width / 2 ? 'l' : 'r' };
  }
  const lane = node.closest('.tl-lane.fx');
  if (lane && isFx) return { kind: 'layer', track: lane.dataset.track, frame: tl.frameAt(e.clientX), el: lane };
  return null;
}

export function bindEffectDrops(tl, app) {
  let cur = null;
  const clear = () => { if (cur && cur.el) cur.el.classList.remove('fx-on'); tl.ruler.classList.remove('fx-new'); tl.root.classList.remove('fx-drag'); tl.tip.hidden = true; cur = null; };
  const say = (d, t, shift) => {
    const name = d.title;
    if (t.kind === 'new') return `calque « FX ${name} »`;
    if (t.kind === 'layer') return `calque « FX ${name} » sur ${t.track}`;
    if (t.kind === 'track') return `${name} → piste ${t.id}`;
    if (t.kind === 'group') return `${name} → groupe`;
    if (d.type === 'fade') return `fondu ${t.side === 'l' ? 'd’entrée' : 'de sortie'}`;
    if (d.type === 'xfade') return 'fondu enchaîné';
    const c = M.byId(tl.p, t.id);
    const hasLut = c && (c.fx || []).some((f) => f.type === 'lut');
    return d.type === 'lut' && hasLut && !shift ? `${name} · remplace la LUT` : `${name} → plan`;
  };
  tl.scroll.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes(FX_MIME)) return;
    const d = app.fxDrag();
    const t = targetAt(tl, e, d);
    if (cur && (!t || t.el !== cur.el)) { cur.el.classList.remove('fx-on'); tl.ruler.classList.remove('fx-new'); }
    tl.root.classList.add('fx-drag');
    cur = t;
    if (!t) { e.dataTransfer.dropEffect = 'none'; tl.tip.hidden = true; return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    t.el.classList.add('fx-on');
    if (t.kind === 'new') tl.ruler.classList.add('fx-new');
    tl.showTip(e, say(d, t, e.shiftKey));
  }, true);
  tl.scroll.addEventListener('dragleave', (e) => { if (!tl.scroll.contains(e.relatedTarget)) clear(); });
  tl.scroll.addEventListener('drop', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes(FX_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    let d = app.fxDrag();
    try { d = d || JSON.parse(e.dataTransfer.getData(FX_MIME)); } catch { /* */ }
    const t = targetAt(tl, e, d);
    clear();
    app.setFxDrag(null);
    if (t) app.dropEffect(d, t, { add: e.shiftKey });
  }, true);
  // le glisser peut partir de la fenêtre du panneau Effets (un 2ᵉ écran) : sa fin y arrive
  partout('dragend', () => clear());
}

export const effectsRoot = () => $('#fx-pane');
