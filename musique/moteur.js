// MUSIQUE — le moteur Web Audio.
//
// Un projet devient un graphe de nœuds Web Audio : chaque module (source,
// effet, tranche de piste, entrée de bus, sortie) est un petit groupe de
// nœuds avec une entrée et une sortie ; les câbles du projet sont les
// connexions, et un câble qui porte un niveau (`send`, en dB) est un envoi
// de la console vers un bus. Le même code construit le graphe dans
// l'AudioContext de la page (on joue) et dans un OfflineAudioContext (on
// exporte en WAV) : ce qu'on entend est ce qu'on exporte, automation et arc
// d'énergie compris.
//
// Le temps : tout se planifie sur l'horloge audio (AudioContext.currentTime),
// jamais au setTimeout. Un minuteur réveille seulement le planificateur
// toutes les 25 ms, qui pose les notes des 120 prochaines millisecondes —
// la méthode de MDN, « Advanced techniques: Creating and sequencing audio »
// (lookahead 25 ms, scheduleAheadTime 0.1 s), d'après « A Tale of Two
// Clocks » (Chris Wilson). Le minuteur tourne dans un Worker : un onglet en
// arrière-plan ralentit les setTimeout de la page, pas ceux d'un Worker.
//
// L'automation (et l'arc d'énergie) : des points (temps, valeur 0..1) reliés
// en ligne droite. Chaque tranche planifiée pose sur l'AudioParam une valeur
// au début (setValueAtTime) puis des rampes linéaires jusqu'à chaque point
// et à la fin de la tranche (linearRampToValueAtTime) — AudioParam, MDN.

import { MODULES, DRUM_VOICES, WAVES, FILTER_TYPES, DELAY_DIVS, val, spec, fromNorm, dbToGain, drumVoicesOf } from './modules.js';
import { jouetNode, jouetsAutomate } from './jouets/son.js';   // jouets : le son des jouets du Playground
import { influer, rendre } from './machines/influence.js';   // attracteurs : ce que les attracteurs du banc font au son (nodal)
import { trajets } from './projet.js';   // les chaînes des pistes, lues dans les câbles (une seule vérité)

const LOOKAHEAD_MS = 25;      // MDN : « lookahead = 25.0 »
const AHEAD_S = 0.12;         // MDN : « scheduleAheadTime = 0.1 » (+ 20 ms de marge au démarrage d'onglet)
const DEPART_S = 0.05;        // la lecture part 50 ms après l'instant présent (playFrom) ; l'export s'y cale (renderMix)

// ── petites aides ───────────────────────────────────────────
const G = (ctx, gain = 1) => new GainNode(ctx, { gain });
// les AudioParam que l'automation tient pendant la lecture : une molette ou
// un enregistrement du projet ne les reprend pas avant l'arrêt
const HELD = new WeakSet();
function setP(ctx, param, v, tc = 0.012) {
  if (HELD.has(param)) return;
  // une molette qu'on tourne pendant la lecture : on glisse vers la valeur
  // (AudioParam.setTargetAtTime, MDN) plutôt que de sauter, sinon ça claque
  if (ctx instanceof OfflineAudioContext || ctx.state !== 'running') param.value = v;
  else param.setTargetAtTime(v, ctx.currentTime, tc);
}
const nyq = (ctx, f) => Math.min(f, ctx.sampleRate * 0.45);
const same = (v) => v;

// Bruit blanc : un tampon rempli de Math.random() * 2 - 1 (MDN, Advanced
// techniques, « playNoise »). Un seul par contexte, relu par chaque frappe.
const NOISE = new WeakMap();
function noise(ctx) {
  let b = NOISE.get(ctx);
  if (!b) {
    b = new AudioBuffer({ length: ctx.sampleRate * 2, sampleRate: ctx.sampleRate, numberOfChannels: 1 });
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    NOISE.set(ctx, b);
  }
  return b;
}

// Réponse impulsionnelle synthétique : du bruit stéréo qui décroît de
// 60 dB en `time` secondes (la définition du RT60). Même principe que la
// réverbération de Tone.js : « convolution created with decaying noise ».
function impulse(ctx, time) {
  const n = Math.max(1, Math.round(time * ctx.sampleRate));
  const b = new AudioBuffer({ length: n, sampleRate: ctx.sampleRate, numberOfChannels: 2 });
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(10, (-3 * i) / n);
  }
  return b;
}

// Courbe de saturation : l'exemple de la page WaveShaperNode de MDN
// (makeDistortionCurve), k de 0 à 100. Exportée : la vue Instruments en
// dessine la table (musique/appareils/calcul.js).
export function distCurve(k) {
  const n = 4096, curve = new Float32Array(n), deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// Une enveloppe qu'on relâche : on fige la valeur à `t` puis on glisse
// vers 0 ; la constante de temps vaut le quart de la chute, soit ~ -35 dB
// au bout de la chute (setTargetAtTime approche la cible en e^(-t/τ)).
function release(param, t, r) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else { param.cancelScheduledValues(t); }
  param.setTargetAtTime(0, t, Math.max(0.002, r / 4));
}

// ── les clips audio : la géométrie de la vue Clip ────────────
// Le son à l'envers : une copie retournée, faite une fois par son (le Web
// Audio ne lit pas à vitesse négative : AudioBufferSourceNode.playbackRate).
const REVERSED = new WeakMap();
export function clipBuffer(buf, c) {
  if (!buf || !c?.rev) return buf;
  let r = REVERSED.get(buf);
  if (!r) {
    r = new AudioBuffer({ length: buf.length, sampleRate: buf.sampleRate, numberOfChannels: buf.numberOfChannels });
    for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch).slice().reverse(); r.copyToChannel(d, ch); }
    REVERSED.set(buf, r);
  }
  return r;
}
// vitesse, départ, boucle d'un clip audio, bornés par la durée du son D
export function audioGeom(c, D) {
  const rate = Math.pow(2, (c.pitch || 0) / 12);
  const off = Math.max(0, Math.min(c.off || 0, Math.max(0, D - 0.001)));
  const loop = !!c.loop;
  const ls = loop ? Math.max(0, Math.min(c.ls ?? off, D - 0.02)) : off;
  const llen = loop ? Math.max(0.02, Math.min(c.llen || (D - ls), D - ls)) : 0;
  return { rate, off, loop, ls, llen };
}

// La valeur d'une courbe de points [[temps, valeur], …] triés : ligne
// droite entre deux points, palier avant le premier et après le dernier.
export function interp(pts, b) {
  if (!pts?.length) return null;
  if (b <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (b >= last[0]) return last[1];
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= b) lo = mid; else hi = mid; }
  const [xa, ya] = pts[lo], [xb, yb] = pts[hi];
  return xb === xa ? yb : ya + ((yb - ya) * (b - xa)) / (xb - xa);
}

// pose une courbe entre b0 et b1 sur des AudioParam : [[param, fn], …]
function ramp(targets, pts, b0, b1, at, conv) {
  const seg = [[b0, interp(pts, b0)]];
  for (const [b, v] of pts) if (b > b0 && b < b1) seg.push([b, v]);
  seg.push([b1, interp(pts, b1)]);
  for (const [param, fn] of targets) {
    HELD.add(param);
    param.setValueAtTime(fn(conv(seg[0][1])), at(seg[0][0]));
    for (let i = 1; i < seg.length; i++) param.linearRampToValueAtTime(fn(conv(seg[i][1])), Math.max(at(seg[i][0]), at(seg[0][0])));
  }
}

// ── les modules ─────────────────────────────────────────────
// Chaque fabrique rend { input, output, update(mod, bpm), ap: {k: [[AudioParam, fn]]}, …actions }.

function effectShell(ctx, core) {
  const input = G(ctx), output = G(ctx);
  core.out.connect(output);
  let bypassed = null;
  return {
    input, output,
    setOn(on) {
      if (bypassed === !on) return;
      bypassed = !on;
      input.disconnect();
      input.connect(on ? core.in : output);
    },
  };
}

// fondu à puissance constante entre le son sec et l'effet
const cosMix = (v) => Math.cos(v * Math.PI / 2);
const sinMix = (v) => Math.sin(v * Math.PI / 2);

