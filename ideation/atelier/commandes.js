// IDÉATION · ATELIER — la palette de commandes (prototype de Cal,
// « Innovation 03 ») : ctrl+K (⌘K sur Mac) cherche dans tous les objets de
// la planche et dans les commandes ; choisir un objet y fait voler la
// caméra et le sélectionne. ↑ ↓ Entrée, Échap. Les modules d'atelier
// inscrivent leurs commandes par `atelier(app).command(…)` ; celles de la
// planche (tout voir, encadrer, annuler…) sont inscrites ici, si l'app les a.

import { el, toast } from '../../commun/shell.js';
import { atelier, bbox, icon, MAC, MOD } from './socle.js';

const ICON = 'M10.5 4a6.5 6.5 0 1 0 .01 0M15.5 15.5L20 20';
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function install(app) {
  const A = atelier(app);
  const { S } = app;
  let box = null;

  // ── ce que l'on cherche dans un objet ────────────────────
  function words(n) {
    const it = n.type === 'media' ? S.items.get(n.item) : null;
    return norm([app.label(n), app.kindLabel?.(n), n.text, n.name, n.prompt, n.title, it?.title, it?.prompt, it?.element?.description].filter(Boolean).join(' '));
  }
  function objects(qn) {
    const terms = qn.split(/\s+/).filter(Boolean);
    const all = S.board?.nodes || [];
    const out = [];
    for (const n of all) {
      const hay = words(n);
      if (terms.length && !terms.every((t) => hay.includes(t))) continue;
      const lab = norm(app.label(n));
      const score = !terms.length ? (n.type === 'frame' ? 0 : n.type === 'title' ? 1 : 2) : lab.startsWith(terms[0]) ? 0 : lab.includes(terms[0]) ? 1 : 2;
      out.push({ n, score });
    }
    out.sort((a, b) => a.score - b.score);
    return out.slice(0, terms.length ? 14 : 6).map(({ n }) => ({
      kind: app.kindLabel?.(n) || n.type, label: app.label(n), hint: '↵ voler', run: () => flyTo(n.id) }));
  }
  function commands(qn) {
    const terms = qn.split(/\s+/).filter(Boolean);
    return A.commands.filter((c) => !terms.length || terms.every((t) => norm(`${c.label} ${c.sub || ''}`).includes(t))).map((c) => {
      const w = c.when ? c.when() : true;
      return { kind: 'commande', cmd: true, label: c.label, hint: w === true ? (c.key || '') : w, off: w !== true, run: c.run };
    });
  }
  function flyTo(id) {
    const n = app.node(id);
    if (!n) return;
    const r = bbox([n]);
    A.fly(A.viewFor({ x: r.x - 40, y: r.y - 40, w: r.w + 80, h: r.h + 80 }, { pad: 90, zmax: n.type === 'frame' ? 2 : 1.25 }), { ms: 620 });
    app.select([id]);
  }

  // ── la palette ───────────────────────────────────────────
  function open() {
    if (box || A.presenting || A.replaying) return;
    if (!S.board) { toast('ouvrez d’abord une planche'); return; }
    const restoreFocus = document.activeElement;
    let items = [], at = 0;
    const inp = el('input', { class: 'at-pal-in', placeholder: 'chercher un objet ou lancer une commande…', spellcheck: 'false', 'aria-label': 'chercher', autocomplete: 'off' });
    const list = el('div', { class: 'at-pal-l', role: 'listbox' });
    const paint = () => {
      const qn = norm(inp.value.trim());
      items = [...objects(qn), ...commands(qn)];
      at = Math.min(at, Math.max(0, items.length - 1));
      if (items[at]?.off) at = Math.max(0, items.findIndex((x) => !x.off));
      list.replaceChildren(...(items.length ? items.map((it, i) => el('div', {
        class: `at-pi${it.cmd ? ' cmd' : ''}${it.off ? ' off' : ''}${i === at ? ' on' : ''}`, role: 'option', 'aria-selected': i === at ? 'true' : 'false',
        title: it.off ? it.hint : '', onpointerenter: () => { at = i; mark(); }, onclick: () => choose(i) },
      el('span', { class: 'k' }, it.kind), el('span', { class: 't' }, it.label), el('span', { class: 'h' }, it.hint)))
        : [el('div', { class: 'at-pal-empty' }, 'rien ne correspond — essayez un autre mot')]));
    };
    const mark = () => {
      [...list.children].forEach((c, i) => { c.classList.toggle('on', i === at); c.setAttribute('aria-selected', i === at ? 'true' : 'false'); });
      list.children[at]?.scrollIntoView({ block: 'nearest' });
    };
    const choose = (i) => {
      const it = items[i];
      if (!it) return;
      if (it.off) { toast(it.hint); return; }
      close(false);
      it.run();
    };
    const close = (back = true) => {
      box?.remove(); box = null;
      if (back && restoreFocus && document.contains(restoreFocus)) restoreFocus.focus?.({ preventScroll: true });
    };
    inp.addEventListener('input', () => { at = 0; paint(); });
    inp.addEventListener('keydown', (e) => {
      const k = e.key;
      const move = (d) => { if (!items.length) return; let i = at; for (let s = 0; s < items.length; s++) { i = (i + d + items.length) % items.length; if (!items[i].off) break; } at = i; mark(); };
      if (k === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (k === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (k === 'Enter') { e.preventDefault(); choose(at); }
      else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (k === 'Tab') e.preventDefault();
    });
    box = el('div', { class: 'scrim at-pal-scrim', onpointerdown: (e) => { if (e.target === box) close(); } },
      el('div', { class: 'at-pal', role: 'dialog', 'aria-label': 'palette de commandes' },
        el('div', { class: 'at-pal-h' }, icon(ICON), inp, el('span', { class: 'lbl' }, 'échap')),
        list));
    box._close = close;
    document.body.append(box);
    paint();
    setTimeout(() => inp.focus({ preventScroll: true }), 0);
  }

  // ── les commandes de la planche (si l'app les a) ─────────
  const has = (f) => typeof f === 'function';
  const sel = () => [...S.sel].map(app.node).filter(Boolean);
  const click = (id) => () => document.getElementById(id)?.click();
  if (app.canvas && has(app.canvas.fit)) A.command({ order: 1, label: 'Tout voir', sub: 'ajuster la vue à la planche', key: 'maj+1', run: () => app.canvas.fit() });
  if (app.canvas && has(app.canvas.zoomTo)) A.command({ order: 2, label: 'Zoom à 100 %', key: 'maj+0', run: () => app.canvas.zoomTo(1) });
  if (has(app.frameAround)) A.command({ order: 60, label: 'Encadrer la sélection', sub: 'un cadre autour', when: () => (sel().length ? true : 'choisissez d’abord des objets'), run: () => app.frameAround() });
  if (has(app.tidy)) A.command({ order: 61, label: 'Ranger la sélection en grille', when: () => (sel().filter((n) => n.type !== 'frame').length > 1 ? true : 'choisissez au moins deux objets'), run: () => app.tidy() });
  if (has(app.undoStep)) A.command({ order: 70, label: 'Annuler', key: `${MOD}Z`, when: () => (S.undo?.length ? true : 'rien à annuler'), run: () => app.undoStep() });
  if (has(app.redoStep)) A.command({ order: 71, label: 'Rétablir', key: `${MOD}maj+Z`, when: () => (S.redo?.length ? true : 'rien à rétablir'), run: () => app.redoStep() });
  if (has(app.boardsModal)) A.command({ order: 80, label: 'Les planches…', sub: 'ouvrir, renommer, dupliquer', run: () => app.boardsModal() });
  if (has(app.newBoard)) A.command({ order: 81, label: 'Nouvelle planche…', run: () => app.newBoard() });
  if (has(app.exportBoard)) A.command({ order: 82, label: 'Exporter la planche en PNG', sub: 'dans la bibliothèque', when: () => (S.board?.nodes.length ? true : 'la planche est vide'), run: () => app.exportBoard('') });
  if (document.getElementById('b-lib')) A.command({ order: 90, label: 'Afficher ou masquer la bibliothèque', run: click('b-lib') });
  if (document.getElementById('b-help')) A.command({ order: 91, label: 'Les raccourcis', key: '?', run: click('b-help') });

  // ── le bouton, le raccourci ──────────────────────────────
  A.button({ order: 60, d: ICON, cls: 'at-k', label: el('kbd', {}, MAC ? '⌘K' : 'ctrl K'),
    title: `chercher dans la planche et les commandes · ${MAC ? '⌘K' : 'ctrl+K'}`, onclick: () => open() });
  A.key(10, (e, ctx) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'k') return false;
    if (box) { e.preventDefault(); box._close(); return true; }
    if (A.presenting || A.replaying || (ctx.overlay && !box)) return false;
    e.preventDefault();
    open();
    return true;
  });

  A.palette = { open, close: () => box?._close(), get isOpen() { return !!box; } };
}
