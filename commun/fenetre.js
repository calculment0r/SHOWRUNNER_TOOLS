// SHOWRUNNER TOOLS — détacher un panneau dans une autre fenêtre (un 2ᵉ écran).
//
// Cal, 29/09 : « il faut prévoir aussi qu'on voudra détacher des panels dans
// un deuxième écran… celui du montage vidéo par exemple. et celui du nodal
// dans ODIO ». L'étude, les sources et les limites : docs/etudes/fenetres.md.
//
// Le principe (le même que Document Picture-in-Picture, où Chrome ne permet
// que ça) : UNE page, UN état, UN moteur. La fenêtre détachée est une page
// vide du même portail (commun/fenetre.html) ouverte par window.open ; elle
// se présente à la page qui l'a ouverte (window.opener.SR_FENETRES.claim),
// qui y DÉPLACE le nœud du panneau (DOM, même origine : Node.append l'adopte).
// Le code de l'outil reste dans la page principale : ses écouteurs, son
// annulation (commun/undo.js), son son (un seul AudioContext), ses données
// suivent le nœud là où il est. Rien à synchroniser : c'est le même objet.
//
// Ce que ce module fait pour que ça tienne :
//   - les feuilles de style, le thème (<html data-theme, style>) et la classe
//     de <body> sont recopiés, et suivis (MutationObserver) ;
//   - les ancêtres du panneau sont refaits (mêmes balises, mêmes classes) :
//     les règles « .mtg .mon … » s'appliquent là-bas comme ici ;
//   - le clavier de la fenêtre est renvoyé à la page (KeyboardEvent recréé
//     sur document.body de la page ; un champ de texte garde le sien) ;
//   - un glisser commencé dans la fenêtre (bouton tenu) : ses pointermove,
//     pointerup, pointercancel aussi — les gestes qui écoutent `window` de la
//     page marchent sans rien changer (coordonnées de la fenêtre) ;
//   - avant que la fenêtre ne meure, le panneau en sort (« pagehide ») :
//     Chromium retire tous les écouteurs des nœuds d'un document qu'il détruit ;
//   - le menu commun (commun/menu.js) s'ouvre dans la fenêtre d'où vient le
//     geste : il est posé dans la page, puis déplacé avant d'être peint
//     (MutationObserver, une micro-tâche) — en attendant que menu.js prenne
//     le document de l'événement (accroche dans l'étude) ;
//   - le clic droit du navigateur y est empêché, comme dans la page (shell.js) ;
//   - fermer la fenêtre (ou la recharger) rattache le panneau à sa place ;
//     recharger la PAGE laisse la fenêtre ouverte : la page neuve la reprend ;
//   - la place de chaque fenêtre (écran, taille) est retenue par visiteur
//     (localStorage, try/catch) ; rouvrir demande un clic (un navigateur
//     n'ouvre pas de fenêtre sans geste : HTML, « transient activation »).
//
//   const F = fenetres('montage', { onchange })   une fois par page
//   F.panneau(id, { node, title })                 un panneau détachable
//   F.detacher(id) · F.rattacher(id) · F.detache(id) · F.fenetre(id)
//   F.bouton(id)            le bouton « détacher » d'un en-tête de panneau
//   F.entree(id)            l'entrée de menu (détacher / rattacher)
//   F.pastilles()           ce qui est détaché ou à rouvrir, pour la barre de l'outil
//   $, $$                   comme ceux de shell.js, mais aussi dans les fenêtres détachées
//   winOf(node)             la fenêtre d'un nœud (ses écouteurs pointermove…)
//   partout(type, fn, opt)  un écouteur sur la page ET sur chaque fenêtre détachée
//   suivreTaille(node, cb)  un ResizeObserver qui suit le nœud d'une fenêtre à l'autre
//   fenetreDuGeste()        la fenêtre du dernier geste · elementAuPoint(x, y) : elementFromPoint là

import { el, toast, TOOLS } from './shell.js';
import { closeMenus, fallbackMenu } from './menu.js';
import { boutonPleinEcran, basculer as basculerPleinEcran, estRaccourci } from './pleinecran.js';

const PAGE = new URL('./fenetre.html', import.meta.url).href;
const CSS = new URL('./fenetre.css', import.meta.url).href;
if (!document.querySelector('link[data-sr-fen]')) document.head.append(el('link', { rel: 'stylesheet', href: CSS, 'data-sr-fen': '' }));

