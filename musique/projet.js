// MUSIQUE — le projet : sa forme (version 2), la migration d'un projet
// d'avant, l'historique (annuler / rétablir) et les opérations
// d'arrangement qui touchent plusieurs choses à la fois (une section avec
// ses clips et ses courbes, le presse-papiers).
//
// Version 2, ce qui s'ajoute à la version 1 (docs/etudes/musique.md) :
//   key       { tonic 0..11, mode }             la tonalité de la session
//   sections  [{ id, name, a, b, color, tag }]  la règle des sections (en noires)
//   markers   [{ id, b, name }]                 les marqueurs
//   arc       { on, to: lpf|vol|both, pts }     l'arc d'énergie peint (0..1)
//   auto      [{ id, mod, k, on, pts }]         les voies d'automation (0..1)
//   tracks[]  + sub, arm ; sorte « bus » (retour d'effets)
//   cables[]  + send (dB) : un envoi de la console vers un bus
//   clips[]   + gain, fi, fo, loop, llen, mute, name
//   gen       le brouillon du panneau génératif (style, plan, paroles)

import { guessTag } from './modules.js';

export const VERSION = 2;

export function migrate(p) {
  for (const k of ['pending', 'patterns', 'clips', 'cables', 'modules', 'tracks']) p[k] = p[k] || [];
  p.sections = p.sections || [];
  p.markers = p.markers || [];
  p.auto = p.auto || [];
  p.arc = p.arc || { on: true, to: 'lpf', pts: [] };
  p.key = p.key || { tonic: 9, mode: 'minor' };
  p.loop = p.loop || { on: false, a: 0, b: 16 };
  p.ui = p.ui || {};
  for (const s of p.sections) if (!s.tag) s.tag = guessTag(s.name);
  p.v = VERSION;
  return p;
}

// ── l'historique ────────────────────────────────────────────
// Un instantané du projet (sans ce qui n'est pas de l'œuvre : version,
// vue, travaux en cours, brouillon du panneau génératif) après chaque geste
// terminé. Annuler rend l'instantané d'avant, tout entier : juste par
// construction, quel que soit le geste.
const SKIP = new Set(['rev', 'ui', 'pending', 'updated', 'created', 'gen', 'id']);
export function snapshot(p) {
  const o = {};
  for (const k of Object.keys(p)) if (!SKIP.has(k)) o[k] = p[k];
  return JSON.stringify(o);
}

export class History {
  constructor(get, apply) { this.get = get; this.apply = apply; this.undo = []; this.redo = []; this.cur = null; this.t = null; }
  reset() { clearTimeout(this.t); this.undo = []; this.redo = []; this.cur = this.get() ? snapshot(this.get()) : null; }
  mark() { clearTimeout(this.t); this.t = setTimeout(() => this.check(), 350); }
  check() {
    clearTimeout(this.t);
    const p = this.get();
    if (!p) return;
    const now = snapshot(p);
    if (now === this.cur) return;
    if (this.cur !== null) { this.undo.push(this.cur); if (this.undo.length > 150) this.undo.shift(); }
    this.cur = now; this.redo = [];
  }
  back() {
    this.check();
    if (!this.undo.length) return false;
    this.redo.push(this.cur); this.cur = this.undo.pop(); this.apply(JSON.parse(this.cur));
    return true;
  }
  fwd() {
    this.check();
    if (!this.redo.length) return false;
    this.undo.push(this.cur); this.cur = this.redo.pop(); this.apply(JSON.parse(this.cur));
    return true;
  }
}

// ── les sections ────────────────────────────────────────────
export const sorted = (p) => [...p.sections].sort((x, y) => x.a - y.a);
export const sectionAt = (p, b) => p.sections.find((s) => b >= s.a && b < s.b) || null;
const within = (x, a, b) => x >= a - 1e-9 && x < b - 1e-9;

// tout ce qui commence à partir de `at` recule de `d` (clips, sections,
// marqueurs, points de l'arc et de l'automation)
export function shiftFrom(p, at, d) {
  for (const c of p.clips) if (c.start >= at - 1e-9) c.start += d;
  for (const s of p.sections) if (s.a >= at - 1e-9) { s.a += d; s.b += d; }
  for (const m of p.markers) if (m.b >= at - 1e-9) m.b += d;
  for (const pts of curves(p)) for (const pt of pts) if (pt[0] >= at - 1e-9) pt[0] += d;
}
const curves = (p) => [p.arc?.pts || [], ...(p.auto || []).map((L) => L.pts || [])];
const sortPts = (p) => { for (const pts of curves(p)) pts.sort((x, y) => x[0] - y[0]); };

// déplace ce qui commence dans [a, b) de `d` : clips et points des courbes ;
// les points qui étaient déjà à l'arrivée cèdent la place
function carry(p, a, b, d) {
  const moved = new Set();
  for (const c of p.clips) if (within(c.start, a, b)) { c.start += d; moved.add(c); }
  for (const pts of curves(p)) {
    const go = pts.filter((pt) => within(pt[0], a, b));
    const keep = pts.filter((pt) => !within(pt[0], a, b) && !within(pt[0], a + d, b + d));
    pts.splice(0, pts.length, ...keep, ...go.map((pt) => { pt[0] += d; return pt; }));
  }
  sortPts(p);
  return moved;
}

