// LA copie de défilement d'une vidéo, côté page : une seule vérité pour tout
// ce qui montre une vidéo de la bibliothèque et laisse déplacer sa tête de
// lecture — le lecteur commun (commun/lecteur.js : Asset, le fil d'Image et de
// Vidéo, Transcrire, Idéation, Upscale), le Montage (montage/player.js : le
// programme et la source). Extraite du lecteur le 05/10/2026.
//
// Pourquoi (server/tools/defilement.py, mesuré le 30/09) : une vidéo rendue
// n'a souvent qu'une image clé pour 10 s ; chaque saut décode depuis elle
// (850 ms au milieu). La copie (une image clé toutes les 6, 960 px) montre
// l'image voulue en une image d'écran. Pendant qu'on cherche, la page montre la
// copie ; l'originale se cale derrière, et quand elle MONTRE la même image
// (requestVideoFrameCallback, MDN : « when a new video frame is sent to the
// compositor » — sinon `seeked`), elle reprend la place, en pleine définition,
// sans saut. Un saut ne s'empile jamais sur un saut en cours (commun/tete.js,
// `sauter`).
//
//   const C = copieDefil(media, it, { fps, montrer(qui), onEtat(etat, why) })
//   C.nav            la <video> muette de la copie (null : pas de copie possible) ;
//                    la page la pose par-dessus l'originale, cachée tant que
//                    `montrer('nav')` ne l'a pas demandée
//   C.aller(t, { geste })   aller à t (s, déjà visé sur le début d'une image) :
//                    la copie si elle est prête, sinon l'originale ; hors d'un
//                    geste, l'originale se cale 150 ms plus tard
//   C.debut() · C.fin()     un geste commence (la tête suit le pointeur) / finit
//   C.caler()        l'originale se cale tout de suite (la lecture à rebours s'arrête…)
//   C.repos()        la page est au repos (ni geste, ni lecture) : si la copie se voit
//                    encore et que l'originale n'est pas calée sur la demande, elle s'y cale
//   C.lire() · C.arret()    la lecture part (l'originale reprend la place dès
//                    qu'elle montre une image) / s'arrête ; sans effet si répété
//   C.montre         'source' | 'nav' : ce qui se voit
//   C.cible()        où va l'image qui se voit (la demande, sinon l'originale)
//   C.etat · C.why   'attente' | 'calcul' | 'pret' | 'refus' | 'sans'
//   C.detruire()
//
// `montrer(qui)` : la page change ce qui se voit ('source' | 'nav') — le
// lecteur bascule une classe, le Montage l'opacité de ses couches.

import { el, href, api } from './shell.js';
import { sauter, cible } from './tete.js';

