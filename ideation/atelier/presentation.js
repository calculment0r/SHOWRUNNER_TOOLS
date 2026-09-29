// IDÉATION · ATELIER — la présentation par cadres (prototype de Cal,
// « Innovation 04 ») : les cadres deviennent des diapositives dans l'ordre
// de lecture de la planche, la caméra vole de l'un à l'autre, l'interface
// disparaît ; ← → (espace, Page), Début / Fin, Échap. Ce qui n'est pas dans
// la diapositive s'éteint. Clic droit sur le bouton (ou la palette) : l'ordre
// des diapositives, à réordonner et à masquer si l'ordre de lecture ne
// convient pas.
//
// L'ordre choisi est gardé dans ce navigateur (`ide-at-slides-<planche>`) :
// le serveur ne garde d'un cadre que sa place, sa taille et son nom
// (server/tools/ideation.py, _node) — pour qu'il suive la planche, il
// faudrait qu'il y garde aussi un numéro de diapositive (voir l'étude).

import { el, toast } from '../../commun/shell.js';
import { menu } from '../../commun/menu.js';
import { atelier, readingOrder, within } from './socle.js';

const ICON = 'M3.5 4.5h17v11h-17zM12 15.5V20M8 20h8M10 8l4 2-4 2z';
// la place de la diapositive : le nom du cadre au-dessus, la barre en dessous
const PAD = { t: 58, r: 44, b: 78, l: 44 };

