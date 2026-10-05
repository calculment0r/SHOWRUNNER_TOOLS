// IDÉATION · PRÉSENTATION — le rendu image par image (06/10).
//
// La note de spécification d'un éditeur de motion design partagée par Cal le 06/10 tient en une règle :
// l'image d'un instant ne dépend que du projet et de cet instant (ni horloge, ni hasard non semé, ni
// animation laissée au navigateur, ni état accumulé d'image en image) ; tout instant se rejoint
// directement, et la MÊME fonction sert l'aperçu et l'export (docs/etudes/presentations_motion.md § 10).
//
// Ici, cette fonction est la scène (scene.js) et la frise du moteur (moteur.js, `run.seek(t)`) — les
// mêmes que le mode et le lecteur — et les transitions (transitions.js, `transition(…, { paused })`).
// `programme(ctx)` met les diapositives bout à bout comme le lecteur plein écran les joue :
//
//   diapositive i   [ transition depuis i − 1 ]  ses entrées partent pendant la transition (leadOf)
//                   [ ses entrées, ses étapes au clic mises bout à bout (moteur.js, compile) ]
//                   [ la pause : `motion.auto` s'il est posé, sinon `hold` ]
//                   [ sa sortie (`motion.out`), si la suivante n'arrive pas en morph ]
//
// et `seek(t)` pose la présentation à l'instant t : les scènes qui se voient, la frise de chacune, la
// sortie et la transition en cours posées à leur instant (leurs animations créées en pause, retirées
// quand on en sort), les vidéos à leur image. Le rendu MP4 (tools/presentation_export.mjs, sur
// lecture.html?video) l'appelle pour chaque image, puis capture la page.
//
// Ce qui diffère du lecteur plein écran, et pourquoi : la première diapositive entre dès 0 (le lecteur
// attend 250 ms après son fondu d'ouverture) ; les étapes au clic se suivent (pas de clic dans une
// vidéo) ; la parallaxe au pointeur n'existe pas (pas de pointeur).

import { buildScene, releaseScene, decoded, slideNodes, partOf, roleOf, fontsOf, ensureCss } from './scene.js';
import { createRun } from './moteur.js';
import { transition, pairsOf, leadOf, neighbours } from './transitions.js';
import { styler, fontsReady, motionFor, transFor } from './modeles.js';

export const HOLD = 2000;   // ms : la pause d'une diapositive sans avance seule, par défaut
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frame2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
// un événement d'un élément, ou rien après `ms`
const once = (el, ev, ms) => new Promise((r) => { const t = setTimeout(r, ms); el.addEventListener(ev, () => { clearTimeout(t); r(); }, { once: true }); });

