// LE CORPS D'UNE TUILE — porté d'ODIO_01, apps/studio/src/components/BlockBody.tsx
// (et BlockSurface, ParamRow, Promoted, ParamGlyph, Groove, MiniSlider, Keys),
// de React vers le DOM. La règle ne change pas (tile/shape.js, pur) : un bloc
// déclare, pour chacune des trois formes (bande, colonne, pavé), une liste
// ordonnée d'emplacements ; le rendu les prend dans l'ordre et S'ARRÊTE dès
// que le suivant ne rentre plus. Quand rien ne rentre, il reste le paramètre
// exposé en grand — ou, s'il n'y en a pas, la SURFACE du bloc (le dessin de
// ce qu'il fait au son) : de loin, un filtre montre sa courbe, pas son nom.
//
// Ce qui change : les réglages d'un module d'ici gardent leur propre échelle
// et leur écriture (modules.js : toNorm, fromNorm, fmt — une seule vérité avec
// le rack et la console) ; les surfaces dessinent un JUMEAU de l'effet, posé
// dans un petit contexte hors temps réel (le moteur de la page ne naît qu'à la
// première lecture) ; les couleurs viennent des jetons (tok()).

import { beginDrag } from './interaction/drag.js';
import { FINE_FACTOR, isDrag, normFromDrag } from './interaction/gesture.js';
import { resolveSlots, shapeOf, tilePadding } from './tile/shape.js';
import { measureText, engrave, MONO, DISP } from './tile/measure.js';
import { getTuning } from './design/tuning.js';
import { hairlineOffset } from './canvas/camera.js';
import { formatHz, normToParam, paramToNorm } from './moteur/scale.js';
import { toNorm, fromNorm, fmt } from '../modules.js';

export const SURFACE_SLOT = 'surface';
export const OWN_SLOTS = new Set(['groove', 'touches', 'machine', 'tempo', 'scene', 'vu']);
export const BODY_GAP = 6;
const FADER_GAP = 6;
const ROW_LABEL_FONT = `10px ${MONO}`;
const ROW_VALUE_FONT = `11px ${MONO}`;
const FADER_LABEL_FONT = `10px ${MONO}`;
const ROW_GAP = 8;
const MIN_RAIL = 26;
const MIN_FADER = 14;
const MIN_SPLITTABLE = 74;
export const SPLIT_HANDLE = 7;
const SURFACE_HIDE = 10;

const h = (tag, cls, style) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (style) for (const [k, v] of Object.entries(style)) e.style[k] = typeof v === 'number' && k !== 'opacity' && k !== 'zIndex' ? `${v}px` : v;
  return e;
};

// ── l'échelle et l'écriture d'un descripteur ─────────────────
// un réglage d'ici porte son `_spec` (modules.js) ; un contrôle de machine,
// le descripteur d'ODIO_01 (scale.js)
export const norme = (d, v) => (d._spec ? toNorm(d._spec, v) : paramToNorm(v, d));
export const valeur = (d, n) => (d._spec ? fromNorm(d._spec, n) : normToParam(n, d));
/** Valeur affichée (ParamRow.tsx, `formatValue`) — celle de modules.js pour un réglage d'ici. */
export function formatValue(d, v) {
  if (d._spec) return fmt(d._spec, v);
  if (d.curve === 'choice') return d.choices?.[Math.round(v)] ?? String(v);
  if (d.unit === 'Hz') return formatHz(v);
  if (d.unit === '%') return String(Math.round(v));
  return v >= 10 ? v.toFixed(0) : v.toFixed(1);
}
/** Un réglage d'ici (modules.js) dans la forme d'un descripteur d'ODIO_01. */
export const descripteurDe = (s) => ({ id: s.k, label: s.label, min: s.min, max: s.max, default: s.def, unit: s.unit || '',
  curve: s.opts ? 'choice' : s.curve === 'log' ? 'exponential' : 'linear', choices: s.opts, _spec: s });

