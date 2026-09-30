// IDÉATION · DIAPOSITIVES — faire ses slides dans l'Idéation (Cal, 29/09 :
// « je veux qu'on puisse faire nos slides dans notre outil Idéation et faire un
// design génial dedans »). L'étude : docs/etudes/presentations.md, étapes 1 à 4
// sans la publication ni le PDF.
//
//   - un cadre devient une diapositive : `deck` {ratio, trans} ; sa taille est
//     alors celle de sa scène (1920 × 1080 en 16:9, server/tools/ideation.py
//     DECK_RATIOS) : les objets posés dedans sont en px de la scène, le zoom de la
//     planche en fait l'image réduite. « Faire une diapositive » d'un cadre libre
//     met son contenu à l'échelle de la scène et la pose sans chevaucher ses
//     voisins ;
//   - la grille de 12 colonnes (marges, gouttière, ligne de base de 8) : pendant
//     qu'on déplace un objet dans une diapositive, il s'aimante aux colonnes, aux
//     marges et à la ligne de base (en plus des guides des objets, objets/guides.js ;
//     Alt : libre) ; elle paraît sur la diapositive choisie et pendant le geste ;
//   - les styles de texte nommés (Display, H1, H2, Corps, Légende, Étiquette) :
//     `style` sur un titre ou une note ; la planche peut changer un style (`pres`),
//     tous ses textes suivent ; la bibliothèque de polices déclare leur licence
//     (polices.js) ;
//   - le panneau Diapositives : les vignettes dans l'ordre (ordre.js), glisser pour
//     réordonner, masquer, dupliquer, présenter d'ici ;
//   - l'inspecteur, les menus, la palette ⌘K : app.diapo (panels, nodeItems,
//     selItems, boardItems), appelés par inspector.js et menus.js.
// Tout passe par app.mutate : un pas d'annulation (Ctrl+Z), et la co-édition
// (coedition.js) envoie les registres changés (`slide`, `skip`, `deck`, `style`,
// `align`, `mid` d'un objet ; `pres` de la planche).

import { el, toast } from '../../commun/shell.js';
import { menu } from '../../commun/menu.js';
import { atelier, within, readingOrder } from '../atelier/socle.js';
import * as G from '../objets/guides.js';
import { isSlide, deckOf, putOrder, setOrder, readingReset, setSkip } from './ordre.js';
import { deckMeta, styleOf, stylesCss, fontOf, licenceLine, ensureFont } from './polices.js';
import { drawSlide } from './vignette.js';

const TRANS = [['cut', 'Coupe'], ['fade', 'Fondu'], ['push', 'Poussée'], ['morph', 'Morph']];
const ALIGN = [['left', 'Gauche'], ['center', 'Centre'], ['right', 'Droite']];
const GAP = 160;   // entre deux diapositives posées côte à côte (px du monde)
const ICON = 'M3 5h7v5H3zM3 14h7v5H3zM13 6h8M13 9h5M13 15h8M13 18h5';
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const centerIn = (n, r) => { const cx = n.x + n.w / 2, cy = n.y + n.h / 2; return cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h; };
const two = (k) => String(k).padStart(2, '0');

