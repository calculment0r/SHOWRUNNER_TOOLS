// LA molette de toutes les timelines du portail (Cal, 29/09 : « il faut qu'on
// ait les mêmes raccourcis dans toutes nos timelines pour naviguer dedans »).
// Une seule règle, ici ; chaque frise s'y branche (`brancher`) et ne dit que
// ce que « zoomer » et « hauteur » veulent dire chez elle.
//
//   molette seule        défiler haut / bas (les pistes) — le défilement du
//                        navigateur, qu'on ne touche pas
//   Maj + molette        défiler dans le temps (à l'horizontale)
//   Alt + molette        zoom du temps, ancré sous le curseur
//   Ctrl + molette       la hauteur de TOUTES les pistes ; au-dessus de
//                        l'en-tête d'une piste (son nom, l'élément qui porte
//                        `data-piste`) : la hauteur de CETTE piste seule
//   pincer (pavé)        comme Alt + molette : le zoom du temps (Premiere :
//                        « pinch to zoom using the trackpad »)
//
// Les pièges, et ce qu'on en fait (MDN, WheelEvent et « wheel event ») :
//   - Ctrl + molette zoome la PAGE : `preventDefault` sur un écouteur
//     `{ passive: false }` posé sur la zone (pas sur document, où Chrome rend
//     l'écouteur passif). Dans une timeline, Ctrl + molette ne zoome jamais la
//     page, même là où la frise n'a pas de hauteur à changer.
//   - le pincement d'un pavé tactile arrive en `wheel` avec `ctrlKey` sans
//     qu'aucune touche Ctrl ne soit tenue (MDN : « Zooming actions using the
//     wheel or trackpad also fire wheel events (with ctrlKey set to true) »).
//     On suit la vraie touche (clavier et pointeur portent l'état des
//     touches) : `ctrlKey` sans Ctrl tenu = un pincement = le zoom du temps.
//   - `deltaMode` : pixels (Chrome), lignes (Firefox à la molette), pages. MDN :
//     certains navigateurs changent l'unité selon que `deltaMode` a été lu ou
//     non — on le lit donc AVANT les deltas, et on convertit (une ligne =
//     100/3 px, le cran de Chromium sous Windows : trois lignes, 100 px).
//   - Maj + molette : selon le navigateur et le système, le delta arrive en
//     `deltaY` (Chrome sous Windows) ou déjà basculé en `deltaX` (macOS,
//     Firefox) : on prend le plus grand des deux.
//   - Alt seul relâché prend le menu de la fenêtre sous Windows (Chromium,
//     « Keyboard Access » : « pressing Alt or F10 focuses the Chromium menu
//     button ») : après un Alt + molette, le relâché d'Alt est gardé par la
//     page (`preventDefault` sur ce seul keyup) ; un Alt sans molette garde
//     son rôle.
//   - MDN : « In some browsers, only the first wheel event in a sequence is
//     cancelable » — une touche pressée au milieu d'un défilement déjà lancé
//     peut laisser passer le défilement du navigateur le temps de ce geste.

export const REGLE = [
  ['molette', 'défiler haut / bas (les pistes)'],
  ['Maj + molette', 'défiler dans le temps'],
  ['Alt + molette', 'zoom du temps, sous le curseur (pincer sur un pavé : pareil)'],
  ['Ctrl + molette', 'hauteur de toutes les pistes'],
  ['Ctrl + molette sur le nom d’une piste', 'la hauteur de cette piste seule'],
];
export const AIDE = 'molette : défiler · Maj : le temps · Alt : zoom · Ctrl : hauteur des pistes (sur un nom : la sienne)';

const LIGNE = 100 / 3;            // px par ligne (deltaMode 1)
const K_CRAN = 0.0022;            // un cran de 100 px : ×1,25 (le pas d'avant, 1.25 / 0.8)
const K_PINCE = 0.01;             // réglage : un pincement donne des deltas de quelques px
const MAX_PX = 300;               // un événement ne fait jamais plus de trois crans

export const borne = (v, min, max) => Math.max(min, Math.min(max, v));

