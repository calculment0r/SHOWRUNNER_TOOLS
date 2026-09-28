// MUSIQUE — le moteur Web Audio.
//
// Un projet devient un graphe de nœuds Web Audio : chaque module (source,
// effet, tranche de piste, sortie) est un petit groupe de nœuds avec une
// entrée et une sortie ; les câbles du projet sont les connexions. Le même
// code construit le graphe dans l'AudioContext de la page (on joue) et dans
// un OfflineAudioContext (on exporte en WAV) : ce qu'on entend est ce qu'on
// exporte.
//
// Le temps : tout se planifie sur l'horloge audio (AudioContext.currentTime),
// jamais au setTimeout. Un minuteur réveille seulement le planificateur
// toutes les 25 ms, qui pose les notes des 120 prochaines millisecondes —
// la méthode de MDN, « Advanced techniques: Creating and sequencing audio »
// (lookahead 25 ms, scheduleAheadTime 0.1 s), d'après « A Tale of Two
// Clocks » (Chris Wilson). Le minuteur tourne dans un Worker : un onglet en
// arrière-plan ralentit les setTimeout de la page, pas ceux d'un Worker.

import { MODULES, DRUM_VOICES, WAVES, FILTER_TYPES, DELAY_DIVS, val, dbToGain } from './modules.js';

const LOOKAHEAD_MS = 25;      // MDN : « lookahead = 25.0 »
const AHEAD_S = 0.12;         // MDN : « scheduleAheadTime = 0.1 » (+ 20 ms de marge au démarrage d'onglet)

