// LES TUILES DU NODAL — ce que le canvas pose, lu dans le projet. Pur, sans DOM.
//
// Dans ODIO_01 (apps/studio/src/App.tsx, `BlockState`), un bloc est une boîte
// monde { x, y, w, h } avec son `group` (un ensemble qu'on range et qu'on
// déplace d'un bloc) et sa `machine` (le lien de circuit, qui ne se rompt
// jamais). Une machine posée est un GROUPE SOUDÉ de sections, une tuile par
// section. Ici, le son est porté par les modules du projet (le moteur, la
// console, le rack les lisent) : une tuile est donc
//   - un module ordinaire : sa boîte est la sienne (m.x, m.y, m.w, m.h) ;
//   - une section d'une machine : sa boîte vit dans le module qui porte le son
//     de la machine, m.mach.sec[section] ;
//   - un bloc sans son (le clavier maître, le séquenceur, le panneau des
//     interactions, le clavier simple) : il vit dans p.nodal.blocs, parce que
//     le serveur n'accepte dans p.modules que ce qui se branche au moteur
//     (server/tools/music.py, MODULE_TYPES).
// La taille de naissance d'un bloc est celle du CATALOGUE d'ODIO_01 (rack.ts,
// en cellules de 46 px monde) ; pour un module d'ici, celle de son équivalent.

import { MACHINES, MACHINE_ENGINES, WELDED_PREFIX, placesDeMachine, sectionParameters } from './blocks/machines.js';
import { sectionMaximale } from './blocks/assemblages.js';
import { MIN_TILE } from './tile/shape.js';

/** Côté d'une cellule de la grille, en pixels monde (rack.ts). */
export const CELL = 46;

// Les tailles de naissance, en cellules. ODIO_01 (rack.ts, CATALOGUE) :
// rythme 6×6, basse / pad / lead 3×4, acide 4×4, effets 4×4, volume 3×3,
// clavier 5×3, tempo 3×3, sortie 2×3 ; les jouets du Playground dans le même
// catalogue. Les modules d'ici prennent la taille de leur équivalent : la
// tranche de console, le retour de bus et la sortie celle de la SORTIE.
export const CELLS = {
  rythme: { w: 6, h: 6 }, drums: { w: 6, h: 6 }, acid: { w: 4, h: 4 },
  analog: { w: 3, h: 4 }, synth: { w: 3, h: 4 }, plaits: { w: 3, h: 4 }, sampler: { w: 3, h: 4 }, player: { w: 3, h: 3 },
  filtre: { w: 4, h: 4 }, eq3: { w: 4, h: 4 }, satura: { w: 4, h: 4 }, crush: { w: 4, h: 4 }, comp3: { w: 4, h: 4 },
  chorus: { w: 4, h: 4 }, rtt: { w: 4, h: 4 }, reverbe: { w: 4, h: 4 },
  delay: { w: 4, h: 4 }, reverb: { w: 4, h: 4 }, comp: { w: 4, h: 4 }, eq: { w: 4, h: 4 }, filter: { w: 4, h: 4 }, dist: { w: 4, h: 4 },
  volume: { w: 3, h: 3 }, table: { w: 3, h: 3 },
  strip: { w: 2, h: 3 }, bus: { w: 2, h: 3 }, master: { w: 2, h: 3 },
  clavier: { w: 5, h: 3 },
  // les jouets (musique/jouets/defs.js) : les cellules d'ODIO_01 pour les mêmes blocs
  fount: { w: 5, h: 5 }, reel: { w: 6, h: 4 }, alch: { w: 4, h: 5 }, pong: { w: 4, h: 5 }, sling: { w: 5, h: 5 },
  sprg: { w: 5, h: 4 }, mag: { w: 5, h: 4 }, ninja: { w: 5, h: 5 }, shake: { w: 5, h: 4 }, pach: { w: 5, h: 5 },
  toast: { w: 5, h: 5 }, pin: { w: 4, h: 6 }, inv: { w: 5, h: 5 }, newt: { w: 5, h: 4 }, horloge: { w: 3, h: 3 },
};