const FX = {
  delay(ctx) {
    const inp = G(ctx), out = G(ctx), dry = G(ctx), wet = G(ctx);
    const dl = new DelayNode(ctx, { maxDelayTime: 4 });
    const fb = G(ctx), lp = new BiquadFilterNode(ctx, { type: 'lowpass' });
    inp.connect(dry).connect(out);
    inp.connect(dl).connect(wet).connect(out);
    dl.connect(lp).connect(fb).connect(dl);   // la boucle de retour : permise car elle passe par un DelayNode (MDN)
    return {
      core: { in: inp, out },
      ap: { mix: [[wet.gain, same]], fb: [[fb.gain, same]] },
      update(m, bpm) {
        setP(ctx, dl.delayTime, Math.min(4, DELAY_DIVS[val(m, 'div')] * 60 / bpm), 0.05);
        setP(ctx, fb.gain, val(m, 'fb'));
        setP(ctx, lp.frequency, nyq(ctx, val(m, 'tone')));
        setP(ctx, wet.gain, val(m, 'mix'));
        setP(ctx, dry.gain, val(m, 'dry') ? 0 : 1);
      },
    };
  },
  reverb(ctx) {
    const inp = G(ctx), out = G(ctx), dry = G(ctx), wet = G(ctx);
    const pre = new DelayNode(ctx, { maxDelayTime: 0.5 });
    const damp = new BiquadFilterNode(ctx, { type: 'lowpass' });
    let conv = null, irTime = 0, pend = null;
    inp.connect(dry).connect(out);
    inp.connect(pre);
    damp.connect(wet).connect(out);
    const setIR = (time) => {
      const c = new ConvolverNode(ctx, { buffer: impulse(ctx, time) });
      pre.connect(c).connect(damp);
      if (conv) { pre.disconnect(conv); conv.disconnect(); }
      conv = c; irTime = time;
    };
    return {
      core: { in: inp, out },
      ap: { mix: [[dry.gain, cosMix], [wet.gain, sinMix]] },
      update(m) {
        const time = val(m, 'time');
        if (!conv) setIR(time);
        else if (Math.abs(time - irTime) > 0.005) {
          // recalculer la réponse coûte : une fois la molette posée
          clearTimeout(pend);
          pend = setTimeout(() => setIR(time), 120);
        }
        setP(ctx, pre.delayTime, val(m, 'pre'));
        setP(ctx, damp.frequency, nyq(ctx, val(m, 'damp')));
        const mix = val(m, 'mix');
        setP(ctx, dry.gain, cosMix(mix)); setP(ctx, wet.gain, sinMix(mix));
      },
    };
  },
  comp(ctx) {
    const c = new DynamicsCompressorNode(ctx), g = G(ctx);
    c.connect(g);
    return {
      core: { in: c, out: g },
      // la réduction de gain lue par le mètre de la vue Instruments (musique/appareils/)
      reduction: () => c.reduction,
      ap: { thr: [[c.threshold, same]], gain: [[g.gain, dbToGain]] },
      update(m) {
        setP(ctx, c.threshold, val(m, 'thr')); setP(ctx, c.ratio, val(m, 'ratio'));
        setP(ctx, c.attack, val(m, 'att')); setP(ctx, c.release, val(m, 'rel'));
        setP(ctx, c.knee, val(m, 'knee')); setP(ctx, g.gain, dbToGain(val(m, 'gain')));
      },
    };
  },
  // Cinq étages en série (la découpe d'EQ Eight, docs/etudes/odio_appareils.md) :
  // coupe-bas (12 dB/oct.), plateau grave, cloche, plateau aigu, coupe-haut
  // (12 dB/oct.), puis le gain de sortie. Une coupe éteinte sort du trajet
  // (pas un passe-tout : rien ne tourne la phase) ; éteintes, le son est
  // celui de l'égaliseur trois bandes d'avant. Le Q d'une coupe se règle en
  // Q linéaire (0,71 : Butterworth) ; le nœud le lit en décibels pour ces
  // deux types (spécification Web Audio, α_QdB) : 20·log10(Q).
  eq(ctx) {
    const inp = G(ctx), out = G(ctx);
    const hp = new BiquadFilterNode(ctx, { type: 'highpass' });
    const lo = new BiquadFilterNode(ctx, { type: 'lowshelf' });
    const mid = new BiquadFilterNode(ctx, { type: 'peaking', Q: 0.9 });
    const hi = new BiquadFilterNode(ctx, { type: 'highshelf' });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass' });
    let trajet = null;
    const cabler = (h, l) => {
      const cle = `${h}${l}`;
      if (cle === trajet) return;
      trajet = cle;
      for (const n of [inp, hp, lo, mid, hi, lp]) n.disconnect();
      const ch = [inp, ...(h ? [hp] : []), lo, mid, hi, ...(l ? [lp] : []), out];
      for (let i = 0; i < ch.length - 1; i++) ch[i].connect(ch[i + 1]);
    };
    return {
      core: { in: inp, out },
      ap: { lg: [[lo.gain, same]], mg: [[mid.gain, same]], hg: [[hi.gain, same]], mf: [[mid.frequency, same]],
        hpf: [[hp.frequency, same]], lpf: [[lp.frequency, (v) => nyq(ctx, v)]] },
      update(m) {
        cabler(val(m, 'hpo') ? 1 : 0, val(m, 'lpo') ? 1 : 0);
        setP(ctx, hp.frequency, val(m, 'hpf')); setP(ctx, hp.Q, 20 * Math.log10(val(m, 'hpq')));
        setP(ctx, lo.frequency, val(m, 'lf')); setP(ctx, lo.gain, val(m, 'lg'));
        setP(ctx, mid.frequency, val(m, 'mf')); setP(ctx, mid.gain, val(m, 'mg')); setP(ctx, mid.Q, val(m, 'mq'));
        setP(ctx, hi.frequency, nyq(ctx, val(m, 'hf'))); setP(ctx, hi.gain, val(m, 'hg'));
        setP(ctx, lp.frequency, nyq(ctx, val(m, 'lpf'))); setP(ctx, lp.Q, 20 * Math.log10(val(m, 'lpq')));
        setP(ctx, out.gain, dbToGain(val(m, 'out')));
      },
    };
  },
  filter(ctx) {
    const f = new BiquadFilterNode(ctx);
    return {
      core: { in: f, out: f },
      ap: { freq: [[f.frequency, (v) => nyq(ctx, v)]], q: [[f.Q, same]] },
      update(m) {
        f.type = FILTER_TYPES[val(m, 'type')];
        setP(ctx, f.frequency, nyq(ctx, val(m, 'freq'))); setP(ctx, f.Q, val(m, 'q'));
      },
    };
  },
  dist(ctx) {
    const inp = G(ctx), out = G(ctx), dry = G(ctx), wet = G(ctx);
    const sh = new WaveShaperNode(ctx, { oversample: '4x' });
    const tone = new BiquadFilterNode(ctx, { type: 'lowpass' });
    const post = G(ctx);
    inp.connect(dry).connect(post);
    inp.connect(sh).connect(tone).connect(wet).connect(post);
    post.connect(out);
    let k = -1;
    return {
      core: { in: inp, out },
      ap: { mix: [[dry.gain, cosMix], [wet.gain, sinMix]] },
      update(m) {
        const d = val(m, 'drive');
        if (d !== k) { sh.curve = distCurve(d); k = d; }
        setP(ctx, tone.frequency, nyq(ctx, val(m, 'tone')));
        const mix = val(m, 'mix');
        setP(ctx, dry.gain, cosMix(mix)); setP(ctx, wet.gain, sinMix(mix));
        setP(ctx, post.gain, dbToGain(val(m, 'out')));
      },
    };
  },
};

// ── la DR-9 : huit voix synthétisées ────────────────────────
// Recettes :
//  bd, sd, ch  — Chris Lowis, « Synthesising Drum Sounds with the Web Audio
//                API » (dev.opera.com), valeurs relues dans sa reprise par
//                Sonoport (sonoport.github.io/synthesising-sounds-webaudio) :
//                grosse caisse = triangle 120 Hz + sinus 50 Hz qui chutent
//                exponentiellement vers 0,001 en 0,5 s, gain 1 → 0,001 ;
//                caisse claire = bruit passe-haut (100 → 1000 Hz en 0,2 s),
//                gain 1 → 0,01 en 0,2 s + triangle 100 Hz 0,7 → 0,01 en 0,1 s ;
//                charley = six carrés sur 40 Hz × [2, 3, 4.16, 5.43, 6.79,
//                8.21] (la recette de la TR-808), passe-bande 10 kHz,
//                passe-haut 7 kHz, gain 1 → 0,01 en 0,05 s.
//  oh          — le même charley, déclin 0,3 s (choix de réglage) ; un
//                charley fermé l'étouffe, comme sur la 808.
//  cp          — Baratatronix, « Roland TR-808 Clap Synthesis » : bruit
//                passe-bande 1 kHz, trois enveloppes en dents de scie de
//                10 ms puis une décharge de 20 ms, et en parallèle une
//                traîne de 100 ms (la « réverbération » du circuit).
//  lt, ht      — oramics synth-kit, tom : 165 Hz, déclin 0,31 s (tom aigu) ;
//                le tom grave est une quinte dessous et les deux glissent
//                de 20 % vers le grave (choix de réglage, non sourcé).
//  cb          — oramics synth-kit, cowbell : triangles 587 et 845 Hz
//                (les valeurs de Sound On Sound, Synth Secrets 2002),
//                passe-bande 2640 Hz Q 3,5, déclins 0,05 s et 0,1 s.
// Les gains de sortie par voix (VOICE_GAIN) règlent les crêtes, mesurées
// dans un rendu hors temps réel de chaque voix seule (docs/etudes/musique.md,
// 28/09) : grosse caisse -12 dBFS, caisse claire -14, clap et toms -15,
// charleys et cloche -18 — la marge d'une piste de mixage : le projet de
// départ (batterie + basse + délai) crête alors sous -3 dBFS.
const VOICE_GAIN = { bd: 0.226, sd: 0.215, cp: 0.75, ch: 0.085, oh: 0.085, lt: 0.27, ht: 0.26, cb: 1.45 };

