// L'INFLUENCE DES ATTRACTEURS — ce qu'un attracteur ramène, et ce qu'il fait au son.
//
// La lecture est celle d'ODIO_01 (apps/studio/src/banc/logique.ts, décisions
// n° 54 à 57 de docs/logique-globale.md) : un anneau capte les blocs qui
// DÉCLARENT sa facette et dont la boîte est à moins de son rayon ; le poids
// d'un bloc vaut (1 − distance / rayon)^loi ; l'opérateur d'un réglage vaut
// neutre + (valeur − neutre) × poids, le neutre étant le défaut que le bloc
// déclare. L'attracteur parle quand la tête qui gouverne traverse son
// segment (n° 62, 71).
//
// ODIO_01 s'arrêtait là : « les opérateurs sont une LECTURE — brancher leur
// effet au moteur est le chantier suivant » (HANDOFF.md). Le chantier est
// fait ici, à la lettre de la formule : PENDANT QU'IL PARLE, chaque réglage
// capté joue la valeur de son opérateur ; quand il se tait, le réglage
// reprend la sienne. Rien n'est écrit dans le projet — c'est le moteur qui
// entend, au temps de l'horloge audio (moteur.js appelle `influer` à chaque
// tranche planifiée, `rendre` à l'arrêt). Deux choix, dits :
//   - un réglage capté par deux anneaux (question ouverte n° 8) joue
//     l'opérateur de plus grand poids ;
//   - un réglage qui a une voie d'automation la garde : l'attracteur ne
//     reprend pas ce que le musicien a dessiné.
//
// Pur, sans DOM : la même fonction sert le banc (les chiffres), le moteur (le
// son), l'export hors temps réel, et le génératif (`attracteursActifs`).

import { MODULES, spec, val, moduleName } from '../modules.js';
import { FACETTES as FACETTES_MACHINES, ecartBoite, poids } from './banc/logique.js';
import { tuilesDe, porteurDeTuile, machineDef, moteurDe, descripteursDe, valeurControle, normeDe } from './tuiles.js';

export { FACETTES_MACHINES, ecartBoite, poids };

// CE QUE CHAQUE RÉGLAGE DES MODULES D'ICI A « DE RYTHMIQUE, D'HARMONIQUE, DE
// TIMBRAL » (n° 54, 66) — la table du 29/09 (banc.js), À RELIRE PAR CAL. Les
// contrôles des machines ont la leur, celle d'ODIO_01 (logique.ts, FACETTES),
// et une machine ne déclare que celle-là : ses réglages de moteur ne comptent
// pas deux fois.
export const FACETTES_MODULES = {
  'synth.oct': 'tonalité', 'synth.oct2': 'tonalité', 'synth.det': 'tension', 'synth.cut': 'brillance',
  'synth.res': 'matière', 'synth.fenv': 'matière', 'synth.wave': 'matière',
  'analog.detune': 'tension', 'analog.cutoff': 'brillance', 'analog.resonance': 'matière', 'analog.envAmount': 'matière', 'analog.wave': 'matière',
  'acid.cutoff': 'brillance', 'acid.resonance': 'matière', 'acid.envMod': 'matière', 'acid.accent': 'accents',
  'plaits.timbre': 'brillance', 'plaits.harmo': 'matière', 'plaits.morph': 'matière', 'plaits.cutoff': 'brillance', 'plaits.resonance': 'matière',
  'sampler.root': 'tonalité',
  'rythme.drive': 'matière',
  'filtre.cutoff': 'brillance', 'filtre.reso': 'matière', 'filtre.drive': 'matière',
  'satura.drive': 'matière', 'crush.bits': 'matière', 'eq3.high': 'brillance',
};

/**
 * Les blocs qui déclarent un thème, avec leur boîte monde et leurs réglages
 * lus. Une section de machine est un bloc (ODIO_01 : un bloc par section) ;
 * un module ordinaire est un bloc.
 */
