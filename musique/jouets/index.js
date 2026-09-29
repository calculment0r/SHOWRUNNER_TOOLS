// JOUETS — les quatorze jouets du « ODIO-O1 Playground » de Cal, devenus des
// modules du nodal (29/09 : « on doit leur mettre des in et out pour pouvoir
// les relier, on les met dans notre DA mais on garde le design à l'intérieur
// des nodes […] il faut garder leur code d'interaction »).
//
//   defs.js    leurs réglages, leur taille, leurs ports (modules.js les ajoute à MODULES)
//   scenes.js  l'intérieur : la physique, le dessin, les gestes du Playground
//   son.js     le son des quatre qu'on traverse (écho, réverbe, filtre, volume)
//   index.js   ici : les jouets posés, UNE boucle d'animation pour tous (elle
//              s'arrête quand il n'y a plus de jouet), les ports « notes »
//              (losange) et « valeur » (carré) et leurs câbles, l'envoi des
//              notes aux instruments calé sur le transport, les valeurs vers
//              les réglages, le mélange de la fontaine
//
// Le nodal ne connaît de tout cela que des points d'accroche marqués
// « jouets : » (nodal.js) ; le moteur, trois (moteur.js) ; le projet, les
// câbles typés `{ a, b, t: 'notes' | 'mod', k }` (musique.js, music_jouets.py).

import { toast } from '../../commun/shell.js';
import { MODULES, AUTOMATABLE, TRACK_KINDS, SOURCES_OF, spec, val, fromNorm, drumVoicesOf } from '../modules.js';
import { el, menu, put, clamp } from '../ui.js';
import { JOUET_TYPES, NOTE_SOURCES, CALAGES, SCALES } from './defs.js';
import { Scene, SCENES, PINS, SLING, palette } from './scenes.js';
import { magPhase } from './son.js';

// le style des jouets : leurs jetons, la police du Playground, les ports
{
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./jouets.css', import.meta.url).href;
  document.head.append(l);
}

const NS = 'http://www.w3.org/2000/svg';
const HD = 38;                  // la hauteur de l'en-tête d'une carte de jouet (jouets.css)
const PORT_Y = [34, 58, 82];    // les ports d'un bord, de haut en bas (le premier est celui du son, s'il y en a)
const PORT_FR = { audio: 'son', notes: 'notes', mod: 'valeur' };
// le budget d'un canvas de scène : 4 Mpx (16 Mo) — l'AIMANT (520 × 440) à ×4,2,
// soit 280 % sur un écran à 150 % ; au-delà, la scène s'étire un peu
const PIXELS_CANVAS = 4e6;
const isToy = (m) => !!MODULES[m?.type]?.jouet;
const hasScene = (m) => isToy(m) && MODULES[m.type].scene !== false;

// ce qu'une valeur peut régler sur un module : les réglages continus d'un
// jouet (ceux du Playground), ou ce que le moteur tient par un AudioParam ou
// par setParameter (AUTOMATABLE, sans la coupure du synthé, lue note par note)
export function modTargets(m) {
  const def = MODULES[m?.type];
  if (!def || def.role === 'master') return [];
  if (def.jouet) return (def.face || []).filter((k) => !spec(m.type, k).opts);
  return (AUTOMATABLE[m.type] || []).filter((k) => !(m.type === 'synth' && k === 'cut'));
}
// les ports typés d'un module : [{ dir, t, y }]
export function portsOf(m) {
  const def = MODULES[m?.type];
  if (!def) return [];
  const out = [];
  const side = (dir, list, audio) => list.forEach((t, i) => out.push({ dir, t, y: PORT_Y[i + (audio ? 1 : 0)] }));
  if (def.jouet) {
    side('in', def.ins.filter((t) => t !== 'audio' && (t !== 'mod' || modTargets(m).length)), def.ins.includes('audio'));
    side('out', def.outs.filter((t) => t !== 'audio'), def.outs.includes('audio'));
  } else {
    const ins = [];
    if (NOTE_SOURCES.includes(m.type)) ins.push('notes');
    if (modTargets(m).length) ins.push('mod');
    side('in', ins, def.role !== 'source');
  }
  return out;
}
const accepts = (m, dir, t) => portsOf(m).some((p) => p.dir === dir && p.t === t);

// ═════════════════════════════════════════════════════════════════════
// un jouet posé
// ═════════════════════════════════════════════════════════════════════
class Jeu extends Scene {
  constructor(rt, m) {
    super();
    this.rt = rt; this.m = m; this.type = m.type; this.def = MODULES[m.type]; this.sc = SCENES[m.type] || null;
    this.eff = {};          // le mélange de la fontaine (le `eff` du Playground)
    this.mod = {};          // les valeurs reçues par un câble
    this.play = false; this.bpm = 120; this.C = rt.C;
    if (this.type === 'pin') { this.PINS = PINS.map((p) => ({ ...p })); this.SLING = SLING.map((s) => ({ ...s })); }
    this.S = this.sc ? this.sc.init.call(this) : {};
    this.Sx = { [this.type]: this.S, fx: rt.fx };
    this.lastMod = null; this.lastModT = 0; this.scale = 0; this.ctx = null;
    this.stage = null; this.cv = null; this.off = { x: 0, y: HD };
    if (this.sc) this.makeStage();
  }
  get w() { return this.def.w - 2; }
  get h() { return this.def.h - 102; }
  // V(bloc, réglage) : la signature du Playground ; le bloc est toujours celui-ci
  V(bid, k) {
    if (k === undefined) k = bid;
    if (this.eff[k] !== undefined) return this.eff[k];
    if (this.mod[k] !== undefined) return this.mod[k];
    return val(this.m, k);
  }
  base(k) { return val(this.m, k); }
  vals() { const o = {}; for (const p of this.def.params) o[p.k] = this.V(p.k); return o; }
  setV(k, v) { this.rt.setParam(this, k, v); }
  // le coin du bloc tel que le Playground le posait autour de la scène
  // (bordure 1 px, en-tête 38 px) : ses coordonnées monde gardent leur sens
  pos() { return { x: this.m.x + this.off.x - 1, y: this.m.y + this.off.y - 39 }; }
  magPhase(mp) { return magPhase(this.rt.beat, mp.bars, this.rt.sig); }
  savePath(path) {
    const step = Math.max(1, Math.ceil(path.length / 512));
    this.m.path = path.filter((_, i) => i % step === 0).map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
    this.rt.app.commit('quiet');
  }
  out(pc, v) { this.rt.note(this, pc, v); }
  outDegree(deg, v) {
    const sc = SCALES[Math.round(this.V('scale'))].d, n = sc.length;
    this.out(Math.round(this.V('root')) + sc[((deg % n) + n) % n] + 12 * Math.floor(deg / n), v);
  }