const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sans stockage : rien de retenu */ } },
};

const panels = new Map();          // id → { id, node, title, win, state: 'attache' | 'ouverture' | 'detache', home }
let tool = '';
let onchange = () => {};
const listeners = [];              // partout()
let lastWin = window;              // la fenêtre du dernier geste (pointeur, clic droit, clavier)
let lastPoint = null;

const alive = (w) => { try { return !!(w && !w.closed && w.document); } catch { return false; } };
const here = (p) => p.win && alive(p.win) && p.node.ownerDocument === p.win.document;
const openWins = () => [...new Set([...panels.values()].filter(here).map((p) => p.win))];

// ── chercher dans la page et dans les fenêtres détachées ────
export const docs = () => [document, ...openWins().map((w) => w.document)];
export const $ = (s, r) => {
  if (r) return r.querySelector(s);
  for (const d of docs()) { const n = d.querySelector(s); if (n) return n; }
  return null;
};
export const $$ = (s, r) => (r ? [...r.querySelectorAll(s)] : docs().flatMap((d) => [...d.querySelectorAll(s)]));
export const winOf = (n) => (n && n.ownerDocument && n.ownerDocument.defaultView) || window;
// la fenêtre du dernier geste (pointeur, clic droit, clavier) : la page, ou une fenêtre détachée
export const fenetreDuGeste = () => (alive(lastWin) ? lastWin : window);
// document.elementFromPoint, dans la fenêtre du geste en cours (un glisser renvoyé d'une
// fenêtre arrive à la page avec les coordonnées de la fenêtre)
export const elementAuPoint = (x, y) => fenetreDuGeste().document.elementFromPoint(x, y);
export function partout(type, fn, opt) {
  listeners.push([type, fn, opt]);
  addEventListener(type, fn, opt);
  for (const w of openWins()) w.addEventListener(type, fn, opt);
}

// ── la place retenue ────────────────────────────────────────
const key = () => 'sr-fenetres-' + tool;
const saved = () => LS.get(key()) || {};
function remember(id, patch) {
  const all = saved();
  all[id] = { ...(all[id] || {}), ...patch };
  LS.set(key(), all);
}

// ── la page principale : ce qui la suit dans chaque fenêtre ─
const COPY_ATTRS = ['lang', 'data-theme', 'style', 'data-motion', 'data-sr-tool', 'class'];
// la classe, sans ce qui ne vaut que pour la page principale : l'attente de la porte (sr-wait) et le
// panneau Asset (sr-dock-on, sr-dock-anim… : il pousserait le corps d'une fenêtre qui n'a pas de panneau)
const pageOnly = (c) => c === 'sr-wait' || c.startsWith('sr-dock-');
function copyHtml(d) {
  const a = document.documentElement, b = d.documentElement;
  for (const n of COPY_ATTRS) {
    const v = a.getAttribute(n);
    if (v === null) b.removeAttribute(n); else b.setAttribute(n, n === 'class' ? v.split(/\s+/).filter((c) => c && !pageOnly(c)).join(' ') : v);
  }
}
const sheet = (n) => n.matches && n.matches('link[rel~="stylesheet"], style');
function copySheet(d, n) {
  const c = n.tagName === 'LINK' ? d.createElement('link') : d.createElement('style');
  if (n.tagName === 'LINK') { c.rel = 'stylesheet'; c.href = n.href; if (n.crossOrigin) c.crossOrigin = n.crossOrigin; } else c.textContent = n.textContent;
  c.dataset.srFenCopie = '';
  d.head.append(c);
}
new MutationObserver(() => { for (const w of openWins()) copyHtml(w.document); })
  .observe(document.documentElement, { attributes: true, attributeFilter: COPY_ATTRS });
new MutationObserver((recs) => {
  for (const r of recs) for (const n of r.addedNodes) if (n.nodeType === 1 && sheet(n)) for (const w of openWins()) copySheet(w.document, n);
}).observe(document.head, { childList: true });

