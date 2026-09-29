// JOUETS — le son des quatre jouets qu'on traverse (REEL–2, RESSORT, AIMANT,
// ALCHIMIE) : des nœuds du moteur (moteur.js, makeNode) au même contrat que
// les autres modules — { input, output, update(m), setAt(k, v, t) } — plus
// `live(état)`, ce que la scène fait en direct (scruber la bande, pincer le
// ressort, verser, l'aimant immobile). Les dix autres n'ont pas de son : un
// nœud muet, pour que le graphe les connaisse sans rien câbler.
//
// Le moteur de chacun, et pourquoi :
//   REEL–2  un écho à bande : retard réinjecté, filtre dans la boucle (celui
//           de RTT-01, odio/effects/delay.js), et le « wow » : un sinus sur le
//           temps de retard, à la fréquence du brin de bande dessiné
//           (sin(a × 3,1), a tournant à 0,5 + vitesse / 40 rad/s). Scruber
//           change la vitesse de bande, donc le temps (et la hauteur) de l'écho.
//   RESSORT la réverbe d'ODIO (rvb-02, convolution) ; decay = decay × 0,06 s,
//           ce que la scène affiche ; l'énergie de la corde pincée ouvre le
//           mélange (ODIO_01 : « l'énergie de la corde EST la réverbération »).
//   AIMANT  le filtre d'ODIO (flt-07), comme ODIO_01 (AimantEffect étend
//           FilterEffect) : x → coupure 40 Hz × 400^x (la lecture de la scène),
//           y → résonance ; le chemin bouclé se rejoue sur le transport, à la
//           lecture comme à l'export.
//   ALCHIMIE le volume d'ODIO (vol-05), comme ODIO_01 (AlchimieEffect étend
//           VolumeEffect) : le niveau du liquide est l'amplitude.
// Les nombres qui ne sont pas lus sur le Playground sont des choix de réglage,
// dits en commentaire.

import { val } from '../modules.js';
import { ReverbEffect } from '../odio/effects/reverb.js';
import { FilterEffect } from '../odio/effects/filter.js';
import { VolumeEffect } from '../odio/effects/volume.js';
import { magAt } from './scenes.js';

const G = (ctx, gain = 1) => new GainNode(ctx, { gain });
const live = (ctx) => !(ctx instanceof OfflineAudioContext) && ctx.state === 'running';
function glide(ctx, param, v, tc) {
  if (live(ctx)) param.setTargetAtTime(v, ctx.currentTime, tc); else param.value = v;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── les réglages, lus comme le Playground les lit ───────────────────────
const P = (m, over, k) => (over[k] !== undefined ? over[k] : val(m, k));

// REEL–2 : la bande
function reel(ctx, m) {
  const input = G(ctx), output = G(ctx), dry = G(ctx), wet = G(ctx, 0.5);
  const dl = new DelayNode(ctx, { maxDelayTime: 2.4 });
  const fb = G(ctx, 0), tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3400 });
  const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.8 }), depth = G(ctx, 0);
  input.connect(dry).connect(output);
  input.connect(dl).connect(tone).connect(fb).connect(dl);   // la boucle passe par un DelayNode (MDN)
  tone.connect(wet).connect(output);
  lfo.connect(depth).connect(dl.delayTime);
  lfo.start();
  let over = {}, scrub = 0, on = true;
  const apply = (mm) => {
    const speed = P(mm, over, 'speed'), v0 = 0.5 + speed / 40;
    // le temps d'écho : 800 ms bande à l'arrêt, 80 ms à fond (loi géométrique) — choix de réglage
    const base = 0.8 * Math.pow(0.1, speed / 100);
    const v = Math.max(v0 * 0.15, v0 + scrub);
    glide(ctx, dl.delayTime, clamp(base * v0 / v, 0.02, 2.3), 0.05);
    glide(ctx, fb.gain, (P(mm, over, 'fdb') / 100) * 0.92, 0.01);   // plafond de RTT-01 : 92 %
    glide(ctx, lfo.frequency, (3.1 * v0) / (2 * Math.PI), 0.05);
    glide(ctx, depth.gain, (P(mm, over, 'wow') / 100) * 0.004, 0.02);   // 4 ms de pleurage au plus — choix de réglage
    glide(ctx, wet.gain, on ? 0.5 : 0, 0.012);
  };
  let cur = m;
  apply(m);
  return {
    input, output,
    update(mm) { cur = mm; over = {}; on = mm.on !== false; apply(mm); },
    setAt(k, v) { over[k] = v; apply(cur); },
    live(s) { if (Math.abs(s.scrub - scrub) > 0.01) { scrub = s.scrub; apply(cur); } },
    probe: () => ({ time: dl.delayTime.value, fdb: fb.gain.value, wow: depth.gain.value, lfo: lfo.frequency.value }),
    dispose() { try { lfo.stop(); } catch { /* déjà arrêté */ } for (const n of [input, dl, tone, fb, dry, wet, lfo, depth]) n.disconnect(); },
  };
}