  makeStage() {
    this.cv = el('canvas', { class: 'jo-cv', 'aria-label': `${this.def.name} — ${this.def.hint}` });
    this.stage = el('div', { class: 'jo-stage', style: { width: `${this.w}px`, height: `${this.h}px` } }, this.cv);
    this.cv.addEventListener('pointerdown', (e) => this.down(e));
    this.cv.addEventListener('pointermove', (e) => this.hover(e));
    this.cv.addEventListener('pointerleave', () => this.leave());
    this.cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  // cvDown du Playground, pour un bloc
  down(e) {
    e.preventDefault();
    // SHOWRUNNER : la propagation continue jusqu'à la carte, qui se choisit ;
    // le nodal ne se déplace pas sous un geste fait dans une carte
    this.rt.wakeAudio();
    const cv = e.currentTarget, r = cv.getBoundingClientRect(), S = this.Sx;
    const N = (ev) => ({ x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height });
    const n = N(e);
    let lastN = n, lastT = performance.now();
    const hist = [{ t: lastT, x: n.x, y: n.y }];
    if (this.sc.down && this.sc.down.call(this, S, n, e) === false) return;
    const mv = (ev) => {
      const m = N(ev), now = performance.now(), dt = Math.max(8, now - lastT);
      if (this.sc.move) this.sc.move.call(this, S, m, lastN, dt);
      hist.push({ t: now, x: m.x, y: m.y });
      if (hist.length > 16) hist.shift();
      lastN = m; lastT = now;
    };
    const up = () => {
      document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up);
      if (this.sc.up) this.sc.up.call(this, S, hist);
    };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  }
  // cvMove / cvLeave du Playground : le survol (FLIPPER, NAVETTE)
  hover(e) {
    const S2 = this.S;
    if (!('hov' in S2)) return;
    S2.hov = true;
    if (this.type === 'inv') {
      const r2 = e.currentTarget.getBoundingClientRect();
      S2.mx = this.clamp((e.clientX - r2.left) / r2.width, .08, .92);
      S2.my = this.clamp((e.clientY - r2.top) / r2.height, .3, .93);
    }
  }
  leave() { const S2 = this.S; if ('hov' in S2) { S2.hov = false; if (this.type === 'inv') { S2.keys = {}; S2.mx = null; } } }

  // une image : la boucle tick du Playground, pour ce canvas
  draw(s) {
    const cv = this.cv, w = this.w, h = this.h;
    if (cv.width !== Math.round(w * s)) cv.width = Math.round(w * s);
    if (cv.height !== Math.round(h * s)) cv.height = Math.round(h * s);
    const x = this.ctx || (this.ctx = cv.getContext('2d'));
    x.setTransform(s, 0, 0, s, 0, 0);
    x.clearRect(0, 0, w, h);
    x.lineWidth = 1;
    this.sc.draw.call(this, x, w, h, this.vals(), this.S, this.C);
  }
}

