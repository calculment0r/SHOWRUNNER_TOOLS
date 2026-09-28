// MUSIQUE — les commandes : molette, choix, menu, modales.
// Molette : l'arc de 270° du kit NL (station-nl-rack), tirée à la
// verticale ; double-clic = valeur par défaut ; flèches au clavier.
// Aucune couleur ici : l'accent passe par la variable --k, posée sur un
// jeton de commun/tokens.css.

import { el as el0, $ } from '../commun/shell.js';
import { toNorm, fromNorm, fmt } from './modules.js';

// el() de shell.js, qui pose aussi les variables CSS (--k, --c…) : un
// Object.assign sur element.style ignore les propriétés personnalisées,
// il faut style.setProperty (MDN, CSSStyleDeclaration.setProperty).
export function el(tag, attrs = {}, ...kids) {
  let vars = null;
  if (attrs && attrs.style && typeof attrs.style === 'object') {
    const st = {};
    for (const [k, v] of Object.entries(attrs.style)) {
      if (k.startsWith('--')) (vars ||= {})[k] = v;
      else st[k] = v;
    }
    attrs = { ...attrs, style: st };
  }
  const n = el0(tag, attrs, ...kids);
  if (vars) for (const [k, v] of Object.entries(vars)) n.style.setProperty(k, v);
  return n;
}

const R = 16, C = 2 * Math.PI * R, SWEEP = 0.75;

// knob(spec, valeur, {accent, size, onInput(v), onChange(v)}) → élément
export function knob(s, value, { accent = 'cy', size = 'md', onInput = () => {}, onChange = () => {}, label = s.label } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  const track = document.createElementNS(ns, 'circle');
  const arc = document.createElementNS(ns, 'circle');
  for (const c of [track, arc]) {
    c.setAttribute('cx', 20); c.setAttribute('cy', 20); c.setAttribute('r', R);
    c.setAttribute('transform', 'rotate(135 20 20)');
  }
  track.setAttribute('class', 'tr');
  track.setAttribute('stroke-dasharray', `${(C * SWEEP).toFixed(2)} 999`);
  arc.setAttribute('class', 'ar');
  const ptr = document.createElementNS(ns, 'line');
  ptr.setAttribute('class', 'pt');
  ptr.setAttribute('x1', 20); ptr.setAttribute('y1', 20); ptr.setAttribute('x2', 20); ptr.setAttribute('y2', 8);
  svg.append(track, arc, ptr);
  const v = el('span', { class: 'v' });
  const box = el('div', { class: `kn ${size}`, tabindex: 0, role: 'slider', 'aria-label': label,
    style: { '--k': `var(--${accent})` } },
  el('div', { class: 'dial' }, svg), v, size === 'xs' ? null : el('span', { class: 'l' }, label));
  let cur = value;
  const paint = () => {
    const n = toNorm(s, cur);
    arc.setAttribute('stroke-dasharray', `${(C * SWEEP * n).toFixed(2)} 999`);
    ptr.setAttribute('transform', `rotate(${(-135 + n * 270).toFixed(1)} 20 20)`);
    v.textContent = fmt(s, cur);
    box.setAttribute('aria-valuetext', `${fmt(s, cur)} ${s.unit || ''}`.trim());
    box.title = `${label} : ${fmt(s, cur)} ${s.unit && !s.opts ? s.unit : ''}`.trim();
  };
  const set = (nv, commit) => {
    if (nv === cur && !commit) return;
    cur = nv; paint(); onInput(cur);
    if (commit) onChange(cur);
  };
  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    box.setPointerCapture(e.pointerId);
    const y0 = e.clientY, n0 = toNorm(s, cur);
    let moved = false;
    const mv = (ev) => {
      moved = true;
      const k = ev.shiftKey ? 800 : 180;
      set(fromNorm(s, n0 + (y0 - ev.clientY) / k), false);
    };
    const up = () => {
      box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up);
      box.removeEventListener('pointercancel', up);
      if (moved) onChange(cur);
      else if (s.opts) set(fromNorm(s, ((Math.round(cur) + 1) % s.opts.length) / Math.max(1, s.opts.length - 1)), true);
    };
    box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  });
  box.addEventListener('dblclick', (e) => { e.stopPropagation(); set(s.def, true); });
  box.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    const stepN = s.opts ? 1 / Math.max(1, s.opts.length - 1) : (e.shiftKey ? 0.05 : 0.01);
    set(fromNorm(s, toNorm(s, cur) + d * stepN), true);
  });
  box.setValue = (nv) => { cur = nv; paint(); };
  paint();
  return box;
}