// ── petites aides ───────────────────────────────────────────
const G = (ctx, gain = 1) => new GainNode(ctx, { gain });
function setP(ctx, param, v, tc = 0.012) {
  // une molette qu'on tourne pendant la lecture : on glisse vers la valeur
  // (AudioParam.setTargetAtTime, MDN) plutôt que de sauter, sinon ça claque
  if (ctx instanceof OfflineAudioContext || ctx.state !== 'running') param.value = v;
  else param.setTargetAtTime(v, ctx.currentTime, tc);
}
const nyq = (ctx, f) => Math.min(f, ctx.sampleRate * 0.45);

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
// (makeDistortionCurve), k de 0 à 100.
function distCurve(k) {
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

// ── les modules ─────────────────────────────────────────────
// Chaque fabrique rend { input, output, update(mod, bpm), …actions }.

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

function mixPair(ctx, mix) {
  // fondu à puissance constante entre le son sec et l'effet
  return [Math.cos(mix * Math.PI / 2), Math.sin(mix * Math.PI / 2)];
}

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
      update(m, bpm) {
        setP(ctx, dl.delayTime, Math.min(4, DELAY_DIVS[val(m, 'div')] * 60 / bpm), 0.05);
        setP(ctx, fb.gain, val(m, 'fb'));
        setP(ctx, lp.frequency, nyq(ctx, val(m, 'tone')));
        setP(ctx, wet.gain, val(m, 'mix'));
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
        const [d, w] = mixPair(ctx, val(m, 'mix'));
        setP(ctx, dry.gain, d); setP(ctx, wet.gain, w);
      },
    };
  },
  comp(ctx) {
    const c = new DynamicsCompressorNode(ctx), g = G(ctx);
    c.connect(g);
    return {
      core: { in: c, out: g },
      update(m) {
        setP(ctx, c.threshold, val(m, 'thr')); setP(ctx, c.ratio, val(m, 'ratio'));
        setP(ctx, c.attack, val(m, 'att')); setP(ctx, c.release, val(m, 'rel'));
        setP(ctx, c.knee, val(m, 'knee')); setP(ctx, g.gain, dbToGain(val(m, 'gain')));
      },
    };
  },
  eq(ctx) {
    const lo = new BiquadFilterNode(ctx, { type: 'lowshelf' });
    const mid = new BiquadFilterNode(ctx, { type: 'peaking', Q: 0.9 });
    const hi = new BiquadFilterNode(ctx, { type: 'highshelf' });
    lo.connect(mid).connect(hi);
    return {
      core: { in: lo, out: hi },
      update(m) {
        setP(ctx, lo.frequency, val(m, 'lf')); setP(ctx, lo.gain, val(m, 'lg'));
        setP(ctx, mid.frequency, val(m, 'mf')); setP(ctx, mid.gain, val(m, 'mg'));
        setP(ctx, hi.frequency, nyq(ctx, val(m, 'hf'))); setP(ctx, hi.gain, val(m, 'hg'));
      },
    };
  },
  filter(ctx) {
    const f = new BiquadFilterNode(ctx);
    return {
      core: { in: f, out: f },
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
      update(m) {
        const d = val(m, 'drive');
        if (d !== k) { sh.curve = distCurve(d); k = d; }
        setP(ctx, tone.frequency, nyq(ctx, val(m, 'tone')));
        const [a, b] = mixPair(ctx, val(m, 'mix'));
        setP(ctx, dry.gain, a); setP(ctx, wet.gain, b);
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
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 7000 });
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
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2640 * tune, Q: 3.5 });
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
      update(mm) { m = mm; setP(ctx, out.gain, mm.on === false ? 0 : dbToGain(val(mm, 'lvl'))); },
      hit(voice, t, vel = 1) { drumVoice(ctx, out, voice, t, vel, m, env.live, st); },
      noteOn(p, t, vel) { const v = DRUM_VOICES[((p % 12) + 12) % 12]; if (v) drumVoice(ctx, out, v.id, t, vel, m, env.live, st); return null; },
      noteOff() {},
    };
  },
  synth(ctx, m, env) {
    const out = G(ctx);
    const voice = (p, t, vel) => {
      const f = 440 * Math.pow(2, (p + 12 * val(m, 'oct') - 69) / 12);
      const type = WAVES[val(m, 'wave')], det = val(m, 'det');
      const o1 = new OscillatorNode(ctx, { type, frequency: f, detune: -det / 2 });
      const o2 = det > 0 ? new OscillatorNode(ctx, { type, frequency: f, detune: det / 2 }) : null;
      const mix = G(ctx, o2 ? 0.5 : 1);
      const flt = new BiquadFilterNode(ctx, { type: 'lowpass', Q: val(m, 'res') });
      const amp = G(ctx, 0);
      const a = val(m, 'a'), d = val(m, 'd'), s = val(m, 's'), cut = val(m, 'cut');
      flt.frequency.setValueAtTime(nyq(ctx, cut * Math.pow(2, val(m, 'fenv'))), t);
      flt.frequency.setTargetAtTime(nyq(ctx, cut), t + a, val(m, 'fdec') / 4);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(vel, t + a);
      amp.gain.setTargetAtTime(s * vel, t + a, d / 4);
      o1.connect(mix); if (o2) o2.connect(mix);
      mix.connect(flt).connect(amp).connect(out);
      const oscs = o2 ? [o1, o2] : [o1];
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
      update(mm) { m = mm; setP(ctx, out.gain, mm.on === false ? 0 : dbToGain(val(mm, 'vol'))); },
      noteOn(p, t, vel = 0.8, dur) { const v = voice(p, t, vel); if (dur !== undefined) v.off(t + dur); return v; },
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
      update(mm) { m = mm; setP(ctx, out.gain, mm.on === false ? 0 : dbToGain(val(mm, 'vol'))); },
      noteOn(p, t, vel = 0.8, dur) { const v = voice(p, t, vel); if (v && dur !== undefined) v.off(t + dur); return v; },
      noteOff(v, t) { if (v) v.off(t); },
    };
  },
  player(ctx, m, env) {
    const out = G(ctx);
    return {
      output: out,
      update(mm) { m = mm; setP(ctx, out.gain, mm.on === false ? 0 : dbToGain(val(mm, 'vol'))); },
      // un clip audio : lu à sa vitesse, fondu de 5 ms aux bords (sans clic)
      clip(buf, t, off, dur) {
        if (!buf || off >= buf.duration || dur <= 0) return;
        dur = Math.min(dur, buf.duration - off);
        const src = new AudioBufferSourceNode(ctx, { buffer: buf }), g = G(ctx, 0);
        const fade = Math.min(0.005, dur / 4);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + fade);
        g.gain.setValueAtTime(1, t + dur - fade); g.gain.linearRampToValueAtTime(0, t + dur);
        src.connect(g).connect(out);
        src.start(t, off, dur);
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
    update(m) { setP(ctx, vol.gain, dbToGain(val(m, 'vol'))); setP(ctx, pan.pan, val(m, 'pan')); },
    setMute(on) { setP(ctx, mute.gain, on ? 0 : 1, 0.006); },
  };
}

