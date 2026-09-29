// MOVIE ANALYSIS — la page d'un film dans le portail (écrite par analyse/chaine/studio.mjs, sous
// analyse/analyses/<film>/ ou analyse/runs/<nom>/) : l'en-tête commun du portail, la barre du film collée
// dessous, l'icône, et la grammaire commune — le menu « ⋯ » de la barre et le menu d'une réplique (clic, clic
// droit) passent par commun/menu.js. Le Studio lui-même (vidéo, script, timeline, casting, dépouillement) est le
// script de la page : ce module ne fait que le cadre, commun à tous les films.
import { mountHeader, $, href } from '../../commun/shell.js';
import { menu, kebab, contextMenu, closeMenus } from '../../commun/menu.js';
import { copyText } from '../../commun/fil.js';

// le script de la page (voix.js) prend le menu commun quand il est là
window.SR_MENU = { menu, kebab, contextMenu, closeMenus };

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

// ── le menu « ⋯ » de la barre du film : la fiche du projet, les vues, les exports, le lien ──
const place = $('#fm-plus');
if (place) {
  const film = place.dataset.film || '';
  const vue = (v) => () => { const b = document.querySelector(`#tabs [data-tab="${v}"]`); if (b) b.click(); };
  const clic = (sel) => () => { const b = $(sel); if (b) b.click(); };
  const voix = $('.fm-voix');
  const items = () => [
    { head: 'Le projet' },
    { label: 'La fiche du projet', icon: '▦', sub: 'projets', onclick: () => { location.href = href('analyse/?projet=' + encodeURIComponent(film)); } },
    { label: 'Tous les projets', icon: '←', onclick: () => { location.href = href('analyse/'); } },
    '-',
    { head: 'Les vues' },
    { label: 'Studio', onclick: vue('studio') },
    { label: 'Casting', onclick: vue('casting') },
    { label: 'Dépouillement', onclick: vue('depouillement') },
    { label: 'Labo des voix', icon: '↗', sub: 'diarisation', onclick: () => { if (voix) location.href = voix.href; } },
    '-',
    { label: 'Exporter le JSON', icon: '↓', sub: 'dépouillement', disabled: !$('#dp-json'), why: 'pas de dépouillement dans cette page', onclick: clic('#dp-json') },
    { label: 'Exporter CSV', icon: '↓', sub: 'dépouillement', disabled: !$('#dp-csv'), why: 'pas de dépouillement dans cette page', onclick: clic('#dp-csv') },
    { label: 'Copier le lien', icon: '↗', sub: 'ce plan', onclick: () => copyText(location.href, 'lien copié') },
    window.XV_PAGE_MA ? { label: 'Ouvrir dans MOVIE_ANALYSE', icon: '↗', sub: 'github.io', title: 'la page publiée par MOVIE_ANALYSE (le dépôt partagé y accepte l’écriture)',
      onclick: () => window.open(window.XV_PAGE_MA, '_blank', 'noopener') } : null,
  ];
  place.replaceWith(kebab(items, { title: 'le film : fiche du projet, vues, exports, lien' }));
  // le clic droit sur la barre ouvre le même menu
  const bar = $('.fm-bar');
  if (bar) contextMenu(bar, (e) => (e.target.closest('a, button, input') ? null : items()));
}
