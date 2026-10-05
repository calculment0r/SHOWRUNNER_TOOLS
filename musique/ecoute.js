// ODIO — écouter un préréglage avant de le choisir (06/10 ; le navigateur,
// rubrique Préréglages ; docs/etudes/odio_synthes.md).
//
// Le son est RENDU hors temps réel par `apercu` (moteur.js : la même source
// que la lecture et l'export, une phrase courte de la catégorie, dans la
// tonalité et au tempo de la session), puis joué tel quel. Rien n'est posé
// dans le graphe du projet : on peut écouter pendant que le morceau joue,
// rien ne passe par la console, rien n'entre dans l'export ni dans une prise
// (comme le métronome, l'écoute va droit aux haut-parleurs). Aucun travail
// par image : un rendu par préréglage, gardé (les 48 derniers), puis un
// AudioBufferSourceNode.
//
// Une écoute à la fois : la suivante coupe la précédente (20 ms de fondu).
// `document` reçoit « mu:ecoute » ({ id } du préréglage qui joue, ou null).

import { apercu } from './moteur.js';
import { phraseDe } from './prereglages.js';

const GARDE = 48;
const sons = new Map();   // clé → Promise<AudioBuffer>
let joue = null;          // { src, g, id }
let demande = null;       // la dernière écoute demandée (une plus ancienne qui finit son rendu se tait)

const annoncer = (id) => document.dispatchEvent(new CustomEvent('mu:ecoute', { detail: { id } }));
export const enEcoute = () => joue?.id || null;

// le son d'un préréglage pour ce projet (tempo, tonique) ; l'échantillonneur
// joue le son de la piste choisie (`item`)
export function sonDe(app, pr, { item = null } = {}) {
  const P = app.S.proj;
  const params = { ...(pr.params || {}), ...(item ? { item } : {}) };
  const bpm = Math.max(60, Math.min(180, P.bpm || 120)), tonique = P.key?.tonic ?? 0;
  const cle = JSON.stringify([pr.type, params, bpm, tonique]);
  if (!sons.has(cle)) {
    const { phrase, tr } = phraseDe(pr, tonique);
    const r = apercu(pr.type, params, phrase, { bpm, tr, buffers: app.engine.buffers });
    sons.set(cle, r);
    r.catch(() => sons.delete(cle));
    if (sons.size > GARDE) sons.delete(sons.keys().next().value);
  }
  return sons.get(cle);
}

export function taire() {
  const j = joue;
  joue = null;
  demande = null;
  if (!j) return;
  const t = j.src.context.currentTime;
  try { j.g.gain.setTargetAtTime(0, t, 0.006); j.src.stop(t + 0.04); } catch { /* déjà arrêtée */ }
  annoncer(null);
}

// `geste` : la demande vient d'un clic (le contexte audio peut démarrer) ;
// au survol, sans geste, on n'écoute que si le son du studio est déjà ouvert
// (la règle des navigateurs : un AudioContext démarre sur un geste).
export async function ecouter(app, pr, { geste = false, item = null } = {}) {
  taire();
  const jeton = {};
  demande = jeton;
  const eng = app.engine;
  if (!geste && eng.ctx?.state !== 'running') return false;
  let buf;
  try {
    [buf] = await Promise.all([sonDe(app, pr, { item }), geste ? eng.start() : null]);
  } catch (e) {
    console.warn(`écoute de « ${pr.name} » : ${e.message}`);
    return false;
  }
  if (demande !== jeton || !eng.ctx || eng.ctx.state !== 'running') return false;
  const ctx = eng.ctx;
  const src = new AudioBufferSourceNode(ctx, { buffer: buf });
  const g = new GainNode(ctx, { gain: 1 });
  src.connect(g).connect(ctx.destination);
  src.start();
  joue = { src, g, id: pr.id };
  src.addEventListener('ended', () => { if (joue?.src === src) { joue = null; annoncer(null); } });
  annoncer(pr.id);
  return true;
}
