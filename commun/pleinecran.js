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

const ICON_IN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ICON_OUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

export const enPleinEcran = (doc = document) => !!doc.fullscreenElement;
export const permis = (doc = document) => !!(doc.fullscreenEnabled && doc.documentElement.requestFullscreen);

export function basculer(doc = document) {
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

// D'une page à l'autre : le plein écran de la Fullscreen API est celui d'un DOCUMENT ; changer d'outil
// charge un autre document, et le navigateur le quitte (WHATWG Fullscreen, « unloading document
// cleanup steps » : fully exit fullscreen) ; la page suivante ne peut pas y rentrer seule
// (requestFullscreen demande un geste : MDN, Element.requestFullscreen, « transient activation »).
// Ce qu'on fait : la page d'avant le note pour l'onglet ; la suivante allume son bouton (ambre : ce
// qui attend Cal) et dit pourquoi — un clic, ou Ctrl+Maj+F, y ramène. F11 (le plein écran de la
// FENÊTRE, au navigateur) reste, lui, d'un outil à l'autre.
const QUITTE = 'sr-plein-ecran-quitte';
const ss = { get: () => { try { return sessionStorage.getItem(QUITTE); } catch { return null; } },
  set: (v) => { try { if (v) sessionStorage.setItem(QUITTE, '1'); else sessionStorage.removeItem(QUITTE); } catch { /* */ } } };
if (typeof addEventListener === 'function') {
  addEventListener('pagehide', () => { if (document.fullscreenElement) ss.set(true); });
  // un lien suivi en plein écran (le navigateur a pu le quitter avant pagehide)
  addEventListener('click', (e) => { if (document.fullscreenElement && e.target.closest?.('a[href]')) ss.set(true); }, true);
}

// `el` : la fabrique de shell.js (passée pour ne rien importer : shell.js importe ce module)
export function boutonPleinEcran(doc, el, { cls = 'tb ghost sm sr-full' } = {}) {
  const b = el('button', { class: cls, type: 'button', id: doc === document ? 'sr-full' : null });
  let quitte = doc === document && ss.get() === '1';
  if (quitte) ss.set(false);
  const paint = () => {
    const on = enPleinEcran(doc);
    const ok = permis(doc);
    if (on) quitte = false;
    b.innerHTML = on ? ICON_OUT : ICON_IN;
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'quitter le plein écran' : 'plein écran');
    b.classList.toggle('on', on);
    b.classList.toggle('relance', quitte && ok);
    // une action impossible dit pourquoi, et ce qui la débloque (règle 7)
    b.title = !ok ? 'ce navigateur refuse le plein écran à cette page — F11 met toute la fenêtre en plein écran'
      : on ? 'quitter le plein écran · Échap ou Ctrl+Maj+F'
        : quitte ? 'le plein écran s’arrête à chaque changement de page (le navigateur le quitte) — clic ou Ctrl+Maj+F pour y revenir ; F11 le garde d’un outil à l’autre'
          : 'plein écran · Ctrl+Maj+F (Échap pour sortir) — F11 le garde d’un outil à l’autre';
    b.setAttribute('aria-disabled', String(!ok));
  };
  b.addEventListener('click', () => { quitte = false; if (permis(doc) || enPleinEcran(doc)) basculer(doc); paint(); });
  doc.addEventListener('fullscreenchange', paint);
  paint();
  return b;
}
