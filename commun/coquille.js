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

const ID = 'sr-coquille';

// suis-je l'outil affiché DANS la coquille ?
export const dansCoquille = (() => {
  try { return typeof window !== 'undefined' && window.frameElement?.id === ID; } catch { return false; }
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
