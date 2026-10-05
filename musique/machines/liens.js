// LES LIAISONS DU NODAL — qui envoie quoi à qui. Pur, sauf `jouerNotes`.
//
// ODIO_01 (interaction/liaisons.ts) : trois réseaux coexistent sur le canvas —
// son, notes, tempo — et chaque bloc déclare ce qu'il ÉMET et ce qu'il
// ACCEPTE ; une liaison existe si l'un émet ce que l'autre accepte. Ici :
//   - le SON passe par les câbles du projet (p.cables), que le moteur joue et
//     que le serveur valide (music.py : un câble n'entre pas dans une source) ;
//   - les NOTES d'un jouet (et sa MODULATION) passent par les câbles typés des
//     jouets, p.cables { a, b, t: 'notes' | 'mod' } (jouets/index.js,
//     server/tools/music_jouets.py) ;
//   - les NOTES d'un bloc sans son (le clavier, le KBD-01, le SEQ-01) passent
//     par p.nodal.liens [{ a, b, sig: 'notes' }] : le serveur n'accepte dans
//     p.cables que des modules, et un bloc du nodal n'en est pas un.
// Les deux arrivent au MÊME port : le losange « notes » que les jouets posent
// sur tout ce qui se joue (jouets/index.js, `portsOf`) — un instrument, une
// machine, un jouet se relient donc de la même façon.

import { refuse } from './interaction/patch.js';
import { machineDef, moteurDe } from './tuiles.js';
import { MODULES, drumVoicesOf } from '../modules.js';

const SONS = ['drums', 'synth', 'sampler', 'rythme', 'analog', 'acid', 'plaits', 'macro'];

/**
 * Les prises d'un porteur (module ou bloc du nodal), dans le vocabulaire de
 * liaisons.ts : { emet, accepte }. `MODULES` : la table de modules.js.
 */
export function prisesDe(owner, MODULES) {
  if (!owner) return { emet: [], accepte: [] };
  const def = MODULES[owner.type];
  if (def?.ins || def?.outs) return { emet: [...(def.outs || [])], accepte: [...(def.ins || [])] };
  if (owner.mach) {
    const eng = moteurDe(owner.mach.id);
    if (eng?.voice === 'notes') return { emet: ['notes'], accepte: ['tempo'] };
    if (!eng?.voice && !def) return { emet: [], accepte: [] };
  }
  if (owner.type === 'clavier') return { emet: ['notes'], accepte: ['tempo'] };
  if (!def) return { emet: [], accepte: [] };
  switch (def.role) {
    case 'source':
      // un instrument se JOUE (des notes) et rend du son ; le lecteur de clips ne se joue pas
      return { emet: ['audio'], accepte: SONS.includes(owner.type) ? ['notes', 'tempo'] : [] };
    case 'effect': return { emet: ['audio'], accepte: ['audio', 'tempo'] };
    case 'strip': case 'bus': return { emet: ['audio'], accepte: ['audio'] };
    case 'master': return { emet: [], accepte: ['audio'] };
    default: return { emet: [], accepte: [] };
  }
}

/** Le signal qu'une liaison porterait (liaisons.ts, `signalDe`), la modulation en dernier. */
export function signalDe(source, cible) {
  for (const g of ['audio', 'notes', 'tempo', 'mod']) if (source.emet.includes(g) && cible.accepte.includes(g)) return g;
  return null;
}

export const liensDe = (p) => (p.nodal?.liens || []);
/** Toutes les liaisons, au format de patch.ts ({ from, to }) — pour juger une boucle. */
export function toutesLesLiaisons(p) {
  return [...p.cables.map((c) => ({ from: c.a, to: c.b })), ...liensDe(p).map((l) => ({ from: l.a, to: l.b }))];
}

/** Le verdict d'une liaison (liaisons.ts, `refusDeLiaison`) : null si elle passe. */
export function verdict(p, MODULES, a, b, porteur) {
  const A = porteur(a), B = porteur(b);
  const g = refuse(toutesLesLiaisons(p), a, b);
  if (g) return g;
  if (!A || !B) return 'signal';
  const s = signalDe(prisesDe(A, MODULES), prisesDe(B, MODULES));
  if (!s) return 'signal';
  // les deux bouts du son doivent exister au moteur (un bloc du nodal n'a pas de son)
  if (s === 'audio' && (!p.modules.includes(A) || !p.modules.includes(B))) return 'signal';
  return null;
}

/** Les cibles de notes d'un porteur. */
export const ciblesNotes = (p, id) => liensDe(p).filter((l) => l.a === id && l.sig === 'notes').map((l) => l.b);

/**
 * Jouer une note depuis un porteur (un clavier, une touche du KBD-01, un
 * jouet) vers tout ce qu'il alimente en notes — rack.ts `strike` : « c'est le
 * câblage qui décide de la destination ». Le moteur d'ici sait relâcher
 * (noteOff) : la note tient `dur` secondes.
 */
export async function jouerNotes(app, id, note, vel = 0.8, dur = 0.4) {
  const p = app.S.proj;
  const faits = [];
  let n = 0;
  for (const cible of ciblesNotes(p, id)) {
    const m = app.mod(cible);
    if (!m) continue;
    // un jouet qui reçoit des notes : sa scène les prend (jouets/index.js, `trigger`)
    const j = app.toys?.inst?.get(m.id);
    if (j) { await app.engine.start().catch(() => {}); j.sc?.trigger?.call(j, { p: note, v: vel, at: app.engine.ctx?.currentTime ?? 0 }); n++; continue; }
    // une batterie : la voix de cette note (la TR-8S : 36 à 46), sinon celle de ce rang
    const voix = drumVoicesOf(m.type);
    if (MODULES[m.type]?.drum || m.type === 'drums') {
      const v = voix.find((x) => x.note === note) || voix[((note % voix.length) + voix.length) % voix.length];
      if (v) { await app.engine.hit(m.id, v.id, vel); n++; }
      continue;
    }
    const h = await app.engine.noteOn(m.id, note, vel);
    if (h) { faits.push(h); n++; }
  }
  if (faits.length) setTimeout(() => { for (const h of faits) app.engine.noteOff(h); }, Math.max(60, dur * 1000));
  return n;
}

/** Les machines qui n'ont pas de son : leurs sections vivent dans p.nodal.blocs. */
export const sansSon = (machineId) => { const v = moteurDe(machineId)?.voice; return !v || v === 'notes'; };
export { machineDef };