function drumVoice(ctx, out, voice, t, vel, m, live, st) {
  const tune = Math.pow(2, val(m, `${voice}_tune`) / 12);
  const dec = val(m, `${voice}_dec`);
  const lvl = dbToGain(val(m, `${voice}_lvl`)) * vel * (VOICE_GAIN[voice] || 1);
  const srcs = [];
  const osc = (type, frequency) => { const o = new OscillatorNode(ctx, { type, frequency }); srcs.push(o); return o; };
  const nz = () => { const s = new AudioBufferSourceNode(ctx, { buffer: noise(ctx) }); srcs.push(s); return s; };
  let end = t + 0.5;
  if (voice === 'bd') {
    const d = 0.5 * dec, g = G(ctx, 0);
    const o1 = osc('triangle', 120 * tune), o2 = osc('sine', 50 * tune);
    for (const [o, f] of [[o1, 120], [o2, 50]]) {
      o.frequency.setValueAtTime(f * tune, t);
      o.frequency.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g);
    }
    g.gain.setValueAtTime(lvl, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    g.connect(out); end = t + d;
  } else if (voice === 'sd') {
    const d = 0.2 * dec;
    const n = nz(), hp = new BiquadFilterNode(ctx, { type: 'highpass' }), ng = G(ctx, 0);
    hp.frequency.setValueAtTime(100 * tune, t); hp.frequency.linearRampToValueAtTime(1000 * tune, t + 0.2);
    ng.gain.setValueAtTime(lvl, t); ng.gain.exponentialRampToValueAtTime(0.01 * lvl + 1e-5, t + d);
    n.connect(hp).connect(ng).connect(out);
    const o = osc('triangle', 100 * tune), og = G(ctx, 0);
    og.gain.setValueAtTime(0.7 * lvl, t); og.gain.exponentialRampToValueAtTime(0.01 * lvl + 1e-5, t + 0.1 * dec);
    o.connect(og).connect(out);
    end = t + Math.max(d, 0.1 * dec);
  } else if (voice === 'cp') {
    const n = nz(), bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1000 * tune, Q: 1.5 });
    const g1 = G(ctx, 0), g2 = G(ctx, 0);
    for (let k = 0; k < 3; k++) {                       // trois dents de scie de 10 ms
      g1.gain.setValueAtTime(lvl, t + k * 0.01);
      g1.gain.exponentialRampToValueAtTime(0.05 * lvl + 1e-5, t + k * 0.01 + 0.0095);
    }
    g1.gain.setValueAtTime(lvl, t + 0.03);            // la décharge de 20 ms
    g1.gain.exponentialRampToValueAtTime(1e-4, t + 0.05);
    g2.gain.setValueAtTime(0.4 * lvl, t);             // la traîne de 100 ms
    g2.gain.exponentialRampToValueAtTime(1e-4, t + 0.1 * dec + 0.03);
    n.connect(bp); bp.connect(g1).connect(out); bp.connect(g2).connect(out);
    end = t + 0.1 * dec + 0.05;
  } else if (voice === 'ch' || voice === 'oh') {
    const d = (voice === 'ch' ? 0.05 : 0.3) * dec;
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: nyq(ctx, 10000) });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: nyq(ctx, 7000) });
    const g = G(ctx, 0);
    for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) osc('square', 40 * tune * r).connect(bp);
    bp.connect(hp).connect(g).connect(out);
    g.gain.setValueAtTime(lvl, t); g.gain.exponentialRampToValueAtTime(0.01 * lvl + 1e-5, t + d);
    if (voice === 'ch' && st.oh) {                   // le fermé étouffe l'ouvert
      release(st.oh.gain, t, 0.01);
    }
    if (voice === 'oh') st.oh = g;
    end = t + d;
  } else if (voice === 'lt' || voice === 'ht') {
    const f = (voice === 'ht' ? 165 : 110) * tune, d = 0.31 * dec;
    const o = osc('sine', f), g = G(ctx, 0);
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.8, t + d);
    g.gain.setValueAtTime(lvl, t); g.gain.exponentialRampToValueAtTime(1e-4, t + d);
    o.connect(g).connect(out); end = t + d;
  } else if (voice === 'cb') {
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: nyq(ctx, 2640 * tune), Q: 3.5 });
    end = t;
    // oramics : env1 gain 0,6 attaque 0,01 déclin 0,05 ; env2 gain 0,8 attaque 0,1 déclin 0,1
    for (const [f, a, att, d] of [[587, 0.6, 0.01, 0.05], [845, 0.8, 0.1, 0.1]]) {
      const o = osc('triangle', f * tune), g = G(ctx, 0);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a * lvl, t + att);
      g.gain.exponentialRampToValueAtTime(1e-4, t + att + d * dec);
      o.connect(g).connect(bp);
      end = Math.max(end, t + att + d * dec);
    }
    bp.connect(out);
  }
  for (const s of srcs) { s.start(t); s.stop(end + 0.02); live(s); }
}

// ── les sources ─────────────────────────────────────────────
const SRC = {
  drums(ctx, m, env) {
    const out = G(ctx), st = {};
    return {
      output: out,
      ap: { lvl: [[out.gain, dbToGain]] },
      update(mm) { m = mm; setP(ctx, out.gain, mm.on === false ? 0 : dbToGain(val(mm, 'lvl'))); },
      hit(voice, t, vel = 1) { drumVoice(ctx, out, voice, t, vel, m, env.live, st); },
      noteOn(p, t, vel) { const v = DRUM_VOICES[((p % 12) + 12) % 12]; if (v) drumVoice(ctx, out, v.id, t, vel, m, env.live, st); return null; },
      noteOff() {},
    };
  },
  synth(ctx, m, env) {
    const out = G(ctx);
    // Deux oscillateurs : A (1 à 3 copies réparties dans le désaccord) et B
    // (« comme A » : le second oscillateur d'avant, présent si le désaccord
    // est non nul) → passe-bas à enveloppe → ADSR.
    const voice = (p, t, vel, over) => {
      const f = 440 * Math.pow(2, (p + 12 * val(m, 'oct') - 69) / 12);
      const wA = WAVES[val(m, 'wave')], det = val(m, 'det'), uni = Math.round(val(m, 'uni'));
      const w2 = Math.round(val(m, 'wave2'));
      const detA = uni <= 1 ? [-det / 2] : uni === 2 ? [-det / 2, det / 2] : [-det, 0, det];
      const hasB = w2 === 0 ? det > 0 && uni <= 1 : w2 !== 5;
      const mix2 = val(m, 'mix2');
      const mix = G(ctx, 1), oscs = [];
      const aBus = G(ctx, (hasB ? 1 - mix2 : 1) / Math.sqrt(detA.length));
      for (const d of detA) { const o = new OscillatorNode(ctx, { type: wA, frequency: f, detune: d }); o.connect(aBus); oscs.push(o); }
      aBus.connect(mix);
      if (hasB) {
        const o = new OscillatorNode(ctx, { type: w2 === 0 ? wA : WAVES[w2 - 1], frequency: f * Math.pow(2, val(m, 'oct2')), detune: det / 2 });
        o.connect(G(ctx, mix2)).connect(mix); oscs.push(o);
      }
      const flt = new BiquadFilterNode(ctx, { type: 'lowpass', Q: val(m, 'res') });
      const amp = G(ctx, 0);
      const a = val(m, 'a'), d = val(m, 'd'), s = val(m, 's'), cut = over?.cut ?? val(m, 'cut');
      flt.frequency.setValueAtTime(nyq(ctx, cut * Math.pow(2, val(m, 'fenv'))), t);
      flt.frequency.setTargetAtTime(nyq(ctx, cut), t + a, val(m, 'fdec') / 4);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(vel, t + a);
      amp.gain.setTargetAtTime(s * vel, t + a, d / 4);
      mix.connect(flt).connect(amp).connect(out);
      for (const o of oscs) { o.start(t); env.live(o); }
      return {
        off(tr) {
          const r = val(m, 'r');
          release(amp.gain, Math.max(tr, t + 0.001), r);
          for (const o of oscs) o.stop(Math.max(tr, t) + r * 1.6 + 0.05);
        },
      };
    };
    return {
      output: out,
      ap: { vol: [[out.gain, dbToGain]] },
      update(mm) { m = mm; setP(ctx, out.gain, mm.on === false ? 0 : dbToGain(val(mm, 'vol'))); },
      noteOn(p, t, vel = 0.8, dur, over) { const v = voice(p, t, vel, over); if (dur !== undefined) v.off(t + dur); return v; },
      noteOff(v, t) { if (v) v.off(t); },
    };
  },
  sampler(ctx, m, env) {
    const out = G(ctx);
    const voice = (p, t, vel) => {
      const buf = env.buffers.get(m.params?.item);
      if (!buf) return null;
      const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: Math.pow(2, (p - val(m, 'root')) / 12) });
      const amp = G(ctx, 0);
      amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(vel, t + val(m, 'a'));
      src.connect(amp).connect(out);
      src.start(t, val(m, 'start') * buf.duration);
      env.live(src);
      return {
        off(tr) { const r = val(m, 'r'); release(amp.gain, Math.max(tr, t + 0.001), r); src.stop(Math.max(tr, t) + r * 1.6 + 0.05); },
      };
    };
    return {
      output: out,
      ap: { vol: [[out.gain, dbToGain]] },
      update(mm) { m = mm; setP(ctx, out.gain, mm.on === false ? 0 : dbToGain(val(mm, 'vol'))); },
      noteOn(p, t, vel = 0.8, dur) { const v = voice(p, t, vel); if (v && dur !== undefined) v.off(t + dur); return v; },
      noteOff(v, t) { if (v) v.off(t); },
    };
  },
  player(ctx, m, env) {
    const out = G(ctx);
    return {
      output: out,
      ap: { vol: [[out.gain, dbToGain]] },
      update(mm) { m = mm; setP(ctx, out.gain, mm.on === false ? 0 : dbToGain(val(mm, 'vol'))); },
      // Un clip audio lu de `t` à `t + dur`, `off` secondes dans le son.
      // o : T0 (instant du début du clip), L (sa durée), gain (dB), fi / fo
      // (fondus, s), loop / ls / llen (la boucle : AudioBufferSourceNode.loop,
      // loopStart, loopEnd — MDN). Enveloppe : les fondus du clip, et 5 ms
      // aux bords de ce qu'on joue (sans clic).
      clip(buf, t, off, dur, o = {}) {
        if (!buf || dur <= 0) return;
        const loop = !!o.loop && o.llen > 0.01;
        const rate = o.rate || 1;
        // `dur` est en secondes de temps ; le son en lit `dur × rate`
        if (!loop) { if (off >= buf.duration) return; dur = Math.min(dur, (buf.duration - off) / rate); }
        const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: rate });
        if (loop) { src.loop = true; src.loopStart = o.ls; src.loopEnd = Math.min(buf.duration, o.ls + o.llen); }
        const g = G(ctx, 0);
        const G0 = dbToGain(o.gain || 0), T0 = o.T0 ?? t, L = o.L ?? dur;
        const fi = Math.max(0, o.fi || 0), fo = Math.max(0, o.fo || 0);
        const shape = (tau) => G0 * Math.max(0, Math.min(1, fi > 0 ? tau / fi : 1, fo > 0 ? (L - tau) / fo : 1));
        const a = Math.min(0.005, dur / 4), end = t + dur;
        const pts = [[t + a, shape(t + a - T0)]];
        for (const x of [T0 + fi, T0 + L - fo]) if (x > t + a && x < end - a) pts.push([x, shape(x - T0)]);
        pts.sort((p, q) => p[0] - q[0]);
        pts.push([end - a, shape(end - a - T0)]);
        g.gain.setValueAtTime(0, t);
        for (const [x, v] of pts) g.gain.linearRampToValueAtTime(v, x);
        g.gain.linearRampToValueAtTime(0, end);
        src.connect(g).connect(out);
        // l'arrêt se donne en temps de l'horloge (stop), pas en durée de son :
        // la durée de start() se compte en secondes de contenu (spécification)
        src.start(t, off); src.stop(end);
        env.live(src);
      },
      noteOn() { return null; }, noteOff() {},
    };
  },
};

