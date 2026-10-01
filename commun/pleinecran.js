// SHOWRUNNER TOOLS — le plein écran d'une page (ou d'une fenêtre détachée).
//
// Cal, 29/09 : « il faut un bouton en haut à droite pour passer plein écran ».
// La Fullscreen API (WHATWG Fullscreen ; MDN Element.requestFullscreen) :
// on met <html> en plein écran, donc TOUTE la page — ses menus (commun/menu.js),
// ses fenêtres modales, ses bulles restent dans ce qu'on voit. Chrome et Edge
// 71+, Firefox 64+, Safari 16.4+ sans préfixe (MDN, compatibilité) ; l'iPhone
// n'a le plein écran que pour <video> : le bouton y est désactivé et le dit.
//
//   boutonPleinEcran(doc, el)   le bouton (icône qui change d'état), pour la barre du haut
//   basculer(doc)               entrer / sortir
//   raccourci(doc)              Ctrl+Maj+F dans ce document
//
// Le raccourci : F11 est au navigateur (plein écran de la FENÊTRE, sans la
// Fullscreen API : document.fullscreenElement reste nul). Ctrl+Maj+F n'est
// ni à Chrome (support.google.com/chrome/answer/157179, relu le 29/09) ni à
// Edge (support.microsoft.com, raccourcis d'Edge), ni pris par Montage (F :
// concordance des images, sans Ctrl), ODIO (Ctrl → la vue ; F : cadrer, sans
// Ctrl ; KeyF : le clavier musical, sans Ctrl), Idéation (F : un cadre ou le
// plein écran de la présentation, sans Ctrl), Asset (F : favori, sans Ctrl).
// Firefox : non vérifié. On sort par Échap, comme le navigateur le fait de
// lui-même (on ne peut pas l'en empêcher, et c'est tant mieux).

import { dansCoquille } from './coquille.js';

// Dans la coquille (commun/coquille.js : l'outil s'ouvre dans un cadre pour garder le plein
// écran d'un outil à l'autre), le plein écran est celui du document du HAUT
const docPlein = (doc) => (doc === document && dansCoquille ? window.top.document : doc);

const ICON_IN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ICON_OUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

export const enPleinEcran = (doc = document) => !!docPlein(doc).fullscreenElement;
export const permis = (doc = document) => { const d = docPlein(doc); return !!(d.fullscreenEnabled && d.documentElement.requestFullscreen); };

export function basculer(doc = document) {
  doc = docPlein(doc);
  if (doc.fullscreenElement) return doc.exitFullscreen().catch(() => {});
  if (!permis(doc)) return Promise.resolve();
  // navigationUI « hide » : le moins de barres possible (Chrome) ; sans effet ailleurs
  return doc.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}

export const estRaccourci = (e) => e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.key || '').toLowerCase() === 'f';

export function raccourci(doc = document) {
  doc.addEventListener('keydown', (e) => {
    if (!estRaccourci(e) || e.repeat) return;
    e.preventDefault();
    basculer(doc);
  });
}

// D'une page à l'autre : voir commun/coquille.js (en plein écran, l'outil suivant s'ouvre dans un
// cadre ; le document du haut, lui, reste en plein écran). F11 (le plein écran de la FENÊTRE, au
// navigateur) tient aussi d'un outil à l'autre.

// `el` : la fabrique de shell.js (passée pour ne rien importer : shell.js importe ce module)
export function boutonPleinEcran(doc, el, { cls = 'tb ghost sm sr-full' } = {}) {
  const b = el('button', { class: cls, type: 'button', id: doc === document ? 'sr-full' : null });
  const paint = () => {
    const on = enPleinEcran(doc);
    const ok = permis(doc);
    b.innerHTML = on ? ICON_OUT : ICON_IN;
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'quitter le plein écran' : 'plein écran');
    b.classList.toggle('on', on);
    // une action impossible dit pourquoi, et ce qui la débloque (règle 7)
    b.title = !ok ? 'ce navigateur refuse le plein écran à cette page — F11 met toute la fenêtre en plein écran'
      : on ? 'quitter le plein écran · Échap ou Ctrl+Maj+F'
        : 'plein écran · Ctrl+Maj+F (Échap pour sortir) — il tient d’un outil à l’autre';
    b.setAttribute('aria-disabled', String(!ok));
  };
  b.addEventListener('click', () => { if (permis(doc) || enPleinEcran(doc)) basculer(doc); paint(); });
  docPlein(doc).addEventListener('fullscreenchange', paint);
  paint();
  return b;
}
