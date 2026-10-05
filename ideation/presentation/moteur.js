// IDÉATION · PRÉSENTATION — le moteur de motion (docs/etudes/presentations.md § 10).
//
// Déclaratif : chaque objet d'une diapositive porte (ou reçoit de son modèle) un
// `motion`, des DONNÉES bornées par schema.json — jamais du code :
//
//   motion: { in:   { fx, dur, delay, ease, by, stagger, dist },   l'entrée
//             out:  { fx, dur, ease },                              la sortie
//             loop: { fx, dur, amp },                               la boucle, après l'entrée
//             depth: -1…1,                                          la parallaxe
//             step:  0…9,                                           l'étape (0 : à l'arrivée ; 1… : au clic)
//             keys:  { x, y, scale, rot, op: [{t, v, e}] } }        les images clés par propriété (courbes.js)
//
// Le moteur en fait des animations de l'API Web Animations (Element.animate) sur des
// enveloppes emboîtées que scene.js pose autour de chaque objet :
//
//   .pm-o  la place (left, top : posée une fois ; le morph l'anime en transform)
//   .pm-p  la parallaxe (pointeur en style, dérive lente en composite « add »)
//   .pm-k  les images clés par propriété (06/10, courbes.js) : translate, rotate, scale, opacity
//   .pm-e  l'entrée et la sortie (opacity, transform, filter)
//   .pm-m  le contre-glissement d'un masque ; le zoom d'une image dans sa boîte
//   .pm-l  la boucle (dérive, flottement, pulsation…)
//   .pm-c  le contenu
//
// Rien d'autre que transform, opacity et filter n'est animé (le compositeur les tient
// à 60 i/s, aucune mise en page par image) ; deux exceptions dites : le dessin d'un
// trait (stroke-dashoffset, une peinture sans mise en page) et le masque d'une ligne
// (des mots dans des boîtes qui coupent, encore du transform). Les chiffres qui
// comptent tournent comme un compteur mécanique : des colonnes 0-9 glissées en
// transform, pas un texte réécrit à chaque image.
//
// prefers-reduced-motion : aucune entrée, aucune boucle, aucune parallaxe — l'état final
// d'emblée (le même que le PDF) ; les transitions se réduisent à un fondu court.

import { EASE_NAMES, easeCss, cleanEase, cleanKeys, keySpan, keyTimes, waapiTracks } from './courbes.js';

export const SCHEMA_URL = new URL('./schema.json', import.meta.url).href;

