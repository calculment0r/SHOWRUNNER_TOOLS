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
// tranche planifiée, `rendre` à l'arrêt). Trois choix, dits :
//   - un réglage capté par deux anneaux (question ouverte n° 8) joue
//     l'opérateur de plus grand poids ;
//   - un réglage qu'une voie d'automation ou un câble de valeur (jouets)
//     tient le garde : l'attracteur ne reprend pas ce que le musicien a
//     dessiné ou branché ;
//   - un réglage à pas (une octave, un nombre de copies) joue l'opérateur
//     arrondi à son pas : il ne prend que les valeurs qu'il a.
//
// CE QUI EST CAPTÉ (09/10, par construction) : la facette est une propriété
// déclarée de chaque réglage, dans la définition de son module (sa sorte,
// musique/facettes.js) ; un réglage discret est hors attracteurs d'office.
// Un contrôle de machine prend la facette que lui donne la table d'ODIO_01,
// sinon celle du réglage du module auquel il est branché (MACHINE_ENGINES.map)
// — une seule vérité, et une machine de PLANO n'a rien à déclarer.
// CE QUI EST ENTENDU : tout réglage capté, par le moyen de son module
// (`appliquer`, plus bas) — setParameter à l'instant pour un module d'ODIO
// (AudioWorklet de Plaits et de Macro compris) ou un jouet qu'on traverse ;
// la copie entendue, posée à l'instant, pour un module natif (AudioParam ou
// lecture à l'attaque de la note) ; l'arpège et les scènes des jouets la
// lisent aussi (Graph.entendu). Seul un contrôle de machine que rien ne
// branche au moteur est capté sans s'entendre : le banc le dit.
//
// Pur, sans DOM : la même fonction sert le banc (les chiffres), le moteur (le
// son), l'export hors temps réel, et le génératif (`attracteursActifs`).

import { MODULES, spec, val, moduleName } from '../modules.js';
import { HORS_DISCRET } from '../facettes.js';
import { FACETTES as FACETTES_MACHINES, ecartBoite, poids } from './banc/logique.js';
import { tuilesDe, porteurDeTuile, machineDef, moteurDe, descripteursDe, valeurControle, normeDe } from './tuiles.js';

export { FACETTES_MACHINES, ecartBoite, poids };

// CE QUE CHAQUE RÉGLAGE DES MODULES D'ICI A « DE RYTHMIQUE, D'HARMONIQUE, DE
// TIMBRAL » (n° 54, 66) — LU dans leurs déclarations (modules.js, `sortes`),
// plus écrit ici : la table du 29/09 en gardait vingt-neuf et oubliait tout
// module neuf. Gardée sous ce nom pour qui la lisait (banc.js, le génératif).
export const FACETTES_MODULES = Object.fromEntries(Object.entries(MODULES)
  .flatMap(([type, def]) => def.params.filter((s) => s.facette).map((s) => [`${type}.${s.k}`, s.facette])));

/**
 * CE QU'UN CONTRÔLE DE MACHINE A DE CHAQUE THÈME. La table d'ODIO_01
 * (FACETTES) décide d'abord : c'est celle de l'auteur. Sinon un contrôle
 * BRANCHÉ (MACHINE_ENGINES.map) prend la facette du réglage qu'il règle sur
 * le module qui porte le son. Un contrôle discret (sélecteur, bouton) est hors
 * attracteurs, comme un réglage discret. Rend { facette, hors, branche, source } :
 * `branche` est l'entrée de la table de branchement quand le moteur
 * l'entend (un réglage continu du module), sinon null.
 */
export function positionDeControle(machId, typeDuSon, d) {
  const entry = moteurDe(machId)?.map?.[d.id] || null;
  const cible = entry && MODULES[typeDuSon] ? spec(typeDuSon, entry.param) : null;
  const entendu = cible && !cible.opts ? entry : null;
  if (d.curve === 'choice') return { facette: null, hors: HORS_DISCRET, branche: null, source: null };
  const odio = FACETTES_MACHINES[d.id];
  if (odio) return { facette: odio, hors: null, branche: entendu, source: 'ODIO_01' };
  if (!cible) return { facette: null, hors: entry ? 'branché à un réglage que le module n\'a pas' : 'branché à rien : le moteur ne l\'entend pas', branche: null, source: null };
  return { facette: cible.facette || null, hors: cible.facette ? null : cible.hors, branche: entendu, source: `${typeDuSon}.${entry.param}` };
}

