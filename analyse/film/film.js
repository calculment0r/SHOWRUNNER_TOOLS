// MOVIE ANALYSIS — la page d'un film dans le portail (écrite par analyse/chaine/studio.mjs, sous
// analyse/analyses/<film>/ ou analyse/runs/<nom>/) : l'en-tête commun du portail, la barre du film collée
// dessous, l'icône. Le Studio lui-même (vidéo, script, timeline, casting, dépouillement) est le script de la
// page : ce module ne fait que le cadre, commun à tous les films.
import { mountHeader, $ } from '../../commun/shell.js';

const hdr = mountHeader('analyse');

// la barre du film colle sous l'en-tête du portail, dont la hauteur change (il passe sur deux lignes quand la
// fenêtre rétrécit)
const pose = () => document.documentElement.style.setProperty('--hdr-h', hdr.offsetHeight + 'px');
pose();
if (window.ResizeObserver) new ResizeObserver(pose).observe(hdr);

// l'icône, dessinée depuis les jetons (aucune couleur écrite ici), comme l'accueil de l'outil
try {
  const cs = getComputedStyle(document.documentElement);
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = cs.getPropertyValue('--or').trim(); g.beginPath(); g.roundRect(0, 0, 32, 32, 6); g.fill();
  g.fillStyle = cs.getPropertyValue('--on-or').trim(); g.fillRect(12, 12, 8, 8);
  const l = $('link[rel=icon]'); if (l) l.href = c.toDataURL();
} catch { /* sans canvas : pas d'icône */ }
