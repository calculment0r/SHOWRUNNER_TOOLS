// LA tête de lecture et LA règle des temps de toutes les timelines du
// portail (Cal, 30/09 : « il serait bien que toutes nos timelines aient la
// même cue partout, celle du montage vidéo est bien. donc on la met dans
// ODIO, Transcrire etc. »). Extraites du Montage (montage/timeline.js, qui
// s'en sert lui-même) : même dessin, même comportement, une seule vérité.
//
//   la tête      un trait orange de 2 px sur toute la hauteur, un onglet de
//                11 px en haut (arrondi dessous) ; ne se dessine pas sous les
//                en-têtes de piste collés à gauche ; suit la lecture (la vue
//                défile quand elle arrive à 30 px du bord droit)
//   la règle     des graduations en timecode (HH:MM:SS:FF), un pas choisi pour
//                qu'une étiquette ait 84 px au moins (de l'image à 30 min), des
//                demi-graduations au-delà de 160 px ; ne peint que ce qui se voit
//   le geste     cliquer, glisser sur la règle : la tête suit le pointeur
//                (capture du pointeur, MDN setPointerCapture), rendue à la page
//                à chaque mouvement ; le reste (molette : commun/molette.js ;
//                clavier : la page) est à la page
//
//   tete({ z })                         → le nœud de la tête (div.sr-ph > i)
//   poser(ph, x, { decal, sous })       la place (x en px du contenu ; decal :
//                                       la largeur des en-têtes ; sous : le
//                                       défilement, sous lequel elle se cache)
//   suivre(scroller, x, { tete })       défiler pour la garder en vue (lecture)
//   peindreRegle(ticks, { pps, fps, gauche, droite, classe })
//   brancherRegle(zone, { temps, aller, avant, fin })
//   tc(images, fps)                     le timecode HH:MM:SS:FF (celui du Montage)

import { el } from './shell.js';

if (typeof document !== 'undefined' && !document.querySelector('link[data-sr-tete]')) {
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./tete.css', import.meta.url).href, 'data-sr-tete': '' }));
}

