// IDÉATION · PRÉSENTATION — les courbes et les images clés (06/10).
//
// Les idées reprises de la note de spécification d'un éditeur de motion design partagée par Cal le
// 06/10 (docs/etudes/presentations_motion.md § 10) : des images clés PAR PROPRIÉTÉ, `[{t, v, e}]`,
// des courbes linéaire, entrée, sortie, entrée-sortie, cubic-bezier libre et ressort
// {raideur, amortissement, masse} ; des préréglages qui FABRIQUENT des images clés ordinaires ; un
// décalage en cascade sur une sélection. Un module PUR (aucun DOM) : la page l'importe, le contrôle
// du serveur aussi (node, server/tools/presentation.py) — les mêmes chiffres des deux côtés.
//
//   motion.keys = { x:     [{t, v, e?, p?}, …],   px, l'écart horizontal à sa place sur la diapositive
//                   y:     […],                   px, l'écart vertical
//                   scale: […],                   1 = 100 %
//                   rot:   […],                   degrés
//                   op:    […] }                  0 à 1, l'opacité
//
// t : ms depuis le début de l'étape de l'objet (comme `in.delay`) ; v : la valeur ; e : la courbe du
// segment qui PART de cette clé vers la suivante (absente : linéaire) — la sémantique de l'easing
// d'une image clé de l'API Web Animations (MDN, Keyframe formats : « the easing function used from
// this keyframe until the next ») ; p : 'in' | 'out', la clé vient d'un préréglage d'entrée ou de
// sortie (le réappliquer remplace ces clés-là, et seulement elles). Avant la première clé, la valeur
// de la première ; après la dernière, celle de la dernière (Montage, model.js : la même règle).
//
// Une courbe e : un nom du schéma (schema.json, `ease`), ou { bz: [x1, y1, x2, y2] } (une
// cubic-bezier CSS : x dans [0, 1]), ou { spring: { k, c, m } } (un oscillateur amorti : raideur,
// amortissement, masse — sa forme, ajustée à la durée du segment, comme le ressort nommé du moteur).
// Le ressort est rendu en fonction CSS linear() (MDN : Chrome 113, Firefox 112, Safari 17.2) : la
// valeur que JavaScript calcule (valueAt) est celle que le navigateur peint, par construction — les
// mêmes points, interpolés de la même façon.

// ── les courbes ─────────────────────────────────────────────
// Les cubic-bezier nommées : easings.net (Andrey Sitnik) — easeOutQuint, easeOutExpo, easeInOutCubic
// (« in-out »), easeInOutExpo, easeOutBack, easeInCubic (« in »), easeOutCubic (« out ») — et la
// « standard » de Material 3 (m3.material.io, Easing and duration : cubic-bezier(0.2, 0, 0, 1)).
export const BZ = {
  standard: [0.2, 0, 0, 1],
  'out-quint': [0.22, 1, 0.36, 1],
  'out-expo': [0.16, 1, 0.3, 1],
  'in-out': [0.65, 0, 0.35, 1],
  'in-out-expo': [0.87, 0, 0.13, 1],
  back: [0.34, 1.56, 0.64, 1],
  in: [0.32, 0, 0.67, 0],
  out: [0.33, 1, 0.68, 1],
};
// les noms, dans l'ordre du schéma (schema.json, `ease` : le contrôle compare)
export const EASE_NAMES = ['linear', 'standard', 'out-quint', 'out-expo', 'in-out', 'in-out-expo', 'back', 'spring', 'in', 'out'];
export const SPRING0 = { k: 180, c: 16, m: 1 };   // le ressort nommé du moteur (30/09)
export const LIM = { bzx: [0, 1], bzy: [-2, 3], k: [10, 1000], c: [1, 100], m: [0.1, 10] };
const SPRING_N = 56;                               // les points du ressort (linear()) : ceux du moteur depuis le 30/09
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// une courbe propre : un nom connu, { bz } ou { spring } bornés ; null si rien de lisible
export function cleanEase(e) {
  if (typeof e === 'string') return EASE_NAMES.includes(e) ? e : null;
  if (!e || typeof e !== 'object') return null;
  if (Array.isArray(e.bz) && e.bz.length === 4 && e.bz.every(fin)) {
    const [a, b, c, d] = e.bz;
    return { bz: [r4(clamp(a, ...LIM.bzx)), r4(clamp(b, ...LIM.bzy)), r4(clamp(c, ...LIM.bzx)), r4(clamp(d, ...LIM.bzy))] };
  }
  const s = e.spring;
  if (s && typeof s === 'object') {
    const g = (k) => (fin(s[k]) ? r4(clamp(s[k], ...LIM[k])) : SPRING0[k]);
    return { spring: { k: g('k'), c: g('c'), m: g('m') } };
  }
  return null;
}

