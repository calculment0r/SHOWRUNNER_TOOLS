// ODIO — « Détecter le tempo » d'un clip audio (clic droit sur le clip).
//
// Cal, 05/10 : « ça serait top d'avoir le BPM detector dans audio sur une
// piste audio qu'on a importée ». Le panneau : le tempo du son (et sa
// confiance), sa première pulsation, son premier temps fort, la grille dessinée
// sur sa forme d'onde, une écoute avec un clic sur chaque temps ; on corrige à
// la main (÷ 2, × 2, saisie, le temps qui est le « 1 ») ; puis Appliquer :
// régler le tempo du projet sur celui du son et / ou caler le clip sur la
// grille (son début sur un temps fort, posé sur une barre de mesure).
//
// Le calcul : musique/tempo.js (la méthode et ses sources y sont), sur le son
// que le moteur a déjà décodé, rééchantillonné à 11 025 Hz mono par un
// OfflineAudioContext. ODIO ne fait pas d'étirement sans changer la hauteur
// (musique.md § 6, « Re-Pitch seulement ») : pour qu'un son tombe sur la
// grille, c'est le projet qui prend son tempo — ou le clip qui prend celui du
// projet en changeant de vitesse (Re-Pitch, la hauteur bouge avec).
//
// Aucune couleur ici : les dessins lisent les jetons (commun/tokens.css).

import { toast } from '../commun/shell.js';
import { clipBuffer } from './moteur.js';
import { clipRate } from './projet.js';
import { el, put, drawer } from './ui.js';
import { analyser, REGLAGES } from './tempo.js';

const CSS = new URL('./bpm.css', import.meta.url).href;
const memo = new Map();                 // item (+ à l'envers) → l'analyse : on ne refait pas
const fmt = (s, d = 3) => `${s.toFixed(d).replace('.', ',')} s`;
const nb = (v, d = 2) => v.toFixed(d).replace('.', ',');

// le son tel que le clip le joue (à l'envers compris), en mono à 11 025 Hz
async function sonMono(buf) {
  const sr = REGLAGES.sr, n = Math.max(1, Math.ceil(buf.duration * sr));
  const oc = new OfflineAudioContext(1, n, sr);
  const src = new AudioBufferSourceNode(oc, { buffer: buf });
  src.connect(oc.destination);
  src.start(0);
  return (await oc.startRendering()).getChannelData(0);
}

async function analyse(app, c) {
  const key = `${c.item}${c.rev ? ':rev' : ''}|${app.S.proj.sig}`;
  if (!memo.has(key)) {
    memo.set(key, (async () => {
      const buf = clipBuffer(await app.engine.buffer(c.item), c);
      const x = await sonMono(buf);
      const r = await analyser(x, REGLAGES.sr, { sig: app.S.proj.sig });
      return { ...r, buf };
    })().catch((e) => { memo.delete(key); throw e; }));
  }
  return memo.get(key);
}

export async function openTempo(app, clipId) {
  if (!document.querySelector('link[data-bpm-css]')) document.head.append(el('link', { rel: 'stylesheet', href: CSS, 'data-bpm-css': '' }));
  const c0 = app.clip(clipId);
  if (!c0?.item) { toast('un clip audio avec un son'); return; }
  const name = c0.name || app.track(c0.track)?.name || 'clip';
  const dr = drawer({ title: 'Tempo', cls: 'bpm-dr' });
  put(dr.body, el('div', { class: 'gen-sec bpm-wait' }, el('span', { class: 'pill work' }, el('i'), el('span', {}, 'analyse')),
    el('span', { class: 'lbl' }, `${name} : la pulsation, la première attaque, le temps fort`)));
  let R;
  try { R = await analyse(app, c0); } catch (e) {
    put(dr.body, el('p', { class: 'why' }, `le son ne se lit pas : ${e.message}`));
    return;
  }
  if (!dr.root.isConnected) return;
  if (!R.ok) {
    put(dr.body, el('div', { class: 'gen-sec' }, el('b', { class: 'venus' }, name), el('p', { class: 'why' }, `pas de tempo : ${R.pourquoi}`)));
    return;
  }
  panel(app, clipId, R, dr, name);
}

