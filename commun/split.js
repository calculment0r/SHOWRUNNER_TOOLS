// SHOWRUNNER TOOLS — des panneaux qu'on redimensionne à la souris.
//
//   split(container, panes, { axis: 'x' | 'y', key, gutter: 10, onresize })
//
// `container` est une boîte flex (rangée pour 'x', colonne pour 'y') ; `panes`
// ses panneaux, frères et dans l'ordre : [{ el, min, size }] (taille fixe en
// px) ou [{ el, min, grow }] (part de la place qui reste). Une poignée se
// pose entre deux panneaux voisins :
//   - glisser : la place passe de l'un à l'autre, sans descendre sous `min` ;
//   - double-clic : toute la rangée reprend ses tailles par défaut ;
//   - flèches (la poignée a le focus) : 16 px, maj : 64 px.
// Les tailles sont gardées par visiteur (localStorage, clé 'sr-split-<key>'),
// dans un try/catch : sans stockage, la page marche avec ses défauts.
// Un panneau souple garde sa part quand la fenêtre change de taille.

import { el } from './shell.js';

if (!document.querySelector('style[data-sr-split]')) {
  document.head.append(el('style', { 'data-sr-split': '' }, `
.sr-gutter { flex: none; position: relative; touch-action: none; z-index: 5; }
.sr-gutter.x { cursor: col-resize; }
.sr-gutter.y { cursor: row-resize; }
.sr-gutter::after { content: ""; position: absolute; border-radius: 1px; background: transparent; transition: background .12s; }
.sr-gutter.x::after { top: 12%; bottom: 12%; left: 50%; width: 2px; margin-left: -1px; }
.sr-gutter.y::after { left: 12%; right: 12%; top: 50%; height: 2px; margin-top: -1px; }
.sr-gutter:hover::after, .sr-gutter:focus-visible::after { background: var(--line-cy); }
.sr-gutter.on::after { background: var(--or); }
.sr-gutter:focus-visible { outline: none; }
body.sr-resizing, body.sr-resizing * { user-select: none !important; }
body.sr-resizing.x * { cursor: col-resize !important; }
body.sr-resizing.y * { cursor: row-resize !important; }
`));
}

const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* sans stockage */ } },
};

export function split(container, panes, { axis = 'x', key = '', gutter = 10, onresize = () => {} } = {}) {
  const X = axis === 'x';
  const store = key ? 'sr-split-' + key : '';
  const dims = (n) => { const r = n.getBoundingClientRect(); return X ? r.width : r.height; };
  // la marge intérieure d'un panneau souple : flex-basis 0 ne descend pas sous
  // elle, la part se donne au-delà — on la retire pour que la part tombe juste
  const pad = (n) => {
    const cs = getComputedStyle(n);
    const k = X ? ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'] : ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'];
    return k.reduce((s, p) => s + (parseFloat(cs[p]) || 0), 0);
  };
  const part = (i, px) => ({ g: Math.max(1, px - pad(panes[i].el)) });
  const defaults = panes.map((p) => (p.size !== undefined ? { px: p.size } : { g: p.grow ?? 1 }));
  let state = null;

  const apply = (st) => {
    panes.forEach((p, i) => {
      const s = st[i];
      p.el.style.flex = s.px !== undefined ? `0 0 ${Math.round(s.px)}px` : `${s.g} 1 0px`;
      p.el.style[X ? 'minWidth' : 'minHeight'] = (p.min || 0) + 'px';
    });
    state = st;
    onresize();
  };
  const valid = (st) => Array.isArray(st) && st.length === panes.length
    && st.every((s, i) => (panes[i].size !== undefined ? s && s.px > 0 : s && s.g > 0));

  const gutters = [];
  for (let i = 0; i < panes.length - 1; i++) {
    const g = el('div', {
      class: `sr-gutter ${axis}`, role: 'separator', tabindex: '0',
      'aria-orientation': X ? 'vertical' : 'horizontal',
      title: 'glisser pour redimensionner · double-clic : tailles par défaut',
      style: { [X ? 'width' : 'height']: gutter + 'px' },
    });
    panes[i].el.after(g);
    gutters.push(g);
    const pair = (d) => {
      const sizes = panes.map((p) => dims(p.el));
      const a = sizes[i], b = sizes[i + 1], tot = a + b;
      const lo = panes[i].min || 0, hi = tot - (panes[i + 1].min || 0);
      const na = Math.max(lo, Math.min(hi, a + d));
      sizes[i] = na; sizes[i + 1] = tot - na;
      // un panneau fixe prend sa taille en px, un souple sa taille comme part
      apply(panes.map((p, k) => (p.size !== undefined ? { px: sizes[k] } : part(k, sizes[k]))));
    };
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = panes.map((p) => dims(p.el));
      const p0 = X ? e.clientX : e.clientY;
      try { g.setPointerCapture(e.pointerId); } catch { /* */ }
      g.classList.add('on');
      document.body.classList.add('sr-resizing', axis);
      const mv = (ev) => {
        // chaque mouvement repart des tailles du début du geste
        const d = (X ? ev.clientX : ev.clientY) - p0;
        const a = start[i], b = start[i + 1], tot = a + b;
        const lo = panes[i].min || 0, hi = tot - (panes[i + 1].min || 0);
        const na = Math.max(lo, Math.min(hi, a + d));
        const sizes = [...start];
        sizes[i] = na; sizes[i + 1] = tot - na;
        apply(panes.map((p, k) => (p.size !== undefined ? { px: sizes[k] } : part(k, sizes[k]))));
      };
      const up = () => {
        g.removeEventListener('pointermove', mv);
        g.removeEventListener('pointerup', up);
        g.removeEventListener('pointercancel', up);
        g.classList.remove('on');
        document.body.classList.remove('sr-resizing', axis);
        if (store) LS.set(store, state);
      };
      g.addEventListener('pointermove', mv);
      g.addEventListener('pointerup', up);
      g.addEventListener('pointercancel', up);
    });
    g.addEventListener('dblclick', (e) => { e.preventDefault(); reset(); });
    g.addEventListener('keydown', (e) => {
      const k = e.key;
      const step = e.shiftKey ? 64 : 16;
      const d = (X ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step })[k];
      if (d === undefined) return;
      e.preventDefault();
      pair(d);
      if (store) LS.set(store, state);
    });
  }

  function reset() {
    if (store) LS.set(store, null);
    apply(defaults.map((s) => ({ ...s })));
  }

  const saved = store ? LS.get(store) : null;
  apply(valid(saved) ? saved : defaults.map((s) => ({ ...s })));
  return { reset, gutters, sizes: () => state };
}
