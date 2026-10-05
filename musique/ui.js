// MUSIQUE — les commandes : molette, choix, menu, modales.
// Molette : l'arc de 270° du kit NL (station-nl-rack), tirée à la
// verticale ; double-clic = valeur par défaut ; flèches au clavier.
// Aucune couleur ici : l'accent passe par la variable --k, posée sur un
// jeton de commun/tokens.css.

import { el, $ } from '../commun/shell.js';
import { menu as srMenu, closeMenus } from '../commun/menu.js';
import { toNorm, fromNorm, fmt } from './modules.js';

// el() de shell.js pose les variables CSS (--k, --c) par setProperty et
// saute les enfants null : une seule vérité, rien à doubler ici.
export { el };

const R = 16, C = 2 * Math.PI * R, SWEEP = 0.75;

// Le cadran d'une molette : la piste de 270°, l'arc de la valeur, l'aiguille —
// le dessin de toutes les molettes d'ODIO (celles du rack, de la console, des
// cartes du nodal, des sections de machine : machines/panneau.js). `n` : 0..1.
// Rend { svg, paint(n) } ; les couleurs sont celles de .kn (musique.css) :
// la piste en filet, l'arc et l'aiguille dans l'accent --k.
export function dial() {
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
  const paint = (n) => {
    arc.setAttribute('stroke-dasharray', `${(C * SWEEP * n).toFixed(2)} 999`);
    ptr.setAttribute('transform', `rotate(${(-135 + n * 270).toFixed(1)} 20 20)`);
  };
  return { svg, paint };
}

// knob(spec, valeur, {accent, size, onInput(v), onChange(v)}) → élément
export function knob(s, value, { accent = 'cy', size = 'md', onInput = () => {}, onChange = () => {}, label = s.label } = {}) {
  const d = dial();
  const v = el('span', { class: 'v' });
  const box = el('div', { class: `kn ${size}`, tabindex: 0, role: 'slider', 'aria-label': label,
    style: { '--k': `var(--${accent})` } },
  el('div', { class: 'dial' }, d.svg), v, size === 'xs' ? null : el('span', { class: 'l' }, label));
  let cur = value;
  const paint = () => {
    const n = toNorm(s, cur);
    d.paint(n);
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

// ── le fader de la console ──────────────────────────────────
// Course verticale, linéaire en dB (choix de réglage) ; tiré à la verticale,
// double-clic = la valeur par défaut (0 dB), flèches au clavier, Maj : réglage
// fin ; Début / Fin : les bornes, Page haut / bas : un dixième de la course.
// COUCHÉ (`couche: true`, Cal, 06/10 : « je ne veux plus aucun de ces sliders
// avec le rond tout simple… on a fait un kit avec des super sliders ») : le
// même fader à l'horizontale, son chapeau dans le rail — le volume d'une piste
// de l'arrangement, les curseurs du nodal ; aucun curseur natif dans ODIO.
// `valeur: false` : sans la lecture dessous (la page écrit la sienne). Une
// spec sans `def` : pas de double-clic. La molette n'y fait rien : elle reste
// à la règle de la vue (commun/molette.js).
const CAP_COUCHE = 8;   // la largeur du chapeau couché (musique.css, .fdr.h .cap)
export function fader(s, value, { accent = 'cy', onInput = () => {}, onChange = () => {}, label = s.label, couche = false, valeur = true, cls = '' } = {}) {
  const cap = el('i', { class: 'cap' });
  const fill = el('i', { class: 'fill' });
  const rail = el('div', { class: 'rail' }, fill, cap);
  const v = valeur ? el('span', { class: 'v' }) : null;
  const box = el('div', { class: `fdr${couche ? ' h' : ''}${cls ? ` ${cls}` : ''}`, tabindex: 0, role: 'slider', 'aria-label': label,
    'aria-orientation': couche ? 'horizontal' : 'vertical', 'aria-valuemin': s.min, 'aria-valuemax': s.max,
    style: { '--k': `var(--${accent})` } }, rail, v);
  let cur = value;
  const paint = () => {
    const n = toNorm(s, cur), pc = (n * 100).toFixed(2);
    if (couche) {
      // la course tient dans le rail : le chapeau va de 0 à (largeur − chapeau)
      cap.style.left = `calc(${pc}% - ${(n * CAP_COUCHE).toFixed(2)}px)`;
      fill.style.width = `calc(${pc}% - ${(n * CAP_COUCHE - CAP_COUCHE / 2).toFixed(2)}px)`;
    } else {
      cap.style.bottom = `calc(${pc}% - 6px)`;
      fill.style.height = `${pc}%`;
    }
    const txt = fmt(s, cur);
    if (v) v.textContent = txt;
    box.setAttribute('aria-valuenow', Math.round(cur * 1000) / 1000);
    box.setAttribute('aria-valuetext', `${txt} ${s.unit || ''}`.trim());
    box.title = `${label} : ${txt} ${s.unit || ''}`.trim();
  };
  const set = (nv, commit) => { cur = nv; paint(); onInput(cur); if (commit) onChange(cur); };
  rail.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    box.focus({ preventScroll: true });
    rail.setPointerCapture(e.pointerId);
    const r = rail.getBoundingClientRect();
    const grabCap = e.target === cap;
    // la position sous le pointeur, en 0..1 de la course ; le geste, en pixels
    const at = (ev) => (couche ? (ev.clientX - r.left - CAP_COUCHE / 2) / Math.max(1, r.width - CAP_COUCHE) : 1 - (ev.clientY - r.top) / r.height);
    const run = couche ? Math.max(1, r.width - CAP_COUCHE) : r.height;
    const d = (ev) => (couche ? ev.clientX - e.clientX : e.clientY - ev.clientY);
    const n0 = toNorm(s, cur);
    if (!grabCap) set(fromNorm(s, at(e)), false);
    const n1 = toNorm(s, cur);
    const mv = (ev) => set(fromNorm(s, (grabCap ? n0 : n1) + d(ev) / (run * (ev.shiftKey ? 4 : 1))), false);
    const up = () => {
      rail.removeEventListener('pointermove', mv); rail.removeEventListener('pointerup', up); rail.removeEventListener('pointercancel', up);
      onChange(cur);
    };
    rail.addEventListener('pointermove', mv); rail.addEventListener('pointerup', up); rail.addEventListener('pointercancel', up);
  });
  if (s.def !== undefined) box.addEventListener('dblclick', (e) => { e.stopPropagation(); set(s.def, true); });
  box.addEventListener('keydown', (e) => {
    const n = toNorm(s, cur);
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    // un cran : 2 % de la course (Maj : 0,5 %), jamais moins que le pas de la spec
    const pas = s.step && s.curve !== 'log' ? s.step / (s.max - s.min) : 0;
    const to = step ? n + step * Math.max(pas, e.shiftKey ? 0.005 : 0.02)
      : { Home: 0, End: 1, PageUp: n + 0.1, PageDown: n - 0.1 }[e.key];
    if (to === undefined) return;
    e.preventDefault(); e.stopPropagation();
    set(fromNorm(s, to), true);
  });
  box.setValue = (nv) => { cur = nv; paint(); };
  paint();
  return box;
}

