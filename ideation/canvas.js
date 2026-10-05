// IDÉATION — le canvas infini : la vue (glisser, molette, pincer), les
// objets posés et leurs ports, la sélection (clic, Maj + clic, cadre de
// sélection, lasso avec Alt), déplacer, redimensionner, la mini-carte. Les
// liens et le geste « tirer un fil » : wires.js ; ce qui se branche : ports.js.
// Les groupes (groups.js) : un clic sur un enfant choisit son groupe, un
// double-clic l'enfant, Échap remonte ; un objet lâché sur un autre fait un
// groupe ; un groupe réduit est une carte dont les ports sont les fils qui
// traversent sa frontière. Le cadre de sélection et sa barre : selection.js.
//
// Rien ici n'écrit la planche sans passer par l'app : `app.snap()` garde
// l'état d'avant (annuler), `app.commit()` repeint et enregistre. Les
// couleurs viennent des jetons, même dans la mini-carte (lus à l'exécution).
// Le canvas émet 'view' (app.emit, plugins.js) quand la caméra bouge.
//
// La fluidité (docs/etudes/ideation_fluidite.md, § 4.2) : ce qui est hors de
// la vue (plus un quart d'écran) n'est ni stylé ni peint (display: none) ; la
// trame se pose sur le fond de .cv (pas de variable héritée par les objets) ;
// le zoom « efficace » (--z, les niveaux Ensemble / Travail / Détail) se pose
// 150 ms après le geste ; une image se lit à la taille où elle est vue, 220 ms
// après le geste, décodée avant l'échange.

import { el, href, fmtDur, etypeFr, toast, dropZone } from '../commun/shell.js';
import { survolSon } from '../commun/lecteur.js';
import { menu } from '../commun/menu.js';
import { brancherCanvas } from '../commun/molette.js';
import { galerie } from './galerie.js';
import { CF_MIME, PART_MIME } from './library.js';
import { createWires, edgePts } from './wires.js';
import { KINDS, outPort, inPorts } from './ports.js';
import { CARD_W, LOD_PX, EXIT, kidsMap, kidsOf, layoutAll, arrange, layoutOf, crossing, portLabel, slotAt, setOrder } from './groups.js';
import { createSelection } from './selection.js';
// les repères et les lignes de l'aimant (le déplacement s'en sert par objets/ ; le redimensionnement ici)
import { targets as guideTargets, paintGuides, SNAP_PX } from './objets/guides.js';

