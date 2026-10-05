// SHOWRUNNER TOOLS — rester en plein écran d'un outil à l'autre : la coquille.
//
// Cal, 01/10 : « quand je change d'onglet, cela me ressort du mode plein écran ».
// Le plein écran de la Fullscreen API est celui d'un DOCUMENT : changer d'outil
// charge un autre document, et le navigateur le quitte (WHATWG Fullscreen,
// « unloading document cleanup steps » : fully exit fullscreen) ; la page
// suivante ne peut pas y rentrer seule (MDN, Element.requestFullscreen :
// « transient activation » exigée). Donc, EN PLEIN ÉCRAN, on ne quitte plus
// le document : l'outil demandé s'ouvre dans un cadre (#sr-coquille) qui
// couvre toute la page, et la page qui est en plein écran reste dessous.
// Les changements d'outil suivants se font DANS le cadre (le document du haut
// ne change plus) : le plein écran tient.
//
//   - toute navigation de ce document vers une page du portail (lien, menu,
//     location.href…) est prise par la Navigation API (`navigate`, annulable
//     pour une navigation d'un document vers un autre du même site : HTML,
//     « The Navigation API », NavigateEvent.cancelable ; Chromium 102+) ; sans
//     elle, les clics sur un lien du même site ;
//   - jamais un téléchargement, un formulaire, un historique (Précédent),
//     un rechargement, une route /api/ ou un fichier (seulement des pages) ;
//   - la page du dessous est ENDORMIE comme si on l'avait quittée : ses
//     médias en pause, ses AudioContext suspendus, micro et caméra coupés,
//     ses connexions (EventSource, RTCPeerConnection) fermées, et un
//     « pagehide » envoyé à ses écouteurs (la co-édition y dit « je pars ») ;
//   - l'adresse de l'onglet suit l'outil du cadre (history.replaceState) :
//     recharger ouvre directement cet outil, sans cadre ;
//   - dans le cadre, le bouton plein écran et Ctrl+Maj+F agissent sur le
//     document du haut (commun/pleinecran.js : `docPlein`) ; un geste dans le
//     cadre active aussi ses ancêtres (HTML, « activation notification ») ;
//   - sorti du plein écran, le cadre reste : on est là où on en était.
//
// LE VOLET (Cal, 05/10 : « quand je vais dans le kit de présentation, cela me sort du plein écran… vérifie qu'on ne
// l'a pas ailleurs ») : tout ce qui ouvrait une page du portail dans un NOUVEL ONGLET (un lien `target="_blank"`, un
// `window.open(…, '_blank')` : « Révéler dans Asset », « L'élément dans Asset », « Ouvrir ODIO », le kit…) quittait
// le plein écran — un autre onglet n'est pas le document en plein écran. En plein écran, ces pages s'ouvrent donc
// dans un volet posé PAR-DESSUS l'outil (#sr-volet, dans le document du haut) : Fermer (ou Échap) y ramène ;
// « Ouvrir ici » en fait l'outil affiché. Hors plein écran : un onglet, comme avant. Une seule règle, ici, pour tous
// les liens et toutes les fenêtres (un nouveau lien `target="_blank"` en hérite sans rien faire). Jamais : un
// autre site (il refuserait souvent d'être encadré : il garde son onglet), une fenêtre nommée (les panneaux
// détachés de commun/fenetre.js), un téléchargement, un clic avec Ctrl/Maj/Alt (un onglet voulu).

const ID = 'sr-coquille';
const VOLET = 'sr-volet';

// suis-je l'outil affiché DANS la coquille ?
export const dansCoquille = (() => {
  try { return typeof window !== 'undefined' && window.frameElement?.id === ID; } catch { return false; }
})();
// … ou dans un cadre du portail, coquille ou volet : le plein écran est alors celui du document du haut
export const dansCadre = (() => {
  try { return typeof window !== 'undefined' && [ID, VOLET].includes(window.frameElement?.id); } catch { return false; }
})();

