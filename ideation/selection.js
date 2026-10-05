// IDÉATION — le cadre de sélection et sa barre (l'étude : docs/etudes/ideation_miro.md
// § 3.5, § 3.9). Dès que deux objets ou un groupe sont choisis, un filet orange
// de 1 px d'écran entoure la sélection, avec deux sortes de poignées qui ne se
// confondent pas :
//   - les quatre coins : l'échelle (places et tailles, depuis le coin opposé ;
//     une image garde ses proportions, un texte sa police, sa boîte s'élargit) —
//     la poignée de redimensionnement de Miro ;
//   - la pastille au milieu du bord droit : l'organisation. Sur un groupe, elle
//     règle la largeur de sa rangée et refait le flux à chaque image (l'Auto
//     layout de Miro fait comme le Wrap de Figma) ; sur une sélection, elle range
//     une fois, puis propose de grouper.
// La barre se pose centrée au-dessus (x = milieu − largeur / 2, comme tldraw),
// à 10 px, ramenée dans la planche, dessous s'il n'y a pas la place ; elle se
// cache pendant qu'on glisse, redimensionne, se déplace ou zoome, et revient
// 150 ms après. Ses boutons dépendent de ce qui est choisi ; aucun n'est orange
// (l'orange reste à Générer). Les sous-menus : commun/menu.js.

import { el, toast, studioSeul } from '../commun/shell.js';
import { menu } from '../commun/menu.js';
import { PAD, bboxOf, kidsOf, layoutOf, setOrder, readingOrder, flowAt, columns, GAP } from './groups.js';

