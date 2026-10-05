// MONTAGE — la trajectoire au moniteur programme (06/10).
//
// Cal : « déplacer les éléments dans la frame […] et même le zoom aussi. Regarde
// dans Premiere ». Comme Premiere (aide d'Adobe, « Apply Motion effect to clips » ;
// helpx.adobe.com ne s'ouvre pas d'ici, lu par les résultats de recherche) : le plan
// choisi montre son cadre au moniteur, ses poignées et son point d'ancrage ; un
// double-clic dans l'image choisit le plan qui s'y voit (le plus haut) — Premiere :
// « Double-clicking a clip inside the Program Monitor selects it and displays a
// bounding box […] with a centered anchor-point cross hair and handles ».
//   - glisser dans le cadre : la position (Maj : sur un seul axe) ;
//   - une poignée de coin : l'échelle autour du point d'ancrage, proportions gardées ;
//     Maj les libère (la demande de Cal : largeur et hauteur séparées) ;
//   - juste hors d'un coin : la rotation autour du point d'ancrage (Premiere : « Hover
//     slightly above and outside of any of the corner handles until you see the
//     rotation icon ») ; Maj : par 15° ;
//   - alt + glisser le point d'ancrage : il se déplace sans bouger l'image (la position
//     suit) ; sans alt, le prendre déplace le plan comme ailleurs dans le cadre — on
//     prend un plan par son milieu, où l'ancrage est le plus souvent.
// L'aimant (le même que la timeline, touche S ; Ctrl le suspend le temps du geste)
// colle les bords et le centre de l'image aux bords et au centre du cadre, les coins
// d'une image droite aux bords du cadre, la rotation aux angles droits (à 3°), le point
// d'ancrage au centre de l'image, à 6 px d'écran ; un repère se dessine. Premiere :
// « Snap in Program Monitor », les bords et le centre de l'écran (aide « Snap objects
// to guides », par les résultats de recherche).
//
// Rien n'est calculé ici que model.js ne calcule (cadre, coins, versSource, versCadre) :
// le cadre dessiné est celui de l'image du moniteur, qui est celle de l'export. Chaque
// geste est une seule annulation (app.debut au début, app.fin au lâcher) ; l'image du
// moniteur suit à chaque mouvement (app.vivant).

import * as M from './model.js';

const NS = 'http://www.w3.org/2000/svg';
const POIG = 9;          // côté d'une poignée de coin, en px d'écran
const TOUR = 22;         // la zone de rotation, autour de chaque coin
const AIMANT = 6;        // l'aimant, en px d'écran
const LABEL = { move: 'déplacer dans le cadre', coin: 'mettre à l’échelle', rot: 'tourner', ancre: 'déplacer le point d’ancrage' };