// Dupliquer une section AVEC ses clips : la copie s'insère juste après
// l'original, et tout ce qui suivait recule d'autant.
export function duplicateSection(p, sec, uid) {
  const len = sec.b - sec.a;
  const copies = p.clips.filter((c) => within(c.start, sec.a, sec.b)).map((c) => ({ ...c, id: uid('c'), start: c.start + len }));
  const ptsCopies = curves(p).map((pts) => pts.filter((pt) => within(pt[0], sec.a, sec.b)).map(([b, v]) => [b + len, v]));
  shiftFrom(p, sec.b, len);
  p.clips.push(...copies);
  curves(p).forEach((pts, i) => pts.push(...ptsCopies[i]));
  sortPts(p);
  const n = { ...sec, id: uid('s'), a: sec.b, b: sec.b + len };
  p.sections.push(n);
  return n;
}

// Déplacer une section avec ce qu'elle contient ; refusé si la place est prise
export function moveSection(p, sec, na) {
  const len = sec.b - sec.a, d = na - sec.a;
  if (na < 0) return 'avant le début du morceau';
  const clash = p.sections.find((s) => s !== sec && s.a < na + len - 1e-9 && s.b > na + 1e-9);
  if (clash) return `la place est prise par « ${clash.name} »`;
  carry(p, sec.a, sec.b, d);
  sec.a += d; sec.b += d;
  return null;
}

// Échanger une section avec sa voisine (dir -1 : la précédente, +1 : la
// suivante), leur contenu compris ; l'écart entre elles est gardé.
export function swapSection(p, sec, dir) {
  const list = sorted(p), i = list.indexOf(sec), j = i + dir;
  if (j < 0 || j >= list.length) return 'pas de voisine de ce côté';
  const [A, B] = dir > 0 ? [sec, list[j]] : [list[j], sec];
  const lenA = A.b - A.a, lenB = B.b - B.a, gap = B.a - A.b;
  const dA = lenB + gap, dB = -(lenA + gap);
  const inA = p.clips.filter((c) => within(c.start, A.a, A.b)), inB = p.clips.filter((c) => within(c.start, B.a, B.b));
  for (const c of inA) c.start += dA;
  for (const c of inB) c.start += dB;
  for (const pts of curves(p)) for (const pt of pts) {
    if (within(pt[0], A.a, A.b)) pt[0] += dA; else if (within(pt[0], B.a, B.b)) pt[0] += dB;
  }
  sortPts(p);
  const a0 = A.a;
  B.a = a0; B.b = a0 + lenB;
  A.a = a0 + lenB + gap; A.b = A.a + lenA;
  return null;
}

export function removeSection(p, sec, withClips = false) {
  if (withClips) {
    p.clips = p.clips.filter((c) => !within(c.start, sec.a, sec.b));
    for (const pts of curves(p)) pts.splice(0, pts.length, ...pts.filter((pt) => !within(pt[0], sec.a, sec.b)));
  }
  p.sections = p.sections.filter((s) => s !== sec);
}

// ── le presse-papiers des clips ─────────────────────────────
export function copyClips(p, ids) {
  const cs = p.clips.filter((c) => ids.includes(c.id));
  if (!cs.length) return null;
  const base = Math.min(...cs.map((c) => c.start));
  return { base, len: Math.max(...cs.map((c) => c.start + c.len)) - base, items: cs.map((c) => JSON.parse(JSON.stringify(c))) };
}

// colle à `at` ; un clip retrouve sa piste, ou prend `fallback` si elle
// n'existe plus (et seulement si c'est la même sorte de piste)
export function pasteClips(p, board, at, uid, fallback = null) {
  const out = [];
  for (const c of board.items) {
    let tr = p.tracks.find((t) => t.id === c.track);
    if (!tr && fallback) { const f = p.tracks.find((t) => t.id === fallback); if (f && (f.kind === 'audio') === !!c.item) tr = f; }
    if (!tr) continue;
    if (c.pat && !p.patterns.some((x) => x.id === c.pat && x.track === tr.id)) continue;
    const n = { ...JSON.parse(JSON.stringify(c)), id: uid('c'), track: tr.id, start: Math.max(0, at + (c.start - board.base)) };
    p.clips.push(n);
    out.push(n);
  }
  return out;
}

// ── couper, rogner ──────────────────────────────────────────
// `off` d'un clip de motif est en noires (où en est le motif), celui d'un
// clip audio en secondes (où en est le son)
export function splitClip(p, c, pos, uid) {
  if (pos <= c.start + 1e-6 || pos >= c.start + c.len - 1e-6) return null;
  const tr = p.tracks.find((t) => t.id === c.track);
  const cut = pos - c.start;
  const n = { ...c, id: uid('c'), start: pos, len: c.len - cut };
  n.off = tr?.kind === 'audio' ? addAudioOff(c, cut * 60 / p.bpm) : (c.off || 0) + cut;
  if (tr?.kind === 'audio') { n.fi = 0; c.fo = 0; }
  c.len = cut;
  p.clips.push(n);
  return n;
}
function addAudioOff(c, secs) {
  if (!c.loop || !c.llen) return (c.off || 0) + secs;
  // dans une boucle, la coupe tombe quelque part dans la région qui se répète
  return (c.off || 0) + (secs % c.llen);
}

// rogner par le bord gauche : le clip commence plus tard, son contenu reste en place
export function trimStart(p, c, d) {
  d = Math.max(-c.start, Math.min(c.len - 0.0625, d));
  const tr = p.tracks.find((t) => t.id === c.track);
  if (tr?.kind === 'audio') {
    const secs = d * 60 / p.bpm;
    if (!c.loop && (c.off || 0) + secs < 0) d = -(c.off || 0) * p.bpm / 60;
    c.off = Math.max(0, (c.off || 0) + d * 60 / p.bpm);
  } else {
    // le motif se répète : on le lit modulo sa longueur
    const pat = p.patterns.find((x) => x.id === c.pat), plen = pat ? pat.steps / 4 : 4;
    c.off = ((((c.off || 0) + d) % plen) + plen) % plen;
  }
  c.start += d; c.len -= d;
  return d;
}