function master(ctx) {
  const vol = G(ctx), output = G(ctx);
  const an = new AnalyserNode(ctx, { fftSize: 2048 });
  vol.connect(output); vol.connect(an);
  return { input: vol, output, analyser: an, update(m) { setP(ctx, vol.gain, dbToGain(val(m, 'vol'))); } };
}

function makeNode(ctx, m, env) {
  const def = MODULES[m.type];
  if (!def) throw new Error(`module inconnu : ${m.type}`);
  if (def.role === 'source') { const n = SRC[m.type](ctx, m, env); n.input = null; return n; }
  if (def.role === 'strip') return strip(ctx);
  if (def.role === 'master') return master(ctx);
  const fx = FX[m.type](ctx);
  const sh = effectShell(ctx, fx.core);
  return { input: sh.input, output: sh.output, update(mm, bpm) { fx.update(mm, bpm); sh.setOn(mm.on !== false); } };
}

// ── le graphe d'un projet dans un contexte ──────────────────
export class Graph {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.nodes = new Map(); this.types = new Map();
    this.dest = ctx.destination;
  }

  sync(p) {
    const ids = new Set(p.modules.map((m) => m.id));
    for (const [id, n] of this.nodes) {
      const m = p.modules.find((x) => x.id === id);
      if (!ids.has(id) || this.types.get(id) !== m?.type) {
        try { n.output.disconnect(); } catch { /* déjà débranché */ }
        this.nodes.delete(id); this.types.delete(id);
      }
    }
    for (const m of p.modules) {
      let n = this.nodes.get(m.id);
      if (!n) { n = makeNode(this.ctx, m, this.env); this.nodes.set(m.id, n); this.types.set(m.id, m.type); }
      n.update(m, p.bpm);
    }
    this.wire(p);
    this.mutes(p);
  }

  wire(p) {
    for (const n of this.nodes.values()) n.output.disconnect();
    for (const c of p.cables) {
      const a = this.nodes.get(c.a), b = this.nodes.get(c.b);
      if (a && b && b.input) a.output.connect(b.input);
    }
    const m = p.modules.find((x) => x.type === 'master');
    if (m) this.nodes.get(m.id).output.connect(this.dest);
  }

  mutes(p) {
    const solo = p.tracks.some((t) => t.solo);
    for (const t of p.tracks) {
      const s = this.nodes.get(t.strip);
      if (s?.setMute) s.setMute(t.mute || (solo && !t.solo));
    }
  }

  update(m, bpm) { const n = this.nodes.get(m.id); if (n) n.update(m, bpm); }

  // Pose les événements du morceau entre les temps b0 et b1 (en noires),
  // b0 tombant à l'instant t0 de l'horloge audio. `limit` : un clip audio
  // s'arrête là (la fin de la boucle).
  schedule(p, b0, b1, t0, limit = Infinity) {
    const spb = 60 / p.bpm;
    const at = (b) => t0 + (b - b0) * spb;
    const trk = new Map(p.tracks.map((t) => [t.id, t]));
    const pats = new Map(p.patterns.map((x) => [x.id, x]));
    for (const c of p.clips) {
      const tr = trk.get(c.track);
      if (!tr) continue;
      const cs = c.start, ce = c.start + c.len;
      if (ce <= b0 || cs >= b1) continue;
      const src = this.nodes.get(tr.src);
      if (!src) continue;
      if (tr.kind === 'audio') {
        if (cs >= b0 && cs < b1) src.clip(this.env.buffers.get(c.item), at(cs), c.off || 0, (Math.min(ce, limit) - cs) * spb);
        continue;
      }
      const pat = pats.get(c.pat);
      if (!pat) continue;
      const plen = pat.steps / 4;
      const from = Math.max(b0, cs), to = Math.min(b1, ce);
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
            if (b >= from && b < to) src.noteOn(n.p, at(b), n.v ?? 0.8, Math.min(n.l / 4, ce - b) * spb);
          }
        }
      }
    }
  }

  // Les clips audio déjà commencés à l'instant où la lecture part (ou
  // reprend en haut de boucle) : lus depuis le bon endroit.
  resume(p, beat, t, limit = Infinity) {
    const spb = 60 / p.bpm;
    const trk = new Map(p.tracks.map((x) => [x.id, x]));
    for (const c of p.clips) {
      const tr = trk.get(c.track);
      if (!tr || tr.kind !== 'audio') continue;
      if (c.start < beat && c.start + c.len > beat) {
        const src = this.nodes.get(tr.src);
        if (src) src.clip(this.env.buffers.get(c.item), t, (c.off || 0) + (beat - c.start) * spb,
          (Math.min(c.start + c.len, limit) - beat) * spb);
      }
    }
  }

  level(id) {
    const an = this.nodes.get(id)?.analyser;
    if (!an) return -Infinity;
    const d = this._buf && this._buf.length === an.fftSize ? this._buf : (this._buf = new Float32Array(an.fftSize));
    an.getFloatTimeDomainData(d);
    let pk = 0;
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; }
    return pk > 0 ? 20 * Math.log10(pk) : -Infinity;
  }
}