// ── la disposition (BlockBody.tsx) ───────────────────────────
/** Disposition générique d'un bloc sans surface dédiée : des rails, des faders. */
export function paramLayout(ids) {
  const rows = ids.map((id) => ({ id: `p:${id}`, min: { w: 112, h: 19 }, grow: true, max: 26 }));
  return { bande: rows.map((row) => ({ ...row, min: { w: 170, h: 19 } })), colonne: [{ id: 'faders', min: { w: MIN_FADER, h: 56 }, grow: true }], pave: rows };
}
/** Le paramètre exposé passe en tête des rails. */
function promoteExposed(slots, exposed) {
  if (!exposed) return [...slots];
  const wanted = `p:${exposed}`;
  const index = slots.findIndex((s) => s.id === wanted);
  if (index < 0) return [...slots];
  const first = slots.findIndex((s) => s.id.startsWith('p:'));
  if (first < 0 || first === index) return [...slots];
  const next = [...slots];
  const [slot] = next.splice(index, 1);
  next.splice(first, 0, slot);
  return next;
}
/** Résout la disposition — la même réponse pour la coque (l'en-tête) et le corps. */
export function resolveBody(width, height, parameters, def, split = null, exposed = null) {
  const pad = tilePadding(width, height);
  const innerW = Math.max(0, width - pad * 2), innerH = Math.max(0, height - pad * 2);
  const layout = def?.layout ?? paramLayout(parameters.map((p) => p.id));
  const declared = promoteExposed(layout[shapeOf(width, height)], exposed);
  const surface = declared.find((s) => s.id === SURFACE_SLOT);
  const splittable = Boolean(surface) && innerH >= MIN_SPLITTABLE;
  const usable = splittable ? Math.max(0, innerH - SPLIT_HANDLE) : innerH;
  if (split === null || split === undefined || !surface || usable <= 0 || !splittable || surface.min.w > innerW) {
    return { slots: resolveSlots(declared, { w: innerW, h: usable }, BODY_GAP), pad, innerW, innerH, splittable };
  }
  const wanted = Math.min(usable, Math.max(0, split * usable));
  if (wanted < SURFACE_HIDE) {
    return { slots: resolveSlots(declared.filter((s) => s.id !== SURFACE_SLOT), { w: innerW, h: usable }, BODY_GAP), pad, innerW, innerH, splittable };
  }
  const rest = Math.max(0, usable - wanted - BODY_GAP);
  const rails = resolveSlots(declared.filter((s) => s.id !== SURFACE_SLOT), { w: innerW, h: rest }, BODY_GAP);
  const usedByRails = rails.reduce((sum, s) => sum + s.height, 0) + BODY_GAP * rails.length;
  return { slots: [{ id: SURFACE_SLOT, height: Math.max(SURFACE_HIDE, usable - usedByRails) }, ...rails], pad, innerW, innerH, splittable };
}

/**
 * Rend le corps dans `host`. props : width, height, parameters (descripteurs),
 * values, exposed, def (registre : layout + surface), twin (l'objet que la
 * surface lit), split, onParam, onPromote, onSplit, renderOwn(slot, w, h).
 */
export function rendreCorps(host, props) {
  const { width, height, parameters, values, exposed, def, twin, split = null, onParam, onPromote, onSplit, renderOwn } = props;
  const { slots, pad, innerW, innerH, splittable } = resolveBody(width, height, parameters, def, split, exposed);
  if (slots.length === 0) {
    const b = h('div', 'body body--fallback');
    promoted(b, { exposed, parameters, values, def, twin, width, height, onParam });
    host.replaceChildren(b);
    return;
  }
  const b = h('div', 'body');
  b.style.padding = `${pad}px`;
  const hasScale = slots.some((s) => s.id === 'scale');
  const scaleHeight = slots.find((s) => s.id === 'scale')?.height ?? 0;
  const surfaceHidden = splittable && Boolean(def?.surface) && !slots.some((s) => s.id === SURFACE_SLOT);
  const labelWidth = Math.ceil(parameters.reduce((m, p) => Math.max(m, measureText(p.label, ROW_LABEL_FONT)), 0));
  const valueWidth = Math.ceil(parameters.reduce((m, p) => Math.max(m, measureText(formatValue(p, values[p.id] ?? p.default), ROW_VALUE_FONT)), 0));
  const showRail = innerW >= labelWidth + ROW_GAP + MIN_RAIL + ROW_GAP + valueWidth;
  if (surfaceHidden) b.append(splitHandle(0, innerH, onSplit));
  for (const slot of slots) {
    if (slot.id === 'scale') continue;
    if (slot.id === SURFACE_SLOT && def?.surface) {
      const sh = slot.height + (hasScale ? scaleHeight : 0);
      b.append(surface({ twin, spec: def.surface, parameters, values, onParam, width: innerW, height: sh }));
      if (splittable) b.append(splitHandle(sh, innerH, onSplit));
      continue;
    }
    if (OWN_SLOTS.has(slot.id) && renderOwn) { const o = renderOwn(slot.id, innerW, slot.height); if (o) b.append(o); continue; }
    if (slot.id === 'faders') { b.append(faders({ parameters, values, exposed, width: innerW, height: slot.height, onParam, onPromote })); continue; }
    const id = slot.id.slice(2);
    const d = parameters.find((p) => p.id === id);
    if (!d) continue;
    b.append(paramRow({ d, value: values[id] ?? d.default, promoted: exposed === id, labelWidth, showRail, height: slot.height,
      onChange: (v) => { values[id] = v; onParam(id, v); }, onPromote: () => onPromote(id) }));
  }
  host.replaceChildren(b);
}

