// IDÉATION · OBJETS — recadrer une image (30/09/2026). Demande de Cal : « dans
// l'Idéation, je veux pouvoir recadrer les images, comme dans Miro ».
//
// Ce que Miro en dit (help.miro.com, « Images and Icons », lu par le moteur : la page
// refuse les robots ; tutoriel livedemo.ai « How to crop an image in Miro ») :
//   - choisir l'image, « Crop » dans la barre au-dessus, ou double-cliquer : « enables
//     the crop mode, which allows editing of the rectangular selection » ;
//   - tirer les coins ou les bords ; « you can update the position and scale of the
//     images you are cropping » ; « Press 'Enter' to apply the crop », ou « just click
//     anywhere on the board » ;
//   - non destructif : « You can always revert your cropped image to its original, just
//     double click and expand the crop selection to its original size » ;
//   - des formats proposés (une demande du 02/04/2026 réclame le 3:2 et un format libre
//     à la main, community.miro.com, « Custom Image Crop Ratios ») : les nôtres, Libre,
//     Original, 1:1, 4:3, 3:2, 16:9, 2,39:1 (le scope du cinéma), 3:4, 9:16.
//
// Le modèle : l'image reste entière dans la bibliothèque ; l'objet garde `crop`
// { x, y, w, h }, le rectangle montré en fractions de l'image (server/tools/ideation.py,
// _crop : la même règle). L'objet est ce rectangle, à l'échelle où l'image est posée :
// l'image entière mesure w / crop.w × h / crop.h, son coin est en x − crop.x × W. Juste
// par construction : le rendu (canvas.js), l'export (ideation.py) et la co-édition (un
// registre de plus, `crop`) lisent tous ce même rectangle ; rien n'est recalculé ailleurs.
//
// Pendant le recadrage : l'image entière en voile, le rectangle net, huit poignées
// (coins : deux côtés ; bords : un), glisser dedans déplace le rectangle sur l'image ;
// Maj sur un coin garde les proportions ; une barre au-dessus (les formats, « Image
// entière », Annuler, Appliquer) ; Échap annule, Entrée ou un clic ailleurs applique. La
// vue se déplace et zoome toujours (molette, bouton du milieu). Un pas d'annulation.

import { el, href, toast } from '../../commun/shell.js';

const RATIOS = [['free', 'Libre'], ['orig', 'Original'], [1, '1:1'], [4 / 3, '4:3'], [3 / 2, '3:2'], [16 / 9, '16:9'], [2.39, '2,39:1'], [3 / 4, '3:4'], [9 / 16, '9:16']];
const MIN_PX = 16;          // le plus petit côté, en px du monde (le serveur : 16)
const MIN_F = 0.02;         // … et en fraction de l'image (le serveur : CROP_MIN)
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
let cssDone = false;

