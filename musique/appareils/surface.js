// ODIO — les appareils : ce que toutes les surfaces partagent.
//
//   ecran()     l'écran encastré (fond --bg, coins, filet) et son SVG, à la
//               taille de ses pixels (le texte reste net) ; ses couches
//               (grille, spectre, courbes, points, texte)
//   gestes()    les gestes d'une surface : attraper ce qui est sous le
//               pointeur, le tirer (Maj : fin, au cinquième), Alt+tirer,
//               la molette sur une poignée, le double-clic (réinitialiser),
//               le survol ; le clavier (flèches, Maj : fin)
//   liaison()   un réglage du module, tenu à la fois par la surface et par
//               sa molette : l'un bouge, l'autre suit ; chaque geste passe
//               par app.commit (le moteur suit pendant le geste, l'annulation
//               prend le geste entier une fois lâché — musique.js, hist)
//
// Aucune couleur ici : les classes de appareils.css, sur les jetons de
// commun/tokens.css ; l'accent est --k (la couleur de la piste).

import { MODULES, spec, val, fmt, toNorm, fromNorm } from '../modules.js';
import { el, knob, clamp } from '../ui.js';

const NS = 'http://www.w3.org/2000/svg';
// un élément SVG : s('path', { class: 'ap-courbe', d })
export function s(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
// un tracé : une liste de points [x, y] → « M… L… », arrondis au dixième
export const trace = (pts) => (pts.length ? `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')}` : '');

// ── l'écran ─────────────────────────────────────────────────
export function ecran(w, h, cls = '') {
  const svg = s('svg', { class: 'ap-svg', width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' });
  const couche = (c) => { const g = s('g', { class: c }); svg.append(g); return g; };
  const c = {
    grille: couche('ap-grille'), spectre: couche('ap-spectre-c'), courbes: couche('ap-courbes'),
    points: couche('ap-points'), texte: couche('ap-texte'),
  };
  const box = el('div', { class: `ap-ecran ${cls}`, style: { width: `${w}px`, height: `${h}px` } }, svg);
  // la position du pointeur en unités du SVG (la taille de l'interface pose un zoom CSS sur <html>)
  const pos = (e) => {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (w / Math.max(1, r.width)), y: (e.clientY - r.top) * (h / Math.max(1, r.height)) };
  };
  return { box, svg, w, h, c, pos };
}

// Une étiquette de repère, en mono (les capitales sont pour la machine)
export const etiquette = (x, y, texte, cls = '', ancre = 'start') => s('text', { class: `ap-et ${cls}`, x, y, 'text-anchor': ancre }, texte);
// un trait de grille, net au pixel
export function trait(x1, y1, x2, y2, cls = '') {
  const r = (v) => Math.round(v) + 0.5;
  return s('line', { class: cls, x1: x1 === x2 ? r(x1) : x1, x2: x1 === x2 ? r(x2) : x2, y1: y1 === y2 ? r(y1) : y1, y2: y1 === y2 ? r(y2) : y2 });
}

// Une poignée : un rond, son halo (survol, prise), son numéro ou sa lettre.
export function poignee(id, texte = '') {
  const g = s('g', { class: 'ap-pt', 'data-pt': id });
  const halo = s('circle', { class: 'halo', r: 13 });
  const rond = s('circle', { class: 'c', r: 7.5 });
  const t = s('text', { class: 'n', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, texte);
  g.append(halo, rond, t);
  g.poser = (x, y) => { g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`); g.px = x; g.py = y; };
  return g;
}

// la poignée la plus proche du pointeur, dans un rayon : [[id, poignée], …] → id | null
// (deux poignées qui se chevauchent : la plus proche gagne, jamais la première de la liste)
export function plusProche(p, liste, rayon = 12) {
  let best = null, dmin = rayon;
  for (const [id, q] of liste) {
    if (q.style?.display === 'none' || q.px === undefined) continue;
    const d = Math.hypot(q.px - p.x, q.py - p.y);
    if (d < dmin) { dmin = d; best = id; }
  }
  return best;
}

// ── les gestes ──────────────────────────────────────────────
// gestes(ecran, {
//   trouver(p) → cible | null       ce qui est sous le pointeur (p : {x, y})
//   debut(cible, p, e)              prise
//   tire(cible, d, p, e)            d : { dx, dy } depuis le dernier pas,
//                                   déjà divisé par 5 sous Maj (réglage fin)
//   fin(cible)                      lâché (le geste s'enregistre)
//   molette(cible, sens, e)         sens : +1 vers le haut, −1 vers le bas
//   double(cible, e)                double-clic
//   survol(cible | null)
//   clavier(cible, touche, e)       une flèche sur la surface (focus)
// })
// Rien ne part sans cible : un glisser à vide laisse la page tranquille, et
// la molette hors d'une poignée fait défiler le panneau.
export function gestes(E, f) {
  const { svg } = E;
  let prise = null, dernier = null, survolee = null;
  const survol = (c) => { if (c !== survolee) { survolee = c; f.survol?.(c); } };
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const p = E.pos(e), c = f.trouver(p);
    if (!c) return;
    e.preventDefault(); e.stopPropagation();
    svg.setPointerCapture(e.pointerId);
    prise = c; dernier = p;
    svg.classList.add('tire');
    f.debut?.(c, p, e);
  });
  svg.addEventListener('pointermove', (e) => {
    const p = E.pos(e);
    if (!prise) { const c = f.trouver(p); survol(c); svg.style.cursor = c ? (c.curseur || 'grab') : ''; return; }
    const k = e.shiftKey ? 0.2 : 1;
    const d = { dx: (p.x - dernier.x) * k, dy: (p.y - dernier.y) * k };
    dernier = p;
    f.tire?.(prise, d, p, e);
  });
  const lache = () => {
    if (!prise) return;
    const c = prise;
    prise = null;
    svg.classList.remove('tire');
    f.fin?.(c);
  };
  svg.addEventListener('pointerup', lache);
  svg.addEventListener('pointercancel', lache);
  svg.addEventListener('pointerleave', () => { if (!prise) { survol(null); svg.style.cursor = ''; } });
  svg.addEventListener('dblclick', (e) => {
    const c = f.trouver(E.pos(e));
    if (!c || !f.double) return;
    e.preventDefault(); e.stopPropagation();
    f.double(c, e);
  });
  // la molette sur une poignée : son Q (ou ce que la surface lui donne) ;
  // ailleurs, rien n'est retenu — le panneau défile
  svg.addEventListener('wheel', (e) => {
    if (!f.molette) return;
    const c = f.trouver(E.pos(e));
    if (!c) return;
    e.preventDefault(); e.stopPropagation();
    f.molette(c, e.deltaY < 0 ? 1 : -1, e);
  }, { passive: false });
  // le clavier : la surface prend le focus (tabindex) ; flèches sur la cible choisie
  svg.setAttribute('tabindex', '0');
  svg.addEventListener('keydown', (e) => {
    if (!f.clavier || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    f.clavier(e.key, e);
  });
  return { prise: () => prise };
}

// ── la liaison d'un module à sa surface et à ses molettes ───
// liaison(app, m, repeindre) — repeindre : la surface à redessiner :
//   get(k)                   la valeur (le défaut s'il n'est pas posé)
//   pose(k, v)               pendant un geste : le module change, le moteur
//                            suit (commit 'param'), la molette et la surface aussi
//   fin()                    le geste lâché : il s'enregistre (commit 'quiet')
//   norm(k) / deNorm(k, n)   la valeur sur 0..1 (l'échelle de la molette)
//   molette(k, opts)         la molette du réglage, liée
//   texte(k)                 la valeur lue, avec son unité
//   ecoute(fn)               une autre surface du même module suit aussi
//                            (le filtre et l'enveloppe d'un synthé, ses molettes)
export function liaison(app, m, premier = null) {
  const molettes = new Map();
  const ecouteurs = premier ? [premier] : [];
  const repeindre = () => { for (const f of ecouteurs) f(); };
  const get = (k) => val(m, k);
  const sp = (k) => spec(m.type, k);
  const borne = (k, v) => {
    const s1 = sp(k);
    let x = clamp(v, s1.min, s1.max);
    if (s1.opts) x = Math.round(x);
    else if (s1.step) x = Math.round(x / s1.step) * s1.step;
    return x;
  };
  const pose = (k, v, sans = false) => {
    const x = borne(k, v);
    if (x === get(k) && m.params?.[k] !== undefined) return;
    m.params = m.params || {};
    m.params[k] = x;
    app.commit('param', m);
    molettes.get(k)?.setValue?.(x);
    if (!sans) repeindre();
  };
  const fin = () => app.commit('quiet');
  const molette = (k, { accent = 'cy', size = 'sm', label } = {}) => {
    const kb = knob(sp(k), get(k), { accent, size, label: label || sp(k).label,
      onInput: (v) => { m.params = m.params || {}; m.params[k] = v; app.commit('param', m); repeindre(); },
      onChange: () => app.commit('quiet') });
    molettes.set(k, kb);
    return kb;
  };
  const texte = (k) => {
    const s1 = sp(k), v = get(k);
    if (s1.opts) return fmt(s1, v);
    // fmt écrit « 1.2 k » au-delà du kilohertz : l'unité complète ici
    if (s1.unit === 'Hz') return v >= 1000 ? `${fmt(s1, v).replace(/\s*k$/, '')} kHz` : `${fmt(s1, v)} Hz`;
    const u = s1.unit === 's' || s1.unit === 'Q' ? '' : s1.unit || '';
    return u === ':1' ? `${fmt(s1, v)}:1` : `${fmt(s1, v)}${u ? ` ${u}` : ''}`;
  };
  return {
    m, get, pose, fin, molette, texte, sp,
    ecoute: (f) => { ecouteurs.push(f); },
    norm: (k) => toNorm(sp(k), get(k)), deNorm: (k, n) => fromNorm(sp(k), n),
    rafraichir: () => { for (const [k, kb] of molettes) kb.setValue?.(get(k)); },
    defaut: (k) => sp(k).def,
    a: (k) => !!MODULES[m.type].params.find((p) => p.k === k),
  };
}

// Un petit sélecteur (type de filtre, bande) : des boutons .tb, celui posé allumé.
export function selecteur(libelles, actif, choisir, { titre = '', cls = '' } = {}) {
  const box = el('div', { class: `seg ap-seg ${cls}`, role: 'radiogroup', 'aria-label': titre });
  const boutons = libelles.map((l, i) => el('button', { class: 'tb', type: 'button', onclick: () => { peindre(i); choisir(i); } }, l));
  const peindre = (i) => boutons.forEach((b, j) => b.classList.toggle('on', j === i));
  box.append(...boutons);
  peindre(actif);
  box.peindre = peindre;
  return box;
}

// Un choix lié (temps du délai, forme d'onde…) : le sélecteur des molettes
// d'ODIO (ui.js choice, .mu-choice), tenu par la liaison. `dessin(i, libellé)`
// → un SVG à la place du libellé (la forme d'une onde, d'un filtre), le
// libellé restant au survol.
export function choixLie(L, k, { dessin = null, apres = () => {} } = {}) {
  const sp = L.sp(k);
  const seg = el('div', { class: 'seg mu-seg', role: 'radiogroup', 'aria-label': sp.label });
  const peindre = () => [...seg.children].forEach((b, i) => b.classList.toggle('on', i === Math.round(L.get(k))));
  sp.opts.forEach((o, i) => {
    const d = dessin?.(i, o);
    seg.append(el('button', { class: `tb${d ? ' ap-ic' : ''}`, type: 'button', title: o, 'aria-label': o, onclick: () => { L.pose(k, i); L.fin(); peindre(); apres(i); } }, d || o));
  });
  peindre();
  const box = el('div', { class: 'mu-choice ap-choix' }, el('span', { class: 'lbl' }, sp.label), seg);
  box.peindre = peindre;
  return box;
}

// la forme d'une onde en petit (26 × 12), d'après son nom français
export function iconeOnde(nom) {
  const n = (nom || '').toLowerCase();
  const f = n.startsWith('sin') ? (p) => Math.sin(p) : n.startsWith('tri') ? (p) => (2 / Math.PI) * Math.asin(Math.sin(p))
    : n.includes('scie') ? (p) => 2 * (((p / (2 * Math.PI)) + 0.5) % 1) - 1 : n.startsWith('carr') ? (p) => (Math.sin(p) >= 0 ? 1 : -1) : null;
  if (!f) return null;
  const pts = [];
  for (let i = 0; i <= 52; i++) { const p = (i / 52) * 4 * Math.PI; pts.push([i / 2, 6 - f(p) * 4.5]); }
  return s('svg', { class: 'ap-icone', width: 26, height: 12, viewBox: '0 0 26 12', 'aria-hidden': 'true' }, s('path', { d: trace(pts) }));
}

// le mode réglage fin, dit une fois sous chaque surface
export const AIDE = 'glisser · Maj : fin · double-clic : défaut';