/** La frontière entre le dessin et les rails, que l'utilisateur déplace ; double-clic : le partage d'origine. */
function splitHandle(surfaceHeight, innerH, onSplit) {
  const e = h('div', 'split', { height: SPLIT_HANDLE });
  e.title = 'Glisser pour partager le bloc entre le dessin et les réglages · double-clic pour revenir au partage d\'origine';
  e.append(h('span', 'split__bar'));
  e.addEventListener('dblclick', (ev) => { ev.stopPropagation(); onSplit?.(null); });
  e.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const y0 = event.clientY;
    beginDrag({ currentTarget: null, pointerId: event.pointerId }, { cursor: 'ns-resize', move: (m) => onSplit?.(Math.min(1, Math.max(0, (surfaceHeight + m.clientY - y0) / innerH)), false), end: () => onSplit?.(undefined, true) });
  });
  return e;
}

// ── le geste d'un rail ou d'un fader (ParamRow.tsx, useParamGesture) ──
function geste(el, d, getValue, axis, onChange, course) {
  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const x0 = event.clientX, y0 = event.clientY, n0 = norme(d, getValue()), target = event.currentTarget;
    let moved = false;
    beginDrag({ currentTarget: null, pointerId: event.pointerId }, {
      cursor: axis === 'x' ? 'ew-resize' : 'ns-resize',
      move: (m) => {
        const dx = m.clientX - x0, dy = m.clientY - y0;
        if (!moved && !isDrag(dx, dy)) return;
        if (!moved) { moved = true; try { target.setPointerCapture(m.pointerId); } catch { /* window */ } }
        const w = course()?.getBoundingClientRect().width ?? 120;
        const n = axis === 'x' ? Math.min(1, Math.max(0, n0 + (dx / w) * (m.shiftKey ? FINE_FACTOR : 1))) : normFromDrag(n0, dy, m.shiftKey);
        onChange(valeur(d, n));
      },
    });
  });
}

