// SHOWRUNNER TOOLS — le thème posé AVANT la première peinture.
//
// Un script classique, synchrone, le premier de chaque <head> (avant toute
// feuille) :   <script src="../commun/theme-tot.js"></script>
// Un module (type="module") est différé : il s'exécute après l'analyse du
// document, et la page a déjà pu se peindre dans le thème par défaut (le
// sombre) — c'est ce que Cal voyait en thème clair en changeant de page
// (mesuré le 30/09 : sur Vidéo, Character Factory, ODIO… les premières
// images étaient sombres). Un script classique sans async ni defer bloque
// l'analyse, pas la peinture, mais rien n'est peint avant lui : il est
// avant les feuilles (MDN, <script> : « blocks parsing »).
//
// Il lit la préférence gardée dans ce navigateur (le miroir local de
// commun/prefs.js, clé sr.prefs.v1) et pose sur <html> :
//   data-theme="light"      le jeu clair de commun/tokens.css ;
//   style="--jeton: …"      les jetons de l'éditeur (thème « le mien ») ;
//   style="zoom: …"         la taille de l'interface ;
//   data-motion="reduce"    les animations réduites.
// C'est LA seule écriture de ces attributs : commun/theme.js (le module que
// shell.js et prefs.js importent) l'importe aussi — une page qui aurait
// oublié la ligne du <head> a quand même son thème, juste plus tard — et le
// rappelle quand une préférence change. Rien d'autre ici : pas d'import, pas
// de réseau, et aucune couleur (elles viennent de tokens.css, ou de la
// personne, vérifiées par colorOk() comme par le serveur).
//
// Écrit pour valoir des deux façons : chargé comme script classique (le
// <head>) et importé comme module (theme.js) ; la deuxième fois, il ne
// redéfinit rien.
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : null;
  if (!W || W.SR_THEME) return;
  var KEY = 'sr.prefs.v1';
  var THEMES = ['dark', 'light', 'custom'];
  var SCALES = [90, 100, 110, 125];
  // une couleur CSS et rien d'autre : ni url(), ni var(), ni expression
  var COLOR_RX = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|hsla?\(\s*[\d.]+(deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(,\s*[\d.]+%?\s*)?\)|transparent)$/i;
  var colorOk = function (v) { return typeof v === 'string' && v.length <= 64 && COLOR_RX.test(v.trim()); };
  var tokenOk = function (n) { return typeof n === 'string' && /^--[a-z0-9-]{1,40}$/.test(n); };
  var readLocal = function () {
    try { return (JSON.parse(localStorage.getItem(KEY) || 'null') || {}).data || {}; } catch (e) { return {}; }
  };
  var applied = [];      // les jetons posés en ligne par l'éditeur
  var MOTION_CSS = 'html[data-motion="reduce"] *, html[data-motion="reduce"] *::before, html[data-motion="reduce"] *::after'
    + ' { animation: none !important; transition: none !important; scroll-behavior: auto !important; }';

  function apply(data) {
    if (!data) data = readLocal();
    var root = document.documentElement;
    var g = data.general || {};
    var theme = THEMES.indexOf(g.theme) >= 0 ? g.theme : 'dark';
    var custom = data.theme && typeof data.theme === 'object' ? data.theme : {};
    var base = theme === 'custom' ? (custom.base === 'light' ? 'light' : 'dark') : theme;
    root.setAttribute('data-theme', base);
    for (var i = 0; i < applied.length; i++) root.style.removeProperty(applied[i]);
    applied = [];
    if (theme === 'custom' && custom.tokens && typeof custom.tokens === 'object') {
      for (var n in custom.tokens) {
        if (Object.prototype.hasOwnProperty.call(custom.tokens, n) && tokenOk(n) && colorOk(custom.tokens[n])) {
          root.style.setProperty(n, custom.tokens[n].trim()); applied.push(n);
        }
      }
    }
    // la taille de l'interface : tout le portail est écrit en px, seul
    // « zoom » agrandit l'ensemble (étude préférences, § taille de l'interface)
    var z = SCALES.indexOf(Number(g.scale)) >= 0 ? Number(g.scale) : 100;
    root.style.zoom = z === 100 ? '' : String(z / 100);
    root.style.setProperty('--ui-zoom', String(z / 100));
    if (g.motion === 'reduce') {
      root.setAttribute('data-motion', 'reduce');
      // la même règle que base.css sous prefers-reduced-motion, posée par la personne
      if (!document.querySelector('style[data-sr-motion]')) {
        var st = document.createElement('style');
        st.setAttribute('data-sr-motion', '');
        st.textContent = MOTION_CSS;
        (document.head || root).appendChild(st);
      }
    } else root.removeAttribute('data-motion');
    try { document.dispatchEvent(new CustomEvent('sr:theme', { detail: { theme: theme, base: base, scale: z } })); } catch (e) { /* */ }
    return { theme: theme, base: base, scale: z };
  }

  // L'appareil, posé sur <html> comme le thème (Cal, 01/10 : « on peut savoir si on affiche sur téléphone ou
  // ordi ? ») : data-appareil = mobile | tablette | ordi ; data-tactile (écran tactile principal) ;
  // data-standalone (lancé depuis l'écran d'accueil, sans barre d'adresse). Le CSS peut s'y accrocher
  // (html[data-appareil="mobile"]) et le JS lire window.SR_APPAREIL. Les téléphones se reconnaissent à
  // leur agent (iPhone, Android « Mobile »), les iPad récents aussi : iPadOS se dit « Macintosh » mais a un écran
  // tactile (maxTouchPoints > 1) ; Chrome sur iPhone dit « CriOS » (c'est WebKit dessous).
  var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  var mm = function (q) { try { return !!(W.matchMedia && W.matchMedia(q).matches); } catch (e) { return false; } };
  var ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  var droid = /Android/.test(ua);
  var appareil = {
    mobile: /iPhone|iPod/.test(ua) || (droid && /Mobile/.test(ua)),
    tablette: ipad || (droid && !/Mobile/.test(ua)),
    tactile: mm('(pointer: coarse)'),
    ios: /iPhone|iPod|iPad/.test(ua) || ipad,
    navigateur: /CriOS/.test(ua) ? 'chrome' : /FxiOS/.test(ua) ? 'firefox' : /EdgiOS|EdgA|Edg\//.test(ua) ? 'edge' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : '?',
    standalone: (typeof navigator !== 'undefined' && navigator.standalone === true) || mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)'),
  };
  appareil.type = appareil.mobile ? 'mobile' : appareil.tablette ? 'tablette' : 'ordi';
  var rootEl = document.documentElement;
  rootEl.setAttribute('data-appareil', appareil.type);
  if (appareil.tactile) rootEl.setAttribute('data-tactile', ''); else rootEl.removeAttribute('data-tactile');
  if (appareil.standalone) rootEl.setAttribute('data-standalone', ''); else rootEl.removeAttribute('data-standalone');
  W.SR_APPAREIL = appareil;

  W.SR_THEME = { KEY: KEY, THEMES: THEMES, SCALES: SCALES, colorOk: colorOk, tokenOk: tokenOk, readLocal: readLocal, apply: apply };
  apply();
})();