export function blocsDInfluence(p, tuiles = tuilesDe(p, MODULES)) {
  const out = [];
  for (const t of tuiles) {
    const { owner, sec } = porteurDeTuile(p, t.id);
    if (!owner) continue;
    const parametres = [];
    if (sec && owner.mach) {
      const def = machineDef(owner.mach.id);
      for (const d of descripteursDe(sec)) {
        const f = FACETTES_MACHINES[d.id];
        if (!f) continue;
        parametres.push({ facette: f, label: d.label || d.id, def: d.default, valeur: valeurControle(owner, sec, d.id), unit: d.unit || '',
          min: d.min, max: d.max, ctl: d.id, sec });
      }
      if (!parametres.length) continue;
      const section = def?.sections.find((s) => s.id === sec);
      out.push({ id: t.id, mod: owner.id, bloc: t.bloc, nom: `${(def?.name || '').split(' ')[0]} · ${section?.name || sec}`,
        boite: { x: t.x, y: t.y, w: t.w, h: t.h }, facettes: new Set(parametres.map((x) => x.facette)), parametres });
      continue;
    }
    if (t.bloc || owner.mach) continue;
    for (const s of MODULES[owner.type]?.params || []) {
      const f = FACETTES_MODULES[`${owner.type}.${s.k}`];
      if (!f) continue;
      parametres.push({ facette: f, label: s.label, def: s.def, valeur: val(owner, s.k), unit: s.unit || '', min: s.min, max: s.max, cle: s.k });
    }
    if (!parametres.length) continue;
    const tr = owner.track && p.tracks.find((x) => x.id === owner.track);
    out.push({ id: t.id, mod: owner.id, bloc: false, nom: `${moduleName(owner.type)}${tr ? ` · ${tr.name}` : ''}`,
      boite: { x: t.x, y: t.y, w: t.w, h: t.h }, facettes: new Set(parametres.map((x) => x.facette)), parametres });
  }
  return out;
}

/** Ce que l'attracteur ramène : neutre + (valeur − neutre) × poids (n° 55) — logique.ts, `operateurs`. */
export function operateurs(atr, blocs) {
  const out = [];
  for (const an of atr.anneaux) {
    for (const b of blocs) {
      const d = ecartBoite(b.boite, atr.x, atr.y);
      if (d > an.r) continue;
      const w = poids(d, an.r, atr.loi);
      for (const q of b.parametres) {
        if (q.facette !== an.facette) continue;
        out.push({ blocId: b.id, mod: b.mod, blocNom: b.nom, facette: an.facette, couleur: an.couleur, label: q.label, valeur: q.valeur, w,
          op: q.def + (q.valeur - q.def) * w, unite: q.unit, ctl: q.ctl, sec: q.sec, cle: q.cle, min: q.min, max: q.max });
      }
    }
  }
  return out.sort((a, b) => b.w - a.w);
}
/** Les blocs qu'un anneau écoute — logique.ts, `membres`. */
export const membres = (atr, an, blocs) => blocs.filter((b) => b.facettes.has(an.facette) && ecartBoite(b.boite, atr.x, atr.y) <= an.r);
/** Le temps décide s'il parle (logique.ts, `actif`). */
export const actif = (seg, t) => seg.d <= t && t < seg.d + seg.l;

/**
 * LES ATTRACTEURS QUI PARLENT À UN INSTANT, et ce qu'ils ramènent.
 * Pour le génératif (et pour qui veut lire le banc) : à la tête `t` (en temps,
 * noire = 1), la liste des attracteurs dont le segment est traversé, chacun
 * avec sa lane, son segment et ses opérateurs, du plus lourd au plus léger.
 */
export function attracteursActifs(p, t, blocs = null) {
  const B = p.banc || {};
  const out = [];
  for (const seg of B.segs || []) {
    if (!seg.atr || !actif(seg, t)) continue;
    const atr = (B.atts || []).find((a) => a.id === seg.atr);
    if (!atr) continue;
    blocs = blocs || blocsDInfluence(p);
    out.push({ id: atr.id, nom: atr.nom, couleur: atr.couleur, lane: seg.lane, segment: { id: seg.id, d: seg.d, l: seg.l },
      x: atr.x, y: atr.y, loi: atr.loi, anneaux: atr.anneaux.map((a) => ({ facette: a.facette, r: a.r })), operateurs: operateurs(atr, blocs) });
  }
  return out;
}

/**
 * Ce que le moteur doit jouer à l'instant `t` : module → réglage → { v, w }.
 * Un contrôle de machine agit par son branchement (MACHINE_ENGINES.map) : son
 * opérateur, dans l'unité du contrôle, devient la valeur du réglage du module
 * qui porte le son. Un contrôle qui n'est branché à rien ne s'entend pas —
 * comme sur la machine elle-même (rack.ts : « on branche ce qui s'entend »).
 */