// ═════════════════════════════════════════════════════════════════════
// le théâtre : tous les jouets du projet
// ═════════════════════════════════════════════════════════════════════
export function createJouets(app) {
  const { S, engine } = app;
  const inst = new Map();         // id du module → Jeu
  const knobs = new Map();        // id du module → Map(réglage → molette de la carte)
  const outPorts = new Map();     // id du module → le port « notes » sortant (il clignote)
  const shuf = new Map();         // id du module → le mélange en cours (le `sim.shuf` du Playground)
  const modHeld = new Map();      // `${cible}:${réglage}` → id de la cible (ce que les câbles de valeur tiennent)
  const fx = [];                  // les anneaux d'impact des billes de la fontaine (`sim.fx`)
  let raf = 0, last = 0, lastPush = 0, C = null, nodal = null, svg = null, temp = null, ov = null, link = null;
  let prevView = null, depth = 0, rectsCache = null, rectsT = 0;

  const rt = {
    app, fx, beat: 0, sig: 4,
    get C() { return C; },
    rects, shuffle, shufKeys: () => [...shuf.keys()].map((id) => app.mod(id)?.type || id),
    note, setParam, wakeAudio,
  };

  // ── les couleurs du Playground : ses jetons (jouets.css), lus une fois chargés ──
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const read = (n) => cs.getPropertyValue(`--${n}`).trim();
    if (!read('jo-acc')) return null;
    return palette(read);
  }

  // ── la liste des jouets suit le projet (annuler, un autre projet…) ──
  function sync() {
    const P = S.proj, seen = new Set();
    for (const m of P?.modules || []) {
      if (!isToy(m)) continue;
      seen.add(m.id);
      const j = inst.get(m.id);
      if (!j || j.type !== m.type) inst.set(m.id, new Jeu(rt, m));
      else j.m = m;
    }
    for (const [id, j] of inst) if (!seen.has(id)) { j.stage?.remove(); inst.delete(id); shuf.delete(id); }
    return inst.size;
  }
  function ensure(m) { if (!inst.has(m.id)) inst.set(m.id, new Jeu(rt, m)); return inst.get(m.id); }

  // ── la boucle : une seule, pour tous les jouets ; elle s'arrête d'elle-même ──
  function wake() {
    if (raf || !S.proj?.modules.some(isToy)) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function tick() {
    raf = 0;
    if (!C) C = readPalette();
    if (!S.proj || !C) { if (S.proj?.modules.some(isToy)) raf = requestAnimationFrame(tick); return; }
    if (!sync()) { stopAll(); return; }          // plus aucun jouet : la boucle ne se relance pas
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min(.05, (now - last) / 1000);
    last = now;
    const P = S.proj, play = engine.running;
    rt.beat = engine.position(); rt.sig = P.sig || 4;
    panImpulses();
    stepShuffles(dt, now);
    if (dt > 0) for (const j of inst.values()) { j.play = play; j.bpm = P.bpm; j.C = C; if (j.sc) j.sc.phys.call(j, j.Sx, dt); }
    for (const f of fx) f.a -= dt * 2.6;
    const keep = fx.filter((f) => f.a > 0).slice(-6);
    fx.length = 0; fx.push(...keep);
    clocks(play);
    liveSound(play);
    modOuts(now);
    paint();
  }
  function stopAll() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    for (const id of shuf.keys()) endShuffle(id);
    if (ov) { const g = ov.getContext('2d'); g.clearRect(0, 0, ov.width, ov.height); }
  }

  // ── dessiner : les scènes visibles, puis les billes de la fontaine ──
  function view() { return nodal?.view?.() || S.proj?.ui?.nodal || { z: 1, px: 0, py: 0 }; }
  function paint() {
    if (!nodal || S.view !== 'nodal' || !nodal.cv.isConnected) return;
    rt.frames = (rt.frames || 0) + 1;
    const v = view(), cw = nodal.cv.clientWidth, ch = nodal.cv.clientHeight;
    // la définition du canvas suit le zoom : celle de l'écran (net de près,
    // léger de loin, comme le Playground qui dessinait à la taille affichée).
    // SHOWRUNNER (29/09, Cal : le texte « baveux » au zoom) : l'échelle est
    // celle où le nodal rastérise net (`zNet` : figée pendant un geste de la
    // vue, celle de la vue au repos) — un canvas ne se réalloue qu'à l'arrêt ;
    // elle n'est plus plafonnée à 2 (à 280 %, un canvas de 2 était étiré de
    // 40 %), seulement par un budget de pixels par canvas. Par huitièmes : une
    // échelle à peine différente ne réalloue rien.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const zr = nodal.zNet ? nodal.zNet() : v.z;
    const s = Math.max(.25, Math.ceil(dpr * zr * 8) / 8);
    rt.zoom = v.z;
    for (const j of inst.values()) {
      if (!j.stage || !j.stage.isConnected) continue;
      const x0 = v.px + (j.m.x + j.off.x) * v.z, y0 = v.py + (j.m.y + j.off.y) * v.z;
      if (x0 > cw || y0 > ch || x0 + j.w * v.z < 0 || y0 + j.h * v.z < 0) continue;   // hors champ : pas dessiné
      j.draw(Math.min(s, Math.floor(Math.sqrt(PIXELS_CANVAS / (j.w * j.h)) * 8) / 8));
    }
    drawBalls(v, cw, ch, dpr);
  }
  // les billes, les éclats et les anneaux : le canvas fxRef du Playground
  let ovDirty = false;
  function drawBalls(v, w, h, dpr) {
    if (!ov) return;
    // rien en vol : le calque reste vide, sans être refait à chaque image
    const busy = fx.length || [...inst.values()].some((j) => j.type === 'fount' && (j.S.balls.length || j.S.parts.length));
    if (!busy && !ovDirty) return;
    ovDirty = !!busy;
    rt.ovFrames = (rt.ovFrames || 0) + 1;
    if (ov.width !== Math.round(w * dpr)) ov.width = Math.round(w * dpr);
    if (ov.height !== Math.round(h * dpr)) ov.height = Math.round(h * dpr);
    const x = ov.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, w, h);
    const cam = { x: -v.px / v.z, y: -v.py / v.z, k: v.z };
    const sc = Scene.prototype;
    x.lineWidth = 1;
    for (const j of inst.values()) {
      if (j.type !== 'fount') continue;
      j.S.balls.forEach((o) => {
        const px = (o.x - cam.x) * cam.k, py = (o.y - cam.y) * cam.k;
        if (px < -20 || py < -20 || px > w + 20 || py > h + 20) return;
        const r = Math.max(2.5, o.r * cam.k);
        if (!o.live) {
          x.fillStyle = C.tick;
          sc.circ(x, px, py, r, 1);
          x.strokeStyle = C.tick2;
          sc.circ(x, px, py, r);
        } else {
          const u = o.fuse / 2.1;
          const per = .34 - u * .27;
          const on = (o.fuse % per) < per * .5;
          x.fillStyle = on ? C.acc : C.acc2;
          sc.circ(x, px, py, r * (1 + u * .3), 1);
          if (on) { x.strokeStyle = j.rgba(C.acc, '.45'); sc.circ(x, px, py, r * (1.9 + u)); }
        }
      });
      j.S.parts.forEach((p2) => {
        const px = (p2.x - cam.x) * cam.k, py = (p2.y - cam.y) * cam.k;
        if (px < -10 || py < -10 || px > w + 10 || py > h + 10) return;
        x.fillStyle = j.rgba(p2.hot ? C.acc2 : C.acc, Math.max(0, p2.a).toFixed(2));
        const s2 = Math.max(1, 2.4 * cam.k * p2.a);
        x.fillRect(px - s2 / 2, py - s2 / 2, s2, s2);
      });
    }
    fx.forEach((f) => {
      const px = (f.x - cam.x) * cam.k, py = (f.y - cam.y) * cam.k;
      x.strokeStyle = Scene.prototype.rgba(C.acc, f.a.toFixed(2));
      sc.circ(x, px, py, (1 - f.a) * 34 * cam.k + 4);
    });
  }

  // ── les cartes du nodal, pour les billes : leur bord haut ──
  function rects(self) {
    const now = performance.now();
    if (!rectsCache || now - rectsT > 500) {
      rectsT = now;
      rectsCache = [];
      for (const m of S.proj.modules) {
        const card = nodal?.world?.querySelector(`.nd-card[data-id="${m.id}"]`);
        const w = card?.offsetWidth || width(m) || 236, h = card?.offsetHeight || 200;
        rectsCache.push({ id: m.id, type: m.type, m, w, h });
      }
    }
    // les positions se relisent à chaque image (on tire les cartes)
    return rectsCache.filter((r) => r.id !== self.m.id && r.type !== 'fount').map((r) => ({ id: r.id, x: r.m.x, y: r.m.y, w: r.w, h: r.h }));
  }

  // ── le mélange de la fontaine (shuffle et le haut de phys du Playground) ──
  // Un jouet : tous ses réglages du Playground. Un autre module : ses réglages
  // continus, sauf les niveaux (dB : c'est la console qui dose) ; la console
  // elle-même (tranches, bus, sortie) n'est jamais mélangée. Rien n'est écrit
  // dans le projet : les valeurs reviennent exactement.
  function shuffleKeys(m) {
    const def = MODULES[m.type];
    if (!def || ['strip', 'bus', 'master'].includes(def.role) || m.type === 'fount') return [];
    if (def.jouet) return def.face || [];
    return def.params.filter((p) => !p.opts && p.unit !== 'dB' && !p.k.includes('.')).map((p) => p.k);
  }
  function shuffle(bid, fount) {
    const m = app.mod(bid);
    if (!m || shuf.has(bid)) return;
    const ks = shuffleKeys(m);
    if (!ks.length) return;
    const j = inst.get(bid), orig = {}, tgt = {};
    ks.forEach((k) => {
      const s = spec(m.type, k);
      orig[k] = j ? j.V(k) : val(m, k);
      tgt[k] = isToy(m) ? s.min + Math.random() * (s.max - s.min) : fromNorm(s, Math.random());
    });
    const F = fount.vals();
    shuf.set(bid, { orig, tgt, t: 0, dur: F.fuse / 1000, hold: F.hold / 1000, ks });
    nodal?.world?.querySelector(`.nd-card[data-id="${bid}"]`)?.classList.add('jo-shuf');
  }
  function stepShuffles(dt, now) {
    if (!shuf.size) return;
    for (const [bid, sh] of [...shuf]) {
      const m = app.mod(bid);
      if (!m) { shuf.delete(bid); continue; }
      sh.t += dt;
      const total = sh.dur * 2 + sh.hold;
      let u;
      if (sh.t < sh.dur) u = sh.t / sh.dur;
      else if (sh.t < sh.dur + sh.hold) u = 1;
      else u = Math.max(0, 1 - (sh.t - sh.dur - sh.hold) / sh.dur);
      const e = u * u * (3 - 2 * u);
      sh.cur = {};
      sh.ks.forEach((k) => { sh.cur[k] = sh.orig[k] + (sh.tgt[k] - sh.orig[k]) * e; });
      const j = inst.get(bid);
      if (j) Object.assign(j.eff, sh.cur);
      if (sh.t > total) endShuffle(bid);
    }
    // le Playground redessinait ses molettes toutes les 70 ms (forceUpdate)
    if (now - lastPush > 70) {
      lastPush = now;
      for (const [bid, sh] of shuf) {
        const m = app.mod(bid);
        if (!isToy(m)) engine.updateModule({ ...m, params: { ...m.params, ...sh.cur } });
        paintKnobs(bid, sh.cur);
      }
    }
  }
  function endShuffle(bid) {
    const sh = shuf.get(bid), m = app.mod(bid), j = inst.get(bid);
    shuf.delete(bid);
    if (j) for (const k of sh?.ks || []) delete j.eff[k];
    if (m && !isToy(m)) engine.updateModule(m);
    if (m) paintKnobs(bid, Object.fromEntries((sh?.ks || []).map((k) => [k, j ? j.V(k) : val(m, k)])), true);
    nodal?.world?.querySelector(`.nd-card[data-id="${bid}"]`)?.classList.remove('jo-shuf');
  }
  function paintKnobs(bid, vals, always = false) {
    const map = knobs.get(bid);
    if (!map) return;
    // les molettes bougent pendant le mélange (le Playground) — de près seulement
    if (!always && (S.view !== 'nodal' || (rt.zoom ?? 1) < .55)) return;
    for (const [k, v] of Object.entries(vals || {})) { const kn = map.get(k); if (kn?.isConnected) kn.setValue(v); }
  }

  // ── la SECOUSSE sent le canvas qu'on déplace (panDown du Playground) ──
  function panImpulses() {
    const v = view();
    if (prevView && S.view === 'nodal' && v.z === prevView.z) {
      const dx = v.px - prevView.px, dy = v.py - prevView.py;
      if ((dx || dy) && Math.abs(dx) < 400 && Math.abs(dy) < 400) for (const j of inst.values()) j.sc?.pan?.call(j, dx, dy);
    }
    prevView = { ...v };
  }

  // ── le son en direct des jouets qu'on traverse ──
  function liveSound(play) {
    const g = engine.graph;
    if (!g) return;
    for (const j of inst.values()) {
      const n = g.nodes.get(j.m.id);
      if (!n?.live) continue;
      if (j.type === 'reel' || j.type === 'alch') n.live(j.S);
      else if (j.type === 'sprg') n.live(j.sc.modOut.call(j, j.S));
      else if (j.type === 'mag' && !(play && j.S.path.length > 3)) n.live(j.S);   // en lecture, son.js suit le chemin
    }
  }

  // ── l'horloge : une note par division, tant que le transport joue ──
  function clocks(play) {
    for (const j of inst.values()) {
      if (j.type !== 'horloge') continue;
      if (!play) { j.nextB = null; continue; }
      const div = [4, 2, 1, .5, .25][Math.round(j.V('div'))], spb = 60 / S.proj.bpm, beat = rt.beat;
      if (j.nextB == null || j.nextB < beat - div || j.nextB > beat + div + .01) j.nextB = Math.ceil((beat - 1e-6) / div) * div;
      let guard = 0;
      while (j.nextB < beat + .06 / spb && guard++ < 8) {
        const at = engine.ctx.currentTime + Math.max(0, (j.nextB - beat) * spb);
        note(j, Math.round(j.V('note')), .8, at);
        j.nextB += div;
      }
    }
  }

  // ── les notes : d'un jouet vers les instruments et les jouets branchés ──
  // La hauteur : 12 × (octave + 1) + la note du jouet (do4 = 60) ; une
  // batterie reçoit la voix de ce rang. L'instant : calé sur la grille du
  // transport qui joue (1/16 par défaut), tout de suite sinon.
  function when(grid) {
    const now = engine.ctx.currentTime;
    if (!engine.running || !grid) return now + .005;
    const P = S.proj, beat = engine.position(), spb = 60 / P.bpm;
    let next = Math.ceil((beat + 1e-4) / grid) * grid;
    if (P.loop?.on && beat < P.loop.b && next > P.loop.b) next = P.loop.b;
    return now + (next - beat) * spb;
  }
  function note(j, pc, v, at) {
    const P = S.proj, cables = P.cables.filter((c) => c.a === j.m.id && c.t === 'notes');
    if (!cables.length || depth > 8) return;
    blink(j.m.id);
    rt.bySrc = rt.bySrc || {};
    rt.bySrc[j.type] = (rt.bySrc[j.type] || 0) + 1;
    if (!engine.graph) { wakeAudio().then(() => { if (engine.graph) note(j, pc, v, at); }); return; }
    const pitch = 12 * (Math.round(j.V('oct')) + 1) + pc;
    const time = at ?? when(spec(j.type, 'q') ? CALAGES[Math.round(j.V('q'))] : 0);
    const dur = j.V('dur') * 60 / P.bpm;
    depth++;
    try {
      for (const c of cables) {
        const B = app.mod(c.b);
        if (!B) continue;
        const bj = inst.get(B.id);
        if (bj) { bj.sc?.trigger?.call(bj, { p: pitch, v, at: time }); continue; }
        playNote(B, pitch, v, time, dur, j.type);
      }
    } finally { depth--; }
    note.count = (note.count || 0) + 1;
  }
  function playNote(B, pitch, v, time, dur, from) {
    const n = engine.graph?.nodes.get(B.id);
    if (!n) return;
    const def = MODULES[B.type];
    let rec = pitch;
    if (def.drum || B.type === 'drums') {
      const voices = drumVoicesOf(B.type), i = ((pitch % voices.length) + voices.length) % voices.length;
      n.hit?.(voices[i].id, time, v);
      rec = i;
    } else n.noteOn?.(pitch, time, v, dur);
    rt.sent = (rt.sent || 0) + 1;
    rt.late = Math.min(rt.late ?? 1, time - engine.ctx.currentTime);
    // la trace des dernières notes (les essais y lisent le calage sur le transport)
    rt.trace = rt.trace || [];
    rt.trace.push({ from, to: B.id, pitch, v, at: time, now: engine.ctx.currentTime, beat: engine.running ? engine.position() + (time - engine.ctx.currentTime) * S.proj.bpm / 60 : null });
    if (rt.trace.length > 400) rt.trace.shift();
    // la prise : une piste armée qui enregistre garde aussi les notes des jouets
    const t = B.track && app.track(B.track);
    if (t && app.rec?.active) {
      const key = `jouet${Math.random().toString(36).slice(2, 8)}`, wait = Math.max(0, (time - engine.ctx.currentTime) * 1000);
      setTimeout(() => { app.rec.noteOn(t, rec, v, key); setTimeout(() => app.rec.noteOff(key), dur * 1000); }, wait);
    }
  }
  // le port de sortie clignote à chaque note — de près seulement, et pas plus
  // de six fois par seconde : un changement de style repeint tout le monde du nodal
  function blink(id) {
    const p = outPorts.get(id), now = performance.now();
    if (!p?.isConnected || S.view !== 'nodal' || (rt.zoom ?? 1) < .55 || now - (p._last || 0) < 160) return;
    p._last = now;
    p.classList.add('hit');
    clearTimeout(p._t); p._t = setTimeout(() => p.classList.remove('hit'), 90);
  }
  // un geste sur un jouet peut démarrer le son (le navigateur l'attend d'un geste)
  function wakeAudio() { return engine.start().catch(() => {}); }

  // ── les valeurs : d'un jouet vers un réglage ──
  function modOuts(now) {
    const P = S.proj, held = new Map();
    for (const j of inst.values()) {
      if (!j.sc?.modOut) continue;
      const cables = P.cables.filter((c) => c.a === j.m.id && c.t === 'mod' && c.k);
      if (!cables.length) continue;
      const v = clamp(j.sc.modOut.call(j, j.S), 0, 1);
      for (const c of cables) held.set(`${c.b}:${c.k}`, c.b);
      if (j.lastMod !== null && Math.abs(v - j.lastMod) < .002 && now - j.lastModT < 250) continue;
      j.lastMod = v; j.lastModT = now;
      for (const c of cables) modulate(c.b, c.k, v);
    }
    // un câble retiré : le réglage reprend sa valeur
    for (const [key, id] of modHeld) {
      if (held.has(key)) continue;
      const k = key.slice(id.length + 1), bj = inst.get(id), m = app.mod(id);
      if (bj) delete bj.mod[k];
      if (m && (!bj || MODULES[m.type].role === 'effect')) engine.updateModule(m);
    }
    modHeld.clear();
    for (const [k, id] of held) modHeld.set(k, id);
  }
  function modulate(id, k, v01) {
    const m = app.mod(id), s = m && spec(m.type, k);
    if (!s) return;
    const x = fromNorm(s, v01), bj = inst.get(id);
    const n = engine.graph?.nodes.get(id);
    // un jouet : sa scène suit ; s'il a du son (les quatre qu'on traverse), son moteur aussi
    if (bj) { bj.mod[k] = x; n?.setAt?.(k, x); return; }
    if (!n) return;
    // une voie d'automation qui joue garde la main
    if (engine.running && (S.proj.auto || []).some((L) => L.mod === id && L.k === k && L.on !== false && L.pts?.length)) return;
    if (n.ap?.[k]) for (const [param, fn] of n.ap[k]) param.setTargetAtTime(fn(x), engine.ctx.currentTime, .02);
    else n.setAt?.(k, x);
  }

  // un réglage écrit par un geste dans la scène (ALCHIMIE : verser)
  function setParam(j, k, v) {
    const s = spec(j.type, k);
    j.m.params[k] = clamp(v, s.min, s.max);
    app.commit('param', j.m);
    paintKnobs(j.m.id, { [k]: j.m.params[k] }, true);
  }

  // ═══ ce que le nodal appelle (ses points d'accroche « jouets : ») ═══
  function width(m) { const d = MODULES[m?.type]; return d?.jouet && d.w ? d.w - 2 : 0; }

  function attach(o) {
    nodal = o;
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'nd-wires jo-wires');
    temp = document.createElementNS(NS, 'path');
    temp.setAttribute('class', 'temp');
    o.world.prepend(svg);
    ov = el('canvas', { class: 'jo-ov', 'aria-hidden': 'true' });
    o.cv.append(ov);
    prevView = null;
    // tirer un câble depuis un port typé (capture : avant la carte et le fond)
    o.world.addEventListener('pointerdown', portDown, true);
    wake();
  }

  function decorate(m, box, hd) {
    const def = MODULES[m.type];
    if (!def) return;
    const j = isToy(m) ? ensure(m) : null;
    if (isToy(m)) {
      box.classList.add('jo');
      // l'en-tête dit ce que disait celui du Playground : son numéro et son rôle
      const lbl = hd.querySelector('.lbl');
      if (lbl) lbl.textContent = def.no ? `${def.no} · ${def.kind}` : def.kind;
      if (!def.ins.includes('audio')) box.querySelector('.port.in')?.remove();
      if (!def.outs.includes('audio')) box.querySelector('.port.out')?.remove();
    }
    for (const p of portsOf(m)) {
      const el2 = el('span', { class: `port jo-port jo-${p.t} ${p.dir}`, 'data-tport': p.dir, 'data-t': p.t,
        title: `${p.dir === 'in' ? 'entrée' : 'sortie'} ${PORT_FR[p.t]}`, style: { top: `${p.y}px` } });
      box.append(el2);
      if (p.dir === 'out' && p.t === 'notes') outPorts.set(m.id, el2);
    }
    if (j?.stage) { hd.after(j.stage); j.off = { x: 0, y: HD }; }
    if (isToy(m)) {
      const ft = box.querySelector('.ft');
      const io = (list) => list.map((t) => PORT_FR[t]).join(' · ') || '—';
      if (ft) put(ft, el('div', { class: 'io' }, el('span', {}, io(def.ins)), el('span', { class: 'lbl' }, def.hint), el('span', {}, io(def.outs))));
    }
    const kns = box.querySelectorAll('.bd .kn'), map = new Map();
    (def.face || []).forEach((k, i) => { if (kns[i]) map.set(k, kns[i]); });
    knobs.set(m.id, map);
    if (shuf.has(m.id)) box.classList.add('jo-shuf');
    // la SECOUSSE sent le bloc qu'on tire par son en-tête (blockDown du Playground)
    if (j?.sc?.drag) hd.addEventListener('pointerdown', (e) => {
      let lx = e.clientX, ly = e.clientY;
      const mv = (ev) => { j.sc.drag.call(j, ev.clientX - lx, ev.clientY - ly); lx = ev.clientX; ly = ev.clientY; };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    });
    rectsCache = null;
    wake();
  }

  // les câbles typés : leur calque SVG, dans le monde du nodal
  function cardOf(id) { return nodal?.world?.querySelector(`.nd-card[data-id="${id}"]`); }
  function portXY(id, dir, t) {
    const m = app.mod(id), p = m && portsOf(m).find((q) => q.dir === dir && q.t === t);
    if (!p) return null;
    const w = cardOf(id)?.offsetWidth || width(m) || 236;
    return [m.x + (dir === 'out' ? w : 0), m.y + p.y];
  }
  const curve = ([x1, y1], [x2, y2]) => {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };
  function wires() {
    if (!svg || !S.proj) return;
    if (svg.parentNode !== nodal.world) nodal.world.prepend(svg);   // le nodal refait son monde à chaque rendu
    put(svg);
    for (const c of S.proj.cables) {
      if (!c.t) continue;
      const a = portXY(c.a, 'out', c.t), b = portXY(c.b, 'in', c.t);
      if (!a || !b) continue;
      const key = `${c.a}>${c.b}`, A = app.mod(c.a), B = app.mod(c.b);
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', `w jo-${c.t}${S.sel.cable === key ? ' sel' : ''}`);
      g.style.setProperty('--k', `var(--${MODULES[A.type].color})`);
      const hit = document.createElementNS(NS, 'path'), vis = document.createElementNS(NS, 'path');
      hit.setAttribute('class', 'hit'); vis.setAttribute('class', 'vis');
      const d = curve(a, b);
      hit.setAttribute('d', d); vis.setAttribute('d', d);
      g.append(vis, hit);
      if (c.t === 'mod') {
        const tx = document.createElementNS(NS, 'text');
        tx.setAttribute('x', (a[0] + b[0]) / 2); tx.setAttribute('y', (a[1] + b[1]) / 2 - 6);
        tx.setAttribute('class', 'lv'); tx.textContent = `${MODULES[A.type].modOut || 'valeur'} → ${spec(B.type, c.k)?.label || c.k}`;
        g.append(tx);
      }
      hit.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        S.sel.cable = key; S.sel.mod = null;
        for (const cc of nodal.world.querySelectorAll('.nd-card.sel')) cc.classList.remove('sel');
        nodal.paintWires(); nodal.paintSide();
      });
      svg.append(g);
    }
    svg.append(temp);
  }

  // tirer un câble typé
  function toWorld(cx, cy) { const r = nodal.cv.getBoundingClientRect(), v = view(); return [(cx - r.left - v.px) / v.z, (cy - r.top - v.py) / v.z]; }
  function portDown(e) {
    const p = e.target.closest?.('[data-tport]');
    if (!p || e.button !== 0) return;
    const id = p.closest('.nd-card')?.dataset.id;
    if (!id) return;
    e.preventDefault(); e.stopPropagation();
    link = { id, dir: p.dataset.tport, t: p.dataset.t };
    const a = portXY(id, link.dir, link.t);
    const mv = (ev) => { const q = toWorld(ev.clientX, ev.clientY); temp.setAttribute('d', link.dir === 'out' ? curve(a, q) : curve(q, a)); };
    const up = (ev) => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      temp.setAttribute('d', '');
      const L = link;
      link = null;
      const tgt = document.elementFromPoint(ev.clientX, ev.clientY);
      const tp = tgt?.closest?.('[data-tport]'), other = tp?.closest('.nd-card')?.dataset.id;
      if (tp && other && other !== L.id) {
        if (tp.dataset.t !== L.t) { toast(`un câble de ${PORT_FR[L.t]} se branche sur un port de ${PORT_FR[L.t]}`); return; }
        if (tp.dataset.tport === L.dir) { toast(L.dir === 'out' ? 'une sortie se branche sur une entrée' : 'une entrée reçoit une sortie'); return; }
        const [ia, ib] = L.dir === 'out' ? [L.id, other] : [other, L.id];
        connect(ia, ib, L.t, null, ev.clientX, ev.clientY);
        return;
      }
      if (!tgt?.closest?.('.nd-card') && L.dir === 'out' && nodal.cv.contains(tgt)) {
        const [wx, wy] = toWorld(ev.clientX, ev.clientY);
        voidMenu(L, ev.clientX, ev.clientY, wx, wy);
      }
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }

  // les règles d'un câble typé ; null si le câble est permis
  function canConnect(a, b, t, k) {
    const A = app.mod(a), B = app.mod(b);
    if (!A || !B || a === b) return 'même module';
    if (!accepts(A, 'out', t)) return `${MODULES[A.type].name} n'émet pas de ${PORT_FR[t]}`;
    if (!accepts(B, 'in', t)) return `${MODULES[B.type].name} ne reçoit pas de ${PORT_FR[t]}`;
    if (t === 'mod' && !modTargets(B).includes(k)) return 'réglage inconnu';
    if (S.proj.cables.some((c) => c.a === a && c.b === b && c.t === t && (t !== 'mod' || c.k === k))) return 'ce câble existe déjà';
    // une boucle de notes (ou de valeurs) tournerait sans fin
    const stack = [b], seen = new Set();
    while (stack.length) {
      const n = stack.pop();
      if (n === a) return `ce câble ferait une boucle : les ${PORT_FR[t]} tourneraient sans fin`;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const c of S.proj.cables) if (c.a === n && c.t === t) stack.push(c.b);
    }
    return null;
  }
  function connect(a, b, t, k, cx, cy) {
    if (t === 'mod' && !k) {
      const B = app.mod(b), ks = modTargets(B);
      if (!ks.length) { toast(`${MODULES[B.type].name} n'a pas de réglage à piloter`); return false; }
      if (ks.length === 1) return connect(a, b, t, ks[0]);
      menu(cx ?? innerWidth / 2, cy ?? innerHeight / 2, [{ head: `${MODULES[app.mod(a).type].modOut || 'la valeur'} règle…` },
        ...ks.map((kk) => ({ label: spec(B.type, kk).label, sub: MODULES[B.type].name, onclick: () => connect(a, b, t, kk) }))]);
      return false;
    }
    const why = canConnect(a, b, t, k);
    if (why) { toast(why); return false; }
    S.proj.cables.push(t === 'mod' ? { a, b, t, k } : { a, b, t });
    app.commit('graph');
    return true;
  }
  // un câble de notes lâché dans le vide : un instrument neuf, ou un jouet
  function voidMenu(L, cx, cy, wx, wy) {
    const items = [];
    if (L.t === 'notes') {
      items.push({ head: 'jouer les notes sur…' });
      for (const [k, list] of Object.entries(SOURCES_OF)) {
        if (!TRACK_KINDS[k]?.pattern) continue;
        for (const type of list) items.push({ label: `${TRACK_KINDS[k].label} · ${MODULES[type].name}`, sub: MODULES[type].kind, dot: MODULES[type].color, onclick: () => {
          const t = app.addTrack(k, { type });
          const s = app.mod(t.src), st = app.mod(t.strip);
          s.x = Math.round(wx); s.y = Math.round(wy); st.x = s.x + 320; st.y = s.y;
          S.proj.cables.push({ a: L.id, b: s.id, t: 'notes' });
          app.commit('graph');
        } });
      }
      items.push('-');
    }
    items.push({ head: `un jouet qui reçoit des ${PORT_FR[L.t]}` });
    for (const type of JOUET_TYPES) {
      const probe = { type, params: {} };
      if (!accepts(probe, 'in', L.t)) continue;
      items.push({ label: MODULES[type].name, sub: MODULES[type].kind, dot: MODULES[type].color, onclick: () => {
        const m = addToy(type, wx, wy - 30, true);
        connect(L.id, m.id, L.t, null, cx, cy);
        app.commit('graph');
      } });
    }
    menu(cx, cy, items);
  }

  // la bibliothèque : la section « jouets » du menu des modules
  function menuItems(wx, wy) {
    return ['-', { head: 'jouets · le Playground de Cal' },
      ...JOUET_TYPES.map((type) => ({ label: MODULES[type].name, sub: MODULES[type].kind, dot: MODULES[type].color, onclick: () => addToy(type, wx, wy) }))];
  }
  function addToy(type, wx, wy, quiet = false) {
    const m = { id: app.uid('m'), type, track: null, x: Math.round(wx), y: Math.round(wy), on: true, params: {} };
    S.proj.modules.push(m);
    S.sel.mod = m.id; S.sel.cable = null;
    if (!quiet) app.commit('graph');
    wake();
    return m;
  }
  // retirer un jouet sans son (les quatre qu'on traverse passent par
  // app.removeModule, qui referme leurs câbles audio)
  function remove(id) {
    const m = app.mod(id);
    if (!m || !isToy(m) || MODULES[m.type].role === 'effect') return false;
    const P = S.proj;
    P.cables = P.cables.filter((c) => c.a !== id && c.b !== id);
    P.modules = P.modules.filter((x) => x.id !== id);
    if (S.sel.mod === id) S.sel.mod = null;
    app.commit('graph');
    return true;
  }
  function duplicate(m) {
    const c = { ...m, id: app.uid('m'), x: m.x + 40, y: m.y + 40, params: { ...m.params } };
    S.proj.modules.push(c); S.sel.mod = c.id;
    app.commit('graph');
  }

  // le panneau de droite : ce que le jouet reçoit et émet, son geste
  function side(m) {
    const def = MODULES[m.type];
    const list = (dir) => {
      const ps = [...(def.jouet ? (dir === 'in' ? def.ins : def.outs).filter((t) => t === 'audio') : []), ...portsOf(m).filter((p) => p.dir === dir).map((p) => p.t)];
      return ps.map((t) => PORT_FR[t]).join(', ') || 'rien';
    };
    const cables = S.proj.cables.filter((c) => c.t && (c.a === m.id || c.b === m.id)).length;
    if (!def.jouet) {
      if (!portsOf(m).length) return [];
      return [el('div', { class: 'pan jo-side' }, el('p', { class: 'lbl' }, `reçoit aussi : ${list('in')} — un jouet s'y branche par ses ports losange (notes) et carré (valeur)`))];
    }
    return [el('div', { class: 'pan jo-side', style: { '--k': `var(--${def.color})` } },
      el('p', {}, def.hint),
      el('p', { class: 'lbl' }, `reçoit : ${list('in')} · émet : ${list('out')}${def.modOut ? ` (la valeur : ${def.modOut})` : ''} · ${cables} câble${cables > 1 ? 's' : ''} de notes ou de valeur`),
      def.role === 'jouet' ? el('div', { class: 'row' },
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => duplicate(m) }, 'Dupliquer'),
        el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => remove(m.id) }, 'Retirer')) : null)];
  }

  // NAVETTE : les flèches, tant qu'on la survole (keys du Playground)
  addEventListener('keydown', (e) => {
    if (e.key.indexOf('Arrow') !== 0) return;
    let used = false;
    for (const j of inst.values()) if (j.type === 'inv' && j.S.hov) { j.S.keys[e.key] = true; used = true; }
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  addEventListener('keyup', (e) => { for (const j of inst.values()) if (j.type === 'inv') j.S.keys[e.key] = false; });

  const api = {
    wake, attach, decorate, wires, width, side, remove, menu: menuItems, add: addToy, connect, canConnect,
    // pour les essais (tools : essais de page) : l'état des jouets posés
    get running() { return !!raf; },
    inst, rt, stats: () => ({ sent: rt.sent || 0, late: rt.late ?? null, notes: note.count || 0, bySrc: { ...(rt.bySrc || {}) }, toys: inst.size, loop: !!raf }),
  };
  return api;
}
