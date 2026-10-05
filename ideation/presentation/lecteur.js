// IDÉATION · PRÉSENTATION — le lecteur plein écran (docs/etudes/presentations.md § 10).
//
// Ce que « Présenter » montre quand la présentation a un modèle ou du motion : chaque
// diapositive rendue en scène (scene.js), ses entrées jouées (moteur.js), les transitions
// entre elles (transitions.js). La planche n'est pas touchée : ni caméra, ni sélection, ni
// document — en sortir rend l'Idéation telle quelle. Une présentation sans motion garde la
// présentation de l'atelier (atelier/presentation.js : la planche elle-même).
//
// Clavier : → espace Page↓ Entrée (l'étape suivante, puis la diapositive suivante), ← Page↑
// (la précédente, construite), Début, Fin, F (plein écran), Échap. Une diapositive peut
// avancer seule (`motion.auto`, secondes après ses entrées). La souris déplace les couches
// qui ont une profondeur (la parallaxe) ; elle dort : la barre s'efface.

import { buildScene, releaseScene, decoded, slideNodes, partOf, roleOf, ensureCss } from './scene.js';
import { createRun, pointerParallax, frameMeter } from './moteur.js';
import { transit, pairsOf } from './transitions.js';
import { styler, fontsReady, motionFor, transFor } from './modeles.js';

const two = (k) => String(k).padStart(2, '0');

