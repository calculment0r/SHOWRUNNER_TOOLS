// ODIO — le panneau Asset commun (commun/dock.js, docs/etudes/panneau_asset.md).
//
// La bibliothèque du portail, à gauche de la barre d'ODIO (Ctrl+Espace) : ODIO lui
// dit ses gestes, qui restent ceux de son navigateur (Cal, 30/09 : « les clics
// d'aujourd'hui restent ») :
//   - un clic pose, comme un son ou un clip MIDI du navigateur : sur la piste
//     choisie, à la tête de lecture (un son sur un échantillonneur : il le joue) ;
//     glisser pose là où l'on lâche (l'arrangement : timeline.js, onDrop) ;
//   - les sortes d'ODIO : les sons et la bibliothèque MIDI (sorte « midi ») — les
//     zones inscrites le disent (l'arrangement, l'échantillonneur, la référence
//     du génératif) ; un élément versionné compte pour sa dernière version (une
//     chanson publiée est un son) et c'est elle qui se pose ;
//   - la zone active : l'en-tête d'une piste choisi (panneau_asset.md § 4.2) — une
//     piste audio : les sons ; batterie, synthé : le MIDI ; un échantillonneur : les
//     sons (son échantillon) et le MIDI ; rien de choisi : les filtres d'ODIO ;
//   - le clic droit ajoute « Sur des pistes neuves » (comme le navigateur).

import { api, toast, dock, kindFr, sorteEffective } from '../commun/shell.js';
import { TRACK_KINDS } from './modules.js';
import { placeMidi } from './generatif_midi.js';

// la place que la page garde toujours : le navigateur, les en-têtes de piste, un peu d'arrangement
const GARDE = 900;

// un élément versionné (une chanson d'ODIO, un MIDI rangé comme élément) : sa dernière version
async function tete(it) {
  if (it?.kind !== 'element') return it;
  const k = sorteEffective(it);
  if ((k === 'audio' || k === 'midi') && it.element?.head_item) {
    try { return await api('library/' + it.element.head_item); } catch { /* la dernière version n'est plus là */ }
  }
  return it;
}

// Des objets de la bibliothèque sur l'arrangement (le panneau, le glisser sur une piste) :
// les sons à la suite (un seul sur un échantillonneur : son échantillon), les clips MIDI à la
// suite sur la piste d'instrument (ailleurs : une piste neuve par canal). Rend le nombre posé.
export async function poserObjets(app, list, trackId, at) {
  const got = (await Promise.all(list.map(tete))).filter(Boolean);
  const sons = got.filter((it) => it.kind === 'audio');
  const mids = got.filter((it) => it.kind === 'midi');
  const refus = got.filter((it) => it.kind !== 'audio' && it.kind !== 'midi');
  if (refus.length) {
    const it = refus[0];
    toast(`ODIO prend des sons et des clips MIDI ; « ${it.title || it.id} » : ${kindFr(it.kind)}${refus.length > 1 ? ` (et ${refus.length - 1} autre${refus.length > 2 ? 's' : ''})` : ''}`, 5000);
  }
  if (sons.length === 1) await app.dropItem({ t: 'son', item: sons[0] }, trackId, at);
  else if (sons.length) {
    const t = trackId && app.track(trackId);
    await app.placeItems(sons, { track: t?.kind === 'audio' ? t.id : null, at });
  }
  let pos = at;
  for (const m of mids) {
    const made = await placeMidi(app, m.id, trackId, pos);
    if (made?.length) pos = Math.max(...made.map((c) => c.start + (c.len || 0)));
  }
  const n = sons.length + mids.length;
  if (n) dock.recent([...sons, ...mids]);
  return n;
}

export function branchePanneau(app) {
  const { S } = app;
  // à la tête de lecture, comme le navigateur (le MIDI : au début de la mesure)
  const ici = (it) => (it.kind === 'midi' ? Math.floor(app.pos() / S.proj.sig) * S.proj.sig : app.pos());
  dock.configure({
    clickPlaces: true,
    placeLabel: 'Poser sur la piste choisie',
    hint: 'glisser sur une piste · clic : sur la piste choisie, à la tête de lecture',
    dockMin: GARDE,
    place: async (items) => {
      if (!S.proj) return false;
      const n = await poserObjets(app, items, S.sel.track, ici(items[0]));
      return n > 0;
    },
    menu: (it, chosen) => {
      const mids = chosen.filter((x) => x.kind === 'midi');
      return [mids.length ? { label: 'Sur des pistes neuves', sub: 'une par canal', onclick: () => poserObjets(app, mids, null, ici(mids[0])) } : null];
    },
  });

  // la zone active : l'en-tête d'une piste choisi (pas la piste courante d'un simple clic dans sa voie)
  let vu = '';
  return function suivre() {
    const t = S.proj && app.track(S.sel.track);
    const choisie = t && (S.sel.tracks || []).length === 1 && S.sel.tracks[0] === t.id ? t : null;
    const cle = choisie ? `${choisie.id}|${choisie.kind}|${choisie.name}` : '';
    if (cle === vu) return;
    vu = cle;
    if (!choisie || !TRACK_KINDS[choisie.kind] || choisie.kind === 'bus') { dock.contexte(null); return; }
    const kinds = choisie.kind === 'audio' ? ['audio'] : choisie.kind === 'sampler' ? ['audio', 'midi'] : ['midi'];
    dock.contexte({ kinds, label: `piste ${choisie.name}` });
  };
}
