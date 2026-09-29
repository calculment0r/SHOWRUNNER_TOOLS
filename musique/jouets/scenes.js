// JOUETS — l'intérieur des quatorze jouets du « ODIO-O1 Playground » de Cal :
// leur physique, leur dessin sur <canvas>, leurs gestes. Porté de son code
// (`~/showrunner-refs/odio-o1-playground/code.jsx`, la classe `Component`)
// sans rien redessiner : chaque corps de fonction est celui du Playground,
// coupé par jouet. Ce qui change est marqué `SHOWRUNNER :` ; la liste et les
// raisons sont dans musique/PROVENANCE.md.
//
// Conventions du portage :
//   · `this` est le jouet posé (index.js, classe Jeu), qui hérite des aides
//     du Playground (classe Scene ci-dessous) ;
//   · `S` est l'objet que le Playground appelait `this.sim` : `S[type]` est
//     l'état de CE jouet, `S.fx` les anneaux d'impact de la fontaine ;
//   · `P` est la liste des réglages (vals) ; `this.play`, `this.bpm` sont le
//     transport de la DAW (le Playground avait son propre bouton lecture) ;
//   · `this.out(note, vélocité)` émet une note par la sortie « notes ».

import { NOTES, SCALES } from './defs.js';

// ── la palette du Playground (themes.dark), lue dans les jetons ────────
// (jouets.css) : aucune couleur n'est écrite dans ce fichier.
const KEYS = ['room', 'face', 'ink', 'mut', 'dim', 'line', 'rule', 'tick', 'tick2', 'well', 'acc', 'acc2', 'grn'];
export function palette(read) {
  const C = {};
  for (const k of KEYS) C[k] = read(`jo-${k}`);
  C.note = NOTES.map((_, pc) => read(`jo-note-${pc}`));
  C.onAcc = read('jo-sur-acc');
  C.pain = read('jo-pain');
  C.brule = read('jo-brule');
  C.font = read('jo-police');
  return C;
}
const hex = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };

// ── les aides du Playground, telles quelles ─────────────────────────────
export class Scene {
  NOTES = NOTES;
  SCALES = SCALES;
  NEWT_PC = [0, 9, 7, 11, 2, 4, 5];
  SIDES(pc) { return 3 + ((((pc % 12) + 12) % 12) % 5); }
  clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  // SHOWRUNNER : les teintes 'hsl(' + (38 + ((pc * 7) % 12) * 26) + ' 66% 56%)'
  // sont les douze jetons --jo-note-0 … --jo-note-11, les mêmes chaînes
  noteCol(pc) { return this.C.note[((pc % 12) + 12) % 12]; }
  // SHOWRUNNER : 'rgba(255,196,0,' + a + ')' devient this.rgba(C.acc, a) — la
  // même couleur, lue dans son jeton
  rgba(h, a) { const [r, g, b] = hex(h); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; }
  noteSize(pc) { return 1.22 - ((pc * 7) % 12) / 12 * .62; }
  flipPivot(side) { return [.5 + side * .24, .78]; }
  flipTip(u, pr, side, AR) {
    const p = this.flipPivot(side), L = .22;
    const a = (32 - pr * 62) * Math.PI / 180;
    return [p[0] - side * Math.cos(a) * L, p[1] + Math.sin(a) * L * AR];
  }
  bubble(x, px, py, txt, a, C, big) {
    const fs = big ? 15 : 13;
    x.font = '600 ' + fs + 'px ' + C.font;
    const tw2 = x.measureText(txt).width, rw2 = tw2 / 2 + 13, rh2 = fs / 2 + 11;
    x.save();
    x.globalAlpha = Math.max(0, Math.min(1, a));
    x.beginPath();
    for (let i = 0; i < 16; i++) {
      const an = i * 6.2832 / 16, sp = i % 2 ? .66 : 1;
      const qx = px + Math.cos(an) * rw2 * sp, qy = py + Math.sin(an) * rh2 * sp;
      i ? x.lineTo(qx, qy) : x.moveTo(qx, qy);
    }
    x.closePath();
    x.fillStyle = C.well; x.fill();
    x.strokeStyle = C.acc; x.stroke();
    x.fillStyle = C.acc;
    x.textAlign = 'center';
    x.fillText(txt, px, py + fs * .36);
    x.textAlign = 'left';
    x.restore();
  }
  ro(x, txt, sub, C, right) {
    x.font = '13px ' + C.font;
    const w1 = x.measureText(txt).width;
    x.font = '11px ' + C.font;
    const w2 = sub ? x.measureText(sub).width : 0;
    const pw = Math.max(w1, w2) + 16, ph = sub ? 38 : 24;
    const px = right ? right - pw : 8;
    x.fillStyle = C.well; x.globalAlpha = .82; x.fillRect(px, 8, pw, ph); x.globalAlpha = 1;
    x.strokeStyle = C.rule; x.strokeRect(px, 8, pw, ph);
    x.font = '13px ' + C.font;
    x.fillStyle = C.ink; x.fillText(txt, px + 8, 25);
    if (sub) { x.font = '11px ' + C.font; x.fillStyle = C.dim; x.fillText(sub, px + 8, 40); }
  }
  seg(x, a, b, c, d) { x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke(); }
  circ(x, a, b, r, fill) { x.beginPath(); x.arc(a, b, Math.max(.4, r), 0, 6.2832); if (fill) x.fill(); else x.stroke(); }
  poly(x, cx, cy, r, sides, rot, fill) {
    x.beginPath();
    if (sides > 7) { x.arc(cx, cy, r, 0, 6.2832); } else {
      for (let i = 0; i < sides; i++) { const a = rot + i * 6.2832 / sides - 1.5708; const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; i ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.closePath();
    }
    if (fill) x.fill(); else x.stroke();
  }
  pegs() {
    if (!this._pegs) {
      const out = [];
      for (let r = 0; r < 5; r++) {
        const y = .18 + r * .12, cnt = 7 + (r % 2);
        for (let i = 0; i < cnt; i++) out.push({ x: .1 + (i + (r % 2 ? .5 : 0)) * .8 / 7, y });
      }
      this._pegs = out;
    }
    return this._pegs;
  }
  // SHOWRUNNER : le Playground lisait la tonique et la gamme de NINJA ; ici
  // chaque jouet a les siennes (mêmes défauts : do, pentatonique)
  targetNotes() {
    const root = Math.round(this.V('ninja', 'root')), sc = this.SCALES[Math.round(this.V('ninja', 'scale'))].d;
    return [0, 2, 4].map((k) => (root + sc[k % sc.length]) % 12);
  }

  // ── les gestes du Playground qui fabriquent quelque chose ──
  // SHOWRUNNER : this.sim.fount → this.S (la fontaine qui tire) ; la force est
  // lue comme le Playground la lisait, sans le mélange en cours (state.vals)
  newBall(x, y) {
    const a = -1.5708 + (Math.random() - .5) * .9;
    const Fs = this.S;
    if (Fs) { Fs.aim = a; Fs.recoil = 1; for (let i = 0; i < 4; i++) Fs.smoke.push({ x: (Math.random() - .5) * 16, y: 0, vy: -18 - Math.random() * 20, a: 1 }); }
    const F = this.base('force') || 62;
    const sp = (200 + F * 9) * (.88 + Math.random() * .24);
    return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 7, live: false, fuse: 0 };
  }
  fireMsl() {
    const IV = this.S;
    if (IV.mn <= 0 || IV.mpc == null || IV.mfire > 0) return;
    IV.mfire = 1;
    IV.mn -= 1;
    const y0 = (IV.shipY == null ? .82 : IV.shipY) - .03;
    IV.msls.push({ x: IV.ship, y: y0, vx: 0, vy: -.5, pc: IV.mpc, trail: [] });
    if (IV.mn === 0) IV.mpc = null;
  }
  fireIV() {
    const IV = this.S;
    if (IV.fire > 0) return;
    IV.fire = 1;
    const y0 = (IV.shipY == null ? .82 : IV.shipY) - .03;
    const sp = 1.15;
    const lvl = IV.x3;
    const n = lvl >= 2 ? 6 : lvl === 1 ? 3 : 1;
    const spread = lvl >= 2 ? 30 : lvl === 1 ? 15 : 0;
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : (-spread / 2 + spread * i / (n - 1)) * Math.PI / 180;
      IV.shots.push({ x: IV.ship, y: y0, vx: Math.sin(a) * sp, vy: -Math.cos(a) * sp });
    }
  }
  slash(N, a, b) {
    const hit = [];
    N.sh.forEach((s) => {
      if (s.dead) return;
      const d = Math.abs((b.x - a.x) * (a.y - s.y) - (a.x - s.x) * (b.y - a.y)) / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
      const near = Math.hypot((a.x + b.x) / 2 - s.x, (a.y + b.y) / 2 - s.y);
      if (d < s.r * 1.1 && near < s.r * 2.6) { s.dead = true; hit.push(s); }
    });
    if (!hit.length) return;
    const now = performance.now();
    hit.forEach((s) => {
      for (let i = 0; i < 2; i++) N.frag.push({ pc: s.pc, x: s.x, y: s.y, vx: (i ? 1 : -1) * .22 + (Math.random() - .5) * .1, vy: -.1, rot: 0, rv: (i ? 1 : -1) * 4, sides: s.sides, r: s.r * .8, a: 1, half: i });
      N.cuts.push({ x: s.x, y: s.y, note: s.note, a: 1 });
      this.out(s.pc, .85);   // SHOWRUNNER : la forme tranchée joue sa note
    });
    if (N.lastCut && now - N.lastCut < 300 && hit.length + (N.lastHits || 0) >= 2) {
      const s = hit[0];
      for (let i = 0; i < 3; i++) N.harm.push({ x: s.x, y: s.y, r: 3 + i * 2, a: 1, i, note: s.note });
      this.out(s.pc + 12, .7);   // SHOWRUNNER : le combo ajoute l'harmonique (l'octave, comme ODIO_01)
    } else if (hit.length >= 2) {
      const s = hit[0];
      for (let i = 0; i < 3; i++) N.harm.push({ x: s.x, y: s.y, r: 3 + i * 2, a: 1, i, note: s.note });
      this.out(s.pc + 12, .7);
    }
    N.lastCut = now; N.lastHits = hit.length;
  }
}

// SHOWRUNNER : les cibles du FLIPPER et ses lance-billes portent un état
// (flash, down) ; le Playground les avait une fois pour toutes, ici chaque
// flipper posé a les siens (index.js les copie)
export const PINS = [
  { k: 'bump', x: .5, y: .27, r: .052, pc: 9 },
  { k: 'bump', x: .34, y: .4, r: .046, pc: 9 },
  { k: 'bump', x: .66, y: .4, r: .046, pc: 9 },
  { k: 'drop', x: .42, y: .58, r: .05, pc: 0 },
  { k: 'drop', x: .58, y: .58, r: .05, pc: 0 },
  { k: 'lane', x: .16, y: .1, r: .05, pc: 7 },
  { k: 'lane', x: .84, y: .1, r: .05, pc: 2 },
];
export const SLING = [{ x0: .3, y0: .5, x1: .38, y1: .62, pc: 11 }, { x0: .7, y0: .5, x1: .62, y1: .62, pc: 11 }];

// ═════════════════════════════════════════════════════════════════════
// les jouets : init (l'état de initSim), phys (la part de phys()), draw
// (d_<id>), down / move / up (les branches de cvDown), trigger (SHOWRUNNER :
// ce que fait une note reçue), modOut (SHOWRUNNER : la valeur émise, 0..1)
// ═════════════════════════════════════════════════════════════════════
export const SCENES = {};

