// SHOWRUNNER TOOLS — l'onde d'un son, DESSINÉE à la résolution de l'écran.
//
// Cal, 01/10 : dans le Montage, l'onde « on dirait une image en basse définition ».
// La cause : une image fixe (ffmpeg showwavespic, 2400 × 96) étirée sur toute la
// longueur du plan. Ici, la page reçoit les PICS du son (server/tools/apercu_son.py,
// `GET /api/son/pics/<id>` : le pic de chaque 1/200 s, normalisé sur le plus fort)
// une fois par son, et dessine dans un <canvas> la seule partie demandée, à la taille
// de l'écran (devicePixelRatio compris) : nette à tout zoom, légère à tout défilement.
//
//   const P = await pics(id, { voix })             les pics (mis en cache par son)
//   dessiner(canvas, P, { t0, t1 })                 l'onde de t0 à t1 (s), symétrique, pleine largeur du canvas
//
// La couleur est celle du canvas en CSS (`color: var(--grn2)` dans la feuille de
// l'outil) : un jeton, les deux thèmes ; aucune couleur ici.

import { api } from './shell.js';

const PICS_V = 1;   // apercu_son.py, VERSION
const cache = new Map();

export function pics(id, { voix = null } = {}) {
  const k = `${id}|${voix ?? ''}`;
  if (!cache.has(k)) {
    const q = `son/pics/${id}?v=${PICS_V}${voix != null ? `&voix=${voix}` : ''}`;
    cache.set(k, api(q).then((r) => {
      const bin = atob(r.b64 || '');
      const a = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      return { bps: r.bps || 200, a };
    }).catch((e) => { cache.delete(k); throw e; }));
  }
  return cache.get(k);
}

// dessine l'onde de t0 à t1 secondes sur toute la largeur du canvas (taille CSS lue ici)
export function dessiner(cv, P, { t0 = 0, t1 = null } = {}) {
  if (!cv || !P) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cv.clientWidth * dpr));
  const h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w) cv.width = w;
  if (cv.height !== h) cv.height = h;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  const { bps, a } = P;
  const fin = t1 ?? a.length / bps;
  if (!(fin > t0) || !a.length) return;
  g.fillStyle = getComputedStyle(cv).color;
  const mid = h / 2;
  const parPx = ((fin - t0) * bps) / w;   // pics par pixel d'écran
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor((t0 * bps) + x * parPx);
    const i1 = Math.max(i0 + 1, Math.floor((t0 * bps) + (x + 1) * parPx));
    if (i1 <= 0 || i0 >= a.length) continue;
    let m = 0;
    for (let i = Math.max(0, i0); i < Math.min(a.length, i1); i++) if (a[i] > m) m = a[i];
    // un pic plus fin qu'un pixel : interpolé entre ses voisins, pour un trait continu au zoom fort
    if (parPx < 1) {
      const f = (t0 * bps) + x * parPx;
      const j = Math.max(0, Math.min(a.length - 1, Math.floor(f)));
      const k2 = Math.min(a.length - 1, j + 1);
      m = a[j] + (a[k2] - a[j]) * (f - j);
    }
    const y = Math.max(dpr * 0.5, (m / 255) * mid);
    g.fillRect(x, mid - y, 1, y * 2);
  }
}