// Un choix parmi des libellés (forme d'onde, temps du délai…)
export function choice(s, value, { onChange = () => {} } = {}) {
  const seg = el('div', { class: 'seg mu-seg', role: 'radiogroup', 'aria-label': s.label });
  const paint = (v) => [...seg.children].forEach((b, i) => b.classList.toggle('on', i === v));
  s.opts.forEach((o, i) => seg.append(el('button', { class: 'tb', type: 'button', onclick: () => { paint(i); onChange(i); } }, o)));
  paint(Math.round(value));
  return el('div', { class: 'mu-choice' }, el('span', { class: 'lbl' }, s.label), seg);
}

// ── menu contextuel ─────────────────────────────────────────
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
export function menu(x, y, items) {
  closeMenu();
  const m = el('div', { class: 'mu-menu', role: 'menu' });
  for (const it of items) {
    if (it === '-') { m.append(el('div', { class: 'sep' })); continue; }
    if (it.head) { m.append(el('div', { class: 'head' }, it.head)); continue; }
    m.append(el('button', { class: 'it', role: 'menuitem', type: 'button', disabled: it.disabled || null, title: it.why || '',
      onclick: () => { closeMenu(); it.onclick(); } },
    it.dot ? el('i', { style: { background: `var(--${it.dot})` } }) : null,
    el('span', {}, it.label), it.sub ? el('small', {}, it.sub) : null));
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  m.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  openMenu = m;
  setTimeout(() => addEventListener('pointerdown', function off(e) {
    if (!m.contains(e.target)) { closeMenu(); removeEventListener('pointerdown', off, true); }
  }, true));
  return m;
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

// ── modales ─────────────────────────────────────────────────
export function modal({ title, body, foot, wide = false, onclose }) {
  const scrim = el('div', { class: 'scrim mu-modal' });
  const close = () => { scrim.remove(); removeEventListener('keydown', esc); if (onclose) onclose(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', esc);
  scrim.append(el('div', { class: `modal${wide ? ' lg' : ''}`, role: 'dialog', 'aria-label': title },
    el('div', { class: 'modal-head' }, el('span', { class: 't' }, title), el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: close }, 'Fermer')),
    el('div', { class: 'modal-body' }, body),
    foot ? el('div', { class: 'modal-foot' }, foot) : null));
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });
  document.body.append(scrim);
  return { close, root: scrim };
}

// Un nom demandé dans une petite modale → Promise<texte | null>
export function ask(title, label, value = '', go = 'Créer') {
  return new Promise((resolve) => {
    let done = false;
    const inp = el('input', { class: 'fld', value, maxlength: 80, 'aria-label': label });
    const ok = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } done = true; m.close(); resolve(v); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    const m = modal({
      title,
      body: el('label', { class: 'field' }, el('span', { class: 'lbl' }, label), inp),
      foot: [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Annuler'),
        el('button', { class: 'tb go', type: 'button', onclick: ok }, go)],
      onclose: () => { if (!done) resolve(null); },
    });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}

export function confirmBox(title, text, go = 'Retirer') {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, body: el('p', {}, text),
      foot: [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Annuler'),
        el('button', { class: 'tb go', type: 'button', onclick: () => { done = true; m.close(); resolve(true); } }, go)],
      onclose: () => { if (!done) resolve(false); },
    });
  });
}

// Lire un jeton de couleur (pour les dessins sur <canvas>, qui ne
// connaissent pas les variables CSS) : une seule vérité, tokens.css.
const TOK = new Map();
export function tok(name) {
  if (!TOK.has(name)) TOK.set(name, getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim());
  return TOK.get(name);
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// replaceChildren sans les trous (null, false) : le DOM écrirait « null »
export const put = (node, ...kids) => node.replaceChildren(...kids.flat(9).filter((k) => k !== null && k !== undefined && k !== false));
export { $ };