export function copieDefil(media, it, { fps = 25, montrer = null, onEtat = null, actif = true } = {}) {
  const peut = actif && it && it.kind === 'video' && !!it.id;
  const nav = peut ? el('video', { class: 'sr-defil', preload: 'auto', playsinline: true, muted: true, draggable: false, 'aria-hidden': 'true' }) : null;
  if (nav) nav.muted = true;
  const S = { etat: peut ? 'attente' : 'sans', why: '', montre: 'source', geste: false, lit: false, want: 0, calee: null, cale: 0, mort: false };

  const dire = () => { if (onEtat) onEtat(S.etat, S.why); };
  // `.vu` : la copie se voit (lecteur.css : .sr-defil, cachée sans elle) ; la page, elle, en fait ce qu'elle veut
  function voir(qui) {
    if (S.montre === qui) return;
    S.montre = qui;
    if (nav) nav.classList.toggle('vu', qui === 'nav');
    if (montrer) montrer(qui);
  }

  // ── la copie : demandée au serveur, calculée au besoin (GET /api/defil/<id>) ──
  async function chercher(n = 0) {
    if (!nav || S.mort) return;
    try {
      const r = await api('defil/' + encodeURIComponent(it.id));
      if (S.mort) return;
      if (r.ready) {
        nav.addEventListener('loadeddata', () => { if (!S.mort) { S.etat = 'pret'; dire(); } }, { once: true });
        nav.addEventListener('error', () => {
          if (S.mort) return;
          S.etat = 'refus'; S.why = 'la copie de défilement ne se lit pas : l’image suit la vidéo elle-même';
          voir('source'); dire();
        }, { once: true });
        nav.src = href(r.url);
        S.etat = 'calcul';
      } else if (r.pending && n < 90) {
        S.etat = 'calcul';
        setTimeout(() => { if (!S.mort && (media.isConnected || nav.isConnected)) chercher(n + 1); }, 1500);
      } else { S.etat = 'refus'; S.why = r.why || ''; }
    } catch (e) { S.etat = 'refus'; S.why = e.message; }
    dire();
  }

  // ── l'originale se cale sur la demande ; quand elle MONTRE l'image voulue, elle reprend la place ──
  function caler() {
    clearTimeout(S.cale); S.cale = 0;
    const want = S.want;
    S.calee = want;
    sauter(media, want);
    if (S.montre !== 'nav') return;
    const rendre = () => { if (!S.geste && !S.lit && S.want === want) voir('source'); };
    if (media.requestVideoFrameCallback) {
      const ok = (now, md) => {
        if (S.want !== want || S.geste || S.mort) return;
        if (Math.abs(md.mediaTime - want) < 0.75 / fps) rendre(); else media.requestVideoFrameCallback(ok);
      };
      media.requestVideoFrameCallback(ok);
    }
    const vu = () => { if (!media.seeking && Math.abs(media.currentTime - want) < 0.75 / fps) setTimeout(rendre, 80); };
    media.addEventListener('seeked', vu, { once: true });
  }

  function aller(t, { geste = false } = {}) {
    S.want = t;
    if (S.lit || S.etat !== 'pret') { sauter(media, t); return; }
    voir('nav');
    sauter(nav, t);
    clearTimeout(S.cale); S.cale = 0;
    // l'originale se cale quand le geste s'arrête (au lâcher, ou 150 ms sans nouvelle demande)
    if (!geste && !S.geste) S.cale = setTimeout(caler, 150);
  }

  // au lâcher, l'originale se cale un peu après : la copie décode d'abord l'image voulue, sans
  // partager le processeur avec l'originale (mesuré : un clic, 50 → 15 ms sur une vidéo à une clé)
  function fin() {
    S.geste = false;
    if (S.montre === 'nav') { clearTimeout(S.cale); S.cale = setTimeout(caler, 120); }
  }

  function repos() {
    if (S.montre === 'nav' && !S.geste && !S.lit && !S.cale && S.calee !== S.want) S.cale = setTimeout(caler, 150);
  }

  function lire() {
    if (S.lit) return;
    S.lit = true;
    clearTimeout(S.cale); S.cale = 0;
    if (S.montre !== 'nav') return;
    // la copie reste devant tant que l'originale n'a pas montré une image
    if (media.requestVideoFrameCallback) media.requestVideoFrameCallback(() => { if (S.lit) voir('source'); });
    else voir('source');
  }
  function arret() {
    if (!S.lit) return;
    S.lit = false;
    S.want = media.currentTime;
  }

  function detruire() {
    S.mort = true;
    clearTimeout(S.cale);
    if (nav) { nav.removeAttribute('src'); try { nav.load(); } catch { /* */ } nav.remove(); }
  }

  if (nav) chercher();
  return {
    nav,
    get etat() { return S.etat; },
    get why() { return S.why; },
    get montre() { return S.montre; },
    cible: () => (S.montre === 'nav' ? S.want : cible(media)),
    aller, caler, repos, fin, lire, arret, detruire,
    debut() { S.geste = true; clearTimeout(S.cale); S.cale = 0; },
  };
}