// ── les courbes nommées, et les libres ──────────────────────
// La vérité des courbes est dans courbes.js (06/10) : les cubic-bezier d'easings.net (easeOutQuint,
// easeOutExpo, easeInOutCubic, easeInOutExpo, easeOutBack, easeInCubic, easeOutCubic) et la « standard »
// de Material 3, le ressort (un oscillateur amorti échantillonné, rendu en fonction CSS linear() : MDN,
// Chrome 113, Firefox 112, Safari 17.2) — nommé (raideur 180, amortissement 16, masse 1) ou libre
// ({ spring: { k, c, m } }) —, une cubic-bezier libre ({ bz: [x1, y1, x2, y2] }).
export const EASE = Object.fromEntries(EASE_NAMES.map((n) => [n, easeCss(n)]));
// une courbe (un nom, { bz }, { spring }) → la fonction d'easing CSS ; illisible : expo
export const easeOf = (e) => (typeof e === 'string' ? EASE[e] || EASE['out-expo'] : cleanEase(e) ? easeCss(e) : EASE['out-expo']);
// la même courbe en JavaScript (les trajets échantillonnés : la caméra de la toile)
export const easeFn = {
  'in-out': (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  'out-expo': (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  'in-out-expo': (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2),
};

// ── les effets : ce que chacun anime ───────────────────────
// `p` : { dist } ; rend les images clés de l'enveloppe visée (null : rien à animer)
const T0 = 'none';
const IN = {
  none: null,
  fade: () => [{ opacity: 0 }, { opacity: 1 }],
  rise: (p) => [{ opacity: 0, transform: `translate3d(0, ${p.dist}px, 0)` }, { opacity: 1, transform: T0 }],
  drop: (p) => [{ opacity: 0, transform: `translate3d(0, ${-p.dist}px, 0)` }, { opacity: 1, transform: T0 }],
  left: (p) => [{ opacity: 0, transform: `translate3d(${p.dist}px, 0, 0)` }, { opacity: 1, transform: T0 }],
  right: (p) => [{ opacity: 0, transform: `translate3d(${-p.dist}px, 0, 0)` }, { opacity: 1, transform: T0 }],
  scale: () => [{ opacity: 0, transform: 'scale(.86)' }, { opacity: 1, transform: T0 }],
  zoom: () => [{ opacity: 0, transform: 'scale(1.16)' }, { opacity: 1, transform: T0 }],
  blur: () => [{ opacity: 0, filter: 'blur(26px)', transform: 'scale(1.04)' }, { opacity: 1, filter: 'blur(0px)', transform: T0 }],
  tilt: (p) => [{ opacity: 0, transform: `perspective(1400px) translate3d(0, ${p.dist * 0.6}px, 0) rotateX(42deg)` }, { opacity: 1, transform: T0 }],
};
const OUT = {
  none: null,
  fade: () => [{ opacity: 1 }, { opacity: 0 }],
  sink: (p) => [{ opacity: 1, transform: T0 }, { opacity: 0, transform: `translate3d(0, ${p.dist * 0.6}px, 0)` }],
  blur: () => [{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(20px)' }],
  scale: () => [{ opacity: 1, transform: T0 }, { opacity: 0, transform: 'scale(.92)' }],
};
// un masque : la fenêtre (e) glisse, le contenu (m) glisse à rebours : il paraît immobile
const MASK = { 'mask-up': ['Y', 1], 'mask-down': ['Y', -1], 'mask-left': ['X', 1], 'mask-right': ['X', -1] };
const LOOP = {
  none: null,
  drift: (a) => [{ transform: 'scale(1) translate3d(0, 0, 0)' }, { transform: `scale(${1 + a / 600}) translate3d(${-a / 8}px, ${-a / 12}px, 0)` }],
  float: (a) => [{ transform: `translate3d(0, ${-a / 2}px, 0)` }, { transform: `translate3d(0, ${a / 2}px, 0)` }],
  pulse: (a) => [{ transform: 'scale(1)' }, { transform: `scale(${1 + a / 1000})` }],
  spin: () => [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
  sway: (a) => [{ transform: `rotate(${-a / 20}deg)` }, { transform: `rotate(${a / 20}deg)` }],
};
export const FX = { in: [...Object.keys(IN), ...Object.keys(MASK), 'reveal', 'draw', 'count', 'type'], out: [...Object.keys(OUT), 'mask-up', 'mask-left'], loop: Object.keys(LOOP) };

const DEF = { dur: 800, delay: 0, ease: 'out-expo', by: 'all', dist: 60 };
const STAGGER = { all: 0, line: 130, word: 55, letter: 24 };
const clampN = (v, a, b, d) => (Number.isFinite(+v) ? Math.max(a, Math.min(b, +v)) : d);

// ── couper un texte en unités : lignes, mots, lettres ───────
// Les mots sont des boîtes en ligne (inline-block) séparées par de vraies espaces : le texte
// se coupe là où il se coupait. Les lignes se lisent après coup, à la hauteur de chaque mot.
function wordsOf(txt) {
  const src = txt.textContent;
  txt.textContent = '';
  const out = [];
  const paras = src.split('\n');
  paras.forEach((para, pi) => {
    const ws = para.split(/(\s+)/);
    for (const w of ws) {
      if (!w) continue;
      if (/^\s+$/.test(w)) { txt.append(document.createTextNode(w)); continue; }
      const s = document.createElement('span');
      s.className = 'pm-w';
      s.textContent = w;
      txt.append(s);
      out.push(s);
    }
    if (pi < paras.length - 1) txt.append(document.createElement('br'));
  });
  return out;
}
function lettersOf(words) {
  const out = [];
  for (const w of words) {
    const t = w.textContent;
    w.textContent = '';
    for (const ch of t) {
      const s = document.createElement('span');
      s.className = 'pm-ch';
      s.textContent = ch;
      w.append(s);
      out.push({ el: s, word: w });
    }
  }
  return out;
}
// une unité masquée : la boîte coupe, le dedans monte
function masked(u) {
  const inner = document.createElement('span');
  inner.className = 'pm-ui';
  while (u.firstChild) inner.append(u.firstChild);
  u.append(inner);
  u.classList.add('pm-um');
  return inner;
}
function lineIndex(words) {
  const tops = [];
  return words.map((w) => {
    const t = w.offsetTop;
    let i = tops.findIndex((x) => Math.abs(x - t) < 4);
    if (i < 0) { tops.push(t); i = tops.length - 1; }
    return i;
  });
}
// les unités d'un objet texte, une fois (scene.js garde le texte d'origine)
function unitsOf(obj, by, fx) {
  const key = `${by}|${fx}`;
  if (obj.split?.key === key) return obj.split.units;
  obj.txt.textContent = obj.text;
  let units = [];
  const words = wordsOf(obj.txt);
  if (by === 'letter' || fx === 'type') {
    const lines = lineIndex(words);
    const lw = new Map(words.map((w, i) => [w, lines[i]]));
    units = lettersOf(words).map((l, i) => ({ el: l.el, i, line: lw.get(l.word) }));
  } else {
    const lines = lineIndex(words);
    units = words.map((w, i) => ({ el: w, i, line: lines[i] }));
  }
  if (fx === 'reveal') for (const u of units) u.target = masked(u.el);
  // par ligne : les mots d'une ligne partent ensemble
  if (by === 'line') for (const u of units) u.order = u.line; else for (const u of units) u.order = u.i;
  obj.split = { key, units };
  return units;
}

// ── le compteur mécanique ───────────────────────────────────
// « 87 % », « 1 200 », « 3,5 M », « +42 » : chaque chiffre devient une colonne 0-9 (deux tours,
// pour que les derniers chiffres roulent plus longtemps) ; le reste reste en place.
export const isFigure = (s) => /^\s*[+\-−]?\s*\d[\d\s.,  ]*\s*[%a-zA-Zéû€$×x+]{0,4}\s*$/.test(String(s || '')) && String(s).trim().length <= 14;
function odometer(obj) {
  if (obj.odo) return obj.odo;
  const txt = obj.txt;
  const src = obj.text;
  txt.textContent = '';
  const cols = [];
  const box = document.createElement('span');
  box.className = 'pm-odo';
  for (const ch of src) {
    if (/\d/.test(ch)) {
      const win = document.createElement('span');
      win.className = 'pm-dg';
      const strip = document.createElement('span');
      strip.className = 'pm-ds';
      strip.textContent = '0123456789012345678901234567890123456789'.split('').join('\n');
      win.append(strip);
      box.append(win);
      cols.push({ strip, d: +ch });
    } else {
      const s = document.createElement('span');
      s.className = 'pm-dx';
      s.textContent = ch;
      box.append(s);
    }
  }
  txt.append(box);
  obj.odo = cols;
  return cols;
}

// ── compiler une diapositive ────────────────────────────────
// `objs` : les objets de la scène (scene.js : { id, label, kind, o, p, k, e, m, l, txt, text, paths, mo })
// rend { tracks, steps, total } ; chaque piste : l'objet, son étape, son début et sa fin dans l'étape
export function normMotion(mo) {
  if (!mo || typeof mo !== 'object') return null;
  const i = mo.in || {};
  const fx = FX.in.includes(i.fx) ? i.fx : 'none';
  const by = ['all', 'line', 'word', 'letter'].includes(i.by) ? i.by : 'all';
  return {
    in: { fx, dur: clampN(i.dur, 0, 6000, DEF.dur), delay: clampN(i.delay, 0, 20000, 0), ease: cleanEase(i.ease) ?? DEF.ease,
      by, stagger: clampN(i.stagger, 0, 1000, STAGGER[by]), dist: clampN(i.dist, 0, 600, DEF.dist) },
    out: mo.out && FX.out.includes(mo.out.fx) && mo.out.fx !== 'none'
      ? { fx: mo.out.fx, dur: clampN(mo.out.dur, 0, 6000, 420), ease: cleanEase(mo.out.ease) ?? 'in-out' } : null,
    loop: mo.loop && LOOP[mo.loop.fx] ? { fx: mo.loop.fx, dur: clampN(mo.loop.dur, 400, 60000, 9000), amp: clampN(mo.loop.amp, 0, 200, 24) } : null,
    depth: clampN(mo.depth, -1, 1, 0),
    step: Math.round(clampN(mo.step, 0, 9, 0)),
    // les images clés par propriété (courbes.js, 06/10) : posées sur .pm-k, par-dessus l'entrée
    keys: cleanKeys(mo.keys),
  };
}
function unitCount(obj, mo) {
  if (!obj.txt || mo.in.by === 'all' && mo.in.fx !== 'type') return 1;
  const s = obj.text || '';
  if (mo.in.by === 'letter' || mo.in.fx === 'type') return Math.max(1, [...s.replace(/\s+/g, '')].length);
  if (mo.in.by === 'word') return Math.max(1, s.split(/\s+/).filter(Boolean).length);
  return Math.max(1, obj.lines || Math.ceil(s.length / 28));
}
// Une piste par objet qui a une entrée ou des images clés : `bar` l'entrée (début, fin dans l'étape ;
// null sans entrée), `keys` les instants de ses clés ; `start`, `end` le tout. t0, t1 (et bar.t0, bar.t1,
// keys[].at) : dans la frise entière (les étapes mises bout à bout).
export function compile(objs) {
  const tracks = [];
  for (const obj of objs) {
    const mo = obj.mo;
    if (!mo) continue;
    const ks = keySpan(mo.keys);
    if (mo.in.fx === 'none' && !ks) continue;
    const n = mo.in.fx === 'none' ? 1 : unitCount(obj, mo);
    const span = mo.in.dur + (n > 1 ? mo.in.stagger * (n - 1) : 0);
    const bar = mo.in.fx === 'none' ? null : { start: mo.in.delay, end: mo.in.delay + span };
    const start = Math.min(bar ? bar.start : Infinity, ks ? ks[0] : Infinity);
    const end = Math.max(bar ? bar.end : 0, ks ? ks[1] : 0);
    tracks.push({ id: obj.id, label: obj.label, kind: obj.kind, step: mo.step, start, end, bar, fx: mo.in.fx, by: mo.in.by, units: n,
      keys: keyTimes(mo.keys) });
  }
  const steps = Math.max(0, ...tracks.map((t) => t.step)) + 1;
  const len = Array.from({ length: steps }, (_, s) => Math.max(0, ...tracks.filter((t) => t.step === s).map((t) => t.end)));
  const GAP = 400;
  const offset = [];
  let acc = 0;
  for (let s = 0; s < steps; s++) { offset.push(acc); acc += len[s] + (s < steps - 1 ? GAP : 0); }
  for (const t of tracks) {
    const o = offset[t.step];
    t.t0 = o + t.start; t.t1 = o + t.end;
    if (t.bar) { t.bar.t0 = o + t.bar.start; t.bar.t1 = o + t.bar.end; }
    for (const k of t.keys) k.at = o + k.t;
  }
  return { tracks, steps, len, offset, total: acc };
}

// ── jouer ───────────────────────────────────────────────────
// createRun(scene, { reduced, loops, parallax }) : toutes les animations sont créées d'un coup,
// en pause à leur premier état (l'objet est caché avant d'entrer) ; play(step) lance une étape ;
// seek(t) pose la frise entière à l'instant t (l'éditeur) ; playFrom(t) la joue depuis t.
export function createRun(scene, { reduced = false, loops = true, parallax = true } = {}) {
  const objs = scene.all || scene.objs;
  const plan = compile(objs);
  const anims = [];      // { a, step }
  const loopA = [];
  const add = (el, kf, o, step) => {
    if (!el || !kf) return null;
    const a = el.animate(kf, { fill: 'both', ...o });
    a.pause();
    a.currentTime = 0;
    anims.push({ a, step });
    return a;
  };
  if (!reduced) {
    for (const obj of objs) {
      const mo = obj.mo;
      if (!mo) continue;
      const i = mo.in, step = mo.step;
      const ease = easeOf(i.ease);
      const base = { duration: i.dur, delay: i.delay, easing: ease };
      if (i.fx !== 'none') {
        if (obj.bars) {
          // les bandes du cinéma : elles entrent par les bords
          obj.bars.forEach((b, k) => add(b, [{ transform: `translate3d(0, ${k ? 100 : -100}%, 0)` }, { transform: T0 }], base, step));
        } else if (i.fx === 'count' && obj.txt && isFigure(obj.text)) {
          const cols = odometer(obj);
          add(obj.e, IN.fade(), { duration: Math.min(300, i.dur), delay: i.delay, easing: 'linear' }, step);
          cols.forEach((c, k) => {
            const turns = cols.length - 1 - k;   // les derniers chiffres roulent plus
            const to = -(c.d + 10 * Math.min(3, turns)) * 1.1;
            add(c.strip, [{ transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(0, ${to}em, 0)` }],
              { duration: i.dur + turns * 120, delay: i.delay + k * i.stagger, easing: ease }, step);
          });
        } else if (i.fx === 'draw' && obj.paths?.length && (obj.kind === 'ink' || obj.kind === 'ring')) {
          add(obj.e, [{ opacity: 1 }, { opacity: 1 }], { duration: 1, delay: i.delay }, step);
          obj.paths.forEach((pa, k) => add(pa, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: i.dur, delay: i.delay + k * i.stagger, easing: ease }, step));
        } else if (i.fx === 'draw' && obj.bar) {
          add(obj.bar, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], base, step);
        } else if (obj.txt && (i.by !== 'all' || i.fx === 'type' || i.fx === 'reveal')) {
          const by = i.fx === 'type' ? 'letter' : i.by === 'all' ? 'line' : i.by;
          const units = unitsOf(obj, by, i.fx);
          obj.lines = Math.max(1, ...units.map((u) => u.line + 1));
          add(obj.e, [{ opacity: 1 }, { opacity: 1 }], { duration: 1, delay: 0 }, step);
          for (const u of units) {
            const d = i.delay + u.order * i.stagger;
            if (i.fx === 'reveal') add(u.target, [{ transform: 'translate3d(0, 108%, 0)' }, { transform: T0 }], { duration: i.dur, delay: d, easing: ease }, step);
            else if (i.fx === 'type') add(u.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 40, delay: d, easing: 'linear' }, step);
            else if (MASK[i.fx]) {
              const inner = u.target || (u.target = masked(u.el));
              const [ax, sg] = MASK[i.fx];
              add(inner, [{ transform: `translate${ax}(${108 * sg}%)` }, { transform: T0 }], { duration: i.dur, delay: d, easing: ease }, step);
            } else {
              const kf = (IN[i.fx] || IN.fade)({ dist: Math.min(i.dist, 80) });
              add(u.el, kf, { duration: i.dur, delay: d, easing: ease }, step);
            }
          }
        } else if (MASK[i.fx] || i.fx === 'reveal' || i.fx === 'draw') {
          const [ax, sg] = MASK[i.fx] || (i.fx === 'draw' ? MASK['mask-right'] : MASK['mask-up']);
          obj.e.classList.add('pm-clip');
          add(obj.e, [{ transform: `translate${ax}(${-100 * sg}%)` }, { transform: T0 }], base, step);
          add(obj.m, [{ transform: `translate${ax}(${100 * sg}%)` }, { transform: T0 }], base, step);
        } else if (i.fx === 'zoom' && obj.media) {
          // une image : le cadre paraît, l'image se pose dedans (le zoom reste dans sa boîte)
          add(obj.e, IN.fade(), { duration: Math.min(500, i.dur), delay: i.delay, easing: 'linear' }, step);
          add(obj.m, [{ transform: 'scale(1.22)' }, { transform: T0 }], { duration: i.dur * 1.4, delay: i.delay, easing: ease }, step);
        } else {
          add(obj.e, (IN[i.fx] || IN.fade)({ dist: i.dist }), base, step);
        }
      }
      // les boucles propres à un décor : le bandeau défile, le grain tremble, le balayage descend
      const special = obj.band ? [obj.band, [{ transform: T0 }, { transform: 'translate3d(-50%, 0, 0)' }], 'linear', 'normal']
        : obj.kind === 'grain' ? [obj.c.firstChild, [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ transform: `translate3d(${((k * 37) % 11) - 5}%, ${((k * 53) % 9) - 4}%, 0)` })), 'steps(8, end)', 'normal']
          : obj.kind === 'scan' ? [obj.c.lastChild, [{ transform: 'translate3d(0, -30%, 0)' }, { transform: 'translate3d(0, 130%, 0)' }], 'linear', 'normal'] : null;
      if (loops && mo.loop && special) {
        const a = special[0].animate(special[1], { duration: mo.loop.dur, iterations: Infinity, easing: special[2], direction: special[3] });
        a.pause(); a.currentTime = 0;
        loopA.push({ a, step: 0 });
      } else if (loops && mo.loop) {
        const L = LOOP[mo.loop.fx];
        const endIn = i.fx === 'none' ? 0 : i.delay + i.dur;
        const a = obj.l.animate(L(mo.loop.amp), { duration: mo.loop.dur, delay: endIn, iterations: Infinity, direction: mo.loop.fx === 'spin' ? 'normal' : 'alternate', easing: mo.loop.fx === 'spin' ? 'linear' : EASE['in-out'] });
        a.pause(); a.currentTime = 0;
        loopA.push({ a, step });
      }
      // les images clés (06/10) : une animation par propriété sur .pm-k (translate, rotate, scale,
      // opacité), dans l'étape de l'objet ; l'état final est déjà posé en style par la scène
      if (mo.keys && obj.k) for (const tr of waapiTracks(mo.keys)) add(obj.k, tr.keyframes, tr.timing, step);
      if (parallax && mo.depth) {
        const a = obj.p.animate([{ transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(${-mo.depth * 70}px, ${-mo.depth * 18}px, 0)` }],
          { duration: 14000, fill: 'both', easing: 'linear', composite: 'add' });
        a.pause(); a.currentTime = 0;
        loopA.push({ a, step: 0 });
      }
    }
  }
  const played = new Set();
  const now = () => document.timeline.currentTime;
  const all = () => [...anims, ...loopA];
  // Les vidéos d'une diapositive suivent la frise (06/10, le déterminisme : l'image d'un instant ne
  // dépend que de la planche et de cet instant) : seek(t) les pose à t (en boucle sur leur durée),
  // en pause ; playFrom(t) les lance de là. Le lecteur plein écran (play) les laisse tourner seules.
  const vids = objs.filter((o) => o.video).map((o) => o.video);
  const vidAt = (v, t) => { const d = v.duration; const s = Math.max(0, t) / 1000; return Number.isFinite(d) && d > 0 ? s % d : s; };
  const R = {
    plan, reduced,
    get steps() { return plan.steps; },
    // une étape : ses animations partent maintenant
    play(step = 0) {
      played.add(step);
      const mine = all().filter((x) => x.step === step);
      for (const { a } of mine) { a.currentTime = 0; a.play(); }
      const ends = anims.filter((x) => x.step === step).map((x) => x.a.finished.catch(() => {}));
      return Promise.all(ends);
    },
    // tout d'un coup à l'état final (une étape sautée, l'impression, reduced-motion)
    finish(step = null) {
      for (const { a, step: s } of anims) if (step === null || s === step) { a.pause(); a.currentTime = a.effect.getComputedTiming().endTime; }
    },
    // la frise de l'éditeur : l'instant t (ms) dans la suite des étapes
    seek(t) {
      for (const { a, step } of all()) {
        a.pause();
        const lt = t - plan.offset[step];
        a.currentTime = Math.max(0, Number.isFinite(lt) ? lt : 0);
      }
      for (const v of vids) { try { v.pause(); v.currentTime = vidAt(v, t); } catch { /* pas encore de métadonnées */ } }
    },
    playFrom(t = 0) {
      const tl = now();
      for (const { a, step } of all()) {
        a.pause();
        a.startTime = tl - (t - plan.offset[step]);
        a.play();
        a.startTime = tl - (t - plan.offset[step]);
      }
      for (const v of vids) { try { v.currentTime = vidAt(v, t); v.play().catch(() => {}); } catch { /* */ } }
    },
    pause() { for (const { a } of all()) a.pause(); for (const v of vids) v.pause(); },
    // les vidéos posées à leur image (le rendu image par image les attend : programme.js)
    videos: vids,
    // l'instant de la frise : lu sur une animation de l'étape la plus avancée
    time() {
      let t = 0;
      for (const { a, step } of anims) if (a.currentTime !== null) t = Math.max(t, Math.min(a.currentTime, a.effect.getComputedTiming().endTime) + plan.offset[step]);
      return t;
    },
    running() { return anims.some(({ a }) => a.playState === 'running'); },
    // La sortie : les objets qui en ont une. exitAnims() les crée en pause, à leur premier état (le
    // repos) : { anims, dur, end() } — le rendu image par image (programme.js) les pose à l'instant,
    // end() les retire ; exit() les joue et rend quand elles ont fini (le lecteur plein écran).
    exitAnims() {
      const out = [], clip = [];
      if (reduced) return { anims: out, dur: 0, end() {} };
      for (const obj of objs) {
        const o = obj.mo?.out;
        if (!o) continue;
        const ease = easeOf(o.ease);
        const opt = { duration: o.dur, easing: ease, fill: 'both' };
        if (MASK[o.fx]) {
          const [ax, sg] = MASK[o.fx];
          if (!obj.e.classList.contains('pm-clip')) { obj.e.classList.add('pm-clip'); clip.push(obj.e); }
          out.push(obj.e.animate([{ transform: T0 }, { transform: `translate${ax}(${-100 * sg}%)` }], opt));
          out.push(obj.m.animate([{ transform: T0 }, { transform: `translate${ax}(${100 * sg}%)` }], opt));
        } else {
          out.push(obj.e.animate(OUT[o.fx]({ dist: obj.mo.in.dist }), opt));
        }
      }
      for (const a of out) { a.pause(); a.currentTime = 0; }
      const dur = Math.max(0, ...out.map((a) => a.effect.getComputedTiming().endTime));
      return { anims: out, dur, end() { for (const a of out) a.cancel(); for (const e of clip) e.classList.remove('pm-clip'); } };
    },
    exit() {
      const X = R.exitAnims();
      for (const a of X.anims) a.play();
      return Promise.all(X.anims.map((a) => a.finished.catch(() => {})));
    },
    hasExit: () => !reduced && objs.some((o) => o.mo?.out),
    cancel() { for (const { a } of all()) a.cancel(); },
  };
  return R;
}

// ── la parallaxe au pointeur : chaque couche suit selon sa profondeur ─
export function pointerParallax(root, objs, { reduced = false } = {}) {
  if (reduced) return () => {};
  const layers = objs.filter((o) => o.mo?.depth).map((o) => ({ p: o.p, d: o.mo.depth }));
  if (!layers.length) return () => {};
  let raf = 0, tx = 0, ty = 0, cx = 0, cy = 0;
  const tick = () => {
    cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
    for (const L of layers) L.p.style.transform = `translate3d(${(cx * L.d * 36).toFixed(2)}px, ${(cy * L.d * 22).toFixed(2)}px, 0)`;
    raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.001 ? requestAnimationFrame(tick) : 0;
  };
  const mv = (e) => {
    const r = root.getBoundingClientRect();
    tx = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2;
    ty = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2;
    if (!raf) raf = requestAnimationFrame(tick);
  };
  root.addEventListener('pointermove', mv);
  return () => { root.removeEventListener('pointermove', mv); cancelAnimationFrame(raf); };
}

// ── mesurer : les images longues pendant qu'on joue (la preuve des 60 i/s) ─
export function frameMeter() {
  const d = [];
  let raf = 0, last = 0, on = true;
  const tick = (t) => { if (last) d.push(t - last); last = t; if (on) raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
  return {
    stop() {
      on = false; cancelAnimationFrame(raf);
      const s = [...d].sort((a, b) => a - b);
      const q = (k) => (s.length ? s[Math.min(s.length - 1, Math.floor(k * s.length))] : 0);
      return { frames: d.length, fps: d.length ? 1000 / (d.reduce((a, b) => a + b, 0) / d.length) : 0, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] || 0, long50: d.filter((x) => x > 50).length };
    },
  };
}
