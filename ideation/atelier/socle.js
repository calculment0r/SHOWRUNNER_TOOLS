// IDÉATION · ATELIER — le socle des modules d'atelier (présentation par
// cadres, vote par points, projecteur, minuteur, machine temporelle, palette
// de commandes, vues ancrées). Repris du prototype de Cal (atelier-canvas,
// 29/09) ; l'inventaire : docs/etudes/ideation_atelier.md.
//
// Chaque module est greffé par ideation/plugins.js (install(app)) et passe
// par `atelier(app)`, qui tient une fois pour toutes :
//   - la feuille atelier.css ;
//   - la caméra : `fly(vue)` anime `app.S.view` puis `app.canvas.applyView()`
//     (le canvas n'expose pas de vol : il faudrait `canvas.flyTo`, voir l'étude),
//     `viewFor(rect)`, `toView({cx, cy, z})`, `current()` ;
//   - le groupe de boutons « atelier » de la barre (`button`), le coin haut
//     droit de la planche (`corner`), les panneaux qui ne laissent pas passer
//     les gestes jusqu'à la planche (`panel`), le calque qui la fige (`shield`) ;
//   - UN clavier, en capture avant celui de la planche (`key(priorité, fn)` :
//     fn rend true s'il a pris la touche, la planche ne la voit pas) ;
//   - les commandes que la palette ⌘K propose (`command`) ;
//   - les feuilles de style vivantes (`style(nom)`) : éclairer des objets par
//     leur data-id survit aux objets que le canvas refait.

import { el } from '../../commun/shell.js';
import { menu } from '../../commun/menu.js';