// ctx : { board, frames (les diapositives montrées, dans l'ordre), only (l'id d'une diapositive : elle
//         seule), items, meta, tpl, href, name, host (où poser la scène), hold (ms) }
export function programme(ctx) {
  ensureCss();
  const style = styler(ctx.meta, ctx.board, ctx.tpl, false);
  const motionOf = motionFor(ctx.tpl);
  const all = ctx.frames;
  const pick = ctx.only ? all.map((f, i) => [f, i]).filter(([f]) => f.id === ctx.only) : all.map((f, i) => [f, i]);
  if (!pick.length) throw new Error('cette diapositive n’est pas dans la présentation');
  const W = pick[0][0].w, H = pick[0][0].h;
  const hold = Number.isFinite(ctx.hold) ? Math.max(0, ctx.hold) : HOLD;
  const stage = document.createElement('div');
  stage.className = 'pm-stage pm-rendu';
  Object.assign(stage.style, { width: `${W}px`, height: `${H}px` });
  const fit = document.createElement('div');
  fit.className = 'pm-fit';
  stage.append(fit);
  (ctx.host || document.body).append(stage);
  const S = [];            // une entrée par diapositive rendue
  const active = new Map(); // les animations en cours de pose : 'ex:i' (une sortie), 'tr:i' (une transition)
  let total = 0, fonts = [];

  const sceneOf = (f, i, live) => buildScene({ board: ctx.board, frame: f, items: ctx.items, style, tpl: ctx.tpl, motionOf, index: i, count: all.length,
    live, href: ctx.href, name: ctx.name, fonts: ctx.meta?.fonts || [] });
  // la scène entière dans le cadre de la vidéo (une diapositive d'une autre taille : au milieu, bandes autour)
  // (en 2D : un translate3d ferait un calque à part, voir freeze)
  const fitCss = (f) => {
    const k = Math.min(W / f.w, H / f.h);
    return `translate(${((W - f.w * k) / 2).toFixed(2)}px, ${((H - f.h * k) / 2).toFixed(2)}px) scale(${k.toFixed(5)})`;
  };

  // ── préparer : toutes les scènes, leurs polices, leurs images, leurs frises ─
  async function prepare() {
    for (const [f, i] of pick) S.push({ f, i, sc: sceneOf(f, i, true) });
    // dans la page (la coupe des lignes se mesure), cachées le temps de préparer
    for (const s of S) { s.sc.el.style.visibility = 'hidden'; fit.append(s.sc.el); }
    await fontsReady(style, 4000);
    await Promise.race([document.fonts.ready, wait(20000)]);
    await Promise.all(S.map((s) => decoded(s.sc, 8000)));
    await Promise.all(S.flatMap((s) => s.sc.objs.filter((o) => o.video && o.video.readyState < 1).map((o) => once(o.video, 'loadedmetadata', 6000))));
    // la transition qui mène à chacune (celle du lecteur : modeles.js, transFor) ; le morph sans paire : un fondu
    S.forEach((s, k) => {
      if (!k) { s.tr = { kind: 'cut', dur: 0, ease: 'in-out' }; s.pairs = []; return; }
      const prev = S[k - 1];
      const role = roleOf(slideNodes(ctx.board, s.f).map((n) => partOf(n, s.f)), s.i, all.length);
      const tr = transFor(ctx.tpl, s.f, role);
      s.pairs = tr.kind === 'morph' ? pairsOf(prev.sc, s.sc) : [];
      s.tr = { ...tr, kind: tr.kind === 'morph' && !s.pairs.length ? 'fade' : tr.kind };
      for (const [, b] of s.pairs) b.mo = null;   // les objets qui voyagent n'entrent pas : ils arrivent
    });
    for (const s of S) s.run = createRun(s.sc, { reduced: false });
    for (const s of S) s.fonts = fontsOf(s.sc.el);
    fonts = [...new Set(S.flatMap((s) => s.fonts))];
    for (const s of S) { s.sc.el.remove(); s.sc.el.style.visibility = ''; }
    // la frise de la présentation
    let t = 0;
    S.forEach((s, k) => {
      const next = S[k + 1];
      s.start = t;
      s.T = k ? s.tr.dur : 0;
      s.entries = s.start + (k ? leadOf(s.tr.kind) * s.T : 0);
      const body = Math.max(s.start + s.T, s.entries + s.run.plan.total);
      const auto = s.f.motion?.auto;
      s.exitStart = body + (Number.isFinite(auto) && auto > 0 ? auto * 1000 : hold);
      s.exitDur = next && next.tr.kind !== 'morph' && s.run.hasExit() ? Math.max(0, ...s.sc.all.map((o) => o.mo?.out?.dur || 0)) : 0;
      t = s.exitStart + (next ? s.exitDur : 0);
    });
    total = S[S.length - 1].exitStart;
    return { total, fonts };
  }

  // ── poser l'instant t ────────────────────────────────────
  function wanted(t) {
    let k = S.length - 1;
    while (k > 0 && t < S[k].start) k--;
    const s = S[k];
    if (k > 0 && s.T > 0 && t < s.start + s.T) return { k, vis: [k - 1, k], keys: [...(S[k - 1].exitDur ? [`ex:${k - 1}`] : []), `tr:${k}`] };
    if (s.exitDur && k < S.length - 1 && t >= s.exitStart) return { k, vis: [k], keys: [`ex:${k}`] };
    return { k, vis: [k], keys: [] };
  }
  function setup(key, k) {
    if (key.startsWith('ex:')) return S[k].run.exitAnims();
    const s = S[k], prev = S[k - 1];
    const others = s.tr.kind === 'toile' ? neighbours(all, prev.i, s.i).map((j) => sceneOf(all[j], j, false)) : [];
    const T = transition(s.tr.kind, { fit, stage, from: prev.sc, to: s.sc, dur: s.tr.dur, ease: s.tr.ease, pairs: s.pairs, others, fitCss: fitCss(s.f), paused: true });
    return { ...T, end() { T.end(); for (const o of others) releaseScene(o); } };
  }
  // Figer l'image : chaque animation écrit sa valeur en style (commitStyles, dans l'ordre de composition :
  // MDN, Animation.commitStyles) puis se retire le temps de la capture ; la suivante la remet. Sans cela,
  // Chromium choisit la trame des calques qui portent une animation (même en pause) d'une capture à
  // l'autre : le même instant posé deux fois de suite différait de 1 à 2 niveaux sur la couture d'un
  // pixel entre deux scènes (mesuré le 06/10). Ce qui reste (docs/etudes/presentations_motion.md § 10) :
  // rejoint par un autre chemin, le même instant — mêmes styles calculés, élément par élément — peut
  // encore différer d'un niveau sur quelques pixels pendant une transition (la trame du compositeur).
  let frozen = null;
  function freeze() {
    const live = document.getAnimations().filter((a) => a.effect?.target?.isConnected && stage.contains(a.effect.target));
    const styles = new Map();
    for (const a of live) { const e = a.effect.target; if (!styles.has(e)) styles.set(e, e.getAttribute('style')); }
    for (const a of live) { try { a.commitStyles(); } catch { /* un élément sans rendu : il garde son animation */ } }
    const effects = live.map((a) => [a, a.effect]);
    for (const [a] of effects) a.effect = null;
    // un translate3d(x, y, 0) figé devient un translate(x, y) : la même image, sans calque à part (un calque
    // 3D garde sa trame d'une image à l'autre et la couture de deux scènes en dépendait)
    for (const e of styles.keys()) {
      const tr = e.style.transform;
      if (tr && tr.includes('translate3d(')) e.style.transform = tr.replace(/translate3d\(([^,()]+),\s*([^,()]+),\s*0(?:px)?\)/g, 'translate($1, $2)');
    }
    frozen = { effects, styles };
  }
  function thaw() {
    if (!frozen) return;
    for (const [a, e] of frozen.effects) a.effect = e;
    for (const [e, st] of frozen.styles) { if (st === null) e.removeAttribute('style'); else e.setAttribute('style', st); }
    frozen = null;
  }
  async function seek(t) {
    thaw();
    t = Math.max(0, Math.min(total, +t || 0));
    const w = wanted(t);
    // les animations dont on sort : retirées (le DOM revient tel qu'avant), dans l'ordre inverse
    for (const key of [...active.keys()].reverse()) if (!w.keys.includes(key)) { active.get(key).end(); active.delete(key); }
    const s = S[w.k];
    fit.style.transform = fitCss(s.f);
    // les scènes qui se voient, dans l'ordre (celle qui part dessous) — sauf pendant une transition
    // déjà posée : elle tient le DOM (le volet, la toile)
    if (![...active.keys()].some((x) => x.startsWith('tr:'))) {
      const els = w.vis.map((j) => S[j].sc.el);
      if (fit.children.length !== els.length || els.some((e, j) => fit.children[j] !== e)) fit.replaceChildren(...els);
    }
    for (const key of w.keys) if (!active.has(key)) active.set(key, setup(key, +key.slice(3)));
    for (const j of w.vis) S[j].run.seek(t - S[j].entries);
    for (const [key, h] of active) {
      const j = +key.slice(3);
      const lt = key.startsWith('ex:') ? t - S[j].exitStart : t - S[j].start;
      for (const a of h.anims) { a.pause(); a.currentTime = Math.max(0, lt); }
    }
    // les vidéos à leur image : la page attend que chacune y soit (seeked)
    const vids = w.vis.flatMap((j) => S[j].run.videos).filter((v) => v.readyState >= 1 && !v.error);
    await Promise.all(vids.map((v) => (v.seeking ? once(v, 'seeked', 4000) : null)));
    freeze();
    await frame2();
    return { t, slide: S[w.k].f.id };
  }

  return { prepare, seek, stage, get total() { return total; }, get fonts() { return fonts; }, w: W, h: H,
    get slides() { return S.map((s) => ({ id: s.f.id, name: s.f.name || '', n: s.i + 1, start: s.start, entries: s.entries, exit: s.exitStart, motion: s.run.plan.total, trans: s.tr?.kind,
      fonts: s.fonts || [], items: [...new Set(s.sc.objs.filter((o) => o.n?.type === 'media' && o.n.item).map((o) => o.n.item))] })); } };
}
