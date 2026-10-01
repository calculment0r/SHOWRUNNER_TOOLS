// IDÉATION — le panneau de la visio (01/10/2026), greffé par collab.js.
// Demande de Cal : « un panneau qu'on peut déplacer et redimensionner, en pop-up,
// pour la vidéo : on peut le mettre partout où on veut, et on a quelques options
// sur ce panneau, comme pouvoir raccrocher, ou couper la caméra et le son ».
//
// Une fenêtre flottante au-dessus de la planche, sans voile (la planche reste à
// la main) : on la déplace par sa barre, on la redimensionne par ses coins et
// ses bords, elle reste dans l'écran ; sa place et sa taille sont gardées pour
// la personne (localStorage, en try/catch : sans stockage, la place par défaut).
// Les vignettes s'y rangent en grille, qui suit la taille (le nombre de colonnes
// qui donne les plus grandes vignettes en 16:9). Qui parle est mis en avant (un
// filet à sa couleur) : le niveau du son de chaque piste par Web Audio (MDN :
// `AudioContext.createMediaStreamSource`, `AnalyserNode.getFloatTimeDomainData`).
// Réduit, le panneau devient une bulle (les visages), qu'on déplace aussi et
// qui le rouvre d'un clic. Échap ne fait rien ici : on ne raccroche jamais au
// clavier par mégarde. Le panneau peut aussi passer dans une fenêtre du
// navigateur (commun/fenetre.js : un 2ᵉ écran) ; le reste (l'appel, les pistes)
// ne bouge pas : c'est le même nœud.
//
// Ce module ne sait rien de WebRTC : collab.js lui donne ses boutons, ses
// vignettes, les visages de la bulle et les pistes son à écouter.

import { el } from '../commun/shell.js';

const KEY = 'ide-visio-geo';
const MIN_W = 260, MIN_H = 190, EDGE = 8, BUB = 52;
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sans stockage : la place par défaut */ } },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ico = (d, cls = '') => el('span', { class: `vz-ico ${cls}`, html: `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>` });
export const VZ_ICO = {
  min: '<path d="M6 17h12"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
  hang: '<path d="M3.2 13.6c4.8-4.2 12.8-4.2 17.6 0l-2.2 2.7-3.6-1.4-.3-2.6a12 12 0 0 0-5.4 0l-.3 2.6-3.6 1.4z"/>',
  micOff: '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/><path class="x" d="M4 4l16 16"/>',
  camOff: '<path d="M3 7h12v10H3zM15 11l6-3.5v9L15 13"/><path class="x" d="M3 4l16 16"/>',
};