// Un vu-mètre : crête en dB (-60..+6), maintien de crête 1,5 s, témoin
// rouge-orangé au-dessus de -1 dBFS. `set(db)` à chaque image.
export function vu({ lr = false } = {}) {
  const mk = () => { const bar = el('i', { class: 'lvl' }), hold = el('i', { class: 'hold' }); return { col: el('div', { class: 'col' }, bar, hold), bar, hold, pk: -Infinity, t: 0 }; };
  const cols = lr ? [mk(), mk()] : [mk()];
  const box = el('div', { class: `vu${lr ? ' lr' : ''}` }, cols.map((c) => c.col));
  const pos = (db) => Math.max(0, Math.min(1, (db + 60) / 66));
  box.set = (...dbs) => {
    const now = performance.now();
    cols.forEach((c, i) => {
      const db = dbs[i] ?? dbs[0];
      c.bar.style.height = `${(pos(db) * 100).toFixed(1)}%`;
      if (db > c.pk || now - c.t > 1500) { c.pk = db; c.t = now; }
      c.hold.style.bottom = `${(pos(c.pk) * 100).toFixed(1)}%`;
      c.col.classList.toggle('hot', c.pk > -1);
    });
  };
  box.peak = () => Math.max(...cols.map((c) => c.pk));
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
// Le menu commun du portail (commun/menu.js) : une présentation, un clavier
// (flèches, Entrée, Échap, la première lettre), les sous-menus (`items`), une
// entrée désactivée qui dit pourquoi (`why`). Les entrées d'ODIO ont déjà sa
// forme : { label, sub, dot, onclick, disabled, why } · '-' · { head }.
export function menu(x, y, items) {
  return srMenu(x, y, items).node || null;
}
export const closeMenu = closeMenus;

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

// Un panneau qui glisse de la droite, sans voile : la session reste visible
// et jouable dessous (le génératif, le guide). Un seul ouvert à la fois.
let openDrawer = null;
export function drawer({ title, cls = '', head = [], onclose }) {
  if (openDrawer) openDrawer.close();
  const body = el('div', { class: 'mu-dr-body' });
  const root = el('aside', { class: `mu-drawer ${cls}`, role: 'dialog', 'aria-label': title });
  const close = () => {
    root.classList.remove('on');
    setTimeout(() => root.remove(), 200);
    removeEventListener('keydown', esc);
    if (openDrawer === api) { openDrawer = null; document.body.classList.remove('mu-drawer-open'); }
    if (onclose) onclose();
  };
  // un seul orange à l'écran : le panneau porte le sien, le GUIDE s'éteint
  document.body.classList.add('mu-drawer-open');
  const esc = (e) => { if (e.key === 'Escape' && !e.target.closest?.('input, textarea, select')) close(); };
  root.append(el('div', { class: 'mu-dr-head' }, el('span', { class: 't' }, title), ...head, el('span', { class: 'sp' }),
    el('button', { class: 'tb ghost sm', type: 'button', onclick: close }, 'Fermer')), body);
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('on'));
  addEventListener('keydown', esc);
  const api = { root, body, close };
  openDrawer = api;
  return api;
}
export const drawerOpen = () => openDrawer;