function mk(tag, attrs = {}, parent = null) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.append(n);
  return n;
}
// le point de `cands` le plus proche de l'une des `vals`, dans la tolérance : { d, q }
function aimant(vals, cands, tol) {
  let best = null;
  for (const a of vals) for (const q of cands) {
    const d = q - a;
    if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, q };
  }
  return best;
}
const boite = (pts) => ({ x0: Math.min(...pts.map((q) => q[0])), x1: Math.max(...pts.map((q) => q[0])), y0: Math.min(...pts.map((q) => q[1])), y1: Math.max(...pts.map((q) => q[1])) });
const tourne = (a) => ((a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
// le curseur de redimensionnement qui suit la direction d'un coin à l'écran
function curseurCoin(dx, dy) {
  const a = ((Math.atan2(dy, dx) * 180 / Math.PI) % 180 + 180) % 180;
  return a < 22.5 || a >= 157.5 ? 'ew-resize' : a < 67.5 ? 'nwse-resize' : a < 112.5 ? 'ns-resize' : 'nesw-resize';
}

// Le curseur de rotation : une flèche courbe aux couleurs des jetons, lues à
// l'exécution (aucune couleur écrite), comme les curseurs des outils (montage.js).
function curseurTour() {
  const cs = getComputedStyle(document.documentElement);
  const ink = cs.getPropertyValue('--ink').trim(), dark = cs.getPropertyValue('--bg').trim();
  const d = 'M6 15a7 7 0 1 0 2-9M8 2v4h4';
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${d}" stroke="${dark}" stroke-width="4"/><path d="${d}" stroke="${ink}" stroke-width="1.7"/></svg>`;
  document.documentElement.style.setProperty('--cur-tour', `url("data:image/svg+xml,${encodeURIComponent(s)}") 12 12, alias`);
}

// app : { p(), sel(), select(ids), locked(c), snap(), debut(label), vivant(id, motion), fin(moved) }
export function mountCadre({ screen, stage, program, app }) {
  const svg = mk('svg', { class: 'cadre-ov', 'aria-hidden': 'true' });
  screen.append(svg);
  curseurTour();
  let drag = null;
  let reperes = [];

  // le cadre de la séquence à l'écran : sa place dans le moniteur, son échelle
  function vue() {
    const p = app.p();
    if (!p) return null;
    const sr = stage.getBoundingClientRect(), qr = screen.getBoundingClientRect();
    if (!sr.width || !qr.width) return null;
    const W = p.settings.width || 1920, H = p.settings.height || 1080;
    return { p, W, H, sr, qr, k: sr.width / W, ox: sr.left - qr.left, oy: sr.top - qr.top };
  }
  const ecran = (v, q) => [v.ox + q[0] * v.k, v.oy + q[1] * v.k];
  const dansCadre = (v, ev) => [(ev.clientX - v.sr.left) / v.k, (ev.clientY - v.sr.top) / v.k];

  // les plans d'image qui se voient sous la tête, du plus haut (la piste du haut) au plus bas
  function vus(p) {
    const f = program.frame(), win = M.windows(p);
    const hidden = new Set(p.tracks.filter((t) => t.hide).map((t) => t.id));
    const rang = new Map(p.tracks.map((t, i) => [t.id, i]));
    return p.clips.filter((c) => {
      const w = win.get(c.id);
      return M.movable(c) && M.isOn(c) && !hidden.has(c.track) && w && f >= w.ws && f < w.we;
    }).sort((a, b) => rang.get(a.track) - rang.get(b.track));
  }

  // le plan le plus haut dont l'image (sa part gardée) est sous ce point du cadre
  function sous(v, X, Y) {
    for (const c of vus(v.p)) {
      const g = program.geometry(c, v.p);
      if (!g || !g.vis) continue;
      const [sx, sy] = M.versSource(g, X, Y);
      if (sx >= g.x0 && sx <= g.x1 && sy >= g.y0 && sy <= g.y1) return c;
    }
    return null;
  }

  function dessiner() {
    svg.replaceChildren();
    const v = vue();
    if (!v || program.playing) return;
    svg.setAttribute('viewBox', `0 0 ${v.qr.width} ${v.qr.height}`);
    const sel = app.sel();
    const list = vus(v.p).filter((c) => sel.has(c.id));
    for (const c of list) {
      const g = program.geometry(c, v.p);
      if (!g) continue;
      const seul = list.length === 1 && !app.locked(c);
      const pts = M.coins(g).map((q) => ecran(v, q));
      const poly = pts.map((q) => q.map((x) => x.toFixed(1)).join(',')).join(' ');
      const grp = mk('g', { 'data-id': c.id, class: seul ? 'seul' : 'autre' }, svg);
      if (seul) {
        // la rotation : autour de chaque coin, sous le corps et les poignées (seul ce qui dépasse du cadre se prend)
        for (const q of pts) mk('circle', { cx: q[0], cy: q[1], r: TOUR, class: 'tour', 'data-role': 'rot' }, grp);
        mk('polygon', { points: poly, class: 'corps', 'data-role': 'move' }, grp);
      }
      mk('polygon', { points: poly, class: 'trait-f' }, grp);
      mk('polygon', { points: poly, class: 'trait' }, grp);
      if (!seul) continue;
      const deg = g.th * 180 / Math.PI;
      pts.forEach((q, i) => {
        const r = mk('rect', { x: q[0] - POIG / 2, y: q[1] - POIG / 2, width: POIG, height: POIG, class: 'poig', 'data-role': 'coin', 'data-i': i,
          transform: `rotate(${deg.toFixed(3)} ${q[0]} ${q[1]})` }, grp);
        r.style.cursor = curseurCoin(q[0] - (pts[0][0] + pts[2][0]) / 2, q[1] - (pts[0][1] + pts[2][1]) / 2);
      });
      const [ax, ay] = ecran(v, M.ancrage(M.motionOf(c), v.W, v.H));
      const an = mk('g', { class: 'ancre' }, grp);
      for (const [x1, y1, x2, y2] of [[ax - 7, ay, ax + 7, ay], [ax, ay - 7, ax, ay + 7]]) {
        mk('line', { x1, y1, x2, y2, class: 'trait-f' }, an);
        mk('line', { x1, y1, x2, y2, class: 'trait' }, an);
      }
      mk('circle', { cx: ax, cy: ay, r: 3.5, class: 'trait-f' }, an);
      mk('circle', { cx: ax, cy: ay, r: 3.5, class: 'trait' }, an);
    }
    // les repères de l'aimant : une ligne d'un bord du cadre à l'autre
    for (const [axe, q] of reperes) {
      const [a, b] = axe === 'v' ? [ecran(v, [q, 0]), ecran(v, [q, v.H])] : [ecran(v, [0, q]), ecran(v, [v.W, q])];
      mk('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'repere-f' }, svg);
      mk('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'repere' }, svg);
    }
  }

  // ── les gestes ──
  function down(ev) {
    const t = ev.target.closest && ev.target.closest('[data-role]');
    if (!t || ev.button !== 0) return;
    const v = vue();
    const c = v && M.byId(v.p, t.closest('[data-id]')?.dataset.id);
    if (!c || app.locked(c)) return;
    const g = program.geometry(c, v.p);
    if (!g) return;
    ev.preventDefault();
    ev.stopPropagation();
    const P0 = dansCadre(v, ev), m0 = M.motionOf(c);
    const A = M.ancrage(m0, v.W, v.H);
    // alt sur la croix de l'ancrage (à 9 px d'écran) : l'ancrage ; sinon le plan
    let role = t.dataset.role;
    if (role === 'move' && ev.altKey && Math.hypot(P0[0] - A[0], P0[1] - A[1]) * v.k <= 9) role = 'ancre';
    drag = { role, i: +(t.dataset.i || 0), id: c.id, v, g0: g, m0, P0, A, moved: false,
      last: Math.atan2(P0[1] - A[1], P0[0] - A[0]), acc: 0, cursor: getComputedStyle(t).cursor };
    const W = screen.ownerDocument.defaultView || window;   // le moniteur peut être dans sa fenêtre (commun/fenetre.js)
    drag.W = W;
    W.addEventListener('pointermove', move, true);
    W.addEventListener('pointerup', up, true);
    W.addEventListener('pointercancel', up, true);
    screen.classList.add('cadre-geste');
    screen.style.setProperty('--cadre-cur', drag.cursor);
    app.debut(LABEL[drag.role]);
  }

  function move(ev) {
    const d = drag;
    if (!d) return;
    const { v, g0, m0, A } = d;
    const P = dansCadre(v, ev);
    const snap = app.snap() !== (ev.ctrlKey || ev.metaKey);
    const tol = AIMANT / v.k;
    const m = { ...m0 };
    const droite = Math.abs(g0.si) < 1e-9;                  // une image droite (0° ou 180°)
    reperes = [];
    if (d.role === 'move') {
      let dx = P[0] - d.P0[0], dy = P[1] - d.P0[1];
      if (ev.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
      if (snap) {
        const b = boite(M.coins(g0));
        const sx = !(ev.shiftKey && dx === 0) && aimant([b.x0 + dx, (b.x0 + b.x1) / 2 + dx, b.x1 + dx], [0, v.W / 2, v.W], tol);
        const sy = !(ev.shiftKey && dy === 0) && aimant([b.y0 + dy, (b.y0 + b.y1) / 2 + dy, b.y1 + dy], [0, v.H / 2, v.H], tol);
        if (sx) { dx += sx.d; reperes.push(['v', sx.q]); }
        if (sy) { dy += sy.d; reperes.push(['h', sy.q]); }
      }
      m.x = m0.x + dx / v.W;
      m.y = m0.y + dy / v.H;
    } else if (d.role === 'coin') {
      // le coin pris suit le pointeur ; dans les axes de l'image (avant rotation), depuis l'ancrage
      const C0 = M.coins(g0)[d.i];
      const loc = (q) => { const x = q[0] - A[0], y = q[1] - A[1]; return [g0.co * x + g0.si * y, -g0.si * x + g0.co * y]; };
      const C = [C0[0] + P[0] - d.P0[0], C0[1] + P[1] - d.P0[1]];
      const L0 = loc(C0), L = loc(C);
      const sw0 = m0.uniform ? m0.scale : m0.scaleW;
      if (!ev.shiftKey) {
        const n2 = L0[0] * L0[0] + L0[1] * L0[1];
        let f = n2 > 1e-6 ? Math.max(0, (L[0] * L0[0] + L[1] * L0[1]) / n2) : 1;
        if (snap && droite) {
          // le coin d'une image droite contre un bord ou le centre du cadre
          const best = [];
          if (Math.abs(C0[0] - A[0]) > 1) for (const q of [0, v.W / 2, v.W]) best.push({ f: (q - A[0]) / (C0[0] - A[0]), d: Math.abs(A[0] + (C0[0] - A[0]) * f - q), r: ['v', q] });
          if (Math.abs(C0[1] - A[1]) > 1) for (const q of [0, v.H / 2, v.H]) best.push({ f: (q - A[1]) / (C0[1] - A[1]), d: Math.abs(A[1] + (C0[1] - A[1]) * f - q), r: ['h', q] });
          const b = best.filter((x) => x.f > 0 && x.d <= tol).sort((a, z) => a.d - z.d)[0];
          if (b) { f = b.f; reperes.push(b.r); }
        }
        m.scale = m0.scale * f;
        m.scaleW = sw0 * f;
      } else {
        let fx = Math.abs(L0[0]) > 1e-3 ? Math.max(0, L[0] / L0[0]) : 1, fy = Math.abs(L0[1]) > 1e-3 ? Math.max(0, L[1] / L0[1]) : 1;
        if (snap && droite) {
          const cx = A[0] + (C0[0] - A[0]) * fx, cy = A[1] + (C0[1] - A[1]) * fy;
          const sx = Math.abs(C0[0] - A[0]) > 1 && aimant([cx], [0, v.W / 2, v.W], tol), sy = Math.abs(C0[1] - A[1]) > 1 && aimant([cy], [0, v.H / 2, v.H], tol);
          if (sx) { fx = (sx.q - A[0]) / (C0[0] - A[0]); reperes.push(['v', sx.q]); }
          if (sy) { fy = (sy.q - A[1]) / (C0[1] - A[1]); reperes.push(['h', sy.q]); }
        }
        m.uniform = false;
        m.scaleW = sw0 * Math.max(0, fx);
        m.scale = m0.scale * Math.max(0, fy);
      }
    } else if (d.role === 'rot') {
      // les tours s'additionnent (un geste peut faire plus d'un demi-tour)
      const a = Math.atan2(P[1] - A[1], P[0] - A[0]);
      d.acc += tourne(a - d.last);
      d.last = a;
      let r = m0.rot + d.acc * 180 / Math.PI;
      if (ev.shiftKey) r = Math.round(r / 15) * 15;
      else if (snap && Math.abs(r - Math.round(r / 90) * 90) < 3) r = Math.round(r / 90) * 90;
      m.rot = r;
    } else if (d.role === 'ancre') {
      let Q = P;
      const mil = M.versCadre(g0, g0.sw / 2, g0.sh / 2);   // le centre de l'image
      if (snap && Math.hypot(Q[0] - mil[0], Q[1] - mil[1]) <= tol) Q = mil;
      const s = M.versSource(g0, Q[0], Q[1]);
      m.ax = s[0] / g0.sw;
      m.ay = s[1] / g0.sh;
      m.x = Q[0] / v.W;
      m.y = Q[1] / v.H;
    }
    d.moved = true;
    app.vivant(d.id, m);
    dessiner();
  }

  function up() {
    const d = drag;
    if (!d) return;
    drag = null;
    reperes = [];
    d.W.removeEventListener('pointermove', move, true);
    d.W.removeEventListener('pointerup', up, true);
    d.W.removeEventListener('pointercancel', up, true);
    screen.classList.remove('cadre-geste');
    app.fin(d.moved);
    dessiner();
  }

  svg.addEventListener('pointerdown', down);
  // double-clic dans l'image : choisir le plan qui s'y voit (le plus haut)
  screen.addEventListener('dblclick', (ev) => {
    const v = vue();
    if (!v || ev.target.closest('.scrub')) return;
    const c = sous(v, ...dansCadre(v, ev));
    if (c) app.select(new Set([c.id]));
  });
  new ResizeObserver(() => { if (!drag) dessiner(); }).observe(screen);

  return {
    // le dessin suit la tête, le choix, le montage ; pendant un geste, c'est le geste qui dessine
    paint() { if (!drag) dessiner(); },
    sous: (X, Y) => { const v = vue(); return v ? sous(v, X, Y) : null; },
    get geste() { return !!drag; },
  };
}