export function createCrop(app) {
  const { S } = app;
  let C = null;   // { id, full, r, r0, ratio, ov, win, ghost, inImg, bar, off[] }

  function css() {
    if (cssDone || document.querySelector('link[data-ide-crop]')) { cssDone = true; return; }
    cssDone = true;
    document.head.append(el('link', { rel: 'stylesheet', href: new URL('./recadrer.css', import.meta.url).href, 'data-ide-crop': '' }));
  }
  // pourquoi une image ne se recadre pas (vide : elle se recadre)
  function whyNot(n) {
    if (!n || n.type !== 'media' || n.kind !== 'image') return 'seule une image se recadre';
    const it = S.items.get(n.item);
    if (!it || it.missing) return 'cette image a quitté la bibliothèque';
    if (app.canvas.isLocked()) return 'la planche est figée (présentation, lecture seule)';
    return '';
  }
  const fullOf = (n) => {
    const c = n.crop || { x: 0, y: 0, w: 1, h: 1 };
    const w = n.w / c.w, h = n.h / c.h;
    return { x: n.x - c.x * w, y: n.y - c.y * h, w, h };
  };

  function start(id) {
    const n = app.node(id);
    const why = whyNot(n);
    if (why) { toast(why, 5000); return false; }
    if (C) apply();
    css();
    app.texte?.finish?.();
    const it = S.items.get(n.item);
    const full = fullOf(n);
    const src = href(it.url || it.thumb_url);
    const ghost = el('img', { class: 'crop-ghost', src, alt: '', draggable: 'false' });
    const inImg = el('img', { class: 'crop-img', src, alt: '', draggable: 'false' });
    const win = el('div', { class: 'crop-win', title: 'glisser : déplacer le cadrage sur l’image' }, el('div', { class: 'crop-clip' }, inImg),
      ...HANDLES.map((h) => el('i', { class: `crop-h h-${h}`, 'data-h': h, title: h.length === 2 ? 'un coin · Maj : garder les proportions' : 'un bord' })),
      el('span', { class: 'crop-dim lbl' }));
    const seg = el('span', { class: 'sseg crop-rat' });
    const bar = el('div', { class: 'sbar crop-bar', role: 'toolbar', 'aria-label': 'recadrer' },
      el('span', { class: 'lbl crop-k' }, 'recadrer'), seg,
      el('i', { class: 'ssep' }),
      el('button', { class: 'sbt', type: 'button', title: 'revenir à l’image entière (le recadrage n’efface rien)', onclick: () => whole() }, 'Image entière'),
      el('i', { class: 'ssep' }),
      el('button', { class: 'sbt', type: 'button', title: 'Échap', onclick: () => cancel() }, 'Annuler'),
      el('button', { class: 'sbt crop-ok', type: 'button', title: 'Entrée — ou un clic ailleurs sur la planche', onclick: () => apply() }, 'Appliquer'));
    const ov = el('div', { class: 'crop-ov' }, ghost, win, bar);
    app.canvas.el.append(ov);
    C = { id, full, r: { x: n.x, y: n.y, w: n.w, h: n.h }, r0: { x: n.x, y: n.y, w: n.w, h: n.h, crop: n.crop ? { ...n.crop } : null },
      ratio: 'free', ov, win, ghost, inImg, bar, seg, it, off: [] };
    paintRatios();
    app.canvas.dom.get(id)?.el.classList.add('cropping');
    app.canvas.sel.hide();
    // les gestes : les poignées, le rectangle ; ailleurs, un clic applique (le bouton du milieu déplace la vue)
    for (const h of win.querySelectorAll('.crop-h')) h.addEventListener('pointerdown', (e) => drag(e, h.dataset.h));
    win.addEventListener('pointerdown', (e) => { if (!e.target.closest('.crop-h')) drag(e, 'move'); });
    for (const x of [bar, win]) {
      x.addEventListener('dblclick', (e) => { e.stopPropagation(); if (x === win) apply(); });
      x.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
    }
    bar.addEventListener('pointerdown', (e) => { if (e.button !== 1) e.stopPropagation(); });
    const outside = (e) => {
      if (!C || e.button === 1 || C.ov.contains(e.target) && (C.win.contains(e.target) || C.bar.contains(e.target))) return;
      if (e.target.closest?.('.sr-menu, .scrim, .zoombox, .mini')) return;
      apply();
    };
    const keys = (e) => {
      if (!C) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); apply(); }
    };
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', keys, true);
    C.off.push(() => removeEventListener('pointerdown', outside, true), () => removeEventListener('keydown', keys, true), app.on('view', place));
    place();
    return true;
  }

  // ── la place, en px d'écran (au-dessus de la planche, comme le cadre de sélection) ──
  function place() {
    if (!C) return;
    const v = S.view;
    const scr = (b) => ({ l: v.x + b.x * v.z, t: v.y + b.y * v.z, w: b.w * v.z, h: b.h * v.z });
    const F = scr(C.full), R = scr(C.r);
    const put = (e, b) => Object.assign(e.style, { left: `${b.l}px`, top: `${b.t}px`, width: `${b.w}px`, height: `${b.h}px` });
    put(C.ghost, F);
    put(C.win, R);
    // l'image nette, dans le rectangle, à la place de l'image entière
    Object.assign(C.inImg.style, { left: `${F.l - R.l}px`, top: `${F.t - R.t}px`, width: `${F.w}px`, height: `${F.h}px` });
    C.win.querySelector('.crop-dim').textContent = dims();
    const bw = C.bar.offsetWidth, bh = C.bar.offsetHeight, cv = app.canvas.el, W = cv.clientWidth, H = cv.clientHeight;
    // jamais sous la barre des outils de gauche (barres.css, --side-w), comme la barre de la sélection
    const x0 = 8 + (parseFloat(getComputedStyle(cv).getPropertyValue('--side-w')) || 0);
    let y = Math.min(R.t, F.t) - bh - 12;
    if (y < 8) y = Math.max(R.t + R.h, F.t + F.h) + 12;
    if (y + bh > H - 8) y = 8;
    Object.assign(C.bar.style, { left: `${Math.round(Math.max(x0, Math.min(R.l + R.w / 2 - bw / 2, W - bw - 8)))}px`, top: `${Math.round(Math.max(8, y))}px` });
  }
  // la taille montrée, en pixels de l'image
  function dims() {
    const iw = C.it.width || 0, ih = C.it.height || 0;
    if (!iw || !ih) return '';
    return `${Math.round(C.r.w / C.full.w * iw)} × ${Math.round(C.r.h / C.full.h * ih)}`;
  }

  // ── les formats ─────────────────────────────────────────────
  const ratioOf = (k) => (k === 'orig' ? (C.it.width && C.it.height ? C.it.width / C.it.height : C.full.w / C.full.h) : k);
  function paintRatios() {
    C.seg.replaceChildren(...RATIOS.map(([k, label]) => {
      const b = el('button', { class: 'sbt' + (C.ratio === k ? ' on' : ''), type: 'button', 'aria-pressed': C.ratio === k ? 'true' : 'false',
        title: k === 'free' ? 'des proportions libres (Maj sur un coin : les garder)' : k === 'orig' ? 'les proportions de l’image' : `le format ${label}` }, label);
      b.addEventListener('click', () => setRatio(k));
      return b;
    }));
  }
  // un format : le plus grand rectangle de ce format dans le rectangle actuel, centré (dans l'image)
  function setRatio(k) {
    C.ratio = k;
    paintRatios();
    if (k !== 'free') {
      const q = ratioOf(k), r = C.r;
      let w = r.w, h = w / q;
      if (h > r.h) { h = r.h; w = h * q; }
      C.r = fit({ x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h });
    }
    place();
  }
  const minW = () => Math.max(MIN_PX, C.full.w * MIN_F), minH = () => Math.max(MIN_PX, C.full.h * MIN_F);
  // le rectangle gardé dans l'image
  function fit(r) {
    const F = C.full;
    const w = Math.min(Math.max(r.w, minW()), F.w), h = Math.min(Math.max(r.h, minH()), F.h);
    return { x: Math.min(Math.max(r.x, F.x), F.x + F.w - w), y: Math.min(Math.max(r.y, F.y), F.y + F.h - h), w, h };
  }
  function whole() { C.ratio = 'free'; paintRatios(); C.r = { ...C.full }; place(); }

  // ── tirer une poignée, déplacer le rectangle ─────────────────
  function drag(e, h) {
    if (e.button !== 0) return;   // le bouton du milieu passe à la planche (il déplace la vue)
    e.preventDefault(); e.stopPropagation();
    const z = S.view.z, x0 = e.clientX, y0 = e.clientY, r0 = { ...C.r }, F = C.full;
    const mv = (ev) => {
      const dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z;
      if (h === 'move') { C.r = fit({ ...r0, x: r0.x + dx, y: r0.y + dy }); place(); return; }
      let L = r0.x, T = r0.y, R = r0.x + r0.w, B = r0.y + r0.h;
      if (h.includes('w')) L = Math.min(Math.max(F.x, L + dx), R - minW());
      if (h.includes('e')) R = Math.max(Math.min(F.x + F.w, R + dx), L + minW());
      if (h.includes('n')) T = Math.min(Math.max(F.y, T + dy), B - minH());
      if (h.includes('s')) B = Math.max(Math.min(F.y + F.h, B + dy), T + minH());
      let r = { x: L, y: T, w: R - L, h: B - T };
      const q = C.ratio !== 'free' ? ratioOf(C.ratio) : ev.shiftKey && h.length === 2 ? r0.w / r0.h : null;
      if (q) r = keep(r, q, h, r0);
      C.r = r;
      place();
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }
  // des proportions gardées : l'ancre est le côté (ou le coin) opposé à la poignée ; le
  // rectangle ne sort jamais de l'image (il rétrécit plutôt)
  function keep(r, q, h, r0) {
    const F = C.full;
    let w = r.w, hh = r.h;
    if (h === 'n' || h === 's') w = hh * q; else if (h === 'e' || h === 'w') hh = w / q; else if (w / hh > q) hh = w / q; else w = hh * q;
    const ax = h.includes('w') ? r0.x + r0.w : h.includes('e') ? r0.x : r0.x + r0.w / 2;
    const ay = h.includes('n') ? r0.y + r0.h : h.includes('s') ? r0.y : r0.y + r0.h / 2;
    // la place qu'il y a depuis l'ancre, dans l'image
    const maxW = h.includes('w') ? ax - F.x : h.includes('e') ? F.x + F.w - ax : 2 * Math.min(ax - F.x, F.x + F.w - ax);
    const maxH = h.includes('n') ? ay - F.y : h.includes('s') ? F.y + F.h - ay : 2 * Math.min(ay - F.y, F.y + F.h - ay);
    const k = Math.min(1, maxW / w, maxH / hh);
    w *= k; hh *= k;
    const x = h.includes('w') ? ax - w : h.includes('e') ? ax : ax - w / 2;
    const y = h.includes('n') ? ay - hh : h.includes('s') ? ay : ay - hh / 2;
    return { x, y, w, h: hh };
  }

  // ── finir ────────────────────────────────────────────────────
  function close() {
    if (!C) return;
    for (const f of C.off) f();
    C.ov.remove();
    app.canvas.dom.get(C.id)?.el.classList.remove('cropping');
    C = null;
    app.canvas.paintSel();
  }
  function cancel() { close(); }
  function apply() {
    if (!C) return;
    const n = app.node(C.id), F = C.full, r = C.r, r0 = C.r0;
    const same = Math.abs(r.x - r0.x) < 0.5 && Math.abs(r.y - r0.y) < 0.5 && Math.abs(r.w - r0.w) < 0.5 && Math.abs(r.h - r0.h) < 0.5;
    close();
    if (!n || same) return;
    const x = Math.round(r.x), y = Math.round(r.y), w = Math.max(MIN_PX, Math.round(r.w)), h = Math.max(MIN_PX, Math.round(r.h));
    const c = { x: (r.x - F.x) / F.w, y: (r.y - F.y) / F.h, w: r.w / F.w, h: r.h / F.h };
    const all = c.x < 1e-4 && c.y < 1e-4 && c.w > 1 - 1e-4 && c.h > 1 - 1e-4;
    const round5 = (v) => Math.round(v * 1e5) / 1e5;
    app.mutate(() => {
      Object.assign(n, { x, y, w, h });
      if (all) delete n.crop;
      else n.crop = { x: round5(c.x), y: round5(c.y), w: round5(Math.min(c.w, 1 - c.x)), h: round5(Math.min(c.h, 1 - c.y)) };
    });
    toast(all ? 'l’image entière revient' : 'recadrée — l’image reste entière : double-clic pour y revenir, ctrl+Z pour annuler', 4000);
  }

  return { start, apply, cancel, active: () => (C ? C.id : null), whyNot, fullOf, state: () => (C ? { id: C.id, r: { ...C.r }, full: { ...C.full }, ratio: C.ratio } : null) };
}