export function install(app) {
  const A = atelier(app);
  const { S } = app;
  const cv = A.cv;
  const lit = A.style('presentation');
  let on = false, idx = 0, ids = [], before = null, shield = null, idleT = 0, fs = false;

  // ── les diapositives ─────────────────────────────────────
  const keyOf = () => 'at-slides-' + S.board.id;
  function slides() {
    const all = S.board ? S.board.nodes.filter((n) => n.type === 'frame') : [];
    const saved = (S.board && app.LS(keyOf())) || {};
    const byId = new Map(all.map((f) => [f.id, f]));
    const order = (saved.order || []).filter((id) => byId.has(id));
    const seq = [...order.map((id) => byId.get(id)), ...readingOrder(all.filter((f) => !order.includes(f.id)))];
    return { seq, skip: new Set((saved.skip || []).filter((id) => byId.has(id))), custom: !!order.length };
  }
  const shown = () => { const { seq, skip } = slides(); return seq.filter((f) => !skip.has(f.id)); };
  const frameCount = (f) => S.board.nodes.filter((n) => within(n, f)).length;

  // ── entrer, aller, sortir ────────────────────────────────
  function start(fromId = null) {
    if (!S.board) { toast('ouvrez d’abord une planche'); return; }
    if (on) return;
    const list = shown();
    if (!list.length) {
      const k = S.board.nodes.filter((n) => n.type === 'frame').length;
      toast(k ? 'toutes les diapositives sont masquées : l’ordre des diapositives (clic droit sur Présenter) les remontre'
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
    // l'interface s'efface : la planche change de taille, on vole ensuite
    requestAnimationFrame(() => requestAnimationFrame(() => go(idx, { ms: 720 })));
  }
  function go(i, { ms = 640 } = {}) {
    if (!on) return;
    ids = ids.filter((id) => app.node(id));
    if (!ids.length) { stop(); return; }
    idx = ((i % ids.length) + ids.length) % ids.length;
    const f = app.node(ids[idx]);
    const keep = [f.id, ...S.board.nodes.filter((n) => within(n, f)).map((n) => n.id)];
    const set = new Set(keep);
    lit(A.litCss('at-pres', keep, S.board.links.filter((l) => set.has(l.a) && set.has(l.b)).map((l) => l.id)));
    paintBar();
    return A.fly(A.viewFor(f, { pad: PAD, zmax: 4 }), { ms, hard: true });
  }
  function stop() {
    if (!on) return;
    on = false; A.presenting = false;
    clearTimeout(idleT);
    document.body.classList.remove('at-presenting');
    cv.classList.remove('at-pres', 'at-idle');
    lit('');
    shield?.remove(); shield = null;
    bar.hidden = true;
    if (document.fullscreenElement && fs) document.exitFullscreen?.().catch(() => {});
    fs = false;
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
    if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); fs = false; return; }
    document.documentElement.requestFullscreen?.().then(() => { fs = true; }).catch((e) => toast(`plein écran refusé : ${e.message}`));
  }
  // la fenêtre change (plein écran, redimensionnement) : la diapositive se recale
  let fitF = 0;
  new ResizeObserver(() => {
    if (!on) return;
    cancelAnimationFrame(fitF);
    fitF = requestAnimationFrame(() => { const f = app.node(ids[idx]); if (f) A.setView(A.viewFor(f, { pad: PAD, zmax: 4 })); });
  }).observe(cv);
  addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) fs = false; paintBar(); });

  // ── la barre de la présentation ──────────────────────────
  const no = el('span', { class: 'no' });
  const tt = el('span', { class: 'tt' });
  const fsB = el('button', { class: 'tb ghost sm', type: 'button', onclick: fullscreen }, 'Plein écran');
  const bar = A.panel('at-pbar',
    el('button', { class: 'nav', type: 'button', title: 'précédente · ←', 'aria-label': 'diapositive précédente', onclick: () => go(idx - 1) }, '‹'),
    no, tt,
    el('button', { class: 'nav', type: 'button', title: 'suivante · → ou espace', 'aria-label': 'diapositive suivante', onclick: () => go(idx + 1) }, '›'),
    el('i', { class: 'sep' }),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'réordonner, masquer des diapositives', onclick: () => sorter() }, 'Diapositives'),
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
    fsB.textContent = document.fullscreenElement ? 'Fenêtre' : 'Plein écran';
    fsB.title = document.fullscreenElement ? 'quitter le plein écran' : 'tout l’écran pour la présentation';
  }

  // ── l'ordre des diapositives ─────────────────────────────
  function sorter() {
    if (!S.board) return;
    const { seq, skip } = slides();
    let order = seq.map((f) => f.id);
    const hide = new Set(skip);
    const box = el('div', { class: 'at-sorter' });
    const count = el('span', { class: 'lbl' });
    let dragId = null;
    const save = (custom = true) => {
      app.LS(keyOf(), custom ? { order, skip: [...hide] } : (hide.size ? { order: [], skip: [...hide] } : null));
      if (on) { const cur = ids[idx]; ids = shown().map((f) => f.id); idx = Math.max(0, ids.indexOf(cur)); if (!ids.length) stop(); else go(idx, { ms: 0 }); }
      paint();
    };
    const move = (id, to) => { const from = order.indexOf(id); if (from < 0 || to === from) return; order.splice(from, 1); order.splice(clampI(to, order.length), 0, id); save(); };
    const clampI = (v, n) => Math.max(0, Math.min(n, v));
    const row = (id, k, list) => {
      const f = app.node(id);
      let n = 0;
      if (!hide.has(id)) n = list.filter((x) => !hide.has(x)).indexOf(id) + 1;
      const r = el('div', { class: 'at-srow' + (hide.has(id) ? ' off' : '') + (on && ids[idx] === id ? ' cur' : ''), draggable: 'true', 'data-id': id },
        el('span', { class: 'grip', title: 'glisser pour changer la place', 'aria-hidden': 'true' }, '⋮⋮'),
        el('span', { class: 'no' }, n ? String(n).padStart(2, '0') : '—'),
        el('button', { class: 'nm', type: 'button', title: on ? 'y aller' : 'voir ce cadre', onclick: () => {
          if (on) { const j = ids.indexOf(id); if (j >= 0) go(j); } else A.fly(A.viewFor(f, { pad: 60, zmax: 2 }), { ms: 520 });
        } }, f?.name || 'Cadre', el('small', {}, `${frameCount(f)} objet${frameCount(f) > 1 ? 's' : ''}`)),
        el('span', { class: 'row' },
          el('button', { class: 'tb ghost sm', type: 'button', title: 'plus tôt', 'aria-label': 'monter', disabled: k === 0 ? true : null, onclick: () => move(id, k - 1) }, '↑'),
          el('button', { class: 'tb ghost sm', type: 'button', title: 'plus tard', 'aria-label': 'descendre', disabled: k === list.length - 1 ? true : null, onclick: () => move(id, k + 1) }, '↓'),
          el('button', { class: 'tb ghost sm vis', type: 'button', title: hide.has(id) ? 'la remettre dans la présentation' : 'ne pas la montrer',
            onclick: () => { if (hide.has(id)) hide.delete(id); else hide.add(id); save(); } }, hide.has(id) ? 'Montrer' : 'Masquer')));
      r.addEventListener('dragstart', (e) => { dragId = id; r.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); });
      r.addEventListener('dragend', () => { dragId = null; r.classList.remove('drag'); for (const x of box.children) x.classList.remove('over-t', 'over-b'); });
      r.addEventListener('dragover', (e) => {
        if (!dragId || dragId === id) return;
        e.preventDefault();
        const b = r.getBoundingClientRect(), top = e.clientY < b.top + b.height / 2;
        r.classList.toggle('over-t', top); r.classList.toggle('over-b', !top);
      });
      r.addEventListener('dragleave', () => r.classList.remove('over-t', 'over-b'));
      r.addEventListener('drop', (e) => {
        if (!dragId || dragId === id) return;
        e.preventDefault();
        const b = r.getBoundingClientRect(), top = e.clientY < b.top + b.height / 2;
        const from = order.indexOf(dragId);
        order.splice(from, 1);
        const at = order.indexOf(id) + (top ? 0 : 1);
        order.splice(at, 0, dragId);
        save();
      });
      return r;
    };
    function paint() {
      const n = order.filter((x) => !hide.has(x)).length;
      count.textContent = `${n} diapositive${n > 1 ? 's' : ''}${hide.size ? ` · ${hide.size} masquée${hide.size > 1 ? 's' : ''}` : ''}`;
      box.replaceChildren(...(order.length ? order.map((id, k) => row(id, k, order))
        : [el('p', {}, 'Aucun cadre sur cette planche : un cadre (F) autour de ce qu’on veut montrer devient une diapositive.')]));
    }
    paint();
    app.modal('Diapositives', el('div', { class: 'stack' },
      el('p', { class: 'hint' }, 'Chaque cadre est une diapositive, dans l’ordre de lecture de la planche (par rangées, de gauche à droite). Glissez-les, ou ↑ ↓, pour un autre ordre ; un cadre masqué reste sur la planche. L’ordre est gardé dans ce navigateur.'),
      count, box),
    (close) => [
      el('button', { class: 'tb ghost', type: 'button', title: 'revenir à l’ordre de lecture de la planche', onclick: () => { order = readingOrder(order.map(app.node).filter(Boolean)).map((f) => f.id); save(false); } }, 'Ordre de lecture'),
      el('span', { class: 'sp' }),
      on ? el('button', { class: 'tb ghost', type: 'button', onclick: close }, 'Fermer')
        : el('button', { class: 'tb go', type: 'button', disabled: order.some((x) => !hide.has(x)) ? null : true, onclick: () => { close(); start(); } }, 'Présenter')],
    { cls: 'lg' });
  }

  // ── le bouton, le menu, la palette ───────────────────────
  const oneFrame = () => {
    if (S.sel.size !== 1) return null;
    const n = app.node([...S.sel][0]);
    return n?.type === 'frame' ? n : null;
  };
  const btn = A.button({ order: 10, d: ICON, name: 'Présenter les cadres',
    title: 'présenter les cadres : chaque cadre est une diapositive · ← → Échap · clic droit : l’ordre des diapositives',
    // un cadre choisi : on commence par lui
    onclick: () => { const f = oneFrame(); start(f && shown().some((x) => x.id === f.id) ? f.id : null); },
    oncontext: (e, b) => {
      const r = b.getBoundingClientRect();
      const f = oneFrame();
      menu(r.left, r.bottom + 4, [{ head: 'Présentation' },
        { label: 'Depuis le début', onclick: () => start() },
        { label: 'Depuis le cadre choisi', disabled: !f, why: 'choisissez d’abord un cadre sur la planche', onclick: () => start(f.id) },
        '-', { label: 'Ordre des diapositives…', onclick: () => sorter() }]);
    } });
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
  A.presentation = { start, stop, go, sorter, slides, get index() { return idx; }, get ids() { return [...ids]; } };
}