export { menu, edgePts };
const NS = 'http://www.w3.org/2000/svg';
const GRID = 24;
const ZMIN = 0.08;
const ZMAX = 4;
const DWELL = 400;   // un texte posé sur un autre : un court arrêt au-dessus avant de proposer le composeur (étude Weavy § 9.5)
// les trois niveaux du zoom sémantique, sur le zoom « efficace » (étude Miro § 3.7)
const FAR = 0.42;    // Ensemble : un texte de 13 px y fait moins de 5,5 px à l'écran
const NEAR = 1.3;    // Détail : le seuil du prototype de Cal
const CULL = 0.25;   // la marge du culling : un quart d'écran (tldraw)
// les objets dont la hauteur suit le contenu : la page la mesure et l'écrit
export const AUTO_H = new Set(['note', 'sticky', 'title', 'gen', 'vgen', 'compose', 'text']);
const CARDS = new Set(['gen', 'vgen', 'compose']);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  return n;
};
// (un lien dans un objet texte n'en est pas un : un clic choisit le texte, ctrl+clic l'ouvre — objets/texte.js)
const isControl = (t) => t?.closest?.('input, textarea, select, button, a:not(.rt a), .editing, audio');
export const inside = (n, f) => n.x >= f.x && n.y >= f.y && n.x + n.w <= f.x + f.w && n.y + n.h <= f.y + f.h;
const hits = (n, r) => n.x < r.x + r.w && n.x + n.w > r.x && n.y < r.y + r.h && n.y + n.h > r.y;
export function bbox(list) {
  if (!list.length) return null;
  const x0 = Math.min(...list.map((n) => n.x)), y0 = Math.min(...list.map((n) => n.y));
  const x1 = Math.max(...list.map((n) => n.x + n.w)), y1 = Math.max(...list.map((n) => n.y + n.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// les copies d'affichage (commun/proxies.js : pickView, swap, viewsOf), chargées sans être
// exigées ; tant qu'elles ne sont pas là (ou sur un portail qui ne les a pas), la règle
// d'avant : la vignette, l'original quand l'image est vue en grand ; l'échange décodé d'abord
let PX = {
  viewsOf: () => [],
  pickView: (it, css) => (css * (devicePixelRatio || 1) > 400 && it?.url ? { url: href(it.url), w: Infinity } : { url: href(it?.thumb_url || it?.url || ''), w: 384 }),
  swap(img, url, w, { force = false } = {}) {
    const cur = img.getAttribute('src') ? +img.dataset.vw || 0 : -1;
    if ((!force && cur >= 0 && w <= cur) || img.dataset.want === url) return;
    img.dataset.want = url;
    const put = () => { if (img.dataset.want === url) { img.src = url; img.dataset.vw = String(w); } };
    if (cur < 0) { put(); return; }
    const pre = new Image();
    pre.decoding = 'async'; pre.src = url;
    pre.decode().then(put, put);
  },
};
export const ready = import('../commun/proxies.js').then((m) => { PX = m; return true; }).catch(() => false);
const viewsOf = (it) => PX.viewsOf(it);
const pickView = (it, css) => PX.pickView(it, css);
const swap = (...a) => PX.swap(...a);

// la plus petite image qui représente un objet (la mosaïque d'un groupe réduit) : la
// copie d'affichage de 256 (commun/proxies.js), sinon la vignette
export function smallest(it) {
  if (!it || it.missing) return null;
  if (it.kind === 'element') return it.element?.refs?.[0]?.thumb_url || it.thumb_url || null;
  if (it.kind === 'image') return viewsOf(it)[0]?.url || it.thumb_url || it.url;
  return it.thumb_url || null;
}

export function createCanvas(app) {
  const { S } = app;
  const cv = document.getElementById('cv');
  // la taille de la planche, gardée (ResizeObserver) : la relire à chaque image d'un geste (clientWidth) forçait une
  // mise en page entière de la planche à chaque événement de molette ou de pavé (Cal, 05/10 : « le canvas perd de la
  // fluidité de temps en temps » ; mesuré : viewRect, 0,9 s de temps propre sur un geste de 2 s)
  let cvW = 0, cvH = 0;
  const size = () => { if (!cvW) { cvW = cv.clientWidth; cvH = cv.clientHeight; } return [cvW, cvH]; };
  new ResizeObserver(() => { cvW = cv.clientWidth; cvH = cv.clientHeight; rectC = null; }).observe(cv);
  // la boîte de la planche à l'écran : une lecture par image au plus (une mise en page forcée par image, pas par événement)
  let rectC = null;
  const world = el('div', { class: 'world' });
  const framesL = el('div', { class: 'layer frames' });
  const groupsL = el('div', { class: 'layer groups' });
  const linksS = svg('svg', { class: 'links', width: 1, height: 1 });
  const nodesL = el('div', { class: 'layer nodes' });
  const slotM = el('div', { class: 'gins', hidden: true });   // la place d'insertion dans une rangée
  world.append(framesL, groupsL, linksS, nodesL, slotM);
  const temp = svg('path', { class: 'temp' });   // la flèche d'annotation qu'on tire (outil L)
  const HINT = 'molette : zoom · glisser le fond : choisir · Alt : lasso · espace : se déplacer · tirer une sortie : un fil · un objet sur un autre : un groupe · double-clic : poser';
  const marquee = el('div', { class: 'marquee', hidden: true });
  const over = svg('svg', { class: 'overlay' });
  const lassoP = svg('polygon', { class: 'lasso' });
  over.append(lassoP);
  const mini = el('canvas', { class: 'mini', title: 'la planche entière — cliquer ou glisser pour y aller' });
  const pct = el('button', { class: 'pct', type: 'button', title: 'revenir à 100 % · Maj+0' }, '100 %');
  const gridB = el('button', { class: 'zb', type: 'button', title: 'la trame de points', onclick: () => { S.grid = !S.grid; app.LS('grid', S.grid); applyView(); } }, 'trame');
  const zoomBox = el('div', { class: 'zoombox' },
    el('button', { class: 'zb', type: 'button', title: 'dézoomer · −', onclick: () => zoomBy(1 / 1.25) }, '−'), pct,
    el('button', { class: 'zb', type: 'button', title: 'zoomer · +', onclick: () => zoomBy(1.25) }, '+'),
    el('button', { class: 'zb', type: 'button', title: 'toute la planche à l’écran · Maj+1', onclick: () => fit() }, 'ajuster'), gridB);
  const hint = el('div', { class: 'hint lbl' });
  const empty = el('div', { class: 'empty', hidden: true });
  const banner = el('div', { class: 'banner', hidden: true });
  cv.append(world, marquee, over, empty, banner, zoomBox, mini, hint);
  pct.addEventListener('click', () => zoomTo(1));

  const dom = new Map();   // id → { el, key, py: { 'in:prompt': y… }, off }
  const V = () => S.view;
  // les groupes montrés en carte (réduits, ou « se réduit de loin » vus de loin), et leurs enfants cachés
  let cards = new Set(), hidden = new Map(), cardsKey = '';
  const cardH = new Map();        // la hauteur mesurée d'une carte de groupe
  const cardPortY = new Map();    // gid → Map('in:<objet>|<port>' → y dans la carte)
  const isCard = (n) => n?.type === 'group' && cards.has(n.id);
  // la boîte montrée d'un objet (un groupe en carte : la carte, au coin de sa boîte)
  const dispBox = (n) => (isCard(n) ? { x: n.x, y: n.y, w: CARD_W, h: cardH.get(n.id) || (n.collapsed ? n.h : 160) } : n);
  const W = createWires(app, { cv, layer: linksS, dom, toWorld, drag, hint, HINT, alias, shown });
  let soonF = 0;
  let locked = false;   // canvas.lock() : les gestes sont figés (seul le déplacement de la vue reste)
  // rien ne défile jamais sous la planche : la vue est la seule vérité (un
  // champ qui prend le focus ferait sinon glisser la page)
  for (const n of [cv, cv.parentElement, cv.closest('.ide'), document.body]) {
    n?.addEventListener('scroll', () => { if (n.scrollLeft || n.scrollTop) { n.scrollLeft = 0; n.scrollTop = 0; } });
  }
  addEventListener('scroll', () => { if (scrollX || scrollY) scrollTo(0, 0); });

  // ── la vue ────────────────────────────────────────────────
  // --z (dont dépendent les filets et les poignées en 1/z) est hérité par chaque
  // objet : le changer à chaque image d'un zoom restylerait toute la planche
  // (20 ms par image à 1000 objets, mesuré). Pendant le geste, la planche garde
  // le zoom « efficace » d'avant ; il se pose 150 ms après (getEfficientZoomLevel
  // de tldraw), avec le niveau du zoom sémantique.
  let viewT = 0, resT = 0, viewF = 0, zT = 0, zShown = null, level = null, lastZ = null, gridOn = null;
  function showZ(z, { quiet = false } = {}) {
    zShown = z;
    cv.style.setProperty('--z', z);
    const lv = z < FAR ? 'far' : z > NEAR ? 'near' : 'work';
    const changed = lv !== level;
    level = lv;
    cv.classList.toggle('far', lv === 'far');
    cv.classList.toggle('near', lv === 'near');
    cv.dataset.level = lv;
    if (quiet || !S.board) return;
    // un groupe « se réduit de loin » qui passe sous (ou au-dessus de) 240 px à l'écran : la planche se refait
    if (wantCards() !== cardsKey) { render(); return; }
    // de loin, les cartes n'ont plus leurs lignes : leurs ports et leurs fils se replacent
    if (changed) { measure(); W.placePorts(); paintLinks(); }
  }
  function applyView() {
    const v = V();
    world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    // ce qui ne dépend que du zoom ne s'écrit que quand le zoom change (un déplacement ne restyle rien d'autre)
    if (v.z !== lastZ) {
      lastZ = v.z;
      // les liens en pixels d'écran : --iz = 1 / zoom sur leur seul <svg> (wires.js zoom)
      W.zoom(v.z);
      // la trame posée sur le fond lui-même, sans variable héritée par les objets
      const g = GRID * v.z * (v.z < 0.3 ? 4 : v.z < 0.6 ? 2 : 1);
      cv.style.backgroundSize = `${g}px ${g}px`;
      const t = `${Math.round(v.z * 100)} %`;
      if (pct.textContent !== t) pct.textContent = t;
    }
    if (zShown === null) showZ(v.z);
    else if (v.z !== zShown) { clearTimeout(zT); zT = setTimeout(() => showZ(V().z), 150); }
    cv.style.backgroundPosition = `${v.x}px ${v.y}px`;
    if (gridOn !== !!S.grid) { gridOn = !!S.grid; cv.classList.toggle('nogrid', !gridOn); gridB.classList.toggle('on', gridOn); }
    paintMini();
    scheduleCull();
    sel.follow();
    cancelAnimationFrame(viewF);
    viewF = requestAnimationFrame(() => app.emit?.('view', V()));
    clearTimeout(viewT);
    viewT = setTimeout(() => { if (S.board) app.LS('view-' + S.board.id, S.view); }, 400);
    clearTimeout(resT);
    resT = setTimeout(swapRes, 220);
  }
  // la vue d'une planche qu'on ouvre, posée AVANT le premier rendu : les images se
  // choisissent au bon zoom (une vue gardée, sinon toute la planche à l'écran)
  function prime(v) {
    const b = bbox(S.board?.nodes || []);
    Object.assign(V(), v && Number.isFinite(v.z) ? v : b ? viewFor(b) : { x: cv.clientWidth / 2, y: cv.clientHeight / 2, z: 1 });
    clearTimeout(zT);
    showZ(V().z, { quiet: true });
  }
  // La boîte ne change que si la planche change de taille ou de place dans la page : gardée jusqu'à un
  // redimensionnement (ResizeObserver plus haut, la fenêtre), et relue quand la souris revient sur la planche (une
  // barre latérale qui s'est ouverte entre-temps). Le déplacement de la vue (transform) ne la change pas.
  const rect = () => rectC || (rectC = cv.getBoundingClientRect());
  addEventListener('resize', () => { rectC = null; });
  cv.addEventListener('pointerenter', () => { rectC = null; });
  function zoomAt(nz, sx, sy) {
    const v = V(), k = clamp(nz, ZMIN, ZMAX) / v.z;
    v.x = sx - (sx - v.x) * k; v.y = sy - (sy - v.y) * k; v.z *= k;
    applyView();
  }
  const zoomBy = (k) => zoomAt(V().z * k, cv.clientWidth / 2, cv.clientHeight / 2);
  const zoomTo = (z) => zoomAt(z, cv.clientWidth / 2, cv.clientHeight / 2);
  // monde ↔ écran (coordonnées de la fenêtre, comme clientX / clientY)
  function toWorld(cx, cy) {
    const r = rect(), v = V();
    return [(cx - r.left - v.x) / v.z, (cy - r.top - v.y) / v.z];
  }
  function toScreen(wx, wy) {
    const r = rect(), v = V();
    return [r.left + v.x + wx * v.z, r.top + v.y + wy * v.z];
  }
  // la vue qui montre une zone du monde { x, y, w, h } : marge `pad`, zoom au plus `zmax`
  function viewFor(b, pad = 70, zmax = 1.5) {
    const top = 30;
    const z = clamp(Math.min((cv.clientWidth - 2 * pad) / Math.max(b.w, 1), (cv.clientHeight - 2 * pad - top) / Math.max(b.h, 1)), ZMIN, zmax);
    return { z, x: (cv.clientWidth - b.w * z) / 2 - b.x * z, y: (cv.clientHeight - b.h * z) / 2 - b.y * z + top / 2 };
  }
  // voler jusqu'à une cible : une vue { x, y, z }, une zone { x, y, w, h }, un objet (son id) ;
  // rend une promesse tenue à l'arrivée (ms: 0 : sans animation)
  let flyF = 0;
  function flyTo(target, { ms = 420, pad = 70, zmax = 1.5 } = {}) {
    const t = typeof target === 'string' ? app.node(target) : target;
    if (!t) return Promise.resolve(false);
    const to = Number.isFinite(t.z) && !Number.isFinite(t.w) ? { x: t.x, y: t.y, z: clamp(t.z, ZMIN, ZMAX) } : viewFor(t, pad, zmax);
    cancelAnimationFrame(flyF);
    const v = V(), from = { ...v }, t0 = performance.now();
    if (!ms) { Object.assign(v, to); applyView(); return Promise.resolve(true); }
    return new Promise((done) => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
        // le zoom en géométrique (régulier à l'œil), la position en douceur
        Object.assign(v, { z: from.z * (to.z / from.z) ** e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
        applyView();
        if (k < 1) flyF = requestAnimationFrame(step); else done(true);
      };
      flyF = requestAnimationFrame(step);
    });
  }
  function viewRect() {
    const v = V();
    const [w, h] = size();
    return { x: -v.x / v.z, y: -v.y / v.z, w: w / v.z, h: h / v.z };
  }
  const center = () => { const r = viewRect(); return [r.x + r.w / 2, r.y + r.h / 2]; };
  function fit(target) {
    const b = target || bbox(S.board?.nodes || []);
    if (!b) { Object.assign(V(), { x: cv.clientWidth / 2, y: cv.clientHeight / 2, z: 1 }); applyView(); return; }
    Object.assign(V(), viewFor(b));
    applyView();
  }

  // ── hors de la vue : ni stylé ni peint (display: none, le culling de tldraw) ──
  // Une marge d'un quart d'écran ; un objet choisi ou où l'on écrit reste affiché.
  let cullF = 0;
  function scheduleCull() { if (!cullF) cullF = requestAnimationFrame(() => { cullF = 0; cull(); }); }
  function cullRect() {
    const r = viewRect(), mx = r.w * CULL, my = r.h * CULL;
    return { x: r.x - mx, y: r.y - my, w: r.w + 2 * mx, h: r.h + 2 * my };
  }
  function cull() {
    if (!S.board) return;
    const q = cullRect();
    const act = document.activeElement;
    let back = false;
    for (const n of S.board.nodes) {
      const d = dom.get(n.id);
      if (!d) continue;
      // le nom d'un cadre est posé au-dessus de lui : la marge le couvre
      const off = !hits(dispBox(n), q) && !S.sel.has(n.id) && !(act && d.el.contains(act));
      if (d.off !== off) {
        d.off = off;
        d.el.style.display = off ? 'none' : '';
        if (off) lowRes(n, d.el);
        else if (CARDS.has(n.type)) back = true;
      }
    }
    // une carte qui revient : ses ports se replacent à la hauteur de leurs lignes
    if (back) reflow();
  }

  // ── la définition d'une image : celle de sa taille à l'écran ──
  // La plus petite copie d'affichage dont le grand côté couvre max(w, h) × zoom ×
  // densité de pixels (commun/proxies.js, pickView) ; au-delà de la plus grande,
  // l'original. Seulement pour ce qui est dans la vue, jamais pendant le geste
  // (220 ms après) ; décodée avant l'échange (swap) ; une image qu'on regarde ne
  // redescend pas (pas de va-et-vient au seuil), une image qui sort de la vue
  // retombe à la plus petite (la mémoire suit ce qu'on voit). Sans copies (rangée
  // avant elles) : la vignette tant qu'elle suffit, sinon l'original.
  // (recadrée : l'image entière est plus grande que l'objet, de 1 / crop.w et 1 / crop.h)
  const pickSrc = (n, it, z = V().z) => pickView(it, Math.max(n.w / (n.crop?.w || 1), n.h / (n.crop?.h || 1)) * z);
  function swapRes() {
    for (const n of S.board?.nodes || []) {
      if (n.type !== 'media' || n.kind !== 'image') continue;
      const d = dom.get(n.id);
      if (!d || d.off) continue;
      const img = d.el.querySelector('img');
      const it = S.items.get(n.item);
      if (!img || !it || it.missing) continue;
      const p = pickSrc(n, it);
      swap(img, p.url, p.w);
    }
  }
  function lowRes(n, e) {
    if (n.type !== 'media' || n.kind !== 'image') return;
    const it = S.items.get(n.item);
    const img = it && !it.missing && e.querySelector('img');
    if (!img) return;
    const p = pickView(it, 1);
    if (p.url && p.w < (+img.dataset.vw || 0)) swap(img, p.url, p.w, { force: true });
  }

  // ── les groupes montrés en carte ──────────────────────────
  function wantCards() {
    const out = [];
    const far = level === 'far', z = zShown ?? V().z;
    for (const g of S.board?.nodes || []) {
      if (g.type !== 'group') continue;
      if (g.collapsed || (g.lod && far && Math.max(g.w, g.h) * z < LOD_PX)) out.push(g.id);
    }
    return out.join(',');
  }
  function computeCards() {
    cardsKey = wantCards();
    cards = new Set(cardsKey ? cardsKey.split(',') : []);
    hidden = new Map();
    // la descendance d'un nœud de mind map replié (objets/mindmap.js) : cachée comme les enfants
    // d'un groupe réduit — ni peinte, ni choisie ; ses flèches vont au nœud replié
    for (const [id, by] of app.objets?.folded() || []) hidden.set(id, by);
    if (!cards.size) return;
    const K = kidsMap(S.board);
    for (const gid of cards) for (const k of K.get(gid) || []) {
      hidden.set(k.id, gid);
      // un cadre du groupe réduit cache aussi ce qu'il contient
      if (k.type === 'frame') for (const m of S.board.nodes) if (m !== k && m.type !== 'group' && inside(m, k)) hidden.set(m.id, gid);
    }
  }
  // un fil dont un bout est caché dans un groupe réduit part du port de la carte (wires.js)
  function alias(id, port, side) {
    const gid = hidden.get(id);
    if (!gid) return null;
    const g = app.node(gid);
    if (!g) return null;
    const b = dispBox(g);
    const y = cardPortY.get(gid)?.get(`${side}:${id}|${port}`);
    return [side === 'out' ? b.x + b.w : b.x, b.y + (y ?? Math.min(36, b.h / 2))];
  }
  // les liens vus depuis les cartes : ceux du dedans se cachent, les flèches vont au bord de la carte
  function shown(l, a, b) {
    const ga = hidden.get(a.id), gb = hidden.get(b.id);
    const stand = (gid) => { const g = app.node(gid); return { ...g, ...dispBox(g) }; };
    const disp = (n) => (isCard(n) && !n.collapsed ? stand(n.id) : n);
    if (!ga && !gb) return [disp(a), disp(b)];
    if (ga && ga === gb) return null;
    if (l.kind === 'wire') return [a, b];
    return [ga ? stand(ga) : disp(a), gb ? stand(gb) : disp(b)];
  }

  // ── les objets ────────────────────────────────────────────
  function keyOf(n) {
    if (n.type === 'group') return cards.has(n.id) ? 'card|' + cardKey(n) : `gp|${n.name}`;
    const it = n.type === 'media' ? S.items.get(n.item) : null;
    // la place, la taille et l'appartenance ne refont pas l'objet : `place` les suit
    const { x, y, w, h, jobs, group, ...rest } = n;
    // un modèle 3D : l'éclairage et le canal passent à sa visionneuse par message (objets/modele3d.js) —
    // la refaire la rechargerait, et perdrait la vue qu'on y a prise
    if (n.type === 'model3d') { delete rest.light; delete rest.chan; }
    const extra = n.type === 'gen' ? app.gen.cardKey(n) : n.type === 'vgen' ? app.video.cardKey(n) : n.type === 'compose' ? app.composer.cardKey(n)
      : app.objets?.has(n.type) ? app.objets.key(n) : '';
    return JSON.stringify(rest) + (it ? `|${it.updated || ''}${it.missing ? 'x' : ''}${viewsOf(it)[0]?.url || ''}` : '|?') + extra;
  }
  function place(e, n) {
    if (n.type === 'group' && cards.has(n.id)) {
      e.style.left = `${n.x}px`; e.style.top = `${n.y}px`; e.style.width = `${CARD_W}px`; e.style.height = '';
      return;
    }
    e.style.left = `${n.x}px`; e.style.top = `${n.y}px`; e.style.width = `${n.w}px`;
    e.style.height = AUTO_H.has(n.type) ? '' : `${n.h}px`;
    if (n.type === 'frame') e.style.setProperty('--fw', `${n.w}px`);
    // un texte mis à l'échelle pendant un geste : sa taille et sa largeur suivent sans qu'il soit refait
    if (n.type === 'text') { e.style.setProperty('--ts', `${n.size || 14}px`); e.classList.toggle('wrap', !!n.wrap); e.classList.toggle('auto', !n.wrap); }
    if (e.dataset.g !== (n.group || '')) e.dataset.g = n.group || '';
  }
  // les ports d'un objet (ports.js) : ses entrées à gauche, sa sortie à droite, dans la teinte de ce qu'ils portent
  const accepts = (p) => p.accepts.map((k) => KINDS[k].label).join(' ou ');
  function ports(n, { resize = true } = {}) {
    const out = [];
    for (const p of inPorts(n, app.caps())) {
      out.push(el('span', { class: 'pt in' + (p.max === 0 ? ' shut' : '') + (p.lock ? ' lock' : ''), 'data-port': p.id, 'data-side': 'in',
        style: { '--k': `var(--${KINDS[p.accepts[0]].color})` },
        title: p.max === 0 ? `${p.label} : ${p.why}` : p.lock ? `${p.label} : case verrouillée` : `entrée · ${p.label} — ${accepts(p)}${p.max && p.max > 1 ? ` · ${p.max} au plus` : ''} · tirer : de quoi la remplir` }));
    }
    const o = outPort(n);
    if (o) {
      out.push(el('span', { class: 'pt out', 'data-port': o.id, 'data-side': 'out', style: { '--k': `var(--${KINDS[o.kind].color})` },
        title: `sortie · ${KINDS[o.kind].label}${CARDS.has(n.type) && n.type !== 'compose' ? ' (le dernier résultat)' : ''} — tirer vers une entrée` }));
    }
    if (resize) out.push(el('span', { class: 'rz', 'data-rz': '1', title: 'redimensionner' }));
    return out;
  }

  // un objet refait : les modules greffés peuvent l'habiller (canvas.decorate(fn) : fn(n, el))
  const decorators = new Set();
  function build(n) {
    const e = buildRaw(n);
    for (const f of decorators) { try { f(n, e); } catch (err) { console.error('idéation · decorate', err); } }
    return e;
  }
  function decorate(fn) {
    decorators.add(fn);
    for (const [id, d] of dom) { const n = app.node(id); if (n) { try { fn(n, d.el); } catch (err) { console.error('idéation · decorate', err); } } }
    return () => decorators.delete(fn);
  }
  function buildRaw(n) {
    if (n.type === 'frame') {
      return el('div', { class: 'fr', 'data-id': n.id },
        el('div', { class: 'fr-h', 'data-id': n.id, title: 'glisser le cadre · double-clic : le renommer' },
          el('b', { class: 'fr-n' }, n.name || 'Cadre'), el('span', { class: 'fr-c' })),
        // de loin (Ensemble) : le nom en grand, au centre, sur un voile (le prototype de Cal)
        el('div', { class: 'fr-big' }, el('b', {}, n.name || 'Cadre'), el('span', { class: 'fr-bc' })),
        // le coin, et les deux bords (un côté seulement) : un cadre se redimensionne comme dans Miro
        el('span', { class: 'rz', 'data-rz': '1', title: 'redimensionner · Alt : sans aimant' }),
        el('span', { class: 'rz rz-e', 'data-rz': 'x', title: 'la largeur · Alt : sans aimant' }),
        el('span', { class: 'rz rz-s', 'data-rz': 'y', title: 'la hauteur · Alt : sans aimant' }));
    }
    if (n.type === 'group') return cards.has(n.id) ? groupCard(n) : el('div', { class: 'gp', 'data-id': n.id }, el('span', { class: 'gp-n' }, n.name || 'Groupe'));
    // les objets d'atelier (objets/) : formes, cartes, nœuds de mind map, traits de crayon
    const ob = app.objets?.has(n.type) ? app.objets.build(n) : null;
    if (ob) {
      return el('div', { class: ['nd', n.type, ...(ob.cls || [])].join(' '), 'data-id': n.id, 'data-g': n.group || '', style: ob.style || {} },
        ...ob.body, ...ports(n, { resize: !ob.noResize }));
    }
    const cls = ['nd', n.type];
    const style = {};
    let body = [];
    if (n.type === 'media') { cls.push(n.kind); body = media(n); }
    else if (n.type === 'note' || n.type === 'sticky' || n.type === 'title') {
      if (n.type === 'sticky') {
        const c = S.meta?.sticky?.find((s) => s.id === n.color) || { id: n.color, ink: 'on-light' };
        style['--k'] = `var(--${c.id})`; style['--ki'] = `var(--${c.ink})`;
      }
      if (n.type === 'title') cls.push('sz-' + (n.size || 'm'));
      const ph = { note: 'une note — double-clic pour écrire', sticky: 'un post-it', title: 'un titre' }[n.type];
      body = [el('div', { class: 'txt' + (n.text ? '' : ' ph') }, n.text || ph)];
    } else if (n.type === 'gen') body = app.gen.card(n);
    else if (n.type === 'vgen') { cls.push('gen'); body = app.video.card(n); }
    else if (n.type === 'compose') body = app.composer.card(n);
    else if (n.type === 'palette') {
      body = [el('div', { class: 'sws' }, ...(n.colors || []).map((c) =>
        // une couleur tirée d'une image : une donnée, pas une teinte du thème
        // pas un bouton : un bouton retient le clic et empêche de déplacer le nuancier (Cal, 02/10) ; la copie est au
        // clic droit (menus.js, « Copier cette couleur »)
        el('div', { class: 'sw', 'data-c': c, title: `${c} — clic droit : copier`, style: { background: c } },
          el('span', {}, c))))];
    }
    const e = el('div', { class: cls.join(' '), 'data-id': n.id, 'data-g': n.group || '', style }, ...body, el('div', { class: 'jobs' }), ...ports(n));
    if (n.type === 'media' && n.kind === 'video') {
      const v = e.querySelector('video');
      if (v) {
        e.addEventListener('pointerenter', () => { survolSon(v); });   // avec le son (Cal, 01/10)
        e.addEventListener('pointerleave', () => { v.pause(); });
      }
    }
    return e;
  }

  // un groupe réduit : une carte de 280 px, comme le nœud replié d'un sous-graphe de
  // ComfyUI — son nom, ce qu'il contient, une mosaïque des quatre premières images, et
  // ses ports : les fils qui traversent sa frontière (entrées à gauche, sorties à droite)
  function groupParts(g) {
    const kids = kidsOf(S.board, g.id);
    const io = crossing(S.board, new Set(kids.map((k) => k.id)));
    return { kids, io };
  }
  function cardKey(g) {
    const { kids, io } = groupParts(g);
    const F = app.flow();
    const pk = (p) => p.key + p.links.map((l) => (F.state(l.id)?.ok ? 1 : 0)).join('');
    return JSON.stringify([g.name, g.collapsed, kids.map((k) => k.item || k.type), io.ins.map(pk), io.outs.map(pk),
      kids.slice(0, 6).map((k) => (k.item ? smallest(S.items.get(k.item)) : '')), kids.map((k) => app.label(k)).join('|').length]);
  }
  function groupCard(g) {
    const { kids, io } = groupParts(g);
    const F = app.flow();
    const imgs = kids.filter((k) => k.type === 'media' && k.kind !== 'audio').slice(0, 4);
    const gens = kids.filter((k) => k.type === 'gen' || k.type === 'vgen').length;
    const port = (p, side) => {
      const kind = side === 'out' ? p.port : p.links[0]?.pa || 'text';
      const bad = p.links.some((l) => !F.state(l.id)?.ok);
      const lab = portLabel(app, p, side);
      return el('span', { class: `pt ${side} on${bad ? ' bad' : ''}`, 'data-port': p.port, 'data-side': side, 'data-inner': p.inner,
        'data-key': `${side}:${p.inner}|${p.port}`, style: { '--k': `var(--${KINDS[kind]?.color || 'ink3'})` },
        title: `${side === 'out' ? 'sortie' : 'entrée'} · ${lab} — ${p.links.length} fil${p.links.length > 1 ? 's' : ''} · tirer : un fil depuis l’objet intérieur` });
    };
    const rows = [];
    for (let i = 0; i < Math.max(io.ins.length, io.outs.length); i++) {
      const a = io.ins[i], b = io.outs[i];
      rows.push(el('div', { class: 'gpr' },
        el('span', { class: 'gpl' }, a ? portLabel(app, a, 'in') : ''), el('span', { class: 'gpl r' }, b ? portLabel(app, b, 'out') : ''),
        a ? port(a, 'in') : null, b ? port(b, 'out') : null));
    }
    const count = `${kids.length} objet${kids.length > 1 ? 's' : ''}${gens ? ` · ${gens} génération${gens > 1 ? 's' : ''}` : ''}`;
    return el('div', { class: 'nd grp' + (g.collapsed ? '' : ' lod'), 'data-id': g.id, title: g.collapsed ? 'double-clic : déplier' : 'de loin, ce groupe s’affiche en carte — double-clic : y aller' },
      el('div', { class: 'ghead' }, el('span', { class: 'k lbl' }, g.collapsed ? 'groupe réduit' : 'groupe · de loin'), el('span', { class: 'sp' }),
        el('span', { class: 'lbl' }, layoutOf(g).mode === 'flow' ? 'rangée' : 'libre')),
      el('b', { class: 'gname' }, g.name || 'Groupe'),
      el('span', { class: 'gcount lbl' }, count),
      imgs.length ? el('div', { class: 'gmos n' + imgs.length }, ...imgs.map((k) => {
        const src = smallest(S.items.get(k.item));
        return el('i', { style: { backgroundImage: src ? `url("${href(src)}")` : null } });
      })) : null,
      rows.length ? el('div', { class: 'gprs' }, ...rows) : el('p', { class: 'ghint' }, 'aucun fil ne traverse ce groupe'));
  }

  function media(n) {
    const it = S.items.get(n.item);
    if (!it) return [el('div', { class: 'miss' }, el('span', { class: 'lbl' }, 'chargement'))];
    if (it.missing) {
      return [el('div', { class: 'miss' }, el('b', {}, 'absent'), el('span', {}, 'cet objet a quitté la bibliothèque (corbeille d’Asset ?)'),
        el('small', { class: 'lbl' }, n.title || n.item))];
    }
    // la légende ; de près (Détail), elle reste sous l'image avec sa taille et son modèle
    const meta = [it.width && it.height ? `${it.width}×${it.height}` : '', it.duration ? fmtDur(it.duration) : '',
      (it.origin?.model || it.origin?.tool || '').replace(/-factice$/, ' (factice)')].filter(Boolean).join(' · ');
    const cap = el('span', { class: 'cap' }, el('span', { class: 'ct' }, it.title || it.id), meta ? el('span', { class: 'cm' }, ` · ${meta}`) : null);
    if (n.kind === 'image') {
      // posée hors de la vue : la plus petite copie ; dans la vue : celle de sa taille à l'écran
      const p = hits(n, cullRect()) ? pickSrc(n, it) : pickView(it, 1);
      // recadrée (objets/recadrer.js) : l'image entière, posée pour que le rectangle `crop` remplisse l'objet
      const c = n.crop;
      const style = c ? { width: `${100 / c.w}%`, height: `${100 / c.h}%`, left: `${-100 * c.x / c.w}%`, top: `${-100 * c.y / c.h}%` } : null;
      return [el('div', { class: 'imc' }, el('img', { class: c ? 'cr' : null, src: p.url, 'data-vw': String(p.w), decoding: 'async', alt: it.title || '', draggable: 'false', style })), cap];
    }
    if (n.kind === 'video') {
      const v = el('video', { src: href(it.url), poster: it.thumb_url ? href(it.thumb_url) : null, muted: true, loop: true, playsinline: true, preload: 'metadata' });
      v.muted = true;
      return [v, el('span', { class: 'badge' }, 'vidéo', it.duration ? ` · ${fmtDur(it.duration)}` : ''), cap];
    }
    if (n.kind === 'audio') {
      const a = el('audio', { src: href(it.url), preload: 'none' });
      const b = el('button', { class: 'play', type: 'button', title: 'écouter' }, 'Écouter');
      b.addEventListener('click', () => (a.paused ? a.play().catch((e) => toast(e.message)) : a.pause()));
      a.addEventListener('play', () => { b.textContent = 'Pause'; b.classList.add('on'); });
      a.addEventListener('pause', () => { b.textContent = 'Écouter'; b.classList.remove('on'); });
      return [el('span', { class: 'k lbl' }, 'son'), el('div', { class: 'nm' }, it.title || it.id),
        el('div', { class: 'arow' }, b, el('span', { class: 'lbl' }, it.duration ? fmtDur(it.duration) : '')), a];
    }
    const refs = it.element?.refs || [];
    // ses références : cinq sous l'image, toutes de près (Détail)
    return [el('div', { class: 'eim', style: { backgroundImage: refs[0] || it.thumb_url ? `url("${href(refs[0]?.thumb_url || it.thumb_url)}")` : null } }),
      el('div', { class: 'ecap' }, el('b', {}, it.title || 'élément'),
        el('span', { class: 'lbl' }, `${etypeFr(it.element?.type)} · ${refs.length} réf.`)),
      el('div', { class: 'estrip' }, ...refs.slice(1).map((r) => el('i', { title: r.label || r.role || '', style: { backgroundImage: `url("${href(r.thumb_url)}")` } })))];
  }

  function render() {
    cancelAnimationFrame(soonF);
    if (!S.board) { framesL.replaceChildren(); groupsL.replaceChildren(); nodesL.replaceChildren(); linksS.replaceChildren(); dom.clear(); paintEmpty(); sel.hide(); return; }
    app.flowNow();            // ce qui passe dans les fils, relu une fois par rendu
    // les mind maps se rangent depuis leur racine (objets/mindmap.js), avant les groupes qui peuvent les déplacer
    app.objets?.layout(S.board);
    // les groupes se remettent en forme (rangée, même taille) et prennent la boîte de leurs enfants
    layoutAll(S.board);
    computeCards();
    const nodes = S.board.nodes;
    // les grands cadres dessous : un cadre posé dans un autre reste visible
    const frames = nodes.filter((n) => n.type === 'frame' && !hidden.has(n.id)).sort((a, b) => b.w * b.h - a.w * a.h);
    const outlines = nodes.filter((n) => n.type === 'group' && !cards.has(n.id));
    const others = nodes.filter((n) => n.type !== 'frame' && (n.type === 'group' ? cards.has(n.id) : !hidden.has(n.id)));
    const seen = new Set();
    // l'objet où l'on écrit n'est pas refait sous les doigts : il le sera à la sortie. Seul un
    // champ de saisie protège ainsi sa carte — un sélecteur ou un bouton qu'on vient de toucher
    // (changer de modèle, de mode) la laisse se refaire à l'instant, ses entrées avec elle
    const act = document.activeElement;
    const typing = act?.matches?.('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), [contenteditable="true"], [contenteditable="plaintext-only"]') ? act : null;
    const sync = (layer, list) => list.forEach((n, i) => {
      seen.add(n.id);
      const key = keyOf(n);
      let d = dom.get(n.id);
      // tenue à cause d'un champ où l'on écrit : elle se refait dès qu'on le quitte, jamais plus tard
      if (d && d.key !== key && typing && d.el.contains(typing) && !d.held) {
        d.held = true;
        typing.addEventListener('blur', () => { d.held = false; renderSoon(); }, { once: true });
      }
      // un objet texte en cours d'écriture (objets/texte.js) ne se refait pas non plus quand le focus
      // est parti à un menu de sa barre (police, couleur) : sa sélection y est gardée ; il se refait à la fin
      if (!d || (d.key !== key && !(typing && d.el.contains(typing)) && !(n.type === 'text' && app.texte?.editing(n.id)))) {
        const e = build(n);
        if (d) d.el.replaceWith(e);
        d = { el: e, key };
        dom.set(n.id, d);
      }
      place(d.el, n);
      if (layer.children[i] !== d.el) layer.insertBefore(d.el, layer.children[i] || null);
    });
    sync(framesL, frames);
    sync(groupsL, outlines);
    sync(nodesL, others);
    for (const [id, d] of dom) if (!seen.has(id)) { d.el.remove(); dom.delete(id); }
    measure();
    // une hauteur mesurée (une note qui grandit) refait la rangée de son groupe
    if (layoutAll(S.board)) for (const n of nodes) if (n.group || n.type === 'group') { const d = dom.get(n.id); if (d) place(d.el, n); }
    measureCards();
    W.placePorts();
    paintFrames();
    paintLinks();
    W.paintPorts();
    paintSel();
    paintEmpty();
    for (const n of nodes) if (n.jobs) paintJobs(n.id, n);
    paintMini();
    cull();
  }
  // un rendu à la prochaine image : ce qu'on tape dans une note ou une case suit, en direct,
  // dans les cartes qui la lisent (la note où l'on écrit n'est pas refaite sous les doigts)
  function renderSoon() {
    cancelAnimationFrame(soonF);
    soonF = requestAnimationFrame(() => { render(); app.insp?.render(); });
  }
  // une carte a changé de hauteur (une case qui grandit) : ses ports et ses fils suivent,
  // une fois par image au plus
  let flowF = 0;
  function reflow() {
    cancelAnimationFrame(flowF);
    flowF = requestAnimationFrame(() => { measure(); W.placePorts(); paintLinks(); });
  }

  // la hauteur des objets qui suivent leur contenu. Une mesure n'est pas un geste : elle
  // ne salit pas la planche (rien ne s'enregistre à l'ouverture, deux personnes qui ouvrent
  // la même planche ne se mettent pas en conflit) et n'entre pas dans l'annulation ; la
  // hauteur mesurée part avec le prochain vrai geste. De loin, une carte n'a plus que son
  // résumé : sa hauteur n'est pas relevée.
  function measure() {
    let changed = false;
    const far = cv.classList.contains('far');
    for (const n of S.board?.nodes || []) {
      if (n.type === 'group') {
        if (!cards.has(n.id)) continue;
        const h = dom.get(n.id)?.el.offsetHeight;
        if (h) { cardH.set(n.id, h); if (n.collapsed && Math.abs(h - n.h) > 0.5) { n.h = Math.round(h); changed = true; } }
        continue;
      }
      if (!AUTO_H.has(n.type) || (far && CARDS.has(n.type))) continue;
      // un texte en largeur auto (objets/texte.js) : sa boîte suit ce qu'on tape, en largeur aussi
      if (n.type === 'text' && !n.wrap) {
        const w = dom.get(n.id)?.el.offsetWidth;
        if (w && Math.abs(w - n.w) > 0.5) { n.w = Math.round(w); changed = true; }
      }
      const h = dom.get(n.id)?.el.offsetHeight;
      if (h && Math.abs(h - n.h) > 0.5) { n.h = Math.round(h); changed = true; }
    }
    return changed;
  }
  // la hauteur de chaque port d'une carte de groupe (le bout de ses fils)
  function measureCards() {
    for (const gid of cards) {
      const e = dom.get(gid)?.el;
      if (!e || e.offsetParent === null) continue;
      const m = new Map();
      for (const p of e.querySelectorAll('.pt[data-key]')) { const r = p.parentElement; m.set(p.dataset.key, r.offsetTop + r.offsetHeight / 2); }
      cardPortY.set(gid, m);
    }
  }
  function paintFrames() {
    const all = S.board?.nodes || [];
    for (const f of all) {
      if (f.type !== 'frame') continue;
      const e = dom.get(f.id)?.el;
      const k = all.filter((n) => n !== f && n.type !== 'group' && !hidden.has(n.id) && inside(n, f)).length;
      const t = `${k} objet${k > 1 ? 's' : ''}`;
      const c = e?.querySelector('.fr-c'), c2 = e?.querySelector('.fr-bc');
      if (c) c.textContent = t;
      if (c2) c2.textContent = t;
    }
  }
  function paintSel() {
    const solo = S.sel.size === 1;
    for (const [id, d] of dom) {
      d.el.classList.toggle('sel', S.sel.has(id));
      d.el.classList.toggle('solo', solo && S.sel.has(id));
      // un enfant d'un groupe fermé : le survol montre son groupe, pas lui
      const g = d.el.dataset.g;
      if (g !== undefined) d.el.classList.toggle('ingrp', !!g && g !== S.focus);
    }
    if (S.focus) dom.get(S.focus)?.el.classList.add('open');
    for (const [id, d] of dom) if (id !== S.focus && d.el.classList.contains('open')) d.el.classList.remove('open');
    for (const g of linksS.querySelectorAll('g[data-link]')) g.classList.toggle('sel', g.dataset.link === S.link);
    sel.paint();
  }
  function paintEmpty() {
    const has = !!S.board?.nodes.length;
    empty.hidden = has;
    if (!has) {
      empty.replaceChildren(el('b', {}, S.board ? 'Planche vide' : 'Aucune planche ouverte'),
        el('p', {}, S.board
          ? 'Glissez des images, des vidéos, des sons, des personnages depuis la bibliothèque (à gauche), déposez des fichiers du disque, ou double-cliquez sur le fond : une note, un cadre, une carte Générer image ou vidéo, un composeur de prompt.'
          : 'Ouvrez une planche ou créez-en une : elle s’enregistre seule, à chaque geste.'),
        el('div', { class: 'row' }, ...(S.board
          ? [el('button', { class: 'tb ghost sm sr-studio', type: 'button', onclick: () => app.addAt('gen', ...center()) }, 'Générer image'),   // sr-studio : retiré sans le Studio (shell.css)
            el('button', { class: 'tb ghost sm sr-studio', type: 'button', onclick: () => app.addAt('vgen', ...center()) }, 'Générer vidéo'),
            el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.addAt('compose', ...center()) }, 'Composeur'),
            el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.addAt('note', ...center()) }, 'Note'),
            el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.addAt('frame', ...center()) }, 'Cadre')]
          : [el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.boardsModal() }, 'Les planches'),
            el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.newBoard() }, 'Nouvelle planche')])),
        // une planche vide : les modèles, à portée de main (motion design compris : ideation/galerie.js)
        S.board ? el('div', { class: 'gal-w' }, el('span', { class: 'lbl' }, 'ou commencer avec un modèle'), galerie(app)) : null);
    }
    empty.classList.toggle('with-gal', !has && !!S.board);
    const stub = (S.cfg?.backend || S.meta?.backend) === 'stub';
    banner.hidden = !stub || !S.board;
    banner.replaceChildren(el('b', {}, 'Moteur factice'), el('span', {}, `Générer image, Variations et Éditer rendent des mires dessinées${S.mopts && S.mopts.engine !== 'h3' ? ', Générer vidéo une vidéo d’essai (ffmpeg)' : ''} : aucun modèle n’est chargé. Le câblage : page Admin.`));
  }

  // les travaux en cours d'un objet : une barre par travail
  function paintJobs(id, node = null) {
    const n = node || app.node(id);
    const box = dom.get(id)?.el.querySelector('.jobs');
    if (!n || !box) return;
    const list = (n.jobs || []).map((j) => S.jobs.get(j.id) || { id: j.id, state: 'queued', message: 'en file' });
    // une carte qui calcule se grise (Cal, 01/10) ; sa barre de progression, elle, reste vive
    dom.get(id)?.el.classList.toggle('busy', list.some((j) => j.state === 'queued' || j.state === 'running'));
    if (!list.length && !box.firstChild) return;
    box.replaceChildren(...list.map((j) => el('div', { class: 'jb ' + j.state, title: j.message || '' },
      el('span', { class: 'lbl' }, `${j.state === 'running' ? (j.progress != null ? Math.round(j.progress * 100) + ' %' : 'en cours') : j.state === 'queued' ? 'en file' : j.state} · ${j.message || ''}`),
      el('i', { style: { width: `${Math.round((j.progress ?? (j.state === 'queued' ? 0 : 0.1)) * 100)}%` } }))));
  }

  // ── les liens : wires.js les dessine ; la flèche qu'on tire avec l'outil L se pose par-dessus
  function paintLinks() {
    W.paint();
    // les branches des mind maps (sous les liens), les flèches en pointillé (objets/)
    app.objets?.paint(linksS);
    linksS.append(temp);
  }

  // ── la mini-carte ─────────────────────────────────────────
  let miniF = 0;
  let miniT = null;
  function paintMini() { cancelAnimationFrame(miniF); miniF = requestAnimationFrame(drawMini); }
  // les teintes de la mini-carte : lues une fois, relues quand le thème change (getComputedStyle à chaque image
  // forçait un recalcul des styles de toute la page)
  let toks = null;
  const miniTok = (k) => {
    if (!toks) toks = { cs: getComputedStyle(document.documentElement), m: new Map() };
    if (!toks.m.has(k)) toks.m.set(k, toks.cs.getPropertyValue('--' + k).trim());
    return toks.m.get(k);
  };
  document.addEventListener('sr:theme', () => { toks = null; paintMini(); });
  function drawMini() {
    const dpr = devicePixelRatio || 1, W = 188, H = 118;
    if (mini.width !== W * dpr) { mini.width = W * dpr; mini.height = H * dpr; }
    const c = mini.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tok = miniTok;
    c.clearRect(0, 0, W, H);
    const nodes = S.board?.nodes || [];
    const vr = viewRect();
    const b = bbox([...nodes, vr]);
    const pad = 20 / Math.max(0.2, Math.min(W / b.w, H / b.h));
    const bw = b.w + 2 * pad, bh = b.h + 2 * pad;
    const k = Math.min(W / bw, H / bh);
    const ox = (W - bw * k) / 2 - (b.x - pad) * k, oy = (H - bh * k) / 2 - (b.y - pad) * k;
    miniT = { k, ox, oy };
    const R = (n) => [ox + n.x * k, oy + n.y * k, Math.max(1.5, n.w * k), Math.max(1.5, n.h * k)];
    for (const n of nodes.filter((x) => x.type === 'frame').sort((p, q) => q.w * q.h - p.w * p.h)) {
      c.fillStyle = tok('panel3'); c.fillRect(...R(n));
    }
    for (const n of nodes) {
      if (n.type === 'frame' || hidden.has(n.id) || (n.type === 'group' && !cards.has(n.id))) continue;
      c.fillStyle = app.objets?.has(n.type) ? app.objets.mini(n, tok) || tok('ink3')
        : n.type === 'group' ? tok('ink3') : n.type === 'sticky' ? tok(n.color) || tok('coral-3') : n.type === 'gen' || n.type === 'vgen' ? tok('or') : n.type === 'compose' ? tok('amb')
        : n.type === 'palette' ? (n.colors?.[0] || tok('ink3')) : n.type === 'media' ? (n.kind === 'element' ? tok('coral-2') : tok('ink3'))
          : n.type === 'title' ? tok('ink') : tok('ink2');
      if (S.sel.has(n.id)) c.fillStyle = tok('or');
      c.fillRect(...R(dispBox(n)));
    }
    c.strokeStyle = tok('cy');
    c.lineWidth = 1;
    const [vx, vy, vw, vh] = R(vr);
    c.strokeRect(vx + 0.5, vy + 0.5, vw - 1, vh - 1);
  }
  mini.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const go = (ev) => {
      if (!miniT) return;
      const r = mini.getBoundingClientRect();
      const wx = (ev.clientX - r.left - miniT.ox) / miniT.k, wy = (ev.clientY - r.top - miniT.oy) / miniT.k;
      const v = V();
      v.x = cv.clientWidth / 2 - wx * v.z; v.y = cv.clientHeight / 2 - wy * v.z;
      applyView();
    };
    go(e);
    drag(go);
  });

  // ── les gestes ────────────────────────────────────────────
  function drag(move, up) {
    const mv = (ev) => move(ev);
    const u = (ev) => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', u); removeEventListener('pointercancel', u);
      if (up) up(ev);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', u); addEventListener('pointercancel', u);
  }

  const touches = new Map();
  let pinch = null;
  addEventListener('pointerup', (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; });
  addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; });

  // la souris (règle de Cal, 29/09, comme le nodal d'ODIO) : le bouton du milieu glissé déplace
  // la vue partout sur la planche, même au-dessus d'une carte ou d'un champ ; le clic gauche
  // choisit (Maj : ajoute, Ctrl/⌘ : ajoute ou retire) ; glisser dans le vide : le cadre de
  // sélection. Espace + glisser et l'outil Main restent.
  cv.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });   // ni défilement automatique, ni collage
  cv.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  cv.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (e.button === 1) { e.preventDefault(); return startPan(e); }
    if (t.closest('.zoombox, .mini, .empty .row, .banner, .sbar, .selbox')) return;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 2) { startPinch(); return; }
    }
    const nodeEl = t.closest('[data-id]');
    if (isControl(t)) {
      if (locked) { e.preventDefault(); return; }
      if (nodeEl && !S.sel.has(nodeEl.dataset.id) && e.button === 0) app.select([unitOf(nodeEl.dataset.id)]);
      return;
    }
    if (document.activeElement && document.activeElement !== document.body && cv.contains(document.activeElement)) document.activeElement.blur();
    // figée (canvas.lock : une présentation, la machine temporelle) : on se déplace, rien d'autre
    if (e.button === 0 && (S.tool === 'hand' || S.space || locked)) { e.preventDefault(); return startPan(e); }
    // le clic droit sur un objet non choisi le choisit (son menu parle de lui) ; le menu : contextmenu
    if (e.button === 2) {
      const rid = nodeEl?.dataset.id;
      if (rid && !S.sel.has(unitOf(rid)) && !locked) app.select([unitOf(rid)]);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    // le crayon trace partout, par-dessus les objets aussi (objets/crayon.js)
    if (S.tool === 'ink' && app.objets) return app.objets.startInk(e, { cv, over, drag, toWorld });
    const id = nodeEl?.dataset.id;
    if (t.closest('[data-rz]') && id) return startResize(e, id, t.closest('[data-rz]').dataset.rz);
    const pt = t.closest('.pt[data-port]');
    // un port d'une carte de groupe : le fil part de l'objet intérieur (la carte n'est qu'un affichage)
    if (pt && id) return W.start(e, pt.dataset.inner || id, pt.dataset.port, pt.dataset.side);
    if (S.tool === 'link' && id) return startLink(e, id);
    // un outil de pose pose où l'on clique, par-dessus un objet aussi (une note sur une image)
    if (['note', 'sticky', 'title', 'gen', 'vgen', 'compose', 'frame', 'shape', 'card', 'mind', 'text'].includes(S.tool)) return startCreate(e, S.tool);
    const lk = t.closest('[data-link]');
    if (lk && !id) { app.selectLink(lk.dataset.link); return; }
    if (id) return pressNode(e, id);
    return startSelectArea(e);
  });

  function startPinch() {
    const [a, b] = [...touches.values()];
    const r = rect();
    const v0 = { ...V() };
    const m0 = [(a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top];
    const d0 = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const w = [(m0[0] - v0.x) / v0.z, (m0[1] - v0.y) / v0.z];
    pinch = true;
    const mv = (ev) => {
      if (!pinch || !touches.has(ev.pointerId)) return;
      touches.set(ev.pointerId, [ev.clientX, ev.clientY]);
      const [p, q] = [...touches.values()];
      const m = [(p[0] + q[0]) / 2 - r.left, (p[1] + q[1]) / 2 - r.top];
      const z = clamp(v0.z * Math.hypot(p[0] - q[0], p[1] - q[1]) / d0, ZMIN, ZMAX);
      Object.assign(V(), { z, x: m[0] - w[0] * z, y: m[1] - w[1] * z });
      applyView();
    };
    drag(mv);
  }

  function startPan(e) {
    const v = V(), x0 = e.clientX, y0 = e.clientY, px = v.x, py = v.y;
    cv.classList.add('panning');
    drag((ev) => { if (pinch) return; v.x = px + ev.clientX - x0; v.y = py + ev.clientY - y0; applyView(); },
      () => cv.classList.remove('panning'));
  }

  // l'unité qu'un clic choisit : le groupe d'un enfant (sauf dans le groupe ouvert par un double-clic)
  function unitOf(id) {
    const n = app.node(id);
    return n?.group && S.focus !== n.group ? n.group : id;
  }
  // les objets à emmener : la sélection, ce que contiennent ses cadres, et les enfants
  // de ses groupes — un groupe bouge toujours d'un bloc
  function carried() {
    const out = new Map();
    const K = kidsMap(S.board);
    const minds = [];
    const unit = (n) => {
      out.set(n.id, n);
      if (n.type === 'group') for (const k of K.get(n.id) || []) out.set(k.id, k);
      if (n.type === 'mind') minds.push(n);
    };
    // un cadre emmène ce qu'il contient ; un groupe, ses enfants — et un cadre de ce groupe, son contenu
    const frameOf = (n) => {
      for (const m of S.board.nodes) {
        if (m === n || !inside(m, n)) continue;
        const g = m.group && m.group !== S.focus ? app.node(m.group) : null;
        unit(g || m);
      }
    };
    for (const id of S.sel) {
      const n = app.node(id);
      if (!n) continue;
      unit(n);
      if (n.type === 'frame') frameOf(n);
      if (n.type === 'group') for (const k of K.get(n.id) || []) if (k.type === 'frame') frameOf(k);
    }
    // un nœud de mind map emmène tout son arbre (le prototype : déplacer un nœud déplace l'arbre)
    if (minds.length) for (const m of app.objets.trees(minds)) out.set(m.id, m);
    return [...out.values()];
  }
  // la place d'insertion dans une rangée (un enfant qu'on glisse dans son groupe)
  function paintSlot(rest, slot, gap) {
    if (!rest || slot < 0) { slotM.hidden = true; return; }
    const at = rest[slot] || rest[rest.length - 1];
    if (!at) { slotM.hidden = true; return; }
    const x = slot < rest.length ? at.x - gap / 2 : at.x + at.w + gap / 2;
    Object.assign(slotM.style, { left: `${x}px`, top: `${at.y}px`, height: `${at.h}px` });
    slotM.hidden = false;
  }

  function pressNode(e, rawId) {
    const id = unitOf(rawId);
    // Maj + clic ajoute ; Ctrl/⌘ + clic ajoute ou retire (les standards)
    const shift = e.shiftKey, toggle = e.ctrlKey || e.metaKey, add = shift || toggle;
    const was = S.sel.has(id);
    if (toggle) app.select([id], { toggle: true });
    else if (shift) { if (!was) app.select([id], { toggle: true }); }
    else if (!was) app.select([id]);
    if (!S.sel.has(id)) return;
    const moving = carried();
    const orig = moving.map((n) => [n, n.x, n.y]);
    const x0 = e.clientX, y0 = e.clientY, z = V().z;
    let moved = false;
    // un enfant choisi dans son groupe ouvert : il change de rang (rangée), ou en sort
    // lâché à plus de 32 px de la boîte (le filet du groupe l'annonce en gris)
    const inner = S.focus && [...S.sel].every((s) => app.node(s)?.group === S.focus) ? app.node(S.focus) : null;
    const gbox = inner ? { x: inner.x, y: inner.y, w: inner.w, h: inner.h } : null;
    const flowIn = !!inner && layoutOf(inner).mode === 'flow';
    let outNow = false, slot = -1;
    // un objet lâché sur un autre (app.dropRules, puis le groupe) : la règle se dit après un court arrêt au-dessus
    const drop = { t: null, rule: null, armed: false, timer: 0, label: '' };
    const disarm = () => {
      clearTimeout(drop.timer);
      if (drop.t) {
        const e2 = dom.get(drop.t.id)?.el;
        if (e2) { e2.classList.remove('drop-to'); if (drop.rule?.cls) e2.classList.remove(drop.rule.cls); delete e2.dataset.drop; }
      }
      Object.assign(drop, { t: null, rule: null, armed: false, label: '' });
      hint.textContent = HINT;
    };
    const overNode = (ev) => {
      const [wx, wy] = toWorld(ev.clientX, ev.clientY);
      const mine = new Set(moving.map((n) => n.id));
      const list = S.board.nodes;
      for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        if (n.type === 'frame' || mine.has(n.id) || hidden.has(n.id) || (n.type === 'group' && !cards.has(n.id))) continue;
        const b = dispBox(n);
        if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return n;
      }
      return null;
    };
    const rules = () => [...(app.dropRules || []), ...(app.dropLast || [])];
    const watchDrop = (ev) => {
      // Alt : poser par-dessus, sans règle
      const t = ev.altKey ? null : overNode(ev);
      let label = '', rule = null;
      if (t) for (const r of rules()) { label = r.test(moving, t); if (label) { rule = r; break; } }
      if (!label) { if (drop.t) disarm(); return; }
      if (drop.t?.id === t.id && drop.rule === rule) return;
      disarm();
      Object.assign(drop, { t, label, rule });
      drop.timer = setTimeout(() => {
        drop.armed = true;
        const e2 = dom.get(t.id)?.el;
        if (e2) { e2.classList.add(rule.cls || 'drop-to'); if (rule.tag) e2.dataset.drop = rule.tag; }
        hint.textContent = label;
      }, rule.dwell ?? DWELL);
    };
    // les guides magnétiques (objets/guides.js) : bords et centres aimantés, Alt pour s'en passer ;
    // pas dans un groupe ouvert (la rangée y range déjà)
    let guide = null;
    drag((ev) => {
      if (pinch) return;
      let dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      if (!moved) {
        app.snap(); moved = true; cv.classList.add('moving'); sel.gesture(true);
        if (!inner) guide = app.objets?.snapper({ cv, over }, new Set(moving.map((n) => n.id)), bbox(moving.map((n) => ({ ...dispBox(n) }))));
      }
      if (guide) [dx, dy] = guide.move(dx, dy, ev.altKey);
      for (const [n, ox, oy] of orig) {
        n.x = Math.round(ox + dx); n.y = Math.round(oy + dy);
        const d = dom.get(n.id);
        if (d) place(d.el, n);
      }
      if (inner) {
        const [wx, wy] = toWorld(ev.clientX, ev.clientY);
        const out = wx < gbox.x - EXIT || wx > gbox.x + gbox.w + EXIT || wy < gbox.y - EXIT || wy > gbox.y + gbox.h + EXIT;
        if (out !== outNow) { outNow = out; dom.get(inner.id)?.el.classList.toggle('leave', out); }
        if (!out) {
          if (drop.t) disarm();
          if (flowIn) {
            const rest = kidsOf(S.board, inner.id).filter((k) => !S.sel.has(k.id));
            slot = slotAt(rest, wx, wy);
            paintSlot(rest, slot, layoutOf(inner).gap);
          } else { arrange(inner, kidsOf(S.board, inner.id)); const d = dom.get(inner.id); if (d) place(d.el, inner); }
        } else { paintSlot(null); watchDrop(ev); }
      } else watchDrop(ev);
      paintLinks(); paintMini(); sel.follow();
      app.emit?.('moving', moving.map((n) => n.id));
    }, (ev) => {
      cv.classList.remove('moving');
      guide?.end();
      paintSlot(null);
      if (inner) dom.get(inner.id)?.el.classList.remove('leave');
      if (moved) { app.emit?.('moving', []); sel.gesture(false); }
      const target = drop.armed && !ev.altKey ? drop.t : null;
      disarm();
      // lâché hors de la planche, sur une zone qui le prend (le champ de l'agent : agent.js, app.dropOut) : elle le
      // reçoit, les objets reviennent à leur place, sans pas d'annulation
      if (moved && !inner && !cv.contains(document.elementFromPoint(ev.clientX, ev.clientY)) && app.dropOut?.(moving, ev)) {
        for (const [n, x, y] of orig) { n.x = x; n.y = y; }
        app.unsnap?.();
        render();
        return;
      }
      if (moved && target && app.dropOnto(moving, target, orig, ev)) return;
      if (moved && inner) {
        if (outNow) {
          for (const s of S.sel) { const n = app.node(s); if (n) delete n.group; }
          S.focus = null;
          toast(`sorti du groupe « ${inner.name || 'groupe'} » — ctrl+Z : il y revient`);
        } else if (flowIn && slot >= 0) {
          const kids = kidsOf(S.board, inner.id);
          const mv = kids.filter((k) => S.sel.has(k.id)), rest = kids.filter((k) => !S.sel.has(k.id));
          setOrder(S.board, inner.id, [...rest.slice(0, slot), ...mv, ...rest.slice(slot)]);
        }
      }
      if (moved) { paintFrames(); app.commit(); }
      else if (!add && was && S.sel.size > 1) app.select([id]);
    });
  }

  // redimensionner : le coin (les deux côtés), ou un bord d'un cadre (`axis` : 'x' le bord droit,
  // 'y' le bas). L'aimant (Cal, 30/09, la règle du nodal d'ODIO) : le bord qu'on tire se cale sur
  // les bords des objets affichés, ou la taille sur celle d'un voisin (même largeur, même
  // hauteur), sous 6 px d'écran, avec les guides du déplacement (objets/guides.js) ; Alt : libre
  // le temps du geste ; l'aimant éteint (S.snap) : libre.
  function startResize(e, id, axis = '1') {
    const n = app.node(id);
    if (!n) return;
    app.select([id]);
    if (n.deck) return;   // une diapositive a la taille de sa scène (diapo/) : son format la change
    if (n.type === 'text') return resizeText(e, n, axis);
    const x0 = e.clientX, y0 = e.clientY, z = V().z, w0 = n.w, h0 = n.h;
    const keep = n.type === 'media' && n.kind !== 'audio';
    const auto = AUTO_H.has(n.type);
    const g = n.group ? app.node(n.group) : null;
    const T = S.snap ? guideTargets(app, new Set([id])) : null;
    // les tailles des voisins affichés (le même relevé que les repères)
    const sizes = { w: [], h: [] };
    if (T) for (const m of S.board.nodes) { const dd = dom.get(m.id); if (m !== n && dd && !dd.off && m.type !== 'group') { sizes.w.push(m.w); sizes.h.push(m.h); } }
    const best = (cands, v, th) => { let b = null; for (const [c, guide] of cands) { const d = c - v; if (Math.abs(d) < th && (!b || Math.abs(d) < Math.abs(b.d))) b = { d, guide }; } return b; };
    let moved = false;
    drag((ev) => {
      const dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z;
      if (!moved) { app.snap(); moved = true; sel.gesture(true); }
      const minW = CARDS.has(n.type) ? 270 : n.type === 'frame' ? 120 : 48;
      const minH = n.type === 'frame' ? 90 : 36;
      let w = axis === 'y' ? w0 : Math.max(minW, w0 + dx);
      let h = axis === 'x' ? h0 : Math.max(minH, h0 + dy);
      const guide = { gx: null, gy: null };
      if (T && !ev.altKey) {
        const th = SNAP_PX / V().z;
        if (axis !== 'y') {
          // le bord droit sur un repère, ou la largeur sur celle d'un voisin
          const bx = best([...T.xs.map((x) => [x - n.x, x]), ...sizes.w.map((s) => [s, n.x + s])], w, th);
          if (bx && w + bx.d >= minW) { w += bx.d; guide.gx = bx.guide; }
        }
        if (axis !== 'x' && !auto && !(keep && !ev.shiftKey)) {
          const by = best([...T.ys.map((y) => [y - n.y, y]), ...sizes.h.map((s) => [s, n.y + s])], h, th);
          if (by && h + by.d >= minH) { h += by.d; guide.gy = by.guide; }
        }
      }
      paintGuides(over, V(), cv.clientWidth, cv.clientHeight, guide.gx === null && guide.gy === null ? null : guide);
      n.w = Math.round(w);
      if (keep && !ev.shiftKey) n.h = Math.round(n.w * h0 / w0);
      else if (!auto) n.h = Math.round(h);
      const d = dom.get(id);
      if (d) place(d.el, n);
      if (auto) { measure(); W.placePorts(); }
      // dans un groupe, les autres se remettent en forme à chaque image
      if (g) live([n]);
      // les poignées (et le cadre de la sélection) suivent la boîte à chaque image, pas au lâcher
      paintLinks(); paintMini(); sel.follow();
    }, () => { paintGuides(over, V(), cv.clientWidth, cv.clientHeight, null); if (moved) { sel.gesture(false); paintFrames(); app.commit(); } });
  }
  // un texte (objets/texte.js), comme dans Miro : le coin change sa taille (« dragging the white
  // dot »), la boîte suit ; le bord droit lui donne une largeur — il passe à la ligne, sa taille reste
  function resizeText(e, n, axis) {
    const x0 = e.clientX, z = V().z, w0 = n.w, s0 = n.size || 14;
    let moved = false;
    drag((ev) => {
      const dx = (ev.clientX - x0) / z;
      if (!moved) { if (Math.abs(dx) < 1) return; app.snap(); moved = true; sel.gesture(true); }
      if (axis === 'x') { n.wrap = true; n.w = Math.max(24, Math.round(w0 + dx)); }
      else {
        const k = Math.max(0.05, (w0 + dx) / w0);
        n.size = clamp(Math.round(s0 * k * 2) / 2, 6, 400);
        if (n.wrap) n.w = Math.max(24, Math.round(w0 * k));
      }
      const d = dom.get(n.id);
      if (d) place(d.el, n);
      measure(); W.placePorts(); paintLinks(); paintMini(); sel.follow();
      if (n.group) live([n]);
    }, () => { if (moved) { sel.gesture(false); app.commit(); } });
  }
  // des objets changés pendant un geste (échelle, organisation, taille) : leurs groupes se
  // remettent en forme, tout se replace, sans rendu complet
  function live(list) {
    // une mind map mise à l'échelle : son arbre se range depuis sa racine
    if (list.some((n) => n.type === 'mind')) {
      app.objets.layout(S.board);
      for (const n of S.board.nodes) if (n.type === 'mind') { const d = dom.get(n.id); if (d) place(d.el, n); }
    }
    const gs = new Set();
    for (const n of list) { if (n.type === 'group') gs.add(n.id); else if (n.group) gs.add(n.group); }
    const all = new Set(list);
    const K = kidsMap(S.board);
    const again = () => { for (const gid of gs) { const g = app.node(gid); if (g && !g.collapsed) arrange(g, K.get(gid) || [], S.board); } };
    again();
    for (const gid of gs) { const g = app.node(gid); if (g) all.add(g); for (const k of K.get(gid) || []) all.add(k); }
    for (const n of all) { const d = dom.get(n.id); if (d) place(d.el, n); }
    // un texte élargi change de hauteur : sa rangée se refait une fois de plus
    if ([...all].some((n) => AUTO_H.has(n.type)) && measure()) { again(); for (const n of all) { const d = dom.get(n.id); if (d) place(d.el, n); } }
    W.placePorts(); paintLinks(); paintMini();
  }

  // l'outil L, et les poignées d'un objet d'annotation (selection.js) : une flèche droite, qui
  // ne porte rien (les fils partent des sorties) ; lâchée dans le vide : « créer et relier »
  function startLink(e, from) {
    const a = app.node(from);
    if (!a) return;
    hint.textContent = 'une flèche d’annotation : relâchez sur un autre objet — dans le vide : un objet neuf, déjà relié';
    cv.classList.add('linking');
    const mv = (ev) => {
      const [wx, wy] = toWorld(ev.clientX, ev.clientY);
      const [p] = edgePts(dispBox(a), { x: wx, y: wy, w: 0, h: 0 });
      temp.setAttribute('d', `M${p[0]} ${p[1]}L${wx} ${wy}`);
    };
    mv(e);
    drag(mv, (ev) => {
      temp.setAttribute('d', '');
      cv.classList.remove('linking');
      hint.textContent = HINT;
      const tgt = document.elementFromPoint(ev.clientX, ev.clientY);
      // un objet d'un groupe fermé : la flèche va à lui (on relie des objets, pas des groupes)
      const to = tgt?.closest?.('[data-id]')?.dataset.id;
      if (to && to !== from && app.node(to)?.type !== 'frame') { app.connect(from, to); return; }
      if ((!to || app.node(to)?.type === 'frame') && cv.contains(tgt) && !tgt.closest('.zoombox, .mini, .banner, .ob-dock')) {
        const [wx, wy] = toWorld(ev.clientX, ev.clientY);
        const mk = (type) => () => app.addAt(type, wx, wy - 30, { edit: true, select: true, link: from });
        menu(ev.clientX, ev.clientY, app.objets ? app.objets.linkItems(from, wx, wy) : [{ head: 'un objet neuf, fléché' },
          { label: 'Note', onclick: mk('note') }, { label: 'Post-it', onclick: mk('sticky') }, { label: 'Titre', onclick: mk('title') }]);
      }
    });
  }

  function startCreate(e, type) {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    // une forme, une carte : centrée sur le clic ; une mind map : sa racine (objets/)
    if (app.objets?.has(type)) {
      app.objets.place(type, wx, wy);
      if (!e.shiftKey) app.setTool('select');
      return;
    }
    if (type !== 'frame') {
      app.addAt(type, wx, wy, { edit: ['note', 'sticky', 'title'].includes(type), select: true });
      if (!e.shiftKey) app.setTool('select');
      return;
    }
    // un cadre se trace ; un simple clic en pose un de taille courante
    marquee.hidden = false;
    const r = rect(), x0 = e.clientX, y0 = e.clientY;
    const box = (ev) => ({ l: Math.min(x0, ev.clientX), t: Math.min(y0, ev.clientY), w: Math.abs(ev.clientX - x0), h: Math.abs(ev.clientY - y0) });
    drag((ev) => {
      const b = box(ev);
      Object.assign(marquee.style, { left: `${b.l - r.left}px`, top: `${b.t - r.top}px`, width: `${b.w}px`, height: `${b.h}px` });
    }, (ev) => {
      marquee.hidden = true;
      const b = box(ev);
      if (b.w < 12 || b.h < 12) app.addAt('frame', wx, wy, { select: true });
      else {
        const [ax, ay] = toWorld(b.l, b.t);
        app.addAt('frame', ax, ay, { select: true, w: b.w / V().z, h: b.h / V().z });
      }
      if (!ev.shiftKey) app.setTool('select');
    });
  }

  // le cadre de sélection ; avec Alt, un lasso à main levée. Un enfant touché prend son
  // groupe (sauf dans le groupe ouvert), un groupe en carte se prend par sa carte
  function startSelectArea(e) {
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    const lasso = e.altKey;
    const r = rect();
    const x0 = e.clientX, y0 = e.clientY;
    const pts = [[x0 - r.left, y0 - r.top]];
    const before = new Set(S.sel);
    let moved = false;
    const unit = (n) => (n.group && S.focus !== n.group ? n.group : n.id);
    const pick = (ev) => {
      const ids = [];
      const test = (n, b) => {
        if (lasso) {
          const poly = pts.map(([sx, sy]) => [(sx - V().x) / V().z, (sy - V().y) / V().z]);
          return pointIn([b.x + b.w / 2, b.y + b.h / 2], poly);
        }
        const [ax, ay] = toWorld(Math.min(x0, ev.clientX), Math.min(y0, ev.clientY));
        const [bx, by] = toWorld(Math.max(x0, ev.clientX), Math.max(y0, ev.clientY));
        const q = { x: ax, y: ay, w: bx - ax, h: by - ay };
        // un cadre ne se prend que s'il est entièrement dans le tracé : sinon tracer dans un cadre le prendrait toujours
        return n.type === 'frame' ? inside(n, q) : hits(b, q);
      };
      for (const n of S.board.nodes) {
        if (hidden.has(n.id)) continue;
        if (n.type === 'group') { if (cards.has(n.id) && test(n, dispBox(n))) ids.push(n.id); continue; }
        if (test(n, n)) ids.push(unit(n));
      }
      S.sel = new Set(add ? [...before, ...ids] : ids);
      if (S.focus && ![...S.sel].every((s) => app.node(s)?.group === S.focus)) S.focus = null;
      S.link = null;
      paintSel(); paintMini();
    };
    drag((ev) => {
      if (pinch) return;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moved) sel.gesture(true);
      moved = true;
      if (lasso) {
        pts.push([ev.clientX - r.left, ev.clientY - r.top]);
        lassoP.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
      } else {
        marquee.hidden = false;
        Object.assign(marquee.style, { left: `${Math.min(x0, ev.clientX) - r.left}px`, top: `${Math.min(y0, ev.clientY) - r.top}px`,
          width: `${Math.abs(ev.clientX - x0)}px`, height: `${Math.abs(ev.clientY - y0)}px` });
      }
      pick(ev);
    }, () => {
      marquee.hidden = true;
      lassoP.setAttribute('points', '');
      if (moved) sel.gesture(false);
      if (!moved && !add) { S.sel.clear(); S.link = null; S.focus = null; paintSel(); }
      app.selectionChanged();
    });
  }
  function pointIn([x, y], poly) {
    let inn = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inn = !inn;
    }
    return inn;
  }

  // la souris ET le pavé, sans réglage (commun/molette.js, brancherCanvas) : pincer = zoom, deux doigts = déplacer la vue,
  // molette à crans = zoom
  brancherCanvas(cv, {
    ignore: (e) => !!e.target.closest?.('.zoombox, .mini'),
    pan: (dx, dy) => { const v = V(); v.x -= dx; v.y -= dy; applyView(); },
    zoom: (k, cx, cy) => { const r = rect(); zoomAt(V().z * k, cx - r.left, cy - r.top); },
  });

  // le survol d'un enfant montre son groupe (un filet pointillé et son nom)
  let hovG = '';
  cv.addEventListener('pointerover', (e) => {
    const g = e.target.closest?.('.nd[data-id]')?.dataset.g || '';
    if (g === hovG) return;
    if (hovG) dom.get(hovG)?.el.classList.remove('hov');
    hovG = g;
    if (g) dom.get(g)?.el.classList.add('hov');
  });

  cv.addEventListener('dblclick', (e) => {
    if (locked) return;
    const t = e.target;
    if (t.closest('.zoombox, .mini, .empty, .banner, .sbar, .selbox') || isControl(t)) return;
    const id = t.closest('[data-id]')?.dataset.id;
    const n = id && app.node(id);
    if (n) {
      // une carte de groupe : déplier (réduit), ou y aller (vu de loin)
      if (n.type === 'group') { if (n.collapsed) app.groups.collapse(n.id, false); else flyTo(n.id, { zmax: 1 }); return; }
      // un enfant d'un groupe fermé : le choisir dans son groupe (Miro) ; le double-clic suivant fait le reste
      if (n.group && S.focus !== n.group) { app.enter(n.id); return; }
      if (['note', 'sticky', 'title'].includes(n.type) || app.objets?.writable(n)) editText(n.id);
      else if (n.type === 'frame') renameFrame(n.id);
      // une image : la recadrer, comme dans Miro (objets/recadrer.js) ; « Voir en grand » reste au menu et à droite
      else if (n.type === 'media' && n.kind === 'image' && app.objets?.crop && !app.objets.crop.whyNot(n)) app.objets.crop.start(n.id);
      else if (n.type === 'media' && (n.kind === 'image' || n.kind === 'video')) app.lightbox(n);
      else if (CARDS.has(n.type)) dom.get(n.id)?.el.querySelector('textarea:not([readonly])')?.focus({ preventScroll: true });
      return;
    }
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    menu(e.clientX, e.clientY, app.menus.board(wx, wy));
  });

  // le clic droit : jamais le menu du navigateur sur la planche (règle de Cal, 29/09) ;
  // chaque zone a le sien (menus.js)
  cv.addEventListener('contextmenu', (e) => {
    // la barre des outils, posée sur la planche : le menu de la page (ideation.js), pas celui du fond
    if (e.target.closest?.('.ide-side')) return;
    e.preventDefault();
    const t = e.target;
    const M = app.menus;
    const at = [e.clientX, e.clientY];
    // un champ où l'on écrit (une carte, une note en cours) : le presse-papiers
    const fld = t.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
    if (fld) { menu(...at, M.text(fld)); return; }
    if (t.closest('.zoombox, .mini')) { menu(...at, M.view()); return; }
    if (locked) { menu(...at, M.view()); return; }
    app.swatchHit = t.closest?.('.sw')?.dataset.c || '';   // la couleur du nuancier sous le clic droit, pour son menu
    const raw = t.closest('[data-id]')?.dataset.id;
    const lk = t.closest('[data-link]')?.dataset.link;
    if (lk && !raw) {
      const l = S.board?.links.find((x) => x.id === lk);
      if (l) { app.selectLink(l.id); menu(...at, M.link(l)); return; }
    }
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    if (!raw || !S.board) { menu(...at, M.board(wx, wy, { more: true })); return; }
    const id = unitOf(raw);
    if (!S.sel.has(id)) app.select([id]);
    const us = [...S.sel].map((s) => app.node(s)).filter(Boolean);
    menu(...at, M.forSelection(us) || M.board(wx, wy, { more: true }));
  });

  // écrire dans une note, un post-it, un titre : sur place
  function editText(id) {
    const n = app.node(id);
    // un objet texte : l'édition riche (objets/texte.js)
    if (n?.type === 'text') { app.texte?.edit(id); return; }
    const d = dom.get(id);
    const txt = d?.el.querySelector('.txt');
    if (!n || !txt) return;
    app.select([id]);
    txt.textContent = n.text || '';
    txt.dataset.reg = 'text';   // le registre qu'il écrit : la co-édition y verse les frappes des autres (coedition.js, follow)
    txt.classList.remove('ph');
    txt.classList.add('editing');
    try { txt.contentEditable = 'plaintext-only'; } catch { txt.contentEditable = 'true'; }
    if (txt.contentEditable !== 'plaintext-only') txt.contentEditable = 'true';
    txt.focus({ preventScroll: true });
    const sel2 = getSelection();
    sel2.selectAllChildren(txt);
    sel2.collapseToEnd();
    const changed = app.editing();
    let wrote = false;
    const clean = (t) => (app.objets ? app.objets.cleanText(n, t) : t);
    // le texte tel qu'écrit : innerText rend les capitales d'un text-transform (un titre, une
    // racine de mind map s'enregistraient en capitales) — lu sans elles, remises aussitôt
    const typed = () => { const tt = txt.style.textTransform; txt.style.textTransform = 'none'; const t = txt.innerText; txt.style.textTransform = tt; return t; };
    // ce qu'on écrit part aussitôt dans les cartes qui lisent ce texte (la note elle-même n'est pas refaite)
    const onInput = () => { wrote = true; changed(); n.text = clean(typed().replace(/\n$/, '')); measure(); W.placePorts(); paintLinks(); renderSoon(); };
    const onPaste = (ev) => { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData.getData('text/plain')); };
    // Tab et Entrée dans un nœud de mind map : un enfant, un frère (objets/) ; Échap, ctrl+Entrée : fini
    // la touche reste ici : le champ quitté, la page la prendrait pour elle (un second nœud, tout déchoisir)
    const onKey = (ev) => {
      if (app.objets?.editKey(n, ev, () => txt.blur())) { ev.stopPropagation(); return; }
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); ev.stopPropagation(); txt.blur(); }
    };
    txt.addEventListener('input', onInput);
    txt.addEventListener('paste', onPaste);
    txt.addEventListener('keydown', onKey);
    txt.addEventListener('blur', () => {
      txt.removeEventListener('input', onInput); txt.removeEventListener('paste', onPaste); txt.removeEventListener('keydown', onKey);
      txt.contentEditable = 'false';
      txt.classList.remove('editing');
      const d2 = dom.get(id);
      if (d2) d2.key = '';
      // écrire dans une note est un geste : il finit par un commit (les modules l'entendent)
      if (wrote) app.commit(); else render();
      app.selectionChanged();
    }, { once: true });
  }
  function renameFrame(id) {
    const n = app.node(id);
    const b = dom.get(id)?.el.querySelector('.fr-n');
    if (!n || !b) return;
    app.select([id]);
    const inp = el('input', { class: 'fr-in', value: n.name || '', maxlength: 120, placeholder: 'nom du cadre', 'data-reg': 'name' });
    b.replaceWith(inp);
    inp.focus({ preventScroll: true }); inp.select();
    const done = (keep) => {
      if (keep && inp.value.trim() !== (n.name || '')) app.mutate(() => { n.name = inp.value.trim(); });
      const d = dom.get(id);
      if (d) d.key = '';
      render();
      app.selectionChanged();
    };
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = n.name || ''; inp.blur(); } });
    inp.addEventListener('blur', () => done(true), { once: true });
  }

  // ── déposer : un fichier du disque (il entre dans la bibliothèque, Upload),
  // une vignette glissée d'ici ou d'une autre page (ITEM_MIME), un personnage
  // de Character Factory — posés là où on lâche
  let dropAt = null;
  cv.addEventListener('dragover', (e) => {
    dropAt = [e.clientX, e.clientY];
    if (e.dataTransfer?.types?.includes(CF_MIME) || e.dataTransfer?.types?.includes(PART_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; cv.classList.add('drop-on'); }
  });
  cv.addEventListener('dragleave', (e) => { if (!cv.contains(e.relatedTarget)) cv.classList.remove('drop-on'); });
  const dropPoint = () => (dropAt ? toWorld(...dropAt) : center());
  // un dépôt dans une carte (zone dans la zone) n'atteint pas la planche : son filet s'éteint quand même
  for (const ev of ['drop', 'dragend']) addEventListener(ev, () => setTimeout(() => cv.classList.remove('drop-on')), true);
  dropZone(cv, { kinds: ['image', 'video', 'audio', 'element'], via: 'ideation', onitems: (items) => app.placeMany(items, ...dropPoint()) });
  // une partie d'un élément (le panneau de droite : planche, expression, modèle 3D) : posée là où on lâche
  cv.addEventListener('drop', (e) => {
    const raw = e.dataTransfer?.getData(PART_MIME);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    cv.classList.remove('drop-on');
    try { app.placePart(JSON.parse(raw), ...toWorld(e.clientX, e.clientY)); } catch { /* charge illisible */ }
  });
  cv.addEventListener('drop', (e) => {
    const raw = e.dataTransfer?.getData(CF_MIME);
    if (!raw) return;
    e.preventDefault();
    cv.classList.remove('drop-on');
    try { app.placeCf(JSON.parse(raw), ...toWorld(e.clientX, e.clientY)); } catch { /* charge illisible */ }
  });

  // le cadre de sélection et sa barre (selection.js), au-dessus de la planche
  const sel = createSelection(app, { cv, drag, toWorld, box: dispBox, isCard, isLocked: () => locked, live, startLink });

  hint.textContent = HINT;
  new ResizeObserver(() => { paintMini(); sel.follow(); scheduleCull(); }).observe(cv);
  document.fonts?.ready?.then(() => {
    // les nœuds de mind map prennent la largeur de leur nom, mesurée dans la fonte : elle est là
    if (S.board?.nodes.some((n) => n.type === 'mind')) { render(); return; }
    if (measure()) { W.placePorts(); paintLinks(); }
  });

  // ce que les modules greffés lisent et appellent (plugins.js) — des ajouts seulement :
  //   toWorld(x, y) / toScreen(wx, wy)   fenêtre (clientX, clientY) ↔ planche
  //   viewFor(zone, pad, zmax) → { x, y, z } · flyTo(vue | zone | id, { ms, pad, zmax }) → promesse
  //   zoomAt(z, x, y)                    zoomer autour d'un point du canvas (px depuis son coin)
  //   decorate(fn) → désabonner          fn(n, el) à chaque objet refait, et tout de suite
  //   lock() / unlock() / isLocked()     figer les gestes (la vue se déplace encore)
  //   level()                            le niveau du zoom sémantique : 'far' | 'work' | 'near'
  //   isCard(n) · dispBox(n)             un groupe montré en carte · la boîte montrée d'un objet
  return { el: cv, render, renderSoon, reflow, applyView, paintSel, paintLinks, paintJobs, paintMini, paintEmpty, fit, zoomTo, zoomBy, zoomAt,
    toWorld, toScreen, viewFor, flyTo, center, viewRect, editText, renameFrame, decorate, prime, cull,
    level: () => level, isCard, dispBox, hiddenIn: (id) => hidden.get(id) || null, sel,
    lock: () => { locked = true; cv.classList.add('locked'); sel.hide(); }, unlock: () => { locked = false; cv.classList.remove('locked'); paintSel(); }, isLocked: () => locked,
    dom, size, rect, portPoint: W.portPoint, over: (x, y) => { const r = rect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; } };
}