// le panneau : `head` (des nœuds de la barre, après le titre), `bar` (les commandes),
// `detach` (le bouton de commun/fenetre.js, ou rien), `onShow(on)` quand il paraît
export function createPanel({ head = [], bar = [], detach = null, label = 'visio' } = {}) {
  const def = () => {
    const w = Math.min(440, innerWidth - 2 * EDGE), h = Math.min(320, innerHeight - 2 * EDGE);
    return { x: Math.max(EDGE, innerWidth - w - 372), y: 104, w, h, mini: false, bx: null, by: null };
  };
  const G = { ...def(), ...(store.get() || {}) };
  const title = el('span', { class: 'vz-t lbl' }, label);
  const count = el('span', { class: 'vz-n lbl' });
  const bMin = el('button', { class: 'vz-hb', type: 'button', title: 'réduire en bulle (l’appel continue)', 'aria-label': 'réduire en bulle', onclick: () => mini(true) }, ico(VZ_ICO.min));
  const hd = el('div', { class: 'vz-head', title: 'déplacer le panneau' }, ico(VZ_ICO.grip, 'grip'), title, count, ...head, el('span', { class: 'sp' }), detach, bMin);
  const note = el('div', { class: 'vz-note', hidden: true });
  const grid = el('div', { class: 'vz-grid', role: 'list', 'aria-label': 'les vignettes de l’appel' });
  const bbar = el('div', { class: 'vz-bar', role: 'toolbar', 'aria-label': 'commandes de l’appel' }, ...bar);
  const edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((m) => el('i', { class: `vz-rz ${m}`, 'data-m': m, 'aria-hidden': 'true' }));
  const root = el('section', { class: 'vz', hidden: true, role: 'dialog', 'aria-modal': 'false', 'aria-label': `${label} : le panneau de l’appel` }, hd, note, grid, bbar, ...edges);
  const faces = el('span', { class: 'vz-faces' });
  const bubN = el('span', { class: 'lbl vz-bn' });
  const bub = el('button', { class: 'vz-bub', type: 'button', hidden: true, title: 'rouvrir le panneau de l’appel · glisser pour la déplacer', 'aria-label': 'rouvrir le panneau de l’appel' }, faces, bubN);
  document.body.append(root, bub);

  let shown = false;
  const detached = () => !!root.dataset.srFen;
  function apply() {
    if (detached()) return;
    Object.assign(root.style, { left: `${G.x}px`, top: `${G.y}px`, width: `${G.w}px`, height: `${G.h}px` });
    const bx = G.bx ?? (G.x + G.w - BUB * 2), by = G.by ?? G.y;
    Object.assign(bub.style, { left: `${bx}px`, top: `${by}px` });
  }
  function fit() {
    const vw = innerWidth, vh = innerHeight;
    G.w = clamp(G.w, Math.min(MIN_W, vw - 2 * EDGE), vw - 2 * EDGE);
    G.h = clamp(G.h, Math.min(MIN_H, vh - 2 * EDGE), vh - 2 * EDGE);
    G.x = clamp(G.x, EDGE, vw - G.w - EDGE);
    G.y = clamp(G.y, EDGE, vh - G.h - EDGE);
    if (G.bx !== null) {
      const r = bub.getBoundingClientRect();
      const bw = r.width || 120, bh = r.height || 40;
      G.bx = clamp(G.bx, EDGE, vw - bw - EDGE);
      G.by = clamp(G.by, EDGE, vh - bh - EDGE);
    }
    apply();
  }
  const save = () => store.set(G);

  // le geste : déplacer (la barre), redimensionner (un coin, un bord) ; la bulle se déplace aussi
  function gesture(e, mode) {
    if (e.button !== 0 || detached()) return;
    const tgt = e.currentTarget;
    const g0 = { ...G }, x0 = e.clientX, y0 = e.clientY;
    const b0 = bub.getBoundingClientRect();
    let moved = false;
    try { tgt.setPointerCapture(e.pointerId); } catch { /* */ }
    root.classList.add('busy');
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      const vw = innerWidth, vh = innerHeight;
      if (mode === 'bub') { G.bx = b0.left + dx; G.by = b0.top + dy; fit(); return; }
      if (mode === 'move') { G.x = g0.x + dx; G.y = g0.y + dy; fit(); return; }
      const right = g0.x + g0.w, bottom = g0.y + g0.h;
      if (mode.includes('e')) G.w = clamp(g0.w + dx, MIN_W, vw - EDGE - g0.x);
      if (mode.includes('s')) G.h = clamp(g0.h + dy, MIN_H, vh - EDGE - g0.y);
      if (mode.includes('w')) { G.x = clamp(g0.x + dx, EDGE, right - MIN_W); G.w = right - G.x; }
      if (mode.includes('n')) { G.y = clamp(g0.y + dy, EDGE, bottom - MIN_H); G.h = bottom - G.y; }
      apply(); layout();
    };
    const up = () => {
      tgt.removeEventListener('pointermove', move);
      tgt.removeEventListener('pointerup', up);
      tgt.removeEventListener('pointercancel', up);
      root.classList.remove('busy');
      if (moved) save();
      else if (mode === 'bub') mini(false);
    };
    tgt.addEventListener('pointermove', move);
    tgt.addEventListener('pointerup', up);
    tgt.addEventListener('pointercancel', up);
    e.preventDefault();
  }
  hd.addEventListener('pointerdown', (e) => { if (!e.target.closest('button, a, input')) gesture(e, 'move'); });
  for (const r of edges) r.addEventListener('pointerdown', (e) => gesture(e, r.dataset.m));
  bub.addEventListener('pointerdown', (e) => gesture(e, 'bub'));
  // au clavier, la bulle se rouvre (Entrée, Espace) ; le clic de la souris passe par le geste
  bub.addEventListener('click', (e) => { if (e.detail === 0) mini(false); });
  addEventListener('resize', () => { fit(); layout(); });

  // la grille : le nombre de colonnes qui donne les plus grandes vignettes en 16:9
  function layout() {
    const n = grid.children.length || 1;
    const W = grid.clientWidth, H = grid.clientHeight;
    if (!W || !H) return;
    let best = 1, bw = 0;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const w = Math.min(W / c, (H / r) * 16 / 9);
      if (w > bw + 0.5) { bw = w; best = c; }
    }
    grid.style.setProperty('--cols', String(best));
    grid.style.setProperty('--rows', String(Math.ceil(n / best)));
  }
  new ResizeObserver(() => layout()).observe(grid);
  new MutationObserver(() => layout()).observe(grid, { childList: true });

  function paintShow() {
    root.hidden = !shown || G.mini;
    bub.hidden = !shown || !G.mini || detached();
    if (shown) requestAnimationFrame(() => { fit(); layout(); });
  }
  function mini(on) {
    if (detached() && on) return;
    G.mini = !!on;
    save();
    paintShow();
    if (!on) setTimeout(() => bMin.focus({ preventScroll: true }), 0);
  }
  fit();

  return {
    root, grid, note, bub,
    show(on) { shown = !!on; paintShow(); },
    shown: () => shown,
    mini, isMini: () => G.mini,
    count(n) { count.textContent = n ? `· ${n}` : ''; bubN.textContent = n ? `appel · ${n}` : 'appel'; },
    // la bulle : jusqu'à quatre visages ({name, color, initials, talk, mute})
    faces(list) {
      faces.replaceChildren(...list.slice(0, 4).map((f) => el('span', {
        class: `vz-face${f.talk ? ' talk' : ''}${f.mute ? ' mute' : ''}`, style: { '--c': f.color }, title: f.name,
      }, f.initials)));
    },
    geo: () => ({ ...G }),
    layout, fit,
  };
}