// l'état vrai des touches : clavier et pointeur le portent, le pincement non
let ctrlTenu = false, altRoue = false;
if (typeof window !== 'undefined' && !window.__srMolette) {
  window.__srMolette = true;
  const suit = (e) => { ctrlTenu = !!e.ctrlKey; };
  for (const t of ['keydown', 'keyup', 'pointerdown', 'pointermove', 'mousedown']) window.addEventListener(t, suit, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Alt') altRoue = false; }, true);
  window.addEventListener('keyup', (e) => { if (e.key === 'Alt' && altRoue) { e.preventDefault(); altRoue = false; } }, true);
  window.addEventListener('blur', () => { ctrlTenu = false; altRoue = false; });
}

// les deltas en pixels ; `el` donne la page (deltaMode 2)
export function pixels(ev, el) {
  const m = ev.deltaMode;                       // lu en premier (MDN)
  const dx = ev.deltaX, dy = ev.deltaY;
  const k = m === 1 ? LIGNE : m === 2 ? ((el && el.clientHeight) || innerHeight) : 1;
  return [dx * k, dy * k];
}

// ce que dit un événement, selon LA règle — pur, pour les pages et les essais
//   { geste: 'defiler' | 'temps' | 'zoom' | 'hauteur', px, facteur, pince }
export function lire(ev, el) {
  const [dx, dy] = pixels(ev, el);
  const grand = Math.abs(dx) > Math.abs(dy) ? dx : dy;
  const d = borne(dy || dx, -MAX_PX, MAX_PX);
  const ctrl = ev.metaKey || (ev.ctrlKey && ctrlTenu);
  const pince = ev.ctrlKey && !ctrlTenu && !ev.metaKey;
  if (ctrl) return { geste: 'hauteur', px: d, facteur: Math.exp(-d * K_CRAN), pince: false };
  if (pince) return { geste: 'zoom', px: d, facteur: Math.exp(-d * K_PINCE), pince: true };
  if (ev.altKey) return { geste: 'zoom', px: d, facteur: Math.exp(-d * K_CRAN), pince: false };
  if (ev.shiftKey) return { geste: 'temps', px: grand, facteur: 1, pince: false };
  return { geste: 'defiler', px: dy, facteur: 1, pince: false };
}

// l'en-tête de piste sous le curseur (l'élément qui porte `data-piste`), ou null
export function pisteSous(ev, zone) {
  const n = ev.target && ev.target.closest ? ev.target.closest('[data-piste]') : null;
  return n && (!zone || zone.contains(n)) ? n.dataset.piste : null;
}

// Garder sous le curseur ce qui y est quand toutes les pistes changent de
// hauteur : le contenu grandit d'un rapport, le défilement le suit.
export function tenirY(scroller, clientY, faire) {
  if (!scroller) { faire(); return; }
  const r = scroller.getBoundingClientRect();
  const y = clientY - r.top, s0 = scroller.scrollTop, h0 = scroller.scrollHeight || 1;
  faire();
  const h1 = scroller.scrollHeight || h0;
  scroller.scrollTop = Math.max(0, (s0 + y) * (h1 / h0) - y);
}

// Brancher une timeline : `zone` reçoit la molette (elle couvre les en-têtes
// ET les pistes). Options :
//   zoom(facteur, clientX, ev)      Alt + molette, le pincement
//   hauteur(facteur, piste, ev)     Ctrl + molette ; piste = l'id de l'en-tête
//                                   survolé, sinon null (toutes). Absente : Ctrl
//                                   + molette ne fait rien (et ne zoome pas la page)
//   defilerX(px, ev)                Maj + molette ; défaut : `scroller.scrollLeft`
//   defilerY(px, ev)                molette seule ; absente : le navigateur défile
//   scroller                        l'élément qui défile (défaut : zone)
//   piste(ev)                       l'en-tête sous le curseur (défaut : data-piste)
// Rend de quoi débrancher.
export function brancher(zone, o = {}) {
  if (!zone) return () => {};
  const sc = o.scroller || zone;
  const f = (ev) => {
    const g = lire(ev, sc);
    if (g.geste === 'defiler') {
      if (!o.defilerY) return;
      ev.preventDefault();
      o.defilerY(g.px, ev);
      return;
    }
    ev.preventDefault();
    if (g.geste === 'temps') {
      if (o.defilerX) o.defilerX(g.px, ev); else sc.scrollLeft += g.px;
    } else if (g.geste === 'zoom') {
      if (!g.pince && ev.altKey) altRoue = true;
      if (o.zoom && g.px) o.zoom(g.facteur, ev.clientX, ev);
    } else if (g.geste === 'hauteur') {
      if (o.hauteur && g.px) o.hauteur(g.facteur, o.piste ? o.piste(ev) : pisteSous(ev, zone), ev);
    }
  };
  zone.addEventListener('wheel', f, { passive: false });
  return () => zone.removeEventListener('wheel', f, { passive: false });
}

// ── LE CANVAS (Idéation, planches) : la souris ET le pavé, sans réglage ──────────────────────────────
// Cal, 01/10 : « le deux doigts pour panner, le zoom en pincer, sans les deux choix de Miro ».
//   pincer (pavé)  ou  Ctrl + molette      zoom, sous le curseur
//   deux doigts (pavé)                     déplacer la vue (pan), dans les deux sens
//   molette à crans (souris)               zoom, comme avant ; Maj + molette : la vue à l'horizontale
//   Alt + molette                          zoom, quel que soit l'appareil
// Le navigateur ne dit pas quel appareil tourne : on le déduit de l'événement (`wheel`, MDN), et on
// garde le verdict pour la suite du geste (l'inertie du pavé continue 1 s après les doigts) :
//   - deltaMode ≠ 0 (lignes, pages)                         → molette (Firefox)
//   - deltaX ≠ 0, un delta non entier, ou |deltaY| < 40 px  → pavé (une molette ne fait ni l'un ni l'autre :
//                                                             un cran fait ≥ 100 px entier, sur Y seul)
//   - sinon, un cran entier sur Y seul                      → molette, SAUF dans la suite d'un geste de
//                                                             pavé (l'inertie : le verdict du pavé tient 700 ms
//                                                             après son dernier événement)
// Le pincement d'un pavé arrive en `wheel` + `ctrlKey` (MDN) sans Ctrl tenu ; Safari macOS l'envoie en
// `gesturechange` (non standard, WebKit) : `brancherCanvas` écoute les deux.
const TENU_PAVE = 700;
let dernierPave = 0;

// → { geste: 'pan' | 'zoom', dx, dy, facteur, pave }
export function lireCanvas(ev, el) {
  const [dx, dy] = pixels(ev, el);              // deltaMode lu en premier
  const now = ev.timeStamp || performance.now();
  const crans = ev.deltaMode !== 0 || (dx === 0 && Number.isInteger(dy) && Math.abs(dy) >= 40);
  const pave = !crans || (ev.deltaMode === 0 && now - dernierPave < TENU_PAVE && !(ev.ctrlKey && ctrlTenu));
  if (pave && ev.deltaMode === 0) dernierPave = now;
  const d = borne(dy || dx, -MAX_PX, MAX_PX);
  const vraiCtrl = ev.metaKey || (ev.ctrlKey && ctrlTenu);
  const pince = ev.ctrlKey && !ctrlTenu && !ev.metaKey;
  if (pince) return { geste: 'zoom', dx, dy, facteur: Math.exp(-d * K_PINCE), pave: true };
  if (vraiCtrl || ev.altKey) return { geste: 'zoom', dx, dy, facteur: Math.exp(-d * (pave ? K_PINCE : K_CRAN * 0.75)), pave };
  if (ev.shiftKey && !pave) return { geste: 'pan', dx: dx || dy, dy: 0, facteur: 1, pave };
  if (pave) return { geste: 'pan', dx, dy, facteur: 1, pave };
  return { geste: 'zoom', dx, dy, facteur: Math.exp(-d * K_CRAN * 0.75), pave };
}

// Brancher le canvas : `pan(dx, dy, ev)` et `zoom(facteur, clientX, clientY, ev)`.
// `ignore(ev)` : vrai pour ce qui garde sa propre molette (la mini-carte, les listes). Rend de quoi débrancher.
export function brancherCanvas(zone, { pan, zoom, ignore } = {}) {
  if (!zone) return () => {};
  const f = (ev) => {
    if (ignore && ignore(ev)) return;
    ev.preventDefault();
    const g = lireCanvas(ev, zone);
    if (g.geste === 'pan') { if (pan && (g.dx || g.dy)) pan(g.dx, g.dy, ev); }
    else if (zoom && g.facteur !== 1) zoom(g.facteur, ev.clientX, ev.clientY, ev);
  };
  // Safari (macOS) : le pincement n'est pas une molette
  let s0 = 1;
  const gs = (ev) => { if (ignore && ignore(ev)) return; ev.preventDefault(); s0 = 1; };
  const gc = (ev) => {
    if (ignore && ignore(ev)) return;
    ev.preventDefault();
    const k = ev.scale / s0; s0 = ev.scale;
    if (zoom && k !== 1) zoom(k, ev.clientX, ev.clientY, ev);
  };
  zone.addEventListener('wheel', f, { passive: false });
  zone.addEventListener('gesturestart', gs);
  zone.addEventListener('gesturechange', gc);
  return () => { zone.removeEventListener('wheel', f); zone.removeEventListener('gesturestart', gs); zone.removeEventListener('gesturechange', gc); };
}
