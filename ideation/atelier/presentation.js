// IDÉATION · ATELIER — la présentation par cadres (prototype de Cal,
// « Innovation 04 »), et les diapositives (docs/etudes/presentations.md,
// étapes 1, 2 et 4). Chaque cadre est une diapositive, dans l'ordre gardé sur la
// planche (diapo/ordre.js : `slide`, `skip` sur chaque cadre — le panneau
// Diapositives le règle) ; ← → (espace, Page), Début / Fin, F, Échap. L'interface
// disparaît, la page passe en plein écran (commun/pleinecran.js).
//
// Deux façons de montrer un cadre :
//   - un cadre libre : la caméra vole jusqu'à lui (le « vol » du prototype), ce
//     qui n'est pas dedans s'éteint à 7 % ;
//   - une diapositive (un cadre qui a un format, diapo/) : sa scène remplit
//     l'écran, bandes autour (la scène 16:9 garde son rapport, comme reveal.js),
//     rien d'autre ne se voit ; on y arrive par sa transition : coupe, fondu,
//     poussée, ou « morph » (le Magic Move de Keynote : un objet présent sur les
//     deux diapositives — la même image de la bibliothèque, ou le même `mid` posé
//     par « Dupliquer la diapositive » — voyage de l'un à l'autre). Le navigateur
//     le fait seul : View Transitions API (document.startViewTransition,
//     view-transition-name ; MDN, « Baseline 2025 », disponible dans les trois
//     moteurs depuis octobre 2025). Sans elle : la coupe. Avec
//     prefers-reduced-motion : le fondu seul (l'étude, § 3.4).
// Ce qu'on voit est la planche elle-même : une seule vérité du rendu.

import { el, toast } from '../../commun/shell.js';
import { menu } from '../../commun/menu.js';
import { basculer, enPleinEcran, permis } from '../../commun/pleinecran.js';
import { atelier, within } from './socle.js';
import { deckOf, isSlide, transOf, shownOf } from '../diapo/ordre.js';

const ICON = 'M3.5 4.5h17v11h-17zM12 15.5V20M8 20h8M10 8l4 2-4 2z';
// la place d'un cadre libre : le nom du cadre au-dessus, la barre en dessous
const PAD = { t: 58, r: 44, b: 78, l: 44 };
const VT = ['vt-fade', 'vt-push', 'vt-morph', 'vt-back'];