// ctx : { board, frames (dans l'ordre), items, meta, tpl, href, labelOf, name,
//         keys(fn) → désabonner, fullscreen: { toggle, on }, onexit, host (où poser le lecteur) }
export function createPlayer(ctx) {
  ensureCss();
  const reducedQ = matchMedia('(prefers-reduced-motion: reduce)');
  const style = styler(ctx.meta, ctx.board, ctx.tpl, !!ctx.preview);
  const motionOf = motionFor(ctx.tpl);
  const frames = ctx.frames;
  const root = document.createElement('div');
  root.className = 'pm-player';
  root.tabIndex = -1;
  const stage = document.createElement('div');
  stage.className = 'pm-stage';
  const fit = document.createElement('div');
  fit.className = 'pm-fit';
  stage.append(fit);
  root.append(stage);
  let idx = -1, step = 0, cur = null, busy = false, queued = null, idleT = 0, autoT = 0, alive = true, stopPx = () => {};
  const stats = { transitions: [], entries: [] };
  const last = { kind: null, from: null, to: null, pairs: 0 };

  // ── la barre (thème du portail) ──────────────────────────
  const bar = document.createElement('div');
  bar.className = 'pm-pbar';
  const btn = (label, title, fn, cls = 'tb ghost sm') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label; b.title = title; b.setAttribute('aria-label', title); b.onclick = fn; return b; };
  const no = document.createElement('span'); no.className = 'no';
  const tt = document.createElement('span'); tt.className = 'tt';
  const fsB = ctx.fullscreen ? btn('Plein écran', 'tout l’écran · F', () => { ctx.fullscreen.toggle(); setTimeout(paintBar, 200); }) : null;
  bar.append(btn('‹', 'précédente · ←', () => go(idx - 1), 'nav'), no, tt, btn('›', 'suivante · →', () => next(), 'nav'),
    Object.assign(document.createElement('i'), { className: 'sep' }), ...(fsB ? [fsB] : []), btn('Échap', 'sortir de la présentation', () => stop()));
  root.append(bar);
  const paintBar = () => {
    no.textContent = `${two(idx + 1)} / ${two(frames.length)}`;
    tt.textContent = frames[idx]?.name || '';
    if (fsB) fsB.textContent = ctx.fullscreen.on() ? 'Fenêtre' : 'Plein écran';
  };
  const wake = () => { root.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if (!bar.matches(':hover')) root.classList.add('idle'); }, 2400); };
  root.addEventListener('pointermove', wake);

  // ── l'échelle : la scène entière dans la fenêtre, bandes autour ─
  let fitCss = '';
  function place() {
    const f = frames[Math.max(0, idx)] || frames[0];
    const W = stage.clientWidth || innerWidth, H = stage.clientHeight || innerHeight;
    const k = Math.min(W / f.w, H / f.h);
    fitCss = `translate3d(${((W - f.w * k) / 2).toFixed(2)}px, ${((H - f.h * k) / 2).toFixed(2)}px, 0) scale(${k.toFixed(5)})`;
    fit.style.width = `${f.w}px`; fit.style.height = `${f.h}px`;
    fit.style.transform = fitCss;
  }
  const ro = new ResizeObserver(() => place());
  ro.observe(stage);

  // ── une scène ────────────────────────────────────────────
  const partsOf = (f) => slideNodes(ctx.board, f).map((n) => partOf(n, f));
  function sceneOf(i, live = true) {
    const f = frames[i];
    return buildScene({ board: ctx.board, frame: f, items: ctx.items, style, tpl: ctx.tpl, preview: !!ctx.preview, motionOf, index: i, count: frames.length,
      live, href: ctx.href, labelOf: ctx.labelOf, name: ctx.name, fonts: ctx.meta?.fonts || [] });
  }

  // aller à la diapositive i (dans l'ordre), par sa transition
  async function go(i, { first = false } = {}) {
    if (!alive) return;
    if (i < 0 || i >= frames.length || (i === idx && !first)) return;
    if (busy) { queued = i; return; }
    busy = true;
    clearTimeout(autoT);
    const back = !first && i < idx;
    const prev = cur;
    const f = frames[i];
    const reduced = reducedQ.matches;
    const sc = sceneOf(i);
    fit.append(sc.el);
    const role = roleOf(partsOf(f), i, frames.length);
    // en arrière, la transition de celle qu'on quitte, à rebours
    const tr = first ? { kind: 'fade', dur: 900, ease: 'out-quint' } : transFor(ctx.tpl, back ? frames[idx] : f, back ? roleOf(partsOf(frames[idx]), idx, frames.length) : role);
    let kind = reduced ? (tr.kind === 'cut' ? 'cut' : 'fade') : tr.kind;
    const dur = reduced ? Math.min(220, tr.dur) : tr.dur;
    const pairs = kind === 'morph' && prev ? pairsOf(prev.sc, sc) : [];
    if (kind === 'morph' && !pairs.length) kind = 'fade';
    // les objets qui voyagent n'entrent pas : ils arrivent
    for (const [, b] of pairs) b.mo = null;
    sc.el.style.visibility = 'hidden';
    await Promise.all([fontsReady(style, 1500), decoded(sc, 1500)]);
    const run = createRun(sc, { reduced });
    sc.el.style.visibility = '';
    if (prev?.run.hasExit() && kind !== 'morph' && !back) await prev.run.exit();
    const others = kind === 'toile' ? neighbours(prev?.i ?? i, i).map((k) => sceneOf(k, false)) : [];
    idx = i; step = 0;
    paintBar();
    place();
    last.kind = kind; last.from = prev ? frames[prev.i].id : null; last.to = f.id; last.pairs = pairs.length;
    const meter = frameMeter();
    // les entrées partent pendant la transition (vers sa fin) : elles se chevauchent
    const lead = { cut: 0, fade: 0.35, push: 0.55, wipe: 0.5, curtain: 0.52, zoom: 0.45, morph: 0.3, toile: 0.72 }[kind] ?? 0.4;
    const t0 = performance.now();
    const entries = new Promise((r) => setTimeout(() => { if (back) { run.finish(); r(); } else run.play(0).then(r); }, first ? 250 : dur * lead));
    await transit(prev ? kind : 'cut', { fit, stage, from: prev?.sc, to: sc, back, dur, ease: tr.ease, pairs, others, fitCss });
    if (prev) { prev.run.cancel(); releaseScene(prev.sc); prev.sc.el.remove(); }
    for (const o of others) releaseScene(o);
    stats.transitions.push({ kind, ms: Math.round(performance.now() - t0) });
    cur = { i, sc, run };
    stopPx(); stopPx = pointerParallax(stage, sc.all, { reduced });
    busy = false;
    await entries;
    stats.entries.push({ i, ...meter.stop() });
    if (queued !== null) { const q = queued; queued = null; go(q); return; }
    // en arrière : toutes les étapes sont là
    if (back) step = run.steps - 1;
    armAuto();
  }
  function armAuto() {
    clearTimeout(autoT);
    const a = frames[idx]?.motion?.auto;
    if (a && step >= (cur?.run.steps ?? 1) - 1 && idx < frames.length - 1) autoT = setTimeout(() => next(), a * 1000);
  }
  // les diapositives voisines sur la toile (celles que le vol survole)
  function neighbours(a, b) {
    const A = frames[a], B = frames[b];
    const x0 = Math.min(A.x, B.x) - A.w, y0 = Math.min(A.y, B.y) - A.h, x1 = Math.max(A.x + A.w, B.x + B.w) + A.w, y1 = Math.max(A.y + A.h, B.y + B.h) + A.h;
    return frames.map((f, k) => [f, k]).filter(([f, k]) => k !== a && k !== b && f.x < x1 && f.x + f.w > x0 && f.y < y1 && f.y + f.h > y0).slice(0, 10).map(([, k]) => k);
  }
  // → : l'étape suivante, sinon la diapositive suivante
  async function next() {
    if (!alive || busy) { if (busy) queued = Math.min(frames.length - 1, idx + 1); return; }
    if (cur && step < cur.run.steps - 1) { step += 1; clearTimeout(autoT); await cur.run.play(step); armAuto(); return; }
    go(idx + 1);
  }
  function key(e) {
    if (!alive) return false;
    const k = e.key;
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); next(); wake(); return true; }
    if (['ArrowLeft', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); go(idx - 1); wake(); return true; }
    if (k === 'Home') { e.preventDefault(); go(0); return true; }
    if (k === 'End') { e.preventDefault(); go(frames.length - 1); return true; }
    if (k === 'Escape') { e.preventDefault(); stop(); return true; }
    if (k.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && ctx.fullscreen) { ctx.fullscreen.toggle(); setTimeout(paintBar, 200); return true; }
    return true;
  }
  const unkey = ctx.keys ? ctx.keys(key) : (() => { const h2 = (e) => key(e); addEventListener('keydown', h2); return () => removeEventListener('keydown', h2); })();
  // cliquer sur la scène avance (comme Keynote)
  stage.addEventListener('click', () => next());

  function stop() {
    if (!alive) return;
    alive = false;
    clearTimeout(autoT); clearTimeout(idleT);
    stopPx();
    ro.disconnect();
    unkey?.();
    if (cur) { cur.run.cancel(); releaseScene(cur.sc); }
    root.remove();
    ctx.onexit?.();
  }
  (ctx.host || document.body).append(root);
  root.focus({ preventScroll: true });
  wake();
  place();
  return { root, go: (i) => go(i), next, stop, get index() { return idx; }, get step() { return step; }, get busy() { return busy; }, stats, last,
    start: (i = 0) => go(Math.max(0, Math.min(frames.length - 1, i)), { first: true }) };
}
