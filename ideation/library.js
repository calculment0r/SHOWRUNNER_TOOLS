// IDÉATION — la bibliothèque : le panneau Asset commun (commun/dock.js).
//
// Décision de Cal (30/09) : « la bibliothèque d'Idéation devient le panneau
// commun ». Le panneau, sa poignée, son trait au bord, ses préférences (ouvert,
// largeur : Préférences → Général) et le raccourci (Ctrl+Espace) sont ceux de
// tous les outils ; Idéation ne lui dit que ses gestes, qui restent ceux d'avant :
//   - un clic pose au centre de la vue (décision 4 : les gestes de clic restent) ;
//     glisser pose là où l'on lâche, sur la planche ou dans une carte (le
//     glisser-déposer du socle, ITEM_MIME ; plusieurs : MULTI_MIME) ;
//   - un personnage de Character Factory devient un élément au moment où on le
//     pose (cfElement, ci-dessous ; la planche importe aussi au dépôt, CF_MIME) ;
//   - « Déposer » range les fichiers et les pose sur la planche (app.uploadAndPlace) ;
//   - le clic droit ajoute « En référence de la carte choisie » ;
//   - les filtres suivent la carte choisie (ports.js, inPorts : ce qu'elle reçoit) —
//     une carte Générer image : images, éléments ; Générer vidéo i2v : images ;
//     r2v : images, éléments, vidéos, sons ; un composeur ne prend que du texte ;
//   - le bouton #b-lib de la barre de gauche et « Depuis la bibliothèque » (le menu
//     du fond, fermé seulement) l'ouvrent, la recherche prête ; l'invité ne l'a pas
//     (le panneau ne se monte pas pour lui : commun/dock.js).

import { toast, dock, CF_MIME } from '../commun/shell.js';
import { inPorts } from './ports.js';

export { CF_MIME };

// la planche garde toujours de quoi travailler : 360 px, l'inspecteur, les marges de .ide
const CV_MIN = 360;

export function createLibrary(app) {
  const { S } = app;
  const btn = document.getElementById('b-lib');
  const center = () => app.canvas.center();
  dock.configure({
    clickPlaces: true,
    defaultOpen: true,   // qu'on voie qu'il existe (Cal, 29/09)
    label: 'la planche',
    placeLabel: 'Poser au centre de la vue',
    hint: 'glisser sur la planche ou dans une carte · clic : au centre',
    dockMin: () => CV_MIN + (document.getElementById('insp')?.getBoundingClientRect().width || 300) + 48,
    place: (items) => {
      if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return false; }
      if (items.length === 1) app.placeItem(items[0], ...center(), { free: true });
      else app.placeMany(items, ...center(), { free: true });
      return true;
    },
    menu: (it, chosen) => {
      const sel1 = S.sel.size === 1 ? app.node([...S.sel][0]) : null;
      const refs = chosen.filter((x) => ['image', 'element'].includes(x.kind) && !x._cf);
      return [sel1?.type === 'gen' && refs.length ? { label: 'En référence de la carte choisie', dot: 'or', onclick: () => app.addRefs(sel1.id, refs) } : null];
    },
    upload: (files) => app.uploadAndPlace(files),
  });
  btn?.addEventListener('click', () => dock.toggle({ focus: true }));
  document.addEventListener('sr:dock', (e) => {
    btn?.classList.toggle('on', !!e.detail.open);
    setTimeout(() => app.canvas?.paintMini(), 250);
  });

  // les filtres du panneau suivent la carte choisie (panneau_asset.md § 4.2)
  const LABEL = { gen: 'carte Générer image', vgen: 'carte Générer vidéo', compose: 'composeur' };
  function follow() {
    const n = S.sel.size === 1 ? app.node([...S.sel][0]) : null;
    if (!n || !LABEL[n.type]) { dock.contexte(null); return; }
    const kinds = [...new Set(inPorts(n, app.caps()).flatMap((p) => p.accepts))].filter((k) => k !== 'text');
    const label = n.type === 'vgen' && n.mode ? `${LABEL.vgen} · ${n.mode}` : LABEL[n.type];
    dock.contexte({ kinds, label, why: kinds.length ? '' : 'cette carte ne prend que du texte' });
  }

  return {
    reload: () => dock.reload(),
    // l'ouvrir, la recherche prête (le menu du fond : « Depuis la bibliothèque »)
    open: () => dock.open({ focus: true }),
    close: () => dock.close(),
    isOpen: () => dock.isOpen(),
    // fermé, et monté (l'invité ne l'a pas) : le menu du fond le propose
    closed: () => dock.closed(),
    // après les modules (app.on : plugins.js) : la sélection et chaque geste relisent la carte choisie
    follow: () => { for (const ev of ['selection', 'commit', 'board']) app.on?.(ev, follow); follow(); },
  };
}

// un personnage de Character Factory → l'élément (le plus récent s'il est déjà importé)
export async function cfElement(api2, { slug, imported }) {
  if (imported) {
    try { return await api2('library/' + imported); } catch { /* retiré : on réimporte */ }
  }
  toast('import depuis Character Factory…', 20000);
  const it = await api2('cf/import', { method: 'POST', body: { slug } });
  toast(`${it.title} est maintenant un élément de la bibliothèque`);
  return it;
}
