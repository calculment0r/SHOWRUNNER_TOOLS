// SHOWRUNNER TOOLS — le thème posé sur la page, avant tout le reste.
//
// Chargé par commun/shell.js dès son import (toutes les pages du portail
// passent par lui) : il lit les préférences gardées dans ce navigateur
// (commun/prefs.js en tient le miroir local) et pose sur <html> :
//   data-theme="light"      le jeu clair de commun/tokens.css ;
//   style="--jeton: …"      les jetons de l'éditeur (thème « le mien ») ;
//   style="zoom: …"         la taille de l'interface ;
//   data-motion="reduce"    les animations réduites.
// Il n'importe rien : le thème est posé avant que la page ne se dessine,
// sans attendre le serveur. commun/prefs.js le rappelle quand une
// préférence change (ici, ou dans un autre navigateur au relevé suivant).
//
// Aucune couleur ici : les valeurs viennent de tokens.css, ou de la
// personne (l'éditeur), vérifiées par colorOk() comme par le serveur.

export const LOCAL_KEY = 'sr.prefs.v1';
export const THEMES = ['dark', 'light', 'custom'];
export const SCALES = [90, 100, 110, 125];

// une couleur CSS et rien d'autre : ni url(), ni var(), ni expression
const COLOR_RX = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|hsla?\(\s*[\d.]+(deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(,\s*[\d.]+%?\s*)?\)|transparent)$/i;
export const colorOk = (v) => typeof v === 'string' && v.length <= 64 && COLOR_RX.test(v.trim());
export const tokenOk = (n) => typeof n === 'string' && /^--[a-z0-9-]{1,40}$/.test(n);

export function readLocal() {
  try { return (JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null') || {}).data || {}; } catch { return {}; }
}

const applied = new Set();   // les jetons posés en ligne par l'éditeur
let motionStyle = null;

export function applyTheme(data = readLocal()) {
  const root = document.documentElement;
  const g = data.general || {};
  const theme = THEMES.includes(g.theme) ? g.theme : 'dark';
  const custom = data.theme && typeof data.theme === 'object' ? data.theme : {};
  const base = theme === 'custom' ? (custom.base === 'light' ? 'light' : 'dark') : theme;
  root.dataset.theme = base;
  for (const n of applied) root.style.removeProperty(n);
  applied.clear();
  if (theme === 'custom') {
    for (const [n, v] of Object.entries(custom.tokens || {})) {
      if (tokenOk(n) && colorOk(v)) { root.style.setProperty(n, v.trim()); applied.add(n); }
    }
  }
  // la taille de l'interface : tout le portail est écrit en px, seul
  // « zoom » agrandit l'ensemble (étude, § taille de l'interface)
  const z = SCALES.includes(Number(g.scale)) ? Number(g.scale) : 100;
  root.style.zoom = z === 100 ? '' : String(z / 100);
  root.style.setProperty('--ui-zoom', String(z / 100));
  if (g.motion === 'reduce') {
    root.dataset.motion = 'reduce';
    if (!motionStyle) {
      // la même règle que base.css sous prefers-reduced-motion, posée par la personne
      motionStyle = document.createElement('style');
      motionStyle.dataset.srMotion = '';
      motionStyle.textContent = 'html[data-motion="reduce"] *, html[data-motion="reduce"] *::before, html[data-motion="reduce"] *::after'
        + ' { animation: none !important; transition: none !important; scroll-behavior: auto !important; }';
      document.head.append(motionStyle);
    }
  } else delete root.dataset.motion;
  document.dispatchEvent(new CustomEvent('sr:theme', { detail: { theme, base, scale: z } }));
  return { theme, base, scale: z };
}

// pour le code qui anime lui-même (défilement doux, tweens)
export const reducedMotion = () => document.documentElement.dataset.motion === 'reduce'
  || !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
export const scrollBehavior = () => (reducedMotion() ? 'auto' : 'smooth');

applyTheme();
