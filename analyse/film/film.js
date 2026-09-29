// MOVIE ANALYSIS — la page d'un film dans le portail (écrite par analyse/chaine/studio.mjs, sous
// analyse/analyses/<film>/ ou analyse/runs/<nom>/) : l'en-tête commun du portail, la barre du film collée
// dessous, l'icône, et la grammaire commune — le menu « ⋯ » de la barre et le menu d'une réplique (clic, clic
// droit) passent par commun/menu.js. Le Studio lui-même (vidéo, script, timeline, casting, dépouillement) est le
// script de la page : ce module ne fait que le cadre, commun à tous les films.
import { mountHeader, $, href } from '../../commun/shell.js';
import { menu, kebab, contextMenu, closeMenus, pageMenu, commonItems, copy } from '../../commun/menu.js';
import { copyText } from '../../commun/fil.js';
import { createUndo } from '../../commun/undo.js';

// le script de la page (voix.js, menus.js) prend le menu commun quand il est là : le menu d'une réplique, et celui de
// chaque zone au clic droit (la scène, la frise, le script, la timeline, la fiche du plan, le casting, le dépouillement)
window.SR_MENU = { menu, kebab, contextMenu, closeMenus, commonItems, copy };

// l'annulation commune (commun/undo.js) : une pile par page, donc par film. Le script de la page est classique et
// s'exécute avant ce module : il a posé window.xvBrancheAnnulation, qui prend la pile (des instantanés de ses
// corrections), remplace ses boutons « ↶ Annuler » par ↶ ↷ et le journal, et laisse le clavier à undo.js (Ctrl+Z,
// Ctrl+Maj+Z, Ctrl+Y, lus par e.key). Sans ce module (la page ouverte seule), la page garde son repli.
// (window.SR_UNDO est à undo.js lui-même : le menu de repli de commun/menu.js y lit la pile active — ne pas l'écraser)
const U = createUndo({ name: 'analyse-film' });
if (typeof window.xvBrancheAnnulation === 'function') window.xvBrancheAnnulation(U);

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
  // et le menu de repli du portail (là où aucune zone n'a le sien) commence par lui
  pageMenu(() => items());
}