function strip(ctx) {
  const vol = G(ctx), pan = new StereoPannerNode(ctx), mute = G(ctx), output = G(ctx);
  const an = new AnalyserNode(ctx, { fftSize: 1024 });
  vol.connect(pan).connect(mute).connect(output);
  mute.connect(an);
  return {
    input: vol, output, analyser: an,
    ap: { vol: [[vol.gain, dbToGain]], pan: [[pan.pan, same]] },
    update(m) { setP(ctx, vol.gain, dbToGain(val(m, 'vol'))); setP(ctx, pan.pan, val(m, 'pan')); },
    setMute(on) { setP(ctx, mute.gain, on ? 0 : 1, 0.006); },
  };
}

// l'entrée d'un bus : là où les envois se rejoignent, avant les effets
function busIn(ctx) {
  const g = G(ctx);
  return { input: g, output: g, ap: { in: [[g.gain, dbToGain]] }, update(m) { setP(ctx, g.gain, dbToGain(val(m, 'in'))); } };
}

// La sortie : volume → filtre de l'arc (passe-bas, Q de Butterworth
// 1/√2) → gain de l'arc → haut-parleurs ; deux analyseurs, gauche et
// droite (ChannelSplitterNode, MDN).
function master(ctx) {
  const vol = G(ctx), arcF = new BiquadFilterNode(ctx, { type: 'lowpass', Q: Math.SQRT1_2, frequency: nyq(ctx, 20000) });
  const arcG = G(ctx), output = G(ctx);
  const an = new AnalyserNode(ctx, { fftSize: 2048 });
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const anL = new AnalyserNode(ctx, { fftSize: 1024 }), anR = new AnalyserNode(ctx, { fftSize: 1024 });
  vol.connect(arcF).connect(arcG).connect(output);
  arcG.connect(an); arcG.connect(split); split.connect(anL, 0); split.connect(anR, 1);
  const hi = nyq(ctx, 20000);
  return {
    input: vol, output, analyser: an, anL, anR,
    ap: { vol: [[vol.gain, dbToGain]] },
    update(m) { setP(ctx, vol.gain, dbToGain(val(m, 'vol'))); },
    // ce que l'arc tient, selon sa cible : le filtre, le volume, les deux
    arcAp(to, m) {
      const lo = Math.min(hi, val(m, 'arc_lo')), db = val(m, 'arc_db');
      const t = [];
      if (to !== 'vol') t.push([arcF.frequency, (v) => lo * Math.pow(hi / lo, v)]);
      if (to !== 'lpf') t.push([arcG.gain, (v) => dbToGain(db * (1 - v))]);
      return t;
    },
    arcRest() { for (const p of [arcF.frequency, arcG.gain]) HELD.delete(p); setP(ctx, arcF.frequency, hi); setP(ctx, arcG.gain, 1); },
  };
}

// ── ODIO : les instruments et effets du prototype, derrière le même contrat ──
// Un instrument d'ODIO reçoit des notes datées {note, velocity, time,
// duration, slide, accent} et expose ses réglages (odio/types.js) ; un effet
// a une entrée, une sortie, setEnabled et setParameter(id, valeur, instant).
// L'adaptateur les présente comme les modules d'ici. `env.held` : les
// réglages que l'automation tient pendant la lecture (clés « module:réglage »).
function odioSource(ctx, m, env) {
  const def = MODULES[m.type];
  const inst = new def.cls(ctx);
  const out = G(ctx), trim = dbToGain(def.trim || 0);
  inst.output.connect(out);
  const ready = Promise.resolve(inst.load?.()).catch((e) => console.warn(`${def.name} : ${e.message}`));
  env.pending?.push(ready);
  const voices = def.drum ? drumVoicesOf(m.type) : null;
  const apply = (mm) => { for (const s of def.params) if (!env.held?.has(`${mm.id}:${s.k}`)) inst.setParameter(s.k, val(mm, s.k)); };
  apply(m);
  out.gain.value = m.on === false ? 0 : trim;
  const drum = (v, t, vel) => { if (v) inst.noteOn({ note: v.note, velocity: vel, time: t, duration: 0.1 }); };
  return {
    output: out, odio: inst, ready,
    update(mm) { m = mm; apply(mm); setP(ctx, out.gain, mm.on === false ? 0 : trim); },
    setAt(k, v) { inst.setParameter(k, v); },
    hit(voice, t, vel = 1) { drum(voices?.find((x) => x.id === voice), t, vel); },
    // une note sans durée (clavier, MIDI) part longue et se relâche à noteOff
    noteOn(p, t, vel = 0.8, dur, over) {
      if (voices) { drum(voices[((p % 12) + 12) % 12], t, vel); return null; }
      inst.noteOn({ note: p, velocity: vel, time: t, duration: dur ?? 30, slide: !!over?.sl, accent: !!over?.ac });
      return dur === undefined ? { note: p } : null;
    },
    noteOff(h, t) { if (h && inst.noteOff) inst.noteOff(h.note, t); },
    ping() { return inst.ping ? inst.ping() : Promise.resolve(true); },
    dispose() { try { inst.dispose(); } catch { /* déjà défait */ } },
  };
}
function odioEffect(ctx, m, env) {
  const def = MODULES[m.type];
  const fx = new def.cls(ctx);
  const apply = (mm) => {
    for (const s of def.params) if (!env.held?.has(`${mm.id}:${s.k}`)) fx.setParameter(s.k, val(mm, s.k));
    fx.setEnabled(mm.on !== false);
  };
  apply(m);
  return {
    input: fx.input, output: fx.output, odio: fx,
    update(mm) { apply(mm); },
    setAt(k, v, t) { fx.setParameter(k, v, t); },
    flush() { fx.flush?.(); },
    dispose() { try { fx.dispose(); } catch { /* déjà défait */ } },
  };
}

function makeNode(ctx, m, env) {
  const def = MODULES[m.type];
  if (!def) throw new Error(`module inconnu : ${m.type}`);
  if (def.jouet) return jouetNode(ctx, m, env);   // jouets : écho, réverbe, filtre, volume — ou un nœud muet
  if (def.odio) return def.role === 'source' ? { ...odioSource(ctx, m, env), input: null } : odioEffect(ctx, m, env);
  if (def.role === 'source') { const n = SRC[m.type](ctx, m, env); n.input = null; return n; }
  if (def.role === 'strip') return strip(ctx);
  if (def.role === 'bus') return busIn(ctx);
  if (def.role === 'master') return master(ctx);
  const fx = FX[m.type](ctx);
  const sh = effectShell(ctx, fx.core);
  return { input: sh.input, output: sh.output, ap: fx.ap, reduction: fx.reduction, update(mm, bpm) { fx.update(mm, bpm); sh.setOn(mm.on !== false); } };
}

