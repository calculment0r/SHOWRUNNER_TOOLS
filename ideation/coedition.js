// IDÉATION — la co-édition en direct, greffée par collab.js sans toucher au
// canvas. L'étude : docs/etudes/ideation_collab.md § 5 (le modèle de Figma :
// le serveur arbitre, le dernier écrit gagne propriété par propriété).
//
// Juste par construction : les gestes ne sont pas instrumentés un par un. Chaque
// geste de la planche finit par `commit` (ou `quiet`, un travail qui avance) ;
// ce module compare alors la planche à sa copie `base` (ce que le serveur a, plus
// ce que j'ai déjà envoyé) et en tire des opérations par objet et par registre :
// la géométrie ensemble (x, y, w, h : un déplacement ne se mélange pas), la
// hauteur à part pour un objet qui la mesure (canvas.js, AUTO_H : une mesure
// n'est pas un geste, elle ne part qu'avec un vrai changement de l'objet), les
// deux bouts d'un lien ensemble, et chaque autre champ seul. Pendant un geste
// (déplacer, redimensionner), la géométrie part aussi au fil de l'eau, 20 fois
// par seconde au plus ; un champ qu'on remplit, 5 fois.
//
// Les opérations des autres (événement `op` du flux, dans l'ordre du serveur)
// s'appliquent à la planche et à `base`, sauf sur un registre où j'ai un
// changement non encore confirmé, ou en cours (Figma : « discard incoming changes
// from the server that conflict with unacknowledged property changes ») : ma
// valeur, écrite après, gagnera. Un objet retiré l'est toujours. Elles
// n'entrent pas dans l'annulation : Ctrl+Z ne défait que mes gestes, registre
// par registre (« An undo operation modifies redo history at the time of the
// undo »). Hors ligne, les opérations attendent ; au retour, un trou se relit
// (GET …/ops?since=), sinon la planche se relit et mes gestes se rejouent
// dessus (« downloads a fresh copy of the document, reapplies any offline
// edits on top of this latest state »). Un refus franc du serveur : on revient
// à l'enregistrement entier (et à son conflit, qui propose de recharger).

import { api, toast, $ } from '../commun/shell.js';
import { AUTO_H } from './canvas.js';

const MACHINE = new Set(['jobs', 'error']);   // ce que les travaux écrivent seuls : hors de l'annulation
const GEO = ['x', 'y', 'w', 'h'];
const GEO_A = ['x', 'y', 'w'];                // un objet qui mesure sa hauteur
const ENDS = ['a', 'b', 'pa', 'pb'];
const LIVE_MS = 50;       // la géométrie d'un geste en cours : 20 envois par seconde au plus
const TOUCH_MS = 200;     // un champ qu'on remplit : 5
const ECHO_MS = 2500;     // un lot accepté dont l'écho n'arrive pas : on relit ce qui manque
const POLL_MS = 4000;     // sans flux : on relit la planche de temps en temps
const FATAL = new Set([400, 404, 405, 413, 415]);

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// l'égalité profonde (l'ordre des clés ne compte pas ; une clé indéfinie vaut absente)
export function eq(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
    return true;
  }
  let n = 0;
  for (const k in a) { if (a[k] === undefined) continue; n++; if (!eq(a[k], b[k])) return false; }
  for (const k in b) if (b[k] !== undefined) n--;
  return n === 0;
}