function panel(app, clipId, R, dr, name) {
  const P = app.S.proj;
  const c = app.clip(clipId);
  const rate = clipRate(c);
  // l'état du panneau : le tempo choisi (en BPM du son, à sa vitesse d'origine),
  // le temps qui est le « 1 » (rang dans la grille, modulo la mesure), les gestes
  const st = {
    bpm: R.propose, phase: R.phase ?? 0, ecoute: null,
    tempo: Math.abs(R.propose * rate - P.bpm) < 0.005 ? 'rien' : 'projet', caler: true,
  };
  const sig = P.sig;
  const T = () => 60 / st.bpm;                      // la période choisie, en secondes de son
  // la grille du tempo choisi : celle de l'analyse si on ne l'a pas changé ; sinon la même
  // première pulsation, au pas choisi (÷ 2 : un temps sur deux ; × 2 : un temps entre deux)
  const grille = () => {
    const out = [];
    for (let t = R.premier; t < R.duree - 0.02; t += T()) out.push(t);
    return out;
  };
  const fort = () => {                               // le premier temps fort à partir du début du clip
    const g = grille(), off = c.off || 0;
    const k0 = g.findIndex((t) => t >= off - 0.03);
    if (k0 < 0) return null;
    for (let k = k0; k < g.length; k++) if (((k - st.phase) % sig + sig) % sig === 0) return { t: g[k], k };
    return null;
  };

  const conf = R.confiance, confMot = conf >= 0.8 ? 'nette' : conf >= 0.5 ? 'moyenne' : 'faible';
  const pourquoiConf = conf >= 0.8 ? 'les temps suivis tombent sur une grille droite'
    : !R.stable ? `le tempo bouge (écart moyen à la grille : ${Math.round(R.ecart * 1000)} ms) : le calage n'est juste qu'au début`
      : 'peu d\'attaques franches : écoute avant d\'appliquer';

  const inp = el('input', { class: 'fld bpm-in', type: 'number', min: 20, max: 300, step: 0.01, value: String(st.bpm), 'aria-label': 'tempo à appliquer',
    onchange: (e) => { const v = +e.target.value; if (v >= 20 && v <= 300) { st.bpm = Math.round(v * 100) / 100; repaint(); } else e.target.value = String(st.bpm); } });
  const canvas = el('canvas', { class: 'bpm-cv', height: 120 });
  const body = el('div', { class: 'bpm-live' });

  const fois = (f) => { const v = Math.round(st.bpm * f * 100) / 100; if (v >= 20 && v <= 300) { st.bpm = v; inp.value = String(v); repaint(); } };
  const octave = R.octave
    ? el('p', { class: 'bpm-oct' }, `${R.octave.nom} tout aussi plausible : ${R.octave.pourquoi}`) : null;

  function repaint() {
    const f = fort();
    const heard = st.bpm * rate;
    const P2 = st.tempo === 'projet' ? heard : st.tempo === 'clip' ? P.bpm : P.bpm;
    const pitch = st.tempo === 'clip' ? 12 * Math.log2(P.bpm / st.bpm) : (c.pitch || 0);
    const pitchOk = Math.abs(pitch) <= 48;
    const same = Math.abs(heard - P.bpm) < 0.005;
    put(body,
      el('div', { class: 'gen-sec' },
        el('div', { class: 'row bpm-row' }, el('span', { class: 'lbl' }, 'premier temps fort'),
          el('b', { class: 'bpm-v' }, f ? fmt(f.t) : '—'),
          el('span', { class: 'sp' }),
          el('span', { class: 'lbl' }, 'le « 1 »'),
          el('button', { class: 'tb ghost sm', type: 'button', title: 'le temps d\'avant est le « 1 »', 'aria-label': 'le « 1 » un temps plus tôt', onclick: () => { st.phase = (st.phase + sig - 1) % sig; repaint(); } }, '‹'),
          el('button', { class: 'tb ghost sm', type: 'button', title: 'le temps d\'après est le « 1 »', 'aria-label': 'le « 1 » un temps plus tard', onclick: () => { st.phase = (st.phase + 1) % sig; repaint(); } }, '›')),
        el('p', { class: 'lbl bpm-note' }, R.phaseConfiance >= 0.5 && st.phase === R.phase
          ? `le temps où l'attaque grave et le changement de son sont les plus forts, sur ${sig}`
          : st.phase !== R.phase ? `choisi à la main (l'analyse disait ${fmt(R.tempsFort ?? R.premier)})`
            : 'estimation fragile (le temps fort se devine moins bien que le tempo) : écoute, et déplace le « 1 » si besoin'),
        canvas),
      el('div', { class: 'gen-sec bpm-apply' },
        el('b', { class: 'venus' }, 'Appliquer'),
        el('div', { class: 'seg bpm-seg', role: 'group', 'aria-label': 'les tempos' }, ...[
          ['projet', `projet → ${nb(heard)}`, same ? `le projet est déjà à ${nb(P.bpm)}` : ''],
          ['clip', 'clip → projet', !pitchOk ? 'plus de quatre octaves' : same ? 'déjà au tempo du projet' : ''],
          ['rien', 'tempo inchangé', '']].map(([k, l, off]) => el('button', { class: `tb sm${st.tempo === k ? ' on' : ''}`, type: 'button', disabled: off ? true : null, title: off || null,
          'aria-pressed': st.tempo === k ? 'true' : 'false', onclick: () => { st.tempo = k; repaint(); } }, l))),
        el('p', { class: 'lbl bpm-note' }, st.tempo === 'projet' ? `le tempo du projet passe de ${nb(P.bpm)} à ${nb(heard)} BPM ; le clip garde sa durée, les autres clips gardent leur place en mesures`
          : st.tempo === 'clip' ? `le clip change de vitesse pour jouer à ${nb(P.bpm)} BPM : ${pitch >= 0 ? '+' : '−'}${nb(Math.abs(pitch))} demi-ton${Math.abs(pitch) >= 2 ? 's' : ''} (Re-Pitch : la hauteur bouge avec ; ODIO n'étire pas sans changer la hauteur)`
            : same ? 'le son est déjà au tempo du projet' : `le son reste à ${nb(heard)} BPM dans un projet à ${nb(P.bpm)} : il dérive de la grille`),
        el('label', { class: 'opt mu-check bpm-check' }, el('input', { type: 'checkbox', checked: st.caler || null, disabled: f ? null : true, onchange: (e) => { st.caler = e.target.checked; repaint(); } }),
          el('span', {}, f ? `caler le clip sur la grille : son début sur ce temps fort (${fmt(f.t)} dans le son), posé sur la barre de mesure la plus proche` : 'caler : aucun temps fort dans le clip')),
        el('div', { class: 'gen-foot bpm-foot' },
          el('span', { class: 'lbl' }, `Ctrl+Z défait tout d'un coup`), el('span', { class: 'sp' }),
          el('button', { class: 'tb go', type: 'button', disabled: st.tempo === 'rien' && !st.caler ? true : null,
            title: st.tempo === 'rien' && !st.caler ? 'rien à faire : choisis un tempo ou coche « caler »' : null, onclick: () => appliquer() }, 'Appliquer'))));
    requestAnimationFrame(dessin);
  }

  // la forme d'onde du clip (ses premières mesures, depuis le temps fort) et la grille dessus
  function dessin() {
    if (!canvas.isConnected) return;
    const css = getComputedStyle(canvas);
    const col = (n) => css.getPropertyValue(`--${n}`).trim();
    const w = canvas.clientWidth || 480, h = canvas.height;
    canvas.width = Math.round(w * devicePixelRatio); canvas.height = Math.round(h * devicePixelRatio);
    canvas.style.height = `${h}px`;
    const g = canvas.getContext('2d');
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, w, h);
    const f = fort();
    const a = Math.max(0, (f ? f.t : R.premier) - T() * 0.5);
    const b = Math.min(R.duree, a + T() * sig * 4 + T());
    const d = R.buf.getChannelData(0), sr = R.buf.sampleRate;
    g.fillStyle = col('cy');
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor((a + ((b - a) * x) / w) * sr), i1 = Math.floor((a + ((b - a) * (x + 1)) / w) * sr);
      let m = 0;
      for (let i = i0; i < i1; i += 4) { const v = Math.abs(d[i] || 0); if (v > m) m = v; }
      const y = m * (h / 2 - 8);
      g.fillRect(x, h / 2 - y, 1, Math.max(1, 2 * y));
    }
    // les temps : un trait plein sur le « 1 » de chaque mesure, des encoches en haut et en bas sur les autres
    const gr = grille();
    for (let k = 0; k < gr.length; k++) {
      const t = gr[k];
      if (t < a || t > b) continue;
      const x = Math.round(((t - a) / (b - a)) * w);
      const one = ((k - st.phase) % sig + sig) % sig === 0;
      g.fillStyle = one ? col('or') : col('ink2');
      if (one) g.fillRect(x, 0, 2, h);
      else { g.fillRect(x, 0, 1, 12); g.fillRect(x, h - 12, 1, 12); }
    }
    g.fillStyle = col('ink3');
    g.font = `9px ${col('f-mono') || 'monospace'}`;
    g.textAlign = 'right';
    g.fillText(`${fmt(a, 2)} → ${fmt(b, 2)}`, w - 6, 22);
  }

  // écouter : le son depuis le temps fort, un clic sur chaque temps (plus haut sur le « 1 »)
  function ecouter(btn) {
    if (st.ecoute) { st.ecoute.close(); st.ecoute = null; btn.textContent = 'Écouter avec les temps'; return; }
    const f = fort();
    const t0 = Math.max(0, (f ? f.t : R.premier) - 0.2), dur = Math.min(R.duree - t0, T() * sig * 4 + 0.4);
    const ctx = new AudioContext();
    st.ecoute = ctx;
    btn.textContent = 'Arrêter';
    const at = ctx.currentTime + 0.08;
    const src = new AudioBufferSourceNode(ctx, { buffer: R.buf });
    const g = new GainNode(ctx, { gain: 0.8 });
    src.connect(g).connect(ctx.destination);
    src.start(at, t0, dur);
    const gr = grille();
    for (let k = 0; k < gr.length; k++) {
      const t = gr[k] - t0;
      if (t < 0 || t > dur) continue;
      const one = ((k - st.phase) % sig + sig) % sig === 0;
      const o = new OscillatorNode(ctx, { frequency: one ? 1760 : 1320 });
      const e = new GainNode(ctx, { gain: 0 });
      e.gain.setValueAtTime(0, at + t);
      e.gain.linearRampToValueAtTime(one ? 0.35 : 0.22, at + t + 0.002);
      e.gain.exponentialRampToValueAtTime(0.001, at + t + 0.05);
      o.connect(e).connect(ctx.destination);
      o.start(at + t); o.stop(at + t + 0.06);
    }
    src.onended = () => { if (st.ecoute === ctx) { ctx.close(); st.ecoute = null; btn.textContent = 'Écouter avec les temps'; } };
  }

  function appliquer() {
    const cc = app.clip(clipId);
    if (!cc) { toast('le clip a disparu'); dr.close(); return; }
    const was = app.engine.running, at = app.engine.position();
    const old = P.bpm, r0 = clipRate(cc);
    const secs = cc.len * 60 / old;                   // la durée jouée du clip, en secondes
    const sEnd = (cc.off || 0) + secs * r0;           // où le clip finit dans le son
    const done = [];
    if (st.tempo === 'projet') {
      P.bpm = Math.round(st.bpm * r0 * 100) / 100;
      cc.len = Math.max(0.0625, (secs * P.bpm) / 60);
      done.push(`tempo du projet ${nb(old)} → ${nb(P.bpm)}`);
    } else if (st.tempo === 'clip') {
      const p = Math.round(12 * Math.log2(P.bpm / st.bpm) * 1000) / 1000;
      cc.pitch = p || undefined;
      if (!st.caler) cc.len = Math.max(0.0625, ((sEnd - (cc.off || 0)) / clipRate(cc)) * P.bpm / 60);   // le même bout de son
      done.push(`clip à ${nb(P.bpm)} BPM (${p >= 0 ? '+' : '−'}${nb(Math.abs(p))} demi-tons)`);
    }
    const f = fort();
    if (st.caler && f) {
      const spb = 60 / P.bpm, rate = clipRate(cc);
      // où le temps fort joue maintenant (en temps du projet), et la barre la plus proche
      const off = cc.off || 0;
      const b = cc.start + ((f.t - off) / rate) / spb;
      const bar = Math.max(0, Math.round(b / sig) * sig);
      cc.off = Math.round(f.t * 1e6) / 1e6;
      cc.start = bar;
      if (cc.loop) {
        // la boucle part du temps fort et dure des mesures entières (au tempo du son)
        const m = sig * T();
        cc.ls = cc.off;
        cc.llen = Math.round(Math.max(1, Math.round((cc.llen || m) / m)) * m * 1e6) / 1e6;
      } else {
        cc.len = Math.max(0.0625, ((sEnd - cc.off) / rate) / spb);
      }
      done.push(`calé sur la mesure ${Math.floor(bar / sig) + 1}${f.t - off > 0.05 ? ` (les ${nb(f.t - off, 2)} s d'avant restent derrière la poignée gauche)` : ''}`);
    }
    app.label(`tempo de « ${name} »`);
    app.commit('meta');
    if (was) app.engine.playFrom(at);
    toast(done.join(' · '), 6000);
    dr.close();
  }

  const listen = el('button', { class: 'tb ghost sm', type: 'button', onclick: (e) => ecouter(e.currentTarget) }, 'Écouter avec les temps');
  put(dr.body,
    el('div', { class: 'gen-sec bpm-head' },
      el('div', { class: 'row bpm-row' }, el('b', { class: 'venus' }, name), el('span', { class: 'sp' }), listen),
      el('div', { class: 'bpm-big' }, el('b', {}, nb(R.bpm)), el('small', {}, 'bpm'),
        el('span', { class: 'lbl', title: 'deux erreurs types de la pente des temps suivis' }, `± ${nb(Math.min(R.ebpm, 99), R.ebpm < 0.1 ? 3 : 2)}`)),
      el('div', { class: 'row bpm-row' },
        el('span', { class: 'lbl' }, 'confiance'),
        el('span', { class: 'bpm-meter', style: `--v:${Math.round(conf * 100)}%` }, el('i')),
        el('b', { class: `bpm-conf ${conf >= 0.8 ? 'ok' : conf >= 0.5 ? 'mid' : 'low'}` }, `${Math.round(conf * 100)} % · ${confMot}`)),
      el('p', { class: 'lbl bpm-note' }, pourquoiConf),
      octave,
      el('div', { class: 'row bpm-row' },
        el('span', { class: 'lbl' }, 'tempo à appliquer'), inp,
        el('button', { class: 'tb ghost sm', type: 'button', title: 'la moitié (un temps sur deux)', onclick: () => fois(0.5) }, '÷2'),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'le double (un temps entre deux)', onclick: () => fois(2) }, '×2'),
        el('span', { class: 'sp' }),
        R.propose !== Math.round(R.bpm * 100) / 100 ? el('span', { class: 'lbl', title: 'l\'entier tombe dans l\'incertitude de la mesure : un tempo de séquenceur' }, 'arrondi') : null),
      el('p', { class: 'lbl bpm-note' }, `première pulsation à ${fmt(R.premier)} dans le son${rate !== 1 ? ` · le clip joue à ${nb(rate, 3)} × : on l'entend à ${nb(R.bpm * rate)} BPM` : ''} · analysé en ${R.ms} ms`)),
    body,
    el('details', { class: 'gen-sec bpm-how' }, el('summary', {}, 'comment c\'est mesuré'),
      el('p', { class: 'lbl bpm-note' }, 'Flux spectral (Percival & Tzanetakis 2014), autocorrélation pondérée autour de 120 BPM (librosa.feature.tempo) et ses multiples (TPS2 / TPS3, Ellis 2007), temps suivis par programmation dynamique (Ellis 2007, comme librosa.beat.beat_track), recalés sur les attaques ; une grille qui alterne fort / faible est une subdivision (le tempo est divisé par deux). Le temps fort : l\'attaque grave et le changement de son (Davies & Plumbley 2006). Le détail : musique/tempo.js.')));
  repaint();
  dr.root.addEventListener('transitionend', () => requestAnimationFrame(dessin), { once: true });
  const stop = () => { if (st.ecoute) { st.ecoute.close(); st.ecoute = null; } };
  new MutationObserver((_, o) => { if (!dr.root.isConnected) { stop(); o.disconnect(); } }).observe(document.body, { childList: true });
}
