// IDÉATION — le canvas infini : la vue (glisser, molette, pincer), les
// objets posés et leurs ports, la sélection (clic, Maj + clic, cadre de
// sélection, lasso avec Alt), déplacer, redimensionner, la mini-carte. Les
// liens et le geste « tirer un fil » : wires.js ; ce qui se branche : ports.js.
//
// Rien ici n'écrit la planche sans passer par l'app : `app.snap()` garde
// l'état d'avant (annuler), `app.commit()` repeint et enregistre. Les
// couleurs viennent des jetons, même dans la mini-carte (lus à l'exécution).
// Un objet peut porter `parent` (un groupe, à venir) : le rendu l'ignore.
// Le canvas émet 'view' (app.emit, plugins.js) quand la caméra bouge.

import { el, href, fmtDur, etypeFr, toast, dropZone } from '../commun/shell.js';
import { menu } from '../commun/menu.js';
import { CF_MIME } from './library.js';
import { createWires, edgePts } from './wires.js';
import { KINDS, outPort, inPorts } from './ports.js';

export { menu, edgePts };
const NS = 'http://www.w3.org/2000/svg';
const GRID = 24;
const ZMIN = 0.08;
const ZMAX = 4;
const DWELL = 400;   // un texte posé sur un autre : un court arrêt au-dessus avant de proposer le composeur (étude Weavy § 9.5)
// les objets dont la hauteur suit le contenu : la page la mesure et l'écrit
export const AUTO_H = new Set(['note', 'sticky', 'title', 'gen', 'vgen', 'compose']);
const CARDS = new Set(['gen', 'vgen', 'compose']);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  return n;
};
const isControl = (t) => t?.closest?.('input, textarea, select, button, a, .editing, audio');
export const inside = (n, f) => n.x >= f.x && n.y >= f.y && n.x + n.w <= f.x + f.w && n.y + n.h <= f.y + f.h;
const hits = (n, r) => n.x < r.x + r.w && n.x + n.w > r.x && n.y < r.y + r.h && n.y + n.h > r.y;
export function bbox(list) {
  if (!list.length) return null;
  const x0 = Math.min(...list.map((n) => n.x)), y0 = Math.min(...list.map((n) => n.y));
  const x1 = Math.max(...list.map((n) => n.x + n.w)), y1 = Math.max(...list.map((n) => n.y + n.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function createCanvas(app) {
  const { S } = app;
  const cv = document.getElementById('cv');
  const world = el('div', { class: 'world' });
  const framesL = el('div', { class: 'layer frames' });
  const linksS = svg('svg', { class: 'links', width: 1, height: 1 });
  const nodesL = el('div', { class: 'layer nodes' });
  world.append(framesL, linksS, nodesL);
  const temp = svg('path', { class: 'temp' });   // la flèche d'annotation qu'on tire (outil L)
  const HINT = 'molette : zoom · glisser le fond : choisir · Alt : lasso · espace : se déplacer · tirer une sortie : un fil · double-clic : poser';
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

  const dom = new Map();   // id → { el, key, py: { 'in:prompt': y… } }
  const V = () => S.view;
  const W = createWires(app, { cv, layer: linksS, dom, toWorld, drag, hint, HINT });
  let soonF = 0;
  let locked = false;   // canvas.lock() : les gestes sont figés (seul le déplacement de la vue reste)
  // rien ne défile jamais sous la planche : la vue est la seule vérité (un
  // champ qui prend le focus ferait sinon glisser la page)
  for (const n of [cv, cv.parentElement, cv.closest('.ide'), document.body]) {
    n?.addEventListener('scroll', () => { if (n.scrollLeft || n.scrollTop) { n.scrollLeft = 0; n.scrollTop = 0; } });
  }
  addEventListener('scroll', () => { if (scrollX || scrollY) scrollTo(0, 0); });

  // ── la vue ────────────────────────────────────────────────
  let viewT = 0, resT = 0, farNow = null, viewF = 0;
  function applyView() {
    const v = V();
    world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    cv.style.setProperty('--z', v.z);
    const g = GRID * v.z * (v.z < 0.3 ? 4 : v.z < 0.6 ? 2 : 1);
    cv.style.setProperty('--gs', `${g}px`);
    cv.style.setProperty('--gx', `${v.x}px`);
    cv.style.setProperty('--gy', `${v.y}px`);
    cv.classList.toggle('nogrid', !S.grid);
    gridB.classList.toggle('on', !!S.grid);
    const far = v.z < 0.42;
    cv.classList.toggle('far', far);
    // de loin, les cartes n'ont plus leurs lignes : leurs ports et leurs fils se replacent
    if (farNow !== null && far !== farNow) { measure(); W.placePorts(); paintLinks(); }
    farNow = far;
    pct.textContent = `${Math.round(v.z * 100)} %`;
    paintMini();
    cancelAnimationFrame(viewF);
    viewF = requestAnimationFrame(() => app.emit?.('view', V()));
    clearTimeout(viewT);
    viewT = setTimeout(() => { if (S.board) app.LS('view-' + S.board.id, S.view); }, 400);
    clearTimeout(resT);
    resT = setTimeout(swapRes, 220);
  }
  const rect = () => cv.getBoundingClientRect();
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
    return { x: -v.x / v.z, y: -v.y / v.z, w: cv.clientWidth / v.z, h: cv.clientHeight / v.z };
  }
  const center = () => { const r = viewRect(); return [r.x + r.w / 2, r.y + r.h / 2]; };
  function fit(target) {
    const b = target || bbox(S.board?.nodes || []);
    if (!b) { Object.assign(V(), { x: cv.clientWidth / 2, y: cv.clientHeight / 2, z: 1 }); applyView(); return; }
    Object.assign(V(), viewFor(b));
    applyView();
  }
  // une image posée en grand se lit en pleine définition, de loin sa vignette
  function swapRes() {
    for (const n of S.board?.nodes || []) {
      if (n.type !== 'media' || n.kind !== 'image') continue;
      const img = dom.get(n.id)?.el.querySelector('img');
      const it = S.items.get(n.item);
      if (!img || !it || it.missing) continue;
      const want = href(pickSrc(n, it));
      if (img.src !== want) img.src = want;
    }
  }
  const pickSrc = (n, it) => (n.w * V().z * (devicePixelRatio || 1) > 400 && it.url ? it.url : it.thumb_url || it.url);

  // ── les objets ────────────────────────────────────────────
  function keyOf(n) {
    const it = n.type === 'media' ? S.items.get(n.item) : null;
    // la place et la taille ne refont pas l'objet : `place` les suit
    const { x, y, w, h, jobs, ...rest } = n;
    const extra = n.type === 'gen' ? app.gen.cardKey(n) : n.type === 'vgen' ? app.video.cardKey(n) : n.type === 'compose' ? app.composer.cardKey(n) : '';
    return JSON.stringify(rest) + (it ? `|${it.updated || ''}${it.missing ? 'x' : ''}` : '|?') + extra;
  }
  function place(e, n) {
    e.style.left = `${n.x}px`; e.style.top = `${n.y}px`; e.style.width = `${n.w}px`;
    e.style.height = AUTO_H.has(n.type) ? '' : `${n.h}px`;
  }
  // les ports d'un objet (ports.js) : ses entrées à gauche, sa sortie à droite, dans la teinte de ce qu'ils portent
  const accepts = (p) => p.accepts.map((k) => KINDS[k].label).join(' ou ');
  function ports(n) {
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
    out.push(el('span', { class: 'rz', 'data-rz': '1', title: 'redimensionner' }));
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
        el('span', { class: 'rz', 'data-rz': '1', title: 'redimensionner' }));
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
        el('button', { class: 'sw', type: 'button', title: `${c} — copier`, style: { background: c },
          onclick: () => { navigator.clipboard?.writeText(c).then(() => toast(`${c} copiée`), () => toast(c)); } },
        el('span', {}, c))))];
    }
    const e = el('div', { class: cls.join(' '), 'data-id': n.id, style }, ...body, el('div', { class: 'jobs' }), ...ports(n));
    if (n.type === 'media' && n.kind === 'video') {
      const v = e.querySelector('video');
      if (v) {
        e.addEventListener('pointerenter', () => { v.play().catch(() => {}); });
        e.addEventListener('pointerleave', () => { v.pause(); });
      }
    }
    return e;
  }

  function media(n) {
    const it = S.items.get(n.item);
    if (!it) return [el('div', { class: 'miss' }, el('span', { class: 'lbl' }, 'chargement'))];
    if (it.missing) {
      return [el('div', { class: 'miss' }, el('b', {}, 'absent'), el('span', {}, 'cet objet a quitté la bibliothèque (corbeille d’Asset ?)'),
        el('small', { class: 'lbl' }, n.title || n.item))];
    }
    const cap = el('span', { class: 'cap' }, it.title || it.id);
    if (n.kind === 'image') return [el('img', { src: href(pickSrc(n, it)), alt: it.title || '', draggable: 'false' }), cap];
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
    return [el('div', { class: 'eim', style: { backgroundImage: refs[0] || it.thumb_url ? `url("${href(refs[0]?.thumb_url || it.thumb_url)}")` : null } }),
      el('div', { class: 'ecap' }, el('b', {}, it.title || 'élément'),
        el('span', { class: 'lbl' }, `${etypeFr(it.element?.type)} · ${refs.length} réf.`)),
      el('div', { class: 'estrip' }, ...refs.slice(1, 6).map((r) => el('i', { style: { backgroundImage: `url("${href(r.thumb_url)}")` } })))];
  }

  function render() {
    cancelAnimationFrame(soonF);
    if (!S.board) { framesL.replaceChildren(); nodesL.replaceChildren(); linksS.replaceChildren(); dom.clear(); paintEmpty(); return; }
    app.flowNow();            // ce qui passe dans les fils, relu une fois par rendu
    const nodes = S.board.nodes;
    // les grands cadres dessous : un cadre posé dans un autre reste visible
    const frames = nodes.filter((n) => n.type === 'frame').sort((a, b) => b.w * b.h - a.w * a.h);
    const others = nodes.filter((n) => n.type !== 'frame');
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
      if (!d || (d.key !== key && !(typing && d.el.contains(typing)))) {
        const e = build(n);
        if (d) d.el.replaceWith(e);
        d = { el: e, key };
        dom.set(n.id, d);
      }
      place(d.el, n);
      if (layer.children[i] !== d.el) layer.insertBefore(d.el, layer.children[i] || null);
    });
    sync(framesL, frames);
    sync(nodesL, others);
    for (const [id, d] of dom) if (!seen.has(id)) { d.el.remove(); dom.delete(id); }
    measure();
    W.placePorts();
    paintFrames();
    paintLinks();
    W.paintPorts();
    paintSel();
    paintEmpty();
    for (const n of nodes) if (n.jobs) paintJobs(n.id);
    paintMini();
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
      if (!AUTO_H.has(n.type) || (far && CARDS.has(n.type))) continue;
      const h = dom.get(n.id)?.el.offsetHeight;
      if (h && Math.abs(h - n.h) > 0.5) { n.h = Math.round(h); changed = true; }
    }
    return changed;
  }
  function paintFrames() {
    const all = S.board?.nodes || [];
    for (const f of all) {
      if (f.type !== 'frame') continue;
      const c = dom.get(f.id)?.el.querySelector('.fr-c');
      const k = all.filter((n) => n !== f && inside(n, f)).length;
      if (c) c.textContent = `${k} objet${k > 1 ? 's' : ''}`;
    }
  }
  function paintSel() {
    const solo = S.sel.size === 1;
    for (const [id, d] of dom) {
      d.el.classList.toggle('sel', S.sel.has(id));
      d.el.classList.toggle('solo', solo && S.sel.has(id));
    }
    for (const g of linksS.querySelectorAll('g[data-link]')) g.classList.toggle('sel', g.dataset.link === S.link);
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
          ? [el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.addAt('gen', ...center()) }, 'Générer image'),
            el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.addAt('vgen', ...center()) }, 'Générer vidéo'),
            el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.addAt('compose', ...center()) }, 'Composeur'),
            el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.addAt('note', ...center()) }, 'Note'),
            el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.addAt('frame', ...center()) }, 'Cadre')]
          : [el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.boardsModal() }, 'Les planches'),
            el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.newBoard() }, 'Nouvelle planche')])));
    }
    const stub = (S.cfg?.backend || S.meta?.backend) === 'stub';
    banner.hidden = !stub || !S.board;
    banner.replaceChildren(el('b', {}, 'Moteur factice'), el('span', {}, `Générer image, Variations et Éditer rendent des mires dessinées${S.mopts && S.mopts.engine !== 'h3' ? ', Générer vidéo une vidéo d’essai (ffmpeg)' : ''} : aucun modèle n’est chargé. Le câblage : page Admin.`));
  }

  // les travaux en cours d'un objet : une barre par travail
  function paintJobs(id) {
    const n = app.node(id);
    const box = dom.get(id)?.el.querySelector('.jobs');
    if (!n || !box) return;
    const list = (n.jobs || []).map((j) => S.jobs.get(j.id) || { id: j.id, state: 'queued', message: 'en file' });
    box.replaceChildren(...list.map((j) => el('div', { class: 'jb ' + j.state, title: j.message || '' },
      el('span', { class: 'lbl' }, `${j.state === 'running' ? (j.progress != null ? Math.round(j.progress * 100) + ' %' : 'en cours') : j.state === 'queued' ? 'en file' : j.state} · ${j.message || ''}`),
      el('i', { style: { width: `${Math.round((j.progress ?? (j.state === 'queued' ? 0 : 0.1)) * 100)}%` } }))));
  }

  // ── les liens : wires.js les dessine ; la flèche qu'on tire avec l'outil L se pose par-dessus
  function paintLinks() {
    W.paint();
    linksS.append(temp);
  }

  // ── la mini-carte ─────────────────────────────────────────
  let miniF = 0;
  let miniT = null;
  function paintMini() { cancelAnimationFrame(miniF); miniF = requestAnimationFrame(drawMini); }
  function drawMini() {
    const dpr = devicePixelRatio || 1, W = 188, H = 118;
    if (mini.width !== W * dpr) { mini.width = W * dpr; mini.height = H * dpr; }
    const c = mini.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(document.documentElement);
    const tok = (k) => cs.getPropertyValue('--' + k).trim();
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
      if (n.type === 'frame') continue;
      c.fillStyle = n.type === 'sticky' ? tok(n.color) || tok('coral-3') : n.type === 'gen' || n.type === 'vgen' ? tok('or') : n.type === 'compose' ? tok('amb')
        : n.type === 'palette' ? (n.colors?.[0] || tok('ink3')) : n.type === 'media' ? (n.kind === 'element' ? tok('coral-2') : tok('ink3'))
          : n.type === 'title' ? tok('ink') : tok('ink2');
      if (S.sel.has(n.id)) c.fillStyle = tok('or');
      c.fillRect(...R(n));
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

  cv.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (t.closest('.zoombox, .mini, .empty .row, .banner')) return;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 2) { startPinch(); return; }
    }
    const nodeEl = t.closest('[data-id]');
    if (isControl(t)) {
      if (locked) { e.preventDefault(); return; }
      if (nodeEl && !S.sel.has(nodeEl.dataset.id)) app.select([nodeEl.dataset.id]);
      return;
    }
    if (document.activeElement && document.activeElement !== document.body && cv.contains(document.activeElement)) document.activeElement.blur();
    // figée (canvas.lock : une présentation, la machine temporelle) : on se déplace, rien d'autre
    if (e.button === 1 || (e.button === 0 && (S.tool === 'hand' || S.space || locked))) { e.preventDefault(); return startPan(e); }
    if (e.button !== 0) return;
    e.preventDefault();
    const id = nodeEl?.dataset.id;
    if (t.closest('[data-rz]') && id) return startResize(e, id);
    const pt = t.closest('.pt[data-port]');
    if (pt && id) return W.start(e, id, pt.dataset.port, pt.dataset.side);
    if (S.tool === 'link' && id) return startLink(e, id);
    // un outil de pose pose où l'on clique, par-dessus un objet aussi (une note sur une image)
    if (['note', 'sticky', 'title', 'gen', 'vgen', 'compose', 'frame'].includes(S.tool)) return startCreate(e, S.tool);
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

  // les objets à emmener : la sélection, et ce que contiennent ses cadres
  function carried() {
    const out = new Map();
    for (const id of S.sel) {
      const n = app.node(id);
      if (!n) continue;
      out.set(n.id, n);
      if (n.type === 'frame') for (const m of S.board.nodes) if (m !== n && inside(m, n)) out.set(m.id, m);
    }
    return [...out.values()];
  }

  function pressNode(e, id) {
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    const was = S.sel.has(id);
    if (add) app.select([id], { toggle: true });
    else if (!was) app.select([id]);
    if (add && !S.sel.has(id)) return;
    const moving = carried();
    const orig = moving.map((n) => [n, n.x, n.y]);
    const x0 = e.clientX, y0 = e.clientY, z = V().z;
    let moved = false;
    // un objet lâché sur un autre (app.dropRules) : la règle se dit après un court arrêt au-dessus
    const drop = { t: null, since: 0, armed: false, timer: 0, label: '' };
    const disarm = () => {
      clearTimeout(drop.timer);
      if (drop.t) dom.get(drop.t.id)?.el.classList.remove('drop-to');
      Object.assign(drop, { t: null, armed: false, label: '' });
      hint.textContent = HINT;
    };
    const overNode = (ev) => {
      const [wx, wy] = toWorld(ev.clientX, ev.clientY);
      const mine = new Set(moving.map((n) => n.id));
      const list = S.board.nodes;
      for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        if (n.type === 'frame' || mine.has(n.id)) continue;
        if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return n;
      }
      return null;
    };
    const watchDrop = (ev) => {
      const t = overNode(ev);
      let label = '';
      for (const r of (t && app.dropRules) || []) { label = r.test(moving, t); if (label) break; }
      if (!label) { if (drop.t) disarm(); return; }
      if (drop.t?.id === t.id) return;
      disarm();
      Object.assign(drop, { t, label });
      drop.timer = setTimeout(() => {
        drop.armed = true;
        dom.get(t.id)?.el.classList.add('drop-to');
        hint.textContent = label;
      }, DWELL);
    };
    drag((ev) => {
      if (pinch) return;
      const dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      if (!moved) { app.snap(); moved = true; cv.classList.add('moving'); }
      for (const [n, ox, oy] of orig) {
        n.x = Math.round(ox + dx); n.y = Math.round(oy + dy);
        const d = dom.get(n.id);
        if (d) place(d.el, n);
      }
      watchDrop(ev);
      paintLinks(); paintMini();
      app.emit?.('moving', moving.map((n) => n.id));
    }, (ev) => {
      cv.classList.remove('moving');
      if (moved) app.emit?.('moving', []);
      const target = drop.armed ? drop.t : null;
      disarm();
      if (moved && target && app.dropOnto(moving, target, orig, ev)) return;
      if (moved) { paintFrames(); app.commit(); }
      else if (!add && was && S.sel.size > 1) app.select([id]);
    });
  }

  function startResize(e, id) {
    const n = app.node(id);
    if (!n) return;
    app.select([id]);
    const x0 = e.clientX, y0 = e.clientY, z = V().z, w0 = n.w, h0 = n.h;
    const keep = n.type === 'media' && n.kind !== 'audio';
    const auto = AUTO_H.has(n.type);
    let moved = false;
    drag((ev) => {
      const dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z;
      if (!moved) { app.snap(); moved = true; }
      const minW = CARDS.has(n.type) ? 270 : n.type === 'frame' ? 120 : 48;
      n.w = Math.round(Math.max(minW, w0 + dx));
      if (keep && !ev.shiftKey) n.h = Math.round(n.w * h0 / w0);
      else if (!auto) n.h = Math.round(Math.max(n.type === 'frame' ? 90 : 36, h0 + dy));
      const d = dom.get(id);
      if (d) place(d.el, n);
      if (auto) { measure(); W.placePorts(); }
      paintLinks(); paintMini();
    }, () => { if (moved) { paintFrames(); app.commit(); } });
  }

  // l'outil L : une flèche d'annotation, droite, qui ne porte rien (les fils partent des sorties)
  function startLink(e, from) {
    const a = app.node(from);
    if (!a) return;
    hint.textContent = 'une flèche d’annotation : relâchez sur un autre objet — dans le vide : une note, déjà fléchée';
    cv.classList.add('linking');
    const mv = (ev) => {
      const [wx, wy] = toWorld(ev.clientX, ev.clientY);
      const [p] = edgePts(a, { x: wx, y: wy, w: 0, h: 0 });
      temp.setAttribute('d', `M${p[0]} ${p[1]}L${wx} ${wy}`);
    };
    mv(e);
    drag(mv, (ev) => {
      temp.setAttribute('d', '');
      cv.classList.remove('linking');
      hint.textContent = HINT;
      const tgt = document.elementFromPoint(ev.clientX, ev.clientY);
      const to = tgt?.closest?.('[data-id]')?.dataset.id;
      if (to && to !== from) { app.connect(from, to); return; }
      if (!to && cv.contains(tgt)) {
        const [wx, wy] = toWorld(ev.clientX, ev.clientY);
        const mk = (type) => () => app.addAt(type, wx, wy - 30, { edit: true, select: true, link: from });
        menu(ev.clientX, ev.clientY, [{ head: 'un objet neuf, fléché' },
          { label: 'Note', onclick: mk('note') }, { label: 'Post-it', onclick: mk('sticky') }, { label: 'Titre', onclick: mk('title') }]);
      }
    });
  }

  function startCreate(e, type) {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
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

  // le cadre de sélection ; avec Alt, un lasso à main levée
  function startSelectArea(e) {
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    const lasso = e.altKey;
    const r = rect();
    const x0 = e.clientX, y0 = e.clientY;
    const pts = [[x0 - r.left, y0 - r.top]];
    const before = new Set(S.sel);
    let moved = false;
    const pick = (ev) => {
      let ids;
      if (lasso) {
        const poly = pts.map(([sx, sy]) => [(sx - V().x) / V().z, (sy - V().y) / V().z]);
        ids = S.board.nodes.filter((n) => pointIn([n.x + n.w / 2, n.y + n.h / 2], poly)).map((n) => n.id);
      } else {
        const [ax, ay] = toWorld(Math.min(x0, ev.clientX), Math.min(y0, ev.clientY));
        const [bx, by] = toWorld(Math.max(x0, ev.clientX), Math.max(y0, ev.clientY));
        const q = { x: ax, y: ay, w: bx - ax, h: by - ay };
        // un cadre ne se prend que s'il est entièrement dans le tracé : sinon tracer dans un cadre le prendrait toujours
        ids = S.board.nodes.filter((n) => (n.type === 'frame' ? inside(n, q) : hits(n, q))).map((n) => n.id);
      }
      S.sel = new Set(add ? [...before, ...ids] : ids);
      S.link = null;
      paintSel(); paintMini();
    };
    drag((ev) => {
      if (pinch) return;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
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
      if (!moved && !add) { S.sel.clear(); S.link = null; paintSel(); }
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

  cv.addEventListener('wheel', (e) => {
    if (e.target.closest('.zoombox, .mini')) return;
    e.preventDefault();
    const r = rect();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(V().z * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  cv.addEventListener('dblclick', (e) => {
    if (locked) return;
    const t = e.target;
    if (t.closest('.zoombox, .mini, .empty, .banner') || isControl(t)) return;
    const id = t.closest('[data-id]')?.dataset.id;
    const n = id && app.node(id);
    if (n) {
      if (['note', 'sticky', 'title'].includes(n.type)) editText(n.id);
      else if (n.type === 'frame') renameFrame(n.id);
      else if (n.type === 'media' && (n.kind === 'image' || n.kind === 'video')) app.lightbox(n);
      else if (CARDS.has(n.type)) dom.get(n.id)?.el.querySelector('textarea:not([readonly])')?.focus({ preventScroll: true });
      return;
    }
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    createMenu(e.clientX, e.clientY, wx, wy);
  });

  cv.addEventListener('contextmenu', (e) => {
    if (isControl(e.target)) return;
    e.preventDefault();
    if (locked) return;
    const id = e.target.closest('[data-id]')?.dataset.id;
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    if (!id) { createMenu(e.clientX, e.clientY, wx, wy); return; }
    if (!S.sel.has(id)) app.select([id]);
    const n = app.node(id);
    menu(e.clientX, e.clientY, [
      { head: S.sel.size > 1 ? `${S.sel.size} objets` : app.label(n) },
      { label: 'Dupliquer', sub: 'ctrl+D', onclick: () => app.duplicate() },
      { label: 'Premier plan', sub: ']', onclick: () => app.order(1) },
      { label: 'Arrière-plan', sub: '[', onclick: () => app.order(-1) },
      ...(S.sel.size > 1 ? [{ label: 'Encadrer', sub: 'un cadre autour', onclick: () => app.frameAround() }] : []),
      '-',
      { label: 'Supprimer', sub: 'Suppr', onclick: () => app.remove() }]);
  });

  function createMenu(cx, cy, wx, wy) {
    const at = (type) => () => app.addAt(type, wx, wy, { edit: ['note', 'sticky', 'title'].includes(type), select: true });
    menu(cx, cy, [{ head: 'poser ici' },
      { label: 'Note', key: 'N', onclick: at('note') }, { label: 'Post-it', key: 'S', onclick: at('sticky') },
      { label: 'Titre', key: 'T', onclick: at('title') }, { label: 'Cadre', key: 'F', onclick: at('frame') },
      '-', { label: 'Générer image', key: 'G', dot: 'or', onclick: at('gen') },
      { label: 'Générer vidéo', key: 'M', dot: 'cy', onclick: at('vgen') },
      { label: 'Composeur de prompt', key: 'P', dot: 'amb', onclick: at('compose') },
      '-', { label: 'Depuis la bibliothèque…', sub: 'images, vidéos, sons, éléments', onclick: () => app.pickAt(wx, wy) }]);
  }

  // écrire dans une note, un post-it, un titre : sur place
  function editText(id) {
    const n = app.node(id);
    const d = dom.get(id);
    const txt = d?.el.querySelector('.txt');
    if (!n || !txt) return;
    app.select([id]);
    txt.textContent = n.text || '';
    txt.classList.remove('ph');
    txt.classList.add('editing');
    try { txt.contentEditable = 'plaintext-only'; } catch { txt.contentEditable = 'true'; }
    if (txt.contentEditable !== 'plaintext-only') txt.contentEditable = 'true';
    txt.focus({ preventScroll: true });
    const sel = getSelection();
    sel.selectAllChildren(txt);
    sel.collapseToEnd();
    const changed = app.editing();
    let wrote = false;
    // ce qu'on écrit part aussitôt dans les cartes qui lisent ce texte (la note elle-même n'est pas refaite)
    const onInput = () => { wrote = true; changed(); n.text = txt.innerText.replace(/\n$/, ''); measure(); W.placePorts(); paintLinks(); renderSoon(); };
    const onPaste = (ev) => { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData.getData('text/plain')); };
    const onKey = (ev) => { if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); txt.blur(); } };
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
    const inp = el('input', { class: 'fr-in', value: n.name || '', maxlength: 120, placeholder: 'nom du cadre' });
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
    if (e.dataTransfer?.types?.includes(CF_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; cv.classList.add('drop-on'); }
  });
  cv.addEventListener('dragleave', (e) => { if (!cv.contains(e.relatedTarget)) cv.classList.remove('drop-on'); });
  const dropPoint = () => (dropAt ? toWorld(...dropAt) : center());
  // un dépôt dans une carte (zone dans la zone) n'atteint pas la planche : son filet s'éteint quand même
  for (const ev of ['drop', 'dragend']) addEventListener(ev, () => setTimeout(() => cv.classList.remove('drop-on')), true);
  dropZone(cv, { kinds: ['image', 'video', 'audio', 'element'], via: 'ideation', onitems: (items) => app.placeMany(items, ...dropPoint()) });
  cv.addEventListener('drop', (e) => {
    const raw = e.dataTransfer?.getData(CF_MIME);
    if (!raw) return;
    e.preventDefault();
    cv.classList.remove('drop-on');
    try { app.placeCf(JSON.parse(raw), ...toWorld(e.clientX, e.clientY)); } catch { /* charge illisible */ }
  });

  hint.textContent = HINT;
  new ResizeObserver(() => paintMini()).observe(cv);
  document.fonts?.ready?.then(() => { if (measure()) { W.placePorts(); paintLinks(); } });

  // ce que les modules greffés lisent et appellent (plugins.js) — des ajouts seulement :
  //   toWorld(x, y) / toScreen(wx, wy)   fenêtre (clientX, clientY) ↔ planche
  //   viewFor(zone, pad, zmax) → { x, y, z } · flyTo(vue | zone | id, { ms, pad, zmax }) → promesse
  //   zoomAt(z, x, y)                    zoomer autour d'un point du canvas (px depuis son coin)
  //   decorate(fn) → désabonner          fn(n, el) à chaque objet refait, et tout de suite
  //   lock() / unlock() / isLocked()     figer les gestes (la vue se déplace encore)
  return { el: cv, render, renderSoon, reflow, applyView, paintSel, paintLinks, paintJobs, paintMini, paintEmpty, fit, zoomTo, zoomBy, zoomAt,
    toWorld, toScreen, viewFor, flyTo, center, viewRect, editText, renameFrame, decorate,
    lock: () => { locked = true; cv.classList.add('locked'); }, unlock: () => { locked = false; cv.classList.remove('locked'); }, isLocked: () => locked,
    dom, portPoint: W.portPoint, over: (x, y) => { const r = rect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; } };
}