const NS = 'http://www.w3.org/2000/svg';
const ZMIN = 0.08, ZMAX = 4;   // les bornes du zoom du canvas (canvas.js)
export const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export const MOD = MAC ? '⌘' : 'ctrl+';
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// un objet dont le centre est dans le cadre en fait partie (le compte du prototype)
export const within = (n, f) => {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  return n !== f && cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h;
};
export const inside = (n, f) => n !== f && n.x >= f.x && n.y >= f.y && n.x + n.w <= f.x + f.w && n.y + n.h <= f.y + f.h;
export function bbox(list) {
  if (!list.length) return null;
  const x0 = Math.min(...list.map((n) => n.x)), y0 = Math.min(...list.map((n) => n.y));
  const x1 = Math.max(...list.map((n) => n.x + n.w)), y1 = Math.max(...list.map((n) => n.y + n.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export const typing = (t) => !!t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
// une boîte modale, un menu ouvert : ils ont la main sur le clavier
export const overlayOpen = () => !!document.querySelector('.scrim, .sr-menu, .ide-menu');
export const q = (id) => `"${String(id).replace(/["\\]/g, '\\$&')}"`;

export function icon(d) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}

// l'ordre de lecture des cadres : par rangées (un cadre dont le haut passe
// sous le milieu du premier de la rangée en ouvre une autre), de gauche à droite
export function readingOrder(frames) {
  const rows = [];
  for (const f of [...frames].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows[rows.length - 1];
    if (row && f.y < row.top + row.h / 2) row.items.push(f);
    else rows.push({ top: f.y, h: f.h, items: [f] });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => a.x - b.x));
}

// les heures dites en clair
export const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 5) return 'à l’instant';
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return `il y a ${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
}

let A = null;

export function atelier(app) {
  if (A) return A;
  const { S } = app;
  if (!document.querySelector('link[data-atelier]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: new URL('./atelier.css', import.meta.url).href, 'data-atelier': '' }));
  }
  const cv = app.canvas?.el || document.getElementById('cv');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  // ── la caméra ────────────────────────────────────────────
  const dims = () => [cv.clientWidth || 1, cv.clientHeight || 1];
  const apply = () => { if (app.canvas.applyView) app.canvas.applyView(); else app.canvas.render(); };
  function setView(v) { Object.assign(S.view, { x: v.x, y: v.y, z: v.z }); apply(); }
  // le point du monde au centre de l'écran, et le zoom
  function current() {
    const [W, H] = dims(), v = S.view;
    return { cx: (W / 2 - v.x) / v.z, cy: (H / 2 - v.y) / v.z, z: v.z };
  }
  function toView(c) {
    const [W, H] = dims();
    const z = clamp(c.z, ZMIN, ZMAX);
    return { x: W / 2 - c.cx * z, y: H / 2 - c.cy * z, z };
  }
  // la vue qui montre `r` en entier dans la planche, marges comprises (px d'écran)
  function viewFor(r, { pad = 60, zmax = 1.25 } = {}) {
    const [W, H] = dims();
    const p = typeof pad === 'number' ? { t: pad, r: pad, b: pad, l: pad } : pad;
    const aw = Math.max(40, W - p.l - p.r), ah = Math.max(40, H - p.t - p.b);
    const z = clamp(Math.min(aw / Math.max(r.w, 1), ah / Math.max(r.h, 1)), ZMIN, Math.min(zmax, ZMAX));
    const sx = p.l + aw / 2, sy = p.t + ah / 2;
    return { x: sx - (r.x + r.w / 2) * z, y: sy - (r.y + r.h / 2) * z, z };
  }
  function zoomAt(nz, sx, sy) {
    const v = S.view, k = clamp(nz, ZMIN, ZMAX) / v.z;
    setView({ x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k, z: v.z * k });
  }
  // le vol : le centre glisse en ligne droite dans le monde, le zoom en
  // logarithme ; loin, la caméra prend de la hauteur au milieu du trajet
  let flight = 0, flightSoft = true;
  function cancel() { cancelAnimationFrame(flight); flight = 0; }
  function fly(to, { ms = 560, hard = false } = {}) {
    cancel();
    const [W, H] = dims(), v = S.view;
    const c0 = [(W / 2 - v.x) / v.z, (H / 2 - v.y) / v.z], z0 = v.z;
    const c1 = [(W / 2 - to.x) / to.z, (H / 2 - to.y) / to.z], z1 = to.z;
    if (reduced.matches || ms <= 0) { setView(to); return Promise.resolve(); }
    const span = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) * Math.min(z0, z1) / Math.max(W, H);
    const dip = Math.min(1.1, Math.log1p(span) * 0.55);
    const ease = dip > 0.05 ? (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2) : (p) => 1 - Math.pow(1 - p, 3);
    const t0 = performance.now();
    flightSoft = !hard;
    return new Promise((done) => {
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms), e = ease(p);
        const z = Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * e - dip * Math.sin(Math.PI * e));
        const cx = c0[0] + (c1[0] - c0[0]) * e, cy = c0[1] + (c1[1] - c0[1]) * e;
        setView(p < 1 ? { x: W / 2 - cx * z, y: H / 2 - cy * z, z } : to);
        if (p < 1) flight = requestAnimationFrame(step); else { flight = 0; done(); }
      };
      flight = requestAnimationFrame(step);
    });
  }
  // un geste de Cal sur la planche arrête un vol (pas ceux de la présentation)
  cv.addEventListener('pointerdown', () => { if (flight && flightSoft) cancel(); }, true);
  cv.addEventListener('wheel', () => { if (flight && flightSoft) cancel(); }, { capture: true, passive: true });

  // ── la barre : le groupe « atelier » ─────────────────────
  // une barre étroite (atelier.css, sous 1480 px) ne garde que la palette et
  // un bouton « atelier » qui ouvre les autres en menu
  const specs = [];
  let grp = null;
  function group() {
    if (grp) return grp;
    grp = el('div', { class: 'tgrp at-grp', role: 'toolbar', 'aria-label': 'atelier' });
    const more = el('button', { class: 'ic at-more', type: 'button', 'data-order': '0', title: 'atelier : présenter, voter, projecteur, minuteur, machine temporelle', 'aria-label': 'atelier' },
      icon('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'));
    more.addEventListener('click', () => {
      const r = more.getBoundingClientRect();
      menu(r.left, r.bottom + 4, [{ head: 'Atelier' }, ...specs.map((s) => ({ label: s.name, checked: s.b.classList.contains('on'),
        onclick: () => s.onclick(new MouseEvent('click'), more) }))]);
    });
    new MutationObserver(() => more.classList.toggle('on', specs.some((s) => s.b.classList.contains('on'))))
      .observe(grp, { subtree: true, attributes: true, attributeFilter: ['class'] });
    grp.append(more);
    const bar = document.querySelector('.ide-bar');
    if (bar) bar.insertBefore(grp, bar.querySelector('#b-lib'));
    else corner().prepend(grp);
    return grp;
  }
  const sorted = (box, node, order) => {
    node.dataset.order = order;
    const after = [...box.children].find((c) => Number(c.dataset.order ?? 1e9) > order);
    box.insertBefore(node, after || null);
    return node;
  };
  function button({ order = 50, title, name = '', d, label = null, cls = '', onclick, oncontext }) {
    const b = el('button', { class: `ic ${cls}`.trim(), type: 'button', title, 'aria-label': name || title.split(' · ')[0] }, icon(d), label);
    b.addEventListener('click', (e) => onclick(e, b));
    if (oncontext) b.addEventListener('contextmenu', (e) => { e.preventDefault(); oncontext(e, b); });
    if (name) { specs.push({ order, name, b, onclick }); specs.sort((x, y) => x.order - y.order); }
    return sorted(group(), b, order);
  }

  // ── la planche : panneaux, coin, calque ──────────────────
  const stop = (e) => e.stopPropagation();
  // un panneau posé sur la planche : ses gestes restent à lui
  function panel(cls, ...kids) {
    const p = el('div', { class: `at-panel ${cls}` }, ...kids);
    for (const ev of ['pointerdown', 'dblclick', 'contextmenu', 'dragover', 'drop']) p.addEventListener(ev, stop);
    p.addEventListener('wheel', stop, { passive: true });
    return p;
  }
  let cornerBox = null;
  function corner(node, order = 50) {
    if (!cornerBox) { cornerBox = el('div', { class: 'at-tr' }); cv.append(cornerBox); }
    if (node) sorted(cornerBox, node, order);
    return cornerBox;
  }
  // un calque sur toute la planche : plus rien ne l'atteint ; `pan` : on se
  // déplace et on zoome quand même (la machine temporelle)
  function shield({ pan = false, cls = '' } = {}) {
    const sh = el('div', { class: `at-shield ${cls}`.trim() });
    for (const ev of ['dblclick', 'click']) sh.addEventListener(ev, (e) => { e.preventDefault(); stop(e); });
    sh.addEventListener('contextmenu', (e) => { e.preventDefault(); stop(e); });
    sh.addEventListener('dragover', (e) => { e.preventDefault(); stop(e); });
    sh.addEventListener('drop', (e) => { e.preventDefault(); stop(e); });
    sh.addEventListener('wheel', (e) => {
      e.preventDefault(); stop(e);
      if (!pan) return;
      const r = cv.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(S.view.z * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    sh.addEventListener('pointerdown', (e) => {
      e.preventDefault(); stop(e);
      if (!pan || e.button > 1) return;
      const v = S.view, x0 = e.clientX, y0 = e.clientY, px = v.x, py = v.y;
      sh.classList.add('panning');
      const mv = (ev) => setView({ x: px + ev.clientX - x0, y: py + ev.clientY - y0, z: v.z });
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); sh.classList.remove('panning'); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });
    const over = cv.querySelector('.overlay');
    if (over) over.after(sh); else cv.append(sh);
    return sh;
  }

  // ── les feuilles vivantes ────────────────────────────────
  const sheets = new Map();
  function style(name) {
    return (css) => {
      let s = sheets.get(name);
      if (!s) { s = el('style', { 'data-atelier-live': name }); document.head.append(s); sheets.set(name, s); }
      if (s.textContent !== css) s.textContent = css;
    };
  }
  // éclairer : sous `.cv.<scope>`, ces objets et ces liens gardent leur opacité
  function litCss(scope, ids, linkIds = []) {
    const a = [...ids].map((id) => `.cv.${scope} .nd[data-id=${q(id)}], .cv.${scope} .fr[data-id=${q(id)}]`);
    const b = [...linkIds].map((id) => `.cv.${scope} .links g[data-link=${q(id)}]`);
    return (a.length ? `${a.join(',\n')} { opacity: 1; }\n` : '') + (b.length ? `${b.join(',\n')} { opacity: 1; }\n` : '');
  }
  // l'élément d'un objet sur la planche (le canvas le garde dans `dom`)
  const nodeEl = (id) => app.canvas.dom?.get?.(id)?.el || cv.querySelector(`.nd[data-id=${q(id)}], .fr[data-id=${q(id)}]`);

  // ── un seul clavier ──────────────────────────────────────
  const keyers = [];
  function key(prio, fn) { keyers.push({ prio, fn }); keyers.sort((a, b) => a.prio - b.prio); }
  addEventListener('keydown', (e) => {
    const ctx = { typing: typing(e.target), overlay: overlayOpen() };
    for (const k of keyers) {
      let took = false;
      try { took = k.fn(e, ctx); } catch (err) { console.error('atelier · clavier', err); }
      if (took) { e.stopPropagation(); return; }
    }
  }, true);
  // coller pendant qu'on présente ou qu'on remonte le temps : rien n'entre
  addEventListener('paste', (e) => { if (A.presenting || A.replaying) { e.preventDefault(); e.stopPropagation(); } }, true);

  // ── les commandes de la palette ──────────────────────────
  const commands = [];
  // { label, run, key?, sub?, when?: () => true | 'pourquoi pas', order? }
  function command(c) { commands.push({ order: 50, ...c }); commands.sort((a, b) => a.order - b.order); }

  A = { app, S, cv, fly, cancel, setView, current, toView, viewFor, zoomAt, dims,
    button, panel, corner, shield, style, litCss, nodeEl, key, command, commands,
    presenting: false, replaying: false };
  app.atelier = A;   // pour les essais (window.ideation.app.atelier) et le débogage
  return A;
}
