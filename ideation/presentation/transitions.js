// IDÉATION · PRÉSENTATION — les transitions entre deux scènes (docs/etudes/presentations.md § 10).
//
// Toutes en transform et opacity (le compositeur), par l'API Web Animations :
//   cut      rien ;
//   fade     la suivante se pose sur l'autre ;
//   push     la suivante pousse l'autre (à rebours en arrière) ;
//   wipe     un volet : la fenêtre glisse, l'image reste en place (deux transforms contraires) ;
//   curtain  un rideau à deux lés (l'accent, puis l'encre du modèle) traverse l'écran ;
//   zoom     on entre dans la suivante (l'autre grandit et s'efface) ;
//   morph    le Magic Move de Keynote : les objets de même identité (le même `mid`, la même image
//            de la bibliothèque, le même texte au même style) voyagent d'une place à l'autre (FLIP :
//            la place d'arrivée, rejouée depuis celle de départ) ; le reste se fond ;
//   toile    on vole sur la toile de l'Idéation : les diapositives à leur place sur la planche, la
//            caméra part de l'une, prend de la hauteur, se pose sur l'autre (le vol de l'atelier,
//            échantillonné en images clés : aucun calcul par image).

import { easeOf, easeFn } from './moteur.js';

const T0 = 'none';
const done = (a) => a.finished.catch(() => {});

// les paires du morph : une clé des deux côtés, une seule fois de chaque côté
export function pairsOf(a, b) {
  if (!a || !b) return [];
  const side = (sc) => {
    const m = new Map();
    for (const o of sc.objs) if (o.key) m.set(o.key, m.has(o.key) ? null : o);
    return m;
  };
  const A = side(a), B = side(b), out = [];
  for (const [k, o] of A) { const p = B.get(k); if (o && p) out.push([o, p]); }
  return out;
}

// la caméra d'une toile : la vue qui montre le cadre `r` dans (W, H)
const camOf = (r, W, H) => { const z = Math.min(W / r.w, H / r.h); return { z, cx: r.x + r.w / 2, cy: r.y + r.h / 2 }; };
const camCss = (c, W, H) => `translate3d(${(W / 2 - c.cx * c.z).toFixed(2)}px, ${(H / 2 - c.cy * c.z).toFixed(2)}px, 0) scale(${c.z.toFixed(5)})`;