/**
 * Les blocs qui déclarent un thème, avec leur boîte monde et leurs réglages
 * lus. Une section de machine est un bloc (ODIO_01 : un bloc par section) ;
 * un module ordinaire est un bloc. `branche` : le moteur entend ce réglage
 * (faux pour un contrôle de machine que rien ne branche).
 */
export function blocsDInfluence(p, tuiles = tuilesDe(p, MODULES)) {
  const out = [];
  for (const t of tuiles) {
    const { owner, sec } = porteurDeTuile(p, t.id);
    if (!owner) continue;
    const parametres = [];
    if (sec && owner.mach) {
      const def = machineDef(owner.mach.id);
      const sonne = !t.bloc && p.modules.includes(owner);   // un bloc sans son (clavier, séquenceur) : rien ne s'entend
      for (const d of descripteursDe(sec)) {
        const pos = positionDeControle(owner.mach.id, owner.type, d);
        if (!pos.facette) continue;
        parametres.push({ facette: pos.facette, label: d.label || d.id, def: d.default, valeur: valeurControle(owner, sec, d.id), unit: d.unit || '',
          min: d.min, max: d.max, ctl: d.id, sec, branche: sonne && !!pos.branche, source: pos.source });
      }
      if (!parametres.length) continue;
      const section = def?.sections.find((s) => s.id === sec);
      out.push({ id: t.id, mod: owner.id, bloc: t.bloc, nom: `${(def?.name || '').split(' ')[0]} · ${section?.name || sec}`,
        boite: { x: t.x, y: t.y, w: t.w, h: t.h }, facettes: new Set(parametres.map((x) => x.facette)), parametres });
      continue;
    }
    if (t.bloc || owner.mach) continue;
    for (const s of MODULES[owner.type]?.params || []) {
      if (!s.facette) continue;
      parametres.push({ facette: s.facette, label: s.label, def: s.def, valeur: val(owner, s.k), unit: s.unit || '', min: s.min, max: s.max, cle: s.k,
        sorte: s.sorte, branche: true });
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
          op: q.def + (q.valeur - q.def) * w, unite: q.unit, ctl: q.ctl, sec: q.sec, cle: q.cle, min: q.min, max: q.max, branche: q.branche });
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
 * CE QUE CAPTE UN ATTRACTEUR, qu'il parle ou non — pour le voir (le nodal au
 * survol, le banc) : bloc → { nom, w (le plus grand poids), reglages [{ label,
 * facette, w, valeur, op, unite, entendu, tenu }] }. `tenu` : une voie
 * d'automation ou un câble de valeur garde ce réglage ; `entendu` : le moteur
 * le jouera quand l'attracteur parlera.
 */
export function capteParAttracteur(p, atr, blocs = blocsDInfluence(p)) {
  const tenus = reglagesTenus(p), out = new Map();
  for (const o of operateurs(atr, blocs)) {
    let b = out.get(o.blocId);
    if (!b) { b = { nom: o.blocNom, mod: o.mod, w: 0, reglages: [] }; out.set(o.blocId, b); }
    b.w = Math.max(b.w, o.w);
    const owner = p.modules.find((m) => m.id === o.mod);
    const k = o.cle || (o.ctl && owner?.mach ? moteurDe(owner.mach.id)?.map?.[o.ctl]?.param : null);
    b.reglages.push({ label: o.label, facette: o.facette, couleur: o.couleur, w: o.w, valeur: o.valeur, op: o.op, unite: o.unite,
      entendu: !!o.branche && !!owner, tenu: !!k && tenus.has(`${o.mod}:${k}`) });
  }
  return out;
}
/** Les attracteurs qui captent un bloc (une tuile) : [{ atr, parle, reglages }] — le panneau du nodal. */
export function attracteursDe(p, blocId, t = null, blocs = blocsDInfluence(p)) {
  const out = [];
  for (const atr of p.banc?.atts || []) {
    const b = capteParAttracteur(p, atr, blocs).get(blocId);
    if (!b) continue;
    const seg = (p.banc.segs || []).find((s) => s.id === atr.segment);
    out.push({ atr, w: b.w, parle: t !== null && !!seg && actif(seg, t), reglages: b.reglages });
  }
  return out.sort((a, b) => b.w - a.w);
}