/** Les cellules d'un type : celles que son module déclare (`cells`), sinon la table. */
export function cellulesDe(type, MODULES) {
  return MODULES?.[type]?.cells || CELLS[type] || { w: 4, h: 4 };
}
/** La taille d'origine d'un module, en pixels monde — le double-clic sur l'en-tête y revient. */
export function tailleDOrigine(type, MODULES) {
  const c = cellulesDe(type, MODULES);
  return { w: c.w * CELL, h: c.h * CELL };
}

// ── les machines ─────────────────────────────────────────────
export const machineDef = (id) => MACHINES.find((m) => m.id === id) || null;
export const moteurDe = (id) => MACHINE_ENGINES[id] || null;

// La voix d'une machine (MACHINE_ENGINES.voice) → le module d'ici qui la porte :
// ce sont les mêmes classes (musique/odio/, reprises d'ODIO_01).
export const TYPE_DE_VOIX = { synth: 'analog', plaits: 'plaits', acide: 'acid', rythme: 'rythme', delay: 'rtt', reverb: 'reverbe', comp: 'comp3' };
// … et la sorte de piste qu'une voix d'instrument demande (modules.js, SOURCES_OF)
export const PISTE_DE_VOIX = { synth: 'synth', plaits: 'synth', acide: 'synth', rythme: 'drums' };

// Les descripteurs d'une section, à son compte MAXIMAL (rack.ts : une rangée
// étirée à trente-deux pas doit trouver des paramètres pour ses pas 16 à 31).
const DESC = new Map();
export function descripteursDe(sectionId) {
  let d = DESC.get(sectionId);
  if (!d) {
    const s = sectionTrouvee(sectionId);
    d = s ? sectionParameters(sectionMaximale(s)) : [];
    DESC.set(sectionId, d);
  }
  return d;
}
export function oublierDescripteurs(prefixe) { for (const k of [...DESC.keys()]) if (k.startsWith(prefixe)) DESC.delete(k); }
export function sectionTrouvee(sectionId) {
  for (const m of MACHINES) { const s = m.sections.find((x) => x.id === sectionId); if (s) return s; }
  return null;
}

/** La valeur d'un contrôle de machine, dans l'unité de son descripteur (0..100, un rang, 0/1). */
export function valeurControle(owner, sectionId, ctlId) {
  const v = owner?.mach?.ctl?.[ctlId];
  if (v !== undefined) return v;
  return descripteursDe(sectionId).find((d) => d.id === ctlId)?.default ?? 0;
}
export function valeursDeSection(owner, sectionId) {
  const out = {};
  for (const d of descripteursDe(sectionId)) out[d.id] = owner?.mach?.ctl?.[d.id] ?? d.default;
  return out;
}
export const normeDe = (d, v) => (d.max - d.min ? Math.min(1, Math.max(0, (v - d.min) / (d.max - d.min))) : 0);

/**
 * Un contrôle de machine prend une valeur ; s'il est branché au moteur
 * (MACHINE_ENGINES.map, rack.ts `pushMachineParam`), le réglage du module
 * qui porte le son suit. Rend le couple { param, valeur } écrit, ou null.
 */
export function poserControle(owner, sectionId, ctlId, value) {
  owner.mach.ctl = owner.mach.ctl || {};
  owner.mach.ctl[ctlId] = value;
  return pousserControle(owner, sectionId, ctlId, value);
}
export function pousserControle(owner, sectionId, ctlId, value) {
  const eng = moteurDe(owner.mach.id);
  const entry = eng?.map?.[ctlId];
  if (!entry || !owner.params) return null;
  const d = descripteursDe(sectionId).find((x) => x.id === ctlId);
  const n = d ? normeDe(d, value) : Math.min(1, Math.max(0, value));
  const v = entry.from(n);
  owner.params[entry.param] = Math.round(v * 1e6) / 1e6;
  return { param: entry.param, valeur: owner.params[entry.param] };
}
/** Tous les contrôles branchés d'une machine descendent au moteur (rack.ts, `#pushAll`). */
export function pousserTout(owner) {
  const def = machineDef(owner.mach.id);
  if (!def) return;
  for (const s of def.sections) for (const d of descripteursDe(s.id)) pousserControle(owner, s.id, d.id, valeurControle(owner, s.id, d.id));
}