// ── un effet que plusieurs pistes traversent ────────────────
// Posé une fois dans le nodal, il est dans la chaîne de chaque piste qui passe
// par lui (projet.js, trajets) : UNE instance pour le projet (un module, ses
// réglages), une VOIX par piste pour le son — sinon le délai rendrait la
// basse dans la tranche de la voix. Chaque réglage, chaque automation, chaque
// attracteur va à toutes les voix ; le graphe relie la voix d'une piste à la
// suite de SA chaîne (Graph.wire).
function voixPartagees(premiere, tid) {
  const par = new Map([[tid, premiere]]);
  const toutes = () => [...par.values()];
  const n = {
    par,
    get input() { return toutes()[0].input; },
    get output() { return toutes()[0].output; },
    get analyser() { return toutes()[0].analyser; },
    get odio() { return toutes()[0].odio; },
    update(m, bpm) { for (const v of toutes()) v.update(m, bpm); },
    flush() { for (const v of toutes()) v.flush?.(); },
    dispose() { for (const v of toutes()) v.dispose?.(); },
    ping() { return Promise.all(toutes().map((v) => v.ping?.())); },
  };
  // les AudioParam de l'automation : ceux de chaque voix, à la suite (ramp les parcourt)
  Object.defineProperty(n, 'ap', { get() {
    const out = {};
    for (const v of toutes()) for (const [k, list] of Object.entries(v.ap || {})) (out[k] = out[k] || []).push(...list);
    return out;
  } });
  // un effet d'ODIO se règle par setParameter : seulement s'il en a un (influence.js le teste)
  if (premiere.setAt) n.setAt = (k, v, t) => { for (const x of toutes()) x.setAt?.(k, v, t); };
  return n;
}
const voixDe = (n) => (n?.par ? [...n.par.values()] : n ? [n] : []);

