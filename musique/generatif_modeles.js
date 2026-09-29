// ODIO — le schéma des paramètres génératifs, côté page.
//
// La seule vérité est musique/generatif_modeles.json : les modèles, leurs
// tâches, chaque paramètre (sorte, bornes, défaut, source), ce qui vient du
// projet, ce qu'un modèle n'a pas (et pourquoi), la partition de YuE2 et
// l'extraction MIDI. Le serveur (server/tools/music_gen.py, music_midi.py)
// valide contre le même fichier : le panneau ne peut pas offrir un réglage
// que le serveur refuserait. Ce module l'ouvre et en tire ce que dessine le
// panneau d'une région (generatif_region.js).

import { TONICS } from './modules.js';

let pending = null, S = null;
export async function loadSchema() {
  if (S) return S;
  if (!pending) pending = fetch(new URL('./generatif_modeles.json', import.meta.url)).then((r) => r.json()).then((j) => (S = j));
  return pending;
}
export const schemaNow = () => S;

export const model = (s, mid) => s?.modeles?.[mid] || null;
export const task = (s, mid, tid) => model(s, mid)?.taches?.[tid] || null;
export const firstTask = (s, mid) => Object.keys(model(s, mid)?.taches || {})[0];
export const trackFr = (s, id) => s?.pistes?.fr?.[id] || id;

// « instrumental=false », « mode!=off » : la condition d'un paramètre (la
// même lecture que music_gen._cond)
export function cond(expr, vals) {
  if (!expr) return true;
  const neg = expr.includes('!=');
  const [k, want] = expr.split(neg ? '!=' : '=');
  const got = String(vals[k]);
  return neg ? got !== want : got === want;
}
export const choiceIds = (pd) => (pd.choix || []).map((c) => (typeof c === 'object' ? c.id : c));
export const choiceLabel = (pd, id) => { const c = (pd.choix || []).find((x) => (typeof x === 'object' ? x.id : x) === id); return typeof c === 'object' ? c.label : String(c ?? id); };

// les valeurs de départ d'une tâche : les défauts du schéma
export function defaultsFor(s, mid, tid) {
  const M = model(s, mid), T = task(s, mid, tid), v = {};
  for (const pid of T?.params || []) {
    const pd = M.params[pid];
    if (pd.projet || pd.defaut === undefined) continue;
    v[pid] = Array.isArray(pd.defaut) ? [...pd.defaut] : pd.defaut;
  }
  return v;
}

// ce qu'on envoie : les réglages de la tâche, vus dans cet état, qui ne
// viennent pas du projet, sans les vides — le serveur refuse le reste
export function requestV(s, mid, tid, vals) {
  const M = model(s, mid), T = task(s, mid, tid), out = {};
  for (const pid of T?.params || []) {
    const pd = M.params[pid];
    if (pd.projet || !cond(pd.si, vals)) continue;
    const x = vals[pid];
    if (x === undefined || x === null || x === '' || (Array.isArray(x) && !x.length)) continue;
    out[pid] = x;
  }
  return out;
}

// ce qu'un modèle n'a pas : la raison que le schéma donne
export const unavailable = (s, mid, pid) => model(s, mid)?.indisponible?.[pid] || '';

// la tonalité d'ACE (majeur ou mineur par la tierce : modules.js, aceKey)
const MAJORISH = new Set(['major', 'lydian', 'mixolydian', 'pentamaj']);
export const aceKeyOf = (key) => `${TONICS[key?.tonic ?? 9]} ${MAJORISH.has(key?.mode || 'minor') ? 'major' : 'minor'}`;
export const isMajorish = (mode) => MAJORISH.has(mode);

// un nombre de secondes, lisible
export const secs = (x) => (x >= 60 ? `${Math.floor(x / 60)} min ${Math.round(x % 60)} s` : `${x.toFixed(x < 10 ? 1 : 0)} s`);