// qui parle : le niveau de chaque piste son (Web Audio). `set(Map clé → piste)` ;
// `onTalk(clé | null)` quand la personne mise en avant change. Une seule AudioContext,
// ouverte au geste qui rejoint l'appel (MDN : un contexte créé sans geste reste
// « suspended »).
export function createTalk(onTalk) {
  let ctx = null, timer = 0, cur = null, curT = 0;
  const srcs = new Map();   // clé → { track, src, an, buf, lvl }
  const TH = 0.018, HOLD = 700;
  function start() {
    if (ctx || typeof AudioContext !== 'function') return;
    try { ctx = new AudioContext(); } catch { ctx = null; return; }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    timer = setInterval(tick, 150);
  }
  function drop(k) {
    const s = srcs.get(k);
    if (!s) return;
    try { s.src.disconnect(); } catch { /* */ }
    srcs.delete(k);
  }
  function set(map) {
    if (!ctx) return;
    for (const k of [...srcs.keys()]) if (!map.has(k) || map.get(k) !== srcs.get(k).track) drop(k);
    for (const [k, t] of map) {
      if (!t || srcs.has(k) || t.readyState === 'ended') continue;
      try {
        const src = ctx.createMediaStreamSource(new MediaStream([t]));
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);   // pas vers la sortie : on mesure, on ne rejoue pas
        srcs.set(k, { track: t, src, an, buf: new Float32Array(an.fftSize), lvl: 0 });
      } catch { /* une piste sans son : rien à mesurer */ }
    }
  }
  function tick() {
    let top = null, topL = 0;
    const now = Date.now();
    for (const [k, s] of srcs) {
      if (!s.track.enabled || s.track.muted) { s.lvl = 0; continue; }
      s.an.getFloatTimeDomainData(s.buf);
      let sum = 0;
      for (const v of s.buf) sum += v * v;
      const rms = Math.sqrt(sum / s.buf.length);
      s.lvl = Math.max(rms, s.lvl * 0.8);
      if (s.lvl > TH && s.lvl > topL) { top = k; topL = s.lvl; }
    }
    const curL = cur && srcs.get(cur)?.lvl || 0;
    if (curL > TH) curT = now;
    // on garde qui parle tant qu'il parle, ou qu'un autre ne parle pas nettement plus fort
    if (top !== cur && (topL > curL * 1.6 || now - curT > HOLD)) {
      cur = top; curT = now;
      onTalk(cur);
    }
  }
  function stop() {
    clearInterval(timer); timer = 0;
    for (const k of [...srcs.keys()]) drop(k);
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
    if (cur !== null) { cur = null; onTalk(null); }
  }
  return { start, set, stop, level: (k) => srcs.get(k)?.lvl || 0, who: () => cur };
}
