// SHOWRUNNER TOOLS — le menu commun : clic droit, bouton « ⋯ », sous-menus.
// Une seule présentation et un seul clavier pour tous les outils (Idéation
// et ODIO avaient chacun le leur : ils pourront passer par celui-ci).
//
//   menu(x, y, items)              ouvre un menu à cet endroit, rend { close }
//   contextMenu(node, build)       clic droit (et touche Menu, Maj+F10) sur node
//   kebab(build, { title })        un bouton « ⋯ » qui ouvre le menu sous lui
//   closeMenus()                   ferme tout
//   pageMenu(build)                les entrées propres à la page, en tête du menu de repli
//   commonItems(e)                 les entrées communes (annuler, rétablir, journal, préférences…)
//   copy(texte, dit)               copier (le vieux chemin en http, où le presse-papiers moderne manque)
//
// Le clic droit du navigateur n'apparaît nulle part (Cal, 29/09 : « ne plus
// avoir de clic droit du navigateur partout dans nos outils ; on a un menu
// contextuel dédié à où on se trouve au survol ») : le gardien de
// commun/shell.js l'empêche sur toute page, sauf dans un champ de texte
// (copier, coller natifs) ou sous [data-native-menu] ; une zone qui a son
// menu (contextMenu) l'ouvre ; ailleurs, le menu de repli (fallbackMenu) :
// le lien, la sélection, l'image ou la vidéo survolés, les entrées de la
// page (pageMenu), puis les entrées communes.
//
// items : '-' (filet) · { head: 'TITRE' } · une entrée :
//   { label, onclick, icon?, dot?: 'or' (un jeton), key?: 'Ctrl+K' (raccourci
//     affiché), sub?: 'petit texte', danger?, checked?, items?: [...] (sous-menu),
//     disabled?, why?: 'ce qui manque' }
// Une entrée désactivée reste lisible et dit pourquoi (why) : écrit sous
// elle, et redit au clic au lieu de ne rien faire (règle 7 du thème). `build` peut rendre null (pas de menu ici).

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
    it.items ? el('span', { class: 'arr' }, '›') : it.key ? el('span', { class: 'key' }, it.key) : it.sub ? el('span', { class: 'sub' }, it.sub) : null,
    // désactivée : pourquoi, écrit dessous, lisible sans survol (règle 7 du thème) — le clic le redit
    off && it.why ? el('span', { class: 'why' }, it.why) : null);
    if (off && it.why) b.setAttribute('aria-description', it.why);
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
  // pas de filet en tête, en queue, ni deux de suite
  const list = [];
  for (const it of items || []) {
    if (!it || (it === '-' && (!list.length || list[list.length - 1] === '-'))) continue;
    list.push(it);
  }
  while (list[list.length - 1] === '-') list.pop();
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

// ── le menu de repli : là où aucune zone n'a le sien ────────
let pageBuild = null;
// les entrées propres à la page (build(e) → items ou null), en tête du repli
export function pageMenu(build) { pageBuild = build; }

export async function copy(text, said = 'copié') {
  try { await navigator.clipboard.writeText(text); toast(said); } catch {
    // http hors localhost : pas de presse-papiers asynchrone, le vieux chemin
    const t = el('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(t); t.select();
    try { document.execCommand('copy'); toast(said); } catch { toast('copie refusée par ce navigateur'); }
    t.remove();
  }
}
const cut = (s, n = 56) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Annuler, rétablir et le journal de la pile active de la page
// (commun/undo.js, qui se déclare dans window.SR_UNDO), les préférences
// (Ctrl+,), le lien de la page. Une zone peut les reprendre en fin de son menu.
export function commonItems(e = null) {
  const out = [];
  const U = window.SR_UNDO?.active?.();
  const inModal = e?.target instanceof Element && e.target.closest('.scrim:not([data-undo-ok])');
  if (U && !inModal) {
    const lab = U.labels();
    const k = window.SR_UNDO.keyLabel || (() => '');
    out.push(
      { label: U.canUndo() ? cut(lab.undo) : 'Annuler', icon: '↶', key: k('undo'), disabled: !U.canUndo(), why: 'rien à annuler dans cette page', onclick: () => U.undo() },
      { label: U.canRedo() ? cut(lab.redo) : 'Rétablir', icon: '↷', key: k('redo'), disabled: !U.canRedo(), why: 'rien à rétablir', onclick: () => U.redo() },
      { label: 'Le journal des gestes', icon: '↺', onclick: () => U.showLog() }, '-');
  }
  const tool = document.documentElement.dataset.srTool || null;
  out.push({ label: 'Préférences…', icon: '⚙', key: 'Ctrl+,', onclick: () => import('./prefs.js').then((m) => m.openPrefs(tool)) });
  out.push({ label: 'Copier le lien de la page', icon: '↗', onclick: () => copy(location.href, 'lien copié') });
  return out;
}

export function fallbackMenu(e, x, y, kb = false) {
  const t = e.target instanceof Element ? e.target : e.target?.parentElement || null;
  const items = [];
  const sel = String(window.getSelection?.() || '').trim();
  if (sel) items.push({ label: `Copier « ${cut(sel, 30)} »`, icon: '⧉', key: 'Ctrl+C', onclick: () => copy(sel) }, '-');
  const a = t?.closest('a[href]');
  if (a && !/^javascript:/i.test(a.getAttribute('href') || '')) {
    items.push({ head: 'le lien' },
      { label: 'Ouvrir', onclick: () => { location.href = a.href; } },
      { label: 'Ouvrir dans un nouvel onglet', icon: '↗', onclick: () => window.open(a.href, '_blank', 'noopener') },
      { label: 'Copier le lien', onclick: () => copy(a.href, 'lien copié') }, '-');
  }
  const media = t?.closest('img, video');
  const src = media && (media.currentSrc || media.src);
  if (media && src && !src.startsWith('data:') && !src.startsWith('blob:')) {
    const isV = media.tagName === 'VIDEO';
    if (isV) items.push({ label: media.paused ? 'Lecture' : 'Pause', icon: media.paused ? '▶' : '❚❚', onclick: () => (media.paused ? media.play().catch(() => {}) : media.pause()) });
    items.push({ label: isV ? 'Ouvrir la vidéo dans un onglet' : 'Ouvrir l’image dans un onglet', icon: '↗', onclick: () => window.open(src, '_blank', 'noopener') },
      { label: isV ? 'Copier l’adresse de la vidéo' : 'Copier l’adresse de l’image', onclick: () => copy(src, 'adresse copiée') }, '-');
  }
  const page = pageBuild ? pageBuild(e) : null;
  if (page && page.length) items.push(...page, '-');
  items.push(...commonItems(e));
  return menu(x, y, items, { focusFirst: kb });
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