// le menu commun, ouvert par un geste fait dans une fenêtre : il y va avant d'être peint
function clampIn(w, node, x, y) {
  const r = node.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, w.innerWidth - r.width - 8));
  const top = Math.max(8, Math.min(y, w.innerHeight - r.height - 8));
  node.style.left = left + 'px'; node.style.top = top + 'px';
}
new MutationObserver((recs) => {
  if (lastWin === window || !alive(lastWin)) return;
  for (const r of recs) for (const n of r.addedNodes) {
    if (n.nodeType !== 1 || !n.classList.contains('sr-menu')) continue;
    const x = parseFloat(n.style.left) || 0, y = parseFloat(n.style.top) || 0;
    lastWin.document.body.append(n);
    // le premier menu s'ouvre au point du clic droit ; un sous-menu garde la place calculée contre son parent
    const first = !lastWin.document.querySelector('.sr-menu:not(:last-child)') && lastPoint;
    clampIn(lastWin, n, first ? lastPoint.x : x, first ? lastPoint.y : y);
    lastPoint = null;
    n.focus({ preventScroll: true });
  }
}).observe(document.body, { childList: true });
// (un clavier renvoyé par une fenêtre n'est pas un geste fait ici : isTrusted faux)
for (const t of ['pointerdown', 'contextmenu', 'keydown']) addEventListener(t, (e) => { if (e.isTrusted) lastWin = window; }, true);

// la page s'en va (rechargée, fermée, un autre outil) : chaque fenêtre attend la suivante
addEventListener('pagehide', () => {
  for (const w of openWins()) {
    try {
      const d = w.document;
      d.body.className = 'sr-fen-attente';
      const m = d.createElement('p');
      m.className = 'sr-fen-msg';
      m.textContent = 'la page principale se recharge… le panneau revient ici';
      d.body.replaceChildren(m);
    } catch { /* fermée entre-temps */ }
  }
});

// ── une fenêtre se présente (commun/fenetre.html) ───────────
// Un document de fenêtre qui s'en va ne se reprend plus. Mesuré le 29/09 : entre son
// « pagehide » et sa destruction, la fenêtre pouvait encore se présenter (son minuteur)
// et reprendre le panneau ; Chromium, en détruisant le document, retire alors TOUS les
// écouteurs des nœuds qui s'y trouvent (sonde fen_ecouteurs.mjs : 0 clic reçu sur un
// bouton fermé avec sa fenêtre, 1 s'il en est sorti dans « pagehide ») — le panneau
// revenait mort. On retient le DOCUMENT (une fenêtre rechargée en a un neuf, qui, lui,
// peut reprendre le panneau).
const leaving = new WeakSet();
function claim(w, k) {
  const [t, id] = String(k || '').split(':');
  if (t !== tool) return false;
  try { if (leaving.has(w.document)) return false; } catch { return false; }
  const p = panels.get(id);
  if (!p) return false;
  if (p.win === w && here(p)) return true;
  if (p.state === 'detache' && here(p) && p.win !== w) return false;   // déjà dans une autre fenêtre
  install(p, w);
  return true;
}
const owns = (w) => [...panels.values()].some((p) => p.win === w && here(p));

// ── suivre la taille d'un nœud, où qu'il soit ───────────────
// Mesuré (fen_pilote.mjs, F1) : un ResizeObserver créé par la PAGE, sur un
// nœud posé dans la fenêtre, est prévenu une fois ou pas du tout, jamais des
// changements suivants (Chrome rassemble ses observations au rendu du
// document de l'observateur). Celui de la FENÊTRE du nœud les voit tous. On
// le refait donc dans la fenêtre où est le nœud, à chaque départ et retour.
const tailles = new Set();
function observeTaille(t) {
  if (t.ro) t.ro.disconnect();
  const W = winOf(t.node);
  t.ro = new W.ResizeObserver((es) => t.cb(es));
  t.ro.observe(t.node);
}
export function suivreTaille(node, cb) {
  const t = { node, cb, ro: null };
  tailles.add(t);
  observeTaille(t);
  return () => { if (t.ro) t.ro.disconnect(); tailles.delete(t); };
}
// une fenêtre détachée encore visible garde la page « visible » : ses relevés (commun/shell.js, ongletCache)
// continuent pour le panneau qu'on regarde sur l'autre écran, même la page cachée derrière
const visible = () => openWins().some((w) => { try { return !w.document.hidden; } catch { return false; } });
const direVisibilite = () => document.dispatchEvent(new Event('sr:visibilite'));
window.SR_FENETRES = { claim, owns, suivreTaille, visible };