/** Ligne de paramètre : le nom (clic : exposer), le rail (glisser), la valeur (double-clic : saisir). */
function paramRow({ d, value, promoted, labelWidth, showRail, height, onChange, onPromote }) {
  let v = value;
  const row = h('div', 'row', { height });
  const lab = h('button', promoted ? 'row__label row__label--exposed' : 'row__label', { width: labelWidth });
  lab.type = 'button'; lab.textContent = d.label; lab.title = promoted ? 'Ne plus exposer ce paramètre' : 'Exposer ce paramètre';
  lab.addEventListener('pointerdown', (e) => e.stopPropagation());
  lab.addEventListener('click', (e) => { e.stopPropagation(); onPromote(); });
  const rail = h('div', showRail ? 'row__rail' : 'row__gap');
  const travel = h('div', 'row__travel'), cursor = h('div', 'row__cursor');
  if (showRail) rail.append(travel, cursor);
  const val = h('span', 'row__value');
  val.title = 'Double-clic pour saisir une valeur exacte';
  const paint = () => { const n = norme(d, v); travel.style.width = `${n * 100}%`; cursor.style.left = `${n * 100}%`; val.textContent = formatValue(d, v); };
  paint();
  const set = (nv) => { v = nv; paint(); onChange(nv); };
  geste(row, d, () => v, 'x', set, () => rail);
  val.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const inp = h('input', 'row__value row__value--editing');
    inp.value = formatValue(d, v);
    const fin = (ok) => { if (ok) { const p = parseValue(d, inp.value); if (p !== null) set(p); } inp.replaceWith(val); paint(); };
    inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') fin(true); if (ev.key === 'Escape') fin(false); });
    inp.addEventListener('blur', () => fin(true));
    inp.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    val.replaceWith(inp); inp.focus(); inp.select();
  });
  row.append(lab, rail, val);
  return row;
}
/** Interprète une saisie clavier (ParamRow.tsx, `parseValue`). */
export function parseValue(d, input) {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  if (d.curve === 'choice') { const i = d.choices?.findIndex((c) => String(c).toLowerCase() === text) ?? -1; return i >= 0 ? i : null; }
  const m = /^(-?\d+(?:[.,]\d+)?)\s*(k|khz|hz|%|s|ms)?$/.exec(text);
  if (!m) return null;
  let v = Number.parseFloat(m[1].replace(',', '.'));
  if (m[2] === 'k' || m[2] === 'khz') v *= 1000;
  if (m[2] === 'ms') v /= 1000;
  if (!Number.isFinite(v)) return null;
  return Math.min(d.max, Math.max(d.min, v));
}

/** Fader vertical (ParamRow.tsx, ParamFader). */
export function paramFader({ d, value, promoted, labelOrientation, labelSpace, onChange, onPromote }) {
  let v = value;
  const e = h('div', 'fader');
  e.title = `${d.label} — glisser pour régler`;
  const track = h('div', 'fader__track'), travel = h('div', 'fader__travel'), cur = h('div', 'fader__cursor');
  track.append(travel, cur);
  const paint = () => { const n = norme(d, v); travel.style.height = `${n * 100}%`; cur.style.bottom = `${n * 100}%`; };
  paint();
  geste(e, d, () => v, 'y', (nv) => { v = nv; paint(); onChange(nv); }, () => track);
  e.append(track);
  if (labelOrientation !== 'none') {
    const l = h('button', ['fader__label', `fader__label--${labelOrientation}`, promoted ? 'fader__label--exposed' : ''].filter(Boolean).join(' '));
    l.type = 'button'; l.textContent = d.label;
    if (labelOrientation === 'upright') l.style.height = `${labelSpace}px`;
    l.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    l.addEventListener('click', (ev) => { ev.stopPropagation(); onPromote(); });
    e.append(l);
  }
  return e;
}
/** La rangée de faders du format colonne : autant que la largeur en admet, le nom tourné s'il ne tient plus à plat. */
function faders({ parameters, values, exposed, width, height, onParam, onPromote }) {
  const candidates = parameters.filter((p) => p.curve !== 'choice');
  const fit = Math.max(1, Math.floor((width + FADER_GAP) / (MIN_FADER + FADER_GAP)));
  const shown = candidates.slice(0, Math.min(candidates.length, fit));
  const faderWidth = (width - FADER_GAP * (shown.length - 1)) / Math.max(1, shown.length);
  const longest = shown.reduce((m, p) => Math.max(m, measureText(p.label, FADER_LABEL_FONT)), 0);
  const uprightSpace = Math.ceil(longest) + 4;
  const orientation = faderWidth >= longest ? 'flat' : height >= uprightSpace + 30 ? 'upright' : 'none';
  const e = h('div', 'faders', { height });
  for (const p of shown) e.append(paramFader({ d: p, value: values[p.id] ?? p.default, promoted: exposed === p.id, labelOrientation: orientation, labelSpace: uprightSpace,
    onChange: (v) => { values[p.id] = v; onParam(p.id, v); }, onPromote: () => onPromote(p.id) }));
  return e;
}