// cubic-bezier : la courbe de WebKit (UnitBezier, celle des navigateurs) — Newton, puis dichotomie
export function bezierFn(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-7) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    while (lo < hi) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-7) return t;
      if (x > v) lo = t; else hi = t;
      if (hi - lo < 1e-9) break;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (u) => (u <= 0 ? 0 : u >= 1 ? 1 : sy(solve(u)));
}

// le ressort : x(τ) = 1 − e^(−ζω₀τ)(cos ω_d τ + (ζω₀/ω_d) sin ω_d τ), échantillonné jusqu'à ce que
// l'écart reste sous 0,1 % (le moteur, 30/09) ; au-delà de l'amortissement critique (ζ ≥ 1), la forme
// sans oscillation (ζ borné juste sous 1 : la même formule, sans dépassement visible)
export function springPoints({ k = SPRING0.k, c = SPRING0.c, m = SPRING0.m } = {}, n = SPRING_N) {
  const w0 = Math.sqrt(k / m), z = c / (2 * Math.sqrt(k * m));
  const wd = w0 * Math.sqrt(Math.max(1e-6, 1 - z * z));
  const x = (t) => 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
  let T = 0.1;
  while (T < 6 && Math.exp(-z * w0 * T) > 0.001) T += 0.05;
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(+x((T * i) / n).toFixed(4));
  pts[0] = 0;
  pts[n] = 1;
  return pts;
}
// linear(p0, p1, …) : des points également espacés, interpolés en ligne droite (CSS Easing 2)
const linearFn = (pts) => (u) => {
  if (u <= 0) return pts[0];
  if (u >= 1) return pts[pts.length - 1];
  const f = u * (pts.length - 1), i = Math.floor(f);
  return pts[i] + (pts[i + 1] - pts[i]) * (f - i);
};
const memo = new Map();
const keyOf = (e) => (typeof e === 'string' ? e : JSON.stringify(e));
// la courbe en JavaScript : u (0 à 1) → la part du chemin parcourue (peut dépasser 1 : rebond, ressort)
export function easeFn(e) {
  const c = cleanEase(e) ?? 'linear';
  const key = keyOf(c);
  if (memo.has(key)) return memo.get(key).fn;
  let fn, css;
  if (c === 'linear') { fn = (u) => clamp(u, 0, 1); css = 'linear'; }
  else if (c === 'spring' || c.spring) { const pts = springPoints(c === 'spring' ? SPRING0 : c.spring); fn = linearFn(pts); css = `linear(${pts.join(', ')})`; }
  else { const b = c.bz || BZ[c]; fn = bezierFn(...b); css = `cubic-bezier(${b.join(', ')})`; }
  memo.set(key, { fn, css });
  return fn;
}
// la même courbe pour le navigateur (une fonction d'easing CSS)
export function easeCss(e) {
  const c = cleanEase(e) ?? 'linear';
  easeFn(c);
  return memo.get(keyOf(c)).css;
}
// une courbe en « bezier » à poignées : les nommées le sont ; le ressort et le linéaire non
export const bzOf = (e) => { const c = cleanEase(e); return c && typeof c === 'object' ? c.bz || null : c === 'linear' ? [0, 0, 1, 1] : BZ[c] || null; };

