// SHOWRUNNER TOOLS — le thème, côté modules.
//
// La pose elle-même est dans commun/theme-tot.js, un script classique que
// chaque page charge en tête de <head>, avant toute feuille : le thème
// (clair, sombre, le mien), la taille et les animations sont posés sur
// <html> avant la première peinture. Ce module en est la façade pour les
// modules (shell.js, prefs.js, l'éditeur de thème…) : il l'importe — une
// page sans la ligne du <head> a quand même son thème —, et commun/prefs.js
// le rappelle quand une préférence change (ici, ou dans un autre navigateur
// au relevé suivant). Une seule écriture des attributs : theme-tot.js.
//
// Aucune couleur ici : les valeurs viennent de tokens.css, ou de la
// personne (l'éditeur), vérifiées par colorOk() comme par le serveur.

import './theme-tot.js';

const T = window.SR_THEME;
export const LOCAL_KEY = T.KEY;
export const THEMES = T.THEMES;
export const SCALES = T.SCALES;
export const colorOk = T.colorOk;
export const tokenOk = T.tokenOk;
export const readLocal = () => T.readLocal();
export const applyTheme = (data) => T.apply(data);

// pour le code qui anime lui-même (défilement doux, tweens)
export const reducedMotion = () => document.documentElement.dataset.motion === 'reduce'
  || !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
export const scrollBehavior = () => (reducedMotion() ? 'auto' : 'smooth');
