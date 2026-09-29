// SHOWRUNNER TOOLS — le menu commun : clic droit, bouton « ⋯ », sous-menus.
// Une seule présentation et un seul clavier pour tous les outils (Idéation
// et ODIO avaient chacun le leur : ils pourront passer par celui-ci).
//
//   menu(x, y, items)              ouvre un menu à cet endroit, rend { close }
//   contextMenu(node, build)       clic droit (et touche Menu, Maj+F10) sur node
//   kebab(build, { title })        un bouton « ⋯ » qui ouvre le menu sous lui
//   closeMenus()                   ferme tout
//
// items : '-' (filet) · { head: 'TITRE' } · une entrée :
//   { label, onclick, icon?, dot?: 'or' (un jeton), key?: 'Ctrl+K' (raccourci
//     affiché), sub?: 'petit texte', danger?, checked?, items?: [...] (sous-menu),
//     disabled?, why?: 'ce qui manque' }
// Une entrée désactivée reste lisible : au clic, elle dit pourquoi (why)
// au lieu de ne rien faire. `build` peut rendre null (pas de menu ici).

import { el, toast } from './shell.js';

// la feuille du menu, chargée une fois, à côté de ce fichier
if (!document.querySelector('link[data-sr-menu]')) {
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./menu.css', import.meta.url).href, 'data-sr-menu': '' }));
}

const stack = [];   // les menus ouverts, du principal au sous-menu le plus profond
let restore = null; // l'élément qui avait le focus avant l'ouverture

export function closeMenus() {
  while (stack.length) stack.pop().node.remove();
  removeEventListener('pointerdown', outside, true);
  removeEventListener('keydown', keys, true);
  removeEventListener('resize', closeMenus);
  removeEventListener('blur', closeMenus);
  for (const b of document.querySelectorAll('.sr-kebab[aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false');
  if (restore && document.contains(restore)) restore.focus({ preventScroll: true });
  restore = null;
}

function outside(e) {
  if (stack.some((m) => m.node.contains(e.target))) return;
  // le « ⋯ » qui a ouvert ce menu le referme lui-même, à son clic
  if (e.target.closest?.('.sr-kebab[aria-expanded="true"]')) return;
  closeMenus();
}

function place(node, x, y, flipX = null) {
  const r = node.getBoundingClientRect();
  let left = x;
  if (left + r.width > innerWidth - 8) left = flipX !== null ? flipX - r.width : innerWidth - r.width - 8;
  node.style.left = `${Math.max(8, left)}px`;
  node.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
}

function entries(m) { return [...m.node.querySelectorAll(':scope > .mi')]; }
function mark(m, i) {
  const list = entries(m);
  if (!list.length) return;
  m.at = (i + list.length) % list.length;
  list.forEach((b, k) => b.classList.toggle('on', k === m.at));
  list[m.at].scrollIntoView({ block: 'nearest' });
}

function build(items, depth) {
  const node = el('div', { class: 'sr-menu', role: 'menu', tabindex: '-1' });
  const m = { node, at: -1, depth };
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { node.append(el('i', { class: 'sep', role: 'separator' })); continue; }
    if (it.head) { node.append(el('span', { class: 'head' }, it.head)); continue; }
    const off = !!it.disabled;
    const b = el('button', {
      class: `mi${it.danger ? ' danger' : ''}`, type: 'button',
      role: it.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
      'aria-checked': it.checked === undefined ? null : String(!!it.checked),
      'aria-disabled': off ? 'true' : null, 'aria-haspopup': it.items ? 'menu' : null,
      title: off ? (it.why || '') : (it.title || ''), tabindex: '-1',
    },
    it.dot ? el('i', { class: 'dot', style: { background: `var(--${it.dot})` } })
      : el('span', { class: 'ic' }, it.checked === undefined ? (it.icon || '') : (it.checked ? '✓' : '')),
    el('span', { class: 'lb' }, it.label),
    it.items ? el('span', { class: 'arr' }, '›') : it.key ? el('span', { class: 'key' }, it.key) : it.sub ? el('span', { class: 'sub' }, it.sub) : null);
    b._it = it;
    b.addEventListener('pointerenter', () => {
      mark(m, entries(m).indexOf(b));
      closeFrom(depth + 1);
      if (it.items && !off) openSub(b, it.items, depth);
    });
    b.addEventListener('click', (e) => { e.stopPropagation(); activate(b, depth); });
    node.append(b);
  }
  node.addEventListener('contextmenu', (e) => e.preventDefault());
  return m;
}

function closeFrom(depth) {
  while (stack.length > depth) stack.pop().node.remove();
}