function ancestors(node) {
  const out = [];
  for (let n = node.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) out.unshift(n);
  return out;
}

// <body> : sa classe et ses data-* (une feuille peut en dépendre), plus ce que le panneau impose (`corps`)
function copyBody(d, p) {
  const b = d.body;
  for (const a of [...b.attributes]) if (a.name.startsWith('data-')) b.removeAttribute(a.name);
  for (const a of [...document.body.attributes]) if (a.name.startsWith('data-')) b.setAttribute(a.name, a.value);
  b.className = document.body.className + ' sr-fen';
  for (const [k, v] of Object.entries(p.corps || {})) b.setAttribute(k, v);
}
new MutationObserver(() => { for (const p of panels.values()) if (here(p)) copyBody(p.win.document, p); })
  .observe(document.body, { attributes: true });

function install(p, w) {
  const d = w.document;
  let chain;
  if (p.dans) {
    // un panneau « libre » (une vue qui n'a pas de place fixe, le nodal d'ODIO) :
    // ses ancêtres sont ceux de `dans`, `dans` compris ; revenu, l'outil le repose lui-même
    if (p.node.ownerDocument !== document && !here(p)) return;
    chain = [...ancestors(p.dans), p.dans];
  } else {
    // la place d'origine : un repère invisible, là où le panneau reviendra
    if (!p.home || !p.home.isConnected) {
      if (p.node.ownerDocument !== document || !p.node.parentNode) return;   // (déjà ailleurs, ou hors de la page)
      p.home = document.createComment(' panneau ' + p.id + ' : dans une fenêtre ');
      p.node.before(p.home);
    }
    chain = ancestors(p.home);
  }
  // la tête : les feuilles de la page, dans l'ordre, puis celle-ci
  for (const n of d.head.querySelectorAll('[data-sr-fen-copie]')) n.remove();
  for (const n of document.head.children) if (sheet(n)) copySheet(d, n);
  copyHtml(d);
  d.title = `${p.title} · ${document.title}`;
  copyBody(d, p);
  // la barre de la fenêtre : ce qu'elle montre, le plein écran, rattacher
  const bar = el('div', { class: 'sr-fen-bar' },
    el('span', { class: 'k' }, `${(TOOLS.find((x) => x.id === tool) || {}).name || tool} · ${p.title}`),
    el('span', { class: 'sp' }),
    boutonPleinEcran(d, el, { cls: 'tb ghost sm sr-fen-full' }),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'remettre le panneau dans la page · fermer cette fenêtre', onclick: () => rattacher(p.id) }, 'Rattacher'));
  // les ancêtres refaits (mêmes balises, mêmes classes), le panneau au fond
  let slot = d.createElement('div');
  slot.className = 'sr-fen-host';
  const top = slot;
  for (const a of chain) {
    const c = d.createElement(a.tagName.toLowerCase());
    if (a.className) c.className = a.className;
    c.classList.add('sr-fen-a');
    slot.append(c);
    slot = c;
  }
  d.body.replaceChildren(bar, top);
  p.node.dataset.srFen = p.id;
  slot.append(p.node);                  // adopté par le document de la fenêtre (DOM, « adopt »)
  p.win = w;
  p.state = 'detache';
  bridge(p, w);
  remember(p.id, { open: true });
  changed();
}