// ── ce qu'il faut couper quand la page s'endort ─────────────────
// relevés à leur création (ce module est chargé par shell.js, avant le code des pages)
const vivants = { ctx: new Set(), flux: new Set(), es: new Set(), pc: new Set() };
function suivre(nom, ens) {
  const Nat = window[nom];
  if (typeof Nat !== 'function' || Nat.__srSuivi) return;
  const Suivi = class extends Nat { constructor(...a) { super(...a); ens.add(this); } };
  Suivi.__srSuivi = true;
  window[nom] = Suivi;
}
if (typeof window !== 'undefined' && !dansCoquille && window.top === window) {
  try {
    suivre('AudioContext', vivants.ctx);
    suivre('webkitAudioContext', vivants.ctx);
    suivre('EventSource', vivants.es);
    suivre('RTCPeerConnection', vivants.pc);
    const md = navigator.mediaDevices;
    if (md?.getUserMedia && !md.getUserMedia.__srSuivi) {
      const gum = md.getUserMedia.bind(md);
      md.getUserMedia = async (c) => { const s = await gum(c); vivants.flux.add(s); return s; };
      md.getUserMedia.__srSuivi = true;
    }
  } catch { /* un navigateur qui refuse : la page dort moins bien, rien ne casse */ }
}

function endormir() {
  try { dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); } catch { /* */ }
  for (const m of document.querySelectorAll('video, audio')) { try { m.pause(); } catch { /* */ } }
  for (const c of vivants.ctx) { try { c.suspend(); } catch { /* */ } }
  for (const s of vivants.flux) { try { s.getTracks().forEach((t) => t.stop()); } catch { /* */ } }
  for (const p of vivants.pc) { try { p.close(); } catch { /* */ } }
  for (const e of vivants.es) { try { e.close(); } catch { /* */ } }
  // le dessous ne prend plus ni clic ni clavier
  for (const n of document.body.children) if (n.id !== ID) n.inert = true;
}

// une page du portail ? (pas une route d'API, pas un fichier à télécharger)
function estPage(u) {
  if (u.origin !== location.origin) return false;
  if (/^\/(api|library|uploads)\//.test(u.pathname)) return false;
  const ext = /\.([a-z0-9]+)$/i.exec(u.pathname);
  return !ext || /^html?$/i.test(ext[1]);
}

let cadre = null;
function synchroniser() {
  try {
    const w = cadre.contentWindow;
    history.replaceState(history.state, '', w.location.href);
    document.title = w.document.title;
  } catch { /* le cadre a quitté le site : on garde l'adresse d'avant */ }
}
function ouvrir(url) {
  if (!cadre) {
    cadre = document.createElement('iframe');
    cadre.id = ID;
    cadre.title = 'Showrunner';
    // la visio d'Idéation, le lecteur en plein écran, le presse-papiers, l'enregistrement
    cadre.allow = 'fullscreen; autoplay; microphone; camera; display-capture; clipboard-read; clipboard-write';
    cadre.allowFullscreen = true;
    Object.assign(cadre.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%', border: '0', margin: '0',
      zIndex: '2147483647', background: 'var(--bg)', visibility: 'hidden',
    });
    let premier = true;
    cadre.addEventListener('load', () => {
      cadre.style.visibility = 'visible';   // l'ancienne page reste vue tant que la suivante n'est pas prête
      if (premier) { premier = false; endormir(); }
      synchroniser();
      try {
        const w = cadre.contentWindow;
        w.addEventListener('hashchange', synchroniser);
        w.addEventListener('popstate', synchroniser);
        w.navigation?.addEventListener('navigatesuccess', synchroniser);
        w.focus();
      } catch { /* */ }
    });
    document.body.append(cadre);
  }
  cadre.src = url;
}

if (typeof window !== 'undefined' && !dansCoquille && window.top === window) {
  if (window.navigation && typeof window.navigation.addEventListener === 'function') {
    window.navigation.addEventListener('navigate', (e) => {
      if (!document.fullscreenElement || cadre) return;   // le cadre posé, ses navigations sont les siennes
      if (!e.cancelable || e.hashChange || e.downloadRequest || e.formData) return;
      if (e.navigationType !== 'push' && e.navigationType !== 'replace') return;
      if (e.destination.sameDocument) return;
      const u = new URL(e.destination.url);
      if (!estPage(u)) return;
      e.preventDefault();
      ouvrir(u.href);
    });
  } else {
    // sans Navigation API : les liens seulement
    addEventListener('click', (e) => {
      if (!document.fullscreenElement || cadre || e.defaultPrevented || e.button !== 0) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const u = new URL(a.href, location.href);
      if (u.pathname === location.pathname && u.search === location.search) return;
      if (!estPage(u)) return;
      e.preventDefault();
      ouvrir(u.href);
    });
  }
  // sorti du plein écran : l'adresse dit l'outil du cadre (on reste là où on en était)
  document.addEventListener('fullscreenchange', () => { if (cadre) synchroniser(); });
}

