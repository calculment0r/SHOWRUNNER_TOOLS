// ODIO — les ARCS du projet : des courbes 0..1 sur tout le morceau, peintes à
// la main comme l'arc d'énergie, rangées dans un groupe qu'on replie en
// accordéon en haut de l'arrangement (timeline.js) et appliquées par le moteur
// (moteur.js : l'étage de la sortie, l'entrée des retours).
//
// Cal, 06/10 : « l'arc d'énergie doit être dans un groupe d'arcs ; on a le
// volume, mais il en faut d'autres : réverbe et delay par exemple ; cherche
// d'autres ; et on en fait un groupe par défaut qu'on peut replier en accordéon ».
//
// Le format (projet.js) :
//   arc    { on, to: lpf|vol|both, pts }   l'arc d'ÉNERGIE, inchangé (une macro :
//          une courbe qui tient le filtre et le volume de la sortie, réglés par
//          arc_lo et arc_db de la Sortie) ; le banc du nodal le lit aussi (lane
//          ÉNERGIE) ; il est en tête du groupe
//   arcs   [{ id, k, on, pts }]            les autres arcs, dans l'ordre du groupe ;
//          un par sorte (k, ARCS ci-dessous) ; `pts` [[noire, 0..1], …] trié ;
//          la Tension n'a pas de `pts` : sa courbe est celle du banc (banc.ten)
//   ui.arcs { ouvert, peint }               le groupe déplié ou non, l'arc que la
//          rangée du groupe peint (pas un geste : hors de l'annulation)
//
// Le choix, et ses sources :
//   - l'automation de Live : toute commande du mixeur et des appareils a son
//     enveloppe dans l'arrangement, la Sortie (Main) et les retours compris
//     (Live 12, « Automation and Editing Envelopes ») ; un envoi s'automatise
//     comme le reste ;
//   - les Macros de Live : une commande qui en tient plusieurs, chacune entre
//     un min et un max (Live 12, « Instrument, Drum and Effect Racks » :
//     « each capable of addressing any number of parameters ») — c'est l'arc
//     d'énergie ;
//   - la largeur : l'Utility de Live, « Width » de 0 (mono) à 100 % (stéréo),
//     « automate the width […] to hold back the full width until a chorus
//     hits » (Live 12, « Live Audio Effect Reference », Utility) ;
//   - la densité : l'« intensité » et la « complexité » des Session Players de
//     Logic, automatisables (Logic Pro, « Edit a Session Player performance ») ;
//     les « energy curves » des outils de composition (CMUSE, Song Arrangement
//     Builder : « density, roles and dynamics » par section) ; ici elle ne fait
//     pas de son : le génératif la lit (valeursArcs) ;
//   - la tension : le canon d'ODIO_01 — ÉNERGIE et TENSION sont les deux
//     courbes du banc ; devant la tête elles deviennent les étiquettes et les
//     mots du style d'une région (docs/etudes/musique_generatif.md § 6.3) ;
//   - pas de tempo : le moteur pose les notes à tempo constant (at(b) linéaire,
//     moteur.js) et la Session se cale sur la tête ; une courbe de tempo
//     demande d'intégrer le temps partout — pas fait (prudence).
// Par défaut : Énergie, Volume, Filtre, Réverbe, Delay (le groupe d'un projet
// neuf, et d'un projet d'avant à son ouverture) ; Largeur, Saturation,
// Densité, Tension s'ajoutent (le « + » du groupe).

import { dbToGain } from './modules.js';
import { interp } from './moteur.js';
import { trajets, ARCS_DEFAUT } from './projet.js';

