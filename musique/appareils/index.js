// ODIO — les appareils de la vue Instruments : ce que le rack dessine à la
// place d'une rangée de molettes, module par module (docs/etudes/odio_appareils.md).
//
// appareil(app, m, { accent }) → { el, frame(), peindre() } ou null (le
// module garde ses molettes : rack.js). `frame` est appelé à chaque image
// par le rack (le spectre, les mètres) ; `peindre` redessine la surface.

import { egaliseur, EST_EGALISEUR } from './egaliseur.js';
import { dynamique, EST_COMPRESSEUR } from './dynamique.js';
import { filtre } from './filtres.js';
import { saturation, EST_SATURATION } from './saturation.js';
import { espace, EST_ESPACE } from './espace.js';
import { instrument, A_INSTRUMENT } from './instruments.js';

// la feuille des appareils, posée une fois (comme nodal.css, jouets.css)
if (!document.querySelector('link[href$="appareils.css"]')) {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./appareils.css', import.meta.url).href;
  document.head.append(l);
}

export function appareil(app, m, opts = {}) {
  if (EST_EGALISEUR(m.type)) return egaliseur(app, m, opts);
  if (EST_COMPRESSEUR(m.type)) return dynamique(app, m, opts);
  if (m.type === 'filter' || m.type === 'filtre') return filtre(app, m, opts);
  if (EST_SATURATION(m.type)) return saturation(app, m, opts);
  if (EST_ESPACE(m.type)) return espace(app, m, opts);
  if (A_INSTRUMENT(m.type)) return instrument(app, m, opts);
  return null;
}