// ── 00 · SHUFFLE FOUNTAIN ──────────────────────────────────────────────
SCENES.fount = {
  init() { return { balls: [], t: 0, parts: [], smoke: [], aim: -1.5708, recoil: 0 }; },
  phys(S, dt) {
    const play = this.play, P = () => this.vals();
    // SHOWRUNNER : fb = le coin du bloc tel que le Playground le plaçait
    // autour de la scène (index.js), fbk = sa taille ; les billes vivent dans
    // le monde du nodal et rebondissent sur le haut de TOUTES ses cartes
    const FP = P('fount'), fb = this.pos(), fbk = this.def;
    S.fount.t += dt;
    if (play && FP.rate > 2 && S.fount.t > 3.2 - FP.rate / 40) {
      S.fount.t = 0;
      S.fount.balls.push(this.newBall(fb.x + fbk.w * .5, fb.y + fbk.h * .78));
    }
    const cards = this.rt.rects(this);
    S.fount.balls.forEach((o) => {
      o.vy += 620 * dt;
      o.x += o.vx * dt; o.y += o.vy * dt;
      cards.forEach((bk) => {
        const q = bk;
        if (o.x > q.x && o.x < q.x + bk.w && o.y > q.y - 4 && o.y < q.y + 18 && o.vy > 0) {
          o.y = q.y - 4; o.vy = -o.vy * .62; o.vx += (Math.random() - .5) * 40;
          if (!o.live) { o.live = true; this.rt.shuffle(bk.id, this); S.fx.push({ x: o.x, y: o.y, a: 1 }); }
        }
      });
      if (o.live) {
        o.fuse += dt;
        if (o.fuse > 2.1) {
          o.dead = true;
          const n2 = 20 + Math.floor(Math.random() * 10);
          for (let i = 0; i < n2; i++) {
            const a = Math.random() * 6.2832, sp = 90 + Math.random() * 300;
            S.fount.parts.push({ x: o.x, y: o.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, a: 1, hot: Math.random() < .45 });
          }
          this.out(Math.round(this.V('fount', 'note')), .9);   // SHOWRUNNER : l'explosion est une note
        }
      }
      if (o.y > fb.y + 3000) o.dead = true;   // SHOWRUNNER : 2400 dans le monde du Playground, dont la fontaine est à −600
    });
    S.fount.balls = S.fount.balls.filter((o) => !o.dead).slice(-40);
    S.fount.recoil = Math.max(0, (S.fount.recoil || 0) - dt * 3.2);
    S.fount.smoke.forEach((p2) => { p2.y += p2.vy * dt; p2.x += dt * 6; p2.a -= dt * 1.1; });
    S.fount.smoke = S.fount.smoke.filter((p2) => p2.a > 0).slice(-14);
    S.fount.parts.forEach((p2) => { p2.vy += 420 * dt; p2.x += p2.vx * dt; p2.y += p2.vy * dt; p2.a -= dt * 1.9; });
    S.fount.parts = S.fount.parts.filter((p2) => p2.a > 0).slice(-260);
    // SHOWRUNNER : les anneaux S.fx sont communs à toutes les fontaines : index.js les fait passer, une fois par image
  },
  draw(x, w, h, P, S, C) {
    const U = Math.min(w / 340, h / 340);
    const aim = S.aim == null ? -1.5708 : S.aim;
    const rec = S.recoil || 0;
    const F = P.force / 100;
    x.save();
    x.translate(w / 2, h - 26 * U);
    x.scale(U, U);
    x.lineWidth = 1 / U;

    x.strokeStyle = C.tick;
    this.seg(x, -160, 0, 160, 0);
    for (let i = 0; i < 17; i++) this.seg(x, -158 + i * 20, 0, -152 + i * 20, 9);

    x.save();
    x.translate(0, -30);
    x.rotate(aim + 1.5708);
    x.translate(0, rec * 14);
    const L = 118 + F * 42, Rb = 26, Rm = 19;
    x.strokeStyle = C.tick2;
    x.beginPath();
    x.moveTo(-Rb, 0);
    x.lineTo(-Rm, -L * .86);
    x.lineTo(-Rm - 6, -L * .88);
    x.lineTo(-Rm - 6, -L);
    x.lineTo(Rm + 6, -L);
    x.lineTo(Rm + 6, -L * .88);
    x.lineTo(Rm, -L * .86);
    x.lineTo(Rb, 0);
    x.closePath();
    x.stroke();
    [.24, .5, .74].forEach((u) => {
      const rw = Rb + (Rm - Rb) * u;
      x.strokeStyle = C.tick;
      x.strokeRect(-rw - 3, -L * .86 * u - 5, (rw + 3) * 2, 10);
    });
    x.strokeStyle = C.tick2;
    this.circ(x, 0, -6, Rb * .55);
    x.strokeStyle = C.acc;
    this.seg(x, -Rm - 6, -L, Rm + 6, -L);
    if (rec > .05) {
      x.strokeStyle = this.rgba(C.acc, rec.toFixed(2));
      this.circ(x, 0, -L - 10, 10 + (1 - rec) * 40);
      x.strokeStyle = this.rgba(C.acc2, (rec * .8).toFixed(2));
      for (let i = 0; i < 6; i++) { const a2 = -1.5708 + (i - 2.5) * .3; this.seg(x, Math.cos(a2) * (Rm + 8), -L + Math.sin(a2) * 8, Math.cos(a2) * (Rm + 34 * rec), -L + Math.sin(a2) * 34 * rec); }
    }
    (S.smoke || []).forEach((p2) => {
      x.strokeStyle = this.rgba(C.mut, (p2.a * .45).toFixed(2));
      this.circ(x, p2.x * 1.5, -L - 12 + p2.y * 1.6, 5 + (1 - p2.a) * 26);
    });
    x.restore();

    x.strokeStyle = C.tick2;
    x.beginPath();
    x.moveTo(-58, 0); x.lineTo(-40, -40); x.lineTo(40, -40); x.lineTo(58, 0); x.closePath();
    x.stroke();
    x.strokeStyle = C.tick;
    this.seg(x, -40, -40, 40, 0); this.seg(x, 40, -40, -40, 0);
    [-42, 42].forEach((d) => {
      x.strokeStyle = C.tick2;
      this.circ(x, d, -13, 13);
      this.circ(x, d, -13, 4);
      for (let i = 0; i < 6; i++) { const a2 = i * 1.047 + (S.recoil || 0) * 2; this.seg(x, d + Math.cos(a2) * 4, -13 + Math.sin(a2) * 4, d + Math.cos(a2) * 13, -13 + Math.sin(a2) * 13); }
    });
    x.strokeStyle = C.acc2;
    const el = 26 + F * 16;
    this.seg(x, 18, -30, 18, -30 - el);
    this.circ(x, 18, -30 - el - 4, 4);

    const hx = 118, hy = -18;
    x.strokeStyle = C.tick2;
    x.beginPath();
    x.moveTo(hx - 34, hy - 48); x.lineTo(hx + 34, hy - 48); x.lineTo(hx + 12, hy); x.lineTo(hx - 12, hy); x.closePath();
    x.stroke();
    x.strokeStyle = C.tick;
    x.beginPath();
    x.moveTo(hx - 12, hy - 2); x.quadraticCurveTo(hx - 46, hy + 4, 56, -12);
    x.stroke();
    S.balls.slice(-6).forEach((b, i) => {
      x.fillStyle = b.live ? C.acc : C.tick;
      this.circ(x, hx - 20 + (i % 3) * 20, hy - 38 + Math.floor(i / 3) * 18, 7, 1);
    });
    x.restore();
    x.lineWidth = 1;

    const armed = S.balls.filter((b) => b.live).length;
    const keys = this.rt.shufKeys();   // SHOWRUNNER : Object.keys(this.sim.shuf) — les cartes en cours de mélange
    this.ro(x, keys.length ? keys.length + ' bloc mélangé' : (armed ? armed + ' bille armée' : 'chargé'), 'force ' + Math.round(P.force) + ' % · angle ' + Math.round((aim + 1.5708) * 57.3) + '°', C, w - 8);
    if (keys.length) {
      x.font = '11px ' + C.font;
      x.fillStyle = C.acc2;
      x.fillText(keys.join(' · '), 10, 22);
    }
  },
  down(S) {
    const b = this.def, pos = this.pos();
    S.fount.balls.push(this.newBall(pos.x + b.w * .5, pos.y + b.h * .78));
  },
  trigger() { const b = this.def, pos = this.pos(); this.S.balls.push(this.newBall(pos.x + b.w * .5, pos.y + b.h * .78)); },
};

// ── 01 · REEL–2 ─────────────────────────────────────────────────────────
SCENES.reel = {
  init() { return { a: 0, fill: .58, scrub: 0, count: 0 }; },
  phys(S, dt) {
    const play = this.play, P = () => this.vals();
    const rp = P('reel');
    S.reel.a += dt * ((play ? .5 + rp.speed / 40 : 0) + S.reel.scrub);
    S.reel.count = (S.reel.count + Math.abs(dt * (play ? .5 + rp.speed / 40 : 0) + S.reel.scrub) * 34) % 10000;
    S.reel.scrub *= .9;
  },
  draw(x, w, h, P, S, C) {
    const cy = h * .42, rr = Math.min(h * .3, w * .17);
    const rad = [rr * (.36 + S.fill * .6), rr * (.36 + (1 - S.fill) * .6)];
    const cxs = [w * .24, w * .76];
    cxs.forEach((cx, i) => {
      x.strokeStyle = C.rule; this.circ(x, cx, cy, rr + 6);
      x.fillStyle = this.rgba(C.acc, '.07'); this.circ(x, cx, cy, rad[i], 1);
      x.strokeStyle = C.acc; this.circ(x, cx, cy, rad[i]);
      x.strokeStyle = C.tick;
      for (let s = 0; s < 3; s++) {
        const a = S.a * (i ? -1 : 1) + s * 2.094;
        this.seg(x, cx + Math.cos(a) * rr * .22, cy + Math.sin(a) * rr * .22, cx + Math.cos(a) * rad[i], cy + Math.sin(a) * rad[i]);
      }
      x.strokeStyle = C.tick2; this.circ(x, cx, cy, rr * .22);
      x.fillStyle = C.acc2;
      const a2 = S.a * (i ? -1 : 1);
      this.circ(x, cx + Math.cos(a2) * rr * .12, cy + Math.sin(a2) * rr * .12, 2.4, 1);
    });
    const ty = cy + rr + 26, wow = Math.sin(S.a * 3.1) * (P.wow / 100) * 3;
    x.strokeStyle = C.tick2;
    x.beginPath();
    x.moveTo(cxs[0], cy + rad[0]);
    x.lineTo(w * .34, ty + wow);
    x.lineTo(w * .66, ty - wow);
    x.lineTo(cxs[1], cy + rad[1]);
    x.stroke();
    [w * .34, w * .66].forEach((px) => { x.strokeStyle = C.tick; this.circ(x, px, ty, 5); x.fillStyle = C.tick2; this.circ(x, px, ty, 1.6, 1); });
    ['e', 'r', 'p'].forEach((lb, i) => {
      const hx = w * (.42 + i * .08);
      x.strokeStyle = C.tick2;
      x.strokeRect(hx - 7, ty - 16, 14, 12);
      x.fillStyle = i === 2 ? C.acc : C.tick;
      x.fillRect(hx - 5, ty - 8, 10, 3);
      x.font = '11px ' + C.font;
      x.fillStyle = C.dim;
      x.fillText(lb, hx - 3, ty - 22);
    });
    const capx = w * .58, capy = ty + 18;
    x.strokeStyle = C.tick2; this.circ(x, capx, capy, 9);
    x.strokeStyle = C.acc;
    this.seg(x, capx, capy, capx + Math.cos(S.a * 4) * 8, capy + Math.sin(S.a * 4) * 8);
    x.strokeStyle = C.tick; this.circ(x, capx + 15, capy, 6);
    const cs = String(Math.floor(S.count)).padStart(4, '0');
    x.fillStyle = C.well; x.globalAlpha = .85; x.fillRect(w - 70, 8, 62, 26); x.globalAlpha = 1;
    x.strokeStyle = C.rule; x.strokeRect(w - 70, 8, 62, 26);
    x.font = '15px ' + C.font;
    x.fillStyle = C.acc;
    x.fillText(cs, w - 62, 26);
    this.ro(x, Math.round(S.fill * 100) + ' % → ' + Math.round((1 - S.fill) * 100) + ' %', 'feedback ' + Math.round(P.fdb) + ' %', C);
  },
  down(S, n) { S.reel.drag = n.x; },
  move(S, m) { const d = m.x - (S.reel.drag == null ? m.x : S.reel.drag); S.reel.scrub = d * 26; S.reel.fill = this.clamp(S.reel.fill - d * .5, .08, .92); S.reel.drag = m.x; },
  up(S) { S.reel.drag = null; },
  modOut(S) { return (S.fill - .08) / .84; },
};