// les gestes de la fenêtre : clavier, clic droit, menus, fermeture, place
// Une fois par document de fenêtre ET par chargement de la page : la page rechargée pose
// les siens (ceux de l'ancienne page sont morts avec elle — essai du 29/09 : sans ce jeton,
// fermer la fenêtre après un rechargement de la page perdait le panneau).
const TOKEN = Math.random().toString(36).slice(2);
function bridge(p, w) {
  if (w.__srFen === TOKEN) return;
  w.__srFen = TOKEN;
  const d = w.document;
  for (const [t, fn, opt] of listeners) w.addEventListener(t, fn, opt);
  d.addEventListener('visibilitychange', direVisibilite);
  const mark = (e) => { lastWin = w; if (e.type === 'contextmenu') lastPoint = { x: e.clientX, y: e.clientY }; };
  for (const t of ['pointerdown', 'contextmenu', 'keydown']) w.addEventListener(t, mark, true);
  // un clic hors du menu le ferme (menu.js n'écoute que la page)
  w.addEventListener('pointerdown', (e) => {
    if (!d.querySelector('.sr-menu')) return;
    if (e.target.closest && e.target.closest('.sr-menu, .sr-kebab[aria-expanded="true"]')) return;
    closeMenus();
  }, true);
  // le clic droit : jamais celui du navigateur (shell.js) ; personne ne l'a pris : le menu de repli
  w.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (t && t.closest && (t.closest('[data-native-menu], input, textarea, [contenteditable]'))) return;
    if (e.defaultPrevented) return;
    e.preventDefault();
    lastWin = w;
    lastPoint = { x: e.clientX, y: e.clientY };
    fallbackMenu(e, e.clientX, e.clientY, false);
  });
  // le clavier : renvoyé à la page, sauf dans un champ ; Ctrl+Maj+F : le plein écran de CETTE fenêtre
  const fwd = (e) => {
    if (e.type === 'keydown' && estRaccourci(e)) { e.preventDefault(); if (!e.repeat) basculerPleinEcran(d); return; }
    const t = e.target;
    if (t && t.closest && t.closest('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable]')) return;
    // Espace sur un bouton qui a gardé le focus : c'est la lecture, pas un clic (comme montage.js)
    if (e.key === ' ' && t && t.matches && t.matches('button, input[type=range]')) t.blur();
    const K = window.KeyboardEvent;
    const f = new K(e.type, { key: e.key, code: e.code, location: e.location, repeat: e.repeat, isComposing: e.isComposing,
      ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true, composed: true });
    document.body.dispatchEvent(f);
    if (f.defaultPrevented) e.preventDefault();
  };
  w.addEventListener('keydown', fwd);
  w.addEventListener('keyup', fwd);
  // Les gestes : un glisser commencé dans la fenêtre (bouton enfoncé) est suivi par des
  // écouteurs posés sur la PAGE (`addEventListener('pointermove', …)` sur window, le
  // cas de la plupart des gestes des outils : machines/interaction/drag.js, banc.js…).
  // Ses pointermove (bouton tenu), pointerup et pointercancel sont donc aussi recréés
  // sur document.body de la page, aux coordonnées de la fenêtre — celles des nœuds
  // qu'on y mesure. Le survol sans bouton ne traverse pas.
  const fwdPtr = (e) => {
    if (e.type === 'pointermove' && !e.buttons) return;
    const P = window.PointerEvent;
    const f = new P(e.type, { bubbles: true, cancelable: true, composed: true,
      clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, movementX: e.movementX, movementY: e.movementY,
      button: e.button, buttons: e.buttons, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, pressure: e.pressure,
      width: e.width, height: e.height, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey });
    document.body.dispatchEvent(f);
  };
  for (const t of ['pointermove', 'pointerup', 'pointercancel']) w.addEventListener(t, fwdPtr, true);
  // fermée ou rechargée : le panneau revient à sa place tout de suite ; rechargée, elle le reprendra
  w.addEventListener('pagehide', () => {
    leaving.add(d);
    for (const q of panels.values()) if (q.win === w) { try { back(q, 'reload'); } catch (e) { console.error('fenêtre : retour du panneau', e); } }
    setTimeout(() => { if (!alive(w)) recover(w); else changed(); }, 400);
  });
  // Un relevé tous les quarts de seconde. Fermée sans que « pagehide » soit passé
  // par nous (essai du 29/09 : une fois sur trois, le panneau n'était pas revenu
  // 0,9 s après la fermeture par playwright) : le panneau revient quand même. Et la place
  // de la fenêtre, chaque seconde (aucun événement « déplacée » : on la relève).
  let n = 0;
  const place = () => { for (const q of panels.values()) if (q.win === w && here(q)) remember(q.id, { x: w.screenX, y: w.screenY, w: w.innerWidth, h: w.innerHeight }); };
  const spot = () => {
    if (!alive(w)) { clearInterval(tk); recover(w); return; }
    if (++n % 4 === 0) place();
  };
  const tk = setInterval(spot, 250);
  w.addEventListener('resize', place);
}

// une fenêtre fermée : chacun de ses panneaux revient (même si « pagehide » n'a rien pu faire)
function recover(w) {
  let any = false;
  for (const q of panels.values()) {
    if (q.win !== w) continue;
    try { back(q); } catch (e) { console.error('fenêtre : retour du panneau', e); }
    q.win = null; q.state = 'attache';
    remember(q.id, { open: false });
    any = true;
  }
  if (any) changed();
}