const two = (n) => String(n).padStart(2, '0');
export function tc(frames, fps) {
  frames = Math.max(0, Math.floor(frames + 1e-6));
  const s = Math.floor(frames / fps), f = frames - s * fps;
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}:${two(f)}`;
}

// ── la tête ─────────────────────────────────────────────────
// `z` : son plan (au-dessus de la règle, sous les en-têtes collés) — celui de
// la timeline qui la reçoit ; 9 (le Montage) par défaut
export function tete({ z = null, cls = '' } = {}) {
  const ph = el('div', { class: 'sr-ph' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, el('i'));
  if (z !== null) ph.style.setProperty('--sr-ph-z', String(z));
  return ph;
}

// x : la place dans le contenu (px, 0 = le temps 0) ; sous les en-têtes collés
// à gauche (défilement `sous`), la tête ne se dessine pas par-dessus
export function poser(ph, x, { decal = 0, sous = null } = {}) {
  ph.style.transform = `translateX(${decal + x}px)`;
  ph.style.visibility = sous !== null && x < sous - 1 ? 'hidden' : 'visible';
  return x;
}

// pendant la lecture : la vue suit (à 30 px du bord droit, elle repart 60 px avant la tête)
export function suivre(scroller, x, { tete: hd = 0 } = {}) {
  const left = scroller.scrollLeft, w = scroller.clientWidth - hd;
  if (x > left + w - 30 || x < left) scroller.scrollLeft = Math.max(0, x - 60);
}

// ── la règle ────────────────────────────────────────────────
// les pas possibles : 1, 2, 5, 10 images, puis de la demi-seconde à 20 min
const pasDe = (fps) => [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
export function pas(fps, pps) { return pasDe(fps).find((s) => s * pps >= 84) || 1800; }

// les graduations visibles (gauche, droite : px du contenu) dans `ticks`
export function peindreRegle(ticks, { pps, fps, gauche = 0, droite = 0 }) {
  const step = pas(fps, pps);
  const from = Math.max(0, Math.floor(gauche / pps / step) - 1), to = Math.ceil(droite / pps / step) + 1;
  const out = [];
  for (let i = from; i <= to; i++) {
    const s = i * step;
    const f = Math.round(s * fps);
    const lab = step < 1 ? tc(f, fps).slice(3) : tc(f, fps).slice(s >= 3600 ? 0 : 3, 8);
    out.push(el('span', { class: 'sr-mk', style: { left: s * pps + 'px' } }, lab));
    if (step >= 1 && step * pps >= 160) out.push(el('span', { class: 'sr-mk sub', style: { left: (s + step / 2) * pps + 'px' } }));
  }
  ticks.replaceChildren(...out);
}

// ── le saut d'un média ──────────────────────────────────────
// Un saut ne s'empile jamais sur un saut en cours : pendant qu'un média
// cherche (`seeking`), la dernière demande attend, et part à `seeked` ; les
// intermédiaires sont oubliées. Mesuré le 30/09 (Chromium de DGX2, une vidéo
// 1920×1080 à 3 images clés, 90 mouvements en 1,5 s) : l'image suit le geste
// en 168 ms au milieu au lieu de 917 ms, et 14 images se voient pendant le
// geste au lieu d'aucune (chaque saut repartait de zéro et annulait le
// précédent). Rend la cible.
export function sauter(m, t) {
  if (!m.seeking) { m._srVeut = null; m.currentTime = t; return t; }
  m._srVeut = Math.abs(m.currentTime - t) < 1e-4 ? null : t;   // currentTime : la cible du saut en cours (HTML)
  if (!m._srSaut) {
    m._srSaut = true;
    m.addEventListener('seeked', () => { const w = m._srVeut; m._srVeut = null; if (w !== null && w !== undefined) m.currentTime = w; });
  }
  return t;
}
// là où le média ira : la demande qui attend, sinon sa position
export const cible = (m) => (m._srVeut !== null && m._srVeut !== undefined ? m._srVeut : m.currentTime);

// ── le geste ────────────────────────────────────────────────
// Glisser avec capture du pointeur : `move(ev)` à chaque mouvement, `up(ev)` au lâcher.
export function glisser(e, move, up = () => {}) {
  const tgt = e.currentTarget || e.target;
  try { tgt.setPointerCapture(e.pointerId); } catch { /* */ }
  const w = (tgt.ownerDocument && tgt.ownerDocument.defaultView) || window;
  const done = (ev) => {
    w.removeEventListener('pointermove', move);
    w.removeEventListener('pointerup', done);
    w.removeEventListener('pointercancel', done);
    up(ev);
  };
  w.addEventListener('pointermove', move);
  w.addEventListener('pointerup', done);
  w.addEventListener('pointercancel', done);
}

// La règle (ou toute zone) : clic = la tête y va, glisser = la tête suit.
//   temps(clientX, ev)  → ce que la page appelle la position (image, seconde, temps)
//   aller(v, ev)        la page y met la tête (et l'image)
//   avant(ev)           appelé au pointerdown ; rend false : le geste n'est pas pour la tête
//   debut(ev), fin(ev)  le début et la fin du geste (ex. : le lecteur passe sur sa copie de défilement)
export function brancherRegle(zone, { temps, aller, avant = null, debut = null, fin = null }) {
  const f = (e) => {
    if (e.button !== 0) return;
    if (avant && avant(e) === false) return;
    e.preventDefault();
    if (debut) debut(e);
    const go = (ev) => aller(temps(ev.clientX, ev), ev);
    go(e);
    glisser(e, go, (ev) => { if (fin) fin(ev); });
  };
  zone.addEventListener('pointerdown', f);
  return () => zone.removeEventListener('pointerdown', f);
}