// transit(kind, { fit, stage, from, to, back, dur, ease, pairs, others, fitCss })
// `fit` : le conteneur à l'échelle où vivent les scènes ; `from`, `to` : des scènes (scene.js).
// Rend une promesse ; `to` est en place à la fin, `from` retirée.
export async function transit(kind, o) {
  const { fit, from, to, back = false } = o;
  const dur = Math.max(0, o.dur ?? 800);
  const ease = easeOf(o.ease || 'in-out');
  const dir = back ? -1 : 1;
  if (!from || kind === 'cut' || dur === 0) { from?.el.remove(); return; }
  const f = from.el, t = to.el;
  const A = (el, kf, opt) => el.animate(kf, { duration: dur, easing: ease, fill: 'both', ...opt });
  switch (kind) {
    case 'fade': {
      const a = A(t, [{ opacity: 0 }, { opacity: 1 }]);
      A(f, [{ transform: T0 }, { transform: 'scale(.985)' }]);
      await done(a);
      break;
    }
    case 'push': {
      A(f, [{ transform: T0 }, { transform: `translate3d(${-100 * dir}%, 0, 0)` }]);
      await done(A(t, [{ transform: `translate3d(${100 * dir}%, 0, 0)` }, { transform: T0 }]));
      break;
    }
    case 'wipe': {
      const w = document.createElement('div');
      w.className = 'pm-wipe';
      t.replaceWith(w); w.append(t);
      A(f, [{ transform: T0 }, { transform: `translate3d(${-22 * dir}%, 0, 0) scale(.96)` }]);
      A(t, [{ transform: `translate3d(${-100 * dir}%, 0, 0)` }, { transform: T0 }]);
      await done(A(w, [{ transform: `translate3d(${100 * dir}%, 0, 0)` }, { transform: T0 }]));
      w.replaceWith(t);
      t.getAnimations().forEach((x) => x.cancel());
      break;
    }
    case 'curtain': {
      const panes = ['accent', 'ink'].map((tone, k) => {
        const p = document.createElement('div');
        p.className = 'pm-curtain';
        for (const s of t.style) if (s.startsWith('--t-')) p.style.setProperty(s, t.style.getPropertyValue(s));
        p.style.background = `var(--t-${tone})`;
        fit.append(p);
        return [p, k];
      });
      const x0 = back ? '101%' : '-101%', x1 = back ? '-101%' : '101%';
      const as = panes.map(([p, k]) => p.animate([{ transform: `translate3d(${x0}, 0, 0)` }, { transform: T0, offset: 0.46 }, { transform: T0, offset: 0.54 }, { transform: `translate3d(${x1}, 0, 0)` }],
        { duration: dur, delay: k * dur * 0.12, easing: easeOf('in-out'), fill: 'both' }));
      A(t, [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.501 }, { opacity: 1 }], { easing: 'linear', duration: dur * 1.12 });
      await Promise.all(as.map(done));
      panes.forEach(([p]) => p.remove());
      break;
    }
    case 'zoom': {
      A(f, [{ opacity: 1, transform: T0 }, { opacity: 0, transform: back ? 'scale(.8)' : 'scale(1.35)' }], { duration: dur * 0.75 });
      await done(A(t, [{ opacity: 0, transform: back ? 'scale(1.25)' : 'scale(.82)' }, { opacity: 1, transform: T0 }], { delay: dur * 0.2, duration: dur * 0.8 }));
      break;
    }
    case 'morph': {
      const P = o.pairs || pairsOf(from, to);
      const paired = new Set(P.flatMap(([a, b]) => [a, b]));
      // l'arrivée : son fond, son décor, ses objets sans paire se posent ; les paires voyagent
      const tbg = t.querySelectorAll(':scope > .pm-bg, :scope > .pm-decor');
      const fades = [];
      tbg.forEach((x) => fades.push(A(x, [{ opacity: 0 }, { opacity: 1 }], { duration: dur * 0.7 })));
      for (const ob of to.objs) if (!paired.has(ob) && !ob.mo) fades.push(A(ob.o, [{ opacity: 0 }, { opacity: 1 }], { delay: dur * 0.35, duration: dur * 0.65 }));
      for (const ob of from.objs) if (!paired.has(ob)) A(ob.o, [{ opacity: 1 }, { opacity: 0 }], { duration: dur * 0.45 });
      const travel = [];
      for (const [a, b] of P) {
        a.o.style.opacity = '0';
        const na = a.n, nb = b.n, fa = from.frame, fb = to.frame;
        const dx = (na.x - fa.x) - (nb.x - fb.x), dy = (na.y - fa.y) - (nb.y - fb.y);
        const ha = a.o.offsetHeight || na.h, hb = b.o.offsetHeight || nb.h;
        const sx = na.w / nb.w, sy = a.txt ? sx : ha / Math.max(1, hb);
        travel.push(A(b.o, [{ transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})` }, { transform: T0 }], { easing: easeOf(o.ease || 'in-out-expo') }));
      }
      await Promise.all([...travel, ...fades].map(done));
      for (const x of [...travel, ...fades]) x.cancel();   // leur dernier état est l'état de repos
      for (const [a] of P) a.o.style.opacity = '';
      break;
    }
    case 'toile': {
      const { stage, others = [], fitCss } = o;
      const W = stage.clientWidth, H = stage.clientHeight;
      const world = document.createElement('div');
      world.className = 'pm-world';
      const put = (sc) => { sc.el.style.left = `${sc.frame.x}px`; sc.el.style.top = `${sc.frame.y}px`; world.append(sc.el); };
      for (const sc of others) { sc.el.classList.add('pm-far'); put(sc); }
      put(from); put(to);
      fit.style.visibility = 'hidden';
      stage.append(world);
      const c0 = camOf(from.frame, W, H), c1 = camOf(to.frame, W, H);
      const span = Math.hypot(c1.cx - c0.cx, c1.cy - c0.cy) / Math.max(from.frame.w, 1);
      const dip = Math.min(1.6, Math.log1p(span) * 0.9 + 0.25);
      const N = 36, kf = [];
      for (let i = 0; i <= N; i++) {
        const p = i / N, e = easeFn['in-out'](p);
        const z = Math.exp(Math.log(c0.z) + (Math.log(c1.z) - Math.log(c0.z)) * e - dip * Math.sin(Math.PI * e));
        kf.push({ transform: camCss({ z, cx: c0.cx + (c1.cx - c0.cx) * e, cy: c0.cy + (c1.cy - c0.cy) * e }, W, H) });
      }
      await done(world.animate(kf, { duration: dur, easing: 'linear', fill: 'both' }));
      // retour dans la scène à l'échelle (la même image : la caméra finit là où la scène se pose)
      for (const sc of [from, to, ...others]) { sc.el.style.left = ''; sc.el.style.top = ''; sc.el.classList.remove('pm-far'); }
      fit.append(to.el);
      for (const sc of others) sc.el.remove();
      world.remove();
      fit.style.visibility = '';
      if (fitCss) fit.style.transform = fitCss;
      break;
    }
    default: break;
  }
  f.remove();
  for (const x of t.getAnimations()) if (x.effect?.target === t) x.cancel();
}