// ── les images clés ─────────────────────────────────────────
// Les propriétés qu'une clé anime, chacune sur l'enveloppe .pm-k de l'objet (scene.js) par une
// propriété CSS de transformation individuelle (translate, rotate, scale : CSS Transforms 2) ou
// l'opacité ; x et y sont deux animations de `translate`, la seconde en composite « add » (Web
// Animations : les deux s'additionnent, chacune avec ses temps et ses courbes).
export const KEY_PROPS = [
  { id: 'x', label: 'position x', unit: 'px', lim: [-4000, 4000], base: 0, show: 1, step: 10,
    tip: 'décale l’objet vers la droite (positif) ou la gauche (négatif) de sa place sur la diapositive, en pixels de la scène' },
  { id: 'y', label: 'position y', unit: 'px', lim: [-4000, 4000], base: 0, show: 1, step: 10,
    tip: 'décale l’objet vers le bas (positif) ou le haut (négatif) de sa place, en pixels de la scène' },
  { id: 'scale', label: 'échelle', unit: '%', lim: [0, 20], base: 1, show: 100, step: 5,
    tip: 'la taille de l’objet autour de son centre : 100 % = sa taille sur la diapositive' },
  { id: 'rot', label: 'rotation', unit: '°', lim: [-3600, 3600], base: 0, show: 1, step: 5,
    tip: 'fait tourner l’objet autour de son centre, en degrés (positif : sens des aiguilles d’une montre)' },
  { id: 'op', label: 'opacité', unit: '%', lim: [0, 1], base: 1, show: 100, step: 5,
    tip: '0 % : invisible, 100 % : plein' },
];
export const KEY_PROP = Object.fromEntries(KEY_PROPS.map((p) => [p.id, p]));
export const KEY_T = [0, 60000];      // ms : une clé tient dans une minute après le début de son étape
export const KEY_MAX = 120;           // clés par propriété
export const SAME = 0.5;              // ms : deux clés plus proches sont la même
const r1 = (v) => Math.round(v * 10) / 10;

// des clés propres : chaque propriété triée, une clé par instant (la dernière l'emporte), bornée ;
// null si aucune propriété n'a de clé lisible. Même règle que `clean_keys` du serveur.
export function cleanKeys(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const P of KEY_PROPS) {
    const list = raw[P.id];
    if (!Array.isArray(list)) continue;
    const by = new Map();
    for (const k of list.slice(0, KEY_MAX * 4)) {
      if (!k || typeof k !== 'object' || !fin(k.t) || !fin(k.v)) continue;
      const t = r1(clamp(k.t, ...KEY_T));
      const o = { t, v: r4(clamp(k.v, ...P.lim)) };
      const e = cleanEase(k.e);
      if (e && e !== 'linear') o.e = e;
      if (k.p === 'in' || k.p === 'out') o.p = k.p;
      by.set(t, o);
    }
    const l = [...by.values()].sort((a, b) => a.t - b.t).slice(0, KEY_MAX);
    if (l.length) out[P.id] = l;
  }
  return Object.keys(out).length ? out : null;
}
// la valeur d'une propriété à l'instant t (ms dans l'étape de l'objet)
export function valueAt(list, t) {
  if (!list?.length) return null;
  if (t <= list[0].t) return list[0].v;
  const n = list.length - 1;
  if (t >= list[n].t) return list[n].v;
  let i = 0;
  while (list[i + 1].t <= t) i++;
  const a = list[i], b = list[i + 1];
  const u = (t - a.t) / Math.max(1e-9, b.t - a.t);
  return a.v + (b.v - a.v) * easeFn(a.e)(u);
}
// toutes les propriétés à l'instant t (celles sans clé : leur valeur de repos)
export function keysAt(keys, t) {
  const o = {};
  for (const P of KEY_PROPS) { const v = valueAt(keys?.[P.id], t); o[P.id] = v === null ? P.base : v; }
  return o;
}
// la fin des clés (ms dans l'étape), leur début ; null sans clé
export function keySpan(keys) {
  const ts = KEY_PROPS.flatMap((P) => (keys?.[P.id] || []).map((k) => k.t));
  return ts.length ? [Math.min(...ts), Math.max(...ts)] : null;
}
// les instants où l'objet a au moins une clé, et les propriétés de chacun
export function keyTimes(keys) {
  const m = new Map();
  for (const P of KEY_PROPS) for (const k of keys?.[P.id] || []) {
    const t = [...m.keys()].find((x) => Math.abs(x - k.t) < SAME) ?? k.t;
    if (!m.has(t)) m.set(t, []);
    m.get(t).push(P.id);
  }
  return [...m].sort((a, b) => a[0] - b[0]).map(([t, props]) => ({ t, props }));
}
// le style CSS d'un état (la scène pose l'état final en style ; les animations le recouvrent)
export function styleOf(v) {
  return { translate: `${v.x}px ${v.y}px`, rotate: `${v.rot}deg`, scale: String(v.scale), opacity: String(v.op) };
}
// les animations Web Animations d'un jeu de clés : [{ prop, keyframes, timing }] (le moteur les pose
// sur .pm-k ; `composite` : la seconde animation de translate s'ajoute à la première)
export function waapiTracks(keys) {
  const out = [];
  if (!keys) return out;
  for (const P of KEY_PROPS) {
    const list = keys[P.id];
    if (!list?.length) continue;
    const t0 = list[0].t, span = list.length > 1 ? list[list.length - 1].t - t0 : 0;
    const dur = Math.max(1, span);
    const val = (v) => (P.id === 'x' ? { translate: `${v}px 0px` } : P.id === 'y' ? { translate: `0px ${v}px` }
      : P.id === 'scale' ? { scale: String(v) } : P.id === 'rot' ? { rotate: `${v}deg` } : { opacity: v });
    const kf = list.length > 1
      ? list.map((k) => ({ ...val(k.v), offset: (k.t - t0) / dur, easing: easeCss(k.e) }))
      : [{ ...val(list[0].v), offset: 0 }, { ...val(list[0].v), offset: 1 }];
    out.push({ prop: P.id, keyframes: kf, timing: { delay: t0, duration: dur, fill: 'both', easing: 'linear',
      composite: P.id === 'y' && keys.x?.length ? 'add' : 'replace' } });
  }
  return out;
}