// Renommer EN PLACE (double-clic sur ce que l'utilisateur personnalise :
// piste, clip, section, marqueur, motif, préréglage) : le texte devient un
// champ, le seul endroit de la page où l'on sélectionne du texte. Entrée ou
// quitter le champ : valider ; Échap : annuler.
export function inlineEdit(node, value, onCommit, { max = 60 } = {}) {
  if (!node || node.classList.contains('editing')) return;
  const inp = el('input', { class: 'mu-inline', value: value || '', maxlength: max, 'aria-label': 'renommer', spellcheck: 'false' });
  const w = node.getBoundingClientRect().width;
  inp.style.width = `${Math.max(70, Math.min(320, w + 20))}px`;
  const prev = [...node.childNodes];
  node.classList.add('editing');
  node.replaceChildren(inp);
  inp.focus(); inp.select();
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    node.classList.remove('editing');
    node.replaceChildren(...prev);
    if (ok && v && v !== value) onCommit(v);
  };
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
  for (const ev of ['pointerdown', 'dblclick', 'click', 'contextmenu']) inp.addEventListener(ev, (e) => e.stopPropagation());
}

// Un séparateur qu'on tire : `axis` 'x' (largeur) ou 'y' (hauteur) ;
// get() → taille courante, set(v) pendant le geste, done(v) à la fin.
// Double-clic : `reset`.
export function splitter(axis, { get, set, done, min = 80, max = 2000, reset = null, invert = false, title = '' }) {
  const s = el('div', { class: `mu-split ${axis}`, role: 'separator', 'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal', title });
  s.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    s.setPointerCapture(e.pointerId);
    const p0 = axis === 'x' ? e.clientX : e.clientY, v0 = get();
    s.classList.add('on');
    const mv = (ev) => { const d = (axis === 'x' ? ev.clientX : ev.clientY) - p0; set(clamp(v0 + (invert ? -d : d), min, max)); };
    const up = (ev) => { s.removeEventListener('pointermove', mv); s.removeEventListener('pointerup', up); s.classList.remove('on');
      const d = (axis === 'x' ? ev.clientX : ev.clientY) - p0; done(clamp(v0 + (invert ? -d : d), min, max)); };
    s.addEventListener('pointermove', mv); s.addEventListener('pointerup', up);
  });
  if (reset !== null) s.addEventListener('dblclick', () => { set(reset); done(reset); });
  return s;
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

// La lettre d'un raccourci : e.key (le caractère), jamais e.code (la touche
// physique) — sur un clavier AZERTY, la touche marquée A est KeyQ, Z est KeyW,
// M est Semicolon. e.code reste pour ce qui est une position : les rangées du
// clavier MIDI de l'ordinateur (musique.js, KEYS ; machines/clavier-ordinateur.js).
export const letter = (e) => (e.key && e.key.length === 1 ? e.key.toLowerCase() : '');

// replaceChildren sans les trous (null, false) : le DOM écrirait « null »
export const put = (node, ...kids) => node.replaceChildren(...kids.flat(9).filter((k) => k !== null && k !== undefined && k !== false));
export { $ };