// ── la surface (BlockSurface.tsx) ────────────────────────────
// Un écran encastré, un dessin qui vient des vraies données du bloc, deux
// axes : l'horizontal désigne (absolu au clic, relatif au glissé), le
// vertical dose. Les couleurs de l'écran : les jetons du portail.
let TOKS = null;
const couleurs = () => (TOKS ||= (() => {
  const cs = getComputedStyle(document.documentElement);
  const t = (n) => cs.getPropertyValue(`--${n}`).trim();
  return { well: t('bg'), ink: t('ink'), mut: t('ink2'), tick: t('line'), tick2: t('ink3'), acc: t('cy'), acc2: t('coral-2') };
})());
export function surface({ twin, spec, parameters, values, onParam, width, height }) {
  const w = Math.max(0, Math.round(width)), hh = Math.max(0, Math.round(height));
  const wrap = h('div', 'surface', { width: w, height: hh });
  const cv = h('canvas');
  Object.assign(cv.style, { width: `${w}px`, height: `${hh}px`, display: 'block', cursor: 'crosshair' });
  wrap.append(cv);
  let hover = false, drag = null;
  const draw = () => {
    if (w <= 0 || hh <= 0 || !twin) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(hh * dpr));
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const half = hairlineOffset(dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    ctx.translate(half, half);
    ctx.lineWidth = 1; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const colors = couleurs();
    ctx.fillStyle = colors.well; ctx.fillRect(-half, -half, w, hh);
    try { spec.draw({ ctx, width: w, height: hh, effect: twin, colors, active: hover || drag !== null }); } catch { /* un jumeau qui ne sait pas dire */ }
  };
  draw();
  const descr = (id) => (id ? parameters.find((p) => p.id === id) : undefined);
  const lecture = h('div', 'surface__readout');
  const lire = () => [spec.dragX, spec.dragY].map((id) => { const d = descr(id); return d ? `${d.label} ${formatValue(d, values[d.id] ?? d.default)}` : null; }).filter(Boolean).join(' · ');
  cv.addEventListener('pointerenter', () => { hover = true; draw(); });
  cv.addEventListener('pointerleave', () => { hover = false; draw(); });
  const poserVal = (d, v) => { values[d.id] = v; onParam(d.id, v); twin?.setParameter?.(d.id, v); };
  cv.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const rect = cv.getBoundingClientRect();
    const ox = event.clientX, oy = event.clientY;
    const xd = descr(spec.dragX), yd = descr(spec.dragY);
    const pressed = Math.min(1, Math.max(0, (ox - rect.left) / rect.width));
    if (xd) poserVal(xd, valeur(xd, pressed));
    const sx = pressed, sy = yd ? norme(yd, values[yd.id] ?? yd.default) : 0;
    drag = { x: ox - rect.left, y: oy - rect.top };
    cv.style.cursor = 'grabbing';
    try { cv.setPointerCapture(event.pointerId); } catch { /* window */ }
    wrap.append(lecture);
    const place = () => { lecture.textContent = lire(); lecture.style.left = `${drag.x + 12}px`; lecture.style.top = `${drag.y - 6}px`; };
    place(); draw();
    beginDrag({ currentTarget: null, pointerId: event.pointerId }, {
      cursor: 'grabbing',
      move: (m) => {
        const dx = m.clientX - ox, dy = m.clientY - oy, fine = m.shiftKey ? FINE_FACTOR : 1;
        if (xd) poserVal(xd, valeur(xd, Math.min(1, Math.max(0, sx + (dx / rect.width) * fine))));
        if (yd) poserVal(yd, valeur(yd, normFromDrag(sy, dy, m.shiftKey)));
        drag = { x: m.clientX - rect.left, y: m.clientY - rect.top };
        place(); draw();
      },
      end: () => { drag = null; cv.style.cursor = 'crosshair'; lecture.remove(); draw(); },
    });
  });
  wrap.redessiner = draw;
  return wrap;
}