// ── 02 · ALCHIMIE ───────────────────────────────────────────────────────
SCENES.alch = {
  // SHOWRUNNER : le liquide part du niveau enregistré (le Playground : .72, son défaut)
  init() { return { cur: this.V('alch', 'level') / 100, tilt: 0, ph: 0, bub: [] }; },
  phys(S, dt) {
    const P = () => this.vals();
    const ap = P('alch'), tgt = this.V('alch', 'level') / 100;
    const before = S.alch.cur;
    S.alch.cur += (tgt - S.alch.cur) * Math.min(1, dt * (.5 + (1 - ap.visc / 100) * 3) * 3);
    S.alch.tilt += (((before - S.alch.cur) * 40) - S.alch.tilt) * Math.min(1, dt * 6);
    S.alch.ph += dt * (1.2 + (1 - ap.visc / 100) * 2.4);
    if (Math.random() < dt * 6 * (1 - ap.visc / 200)) S.alch.bub.push({ x: .3 + Math.random() * .4, y: 1, r: .8 + Math.random() * 1.8 });
    S.alch.bub = S.alch.bub.filter((b) => { b.y -= dt * (.25 + b.r * .1); return b.y > 1 - S.alch.cur; });
  },
  draw(x, w, h, P, S, C) {
    const U = Math.min(w / 320, h / 300);
    x.save();
    x.translate(w / 2, h / 2 + 118 * U);
    x.scale(U, U);
    x.rotate(S.tilt * .012);
    const FW = 108, FH = 236;
    const flask = () => {
      x.beginPath();
      x.moveTo(-22, -FH);
      x.lineTo(-22, -FH * .58);
      x.lineTo(-FW, -18);
      x.quadraticCurveTo(-FW, 0, -FW * .78, 0);
      x.lineTo(FW * .78, 0);
      x.quadraticCurveTo(FW, 0, FW, -18);
      x.lineTo(22, -FH * .58);
      x.lineTo(22, -FH);
      x.closePath();
    };
    x.lineWidth = 1 / U;
    x.strokeStyle = C.tick2;
    flask(); x.stroke();
    const H = FH * .74, lv = S.cur * H;
    x.save();
    flask(); x.clip();
    x.fillStyle = C.grn; x.globalAlpha = .18;
    x.beginPath();
    x.moveTo(-FW - 10, -lv);
    for (let i = 0; i <= 26; i++) { const u = i / 26; x.lineTo(-FW - 10 + u * (FW * 2 + 20), -lv + Math.sin(u * 7 + S.ph * 2.2) * (2.4 + Math.abs(S.tilt) * .5)); }
    x.lineTo(FW + 10, 6); x.lineTo(-FW - 10, 6); x.closePath(); x.fill();
    x.globalAlpha = 1;
    x.strokeStyle = C.grn;
    x.beginPath();
    for (let i = 0; i <= 26; i++) { const u = i / 26, px = -FW - 10 + u * (FW * 2 + 20), py = -lv + Math.sin(u * 7 + S.ph * 2.2) * (2.4 + Math.abs(S.tilt) * .5); i ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.stroke();
    x.fillStyle = C.grn;
    S.bub.forEach((b) => this.circ(x, -FW * .5 + b.x * FW, -(1 - b.y) * H, b.r, 1));
    x.restore();
    x.strokeStyle = C.tick;
    for (let i = 1; i < 5; i++) { const y = -H * i / 5; this.seg(x, FW * .5, y, FW * .66, y); }
    x.restore();
    x.lineWidth = 1;
    this.ro(x, Math.round(S.cur * 100) + ' ml', Math.abs(S.tilt) > 1 ? 'versement' : 'au repos', C);
  },
  down(S, n) { this.setV('level', (1 - n.y) * 100); },
  move(S, m) { this.setV('level', this.clamp(1 - m.y, 0, 1) * 100); },
  modOut(S) { return S.cur; },
};

// ── 03 · PING–PONG ──────────────────────────────────────────────────────
SCENES.pong = {
  init() { return { x: .3, y: .25, vx: .22, vy: 0, held: false, hits: [], flash: 0 }; },
  phys(S, dt) {
    const P = () => this.vals();
    const pp = P('pong'), o = S.pong;
    if (!o.held) {
      if (!o.rest) o.vy += pp.grav / 100 * dt * 2.4;
      o.vx += pp.spin / 100 * dt * .35;
      o.x += o.vx * dt; o.y += o.vy * dt;
      if (o.x < .03) { o.x = .03; o.vx = -o.vx * .9; }
      if (o.x > .97) { o.x = .97; o.vx = -o.vx * .9; }
      if (o.y > .88) {
        o.y = .88;
        const thr = Math.max(.06, pp.grav / 100 * 2.4 * dt * 3.4);
        if (Math.abs(o.vy) > thr) {
          o.vy = -o.vy * (pp.elast / 100);
          if (Math.abs(o.vy) > thr) {
            o.flash = 1; o.hits.push({ x: o.x, a: 1, v: Math.min(1, Math.abs(o.vy) * 2.2) }); if (o.hits.length > 40) o.hits.shift();
            this.out(Math.round(this.V('pong', 'note')), Math.min(1, Math.abs(o.vy) * 2.2));   // SHOWRUNNER : le trig, sa vélocité
          }
          else o.vy = 0;
        } else {
          o.vy = 0;
          o.vx *= Math.pow(.22, dt);
          if (Math.abs(o.vx) < .015) o.vx = 0;
          o.rest = true;
        }
      } else o.rest = false;
      if (o.y < .02) { o.y = .02; o.vy = Math.abs(o.vy) * .6; }
    }
    o.flash = Math.max(0, o.flash - dt * 3.4);
    o.hits.forEach((hh) => { hh.a -= dt * .55; });
    o.hits = o.hits.filter((hh) => hh.a > 0);
  },
  draw(x, w, h, P, S, C) {
    const fy = h * .88;
    x.strokeStyle = C.tick;
    this.seg(x, 0, fy + 8, w, fy + 8);
    for (let i = 0; i < 22; i++) this.seg(x, i * w / 22, fy + 8, i * w / 22 + 6, fy + 15);
    S.hits.forEach((hh) => {
      x.strokeStyle = this.rgba(C.acc2, hh.a.toFixed(2));
      this.circ(x, hh.x * w, fy + 8, (1 - hh.a) * 26 + 4);
      x.fillStyle = this.rgba(C.acc, hh.a.toFixed(2));
      x.fillRect(hh.x * w - 1, h - 18, 2, -hh.v * 14);
    });
    x.strokeStyle = C.rule;
    this.seg(x, 0, h - 18, w, h - 18);
    x.fillStyle = S.flash > .1 ? C.acc2 : C.acc;
    this.circ(x, S.x * w, S.y * h, 9, 1);
    // SHOWRUNNER : ici le Playground traçait un anneau à la couleur de TN[…],
    // une variable qui n'existe pas dans d_pong (« TN is not defined » à chaque
    // rebond, ce qui coupait aussi la suite de l'image) : la ligne est retirée
    x.strokeStyle = this.rgba(C.acc, '.25');
    this.seg(x, S.x * w, S.y * h + 9, S.x * w, fy + 8);
    this.ro(x, S.hits.length + ' trigs', 'hauteur ' + Math.round((1 - S.y / .88) * 100) + ' %', C);
  },
  down(S, n) { if (Math.hypot(n.x - S.pong.x, n.y - S.pong.y) < .18) { S.pong.held = true; S.pong.x = n.x; S.pong.y = n.y; S.pong.vx = 0; S.pong.vy = 0; } },
  move(S, m) { if (S.pong.held) { S.pong.x = this.clamp(m.x, .04, .96); S.pong.y = this.clamp(m.y, .04, .9); } },
  up(S, hist) {
    const t1 = hist[hist.length - 1];
    let ref = hist[0];
    for (let i = hist.length - 1; i >= 0; i--) { ref = hist[i]; if (t1.t - hist[i].t >= 70) break; }
    const dts = Math.max(.02, (t1.t - ref.t) / 1000);
    S.pong.vx = this.clamp((t1.x - ref.x) / dts * 1.3, -4.5, 4.5);
    S.pong.vy = this.clamp((t1.y - ref.y) / dts * 1.3, -4.5, 4.5);
    S.pong.held = false;
  },
  // une note reçue relance la balle vers le haut, d'autant plus fort qu'elle est appuyée
  trigger(ev) { const o = this.S; if (o.held) return; o.vy = -(.9 + (ev.v ?? .8) * .9); o.vx += (Math.random() - .5) * .3; o.rest = false; },
  modOut(S) { return this.clamp(1 - S.y / .88, 0, 1); },
};

// ── 04 · LANCE–PIERRE ───────────────────────────────────────────────────
SCENES.sling = {
  init() { return { px: 0, py: 0, held: false, balls: [], tx: .74, ty: .3, tvx: .17, tvy: .12, last: null, flash: 0 }; },
  phys(S, dt) {
    const P = () => this.vals();
    const sp2 = P('sling'), sl = S.sling;
    const ts = sp2.tspd / 100;
    sl.tx += sl.tvx * ts * dt * 1.6; sl.ty += sl.tvy * ts * dt * 1.9;
    if (sl.tx < -.08) { sl.tx = -.08; sl.tvx = Math.abs(sl.tvx); }
    if (sl.tx > 1.08) { sl.tx = 1.08; sl.tvx = -Math.abs(sl.tvx); }
    if (sl.ty < -.06) { sl.ty = -.06; sl.tvy = Math.abs(sl.tvy); }
    if (sl.ty > .56) { sl.ty = .56; sl.tvy = -Math.abs(sl.tvy); }
    sl.balls.forEach((bl) => {
      bl.x += bl.vx * dt; bl.y += bl.vy * dt;
      bl.t += dt;
      bl.ox = bl.x; bl.oy = bl.y;
      const AS = sl.ar || 1.4;
      const dt2 = Math.hypot((bl.x - sl.tx) * AS, bl.y - sl.ty);
      if (!bl.done && bl.pd != null && dt2 > bl.pd && bl.pd < .3) {
        bl.done = true; bl.dead = true;
        const d = bl.pd;
        const ring = d < .11 ? 2 : d < .2 ? 1 : 0;
        sl.last = { ring, t: 0 };
        sl.flash = 1;
        sl.marks = (sl.marks || []).concat([{ x: bl.ox, y: bl.oy, sx: bl.sx, sy: bl.sy, pc: this.targetNotes()[ring], a: 1 }]).slice(-4);
        this.out(this.targetNotes()[ring], [.6, .8, 1][ring]);   // SHOWRUNNER : l'anneau touché est la note
      }
      bl.pd = Math.hypot((bl.x - sl.tx) * AS, bl.y - sl.ty);
      if (bl.y > 1.1 || bl.y < -.1 || bl.x > 1.1 || bl.x < -.1 || bl.t > 6) bl.dead = true;
    });
    sl.balls = sl.balls.filter((bl) => !bl.dead).slice(-8);
    sl.flash = Math.max(0, sl.flash - dt * 2.6);
    (sl.marks || []).forEach((mk) => { mk.a -= dt * .5; });
    sl.marks = (sl.marks || []).filter((mk) => mk.a > 0);
    if (sl.last) sl.last.t += dt;
  },
  draw(x, w, h, P, S, C) {
    S.ar = w / h;
    const ax = w * .5, ay = h * .78;
    x.strokeStyle = C.tick;
    this.seg(x, 0, h - 12, w, h - 12);
    x.strokeStyle = C.tick2;
    this.seg(x, ax, h - 12, ax, ay + 6);
    this.seg(x, ax, ay + 6, ax - 22, ay - 22);
    this.seg(x, ax, ay + 6, ax + 22, ay - 22);
    const px = (S.held ? S.px : .5) * w, py = (S.held ? S.py : .7) * h;
    x.strokeStyle = C.acc;
    this.seg(x, ax - 22, ay - 22, px, py);
    this.seg(x, ax + 22, ay - 22, px, py);
    x.fillStyle = C.acc; this.circ(x, px, py, 8, 1);
    if (S.held) {
      const dxn = .5 - S.px, dyn = .78 - S.py, pw = Math.hypot(dxn, dyn);
      x.strokeStyle = this.rgba(C.acc, '.45');
      const nl2 = Math.hypot(dxn * w, dyn * h) || 1;
      x.setLineDash([4, 5]);
      this.seg(x, S.px * w, S.py * h, S.px * w + dxn * w / nl2 * 2000, S.py * h + dyn * h / nl2 * 2000);
      x.setLineDash([]);
      x.font = '11px ' + C.font;
      x.fillStyle = C.mut;
      const ang = Math.atan2(-dyn, dxn) * 57.3;
      x.fillText('angle ' + ang.toFixed(0) + '° · tension ' + Math.round(Math.min(1, pw / .42) * 100) + ' %', px + 14, py - 8);
    }
    const tx = S.tx * w, ty = S.ty * h;
    const TR = h;
    x.save();
    x.beginPath(); x.rect(0, 0, w, h); x.clip();
    const TN = this.targetNotes();
    [.3, .2, .11].forEach((r, i) => { x.strokeStyle = this.noteCol(TN[i]); x.lineWidth = i === 2 ? 1.8 : 1.2; this.circ(x, tx, ty, r * TR); });
    x.lineWidth = 1;
    x.strokeStyle = C.rule;
    this.seg(x, tx - .34 * TR, ty, tx + .34 * TR, ty); this.seg(x, tx, ty - .34 * TR, tx, ty + .34 * TR);
    x.font = '11px ' + C.font;
    x.textAlign = 'center';
    TN.forEach((pc, i) => { x.fillStyle = this.noteCol(pc); x.fillText(this.NOTES[pc], tx, ty - [.3, .2, .11][i] * TR + 14); });
    x.textAlign = 'left';
    x.restore();
    if (S.flash > .05) { x.strokeStyle = this.noteCol(TN[S.last ? S.last.ring : 2]); x.globalAlpha = S.flash; this.circ(x, tx, ty, .12 * TR + (1 - S.flash) * .3 * TR); x.globalAlpha = 1; }
    S.balls.forEach((bl) => {
      const ex = bl.x * w, ey = bl.y * h;
      const nl = Math.hypot(bl.vx * w, bl.vy * h) || 1;
      const ux = bl.vx * w / nl, uy = bl.vy * h / nl;
      x.strokeStyle = C.acc;
      this.seg(x, bl.sx * w, bl.sy * h, ex, ey);
      x.beginPath();
      x.moveTo(ex + ux * 9, ey + uy * 9);
      x.lineTo(ex - uy * 4.5, ey + ux * 4.5);
      x.lineTo(ex + uy * 4.5, ey - ux * 4.5);
      x.closePath();
      x.fillStyle = C.acc; x.fill();
    });
    (S.marks || []).forEach((mk) => {
      x.strokeStyle = this.rgba(C.acc, Math.max(0, mk.a).toFixed(2));
      this.seg(x, mk.sx * w, mk.sy * h, mk.x * w, mk.y * h);
      x.strokeStyle = this.noteCol(mk.pc);
      this.circ(x, mk.x * w, mk.y * h, 5);
    });
    const hit = S.last && S.last.t < 2.4;
    x.font = '13px ' + C.font;
    x.fillStyle = hit ? this.noteCol(TN[S.last.ring]) : C.ink;
    x.fillText(hit ? this.NOTES[TN[S.last.ring]] : 'prêt', 10, h - 42);
    x.font = '11px ' + C.font;
    x.fillStyle = C.dim;
    x.fillText('cible ' + Math.round(P.tspd) + ' %', 10, h - 27);
  },
  down(S, n) { S.sling.held = true; S.sling.px = n.x; S.sling.py = n.y; },
  move(S, m) { if (S.sling.held) { S.sling.px = this.clamp(m.x, .02, .98); S.sling.py = this.clamp(m.y, .02, .98); } },
  up(S) {
    if (!S.sling.held) return;
    const A = { x: .5, y: .78 }, dx = A.x - S.sling.px, dy = A.y - S.sling.py;
    const pw = Math.hypot(dx, dy);
    if (pw > .02) {
      const K = 3.5 + this.V('sling', 'band') / 100 * 7.5;
      S.sling.balls.push({ x: S.sling.px, y: S.sling.py, sx: S.sling.px, sy: S.sling.py, vx: dx * K, vy: dy * K, t: 0 });
    }
    S.sling.held = false;
  },
  // une note reçue tire : la boule tirée à l'opposé de la cible, du quart de la course
  trigger() {
    const sl = this.S;
    if (sl.held) return;
    const A = { x: .5, y: .78 }, ux = sl.tx - A.x, uy = sl.ty - A.y, L = Math.hypot(ux, uy) || 1;
    sl.held = true; sl.px = this.clamp(A.x - ux / L * .25, .02, .98); sl.py = this.clamp(A.y - uy / L * .25, .02, .98);
    SCENES.sling.up.call(this, this.Sx);
  },
};

// ── 05 · RESSORT ────────────────────────────────────────────────────────
SCENES.sprg = {
  init() { return { y: new Array(72).fill(0), v: new Array(72).fill(0), pick: -1 }; },
  phys(S) {
    const P = () => this.vals();
    const sg = S.sprg, spp = P('sprg'), n = sg.y.length;
    const c2 = .06 + spp.tens / 100 * .3, dmp = 1 - (1 - spp.decay / 100) * .06 - .002;
    for (let i = 1; i < n - 1; i++) { if (i === sg.pick) continue; sg.v[i] += (sg.y[i - 1] + sg.y[i + 1] - 2 * sg.y[i]) * c2; sg.v[i] *= dmp; }
    for (let i = 1; i < n - 1; i++) { if (i !== sg.pick) sg.y[i] += sg.v[i]; }
    sg.y[0] = 0; sg.y[n - 1] = 0;
  },
  draw(x, w, h, P, S, C) {
    const n = S.y.length, cy = h * .5, amp = h * .3;
    x.strokeStyle = C.rule;
    this.seg(x, 0, cy, w, cy);
    x.strokeStyle = this.rgba(C.acc, '.45');
    for (let i = 2; i < n - 2; i += 2) { const px = i / (n - 1) * w, py = cy + S.y[i] * amp; x.beginPath(); x.ellipse(px, py, 4, 13, 0, 0, 6.2832); x.stroke(); }
    x.strokeStyle = C.acc;
    x.beginPath();
    for (let i = 0; i < n; i++) { const px = i / (n - 1) * w, py = cy + S.y[i] * amp; i ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.stroke();
    x.strokeStyle = C.tick2;
    [0, w].forEach((px) => this.seg(x, px, cy - 22, px, cy + 22));
    if (S.pick >= 0) { x.fillStyle = C.acc2; this.circ(x, S.pick / (n - 1) * w, cy + S.y[S.pick] * amp, 4, 1); }
    let en = 0;
    for (let i = 0; i < n; i++) en += Math.abs(S.y[i]);
    this.ro(x, 'énergie ' + Math.round(en * 40), 'decay ' + (P.decay * .06).toFixed(1) + ' s', C);
  },
  down(S, n) { S.sprg.pick = Math.round(this.clamp(n.x, 0, 1) * (S.sprg.y.length - 1)); S.sprg.y[S.sprg.pick] = (n.y - .5) * 2; },
  move(S, m) { if (S.sprg.pick >= 0) { const i = Math.round(this.clamp(m.x, 0, 1) * (S.sprg.y.length - 1)); S.sprg.pick = i; S.sprg.y[i] = this.clamp((m.y - .5) * 2, -1, 1); } },
  up(S) { S.sprg.pick = -1; },
  // une note reçue pince le ressort : un triangle de cinq nœuds, à un endroit tiré au hasard
  trigger(ev) {
    const sg = this.S, i0 = 8 + Math.floor(Math.random() * 56), a = (Math.random() < .5 ? -1 : 1) * (.4 + (ev.v ?? .8) * .5);
    for (let k = -2; k <= 2; k++) sg.y[i0 + k] = a * (1 - Math.abs(k) / 3);
  },
  modOut(S) { let en = 0; for (const v of S.y) en += Math.abs(v); return Math.min(1, en / 24); },
};

// ── 06 · AIMANT ─────────────────────────────────────────────────────────
SCENES.mag = {
  // SHOWRUNNER : le chemin tracé est gardé dans le projet (m.path)
  init() { return { x: .42, y: .5, path: Array.isArray(this.m.path) ? this.m.path.map((p) => [p[0], p[1]]) : [], draft: null, t: 0 }; },
  phys(S) {
    const P = () => this.vals();
    const mg = S.mag, mp = P('mag');
    if (mg.path.length > 3) {
      // SHOWRUNNER : la phase est lue sur le transport (index.js, magPhase) :
      // l'aimant boucle en 1, 2, 4 ou 8 mesures calées sur la DAW, et le filtre
      // (son.js) suit la même formule pendant la lecture et à l'export
      if (this.play) mg.t = this.magPhase(mp);
      magAt(mg, mg.t);
    }
  },
  draw(x, w, h, P, S, C) {
    const cols = 16, rows = 9, mx = S.x * w, my = S.y * h;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const px = (i + .5) * w / cols, py = (j + .5) * h / rows;
        const dx = px - mx, dy = py - my, d = Math.hypot(dx, dy) + 1;
        const str = Math.min(1, (P.force / 100) * 9000 / (d * d));
        const a = Math.atan2(dy, dx) + (Math.random() - .5) * (P.grain / 100) * .5;
        const L = 5 + str * 9;
        x.strokeStyle = str > .35 ? C.acc : C.tick;
        x.globalAlpha = .3 + str * .7;
        this.seg(x, px - Math.cos(a) * L / 2, py - Math.sin(a) * L / 2, px + Math.cos(a) * L / 2, py + Math.sin(a) * L / 2);
      }
    }
    x.globalAlpha = 1;
    const path = S.draft || S.path;
    if (path && path.length > 1) {
      x.strokeStyle = S.draft ? C.acc2 : this.rgba(C.acc, '.55');
      x.beginPath();
      path.forEach((p, i) => { i ? x.lineTo(p[0] * w, p[1] * h) : x.moveTo(p[0] * w, p[1] * h); });
      if (!S.draft) x.closePath();
      x.stroke();
      if (S.draft && path.length > 3) {
        x.strokeStyle = this.rgba(C.acc2, '.35');
        x.setLineDash([4, 4]);
        this.seg(x, path[path.length - 1][0] * w, path[path.length - 1][1] * h, path[0][0] * w, path[0][1] * h);
        x.setLineDash([]);
      }
      x.fillStyle = C.acc;
      path.forEach((p, i) => { if (i % 6 === 0) this.circ(x, p[0] * w, p[1] * h, 1.6, 1); });
    }
    x.fillStyle = C.acc2;
    this.circ(x, mx, my, 11, 1);
    x.strokeStyle = C.well;
    this.circ(x, mx, my, 11);
    this.seg(x, mx, my - 7, mx, my + 7);
    const hz = Math.round(40 * Math.pow(400, S.x));
    this.ro(x, hz >= 1000 ? (hz / 1000).toFixed(1) + ' khz' : hz + ' hz', S.path.length > 3 ? 'boucle ' + [1, 2, 4, 8][Math.round(P.bars)] + ' mes.' : 'dessine un chemin', C);
  },
  down(S, n) { S.mag.draft = [[n.x, n.y]]; },
  move(S, m) { if (S.mag.draft) { const p = S.mag.draft[S.mag.draft.length - 1]; if (Math.hypot(m.x - p[0], m.y - p[1]) > .012) S.mag.draft.push([this.clamp(m.x, .02, .98), this.clamp(m.y, .02, .98)]); } },
  up(S) {
    if (!S.mag.draft) return;
    if (S.mag.draft.length > 4) { S.mag.path = S.mag.draft.slice(); S.mag.t = 0; this.savePath(S.mag.path); }
    S.mag.draft = null;
  },
  modOut(S) { return S.x; },
};
// la position de l'aimant à la phase t (0..1) de son chemin : le calcul du
// Playground (phys, section « mag »), sorti pour servir aussi au filtre
export function magAt(mg, t) {
  let tot = 0;
  const L = [];
  for (let i = 0; i < mg.path.length; i++) {
    const a = mg.path[i], b = mg.path[(i + 1) % mg.path.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    L.push(d); tot += d;
  }
  let acc = t * tot, i = 0;
  while (i < L.length && acc > L[i]) { acc -= L[i]; i++; }
  if (i >= L.length) i = L.length - 1;
  const a = mg.path[i], b = mg.path[(i + 1) % mg.path.length], u = L[i] ? acc / L[i] : 0;
  mg.x = a[0] + (b[0] - a[0]) * u; mg.y = a[1] + (b[1] - a[1]) * u;
  return mg;
}

// ── 07 · NINJA ──────────────────────────────────────────────────────────
SCENES.ninja = {
  init() { return { sh: [], frag: [], blade: [], cuts: [], harm: [], t: 0 }; },
  phys(S, dt) {
    const play = this.play, P = () => this.vals();
    const NJ = S.ninja, np = P('ninja');
    NJ.t += dt;
    if (play && NJ.t > 1.5 - np.pull / 90) {
      NJ.t = 0;
      SCENES.ninja.spawn.call(this, NJ, np);   // SHOWRUNNER : le lancer, mis à part (spawn)
    }
    NJ.sh.forEach((s) => { s.vy += dt * .82; s.x += s.vx * dt; s.y += s.vy * dt; s.rot = (s.rot || 0) + dt * (s.vx * 6); if (s.y > 1.2) s.dead = true; });
    NJ.sh = NJ.sh.filter((s) => !s.dead && !s.dead2).slice(-18);
    NJ.sh = NJ.sh.filter((s) => !s.dead);
    NJ.frag.forEach((f) => { f.vy += dt * 1.1; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.rv * dt; f.a -= dt * .8; });
    NJ.frag = NJ.frag.filter((f) => f.a > 0);
    NJ.cuts.forEach((c3) => { c3.a -= dt * 1.1; c3.y -= dt * .06; });
    NJ.cuts = NJ.cuts.filter((c3) => c3.a > 0);
    NJ.harm.forEach((hh) => { hh.a -= dt * .8; hh.r += dt * 14; });
    NJ.harm = NJ.harm.filter((hh) => hh.a > 0);
    NJ.blade.forEach((bl) => { bl[2] -= dt * 3.4; });
    NJ.blade = NJ.blade.filter((bl) => bl[2] > 0);
  },
  // SHOWRUNNER : le lancer du Playground (dans phys), mis à part pour qu'une note reçue lance aussi
  spawn(NJ, np) {
    const sc = this.SCALES[Math.round(np.scale)].d, root = Math.round(np.root);
    const deg = Math.floor(Math.random() * sc.length);
    NJ.sh.push({ pc: (root + sc[deg]) % 12, x: .12 + Math.random() * .76, y: 1.05, vx: (Math.random() - .5) * .14, vy: -(.62 + np.pull / 190), r: (.03 + deg * .004) * this.noteSize((root + sc[deg]) % 12) * 1.5, sides: this.SIDES(root + sc[deg]), note: this.NOTES[(root + sc[deg]) % 12], deg });
  },
  draw(x, w, h, P, S, C) {
    const R = Math.min(w, h);
    x.strokeStyle = C.rule;
    this.seg(x, 0, h - 1, w, h - 1);
    S.harm.forEach((hh) => {
      x.strokeStyle = this.rgba(C.grn, hh.a.toFixed(2));
      this.circ(x, hh.x * w, hh.y * h, hh.r);
      if (hh.i === 2) { x.font = '11px ' + C.font; x.fillStyle = this.rgba(C.grn, hh.a.toFixed(2)); x.fillText('harm.', hh.x * w + hh.r + 4, hh.y * h + 4); }
    });
    S.sh.forEach((s) => {
      x.strokeStyle = s.pc == null ? C.acc : this.noteCol(s.pc);
      x.lineWidth = 1.4;
      this.poly(x, s.x * w, s.y * h, s.r * R, s.sides, s.rot || 0);
      x.lineWidth = 1;
      x.font = '11px ' + C.font;
      x.fillStyle = s.pc == null ? C.mut : this.noteCol(s.pc);
      x.fillText(s.note, s.x * w - 6, s.y * h + 4);
    });
    S.frag.forEach((f) => {
      x.save();
      x.globalAlpha = Math.max(0, f.a);
      x.translate(f.x * w, f.y * h);
      x.rotate(f.rot);
      x.strokeStyle = f.pc == null ? C.acc2 : this.noteCol(f.pc);
      x.beginPath();
      x.moveTo(-f.r * R, 0);
      x.lineTo(f.r * R * (f.half ? 1 : -1), -f.r * R * 1.3);
      x.lineTo(f.r * R, 0);
      x.stroke();
      x.restore();
      x.globalAlpha = 1;
    });
    if (S.blade.length > 1) {
      for (let i = 1; i < S.blade.length; i++) {
        const a = S.blade[i - 1], b = S.blade[i];
        x.strokeStyle = this.rgba(C.acc, Math.max(0, b[2] * .85).toFixed(2));
        x.lineWidth = 1 + b[2] * 2;
        this.seg(x, a[0] * w, a[1] * h, b[0] * w, b[1] * h);
      }
      x.lineWidth = 1;
    }
    S.cuts.forEach((c3) => {
      x.font = '15px ' + C.font;
      x.fillStyle = this.rgba(C.acc, c3.a.toFixed(2));
      x.fillText(c3.note, c3.x * w - 8, c3.y * h);
    });
    const sc = this.SCALES[Math.round(P.scale)];
    const root = Math.round(P.root);
    x.font = '11px ' + C.font;
    const degs = sc.d.map((d) => this.NOTES[(root + d) % 12]);
    const lw2 = 46 + Math.max.apply(null, degs.map((t) => x.measureText(t).width));
    const lh2 = degs.length * 15 + 10;
    x.fillStyle = C.well; x.globalAlpha = .85; x.fillRect(8, h - 8 - lh2, lw2, lh2); x.globalAlpha = 1;
    x.strokeStyle = C.rule; x.strokeRect(8, h - 8 - lh2, lw2, lh2);
    degs.forEach((t, i) => {
      const yy = h - 16 - (degs.length - 1 - i) * 15;
      x.strokeStyle = C.tick2;
      this.poly(x, 22, yy - 4, 6, 3 + (i % 5), 0);
      x.fillStyle = C.mut;
      x.fillText(t, 36, yy);
      x.fillStyle = C.dim;
      x.fillText(String(3 + (i % 5)), lw2 - 8, yy);
    });
    this.ro(x, this.NOTES[root] + ' ' + sc.n, S.cuts.length ? 'combo ×' + (S.lastHits || 1) : 'tranche les formes', C, w - 8);
  },
  down(S, n) { S.ninja.blade = [[n.x, n.y, 1]]; },
  move(S, m, lastN) { S.ninja.blade.push([m.x, m.y, 1]); if (S.ninja.blade.length > 14) S.ninja.blade.shift(); this.slash(S.ninja, lastN, m); },
  up(S) { S.ninja.blade = []; },
  trigger() { SCENES.ninja.spawn.call(this, this.S, this.vals()); },
};

// ── 08 · SECOUSSE ───────────────────────────────────────────────────────
SCENES.shake = {
  init() {
    const o = [];
    for (let i = 0; i < 14; i++) o.push({
      x: .1 + Math.random() * .8, y: .15 + Math.random() * .7, vx: 0, vy: 0,
      r: (5 + Math.random() * 5) * this.noteSize((i * 5) % 12), bounce: .3 + Math.random() * .62, drag: .5 + Math.random() * 1.8,
      resp: .3 + Math.random() * 1.7, jit: Math.random() * .5, shape: i % 4 === 0 ? 4 : (i % 7 === 3 ? 3 : 0),
      rot: Math.random() * 6.28, rv: (Math.random() - .5) * 5, n: (i * 5) % 12,
    });
    return { o, sx: 0, sy: 0, flash: 0 };
  },
  phys(S, dt) {
    const P = () => this.vals();
    const SK = S.shake, kp = P('shake');
    const num = Math.round(kp.num);
    const ax = (SK.vxImp || 0), ay = (SK.vyImp || 0);
    SK.vxImp = ax * .82; SK.vyImp = ay * .82;
    SK.flash = Math.max(0, SK.flash - dt * 1.8);
    SK.o.forEach((bl, i) => {
      if (i >= num) return;
      const mass = bl.r / 7;
      const kick = bl.resp / mass;
      bl.vx += ax * 2.6 * kick + (Math.random() - .5) * bl.jit * Math.abs(ax) * 7;
      bl.vy += ay * 2.6 * kick + (Math.random() - .5) * bl.jit * Math.abs(ay) * 7 + dt * (.2 + mass * .34);
      const dg = (kp.fric / 100) * dt * 2.2 * bl.drag + dt * .06;
      bl.vx *= 1 - dg; bl.vy *= 1 - dg;
      bl.x += bl.vx * dt; bl.y += bl.vy * dt;
      bl.rot += bl.rv * dt + bl.vx * dt * 2.4;
      const m2 = bl.r / 320;
      const was = bl.hit || 0, sp0 = Math.abs(bl.vx) + Math.abs(bl.vy);   // SHOWRUNNER : pour la note, le front montant du choc
      if (bl.x < .03 + m2) { if (Math.abs(bl.vx) > .14) bl.hit = 1; bl.x = .03 + m2; bl.vx = Math.abs(bl.vx) * bl.bounce; bl.rv += bl.vy * 6; }
      if (bl.x > .97 - m2) { if (Math.abs(bl.vx) > .14) bl.hit = 1; bl.x = .97 - m2; bl.vx = -Math.abs(bl.vx) * bl.bounce; bl.rv -= bl.vy * 6; }
      if (bl.y < .04 + m2) { if (Math.abs(bl.vy) > .14) bl.hit = 1; bl.y = .04 + m2; bl.vy = Math.abs(bl.vy) * bl.bounce; }
      if (bl.y > .96 - m2) { if (Math.abs(bl.vy) > .14) bl.hit = 1; bl.y = .96 - m2; bl.vy = -Math.abs(bl.vy) * bl.bounce; bl.rv *= .7; }
      if (bl.hit === 1 && was < .5) this.out(bl.n, Math.min(1, .35 + sp0 * .6));   // SHOWRUNNER : la bille qui frappe joue sa note
      bl.rv *= 1 - dt * .8;
      bl.hit = Math.max(0, (bl.hit || 0) - dt * 2.6);
    });
  },
  draw(x, w, h, P, S, C) {
    const num = Math.round(P.num);
    x.strokeStyle = S.flash > .1 ? C.acc : C.tick2;
    x.strokeRect(4, 4, w - 8, h - 8);
    for (let i = 0; i < 4; i++) { x.strokeStyle = C.rule; this.seg(x, 4, 4 + (h - 8) * i / 4, w - 4, 4 + (h - 8) * i / 4); }
    S.o.forEach((bl, i) => {
      if (i >= num) return;
      const px = bl.x * w, py = bl.y * h;
      x.fillStyle = bl.hit > .1 ? C.acc2 : this.noteCol(bl.n);
      x.save(); x.translate(px, py); x.rotate(bl.rot || 0);
      this.poly(x, 0, 0, bl.r * 1.16, this.SIDES(bl.n), 3.1416, 1);
      x.strokeStyle = C.well;
      this.poly(x, 0, 0, bl.r * 1.16, this.SIDES(bl.n), 3.1416);
      x.restore();
      if (bl.r > 9) { x.font = '11px ' + C.font; x.fillStyle = C.well; x.fillText(this.NOTES[bl.n], px - 7, py + 4); }
      if (bl.r <= 9 && Math.abs(bl.vx) + Math.abs(bl.vy) > .4) { x.strokeStyle = this.rgba(C.acc, '.3'); this.seg(x, px, py, px - bl.vx * 22, py - bl.vy * 22); }
    });
    const en = Math.round((Math.abs(S.vxImp || 0) + Math.abs(S.vyImp || 0)) * 900);
    this.ro(x, en > 4 ? 'secousse ' + en : 'au repos', num + ' billes', C);
  },
  down(S, n) { S.shake.grab = n; },
  move(S, m, lastN) { const S2 = S.shake; S2.vxImp = (S2.vxImp || 0) + (m.x - lastN.x) * 2.2; S2.vyImp = (S2.vyImp || 0) + (m.y - lastN.y) * 2.2; S2.flash = 1; },
  up(S) { S.shake.grab = null; },
  // SHOWRUNNER : blockDown (le bloc tiré par son en-tête) et panDown (le canvas déplacé)
  drag(dx, dy) { const S = this.S; S.vxImp = (S.vxImp || 0) - dx * .0016; S.vyImp = (S.vyImp || 0) - dy * .0016; S.flash = 1; },
  pan(dx, dy) { const S = this.S; S.vxImp = (S.vxImp || 0) + dx * -.0006; S.vyImp = (S.vyImp || 0) + dy * -.0006; },
  trigger(ev) { const S = this.S, k = .08 + (ev.v ?? .8) * .1; S.vxImp = (S.vxImp || 0) + (Math.random() - .5) * 2 * k; S.vyImp = (S.vyImp || 0) - k * .8; S.flash = 1; },
  modOut(S) {
    const num = Math.round(this.V('shake', 'num'));
    let s = 0;
    for (let i = 0; i < num; i++) s += Math.abs(S.o[i].vx) + Math.abs(S.o[i].vy);
    return Math.min(1, s / num / 1.5);
  },
};

// ── 09 · PACHINKO ───────────────────────────────────────────────────────
SCENES.pach = {
  init() { return { balls: [], bins: new Array(9).fill(0), t: 0 }; },
  phys(S, dt) {
    const play = this.play, P = () => this.vals();
    const pc = P('pach'), pk = S.pach;
    pk.t += dt;
    if (play && pc.rate > 2 && pk.t > 2.4 - pc.rate / 55) { pk.t = 0; pk.balls.push({ x: .5 + (Math.random() - .5) * .1, y: 0, vx: 0, vy: 0, row: -1 }); }
    const AP = pk.ar || .8, rpg = .026, rbq = .013, bias = pc.bias / 100;
    pk.balls.forEach((bb) => {
      bb.vy += dt * 2.1;
      bb.y += bb.vy * dt; bb.x += bb.vx * dt;
      this.pegs().forEach((pg) => {
        const dx = (bb.x - pg.x) * AP, dy = bb.y - pg.y;
        const d = Math.hypot(dx, dy);
        if (d > rpg + rbq || d === 0) return;
        const nx = dx / d, ny = dy / d;
        bb.x = pg.x + nx * (rpg + rbq) / AP; bb.y = pg.y + ny * (rpg + rbq);
        const vn = bb.vx * nx + bb.vy * ny;
        bb.vx = (bb.vx - 2 * vn * nx) * .52 + bias * .07 + (Math.random() - .5) * .06;
        bb.vy = (bb.vy - 2 * vn * ny) * .52;
        if (bb.vy < .04) bb.vy = .04;
        pg.flash = 1;
      });
      bb.vx = this.clamp(bb.vx, -.5, .5);
      if (bb.x < .05) { bb.x = .05; bb.vx = Math.abs(bb.vx) * .6; }
      if (bb.x > .95) { bb.x = .95; bb.vx = -Math.abs(bb.vx) * .6; }
      if (bb.y > .84) {
        bb.dead = true; const bin = this.clamp(Math.floor(bb.x * 9), 0, 8); pk.bins[bin] += 1;
        pk.last = bin; this.outDegree(bin - 4, .75);   // SHOWRUNNER : le bac est un degré de la gamme (ODIO_01, scenes.tsx)
      }
    });
    this.pegs().forEach((pg) => { pg.flash = Math.max(0, (pg.flash || 0) - dt * 3); });
    pk.balls = pk.balls.filter((bb) => !bb.dead).slice(-24);
  },
  draw(x, w, h, P, S, C) {
    S.ar = w / h;
    const rpx = .026 * h;
    this.pegs().forEach((pg) => {
      const px = pg.x * w, py = pg.y * h;
      x.fillStyle = C.acc2; this.circ(x, px, py, rpx * .62, 1);
      x.strokeStyle = this.rgba(C.acc2, (.28 + (pg.flash || 0) * .7).toFixed(2));
      this.circ(x, px, py, rpx * (1 + (pg.flash || 0) * .5));
    });
    const maxb = Math.max(1, ...S.bins);
    for (let i = 0; i < 9; i++) {
      const px = w * (.05 + i * .9 / 9), bw = w * .9 / 9 - 3;
      const bh = (S.bins[i] / maxb) * h * .14;
      x.strokeStyle = C.rule; x.strokeRect(px, h * .86, bw, h * .14);
      x.fillStyle = C.acc; x.globalAlpha = .8; x.fillRect(px, h - bh, bw, bh); x.globalAlpha = 1;
      if (S.bins[i]) { x.font = '11px ' + C.font; x.fillStyle = C.onAcc; x.fillText(String(S.bins[i]), px + 4, h - 5); }
    }
    S.balls.forEach((bb) => {
      x.fillStyle = C.acc;
      this.circ(x, bb.x * w, bb.y * h, .013 * h, 1);
      x.strokeStyle = C.well;
      this.circ(x, bb.x * w, bb.y * h, .013 * h);
    });
    this.ro(x, S.bins.reduce((a, b) => a + b, 0) + ' billes', 'biais ' + (P.bias > 0 ? '+' : '') + Math.round(P.bias), C, w - 8);
  },
  down(S, n) { S.pach.balls.push({ x: this.clamp(n.x, .08, .92), y: 0, vx: 0, vy: 0, row: -1 }); },
  trigger() { this.S.balls.push({ x: .5 + (Math.random() - .5) * .1, y: 0, vx: 0, vy: 0, row: -1 }); },
  modOut(S) { return S.last == null ? 0.5 : S.last / 8; },
};

// ── 10 · GRILLE–PAIN ────────────────────────────────────────────────────
SCENES.toast = {
  init() { return { lever: 0, t: 0, cooking: false, glow: 0, pop: 0, toasts: [] }; },
  phys(S, dt) {
    const P = () => this.vals();
    const tp = P('toast'), T = S.toast;
    if (T.lever > .55 && !T.cooking) { T.cooking = true; T.t = 0; }
    T.clock = (T.clock || 0) + dt;
    if (T.cooking) {
      T.t += dt;
      T.lever = Math.min(1, T.lever + dt * 3);
      T.glow = Math.min(1, T.glow + dt * 1.6);
      if (T.t > 1.2 + tp.brown / 100 * 5) {
        T.cooking = false; T.lever = 0; T.pop = 1;
        const nn = Math.round(tp.slices);
        for (let i = 0; i < nn; i++) T.toasts.push({ x: nn === 1 ? .5 : (i ? .62 : .38), y: .5, vy: -(.5 + tp.pop / 100 * 1.15), brown: tp.brown / 100, rot: 0, spin: (Math.random() - .5) * 4 });
        this.out(Math.round(tp.brown / 100 * 11), Math.min(1, .5 + tp.pop / 200));   // SHOWRUNNER : la note gravée sur la tranche
      }
    } else T.glow = Math.max(0, T.glow - dt * 1.4);
    T.pop = Math.max(0, T.pop - dt * 2.2);
    T.toasts.forEach((t2) => {
      t2.vy += dt * 2.4; t2.y += t2.vy * dt; t2.rot += t2.spin * dt;
      if (t2.y > .5) { t2.y = .5; t2.vy = 0; t2.spin = 0; t2.rot = 0; t2.rest = (t2.rest || 0) + dt; }
    });
    T.toasts = T.toasts.filter((t2) => (t2.rest || 0) < 2.6).slice(-4);
  },
  draw(x, w, h, P, S, C) {
    const bw = Math.min(w * .58, 260), bh = Math.min(h * .42, 130);
    const bx = (w - bw) / 2 - 14, by = h * .5;
    x.strokeStyle = C.tick;
    this.seg(x, 0, by + bh + 12, w, by + bh + 12);
    x.fillStyle = C.well;
    x.fillRect(bx, by, bw, bh);
    x.strokeStyle = C.tick2;
    x.strokeRect(bx, by, bw, bh);
    x.strokeStyle = C.rule;
    x.strokeRect(bx + 5, by + bh - 16, bw - 10, 11);
    const n = Math.round(P.slices);
    for (let i = 0; i < n; i++) {
      const sw = bw * .3, sx = bx + bw * (n === 1 ? .35 : (i ? .55 : .15));
      x.strokeStyle = C.tick2;
      x.strokeRect(sx, by - 5, sw, 8);
      x.fillStyle = C.room;
      x.fillRect(sx + 1, by - 4, sw - 2, 6);
    }
    if (S.glow > .02) {
      for (let i = 0; i < 4; i++) {
        const gy = by + 16 + i * (bh - 44) / 3;
        x.strokeStyle = this.rgba(C.acc2, (S.glow * (.35 + .5 * Math.abs(Math.sin(i + (S.clock || 0) * 3)))).toFixed(2));
        x.beginPath();
        for (let j = 0; j <= 18; j++) { const px = bx + 8 + j * (bw - 16) / 18; const py = gy + Math.sin(j * 1.1 + i) * 2.4; j ? x.lineTo(px, py) : x.moveTo(px, py); }
        x.stroke();
      }
    }
    const lx = bx + bw + 8, ly = by + 10 + S.lever * (bh - 34);
    x.strokeStyle = C.tick2;
    this.seg(x, lx, by + 8, lx, by + bh - 8);
    x.fillStyle = S.cooking ? C.acc2 : C.acc;
    x.fillRect(lx - 5, ly, 14, 12);
    x.strokeStyle = C.well;
    x.strokeRect(lx - 5, ly, 14, 12);
    if (S.pop > .05) {
      x.strokeStyle = this.rgba(C.acc, S.pop.toFixed(2));
      this.circ(x, bx + bw / 2, by, 20 + (1 - S.pop) * 60);
    }
    // SHOWRUNNER : le pain, du cru rgb(255,196,60) au brûlé rgb(125,56,20) —
    // les jetons --jo-pain et --jo-brule, la même interpolation
    const [r0, g0, b0] = hex(C.pain), [r1, g1, b1] = hex(C.brule);
    S.toasts.forEach((t2) => {
      const px = bx + t2.x * bw, py = by + (t2.y - .5) * h * .9;
      x.save();
      x.translate(px, py);
      x.rotate(t2.rot);
      const tw = bw * .26, th = 30;
      const br = t2.brown;
      x.fillStyle = 'rgba(' + Math.round(r0 - br * (r0 - r1)) + ',' + Math.round(g0 - br * (g0 - g1)) + ',' + Math.round(b0 - br * (b0 - b1)) + ',.9)';
      x.fillRect(-tw / 2, -th / 2, tw, th);
      x.strokeStyle = C.well;
      x.strokeRect(-tw / 2, -th / 2, tw, th);
      x.fillStyle = C.well;
      x.font = '11px ' + C.font;
      x.fillText(this.NOTES[Math.round(br * 11)], -7, 4);
      x.restore();
    });
    const dur = 1.2 + P.brown / 100 * 5;
    this.ro(x, S.cooking ? 'pop dans ' + Math.max(0, dur - S.t).toFixed(1) + ' s' : (S.toasts.length ? 'servi' : 'prêt'), 'cuisson ' + Math.round(P.brown) + ' % · ' + Math.round(P.slices) + ' tranche(s)', C);
  },
  down(S, n) { S.toast.lever = this.clamp((n.y - .34) / .3, 0, 1); },
  move(S, m) { if (!S.toast.cooking) S.toast.lever = this.clamp((m.y - .34) / .3, 0, 1); },
  trigger() { if (!this.S.cooking) this.S.lever = 1; },
  modOut(S) { return S.glow; },
};

// ── 11 · FLIPPER ────────────────────────────────────────────────────────
SCENES.pin = {
  init() { return { bx: .5, by: .5, vx: .12, vy: 0, lf: 0, rf: 0, lfa: 0, rfa: 0, idle: 0, wait: 0, lost: 0, pops: [], ar: 1, hov: false }; },
  phys(S, dt) {
    const P = () => this.vals();
    const pp2 = P('pin'), PB = S.pin;
    if (PB.auto > 0) { PB.auto -= dt; if (PB.auto <= 0) { PB.lf = 0; PB.rf = 0; } }   // SHOWRUNNER : la pression d'une note reçue
    PB.lfa += ((PB.lf ? 1 : 0) - PB.lfa) * Math.min(1, dt * 22);
    PB.rfa += ((PB.rf ? 1 : 0) - PB.rfa) * Math.min(1, dt * 22);
    PB.pops.forEach((q) => { q.a -= dt * 1.15; q.y -= dt * .04; });
    PB.pops = PB.pops.filter((q) => q.a > 0).slice(-7);
    if (PB.wait > 0) {
      PB.wait -= dt;
      if (PB.wait <= 0) { PB.bx = .905; PB.by = .82; PB.vx = 0; PB.vy = -1.42; }
    } else {
      const AR = PB.ar || 1, kick = .55 + pp2.kick / 100 * 1.15;
      PB.idle += dt;
      PB.vy += pp2.grav / 100 * dt * 1.15;
      PB.bx += PB.vx * dt; PB.by += PB.vy * dt;
      const pop = (px, py, txt, big) => PB.pops.push({ x: px, y: py, t: txt, a: 1, big: !!big });
      const rb = .022;
      if (PB.bx < .06 + rb) { PB.bx = .06 + rb; PB.vx = Math.abs(PB.vx) * .82; }
      if (PB.bx > .94 - rb) { PB.bx = .94 - rb; PB.vx = -Math.abs(PB.vx) * .82; }
      if (PB.by < .06 + rb) { PB.by = .06 + rb; PB.vy = Math.abs(PB.vy) * .82; }
      if (PB.bx > .87 && PB.by < .26) { PB.vx = -.42; PB.vy = Math.max(PB.vy, .04); }
      if (PB.bx > .86 && PB.by > .26 && PB.vx > 0) PB.vx = -Math.abs(PB.vx) * .6;
      this.PINS.forEach((t2) => {
        const dx = (PB.bx - t2.x) * AR, dy = PB.by - t2.y, d = Math.hypot(dx, dy);
        if (t2.k === 'bump' && d < t2.r + rb) {
          const nx = dx / (d || 1), ny = dy / (d || 1);
          PB.bx = t2.x + nx * (t2.r + rb) / AR; PB.by = t2.y + ny * (t2.r + rb);
          const sp = Math.hypot(PB.vx, PB.vy) * .5 + .5;
          PB.vx = nx * sp; PB.vy = ny * sp;
          t2.flash = 1; pop(t2.x, t2.y - t2.r - .03, this.NOTES[t2.pc]); this.out(t2.pc, .8);   // SHOWRUNNER : la note de la cible
        } else if (t2.k === 'drop' && !t2.down && Math.abs(dy) < .022 && Math.abs(dx) < t2.r) {
          t2.down = 1; t2.flash = 1; PB.vy = -Math.abs(PB.vy) * .7;
          pop(t2.x, t2.y - .05, this.NOTES[t2.pc]); this.out(t2.pc, .8);
        } else if (t2.k === 'lane' && Math.abs(dx) < t2.r && PB.by < .13 && PB.vy < 0) {
          if (!t2.flash) { t2.flash = 1; pop(t2.x, .1, this.NOTES[t2.pc]); this.out(t2.pc, .8); }
        }
      });
      this.PINS.forEach((t2) => { t2.flash = Math.max(0, (t2.flash || 0) - dt * 2.2); });
      [[.06, .6, .2, .76], [.86, .6, .8, .76]].forEach((g2) => {
        const ax = (PB.bx - g2[0]) * AR, ay = PB.by - g2[1];
        const bx2 = (g2[2] - g2[0]) * AR, by2 = g2[3] - g2[1];
        const L2 = bx2 * bx2 + by2 * by2;
        const t3 = this.clamp((ax * bx2 + ay * by2) / (L2 || 1), 0, 1);
        const cx2 = bx2 * t3, cy2 = by2 * t3;
        const dd = Math.hypot(ax - cx2, ay - cy2);
        if (dd < rb) {
          const nx = (ax - cx2) / (dd || 1), ny = (ay - cy2) / (dd || 1);
          PB.bx = g2[0] + (cx2 + nx * rb) / AR; PB.by = g2[1] + cy2 + ny * rb;
          const vn = PB.vx * nx + PB.vy * ny;
          PB.vx -= 2 * vn * nx * .8; PB.vy -= 2 * vn * ny * .8;
        }
      });
      const flip = (x0, y0, side, pr, pv) => {
        const tip = this.flipTip(x0, pr, side, AR);
        const ex = tip[0], ey = tip[1];
        const ax = (PB.bx - x0) * AR, ay = PB.by - y0, bx2 = (ex - x0) * AR, by2 = ey - y0;
        const L2 = bx2 * bx2 + by2 * by2;
        const t3 = this.clamp((ax * bx2 + ay * by2) / (L2 || 1), 0, 1);
        const cx2 = bx2 * t3, cy2 = by2 * t3;
        const dd = Math.hypot(ax - cx2, ay - cy2);
        if (dd < rb + .012) {
          const nx = (ax - cx2) / (dd || 1), ny = (ay - cy2) / (dd || 1);
          PB.bx = x0 + (cx2 + nx * (rb + .012)) / AR; PB.by = y0 + cy2 + ny * (rb + .012);
          const vn = PB.vx * nx + PB.vy * ny;
          PB.vx -= 2 * vn * nx; PB.vy -= 2 * vn * ny;
          if (pv > .12) { PB.vx += nx * kick * pv; PB.vy += ny * kick * pv - .55 * pv; }
          PB.vx *= .93; PB.vy *= .93;
        }
      };
      const lv = Math.min(1.7, Math.max(0, (PB.lf ? 1 : 0) - PB.lfa) * 3), rv = Math.min(1.7, Math.max(0, (PB.rf ? 1 : 0) - PB.rfa) * 3);
      flip(this.flipPivot(-1)[0], this.flipPivot(-1)[1], -1, PB.lfa, lv);
      flip(this.flipPivot(1)[0], this.flipPivot(1)[1], 1, PB.rfa, rv);

      this.SLING.forEach((s2) => {
        const ax = (PB.bx - s2.x0) * AR, ay = PB.by - s2.y0;
        const bx2 = (s2.x1 - s2.x0) * AR, by2 = s2.y1 - s2.y0;
        const L2 = bx2 * bx2 + by2 * by2;
        const t3 = this.clamp((ax * bx2 + ay * by2) / (L2 || 1), 0, 1);
        const cx2 = bx2 * t3, cy2 = by2 * t3;
        const dd = Math.hypot(ax - cx2, ay - cy2);
        if (dd < rb + .01) {
          const nx = (ax - cx2) / (dd || 1), ny = (ay - cy2) / (dd || 1);
          PB.bx = s2.x0 + (cx2 + nx * (rb + .01)) / AR; PB.by = s2.y0 + cy2 + ny * (rb + .01);
          const vn = PB.vx * nx + PB.vy * ny;
          PB.vx = (PB.vx - 2 * vn * nx) + nx * .62; PB.vy = (PB.vy - 2 * vn * ny) + ny * .62;
          s2.flash = 1; pop(s2.x1, s2.y0 - .04, this.NOTES[s2.pc]); this.out(s2.pc, .8);
        }
        s2.flash = Math.max(0, (s2.flash || 0) - dt * 2.2);
      });
      const drained = PB.by > .9;
      if (drained || PB.idle > pp2.idle * (PB.rnd || 1)) {
        PB.lost += 1; PB.wait = .9;
        pop(PB.bx, .84, drained ? 'plouf' : 'sortie', true);
        PB.idle = 0; PB.rnd = .7 + Math.random() * .8;
        this.PINS.forEach((t2) => { t2.down = 0; });
      }
      if (Math.abs(PB.vx) > 2) PB.vx = Math.sign(PB.vx) * 2;
      if (Math.abs(PB.vy) > 2.4) PB.vy = Math.sign(PB.vy) * 2.4;
    }
  },
  draw(x, w, h, P, S, C) {
    S.ar = w / h;
    const X = (u) => u * w, Y = (u) => u * h;
    x.strokeStyle = C.tick2;
    x.strokeRect(X(.06), Y(.06), X(.88), Y(.92));
    x.strokeStyle = C.rule;
    x.beginPath();
    x.moveTo(X(.06), Y(.2)); x.quadraticCurveTo(X(.5), Y(.1), X(.94), Y(.2));
    x.stroke();
    this.seg(x, X(.86), Y(.26), X(.86), Y(.9));
    [.16, .84].forEach((u, i) => {
      const t2 = this.PINS[5 + i];
      x.strokeStyle = t2.flash > .1 ? C.acc : C.tick;
      this.seg(x, X(u - .035), Y(.09), X(u), Y(.135));
      this.seg(x, X(u), Y(.135), X(u + .035), Y(.09));
      this.seg(x, X(u - .035), Y(.135), X(u), Y(.18));
      this.seg(x, X(u), Y(.18), X(u + .035), Y(.135));
    });
    this.PINS.filter((t2) => t2.k === 'bump').forEach((t2) => {
      x.strokeStyle = t2.flash > .1 ? C.acc : C.tick2;
      this.circ(x, X(t2.x), Y(t2.y), t2.r * w);
      x.fillStyle = t2.flash > .1 ? C.acc : C.tick;
      this.circ(x, X(t2.x), Y(t2.y), t2.r * w * .34, 1);
      if (t2.flash > .1) { x.strokeStyle = this.rgba(C.acc, t2.flash.toFixed(2)); this.circ(x, X(t2.x), Y(t2.y), t2.r * w * (1 + (1 - t2.flash) * .9)); }
    });
    this.PINS.filter((t2) => t2.k === 'drop').forEach((t2) => {
      x.strokeStyle = t2.down ? C.rule : (t2.flash > .1 ? C.acc : C.tick2);
      const bw2 = t2.r * w * .9, bh2 = Y(.03);
      if (t2.down) x.strokeRect(X(t2.x) - bw2 / 2, Y(t2.y) - bh2 / 2, bw2, bh2);
      else { x.fillStyle = t2.flash > .1 ? C.acc : C.tick; x.fillRect(X(t2.x) - bw2 / 2, Y(t2.y) - bh2 / 2, bw2, bh2); }
    });
    x.strokeStyle = C.tick2;
    this.SLING.forEach((s2) => { x.lineWidth = 2; this.seg(x, X(s2.x0), Y(s2.y0), X(s2.x1), Y(s2.y1)); x.lineWidth = 1; });
    x.strokeStyle = C.rule;
    this.seg(x, X(.06), Y(.6), X(.2), Y(.76));
    this.seg(x, X(.86), Y(.6), X(.8), Y(.76));
    [[-1, .26, S.lfa], [1, .74, S.rfa]].forEach((fl) => {
      const side = fl[0], u = fl[1], pr = fl[2];
      const pv2 = this.flipPivot(side), tip = this.flipTip(u, pr, side, w / h);
      const px0 = X(pv2[0]), py0 = Y(pv2[1]), px1 = X(tip[0]), py1 = Y(tip[1]);
      const nx2 = -(py1 - py0), ny2 = px1 - px0, nl = Math.hypot(nx2, ny2) || 1;
      const ux = nx2 / nl, uy = ny2 / nl;
      x.fillStyle = pr > .25 ? C.acc : C.tick2;
      x.beginPath();
      x.moveTo(px0 + ux * 5, py0 + uy * 5);
      x.lineTo(px1 + ux * 2, py1 + uy * 2);
      x.lineTo(px1 - ux * 2, py1 - uy * 2);
      x.lineTo(px0 - ux * 5, py0 - uy * 5);
      x.closePath();
      x.fill();
      x.strokeStyle = C.tick;
      this.circ(x, px0, py0, 4);
    });
    if (S.wait <= 0) {
      x.fillStyle = C.acc;
      this.circ(x, X(S.bx), Y(S.by), Math.max(3, .022 * w), 1);
      x.strokeStyle = C.well;
      this.circ(x, X(S.bx), Y(S.by), Math.max(3, .022 * w));
    } else {
      x.strokeStyle = C.acc2;
      this.circ(x, X(.93), Y(.5), Math.max(3, .022 * w));
    }
    S.pops.forEach((q) => this.bubble(x, X(q.x), Y(q.y), q.t, q.a, C, q.big));
    const l1 = S.lost + ' perdue' + (S.lost === 1 ? '' : 's') + ' · sortie ' + Math.max(0, P.idle * (S.rnd || 1) - S.idle).toFixed(1) + ' s';
    x.font = '12px ' + C.font;
    const pw = x.measureText(l1).width + 20;
    x.fillStyle = C.room;
    x.fillRect((w - pw) / 2, 0, pw, 26);
    x.strokeStyle = C.rule;
    this.seg(x, (w - pw) / 2, 26, (w + pw) / 2, 26);
    x.fillStyle = C.mut;
    x.fillText(l1, (w - pw) / 2 + 10, 17);
  },
  down(S, n, e) {
    if (e.button === 2) S.pin.rf = 1; else S.pin.lf = 1;
    S.pin.idle = 0;
    const rel = () => { S.pin.lf = 0; S.pin.rf = 0; document.removeEventListener('pointerup', rel); };
    document.addEventListener('pointerup', rel);
    return false;
  },
  trigger() { const PB = this.S; PB.lf = 1; PB.rf = 1; PB.idle = 0; PB.auto = .15; },
};

// ── 12 · NAVETTE ────────────────────────────────────────────────────────
SCENES.inv = {
  init() { return { ship: .5, shipY: .82, shots: [], foes: [], items: [], msls: [], stars: [], t: 0, fire: 0, hov: false, keys: {}, pops: [], miss: 0, score: 0, x3: 0, mpc: null, mn: 0 }; },
  phys(S, dt) {
    const P = () => this.vals();
    const ip = P('inv'), IV = S.inv;
    if (!IV.stars.length) for (let i = 0; i < 40; i++) IV.stars.push({ x: Math.random(), y: Math.random(), s: .3 + Math.random() * .7 });
    IV.pops.forEach((q) => { q.a -= dt * 1.3; q.y -= dt * .05; });
    IV.pops = IV.pops.filter((q) => q.a > 0).slice(-7);
    IV.fire = Math.max(0, IV.fire - dt * (1 + ip.rate / 40));
    IV.mfire = Math.max(0, (IV.mfire || 0) - dt * 2.6);
    if (IV.auto > 0) IV.auto -= dt;   // SHOWRUNNER : une note reçue fait jouer la navette un instant, même sans survol
    if (IV.hov || IV.auto > 0) {
      IV.t += dt;
      const ax = (IV.keys.ArrowRight ? 1 : 0) - (IV.keys.ArrowLeft ? 1 : 0);
      const ay = (IV.keys.ArrowDown ? 1 : 0) - (IV.keys.ArrowUp ? 1 : 0);
      IV.vx = (IV.vx || 0) + ax * dt * 7.2;
      IV.vy = (IV.vy || 0) + ay * dt * 5.4;
      if (IV.mx != null && !ax && !ay) {
        IV.vx += (IV.mx - IV.ship) * dt * 30;
        IV.vy += (IV.my - (IV.shipY == null ? .82 : IV.shipY)) * dt * 26;
        IV.vx *= Math.pow(.02, dt); IV.vy *= Math.pow(.02, dt);
      } else { IV.vx *= Math.pow(.0016, dt); IV.vy *= Math.pow(.0016, dt); }
      IV.vx = this.clamp(IV.vx, -1.5, 1.5); IV.vy = this.clamp(IV.vy, -1.1, 1.1);
      IV.ship += IV.vx * dt; IV.shipY = this.clamp((IV.shipY == null ? .82 : IV.shipY) + IV.vy * dt, .5, .92);
      if (IV.ship < .08) { IV.ship = .08; IV.vx *= -.3; }
      if (IV.ship > .92) { IV.ship = .92; IV.vx *= -.3; }
      IV.bank = (IV.bank || 0) + ((IV.vx / 1.5) * .5 - (IV.bank || 0)) * Math.min(1, dt * 9);
      IV.thr = (IV.thr || 0) + ((ax || ay ? 1 : .35) - (IV.thr || 0)) * Math.min(1, dt * 7);
      if (IV.x3) { IV.x3t = (IV.x3t || 0) - dt; if (IV.x3t <= 0) { IV.x3 = 0; IV.x3t = 0; } }
      IV.stars.forEach((s2) => { s2.y += dt * s2.s * (.1 + ip.spd / 400); if (s2.y > 1) { s2.y = 0; s2.x = Math.random(); } });
      const root = Math.round(this.V('ninja', 'root')), sc = this.SCALES[Math.round(this.V('ninja', 'scale'))].d;
      if (IV.items.length < 2 && Math.random() < dt * .09) {
        const deg2 = Math.floor(Math.random() * sc.length), pc2 = (root + sc[deg2]) % 12;
        const kind = Math.random() < .34 ? 'x3' : 'msl';
        IV.items.push({ x: .12 + Math.random() * .76, y: -.05, kind, pc: pc2, ph: 0 });
      }
      if (Math.random() < dt * (.5 + ip.dens / 42)) {
        const deg = Math.floor(Math.random() * sc.length), pc = (root + sc[deg]) % 12;
        IV.foes.push({ x: .1 + Math.random() * .8, y: -.05, pc, sides: this.SIDES(pc), r: (.03 + (sc.length - deg) * .002) * this.noteSize(pc) * 1.35, ph: Math.random() * 6 });
      }
      IV.foes.forEach((fo) => {
        fo.y += dt * (.05 + ip.spd / 620);
        fo.x += Math.sin(IV.t * 1.3 + fo.ph) * dt * .06;
        if (fo.y > .94) { fo.dead = true; IV.miss += 1; }
      });
      IV.shots.forEach((sh) => { sh.y += (sh.vy == null ? -1.15 : sh.vy) * dt; sh.x += (sh.vx || 0) * dt; if (sh.y < -.02 || sh.x < -.04 || sh.x > 1.04) sh.dead = true; });
      IV.items.forEach((it) => {
        it.y += dt * (.04 + ip.spd / 900);
        it.ph += dt * 2.2;
        if (it.y > .96) it.dead = true;
        if (Math.abs(it.x - IV.ship) < .05 && Math.abs(it.y - (IV.shipY == null ? .82 : IV.shipY)) < .05) {
          it.dead = true;
          if (it.kind === 'x3') { IV.x3 = Math.min(2, IV.x3 + 1); IV.x3t = 5; IV.pops.push({ x: it.x, y: it.y, t: (IV.x3 >= 2 ? 'x6 · 30°' : 'x3 · 15°') + ' · 5 s', a: 1 }); }
          else { IV.mpc = it.pc; IV.mn = 3; IV.pops.push({ x: it.x, y: it.y, t: '3 missiles ' + this.NOTES[it.pc], a: 1, col: this.noteCol(it.pc) }); }
        }
      });
      IV.items = IV.items.filter((it) => !it.dead).slice(-6);
      IV.msls.forEach((ms) => {
        let tg = null, bd = 9;
        IV.foes.forEach((fo) => { if (fo.dead || fo.pc !== ms.pc) return; const d2 = Math.hypot(fo.x - ms.x, fo.y - ms.y); if (d2 < bd) { bd = d2; tg = fo; } });
        const sp2 = .82;
        if (tg) {
          const dx2 = tg.x - ms.x, dy2 = tg.y - ms.y, dl = Math.hypot(dx2, dy2) || 1;
          ms.vx += (dx2 / dl * sp2 - ms.vx) * Math.min(1, dt * 5.5);
          ms.vy += (dy2 / dl * sp2 - ms.vy) * Math.min(1, dt * 5.5);
        } else { ms.vy += (-sp2 * .5 - ms.vy) * Math.min(1, dt * 2); }
        ms.x += ms.vx * dt; ms.y += ms.vy * dt;
        ms.trail.push({ x: ms.x, y: ms.y, a: 1 });
        if (ms.trail.length > 9) ms.trail.shift();
        ms.trail.forEach((tp) => { tp.a -= dt * 3.2; });
        if (tg && Math.hypot(tg.x - ms.x, tg.y - ms.y) < tg.r + .012) {
          tg.dead = true; ms.dead = true; IV.score += 1;
          IV.pops.push({ x: tg.x, y: tg.y, t: this.NOTES[tg.pc], a: 1, sides: tg.sides, col: this.noteCol(tg.pc) });
          this.out(tg.pc, .85);   // SHOWRUNNER : la forme détruite joue sa note
        }
        if (ms.y < -.05 || ms.x < -.05 || ms.x > 1.05) ms.dead = true;
      });
      IV.msls = IV.msls.filter((ms) => !ms.dead).slice(-8);
      IV.shots.forEach((sh) => {
        IV.foes.forEach((fo) => {
          if (fo.dead || sh.dead) return;
          if (Math.abs(sh.x - fo.x) < fo.r && Math.abs(sh.y - fo.y) < fo.r * 1.2) {
            fo.dead = true; sh.dead = true; IV.score += 1;
            IV.pops.push({ x: fo.x, y: fo.y, t: this.NOTES[fo.pc], a: 1, sides: fo.sides, col: this.noteCol(fo.pc) });
            this.out(fo.pc, .8);   // SHOWRUNNER : idem
          }
        });
      });
      IV.foes = IV.foes.filter((fo) => !fo.dead).slice(-26);
      IV.shots = IV.shots.filter((sh) => !sh.dead).slice(-12);
    }
  },
  draw(x, w, h, P, S, C) {
    const R2 = Math.min(w, h);
    x.fillStyle = C.tick;
    S.stars.forEach((s2) => { x.globalAlpha = s2.s * .7; x.fillRect(s2.x * w, s2.y * h, 1, Math.max(1, s2.s * 3)); });
    x.globalAlpha = 1;
    S.foes.forEach((fo) => {
      x.strokeStyle = this.noteCol(fo.pc);
      x.lineWidth = 1.4;
      this.poly(x, fo.x * w, fo.y * h, fo.r * R2, fo.sides, 3.1416);
      x.lineWidth = 1;
      x.globalAlpha = .3;
      x.strokeStyle = this.noteCol(fo.pc);
      this.seg(x, fo.x * w, fo.y * h + fo.r * R2, fo.x * w, fo.y * h + fo.r * R2 + 22);
      x.globalAlpha = 1;
    });
    x.strokeStyle = C.acc2;
    S.shots.forEach((sh) => {
      const vx2 = sh.vx || 0, vy2 = sh.vy == null ? -1.15 : sh.vy;
      const nl = Math.hypot(vx2, vy2) || 1;
      this.seg(x, sh.x * w, sh.y * h, sh.x * w - vx2 / nl * 14, sh.y * h - vy2 / nl * 14);
    });
    (S.items || []).forEach((it) => {
      const ix = it.x * w, iy = it.y * h, r2 = Math.max(9, .05 * R2), bob = Math.sin(it.ph) * 2;
      if (it.kind === 'x3') {
        x.fillStyle = C.acc2;
        this.circ(x, ix, iy + bob, r2, 1);
        x.fillStyle = C.room;
        x.font = '700 ' + Math.round(r2 * .92) + 'px ' + C.font;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText('X3', ix, iy + bob + 1);
        x.textAlign = 'left'; x.textBaseline = 'alphabetic';
      } else {
        x.fillStyle = this.noteCol(it.pc);
        x.beginPath();
        x.moveTo(ix, iy + bob - r2); x.lineTo(ix + r2 * .8, iy + bob); x.lineTo(ix, iy + bob + r2); x.lineTo(ix - r2 * .8, iy + bob);
        x.closePath(); x.fill();
        x.strokeStyle = C.well;
        x.stroke();
      }
    });
    (S.msls || []).forEach((ms) => {
      const col = this.noteCol(ms.pc);
      ms.trail.forEach((tp) => {
        if (tp.a <= 0) return;
        x.globalAlpha = tp.a * .5;
        x.fillStyle = col;
        x.fillRect(tp.x * w - 1, tp.y * h - 1, 2, 2);
      });
      x.globalAlpha = 1;
      const mx2 = ms.x * w, my2 = ms.y * h, r3 = Math.max(5, .026 * R2);
      const ang = Math.atan2(ms.vy, ms.vx) + 1.5708;
      x.save();
      x.translate(mx2, my2); x.rotate(ang);
      x.fillStyle = col;
      x.beginPath();
      x.moveTo(0, -r3 * 1.3); x.lineTo(r3 * .72, 0); x.lineTo(0, r3 * 1.3); x.lineTo(-r3 * .72, 0);
      x.closePath(); x.fill();
      x.restore();
    });
    const sx = S.ship * w, sy = (S.shipY == null ? .82 : S.shipY) * h;
    x.save();
    x.translate(sx, sy);
    x.rotate(S.bank || 0);
    x.fillStyle = C.ink;
    x.beginPath();
    x.moveTo(0, -16); x.lineTo(13, 10); x.lineTo(5, 5); x.lineTo(0, 12);
    x.lineTo(-5, 5); x.lineTo(-13, 10);
    x.closePath(); x.fill();
    const th = S.thr == null ? .35 : S.thr;
    x.strokeStyle = C.acc2;
    for (let i = 0; i < 3; i++) {
      const l2 = (6 + th * 16) * (1 - i * .28) * (.8 + Math.random() * .4);
      x.globalAlpha = (.85 - i * .22) * th;
      this.seg(x, (i - 1) * 4, 8, (i - 1) * 4, 8 + l2);
    }
    x.globalAlpha = 1;
    x.strokeStyle = C.acc;
    this.seg(x, 0, -20, 0, -16);
    x.restore();
    x.strokeStyle = C.rule;
    this.seg(x, 0, h * .94, w, h * .94);
    S.pops.forEach((q) => {
      if (q.sides) { x.strokeStyle = q.col ? q.col : this.rgba(C.acc2, q.a.toFixed(2)); x.globalAlpha = q.a; this.poly(x, q.x * w, q.y * h, (1 - q.a) * 26 + 6, q.sides, 3.1416); x.globalAlpha = 1; }
      this.bubble(x, q.x * w, q.y * h - 20, q.t, q.a, C);
    });
    if (S.x3 || S.mn) {
      let hx = 10;
      x.font = '11px ' + C.font;
      if (S.x3) {
        x.fillStyle = C.acc2;
        this.circ(x, hx + 7, h - 14, 7, 1);
        x.fillStyle = C.room;
        x.font = '700 7px ' + C.font;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText('X3', hx + 7, h - 13);
        x.textAlign = 'left'; x.textBaseline = 'alphabetic';
        x.font = '11px ' + C.font;
        x.fillStyle = C.mut;
        x.fillText((S.x3 >= 2 ? '×6' : '×3') + ' · ' + Math.max(0, S.x3t || 0).toFixed(1) + ' s', hx + 19, h - 10);
        hx += 84;
      }
      if (S.mn && S.mpc != null) {
        const col = this.noteCol(S.mpc);
        for (let i = 0; i < S.mn; i++) {
          const dx3 = hx + 6 + i * 13;
          x.fillStyle = col;
          x.beginPath();
          x.moveTo(dx3, h - 21); x.lineTo(dx3 + 5, h - 14); x.lineTo(dx3, h - 7); x.lineTo(dx3 - 5, h - 14);
          x.closePath(); x.fill();
        }
        x.fillStyle = C.mut;
        x.fillText('clic droit · ' + this.NOTES[S.mpc], hx + 8 + S.mn * 13, h - 10);
      }
    }
    if (!S.hov) {
      x.fillStyle = this.rgba(C.well, '.72');
      x.fillRect(0, 0, w, h);
      x.strokeStyle = C.acc;
      x.lineWidth = 3;
      this.seg(x, w / 2 - 9, h / 2 - 14, w / 2 - 9, h / 2 + 14);
      this.seg(x, w / 2 + 9, h / 2 - 14, w / 2 + 9, h / 2 + 14);
      x.lineWidth = 1;
      x.font = '12px ' + C.font;
      x.fillStyle = C.mut;
      x.textAlign = 'center';
      x.fillText('survole pour jouer', w / 2, h / 2 + 40);
      x.textAlign = 'left';
    }
    this.ro(x, S.score + ' touchées', S.miss + ' manquées', C);
  },
  // SHOWRUNNER : le Playground lisait `ev.button`, une variable absente de
  // cvDown (« ev is not defined ») : le clic ne tirait jamais. C'est `e`.
  down(S, n, e) { S.inv.hov = true; if (e.button === 2) this.fireMsl(); else this.fireIV(); return false; },
  hover: true,
  trigger() { this.S.auto = .6; this.fireIV(); },
};

// ── 13 · BERCEAU ────────────────────────────────────────────────────────
SCENES.newt = {
  init() { return { a: new Array(7).fill(0), av: new Array(7).fill(0), grab: -1, pops: [], sgn: new Array(7).fill(0) }; },
  phys(S, dt) {
    const P = () => this.vals();
    const np2 = P('newt'), NW = S.newt, NB = Math.round(np2.num);
    const LN = .3 + np2.len / 100 * .5;
    NW.pops.forEach((q) => { q.a -= dt * (q.small ? 3.4 : 1.4); });
    NW.pops = NW.pops.filter((q) => q.a > 0).slice(-6);
    for (let i = 0; i < NB; i++) {
      if (i === NW.grab) continue;
      NW.av[i] += -(9.4 / LN) * Math.sin(NW.a[i]) * dt;
      NW.av[i] *= 1 - (np2.damp / 100) * dt * 2.4;
      NW.a[i] += NW.av[i] * dt;
    }
    for (let i = 0; i < NB - 1; i++) {
      if (NW.a[i] > NW.a[i + 1] && NW.av[i] > NW.av[i + 1]) {
        const va = NW.av[i], vb = NW.av[i + 1];
        NW.av[i] = vb; NW.av[i + 1] = va;
        const mid = (NW.a[i] + NW.a[i + 1]) / 2;
        NW.a[i] = Math.min(NW.a[i], mid); NW.a[i + 1] = Math.max(NW.a[i + 1], mid);
        if (Math.abs(va - vb) > .45 && NW.pops.filter((q) => q.small).length < 3) NW.pops.push({ i, t: 'pac', a: 1, small: true, at: mid, up: i % 2 });
      }
    }
    const chord = [];
    for (let i = 0; i < NB; i++) {
      const s2 = Math.sign(NW.av[i]);
      if (NW.sgn[i] && s2 && s2 !== NW.sgn[i] && Math.abs(NW.a[i]) > .12 && (i === 0 || i === NB - 1)) {
        NW.pops.push({ i, t: this.NOTES[this.NEWT_PC[i % 7]], a: 1 });
        chord.push(i);
        this.out(this.NEWT_PC[i % 7], Math.min(1, .45 + Math.abs(NW.a[i]) * .5));   // SHOWRUNNER : la bille de bout joue sa note
      }
      if (s2) NW.sgn[i] = s2;
    }
  },
  draw(x, w, h, P, S, C) {
    const NB = Math.round(P.num), LN = (.3 + P.len / 100 * .5);
    const px0 = w / 2, ytop = h * .07, L = LN * h * .82;
    const gap = .072 * w, rb = gap / 2;
    x.strokeStyle = C.tick2;
    x.strokeRect(px0 - (NB * gap) / 2 - 14, ytop - 16, NB * gap + 28, 12);
    for (let i = 0; i < NB; i++) {
      const rest = px0 + (i - (NB - 1) / 2) * gap;
      const bx = rest + Math.sin(S.a[i]) * L, by = ytop + Math.cos(S.a[i]) * L;
      x.strokeStyle = C.tick;
      this.seg(x, rest, ytop - 4, bx, by);
      const hot = Math.abs(S.av[i]) > .4;
      x.fillStyle = hot ? C.acc : C.face;
      this.circ(x, bx, by, rb * .94, 1);
      x.strokeStyle = hot ? C.acc : C.tick2;
      this.circ(x, bx, by, rb * .94);
      x.strokeStyle = hot ? C.well : C.tick;
      this.poly(x, bx, by, rb * .44, this.SIDES(this.NEWT_PC[i % 7]), 0);
      x.font = '11px ' + C.font;
      x.fillStyle = C.dim;
      x.textAlign = 'center';
      x.fillText(this.NOTES[this.NEWT_PC[i % 7]], rest, h - 10);
      x.textAlign = 'left';
      if (S.grab === i) { x.strokeStyle = C.acc2; this.circ(x, bx, by, rb * 1.3); }
    }
    S.pops.forEach((q) => {
      const rest = px0 + ((q.small ? q.i + .5 : q.i) - (NB - 1) / 2) * gap;
      const ang = q.small ? (q.at || 0) : S.a[q.i] || 0;
      const bx = rest + Math.sin(ang) * L, by = ytop + Math.cos(ang) * L;
      this.bubble(x, bx, by - (q.small ? rb + 10 + (q.up ? 14 : 0) : rb + 24), q.t, q.a, C, !q.small);
    });
    let en = 0;
    for (let i = 0; i < NB; i++) en += Math.abs(S.av[i]);
    this.ro(x, en > .3 ? 'en mouvement' : 'au repos', 'énergie ' + Math.round(en * 30), C);
  },
  down(S, n) {
    const NB = Math.round(this.V('newt', 'num'));
    let bi = -1, bd = 9;
    for (let i = 0; i < NB; i++) { const d = Math.abs(n.x - (.5 + (i - (NB - 1) / 2) * .072)); if (d < bd) { bd = d; bi = i; } }
    if (bd < .05) { S.newt.grab = bi; S.newt.av[bi] = 0; }
  },
  move(S, m) {
    if (S.newt.grab < 0) return;
    const i = S.newt.grab, NB = Math.round(this.V('newt', 'num'));
    const rest = .5 + (i - (NB - 1) / 2) * .072;
    const na = this.clamp((m.x - rest) * 4.2, -1.15, 1.15);
    S.newt.av[i] = (na - S.newt.a[i]) * 9;
    S.newt.a[i] = na;
  },
  up(S) { S.newt.grab = -1; },
  // une note reçue lève la bille de gauche et la lâche
  trigger(ev) { const NW = this.S; if (NW.grab >= 0) return; NW.a[0] = -(.5 + (ev.v ?? .8) * .5); NW.av[0] = 0; },
  modOut(S) { let en = 0; for (const v of S.av) en += Math.abs(v); return Math.min(1, en / 8); },
};