// Les lois 0..1 → réglage (choix de réglage, écrits ici) :
//   vol     1 : 0 dB (le mixage tel quel) ; en dessous, −40 dB × (1 − v) ; 0 : silence
//   filtre  1 : grand ouvert (20 kHz) ; 0 : 150 Hz ; entre les deux, en octaves (log)
//   reverb, delay  ce qui entre dans les retours : (2v)² — 0 : rien, ½ : l'envoi
//           de la console tel quel, 1 : +12 dB
//   largeur 1 : stéréo (100 %), 0 : mono (Utility de Live, Width)
//   satur   0 : propre, 1 : tanh(4x), tout mouillé (le mélange sec / saturé suit v)
//   densite, tension : des valeurs lues par le génératif, sans son
export const ARCS = {
  vol: { nom: 'Volume', couleur: 'grn2', neutre: 1, son: 'sortie', dit: 'sortie · volume', doc: 'le volume de la sortie : en haut, le mixage tel quel ; en bas, le silence' },
  filtre: { nom: 'Filtre', couleur: 'cy', neutre: 1, son: 'sortie', dit: 'sortie · passe-bas', doc: 'un passe-bas sur la sortie : en haut grand ouvert, en bas 150 Hz' },
  reverb: { nom: 'Réverbe', couleur: 'coral-1', neutre: 0.5, son: 'retour', dit: 'envoi · retours de réverbe', doc: 'ce qui entre dans les retours de réverbération : au milieu l\'envoi de la console, en haut +12 dB, en bas rien (les queues sonnent encore)' },
  delay: { nom: 'Delay', couleur: 'amb', neutre: 0.5, son: 'retour', dit: 'envoi · retours de délai', doc: 'ce qui entre dans les retours de délai (Délai, RTT-01) : au milieu l\'envoi de la console, en haut +12 dB, en bas rien' },
  largeur: { nom: 'Largeur', couleur: 'coral-2', neutre: 1, son: 'sortie', dit: 'sortie · stéréo', doc: 'la largeur stéréo de la sortie : en haut stéréo, en bas mono (Utility de Live, Width)' },
  satur: { nom: 'Saturation', couleur: 'coral-3', neutre: 0, son: 'sortie', dit: 'sortie · saturation', doc: 'une saturation douce (tanh) sur la sortie : en bas propre, en haut saturé' },
  densite: { nom: 'Densité', couleur: 'nd-ryt', neutre: 0.5, son: null, dit: 'génératif · densité', doc: 'combien ça joue : rien ne sonne, les régions génératives la lisent (le style, les sections)' },
  tension: { nom: 'Tension', couleur: 'nd-ten', neutre: 0.5, son: null, dit: 'génératif · la courbe du banc', doc: 'la tension du banc d\'ODIO_01 (sous le nodal) : la même courbe ; les régions génératives la lisent' },
};
export { ARCS_DEFAUT };   // le groupe par défaut : projet.js (le format), relu ici
export const ARCS_PLUS = ['largeur', 'satur', 'densite', 'tension'];
export const ENERGIE = { nom: 'Énergie', couleur: 'or', doc: 'l\'arc d\'énergie : une macro qui tient le filtre et le volume de la sortie (arc_lo, arc_db de la Sortie) ; le banc du nodal le lit' };
const ordreSortie = ['satur', 'filtre', 'largeur', 'vol'];   // l'étage de la sortie, dans l'ordre du son

// le groupe par défaut : un arc vide par sorte (rien ne change tant qu'on ne peint pas)
export const arcsDefaut = () => ARCS_DEFAUT.map((k) => ({ id: `a${k}`, k, on: true, pts: [] }));
export const arcNeuf = (k) => ({ id: `a${k}`, k, on: true, pts: [] });
// les points d'un arc (la Tension : ceux du banc)
export function ptsArc(p, A) {
  if (A.k !== 'tension') return A.pts || (A.pts = []);
  p.banc = p.banc || { segs: [], atts: [] };
  return p.banc.ten || (p.banc.ten = []);
}

// ── pour le génératif : ce que les arcs disent d'une plage ──
// { energie, volume, filtre, reverb, delay, largeur, satur, densite, tension } :
// la moyenne de chaque courbe sur [a, b) (en noires), relevée à chaque noire ;
// un arc éteint ou vide vaut son neutre (l'énergie vide : null).
export function valeursArcs(p, a, b) {
  const moy = (pts, neutre) => {
    if (!pts?.length) return neutre;
    let s = 0, n = 0;
    for (let t = a; t < b || n === 0; t += 1) { s += interp(pts, t); n++; if (b <= a) break; }
    return Math.round((s / n) * 1000) / 1000;
  };
  const out = { energie: p.arc?.on !== false ? moy(p.arc?.pts, null) : null };
  for (const k of Object.keys(ARCS)) {
    const A = (p.arcs || []).find((x) => x.k === k);
    out[k === 'vol' ? 'volume' : k] = A && A.on !== false ? moy(ptsArc(p, A), ARCS[k].neutre) : ARCS[k].neutre;
  }
  return out;
}

// ── le moteur ───────────────────────────────────────────────
const nyq = (ctx, f) => Math.min(f, ctx.sampleRate * 0.45);
const G = (ctx, gain = 1) => new GainNode(ctx, { gain });
// tanh(4u) sur u ∈ [−1, 1] : le gain d'entrée (1 + 3v) / 4 y place x, la courbe
// sature doucement jusqu'à |x (1 + 3v)| = 4 (tanh 4 ≈ 0,999)
let TANH = null;
const courbeTanh = () => TANH || (TANH = Float32Array.from({ length: 2049 }, (_, i) => Math.tanh(4 * ((i / 1024) - 1))));