// ── le moteur de la page ────────────────────────────────────
const TIMER = `let id=null;onmessage=(e)=>{if(e.data==='go'){if(!id)id=setInterval(()=>postMessage(0),${LOOKAHEAD_MS});}else{clearInterval(id);id=null;}}`;

export class Engine {
  constructor({ loadItem } = {}) {
    this.ctx = null; this.graph = null; this.proj = null;
    this.buffers = new Map(); this.loading = new Map(); this.loadItem = loadItem;
    this.voices = new Set(); this.play = null; this.pos = 0; this.onstop = null;
    this.live = (node) => { this.voices.add(node); node.onended = () => this.voices.delete(node); };
    this.timer = null;
  }

  get running() { return !!this.play; }

  async start() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.graph = new Graph(this.ctx, { buffers: this.buffers, live: this.live });
      if (this.proj) this.graph.sync(this.proj);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  setProject(p) { this.proj = p; if (this.graph) this.graph.sync(p); this.need(p); }
  syncGraph() { if (this.graph && this.proj) this.graph.sync(this.proj); }
  updateModule(m) { if (this.graph) this.graph.update(m, this.proj.bpm); }
  mutes() { if (this.graph && this.proj) this.graph.mutes(this.proj); }
  level(id) { return this.graph ? this.graph.level(id) : -Infinity; }

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
    const t0 = this.ctx.currentTime + 0.05;
    this.play = { spb: 60 / p.bpm, cb: beat, ct: t0, from: beat, anchors: [{ time: t0, beat }] };
    const loop = this.loopAt(beat);
    this.graph.resume(p, beat, t0, loop ? loop.b : Infinity);
    this.tick();
    if (!this.timer) {
      this.timer = new Worker(URL.createObjectURL(new Blob([TIMER], { type: 'text/javascript' })));
      this.timer.onmessage = () => this.tick();
    }
    this.timer.postMessage('go');
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
      P.ct += (end - P.cb) * P.spb;
      P.cb = end;
      if (wrap) {
        P.cb = loop.a;
        P.anchors.push({ time: P.ct, beat: loop.a });
        if (P.anchors.length > 32) P.anchors.splice(0, P.anchors.length - 32);
        this.graph.resume(p, loop.a, P.ct, loop.b);
      }
    }
    if (!this.loopAt(P.cb) && P.cb > songEnd(p) + 2) this.stop(true);
  }

  halt() {
    if (this.timer) this.timer.postMessage('stop');
    for (const v of this.voices) { try { v.stop(0); } catch { /* pas encore parti */ } }
    this.voices.clear();
  }

  stop(ended = false) {
    const from = this.play ? this.play.from : this.pos;
    this.halt();
    this.play = null;
    this.pos = from;
    if (this.onstop) this.onstop(ended);
  }

  seek(beat) {
    this.pos = Math.max(0, beat);
    if (this.play) this.playFrom(this.pos);
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

// ── l'export : le même graphe, hors temps réel ──────────────
// OfflineAudioContext.startRendering (MDN) rend le mixage d'un coup, plus
// vite que le temps réel. `from`/`to` en noires ; `tail` : les secondes
// laissées aux réverbérations et aux chutes après la dernière note.
export async function renderMix(engine, p, from, to, { tail = 2, sampleRate = 48000 } = {}) {
  await engine.need(p);
  const spb = 60 / p.bpm;
  const length = Math.ceil(((to - from) * spb + tail) * sampleRate);
  const octx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  const g = new Graph(octx, { buffers: engine.buffers, live: () => {} });
  g.sync(p);
  g.resume(p, from, 0, to);
  g.schedule(p, from, to, 0, to);
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

export function peakDb(buf) {
  let pk = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; }
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