// remettre le nœud à sa place dans la page
function back(p, why = 'attach') {
  if (p.home && p.home.isConnected && p.node.ownerDocument !== document) {
    delete p.node.dataset.srFen;
    p.home.replaceWith(document.adoptNode(p.node));   // adopté de nouveau par la page
    p.home = null;
  } else if (p.dans && p.node.ownerDocument !== document) {
    delete p.node.dataset.srFen;
    document.adoptNode(p.node);         // hors de la fenêtre, à la page ; l'outil le repose (onchange)
  }
  if (why !== 'reload') { p.state = 'attache'; }
  changed();
}

function changed() {
  for (const t of tailles) { try { observeTaille(t); } catch { /* fenêtre fermée : au prochain changement */ } }
  direVisibilite();   // une fenêtre de plus ou de moins : la page est-elle encore vue ?
  try { onchange(); } catch (e) { console.error(e); }
  for (const b of pills) b();
}

// ── ouvrir ──────────────────────────────────────────────────
// La place : celle retenue (x, y, taille) ; sinon à droite de la page. Sans la
// permission « window-management » (et hors contexte sûr : http sur le réseau
// local), Chrome ramène la fenêtre sur l'écran de la page (spécification Window
// Management, « clamped to the current screen ») : on la glisse une fois sur le
// 2ᵉ écran, elle y est retenue pour la suite là où le navigateur le permet.
function features(id) {
  const g = saved()[id] || {};
  const w = Math.round(g.w || 960), h = Math.round(g.h || 600);
  const x = g.x !== undefined ? g.x : window.screenX + window.outerWidth - Math.min(w, 480);
  const y = g.y !== undefined ? g.y : window.screenY + 80;
  return `popup=yes,width=${w},height=${h},left=${Math.round(x)},top=${Math.round(y)}`;
}

// un autre écran : Window Management API (Chrome, Edge ; contexte sûr seulement —
// https, ou localhost). La permission demandée une fois (« window-management ») ;
// refusée, ou un seul écran (screen.isExtended faux) : rien.
async function otherScreen() {
  try {
    if (!window.getScreenDetails || !window.isSecureContext) return null;
    const st = await navigator.permissions.query({ name: 'window-management' });
    if (st.state === 'denied' || (st.state === 'prompt' && !screen.isExtended)) return null;
    const sd = await window.getScreenDetails();
    return sd.screens.find((s) => s !== sd.currentScreen) || null;
  } catch { return null; }
}

function detacher(id) {
  const p = panels.get(id);
  if (!p) return null;
  if (here(p)) { try { p.win.focus(); } catch { /* */ } return p.win; }
  const hadPlace = !!(saved()[id] || {}).x;
  // tout de suite, dans le geste (window.open demande une activation de l'utilisateur)
  const w = window.open(PAGE + '?k=' + encodeURIComponent(tool + ':' + id), 'sr-fen-' + tool + '-' + id, features(id));
  if (!w) {
    toast('le navigateur a bloqué la fenêtre : autorisez les fenêtres pop-up pour ce portail (icône dans la barre d’adresse), puis recommencez', 7000);
    return null;
  }
  p.win = w;
  p.state = 'ouverture';
  changed();
  // la première fois, et si le navigateur le permet déjà : sur l'autre écran, en grand
  if (!hadPlace) otherScreen().then((s) => {
    if (!s || !alive(w)) return;
    try { w.moveTo(s.availLeft, s.availTop); w.resizeTo(s.availWidth, s.availHeight); } catch { /* */ }
  });
  return w;
}

function rattacher(id) {
  const p = panels.get(id);
  if (!p) return;
  const w = p.win;
  back(p);
  p.win = null;
  remember(id, { open: false });
  if (alive(w) && !openWinsWith(w)) { try { w.close(); } catch { /* */ } }
  changed();
}
const openWinsWith = (w) => [...panels.values()].some((q) => q.win === w && here(q));