// ── le graphe d'un projet dans un contexte ──────────────────
export class Graph {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.nodes = new Map(); this.types = new Map();
    this.sends = new Map();
    this.sondes = new Map();   // les analyseurs de la vue Instruments (sonde)
    env.held = new Set(); env.pending = [];
    this.dest = ctx.destination;
  }

  // ce que les modules chargent encore (le worklet de Plaits, le bruit de la
  // boîte à rythme) : l'export l'attend avant de rendre
  ready() { return Promise.all(this.env.pending); }

  // les pistes dont la chaîne traverse un effet, quand il y en a plusieurs
  partage(p, m) {
    const def = MODULES[m.type];
    if (!def || def.role !== 'effect' || def.jouet) return null;   // jouets : une scène, un son
    const ps = trajets(p).de.get(m.id) || [];
    return ps.length > 1 ? ps : null;
  }

  sync(p) {
    const ids = new Set(p.modules.map((m) => m.id));
    for (const [id, n] of this.nodes) {
      const m = p.modules.find((x) => x.id === id);
      if (!ids.has(id) || this.types.get(id) !== m?.type) {
        for (const v of voixDe(n)) { try { v.output.disconnect(); } catch { /* déjà débranché */ } }
        n.dispose?.();
        this.nodes.delete(id); this.types.delete(id);
      }
    }
    for (const m of p.modules) {
      let n = this.nodes.get(m.id);
      if (!n) { n = makeNode(this.ctx, m, this.env); this.nodes.set(m.id, n); this.types.set(m.id, m.type); }
      // une voix par piste qui traverse l'effet ; celles qui restent gardent leur état (la queue d'un délai)
      const ps = this.partage(p, m);
      if (ps && !n.par) { n = voixPartagees(n, ps[0]); this.nodes.set(m.id, n); }
      if (n.par) {
        const garde = ps || [n.par.keys().next().value];
        for (const [tid, v] of [...n.par]) if (!garde.includes(tid) && n.par.size > 1) { try { v.output.disconnect(); } catch { /* */ } v.dispose?.(); n.par.delete(tid); }
        for (const tid of garde) if (!n.par.has(tid)) n.par.set(tid, makeNode(this.ctx, m, this.env));
        if (!ps) { n = n.par.values().next().value; this.nodes.set(m.id, n); }
      }
      n.update(m, p.bpm);
    }
    this.wire(p);
    this.mutes(p);
  }

  // La voix d'un module pour une piste : la sienne s'il est partagé, sinon lui.
  voix(id, tid) { const n = this.nodes.get(id); return n?.par ? (n.par.get(tid) || n.par.values().next().value) : n; }

  wire(p) {
    for (const n of this.nodes.values()) for (const v of voixDe(n)) v.output.disconnect();
    for (const g of this.sends.values()) g.disconnect();
    const used = new Set();
    const T = trajets(p);
    for (const c of p.cables) {
      if (c.t) continue;   // jouets : un câble de notes ou de valeur ne porte pas de son
      const a = this.nodes.get(c.a), b = this.nodes.get(c.b);
      if (!a || !b || !b.input) continue;
      if (typeof c.send === 'number') {
        // un envoi : un gain entre la tranche et l'entrée du bus
        const key = `${c.a}>${c.b}`;
        let g = this.sends.get(key);
        if (!g) { g = G(this.ctx, dbToGain(c.send)); this.sends.set(key, g); } else setP(this.ctx, g.gain, dbToGain(c.send));
        a.output.connect(g); g.connect(b.input); used.add(key);
      } else if (a.par || b.par) {
        // un câble vers ou depuis un effet partagé : par piste, le long de SA chaîne
        const communes = (T.de.get(c.a) || []).filter((tid) => (T.de.get(c.b) || []).includes(tid));
        if (communes.length) for (const tid of communes) this.voix(c.a, tid).output.connect(this.voix(c.b, tid).input);
        else for (const va of voixDe(a)) va.output.connect(voixDe(b)[0].input);   // hors de toute chaîne : le graphe tel quel
      } else a.output.connect(b.input);
    }
    for (const k of [...this.sends.keys()]) if (!used.has(k)) this.sends.delete(k);
    const m = p.modules.find((x) => x.type === 'master');
    if (m) this.nodes.get(m.id).output.connect(this.dest);
    this.brancherSondes();
  }

  // ── les sondes de la vue Instruments (musique/appareils/) ──
  // Un AnalyserNode piqué sur l'entrée ou la sortie d'un module : il lit le
  // son sans le changer (une dérivation ; un analyseur sans sortie est tiré
  // quand même, comme celui des tranches). wire() débranche toutes les
  // sorties : les sondes s'y rebranchent, sur le nœud du moment ; celle d'un
  // module retiré s'en va. `fft` : la taille de la transformée (8192 : six
  // hertz par case à 48 kHz, ce que le grave d'un égaliseur demande).
  sonde(id, cote = 'out', fft = 8192) {
    const cle = `${cote}:${fft}:${id}`;
    if (!this.sondes.has(cle)) {
      this.sondes.set(cle, new AnalyserNode(this.ctx, { fftSize: fft, smoothingTimeConstant: 0.7, minDecibels: -100, maxDecibels: -10 }));
      this.brancherSondes();
    }
    return this.sondes.get(cle) || null;
  }
  brancherSondes() {
    for (const [cle, an] of [...this.sondes]) {
      const [cote, , id] = cle.split(':');
      const v = voixDe(this.nodes.get(id))[0];
      if (!v) { this.sondes.delete(cle); continue; }
      const n = cote === 'in' ? v.input : v.output;
      if (n) n.connect(an);
    }
  }
  // la réduction de gain d'un compresseur, en dB (≤ 0) : DynamicsCompressorNode.reduction
  reduction(id) {
    const v = voixDe(this.nodes.get(id))[0];
    if (!v) return 0;
    if (v.reduction) return v.reduction();
    return v.odio && 'reduction' in v.odio ? v.odio.reduction : 0;
  }

  setSend(a, b, db) { const g = this.sends.get(`${a}>${b}`); if (g) setP(this.ctx, g.gain, dbToGain(db)); }

  // muet et solo ; un bus n'est jamais rendu muet par le solo d'une autre
  // piste (ce qu'on envoie dans la réverbération doit y rester)
  mutes(p) {
    const solo = p.tracks.some((t) => t.solo && t.kind !== 'bus');
    for (const t of p.tracks) {
      const s = this.nodes.get(t.strip);
      if (s?.setMute) s.setMute(t.mute || (solo && !t.solo && t.kind !== 'bus'));
    }
  }

  update(m, bpm) { const n = this.nodes.get(m.id); if (n) n.update(m, bpm); }

  // les AudioParam d'une voie d'automation : [[param, fn]] et la conversion 0..1 → valeur
  lane(p, L) {
    const m = p.modules.find((x) => x.id === L.mod), n = this.nodes.get(L.mod);
    const tg = n?.ap?.[L.k];
    if (!m || !tg) return null;
    const s = spec(m.type, L.k);
    return { tg, conv: (v) => fromNorm(s, v) };
  }

  automate(p, b0, b1, at) {
    for (const L of p.auto || []) {
      if (L.on === false || !L.pts?.length) continue;
      const x = this.lane(p, L);
      if (x) { ramp(x.tg, L.pts, b0, b1, at, x.conv); continue; }
      // un module d'ODIO : ses réglages se posent par setParameter, relevés
      // au début de la tranche et à chaque croche qu'elle contient
      const n = this.nodes.get(L.mod), m = p.modules.find((y) => y.id === L.mod);
      if (!n?.setAt || !m) continue;
      const s = spec(m.type, L.k);
      if (!s || s.opts) continue;
      this.env.held.add(`${L.mod}:${L.k}`);
      for (let b = b0; b < b1; b = Math.floor(b * 2 + 1e-9) / 2 + 0.5) n.setAt(L.k, fromNorm(s, interp(L.pts, b)), at(b));
    }
    jouetsAutomate(this, p, b0, b1, at);   // jouets : le chemin de l'AIMANT, rejoué sur le transport
    influer(this, p, b0, b1, at);   // attracteurs : tant qu'un attracteur parle, ses réglages captés jouent leur opérateur
    const A = p.arc, mm = p.modules.find((x) => x.type === 'master');
    const mn = mm && this.nodes.get(mm.id);
    if (mn && A?.on && A.pts?.length) ramp(mn.arcAp(A.to, mm), A.pts, b0, b1, at, same);
  }

  // à l'arrêt : l'automation rend la main ; les réglages prennent la valeur
  // de leur courbe à la tête de lecture (ce qu'on entend en jouant à la main)
  settle(p, beat) {
    rendre(this, p);   // attracteurs : à l'arrêt, chaque réglage reprend sa valeur
    for (const L of p.auto || []) {
      const m = p.modules.find((y) => y.id === L.mod), n = this.nodes.get(L.mod);
      const x = this.lane(p, L);
      if (!x) {
        if (!n?.setAt || !m) continue;
        this.env.held.delete(`${L.mod}:${L.k}`);
        n.update(m, p.bpm);
        const s = spec(m.type, L.k);
        if (s && !s.opts && L.on !== false && L.pts?.length) n.setAt(L.k, fromNorm(s, interp(L.pts, beat)));
        continue;
      }
      for (const [param] of x.tg) { param.cancelScheduledValues(0); HELD.delete(param); }
      n?.update(m, p.bpm);
      if (L.on !== false && L.pts?.length) for (const [param, fn] of x.tg) setP(this.ctx, param, fn(x.conv(interp(L.pts, beat))));
    }
    const mm = p.modules.find((x) => x.type === 'master'), mn = mm && this.nodes.get(mm.id);
    if (mn) {
      for (const [param] of mn.arcAp('both', mm)) param.cancelScheduledValues(0);
      mn.arcRest();
      const A = p.arc;
      if (A?.on && A.pts?.length) for (const [param, fn] of mn.arcAp(A.to, mm)) setP(this.ctx, param, fn(interp(A.pts, beat)));
    }
  }

  // Pose les événements du morceau entre les temps b0 et b1 (en noires),
  // b0 tombant à l'instant t0 de l'horloge audio. `limit` : un clip audio
  // s'arrête là (la fin de la boucle).
  schedule(p, b0, b1, t0, limit = Infinity) {
    const spb = 60 / p.bpm;
    const at = (b) => t0 + (b - b0) * spb;
    this.automate(p, b0, b1, at);
    const trk = new Map(p.tracks.map((t) => [t.id, t]));
    const pats = new Map(p.patterns.map((x) => [x.id, x]));
    const cutLanes = new Map((p.auto || []).filter((L) => L.k === 'cut' && L.on !== false && L.pts?.length).map((L) => [L.mod, L]));
    const cutSpec = spec('synth', 'cut');
    for (const c of p.clips) {
      if (c.mute) continue;
      const tr = trk.get(c.track);
      if (!tr) continue;
      const cs = c.start, ce = c.start + c.len;
      if (ce <= b0 || cs >= b1) continue;
      const src = this.nodes.get(tr.src);
      if (!src) continue;
      if (tr.kind === 'audio') {
        if (cs >= b0 && cs < b1) this.audioClip(src, c, at(cs), cs, cs, limit, spb);
        continue;
      }
      const pat = pats.get(c.pat);
      if (!pat) continue;
      const plen = pat.steps / 4;
      const from = Math.max(b0, cs), to = Math.min(b1, ce);
      const cutL = cutLanes.get(tr.src);
      // `off` (en noires) : où le motif en est au début du clip — un clip
      // coupé en deux continue son motif au lieu de le reprendre
      const origin = cs - (c.off || 0);
      for (let k = Math.floor((from - origin) / plen); origin + k * plen < to; k++) {
        const base = origin + k * plen;
        if (tr.kind === 'drums') {
          for (const [v, arr] of Object.entries(pat.lanes || {})) {
            for (let s = 0; s < arr.length; s++) {
              if (!arr[s]) continue;
              const b = base + s / 4;
              if (b >= from && b < to) src.hit(v, at(b), arr[s]);
            }
          }
        } else {
          for (const n of pat.notes || []) {
            const b = base + n.s / 4;
            if (b >= from && b < to) {
              // la coupure automatisée du synthé, lue à l'attaque ; l'accent et
              // la liaison d'une note (la basse acide d'ODIO)
              const over = cutL || n.ac || n.sl ? { cut: cutL ? fromNorm(cutSpec, interp(cutL.pts, b)) : undefined, ac: n.ac, sl: n.sl } : undefined;
              src.noteOn(n.p, at(b), n.v ?? 0.8, Math.min(n.l / 4, ce - b) * spb, over);
            }
          }
        }
      }
    }
  }

  // Un clip audio lu à partir du temps `beat` (son début, ou plus loin quand
  // la lecture part au milieu), qui tombe à l'instant `t`. Ses réglages
  // (vue Clip) : `off` le marqueur de début dans le son (s), `pitch` la
  // transposition en demi-tons — lue en changeant la vitesse, comme le mode
  // « Re-Pitch » de Live : hauteur et durée bougent ensemble —, `rev` le son
  // à l'envers, `loop` / `ls` / `llen` la boucle (début et longueur dans le son).
  audioClip(src, c, t, beat, cs, limit, spb) {
    const buf = clipBuffer(this.env.buffers.get(c.item), c);
    if (!buf) return;
    const clip = audioGeom(c, buf.duration);
    const into = (beat - cs) * spb;                    // secondes de temps déjà passées du clip
    const pos = clip.off + into * clip.rate;           // où en est le son
    const off = clip.loop && pos >= clip.ls + clip.llen ? clip.ls + ((pos - clip.ls) % clip.llen) : pos;
    const dur = (Math.min(cs + c.len, limit) - beat) * spb;
    src.clip(buf, t, off, dur, { T0: t - into, L: c.len * spb, gain: c.gain || 0, fi: c.fi || 0, fo: c.fo || 0,
      loop: clip.loop, ls: clip.ls, llen: clip.llen, rate: clip.rate });
  }

  // Les clips audio déjà commencés à l'instant où la lecture part (ou
  // reprend en haut de boucle) : lus depuis le bon endroit.
  resume(p, beat, t, limit = Infinity) {
    const spb = 60 / p.bpm;
    const trk = new Map(p.tracks.map((x) => [x.id, x]));
    for (const c of p.clips) {
      const tr = trk.get(c.track);
      if (!tr || tr.kind !== 'audio' || c.mute) continue;
      if (c.start < beat && c.start + c.len > beat) {
        const src = this.nodes.get(tr.src);
        if (src) this.audioClip(src, c, t, beat, c.start, limit, spb);
      }
    }
  }

  level(id, an = null) {
    an = an || this.nodes.get(id)?.analyser;
    if (!an) return -Infinity;
    const d = this._buf && this._buf.length === an.fftSize ? this._buf : (this._buf = new Float32Array(an.fftSize));
    an.getFloatTimeDomainData(d);
    let pk = 0;
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; }
    return pk > 0 ? 20 * Math.log10(pk) : -Infinity;
  }
  levelLR(id) {
    const n = this.nodes.get(id);
    if (!n?.anL) return [-Infinity, -Infinity];
    return [this.level(null, n.anL), this.level(null, n.anR)];
  }
}

// ── le moteur de la page ────────────────────────────────────
const TIMER = `let id=null;onmessage=(e)=>{if(e.data==='go'){if(!id)id=setInterval(()=>postMessage(0),${LOOKAHEAD_MS});}else{clearInterval(id);id=null;}}`;

export class Engine {
  constructor({ loadItem } = {}) {
    this.ctx = null; this.graph = null; this.proj = null;
    this.buffers = new Map(); this.loading = new Map(); this.loadItem = loadItem;
    this.voices = new Set(); this.play = null; this.pos = 0; this.onstop = null; this.onplay = null;
    this.metro = false;
    this.live = (node) => { this.voices.add(node); node.onended = () => this.voices.delete(node); };
    this.timer = null;
  }

  get running() { return !!this.play; }