// ── poser, retirer, déplacer (des fonctions pures : rendent des clés neuves, propres) ─
const copy = (keys) => JSON.parse(JSON.stringify(keys || {}));
const at = (list, t) => (list || []).findIndex((k) => Math.abs(k.t - t) < SAME);
// la clé d'une propriété à l'instant t : posée (valeur v) ou mise à jour (sa courbe gardée)
export function setKey(keys, prop, t, v) {
  const K = copy(keys);
  const l = K[prop] || (K[prop] = []);
  const i = at(l, t);
  if (i >= 0) l[i] = { ...l[i], v }; else l.push({ t, v });
  return cleanKeys(K);
}
// retirer la clé d'une propriété à l'instant t
export function removeKey(keys, prop, t) {
  const K = copy(keys);
  if (K[prop]) K[prop] = K[prop].filter((k) => Math.abs(k.t - t) >= SAME);
  return cleanKeys(K);
}
// la bascule du panneau : une clé à t → la retirer ; sinon en poser une à la valeur qui s'y voit
export function toggleKey(keys, prop, t) {
  if (at(keys?.[prop], t) >= 0) return removeKey(keys, prop, t);
  const v = valueAt(keys?.[prop], t);
  return setKey(keys, prop, t, v === null ? KEY_PROP[prop].base : v);
}
// déplacer dans le temps les clés à l'instant t0 (d'une propriété, ou de toutes : prop null) de dt ;
// une clé qui tombe sur une autre de la même propriété la remplace (un glisser = un geste)
export function moveKeys(keys, prop, t0, dt) {
  const K = copy(keys);
  for (const P of KEY_PROPS) {
    if (prop && P.id !== prop) continue;
    const l = K[P.id];
    if (!l) continue;
    const moving = l.filter((k) => Math.abs(k.t - t0) < SAME);
    if (!moving.length) continue;
    const t1 = clamp(t0 + dt, ...KEY_T);
    K[P.id] = [...l.filter((k) => Math.abs(k.t - t0) >= SAME && Math.abs(k.t - t1) >= SAME), ...moving.map((k) => ({ ...k, t: t1 }))];
  }
  return cleanKeys(K);
}
// la courbe des clés à l'instant t (d'une propriété, ou de toutes)
export function setEaseAt(keys, prop, t, e) {
  const K = copy(keys);
  const c = cleanEase(e);
  for (const P of KEY_PROPS) {
    if (prop && P.id !== prop) continue;
    for (const k of K[P.id] || []) if (Math.abs(k.t - t) < SAME) { if (c && c !== 'linear') k.e = c; else delete k.e; }
  }
  return cleanKeys(K);
}
// toutes les clés décalées de dt (bornées à 0) : la cascade
export function shiftKeys(keys, dt) {
  if (!keys || !dt) return keys ? cleanKeys(keys) : null;
  const K = copy(keys);
  for (const P of KEY_PROPS) if (K[P.id]) K[P.id] = K[P.id].map((k) => ({ ...k, t: clamp(k.t + dt, ...KEY_T) }));
  return cleanKeys(K);
}