// ── l'outil ─────────────────────────────────────────────────
const pills = new Set();
const court = (t) => String(t || '').split(' · ')[0];   // « Source · Effets » → « Source » : la barre reste sur une ligne
export function fenetres(toolId, { onchange: cb } = {}) {
  tool = toolId;
  if (cb) onchange = cb;
  return {
    // `dans` : pour une vue sans place fixe (le nodal d'ODIO, qui partage sa boîte
    // avec l'arrangement) — les ancêtres à refaire ; l'outil la repose au retour.
    // `corps` : des attributs de <body> à imposer dans la fenêtre ({ 'data-view': 'nodal' }).
    // Déclaré de nouveau avec un autre nœud (ODIO refait ses vues à chaque projet) : s'il est
    // dans sa fenêtre, le nouveau y prend la place de l'ancien — la fenêtre reste ouverte.
    panneau(id, { node, title, dans = null, corps = null }) {
      const old = panels.get(id);
      if (old) {
        if (here(old) && old.node !== node) {
          node.dataset.srFen = id;
          old.node.replaceWith(node);
          delete old.node.dataset.srFen;
        }
        Object.assign(old, { node, title, dans, corps });
        return;
      }
      panels.set(id, { id, node, title, dans, corps, win: null, state: 'attache', home: null });
    },
    detacher, rattacher,
    detache: (id) => { const p = panels.get(id); return !!(p && here(p)); },
    fenetre: (id) => { const p = panels.get(id); return p && here(p) ? p.win : null; },
    ids: () => [...panels.keys()],
    // pour les essais et le débogage : l'état de chaque panneau
    etat: () => [...panels.values()].map((p) => ({ id: p.id, state: p.state, here: here(p), win: !!p.win, alive: alive(p.win),
      home: !!(p.home && p.home.isConnected), doc: p.node.ownerDocument === document ? 'page' : 'fenêtre', connected: p.node.isConnected })),
    // le bouton d'un en-tête de panneau (caché dans la fenêtre : sa barre a « Rattacher »)
    bouton(id) {
      const p = panels.get(id);
      return el('button', { class: 'sr-fen-b', type: 'button', title: `détacher « ${p ? p.title : id} » dans une fenêtre (un 2ᵉ écran)`, 'aria-label': 'détacher dans une fenêtre',
        html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4h7v7M20 4l-8.5 8.5M18 14v6H4V6h6"/></svg>',
        onclick: (e) => { e.stopPropagation(); detacher(id); } });
    },
    entree(id) {
      const p = panels.get(id);
      const on = !!(p && here(p));
      return on ? { label: `Rattacher « ${p.title} » à la page`, icon: '⤓', onclick: () => rattacher(id) }
        : { label: `Détacher « ${p ? p.title : id} » dans une fenêtre`, icon: '↗', sub: '2ᵉ écran', onclick: () => detacher(id) };
    },
    // les pastilles de la barre : un panneau détaché (clic : montrer sa fenêtre), ou à rouvrir (clic : le rouvrir là où il était)
    pastilles() {
      const box = el('span', { class: 'sr-fen-pills', role: 'group', 'aria-label': 'les panneaux dans une fenêtre' });
      const t0 = Date.now();
      const paint = () => {
        const kids = [];
        for (const p of panels.values()) {
          if (here(p) || p.state === 'ouverture') {
            kids.push(el('button', { class: 'tb ghost sm sr-fen-pill on', type: 'button', title: `« ${p.title} » est dans sa fenêtre · clic : la montrer · clic droit : rattacher`,
              onclick: () => { try { p.win.focus(); } catch { /* */ } },
              oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); rattacher(p.id); } }, `↗ ${court(p.title)}`));
          } else if ((saved()[p.id] || {}).open && Date.now() - t0 > 2500) {
            // la page a été rechargée sans sa fenêtre : la rouvrir demande un clic (bloqueur de fenêtres)
            kids.push(el('button', { class: 'tb ghost sm sr-fen-pill', type: 'button', title: `rouvrir « ${p.title} » dans sa fenêtre, à sa place`,
              onclick: () => detacher(p.id) }, `rouvrir ${court(p.title)}`),
            el('button', { class: 'tb ghost sm sr-fen-pill x', type: 'button', title: 'laisser dans la page', 'aria-label': 'laisser dans la page',
              onclick: () => { remember(p.id, { open: false }); paint(); } }, '×'));
          }
        }
        box.replaceChildren(...kids);
        box.hidden = !kids.length;
      };
      pills.add(paint);
      setTimeout(paint, 2600);
      paint();
      return box;
    },
  };
}