// ── les registres d'un objet ─────────────────────────────────
// Des registres fins (ideation_collab.py, TEXT_KEYS et SLOT_KEY : la même règle) : les
// cases d'un composeur ont chacune le sien (`s:<case>` sans son texte, `t:<case>` son
// texte) et leur ordre un autre (`slots#`) ; un texte libre part avec `b`, la valeur
// d'où il est parti, et le serveur le fusionne avec ce que d'autres ont écrit entre-temps.
const geoOf = (o) => (AUTO_H.has(o.type) ? GEO_A : GEO);
const SLOT_KEY = /^([st]):([A-Za-z0-9_-]{1,40})$/;
const TEXT_KEYS = { n: new Set(['text', 'prompt', 'name', 'title', 'sound', 'music']), l: new Set(['label']) };
export const isText = (t, k) => TEXT_KEYS[t]?.has(k) || (t === 'n' && k.startsWith('t:'));
function regs(t, o, into = new Set()) {
  for (const k of Object.keys(o)) {
    if (k === 'id' || o[k] === undefined) continue;
    if (t === 'n' && GEO.includes(k)) into.add(k === 'h' && AUTO_H.has(o.type) ? 'h' : 'geo');
    else if (t === 'l' && ENDS.includes(k)) into.add('ends');
    else if (t === 'n' && k === 'slots' && o.type === 'compose' && Array.isArray(o.slots)) {
      // chaque case (elle d'abord, son texte ensuite), puis leur ordre : une case neuve existe avant d'être rangée
      for (const s of o.slots) { into.add('s:' + s.id); into.add('t:' + s.id); }
      into.add('slots#');
    } else into.add(k);
  }
  return into;
}
function get(t, o, k) {
  if (k === 'geo' || k === 'ends') {
    const v = {};
    for (const g of k === 'geo' ? geoOf(o) : ENDS) if (o[g] !== undefined) v[g] = o[g];
    return v;
  }
  if (t === 'n' && k === 'slots#') return Array.isArray(o.slots) ? o.slots.map((s) => s.id) : undefined;
  const m = t === 'n' && SLOT_KEY.exec(k);
  if (m) {
    const s = Array.isArray(o.slots) ? o.slots.find((x) => x.id === m[2]) : null;
    if (!s) return undefined;
    if (m[1] === 't') return s.text;
    const { text, ...rest } = s;   // eslint-disable-line no-unused-vars
    return rest;
  }
  return o[k];
}
function put(t, o, k, v) {
  if (k === 'geo') { for (const [g, x] of Object.entries(v || {})) if (GEO.includes(g)) o[g] = x; return; }
  if (k === 'ends') { for (const g of ENDS) { if (v && v[g] !== undefined) o[g] = v[g]; else delete o[g]; } return; }
  if (t === 'n' && k === 'slots#') { if (Array.isArray(o.slots) && Array.isArray(v)) reorder(o.slots, v); return; }
  const m = t === 'n' && SLOT_KEY.exec(k);
  if (m) {
    // la case elle-même reste le même objet : le composeur garde ses champs branchés dessus
    if (!Array.isArray(o.slots)) o.slots = [];
    const i = o.slots.findIndex((x) => x.id === m[2]);
    if (m[1] === 't') { if (i >= 0) o.slots[i].text = typeof v === 'string' ? v : ''; return; }
    if (v === undefined) { if (i >= 0) o.slots.splice(i, 1); return; }
    if (i < 0) { o.slots.push({ ...clone(v), id: m[2], text: '' }); return; }
    const s = o.slots[i];
    for (const x of Object.keys(s)) if (x !== 'id' && x !== 'text') delete s[x];
    Object.assign(s, clone(v), { id: m[2], text: s.text });
    return;
  }
  if (v === undefined) delete o[k]; else o[k] = clone(v);
}
// la fusion à trois d'un texte (ideation_collab.py, merge_text : la même) : deux passages
// disjoints restent tous deux ; le même passage, le dernier écrit gagne
function region(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  if (i > 0 && /[\uDC00-\uDFFF]/.test(a[i] || b[i] || '')) i--;   // jamais au milieu d'une paire (un emoji)
  let j = 0;
  while (j < n - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  if (j > 0 && /[\uDC00-\uDFFF]/.test(a[a.length - j] || '')) j--;
  return [i, a.length - j, b.slice(i, b.length - j)];
}
export function mergeText(base, theirs, mine) {
  if (typeof base !== 'string' || typeof theirs !== 'string' || base === theirs || mine === theirs) return mine;
  if (mine === base) return theirs;
  const [s1, e1, r1] = region(base, theirs), [s2, e2, r2] = region(base, mine);
  if (e1 <= s2) return base.slice(0, s1) + r1 + base.slice(e1, s2) + r2 + base.slice(e2);
  if (e2 <= s1) return base.slice(0, s2) + r2 + base.slice(e2, s1) + r1 + base.slice(e1);
  return mine;
}
// où tombe un curseur quand le texte `was` devient `now`
function mapPos(was, now, p) {
  const [s, e, r] = region(was, now);
  if (p <= s) return p;
  if (p >= e) return p + now.length - was.length;
  return s + r.length;
}
function keysOf(op) {
  if (op.t === 'b') return ['b||' + (op.k || 'name')];
  if (op.o === 'ord') return [`${op.t}|#`];
  if (op.o === 'add') return [`${op.t}|${op.v.id}|*`, `${op.t}|#`];
  if (op.o === 'del') return [`${op.t}|${op.id}|*`];
  return [`${op.t}|${op.id}|${op.k}`];
}
// l'ordre des objets de `list` selon `ids` ; ceux que `ids` ne connaît pas gardent leur place
function reorder(list, ids) {
  const pos = new Map(ids.map((id, i) => [id, i]));
  const known = list.filter((x) => pos.has(x.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id));
  let k = 0;
  const out = list.map((x) => (pos.has(x.id) ? known[k++] : x));
  list.splice(0, list.length, ...out);
}
// un simple ajout à la fin, sans rien déplacer : l'ordre n'a pas à partir en entier
function appended(now, was) {
  const inWas = new Set(was), inNow = new Set(now);
  const a = was.filter((id) => inNow.has(id));
  let i = 0, tail = false;
  for (const id of now) {
    if (!inWas.has(id)) { tail = true; continue; }
    if (tail || a[i++] !== id) return false;
  }
  return true;
}
// le design de la présentation d'une planche (absent : les styles par défaut)
const setPres = (B, v) => { if (v === undefined || v === null) delete B.pres; else B.pres = clone(v); };
const snapshot = (b) => ({
  name: b.name, pres: clone(b.pres), N: new Map(b.nodes.map((n) => [n.id, clone(n)])), L: new Map(b.links.map((l) => [l.id, clone(l)])),
  no: b.nodes.map((n) => n.id), lo: b.links.map((l) => l.id),
});

export function createCoedition(app, hooks = {}) {
  const { S } = app;
  const K = {
    sid: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
    bid: null, base: null, on: false, dead: '', gen: 0, n: 0,
    out: [], outKeys: [], fly: null, sent: new Map(), pend: new Map(),
    q: new Map(), pulling: false, syncing: false, stream: false, serverRev: 0, fails: 0, lastSend: 0, sendT: 0,
    cur: null, mode: null, rec: null, lastOps: [], pointer: false, liveT: 0, touchT: 0, rf: 0, settleT: 0, selfQuiet: false,
    role: '', can: { see: true, edit: true, comment: true }, viewer: false, warnT: 0,
    stats: { sent: 0, got: 0, applied: 0, skipped: 0, resync: 0, pulls: 0 },
  };
  const pending = (k) => (K.pend.get(k) || 0) > 0;
  const inc = (k) => K.pend.set(k, (K.pend.get(k) || 0) + 1);
  const dec = (k) => { const v = (K.pend.get(k) || 0) - 1; if (v > 0) K.pend.set(k, v); else K.pend.delete(k); };
  const coll = (t) => (t === 'n' ? S.board.nodes : S.board.links);
  const find = (t, id) => coll(t).find((x) => x.id === id) || null;
  const baseMap = (t) => (t === 'n' ? K.base.N : K.base.L);
  const ready = () => !!(S.board && K.base && K.bid === S.board.id);

  // ── la planche ouverte ─────────────────────────────────────
  function init(b) {
    K.gen++;
    clearTimeout(K.sendT); K.sendT = 0;
    Object.assign(K, { bid: b?.id || null, base: b ? snapshot(b) : null, out: [], outKeys: [], fly: null, cur: null, mode: null,
      dead: '', on: !!b, serverRev: S.rev || 0, fails: 0, syncing: false, pulling: false });
    K.sent.clear(); K.pend.clear(); K.q.clear();
    setRole('', null);   // le rôle sur cette planche arrive avec le flux (hello)
    hooks.status?.();
  }
  app.on('board:open', (b) => init(b));

  // ── les annulations : mes gestes, registre par registre ──────
  function paintUndo() {
    const u = $('#b-undo'), r = $('#b-redo');
    if (u) u.disabled = !S.undo.length;
    if (r) r.disabled = !S.redo.length;
  }
  const rec = (key, before) => { if (K.rec && !K.rec.m.has(key)) K.rec.m.set(key, before); };
  app.snap = () => {
    if (!S.board || K.viewer) return;
    const g = { m: new Map(), t: Date.now() };
    S.undo.push(g);
    if (S.undo.length > 150) S.undo.shift();
    S.redo = [];
    K.cur = g;
    paintUndo();
  };
  function prune() {
    if (!S.board) return false;
    const ids = new Set(S.board.nodes.map((n) => n.id));
    let ch = false;
    for (const id of [...S.sel]) if (!ids.has(id)) { S.sel.delete(id); ch = true; }
    if (S.link && !S.board.links.some((l) => l.id === S.link)) { S.link = null; ch = true; }
    if (S.focus && !ids.has(S.focus)) { S.focus = null; ch = true; }
    return ch;
  }
  function nameUi() {
    const i = $('#b-name');
    if (i && document.activeElement !== i) i.value = S.board.name;
    document.title = `${S.board.name} · Idéation`;
  }
  // appliquer un pas d'annulation : rend le pas inverse (les valeurs d'à présent)
  function applyGroup(g) {
    const back = { m: new Map(), t: Date.now() };
    const B = S.board;
    // une clé : « t|id|registre », ou « t|# » pour l'ordre d'une liste (deux morceaux :
    // sans ce cas, l'ordre des liens ou des objets ne s'annulait jamais)
    const parse = (key) => { const p = key.split('|'); return p.length === 2 && p[1] === '#' ? [p[0], '', '#'] : p; };
    const phase = (key, bf) => {
      const [t, , k] = parse(key);
      if (t === 'b') return 2;
      if (k === '*') return bf.obj ? (t === 'n' ? 0 : 1) : (t === 'l' ? 3 : 4);
      return k === '#' ? 5 : k === 'slots#' ? 2.5 : 2;   // l'ordre des cases après les cases remises
    };
    const E = [...g.m.entries()].sort((a, b) => phase(...a) - phase(...b));
    for (const [key, bf] of E) {
      const [t, id, k] = parse(key);
      if (t === 'b' && k === 'pres') { back.m.set(key, { v: clone(B.pres) }); setPres(B, bf.v); continue; }
      if (t === 'b') { back.m.set(key, { v: B.name }); B.name = bf.v; nameUi(); continue; }
      const list = t === 'n' ? B.nodes : B.links;
      if (k === '#') { back.m.set(key, { ids: list.map((x) => x.id) }); reorder(list, bf.ids); continue; }
      const o = list.find((x) => x.id === id);
      if (k === '*') {
        if (!back.m.has(key)) back.m.set(key, { obj: o ? clone(o) : null });
        if (bf.obj) {
          if (o) { for (const x of Object.keys(o)) if (!(x in bf.obj)) delete o[x]; Object.assign(o, clone(bf.obj)); }
          else if (t === 'l' && !(B.nodes.some((n) => n.id === bf.obj.a) && B.nodes.some((n) => n.id === bf.obj.b))) { /* un bout n'est plus là */ }
          else list.push(clone(bf.obj));
        } else if (o) {
          if (t === 'n') {
            for (const l of B.links) if (l.a === id || l.b === id) { const lk = `l|${l.id}|*`; if (!back.m.has(lk)) back.m.set(lk, { obj: clone(l) }); }
            B.links = B.links.filter((l) => l.a !== id && l.b !== id);
            B.nodes = B.nodes.filter((x) => x !== o);
          } else B.links = B.links.filter((x) => x !== o);
        }
        continue;
      }
      if (!o) continue;   // retiré par un autre entre-temps : le retrait gagne
      back.m.set(key, { v: clone(get(t, o, k)) });
      put(t, o, k, bf.v);
    }
    return back;
  }
  // un pas qui ne change plus rien (tout a été retiré, ou remis par d'autres) : le suivant
  function step(from, to, mode) {
    if (!S.board) return;
    local('save');
    while (from.length) {
      const g = from.pop();
      const back = applyGroup(g);
      K.cur = null;
      K.mode = mode;
      K.lastOps = [];
      try { prune(); app.commit(); } finally { K.mode = null; }
      if (K.lastOps.length) { to.push(back); break; }
    }
    paintUndo();
  }
  app.undoStep = () => step(S.undo, S.redo, 'undo');
  app.redoStep = () => step(S.redo, S.undo, 'redo');

  // ── mes gestes → des opérations ──────────────────────────────
  function emit(t, id, k, v, before, out) {
    const op = { o: 'set', t, id, k };
    if (v !== undefined) op.v = clone(v);
    if (isText(t, k) && typeof v === 'string' && typeof before === 'string') op.b = before;   // d'où part ce texte
    out.push(op);
    if (!MACHINE.has(k)) rec(`${t}|${id}|${k}`, { v: clone(before) });
  }
  function diffObj(t, o, b, out) {
    if (eq(o, b)) return;
    let h, other = false;
    for (const k of regs(t, b, regs(t, o))) {
      const v = get(t, o, k), w = get(t, b, k);
      if (eq(v, w)) continue;
      if (k === 'h') { h = v; continue; }     // mesurée : elle attend un vrai changement de l'objet
      other = true;
      emit(t, o.id, k, v, w, out);
      put(t, b, k, v);
    }
    if (h !== undefined) {
      if (other) emit(t, o.id, 'h', h, b.h, out);
      b.h = h;
    }
  }
  function diffColl(t, list, BM, out) {
    const seen = new Set();
    for (const o of list) {
      seen.add(o.id);
      const b = BM.get(o.id);
      if (!b) { out.push({ o: 'add', t, v: clone(o) }); BM.set(o.id, clone(o)); rec(`${t}|${o.id}|*`, { obj: null }); continue; }
      diffObj(t, o, b, out);
    }
    const ord = t === 'n' ? 'no' : 'lo';
    for (const [id, b] of BM) {
      if (seen.has(id)) continue;
      out.push({ o: 'del', t, id });
      rec(`${t}|#`, { ids: K.base[ord].slice() });   // l'annulation le remet à sa place d'empilement
      rec(`${t}|${id}|*`, { obj: b });
      BM.delete(id);
    }
  }
  // l'ordre ne part que s'il a vraiment changé (un ajout à la fin, un retrait : le serveur
  // les place de lui-même, et renvoie l'ordre complet après un ajout)
  function diffOrder(t, list, out) {
    const key = t === 'n' ? 'no' : 'lo';
    const now = list.map((x) => x.id), was = K.base[key];
    K.base[key] = now;
    if (appended(now, was)) return;
    out.push({ o: 'ord', t, ids: now });
    rec(`${t}|#`, { ids: was });
  }
  function diffAll() {
    const B = S.board, out = [];
    diffColl('n', B.nodes, K.base.N, out);
    diffColl('l', B.links, K.base.L, out);
    diffOrder('n', B.nodes, out);
    diffOrder('l', B.links, out);
    if (B.name !== K.base.name) {
      out.push({ o: 'set', t: 'b', k: 'name', v: B.name });
      rec('b||name', { v: K.base.name });
      K.base.name = B.name;
    }
    // le design de la présentation (diapo/) : un registre de la planche
    if (!eq(B.pres, K.base.pres)) {
      const op = { o: 'set', t: 'b', k: 'pres' };
      if (B.pres !== undefined) op.v = clone(B.pres);
      out.push(op);
      rec('b||pres', { v: clone(K.base.pres) });
      K.base.pres = clone(B.pres);
    }
    return out;
  }
  // pendant un geste : la géométrie seulement (quelques comparaisons de nombres par objet)
  function diffGeo() {
    const out = [];
    for (const o of S.board.nodes) {
      const b = K.base.N.get(o.id);
      if (!b) continue;
      const v = get('n', o, 'geo'), w = get('n', b, 'geo');
      if (eq(v, w)) continue;
      emit('n', o.id, 'geo', v, w, out);
      put('n', b, 'geo', v);
    }
    return out;
  }
  function diffIds(ids) {
    const out = [];
    for (const id of ids) {
      const o = S.board.nodes.find((x) => x.id === id), b = K.base.N.get(id);
      if (o && b) diffObj('n', o, b, out);
    }
    return out;
  }
  // ── le spectateur : il regarde ; ce qu'il toucherait revient tel que le serveur l'a ─
  // ce que la page recalcule seule ne compte pas : la hauteur mesurée, la boîte d'un groupe
  // déplié, les places d'une rangée (groups.js, layoutAll)
  function strip(o, flow) {
    let s = o;
    if (AUTO_H.has(o.type)) s = { ...s, h: 0 };
    if (o.type === 'group' && !o.collapsed) s = { ...s, x: 0, y: 0, w: 0, h: 0 };
    else if (o.group && flow.has(o.group)) s = { ...s, x: 0, y: 0 };
    return s;
  }
  function differs() {
    const B = S.board;
    const why = (w) => { K.stats.why = w; return true; };
    if (B.name !== K.base.name || B.nodes.length !== K.base.N.size || B.links.length !== K.base.L.size) return why('taille');
    if (!eq(B.pres, K.base.pres)) return why('présentation');
    const flow = new Set(B.nodes.filter((g) => g.type === 'group' && g.layout?.mode === 'flow').map((g) => g.id));
    for (const o of B.nodes) { const b = K.base.N.get(o.id); if (!b || !eq(strip(o, flow), strip(b, flow))) return why(`objet ${o.id}`); }
    for (const l of B.links) { const b = K.base.L.get(l.id); if (!b || !eq(l, b)) return why(`lien ${l.id}`); }
    if (!B.nodes.every((o, i) => o.id === K.base.no[i]) || !B.links.every((l, i) => l.id === K.base.lo[i])) return why('ordre');
    return false;
  }
  function restoreBase(warn = true) {
    const b = K.base;
    const B = S.board;
    const fit = (list, ids, M) => {
      const keep = new Map(list.map((x) => [x.id, x]));
      return ids.map((id) => {
        const v = M.get(id), o = keep.get(id);
        if (!o) return clone(v);
        for (const k of Object.keys(o)) if (!(k in v)) delete o[k];
        return Object.assign(o, clone(v));
      });
    };
    B.nodes = fit(B.nodes, b.no, b.N);
    B.links = fit(B.links, b.lo, b.L);
    B.name = b.name;
    setPres(B, b.pres);
    nameUi();
    full();
    K.stats.restored = (K.stats.restored || 0) + 1;
    if (warn && Date.now() - K.warnT > 4000) { K.warnT = Date.now(); toast('spectateur : cette planche se regarde, elle ne se modifie pas ici', 4000); }
  }
  function setRole(role, can) {
    K.role = role || '';
    K.can = can || { see: true, edit: true, comment: true };
    const viewer = !K.can.edit;
    if (viewer === K.viewer) return;
    K.viewer = viewer;
    document.body.classList.toggle('co-viewer', viewer);
    if (viewer) {
      app.canvas.lock?.();
      S.undo = []; S.redo = []; K.cur = null;
      paintUndo();
      if (ready() && differs()) restoreBase();
    } else app.canvas.unlock?.();
    hooks.status?.();
  }

  // `why` : commit (un geste fini), quiet, save, live (un geste en cours), touch (un champ)
  function local(why, { geo = false, ids = null } = {}) {
    if (!ready()) return [];
    if (K.viewer) { if (why !== 'live' && why !== 'quiet' && differs()) restoreBase(why === 'commit' || why === 'touch'); return []; }
    // où s'inscrit l'annulation : le geste ouvert (app.snap) ; un commit sans « snap » a son propre pas
    const temp = !K.mode && !K.cur && why === 'commit' ? { m: new Map(), t: Date.now() } : null;
    K.rec = K.mode ? null : K.cur || temp;
    let ops;
    try { ops = geo ? diffGeo() : ids ? diffIds(ids) : diffAll(); } finally { K.rec = null; }
    if (temp && temp.m.size) { S.undo.push(temp); if (S.undo.length > 150) S.undo.shift(); S.redo = []; K.cur = temp; paintUndo(); }
    K.lastOps = ops;
    if (ops.length) queue(ops);
    return ops;
  }
  app.on('commit', () => local('commit'));
  app.on('quiet', () => { if (!K.selfQuiet) local('quiet'); });
  // pendant un geste (déplacer, redimensionner, mettre à l'échelle) : la géométrie au fil de l'eau
  const liveSoon = () => { if (!K.liveT && K.on) K.liveT = setTimeout(() => { K.liveT = 0; local('live', { geo: true }); }, LIVE_MS); };
  addEventListener('pointerdown', (e) => { if (e.button === 0) K.pointer = true; }, true);
  for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, () => { K.pointer = false; }, true);
  addEventListener('pointermove', (e) => { if ((e.buttons & 1) && S.board) liveSoon(); }, { capture: true, passive: true });
  app.on('moving', (ids) => { if (ids?.length) liveSoon(); });
  // un champ qu'on remplit (note, carte, inspecteur) : l'objet choisi, ou celui du champ
  const touch0 = app.touch;
  app.touch = (...a) => {
    const r = touch0(...a);
    if (!K.touchT && K.on) {
      K.touchT = setTimeout(() => {
        K.touchT = 0;
        const ids = new Set(S.sel);
        const f = document.activeElement?.closest?.('[data-id]')?.dataset.id;
        if (f) ids.add(f);
        if (ids.size) local('touch', { ids: [...ids] });
      }, TOUCH_MS);
    }
    return r;
  };

  // ── l'envoi : un lot à la fois ; ce qui s'accumule part au suivant ─
  function queue(ops) {
    if (!K.on) return;   // repli : la planche entière s'enregistre (ideation.js)
    for (const op of ops) { const ks = keysOf(op); for (const k of ks) inc(k); K.outKeys.push(...ks); K.out.push(op); }
    send();
  }
  // un registre changé plusieurs fois dans le lot : sa dernière valeur (un texte : partie
  // d'où la première était partie — les valeurs d'entre-deux n'ont jamais quitté la page)
  function compact(ops) {
    const last = new Map(), first = new Map();
    ops.forEach((op, i) => {
      if (op.o !== 'set') return;
      const key = `${op.t}|${op.id}|${op.k}`;
      last.set(key, i);
      if (!first.has(key)) first.set(key, op);
    });
    return ops.filter((op, i) => op.o !== 'set' || last.get(`${op.t}|${op.id}|${op.k}`) === i).map((op) => {
      const f = op.o === 'set' ? first.get(`${op.t}|${op.id}|${op.k}`) : null;
      if (!f || f === op || !('b' in op)) return op;
      const o2 = { ...op };
      if ('b' in f) o2.b = f.b; else delete o2.b;
      return o2;
    });
  }
  function paint() {
    if (!K.on) return;
    S.dirty = K.out.length > 0 || !!(K.fly && K.fails);
    S.saving = K.fly ? true : null;
    app.paintSave?.();
    hooks.status?.();
  }
  function send() {
    if (!K.on || K.fly || K.syncing || !K.out.length) { paint(); return; }
    const wait = LIVE_MS - (Date.now() - K.lastSend);
    if (wait > 0) { if (!K.sendT) K.sendT = setTimeout(() => { K.sendT = 0; send(); }, wait); paint(); return; }
    const ops = compact(K.out), keys = K.outKeys;
    K.out = []; K.outKeys = [];
    const live = K.pointer && ops.every((o) => o.o === 'set' && o.t === 'n' && o.k === 'geo');
    const f = { n: ++K.n, ops, keys, live, gen: K.gen };
    K.fly = f;
    K.sent.set(f.n, f);
    post(f);
  }
  async function post(f) {
    K.lastSend = Date.now();
    K.stats.sent++;
    paint();
    let r;
    try {
      r = await api(`ideation/collab/${K.bid}/ops`, { method: 'POST', body: { sid: K.sid, n: f.n, ops: f.ops, live: f.live } });
    } catch (e) {
      if (f.gen !== K.gen || K.fly !== f) return;
      if (FATAL.has(e.status)) { die(e.message); return; }
      if (e.status === 403) {   // spectateur (le rôle a changé) : rien ne part, la planche revient
        K.fly = null; K.sent.delete(f.n); for (const k of f.keys) dec(k);
        for (const k of K.outKeys) dec(k);
        K.out = []; K.outKeys = [];
        setRole('viewer', { see: true, edit: false, comment: K.can.comment });
        restoreBase();
        paint();
        return;
      }
      K.fails++;
      paint();
      await sleep(Math.min(15000, 400 * 2 ** Math.min(K.fails, 6)));
      if (f.gen === K.gen && K.fly === f) post(f);   // le même lot, le même numéro : le serveur ne l'applique qu'une fois
      return;
    }
    if (f.gen !== K.gen) return;
    K.fly = null; K.fails = 0;
    K.serverRev = Math.max(K.serverRev, r.rev);
    // l'écho arrive par le flux ; sans flux, ou s'il tarde, on relit ce qui manque
    if (!K.stream) pull();
    else setTimeout(() => { if (f.gen === K.gen && S.rev < r.rev) pull(); }, ECHO_MS);
    send();
  }
  // un refus franc (le serveur ne connaît pas ces routes, un lot illisible…) : l'enregistrement entier
  function die(why) {
    K.on = false; K.dead = why; K.fly = null; K.out = []; K.outKeys = [];
    toast(`co-édition coupée (${why}) : la planche s’enregistre entière, comme avant`, 8000);
    S.saving = null; S.dirty = true;
    app.flushSave?.();
    hooks.status?.();
  }
  function idle(ms) {
    return new Promise((res) => {
      const t0 = Date.now();
      const tick = () => { if ((!K.out.length && !K.fly) || !K.on || Date.now() - t0 > ms) res(); else setTimeout(tick, 40); };
      tick();
    });
  }
  function save() {
    if (!ready()) return Promise.resolve();
    local('save');
    send();
    return idle(3000);
  }
  function unload() {
    if (!ready() || !K.on) return;
    local('save');
    const ops = [...(K.fly ? K.fly.ops : []), ...K.out];
    if (!ops.length) return;
    try {
      navigator.sendBeacon(hooks.url(`ideation/collab/${K.bid}/ops`),
        new Blob([JSON.stringify({ sid: K.sid, n: ++K.n, ops: compact(ops) })], { type: 'application/json' }));
    } catch { /* */ }
  }

  // ── les opérations reçues ────────────────────────────────────
  // un registre venu du serveur : sauf si j'ai là un changement non confirmé, ou en cours
  // (un texte, lui, se fusionne : ma frappe par-dessus la leur, le champ où j'écris suit)
  function putReg(t, o, b, k, v) {
    if (pending(`${t}|${o.id}|${k}`) || pending(`${t}|${o.id}|*`)) { K.stats.skipped++; return false; }
    const cur = get(t, o, k), bc = get(t, b, k);
    put(t, b, k, v);
    const text = isText(t, k) && typeof cur === 'string' && typeof v === 'string';
    if (!eq(cur, bc)) {
      if (!text || typeof bc !== 'string') { K.stats.skipped++; return false; }   // un geste en cours ici : il partira et gagnera
      const m = mergeText(bc, v, cur);
      if (m === cur) return false;
      K.stats.merged = (K.stats.merged || 0) + 1;
      follow(o, k, cur, m);
      put(t, o, k, m);
      return true;
    }
    if (eq(cur, k === 'geo' ? { ...cur, ...v } : v)) return false;
    if (text) follow(o, k, cur, v);
    put(t, o, k, v);
    return true;
  }
  // le champ où j'écris ce registre de cet objet (sur la planche, ou dans l'inspecteur pour
  // l'objet choisi ; il le dit par data-reg) : il prend le nouveau texte, le curseur reste à
  // sa place. Un champ qui ne le dit pas n'est pas touché (il se refait quand on le quitte).
  function follow(o, k, was, now) {
    const f = document.activeElement;
    if (!f || f.dataset?.reg !== k || !(f.matches?.('textarea, input') || f.isContentEditable)) return;
    const host = f.closest?.('[data-id]');
    if (host ? host.dataset.id !== o.id : !(f.closest?.('#insp') && S.sel.size === 1 && S.sel.has(o.id))) return;
    if (f.isContentEditable) {
      const tt = f.style.textTransform;
      f.style.textTransform = 'none';
      const shown = f.innerText.replace(/\n$/, '');
      f.style.textTransform = tt;
      if (shown !== was) return;
      const sel = getSelection();
      let p = now.length;
      if (sel.rangeCount && f.contains(sel.focusNode)) {
        const r = document.createRange();
        r.selectNodeContents(f);
        r.setEnd(sel.focusNode, sel.focusOffset);
        p = mapPos(was, now, r.toString().length);
      }
      f.textContent = now;
      const tn = f.firstChild;
      if (tn) sel.collapse(tn, Math.min(p, tn.length));
      return;
    }
    if (f.value !== was) return;
    const a = f.selectionStart, z = f.selectionEnd;
    f.value = now;
    try { f.setSelectionRange(mapPos(was, now, a), mapPos(was, now, z)); } catch { /* un champ sans sélection */ }
  }
  function putObj(t, v) {
    const o = find(t, v.id), b = baseMap(t).get(v.id);
    if (!o || !b) return insert(t, v);
    let ch = false;
    for (const k of regs(t, v, regs(t, o))) ch = putReg(t, o, b, k, get(t, v, k)) || ch;
    return ch;
  }
  function insert(t, v) {
    if (pending(`${t}|${v.id}|*`)) return false;
    if (find(t, v.id)) return putObj(t, v);
    if (t === 'l' && !(find('n', v.a) && find('n', v.b))) return false;   // un bout retiré ici : le serveur le retirera aussi
    coll(t).push(clone(v));
    baseMap(t).set(v.id, clone(v));
    K.base[t === 'n' ? 'no' : 'lo'].push(v.id);
    return true;
  }
  function remove(t, id) {
    const list = coll(t);
    const had = list.some((x) => x.id === id);
    if (t === 'n') {
      S.board.nodes = list.filter((x) => x.id !== id);
      const gone = S.board.links.filter((l) => l.a === id || l.b === id).map((l) => l.id);
      for (const [lid, l] of K.base.L) if (l.a === id || l.b === id) gone.push(lid);
      for (const lid of gone) remove('l', lid);
    } else S.board.links = list.filter((x) => x.id !== id);
    baseMap(t).delete(id);
    const key = t === 'n' ? 'no' : 'lo';
    K.base[key] = K.base[key].filter((x) => x !== id);
    return had;
  }
  function adopt(t, ids) {
    if (pending(`${t}|#`)) return false;
    const list = coll(t);
    const before = list.map((x) => x.id).join('|');
    reorder(list, ids);
    const now = list.map((x) => x.id);
    K.base[t === 'n' ? 'no' : 'lo'] = now;
    return now.join('|') !== before;
  }
  // les styles de la présentation venus d'un autre : sauf si j'y ai un changement non confirmé
  function putPres(v) {
    if (pending('b||pres')) return false;
    const dirty = !eq(S.board.pres, K.base.pres);
    K.base.pres = clone(v);
    if (dirty || eq(S.board.pres, v)) return false;
    setPres(S.board, v);
    return true;
  }
  function putName(v) {
    if (pending('b||name')) return false;
    const dirty = S.board.name !== K.base.name;
    K.base.name = v;
    if (dirty || S.board.name === v) return false;
    S.board.name = v;
    nameUi();
    return true;
  }
  // un lot du serveur : `ops` (celles de son auteur), `fx` (ce que le serveur en a déduit), l'ordre
  function apply(ev) {
    const f = ev.sid === K.sid ? K.sent.get(ev.n) : null;
    if (f) { for (const k of f.keys) dec(k); K.sent.delete(ev.n); }
    else K.stats.got++;
    const R = { full: false, geo: new Set(), items: [] };
    for (const op of [...(ev.ops || []), ...(ev.fx || [])]) {
      if (op.t === 'b') {
        if (op.k === 'name' && putName(op.v)) R.full = true;
        if (op.k === 'pres' && putPres(op.v)) R.full = true;
        continue;
      }
      if (op.t !== 'n' && op.t !== 'l') continue;
      if (op.o === 'set') {
        const o = find(op.t, op.id), b = baseMap(op.t).get(op.id);
        if (o && b && putReg(op.t, o, b, op.k, op.v)) {
          K.stats.applied++;
          if (op.t === 'n' && op.k === 'geo' && o.type !== 'group' && !o.group) R.geo.add(op.id); else R.full = true;
        }
      } else if (op.o === 'add' || op.o === 'put') {
        if (putObj(op.t, op.v)) { K.stats.applied++; R.full = true; if (op.v.type === 'media') R.items.push(op.v.item); }
      } else if (op.o === 'del') {
        if (remove(op.t, op.id)) { K.stats.applied++; R.full = true; }
      }
    }
    if (ev.order && adopt('n', ev.order)) R.full = true;
    if (ev.lorder && adopt('l', ev.lorder)) R.full = true;
    return R;
  }
  function onEvent(ev) {
    if (!ready() || !K.on || !ev || typeof ev.rev !== 'number') return;
    if (K.syncing) { K.q.set(ev.rev, ev); return; }
    if (ev.rev <= S.rev) return;
    if (ev.rev > S.rev + 1) { K.q.set(ev.rev, ev); pull(); return; }
    const all = { full: false, geo: new Set(), items: [] };
    const take = (e) => {
      const R = apply(e);
      S.rev = e.rev;
      if (S.board) S.board.rev = e.rev;
      all.full ||= R.full; for (const id of R.geo) all.geo.add(id); all.items.push(...R.items);
    };
    take(ev);
    while (K.q.has(S.rev + 1)) { const e = K.q.get(S.rev + 1); K.q.delete(S.rev + 1); take(e); }
    for (const r of [...K.q.keys()]) if (r <= S.rev) K.q.delete(r);
    K.serverRev = Math.max(K.serverRev, S.rev);
    repaint(all);
  }
  // relire ce qui manque (un trou dans la suite, un écho qui tarde, pas de flux)
  async function pull() {
    if (K.pulling || !ready() || !K.on) return;
    K.pulling = true;
    K.stats.pulls++;
    const gen = K.gen;
    let r = null;
    try { r = await api(`ideation/collab/${K.bid}/ops?since=${S.rev}`); } catch { /* le flux, ou le prochain essai */ }
    K.pulling = false;
    if (!r || gen !== K.gen) return;
    if (r.reset) { resync(); return; }
    for (const ev of r.events) onEvent(ev);
  }
  setInterval(() => { if (!K.stream && ready() && K.on && !document.hidden) pull(); }, POLL_MS);

  // ── se recaler : la planche relue, mes gestes rejoués dessus ─
  function replay(op) {
    const B = S.board;
    if (op.t === 'b') { if (op.k === 'name') B.name = op.v; if (op.k === 'pres') setPres(B, op.v); return; }
    const list = op.t === 'n' ? B.nodes : B.links;
    if (op.o === 'add') {
      const o = list.find((x) => x.id === op.v.id);
      if (o) { for (const x of Object.keys(o)) if (!(x in op.v)) delete o[x]; Object.assign(o, clone(op.v)); } else list.push(clone(op.v));
    } else if (op.o === 'del') {
      if (op.t === 'n') { B.nodes = B.nodes.filter((x) => x.id !== op.id); B.links = B.links.filter((l) => l.a !== op.id && l.b !== op.id); }
      else B.links = B.links.filter((x) => x.id !== op.id);
    } else if (op.o === 'set') {
      const o = list.find((x) => x.id === op.id);
      // mon texte rejoué sur la planche relue : fusionné avec ce que d'autres y ont écrit
      if (o) put(op.t, o, op.k, typeof op.b === 'string' ? mergeText(op.b, get(op.t, o, op.k), op.v) : op.v);
    } else if (op.o === 'ord') reorder(list, op.ids);
  }
  function adoptBoard(b) {
    const B = S.board;
    const fit = (list, from) => {
      const keep = new Map(list.map((x) => [x.id, x]));
      return from.map((v) => {
        const o = keep.get(v.id);
        if (!o) return clone(v);
        for (const k of Object.keys(o)) if (!(k in v)) delete o[k];
        return Object.assign(o, clone(v));
      });
    };
    B.nodes = fit(B.nodes, b.nodes);
    B.links = fit(B.links, b.links);
    B.name = b.name; B.rev = b.rev; B.updated = b.updated;
    setPres(B, b.pres);
    S.rev = b.rev;
    K.base = snapshot(b);
    nameUi();
  }
  async function resync() {
    if (K.syncing || !ready() || !K.on) return;
    K.syncing = true;
    K.stats.resync++;
    hooks.status?.();
    const bid = K.bid;
    try {
      local('save');
      let b = null;
      for (let i = 0; !b; i++) {
        try { b = await api('ideation/boards/' + bid); } catch (e) {
          if (K.bid !== bid) return;
          if (e.status === 404) { die('planche absente'); return; }
          await sleep(Math.min(15000, 800 * 2 ** i));
        }
      }
      if (K.bid !== bid || !S.board) return;
      const mine = [...[...K.sent.values()].flatMap((f) => f.ops), ...K.out];
      K.gen++;   // les réponses en route ne comptent plus
      K.fly = null; K.sent.clear(); K.pend.clear(); K.out = []; K.outKeys = [];
      adoptBoard(b);
      for (const op of mine) replay(op);
      K.mode = 'sync';
      try { local('sync'); } finally { K.mode = null; }
      const q = [...K.q.values()].filter((e) => e.rev > S.rev).sort((x, y) => x.rev - y.rev);
      K.q.clear();
      K.syncing = false;
      for (const e of q) onEvent(e);
      items(S.board.nodes.filter((n) => n.type === 'media').map((n) => n.item));
      repaint({ full: true, geo: new Set(), items: [] });
      send();
    } finally { K.syncing = false; hooks.status?.(); }
  }

  // ── repeindre ────────────────────────────────────────────────
  async function items(ids) {
    const want = [...new Set(ids)].filter((id) => id && !S.items.has(id));
    if (!want.length) return;
    try {
      const r = await api('library/batch', { method: 'POST', body: { ids: want } });
      for (const it of r.items || []) S.items.set(it.id, it);
      for (const id of r.missing || []) S.items.set(id, { id, missing: true });
    } catch {
      for (const id of want) S.items.set(id, await api('library/' + id).catch(() => ({ id, missing: true })));
    }
    full();
  }
  function full() {
    if (K.rf) return;
    K.rf = requestAnimationFrame(() => {
      K.rf = 0;
      if (!S.board) return;
      const ch = prune();
      app.render();
      app.insp?.render();
      if (ch) app.selectionChanged();
      K.selfQuiet = true;
      try { app.emit('quiet', S.board); } finally { K.selfQuiet = false; }
    });
  }
  // la géométrie seule d'objets déjà là (un geste des autres, 20 fois par seconde) : on les
  // replace sans refaire la planche ; un rendu entier suit quand le geste s'arrête
  function repaint(R) {
    if (R.items.length) items(R.items);
    if (R.full) { full(); return; }
    if (!R.geo.size) return;
    const dom = app.canvas.dom;
    for (const id of R.geo) {
      const n = app.node(id), e = dom?.get(id)?.el;
      if (!n || !e) continue;
      e.style.left = `${n.x}px`; e.style.top = `${n.y}px`; e.style.width = `${n.w}px`;
      e.style.height = AUTO_H.has(n.type) ? '' : `${n.h}px`;
      if (n.type === 'frame') e.style.setProperty('--fw', `${n.w}px`);
    }
    app.canvas.reflow?.();
    app.canvas.paintMini?.();
    app.canvas.sel?.follow?.();
    app.canvas.cull?.();
    hooks.moved?.();
    clearTimeout(K.settleT);
    K.settleT = setTimeout(full, 400);
  }

  // ── ce que collab.js branche : le flux ───────────────────────
  const api_ = {
    K,
    on: () => K.on && ready(),
    since: () => (ready() && K.on ? S.rev : null),
    hello(ops) {
      K.stream = true;
      if (!ready() || !K.on || !ops) return;
      K.serverRev = Math.max(K.serverRev, ops.rev || 0);
      if (ops.reset) resync();
    },
    stream(on) { K.stream = !!on; },
    event: onEvent,
    reset() { if (ready() && K.on) resync(); },
    role: setRole,
    viewer: () => K.viewer,
    save, unload, pull, resync,
  };
  // chargé après l'ouverture de la planche (les modules arrivent après le départ) : on attend
  // que l'enregistrement entier en cours ait fini, pour partir de ce que le serveur a
  (async () => {
    await sleep(0);   // le module qui nous greffe finit d'abord de s'installer
    for (let i = 0; i < 100 && S.board && (S.dirty || S.saving); i++) { try { await S.saving; } catch { /* */ } await sleep(60); }
    if (S.board && !K.base && !S.conflict) init(S.board);
  })();
  return api_;
}