// ── le paramètre exposé en grand (Promoted.tsx, ParamGlyph.tsx) ──
const NAME_SPACING = '0.13em', TIGHT_SPACING = '0px', VALUE_SPACING = '0.02em', LEAD = 2;
const edgeOf = (w, hh) => Math.min(4, Math.max(1, Math.floor(Math.min(w, hh) * 0.045)));
function fitFontSize(text, family, width, max, spacing = '0') {
  if (!text || width <= 0) return 0;
  const unit = measureText(text, `100px ${family}`, spacing) / 100;
  if (unit <= 0) return max;
  return Math.floor(Math.min(max, width / unit));
}
export function promotedName(width, height, label) {
  const { nameMin, nameMax } = getTuning();
  const edge = edgeOf(width, height);
  const inner = { w: Math.max(0, width - edge * 2), h: Math.max(0, height - edge * 2) };
  const room = Math.max(Math.floor(inner.h * 0.42), Math.min(nameMin, inner.h - nameMin - LEAD));
  const text = engrave(label);
  for (const spacing of [NAME_SPACING, TIGHT_SPACING]) {
    const size = Math.min(fitFontSize(text, MONO, inner.w, nameMax, spacing), room);
    if (size >= nameMin) return { size, spacing };
  }
  return { size: 0, spacing: NAME_SPACING };
}
const hasGlyph = (id) => id === 'wave' || id === 'type';
function wavePath(wave) {
  switch (wave) {
    case 'square': case 'Carré': return 'M2 78 L2 22 L50 22 L50 78 L98 78 L98 22';
    case 'triangle': case 'Triangle': return 'M2 78 L26 22 L74 78 L98 22';
    case 'sine': case 'Sinus': {
      const pts = [];
      for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push(`${i === 0 ? 'M' : 'L'}${(2 + t * 96).toFixed(1)} ${(50 - Math.sin(t * Math.PI * 2) * 28).toFixed(1)}`); }
      return pts.join(' ');
    }
    default: return 'M2 78 L48 22 L48 78 L94 22 L94 78 L98 78';
  }
}
function glyph(id, value, width, height) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'glyph-wave'); svg.setAttribute('width', width); svg.setAttribute('height', height);
  svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
  const p = document.createElementNS(ns, 'path');
  const v = String(value);
  const d = id === 'wave' ? wavePath(v)
    : /passe-haut|highpass|hp/i.test(v) ? 'M2 88 L40 88 L62 20 L98 16'
      : /bande|bandpass|bp/i.test(v) ? 'M2 88 L34 88 L50 18 L66 88 L98 88'
        : /none|aucun/i.test(v) ? 'M2 30 L98 30' : 'M2 16 L38 20 L60 88 L98 88';
  p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', String(Math.max(1.5, Math.min(width, height) * 0.045))); p.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(p);
  return svg;
}
function promoted(host, { exposed, parameters, values, def, twin, width, height, onParam }) {
  const wantsSurface = exposed === null;
  const d = parameters.find((p) => p.id === exposed) ?? (wantsSurface ? parameters[0] : undefined);
  if (wantsSurface && def?.surface && width >= 16 && height >= 8) {
    host.append(surface({ twin, spec: def.surface, parameters, values, onParam, width, height }));
    return;
  }
  if (!d) return;
  let v = values[d.id] ?? d.default;
  const edge = edgeOf(width, height);
  const inner = { w: Math.max(0, width - edge * 2), h: Math.max(0, height - edge * 2) };
  const heading = promotedName(width, height, d.label);
  const showName = heading.size > 0;
  const bodyHeight = Math.max(0, inner.h - (showName ? heading.size + LEAD : 0));
  const e = h('div', 'promoted');
  e.style.padding = `${edge}px`; e.style.gap = `${LEAD}px`;
  e.title = `${d.label} — glisser verticalement pour régler`;
  if (showName) { const n = h('span', 'promoted__name'); n.style.fontSize = `${heading.size}px`; n.style.letterSpacing = heading.spacing; n.textContent = engrave(d.label); e.append(n); }
  let valEl = null;
  const paint = () => {
    const text = formatValue(d, v);
    if (valEl) valEl.remove();
    if (hasGlyph(d.id)) valEl = glyph(d.id, text, inner.w, Math.max(6, bodyHeight));
    else {
      const size = Math.min(fitFontSize(text, DISP, inner.w, 64, VALUE_SPACING), Math.floor(bodyHeight));
      valEl = size >= getTuning().nameMin ? Object.assign(h('span', 'promoted__value'), { textContent: text }) : null;
      if (valEl) valEl.style.fontSize = `${size}px`;
    }
    if (valEl) e.append(valEl);
  };
  paint();
  let g = null;
  e.addEventListener('pointerdown', (ev) => { if (ev.button !== 0) return; ev.stopPropagation(); e.setPointerCapture(ev.pointerId); g = { y: ev.clientY, n0: norme(d, v), moved: false }; });
  e.addEventListener('pointermove', (ev) => {
    if (!g) return;
    const dy = ev.clientY - g.y;
    if (!g.moved && !isDrag(0, dy)) return;
    g.moved = true; v = valeur(d, normFromDrag(g.n0, dy, ev.shiftKey)); values[d.id] = v; onParam(d.id, v); paint();
  });
  e.addEventListener('pointerup', (ev) => { g = null; try { e.releasePointerCapture(ev.pointerId); } catch { /* rendue */ } });
  host.append(e);
}