// Un morceau de l'étage de la sortie : { input, output, cible: [[AudioParam, fn(v)], …], fin() }
const MORCEAUX = {
  vol(ctx) {
    const g = G(ctx);
    return { input: g, output: g, cible: [[g.gain, (v) => (v <= 0.001 ? 0 : dbToGain(-40 * (1 - v)))]] };
  },
  filtre(ctx) {
    const hi = nyq(ctx, 20000), lo = 150;
    const f = new BiquadFilterNode(ctx, { type: 'lowpass', Q: Math.SQRT1_2, frequency: hi });
    return { input: f, output: f, cible: [[f.frequency, (v) => lo * Math.pow(hi / lo, v)]] };
  },
  // la largeur, en milieu / côtés : M = (L + R) / 2, S = (L − R) / 2 × w ; L' = M + S, R' = M − S
  largeur(ctx) {
    const sp = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 }), mg = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    const mL = G(ctx, 0.5), mR = G(ctx, 0.5), sL = G(ctx, 0.5), sR = G(ctx, -0.5), mid = G(ctx), side = G(ctx), w = G(ctx), neg = G(ctx, -1);
    sp.connect(mL, 0); sp.connect(mR, 1); sp.connect(sL, 0); sp.connect(sR, 1);
    mL.connect(mid); mR.connect(mid); sL.connect(side); sR.connect(side); side.connect(w);
    mid.connect(mg, 0, 0); mid.connect(mg, 0, 1); w.connect(mg, 0, 0); w.connect(neg).connect(mg, 0, 1);
    return { input: sp, output: mg, cible: [[w.gain, (v) => v]] };
  },
  // sec (1 − v) + saturé v, le saturé poussé de (1 + 3v)
  satur(ctx) {
    const input = G(ctx), output = G(ctx), sec = G(ctx, 1), pre = G(ctx, 0.25), mouille = G(ctx, 0);
    const ws = new WaveShaperNode(ctx, { curve: courbeTanh(), oversample: 'none' });   // sans suréchantillonnage : pas de retard, le mélange reste en phase
    input.connect(sec).connect(output);
    input.connect(pre).connect(ws).connect(mouille).connect(output);
    return { input, output, cible: [[sec.gain, (v) => 1 - v], [pre.gain, (v) => (1 + 3 * v) / 4], [mouille.gain, (v) => v]] };
  },
};

// L'étage de la sortie (moteur.js, master) : entre l'arc d'énergie et les
// haut-parleurs. Il ne porte que les morceaux des arcs du projet qui font du son
// (config) : un projet sans arc de largeur ne paie pas sa matrice.
export function etageArcs(ctx) {
  const input = G(ctx), output = G(ctx);
  const faits = new Map();   // sorte → morceau
  let sig = null;
  input.connect(output);
  return {
    input, output, faits,
    config(sortes) {
      const voulu = ordreSortie.filter((k) => sortes.has(k)), s = voulu.join();
      if (s === sig) return;
      sig = s;
      input.disconnect();
      for (const m of faits.values()) m.output.disconnect();
      for (const k of [...faits.keys()]) if (!voulu.includes(k)) faits.delete(k);
      let prec = input;
      for (const k of voulu) {
        if (!faits.has(k)) faits.set(k, MORCEAUX[k](ctx));
        const m = faits.get(k);
        prec.connect(m.input);
        prec = m.output;
      }
      prec.connect(output);
    },
  };
}

// le genre d'un retour : le premier effet de sa chaîne qui est une réverbération ou un délai
const REVERBES = new Set(['reverb', 'reverbe']), DELAIS = new Set(['delay', 'rtt']);
export function genreRetour(p, t) {
  for (const id of trajets(p).ordre.get(t.id) || []) {
    const ty = p.modules.find((m) => m.id === id)?.type;
    if (REVERBES.has(ty)) return 'reverb';
    if (DELAIS.has(ty)) return 'delay';
  }
  return null;
}
// les retours qu'un arc d'envoi tient
export const retoursDe = (p, k) => p.tracks.filter((t) => t.kind === 'bus' && genreRetour(p, t) === k);

// Les AudioParam d'un arc dans ce graphe : [[param, fn], …] (vide : rien à tenir)
function cibles(g, p, A) {
  const def = ARCS[A.k];
  if (!def?.son) return [];
  if (def.son === 'retour') return retoursDe(p, A.k).map((t) => g.nodes.get(t.src)?.arc).filter(Boolean).map((prm) => [prm, (v) => (2 * v) * (2 * v)]);
  const mm = p.modules.find((x) => x.type === 'master');
  return g.nodes.get(mm?.id)?.etage?.faits.get(A.k)?.cible || [];
}
const actif = (p, A) => A.on !== false && ptsArc(p, A).length > 0;