export function install(app) {
  const A = atelier(app);
  const { S } = app;
  const cv = A.cv;
  if (!document.querySelector('link[data-diapo]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: new URL('./diapo.css', import.meta.url).href, 'data-diapo': '' }));
  }
  const M = () => deckMeta(app);
  const stage = (ratio) => M()?.ratios?.[ratio] || null;
  const P = () => A.presentation;
  const transName = (t) => (TRANS.find(([k]) => k === t) || [0, 'Fondu'])[1];

  // la grille d'une diapositive : colonnes en px de la scène (= du monde)
  function grid(f) {
    const g = M()?.grid;
    if (!g || !isSlide(f)) return null;
    return { ...g, cw: (f.w - 2 * g.margin - (g.cols - 1) * g.gutter) / g.cols };
  }
  // la diapositive sous un point (la plus petite, si elles se chevauchent), hors de `skip`
  function slideAt(x, y, skip = null) {
    let best = null;
    for (const f of S.board?.nodes || []) {
      if (!isSlide(f) || skip?.has(f.id)) continue;
      if (x > f.x && x < f.x + f.w && y > f.y && y < f.y + f.h && (!best || f.w * f.h < best.w * best.h)) best = f;
    }
    return best;
  }
  const slidesOn = () => (S.board?.nodes || []).some(isSlide);

  // ── les styles de texte : une feuille vivante (polices.js) ─
  const sheet = A.style('diapo-styles');
  const paintStyles = () => sheet(stylesCss(app));

  // ── l'habit des objets : style, alignement, diapositive, grille ─
  app.canvas.decorate((n, e) => {
    if (n.type === 'note' || n.type === 'title') {
      if (n.style) e.dataset.st = n.style; else delete e.dataset.st;
      if (n.align) e.dataset.al = n.align; else delete e.dataset.al;
      return;
    }
    if (n.type !== 'frame') return;
    e.classList.toggle('deck', isSlide(n));
    const h = e.querySelector('.fr-h');
    if (h && !h.querySelector('.dp-no')) h.prepend(el('span', { class: 'dp-no' }));
    e.querySelector('.dp-grid')?.remove();
    e.querySelector('.dp-fmt')?.remove();
    const g = grid(n);
    if (!g) return;
    e.style.setProperty('--dp-m', `${g.margin}px`);
    e.style.setProperty('--dp-cw', `${g.cw}px`);
    e.style.setProperty('--dp-g', `${g.gutter}px`);
    e.append(el('div', { class: 'dp-grid' }));
    h?.append(el('span', { class: 'dp-fmt' }, `${n.deck.ratio} · ${transName(n.deck.trans)}`));
  });
  // le numéro de chaque cadre dans la présentation (dès qu'une diapositive est sur la planche)
  function paintNumbers() {
    if (!S.board) return;
    const show = slidesOn();
    const { seq, skip } = deckOf(S.board);
    let k = 0;
    for (const f of seq) {
      const e = app.canvas.dom.get(f.id)?.el.querySelector('.dp-no');
      const t = !show ? '' : skip.has(f.id) ? '—' : two(++k);
      if (e && e.textContent !== t) e.textContent = t;
    }
  }

  // ── l'aimant de la grille (en plus des guides des objets) ─
  const base = app.objets.snapper;
  app.objets.snapper = (env, moving, box0) => {
    const inner = base(env, moving, box0);
    if (!S.snap || !box0 || !slidesOn()) return inner;
    const T = G.targets(app, moving);
    let lit = null;
    const light = (f) => {
      if (lit === f) return;
      if (lit) app.canvas.dom.get(lit.id)?.el.classList.remove('dp-on');
      lit = f;
      if (f) app.canvas.dom.get(f.id)?.el.classList.add('dp-on');
    };
    const paint = (g) => G.paintGuides(env.over, S.view, env.cv.clientWidth, env.cv.clientHeight, g);
    return {
      move(dx, dy, free) {
        const b = { x: box0.x + dx, y: box0.y + dy, w: box0.w, h: box0.h };
        const f = slideAt(b.x + b.w / 2, b.y + b.h / 2, moving);
        light(f);
        if (free || !f) return inner ? inner.move(dx, dy, free) : (paint(null), [dx, dy]);
        const g = grid(f);
        const xs = [f.x + f.w / 2];
        for (let i = 0; i < g.cols; i++) { const x = f.x + g.margin + i * (g.cw + g.gutter); xs.push(x, x + g.cw); }
        const ys = [f.y + g.margin, f.y + f.h - g.margin, f.y + f.h / 2];
        const s = G.snap(b, { xs: [...T.xs, ...xs], ys: [...T.ys, ...ys] }, G.SNAP_PX / S.view.z);
        paint(s.gx === null && s.gy === null ? null : s);
        // sans repère en y : le haut de la boîte sur la ligne de base
        let ddy = s.dy;
        if (s.gy === null) ddy = Math.round((b.y - f.y) / g.baseline) * g.baseline + f.y - b.y;
        return [dx + s.dx, dy + ddy];
      },
      end() { light(null); inner?.end(); paint(null); },
    };
  };

  // ── un titre, une note posés dans une diapositive : un style, sur la grille ─
  const add0 = app.addAt;
  app.addAt = (type, wx, wy, o = {}) => {
    const f = (type === 'title' || type === 'note') && !(o.preset && 'style' in o.preset) ? slideAt(wx, wy) : null;
    const g = f && grid(f);
    if (g) {
      const cols = type === 'title' ? 8 : 6;
      const w = Math.round(cols * g.cw + (cols - 1) * g.gutter);
      if (o.at !== 'center') {
        const i = Math.max(0, Math.min(g.cols - cols, Math.round((wx - f.x - g.margin) / (g.cw + g.gutter))));
        wx = f.x + g.margin + i * (g.cw + g.gutter);
        wy = f.y + Math.round((wy - f.y) / g.baseline) * g.baseline;
      }
      o = { ...o, w: o.w || w, preset: { ...(o.preset || {}), style: type === 'title' ? 'h1' : 'body' } };
    }
    return add0(type, wx, wy, o);
  };

  // ── faire des diapositives ────────────────────────────────
  // la place d'une scène : décalée vers la droite tant qu'elle chevauche un autre cadre,
  // ou couvre le centre d'un objet qui n'est pas à elle
  function freeX(B, r, mine, taken = []) {
    const others = B.nodes.filter((n) => !mine.has(n.id) && n.type !== 'group');
    let dx = 0;
    for (let i = 0; i < 300; i++) {
      const R = { ...r, x: r.x + dx };
      const hit = others.find((n) => (n.type === 'frame' ? overlap(R, n) : centerIn(n, R))) || taken.find((t) => overlap(R, t));
      if (!hit) break;
      dx = hit.x + hit.w + GAP - r.x;
    }
    return dx;
  }
  function makeSlides(ids, ratio = '16:9') {
    const st = stage(ratio);
    if (!st || !S.board) { toast('les formats ne sont pas encore lus : le portail répond-il ?'); return; }
    const [W, H] = st;
    const frames = readingOrder(ids.map((id) => app.node(id)).filter((f) => f?.type === 'frame'));
    if (!frames.length) return;
    app.mutate((B) => {
      const taken = [];
      // les cadres convertis ensemble, et leur contenu, ne se gênent pas : ils se posent à la suite (taken)
      const batch = new Set(frames.flatMap((f) => [f.id, ...B.nodes.filter((n) => n !== f && n.type !== 'frame' && within(n, f)).map((n) => n.id)]));
      for (const f of frames) {
        if (isSlide(f) && f.deck.ratio === ratio) { taken.push({ ...f }); continue; }
        const was = isSlide(f);
        const content = B.nodes.filter((n) => n !== f && n.type !== 'frame' && within(n, f));
        const k = Math.min(W / f.w, H / f.h);
        const ox = (W - f.w * k) / 2, oy = (H - f.h * k) / 2;
        for (const n of content) {
          if (n.type === 'group') continue;   // sa boîte suit ses enfants
          n.x = Math.round(f.x + ox + (n.x - f.x) * k); n.y = Math.round(f.y + oy + (n.y - f.y) * k);
          n.w = Math.round(n.w * k); n.h = Math.round(n.h * k);
          // un cadre libre agrandi : ses titres et ses notes prennent la gamme de la scène
          if (!was && k > 1.2 && !n.style) { if (n.type === 'title') n.style = 'h1'; if (n.type === 'note') n.style = 'body'; }
        }
        f.w = W; f.h = H;
        f.deck = { ratio, trans: f.deck?.trans || 'fade' };
        const dx = freeX(B, { x: f.x, y: f.y, w: W, h: H }, batch, taken);
        if (dx) for (const n of [f, ...content]) n.x += dx;
        taken.push({ x: f.x, y: f.y, w: W, h: H });
      }
      S.sel = new Set(frames.map((f) => f.id)); S.link = null;
    });
    const r = frames.reduce((a, f) => ({ x: Math.min(a.x, f.x), y: Math.min(a.y, f.y), x1: Math.max(a.x1, f.x + f.w), y1: Math.max(a.y1, f.y + f.h) }),
      { x: Infinity, y: Infinity, x1: -Infinity, y1: -Infinity });
    A.fly(A.viewFor({ x: r.x, y: r.y, w: r.x1 - r.x, h: r.y1 - r.y }, { pad: 70, zmax: 1 }), { ms: 520 });
    open(false);
  }
  const unslide = (id) => app.mutate(() => { const f = app.node(id); if (f) delete f.deck; });
  const setTrans = (id, t) => app.mutate(() => { const f = app.node(id); if (isSlide(f)) f.deck = { ...f.deck, trans: t }; });

  // une diapositive neuve : à droite de la dernière, sinon au centre de la vue (ou au point donné)
  function newSlide(at = null) {
    const st = stage('16:9');
    if (!st || !S.board) { toast(S.board ? 'les formats ne sont pas encore lus : le portail répond-il ?' : 'ouvrez d’abord une planche'); return null; }
    const [W, H] = st;
    const { seq } = deckOf(S.board);
    const last = seq.filter(isSlide).pop();
    let x, y;
    if (at) [x, y] = [at[0] - W / 2, at[1] - H / 2];
    else if (last) [x, y] = [last.x + last.w + GAP, last.y];
    else { const [cx, cy] = app.canvas.center(); [x, y] = [cx - W / 2, cy - H / 2]; }
    x = Math.round(x); y = Math.round(y);
    const f = { id: app.uid('n'), type: 'frame', x, y, w: W, h: H, name: `Diapositive ${seq.filter(isSlide).length + 1}`, deck: { ratio: '16:9', trans: 'fade' } };
    app.mutate((B) => {
      f.x += freeX(B, f, new Set([f.id]));
      B.nodes.unshift(f);
      S.sel = new Set([f.id]); S.link = null;
    });
    A.fly(A.viewFor(f, { pad: 70, zmax: 1 }), { ms: 480 });
    open(false);
    return f;
  }

  // dupliquer une diapositive (et ce qu'elle contient) : juste après elle dans l'ordre ; chaque objet
  // copié porte le `mid` de l'original (posé sur l'original s'il n'en avait pas) : le morph les apparie
  function duplicateSlide(id) {
    const f = app.node(id);
    if (!f || f.type !== 'frame') return;
    let copy = null;
    app.mutate((B) => {
      const content = B.nodes.filter((n) => n !== f && n.type !== 'frame' && within(n, f));
      const kids = content.flatMap((n) => (n.type === 'group' ? B.nodes.filter((k) => k.group === n.id && !content.includes(k)) : []));
      const all = [...content, ...kids];
      for (const n of all) if (!n.mid && n.type !== 'group') n.mid = n.id;
      const dx = f.w + GAP + freeX(B, { x: f.x + f.w + GAP, y: f.y, w: f.w, h: f.h }, new Set());
      const map = new Map();
      copy = { ...JSON.parse(JSON.stringify(f)), id: app.uid('n'), x: f.x + dx, name: `${f.name || 'Cadre'} · 2` };
      delete copy.slide; delete copy.skip;
      map.set(f.id, copy.id);
      const made = all.map((n) => { const c = JSON.parse(JSON.stringify(n)); c.id = app.uid(n.type === 'group' ? 'g' : 'n'); c.x += dx; if (c.jobs) c.jobs = []; map.set(n.id, c.id); return c; });
      for (const c of made) { if (c.group) { if (map.has(c.group)) c.group = map.get(c.group); else delete c.group; } if (c.parent) { if (map.has(c.parent)) c.parent = map.get(c.parent); else delete c.parent; } }
      B.nodes.unshift(copy);
      B.nodes.push(...made);
      for (const l of B.links.slice()) if (map.has(l.a) && map.has(l.b) && l.a !== f.id && l.b !== f.id) B.links.push({ ...l, id: app.uid('l'), a: map.get(l.a), b: map.get(l.b) });
      const order = deckOf(B).seq.map((x) => x.id).filter((x) => x !== copy.id);
      order.splice(order.indexOf(f.id) + 1, 0, copy.id);
      putOrder(B, order);
      S.sel = new Set([copy.id]); S.link = null;
    });
    if (copy) A.fly(A.viewFor(copy, { pad: 70, zmax: 1 }), { ms: 480 });
  }

  // ── le style d'un texte ───────────────────────────────────
  const texts = (list) => list.filter((n) => n && (n.type === 'title' || n.type === 'note'));
  function setStyle(list, sid) {
    const ts = texts(list);
    if (!ts.length) return;
    app.mutate(() => { for (const n of ts) { if (sid) n.style = sid; else delete n.style; } });
  }
  function setAlign(list, al) {
    const ts = texts(list);
    if (!ts.length) return;
    app.mutate(() => { for (const n of ts) { if (al && al !== 'left') n.align = al; else delete n.align; } });
  }
  const selected = () => [...S.sel].map((id) => app.node(id)).filter(Boolean);

  // ── les styles de la présentation (et la bibliothèque de polices) ─
  function patchStyle(sid, patch) {
    const def = M().styles[sid];
    app.mutate((B) => {
      const p = JSON.parse(JSON.stringify(B.pres || {}));
      p.styles = p.styles || {};
      const cur = patch === null ? {} : { ...(p.styles[sid] || {}), ...patch };
      for (const k of Object.keys(cur)) if (cur[k] === def[k]) delete cur[k];
      if (Object.keys(cur).length) p.styles[sid] = cur; else delete p.styles[sid];
      if (Object.keys(p.styles).length) B.pres = p; else delete B.pres;
    });
  }
  function stylesModal() {
    const D = M();
    if (!D || !S.board) { toast('les styles ne sont pas encore lus : le portail répond-il ?'); return; }
    const body = el('div', { class: 'dp-styles' });
    const num = (v, { min, max, step, unit }, on) => {
      const i = el('input', { class: 'fld', type: 'number', value: String(v), min, max, step, 'aria-label': unit });
      i.addEventListener('change', () => { const x = Number(i.value); if (Number.isFinite(x)) on(x); });
      return el('label', { class: 'dp-num' }, i, el('span', { class: 'lbl' }, unit));
    };
    const row = (sid) => {
      const st = styleOf(app, sid);
      const own = !!S.board.pres?.styles?.[sid];
      const f = st.fontObj;
      const fonts = D.fonts.filter((x) => x.use);
      const sel = el('select', { class: 'fld', 'aria-label': 'police' },
        ...fonts.map((x) => el('option', { value: x.id, selected: x.id === f?.id ? true : null }, `${x.name}${x.proposed ? ' · proposée' : ''}${x.web ? '' : ' · bureau'}`)));
      sel.addEventListener('change', () => {
        const nf = fontOf(app, sel.value);
        ensureFont(app, nf.id, () => { app.render(); paint(); });
        const w = nf.weights.reduce((a, b) => (Math.abs(b - st.weight) < Math.abs(a - st.weight) ? b : a), nf.weights[0]);
        patchStyle(sid, { font: nf.id, weight: w });
        paint();
      });
      const wsel = el('select', { class: 'fld', 'aria-label': 'graisse' }, ...(f?.weights || [400]).map((w) => el('option', { value: String(w), selected: w === st.weight ? true : null }, String(w))));
      wsel.addEventListener('change', () => { patchStyle(sid, { weight: Number(wsel.value) }); paint(); });
      const up = el('input', { type: 'checkbox', checked: st.upper ? true : null });
      up.addEventListener('change', () => { patchStyle(sid, { upper: up.checked }); paint(); });
      return el('div', { class: 'dp-srow' },
        el('div', { class: 'dp-sh' }, el('b', {}, st.name), el('span', { class: 'lbl' }, `${st.size} px · ${f?.name || '—'}${f && !f.web ? ' · bureau' : ''}`),
          el('span', { class: 'sp' }),
          el('button', { class: 'tb ghost sm', type: 'button', disabled: own ? null : true, title: own ? 'revenir au style par défaut' : 'ce style est celui par défaut', onclick: () => { patchStyle(sid, null); paint(); } }, 'Défaut')),
        el('div', { class: 'dp-sample', style: { fontFamily: st.css, fontWeight: String(st.weight), letterSpacing: `${st.track}em`, lineHeight: String(st.lh),
          textTransform: st.upper ? 'uppercase' : 'none', fontSize: `${Math.max(12, Math.min(44, st.size * 0.42))}px` } }, 'Réponse au brief — été 2026'),
        el('div', { class: 'dp-ctl' }, sel, wsel,
          num(st.size, { min: 6, max: 400, step: 1, unit: 'px' }, (v) => { patchStyle(sid, { size: v }); paint(); }),
          num(st.lh, { min: 0.7, max: 3, step: 0.05, unit: 'interligne' }, (v) => { patchStyle(sid, { lh: v }); paint(); }),
          num(st.track, { min: -0.2, max: 1, step: 0.01, unit: 'approche em' }, (v) => { patchStyle(sid, { track: v }); paint(); }),
          el('label', { class: 'dp-chk' }, up, el('span', { class: 'lbl' }, 'capitales'))));
    };
    const fontsBox = () => el('div', { class: 'dp-fonts' }, el('span', { class: 'lbl' }, 'polices · licences'),
      ...D.fonts.map((f) => el('div', { class: 'dp-font' + (f.use ? '' : ' off') },
        el('b', { style: f.use ? { fontFamily: `"${f.family}", ${f.gen}` } : null }, f.name),
        el('span', { class: 'dp-lic ' + (f.web && f.pdf ? 'ok' : 'no') }, f.web && f.pdf ? 'web + pdf' : 'bureau'),
        el('small', {}, `${licenceLine(f)} · ${f.note}`),
        el('a', { class: 'dp-src', href: f.url, target: '_blank', rel: 'noopener noreferrer' }, 'licence ↗'))));
    const paint = () => {
      paintStyles();
      body.replaceChildren(...Object.keys(D.styles).map(row), fontsBox());
    };
    paint();
    // les polices proposées se chargent pour se montrer (dans ce seul dialogue)
    for (const f of D.fonts) if (f.proposed) ensureFont(app, f.id, () => {});
    app.modal('Styles de la présentation', body, (close) => [
      el('button', { class: 'tb ghost', type: 'button', disabled: S.board.pres ? null : true, title: 'tous les styles reviennent à leur défaut',
        onclick: () => { app.mutate((B) => { delete B.pres; }); paint(); } }, 'Tout par défaut'),
      el('span', { class: 'sp' })], { cls: 'lg dp-modal' });
  }

  // ── le panneau Diapositives ───────────────────────────────
  const list = el('div', { class: 'dp-list', role: 'list' });
  const count = el('span', { class: 'dp-n lbl' });
  const presentB = el('button', { class: 'tb ghost sm', type: 'button', title: 'présenter depuis la première · clic droit sur une vignette : d’ici', onclick: () => P()?.start() }, 'Présenter');
  const panel = A.panel('dp-panel',
    el('div', { class: 'dp-h' }, el('span', { class: 'lbl' }, 'diapositives'), count, el('span', { class: 'sp' }), presentB,
      el('button', { class: 'tb ghost sm dp-x', type: 'button', title: 'fermer le panneau', 'aria-label': 'fermer le panneau', onclick: () => close() }, '×')),
    list,
    el('div', { class: 'dp-f' },
      el('button', { class: 'tb ghost sm', type: 'button', title: 'une diapositive 16:9, à droite de la dernière', onclick: () => newSlide() }, '+ Diapositive'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'les styles de texte et les polices de la présentation', onclick: () => stylesModal() }, 'Styles'),
      el('button', { class: 'tb ghost sm dp-ro', type: 'button', title: 'revenir à l’ordre de lecture de la planche (par rangées, de gauche à droite)', onclick: () => readingReset(app) }, 'Ordre de lecture'),
      // le mode Présentation (ideation/presentation/mode.js) : chargé seulement quand on y entre
      el('button', { class: 'tb ghost sm dp-pm', type: 'button', title: 'le mode Présentation : modèles, motion, passe assistée (sa propre vue ; Échap rend l’Idéation telle quelle)', onclick: () => enterMode() }, 'Mode présentation')));
  panel.hidden = true;
  cv.append(panel);
  const isOpen = () => !panel.hidden;
  // `keep` : le choix de Cal, gardé pour les planches suivantes ; sans lui (une planche qui a des
  // diapositives l'ouvre d'elle-même), rien n'est gardé
  function open(keep = true) { if (keep) app.LS('dp-open', true); panel.hidden = false; paintPanel(true); syncBtn(); }
  function close(keep = true) { if (keep) app.LS('dp-open', false); panel.hidden = true; syncBtn(); }
  const toggle = () => (isOpen() ? close() : open());
  const btn = A.button({ order: 11, d: ICON, name: 'Diapositives', title: 'le panneau des diapositives : vignettes, ordre (glisser), styles', onclick: () => toggle() });
  const syncBtn = () => btn.classList.toggle('on', isOpen());

  let rowsKey = '', thumbs = [];
  const looks = new Map();   // présentation : l'habit du modèle de chaque diapositive (paintLook, plus bas)
  function rowMenu(f) {
    const hidden = !!f.skip;
    return [{ head: f.name || 'Cadre' },
      { label: 'Présenter d’ici', onclick: () => P()?.start(f.id) },
      { label: 'Mode présentation d’ici', sub: 'motion', disabled: !isSlide(f), why: 'un cadre libre n’a pas de scène : choisissez un format (16:9…)', onclick: () => enterMode(f.id) },
      { label: 'Voir sur la planche', onclick: () => goTo(f) },
      { label: 'Dupliquer la diapositive', sub: 'morph', onclick: () => duplicateSlide(f.id) },
      { label: hidden ? 'Montrer' : 'Masquer', sub: 'dans la présentation', onclick: () => setSkip(app, f.id, !hidden) },
      '-', ...formatItems(f), ...(isSlide(f) ? ['-', ...transItems(f)] : [])];
  }
  const formatItems = (f) => [{ head: 'format' }, { label: 'Libre', checked: !isSlide(f), onclick: () => unslide(f.id) },
    ...Object.keys(M()?.ratios || {}).map((r) => ({ label: r, checked: f.deck?.ratio === r, onclick: () => makeSlides([f.id], r) }))];
  const transItems = (f) => [{ head: 'transition' }, ...TRANS.map(([k, v]) => ({ label: v, checked: (f.deck?.trans || 'fade') === k, onclick: () => setTrans(f.id, k) }))];
  function goTo(f) {
    app.select([f.id]);
    A.fly(A.viewFor(f, { pad: 60, zmax: 2 }), { ms: 480 });
  }
  function move(id, dir) {
    const ids = deckOf(S.board).seq.map((f) => f.id);
    const i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrder(app, ids);
  }
  function startDrag(e, id, r) {
    if (e.button !== 0 || e.target.closest('button')) return;
    const y0 = e.clientY;
    let moving = false, at = -1;
    const rows = [...list.querySelectorAll('.dp-row')];
    const clear = () => rows.forEach((x) => x.classList.remove('over-t', 'over-b', 'drag'));
    const mv = (ev) => {
      if (!moving && Math.abs(ev.clientY - y0) < 4) return;
      moving = true;
      r.classList.add('drag');
      at = rows.length;
      for (let i = 0; i < rows.length; i++) { const b = rows[i].getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { at = i; break; } }
      rows.forEach((x, i) => { x.classList.toggle('over-t', i === at); x.classList.toggle('over-b', at === rows.length && i === rows.length - 1); });
      const lb = list.getBoundingClientRect();
      if (ev.clientY < lb.top + 24) list.scrollTop -= 12; else if (ev.clientY > lb.bottom - 24) list.scrollTop += 12;
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      clear();
      if (!moving) { const f = app.node(id); if (f) goTo(f); return; }
      const ids = deckOf(S.board).seq.map((f) => f.id);
      const from = ids.indexOf(id);
      if (from < 0) return;
      const to = at > from ? at - 1 : at;
      if (to === from) return;
      ids.splice(from, 1);
      ids.splice(to, 0, id);
      setOrder(app, ids);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }
  function row(f, no, k, n) {
    const th = el('canvas', { class: 'dp-th' + (isSlide(f) ? '' : ' free'), 'aria-hidden': 'true', style: { aspectRatio: `${f.w} / ${f.h}` } });
    const b = (label, title, onclick, disabled = false, cls = '') => el('button', { class: `tb ghost sm ${cls}`.trim(), type: 'button', title, 'aria-label': title,
      disabled: disabled ? true : null, onclick: (e) => { e.stopPropagation(); onclick(); } }, label);
    const r = el('div', { class: 'dp-row' + (f.skip ? ' off' : '') + (S.sel.has(f.id) ? ' sel' : ''), role: 'listitem', 'data-id': f.id,
      title: 'glisser pour changer la place · double-clic : présenter d’ici · clic droit : format, transition, dupliquer' },
      el('span', { class: 'no' }, no),
      th,
      el('span', { class: 'nm' }, el('b', {}, f.name || 'Cadre'), el('small', {}, isSlide(f) ? `${f.deck.ratio} · ${transName(f.deck.trans)}` : 'cadre libre')),
      el('span', { class: 'ops' },
        b('↑', 'monter', () => move(f.id, -1), k === 0),
        b('↓', 'descendre', () => move(f.id, 1), k === n - 1),
        b(f.skip ? 'Montrer' : 'Masquer', f.skip ? 'la remettre dans la présentation' : 'ne pas la montrer', () => setSkip(app, f.id, !f.skip), false, 'vis')));
    r.addEventListener('pointerdown', (e) => startDrag(e, f.id, r));
    r.addEventListener('dblclick', (e) => { e.stopPropagation(); P()?.start(f.id); });
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); menu(e.clientX, e.clientY, rowMenu(f)); });
    return { r, th, id: f.id };
  }
  let paintF = 0, thumbT = 0;
  function paintPanel(now = false) {
    if (!now) { cancelAnimationFrame(paintF); paintF = requestAnimationFrame(() => paintPanel(true)); return; }
    if (!isOpen() || !S.board) return;
    const { seq, skip } = deckOf(S.board);
    const shown = seq.filter((f) => !skip.has(f.id)).length;
    count.textContent = `${shown}${skip.size ? ` · ${skip.size} masquée${skip.size > 1 ? 's' : ''}` : ''}`;
    presentB.disabled = shown ? null : true;
    presentB.title = shown ? 'présenter depuis la première' : 'rien à présenter : un cadre (F), ou + Diapositive';
    const key = JSON.stringify(seq.map((f) => [f.id, f.name, f.deck, f.skip, f.w, f.h, S.sel.has(f.id)]));
    if (key !== rowsKey) {
      rowsKey = key;
      let k = 0;
      thumbs = seq.map((f, i) => row(f, skip.has(f.id) ? '—' : two(++k), i, seq.length));
      list.replaceChildren(...(thumbs.length ? thumbs.map((t) => t.r)
        : [el('p', { class: 'dp-empty' }, 'Un cadre est une diapositive. + Diapositive en pose une 16:9.')]));
      drawThumbs();
    }
  }
  function drawThumbs(later = false) {
    if (later) { clearTimeout(thumbT); thumbT = setTimeout(() => drawThumbs(), 260); return; }
    if (!isOpen()) return;
    for (const t of thumbs) { const f = app.node(t.id); if (f) drawSlide(t.th, app, f, (sid) => styleOf(app, sid), () => drawThumbs(true), (x) => looks.get(x.id) || null); }
  }

  // ── l'inspecteur, les menus (inspector.js, menus.js les appellent) ─
  function panels(n, K) {
    if (n.type === 'frame') {
      const { seq, skip } = deckOf(S.board);
      const shown = seq.filter((f) => !skip.has(f.id));
      const k = shown.indexOf(n);
      const seg = (items) => el('div', { class: 'seg dp-seg' }, ...items.map(([on, label, fn, title]) => el('button', { class: 'tb' + (on ? ' on' : ''), type: 'button', title: title || null, onclick: fn }, label)));
      return [K.card('Diapositive', n.skip ? 'masquée' : k >= 0 ? `${two(k + 1)} / ${two(shown.length)}` : null,
        seg([[!isSlide(n), 'Libre', () => unslide(n.id), 'un cadre de la planche, de la taille qu’on veut'],
          ...Object.keys(M()?.ratios || {}).map((r) => [n.deck?.ratio === r, r, () => makeSlides([n.id], r), `une scène ${M().ratios[r].join(' × ')}`])]),
        isSlide(n) ? seg(TRANS.map(([t, v]) => [(n.deck.trans || 'fade') === t, v, () => setTrans(n.id, t), `la transition qui mène à cette diapositive`])) : null,
        K.row(K.b('Présenter d’ici', () => P()?.start(n.id), { disabled: !!n.skip, title: n.skip ? 'masquée : Montrer la remet' : '' }),
          K.b('Dupliquer', () => duplicateSlide(n.id), { title: 'la diapositive et son contenu, juste après elle (morph)' }),
          K.b(n.skip ? 'Montrer' : 'Masquer', () => setSkip(app, n.id, !n.skip))),
        K.row(K.b('Styles', () => stylesModal()), K.b('Panneau', () => open())))];
    }
    if (n.type === 'title' || n.type === 'note') {
      const D = M();
      if (!D) return [];
      const st = n.style ? styleOf(app, n.style) : null;
      return [K.card('Style', st ? `${st.size} px · ${st.fontObj?.name || ''}` : null,
        el('div', { class: 'seg dp-seg' }, el('button', { class: 'tb' + (!n.style ? ' on' : ''), type: 'button', onclick: () => setStyle([n], '') }, 'Aucun'),
          ...Object.entries(D.styles).map(([sid, s]) => el('button', { class: 'tb' + (n.style === sid ? ' on' : ''), type: 'button', title: `${s.size} px de la scène`, onclick: () => setStyle([n], sid) }, s.name))),
        el('div', { class: 'seg dp-seg' }, ...ALIGN.map(([a, v]) => el('button', { class: 'tb' + ((n.align || 'left') === a ? ' on' : ''), type: 'button', onclick: () => setAlign([n], a) }, v))),
        K.row(K.b('Styles de la présentation', () => stylesModal())))];
    }
    return [];
  }
  function nodeItems(n) {
    if (n.type === 'frame') {
      return [{ label: 'Diapositive', items: [...formatItems(n), ...(isSlide(n) ? ['-', ...transItems(n)] : []), '-',
        { label: 'Dupliquer la diapositive', sub: 'morph', onclick: () => duplicateSlide(n.id) },
        { label: n.skip ? 'Montrer' : 'Masquer', sub: 'dans la présentation', onclick: () => setSkip(app, n.id, !n.skip) }] }];
    }
    if ((n.type === 'title' || n.type === 'note') && M()) {
      return [{ label: 'Style', items: [{ label: 'Aucun', checked: !n.style, onclick: () => setStyle([n], '') },
        ...Object.entries(M().styles).map(([sid, s]) => ({ label: s.name, sub: `${s.size} px`, checked: n.style === sid, onclick: () => setStyle([n], sid) })),
        '-', { label: 'Styles de la présentation…', onclick: () => stylesModal() }] }];
    }
    return [];
  }
  function selItems(us) {
    const fr = us.filter((n) => n.type === 'frame');
    const ts = texts(app.groups.expand(us));
    const out = [];
    if (fr.length) out.push({ label: fr.length > 1 ? 'Faire des diapositives' : 'Faire une diapositive', sub: '16:9', onclick: () => makeSlides(fr.map((f) => f.id)) });
    if (ts.length && M()) out.push({ label: 'Style des textes', items: [{ label: 'Aucun', onclick: () => setStyle(ts, '') }, ...Object.entries(M().styles).map(([sid, s]) => ({ label: s.name, onclick: () => setStyle(ts, sid) }))] });
    return out;
  }
  const boardItems = (wx, wy) => [{ label: 'Diapositive', sub: '16:9', onclick: () => newSlide([wx, wy]) }];

  // ── la palette ⌘K ─────────────────────────────────────────
  const oneFrame = () => { const s = selected(); return s.length === 1 && s[0].type === 'frame' ? s[0] : null; };
  A.command({ order: 13, label: 'Nouvelle diapositive', sub: '16:9', run: () => newSlide() });
  A.command({ order: 14, label: 'Faire une diapositive du cadre choisi', sub: '16:9',
    when: () => (selected().some((n) => n.type === 'frame') ? true : 'choisissez d’abord un cadre'), run: () => makeSlides(selected().filter((n) => n.type === 'frame').map((n) => n.id)) });
  A.command({ order: 15, label: 'Dupliquer la diapositive', when: () => (oneFrame() ? true : 'choisissez d’abord un cadre'), run: () => duplicateSlide(oneFrame().id) });
  A.command({ order: 16, label: 'Panneau Diapositives', sub: 'ouvrir, fermer', run: () => toggle() });
  A.command({ order: 17, label: 'Styles de la présentation…', sub: 'polices, tailles', run: () => stylesModal() });
  for (const [sid, name] of [['display', 'Display'], ['h1', 'H1'], ['h2', 'H2'], ['body', 'Corps'], ['caption', 'Légende'], ['label', 'Étiquette']]) {
    A.command({ order: 18, label: `Style : ${name}`, sub: 'les textes choisis', when: () => (texts(selected()).length ? true : 'choisissez un titre ou une note'), run: () => setStyle(selected(), sid) });
  }

  // ── présentation (agent « présentations », 30/09) ─────────
  // le mode Présentation, chargé à la demande (il ne pèse rien tant qu'on n'y entre pas)
  function enterMode(from = null) {
    import('../presentation/mode.js').then((m) => m.enter(app, { from })).catch((e) => { console.error('présentation · mode', e); toast(`le mode Présentation ne se charge pas : ${e.message}`); });
  }
  A.command({ order: 19, label: 'Mode présentation', sub: 'modèles, motion, passe assistée', run: () => enterMode(oneFrame()?.id || null) });
  // la planche montre l'habit du modèle appliqué : le fond de chaque diapositive, la couleur de ses
  // textes (les mêmes règles que la scène : presentation/scene.js, lookOf) ; les polices viennent
  // déjà des styles (pres.styles). Des données du modèle, posées dans une feuille vivante.
  const lookSheet = A.style('pm-look');
  let lookSeq = 0;
  async function paintLook() {
    const id = S.board?.pres?.template;
    const my = ++lookSeq;
    if (!id) { if (looks.size) { looks.clear(); drawThumbs(true); } lookSheet(''); return; }
    const [{ modele }, { lookOf }] = await Promise.all([import('../presentation/modeles.js'), import('../presentation/scene.js')]);
    const tpl = await modele(id);
    if (my !== lookSeq) return;
    if (!tpl) { lookSheet(''); return; }
    const pal = tpl.palette;
    const fs = deckOf(S.board).seq.filter((f) => isSlide(f) && !f.skip);
    const q = (x) => `"${String(x).replace(/["\\]/g, '\\$&')}"`;
    let css = '';
    looks.clear();
    fs.forEach((f, i) => {
      const L = lookOf(S.board, f, tpl, i, fs.length);
      const colors = new Map();
      css += `.cv .fr.deck[data-id=${q(f.id)}] { background: ${pal[L.bgKey] || pal.bg}; }\n`;
      for (const [nid, tone] of L.tones) if (pal[tone]) { colors.set(nid, pal[tone]); css += `.cv .nd[data-id=${q(nid)}] > .txt { color: ${pal[tone]}; }\n`; }
      looks.set(f.id, { bg: pal[L.bgKey] || pal.bg, colors });
    });
    lookSheet(css);
    drawThumbs(true);
  }
  let lookT = 0;
  const lookSoon = () => { clearTimeout(lookT); lookT = setTimeout(() => paintLook().catch(() => {}), 160); };
  app.on('commit', lookSoon); app.on('quiet', lookSoon); app.on('board', lookSoon);
  lookSoon();
  // ── fin présentation ──

  // ── l'ordre gardé dans ce navigateur (avant le 30/09) passe sur la planche, une fois ─
  function migrate(b) {
    if (!b) return;
    const key = 'at-slides-' + b.id;
    const saved = app.LS(key);
    if (!saved || document.body.classList.contains('co-viewer')) return;
    app.LS(key, null);
    const frames = b.nodes.filter((f) => f.type === 'frame');
    if (frames.some((f) => Number.isFinite(f.slide) || f.skip)) return;   // la planche a déjà le sien
    const has = new Set(frames.map((f) => f.id));
    const order = (saved.order || []).filter((id) => has.has(id));
    const skip = (saved.skip || []).filter((id) => has.has(id));
    if (!order.length && !skip.length) return;
    app.quiet((B) => {
      if (order.length) putOrder(B, [...order, ...readingOrder(frames.filter((f) => !order.includes(f.id))).map((f) => f.id)]);
      for (const id of skip) { const f = B.nodes.find((n) => n.id === id); if (f) f.skip = true; }
    });
    toast('l’ordre des diapositives, gardé jusqu’ici dans ce navigateur, est maintenant sur la planche');
  }

  // ── les événements ────────────────────────────────────────
  let boardId = null;
  const onBoard = (b) => {
    paintStyles();
    if (b && b.id !== boardId) {
      boardId = b.id;
      migrate(b);
      const want = app.LS('dp-open');
      if (want === true || (want === null && b.nodes.some(isSlide))) open(false); else close(false);
    }
  };
  app.on('board', onBoard);
  if (S.board) onBoard(S.board);
  app.on('render', () => { paintStyles(); paintNumbers(); paintPanel(); });
  app.on('selection', () => paintPanel());
  for (const ev of ['commit', 'quiet']) app.on(ev, () => { paintPanel(); drawThumbs(true); });
  // le thème change (préférence Général) : les vignettes relisent ses jetons
  new MutationObserver(() => drawThumbs(true)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  document.fonts?.addEventListener?.('loadingdone', () => { app.render(); drawThumbs(true); });
  if (S.board) { paintStyles(); app.render(); }

  app.diapo = { panels, nodeItems, selItems, boardItems, open, close, toggle, makeSlides, newSlide, duplicateSlide, stylesModal, setStyle, setAlign, isOpen, grid, enterMode };
}