// ── la boîte à rythme (Groove.tsx) : une tranche par voix, la rangée de pads en bas ──
const PAD_H = 24, KNOB_H = 13, FADER_H = 42, LABEL_W = 34, GAP = 4, COL_GAP = 4;
const KNOBS = ['tune', 'decay', 'ctrl'];
/**
 * `voices` : les voix de la source (id, name, short, note) ; `steps(voix)` :
 * les pas du motif de la piste pour cette voix (des vélocités) ; `toggle(i)`.
 */
export function groove({ voices, steps, parameters, values, exposed, voice, playhead, width, height, onParam, onPromote, onVoice, onToggle }) {
  const count = steps.length;
  if (count === 0 || width < 70 || height < PAD_H) return null;
  const descr = (id) => parameters.find((p) => p.id === id);
  let room = height - PAD_H;
  const showFaders = room >= FADER_H + GAP;
  if (showFaders) room -= FADER_H + GAP;
  const knobRows = KNOBS.slice(0, Math.max(0, Math.min(KNOBS.length, Math.floor(room / KNOB_H))));
  const showNames = width >= LABEL_W + voices.length * 26;
  const stripsWidth = width - (showNames ? LABEL_W : 0);
  const columnWidth = (stripsWidth - COL_GAP * (voices.length - 1)) / voices.length;
  const fits = (fn) => voices.every((vo) => measureText(fn(vo), FADER_LABEL_FONT) <= columnWidth);
  const nameOf = fits((vo) => vo.name.toLowerCase()) ? (vo) => vo.name.toLowerCase() : fits((vo) => vo.short) ? (vo) => vo.short : null;
  const matrixHeight = knobRows.length * KNOB_H;
  const faderHeight = showFaders ? Math.max(FADER_H, height - PAD_H - GAP - matrixHeight) : 0;
  const g = h('div', 'groove', { height, gap: GAP });
  if (knobRows.length > 0 || showFaders) {
    const con = h('div', 'groove__console', { height: matrixHeight + (showFaders ? faderHeight : 0) });
    if (showNames) {
      const leg = h('div', 'groove__legend', { width: LABEL_W });
      for (const k of knobRows) { const r = h('span', 'groove__legend-row', { height: KNOB_H }); r.textContent = k; leg.append(r); }
      if (showFaders) leg.append(h('span', 'groove__legend-row', { height: faderHeight }));
      con.append(leg);
    }
    const strips = h('div', 'groove__strips', { width: stripsWidth, gap: COL_GAP });
    for (const vo of voices) {
      const chosen = vo.id === voice;
      const s = h('div', chosen ? 'groove__strip groove__strip--on' : 'groove__strip');
      s.title = `${vo.name} — cliquer pour écrire cette voix`;
      s.addEventListener('pointerdown', (ev) => { if (ev.target.closest('.fader__track, .mini')) return; onVoice(vo.id); });
      for (const k of knobRows) {
        const d = descr(`${vo.id}.${k}`);
        if (!d) { s.append(h('span', null, { height: KNOB_H })); continue; }
        s.append(mini({ d, value: values[d.id] ?? d.default, exposed: exposed === d.id, height: KNOB_H, onChange: (v) => { values[d.id] = v; onParam(d.id, v); }, onPromote: () => onPromote(d.id) }));
      }
      const lv = descr(`${vo.id}.niv`);
      if (showFaders && lv) {
        const f = h('div', 'groove__fader', { height: faderHeight });
        const label = nameOf?.(vo) ?? null;
        f.append(paramFader({ d: label === null ? lv : { ...lv, label }, value: values[lv.id] ?? lv.default, promoted: exposed === lv.id, labelOrientation: label === null ? 'none' : 'flat', labelSpace: 0,
          onChange: (v) => { values[lv.id] = v; onParam(lv.id, v); }, onPromote: () => onPromote(lv.id) }));
        s.append(f);
      }
      strips.append(s);
    }
    con.append(strips);
    g.append(con);
  }
  const pads = h('div', 'pads', { height: PAD_H });
  const padEls = [];
  steps.forEach((vel, i) => {
    const cls = ['pad'];
    if (vel > 0) cls.push('pad--on');
    if (i % 4 === 0) cls.push('pad--beat');
    if (playhead === i) cls.push('pad--now');
    const p = h('span', cls.join(' '));
    p.dataset.index = String(i); p.textContent = String(i + 1); p.title = `pas ${i + 1}`;
    padEls.push(p);
    pads.append(p);
  });
  // peindre au glissé : la case qu'on survole prend l'état de la première
  pads.addEventListener('pointerdown', (event) => {
    const pad = event.target.closest('.pad');
    if (!pad || event.button !== 0) return;
    event.stopPropagation();
    const i0 = Number(pad.dataset.index);
    const wanted = !(steps[i0] > 0);
    const done = new Set();
    const apply = (i) => { if (done.has(i)) return; done.add(i); if ((steps[i] > 0) !== wanted) { onToggle(i, wanted); padEls[i].classList.toggle('pad--on', wanted); } };
    apply(i0);
    beginDrag(event, { move: (m) => { const el = document.elementFromPoint(m.clientX, m.clientY)?.closest?.('.pad'); if (el?.dataset.index) apply(Number(el.dataset.index)); } });
  });
  g.append(pads);
  g.pads = padEls;
  return g;
}
/** Un réglage de tranche : une glissière d'une ligne, sans libellé (MiniSlider.tsx). */
function mini({ d, value, exposed, height, onChange, onPromote }) {
  let v = value;
  const e = h('div', exposed ? 'mini mini--exposed' : 'mini', { height });
  const rail = h('div', 'mini__rail'), cur = h('span', 'mini__cursor');
  rail.append(cur);
  const paint = () => { cur.style.left = `${norme(d, v) * 100}%`; e.title = `${d.label} — ${formatValue(d, v)} · glisser pour régler, double-clic pour exposer`; };
  paint();
  e.addEventListener('dblclick', (ev) => { ev.stopPropagation(); onPromote(); });
  geste(e, d, () => v, 'x', (nv) => { v = nv; paint(); onChange(nv); }, () => rail);
  e.append(rail);
  return e;
}