// les réglages que le musicien tient : une voie d'automation, un câble de valeur (jouets) — « module:réglage »
function reglagesTenus(p) {
  return new Set([
    ...(p.auto || []).filter((L) => L.on !== false && L.pts?.length).map((L) => `${L.mod}:${L.k}`),
    ...(p.cables || []).filter((c) => c.t === 'mod' && c.k).map((c) => `${c.b}:${c.k}`),
  ]);
}
// un réglage prend l'opérateur dans ses bornes, à son pas
function borne(s, v) {
  const x = Math.min(s.max, Math.max(s.min, v));
  return s.step ? Math.round(x / s.step) * s.step : x;
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
  const tenus = reglagesTenus(p);
  const poser = (mod, k, v, w) => {
    if (tenus.has(`${mod}:${k}`)) return;
    let m = carte.get(mod);
    if (!m) { m = new Map(); carte.set(mod, m); }
    const cur = m.get(k);
    if (!cur || w > cur.w) m.set(k, { v, w });
  };
  for (const a of actifs) {
    for (const o of a.operateurs) {
      const owner = p.modules.find((m) => m.id === o.mod);
      if (!owner || !o.branche) continue;         // un bloc sans son (clavier, séquenceur), un contrôle branché à rien
      if (o.ctl && owner.mach) {
        const entry = moteurDe(owner.mach.id)?.map?.[o.ctl];
        const s = entry && spec(owner.type, entry.param);
        if (s) poser(owner.id, entry.param, borne(s, entry.from(normeDe({ min: o.min, max: o.max }, o.op))), o.w);
      } else if (o.cle) {
        const s = spec(owner.type, o.cle);
        if (s && !s.opts) poser(owner.id, o.cle, borne(s, o.op), o.w);
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
// `env.ecoute()` : la tête d'écoute, si c'est elle qui gouverne), ce qu'il
// entend (`_influence`, lu par Graph.entendu : l'arpège, les scènes des
// jouets, une molette tournée pendant que l'attracteur parle) et l'instant
// où poser une copie (Graph.aLInstant : les AudioParam d'un module natif).
const empreinte = (ks) => (ks ? JSON.stringify([...ks].map(([k, o]) => [k, o.v])) : '');
function appliquer(graph, p, carte, instant) {
  const prev = graph._influence || new Map();
  graph._influence = carte;
  for (const mod of new Set([...prev.keys(), ...carte.keys()])) {
    const n = graph.nodes.get(mod), m = p.modules.find((x) => x.id === mod);
    if (!n || !m) continue;
    const avant = prev.get(mod), apres = carte.get(mod);
    if (n.setAt) {
      // un module d'ODIO, un jouet qu'on traverse : réglage par réglage, à l'instant dit
      for (const k of avant?.keys() || []) {
        if (apres?.has(k)) continue;
        graph.env.held?.delete(`${mod}:${k}`); n.setAt(k, val(m, k), instant);
      }
      for (const [k, { v }] of apres || []) {
        const v0 = avant?.get(k)?.v;
        if (v0 !== undefined && Math.abs(v0 - v) < 1e-9) continue;
        graph.env.held?.add(`${mod}:${k}`); n.setAt(k, v, instant);
      }
    } else if (empreinte(avant) !== empreinte(apres)) {
      // un module natif (synthé, échantillonneur, effet d'ici) lit ses réglages
      // dans sa copie, à l'attaque d'une note ou en posant ses AudioParam : on
      // lui passe la copie entendue, posée à l'instant
      const poserCopie = () => n.update(graph.entendu ? graph.entendu(m) : m, p.bpm);
      if (graph.aLInstant) graph.aLInstant(instant, poserCopie); else poserCopie();
    }
  }
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
  graph._influence = new Map();
  for (const [mod, ks] of prev) {
    const n = graph.nodes.get(mod), m = p.modules.find((x) => x.id === mod);
    if (!n || !m) continue;
    for (const k of ks.keys()) graph.env.held?.delete(`${mod}:${k}`);
    n.update(m, p.bpm);
  }
}