function openSub(b, items, depth) {
  const sub = build(items, depth + 1);
  document.body.append(sub.node);
  stack.push(sub);
  const r = b.getBoundingClientRect();
  place(sub.node, r.right - 4, r.top - 5, r.left + 4);
  return sub;
}

function activate(b, depth) {
  const it = b._it;
  if (it.disabled) { if (it.why) toast(it.why); return; }
  if (it.items) { closeFrom(depth + 1); const sub = openSub(b, it.items, depth); mark(sub, 0); sub.node.focus(); return; }
  closeMenus();
  if (it.onclick) it.onclick();
}

function keys(e) {
  const m = stack[stack.length - 1];
  if (!m) return;
  const list = entries(m);
  const cur = list[m.at];
  const k = e.key;
  if (k === 'Escape' || k === 'ArrowLeft') {
    e.preventDefault(); e.stopPropagation();
    if (stack.length > 1) { stack.pop().node.remove(); stack[stack.length - 1].node.focus(); }
    else if (k === 'Escape') closeMenus();
    return;
  }
  if (k === 'Tab') { e.preventDefault(); closeMenus(); return; }
  if (k === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); mark(m, m.at + 1); return; }
  if (k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); mark(m, m.at < 0 ? -1 : m.at - 1); return; }
  if (k === 'Home') { e.preventDefault(); mark(m, 0); return; }
  if (k === 'End') { e.preventDefault(); mark(m, -1); return; }
  if ((k === 'Enter' || k === ' ' || (k === 'ArrowRight' && cur?._it.items)) && cur) {
    e.preventDefault(); e.stopPropagation(); activate(cur, m.depth); return;
  }
  // une lettre : la prochaine entrée qui commence par elle
  if (k.length === 1 && /\p{L}|\p{N}/u.test(k)) {
    const q = k.toLowerCase();
    for (let s = 1; s <= list.length; s++) {
      const i = (m.at + s) % list.length;
      if (String(list[i]._it.label).trim().toLowerCase().startsWith(q)) { e.preventDefault(); mark(m, i); return; }
    }
  }
}

export function menu(x, y, items, { focusFirst = false } = {}) {
  closeMenus();
  const list = (items || []).filter(Boolean);
  if (!list.length) return { close: closeMenus };
  restore = document.activeElement;
  const m = build(list, 0);
  document.body.append(m.node);
  stack.push(m);
  place(m.node, x, y);
  m.node.focus({ preventScroll: true });
  if (focusFirst) mark(m, 0);
  // au tour suivant : le clic qui a ouvert le menu ne doit pas le refermer
  setTimeout(() => {
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', keys, true);
    addEventListener('resize', closeMenus);
    addEventListener('blur', closeMenus);
  });
  return { close: closeMenus, node: m.node };
}

// Clic droit sur node (ou sur ce que `build` reconnaît dans l'événement :
// build(e) lit e.target et rend les entrées, ou null pour laisser passer).
export function contextMenu(node, buildItems) {
  const open = (e, x, y, kb) => {
    const items = buildItems(e);
    if (!items) return;
    e.preventDefault(); e.stopPropagation();
    menu(x, y, items, { focusFirst: kb });
  };
  node.addEventListener('contextmenu', (e) => {
    const kb = e.button !== 2 && e.clientX === 0 && e.clientY === 0;
    if (kb) { const r = e.target.getBoundingClientRect(); open(e, r.left + 8, r.bottom - 4, true); }
    else open(e, e.clientX, e.clientY, false);
  });
  node.addEventListener('keydown', (e) => {
    if (e.key === 'F10' && e.shiftKey) {
      const r = e.target.getBoundingClientRect();
      open(e, r.left + 8, r.bottom - 4, true);
    }
  });
}

// Le bouton « ⋯ » : il ouvre le menu sous lui, aligné à sa droite.
export function kebab(buildItems, { title = 'plus d’actions', cls = '' } = {}) {
  const b = el('button', { class: `sr-kebab ${cls}`.trim(), type: 'button', title, 'aria-label': title, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, '⋯');
  b.addEventListener('click', (e) => {
    e.stopPropagation(); e.preventDefault();
    if (b.getAttribute('aria-expanded') === 'true') { closeMenus(); return; }
    const items = buildItems(e);
    if (!items) return;
    const r = b.getBoundingClientRect();
    const { node } = menu(r.right, r.bottom + 4, items, { focusFirst: e.detail === 0 });
    if (!node) return;
    const w = node.getBoundingClientRect().width;
    place(node, r.right - w, r.bottom + 4);
    b.setAttribute('aria-expanded', 'true');
  });
  return b;
}