// ── les préréglages : ils FABRIQUENT des images clés ordinaires ─
// La note du 06/10 : « Animation presets (slide/fade/scale in & out with direction, distance, delay,
// duration, easing) GENERATE regular editable keyframes. Re-applying a preset replaces them and is
// undoable. » Une entrée glissée part de `dist` px du côté choisi et revient à sa place en apparaissant ;
// une sortie s'en va de sa place vers ce côté en disparaissant ; l'échelle part de (ou va à)
// 100 − dist %. Les clés portent p ('in' | 'out') : réappliquer ne remplace que celles-là.
export const PRESET_KINDS = [['slide', 'Glisse'], ['fade', 'Fondu'], ['scale', 'Échelle']];
export const PRESET_DIRS = [['left', 'depuis la gauche'], ['right', 'depuis la droite'], ['up', 'depuis le haut'], ['down', 'depuis le bas']];
export const PRESET0 = { kind: 'slide', dir: 'left', dist: 80, delay: 0, dur: 700, ease: 'out' };
export function presetKeys(keys, side, o) {
  const p = { ...PRESET0, ...o };
  const K = copy(keys);
  for (const P of KEY_PROPS) if (K[P.id]) K[P.id] = K[P.id].filter((k) => k.p !== side);
  const t0 = clamp(+p.delay || 0, ...KEY_T), t1 = clamp(t0 + Math.max(1, +p.dur || 0), ...KEY_T);
  const e = cleanEase(p.ease) ?? 'out';
  // les autres clés restent ; au même instant, celle du préréglage l'emporte (cleanKeys : la dernière)
  const put = (prop, a, b) => {
    K[prop] = [...(K[prop] || []), { t: t0, v: a, ...(e !== 'linear' ? { e } : {}), p: side }, { t: t1, v: b, p: side }];
  };
  const dist = clamp(+p.dist || 0, 0, 4000);
  const inn = side === 'in';
  const from = (v0, v1) => (inn ? [v0, v1] : [v1, v0]);   // l'entrée va de l'écart au repos ; la sortie, du repos à l'écart
  put('op', ...from(0, 1));
  if (p.kind === 'slide') {
    const sg = p.dir === 'left' || p.dir === 'up' ? -1 : 1;
    put(p.dir === 'left' || p.dir === 'right' ? 'x' : 'y', ...from(sg * dist, 0));
  } else if (p.kind === 'scale') {
    put('scale', ...from(r4(clamp(1 - dist / 100, 0, 20)), 1));
  }
  return cleanKeys(K);
}

// ── le décalage en cascade (stagger) ────────────────────────
// La note du 06/10 : « Stagger: applied to a multi-selection; params: order (forward / reverse /
// seeded random), interval. Offsets layer start times. » Le début d'un objet : le plus tôt de son
// entrée (in.delay) et de sa première clé ; la cascade pose le k-ième (dans l'ordre choisi) à
// début₀ + k × intervalle, en déplaçant son entrée et ses clés d'autant (rien ne change de forme).
export const ORDERS = [['forward', 'avant'], ['reverse', 'arrière'], ['random', 'hasard semé']];
// un hasard reproductible : mulberry32 (domaine public, Tommy Ettinger) — la même graine, le même ordre
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function orderOf(list, order, seed = 1) {
  const l = [...list];
  if (order === 'reverse') return l.reverse();
  if (order === 'random') {
    const rnd = mulberry32(seed);
    for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
  }
  return l;
}
// le début d'un motion (ms dans son étape) : son entrée, sa première clé ; null s'il n'a ni l'une ni l'autre
export function startOf(mo) {
  const s = [];
  if (mo?.in && mo.in.fx && mo.in.fx !== 'none') s.push(+mo.in.delay || 0);
  const k = keySpan(mo?.keys);
  if (k) s.push(k[0]);
  return s.length ? Math.min(...s) : null;
}
// `items` : [{ id, mo }] dans l'ordre de lecture ; rend Map(id → décalage en ms) — les objets sans
// entrée ni clé n'y sont pas (rien à décaler)
export function cascade(items, { order = 'forward', interval = 120, seed = 1 } = {}) {
  const live = items.filter((x) => startOf(x.mo) !== null);
  const out = new Map();
  if (!live.length) return out;
  const t0 = Math.min(...live.map((x) => startOf(x.mo)));
  orderOf(live, order, seed).forEach((x, k) => out.set(x.id, t0 + k * Math.max(0, +interval || 0) - startOf(x.mo)));
  return out;
}