  async start() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.graph = new Graph(this.ctx, { buffers: this.buffers, live: this.live, ecoute: () => this.ecoute });   // attracteurs : la tête d'écoute du banc, quand elle gouverne
      if (this.proj) { this.graph.sync(this.proj); this.graph.settle(this.proj, this.pos); }
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    await this.graph.ready();
  }

  setProject(p) { this.proj = p; if (this.graph) { this.graph.sync(p); if (!this.play) this.graph.settle(p, this.pos); } this.need(p); }
  syncGraph() { if (this.graph && this.proj) this.graph.sync(this.proj); }
  updateModule(m) { if (this.graph) this.graph.update(m, this.proj.bpm); }
  setSend(a, b, db) { if (this.graph) this.graph.setSend(a, b, db); }
  mutes() { if (this.graph && this.proj) this.graph.mutes(this.proj); }
  level(id) { return this.graph ? this.graph.level(id) : -Infinity; }
  // la vue Instruments : un analyseur sur un module, sa réduction de gain (Graph.sonde)
  sonde(id, cote, fft) { return this.graph ? this.graph.sonde(id, cote, fft) : null; }
  reduction(id) { return this.graph ? this.graph.reduction(id) : 0; }
  levelLR(id) { return this.graph ? this.graph.levelLR(id) : [-Infinity, -Infinity]; }
  settle() { if (this.graph && this.proj && !this.play) this.graph.settle(this.proj, this.pos); }

  // les sons dont le projet a besoin (échantillonneurs, clips audio)
  need(p) {
    const ids = new Set();
    for (const m of p.modules) if (m.type === 'sampler' && m.params?.item) ids.add(m.params.item);
    for (const c of p.clips) if (c.item) ids.add(c.item);
    return Promise.all([...ids].map((id) => this.buffer(id).catch(() => null)));
  }

  buffer(id) {
    if (this.buffers.has(id)) return Promise.resolve(this.buffers.get(id));
    if (!this.loading.has(id)) {
      this.loading.set(id, (async () => {
        const it = await this.loadItem(id);
        const raw = await (await fetch(it.href)).arrayBuffer();
        // decodeAudioData n'a pas besoin d'un contexte lancé : un
        // OfflineAudioContext d'une image suffit à décoder (MDN)
        const dec = new OfflineAudioContext(2, 1, 48000);
        const buf = await dec.decodeAudioData(raw);
        this.buffers.set(id, buf);
        this.loading.delete(id);
        document.dispatchEvent(new CustomEvent('mu:buffer', { detail: id }));
        return buf;
      })().catch((e) => { this.loading.delete(id); throw e; }));
    }
    return this.loading.get(id);
  }

  // ── lecture ──
  position() {
    const P = this.play;
    if (!P) return this.pos;
    const now = this.ctx.currentTime;
    let a = P.anchors[0];
    for (const x of P.anchors) if (x.time <= now) a = x;
    return Math.max(a.beat, a.beat + (now - a.time) / P.spb);
  }

  async playFrom(beat) {
    await this.start();
    this.halt();
    const p = this.proj;
    const t0 = this.ctx.currentTime + DEPART_S;
    this.play = { spb: 60 / p.bpm, cb: beat, ct: t0, from: beat, anchors: [{ time: t0, beat }] };
    const loop = this.loopAt(beat);
    this.graph.resume(p, beat, t0, loop ? loop.b : Infinity);
    this.tick();
    if (!this.timer) {
      this.timer = new Worker(URL.createObjectURL(new Blob([TIMER], { type: 'text/javascript' })));
      this.timer.onmessage = () => this.tick();
    }
    this.timer.postMessage('go');
    if (this.onplay) this.onplay(beat);
  }

  loopAt(beat) {
    const L = this.proj.loop;
    return L && L.on && L.b > L.a && beat < L.b ? L : null;
  }

  tick() {
    const P = this.play;
    if (!P) return;
    const p = this.proj;
    const horizon = this.ctx.currentTime + AHEAD_S;
    let guard = 0;
    while (P.ct < horizon && guard++ < 64) {
      const loop = this.loopAt(P.cb);
      let end = P.cb + (horizon - P.ct) / P.spb, wrap = false;
      if (loop && end >= loop.b) { end = loop.b; wrap = true; }
      this.graph.schedule(p, P.cb, end, P.ct, loop ? loop.b : Infinity);
      if (this.metro) this.clicks(P.cb, end, P.ct, P.spb, p.sig);
      P.ct += (end - P.cb) * P.spb;
      P.cb = end;
      if (wrap) {
        P.cb = loop.a;
        P.anchors.push({ time: P.ct, beat: loop.a });
        if (P.anchors.length > 32) P.anchors.splice(0, P.anchors.length - 32);
        this.graph.resume(p, loop.a, P.ct, loop.b);
      }
    }
    if (!this.loopAt(P.cb) && P.cb > songEnd(p) + 2 && !this.keepGoing) this.stop(true);
  }

  // Le métronome : un bip à chaque temps, plus aigu sur le premier de la
  // mesure (sinus 1500 / 1000 Hz, 30 ms — choix de réglage). Il part droit
  // aux haut-parleurs : il ne passe pas par la sortie, ni dans l'export.
  clicks(b0, b1, t0, spb, sig) {
    for (let b = Math.ceil(b0 - 1e-9); b < b1; b++) {
      const t = t0 + (b - b0) * spb;
      const o = new OscillatorNode(this.ctx, { type: 'sine', frequency: b % sig === 0 ? 1500 : 1000 });
      const g = G(this.ctx, 0);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      o.connect(g).connect(this.ctx.destination);
      o.start(t); o.stop(t + 0.04); this.live(o);
    }
  }

  halt() {
    if (this.timer) this.timer.postMessage('stop');
    for (const v of this.voices) { try { v.stop(0); } catch { /* pas encore parti */ } }
    this.voices.clear();
    // les instruments d'ODIO tiennent leurs voix eux-mêmes
    if (this.graph) for (const n of this.graph.nodes.values()) n.odio?.allNotesOff?.();
  }

  // pause : on reste où l'on est ; stop : on revient où la lecture a commencé
  stop(ended = false, { stay = false } = {}) {
    const from = this.play ? this.play.from : this.pos;
    const here = this.position();
    this.halt();
    this.play = null;
    this.pos = stay ? here : from;
    if (this.graph && this.proj) this.graph.settle(this.proj, this.pos);
    if (this.onstop) this.onstop(ended, here);
  }

  seek(beat) {
    this.pos = Math.max(0, beat);
    if (this.play) this.playFrom(this.pos);
    else this.settle();
  }

  // ── jouer à la main (clavier, MIDI, pads, piano roll) ──
  async noteOn(srcId, pitch, vel = 0.8) {
    await this.start();
    const n = this.graph.nodes.get(srcId);
    return n?.noteOn ? { n, v: n.noteOn(pitch, this.ctx.currentTime + 0.005, vel) } : null;
  }
  noteOff(h) { if (h?.v) h.n.noteOff(h.v, this.ctx.currentTime); }
  async hit(srcId, voice, vel = 1) {
    await this.start();
    this.graph.nodes.get(srcId)?.hit?.(voice, this.ctx.currentTime + 0.005, vel);
  }
  async preview(srcId, pitch) {
    const h = await this.noteOn(srcId, pitch, 0.8);
    if (h) setTimeout(() => this.noteOff(h), 260);
  }
}

// La fin du morceau : la fin du dernier clip (en noires).
export function songEnd(p) {
  return p.clips.reduce((e, c) => Math.max(e, c.start + c.len), 0);
}
// La fin de ce qu'on voit : clips, sections, marqueurs.
export function projEnd(p) {
  return Math.max(songEnd(p), ...(p.sections || []).map((s) => s.b), ...(p.markers || []).map((m) => m.b), 0);
}

// ── l'export : le même graphe, hors temps réel ──────────────
// OfflineAudioContext (MDN) rend le mixage plus vite que le temps réel,
// planifié COMME LA LECTURE : par tranches, chacune posée un peu avant de
// sonner. OfflineAudioContext.suspend(t) arrête le rendu à l'instant t (à une
// frontière de bloc de 128 images, MDN) ; on pose la tranche — l'automation
// et les attracteurs relevés à son début (Graph.automate), ses notes — puis
// resume(). Planifié d'un bloc (avant le 29/09), le morceau avait deux défauts :
//  - les instruments d'ODIO lisent leurs réglages au moment de la note
//    (basse acide, Analog) ou les posent « maintenant » (la coupure de Plaits,
//    à currentTime, figé à 0) : une automation ou un attracteur sur un
//    instrument prenait partout sa DERNIÈRE valeur ;
//  - toutes les voix existaient dès le début du rendu, et chaque bloc de 128
//    images parcourt les nœuds vivants : le rendu ralentissait à mesure que le
//    morceau s'allongeait (64 temps : 8,8 s ; 128 temps : 66,8 s).
// La tranche vaut EXPORT_PAS noires, posée AHEAD_S avant de sonner (l'horizon
// de la lecture) : un réglage lu « maintenant » l'est au même moment qu'en
// lecture, et une note sur la grille des doubles croches lit la valeur de
// son propre temps. Mesuré le 29/09 (« Verre fumé », 161 s, DGX2) : 383 s
// d'un bloc, 40 à 54 s par doubles croches (une ou deux noires : 40-45 s,
// pour une automation lue moins finement) ; le niveau de chaque mesure est
// celui de la lecture temps réel enregistrée à 0,13 dB près (moyenne 0,03 :
// l'écart de deux lectures entre elles ; sans le calage ci-dessous, 1,3 dB).
// `from`/`to` en noires ; `tail` : les secondes laissées aux
// réverbérations et aux chutes après la dernière note ; `solo` : une piste
// seule (un stem), les bus restant ouverts ; `signal` (AbortSignal) : annule
// le rendu, qui s'arrête à sa tranche suivante (rejet « AbortError ») ;
// `fond` : un rendu de fond (la forme d'onde de la barre) — voir plus bas.
export const EXPORT_PAS = 0.25;   // une double croche
const RQ = 128;                   // le bloc de rendu (render quantum) : 128 images
const annule = () => new DOMException('rendu annulé', 'AbortError');