export function influenceA(p, t) {
  const carte = new Map();
  const actifs = attracteursActifs(p, t);
  if (!actifs.length) return carte;
  const auto = new Set((p.auto || []).filter((L) => L.on !== false && L.pts?.length).map((L) => `${L.mod}:${L.k}`));
  const poser = (mod, k, v, w) => {
    if (auto.has(`${mod}:${k}`)) return;
    let m = carte.get(mod);
    if (!m) { m = new Map(); carte.set(mod, m); }
    const cur = m.get(k);
    if (!cur || w > cur.w) m.set(k, { v, w });
  };
  for (const a of actifs) {
    for (const o of a.operateurs) {
      const owner = p.modules.find((m) => m.id === o.mod);
      if (!owner) continue;                       // un bloc sans son (clavier, séquenceur)
      if (o.ctl && owner.mach) {
        const entry = moteurDe(owner.mach.id)?.map?.[o.ctl];
        if (!entry) continue;
        poser(owner.id, entry.param, entry.from(normeDe({ min: o.min, max: o.max }, o.op)), o.w);
      } else if (o.cle) {
        const s = spec(owner.type, o.cle);
        if (!s || s.opts) continue;
        poser(owner.id, o.cle, Math.min(s.max, Math.max(s.min, o.op)), o.w);
      }
    }
  }
  return carte;
}

/** Les instants où ce qui parle change : le début et la fin de chaque segment attaché. */
export function bornes(p) {
  const out = new Set();
  for (const s of p.banc?.segs || []) if (s.atr) { out.add(s.d); out.add(s.d + s.l); }
  return [...out].sort((a, b) => a - b);
}

// ── le moteur ────────────────────────────────────────────────
// `graph` est un Graph de moteur.js : ses nœuds (`nodes`), son environnement
// (`env.held` : les réglages tenus, qu'une molette ne reprend pas ;
// `env.ecoute()` : la tête d'écoute, si c'est elle qui gouverne).
function appliquer(graph, p, carte, instant) {
  const prev = graph._influence || new Map();
  const natifs = new Set();
  for (const [mod, ks] of prev) {
    for (const k of ks.keys()) {
      if (carte.get(mod)?.has(k)) continue;
      const n = graph.nodes.get(mod), m = p.modules.find((x) => x.id === mod);
      if (!n || !m) continue;
      graph.env.held?.delete(`${mod}:${k}`);
      if (n.setAt) n.setAt(k, val(m, k), instant); else natifs.add(mod);
    }
  }
  for (const [mod, ks] of carte) {
    const n = graph.nodes.get(mod), m = p.modules.find((x) => x.id === mod);
    if (!n || !m) continue;
    // un module natif relit sa copie à chaque tranche : un réglage tourné à la
    // main pendant que l'attracteur parle ne la lui retire pas
    if (!n.setAt) { natifs.add(mod); continue; }
    for (const [k, { v }] of ks) {
      const avant = prev.get(mod)?.get(k)?.v;
      if (avant !== undefined && Math.abs(avant - v) < 1e-9) continue;
      graph.env.held?.add(`${mod}:${k}`); n.setAt(k, v, instant);
    }
  }
  // un module natif (synthé, échantillonneur…) lit ses réglages à l'attaque
  // de chaque note : on lui passe une copie qui porte les opérateurs
  for (const mod of natifs) {
    const n = graph.nodes.get(mod), m = p.modules.find((x) => x.id === mod);
    if (!n || !m) continue;
    const ks = carte.get(mod);
    n.update(ks ? { ...m, params: { ...m.params, ...Object.fromEntries([...ks].map(([k, o]) => [k, o.v])) } } : m, p.bpm);
  }
  graph._influence = carte;
}

/** Appelée par Graph.automate pour chaque tranche planifiée [b0, b1). */
export function influer(graph, p, b0, b1, at) {
  if (!p.banc?.atts?.length && !graph._influence?.size) return;
  const eco = graph.env?.ecoute?.();
  if (typeof eco === 'number') { appliquer(graph, p, influenceA(p, eco), at(b0)); return; }
  appliquer(graph, p, influenceA(p, b0), at(b0));
  for (const b of bornes(p)) if (b > b0 && b < b1) appliquer(graph, p, influenceA(p, b), at(b));
}

/** À l'arrêt : chaque réglage reprend la sienne (Graph.settle). */
export function rendre(graph, p) {
  const prev = graph._influence;
  if (!prev?.size) return;
  for (const [mod, ks] of prev) {
    const n = graph.nodes.get(mod), m = p.modules.find((x) => x.id === mod);
    if (!n || !m) continue;
    for (const k of ks.keys()) graph.env.held?.delete(`${mod}:${k}`);
    n.update(m, p.bpm);
  }
  graph._influence = new Map();
}