// ── le clavier (Keys.tsx) : deux octaves quand la place abonde, une sinon ──
const MIN_KEY = 9, BLACK = new Set([1, 3, 6, 8, 10]), WHITE = [0, 2, 4, 5, 7, 9, 11];
export function touches({ first, held = [], width, height, onDown }) {
  if (width < MIN_KEY * 7 || height < 12) return null;
  const octaves = width >= MIN_KEY * 14 ? 2 : 1, whites = octaves * 7, kw = width / whites, bw = kw * 0.62, bh = Math.max(6, height * 0.6);
  const e = h('div', 'keys', { width, height });
  e.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  const noteOf = (i) => first + Math.floor(i / 7) * 12 + WHITE[i % 7];
  const k = (cls, style, note) => { const t = h('span', `key ${cls}${held.includes(note) ? ' key--held' : ''}`, style); t.title = `note ${note}`; t.addEventListener('pointerdown', () => { t.classList.add('key--held'); onDown(note); setTimeout(() => t.classList.remove('key--held'), 180); }); e.append(t); };
  for (let i = 0; i < whites; i++) k('key--white', { left: i * kw, width: kw, height }, noteOf(i));
  for (let s = 0; s < octaves * 12; s++) {
    if (!BLACK.has(s % 12)) continue;
    const wb = WHITE.filter((w) => w < s % 12).length - 1;
    k('key--black', { left: (Math.floor(s / 12) * 7 + wb + 1) * kw - bw / 2, width: bw, height: bh }, first + s);
  }
  return e;
}