// la sortie ne porte que les morceaux des arcs actifs (Graph.sync)
export function configurerArcs(g, p) {
  const mm = p.modules.find((x) => x.type === 'master');
  const et = g.nodes.get(mm?.id)?.etage;
  if (et) et.config(new Set((p.arcs || []).filter((A) => ARCS[A.k]?.son === 'sortie' && actif(p, A)).map((A) => A.k)));
}

// Ce que chaque AudioParam a reçu en dernier : { t (l'instant), b (le temps) }.
// Une tranche qui continue la précédente n'enchaîne que des rampes ; un
// départ, un saut ou la première tranche d'un arc neuf partent de la valeur
// présente et rejoignent la courbe en 6 ms ; la boucle qui revient aussi. Pas
// de setValueAtTime à chaque tranche (sauf hors temps réel, l'export : ses
// tranches ne viennent pas dans l'ordre, chacune pose son départ).
const FIN = new WeakMap();
const LISSE = 0.006;
function rampe(ctx, cible, pts, b0, b1, at) {
  const t0 = at(b0), t1 = at(b1), hors = ctx instanceof OfflineAudioContext;
  for (const [prm, fn] of cible) {
    const st = FIN.get(prm), v0 = fn(interp(pts, b0));
    let depuis = t0;
    if (hors) prm.setValueAtTime(v0, t0);
    else if (!st || Math.abs(st.t - t0) > 1e-4) {
      prm.cancelScheduledValues(t0);
      prm.setValueAtTime(prm.value, t0);
      depuis = Math.min(t1, t0 + LISSE);
      prm.linearRampToValueAtTime(v0, depuis);
    } else if (Math.abs(st.b - b0) > 1e-6) {
      depuis = Math.min(t1, t0 + LISSE);
      prm.linearRampToValueAtTime(v0, depuis);
    }
    for (const [b, v] of pts) if (b > b0 && b < b1 && at(b) > depuis + 1e-6) prm.linearRampToValueAtTime(fn(v), at(b));
    prm.linearRampToValueAtTime(fn(interp(pts, b1)), Math.max(t1, depuis));
    FIN.set(prm, { t: t1, b: b1 });
  }
}

// Graph.automate : chaque arc qui fait du son, sur la tranche [b0, b1) ; un
// arc qu'on vient d'éteindre ou de vider rejoint son neutre (6 ms) et se tait
export function planifierArcs(g, p, b0, b1, at) {
  for (const A of p.arcs || []) {
    const def = ARCS[A.k];
    if (!def?.son) continue;
    const cible = cibles(g, p, A);
    if (actif(p, A)) { rampe(g.ctx, cible, ptsArc(p, A), b0, b1, at); continue; }
    for (const [prm, fn] of cible) {
      if (!FIN.has(prm)) continue;
      prm.linearRampToValueAtTime(fn(def.neutre), at(b0) + LISSE);
      FIN.delete(prm);
    }
  }
  // un retour qu'aucun arc ne tient plus (l'arc retiré en lecture) : l'envoi de la console, en 6 ms
  for (const t of p.tracks) {
    const prm = t.kind === 'bus' ? g.nodes.get(t.src)?.arc : null;
    if (!prm || !FIN.has(prm) || (p.arcs || []).some((A) => ARCS[A.k]?.son === 'retour' && genreRetour(p, t) === A.k)) continue;
    prm.linearRampToValueAtTime(1, at(b0) + LISSE);
    FIN.delete(prm);
  }
}

// Graph.settle (à l'arrêt, un saut, un geste) : chaque réglage prend la valeur
// de son arc à la tête (son neutre, éteint), en glissant (12 ms)
export function poserArcs(g, p, beat) {
  const ctx = g.ctx, vit = !(ctx instanceof OfflineAudioContext) && ctx.state === 'running';
  for (const A of p.arcs || []) {
    const def = ARCS[A.k];
    if (!def?.son) continue;
    const v = actif(p, A) ? interp(ptsArc(p, A), beat) : def.neutre;
    for (const [prm, fn] of cibles(g, p, A)) {
      prm.cancelScheduledValues(0);
      FIN.delete(prm);
      if (vit) prm.setTargetAtTime(fn(v), ctx.currentTime, 0.012); else prm.value = fn(v);
    }
  }
  // les retours qu'aucun arc ne tient plus (l'arc retiré, le retour changé de genre) : l'envoi tel quel
  const tenus = new Set((p.arcs || []).filter((A) => ARCS[A.k]?.son === 'retour').flatMap((A) => retoursDe(p, A.k).map((t) => t.id)));
  for (const t of p.tracks) {
    const prm = t.kind === 'bus' && !tenus.has(t.id) ? g.nodes.get(t.src)?.arc : null;
    if (!prm) continue;
    prm.cancelScheduledValues(0);
    FIN.delete(prm);
    if (vit) prm.setTargetAtTime(1, ctx.currentTime, 0.012); else prm.value = 1;
  }
}