// RESSORT : la réverbe d'ODIO ; tension → amorti (1,5 à 18 kHz, loi
// géométrique, 5,2 kHz à la tension par défaut : le défaut de rvb-02) — choix de réglage
function sprg(ctx, m) {
  const fx = new ReverbEffect(ctx);
  let over = {}, boost = 0, cur = m;
  const apply = (mm) => {
    fx.setParameter('decay', clamp(P(mm, over, 'decay') * 0.06, 0.2, 8));
    fx.setParameter('damp', 1500 * Math.pow(12, (P(mm, over, 'tens') - 10) / 90));
    fx.setParameter('mix', clamp(P(mm, over, 'mix') + boost, 0, 100));
    fx.setEnabled(mm.on !== false);
  };
  apply(m);
  return {
    input: fx.input, output: fx.output, odio: fx,
    update(mm) { cur = mm; over = {}; apply(mm); },
    setAt(k, v) { over[k] = v; apply(cur); },
    // l'énergie de la corde (0..1) ouvre le mélange de 50 points au plus — choix de réglage
    live(e) { const b = Math.round(e * 50); if (b !== boost) { boost = b; apply(cur); } },
    probe: () => ({ mix: fx.getParameter('mix'), decay: fx.getParameter('decay'), damp: fx.getParameter('damp') }),
    flush() { fx.flush(); },
    dispose() { try { fx.dispose(); } catch { /* déjà défait */ } },
  };
}

// AIMANT : le filtre d'ODIO piloté par la position de l'aimant
export const magCutoff = (x) => 40 * Math.pow(400, x);          // la lecture de la scène (d_mag)
export const magReso = (y) => 0.7 * Math.pow(18 / 0.7, 1 - y);  // haut = résonant ; 3,5 au milieu, le défaut de flt-07 — choix de réglage
function mag(ctx, m) {
  const fx = new FilterEffect(ctx);
  let x = 0.42, y = 0.5;   // la position de départ de l'aimant (initSim)
  const put = (t) => { fx.setParameter('cutoff', magCutoff(x), t); fx.setParameter('reso', magReso(y), t); };
  put();
  return {
    input: fx.input, output: fx.output, odio: fx,
    update(mm) { fx.setEnabled(mm.on !== false); },
    setAt() {},
    pos(nx, ny, t) { x = nx; y = ny; put(t); },
    live(s) { if (Math.abs(s.x - x) > 1e-4 || Math.abs(s.y - y) > 1e-4) this.pos(s.x, s.y); },
    probe: () => ({ cutoff: fx.getParameter('cutoff'), reso: fx.getParameter('reso') }),
    dispose() { try { fx.dispose(); } catch { /* déjà défait */ } },
  };
}
// la phase du chemin sur le transport : une boucle de 1, 2, 4 ou 8 mesures
export function magPhase(beat, bars, sig) {
  const n = [1, 2, 4, 8][Math.round(bars)] * sig;
  return (((beat / n) % 1) + 1) % 1;
}

// ALCHIMIE : le volume d'ODIO ; l'amplitude est le niveau du liquide
const levelDb = (u) => Math.max(-60, 20 * Math.log10(Math.max(1e-4, u)));
function alch(ctx, m) {
  const fx = new VolumeEffect(ctx);
  let over = {}, cur = m, liquid = null;
  const apply = (mm) => {
    fx.setParameter('niveau', levelDb(liquid ?? P(mm, over, 'level') / 100));
    fx.setEnabled(mm.on !== false);
  };
  apply(m);
  return {
    input: fx.input, output: fx.output, odio: fx,
    update(mm) { cur = mm; over = {}; liquid = null; apply(mm); },
    setAt(k, v) { over[k] = v; if (k === 'level') liquid = null; apply(cur); },
    live(s) { if (liquid === null || Math.abs(s.cur - liquid) > 0.002) { liquid = s.cur; apply(cur); } },
    probe: () => ({ niveau: fx.getParameter('niveau') }),
    dispose() { try { fx.dispose(); } catch { /* déjà défait */ } },
  };
}

const MAKE = { reel, sprg, mag, alch };
export function jouetNode(ctx, m) {
  const make = MAKE[m.type];
  if (make) return make(ctx, m);
  // un jouet sans son : un nœud muet que rien n'écoute
  return { input: null, output: G(ctx, 0), update() {} };
}

// ── le chemin de l'aimant, planifié comme une automation (moteur.js,
// Graph.automate) : une position par double croche entre b0 et b1, posée
// à son instant — la lecture et l'export entendent la même chose
export function jouetsAutomate(graph, p, b0, b1, at) {
  for (const m of p.modules) {
    if (m.type !== 'mag' || !Array.isArray(m.path) || m.path.length <= 3) continue;
    const n = graph.nodes.get(m.id);
    if (!n?.pos) continue;
    const bars = val(m, 'bars'), mg = { path: m.path, x: 0, y: 0 };
    for (let b = Math.ceil(b0 * 4 - 1e-9) / 4; b < b1; b += 0.25) {
      magAt(mg, magPhase(b, bars, p.sig || 4));
      n.pos(mg.x, mg.y, at(b));
    }
  }
}