// ── le volet ────────────────────────────────────────────────
const natOpen = typeof window !== 'undefined' && typeof window.open === 'function' ? (window.open.__srNat || window.open) : null;
const haut = () => (dansCadre ? window.top : window);
const pleinEcranHaut = () => { try { return !!haut().document.fullscreenElement; } catch { return false; } };

function fermerVolet(D) {
  D.getElementById(VOLET + '-w')?.remove();
  D.getElementById(VOLET + '-f')?.remove();
}

// ouvrir une page du portail « à côté » : en plein écran, dans le volet ; sinon dans un onglet
export function ouvrirAcote(url) {
  const u = new URL(url, location.href);
  if (!pleinEcranHaut() || !estPage(u)) { natOpen?.call(window, u.href, '_blank', 'noopener'); return; }
  const W = haut(), D = W.document;
  let frame = D.getElementById(VOLET);
  if (!frame) {
    const mk = (tag, cls, txt) => { const n = D.createElement(tag); if (cls) n.className = cls; if (txt) n.textContent = txt; return n; };
    const fond = mk('div');
    fond.id = VOLET + '-f';
    Object.assign(fond.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: 'var(--veil)' });
    fond.addEventListener('click', () => fermerVolet(D));
    const w = mk('div');
    w.id = VOLET + '-w';
    w.setAttribute('role', 'dialog');
    Object.assign(w.style, { position: 'fixed', inset: '3vh 3vw', zIndex: '2147483647', display: 'flex', flexDirection: 'column',
      background: 'var(--panel)', borderRadius: 'var(--r4, 10px)', overflow: 'hidden', boxShadow: '0 0 0 1px var(--line), 0 24px 80px var(--drop)' });
    const bar = mk('div');
    Object.assign(bar.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px 8px 16px', boxShadow: 'inset 0 -1px 0 var(--line)', flex: 'none' });
    const titre = mk('span', 'lbl', 'Showrunner');
    Object.assign(titre.style, { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
    const ici = mk('button', 'tb ghost sm', 'Ouvrir ici');
    ici.type = 'button';
    ici.title = 'en faire l’outil affiché (le plein écran reste)';
    ici.addEventListener('click', () => {
      const dest = (() => { try { return frame.contentWindow.location.href; } catch { return frame.src; } })();
      fermerVolet(D);
      W.__srCoquille?.ouvrir(dest);
    });
    const x = mk('button', 'tb ghost sm', 'Fermer');
    x.type = 'button';
    x.title = 'revenir à l’outil (Échap)';
    x.addEventListener('click', () => fermerVolet(D));
    bar.append(titre, ici, x);
    frame = mk('iframe');
    frame.id = VOLET;
    frame.allow = 'fullscreen; autoplay; microphone; camera; display-capture; clipboard-read; clipboard-write';
    Object.assign(frame.style, { flex: '1', width: '100%', border: '0', background: 'var(--bg)' });
    frame.addEventListener('load', () => {
      try {
        const fw = frame.contentWindow;
        titre.textContent = fw.document.title || 'Showrunner';
        // Échap ferme le volet, si la page du volet ne l'a pas pris pour elle (un menu, une boîte : preventDefault)
        fw.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) fermerVolet(D); });
        fw.focus();
      } catch { /* */ }
    });
    w.append(bar, frame);
    D.body.append(fond, w);
  }
  frame.src = u.href;
}

if (typeof window !== 'undefined') {
  if (!dansCoquille && window.top === window) {
    window.__srCoquille = { ouvrir };
    // Échap dans le document du haut (le clavier n'est pas dans le volet) : le volet se ferme
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && document.getElementById(VOLET)) { e.preventDefault(); fermerVolet(document); }
    });
  }
  // un lien « nouvel onglet » vers une page du portail : en plein écran, le volet
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href]');
    if (!a || a.target !== '_blank' || a.hasAttribute('download') || !pleinEcranHaut()) return;
    const u = new URL(a.href, location.href);
    if (!estPage(u)) return;
    e.preventDefault();
    ouvrirAcote(u.href);
  });
  // window.open(…, '_blank') vers une page du portail : pareil (une fenêtre nommée garde sa fenêtre)
  if (natOpen && !window.open.__srNat) {
    const open = function (url, name, features) {
      try {
        if (url && (!name || name === '_blank') && pleinEcranHaut()) {
          const u = new URL(String(url), location.href);
          if (estPage(u)) { ouvrirAcote(u.href); return null; }
        }
      } catch { /* */ }
      return natOpen.call(window, url, name, features);
    };
    open.__srNat = natOpen;
    window.open = open;
  }
}