export function install(app) {
  const A = atelier(app);
  const { S } = app;
  const cv = A.cv;
  const lit = A.style('presentation');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let on = false, idx = 0, ids = [], before = null, shield = null, idleT = 0, fs = false, fsMine = false, vtSeq = 0, last = null;
  // la scène d'une diapositive : tout ce qui est hors d'elle est couvert (une ombre de 100vmax)
  const mask = el('div', { class: 'at-mask', hidden: true });
  cv.append(mask);

  // ── les diapositives ─────────────────────────────────────
  const slides = () => deckOf(S.board);
  const shown = () => shownOf(S.board);

  // ── entrer, aller, sortir ────────────────────────────────
  function start(fromId = null) {
    if (!S.board) { toast('ouvrez d’abord une planche'); return; }
    if (on) return;
    const list = shown();
    if (!list.length) {
      const k = S.board.nodes.filter((n) => n.type === 'frame').length;
      toast(k ? 'toutes les diapositives sont masquées : le panneau Diapositives les remontre'
        : 'aucun cadre à présenter : un cadre (F) autour de ce qu’on veut montrer devient une diapositive', 7000);
      return;
    }
    app.emit('atelier:present', true);
    ids = list.map((f) => f.id);
    idx = Math.max(0, fromId ? ids.indexOf(fromId) : 0);
    before = A.current();
    on = true; A.presenting = true;
    app.select([]);
    document.body.classList.add('at-presenting');
    cv.classList.add('at-pres');
    shield = A.shield({ cls: 'pres' });
    shield.addEventListener('pointermove', wake);
    bar.hidden = false;
    wake();
    // le plein écran de la page (commun/pleinecran.js) ; refusé (iPhone, cadre) : la page suffit
    if (permis() && !enPleinEcran()) { fsMine = true; basculer().then(() => { fs = enPleinEcran(); if (!fs) fsMine = false; }); }
    // l'interface s'efface : la planche change de taille, on y va ensuite
    requestAnimationFrame(() => requestAnimationFrame(() => go(idx, { ms: 720, first: true })));
  }
  const viewOf = (f) => (isSlide(f) ? A.viewFor(f, { pad: 0, zmax: 4 }) : A.viewFor(f, { pad: PAD, zmax: 4 }));
  // la scène d'une diapositive posée à l'écran : le masque la cerne
  function placeMask(f) {
    if (!on || !isSlide(f)) { mask.hidden = true; return; }
    const v = S.view;
    Object.assign(mask.style, { left: `${v.x + f.x * v.z}px`, top: `${v.y + f.y * v.z}px`, width: `${f.w * v.z}px`, height: `${f.h * v.z}px` });
    mask.hidden = false;
  }
  // montrer `f` d'un coup (ce qu'une transition capture comme « après »)
  function show(f) {
    const keep = [f.id, ...S.board.nodes.filter((n) => within(n, f)).map((n) => n.id)];
    const set = new Set(keep);
    lit(A.litCss('at-pres', keep, S.board.links.filter((l) => set.has(l.a) && set.has(l.b)).map((l) => l.id)));
    cv.classList.toggle('at-deck', isSlide(f));
    paintBar();
  }
  function go(i, { ms = 640, first = false } = {}) {
    if (!on) return Promise.resolve();
    ids = ids.filter((id) => app.node(id));
    if (!ids.length) { stop(); return Promise.resolve(); }
    const prev = first ? null : app.node(ids[idx]);
    const back = !first && i < idx;
    idx = ((i % ids.length) + ids.length) % ids.length;
    const f = app.node(ids[idx]);
    if (prev === f && !first) return Promise.resolve();
    // la transition : celle de la diapositive où l'on arrive ; en arrière, celle de celle qu'on quitte
    const kind = first ? (isSlide(f) ? 'cut' : 'fly') : back ? transOf(prev) : transOf(f);
    last = { kind, from: prev?.id || null, to: f.id, back, pairs: 0, vt: false };
    if (!isSlide(f) || kind === 'fly') {
      show(f); placeMask(null);
      return A.fly(viewOf(f), { ms, hard: true });
    }
    const now = () => { show(f); A.setView(viewOf(f)); app.canvas.cull?.(); placeMask(f); };
    return transit(reduced.matches && kind !== 'cut' ? 'fade' : kind, now, prev, f, back);
  }
  // les objets qui voyagent (morph) : même image de la bibliothèque, ou même `mid`, une fois de chaque côté
  function pairs(a, b) {
    if (!a || !b) return [];
    const key = (n) => n.mid || (n.type === 'media' ? `i:${n.item}` : '');
    const side = (f) => {
      const m = new Map();
      for (const n of S.board.nodes) {
        if (n.type === 'frame' || !within(n, f)) continue;
        const k = key(n);
        if (k) m.set(k, m.has(k) ? null : n);   // deux fois le même : ni l'un ni l'autre
      }
      return m;
    };
    const A1 = side(a), B1 = side(b), out = [];
    for (const [k, n] of A1) { const m = B1.get(k); if (n && m) out.push([n.id, m.id]); }
    return out;
  }
  function transit(kind, apply, from, to, back) {
    const root = document.documentElement;
    if (kind === 'cut' || !document.startViewTransition) { apply(); return Promise.resolve(); }
    const seq = ++vtSeq;
    root.classList.remove(...VT);
    root.classList.add(`vt-${kind}`);
    if (back) root.classList.add('vt-back');
    const P = kind === 'morph' ? pairs(from, to) : [];
    const elOf = (id) => A.nodeEl(id);
    P.forEach(([a], i) => { const e = elOf(a); if (e) e.style.viewTransitionName = `dp-m${i}`; });
    last.pairs = P.length; last.vt = true;
    let vt;
    try {
      vt = document.startViewTransition(() => {
        P.forEach(([a]) => { const e = elOf(a); if (e) e.style.viewTransitionName = ''; });
        apply();
        P.forEach(([, b], i) => { const e = elOf(b); if (e) e.style.viewTransitionName = `dp-m${i}`; });
      });
    } catch { apply(); root.classList.remove(...VT); return Promise.resolve(); }
    return vt.finished.catch(() => {}).finally(() => {
      P.forEach(([a, b]) => { for (const id of [a, b]) { const e = elOf(id); if (e) e.style.viewTransitionName = ''; } });
      if (seq === vtSeq) root.classList.remove(...VT);
    });
  }
  function stop() {
    if (!on) return;
    on = false; A.presenting = false;
    clearTimeout(idleT);
    document.body.classList.remove('at-presenting');
    cv.classList.remove('at-pres', 'at-idle', 'at-deck');
    mask.hidden = true;
    lit('');
    shield?.remove(); shield = null;
    bar.hidden = true;
    if (fsMine && enPleinEcran()) basculer();
    fs = false; fsMine = false;
    app.emit('atelier:present', false);
    const back = before;
    before = null;
    if (back) requestAnimationFrame(() => requestAnimationFrame(() => A.fly(A.toView(back), { ms: 420 })));
  }
  // la souris s'endort : la barre et le pointeur s'effacent
  function wake() {
    cv.classList.remove('at-idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (on && !bar.matches(':hover')) cv.classList.add('at-idle'); }, 2600);
  }
  function fullscreen() {
    if (enPleinEcran()) { fsMine = false; basculer(); return; }
    if (!permis()) { toast('ce navigateur refuse le plein écran à cette page — F11 met toute la fenêtre en plein écran', 5000); return; }
    basculer().then(() => { fs = enPleinEcran(); fsMine = fs; });
  }
  // la fenêtre change (plein écran, redimensionnement) : la diapositive se recale
  let fitF = 0;
  new ResizeObserver(() => {
    if (!on) return;
    cancelAnimationFrame(fitF);
    fitF = requestAnimationFrame(() => { const f = app.node(ids[idx]); if (f) { A.setView(viewOf(f)); placeMask(f); } });
  }).observe(cv);
  // le plein écran quitté par Échap (le navigateur le prend pour lui) pendant qu'on présente : on
  // sort de la présentation ; quitté parce qu'on passe à une autre fenêtre (la page n'a plus la
  // main) : la présentation reste, on la retrouve en revenant
  addEventListener('fullscreenchange', () => {
    const was = fs;
    fs = enPleinEcran();
    if (on && was && !fs && fsMine) {
      fsMine = false;
      if (document.visibilityState === 'visible' && document.hasFocus()) { stop(); return; }
    }
    paintBar();
  });

  // ── la barre de la présentation ──────────────────────────
  const no = el('span', { class: 'no' });
  const tt = el('span', { class: 'tt' });
  const fsB = el('button', { class: 'tb ghost sm', type: 'button', onclick: fullscreen }, 'Plein écran');
  const bar = A.panel('at-pbar',
    el('button', { class: 'nav', type: 'button', title: 'précédente · ←', 'aria-label': 'diapositive précédente', onclick: () => go(idx - 1) }, '‹'),
    no, tt,
    el('button', { class: 'nav', type: 'button', title: 'suivante · → ou espace', 'aria-label': 'diapositive suivante', onclick: () => go(idx + 1) }, '›'),
    el('i', { class: 'sep' }),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'aller à une diapositive', onclick: (e) => jump(e.currentTarget) }, 'Diapositives'),
    fsB,
    el('button', { class: 'tb ghost sm', type: 'button', title: 'sortir de la présentation', onclick: () => stop() }, 'Échap'));
  bar.hidden = true;
  bar.addEventListener('pointermove', wake);
  cv.append(bar);
  function paintBar() {
    if (!on) return;
    const f = app.node(ids[idx]);
    no.textContent = `${String(idx + 1).padStart(2, '0')} / ${String(ids.length).padStart(2, '0')}`;
    tt.textContent = f?.name || 'Cadre';
    fsB.textContent = enPleinEcran() ? 'Fenêtre' : 'Plein écran';
    fsB.title = enPleinEcran() ? 'quitter le plein écran' : 'tout l’écran pour la présentation';
  }
  // la liste des diapositives, pour y sauter
  function jump(b) {
    const r = b.getBoundingClientRect();
    menu(r.left, r.top - 8, [{ head: 'aller à' }, ...ids.map((id, k) => ({ label: `${String(k + 1).padStart(2, '0')} · ${app.node(id)?.name || 'Cadre'}`,
      checked: k === idx, onclick: () => go(k) }))]);
  }

  // ── l'ordre des diapositives : le panneau (diapo/) ───────
  const sorter = () => { if (app.diapo) app.diapo.open(); else toast('le panneau Diapositives n’est pas chargé'); };

  // ── le bouton, le menu, la palette ───────────────────────
  const oneFrame = () => {
    if (S.sel.size !== 1) return null;
    const n = app.node([...S.sel][0]);
    return n?.type === 'frame' ? n : null;
  };
  const btn = A.button({ order: 10, d: ICON, name: 'Présenter les cadres',
    title: 'présenter les cadres : chaque cadre est une diapositive · ← → Échap · clic droit : depuis le cadre choisi, l’ordre',
    // un cadre choisi : on commence par lui
    onclick: () => { const f = oneFrame(); start(f && shown().some((x) => x.id === f.id) ? f.id : null); },
    oncontext: (e, b) => {
      const r = b.getBoundingClientRect();
      const f = oneFrame();
      menu(r.left, r.bottom + 4, [{ head: 'Présentation' },
        { label: 'Depuis le début', onclick: () => start() },
        { label: 'Depuis le cadre choisi', disabled: !f, why: 'choisissez d’abord un cadre sur la planche', onclick: () => start(f.id) },
        '-', { label: 'Ordre des diapositives…', sub: 'le panneau', onclick: () => sorter() }]);
    } });
  // dans la barre du haut, Présenter se lit (comme Exporter : un mot, l'icône seule quand la barre se resserre)
  btn.className = 'tb ghost sm cmp at-present';
  btn.replaceChildren(el('span', { class: 'bi' }, ...btn.childNodes), el('span', { class: 'bt' }, 'Présenter'));
  const syncBtn = () => btn.classList.toggle('on', on);
  app.on('atelier:present', syncBtn);
  A.command({ order: 10, label: 'Présenter les cadres', sub: 'diapositives', run: () => start() });
  A.command({ order: 11, label: 'Présenter depuis le cadre choisi', when: () => (oneFrame() ? true : 'choisissez d’abord un cadre'), run: () => start(oneFrame().id) });
  A.command({ order: 12, label: 'Ordre des diapositives…', run: () => sorter() });

  // ── le clavier : tant qu'on présente, la planche ne reçoit rien ─
  A.key(20, (e, ctx) => {
    if (!on || ctx.overlay) return false;
    const k = e.key;
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); go(idx + 1); wake(); return true; }
    if (['ArrowLeft', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); go(idx - 1); wake(); return true; }
    if (k === 'Home') { e.preventDefault(); go(0); return true; }
    if (k === 'End') { e.preventDefault(); go(ids.length - 1); return true; }
    if (k === 'Escape') { e.preventDefault(); stop(); return true; }
    if (k.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) { fullscreen(); return true; }
    return true;   // le reste ne touche pas la planche ; le navigateur garde les siens (F5, F11…)
  });
  // une autre planche s'ouvre : la présentation s'arrête
  app.on('board', () => { if (on) { before = null; stop(); } });

  // pour les essais
  A.presentation = { start, stop, go, sorter, slides, get index() { return idx; }, get ids() { return [...ids]; }, get last() { return last; } };
}