async function rendreMix(engine, p, from, to, { tail = 2, sampleRate = 48000, solo = null, signal = null, pas = EXPORT_PAS } = {}) {
  // `from` tombe dans les blocs de 128 images là où la lecture le pose
  // (playFrom : un début de bloc + DEPART_S) : rendu à partir d'un début de
  // bloc, le même morceau sonne autrement — mesuré le 29/09 : la basse acide
  // et le sub (mêmes fondamentales) s'additionnent ou s'annulent selon cette
  // place, jusqu'à 3 dB d'une mesure (le mécanisme, dans Chromium, n'est pas
  // documenté). Les `decale` premières images sont retirées à la fin.
  const decale = Math.round(DEPART_S * sampleRate) % RQ;
  if (signal?.aborted) throw annule();
  // le projet est figé au départ : une retouche pendant le rendu ne s'y mêle pas
  try { p = structuredClone(p); } catch { p = JSON.parse(JSON.stringify(p)); }
  await engine.need(p);
  // une piste seule : les autres sont muettes (tranche coupée, envois
  // compris) — on ne planifie donc que ses clips, le rendu est le même
  if (solo) p = { ...p, tracks: p.tracks.map((t) => ({ ...t, solo: t.id === solo, mute: t.id === solo ? false : t.mute })), clips: p.clips.filter((c) => c.track === solo) };
  const spb = 60 / p.bpm, D = decale / sampleRate;
  const length = Math.ceil(((to - from) * spb + tail) * sampleRate) + decale;
  const octx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  const g = new Graph(octx, { buffers: engine.buffers, live: () => {} });
  const lacher = () => { for (const n of g.nodes.values()) n.dispose?.(); };
  g.sync(p);
  await g.ready();                    // le worklet de Plaits, le bruit de la boîte à rythme
  if (signal?.aborted) { lacher(); throw annule(); }
  for (const n of g.nodes.values()) n.flush?.();                       // la réverbe d'ODIO
  const pings = () => Promise.all([...g.nodes.values()].map((n) => n.ping?.()));   // les notes postées au worklet
  // les tranches, rangées par le bloc où le rendu s'arrête pour les poser
  const n = Math.max(1, Math.ceil((to - from) / pas - 1e-9));
  const poser = (k) => { const b0 = from + k * pas; g.schedule(p, b0, Math.min(to, b0 + pas), D + (b0 - from) * spb, to); };
  const arrets = new Map(), debut = [];
  for (let k = 0; k < n; k++) {
    const f = Math.floor(((D + k * pas * spb - AHEAD_S) * sampleRate) / RQ) * RQ;
    if (f <= 0 || f + RQ >= length) debut.push(k);
    else { if (!arrets.has(f)) arrets.set(f, []); arrets.get(f).push(k); }
  }
  g.resume(p, from, D, to);           // les clips audio déjà commencés à `from`
  for (const k of debut) poser(k);
  await pings();
  return new Promise((resolve, reject) => {
    let fini = false;
    const echec = (e) => { if (!fini) { fini = true; reject(e); } };
    signal?.addEventListener('abort', () => echec(annule()), { once: true });
    if (signal?.aborted) { echec(annule()); lacher(); return; }
    for (const [f, ks] of arrets) {
      // l'instant au milieu du bloc : qu'il soit arrondi vers le haut ou vers
      // le bas, deux arrêts ne tombent jamais dans le même bloc
      octx.suspend((f + RQ / 2) / sampleRate).then(async () => {
        if (fini) { lacher(); return; }   // annulé : le rendu reste arrêté ici
        try { for (const k of ks) poser(k); await pings(); } catch (e) { echec(e); }
        if (fini) { lacher(); return; }
        octx.resume();
      }, echec);
    }
    octx.startRendering().then((buf) => {
      if (fini) return;
      fini = true;
      if (!decale) { resolve(buf); return; }
      const out = new AudioBuffer({ numberOfChannels: 2, length: buf.length - decale, sampleRate });
      for (let c = 0; c < 2; c++) out.copyToChannel(buf.getChannelData(c).subarray(decale), c);
      resolve(out);
    }, echec);
  });
}

// Un seul rendu à la fois. Ceux qu'on attend (l'export et ses stems, le son
// d'une région générative) passent l'un après l'autre ; celui de fond (la
// forme d'onde) s'efface devant eux : il est annulé dès qu'un rendu attendu
// arrive, et refusé (AbortError) tant qu'il en reste un. `rendusLibres()` :
// une promesse tenue quand plus aucun rendu attendu ne tourne.
let file = Promise.resolve(), attendus = 0, fond = null;
export function rendusLibres() { return file; }
export function renderMix(engine, p, from, to, opts = {}) {
  if (opts.fond) {
    if (attendus) return Promise.reject(annule());
    fond?.abort();
    const ctl = new AbortController();
    fond = ctl;
    if (opts.signal) { if (opts.signal.aborted) ctl.abort(); else opts.signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
    return rendreMix(engine, p, from, to, { ...opts, signal: ctl.signal }).finally(() => { if (fond === ctl) fond = null; });
  }
  attendus++;
  fond?.abort();
  const r = file.then(() => rendreMix(engine, p, from, to, opts));
  file = r.then(() => {}, () => {});
  return r.finally(() => { attendus--; });
}

// Consolider des clips audio (Ctrl+J, « Consolidate » de Live) : leur son
// seul, tel que le clip le lit — début, boucle, vitesse, sens, gain,
// fondus — sans les effets de la piste, qui restent dans sa chaîne. `a`, `b`
// en noires ; rend un AudioBuffer de (b − a) noires.
export async function renderClips(engine, p, clips, a, b, sampleRate = 48000) {
  const spb = 60 / p.bpm;
  const octx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.max(1, Math.ceil((b - a) * spb * sampleRate)), sampleRate });
  for (const c of clips) {
    if (c.mute) continue;
    const buf = clipBuffer(await engine.buffer(c.item), c);
    const G = audioGeom(c, buf.duration);
    const t0 = Math.max(0, (c.start - a) * spb), L = c.len * spb;
    const src = new AudioBufferSourceNode(octx, { buffer: buf, playbackRate: G.rate });
    if (G.loop) { src.loop = true; src.loopStart = G.ls; src.loopEnd = G.ls + G.llen; }
    const lin = Math.pow(10, (c.gain || 0) / 20);
    const g = new GainNode(octx, { gain: c.fi ? 0 : lin });
    if (c.fi) { g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(lin, t0 + Math.min(c.fi, L)); }
    if (c.fo) { g.gain.setValueAtTime(lin, t0 + Math.max(0, L - c.fo)); g.gain.linearRampToValueAtTime(0, t0 + L); }
    src.connect(g).connect(octx.destination);
    src.start(t0, G.off);
    src.stop(t0 + L);
  }
  return octx.startRendering();
}

// WAV PCM 24 bits entrelacé : en-tête RIFF de 44 octets (format « WAVE
// PCM soundfile », CCRMA Stanford, soundfile.sapp.org/doc/WaveFormat).
export function wav24(buf) {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, bps = 3;
  const size = n * ch * bps;
  const dv = new DataView(new ArrayBuffer(44 + size));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + size, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * bps, true); dv.setUint16(32, ch * bps, true);
  dv.setUint16(34, 24, true); str(36, 'data'); dv.setUint32(40, size, true);
  const chans = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
      dv.setUint8(o, v & 0xff); dv.setUint8(o + 1, (v >> 8) & 0xff); dv.setUint8(o + 2, (v >> 16) & 0xff);
      o += 3;
    }
  }
  return new Blob([dv.buffer], { type: 'audio/wav' });
}

export function peakDb(buf, a = 0, b = Infinity) {
  let pk = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    const i0 = Math.max(0, Math.floor(a * buf.sampleRate)), i1 = Math.min(d.length, Math.ceil(b * buf.sampleRate));
    for (let i = i0; i < i1; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; }
  }
  return pk > 0 ? 20 * Math.log10(pk) : -Infinity;
}

// Les crêtes d'un son, pour dessiner sa forme d'onde : `n` cases.
const PEAKS = new WeakMap();
export function peaks(buf, n = 2000) {
  const key = PEAKS.get(buf);
  if (key && key.length === n) return key;
  const out = new Float32Array(n), d0 = buf.getChannelData(0), d1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d0;
  const step = buf.length / n;
  for (let k = 0; k < n; k++) {
    let pk = 0;
    const a = Math.floor(k * step), b = Math.min(buf.length, Math.floor((k + 1) * step));
    for (let i = a; i < b; i += 4) { const v = Math.max(Math.abs(d0[i]), Math.abs(d1[i])); if (v > pk) pk = v; }
    out[k] = pk;
  }
  PEAKS.set(buf, out);
  return out;
}