/**
 * LA VOIX PROPRE DES PANNEAUX ODIO (rack.ts, VOIX_DES_PANNEAUX) : POLY-6, FM-6
 * et STRINGS-4 tournent sur le synthé soustractif du minilogue ; sans un
 * réglage de départ à eux, ils sonneraient pareil.
 */
export const VOIX_DES_PANNEAUX = {
  p6: { wave: 0, detune: 12, cutoff: 1800, resonance: 2, envAmount: 1200, attack: 0.02, decay: 0.35, sustain: 0.5, release: 0.4, gain: 0.4 },
  f6: { wave: 1, detune: 3, cutoff: 5000, resonance: 1, envAmount: 4000, attack: 0.003, decay: 0.25, sustain: 0.15, release: 0.3, gain: 0.35 },
  s4: { wave: 0, detune: 22, cutoff: 3600, resonance: 0.8, envAmount: 600, attack: 0.45, decay: 0.8, sustain: 0.85, release: 1.2, gain: 0.32 },
};

/**
 * LA PHRASE DE DÉPART D'UNE MACHINE (rack.ts, `phraseDeMachine`) : « une machine
 * qu'on pose doit s'entendre ». Les mêmes pas, écrits dans le format des motifs
 * d'ici (16 pas = une mesure de quatre temps, comme le STEPS_PER_BEAT = 4
 * d'ODIO_01).
 */
const rangee = (s) => [...s].map((c) => (c === 'x' ? 1 : 0));
export function phraseDeMachine(machineId) {
  const v = moteurDe(machineId)?.voice;
  if (v === 'rythme') {
    return { steps: 16, lanes: { bd: rangee('x...x...x...x...'), sd: rangee('....x.......x...'), ch: rangee('x.x.x.x.x.x.x.x.'), cp: rangee('............x...') } };
  }
  if (v === 'acide') {
    const ph = [[0, 33, false, true], [2, 33, true, false], [3, 45, false, false], [4, 33, false, true], [6, 36, true, false], [7, 33, false, false],
      [8, 33, false, true], [10, 40, true, false], [11, 33, false, false], [12, 45, false, true], [14, 43, true, false], [15, 36, false, false]];
    return { steps: 16, notes: ph.map(([s, p, sl, ac]) => ({ s, l: sl ? 2 : 1, p, v: ac ? 1 : 0.7, ...(sl ? { sl: true } : {}), ...(ac ? { ac: true } : {}) })) };
  }
  if (v !== 'synth' && v !== 'plaits') return null;
  if (machineId === 'mf') return { steps: 16, notes: [[2, 72], [5, 76], [7, 74], [10, 69], [13, 72]].map(([s, p]) => ({ s, l: 2, p, v: 0.6 })) };
  return { steps: 16, notes: [[0, 33], [3, 33], [6, 40], [8, 29], [11, 29], [14, 36]].map(([s, p]) => ({ s, l: 2, p, v: 0.8 })) };
}

// ── les tuiles ───────────────────────────────────────────────
export const idSection = (ownerId, sectionId) => `${ownerId}:${sectionId}`;
export const ensembleSoude = (ownerId) => `${WELDED_PREFIX}${ownerId}`;