const AUTO = new Set(['note', 'sticky', 'title', 'gen', 'vgen', 'compose']);
const CARDS = new Set(['gen', 'vgen', 'compose']);
const minW = (n) => (CARDS.has(n.type) ? 270 : n.type === 'frame' ? 120 : 48);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createSelection(app, env) {
  const { S } = app;
  const { cv, drag, toWorld, box, isCard, isLocked, live } = env;
  const V = () => S.view;
  const G = () => app.groups;

  // ── le cadre et ses poignées (px d'écran, au-dessus de la planche) ──
  const corners = ['nw', 'ne', 'sw', 'se'].map((c) => el('i', { class: 'sh', 'data-c': c, title: 'mettre à l’échelle (depuis le coin opposé)' }));
  const org = el('button', { class: 'sorg', type: 'button', title: 'organiser : tirer règle la largeur de la rangée, les objets passent à la ligne · un clic : ranger' },
    el('i'), el('i'), el('i'));
  const info = el('span', { class: 'sinfo lbl', hidden: true });
  const frame = el('div', { class: 'selbox', hidden: true }, ...corners, org, info);
  const bar = el('div', { class: 'sbar', role: 'toolbar', 'aria-label': 'la sélection', hidden: true });
  cv.append(frame, bar);
  for (const n of [bar, frame]) {
    // leurs gestes restent à eux : un clic dans la barre ne vide pas la sélection ; le bouton
    // du milieu passe à la planche (il déplace la vue partout)
    n.addEventListener('pointerdown', (e) => { if (e.button !== 1) e.stopPropagation(); });
    n.addEventListener('dblclick', (e) => e.stopPropagation());
    // le clic droit : le menu de la sélection (menus.js), jamais celui du navigateur
    n.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.target.closest?.('input')) { menu(e.clientX, e.clientY, app.menus.text(e.target.closest('input'))); return; }
      const items = app.menus?.forSelection(units());
      if (items) menu(e.clientX, e.clientY, items);
    });
  }
  for (const c of corners) c.addEventListener('pointerdown', (e) => startScale(e, c.dataset.c));
  org.addEventListener('pointerdown', startOrganise);

  // ── les poignées d'un objet d'annotation choisi seul (étude ideation_atelier.md § 3.5) ──
  // quatre ronds hors de ses bords (px d'écran) : en tirer un vers un objet le relie d'une
  // flèche droite ; lâché dans le vide, « créer et relier » (canvas.js, startLink)
  const hds = ['t', 'r', 'b', 'l'].map((s) => el('i', { class: 'ob-hd', 'data-side': s, hidden: true,
    title: 'tirer vers un objet : une flèche · dans le vide : un objet neuf, déjà relié' }));
  cv.append(...hds);
  let hdId = null;
  for (const h of hds) {
    h.addEventListener('pointerdown', (e) => {
      if (e.button === 1) return;   // le bouton du milieu déplace la vue
      e.preventDefault(); e.stopPropagation();
      if (e.button !== 0 || isLocked() || !hdId) return;
      env.startLink(e, hdId);
    });
    h.addEventListener('dblclick', (e) => e.stopPropagation());
    h.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
  }
  function placeHandles() {
    const one = S.sel.size === 1 && !S.link ? app.node([...S.sel][0]) : null;
    const show = !!(S.board && one && app.objets?.annot(one) && !isLocked() && !isCard(one) && !app.canvas?.hiddenIn?.(one.id));
    hdId = show ? one.id : null;
    for (const h of hds) h.hidden = !show;
    if (!show) return;
    const v = V(), b = box(one);
    const sx = v.x + b.x * v.z, sy = v.y + b.y * v.z, sw = b.w * v.z, sh = b.h * v.z;
    // hors du bord : la sortie d'un texte (son port) reste à elle ; la pastille d'un nœud de mind map aussi
    const off = 14, offR = one.type === 'mind' && app.objets.info(one.id)?.kids ? 36 : off;
    const pos = { t: [sx + sw / 2, sy - off], r: [sx + sw + offR, sy + sh / 2], b: [sx + sw / 2, sy + sh + off], l: [sx - off, sy + sh / 2] };
    for (const h of hds) { const [x, y] = pos[h.dataset.side]; h.style.left = `${Math.round(x)}px`; h.style.top = `${Math.round(y)}px`; }
  }

  // ce qui est choisi, et ce que le cadre et la barre en montrent
  const units = () => [...S.sel].map((id) => app.node(id)).filter(Boolean);
  function modeOf(us) {
    if (!us.length) return null;
    if (us.length > 1) return 'multi';
    const n = us[0];
    if (n.type === 'group') return isCard(n) ? 'card' : 'group';
    if (n.type === 'frame') return 'frame';
    if (n.type === 'media' && n.kind === 'image') return 'image';
    // un texte : sa barre (objets/texte.js), comme Miro — les réglages depuis le texte
    if (n.type === 'text' && app.texte) return 'text';
    // un titre, une note : leur barre (diapo/libre.js) — le style, et sans style police, taille, couleurs, alignement
    if ((n.type === 'title' || n.type === 'note') && app.libre) return 'libre';
    // un modèle 3D : éclairage, canal, recadrer (objets/modele3d.js)
    if (n.type === 'model3d' && app.modele3d) return 'm3d';
    return null;   // un seul objet autre qu'une image ou un texte : l'inspecteur suffit
  }
  const selBox = (us) => bboxOf(us.map(box));

  // ── la barre ────────────────────────────────────────────────
  const btn = (label, onclick, { title = '', why = '', on = false, cls = '' } = {}) => {
    const b = el('button', { class: `sbt${on ? ' on' : ''}${why ? ' off' : ''}${cls ? ' ' + cls : ''}`, type: 'button',
      title: why || title || null, 'aria-disabled': why ? 'true' : null, 'aria-pressed': on ? 'true' : null }, label);
    // une action éteinte dit pourquoi
    b.addEventListener('click', (e) => { e.stopPropagation(); if (why) { toast(why, 5000); return; } onclick(e, b); });
    return b;
  };
  const sub = (label, items, opts = {}) => btn(label, (e, b) => { const r = b.getBoundingClientRect(); menu(r.left, r.bottom + 4, items()); }, { ...opts, cls: 'dd' });
  const sep = () => el('i', { class: 'ssep' });
  // « ⋯ » : tout ce que le clic droit propose sur cette sélection (menus.js)
  const more = (us) => btn('⋯', (e, b) => {
    const r = b.getBoundingClientRect();
    const items = app.menus.forSelection(us);
    if (items) menu(r.left, r.bottom + 4, items);
  }, { title: 'plus : dupliquer, premier plan, supprimer… (le clic droit aussi)', cls: 'more' });
  const alignItems = () => [{ head: 'aligner' },
    { label: 'À gauche', key: 'Alt+A', onclick: () => app.align('left') }, { label: 'Au centre', key: 'Alt+H', onclick: () => app.align('hcenter') },
    { label: 'À droite', key: 'Alt+D', onclick: () => app.align('right') }, '-',
    { label: 'En haut', key: 'Alt+W', onclick: () => app.align('top') }, { label: 'Au milieu', key: 'Alt+V', onclick: () => app.align('vmiddle') },
    { label: 'En bas', key: 'Alt+S', onclick: () => app.align('bottom') }];

  function content(mode, us) {
    const out = [];
    const one = us[0];
    if (mode === 'multi') {
      const flat = G().expand(us);
      const sized = us.filter((n) => n.type !== 'group' && !n.deck);   // les cadres aussi (30/09) ; une diapositive garde sa scène
      const refable = flat.filter((n) => n.type === 'media' && ['image', 'element'].includes(n.kind) && !S.items.get(n.item)?.missing);
      const stickies = flat.filter((n) => n.type === 'sticky');
      const noSize = sized.length < 2 ? 'choisissez au moins deux objets (un groupe ou une diapositive ne se met pas à la taille d’un autre)' : '';
      out.push(btn('Grouper', () => G().group(), { title: 'ctrl+G · le groupe garde les places', why: G().whyNot(us) }), sep(),
        sub('Aligner', alignItems, { title: 'aligner les bords ou les centres' }),
        sub('Distribuer', () => [{ head: 'des écarts égaux' },
          { label: 'À l’horizontale', key: 'Alt+Maj+H', onclick: () => app.distribute('x') },
          { label: 'À la verticale', key: 'Alt+Maj+V', onclick: () => app.distribute('y') }], { why: us.length < 3 ? 'distribuer : trois objets au moins' : '' }),
        btn('Même hauteur', () => app.sameSize('h'), { title: 'la hauteur du premier choisi ; une image garde ses proportions', why: noSize }),
        btn('Même largeur', () => app.sameSize('w'), { title: 'la largeur du premier choisi ; une image garde ses proportions', why: noSize }),
        btn('Même taille', () => app.sameSize('wh'), { title: 'la largeur et la hauteur du premier choisi (des cadres aussi)', why: noSize }),
        btn('Ranger', () => app.tidy(), { title: 'en rangées, dans l’ordre de lecture · ctrl+alt+T' }), sep(),
        btn('Encadrer', () => app.frameAround(), { title: 'un cadre autour · ctrl+alt+G' }));
      if (refable.length) out.push(btn('Carte Générer', () => app.genWith(refable.map((n) => n.id)), { title: `une carte qui prend ${refable.length > 1 ? 'ces ' + refable.length + ' objets' : 'cet objet'} en référence` }));
      if (stickies.length) {
        out.push(sub('Couleur', () => [{ head: 'les post-it' }, ...(S.meta?.sticky || []).map((c) => ({ label: c.name || c.id, dot: c.id,
          onclick: () => { app.mutate(() => { for (const s of stickies) s.color = c.id; }); app.LS('sticky', c.id); } }))], { title: 'la couleur des post-it choisis' }));
      }
      // les gestes d'atelier (objets/) : regrouper les post-it par couleur, convertir en mind map
      if (stickies.length >= 2) out.push(btn('Par couleur', () => app.objets.regroup(), { title: 'regrouper les post-it en colonnes par couleur, chacune dans un cadre titré' }));
      if (flat.some((n) => ['note', 'sticky', 'title', 'shape', 'card'].includes(n.type))) out.push(btn('En mind map', () => app.objets.toMind(), { title: 'une racine « Synthèse » et une branche par note, forme ou carte' }));
    } else if (mode === 'group') {
      const L = layoutOf(one);
      out.push(nameBtn(one), sep(),
        btn('Dégrouper', () => G().ungroup([one.id]), { title: 'ctrl+maj+G · les objets restent où ils sont' }),
        btn('Réduire', () => G().collapse(one.id, true), { title: 'une carte : les fils qui entrent et sortent y deviennent des ports' }), sep(),
        el('span', { class: 'sseg' },
          btn('Libre', () => G().flow(one.id, false), { on: L.mode !== 'flow', title: 'les objets restent où on les pose' }),
          btn('Rangée', () => G().flow(one.id, true), { on: L.mode === 'flow', title: 'à la suite, à la ligne quand la largeur est atteinte (la pastille à droite la règle)' })),
        btn('Même hauteur', () => G().fit(one.id, 'h'), { on: L.fit === 'h', title: L.fit === 'h' ? 'retirer : chacun reprend sa hauteur libre' : 'tous à la hauteur du premier ; elle reste quand un objet entre ou change' }),
        btn('Même largeur', () => G().fit(one.id, 'w'), { on: L.fit === 'w', title: L.fit === 'w' ? 'retirer' : 'tous à la largeur du premier ; elle reste' }), sep());
      const freeWhy = L.mode !== 'flow' ? 'l’espacement règle une rangée : passez en Rangée' : '';
      out.push(el('span', { class: 'sgap' }, el('span', { class: 'lbl' }, 'espacement'),
        btn('−', () => G().gap(one.id, -8), { why: freeWhy || (L.gap <= 0 ? 'déjà collés' : ''), title: '8 px de moins' }),
        el('b', { class: 'sv' }, String(Math.round(L.gap))),
        btn('+', () => G().gap(one.id, 8), { why: freeWhy, title: '8 px de plus' })), sep(),
        btn('Se réduit de loin', () => G().lod(one.id), { on: !!one.lod, title: 'de loin (sous 42 %), le groupe s’affiche en carte quand sa boîte fait moins de 240 px à l’écran' }));
    } else if (mode === 'card') {
      out.push(nameBtn(one), sep());
      if (one.collapsed) out.push(btn('Déplier', () => G().collapse(one.id, false), { title: 'double-clic sur la carte' }));
      else out.push(btn('Voir', () => app.canvas.flyTo(one.id), { title: 'de loin, ce groupe s’affiche en carte : y aller' }));
      out.push(btn('Dégrouper', () => G().ungroup([one.id]), { title: 'ctrl+maj+G' }));
    } else if (mode === 'frame') {
      const P = app.atelier?.presentation;
      // une diapositive : revenir à son animation (diapo/index.js, le mode Présentation)
      if (one.deck && app.diapo) out.push(btn('Animer', () => app.diapo.enterMode(one.id), { title: 'l’outil d’animation de cette diapositive : entrées, durées, transition' }));
      out.push(btn('Renommer', () => app.canvas.renameFrame(one.id), { title: 'double-clic sur son nom' }),
        btn('Présenter d’ici', () => P.start(one.id), { why: P ? '' : 'la présentation (atelier) n’est pas chargée', title: 'plein écran, de cadre en cadre, depuis celui-ci' }),
        studioSeul(btn('Exporter en PNG', () => app.exportBoard(one.id), { title: 'ce cadre : sur l’ordinateur et dans le presse-papier' })));
    } else if (mode === 'text') {
      out.push(...app.texte.barItems(one, { btn, sub, sep }));
    } else if (mode === 'libre') {
      out.push(...app.libre.barItems(one, { btn, sub, sep }));
    } else if (mode === 'm3d') {
      out.push(...app.modele3d.barItems(one, { btn, sub, sep }));
    } else if (mode === 'image') {
      const it = S.items.get(one.item);
      const rec = it && !it.missing ? app.gen.recipe(it) : null;
      // recadrer (objets/recadrer.js) : Miro met « Crop » en tête de la barre d'une image
      const cw = app.objets?.crop?.whyNot(one) ?? 'le recadrage n’est pas chargé';
      out.push(btn('Recadrer', () => app.objets.crop.start(one.id), { why: cw, title: 'double-clic aussi · poignées, formats ; Entrée applique, Échap annule — l’image reste entière' }),
        btn('Variations', () => app.gen.variations(one.id, 4), { why: rec ? '' : 'image sans recette (déposée ou faite ailleurs) : une carte Générer la prend en référence', title: 'la même recette, quatre autres graines' }),
        btn('Éditer', () => app.insp.focusEdit?.(one.id), { title: 'la consigne d’édition, dans le panneau de droite' }),
        btn('Nuancier', () => app.palette(one.id), { title: 'les couleurs dominantes, posées dessous' }),
        btn('Carte Générer', () => app.genWith([one.id]), { title: 'une carte qui prend cette image en référence' }));
    }
    out.push(more(us));
    return out;
  }
  // le nom du groupe, en tête de sa barre : un clic pour le renommer
  function nameBtn(g) {
    const b = el('button', { class: 'sname', type: 'button', title: 'renommer le groupe' }, g.name || 'Groupe');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const inp = el('input', { class: 'sname-in', value: g.name || '', maxlength: 120, 'aria-label': 'nom du groupe' });
      b.replaceWith(inp);
      inp.focus(); inp.select();
      let done = false;
      const end = (keep) => { if (done) return; done = true; if (keep) G().rename(g.id, inp.value); key = ''; paint(); };
      inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') end(true); if (ev.key === 'Escape') end(false); });
      inp.addEventListener('blur', () => end(true));
    });
    return b;
  }

  // ── la place ────────────────────────────────────────────────
  let key = '', gest = 0, showT = 0, cur = null;
  function place() {
    if (!cur) return;
    const v = V(), b = cur.box;
    let sx = v.x + b.x * v.z, sy = v.y + b.y * v.z, sw = b.w * v.z, sh = b.h * v.z;
    if (cur.frame) Object.assign(frame.style, { left: `${sx}px`, top: `${sy}px`, width: `${sw}px`, height: `${sh}px` });
    if (bar.hidden) return;
    // un cadre porte son nom au-dessus de lui : la barre passe au-dessus du nom (qu'on attrape pour le glisser)
    if (cur.mode === 'frame') {
      const h = app.canvas.dom.get(cur.id)?.el.querySelector('.fr-h');
      if (h && h.offsetParent !== null) { const r = h.getBoundingClientRect(), c = cv.getBoundingClientRect(); const top = r.top - c.top; sh += sy - top; sy = top; }
    }
    const W = cv.clientWidth, H = cv.clientHeight, bw = bar.offsetWidth, bh = bar.offsetHeight;
    // jamais sous la barre des outils, posée à gauche de la planche (barres.css, --side-w)
    const x0 = 8 + (parseFloat(getComputedStyle(cv).getPropertyValue('--side-w')) || 0);
    const x = clamp(sx + sw / 2 - bw / 2, x0, Math.max(x0, W - bw - 8));
    let y = sy - 10 - bh;
    // pas la place au-dessus : dessous ; ni l'un ni l'autre (la sélection couvre la vue) : en haut de la planche
    if (y < 8) { y = sy + sh + 10; if (y + bh > H - 8) y = 8; }
    Object.assign(bar.style, { left: `${Math.round(x)}px`, top: `${Math.round(y)}px` });
  }
  function hide() { frame.hidden = true; bar.hidden = true; cur = null; key = ''; }
  function paint() {
    placeHandles();
    const us = units();
    const mode = S.board && !isLocked() && !S.link ? modeOf(us) : null;
    if (!mode) { hide(); return; }
    const b = selBox(us);
    if (!b) { hide(); return; }
    cur = { mode, box: b, frame: mode === 'multi' || mode === 'group', id: us[0].id };
    frame.hidden = !cur.frame;
    frame.classList.toggle('grp', mode === 'group');
    // la pastille d'organisation : sur une sélection et sur un groupe déplié
    org.hidden = !cur.frame;
    // ne refaire la barre que si ce qu'elle montre a changé (un bouton refait sous le pointeur perdrait son clic)
    const k = mode + '|' + JSON.stringify(us.map((n) => [n.id, n.type, n.kind, n.name, n.layout, n.lod, n.collapsed, n.color, isCard(n)]))
      + (mode === 'text' ? '|' + app.texte.barKey(us[0]) : mode === 'libre' ? '|' + app.libre.barKey(us[0]) : mode === 'm3d' ? '|' + app.modele3d.barKey(us[0]) : '')
      + '|' + (app.atelier?.presentation ? 1 : 0) + (us.length === 1 && us[0].item ? '|' + (app.gen.recipe(S.items.get(us[0].item) || {}) ? 1 : 0) : '');
    // (sauf pendant qu'on renomme le groupe dans la barre)
    const naming = bar.contains(document.activeElement) && document.activeElement.matches('input');
    if (k !== key && !naming) { key = k; bar.replaceChildren(...content(mode, us)); }
    bar.hidden = false;
    bar.classList.toggle('hide', gest > 0);
    place();
  }
  // la sélection bouge (un objet qu'on glisse, la vue qui se déplace) : le cadre suit,
  // la barre se cache et revient 150 ms après le dernier mouvement
  // la vue bouge (molette, pavé) : le cadre de la sélection suit à chaque image, sans rien lire de la page ; la barre,
  // cachée pendant le geste, se replace 150 ms après (place() lit des tailles : une mise en page forcée par événement)
  function follow() {
    placeHandles();
    if (!cur) return;
    const us = units();
    const b = us.length ? selBox(us) : null;
    if (b) cur.box = b;
    bar.classList.add('hide');
    if (cur.frame) {
      const v = V(), bx = cur.box;
      Object.assign(frame.style, { left: `${v.x + bx.x * v.z}px`, top: `${v.y + bx.y * v.z}px`, width: `${bx.w * v.z}px`, height: `${bx.h * v.z}px` });
    }
    clearTimeout(showT);
    showT = setTimeout(() => { if (!gest) { bar.classList.remove('hide'); place(); } }, 150);
  }
  // un geste en cours (glisser, redimensionner, tracer un cadre de sélection) : la barre se cache
  function gesture(on) {
    gest = Math.max(0, gest + (on ? 1 : -1));
    if (on) { bar.classList.add('hide'); clearTimeout(showT); }
    else { clearTimeout(showT); showT = setTimeout(() => { if (!gest) { bar.classList.remove('hide'); paint(); } }, 150); }
  }

  // ── les coins : l'échelle ──────────────────────────────────
  function startScale(e, c) {
    if (e.button !== 0 || isLocked()) return;
    e.preventDefault(); e.stopPropagation();
    const us = units();
    const list = G().expand(us);
    const b0 = selBox(us);
    if (!b0 || b0.w < 1 || b0.h < 1) return;
    // le coin opposé, sur le contenu (les objets d'un groupe, pas sa marge de 24 px) : ce coin ne bouge pas
    const cb = bboxOf(us.map((n) => (n.type === 'group' && !isCard(n) ? bboxOf(kidsOf(S.board, n.id)) || box(n) : box(n))));
    const ax = c.includes('w') ? cb.x + cb.w : cb.x, ay = c.includes('n') ? cb.y + cb.h : cb.y;
    const sgx = c.includes('w') ? -1 : 1, sgy = c.includes('n') ? -1 : 1;
    const x0 = e.clientX, y0 = e.clientY, z0 = V().z;
    const orig = list.map((n) => [n, n.x, n.y, n.w, n.h, n.layout ? { ...layoutOf(n) } : null, n.size]);
    let moved = false;
    drag((ev) => {
      const dx = ((ev.clientX - x0) / z0) * sgx, dy = ((ev.clientY - y0) / z0) * sgy;
      if (!moved && Math.hypot(dx, dy) < 2) return;
      const k = clamp(Math.max((b0.w + dx) / b0.w, (b0.h + dy) / b0.h), 0.05, 20);
      if (!moved) { app.snap(); moved = true; gesture(true); cv.classList.add('scaling'); }
      const P = (x, y) => [Math.round(ax + (x - ax) * k), Math.round(ay + (y - ay) * k)];
      for (const [n, x, y, w, h, L, size] of orig) {
        if (n.type === 'group') {
          // l'origine de sa rangée suit le coin, sa largeur et son espacement l'échelle
          if (L) n.layout = { ...L, width: Math.round(L.width * k), gap: Math.round(L.gap * k) };
          const [px, py] = n.collapsed ? P(x, y) : P(x + PAD, y + PAD);
          n.x = n.collapsed ? px : px - PAD; n.y = n.collapsed ? py : py - PAD;
          continue;
        }
        // une mind map : sa racine suit l'échelle, l'arbre se range depuis elle (ses nœuds gardent leur taille)
        if (n.type === 'mind') { if (!n.parent) [n.x, n.y] = P(x, y); continue; }
        [n.x, n.y] = P(x, y);
        // une diapositive garde la taille de sa scène (diapo/)
        if (n.deck) continue;
        // un objet texte se met à l'échelle, sa taille avec lui (Miro : la poignée de la sélection est une échelle)
        if (n.type === 'text') { n.size = clamp(Math.round((size || 14) * k * 2) / 2, 6, 400); if (n.wrap) n.w = Math.max(24, Math.round(w * k)); continue; }
        // un texte garde sa police : sa boîte s'élargit, sa hauteur suit
        if (AUTO.has(n.type)) n.w = Math.max(minW(n), Math.round(w * k));
        else { n.w = Math.max(16, Math.round(w * k)); n.h = Math.max(16, Math.round(h * k)); }
      }
      live(list);
      follow();
    }, () => {
      cv.classList.remove('scaling');
      if (moved) { gesture(false); app.commit(); }
    });
  }

  // ── la pastille : l'organisation ───────────────────────────
  function startOrganise(e) {
    if (e.button !== 0 || isLocked()) return;
    e.preventDefault(); e.stopPropagation();
    const us = units();
    const g = us.length === 1 && us[0].type === 'group' && !us[0].collapsed ? us[0] : null;
    const x0 = e.clientX;
    let moved = false;
    const say = (t) => { info.hidden = !t; info.textContent = t; };
    if (g) {
      drag((ev) => {
        if (!moved && Math.abs(ev.clientX - x0) < 3) return;
        if (!moved) {
          app.snap(); moved = true; gesture(true);
          // un groupe libre passe en rangée à la première traction, dans l'ordre de lecture
          if (layoutOf(g).mode !== 'flow') setOrder(S.board, g.id, readingOrder(kidsOf(S.board, g.id)));
        }
        const kids = kidsOf(S.board, g.id);
        const [wx] = toWorld(ev.clientX, ev.clientY);
        const width = Math.max(Math.max(...kids.map((k) => k.w)), Math.round(wx - (g.x + PAD)));
        g.layout = { ...layoutOf(g), mode: 'flow', width };
        live([g, ...kids]);
        const cols = columns(kids, width, layoutOf(g).gap);
        say(cols ? `${cols} colonne${cols > 1 ? 's' : ''}` : `largeur ${width}`);
        follow();
      }, () => {
        say('');
        if (moved) { gesture(false); app.commit(); } else G().flow(g.id, true);
      });
      return;
    }
    // une sélection : ranger une fois, à la largeur qu'on tire (rien ne la retient sans groupe) ;
    // une mind map compte pour sa racine (son arbre la suit)
    const list = readingOrder(app.objets ? app.objets.roots(us) : us);
    const boxes = new Map(list.map((n) => [n.id, { ...box(n) }]));
    const b0 = bboxOf([...boxes.values()]);
    drag((ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      if (!moved) { app.snap(); moved = true; gesture(true); }
      const [wx] = toWorld(ev.clientX, ev.clientY);
      const width = Math.max(Math.max(...list.map((n) => boxes.get(n.id).w)), Math.round(wx - b0.x));
      const prox = list.map((n) => ({ n, w: boxes.get(n.id).w, h: boxes.get(n.id).h, x: 0, y: 0 }));
      flowAt(prox, b0.x, b0.y, width, GAP);
      for (const p of prox) { const bx = box(p.n); G().shift(p.n, p.x - bx.x, p.y - bx.y); }
      live(G().expand(list));
      const cols = columns(prox, width, GAP);
      say(cols ? `${cols} colonne${cols > 1 ? 's' : ''}` : `largeur ${width}`);
      follow();
    }, () => {
      say('');
      if (moved) { gesture(false); app.commit(); toast('rangés une fois — Grouper (ctrl+G) garde la mise en forme', 5000); }
      else app.tidy();
    });
  }

  return { paint, follow, gesture, hide, el: bar, frame };
}