/** Le porteur d'une tuile — un module ou un bloc du nodal — et sa section. */
export function porteurDeTuile(p, tuileId) {
  const [id, sec] = String(tuileId).split(':');
  const owner = p.modules.find((m) => m.id === id) || (p.nodal?.blocs || []).find((b) => b.id === id) || null;
  return { owner, sec: sec || null, id };
}

function tuilesDeMachine(owner, out, bloc) {
  const def = machineDef(owner.mach.id);
  if (!def) return false;
  const soude = ensembleSoude(owner.id);
  for (const s of def.sections) {
    const b = owner.mach.sec?.[s.id];
    if (!b) continue;
    out.push({ id: idSection(owner.id, s.id), mod: owner.id, bloc, sec: s.id, x: b.x, y: b.y, w: b.w, h: b.h,
      group: owner.mach.ouverte ? (owner.grp || null) : soude, machine: soude, type: s.id, teinte: owner.teinte || null });
  }
  return true;
}

/** Toutes les tuiles du projet, dans l'ordre du projet (l'ordre du dessin). */
export function tuilesDe(p, MODULES) {
  const out = [];
  for (const m of p.modules) {
    if (m.mach && tuilesDeMachine(m, out, false)) continue;
    const o = tailleDOrigine(m.type, MODULES);
    out.push({ id: m.id, mod: m.id, bloc: false, sec: null, x: m.x ?? 0, y: m.y ?? 0, w: m.w ?? o.w, h: m.h ?? o.h,
      group: m.grp || null, machine: null, type: m.type, teinte: m.teinte || null });
  }
  for (const b of p.nodal?.blocs || []) {
    if (b.mach && tuilesDeMachine(b, out, true)) continue;
    const o = tailleDOrigine(b.type, MODULES);
    out.push({ id: b.id, mod: b.id, bloc: true, sec: null, x: b.x ?? 0, y: b.y ?? 0, w: b.w ?? o.w, h: b.h ?? o.h,
      group: b.grp || null, machine: null, type: b.type, teinte: b.teinte || null });
  }
  return out;
}

const r2 = (v) => Math.round(v * 100) / 100;
/** La section qui porte les prises d'une machine (MACHINE_ENGINES.outSection), sinon la première. */
export function sectionPorteuse(owner) {
  const def = machineDef(owner?.mach?.id);
  if (!def) return null;
  const out = moteurDe(owner.mach.id)?.outSection;
  return owner.mach.sec?.[out] ? out : def.sections.find((s) => owner.mach.sec?.[s.id])?.id || null;
}
/**
 * Le coin d'une machine est celui de sa section porteuse : c'est là que le
 * reste du portail (les ports « notes » et « valeur » des jouets, les autres
 * vues) cherche le module qui porte son son.
 */
export function recalerPorteur(owner) {
  const s = sectionPorteuse(owner), b = s && owner.mach.sec[s];
  if (!b) return;
  owner.x = r2(b.x); owner.y = r2(b.y); owner.w = r2(b.w); owner.h = r2(b.h);
}
/** Écrit la boîte d'une tuile dans le projet ; le coin d'une machine suit sa section porteuse. */
export function ecrireBoite(p, tuileId, box) {
  const { owner, sec } = porteurDeTuile(p, tuileId);
  if (!owner) return;
  const b = { x: r2(box.x), y: r2(box.y), w: r2(Math.max(1, box.w)), h: r2(Math.max(1, box.h)) };
  if (sec && owner.mach) {
    owner.mach.sec[sec] = b;
    recalerPorteur(owner);
    return;
  }
  owner.x = b.x; owner.y = b.y; owner.w = b.w; owner.h = b.h;
}

/** Les places de naissance d'une machine posée au point `at` (placesDeMachine d'ODIO_01). */
export function sectionsPosees(def, at) {
  const sec = {};
  for (const pl of placesDeMachine(def)) sec[pl.id] = { x: r2(at.x + pl.x), y: r2(at.y + pl.y), w: r2(pl.w), h: r2(pl.h) };
  return sec;
}

export { MIN_TILE };
